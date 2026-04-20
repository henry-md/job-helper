import OpenAI from "openai";
import {
  buildTailorResumeImplementationSystemPrompt,
  buildTailorResumePlanningSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { applyTailorResumeLinkOverridesWithSummary } from "./tailor-resume-link-overrides.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import {
  buildTailorResumePlanningSnapshot,
  type TailorResumePlanningBlock,
} from "./tailor-resume-planning.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import { buildTailoredResumeBlockEdits } from "./tailor-resume-review.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import type {
  TailorResumeLinkRecord,
  TailoredResumeBlockEditRecord,
  TailoredResumeOpenAiDebugTrace,
  TailoredResumePlanningChange,
  TailoredResumePlanningResult,
  TailoredResumeThesis,
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
const tailorResumePlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobDescriptionFocus: { type: "string" },
        resumeChanges: { type: "string" },
      },
      required: ["jobDescriptionFocus", "resumeChanges"],
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          desiredPlainText: { type: "string" },
          reason: { type: "string" },
          segmentId: { type: "string" },
        },
        required: ["segmentId", "desiredPlainText", "reason"],
      },
    },
    companyName: { type: "string" },
    displayName: { type: "string" },
    jobIdentifier: { type: "string" },
    positionTitle: { type: "string" },
  },
  required: [
    "thesis",
    "changes",
    "companyName",
    "displayName",
    "jobIdentifier",
    "positionTitle",
  ],
} as const;

const tailorResumeImplementationSchema = {
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
          segmentId: { type: "string" },
        },
        required: ["segmentId", "latexCode"],
      },
    },
  },
  required: ["changes"],
} as const;

type TailoredResumeImplementationChange = {
  latexCode: string;
  segmentId: string;
};

type TailoredResumeBlockChange = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

type TailoredResumePlanResponse = TailoredResumePlanningResult;

type TailoredResumeStructuredResponse = {
  changes: TailoredResumeBlockChange[];
  companyName: string;
  displayName: string;
  jobIdentifier: string;
  positionTitle: string;
  thesis: TailoredResumeThesis;
};

type TailoredResumeImplementationResponse = {
  changes: TailoredResumeImplementationChange[];
};

type TailoredResumeResponse = {
  id?: string;
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

export type GenerateTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  companyName: string;
  displayName: string;
  edits: TailoredResumeBlockEditRecord[];
  generationDurationMs: number;
  jobIdentifier: string;
  latexCode: string;
  model: string;
  openAiDebug: TailoredResumeOpenAiDebugTrace;
  outcome: TailoredResumeGenerationOutcome;
  planningResult: TailoredResumePlanningResult;
  positionTitle: string;
  previewPdf: Buffer | null;
  savedLinkUpdateCount: number;
  savedLinkUpdates: TailorResumeSavedLinkUpdate[];
  thesis: TailoredResumeThesis | null;
  validationError: string | null;
};

export type TailoredResumeGenerationOutcome =
  | "generation_failure"
  | "reviewable_failure"
  | "success";

