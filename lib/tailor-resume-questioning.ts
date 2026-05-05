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
  buildTailorResumeKeywordCheckResult,
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

const tailorResumeTechnologyContextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    definition: {
      type: "string",
      description:
        "One plain-English sentence explaining what this technology is and what resume activities it most likely maps to.",
    },
    examples: {
      type: "array",
      description:
        "Meaningfully different, FAANG-level one-sentence resume bullet suggestions that include the exact technology keyword, stay concise, and include the positive result in the same sentence. Return exactly two by default, but return the number the user explicitly asks for when they request more examples, up to six. Prefer action + technical scope + measurable impact, e.g. reduced cost 40%, improved latency 2x, processed 10k msg/sec. If an example uses a dash suffix, the suffix after the dash must be the relevant resume company/project/experience name, never the technology keyword itself.",
      items: { type: "string" },
      minItems: 2,
      maxItems: 6,
    },
    name: {
      type: "string",
      description: "The exact technology keyword the user is being asked about.",
    },
  },
  required: ["name", "definition", "examples"],
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
        "The compact user-facing chat message. This text is rendered visibly next to technologyContexts. When asking about technology experience, list the relevant skills and ask whether any match the user's experience. Do not include technology definitions or example bullets here; put those only in technologyContexts so the app can render collapsible cards without duplicate text.",
    },
    debugDecision: {
      type: "string",
      enum: [
        "forced_only",
        "not_applicable",
        "would_ask_without_debug",
      ],
    },
    learnings: {
      type: "array",
      items: tailorResumeInterviewLearningSchema,
    },
    keywordDecisions: {
      type: "array",
      items: tailorResumeKeywordDecisionSchema,
    },
    nonTechnologyTerms: tailorResumeNonTechnologyTermsSchema,
    technologyContexts: {
      type: "array",
      description:
        "Structured technology explanations for any current-turn technology experience question, including follow-up turns. These entries are rendered visibly as collapsible UI cards under assistantMessage, so their definitions and examples must not be repeated in assistantMessage. Use one entry per technology being asked about on this turn. Return an empty array only when the current assistant turn is not asking about technology experience.",
      items: tailorResumeTechnologyContextSchema,
    },
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: [
    "assistantMessage",
    "debugDecision",
    "keywordDecisions",
    "learnings",
    "nonTechnologyTerms",
    "technologyContexts",
    "userMarkdownEditOperations",
  ],
} as const;

const finishTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    completionMessage: {
      type: "string",
      description:
        "A concise user-facing request asking whether the user wants to end the chat now.",
    },
    learnings: {
      type: "array",
      items: tailorResumeInterviewLearningSchema,
    },
    keywordDecisions: {
      type: "array",
      items: tailorResumeKeywordDecisionSchema,
    },
    nonTechnologyTerms: tailorResumeNonTechnologyTermsSchema,
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: [
    "completionMessage",
    "keywordDecisions",
    "learnings",
    "nonTechnologyTerms",
    "userMarkdownEditOperations",
  ],
} as const;

const skipTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: { type: "string" },
    keywordDecisions: {
      type: "array",
      items: tailorResumeKeywordDecisionSchema,
    },
    nonTechnologyTerms: tailorResumeNonTechnologyTermsSchema,
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: [
    "reason",
    "keywordDecisions",
    "nonTechnologyTerms",
    "userMarkdownEditOperations",
  ],
} as const;

const updateTailorResumeNonTechnologiesToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    completionMessage: {
      type: "string",
      description:
        "A concise user-facing message saying the rejected terms were added to the non-technology list and asking the user to press Done or keep chatting.",
    },
    keywordDecisions: {
      type: "array",
      items: tailorResumeKeywordDecisionSchema,
    },
    learnings: {
      type: "array",
      items: tailorResumeInterviewLearningSchema,
    },
    nonTechnologyTerms: tailorResumeNonTechnologyTermsSchema,
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: [
    "completionMessage",
    "keywordDecisions",
    "learnings",
    "nonTechnologyTerms",
    "userMarkdownEditOperations",
  ],
} as const;

