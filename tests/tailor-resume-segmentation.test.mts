import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  buildUniqueTailorResumeSegmentId,
  hasValidTailorResumeSegmentIds,
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";

test("normalizeTailorResumeLatex injects deterministic segment ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);

  assert.equal(normalized.segmentCount > 0, true);
  assert.equal(
    normalized.annotatedLatex.includes("% JOBHELPER_SEGMENT_ID:"),
    true,
  );
  assert.equal(hasValidTailorResumeSegmentIds(normalized.annotatedLatex), true);
  assert.equal(
    normalized.annotatedLatex.includes(
      "% JOBHELPER_SEGMENT_ID: document.documentclass-article-1",
    ),
    true,
  );
  assert.equal(
    normalized.annotatedLatex.includes(
      "% JOBHELPER_SEGMENT_ID: document.usepackage-geometry-1",
    ),
    true,
  );
  assert.equal(
    stripTailorResumeSegmentIds(normalized.annotatedLatex).includes(
      "\\resumeSection{WORK EXPERIENCE}",
    ),
    true,
  );
});

test("normalizeTailorResumeLatex is stable across re-normalization", () => {
  const firstPass = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const secondPass = normalizeTailorResumeLatex(firstPass.annotatedLatex);

  assert.equal(secondPass.annotatedLatex, firstPass.annotatedLatex);
  assert.equal(secondPass.segmentCount, firstPass.segmentCount);
});

test("normalizeTailorResumeLatex splits top-level body blocks inside technical skills", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const technicalSkillBlocks = readAnnotatedTailorResumeBlocks(
    normalized.annotatedLatex,
  ).filter((block) => block.id.startsWith("technical-skills."));

  assert.equal(technicalSkillBlocks[0]?.id, "technical-skills.section-1");
  assert.equal(
    technicalSkillBlocks[technicalSkillBlocks.length - 1]?.id,
    "technical-skills.end-document-1",
  );
  assert.equal(
    technicalSkillBlocks.filter((block) => block.command === "labelline").length,
    3,
  );
});

test("normalizeTailorResumeLatex keeps adjacent resumeitem commands in separate blocks", () => {
  const latex = String.raw`
\resumeSection{WORK EXPERIENCE}
\entryheading{Example Co}{Engineer}{2024}
\begin{resumebullets}
  \resumeitem{First bullet}
  \resumeitem{Second bullet}
\end{resumebullets}
`;
  const normalized = normalizeTailorResumeLatex(latex);
  const bulletBlocks = readAnnotatedTailorResumeBlocks(
    normalized.annotatedLatex,
  ).filter((block) => block.command === "resumeitem");

  assert.deepEqual(
    bulletBlocks.map((block) => block.id),
    [
      "work-experience.entry-1.bullet-1",
      "work-experience.entry-1.bullet-2",
    ],
  );
  assert.equal(bulletBlocks[0]?.latexCode.trim(), "\\resumeitem{First bullet}");
  assert.equal(bulletBlocks[1]?.latexCode.trim(), "\\resumeitem{Second bullet}");
});

test("normalizeTailorResumeLatex preserves downstream segment ids when inserting a bullet", () => {
  const latex = String.raw`
\resumeSection{WORK EXPERIENCE}
\entryheading{Example Co}{Engineer}{2024}
\begin{resumebullets}
  \resumeitem{First bullet}
  \resumeitem{Second bullet}
\end{resumebullets}
`;
  const firstPass = normalizeTailorResumeLatex(latex);
  const withInsertedBullet = firstPass.annotatedLatex.replace(
    "  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
    "  \\resumeitem{Inserted bullet}\n  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
  );
  const normalized = normalizeTailorResumeLatex(withInsertedBullet);
  const bulletBlocks = readAnnotatedTailorResumeBlocks(
    normalized.annotatedLatex,
  ).filter((block) => block.command === "resumeitem");

  assert.equal(bulletBlocks.length, 3);
  assert.equal(bulletBlocks[0]?.id, "work-experience.entry-1.bullet-1");
  assert.equal(bulletBlocks[0]?.latexCode.trim(), "\\resumeitem{First bullet}");
  assert.notEqual(bulletBlocks[1]?.id, "work-experience.entry-1.bullet-2");
  assert.equal(bulletBlocks[1]?.latexCode.trim(), "\\resumeitem{Inserted bullet}");
  assert.equal(bulletBlocks[2]?.id, "work-experience.entry-1.bullet-2");
  assert.equal(bulletBlocks[2]?.latexCode.trim(), "\\resumeitem{Second bullet}");
});

test("normalizeTailorResumeLatex preserves server-assigned inserted segment ids", () => {
  const latex = String.raw`
\resumeSection{WORK EXPERIENCE}
\entryheading{Example Co}{Engineer}{2024}
\begin{resumebullets}
  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-added-a1b2c3
  \resumeitem{Inserted bullet}
  \resumeitem{Existing bullet}
\end{resumebullets}
`;
  const normalized = normalizeTailorResumeLatex(latex);
  const secondPass = normalizeTailorResumeLatex(normalized.annotatedLatex);
  const bulletBlocks = readAnnotatedTailorResumeBlocks(
    secondPass.annotatedLatex,
  ).filter((block) => block.command === "resumeitem");

  assert.equal(bulletBlocks[0]?.id, "work-experience.entry-1.bullet-added-a1b2c3");
  assert.equal(bulletBlocks[0]?.latexCode.trim(), "\\resumeitem{Inserted bullet}");
  assert.equal(secondPass.annotatedLatex, normalized.annotatedLatex);
});

test("buildUniqueTailorResumeSegmentId appends numeric suffixes on conflict", () => {
  const seenSegmentIds = new Set<string>();

  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2",
  );
  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2-2",
  );
  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2-3",
  );
});
