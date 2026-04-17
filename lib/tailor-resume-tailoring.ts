import OpenAI from "openai";
import { applyTailorResumeLinkOverridesWithSummary } from "./tailor-resume-link-overrides.ts";
import { validateTailorResumeLatexDocument } from "./tailor-resume-link-validation.ts";
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
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
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
          reason: { type: "string" },
          segmentId: { type: "string" },
        },
        required: ["segmentId", "latexCode", "reason"],
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
  reason: string;
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

export type GenerateTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  companyName: string;
  displayName: string;
  edits: TailoredResumeBlockEditRecord[];
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
    const reason =
      "reason" in entry && typeof entry.reason === "string"
        ? entry.reason
        : "";

    if (!segmentId) {
      throw new Error("The model returned a block change without a segmentId.");
    }

    if (!readTrimmedString(reason)) {
      throw new Error("The model returned a block change without a reason.");
    }

    return {
      latexCode,
      reason,
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
    "3. Your replacement latexCode must contain exactly one logical LaTeX block: the replacement for that targeted segment only.\n" +
    "4. Use an empty string for latexCode only when removing that block entirely is clearly helpful.\n" +
    "5. Never invent, rename, or return % JOBHELPER_SEGMENT_ID comments. The server re-adds them deterministically after applying your edits.\n" +
    "6. Never reference the same segmentId more than once.\n" +
    "7. Every change must include a concise reason string that explains why the edit improves fit for this specific job description.\n\n" +
    "Metadata rules:\n" +
    "1. companyName should be the employer if identifiable.\n" +
    "2. positionTitle should be the role title if identifiable.\n" +
    "3. jobIdentifier should be the best short disambiguator for this job: prefer the team name, otherwise location, otherwise a brief identifying phrase.\n" +
    "4. displayName should be the user-facing saved name, preferably \"Company - Role\".\n\n" +
    "Reason rules:\n" +
    "1. Keep every reason to 1-2 short sentences maximum.\n" +
    "2. Sentence 1 should briefly summarize the high-level change you made.\n" +
    "3. Sentence 2 should explain why that change matters for this role, preferably by quoting a short exact phrase from the job description in quotation marks.\n" +
    "4. If the pasted job description makes the section clear, explicitly say whether that quote came from a required/basic qualification, a preferred/good-to-have qualification, responsibilities, or another labeled section.\n" +
    "5. Do not guess section labels. If the pasted text does not clearly identify the section, just give the quote without inventing where it came from.\n" +
    "6. When the job description explicitly emphasizes something, quote those exact words instead of vaguely saying it was emphasized or mentioned in the description.\n" +
    "7. If no short exact quote fits naturally, use the closest brief phrase from the job description, but still avoid generic wording like \"matches the job description\" with no supporting detail.\n" +
    "8. Prefer concise fragments or incomplete sentences over polished prose.\n" +
    "9. NEVER under any circumstances write 3 sentences for a single block edit.\n" +
    "10. Good examples: \"Surfaces GitHub OSS work earlier. Required qualifications mention \\\"GitHub-hosted open-source projects\\\".\" and \"Moves Python frameworks higher. Preferred qualifications emphasize \\\"relevant frameworks\\\" and \\\"Python\\\".\"\n" +
    "11. Bad examples: \"Highlights relevant experience because the description emphasizes it.\" and \"Matches the required section\" with no quote.\n" +
    "12. Focus on the job-description signal you matched, not on generic writing advice.\n\n" +
    "Job description source quality:\n" +
    "The job description below may be scraped from a job board page and can include navigation chrome, sidebar links, footer text, and listings for other roles. " +
    "Identify and focus only on the single target job posting. Ignore unrelated job listings, site navigation, and boilerplate page text.\n\n" +
    "Guardrails:\n" +
    "1. Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "2. Prefer the smallest set of content edits that materially improve fit.\n" +
    "3. If three chunks need edits, return three separate changes. Never bundle sibling chunks into one latexCode replacement.\n" +
    "4. It is heavily discouraged to change styling, page layout, margins, font sizing, spacing systems, or macro structure unless the user explicitly asked for layout changes or the document cannot work without that fix.\n" +
    "5. Keep the final document pdflatex-compatible after your replacements are applied.\n" +
    "6. Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these characters unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).\n"
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

    const replacementLatex = stripTailorResumeSegmentIds(change.latexCode);

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
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
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
      edits: [],
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
  let lastEdits: TailoredResumeBlockEditRecord[] = [];
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
    const candidateEdits = buildTailoredResumeBlockEdits({
      annotatedLatexCode: normalizedInput.annotatedLatex,
      changes: candidate.changes,
    });

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

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      attempt,
    );

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
    edits: lastEdits,
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
