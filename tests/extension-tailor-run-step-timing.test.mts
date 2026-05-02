import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeTailorResumeGenerationStepTiming,
  mergeTailorResumeGenerationStepTimingHistory,
} from "../extension/src/tailor-run-step-timing.ts";

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
        stepCount: 5,
        stepNumber: 1,
        summary: "Clarify missing details",
      },
      {
        attempt: 1,
        detail: null,
        durationMs: 72_000,
        observedAt: "2026-04-30T20:01:56.000Z",
        retrying: false,
        status: "succeeded",
        stepCount: 5,
        stepNumber: 2,
        summary: "Generating plaintext edit outline",
      },
      {
        attempt: 1,
        detail: null,
        durationMs: 0,
        observedAt: "2026-04-30T20:01:56.000Z",
        retrying: false,
        status: "running",
        stepCount: 5,
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
      stepCount: 5,
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

test("freezes stale running timings after a later step becomes active", () => {
  const result = mergeTailorResumeGenerationStepTimingHistory({
    observedAt: "2026-04-30T20:01:07.000Z",
    previousTimings: [
      {
        attempt: 1,
        detail: null,
        durationMs: 0,
        observedAt: "2026-04-30T20:00:00.000Z",
        retrying: false,
        status: "running",
        stepCount: 5,
        stepNumber: 1,
        summary: "Clarify missing details",
      },
      {
        attempt: 1,
        detail: null,
        durationMs: 0,
        observedAt: "2026-04-30T20:00:41.000Z",
        retrying: false,
        status: "running",
        stepCount: 5,
        stepNumber: 3,
        summary: "Generating block-scoped edits",
      },
    ],
    step: {
      attempt: 1,
      detail: null,
      durationMs: 26_000,
      retrying: false,
      status: "running",
      stepCount: 5,
      stepNumber: 3,
      summary: "Generating block-scoped edits",
    },
    timings: [],
  });

  assert.equal(result[0]?.status, "succeeded");
  assert.equal(result[0]?.durationMs, 41_000);
  assert.equal(result[1]?.status, "running");
});

test("preserves a running step start time across repeated stream events", () => {
  const result = mergeTailorResumeGenerationStepTiming({
    observedAt: "2026-05-01T21:01:08.000Z",
    step: {
      attempt: 1,
      detail: null,
      durationMs: 0,
      retrying: false,
      status: "running",
      stepCount: 5,
      stepNumber: 1,
      summary: "Clarify missing details",
    },
    timings: [
      {
        attempt: 1,
        detail: null,
        durationMs: 0,
        observedAt: "2026-05-01T21:00:03.000Z",
        retrying: false,
        status: "running",
        stepCount: 5,
        stepNumber: 1,
        summary: "Clarify missing details",
      },
    ],
  });

  assert.equal(result[0]?.observedAt, "2026-05-01T21:00:03.000Z");
});

test("computes duration when a running step completes without a backend duration", () => {
  const result = mergeTailorResumeGenerationStepTiming({
    observedAt: "2026-05-01T21:01:08.000Z",
    step: {
      attempt: 1,
      detail: "Planner identified 2 block changes.",
      durationMs: 0,
      retrying: false,
      status: "succeeded",
      stepCount: 5,
      stepNumber: 1,
      summary: "Clarify missing details",
    },
    timings: [
      {
        attempt: 1,
        detail: "Starting the planning pass.",
        durationMs: 0,
        observedAt: "2026-05-01T21:00:03.000Z",
        retrying: false,
        status: "running",
        stepCount: 5,
        stepNumber: 1,
        summary: "Clarify missing details",
      },
    ],
  });

  assert.equal(result[0]?.durationMs, 65_000);
  assert.equal(result[0]?.observedAt, "2026-05-01T21:01:08.000Z");
});

test("keeps a completed zero-duration step stable across server refreshes", () => {
  const result = mergeTailorResumeGenerationStepTiming({
    observedAt: "2026-05-01T21:02:08.000Z",
    step: {
      attempt: 1,
      detail: "Planner identified 2 block changes.",
      durationMs: 0,
      retrying: false,
      status: "succeeded",
      stepCount: 5,
      stepNumber: 1,
      summary: "Clarify missing details",
    },
    timings: [
      {
        attempt: 1,
        detail: "Planner identified 2 block changes.",
        durationMs: 65_000,
        observedAt: "2026-05-01T21:01:08.000Z",
        retrying: false,
        status: "succeeded",
        stepCount: 5,
        stepNumber: 1,
        summary: "Clarify missing details",
      },
    ],
  });

  assert.equal(result[0]?.durationMs, 65_000);
  assert.equal(result[0]?.observedAt, "2026-05-01T21:01:08.000Z");
});
