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
        block.segmentId.includes(".bullet-") &&
        block.plainText.includes("ad similarity detection service"),
    ),
    true,
  );
  assert.equal(
    snapshot.blocks.every((block) => block.plainText.trim().length > 0),
    true,
  );
  assert.equal(
    snapshot.blocks.some(
      (block) =>
        block.segmentId.includes(".bullet-") &&
        block.plainText.includes(
          "Built and migrated 100% of internal account managers and external clients",
        ),
    ),
    true,
  );
});

test("buildTailorResumePlanningSnapshot keeps adjacent resumeitem plaintext separate", () => {
  const latex = String.raw`
\resumeSection{WORK EXPERIENCE}
\entryheading{Example Co}{Engineer}{2024}
\begin{resumebullets}
  \resumeitem{First bullet}
  \resumeitem{Second bullet}
\end{resumebullets}
`;
  const snapshot = buildTailorResumePlanningSnapshot(latex);
  const bulletBlocks = snapshot.blocks.filter((block) =>
    block.segmentId.includes(".bullet-"),
  );

  assert.deepEqual(
    bulletBlocks.map((block) => block.segmentId),
    [
      "work-experience.entry-1.bullet-1",
      "work-experience.entry-1.bullet-2",
    ],
  );
  assert.deepEqual(
    bulletBlocks.map((block) => block.plainText),
    ["First bullet", "Second bullet"],
  );
});
