import OpenAI from "openai";
import {
  buildTailorResumeInterviewSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import {
  TailorResumeInterviewArgsStreamer,
  type TailorResumeInterviewStreamEvent,
} from "./tailor-resume-interview-stream-parser.ts";

export type { TailorResumeInterviewStreamEvent } from "./tailor-resume-interview-stream-parser.ts";
import type {
  TailorResumeKeywordDecision,
  TailorResumeConversationToolCall,
  TailorResumeConversationMessage,
  TailorResumeGenerationStepEvent,
  TailorResumeInterviewDebugDecision,
  TailorResumeTechnologyContext,
  TailoredResumeEmphasizedTechnology,
  TailoredResumePlanningResult,
  TailoredResumeQuestionLearning,
  TailoredResumeQuestioningSummary,
} from "./tailor-resume-types.ts";
import type {
  TailorResumePlanningBlock,
  TailorResumePlanningSnapshot,
} from "./tailor-resume-planning.ts";
import {
  buildTailorResumeKeywordPresenceContext,
  type TailorResumeKeywordPresenceContext,
  type TailorResumeKeywordPresenceContextTerm,
} from "./tailor-resume-keyword-coverage.ts";
import {
  formatTailorResumeTermWithCapitalFirst,
  normalizeTailorResumeNonTechnologyTerms,
} from "./tailor-resume-non-technologies.ts";
import { runWithTransientModelRetries } from "./tailor-resume-transient-retry.ts";
import {
  applyTailorResumeUserMarkdownPatch,
  defaultTailorResumeUserMarkdown,
  type TailorResumeUserMarkdownPatchOperation,
  type TailorResumeUserMarkdownPatchResult,
  type TailorResumeUserMarkdownState,
} from "./tailor-resume-user-memory.ts";

const tailorResumeInterviewLearningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detail: { type: "string" },
    targetSegmentIds: {
      type: "array",
      items: { type: "string" },
    },
    topic: { type: "string" },
  },
  required: ["topic", "detail", "targetSegmentIds"],
} as const;

const tailorResumeUserMarkdownEditOperationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    anchorMarkdown: { type: "string" },
    headingPath: {
      type: "array",
      items: { type: "string" },
    },
    markdown: { type: "string" },
    newMarkdown: { type: "string" },
    oldMarkdown: { type: "string" },
    op: {
      type: "string",
      enum: [
        "append",
        "delete_exact",
        "insert_after",
        "insert_before",
        "replace_exact",
      ],
    },
  },
  required: [
    "anchorMarkdown",
    "headingPath",
    "markdown",
    "newMarkdown",
    "oldMarkdown",
    "op",
  ],
} as const;

const tailorResumeKeywordDecisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["keep", "remove"],
    },
    name: {
      type: "string",
      description: "The exact emphasized keyword this decision applies to.",
    },
    reason: {
      type: "string",
      description:
        "A brief explanation, especially when removing a bad or nonsensical keyword after the user rejects it.",
    },
  },
  required: ["name", "action", "reason"],
} as const;

const tailorResumeNonTechnologyTermsSchema = {
  type: "array",
  description:
    "Terms the user has rejected as not real technologies or not resume-searchable skills. Use exact emphasized keyword names from the current chat; the app stores them case-insensitively and removes them from future keyword scraping.",
  items: { type: "string" },
} as const;

const initiateTailorResumeProbingQuestionsToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistantMessage: {
      type: "string",
      description:
        "The compact user-facing chat message. Ask concise technology-experience questions directly in text.",
    },
  },
  required: ["assistantMessage"],
} as const;

const finishTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    completionMessage: {
      type: "string",
      description:
        "A short status shown while the app saves memory and immediately continues tailoring. Do not ask for confirmation.",
    },
    learnings: {
      type: "array",
      items: tailorResumeInterviewLearningSchema,
    },
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: ["completionMessage", "learnings", "userMarkdownEditOperations"],
} as const;

const skipTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: { type: "string" },
  },
  required: ["reason"],
} as const;

const updateTailorResumeNonTechnologiesToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    completionMessage: {
      type: "string",
      description:
        "A concise status saying the rejected terms were added to the non-technology list before the app immediately continues tailoring.",
    },
    keywordDecisions: {
      type: "array",
      items: tailorResumeKeywordDecisionSchema,
    },
    nonTechnologyTerms: tailorResumeNonTechnologyTermsSchema,
  },
  required: ["completionMessage", "keywordDecisions", "nonTechnologyTerms"],
} as const;

const tailorResumeInterviewTools: OpenAI.Responses.Tool[] = [
  {
    name: "initiate_tailor_resume_probing_questions",
    parameters: initiateTailorResumeProbingQuestionsToolParameters,
    strict: true,
    type: "function",
  },
  {
    name: "finish_tailor_resume_interview",
    parameters: finishTailorResumeInterviewToolParameters,
    strict: true,
    type: "function",
  },
  {
    name: "skip_tailor_resume_interview",
    parameters: skipTailorResumeInterviewToolParameters,
    strict: true,
    type: "function",
  },
  {
    name: "update_tailor_resume_non_technologies",
    parameters: updateTailorResumeNonTechnologiesToolParameters,
    strict: true,
    type: "function",
  },
];

type TailorResumeInterviewResponse = {
  action: "ask" | "done" | "skip";
  assistantMessage: string;
  completionMessage: string;
  debugDecision: TailorResumeInterviewDebugDecision;
  keywordDecisions: TailorResumeKeywordDecision[];
  learnings: TailoredResumeQuestionLearning[];
  nonTechnologyTerms: string[];
  technologyContexts: TailorResumeTechnologyContext[];
  userMarkdownEditOperations: TailorResumeUserMarkdownPatchOperation[];
};