const tailorResumeInterviewTools = [
  {
    type: "function" as const,
    name: "initiate_tailor_resume_probing_questions",
    description:
      "Initiate or continue Step 2 probing questions and keep the tailoring interview open. Any turn that asks about technology experience may include structured technologyContexts for collapsible UI cards.",
    parameters: initiateTailorResumeProbingQuestionsToolParameters,
    strict: true,
  },
  {
    type: "function" as const,
    name: "finish_tailor_resume_interview",
    description:
      "Request user confirmation to end an active tailoring interview after the useful learnings are complete.",
    parameters: finishTailorResumeInterviewToolParameters,
    strict: true,
  },
  {
    type: "function" as const,
    name: "skip_tailor_resume_interview",
    description:
      "Skip the interview before any follow-up question has been asked because no user input is useful.",
    parameters: skipTailorResumeInterviewToolParameters,
    strict: true,
  },
  {
    type: "function" as const,
    name: "update_tailor_resume_non_technologies",
    description:
      "Add user-rejected emphasized keyword terms to the saved non-technology list and remove them from this tailoring run.",
    parameters: updateTailorResumeNonTechnologiesToolParameters,
    strict: true,
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
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}): TailorResumeInterviewResponse {
  return input.response;
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

function parseTailoredResumeQuestionLearning(
  value: unknown,
): TailoredResumeQuestionLearning {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid interview learning.");
  }

  const topic = "topic" in value ? readTrimmedString(value.topic) : "";
  const detail = "detail" in value ? readTrimmedString(value.detail) : "";
  const rawTargetSegmentIds =
    "targetSegmentIds" in value ? value.targetSegmentIds : null;

  if (!topic || !detail || !Array.isArray(rawTargetSegmentIds)) {
    throw new Error("The model returned an incomplete interview learning.");
  }

  const targetSegmentIds = rawTargetSegmentIds.map((segmentId) => {
    const parsedSegmentId = readTrimmedString(segmentId);

    if (!parsedSegmentId) {
      throw new Error(
        "The model returned an interview learning with an empty targetSegmentId.",
      );
    }

    return parsedSegmentId;
  });

  return {
    detail,
    targetSegmentIds,
    topic,
  };
}

function parseTailorResumeTechnologyContexts(
  value: unknown,
): TailorResumeTechnologyContext[] {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("The model returned invalid technology context cards.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("The model returned an invalid technology context card.");
    }

    const name =
      "name" in entry
        ? formatTailorResumeTermWithCapitalFirst(readTrimmedString(entry.name))
        : "";
    const definition =
      "definition" in entry ? readTrimmedString(entry.definition) : "";
    const examples =
      "examples" in entry && Array.isArray(entry.examples)
        ? entry.examples.map(readTrimmedString).filter(Boolean)
        : [];

    if (!name || !definition || examples.length < 2 || examples.length > 6) {
      throw new Error(
        "The model returned an incomplete technology context card.",
      );
    }

    return {
      definition,
      examples,
      name,
    };
  });
}

function normalizeTechnologyExampleSuffix(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, "");
}

function readTechnologyExampleDashSuffix(example: string) {
  const match = /\s(?:--|[-–—])\s*([^-–—]+?)\s*$/.exec(example);

  return match ? match[1]!.trim() : "";
}

function technologyExampleEndsWithTechnologyName(input: {
  example: string;
  technologyName: string;
}) {
  const suffix = readTechnologyExampleDashSuffix(input.example);

  if (!suffix) {
    return false;
  }

  return (
    normalizeTechnologyExampleSuffix(suffix) ===
    normalizeTechnologyExampleSuffix(input.technologyName)
  );
}

function technologyExampleHasResultSignal(example: string) {
  return (
    /\b(?:to|with|while|by|for)\b.+(?:\d|reduce|reduced|reducing|improve|improved|improving|cut|cutting|lower|lowered|lowering|increase|increased|increasing|boost|boosted|boosting|accelerate|accelerated|accelerating|save|saved|saving|enable|enabled|enabling|scale|scaled|scaling|latency|throughput|cost|reliability|availability|retention|conversion|efficiency|productivity|accuracy|quality|semantics)\b/i.test(
      example,
    ) ||
    /\b\d+(?:[.,]\d+)?\s*(?:%|x|ms|sec|secs|second|seconds|k|m)\b/i.test(
      example,
    )
  );
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
    throw new Error("The model returned invalid USER.md edit operations.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("The model returned an invalid USER.md edit operation.");
    }

    const op = "op" in entry ? entry.op : null;

    if (
      op !== "append" &&
      op !== "delete_exact" &&
      op !== "insert_after" &&
      op !== "insert_before" &&
      op !== "replace_exact"
    ) {
      throw new Error("The model returned an unsupported USER.md edit operation.");
    }

    const headingPath =
      "headingPath" in entry && Array.isArray(entry.headingPath)
        ? entry.headingPath
            .map((heading: unknown) => readTrimmedString(heading))
            .filter(Boolean)
        : [];

    return {
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
    };
  });
}

