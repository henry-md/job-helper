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

type TailorRunStepTimingStatus =
  | "failed"
  | "running"
  | "skipped"
  | "succeeded";

export type TailorRunTimeDisplayMode = "aggregate" | "specific";

export type TailorRunStepTimingDisplayInput = {
  durationMs: number | null | undefined;
  observedAtTime: number | null | undefined;
  retrying?: boolean | null;
  status: TailorRunStepTimingStatus;
  stepNumber: number;
};

function readNonNegativeDurationMs(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function formatTailorRunDurationMs(durationMs: number) {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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

  return formatTailorRunDurationMs(elapsedMs);
}

function readTailorRunStepTimingDuration(input: {
  fallbackDurationMs: number | null;
  nowTime: number;
  timing: TailorRunStepTimingDisplayInput;
}) {
  const baseDurationMs = readNonNegativeDurationMs(input.timing.durationMs);

  if (input.timing.status !== "running" && input.timing.retrying !== true) {
    return baseDurationMs;
  }

  if (
    typeof input.timing.observedAtTime === "number" &&
    Number.isFinite(input.timing.observedAtTime) &&
    input.timing.observedAtTime > 0 &&
    Number.isFinite(input.nowTime)
  ) {
    return Math.max(0, baseDurationMs + input.nowTime - input.timing.observedAtTime);
  }

  return input.fallbackDurationMs ?? baseDurationMs;
}

export function formatTailorRunStepTimeDisplay(input: {
  activeStepNumber: number | null | undefined;
  mode: TailorRunTimeDisplayMode;
  nowTime: number;
  runStartedAtTime: number;
  timings: TailorRunStepTimingDisplayInput[];
}) {
  if (input.mode === "aggregate") {
    return formatTailorRunElapsedTime({
      nowTime: input.nowTime,
      startedAtTime: input.runStartedAtTime,
    });
  }

  const runElapsedMs =
    Number.isFinite(input.nowTime) &&
    Number.isFinite(input.runStartedAtTime) &&
    input.runStartedAtTime > 0
      ? Math.max(0, input.nowTime - input.runStartedAtTime)
      : 0;
  const activeStepNumber =
    typeof input.activeStepNumber === "number" &&
    Number.isFinite(input.activeStepNumber) &&
    input.activeStepNumber > 0
      ? Math.floor(input.activeStepNumber)
      : null;
  const timingsByStepNumber = new Map<number, TailorRunStepTimingDisplayInput>();

  for (const timing of input.timings) {
    if (
      Number.isFinite(timing.stepNumber) &&
      timing.stepNumber > 0 &&
      (!activeStepNumber || timing.stepNumber <= activeStepNumber)
    ) {
      timingsByStepNumber.set(Math.floor(timing.stepNumber), timing);
    }
  }

  const sortedTimings = [...timingsByStepNumber.values()].sort(
    (left, right) => left.stepNumber - right.stepNumber,
  );
  const terminalDurationMs = sortedTimings
    .filter((timing) => timing.status !== "running" && timing.retrying !== true)
    .reduce(
      (totalDurationMs, timing) =>
        totalDurationMs + readNonNegativeDurationMs(timing.durationMs),
      0,
    );
  const fallbackRunningDurationMs = Math.max(
    0,
    runElapsedMs - terminalDurationMs,
  );
  const durations = sortedTimings.map((timing) =>
    readTailorRunStepTimingDuration({
      fallbackDurationMs:
        activeStepNumber && timing.stepNumber === activeStepNumber
          ? fallbackRunningDurationMs
          : null,
      nowTime: input.nowTime,
      timing,
    }),
  );

  if (durations.length === 0 && runElapsedMs > 0) {
    durations.push(runElapsedMs);
  }

  if (durations.length === 0 && activeStepNumber) {
    durations.push(0);
  }

  return durations
    .map((durationMs) => formatTailorRunDurationMs(durationMs))
    .join("/");
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
