import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import {
  extractResumeLatexDocument,
  type ExtractResumeLatexDocumentResult,
} from "@/lib/tailor-resume-extraction";
import {
  applyTailorResumeSourceLinkOverridesWithSummary,
  extractTailorResumeTrackedLinks,
} from "@/lib/tailor-resume-link-overrides";
import { extractTailorResumeActualLatexError } from "@/lib/tailor-resume-error-format";
import {
  mergeTailorResumeLinksWithLockedLinks,
  mergeTailorResumeProfileWithLockedLinks,
  readLockedTailorResumeLinksFromLinks,
  replaceTailorResumeLockedLinks,
  stripTailorResumeLinkLocks,
} from "@/lib/tailor-resume-locked-links";
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
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "@/lib/tailor-resume-segmentation";
import {
  buildTailorResumeGenerationSourceSnapshot,
  hasTailorResumeGenerationSourceChanged,
  mergeTailorResumeFailedGeneration,
  mergeTailorResumeSuccessfulGeneration,
} from "@/lib/tailor-resume-tailoring-concurrency";
import {
  buildTailoredResumeResolvedSegmentMap,
  rebuildTailoredResumeAnnotatedLatex,
  resolveTailoredResumeSourceAnnotatedLatex,
  updateTailoredResumeEditState,
} from "@/lib/tailor-resume-edit-history";
import { repairTailoredResumeForCompile } from "@/lib/tailored-resume-repair";
import {
  deleteTailoredResumePdf,
  deleteTailorResumePreviewPdf,
  withTailorResumeProfileLock,
  writeTailoredResumePdf,
  writeTailorResumePreviewPdf,
  writeTailorResumeProfile,
} from "@/lib/tailor-resume-storage";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import { generateTailoredResume } from "@/lib/tailor-resume-tailoring";
import {
  tailorResumeDebugErrorSources,
} from "@/lib/tailor-resume-debug-errors";
import {
  logLatexBuildFailure,
  logTailorResumeDebugError,
} from "@/lib/tailor-resume-log-latex-failure";
import {
  emptyTailorResumeAnnotatedLatexState,
  emptyTailorResumeExtractionState,
  emptyTailorResumeLatexState,
  emptyTailorResumeWorkspaceState,
  type TailorResumeLockedLinkRecord,
  type TailoredResumeBlockEditRecord,
  type TailorResumeProfile,
  type TailorResumeSavedLinkUpdate,
} from "@/lib/tailor-resume-types";
import {
  assertSupportedResumeFile,
  deletePersistedUserResume,
  persistUserResume,
} from "@/lib/job-tracking";

const maxJobDescriptionLength = 200_000;
const maxLatexCodeLength = 300_000;
const maxTailoredResumeDisplayNameLength = 200;

function normalizeAnnotatedLatexState(latexCode: string, updatedAt: string) {
  const normalizedLatex = normalizeTailorResumeLatex(latexCode);

  return {
    annotatedLatex: {
      code: normalizedLatex.annotatedLatex,
      segmentCount: normalizedLatex.segmentCount,
      updatedAt,
    },
    latexCode: stripTailorResumeSegmentIds(normalizedLatex.annotatedLatex),
  };
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to manage your resume." }, { status: 401 });
}