export function normalizeTailorResumeInterviewResponseForCurrentTurn(input: {
  conversation?: TailorResumeConversationMessage[];
  emphasizedTechnologyNames?: string[];
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}): TailorResumeInterviewResponse {
  const conversation = input.conversation ?? [];
  const response = {
    ...input.response,
    keywordDecisions: [...(input.response.keywordDecisions ?? [])],
    learnings: [...(input.response.learnings ?? [])],
    nonTechnologyTerms: [...(input.response.nonTechnologyTerms ?? [])],
    technologyContexts: [...(input.response.technologyContexts ?? [])],
    userMarkdownEditOperations: [
      ...(input.response.userMarkdownEditOperations ?? []),
    ],
  };

  if (response.action === "ask" && response.technologyContexts.length > 0) {
    response.technologyContexts = [];
  }

  if (
    input.previousSummary &&
    response.action === "ask" &&
    shouldTreatFollowUpAskAsFinish({
      conversation,
      emphasizedTechnologyNames: input.emphasizedTechnologyNames ?? [],
      response,
    })
  ) {
    return {
      ...response,
      action: "done",
      assistantMessage: "",
      completionMessage:
        response.assistantMessage ||
        "Thanks, I have enough context and will continue tailoring now.",
      technologyContexts: [],
    };
  }

  if (response.action === "ask") {
    response.keywordDecisions = [];
    response.learnings = [];
    response.nonTechnologyTerms = [];
    response.userMarkdownEditOperations = [];
  }

  if (response.action === "skip") {
    response.keywordDecisions = [];
    response.learnings = [];
    response.nonTechnologyTerms = [];
    response.technologyContexts = [];
    response.userMarkdownEditOperations = [];
  }

  return response;
}

export type AdvanceTailorResumeQuestioningResult =
  | {
      action: "ask";
      assistantMessage: string;
      generationDurationMs: number;
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
      nonTechnologyTerms: string[];
      questioningSummary: TailoredResumeQuestioningSummary;
      technologyContexts: TailorResumeTechnologyContext[];
      toolCalls: TailorResumeConversationToolCall[];
      userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null;
    }
  | {
      action: "done";
      completionMessage: string;
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
      generationDurationMs: number;
      nonTechnologyTerms: string[];
      questioningSummary: TailoredResumeQuestioningSummary | null;
      toolCalls: TailorResumeConversationToolCall[];
      userMarkdownEditOperations: TailorResumeUserMarkdownPatchOperation[];
      userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null;
    }
  | {
      action: "skip";
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
      generationDurationMs: number;
      nonTechnologyTerms: string[];
      questioningSummary: TailoredResumeQuestioningSummary | null;
      userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null;
    };

type TailoredResumeResponse = {
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
  output_text?: string;
};

type TailoredResumeFunctionToolCall = {
  arguments: string;
  callId: string | null;
  name: string;
};

type ParsedTailorResumeInterviewModelOutput = {
  response: TailorResumeInterviewResponse;
  toolCalls: TailorResumeConversationToolCall[];
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function modelSupportsReasoningEffort(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return (
    normalizedModel.startsWith("gpt-5") ||
    /^o[134](?:-|$)/.test(normalizedModel)
  );
}

function resolveTailorResumeInterviewReasoning(model: string) {
  const rawEffort =
    process.env.OPENAI_TAILOR_RESUME_INTERVIEW_REASONING_EFFORT?.trim() ||
    "minimal";
  const effort = rawEffort.toLowerCase();
  const supportedEfforts = new Set([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);

  if (!modelSupportsReasoningEffort(model) || effort === "default") {
    return null;
  }

  return supportedEfforts.has(effort)
    ? {
        effort: effort as "minimal" | "low" | "medium" | "high" | "xhigh",
      }
    : { effort: "minimal" as const };
}

function buildLowVerbosityTextConfig(model: string) {
  return model.trim().toLowerCase().startsWith("gpt-5")
    ? {
        text: {
          verbosity: "low" as const,
        },
      }
    : {};
}

function readOutputText(response: TailoredResumeResponse) {
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

function readFunctionToolCalls(
  response: TailoredResumeResponse,
): TailoredResumeFunctionToolCall[] {
  return (response.output ?? []).flatMap((outputItem) => {
    if (outputItem.type !== "function_call") {
      return [];
    }

    const name = typeof outputItem.name === "string" ? outputItem.name : "";
    const args =
      typeof outputItem.arguments === "string" ? outputItem.arguments : "";

    if (!name || !args) {
      return [];
    }

    return [{
      arguments: args,
      callId: typeof outputItem.call_id === "string" ? outputItem.call_id : null,
      name,
    }];
  });
}

function serializeTailorResumeConversationToolCall(
  toolCall: TailoredResumeFunctionToolCall,
): TailorResumeConversationToolCall {
  return {
    argumentsText: toolCall.arguments,
    name: toolCall.name,
    outputText: "",
  };
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readRecordString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return "";
  }

  return readTrimmedString(value[key as keyof typeof value]);
}

export function isDebugForceConversationInTailorPipelineEnabled() {
  const value =
    process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE
      ?.trim()
      .toLowerCase() ?? "";

  return value === "true" || value === "1" || value === "yes";
}

function readTailoredResumeQuestionLearning(
  value: unknown,
): TailoredResumeQuestionLearning | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const topic = "topic" in value ? readTrimmedString(value.topic) : "";
  const detail = "detail" in value ? readTrimmedString(value.detail) : "";
  const rawTargetSegmentIds =
    "targetSegmentIds" in value ? value.targetSegmentIds : null;

  if (!topic || !detail || !Array.isArray(rawTargetSegmentIds)) {
    return null;
  }

  const targetSegmentIds = rawTargetSegmentIds
    .map((segmentId) => readTrimmedString(segmentId))
    .filter(Boolean);

  return {
    detail,
    targetSegmentIds,
    topic,
  };
}

function isNonQuestionAskMessage(message: string) {
  return (
    /\bno\s+(?:follow[- ]?up\s+)?questions?\s+(?:needed|required|necessary)\b/i.test(
      message,
    ) ||
    /\b(?:i['’]?ll|i will)\s+proceed\b/i.test(message) ||
    /\bproceed(?:ing)?\s+to\s+tailor/i.test(message)
  );
}

function parseTailorResumeUserMarkdownEditOperations(
  value: unknown,
): TailorResumeUserMarkdownPatchOperation[] {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const op = "op" in entry ? entry.op : null;

    if (
      op !== "append" &&
      op !== "delete_exact" &&
      op !== "insert_after" &&
      op !== "insert_before" &&
      op !== "replace_exact"
    ) {
      return [];
    }

    const headingPath =
      "headingPath" in entry && Array.isArray(entry.headingPath)
        ? entry.headingPath
            .map((heading: unknown) => readTrimmedString(heading))
            .filter(Boolean)
        : [];

    return [{
      anchorMarkdown:
        "anchorMarkdown" in entry && typeof entry.anchorMarkdown === "string"
          ? entry.anchorMarkdown
          : "",
      headingPath,
      markdown:
        "markdown" in entry && typeof entry.markdown === "string"
          ? entry.markdown
          : "",
      newMarkdown:
        "newMarkdown" in entry && typeof entry.newMarkdown === "string"
          ? entry.newMarkdown
          : "",
      oldMarkdown:
        "oldMarkdown" in entry && typeof entry.oldMarkdown === "string"
          ? entry.oldMarkdown
          : "",
      op,
    }];
  });
}

function parseTailorResumeKeywordDecisions(
  value: unknown,
): TailorResumeKeywordDecision[] {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const name = "name" in entry ? readTrimmedString(entry.name) : "";
    const action =
      "action" in entry && (entry.action === "keep" || entry.action === "remove")
        ? entry.action
        : null;
    const reason = "reason" in entry ? readTrimmedString(entry.reason) : "";

    if (!name || !action || !reason) {
      return [];
    }

    return [{
      action,
      name,
      reason,
    }];
  });
}

