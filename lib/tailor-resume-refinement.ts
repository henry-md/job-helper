import OpenAI from "openai";
import {
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { resolveTailoredResumeCurrentEditLatexCode } from "./tailor-resume-edit-history.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import { runWithTransientModelRetries } from "./tailor-resume-transient-retry.ts";
import {
  formatTailoredResumeEditLabel,
  buildTailoredResumeBlockEdits,
  normalizeTailoredResumeEditReason,
} from "./tailor-resume-review.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";
import { applyTailorResumeBlockChanges } from "./tailor-resume-tailoring.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeThesis,
} from "./tailor-resume-types.ts";

const refineTailoredResumeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: {
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
    summary: { type: "string" },
  },
  required: ["changes", "summary"],
} as const;

type TailoredResumeRefinementResponse = {
  changes: Array<{
    latexCode: string;
    reason: string;
    segmentId: string;
  }>;
  summary: string;
};

type TailoredResumeResponse = {
  model?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
};

export type RefineTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  edits: TailoredResumeBlockEditRecord[];
  generationDurationMs: number;
  latexCode: string;
  model: string;
  previewPdf: Buffer;
  summary: string;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function readOutputText(response: TailoredResumeResponse) {
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

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseTailoredResumeRefinementResponse(
  value: unknown,
): TailoredResumeRefinementResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid refinement response.");
  }

  const rawSummary = "summary" in value ? value.summary : "";
  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  const changes = rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The model returned an invalid block refinement.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const latexCode =
      "latexCode" in change && typeof change.latexCode === "string"
        ? change.latexCode
        : "";
    const reason =
      "reason" in change && typeof change.reason === "string" ? change.reason : "";

    if (!segmentId) {
      throw new Error(
        "The model returned a block refinement without a segmentId.",
      );
    }

    if (!readTrimmedString(reason)) {
      throw new Error(
        `The model returned a refinement without a reason for segment ${segmentId}.`,
      );
    }

    return {
      latexCode,
      reason,
      segmentId,
    };
  });

  return {
    changes,
    summary: readTrimmedString(rawSummary),
  };
}

export function validateTailoredResumeRefinementChanges(input: {
  changes: TailoredResumeRefinementResponse["changes"];
  existingEdits: TailoredResumeBlockEditRecord[];
}) {
  const expectedSegmentIds = new Set(
    input.existingEdits.map((edit) => edit.segmentId),
  );
  const seenSegmentIds = new Set<string>();

  for (const change of input.changes) {
    if (seenSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate refinements for segment ${change.segmentId}.`,
      );
    }

    if (!expectedSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model refined unknown segment ${change.segmentId}.`,
      );
    }

    seenSegmentIds.add(change.segmentId);
  }

  if (seenSegmentIds.size !== expectedSegmentIds.size) {
    const missingSegmentIds = input.existingEdits
      .map((edit) => edit.segmentId)
      .filter((segmentId) => !seenSegmentIds.has(segmentId));

    throw new Error(
      `The model must return exactly one refinement for every edited block. Missing: ${missingSegmentIds.join(", ")}.`,
    );
  }
}

function serializeTailoredResumeRefinementEdits(
  edits: TailoredResumeBlockEditRecord[],
) {
  if (edits.length === 0) {
    return "[no model edits are available]";
  }

  return edits
    .map((edit, index) => {
      const currentLatexCode = stripTailorResumeSegmentIds(
        resolveTailoredResumeCurrentEditLatexCode(edit),
      );
      const currentStateLabel =
        edit.customLatexCode !== null
          ? "customized"
          : edit.state === "rejected"
            ? "rejected"
            : "applied";

      return [
        `${index + 1}. segmentId: ${edit.segmentId}`,
        `   label: ${formatTailoredResumeEditLabel(edit)}`,
        `   current rendered state: ${currentStateLabel}`,
        `   latest model reason: ${normalizeTailoredResumeEditReason(edit.reason)}`,
        "   original latex block:",
        edit.beforeLatexCode,
        "   latest model latex block:",
        edit.afterLatexCode,
        "   current rendered latex block:",
        currentLatexCode,
      ].join("\n");
    })
    .join("\n\n");
}

function buildTailoredResumeRefinementInstructions(input: {
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumeRefinementSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
    },
  );
}

