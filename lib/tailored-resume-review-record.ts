import {
  parseTailoredResumeOpenAiDebugTrace,
  type TailoredResumeBlockEditRecord,
  type TailoredResumeOpenAiDebugTrace,
  type TailoredResumeRecord,
  type TailoredResumeVersionSnapshot,
} from "./tailor-resume-types.ts";
import type { TailorResumeChatToolCallRecord } from "./tailor-resume-chat.ts";

export type TailoredResumeReviewEdit = Pick<
  TailoredResumeBlockEditRecord,
  | "afterLatexCode"
  | "beforeLatexCode"
  | "command"
  | "customLatexCode"
  | "editId"
  | "generatedByStep"
  | "reason"
  | "source"
  | "segmentId"
  | "state"
>;

export type TailoredResumeReviewRecord = Pick<
  TailoredResumeRecord,
  "displayName" | "error" | "id" | "openAiDebug" | "pdfUpdatedAt" | "updatedAt"
> & {
  annotatedLatexCode: string | null;
  companyName: string | null;
  edits: TailoredResumeReviewEdit[];
  positionTitle: string | null;
  reviewChatMessages: TailoredResumeReviewChatMessage[];
  sourceAnnotatedLatexCode: string | null;
  versions: TailoredResumeReviewVersion[];
};

export type TailoredResumeReviewVersion = Pick<
  TailoredResumeVersionSnapshot,
  | "annotatedLatexCode"
  | "assistantMessage"
  | "createdAt"
  | "id"
  | "pdfUpdatedAt"
  | "source"
  | "userPrompt"
> & {
  editCount: number;
};

export type TailoredResumeReviewChatMessage = {
  content: string;
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  toolCalls: TailorResumeChatToolCallRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown) {
  const stringValue = readString(value);
  return stringValue || null;
}

function readNullableRawString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readTailoredResumeReviewToolCall(
  value: unknown,
): TailorResumeChatToolCallRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);
  const argumentsText = readString(value.argumentsText);
  const outputText = readString(value.outputText);

  if (!name || !argumentsText) {
    return null;
  }

  return {
    argumentsText,
    name,
    ...(outputText ? { outputText } : {}),
  };
}

function readTailoredResumeReviewToolCalls(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeChatToolCallRecord[];
  }

  return value
    .map(readTailoredResumeReviewToolCall)
    .filter((toolCall): toolCall is TailorResumeChatToolCallRecord =>
      Boolean(toolCall),
    );
}

function buildFallbackOpenAiDebugTrace(): TailoredResumeOpenAiDebugTrace {
  return {
    implementation: {
      outputJson: null,
      prompt: null,
      skippedReason: "No saved Step 4 implementation debug trace is available.",
    },
    keywordExtraction: {
      outputJson: null,
      prompt: null,
      skippedReason: "No saved Step 1 keyword extraction debug trace is available.",
    },
    keywordReview: {
      outputJson: null,
      prompt: null,
      skippedReason: "No saved Step 2 keyword review debug trace is available.",
    },
    planning: {
      outputJson: null,
      prompt: null,
      skippedReason: "No saved Step 3 planning debug trace is available.",
    },
  };
}

function readTailoredResumeReviewEdit(
  value: unknown,
): TailoredResumeReviewEdit | null {
  if (!isRecord(value)) {
    return null;
  }

  const afterLatexCode =
    typeof value.afterLatexCode === "string" ? value.afterLatexCode : null;
  const beforeLatexCode =
    typeof value.beforeLatexCode === "string" ? value.beforeLatexCode : null;
  const customLatexCode =
    typeof value.customLatexCode === "string" ? value.customLatexCode : null;
  const command = typeof value.command === "string" ? value.command : null;
  const editId = readString(value.editId);
  const reason = readString(value.reason);
  const segmentId = readString(value.segmentId);
  const source = value.source === "user" ? "user" : "model";
  const generatedByStep = value.generatedByStep === 5 ? 5 : value.generatedByStep === 4 ? 4 : null;
  const state =
    value.state === "rejected"
      ? "rejected"
      : value.state === "applied"
        ? "applied"
        : null;

  if (
    !afterLatexCode ||
    beforeLatexCode === null ||
    !editId ||
    generatedByStep === null ||
    !reason ||
    !segmentId ||
    state === null
  ) {
    return null;
  }

  return {
    afterLatexCode,
    beforeLatexCode,
    command,
    customLatexCode,
    editId,
    generatedByStep,
    reason,
    source,
    segmentId,
    state,
  };
}

