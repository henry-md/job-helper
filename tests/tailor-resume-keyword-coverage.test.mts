import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailoredResumeKeywordCoverage,
  resumeTextIncludesKeyword,
} from "../lib/tailor-resume-keyword-coverage.ts";

test("resumeTextIncludesKeyword matches terms case-insensitively with punctuation boundaries", () => {
  assert.equal(
    resumeTextIncludesKeyword({
      term: "Visual Studio",
      text: "Built a debugger extension for Microsoft Visual Studio.",
    }),
    true,
  );
  assert.equal(
    resumeTextIncludesKeyword({
      term: "TypeScript",
      text: "Shipped TYPESCRIPT services.",
    }),
    true,
  );
  assert.equal(
    resumeTextIncludesKeyword({
      term: "React",
      text: "Built a React, Next.js, and Node.js dashboard.",
    }),
    true,
  );
  assert.equal(
    resumeTextIncludesKeyword({
      term: "Node.js",
      text: "Built a React, Next.js, and Node.js dashboard.",
    }),
    true,
  );
});

test("resumeTextIncludesKeyword avoids noisy one-letter technology matches", () => {
  assert.equal(
    resumeTextIncludesKeyword({
      term: "C",
      text: "Built C++ tooling and computer vision systems.",
    }),
    false,
  );
  assert.equal(
    resumeTextIncludesKeyword({
      term: "C",
      text: "Used C, Python, and CUDA for embedded prototypes.",
    }),
    true,
  );
  assert.equal(
    resumeTextIncludesKeyword({
      term: "C++",
      text: "Built C++ tooling and computer vision systems.",
    }),
    true,
  );
});

test("buildTailoredResumeKeywordCoverage stores high-only and all-priority buckets", () => {
  const coverage = buildTailoredResumeKeywordCoverage({
    emphasizedTechnologies: [
      {
        evidence: "Required section mentions TypeScript.",
        name: "TypeScript",
        priority: "high",
      },
      {
        evidence: "Required section mentions Visual Studio.",
        name: "Visual Studio",
        priority: "high",
      },
      {
        evidence: "Preferred section mentions Agile.",
        name: "Agile",
        priority: "low",
      },
    ],
    originalLatexCode:
      "\\documentclass{article}\\begin{document}Built JavaScript tooling.\\end{document}",
    tailoredLatexCode:
      "\\documentclass{article}\\begin{document}Built TypeScript tooling in Microsoft Visual Studio.\\end{document}",
    updatedAt: "2026-04-30T20:00:00.000Z",
  });

  assert.equal(coverage.updatedAt, "2026-04-30T20:00:00.000Z");
  assert.equal(coverage.highPriority.totalTermCount, 2);
  assert.equal(coverage.highPriority.originalHitPercentage, 0);
  assert.equal(coverage.highPriority.tailoredHitPercentage, 100);
  assert.deepEqual(coverage.highPriority.addedTerms, [
    "TypeScript",
    "Visual Studio",
  ]);
  assert.equal(coverage.allPriorities.totalTermCount, 3);
  assert.equal(coverage.allPriorities.tailoredHitPercentage, 67);
});
