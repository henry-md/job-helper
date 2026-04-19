import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  buildTailoredResumeInteractivePreviewQueries,
  buildTailoredResumePreviewFocusQuery,
  normalizeTailoredResumePreviewMatchText,
  renderTailoredResumeLatexToPlainText,
  resolveTailoredResumePreviewFocusRanges,
} from "../lib/tailor-resume-preview-focus.ts";
import { normalizeTailorResumeLatex, readAnnotatedTailorResumeBlocks } from "../lib/tailor-resume-segmentation.ts";

function findSegmentIdBySnippet(annotatedLatexCode: string, snippet: string) {
  const block = readAnnotatedTailorResumeBlocks(annotatedLatexCode).find((candidate) =>
    candidate.latexCode.includes(snippet),
  );

  assert.ok(block, `Expected to find a block containing: ${snippet}`);
  return block.id;
}

test("renderTailoredResumeLatexToPlainText unwraps common inline resume formatting", () => {
  assert.equal(
    renderTailoredResumeLatexToPlainText(
      String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines, reducing handoff time by \textasciitilde30\% across 8 teams}`,
    ),
    "Used AWS Amplify to set up CI/CD pipelines, reducing handoff time by ~30% across 8 teams",
  );
});

test("renderTailoredResumeLatexToPlainText flattens heading commands into searchable text", () => {
  assert.equal(
    renderTailoredResumeLatexToPlainText(
      String.raw`\entryheading{NewForm AI}{Software Engineer I --- Full Time}{Aug 2025 - Feb 2026}`,
    ),
    "NewForm AI | Software Engineer I --- Full Time Aug 2025 - Feb 2026",
  );
});

test("buildTailoredResumePreviewFocusQuery targets the changed span inside the current block text", () => {
  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode:
      String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`,
    currentLatexCode:
      String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}`,
    state: "applied",
  });

  assert.deepEqual(focusQuery, {
    anchorText:
      "Used AWS Amplify to set up CI/CD pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of ~30% across 8 teams",
    highlightRanges: [
      {
        end: normalizeTailoredResumePreviewMatchText(
          "Used AWS Amplify to set up CI/CD pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of ~30% across 8 teams",
        ).length,
        start: 0,
        tone: "changed",
      },
    ],
    mode: "changed",
  });
});

test("buildTailoredResumePreviewFocusQuery preserves shared anchors as neutral context", () => {
  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode:
      String.raw`\resumeitem{Led major refactor enabling \textbf{\$50K+/mo in TikTok ad spend} by incorporating TikTok support for our entire suite of software. Refactored \textbf{31K+ LOC in 365 files}, reworking \textbf{140+ tRPC endpoints \& Bayesian inference engine} for platform-agnostic objects}`,
    currentLatexCode:
      String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support across our suite; refactored \textbf{31K+ LOC in 365 files} and reworked \textbf{140+ tRPC endpoints \& Bayesian inference engine} to create platform-agnostic objects, improving developer onboarding and automation workflows}`,
    state: "applied",
  });

  assert.deepEqual(focusQuery, {
    anchorText:
      "Led major refactor that enabled $50K+/mo in TikTok ad spend by adding TikTok support across our suite; refactored 31K+ LOC in 365 files and reworked 140+ tRPC endpoints & Bayesian inference engine to create platform-agnostic objects, improving developer onboarding and automation workflows",
    highlightRanges: [
      { end: 31, start: 18, tone: "changed" },
      { end: 69, start: 62, tone: "changed" },
      { end: 91, start: 84, tone: "changed" },
      { end: 113, start: 101, tone: "changed" },
      { end: 148, start: 135, tone: "changed" },
      { end: 206, start: 196, tone: "changed" },
      { end: 289, start: 232, tone: "changed" },
    ],
    mode: "changed",
  });
});

test("buildTailoredResumePreviewFocusQuery falls back to block focus when an edit is rejected", () => {
  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode:
      String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`,
    currentLatexCode:
      String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`,
    state: "rejected",
  });

  assert.deepEqual(focusQuery, {
    anchorText:
      "Created full-stack dashboard for project management with React (Next.js) and JavaScript, with user authentication",
    highlightRanges: [],
    mode: "focus",
  });
});

