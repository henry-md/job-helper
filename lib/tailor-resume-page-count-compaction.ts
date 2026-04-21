import OpenAI from "openai";
import {
  buildTailorResumePageCountCompactionPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import {
  estimateTailorResumeOverflowLines,
  indexTailorResumeSegmentMeasurements,
  measureTailorResumeLayout,
  type TailorResumeLayoutMeasurement,
} from "./tailor-resume-layout-measurement.ts";
import {
  measureTailorResumeLineReductionCandidates,
  type TailorResumeLineReductionCandidate,
  type TailorResumeLineReductionToolResult,
} from "./tailor-resume-line-reduction-candidates.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import { buildTailoredResumeBlockEdits } from "./tailor-resume-review.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";
import { applyTailorResumeBlockChanges } from "./tailor-resume-tailoring.ts";
import {
  resolveTailoredResumeCurrentEditLatexCode,
} from "./tailor-resume-edit-history.ts";
import {
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

type TailorResumeCompactionResponse = {
  id?: string;
  model?: string;
  output?: TailorResumeCompactionOutputItem[];
  output_text?: string;
};

type TailorResumeCompactionOutputItem = {
  arguments?: string;
  call_id?: string;
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  name?: string;
  type?: string;
};

type TailorResumeLineReductionToolCall = {
  arguments: string;
  call_id: string;
};

const tailorResumeLineReductionToolName = "measure_resume_line_reductions";

const tailorResumeLineReductionTool = {
  type: "function",
  name: tailorResumeLineReductionToolName,
  description:
    "Measure proposed compacted replacements inside the current full resume and report which candidates create a user-visible exact rendered PDF line-count reduction.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            latexCode: { type: "string" },
            reason: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "latexCode", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function buildPageCountLimitLabel(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

function buildLineCountLabel(lineCount: number) {
  return `${lineCount} rendered line${lineCount === 1 ? "" : "s"}`;
}

function readOutputText(response: TailorResumeCompactionResponse) {
  if (response.output_text) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];

  for (const outputItem of response.output ?? []) {
    if (outputItem.type !== "message") {
      continue;
    }

    for (const content of outputItem.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("").trim();
}

function findLineReductionToolCall(
  response: TailorResumeCompactionResponse,
): TailorResumeLineReductionToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === tailorResumeLineReductionToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
      };
    }
  }

  return null;
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseLineReductionCandidates(
  value: unknown,
): TailorResumeLineReductionCandidate[] {
  if (!value || typeof value !== "object" || !("candidates" in value)) {
    throw new Error("The model did not call the line-measurement tool with candidates.");
  }

  const rawCandidates = value.candidates;

  if (!Array.isArray(rawCandidates)) {
    throw new Error("The line-measurement tool call did not include a candidates array.");
  }

  return rawCandidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const segmentId =
      "segmentId" in candidate ? readTrimmedString(candidate.segmentId) : "";
    const latexCode =
      "latexCode" in candidate && typeof candidate.latexCode === "string"
        ? candidate.latexCode
        : "";
    const reason =
      "reason" in candidate && typeof candidate.reason === "string"
        ? candidate.reason.trim()
        : "";

    if (!segmentId || !latexCode.trim() || !reason) {
      return [];
    }

    return [
      {
        latexCode,
        reason,
        segmentId,
      },
    ];
  });
}

function readCurrentEditLatex(edit: TailoredResumeBlockEditRecord) {
  return resolveTailoredResumeCurrentEditLatexCode({
    ...edit,
    customLatexCode: null,
    state: "applied",
  });
}

function buildAnnotatedLatexFromEdits(input: {
  edits: TailoredResumeBlockEditRecord[];
  sourceAnnotatedLatexCode: string;
}) {
  return applyTailorResumeBlockChanges({
    annotatedLatexCode: input.sourceAnnotatedLatexCode,
    changes: input.edits.map((edit) => ({
      latexCode: readCurrentEditLatex(edit),
      reason: edit.reason,
      segmentId: edit.segmentId,
    })),
  }).annotatedLatex;
}

