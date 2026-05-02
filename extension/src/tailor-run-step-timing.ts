import type {
  TailorResumeGenerationStepSummary,
  TailorResumeGenerationStepTiming,
} from "./job-helper";

function normalizeStepTiming(
  step: TailorResumeGenerationStepSummary,
  observedAt: string | null,
): TailorResumeGenerationStepTiming {
  return {
    ...step,
    observedAt,
  };
}

export function mergeTailorResumeGenerationStepTiming(input: {
  observedAt: string | null;
  step: TailorResumeGenerationStepSummary | null;
  timings: TailorResumeGenerationStepTiming[];
}) {
  return mergeTailorResumeGenerationStepTimingHistory({
    observedAt: input.observedAt,
    previousTimings: input.timings,
    step: input.step,
    timings: [],
  });
}

function shouldPreserveObservedRunningTiming(
  previousTiming: TailorResumeGenerationStepTiming | null,
  nextTiming: TailorResumeGenerationStepTiming,
) {
  return Boolean(
    previousTiming &&
      previousTiming.status === "running" &&
      nextTiming.status === "running" &&
      previousTiming.stepNumber === nextTiming.stepNumber &&
      previousTiming.attempt === nextTiming.attempt &&
      previousTiming.retrying === nextTiming.retrying,
  );
}

function areSameStepAttempt(
  previousTiming: TailorResumeGenerationStepTiming | null,
  nextTiming: TailorResumeGenerationStepTiming,
) {
  return Boolean(
    previousTiming &&
      previousTiming.stepNumber === nextTiming.stepNumber &&
      previousTiming.attempt === nextTiming.attempt &&
      previousTiming.retrying === nextTiming.retrying,
  );
}

function readObservedAtTime(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readObservedDurationMs(input: {
  endedAt: string | null | undefined;
  startedAt: string | null | undefined;
}) {
  const startedAt = readObservedAtTime(input.startedAt);
  const endedAt = readObservedAtTime(input.endedAt);

  return startedAt !== null && endedAt !== null
    ? Math.max(0, endedAt - startedAt)
    : 0;
}

function mergeStepTiming(
  previousTiming: TailorResumeGenerationStepTiming | null,
  nextTiming: TailorResumeGenerationStepTiming,
) {
  if (shouldPreserveObservedRunningTiming(previousTiming, nextTiming)) {
    return {
      ...nextTiming,
      observedAt: previousTiming?.observedAt ?? nextTiming.observedAt,
    };
  }

  if (!areSameStepAttempt(previousTiming, nextTiming) || !previousTiming) {
    return nextTiming;
  }

  if (
    previousTiming.status === "running" &&
    nextTiming.status !== "running" &&
    nextTiming.retrying !== true
  ) {
    return {
      ...nextTiming,
      durationMs: Math.max(
        previousTiming.durationMs,
        nextTiming.durationMs,
        readObservedDurationMs({
          endedAt: nextTiming.observedAt,
          startedAt: previousTiming.observedAt,
        }),
      ),
    };
  }

  if (
    previousTiming.status !== "running" &&
    nextTiming.status !== "running" &&
    previousTiming.retrying !== true &&
    nextTiming.retrying !== true
  ) {
    const nextDurationMs = Math.max(
      previousTiming.durationMs,
      nextTiming.durationMs,
    );

    return {
      ...nextTiming,
      durationMs: nextDurationMs,
      observedAt:
        nextTiming.durationMs > previousTiming.durationMs
          ? nextTiming.observedAt
          : previousTiming.observedAt ?? nextTiming.observedAt,
    };
  }

  return nextTiming;
}

function freezeAdvancedRunningTimings(
  timingsByStepNumber: Map<number, TailorResumeGenerationStepTiming>,
  activeStepNumber: number | null,
) {
  if (!activeStepNumber) {
    return;
  }

  const sortedTimings = [...timingsByStepNumber.values()].sort(
    (left, right) => left.stepNumber - right.stepNumber,
  );

  for (const timing of sortedTimings) {
    if (
      timing.stepNumber >= activeStepNumber ||
      (timing.status !== "running" && timing.retrying !== true)
    ) {
      continue;
    }

    const nextTiming = sortedTimings.find(
      (candidate) => candidate.stepNumber > timing.stepNumber,
    );
    const observedDurationMs = readObservedDurationMs({
      endedAt: nextTiming?.observedAt,
      startedAt: timing.observedAt,
    });

    timingsByStepNumber.set(timing.stepNumber, {
      ...timing,
      durationMs: Math.max(timing.durationMs, observedDurationMs),
      retrying: false,
      status: "succeeded",
    });
  }
}

export function mergeTailorResumeGenerationStepTimingHistory(input: {
  observedAt: string | null;
  previousTimings: TailorResumeGenerationStepTiming[];
  step: TailorResumeGenerationStepSummary | null;
  timings: TailorResumeGenerationStepTiming[];
}) {
  const timingsByStepNumber = new Map<number, TailorResumeGenerationStepTiming>();

  for (const timing of input.previousTimings) {
    timingsByStepNumber.set(timing.stepNumber, timing);
  }

  for (const timing of input.timings) {
    const previousTiming = timingsByStepNumber.get(timing.stepNumber) ?? null;
    timingsByStepNumber.set(timing.stepNumber, mergeStepTiming(previousTiming, timing));
  }

  if (input.step) {
    const nextTiming = normalizeStepTiming(input.step, input.observedAt);
    const previousTiming = timingsByStepNumber.get(nextTiming.stepNumber) ?? null;

    timingsByStepNumber.set(
      nextTiming.stepNumber,
      mergeStepTiming(previousTiming, nextTiming),
    );
  }

  freezeAdvancedRunningTimings(
    timingsByStepNumber,
    input.step?.stepNumber ?? input.timings.at(-1)?.stepNumber ?? null,
  );

  const stepCount = Math.max(
    1,
    input.step?.stepCount ??
      input.timings[0]?.stepCount ??
      input.previousTimings[0]?.stepCount ??
      1,
  );

  return [...timingsByStepNumber.values()]
    .sort((left, right) => left.stepNumber - right.stepNumber)
    .filter((timing) => timing.stepNumber <= stepCount)
    .slice(0, stepCount);
}
