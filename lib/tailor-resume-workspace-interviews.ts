import type {
  TailorResumePendingInterview,
  TailorResumeWorkspaceState,
} from "./tailor-resume-types.ts";

export function isTailorResumeInterviewReady(
  interview: TailorResumePendingInterview,
) {
  return interview.status === "ready";
}

export function isTailorResumeInterviewPendingQuestionStart(
  interview: TailorResumePendingInterview,
) {
  return interview.status === "pending";
}

export function isTailorResumeInterviewDecisionInFlight(
  interview: TailorResumePendingInterview,
) {
  return interview.status === "deciding";
}

function readTailorResumeInterviewTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readTailorResumeInterviewSortTime(
  interview: TailorResumePendingInterview,
) {
  return (
    readTailorResumeInterviewTimestamp(interview.createdAt) ||
    readTailorResumeInterviewTimestamp(interview.updatedAt)
  );
}

function readTailorResumeInterviewStatusRank(
  interview: TailorResumePendingInterview,
) {
  if (isTailorResumeInterviewReady(interview)) {
    return 0;
  }

  if (isTailorResumeInterviewPendingQuestionStart(interview)) {
    return 1;
  }

  if (isTailorResumeInterviewDecisionInFlight(interview)) {
    return 2;
  }

  return 3;
}

export function sortTailorResumeWorkspaceInterviews(
  interviews: TailorResumePendingInterview[],
) {
  return [...interviews].sort(
    (left, right) => {
      const statusDifference =
        readTailorResumeInterviewStatusRank(left) -
        readTailorResumeInterviewStatusRank(right);

      if (statusDifference !== 0) {
        return statusDifference;
      }

      return readTailorResumeInterviewSortTime(left) -
        readTailorResumeInterviewSortTime(right);
    },
  );
}

export function readTailorResumeWorkspaceInterviews(
  workspace: TailorResumeWorkspaceState,
) {
  if (workspace.tailoringInterviews.length > 0) {
    return sortTailorResumeWorkspaceInterviews(workspace.tailoringInterviews);
  }

  return workspace.tailoringInterview ? [workspace.tailoringInterview] : [];
}

export function withTailorResumeWorkspaceInterviews(
  workspace: TailorResumeWorkspaceState,
  interviews: TailorResumePendingInterview[],
  updatedAt: string | null,
): TailorResumeWorkspaceState {
  const nextInterviews = sortTailorResumeWorkspaceInterviews(interviews);
  const readyInterview =
    nextInterviews.find((interview) => isTailorResumeInterviewReady(interview)) ??
    null;

  return {
    ...workspace,
    tailoringInterview: readyInterview,
    tailoringInterviews: nextInterviews,
    updatedAt,
  };
}

export function upsertTailorResumeWorkspaceInterview(
  workspace: TailorResumeWorkspaceState,
  interview: TailorResumePendingInterview,
  updatedAt = interview.updatedAt,
) {
  const currentInterviews = readTailorResumeWorkspaceInterviews(workspace).filter(
    (candidate) =>
      candidate.id !== interview.id &&
      candidate.tailorResumeRunId !== interview.tailorResumeRunId,
  );

  return withTailorResumeWorkspaceInterviews(
    workspace,
    [interview, ...currentInterviews],
    updatedAt,
  );
}

export function removeTailorResumeWorkspaceInterview(
  workspace: TailorResumeWorkspaceState,
  predicate: (interview: TailorResumePendingInterview) => boolean,
  updatedAt = new Date().toISOString(),
) {
  const nextInterviews = readTailorResumeWorkspaceInterviews(workspace).filter(
    (interview) => !predicate(interview),
  );

  return withTailorResumeWorkspaceInterviews(workspace, nextInterviews, updatedAt);
}

export function findTailorResumeWorkspaceInterview(
  workspace: TailorResumeWorkspaceState,
  predicate: (interview: TailorResumePendingInterview) => boolean,
) {
  return (
    readTailorResumeWorkspaceInterviews(workspace).find((interview) =>
      predicate(interview),
    ) ?? null
  );
}
