import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletedTailoringMessage } from "../extension/src/tailor-run-copy.ts";

test("buildCompletedTailoringMessage keeps successful completions concise", () => {
  assert.equal(
    buildCompletedTailoringMessage({
      jobLabel: "Software Engineer at Microsoft",
    }),
    "Tailored resume for Software Engineer at Microsoft is ready.",
  );
});

test("buildCompletedTailoringMessage humanizes the same-line-count step 4 warning", () => {
  assert.equal(
    buildCompletedTailoringMessage({
      jobLabel: "Software Engineer at Microsoft",
      tailoredResumeError:
        "Step 4: No proposed compaction candidate reduced its block's measured rendered line count.",
    }),
    "Saved a tailored draft for Software Engineer at Microsoft, but Step 4 couldn't reduce the page size.",
  );
});

test("buildCompletedTailoringMessage falls back to the raw warning when needed", () => {
  assert.equal(
    buildCompletedTailoringMessage({
      jobLabel: "Software Engineer at Microsoft",
      tailoredResumeError: "Step 4: Another warning.",
    }),
    "Saved a tailored draft for Software Engineer at Microsoft, but it still needs review: Another warning.",
  );
});
