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
  applyTailoredResumeEditToSourceLatex,
  buildTailoredResumeResolvedSegmentMap,
  rebuildTailoredResumeAnnotatedLatex,
  resolveTailoredResumeSourceAnnotatedLatex,
  updateTailoredResumeEditState,
} from "@/lib/tailor-resume-edit-history";
import { repairTailoredResumeForCompile } from "@/lib/tailored-resume-repair";
import {
  deleteTailoredResumePdf,
  deleteTailorResumePreviewPdf,
  readTailorResumePreviewPdf,
  withTailorResumeProfileLock,
  writeTailoredResumePdf,
  writeTailorResumePreviewPdf,
  writeTailorResumeProfile,
} from "@/lib/tailor-resume-storage";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import { compactTailoredResumePageCount } from "@/lib/tailor-resume-page-count-compaction";
import { buildTailorResumePlanningSnapshot } from "@/lib/tailor-resume-planning";
import { advanceTailorResumeQuestioning } from "@/lib/tailor-resume-questioning";
import { refineTailoredResume } from "@/lib/tailor-resume-refinement";
import {
  implementTailoredResumePlan,
  planTailoredResume,
} from "@/lib/tailor-resume-tailoring";
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
  type TailorResumeGenerationStepEvent,
  type TailorResumePendingInterview,
  type TailorResumeLockedLinkRecord,
  type TailoredResumePlanningResult as TailorResumePlanningResult,
  type TailoredResumeBlockEditRecord,
  type TailorResumeProfile,
  type TailorResumeSavedLinkUpdate,
} from "@/lib/tailor-resume-types";
import {
  systemPromptSettingKeys,
  type SystemPromptSettingKey,
  type SystemPromptSettings,
} from "@/lib/system-prompt-settings";
import type { TailorResumeGenerationSettings } from "@/lib/tailor-resume-generation-settings";
import { countPdfPages } from "@/lib/tailored-resume-preview-snapshots";
import {
  maxTailorResumeUserMarkdownLength,
  readTailorResumeUserMarkdown,
  saveTailorResumeUserMarkdown,
  type TailorResumeUserMarkdownPatchResult,
  type TailorResumeUserMarkdownState,
} from "@/lib/tailor-resume-user-memory";
import {
  assertSupportedResumeFile,
  deletePersistedUserResume,
  persistUserResume,
} from "@/lib/job-tracking";

const maxJobDescriptionLength = 200_000;
const maxLatexCodeLength = 300_000;
const maxTailoredResumeRefinementPreviewImageCount = 6;
const maxTailoredResumeRefinementPromptLength = 8_000;
const maxTailoredResumeDisplayNameLength = 200;
const maxSystemPromptLength = 200_000;

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

function wantsTailorResumeStream(request: Request) {
  return request.headers.get("x-tailor-resume-stream") === "1";
}

function wantsTailorResumeUploadStream(request: Request) {
  return wantsTailorResumeStream(request);
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

function readRefinementPreviewImageDataUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" &&
        /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(entry.trim()),
    )
    .map((entry) => entry.trim())
    .slice(0, maxTailoredResumeRefinementPreviewImageCount);
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

