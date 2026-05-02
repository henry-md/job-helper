import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import { createNdjsonStreamWriter } from "@/lib/ndjson-stream";
import { getPrismaClient } from "@/lib/prisma";
import { buildNormalizedJobUrlHash } from "@/lib/job-url-hash";
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
  findTailoredResumeByJobUrl,
  normalizeTailorResumeJobUrl,
  resolveTailorResumeJobUrl,
} from "@/lib/tailor-resume-job-url";
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
import { applyTailorResumePageCountFailure } from "@/lib/tailor-resume-page-count-failure";
import { advanceTailorResumeQuestioning } from "@/lib/tailor-resume-questioning";
import { refineTailoredResume } from "@/lib/tailor-resume-refinement";
import {
  buildTailorResumeRunStepUpdate,
  buildTailorResumeTerminalFailureStepEvent,
} from "@/lib/tailor-resume-run-step";
import {
  buildTailorResumeAttemptFailureMessage,
  formatTailorResumeStepError,
} from "@/lib/tailor-resume-step-error";
import {
  buildActiveRunExistingTailoringState,
  buildActiveTailoringStates,
  buildPendingInterviewExistingTailoringState,
  type TailorResumeExistingTailoringState,
} from "@/lib/tailor-resume-existing-tailoring-state";
import { countPdfPages } from "@/lib/tailor-resume-layout-measurement";
import {
  implementTailoredResumePlan,
  planTailoredResume,
} from "@/lib/tailor-resume-tailoring";
import { buildTailoredResumeKeywordCoverage } from "@/lib/tailor-resume-keyword-coverage";
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
  type TailorResumeConversationToolCall,
  type TailorResumeGenerationStepEvent,
  type TailorResumePendingInterview,
  type TailorResumeLockedLinkRecord,
  type TailoredResumePlanningResult as TailorResumePlanningResult,
  type TailoredResumeBlockEditRecord,
  type TailorResumeProfile,
  type TailorResumeSavedLinkUpdate,
} from "@/lib/tailor-resume-types";
import {
  findTailorResumeWorkspaceInterview,
  isTailorResumeInterviewDecisionInFlight,
  isTailorResumeInterviewQueued,
  isTailorResumeInterviewReady,
  readTailorResumeWorkspaceInterviews,
  removeTailorResumeWorkspaceInterview,
  upsertTailorResumeWorkspaceInterview,
  withTailorResumeWorkspaceInterviews,
} from "@/lib/tailor-resume-workspace-interviews";
import {
  applyTailorResumeUserMarkdownPatch,
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
import {
  filterVisibleJobApplicationsByUrl,
  toJobApplicationRecord,
} from "@/lib/job-application-records";
import {
  normalizeCompanyName,
  resolveAppliedAt,
} from "@/lib/job-tracking-shared";
import {
  cleanupInvalidTailorResumeArtifacts,
  deleteDbTailoredResumes,
  deleteLinkedDashboardArtifactsWithinLockedProfile,
  deleteTailorResumeArtifacts,
  findActiveTailorResumeRun,
  readTailorResumeResponseState,
  uniqueNonEmptyStrings,
} from "@/lib/tailor-resume-route-response-state";
import {
  saveTailorResumeGenerationSettingsAction,
  saveTailorResumePromptSettingsAction,
  saveTailorResumeUserMarkdownAction,
} from "@/lib/tailor-resume-route-settings";
import {
  bumpUserSyncState,
  readUserSyncStateSnapshotForUser,
} from "@/lib/user-sync-state";

const maxJobDescriptionLength = 200_000;
const maxLatexCodeLength = 300_000;
const maxTailoredResumeRefinementPreviewImageCount = 6;
const maxTailoredResumeRefinementPromptLength = 8_000;
const maxTailoredResumeDisplayNameLength = 200;
const tailorResumeRunHeartbeatIntervalMs = 30_000;

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

function logTailorResumeDiagnostic(input: {
  action: "advanceTailorResumeInterview" | "completeTailorResumeInterview" | "tailor";
  interviewId?: string | null;
  message: string;
  runId?: string | null;
  stepEvent?: TailorResumeGenerationStepEvent;
}) {
  const payload = {
    action: input.action,
    interviewId: input.interviewId ?? null,
    runId: input.runId ?? null,
    ...(input.stepEvent
      ? {
          attempt: input.stepEvent.attempt,
          detail: input.stepEvent.detail,
          retrying: input.stepEvent.retrying,
          stepCount: input.stepEvent.stepCount,
          stepNumber: input.stepEvent.stepNumber,
          stepStatus: input.stepEvent.status,
          summary: input.stepEvent.summary,
        }
      : {}),
  };

  console.info(`[tailor-resume] ${input.message} ${JSON.stringify(payload)}`);
}

async function markApplicationsChanged(userId: string) {
  await bumpUserSyncState({
    applications: true,
    userId,
  });
}

async function markTailoringChanged(userId: string) {
  await bumpUserSyncState({
    tailoring: true,
    userId,
  });
}

async function writeTailorResumeProfileAndMarkChanged(
  userId: string,
  profile: TailorResumeProfile,
) {
  await writeTailorResumeProfile(userId, profile);
  await markTailoringChanged(userId);
}

function readIncludeApplicationsFlag(request: Request) {
  const includeApplications = new URL(request.url).searchParams.get(
    "includeApplications",
  );

  return (
    includeApplications === "1" ||
    includeApplications === "true" ||
    includeApplications === "yes"
  );
}

function readApplicationSummaryLimit(request: Request) {
  const rawLimit = new URL(request.url).searchParams.get("applicationLimit");

  if (!rawLimit) {
    return 12;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);

  if (!Number.isInteger(parsedLimit)) {
    return 12;
  }

  return Math.min(Math.max(parsedLimit, 1), 100);
}

async function readApplicationSummaryPayload(input: {
  limit: number;
  userId: string;
}) {
  const prisma = getPrismaClient();
  const [applications, companyCount] = await Promise.all([
    prisma.jobApplication.findMany({
      include: {
        company: true,
        referrer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      where: {
        archivedAt: null,
        userId: input.userId,
      },
    }),
    prisma.company.count({
      where: {
        applications: {
          some: {
            userId: input.userId,
          },
        },
        userId: input.userId,
      },
    }),
  ]);
  const visibleApplications = filterVisibleJobApplicationsByUrl(applications);
  const limitedApplications = visibleApplications.slice(0, input.limit);

  return {
    applicationCount: visibleApplications.length,
    applications: limitedApplications.map(toJobApplicationRecord),
    companyCount,
  };
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

  await markTailoringChanged(input.userId);

  return {
    ok: true,
    userMarkdown: saveResult.state,
  };
}

async function persistTailorResumePendingInterviewUserMarkdown(input: {
  tailoringInterview: TailorResumePendingInterview;
  userId: string;
}) {
  const userMarkdown = await readTailorResumeUserMarkdown(input.userId);

  if (input.tailoringInterview.pendingUserMarkdownEditOperations.length === 0) {
    return {
      ok: true as const,
      userMarkdown,
    };
  }

  const patchResult = applyTailorResumeUserMarkdownPatch(
    userMarkdown.markdown,
    input.tailoringInterview.pendingUserMarkdownEditOperations,
  );

  if (!patchResult.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error:
            "The queued USER.md update from this chat no longer applies cleanly. Keep chatting once to refresh the memory update, then press Done again.",
          userMarkdown,
        },
        { status: 409 },
      ),
    };
  }

  return persistTailorResumeUserMarkdownPatchResult({
    baseState: userMarkdown,
    patchResult,
    userId: input.userId,
  });
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
  toolCalls?: TailorResumeConversationToolCall[];
}) {
  return {
    id: randomUUID(),
    role: input.role,
    text: input.text.trim(),
    toolCalls: input.toolCalls ?? [],
  };
}

function buildTailorResumeInterviewAssistantText(input: {
  assistantMessage: string;
  planningResult: TailorResumePlanningResult;
}) {
  const assistantMessage = input.assistantMessage.trim();
  const summary = input.planningResult.questioningSummary;
  const debugSentence =
    summary?.debugDecision === "would_ask_without_debug"
      ? " Debug mode note: I would have asked this even without the forced-conversation override."
      : summary?.debugDecision === "forced_only"
        ? " Debug mode note: I would not normally ask this, but I’m asking because debug mode is forcing at least one follow-up question."
        : "";

  return [debugSentence, assistantMessage]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
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
      applicationId: string | null;
      kind: "ready";
      jobDescription: string;
      jobUrl: string | null;
      lockedLinks: TailorResumeLockedLinkRecord[];
      overwrittenDbTailoredResumeIds: string[];
      overwrittenTailoredResumeIds: string[];
      rawProfile: TailorResumeProfile;
      runId: string | null;
    };

type TailorResumeInterviewPreparation =
  | {
      kind: "response";
      response: Response;
    }
  | {
      applicationId: string | null;
      kind: "ready";
      lockedLinks: TailorResumeLockedLinkRecord[];
      rawProfile: TailorResumeProfile;
      runId: string | null;
      tailoringInterview: TailorResumePendingInterview;
    };

type TailorResumeApplicationContext = {
  companyName: string | null;
  employmentType: string | null;
  jobTitle: string | null;
  location: string | null;
  pageTitle: string | null;
};

type TailoredResumeDbRecord = {
  applicationId: string | null;
  archivedAt: Date | null;
  companyName: string | null;
  createdAt: Date;
  displayName: string;
  error: string | null;
  id: string;
  jobUrl: string | null;
  positionTitle: string | null;
  profileRecordId: string;
  status: string;
  updatedAt: Date;
};

async function completeTailorResumeInterviewAndFinalize(input: {
  applicationId: string | null;
  lockedLinks: TailorResumeLockedLinkRecord[];
  onStepEvent: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  rawProfile: TailorResumeProfile;
  runId: string | null;
  stepTwoCompletionEvent?: TailorResumeGenerationStepEvent | null;
  tailoringInterview: TailorResumePendingInterview;
  userId: string;
  userMarkdown: TailorResumeUserMarkdownState;
}) {
  if (input.stepTwoCompletionEvent !== null) {
    await input.onStepEvent(
      input.stepTwoCompletionEvent ?? {
        attempt: readTailorResumeInterviewAttempt(
          input.tailoringInterview.planningResult.questioningSummary,
        ),
        detail:
          "Collected enough user context, and the user confirmed that we should wrap up the follow-up chat.",
        durationMs: 0,
        retrying: false,
        status: "succeeded",
        stepCount: 4,
        stepNumber: 2,
        summary: "Finishing the follow-up questions",
      },
    );
  }

  const planningSnapshot = buildTailorResumePlanningSnapshot(
    input.tailoringInterview.sourceAnnotatedLatexCode,
  );
  const normalizedBaseLatex = normalizeAnnotatedLatexState(
    input.rawProfile.latex.code,
    new Date().toISOString(),
  );
  const processedBaseAnnotatedLatex =
    applyTailorResumeSourceLinkOverridesWithSummary(
      normalizedBaseLatex.annotatedLatex.code,
      {
        currentLinks: input.rawProfile.links,
        lockedLinks: input.lockedLinks,
      },
    );
  const generationSourceAnnotatedLatex = normalizeTailorResumeLatex(
    processedBaseAnnotatedLatex.latexCode,
  ).annotatedLatex;
  const tailoringResult = await implementTailoredResumePlan({
    annotatedLatexCode: input.tailoringInterview.sourceAnnotatedLatexCode,
    generationDurationMsBase: input.tailoringInterview.accumulatedModelDurationMs,
    jobDescription: input.tailoringInterview.jobDescription,
    linkOverrides: buildKnownTailorResumeLinks(
      input.rawProfile.links,
      input.lockedLinks,
    ),
    onBuildFailure: (latexCode, error, attempt) =>
      logLatexBuildFailure({
        userId: input.userId,
        source: tailorResumeDebugErrorSources.tailoringCompileFailure,
        latexCode,
        error,
        attempt,
      }),
    onInvalidReplacement: (payload, error, attempt) =>
      logTailorResumeDebugError({
        userId: input.userId,
        source: tailorResumeDebugErrorSources.tailoringInvalidReplacement,
        latexCode: payload,
        error,
        attempt,
      }),
    onStepEvent: input.onStepEvent,
    planningDebug: input.tailoringInterview.planningDebug,
    planningResult: input.tailoringInterview.planningResult,
    planningSnapshot,
    promptSettings: input.rawProfile.promptSettings.values,
    userMarkdown: input.userMarkdown,
  });

  return finalizeTailorResumeGeneration({
    applicationId: input.applicationId,
    clearTailoringInterview: true,
    generationSourceAnnotatedLatex,
    generationSourceSnapshot: input.tailoringInterview.generationSourceSnapshot,
    jobDescription: input.tailoringInterview.jobDescription,
    jobUrl: input.tailoringInterview.jobUrl,
    lockedLinks: input.lockedLinks,
    normalizedBaseLatex,
    onStepEvent: input.onStepEvent,
    processedBaseSavedLinkUpdateCount: processedBaseAnnotatedLatex.updatedCount,
    processedBaseSavedLinkUpdates: processedBaseAnnotatedLatex.updatedLinks,
    rawProfile: input.rawProfile,
    runId: input.runId,
    tailoringResult,
    userId: input.userId,
    userMarkdown: input.userMarkdown,
  });
}

