import OpenAI from "openai";
import { trackAiModelUsage } from "./ai-usage.ts";
import {
  buildTailorResumePageCountCompactionInstructions,
  buildTailorResumePageCountCompactionPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import {
  tailorResumeDebugErrorSources,
} from "./tailor-resume-debug-errors.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import { buildTailorResumeKeywordCheckResult } from "./tailor-resume-keyword-coverage.ts";
import {
  countPdfPages,
  estimateTailorResumeOverflowLines,
  indexTailorResumeSegmentMeasurements,
  measureTailorResumeLayout,
  type TailorResumeLayoutMeasurement,
} from "./tailor-resume-layout-measurement.ts";
import {
  measureTailorResumeLineReductionCandidates,
  type TailorResumeLineReductionCandidate,
  type TailorResumeLineReductionMeasurement,
  type TailorResumeLineReductionToolResult,
} from "./tailor-resume-line-reduction-candidates.ts";
import {
  getRetryAttemptsToGeneratePageCountCompaction,
} from "./tailor-resume-retry-config.ts";
import { runWithTransientModelRetries } from "./tailor-resume-transient-retry.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  buildTailorResumeRenderedBulletHealthCheck,
} from "./tailor-resume-rendered-bullet-health.ts";
import { buildTailoredResumeBlockEdits } from "./tailor-resume-review.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";
import {
  applyTailorResumeBlockChanges,
  createTailorResumeStepAttemptTimeout,
  createTailorResumeStepTimeout,
  isTailorResumeStepTimeoutError,
} from "./tailor-resume-tailoring.ts";
import {
  resolveTailoredResumeCurrentEditLatexCode,
} from "./tailor-resume-edit-history.ts";
import {
  filterTailorResumeSpareBulletsForSearch,
  type TailorResumeSpareBulletSearchMode,
} from "./tailor-resume-spare-bullet-search.ts";
import type {
  TailorResumeGenerationStepEvent,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeBlockEditRecord,
  TailoredResumeThesis,
  TailorResumeStoredSkillData,
} from "./tailor-resume-types.ts";

export type TailorResumePageCountCompactionResult = {
  annotatedLatexCode: string;
  edits: TailoredResumeBlockEditRecord[];
  generationDurationMs: number;
  latexCode: string;
  model: string;
  pageCount: number;
  previewPdf: Buffer;
  validationError: string | null;
};

type TailorResumeCompactionResponse = {
  id?: string;
  model?: string;
  output?: TailorResumeCompactionOutputItem[];
  output_text?: string;
};

function resolveTailorResumeCompactionModel(inputModel?: string) {
  return (
    inputModel ??
    process.env.OPENAI_TAILOR_RESUME_COMPACTION_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5-mini"
  );
}

type TailorResumeCompactionOutputItem = {
  arguments?: string;
  call_id?: string;
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  name?: string;
  type?: string;
};

type TailorResumeCompactionResponseInput = Array<
  | {
      content: Array<{
        text: string;
        type: "input_text";
      }>;
      role: "user";
    }
  | {
      call_id: string;
      output: string;
      type: "function_call_output";
    }
>;

type TailorResumeCompactionToolCall = {
  arguments: string;
  call_id: string;
  name: string;
};

type TailorResumeCompactionAttemptHistoryEntry = {
  attempt: number;
  detail: string;
  estimatedLinesToRecover: number;
  measurementResult: TailorResumeLineReductionToolResult | null;
  pageCountVerification: TailorResumePageCountVerificationToolResult | null;
};

type TailorResumePageCountCompactionDebugContext = {
  applicationId?: string | null;
  jobUrl?: string | null;
  runId?: string | null;
  tailoredResumeId?: string | null;
  userId: string;
};

type TailorResumePageCountCompactionDebugRecord = {
  attempt: number;
  detail: string;
  latexCode: string;
  source: string;
};

type TailorResumeCompactionToolTranscriptEntry = {
  callId: string | null;
  input: string | null;
  output: string | null;
  responseId: string | null;
  round: number;
  toolName: string;
};

type TailorResumeCompactionAttemptTranscript = {
  attempt: number;
  currentPageCount: number;
  endedAt: string | null;
  estimatedLinesToRecover: number;
  finalError: string | null;
  finalOk: boolean;
  initialInput: TailorResumeCompactionResponseInput;
  latestMeasurementResult: TailorResumeLineReductionToolResult | null;
  latestPageCountVerification: TailorResumePageCountVerificationToolResult | null;
  model: string;
  startedAt: string;
  targetPageCount: number;
  toolCalls: TailorResumeCompactionToolTranscriptEntry[];
};

type TailorResumeCompactionSelfCheckResult =
  | {
      candidates: TailorResumeLineReductionCandidate[];
      measurementResult: TailorResumeLineReductionToolResult | null;
      pageCountVerification: TailorResumePageCountVerificationToolResult | null;
      model: string;
      ok: true;
      transcript: TailorResumeCompactionAttemptTranscript;
    }
  | {
      error: string;
      measurementResult: TailorResumeLineReductionToolResult | null;
      pageCountVerification: TailorResumePageCountVerificationToolResult | null;
      model: string;
      ok: false;
      transcript: TailorResumeCompactionAttemptTranscript;
    };

type TailorResumePageCountVerificationToolResult = {
  canSubmitFinalCandidates: boolean;
  currentPageCount: number;
  fitsTargetPageCount: boolean;
  nextAction: string;
  pageCountDelta: number | null;
  targetPageCount: number;
  validationError: string | null;
  verifiedCandidateCount: number;
  verifiedPageCount: number | null;
};

const tailorResumeLineReductionToolName = "measure_resume_line_reductions";
const tailorResumePageCountVerificationToolName = "verify_resume_page_count";
const tailorResumeKeywordUsageToolName = "list_current_resume_keyword_usage";
const tailorResumeMalformedBulletsToolName = "list_malformed_resume_bullets";
const tailorResumeSingleSkillQueryToolName = "query_single_resume_skill";
const tailorResumeBatchSkillQueryToolName = "batch_query_resume_skills";
const maxCompactionSelfCheckRounds = 30;
const maxCompactionHistoryAttemptsForPrompt = 3;
const maxCompactionMeasurementsPerAttemptForPrompt = 6;
const tailorResumeCompactionMaxOutputTokens = 8192;

const tailorResumeLineReductionTool = {
  type: "function",
  name: tailorResumeLineReductionToolName,
  description:
    "Measure proposed compacted replacements inside the current full resume and report which candidates create a user-visible exact rendered PDF line-count reduction.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

const tailorResumeLineReductionSubmissionToolName =
  "submit_verified_line_reductions";

const tailorResumePageCountVerificationTool = {
  type: "function",
  name: tailorResumePageCountVerificationToolName,
  description:
    "Compile the full resume with a measured candidate set applied and report the exact rendered PDF page count using the same final page-count check as acceptance.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

const tailorResumeKeywordUsageTool = {
  type: "function",
  name: tailorResumeKeywordUsageToolName,
  description:
    "List which job keywords are present or missing in the most updated full resume draft after applying the candidate page-fit replacements supplied in this tool call. Use candidates: [] to inspect the current compacted draft with no extra replacements.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

const tailorResumeMalformedBulletsTool = {
  type: "function",
  name: tailorResumeMalformedBulletsToolName,
  description:
    "Return every malformed rendered bullet in the most updated full resume draft after applying the candidate page-fit replacements supplied in this tool call. Use candidates: [] to inspect the current compacted draft with no extra replacements.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

const tailorResumeSkillQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      type: "string",
      enum: ["skills", "body", "both"],
      description:
        "Where to search saved resume-bullet support: skills searches attached skill names, body searches quote/replacesQuote text, both searches both.",
    },
    query: {
      type: "string",
      description: "Keyword or short phrase to search for in saved resume-bullet support.",
    },
  },
  required: ["query", "mode"],
} as const;

const tailorResumeSingleSkillQueryTool = {
  type: "function",
  name: tailorResumeSingleSkillQueryToolName,
  description:
    "Query saved resume-bullet support once and return only the top matching saved bullet, or null if no saved bullet matches.",
  strict: true,
  parameters: tailorResumeSkillQueryParameters,
} as const;

const tailorResumeBatchSkillQueryTool = {
  type: "function",
  name: tailorResumeBatchSkillQueryToolName,
  description:
    "Query saved resume-bullet support for many keywords in one call. Each query has its own skills/body/both mode, and each result is the top matching saved bullet or null.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      queries: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        items: tailorResumeSkillQueryParameters,
      },
    },
    required: ["queries"],
  },
} as const;

const tailorResumeLineReductionSubmissionTool = {
  type: "function",
  name: tailorResumeLineReductionSubmissionToolName,
  description:
    "Submit the page-fit candidates for this pass after you have used the measurement tool and the exact page-count verification tool on that same candidate set.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
      verificationSummary: { type: "string" },
    },
    required: ["candidates", "verificationSummary"],
  },
} as const;

