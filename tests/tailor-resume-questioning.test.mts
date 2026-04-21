import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTailorResumeQuestioning,
  isDebugForceConversationInTailorPipelineEnabled,
  normalizeTailorResumeInterviewResponseForCurrentTurn,
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

test("normalizeTailorResumeInterviewResponseForCurrentTurn treats post-start skip as done", () => {
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

  assert.equal(response.action, "done");
});
