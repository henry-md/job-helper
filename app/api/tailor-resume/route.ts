import { readFile } from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import {
  extractResumeLatexDocument,
  type ExtractResumeLatexDocumentResult,
} from "@/lib/tailor-resume-extraction";
import { applyTailorResumeLinkOverrides } from "@/lib/tailor-resume-link-overrides";
import {
  buildTailorResumeLinkRecords,
  normalizeTailorResumeLinkUrl,
} from "@/lib/tailor-resume-links";
import { compileTailorResumeLatex } from "@/lib/tailor-resume-latex";
import {
  extractResumeLatexLinks,
  validateTailorResumeLink,
  type TailorResumeLinkValidationEntry,
  type TailorResumeLinkValidationSummary,
} from "@/lib/tailor-resume-link-validation";
import {
  deleteTailorResumePreviewPdf,
  readTailorResumeProfile,
  writeTailorResumePreviewPdf,
  writeTailorResumeProfile,
} from "@/lib/tailor-resume-storage";
import {
  emptyTailorResumeExtractionState,
  emptyTailorResumeLatexState,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";
import {
  assertSupportedResumeFile,
  deletePersistedUserResume,
  persistUserResume,
} from "@/lib/job-tracking";

const maxJobDescriptionLength = 200_000;
const maxLatexCodeLength = 300_000;

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to manage your resume." }, { status: 401 });
}

function buildResumeRecord(input: {
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  storagePath: string;
}) {
  return {
    mimeType: input.mimeType,
    originalFilename: input.originalFilename,
    sizeBytes: input.sizeBytes,
    storagePath: input.storagePath,
    updatedAt: new Date().toISOString(),
  };
}

function readExtractionError(profile: TailorResumeProfile) {
  return profile.extraction.status === "failed"
    ? profile.extraction.error
    : profile.latex.status === "failed"
      ? profile.latex.error
      : null;
}

function buildExtractionResponse(input: {
  extractionAttempts: Awaited<ReturnType<typeof runResumeExtraction>>["extractionAttempts"];
  linkValidationLinks: Awaited<
    ReturnType<typeof runResumeExtraction>
  >["linkValidationLinks"];
  linkValidationSummary: Awaited<
    ReturnType<typeof runResumeExtraction>
  >["linkValidationSummary"];
  profile: TailorResumeProfile;
}) {
  return {
    extractionAttempts: input.extractionAttempts,
    extractionError: readExtractionError(input.profile),
    linkValidationLinks: input.linkValidationLinks,
    linkValidationSummary: input.linkValidationSummary,
    profile: input.profile,
  };
}

function buildLatexLinkSyncSummary(
  previousLinks: TailorResumeProfile["links"],
  nextLinks: TailorResumeProfile["links"],
) {
  const previousKeys = new Set(previousLinks.map((link) => link.key));
  const addedLinks = nextLinks
    .filter((link) => !previousKeys.has(link.key))
    .map((link) => ({
      key: link.key,
      label: link.label,
      url: link.url,
    }));

  return {
    addedCount: addedLinks.length,
    addedLinks,
  };
}

function buildLinkValidationSummary(
  links: TailorResumeLinkValidationEntry[],
): TailorResumeLinkValidationSummary {
  return links.reduce<TailorResumeLinkValidationSummary>(
    (summary, link) => {
      summary.totalCount += 1;

      if (link.outcome === "passed") {
        summary.passedCount += 1;
      } else if (link.outcome === "failed") {
        summary.failedCount += 1;
      } else {
        summary.unverifiedCount += 1;
      }

      return summary;
    },
    {
      failedCount: 0,
      passedCount: 0,
      totalCount: 0,
      unverifiedCount: 0,
    },
  );
}

