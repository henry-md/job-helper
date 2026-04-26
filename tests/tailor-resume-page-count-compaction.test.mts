import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { measureTailorResumeLayout } from "../lib/tailor-resume-layout-measurement.ts";
import { measureTailorResumeLineReductionCandidates } from "../lib/tailor-resume-line-reduction-candidates.ts";
import { compactTailoredResumePageCount } from "../lib/tailor-resume-page-count-compaction.ts";
import { buildTailoredResumeBlockEdits } from "../lib/tailor-resume-review.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";
import { applyTailorResumeBlockChanges } from "../lib/tailor-resume-tailoring.ts";

function findSegmentIdBySnippet(annotatedLatexCode: string, snippet: string) {
  const block = readAnnotatedTailorResumeBlocks(annotatedLatexCode).find((candidate) =>
    candidate.latexCode.includes(snippet),
  );

  assert.ok(block, `Expected to find a block containing: ${snippet}`);
  return block.id;
}

async function buildLineReductionFixture() {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Led major refactor enabling",
  );
  const sourceLayout = await measureTailorResumeLayout({
    annotatedLatexCode: normalized.annotatedLatex,
  });
  const current = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode:
          String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support across the full software suite; refactored \textbf{31K+ LOC (365 files)} and \textbf{140+ tRPC endpoints \& Bayesian inference engine} into platform-agnostic objects, improving maintainability, diagnosability, service reliability, onboarding speed, and cross-team developer experience for platform teams.}`,
        reason: "Long current Step 3 replacement.",
        segmentId,
      },
    ],
  });
  const currentLayout = await measureTailorResumeLayout({
    annotatedLatexCode: current.annotatedLatex,
  });
  const originalLineCount = sourceLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;
  const currentLineCount = currentLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;

  assert.equal(typeof originalLineCount, "number");
  assert.equal(typeof currentLineCount, "number");
  assert.ok(
    (currentLineCount ?? 0) > (originalLineCount ?? Number.POSITIVE_INFINITY),
  );

  return {
    currentAnnotatedLatexCode: current.annotatedLatex,
    currentLayout,
    editableSegmentIds: new Set([segmentId]),
    segmentId,
    sourceLayout,
  };
}

async function buildCompactionOverflowFixture() {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceLayout = await measureTailorResumeLayout({
    annotatedLatexCode: normalized.annotatedLatex,
  });
  const bulletBlocks = readAnnotatedTailorResumeBlocks(normalized.annotatedLatex).filter(
    (block) => block.id.includes(".bullet-"),
  );

  assert.ok(
    bulletBlocks.length >= 4,
    "Expected at least four editable bullet blocks for the overflow fixture.",
  );

  const giantSentence =
    "Built role-aligned platform delivery narratives across engineering, reliability, onboarding, experimentation, observability, incident response, and developer workflow improvements for distributed teams ";
  const step3Changes = bulletBlocks.slice(0, 4).map((block, index) => ({
    generatedByStep: 3 as const,
    latexCode:
      String.raw`\resumeitem{` +
      `${giantSentence.repeat(index === 0 ? 8 : 12)}` +
      `while preserving the original project scope and quantitative anchors for the tailored resume.}`,
    reason: `Long Step 3 expansion ${index + 1}.`,
    segmentId: block.id,
  }));
  const current = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: step3Changes,
  });
  const currentLayout = await measureTailorResumeLayout({
    annotatedLatexCode: current.annotatedLatex,
  });

  assert.ok(
    currentLayout.pageCount > 1,
    `Expected the overflow fixture to exceed one page, but it rendered to ${String(currentLayout.pageCount)}.`,
  );

  const candidate = {
    latexCode:
      String.raw`\resumeitem{Led TikTok refactor enabling \textbf{\$50K+/mo in ad spend} across the software suite.}`,
    reason:
      "Keeps the TikTok monetization metric central for the role, while trimming the block.",
    segmentId: step3Changes[0]!.segmentId,
  };
  const measurementResult = await measureTailorResumeLineReductionCandidates({
    candidates: [candidate],
    currentAnnotatedLatexCode: current.annotatedLatex,
    currentLayout,
    editableSegmentIds: new Set(step3Changes.map((change) => change.segmentId)),
    sourceLayout,
  });

  assert.equal(measurementResult.accepted.length, 1);

  const candidateLayout = await measureTailorResumeLayout({
    annotatedLatexCode: applyTailorResumeBlockChanges({
      annotatedLatexCode: current.annotatedLatex,
      changes: [candidate],
    }).annotatedLatex,
  });

  assert.ok(
    candidateLayout.pageCount > 1,
    `Expected the single verified compaction candidate to still leave overflow, but it rendered to ${String(candidateLayout.pageCount)}.`,
  );

  return {
    annotatedLatexCode: current.annotatedLatex,
    candidate,
    currentLayout,
    edits: buildTailoredResumeBlockEdits({
      annotatedLatexCode: normalized.annotatedLatex,
      changes: step3Changes,
    }),
    initialPageCount: currentLayout.pageCount,
    latexCode: stripTailorResumeSegmentIds(current.annotatedLatex),
    previewPdf: currentLayout.pdfBuffer,
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  };
}

test("line reduction gate accepts candidates that reduce the current rendered line count even when they only tie the original block", async () => {
  const fixture = await buildLineReductionFixture();
  const result = await measureTailorResumeLineReductionCandidates({
    candidates: [
      {
        latexCode:
          String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support; refactored \textbf{31K+ LOC (365 files)} and \textbf{140+ tRPC endpoints \& Bayesian inference engine} into platform-agnostic objects, improving maintainability and diagnosability.}`,
        reason:
          "Adds maintainability and diagnosability framing for the role, while trimming the longer draft.",
        segmentId: fixture.segmentId,
      },
    ],
    currentAnnotatedLatexCode: fixture.currentAnnotatedLatexCode,
    currentLayout: fixture.currentLayout,
    editableSegmentIds: fixture.editableSegmentIds,
    sourceLayout: fixture.sourceLayout,
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0]?.candidateLineCount, 2);
  assert.equal(result.accepted[0]?.originalLineCount, 2);
  assert.ok(
    (result.accepted[0]?.previousLineCount ?? 0) >
      (result.accepted[0]?.candidateLineCount ?? Number.POSITIVE_INFINITY),
  );
});