const knownCompactionToolNames = new Set([
  tailorResumeLineReductionToolName,
  tailorResumePageCountVerificationToolName,
  tailorResumeLineReductionSubmissionToolName,
  tailorResumeKeywordUsageToolName,
  tailorResumeMalformedBulletsToolName,
  tailorResumeSingleSkillQueryToolName,
  tailorResumeBatchSkillQueryToolName,
]);

function formatCompactionDebugJsonText(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function createCompactionAttemptTranscript(input: {
  attempt: number;
  currentPageCount: number;
  estimatedLinesToRecover: number;
  initialInput: TailorResumeCompactionResponseInput;
  model: string;
  targetPageCount: number;
}): TailorResumeCompactionAttemptTranscript {
  return {
    attempt: input.attempt,
    currentPageCount: input.currentPageCount,
    endedAt: null,
    estimatedLinesToRecover: input.estimatedLinesToRecover,
    finalError: null,
    finalOk: false,
    initialInput: input.initialInput,
    latestMeasurementResult: null,
    latestPageCountVerification: null,
    model: input.model,
    startedAt: new Date().toISOString(),
    targetPageCount: input.targetPageCount,
    toolCalls: [],
  };
}

function finishCompactionAttemptTranscript(
  transcript: TailorResumeCompactionAttemptTranscript,
  input: {
    error?: string | null;
    measurementResult: TailorResumeLineReductionToolResult | null;
    model: string;
    ok: boolean;
    pageCountVerification: TailorResumePageCountVerificationToolResult | null;
  },
) {
  transcript.endedAt = new Date().toISOString();
  transcript.finalError = input.error ?? null;
  transcript.finalOk = input.ok;
  transcript.latestMeasurementResult = input.measurementResult;
  transcript.latestPageCountVerification = input.pageCountVerification;
  transcript.model = input.model;
  return transcript;
}

function pushCompactionToolTranscript(input: {
  responseId?: string | null;
  round: number;
  toolCall: TailorResumeCompactionToolCall;
  toolOutput: string | null;
  transcript: TailorResumeCompactionAttemptTranscript;
}) {
  input.transcript.toolCalls.push({
    callId: input.toolCall.call_id,
    input: formatCompactionDebugJsonText(input.toolCall.arguments),
    output: input.toolOutput
      ? formatCompactionDebugJsonText(input.toolOutput)
      : null,
    responseId: input.responseId ?? null,
    round: input.round,
    toolName: input.toolCall.name,
  });
}

async function logTailorResumeCompactionTranscript(input: {
  context?: TailorResumePageCountCompactionDebugContext | null;
  detail: string;
  onDebugRecord?: (
    record: TailorResumePageCountCompactionDebugRecord,
  ) => void | Promise<void>;
  transcript: TailorResumeCompactionAttemptTranscript;
}) {
  if (!input.onDebugRecord) {
    return;
  }

  await input.onDebugRecord({
    attempt: input.transcript.attempt,
    detail: input.detail,
    latexCode: JSON.stringify(
      {
        applicationId: input.context?.applicationId ?? null,
        jobUrl: input.context?.jobUrl ?? null,
        kind: "tailor_resume_page_count_compaction_transcript",
        runId: input.context?.runId ?? null,
        tailoredResumeId: input.context?.tailoredResumeId ?? null,
        transcript: input.transcript,
      },
      null,
      2,
    ),
    source: tailorResumeDebugErrorSources.pageCountCompactionTranscript,
  });
}

function mapCompactionResponse(response: {
  id?: string;
  model?: string | null;
  output?: Array<{
    arguments?: unknown;
    call_id?: unknown;
    content?: unknown;
    name?: unknown;
    type?: unknown;
  }>;
  output_text?: string | null;
}): TailorResumeCompactionResponse {
  return {
    id: response.id,
    model: response.model ?? undefined,
    output:
      response.output?.map((outputItem) => {
        const mappedItem: TailorResumeCompactionOutputItem = {
          type: typeof outputItem.type === "string" ? outputItem.type : undefined,
        };

        if (typeof outputItem.name === "string") {
          mappedItem.name = outputItem.name;
        }

        if (typeof outputItem.call_id === "string") {
          mappedItem.call_id = outputItem.call_id;
        }

        if (typeof outputItem.arguments === "string") {
          mappedItem.arguments = outputItem.arguments;
        }

        if (Array.isArray(outputItem.content)) {
          mappedItem.content = outputItem.content.flatMap((contentItem) => {
            if (!contentItem || typeof contentItem !== "object") {
              return [];
            }

            const mappedContent: { text?: string; type?: string } = {};

            if ("text" in contentItem && typeof contentItem.text === "string") {
              mappedContent.text = contentItem.text;
            }

            if ("type" in contentItem && typeof contentItem.type === "string") {
              mappedContent.type = contentItem.type;
            }

            return [mappedContent];
          });
        }

        return mappedItem;
      }) ?? [],
    output_text: response.output_text ?? undefined,
  };
}

function findCompactionToolCall(
  response: TailorResumeCompactionResponse,
): TailorResumeCompactionToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      typeof outputItem.name === "string" &&
      knownCompactionToolNames.has(outputItem.name) &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: outputItem.name,
      };
    }
  }

  return null;
}

function parseCompactionSubmissionCandidates(
  value: unknown,
): TailorResumeLineReductionCandidate[] {
  const candidates = parseLineReductionCandidates(value);

  if (candidates.length === 0) {
    throw new Error("The final compaction submission did not include any candidates.");
  }

  return candidates;
}

function describeLineReductionRejectionReason(reason: string | null) {
  if (!reason) {
    return "accepted";
  }

  if (reason.startsWith("candidate_failed_to_compile_or_measure:")) {
    return reason.replace(
      "candidate_failed_to_compile_or_measure:",
      "candidate failed to compile or measure:",
    );
  }

  switch (reason) {
    case "unknown_or_uneditable_segment":
      return "The segment was unknown or is no longer editable in the page-fit guardrail.";
    case "duplicate_candidate_for_segment":
      return "The same segment was proposed more than once in the same measurement pass.";
    case "current_segment_line_count_unavailable":
      return "The current block's rendered line count was unavailable.";
    case "candidate_segment_line_count_unavailable":
      return "The candidate block's rendered line count was unavailable after measurement.";
    case "candidate_did_not_reduce_rendered_line_count":
      return "The candidate still rendered to the same number of lines as the current replacement.";
    default:
      return reason.replace(/_/g, " ");
  }
}

function serializeMeasurementForPrompt(
  input: {
    label: "accepted" | "rejected";
    measurement: TailorResumeLineReductionMeasurement;
  },
) {
  return [
    `- ${input.label} ${input.measurement.candidate.segmentId}: current ${input.measurement.previousLineCount ?? "?"} -> candidate ${input.measurement.candidateLineCount ?? "?"} rendered lines, original ${input.measurement.originalLineCount ?? "?"}`,
    `  candidate reason: ${truncateForPrompt(input.measurement.candidate.reason, 180)}`,
    `  candidate latex: ${truncateForPrompt(input.measurement.candidate.latexCode, 260)}`,
    ...(input.measurement.rejectionReason
      ? [
          `  rejection: ${describeLineReductionRejectionReason(
            input.measurement.rejectionReason,
          )}`,
        ]
      : []),
  ].join("\n");
}

function buildLineReductionToolOutput(input: {
  estimatedLinesToRecover: number;
  result: TailorResumeLineReductionToolResult;
}) {
  const acceptedRenderedLineReduction = input.result.accepted.reduce(
    (sum, measurement) =>
      sum + (measurement.previousLineCount - measurement.candidateLineCount),
    0,
  );

  return JSON.stringify(
    {
      accepted: input.result.accepted.map((measurement) => ({
        candidateLineCount: measurement.candidateLineCount,
        latexCode: measurement.candidate.latexCode,
        originalLineCount: measurement.originalLineCount,
        previousLineCount: measurement.previousLineCount,
        reason: measurement.candidate.reason,
        renderedLineReduction:
          measurement.previousLineCount - measurement.candidateLineCount,
        segmentId: measurement.candidate.segmentId,
      })),
      acceptedRenderedLineReduction,
      canSubmitFinalCandidates: input.result.accepted.length > 0,
      estimatedLinesStillNeeded: Math.max(
        0,
        input.estimatedLinesToRecover - acceptedRenderedLineReduction,
      ),
      nextAction:
        input.result.accepted.length > 0
          ? `Call ${tailorResumePageCountVerificationToolName} with only the accepted candidates you actually want to apply, or measure a revised set if you want a different tradeoff.`
          : `Revise the candidates and call ${tailorResumeLineReductionToolName} again. Do not submit final candidates until at least one measurement is accepted.`,
      rejected: input.result.rejected.map((measurement) => ({
        candidateLineCount: measurement.candidateLineCount,
        latexCode: measurement.candidate.latexCode,
        originalLineCount: measurement.originalLineCount,
        previousLineCount: measurement.previousLineCount,
        reason: measurement.candidate.reason,
        rejectionGuidance: describeLineReductionRejectionReason(
          measurement.rejectionReason,
        ),
        rejectionReason: measurement.rejectionReason,
        segmentId: measurement.candidate.segmentId,
      })),
    },
    null,
    2,
  );
}

