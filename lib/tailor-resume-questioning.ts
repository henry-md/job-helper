import OpenAI from "openai";
import {
  buildTailorResumeInterviewSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import type {
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

const tailorResumeInterviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["ask", "done", "skip"],
    },
    agenda: { type: "string" },
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
      items: {
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
      },
    },
    question: { type: "string" },
    totalQuestionBudget: {
      type: "integer",
      minimum: 0,
      maximum: 5,
    },
  },
  required: [
    "action",
    "agenda",
    "debugDecision",
    "learnings",
    "question",
    "totalQuestionBudget",
  ],
} as const;

type TailorResumeInterviewResponse = {
  action: "ask" | "done" | "skip";
  agenda: string;
  debugDecision: TailorResumeInterviewDebugDecision;
  learnings: TailoredResumeQuestionLearning[];
  question: string;
  totalQuestionBudget: number;
};

export function normalizeTailorResumeInterviewResponseForCurrentTurn(input: {
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
}): TailorResumeInterviewResponse {
  if (
    input.previousSummary &&
    input.response.action === "skip"
  ) {
    return {
      ...input.response,
      action: "done",
    };
  }

  return input.response;
}

export type AdvanceTailorResumeQuestioningResult =
  | {
      action: "ask";
      generationDurationMs: number;
      question: string;
      questioningSummary: TailoredResumeQuestioningSummary;
    }
  | {
      action: "done" | "skip";
      generationDurationMs: number;
      questioningSummary: TailoredResumeQuestioningSummary | null;
    };

type TailoredResumeResponse = {
  model?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
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

function parseTailorResumeInterviewResponse(
  value: unknown,
): TailorResumeInterviewResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid interview response.");
  }

  const action =
    "action" in value &&
    (value.action === "ask" || value.action === "done" || value.action === "skip")
      ? value.action
      : null;
  const agenda = "agenda" in value ? readTrimmedString(value.agenda) : "";
  const debugDecision =
    "debugDecision" in value &&
    (value.debugDecision === "forced_only" ||
      value.debugDecision === "not_applicable" ||
      value.debugDecision === "would_ask_without_debug")
      ? value.debugDecision
      : null;
  const question = "question" in value ? readTrimmedString(value.question) : "";
  const totalQuestionBudget =
    "totalQuestionBudget" in value &&
    typeof value.totalQuestionBudget === "number" &&
    Number.isFinite(value.totalQuestionBudget)
      ? Math.max(0, Math.floor(value.totalQuestionBudget))
      : null;
  const rawLearnings = "learnings" in value ? value.learnings : null;

  if (
    !action ||
    !debugDecision ||
    totalQuestionBudget === null ||
    !Array.isArray(rawLearnings)
  ) {
    throw new Error("The model returned an incomplete interview response.");
  }

  return {
    action,
    agenda,
    debugDecision,
    learnings: rawLearnings.map(parseTailoredResumeQuestionLearning),
    question,
    totalQuestionBudget,
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
    `totalQuestionBudget: ${String(summary.totalQuestionBudget)}`,
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

function validateTailorResumeInterviewResponse(input: {
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
    if (
      input.response.totalQuestionBudget !==
      input.previousSummary.totalQuestionBudget
    ) {
      throw new Error(
        "The model changed the interview question budget after the conversation had already started.",
      );
    }
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

    if (input.response.totalQuestionBudget !== 0) {
      throw new Error(
        'Action "skip" must use totalQuestionBudget 0.',
      );
    }

    if (input.response.question) {
      throw new Error('Action "skip" must not return a question.');
    }

    if (input.response.debugDecision !== "not_applicable") {
      throw new Error('Action "skip" must use debugDecision "not_applicable".');
    }

    return;
  }

  if (!input.response.agenda) {
    throw new Error("The model returned an interview response without an agenda.");
  }

  if (input.response.totalQuestionBudget < 1 || input.response.totalQuestionBudget > 5) {
    throw new Error("The model returned an invalid interview question budget.");
  }

  if (input.response.action === "ask" && !input.response.question) {
    throw new Error('Action "ask" must return a question.');
  }

  if (input.response.action === "done" && input.response.question) {
    throw new Error('Action "done" must not return another question.');
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

  const previousQuestionCount = input.previousSummary?.askedQuestionCount ?? 0;
  const nextQuestionCount =
    input.response.action === "ask" ? previousQuestionCount + 1 : previousQuestionCount;

  if (nextQuestionCount > input.response.totalQuestionBudget) {
    throw new Error(
      "The model exceeded the declared interview question budget.",
    );
  }
}

export async function advanceTailorResumeQuestioning(input: {
  conversation: TailorResumeConversationMessage[];
  jobDescription: string;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot: TailorResumePlanningSnapshot;
  promptSettings?: SystemPromptSettings;
}): Promise<AdvanceTailorResumeQuestioningResult> {
  if (input.planningResult.changes.length === 0) {
    return {
      action: "skip",
      generationDurationMs: 0,
      questioningSummary: null,
    };
  }

  const startedAt = Date.now();
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
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "tailor_resume_interview_turn",
          strict: true,
          schema: tailorResumeInterviewSchema,
        },
      },
    });

    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty interview response.";
      feedback =
        'The previous response was empty. Return the full JSON object with action, agenda, totalQuestionBudget, question, learnings, and debugDecision.';
      continue;
    }

    let parsedResponse: TailorResumeInterviewResponse;

    try {
      parsedResponse = normalizeTailorResumeInterviewResponseForCurrentTurn({
        previousSummary,
        response: parseTailorResumeInterviewResponse(JSON.parse(outputText)),
      });
      validateTailorResumeInterviewResponse({
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
        `${lastError}\nReturn a valid JSON object. Keep the question budget stable once the interview has started, ask only one question at a time, keep learnings compact, and always include debugDecision.`;
      continue;
    }

    if (parsedResponse.action === "skip") {
      return {
        action: "skip",
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        questioningSummary: null,
      };
    }

    const questioningSummary: TailoredResumeQuestioningSummary = {
      agenda: parsedResponse.agenda,
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
      totalQuestionBudget:
        previousSummary?.totalQuestionBudget ?? parsedResponse.totalQuestionBudget,
    };

    if (parsedResponse.action === "ask") {
      return {
        action: "ask",
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        question: parsedResponse.question,
        questioningSummary,
      };
    }

    return {
      action: "done",
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      questioningSummary,
    };
  }

  throw new Error(lastError);
}
