import {
  buildTailorResumePageCountCompactionPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { buildTailoredResumeInteractivePreviewQueries } from "./tailor-resume-preview-focus.ts";
import { refineTailoredResume } from "./tailor-resume-refinement.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import {
  buildTailoredResumePreviewImageDataUrls,
  countPdfPages,
} from "./tailored-resume-preview-snapshots.ts";
import type {
  TailorResumeGenerationStepEvent,
  TailoredResumeBlockEditRecord,
  TailoredResumeThesis,
} from "./tailor-resume-types.ts";

export type TailorResumePageCountCompactionResult = {
  annotatedLatexCode: string;
  edits: TailoredResumeBlockEditRecord[];
  generationDurationMs: number;
  latexCode: string;
  model: string;
  pageCount: number;
  previewPdf: Buffer;
};

function buildPageCountLimitLabel(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export async function compactTailoredResumePageCount(input: {
  annotatedLatexCode: string;
  edits: TailoredResumeBlockEditRecord[];
  initialPageCount: number;
  latexCode: string;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  previewPdf: Buffer;
  promptSettings?: SystemPromptSettings;
  sourceAnnotatedLatexCode: string;
  targetPageCount: number;
  thesis: TailoredResumeThesis | null;
}) {
  const targetPageCount = Math.max(1, Math.floor(input.targetPageCount));

  if (input.initialPageCount <= targetPageCount) {
    return {
      annotatedLatexCode: input.annotatedLatexCode,
      edits: input.edits,
      generationDurationMs: 0,
      latexCode: input.latexCode,
      model: process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini",
      pageCount: input.initialPageCount,
      previewPdf: input.previewPdf,
    } satisfies TailorResumePageCountCompactionResult;
  }

  if (input.edits.length === 0) {
    const errorMessage =
      `The tailored resume expanded to ${buildPageCountLimitLabel(input.initialPageCount)}, ` +
      `but there are no editable model blocks available to compact it back to ${buildPageCountLimitLabel(targetPageCount)}.`;
    await input.onStepEvent?.({
      attempt: null,
      detail: errorMessage,
      durationMs: 0,
      retrying: false,
      status: "failed",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });
    throw new Error(errorMessage);
  }

  await input.onStepEvent?.({
    attempt: null,
    detail:
      `The tailored preview expanded to ${buildPageCountLimitLabel(input.initialPageCount)}, ` +
      `so step 4 is now compacting the highlighted edits back toward ${buildPageCountLimitLabel(targetPageCount)}.`,
    durationMs: 0,
    retrying: false,
    status: "running",
    stepCount: 4,
    stepNumber: 4,
    summary: "Keeping the tailored resume within the original page count",
  });

  const promptSettings = input.promptSettings ?? createDefaultSystemPromptSettings();
  const maxCompactionAttempts = Math.max(1, getRetryAttemptsToGenerateLatexEdits());
  let currentAnnotatedLatexCode = input.annotatedLatexCode;
  let currentEdits = input.edits;
  let currentLatexCode = input.latexCode;
  let currentPageCount = input.initialPageCount;
  let currentPreviewPdf = input.previewPdf;
  let totalDurationMs = 0;
  let feedback = "";

  for (let attempt = 1; attempt <= maxCompactionAttempts; attempt += 1) {
    const previewImageDataUrls = await buildTailoredResumePreviewImageDataUrls({
      highlightQueries: buildTailoredResumeInteractivePreviewQueries({
        annotatedLatexCode: currentAnnotatedLatexCode,
        edits: currentEdits,
        sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      }).highlightQueries,
      pdfBuffer: currentPreviewPdf,
    });
    const refinementResult = await refineTailoredResume({
      edits: currentEdits,
      feedback,
      previewImageDataUrls,
      promptSettings,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      thesis: input.thesis,
      userPrompt: buildTailorResumePageCountCompactionPrompt(promptSettings, {
        currentPageCount,
        targetPageCount,
      }),
    });

    totalDurationMs += refinementResult.generationDurationMs;
    currentAnnotatedLatexCode = refinementResult.annotatedLatexCode;
    currentEdits = refinementResult.edits;
    currentLatexCode = refinementResult.latexCode;
    currentPreviewPdf = refinementResult.previewPdf;
    currentPageCount = await countPdfPages(refinementResult.previewPdf);

    if (currentPageCount <= targetPageCount) {
      await input.onStepEvent?.({
        attempt,
        detail:
          `Compacted the highlighted edits down to ${buildPageCountLimitLabel(currentPageCount)} ` +
          `while honoring the ${buildPageCountLimitLabel(targetPageCount)} hard limit.`,
        durationMs: totalDurationMs,
        retrying: false,
        status: "succeeded",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
      return {
        annotatedLatexCode: currentAnnotatedLatexCode,
        edits: currentEdits,
        generationDurationMs: totalDurationMs,
        latexCode: currentLatexCode,
        model: refinementResult.model,
        pageCount: currentPageCount,
        previewPdf: currentPreviewPdf,
      } satisfies TailorResumePageCountCompactionResult;
    }

    const retrying = attempt < maxCompactionAttempts;
    await input.onStepEvent?.({
      attempt,
      detail: retrying
        ? `The latest compacted draft still rendered to ${buildPageCountLimitLabel(currentPageCount)} instead of ${buildPageCountLimitLabel(targetPageCount)}, so step 4 is trying another compaction pass.`
        : `The latest compacted draft still rendered to ${buildPageCountLimitLabel(currentPageCount)} instead of ${buildPageCountLimitLabel(targetPageCount)}, so step 4 could not meet the page-count target.`,
      durationMs: totalDurationMs,
      retrying,
      status: retrying ? "running" : "failed",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });

    feedback =
      `The previous page-count compaction still rendered to ${buildPageCountLimitLabel(currentPageCount)}. ` +
      `Keep the same segment set, cut more aggressively, and fit the resume within ${buildPageCountLimitLabel(targetPageCount)}.`;
  }

  throw new Error(
    `Unable to keep the tailored resume within ${buildPageCountLimitLabel(targetPageCount)}. The latest compacted draft still rendered to ${buildPageCountLimitLabel(currentPageCount)}.`,
  );
}
