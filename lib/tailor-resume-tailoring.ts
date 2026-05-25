import OpenAI from "openai";
import {
  buildTailorResumeInterviewSystemPrompt,
  buildTailorResumeImplementationSystemPrompt,
  buildTailorResumePlanningSystemPrompt,
  buildTailorResumeTechnologyExtractionInstructions,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { applyTailorResumeLinkOverridesWithSummary } from "./tailor-resume-link-overrides.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import {
  buildTailorResumeKeywordCheckResult,
  buildTailorResumeKeywordPresenceContext,
  resumeTextIncludesKeyword,
} from "./tailor-resume-keyword-coverage.ts";
import { formatTailorResumeTermWithCapitalFirst } from "./tailor-resume-non-technologies.ts";
import {
  buildTailorResumePlanningSnapshot,
  type TailorResumePlanningBlock,
  type TailorResumePlanningSnapshot,
} from "./tailor-resume-planning.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  buildTailorResumeRenderedBulletHealthCheck,
  formatTailorResumeChangedMalformedBulletError,
} from "./tailor-resume-rendered-bullet-health.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import {
  formatTransientModelError,
  isTransientModelError,
  runWithTransientModelRetries,
} from "./tailor-resume-transient-retry.ts";
import { measureTailorResumeLayout } from "./tailor-resume-layout-measurement.ts";
import { buildTailoredResumeBlockEdits } from "./tailor-resume-review.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import {
  filterTailorResumeSpareBulletsForSearch,
  type TailorResumeSpareBulletSearchMode,
} from "./tailor-resume-spare-bullet-search.ts";
import type {
  TailorResumeConversationMessage,
  TailorResumeGenerationStepEvent,
  TailorResumeKeywordCheckResult,
  TailorResumeLinkRecord,
  TailorResumeSavedLinkUpdate,
  TailoredResumeBlockEditRecord,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeOpenAiDebugStage,
  TailoredResumeOpenAiDebugToolCall,
  TailoredResumeOpenAiDebugTrace,
  TailoredResumePlanningChange,
  TailoredResumePlanningResult,
  TailoredResumeThesis,
  TailorResumeStoredSkillData,
} from "./tailor-resume-types.ts";
import {
  filterTailorResumeNonTechnologiesFromEmphasizedTechnologies,
  type TailorResumeUserMarkdownState,
} from "./tailor-resume-user-memory.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
const tailorResumeGenerationStepCount = 5;
const tailorResumePlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobDescriptionFocus: { type: "string" },
        resumeChanges: { type: "string" },
      },
      required: ["jobDescriptionFocus", "resumeChanges"],
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          editIntent: { type: "string" },
          reason: { type: "string" },
          segmentId: { type: "string" },
          targetKeywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["segmentId", "editIntent", "targetKeywords", "reason"],
      },
    },
    companyName: { type: "string" },
    displayName: { type: "string" },
    emphasizedTechnologies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence: { type: "string" },
          name: { type: "string" },
          priority: {
            type: "string",
            enum: ["high", "low"],
          },
        },
        required: ["name", "priority", "evidence"],
      },
    },
    positionTitle: { type: "string" },
  },
  required: [
    "thesis",
    "changes",
    "companyName",
    "displayName",
    "emphasizedTechnologies",
    "positionTitle",
  ],
} as const;

const tailorResumeTechnologyExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    emphasizedTechnologies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence: { type: "string" },
          name: { type: "string" },
          priority: {
            type: "string",
            enum: ["high", "low"],
          },
        },
        required: ["name", "priority", "evidence"],
      },
    },
  },
  required: ["emphasizedTechnologies"],
} as const;

async function emitTailorResumeGenerationStep(
  onStepEvent:
    | ((event: TailorResumeGenerationStepEvent) => void | Promise<void>)
    | undefined,
  event: Omit<TailorResumeGenerationStepEvent, "stepCount">,
) {
  await onStepEvent?.({
    ...event,
    stepCount: tailorResumeGenerationStepCount,
  });
}

const tailorResumeImplementationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          latexCode: { type: "string" },
          segmentId: { type: "string" },
        },
        required: ["segmentId", "latexCode"],
      },
    },
  },
  required: ["changes"],
} as const;

const tailorResumePlanningKeywordCheckToolName =
  "check_planned_keyword_assignments";
const tailorResumeImplementationKeywordCheckToolName =
  "check_implemented_resume_keyword_coverage";
const tailorResumeKeywordUsageToolName = "list_current_resume_keyword_usage";
const tailorResumeMalformedBulletsToolName = "list_malformed_resume_bullets";
const tailorResumeSingleSkillQueryToolName = "query_single_resume_skill";
const tailorResumeBatchSkillQueryToolName = "batch_query_resume_skills";
const maxTailorResumePlanningToolCallsPerAttempt = 12;
const maxTailorResumeImplementationToolCallsPerAttempt = 30;
export const tailorResumeStepTimeoutMs = 5 * 60 * 1000;
const tailorResumeKeywordExtractionMaxOutputTokens = 2048;
const tailorResumePlanningMaxOutputTokens = 8192;
const tailorResumeImplementationMaxOutputTokens = 8192;

const tailorResumePlanningKeywordCheckTool = {
  type: "function",
  name: tailorResumePlanningKeywordCheckToolName,
  description:
    "Check the current Step 3 intent plan by verifying which high- and low-priority keywords are assigned to planned segment edits or already preserved in unchanged resume blocks.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            editIntent: { type: "string" },
            segmentId: { type: "string" },
            targetKeywords: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["segmentId", "editIntent", "targetKeywords"],
        },
      },
    },
    required: ["changes"],
  },
} as const;

const tailorResumeImplementationKeywordCheckTool = {
  type: "function",
  name: tailorResumeImplementationKeywordCheckToolName,
  description:
    "Check the current Step 4 LaTeX implementation by applying the proposed block replacements to the full resume, reporting keyword coverage, all malformed rendered bullets, and optional rendered PDF line counts for requested bullets.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode"],
        },
      },
      lineCountSegmentIds: {
        type: "array",
        description:
          "Optional segmentIds to inspect for exact rendered PDF bullet line counts. Pass an empty array unless you need specific line counts beyond malformed-bullet warnings.",
        items: { type: "string" },
      },
    },
    required: ["changes", "lineCountSegmentIds"],
  },
} as const;

const tailorResumeKeywordUsageTool = {
  type: "function",
  name: tailorResumeKeywordUsageToolName,
  description:
    "List which job keywords are present or missing in the most updated full resume draft after applying any candidate block replacements supplied in this tool call. Use changes: [] to inspect the current draft with no extra replacements.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        description:
          "Candidate LaTeX block replacements to apply before inspecting keyword usage. Pass [] when no candidate LaTeX edits exist yet.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode"],
        },
      },
    },
    required: ["changes"],
  },
} as const;

const tailorResumeMalformedBulletsTool = {
  type: "function",
  name: tailorResumeMalformedBulletsToolName,
  description:
    "Return every malformed rendered bullet in the most updated full resume draft after applying any candidate block replacements supplied in this tool call. Use changes: [] to inspect the current draft with no extra replacements.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        description:
          "Candidate LaTeX block replacements to apply before inspecting rendered bullet health. Pass [] when no candidate LaTeX edits exist yet.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode"],
        },
      },
    },
    required: ["changes"],
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

type TailoredResumeImplementationChange = {
  latexCode: string;
  segmentId: string;
};

type TailoredResumeBlockChange = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

type TailoredResumePlanResponse = TailoredResumePlanningResult;

type TailoredResumeStructuredResponse = {
  changes: TailoredResumeBlockChange[];
  companyName: string;
  displayName: string;
  jobIdentifier?: string;
  positionTitle: string;
  thesis: TailoredResumeThesis;
};

type TailoredResumeImplementationResponse = {
  changes: TailoredResumeImplementationChange[];
};

type TailorResumeStepResponseInput = Array<
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

type TailorResumeQuestioningKeywordRequirement = {
  detail: string;
  keyword: string;
  targetSegmentIds: string[];
};

type TailorResumePlanningKeywordCheckToolCall = {
  arguments: string;
  call_id: string;
  name: typeof tailorResumePlanningKeywordCheckToolName;
};

type TailorResumeImplementationKeywordCheckToolCall = {
  arguments: string;
  call_id: string;
  name: typeof tailorResumeImplementationKeywordCheckToolName;
};

type TailorResumeInspectionToolCall = {
  arguments: string;
  call_id: string;
  name:
    | typeof tailorResumeKeywordUsageToolName
    | typeof tailorResumeMalformedBulletsToolName
    | typeof tailorResumeSingleSkillQueryToolName
    | typeof tailorResumeBatchSkillQueryToolName;
};

type TailorResumeModelProvider = "anthropic" | "openai";

type TailorResumeModelRef = {
  model: string;
  provider: TailorResumeModelProvider;
  serialized: string;
};

type TailoredResumeResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    arguments?: unknown;
    call_id?: unknown;
    content?: Array<{
      text?: unknown;
      type?: unknown;
    }>;
    name?: unknown;
    type?: unknown;
  }>;
  output_text?: unknown;
};

export type PlanTailoredResumeResult =
  | {
      attempts: number;
      generationDurationMs: number;
      model: string;
      ok: true;
      planningDebug: TailoredResumeOpenAiDebugStage;
      planningResult: TailoredResumePlanningResult;
      planningSnapshot: TailorResumePlanningSnapshot;
      thesis: TailoredResumeThesis;
    }
  | {
      attempts: number;
      generationDurationMs: number;
      model: string;
      ok: false;
      planningDebug: TailoredResumeOpenAiDebugStage;
      planningResult: TailoredResumePlanningResult;
      planningSnapshot: TailorResumePlanningSnapshot;
      thesis: TailoredResumeThesis | null;
      validationError: string;
    };

export type ExtractTailorResumeEmphasizedTechnologiesResult = {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  extractionDebug: TailoredResumeOpenAiDebugStage;
  generationDurationMs: number;
  model: string;
};

export type GenerateTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  companyName: string;
  displayName: string;
  edits: TailoredResumeBlockEditRecord[];
  generationDurationMs: number;
  jobIdentifier: string;
  latexCode: string;
  model: string;
  openAiDebug: TailoredResumeOpenAiDebugTrace;
  outcome: TailoredResumeGenerationOutcome;
  planningResult: TailoredResumePlanningResult;
  positionTitle: string;
  previewPdf: Buffer | null;
  savedLinkUpdateCount: number;
  savedLinkUpdates: TailorResumeSavedLinkUpdate[];
  thesis: TailoredResumeThesis | null;
  validationError: string | null;
};

export type TailoredResumeGenerationOutcome =
  | "generation_failure"
  | "reviewable_failure"
  | "success";

export function classifyTailoredResumeGenerationOutcome(input: {
  hasAppliedCandidate: boolean;
  hasPreviewPdf: boolean;
}): TailoredResumeGenerationOutcome {
  if (input.hasPreviewPdf) {
    return "success";
  }

  return input.hasAppliedCandidate
    ? "reviewable_failure"
    : "generation_failure";
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function getAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  return apiKey;
}

function parseTailorResumeModelRef(value: string | undefined): TailorResumeModelRef {
  const rawValue = value?.trim() || "gpt-5-mini";
  const separatorIndex = rawValue.indexOf(":");

  if (separatorIndex > 0) {
    const provider = rawValue
      .slice(0, separatorIndex)
      .trim()
      .toLowerCase();
    const model = rawValue.slice(separatorIndex + 1).trim();

    if (!model) {
      throw new Error(`Invalid model reference "${rawValue}".`);
    }

    if (provider === "anthropic" || provider === "openai") {
      return {
        model,
        provider,
        serialized: `${provider}:${model}`,
      };
    }

    throw new Error(
      `Unsupported model provider "${provider}" in model reference "${rawValue}".`,
    );
  }

  return {
    model: rawValue,
    provider: "openai",
    serialized: rawValue,
  };
}

function resolveTailorResumePlanningModelRef() {
  return parseTailorResumeModelRef(
    process.env.TAILOR_RESUME_PLANNING_MODEL ??
      process.env.OPENAI_TAILOR_RESUME_MODEL ??
      "gpt-5-mini",
  );
}

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function readOutputText(response: TailoredResumeResponse) {
  if (typeof response.output_text === "string") {
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

function formatTailorResumeDebugJsonText(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function parseTailorResumeModelJsonOutput(outputText: string) {
  const trimmedOutput = outputText.trim();
  const candidates = [trimmedOutput];
  const fencedJson = trimmedOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fencedJson?.[1]) {
    candidates.push(fencedJson[1].trim());
  }

  const firstObjectBraceIndex = trimmedOutput.indexOf("{");
  const lastObjectBraceIndex = trimmedOutput.lastIndexOf("}");

  if (
    firstObjectBraceIndex >= 0 &&
    lastObjectBraceIndex > firstObjectBraceIndex
  ) {
    candidates.push(
      trimmedOutput.slice(firstObjectBraceIndex, lastObjectBraceIndex + 1),
    );
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The model returned invalid JSON.");
}

function buildTailorResumeDebugToolCall(input: {
  id: string;
  input: string;
  output: string | null;
  toolName: string;
}): TailoredResumeOpenAiDebugToolCall {
  return {
    id: input.id,
    input: formatTailorResumeDebugJsonText(input.input),
    output: input.output ? formatTailorResumeDebugJsonText(input.output) : null,
    toolName: input.toolName,
  };
}

export function buildTailorResumeKeywordReviewDebugStage(input: {
  conversation: readonly TailorResumeConversationMessage[];
  promptSettings?: SystemPromptSettings;
  questioningSummary: TailoredResumePlanningResult["questioningSummary"] | null;
}): TailoredResumeOpenAiDebugStage {
  const toolCalls = input.conversation.flatMap((message) =>
    message.toolCalls.map((toolCall, index) =>
      buildTailorResumeDebugToolCall({
        id: `${message.id}:${String(index + 1)}`,
        input: toolCall.argumentsText,
        output: message.text,
        toolName: toolCall.name,
      }),
    ),
  );
  const outputJson = JSON.stringify(
    {
      conversation: input.conversation.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        toolCalls: message.toolCalls,
      })),
      questioningSummary: input.questioningSummary,
    },
    null,
    2,
  );

  return {
    outputJson,
    prompt: null,
    skippedReason:
      input.conversation.length > 0
        ? null
        : "Step 2 used deterministic keyword review without follow-up model tool calls.",
    systemPrompt: buildTailorResumeInterviewSystemPrompt(
      input.promptSettings ?? createDefaultSystemPromptSettings(),
      { debugForceConversation: false },
    ),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function buildRequiredKeywordCheckToolReminderInput(input: {
  finalResponse: TailoredResumeResponse;
  stageName: string;
  toolName: string;
}) {
  const previousOutput = readOutputText(input.finalResponse);
  const previousOutputLine = previousOutput
    ? `\n\nPrevious final JSON candidate:\n${previousOutput}`
    : "";

  return [
    {
      content: [
        {
          text:
            `You returned the final ${input.stageName} JSON before calling ` +
            `${input.toolName}.\n\nDo not return final JSON yet. First call ` +
            `${input.toolName} using the candidate changes from your previous ` +
            "response. After I return the tool output, revise if needed and then " +
            `return the final ${input.stageName} JSON.` +
            previousOutputLine,
          type: "input_text",
        },
      ],
      role: "user",
    },
  ] satisfies TailorResumeStepResponseInput;
}

function findPlanningKeywordCheckToolCalls(
  response: TailoredResumeResponse,
): TailorResumePlanningKeywordCheckToolCall[] {
  const toolCalls: TailorResumePlanningKeywordCheckToolCall[] = [];

  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === tailorResumePlanningKeywordCheckToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      toolCalls.push({
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: tailorResumePlanningKeywordCheckToolName,
      });
    }
  }

  return toolCalls;
}

function findImplementationKeywordCheckToolCall(
  response: TailoredResumeResponse,
): TailorResumeImplementationKeywordCheckToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === tailorResumeImplementationKeywordCheckToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: tailorResumeImplementationKeywordCheckToolName,
      };
    }
  }

  return null;
}

function findInspectionToolCall(
  response: TailoredResumeResponse,
): TailorResumeInspectionToolCall | null {
  return findInspectionToolCalls(response)[0] ?? null;
}

function findInspectionToolCalls(
  response: TailoredResumeResponse,
): TailorResumeInspectionToolCall[] {
  const toolCalls: TailorResumeInspectionToolCall[] = [];

  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      (outputItem.name === tailorResumeKeywordUsageToolName ||
        outputItem.name === tailorResumeMalformedBulletsToolName ||
        outputItem.name === tailorResumeSingleSkillQueryToolName ||
        outputItem.name === tailorResumeBatchSkillQueryToolName) &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      toolCalls.push({
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: outputItem.name,
      });
    }
  }

  return toolCalls;
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

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readTrimmedStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return [...new Set(value.map(readTrimmedString).filter(Boolean))];
}

export class TailorResumeStepTimeoutError extends Error {
  constructor(stepLabel: string) {
    super(`${stepLabel} exceeded the 5 minute step timeout.`);
    this.name = "TailorResumeStepTimeoutError";
  }
}

export function isTailorResumeStepTimeoutError(error: unknown) {
  return error instanceof TailorResumeStepTimeoutError;
}

