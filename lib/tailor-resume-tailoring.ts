import OpenAI from "openai";
import { applyTailorResumeLinkOverridesWithSummary } from "./tailor-resume-link-overrides.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import {
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import type {
  TailorResumeLinkRecord,
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
const segmentMarkerPattern = /^[ \t]*% JOBHELPER_SEGMENT_ID:\s*([^\n]+)\s*(?:\n|$)/gm;
const tailorResumeBlockChangesSchema = {
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
    companyName: { type: "string" },
    displayName: { type: "string" },
    jobIdentifier: { type: "string" },
    positionTitle: { type: "string" },
  },
  required: [
    "changes",
    "companyName",
    "displayName",
    "jobIdentifier",
    "positionTitle",
  ],
} as const;

type TailoredResumeBlockChange = {
  latexCode: string;
  segmentId: string;
};

type TailoredResumeStructuredResponse = {
  changes: TailoredResumeBlockChange[];
  companyName: string;
  displayName: string;
  jobIdentifier: string;
  positionTitle: string;
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

type AnnotatedTailorResumeBlock = {
  contentEnd: number;
  id: string;
  markerStart: number;
};

export type GenerateTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  companyName: string;
  displayName: string;
  jobIdentifier: string;
  latexCode: string;
  model: string;
  positionTitle: string;
  previewPdf: Buffer | null;
  savedLinkUpdateCount: number;
  savedLinkUpdates: TailorResumeSavedLinkUpdate[];
  validationError: string | null;
};

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

function normalizeTailoredResumeMetadata(
  value: Partial<TailoredResumeStructuredResponse>,
) {
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

function parseTailoredResumeResponse(
  value: unknown,
): TailoredResumeStructuredResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid tailoring payload.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges)) {
    throw new Error("The model did not return a changes array.");
  }

  const changes = rawChanges.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("The model returned an invalid block change.");
    }

    const segmentId =
      "segmentId" in entry ? readTrimmedString(entry.segmentId) : "";
    const latexCode =
      "latexCode" in entry && typeof entry.latexCode === "string"
        ? entry.latexCode
        : "";

    if (!segmentId) {
      throw new Error("The model returned a block change without a segmentId.");
    }

    return {
      latexCode,
      segmentId,
    };
  });

  return {
    changes,
    ...normalizeTailoredResumeMetadata(
      value as Partial<TailoredResumeStructuredResponse>,
    ),
  };
}

function buildTailoringInstructions(input: { feedback?: string }) {
  const feedbackBlock = input.feedback?.trim()
    ? `Previous attempt feedback:\n${input.feedback.trim()}\n\n`
    : "";

  return (
    `${feedbackBlock}` +
    "Tailor the provided resume LaTeX for the provided job description. " +
    "The resume includes immutable server-owned comments in the form % JOBHELPER_SEGMENT_ID: ... directly above each logical LaTeX block.\n\n" +
    "You must return a strict JSON object describing only the block replacements to make.\n\n" +
    "How block replacements work:\n" +
    "1. Each change targets one existing segmentId from the provided annotated LaTeX.\n" +
    "2. Replacing a segment swaps the entire block that starts at that segment comment and ends right before the next segment comment.\n" +
    "3. Your replacement latexCode can contain multiple logical LaTeX blocks when you need to expand or reorder content.\n" +
    "4. Use an empty string for latexCode only when removing that block entirely is clearly helpful.\n" +
    "5. Never invent, rename, or return % JOBHELPER_SEGMENT_ID comments. The server re-adds them deterministically after applying your edits.\n" +
    "6. Never reference the same segmentId more than once.\n\n" +
    "Metadata rules:\n" +
    "1. companyName should be the employer if identifiable.\n" +
    "2. positionTitle should be the role title if identifiable.\n" +
    "3. jobIdentifier should be the best short disambiguator for this job: prefer the team name, otherwise location, otherwise a brief identifying phrase.\n" +
    "4. displayName should be the user-facing saved name, preferably \"Company - Role\".\n\n" +
    "Guardrails:\n" +
    "1. Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "2. Prefer the smallest set of content edits that materially improve fit.\n" +
    "3. It is heavily discouraged to change styling, page layout, margins, font sizing, spacing systems, or macro structure unless the user explicitly asked for layout changes or the document cannot work without that fix.\n" +
    "4. Keep the final document pdflatex-compatible after your replacements are applied.\n"
  );
}