export function classifyTailoredResumeGenerationOutcome(input: {
  hasAppliedCandidate: boolean;
  hasPreviewPdf: boolean;
}): TailoredResumeGenerationOutcome {
  if (input.hasPreviewPdf) {
    return "success";
  }

  return input.hasAppliedCandidate
    ? "reviewable_failure"
    : "generation_failure";
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
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

function buildDisplayName(input: {
  companyName: string;
  positionTitle: string;
}) {
  const companyName = input.companyName.trim();
  const positionTitle = input.positionTitle.trim();

  if (companyName && positionTitle) {
    return `${companyName} - ${positionTitle}`;
  }

  return companyName || positionTitle || "Tailored Resume";
}

function normalizeTailoredResumeMetadata(value: {
  companyName?: string;
  displayName?: string;
  jobIdentifier?: string;
  positionTitle?: string;
}) {
  const companyName = readTrimmedString(value.companyName);
  const positionTitle = readTrimmedString(value.positionTitle);
  const displayName =
    readTrimmedString(value.displayName) ||
    buildDisplayName({ companyName, positionTitle });
  const jobIdentifier = readTrimmedString(value.jobIdentifier) || "General";

  return {
    companyName,
    displayName,
    jobIdentifier,
    positionTitle,
  };
}

function parseTailoredResumeThesis(value: unknown): TailoredResumeThesis {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid thesis object.");
  }

  const jobDescriptionFocus =
    "jobDescriptionFocus" in value
      ? readTrimmedString(value.jobDescriptionFocus)
      : "";
  const resumeChanges =
    "resumeChanges" in value ? readTrimmedString(value.resumeChanges) : "";

  if (!jobDescriptionFocus) {
    throw new Error(
      "The model returned a thesis without jobDescriptionFocus.",
    );
  }

  if (!resumeChanges) {
    throw new Error("The model returned a thesis without resumeChanges.");
  }

  return {
    jobDescriptionFocus,
    resumeChanges,
  };
}

function parseTailoredResumePlanChange(
  value: unknown,
): TailoredResumePlanningChange {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid planned block change.");
  }

  const segmentId =
    "segmentId" in value ? readTrimmedString(value.segmentId) : "";
  const desiredPlainText =
    "desiredPlainText" in value && typeof value.desiredPlainText === "string"
      ? value.desiredPlainText.trim()
      : "";
  const reason =
    "reason" in value && typeof value.reason === "string"
      ? value.reason
      : "";

  if (!segmentId) {
    throw new Error(
      "The model returned a planned block change without a segmentId.",
    );
  }

  if (!readTrimmedString(reason)) {
    throw new Error("The model returned a planned block change without a reason.");
  }

  return {
    desiredPlainText,
    reason,
    segmentId,
  };
}

export function parseTailoredResumePlanResponse(
  value: unknown,
): TailoredResumePlanResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid tailoring plan.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  const changes = rawChanges.map(parseTailoredResumePlanChange);

  return {
    changes,
    ...normalizeTailoredResumeMetadata(value as TailoredResumePlanResponse),
    thesis: parseTailoredResumeThesis("thesis" in value ? value.thesis : null),
  };
}

function parseTailoredResumeImplementationChange(
  value: unknown,
): TailoredResumeImplementationChange {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid LaTeX implementation change.");
  }

  const segmentId =
    "segmentId" in value ? readTrimmedString(value.segmentId) : "";
  const latexCode =
    "latexCode" in value && typeof value.latexCode === "string"
      ? value.latexCode
      : "";

  if (!segmentId) {
    throw new Error(
      "The model returned a LaTeX implementation change without a segmentId.",
    );
  }

  return {
    latexCode,
    segmentId,
  };
}

function parseTailoredResumeImplementationResponse(
  value: unknown,
): TailoredResumeImplementationResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid LaTeX implementation.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  return {
    changes: rawChanges.map(parseTailoredResumeImplementationChange),
  };
}