function wantsTailorResumeUploadStream(request: Request) {
  return request.headers.get("x-tailor-resume-stream") === "1";
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
  savedLinkUpdateCount: number;
  savedLinkUpdates: TailorResumeSavedLinkUpdate[];
}) {
  return {
    extractionAttempts: input.extractionAttempts,
    extractionError: readExtractionError(input.profile),
    linkValidationLinks: input.linkValidationLinks,
    linkValidationSummary: input.linkValidationSummary,
    profile: input.profile,
    savedLinkUpdateCount: input.savedLinkUpdateCount,
    savedLinkUpdates: input.savedLinkUpdates,
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

async function handleTailorResumeGeneration(
  body: Record<string, unknown>,
  userId: string,
) {
  const preparation = await withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, profile, rawProfile } = await readTailorResumeProfileState(
      userId,
    );
    const jobDescription =
      typeof body.jobDescription === "string"
        ? body.jobDescription
        : profile.jobDescription;

    if (!profile.latex.code.trim()) {
      return {
        response: NextResponse.json(
          { error: "Upload or save a base resume before tailoring it." },
          { status: 400 },
        ),
      };
    }

    if (!jobDescription.trim()) {
      return {
        response: NextResponse.json(
          { error: "Paste a job description before tailoring the resume." },
          { status: 400 },
        ),
      };
    }

    return {
      jobDescription,
      lockedLinks,
      rawProfile,
    };
  });

  if ("response" in preparation) {
    return preparation.response;
  }

  const normalizedBaseLatex = normalizeAnnotatedLatexState(
    preparation.rawProfile.latex.code,
    new Date().toISOString(),
  );
  const processedBaseAnnotatedLatex = applyTailorResumeSourceLinkOverridesWithSummary(
    normalizedBaseLatex.annotatedLatex.code,
    {
      currentLinks: preparation.rawProfile.links,
      lockedLinks: preparation.lockedLinks,
    },
  );
  const generationSourceSnapshot = buildTailorResumeGenerationSourceSnapshot(
    preparation.rawProfile,
    preparation.lockedLinks,
  );
  const tailoringResult = await generateTailoredResume({
    annotatedLatexCode: processedBaseAnnotatedLatex.latexCode,
    jobDescription: preparation.jobDescription,
    linkOverrides: buildKnownTailorResumeLinks(
      preparation.rawProfile.links,
      preparation.lockedLinks,
    ),
    onBuildFailure: (latexCode, error, attempt) =>
      logLatexBuildFailure({
        userId,
        source: tailorResumeDebugErrorSources.tailoringCompileFailure,
        latexCode,
        error,
        attempt,
      }),
    onInvalidReplacement: (payload, error, attempt) =>
      logTailorResumeDebugError({
        userId,
        source: tailorResumeDebugErrorSources.tailoringInvalidReplacement,
        latexCode: payload,
        error,
        attempt,
      }),
  });

  if (tailoringResult.outcome === "generation_failure") {
    if (preparation.rawProfile.jobDescription !== preparation.jobDescription) {
      await withTailorResumeProfileLock(userId, async () => {
        const latestState = await readTailorResumeProfileState(userId);
        const nextRawProfile = mergeTailorResumeFailedGeneration({
          currentRawProfile: latestState.rawProfile,
          jobDescription: preparation.jobDescription,
          snapshotRawProfile: preparation.rawProfile,
        });

        if (nextRawProfile !== latestState.rawProfile) {
          await writeTailorResumeProfile(userId, nextRawProfile);
        }
      });
    }

    const attemptLabel =
      tailoringResult.attempts === 1 ? "attempt" : "attempts";
    const failureMessage = tailoringResult.validationError?.trim()
      ? `Unable to generate a valid tailored resume after ${tailoringResult.attempts} ${attemptLabel}: ${tailoringResult.validationError}`
      : `Unable to generate a valid tailored resume after ${tailoringResult.attempts} ${attemptLabel}.`;

    return NextResponse.json(
      {
        error: failureMessage,
        tailoredResumeDurationMs: tailoringResult.generationDurationMs,
      },
      { status: 422 },
    );
  }

  const tailoredResumeId = randomUUID();
  const tailoredResumeUpdatedAt = new Date().toISOString();
  const nextState = await withTailorResumeProfileLock(userId, async () => {
    const latestState = await readTailorResumeProfileState(userId);

    if (
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: generationSourceSnapshot,
      })
    ) {
      return null;
    }

    if (tailoringResult.previewPdf) {
      await writeTailoredResumePdf(userId, tailoredResumeId, tailoringResult.previewPdf);
    } else {
      await deleteTailoredResumePdf(userId, tailoredResumeId);
    }

    const nextRawProfile = mergeTailorResumeSuccessfulGeneration({
      annotatedLatex: normalizedBaseLatex.annotatedLatex,
      currentRawProfile: latestState.rawProfile,
      jobDescription: preparation.jobDescription,
      snapshotRawProfile: preparation.rawProfile,
      tailoredResume: {
        annotatedLatexCode: tailoringResult.annotatedLatexCode,
        companyName: tailoringResult.companyName,
        createdAt: tailoredResumeUpdatedAt,
        displayName: tailoringResult.displayName,
        edits: tailoringResult.edits,
        error: tailoringResult.validationError,
        id: tailoredResumeId,
        jobDescription: preparation.jobDescription,
        jobIdentifier: tailoringResult.jobIdentifier,
        latexCode: tailoringResult.latexCode,
        openAiDebug: tailoringResult.openAiDebug,
        pdfUpdatedAt: tailoringResult.previewPdf ? tailoredResumeUpdatedAt : null,
        planningResult: tailoringResult.planningResult,
        positionTitle: tailoringResult.positionTitle,
        sourceAnnotatedLatexCode: normalizeTailorResumeLatex(
          processedBaseAnnotatedLatex.latexCode,
        ).annotatedLatex,
        status: tailoringResult.previewPdf ? "ready" : "failed",
        thesis: tailoringResult.thesis,
        updatedAt: tailoredResumeUpdatedAt,
      },
    });

    await writeTailorResumeProfile(userId, nextRawProfile);

    return {
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });

  if (!nextState) {
    return NextResponse.json(
      {
        error:
          "The base resume changed while the tailored resume was generating. Review the latest resume and try again.",
        tailoredResumeDurationMs: tailoringResult.generationDurationMs,
      },
      { status: 409 },
    );
  }

  const nextProfile = mergeTailorResumeProfileWithLockedLinks(
    nextState.rawProfile,
    nextState.lockedLinks,
    {
      includeLockedOnly: true,
    },
  );

  return NextResponse.json({
    profile: nextProfile,
    savedLinkUpdateCount:
      processedBaseAnnotatedLatex.updatedCount +
      tailoringResult.savedLinkUpdateCount,
    savedLinkUpdates: [
      ...processedBaseAnnotatedLatex.updatedLinks,
      ...tailoringResult.savedLinkUpdates,
    ],
    tailoredResumeId,
    tailoredResumeDurationMs: tailoringResult.generationDurationMs,
    tailoredResumeError: tailoringResult.validationError,
  });
}

