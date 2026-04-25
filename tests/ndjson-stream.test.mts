import assert from "node:assert/strict";
import test from "node:test";
import { createNdjsonStreamWriter } from "../lib/ndjson-stream.ts";

test("ndjson stream writer makes close idempotent", () => {
  let closeCount = 0;
  const writer = createNdjsonStreamWriter({
    close() {
      closeCount += 1;
    },
    enqueue() {},
  });

  assert.equal(writer.close(), true);
  assert.equal(writer.close(), false);
  assert.equal(closeCount, 1);
});

test("ndjson stream writer swallows enqueue failures after the controller is no longer writable", () => {
  let enqueueCount = 0;
  const writer = createNdjsonStreamWriter({
    close() {},
    enqueue() {
      enqueueCount += 1;
      throw new TypeError("Invalid state: Controller is already closed");
    },
  });

  assert.equal(writer.sendEvent({ type: "generation-step" }), false);
  assert.equal(writer.sendEvent({ type: "done" }), false);
  assert.equal(writer.close(), false);
  assert.equal(enqueueCount, 1);
});
