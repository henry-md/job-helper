import OpenAI from "openai";
import { createHash } from "node:crypto";
import { trackAiModelUsage } from "./ai-usage.ts";
import { resolveTailorResumeSelectableModel } from "./tailor-resume-generation-settings.ts";
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
import { buildTailoredResumeKeywordCoverage } from "./tailor-resume-keyword-coverage.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import { measureTailorResumeLayout } from "./tailor-resume-layout-measurement.ts";
import {
  buildTailorResumeRenderedBulletHealthCheck,
  formatTailorResumeChangedMalformedBulletError,
} from "./tailor-resume-rendered-bullet-health.ts";
import type { TailorResumeInterviewStreamEvent } from "./tailor-resume-interview-stream-parser.ts";
import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeKeywordCoverage,
  TailoredResumeThesis,
} from "./tailor-resume-types.ts";
import type {
  TailorResumeChatMessageRecord,
  TailorResumeChatToolCallRecord,
} from "./tailor-resume-chat.ts";

const checkRefinedResumeHealthToolName = "check_refined_resume_health";
const listRefinedResumeKeywordCoverageToolName =
  "list_refined_resume_keyword_coverage";
const maxTailoredResumeRefinementToolRounds = 5;
const missingRefinementHealthCheckError =
  "The model returned final JSON before a matching successful refinement health check.";

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

const checkRefinedResumeHealthTool = {
  type: "function",
  name: checkRefinedResumeHealthToolName,
  description:
    "Apply the proposed review-chat resume changes to the full resume and report rendered page count plus malformed rendered bullets before final JSON submission.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: refineTailoredResumeSchema.properties.changes,
      insertions: refineTailoredResumeSchema.properties.insertions,
    },
    required: ["changes", "insertions"],
  },
} as const;

const listRefinedResumeKeywordCoverageTool = {
  type: "function",
  name: listRefinedResumeKeywordCoverageToolName,
  description:
    "Return the scraped keyword coverage ledger for the current tailored resume, optionally after applying candidate review-chat changes and insertions.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: refineTailoredResumeSchema.properties.changes,
      insertions: refineTailoredResumeSchema.properties.insertions,
    },
    required: ["changes", "insertions"],
  },
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
  id?: string;
  model?: string;
  output?: Array<{
    arguments?: string;
    call_id?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    name?: string;
    type?: string;
  }>;
  output_text?: string;
  usage?: Record<string, unknown>;
};

type AnthropicTextBlock = {
  text?: string;
  type?: string;
};

type AnthropicRefinementResponse = {
  content?: AnthropicTextBlock[];
  id?: string;
  model?: string;
  usage?: Record<string, unknown>;
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
  toolCalls: TailorResumeChatToolCallRecord[];
};

type TailoredResumeRefinementToolCall = {
  arguments: string;
  call_id: string;
  name: string;
};

