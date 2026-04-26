import type { TailorResumeDbRunRecord } from "./tailor-resume-route-response-state.ts";
import type {
  TailorResumeGenerationStepEvent,
  TailorResumePendingInterview,
} from "./tailor-resume-types.ts";

export type TailorResumeExistingTailoringState =
  | {
      companyName: string | null;
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "active_generation";
      lastStep: TailorResumeGenerationStepEvent | null;
      positionTitle: string | null;
      updatedAt: string;
    }
  | {
      companyName: string | null;
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "pending_interview";
      positionTitle: string | null;
      questionCount: number | null;
      updatedAt: string;
    }
  | {
      companyName: string | null;
      createdAt: string;
      displayName: string;
      error: string | null;
      id: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "completed";
      positionTitle: string | null;
      status: string;
      tailoredResumeId: string;
      updatedAt: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildTailorResumeRunStepEvent(
  run: TailorResumeDbRunRecord,
): TailorResumeGenerationStepEvent | null {
  const rawStatus = run.stepStatus?.trim().toLowerCase() ?? null;
  const status =
    rawStatus === "failed"
      ? "failed"
      : rawStatus === "running"
        ? "running"
        : rawStatus === "skipped"
          ? "skipped"
          : rawStatus === "succeeded"
            ? "succeeded"
            : null;

  if (!run.stepNumber || !run.stepCount || !run.stepSummary || !status) {
    return null;
  }

  return {
    attempt: run.stepAttempt,
    detail: run.stepDetail,
    durationMs: 0,
    retrying: run.stepRetrying === true,
    status,
    stepCount: run.stepCount,
    stepNumber: run.stepNumber,
    summary: run.stepSummary,
  };
}

export function buildActiveRunExistingTailoringState(
  run: TailorResumeDbRunRecord,
): TailorResumeExistingTailoringState {
  return {
    companyName: run.application.company.name,
    createdAt: run.createdAt.toISOString(),
    id: run.id,
    jobDescription: run.jobDescription,
    jobIdentifier: null,
    jobUrl: run.jobUrl,
    kind: "active_generation",
    lastStep: buildTailorResumeRunStepEvent(run),
    positionTitle: run.application.title,
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function buildPendingInterviewExistingTailoringState(
  tailoringInterview: TailorResumePendingInterview,
  run?: TailorResumeDbRunRecord,
): TailorResumeExistingTailoringState {
  const questioningSummary = tailoringInterview.planningResult.questioningSummary;

  return {
    companyName: tailoringInterview.planningResult.companyName || null,
    createdAt: run?.createdAt.toISOString() ?? tailoringInterview.createdAt,
    id: run?.id ?? tailoringInterview.tailorResumeRunId ?? tailoringInterview.id,
    jobDescription: tailoringInterview.jobDescription,
    jobIdentifier: tailoringInterview.planningResult.jobIdentifier || null,
    jobUrl: tailoringInterview.jobUrl,
    kind: "pending_interview",
    positionTitle: tailoringInterview.planningResult.positionTitle || null,
    questionCount: questioningSummary?.askedQuestionCount ?? null,
    updatedAt: run?.updatedAt.toISOString() ?? tailoringInterview.updatedAt,
  };
}

export function buildActiveTailoringStates(input: {
  activeRuns: TailorResumeDbRunRecord[];
  tailoringInterviews: TailorResumePendingInterview[];
}) {
  const activeRunsById = new Map(
    input.activeRuns.map((run) => [run.id, run] as const),
  );
  const representedRunIds = new Set<string>();
  const activeTailorings: TailorResumeExistingTailoringState[] = [];

  for (const tailoringInterview of input.tailoringInterviews) {
    const run =
      tailoringInterview.tailorResumeRunId
        ? activeRunsById.get(tailoringInterview.tailorResumeRunId)
        : undefined;

    if (run) {
      representedRunIds.add(run.id);
    }

    activeTailorings.push(
      buildPendingInterviewExistingTailoringState(tailoringInterview, run),
    );
  }

  for (const run of input.activeRuns) {
    if (representedRunIds.has(run.id)) {
      continue;
    }

    activeTailorings.push(buildActiveRunExistingTailoringState(run));
  }

  return activeTailorings.sort(
    (left, right) => {
      const createdAtDifference =
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    },
  );
}

function readTailorResumeGenerationStepEvent(
  value: unknown,
): TailorResumeGenerationStepEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawStatus = readString(value.status).trim().toLowerCase();
  const status =
    rawStatus === "failed"
      ? "failed"
      : rawStatus === "running"
        ? "running"
        : rawStatus === "skipped"
          ? "skipped"
          : rawStatus === "succeeded"
            ? "succeeded"
            : null;
  const stepNumber = readNumber(value.stepNumber);
  const stepCount = readNumber(value.stepCount);
  const summary = readNullableString(value.summary);

  if (!stepNumber || !stepCount || !summary || !status) {
    return null;
  }

  const attempt = readNumber(value.attempt);

  return {
    attempt: attempt > 0 ? Math.floor(attempt) : null,
    detail: readNullableString(value.detail),
    durationMs: readNumber(value.durationMs),
    retrying: value.retrying === true,
    status,
    stepCount: Math.max(1, Math.floor(stepCount)),
    stepNumber: Math.max(1, Math.floor(stepNumber)),
    summary,
  };
}

function readExistingTailoringQuestionCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (!isRecord(value)) {
    return null;
  }

  const asked = readNumber(value.askedQuestionCount);

  return asked > 0 ? Math.floor(asked) : null;
}

export function readTailorResumeExistingTailoringState(
  value: unknown,
): TailorResumeExistingTailoringState | null {
  const existingTailoring =
    isRecord(value) && isRecord(value.existingTailoring)
      ? value.existingTailoring
      : value;

  if (!isRecord(existingTailoring)) {
    return null;
  }

  const id = readString(existingTailoring.id);
  const kind = readString(existingTailoring.kind);
  const updatedAt = readString(existingTailoring.updatedAt);

  if (!id || !updatedAt) {
    return null;
  }

  if (kind === "active_generation") {
    const createdAt = readString(existingTailoring.createdAt);
    const jobDescription = readString(existingTailoring.jobDescription);

    if (!createdAt) {
      return null;
    }

    return {
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      id,
      jobDescription,
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      lastStep: readTailorResumeGenerationStepEvent(existingTailoring.lastStep),
      positionTitle: readNullableString(existingTailoring.positionTitle),
      updatedAt,
    };
  }

  if (kind === "pending_interview") {
    const createdAt = readString(existingTailoring.createdAt);

    if (!createdAt) {
      return null;
    }

    return {
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      id,
      jobDescription: readString(existingTailoring.jobDescription),
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      positionTitle: readNullableString(existingTailoring.positionTitle),
      questionCount: readExistingTailoringQuestionCount(
        existingTailoring.questionCount,
      ),
      updatedAt,
    };
  }

  if (kind === "completed") {
    const createdAt = readString(existingTailoring.createdAt);
    const displayName = readString(existingTailoring.displayName);
    const tailoredResumeId = readString(existingTailoring.tailoredResumeId);

    if (!createdAt || !displayName || !tailoredResumeId) {
      return null;
    }

    return {
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      displayName,
      error: readNullableString(existingTailoring.error),
      id,
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      positionTitle: readNullableString(existingTailoring.positionTitle),
      status: readString(existingTailoring.status) || "ready",
      tailoredResumeId,
      updatedAt,
    };
  }

  return null;
}

export function readTailorResumeExistingTailoringStates(value: unknown) {
  const activeTailorings = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.activeTailorings)
      ? value.activeTailorings
      : isRecord(value) && Array.isArray(value.existingTailorings)
        ? value.existingTailorings
        : [];

  const parsedActiveTailorings = activeTailorings
    .map(readTailorResumeExistingTailoringState)
    .filter(
      (
        activeTailoring,
      ): activeTailoring is TailorResumeExistingTailoringState =>
        activeTailoring !== null,
    );

  if (parsedActiveTailorings.length > 0) {
    return parsedActiveTailorings.sort((left, right) => {
      const createdAtDifference =
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    });
  }

  const singleActiveTailoring = readTailorResumeExistingTailoringState(value);
  return singleActiveTailoring ? [singleActiveTailoring] : [];
}