test("line reduction gate accepts candidates with a user-visible rendered line reduction", async () => {
  const fixture = await buildLineReductionFixture();
  const result = await measureTailorResumeLineReductionCandidates({
    candidates: [
      {
        latexCode:
          String.raw`\resumeitem{Led TikTok refactor enabling \textbf{\$50K+/mo in ad spend} across the software suite.}`,
        reason:
          "Keeps the TikTok monetization metric central for the role, while trimming the block.",
        segmentId: fixture.segmentId,
      },
    ],
    currentAnnotatedLatexCode: fixture.currentAnnotatedLatexCode,
    currentLayout: fixture.currentLayout,
    editableSegmentIds: fixture.editableSegmentIds,
    sourceLayout: fixture.sourceLayout,
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0]?.candidateLineCount, 1);
  assert.equal(result.accepted[0]?.originalLineCount, 2);
  assert.ok(
    (result.accepted[0]?.previousLineCount ?? 0) >
      (result.accepted[0]?.candidateLineCount ?? Number.POSITIVE_INFINITY),
  );
});

test("page-count compaction keeps verified line-saving edits even when the exact page count still misses the target", async () => {
  const fixture = await buildCompactionOverflowFixture();
  const toolNamesSeen: string[][] = [];
  let responseIndex = 0;
  const candidateArguments = JSON.stringify({
    candidates: [fixture.candidate],
  });
  const fakeClient = {
    responses: {
      create: async (parameters: {
        input: unknown;
        previous_response_id?: string;
        tools: Array<{ name?: string }>;
      }) => {
        toolNamesSeen.push(parameters.tools.map((tool) => tool.name ?? ""));

        switch (responseIndex++) {
          case 0:
            return {
              id: "resp-1",
              model: "test-openai-response",
              output: [
                {
                  arguments: candidateArguments,
                  call_id: "call-1",
                  name: "measure_resume_line_reductions",
                  type: "function_call",
                },
              ],
            };
          case 1:
            assert.equal(parameters.previous_response_id, "resp-1");
            return {
              id: "resp-2",
              model: "test-openai-response",
              output: [
                {
                  arguments: candidateArguments,
                  call_id: "call-2",
                  name: "verify_resume_page_count",
                  type: "function_call",
                },
              ],
            };
          case 2:
            assert.equal(parameters.previous_response_id, "resp-2");
            return {
              id: "resp-3",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: [fixture.candidate],
                    verificationSummary:
                      "Measured a real line reduction and checked the exact rendered page count.",
                  }),
                  call_id: "call-3",
                  name: "submit_verified_line_reductions",
                  type: "function_call",
                },
              ],
            };
          default:
            throw new Error("Unexpected extra compaction tool round.");
        }
      },
    },
  } as unknown as OpenAI;
  const previousRetryBudget =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "1";

  try {
    const result = await compactTailoredResumePageCount({
      annotatedLatexCode: fixture.annotatedLatexCode,
      client: fakeClient,
      edits: fixture.edits,
      initialPageCount: fixture.initialPageCount,
      latexCode: fixture.latexCode,
      model: "test-openai-response",
      previewPdf: fixture.previewPdf,
      sourceAnnotatedLatexCode: fixture.sourceAnnotatedLatexCode,
      targetPageCount: 1,
      thesis: null,
    });

    assert.match(result.validationError ?? "", /still rendered to/i);
    assert.ok(result.pageCount > 1);
    assert.ok(result.previewPdf.length > 0);
    const compactedEdit = result.edits.find(
      (edit) => edit.segmentId === fixture.candidate.segmentId,
    );
    assert.ok(compactedEdit);
    assert.equal(compactedEdit?.generatedByStep, 4);
    assert.equal(
      compactedEdit?.afterLatexCode.includes(
        String.raw`\resumeitem{Led TikTok refactor enabling \textbf{\$50K+/mo in ad spend} across the software suite.}`,
      ),
      true,
    );
    assert.deepEqual(
      toolNamesSeen,
      [
        [
          "measure_resume_line_reductions",
          "verify_resume_page_count",
          "submit_verified_line_reductions",
        ],
        [
          "measure_resume_line_reductions",
          "verify_resume_page_count",
          "submit_verified_line_reductions",
        ],
        [
          "measure_resume_line_reductions",
          "verify_resume_page_count",
          "submit_verified_line_reductions",
        ],
      ],
    );
  } finally {
    if (previousRetryBudget === undefined) {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
    } else {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION =
        previousRetryBudget;
    }
  }
});