function parseTailorResumeKeywordDecisions(
  value: unknown,
): TailorResumeKeywordDecision[] {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("The model returned invalid keyword decisions.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("The model returned an invalid keyword decision.");
    }

    const name = "name" in entry ? readTrimmedString(entry.name) : "";
    const action =
      "action" in entry && (entry.action === "keep" || entry.action === "remove")
        ? entry.action
        : null;
    const reason = "reason" in entry ? readTrimmedString(entry.reason) : "";

    if (!name || !action || !reason) {
      throw new Error("The model returned an incomplete keyword decision.");
    }

    return {
      action,
      name,
      reason,
    };
  });
}

function parseTailorResumeNonTechnologyTerms(value: unknown) {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("The model returned invalid non-technology terms.");
  }

  return normalizeTailorResumeNonTechnologyTerms(
    value.filter((term): term is string => typeof term === "string"),
  );
}

function parseTailorResumeInterviewResponse(
  value: unknown,
  outputText: string,
): TailorResumeInterviewResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid interview response.");
  }

  const action =
    "action" in value &&
    (value.action === "ask" || value.action === "done" || value.action === "skip")
      ? value.action
      : null;
  const debugDecision =
    "debugDecision" in value &&
    (value.debugDecision === "forced_only" ||
      value.debugDecision === "not_applicable" ||
      value.debugDecision === "would_ask_without_debug")
      ? value.debugDecision
      : null;
  const rawLearnings = "learnings" in value ? value.learnings : null;
  const keywordDecisions = parseTailorResumeKeywordDecisions(
    "keywordDecisions" in value ? value.keywordDecisions : undefined,
  );
  const nonTechnologyTerms = parseTailorResumeNonTechnologyTerms(
    "nonTechnologyTerms" in value ? value.nonTechnologyTerms : undefined,
  );
  const technologyContexts = parseTailorResumeTechnologyContexts(
    "technologyContexts" in value ? value.technologyContexts : undefined,
  );
  const userMarkdownEditOperations = parseTailorResumeUserMarkdownEditOperations(
    "userMarkdownEditOperations" in value
      ? value.userMarkdownEditOperations
      : undefined,
  );

  if (!action || !debugDecision || !Array.isArray(rawLearnings)) {
    throw new Error("The model returned an incomplete interview response.");
  }

  const parsedResponse: TailorResumeInterviewResponse = {
    action,
    assistantMessage:
      action === "ask"
        ? readRecordString(value, "assistantMessage") || outputText
        : "",
    completionMessage:
      action === "done"
        ? outputText || readRecordString(value, "completionMessage")
        : "",
    debugDecision,
    keywordDecisions,
    learnings: rawLearnings.map(parseTailoredResumeQuestionLearning),
    nonTechnologyTerms,
    technologyContexts: action === "ask" ? technologyContexts : [],
    userMarkdownEditOperations,
  };

  if (parsedResponse.action === "ask") {
    for (const technologyContext of parsedResponse.technologyContexts) {
      if (
        assistantMessageRepeatsTechnologyContext({
          assistantMessage: parsedResponse.assistantMessage,
          technologyContext,
        })
      ) {
        throw new Error(
          `Action "ask" must not repeat the rendered definition or example bullets for "${technologyContext.name}" in assistantMessage.`,
        );
      }
    }
  }

  return parsedResponse;
}

function parseToolCallArguments(toolCall: TailoredResumeFunctionToolCall) {
  try {
    return JSON.parse(toolCall.arguments) as unknown;
  } catch {
    throw new Error(
      `The model called ${toolCall.name} with unreadable JSON arguments.`,
    );
  }
}

function readFunctionToolCalls(
  response: TailoredResumeResponse,
): TailoredResumeFunctionToolCall[] {
  return (response.output ?? []).flatMap((outputItem) => {
    if (
      outputItem.type !== "function_call" ||
      typeof outputItem.name !== "string" ||
      typeof outputItem.arguments !== "string"
    ) {
      return [];
    }

    return [
      {
        arguments: outputItem.arguments,
        callId:
          typeof outputItem.call_id === "string" ? outputItem.call_id : null,
        name: outputItem.name,
      },
    ];
  });
}

function serializeTailorResumeConversationToolCall(
  toolCall: TailoredResumeFunctionToolCall,
): TailorResumeConversationToolCall {
  let argumentsText = toolCall.arguments;

  try {
    argumentsText = JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
  } catch {
    // Keep the raw arguments when the model returned non-JSON tool data.
  }

  return {
    argumentsText,
    name: toolCall.name,
  };
}

