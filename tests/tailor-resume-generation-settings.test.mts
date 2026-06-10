import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTailorResumeGenerationSettings,
  mergeTailorResumeGenerationSettings,
} from "../lib/tailor-resume-generation-settings.ts";

test("createDefaultTailorResumeGenerationSettings enables ludicrous mode and page-count protection", () => {
  assert.deepEqual(createDefaultTailorResumeGenerationSettings(), {
    allowTailorResumeFollowUpQuestions: true,
    customResumeDownloadName: "Resume",
    includeLowPriorityTermsInKeywordCoverage: false,
    ludicrousMode: true,
    masterChatModel: "gpt-5.4",
    preventPageCountIncrease: true,
    step1Model: "gpt-5.4-mini",
    step3Model: "anthropic:claude-sonnet-4-6",
    step4Model: "gpt-5.5",
    step4bModel: "gpt-5.4",
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
      masterChatModel: "gpt-5.4",
      preventPageCountIncrease: false,
      step1Model: "gpt-5.4-mini",
      step3Model: "anthropic:claude-sonnet-4-6",
      step4Model: "gpt-5.5",
      step4bModel: "gpt-5.4",
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
      ludicrousMode: true,
      masterChatModel: "gpt-5.4",
      preventPageCountIncrease: false,
      step1Model: "gpt-5.4-mini",
      step3Model: "anthropic:claude-sonnet-4-6",
      step4Model: "gpt-5.5",
      step4bModel: "gpt-5.4",
      useCustomResumeDownloadName: false,
    },
  );
});