function readTailorResumeInterviewSortTime(interview: TailorResumePendingInterview) {
  const createdAtTime = Date.parse(interview.createdAt);

  if (Number.isFinite(createdAtTime)) {
    return createdAtTime;
  }

  const updatedAtTime = Date.parse(interview.updatedAt);
  return Number.isFinite(updatedAtTime) ? updatedAtTime : 0;
}

function buildTailorResumeChatQueuedStepEvent(
  detail =
    "Another resume follow-up chat is active, so this run is queued until USER.md is updated and its Step 2 decision can be re-evaluated.",
): TailorResumeGenerationStepEvent {
  return {
    attempt: null,
    detail,
    durationMs: 0,
    retrying: false,
    status: "running",
    stepCount: 4,
    stepNumber: 2,
    summary: "Chat Queued",
  };
}

function buildTailorResumeQueuedInterview(input: {
  accumulatedModelDurationMs: number;
  applicationId: string | null;
  generationSourceSnapshot: ReturnType<typeof buildTailorResumeGenerationSourceSnapshot>;
  jobDescription: string;
  jobUrl: string | null;
  planningDebug: TailorResumePendingInterview["planningDebug"];
  planningResult: TailorResumePlanningResult;
  sourceAnnotatedLatexCode: string;
  status: TailorResumePendingInterview["status"];
  runId: string | null;
}) {
  const now = new Date().toISOString();

  return {
    accumulatedModelDurationMs: input.accumulatedModelDurationMs,
    applicationId: input.applicationId,
    completionRequestedAt: null,
    conversation: [],
    createdAt: now,
    generationSourceSnapshot: input.generationSourceSnapshot,
    id: randomUUID(),
    jobDescription: input.jobDescription,
    jobUrl: input.jobUrl,
    planningDebug: input.planningDebug,
    planningResult: input.planningResult,
    pendingUserMarkdownEditOperations: [],
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    status: input.status,
    tailorResumeRunId: input.runId,
    updatedAt: now,
  } satisfies TailorResumePendingInterview;
}

async function reserveTailorResumeQuestionDecision(input: {
  accumulatedModelDurationMs: number;
  applicationId: string | null;
  generationSourceSnapshot: ReturnType<typeof buildTailorResumeGenerationSourceSnapshot>;
  jobDescription: string;
  jobUrl: string | null;
  planningDebug: TailorResumePendingInterview["planningDebug"];
  planningResult: TailorResumePlanningResult;
  sourceAnnotatedLatexCode: string;
  runId: string | null;
  userId: string;
}) {
  return withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);
    const runStillActive = await isTailorResumeRunStillActive({
      runId: input.runId,
      userId: input.userId,
    });

    if (
      !runStillActive ||
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: input.generationSourceSnapshot,
      })
    ) {
      return {
        kind: "stale" as const,
      };
    }

    const currentInterviews = readTailorResumeWorkspaceInterviews(
      latestState.rawProfile.workspace,
    );
    const questionDecisionIsBusy = currentInterviews.some(
      (interview) =>
        isTailorResumeInterviewReady(interview) ||
        isTailorResumeInterviewDecisionInFlight(interview) ||
        isTailorResumeInterviewQueued(interview),
    );
    const pendingInterview = buildTailorResumeQueuedInterview({
      accumulatedModelDurationMs: input.accumulatedModelDurationMs,
      applicationId: input.applicationId,
      generationSourceSnapshot: input.generationSourceSnapshot,
      jobDescription: input.jobDescription,
      jobUrl: input.jobUrl,
      planningDebug: input.planningDebug,
      planningResult: input.planningResult,
      runId: input.runId,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      status: questionDecisionIsBusy ? "queued" : "deciding",
    });
    const nextRawProfile: TailorResumeProfile = {
      ...latestState.rawProfile,
      workspace: upsertTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        pendingInterview,
        pendingInterview.updatedAt,
      ),
    };

    await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);

    return {
      interview: pendingInterview,
      kind: pendingInterview.status === "queued" ? "queued" : "deciding",
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    } as const;
  });
}

async function promoteReadyTailorResumeInterview(input: {
  accumulatedModelDurationMs: number;
  assistantMessage: string;
  interview: TailorResumePendingInterview;
  planningResult: TailorResumePlanningResult;
  questioningResult: Extract<
    Awaited<ReturnType<typeof advanceTailorResumeQuestioning>>,
    { action: "ask" }
  >;
  userId: string;
}) {
  const readyAt = new Date().toISOString();
  const readyInterview: TailorResumePendingInterview = {
    ...input.interview,
    accumulatedModelDurationMs: input.accumulatedModelDurationMs,
    completionRequestedAt: null,
    conversation: [
      buildTailorResumeConversationMessage({
        role: "assistant",
        text: input.assistantMessage,
        toolCalls: input.questioningResult.toolCalls,
      }),
    ],
    planningResult: input.planningResult,
    pendingUserMarkdownEditOperations: [],
    status: "ready",
    updatedAt: readyAt,
  };

  return withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);
    const latestInterview = findTailorResumeWorkspaceInterview(
      latestState.rawProfile.workspace,
      (interview) => interview.id === input.interview.id,
    );
    const runStillActive = await isTailorResumeRunStillActive({
      runId: input.interview.tailorResumeRunId,
      userId: input.userId,
    });

    if (
      !latestInterview ||
      latestInterview.status !== "deciding" ||
      !runStillActive ||
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: input.interview.generationSourceSnapshot,
      })
    ) {
      return null;
    }

    const nextRawProfile: TailorResumeProfile = {
      ...latestState.rawProfile,
      jobDescription: latestState.rawProfile.jobDescription || input.interview.jobDescription,
      workspace: upsertTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        readyInterview,
        readyAt,
      ),
    };

    await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);

    return {
      interview: readyInterview,
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });
}

async function claimNextQueuedTailorResumeQuestionDecision(userId: string) {
  return withTailorResumeProfileLock(userId, async () => {
    const latestState = await readTailorResumeProfileState(userId);
    const currentInterviews = readTailorResumeWorkspaceInterviews(
      latestState.rawProfile.workspace,
    );

    if (
      currentInterviews.some(
        (interview) =>
          isTailorResumeInterviewReady(interview) ||
          isTailorResumeInterviewDecisionInFlight(interview),
      )
    ) {
      return null;
    }

    const queuedInterview =
      currentInterviews
        .filter((interview) => isTailorResumeInterviewQueued(interview))
        .sort(
          (left, right) =>
            readTailorResumeInterviewSortTime(left) -
            readTailorResumeInterviewSortTime(right),
        )[0] ?? null;

    if (!queuedInterview) {
      return null;
    }

    const runStillActive = await isTailorResumeRunStillActive({
      runId: queuedInterview.tailorResumeRunId,
      userId,
    });

    if (
      !runStillActive ||
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: queuedInterview.generationSourceSnapshot,
      })
    ) {
      const nextRawProfile: TailorResumeProfile = {
        ...latestState.rawProfile,
        workspace: removeTailorResumeWorkspaceInterview(
          latestState.rawProfile.workspace,
          (interview) => interview.id === queuedInterview.id,
        ),
      };

      await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);
      await updateTailorResumeRunStatus({
        error:
          "The base resume changed, or this queued tailoring run was canceled before its follow-up questions could be prepared.",
        runId: queuedInterview.tailorResumeRunId,
        status: "FAILED",
        userId,
      });
      return null;
    }

    const decidingInterview: TailorResumePendingInterview = {
      ...queuedInterview,
      status: "deciding",
      updatedAt: new Date().toISOString(),
    };
    const nextRawProfile: TailorResumeProfile = {
      ...latestState.rawProfile,
      workspace: upsertTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        decidingInterview,
        decidingInterview.updatedAt,
      ),
    };

    await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);

    return {
      interview: decidingInterview,
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });
}

async function removeTailorResumeQuestionDecisionInterview(input: {
  interviewId: string;
  userId: string;
}) {
  await withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);
    const nextRawProfile: TailorResumeProfile = {
      ...latestState.rawProfile,
      workspace: removeTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        (interview) => interview.id === input.interviewId,
      ),
    };

    if (nextRawProfile !== latestState.rawProfile) {
      await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);
    }
  });
}

