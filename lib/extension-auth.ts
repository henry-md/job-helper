import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { resolveAuthOrigin } from "@/lib/auth-origin";
import { getPrismaClient } from "@/lib/prisma";
import { buildNormalizedJobUrlHash } from "@/lib/job-url-hash";
import { normalizeCompanyName } from "@/lib/job-tracking-shared";
import {
  copyTailoredResumePdfBetweenUsers,
  copyTailoredResumeVersionPdfBetweenUsers,
  copyTailorResumePreviewPdfBetweenUsers,
  deleteTailoredResumePdf,
  readTailorResumeProfile,
  withTailorResumeProfileLock,
  writeTailorResumeProfile,
} from "@/lib/tailor-resume-storage";
import { normalizeTailorResumeJobUrl } from "@/lib/tailor-resume-job-url";
import type {
  TailorResumePendingInterview,
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";
import { bumpUserSyncState } from "@/lib/user-sync-state";

const googleTokenInfoUrl = "https://oauth2.googleapis.com/tokeninfo";
const googleUserInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
const googleProvider = "google";
const sessionTokenByteLength = 32;
const defaultSessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const browserSessionTicketMaxAgeMs = 5 * 60 * 1000;
const browserSessionTicketVersion = 1;
const fallbackDashboardPath = "/dashboard";

type EnvShape = Partial<Record<string, string | undefined>>;

type GoogleTokenInfo = {
  aud?: unknown;
  email?: unknown;
  email_verified?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type GoogleUserInfo = {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
  sub?: unknown;
};

type BrowserSessionTicketPayload = {
  callbackPath: string;
  expiresAt: number;
  sessionToken: string;
  version: typeof browserSessionTicketVersion;
};

type TailoringMergeKeys = {
  applicationIds: Set<string>;
  jobUrls: Set<string>;
  runIds: Set<string>;
  tailoredResumeIds: Set<string>;
};

export type ExtensionGoogleProfile = {
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  sub: string;
};

export type ExtensionAuthUser = {
  email: string | null;
  id: string;
  image: string | null;
  name: string | null;
};

export class ExtensionAuthConfigError extends Error {}

export class ExtensionAuthTokenError extends Error {}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

function getSessionMaxAgeSeconds() {
  return authOptions.session?.maxAge ?? defaultSessionMaxAgeSeconds;
}

function getTicketKey() {
  const secret = process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    throw new ExtensionAuthConfigError(
      "NEXTAUTH_SECRET is required to create extension browser sessions.",
    );
  }

  return createHash("sha256").update(secret).digest();
}

function parseJsonRecord(value: string) {
  const parsed = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null) {
    throw new ExtensionAuthTokenError("Invalid extension browser session ticket.");
  }

  return parsed as Record<string, unknown>;
}

export function getConfiguredGoogleExtensionClientId(env: EnvShape = process.env) {
  return (
    env.GOOGLE_EXTENSION_CLIENT_ID?.trim() ||
    env.VITE_GOOGLE_EXTENSION_CLIENT_ID?.trim() ||
    ""
  );
}

export function getAppOrigin(request: Request) {
  return resolveAuthOrigin() ?? new URL(request.url).origin;
}

export function normalizeExtensionCallbackPath(
  rawCallbackUrl: string | null | undefined,
  appOrigin: string,
) {
  const normalizedCallbackUrl = rawCallbackUrl?.trim();

  if (!normalizedCallbackUrl) {
    return fallbackDashboardPath;
  }

  try {
    const callbackUrl =
      normalizedCallbackUrl.startsWith("/") &&
      !normalizedCallbackUrl.startsWith("//")
        ? new URL(normalizedCallbackUrl, appOrigin)
        : new URL(normalizedCallbackUrl);

    if (callbackUrl.origin !== appOrigin) {
      return fallbackDashboardPath;
    }

    return `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`;
  } catch {
    return fallbackDashboardPath;
  }
}

