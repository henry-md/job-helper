import type {
  TailorResumeConversationMessage,
  TailorResumeGenerationStepSummary,
  TailorResumePendingInterviewSummary,
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
  message: Pick<TailorResumeConversationMessage, "text">,
) {
  return message.text.length > 0;
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

  return message;
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
