import type {
  TailorResumeConversationMessage,
  TailorResumeGenerationStepSummary,
  TailorResumePendingInterviewSummary,
  TailorResumeTechnologyContext,
} from "./job-helper";
import type { TailorResumeInterviewStreamEvent } from "./tailor-resume-stream";

export function isTailorResumeInterviewEndStepEvent(
  stepEvent: TailorResumeGenerationStepSummary,
) {
  return (
    stepEvent.stepNumber === 2 &&
    stepEvent.status === "succeeded" &&
    stepEvent.retrying !== true
  );
}

function cloneTailorInterviewMessage(
  message: TailorResumeConversationMessage,
): TailorResumeConversationMessage {
  return {
    ...message,
    technologyContexts: message.technologyContexts.map((context) => ({
      ...context,
      examples: [...context.examples],
    })),
    toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })),
  };
}

export function hasTailorInterviewStreamedMessageContent(
  message: Pick<TailorResumeConversationMessage, "technologyContexts" | "text">,
) {
  return (
    message.text.length > 0 ||
    message.technologyContexts.length > 0
  );
}

export function applyTailorInterviewStreamEventToMessage(
  message: TailorResumeConversationMessage,
  event: TailorResumeInterviewStreamEvent,
): TailorResumeConversationMessage {
  if (event.kind === "reset" || event.kind === "text-start") {
    return message;
  }

  if (event.kind === "text-delta") {
    return {
      ...message,
      text: `${message.text}${event.delta}`,
    };
  }

  return {
    ...message,
    technologyContexts: [...message.technologyContexts, event.card],
  };
}

function normalizeTechnologyContextName(context: TailorResumeTechnologyContext) {
  return context.name.trim().toLowerCase();
}

function mergeTechnologyContextExamples(
  firstExamples: readonly string[],
  secondExamples: readonly string[],
) {
  const seenExamples = new Set<string>();
  const examples: string[] = [];

  for (const example of [...firstExamples, ...secondExamples]) {
    const normalizedExample = example.trim().replace(/\s+/g, " ").toLowerCase();

    if (!normalizedExample || seenExamples.has(normalizedExample)) {
      continue;
    }

    seenExamples.add(normalizedExample);
    examples.push(example);
  }

  return examples;
}

function mergeTechnologyContextDefinition(
  baseDefinition: string,
  streamedDefinition: string,
) {
  if (!streamedDefinition) {
    return baseDefinition;
  }

  if (!baseDefinition) {
    return streamedDefinition;
  }

  if (
    baseDefinition === streamedDefinition ||
    baseDefinition.includes(streamedDefinition)
  ) {
    return baseDefinition;
  }

  if (streamedDefinition.includes(baseDefinition)) {
    return streamedDefinition;
  }

  return `${baseDefinition}\n\n${streamedDefinition}`;
}

function mergeTechnologyContext(
  baseContext: TailorResumeTechnologyContext,
  streamedContext: TailorResumeTechnologyContext,
): TailorResumeTechnologyContext {
  return {
    definition: mergeTechnologyContextDefinition(
      baseContext.definition,
      streamedContext.definition,
    ),
    examples: mergeTechnologyContextExamples(
      baseContext.examples,
      streamedContext.examples,
    ),
    name: baseContext.name || streamedContext.name,
  };
}

function mergeTechnologyContexts(
  baseContexts: readonly TailorResumeTechnologyContext[],
  streamedContexts: readonly TailorResumeTechnologyContext[],
) {
  const contexts = baseContexts.map((context) => ({
    ...context,
    examples: [...context.examples],
  }));
  const indexesByName = new Map<string, number>();

  contexts.forEach((context, index) => {
    const name = normalizeTechnologyContextName(context);

    if (name && !indexesByName.has(name)) {
      indexesByName.set(name, index);
    }
  });

  for (const streamedContext of streamedContexts) {
    const name = normalizeTechnologyContextName(streamedContext);
    const existingIndex = indexesByName.get(name);

    if (!name || existingIndex === undefined) {
      contexts.push({
        ...streamedContext,
        examples: [...streamedContext.examples],
      });

      if (name) {
        indexesByName.set(name, contexts.length - 1);
      }

      continue;
    }

    contexts[existingIndex] = mergeTechnologyContext(
      contexts[existingIndex]!,
      streamedContext,
    );
  }

  return contexts;
}

function mergeStreamedText(baseText: string, streamedText: string) {
  if (!streamedText) {
    return baseText;
  }

  if (!baseText) {
    return streamedText;
  }

  if (baseText.startsWith(streamedText) || baseText.includes(streamedText.trim())) {
    return baseText;
  }

  if (streamedText.startsWith(baseText)) {
    return streamedText;
  }

  return `${streamedText.trimEnd()}\n\n${baseText}`;
}

export function mergeTailorInterviewMessageWithStreamedContent(
  message: TailorResumeConversationMessage,
  streamedMessage: TailorResumeConversationMessage,
): TailorResumeConversationMessage {
  if (!hasTailorInterviewStreamedMessageContent(streamedMessage)) {
    return message;
  }

  return {
    ...message,
    technologyContexts: mergeTechnologyContexts(
      message.technologyContexts,
      streamedMessage.technologyContexts,
    ),
    text: mergeStreamedText(message.text, streamedMessage.text),
  };
}

export function mergeTailorInterviewWithStreamedAssistantMessage(
  interview: TailorResumePendingInterviewSummary | null,
  streamedMessage: TailorResumeConversationMessage,
) {
  if (!interview || !hasTailorInterviewStreamedMessageContent(streamedMessage)) {
    return interview;
  }

  const nextConversation = interview.conversation.map(cloneTailorInterviewMessage);
  const assistantIndex = [...nextConversation]
    .reverse()
    .findIndex((message) => message.role === "assistant");

  if (assistantIndex === -1) {
    return {
      ...interview,
      conversation: [...nextConversation, cloneTailorInterviewMessage(streamedMessage)],
    };
  }

  const targetIndex = nextConversation.length - 1 - assistantIndex;
  nextConversation[targetIndex] = mergeTailorInterviewMessageWithStreamedContent(
    nextConversation[targetIndex]!,
    streamedMessage,
  );

  return {
    ...interview,
    conversation: nextConversation,
  };
}
