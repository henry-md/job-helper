import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTailorResumeGenerationSettings,
  mergeTailorResumeGenerationSettings,
} from "../lib/tailor-resume-generation-settings.ts";

test("createDefaultTailorResumeGenerationSettings enables page-count protection", () => {
  assert.deepEqual(createDefaultTailorResumeGenerationSettings(), {
    allowTailorResumeFollowUpQuestions: true,
    customResumeDownloadName: "Resume",
    includeLowPriorityTermsInKeywordCoverage: false,
    ludicrousMode: false,
    preventPageCountIncrease: true,
    useCustomResumeDownloadName: false,
  });
});

test("mergeTailorResumeGenerationSettings keeps visible saved overrides", () => {
  assert.deepEqual(
    mergeTailorResumeGenerationSettings({
      allowTailorResumeFollowUpQuestions: false,
      customResumeDownloadName: "Henry Deutsch Resume",
      includeLowPriorityTermsInKeywordCoverage: true,
      ludicrousMode: true,
      preventPageCountIncrease: false,
      useCustomResumeDownloadName: true,
    }),
    {
      allowTailorResumeFollowUpQuestions: false,
      customResumeDownloadName: "Henry Deutsch Resume",
      includeLowPriorityTermsInKeywordCoverage: true,
      ludicrousMode: true,
      preventPageCountIncrease: false,
      useCustomResumeDownloadName: true,
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
      customResumeDownloadName: "Resume",
      includeLowPriorityTermsInKeywordCoverage: false,
      ludicrousMode: false,
      preventPageCountIncrease: false,
      useCustomResumeDownloadName: false,
    },
  );
});
