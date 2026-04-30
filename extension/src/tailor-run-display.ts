import {
  buildTailorRunIdentityDisplay,
  type TailorRunIdentityDisplay,
} from "./tailor-run-identity.ts";

type TailorRunCaptureState =
  | "blocked"
  | "error"
  | "finishing"
  | "idle"
  | "needs_input"
  | "running"
  | "sent";

type TailorRunStatus = "error" | "needs_input" | "running" | "success";

type TailorRunExistingTailoringKind =
  | "active_generation"
  | "completed"
  | "pending_interview";

type TailorRunIdentityFields = {
  companyName: string | null;
  positionTitle: string | null;
};

type TailorRunPageApplicationContext = {
  companyName: string | null;
  jobTitle: string | null;
};

export function formatTailorRunElapsedTime(input: {
  nowTime: number;
  startedAtTime: number;
}) {
  const elapsedMs =
    Number.isFinite(input.nowTime) &&
    Number.isFinite(input.startedAtTime) &&
    input.startedAtTime > 0
      ? Math.max(0, input.nowTime - input.startedAtTime)
      : 0;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function shouldRenderTailorRunShell(input: {
  activeTailoringKind: TailorRunExistingTailoringKind | null;
  captureState: TailorRunCaptureState;
  hasCurrentPageCompletedTailoring: boolean;
  hasExistingTailoringPrompt: boolean;
  hasTailorInterview: boolean;
  isStoppingCurrentTailoring: boolean;
  isTailorPreparationPending: boolean;
  lastTailoringRunStatus: TailorRunStatus | null;
}) {
  if (
    input.hasExistingTailoringPrompt ||
    input.hasTailorInterview ||
    input.isStoppingCurrentTailoring ||
    input.isTailorPreparationPending
  ) {
    return true;
  }

  if (
    input.captureState === "blocked" ||
    input.captureState === "error" ||
    input.captureState === "finishing" ||
    input.captureState === "needs_input" ||
    input.captureState === "running"
  ) {
    return true;
  }

  if (
    input.activeTailoringKind === "active_generation" ||
    input.activeTailoringKind === "pending_interview"
  ) {
    return true;
  }

  if (
    input.lastTailoringRunStatus === "error" ||
    input.lastTailoringRunStatus === "needs_input" ||
    input.lastTailoringRunStatus === "running"
  ) {
    return true;
  }

  if (
    input.hasCurrentPageCompletedTailoring ||
    input.activeTailoringKind === "completed"
  ) {
    return true;
  }

  return false;
}

export function shouldRenderLegacyTailorRunShell(input: {
  hasCurrentPageCompletedTailoring: boolean;
  hasCurrentPageExistingTailoringPrompt: boolean;
  hasCurrentPageRunCard: boolean;
  shouldShowTailorRunShell: boolean;
}) {
  if (!input.shouldShowTailorRunShell || input.hasCurrentPageRunCard) {
    return false;
  }

  if (input.hasCurrentPageExistingTailoringPrompt) {
    return true;
  }

  return !input.hasCurrentPageCompletedTailoring;
}

export function resolveReviewableTailoredResumeId(input: {
  completedTailoringId: string | null;
  currentPageTailoredResumeId: string | null;
}) {
  if (input.completedTailoringId) {
    return input.completedTailoringId;
  }

  if (input.currentPageTailoredResumeId) {
    return input.currentPageTailoredResumeId;
  }

  return null;
}

export function resolveDisplayedTailorRunIdentity(input: {
  activeTailoring: TailorRunIdentityFields | null;
  completedTailoring: TailorRunIdentityFields | null;
  currentPageApplicationContext: TailorRunPageApplicationContext | null;
  lastTailoringRun: TailorRunIdentityFields | null;
  shouldUseOptimisticTailorRunIdentity: boolean;
}): TailorRunIdentityDisplay | null {
  const storedIdentity = buildTailorRunIdentityDisplay({
    companyName:
      input.activeTailoring?.companyName ??
      input.completedTailoring?.companyName ??
      input.lastTailoringRun?.companyName ??
      null,
    positionTitle:
      input.activeTailoring?.positionTitle ??
      input.completedTailoring?.positionTitle ??
      input.lastTailoringRun?.positionTitle ??
      null,
  });

  if (storedIdentity) {
    return storedIdentity;
  }

  if (!input.shouldUseOptimisticTailorRunIdentity) {
    return null;
  }

  return buildTailorRunIdentityDisplay({
    companyName: input.currentPageApplicationContext?.companyName ?? null,
    positionTitle: input.currentPageApplicationContext?.jobTitle ?? null,
  });
}
