import { createHash } from "node:crypto";
import type {
  TailorResumeChatMessageRecord,
  TailorResumeChatRole,
  TailorResumeChatToolCallRecord,
} from "./tailor-resume-chat.ts";
import { getPrismaClient } from "./prisma.ts";
import type {
  TailorResumeProfile,
  TailoredResumeRecord,
  TailoredResumeVersionSnapshot,
} from "./tailor-resume-types.ts";
import { buildTailoredResumeReviewChatMessagesFromVersions } from "./tailored-resume-review-chat-history.ts";

const maxReviewChatHistoryMessagesForModel = 24;

export type TailoredResumeRecordWithReviewChat = TailoredResumeRecord & {
  reviewChatMessages: TailorResumeChatMessageRecord[];
};

export type TailorResumeProfileWithReviewChats = Omit<
  TailorResumeProfile,
  "tailoredResumes"
> & {
  tailoredResumes: TailoredResumeRecordWithReviewChat[];
};

function buildTailoredResumeReviewChatThreadKey(tailoredResumeId: string) {
  return `tailored-resume-review:${tailoredResumeId}`;
}

function buildTailoredResumeReviewChatPageTitle(displayName: string) {
  const trimmedDisplayName = displayName.trim();

  return trimmedDisplayName
    ? `Tailored resume review: ${trimmedDisplayName}`
    : "Tailored resume review";
}

function hashTailoredResumeReviewChatKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function readStoredToolCalls(value: unknown): TailorResumeChatToolCallRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const name = "name" in entry && typeof entry.name === "string"
      ? entry.name.trim()
      : "";
    const argumentsText =
      "argumentsText" in entry && typeof entry.argumentsText === "string"
        ? entry.argumentsText.trim()
        : "";
    const outputText =
      "outputText" in entry && typeof entry.outputText === "string"
        ? entry.outputText.trim()
        : "";

    if (!name || !argumentsText) {
      return [];
    }

    return [
      {
        argumentsText,
        name,
        ...(outputText ? { outputText } : {}),
      },
    ];
  });
}

function serializeStoredReviewChatMessage(message: {
  content: string;
  createdAt: Date;
  id: string;
  model: string | null;
  role: "ASSISTANT" | "USER";
  toolCalls: unknown;
}): TailorResumeChatMessageRecord {
  return {
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    model: message.model,
    role: message.role === "ASSISTANT" ? "assistant" : "user",
    toolCalls: readStoredToolCalls(message.toolCalls),
  };
}

export async function readTailoredResumeReviewChatMessages(input: {
  displayName: string;
  fallbackVersions: readonly TailoredResumeVersionSnapshot[];
  tailoredResumeId: string;
  userId: string;
}) {
  const key = buildTailoredResumeReviewChatThreadKey(input.tailoredResumeId);
  const prisma = getPrismaClient();
  const thread = await prisma.tailorResumeChatThread.findUnique({
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    where: {
      userId_urlHash: {
        urlHash: hashTailoredResumeReviewChatKey(key),
        userId: input.userId,
      },
    },
  });

  if (!thread) {
    return buildTailoredResumeReviewChatMessagesFromVersions(
      input.fallbackVersions,
    ).slice(-maxReviewChatHistoryMessagesForModel);
  }

  await prisma.tailorResumeChatThread.update({
    data: {
      pageTitle: buildTailoredResumeReviewChatPageTitle(input.displayName),
      url: key,
    },
    where: { id: thread.id },
  });

  return thread.messages
    .map((message) => serializeStoredReviewChatMessage(message))
    .slice(-maxReviewChatHistoryMessagesForModel);
}

export async function appendTailoredResumeReviewChatMessages(input: {
  assistantContent: string;
  displayName: string;
  model: string | null;
  tailoredResumeId: string;
  userContent: string;
  userId: string;
}) {
  const key = buildTailoredResumeReviewChatThreadKey(input.tailoredResumeId);
  const prisma = getPrismaClient();
  const thread = await prisma.tailorResumeChatThread.upsert({
    create: {
      pageTitle: buildTailoredResumeReviewChatPageTitle(input.displayName),
      url: key,
      urlHash: hashTailoredResumeReviewChatKey(key),
      userId: input.userId,
    },
    update: {
      pageTitle: buildTailoredResumeReviewChatPageTitle(input.displayName),
      url: key,
    },
    where: {
      userId_urlHash: {
        urlHash: hashTailoredResumeReviewChatKey(key),
        userId: input.userId,
      },
    },
  });
  const candidateMessages = [
    {
      content: input.userContent.trim(),
      model: null,
      role: "user",
    },
    {
      content: input.assistantContent.trim(),
      model: input.model,
      role: "assistant",
    },
  ] satisfies Array<{
    content: string;
    model: string | null;
    role: TailorResumeChatRole;
  }>;
  const messages = candidateMessages.filter((message) => message.content);

  if (messages.length === 0) {
    return [];
  }

  const createdMessages = await Promise.all(
    messages.map((message) =>
      prisma.tailorResumeChatMessage.create({
        data: {
          content: message.content,
          model: message.model,
          role: message.role === "assistant" ? "ASSISTANT" : "USER",
          threadId: thread.id,
          userId: input.userId,
        },
      }),
    ),
  );

  return createdMessages.map((message) =>
    serializeStoredReviewChatMessage(message),
  );
}

export async function deleteTailoredResumeReviewChat(input: {
  displayName: string;
  tailoredResumeId: string;
  userId: string;
}) {
  const key = buildTailoredResumeReviewChatThreadKey(input.tailoredResumeId);
  const urlHash = hashTailoredResumeReviewChatKey(key);
  const prisma = getPrismaClient();
  const thread = await prisma.tailorResumeChatThread.upsert({
    create: {
      pageTitle: buildTailoredResumeReviewChatPageTitle(input.displayName),
      url: key,
      urlHash,
      userId: input.userId,
    },
    update: {
      pageTitle: buildTailoredResumeReviewChatPageTitle(input.displayName),
      url: key,
    },
    where: {
      userId_urlHash: {
        urlHash,
        userId: input.userId,
      },
    },
  });

  await prisma.tailorResumeChatMessage.deleteMany({
    where: {
      threadId: thread.id,
      userId: input.userId,
    },
  });

  return {
    messages: [],
  };
}

export async function attachTailoredResumeReviewChatsToProfile(input: {
  profile: TailorResumeProfile;
  userId: string;
}): Promise<TailorResumeProfileWithReviewChats> {
  const tailoredResumes = await Promise.all(
    input.profile.tailoredResumes.map(async (record) => ({
      ...record,
      reviewChatMessages: await readTailoredResumeReviewChatMessages({
        displayName: record.displayName,
        fallbackVersions: record.versions,
        tailoredResumeId: record.id,
        userId: input.userId,
      }),
    })),
  );

  return {
    ...input.profile,
    tailoredResumes,
  };
}