export function parseTailorResumeInterviewResponseFromModelOutput(
  response: TailoredResumeResponse,
): ParsedTailorResumeInterviewModelOutput {
  const toolCalls = readFunctionToolCalls(response);
  const outputText = readOutputText(response);

  if (toolCalls.length !== 1) {
    throw new Error(
      outputText
        ? "The model returned text instead of exactly one interview tool call."
        : "The model did not call exactly one interview tool.",
    );
  }

  const toolCall = toolCalls[0]!;
  const argumentsJson = parseToolCallArguments(toolCall);
  const conversationToolCalls = [
    serializeTailorResumeConversationToolCall(toolCall),
  ];

  if (toolCall.name === "initiate_tailor_resume_probing_questions") {
    return {
      response: parseTailorResumeInterviewResponse({
        ...(argumentsJson && typeof argumentsJson === "object"
          ? argumentsJson
          : {}),
        action: "ask",
      }, outputText),
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
      }, outputText),
      toolCalls: conversationToolCalls,
    };
  }

  if (toolCall.name === "skip_tailor_resume_interview") {
    if (outputText) {
      throw new Error(
        "skip_tailor_resume_interview must not return user-facing assistant text.",
      );
    }

    const userMarkdownEditOperations =
      argumentsJson && typeof argumentsJson === "object"
        ? parseTailorResumeUserMarkdownEditOperations(
            "userMarkdownEditOperations" in argumentsJson
              ? argumentsJson.userMarkdownEditOperations
              : undefined,
          )
        : [];
    const nonTechnologyTerms =
      argumentsJson && typeof argumentsJson === "object"
        ? parseTailorResumeNonTechnologyTerms(
            "nonTechnologyTerms" in argumentsJson
              ? argumentsJson.nonTechnologyTerms
              : undefined,
          )
        : [];

    return {
      response: {
        action: "skip",
        assistantMessage: "",
        completionMessage: "",
        debugDecision: "not_applicable",
        keywordDecisions:
          argumentsJson && typeof argumentsJson === "object"
            ? parseTailorResumeKeywordDecisions(
                "keywordDecisions" in argumentsJson
                  ? argumentsJson.keywordDecisions
                  : undefined,
              )
            : [],
        learnings: [],
        nonTechnologyTerms,
        technologyContexts: [],
        userMarkdownEditOperations,
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
      }, outputText),
      toolCalls: conversationToolCalls,
    };
  }

  throw new Error(`The model called unknown interview tool ${toolCall.name}.`);
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

function buildMissingTechnologySkipRejectionFeedback(terms: string[]) {
  return [
    "Do not skip the first Step 2 interview turn.",
    `The deterministic keyword presence context says these important resume-searchable keywords are missing from both the original resume and USER.md: ${terms.join(", ")}.`,
    "Ask one grouped question using initiate_tailor_resume_probing_questions. Keep assistantMessage short: list the missing skills and ask whether any match the user's experience. Put each technology's definition and example resume bullets in technologyContexts, not in assistantMessage. Use two examples by default.",
    'Good assistantMessage shape: "Not mentioned in your resume or USER.md: Go, Cassandra, Spark.\\n\\nOpen any keyword below for a quick definition and two possible resume bullets. Do any of these match your experience? If so, which ones and where?"',
  ].join("\n");
}

function getFallbackTechnologyDefinition(term: string) {
  const normalizedTerm = term.toLowerCase();

  if (normalizedTerm === "go") {
    return "Go is a programming language often used for backend services, APIs, CLIs, and infrastructure tooling.";
  }

  if (normalizedTerm === "cassandra") {
    return "Cassandra is a distributed database for high-write, high-scale systems where data is spread across many machines.";
  }

  if (normalizedTerm === "spark") {
    return "Apache Spark helps you process large amounts of data by splitting it across computers in parallel; common for processing tons of logs, training ML models at scale.";
  }

  if (normalizedTerm === "elasticsearch") {
    return "Elasticsearch is a search and analytics engine commonly used for fast text search, log exploration, and indexed queries over large datasets.";
  }

  if (normalizedTerm === "gradle") {
    return "Gradle is a build tool often used for Java projects to compile code, manage dependencies, run tests, and wire builds into CI.";
  }

  if (normalizedTerm === "redux") {
    return "Redux is a state-management library usually used with React when an app has complex shared UI state or multi-step data flows.";
  }

  return `${term} is a job-relevant technology; look for projects where you used it directly or worked on the adjacent system it supports.`;
}

