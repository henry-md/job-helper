import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTransientModelError,
  getTransientModelRetryDelayMs,
  isTransientModelError,
  runWithTransientModelRetries,
} from "../lib/tailor-resume-transient-retry.ts";

test("isTransientModelError recognizes network and server failures", () => {
  assert.equal(isTransientModelError(new Error("network error")), true);
  assert.equal(isTransientModelError({ name: "APIConnectionError" }), true);
  assert.equal(isTransientModelError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientModelError({ status: 503 }), true);
  assert.equal(isTransientModelError({ type: "rate_limit_error" }), true);
});

test("isTransientModelError ignores non-recoverable errors", () => {
  assert.equal(isTransientModelError(new Error("OPENAI_API_KEY is not set.")), false);
  assert.equal(isTransientModelError(new DOMException("aborted", "AbortError")), false);
});

test("runWithTransientModelRetries retries transient failures", async () => {
  const retryEvents: Array<{
    attempt: number;
    delayMs: number;
    message: string;
    nextAttempt: number;
  }> = [];
  const delays: number[] = [];
  let calls = 0;

  const result = await runWithTransientModelRetries({
    delayMsForAttempt: (attempt) => attempt * 10,
    maxAttempts: 3,
    onRetry: (event) => {
      retryEvents.push({
        attempt: event.attempt,
        delayMs: event.delayMs,
        message: event.message,
        nextAttempt: event.nextAttempt,
      });
    },
    operation: async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("network error");
      }

      return "ok";
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [10]);
  assert.deepEqual(retryEvents, [
    {
      attempt: 1,
      delayMs: 10,
      message: "network error",
      nextAttempt: 2,
    },
  ]);
});

test("runWithTransientModelRetries does not retry ordinary validation errors", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runWithTransientModelRetries({
        maxAttempts: 3,
        operation: async () => {
          calls += 1;
          throw new Error("The model returned malformed JSON.");
        },
      }),
    /malformed JSON/,
  );

  assert.equal(calls, 1);
});

test("formatTransientModelError and retry delay provide stable fallbacks", () => {
  assert.equal(
    formatTransientModelError({}),
    "The model request failed with a transient network error.",
  );
  assert.equal(getTransientModelRetryDelayMs(1), 500);
  assert.equal(getTransientModelRetryDelayMs(4), 4000);
});
