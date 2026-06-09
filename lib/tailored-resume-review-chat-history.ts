import type { TailorResumeChatMessageRecord } from "./tailor-resume-chat.ts";
import type { TailoredResumeVersionSnapshot } from "./tailor-resume-types.ts";

export function buildTailoredResumeReviewChatMessagesFromVersions(
  versions: readonly TailoredResumeVersionSnapshot[],
) {
  const messages: TailorResumeChatMessageRecord[] = [];

  for (const version of versions) {
    if (version.source !== "refinement") {
      continue;
    }

    if (version.userPrompt?.trim()) {
      messages.push({
        content: version.userPrompt.trim(),
        createdAt: version.createdAt,
        id: `${version.id}:user`,
        model: null,
        role: "user",
        toolCalls: [],
      });
    }

    if (version.assistantMessage?.trim()) {
      messages.push({
        content: version.assistantMessage.trim(),
        createdAt: version.createdAt,
        id: `${version.id}:assistant`,
        model: null,
        role: "assistant",
        toolCalls: [],
      });
    }
  }

  return messages;
}