function getFallbackTechnologyExamples(term: string) {
  const normalizedTerm = term.toLowerCase();

  if (normalizedTerm === "go") {
    return [
      "Built Go API gateway to validate 20k requests/min and cut downstream service errors 35%.",
      "Wrote Go deployment tooling to reduce release prep from 45 minutes to 8 minutes across engineering teams.",
    ];
  }

  if (normalizedTerm === "cassandra") {
    return [
      "Migrated time-series data from MongoDB to Cassandra to reduce storage costs 40% and improve query tail latency by 2x.",
      "Redesigned Cassandra partition keys for event ingestion to sustain 12k writes/sec while cutting hot-partition retries 35%.",
    ];
  }

  if (normalizedTerm === "spark") {
    return [
      "Wrote Spark streaming pipeline to aggregate event streams for real-time metrics at 10k msg/sec with exactly-once semantics.",
      "Optimized Spark ETL jobs with partition pruning to cut nightly feature-generation runtime 45% and unblock morning model refreshes.",
    ];
  }

  if (normalizedTerm === "elasticsearch") {
    return [
      "Tuned Elasticsearch mappings and shard strategy to cut search p95 latency 48% across customer-facing analytics queries.",
      "Built Elasticsearch-backed log explorer to reduce incident triage time 30% with indexed filtering and saved queries.",
    ];
  }

  if (normalizedTerm === "gradle") {
    return [
      "Refactored Gradle build graph to cut Java CI time 38% while preserving test coverage across service modules.",
      "Wrote Gradle release tasks to standardize packaging and reduce manual deployment steps by 60%.",
    ];
  }

  if (normalizedTerm === "redux") {
    return [
      "Reworked Redux state slices to cut checkout UI defects 32% and simplify multi-step form recovery.",
      "Normalized Redux API cache state to reduce redundant network calls 45% and improve dashboard load time.",
    ];
  }

  return [
    `Applied ${term} to a production workflow to improve reliability, latency, or developer throughput with measurable impact.`,
    `Integrated ${term} into an existing system to reduce manual work and improve operational efficiency for the team.`,
  ];
}

function buildFallbackTailorResumeProbeQuestion(terms: string[]) {
  const selectedTerms = terms
    .slice(0, 6)
    .map(formatTailorResumeTermWithCapitalFirst);

  return [
    `Not mentioned in your resume or USER.md: ${selectedTerms.join(", ")}.`,
    "Open any keyword below for a quick definition and two possible resume bullets. Do any of these match your experience? If so, which ones and where?",
  ].join("\n");
}

export function buildFallbackTechnologyContexts(
  terms: string[],
): TailorResumeTechnologyContext[] {
  return terms.slice(0, 6).map((term) => {
    const displayTerm = formatTailorResumeTermWithCapitalFirst(term);
    const [firstExample, secondExample] =
      getFallbackTechnologyExamples(displayTerm);

    return {
      definition: getFallbackTechnologyDefinition(displayTerm),
      examples: [firstExample, secondExample],
      name: displayTerm,
    };
  });
}

function serializeConversation(messages: TailorResumeConversationMessage[]) {
  if (messages.length === 0) {
    return "[no conversation yet]";
  }

  return messages
    .map((message, index) => {
      const contextNames =
        message.technologyContexts && message.technologyContexts.length > 0
          ? `\n   technologyContexts: ${message.technologyContexts
              .map((context) => context.name)
              .join(", ")}`
          : "";

      return `${index + 1}. ${message.role}: ${message.text}${contextNames}`;
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
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumeInterviewSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      debugForceConversation: input.debugForceConversation,
      feedback: input.feedback,
    },
  );
}