export function createTailorResumeStepTimeout(input: {
  startedAt: number;
  stepLabel: string;
}) {
  const readRemainingMs = () =>
    Math.max(0, input.startedAt + tailorResumeStepTimeoutMs - Date.now());

  const assertNotTimedOut = () => {
    if (readRemainingMs() <= 0) {
      throw new TailorResumeStepTimeoutError(input.stepLabel);
    }
  };

  const createAbortSignal = () => {
    assertNotTimedOut();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new TailorResumeStepTimeoutError(input.stepLabel));
    }, readRemainingMs());

    return {
      signal: controller.signal,
      clear: () => clearTimeout(timeout),
    };
  };

  return {
    assertNotTimedOut,
    createAbortSignal,
  };
}

export function createTailorResumeStepAttemptTimeout(stepLabel: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new TailorResumeStepTimeoutError(stepLabel));
  }, tailorResumeStepTimeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function normalizeTailorResumeStepTimeoutError(input: {
  error: unknown;
  signal?: AbortSignal;
  stepLabel: string;
}) {
  if (isTailorResumeStepTimeoutError(input.error)) {
    return input.error;
  }

  if (input.signal?.aborted) {
    const reason = input.signal.reason;

    return isTailorResumeStepTimeoutError(reason)
      ? reason
      : new TailorResumeStepTimeoutError(input.stepLabel);
  }

  return input.error;
}

function parseKeywordCheckPlanningChanges(
  value: unknown,
): Array<
  Pick<TailoredResumePlanningChange, "editIntent" | "segmentId" | "targetKeywords">
> {
  if (!value || typeof value !== "object" || !("changes" in value)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  const rawChanges = value.changes;

  if (!Array.isArray(rawChanges)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  return rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The keyword-check tool call included an invalid change.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const editIntent =
      "editIntent" in change ? readTrimmedString(change.editIntent) : "";
    const targetKeywords =
      "targetKeywords" in change
        ? readTrimmedStringArray(change.targetKeywords)
        : null;

    if (!segmentId) {
      throw new Error(
        "The keyword-check tool call included a change without a segmentId.",
      );
    }

    if (!editIntent) {
      throw new Error(
        "The keyword-check tool call included a change without an editIntent.",
      );
    }

    if (!targetKeywords) {
      throw new Error(
        "The keyword-check tool call included a change without a targetKeywords array.",
      );
    }

    return {
      editIntent,
      segmentId,
      targetKeywords,
    };
  });
}

function parseKeywordCheckImplementationPayload(value: unknown): {
  changes: Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">>;
  lineCountSegmentIds: string[];
} {
  if (!value || typeof value !== "object" || !("changes" in value)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  const rawChanges = value.changes;

  if (!Array.isArray(rawChanges)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  const lineCountSegmentIds =
    "lineCountSegmentIds" in value && Array.isArray(value.lineCountSegmentIds)
      ? value.lineCountSegmentIds
          .map((segmentId) => readTrimmedString(segmentId))
          .filter(Boolean)
      : [];
  const changes = rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The keyword-check tool call included an invalid change.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const latexCode =
      "latexCode" in change && typeof change.latexCode === "string"
        ? change.latexCode
        : "";

    if (!segmentId) {
      throw new Error(
        "The keyword-check tool call included a change without a segmentId.",
      );
    }

    return {
      latexCode,
      segmentId,
    };
  });

  return {
    changes,
    lineCountSegmentIds,
  };
}

function parseResumeInspectionPayload(value: unknown): {
  changes: Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">>;
} {
  if (!value || typeof value !== "object" || !("changes" in value)) {
    throw new Error("The resume inspection tool call did not include a changes array.");
  }

  const rawChanges = value.changes;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The resume inspection tool call did not include a changes array.");
  }

  return {
    changes: rawChanges.map((change) => {
      if (!change || typeof change !== "object") {
        throw new Error("The resume inspection tool call included an invalid change.");
      }

      const segmentId =
        "segmentId" in change ? readTrimmedString(change.segmentId) : "";
      const latexCode =
        "latexCode" in change && typeof change.latexCode === "string"
          ? change.latexCode
          : "";

      if (!segmentId) {
        throw new Error(
          "The resume inspection tool call included a change without a segmentId.",
        );
      }

      return {
        latexCode,
        segmentId,
      };
    }),
  };
}

function buildDisplayName(input: {
  companyName: string;
  positionTitle: string;
}) {
  const companyName = input.companyName.trim();
  const positionTitle = input.positionTitle.trim();

  if (companyName && positionTitle) {
    return `${companyName} - ${positionTitle}`;
  }

  return companyName || positionTitle || "Tailored Resume";
}

function normalizeTailoredResumeMetadata(value: {
  companyName?: string;
  displayName?: string;
  jobIdentifier?: string;
  positionTitle?: string;
}) {
  const companyName = readTrimmedString(value.companyName);
  const positionTitle = readTrimmedString(value.positionTitle);
  const generatedDisplayName = buildDisplayName({ companyName, positionTitle });
  const displayName =
    generatedDisplayName !== "Tailored Resume"
      ? generatedDisplayName
      : readTrimmedString(value.displayName) || generatedDisplayName;
  const jobIdentifier = readTrimmedString(value.jobIdentifier) || "General";

  return {
    companyName,
    displayName,
    jobIdentifier,
    positionTitle,
  };
}

function parseTailoredResumeThesis(value: unknown): TailoredResumeThesis {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid thesis object.");
  }

  const jobDescriptionFocus =
    "jobDescriptionFocus" in value
      ? readTrimmedString(value.jobDescriptionFocus)
      : "";
  const resumeChanges =
    "resumeChanges" in value ? readTrimmedString(value.resumeChanges) : "";

  if (!jobDescriptionFocus) {
    throw new Error(
      "The model returned a thesis without jobDescriptionFocus.",
    );
  }

  if (!resumeChanges) {
    throw new Error("The model returned a thesis without resumeChanges.");
  }

  return {
    jobDescriptionFocus,
    resumeChanges,
  };
}

function parseTailoredResumePlanChange(
  value: unknown,
): TailoredResumePlanningChange {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid planned block change.");
  }

  const segmentId =
    "segmentId" in value ? readTrimmedString(value.segmentId) : "";
  const editIntent =
    "editIntent" in value ? readTrimmedString(value.editIntent) : "";
  const desiredPlainText =
    "desiredPlainText" in value && typeof value.desiredPlainText === "string"
      ? value.desiredPlainText.trim()
      : null;
  const reason =
    "reason" in value && typeof value.reason === "string"
      ? value.reason
      : "";
  const targetKeywords =
    "targetKeywords" in value
      ? readTrimmedStringArray(value.targetKeywords)
      : null;

  if (!segmentId) {
    throw new Error(
      "The model returned a planned block change without a segmentId.",
    );
  }

  if (!editIntent && desiredPlainText === null) {
    throw new Error(
      "The model returned a planned block change without an editIntent.",
    );
  }

  if (!targetKeywords && desiredPlainText === null) {
    throw new Error(
      "The model returned a planned block change without a targetKeywords array.",
    );
  }

  if (!readTrimmedString(reason)) {
    throw new Error("The model returned a planned block change without a reason.");
  }

  const legacyEditIntent =
    desiredPlainText === null
      ? ""
      : desiredPlainText.trim()
        ? `Implement this saved plaintext replacement for the block: ${desiredPlainText.trim()}`
        : "Remove this saved block if the implementation stage still targets it.";

  return {
    ...(desiredPlainText === null ? {} : { desiredPlainText }),
    editIntent: editIntent || legacyEditIntent,
    reason,
    segmentId,
    targetKeywords: targetKeywords ?? [],
  };
}

const nonResumeSkillKeywordNames = new Set([
  "production cluster",
  "production clusters",
  "production infrastructure",
]);

function normalizeTailorResumeKeywordName(value: string) {
  const trimmedValue = value.trim();

  if (
    /\bkubernetes\s*[- ]\s*based\b/i.test(trimmedValue) &&
    /\bpaas\b/i.test(trimmedValue)
  ) {
    return "Kubernetes";
  }

  return trimmedValue;
}

function isResumeSkillKeywordName(value: string) {
  return !nonResumeSkillKeywordNames.has(normalizeEmployerKeyword(value));
}

function parseTailoredResumeEmphasizedTechnology(
  value: unknown,
): TailoredResumeEmphasizedTechnology {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid emphasized technology.");
  }

  const name =
    "name" in value
      ? formatTailorResumeTermWithCapitalFirst(
          normalizeTailorResumeKeywordName(readTrimmedString(value.name)),
        )
      : "";
  const priority =
    "priority" in value && (value.priority === "high" || value.priority === "low")
      ? value.priority
      : null;
  const evidence = "evidence" in value ? readTrimmedString(value.evidence) : "";

  if (!name) {
    throw new Error("The model returned an emphasized technology without a name.");
  }

  if (!priority) {
    throw new Error(
      `The model returned emphasized technology "${name}" without a valid priority.`,
    );
  }

  return {
    evidence,
    name,
    priority,
  };
}

function normalizeTailoredResumeEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[],
) {
  const normalizedTechnologies =
    new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of technologies) {
    if (!isResumeSkillKeywordName(technology.name)) {
      continue;
    }

    const key = technology.name.toLowerCase();
    const existingTechnology = normalizedTechnologies.get(key);

    if (
      !existingTechnology ||
      (existingTechnology.priority === "low" && technology.priority === "high")
    ) {
      const classification =
        technology.classification ?? existingTechnology?.classification;
      normalizedTechnologies.set(key, {
        ...technology,
        ...(classification ? { classification } : {}),
      });
    }
  }

  return [...normalizedTechnologies.values()];
}

export function mergeTailorResumeScrapedKeywordSnapshot(input: {
  planningTechnologies: TailoredResumeEmphasizedTechnology[];
  scrapedTechnologies: TailoredResumeEmphasizedTechnology[];
}) {
  const technologiesByName = new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of input.scrapedTechnologies) {
    const key = normalizeTechnologyName(technology.name);

    if (key) {
      technologiesByName.set(key, technology);
    }
  }

  for (const technology of input.planningTechnologies) {
    const key = normalizeTechnologyName(technology.name);

    if (!key) {
      continue;
    }

    const scrapedTechnology = technologiesByName.get(key);

    if (!scrapedTechnology) {
      technologiesByName.set(key, technology);
      continue;
    }

    technologiesByName.set(key, {
      ...technology,
      evidence: scrapedTechnology.evidence || technology.evidence,
      name: scrapedTechnology.name || technology.name,
      priority: scrapedTechnology.priority,
      ...(scrapedTechnology.classification
        ? { classification: scrapedTechnology.classification }
        : technology.classification
          ? { classification: technology.classification }
          : {}),
    });
  }

  return [...technologiesByName.values()];
}

function parseTailoredResumeEmphasizedTechnologies(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("The model did not return an emphasizedTechnologies array.");
  }

  return normalizeTailoredResumeEmphasizedTechnologies(
    value.map(parseTailoredResumeEmphasizedTechnology),
  );
}

export function parseTailorResumeTechnologyExtractionResponse(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid technology extraction.");
  }

  return parseTailoredResumeEmphasizedTechnologies(
    "emphasizedTechnologies" in value ? value.emphasizedTechnologies : null,
  );
}

function technologyAppearsInJobDescription(input: {
  employerName?: string | null;
  jobDescription: string;
  technology: TailoredResumeEmphasizedTechnology;
}) {
  if (
    isEmployerSpecificTechnologyTerm({
      employerName: input.employerName,
      evidence: input.technology.evidence,
      technologyName: input.technology.name,
    })
  ) {
    return false;
  }

  return resumeTextIncludesKeyword({
    term: input.technology.name,
    text: input.jobDescription,
  });
}

const employerNameNoiseWords = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "technologies",
  "technology",
]);

function normalizeEmployerKeyword(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readEmployerNameKeywords(value: string | null | undefined) {
  const normalizedName = normalizeEmployerKeyword(value ?? "");

  if (!normalizedName) {
    return [];
  }

  const tokens = normalizedName
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 &&
        !employerNameNoiseWords.has(token),
    );

  return [...new Set([normalizedName, ...tokens])];
}

function evidenceExplicitlyAsksForCandidateProductExperience(evidence: string) {
  return /\b(?:experience|experienced|familiarity|proficiency|background)\s+(?:with|using|in)\b/i.test(
    evidence,
  );
}

function isEmployerSpecificTechnologyTerm(input: {
  employerName?: string | null;
  evidence: string;
  technologyName: string;
}) {
  const normalizedTechnologyName = normalizeEmployerKeyword(input.technologyName);

  if (!normalizedTechnologyName) {
    return false;
  }

  if (evidenceExplicitlyAsksForCandidateProductExperience(input.evidence)) {
    return false;
  }

  const employerKeywords = readEmployerNameKeywords(input.employerName);

  return employerKeywords.some(
    (keyword) =>
      normalizedTechnologyName === keyword ||
      normalizedTechnologyName.startsWith(`${keyword} `) ||
      normalizedTechnologyName.endsWith(` ${keyword}`),
  );
}

const tailorResumeJobTechnologyHintNames = [
  "GitHub Actions",
  "Spring Boot",
  "Scikit-learn",
  "Elasticsearch",
  "TypeScript",
  "JavaScript",
  "PostgreSQL",
  "Kubernetes",
  "Terraform",
  "Cassandra",
  "GraphQL",
  "Next.js",
  "Node.js",
  "FastAPI",
  "DynamoDB",
  "Snowflake",
  "Databricks",
  "TensorFlow",
  "LangChain",
  "OpenAI",
  "Prometheus",
  "Grafana",
  "Datadog",
  "Jenkins",
  "CircleCI",
  "Gradle",
  "GitHub",
  "GitLab",
  "Docker",
  "Python",
  "Kotlin",
  "Swift",
  "Ruby",
  "Rails",
  "Django",
  "Flask",
  "Spring",
  "Express",
  "React",
  "Redux",
  "Angular",
  "Svelte",
  "Vue",
  "Tailwind",
  "Vite",
  "Webpack",
  "Babel",
  "Jest",
  "Playwright",
  "Cypress",
  "Selenium",
  "Kafka",
  "Redis",
  "MongoDB",
  "MySQL",
  "Postgres",
  "Spark",
  "Hadoop",
  "Airflow",
  "Pandas",
  "NumPy",
  "PyTorch",
  "AWS",
  "Azure",
  "GCP",
  "Lambda",
  "S3",
  "gRPC",
  "REST",
  "SQL",
  "NoSQL",
  "HTML",
  "CSS",
  "Linux",
  "Unix",
  "Bash",
  "C++",
  "C#",
  "Java",
  "Go",
] as const;

const highPriorityTechnologyEvidencePattern =
  /\b(required|requirements|basic qualifications|min(?:imum)? qualifications|must|need|technologies we use|tech stack|we use|including|languages|build tooling)\b/i;
const lowPriorityTechnologyEvidencePattern =
  /\b(preferred|nice[- ]to[- ]have|nice to have|bonus|plus|familiar(?:ity)?|exposure)\b/i;

const deterministicTailorResumeKeywordDenyListTerms = [
  "blueprint",
  "chromium",
  "commit previews",
  "frontend frameworks",
  "internationalization",
  "storage systems",
  "developer experience",
  "internet terminology",
  "open-source",
] as const;

function isDeterministicTailorResumeKeywordDenyListEnabled() {
  return /^(1|true|yes|on)$/i.test(
    process.env.USE_DENY_LIST_FOR_KEYWORDS?.trim() ?? "",
  );
}

function readTailorResumeKeywordNonTechnologies(
  nonTechnologies: readonly string[] | null | undefined,
) {
  return isDeterministicTailorResumeKeywordDenyListEnabled()
    ? [...(nonTechnologies ?? []), ...deterministicTailorResumeKeywordDenyListTerms]
    : nonTechnologies;
}

function truncateTechnologyEvidence(value: string) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  return normalizedValue.length > 220
    ? `${normalizedValue.slice(0, 217).trim()}...`
    : normalizedValue;
}

function buildTechnologyEvidenceChunks(jobDescription: string) {
  const lines = jobDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentences = jobDescription
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: Array<{ context: string; evidence: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    chunks.push({
      context: lines.slice(Math.max(0, index - 2), index + 1).join(" "),
      evidence: lines[index],
    });
  }

  for (const sentence of sentences) {
    chunks.push({
      context: sentence,
      evidence: sentence,
    });
  }

  return chunks;
}

function readTechnologyHintPriority(input: { context: string; evidence: string }) {
  const evidenceHasHighPriority =
    highPriorityTechnologyEvidencePattern.test(input.evidence);
  const evidenceHasLowPriority =
    lowPriorityTechnologyEvidencePattern.test(input.evidence);

  if (evidenceHasLowPriority && !evidenceHasHighPriority) {
    return "low";
  }

  const hasHighPriorityEvidence = highPriorityTechnologyEvidencePattern.test(
    input.context,
  );
  const hasLowPriorityEvidence = lowPriorityTechnologyEvidencePattern.test(
    input.context,
  );

  return hasLowPriorityEvidence && !hasHighPriorityEvidence ? "low" : "high";
}