async function validateLatexLinks(latexCode: string) {
  const extractedLinks = extractResumeLatexLinks(latexCode);
  const httpProbeCache = new Map<
    string,
    Promise<{
      outcome: "failed" | "passed" | "unverified";
      reason: string | null;
    }>
  >();
  const links = await Promise.all(
    extractedLinks.map((link) =>
      validateTailorResumeLink(link, {
        httpProbeCache,
      }),
    ),
  );

  return {
    links,
    summary: buildLinkValidationSummary(links),
  };
}

function readLinkUpdates(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const updates: Array<{ key: string; url: string | null }> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const key =
      "key" in entry && typeof entry.key === "string" ? entry.key.trim() : "";
    const url =
      "url" in entry
        ? typeof entry.url === "string"
          ? entry.url.trim()
          : entry.url === null
            ? null
            : undefined
        : undefined;

    if (!key || typeof url === "undefined") {
      return null;
    }

    updates.push({ key, url });
  }

  return updates;
}

async function persistExtractedLatexResult(
  userId: string,
  extraction: ExtractResumeLatexDocumentResult,
) {
  const updatedAt = new Date().toISOString();

  if (extraction.previewPdf) {
    await writeTailorResumePreviewPdf(userId, extraction.previewPdf);

    return {
      code: extraction.latexCode,
      error: null,
      pdfUpdatedAt: updatedAt,
      status: "ready" as const,
      updatedAt,
    };
  }

  await deleteTailorResumePreviewPdf(userId);

  return {
    code: extraction.latexCode,
    error:
      extraction.validationError ??
      "Unable to compile the generated LaTeX preview.",
    pdfUpdatedAt: null,
    status: "failed" as const,
    updatedAt,
  };
}

async function compileLatexDraft(
  userId: string,
  code: string,
  previousPdfUpdatedAt: string | null,
) {
  const updatedAt = new Date().toISOString();

  try {
    const previewPdf = await compileTailorResumeLatex(code);

    await writeTailorResumePreviewPdf(userId, previewPdf);

    return {
      code,
      error: null,
      pdfUpdatedAt: updatedAt,
      status: "ready" as const,
      updatedAt,
    };
  } catch (error) {
    if (!previousPdfUpdatedAt) {
      await deleteTailorResumePreviewPdf(userId);
    }

    return {
      code,
      error:
        error instanceof Error
          ? error.message
          : "Unable to compile the LaTeX preview.",
      pdfUpdatedAt: previousPdfUpdatedAt,
      status: "failed" as const,
      updatedAt,
    };
  }
}