export async function verifyGoogleExtensionAccessToken(accessToken: string) {
  const extensionClientId = getConfiguredGoogleExtensionClientId();

  if (!extensionClientId) {
    throw new ExtensionAuthConfigError(
      "GOOGLE_EXTENSION_CLIENT_ID is required for Chrome extension sign-in.",
    );
  }

  const tokenInfoUrl = new URL(googleTokenInfoUrl);
  tokenInfoUrl.searchParams.set("access_token", accessToken);

  const tokenInfoResponse = await fetch(tokenInfoUrl, {
    cache: "no-store",
  });

  if (!tokenInfoResponse.ok) {
    throw new ExtensionAuthTokenError("Google rejected the extension token.");
  }

  const tokenInfo = (await tokenInfoResponse.json()) as GoogleTokenInfo;

  if (readString(tokenInfo.aud) !== extensionClientId) {
    throw new ExtensionAuthTokenError(
      "The Google token was not issued for this Chrome extension.",
    );
  }

  const userInfoResponse = await fetch(googleUserInfoUrl, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new ExtensionAuthTokenError("Google did not return user information.");
  }

  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;
  const sub = readString(userInfo.sub);
  const email = readString(userInfo.email) || readString(tokenInfo.email);
  const emailVerified =
    readBoolean(userInfo.email_verified) || readBoolean(tokenInfo.email_verified);

  if (!sub || !email || !emailVerified) {
    throw new ExtensionAuthTokenError(
      "Google did not return a verified account for this extension sign-in.",
    );
  }

  return {
    email,
    emailVerified,
    name: readString(userInfo.name) || null,
    picture: readString(userInfo.picture) || null,
    sub,
  } satisfies ExtensionGoogleProfile;
}

async function updateUserProfileFromGoogle(
  user: ExtensionAuthUser,
  profile: ExtensionGoogleProfile,
) {
  const data: {
    emailVerified?: Date;
    image?: string;
    name?: string;
  } = {};

  if (!user.name && profile.name) {
    data.name = profile.name;
  }

  if (!user.image && profile.picture) {
    data.image = profile.picture;
  }

  if (profile.emailVerified) {
    data.emailVerified = new Date();
  }

  if (Object.keys(data).length === 0) {
    return user;
  }

  return getPrismaClient().user.update({
    data,
    select: {
      email: true,
      id: true,
      image: true,
      name: true,
    },
    where: { id: user.id },
  });
}

async function linkGoogleAccount(userId: string, providerAccountId: string) {
  const prisma = getPrismaClient();

  try {
    await prisma.account.create({
      data: {
        provider: googleProvider,
        providerAccountId,
        type: "oauth",
        userId,
      },
    });
  } catch {
    const existingAccount = await prisma.account.findUnique({
      select: { userId: true },
      where: {
        provider_providerAccountId: {
          provider: googleProvider,
          providerAccountId,
        },
      },
    });

    if (existingAccount?.userId !== userId) {
      throw new ExtensionAuthTokenError(
        "This Google account is already linked to another Job Helper user.",
      );
    }
  }
}

function addTailoringJobKeys(
  keys: TailoringMergeKeys,
  record: Pick<TailoredResumeRecord, "applicationId" | "id" | "jobUrl">,
) {
  if (record.applicationId) {
    keys.applicationIds.add(record.applicationId);
  }

  keys.tailoredResumeIds.add(record.id);

  const normalizedJobUrl = normalizeTailorResumeJobUrl(record.jobUrl);

  if (normalizedJobUrl) {
    keys.jobUrls.add(normalizedJobUrl);
  }
}

function addTailoringInterviewKeys(
  keys: TailoringMergeKeys,
  interview: TailorResumePendingInterview,
) {
  if (interview.applicationId) {
    keys.applicationIds.add(interview.applicationId);
  }

  if (interview.tailorResumeRunId) {
    keys.runIds.add(interview.tailorResumeRunId);
  }

  keys.tailoredResumeIds.add(interview.id);

  const normalizedJobUrl = normalizeTailorResumeJobUrl(interview.jobUrl);

  if (normalizedJobUrl) {
    keys.jobUrls.add(normalizedJobUrl);
  }
}