export function extractTailorResumeJobDescriptionTechnologyHints(
  jobDescription: string,
  options: {
    employerName?: string | null;
    nonTechnologies?: readonly string[] | null;
  } = {},
): TailoredResumeEmphasizedTechnology[] {
  const chunks = buildTechnologyEvidenceChunks(jobDescription);
  const technologies: TailoredResumeEmphasizedTechnology[] = [];

  for (const name of tailorResumeJobTechnologyHintNames) {
    const matchingChunk = chunks.find((chunk) =>
      resumeTextIncludesKeyword({
        term: name,
        text: chunk.evidence,
      }),
    );

    if (!matchingChunk) {
      continue;
    }

    technologies.push({
      evidence: truncateTechnologyEvidence(matchingChunk.evidence),
      name,
      priority: readTechnologyHintPriority({
        context: matchingChunk.context,
        evidence: matchingChunk.evidence,
      }),
    });
  }

  return mergeTailorResumeJobDescriptionTechnologies({
    extractedTechnologies: technologies,
    employerName: options.employerName,
    jobDescription,
    nonTechnologies: options.nonTechnologies,
    plannerTechnologies: [],
  });
}

export function mergeTailorResumeJobDescriptionTechnologies(input: {
  employerName?: string | null;
  extractedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobDescription: string;
  nonTechnologies?: readonly string[] | null;
  plannerTechnologies: TailoredResumeEmphasizedTechnology[];
}) {
  return filterTailorResumeNonTechnologiesFromEmphasizedTechnologies(
    normalizeTailoredResumeEmphasizedTechnologies([
      ...input.extractedTechnologies.filter(
        (technology) =>
          technologyAppearsInJobDescription({
            employerName: input.employerName,
            jobDescription: input.jobDescription,
            technology,
          }),
      ),
      ...input.plannerTechnologies.filter(
        (technology) =>
          technologyAppearsInJobDescription({
            employerName: input.employerName,
            jobDescription: input.jobDescription,
            technology,
          }),
      ),
    ]),
    readTailorResumeKeywordNonTechnologies(input.nonTechnologies),
  );
}

export function parseTailoredResumePlanResponse(
  value: unknown,
): TailoredResumePlanResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid tailoring plan.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  const changes = rawChanges.map(parseTailoredResumePlanChange);

  return {
    changes,
    ...normalizeTailoredResumeMetadata(value as TailoredResumePlanResponse),
    emphasizedTechnologies: parseTailoredResumeEmphasizedTechnologies(
      "emphasizedTechnologies" in value ? value.emphasizedTechnologies : null,
    ),
    questioningSummary: null,
    thesis: parseTailoredResumeThesis("thesis" in value ? value.thesis : null),
  };
}

function parseTailoredResumeImplementationChange(
  value: unknown,
): TailoredResumeImplementationChange {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid LaTeX implementation change.");
  }

  const segmentId =
    "segmentId" in value ? readTrimmedString(value.segmentId) : "";
  const latexCode =
    "latexCode" in value && typeof value.latexCode === "string"
      ? value.latexCode
      : "";

  if (!segmentId) {
    throw new Error(
      "The model returned a LaTeX implementation change without a segmentId.",
    );
  }

  return {
    latexCode,
    segmentId,
  };
}

function parseTailoredResumeImplementationResponse(
  value: unknown,
): TailoredResumeImplementationResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid LaTeX implementation.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  return {
    changes: rawChanges.map(parseTailoredResumeImplementationChange),
  };
}