function buildSourceLatexLinkRecords(
  latexCode: string,
  currentLinks: TailorResumeProfile["links"],
  lockedLinks: TailorResumeLockedLinkRecord[],
) {
  const trackedLinks = mergeTailorResumeLinksWithLockedLinks(
    currentLinks,
    lockedLinks,
    {
      includeLockedOnly: true,
    },
  );

  const parsedLinks = buildTailorResumeLinkRecords({
    existingLinks: trackedLinks,
    extractedLinks: extractTailorResumeTrackedLinks(
      latexCode,
      trackedLinks.filter((link) => link.disabled || link.locked === true),
    ),
    preferExtractedUrls: true,
    preserveUnusedExisting: false,
  });

  return stripTailorResumeLinkLocks(
    mergeTailorResumeLinksWithLockedLinks(parsedLinks, lockedLinks, {
      includeLockedOnly: true,
    }),
  );
}

function buildKnownTailorResumeLinks(
  currentLinks: TailorResumeProfile["links"],
  lockedLinks: TailorResumeLockedLinkRecord[],
) {
  return mergeTailorResumeLinksWithLockedLinks(currentLinks, lockedLinks, {
    includeLockedOnly: true,
  });
}

function readLinkUpdates(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const updates: Array<{ key: string; locked: boolean; url: string | null }> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const key =
      "key" in entry && typeof entry.key === "string" ? entry.key.trim() : "";
    const locked = "locked" in entry ? entry.locked === true : false;
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

    updates.push({ key, locked, url });
  }

  return updates;
}

async function persistExtractedLatexResult(
  userId: string,
  extraction: ExtractResumeLatexDocumentResult,
) {
  const updatedAt = new Date().toISOString();
  const normalized = normalizeAnnotatedLatexState(extraction.latexCode, updatedAt);

  if (extraction.previewPdf) {
    await writeTailorResumePreviewPdf(userId, extraction.previewPdf);

    return {
      annotatedLatex: normalized.annotatedLatex,
      latex: {
        code: normalized.latexCode,
        error: null,
        pdfUpdatedAt: updatedAt,
        status: "ready" as const,
        updatedAt,
      },
    };
  }

  await deleteTailorResumePreviewPdf(userId);

  return {
    annotatedLatex: normalized.annotatedLatex,
    latex: {
      code: normalized.latexCode,
      error: extractTailorResumeActualLatexError(
        extraction.validationError ??
          "Unable to compile the generated LaTeX preview.",
      ),
      pdfUpdatedAt: null,
      status: "failed" as const,
      updatedAt,
    },
  };
}

async function compileLatexDraft(
  userId: string,
  input: {
    compileCode?: string;
    sourceCode: string;
  },
  previousPdfUpdatedAt: string | null,
) {
  const updatedAt = new Date().toISOString();
  const normalizedSource = normalizeAnnotatedLatexState(input.sourceCode, updatedAt);
  const normalizedCompile = normalizeAnnotatedLatexState(
    input.compileCode ?? input.sourceCode,
    updatedAt,
  );

  try {
    const previewPdf = await compileTailorResumeLatex(normalizedCompile.latexCode);

    await writeTailorResumePreviewPdf(userId, previewPdf);

    return {
      annotatedLatex: normalizedSource.annotatedLatex,
      compiledLatexCode: normalizedCompile.latexCode,
      latex: {
        code: normalizedSource.latexCode,
        error: null,
        pdfUpdatedAt: updatedAt,
        status: "ready" as const,
        updatedAt,
      },
    };
  } catch (error) {
    if (!previousPdfUpdatedAt) {
      await deleteTailorResumePreviewPdf(userId);
    }

    return {
      annotatedLatex: normalizedSource.annotatedLatex,
      compiledLatexCode: normalizedCompile.latexCode,
      latex: {
        code: normalizedSource.latexCode,
        error: extractTailorResumeActualLatexError(
          error instanceof Error
            ? error.message
            : "Unable to compile the LaTeX preview.",
        ),
        pdfUpdatedAt: previousPdfUpdatedAt,
        status: "failed" as const,
        updatedAt,
      },
    };
  }
}

