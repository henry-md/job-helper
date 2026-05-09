import assert from "node:assert/strict";
import test from "node:test";
import { buildTailorResumeKeywordClassificationInstructions } from "../lib/system-prompt-settings.ts";

test("keyword classification prompt makes Skills-section placement the top rule", () => {
  const prompt = buildTailorResumeKeywordClassificationInstructions();

  assert.match(prompt, /two indepenedent dimensions/i);
  assert.match(
    prompt,
    /First dimension: Choose `skills_section` only when the exact keyword is something a software engineering candidate would list as a standalone entry in the Skills or Technical Skills section/i,
  );
  assert.match(
    prompt,
    /Do not choose `skills_section` merely because a keyword is technical, important, high-priority, or useful to mention/i,
  );
  assert.match(prompt, /If the exact phrase would look awkward.*choose `narrative`/i);
  assert.match(prompt, /Priority does not affect category/i);
  assert.match(prompt, /high-priority narrative keyword is still `narrative`/i);
});