function parseTailorResumeNonTechnologyTerms(value: unknown) {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeTailorResumeNonTechnologyTerms(
    value.filter((term): term is string => typeof term === "string"),
  );
}

function parseTailorResumeInterviewResponse(
  value: unknown,
  outputText: string,
): TailorResumeInterviewResponse {
  const fallbackAskMessage =
    outputText.trim() || "What else should I know before tailoring this resume?";

  if (!value || typeof value !== "object") {
    return {
      action: "ask",
      assistantMessage: fallbackAskMessage,
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts: [],
      userMarkdownEditOperations: [],
    };
  }

  const action =
    "action" in value &&
    (value.action === "ask" || value.action === "done" || value.action === "skip")
      ? value.action
      : "ask";
  const debugDecision =
    "debugDecision" in value &&
    (value.debugDecision === "forced_only" ||
      value.debugDecision === "not_applicable" ||
      value.debugDecision === "would_ask_without_debug")
      ? value.debugDecision
      : "not_applicable";
  const rawLearnings = "learnings" in value ? value.learnings : null;
  const keywordDecisions = parseTailorResumeKeywordDecisions(
    "keywordDecisions" in value ? value.keywordDecisions : undefined,
  );
  const nonTechnologyTerms = parseTailorResumeNonTechnologyTerms(
    "nonTechnologyTerms" in value ? value.nonTechnologyTerms : undefined,
  );
  const userMarkdownEditOperations = parseTailorResumeUserMarkdownEditOperations(
    "userMarkdownEditOperations" in value
      ? value.userMarkdownEditOperations
      : undefined,
  );

  const parsedResponse: TailorResumeInterviewResponse = {
    action,
    assistantMessage:
      action === "ask"
        ? readRecordString(value, "assistantMessage") || fallbackAskMessage
        : "",
    completionMessage:
      action === "done"
        ? readRecordString(value, "completionMessage") ||
          outputText ||
          "Thanks, I have enough context and will continue tailoring now."
        : "",
    debugDecision,
    keywordDecisions,
    learnings: Array.isArray(rawLearnings)
      ? rawLearnings.flatMap((learning) => {
          const parsedLearning = readTailoredResumeQuestionLearning(learning);

          return parsedLearning ? [parsedLearning] : [];
        })
      : [],
    nonTechnologyTerms,
    technologyContexts: [],
    userMarkdownEditOperations,
  };

  return parsedResponse;
}

function tryParseToolCallArguments(
  toolCall: TailoredResumeFunctionToolCall | null | undefined,
) {
  if (!toolCall) {
    return null;
  }

  try {
    return JSON.parse(toolCall.arguments) as unknown;
  } catch {
    return null;
  }
}