async function continueQueuedTailorResumeQuestionDecision(userId: string) {
  const claimed = await claimNextQueuedTailorResumeQuestionDecision(userId);

  if (!claimed) {
    return null;
  }

  const stopRunHeartbeat = startTailorResumeRunHeartbeat({
    runId: claimed.interview.tailorResumeRunId,
    userId,
  });

  try {
    const userMarkdownBeforeQuestioning = await readTailorResumeUserMarkdown(userId);
    const planningSnapshot = buildTailorResumePlanningSnapshot(
      claimed.interview.sourceAnnotatedLatexCode,
    );
    let questioningResult: Awaited<
      ReturnType<typeof advanceTailorResumeQuestioning>
    >;

    try {
      questioningResult = await advanceTailorResumeQuestioning({
        conversation: [],
        jobDescription: claimed.interview.jobDescription,
        planningResult: claimed.interview.planningResult,
        planningSnapshot,
        promptSettings: claimed.rawProfile.promptSettings.values,
        userMarkdown: userMarkdownBeforeQuestioning,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to determine whether follow-up questions are needed.";

      await updateTailorResumeRunStep({
        event: {
          attempt: 1,
          detail: errorMessage,
          durationMs: 0,
          retrying: false,
          status: "failed",
          stepCount: 4,
          stepNumber: 2,
          summary: "Preparing follow-up question for the user",
        },
        runId: claimed.interview.tailorResumeRunId,
        userId,
      });
      await updateTailorResumeRunStatus({
        error: errorMessage,
        runId: claimed.interview.tailorResumeRunId,
        status: "FAILED",
        userId,
      });
      await removeTailorResumeQuestionDecisionInterview({
        interviewId: claimed.interview.id,
        userId,
      });
      return null;
    }

    const accumulatedModelDurationMs =
      claimed.interview.accumulatedModelDurationMs +
      questioningResult.generationDurationMs;
    const userMarkdownSaveResult =
      await persistTailorResumeUserMarkdownPatchResult({
        baseState: userMarkdownBeforeQuestioning,
        patchResult: questioningResult.userMarkdownPatchResult,
        userId,
      });

    if (!userMarkdownSaveResult.ok) {
      await updateTailorResumeRunStatus({
        error: "Unable to save the tailoring follow-up memory update.",
        runId: claimed.interview.tailorResumeRunId,
        status: "FAILED",
        userId,
      });
      await removeTailorResumeQuestionDecisionInterview({
        interviewId: claimed.interview.id,
        userId,
      });
      return null;
    }

    if (questioningResult.action === "ask") {
      const nextPlanningResult: TailorResumePlanningResult = {
        ...claimed.interview.planningResult,
        questioningSummary: questioningResult.questioningSummary,
      };
      const promoted = await promoteReadyTailorResumeInterview({
        accumulatedModelDurationMs,
        assistantMessage: buildTailorResumeInterviewAssistantText({
          assistantMessage: questioningResult.assistantMessage,
          planningResult: nextPlanningResult,
        }),
        interview: claimed.interview,
        planningResult: nextPlanningResult,
        questioningResult,
        userId,
      });

      if (!promoted) {
        await updateTailorResumeRunStatus({
          error:
            "The base resume changed, or this queued tailoring run was canceled while its follow-up question was being prepared.",
          runId: claimed.interview.tailorResumeRunId,
          status: "FAILED",
          userId,
        });
        await removeTailorResumeQuestionDecisionInterview({
          interviewId: claimed.interview.id,
          userId,
        });
        return null;
      }

      await updateTailorResumeRunStep({
        event: {
          attempt: 1,
          detail:
            "A follow-up question is ready, so Step 2 is waiting for the user's answer before the remaining generation steps start.",
          durationMs: questioningResult.generationDurationMs,
          retrying: false,
          status: "running",
          stepCount: 4,
          stepNumber: 2,
          summary: "Waiting for a follow-up answer from the user",
        },
        runId: claimed.interview.tailorResumeRunId,
        userId,
      });
      await updateTailorResumeRunStatus({
        runId: claimed.interview.tailorResumeRunId,
        status: "NEEDS_INPUT",
        userId,
      });
      return { action: "ask" as const };
    }

    const finalizedInterview = questioningResult.questioningSummary
      ? {
          ...claimed.interview,
          planningResult: {
            ...claimed.interview.planningResult,
            questioningSummary: questioningResult.questioningSummary,
          },
        }
      : claimed.interview;

    await completeTailorResumeInterviewAndFinalize({
      applicationId: claimed.interview.applicationId,
      lockedLinks: claimed.lockedLinks,
      onStepEvent: (event) =>
        updateTailorResumeRunStep({
          event,
          runId: finalizedInterview.tailorResumeRunId,
          userId,
        }),
      rawProfile: claimed.rawProfile,
      runId: finalizedInterview.tailorResumeRunId,
      stepTwoCompletionEvent: null,
      tailoringInterview: finalizedInterview,
      userId,
      userMarkdown: userMarkdownSaveResult.userMarkdown,
    });

    return { action: "skip" as const };
  } finally {
    stopRunHeartbeat();
  }
}

async function drainTailorResumeQuestionQueue(userId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await continueQueuedTailorResumeQuestionDecision(userId);

    if (!result || result.action === "ask") {
      return;
    }
  }
}

function readExistingTailoringAction(body: Record<string, unknown>) {
  return body.existingTailoringAction === "overwrite" ||
    body.overwriteExistingTailoring === true
    ? "overwrite"
    : null;
}

function readOptionalBodyString(
  body: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = body[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function buildExistingTailoringConflictResponse(input: {
  existingTailoring: TailorResumeExistingTailoringState;
  profile: TailorResumeProfile;
}) {
  return NextResponse.json(
    {
      error:
        input.existingTailoring.kind === "completed"
          ? "A tailored resume already exists for this job."
          : "A Tailor Resume run is already in progress.",
      existingTailoring: input.existingTailoring,
      profile: input.profile,
      tailoringStatus: "existing_tailoring_found" as const,
    },
    { status: 409 },
  );
}

function buildTailorResumeJobUrlHash(jobUrl: string | null) {
  return buildNormalizedJobUrlHash(jobUrl);
}

function readBodyRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTailorResumeApplicationContext(
  body: Record<string, unknown>,
): TailorResumeApplicationContext | null {
  const value = readBodyRecord(body.applicationContext);

  if (!value) {
    return null;
  }

  return {
    companyName: readOptionalText(value.companyName),
    employmentType: normalizeTailorResumeApplicationEmploymentType(
      readOptionalText(value.employmentType),
    ),
    jobTitle: readOptionalText(value.jobTitle),
    location: normalizeTailorResumeApplicationLocation(
      readOptionalText(value.location),
    ),
    pageTitle: readOptionalText(value.pageTitle),
  };
}

function readFirstJobDescriptionHint(jobDescription: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = jobDescription.match(
    new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"),
  );
  const firstValue = match?.[1]?.split(",")[0]?.trim();

  return firstValue || null;
}

function readJobHostName(jobUrl: string | null) {
  if (!jobUrl) {
    return null;
  }

  try {
    const hostname = new URL(jobUrl).hostname.replace(/^www\./i, "");

    return hostname || null;
  } catch {
    return null;
  }
}

function normalizeTailorResumeApplicationLocation(value: string | null) {
  const normalizedValue = value?.toLowerCase() ?? "";

  if (normalizedValue.includes("hybrid")) {
    return "hybrid";
  }

  if (normalizedValue.includes("remote")) {
    return "remote";
  }

  if (
    normalizedValue.includes("on-site") ||
    normalizedValue.includes("onsite") ||
    normalizedValue.includes("in-office") ||
    normalizedValue.includes("office")
  ) {
    return "onsite";
  }

  return null;
}

function normalizeTailorResumeApplicationEmploymentType(value: string | null) {
  const normalizedValue = value
    ?.toLowerCase()
    .replace(/[-\s]+/g, "_")
    .trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.includes("full_time") || normalizedValue.includes("fulltime")) {
    return "full_time";
  }

  if (normalizedValue.includes("part_time") || normalizedValue.includes("parttime")) {
    return "part_time";
  }

  if (normalizedValue.includes("contract")) {
    return "contract";
  }

  if (normalizedValue.includes("intern")) {
    return "internship";
  }

  return null;
}

function buildTailorResumeApplicationDraft(input: {
  applicationContext: TailorResumeApplicationContext | null;
  jobDescription: string;
  jobUrl: string;
}) {
  const jobTitle =
    input.applicationContext?.jobTitle ||
    readFirstJobDescriptionHint(input.jobDescription, "Role title hints") ||
    readFirstJobDescriptionHint(input.jobDescription, "Page title") ||
    input.applicationContext?.pageTitle ||
    "Untitled role";
  const companyName =
    input.applicationContext?.companyName ||
    readFirstJobDescriptionHint(input.jobDescription, "Company hints") ||
    readFirstJobDescriptionHint(input.jobDescription, "Site name") ||
    readJobHostName(input.jobUrl) ||
    "Unknown company";

  return {
    companyName,
    employmentType:
      input.applicationContext?.employmentType ||
      normalizeTailorResumeApplicationEmploymentType(
        readFirstJobDescriptionHint(
          input.jobDescription,
          "Employment type hints",
        ),
      ),
    jobTitle,
    location:
      input.applicationContext?.location ||
      normalizeTailorResumeApplicationLocation(
        readFirstJobDescriptionHint(input.jobDescription, "Location hints"),
      ),
  };
}

async function ensureTailorResumeJobApplication(input: {
  applicationContext: TailorResumeApplicationContext | null;
  jobDescription: string;
  jobUrl: string | null;
  userId: string;
}) {
  const normalizedJobUrl = normalizeTailorResumeJobUrl(input.jobUrl);
  const jobUrlHash = buildTailorResumeJobUrlHash(normalizedJobUrl);

  if (!normalizedJobUrl || !jobUrlHash) {
    return null;
  }

  const prisma = getPrismaClient();
  const applicationDraft = buildTailorResumeApplicationDraft({
    applicationContext: input.applicationContext,
    jobDescription: input.jobDescription,
    jobUrl: normalizedJobUrl,
  });
  const existingApplicationByHash = await prisma.jobApplication.findUnique({
    select: {
      id: true,
    },
    where: {
      userId_jobUrlHash: {
        jobUrlHash,
        userId: input.userId,
      },
    },
  });
  const existingApplicationByComparableUrl = existingApplicationByHash
    ? null
    : (
        await prisma.jobApplication.findMany({
          select: {
            id: true,
            jobUrl: true,
          },
          where: {
            jobUrl: {
              not: null,
            },
            userId: input.userId,
          },
        })
      ).find(
        (application) =>
          normalizeTailorResumeJobUrl(application.jobUrl) === normalizedJobUrl,
      ) ?? null;
  const company = await prisma.company.upsert({
    where: {
      userId_normalizedName: {
        normalizedName: normalizeCompanyName(applicationDraft.companyName),
        userId: input.userId,
      },
    },
    create: {
      name: applicationDraft.companyName,
      normalizedName: normalizeCompanyName(applicationDraft.companyName),
      userId: input.userId,
    },
    update: {
      name: applicationDraft.companyName,
    },
  });
  const applicationData = {
    archivedAt: null,
    companyId: company.id,
    employmentType: applicationDraft.employmentType,
    jobDescription: input.jobDescription,
    jobUrl: normalizedJobUrl,
    jobUrlHash,
    location: applicationDraft.location,
    title: applicationDraft.jobTitle,
  };
  const existingApplication =
    existingApplicationByHash ?? existingApplicationByComparableUrl;
  const application = existingApplication
    ? await prisma.jobApplication.update({
        data: applicationData,
        select: {
          id: true,
        },
        where: {
          id: existingApplication.id,
        },
      })
    : await prisma.jobApplication.create({
        data: {
          ...applicationData,
          appliedAt: resolveAppliedAt(null),
          status: "SAVED",
          userId: input.userId,
        },
        select: {
          id: true,
        },
      });

  await markApplicationsChanged(input.userId);

  return {
    id: application.id,
    jobUrlHash,
  };
}

function matchesTailorResumeInterviewTarget(
  interview: TailorResumePendingInterview,
  input: {
    applicationId: string | null;
    jobUrl: string | null;
  },
) {
  if (input.applicationId && interview.applicationId === input.applicationId) {
    return true;
  }

  const normalizedJobUrl = normalizeTailorResumeJobUrl(input.jobUrl);

  if (!normalizedJobUrl) {
    return false;
  }

  return normalizeTailorResumeJobUrl(interview.jobUrl) === normalizedJobUrl;
}

function buildCompletedExistingTailoringState(
  tailoredResume: TailorResumeProfile["tailoredResumes"][number],
): TailorResumeExistingTailoringState {
  return {
    applicationId: tailoredResume.applicationId ?? null,
    companyName: tailoredResume.companyName,
    createdAt: tailoredResume.createdAt,
    displayName: tailoredResume.displayName,
    emphasizedTechnologies: tailoredResume.planningResult.emphasizedTechnologies,
    error: tailoredResume.error,
    id: tailoredResume.id,
    jobIdentifier: tailoredResume.jobIdentifier || null,
    jobUrl: tailoredResume.jobUrl,
    kind: "completed",
    positionTitle: tailoredResume.positionTitle,
    status: tailoredResume.status,
    tailoredResumeId: tailoredResume.id,
    updatedAt: tailoredResume.updatedAt,
  };
}

function buildDbCompletedExistingTailoringState(
  tailoredResume: TailoredResumeDbRecord,
): TailorResumeExistingTailoringState {
  return {
    applicationId: tailoredResume.applicationId,
    companyName: tailoredResume.companyName,
    createdAt: tailoredResume.createdAt.toISOString(),
    displayName: tailoredResume.displayName,
    emphasizedTechnologies: [],
    error: tailoredResume.error,
    id: tailoredResume.id,
    jobIdentifier: null,
    jobUrl: tailoredResume.jobUrl,
    kind: "completed",
    positionTitle: tailoredResume.positionTitle,
    status: tailoredResume.status,
    tailoredResumeId: tailoredResume.profileRecordId,
    updatedAt: tailoredResume.updatedAt.toISOString(),
  };
}

async function findLatestDbTailoredResume(input: {
  applicationId: string | null;
  userId: string;
}) {
  if (!input.applicationId) {
    return null;
  }

  return getPrismaClient().tailoredResume.findFirst({
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
    where: {
      applicationId: input.applicationId,
      userId: input.userId,
    },
  });
}

function collectOverwrittenProfileTailoredResumeIds(input: {
  applicationIds: string[];
  jobUrls: Array<string | null | undefined>;
  profile: TailorResumeProfile;
  tailoredResumeIds: string[];
}) {
  const applicationIds = new Set(uniqueNonEmptyStrings(input.applicationIds));
  const tailoredResumeIds = new Set(uniqueNonEmptyStrings(input.tailoredResumeIds));
  const normalizedJobUrls = new Set(
    uniqueNonEmptyStrings(input.jobUrls.map(normalizeTailorResumeJobUrl)),
  );

  return input.profile.tailoredResumes
    .filter((record) => {
      if (tailoredResumeIds.has(record.id)) {
        return true;
      }

      if (record.applicationId && applicationIds.has(record.applicationId)) {
        return true;
      }

      const normalizedJobUrl = normalizeTailorResumeJobUrl(record.jobUrl);
      return Boolean(normalizedJobUrl && normalizedJobUrls.has(normalizedJobUrl));
    })
    .map((record) => record.id);
}

async function findDbTailoredResumeOverwriteTargets(input: {
  applicationIds: string[];
  jobUrls: Array<string | null | undefined>;
  tailoredResumeIds: string[];
  userId: string;
}) {
  const applicationIds = uniqueNonEmptyStrings(input.applicationIds);
  const tailoredResumeIds = uniqueNonEmptyStrings(input.tailoredResumeIds);
  const jobUrlHashes = uniqueNonEmptyStrings(
    input.jobUrls.map((jobUrl) => buildTailorResumeJobUrlHash(jobUrl ?? null)),
  );
  const orConditions = [
    ...(applicationIds.length > 0
      ? [
          {
            applicationId: {
              in: applicationIds,
            },
          },
        ]
      : []),
    ...(tailoredResumeIds.length > 0
      ? [
          {
            id: {
              in: tailoredResumeIds,
            },
          },
          {
            profileRecordId: {
              in: tailoredResumeIds,
            },
          },
        ]
      : []),
    ...(jobUrlHashes.length > 0
      ? [
          {
            jobUrlHash: {
              in: jobUrlHashes,
            },
          },
        ]
      : []),
  ];

  if (orConditions.length === 0) {
    return [];
  }

  return getPrismaClient().tailoredResume.findMany({
    select: {
      applicationId: true,
      id: true,
      jobUrl: true,
      profileRecordId: true,
    },
    where: {
      OR: orConditions,
      userId: input.userId,
    },
  });
}

async function createTailorResumeRun(input: {
  applicationId: string | null;
  jobDescription: string;
  jobUrl: string | null;
  jobUrlHash: string | null;
  userId: string;
}) {
  if (!input.applicationId) {
    return null;
  }

  const run = await getPrismaClient().tailorResumeRun.create({
    data: {
      applicationId: input.applicationId,
      jobDescription: input.jobDescription,
      jobUrl: input.jobUrl,
      jobUrlHash: input.jobUrlHash,
      status: "RUNNING",
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });

  await markTailoringChanged(input.userId);

  return run.id;
}

async function updateTailorResumeRunStep(input: {
  event: TailorResumeGenerationStepEvent;
  runId: string | null;
  userId: string;
}) {
  if (!input.runId) {
    return;
  }

  const updatedRuns = await getPrismaClient().tailorResumeRun.updateMany({
    data: buildTailorResumeRunStepUpdate(input.event),
    where: {
      id: input.runId,
      status: {
        in: ["RUNNING", "NEEDS_INPUT"],
      },
      userId: input.userId,
    },
  });

  if (updatedRuns.count > 0) {
    await markTailoringChanged(input.userId);
  }
}

async function updateTailorResumeRunStatus(input: {
  error?: string | null;
  runId: string | null;
  status: "CANCELLED" | "FAILED" | "NEEDS_INPUT" | "RUNNING" | "SUCCEEDED";
  tailoredResumeId?: string | null;
  userId: string;
}) {
  if (!input.runId) {
    return;
  }

  const updatedRuns = await getPrismaClient().tailorResumeRun.updateMany({
    data: {
      error: input.error ?? null,
      status: input.status,
      ...(input.tailoredResumeId !== undefined
        ? { tailoredResumeId: input.tailoredResumeId }
        : {}),
    },
    where: {
      id: input.runId,
      ...(input.status === "CANCELLED"
        ? {}
        : {
            status: {
              in: ["RUNNING", "NEEDS_INPUT"],
            },
          }),
      userId: input.userId,
    },
  });

  if (updatedRuns.count > 0) {
    await markTailoringChanged(input.userId);
  }
}

function startTailorResumeRunHeartbeat(input: {
  runId: string | null;
  userId: string;
}) {
  const runId = input.runId?.trim();

  if (!runId) {
    return () => {};
  }

  let isStopped = false;
  let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  const stop = () => {
    if (isStopped) {
      return;
    }

    isStopped = true;

    if (intervalId) {
      globalThis.clearInterval(intervalId);
      intervalId = null;
    }
  };

  async function beat() {
    if (isStopped) {
      return;
    }

    try {
      const updatedRuns = await getPrismaClient().tailorResumeRun.updateMany({
        data: {
          updatedAt: new Date(),
        },
        where: {
          id: runId,
          status: "RUNNING",
          userId: input.userId,
        },
      });

      if (updatedRuns.count === 0) {
        stop();
      }
    } catch (error) {
      console.warn("Could not refresh the Tailor Resume run heartbeat.", error);
    }
  }

  intervalId = globalThis.setInterval(() => {
    void beat();
  }, tailorResumeRunHeartbeatIntervalMs);

  return stop;
}

function readTailorResumeBackendErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallbackMessage;
}

async function failTailorResumeRunAfterBackendError(input: {
  error: unknown;
  fallbackMessage: string;
  fallbackStepNumber: number;
  fallbackSummary: string;
  lastStepEvent: TailorResumeGenerationStepEvent | null;
  onStepEvent: (event: TailorResumeGenerationStepEvent) => void | Promise<void>;
  runId: string | null;
  status?: number;
  tailoredResumeDurationMs?: number;
  userId: string;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  const stepNumber = input.lastStepEvent?.stepNumber ?? input.fallbackStepNumber;
  const failureMessage = formatTailorResumeStepError(
    stepNumber,
    readTailorResumeBackendErrorMessage(input.error, input.fallbackMessage),
  );
  const failureStepEvent = buildTailorResumeTerminalFailureStepEvent({
    detail: failureMessage,
    fallbackStepNumber: input.fallbackStepNumber,
    fallbackSummary: input.fallbackSummary,
    previousStepEvent: input.lastStepEvent,
  });

  await input.onStepEvent(failureStepEvent);
  await updateTailorResumeRunStatus({
    error: failureMessage,
    runId: input.runId,
    status: "FAILED",
    userId: input.userId,
  });

  return NextResponse.json(
    {
      error: failureMessage,
      ...(input.tailoredResumeDurationMs !== undefined
        ? { tailoredResumeDurationMs: input.tailoredResumeDurationMs }
        : {}),
      ...(input.userMarkdown ? { userMarkdown: input.userMarkdown } : {}),
    },
    { status: input.status ?? 500 },
  );
}

async function isTailorResumeRunStillActive(input: {
  runId: string | null;
  userId: string;
}) {
  if (!input.runId) {
    return true;
  }

  const run = await getPrismaClient().tailorResumeRun.findFirst({
    select: {
      id: true,
    },
    where: {
      id: input.runId,
      status: "RUNNING",
      userId: input.userId,
    },
  });

  return Boolean(run);
}

async function cancelActiveTailorResumeRuns(input: {
  applicationId: string | null;
  userId: string;
}) {
  if (!input.applicationId) {
    return;
  }

  const cancelledRuns = await getPrismaClient().tailorResumeRun.updateMany({
    data: {
      status: "CANCELLED",
    },
    where: {
      applicationId: input.applicationId,
      status: {
        in: ["RUNNING", "NEEDS_INPUT"],
      },
      userId: input.userId,
    },
  });

  if (cancelledRuns.count > 0) {
    await markTailoringChanged(input.userId);
  }
}

async function upsertDbTailoredResume(input: {
  applicationId: string | null;
  archivedAt: string | null;
  companyName: string | null;
  displayName: string;
  error: string | null;
  id: string;
  jobUrl: string | null;
  positionTitle: string | null;
  profileRecordId: string;
  status: string;
  userId: string;
}) {
  const jobUrlHash = buildTailorResumeJobUrlHash(input.jobUrl);

  await getPrismaClient().tailoredResume.upsert({
    where: {
      userId_profileRecordId: {
        profileRecordId: input.profileRecordId,
        userId: input.userId,
      },
    },
    create: {
      applicationId: input.applicationId,
      archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
      companyName: input.companyName,
      displayName: input.displayName,
      error: input.error,
      id: input.id,
      jobUrl: input.jobUrl,
      jobUrlHash,
      positionTitle: input.positionTitle,
      profileRecordId: input.profileRecordId,
      status: input.status,
      userId: input.userId,
    },
    update: {
      applicationId: input.applicationId,
      archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
      companyName: input.companyName,
      displayName: input.displayName,
      error: input.error,
      jobUrl: input.jobUrl,
      jobUrlHash,
      positionTitle: input.positionTitle,
      status: input.status,
    },
  });

  await markTailoringChanged(input.userId);
}

async function finalizeTailorResumeGeneration(input: {
  applicationId: string | null;
  clearTailoringInterview?: boolean;
  generationSourceAnnotatedLatex: string;
  generationSourceSnapshot: ReturnType<typeof buildTailorResumeGenerationSourceSnapshot>;
  jobDescription: string;
  jobUrl: string | null;
  lockedLinks: TailorResumeLockedLinkRecord[];
  normalizedBaseLatex: ReturnType<typeof normalizeAnnotatedLatexState>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  overwrittenDbTailoredResumeIds?: string[];
  overwrittenTailoredResumeIds?: string[];
  processedBaseSavedLinkUpdateCount?: number;
  processedBaseSavedLinkUpdates?: TailorResumeSavedLinkUpdate[];
  rawProfile: TailorResumeProfile;
  runId: string | null;
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

    await input.onStepEvent?.({
      attempt: null,
      detail:
        "Checking whether the tailored preview still fits within the original page count before deciding if compaction is needed.",
      durationMs: 0,
      retrying: false,
      status: "running",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });

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

          const compactedTailoringResult = {
            ...tailoringResult,
            annotatedLatexCode: compactionResult.annotatedLatexCode,
            edits: compactionResult.edits,
            generationDurationMs:
              tailoringResult.generationDurationMs +
              compactionResult.generationDurationMs,
            latexCode: compactionResult.latexCode,
            model: compactionResult.model,
            previewPdf: compactionResult.previewPdf,
            validationError: compactionResult.validationError,
          };
          tailoringResult = compactionResult.validationError
            ? applyTailorResumePageCountFailure(
                compactedTailoringResult,
                compactionResult.validationError,
              )
            : compactedTailoringResult;
        } catch (error) {
          tailoringResult = applyTailorResumePageCountFailure(
            tailoringResult,
            error instanceof Error
              ? error.message
              : "Unable to keep the tailored resume within the original page count.",
          );
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
        tailoringResult = applyTailorResumePageCountFailure(
          tailoringResult,
          errorMessage,
        );
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

  if (tailoringResult.validationError?.trim()) {
    tailoringResult = {
      ...tailoringResult,
      validationError: formatTailorResumeStepError(
        tailoringResult.previewPdf ? 4 : 3,
        tailoringResult.validationError,
      ),
    };
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
            workspace: removeTailorResumeWorkspaceInterview(
              nextRawProfile.workspace,
              (interview) => interview.tailorResumeRunId === input.runId,
            ),
          };
        }

        if (nextRawProfile !== latestState.rawProfile) {
          await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);
        }
      });
    }

    const failureStepNumber = tailoringResult.previewPdf ? 4 : 3;
    const failureMessage = buildTailorResumeAttemptFailureMessage({
      attempts: tailoringResult.attempts,
      stepNumber: failureStepNumber,
      validationError: tailoringResult.validationError,
    });

    await updateTailorResumeRunStatus({
      error: failureMessage,
      runId: input.runId,
      status: "FAILED",
      userId: input.userId,
    });

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
  const keywordCoverage = buildTailoredResumeKeywordCoverage({
    emphasizedTechnologies: tailoringResult.planningResult.emphasizedTechnologies,
    originalLatexCode: input.generationSourceAnnotatedLatex,
    tailoredLatexCode: tailoringResult.latexCode,
    updatedAt: tailoredResumeUpdatedAt,
  });
  const shouldReplaceOverwrittenTailoredResumes = Boolean(
    tailoringResult.previewPdf && !tailoringResult.validationError?.trim(),
  );
  const overwrittenTailoredResumeIds = uniqueNonEmptyStrings(
    shouldReplaceOverwrittenTailoredResumes
      ? (input.overwrittenTailoredResumeIds ?? [])
      : [],
  );
  const nextState = await withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);
    const runStillActive = await isTailorResumeRunStillActive({
      runId: input.runId,
      userId: input.userId,
    });

    if (
      hasTailorResumeGenerationSourceChanged({
        currentLockedLinks: latestState.lockedLinks,
        currentRawProfile: latestState.rawProfile,
        snapshot: input.generationSourceSnapshot,
      }) ||
      !runStillActive
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
        applicationId: input.applicationId,
        annotatedLatexCode: tailoringResult.annotatedLatexCode,
        archivedAt: null,
        companyName: tailoringResult.companyName,
        createdAt: tailoredResumeUpdatedAt,
        displayName: tailoringResult.displayName,
        edits: tailoringResult.edits,
        error: tailoringResult.validationError,
        id: tailoredResumeId,
        jobDescription: input.jobDescription,
        jobIdentifier: tailoringResult.jobIdentifier,
        jobUrl: input.jobUrl,
        keywordCoverage,
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
    const overwrittenTailoredResumeIdSet = new Set(overwrittenTailoredResumeIds);
    const mergedRawProfileWithOverwrite =
      overwrittenTailoredResumeIdSet.size > 0
        ? {
            ...mergedRawProfile,
            tailoredResumes: mergedRawProfile.tailoredResumes.filter(
              (record) => !overwrittenTailoredResumeIdSet.has(record.id),
            ),
          }
        : mergedRawProfile;
    const nextRawProfile = input.clearTailoringInterview
      ? {
          ...mergedRawProfileWithOverwrite,
          workspace: removeTailorResumeWorkspaceInterview(
            mergedRawProfileWithOverwrite.workspace,
            (interview) => interview.tailorResumeRunId === input.runId,
          ),
        }
      : mergedRawProfileWithOverwrite;

    await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);

    return {
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });

  if (!nextState) {
    const staleRunMessage =
      "The base resume changed, or this tailoring run was canceled or overwritten before it finished. Review the latest Tailor Resume state and try again.";

    await updateTailorResumeRunStatus({
      error: staleRunMessage,
      runId: input.runId,
      status: "FAILED",
      userId: input.userId,
    });

    return NextResponse.json(
      {
        error: staleRunMessage,
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
  const savedTailoredResume = nextState.rawProfile.tailoredResumes.find(
    (record) => record.id === tailoredResumeId,
  );

  if (savedTailoredResume) {
    await upsertDbTailoredResume({
      applicationId: input.applicationId,
      archivedAt: savedTailoredResume.archivedAt,
      companyName: savedTailoredResume.companyName,
      displayName: savedTailoredResume.displayName,
      error: savedTailoredResume.error,
      id: savedTailoredResume.id,
      jobUrl: savedTailoredResume.jobUrl,
      positionTitle: savedTailoredResume.positionTitle,
      profileRecordId: savedTailoredResume.id,
      status: savedTailoredResume.status,
      userId: input.userId,
    });
    await Promise.all(
      overwrittenTailoredResumeIds.map((overwrittenTailoredResumeId) =>
        deleteTailoredResumePdf(input.userId, overwrittenTailoredResumeId),
      ),
    );
    await deleteDbTailoredResumes({
      ids: uniqueNonEmptyStrings([
        ...(shouldReplaceOverwrittenTailoredResumes
          ? (input.overwrittenDbTailoredResumeIds ?? [])
          : []),
        ...overwrittenTailoredResumeIds,
      ]),
      userId: input.userId,
    });
    const savedTailoredResumeHasGenerationFailure = Boolean(
      savedTailoredResume.error?.trim(),
    );
    await updateTailorResumeRunStatus({
      error: savedTailoredResumeHasGenerationFailure
        ? savedTailoredResume.error
        : undefined,
      runId: input.runId,
      status: savedTailoredResumeHasGenerationFailure ? "FAILED" : "SUCCEEDED",
      tailoredResumeId: savedTailoredResume.id,
      userId: input.userId,
    });
  }

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
      const existingTailoringAction = readExistingTailoringAction(body);
      const overwriteTargetApplicationId =
        existingTailoringAction === "overwrite"
          ? readOptionalBodyString(body, [
              "existingTailoringApplicationId",
              "overwrittenApplicationId",
            ])
          : null;
      const overwriteTargetTailoredResumeId =
        existingTailoringAction === "overwrite"
          ? readOptionalBodyString(body, [
              "existingTailoringTailoredResumeId",
              "overwrittenTailoredResumeId",
            ])
          : null;
      const jobDescription =
        typeof body.jobDescription === "string"
          ? body.jobDescription
          : profile.jobDescription;
      const jobUrlResult = resolveTailorResumeJobUrl({
        explicitJobUrl: "jobUrl" in body ? body.jobUrl : null,
        jobDescription,
      });

      if (!profile.latex.code.trim()) {
        return {
          kind: "response",
          response: NextResponse.json(
            { error: "Upload or save a base resume before tailoring it." },
            { status: 400 },
          ),
        };
      }

      if (!jobUrlResult.ok) {
        return {
          kind: "response",
          response: NextResponse.json(
            { error: jobUrlResult.error },
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

      const applicationContext = readTailorResumeApplicationContext(body);
      const application = await ensureTailorResumeJobApplication({
        applicationContext,
        jobDescription,
        jobUrl: jobUrlResult.jobUrl,
        userId,
      });
      const activeRun = await findActiveTailorResumeRun({
        applicationId: application?.id ?? null,
        userId,
      });
      const matchingInterview = findTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) =>
          matchesTailorResumeInterviewTarget(interview, {
            applicationId: application?.id ?? null,
            jobUrl: jobUrlResult.jobUrl,
          }),
      );
      const activeRunInterview =
        activeRun?.status === "NEEDS_INPUT" &&
        matchingInterview?.tailorResumeRunId === activeRun.id
          ? matchingInterview
          : null;

      if (activeRun && existingTailoringAction !== "overwrite") {
        return {
          kind: "response",
          response: buildExistingTailoringConflictResponse({
            existingTailoring:
              activeRun.status === "NEEDS_INPUT" && activeRunInterview
                ? buildPendingInterviewExistingTailoringState(
                    activeRunInterview,
                    activeRun,
                  )
                : buildActiveRunExistingTailoringState(activeRun),
            profile,
          }),
        };
      }

      if (!activeRun && matchingInterview && existingTailoringAction !== "overwrite") {
        return {
          kind: "response",
          response: buildExistingTailoringConflictResponse({
            existingTailoring:
              buildPendingInterviewExistingTailoringState(matchingInterview),
            profile,
          }),
        };
      }

      const existingDbTailoredResume = await findLatestDbTailoredResume({
        applicationId: application?.id ?? null,
        userId,
      });

      if (existingDbTailoredResume && existingTailoringAction !== "overwrite") {
        return {
          kind: "response",
          response: buildExistingTailoringConflictResponse({
            existingTailoring:
              buildDbCompletedExistingTailoringState(existingDbTailoredResume),
            profile,
          }),
        };
      }

      const existingTailoredResume = findTailoredResumeByJobUrl(
        profile.tailoredResumes,
        jobUrlResult.jobUrl,
      );

      if (existingTailoredResume && existingTailoringAction !== "overwrite") {
        return {
          kind: "response",
          response: buildExistingTailoringConflictResponse({
            existingTailoring:
              buildCompletedExistingTailoringState(existingTailoredResume),
            profile,
          }),
        };
      }

      if (existingTailoringAction === "overwrite") {
        await cancelActiveTailorResumeRuns({
          applicationId: application?.id ?? null,
          userId,
        });
      }

      const runId = await createTailorResumeRun({
        applicationId: application?.id ?? null,
        jobDescription,
        jobUrl: jobUrlResult.jobUrl,
        jobUrlHash: application?.jobUrlHash ?? null,
        userId,
      });
      const now = new Date().toISOString();
      const nextRawProfile: TailorResumeProfile = {
        ...rawProfile,
        workspace: {
          ...withTailorResumeWorkspaceInterviews(
            rawProfile.workspace,
            existingTailoringAction === "overwrite"
              ? readTailorResumeWorkspaceInterviews(rawProfile.workspace).filter(
                  (interview) =>
                    !matchesTailorResumeInterviewTarget(interview, {
                      applicationId: application?.id ?? null,
                      jobUrl: jobUrlResult.jobUrl,
                    }),
                )
              : readTailorResumeWorkspaceInterviews(rawProfile.workspace),
            now,
          ),
        },
      };

      await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);

      const overwriteApplicationIds =
        existingTailoringAction === "overwrite"
          ? uniqueNonEmptyStrings([
              application?.id,
              overwriteTargetApplicationId,
              existingDbTailoredResume?.applicationId,
              existingTailoredResume?.applicationId,
            ])
          : [];
      const overwriteTailoredResumeIds =
        existingTailoringAction === "overwrite"
          ? uniqueNonEmptyStrings([
              overwriteTargetTailoredResumeId,
              existingDbTailoredResume?.id,
              existingDbTailoredResume?.profileRecordId,
              existingTailoredResume?.id,
            ])
          : [];
      const overwriteJobUrls =
        existingTailoringAction === "overwrite"
          ? [
              jobUrlResult.jobUrl,
              existingDbTailoredResume?.jobUrl,
              existingTailoredResume?.jobUrl,
            ]
          : [];
      const dbOverwriteTargets =
        existingTailoringAction === "overwrite"
          ? await findDbTailoredResumeOverwriteTargets({
              applicationIds: overwriteApplicationIds,
              jobUrls: overwriteJobUrls,
              tailoredResumeIds: overwriteTailoredResumeIds,
              userId,
            })
          : [];
      const profileOverwriteTargetIds =
        existingTailoringAction === "overwrite"
          ? collectOverwrittenProfileTailoredResumeIds({
              applicationIds: uniqueNonEmptyStrings([
                ...overwriteApplicationIds,
                ...dbOverwriteTargets.map((record) => record.applicationId),
              ]),
              jobUrls: [
                ...overwriteJobUrls,
                ...dbOverwriteTargets.map((record) => record.jobUrl),
              ],
              profile: nextRawProfile,
              tailoredResumeIds: uniqueNonEmptyStrings([
                ...overwriteTailoredResumeIds,
                ...dbOverwriteTargets.map((record) => record.id),
                ...dbOverwriteTargets.map((record) => record.profileRecordId),
              ]),
            })
          : [];

      return {
        applicationId: application?.id ?? null,
        kind: "ready",
        jobDescription,
        jobUrl: jobUrlResult.jobUrl,
        lockedLinks,
        overwrittenDbTailoredResumeIds: uniqueNonEmptyStrings([
          ...dbOverwriteTargets.map((record) => record.id),
          ...dbOverwriteTargets.map((record) => record.profileRecordId),
        ]),
        overwrittenTailoredResumeIds: profileOverwriteTargetIds,
        rawProfile: nextRawProfile,
        runId,
      };
    });

  if (preparation.kind === "response") {
    return preparation.response!;
  }

  logTailorResumeDiagnostic({
    action: "tailor",
    message: "Accepted tailoring run.",
    runId: preparation.runId,
  });

  let lastStepEvent: TailorResumeGenerationStepEvent | null = null;
  const handleStepEvent = async (event: TailorResumeGenerationStepEvent) => {
    lastStepEvent = event;
    logTailorResumeDiagnostic({
      action: "tailor",
      message: "Tailoring step event.",
      runId: preparation.runId,
      stepEvent: event,
    });
    await updateTailorResumeRunStep({
      event,
      runId: preparation.runId,
      userId,
    });
    await options.onStepEvent?.(event);
  };
  const stopRunHeartbeat = startTailorResumeRunHeartbeat({
    runId: preparation.runId,
    userId,
  });

  try {
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
  const allowFollowUpQuestions =
    preparation.rawProfile.generationSettings.values
      .allowTailorResumeFollowUpQuestions;
  const userMarkdownForNonInteractiveRun = allowFollowUpQuestions
    ? undefined
    : await readTailorResumeUserMarkdown(userId);
  const planningStage = await planTailoredResume({
    annotatedLatexCode: processedBaseAnnotatedLatex.latexCode,
    jobDescription: preparation.jobDescription,
    onStepEvent: handleStepEvent,
    promptSettings: preparation.rawProfile.promptSettings.values,
    userMarkdown: userMarkdownForNonInteractiveRun,
  });

  if (!planningStage.ok) {
    await withTailorResumeProfileLock(userId, async () => {
      const latestState = await readTailorResumeProfileState(userId);
      const failedProfile =
        preparation.rawProfile.jobDescription !== preparation.jobDescription
          ? mergeTailorResumeFailedGeneration({
              currentRawProfile: latestState.rawProfile,
              jobDescription: preparation.jobDescription,
              snapshotRawProfile: preparation.rawProfile,
            })
          : latestState.rawProfile;

      if (failedProfile !== latestState.rawProfile) {
        await writeTailorResumeProfileAndMarkChanged(userId, failedProfile);
      }
    });

    const failureMessage = buildTailorResumeAttemptFailureMessage({
      attempts: planningStage.attempts,
      stepNumber: 1,
      validationError: planningStage.validationError,
    });

    await updateTailorResumeRunStatus({
      error: failureMessage,
      runId: preparation.runId,
      status: "FAILED",
      userId,
    });

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
  let userMarkdownForImplementation = userMarkdownForNonInteractiveRun;
  let shouldClearTailorResumeInterviewAfterGeneration = false;

  if (planningResult.changes.length > 0 && allowFollowUpQuestions) {
    const questioningStartedAt = Date.now();
    const reservation = await reserveTailorResumeQuestionDecision({
      accumulatedModelDurationMs,
      applicationId: preparation.applicationId,
      generationSourceSnapshot,
      jobDescription: preparation.jobDescription,
      jobUrl: preparation.jobUrl,
      planningDebug: planningStage.planningDebug,
      planningResult,
      runId: preparation.runId,
      sourceAnnotatedLatexCode: generationSourceAnnotatedLatex,
      userId,
    });

    if (reservation.kind === "stale") {
      const errorMessage =
        "The base resume changed, or this tailoring run was canceled or overwritten while Step 2 was being queued.";

      await updateTailorResumeRunStatus({
        error: errorMessage,
        runId: preparation.runId,
        status: "FAILED",
        userId,
      });
      return NextResponse.json(
        {
          error: `${errorMessage} Review the latest Tailor Resume state and try again.`,
          tailoredResumeDurationMs: accumulatedModelDurationMs,
        },
        { status: 409 },
      );
    }

    if (reservation.kind === "queued") {
      await handleStepEvent(buildTailorResumeChatQueuedStepEvent());

      return NextResponse.json({
        profile: mergeTailorResumeProfileWithLockedLinks(
          reservation.rawProfile,
          reservation.lockedLinks,
          {
            includeLockedOnly: true,
          },
        ),
        tailoredResumeDurationMs: accumulatedModelDurationMs,
        tailoringStatus: "chat_queued" as const,
      });
    }

    shouldClearTailorResumeInterviewAfterGeneration = true;
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

      await handleStepEvent({
        attempt: 1,
        detail: errorMessage,
        durationMs,
        retrying: false,
        status: "failed",
        stepCount: 4,
        stepNumber: 2,
        summary: "Preparing follow-up question for the user",
      });
      await updateTailorResumeRunStatus({
        error: errorMessage,
        runId: preparation.runId,
        status: "FAILED",
        userId,
      });
      await removeTailorResumeQuestionDecisionInterview({
        interviewId: reservation.interview.id,
        userId,
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
      await updateTailorResumeRunStatus({
        error: "Unable to save the tailoring follow-up memory update.",
        runId: preparation.runId,
        status: "FAILED",
        userId,
      });
      await removeTailorResumeQuestionDecisionInterview({
        interviewId: reservation.interview.id,
        userId,
      });
      return userMarkdownSaveResult.response;
    }

    userMarkdownAfterQuestioning = userMarkdownSaveResult.userMarkdown;
    userMarkdownForImplementation = undefined;

    if (questioningResult.action === "ask") {
      await handleStepEvent({
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
      const nextState = await promoteReadyTailorResumeInterview({
        accumulatedModelDurationMs,
        assistantMessage: buildTailorResumeInterviewAssistantText({
          assistantMessage: questioningResult.assistantMessage,
          planningResult,
        }),
        interview: reservation.interview,
        planningResult,
        questioningResult,
        userId,
      });

      if (!nextState) {
        await updateTailorResumeRunStatus({
          error:
            "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up questions were being prepared.",
          runId: preparation.runId,
          status: "FAILED",
          userId,
        });
        await removeTailorResumeQuestionDecisionInterview({
          interviewId: reservation.interview.id,
          userId,
        });
        return NextResponse.json(
          {
            error:
              "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up questions were being prepared. Review the latest Tailor Resume state and try again.",
            tailoredResumeDurationMs: accumulatedModelDurationMs,
            userMarkdown: userMarkdownAfterQuestioning,
          },
          { status: 409 },
        );
      }

      await updateTailorResumeRunStatus({
        runId: preparation.runId,
        status: "NEEDS_INPUT",
        userId,
      });

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
  } else if (planningResult.changes.length > 0) {
    // Hidden decision pass only; no user-facing Step 2 exists when questions
    // are disabled.
  } else {
    // Hidden decision pass only; no user-facing Step 2 exists without planned
    // edits to clarify.
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
    onStepEvent: handleStepEvent,
    planningDebug: planningStage.planningDebug,
    planningResult,
    planningSnapshot: planningStage.planningSnapshot,
    promptSettings: preparation.rawProfile.promptSettings.values,
    userMarkdown: userMarkdownForImplementation,
  });

    const response = await finalizeTailorResumeGeneration({
      applicationId: preparation.applicationId,
      clearTailoringInterview: shouldClearTailorResumeInterviewAfterGeneration,
      generationSourceAnnotatedLatex,
      generationSourceSnapshot,
      jobDescription: preparation.jobDescription,
      jobUrl: preparation.jobUrl,
      lockedLinks: preparation.lockedLinks,
      normalizedBaseLatex,
      onStepEvent: handleStepEvent,
      overwrittenDbTailoredResumeIds: preparation.overwrittenDbTailoredResumeIds,
      overwrittenTailoredResumeIds: preparation.overwrittenTailoredResumeIds,
      processedBaseSavedLinkUpdateCount: processedBaseAnnotatedLatex.updatedCount,
      processedBaseSavedLinkUpdates: processedBaseAnnotatedLatex.updatedLinks,
      rawProfile: preparation.rawProfile,
      runId: preparation.runId,
      tailoringResult,
      userId,
      userMarkdown: userMarkdownAfterQuestioning ?? userMarkdownForImplementation,
    });

    if (shouldClearTailorResumeInterviewAfterGeneration) {
      await drainTailorResumeQuestionQueue(userId);
    }

    return response;
  } catch (error) {
    return failTailorResumeRunAfterBackendError({
      error,
      fallbackMessage: "Unable to tailor the resume.",
      fallbackStepNumber: 1,
      fallbackSummary: "Generating plaintext edit outline",
      lastStepEvent,
      onStepEvent: handleStepEvent,
      runId: preparation.runId,
      userId,
    });
  } finally {
    stopRunHeartbeat();
  }
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
      const { lockedLinks, rawProfile } = await readTailorResumeProfileState(
        userId,
      );
      const tailoringInterview = findTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) => interview.id === interviewId,
      );

      if (!tailoringInterview) {
        return {
          kind: "response",
          response: NextResponse.json(
            { error: "There is no active tailoring interview to continue." },
            { status: 409 },
          ),
        };
      }

      const runId = tailoringInterview.tailorResumeRunId;

      await updateTailorResumeRunStatus({
        runId,
        status: "RUNNING",
        userId,
      });

      return {
        applicationId: tailoringInterview.applicationId,
        kind: "ready",
        lockedLinks,
        rawProfile,
        runId,
        tailoringInterview,
      };
    });

  if (preparation.kind === "response") {
    return preparation.response!;
  }

  logTailorResumeDiagnostic({
    action: "advanceTailorResumeInterview",
    interviewId,
    message: "Accepted interview answer.",
    runId: preparation.runId,
  });

  let lastStepEvent: TailorResumeGenerationStepEvent | null = null;
  const handleStepEvent = async (event: TailorResumeGenerationStepEvent) => {
    lastStepEvent = event;
    logTailorResumeDiagnostic({
      action: "advanceTailorResumeInterview",
      interviewId,
      message: "Interview step event.",
      runId: preparation.runId,
      stepEvent: event,
    });
    await updateTailorResumeRunStep({
      event,
      runId: preparation.runId,
      userId,
    });
    await options.onStepEvent?.(event);
  };
  const stopRunHeartbeat = startTailorResumeRunHeartbeat({
    runId: preparation.runId,
    userId,
  });

  try {
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

  await handleStepEvent({
    attempt: readTailorResumeInterviewAttempt(
      preparation.tailoringInterview.planningResult.questioningSummary,
    ),
    detail:
      "Processing the latest answer and deciding whether to ask another question or wrap up the follow-up chat.",
    durationMs: 0,
    retrying: false,
    status: "running",
    stepCount: 4,
    stepNumber: 2,
    summary: "Continuing the follow-up questions",
  });

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
    const errorMessage = formatTailorResumeStepError(
      2,
      error instanceof Error
        ? error.message
        : "Unable to continue the tailoring follow-up questions.",
    );

    await handleStepEvent({
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
    await updateTailorResumeRunStatus({
      error: errorMessage,
      runId: preparation.runId,
      status: "FAILED",
      userId,
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
    questioningResult.action === "done"
      ? ({
          ok: true,
          userMarkdown: userMarkdownBeforeQuestioning,
        } as const)
      : await persistTailorResumeUserMarkdownPatchResult({
          baseState: userMarkdownBeforeQuestioning,
          patchResult: questioningResult.userMarkdownPatchResult,
          userId,
        });

  if (!userMarkdownSaveResult.ok) {
    await updateTailorResumeRunStatus({
      error: "Unable to save the tailoring follow-up memory update.",
      runId: preparation.runId,
      status: "FAILED",
      userId,
    });
    return userMarkdownSaveResult.response;
  }

  const userMarkdownAfterQuestioning = userMarkdownSaveResult.userMarkdown;

  if (questioningResult.action === "ask") {
    await handleStepEvent({
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
      completionRequestedAt: null,
      conversation: [
        ...nextConversation,
        buildTailorResumeConversationMessage({
          role: "assistant",
          text: buildTailorResumeInterviewAssistantText({
            assistantMessage: questioningResult.assistantMessage,
            planningResult: nextPlanningResult,
          }),
          toolCalls: questioningResult.toolCalls,
        }),
      ],
      planningResult: nextPlanningResult,
      pendingUserMarkdownEditOperations: [],
      status: "ready",
      updatedAt: new Date().toISOString(),
    };
    const nextState = await withTailorResumeProfileLock(userId, async () => {
      const latestState = await readTailorResumeProfileState(userId);
      const latestInterview = findTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        (interview) => interview.id === interviewId,
      );
      const runStillActive = await isTailorResumeRunStillActive({
        runId: preparation.runId,
        userId,
      });

      if (
        !latestInterview ||
        latestInterview.id !== interviewId ||
        !runStillActive ||
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
        workspace: upsertTailorResumeWorkspaceInterview(
          latestState.rawProfile.workspace,
          nextInterview,
          new Date().toISOString(),
        ),
      };

      await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);

      return {
        lockedLinks: latestState.lockedLinks,
        rawProfile: nextRawProfile,
      };
    });

    if (!nextState) {
      await updateTailorResumeRunStatus({
        error:
          "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up questions were in progress.",
        runId: preparation.runId,
        status: "FAILED",
        userId,
      });
      return NextResponse.json(
        {
          error:
            "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up questions were in progress. Review the latest Tailor Resume state and try again.",
          tailoredResumeDurationMs: accumulatedModelDurationMs,
          userMarkdown: userMarkdownAfterQuestioning,
        },
        { status: 409 },
      );
    }

    await updateTailorResumeRunStatus({
      runId: preparation.runId,
      status: "NEEDS_INPUT",
      userId,
    });

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

  await handleStepEvent({
    attempt: readTailorResumeInterviewAttempt(
      preparation.tailoringInterview.planningResult.questioningSummary,
    ),
    detail:
      "The assistant thinks it has enough context. Confirm Done to wrap up, or keep chatting to clarify anything else.",
    durationMs: questioningResult.generationDurationMs,
    retrying: false,
    status: "running",
    stepCount: 4,
    stepNumber: 2,
    summary: "Waiting for you to finish or continue the follow-up chat",
  });

  if (questioningResult.action !== "done") {
    throw new Error(
      `Unsupported interview action while awaiting completion: ${questioningResult.action}.`,
    );
  }

  const completionRequestedAt = new Date().toISOString();
  const finalizedPlanningResult: TailorResumePlanningResult = {
    ...preparation.tailoringInterview.planningResult,
    questioningSummary: questioningResult.questioningSummary,
  };
  const nextInterview: TailorResumePendingInterview = {
    ...preparation.tailoringInterview,
    accumulatedModelDurationMs,
    completionRequestedAt,
    conversation: [
      ...nextConversation,
      buildTailorResumeConversationMessage({
        role: "assistant",
        text: questioningResult.completionMessage,
        toolCalls: questioningResult.toolCalls,
      }),
    ],
    planningResult: finalizedPlanningResult,
    pendingUserMarkdownEditOperations:
      questioningResult.userMarkdownEditOperations,
    status: "ready",
    updatedAt: completionRequestedAt,
  };
  const nextState = await withTailorResumeProfileLock(userId, async () => {
    const latestState = await readTailorResumeProfileState(userId);
    const latestInterview = findTailorResumeWorkspaceInterview(
      latestState.rawProfile.workspace,
      (interview) => interview.id === interviewId,
    );
    const runStillActive = await isTailorResumeRunStillActive({
      runId: preparation.runId,
      userId,
    });

    if (
      !latestInterview ||
      latestInterview.id !== interviewId ||
      !runStillActive ||
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
      workspace: upsertTailorResumeWorkspaceInterview(
        latestState.rawProfile.workspace,
        nextInterview,
        completionRequestedAt,
      ),
    };

    await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);

    return {
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });

  if (!nextState) {
    await updateTailorResumeRunStatus({
      error:
        "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up chat was wrapping up.",
      runId: preparation.runId,
      status: "FAILED",
      userId,
    });
    return NextResponse.json(
      {
        error:
          "The base resume changed, or this tailoring run was canceled or overwritten while the follow-up chat was wrapping up. Review the latest Tailor Resume state and try again.",
        tailoredResumeDurationMs: accumulatedModelDurationMs,
        userMarkdown: userMarkdownAfterQuestioning,
      },
      { status: 409 },
    );
  }

  await updateTailorResumeRunStatus({
    runId: preparation.runId,
    status: "NEEDS_INPUT",
    userId,
  });

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
  } catch (error) {
    return failTailorResumeRunAfterBackendError({
      error,
      fallbackMessage: "Unable to continue the tailoring follow-up questions.",
      fallbackStepNumber: 2,
      fallbackSummary: "Continuing the follow-up questions",
      lastStepEvent,
      onStepEvent: handleStepEvent,
      runId: preparation.runId,
      tailoredResumeDurationMs:
        preparation.tailoringInterview.accumulatedModelDurationMs,
      userId,
    });
  } finally {
    stopRunHeartbeat();
  }
}

async function handleCompleteTailorResumeInterview(
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

  if (!interviewId) {
    return NextResponse.json(
      { error: "Provide the tailoring interview id." },
      { status: 400 },
    );
  }

  const preparation: TailorResumeInterviewPreparation =
    await withTailorResumeProfileLock(userId, async () => {
      const { lockedLinks, rawProfile } = await readTailorResumeProfileState(
        userId,
      );
      const tailoringInterview = findTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) => interview.id === interviewId,
      );

      if (!tailoringInterview) {
        return {
          kind: "response",
          response: NextResponse.json(
            { error: "There is no active tailoring interview to finish." },
            { status: 409 },
          ),
        };
      }

      if (!tailoringInterview.completionRequestedAt) {
        return {
          kind: "response",
          response: NextResponse.json(
            {
              error:
                "The assistant has not asked to finish the follow-up chat yet.",
            },
            { status: 409 },
          ),
        };
      }

      if (
        hasTailorResumeGenerationSourceChanged({
          currentLockedLinks: lockedLinks,
          currentRawProfile: rawProfile,
          snapshot: tailoringInterview.generationSourceSnapshot,
        })
      ) {
        return {
          kind: "response",
          response: NextResponse.json(
            {
              error:
                "The base resume changed while the follow-up chat was waiting for confirmation. Review the latest Tailor Resume state and try again.",
            },
            { status: 409 },
          ),
        };
      }

      const runId = tailoringInterview.tailorResumeRunId;

      await updateTailorResumeRunStatus({
        runId,
        status: "RUNNING",
        userId,
      });

      return {
        applicationId: tailoringInterview.applicationId,
        kind: "ready",
        lockedLinks,
        rawProfile,
        runId,
        tailoringInterview,
      };
    });

  if (preparation.kind === "response") {
    return preparation.response!;
  }

  logTailorResumeDiagnostic({
    action: "completeTailorResumeInterview",
    interviewId,
    message: "Accepted interview completion request.",
    runId: preparation.runId,
  });

  let lastStepEvent: TailorResumeGenerationStepEvent | null = null;
  const handleStepEvent = async (event: TailorResumeGenerationStepEvent) => {
    lastStepEvent = event;
    logTailorResumeDiagnostic({
      action: "completeTailorResumeInterview",
      interviewId,
      message: "Interview completion step event.",
      runId: preparation.runId,
      stepEvent: event,
    });
    await updateTailorResumeRunStep({
      event,
      runId: preparation.runId,
      userId,
    });
    await options.onStepEvent?.(event);
  };
  const stopRunHeartbeat = startTailorResumeRunHeartbeat({
    runId: preparation.runId,
    userId,
  });

  try {
    const userMarkdownSaveResult =
      await persistTailorResumePendingInterviewUserMarkdown({
        tailoringInterview: preparation.tailoringInterview,
        userId,
      });

    if (!userMarkdownSaveResult.ok) {
      return userMarkdownSaveResult.response;
    }

    const response = await completeTailorResumeInterviewAndFinalize({
      applicationId: preparation.applicationId,
      lockedLinks: preparation.lockedLinks,
      onStepEvent: handleStepEvent,
      rawProfile: preparation.rawProfile,
      runId: preparation.runId,
      tailoringInterview: preparation.tailoringInterview,
      userId,
      userMarkdown: userMarkdownSaveResult.userMarkdown,
    });

    await drainTailorResumeQuestionQueue(userId);

    return response;
  } catch (error) {
    return failTailorResumeRunAfterBackendError({
      error,
      fallbackMessage: "Unable to finish the tailored resume.",
      fallbackStepNumber: 3,
      fallbackSummary: "Generating block-scoped edits",
      lastStepEvent,
      onStepEvent: handleStepEvent,
      runId: preparation.runId,
      tailoredResumeDurationMs:
        preparation.tailoringInterview.accumulatedModelDurationMs,
      userId,
    });
  } finally {
    stopRunHeartbeat();
  }
}

async function handleCancelTailorResumeInterview(userId: string) {
  const response = await withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);
    const tailoringInterview = rawProfile.workspace.tailoringInterview;

    if (!tailoringInterview) {
      return NextResponse.json(
        { error: "There is no active tailoring interview to cancel." },
        { status: 409 },
      );
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      workspace: removeTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) => interview.id === tailoringInterview.id,
      ),
    };

    await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);
    await updateTailorResumeRunStatus({
      runId: tailoringInterview.tailorResumeRunId,
      status: "CANCELLED",
      userId,
    });

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

  await drainTailorResumeQuestionQueue(userId);

  return response;
}

