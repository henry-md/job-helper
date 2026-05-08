import assert from "node:assert/strict";
import test from "node:test";
import { buildTailorResumeKeywordClassificationInstructions } from "../lib/tailor-resume-keyword-classification-prompt.ts";

test("keyword classification prompt makes Skills-section placement the top rule", () => {
  const prompt = buildTailorResumeKeywordClassificationInstructions();

  assert.match(prompt, /by resume placement/i);
  assert.match(
    prompt,
    /Above all else, choose `skills_section` only when the exact keyword is something a realistic candidate could list as a standalone entry in the Skills or Technical Skills section/i,
  );
  assert.match(
    prompt,
    /Do not choose `skills_section` merely because a keyword is technical, important, high-priority, or useful to mention/i,
  );
  assert.match(prompt, /If the exact phrase would look awkward.*choose `narrative`/i);
  assert.match(prompt, /Priority does not affect category/i);
  assert.match(prompt, /high-priority narrative keyword is still `narrative`/i);
});
