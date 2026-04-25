import OpenAI from "openai";
import {
  buildTailorResumeInterviewSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import type {
  TailorResumeConversationToolCall,
  TailorResumeConversationMessage,
  TailorResumeInterviewDebugDecision,
  TailoredResumePlanningResult,
  TailoredResumeQuestionLearning,
  TailoredResumeQuestioningSummary,
} from "./tailor-resume-types.ts";
import type {
  TailorResumePlanningBlock,
  TailorResumePlanningSnapshot,
} from "./tailor-resume-planning.ts";
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

const askTailorResumeFollowUpToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
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
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: ["debugDecision", "learnings", "userMarkdownEditOperations"],
} as const;

const finishTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    learnings: {
      type: "array",
      items: tailorResumeInterviewLearningSchema,
    },
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: ["learnings", "userMarkdownEditOperations"],
} as const;

const skipTailorResumeInterviewToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: { type: "string" },
    userMarkdownEditOperations: {
      type: "array",
      items: tailorResumeUserMarkdownEditOperationSchema,
    },
  },
  required: ["reason", "userMarkdownEditOperations"],
} as const;

const tailorResumeInterviewTools = [
  {
    type: "function" as const,
    name: "ask_tailor_resume_follow_up",
    description:
      "Ask exactly one additional user-facing follow-up question and keep the tailoring interview open.",
    parameters: askTailorResumeFollowUpToolParameters,
    strict: true,
  },
  {
    type: "function" as const,
    name: "finish_tailor_resume_interview",
    description:
      "Explicitly end an active tailoring interview after the useful learnings are complete.",
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
];

type TailorResumeInterviewResponse = {
  action: "ask" | "done" | "skip";
  assistantMessage: string;
  completionMessage: string;
  debugDecision: TailorResumeInterviewDebugDecision;
  learnings: TailoredResumeQuestionLearning[];
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
      questioningSummary: TailoredResumeQuestioningSummary;
      toolCalls: TailorResumeConversationToolCall[];
      userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null;
    }
  | {
      action: "done";
      completionMessage: string;
      generationDurationMs: number;
      questioningSummary: TailoredResumeQuestioningSummary | null;
      toolCalls: TailorResumeConversationToolCall[];
      userMarkdownPatchResult: TailorResumeUserMarkdownPatchResult | null;
    }
  | {
      action: "skip";
      generationDurationMs: number;
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
  const userMarkdownEditOperations = parseTailorResumeUserMarkdownEditOperations(
    "userMarkdownEditOperations" in value
      ? value.userMarkdownEditOperations
      : undefined,
  );

  if (!action || !debugDecision || !Array.isArray(rawLearnings)) {
    throw new Error("The model returned an incomplete interview response.");
  }

  return {
    action,
    assistantMessage: action === "ask" ? outputText : "",
    completionMessage: action === "done" ? outputText : "",
    debugDecision,
    learnings: rawLearnings.map(parseTailoredResumeQuestionLearning),
    userMarkdownEditOperations,
  };
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

  if (toolCall.name === "ask_tailor_resume_follow_up") {
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

    return {
      response: {
        action: "skip",
        assistantMessage: "",
        completionMessage: "",
        debugDecision: "not_applicable",
        learnings: [],
        userMarkdownEditOperations,
      },
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
        `   desired text: ${change.desiredPlainText || "[remove this block]"}`,
        `   reason: ${change.reason.trim()}`,
      ].join("\n");
    })
    .join("\n\n");
}

function serializeConversation(messages: TailorResumeConversationMessage[]) {
  if (messages.length === 0) {
    return "[no conversation yet]";
  }

  return messages
    .map((message, index) => `${index + 1}. ${message.role}: ${message.text}`)
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
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
  userMarkdown: TailorResumeUserMarkdownState;
}) {
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
            "Accepted tailoring thesis:\n" +
            `jobDescriptionFocus: ${input.planningResult.thesis.jobDescriptionFocus}\n` +
            `resumeChanges: ${input.planningResult.thesis.resumeChanges}`,
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
            "Planned block edits:\n" +
            serializePlannedBlocks({
              planningBlocksById: input.planningBlocksById,
              planningResult: input.planningResult,
            }),
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
  plannedSegmentIds: Set<string>;
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}) {
  for (const learning of input.response.learnings) {
    const seenSegmentIds = new Set<string>();

    for (const segmentId of learning.targetSegmentIds) {
      if (seenSegmentIds.has(segmentId)) {
        throw new Error(
          `The model returned duplicate targetSegmentIds for learning "${learning.topic}".`,
        );
      }

      if (!input.plannedSegmentIds.has(segmentId)) {
        throw new Error(
          `The model returned an interview learning for unknown segment ${segmentId}.`,
        );
      }

      seenSegmentIds.add(segmentId);
    }
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

    return;
  }

  if (input.response.action === "ask" && !input.response.assistantMessage) {
    throw new Error('Action "ask" must return user-facing assistant text.');
  }

  if (input.response.action === "ask" && input.response.completionMessage) {
    throw new Error('Action "ask" must not return completionMessage.');
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
      "The latest user answer asks for an assistant reply. Use ask_tailor_resume_follow_up, answer in assistant text, and include one confirmation or correction question instead of ending the interview.",
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
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
  promptSettings?: SystemPromptSettings;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<AdvanceTailorResumeQuestioningResult> {
  if (input.planningResult.changes.length === 0) {
    return {
      action: "skip",
      generationDurationMs: 0,
      questioningSummary: null,
      userMarkdownPatchResult: null,
    };
  }

  const startedAt = Date.now();
  const userMarkdown = input.userMarkdown ?? {
    markdown: defaultTailorResumeUserMarkdown,
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
  let feedback = "";
  let lastError = "Unable to decide whether resume follow-up questions are needed.";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const interviewInput = buildTailorResumeInterviewInput({
      conversation: input.conversation,
      jobDescription: input.jobDescription,
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
    const response = await client.responses.create({
      input: interviewInput,
      instructions,
      model,
      tool_choice: "required",
      tools: tailorResumeInterviewTools,
      text: {
        verbosity: "low",
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
        `${lastError}\nCall exactly one valid interview tool. Put the user-facing assistant reply in normal assistant text instead of tool arguments. Keep the interview short and focused, ask only one question at a time, keep learnings compact, and only call finish_tailor_resume_interview when you intentionally want the chat to end.`;
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

    if (parsedResponse.action === "skip") {
      return {
        action: "skip",
        generationDurationMs: Math.max(0, Date.now() - startedAt),
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
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        questioningSummary,
        toolCalls: parsedToolCalls,
        userMarkdownPatchResult,
      };
    }

    return {
      action: "done",
      completionMessage: parsedResponse.completionMessage,
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      questioningSummary,
      toolCalls: parsedToolCalls,
      userMarkdownPatchResult,
    };
  }

  throw new Error(lastError);
}