function validateTailoredResumePlanChanges(input: {
  changes: TailoredResumePlanningChange[];
  planningBlocks: TailorResumePlanningBlock[];
}) {
  const planningBlockIds = new Set(
    input.planningBlocks.map((block) => block.segmentId),
  );
  const seenSegmentIds = new Set<string>();

  for (const change of input.changes) {
    if (seenSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate planned edits for segment ${change.segmentId}.`,
      );
    }

    if (!planningBlockIds.has(change.segmentId)) {
      throw new Error(
        `The model planned an edit for unknown segment ${change.segmentId}.`,
      );
    }

    seenSegmentIds.add(change.segmentId);
  }
}

function formatTailorResumePlanningSegmentIds(
  planningBlocks: TailorResumePlanningBlock[],
) {
  return planningBlocks.map((block) => block.segmentId).join(", ");
}

function buildPlanningKeywordCheckRepairToolOutput(input: {
  error: string;
  planningBlocks: TailorResumePlanningBlock[];
}) {
  return JSON.stringify(
    {
      error: input.error,
      nextAction:
        "Revise the Step 3 intent plan, then call check_planned_keyword_assignments again with a changes array that uses only valid segmentId values.",
      validSegmentIds: input.planningBlocks.map((block) => block.segmentId),
    },
    null,
    2,
  );
}

function buildImplementationToolRepairOutput(input: {
  error: string;
  plannedChanges: TailoredResumePlanningChange[];
}) {
  return JSON.stringify(
    {
      error: input.error,
      nextAction:
        "Revise the Step 4A candidate, then call the tool again using exactly the planned segmentId values.",
      requiredSegmentIds: input.plannedChanges.map((change) => change.segmentId),
    },
    null,
    2,
  );
}

function buildPlannedResumePlainText(input: {
  changes: Array<Pick<TailoredResumePlanningChange, "desiredPlainText" | "segmentId">>;
  planningSnapshot: TailorResumePlanningSnapshot;
}) {
  const changesById = new Map(
    input.changes.map((change) => [change.segmentId, change]),
  );

  return input.planningSnapshot.blocks
    .map((block) => {
      const change = changesById.get(block.segmentId);
      return change && change.desiredPlainText !== undefined
        ? change.desiredPlainText.trim()
        : block.plainText;
    })
    .filter(Boolean)
    .join("\n");
}

export type TailorResumePlanningKeywordAssignmentCheckResult = {
  missingHighPriority: string[];
  missingLowPriority: string[];
  nextAction: string;
  satisfiedHighPriority: string[];
  satisfiedLowPriority: string[];
  terms: Array<{
    assigned: boolean;
    assignedSegmentIds: string[];
    name: string;
    preservedOriginalSegmentIds: string[];
    priority: TailoredResumeEmphasizedTechnology["priority"];
  }>;
  unrecognizedTargetKeywords: string[];
};

function buildTailorResumePlanningKeywordAssignmentCheckResult(input: {
  changes: Array<
    Pick<TailoredResumePlanningChange, "segmentId" | "targetKeywords">
  >;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  planningSnapshot: TailorResumePlanningSnapshot;
}): TailorResumePlanningKeywordAssignmentCheckResult {
  const technologiesByName = new Map(
    input.emphasizedTechnologies.map((technology) => [
      normalizeTechnologyName(technology.name),
      technology,
    ]),
  );
  const changedSegmentIds = new Set(
    input.changes.map((change) => change.segmentId),
  );
  const assignedSegmentIdsByKeyword = new Map<string, string[]>();
  const unrecognizedTargetKeywords = new Set<string>();

  for (const change of input.changes) {
    for (const targetKeyword of change.targetKeywords) {
      const normalizedKeyword = normalizeTechnologyName(targetKeyword);

      if (!normalizedKeyword) {
        continue;
      }

      if (!technologiesByName.has(normalizedKeyword)) {
        unrecognizedTargetKeywords.add(targetKeyword);
        continue;
      }

      assignedSegmentIdsByKeyword.set(normalizedKeyword, [
        ...new Set([
          ...(assignedSegmentIdsByKeyword.get(normalizedKeyword) ?? []),
          change.segmentId,
        ]),
      ]);
    }
  }

  const terms = input.emphasizedTechnologies.map((technology) => {
    const normalizedKeyword = normalizeTechnologyName(technology.name);
    const assignedSegmentIds =
      assignedSegmentIdsByKeyword.get(normalizedKeyword) ?? [];
    const preservedOriginalSegmentIds = input.planningSnapshot.blocks
      .filter(
        (block) =>
          !changedSegmentIds.has(block.segmentId) &&
          resumeTextIncludesKeyword({
            term: technology.name,
            text: block.plainText,
          }),
      )
      .map((block) => block.segmentId);

    return {
      assigned: assignedSegmentIds.length > 0,
      assignedSegmentIds,
      name: technology.name,
      preservedOriginalSegmentIds,
      priority: technology.priority,
    };
  });
  const isSatisfied = (term: (typeof terms)[number]) =>
    term.assigned || term.preservedOriginalSegmentIds.length > 0;

  const missingHighPriority = terms
    .filter((term) => term.priority === "high" && !isSatisfied(term))
    .map((term) => term.name);
  const missingLowPriority = terms
    .filter((term) => term.priority === "low" && !isSatisfied(term))
    .map((term) => term.name);

  return {
    missingHighPriority,
    missingLowPriority,
    nextAction:
      missingHighPriority.length > 0 || missingLowPriority.length > 0
        ? "Revise Step 3 by assigning missing keywords to specific segmentIds with compact editIntent instructions, or leave them preserved in unchanged original blocks."
        : "Assignments are complete enough for final Step 3 JSON; Step 4 will write the LaTeX replacements.",
    satisfiedHighPriority: terms
      .filter((term) => term.priority === "high" && isSatisfied(term))
      .map((term) => term.name),
    satisfiedLowPriority: terms
      .filter((term) => term.priority === "low" && isSatisfied(term))
      .map((term) => term.name),
    terms,
    unrecognizedTargetKeywords: [...unrecognizedTargetKeywords],
  };
}

function buildTailoredResumeBlockChanges(input: {
  implementationChanges: TailoredResumeImplementationChange[];
  plannedChanges: TailoredResumePlanningChange[];
}) {
  const plannedSegmentIds = new Set(
    input.plannedChanges.map((change) => change.segmentId),
  );
  const implementationById = new Map<string, TailoredResumeImplementationChange>();

  for (const change of input.implementationChanges) {
    if (!plannedSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model returned a LaTeX implementation for unknown segment ${change.segmentId}.`,
      );
    }

    if (implementationById.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate LaTeX implementations for segment ${change.segmentId}.`,
      );
    }

    implementationById.set(change.segmentId, change);
  }

  return input.plannedChanges.map((plannedChange) => {
    const implementationChange = implementationById.get(plannedChange.segmentId);

    if (!implementationChange) {
      throw new Error(
        `The model did not return a LaTeX implementation for segment ${plannedChange.segmentId}.`,
      );
    }

    return {
      latexCode: implementationChange.latexCode,
      reason: plannedChange.reason,
      segmentId: plannedChange.segmentId,
    } satisfies TailoredResumeBlockChange;
  });
}

function buildKeywordCheckToolOutput(
  result: TailorResumeKeywordCheckResult | TailorResumePlanningKeywordAssignmentCheckResult,
) {
  return JSON.stringify(result, null, 2);
}

async function buildImplementationCheckToolOutput(input: {
  changedSegmentIds: ReadonlySet<string>;
  keywordCheckResult: TailorResumeKeywordCheckResult;
  renderedAnnotatedLatexCode: string;
  requestedLineCountSegmentIds: ReadonlySet<string>;
}) {
  const layout = await measureTailorResumeLayout({
    annotatedLatexCode: input.renderedAnnotatedLatexCode,
  });
  const renderedBulletHealth = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds: input.changedSegmentIds,
    layout,
    requestedLineCountSegmentIds: input.requestedLineCountSegmentIds,
  });

  return JSON.stringify(
    {
      keywordCoverage: input.keywordCheckResult,
      renderedBulletLineCheck: {
        malformedBullets: renderedBulletHealth.malformedBullets,
        pageCount: renderedBulletHealth.pageCount,
        requestedLineCounts: renderedBulletHealth.requestedLineCounts,
        warnings: renderedBulletHealth.warnings,
      },
      nextAction:
        renderedBulletHealth.malformedBullets.some(
          (warning) => warning.changedByCandidate,
        )
          ? "Revise the changed malformed bullets, then call this tool again before final JSON submission."
          : "If keyword coverage is acceptable and no changed bullet is malformed, you may submit the final JSON implementation.",
    },
    null,
    2,
  );
}

function buildResumeKeywordUsageToolOutput(input: {
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
        "Use this as the current keyword ledger. If you make another candidate edit, call this tool again with the updated replacements to verify the keyword list changed as intended.",
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

async function buildResumeMalformedBulletsToolOutput(input: {
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
          : "No malformed rendered bullets were found in the inspected resume draft.",
    },
    null,
    2,
  );
}

function applyInspectionChanges(input: {
  annotatedLatexCode: string;
  changes: Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">>;
  plannedChanges?: TailoredResumePlanningChange[];
}) {
  if (input.changes.length === 0) {
    return input.annotatedLatexCode;
  }

  const blockChanges = input.plannedChanges
    ? buildTailoredResumeBlockChanges({
        implementationChanges: input.changes.map((change) => ({
          latexCode: change.latexCode,
          segmentId: change.segmentId,
        })),
        plannedChanges: input.plannedChanges,
      })
    : input.changes.map((change) => ({
        latexCode: change.latexCode,
        reason: "[resume inspection candidate]",
        segmentId: change.segmentId,
      }));

  return applyTailorResumeBlockChanges({
    annotatedLatexCode: input.annotatedLatexCode,
    changes: blockChanges,
  }).annotatedLatex;
}

function serializeTailorResumePlanningBlocks(
  blocks: TailorResumePlanningBlock[],
) {
  if (blocks.length === 0) {
    return "[no editable plaintext blocks found]";
  }

  return blocks
    .map(
      (block, index) =>
        [
          `${index + 1}. segmentId: ${block.segmentId}`,
          `   command: ${block.command ?? "unknown"}`,
          `   current text: ${block.plainText}`,
        ].join("\n"),
    )
    .join("\n\n");
}

function serializeTailorResumeImplementationBlocks(input: {
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  plannedChanges: TailoredResumePlanningChange[];
}) {
  if (input.plannedChanges.length === 0) {
    return "[no planned changes]";
  }

  return input.plannedChanges
    .map((change, index) => {
      const block = input.planningBlocksById.get(change.segmentId);

      return [
        `${index + 1}. segmentId: ${change.segmentId}`,
        `   command: ${block?.command ?? "unknown"}`,
        `   current text: ${block?.plainText ?? "[missing block]"}`,
        `   edit intent: ${change.editIntent.trim()}`,
        `   target keywords: ${
          change.targetKeywords.length > 0
            ? change.targetKeywords.join(", ")
            : "[none]"
        }`,
        ...(change.desiredPlainText === undefined
          ? []
          : [
              `   legacy desired text: ${
                change.desiredPlainText || "[remove this block]"
              }`,
            ]),
        `   reason: ${change.reason.trim()}`,
        "   original latex block:",
        block?.latexCode ?? "[missing block]",
      ].join("\n");
    })
    .join("\n\n");
}

function serializeTailorResumeEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[] | undefined,
) {
  const resolvedTechnologies = technologies ?? [];

  if (resolvedTechnologies.length === 0) {
    return "[none identified]";
  }

  return resolvedTechnologies
    .map((technology, index) =>
      [
        `${index + 1}. ${technology.name}`,
        `   priority: ${technology.priority}`,
        `   evidence: ${technology.evidence || "[not provided]"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function normalizeTechnologyName(value: string) {
  return value.trim().toLowerCase();
}

type TailorResumeUserMarkdownQuotedSentence = {
  associatedSkillTerms: string[];
  explicitBoldTerms: string[];
  heading: string;
  text: string;
};

function stripMarkdownStrongMarkers(value: string) {
  return value.replace(/(\*\*|__)([^*_][\s\S]*?)\1/g, "$2");
}

function readMarkdownStrongTerms(value: string) {
  const terms: string[] = [];
  const strongPattern = /(\*\*|__)([^*_][\s\S]*?)\1/g;
  let match: RegExpExecArray | null;

  while ((match = strongPattern.exec(value)) !== null) {
    const term = stripMarkdownStrongMarkers(match[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();

    if (term) {
      terms.push(term);
    }
  }

  return terms;
}

function normalizeMarkdownHeading(value: string) {
  return stripMarkdownStrongMarkers(value)
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readStructuredSkillEvidenceHeadingTerms(input: {
  heading: string;
  insideStructuredSkillEvidence: boolean;
  line: string;
}) {
  if (
    !input.insideStructuredSkillEvidence ||
    !/^-\s*Candidate spare bullet:/i.test(input.line)
  ) {
    return [];
  }

  return input.heading
    .split(",")
    .map((term) => normalizeMarkdownHeading(term))
    .filter(Boolean);
}

function readUserMarkdownQuotedSentences(
  markdown: string,
): TailorResumeUserMarkdownQuotedSentence[] {
  const sentences: TailorResumeUserMarkdownQuotedSentence[] = [];
  let currentHeading = "";
  let insideStructuredSkillEvidence = false;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmedLine);

    if (headingMatch) {
      currentHeading = normalizeMarkdownHeading(headingMatch[2] ?? "");
      if (
        normalizeMarkdownHeading(currentHeading).toLowerCase() ===
        "structured skills-section keyword support"
      ) {
        insideStructuredSkillEvidence = true;
      }
      continue;
    }

    const associatedSkillTerms = readStructuredSkillEvidenceHeadingTerms({
      heading: currentHeading,
      insideStructuredSkillEvidence,
      line: trimmedLine,
    });
    const quotePattern = /["“]([^"”]{12,})["”]/g;
    let quoteMatch: RegExpExecArray | null;

    while ((quoteMatch = quotePattern.exec(trimmedLine)) !== null) {
      const rawText = quoteMatch[1] ?? "";
      const text = stripMarkdownStrongMarkers(rawText)
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        continue;
      }

      sentences.push({
        associatedSkillTerms,
        explicitBoldTerms: readMarkdownStrongTerms(rawText),
        heading: currentHeading,
        text,
      });
    }
  }

  return sentences;
}

function normalizeTextForUserMarkdownMatch(value: string) {
  return stripMarkdownStrongMarkers(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTextMatchTokens(value: string) {
  return normalizeTextForUserMarkdownMatch(value)
    .split(" ")
    .filter((token) => token.length >= 4 || /[+#./-]/.test(token));
}

function userMarkdownSentenceMatchesLatexText(input: {
  sentence: TailorResumeUserMarkdownQuotedSentence;
  text: string;
}) {
  const sentenceText = normalizeTextForUserMarkdownMatch(input.sentence.text);
  const latexText = normalizeTextForUserMarkdownMatch(input.text);

  if (!sentenceText || !latexText) {
    return false;
  }

  if (sentenceText.includes(latexText) || latexText.includes(sentenceText)) {
    return true;
  }

  const sentenceTokens = readTextMatchTokens(input.sentence.text);

  if (sentenceTokens.length === 0) {
    return false;
  }

  const latexTokens = new Set(readTextMatchTokens(input.text));
  const matchedTokenCount = sentenceTokens.filter((token) =>
    latexTokens.has(token),
  ).length;

  return matchedTokenCount >= 4 && matchedTokenCount / sentenceTokens.length >= 0.6;
}

function isTermBoundaryCharacter(character: string | undefined) {
  return !character || !/[A-Za-z0-9+#./-]/.test(character);
}

function findStandaloneTermIndex(input: {
  fromIndex?: number;
  term: string;
  text: string;
}) {
  const term = input.term.trim();

  if (!term) {
    return -1;
  }

  const lowerText = input.text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let index = lowerText.indexOf(lowerTerm, input.fromIndex ?? 0);

  while (index >= 0) {
    const before = input.text[index - 1];
    const after = input.text[index + term.length];

    if (isTermBoundaryCharacter(before) && isTermBoundaryCharacter(after)) {
      return index;
    }

    index = lowerText.indexOf(lowerTerm, index + 1);
  }

  return -1;
}

function textIncludesStandaloneTerm(input: { term: string; text: string }) {
  return findStandaloneTermIndex(input) >= 0;
}

function readBoldTermKey(term: string) {
  return normalizeTextForUserMarkdownMatch(term);
}

type TailorResumeBoldCandidateTerm = {
  source: "associated-skill" | "emphasized" | "explicit";
  term: string;
};

function readUserMarkdownBoldCandidateTerms(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  latexPlainText: string;
  sentences: TailorResumeUserMarkdownQuotedSentence[];
}) {
  const candidates: TailorResumeBoldCandidateTerm[] = [];
  const addCandidate = (
    term: string,
    source: TailorResumeBoldCandidateTerm["source"],
  ) => {
    const trimmedTerm = stripMarkdownStrongMarkers(term)
      .replace(/\s+/g, " ")
      .trim();
    const termKey = readBoldTermKey(trimmedTerm);

    if (!trimmedTerm || !termKey) {
      return;
    }

    if (
      !textIncludesStandaloneTerm({
        term: trimmedTerm,
        text: input.latexPlainText,
      })
    ) {
      return;
    }

    const hasOverlappingCandidate = candidates.some((candidate) => {
      const candidateKey = readBoldTermKey(candidate.term);
      return (
        candidateKey === termKey ||
        candidateKey.includes(termKey) ||
        termKey.includes(candidateKey)
      );
    });

    if (!hasOverlappingCandidate) {
      candidates.push({ source, term: trimmedTerm });
    }
  };

  for (const sentence of input.sentences) {
    for (const explicitBoldTerm of sentence.explicitBoldTerms) {
      addCandidate(explicitBoldTerm, "explicit");
    }
  }

  for (const sentence of input.sentences) {
    for (const associatedSkillTerm of sentence.associatedSkillTerms) {
      addCandidate(associatedSkillTerm, "associated-skill");
    }
  }

  const sortedTechnologies = [...input.emphasizedTechnologies].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority === "high" ? -1 : 1;
    }

    return right.name.length - left.name.length;
  });

  for (const technology of sortedTechnologies) {
    const appearsInMatchingUserMarkdownSentence = input.sentences.some(
      (sentence) =>
        textIncludesStandaloneTerm({
          term: technology.name,
          text: sentence.text,
        }) ||
        textIncludesStandaloneTerm({
          term: technology.name,
          text: sentence.heading,
        }),
    );

    if (appearsInMatchingUserMarkdownSentence) {
      addCandidate(technology.name, "emphasized");
    }
  }

  return candidates;
}

function findMatchingLatexBraceIndex(latexCode: string, openBraceIndex: number) {
  let depth = 0;

  for (let index = openBraceIndex; index < latexCode.length; index += 1) {
    const character = latexCode[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function isInsideLatexTextbfGroup(latexCode: string, index: number) {
  let searchIndex = 0;

  while (searchIndex < index) {
    const commandIndex = latexCode.indexOf("\\textbf", searchIndex);

    if (commandIndex < 0 || commandIndex >= index) {
      return false;
    }

    const openBraceIndex = latexCode.indexOf("{", commandIndex + "\\textbf".length);

    if (openBraceIndex < 0) {
      return true;
    }

    if (openBraceIndex >= index) {
      searchIndex = commandIndex + 1;
      continue;
    }

    if (
      latexCode
        .slice(commandIndex + "\\textbf".length, openBraceIndex)
        .trim() !== ""
    ) {
      searchIndex = commandIndex + 1;
      continue;
    }

    const closeBraceIndex = findMatchingLatexBraceIndex(latexCode, openBraceIndex);

    if (closeBraceIndex === null || closeBraceIndex >= index) {
      return true;
    }

    searchIndex = commandIndex + 1;
  }

  return false;
}

function isInsideLatexCommandName(latexCode: string, index: number) {
  let cursor = index - 1;

  while (cursor >= 0 && /[A-Za-z]/.test(latexCode[cursor] ?? "")) {
    cursor -= 1;
  }

  return latexCode[cursor] === "\\";
}

function convertMarkdownStrongMarkersToLatexBold(latexCode: string) {
  return latexCode
    .replace(/\*\*([^{}\n*]{1,120})\*\*/g, String.raw`\textbf{$1}`)
    .replace(/__([^{}\n_]{1,120})__/g, String.raw`\textbf{$1}`);
}

function isTailorResumeSkillsSegment(change: { latexCode: string; segmentId: string }) {
  return (
    /\bskills?\b/i.test(change.segmentId) ||
    /\\resume(?:Subheading|Section)\{[^{}]*skills?[^{}]*\}/i.test(
      change.latexCode,
    )
  );
}

function applyLatexBoldToFirstStandaloneTerm(input: {
  latexCode: string;
  term: string;
}) {
  const variants = [
    input.term,
    input.term.replace(/#/g, String.raw`\#`),
  ].filter((variant, index, variants) => variants.indexOf(variant) === index);
  let bestMatch: { index: number; term: string } | null = null;

  for (const variant of variants) {
    let index = findStandaloneTermIndex({
      term: variant,
      text: input.latexCode,
    });

    while (index >= 0) {
      if (
        !isInsideLatexTextbfGroup(input.latexCode, index) &&
        !isInsideLatexCommandName(input.latexCode, index)
      ) {
        if (!bestMatch || index < bestMatch.index) {
          bestMatch = { index, term: variant };
        }

        break;
      }

      index = findStandaloneTermIndex({
        fromIndex: index + variant.length,
        term: variant,
        text: input.latexCode,
      });
    }
  }

  if (!bestMatch) {
    return input.latexCode;
  }

  const matchedTerm = input.latexCode.slice(
    bestMatch.index,
    bestMatch.index + bestMatch.term.length,
  );

  return [
    input.latexCode.slice(0, bestMatch.index),
    String.raw`\textbf{`,
    matchedTerm,
    "}",
    input.latexCode.slice(bestMatch.index + bestMatch.term.length),
  ].join("");
}

export function applyTailorResumeUserMarkdownBoldFormatting(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  implementationChanges: Array<{ latexCode: string; segmentId: string }>;
  userMarkdown?: TailorResumeUserMarkdownState | null;
}): Array<{ latexCode: string; segmentId: string }> {
  const markdown = input.userMarkdown?.markdown ?? "";
  const userMarkdownSentences = readUserMarkdownQuotedSentences(markdown);

  if (userMarkdownSentences.length === 0) {
    return input.implementationChanges.map((change) => ({ ...change }));
  }

  return input.implementationChanges.map((change) => {
    if (isTailorResumeSkillsSegment(change)) {
      return {
        ...change,
        latexCode: stripMarkdownStrongMarkers(change.latexCode),
      };
    }

    const latexPlainText = renderTailoredResumeLatexToPlainText(change.latexCode);
    const matchingSentences = userMarkdownSentences.filter((sentence) =>
      userMarkdownSentenceMatchesLatexText({
        sentence,
        text: latexPlainText,
      }),
    );

    if (matchingSentences.length === 0) {
      return { ...change };
    }

    const candidateTerms = readUserMarkdownBoldCandidateTerms({
      emphasizedTechnologies: input.emphasizedTechnologies,
      latexPlainText,
      sentences: matchingSentences,
    });
    let latexCode = convertMarkdownStrongMarkersToLatexBold(change.latexCode);
    let appliedEmphasizedTermCount = 0;

    for (const candidate of candidateTerms) {
      if (
        candidate.source === "emphasized" &&
        appliedEmphasizedTermCount >= 2
      ) {
        continue;
      }

      const nextLatexCode = applyLatexBoldToFirstStandaloneTerm({
        latexCode,
        term: candidate.term,
      });

      if (nextLatexCode === latexCode) {
        continue;
      }

      latexCode = nextLatexCode;
      if (candidate.source === "emphasized") {
        appliedEmphasizedTermCount += 1;
      }
    }

    return {
      ...change,
      latexCode,
    };
  });
}

function learningDetailRejectsTechnologyExperience(detail: string) {
  return /\b(?:no|without)\s+(?:direct\s+)?(?:experience|exposure)|\bdo\s+not\s+add\b|\bdon't\s+add\b|\bdo\s+not\s+include\b|\bdon't\s+include\b|\bnot\s+include\b|\bunsupported\b|\bwithout\s+inventing\b/i.test(
    detail,
  );
}

export function readRequiredTailorResumeQuestioningKeywords(
  plan: Pick<
    TailoredResumePlanningResult,
    "changes" | "emphasizedTechnologies" | "questioningSummary"
  >,
): TailorResumeQuestioningKeywordRequirement[] {
  const plannedSegmentIds = new Set(plan.changes.map((change) => change.segmentId));
  const emphasizedTechnologiesByName = new Map(
    plan.emphasizedTechnologies.map((technology) => [
      normalizeTechnologyName(technology.name),
      technology.name,
    ]),
  );
  const requirementsByKeyword = new Map<
    string,
    TailorResumeQuestioningKeywordRequirement
  >();

  for (const learning of plan.questioningSummary?.learnings ?? []) {
    const detail = learning.detail.trim();

    if (!detail || learningDetailRejectsTechnologyExperience(detail)) {
      continue;
    }

    const keyword =
      emphasizedTechnologiesByName.get(normalizeTechnologyName(learning.topic)) ??
      "";

    if (!keyword) {
      continue;
    }

    const targetSegmentIds = [...new Set(learning.targetSegmentIds)].filter(
      (segmentId) => plannedSegmentIds.has(segmentId),
    );

    if (targetSegmentIds.length === 0) {
      continue;
    }

    const existingRequirement = requirementsByKeyword.get(
      normalizeTechnologyName(keyword),
    );

    requirementsByKeyword.set(normalizeTechnologyName(keyword), {
      detail: existingRequirement
        ? `${existingRequirement.detail}\n${detail}`
        : detail,
      keyword,
      targetSegmentIds: [
        ...new Set([
          ...(existingRequirement?.targetSegmentIds ?? []),
          ...targetSegmentIds,
        ]),
      ],
    });
  }

  return [...requirementsByKeyword.values()];
}

function serializeTailorResumeQuestioningKeywordRequirements(
  plan: TailoredResumePlanningResult,
) {
  const requirements = readRequiredTailorResumeQuestioningKeywords(plan);

  if (requirements.length === 0) {
    return "";
  }

  return [
    "Step 2 user-confirmed keyword requirements:",
    "The user confirmed these technologies can be used. Each keyword must appear in at least one replacement for its listed target segmentIds unless doing so would be structurally impossible; if impossible, keep the same segmentIds and make the smallest valid replacement that includes the keyword in the skills block.",
    ...requirements.map((requirement, index) =>
      [
        `${index + 1}. keyword: ${requirement.keyword}`,
        `   targetSegmentIds: ${requirement.targetSegmentIds.join(", ")}`,
        `   source learning: ${requirement.detail}`,
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

export function validateTailoredResumeImplementationIncludesQuestioningLearnings(input: {
  implementationChanges: Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">>;
  plan: Pick<
    TailoredResumePlanningResult,
    "changes" | "emphasizedTechnologies" | "questioningSummary"
  >;
}) {
  const implementationChangesById = new Map(
    input.implementationChanges.map((change) => [change.segmentId, change]),
  );
  const missingRequirements = readRequiredTailorResumeQuestioningKeywords(
    input.plan,
  ).filter((requirement) => {
    const targetChanges = requirement.targetSegmentIds.flatMap((segmentId) => {
      const change = implementationChangesById.get(segmentId);
      return change ? [change] : [];
    });

    if (targetChanges.length === 0) {
      return false;
    }

    return !targetChanges.some((change) =>
      resumeTextIncludesKeyword({
        term: requirement.keyword,
        text: change.latexCode,
      }),
    );
  });

  if (missingRequirements.length === 0) {
    return;
  }

  throw new Error(
    [
      "The implementation ignored user-confirmed Step 2 technologies.",
      "Add each missing keyword to at least one replacement for its target segmentIds:",
      ...missingRequirements.map(
        (requirement) =>
          `- ${requirement.keyword} -> ${requirement.targetSegmentIds.join(", ")}`,
      ),
    ].join("\n"),
  );
}

export function validateTailoredResumePlanningKeywordCoverage(input: {
  keywordCheckResult: TailorResumeKeywordCheckResult;
}) {
  if (input.keywordCheckResult.missingHighPriority.length > 0) {
    throw new Error(
      [
        "The Step 3 plan still misses required high-priority keywords in the resulting resume text.",
        `Missing high-priority keywords: ${input.keywordCheckResult.missingHighPriority.join(", ")}`,
        "Revise the planned block edits so those keywords appear in the tailored resume when they are already supported by the original resume or USER.md.",
      ].join("\n"),
    );
  }
}

export function validateTailoredResumePlanningKeywordAssignments(input: {
  keywordAssignmentCheckResult: TailorResumePlanningKeywordAssignmentCheckResult;
}) {
  if (input.keywordAssignmentCheckResult.unrecognizedTargetKeywords.length > 0) {
    throw new Error(
      [
        "The Step 3 plan targeted keywords that are not in the supported emphasized-technology list.",
        `Unrecognized target keywords: ${input.keywordAssignmentCheckResult.unrecognizedTargetKeywords.join(", ")}`,
        "Use exact keyword names from emphasizedTechnologies, or remove unsupported targets from the plan.",
      ].join("\n"),
    );
  }
}

export function validateTailoredResumeImplementationKeywordCoverage(input: {
  keywordCheckResult: TailorResumeKeywordCheckResult;
}) {
  if (input.keywordCheckResult.missingHighPriority.length > 0) {
    throw new Error(
      [
        "The Step 4 implementation regressed required high-priority keywords from the accepted Step 3 plan.",
        `Missing high-priority keywords: ${input.keywordCheckResult.missingHighPriority.join(", ")}`,
        "Keep Step 4 focused on block-scoped implementation and page-count discipline, but preserve the accepted plan's important keywords.",
      ].join("\n"),
    );
  }
}

function buildUserMarkdownPlanningContext(
  userMarkdown: TailorResumeUserMarkdownState | undefined,
) {
  const markdown = userMarkdown?.markdown.trim();

  if (!markdown || markdown === "# USER.md") {
    return "";
  }

  return (
    "USER.md memory context:\n" +
    "The following is durable, user-confirmed resume context. Use it only when it directly supports a planned edit to an existing resume block, and do not treat job-description-only facts as user experience.\n" +
    `${markdown}\n\n`
  );
}

function buildQuestioningSummaryPlanningContext(
  summary: TailoredResumePlanningResult["questioningSummary"] | null | undefined,
) {
  const learnings = summary?.learnings ?? [];

  if (learnings.length === 0) {
    return "";
  }

  return (
    "Recent Step 2 user-confirmed learnings from this run:\n" +
    "Use these alongside USER.md when choosing planned block edits. If a learning includes user-confirmed bullet-shaped experience for a job-emphasized technology, strongly consider a matching experience-bullet replacement/swap rather than only a skills-section edit.\n" +
    learnings
      .map((learning, index) =>
        [
          `${index + 1}. topic: ${learning.topic}`,
          `   targetSegmentIds: ${
            learning.targetSegmentIds.length > 0
              ? learning.targetSegmentIds.join(", ")
              : "[not decided yet; choose the matching resume block]"
          }`,
          `   detail: ${learning.detail}`,
        ].join("\n"),
      )
      .join("\n\n") +
    "\n\n"
  );
}

function buildUserMarkdownImplementationContext(
  userMarkdown: TailorResumeUserMarkdownState | undefined,
) {
  const markdown = userMarkdown?.markdown.trim();

  if (!markdown || markdown === "# USER.md") {
    return "";
  }

  return (
    "USER.md memory context:\n" +
    "Follow-up questions are disabled for this run, so use this durable user-confirmed context only where it directly supports the accepted planned segment edits. Do not spread unrelated facts to unrelated blocks.\n" +
    `${markdown}\n\n`
  );
}

function buildTechnologyExtractionInput(input: {
  employerName?: string | null;
  jobDescription: string;
}) {
  const employerContext = input.employerName?.trim()
    ? `Employer name: ${input.employerName.trim()}\n\n`
    : "";

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: `${employerContext}Job description only:\n${input.jobDescription}`,
        },
      ],
    },
  ];
}

export function buildTechnologyExtractionInstructions() {
  return buildTailorResumeTechnologyExtractionInstructions();
}

export function buildTechnologyExtractionReasoning() {
  return { effort: "low" as const };
}

async function extractTailorResumeJobDescriptionTechnologiesWithDebug(input: {
  client: OpenAI;
  employerName?: string | null;
  jobDescription: string;
  model: string;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  readDurationMs?: () => number;
}) {
  const responseInput = buildTechnologyExtractionInput({
    employerName: input.employerName,
    jobDescription: input.jobDescription,
  });
  const instructions = buildTechnologyExtractionInstructions();
  const response = await runTailorResumeStepModelRequest({
    attempt: 1,
    onStepEvent: input.onStepEvent,
    operation: (signal) =>
      input.client.responses.create({
        input: responseInput,
        instructions,
        max_output_tokens: tailorResumeKeywordExtractionMaxOutputTokens,
        model: input.model,
        reasoning: buildTechnologyExtractionReasoning(),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tailor_resume_job_technology_extraction",
            strict: true,
            schema: tailorResumeTechnologyExtractionSchema,
          },
        },
      }, { signal }),
    readDurationMs: input.readDurationMs ?? (() => 0),
    stepLabel: "Step 1 keyword extraction",
    stepNumber: 1,
    summary: "Scrape keywords",
  });
  const outputText = readOutputText(response);

  if (!outputText) {
    throw new Error("The model returned an empty technology extraction.");
  }

  return {
    extractionDebug: {
      outputJson: outputText,
      prompt: serializeTailoredResumePrompt({
        inputMessages: responseInput,
        instructions,
      }),
      skippedReason: null,
      systemPrompt: instructions,
    },
    technologies: parseTailorResumeTechnologyExtractionResponse(
      JSON.parse(outputText),
    ),
  };
}

async function extractTailorResumeJobDescriptionTechnologies(input: {
  client: OpenAI;
  employerName?: string | null;
  jobDescription: string;
  model: string;
}) {
  const result = await extractTailorResumeJobDescriptionTechnologiesWithDebug(
    input,
  );

  return result.technologies;
}

function buildTailoringPlanInstructions(input: {
  feedback?: string;
  ludicrousMissingSkillsSectionTerms?: string[];
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumePlanningSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
      ludicrousMissingSkillsSectionTerms:
        input.ludicrousMissingSkillsSectionTerms,
    },
  );
}

function buildTailoringImplementationInstructions(input: {
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumeImplementationSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
    },
  );
}

type AnthropicTextContentBlock = {
  text: string;
  type: "text";
};

type AnthropicToolUseContentBlock = {
  id: string;
  input: unknown;
  name: string;
  type: "tool_use";
};

type AnthropicToolResultContentBlock = {
  content: string;
  tool_use_id: string;
  type: "tool_result";
};

type AnthropicContentBlock =
  | AnthropicTextContentBlock
  | AnthropicToolResultContentBlock
  | AnthropicToolUseContentBlock;

type AnthropicMessage = {
  content: AnthropicContentBlock[];
  role: "assistant" | "user";
};

type AnthropicMessagesResponse = {
  content?: AnthropicContentBlock[];
  id?: string;
  model?: string;
};

function buildAnthropicRequestMessages(input: {
  messages: AnthropicMessage[];
  responseInput: TailorResumeStepResponseInput;
}) {
  const messages = [...input.messages];
  let pendingToolResults: AnthropicToolResultContentBlock[] = [];
  const flushPendingToolResults = () => {
    if (pendingToolResults.length === 0) {
      return;
    }

    messages.push({
      content: pendingToolResults,
      role: "user",
    });
    pendingToolResults = [];
  };

  for (const item of input.responseInput) {
    if ("role" in item) {
      flushPendingToolResults();
      const textBlocks = item.content
        .map((content) => content.text.trim())
        .filter(Boolean)
        .map<AnthropicTextContentBlock>((text) => ({
          text,
          type: "text",
        }));

      if (textBlocks.length > 0) {
        messages.push({
          content: textBlocks,
          role: "user",
        });
      }

      continue;
    }

    pendingToolResults.push({
      content: item.output,
      tool_use_id: item.call_id,
      type: "tool_result",
    });
  }

  flushPendingToolResults();

  return messages;
}

function normalizeAnthropicPlanningResponse(input: {
  fallbackModel: string;
  response: AnthropicMessagesResponse;
}): TailoredResumeResponse {
  const output: NonNullable<TailoredResumeResponse["output"]> = [];
  const textChunks: string[] = [];

  for (const content of input.response.content ?? []) {
    if (content.type === "text") {
      textChunks.push(content.text);
      output.push({
        content: [
          {
            text: content.text,
            type: "output_text",
          },
        ],
        type: "message",
      });
      continue;
    }

    if (content.type === "tool_use") {
      output.push({
        arguments: JSON.stringify(content.input ?? {}),
        call_id: content.id,
        name: content.name,
        type: "function_call",
      });
    }
  }

  const model = input.response.model ?? input.fallbackModel;

  return {
    id: input.response.id,
    model: `anthropic:${model}`,
    output,
    output_text: textChunks.join("").trim(),
  };
}

async function createAnthropicPlanningResponse(input: {
  apiKey: string;
  instructions: string;
  messages: AnthropicMessage[];
  model: string;
  responseInput: TailorResumeStepResponseInput;
  signal?: AbortSignal;
}) {
  const requestMessages = buildAnthropicRequestMessages({
    messages: input.messages,
    responseInput: input.responseInput,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: 8192,
      messages: requestMessages,
      model: input.model,
      system: input.instructions,
      tool_choice: { type: "auto" },
      tools: [
        {
          description: tailorResumePlanningKeywordCheckTool.description,
          input_schema: tailorResumePlanningKeywordCheckTool.parameters,
          name: tailorResumePlanningKeywordCheckTool.name,
        },
        {
          description: tailorResumeKeywordUsageTool.description,
          input_schema: tailorResumeKeywordUsageTool.parameters,
          name: tailorResumeKeywordUsageTool.name,
        },
        {
          description: tailorResumeMalformedBulletsTool.description,
          input_schema: tailorResumeMalformedBulletsTool.parameters,
          name: tailorResumeMalformedBulletsTool.name,
        },
        {
          description: tailorResumeSingleSkillQueryTool.description,
          input_schema: tailorResumeSingleSkillQueryTool.parameters,
          name: tailorResumeSingleSkillQueryTool.name,
        },
        {
          description: tailorResumeBatchSkillQueryTool.description,
          input_schema: tailorResumeBatchSkillQueryTool.parameters,
          name: tailorResumeBatchSkillQueryTool.name,
        },
      ],
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": input.apiKey,
    },
    method: "POST",
    signal: input.signal,
  });
  const responseJson = (await response.json().catch(() => null)) as
    | (AnthropicMessagesResponse & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    throw new Error(
      `Anthropic planning request failed with ${response.status}: ${
        responseJson?.error?.message ?? response.statusText
      }`,
    );
  }

  if (!responseJson) {
    throw new Error("Anthropic planning request returned an unreadable response.");
  }

  input.messages.splice(0, input.messages.length, ...requestMessages, {
    content: responseJson.content ?? [],
    role: "assistant",
  });

  return normalizeAnthropicPlanningResponse({
    fallbackModel: input.model,
    response: responseJson,
  });
}

function createTailorResumePlanningModelRequester(input: {
  instructions: string;
  modelRef: TailorResumeModelRef;
  openAiClient: OpenAI;
}) {
  let previousOpenAiResponseId: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];
  const anthropicApiKey =
    input.modelRef.provider === "anthropic" ? getAnthropicApiKey() : null;

  return {
    create(
      responseInput: TailorResumeStepResponseInput,
      signal?: AbortSignal,
    ): Promise<TailoredResumeResponse> {
      if (input.modelRef.provider === "anthropic") {
        return createAnthropicPlanningResponse({
          apiKey: anthropicApiKey ?? "",
          instructions: input.instructions,
          messages: anthropicMessages,
          model: input.modelRef.model,
          responseInput,
          signal,
        });
      }

      return input.openAiClient.responses
        .create({
          input: responseInput,
          instructions: input.instructions,
          max_output_tokens: tailorResumePlanningMaxOutputTokens,
          model: input.modelRef.model,
          parallel_tool_calls: false,
          previous_response_id: previousOpenAiResponseId,
          tools: [
            tailorResumePlanningKeywordCheckTool,
            tailorResumeKeywordUsageTool,
            tailorResumeMalformedBulletsTool,
            tailorResumeSingleSkillQueryTool,
            tailorResumeBatchSkillQueryTool,
          ],
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "tailor_resume_edit_plan",
              strict: true,
              schema: tailorResumePlanSchema,
            },
          },
        }, { signal })
        .then((response) => {
          previousOpenAiResponseId = response.id;
          return response as TailoredResumeResponse;
        });
    },
  };
}

