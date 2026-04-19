import assert from "node:assert/strict";
import test from "node:test";
import { withTailorResumeProfileLock } from "../lib/tailor-resume-storage.ts";

test("withTailorResumeProfileLock serializes overlapping mutations for the same user", async () => {
  const executionOrder: string[] = [];
  let sharedCount = 0;
  let releaseFirstMutation!: () => void;
  let signalFirstMutationStarted!: () => void;
  const firstMutationStarted = new Promise<void>((resolve) => {
    signalFirstMutationStarted = resolve;
  });
  const firstMutationCanFinish = new Promise<void>((resolve) => {
    releaseFirstMutation = resolve;
  });

  const firstMutation = withTailorResumeProfileLock("user-1", async () => {
    const snapshot = sharedCount;
    executionOrder.push(`start:first:${snapshot}`);
    signalFirstMutationStarted();
    await firstMutationCanFinish;
    sharedCount = snapshot + 1;
    executionOrder.push(`end:first:${sharedCount}`);
  });

  await firstMutationStarted;

  const secondMutation = withTailorResumeProfileLock("user-1", async () => {
    const snapshot = sharedCount;
    executionOrder.push(`start:second:${snapshot}`);
    sharedCount = snapshot + 1;
    executionOrder.push(`end:second:${sharedCount}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(executionOrder, ["start:first:0"]);

  releaseFirstMutation();
  await Promise.all([firstMutation, secondMutation]);

  assert.equal(sharedCount, 2);
  assert.deepEqual(executionOrder, [
    "start:first:0",
    "end:first:1",
    "start:second:1",
    "end:second:2",
  ]);
});

test("withTailorResumeProfileLock continues processing after a failed mutation", async () => {
  const executionOrder: string[] = [];

  await assert.rejects(
    withTailorResumeProfileLock("user-2", async () => {
      executionOrder.push("first");
      throw new Error("boom");
    }),
    /boom/,
  );

  await withTailorResumeProfileLock("user-2", async () => {
    executionOrder.push("second");
  });

  assert.deepEqual(executionOrder, ["first", "second"]);
});