export function formatTailoredResumeRefinementUserError(error: string) {
  if (error.includes(missingRefinementHealthCheckError)) {
    return "I couldn't safely verify that proposed resume edit against the rendered PDF, so nothing was saved. Try again with a smaller or more specific edit, and I’ll re-check the page count before applying it.";
  }

  return error;
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function getAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  return apiKey;
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

function readAnthropicOutputText(response: AnthropicRefinementResponse) {
  return (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function readRefinementToolCall(
  response: TailoredResumeResponse,
): TailoredResumeRefinementToolCall | null {
  const toolCall = response.output?.find(
    (item) =>
      item.type === "function_call" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string" &&
      typeof item.call_id === "string",
  );

  if (!toolCall?.name || !toolCall.arguments || !toolCall.call_id) {
    return null;
  }

  return {
    arguments: toolCall.arguments,
    call_id: toolCall.call_id,
    name: toolCall.name,
  };
}

function serializeRefinementToolCall(
  toolCall: TailoredResumeRefinementToolCall,
  output?: unknown,
): TailorResumeChatToolCallRecord {
  let argumentsText = toolCall.arguments;
  let outputText = "";

  try {
    argumentsText = JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
  } catch {
    // Preserve raw tool arguments if the model returns invalid JSON.
  }

  if (output !== undefined) {
    try {
      outputText = JSON.stringify(output, null, 2);
    } catch {
      outputText = String(output);
    }
  }

  return {
    argumentsText,
    name: toolCall.name,
    ...(outputText ? { outputText } : {}),
  };
}

function serializeRefinementHealthCheckRecovery(input: {
  candidate: Pick<TailoredResumeRefinementResponse, "changes" | "insertions">;
  output: unknown;
}): TailorResumeChatToolCallRecord {
  return {
    argumentsText: JSON.stringify(input.candidate, null, 2),
    name: checkRefinedResumeHealthToolName,
    outputText: JSON.stringify(input.output, null, 2),
  };
}

function parseRefinementToolArguments(
  toolCall: TailoredResumeRefinementToolCall,
) {
  try {
    const parsed = JSON.parse(toolCall.arguments) as unknown;

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildAnthropicRefinementPrompt(
  input: ReturnType<typeof buildTailoredResumeRefinementInput>,
) {
  return input
    .flatMap((message) =>
      message.content.map((block) => {
        if (block.type === "input_text") {
          return block.text;
        }

        return "[Rendered PDF preview screenshot omitted for this model path.]";
      }),
    )
    .join("\n\n");
}

async function createAnthropicRefinementResponse(input: {
  instructions: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: 8192,
      messages: [
        {
          content: input.prompt,
          role: "user",
        },
      ],
      model: input.model.replace(/^anthropic:/, ""),
      system:
        input.instructions +
        "\n\nReturn only the required JSON object. Do not wrap it in markdown.",
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": getAnthropicApiKey(),
    },
    method: "POST",
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (AnthropicRefinementResponse & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    throw new Error(
      `Anthropic review chat request failed with ${response.status}: ${
        payload?.error?.message ?? response.statusText
      }`,
    );
  }

  if (!payload) {
    throw new Error("Anthropic review chat request returned an unreadable response.");
  }

  return {
    ...payload,
    model: payload.model ? `anthropic:${payload.model}` : input.model,
    output_text: readAnthropicOutputText(payload),
  } satisfies TailoredResumeResponse;
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
    `- Use ${listRefinedResumeKeywordCoverageToolName} when the user asks about scraped keyword coverage. Pass empty arrays for the current tailored resume, or pass candidate changes/insertions to inspect coverage after a possible edit.`,
    "- For changes, latexCode must contain only the replacement for that one listed segment.",
    "- To delete an existing bullet or block, return a change for that segmentId with latexCode set to an empty string and explain the deletion in reason. Do not use insertions to delete content.",
    "- For insertions, anchorSegmentId must be a listed editable segment id and latexCode must contain only the new block. Do not write JOBHELPER_SEGMENT_ID comments.",
    `- Before final JSON, call ${checkRefinedResumeHealthToolName} with the exact changes and insertions you intend to return. Read its rendered page-count and malformed-bullet result. If it reports overflow or changed malformed bullets, revise and call the tool again. Final JSON must match the last successful tool-checked candidate.`,
  ].join("\n\n");
}

function canonicalizeRefinementSignatureValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeRefinementSignatureValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [
        key,
        canonicalizeRefinementSignatureValue(entryValue),
      ]),
  );
}

function buildRefinementCandidateSignature(input: {
  changes: TailoredResumeRefinementResponse["changes"];
  insertions: TailoredResumeRefinementResponse["insertions"];
}) {
  return JSON.stringify(
    canonicalizeRefinementSignatureValue({
      changes: input.changes,
      insertions: input.insertions,
    }),
  );
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

function parseRefinementToolCandidate(args: Record<string, unknown>) {
  return parseTailoredResumeRefinementResponse({
    changes: args.changes,
    insertions: args.insertions,
    summary: "Tool candidate.",
  });
}

function buildRefinementCandidateAnnotatedLatex(input: {
  args: Record<string, unknown>;
  edits: TailoredResumeBlockEditRecord[];
  sourceAnnotatedLatexCode: string;
}) {
  const refinement = parseRefinementToolCandidate(input.args);
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

  return applyTailoredResumeRefinementOperations({
    annotatedLatexCode: input.sourceAnnotatedLatexCode,
    changes: [...mergedChangesBySegmentId.values()],
    insertions: refinement.insertions,
  });
}

function listRefinedResumeKeywordCoverage(input: {
  args: Record<string, unknown>;
  edits: TailoredResumeBlockEditRecord[];
  keywordCoverage: TailoredResumeKeywordCoverage | null | undefined;
  sourceAnnotatedLatexCode: string;
}) {
  if (!input.keywordCoverage) {
    return {
      error: "No scraped keyword coverage report is saved for this tailored resume.",
      ok: false,
    };
  }

  let annotatedLatexCode: string;

  try {
    annotatedLatexCode = buildRefinementCandidateAnnotatedLatex({
      args: input.args,
      edits: input.edits,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The proposed refinement could not be applied before keyword coverage.",
      ok: false,
    };
  }

  const emphasizedTechnologies = input.keywordCoverage.allPriorities.terms.map(
    (term) => ({
      evidence: "",
      name: term.name,
      priority: term.priority,
    }),
  );
  const coverage = buildTailoredResumeKeywordCoverage({
    emphasizedTechnologies,
    originalLatexCode: input.sourceAnnotatedLatexCode,
    tailoredLatexCode: stripTailorResumeSegmentIds(annotatedLatexCode),
  });

  return {
    allPriorities: coverage.allPriorities,
    highPriority: coverage.highPriority,
    includedInTailored: coverage.allPriorities.terms
      .filter((term) => term.presentInTailored)
      .map((term) => term.name),
    missingFromTailored: coverage.allPriorities.terms
      .filter((term) => !term.presentInTailored)
      .map((term) => term.name),
    newlyAddedVsOriginal: coverage.allPriorities.addedTerms,
    ok: true,
    scrapedKeywords: coverage.allPriorities.terms.map((term) => ({
      name: term.name,
      presentInOriginal: term.presentInOriginal,
      presentInTailored: term.presentInTailored,
      priority: term.priority,
    })),
    savedCoverageUpdatedAt: input.keywordCoverage.updatedAt,
  };
}

async function checkRefinedResumeHealth(input: {
  args: Record<string, unknown>;
  edits: TailoredResumeBlockEditRecord[];
  sourceAnnotatedLatexCode: string;
  targetPageCount: number;
}) {
  let refinement: TailoredResumeRefinementResponse;

  try {
    refinement = parseTailoredResumeRefinementResponse({
      changes: input.args.changes,
      insertions: input.args.insertions,
      summary: "Health check candidate.",
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The health-check tool arguments were invalid.",
      ok: false,
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

  let annotatedLatexCode: string;

  try {
    annotatedLatexCode = applyTailoredResumeRefinementOperations({
      annotatedLatexCode: input.sourceAnnotatedLatexCode,
      changes: [...mergedChangesBySegmentId.values()],
      insertions: refinement.insertions,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The proposed refinement could not be applied.",
      ok: false,
    };
  }

  const layout = await measureTailorResumeLayout({ annotatedLatexCode });
  const changedSegmentIds = new Set(
    buildTailoredResumeSnapshotComparisonEdits({
      endAnnotatedLatexCode: annotatedLatexCode,
      startAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    }).map((edit) => edit.segmentId),
  );
  const renderedBulletHealth = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds,
    layout,
  });
  const changedMalformedBullets =
    renderedBulletHealth.malformedBullets.filter(
      (bullet) => bullet.changedByCandidate,
    );
  const pageCountOk = layout.pageCount <= input.targetPageCount;
  const malformedOk = changedMalformedBullets.length === 0;

  return {
    changedMalformedBullets,
    malformedBulletCount: renderedBulletHealth.malformedBullets.length,
    nextAction:
      pageCountOk && malformedOk
        ? "The candidate is within page count and has no changed malformed bullets. Return final JSON matching this checked candidate."
        : "Revise the candidate, then call this health-check tool again before final JSON.",
    ok: pageCountOk && malformedOk,
    pageCount: layout.pageCount,
    pageCountOk,
    targetPageCount: input.targetPageCount,
    warnings: renderedBulletHealth.warnings,
  };
}

export async function refineTailoredResume(input: {
  edits: TailoredResumeBlockEditRecord[];
  feedback?: string;
  keywordCoverage?: TailoredResumeKeywordCoverage | null;
  model?: string;
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
  const model = input.model
    ? resolveTailorResumeSelectableModel(input.model)
    : process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();
  const maxAttempts = Math.min(2, getRetryAttemptsToGenerateLatexEdits());
  const sourceLatexCode = input.sourceAnnotatedLatexCode;
  let feedback = input.feedback?.trim() ?? "";
  let lastError = "Unable to refine the tailored resume edits.";
  let lastModel = model;
  const toolCalls: TailorResumeChatToolCallRecord[] = [];
  const sourceLayout = await measureTailorResumeLayout({
    annotatedLatexCode: sourceLatexCode,
  });
  const targetPageCount = Math.max(1, sourceLayout.pageCount);

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
    await input.onStreamEvent?.({ kind: "reset" });
    let outputText = "";
    let checkedCandidateOk = false;
    let latestCheckedCandidateSignature = "";

    if (model.startsWith("anthropic:")) {
      const response = (await runWithTransientModelRetries({
        operation: async () => {
          const response = await trackAiModelUsage({
            attempt,
            model,
            operation: "tailor-resume-review-chat",
            provider: "anthropic",
            request: () =>
              createAnthropicRefinementResponse({
                instructions,
                model,
                prompt: buildAnthropicRefinementPrompt(refinementInput),
              }),
            stepLabel: "chat",
          });
          const summary = readOutputText(response);

          if (summary) {
            await input.onStreamEvent?.({
              field: "assistantMessage",
              kind: "text-start",
            });
            await input.onStreamEvent?.({
              delta: summary,
              field: "assistantMessage",
              kind: "text-delta",
            });
          }

          return response;
        },
      })) as TailoredResumeResponse;

      lastModel = response.model ?? model;
      outputText = readOutputText(response);
    } else {
      let responseInput: unknown = refinementInput;
      let previousResponseId: string | undefined;

      for (
        let round = 1;
        round <= maxTailoredResumeRefinementToolRounds;
        round += 1
      ) {
        const response = (await runWithTransientModelRetries({
          operation: () =>
            trackAiModelUsage({
              attempt,
              model,
              operation: "tailor-resume-review-chat",
              provider: "openai",
              request: () =>
                client.responses.create({
                  input: responseInput as never,
                  instructions,
                  model,
                  parallel_tool_calls: false,
                  previous_response_id: previousResponseId,
                  reasoning: {
                    effort: "low",
                  },
                  text: {
                    verbosity: "low",
                    format: {
                      type: "json_schema",
                      name: "tailor_resume_refinement",
                      strict: true,
                      schema: refineTailoredResumeSchema,
                    },
                  },
                  tools: [
                    checkRefinedResumeHealthTool,
                    listRefinedResumeKeywordCoverageTool,
                  ],
                }),
              stepLabel: "chat",
            }),
        })) as TailoredResumeResponse;

        previousResponseId = response.id;
        lastModel = response.model ?? lastModel;
        const toolCall = readRefinementToolCall(response);

        if (toolCall) {
          const toolOutput =
            toolCall.name === checkRefinedResumeHealthToolName
              ? await checkRefinedResumeHealth({
                  args: parseRefinementToolArguments(toolCall),
                  edits: input.edits,
                  sourceAnnotatedLatexCode: sourceLatexCode,
                  targetPageCount,
                })
              : toolCall.name === listRefinedResumeKeywordCoverageToolName
                ? listRefinedResumeKeywordCoverage({
                    args: parseRefinementToolArguments(toolCall),
                    edits: input.edits,
                    keywordCoverage: input.keywordCoverage,
                    sourceAnnotatedLatexCode: sourceLatexCode,
                  })
              : {
                  error: `Unknown tool: ${toolCall.name}`,
                  ok: false,
                };

          toolCalls.push(serializeRefinementToolCall(toolCall, toolOutput));
          if (toolCall.name === checkRefinedResumeHealthToolName) {
            checkedCandidateOk = toolOutput.ok === true;
            latestCheckedCandidateSignature = checkedCandidateOk
              ? buildRefinementCandidateSignature(
                  parseRefinementToolCandidate(parseRefinementToolArguments(toolCall)),
                )
              : "";
          }
          responseInput = [
            {
              call_id: toolCall.call_id,
              output: JSON.stringify(toolOutput),
              type: "function_call_output",
            },
          ];
          continue;
        }

        outputText = readOutputText(response);

        if (checkedCandidateOk) {
          break;
        }

        responseInput = [
          {
            content: [
              {
                text:
                  "Before returning final JSON, call check_refined_resume_health with your candidate changes and insertions. Read the page count and malformed-bullet result, revise if needed, then return final JSON matching the checked candidate.",
                type: "input_text",
              },
            ],
            role: "user",
          },
        ];
      }
    }

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

    if (!model.startsWith("anthropic:")) {
      if (
        !checkedCandidateOk ||
        buildRefinementCandidateSignature(refinement) !==
          latestCheckedCandidateSignature
      ) {
        const finalCandidateSignature =
          buildRefinementCandidateSignature(refinement);
        const recoveredHealthCheck = await checkRefinedResumeHealth({
          args: {
            changes: refinement.changes,
            insertions: refinement.insertions,
          },
          edits: input.edits,
          sourceAnnotatedLatexCode: sourceLatexCode,
          targetPageCount,
        });

        toolCalls.push(
          serializeRefinementHealthCheckRecovery({
            candidate: {
              changes: refinement.changes,
              insertions: refinement.insertions,
            },
            output: {
              ...recoveredHealthCheck,
              recoveredFromFinalJson: true,
            },
          }),
        );

        if (recoveredHealthCheck.ok === true) {
          checkedCandidateOk = true;
          latestCheckedCandidateSignature = finalCandidateSignature;
        } else {
          lastError = missingRefinementHealthCheckError;
          feedback = [
            lastError,
            "The server checked the final JSON candidate directly and it did not pass.",
            "Call check_refined_resume_health with the exact changes and insertions you plan to return, then return final JSON that matches a successful checked candidate.",
          ].join("\n");
          continue;
        }
      }
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
        toolCalls,
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

    const finalLayout = await measureTailorResumeLayout({
      annotatedLatexCode: nextAnnotatedLatexCode,
    });
    const changedSegmentIds = new Set(
      buildTailoredResumeSnapshotComparisonEdits({
        endAnnotatedLatexCode: nextAnnotatedLatexCode,
        startAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      }).map((edit) => edit.segmentId),
    );
    const finalRenderedBulletHealth = buildTailorResumeRenderedBulletHealthCheck({
      changedSegmentIds,
      layout: finalLayout,
    });
    const malformedBulletError = formatTailorResumeChangedMalformedBulletError(
      finalRenderedBulletHealth,
    );

    if (finalLayout.pageCount > targetPageCount) {
      lastError = `The refined PDF rendered as ${finalLayout.pageCount} pages; the source resume target is ${targetPageCount}.`;
      feedback =
        `${lastError}\nRevise only the requested edit so the full rendered PDF stays within the target page count, then call check_refined_resume_health again.`;
      continue;
    }

    if (malformedBulletError) {
      lastError = malformedBulletError;
      feedback =
        `${malformedBulletError}\nRevise the malformed changed bullet, then call check_refined_resume_health again.`;
      continue;
    }

    if (refinement.summary) {
      await input.onStreamEvent?.({
        field: "assistantMessage",
        kind: "text-start",
      });
      await input.onStreamEvent?.({
        delta: refinement.summary,
        field: "assistantMessage",
        kind: "text-delta",
      });
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
      toolCalls,
    };
  }

  throw new Error(lastError);
}
