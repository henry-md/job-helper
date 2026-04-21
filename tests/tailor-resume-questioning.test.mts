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
      totalQuestionBudget: 1,
    },
    response: {
      action: "skip",
      agenda: "deployment details",
      debugDecision: "not_applicable",
      learnings: [],
      question: "",
      totalQuestionBudget: 1,
    },
  });

  assert.equal(response.action, "skip");
});

test("parseTailorResumeInterviewResponseFromModelOutput reads finish tool calls", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          agenda: "deployment details",
          learnings: [
            {
              detail: "Owned LLM deployment latency work.",
              targetSegmentIds: ["segment-1"],
              topic: "LLM deployment",
            },
          ],
          totalQuestionBudget: 2,
        }),
        call_id: "call-1",
        name: "finish_tailor_resume_interview",
        type: "function_call",
      },
    ],
  });

  assert.equal(response.action, "done");
  assert.equal(response.question, "");
  assert.equal(response.debugDecision, "not_applicable");
  assert.equal(response.learnings[0]?.targetSegmentIds[0], "segment-1");
});

test("parseTailorResumeInterviewResponseFromModelOutput rejects plain JSON text", () => {
  assert.throws(
    () =>
      parseTailorResumeInterviewResponseFromModelOutput({
        output_text: JSON.stringify({
          action: "done",
          agenda: "deployment details",
          debugDecision: "not_applicable",
          learnings: [],
          question: "",
          totalQuestionBudget: 1,
        }),
      }),
    /tool call/i,
  );
});