async function runTailorResumeStepModelRequest<T>(input: {
  attempt: number;
  onStepEvent:
    | ((event: TailorResumeGenerationStepEvent) => void | Promise<void>)
    | undefined;
  operation: (signal: AbortSignal) => Promise<T>;
  readDurationMs: () => number;
  stepLabel: string;
  stepNumber: number;
  summary: string;
}) {
  return runWithTransientModelRetries({
    operation: async () => {
      const timeout = createTailorResumeStepAttemptTimeout(input.stepLabel);

      try {
        return await input.operation(timeout.signal);
      } catch (error) {
        throw normalizeTailorResumeStepTimeoutError({
          error,
          signal: timeout.signal,
          stepLabel: input.stepLabel,
        });
      } finally {
        timeout.clear();
      }
    },
    onRetry: async (retryEvent) => {
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt: input.attempt,
        detail:
          `The model request hit a transient network error (${retryEvent.message}). ` +
          `Retrying automatically (${retryEvent.nextAttempt}/${retryEvent.maxAttempts}).`,
        durationMs: input.readDurationMs(),
        retrying: true,
        status: "failed",
        stepNumber: input.stepNumber,
        summary: input.summary,
      });
    },
  });
}

export function applyTailorResumeBlockChanges(input: {
  annotatedLatexCode: string;
  changes: TailoredResumeBlockChange[];
}) {
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const blocks = readAnnotatedTailorResumeBlocks(normalizedInput.annotatedLatex);
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const changesById = new Map<string, TailoredResumeBlockChange>();

  for (const change of input.changes) {
    if (changesById.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate edits for segment ${change.segmentId}.`,
      );
    }

    if (!blocksById.has(change.segmentId)) {
      throw new Error(
        `The model referenced unknown segment ${change.segmentId}.`,
      );
    }

    changesById.set(change.segmentId, change);
  }

  const chunks: string[] = [];
  let cursor = 0;

  for (const block of blocks) {
    const change = changesById.get(block.id);

    chunks.push(
      normalizedInput.annotatedLatex.slice(cursor, block.markerStart),
    );

    if (!change) {
      chunks.push(
        normalizedInput.annotatedLatex.slice(block.markerStart, block.contentEnd),
      );
      cursor = block.contentEnd;
      continue;
    }

    const replacementLatex = repairTailoredResumeModelLatexBlock(
      stripTailorResumeSegmentIds(change.latexCode),
    );
    const replacementBlocks =
      replacementLatex.trim()
        ? readAnnotatedTailorResumeBlocks(replacementLatex)
        : [];

    if (replacementBlocks.length > 1) {
      throw new Error(
        `Replacement for segment ${change.segmentId} spans multiple logical blocks.`,
      );
    }

    if (replacementLatex.trim()) {
      chunks.push(replacementLatex);

      if (!replacementLatex.endsWith("\n") && block.contentEnd < normalizedInput.annotatedLatex.length) {
        chunks.push("\n");
      }
    }

    cursor = block.contentEnd;
  }

  chunks.push(normalizedInput.annotatedLatex.slice(cursor));

  return normalizeTailorResumeLatex(chunks.join(""));
}

export function repairTailoredResumeModelLatexBlock(latexCode: string) {
  const unescapedDollarIndexes: number[] = [];

  for (let index = 0; index < latexCode.length; index += 1) {
    if (latexCode[index] !== "$") {
      continue;
    }

    if (index > 0 && latexCode[index - 1] === "\\") {
      continue;
    }

    unescapedDollarIndexes.push(index);
  }

  if (unescapedDollarIndexes.length !== 1) {
    return latexCode;
  }

  const dollarIndex = unescapedDollarIndexes[0] ?? -1;

  if (dollarIndex === -1) {
    return latexCode;
  }

  return `${latexCode.slice(0, dollarIndex)}\\$${latexCode.slice(dollarIndex + 1)}`;
}

export function buildInvalidTailorResumeReplacementLogPayload(input: {
  annotatedLatexCode: string;
  candidate: TailoredResumeStructuredResponse;
  error: string;
  modelDebug?: TailoredResumeOpenAiDebugStage;
}) {
  const blocksById = new Map(
    readAnnotatedTailorResumeBlocks(input.annotatedLatexCode).map((block) => [
      block.id,
      block,
    ]),
  );

  const referencedBlockSections = input.candidate.changes.map((change, index) => {
    const sourceBlock = blocksById.get(change.segmentId);
    const sectionLines = [
      `Change ${index + 1}`,
      `segmentId: ${change.segmentId}`,
      `reason: ${change.reason.trim() || "[missing reason]"}`,
      `source command: ${sourceBlock?.command ?? "[missing]"}`,
      "Original block:",
      sourceBlock?.latexCode || "[segment not found in annotated source LaTeX]",
      "Replacement block:",
      change.latexCode || "[empty string]",
    ];

    return sectionLines.join("\n");
  });

  return [
    "Tailor Resume invalid replacement",
    "",
    "Validation error:",
    input.error,
    "",
    "Structured response:",
    JSON.stringify(input.candidate, null, 2),
    "",
    ...(input.modelDebug
      ? [
          "Step 4 model debug:",
          JSON.stringify(
            {
              outputJson: input.modelDebug.outputJson,
              prompt: input.modelDebug.prompt,
              skippedReason: input.modelDebug.skippedReason,
              systemPrompt: input.modelDebug.systemPrompt,
              toolCalls: input.modelDebug.toolCalls ?? [],
            },
            null,
            2,
          ),
          "",
        ]
      : []),
    "Referenced source blocks:",
    referencedBlockSections.length > 0
      ? referencedBlockSections.join("\n\n---\n\n")
      : "[no block changes returned]",
    "",
    "Annotated source LaTeX:",
    input.annotatedLatexCode,
  ].join("\n");
}

function applySavedTailoredResumeLinks(
  annotatedLatexCode: string,
  linkOverrides: TailorResumeLinkRecord[],
) {
  if (linkOverrides.length === 0) {
    return {
      normalizedLatex: normalizeTailorResumeLatex(annotatedLatexCode),
      updatedCount: 0,
      updatedLinks: [],
    };
  }

  const overrideResult = applyTailorResumeLinkOverridesWithSummary(
    annotatedLatexCode,
    linkOverrides,
  );

  return {
    normalizedLatex: normalizeTailorResumeLatex(overrideResult.latexCode),
    updatedCount: overrideResult.updatedCount,
    updatedLinks: overrideResult.updatedLinks,
  };
}

function buildTailoringPlanInput(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobDescription: string;
  planningSnapshot: ReturnType<typeof buildTailorResumePlanningSnapshot>;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"] | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "Job description source for job fit and emphasizedTechnologies. " +
            "Use only this section as evidence for emphasizedTechnologies:\n" +
            input.jobDescription,
        },
        {
          type: "input_text" as const,
          text:
            "Resume context for planning edits only. Do not use this section as evidence for emphasizedTechnologies:\n" +
            `Whole resume plain text:\n${input.planningSnapshot.resumePlainText}\n\n` +
            buildQuestioningSummaryPlanningContext(input.questioningSummary) +
            buildUserMarkdownPlanningContext(input.userMarkdown) +
            "Editable resume blocks (document order):\n" +
            serializeTailorResumePlanningBlocks(input.planningSnapshot.blocks),
        },
        {
          type: "input_text" as const,
          text:
            "Step 1 pre-scanned technologies emphasized by the job description. Use this as keyword guidance when planning factually supported edits:\n" +
            serializeTailorResumeEmphasizedTechnologies(
              input.emphasizedTechnologies,
            ),
        },
      ],
    },
  ];
}

function buildImplementationRequiredTechnologies(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
}) {
  const targetedKeywordNames = new Set(
    input.planningResult.changes.flatMap((change) =>
      change.targetKeywords.map(normalizeTechnologyName),
    ),
  );
  const legacyPlannedResumePlainText = buildPlannedResumePlainText({
    changes: input.planningResult.changes,
    planningSnapshot: input.planningSnapshot,
  });

  return input.emphasizedTechnologies.filter(
    (technology) =>
      technology.priority === "high" ||
      targetedKeywordNames.has(normalizeTechnologyName(technology.name)) ||
      resumeTextIncludesKeyword({
        term: technology.name,
        text: legacyPlannedResumePlainText,
      }),
  );
}

function userMarkdownRejectsTechnologyExperience(input: {
  technologyName: string;
  userMarkdown: string;
}) {
  const matchingSections: string[] = [];
  let currentHeadingMatchesTechnology = false;
  let currentSectionLines: string[] = [];
  const flushCurrentSection = () => {
    if (currentHeadingMatchesTechnology && currentSectionLines.length > 0) {
      matchingSections.push(currentSectionLines.join("\n"));
    }

    currentHeadingMatchesTechnology = false;
    currentSectionLines = [];
  };
  const matchingStandaloneLines = input.userMarkdown
    .split(/\n+/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const headingMatch = /^(?:#{1,6})\s+(.+)$/.exec(line);

      if (headingMatch) {
        flushCurrentSection();
        currentHeadingMatchesTechnology = resumeTextIncludesKeyword({
          term: input.technologyName,
          text: headingMatch[1] ?? "",
        });
        currentSectionLines = currentHeadingMatchesTechnology ? [line] : [];
        return [];
      }

      if (currentHeadingMatchesTechnology) {
        currentSectionLines.push(line);
      }

      return resumeTextIncludesKeyword({
        term: input.technologyName,
        text: line,
      })
        ? [line]
        : [];
    });

  flushCurrentSection();

  return [...matchingSections, ...matchingStandaloneLines].some((text) => {
    const grantsSkillsPermission =
      /\b(?:can|may|ok(?:ay)?\s+to)\s+(?:list|include)\b/i.test(text) &&
      /\bskills?\b/i.test(text);
    const rejectsExperience =
      /\b(?:no|without)\b[^.\n;]{0,120}\b(?:experience|exposure)\b/i.test(
        text,
      ) ||
      /\b(?:do\s+not|don't|does\s+not|doesn't|cannot|can't)\s+have\b[^.\n;]{0,120}\b(?:experience|exposure)\b/i.test(
        text,
      ) ||
      /\b(?:do\s+not|don't|should\s+not|shouldn't)\s+(?:invent|add|include|claim)\b/i.test(
        text,
      ) ||
      /\bunsupported\b/i.test(text);

    return rejectsExperience && !grantsSkillsPermission;
  });
}

export function filterUnsupportedEmphasizedTechnologiesForPlanning(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  resumePlainText: string;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  if (!input.userMarkdown) {
    return input.emphasizedTechnologies;
  }

  const userMarkdown = input.userMarkdown;
  const keywordPresenceContext = buildTailorResumeKeywordPresenceContext({
    emphasizedTechnologies: input.emphasizedTechnologies,
    originalResumeText: input.resumePlainText,
    userMarkdown: userMarkdown.markdown,
  });
  const supportedTechnologyNames = new Set(
    keywordPresenceContext.terms
      .filter(
        (term) =>
          term.presentInOriginalResume ||
          (term.presentInUserMarkdown &&
            !userMarkdownRejectsTechnologyExperience({
              technologyName: term.name,
              userMarkdown: userMarkdown.markdown,
            })),
      )
      .map((term) => normalizeTechnologyName(term.name)),
  );

  return input.emphasizedTechnologies.filter((technology) =>
    supportedTechnologyNames.has(normalizeTechnologyName(technology.name)),
  );
}

function buildTailoringImplementationInput(input: {
  jobDescription: string;
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  plan: TailoredResumePlanResponse;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  const questioningLearningsText =
    input.plan.questioningSummary &&
    input.plan.questioningSummary.learnings.length > 0
      ? [
          "User-confirmed background learnings:",
          ...input.plan.questioningSummary.learnings.map((learning, index) =>
            [
              `${index + 1}. topic: ${learning.topic}`,
              `   targetSegmentIds: ${
                learning.targetSegmentIds.length > 0
                  ? learning.targetSegmentIds.join(", ")
                  : "[none]"
              }`,
              `   detail: ${learning.detail}`,
            ].join("\n"),
          ),
          "",
        ].join("\n")
      : "";

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            `Job description:\n${input.jobDescription}\n\n` +
            "Accepted tailoring thesis:\n" +
            `jobDescriptionFocus: ${input.plan.thesis.jobDescriptionFocus}\n` +
            `resumeChanges: ${input.plan.thesis.resumeChanges}\n\n` +
            "Technologies emphasized by the job description:\n" +
            serializeTailorResumeEmphasizedTechnologies(
              input.plan.emphasizedTechnologies,
            ) +
            "\n\n" +
            questioningLearningsText +
            serializeTailorResumeQuestioningKeywordRequirements(input.plan) +
            buildUserMarkdownImplementationContext(input.userMarkdown) +
            "Planned segment edits:\n" +
            serializeTailorResumeImplementationBlocks({
              planningBlocksById: input.planningBlocksById,
              plannedChanges: input.plan.changes,
            }),
        },
      ],
    },
  ];
}

function serializeTailoredResumePrompt(input: {
  instructions: string;
  inputMessages: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    role?: string;
  }>;
}) {
  const serializedInput = input.inputMessages
    .map((message) => {
      const textBlocks = (message.content ?? [])
        .filter((contentBlock) => contentBlock.type === "input_text")
        .map((contentBlock) => contentBlock.text?.trim() ?? "")
        .filter(Boolean);

      if (textBlocks.length === 0) {
        return null;
      }

      return [`Role: ${message.role ?? "user"}`, ...textBlocks].join("\n\n");
    })
    .filter((message) => message !== null)
    .join("\n\n---\n\n");

  return [
    "Instructions:",
    input.instructions.trim(),
    "",
    "Input:",
    serializedInput || "[no input text]",
  ].join("\n");
}

function buildFallbackTailoredResumePlanningResult(): TailoredResumePlanningResult {
  const fallbackMetadata = normalizeTailoredResumeMetadata({});

  return {
    changes: [],
    companyName: fallbackMetadata.companyName,
    displayName: fallbackMetadata.displayName,
    emphasizedTechnologies: [],
    jobIdentifier: fallbackMetadata.jobIdentifier,
    positionTitle: fallbackMetadata.positionTitle,
    questioningSummary: null,
    thesis: {
      jobDescriptionFocus:
        "TEST_OPENAI_RESPONSE or fallback mode skipped the planning call, so no planner thesis was generated.",
      resumeChanges:
        "No intermediate plan was produced; the base resume was compiled without planned block edits.",
    },
  } satisfies TailoredResumePlanningResult;
}

export function buildPrePlanningTailoredResumePlanningResult(input: {
  companyName?: string | null;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  positionTitle?: string | null;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"];
}): TailoredResumePlanningResult {
  const companyName = input.companyName?.trim() ?? "";
  const positionTitle = input.positionTitle?.trim() ?? "";

  return {
    changes: [],
    companyName,
    displayName: buildDisplayName({ companyName, positionTitle }),
    emphasizedTechnologies: input.emphasizedTechnologies,
    jobIdentifier: "General",
    positionTitle,
    questioningSummary: input.questioningSummary ?? null,
    thesis: {
      jobDescriptionFocus:
        "Step 3 planning has not run yet; Step 2 is reviewing skills-section keyword coverage first.",
      resumeChanges:
        "The edit-intent plan will be generated after Step 2 keyword review is complete.",
    },
  } satisfies TailoredResumePlanningResult;
}

function buildFallbackTailoredResumeOpenAiDebug() {
  return {
    implementation: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Implementation stage did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
      systemPrompt: buildTailoringImplementationInstructions({}),
    },
    keywordExtraction: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Keyword extraction did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
      systemPrompt: buildTechnologyExtractionInstructions(),
    },
    keywordReview: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Keyword review did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
      systemPrompt: buildTailorResumeInterviewSystemPrompt(
        createDefaultSystemPromptSettings(),
        { debugForceConversation: false },
      ),
    },
    planning: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Planning stage did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
      systemPrompt: buildTailoringPlanInstructions({}),
    },
  } satisfies TailoredResumeOpenAiDebugTrace;
}

export async function extractTailorResumeEmphasizedTechnologiesForQuestioning(input: {
  employerName?: string | null;
  jobDescription: string;
  nonTechnologies?: readonly string[] | null;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
}): Promise<ExtractTailorResumeEmphasizedTechnologiesResult> {
  const startedAt = Date.now();
  const model =
    process.env.OPENAI_TAILOR_RESUME_KEYWORD_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5.5";
  const client = getOpenAIClient();
  const technologyHintTechnologies =
    extractTailorResumeJobDescriptionTechnologyHints(input.jobDescription, {
      employerName: input.employerName,
      nonTechnologies: input.nonTechnologies,
    });

  if (technologyHintTechnologies.length > 0) {
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail:
        `Identified ${technologyHintTechnologies.length} job keyword ` +
        `${technologyHintTechnologies.length === 1 ? "term" : "terms"} while preparing Step 2 keyword review.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: technologyHintTechnologies,
      retrying: false,
      status: "running",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
  } else {
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail: "Scanning the job description for concrete technologies before planning edits.",
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: [],
      retrying: false,
      status: "running",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
  }

  let extractedTechnologies: TailoredResumeEmphasizedTechnology[] = [];
  let extractionDebug: TailoredResumeOpenAiDebugStage = {
    outputJson: null,
    prompt: null,
    skippedReason: "Step 1 model-assisted keyword extraction has not run yet.",
    systemPrompt: buildTechnologyExtractionInstructions(),
  };

  try {
    const extractionResult =
      await extractTailorResumeJobDescriptionTechnologiesWithDebug({
        client,
        employerName: input.employerName,
        jobDescription: input.jobDescription,
        model,
        onStepEvent: input.onStepEvent,
        readDurationMs: () => Math.max(0, Date.now() - startedAt),
      });
    extractedTechnologies = extractionResult.technologies;
    extractionDebug = extractionResult.extractionDebug;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Model-assisted technology extraction failed.";
    extractionDebug = {
      outputJson: null,
      prompt: null,
      skippedReason:
        `${errorMessage} Deterministic keyword hints were used instead.`,
      systemPrompt: buildTechnologyExtractionInstructions(),
    };
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail:
        `${errorMessage} Falling back to deterministic keyword hints so the run can continue.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: technologyHintTechnologies,
      retrying: true,
      status: "failed",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
    extractedTechnologies = [];
  }

  const emphasizedTechnologies = mergeTailorResumeJobDescriptionTechnologies({
    employerName: input.employerName,
    extractedTechnologies: [
      ...technologyHintTechnologies,
      ...extractedTechnologies,
    ],
    jobDescription: input.jobDescription,
    nonTechnologies: input.nonTechnologies,
    plannerTechnologies: [],
  });

  await emitTailorResumeGenerationStep(input.onStepEvent, {
    attempt: 1,
    detail:
      emphasizedTechnologies.length > 0
        ? `Prepared ${emphasizedTechnologies.length} job keyword ${emphasizedTechnologies.length === 1 ? "term" : "terms"} for Step 2 keyword review and Step 3 planning.`
        : "No concrete job keyword terms were identified for Step 2 keyword review.",
    durationMs: Math.max(0, Date.now() - startedAt),
    emphasizedTechnologies,
    retrying: false,
    status: "succeeded",
    stepNumber: 1,
    summary: "Scrape keywords",
  });

  return {
    emphasizedTechnologies,
    extractionDebug,
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    model,
  };
}

export async function planTailoredResume(input: {
  annotatedLatexCode: string;
  employerName?: string | null;
  jobDescription: string;
  ludicrousMissingSkillsSectionTerms?: string[];
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  precomputedEmphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  promptSettings?: SystemPromptSettings;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"] | null;
  skillData?: TailorResumeStoredSkillData | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<PlanTailoredResumeResult> {
  const startedAt = Date.now();
  const planningModelRef = resolveTailorResumePlanningModelRef();
  const model = planningModelRef.serialized;
  const maxPlanningAttempts = Math.min(2, getRetryAttemptsToGenerateLatexEdits());
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const planningSnapshot = buildTailorResumePlanningSnapshot(
    normalizedInput.annotatedLatex,
  );
  const fallbackPlanningResult = buildFallbackTailoredResumePlanningResult();
  const client = getOpenAIClient();
  let planningFeedback = "";
  let lastError =
    `Unable to produce a tailored resume plan after ${maxPlanningAttempts} attempts.`;
  let lastModel = model;
  let lastPlanningResult = fallbackPlanningResult;
  let lastPlanningDebug: TailoredResumeOpenAiDebugStage = {
    outputJson: null,
    prompt: null,
    skippedReason:
      "Planning stage did not run because no valid planner response was produced.",
    systemPrompt: buildTailoringPlanInstructions({
      ludicrousMissingSkillsSectionTerms:
        input.ludicrousMissingSkillsSectionTerms,
      promptSettings: input.promptSettings,
    }),
  };
  const planningToolCalls: TailoredResumeOpenAiDebugToolCall[] = [];
  const technologyExtractionPromise = input.precomputedEmphasizedTechnologies
    ? Promise.resolve(input.precomputedEmphasizedTechnologies)
    : extractTailorResumeJobDescriptionTechnologies({
        client,
        employerName: input.employerName,
        jobDescription: input.jobDescription,
        model: process.env.OPENAI_TAILOR_RESUME_KEYWORD_MODEL ?? "gpt-5.5",
      })
        .catch(() => [] as TailoredResumeEmphasizedTechnology[])
        .then((extractedTechnologies) =>
          mergeTailorResumeJobDescriptionTechnologies({
            employerName: input.employerName,
            extractedTechnologies: [
              ...extractTailorResumeJobDescriptionTechnologyHints(
                input.jobDescription,
                {
                  employerName: input.employerName,
                  nonTechnologies: input.userMarkdown?.nonTechnologies,
                },
              ),
              ...extractedTechnologies,
            ],
            jobDescription: input.jobDescription,
            nonTechnologies: input.userMarkdown?.nonTechnologies,
            plannerTechnologies: [],
          }),
        );

  const emphasizedTechnologiesAfterNonTechnologyFilter =
    filterTailorResumeNonTechnologiesFromEmphasizedTechnologies(
      await technologyExtractionPromise,
      input.userMarkdown?.nonTechnologies,
    ).filter((technology) => technology.classification !== "non_skill");
  const emphasizedTechnologiesForPlanning =
    filterUnsupportedEmphasizedTechnologiesForPlanning({
      emphasizedTechnologies: emphasizedTechnologiesAfterNonTechnologyFilter,
      resumePlainText: planningSnapshot.resumePlainText,
      userMarkdown: input.userMarkdown,
    });

  for (let attempt = 1; attempt <= maxPlanningAttempts; attempt += 1) {
    const planInput = buildTailoringPlanInput({
      emphasizedTechnologies: emphasizedTechnologiesForPlanning,
      jobDescription: input.jobDescription,
      planningSnapshot,
      questioningSummary: input.questioningSummary,
      userMarkdown: input.userMarkdown,
    });
    const planInstructions = buildTailoringPlanInstructions({
      feedback: planningFeedback,
      ludicrousMissingSkillsSectionTerms:
        input.ludicrousMissingSkillsSectionTerms,
      promptSettings: input.promptSettings,
    });
    const planningPrompt = serializeTailoredResumePrompt({
      inputMessages: planInput,
      instructions: planInstructions,
    });
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail:
        attempt === 1
          ? "Starting the planning pass to decide which resume blocks should change."
          : "Retrying the planning pass after the previous attempt failed.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt > 1,
      status: "running",
      stepNumber: 3,
      summary: "Generating edit intent outline",
    });
    let response: TailoredResumeResponse;

    try {
      let responseInput: TailorResumeStepResponseInput = planInput;
      let finalResponse: TailoredResumeResponse | null = null;
      let keywordCheckCalled = false;
      const planningModelRequester = createTailorResumePlanningModelRequester({
        instructions: planInstructions,
        modelRef: planningModelRef,
        openAiClient: client,
      });

      for (
        let toolRound = 1;
        toolRound <= maxTailorResumePlanningToolCallsPerAttempt;
        toolRound += 1
      ) {
        const roundResponse = (await runTailorResumeStepModelRequest({
          attempt,
          onStepEvent: input.onStepEvent,
          operation: (signal) => planningModelRequester.create(responseInput, signal),
          readDurationMs: () => Math.max(0, Date.now() - startedAt),
          stepLabel: "Step 3 planning",
          stepNumber: 3,
          summary: "Generating edit intent outline",
        })) as TailoredResumeResponse;

        const inspectionToolCalls = findInspectionToolCalls(roundResponse);
        const keywordCheckToolCalls =
          findPlanningKeywordCheckToolCalls(roundResponse);

        if (inspectionToolCalls.length > 0 || keywordCheckToolCalls.length > 0) {
          const nextResponseInput: TailorResumeStepResponseInput = [];

          for (const inspectionToolCall of inspectionToolCalls) {
            let inspectionToolOutput: string | null = null;
            try {
              try {
                const inspectionArguments = JSON.parse(
                  inspectionToolCall.arguments,
                );

                if (
                  inspectionToolCall.name === tailorResumeSingleSkillQueryToolName
                ) {
                  inspectionToolOutput =
                    buildTailorResumeSingleSkillQueryToolOutput({
                      ...parseTailorResumeSingleSkillQuery(inspectionArguments),
                      skillData: input.skillData,
                    });
                } else if (
                  inspectionToolCall.name === tailorResumeBatchSkillQueryToolName
                ) {
                  inspectionToolOutput =
                    buildTailorResumeBatchSkillQueryToolOutput({
                      queries:
                        parseTailorResumeBatchSkillQuery(inspectionArguments),
                      skillData: input.skillData,
                    });
                } else {
                  const inspectionPayload =
                    parseResumeInspectionPayload(inspectionArguments);
                  const candidateAnnotatedLatex = applyInspectionChanges({
                    annotatedLatexCode: normalizedInput.annotatedLatex,
                    changes: inspectionPayload.changes,
                  });
                  inspectionToolOutput =
                    inspectionToolCall.name === tailorResumeKeywordUsageToolName
                      ? buildResumeKeywordUsageToolOutput({
                          annotatedLatexCode: candidateAnnotatedLatex,
                          emphasizedTechnologies:
                            emphasizedTechnologiesForPlanning,
                        })
                      : await buildResumeMalformedBulletsToolOutput({
                          annotatedLatexCode: candidateAnnotatedLatex,
                          changedSegmentIds: new Set(
                            inspectionPayload.changes.map(
                              (change) => change.segmentId,
                            ),
                          ),
                        });
                }
              } catch (error) {
                inspectionToolOutput = buildPlanningKeywordCheckRepairToolOutput({
                  error:
                    error instanceof Error
                      ? error.message
                      : "The inspection tool call was invalid.",
                  planningBlocks: planningSnapshot.blocks,
                });
              }
              nextResponseInput.push({
                call_id: inspectionToolCall.call_id,
                output: inspectionToolOutput,
                type: "function_call_output" as const,
              });
            } finally {
              planningToolCalls.push(
                buildTailorResumeDebugToolCall({
                  id: inspectionToolCall.call_id,
                  input: inspectionToolCall.arguments,
                  output: inspectionToolOutput,
                  toolName: inspectionToolCall.name,
                }),
              );
            }
          }

          for (const keywordCheckToolCall of keywordCheckToolCalls) {
            keywordCheckCalled = true;
            let keywordCheckToolOutput: string | null = null;
            try {
              try {
                const candidateChanges = parseKeywordCheckPlanningChanges(
                  JSON.parse(keywordCheckToolCall.arguments),
                );
                validateTailoredResumePlanChanges({
                  changes: candidateChanges.map((change) => ({
                    ...change,
                    reason: "[keyword check candidate]",
                  })),
                  planningBlocks: planningSnapshot.blocks,
                });
                const keywordAssignmentCheckResult =
                  buildTailorResumePlanningKeywordAssignmentCheckResult({
                    changes: candidateChanges,
                    emphasizedTechnologies: emphasizedTechnologiesForPlanning,
                    planningSnapshot,
                  });
                keywordCheckToolOutput = buildKeywordCheckToolOutput(
                  keywordAssignmentCheckResult,
                );
              } catch (error) {
                keywordCheckToolOutput = buildPlanningKeywordCheckRepairToolOutput({
                  error:
                    error instanceof Error
                      ? error.message
                      : "The keyword-check tool call was invalid.",
                  planningBlocks: planningSnapshot.blocks,
                });
              }
              nextResponseInput.push({
                call_id: keywordCheckToolCall.call_id,
                output: keywordCheckToolOutput,
                type: "function_call_output" as const,
              });
            } finally {
              planningToolCalls.push(
                buildTailorResumeDebugToolCall({
                  id: keywordCheckToolCall.call_id,
                  input: keywordCheckToolCall.arguments,
                  output: keywordCheckToolOutput,
                  toolName: keywordCheckToolCall.name,
                }),
              );
            }
          }

          responseInput = nextResponseInput;
          continue;
        }

        {
          if (!keywordCheckCalled) {
            responseInput = buildRequiredKeywordCheckToolReminderInput({
              finalResponse: roundResponse,
              stageName: "Step 3 plan",
              toolName: tailorResumePlanningKeywordCheckToolName,
            });
            continue;
          }

          finalResponse = roundResponse;
          break;
        }
      }

      if (!finalResponse) {
        throw new Error(
          keywordCheckCalled
            ? `The model did not return a final planning response after the keyword check within ${maxTailorResumePlanningToolCallsPerAttempt} tool rounds.`
            : `The model did not return a final planning response within ${maxTailorResumePlanningToolCallsPerAttempt} tool rounds.`,
        );
      }

      response = finalResponse;
    } catch (error) {
      lastError = isTransientModelError(error)
        ? formatTransientModelError(error)
        : error instanceof Error
          ? error.message
          : "The planning pass failed before a valid response was produced.";
      const timedOut = isTailorResumeStepTimeoutError(error);
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: !timedOut && attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating edit intent outline",
      });
      lastPlanningDebug = {
        outputJson: null,
        prompt: planningPrompt,
        skippedReason: null,
        systemPrompt: planInstructions,
        ...(planningToolCalls.length > 0
          ? { toolCalls: [...planningToolCalls] }
          : {}),
      };
      planningFeedback =
        `The previous planning attempt failed before producing a valid final plan.\n\nExact issue:\n${lastError}\n\nCall ${tailorResumePlanningKeywordCheckToolName} before returning the final structured response, and then return the full structured response with thesis, metadata, and intent block changes. Use only these segmentId values: ${formatTailorResumePlanningSegmentIds(planningSnapshot.blocks)}.`;

      if (!timedOut && attempt < maxPlanningAttempts) {
        continue;
      }

      break;
    }

    lastModel = response.model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty tailoring plan.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating edit intent outline",
      });
      planningFeedback =
        "The previous response was empty. Return the full structured response with thesis, metadata, and intent block changes.";
      lastPlanningDebug = {
        outputJson: null,
        prompt: planningPrompt,
        skippedReason: null,
        systemPrompt: planInstructions,
        ...(planningToolCalls.length > 0
          ? { toolCalls: [...planningToolCalls] }
          : {}),
      };
      continue;
    }

    try {
      const nextPlan = parseTailoredResumePlanResponse(
        parseTailorResumeModelJsonOutput(outputText),
      );
      const plannerMergedTechnologies =
        mergeTailorResumeJobDescriptionTechnologies({
          employerName: input.employerName,
          extractedTechnologies: emphasizedTechnologiesForPlanning,
          jobDescription: input.jobDescription,
          nonTechnologies: input.userMarkdown?.nonTechnologies,
          plannerTechnologies: nextPlan.emphasizedTechnologies,
        });
      const reviewedOrderedTechnologies =
        input.precomputedEmphasizedTechnologies &&
        input.precomputedEmphasizedTechnologies.length > 0
          ? mergeTailorResumeScrapedKeywordSnapshot({
              planningTechnologies: plannerMergedTechnologies,
              scrapedTechnologies: input.precomputedEmphasizedTechnologies,
            })
          : plannerMergedTechnologies;
      const nextPlanWithJobTechnologies: TailoredResumePlanResponse = {
        ...nextPlan,
        emphasizedTechnologies: input.precomputedEmphasizedTechnologies
          ? reviewedOrderedTechnologies
          : filterUnsupportedEmphasizedTechnologiesForPlanning({
              emphasizedTechnologies: reviewedOrderedTechnologies,
              resumePlainText: planningSnapshot.resumePlainText,
              userMarkdown: input.userMarkdown,
            }),
      };
      validateTailoredResumePlanChanges({
        changes: nextPlanWithJobTechnologies.changes,
        planningBlocks: planningSnapshot.blocks,
      });
      validateTailoredResumePlanningKeywordAssignments({
        keywordAssignmentCheckResult:
          buildTailorResumePlanningKeywordAssignmentCheckResult({
            changes: nextPlanWithJobTechnologies.changes,
            emphasizedTechnologies:
              nextPlanWithJobTechnologies.emphasizedTechnologies,
            planningSnapshot,
          }),
      });
      lastPlanningResult = nextPlanWithJobTechnologies;
      lastPlanningDebug = {
        outputJson: outputText,
        prompt: planningPrompt,
        skippedReason: null,
        systemPrompt: planInstructions,
        ...(planningToolCalls.length > 0
          ? { toolCalls: [...planningToolCalls] }
          : {}),
      };
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail:
          nextPlanWithJobTechnologies.changes.length > 0
            ? `Planner identified ${nextPlanWithJobTechnologies.changes.length} block change${nextPlanWithJobTechnologies.changes.length === 1 ? "" : "s"}.`
            : "Planner found no block-level changes to apply.",
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: nextPlanWithJobTechnologies.emphasizedTechnologies,
        retrying: false,
        status: "succeeded",
        stepNumber: 3,
        summary: "Generating edit intent outline",
      });

      return {
        attempts: attempt,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        model: lastModel,
        ok: true,
        planningDebug: lastPlanningDebug,
        planningResult: nextPlanWithJobTechnologies,
        planningSnapshot,
        thesis: nextPlanWithJobTechnologies.thesis,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable tailoring plan.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating edit intent outline",
      });
      planningFeedback =
        `The previous response could not be parsed or validated.\n\nExact issue:\n${lastError}\n\nReturn the full structured response with thesis, metadata, and intent block changes. Use only these segmentId values: ${formatTailorResumePlanningSegmentIds(planningSnapshot.blocks)}.`;
      lastPlanningDebug = {
        outputJson: outputText,
        prompt: planningPrompt,
        skippedReason: null,
        systemPrompt: planInstructions,
        ...(planningToolCalls.length > 0
          ? { toolCalls: [...planningToolCalls] }
          : {}),
      };
    }
  }

  return {
    attempts: maxPlanningAttempts,
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    model: lastModel,
    ok: false,
    planningDebug: lastPlanningDebug,
    planningResult: lastPlanningResult,
    planningSnapshot,
    thesis: lastPlanningResult.thesis,
    validationError: lastError,
  };
}

export async function implementTailoredResumePlan(input: {
  annotatedLatexCode: string;
  generationDurationMsBase?: number;
  jobDescription: string;
  keywordExtractionDebug?: TailoredResumeOpenAiDebugStage;
  keywordReviewDebug?: TailoredResumeOpenAiDebugStage;
  linkOverrides?: TailorResumeLinkRecord[];
  model?: string;
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  planningDebug: TailoredResumeOpenAiDebugStage;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot?: TailorResumePlanningSnapshot;
  promptSettings?: SystemPromptSettings;
  skillData?: TailorResumeStoredSkillData | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const model = input.model ?? process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const planningSnapshot =
    input.planningSnapshot ??
    buildTailorResumePlanningSnapshot(normalizedInput.annotatedLatex);
  const implementationRequiredTechnologies = buildImplementationRequiredTechnologies({
    emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
    planningResult: input.planningResult,
    planningSnapshot,
  });
  const planningBlocksById = new Map(
    planningSnapshot.blocks.map((block) => [block.segmentId, block]),
  );
  const readGenerationDurationMs = () =>
    (input.generationDurationMsBase ?? 0) + Math.max(0, Date.now() - startedAt);
  const fallbackMetadata = normalizeTailoredResumeMetadata(input.planningResult);
  let lastError: string | null = null;
  let lastAnnotatedLatex = normalizedInput.annotatedLatex;
  let lastEdits: TailoredResumeBlockEditRecord[] = [];
  let lastSavedLinkUpdateCount = 0;
  let lastSavedLinkUpdates: TailorResumeSavedLinkUpdate[] = [];
  let lastModel = model;
  let hasAppliedCandidate = false;
  let completedImplementationAttempts = 0;
  let implementationPrompt: string | null = null;
  let implementationOutputJson: string | null = null;
  let implementationSkippedReason: string | null =
    "Implementation stage has not run yet.";
  const implementationToolCalls: TailoredResumeOpenAiDebugToolCall[] = [];

  if (input.planningResult.changes.length === 0) {
    implementationSkippedReason =
      "Implementation stage was skipped because the planner returned no segment changes.";
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: null,
      detail: "The accepted plan did not require any block-scoped LaTeX replacements.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: false,
      status: "skipped",
      stepNumber: 4,
      summary: "Planner found no block-scoped edits to apply",
    });
    const openAiDebug: TailoredResumeOpenAiDebugTrace = {
      implementation: {
        outputJson: null,
        prompt: null,
        skippedReason: implementationSkippedReason,
        systemPrompt: buildTailoringImplementationInstructions({
          promptSettings: input.promptSettings,
        }),
        ...(implementationToolCalls.length > 0
          ? { toolCalls: [...implementationToolCalls] }
          : {}),
      },
      ...(input.keywordExtractionDebug
        ? { keywordExtraction: input.keywordExtractionDebug }
        : {}),
      ...(input.keywordReviewDebug
        ? { keywordReview: input.keywordReviewDebug }
        : {}),
      planning: input.planningDebug,
    };
    const normalizedCandidate = applySavedTailoredResumeLinks(
      normalizedInput.annotatedLatex,
      linkOverrides,
    );
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
    );

    hasAppliedCandidate = true;
    lastAnnotatedLatex = normalizedCandidate.normalizedLatex.annotatedLatex;
    lastSavedLinkUpdateCount = normalizedCandidate.updatedCount;
    lastSavedLinkUpdates = normalizedCandidate.updatedLinks;

    if (validation.ok) {
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: 1,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: [],
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: input.planningResult.thesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      1,
    );

    return {
      annotatedLatexCode: lastAnnotatedLatex,
      attempts: 1,
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      edits: [],
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: fallbackMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
      model: lastModel,
      openAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate,
        hasPreviewPdf: false,
      }),
      planningResult: input.planningResult,
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: lastSavedLinkUpdateCount,
      savedLinkUpdates: lastSavedLinkUpdates,
      thesis: input.planningResult.thesis,
      validationError: lastError,
    };
  }

  const client = getOpenAIClient();
  let implementationFeedback = "";
  const maxTailoredResumeAttempts = getRetryAttemptsToGenerateLatexEdits();

  for (let attempt = 1; attempt <= maxTailoredResumeAttempts; attempt += 1) {
    const stepTimeout = createTailorResumeStepTimeout({
      startedAt: Date.now(),
      stepLabel: "Step 4 implementation",
    });
    const implementationInput = buildTailoringImplementationInput({
      jobDescription: input.jobDescription,
      plan: input.planningResult,
      planningBlocksById,
      userMarkdown: input.userMarkdown,
    });
    const implementationInstructions = buildTailoringImplementationInstructions({
      feedback: implementationFeedback,
      promptSettings: input.promptSettings,
    });
    implementationPrompt = serializeTailoredResumePrompt({
      inputMessages: implementationInput,
      instructions: implementationInstructions,
    });
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail:
        attempt === 1
          ? "Starting block-scoped LaTeX generation from the accepted plan."
          : "Retrying block-scoped LaTeX generation after the previous attempt failed.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt > 1,
      status: "running",
      stepNumber: 4,
      summary: "Generating block-scoped edits",
    });
    let response: TailoredResumeResponse;

    try {
      let previousResponseId: string | undefined;
      let responseInput: TailorResumeStepResponseInput = implementationInput;
      let finalResponse: TailoredResumeResponse | null = null;
      let keywordCheckCalled = false;

      for (
        let toolRound = 1;
        toolRound <= maxTailorResumeImplementationToolCallsPerAttempt;
        toolRound += 1
      ) {
        const roundResponse = (await runTailorResumeStepModelRequest({
          attempt,
          onStepEvent: input.onStepEvent,
          operation: (signal) =>
            client.responses.create({
              input: responseInput,
              instructions: implementationInstructions,
              max_output_tokens: tailorResumeImplementationMaxOutputTokens,
              model,
              parallel_tool_calls: false,
              previous_response_id: previousResponseId,
              tool_choice: keywordCheckCalled
                ? "auto"
                : {
                    name: tailorResumeImplementationKeywordCheckToolName,
                    type: "function",
                  },
              tools: [
                tailorResumeImplementationKeywordCheckTool,
                tailorResumeKeywordUsageTool,
                tailorResumeMalformedBulletsTool,
                tailorResumeSingleSkillQueryTool,
                tailorResumeBatchSkillQueryTool,
              ],
              text: {
                verbosity: "low",
                format: {
                  type: "json_schema",
                  name: "tailor_resume_latex_implementation",
                  strict: true,
                  schema: tailorResumeImplementationSchema,
                },
              },
            }, { signal }),
          readDurationMs: () => Math.max(0, Date.now() - startedAt),
          stepLabel: "Step 4 implementation",
          stepNumber: 4,
          summary: "Generating block-scoped edits",
        })) as TailoredResumeResponse;

        previousResponseId = roundResponse.id;
        const keywordCheckToolCall =
          findImplementationKeywordCheckToolCall(roundResponse);
        const inspectionToolCall = findInspectionToolCall(roundResponse);

        if (inspectionToolCall) {
          let inspectionToolOutput: string | null = null;
          try {
            try {
              const inspectionArguments = JSON.parse(inspectionToolCall.arguments);

              if (inspectionToolCall.name === tailorResumeSingleSkillQueryToolName) {
                inspectionToolOutput =
                  buildTailorResumeSingleSkillQueryToolOutput({
                    ...parseTailorResumeSingleSkillQuery(inspectionArguments),
                    skillData: input.skillData,
                  });
              } else if (
                inspectionToolCall.name === tailorResumeBatchSkillQueryToolName
              ) {
                inspectionToolOutput =
                  buildTailorResumeBatchSkillQueryToolOutput({
                    queries: parseTailorResumeBatchSkillQuery(inspectionArguments),
                    skillData: input.skillData,
                  });
              } else {
                const inspectionPayload =
                  parseResumeInspectionPayload(inspectionArguments);
                const candidateAnnotatedLatex = applyInspectionChanges({
                  annotatedLatexCode: normalizedInput.annotatedLatex,
                  changes: inspectionPayload.changes,
                  plannedChanges: input.planningResult.changes,
                });
                inspectionToolOutput =
                  inspectionToolCall.name === tailorResumeKeywordUsageToolName
                    ? buildResumeKeywordUsageToolOutput({
                        annotatedLatexCode: candidateAnnotatedLatex,
                        emphasizedTechnologies: implementationRequiredTechnologies,
                      })
                    : await buildResumeMalformedBulletsToolOutput({
                        annotatedLatexCode: candidateAnnotatedLatex,
                        changedSegmentIds: new Set(
                          inspectionPayload.changes.map(
                            (change) => change.segmentId,
                          ),
                        ),
                      });
              }
            } catch (error) {
              inspectionToolOutput = buildImplementationToolRepairOutput({
                error:
                  error instanceof Error
                    ? error.message
                    : "The inspection tool call was invalid.",
                plannedChanges: input.planningResult.changes,
              });
            }
            responseInput = [
              {
                call_id: inspectionToolCall.call_id,
                output: inspectionToolOutput,
                type: "function_call_output" as const,
              },
            ];
          } finally {
            implementationToolCalls.push(
              buildTailorResumeDebugToolCall({
                id: inspectionToolCall.call_id,
                input: inspectionToolCall.arguments,
                output: inspectionToolOutput,
                toolName: inspectionToolCall.name,
              }),
            );
          }
          continue;
        }

        if (!keywordCheckToolCall) {
          if (!keywordCheckCalled) {
            responseInput = buildRequiredKeywordCheckToolReminderInput({
              finalResponse: roundResponse,
              stageName: "Step 4 implementation",
              toolName: tailorResumeImplementationKeywordCheckToolName,
            });
            continue;
          }

          finalResponse = roundResponse;
          break;
        }

        keywordCheckCalled = true;
        let implementationCheckToolOutput: string | null = null;
        try {
          try {
            const implementationCheckPayload =
              parseKeywordCheckImplementationPayload(
                JSON.parse(keywordCheckToolCall.arguments),
              );
            const candidateBlockChanges = buildTailoredResumeBlockChanges({
              implementationChanges: implementationCheckPayload.changes.map(
                (change) => ({
                  latexCode: change.latexCode,
                  segmentId: change.segmentId,
                }),
              ),
              plannedChanges: input.planningResult.changes,
            });
            const candidateAnnotatedLatex = applyTailorResumeBlockChanges({
              annotatedLatexCode: normalizedInput.annotatedLatex,
              changes: candidateBlockChanges,
            }).annotatedLatex;
            const keywordCheckResult = buildTailorResumeKeywordCheckResult({
              emphasizedTechnologies: implementationRequiredTechnologies,
              text: renderTailoredResumeLatexToPlainText(candidateAnnotatedLatex),
            });
            implementationCheckToolOutput = await buildImplementationCheckToolOutput({
              changedSegmentIds: new Set(
                candidateBlockChanges.map((change) => change.segmentId),
              ),
              keywordCheckResult,
              renderedAnnotatedLatexCode: candidateAnnotatedLatex,
              requestedLineCountSegmentIds: new Set(
                implementationCheckPayload.lineCountSegmentIds,
              ),
            });
          } catch (error) {
            implementationCheckToolOutput = buildImplementationToolRepairOutput({
              error:
                error instanceof Error
                  ? error.message
                  : "The keyword-check tool call was invalid.",
              plannedChanges: input.planningResult.changes,
            });
          }
          responseInput = [
            {
              call_id: keywordCheckToolCall.call_id,
              output: implementationCheckToolOutput,
              type: "function_call_output" as const,
            },
          ];
        } finally {
          implementationToolCalls.push(
            buildTailorResumeDebugToolCall({
              id: keywordCheckToolCall.call_id,
              input: keywordCheckToolCall.arguments,
              output: implementationCheckToolOutput,
              toolName: keywordCheckToolCall.name,
            }),
          );
        }
      }

      if (!finalResponse) {
        throw new Error(
          keywordCheckCalled
            ? "The model did not return a final implementation response after the keyword check."
            : "The model did not return a final implementation response.",
        );
      }

      response = finalResponse;
    } catch (error) {
      completedImplementationAttempts = attempt;
      lastError = isTransientModelError(error)
        ? formatTransientModelError(error)
        : error instanceof Error
          ? error.message
          : "The implementation pass failed before a valid response was produced.";
      const timedOut = isTailorResumeStepTimeoutError(error);
      implementationSkippedReason = null;
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: !timedOut && attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous implementation attempt failed before producing a valid final block-scoped response.\n\nExact issue:\n${lastError}\n\nCall ${tailorResumeImplementationKeywordCheckToolName} before returning the final strict JSON object with one LaTeX replacement per planned segment.`;

      if (!timedOut && attempt < maxTailoredResumeAttempts) {
        continue;
      }

      break;
    }

    completedImplementationAttempts = attempt;
    lastModel = response.model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty LaTeX implementation.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        "The previous response was empty. Return the strict JSON object with one LaTeX replacement per planned segment.";
      continue;
    }

    let implementation: TailoredResumeImplementationResponse;

    try {
      implementation = parseTailoredResumeImplementationResponse(
        JSON.parse(outputText),
      );
      implementation = {
        changes: applyTailorResumeUserMarkdownBoldFormatting({
          emphasizedTechnologies: implementationRequiredTechnologies,
          implementationChanges: implementation.changes,
          userMarkdown: input.userMarkdown,
        }),
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable LaTeX implementation.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous implementation response could not be parsed.\n\nExact issue:\n${lastError}\n\nReturn the strict JSON object with one LaTeX replacement per planned segment.`;
      continue;
    }

    implementationOutputJson = outputText;
    const openAiDebug: TailoredResumeOpenAiDebugTrace = {
      implementation: {
        outputJson: implementationOutputJson,
        prompt: implementationPrompt,
        skippedReason: null,
        systemPrompt: implementationInstructions,
        ...(implementationToolCalls.length > 0
          ? { toolCalls: [...implementationToolCalls] }
          : {}),
      },
      ...(input.keywordExtractionDebug
        ? { keywordExtraction: input.keywordExtractionDebug }
        : {}),
      ...(input.keywordReviewDebug
        ? { keywordReview: input.keywordReviewDebug }
        : {}),
      planning: input.planningDebug,
    };
    const candidateForLogging: TailoredResumeStructuredResponse = {
      changes: implementation.changes.map((change) => ({
        latexCode: change.latexCode,
        reason:
          input.planningResult.changes.find(
            (plannedChange) => plannedChange.segmentId === change.segmentId,
          )?.reason ?? "[missing reason]",
        segmentId: change.segmentId,
      })),
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      jobIdentifier: fallbackMetadata.jobIdentifier,
      positionTitle: fallbackMetadata.positionTitle,
      thesis: input.planningResult.thesis,
    };

    let candidateChanges: TailoredResumeBlockChange[];
    let candidateEdits: TailoredResumeBlockEditRecord[];
    let appliedCandidate;

    try {
      candidateChanges = buildTailoredResumeBlockChanges({
        implementationChanges: implementation.changes,
        plannedChanges: input.planningResult.changes,
      });
      validateTailoredResumeImplementationIncludesQuestioningLearnings({
        implementationChanges: candidateChanges,
        plan: input.planningResult,
      });
      appliedCandidate = applyTailorResumeBlockChanges({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidateChanges,
      });
      validateTailoredResumeImplementationKeywordCoverage({
        keywordCheckResult: buildTailorResumeKeywordCheckResult({
          emphasizedTechnologies: implementationRequiredTechnologies,
          text: renderTailoredResumeLatexToPlainText(appliedCandidate.annotatedLatex),
        }),
      });
      stepTimeout.assertNotTimedOut();
      const candidateLayout = await measureTailorResumeLayout({
        annotatedLatexCode: appliedCandidate.annotatedLatex,
      });
      const renderedBulletHealth = buildTailorResumeRenderedBulletHealthCheck({
        changedSegmentIds: new Set(
          candidateChanges.map((change) => change.segmentId),
        ),
        layout: candidateLayout,
      });
      const malformedBulletError =
        formatTailorResumeChangedMalformedBulletError(renderedBulletHealth);

      if (malformedBulletError) {
        throw new Error(malformedBulletError);
      }

      candidateEdits = buildTailoredResumeBlockEdits({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidateChanges,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to apply the requested block replacements.";
      const timedOut = isTailorResumeStepTimeoutError(error);
      await input.onInvalidReplacement?.(
        buildInvalidTailorResumeReplacementLogPayload({
          annotatedLatexCode: normalizedInput.annotatedLatex,
          candidate: candidateForLogging,
          error: lastError,
          modelDebug: openAiDebug.implementation,
        }),
        lastError,
        attempt,
      );
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: !timedOut && attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous LaTeX implementation did not satisfy the block replacement requirements.\n\nExact issue:\n${lastError}\n\nReturn a corrected strict JSON object with one LaTeX replacement per planned segment.`;
      if (!timedOut && attempt < maxTailoredResumeAttempts) {
        continue;
      }

      break;
    }

    const normalizedCandidate = applySavedTailoredResumeLinks(
      appliedCandidate.annotatedLatex,
      linkOverrides,
    );
    hasAppliedCandidate = true;
    let validation: Awaited<ReturnType<typeof validateTailorResumeLatexDocument>>;

    try {
      stepTimeout.assertNotTimedOut();
      validation = await validateTailorResumeLatexDocument(
        stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
      );
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to validate the generated LaTeX implementation.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying:
          !isTailorResumeStepTimeoutError(error) &&
          attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });

      if (
        !isTailorResumeStepTimeoutError(error) &&
        attempt < maxTailoredResumeAttempts
      ) {
        implementationFeedback =
          `Validating your previous LaTeX implementations failed.\n\n` +
          `Exact issue:\n${lastError}\n\n` +
          "Return corrected LaTeX replacements for the same planned segments only.";
        continue;
      }

      break;
    }

    lastAnnotatedLatex = normalizedCandidate.normalizedLatex.annotatedLatex;
    lastEdits = candidateEdits;
    lastSavedLinkUpdateCount = normalizedCandidate.updatedCount;
    lastSavedLinkUpdates = normalizedCandidate.updatedLinks;

    if (validation.ok) {
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: `Generated ${candidateEdits.length} block edit${candidateEdits.length === 1 ? "" : "s"}.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: false,
        status: "succeeded",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: attempt,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: candidateEdits,
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: input.planningResult.thesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      attempt,
    );
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail: validation.error,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt < maxTailoredResumeAttempts,
      status: "failed",
      stepNumber: 4,
      summary: "Generating block-scoped edits",
    });

    implementationFeedback =
      `Applying your previous LaTeX implementations produced a compile failure.\n\n` +
      `Compiler error:\n${validation.error}\n\n` +
      "Return corrected LaTeX replacements for the same planned segments only.";

    if (attempt === maxTailoredResumeAttempts) {
      return {
        annotatedLatexCode: lastAnnotatedLatex,
        attempts: completedImplementationAttempts,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: lastEdits,
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate,
          hasPreviewPdf: false,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: null,
        savedLinkUpdateCount: lastSavedLinkUpdateCount,
        savedLinkUpdates: lastSavedLinkUpdates,
        thesis: input.planningResult.thesis,
        validationError:
          lastError ??
          `Unable to implement a tailored resume after ${completedImplementationAttempts} attempts.`,
      };
    }
  }

  const openAiDebug: TailoredResumeOpenAiDebugTrace = {
    implementation: {
      outputJson: implementationOutputJson,
      prompt: implementationPrompt,
      skippedReason: implementationSkippedReason,
      systemPrompt: buildTailoringImplementationInstructions({
        feedback: implementationFeedback,
        promptSettings: input.promptSettings,
      }),
      ...(implementationToolCalls.length > 0
        ? { toolCalls: [...implementationToolCalls] }
        : {}),
    },
    ...(input.keywordExtractionDebug
      ? { keywordExtraction: input.keywordExtractionDebug }
      : {}),
    ...(input.keywordReviewDebug
      ? { keywordReview: input.keywordReviewDebug }
      : {}),
    planning: input.planningDebug,
  };

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: completedImplementationAttempts || maxTailoredResumeAttempts,
    companyName: fallbackMetadata.companyName,
    displayName: fallbackMetadata.displayName,
    edits: lastEdits,
    generationDurationMs: readGenerationDurationMs(),
    jobIdentifier: fallbackMetadata.jobIdentifier,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model: lastModel,
    openAiDebug,
    outcome: classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate,
      hasPreviewPdf: false,
    }),
    planningResult: input.planningResult,
    positionTitle: fallbackMetadata.positionTitle,
    previewPdf: null,
    savedLinkUpdateCount: lastSavedLinkUpdateCount,
    savedLinkUpdates: lastSavedLinkUpdates,
    thesis: input.planningResult.thesis,
    validationError:
      lastError ??
      `Unable to implement a tailored resume after ${completedImplementationAttempts || maxTailoredResumeAttempts} attempts.`,
  };
}

export async function generateTailoredResume(input: {
  annotatedLatexCode: string;
  companyName?: string | null;
  jobDescription: string;
  linkOverrides?: TailorResumeLinkRecord[];
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  promptSettings?: SystemPromptSettings;
  skillData?: TailorResumeStoredSkillData | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const fallbackMetadata = normalizeTailoredResumeMetadata({});
  const fallbackPlanningResult = buildFallbackTailoredResumePlanningResult();
  const fallbackOpenAiDebug = buildFallbackTailoredResumeOpenAiDebug();
  const readGenerationDurationMs = () => Math.max(0, Date.now() - startedAt);

  if (isTestOpenAIResponseEnabled()) {
    const finalizedTestCandidate = applySavedTailoredResumeLinks(
      normalizedInput.annotatedLatex,
      linkOverrides,
    );
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(finalizedTestCandidate.normalizedLatex.annotatedLatex),
    );

    return {
      annotatedLatexCode: finalizedTestCandidate.normalizedLatex.annotatedLatex,
      attempts: 1,
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      edits: [],
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: fallbackMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(
        finalizedTestCandidate.normalizedLatex.annotatedLatex,
      ),
      model: TEST_OPENAI_RESPONSE_MODEL,
      openAiDebug: fallbackOpenAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: true,
        hasPreviewPdf: validation.ok,
      }),
      planningResult: fallbackPlanningResult,
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: validation.ok ? validation.previewPdf : null,
      savedLinkUpdateCount: finalizedTestCandidate.updatedCount,
      savedLinkUpdates: finalizedTestCandidate.updatedLinks,
      thesis: fallbackPlanningResult.thesis,
      validationError: validation.ok ? null : validation.error,
    };
  }

  const keywordStage = await extractTailorResumeEmphasizedTechnologiesForQuestioning({
    employerName: input.companyName,
    jobDescription: input.jobDescription,
    nonTechnologies: input.userMarkdown?.nonTechnologies,
    onStepEvent: input.onStepEvent,
  });
  const planningStage = await planTailoredResume({
    annotatedLatexCode: input.annotatedLatexCode,
    employerName: input.companyName,
    jobDescription: input.jobDescription,
    onStepEvent: input.onStepEvent,
    precomputedEmphasizedTechnologies: keywordStage.emphasizedTechnologies,
    promptSettings: input.promptSettings,
    skillData: input.skillData,
    userMarkdown: input.userMarkdown,
  });

  if (!planningStage.ok) {
    const lastMetadata = normalizeTailoredResumeMetadata(
      planningStage.planningResult,
    );

    return {
      annotatedLatexCode: normalizedInput.annotatedLatex,
      attempts: planningStage.attempts,
      companyName: lastMetadata.companyName,
      displayName: lastMetadata.displayName,
      edits: [],
      generationDurationMs:
        keywordStage.generationDurationMs + planningStage.generationDurationMs,
      jobIdentifier: lastMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(normalizedInput.annotatedLatex),
      model: planningStage.model,
      openAiDebug: {
        implementation: fallbackOpenAiDebug.implementation,
        keywordExtraction: keywordStage.extractionDebug,
        keywordReview: buildTailorResumeKeywordReviewDebugStage({
          conversation: [],
          promptSettings: input.promptSettings,
          questioningSummary: planningStage.planningResult.questioningSummary,
        }),
        planning: planningStage.planningDebug,
      },
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: false,
        hasPreviewPdf: false,
      }),
      planningResult: planningStage.planningResult,
      positionTitle: lastMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: 0,
      savedLinkUpdates: [],
      thesis: planningStage.thesis,
      validationError: planningStage.validationError,
    };
  }

  return implementTailoredResumePlan({
    annotatedLatexCode: input.annotatedLatexCode,
    generationDurationMsBase:
      keywordStage.generationDurationMs + planningStage.generationDurationMs,
    jobDescription: input.jobDescription,
    keywordExtractionDebug: keywordStage.extractionDebug,
    keywordReviewDebug: buildTailorResumeKeywordReviewDebugStage({
      conversation: [],
      promptSettings: input.promptSettings,
      questioningSummary: planningStage.planningResult.questioningSummary,
    }),
    linkOverrides,
    onBuildFailure: input.onBuildFailure,
    onInvalidReplacement: input.onInvalidReplacement,
    onStepEvent: input.onStepEvent,
    planningDebug: planningStage.planningDebug,
    planningResult: planningStage.planningResult,
    planningSnapshot: planningStage.planningSnapshot,
    promptSettings: input.promptSettings,
    skillData: input.skillData,
    userMarkdown: input.userMarkdown,
  });
}