function readTailoredResumeReviewVersion(
  value: unknown,
): TailoredResumeReviewVersion | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const annotatedLatexCode = readNullableRawString(value.annotatedLatexCode);
  const createdAt = readString(value.createdAt);

  if (!id || !annotatedLatexCode || !createdAt) {
    return null;
  }

  return {
    annotatedLatexCode,
    assistantMessage: readNullableString(value.assistantMessage),
    createdAt,
    editCount: Array.isArray(value.edits) ? value.edits.length : 0,
    id,
    pdfUpdatedAt: readNullableString(value.pdfUpdatedAt),
    source: value.source === "initial" ? "initial" : "refinement",
    userPrompt: readNullableString(value.userPrompt),
  };
}

function readTailoredResumeReviewChatMessage(
  value: unknown,
): TailoredResumeReviewChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const content = readString(value.content);
  const createdAt = readString(value.createdAt);
  const role =
    value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;

  if (!id || !content || !createdAt || !role) {
    return null;
  }

  return {
    content,
    createdAt,
    id,
    role,
    toolCalls: readTailoredResumeReviewToolCalls(value.toolCalls),
  };
}

export function readTailoredResumeReviewRecord(
  value: unknown,
): TailoredResumeReviewRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const displayName = readString(value.displayName);
  const updatedAt = readString(value.updatedAt);
  const openAiDebug =
    parseTailoredResumeOpenAiDebugTrace(value.openAiDebug) ??
    buildFallbackOpenAiDebugTrace();
  const edits = Array.isArray(value.edits)
    ? value.edits
        .map(readTailoredResumeReviewEdit)
        .filter((edit): edit is TailoredResumeReviewEdit => Boolean(edit))
    : [];
  const versions = Array.isArray(value.versions)
    ? value.versions
        .map(readTailoredResumeReviewVersion)
        .filter((version): version is TailoredResumeReviewVersion =>
          Boolean(version),
        )
    : [];
  const reviewChatMessages = Array.isArray(value.reviewChatMessages)
    ? value.reviewChatMessages
        .map(readTailoredResumeReviewChatMessage)
        .filter((message): message is TailoredResumeReviewChatMessage =>
          Boolean(message),
        )
    : [];

  if (!id || !displayName || !updatedAt) {
    return null;
  }

  return {
    annotatedLatexCode: readNullableRawString(value.annotatedLatexCode),
    companyName: readNullableString(value.companyName),
    displayName,
    edits,
    error: readNullableString(value.error),
    id,
    openAiDebug,
    pdfUpdatedAt: readNullableString(value.pdfUpdatedAt),
    positionTitle: readNullableString(value.positionTitle),
    reviewChatMessages,
    sourceAnnotatedLatexCode: readNullableRawString(value.sourceAnnotatedLatexCode),
    updatedAt,
    versions,
  };
}

export function readTailoredResumeReviewRecords(value: unknown) {
  const tailoredResumes = Array.isArray(value)
    ? value
    : isRecord(value) &&
        isRecord(value.profile) &&
        Array.isArray(value.profile.tailoredResumes)
      ? value.profile.tailoredResumes
      : [];

  return tailoredResumes
    .map(readTailoredResumeReviewRecord)
    .filter((record): record is TailoredResumeReviewRecord => Boolean(record))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function resolveTailoredResumeReviewRecordFromPayload(
  payload: unknown,
  tailoredResumeId: string | null | undefined,
) {
  const normalizedTailoredResumeId = tailoredResumeId?.trim();
  const tailoredResumes = readTailoredResumeReviewRecords(payload);

  if (normalizedTailoredResumeId) {
    return (
      tailoredResumes.find((record) => record.id === normalizedTailoredResumeId) ??
      null
    );
  }

  return tailoredResumes[0] ?? null;
}