function buildSourceTailoringMergeKeys(profile: TailorResumeProfile) {
  const keys: TailoringMergeKeys = {
    applicationIds: new Set(),
    jobUrls: new Set(),
    runIds: new Set(),
    tailoredResumeIds: new Set(),
  };

  for (const tailoredResume of profile.tailoredResumes) {
    addTailoringJobKeys(keys, tailoredResume);
  }

  for (const interview of [
    profile.workspace.tailoringInterview,
    ...profile.workspace.tailoringInterviews,
  ]) {
    if (interview) {
      addTailoringInterviewKeys(keys, interview);
    }
  }

  return keys;
}

function tailoredResumeMatchesMergeKeys(
  tailoredResume: TailoredResumeRecord,
  keys: TailoringMergeKeys,
) {
  if (
    keys.tailoredResumeIds.has(tailoredResume.id) ||
    (tailoredResume.applicationId &&
      keys.applicationIds.has(tailoredResume.applicationId))
  ) {
    return true;
  }

  const normalizedJobUrl = normalizeTailorResumeJobUrl(tailoredResume.jobUrl);

  return Boolean(normalizedJobUrl && keys.jobUrls.has(normalizedJobUrl));
}

function tailoringInterviewMatchesMergeKeys(
  interview: TailorResumePendingInterview,
  keys: TailoringMergeKeys,
) {
  if (
    keys.tailoredResumeIds.has(interview.id) ||
    (interview.applicationId && keys.applicationIds.has(interview.applicationId)) ||
    (interview.tailorResumeRunId && keys.runIds.has(interview.tailorResumeRunId))
  ) {
    return true;
  }

  const normalizedJobUrl = normalizeTailorResumeJobUrl(interview.jobUrl);

  return Boolean(normalizedJobUrl && keys.jobUrls.has(normalizedJobUrl));
}

function mergeTailorResumeProfilesWithSourcePrecedence(input: {
  sourceProfile: TailorResumeProfile;
  targetProfile: TailorResumeProfile;
}) {
  const sourceKeys = buildSourceTailoringMergeKeys(input.sourceProfile);
  const removedTargetTailoredResumeIds = input.targetProfile.tailoredResumes
    .filter((record) => tailoredResumeMatchesMergeKeys(record, sourceKeys))
    .map((record) => record.id);
  const targetTailoringInterviews = input.targetProfile.workspace.tailoringInterviews
    .filter((interview) => !tailoringInterviewMatchesMergeKeys(interview, sourceKeys));
  const targetPrimaryInterview =
    input.targetProfile.workspace.tailoringInterview &&
    !tailoringInterviewMatchesMergeKeys(
      input.targetProfile.workspace.tailoringInterview,
      sourceKeys,
    )
      ? input.targetProfile.workspace.tailoringInterview
      : null;
  const sourceInterviews = [
    input.sourceProfile.workspace.tailoringInterview,
    ...input.sourceProfile.workspace.tailoringInterviews,
  ].filter((interview): interview is TailorResumePendingInterview =>
    Boolean(interview),
  );
  const sourcePrimaryInterview =
    input.sourceProfile.workspace.tailoringInterview ?? sourceInterviews[0] ?? null;
  const mergedInterviewById = new Map<string, TailorResumePendingInterview>();

  for (const interview of [
    ...targetTailoringInterviews,
    ...(targetPrimaryInterview ? [targetPrimaryInterview] : []),
    ...sourceInterviews,
  ]) {
    mergedInterviewById.set(interview.id, interview);
  }

  const mergedProfile = {
    ...input.targetProfile,
    annotatedLatex: input.sourceProfile.annotatedLatex,
    extraction: input.sourceProfile.extraction,
    jobDescription: input.sourceProfile.jobDescription,
    latex: input.sourceProfile.latex,
    links: input.sourceProfile.links,
    resume: input.sourceProfile.resume,
    tailoredResumes: [
      ...input.targetProfile.tailoredResumes.filter(
        (record) => !tailoredResumeMatchesMergeKeys(record, sourceKeys),
      ),
      ...input.sourceProfile.tailoredResumes,
    ],
    workspace: {
      ...input.targetProfile.workspace,
      isBaseResumeStepComplete:
        input.sourceProfile.workspace.isBaseResumeStepComplete ||
        input.targetProfile.workspace.isBaseResumeStepComplete,
      tailoringInterview: sourcePrimaryInterview ?? targetPrimaryInterview,
      tailoringInterviews: [...mergedInterviewById.values()],
      updatedAt:
        input.sourceProfile.workspace.updatedAt ??
        input.targetProfile.workspace.updatedAt,
    },
  } satisfies TailorResumeProfile;

  return {
    mergedProfile,
    removedTargetTailoredResumeIds,
    sourceKeys,
  };
}

