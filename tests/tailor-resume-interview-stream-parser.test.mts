import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TailorResumeInterviewArgsStreamer } from "../lib/tailor-resume-interview-stream-parser.ts";

type TextStreamEvent =
  | { field: "assistantMessage" | "completionMessage"; kind: "text-start" }
  | {
      delta: string;
      field: "assistantMessage" | "completionMessage";
      kind: "text-delta";
    };

test("emits text deltas as assistantMessage grows", () => {
  const fullArgs = JSON.stringify({
    assistantMessage:
      "Do you have experience with Go, Cassandra, or Spark? Reply with yes/no for each.",
    debugDecision: "not_applicable",
    learnings: [],
    keywordDecisions: [],
    userMarkdownEditOperations: [],
  });

  const streamer = new TailorResumeInterviewArgsStreamer();
  const events: TextStreamEvent[] = [];

  for (let i = 0; i < fullArgs.length; i += 17) {
    events.push(...streamer.feed(fullArgs.slice(i, i + 17)));
  }

  const textDeltas = events.filter((event) => event.kind === "text-delta");
  const textStarts = events.filter((event) => event.kind === "text-start");
  const reconstructed = textDeltas
    .map((event) => (event.kind === "text-delta" ? event.delta : ""))
    .join("");

  assert.equal(
    reconstructed,
    "Do you have experience with Go, Cassandra, or Spark? Reply with yes/no for each.",
  );
  assert.equal(textStarts.length, 1);
  assert.equal(textStarts[0]?.field, "assistantMessage");
  assert.ok(textDeltas.length > 1, "expected multiple text deltas");
});

test("handles escape sequences and partial unicode escapes safely", () => {
  const streamer = new TailorResumeInterviewArgsStreamer();
  const fullArgs = `{"assistantMessage":"Hello\\n\\"world\\""}`;
  const events: TextStreamEvent[] = [];

  for (let i = 0; i < fullArgs.length; i += 3) {
    events.push(...streamer.feed(fullArgs.slice(i, i + 3)));
  }

  const reconstructed = events
    .map((event) => (event.kind === "text-delta" ? event.delta : ""))
    .join("");

  assert.equal(reconstructed, 'Hello\n"world"');
});

test("emits text from completionMessage when finish tool is called", () => {
  const streamer = new TailorResumeInterviewArgsStreamer();
  const fullArgs = JSON.stringify({
    completionMessage: "Want to wrap up the chat now?",
    learnings: [],
    keywordDecisions: [],
    userMarkdownEditOperations: [],
  });
  const events: TextStreamEvent[] = [];

  for (let i = 0; i < fullArgs.length; i += 11) {
    events.push(...streamer.feed(fullArgs.slice(i, i + 11)));
  }

  const reconstructed = events
    .map((event) => (event.kind === "text-delta" ? event.delta : ""))
    .join("");
  const textStarts = events.filter((event) => event.kind === "text-start");

  assert.equal(textStarts.length, 1);
  assert.equal(textStarts[0]?.field, "completionMessage");
  assert.equal(reconstructed, "Want to wrap up the chat now?");
});
