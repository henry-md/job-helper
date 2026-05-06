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
        "Meaningfully different, FAANG-level one-sentence resume bullet suggestions that include the exact technology keyword, stay concise, and include the positive result in the same sentence. Return exactly two by default, but return the number the user explicitly asks for when they request more examples, up to six. Prefer action + technical scope + measurable impact, e.g. reduced cost 40%, improved latency 2x, processed 10k msg/sec. End every example with a dash suffix for the specific resume company/internship where the bullet could fit, such as `-- NewForm AI` or `-- Johns Hopkins University`. The suffix must come from the user's resume, never from the job posting, product name, team name, platform category, or technology keyword.",
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
    technologyContexts: {
      type: "array",
      description:
        "Structured technology explanations for the first technology experience question or for a user-requested examples turn. These entries are rendered visibly as collapsible UI cards under assistantMessage, so their definitions and examples must not be repeated in assistantMessage. Return an empty array on ordinary follow-up turns that save an answer or ask for one missing detail.",
      items: tailorResumeTechnologyContextSchema,
    },
  },
  required: ["assistantMessage", "technologyContexts"],
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

const generateTailorResumeTechnologyExamplesToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistantMessage: {
      type: "string",
      description:
        "A compact user-facing message asking which generated examples match the user's actual experience. Do not repeat definitions or example bullets here.",
    },
    technologyContexts: {
      type: "array",
      description:
        "Structured technology cards for the requested scraped technologies. Each card needs a concise definition and two concise, FAANG-level resume bullets with positive impact in the same sentence.",
      items: tailorResumeTechnologyContextSchema,
    },
  },
  required: ["assistantMessage", "technologyContexts"],
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
      "End an active tailoring interview after the useful learnings are complete so the app can save memory and continue tailoring immediately.",
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