async function copySourceTailorResumeArtifacts(input: {
  sourceProfile: TailorResumeProfile;
  sourceUserId: string;
  targetUserId: string;
}) {
  await copyTailorResumePreviewPdfBetweenUsers({
    fromUserId: input.sourceUserId,
    toUserId: input.targetUserId,
  });

  await Promise.all(
    input.sourceProfile.tailoredResumes.flatMap((tailoredResume) => [
      copyTailoredResumePdfBetweenUsers({
        fromUserId: input.sourceUserId,
        tailoredResumeId: tailoredResume.id,
        toUserId: input.targetUserId,
      }),
      ...tailoredResume.versions.map((version) =>
        copyTailoredResumeVersionPdfBetweenUsers({
          fromUserId: input.sourceUserId,
          tailoredResumeId: tailoredResume.id,
          toUserId: input.targetUserId,
          versionId: version.id,
        }),
      ),
    ]),
  );
}

async function moveTailoringDatabaseRowsToGoogleUser(input: {
  sourceKeys: TailoringMergeKeys;
  sourceUserId: string;
  sourceProfile: TailorResumeProfile;
  targetUserId: string;
}) {
  const prisma = getPrismaClient();
  const sourceApplicationIds = [
    ...new Set(
      [
        ...input.sourceKeys.applicationIds,
        ...input.sourceProfile.tailoredResumes.map((record) => record.applicationId),
        input.sourceProfile.workspace.tailoringInterview?.applicationId,
        ...input.sourceProfile.workspace.tailoringInterviews.map(
          (interview) => interview.applicationId,
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const sourceJobUrlHashes = [
    ...new Set(
      [...input.sourceKeys.jobUrls]
        .map((jobUrl) => buildNormalizedJobUrlHash(jobUrl))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  await prisma.$transaction(async (tx) => {
    const sourceApplications =
      sourceApplicationIds.length > 0
        ? await tx.jobApplication.findMany({
            include: {
              company: true,
            },
            where: {
              id: { in: sourceApplicationIds },
              userId: input.sourceUserId,
            },
          })
        : [];
    const allSourceJobUrlHashes = [
      ...new Set([
        ...sourceJobUrlHashes,
        ...sourceApplications
          .map((application) => application.jobUrlHash)
          .filter((value): value is string => Boolean(value)),
      ]),
    ];

    if (allSourceJobUrlHashes.length > 0) {
      await tx.tailorResumeRun.deleteMany({
        where: {
          jobUrlHash: { in: allSourceJobUrlHashes },
          userId: input.targetUserId,
        },
      });
      await tx.tailoredResume.deleteMany({
        where: {
          jobUrlHash: { in: allSourceJobUrlHashes },
          userId: input.targetUserId,
        },
      });
      await tx.jobApplication.deleteMany({
        where: {
          jobUrlHash: { in: allSourceJobUrlHashes },
          userId: input.targetUserId,
        },
      });
    }

    if (input.sourceProfile.tailoredResumes.length > 0) {
      await tx.tailoredResume.deleteMany({
        where: {
          profileRecordId: {
            in: input.sourceProfile.tailoredResumes.map((record) => record.id),
          },
          userId: input.targetUserId,
        },
      });
    }

    for (const application of sourceApplications) {
      const targetCompany = await tx.company.upsert({
        create: {
          name: application.company.name,
          normalizedName: application.company.normalizedName,
          userId: input.targetUserId,
        },
        update: {
          name: application.company.name,
        },
        where: {
          userId_normalizedName: {
            normalizedName:
              application.company.normalizedName ||
              normalizeCompanyName(application.company.name),
            userId: input.targetUserId,
          },
        },
      });

      await tx.jobApplication.update({
        data: {
          companyId: targetCompany.id,
          referrerId: null,
          userId: input.targetUserId,
        },
        where: {
          id: application.id,
        },
      });
    }

    if (sourceApplicationIds.length > 0) {
      await tx.jobApplicationScreenshot.updateMany({
        data: {
          userId: input.targetUserId,
        },
        where: {
          applicationId: { in: sourceApplicationIds },
          userId: input.sourceUserId,
        },
      });
    }

    const runMoveConditions = [
      ...(sourceApplicationIds.length > 0
        ? [{ applicationId: { in: sourceApplicationIds } }]
        : []),
      ...(allSourceJobUrlHashes.length > 0
        ? [{ jobUrlHash: { in: allSourceJobUrlHashes } }]
        : []),
      ...([...input.sourceKeys.runIds].length > 0
        ? [{ id: { in: [...input.sourceKeys.runIds] } }]
        : []),
    ];

    if (runMoveConditions.length > 0) {
      await tx.tailorResumeRun.updateMany({
        data: {
          userId: input.targetUserId,
        },
        where: {
          userId: input.sourceUserId,
          OR: runMoveConditions,
        },
      });
    }

    const tailoredResumeMoveConditions = [
      ...(sourceApplicationIds.length > 0
        ? [{ applicationId: { in: sourceApplicationIds } }]
        : []),
      ...(allSourceJobUrlHashes.length > 0
        ? [{ jobUrlHash: { in: allSourceJobUrlHashes } }]
        : []),
      ...(input.sourceProfile.tailoredResumes.length > 0
        ? [
            {
              profileRecordId: {
                in: input.sourceProfile.tailoredResumes.map((record) => record.id),
              },
            },
          ]
        : []),
    ];

    if (tailoredResumeMoveConditions.length > 0) {
      await tx.tailoredResume.updateMany({
        data: {
          userId: input.targetUserId,
        },
        where: {
          userId: input.sourceUserId,
          OR: tailoredResumeMoveConditions,
        },
      });
    }
  });
}

export async function mergeExtensionTailoringIntoGoogleUser(input: {
  sourceUserId: string | null;
  targetUserId: string;
}) {
  if (!input.sourceUserId || input.sourceUserId === input.targetUserId) {
    return;
  }

  const sourceProfile = await readTailorResumeProfile(input.sourceUserId);

  if (
    sourceProfile.tailoredResumes.length === 0 &&
    !sourceProfile.workspace.tailoringInterview &&
    sourceProfile.workspace.tailoringInterviews.length === 0
  ) {
    return;
  }

  const { removedTargetTailoredResumeIds, sourceKeys } =
    await withTailorResumeProfileLock(input.targetUserId, async () => {
      const targetProfile = await readTailorResumeProfile(input.targetUserId);
      const mergeResult = mergeTailorResumeProfilesWithSourcePrecedence({
        sourceProfile,
        targetProfile,
      });

      await writeTailorResumeProfile(input.targetUserId, mergeResult.mergedProfile);

      return mergeResult;
    });

  await Promise.all(
    removedTargetTailoredResumeIds.map((tailoredResumeId) =>
      deleteTailoredResumePdf(input.targetUserId, tailoredResumeId),
    ),
  );
  await copySourceTailorResumeArtifacts({
    sourceProfile,
    sourceUserId: input.sourceUserId,
    targetUserId: input.targetUserId,
  });
  await moveTailoringDatabaseRowsToGoogleUser({
    sourceKeys,
    sourceProfile,
    sourceUserId: input.sourceUserId,
    targetUserId: input.targetUserId,
  });
  await bumpUserSyncState({ tailoring: true, userId: input.targetUserId });
}

export async function findOrCreateUserForGoogleExtension(
  profile: ExtensionGoogleProfile,
) {
  const prisma = getPrismaClient();
  const existingAccount = await prisma.account.findUnique({
    select: {
      user: {
        select: {
          email: true,
          id: true,
          image: true,
          name: true,
        },
      },
    },
    where: {
      provider_providerAccountId: {
        provider: googleProvider,
        providerAccountId: profile.sub,
      },
    },
  });

  if (existingAccount?.user) {
    return updateUserProfileFromGoogle(existingAccount.user, profile);
  }

  const existingUser = await prisma.user.findFirst({
    select: {
      email: true,
      id: true,
      image: true,
      name: true,
    },
    where: {
      email: {
        equals: profile.email,
        mode: "insensitive",
      },
    },
  });

  if (existingUser) {
    await linkGoogleAccount(existingUser.id, profile.sub);
    return updateUserProfileFromGoogle(existingUser, profile);
  }

  try {
    return await prisma.user.create({
      data: {
        accounts: {
          create: {
            provider: googleProvider,
            providerAccountId: profile.sub,
            type: "oauth",
          },
        },
        email: profile.email,
        emailVerified: profile.emailVerified ? new Date() : null,
        image: profile.picture,
        name: profile.name,
      },
      select: {
        email: true,
        id: true,
        image: true,
        name: true,
      },
    });
  } catch {
    const linkedAccount = await prisma.account.findUnique({
      select: {
        user: {
          select: {
            email: true,
            id: true,
            image: true,
            name: true,
          },
        },
      },
      where: {
        provider_providerAccountId: {
          provider: googleProvider,
          providerAccountId: profile.sub,
        },
      },
    });

    if (linkedAccount?.user) {
      return updateUserProfileFromGoogle(linkedAccount.user, profile);
    }

    throw new ExtensionAuthTokenError(
      "Unable to create a Job Helper user for this Google account.",
    );
  }
}

export async function createDatabaseSession(userId: string) {
  const expires = new Date(Date.now() + getSessionMaxAgeSeconds() * 1000);
  const sessionToken = randomBytes(sessionTokenByteLength).toString("base64url");

  await getPrismaClient().session.create({
    data: {
      expires,
      sessionToken,
      userId,
    },
  });

  return { expires, sessionToken };
}

export function createExtensionBrowserSessionTicket(input: {
  callbackPath: string;
  sessionToken: string;
}) {
  const expiresAt = Date.now() + browserSessionTicketMaxAgeMs;
  const payload: BrowserSessionTicketPayload = {
    callbackPath: input.callbackPath,
    expiresAt,
    sessionToken: input.sessionToken,
    version: browserSessionTicketVersion,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTicketKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    expiresAt: new Date(expiresAt),
    ticket: [
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join("."),
  };
}

export function readExtensionBrowserSessionTicket(
  ticket: string,
): BrowserSessionTicketPayload {
  const [encodedIv, encodedAuthTag, encodedCiphertext] = ticket.split(".");

  if (!encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new ExtensionAuthTokenError("Invalid extension browser session ticket.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTicketKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = parseJsonRecord(decrypted);
  const payload = {
    callbackPath: readString(parsed.callbackPath),
    expiresAt:
      typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
        ? parsed.expiresAt
        : 0,
    sessionToken: readString(parsed.sessionToken),
    version: parsed.version,
  };

  if (
    payload.version !== browserSessionTicketVersion ||
    !payload.sessionToken ||
    !payload.callbackPath ||
    payload.expiresAt <= Date.now()
  ) {
    throw new ExtensionAuthTokenError("Expired extension browser session ticket.");
  }

  return payload as BrowserSessionTicketPayload;
}

export function setNextAuthSessionCookie(
  response: NextResponse,
  request: Request,
  sessionToken: string,
  expires: Date,
) {
  const secure = new URL(getAppOrigin(request)).protocol === "https:";

  response.cookies.set(
    `${secure ? "__Secure-" : ""}next-auth.session-token`,
    sessionToken,
    {
      expires,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    },
  );
}

export function clearNextAuthSessionCookie(response: NextResponse, request: Request) {
  const secure = new URL(getAppOrigin(request)).protocol === "https:";

  response.cookies.set(
    `${secure ? "__Secure-" : ""}next-auth.session-token`,
    "",
    {
      expires: new Date(0),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    },
  );
}