function readAnnotatedTailorResumeBlocks(annotatedLatexCode: string) {
  const blocks: AnnotatedTailorResumeBlock[] = [];
  const matches: Array<{
    id: string;
    markerEnd: number;
    markerStart: number;
  }> = [];

  for (const match of annotatedLatexCode.matchAll(new RegExp(segmentMarkerPattern))) {
    const markerStart = match.index ?? 0;
    const markerText = match[0] ?? "";
    const rawId = match[1] ?? "";
    const id = rawId.trim();

    if (!id || !markerText) {
      continue;
    }

    matches.push({
      id,
      markerEnd: markerStart + markerText.length,
      markerStart,
    });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const currentMatch = matches[index];
    const nextMatch = matches[index + 1];

    blocks.push({
      contentEnd: nextMatch?.markerStart ?? annotatedLatexCode.length,
      id: currentMatch.id,
      markerStart: currentMatch.markerStart,
    });
  }

  return blocks;
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

    const replacementLatex = stripTailorResumeSegmentIds(change.latexCode);

    if (replacementLatex.trim()) {
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

function buildTailoringInput(input: {
  annotatedLatexCode: string;
  jobDescription: string;
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            `Job description:\n${input.jobDescription}\n\n` +
            `Annotated base resume LaTeX:\n${input.annotatedLatexCode}`,
        },
      ],
    },
  ];
}

export async function generateTailoredResume(input: {
  annotatedLatexCode: string;
  jobDescription: string;
  linkOverrides?: TailorResumeLinkRecord[];
}): Promise<GenerateTailoredResumeResult> {
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const maxTailoredResumeAttempts = getRetryAttemptsToGenerateLatexEdits();
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const fallbackMetadata = normalizeTailoredResumeMetadata({});

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
      jobIdentifier: fallbackMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(
        finalizedTestCandidate.normalizedLatex.annotatedLatex,
      ),
      model: TEST_OPENAI_RESPONSE_MODEL,
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: validation.ok ? validation.previewPdf : null,
      savedLinkUpdateCount: finalizedTestCandidate.updatedCount,
      savedLinkUpdates: finalizedTestCandidate.updatedLinks,
      validationError: validation.ok ? null : validation.error,
    };
  }

  const client = getOpenAIClient();
  let feedback = "";
  let lastError: string | null = null;
  let lastMetadata = fallbackMetadata;
  let lastAnnotatedLatex = normalizedInput.annotatedLatex;
  let lastSavedLinkUpdateCount = 0;
  let lastSavedLinkUpdates: TailorResumeSavedLinkUpdate[] = [];
  let lastModel = model;

  for (let attempt = 1; attempt <= maxTailoredResumeAttempts; attempt += 1) {
    const response = await client.responses.create({
      input: buildTailoringInput({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        jobDescription: input.jobDescription,
      }),
      instructions: buildTailoringInstructions({ feedback }),
      model,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "tailor_resume_block_changes",
          strict: true,
          schema: tailorResumeBlockChangesSchema,
        },
      },
    });

    lastModel = (response as { model?: string }).model ?? model;

    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty tailoring response.";
      feedback =
        "The previous response was empty. Return the full structured response with metadata and block changes.";
      continue;
    }

    let candidate: TailoredResumeStructuredResponse;

    try {
      candidate = parseTailoredResumeResponse(JSON.parse(outputText));
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable tailoring payload.";
      feedback =
        `The previous response could not be parsed.\n\nExact issue:\n${lastError}`;
      continue;
    }

    lastMetadata = normalizeTailoredResumeMetadata(candidate);

    let appliedCandidate;

    try {
      appliedCandidate = applyTailorResumeBlockChanges({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidate.changes,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to apply the requested block replacements.";
      feedback =
        `The previous structured response referenced invalid segment edits.\n\nExact issue:\n${lastError}\n\nReturn a corrected full response.`;
      continue;
    }

    const normalizedCandidate = applySavedTailoredResumeLinks(
      appliedCandidate.annotatedLatex,
      linkOverrides,
    );
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
    );

    lastAnnotatedLatex = normalizedCandidate.normalizedLatex.annotatedLatex;
    lastSavedLinkUpdateCount = normalizedCandidate.updatedCount;
    lastSavedLinkUpdates = normalizedCandidate.updatedLinks;

    if (validation.ok) {
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: attempt,
        companyName: lastMetadata.companyName,
        displayName: lastMetadata.displayName,
        jobIdentifier: lastMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        positionTitle: lastMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        validationError: null,
      };
    }

    lastError = validation.error;
    feedback =
      `Applying your previous block changes produced a compile failure.\n\n` +
      `Compiler error:\n${validation.error}\n\n` +
      "Return a corrected full structured response with revised metadata and block changes.";
  }

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: maxTailoredResumeAttempts,
    companyName: lastMetadata.companyName,
    displayName: lastMetadata.displayName,
    jobIdentifier: lastMetadata.jobIdentifier,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model: lastModel,
    positionTitle: lastMetadata.positionTitle,
    previewPdf: null,
    savedLinkUpdateCount: lastSavedLinkUpdateCount,
    savedLinkUpdates: lastSavedLinkUpdates,
    validationError:
      lastError ??
      `Unable to produce a tailored resume after ${maxTailoredResumeAttempts} attempts.`,
  };
}
