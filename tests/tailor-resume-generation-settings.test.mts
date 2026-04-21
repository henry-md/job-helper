import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTailorResumeGenerationSettings,
  mergeTailorResumeGenerationSettings,
} from "../lib/tailor-resume-generation-settings.ts";

test("createDefaultTailorResumeGenerationSettings enables page-count protection", () => {
  assert.deepEqual(createDefaultTailorResumeGenerationSettings(), {
    preventPageCountIncrease: true,
  });
});

test("mergeTailorResumeGenerationSettings keeps explicit saved overrides", () => {
  assert.deepEqual(
    mergeTailorResumeGenerationSettings({
      preventPageCountIncrease: false,
    }),
    {
      preventPageCountIncrease: false,
    },
  );
});
