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

const googleTokenInfoUrl = "https://oauth2.googleapis.com/tokeninfo";
const googleUserInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
const googleProvider = "google";
const sessionTokenByteLength = 32;
const defaultSessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const browserSessionTicketMaxAgeMs = 5 * 60 * 1000;
const browserSessionTicketVersion = 1;
const fallbackDashboardPath = "/dashboard?tab=tailor";

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
