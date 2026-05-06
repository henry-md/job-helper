import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTailorInterviewStreamEventToMessage,
  hasTailorInterviewStreamedMessageContent,
  isTailorResumeInterviewEndStepEvent,
  mergeTailorInterviewWithStreamedAssistantMessage,
} from "../extension/src/tailor-interview-flow.ts";

test("detects when the Step 2 interview model has ended the chat", () => {
  assert.equal(
    isTailorResumeInterviewEndStepEvent({
      attempt: 1,
      detail:
        "Saved the latest follow-up answer and started the remaining tailoring steps.",
      durationMs: 1200,
      retrying: false,
      status: "succeeded",
      stepCount: 5,
      stepNumber: 2,
      summary: "Finished the follow-up questions",
    }),
    true,
  );
});

test("does not treat another Step 2 question as chat completion", () => {
  assert.equal(
    isTailorResumeInterviewEndStepEvent({
      attempt: 2,
      detail:
        "One more follow-up question is ready, so Step 2 is still waiting for the user's answer.",
      durationMs: 900,
      retrying: false,
      status: "running",
      stepCount: 5,
      stepNumber: 2,
      summary: "Waiting for another follow-up answer from the user",
    }),
    false,
  );
});

test("ignores non-Step 2 completion events", () => {
  assert.equal(
    isTailorResumeInterviewEndStepEvent({
      attempt: 1,
      detail: "Generated the block-scoped edits.",
      durationMs: 4000,
      retrying: false,
      status: "succeeded",
      stepCount: 5,
      stepNumber: 4,
      summary: "Generated block-scoped edits",
    }),
    false,
  );
});

test("preserves streamed interview text across reset and text-start events", () => {
  const message = {
    id: "streaming",
    role: "assistant" as const,
    technologyContexts: [],
    text: "Keep this text",
    toolCalls: [],
  };

  const afterReset = applyTailorInterviewStreamEventToMessage(message, {
    kind: "reset",
  });
  const afterStart = applyTailorInterviewStreamEventToMessage(afterReset, {
    field: "assistantMessage",
    kind: "text-start",
  });
  const afterDelta = applyTailorInterviewStreamEventToMessage(afterStart, {
    delta: " and append this",
    field: "assistantMessage",
    kind: "text-delta",
  });

  assert.equal(afterDelta.text, "Keep this text and append this");
  assert.equal(hasTailorInterviewStreamedMessageContent(afterDelta), true);
});

test("merges streamed interview cards back into the final server conversation", () => {
  const streamedMessage = {
    id: "streaming",
    role: "assistant" as const,
    technologyContexts: [
      {
        definition: "Azure hosts cloud services.",
        examples: ["Built Azure deployment -- NewForm"],
        name: "Azure",
      },
    ],
    text: "Streamed question text.",
    toolCalls: [],
  };
  const interview = {
    applicationId: null,
    companyName: "Example Co",
    completionRequestedAt: null,
    conversation: [
      {
        id: "assistant-final",
        role: "assistant" as const,
        technologyContexts: [],
        text: "Final question text.",
        toolCalls: [
          {
            argumentsText: "{}",
            name: "initiate_tailor_resume_probing_questions",
          },
        ],
      },
    ],
    emphasizedTechnologies: [],
    id: "interview",
    jobIdentifier: null,
    jobUrl: null,
    positionTitle: null,
    questioningSummary: null,
    tailorResumeRunId: null,
    updatedAt: "2026-05-06T00:00:00.000Z",
  };

  const merged = mergeTailorInterviewWithStreamedAssistantMessage(
    interview,
    streamedMessage,
  );

  assert.equal(merged?.conversation.length, 1);
  assert.match(merged?.conversation[0]?.text ?? "", /Streamed question text/);
  assert.match(merged?.conversation[0]?.text ?? "", /Final question text/);
  assert.deepEqual(merged?.conversation[0]?.technologyContexts, [
    {
      definition: "Azure hosts cloud services.",
      examples: ["Built Azure deployment -- NewForm"],
      name: "Azure",
    },
  ]);
});