function buildAnnotatedLatexWithInspectionCandidates(input: {
  candidates: TailorResumeLineReductionCandidate[];
  sourceAnnotatedLatexCode: string;
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  if (input.candidates.length === 0) {
    return buildAnnotatedLatexFromEdits({
      edits: input.workingEdits,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    });
  }

  return buildAnnotatedLatexFromEdits({
    edits: updateWorkingEdits({
      acceptedCandidates: input.candidates,
      workingEdits: input.workingEdits,
    }),
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
  });
}

function buildCompactionKeywordUsageToolOutput(input: {
  annotatedLatexCode: string;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
}) {
  return JSON.stringify(
    {
      keywordUsage: buildTailorResumeKeywordCheckResult({
        emphasizedTechnologies: input.emphasizedTechnologies,
        text: renderTailoredResumeLatexToPlainText(input.annotatedLatexCode),
      }),
      nextAction:
        "Use this as the current keyword ledger for the compacted draft. If you revise candidates, call this tool again to verify the keyword list changed as intended.",
    },
    null,
    2,
  );
}

function buildTailorResumeSkillQueryResult(input: {
  mode: TailorResumeSpareBulletSearchMode;
  query: string;
  skillData?: TailorResumeStoredSkillData | null;
}) {
  const topMatch = filterTailorResumeSpareBulletsForSearch({
    mode: input.mode,
    query: input.query,
    spareBullets: input.skillData?.spareBullets ?? [],
  })[0];

  if (!topMatch) {
    return null;
  }

  return {
    id: topMatch.id,
    quote: topMatch.quote,
    replacesQuote: topMatch.replacesQuote,
    resumeExperienceId: topMatch.resumeExperienceId,
    skills: topMatch.skills.map((skill) => skill.name),
  };
}

function buildTailorResumeSingleSkillQueryToolOutput(input: {
  mode: TailorResumeSpareBulletSearchMode;
  query: string;
  skillData?: TailorResumeStoredSkillData | null;
}) {
  return JSON.stringify(
    {
      query: input.query,
      mode: input.mode,
      result: buildTailorResumeSkillQueryResult(input),
      nextAction:
        "Use this single top saved resume-bullet support result as evidence if it is relevant. If result is null, do not invent support for that query. **** **WARNING: IF MULTIPLE SAVED REPLACEMENT BULLETS TARGET THE SAME SOURCE BULLET, TREAT THEM AS ALTERNATIVES UNLESS YOU INTENTIONALLY PLAN ONE MULTI-BULLET REPLACEMENT.** ****",
    },
    null,
    2,
  );
}

function buildTailorResumeBatchSkillQueryToolOutput(input: {
  queries: Array<{
    mode: TailorResumeSpareBulletSearchMode;
    query: string;
  }>;
  skillData?: TailorResumeStoredSkillData | null;
}) {
  return JSON.stringify(
    {
      results: input.queries.map((query) => ({
        query: query.query,
        mode: query.mode,
        result: buildTailorResumeSkillQueryResult({
          ...query,
          skillData: input.skillData,
        }),
      })),
      nextAction:
        "Use each top saved resume-bullet support result only when it is relevant. Null means no saved resume-bullet support matched that query. **** **WARNING: IF MULTIPLE SAVED REPLACEMENT BULLETS TARGET THE SAME SOURCE BULLET, TREAT THEM AS ALTERNATIVES UNLESS YOU INTENTIONALLY PLAN ONE MULTI-BULLET REPLACEMENT.** ****",
    },
    null,
    2,
  );
}

async function buildCompactionMalformedBulletsToolOutput(input: {
  annotatedLatexCode: string;
  changedSegmentIds: ReadonlySet<string>;
}) {
  const layout = await measureTailorResumeLayout({
    annotatedLatexCode: input.annotatedLatexCode,
  });
  const renderedBulletHealth = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds: input.changedSegmentIds,
    layout,
  });

  return JSON.stringify(
    {
      malformedBullets: renderedBulletHealth.malformedBullets,
      pageCount: renderedBulletHealth.pageCount,
      warnings: renderedBulletHealth.warnings,
      nextAction:
        renderedBulletHealth.malformedBullets.length > 0
          ? "Revise any changed malformed bullets and call this tool again. Pre-existing malformed bullets elsewhere should be surfaced as warnings."
          : "No malformed rendered bullets were found in the inspected compacted draft.",
    },
    null,
    2,
  );
}

function buildPageCountVerificationToolOutput(
  result: TailorResumePageCountVerificationToolResult,
) {
  return JSON.stringify(result, null, 2);
}

function buildCompactionSubmissionToolOutput(input: {
  accepted: boolean;
  message: string;
  nextAction: string;
}) {
  return JSON.stringify(
    {
      accepted: input.accepted,
      message: input.message,
      nextAction: input.nextAction,
    },
    null,
    2,
  );
}

