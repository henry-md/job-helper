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
  if (!input.step) {
    return input.timings;
  }

  const nextTiming = normalizeStepTiming(input.step, input.observedAt);
  const timingsByStepNumber = new Map<number, TailorResumeGenerationStepTiming>();

  for (const timing of input.timings) {
    timingsByStepNumber.set(timing.stepNumber, timing);
  }

  timingsByStepNumber.set(nextTiming.stepNumber, nextTiming);

  return [...timingsByStepNumber.values()]
    .sort((left, right) => left.stepNumber - right.stepNumber)
    .slice(0, Math.max(1, nextTiming.stepCount));
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
    timingsByStepNumber.set(
      timing.stepNumber,
      shouldPreserveObservedRunningTiming(previousTiming, timing)
        ? {
            ...timing,
            observedAt: previousTiming?.observedAt ?? timing.observedAt,
          }
        : timing,
    );
  }

  if (input.step) {
    const nextTiming = normalizeStepTiming(input.step, input.observedAt);
    const previousTiming = timingsByStepNumber.get(nextTiming.stepNumber) ?? null;

    timingsByStepNumber.set(
      nextTiming.stepNumber,
      shouldPreserveObservedRunningTiming(previousTiming, nextTiming)
        ? {
            ...nextTiming,
            observedAt: previousTiming?.observedAt ?? nextTiming.observedAt,
          }
        : nextTiming,
    );
  }

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
