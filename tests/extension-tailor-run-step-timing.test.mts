import assert from "node:assert/strict";
import test from "node:test";
import { mergeTailorResumeGenerationStepTimingHistory } from "../extension/src/tailor-run-step-timing.ts";

test("preserves previous step timings when a server refresh only has the current step", () => {
  const result = mergeTailorResumeGenerationStepTimingHistory({
    observedAt: "2026-04-30T20:05:00.000Z",
    previousTimings: [
      {
        attempt: 1,
        detail: null,
        durationMs: 44_000,
        observedAt: "2026-04-30T20:00:44.000Z",
        retrying: false,
        status: "succeeded",
        stepCount: 4,
        stepNumber: 1,
        summary: "Generating plaintext edit outline",
      },
      {
        attempt: 1,
        detail: null,
        durationMs: 72_000,
        observedAt: "2026-04-30T20:01:56.000Z",
        retrying: false,
        status: "succeeded",
        stepCount: 4,
        stepNumber: 2,
        summary: "No need to ask the user any follow-up questions",
      },
      {
        attempt: 1,
        detail: null,
        durationMs: 0,
        observedAt: "2026-04-30T20:01:56.000Z",
        retrying: false,
        status: "running",
        stepCount: 4,
        stepNumber: 3,
        summary: "Generating block-scoped edits",
      },
    ],
    step: {
      attempt: 1,
      detail: null,
      durationMs: 0,
      retrying: false,
      status: "running",
      stepCount: 4,
      stepNumber: 3,
      summary: "Generating block-scoped edits",
    },
    timings: [],
  });

  assert.deepEqual(
    result.map((timing) => ({
      observedAt: timing.observedAt,
      stepNumber: timing.stepNumber,
    })),
    [
      {
        observedAt: "2026-04-30T20:00:44.000Z",
        stepNumber: 1,
      },
      {
        observedAt: "2026-04-30T20:01:56.000Z",
        stepNumber: 2,
      },
      {
        observedAt: "2026-04-30T20:01:56.000Z",
        stepNumber: 3,
      },
    ],
  );
});
