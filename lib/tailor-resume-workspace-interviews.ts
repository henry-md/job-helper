import type {
  TailorResumePendingInterview,
  TailorResumeWorkspaceState,
} from "./tailor-resume-types.ts";

function readTailorResumeInterviewTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortTailorResumeWorkspaceInterviews(
  interviews: TailorResumePendingInterview[],
) {
  return [...interviews].sort(
    (left, right) =>
      readTailorResumeInterviewTimestamp(right.updatedAt) -
      readTailorResumeInterviewTimestamp(left.updatedAt),
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

  return {
    ...workspace,
    tailoringInterview: nextInterviews[0] ?? null,
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