const tailorResumeTechnologyExamplesTools = [
  {
    type: "function" as const,
    name: "generate_tailor_resume_technology_examples",
    description:
      "Generate concise Step 2 technology explanation cards and example resume bullets, then keep the chat open for the user to confirm which examples match their real experience.",
    parameters: generateTailorResumeTechnologyExamplesToolParameters,
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

  if (
    input.previousSummary &&
    response.action === "ask" &&
    response.technologyContexts.length > 0 &&
    !latestUserMessageRequestsTechnologyExamples(conversation)
  ) {
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

function resolveTailorResumeTechnologyExamplesOpeningModel() {
  return (
    process.env.OPENAI_TAILOR_RESUME_INTERVIEW_OPENING_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_INTERVIEW_EXAMPLES_OPENING_MODEL ??
    "gpt-4.1-nano"
  );
}

export async function generateTailorResumeTechnologyExamples(input: {
  jobDescription: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  openingMessage?: string;
  resumePlainText?: string;
  streamOpening?: boolean;
  technologies: TailoredResumeEmphasizedTechnology[];
}): Promise<{
  assistantMessage: string;
  generationDurationMs: number;
  technologyContexts: TailorResumeTechnologyContext[];
  toolCalls: TailorResumeConversationToolCall[];
}> {
  const startedAt = Date.now();
  const model =
    process.env.OPENAI_TAILOR_RESUME_INTERVIEW_EXAMPLES_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5-mini";
  const client = getOpenAIClient();
  const resumeExperienceNames = extractTailorResumeExperiencePlacementNames(
    input.resumePlainText ?? "",
  );
  const examplesInput = buildTailorResumeTechnologyExamplesInput({
    jobDescription: input.jobDescription,
    resumeExperienceNames,
    resumePlainText: input.resumePlainText ?? "",
    technologies: input.technologies,
  });
  let feedback = "";
  let lastError = "Unable to generate technology examples.";
  let openingMessage = input.openingMessage?.trim() ?? "";

  if (input.streamOpening !== false || !openingMessage) {
    try {
      openingMessage = await streamTailorResumeTechnologyExamplesOpeningQuestion({
        client,
        jobDescription: input.jobDescription,
        onStreamEvent: input.onStreamEvent,
        technologies: input.technologies,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to stream the opening technology examples question.";
      await input.onStepEvent?.({
        attempt: 1,
        detail: errorMessage,
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: input.technologies,
        retrying: false,
        status: "failed",
        stepCount: 5,
        stepNumber: 2,
        summary: "Generating technology examples",
      });
      throw error;
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const instructions = buildTailorResumeTechnologyExamplesInstructions(feedback);
    const response = await runWithTransientModelRetries({
      onRetry: async (retryEvent) => {
        await input.onStepEvent?.({
          attempt,
          detail:
            `The Step 2 examples request hit a transient model error (${retryEvent.message}). ` +
            `Retrying automatically (${retryEvent.nextAttempt}/${retryEvent.maxAttempts}).`,
          durationMs: Math.max(0, Date.now() - startedAt),
          emphasizedTechnologies: input.technologies,
          retrying: true,
          status: "failed",
          stepCount: 5,
          stepNumber: 2,
          summary: "Generating technology examples",
        });
      },
      operation: async () => {
        const streamer = new TailorResumeInterviewArgsStreamer();
        const reasoning = resolveTailorResumeInterviewReasoning(model);
        const stream = client.responses.stream({
          input: examplesInput,
          instructions,
          ...(reasoning ? { reasoning } : {}),
          ...buildLowVerbosityTextConfig(model),
          model,
          tool_choice: "required",
          tools: tailorResumeTechnologyExamplesTools,
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

    try {
      const parsed =
        parseTailorResumeTechnologyExamplesResponseFromModelOutput(response);
      validateTailorResumeTechnologyContexts({
        emphasizedTechnologyNames: input.technologies.map(
          (technology) => technology.name,
        ),
        resumeExperienceNames,
        technologyContexts: parsed.response.technologyContexts,
      });

      return {
        assistantMessage: openingMessage || parsed.response.assistantMessage,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        technologyContexts: parsed.response.technologyContexts,
        toolCalls: parsed.toolCalls,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned invalid technology examples.";
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: input.technologies,
        retrying: attempt < 2,
        status: "failed",
        stepCount: 5,
        stepNumber: 2,
        summary: "Generating technology examples",
      });
      feedback =
        `${lastError}\nCall exactly one valid examples tool. Keep assistantMessage short, put definitions/examples only in technologyContexts, and end every example bullet with a dash suffix naming one of the resume companies/internships provided in the input. Do not use job-posting product, team, platform, or technology names as suffixes.`;
    }
  }

  throw new Error(lastError);
}

export async function streamTailorResumeTechnologyExamplesOpeningQuestion(input: {
  client?: OpenAI;
  jobDescription?: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  technologies?: TailoredResumeEmphasizedTechnology[];
  technologyNames?: string[];
}) {
  await input.onStreamEvent?.({ kind: "reset" });

  const technologies =
    input.technologies ??
    buildTailorResumeEmphasizedTechnologiesFromNames(
      input.technologyNames ?? [],
    );
  const result = await streamTailorResumeTechnologyExamplesOpeningMessage({
    client: input.client ?? getOpenAIClient(),
    jobDescription: input.jobDescription ?? "",
    onStreamEvent: input.onStreamEvent,
    technologies,
  });

  return result.assistantMessage;
}

async function streamTailorResumeTechnologyExamplesOpeningMessage(input: {
  client: OpenAI;
  jobDescription: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  technologies: TailoredResumeEmphasizedTechnology[];
}) {
  const model = resolveTailorResumeTechnologyExamplesOpeningModel();
  const normalizedModel = model.trim().toLowerCase();

  if (!normalizedModel.startsWith("gpt-5")) {
    return streamTailorResumeTechnologyExamplesOpeningChatCompletion({
      ...input,
      model,
    });
  }

  const reasoning = resolveTailorResumeInterviewReasoning(model);
  const chunks: string[] = [];
  const stream = input.client.responses.stream({
    input: buildTailorResumeTechnologyExamplesOpeningInput(input),
    instructions: buildTailorResumeTechnologyExamplesOpeningInstructions(),
    max_output_tokens: 56,
    ...(reasoning ? { reasoning } : {}),
    ...buildLowVerbosityTextConfig(model),
    model,
  });
  const finalResponsePromise = stream.finalResponse();
  let textStarted = false;

  for await (const event of stream) {
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string" &&
      event.delta.length > 0
    ) {
      if (!textStarted) {
        textStarted = true;
        await input.onStreamEvent?.({
          field: "assistantMessage",
          kind: "text-start",
        });
      }

      chunks.push(event.delta);
      await input.onStreamEvent?.({
        delta: event.delta,
        field: "assistantMessage",
        kind: "text-delta",
      });
    }
  }

  const finalResponse = (await finalResponsePromise) as TailoredResumeResponse;
  const streamedText = chunks.join("").trim();
  const finalText = readOutputText(finalResponse) || streamedText;

  if (!finalText) {
    throw new Error("The opening examples question was empty.");
  }

  return {
    assistantMessage: finalText,
  };
}

async function streamTailorResumeTechnologyExamplesOpeningChatCompletion(input: {
  client: OpenAI;
  jobDescription: string;
  model: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  technologies: TailoredResumeEmphasizedTechnology[];
}) {
  const leadInText = "Which generated example bullets";

  await input.onStreamEvent?.({
    field: "assistantMessage",
    kind: "text-start",
  });
  await input.onStreamEvent?.({
    delta: leadInText,
    field: "assistantMessage",
    kind: "text-delta",
  });

  const continuation = await streamTailorResumeTechnologyExamplesOpeningChatText({
    client: input.client,
    maxTokens: 56,
    messages: [
      {
        content:
          "Continue the visible Step 2 question in 18-28 words. Do not repeat the existing prefix. Ask which bullets match actual experience and request technology names plus one-line specifics. No markdown.",
        role: "system",
      },
      {
        content:
          buildTailorResumeTechnologyExamplesOpeningPromptText(input) +
          `\nVisible prefix already shown: "${leadInText}". Continue after that prefix.`,
        role: "user",
      },
    ],
    model: input.model,
    onStreamEvent: input.onStreamEvent,
    stripLeadingText: leadInText,
    textStarted: true,
  });
  const finalText = `${leadInText} ${continuation.text}`
    .replace(/\s+/g, " ")
    .trim();

  if (!finalText) {
    throw new Error("The opening examples question was empty.");
  }

  return {
    assistantMessage: finalText,
  };
}

async function streamTailorResumeTechnologyExamplesOpeningChatText(input: {
  client: OpenAI;
  maxTokens: number;
  messages: Array<{ content: string; role: "system" | "user" }>;
  model: string;
  onStreamEvent?: (
    event: TailorResumeInterviewStreamEvent,
  ) => void | Promise<void>;
  stripLeadingText?: string;
  textStarted: boolean;
}) {
  const chunks: string[] = [];
  const stream = await input.client.chat.completions.create({
    max_tokens: input.maxTokens,
    messages: input.messages,
    model: input.model,
    stream: true,
    temperature: 0,
  });
  let textStarted = input.textStarted;
  let pendingStripText = "";
  let strippedLeadingText = !input.stripLeadingText;

  for await (const chunk of stream) {
    let delta = chunk.choices[0]?.delta?.content;

    if (!delta) {
      continue;
    }

    if (!strippedLeadingText && input.stripLeadingText) {
      pendingStripText += delta;

      if (
        normalizeOpeningPrefix(input.stripLeadingText).startsWith(
          normalizeOpeningPrefix(pendingStripText),
        ) &&
        normalizeOpeningPrefix(pendingStripText).length <
          normalizeOpeningPrefix(input.stripLeadingText).length
      ) {
        continue;
      }

      delta = stripOpeningPrefix(pendingStripText, input.stripLeadingText);
      pendingStripText = "";
      strippedLeadingText = true;

      if (!delta) {
        continue;
      }
    }

    if (!textStarted) {
      textStarted = true;
      await input.onStreamEvent?.({
        field: "assistantMessage",
        kind: "text-start",
      });
    }

    chunks.push(delta);
    await input.onStreamEvent?.({
      delta,
      field: "assistantMessage",
      kind: "text-delta",
    });
  }

  return {
    text: chunks.join("").trim(),
    textStarted,
  };
}

function normalizeOpeningPrefix(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripOpeningPrefix(value: string, prefix: string) {
  const escapedPrefix = prefix
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");

  return value.replace(new RegExp(`^\\s*${escapedPrefix}\\s*`, "i"), "");
}

function buildTailorResumeEmphasizedTechnologiesFromNames(
  technologyNames: string[],
): TailoredResumeEmphasizedTechnology[] {
  const seenTechnologyNames = new Set<string>();
  const technologies: TailoredResumeEmphasizedTechnology[] = [];

  for (const technologyName of technologyNames) {
    const name = formatTailorResumeTermWithCapitalFirst(technologyName.trim());
    const dedupeKey = name.toLowerCase();

    if (!name || seenTechnologyNames.has(dedupeKey)) {
      continue;
    }

    seenTechnologyNames.add(dedupeKey);
    technologies.push({
      evidence: "Scraped technology",
      name,
      priority: "high",
    });

    if (technologies.length >= 8) {
      break;
    }
  }

  return technologies;
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

function normalizeResumeExperiencePlacementName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeResumeExperiencePlacementKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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

function suffixMatchesResumeExperienceName(input: {
  resumeExperienceName: string;
  suffix: string;
}) {
  const normalizedSuffix = normalizeResumeExperiencePlacementKey(input.suffix);
  const normalizedName = normalizeResumeExperiencePlacementKey(
    input.resumeExperienceName,
  );

  if (!normalizedSuffix || !normalizedName) {
    return false;
  }

  return (
    normalizedSuffix === normalizedName ||
    (normalizedSuffix.length >= 4 && normalizedName.startsWith(normalizedSuffix)) ||
    (normalizedName.length >= 4 && normalizedSuffix.startsWith(normalizedName))
  );
}

function technologyExampleUsesResumeExperienceSuffix(input: {
  example: string;
  resumeExperienceNames: string[];
}) {
  const suffix = readTechnologyExampleDashSuffix(input.example);

  if (!suffix) {
    return false;
  }

  return input.resumeExperienceNames.some((resumeExperienceName) =>
    suffixMatchesResumeExperienceName({
      resumeExperienceName,
      suffix,
    }),
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

export function validateTailorResumeTechnologyContexts(input: {
  emphasizedTechnologyNames: string[];
  resumeExperienceNames?: string[];
  technologyContexts: TailorResumeTechnologyContext[];
}) {
  const resumeExperienceNames = input.resumeExperienceNames ?? [];

  for (const technologyContext of input.technologyContexts) {
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
          `Technology context "${technologyContext.name}" has an invalid example suffix. Text after a dash must be the resume company/internship name, not the technology name.`,
        );
      }

      if (
        resumeExperienceNames.length > 0 &&
        !technologyExampleUsesResumeExperienceSuffix({
          example,
          resumeExperienceNames,
        })
      ) {
        throw new Error(
          `Technology context "${technologyContext.name}" has an invalid example suffix. Every example must end with a dash suffix naming one of the user's resume companies/internships: ${resumeExperienceNames.join(", ")}. Do not use job-posting product, team, platform, project, or technology names.`,
        );
      }

      if (!technologyExampleHasResultSignal(example)) {
        throw new Error(
          `Technology context "${technologyContext.name}" has a weak example bullet. Examples must be concise, FAANG-level bullet suggestions with the positive result in the same sentence.`,
        );
      }
    }
  }
}

function readResumeExperienceSectionLines(resumePlainText: string) {
  const lines = resumePlainText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const experienceLines: string[] = [];
  let insideExperience = false;

  for (const line of lines) {
    if (/^(?:work\s+experience|professional\s+experience|experience)$/i.test(line)) {
      insideExperience = true;
      continue;
    }

    if (
      insideExperience &&
      /^(?:education|software\s+projects?|projects?|technical\s+skills?|skills?|awards?|publications?)$/i.test(
        line,
      )
    ) {
      break;
    }

    if (insideExperience) {
      experienceLines.push(line);
    }
  }

  return experienceLines.length > 0 ? experienceLines : lines;
}

// Extracts company/internship placement names that Step 2 examples can target.
export function extractTailorResumeExperiencePlacementNames(
  resumePlainText: string,
) {
  const seenNames = new Set<string>();
  const names: string[] = [];

  for (const line of readResumeExperienceSectionLines(resumePlainText)) {
    if (!line.includes("|")) {
      continue;
    }

    const [rawName] = line.split("|");
    const name = normalizeResumeExperiencePlacementName(rawName ?? "");

    if (
      !name ||
      name.length > 80 ||
      /^(?:courses?|awards?|languages?|technical|full-stack|other software)$/i.test(
        name,
      )
    ) {
      continue;
    }

    const key = normalizeResumeExperiencePlacementKey(name);

    if (!key || seenNames.has(key)) {
      continue;
    }

    seenNames.add(key);
    names.push(name);

    if (names.length >= 12) {
      break;
    }
  }

  return names;
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
        ? readRecordString(value, "completionMessage") || outputText
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

function parseTailorResumeTechnologyExamplesResponseFromModelOutput(
  response: TailoredResumeResponse,
) {
  const toolCalls = readFunctionToolCalls(response);

  if (toolCalls.length !== 1) {
    throw new Error("The model did not call exactly one examples tool.");
  }

  const toolCall = toolCalls[0]!;

  if (toolCall.name !== "generate_tailor_resume_technology_examples") {
    throw new Error(`The model called unknown examples tool ${toolCall.name}.`);
  }

  const value = parseToolCallArguments(toolCall);

  if (!value || typeof value !== "object") {
    throw new Error("The model returned invalid technology examples.");
  }

  const assistantMessage =
    "assistantMessage" in value
      ? readTrimmedString(value.assistantMessage)
      : "";
  const technologyContexts = parseTailorResumeTechnologyContexts(
    "technologyContexts" in value ? value.technologyContexts : undefined,
  );

  if (!assistantMessage || technologyContexts.length === 0) {
    throw new Error("The model returned incomplete technology examples.");
  }

  for (const technologyContext of technologyContexts) {
    if (
      assistantMessageRepeatsTechnologyContext({
        assistantMessage,
        technologyContext,
      })
    ) {
      throw new Error(
        `Examples assistantMessage must not repeat the rendered definition or example bullets for "${technologyContext.name}".`,
      );
    }
  }

  return {
    response: {
      assistantMessage,
      technologyContexts,
    },
    toolCalls: toolCalls.map(serializeTailorResumeConversationToolCall),
  };
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
        debugDecision: "not_applicable",
        keywordDecisions: [],
        learnings: [],
        nonTechnologyTerms: [],
        userMarkdownEditOperations: [],
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
        keywordDecisions: [],
        nonTechnologyTerms: [],
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
  resumeExperienceNames: string[] = [],
): TailorResumeTechnologyContext[] {
  return terms.slice(0, 6).map((term, index) => {
    const displayTerm = formatTailorResumeTermWithCapitalFirst(term);
    const [firstExample, secondExample] =
      getFallbackTechnologyExamples(displayTerm);
    const hasResumeExperienceNames = resumeExperienceNames.length > 0;
    const firstPlacement = hasResumeExperienceNames
      ? resumeExperienceNames[index % resumeExperienceNames.length]
      : undefined;
    const secondPlacement = hasResumeExperienceNames
      ? resumeExperienceNames[(index + 1) % resumeExperienceNames.length]
      : firstPlacement;

    return {
      definition: getFallbackTechnologyDefinition(displayTerm),
      examples: [
        appendTechnologyExamplePlacement(firstExample, firstPlacement),
        appendTechnologyExamplePlacement(secondExample, secondPlacement),
      ],
      name: displayTerm,
    };
  });
}

function appendTechnologyExamplePlacement(example: string, placement?: string) {
  const trimmedPlacement = placement?.trim();

  if (!trimmedPlacement) {
    return example;
  }

  const suffix = readTechnologyExampleDashSuffix(example);

  if (suffix) {
    return example.replace(/\s[-–—]\s*[^-–—]+$/, ` -- ${trimmedPlacement}`);
  }

  return `${example} -- ${trimmedPlacement}`;
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
            "Resume company/internship placement options for example suffixes:\n" +
            serializeResumeExperiencePlacementOptions(
              extractTailorResumeExperiencePlacementNames(
                input.planningSnapshot.resumePlainText,
              ),
            ),
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

function serializeResumeExperiencePlacementOptions(names: string[]) {
  if (names.length === 0) {
    return "[no company/internship options detected]";
  }

  return names.map((name, index) => `${index + 1}. ${name}`).join("\n");
}

function buildTailorResumeTechnologyExamplesInput(input: {
  jobDescription: string;
  resumeExperienceNames: string[];
  resumePlainText: string;
  technologies: TailoredResumeEmphasizedTechnology[];
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "Generate Step 2 resume example cards for these scraped technologies:\n" +
            serializeEmphasizedTechnologies(input.technologies.slice(0, 8)),
        },
        {
          type: "input_text" as const,
          text:
            "Resume company/internship placement options for example suffixes:\n" +
            serializeResumeExperiencePlacementOptions(input.resumeExperienceNames),
        },
        {
          type: "input_text" as const,
          text:
            "Original resume context, used only to choose which company/internship each example is for:\n" +
            (input.resumePlainText.trim()
              ? input.resumePlainText.slice(0, 8_000)
              : "[not available]"),
        },
        {
          type: "input_text" as const,
          text:
            "Job posting context, used only to keep examples relevant:\n" +
            input.jobDescription.slice(0, 8_000),
        },
      ],
    },
  ];
}

function buildTailorResumeTechnologyExamplesOpeningInput(input: {
  jobDescription: string;
  technologies: TailoredResumeEmphasizedTechnology[];
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: buildTailorResumeTechnologyExamplesOpeningPromptText(input),
        },
      ],
    },
  ];
}

function buildTailorResumeTechnologyExamplesOpeningPromptText(input: {
  technologies: TailoredResumeEmphasizedTechnology[];
}) {
  const names = input.technologies
    .slice(0, 8)
    .map((technology) => technology.name.trim())
    .filter(Boolean);

  return (
    "Write the one visible Step 2 chat question shown above generated resume example cards.\n" +
    `Technologies: ${names.join(", ") || "the scraped technologies"}.`
  );
}

function buildTailorResumeTechnologyExamplesOpeningInstructions() {
  return [
    "Write one concise user-facing Step 2 question in one paragraph of 25-35 words.",
    "Start with the word Which.",
    "Mention a few provided technology names naturally.",
    "Ask which generated example bullets match the user's actual experience.",
    "Ask for technology names plus one-line specifics about role, ownership, scale, metric, or outcome.",
    "Do not include definitions, bullet examples, markdown, or a standalone list of technologies.",
    "Do not say the examples are ready; they are still streaming below.",
  ].join("\n");
}

function buildTailorResumeTechnologyExamplesInstructions(feedback = "") {
  return [
    "You generate concise Step 2 resume-question examples for a browser extension.",
    "Call generate_tailor_resume_technology_examples exactly once.",
    "assistantMessage must be short and ask which examples match the user's actual experience.",
    "Do not repeat definitions or example bullets in assistantMessage because technologyContexts render them visibly.",
    "For each technology, return a plain-English definition and exactly two concise FAANG-level resume bullets.",
    "Every bullet must include action, technical scope, and a positive result in the same sentence, preferably with a metric.",
    "For every example bullet, choose one company/internship from the provided resume placement options and end the bullet with `-- <that exact option>`.",
    "The suffix says where the hypothetical bullet would go. Never use job-posting product, team, platform, project, technical-category, or technology names as suffixes.",
    "If relevance is uncertain, choose the closest resume company/internship anyway instead of inventing a product or project suffix.",
    "Do not invent that the user has this experience; these are examples for the user to accept or reject.",
    feedback ? `Previous invalid response feedback:\n${feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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

function readLatestUserMessageText(messages: TailorResumeConversationMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.text.trim() ?? ""
  );
}

function latestUserMessageRequestsTechnologyExamples(
  messages: TailorResumeConversationMessage[],
) {
  const text = readLatestUserMessageText(messages);

  return /\b(?:example|examples|sample|bullet|bullets|suggestion|suggestions|show me|give me|draft)\b/i.test(
    text,
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
  if (latestUserMessageRequestsTechnologyExamples(input.conversation)) {
    return false;
  }

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

function validateTailorResumeInterviewResponse(input: {
  conversation: TailorResumeConversationMessage[];
  debugForceConversation: boolean;
  emphasizedTechnologyNames: string[];
  plannedSegmentIds: Set<string>;
  previousSummary: TailoredResumeQuestioningSummary | null;
  response: TailorResumeInterviewResponse;
  resumeExperienceNames?: string[];
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
    if (
      tailorResumeAskMessageRequestsUserMarkdownPermission(
        input.response.assistantMessage,
      )
    ) {
      throw new Error(
        "Do not ask the user for permission to update USER.md. Step 2 exists to save durable memory from the user's answer. Call finish_tailor_resume_interview with USER.md edit operations now.",
      );
    }

    if (latestUserMessageRequestsInterviewEnd(input.conversation)) {
      throw new Error(
        "The user asked to proceed or finish. Do not ask another confirmation question; call finish_tailor_resume_interview with USER.md edit operations now.",
      );
    }

    if (isNonQuestionAskMessage(input.response.assistantMessage)) {
      throw new Error(
        'Action "ask" must ask the user a real follow-up question. Use skip_tailor_resume_interview when no question is needed.',
      );
    }

    validateTailorResumeTechnologyContexts({
      emphasizedTechnologyNames: input.emphasizedTechnologyNames,
      resumeExperienceNames: input.resumeExperienceNames,
      technologyContexts: input.response.technologyContexts,
    });

    for (const technologyContext of input.response.technologyContexts) {
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

  if (input.response.action === "done" && !input.response.completionMessage) {
    throw new Error('Action "done" must return completionMessage.');
  }

  if (input.response.action === "done" && input.response.assistantMessage) {
    throw new Error('Action "done" must not return ask-stage assistant text.');
  }

  if (
    input.response.action === "done" &&
    latestUserMessageRequestsAssistantReply(input.conversation) &&
    !latestUserMessageRequestsInterviewEnd(input.conversation)
  ) {
    throw new Error(
      "The latest user answer asks for an assistant reply. Use initiate_tailor_resume_probing_questions, answer in assistant text, and include one confirmation or correction question instead of ending the interview.",
    );
  }

  if (input.response.debugDecision !== "not_applicable") {
    throw new Error(
      `Action "${input.response.action}" must use debugDecision "not_applicable".`,
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
  const resumeExperienceNames = extractTailorResumeExperiencePlacementNames(
    input.planningSnapshot.resumePlainText,
  );
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

    try {
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
      validateTailorResumeInterviewResponse({
        conversation: input.conversation,
        debugForceConversation,
        emphasizedTechnologyNames: input.planningResult.emphasizedTechnologies.map(
          (technology) => technology.name,
        ),
        plannedSegmentIds,
        previousSummary,
        response: parsedResponse,
        resumeExperienceNames,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an invalid interview response.";
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        retrying: attempt < 2,
        status: "failed",
        stepCount: 5,
        stepNumber: 2,
        summary: "Continuing the follow-up questions",
      });
      feedback =
        `${lastError}\nCall exactly one valid interview tool. Use initiate_tailor_resume_probing_questions only for a real missing-detail question and optional technologyContexts cards. If you return example bullets, end every example with a dash suffix naming one of the resume companies/internships from the input; do not use job-posting product, team, platform, project, or technology names as suffixes. If the user supplied a paragraph, quoted bullets, no-experience notes, or skills-only constraints, do not ask permission to update USER.md; call finish_tailor_resume_interview with USER.md edit operations now. Use update_tailor_resume_non_technologies only for rejected keyword removals. Do not repeat technologyContexts definitions or examples in assistantMessage or normal assistant text. Keep the interview short and focused, group first-turn technology questions together, and call finish_tailor_resume_interview as soon as enough durable context is captured or the user asks to end.`;
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
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        retrying: attempt < 2,
        status: "failed",
        stepCount: 5,
        stepNumber: 2,
        summary: "Continuing the follow-up questions",
      });
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
        await input.onStepEvent?.({
          attempt,
          detail: lastError,
          durationMs: Math.max(0, Date.now() - startedAt),
          emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
          retrying: attempt < 2,
          status: "failed",
          stepCount: 5,
          stepNumber: 2,
          summary: "Continuing the follow-up questions",
        });
        feedback = buildUserMarkdownPatchFailureFeedback(userMarkdownPatchResult);
        continue;
      }
    }

    if (
      parsedResponse.action === "done" &&
      (!userMarkdownPatchResult || !userMarkdownPatchResult.changed) &&
      parsedResponse.nonTechnologyTerms.length === 0
    ) {
      lastError =
        "finish_tailor_resume_interview must save USER.md changes before Step 2 can end.";
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        retrying: attempt < 2,
        status: "failed",
        stepCount: 5,
        stepNumber: 2,
        summary: "Continuing the follow-up questions",
      });
      feedback =
        `${lastError}\nUse append operations to record every durable fact from the user's latest answer under technology-specific USER.md headings, then call finish_tailor_resume_interview. Do not finish with an empty userMarkdownEditOperations array when the user supplied experience, no-experience, or skills-only facts.`;
      continue;
    }

    const nextEmphasizedTechnologies =
      applyKeywordDecisionsToEmphasizedTechnologies({
        emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
        keywordDecisions: parsedResponse.keywordDecisions,
        nonTechnologyTerms: parsedResponse.nonTechnologyTerms,
      });

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
      buildFallbackTechnologyContexts(askWorthyMissingTerms, resumeExperienceNames);
    const fallbackToolCallArguments = {
      assistantMessage,
      technologyContexts,
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