function validateTailoredResumePlanChanges(input: {
  changes: TailoredResumePlanningChange[];
  planningBlocks: TailorResumePlanningBlock[];
}) {
  const planningBlockIds = new Set(
    input.planningBlocks.map((block) => block.segmentId),
  );
  const seenSegmentIds = new Set<string>();

  for (const change of input.changes) {
    if (seenSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate planned edits for segment ${change.segmentId}.`,
      );
    }

    if (!planningBlockIds.has(change.segmentId)) {
      throw new Error(
        `The model planned an edit for unknown segment ${change.segmentId}.`,
      );
    }

    seenSegmentIds.add(change.segmentId);
  }
}

function buildTailoredResumeBlockChanges(input: {
  implementationChanges: TailoredResumeImplementationChange[];
  plannedChanges: TailoredResumePlanningChange[];
}) {
  const plannedSegmentIds = new Set(
    input.plannedChanges.map((change) => change.segmentId),
  );
  const implementationById = new Map<string, TailoredResumeImplementationChange>();

  for (const change of input.implementationChanges) {
    if (!plannedSegmentIds.has(change.segmentId)) {
      throw new Error(
        `The model returned a LaTeX implementation for unknown segment ${change.segmentId}.`,
      );
    }

    if (implementationById.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate LaTeX implementations for segment ${change.segmentId}.`,
      );
    }

    implementationById.set(change.segmentId, change);
  }

  return input.plannedChanges.map((plannedChange) => {
    const implementationChange = implementationById.get(plannedChange.segmentId);

    if (!implementationChange) {
      throw new Error(
        `The model did not return a LaTeX implementation for segment ${plannedChange.segmentId}.`,
      );
    }

    return {
      latexCode: implementationChange.latexCode,
      reason: plannedChange.reason,
      segmentId: plannedChange.segmentId,
    } satisfies TailoredResumeBlockChange;
  });
}

function serializeTailorResumePlanningBlocks(
  blocks: TailorResumePlanningBlock[],
) {
  if (blocks.length === 0) {
    return "[no editable plaintext blocks found]";
  }

  return blocks
    .map(
      (block, index) =>
        [
          `${index + 1}. segmentId: ${block.segmentId}`,
          `   command: ${block.command ?? "unknown"}`,
          `   current text: ${block.plainText}`,
        ].join("\n"),
    )
    .join("\n\n");
}

function serializeTailorResumeImplementationBlocks(input: {
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  plannedChanges: TailoredResumePlanningChange[];
}) {
  if (input.plannedChanges.length === 0) {
    return "[no planned changes]";
  }

  return input.plannedChanges
    .map((change, index) => {
      const block = input.planningBlocksById.get(change.segmentId);

      return [
        `${index + 1}. segmentId: ${change.segmentId}`,
        `   command: ${block?.command ?? "unknown"}`,
        `   current text: ${block?.plainText ?? "[missing block]"}`,
        `   desired text: ${change.desiredPlainText || "[remove this block]"}`,
        `   reason: ${change.reason.trim()}`,
        "   original latex block:",
        block?.latexCode ?? "[missing block]",
      ].join("\n");
    })
    .join("\n\n");
}

function buildTailoringPlanInstructions(input: {
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumePlanningSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
    },
  );
}

function buildTailoringImplementationInstructions(input: {
  feedback?: string;
  promptSettings?: SystemPromptSettings;
}) {
  return buildTailorResumeImplementationSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      feedback: input.feedback,
    },
  );
}

export function applyTailorResumeBlockChanges(input: {
  annotatedLatexCode: string;
  changes: TailoredResumeBlockChange[];
}) {
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const blocks = readAnnotatedTailorResumeBlocks(normalizedInput.annotatedLatex);
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const changesById = new Map<string, TailoredResumeBlockChange>();

  for (const change of input.changes) {
    if (changesById.has(change.segmentId)) {
      throw new Error(
        `The model returned duplicate edits for segment ${change.segmentId}.`,
      );
    }

    if (!blocksById.has(change.segmentId)) {
      throw new Error(
        `The model referenced unknown segment ${change.segmentId}.`,
      );
    }

    changesById.set(change.segmentId, change);
  }

  const chunks: string[] = [];
  let cursor = 0;

  for (const block of blocks) {
    const change = changesById.get(block.id);

    chunks.push(
      normalizedInput.annotatedLatex.slice(cursor, block.markerStart),
    );

    if (!change) {
      chunks.push(
        normalizedInput.annotatedLatex.slice(block.markerStart, block.contentEnd),
      );
      cursor = block.contentEnd;
      continue;
    }

    const replacementLatex = repairTailoredResumeModelLatexBlock(
      stripTailorResumeSegmentIds(change.latexCode),
    );

    if (replacementLatex.trim()) {
      const replacementSegmentCount =
        normalizeTailorResumeLatex(replacementLatex).segmentCount;

      if (replacementSegmentCount > 1) {
        throw new Error(
          `Replacement for segment ${change.segmentId} spans multiple logical blocks.`,
        );
      }

      chunks.push(replacementLatex);

      if (!replacementLatex.endsWith("\n") && block.contentEnd < normalizedInput.annotatedLatex.length) {
        chunks.push("\n");
      }
    }

    cursor = block.contentEnd;
  }

  chunks.push(normalizedInput.annotatedLatex.slice(cursor));

  return normalizeTailorResumeLatex(chunks.join(""));
}