function normalizeRenderedInterviewTextForComparison(value: string) {
  return value
    .toLowerCase()
    .replace(/[`*_#[\](){}>"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantMessageRepeatsTechnologyContext(input: {
  assistantMessage: string;
  technologyContext: TailorResumeTechnologyContext;
}) {
  const assistantText = normalizeRenderedInterviewTextForComparison(
    input.assistantMessage,
  );
  const copiedText = [
    input.technologyContext.definition,
    ...input.technologyContext.examples,
  ].find((cardText) => {
    const normalizedCardText =
      normalizeRenderedInterviewTextForComparison(cardText);

    return (
      normalizedCardText.length > 24 &&
      assistantText.includes(normalizedCardText)
    );
  });

  return Boolean(copiedText);
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

function mentionsUserMarkdown(text: string) {
  return /\buser\.md\b/i.test(text);
}

function readUserFacingInterviewText(response: TailorResumeInterviewResponse) {
  if (response.action === "done") {
    return response.completionMessage;
  }

  return response.assistantMessage;
}

function deriveTailorResumeQuestioningAgenda(input: {
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}) {
  const firstTopic = input.response.learnings
    .map((learning) => learning.topic.trim())
    .find(Boolean);

  return firstTopic ?? input.previousSummary?.agenda ?? "";
}

function validateTailorResumeInterviewResponse(input: {
  conversation: TailorResumeConversationMessage[];
  debugForceConversation: boolean;
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

  if (input.previousSummary) {
  } else if (input.response.action === "done") {
    throw new Error(
      "The model called finish_tailor_resume_interview before the interview started. Use skip_tailor_resume_interview when no first question is needed.",
    );
  }

  if (
    input.debugForceConversation &&
    !input.previousSummary &&
    input.response.action !== "ask"
  ) {
    throw new Error(
      "Debug mode requires at least one follow-up question on the first interview turn.",
    );
  }

  if (input.response.action === "skip") {
    if (input.previousSummary) {
      throw new Error(
        'The model cannot return action "skip" after the interview has already started.',
      );
    }

    if (input.response.assistantMessage) {
      throw new Error('Action "skip" must not return assistantMessage.');
    }

    if (input.response.completionMessage) {
      throw new Error('Action "skip" must not return completionMessage.');
    }

    if (input.response.debugDecision !== "not_applicable") {
      throw new Error('Action "skip" must use debugDecision "not_applicable".');
    }

    if (input.response.userMarkdownEditOperations.length > 0) {
      throw new Error('Action "skip" must not edit USER.md.');
    }

    if (input.response.keywordDecisions.length > 0) {
      throw new Error('Action "skip" must not change emphasized keywords.');
    }

    if (input.response.nonTechnologyTerms.length > 0) {
      throw new Error('Action "skip" must not update non-technology terms.');
    }

    return;
  }

  const knownTechnologyNames = new Set(
    input.emphasizedTechnologyNames.map((name) => name.trim().toLowerCase()),
  );

  for (const decision of input.response.keywordDecisions) {
    if (!knownTechnologyNames.has(decision.name.trim().toLowerCase())) {
      throw new Error(
        `Keyword decision "${decision.name}" must match an emphasized technology.`,
      );
    }

    if (
      decision.action === "remove" &&
      !latestUserMessageExplicitlyRejectsTechnology({
        messages: input.conversation,
        technologyName: decision.name,
      })
    ) {
      throw new Error(
        `Keyword decision "${decision.name}" can be removed only when the user explicitly rejects it as a bad or irrelevant keyword.`,
      );
    }
  }

  for (const nonTechnologyTerm of input.response.nonTechnologyTerms) {
    if (!knownTechnologyNames.has(nonTechnologyTerm.trim().toLowerCase())) {
      throw new Error(
        `Non-technology term "${nonTechnologyTerm}" must match an emphasized technology.`,
      );
    }

    if (
      !latestUserMessageExplicitlyRejectsTechnology({
        messages: input.conversation,
        technologyName: nonTechnologyTerm,
      })
    ) {
      throw new Error(
        `Non-technology term "${nonTechnologyTerm}" can be saved only when the user rejects it as not a real technology or skill.`,
      );
    }
  }

  if (input.response.action === "ask" && !input.response.assistantMessage) {
    throw new Error('Action "ask" must return user-facing assistant text.');
  }

  if (
    input.response.action === "ask" &&
    input.response.assistantMessage.split(/\s+/).filter(Boolean).length > 650
  ) {
    throw new Error(
      'Action "ask" must keep the user-facing message skimmable and under 650 words.',
    );
  }

  if (input.response.action === "ask" && input.response.completionMessage) {
    throw new Error('Action "ask" must not return completionMessage.');
  }

  if (input.response.action === "ask") {
    if (isNonQuestionAskMessage(input.response.assistantMessage)) {
      throw new Error(
        'Action "ask" must ask the user a real follow-up question. Use skip_tailor_resume_interview when no question is needed.',
      );
    }

    for (const technologyContext of input.response.technologyContexts) {
      const normalizedName = technologyContext.name.trim().toLowerCase();
      const isKnownTechnology = input.emphasizedTechnologyNames.some(
        (technologyName) => {
          const normalizedTechnologyName = technologyName.trim().toLowerCase();
          return (
            normalizedTechnologyName === normalizedName ||
            normalizedTechnologyName.includes(normalizedName) ||
            normalizedName.includes(normalizedTechnologyName)
          );
        },
      );

      if (!isKnownTechnology) {
        throw new Error(
          `Technology context "${technologyContext.name}" must match an emphasized technology being asked about.`,
        );
      }

      for (const example of technologyContext.examples) {
        if (
          technologyExampleEndsWithTechnologyName({
            example,
            technologyName: technologyContext.name,
          })
        ) {
          throw new Error(
            `Technology context "${technologyContext.name}" has an invalid example suffix. Text after a dash must be the resume company/project/experience name, not the technology name.`,
          );
        }

        if (!technologyExampleHasResultSignal(example)) {
          throw new Error(
            `Technology context "${technologyContext.name}" has a weak example bullet. Examples must be concise, FAANG-level bullet suggestions with the positive result in the same sentence.`,
          );
        }
      }

      if (
        assistantMessageRepeatsTechnologyContext({
          assistantMessage: input.response.assistantMessage,
          technologyContext,
        })
      ) {
        throw new Error(
          `Action "ask" must not repeat the rendered definition or example bullets for "${technologyContext.name}" in assistantMessage. Keep assistantMessage to the concise question because technologyContexts are already shown as visible cards.`,
        );
      }
    }
  }

  if (
    input.response.action === "ask" &&
    input.response.userMarkdownEditOperations.length > 0
  ) {
    if (!input.previousSummary) {
      throw new Error(
        'The first action "ask" turn must not edit USER.md before the user answers.',
      );
    }
  }

  if (
    input.response.action === "ask" &&
    !input.previousSummary &&
    input.response.keywordDecisions.length > 0
  ) {
    throw new Error(
      'The first action "ask" turn must not remove or confirm keywords before the user answers.',
    );
  }

  if (
    input.response.action === "ask" &&
    input.previousSummary &&
    latestUserMessageDirectlyConfirmsTechnologyExperience({
      messages: input.conversation,
      technologyNames: input.emphasizedTechnologyNames,
    })
  ) {
    throw new Error(
      "The latest user answer directly confirms technology experience. Use finish_tailor_resume_interview with per-technology USER.md notes instead of asking another placement or wording question.",
    );
  }

  if (input.response.action === "done" && !input.response.completionMessage) {
    throw new Error('Action "done" must return completionMessage.');
  }

  if (input.response.action === "done" && input.response.assistantMessage) {
    throw new Error('Action "done" must not return ask-stage assistant text.');
  }

  if (
    input.response.action === "done" &&
    latestUserMessageRequestsAssistantReply(input.conversation)
  ) {
    throw new Error(
      "The latest user answer asks for an assistant reply. Use initiate_tailor_resume_probing_questions, answer in assistant text, and include one confirmation or correction question instead of ending the interview.",
    );
  }

  if (input.response.action === "ask") {
    if (input.debugForceConversation) {
      if (
        input.response.debugDecision !== "forced_only" &&
        input.response.debugDecision !== "would_ask_without_debug"
      ) {
        throw new Error(
          'Debug-mode questions must set debugDecision to "would_ask_without_debug" or "forced_only".',
        );
      }
    } else if (input.response.debugDecision !== "not_applicable") {
      throw new Error(
        'Non-debug interview questions must set debugDecision to "not_applicable".',
      );
    }
  } else if (input.response.debugDecision !== "not_applicable") {
    throw new Error(
      `Action "${input.response.action}" must use debugDecision "not_applicable".`,
    );
  }

  if (
    input.response.userMarkdownEditOperations.length > 0 &&
    !mentionsUserMarkdown(readUserFacingInterviewText(input.response))
  ) {
    throw new Error(
      "When USER.md is edited, the user-facing message must explicitly mention USER.md.",
    );
  }

  if (
    input.response.nonTechnologyTerms.length > 0 &&
    !/\bnon[- ]?technolog/i.test(readUserFacingInterviewText(input.response))
  ) {
    throw new Error(
      "When non-technology terms are saved, the user-facing message must explicitly mention the non-technology list.",
    );
  }
}

function buildUserMarkdownPatchFailureFeedback(
  result: Extract<TailorResumeUserMarkdownPatchResult, { ok: false }>,
) {
  return [
    "Your USER.md edit operations could not be applied.",
    "The current USER.md is included again in the input. Retry with exact text from that document, use append if an exact restructure is unnecessary, and do not include placeholder text.",
    "",
    "Patch result:",
    JSON.stringify(
      {
        ok: result.ok,
        results: result.results,
      },
      null,
      2,
    ),
  ].join("\n");
}

export async function advanceTailorResumeQuestioning(input: {
  conversation: TailorResumeConversationMessage[];
  jobDescription: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
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
  let feedback = "";
  let lastError = "Unable to decide whether resume follow-up questions are needed.";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
      feedback,
      promptSettings: input.promptSettings,
    });
    const response = await runWithTransientModelRetries({
      operation: async () => {
        await input.onStreamEvent?.({ kind: "reset" });

        const streamer = new TailorResumeInterviewArgsStreamer();
        const stream = client.responses.stream({
          input: interviewInput,
          instructions,
          model,
          tool_choice: "required",
          tools: tailorResumeInterviewTools,
          text: {
            verbosity: "low",
          },
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

    try {
      const parsedModelOutput =
        parseTailorResumeInterviewResponseFromModelOutput(response);
      parsedResponse = normalizeTailorResumeInterviewResponseForCurrentTurn({
        previousSummary,
        response: parsedModelOutput.response,
      });
      parsedToolCalls = parsedModelOutput.toolCalls;
      validateTailorResumeInterviewResponse({
        conversation: input.conversation,
        debugForceConversation,
        emphasizedTechnologyNames: input.planningResult.emphasizedTechnologies.map(
          (technology) => technology.name,
        ),
        plannedSegmentIds,
        previousSummary,
        response: parsedResponse,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an invalid interview response.";
      feedback =
        `${lastError}\nCall exactly one valid interview tool. Put the concise user-facing reply in assistantMessage or completionMessage; those tool fields are rendered visibly in the chat. Do not repeat technologyContexts definitions or examples in assistantMessage or normal assistant text. Keep the interview short and focused, group first-turn technology questions together, keep learnings compact, and only call finish_tailor_resume_interview when you want the user to decide whether the chat should end.`;
      continue;
    }

    if (
      input.conversation.length === 0 &&
      parsedResponse.action === "skip" &&
      askWorthyMissingTerms.length > 0
    ) {
      lastError = buildMissingTechnologySkipRejectionFeedback(
        askWorthyMissingTerms,
      );
      feedback = lastError;
      continue;
    }

    let userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null = null;

    if (parsedResponse.userMarkdownEditOperations.length > 0) {
      userMarkdownPatchResult = applyTailorResumeUserMarkdownPatch(
        userMarkdown.markdown,
        parsedResponse.userMarkdownEditOperations,
      );

      if (!userMarkdownPatchResult.ok) {
        lastError = "The USER.md edit operations could not be applied.";
        feedback = buildUserMarkdownPatchFailureFeedback(userMarkdownPatchResult);
        continue;
      }
    }

    const nextUserMarkdown =
      userMarkdownPatchResult?.ok === true
        ? userMarkdownPatchResult.markdown
        : userMarkdown.markdown;
    const nextEmphasizedTechnologies =
      applyKeywordDecisionsToEmphasizedTechnologies({
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        keywordDecisions: parsedResponse.keywordDecisions,
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
      });
    const nextKeywordCoverage = buildTailorResumeKeywordCheckResult({
      emphasizedTechnologies: nextEmphasizedTechnologies.filter(
        (technology) => technology.priority === "high",
      ),
      text: `${input.planningSnapshot.resumePlainText}\n${nextUserMarkdown}`,
    });

    if (
      parsedResponse.action !== "ask" &&
      nextKeywordCoverage.missingHighPriority.length > 0
    ) {
      lastError = [
        "Step 2 must account for every remaining high-priority keyword in either the original resume or USER.md before it can finish or skip.",
        `Still missing after your proposed USER.md update: ${nextKeywordCoverage.missingHighPriority.join(", ")}`,
        "Ask another grouped follow-up question, update USER.md with the supported technologies, or explicitly remove a bad keyword only when the user rejects it as not a real requirement keyword.",
      ].join("\n");
      feedback = lastError;
      continue;
    }

    if (parsedResponse.action === "skip") {
      return {
        action: "skip",
        emphasizedTechnologies: nextEmphasizedTechnologies,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
        questioningSummary: null,
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

  if (input.conversation.length === 0 && askWorthyMissingTerms.length > 0) {
    const assistantMessage =
      buildFallbackTailorResumeProbeQuestion(askWorthyMissingTerms);
    const technologyContexts =
      buildFallbackTechnologyContexts(askWorthyMissingTerms);
    const fallbackToolCallArguments = {
      assistantMessage,
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts,
      userMarkdownEditOperations: [],
    };

    return {
      action: "ask",
      assistantMessage,
      emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      nonTechnologyTerms: [],
      questioningSummary: {
        agenda: `Ask whether the user has experience with ${askWorthyMissingTerms
          .slice(0, 6)
          .join(", ")} before writing final edits.`,
        askedQuestionCount: 1,
        debugDecision: null,
        learnings: [],
      },
      technologyContexts,
      toolCalls: [
        {
          argumentsText: JSON.stringify(fallbackToolCallArguments, null, 2),
          name: "initiate_tailor_resume_probing_questions",
        },
      ],
      userMarkdownPatchResult: null,
    };
  }

  throw new Error(lastError);
}
