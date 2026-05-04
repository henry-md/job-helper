import assert from "node:assert/strict";
import test from "node:test";
import { buildTailoredResumeDiffRows } from "../lib/tailor-resume-review.ts";
import {
  buildTailoredResumePreviewFocusQuery,
  renderTailoredResumeLatexToPlainText,
  resolveTailoredResumePreviewFocusRanges,
} from "../lib/tailor-resume-preview-focus.ts";

type Case = {
  afterLatex: string;
  beforeLatex: string;
  expectedHighlights: string[];
  name: string;
};

function summarize(value: string, max = 80) {
  if (value.length <= max) return JSON.stringify(value);
  return `${JSON.stringify(value.slice(0, max))}…`;
}

function diffAdditionsFromRows(beforeText: string, afterText: string) {
  const rows = buildTailoredResumeDiffRows(beforeText, afterText);
  const additions: string[] = [];

  for (const row of rows) {
    if (row.modifiedText === null) continue;

    if (row.type === "added") {
      additions.push(row.modifiedText.trim());
      continue;
    }

    if (row.type === "modified" && row.modifiedSegments) {
      const segmentAddedRuns = row.modifiedSegments
        .filter((segment) => segment.type === "added")
        .map((segment) => segment.text.trim())
        .filter(Boolean);
      additions.push(...segmentAddedRuns);
    }
  }

  return additions;
}

function resolveHighlightSlices(input: { afterLatex: string; beforeLatex: string }) {
  const beforeText = renderTailoredResumeLatexToPlainText(input.beforeLatex);
  const afterText = renderTailoredResumeLatexToPlainText(input.afterLatex);

  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode: input.beforeLatex,
    currentLatexCode: input.afterLatex,
    state: "applied",
  });

  assert.ok(focusQuery, "focus query should be built");

  const ranges = resolveTailoredResumePreviewFocusRanges({
    pageText: afterText,
    query: focusQuery,
  });

  return {
    afterText,
    beforeText,
    focusQuery,
    highlightSlices: ranges.map((range) =>
      afterText.slice(range.start, range.end),
    ),
  };
}

const characterAccuracyCases: Case[] = [
  {
    name: "swap two leading languages",
    beforeLatex: String.raw`\labelline{Languages \& Systems: }{TypeScript, JavaScript, Python, Java, C++, SQL, HTML, CSS}`,
    afterLatex: String.raw`\labelline{Languages \& Systems: }{Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS}`,
    expectedHighlights: ["Python", "TypeScript"],
  },
  {
    name: "rephrased bullet with multiple replacement runs",
    beforeLatex: String.raw`\resumeitem{Led major refactor enabling \textbf{\$50K+/mo in TikTok ad spend} by incorporating TikTok support for our entire suite of software. Refactored \textbf{31K+ LOC in 365 files}, reworking \textbf{140+ tRPC endpoints \& Bayesian inference engine} for platform-agnostic objects}`,
    afterLatex: String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support across our suite; refactored \textbf{31K+ LOC in 365 files} and reworked \textbf{140+ tRPC endpoints \& Bayesian inference engine} to create platform-agnostic objects, improving developer onboarding and automation workflows}`,
    expectedHighlights: [
      "that enabled",
      "adding",
      "across",
      "; refactored",
      "and reworked",
      "to create",
      ", improving developer onboarding and automation workflows",
    ],
  },
  {
    name: "single-token replacement keeps highlight tight",
    beforeLatex:
      String.raw`\resumeitem{Built telemetry dashboards with \textbf{Grafana} and Prometheus}`,
    afterLatex:
      String.raw`\resumeitem{Built telemetry dashboards with \textbf{Datadog} and Prometheus}`,
    expectedHighlights: ["Datadog"],
  },
];

for (const testCase of characterAccuracyCases) {
  test(`highlights match diff additions character-for-character: ${testCase.name}`, () => {
    const result = resolveHighlightSlices({
      afterLatex: testCase.afterLatex,
      beforeLatex: testCase.beforeLatex,
    });

    const detail = [
      `before plain text: ${summarize(result.beforeText)}`,
      `after  plain text: ${summarize(result.afterText)}`,
      `focus anchor:      ${summarize(result.focusQuery.anchorText)}`,
      `highlight ranges:  ${JSON.stringify(result.focusQuery.highlightRanges)}`,
      `resolved slices:   ${JSON.stringify(result.highlightSlices)}`,
      `diff additions:    ${JSON.stringify(
        diffAdditionsFromRows(result.beforeText, result.afterText),
      )}`,
    ].join("\n");

    assert.deepEqual(
      result.highlightSlices,
      testCase.expectedHighlights,
      `\nResolved highlight slices did not match expected values.\n${detail}`,
    );
  });
}
