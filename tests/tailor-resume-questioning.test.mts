import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTailorResumeQuestioning,
  isDebugForceConversationInTailorPipelineEnabled,
  normalizeTailorResumeInterviewResponseForCurrentTurn,
  parseTailorResumeInterviewResponseFromModelOutput,
} from "../lib/tailor-resume-questioning.ts";

test("isDebugForceConversationInTailorPipelineEnabled reads common true values", () => {
  const previousValue =
    process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = "yes";

  try {
    assert.equal(isDebugForceConversationInTailorPipelineEnabled(), true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;
    } else {
      process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = previousValue;
    }
  }
});

test("isDebugForceConversationInTailorPipelineEnabled defaults off", () => {
  const previousValue =
    process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  try {
    assert.equal(isDebugForceConversationInTailorPipelineEnabled(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;
    } else {
      process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = previousValue;
    }
  }
});

test("advanceTailorResumeQuestioning skips immediately when no block edits are planned", async () => {
  const result = await advanceTailorResumeQuestioning({
    conversation: [],
    jobDescription: "Role text",
    planningResult: {
      changes: [],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "Research Engineer",
      positionTitle: "Research Engineer",
      questioningSummary: null,
      thesis: {
        jobDescriptionFocus: "Focus",
        resumeChanges: "Changes",
      },
    },
    planningSnapshot: {
      blocks: [],
      resumePlainText: "Existing resume text",
    },
  });

  assert.equal(result.action, "skip");
  assert.equal(result.questioningSummary, null);
});

test("normalizeTailorResumeInterviewResponseForCurrentTurn does not treat post-start skip as done", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    previousSummary: {
      agenda: "deployment details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "skip",
      assistantMessage: "",
      completionMessage: "",
      debugDecision: "not_applicable",
      learnings: [],
      userMarkdownEditOperations: [],
    },
  });

  assert.equal(response.action, "skip");
});

test("parseTailorResumeInterviewResponseFromModelOutput reads finish tool calls", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          learnings: [
            {
              detail: "Owned LLM deployment latency work.",
              targetSegmentIds: ["segment-1"],
              topic: "LLM deployment",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-1",
        name: "finish_tailor_resume_interview",
        type: "function_call",
      },
    ],
    output_text:
      "I have enough detail to wrap up, and I am updating USER.md with that context.",
  });

  assert.equal(response.response.action, "done");
  assert.equal(response.response.assistantMessage, "");
  assert.equal(
    response.response.completionMessage,
    "I have enough detail to wrap up, and I am updating USER.md with that context.",
  );
  assert.equal(response.response.debugDecision, "not_applicable");
  assert.equal(
    response.response.learnings[0]?.targetSegmentIds[0],
    "segment-1",
  );
  assert.equal(response.toolCalls[0]?.name, "finish_tailor_resume_interview");
});

test("parseTailorResumeInterviewResponseFromModelOutput reads ask tool calls with assistant text", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          debugDecision: "not_applicable",
          learnings: [
            {
              detail:
                "Need the model family, serving stack, and one measurable outcome from the Java LLM pipeline work.",
              targetSegmentIds: ["segment-2"],
              topic: "Java LLM pipeline",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-2",
        name: "ask_tailor_resume_follow_up",
        type: "function_call",
      },
    ],
    output_text:
      "For a Java backend angle, strong answers would sound like 'I owned the Spring Boot API layer around the LLM pipeline' or 'I built the Java service flow for prompt orchestration, retrieval, and eval logging.' Which model family, serving stack, and measurable outcome best match your work?",
  });

  assert.equal(response.response.action, "ask");
  assert.match(response.response.assistantMessage, /Spring Boot API layer/i);
  assert.match(
    response.response.assistantMessage,
    /Which model family, serving stack, and measurable outcome/i,
  );
  assert.equal(response.response.debugDecision, "not_applicable");
  assert.equal(response.toolCalls[0]?.name, "ask_tailor_resume_follow_up");
});

test("parseTailorResumeInterviewResponseFromModelOutput rejects plain JSON text", () => {
  assert.throws(
    () =>
      parseTailorResumeInterviewResponseFromModelOutput({
        output_text: JSON.stringify({
          action: "done",
          debugDecision: "not_applicable",
          learnings: [],
        }),
      }),
    /tool call/i,
  );
});