async function handleCancelCurrentTailoring(userId: string) {
  return withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);
    const tailoringInterviews = readTailorResumeWorkspaceInterviews(
      rawProfile.workspace,
    );
    const cancelledRuns = await getPrismaClient().tailorResumeRun.updateMany({
      data: {
        status: "CANCELLED",
      },
      where: {
        status: {
          in: ["RUNNING", "NEEDS_INPUT"],
        },
        userId,
      },
    });

    const nextRawProfile: TailorResumeProfile = tailoringInterviews.length > 0
      ? {
          ...rawProfile,
          workspace: withTailorResumeWorkspaceInterviews(
            rawProfile.workspace,
            [],
            new Date().toISOString(),
          ),
      }
      : rawProfile;

    if (tailoringInterviews.length > 0) {
      await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);
    } else if (cancelledRuns.count > 0) {
      await markTailoringChanged(userId);
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(
        nextRawProfile,
        lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      tailoringStatus:
        cancelledRuns.count > 0 || tailoringInterviews.length > 0
          ? ("current_tailoring_cancelled" as const)
          : ("current_tailoring_already_stopped" as const),
    });
  });
}

async function handleCancelExistingTailoring(
  body: Record<string, unknown>,
  userId: string,
) {
  const existingTailoringId =
    typeof body.existingTailoringId === "string"
      ? body.existingTailoringId.trim()
      : "";

  if (!existingTailoringId) {
    return NextResponse.json(
      { error: "Provide the tailoring run id to cancel." },
      { status: 400 },
    );
  }

  return withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);
    const shouldCancelInterview = Boolean(
      findTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) =>
          interview.tailorResumeRunId === existingTailoringId ||
          interview.id === existingTailoringId,
      ),
    );
    const cancelledRun = await getPrismaClient().tailorResumeRun.updateMany({
      data: {
        status: "CANCELLED",
      },
      where: {
        id: existingTailoringId,
        status: {
          in: ["RUNNING", "NEEDS_INPUT"],
        },
        userId,
      },
    });

    if (cancelledRun.count === 0 && !shouldCancelInterview) {
      return NextResponse.json(
        { error: "That tailoring run is no longer active." },
        { status: 409 },
      );
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      workspace: shouldCancelInterview
        ? removeTailorResumeWorkspaceInterview(
            rawProfile.workspace,
            (interview) =>
              interview.tailorResumeRunId === existingTailoringId ||
              interview.id === existingTailoringId,
          )
        : rawProfile.workspace,
    };

    await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(
        nextRawProfile,
        lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      tailoringStatus: "existing_tailoring_cancelled" as const,
    });
  });
}