export function repairTailoredResumeModelLatexBlock(latexCode: string) {
  const unescapedDollarIndexes: number[] = [];

  for (let index = 0; index < latexCode.length; index += 1) {
    if (latexCode[index] !== "$") {
      continue;
    }

    if (index > 0 && latexCode[index - 1] === "\\") {
      continue;
    }

    unescapedDollarIndexes.push(index);
  }

  if (unescapedDollarIndexes.length !== 1) {
    return latexCode;
  }

  const dollarIndex = unescapedDollarIndexes[0] ?? -1;

  if (dollarIndex === -1) {
    return latexCode;
  }

  return `${latexCode.slice(0, dollarIndex)}\\$${latexCode.slice(dollarIndex + 1)}`;
}

export function buildInvalidTailorResumeReplacementLogPayload(input: {
  annotatedLatexCode: string;
  candidate: TailoredResumeStructuredResponse;
  error: string;
}) {
  const blocksById = new Map(
    readAnnotatedTailorResumeBlocks(input.annotatedLatexCode).map((block) => [
      block.id,
      block,
    ]),
  );

  const referencedBlockSections = input.candidate.changes.map((change, index) => {
    const sourceBlock = blocksById.get(change.segmentId);
    const sectionLines = [
      `Change ${index + 1}`,
      `segmentId: ${change.segmentId}`,
      `reason: ${change.reason.trim() || "[missing reason]"}`,
      `source command: ${sourceBlock?.command ?? "[missing]"}`,
      "Original block:",
      sourceBlock?.latexCode || "[segment not found in annotated source LaTeX]",
      "Replacement block:",
      change.latexCode || "[empty string]",
    ];

    return sectionLines.join("\n");
  });

  return [
    "Tailor Resume invalid replacement",
    "",
    "Validation error:",
    input.error,
    "",
    "Structured response:",
    JSON.stringify(input.candidate, null, 2),
    "",
    "Referenced source blocks:",
    referencedBlockSections.length > 0
      ? referencedBlockSections.join("\n\n---\n\n")
      : "[no block changes returned]",
    "",
    "Annotated source LaTeX:",
    input.annotatedLatexCode,
  ].join("\n");
}

function applySavedTailoredResumeLinks(
  annotatedLatexCode: string,
  linkOverrides: TailorResumeLinkRecord[],
) {
  if (linkOverrides.length === 0) {
    return {
      normalizedLatex: normalizeTailorResumeLatex(annotatedLatexCode),
      updatedCount: 0,
      updatedLinks: [],
    };
  }

  const overrideResult = applyTailorResumeLinkOverridesWithSummary(
    annotatedLatexCode,
    linkOverrides,
  );

  return {
    normalizedLatex: normalizeTailorResumeLatex(overrideResult.latexCode),
    updatedCount: overrideResult.updatedCount,
    updatedLinks: overrideResult.updatedLinks,
  };
}

function buildTailoringPlanInput(input: {
  jobDescription: string;
  planningSnapshot: ReturnType<typeof buildTailorResumePlanningSnapshot>;
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            `Job description:\n${input.jobDescription}\n\n` +
            `Whole resume plain text:\n${input.planningSnapshot.resumePlainText}\n\n` +
            "Editable resume blocks (document order):\n" +
            serializeTailorResumePlanningBlocks(input.planningSnapshot.blocks),
        },
      ],
    },
  ];
}

