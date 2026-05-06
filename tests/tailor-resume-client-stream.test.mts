import assert from "node:assert/strict";
import test from "node:test";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
  readTailorResumeUploadStream,
} from "../lib/tailor-resume-client-stream.ts";

test("isNdjsonResponse detects ndjson responses", () => {
  const response = new Response("", {
    headers: {
      "Content-Type": "text/x-ndjson; charset=utf-8",
    },
  });

  assert.equal(isNdjsonResponse(response), true);
});

test("readTailorResumeUploadStream yields attempt events and final payload", async () => {
  const attemptEvents: unknown[] = [];
  const response = new Response(
    [
      JSON.stringify({
        attemptEvent: {
          attempt: 1,
          error: null,
          linkSummary: null,
          outcome: "succeeded",
          willRetry: false,
        },
        type: "extraction-attempt",
      }),
      JSON.stringify({
        payload: {
          savedLinkUpdateCount: 2,
        },
        type: "done",
      }),
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/x-ndjson",
      },
    },
  );

  const payload = await readTailorResumeUploadStream(response, {
    onAttemptEvent: (attemptEvent) => {
      attemptEvents.push(attemptEvent);
    },
    parsePayload: (value) => value as { savedLinkUpdateCount: number },
  });

  assert.equal(attemptEvents.length, 1);
  assert.deepEqual(payload, { savedLinkUpdateCount: 2 });
});

test("readTailorResumeGenerationStream parses step events and final payload", async () => {
  const stepEvents: Array<{ summary: string }> = [];
  const response = new Response(
    [
      JSON.stringify({
        stepEvent: {
          summary: "Clarify missing details",
        },
        type: "generation-step",
      }),
      JSON.stringify({
        ok: true,
        payload: {
          tailoringStatus: "needs_user_input",
        },
        status: 202,
        type: "done",
      }),
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/x-ndjson",
      },
    },
  );

  const result = await readTailorResumeGenerationStream(response, {
    onStepEvent: (stepEvent) => {
      stepEvents.push(stepEvent);
    },
    parsePayload: (value) => value as { tailoringStatus: string },
    parseStepEvent: (value) =>
      typeof value === "object" && value !== null
        ? (value as { summary: string })
        : null,
  });

  assert.deepEqual(stepEvents, [{ summary: "Clarify missing details" }]);
  assert.deepEqual(result, {
    ok: true,
    payload: {
      tailoringStatus: "needs_user_input",
    },
    status: 202,
  });
});

test("readTailorResumeGenerationStream emits saved USER.md payloads before final payload", async () => {
  const userMemoryEvents: Array<{ userMarkdown: { markdown: string } }> = [];
  const response = new Response(
    [
      JSON.stringify({
        payload: {
          userMarkdown: {
            markdown: "# USER.md\n\n## Grafana\n\n- saved\n",
          },
        },
        type: "user-memory",
      }),
      JSON.stringify({
        ok: true,
        payload: {
          tailoringStatus: "running",
        },
        status: 202,
        type: "done",
      }),
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/x-ndjson",
      },
    },
  );

  const result = await readTailorResumeGenerationStream(response, {
    onUserMemoryEvent: (payload) => {
      userMemoryEvents.push(payload);
    },
    parsePayload: (value) => value as { tailoringStatus: string },
    parseStepEvent: () => null,
    parseUserMemoryPayload: (value) =>
      value as { userMarkdown: { markdown: string } },
  });

  assert.deepEqual(userMemoryEvents, [
    {
      userMarkdown: {
        markdown: "# USER.md\n\n## Grafana\n\n- saved\n",
      },
    },
  ]);
  assert.deepEqual(result.payload, {
    tailoringStatus: "running",
  });
});
