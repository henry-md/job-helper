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

function isActiveTiming(timing: TailorResumeGenerationStepTiming) {
  return timing.status === "running" || timing.retrying === true;
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

function buildStepTimingKey(timing: TailorResumeGenerationStepTiming) {
  return `${String(timing.stepNumber)}:${String(timing.attempt ?? 1)}`;
}

function readPreviousDurationAtNextObservation(
  previousTiming: TailorResumeGenerationStepTiming,
  nextTiming: TailorResumeGenerationStepTiming,
) {
  if (!isActiveTiming(previousTiming)) {
    return previousTiming.durationMs;
  }

  return Math.max(
    previousTiming.durationMs,
    previousTiming.durationMs +
      readObservedDurationMs({
        endedAt: nextTiming.observedAt,
        startedAt: previousTiming.observedAt,
      }),
  );
}

function mergeStepTiming(
  previousTiming: TailorResumeGenerationStepTiming | null,
  nextTiming: TailorResumeGenerationStepTiming,
) {
  const nextTimingWithPreservedKeywords =
    previousTiming &&
    areSameStepAttempt(previousTiming, nextTiming) &&
    (nextTiming.emphasizedTechnologies ?? []).length === 0 &&
    (previousTiming.emphasizedTechnologies ?? []).length > 0
      ? {
          ...nextTiming,
          emphasizedTechnologies: previousTiming.emphasizedTechnologies,
        }
      : nextTiming;

  if (previousTiming?.stepNumber === nextTimingWithPreservedKeywords.stepNumber) {
    const previousDurationAtNextObservation =
      readPreviousDurationAtNextObservation(
        previousTiming,
        nextTimingWithPreservedKeywords,
      );

    if (
      shouldPreserveObservedRunningTiming(
        previousTiming,
        nextTimingWithPreservedKeywords,
      )
    ) {
      return {
        ...nextTimingWithPreservedKeywords,
        durationMs: previousTiming.durationMs,
        observedAt:
          previousTiming?.observedAt ?? nextTimingWithPreservedKeywords.observedAt,
      };
    }

    const nextTimingWithContinuousDuration = {
      ...nextTimingWithPreservedKeywords,
      durationMs: Math.max(
        nextTimingWithPreservedKeywords.durationMs,
        previousDurationAtNextObservation,
      ),
    };

    if (!areSameStepAttempt(previousTiming, nextTimingWithPreservedKeywords)) {
      return nextTimingWithContinuousDuration;
    }

    if (
      previousTiming.status === "running" &&
      nextTimingWithPreservedKeywords.status !== "running" &&
      nextTimingWithPreservedKeywords.retrying !== true
    ) {
      return nextTimingWithContinuousDuration;
    }

    if (
      previousTiming.status !== "running" &&
      nextTimingWithPreservedKeywords.status !== "running" &&
      previousTiming.retrying !== true &&
      nextTimingWithPreservedKeywords.retrying !== true
    ) {
      const nextDurationMs = Math.max(
        previousTiming.durationMs,
        nextTimingWithPreservedKeywords.durationMs,
      );

      return {
        ...nextTimingWithPreservedKeywords,
        durationMs: nextDurationMs,
        observedAt:
          nextTimingWithPreservedKeywords.durationMs > previousTiming.durationMs
            ? nextTimingWithPreservedKeywords.observedAt
            : previousTiming.observedAt ?? nextTimingWithPreservedKeywords.observedAt,
      };
    }

    return nextTimingWithContinuousDuration;
  }

  if (
    shouldPreserveObservedRunningTiming(
      previousTiming,
      nextTimingWithPreservedKeywords,
    )
  ) {
    return {
      ...nextTimingWithPreservedKeywords,
      observedAt:
        previousTiming?.observedAt ?? nextTimingWithPreservedKeywords.observedAt,
    };
  }

  if (
    !areSameStepAttempt(previousTiming, nextTimingWithPreservedKeywords) ||
    !previousTiming
  ) {
    return nextTimingWithPreservedKeywords;
  }

  if (
    previousTiming.status === "running" &&
    nextTimingWithPreservedKeywords.status !== "running" &&
    nextTimingWithPreservedKeywords.retrying !== true
  ) {
    return {
      ...nextTimingWithPreservedKeywords,
      durationMs: Math.max(
        previousTiming.durationMs,
        nextTimingWithPreservedKeywords.durationMs,
        readObservedDurationMs({
          endedAt: nextTimingWithPreservedKeywords.observedAt,
          startedAt: previousTiming.observedAt,
        }),
      ),
    };
  }

  if (
    previousTiming.status !== "running" &&
    nextTimingWithPreservedKeywords.status !== "running" &&
    previousTiming.retrying !== true &&
    nextTimingWithPreservedKeywords.retrying !== true
  ) {
    const nextDurationMs = Math.max(
      previousTiming.durationMs,
      nextTimingWithPreservedKeywords.durationMs,
    );

    return {
      ...nextTimingWithPreservedKeywords,
      durationMs: nextDurationMs,
      observedAt:
        nextTimingWithPreservedKeywords.durationMs > previousTiming.durationMs
          ? nextTimingWithPreservedKeywords.observedAt
          : previousTiming.observedAt ?? nextTimingWithPreservedKeywords.observedAt,
    };
  }

  return nextTimingWithPreservedKeywords;
}

function freezeAdvancedRunningTimingEntries(
  timingEntries: TailorResumeGenerationStepTiming[],
  activeStepNumber: number | null,
) {
  if (!activeStepNumber) {
    return timingEntries;
  }

  const sortedTimings = [...timingEntries].sort(
    (left, right) =>
      left.stepNumber - right.stepNumber ||
      (left.attempt ?? 1) - (right.attempt ?? 1),
  );

  return sortedTimings.map((timing) => {
    if (
      timing.stepNumber >= activeStepNumber ||
      (timing.status !== "running" && timing.retrying !== true)
    ) {
      return timing;
    }

    const nextTiming = sortedTimings.find(
      (candidate) => candidate.stepNumber > timing.stepNumber,
    );
    const observedDurationMs = readObservedDurationMs({
      endedAt: nextTiming?.observedAt,
      startedAt: timing.observedAt,
    });

    return {
      ...timing,
      durationMs: Math.max(timing.durationMs, observedDurationMs),
      retrying: false,
      status: "succeeded" as const,
    };
  });
}

export function mergeTailorResumeGenerationStepTimingHistory(input: {
  observedAt: string | null;
  previousTimings: TailorResumeGenerationStepTiming[];
  step: TailorResumeGenerationStepSummary | null;
  timings: TailorResumeGenerationStepTiming[];
}) {
  const timingsByKey = new Map<string, TailorResumeGenerationStepTiming>();

  for (const timing of input.previousTimings) {
    timingsByKey.set(buildStepTimingKey(timing), timing);
  }

  for (const timing of input.timings) {
    const timingKey = buildStepTimingKey(timing);
    const previousTiming = timingsByKey.get(timingKey) ?? null;
    timingsByKey.set(timingKey, mergeStepTiming(previousTiming, timing));
  }

  if (input.step) {
    const nextTiming = normalizeStepTiming(input.step, input.observedAt);
    const timingKey = buildStepTimingKey(nextTiming);
    const previousTiming = timingsByKey.get(timingKey) ?? null;

    timingsByKey.set(timingKey, mergeStepTiming(previousTiming, nextTiming));
  }

  const stepCount = Math.max(
    1,
    input.step?.stepCount ??
      input.timings[0]?.stepCount ??
      input.previousTimings[0]?.stepCount ??
      1,
  );

  return freezeAdvancedRunningTimingEntries(
    [...timingsByKey.values()],
    input.step?.stepNumber ?? input.timings.at(-1)?.stepNumber ?? null,
  )
    .sort(
      (left, right) =>
        left.stepNumber - right.stepNumber ||
        (left.attempt ?? 1) - (right.attempt ?? 1),
    )
    .filter((timing) => timing.stepNumber <= stepCount)
    .slice(0, stepCount * 3);
}