async function persistTailorResumeUserMarkdownPatchResult(input: {
  baseState: TailorResumeUserMarkdownState;
  patchResult: TailorResumeUserMarkdownPatchResult | null;
  userId: string;
}): Promise<
  | {
      ok: true;
      userMarkdown: TailorResumeUserMarkdownState;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  if (
    !input.patchResult ||
    !input.patchResult.ok ||
    !input.patchResult.changed
  ) {
    return {
      ok: true,
      userMarkdown: input.baseState,
    };
  }

  const saveResult = await saveTailorResumeUserMarkdown(
    input.userId,
    input.patchResult.markdown,
    {
      expectedUpdatedAt: input.baseState.updatedAt,
    },
  );

  if (!saveResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "USER.md changed while the tailoring follow-up was running. Review the latest memory and try again.",
          userMarkdown: saveResult.state,
        },
        { status: 409 },
      ),
    };
  }

  return {
    ok: true,
    userMarkdown: saveResult.state,
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

async function readStoredResumePageCount(input: {
  resume: TailorResumeProfile["resume"];
}) {
  if (!input.resume) {
    return null;
  }

  if (input.resume.mimeType !== "application/pdf") {
    return 1;
  }

  const resumePath = path.join(process.cwd(), "public", input.resume.storagePath);
  const resumeBuffer = await readFile(resumePath);
  return countPdfPages(resumeBuffer);
}

async function resolveTailorResumeTargetPageCount(input: {
  baseLatexCode: string;
  resume: TailorResumeProfile["resume"];
  userId: string;
}) {
  try {
    const storedResumePageCount = await readStoredResumePageCount({
      resume: input.resume,
    });

    if (storedResumePageCount && storedResumePageCount > 0) {
      return storedResumePageCount;
    }
  } catch {
    // Fall back to the compiled base resume preview below.
  }

  try {
    return await countPdfPages(await readTailorResumePreviewPdf(input.userId));
  } catch {
    return countPdfPages(await compileTailorResumeLatex(input.baseLatexCode));
  }
}

function buildPageCountLimitLabel(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

function buildTailorResumeConversationMessage(input: {
  role: "assistant" | "user";
  text: string;
}) {
  return {
    id: randomUUID(),
    role: input.role,
    text: input.text.trim(),
  };
}

function buildTailorResumeInterviewQuestionText(input: {
  planningResult: TailorResumePlanningResult;
  question: string;
}) {
  const question = input.question.trim();
  const summary = input.planningResult.questioningSummary;
  const debugSentence =
    summary?.debugDecision === "would_ask_without_debug"
      ? " Debug mode note: I would have asked this even without the forced-conversation override."
      : summary?.debugDecision === "forced_only"
        ? " Debug mode note: I would not normally ask this, but I’m asking because debug mode is forcing at least one follow-up question."
        : "";

  return debugSentence ? `${debugSentence.trim()}\n\n${question}` : question;
}

function readTailorResumeInterviewAttempt(
  summary: TailorResumePlanningResult["questioningSummary"] | null | undefined,
): number | null {
  return typeof summary?.askedQuestionCount === "number"
    ? summary.askedQuestionCount
    : null;
}

function readNextTailorResumeInterviewAttempt(
  summary: TailorResumePlanningResult["questioningSummary"] | null | undefined,
): number {
  const attempt = readTailorResumeInterviewAttempt(summary);
  return attempt === null ? 1 : attempt + 1;
}

type TailorResumeGenerationPreparation =
  | {
      kind: "response";
      response: Response;
    }
  | {
      kind: "ready";
      jobDescription: string;
      lockedLinks: TailorResumeLockedLinkRecord[];
      rawProfile: TailorResumeProfile;
    };

type TailorResumeInterviewPreparation =
  | {
      kind: "response";
      response: Response;
    }
  | {
      kind: "ready";
      lockedLinks: TailorResumeLockedLinkRecord[];
      rawProfile: TailorResumeProfile;
      tailoringInterview: TailorResumePendingInterview;
    };

async function finalizeTailorResumeGeneration(input: {
  clearTailoringInterview?: boolean;
  generationSourceAnnotatedLatex: string;
  generationSourceSnapshot: ReturnType<typeof buildTailorResumeGenerationSourceSnapshot>;
  jobDescription: string;
  lockedLinks: TailorResumeLockedLinkRecord[];
  normalizedBaseLatex: ReturnType<typeof normalizeAnnotatedLatexState>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  processedBaseSavedLinkUpdateCount?: number;
  processedBaseSavedLinkUpdates?: TailorResumeSavedLinkUpdate[];
  rawProfile: TailorResumeProfile;
  tailoringResult: Awaited<ReturnType<typeof implementTailoredResumePlan>>;
  userId: string;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<Response> {
  let tailoringResult = input.tailoringResult;
  let pageCountStepHandled = false;

  if (
    tailoringResult.outcome !== "generation_failure" &&
    tailoringResult.previewPdf
  ) {
    const pageCountStepStartedAt = Date.now();

    try {
      const targetPageCount = await resolveTailorResumeTargetPageCount({
        baseLatexCode: stripTailorResumeSegmentIds(input.generationSourceAnnotatedLatex),
        resume: input.rawProfile.resume,
        userId: input.userId,
      });
      const generatedPageCount = await countPdfPages(tailoringResult.previewPdf);
      const precheckDurationMs = Math.max(0, Date.now() - pageCountStepStartedAt);

      if (!input.rawProfile.generationSettings.values.preventPageCountIncrease) {
        pageCountStepHandled = true;
        await input.onStepEvent?.({
          attempt: null,
          detail:
            generatedPageCount > targetPageCount
              ? `Page-count guard is disabled, so automatic compaction did not run even though the preview expanded to ${buildPageCountLimitLabel(generatedPageCount)}.`
              : `Page-count guard is disabled, and the preview already fits within ${buildPageCountLimitLabel(targetPageCount)}.`,
          durationMs: precheckDurationMs,
          retrying: false,
          status: "skipped",
          stepCount: 4,
          stepNumber: 4,
          summary: "Keeping the tailored resume within the original page count",
        });
      } else if (generatedPageCount <= targetPageCount) {
        pageCountStepHandled = true;
        await input.onStepEvent?.({
          attempt: null,
          detail:
            `The tailored preview stayed within ${buildPageCountLimitLabel(targetPageCount)}, ` +
            "so no further page-count compaction was needed.",
          durationMs: precheckDurationMs,
          retrying: false,
          status: "skipped",
          stepCount: 4,
          stepNumber: 4,
          summary: "Keeping the tailored resume within the original page count",
        });
      } else {
        pageCountStepHandled = true;

        try {
          const compactionResult = await compactTailoredResumePageCount({
            annotatedLatexCode: tailoringResult.annotatedLatexCode,
            edits: tailoringResult.edits,
            initialPageCount: generatedPageCount,
            latexCode: tailoringResult.latexCode,
            onStepEvent: (event) =>
              input.onStepEvent?.({
                ...event,
                durationMs: precheckDurationMs + event.durationMs,
              }),
            previewPdf: tailoringResult.previewPdf,
            promptSettings: input.rawProfile.promptSettings.values,
            sourceAnnotatedLatexCode: input.generationSourceAnnotatedLatex,
            targetPageCount,
            thesis: tailoringResult.thesis,
          });

          tailoringResult = {
            ...tailoringResult,
            annotatedLatexCode: compactionResult.annotatedLatexCode,
            edits: compactionResult.edits,
            generationDurationMs:
              tailoringResult.generationDurationMs +
              compactionResult.generationDurationMs,
            latexCode: compactionResult.latexCode,
            model: compactionResult.model,
            previewPdf: compactionResult.previewPdf,
            validationError: null,
          };
        } catch (error) {
          tailoringResult = {
            ...tailoringResult,
            outcome: "generation_failure",
            validationError:
              error instanceof Error
                ? error.message
                : "Unable to keep the tailored resume within the original page count.",
          };
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to compare the tailored resume page count.";
      const durationMs = Math.max(0, Date.now() - pageCountStepStartedAt);

      pageCountStepHandled = true;

      if (input.rawProfile.generationSettings.values.preventPageCountIncrease) {
        await input.onStepEvent?.({
          attempt: null,
          detail:
            `Page-count verification could not be completed, so step 4 did not run: ${errorMessage}`,
          durationMs,
          retrying: false,
          status: "skipped",
          stepCount: 4,
          stepNumber: 4,
          summary: "Keeping the tailored resume within the original page count",
        });
        tailoringResult = {
          ...tailoringResult,
          outcome: "generation_failure",
          validationError: errorMessage,
        };
      } else {
        await input.onStepEvent?.({
          attempt: null,
          detail:
            `Page-count guard is disabled, and page-count verification could not be completed: ${errorMessage}`,
          durationMs,
          retrying: false,
          status: "skipped",
          stepCount: 4,
          stepNumber: 4,
          summary: "Keeping the tailored resume within the original page count",
        });
      }
    }
  } else if (tailoringResult.outcome !== "generation_failure") {
    pageCountStepHandled = true;
    await input.onStepEvent?.({
      attempt: null,
      detail:
        "Skipped page-count validation because the current tailored draft did not compile to a preview PDF yet.",
      durationMs: 0,
      retrying: false,
      status: "skipped",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });
  }

  if (tailoringResult.outcome === "generation_failure") {
    if (!pageCountStepHandled) {
      await input.onStepEvent?.({
        attempt: null,
        detail:
          "Skipped page-count validation because block-scoped edits never produced a valid preview PDF.",
        durationMs: 0,
        retrying: false,
        status: "skipped",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
    }

    if (
      input.rawProfile.jobDescription !== input.jobDescription ||
      input.clearTailoringInterview
    ) {
      await withTailorResumeProfileLock(input.userId, async () => {
        const latestState = await readTailorResumeProfileState(input.userId);
        let nextRawProfile = mergeTailorResumeFailedGeneration({
          currentRawProfile: latestState.rawProfile,
          jobDescription: input.jobDescription,
          snapshotRawProfile: input.rawProfile,
        });

        if (input.clearTailoringInterview) {
          nextRawProfile = {
            ...nextRawProfile,
            workspace: {
              ...nextRawProfile.workspace,
              tailoringInterview: null,
              updatedAt: new Date().toISOString(),
            },
          };
        }

        if (nextRawProfile !== latestState.rawProfile) {
          await writeTailorResumeProfile(input.userId, nextRawProfile);
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
        userMarkdown: input.userMarkdown,
      },
      { status: 422 },
    );
  }

  const tailoredResumeId = randomUUID();
  const tailoredResumeUpdatedAt = new Date().toISOString();
  const nextState = await withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);

    if (
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: input.generationSourceSnapshot,
      })
    ) {
      return null;
    }

    if (tailoringResult.previewPdf) {
      await writeTailoredResumePdf(
        input.userId,
        tailoredResumeId,
        tailoringResult.previewPdf,
      );
    } else {
      await deleteTailoredResumePdf(input.userId, tailoredResumeId);
    }

    const mergedRawProfile = mergeTailorResumeSuccessfulGeneration({
      annotatedLatex: input.normalizedBaseLatex.annotatedLatex,
      currentRawProfile: latestState.rawProfile,
      jobDescription: input.jobDescription,
      snapshotRawProfile: input.rawProfile,
      tailoredResume: {
        annotatedLatexCode: tailoringResult.annotatedLatexCode,
        companyName: tailoringResult.companyName,
        createdAt: tailoredResumeUpdatedAt,
        displayName: tailoringResult.displayName,
        edits: tailoringResult.edits,
        error: tailoringResult.validationError,
        id: tailoredResumeId,
        jobDescription: input.jobDescription,
        jobIdentifier: tailoringResult.jobIdentifier,
        latexCode: tailoringResult.latexCode,
        openAiDebug: tailoringResult.openAiDebug,
        pdfUpdatedAt: tailoringResult.previewPdf ? tailoredResumeUpdatedAt : null,
        planningResult: tailoringResult.planningResult,
        positionTitle: tailoringResult.positionTitle,
        sourceAnnotatedLatexCode: input.generationSourceAnnotatedLatex,
        status: tailoringResult.previewPdf ? "ready" : "failed",
        thesis: tailoringResult.thesis,
        updatedAt: tailoredResumeUpdatedAt,
      },
    });
    const nextRawProfile = input.clearTailoringInterview
      ? {
          ...mergedRawProfile,
          workspace: {
            ...mergedRawProfile.workspace,
            tailoringInterview: null,
            updatedAt: new Date().toISOString(),
          },
        }
      : mergedRawProfile;

    await writeTailorResumeProfile(input.userId, nextRawProfile);

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
        userMarkdown: input.userMarkdown,
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
      (input.processedBaseSavedLinkUpdateCount ?? 0) +
      tailoringResult.savedLinkUpdateCount,
    savedLinkUpdates: [
      ...(input.processedBaseSavedLinkUpdates ?? []),
      ...tailoringResult.savedLinkUpdates,
    ],
    tailoredResumeId,
    tailoredResumeDurationMs: tailoringResult.generationDurationMs,
    tailoredResumeError: tailoringResult.validationError,
    userMarkdown: input.userMarkdown,
  });
}

async function handleTailorResumeGeneration(
  body: Record<string, unknown>,
  userId: string,
  options: {
    onStepEvent?: (
      event: TailorResumeGenerationStepEvent,
    ) => void | Promise<void>;
  } = {},
): Promise<Response> {
  const preparation: TailorResumeGenerationPreparation =
    await withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, profile, rawProfile } = await readTailorResumeProfileState(
      userId,
    );
    if (rawProfile.workspace.tailoringInterview) {
      return {
        kind: "response",
        response: NextResponse.json({
          profile,
          tailoringStatus: "needs_user_input" as const,
        }),
      };
    }

    const jobDescription =
      typeof body.jobDescription === "string"
        ? body.jobDescription
        : profile.jobDescription;

    if (!profile.latex.code.trim()) {
      return {
        kind: "response",
        response: NextResponse.json(
          { error: "Upload or save a base resume before tailoring it." },
          { status: 400 },
        ),
      };
    }

    if (!jobDescription.trim()) {
      return {
        kind: "response",
        response: NextResponse.json(
          { error: "Paste a job description before tailoring the resume." },
          { status: 400 },
        ),
      };
    }

    return {
      kind: "ready",
      jobDescription,
      lockedLinks,
      rawProfile,
    };
    });

  if (preparation.kind === "response") {
    return preparation.response!;
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
  const generationSourceAnnotatedLatex = normalizeTailorResumeLatex(
    processedBaseAnnotatedLatex.latexCode,
  ).annotatedLatex;
  const generationSourceSnapshot = buildTailorResumeGenerationSourceSnapshot(
    preparation.rawProfile,
    preparation.lockedLinks,
  );
  const planningStage = await planTailoredResume({
    annotatedLatexCode: processedBaseAnnotatedLatex.latexCode,
    jobDescription: preparation.jobDescription,
    onStepEvent: options.onStepEvent,
    promptSettings: preparation.rawProfile.promptSettings.values,
  });

  if (!planningStage.ok) {
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
      planningStage.attempts === 1 ? "attempt" : "attempts";
    const failureMessage = planningStage.validationError.trim()
      ? `Unable to generate a valid tailored resume after ${planningStage.attempts} ${attemptLabel}: ${planningStage.validationError}`
      : `Unable to generate a valid tailored resume after ${planningStage.attempts} ${attemptLabel}.`;

    return NextResponse.json(
      {
        error: failureMessage,
        tailoredResumeDurationMs: planningStage.generationDurationMs,
      },
      { status: 422 },
    );
  }

  let planningResult = planningStage.planningResult;
  let accumulatedModelDurationMs = planningStage.generationDurationMs;
  let userMarkdownAfterQuestioning: TailorResumeUserMarkdownState | undefined;
  if (planningResult.changes.length > 0) {
    const questioningStartedAt = Date.now();
    const userMarkdownBeforeQuestioning = await readTailorResumeUserMarkdown(userId);
    let questioningResult: Awaited<ReturnType<typeof advanceTailorResumeQuestioning>>;

    try {
      questioningResult = await advanceTailorResumeQuestioning({
        conversation: [],
        jobDescription: preparation.jobDescription,
        planningResult,
        planningSnapshot: planningStage.planningSnapshot,
        promptSettings: preparation.rawProfile.promptSettings.values,
        userMarkdown: userMarkdownBeforeQuestioning,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to determine whether follow-up questions are needed.";
      const durationMs = Math.max(0, Date.now() - questioningStartedAt);

      await options.onStepEvent?.({
        attempt: 1,
        detail: errorMessage,
        durationMs,
        retrying: false,
        status: "failed",
        stepCount: 4,
        stepNumber: 2,
        summary: "Preparing follow-up question for the user",
      });

      return NextResponse.json(
        {
          error: `Unable to continue tailoring after generating the plaintext outline: ${errorMessage}`,
          tailoredResumeDurationMs: accumulatedModelDurationMs + durationMs,
        },
        { status: 422 },
      );
    }

    accumulatedModelDurationMs += questioningResult.generationDurationMs;
    const userMarkdownSaveResult =
      await persistTailorResumeUserMarkdownPatchResult({
        baseState: userMarkdownBeforeQuestioning,
        patchResult: questioningResult.userMarkdownPatchResult,
        userId,
      });

    if (!userMarkdownSaveResult.ok) {
      return userMarkdownSaveResult.response;
    }

    userMarkdownAfterQuestioning = userMarkdownSaveResult.userMarkdown;
    if (questioningResult.action === "ask") {
      await options.onStepEvent?.({
        attempt: 1,
        detail:
          "A follow-up question is ready, so step 2 is waiting for the user's answer before the remaining generation steps start.",
        durationMs: Math.max(0, Date.now() - questioningStartedAt),
        retrying: false,
        status: "running",
        stepCount: 4,
        stepNumber: 2,
        summary: "Waiting for a follow-up answer from the user",
      });
      planningResult = {
        ...planningResult,
        questioningSummary: questioningResult.questioningSummary,
      };
      const pendingInterview: TailorResumePendingInterview = {
        accumulatedModelDurationMs,
        conversation: [
          buildTailorResumeConversationMessage({
            role: "assistant",
            text: buildTailorResumeInterviewQuestionText({
              planningResult,
              question: questioningResult.question,
            }),
          }),
        ],
        createdAt: new Date().toISOString(),
        generationSourceSnapshot,
        id: randomUUID(),
        jobDescription: preparation.jobDescription,
        planningDebug: planningStage.planningDebug,
        planningResult,
        sourceAnnotatedLatexCode: generationSourceAnnotatedLatex,
        updatedAt: new Date().toISOString(),
      };
      const nextState = await withTailorResumeProfileLock(userId, async () => {
        const latestState = await readTailorResumeProfileState(userId);

        if (
          hasTailorResumeGenerationSourceChanged({
            currentLockedLinks: latestState.lockedLinks,
            currentRawProfile: latestState.rawProfile,
            snapshot: generationSourceSnapshot,
          }) ||
          latestState.rawProfile.workspace.tailoringInterview
        ) {
          return null;
        }

        const nextRawProfile: TailorResumeProfile = {
          ...latestState.rawProfile,
          jobDescription:
            latestState.rawProfile.jobDescription ===
            preparation.rawProfile.jobDescription
              ? preparation.jobDescription
              : latestState.rawProfile.jobDescription,
          workspace: {
            ...latestState.rawProfile.workspace,
            tailoringInterview: pendingInterview,
            updatedAt: new Date().toISOString(),
          },
        };

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
              "The base resume changed while the follow-up questions were being prepared. Review the latest resume and try again.",
            tailoredResumeDurationMs: accumulatedModelDurationMs,
            userMarkdown: userMarkdownAfterQuestioning,
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        profile: mergeTailorResumeProfileWithLockedLinks(
          nextState.rawProfile,
          nextState.lockedLinks,
          {
            includeLockedOnly: true,
          },
        ),
        tailoredResumeDurationMs: accumulatedModelDurationMs,
        tailoringStatus: "needs_user_input" as const,
        userMarkdown: userMarkdownAfterQuestioning,
      });
    }

    if (questioningResult.questioningSummary) {
      planningResult = {
        ...planningResult,
        questioningSummary: questioningResult.questioningSummary,
      };
    }

    await options.onStepEvent?.({
      attempt: 1,
      detail: "No follow-up question was needed, so generation can continue immediately.",
      durationMs: Math.max(0, Date.now() - questioningStartedAt),
      retrying: false,
      status: "skipped",
      stepCount: 4,
      stepNumber: 2,
      summary: "No need to ask the user any follow-up questions",
    });
  } else {
    await options.onStepEvent?.({
      attempt: null,
      detail: "The planner did not propose any editable blocks, so no follow-up question was needed.",
      durationMs: 0,
      retrying: false,
      status: "skipped",
      stepCount: 4,
      stepNumber: 2,
      summary: "No need to ask the user any follow-up questions",
    });
  }

  const tailoringResult = await implementTailoredResumePlan({
    annotatedLatexCode: processedBaseAnnotatedLatex.latexCode,
    generationDurationMsBase: accumulatedModelDurationMs,
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
    onStepEvent: options.onStepEvent,
    planningDebug: planningStage.planningDebug,
    planningResult,
    planningSnapshot: planningStage.planningSnapshot,
    promptSettings: preparation.rawProfile.promptSettings.values,
  });

  return finalizeTailorResumeGeneration({
    generationSourceAnnotatedLatex,
    generationSourceSnapshot,
    jobDescription: preparation.jobDescription,
    lockedLinks: preparation.lockedLinks,
    normalizedBaseLatex,
    onStepEvent: options.onStepEvent,
    processedBaseSavedLinkUpdateCount: processedBaseAnnotatedLatex.updatedCount,
    processedBaseSavedLinkUpdates: processedBaseAnnotatedLatex.updatedLinks,
    rawProfile: preparation.rawProfile,
    tailoringResult,
    userId,
    userMarkdown: userMarkdownAfterQuestioning,
  });
}

async function handleAdvanceTailorResumeInterview(
  body: Record<string, unknown>,
  userId: string,
  options: {
    onStepEvent?: (
      event: TailorResumeGenerationStepEvent,
    ) => void | Promise<void>;
  } = {},
): Promise<Response> {
  const interviewId =
    typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";

  if (!interviewId) {
    return NextResponse.json(
      { error: "Provide the tailoring interview id." },
      { status: 400 },
    );
  }

  if (!answer) {
    return NextResponse.json(
      { error: "Answer the current follow-up question first." },
      { status: 400 },
    );
  }

  const preparation: TailorResumeInterviewPreparation =
    await withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);
    const tailoringInterview = rawProfile.workspace.tailoringInterview;

    if (!tailoringInterview) {
      return {
        kind: "response",
        response: NextResponse.json(
          { error: "There is no active tailoring interview to continue." },
          { status: 409 },
        ),
      };
    }

    if (tailoringInterview.id !== interviewId) {
      return {
        kind: "response",
        response: NextResponse.json(
          {
            error:
              "The active tailoring interview changed. Reopen the latest follow-up questions and try again.",
          },
          { status: 409 },
        ),
      };
    }

    return {
      kind: "ready",
      lockedLinks,
      rawProfile,
      tailoringInterview,
    };
    });

  if (preparation.kind === "response") {
    return preparation.response!;
  }

  const nextConversation = [
    ...preparation.tailoringInterview.conversation,
    buildTailorResumeConversationMessage({
      role: "user",
      text: answer,
    }),
  ];
  const planningSnapshot = buildTailorResumePlanningSnapshot(
    preparation.tailoringInterview.sourceAnnotatedLatexCode,
  );
  const questioningStartedAt = Date.now();
  const userMarkdownBeforeQuestioning = await readTailorResumeUserMarkdown(userId);
  let questioningResult: Awaited<ReturnType<typeof advanceTailorResumeQuestioning>>;

  try {
    questioningResult = await advanceTailorResumeQuestioning({
      conversation: nextConversation,
      jobDescription: preparation.tailoringInterview.jobDescription,
      planningResult: preparation.tailoringInterview.planningResult,
      planningSnapshot,
      promptSettings: preparation.rawProfile.promptSettings.values,
      userMarkdown: userMarkdownBeforeQuestioning,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unable to continue the tailoring follow-up questions.";

    await options.onStepEvent?.({
      attempt: readTailorResumeInterviewAttempt(
        preparation.tailoringInterview.planningResult.questioningSummary,
      ),
      detail: errorMessage,
      durationMs: Math.max(0, Date.now() - questioningStartedAt),
      retrying: false,
      status: "failed",
      stepCount: 4,
      stepNumber: 2,
      summary: "Continuing the follow-up questions",
    });

    return NextResponse.json(
      {
        error: errorMessage,
        tailoredResumeDurationMs:
          preparation.tailoringInterview.accumulatedModelDurationMs,
      },
      { status: 422 },
    );
  }

  const accumulatedModelDurationMs =
    preparation.tailoringInterview.accumulatedModelDurationMs +
    questioningResult.generationDurationMs;
  const userMarkdownSaveResult =
    await persistTailorResumeUserMarkdownPatchResult({
      baseState: userMarkdownBeforeQuestioning,
      patchResult: questioningResult.userMarkdownPatchResult,
      userId,
    });

  if (!userMarkdownSaveResult.ok) {
    return userMarkdownSaveResult.response;
  }

  const userMarkdownAfterQuestioning = userMarkdownSaveResult.userMarkdown;

  if (questioningResult.action === "ask") {
    await options.onStepEvent?.({
      attempt: readNextTailorResumeInterviewAttempt(
        preparation.tailoringInterview.planningResult.questioningSummary,
      ),
      detail:
        "One more follow-up question is ready, so step 2 is still waiting for the user's answer.",
      durationMs: questioningResult.generationDurationMs,
      retrying: false,
      status: "running",
      stepCount: 4,
      stepNumber: 2,
      summary: "Waiting for another follow-up answer from the user",
    });
    const nextPlanningResult: TailorResumePlanningResult = {
      ...preparation.tailoringInterview.planningResult,
      questioningSummary: questioningResult.questioningSummary,
    };
    const nextInterview: TailorResumePendingInterview = {
      ...preparation.tailoringInterview,
      accumulatedModelDurationMs,
      conversation: [
        ...nextConversation,
        buildTailorResumeConversationMessage({
          role: "assistant",
          text: buildTailorResumeInterviewQuestionText({
            planningResult: nextPlanningResult,
            question: questioningResult.question,
          }),
        }),
      ],
      planningResult: nextPlanningResult,
      updatedAt: new Date().toISOString(),
    };
    const nextState = await withTailorResumeProfileLock(userId, async () => {
      const latestState = await readTailorResumeProfileState(userId);
      const latestInterview = latestState.rawProfile.workspace.tailoringInterview;

      if (
        !latestInterview ||
        latestInterview.id !== interviewId ||
        hasTailorResumeGenerationSourceChanged({
          currentLockedLinks: latestState.lockedLinks,
          currentRawProfile: latestState.rawProfile,
          snapshot: preparation.tailoringInterview.generationSourceSnapshot,
        })
      ) {
        return null;
      }

      const nextRawProfile: TailorResumeProfile = {
        ...latestState.rawProfile,
        workspace: {
          ...latestState.rawProfile.workspace,
          tailoringInterview: nextInterview,
          updatedAt: new Date().toISOString(),
        },
      };

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
            "The base resume changed while the follow-up questions were in progress. Review the latest resume and try again.",
          tailoredResumeDurationMs: accumulatedModelDurationMs,
          userMarkdown: userMarkdownAfterQuestioning,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(
        nextState.rawProfile,
        nextState.lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      tailoredResumeDurationMs: accumulatedModelDurationMs,
      tailoringStatus: "needs_user_input" as const,
      userMarkdown: userMarkdownAfterQuestioning,
    });
  }

  await options.onStepEvent?.({
    attempt: readTailorResumeInterviewAttempt(
      preparation.tailoringInterview.planningResult.questioningSummary,
    ),
    detail:
      "Collected enough user context, so generation can continue without asking anything else.",
    durationMs: questioningResult.generationDurationMs,
    retrying: false,
    status: "succeeded",
    stepCount: 4,
    stepNumber: 2,
    summary: "Finishing the follow-up questions",
  });

  const finalizedPlanningResult: TailorResumePlanningResult = {
    ...preparation.tailoringInterview.planningResult,
    questioningSummary: questioningResult.questioningSummary,
  };
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
  const generationSourceAnnotatedLatex = normalizeTailorResumeLatex(
    processedBaseAnnotatedLatex.latexCode,
  ).annotatedLatex;
  const tailoringResult = await implementTailoredResumePlan({
    annotatedLatexCode: preparation.tailoringInterview.sourceAnnotatedLatexCode,
    generationDurationMsBase: accumulatedModelDurationMs,
    jobDescription: preparation.tailoringInterview.jobDescription,
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
    onStepEvent: options.onStepEvent,
    planningDebug: preparation.tailoringInterview.planningDebug,
    planningResult: finalizedPlanningResult,
    planningSnapshot,
    promptSettings: preparation.rawProfile.promptSettings.values,
  });

  return finalizeTailorResumeGeneration({
    clearTailoringInterview: true,
    generationSourceAnnotatedLatex,
    generationSourceSnapshot: preparation.tailoringInterview.generationSourceSnapshot,
    jobDescription: preparation.tailoringInterview.jobDescription,
    lockedLinks: preparation.lockedLinks,
    normalizedBaseLatex,
    onStepEvent: options.onStepEvent,
    processedBaseSavedLinkUpdateCount: processedBaseAnnotatedLatex.updatedCount,
    processedBaseSavedLinkUpdates: processedBaseAnnotatedLatex.updatedLinks,
    rawProfile: preparation.rawProfile,
    tailoringResult,
    userId,
    userMarkdown: userMarkdownAfterQuestioning,
  });
}

async function handleCancelTailorResumeInterview(userId: string) {
  return withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);

    if (!rawProfile.workspace.tailoringInterview) {
      return NextResponse.json(
        { error: "There is no active tailoring interview to cancel." },
        { status: 409 },
      );
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      workspace: {
        ...rawProfile.workspace,
        tailoringInterview: null,
        updatedAt: new Date().toISOString(),
      },
    };

    await writeTailorResumeProfile(userId, nextRawProfile);

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(
        nextRawProfile,
        lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
    });
  });
}

function buildTailorResumeGenerationStreamResponse(
  run: (
    onStepEvent: (
      event: TailorResumeGenerationStepEvent,
    ) => void | Promise<void>,
  ) => Promise<Response | undefined>,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          const response = await run((stepEvent) => {
            sendEvent({
              stepEvent,
              type: "generation-step",
            });
          });

          if (!response) {
            throw new Error("Tailor Resume generation did not return a response.");
          }

          const payload = (await response.json()) as Record<string, unknown>;

          sendEvent({
            ok: response.ok,
            payload,
            status: response.status,
            type: "done",
          });
        } catch (error) {
          sendEvent({
            error:
              error instanceof Error
                ? error.message
                : "Unable to tailor the resume.",
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

function readPromptSettingsUpdates(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawUpdates = value as Partial<Record<SystemPromptSettingKey, unknown>>;
  const updates: Partial<SystemPromptSettings> = {};
  let changeCount = 0;

  for (const key of systemPromptSettingKeys) {
    const nextValue = rawUpdates[key];

    if (typeof nextValue !== "string") {
      continue;
    }

    if (nextValue.length > maxSystemPromptLength) {
      throw new Error(
        `Keep the ${key} prompt under ${maxSystemPromptLength.toLocaleString()} characters.`,
      );
    }

    updates[key] = nextValue;
    changeCount += 1;
  }

  if (changeCount === 0) {
    return null;
  }

  return updates;
}

function readGenerationSettingsUpdates(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawUpdates = value as Partial<
    Record<keyof TailorResumeGenerationSettings, unknown>
  >;
  const updates: Partial<TailorResumeGenerationSettings> = {};
  let changeCount = 0;

  if (typeof rawUpdates.preventPageCountIncrease === "boolean") {
    updates.preventPageCountIncrease = rawUpdates.preventPageCountIncrease;
    changeCount += 1;
  }

  if (changeCount === 0) {
    return null;
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
      promptSettings: input.rawProfile.promptSettings.values,
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
    if (wantsTailorResumeStream(request)) {
      return buildTailorResumeGenerationStreamResponse((onStepEvent) =>
        handleTailorResumeGeneration(body as Record<string, unknown>, session.user.id, {
          onStepEvent,
        }),
      );
    }

    return handleTailorResumeGeneration(body as Record<string, unknown>, session.user.id);
  }

  if ("action" in body && body.action === "advanceTailorResumeInterview") {
    if (wantsTailorResumeStream(request)) {
      return buildTailorResumeGenerationStreamResponse((onStepEvent) =>
        handleAdvanceTailorResumeInterview(
          body as Record<string, unknown>,
          session.user.id,
          {
            onStepEvent,
          },
        ),
      );
    }

    return handleAdvanceTailorResumeInterview(
      body as Record<string, unknown>,
      session.user.id,
    );
  }

  if ("action" in body && body.action === "cancelTailorResumeInterview") {
    return handleCancelTailorResumeInterview(session.user.id);
  }

  if ("action" in body && body.action === "saveUserMarkdown") {
    const markdown = "markdown" in body ? body.markdown : null;
    const expectedUpdatedAt =
      "updatedAt" in body
        ? typeof body.updatedAt === "string"
          ? body.updatedAt
          : body.updatedAt === null
            ? null
            : undefined
        : undefined;

    if (typeof markdown !== "string") {
      return NextResponse.json(
        { error: "Provide USER.md markdown to save." },
        { status: 400 },
      );
    }

    if (markdown.length > maxTailorResumeUserMarkdownLength) {
      return NextResponse.json(
        {
          error: `Keep USER.md under ${maxTailorResumeUserMarkdownLength.toLocaleString()} characters.`,
        },
        { status: 413 },
      );
    }

    let saveResult: Awaited<ReturnType<typeof saveTailorResumeUserMarkdown>>;

    try {
      saveResult = await saveTailorResumeUserMarkdown(
        session.user.id,
        markdown,
        expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt },
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to save USER.md.",
        },
        { status: 413 },
      );
    }

    if (!saveResult.ok) {
      return NextResponse.json(
        {
          error:
            "USER.md changed since you opened it. Review the latest version before saving.",
          userMarkdown: saveResult.state,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      userMarkdown: saveResult.state,
    });
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

    if ("action" in body && body.action === "savePromptSettings") {
      let promptSettingsUpdates: Partial<SystemPromptSettings> | null = null;

      try {
        promptSettingsUpdates = readPromptSettingsUpdates(
          "promptSettings" in body ? body.promptSettings : null,
        );
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Unable to save the prompt settings.",
          },
          { status: 413 },
        );
      }

      if (!promptSettingsUpdates) {
        return NextResponse.json(
          { error: "Provide at least one prompt setting to save." },
          { status: 400 },
        );
      }

      const nextRawProfile: TailorResumeProfile = {
        ...rawProfile,
        promptSettings: {
          updatedAt: new Date().toISOString(),
          values: {
            ...rawProfile.promptSettings.values,
            ...promptSettingsUpdates,
          },
        },
      };

      await writeTailorResumeProfile(session.user.id, nextRawProfile);

      return NextResponse.json({
        profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
          includeLockedOnly: true,
        }),
      });
    }

    if ("action" in body && body.action === "saveGenerationSettings") {
      const generationSettingsUpdates = readGenerationSettingsUpdates(
        "generationSettings" in body ? body.generationSettings : null,
      );

      if (!generationSettingsUpdates) {
        return NextResponse.json(
          { error: "Provide at least one generation setting to save." },
          { status: 400 },
        );
      }

      const nextRawProfile: TailorResumeProfile = {
        ...rawProfile,
        generationSettings: {
          updatedAt: new Date().toISOString(),
          values: {
            ...rawProfile.generationSettings.values,
            ...generationSettingsUpdates,
          },
        },
      };

      await writeTailorResumeProfile(session.user.id, nextRawProfile);

      return NextResponse.json({
        profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
          includeLockedOnly: true,
        }),
      });
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

  if ("action" in body && body.action === "applyTailoredResumeEditToSourceResume") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const editId =
      "editId" in body && typeof body.editId === "string"
        ? body.editId.trim()
        : "";

    if (!tailoredResumeId || !editId) {
      return NextResponse.json(
        { error: "Provide the tailored resume edit to apply to the source resume." },
        { status: 400 },
      );
    }

    if (!rawProfile.latex.code.trim()) {
      return NextResponse.json(
        { error: "Upload or save a source resume before applying this edit." },
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

    const sourceEdit = tailoredResume.edits.find((edit) => edit.editId === editId);

    if (!sourceEdit) {
      return NextResponse.json(
        { error: "The tailored resume edit could not be found." },
        { status: 404 },
      );
    }

    const sourceEditResult = applyTailoredResumeEditToSourceLatex({
      beforeLatexCode: sourceEdit.beforeLatexCode,
      replacementLatexCode: sourceEdit.customLatexCode ?? sourceEdit.afterLatexCode,
      segmentId: sourceEdit.segmentId,
      sourceLatexCode: rawProfile.latex.code,
    });

    if (!sourceEditResult.ok) {
      const error =
        sourceEditResult.reason === "segment_not_found"
          ? "The matching block could not be found in the source resume."
          : sourceEditResult.reason === "source_block_changed"
            ? "The matching source resume block has changed since this tailored resume was created. Review the source resume or create a fresh tailored resume before applying this edit."
            : sourceEditResult.reason === "multiple_replacement_segments"
              ? "This edit no longer maps to exactly one source resume block."
              : "This edit does not contain a source resume replacement.";
      const status =
        sourceEditResult.reason === "segment_not_found"
          ? 404
          : sourceEditResult.reason === "source_block_changed"
            ? 409
            : 400;

      return NextResponse.json({ error }, { status });
    }

    if (sourceEditResult.latexCode.length > maxLatexCodeLength) {
      return NextResponse.json(
        { error: "Keep the LaTeX under 300,000 characters." },
        { status: 413 },
      );
    }

    if (!sourceEditResult.changed) {
      return NextResponse.json({
        profile: mergeTailorResumeProfileWithLockedLinks(rawProfile, lockedLinks, {
          includeLockedOnly: true,
        }),
        sourceResumeEdit: {
          changed: false,
          editId,
          tailoredResumeId,
        },
      });
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      links: buildSourceLatexLinkRecords(
        sourceEditResult.latexCode,
        rawProfile.links,
        lockedLinks,
      ),
    };
    const sourceCompileLatex = applyTailorResumeSourceLinkOverridesWithSummary(
      sourceEditResult.latexCode,
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

    await writeTailorResumeProfile(session.user.id, nextRawProfile);

    const nextProfile = mergeTailorResumeProfileWithLockedLinks(
      nextRawProfile,
      lockedLinks,
      {
        includeLockedOnly: true,
      },
    );

    return NextResponse.json({
      latexLinkSyncSummary: buildLatexLinkSyncSummary(profile.links, nextProfile.links),
      profile: nextProfile,
      savedLinkUpdateCount: sourceCompileLatex.updatedCount,
      savedLinkUpdates: sourceCompileLatex.updatedLinks,
      sourceResumeEdit: {
        changed: true,
        editId,
        tailoredResumeId,
      },
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

  if ("action" in body && body.action === "refineTailoredResume") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const userPrompt =
      "userPrompt" in body && typeof body.userPrompt === "string"
        ? body.userPrompt.trim()
        : "";
    const previewImageDataUrls = readRefinementPreviewImageDataUrls(
      "previewImageDataUrls" in body ? body.previewImageDataUrls : null,
    );

    if (!tailoredResumeId || !userPrompt) {
      return NextResponse.json(
        { error: "Provide the tailored resume and how you want the edits changed." },
        { status: 400 },
      );
    }

    if (userPrompt.length > maxTailoredResumeRefinementPromptLength) {
      return NextResponse.json(
        {
          error: `Keep the AI follow-up request under ${maxTailoredResumeRefinementPromptLength.toLocaleString()} characters.`,
        },
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

    if (tailoredResume.edits.length === 0) {
      return NextResponse.json(
        { error: "This tailored resume does not have model edits to refine yet." },
        { status: 400 },
      );
    }

    const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex({
      annotatedLatexCode: tailoredResume.annotatedLatexCode,
      edits: tailoredResume.edits,
      sourceAnnotatedLatexCode: tailoredResume.sourceAnnotatedLatexCode,
    });

    try {
      const refinementResult = await refineTailoredResume({
        edits: tailoredResume.edits,
        previewImageDataUrls,
        promptSettings: rawProfile.promptSettings.values,
        sourceAnnotatedLatexCode,
        thesis: tailoredResume.thesis,
        userPrompt,
      });
      const nextUpdatedAt = new Date().toISOString();

      await writeTailoredResumePdf(
        session.user.id,
        tailoredResumeId,
        refinementResult.previewPdf,
      );

      const nextRawProfile: TailorResumeProfile = {
        ...rawProfile,
        tailoredResumes: rawProfile.tailoredResumes.map((record, index) =>
          index === tailoredResumeIndex
            ? {
                ...record,
                annotatedLatexCode: refinementResult.annotatedLatexCode,
                edits: refinementResult.edits,
                error: null,
                latexCode: refinementResult.latexCode,
                pdfUpdatedAt: nextUpdatedAt,
                sourceAnnotatedLatexCode,
                status: "ready",
                updatedAt: nextUpdatedAt,
              }
            : record,
        ),
      };

      await writeTailorResumeProfile(session.user.id, nextRawProfile);

      return NextResponse.json({
        assistantMessage: refinementResult.summary,
        profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
          includeLockedOnly: true,
        }),
        tailoredResumeDurationMs: refinementResult.generationDurationMs,
        tailoredResumeId,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to refine the tailored resume edits.",
        },
        { status: 422 },
      );
    }
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
      ...nextRawProfile.workspace,
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