async function compileTailoredResumeDraft(
  userId: string,
  tailoredResumeId: string,
  input: {
    compileCode?: string;
    sourceCode: string;
  },
  previousPdfUpdatedAt: string | null,
) {
  const updatedAt = new Date().toISOString();
  const normalizedSource = normalizeAnnotatedLatexState(input.sourceCode, updatedAt);
  const normalizedCompile = normalizeAnnotatedLatexState(
    input.compileCode ?? input.sourceCode,
    updatedAt,
  );

  try {
    const previewPdf = await compileTailorResumeLatex(normalizedCompile.latexCode);

    await writeTailoredResumePdf(userId, tailoredResumeId, previewPdf);

    return {
      annotatedLatex: normalizedSource.annotatedLatex,
      compiledLatexCode: normalizedCompile.latexCode,
      latex: {
        code: normalizedSource.latexCode,
        error: null,
        pdfUpdatedAt: updatedAt,
        status: "ready" as const,
        updatedAt,
      },
    };
  } catch (error) {
    if (!previousPdfUpdatedAt) {
      await deleteTailoredResumePdf(userId, tailoredResumeId);
    }

    return {
      annotatedLatex: normalizedSource.annotatedLatex,
      compiledLatexCode: normalizedCompile.latexCode,
      latex: {
        code: normalizedSource.latexCode,
        error: extractTailorResumeActualLatexError(
          error instanceof Error
            ? error.message
            : "Unable to compile the tailored resume preview.",
        ),
        pdfUpdatedAt: previousPdfUpdatedAt,
        status: "failed" as const,
        updatedAt,
      },
    };
  }
}

async function ensureTailoredResumePreview(input: {
  rawProfile: TailorResumeProfile;
  tailoredResumeId: string;
  userId: string;
}) {
  const tailoredResumeIndex = input.rawProfile.tailoredResumes.findIndex(
    (record) => record.id === input.tailoredResumeId,
  );

  if (tailoredResumeIndex === -1) {
    return null;
  }

  const tailoredResume = input.rawProfile.tailoredResumes[tailoredResumeIndex];
  const repairedTailoredResume = repairTailoredResumeForCompile(tailoredResume).record;

  if (repairedTailoredResume.pdfUpdatedAt) {
    return input.rawProfile;
  }

  const compiledTailoredResume = await compileTailoredResumeDraft(
    input.userId,
    input.tailoredResumeId,
    {
      sourceCode: repairedTailoredResume.annotatedLatexCode,
    },
    repairedTailoredResume.pdfUpdatedAt,
  );
  const nextUpdatedAt = compiledTailoredResume.latex.updatedAt;

  const nextRawProfile: TailorResumeProfile = {
    ...input.rawProfile,
    tailoredResumes: input.rawProfile.tailoredResumes.map((record, index) =>
      index === tailoredResumeIndex
        ? {
            ...repairedTailoredResume,
            annotatedLatexCode: compiledTailoredResume.annotatedLatex.code,
            error: compiledTailoredResume.latex.error,
            latexCode: compiledTailoredResume.latex.code,
            pdfUpdatedAt: compiledTailoredResume.latex.pdfUpdatedAt,
            status: compiledTailoredResume.latex.status,
            updatedAt: nextUpdatedAt,
          }
        : record,
    ),
  };

  await writeTailorResumeProfile(input.userId, nextRawProfile);

  return nextRawProfile;
}

