import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeRecord,
} from "./tailor-resume-types.ts";

export type TailoredResumeReviewEdit = Pick<
  TailoredResumeBlockEditRecord,
  | "afterLatexCode"
  | "beforeLatexCode"
  | "command"
  | "customLatexCode"
  | "editId"
  | "generatedByStep"
  | "reason"
  | "segmentId"
  | "state"
>;

export type TailoredResumeReviewRecord = Pick<
  TailoredResumeRecord,
  "displayName" | "error" | "id" | "pdfUpdatedAt" | "updatedAt"
> & {
  annotatedLatexCode: string | null;
  companyName: string | null;
  edits: TailoredResumeReviewEdit[];
  positionTitle: string | null;
  sourceAnnotatedLatexCode: string | null;
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
  const generatedByStep = value.generatedByStep === 4 ? 4 : value.generatedByStep === 3 ? 3 : null;
  const state =
    value.state === "rejected"
      ? "rejected"
      : value.state === "applied"
        ? "applied"
        : null;

  if (
    !afterLatexCode ||
    !beforeLatexCode ||
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
    segmentId,
    state,
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
  const edits = Array.isArray(value.edits)
    ? value.edits
        .map(readTailoredResumeReviewEdit)
        .filter((edit): edit is TailoredResumeReviewEdit => Boolean(edit))
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
    pdfUpdatedAt: readNullableString(value.pdfUpdatedAt),
    positionTitle: readNullableString(value.positionTitle),
    sourceAnnotatedLatexCode: readNullableRawString(value.sourceAnnotatedLatexCode),
    updatedAt,
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
