import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { buildTailorResumePlanningSnapshot } from "../lib/tailor-resume-planning.ts";

test("buildTailorResumePlanningSnapshot returns plaintext blocks in document order", () => {
  const snapshot = buildTailorResumePlanningSnapshot(tailorResumeLatexExample);

  assert.ok(snapshot.blocks.length > 0);
  assert.equal(snapshot.resumePlainText.includes("WORK EXPERIENCE"), true);
  assert.equal(
    snapshot.blocks.some(
      (block) =>
        block.segmentId.includes(".bullet-1") &&
        block.plainText.includes("ad similarity detection service"),
    ),
    true,
  );
  assert.equal(
    snapshot.blocks.every((block) => block.plainText.trim().length > 0),
    true,
  );
});
