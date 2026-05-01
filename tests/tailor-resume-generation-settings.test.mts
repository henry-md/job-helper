import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTailorResumeGenerationSettings,
  mergeTailorResumeGenerationSettings,
} from "../lib/tailor-resume-generation-settings.ts";

test("createDefaultTailorResumeGenerationSettings enables page-count protection", () => {
  assert.deepEqual(createDefaultTailorResumeGenerationSettings(), {
    allowTailorResumeFollowUpQuestions: true,
    includeLowPriorityTermsInKeywordCoverage: false,
    preventPageCountIncrease: true,
  });
});

test("mergeTailorResumeGenerationSettings keeps explicit saved overrides", () => {
  assert.deepEqual(
    mergeTailorResumeGenerationSettings({
      allowTailorResumeFollowUpQuestions: false,
      includeLowPriorityTermsInKeywordCoverage: true,
      preventPageCountIncrease: false,
    }),
    {
      allowTailorResumeFollowUpQuestions: false,
      includeLowPriorityTermsInKeywordCoverage: true,
      preventPageCountIncrease: false,
    },
  );
});

test("mergeTailorResumeGenerationSettings defaults missing follow-up toggle on", () => {
  assert.deepEqual(
    mergeTailorResumeGenerationSettings({
      preventPageCountIncrease: false,
    }),
    {
      allowTailorResumeFollowUpQuestions: true,
      includeLowPriorityTermsInKeywordCoverage: false,
      preventPageCountIncrease: false,
    },
  );
});