async function handleCancelTailoringByJobUrl(
  body: Record<string, unknown>,
  userId: string,
) {
  const jobUrl =
    typeof body.jobUrl === "string" ? body.jobUrl.trim() : "";
  const normalizedJobUrl = normalizeTailorResumeJobUrl(jobUrl);
  const jobUrlHash = buildTailorResumeJobUrlHash(normalizedJobUrl);

  if (!normalizedJobUrl || !jobUrlHash) {
    return NextResponse.json(
      { error: "Provide the job URL for the tailoring run you want to stop." },
      { status: 400 },
    );
  }

  return withTailorResumeProfileLock(userId, async () => {
    const { lockedLinks, rawProfile } = await readTailorResumeProfileState(userId);
    const matchingInterview = findTailorResumeWorkspaceInterview(
      rawProfile.workspace,
      (interview) =>
        normalizeTailorResumeJobUrl(interview.jobUrl) === normalizedJobUrl,
    );
    const cancelledRuns = await getPrismaClient().tailorResumeRun.updateMany({
      data: {
        status: "CANCELLED",
      },
      where: {
        jobUrlHash,
        status: {
          in: ["RUNNING", "NEEDS_INPUT"],
        },
        userId,
      },
    });

    if (cancelledRuns.count === 0 && !matchingInterview) {
      return NextResponse.json(
        { error: "That tailoring run is no longer active." },
        { status: 409 },
      );
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      workspace: removeTailorResumeWorkspaceInterview(
        rawProfile.workspace,
        (interview) =>
          normalizeTailorResumeJobUrl(interview.jobUrl) === normalizedJobUrl,
      ),
    };

    if (nextRawProfile !== rawProfile) {
      await writeTailorResumeProfileAndMarkChanged(userId, nextRawProfile);
    } else if (cancelledRuns.count > 0) {
      await markTailoringChanged(userId);
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(
        nextRawProfile,
        lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      tailoringStatus: "current_tailoring_cancelled" as const,
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
  const stream = new ReadableStream({
    start(controller) {
      const writer = createNdjsonStreamWriter(controller);

      void (async () => {
        try {
          const response = await run((stepEvent) => {
            writer.sendEvent({
              stepEvent,
              type: "generation-step",
            });
          });

          if (!response) {
            throw new Error("Tailor Resume generation did not return a response.");
          }

          const payload = (await response.json()) as Record<string, unknown>;

          writer.sendEvent({
            ok: response.ok,
            payload,
            status: response.status,
            type: "done",
          });
        } catch (error) {
          writer.sendEvent({
            error:
              error instanceof Error
                ? error.message
                : "Unable to tailor the resume.",
            type: "error",
          });
        } finally {
          writer.close();
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

  await writeTailorResumeProfileAndMarkChanged(input.userId, nextRawProfile);

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

  await writeTailorResumeProfileAndMarkChanged(userId, extractingProfile);

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

    await writeTailorResumeProfileAndMarkChanged(userId, readyRawProfile);
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

    await writeTailorResumeProfileAndMarkChanged(userId, failedRawProfile);
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

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const includeApplications = readIncludeApplicationsFlag(request);
  const applicationSummaryLimit = readApplicationSummaryLimit(request);

  await cleanupInvalidTailorResumeArtifacts(session.user.id);

  const [
    { activeRun, activeRuns, profile, rawProfile },
    syncState,
    userMarkdown,
    applicationSummary,
  ] = await Promise.all([
    readTailorResumeResponseState(session.user.id),
    readUserSyncStateSnapshotForUser(session.user.id),
    readTailorResumeUserMarkdown(session.user.id),
    includeApplications
      ? readApplicationSummaryPayload({
          limit: applicationSummaryLimit,
          userId: session.user.id,
        })
      : Promise.resolve(null),
  ]);
  const activeTailoringInterviews = readTailorResumeWorkspaceInterviews(
    rawProfile.workspace,
  );
  const activeTailorings = buildActiveTailoringStates({
    activeRuns,
    tailoringInterviews: activeTailoringInterviews,
  });
  const existingTailoring =
    activeTailorings[0] ??
    (activeRun ? buildActiveRunExistingTailoringState(activeRun) : null);

  return NextResponse.json({
    activeTailorings,
    ...(applicationSummary ?? {}),
    existingTailoring,
    profile,
    syncState,
    userMarkdown,
  });
}

export async function PATCH(request: Request) {
  const session = await getApiSession(request);

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

  if ("action" in body && body.action === "completeTailorResumeInterview") {
    if (wantsTailorResumeStream(request)) {
      return buildTailorResumeGenerationStreamResponse((onStepEvent) =>
        handleCompleteTailorResumeInterview(
          body as Record<string, unknown>,
          session.user.id,
          {
            onStepEvent,
          },
        ),
      );
    }

    return handleCompleteTailorResumeInterview(
      body as Record<string, unknown>,
      session.user.id,
    );
  }

  if ("action" in body && body.action === "cancelTailorResumeInterview") {
    return handleCancelTailorResumeInterview(session.user.id);
  }

  if ("action" in body && body.action === "cancelCurrentTailoring") {
    return handleCancelCurrentTailoring(session.user.id);
  }

  if ("action" in body && body.action === "cancelTailoringByJobUrl") {
    return handleCancelTailoringByJobUrl(
      body as Record<string, unknown>,
      session.user.id,
    );
  }

  if ("action" in body && body.action === "cancelExistingTailoring") {
    return handleCancelExistingTailoring(
      body as Record<string, unknown>,
      session.user.id,
    );
  }

  if ("action" in body && body.action === "saveUserMarkdown") {
    return saveTailorResumeUserMarkdownAction(
      session.user.id,
      body as Record<string, unknown>,
      {
        onSaved: () => markTailoringChanged(session.user.id),
      },
    );
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
      return saveTailorResumePromptSettingsAction({
        body: body as Record<string, unknown>,
        lockedLinks,
        rawProfile,
        userId: session.user.id,
      });
    }

    if ("action" in body && body.action === "saveGenerationSettings") {
      return saveTailorResumeGenerationSettingsAction({
        body: body as Record<string, unknown>,
        lockedLinks,
        rawProfile,
        userId: session.user.id,
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

    await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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

    const deleteResult = await deleteLinkedDashboardArtifactsWithinLockedProfile({
      lockedLinks,
      rawProfile,
      tailoredResumeId: tailoredResume.id,
      userId: session.user.id,
    });

    if (deleteResult.impact.tailoredResumeCount === 0) {
      return NextResponse.json(
        { error: "The tailored resume could not be found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      deleteImpact: deleteResult.impact,
      profile: mergeTailorResumeProfileWithLockedLinks(
        deleteResult.rawProfile,
        deleteResult.lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "deleteTailoredResumeArtifact") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const tailorRunId =
      "tailorRunId" in body && typeof body.tailorRunId === "string"
        ? body.tailorRunId.trim()
        : "";
    const jobUrl =
      "jobUrl" in body && typeof body.jobUrl === "string"
        ? body.jobUrl.trim()
        : "";
    const normalizedJobUrl = normalizeTailorResumeJobUrl(jobUrl);
    const matchingTailoredResumes = rawProfile.tailoredResumes.filter((record) => {
      if (tailoredResumeId && record.id === tailoredResumeId) {
        return true;
      }

      return Boolean(
        normalizedJobUrl &&
          normalizeTailorResumeJobUrl(record.jobUrl) === normalizedJobUrl,
      );
    });
    const matchingInterviewIds = new Set(
      readTailorResumeWorkspaceInterviews(rawProfile.workspace)
        .filter(
          (interview) =>
            Boolean(
              tailorRunId &&
                (interview.tailorResumeRunId === tailorRunId ||
                  interview.id === tailorRunId),
            ) ||
            Boolean(
              normalizedJobUrl &&
                normalizeTailorResumeJobUrl(interview.jobUrl) === normalizedJobUrl,
            ),
        )
        .map((interview) => interview.id),
    );
    const shouldClearInterview = matchingInterviewIds.size > 0;

    if (!tailoredResumeId && !tailorRunId && !normalizedJobUrl) {
      return NextResponse.json(
        { error: "Provide the tailoring artifact you want to delete." },
        { status: 400 },
      );
    }

    if (
      matchingTailoredResumes.length === 0 &&
      !shouldClearInterview &&
      !tailorRunId &&
      !normalizedJobUrl
    ) {
      return NextResponse.json(
        { error: "The tailoring artifact could not be found." },
        { status: 404 },
      );
    }

    await deleteTailorResumeArtifacts({
      jobUrls: [
        normalizedJobUrl,
        ...matchingTailoredResumes.map((record) => record.jobUrl),
      ],
      runIds: tailorRunId ? [tailorRunId] : [],
      tailoredResumeIds: [
        tailoredResumeId,
        ...matchingTailoredResumes.map((record) => record.id),
      ],
      userId: session.user.id,
    });

    const deletedTailoredResumeIds = new Set(
      uniqueNonEmptyStrings([
        tailoredResumeId,
        ...matchingTailoredResumes.map((record) => record.id),
      ]),
    );
    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      tailoredResumes: rawProfile.tailoredResumes.filter(
        (record) => !deletedTailoredResumeIds.has(record.id),
      ),
      workspace: shouldClearInterview
        ? removeTailorResumeWorkspaceInterview(
            rawProfile.workspace,
            (interview) => matchingInterviewIds.has(interview.id),
          )
        : rawProfile.workspace,
    };

    if (
      nextRawProfile !== rawProfile ||
      deletedTailoredResumeIds.size > 0 ||
      shouldClearInterview
    ) {
      await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeId: tailoredResumeId || matchingTailoredResumes[0]?.id || null,
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
      await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);
      await getPrismaClient().tailoredResume.updateMany({
        data: {
          displayName: nextDisplayName,
        },
        where: {
          profileRecordId: tailoredResumeId,
          userId: session.user.id,
        },
      });
    }

    return NextResponse.json({
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "setTailoredResumeArchivedState") {
    const tailoredResumeId =
      "tailoredResumeId" in body && typeof body.tailoredResumeId === "string"
        ? body.tailoredResumeId.trim()
        : "";
    const archived =
      "archived" in body && typeof body.archived === "boolean"
        ? body.archived
        : null;

    if (!tailoredResumeId || archived === null) {
      return NextResponse.json(
        { error: "Provide the tailored resume and whether it should be archived." },
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

    const currentTailoredResume = rawProfile.tailoredResumes[tailoredResumeIndex];
    const isCurrentlyArchived = Boolean(currentTailoredResume.archivedAt);
    const nextUpdatedAt = new Date().toISOString();
    const nextRawProfile: TailorResumeProfile =
      isCurrentlyArchived === archived
        ? rawProfile
        : {
            ...rawProfile,
            tailoredResumes: rawProfile.tailoredResumes.map((record, index) =>
              index === tailoredResumeIndex
                ? {
                    ...record,
                    archivedAt: archived
                      ? record.archivedAt ?? nextUpdatedAt
                      : null,
                    updatedAt: nextUpdatedAt,
                  }
                : record,
            ),
          };

    if (nextRawProfile !== rawProfile) {
      await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);
      await getPrismaClient().tailoredResume.updateMany({
        data: {
          archivedAt: archived ? new Date(nextUpdatedAt) : null,
        },
        where: {
          profileRecordId: tailoredResumeId,
          userId: session.user.id,
        },
      });
    }

    return NextResponse.json({
      archived,
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeId,
    });
  }

  if ("action" in body && body.action === "archiveAllTailoredResumes") {
    const nextUpdatedAt = new Date().toISOString();
    const archiveTargetIds = rawProfile.tailoredResumes
      .filter((record) => !record.archivedAt)
      .map((record) => record.id);
    const archiveTargetIdSet = new Set(archiveTargetIds);

    const nextRawProfile: TailorResumeProfile =
      archiveTargetIds.length === 0
        ? rawProfile
        : {
            ...rawProfile,
            tailoredResumes: rawProfile.tailoredResumes.map((record) =>
              archiveTargetIdSet.has(record.id)
                ? {
                    ...record,
                    archivedAt: nextUpdatedAt,
                    updatedAt: nextUpdatedAt,
                  }
                : record,
            ),
          };

    if (nextRawProfile !== rawProfile) {
      await writeTailorResumeProfile(session.user.id, nextRawProfile);

      const prisma = getPrismaClient();
      await prisma.$transaction([
        prisma.tailoredResume.updateMany({
          data: {
            archivedAt: new Date(nextUpdatedAt),
          },
          where: {
            archivedAt: null,
            profileRecordId: {
              in: archiveTargetIds,
            },
            userId: session.user.id,
          },
        }),
        prisma.userSyncState.upsert({
          create: {
            applicationsVersion: 0,
            tailoringVersion: 1,
            userId: session.user.id,
          },
          select: {
            tailoringVersion: true,
          },
          update: {
            tailoringVersion: {
              increment: 1,
            },
          },
          where: {
            userId: session.user.id,
          },
        }),
      ]);
    }

    return NextResponse.json({
      archived: true,
      archivedCount: archiveTargetIds.length,
      profile: mergeTailorResumeProfileWithLockedLinks(nextRawProfile, lockedLinks, {
        includeLockedOnly: true,
      }),
      tailoredResumeIds: archiveTargetIds,
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

    await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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

    await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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

    await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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

      await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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

  await writeTailorResumeProfileAndMarkChanged(session.user.id, nextRawProfile);

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
  const session = await getApiSession(request);

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

    await writeTailorResumeProfileAndMarkChanged(session.user.id, profileWithSavedResume);
    await deleteTailorResumePreviewPdf(session.user.id);

    if (wantsTailorResumeUploadStream(request)) {
      const stream = new ReadableStream({
        start(controller) {
          const writer = createNdjsonStreamWriter(controller);

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
                    writer.sendEvent({
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

              writer.sendEvent({
                payload: buildExtractionResponse(extractionResult),
                type: "done",
              });
            } catch (error) {
              writer.sendEvent({
                error:
                  error instanceof Error
                    ? error.message
                    : "Unable to save the resume.",
                type: "error",
              });
            } finally {
              writer.close();
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