function buildTailoringImplementationInput(input: {
  jobDescription: string;
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  plan: TailoredResumePlanResponse;
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            `Job description:\n${input.jobDescription}\n\n` +
            "Accepted tailoring thesis:\n" +
            `jobDescriptionFocus: ${input.plan.thesis.jobDescriptionFocus}\n` +
            `resumeChanges: ${input.plan.thesis.resumeChanges}\n\n` +
            "Planned segment edits:\n" +
            serializeTailorResumeImplementationBlocks({
              planningBlocksById: input.planningBlocksById,
              plannedChanges: input.plan.changes,
            }),
        },
      ],
    },
  ];
}

function serializeTailoredResumePrompt(input: {
  instructions: string;
  inputMessages: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    role?: string;
  }>;
}) {
  const serializedInput = input.inputMessages
    .map((message) => {
      const textBlocks = (message.content ?? [])
        .filter((contentBlock) => contentBlock.type === "input_text")
        .map((contentBlock) => contentBlock.text?.trim() ?? "")
        .filter(Boolean);

      if (textBlocks.length === 0) {
        return null;
      }

      return [`Role: ${message.role ?? "user"}`, ...textBlocks].join("\n\n");
    })
    .filter((message) => message !== null)
    .join("\n\n---\n\n");

  return [
    "Instructions:",
    input.instructions.trim(),
    "",
    "Input:",
    serializedInput || "[no input text]",
  ].join("\n");
}