function updateWorkingEdits(input: {
  acceptedCandidates: TailorResumeLineReductionCandidate[];
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  const acceptedCandidateBySegmentId = new Map(
    input.acceptedCandidates.map((candidate) => [candidate.segmentId, candidate]),
  );

  return input.workingEdits.map((edit) => {
    const acceptedCandidate = acceptedCandidateBySegmentId.get(edit.segmentId);

    if (!acceptedCandidate) {
      return edit;
    }

    return {
      ...edit,
      afterLatexCode: acceptedCandidate.latexCode,
      customLatexCode: null,
      generatedByStep: 4 as const,
      reason: acceptedCandidate.reason,
      state: "applied" as const,
    };
  });
}

function indexCurrentLineCounts(layout: TailorResumeLayoutMeasurement) {
  return indexTailorResumeSegmentMeasurements(layout);
}

function truncateForPrompt(value: string, maxLength = 420) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 1).trimEnd()}…`;
}

function serializeSourceLayout(layout: TailorResumeLayoutMeasurement) {
  const sectionLines =
    layout.sections.length > 0
      ? layout.sections.map(
          (section) =>
            `- ${section.sectionId}: ${buildLineCountLabel(section.lineCount)} (${section.title})`,
        )
      : ["- [no section measurements available]"];
  const blockLines =
    layout.segments.length > 0
      ? layout.segments.map(
          (segment) =>
            [
              `- segmentId: ${segment.segmentId}`,
              `  command: ${segment.command ?? "unknown"}`,
              `  original rendered lines: ${segment.lineCount}`,
              `  text: ${truncateForPrompt(segment.plainText)}`,
            ].join("\n"),
        )
      : ["- [no block measurements available]"];

  return [
    "Original resume section rendered line counts:",
    ...sectionLines,
    "",
    "Original resume visible block rendered line counts:",
    ...blockLines,
  ].join("\n");
}

function serializeEditableBlocks(input: {
  currentLayout: TailorResumeLayoutMeasurement;
  sourceLayout: TailorResumeLayoutMeasurement;
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  const currentLineCounts = indexCurrentLineCounts(input.currentLayout);
  const sourceLineCounts = indexCurrentLineCounts(input.sourceLayout);

  if (input.workingEdits.length === 0) {
    return "[no editable model blocks are available]";
  }

  return input.workingEdits
    .map((edit, index) => {
      const currentLineCount =
        currentLineCounts.get(edit.segmentId)?.lineCount ?? null;
      const sourceLineCount = sourceLineCounts.get(edit.segmentId)?.lineCount ?? null;
      const lineDelta =
        currentLineCount !== null && sourceLineCount !== null
          ? currentLineCount - sourceLineCount
          : null;

      return [
        `${index + 1}. segmentId: ${edit.segmentId}`,
        `   command: ${edit.command ?? "unknown"}`,
        `   original rendered lines: ${sourceLineCount ?? "[unavailable]"}`,
        `   current replacement rendered lines: ${currentLineCount ?? "[unavailable]"}`,
        `   line delta vs original: ${lineDelta === null ? "[unavailable]" : lineDelta}`,
        `   current generated-by step: ${edit.generatedByStep}`,
        "   acceptance rule: a Step 4 candidate must render to fewer lines than both the current replacement and the original block when those counts are available",
        `   current reason: ${edit.reason}`,
        "   original latex block:",
        edit.beforeLatexCode,
        "   current replacement latex block:",
        readCurrentEditLatex(edit),
      ].join("\n");
    })
    .join("\n\n");
}

function serializeToolMeasurementFeedback(input: {
  estimatedLinesToRecover: number;
  result: TailorResumeLineReductionToolResult | null;
}) {
  if (!input.result) {
    return "";
  }

  const acceptedReduction = input.result.accepted.reduce(
    (sum, measurement) =>
      sum + (measurement.previousLineCount - measurement.candidateLineCount),
    0,
  );
  const acceptedLines =
    input.result.accepted.length > 0
      ? input.result.accepted.map(
          (measurement) =>
            `- accepted ${measurement.candidate.segmentId}: ${measurement.previousLineCount} -> ${measurement.candidateLineCount} rendered lines`,
        )
      : ["- none"];
  const rejectedLines =
    input.result.rejected.length > 0
      ? input.result.rejected.map(
          (measurement) =>
            `- rejected ${measurement.candidate.segmentId}: current ${measurement.previousLineCount ?? "?"} -> candidate ${measurement.candidateLineCount ?? "?"} rendered lines, original ${measurement.originalLineCount ?? "?"} (${measurement.rejectionReason ?? "rejected"})`,
        )
      : ["- none"];

  return [
    "Previous line-measurement result:",
    `Accepted rendered line reduction: ${acceptedReduction}`,
    `Current estimated lines still needed before this attempt: ${input.estimatedLinesToRecover}`,
    "Accepted candidates:",
    ...acceptedLines,
    "Rejected candidates:",
    ...rejectedLines,
  ].join("\n");
}

function buildCompactionInstructions() {
  return [
    "You are Step 4 of a staged resume-tailoring pipeline.",
    "Your only job is to find real rendered-line reductions in the existing model-edited blocks.",
    `You must call ${tailorResumeLineReductionToolName}; do not answer with prose instead.`,
    "Only include a block in the tool call when you believe the replacement will reduce that exact block by at least one rendered PDF line versus the current model replacement and versus the original resume block shown to the user.",
    "Do not polish, rephrase, or touch a block unless the replacement is likely to create a user-visible rendered-line reduction for that same block.",
    "Use the current replacement LaTeX block shape. Keep the edit inside the same segment and preserve factual accuracy.",
    "Every candidate reason replaces the old saved reason. Lead with what changed for the job-description fit, and mention shortening only as a passing fragment when necessary.",
  ].join("\n");
}

function buildCompactionInput(input: {
  currentLayout: TailorResumeLayoutMeasurement;
  currentPageCount: number;
  estimatedLinesToRecover: number;
  measurementFeedback: string;
  promptSettings: SystemPromptSettings;
  sourceLayout: TailorResumeLayoutMeasurement;
  targetPageCount: number;
  thesis: TailoredResumeThesis | null;
  workingEdits: TailoredResumeBlockEditRecord[];
}) {
  const thesisText = input.thesis
    ? [
        "Current tailoring thesis:",
        `jobDescriptionFocus: ${input.thesis.jobDescriptionFocus}`,
        `resumeChanges: ${input.thesis.resumeChanges}`,
      ].join("\n")
    : "Current tailoring thesis: [not available]";

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: buildTailorResumePageCountCompactionPrompt(input.promptSettings, {
            currentPageCount: input.currentPageCount,
            estimatedLineReduction: input.estimatedLinesToRecover,
            targetPageCount: input.targetPageCount,
          }),
        },
        {
          type: "input_text" as const,
          text: thesisText,
        },
        {
          type: "input_text" as const,
          text:
            `Estimated rendered lines to remove: ${input.estimatedLinesToRecover}\n` +
            `Current page count: ${input.currentPageCount}\n` +
            `Target page count: ${input.targetPageCount}`,
        },
        {
          type: "input_text" as const,
          text: serializeSourceLayout(input.sourceLayout),
        },
        {
          type: "input_text" as const,
          text:
            "Editable model blocks with current measured line counts:\n" +
            serializeEditableBlocks({
              currentLayout: input.currentLayout,
              sourceLayout: input.sourceLayout,
              workingEdits: input.workingEdits,
            }),
        },
        ...(input.measurementFeedback
          ? [
              {
                type: "input_text" as const,
                text: input.measurementFeedback,
              },
            ]
          : []),
      ],
    },
  ];
}

async function validateFinalCompactedLatex(input: {
  latexCode: string;
  targetPageCount: number;
}) {
  const validation = await validateTailorResumeLatexDocument(input.latexCode);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const pageCount = await countPdfPages(validation.previewPdf);

  if (pageCount > input.targetPageCount) {
    throw new Error(
      `The compacted resume still rendered to ${buildPageCountLimitLabel(pageCount)} instead of ${buildPageCountLimitLabel(input.targetPageCount)}.`,
    );
  }

  return {
    pageCount,
    previewPdf: validation.previewPdf,
  };
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

  const startedAt = Date.now();
  const promptSettings = input.promptSettings ?? createDefaultSystemPromptSettings();
  const maxCompactionAttempts = Math.max(1, getRetryAttemptsToGenerateLatexEdits());
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();
  const editableSegmentIds = new Set(input.edits.map((edit) => edit.segmentId));
  let workingEdits = input.edits.map((edit) => ({ ...edit }));
  let currentAnnotatedLatexCode = buildAnnotatedLatexFromEdits({
    edits: workingEdits,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
  });
  let currentLatexCode = stripTailorResumeSegmentIds(currentAnnotatedLatexCode);
  let currentPreviewPdf = input.previewPdf;
  let currentPageCount = input.initialPageCount;
  let sourceLayout: TailorResumeLayoutMeasurement;
  let currentLayout: TailorResumeLayoutMeasurement;
  let previousMeasurementResult: TailorResumeLineReductionToolResult | null = null;
  let lastError =
    `Unable to keep the tailored resume within ${buildPageCountLimitLabel(targetPageCount)}.`;
  let lastModel = model;

  await input.onStepEvent?.({
    attempt: null,
    detail:
      `The tailored preview expanded to ${buildPageCountLimitLabel(input.initialPageCount)}, ` +
      `so step 4 is measuring rendered lines and asking for verified line reductions back toward ${buildPageCountLimitLabel(targetPageCount)}.`,
    durationMs: 0,
    retrying: false,
    status: "running",
    stepCount: 4,
    stepNumber: 4,
    summary: "Keeping the tailored resume within the original page count",
  });

  try {
    [sourceLayout, currentLayout] = await Promise.all([
      measureTailorResumeLayout({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
      }),
      measureTailorResumeLayout({
        annotatedLatexCode: currentAnnotatedLatexCode,
        pdfBuffer: currentPreviewPdf,
      }),
    ]);
  } catch (error) {
    lastError =
      error instanceof Error
        ? error.message
        : "Unable to measure the rendered resume layout.";
    await input.onStepEvent?.({
      attempt: null,
      detail: lastError,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: false,
      status: "failed",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });
    throw new Error(lastError);
  }

  for (let attempt = 1; attempt <= maxCompactionAttempts; attempt += 1) {
    const overflowEstimate = await estimateTailorResumeOverflowLines({
      pdfBuffer: currentPreviewPdf,
      targetPageCount,
    });
    const estimatedLinesToRecover = overflowEstimate.estimatedLinesToRecover;
    const measurementFeedback = serializeToolMeasurementFeedback({
      estimatedLinesToRecover,
      result: previousMeasurementResult,
    });
    const response = await client.responses.create({
      input: buildCompactionInput({
        currentLayout,
        currentPageCount,
        estimatedLinesToRecover,
        measurementFeedback,
        promptSettings,
        sourceLayout,
        targetPageCount,
        thesis: input.thesis,
        workingEdits,
      }),
      instructions: buildCompactionInstructions(),
      model,
      parallel_tool_calls: false,
      tool_choice: "required",
      tools: [tailorResumeLineReductionTool],
    });

    lastModel = (response as { model?: string }).model ?? model;
    const toolCall = findLineReductionToolCall({
      id: response.id,
      model: response.model ?? undefined,
      output: response.output.map((outputItem) => {
        const mappedItem: TailorResumeCompactionOutputItem = {
          type: outputItem.type,
        };

        if ("name" in outputItem && typeof outputItem.name === "string") {
          mappedItem.name = outputItem.name;
        }

        if ("call_id" in outputItem && typeof outputItem.call_id === "string") {
          mappedItem.call_id = outputItem.call_id;
        }

        if (
          "arguments" in outputItem &&
          typeof outputItem.arguments === "string"
        ) {
          mappedItem.arguments = outputItem.arguments;
        }

        if ("content" in outputItem && Array.isArray(outputItem.content)) {
          mappedItem.content = outputItem.content.map((contentItem) => {
            const mappedContent: { text?: string; type?: string } = {};

            if ("type" in contentItem && typeof contentItem.type === "string") {
              mappedContent.type = contentItem.type;
            }

            if ("text" in contentItem && typeof contentItem.text === "string") {
              mappedContent.text = contentItem.text;
            }

            return mappedContent;
          });
        }

        return mappedItem;
      }),
      output_text: response.output_text,
    });

    if (!toolCall) {
      const outputText = readOutputText({
        id: response.id,
        model: response.model ?? undefined,
        output_text: response.output_text,
      });
      lastError = outputText
        ? `The model did not call ${tailorResumeLineReductionToolName}. It returned: ${outputText}`
        : `The model did not call ${tailorResumeLineReductionToolName}.`;
      previousMeasurementResult = {
        accepted: [],
        rejected: [],
      };
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    let candidates: TailorResumeLineReductionCandidate[];

    try {
      candidates = parseLineReductionCandidates(JSON.parse(toolCall.arguments));
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an invalid line-measurement tool call.";
      previousMeasurementResult = {
        accepted: [],
        rejected: [],
      };
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    const measurementResult = await measureTailorResumeLineReductionCandidates({
      candidates,
      currentAnnotatedLatexCode,
      currentLayout,
      editableSegmentIds,
      sourceLayout,
    });
    previousMeasurementResult = measurementResult;

    if (measurementResult.accepted.length === 0) {
      lastError =
        "No proposed compaction candidate reduced its block's measured rendered line count.";
      await input.onStepEvent?.({
        attempt,
        detail:
          `${lastError} Step 4 is asking for more aggressive candidates that actually remove rendered lines.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    const acceptedCandidates = measurementResult.accepted.map(
      (measurement) => measurement.candidate,
    );
    const acceptedLineReduction = measurementResult.accepted.reduce(
      (sum, measurement) =>
        sum + (measurement.previousLineCount - measurement.candidateLineCount),
      0,
    );
    workingEdits = updateWorkingEdits({
      acceptedCandidates,
      workingEdits,
    });
    currentAnnotatedLatexCode = buildAnnotatedLatexFromEdits({
      edits: workingEdits,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    });
    currentLatexCode = stripTailorResumeSegmentIds(currentAnnotatedLatexCode);

    try {
      currentLayout = await measureTailorResumeLayout({
        annotatedLatexCode: currentAnnotatedLatexCode,
      });
      currentPreviewPdf = currentLayout.pdfBuffer;
      currentPageCount = currentLayout.pageCount;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to compile the accepted line reductions.";
      await input.onStepEvent?.({
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxCompactionAttempts,
        status: attempt < maxCompactionAttempts ? "running" : "failed",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });
      continue;
    }

    if (currentPageCount <= targetPageCount) {
      const finalValidation = await validateFinalCompactedLatex({
        latexCode: currentLatexCode,
        targetPageCount,
      });

      await input.onStepEvent?.({
        attempt,
        detail:
          `Accepted ${measurementResult.accepted.length} verified line-saving block ` +
          `change${measurementResult.accepted.length === 1 ? "" : "s"} and removed ${buildLineCountLabel(acceptedLineReduction)}, ` +
          `bringing the rendered preview back to ${buildPageCountLimitLabel(finalValidation.pageCount)}.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: false,
        status: "succeeded",
        stepCount: 4,
        stepNumber: 4,
        summary: "Keeping the tailored resume within the original page count",
      });

      return {
        annotatedLatexCode: currentAnnotatedLatexCode,
        edits: buildTailoredResumeBlockEdits({
          annotatedLatexCode: input.sourceAnnotatedLatexCode,
          changes: workingEdits.map((edit) => ({
            generatedByStep: edit.generatedByStep,
            latexCode: readCurrentEditLatex(edit),
            reason: edit.reason,
            segmentId: edit.segmentId,
          })),
        }),
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        latexCode: currentLatexCode,
        model: lastModel,
        pageCount: finalValidation.pageCount,
        previewPdf: finalValidation.previewPdf,
      } satisfies TailorResumePageCountCompactionResult;
    }

    lastError =
      `Accepted ${measurementResult.accepted.length} verified line-saving block ` +
      `change${measurementResult.accepted.length === 1 ? "" : "s"} and removed ${buildLineCountLabel(acceptedLineReduction)}, ` +
      `but the resume still rendered to ${buildPageCountLimitLabel(currentPageCount)}.`;

    await input.onStepEvent?.({
      attempt,
      detail: `${lastError} Step 4 is trying another measured reduction pass.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt < maxCompactionAttempts,
      status: attempt < maxCompactionAttempts ? "running" : "failed",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    });
  }

  throw new Error(lastError);
}