function tryParseJsonObject(value: string) {
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseTailorResumeInterviewResponseFromModelOutput(
  response: TailoredResumeResponse,
): ParsedTailorResumeInterviewModelOutput {
  const toolCalls = readFunctionToolCalls(response);
  const outputText = readOutputText(response);
  const knownToolNames = new Set([
    "initiate_tailor_resume_probing_questions",
    "finish_tailor_resume_interview",
    "skip_tailor_resume_interview",
    "update_tailor_resume_non_technologies",
  ]);
  const toolCall =
    toolCalls.find((candidate) => knownToolNames.has(candidate.name)) ?? null;
  const outputJson = tryParseJsonObject(outputText);
  const argumentsJson = tryParseToolCallArguments(toolCall) ?? outputJson;
  const visibleOutputText = outputJson ? "" : outputText;
  const conversationToolCalls = toolCall
    ? [serializeTailorResumeConversationToolCall(toolCall)]
    : [];

  if (!toolCall) {
    return {
      response: parseTailorResumeInterviewResponse(
        {
          ...(argumentsJson && typeof argumentsJson === "object"
            ? argumentsJson
            : {}),
          action:
            argumentsJson &&
            typeof argumentsJson === "object" &&
            "action" in argumentsJson
              ? argumentsJson.action
              : "ask",
          debugDecision: "not_applicable",
        },
        visibleOutputText,
      ),
      toolCalls: conversationToolCalls,
    };
  }

  if (toolCall.name === "initiate_tailor_resume_probing_questions") {
    return {
      response: parseTailorResumeInterviewResponse({
        ...(argumentsJson && typeof argumentsJson === "object"
          ? argumentsJson
          : {}),
        action: "ask",
        debugDecision: "not_applicable",
        keywordDecisions: [],
        learnings: [],
        nonTechnologyTerms: [],
        userMarkdownEditOperations: [],
      }, visibleOutputText),
      toolCalls: conversationToolCalls,
    };
  }

  if (toolCall.name === "finish_tailor_resume_interview") {
    return {
      response: parseTailorResumeInterviewResponse({
        ...(argumentsJson && typeof argumentsJson === "object"
          ? argumentsJson
          : {}),
        action: "done",
        debugDecision: "not_applicable",
        keywordDecisions: [],
        nonTechnologyTerms: [],
      }, visibleOutputText),
      toolCalls: conversationToolCalls,
    };
  }

  if (toolCall.name === "skip_tailor_resume_interview") {
    return {
      response: {
        action: "skip",
        assistantMessage: "",
        completionMessage: "",
        debugDecision: "not_applicable",
        keywordDecisions: [],
        learnings: [],
        nonTechnologyTerms: [],
        technologyContexts: [],
        userMarkdownEditOperations: [],
      },
      toolCalls: conversationToolCalls,
    };
  }

  if (toolCall.name === "update_tailor_resume_non_technologies") {
    return {
      response: parseTailorResumeInterviewResponse({
        ...(argumentsJson && typeof argumentsJson === "object"
          ? argumentsJson
          : {}),
        action: "done",
        debugDecision: "not_applicable",
        learnings: [],
        userMarkdownEditOperations: [],
      }, visibleOutputText),
      toolCalls: conversationToolCalls,
    };
  }

  return {
    response: parseTailorResumeInterviewResponse(
      {
        action: "ask",
        debugDecision: "not_applicable",
      },
      visibleOutputText,
    ),
    toolCalls: conversationToolCalls,
  };
}

function serializePlannedBlocks(input: {
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  planningResult: TailoredResumePlanningResult;
}) {
  if (input.planningResult.changes.length === 0) {
    return "[no planned block edits]";
  }

  return input.planningResult.changes
    .map((change, index) => {
      const block = input.planningBlocksById.get(change.segmentId);

      return [
        `${index + 1}. segmentId: ${change.segmentId}`,
        `   current text: ${block?.plainText ?? "[missing block]"}`,
        `   current latex: ${block?.latexCode ?? "[missing block]"}`,
        `   desired text: ${change.desiredPlainText || "[remove this block]"}`,
        `   reason: ${change.reason.trim()}`,
      ].join("\n");
    })
    .join("\n\n");
}

function serializeEmphasizedTechnologies(
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

function serializeKeywordPresenceContext(
  context: TailorResumeKeywordPresenceContext,
) {
  if (context.terms.length === 0) {
    return "[no emphasized technologies identified]";
  }

  const highMissing =
    context.highPriorityMissingFromOriginalResumeAndUserMarkdown.length > 0
      ? context.highPriorityMissingFromOriginalResumeAndUserMarkdown.join(", ")
      : "[none]";
  const lowMissing =
    context.lowPriorityMissingFromOriginalResumeAndUserMarkdown.length > 0
      ? context.lowPriorityMissingFromOriginalResumeAndUserMarkdown.join(", ")
      : "[none]";
  const terms = context.terms
    .map((term, index) =>
      [
        `${index + 1}. ${term.name}`,
        `   priority: ${term.priority}`,
        `   presentInOriginalResume: ${String(term.presentInOriginalResume)}`,
        `   presentInUserMarkdown: ${String(term.presentInUserMarkdown)}`,
        `   evidence: ${term.evidence || "[not provided]"}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "This context is model-only. Do not reveal USER.md presence to the user.",
    `High-priority terms missing from both original resume and USER.md: ${highMissing}`,
    `Low-priority terms missing from both original resume and USER.md: ${lowMissing}`,
    "Per-term deterministic presence:",
    terms,
  ].join("\n");
}

function applyKeywordDecisionsToEmphasizedTechnologies(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  keywordDecisions: TailorResumeKeywordDecision[];
  nonTechnologyTerms?: string[];
}) {
  const removedNames = new Set(
    [
      ...input.keywordDecisions
        .filter((decision) => decision.action === "remove")
        .map((decision) => decision.name),
      ...(input.nonTechnologyTerms ?? []),
    ].map((name) => name.trim().toLowerCase()),
  );

  if (removedNames.size === 0) {
    return input.emphasizedTechnologies;
  }

  return input.emphasizedTechnologies.filter(
    (technology) => !removedNames.has(technology.name.trim().toLowerCase()),
  );
}

const productSpecificTermsToAvoidAsking = new Set([
  "apollo",
  "blueprint",
  "environment platform",
  "foundry",
  "gotham",
  "mission manager",
  "palantir apollo",
  "palantir foundry",
  "palantir gotham",
  "rubix",
  "signals",
]);

const vagueTermsToAvoidAsking = [
  "cloud infrastructure",
  "communication",
  "collaboration",
  "computer science",
  "developer experience",
  "internet terminology",
  "micro-service repos",
  "microservices",
  "open-source",
  "security clearance",
] as const;

function isAskWorthyMissingTechnologyTerm(
  term: TailorResumeKeywordPresenceContextTerm,
) {
  const normalizedName = term.name.trim().toLowerCase();

  if (
    !normalizedName ||
    term.presentInOriginalResume ||
    term.presentInUserMarkdown
  ) {
    return false;
  }

  if (productSpecificTermsToAvoidAsking.has(normalizedName)) {
    return false;
  }

  if (
    vagueTermsToAvoidAsking.some(
      (vagueTerm) =>
        normalizedName === vagueTerm || normalizedName.includes(vagueTerm),
    )
  ) {
    return false;
  }

  return true;
}

export function findAskWorthyMissingTailorResumeQuestionTerms(
  context: TailorResumeKeywordPresenceContext,
) {
  return context.terms
    .filter(isAskWorthyMissingTechnologyTerm)
    .map((term) => term.name);
}

function buildFallbackTailorResumeProbeQuestion(terms: string[]) {
  const selectedTerms = terms
    .slice(0, 6)
    .map(formatTailorResumeTermWithCapitalFirst);

  return [
    `Not mentioned in your resume or USER.md: ${selectedTerms.join(", ")}.`,
    "Do you have direct experience with any of these? If so, reply with the technology names, where you used them, and one concrete impact or scope detail.",
  ].join("\n");
}

function serializeConversation(messages: TailorResumeConversationMessage[]) {
  if (messages.length === 0) {
    return "[no conversation yet]";
  }

  return messages
    .map((message, index) => {
      return `${index + 1}. ${message.role}: ${message.text}`;
    })
    .join("\n");
}

function serializeQuestioningSummary(
  summary: TailoredResumeQuestioningSummary | null,
) {
  if (!summary) {
    return "[no follow-up question plan yet]";
  }

  const learningsText =
    summary.learnings.length > 0
      ? summary.learnings
          .map((learning, index) =>
            [
              `${index + 1}. topic: ${learning.topic}`,
              `   targetSegmentIds: ${
                learning.targetSegmentIds.length > 0
                  ? learning.targetSegmentIds.join(", ")
                  : "[none]"
              }`,
              `   detail: ${learning.detail}`,
            ].join("\n"),
          )
          .join("\n\n")
      : "[no confirmed learnings yet]";

  return [
    `agenda: ${summary.agenda || "[none]"}`,
    `askedQuestionCount: ${String(summary.askedQuestionCount)}`,
    `debugDecision: ${summary.debugDecision ?? "[none]"}`,
    "current learnings:",
    learningsText,
  ].join("\n");
}

function buildTailorResumeInterviewInput(input: {
  conversation: TailorResumeConversationMessage[];
  jobDescription: string;
  keywordPresenceContext: TailorResumeKeywordPresenceContext;
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
  userMarkdown: TailorResumeUserMarkdownState;
}) {
  const hasAcceptedPlan = input.planningResult.changes.length > 0;

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: `Job description:\n${input.jobDescription}`,
        },
        {
          type: "input_text" as const,
          text:
            hasAcceptedPlan
              ? "Accepted tailoring thesis:\n" +
                `jobDescriptionFocus: ${input.planningResult.thesis.jobDescriptionFocus}\n` +
                `resumeChanges: ${input.planningResult.thesis.resumeChanges}`
              : "Planning status:\nStep 3 planning has not run yet. Step 2 should decide whether USER.md already answers the missing technology gaps or whether the user should be asked concise questions before planning starts.",
        },
        {
          type: "input_text" as const,
          text: `Whole resume plain text:\n${input.planningSnapshot.resumePlainText}`,
        },
        {
          type: "input_text" as const,
          text:
            "Current USER.md memory for this user:\n" +
            (input.userMarkdown.markdown.trim()
              ? input.userMarkdown.markdown
              : "[empty USER.md]"),
        },
        {
          type: "input_text" as const,
          text:
            "Saved non-technology terms for this user:\n" +
            (input.userMarkdown.nonTechnologies.length > 0
              ? input.userMarkdown.nonTechnologies.join(", ")
              : "[none]") +
            "\nTreat this list as case-insensitive. Terms in it have already been removed from current keyword scraping when possible, and future user rejections should be added through nonTechnologyTerms.",
        },
        {
          type: "input_text" as const,
          text:
            "Planned block edits:\n" +
            serializePlannedBlocks({
              planningBlocksById: input.planningBlocksById,
              planningResult: input.planningResult,
            }),
        },
        {
          type: "input_text" as const,
          text:
            "Technologies emphasized by the job description:\n" +
            serializeEmphasizedTechnologies(
              input.planningResult.emphasizedTechnologies,
            ),
        },
        {
          type: "input_text" as const,
          text:
            "Deterministic keyword presence context for Step 2 clarification:\n" +
            serializeKeywordPresenceContext(input.keywordPresenceContext),
        },
        {
          type: "input_text" as const,
          text:
            "Current question plan summary:\n" +
            serializeQuestioningSummary(input.planningResult.questioningSummary),
        },
        {
          type: "input_text" as const,
          text:
            "Conversation so far:\n" + serializeConversation(input.conversation),
        },
      ],
    },
  ];
}

function buildTailorResumeInterviewInstructions(input: {
  debugForceConversation?: boolean;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumeInterviewSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      debugForceConversation: input.debugForceConversation,
    },
  );
}

function latestUserMessageRequestsAssistantReply(
  messages: TailorResumeConversationMessage[],
) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const text = latestUserMessage?.text.trim() ?? "";

  if (!text) {
    return false;
  }

  return (
    /[?？]/.test(text) ||
    /\b(?:can|could|would|will|should)\s+you\b/i.test(text) ||
    /\b(?:sample|example|draft|suggest|review|clarify|show me|give me)\b/i.test(
      text,
    )
  );
}

function readLatestUserMessageText(messages: TailorResumeConversationMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.text.trim() ?? ""
  );
}

function latestUserMessageRequestsInterviewEnd(
  messages: TailorResumeConversationMessage[],
) {
  const text = readLatestUserMessageText(messages);

  return /\b(?:done|finish|end|wrap\s+up|that(?:'s| is)\s+all|all\s+set|go\s+ahead|proceed|start\s+tailoring|continue\s+tailoring|generate|tailor\s+(?:it|the\s+resume))\b/i.test(
    text,
  );
}

export function tailorResumeAskMessageRequestsUserMarkdownPermission(text: string) {
  return (
    /\b(?:do you want me to|would you like me to|should i|shall i|confirm(?:\s+you\s+want)?|want me to)\b/i.test(
      text,
    ) &&
    /\b(?:user\.md|update|save|add|record|include|write|quoted|bullets?)\b/i.test(
      text,
    )
  );
}

function shouldTreatFollowUpAskAsFinish(input: {
  conversation: TailorResumeConversationMessage[];
  emphasizedTechnologyNames: string[];
  response: TailorResumeInterviewResponse;
}) {
  if (
    input.response.userMarkdownEditOperations.length > 0 &&
    latestUserMessageRequestsInterviewEnd(input.conversation)
  ) {
    return true;
  }

  if (
    input.response.userMarkdownEditOperations.length > 0 &&
    tailorResumeAskMessageRequestsUserMarkdownPermission(
      input.response.assistantMessage,
    )
  ) {
    return true;
  }

  return (
    input.response.userMarkdownEditOperations.length > 0 &&
    input.emphasizedTechnologyNames.length > 0 &&
    latestUserMessageDirectlyConfirmsTechnologyExperience({
      messages: input.conversation,
      technologyNames: input.emphasizedTechnologyNames,
    })
  );
}

function textMentionsTechnology(text: string, technologyName: string) {
  const normalizedText = text.toLowerCase();
  const normalizedTechnologyName = technologyName.trim().toLowerCase();

  return (
    normalizedTechnologyName.length > 0 &&
    normalizedText.includes(normalizedTechnologyName)
  );
}

function latestAssistantDisplayedTechnology(input: {
  messages: TailorResumeConversationMessage[];
  technologyName: string;
}) {
  const latestAssistantMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!latestAssistantMessage) {
    return false;
  }

  return (
    (latestAssistantMessage.technologyContexts ?? []).some(
      (technologyContext) =>
        textMentionsTechnology(technologyContext.name, input.technologyName),
    ) || textMentionsTechnology(latestAssistantMessage.text, input.technologyName)
  );
}

function latestUserMessageBroadlyRejectsDisplayedTechnologies(text: string) {
  return (
    /\b(?:those|these|they|them|all\s+of\s+them|all\s+of\s+these|the\s+(?:terms|keywords|skills))\b/i.test(
      text,
    ) &&
    /\b(?:not\s+(?:a\s+)?real\s+(?:skill|skills|keyword|keywords|requirement|requirements|technolog(?:y|ies))|aren['’]?t\s+(?:real\s+)?(?:skills|keywords|requirements|technologies)|are\s+not\s+(?:real\s+)?(?:skills|keywords|requirements|technologies)|don['’]?t\s+include|do\s+not\s+include|shouldn['’]?t\s+count|should\s+not\s+count|remove|drop|ignore)\b/i.test(
      text,
    )
  );
}

function latestUserMessageExplicitlyRejectsTechnology(input: {
  messages: TailorResumeConversationMessage[];
  technologyName: string;
}) {
  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const text = latestUserMessage?.text.trim() ?? "";

  if (!text) {
    return false;
  }

  const directlyMentionsTechnology = textMentionsTechnology(
    text,
    input.technologyName,
  );
  const broadlyRejectsDisplayedTechnology =
    latestUserMessageBroadlyRejectsDisplayedTechnologies(text) &&
    latestAssistantDisplayedTechnology(input);

  if (!directlyMentionsTechnology && !broadlyRejectsDisplayedTechnology) {
    return false;
  }

  return /\b(?:not\s+(?:a\s+)?real\s+(?:skill|skills|keyword|keywords|requirement|requirements|technolog(?:y|ies))|not required|not relevant|ignore|remove|drop|nonsense|doesn['’]t apply|does not apply|don['’]?t include|do not include|shouldn['’]t count|should not count)\b/i.test(
    text,
  ) || latestUserMessageBroadlyRejectsDisplayedTechnologies(text);
}

export function latestUserMessageDirectlyConfirmsTechnologyExperience(input: {
  messages: TailorResumeConversationMessage[];
  technologyNames: string[];
}) {
  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const text = latestUserMessage?.text.trim() ?? "";

  if (!text || latestUserMessageRequestsAssistantReply(input.messages)) {
    return false;
  }

  if (
    !/\b(?:yes|yep|yeah|correct|confirmed|i\s+(?:have|used|built|worked|owned)|i['’]ve|experience\s+with)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return input.technologyNames.some((technologyName) =>
    textMentionsTechnology(text, technologyName),
  );
}

function deriveTailorResumeQuestioningAgenda(input: {
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}) {
  const firstTopic = input.response.learnings
    .map((learning) => learning.topic.trim())
    .find(Boolean);
  const assistantTopic =
    input.response.action === "ask" ? input.response.assistantMessage.trim() : "";

  return firstTopic ?? input.previousSummary?.agenda ?? assistantTopic;
}

function normalizeTailorResumeInterviewResponse(input: {
  conversation: TailorResumeConversationMessage[];
  emphasizedTechnologyNames: string[];
  plannedSegmentIds: Set<string>;
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}) {
  for (const learning of input.response.learnings) {
    const seenSegmentIds = new Set<string>();
    const validTargetSegmentIds: string[] = [];

    for (const segmentId of learning.targetSegmentIds) {
      if (seenSegmentIds.has(segmentId)) {
        continue;
      }

      if (!input.plannedSegmentIds.has(segmentId)) {
        continue;
      }

      seenSegmentIds.add(segmentId);
      validTargetSegmentIds.push(segmentId);
    }

    learning.targetSegmentIds = validTargetSegmentIds;
  }

  if (
    !input.previousSummary &&
    input.response.action === "done" &&
    input.response.userMarkdownEditOperations.length === 0 &&
    input.response.learnings.length === 0
  ) {
    input.response.action = "skip";
    input.response.completionMessage = "";
  }

  if (input.response.action === "skip") {
    if (input.previousSummary) {
      input.response.action = "done";
      input.response.completionMessage =
        input.response.completionMessage ||
        input.response.assistantMessage ||
        "Thanks, I have enough context and will continue tailoring now.";
    }

    if (input.response.action === "skip") {
      input.response.assistantMessage = "";
      input.response.completionMessage = "";
      input.response.debugDecision = "not_applicable";
      input.response.keywordDecisions = [];
      input.response.nonTechnologyTerms = [];
      input.response.technologyContexts = [];
      input.response.userMarkdownEditOperations = [];

      return;
    }
  }

  const knownTechnologyNames = new Set(
    input.emphasizedTechnologyNames.map((name) => name.trim().toLowerCase()),
  );

  input.response.keywordDecisions = input.response.keywordDecisions.filter(
    (decision) =>
      knownTechnologyNames.has(decision.name.trim().toLowerCase()) &&
      (decision.action !== "remove" ||
        latestUserMessageExplicitlyRejectsTechnology({
          messages: input.conversation,
          technologyName: decision.name,
        })),
  );

  input.response.nonTechnologyTerms = input.response.nonTechnologyTerms.filter(
    (nonTechnologyTerm) =>
      knownTechnologyNames.has(nonTechnologyTerm.trim().toLowerCase()) &&
      latestUserMessageExplicitlyRejectsTechnology({
        messages: input.conversation,
        technologyName: nonTechnologyTerm,
      }),
  );

  if (input.response.action === "ask" && !input.response.assistantMessage) {
    input.response.assistantMessage =
      "What else should I know before tailoring this resume?";
  }

  if (
    input.response.action === "ask" &&
    input.response.assistantMessage.split(/\s+/).filter(Boolean).length > 650
  ) {
    input.response.assistantMessage = input.response.assistantMessage
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 650)
      .join(" ");
  }

  if (input.response.action === "ask" && input.response.completionMessage) {
    input.response.completionMessage = "";
  }

  if (input.response.action === "ask") {
    if (
      tailorResumeAskMessageRequestsUserMarkdownPermission(
        input.response.assistantMessage,
      ) &&
      input.response.userMarkdownEditOperations.length > 0
    ) {
      input.response.action = "done";
      input.response.completionMessage =
        input.response.assistantMessage ||
        "Thanks, I have enough context and will continue tailoring now.";
      input.response.assistantMessage = "";
      input.response.technologyContexts = [];
    }

    if (
      input.response.action === "ask" &&
      (latestUserMessageRequestsInterviewEnd(input.conversation) ||
        isNonQuestionAskMessage(input.response.assistantMessage))
    ) {
      input.response.action = "done";
      input.response.completionMessage =
        input.response.assistantMessage ||
        "Thanks, I have enough context and will continue tailoring now.";
      input.response.assistantMessage = "";
      input.response.technologyContexts = [];
    }
  }

  if (
    input.response.action === "ask" &&
    input.response.userMarkdownEditOperations.length > 0
  ) {
    input.response.userMarkdownEditOperations = [];
  }

  if (
    input.response.action === "ask" &&
    !input.previousSummary &&
    input.response.keywordDecisions.length > 0
  ) {
    input.response.keywordDecisions = [];
  }

  if (input.response.action === "done" && !input.response.completionMessage) {
    input.response.completionMessage =
      "Thanks, I have enough context and will continue tailoring now.";
  }

  if (input.response.action === "done" && input.response.assistantMessage) {
    input.response.completionMessage =
      input.response.completionMessage || input.response.assistantMessage;
    input.response.assistantMessage = "";
  }

  if (input.response.debugDecision !== "not_applicable") {
    input.response.debugDecision = "not_applicable";
  }
}

export async function advanceTailorResumeQuestioning(input: {
  conversation: TailorResumeConversationMessage[];
  jobDescription: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
  promptSettings?: SystemPromptSettings;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<AdvanceTailorResumeQuestioningResult> {
  const startedAt = Date.now();
  const userMarkdown = input.userMarkdown ?? {
    markdown: defaultTailorResumeUserMarkdown,
    nonTechnologies: [],
    updatedAt: null,
  };
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();
  const debugForceConversation =
    isDebugForceConversationInTailorPipelineEnabled();
  const planningBlocksById = new Map(
    input.planningSnapshot.blocks.map((block) => [block.segmentId, block]),
  );
  const plannedSegmentIds = new Set(
    input.planningResult.changes.map((change) => change.segmentId),
  );
  const previousSummary = input.planningResult.questioningSummary;
  const keywordPresenceContext = buildTailorResumeKeywordPresenceContext({
    emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
    originalResumeText: input.planningSnapshot.resumePlainText,
    userMarkdown: userMarkdown.markdown,
  });
  const askWorthyMissingTerms =
    findAskWorthyMissingTailorResumeQuestionTerms(keywordPresenceContext);

  for (let attempt = 1; attempt <= 1; attempt += 1) {
    const interviewInput = buildTailorResumeInterviewInput({
      conversation: input.conversation,
      jobDescription: input.jobDescription,
      keywordPresenceContext,
      planningBlocksById,
      planningResult: input.planningResult,
      planningSnapshot: input.planningSnapshot,
      userMarkdown,
    });
    const instructions = buildTailorResumeInterviewInstructions({
      debugForceConversation,
      promptSettings: input.promptSettings,
    });
    const response = await runWithTransientModelRetries({
      onRetry: async (retryEvent) => {
        await input.onStepEvent?.({
          attempt,
          detail:
            `The Step 2 interview request hit a transient model error (${retryEvent.message}). ` +
            `Retrying automatically (${retryEvent.nextAttempt}/${retryEvent.maxAttempts}).`,
          durationMs: Math.max(0, Date.now() - startedAt),
          emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
          retrying: true,
          status: "failed",
          stepCount: 5,
          stepNumber: 2,
          summary: "Continuing the follow-up questions",
        });
      },
      operation: async () => {
        await input.onStreamEvent?.({ kind: "reset" });

        const streamer = new TailorResumeInterviewArgsStreamer();
        const reasoning = resolveTailorResumeInterviewReasoning(model);
        const stream = client.responses.stream({
          input: interviewInput,
          instructions,
          ...(reasoning ? { reasoning } : {}),
          ...buildLowVerbosityTextConfig(model),
          model,
          tool_choice: "required",
          tools: tailorResumeInterviewTools,
        });
        const finalResponsePromise = stream.finalResponse();

        for await (const event of stream) {
          if (
            event.type === "response.function_call_arguments.delta" &&
            typeof event.delta === "string" &&
            event.delta.length > 0
          ) {
            const emitted = streamer.feed(event.delta);

            if (input.onStreamEvent) {
              for (const emittedEvent of emitted) {
                await input.onStreamEvent(emittedEvent);
              }
            }
          }
        }

        return (await finalResponsePromise) as TailoredResumeResponse;
      },
    });

    let parsedResponse: TailorResumeInterviewResponse;
    let parsedToolCalls: TailorResumeConversationToolCall[] = [];

    const parsedModelOutput =
      parseTailorResumeInterviewResponseFromModelOutput(response);
    parsedResponse = normalizeTailorResumeInterviewResponseForCurrentTurn({
      conversation: input.conversation,
      emphasizedTechnologyNames:
        input.planningResult.emphasizedTechnologies.map(
          (technology) => technology.name,
        ),
      previousSummary,
      response: parsedModelOutput.response,
    });
    parsedToolCalls = parsedModelOutput.toolCalls;
    normalizeTailorResumeInterviewResponse({
      conversation: input.conversation,
      emphasizedTechnologyNames: input.planningResult.emphasizedTechnologies.map(
        (technology) => technology.name,
      ),
      plannedSegmentIds,
      previousSummary,
      response: parsedResponse,
    });

    if (
      input.conversation.length === 0 &&
      parsedResponse.action === "skip" &&
      askWorthyMissingTerms.length > 0
    ) {
      parsedResponse = {
        action: "ask",
        assistantMessage:
          buildFallbackTailorResumeProbeQuestion(askWorthyMissingTerms),
        completionMessage: "",
        debugDecision: "not_applicable",
        keywordDecisions: [],
        learnings: [],
        nonTechnologyTerms: [],
        technologyContexts: [],
        userMarkdownEditOperations: [],
      };
      parsedToolCalls = [
        {
          argumentsText: JSON.stringify(
            {
              assistantMessage: parsedResponse.assistantMessage,
              technologyContexts: [],
            },
            null,
            2,
          ),
          name: "initiate_tailor_resume_probing_questions",
        },
      ];
    }

    let userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null = null;

    if (parsedResponse.userMarkdownEditOperations.length > 0) {
      userMarkdownPatchResult = applyTailorResumeUserMarkdownPatch(
        userMarkdown.markdown,
        parsedResponse.userMarkdownEditOperations,
      );

      if (!userMarkdownPatchResult.ok) {
        userMarkdownPatchResult = null;
        parsedResponse.userMarkdownEditOperations = [];
      }
    }

    const nextEmphasizedTechnologies =
      applyKeywordDecisionsToEmphasizedTechnologies({
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        keywordDecisions: parsedResponse.keywordDecisions,
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
      });

    if (parsedResponse.action === "skip") {
      return {
        action: "done",
        completionMessage:
          "Thanks, I have enough context and will continue tailoring now.",
        emphasizedTechnologies: nextEmphasizedTechnologies,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
        questioningSummary: null,
        toolCalls: parsedToolCalls,
        userMarkdownEditOperations: [],
        userMarkdownPatchResult,
      };
    }

    const questioningSummary: TailoredResumeQuestioningSummary = {
      agenda: deriveTailorResumeQuestioningAgenda({
        previousSummary,
        response: parsedResponse,
      }),
      askedQuestionCount:
        parsedResponse.action === "ask"
          ? (previousSummary?.askedQuestionCount ?? 0) + 1
          : (previousSummary?.askedQuestionCount ?? 0),
      debugDecision:
        parsedResponse.action === "ask"
          ? parsedResponse.debugDecision === "not_applicable"
            ? null
            : parsedResponse.debugDecision
          : previousSummary?.debugDecision ?? null,
      learnings: parsedResponse.learnings,
    };

    if (parsedResponse.action === "ask") {
      return {
        action: "ask",
        assistantMessage: parsedResponse.assistantMessage,
        emphasizedTechnologies: nextEmphasizedTechnologies,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
        questioningSummary,
        technologyContexts: parsedResponse.technologyContexts,
        toolCalls: parsedToolCalls,
        userMarkdownPatchResult,
      };
    }

    return {
      action: "done",
      completionMessage: parsedResponse.completionMessage,
      emphasizedTechnologies: nextEmphasizedTechnologies,
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
      questioningSummary,
      toolCalls: parsedToolCalls,
      userMarkdownEditOperations: parsedResponse.userMarkdownEditOperations,
      userMarkdownPatchResult,
    };
  }

  return {
    action: "done",
    completionMessage: "Thanks, I have enough context and will continue tailoring now.",
    emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    nonTechnologyTerms: [],
    questioningSummary: previousSummary,
    toolCalls: [],
    userMarkdownEditOperations: [],
    userMarkdownPatchResult: null,
  };
}
