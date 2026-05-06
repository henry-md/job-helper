import type { TailorResumeDbRunRecord } from "./tailor-resume-route-response-state.ts";
import { normalizeTailorResumeJobUrl } from "./tailor-resume-job-url.ts";
import type {
  TailoredResumeEmphasizedTechnology,
  TailorResumeGenerationStepEvent,
  TailorResumePendingInterview,
} from "./tailor-resume-types.ts";
import {
  isTailorResumeInterviewPendingQuestionStart,
  isTailorResumeInterviewReady,
} from "./tailor-resume-workspace-interviews.ts";

export type TailorResumeExistingTailoringState =
  | {
      applicationId: string | null;
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
      applicationId: string | null;
      companyName: string | null;
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "pending_interview";
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
      interviewStatus: "deciding" | "pending" | "ready";
      positionTitle: string | null;
      questionCount: number | null;
      updatedAt: string;
    }
  | {
      applicationId: string | null;
      companyName: string | null;
      createdAt: string;
      displayName: string;
      error: string | null;
      id: string;
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
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

function readEmphasizedTechnologies(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const technologies: TailoredResumeEmphasizedTechnology[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const name = readString(item.name);
    const priority =
      item.priority === "high" ? "high" : item.priority === "low" ? "low" : null;

    if (!name || !priority) {
      continue;
    }

    const dedupeKey = `${priority}:${name.toLowerCase()}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    technologies.push({
      evidence: readString(item.evidence),
      name,
      priority,
    });
  }

  return technologies;
}

function readExistingTailoringTime(value: TailorResumeExistingTailoringState) {
  const updatedAt = Date.parse(value.updatedAt);

  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(value.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function readExistingTailoringPriority(value: TailorResumeExistingTailoringState) {
  if (value.kind === "pending_interview") {
    return 3;
  }

  if (value.kind === "active_generation") {
    return 2;
  }

  return 1;
}

function compareExistingTailoringPreference(
  left: TailorResumeExistingTailoringState,
  right: TailorResumeExistingTailoringState,
) {
  const priorityDifference =
    readExistingTailoringPriority(left) - readExistingTailoringPriority(right);

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return readExistingTailoringTime(left) - readExistingTailoringTime(right);
}

function dedupeExistingTailoringsByJobUrl(
  activeTailorings: TailorResumeExistingTailoringState[],
) {
  const activeTailoringsByJobUrl = new Map<
    string,
    TailorResumeExistingTailoringState
  >();
  const activeTailoringsWithoutJobUrl: TailorResumeExistingTailoringState[] = [];

  for (const activeTailoring of activeTailorings) {
    const normalizedJobUrl = normalizeTailorResumeJobUrl(activeTailoring.jobUrl);

    if (!normalizedJobUrl) {
      activeTailoringsWithoutJobUrl.push(activeTailoring);
      continue;
    }

    const previousTailoring = activeTailoringsByJobUrl.get(normalizedJobUrl);

    if (
      !previousTailoring ||
      compareExistingTailoringPreference(activeTailoring, previousTailoring) >= 0
    ) {
      activeTailoringsByJobUrl.set(normalizedJobUrl, activeTailoring);
    }
  }

  return [
    ...activeTailoringsByJobUrl.values(),
    ...activeTailoringsWithoutJobUrl,
  ];
}

function dedupeExistingTailoringsByApplicationId(
  activeTailorings: TailorResumeExistingTailoringState[],
) {
  const activeTailoringsByApplicationId = new Map<
    string,
    TailorResumeExistingTailoringState
  >();
  const activeTailoringsWithoutApplicationId: TailorResumeExistingTailoringState[] =
    [];

  for (const activeTailoring of activeTailorings) {
    const applicationId = activeTailoring.applicationId?.trim();

    if (!applicationId) {
      activeTailoringsWithoutApplicationId.push(activeTailoring);
      continue;
    }

    const previousTailoring = activeTailoringsByApplicationId.get(applicationId);

    if (
      !previousTailoring ||
      compareExistingTailoringPreference(activeTailoring, previousTailoring) >= 0
    ) {
      activeTailoringsByApplicationId.set(applicationId, activeTailoring);
    }
  }

  return [
    ...activeTailoringsByApplicationId.values(),
    ...activeTailoringsWithoutApplicationId,
  ];
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
    applicationId: run.applicationId,
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
  const emphasizedTechnologies =
    tailoringInterview.planningResult.emphasizedTechnologies;

  return {
    applicationId: run?.applicationId ?? tailoringInterview.applicationId,
    companyName: tailoringInterview.planningResult.companyName || null,
    createdAt: run?.createdAt.toISOString() ?? tailoringInterview.createdAt,
    id: run?.id ?? tailoringInterview.tailorResumeRunId ?? tailoringInterview.id,
    emphasizedTechnologies,
    interviewStatus: tailoringInterview.status,
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

    if (tailoringInterview.tailorResumeRunId && !run) {
      continue;
    }

    if (run) {
      representedRunIds.add(run.id);
    }

    activeTailorings.push(
      isTailorResumeInterviewReady(tailoringInterview) ||
        isTailorResumeInterviewPendingQuestionStart(tailoringInterview)
        ? buildPendingInterviewExistingTailoringState(tailoringInterview, run)
        : run
          ? buildActiveRunExistingTailoringState(run)
          : buildPendingInterviewExistingTailoringState(tailoringInterview, run),
    );
  }

  for (const run of input.activeRuns) {
    if (representedRunIds.has(run.id)) {
      continue;
    }

    activeTailorings.push(buildActiveRunExistingTailoringState(run));
  }

  return dedupeExistingTailoringsByJobUrl(
    dedupeExistingTailoringsByApplicationId(activeTailorings),
  ).sort(
    (left, right) => {
      const createdAtDifference =
        Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return Date.parse(left.updatedAt || "") - Date.parse(right.updatedAt || "");
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

function readExistingTailoringInterviewStatus(value: unknown) {
  const status = readString(value).trim().toLowerCase();

  return status === "deciding" || status === "pending" || status === "ready"
    ? status
    : "ready";
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
      applicationId: readNullableString(existingTailoring.applicationId),
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
      applicationId: readNullableString(existingTailoring.applicationId),
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      emphasizedTechnologies: readEmphasizedTechnologies(
        existingTailoring.emphasizedTechnologies,
      ),
      id,
      interviewStatus: readExistingTailoringInterviewStatus(
        existingTailoring.interviewStatus,
      ),
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
      applicationId: readNullableString(existingTailoring.applicationId),
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      displayName,
      emphasizedTechnologies: readEmphasizedTechnologies(
        existingTailoring.emphasizedTechnologies,
      ),
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
    return dedupeExistingTailoringsByJobUrl(
      dedupeExistingTailoringsByApplicationId(parsedActiveTailorings),
    ).sort((left, right) => {
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
