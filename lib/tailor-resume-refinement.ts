import OpenAI from "openai";
import { createHash } from "node:crypto";
import {
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import {
  buildTailoredResumeSnapshotComparisonEdits,
  resolveTailoredResumeCurrentEditLatexCode,
} from "./tailor-resume-edit-history.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import { runWithTransientModelRetries } from "./tailor-resume-transient-retry.ts";
import {
  formatTailoredResumeEditLabel,
  normalizeTailoredResumeEditReason,
} from "./tailor-resume-review.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import {
  TailorResumeJsonStringFieldStreamer,
  type TailorResumeInterviewStreamEvent,
} from "./tailor-resume-interview-stream-parser.ts";
import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeThesis,
} from "./tailor-resume-types.ts";
import type { TailorResumeChatMessageRecord } from "./tailor-resume-chat.ts";

const refineTailoredResumeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
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
    insertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          anchorSegmentId: { type: "string" },
          latexCode: { type: "string" },
          position: { type: "string", enum: ["after", "before"] },
          reason: { type: "string" },
        },
        required: ["anchorSegmentId", "position", "latexCode", "reason"],
      },
    },
  },
  required: ["summary", "changes", "insertions"],
} as const;

type TailoredResumeRefinementResponse = {
  changes: Array<{
    latexCode: string;
    reason: string;
    segmentId: string;
  }>;
  insertions: Array<{
    anchorSegmentId: string;
    latexCode: string;
    position: "after" | "before";
    reason: string;
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
  changed: boolean;
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
  const rawInsertions = "insertions" in value ? value.insertions : null;

  if (!Array.isArray(rawChanges) || !Array.isArray(rawInsertions)) {
    throw new Error("The model did not return changes and insertions arrays.");
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
  const insertions = rawInsertions.map((insertion) => {
    if (!insertion || typeof insertion !== "object") {
      throw new Error("The model returned an invalid block insertion.");
    }

    const anchorSegmentId =
      "anchorSegmentId" in insertion
        ? readTrimmedString(insertion.anchorSegmentId)
        : "";
    const latexCode =
      "latexCode" in insertion && typeof insertion.latexCode === "string"
        ? insertion.latexCode
        : "";
    const reason =
      "reason" in insertion && typeof insertion.reason === "string"
        ? insertion.reason
        : "";
    const position: "after" | "before" =
      "position" in insertion && insertion.position === "before"
        ? "before"
        : "after";

    if (!anchorSegmentId) {
      throw new Error("The model returned an insertion without an anchorSegmentId.");
    }

    if (!readTrimmedString(reason)) {
      throw new Error(
        `The model returned an insertion without a reason for anchor ${anchorSegmentId}.`,
      );
    }

    return {
      anchorSegmentId,
      latexCode,
      position,
      reason,
    };
  });

  return {
    changes,
    insertions,
    summary: readTrimmedString(rawSummary),
  };
}

export function validateTailoredResumeRefinementChanges(input: {
  changes: TailoredResumeRefinementResponse["changes"];
  editableSegmentIds: Iterable<string>;
  insertions?: TailoredResumeRefinementResponse["insertions"];
}) {
  const expectedSegmentIds = new Set(input.editableSegmentIds);
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

  for (const insertion of input.insertions ?? []) {
    if (!expectedSegmentIds.has(insertion.anchorSegmentId)) {
      throw new Error(
        `The model inserted near unknown segment ${insertion.anchorSegmentId}.`,
      );
    }
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

function serializeTailoredResumeEditableSegments(sourceAnnotatedLatexCode: string) {
  const blocks = readAnnotatedTailorResumeBlocks(sourceAnnotatedLatexCode);

  if (blocks.length === 0) {
    return "[no editable segments are available]";
  }

  return blocks
    .map((block, index) =>
      [
        `${index + 1}. segmentId: ${block.id}`,
        `   command: ${block.command ?? "unknown"}`,
        "   latex block:",
        stripTailorResumeSegmentIds(block.latexCode),
      ].join("\n"),
    )
    .join("\n\n");
}

function buildTailoredResumeRefinementInstructions(input: {
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  const savedPromptInstructions = buildTailorResumeRefinementSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
    },
  );

  return [
    savedPromptInstructions,
    "Current non-overridable refinement contract:",
    "- The model receives an All editable resume segments list. changes may target any segmentId from that list, including segments that were not changed by the first tailoring pass.",
    "- Do not say a requested resume block is outside the editable set when its segmentId appears in All editable resume segments.",
    "- Return changes: [] and insertions: [] when no resume edit should be applied. Do not return unchanged existing edits merely to preserve them.",
    "- For changes, latexCode must contain only the replacement for that one listed segment.",
    "- For insertions, anchorSegmentId must be a listed editable segment id and latexCode must contain only the new block. Do not write JOBHELPER_SEGMENT_ID comments.",
  ].join("\n\n");
}

function isTailoredResumeRefinementNoOp(input: {
  edits: TailoredResumeBlockEditRecord[];
  refinement: TailoredResumeRefinementResponse;
}) {
  if (input.refinement.insertions.length > 0) {
    return false;
  }

  if (input.refinement.changes.length === 0) {
    return true;
  }

  const currentLatexBySegmentId = new Map(
    input.edits.map((edit) => [
      edit.segmentId,
      stripTailorResumeSegmentIds(
        resolveTailoredResumeCurrentEditLatexCode(edit),
      ).trim(),
    ]),
  );

  return input.refinement.changes.every((change) => {
    const currentLatex = currentLatexBySegmentId.get(change.segmentId);

    return (
      currentLatex !== undefined &&
      stripTailorResumeSegmentIds(change.latexCode).trim() === currentLatex
    );
  });
}

function buildTailoredResumeRefinementInput(input: {
  edits: TailoredResumeBlockEditRecord[];
  previousMessages: TailorResumeChatMessageRecord[];
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
          text:
            "Previous review chat messages:\n" +
            (buildTailoredResumeReviewChatTranscript(input.previousMessages) ||
              "[No prior review-chat messages.]"),
        },
        {
          type: "input_text" as const,
          text: thesisText,
        },
        {
          type: "input_text" as const,
          text: `Annotated original resume LaTeX with stable segment ids:\n${input.sourceLatexCode}`,
        },
        {
          type: "input_text" as const,
          text:
            "All editable resume segments:\n" +
            serializeTailoredResumeEditableSegments(input.sourceLatexCode),
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

export function buildTailoredResumeReviewChatTranscript(
  messages: readonly Pick<TailorResumeChatMessageRecord, "content" | "role">[],
) {
  return messages
    .map((message) => {
      const content = message.content.trim();

      if (!content) {
        return null;
      }

      const speaker = message.role === "assistant" ? "Assistant" : "User";

      return `${speaker}: ${content}`;
    })
    .filter((message): message is string => Boolean(message))
    .join("\n\n");
}

function normalizeInsertedLatexCode(latexCode: string) {
  return stripTailorResumeSegmentIds(latexCode).replace(/\n+$/, "");
}

function buildInsertedSegmentId(input: {
  anchorSegmentId: string;
  index: number;
  latexCode: string;
  usedSegmentIds: Set<string>;
}) {
  const hash = createHash("sha256")
    .update(`${input.anchorSegmentId}\n${input.index}\n${input.latexCode}`)
    .digest("hex")
    .slice(0, 10);
  const baseId = `${input.anchorSegmentId}.inserted-${hash}`;
  let candidateId = baseId;
  let suffix = 2;

  while (input.usedSegmentIds.has(candidateId)) {
    candidateId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  input.usedSegmentIds.add(candidateId);
  return candidateId;
}

function appendLatexBlock(chunks: string[], latexCode: string) {
  const normalizedLatexCode = normalizeInsertedLatexCode(latexCode);

  if (!normalizedLatexCode.trim()) {
    return;
  }

  chunks.push(normalizedLatexCode);

  if (!normalizedLatexCode.endsWith("\n")) {
    chunks.push("\n");
  }
}

function applyTailoredResumeRefinementOperations(input: {
  annotatedLatexCode: string;
  changes: TailoredResumeRefinementResponse["changes"];
  insertions: TailoredResumeRefinementResponse["insertions"];
}) {
  const normalizedAnnotatedLatexCode = normalizeTailorResumeLatex(
    input.annotatedLatexCode,
  ).annotatedLatex;
  const blocks = readAnnotatedTailorResumeBlocks(normalizedAnnotatedLatexCode);
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const changesBySegmentId = new Map(input.changes.map((change) => [change.segmentId, change]));
  const insertionsByAnchorId = new Map<
    string,
    TailoredResumeRefinementResponse["insertions"]
  >();
  const usedSegmentIds = new Set(blocks.map((block) => block.id));

  for (const insertion of input.insertions) {
    if (!blocksById.has(insertion.anchorSegmentId)) {
      throw new Error(
        `The model inserted near unknown segment ${insertion.anchorSegmentId}.`,
      );
    }

    const insertions = insertionsByAnchorId.get(insertion.anchorSegmentId) ?? [];
    insertions.push(insertion);
    insertionsByAnchorId.set(insertion.anchorSegmentId, insertions);
  }

  for (const change of input.changes) {
    if (!blocksById.has(change.segmentId)) {
      throw new Error(`The model refined unknown segment ${change.segmentId}.`);
    }
  }

  const chunks: string[] = [];
  let cursor = 0;
  let insertionIndex = 0;

  for (const block of blocks) {
    chunks.push(normalizedAnnotatedLatexCode.slice(cursor, block.markerStart));

    for (const insertion of insertionsByAnchorId.get(block.id) ?? []) {
      if (insertion.position !== "before") {
        continue;
      }

      const segmentId = buildInsertedSegmentId({
        anchorSegmentId: insertion.anchorSegmentId,
        index: insertionIndex,
        latexCode: insertion.latexCode,
        usedSegmentIds,
      });

      chunks.push(`% JOBHELPER_SEGMENT_ID: ${segmentId}\n`);
      appendLatexBlock(chunks, insertion.latexCode);
      insertionIndex += 1;
    }

    chunks.push(
      `% JOBHELPER_SEGMENT_ID: ${block.id}\n`,
      normalizeInsertedLatexCode(changesBySegmentId.get(block.id)?.latexCode ?? block.latexCode),
    );

    if (block.contentEnd < normalizedAnnotatedLatexCode.length) {
      chunks.push("\n");
    }

    for (const insertion of insertionsByAnchorId.get(block.id) ?? []) {
      if (insertion.position !== "after") {
        continue;
      }

      const segmentId = buildInsertedSegmentId({
        anchorSegmentId: insertion.anchorSegmentId,
        index: insertionIndex,
        latexCode: insertion.latexCode,
        usedSegmentIds,
      });

      chunks.push(`% JOBHELPER_SEGMENT_ID: ${segmentId}\n`);
      appendLatexBlock(chunks, insertion.latexCode);
      insertionIndex += 1;
    }

    cursor = block.contentEnd;
  }

  chunks.push(normalizedAnnotatedLatexCode.slice(cursor));

  return normalizeTailorResumeLatex(chunks.join("")).annotatedLatex;
}

export async function refineTailoredResume(input: {
  edits: TailoredResumeBlockEditRecord[];
  feedback?: string;
  onStreamEvent?: (event: TailorResumeInterviewStreamEvent) => void | Promise<void>;
  previousMessages?: TailorResumeChatMessageRecord[];
  previewImageDataUrls: string[];
  promptSettings?: SystemPromptSettings;
  sourceAnnotatedLatexCode: string;
  thesis: TailoredResumeThesis | null;
  userPrompt: string;
}): Promise<RefineTailoredResumeResult> {
  const editableSegmentIds = new Set(
    readAnnotatedTailorResumeBlocks(input.sourceAnnotatedLatexCode).map(
      (block) => block.id,
    ),
  );

  if (editableSegmentIds.size === 0) {
    throw new Error("No editable resume segments are available to refine.");
  }

  const startedAt = Date.now();
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();
  const maxAttempts = Math.min(2, getRetryAttemptsToGenerateLatexEdits());
  const sourceLatexCode = input.sourceAnnotatedLatexCode;
  let feedback = input.feedback?.trim() ?? "";
  let lastError = "Unable to refine the tailored resume edits.";
  let lastModel = model;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const refinementInput = buildTailoredResumeRefinementInput({
      edits: input.edits,
      previousMessages: input.previousMessages ?? [],
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
      operation: async () => {
        await input.onStreamEvent?.({ kind: "reset" });

        const streamer = new TailorResumeJsonStringFieldStreamer([
          { field: "assistantMessage" as const, key: "summary" },
        ]);
        const stream = client.responses.stream({
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
        });
        const finalResponsePromise = stream.finalResponse();

        for await (const event of stream) {
          if (event.type !== "response.output_text.delta" || !event.delta) {
            continue;
          }

          const emitted = streamer.feed(event.delta);

          for (const emittedEvent of emitted) {
            await input.onStreamEvent?.(emittedEvent);
          }
        }

        return await finalResponsePromise;
      },
    });

    lastModel = (response as { model?: string }).model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty refinement response.";
      feedback =
        "The previous response was empty. Return the full JSON object with summary, changes, and insertions. Use empty arrays when no resume edit should be applied.";
      continue;
    }

    let refinement: TailoredResumeRefinementResponse;

    try {
      refinement = parseTailoredResumeRefinementResponse(JSON.parse(outputText));
      validateTailoredResumeRefinementChanges({
        changes: refinement.changes,
        editableSegmentIds,
        insertions: refinement.insertions,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an invalid refinement response.";
      feedback = `${lastError}\nReturn a valid JSON object with summary, changes, and insertions. Use empty arrays when no resume edit should be applied.`;
      continue;
    }

    if (isTailoredResumeRefinementNoOp({ edits: input.edits, refinement })) {
      return {
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
        attempts: attempt,
        changed: false,
        edits: input.edits,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        latexCode: stripTailorResumeSegmentIds(input.sourceAnnotatedLatexCode),
        model: lastModel,
        previewPdf: Buffer.alloc(0),
        summary:
          refinement.summary ||
          "No resume changes were applied from that chat message.",
      };
    }

    const mergedChangesBySegmentId = new Map(
      input.edits.map((edit) => [
        edit.segmentId,
        {
          latexCode: resolveTailoredResumeCurrentEditLatexCode(edit),
          reason: edit.reason,
          segmentId: edit.segmentId,
        },
      ]),
    );

    for (const change of refinement.changes) {
      mergedChangesBySegmentId.set(change.segmentId, change);
    }

    const mergedChanges = [...mergedChangesBySegmentId.values()];

    let nextAnnotatedLatexCode: string;

    try {
      nextAnnotatedLatexCode = applyTailoredResumeRefinementOperations({
        annotatedLatexCode: input.sourceAnnotatedLatexCode,
        changes: mergedChanges,
        insertions: refinement.insertions,
      });
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
      changed: true,
      edits: buildTailoredResumeSnapshotComparisonEdits({
        endAnnotatedLatexCode: nextAnnotatedLatexCode,
        startAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
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