test("resolveTailoredResumePreviewFocusRanges tolerates missing layout spaces in PDF text", () => {
  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode:
      String.raw`\labelline{Languages \& Systems: }{TypeScript, JavaScript, Python, Java, C++, SQL, HTML, CSS}`,
    currentLatexCode:
      String.raw`\labelline{Languages \& Systems: }{Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS}`,
    state: "applied",
  });

  assert.ok(focusQuery);

  const pageText =
    "Languages & Systems:Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS";
  const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
    pageText,
    query: focusQuery,
  });

  assert.deepEqual(
    resolvedRanges.map((range) => pageText.slice(range.start, range.end)),
    ["Python", "TypeScript"],
  );
});

test("resolveTailoredResumePreviewFocusRanges keeps focus-only navigation working when layout spaces collapse", () => {
  const focusQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode:
      String.raw`\labelline{Languages \& Systems: }{Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS}`,
    currentLatexCode:
      String.raw`\labelline{Languages \& Systems: }{Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS}`,
    state: "rejected",
  });

  assert.ok(focusQuery);

  const pageText =
    "Languages & Systems:Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS";
  const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
    pageText,
    query: focusQuery,
  });

  assert.deepEqual(
    resolvedRanges.map((range) => pageText.slice(range.start, range.end)),
    ["Languages & Systems:Python, JavaScript, TypeScript, Java, C++, SQL, HTML, CSS"],
  );
});

test("buildTailoredResumeInteractivePreviewQueries keeps one steady highlight per active segment", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`;
  const afterModelLatexCode =
    String.raw`\resumeitem{Added explicit collaboration language for open-source work}`;
  const afterUserLatexCode =
    String.raw`\resumeitem{Added explicit \textbf{open-source communities} phrasing to show collaboration and contribution to projects}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const previewQueries = buildTailoredResumeInteractivePreviewQueries({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: [
      {
        afterLatexCode: afterModelLatexCode,
        beforeLatexCode,
        command: "resumeitem",
        customLatexCode: afterUserLatexCode,
        editId: `${segmentId}:model`,
        reason: "Model edit.",
        state: "applied",
        segmentId,
      },
    ],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });
  const expectedCombinedQuery = buildTailoredResumePreviewFocusQuery({
    beforeLatexCode,
    currentLatexCode: afterUserLatexCode,
    state: "applied",
  });

  assert.equal(previewQueries.highlightQueries.length, 1);
  assert.equal(previewQueries.highlightQueries[0]?.key, `segment:${segmentId}`);
  assert.deepEqual(previewQueries.highlightQueries[0]?.query, expectedCombinedQuery);
  assert.deepEqual(
    previewQueries.focusQueryByEditId.get(`${segmentId}:model`),
    expectedCombinedQuery,
  );
});

test("buildTailoredResumeInteractivePreviewQueries falls back to block focus for rejected-only edits", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\descline{Developed AI-powered orbit analysis system using autoencoder \textbf{neural network}, and latent space analysis with clustering algorithms}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Developed AI-powered orbit analysis system using autoencoder",
  );
  const editId = `${segmentId}:rejected`;
  const previewQueries = buildTailoredResumeInteractivePreviewQueries({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: [
      {
        afterLatexCode:
          String.raw`\descline{Developed AI-powered orbit analysis system with revised wording}`,
        beforeLatexCode,
        command: "descline",
        customLatexCode: null,
        editId,
        reason: "Rejected edit.",
        state: "rejected",
        segmentId,
      },
    ],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.deepEqual(previewQueries.highlightQueries, []);
  assert.deepEqual(previewQueries.focusQueryByEditId.get(editId), {
    anchorText:
      "Developed AI-powered orbit analysis system using autoencoder neural network, and latent space analysis with clustering algorithms",
    highlightRanges: [],
    mode: "focus",
  });
});