async function runResumeExtraction(
  userId: string,
  input: {
    lockedLinks: TailorResumeLockedLinkRecord[];
    rawProfile: TailorResumeProfile;
  },
  options: {
    onAttemptEvent?: (
      attemptEvent: ExtractResumeLatexDocumentResult["attemptEvents"][number],
    ) => void | Promise<void>;
    preserveUnusedKnownLinks?: boolean;
  } = {},
) {
  const savedResume = input.rawProfile.resume;

  if (!savedResume) {
    throw new Error("Upload a resume before extracting.");
  }

  const extractingProfile: TailorResumeProfile = {
    ...input.rawProfile,
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
      knownLinks: buildKnownTailorResumeLinks(
        input.rawProfile.links,
        input.lockedLinks,
      ),
      onAttemptEvent: options.onAttemptEvent,
      onBuildFailure: (latexCode, error, attempt) =>
        logLatexBuildFailure({
          userId,
          source: tailorResumeDebugErrorSources.extractionCompileFailure,
          latexCode,
          error,
          attempt,
        }),
      preserveUnusedKnownLinks: options.preserveUnusedKnownLinks,
    });
    const persistedLatex = await persistExtractedLatexResult(userId, extraction);

    const readyRawProfile: TailorResumeProfile = {
      ...extractingProfile,
      annotatedLatex: persistedLatex.annotatedLatex,
      extraction: {
        ...emptyTailorResumeExtractionState(),
        error: null,
        model: extraction.model,
        status: "ready",
        updatedAt: new Date().toISOString(),
      },
      latex: persistedLatex.latex,
      links: extraction.resumeLinks,
    };

    await writeTailorResumeProfile(userId, readyRawProfile);
    return {
      extractionAttempts: extraction.attemptEvents,
      linkValidationLinks: extraction.links,
      linkValidationSummary: extraction.linkSummary,
      profile: mergeTailorResumeProfileWithLockedLinks(
        readyRawProfile,
        input.lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      savedLinkUpdateCount: extraction.savedLinkUpdateCount,
      savedLinkUpdates: extraction.savedLinkUpdates,
    };
  } catch (error) {
    const failedRawProfile: TailorResumeProfile = {
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

    await writeTailorResumeProfile(userId, failedRawProfile);
    return {
      extractionAttempts: [],
      linkValidationLinks: [],
      linkValidationSummary: null,
      profile: mergeTailorResumeProfileWithLockedLinks(
        failedRawProfile,
        input.lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      savedLinkUpdateCount: 0,
      savedLinkUpdates: [],
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

  if ("action" in body && body.action === "tailor") {
    return handleTailorResumeGeneration(body as Record<string, unknown>, session.user.id);
  }

  return withTailorResumeProfileLock(session.user.id, async () => {
    const { lockedLinks, profile, rawProfile } = await readTailorResumeProfileState(
      session.user.id,
    );

    if ("action" in body && body.action === "reextract") {
      if (!profile.resume) {
        return NextResponse.json(
          { error: "Upload a resume before extracting." },
          { status: 400 },
        );
      }

      const extractionResult = await runResumeExtraction(session.user.id, {
        lockedLinks,
        rawProfile,
      });
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
    const normalizedUpdates = new Map<
      string,
      {
        locked: boolean;
        url: string | null;
      }
    >();

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
        if (linkUpdate.locked) {
          return NextResponse.json(
            { error: `Cannot lock ${linkUpdate.key} without a URL.` },
            { status: 400 },
          );
        }

        normalizedUpdates.set(linkUpdate.key, {
          locked: false,
          url: null,
        });
        continue;
      }

      const normalizedUrl = normalizeTailorResumeLinkUrl(linkUpdate.url);

      if (!normalizedUrl) {
        return NextResponse.json(
          { error: `Use a valid URL for ${linkUpdate.key}.` },
          { status: 400 },
        );
      }

      normalizedUpdates.set(linkUpdate.key, {
        locked: linkUpdate.locked,
        url: normalizedUrl,
      });
    }

    const updatedAt = new Date().toISOString();
    const updatedLinks = profile.links.map((link) => {
      if (!normalizedUpdates.has(link.key)) {
        return link;
      }

      const update = normalizedUpdates.get(link.key) ?? {
        locked: false,
        url: null,
      };
      const updatedUrl = update.url;

      return {
        ...link,
        disabled: updatedUrl === null,
        locked: updatedUrl === null ? false : update.locked,
        updatedAt,
        url: updatedUrl,
      };
    });
    const nextLockedLinks = readLockedTailorResumeLinksFromLinks(updatedLinks);
    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      links: stripTailorResumeLinkLocks(updatedLinks),
    };

    await replaceTailorResumeLockedLinks(session.user.id, nextLockedLinks);

    const sourceCompileLatex = applyTailorResumeSourceLinkOverridesWithSummary(
      rawProfile.latex.code,
      {
        currentLinks: nextRawProfile.links,
        lockedLinks: nextLockedLinks,
      },
    );

    const compiledLatex = await compileLatexDraft(
      session.user.id,
      {
        compileCode: sourceCompileLatex.latexCode,
        sourceCode: sourceCompileLatex.latexCode,
      },
      rawProfile.latex.pdfUpdatedAt,
    );
    nextRawProfile.annotatedLatex = compiledLatex.annotatedLatex;
    nextRawProfile.latex = compiledLatex.latex;

    let linkValidationLinks: TailorResumeLinkValidationEntry[] = [];
    let linkValidationSummary: TailorResumeLinkValidationSummary | null = null;

    if (nextRawProfile.latex.status === "ready") {
      const validation = await validateLatexLinks(compiledLatex.compiledLatexCode);
      linkValidationLinks = validation.links;
      linkValidationSummary = validation.summary;
    }

    await writeTailorResumeProfile(session.user.id, nextRawProfile);

    const nextProfile = mergeTailorResumeProfileWithLockedLinks(
      nextRawProfile,
      nextLockedLinks,
      {
        includeLockedOnly: true,
      },
    );

    return NextResponse.json({
      extractionAttempts: [],
      extractionError: readExtractionError(nextProfile),
      linkValidationLinks,
      linkValidationSummary,
      profile: nextProfile,
      savedLinkUpdateCount: sourceCompileLatex.updatedCount,
      savedLinkUpdates: sourceCompileLatex.updatedLinks,
    });
  }

  if ("action" in body && body.action === "deleteTailoredResume") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";

    if (!tailoredResumeId) {
      return NextResponse.json(
        { error: "Provide the tailored resume you want to delete." },
        { status: 400 },
      );
    }

    const tailoredResume = rawProfile.tailoredResumes.find(
      (record) => record.id === tailoredResumeId,
    );

    if (!tailoredResume) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    await deleteTailoredResumePdf(session.user.id, tailoredResume.id);

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      tailoredResumes: rawProfile.tailoredResumes.filter(
        (record) => record.id !== tailoredResume.id,
      ),
    };

    await writeTailorResumeProfile(session.user.id, nextRawProfile);

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "renameTailoredResume") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const nextDisplayName =
      "displayName" in body && typeof body.displayName === "string"
        ? body.displayName.trim()
        : "";

    if (!tailoredResumeId || !nextDisplayName) {
      return NextResponse.json(
        { error: "Provide the tailored resume and its next name." },
        { status: 400 },
      );
    }

    if (nextDisplayName.length > maxTailoredResumeDisplayNameLength) {
      return NextResponse.json(
        { error: "Keep the tailored resume name under 200 characters." },
        { status: 413 },
      );
    }

    const tailoredResumeIndex = rawProfile.tailoredResumes.findIndex(
      (record) => record.id === tailoredResumeId,
    );

    if (tailoredResumeIndex === -1) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    const currentTailoredResume = rawProfile.tailoredResumes[tailoredResumeIndex];
    const nextRawProfile: TailorResumeProfile =
      currentTailoredResume.displayName === nextDisplayName
        ? rawProfile
        : {
            ...rawProfile,
            tailoredResumes: rawProfile.tailoredResumes.map((record, index) =>
              index === tailoredResumeIndex
                ? {
                    ...record,
                    displayName: nextDisplayName,
                  }
                : record,
            ),
          };

    if (nextRawProfile !== rawProfile) {
      await writeTailorResumeProfile(session.user.id, nextRawProfile);
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "ensureTailoredResumePreview") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";

    if (!tailoredResumeId) {
      return NextResponse.json(
        { error: "Provide the tailored resume you want to compile." },
        { status: 400 },
      );
    }

    const nextRawProfile = await ensureTailoredResumePreview({
      rawProfile,
      tailoredResumeId,
      userId: session.user.id,
    });

    if (!nextRawProfile) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    const nextTailoredResume = nextRawProfile.tailoredResumes.find(
      (record) => record.id === tailoredResumeId,
    );
    const nextProfile = mergeTailorResumeProfileWithLockedLinks(
      nextRawProfile,
      lockedLinks,
      {
        includeLockedOnly: true,
      },
    );

    return NextResponse.json(
      {
        error: nextTailoredResume?.error,
        profile: nextProfile,
        tailoredResumeId,
      },
      {
        status: nextTailoredResume?.pdfUpdatedAt ? 200 : 422,
      },
    );
  }

  if ("action" in body && body.action === "setTailoredResumeEditState") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const editId =
      "editId" in body && typeof body.editId === "string"
        ? body.editId.trim()
        : "";
    const nextEditState: TailoredResumeBlockEditRecord["state"] | null =
      "state" in body && body.state === "rejected"
        ? "rejected"
        : "state" in body && body.state === "applied"
          ? "applied"
          : null;

    if (!tailoredResumeId || !editId || !nextEditState) {
      return NextResponse.json(
        { error: "Provide a tailored resume, edit, and next state." },
        { status: 400 },
      );
    }

    const tailoredResumeIndex = rawProfile.tailoredResumes.findIndex(
      (record) => record.id === tailoredResumeId,
    );

    if (tailoredResumeIndex === -1) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    const tailoredResume = rawProfile.tailoredResumes[tailoredResumeIndex];
    const nextEdits = updateTailoredResumeEditState({
      editId,
      edits: tailoredResume.edits,
      nextState: nextEditState,
    });

    if (!nextEdits) {
      return NextResponse.json(
        { error: "The tailored resume edit could not be found." },
        { status: 404 },
      );
    }

    const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: tailoredResume.edits,
      sourceAnnotatedLatexCode: tailoredResume.sourceAnnotatedLatexCode,
    });
    const rebuiltAnnotatedLatexCode = rebuildTailoredResumeAnnotatedLatex({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: nextEdits,
      sourceAnnotatedLatexCode,
    });
    const compiledTailoredResume = await compileTailoredResumeDraft(
      session.user.id,
      tailoredResumeId,
      {
        sourceCode: rebuiltAnnotatedLatexCode,
      },
      tailoredResume.pdfUpdatedAt,
    );
    const nextUpdatedAt = compiledTailoredResume.latex.updatedAt;
    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      tailoredResumes: rawProfile.tailoredResumes.map((record, index) =>
        index === tailoredResumeIndex
          ? {
              ...record,
              annotatedLatexCode: compiledTailoredResume.annotatedLatex.code,
              edits: nextEdits,
              error: compiledTailoredResume.latex.error,
              latexCode: compiledTailoredResume.latex.code,
              pdfUpdatedAt: compiledTailoredResume.latex.pdfUpdatedAt,
              sourceAnnotatedLatexCode,
              status: compiledTailoredResume.latex.status,
              updatedAt: nextUpdatedAt,
            }
          : record,
      ),
    };

    await writeTailorResumeProfile(session.user.id, nextRawProfile);

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeEditId: editId,
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "saveTailoredResumeUserEdit") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const segmentId =
      "segmentId" in body && typeof body.segmentId === "string"
        ? body.segmentId.trim()
        : "";
    const latexCode =
      "latexCode" in body && typeof body.latexCode === "string"
        ? body.latexCode
        : null;

    if (!tailoredResumeId || !segmentId || latexCode === null) {
      return NextResponse.json(
        { error: "Provide a tailored resume, segment, and LaTeX block." },
        { status: 400 },
      );
    }

    if (latexCode.length > maxLatexCodeLength) {
      return NextResponse.json(
        { error: "Keep the LaTeX under 300,000 characters." },
        { status: 413 },
      );
    }

    const tailoredResumeIndex = rawProfile.tailoredResumes.findIndex(
      (record) => record.id === tailoredResumeId,
    );

    if (tailoredResumeIndex === -1) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    const tailoredResume = rawProfile.tailoredResumes[tailoredResumeIndex];
    const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: tailoredResume.edits,
      sourceAnnotatedLatexCode: tailoredResume.sourceAnnotatedLatexCode,
    });
    const resolvedSegments = buildTailoredResumeResolvedSegmentMap({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: tailoredResume.edits,
      sourceAnnotatedLatexCode,
    });
    const resolvedSegment = resolvedSegments.get(segmentId);

    if (!resolvedSegment) {
      return NextResponse.json(
        { error: "The selected LaTeX block could not be found." },
        { status: 404 },
      );
    }

    const normalizedReplacementLatexCode = stripTailorResumeSegmentIds(
      normalizeTailorResumeLatex(latexCode).annotatedLatex,
    ).replace(/\n+$/, "");

    if (normalizedReplacementLatexCode.trim()) {
      const replacementSegmentCount =
        normalizeTailorResumeLatex(normalizedReplacementLatexCode).segmentCount;

      if (replacementSegmentCount > 1) {
        return NextResponse.json(
          { error: "Save exactly one logical LaTeX block at a time." },
          { status: 400 },
        );
      }
    }

    const existingEdit = tailoredResume.edits.find((edit) => edit.segmentId === segmentId);

    if (!existingEdit) {
      return NextResponse.json(
        { error: "The selected LaTeX block could not be found in the review timeline." },
        { status: 404 },
      );
    }

    const nextEdits: TailoredResumeBlockEditRecord[] = tailoredResume.edits.map((edit) => {
      if (edit.editId !== existingEdit.editId) {
        return edit;
      }

      if (normalizedReplacementLatexCode === edit.beforeLatexCode) {
        return {
          ...edit,
          customLatexCode: null,
          state: "rejected",
        };
      }

      if (normalizedReplacementLatexCode === edit.afterLatexCode) {
        return {
          ...edit,
          customLatexCode: null,
          state: "applied",
        };
      }

      return {
        ...edit,
        command: resolvedSegment.command,
        customLatexCode: normalizedReplacementLatexCode,
      };
    });
    const rebuiltAnnotatedLatexCode = rebuildTailoredResumeAnnotatedLatex({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: nextEdits,
      sourceAnnotatedLatexCode,
    });
    const compiledTailoredResume = await compileTailoredResumeDraft(
      session.user.id,
      tailoredResumeId,
      {
        sourceCode: rebuiltAnnotatedLatexCode,
      },
      tailoredResume.pdfUpdatedAt,
    );
    const nextUpdatedAt = compiledTailoredResume.latex.updatedAt;
    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      tailoredResumes: rawProfile.tailoredResumes.map((record, index) =>
        index === tailoredResumeIndex
          ? {
              ...record,
              annotatedLatexCode: compiledTailoredResume.annotatedLatex.code,
              edits: nextEdits,
              error: compiledTailoredResume.latex.error,
              latexCode: compiledTailoredResume.latex.code,
              pdfUpdatedAt: compiledTailoredResume.latex.pdfUpdatedAt,
              sourceAnnotatedLatexCode,
              status: compiledTailoredResume.latex.status,
              updatedAt: nextUpdatedAt,
            }
          : record,
      ),
    };

    await writeTailorResumeProfile(session.user.id, nextRawProfile);

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeEditId: existingEdit.editId,
      tailoredResumeId,
    });
  }

  const nextRawProfile: TailorResumeProfile = {
    ...rawProfile,
    extraction: {
      ...rawProfile.extraction,
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
  let savedLinkUpdateCount = 0;
  let savedLinkUpdates: TailorResumeSavedLinkUpdate[] = [];
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

    nextRawProfile.jobDescription = body.jobDescription;
    didUpdate = true;
  }

  if ("baseResumeStepComplete" in body) {
    if (typeof body.baseResumeStepComplete !== "boolean") {
      return NextResponse.json(
        { error: "Provide a boolean step completion value." },
        { status: 400 },
      );
    }

    nextRawProfile.workspace = {
      isBaseResumeStepComplete: body.baseResumeStepComplete,
      updatedAt: new Date().toISOString(),
    };
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

    const normalizedLatexCode = stripTailorResumeSegmentIds(
      normalizeTailorResumeLatex(body.latexCode).annotatedLatex,
    );

    nextRawProfile.links = buildSourceLatexLinkRecords(
      normalizedLatexCode,
      rawProfile.links,
      lockedLinks,
    );
    const sourceCompileLatex = applyTailorResumeSourceLinkOverridesWithSummary(
      normalizedLatexCode,
      {
        currentLinks: nextRawProfile.links,
        lockedLinks,
      },
    );
    const compiledLatex = await compileLatexDraft(
      session.user.id,
      {
        compileCode: sourceCompileLatex.latexCode,
        sourceCode: sourceCompileLatex.latexCode,
      },
      rawProfile.latex.pdfUpdatedAt,
    );
    nextRawProfile.annotatedLatex = compiledLatex.annotatedLatex;
    nextRawProfile.latex = compiledLatex.latex;
    latexLinkSyncSummary = buildLatexLinkSyncSummary(
      profile.links,
      mergeTailorResumeProfileWithLockedLinks(
        {
          ...nextRawProfile,
          links: nextRawProfile.links,
        },
        lockedLinks,
        {
          includeLockedOnly: true,
        },
      ).links,
    );
    savedLinkUpdateCount = sourceCompileLatex.updatedCount;
    savedLinkUpdates = sourceCompileLatex.updatedLinks;
    didUpdate = true;
  }

  if (!didUpdate) {
    return NextResponse.json(
      { error: "No Tailor Resume updates were provided." },
      { status: 400 },
    );
  }

  await writeTailorResumeProfile(session.user.id, nextRawProfile);

  const nextProfile = mergeTailorResumeProfileWithLockedLinks(
    nextRawProfile,
    lockedLinks,
    {
      includeLockedOnly: true,
    },
  );

    return NextResponse.json({
      latexLinkSyncSummary,
      profile: nextProfile,
      savedLinkUpdateCount,
      savedLinkUpdates,
    });
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return withTailorResumeProfileLock(session.user.id, async () => {
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

    const existingState = await readTailorResumeProfileState(session.user.id);
    const previousResumeStoragePath =
      existingState.rawProfile.resume?.storagePath ?? null;
    const persistedResume = await persistUserResume(resumeFile, session.user.id);
    const profileWithSavedResume: TailorResumeProfile = {
      ...existingState.rawProfile,
      annotatedLatex: emptyTailorResumeAnnotatedLatexState(),
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
      tailoredResumes: [],
      workspace: {
        ...emptyTailorResumeWorkspaceState(),
        updatedAt: new Date().toISOString(),
      },
    };

    await writeTailorResumeProfile(session.user.id, profileWithSavedResume);
    await deleteTailorResumePreviewPdf(session.user.id);

    if (wantsTailorResumeUploadStream(request)) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const sendEvent = (event: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          void (async () => {
            try {
              const extractionResult = await runResumeExtraction(
                session.user.id,
                {
                  lockedLinks: existingState.lockedLinks,
                  rawProfile: profileWithSavedResume,
                },
                {
                  onAttemptEvent: (attemptEvent) => {
                    sendEvent({
                      attemptEvent,
                      type: "extraction-attempt",
                    });
                  },
                  preserveUnusedKnownLinks: false,
                },
              );

              if (
                previousResumeStoragePath &&
                previousResumeStoragePath !== persistedResume.storagePath
              ) {
                await deletePersistedUserResume(previousResumeStoragePath);
              }

              sendEvent({
                payload: buildExtractionResponse(extractionResult),
                type: "done",
              });
            } catch (error) {
              sendEvent({
                error:
                  error instanceof Error
                    ? error.message
                    : "Unable to save the resume.",
                type: "error",
              });
            } finally {
              controller.close();
            }
          })();
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/x-ndjson; charset=utf-8",
        },
        status: 200,
      });
    }

    const extractionResult = await runResumeExtraction(
      session.user.id,
      {
        lockedLinks: existingState.lockedLinks,
        rawProfile: profileWithSavedResume,
      },
      {
        preserveUnusedKnownLinks: false,
      },
    );

    if (
      previousResumeStoragePath &&
      previousResumeStoragePath !== persistedResume.storagePath
    ) {
      await deletePersistedUserResume(previousResumeStoragePath);
    }

    return NextResponse.json(buildExtractionResponse(extractionResult));
  });
}
