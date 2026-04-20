import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResumeLatexSystemPrompt,
  buildTailorResumeImplementationSystemPrompt,
  buildTailorResumePlanningSystemPrompt,
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
  mergeSystemPromptSettings,
} from "../lib/system-prompt-settings.ts";

test("mergeSystemPromptSettings preserves defaults for missing keys", () => {
  const mergedSettings = mergeSystemPromptSettings({
    tailorResumePlanning: "Custom planning prompt",
  });

  assert.equal(
    mergedSettings.tailorResumePlanning,
    "Custom planning prompt",
  );
  assert.equal(typeof mergedSettings.resumeLatexExtraction, "string");
  assert.equal(typeof mergedSettings.tailorResumeRefinement, "string");
});

test("buildResumeLatexSystemPrompt injects retry tokens", () => {
  const prompt = buildResumeLatexSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      attempt: 2,
      maxAttempts: 3,
    },
  );

  assert.match(prompt, /Retry attempt 2 of 3:/);
  assert.match(prompt, /You have at most 3 validation attempts\./);
  assert.equal(prompt.includes("{{RETRY_INSTRUCTIONS}}"), false);
  assert.equal(prompt.includes("{{MAX_ATTEMPTS}}"), false);
});

test("buildTailorResumePlanningSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "Missing thesis object",
    },
  );

  assert.match(prompt, /Previous attempt feedback:/);
  assert.match(prompt, /Missing thesis object/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeImplementationSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeImplementationSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "Unknown segment returned",
    },
  );

  assert.match(prompt, /Previous implementation feedback:/);
  assert.match(prompt, /Unknown segment returned/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeRefinementSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "The previous refinement did not compile.",
    },
  );

  assert.match(prompt, /Previous refinement feedback:/);
  assert.match(prompt, /did not compile/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});
