import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TailorResumeInterviewArgsStreamer } from "../lib/tailor-resume-interview-stream-parser.ts";

test("emits text deltas as assistantMessage grows and cards as they close", () => {
  const fullArgs = JSON.stringify({
    assistantMessage:
      "Do you have experience with Go, Cassandra, or Spark? Reply with yes/no for each.",
    debugDecision: "not_applicable",
    learnings: [],
    keywordDecisions: [],
    technologyContexts: [
      {
        name: "Go",
        definition:
          "Statically typed compiled programming language designed at Google.",
        examples: ["Built a service in Go -- Go", "Migrated APIs to Go -- Go"],
      },
      {
        name: "Cassandra",
        definition: "Distributed wide-column NoSQL database.",
        examples: [
          "Tuned Cassandra cluster -- Cassandra",
          "Designed schema -- Cassandra",
        ],
      },
    ],
    userMarkdownEditOperations: [],
  });

  const streamer = new TailorResumeInterviewArgsStreamer();
  const events: Array<
    | { field: "assistantMessage" | "completionMessage"; kind: "text-start" }
    | {
        delta: string;
        field: "assistantMessage" | "completionMessage";
        kind: "text-delta";
      }
    | { card: unknown; kind: "card" }
  > = [];

  for (let i = 0; i < fullArgs.length; i += 17) {
    const chunk = fullArgs.slice(i, i + 17);
    events.push(...streamer.feed(chunk));
  }

  const textDeltas = events.filter((e) => e.kind === "text-delta");
  const textStarts = events.filter((e) => e.kind === "text-start");
  const cards = events.filter((e) => e.kind === "card");
  const reconstructed = textDeltas
    .map((e) => (e.kind === "text-delta" ? e.delta : ""))
    .join("");

  assert.equal(
    reconstructed,
    "Do you have experience with Go, Cassandra, or Spark? Reply with yes/no for each.",
  );
  assert.equal(textStarts.length, 1);
  assert.equal(textStarts[0]?.field, "assistantMessage");
  assert.ok(
    textDeltas.every(
      (event) => event.kind === "text-delta" && event.field === "assistantMessage",
    ),
    "expected assistantMessage text deltas",
  );
  assert.ok(textDeltas.length > 1, "expected multiple text deltas");
  assert.equal(cards.length, 2);
  assert.equal(
    (cards[0] as { card: { name: string } }).card.name,
    "Go",
  );
  assert.equal(
    (cards[1] as { card: { name: string } }).card.name,
    "Cassandra",
  );
});

test("handles escape sequences and partial unicode escapes safely", () => {
  const streamer = new TailorResumeInterviewArgsStreamer();
  const fullArgs = `{"assistantMessage":"Hello\\n\\"world\\""}`;
  const events: Array<
    | { field: "assistantMessage" | "completionMessage"; kind: "text-start" }
    | {
        delta: string;
        field: "assistantMessage" | "completionMessage";
        kind: "text-delta";
      }
    | { card: unknown; kind: "card" }
  > = [];

  for (let i = 0; i < fullArgs.length; i += 3) {
    events.push(...streamer.feed(fullArgs.slice(i, i + 3)));
  }

  const reconstructed = events
    .map((e) => (e.kind === "text-delta" ? e.delta : ""))
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

  const events: Array<
    | { field: "assistantMessage" | "completionMessage"; kind: "text-start" }
    | {
        delta: string;
        field: "assistantMessage" | "completionMessage";
        kind: "text-delta";
      }
    | { card: unknown; kind: "card" }
  > = [];

  for (let i = 0; i < fullArgs.length; i += 11) {
    events.push(...streamer.feed(fullArgs.slice(i, i + 11)));
  }

  const reconstructed = events
    .map((e) => (e.kind === "text-delta" ? e.delta : ""))
    .join("");
  const textStarts = events.filter((e) => e.kind === "text-start");
  const textDeltas = events.filter((e) => e.kind === "text-delta");
  assert.equal(textStarts.length, 1);
  assert.equal(textStarts[0]?.field, "completionMessage");
  assert.ok(
    textDeltas.every(
      (event) => event.kind === "text-delta" && event.field === "completionMessage",
    ),
    "expected completionMessage text deltas",
  );
  assert.equal(reconstructed, "Want to wrap up the chat now?");
});