export async function generateTailoredResume(input: {
  annotatedLatexCode: string;
  jobDescription: string;
  linkOverrides?: TailorResumeLinkRecord[];
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
  promptSettings?: SystemPromptSettings;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const maxTailoredResumeAttempts = getRetryAttemptsToGenerateLatexEdits();
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const fallbackMetadata = normalizeTailoredResumeMetadata({});
  const fallbackPlanningResult: TailoredResumePlanningResult = {
    changes: [],
    companyName: fallbackMetadata.companyName,
    displayName: fallbackMetadata.displayName,
    jobIdentifier: fallbackMetadata.jobIdentifier,
    positionTitle: fallbackMetadata.positionTitle,
    thesis: {
      jobDescriptionFocus:
        "TEST_OPENAI_RESPONSE or fallback mode skipped the planning call, so no planner thesis was generated.",
      resumeChanges:
        "No intermediate plan was produced; the base resume was compiled without planned block edits.",
    },
  };
  const fallbackOpenAiDebug: TailoredResumeOpenAiDebugTrace = {
    implementation: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Implementation stage did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
    },
    planning: {
      outputJson: null,
      prompt: null,
      skippedReason:
        "Planning stage did not run because TEST_OPENAI_RESPONSE bypassed live OpenAI calls.",
    },
  };
  const readGenerationDurationMs = () => Math.max(0, Date.now() - startedAt);

  if (isTestOpenAIResponseEnabled()) {
    const finalizedTestCandidate = applySavedTailoredResumeLinks(
      normalizedInput.annotatedLatex,
      linkOverrides,
    );
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(finalizedTestCandidate.normalizedLatex.annotatedLatex),
    );

    return {
      annotatedLatexCode: finalizedTestCandidate.normalizedLatex.annotatedLatex,
      attempts: 1,
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      edits: [],
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: fallbackMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(
        finalizedTestCandidate.normalizedLatex.annotatedLatex,
      ),
      model: TEST_OPENAI_RESPONSE_MODEL,
      openAiDebug: fallbackOpenAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: true,
        hasPreviewPdf: validation.ok,
      }),
      planningResult: fallbackPlanningResult,
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: validation.ok ? validation.previewPdf : null,
      savedLinkUpdateCount: finalizedTestCandidate.updatedCount,
      savedLinkUpdates: finalizedTestCandidate.updatedLinks,
      thesis: fallbackPlanningResult.thesis,
      validationError: validation.ok ? null : validation.error,
    };
  }

  const client = getOpenAIClient();
  const planningSnapshot = buildTailorResumePlanningSnapshot(
    normalizedInput.annotatedLatex,
  );
  const planningBlocksById = new Map(
    planningSnapshot.blocks.map((block) => [block.segmentId, block]),
  );
  const maxPlanningAttempts = Math.min(2, maxTailoredResumeAttempts);
  let planningFeedback = "";
  let implementationFeedback = "";
  let lastError: string | null = null;
  let lastMetadata = fallbackMetadata;
  let lastAnnotatedLatex = normalizedInput.annotatedLatex;
  let lastEdits: TailoredResumeBlockEditRecord[] = [];
  let lastSavedLinkUpdateCount = 0;
  let lastSavedLinkUpdates: TailorResumeSavedLinkUpdate[] = [];
  let lastThesis: TailoredResumeThesis | null = null;
  let lastPlanningResult = fallbackPlanningResult;
  let lastOpenAiDebug = fallbackOpenAiDebug;
  let lastModel = model;
  let hasAppliedCandidate = false;
  let completedPlanningAttempts = 0;
  let completedImplementationAttempts = 0;
  let plan: TailoredResumePlanResponse | null = null;
  let planningPrompt: string | null = null;
  let planningOutputJson: string | null = null;
  let implementationPrompt: string | null = null;
  let implementationOutputJson: string | null = null;
  let implementationSkippedReason: string | null =
    "Implementation stage has not run yet.";

  for (let attempt = 1; attempt <= maxPlanningAttempts; attempt += 1) {
    const planInput = buildTailoringPlanInput({
      jobDescription: input.jobDescription,
      planningSnapshot,
    });
    const planInstructions = buildTailoringPlanInstructions({
      feedback: planningFeedback,
      promptSettings: input.promptSettings,
    });
    planningPrompt = serializeTailoredResumePrompt({
      inputMessages: planInput,
      instructions: planInstructions,
    });
    const response = await client.responses.create({
      input: planInput,
      instructions: planInstructions,
      model,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "tailor_resume_edit_plan",
          strict: true,
          schema: tailorResumePlanSchema,
        },
      },
    });

    completedPlanningAttempts = attempt;
    lastModel = (response as { model?: string }).model ?? model;

    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty tailoring plan.";
      planningFeedback =
        "The previous response was empty. Return the full structured response with thesis, metadata, and plaintext block changes.";
      continue;
    }

    let nextPlan: TailoredResumePlanResponse;

    try {
      nextPlan = parseTailoredResumePlanResponse(JSON.parse(outputText));
      validateTailoredResumePlanChanges({
        changes: nextPlan.changes,
        planningBlocks: planningSnapshot.blocks,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable tailoring plan.";
      planningFeedback =
        `The previous response could not be parsed or validated.\n\nExact issue:\n${lastError}\n\nReturn the full structured response with thesis, metadata, and plaintext block changes.`;
      continue;
    }

    plan = nextPlan;
    planningOutputJson = outputText;
    lastMetadata = normalizeTailoredResumeMetadata(nextPlan);
    lastThesis = nextPlan.thesis;
    lastPlanningResult = nextPlan;
    lastOpenAiDebug = {
      implementation: {
        outputJson: implementationOutputJson,
        prompt: implementationPrompt,
        skippedReason: implementationSkippedReason,
      },
      planning: {
        outputJson: planningOutputJson,
        prompt: planningPrompt,
        skippedReason: null,
      },
    };
    break;
  }

  if (!plan) {
    return {
      annotatedLatexCode: lastAnnotatedLatex,
      attempts: completedPlanningAttempts || maxPlanningAttempts,
      companyName: lastMetadata.companyName,
      displayName: lastMetadata.displayName,
      edits: lastEdits,
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: lastMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
      model: lastModel,
      openAiDebug: lastOpenAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate,
        hasPreviewPdf: false,
      }),
      planningResult: lastPlanningResult,
      positionTitle: lastMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: lastSavedLinkUpdateCount,
      savedLinkUpdates: lastSavedLinkUpdates,
      thesis: lastThesis,
      validationError:
        lastError ??
        `Unable to produce a tailored resume plan after ${maxPlanningAttempts} attempts.`,
    };
  }

  if (plan.changes.length === 0) {
    implementationSkippedReason =
      "Implementation stage was skipped because the planner returned no segment changes.";
    lastOpenAiDebug = {
      implementation: {
        outputJson: null,
        prompt: null,
        skippedReason: implementationSkippedReason,
      },
      planning: {
        outputJson: planningOutputJson,
        prompt: planningPrompt,
        skippedReason: null,
      },
    };
    const normalizedCandidate = applySavedTailoredResumeLinks(
      normalizedInput.annotatedLatex,
      linkOverrides,
    );
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
    );

    hasAppliedCandidate = true;
    lastAnnotatedLatex = normalizedCandidate.normalizedLatex.annotatedLatex;
    lastSavedLinkUpdateCount = normalizedCandidate.updatedCount;
    lastSavedLinkUpdates = normalizedCandidate.updatedLinks;

    if (validation.ok) {
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: completedPlanningAttempts || 1,
        companyName: lastMetadata.companyName,
        displayName: lastMetadata.displayName,
        edits: [],
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: lastMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug: lastOpenAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: lastPlanningResult,
        positionTitle: lastMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: lastThesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      completedPlanningAttempts || 1,
    );

    return {
      annotatedLatexCode: lastAnnotatedLatex,
      attempts: completedPlanningAttempts || 1,
      companyName: lastMetadata.companyName,
      displayName: lastMetadata.displayName,
      edits: [],
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: lastMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
      model: lastModel,
      openAiDebug: lastOpenAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: true,
        hasPreviewPdf: false,
      }),
      planningResult: lastPlanningResult,
      positionTitle: lastMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: lastSavedLinkUpdateCount,
      savedLinkUpdates: lastSavedLinkUpdates,
      thesis: lastThesis,
      validationError: lastError,
    };
  }

  implementationSkippedReason = null;
  for (let attempt = 1; attempt <= maxTailoredResumeAttempts; attempt += 1) {
    const implementationInput = buildTailoringImplementationInput({
      jobDescription: input.jobDescription,
      plan,
      planningBlocksById,
    });
    const implementationInstructions = buildTailoringImplementationInstructions({
      feedback: implementationFeedback,
      promptSettings: input.promptSettings,
    });
    implementationPrompt = serializeTailoredResumePrompt({
      inputMessages: implementationInput,
      instructions: implementationInstructions,
    });
    const response = await client.responses.create({
      input: implementationInput,
      instructions: implementationInstructions,
      model,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "tailor_resume_latex_implementation",
          strict: true,
          schema: tailorResumeImplementationSchema,
        },
      },
    });

    completedImplementationAttempts = attempt;
    lastModel = (response as { model?: string }).model ?? model;

    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty LaTeX implementation.";
      implementationFeedback =
        "The previous response was empty. Return the strict JSON object with one LaTeX replacement per planned segment.";
      continue;
    }

    let implementation: TailoredResumeImplementationResponse;

    try {
      implementation = parseTailoredResumeImplementationResponse(
        JSON.parse(outputText),
      );
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable LaTeX implementation.";
      implementationFeedback =
        `The previous implementation response could not be parsed.\n\nExact issue:\n${lastError}\n\nReturn the strict JSON object with one LaTeX replacement per planned segment.`;
      continue;
    }

    implementationOutputJson = outputText;
    lastOpenAiDebug = {
      implementation: {
        outputJson: implementationOutputJson,
        prompt: implementationPrompt,
        skippedReason: null,
      },
      planning: {
        outputJson: planningOutputJson,
        prompt: planningPrompt,
        skippedReason: null,
      },
    };
    const candidateForLogging: TailoredResumeStructuredResponse = {
      changes: implementation.changes.map((change) => ({
        latexCode: change.latexCode,
        reason:
          plan.changes.find(
            (plannedChange) => plannedChange.segmentId === change.segmentId,
          )?.reason ?? "[missing reason]",
        segmentId: change.segmentId,
      })),
      companyName: lastMetadata.companyName,
      displayName: lastMetadata.displayName,
      jobIdentifier: lastMetadata.jobIdentifier,
      positionTitle: lastMetadata.positionTitle,
      thesis: plan.thesis,
    };

    let candidateChanges: TailoredResumeBlockChange[];
    let candidateEdits: TailoredResumeBlockEditRecord[];
    let appliedCandidate;

    try {
      candidateChanges = buildTailoredResumeBlockChanges({
        implementationChanges: implementation.changes,
        plannedChanges: plan.changes,
      });
      candidateEdits = buildTailoredResumeBlockEdits({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidateChanges,
      });
      appliedCandidate = applyTailorResumeBlockChanges({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidateChanges,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to apply the requested block replacements.";
      await input.onInvalidReplacement?.(
        buildInvalidTailorResumeReplacementLogPayload({
          annotatedLatexCode: normalizedInput.annotatedLatex,
          candidate: candidateForLogging,
          error: lastError,
        }),
        lastError,
        attempt,
      );
      implementationFeedback =
        `The previous LaTeX implementation referenced invalid segment edits.\n\nExact issue:\n${lastError}\n\nReturn a corrected strict JSON object with one LaTeX replacement per planned segment.`;
      continue;
    }

    const normalizedCandidate = applySavedTailoredResumeLinks(
      appliedCandidate.annotatedLatex,
      linkOverrides,
    );
    hasAppliedCandidate = true;
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
    );

    lastAnnotatedLatex = normalizedCandidate.normalizedLatex.annotatedLatex;
    lastEdits = candidateEdits;
    lastSavedLinkUpdateCount = normalizedCandidate.updatedCount;
    lastSavedLinkUpdates = normalizedCandidate.updatedLinks;

    if (validation.ok) {
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: attempt,
        companyName: lastMetadata.companyName,
        displayName: lastMetadata.displayName,
        edits: candidateEdits,
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: lastMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug: lastOpenAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: lastPlanningResult,
        positionTitle: lastMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: lastThesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      attempt,
    );

    implementationFeedback =
      `Applying your previous LaTeX implementations produced a compile failure.\n\n` +
      `Compiler error:\n${validation.error}\n\n` +
      "Return corrected LaTeX replacements for the same planned segments only.";
  }

  const failedAttempts = completedImplementationAttempts || maxTailoredResumeAttempts;

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: failedAttempts,
    companyName: lastMetadata.companyName,
    displayName: lastMetadata.displayName,
    edits: lastEdits,
    generationDurationMs: readGenerationDurationMs(),
    jobIdentifier: lastMetadata.jobIdentifier,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model: lastModel,
    openAiDebug: lastOpenAiDebug,
    outcome: classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate,
      hasPreviewPdf: false,
    }),
    planningResult: lastPlanningResult,
    positionTitle: lastMetadata.positionTitle,
    previewPdf: null,
    savedLinkUpdateCount: lastSavedLinkUpdateCount,
    savedLinkUpdates: lastSavedLinkUpdates,
    thesis: lastThesis,
    validationError:
      lastError ??
      `Unable to implement a tailored resume after ${failedAttempts} attempts.`,
  };
}