function buildCompactionToolRepairOutput(input: {
  error: string;
  editableSegmentIds: ReadonlySet<string>;
  toolName: string;
}) {
  return JSON.stringify(
    {
      error: input.error,
      nextAction:
        `Revise the ${input.toolName} call and try again using a candidates array with only editable segmentId values.`,
      editableSegmentIds: [...input.editableSegmentIds],
    },
    null,
    2,
  );
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function buildPageCountLimitLabel(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

function buildLineCountLabel(lineCount: number) {
  return `${lineCount} rendered line${lineCount === 1 ? "" : "s"}`;
}

function readOutputText(response: TailorResumeCompactionResponse) {
  if (response.output_text) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];

  for (const outputItem of response.output ?? []) {
    if (outputItem.type !== "message") {
      continue;
    }

    for (const content of outputItem.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("").trim();
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTailorResumeSkillQueryMode(value: unknown) {
  if (value === "skills" || value === "body" || value === "both") {
    return value satisfies TailorResumeSpareBulletSearchMode;
  }

  throw new Error("Skill query mode must be one of skills, body, or both.");
}

function parseTailorResumeSingleSkillQuery(value: unknown): {
  mode: TailorResumeSpareBulletSearchMode;
  query: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("The resume skill query tool call must be an object.");
  }

  const query = "query" in value ? readTrimmedString(value.query) : "";

  if (!query) {
    throw new Error("The resume skill query tool call must include a query.");
  }

  return {
    mode: parseTailorResumeSkillQueryMode("mode" in value ? value.mode : null),
    query,
  };
}

function parseTailorResumeBatchSkillQuery(value: unknown) {
  if (!value || typeof value !== "object" || !("queries" in value)) {
    throw new Error("The batch resume skill query tool call must include queries.");
  }

  if (!Array.isArray(value.queries)) {
    throw new Error("The batch resume skill query tool call must include queries.");
  }

  return value.queries.map(parseTailorResumeSingleSkillQuery);
}

function parseLineReductionCandidates(
  value: unknown,
): TailorResumeLineReductionCandidate[] {
  if (!value || typeof value !== "object" || !("candidates" in value)) {
    throw new Error("The model did not call the line-measurement tool with candidates.");
  }

  const rawCandidates = value.candidates;

  if (!Array.isArray(rawCandidates)) {
    throw new Error("The line-measurement tool call did not include a candidates array.");
  }

  return rawCandidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const segmentId =
      "segmentId" in candidate ? readTrimmedString(candidate.segmentId) : "";
    const latexCode =
      "latexCode" in candidate && typeof candidate.latexCode === "string"
        ? candidate.latexCode
        : "";
    const reason =
      "reason" in candidate && typeof candidate.reason === "string"
        ? candidate.reason.trim()
        : "";

    if (!segmentId || !latexCode.trim() || !reason) {
      return [];
    }

    return [
      {
        latexCode,
        reason,
        segmentId,
      },
    ];
  });
}

function buildCompactionCandidateKey(
  candidate: Pick<TailorResumeLineReductionCandidate, "latexCode" | "segmentId">,
) {
  return JSON.stringify({
    latexCode: candidate.latexCode,
    segmentId: candidate.segmentId,
  });
}

function buildCompactionCandidateSignature(
  candidates: Array<
    Pick<TailorResumeLineReductionCandidate, "latexCode" | "segmentId">
  >,
) {
  return JSON.stringify(
    candidates
      .map((candidate) => ({
        latexCode: candidate.latexCode,
        segmentId: candidate.segmentId,
      }))
      .sort((left, right) => {
        const segmentCompare = left.segmentId.localeCompare(right.segmentId);

        if (segmentCompare !== 0) {
          return segmentCompare;
        }

        return left.latexCode.localeCompare(right.latexCode);
      }),
  );
}

function applyCompactionCandidatesToAnnotatedLatex(input: {
  annotatedLatexCode: string;
  candidates: TailorResumeLineReductionCandidate[];
}) {
  return applyTailorResumeBlockChanges({
    annotatedLatexCode: input.annotatedLatexCode,
    changes: input.candidates.map((candidate) => ({
      latexCode: candidate.latexCode,
      reason: candidate.reason,
      segmentId: candidate.segmentId,
    })),
  }).annotatedLatex;
}

function serializeCompactionCandidatesForPrompt(
  candidates: TailorResumeLineReductionCandidate[],
) {
  if (candidates.length === 0) {
    return "[none]";
  }

  return candidates
    .map((candidate) => {
      return [
        `- segmentId: ${candidate.segmentId}`,
        `  latex: ${truncateForPrompt(candidate.latexCode, 220)}`,
      ].join("\n");
    })
    .join("\n");
}

async function verifyTailorResumePageCountCandidates(input: {
  candidates: TailorResumeLineReductionCandidate[];
  currentAnnotatedLatexCode: string;
  currentPageCount: number;
  latestMeasurementResult: TailorResumeLineReductionToolResult | null;
  targetPageCount: number;
}): Promise<TailorResumePageCountVerificationToolResult> {
  if (!input.latestMeasurementResult) {
    return {
      canSubmitFinalCandidates: false,
      currentPageCount: input.currentPageCount,
      fitsTargetPageCount: false,
      nextAction:
        `Call ${tailorResumeLineReductionToolName} first so the exact same candidates are measured for rendered-line reductions before page-count verification.`,
      pageCountDelta: null,
      targetPageCount: input.targetPageCount,
      validationError:
        `Call ${tailorResumeLineReductionToolName} before ${tailorResumePageCountVerificationToolName}.`,
      verifiedCandidateCount: 0,
      verifiedPageCount: null,
    };
  }

  const acceptedCandidateKeys = new Set(
    input.latestMeasurementResult.accepted.map((measurement) =>
      buildCompactionCandidateKey(measurement.candidate),
    ),
  );
  const invalidCandidates = input.candidates.filter(
    (candidate) =>
      !acceptedCandidateKeys.has(buildCompactionCandidateKey(candidate)),
  );

  if (invalidCandidates.length > 0) {
    return {
      canSubmitFinalCandidates: false,
      currentPageCount: input.currentPageCount,
      fitsTargetPageCount: false,
      nextAction:
        `Only verify candidates that were accepted by the latest ${tailorResumeLineReductionToolName} call. Re-measure if you changed any candidate latex.`,
      pageCountDelta: null,
      targetPageCount: input.targetPageCount,
      validationError:
        "Page-count verification only accepts candidates that survived the latest rendered-line measurement pass.\n" +
        serializeCompactionCandidatesForPrompt(invalidCandidates),
      verifiedCandidateCount: 0,
      verifiedPageCount: null,
    };
  }

  try {
    const candidateAnnotatedLatexCode = applyCompactionCandidatesToAnnotatedLatex({
      annotatedLatexCode: input.currentAnnotatedLatexCode,
      candidates: input.candidates,
    });
    const candidateLatexCode = stripTailorResumeSegmentIds(candidateAnnotatedLatexCode);
    const validation = await validateTailorResumeLatexDocument(candidateLatexCode);

    if (!validation.ok) {
      return {
        canSubmitFinalCandidates: false,
        currentPageCount: input.currentPageCount,
        fitsTargetPageCount: false,
        nextAction:
          `Fix the compile or link error, then call ${tailorResumeLineReductionToolName} again before another exact page-count check.`,
        pageCountDelta: null,
        targetPageCount: input.targetPageCount,
        validationError: validation.error,
        verifiedCandidateCount: input.candidates.length,
        verifiedPageCount: null,
      };
    }

    const verifiedPageCount = await countPdfPages(validation.previewPdf);
    const fitsTargetPageCount = verifiedPageCount <= input.targetPageCount;

    return {
      canSubmitFinalCandidates: true,
      currentPageCount: input.currentPageCount,
      fitsTargetPageCount,
      nextAction: fitsTargetPageCount
        ? `The exact page check now fits within ${buildPageCountLimitLabel(input.targetPageCount)}. Call ${tailorResumeLineReductionSubmissionToolName} with this same candidate set.`
        : `The exact page check still renders to ${buildPageCountLimitLabel(verifiedPageCount)}. Measure a more aggressive set now, or call ${tailorResumeLineReductionSubmissionToolName} to bank these verified line-saving candidates for the next pass.`,
      pageCountDelta: input.currentPageCount - verifiedPageCount,
      targetPageCount: input.targetPageCount,
      validationError: null,
      verifiedCandidateCount: input.candidates.length,
      verifiedPageCount,
    };
  } catch (error) {
    return {
      canSubmitFinalCandidates: false,
      currentPageCount: input.currentPageCount,
      fitsTargetPageCount: false,
      nextAction:
        `Revise the candidates, then call ${tailorResumeLineReductionToolName} again before another exact page-count check.`,
      pageCountDelta: null,
      targetPageCount: input.targetPageCount,
      validationError:
        error instanceof Error
          ? error.message
          : "Unable to verify the exact rendered page count.",
      verifiedCandidateCount: input.candidates.length,
      verifiedPageCount: null,
    };
  }
}

function readCurrentEditLatex(edit: TailoredResumeBlockEditRecord) {
  return resolveTailoredResumeCurrentEditLatexCode({
    ...edit,
    customLatexCode: null,
    state: "applied",
  });
}

function buildAnnotatedLatexFromEdits(input: {
  edits: TailoredResumeBlockEditRecord[];
  sourceAnnotatedLatexCode: string;
}) {
  return applyTailorResumeBlockChanges({
    annotatedLatexCode: input.sourceAnnotatedLatexCode,
    changes: input.edits.map((edit) => ({
      latexCode: readCurrentEditLatex(edit),
      reason: edit.reason,
      segmentId: edit.segmentId,
    })),
  }).annotatedLatex;
}

function updateWorkingEdits(input: {
  acceptedCandidates: TailorResumeLineReductionCandidate[];
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  const acceptedCandidateBySegmentId = new Map(
    input.acceptedCandidates.map((candidate) => [candidate.segmentId, candidate]),
  );

  return input.workingEdits.map((edit) => {
    const acceptedCandidate = acceptedCandidateBySegmentId.get(edit.segmentId);

    if (!acceptedCandidate) {
      return edit;
    }

    return {
      ...edit,
      afterLatexCode: acceptedCandidate.latexCode,
      customLatexCode: null,
      generatedByStep: 5 as const,
      reason: acceptedCandidate.reason,
      state: "applied" as const,
    };
  });
}

function indexCurrentLineCounts(layout: TailorResumeLayoutMeasurement) {
  return indexTailorResumeSegmentMeasurements(layout);
}

function truncateForPrompt(value: string, maxLength = 420) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 1).trimEnd()}…`;
}

function serializeSourceLayout(layout: TailorResumeLayoutMeasurement) {
  const sectionLines =
    layout.sections.length > 0
      ? layout.sections.map(
          (section) =>
            `- ${section.sectionId}: ${buildLineCountLabel(section.lineCount)} (${section.title})`,
        )
      : ["- [no section measurements available]"];
  const blockLines =
    layout.segments.length > 0
      ? layout.segments.map(
          (segment) =>
            [
              `- segmentId: ${segment.segmentId}`,
              `  command: ${segment.command ?? "unknown"}`,
              `  original rendered lines: ${segment.lineCount}`,
              `  text: ${truncateForPrompt(segment.plainText)}`,
            ].join("\n"),
        )
      : ["- [no block measurements available]"];

  return [
    "Original resume section rendered line counts:",
    ...sectionLines,
    "",
    "Original resume visible block rendered line counts:",
    ...blockLines,
  ].join("\n");
}

function serializeEditableBlocks(input: {
  currentLayout: TailorResumeLayoutMeasurement;
  sourceLayout: TailorResumeLayoutMeasurement;
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  const currentLineCounts = indexCurrentLineCounts(input.currentLayout);
  const sourceLineCounts = indexCurrentLineCounts(input.sourceLayout);

  if (input.workingEdits.length === 0) {
    return "[no editable model blocks are available]";
  }

  const entries = input.workingEdits
    .map((edit) => {
      const currentLineCount =
        currentLineCounts.get(edit.segmentId)?.lineCount ?? null;
      const sourceLineCount = sourceLineCounts.get(edit.segmentId)?.lineCount ?? null;
      const lineDelta =
        currentLineCount !== null && sourceLineCount !== null
          ? currentLineCount - sourceLineCount
          : null;

      return {
        currentLineCount,
        edit,
        lineDelta,
        sourceLineCount,
      };
    })
    .sort((left, right) => {
      const leftPriority =
        left.currentLineCount === null ? 1 : left.currentLineCount >= 2 ? 2 : 0;
      const rightPriority =
        right.currentLineCount === null ? 1 : right.currentLineCount >= 2 ? 2 : 0;

      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      if ((left.currentLineCount ?? -1) !== (right.currentLineCount ?? -1)) {
        return (right.currentLineCount ?? -1) - (left.currentLineCount ?? -1);
      }

      return (right.lineDelta ?? -1) - (left.lineDelta ?? -1);
    });
  const highPriorityEntries = entries.filter(
    (entry) => entry.currentLineCount === null || entry.currentLineCount >= 2,
  );
  const lastResortEntries = entries.filter(
    (entry) => entry.currentLineCount !== null && entry.currentLineCount < 2,
  );
  const formatEntry = (
    entry: (typeof entries)[number],
    priority: "high" | "last_resort",
  ) =>
    [
      `- segmentId: ${entry.edit.segmentId}`,
      `  command: ${entry.edit.command ?? "unknown"}`,
      `  compaction priority: ${priority === "high" ? "high" : "last_resort"}`,
      `  original rendered lines: ${entry.sourceLineCount ?? "[unavailable]"}`,
      `  current replacement rendered lines: ${entry.currentLineCount ?? "[unavailable]"}`,
      `  line delta vs original: ${entry.lineDelta === null ? "[unavailable]" : entry.lineDelta}`,
      `  current generated-by step: ${entry.edit.generatedByStep}`,
      "  acceptance rule: a page-fit candidate must render to fewer lines than the current replacement for that block",
      `  current reason: ${entry.edit.reason}`,
      "  original latex block:",
      entry.edit.beforeLatexCode,
      "  current replacement latex block:",
      readCurrentEditLatex(entry.edit),
    ].join("\n");

  return [
    "High-priority compaction targets (these blocks currently span multiple rendered lines or have unknown measurements):",
    ...(highPriorityEntries.length > 0
      ? highPriorityEntries.map((entry) => formatEntry(entry, "high"))
      : ["- none"]),
    ...(lastResortEntries.length > 0
      ? [
          "",
          "Lower-priority / last-resort targets (these blocks already render in one line, so they usually only help if deleted or radically simplified):",
          ...lastResortEntries.map((entry) => formatEntry(entry, "last_resort")),
        ]
      : []),
  ].join("\n\n");
}

function serializeCompactionAttemptHistory(
  history: TailorResumeCompactionAttemptHistoryEntry[],
) {
  if (history.length === 0) {
    return "";
  }

  return [
    "Previous page-fit retry memory:",
    ...history.slice(-maxCompactionHistoryAttemptsForPrompt).map((entry) => {
      const measurementLines = entry.measurementResult
        ? [
            ...entry.measurementResult.accepted.map((measurement) =>
              serializeMeasurementForPrompt({
                label: "accepted",
                measurement,
              }),
            ),
            ...entry.measurementResult.rejected.map((measurement) =>
              serializeMeasurementForPrompt({
                label: "rejected",
                measurement,
              }),
            ),
          ].slice(0, maxCompactionMeasurementsPerAttemptForPrompt)
        : [];

      return [
        `Attempt ${entry.attempt}: ${entry.detail}`,
        `Estimated rendered lines to recover before that attempt: ${entry.estimatedLinesToRecover}`,
        "Measured candidates:",
        ...(measurementLines.length > 0
          ? measurementLines
          : ["- [no reusable measurement result captured]"]),
        ...(entry.pageCountVerification
          ? [
              "Exact page-count verification:",
              `- verified candidate count: ${entry.pageCountVerification.verifiedCandidateCount}`,
              `- current page count before verification: ${entry.pageCountVerification.currentPageCount}`,
              `- verified page count after candidates: ${entry.pageCountVerification.verifiedPageCount ?? "[unavailable]"}`,
              `- target page count: ${entry.pageCountVerification.targetPageCount}`,
              `- page delta: ${entry.pageCountVerification.pageCountDelta ?? "[unavailable]"}`,
              `- fits target: ${entry.pageCountVerification.fitsTargetPageCount ? "yes" : "no"}`,
              `- verification detail: ${
                entry.pageCountVerification.validationError
                  ? truncateForPrompt(entry.pageCountVerification.validationError, 220)
                  : "ok"
              }`,
            ]
          : []),
      ].join("\n");
    }),
  ].join("\n\n");
}

function serializeCompactionEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[],
) {
  if (technologies.length === 0) {
    return "[none identified]";
  }

  return technologies
    .map((technology, index) =>
      [
        `${index + 1}. ${technology.name}`,
        `   priority: ${technology.priority}`,
        `   evidence: ${technology.evidence || "[not provided]"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function buildCompactionInput(input: {
  attemptHistory: TailorResumeCompactionAttemptHistoryEntry[];
  currentLayout: TailorResumeLayoutMeasurement;
  currentPageCount: number;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  estimatedLinesToRecover: number;
  jobDescription: string;
  promptSettings: SystemPromptSettings;
  sourceLayout: TailorResumeLayoutMeasurement;
  targetPageCount: number;
  thesis: TailoredResumeThesis | null;
  workingEdits: TailoredResumeBlockEditRecord[];
}): TailorResumeCompactionResponseInput {
  const thesisText = input.thesis
    ? [
        "Current tailoring thesis:",
        `jobDescriptionFocus: ${input.thesis.jobDescriptionFocus}`,
        `resumeChanges: ${input.thesis.resumeChanges}`,
      ].join("\n")
    : "Current tailoring thesis: [not available]";

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: buildTailorResumePageCountCompactionPrompt(input.promptSettings, {
            currentPageCount: input.currentPageCount,
            estimatedLineReduction: input.estimatedLinesToRecover,
            targetPageCount: input.targetPageCount,
          }),
        },
        {
          type: "input_text" as const,
          text: thesisText,
        },
        {
          type: "input_text" as const,
          text:
            "Job description context for preserving fit while compacting:\n" +
            input.jobDescription,
        },
        {
          type: "input_text" as const,
          text:
            "Step 1 technologies emphasized by the job description. Preserve these exact keywords where they are already present or can remain truthfully compact:\n" +
            serializeCompactionEmphasizedTechnologies(input.emphasizedTechnologies),
        },
        {
          type: "input_text" as const,
          text:
            `Estimated rendered lines to remove: ${input.estimatedLinesToRecover}\n` +
            `Current page count: ${input.currentPageCount}\n` +
            `Target page count: ${input.targetPageCount}`,
        },
        {
          type: "input_text" as const,
          text: serializeSourceLayout(input.sourceLayout),
        },
        {
          type: "input_text" as const,
          text:
            "Editable model blocks with current measured line counts:\n" +
            serializeEditableBlocks({
              currentLayout: input.currentLayout,
              sourceLayout: input.sourceLayout,
              workingEdits: input.workingEdits,
            }),
        },
        ...(input.attemptHistory.length > 0
          ? [
              {
                type: "input_text" as const,
                text: serializeCompactionAttemptHistory(input.attemptHistory),
              },
            ]
          : []),
      ],
    },
  ];
}