function buildTailoredResumeRefinementInput(input: {
  edits: TailoredResumeBlockEditRecord[];
  previewImageDataUrls: string[];
  sourceLatexCode: string;
  thesis: TailoredResumeThesis | null;
  userPrompt: string;
}) {
  const thesisText = input.thesis
    ? [
        "Current tailoring thesis:",
        `jobDescriptionFocus: ${input.thesis.jobDescriptionFocus}`,
        `resumeChanges: ${input.thesis.resumeChanges}`,
      ].join("\n")
    : "Current tailoring thesis: [not available]";
  const previewLegendText =
    input.previewImageDataUrls.length > 0
      ? [
          "Preview highlight key:",
          "- amber/yellow = changed or rewritten text in an edited block",
          "- green = newly added text in an edited block",
          "- blue = currently focused block when present",
        ].join("\n")
      : null;

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: `User follow-up request:\n${input.userPrompt.trim()}`,
        },
        {
          type: "input_text" as const,
          text: thesisText,
        },
        {
          type: "input_text" as const,
          text: `Raw original resume LaTeX:\n${input.sourceLatexCode}`,
        },
        {
          type: "input_text" as const,
          text:
            "Latest model-edited blocks:\n" +
            serializeTailoredResumeRefinementEdits(input.edits),
        },
        ...(previewLegendText
          ? [
              {
                type: "input_text" as const,
                text: previewLegendText,
              },
            ]
          : []),
        ...input.previewImageDataUrls.flatMap((imageUrl, index) => [
          {
            type: "input_text" as const,
            text: `Rendered PDF preview screenshot ${index + 1} with the visible review highlights baked into the image.`,
          },
          {
            detail: "high" as const,
            image_url: imageUrl,
            type: "input_image" as const,
          },
        ]),
      ],
    },
  ];
}

export async function refineTailoredResume(input: {
  edits: TailoredResumeBlockEditRecord[];
  feedback?: string;
  previewImageDataUrls: string[];
  promptSettings?: SystemPromptSettings;
  sourceAnnotatedLatexCode: string;
  thesis: TailoredResumeThesis | null;
  userPrompt: string;
}): Promise<RefineTailoredResumeResult> {
  if (input.edits.length === 0) {
    throw new Error("No model edits are available to refine.");
  }

  const startedAt = Date.now();
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();
  const maxAttempts = Math.min(2, getRetryAttemptsToGenerateLatexEdits());
  const sourceLatexCode = stripTailorResumeSegmentIds(input.sourceAnnotatedLatexCode);
  let feedback = input.feedback?.trim() ?? "";
  let lastError = "Unable to refine the tailored resume edits.";
  let lastModel = model;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const refinementInput = buildTailoredResumeRefinementInput({
      edits: input.edits,
      previewImageDataUrls: input.previewImageDataUrls,
      sourceLatexCode,
      thesis: input.thesis,
      userPrompt: input.userPrompt,
    });
    const instructions = buildTailoredResumeRefinementInstructions({
      feedback,
      promptSettings: input.promptSettings,
    });
    const response = await runWithTransientModelRetries({
      operation: () =>
        client.responses.create({
          input: refinementInput,
          instructions,
          model,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "tailor_resume_refinement",
              strict: true,
              schema: refineTailoredResumeSchema,
            },
          },
        }),
    });

    lastModel = (response as { model?: string }).model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty refinement response.";
      feedback =
        "The previous response was empty. Return the full JSON object with summary plus one change for every edited block.";
      continue;
    }

    let refinement: TailoredResumeRefinementResponse;

    try {
      refinement = parseTailoredResumeRefinementResponse(JSON.parse(outputText));
      validateTailoredResumeRefinementChanges({
        changes: refinement.changes,
        existingEdits: input.edits,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an invalid refinement response.";
      feedback = `${lastError}\nReturn a valid JSON object with summary plus exactly one change for every existing segmentId.`;
      continue;
    }

    let nextAnnotatedLatexCode: string;

    try {
      nextAnnotatedLatexCode = applyTailorResumeBlockChanges({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
        changes: refinement.changes,
      }).annotatedLatex;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The proposed LaTeX replacements could not be applied.";
      feedback = `${lastError}\nKeep each replacement inside its original segment boundary and return the full required changes array again.`;
      continue;
    }

    const nextLatexCode = stripTailorResumeSegmentIds(nextAnnotatedLatexCode);
    const validation = await validateTailorResumeLatexDocument(nextLatexCode);

    if (!validation.ok) {
      lastError = validation.error;
      feedback =
        `The previous refinement did not compile as valid pdflatex: ${validation.error}\n` +
        "Revise the same segment set, keep the changes tighter, and return the full JSON object again.";
      continue;
    }

    return {
      annotatedLatexCode: nextAnnotatedLatexCode,
      attempts: attempt,
      edits: buildTailoredResumeBlockEdits({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
        changes: refinement.changes,
      }),
      generationDurationMs: Math.max(0, Date.now() - startedAt),
      latexCode: nextLatexCode,
      model: lastModel,
      previewPdf: validation.previewPdf,
      summary:
        refinement.summary ||
        "Updated the tailored resume blocks based on your follow-up request.",
    };
  }

  throw new Error(lastError);
}