async function runResumeExtraction(
  userId: string,
  profile: TailorResumeProfile,
) {
  const savedResume = profile.resume;

  if (!savedResume) {
    throw new Error("Upload a resume before extracting.");
  }

  const extractingProfile: TailorResumeProfile = {
    ...profile,
    extraction: {
      ...emptyTailorResumeExtractionState(),
      status: "extracting",
      updatedAt: new Date().toISOString(),
    },
  };

  await writeTailorResumeProfile(userId, extractingProfile);

  try {
    const resumePath = path.join(process.cwd(), "public", savedResume.storagePath);
    const buffer = await readFile(resumePath);
    const extraction = await extractResumeLatexDocument({
      buffer,
      filename: savedResume.originalFilename,
      mimeType: savedResume.mimeType,
    }, {
      knownLinks: profile.links,
    });
    const latex = await persistExtractedLatexResult(userId, extraction);

    const readyProfile: TailorResumeProfile = {
      ...extractingProfile,
      extraction: {
        ...emptyTailorResumeExtractionState(),
        error: null,
        model: extraction.model,
        status: "ready",
        updatedAt: new Date().toISOString(),
      },
      latex,
      links: extraction.resumeLinks,
    };

    await writeTailorResumeProfile(userId, readyProfile);
    return {
      extractionAttempts: extraction.attemptEvents,
      linkValidationLinks: extraction.links,
      linkValidationSummary: extraction.linkSummary,
      profile: readyProfile,
    };
  } catch (error) {
    const failedProfile: TailorResumeProfile = {
      ...extractingProfile,
      extraction: {
        ...emptyTailorResumeExtractionState(),
        error:
          error instanceof Error
            ? error.message
            : "Unable to extract the uploaded resume.",
        status: "failed",
        updatedAt: new Date().toISOString(),
      },
    };

    await writeTailorResumeProfile(userId, failedProfile);
    return {
      extractionAttempts: [],
      linkValidationLinks: [],
      linkValidationSummary: null,
      profile: failedProfile,
    };
  }
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const profile = await readTailorResumeProfile(session.user.id);

  if ("action" in body && body.action === "reextract") {
    if (!profile.resume) {
      return NextResponse.json(
        { error: "Upload a resume before extracting." },
        { status: 400 },
      );
    }

    const extractionResult = await runResumeExtraction(session.user.id, profile);
    return NextResponse.json(buildExtractionResponse(extractionResult));
  }

  if ("action" in body && body.action === "saveLinksAndReextract") {
    if (!profile.resume) {
      return NextResponse.json(
        { error: "Upload a resume before saving link changes." },
        { status: 400 },
      );
    }

    const linkUpdates = readLinkUpdates("links" in body ? body.links : null);

    if (!linkUpdates || linkUpdates.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one link URL to save." },
        { status: 400 },
      );
    }

    const knownKeys = new Set(profile.links.map((link) => link.key));
    const seenKeys = new Set<string>();
    const normalizedUpdates = new Map<string, string | null>();

    for (const linkUpdate of linkUpdates) {
      if (!knownKeys.has(linkUpdate.key)) {
        return NextResponse.json(
          { error: `Unknown resume link key: ${linkUpdate.key}` },
          { status: 400 },
        );
      }

      if (seenKeys.has(linkUpdate.key)) {
        return NextResponse.json(
          { error: `Duplicate link update received for ${linkUpdate.key}.` },
          { status: 400 },
        );
      }

      seenKeys.add(linkUpdate.key);
      if (linkUpdate.url === null) {
        normalizedUpdates.set(linkUpdate.key, null);
        continue;
      }

      const normalizedUrl = normalizeTailorResumeLinkUrl(linkUpdate.url);

      if (!normalizedUrl) {
        return NextResponse.json(
          { error: `Use a valid URL for ${linkUpdate.key}.` },
          { status: 400 },
        );
      }

      normalizedUpdates.set(linkUpdate.key, normalizedUrl);
    }

    const updatedAt = new Date().toISOString();
    const nextProfile: TailorResumeProfile = {
      ...profile,
      links: profile.links.map((link) => {
        if (!normalizedUpdates.has(link.key)) {
          return link;
        }

        const updatedUrl = normalizedUpdates.get(link.key) ?? null;

        return {
          ...link,
          disabled: updatedUrl === null,
          updatedAt,
          url: updatedUrl,
        };
      }),
    };

    nextProfile.latex = await compileLatexDraft(
      session.user.id,
      applyTailorResumeLinkOverrides(profile.latex.code, nextProfile.links),
      nextProfile.latex.pdfUpdatedAt,
    );

    let linkValidationLinks: TailorResumeLinkValidationEntry[] = [];
    let linkValidationSummary: TailorResumeLinkValidationSummary | null = null;

    if (nextProfile.latex.status === "ready") {
      const validation = await validateLatexLinks(nextProfile.latex.code);
      linkValidationLinks = validation.links;
      linkValidationSummary = validation.summary;
    }

    await writeTailorResumeProfile(session.user.id, nextProfile);

    return NextResponse.json({
      extractionAttempts: [],
      extractionError: readExtractionError(nextProfile),
      linkValidationLinks,
      linkValidationSummary,
      profile: nextProfile,
    });
  }

  const nextProfile: TailorResumeProfile = {
    ...profile,
    extraction: {
      ...profile.extraction,
    },
  };
  let latexLinkSyncSummary:
    | {
        addedCount: number;
        addedLinks: Array<{
          key: string;
          label: string;
          url: string | null;
        }>;
      }
    | null = null;
  let didUpdate = false;

  if ("jobDescription" in body) {
    if (typeof body.jobDescription !== "string") {
      return NextResponse.json(
        { error: "Provide job description text to save." },
        { status: 400 },
      );
    }

    if (body.jobDescription.length > maxJobDescriptionLength) {
      return NextResponse.json(
        { error: "Keep the job description under 200,000 characters." },
        { status: 400 },
      );
    }

    nextProfile.jobDescription = body.jobDescription;
    didUpdate = true;
  }

  if ("latexCode" in body) {
    if (typeof body.latexCode !== "string") {
      return NextResponse.json(
        { error: "Provide LaTeX code to save." },
        { status: 400 },
      );
    }

    if (body.latexCode.length > maxLatexCodeLength) {
      return NextResponse.json(
        { error: "Keep the LaTeX under 300,000 characters." },
        { status: 413 },
      );
    }

    if (body.latexCode.trim().length === 0) {
      return NextResponse.json(
        { error: "Paste some LaTeX before saving." },
        { status: 400 },
      );
    }

    nextProfile.links = buildTailorResumeLinkRecords({
      existingLinks: profile.links,
      extractedLinks: extractResumeLatexLinks(body.latexCode).map((link) => ({
        label: link.displayText?.trim() || link.url,
        url: link.url,
      })),
      preferExtractedUrls: true,
      preserveUnusedExisting: false,
    });
    latexLinkSyncSummary = buildLatexLinkSyncSummary(
      profile.links,
      nextProfile.links,
    );
    nextProfile.latex = await compileLatexDraft(
      session.user.id,
      body.latexCode,
      nextProfile.latex.pdfUpdatedAt,
    );
    didUpdate = true;
  }

  if (!didUpdate) {
    return NextResponse.json(
      { error: "No Tailor Resume updates were provided." },
      { status: 400 },
    );
  }

  await writeTailorResumeProfile(session.user.id, nextProfile);

  return NextResponse.json({
    latexLinkSyncSummary,
    profile: nextProfile,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const formData = await request.formData();
  const resumeFile = formData.get("resume");

  if (!(resumeFile instanceof File)) {
    return NextResponse.json(
      { error: "Choose a resume file to upload." },
      { status: 400 },
    );
  }

  try {
    assertSupportedResumeFile(resumeFile);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload a PDF, PNG, JPG, or WebP resume.",
      },
      { status: 400 },
    );
  }

  const existingProfile = await readTailorResumeProfile(session.user.id);
  const previousResumeStoragePath = existingProfile.resume?.storagePath ?? null;
  const persistedResume = await persistUserResume(resumeFile, session.user.id);
  const profileWithSavedResume: TailorResumeProfile = {
    ...existingProfile,
    extraction: {
      ...emptyTailorResumeExtractionState(),
      status: "extracting",
      updatedAt: new Date().toISOString(),
    },
    latex: emptyTailorResumeLatexState(),
    links: [],
    resume: buildResumeRecord({
      mimeType: resumeFile.type || "application/octet-stream",
      originalFilename: resumeFile.name || "resume",
      sizeBytes: persistedResume.sizeBytes,
      storagePath: persistedResume.storagePath,
    }),
  };

  await writeTailorResumeProfile(session.user.id, profileWithSavedResume);
  await deleteTailorResumePreviewPdf(session.user.id);

  const extractionResult = await runResumeExtraction(
    session.user.id,
    profileWithSavedResume,
  );

  if (
    previousResumeStoragePath &&
    previousResumeStoragePath !== persistedResume.storagePath
  ) {
    await deletePersistedUserResume(previousResumeStoragePath);
  }

  return NextResponse.json(buildExtractionResponse(extractionResult));
}