async function collectVerifiedCompactionCandidates(input: {
  attempt: number;
  deadline: ReturnType<typeof createTailorResumeStepTimeout>;
  attemptHistory: TailorResumeCompactionAttemptHistoryEntry[];
  client: OpenAI;
  currentAnnotatedLatexCode: string;
  currentLayout: TailorResumeLayoutMeasurement;
  currentPageCount: number;
  editableSegmentIds: Set<string>;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  estimatedLinesToRecover: number;
  jobDescription: string;
  model: string;
  promptSettings: SystemPromptSettings;
  skillData?: TailorResumeStoredSkillData | null;
  sourceAnnotatedLatexCode: string;
  sourceLayout: TailorResumeLayoutMeasurement;
  targetPageCount: number;
  thesis: TailoredResumeThesis | null;
  workingEdits: TailoredResumeBlockEditRecord[];
}): Promise<TailorResumeCompactionSelfCheckResult> {
  let latestMeasurementResult: TailorResumeLineReductionToolResult | null = null;
  let latestPageCountVerification: TailorResumePageCountVerificationToolResult | null =
    null;
  let latestVerifiedCandidateSignature: string | null = null;
  let latestModel = input.model;
  let measuredAtLeastOnce = false;
  let previousResponseId: string | undefined;
  let responseInput: TailorResumeCompactionResponseInput = buildCompactionInput({
    attemptHistory: input.attemptHistory,
    currentLayout: input.currentLayout,
    currentPageCount: input.currentPageCount,
    emphasizedTechnologies: input.emphasizedTechnologies,
    estimatedLinesToRecover: input.estimatedLinesToRecover,
    jobDescription: input.jobDescription,
    promptSettings: input.promptSettings,
    sourceLayout: input.sourceLayout,
    targetPageCount: input.targetPageCount,
    thesis: input.thesis,
    workingEdits: input.workingEdits,
  });
  const transcript = createCompactionAttemptTranscript({
    attempt: input.attempt,
    currentPageCount: input.currentPageCount,
    estimatedLinesToRecover: input.estimatedLinesToRecover,
    initialInput: responseInput,
    model: input.model,
    targetPageCount: input.targetPageCount,
  });

  for (let round = 1; round <= maxCompactionSelfCheckRounds; round += 1) {
    const timeout = createTailorResumeStepAttemptTimeout(
      "Step 4B page-count compaction",
    );
    const response = mapCompactionResponse(
      await runWithTransientModelRetries({
        operation: () =>
          trackAiModelUsage({
            attempt: input.attempt,
            model: input.model,
            operation: "Step 4B page-count compaction",
            provider: "openai",
            request: () =>
              input.client.responses.create({
                input: responseInput,
                instructions: buildTailorResumePageCountCompactionInstructions({
                  lineReductionSubmissionToolName:
                    tailorResumeLineReductionSubmissionToolName,
                  lineReductionToolName: tailorResumeLineReductionToolName,
                  pageCountVerificationToolName:
                    tailorResumePageCountVerificationToolName,
                }),
                max_output_tokens: tailorResumeCompactionMaxOutputTokens,
                model: input.model,
                parallel_tool_calls: false,
                previous_response_id: previousResponseId,
                tool_choice: "required",
                tools: [
                  tailorResumeLineReductionTool,
                  tailorResumePageCountVerificationTool,
                  tailorResumeKeywordUsageTool,
                  tailorResumeMalformedBulletsTool,
                  tailorResumeSingleSkillQueryTool,
                  tailorResumeBatchSkillQueryTool,
                  tailorResumeLineReductionSubmissionTool,
                ],
              }, { signal: timeout.signal }),
            round,
            stepLabel: "Step 4B page-count compaction",
            stepNumber: 5,
          }),
      }).catch((error) => {
        if (timeout.signal.aborted) {
          const reason = timeout.signal.reason;
          throw isTailorResumeStepTimeoutError(reason)
            ? reason
            : error;
        }

        throw error;
      }).finally(() => {
        timeout.clear();
      }),
    );

    previousResponseId = response.id;
    latestModel = response.model ?? latestModel;

    const toolCall = findCompactionToolCall(response);

    if (!toolCall) {
      const outputText = readOutputText(response);
      return {
        error: outputText
          ? `The model did not call a page-fit compaction tool. It returned: ${outputText}`
          : "The model did not call a page-fit compaction tool.",
        measurementResult: latestMeasurementResult,
        pageCountVerification: latestPageCountVerification,
        model: latestModel,
        ok: false,
        transcript: finishCompactionAttemptTranscript(transcript, {
          error: outputText
            ? `The model did not call a page-fit compaction tool. It returned: ${outputText}`
            : "The model did not call a page-fit compaction tool.",
          measurementResult: latestMeasurementResult,
          model: latestModel,
          ok: false,
          pageCountVerification: latestPageCountVerification,
        }),
      };
    }

    if (toolCall.name === tailorResumeLineReductionSubmissionToolName) {
      let submittedCandidates: TailorResumeLineReductionCandidate[];

      try {
        submittedCandidates = parseCompactionSubmissionCandidates(
          JSON.parse(toolCall.arguments),
        );
      } catch (error) {
        const toolOutput = buildCompactionToolRepairOutput({
          error:
            error instanceof Error
              ? error.message
              : "The model returned an invalid final compaction submission.",
          editableSegmentIds: input.editableSegmentIds,
          toolName: toolCall.name,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      if (!measuredAtLeastOnce) {
        const toolOutput = buildCompactionSubmissionToolOutput({
          accepted: false,
          message:
            `Call ${tailorResumeLineReductionToolName} before submitting page-fit candidates.`,
          nextAction:
            `Start by calling ${tailorResumeLineReductionToolName} so the candidates are measured for rendered-line reduction first.`,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      if (!latestPageCountVerification || !latestVerifiedCandidateSignature) {
        const toolOutput = buildCompactionSubmissionToolOutput({
          accepted: false,
          message:
            `Call ${tailorResumePageCountVerificationToolName} on this same candidate set before submitting it.`,
          nextAction:
            `Use ${tailorResumePageCountVerificationToolName} so you can read the exact rendered page count for the candidates you want to bank.`,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      const submittedCandidateSignature = buildCompactionCandidateSignature(
        submittedCandidates,
      );

      if (submittedCandidateSignature !== latestVerifiedCandidateSignature) {
        const toolOutput = buildCompactionSubmissionToolOutput({
          accepted: false,
          message:
            `The submitted candidate set does not match your latest ${tailorResumePageCountVerificationToolName} call.`,
          nextAction:
            `Call ${tailorResumePageCountVerificationToolName} again on the exact candidates you want to submit.`,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      if (!latestPageCountVerification.canSubmitFinalCandidates) {
        const toolOutput = buildCompactionSubmissionToolOutput({
          accepted: false,
          message:
            latestPageCountVerification.validationError ??
            "The latest exact page-count verification did not succeed.",
          nextAction: latestPageCountVerification.nextAction,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      pushCompactionToolTranscript({
        responseId: response.id,
        round,
        toolCall,
        toolOutput: buildCompactionSubmissionToolOutput({
          accepted: true,
          message: "Accepted verified page-fit candidates.",
          nextAction: "The server will apply and validate this candidate set.",
        }),
        transcript,
      });
      return {
        candidates: submittedCandidates,
        measurementResult: latestMeasurementResult,
        pageCountVerification: latestPageCountVerification,
        model: latestModel,
        ok: true,
        transcript: finishCompactionAttemptTranscript(transcript, {
          measurementResult: latestMeasurementResult,
          model: latestModel,
          ok: true,
          pageCountVerification: latestPageCountVerification,
        }),
      };
    }

    if (
      toolCall.name === tailorResumeSingleSkillQueryToolName ||
      toolCall.name === tailorResumeBatchSkillQueryToolName
    ) {
      let toolOutput: string;

      try {
        const toolArguments = JSON.parse(toolCall.arguments);
        toolOutput =
          toolCall.name === tailorResumeSingleSkillQueryToolName
            ? buildTailorResumeSingleSkillQueryToolOutput({
                ...parseTailorResumeSingleSkillQuery(toolArguments),
                skillData: input.skillData,
              })
            : buildTailorResumeBatchSkillQueryToolOutput({
                queries: parseTailorResumeBatchSkillQuery(toolArguments),
                skillData: input.skillData,
              });
      } catch (error) {
        const repairOutput = buildCompactionToolRepairOutput({
          error:
            error instanceof Error
              ? error.message
              : "The model returned an invalid resume skill query tool call.",
          editableSegmentIds: input.editableSegmentIds,
          toolName: toolCall.name,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput: repairOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: repairOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      pushCompactionToolTranscript({
        responseId: response.id,
        round,
        toolCall,
        toolOutput,
        transcript,
      });
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: toolOutput,
          type: "function_call_output",
        },
      ];
      continue;
    }

    if (
      toolCall.name === tailorResumeKeywordUsageToolName ||
      toolCall.name === tailorResumeMalformedBulletsToolName
    ) {
      let candidates: TailorResumeLineReductionCandidate[];

      try {
        candidates = parseLineReductionCandidates(JSON.parse(toolCall.arguments));
      } catch (error) {
        const toolOutput = buildCompactionToolRepairOutput({
          error:
            error instanceof Error
              ? error.message
              : "The model returned an invalid resume inspection tool call.",
          editableSegmentIds: input.editableSegmentIds,
          toolName: toolCall.name,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      const candidateAnnotatedLatex =
        buildAnnotatedLatexWithInspectionCandidates({
          candidates,
          sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
          workingEdits: input.workingEdits,
        });
      const toolOutput =
        toolCall.name === tailorResumeKeywordUsageToolName
          ? buildCompactionKeywordUsageToolOutput({
              annotatedLatexCode: candidateAnnotatedLatex,
              emphasizedTechnologies: input.emphasizedTechnologies,
            })
          : await buildCompactionMalformedBulletsToolOutput({
              annotatedLatexCode: candidateAnnotatedLatex,
              changedSegmentIds: new Set(
                candidates.map((candidate) => candidate.segmentId),
              ),
            });

      pushCompactionToolTranscript({
        responseId: response.id,
        round,
        toolCall,
        toolOutput,
        transcript,
      });
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: toolOutput,
          type: "function_call_output",
        },
      ];
      continue;
    }

    let candidates: TailorResumeLineReductionCandidate[];

    if (toolCall.name === tailorResumePageCountVerificationToolName) {
      try {
        candidates = parseCompactionSubmissionCandidates(JSON.parse(toolCall.arguments));
      } catch (error) {
        const toolOutput = buildCompactionToolRepairOutput({
          error:
            error instanceof Error
              ? error.message
              : "The model returned an invalid exact page-count verification tool call.",
          editableSegmentIds: input.editableSegmentIds,
          toolName: toolCall.name,
        });
        pushCompactionToolTranscript({
          responseId: response.id,
          round,
          toolCall,
          toolOutput,
          transcript,
        });
        responseInput = [
          {
            call_id: toolCall.call_id,
            output: toolOutput,
            type: "function_call_output",
          },
        ];
        continue;
      }

      latestPageCountVerification = await verifyTailorResumePageCountCandidates({
        candidates,
        currentAnnotatedLatexCode: input.currentAnnotatedLatexCode,
        currentPageCount: input.currentPageCount,
        latestMeasurementResult,
        targetPageCount: input.targetPageCount,
      });
      latestVerifiedCandidateSignature =
        latestPageCountVerification.canSubmitFinalCandidates
          ? buildCompactionCandidateSignature(candidates)
          : null;
      const toolOutput = buildPageCountVerificationToolOutput(
        latestPageCountVerification,
      );
      pushCompactionToolTranscript({
        responseId: response.id,
        round,
        toolCall,
        toolOutput,
        transcript,
      });
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: toolOutput,
          type: "function_call_output",
        },
      ];
      continue;
    }

    try {
      candidates = parseLineReductionCandidates(JSON.parse(toolCall.arguments));
    } catch (error) {
      const toolOutput = buildCompactionToolRepairOutput({
        error:
          error instanceof Error
            ? error.message
            : "The model returned an invalid line-measurement tool call.",
        editableSegmentIds: input.editableSegmentIds,
        toolName: toolCall.name,
      });
      pushCompactionToolTranscript({
        responseId: response.id,
        round,
        toolCall,
        toolOutput,
        transcript,
      });
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: toolOutput,
          type: "function_call_output",
        },
      ];
      continue;
    }

    latestMeasurementResult = await measureTailorResumeLineReductionCandidates({
      candidates,
      currentAnnotatedLatexCode: input.currentAnnotatedLatexCode,
      currentLayout: input.currentLayout,
      editableSegmentIds: input.editableSegmentIds,
      sourceLayout: input.sourceLayout,
    });
    latestPageCountVerification = null;
    latestVerifiedCandidateSignature = null;
    measuredAtLeastOnce = true;
    const toolOutput = buildLineReductionToolOutput({
      estimatedLinesToRecover: input.estimatedLinesToRecover,
      result: latestMeasurementResult,
    });
    pushCompactionToolTranscript({
      responseId: response.id,
      round,
      toolCall,
      toolOutput,
      transcript,
    });
    responseInput = [
      {
        call_id: toolCall.call_id,
        output: toolOutput,
        type: "function_call_output",
      },
    ];
  }

  return {
    error:
      `The model did not submit verified compaction candidates after ${maxCompactionSelfCheckRounds} page-fit tool rounds.`,
    measurementResult: latestMeasurementResult,
    pageCountVerification: latestPageCountVerification,
    model: latestModel,
    ok: false,
    transcript: finishCompactionAttemptTranscript(transcript, {
      error:
        `The model did not submit verified compaction candidates after ${maxCompactionSelfCheckRounds} page-fit tool rounds.`,
      measurementResult: latestMeasurementResult,
      model: latestModel,
      ok: false,
      pageCountVerification: latestPageCountVerification,
    }),
  };
}

async function validateFinalCompactedLatex(input: {
  latexCode: string;
  targetPageCount: number;
}) {
  const validation = await validateTailorResumeLatexDocument(input.latexCode);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const pageCount = await countPdfPages(validation.previewPdf);

  if (pageCount > input.targetPageCount) {
    throw new Error(
      `The compacted resume still rendered to ${buildPageCountLimitLabel(pageCount)} instead of ${buildPageCountLimitLabel(input.targetPageCount)}.`,
    );
  }

  return {
    pageCount,
    previewPdf: validation.previewPdf,
  };
}

export async function compactTailoredResumePageCount(input: {
  annotatedLatexCode: string;
  client?: OpenAI;
  debugContext?: TailorResumePageCountCompactionDebugContext | null;
  edits: TailoredResumeBlockEditRecord[];
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  initialPageCount: number;
  jobDescription?: string;
  latexCode: string;
  model?: string;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  onDebugRecord?: (
    record: TailorResumePageCountCompactionDebugRecord,
  ) => void | Promise<void>;
  previewPdf: Buffer;
  promptSettings?: SystemPromptSettings;
  skillData?: TailorResumeStoredSkillData | null;
  sourceAnnotatedLatexCode: string;
  targetPageCount: number;
  thesis: TailoredResumeThesis | null;
}) {
  const targetPageCount = Math.max(1, Math.floor(input.targetPageCount));

  if (input.initialPageCount <= targetPageCount) {
    return {
      annotatedLatexCode: input.annotatedLatexCode,
      edits: input.edits,
      generationDurationMs: 0,
      latexCode: input.latexCode,
      model: resolveTailorResumeCompactionModel(input.model),
      pageCount: input.initialPageCount,
      previewPdf: input.previewPdf,
      validationError: null,
    } satisfies TailorResumePageCountCompactionResult;
  }

  if (input.edits.length === 0) {
    const errorMessage =
      `The tailored resume expanded to ${buildPageCountLimitLabel(input.initialPageCount)}, ` +
      `but there are no editable model blocks available to compact it back to ${buildPageCountLimitLabel(targetPageCount)}.`;
    await input.onStepEvent?.({
      attempt: null,
      detail: errorMessage,
      durationMs: 0,
      retrying: false,
      status: "failed",
      stepCount: 5,
      stepNumber: 5,
      summary: "Keeping the tailored resume within the original page count",
    });
    return {
      annotatedLatexCode: input.annotatedLatexCode,
      edits: input.edits,
      generationDurationMs: 0,
      latexCode: input.latexCode,
      model: resolveTailorResumeCompactionModel(input.model),
      pageCount: input.initialPageCount,
      previewPdf: input.previewPdf,
      validationError: errorMessage,
    } satisfies TailorResumePageCountCompactionResult;
  }

  const startedAt = Date.now();
  const stepTimeout = createTailorResumeStepTimeout({
    startedAt,
    stepLabel: "Step 4B page-count compaction",
  });
  const promptSettings = input.promptSettings ?? createDefaultSystemPromptSettings();
  const maxCompactionAttempts = Math.max(
    1,
    getRetryAttemptsToGeneratePageCountCompaction(),
  );
  const model = resolveTailorResumeCompactionModel(input.model);
  const client = input.client ?? getOpenAIClient();
  const editableSegmentIds = new Set(input.edits.map((edit) => edit.segmentId));
  let workingEdits = input.edits.map((edit) => ({ ...edit }));
  let currentAnnotatedLatexCode = buildAnnotatedLatexFromEdits({
    edits: workingEdits,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
  });
  let currentLatexCode = stripTailorResumeSegmentIds(currentAnnotatedLatexCode);
  let currentPreviewPdf = input.previewPdf;
  let currentPageCount = input.initialPageCount;
  let sourceLayout: TailorResumeLayoutMeasurement;
  let currentLayout: TailorResumeLayoutMeasurement;
  const attemptHistory: TailorResumeCompactionAttemptHistoryEntry[] = [];
  let lastError =
    `Unable to keep the tailored resume within ${buildPageCountLimitLabel(targetPageCount)}.`;
  let lastModel = model;

  await input.onStepEvent?.({
    attempt: null,
    detail:
      `The tailored preview expanded to ${buildPageCountLimitLabel(input.initialPageCount)}, ` +
      `so the page-fit guardrail is measuring rendered lines and asking for verified line reductions back toward ${buildPageCountLimitLabel(targetPageCount)}.`,
    durationMs: 0,
    retrying: false,
    status: "running",
    stepCount: 5,
    stepNumber: 5,
    summary: "Keeping the tailored resume within the original page count",
  });

  try {
    [sourceLayout, currentLayout] = await Promise.all([
      measureTailorResumeLayout({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
      }),
      measureTailorResumeLayout({
        annotatedLatexCode: currentAnnotatedLatexCode,
        pdfBuffer: currentPreviewPdf,
      }),
    ]);
  } catch (error) {
    lastError =
      error instanceof Error
        ? error.message
        : "Unable to measure the rendered resume layout.";
    await input.onStepEvent?.({
      attempt: null,
      detail: lastError,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: false,
      status: "failed",
      stepCount: 5,
      stepNumber: 5,
      summary: "Keeping the tailored resume within the original page count",
    });
    return {
      annotatedLatexCode: currentAnnotatedLatexCode,
      edits: buildTailoredResumeBlockEdits({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
        changes: workingEdits.map((edit) => ({
          generatedByStep: edit.generatedByStep,
          latexCode: readCurrentEditLatex(edit),
          reason: edit.reason,
          segmentId: edit.segmentId,
        })),
      }),
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      latexCode: currentLatexCode,
      model: lastModel,
      pageCount: currentPageCount,
      previewPdf: currentPreviewPdf,
      validationError: lastError,
    } satisfies TailorResumePageCountCompactionResult;
  }

  for (let attempt = 1; attempt <= maxCompactionAttempts; attempt += 1) {
    const overflowEstimate = await estimateTailorResumeOverflowLines({
      pdfBuffer: currentPreviewPdf,
      targetPageCount,
    });
    const estimatedLinesToRecover = overflowEstimate.estimatedLinesToRecover;
    let selfCheckResult: TailorResumeCompactionSelfCheckResult;

    try {
      selfCheckResult = await collectVerifiedCompactionCandidates({
        attempt,
        attemptHistory,
        client,
        currentAnnotatedLatexCode,
        currentLayout,
        currentPageCount,
        deadline: stepTimeout,
        editableSegmentIds,
        emphasizedTechnologies: input.emphasizedTechnologies ?? [],
        estimatedLinesToRecover,
        jobDescription: input.jobDescription ?? "[not available]",
        model,
        promptSettings,
        skillData: input.skillData,
        sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
        sourceLayout,
        targetPageCount,
        thesis: input.thesis,
        workingEdits,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Step 4B page-count compaction failed before producing candidates.";
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: false,
        status: "failed",
        stepCount: 5,
        stepNumber: 5,
        summary: "Keeping the tailored resume within the original page count",
      });
      break;
    }

    lastModel = selfCheckResult.model;

    await logTailorResumeCompactionTranscript({
      context: input.debugContext,
      detail: selfCheckResult.ok
        ? `Step 4B page-count compaction attempt ${attempt} submitted verified candidates after ${selfCheckResult.transcript.toolCalls.length} tool call(s).`
        : selfCheckResult.error,
      onDebugRecord: input.onDebugRecord,
      transcript: selfCheckResult.transcript,
    });

    if (!selfCheckResult.ok) {
      lastError = selfCheckResult.error;
      attemptHistory.push({
        attempt,
        detail: lastError,
        estimatedLinesToRecover,
        measurementResult: selfCheckResult.measurementResult,
        pageCountVerification: selfCheckResult.pageCountVerification,
      });
      const retryAttempt =
        attempt < maxCompactionAttempts ? attempt + 1 : attempt;
      await input.onStepEvent?.({
        attempt: retryAttempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 5,
        stepNumber: 5,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    const measurementResult = await measureTailorResumeLineReductionCandidates({
      candidates: selfCheckResult.candidates,
      currentAnnotatedLatexCode,
      currentLayout,
      editableSegmentIds,
      sourceLayout,
    });

    if (measurementResult.accepted.length === 0) {
      lastError =
        "No proposed compaction candidate reduced its block's measured rendered line count.";
      attemptHistory.push({
        attempt,
        detail: lastError,
        estimatedLinesToRecover,
        measurementResult,
        pageCountVerification: selfCheckResult.pageCountVerification,
      });
      const retryAttempt =
        attempt < maxCompactionAttempts ? attempt + 1 : attempt;
      await input.onStepEvent?.({
        attempt: retryAttempt,
        detail:
          `${lastError} The page-fit guardrail is asking for more aggressive candidates that actually remove rendered lines.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 5,
        stepNumber: 5,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    const acceptedCandidates = measurementResult.accepted.map(
      (measurement) => measurement.candidate,
    );
    const acceptedLineReduction = measurementResult.accepted.reduce(
      (sum, measurement) =>
        sum + (measurement.previousLineCount - measurement.candidateLineCount),
      0,
    );
    const nextWorkingEdits = updateWorkingEdits({
      acceptedCandidates,
      workingEdits,
    });
    const nextAnnotatedLatexCode = buildAnnotatedLatexFromEdits({
      edits: nextWorkingEdits,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    });
    const nextLatexCode = stripTailorResumeSegmentIds(nextAnnotatedLatexCode);
    let nextLayout: TailorResumeLayoutMeasurement;

    try {
      nextLayout = await measureTailorResumeLayout({
        annotatedLatexCode: nextAnnotatedLatexCode,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to compile the accepted line reductions.";
      attemptHistory.push({
        attempt,
        detail: lastError,
        estimatedLinesToRecover,
        measurementResult,
        pageCountVerification: selfCheckResult.pageCountVerification,
      });
      const retryAttempt =
        attempt < maxCompactionAttempts ? attempt + 1 : attempt;
      await input.onStepEvent?.({
        attempt: retryAttempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 5,
        stepNumber: 5,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    workingEdits = nextWorkingEdits;
    currentAnnotatedLatexCode = nextAnnotatedLatexCode;
    currentLatexCode = nextLatexCode;
    currentLayout = nextLayout;
    currentPreviewPdf = currentLayout.pdfBuffer;
    currentPageCount = currentLayout.pageCount;

    if (currentPageCount <= targetPageCount) {
      let finalValidation: Awaited<ReturnType<typeof validateFinalCompactedLatex>>;

      try {
        finalValidation = await validateFinalCompactedLatex({
          latexCode: currentLatexCode,
          targetPageCount,
        });
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Unable to validate the compacted resume.";
        attemptHistory.push({
          attempt,
          detail: lastError,
          estimatedLinesToRecover,
          measurementResult,
          pageCountVerification: selfCheckResult.pageCountVerification,
        });
        const retryAttempt =
          attempt < maxCompactionAttempts ? attempt + 1 : attempt;

        await input.onStepEvent?.({
          attempt: retryAttempt,
          detail: lastError,
          durationMs: Math.max(0, Date.now() - startedAt),
          retrying: attempt < maxCompactionAttempts,
          status: attempt < maxCompactionAttempts ? "running" : "failed",
          stepCount: 5,
          stepNumber: 5,
          summary: "Keeping the tailored resume within the original page count",
        });
        continue;
      }

      await input.onStepEvent?.({
        attempt,
        detail:
          `Accepted ${measurementResult.accepted.length} verified line-saving block ` +
          `change${measurementResult.accepted.length === 1 ? "" : "s"} and removed ${buildLineCountLabel(acceptedLineReduction)}, ` +
          `bringing the rendered preview back to ${buildPageCountLimitLabel(finalValidation.pageCount)}.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: false,
        status: "succeeded",
        stepCount: 5,
        stepNumber: 5,
        summary: "Keeping the tailored resume within the original page count",
      });

      return {
        annotatedLatexCode: currentAnnotatedLatexCode,
        edits: buildTailoredResumeBlockEdits({
          annotatedLatexCode: input.sourceAnnotatedLatexCode,
          changes: workingEdits.map((edit) => ({
            generatedByStep: edit.generatedByStep,
            latexCode: readCurrentEditLatex(edit),
            reason: edit.reason,
            segmentId: edit.segmentId,
          })),
        }),
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        latexCode: currentLatexCode,
        model: lastModel,
        pageCount: finalValidation.pageCount,
        previewPdf: finalValidation.previewPdf,
        validationError: null,
      } satisfies TailorResumePageCountCompactionResult;
    }

    lastError =
      `Accepted ${measurementResult.accepted.length} verified line-saving block ` +
      `change${measurementResult.accepted.length === 1 ? "" : "s"} and removed ${buildLineCountLabel(acceptedLineReduction)}, ` +
      `but the resume still rendered to ${buildPageCountLimitLabel(currentPageCount)}.`;
    attemptHistory.push({
      attempt,
      detail: lastError,
      estimatedLinesToRecover,
      measurementResult,
      pageCountVerification: selfCheckResult.pageCountVerification,
    });
    const retryAttempt =
      attempt < maxCompactionAttempts ? attempt + 1 : attempt;

    await input.onStepEvent?.({
      attempt: retryAttempt,
      detail: `${lastError} The page-fit guardrail is trying another measured reduction pass.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt < maxCompactionAttempts,
      status: attempt < maxCompactionAttempts ? "running" : "failed",
      stepCount: 5,
      stepNumber: 5,
      summary: "Keeping the tailored resume within the original page count",
    });
  }

  return {
    annotatedLatexCode: currentAnnotatedLatexCode,
    edits: buildTailoredResumeBlockEdits({
      annotatedLatexCode: input.sourceAnnotatedLatexCode,
      changes: workingEdits.map((edit) => ({
        generatedByStep: edit.generatedByStep,
        latexCode: readCurrentEditLatex(edit),
        reason: edit.reason,
        segmentId: edit.segmentId,
      })),
    }),
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    latexCode: currentLatexCode,
    model: lastModel,
    pageCount: currentPageCount,
    previewPdf: currentPreviewPdf,
    validationError: lastError,
  } satisfies TailorResumePageCountCompactionResult;
}
