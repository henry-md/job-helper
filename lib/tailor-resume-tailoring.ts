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
  TailoredResumeThesis,
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
const tailorResumeBlockChangesSchema = {
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
    "thesis",
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
  thesis: TailoredResumeThesis;
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
  outcome: TailoredResumeGenerationOutcome;
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

export function parseTailoredResumeResponse(
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
    thesis: parseTailoredResumeThesis("thesis" in value ? value.thesis : null),
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
    "You must return a strict JSON object containing thesis, metadata, and only the block replacements to make.\n\n" +
    "Segment conventions:\n" +
    "1. Treat every % JOBHELPER_SEGMENT_ID: ... comment as a hard boundary for exactly one editable block.\n" +
    "2. segmentId chooses which single block to replace. latexCode must contain only the replacement for that one block.\n" +
    "3. Never include content from the previous or next segment inside the same latexCode string.\n" +
    "4. If the desired rewrite would cross into another segment marker, split it into multiple change objects, one per segmentId.\n" +
    "5. Never return a whole multi-block environment, list, or section when only one block was targeted.\n" +
    "6. In particular, do not replace one begin-resumebullets block with a full \\begin{resumebullets} ... \\resumeitem{...} ... \\resumeitem{...} ... \\end{resumebullets} payload when those later bullets belong to separate segmentIds.\n" +
    "7. Bad example: segmentId work-experience.begin-resumebullets-1 with latexCode containing the opening \\begin{resumebullets}, the first bullet, the next bullet, and \\end{resumebullets}. That spans multiple logical blocks and will be rejected.\n" +
    "8. Good example: if work-experience.begin-resumebullets-1 currently contains the opening \\begin{resumebullets} plus only the first bullet, return only that opening wrapper plus first bullet for that segmentId, then return a second change object for the next bullet's own segmentId.\n\n" +
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
    "Thesis rules:\n" +
    "1. Return thesis.jobDescriptionFocus and thesis.resumeChanges.\n" +
    "2. thesis.jobDescriptionFocus should explain what this job description emphasized beyond common denominator requirements like having a bachelor's degree, being a software engineer, or other baseline expectations. Strip out the generic signals and name the specific areas where this posting clearly over-indexes.\n" +
    "3. thesis.jobDescriptionFocus should focus on 2-4 high-signal themes and can quote short exact phrases from the job description when helpful.\n" +
    "4. thesis.resumeChanges should summarize the broad ways the resume should be or was changed to match those themes, such as which experience was elevated, compressed, reframed, or made more explicit.\n" +
    "5. thesis.resumeChanges should stay at the strategy level, not a line-by-line diff.\n" +
    "6. Keep each thesis field concise and high signal, ideally 2-4 sentences.\n\n" +
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
    "Common pitfalls:\n" +
    "1. The most common structural failure is crossing a % JOBHELPER_SEGMENT_ID boundary. When in doubt, split the rewrite into smaller one-segment changes.\n" +
    "2. Keep latexCode faithful to the targeted block's existing shape. If the source block is one bullet, return one bullet. If the source block is an opening wrapper plus one bullet, return only that opening wrapper plus one bullet.\n" +
    "3. Do not add or remove neighboring bullets, \\end{...} lines, or surrounding wrappers unless they are part of that exact targeted block.\n\n" +
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
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const maxTailoredResumeAttempts = getRetryAttemptsToGenerateLatexEdits();
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const fallbackMetadata = normalizeTailoredResumeMetadata({});
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
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: true,
        hasPreviewPdf: validation.ok,
      }),
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: validation.ok ? validation.previewPdf : null,
      savedLinkUpdateCount: finalizedTestCandidate.updatedCount,
      savedLinkUpdates: finalizedTestCandidate.updatedLinks,
      thesis: null,
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
  let lastThesis: TailoredResumeThesis | null = null;
  let lastModel = model;
  let hasAppliedCandidate = false;

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
        "The previous response was empty. Return the full structured response with thesis, metadata, and block changes.";
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
        `The previous response could not be parsed.\n\nExact issue:\n${lastError}\n\nReturn the full structured response with thesis, metadata, and block changes.`;
      continue;
    }

    lastMetadata = normalizeTailoredResumeMetadata(candidate);
    lastThesis = candidate.thesis;
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
      await input.onInvalidReplacement?.(
        buildInvalidTailorResumeReplacementLogPayload({
          annotatedLatexCode: normalizedInput.annotatedLatex,
          candidate,
          error: lastError,
        }),
        lastError,
        attempt,
      );
      feedback =
        `The previous structured response referenced invalid segment edits.\n\nExact issue:\n${lastError}\n\nReturn a corrected full response with thesis, metadata, and block changes.`;
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
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
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

    feedback =
      `Applying your previous block changes produced a compile failure.\n\n` +
      `Compiler error:\n${validation.error}\n\n` +
      "Return a corrected full structured response with revised thesis, metadata, and block changes.";
  }

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: maxTailoredResumeAttempts,
    companyName: lastMetadata.companyName,
    displayName: lastMetadata.displayName,
    edits: lastEdits,
    generationDurationMs: readGenerationDurationMs(),
    jobIdentifier: lastMetadata.jobIdentifier,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model: lastModel,
    outcome: classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate,
      hasPreviewPdf: false,
    }),
    positionTitle: lastMetadata.positionTitle,
    previewPdf: null,
    savedLinkUpdateCount: lastSavedLinkUpdateCount,
    savedLinkUpdates: lastSavedLinkUpdates,
    thesis: lastThesis,
    validationError:
      lastError ??
      `Unable to produce a tailored resume after ${maxTailoredResumeAttempts} attempts.`,
  };
}