test("page-count compaction retries from kept reductions and can finish on a later pass", async () => {
  const fixture = await buildCompactionOverflowFixture();
  const toolNamesSeen: string[][] = [];
  let responseIndex = 0;
  const shortLatex =
    String.raw`\resumeitem{Led role-aligned platform engineering delivery with measurable reliability impact.}`;
  const firstCandidate = fixture.candidate;
  const remainingCandidates = fixture.edits
    .filter((edit) => edit.segmentId !== firstCandidate.segmentId)
    .map((edit) => ({
      latexCode: shortLatex,
      reason:
        "Keeps the platform-delivery emphasis for the role while compressing the block further.",
      segmentId: edit.segmentId,
    }));
  const fakeClient = {
    responses: {
      create: async (parameters: {
        input: unknown;
        previous_response_id?: string;
        tools: Array<{ name?: string }>;
      }) => {
        toolNamesSeen.push(parameters.tools.map((tool) => tool.name ?? ""));

        switch (responseIndex++) {
          case 0:
            return {
              id: "resp-1",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: [firstCandidate],
                  }),
                  call_id: "call-1",
                  name: "measure_resume_line_reductions",
                  type: "function_call",
                },
              ],
            };
          case 1:
            assert.equal(parameters.previous_response_id, "resp-1");
            return {
              id: "resp-2",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: [firstCandidate],
                  }),
                  call_id: "call-2",
                  name: "verify_resume_page_count",
                  type: "function_call",
                },
              ],
            };
          case 2:
            assert.equal(parameters.previous_response_id, "resp-2");
            return {
              id: "resp-3",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: [firstCandidate],
                    verificationSummary:
                      "Verified a real line reduction, but the exact page count still needs another pass.",
                  }),
                  call_id: "call-3",
                  name: "submit_verified_line_reductions",
                  type: "function_call",
                },
              ],
            };
          case 3:
            return {
              id: "resp-4",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: remainingCandidates,
                  }),
                  call_id: "call-4",
                  name: "measure_resume_line_reductions",
                  type: "function_call",
                },
              ],
            };
          case 4:
            assert.equal(parameters.previous_response_id, "resp-4");
            return {
              id: "resp-5",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: remainingCandidates,
                  }),
                  call_id: "call-5",
                  name: "verify_resume_page_count",
                  type: "function_call",
                },
              ],
            };
          case 5:
            assert.equal(parameters.previous_response_id, "resp-5");
            return {
              id: "resp-6",
              model: "test-openai-response",
              output: [
                {
                  arguments: JSON.stringify({
                    candidates: remainingCandidates,
                    verificationSummary:
                      "Widened the pass to the remaining multi-line blocks and verified the exact page count now fits.",
                  }),
                  call_id: "call-6",
                  name: "submit_verified_line_reductions",
                  type: "function_call",
                },
              ],
            };
          default:
            throw new Error("Unexpected extra compaction tool round.");
        }
      },
    },
  } as unknown as OpenAI;
  const previousRetryBudget =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "2";

  try {
    const result = await compactTailoredResumePageCount({
      annotatedLatexCode: fixture.annotatedLatexCode,
      client: fakeClient,
      edits: fixture.edits,
      initialPageCount: fixture.initialPageCount,
      latexCode: fixture.latexCode,
      model: "test-openai-response",
      previewPdf: fixture.previewPdf,
      sourceAnnotatedLatexCode: fixture.sourceAnnotatedLatexCode,
      targetPageCount: 1,
      thesis: null,
    });

    assert.equal(result.validationError, null);
    assert.equal(result.pageCount, 1);
    assert.ok(result.previewPdf.length > 0);
    assert.deepEqual(
      result.edits
        .filter((edit) =>
          [firstCandidate.segmentId, ...remainingCandidates.map((candidate) => candidate.segmentId)].includes(
            edit.segmentId,
          ),
        )
        .map((edit) => edit.generatedByStep),
      [4, 4, 4, 4],
    );
    assert.equal(toolNamesSeen.length, 6);
    for (const toolNames of toolNamesSeen) {
      assert.deepEqual(toolNames, [
        "measure_resume_line_reductions",
        "verify_resume_page_count",
        "submit_verified_line_reductions",
      ]);
    }
  } finally {
    if (previousRetryBudget === undefined) {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
    } else {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION =
        previousRetryBudget;
    }
  }
});
