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
  buildTailorResumeKeywordCheckResult,
  buildTailorResumeKeywordPresenceContext,
  resumeTextIncludesKeyword,
} from "./tailor-resume-keyword-coverage.ts";
import { formatTailorResumeTermWithCapitalFirst } from "./tailor-resume-non-technologies.ts";
import {
  buildTailorResumePlanningSnapshot,
  type TailorResumePlanningBlock,
  type TailorResumePlanningSnapshot,
} from "./tailor-resume-planning.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import { getRetryAttemptsToGenerateLatexEdits } from "./tailor-resume-retry-config.ts";
import {
  formatTransientModelError,
  isTransientModelError,
  runWithTransientModelRetries,
} from "./tailor-resume-transient-retry.ts";
import { buildTailoredResumeBlockEdits } from "./tailor-resume-review.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import type {
  TailorResumeKeywordCheckResult,
  TailorResumeGenerationStepEvent,
  TailorResumeLinkRecord,
  TailoredResumeBlockEditRecord,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeOpenAiDebugStage,
  TailoredResumeOpenAiDebugTrace,
  TailoredResumePlanningChange,
  TailoredResumePlanningResult,
  TailoredResumeThesis,
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";
import {
  filterTailorResumeNonTechnologiesFromEmphasizedTechnologies,
  type TailorResumeUserMarkdownState,
} from "./tailor-resume-user-memory.ts";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";
const tailorResumeGenerationStepCount = 5;
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
    emphasizedTechnologies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence: { type: "string" },
          name: { type: "string" },
          priority: {
            type: "string",
            enum: ["high", "low"],
          },
        },
        required: ["name", "priority", "evidence"],
      },
    },
    positionTitle: { type: "string" },
  },
  required: [
    "thesis",
    "changes",
    "companyName",
    "displayName",
    "emphasizedTechnologies",
    "positionTitle",
  ],
} as const;

const tailorResumeTechnologyExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    emphasizedTechnologies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence: { type: "string" },
          name: { type: "string" },
          priority: {
            type: "string",
            enum: ["high", "low"],
          },
        },
        required: ["name", "priority", "evidence"],
      },
    },
  },
  required: ["emphasizedTechnologies"],
} as const;

async function emitTailorResumeGenerationStep(
  onStepEvent:
    | ((event: TailorResumeGenerationStepEvent) => void | Promise<void>)
    | undefined,
  event: Omit<TailorResumeGenerationStepEvent, "stepCount">,
) {
  await onStepEvent?.({
    ...event,
    stepCount: tailorResumeGenerationStepCount,
  });
}

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

const tailorResumePlanningKeywordCheckToolName =
  "check_planned_resume_keyword_coverage";
const tailorResumeImplementationKeywordCheckToolName =
  "check_implemented_resume_keyword_coverage";
const maxKeywordCheckToolRoundsPerAttempt = 4;

const tailorResumePlanningKeywordCheckTool = {
  type: "function",
  name: tailorResumePlanningKeywordCheckToolName,
  description:
    "Check keyword coverage for the current Step 3 plaintext plan by applying the proposed desiredPlainText replacements to the full resume and reporting which high- and low-priority terms are present in the resulting visible resume text.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            desiredPlainText: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["segmentId", "desiredPlainText"],
        },
      },
    },
    required: ["changes"],
  },
} as const;

const tailorResumeImplementationKeywordCheckTool = {
  type: "function",
  name: tailorResumeImplementationKeywordCheckToolName,
  description:
    "Check keyword coverage for the current Step 4 LaTeX implementation by applying the proposed block replacements to the full resume, rendering visible plain text deterministically, and reporting which high- and low-priority terms are present.",
  strict: true,
  parameters: {
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
  },
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
  jobIdentifier?: string;
  positionTitle: string;
  thesis: TailoredResumeThesis;
};

type TailoredResumeImplementationResponse = {
  changes: TailoredResumeImplementationChange[];
};

type TailorResumeStepResponseInput = Array<
  | {
      content: Array<{
        text: string;
        type: "input_text";
      }>;
      role: "user";
    }
  | {
      call_id: string;
      output: string;
      type: "function_call_output";
    }
>;

type TailorResumeQuestioningKeywordRequirement = {
  detail: string;
  keyword: string;
  targetSegmentIds: string[];
};

type TailorResumePlanningKeywordCheckToolCall = {
  arguments: string;
  call_id: string;
  name: typeof tailorResumePlanningKeywordCheckToolName;
};

type TailorResumeImplementationKeywordCheckToolCall = {
  arguments: string;
  call_id: string;
  name: typeof tailorResumeImplementationKeywordCheckToolName;
};

type TailoredResumeResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    arguments?: unknown;
    call_id?: unknown;
    content?: Array<{
      text?: unknown;
      type?: unknown;
    }>;
    name?: unknown;
    type?: unknown;
  }>;
  output_text?: unknown;
};

export type PlanTailoredResumeResult =
  | {
      attempts: number;
      generationDurationMs: number;
      model: string;
      ok: true;
      planningDebug: TailoredResumeOpenAiDebugStage;
      planningResult: TailoredResumePlanningResult;
      planningSnapshot: TailorResumePlanningSnapshot;
      thesis: TailoredResumeThesis;
    }
  | {
      attempts: number;
      generationDurationMs: number;
      model: string;
      ok: false;
      planningDebug: TailoredResumeOpenAiDebugStage;
      planningResult: TailoredResumePlanningResult;
      planningSnapshot: TailorResumePlanningSnapshot;
      thesis: TailoredResumeThesis | null;
      validationError: string;
    };

export type ExtractTailorResumeEmphasizedTechnologiesResult = {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  generationDurationMs: number;
  model: string;
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
  if (typeof response.output_text === "string") {
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

function findPlanningKeywordCheckToolCall(
  response: TailoredResumeResponse,
): TailorResumePlanningKeywordCheckToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === tailorResumePlanningKeywordCheckToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: tailorResumePlanningKeywordCheckToolName,
      };
    }
  }

  return null;
}

function findImplementationKeywordCheckToolCall(
  response: TailoredResumeResponse,
): TailorResumeImplementationKeywordCheckToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === tailorResumeImplementationKeywordCheckToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: tailorResumeImplementationKeywordCheckToolName,
      };
    }
  }

  return null;
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseKeywordCheckPlanningChanges(
  value: unknown,
): Array<Pick<TailoredResumePlanningChange, "desiredPlainText" | "segmentId">> {
  if (!value || typeof value !== "object" || !("changes" in value)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  const rawChanges = value.changes;

  if (!Array.isArray(rawChanges)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  return rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The keyword-check tool call included an invalid change.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const desiredPlainText =
      "desiredPlainText" in change && typeof change.desiredPlainText === "string"
        ? change.desiredPlainText
        : "";

    if (!segmentId) {
      throw new Error(
        "The keyword-check tool call included a change without a segmentId.",
      );
    }

    return {
      desiredPlainText,
      segmentId,
    };
  });
}

function parseKeywordCheckImplementationChanges(
  value: unknown,
): Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">> {
  if (!value || typeof value !== "object" || !("changes" in value)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  const rawChanges = value.changes;

  if (!Array.isArray(rawChanges)) {
    throw new Error(
      "The keyword-check tool call did not include a changes array.",
    );
  }

  return rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The keyword-check tool call included an invalid change.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const latexCode =
      "latexCode" in change && typeof change.latexCode === "string"
        ? change.latexCode
        : "";

    if (!segmentId) {
      throw new Error(
        "The keyword-check tool call included a change without a segmentId.",
      );
    }

    return {
      latexCode,
      segmentId,
    };
  });
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

const nonResumeSkillKeywordNames = new Set([
  "production cluster",
  "production clusters",
  "production infrastructure",
]);

function normalizeTailorResumeKeywordName(value: string) {
  const trimmedValue = value.trim();

  if (
    /\bkubernetes\s*[- ]\s*based\b/i.test(trimmedValue) &&
    /\bpaas\b/i.test(trimmedValue)
  ) {
    return "Kubernetes";
  }

  return trimmedValue;
}

function isResumeSkillKeywordName(value: string) {
  return !nonResumeSkillKeywordNames.has(normalizeEmployerKeyword(value));
}

function parseTailoredResumeEmphasizedTechnology(
  value: unknown,
): TailoredResumeEmphasizedTechnology {
  if (!value || typeof value !== "object") {
    throw new Error("The model returned an invalid emphasized technology.");
  }

  const name =
    "name" in value
      ? formatTailorResumeTermWithCapitalFirst(
          normalizeTailorResumeKeywordName(readTrimmedString(value.name)),
        )
      : "";
  const priority =
    "priority" in value && (value.priority === "high" || value.priority === "low")
      ? value.priority
      : null;
  const evidence = "evidence" in value ? readTrimmedString(value.evidence) : "";

  if (!name) {
    throw new Error("The model returned an emphasized technology without a name.");
  }

  if (!priority) {
    throw new Error(
      `The model returned emphasized technology "${name}" without a valid priority.`,
    );
  }

  return {
    evidence,
    name,
    priority,
  };
}

function normalizeTailoredResumeEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[],
) {
  const normalizedTechnologies =
    new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of technologies) {
    if (!isResumeSkillKeywordName(technology.name)) {
      continue;
    }

    const key = technology.name.toLowerCase();
    const existingTechnology = normalizedTechnologies.get(key);

    if (
      !existingTechnology ||
      (existingTechnology.priority === "low" && technology.priority === "high")
    ) {
      normalizedTechnologies.set(key, technology);
    }
  }

  return [...normalizedTechnologies.values()];
}

function parseTailoredResumeEmphasizedTechnologies(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("The model did not return an emphasizedTechnologies array.");
  }

  return normalizeTailoredResumeEmphasizedTechnologies(
    value.map(parseTailoredResumeEmphasizedTechnology),
  );
}

export function parseTailorResumeTechnologyExtractionResponse(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return a valid technology extraction.");
  }

  return parseTailoredResumeEmphasizedTechnologies(
    "emphasizedTechnologies" in value ? value.emphasizedTechnologies : null,
  );
}

function technologyAppearsInJobDescription(input: {
  employerName?: string | null;
  jobDescription: string;
  technology: TailoredResumeEmphasizedTechnology;
}) {
  if (
    isEmployerSpecificTechnologyTerm({
      employerName: input.employerName,
      evidence: input.technology.evidence,
      technologyName: input.technology.name,
    })
  ) {
    return false;
  }

  return resumeTextIncludesKeyword({
    term: input.technology.name,
    text: input.jobDescription,
  });
}

const employerNameNoiseWords = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "technologies",
  "technology",
]);

function normalizeEmployerKeyword(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readEmployerNameKeywords(value: string | null | undefined) {
  const normalizedName = normalizeEmployerKeyword(value ?? "");

  if (!normalizedName) {
    return [];
  }

  const tokens = normalizedName
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 &&
        !employerNameNoiseWords.has(token),
    );

  return [...new Set([normalizedName, ...tokens])];
}

function evidenceExplicitlyAsksForCandidateProductExperience(evidence: string) {
  return /\b(?:experience|experienced|familiarity|proficiency|background)\s+(?:with|using|in)\b/i.test(
    evidence,
  );
}

function isEmployerSpecificTechnologyTerm(input: {
  employerName?: string | null;
  evidence: string;
  technologyName: string;
}) {
  const normalizedTechnologyName = normalizeEmployerKeyword(input.technologyName);

  if (!normalizedTechnologyName) {
    return false;
  }

  if (evidenceExplicitlyAsksForCandidateProductExperience(input.evidence)) {
    return false;
  }

  const employerKeywords = readEmployerNameKeywords(input.employerName);

  return employerKeywords.some(
    (keyword) =>
      normalizedTechnologyName === keyword ||
      normalizedTechnologyName.startsWith(`${keyword} `) ||
      normalizedTechnologyName.endsWith(` ${keyword}`),
  );
}

const tailorResumeJobTechnologyHintNames = [
  "GitHub Actions",
  "Spring Boot",
  "Scikit-learn",
  "Elasticsearch",
  "TypeScript",
  "JavaScript",
  "PostgreSQL",
  "Kubernetes",
  "Terraform",
  "Cassandra",
  "GraphQL",
  "Next.js",
  "Node.js",
  "FastAPI",
  "DynamoDB",
  "Snowflake",
  "Databricks",
  "TensorFlow",
  "LangChain",
  "OpenAI",
  "Prometheus",
  "Grafana",
  "Datadog",
  "Jenkins",
  "CircleCI",
  "Gradle",
  "GitHub",
  "GitLab",
  "Docker",
  "Python",
  "Kotlin",
  "Swift",
  "Ruby",
  "Rails",
  "Django",
  "Flask",
  "Spring",
  "Express",
  "React",
  "Redux",
  "Angular",
  "Svelte",
  "Vue",
  "Tailwind",
  "Vite",
  "Webpack",
  "Babel",
  "Jest",
  "Playwright",
  "Cypress",
  "Selenium",
  "Kafka",
  "Redis",
  "MongoDB",
  "MySQL",
  "Postgres",
  "Spark",
  "Hadoop",
  "Airflow",
  "Pandas",
  "NumPy",
  "PyTorch",
  "AWS",
  "Azure",
  "GCP",
  "Lambda",
  "S3",
  "gRPC",
  "REST",
  "SQL",
  "NoSQL",
  "HTML",
  "CSS",
  "Linux",
  "Unix",
  "Bash",
  "C++",
  "C#",
  "Java",
  "Go",
] as const;

const highPriorityTechnologyEvidencePattern =
  /\b(required|requirements|basic qualifications|min(?:imum)? qualifications|must|need|technologies we use|tech stack|we use|including|languages|build tooling)\b/i;
const lowPriorityTechnologyEvidencePattern =
  /\b(preferred|nice[- ]to[- ]have|nice to have|bonus|plus|familiar(?:ity)?|exposure)\b/i;

const deterministicTailorResumeKeywordDenyListTerms = [
  "blueprint",
  "chromium",
  "commit previews",
  "frontend frameworks",
  "internationalization",
  "storage systems",
  "developer experience",
  "internet terminology",
  "open-source",
] as const;

function isDeterministicTailorResumeKeywordDenyListEnabled() {
  return /^(1|true|yes|on)$/i.test(
    process.env.USE_DENY_LIST_FOR_KEYWORDS?.trim() ?? "",
  );
}

function readTailorResumeKeywordNonTechnologies(
  nonTechnologies: readonly string[] | null | undefined,
) {
  return isDeterministicTailorResumeKeywordDenyListEnabled()
    ? [...(nonTechnologies ?? []), ...deterministicTailorResumeKeywordDenyListTerms]
    : nonTechnologies;
}

function truncateTechnologyEvidence(value: string) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  return normalizedValue.length > 220
    ? `${normalizedValue.slice(0, 217).trim()}...`
    : normalizedValue;
}

function buildTechnologyEvidenceChunks(jobDescription: string) {
  const lines = jobDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentences = jobDescription
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: Array<{ context: string; evidence: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    chunks.push({
      context: lines.slice(Math.max(0, index - 2), index + 1).join(" "),
      evidence: lines[index],
    });
  }

  for (const sentence of sentences) {
    chunks.push({
      context: sentence,
      evidence: sentence,
    });
  }

  return chunks;
}

function readTechnologyHintPriority(input: { context: string; evidence: string }) {
  const evidenceHasHighPriority =
    highPriorityTechnologyEvidencePattern.test(input.evidence);
  const evidenceHasLowPriority =
    lowPriorityTechnologyEvidencePattern.test(input.evidence);

  if (evidenceHasLowPriority && !evidenceHasHighPriority) {
    return "low";
  }

  const hasHighPriorityEvidence = highPriorityTechnologyEvidencePattern.test(
    input.context,
  );
  const hasLowPriorityEvidence = lowPriorityTechnologyEvidencePattern.test(
    input.context,
  );

  return hasLowPriorityEvidence && !hasHighPriorityEvidence ? "low" : "high";
}

export function extractTailorResumeJobDescriptionTechnologyHints(
  jobDescription: string,
  options: {
    employerName?: string | null;
    nonTechnologies?: readonly string[] | null;
  } = {},
): TailoredResumeEmphasizedTechnology[] {
  const chunks = buildTechnologyEvidenceChunks(jobDescription);
  const technologies: TailoredResumeEmphasizedTechnology[] = [];

  for (const name of tailorResumeJobTechnologyHintNames) {
    const matchingChunk = chunks.find((chunk) =>
      resumeTextIncludesKeyword({
        term: name,
        text: chunk.evidence,
      }),
    );

    if (!matchingChunk) {
      continue;
    }

    technologies.push({
      evidence: truncateTechnologyEvidence(matchingChunk.evidence),
      name,
      priority: readTechnologyHintPriority({
        context: matchingChunk.context,
        evidence: matchingChunk.evidence,
      }),
    });
  }

  return mergeTailorResumeJobDescriptionTechnologies({
    extractedTechnologies: technologies,
    employerName: options.employerName,
    jobDescription,
    nonTechnologies: options.nonTechnologies,
    plannerTechnologies: [],
  });
}

export function mergeTailorResumeJobDescriptionTechnologies(input: {
  employerName?: string | null;
  extractedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobDescription: string;
  nonTechnologies?: readonly string[] | null;
  plannerTechnologies: TailoredResumeEmphasizedTechnology[];
}) {
  return filterTailorResumeNonTechnologiesFromEmphasizedTechnologies(
    normalizeTailoredResumeEmphasizedTechnologies([
      ...input.extractedTechnologies.filter(
        (technology) =>
          technologyAppearsInJobDescription({
            employerName: input.employerName,
            jobDescription: input.jobDescription,
            technology,
          }),
      ),
      ...input.plannerTechnologies.filter(
        (technology) =>
          technologyAppearsInJobDescription({
            employerName: input.employerName,
            jobDescription: input.jobDescription,
            technology,
          }),
      ),
    ]),
    readTailorResumeKeywordNonTechnologies(input.nonTechnologies),
  );
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
    emphasizedTechnologies: parseTailoredResumeEmphasizedTechnologies(
      "emphasizedTechnologies" in value ? value.emphasizedTechnologies : null,
    ),
    questioningSummary: null,
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

function buildPlannedResumePlainText(input: {
  changes: Array<Pick<TailoredResumePlanningChange, "desiredPlainText" | "segmentId">>;
  planningSnapshot: TailorResumePlanningSnapshot;
}) {
  const changesById = new Map(
    input.changes.map((change) => [change.segmentId, change]),
  );

  return input.planningSnapshot.blocks
    .map((block) => {
      const change = changesById.get(block.segmentId);
      return change ? change.desiredPlainText.trim() : block.plainText;
    })
    .filter(Boolean)
    .join("\n");
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

function buildKeywordCheckToolOutput(result: TailorResumeKeywordCheckResult) {
  return JSON.stringify(result, null, 2);
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

function serializeTailorResumeEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[] | undefined,
) {
  const resolvedTechnologies = technologies ?? [];

  if (resolvedTechnologies.length === 0) {
    return "[none identified]";
  }

  return resolvedTechnologies
    .map((technology, index) =>
      [
        `${index + 1}. ${technology.name}`,
        `   priority: ${technology.priority}`,
        `   evidence: ${technology.evidence || "[not provided]"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function normalizeTechnologyName(value: string) {
  return value.trim().toLowerCase();
}

type TailorResumeUserMarkdownQuotedSentence = {
  explicitBoldTerms: string[];
  heading: string;
  text: string;
};

function stripMarkdownStrongMarkers(value: string) {
  return value.replace(/(\*\*|__)([^*_][\s\S]*?)\1/g, "$2");
}

function readMarkdownStrongTerms(value: string) {
  const terms: string[] = [];
  const strongPattern = /(\*\*|__)([^*_][\s\S]*?)\1/g;
  let match: RegExpExecArray | null;

  while ((match = strongPattern.exec(value)) !== null) {
    const term = stripMarkdownStrongMarkers(match[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();

    if (term) {
      terms.push(term);
    }
  }

  return terms;
}

function readUserMarkdownQuotedSentences(
  markdown: string,
): TailorResumeUserMarkdownQuotedSentence[] {
  const sentences: TailorResumeUserMarkdownQuotedSentence[] = [];
  let currentHeading = "";

  for (const line of markdown.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmedLine);

    if (headingMatch) {
      currentHeading = stripMarkdownStrongMarkers(headingMatch[2] ?? "")
        .replace(/^#+\s*/, "")
        .trim();
      continue;
    }

    const quotePattern = /["“]([^"”]{12,})["”]/g;
    let quoteMatch: RegExpExecArray | null;

    while ((quoteMatch = quotePattern.exec(trimmedLine)) !== null) {
      const rawText = quoteMatch[1] ?? "";
      const text = stripMarkdownStrongMarkers(rawText)
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        continue;
      }

      sentences.push({
        explicitBoldTerms: readMarkdownStrongTerms(rawText),
        heading: currentHeading,
        text,
      });
    }
  }

  return sentences;
}

function normalizeTextForUserMarkdownMatch(value: string) {
  return stripMarkdownStrongMarkers(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTextMatchTokens(value: string) {
  return normalizeTextForUserMarkdownMatch(value)
    .split(" ")
    .filter((token) => token.length >= 4 || /[+#./-]/.test(token));
}

function userMarkdownSentenceMatchesLatexText(input: {
  sentence: TailorResumeUserMarkdownQuotedSentence;
  text: string;
}) {
  const sentenceText = normalizeTextForUserMarkdownMatch(input.sentence.text);
  const latexText = normalizeTextForUserMarkdownMatch(input.text);

  if (!sentenceText || !latexText) {
    return false;
  }

  if (sentenceText.includes(latexText) || latexText.includes(sentenceText)) {
    return true;
  }

  const sentenceTokens = readTextMatchTokens(input.sentence.text);

  if (sentenceTokens.length === 0) {
    return false;
  }

  const latexTokens = new Set(readTextMatchTokens(input.text));
  const matchedTokenCount = sentenceTokens.filter((token) =>
    latexTokens.has(token),
  ).length;

  return matchedTokenCount >= 4 && matchedTokenCount / sentenceTokens.length >= 0.6;
}

function isTermBoundaryCharacter(character: string | undefined) {
  return !character || !/[A-Za-z0-9+#./-]/.test(character);
}

function findStandaloneTermIndex(input: {
  fromIndex?: number;
  term: string;
  text: string;
}) {
  const term = input.term.trim();

  if (!term) {
    return -1;
  }

  const lowerText = input.text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let index = lowerText.indexOf(lowerTerm, input.fromIndex ?? 0);

  while (index >= 0) {
    const before = input.text[index - 1];
    const after = input.text[index + term.length];

    if (isTermBoundaryCharacter(before) && isTermBoundaryCharacter(after)) {
      return index;
    }

    index = lowerText.indexOf(lowerTerm, index + 1);
  }

  return -1;
}

function textIncludesStandaloneTerm(input: { term: string; text: string }) {
  return findStandaloneTermIndex(input) >= 0;
}

function readBoldTermKey(term: string) {
  return normalizeTextForUserMarkdownMatch(term);
}

function readUserMarkdownBoldCandidateTerms(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  latexPlainText: string;
  sentences: TailorResumeUserMarkdownQuotedSentence[];
}) {
  const candidates: string[] = [];
  const addCandidate = (term: string) => {
    const trimmedTerm = stripMarkdownStrongMarkers(term)
      .replace(/\s+/g, " ")
      .trim();
    const termKey = readBoldTermKey(trimmedTerm);

    if (!trimmedTerm || !termKey) {
      return;
    }

    if (
      !textIncludesStandaloneTerm({
        term: trimmedTerm,
        text: input.latexPlainText,
      })
    ) {
      return;
    }

    const hasOverlappingCandidate = candidates.some((candidate) => {
      const candidateKey = readBoldTermKey(candidate);
      return (
        candidateKey === termKey ||
        candidateKey.includes(termKey) ||
        termKey.includes(candidateKey)
      );
    });

    if (!hasOverlappingCandidate) {
      candidates.push(trimmedTerm);
    }
  };

  for (const sentence of input.sentences) {
    for (const explicitBoldTerm of sentence.explicitBoldTerms) {
      addCandidate(explicitBoldTerm);
    }
  }

  const sortedTechnologies = [...input.emphasizedTechnologies].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority === "high" ? -1 : 1;
    }

    return right.name.length - left.name.length;
  });

  for (const technology of sortedTechnologies) {
    const appearsInMatchingUserMarkdownSentence = input.sentences.some(
      (sentence) =>
        textIncludesStandaloneTerm({
          term: technology.name,
          text: sentence.text,
        }) ||
        textIncludesStandaloneTerm({
          term: technology.name,
          text: sentence.heading,
        }),
    );

    if (appearsInMatchingUserMarkdownSentence) {
      addCandidate(technology.name);
    }
  }

  return candidates;
}

function findMatchingLatexBraceIndex(latexCode: string, openBraceIndex: number) {
  let depth = 0;

  for (let index = openBraceIndex; index < latexCode.length; index += 1) {
    const character = latexCode[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function isInsideLatexTextbfGroup(latexCode: string, index: number) {
  let searchIndex = 0;

  while (searchIndex < index) {
    const commandIndex = latexCode.indexOf("\\textbf", searchIndex);

    if (commandIndex < 0 || commandIndex >= index) {
      return false;
    }

    const openBraceIndex = latexCode.indexOf("{", commandIndex + "\\textbf".length);

    if (openBraceIndex < 0) {
      return true;
    }

    if (openBraceIndex >= index) {
      searchIndex = commandIndex + 1;
      continue;
    }

    if (
      latexCode
        .slice(commandIndex + "\\textbf".length, openBraceIndex)
        .trim() !== ""
    ) {
      searchIndex = commandIndex + 1;
      continue;
    }

    const closeBraceIndex = findMatchingLatexBraceIndex(latexCode, openBraceIndex);

    if (closeBraceIndex === null || closeBraceIndex >= index) {
      return true;
    }

    searchIndex = commandIndex + 1;
  }

  return false;
}

function isInsideLatexCommandName(latexCode: string, index: number) {
  let cursor = index - 1;

  while (cursor >= 0 && /[A-Za-z]/.test(latexCode[cursor] ?? "")) {
    cursor -= 1;
  }

  return latexCode[cursor] === "\\";
}

function convertMarkdownStrongMarkersToLatexBold(latexCode: string) {
  return latexCode
    .replace(/\*\*([^{}\n*]{1,120})\*\*/g, String.raw`\textbf{$1}`)
    .replace(/__([^{}\n_]{1,120})__/g, String.raw`\textbf{$1}`);
}

function isTailorResumeSkillsSegment(change: { latexCode: string; segmentId: string }) {
  return (
    /\bskills?\b/i.test(change.segmentId) ||
    /\\resume(?:Subheading|Section)\{[^{}]*skills?[^{}]*\}/i.test(
      change.latexCode,
    )
  );
}

function applyLatexBoldToFirstStandaloneTerm(input: {
  latexCode: string;
  term: string;
}) {
  const variants = [
    input.term,
    input.term.replace(/#/g, String.raw`\#`),
  ].filter((variant, index, variants) => variants.indexOf(variant) === index);
  let bestMatch: { index: number; term: string } | null = null;

  for (const variant of variants) {
    let index = findStandaloneTermIndex({
      term: variant,
      text: input.latexCode,
    });

    while (index >= 0) {
      if (
        !isInsideLatexTextbfGroup(input.latexCode, index) &&
        !isInsideLatexCommandName(input.latexCode, index)
      ) {
        if (!bestMatch || index < bestMatch.index) {
          bestMatch = { index, term: variant };
        }

        break;
      }

      index = findStandaloneTermIndex({
        fromIndex: index + variant.length,
        term: variant,
        text: input.latexCode,
      });
    }
  }

  if (!bestMatch) {
    return input.latexCode;
  }

  const matchedTerm = input.latexCode.slice(
    bestMatch.index,
    bestMatch.index + bestMatch.term.length,
  );

  return [
    input.latexCode.slice(0, bestMatch.index),
    String.raw`\textbf{`,
    matchedTerm,
    "}",
    input.latexCode.slice(bestMatch.index + bestMatch.term.length),
  ].join("");
}

export function applyTailorResumeUserMarkdownBoldFormatting(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  implementationChanges: Array<{ latexCode: string; segmentId: string }>;
  userMarkdown?: TailorResumeUserMarkdownState | null;
}): Array<{ latexCode: string; segmentId: string }> {
  const markdown = input.userMarkdown?.markdown ?? "";
  const userMarkdownSentences = readUserMarkdownQuotedSentences(markdown);

  if (userMarkdownSentences.length === 0) {
    return input.implementationChanges.map((change) => ({ ...change }));
  }

  return input.implementationChanges.map((change) => {
    if (isTailorResumeSkillsSegment(change)) {
      return {
        ...change,
        latexCode: stripMarkdownStrongMarkers(change.latexCode),
      };
    }

    const latexPlainText = renderTailoredResumeLatexToPlainText(change.latexCode);
    const matchingSentences = userMarkdownSentences.filter((sentence) =>
      userMarkdownSentenceMatchesLatexText({
        sentence,
        text: latexPlainText,
      }),
    );

    if (matchingSentences.length === 0) {
      return { ...change };
    }

    const candidateTerms = readUserMarkdownBoldCandidateTerms({
      emphasizedTechnologies: input.emphasizedTechnologies,
      latexPlainText,
      sentences: matchingSentences,
    });
    let latexCode = convertMarkdownStrongMarkersToLatexBold(change.latexCode);
    let appliedTermCount = 0;

    for (const candidateTerm of candidateTerms) {
      const nextLatexCode = applyLatexBoldToFirstStandaloneTerm({
        latexCode,
        term: candidateTerm,
      });

      if (nextLatexCode === latexCode) {
        continue;
      }

      latexCode = nextLatexCode;
      appliedTermCount += 1;

      if (appliedTermCount >= 2) {
        break;
      }
    }

    return {
      ...change,
      latexCode,
    };
  });
}

function learningDetailRejectsTechnologyExperience(detail: string) {
  return /\b(?:no|without)\s+(?:direct\s+)?(?:experience|exposure)|\bdo\s+not\s+add\b|\bdon't\s+add\b|\bdo\s+not\s+include\b|\bdon't\s+include\b|\bnot\s+include\b|\bunsupported\b|\bwithout\s+inventing\b/i.test(
    detail,
  );
}

export function readRequiredTailorResumeQuestioningKeywords(
  plan: Pick<
    TailoredResumePlanningResult,
    "changes" | "emphasizedTechnologies" | "questioningSummary"
  >,
): TailorResumeQuestioningKeywordRequirement[] {
  const plannedSegmentIds = new Set(plan.changes.map((change) => change.segmentId));
  const emphasizedTechnologiesByName = new Map(
    plan.emphasizedTechnologies.map((technology) => [
      normalizeTechnologyName(technology.name),
      technology.name,
    ]),
  );
  const requirementsByKeyword = new Map<
    string,
    TailorResumeQuestioningKeywordRequirement
  >();

  for (const learning of plan.questioningSummary?.learnings ?? []) {
    const detail = learning.detail.trim();

    if (!detail || learningDetailRejectsTechnologyExperience(detail)) {
      continue;
    }

    const keyword =
      emphasizedTechnologiesByName.get(normalizeTechnologyName(learning.topic)) ??
      "";

    if (!keyword) {
      continue;
    }

    const targetSegmentIds = [...new Set(learning.targetSegmentIds)].filter(
      (segmentId) => plannedSegmentIds.has(segmentId),
    );

    if (targetSegmentIds.length === 0) {
      continue;
    }

    const existingRequirement = requirementsByKeyword.get(
      normalizeTechnologyName(keyword),
    );

    requirementsByKeyword.set(normalizeTechnologyName(keyword), {
      detail: existingRequirement
        ? `${existingRequirement.detail}\n${detail}`
        : detail,
      keyword,
      targetSegmentIds: [
        ...new Set([
          ...(existingRequirement?.targetSegmentIds ?? []),
          ...targetSegmentIds,
        ]),
      ],
    });
  }

  return [...requirementsByKeyword.values()];
}

function serializeTailorResumeQuestioningKeywordRequirements(
  plan: TailoredResumePlanningResult,
) {
  const requirements = readRequiredTailorResumeQuestioningKeywords(plan);

  if (requirements.length === 0) {
    return "";
  }

  return [
    "Step 2 user-confirmed keyword requirements:",
    "The user confirmed these technologies can be used. Each keyword must appear in at least one replacement for its listed target segmentIds unless doing so would be structurally impossible; if impossible, keep the same segmentIds and make the smallest valid replacement that includes the keyword in the skills block.",
    ...requirements.map((requirement, index) =>
      [
        `${index + 1}. keyword: ${requirement.keyword}`,
        `   targetSegmentIds: ${requirement.targetSegmentIds.join(", ")}`,
        `   source learning: ${requirement.detail}`,
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

export function validateTailoredResumeImplementationIncludesQuestioningLearnings(input: {
  implementationChanges: Array<Pick<TailoredResumeImplementationChange, "latexCode" | "segmentId">>;
  plan: Pick<
    TailoredResumePlanningResult,
    "changes" | "emphasizedTechnologies" | "questioningSummary"
  >;
}) {
  const implementationChangesById = new Map(
    input.implementationChanges.map((change) => [change.segmentId, change]),
  );
  const missingRequirements = readRequiredTailorResumeQuestioningKeywords(
    input.plan,
  ).filter((requirement) => {
    const targetChanges = requirement.targetSegmentIds.flatMap((segmentId) => {
      const change = implementationChangesById.get(segmentId);
      return change ? [change] : [];
    });

    if (targetChanges.length === 0) {
      return false;
    }

    return !targetChanges.some((change) =>
      resumeTextIncludesKeyword({
        term: requirement.keyword,
        text: change.latexCode,
      }),
    );
  });

  if (missingRequirements.length === 0) {
    return;
  }

  throw new Error(
    [
      "The implementation ignored user-confirmed Step 2 technologies.",
      "Add each missing keyword to at least one replacement for its target segmentIds:",
      ...missingRequirements.map(
        (requirement) =>
          `- ${requirement.keyword} -> ${requirement.targetSegmentIds.join(", ")}`,
      ),
    ].join("\n"),
  );
}

export function validateTailoredResumePlanningKeywordCoverage(input: {
  keywordCheckResult: TailorResumeKeywordCheckResult;
}) {
  if (input.keywordCheckResult.missingHighPriority.length > 0) {
    throw new Error(
      [
        "The Step 3 plan still misses required high-priority keywords in the resulting resume text.",
        `Missing high-priority keywords: ${input.keywordCheckResult.missingHighPriority.join(", ")}`,
        "Revise the planned block edits so those keywords appear in the tailored resume when they are already supported by the original resume or USER.md.",
      ].join("\n"),
    );
  }
}

export function validateTailoredResumeImplementationKeywordCoverage(input: {
  keywordCheckResult: TailorResumeKeywordCheckResult;
}) {
  if (input.keywordCheckResult.missingHighPriority.length > 0) {
    throw new Error(
      [
        "The Step 4 implementation regressed required high-priority keywords from the accepted Step 3 plan.",
        `Missing high-priority keywords: ${input.keywordCheckResult.missingHighPriority.join(", ")}`,
        "Keep Step 4 focused on block-scoped implementation and page-count discipline, but preserve the accepted plan's important keywords.",
      ].join("\n"),
    );
  }
}

function buildUserMarkdownPlanningContext(
  userMarkdown: TailorResumeUserMarkdownState | undefined,
) {
  const markdown = userMarkdown?.markdown.trim();

  if (!markdown || markdown === "# USER.md") {
    return "";
  }

  return (
    "USER.md memory context:\n" +
    "The following is durable, user-confirmed resume context. Use it only when it directly supports a planned edit to an existing resume block, and do not treat job-description-only facts as user experience.\n" +
    `${markdown}\n\n`
  );
}

function buildQuestioningSummaryPlanningContext(
  summary: TailoredResumePlanningResult["questioningSummary"] | null | undefined,
) {
  const learnings = summary?.learnings ?? [];

  if (learnings.length === 0) {
    return "";
  }

  return (
    "Recent Step 2 user-confirmed learnings from this run:\n" +
    "Use these alongside USER.md when choosing planned block edits. If a learning includes user-confirmed bullet-shaped experience for a job-emphasized technology, strongly consider a matching experience-bullet replacement/swap rather than only a skills-section edit.\n" +
    learnings
      .map((learning, index) =>
        [
          `${index + 1}. topic: ${learning.topic}`,
          `   targetSegmentIds: ${
            learning.targetSegmentIds.length > 0
              ? learning.targetSegmentIds.join(", ")
              : "[not decided yet; choose the matching resume block]"
          }`,
          `   detail: ${learning.detail}`,
        ].join("\n"),
      )
      .join("\n\n") +
    "\n\n"
  );
}

function buildUserMarkdownImplementationContext(
  userMarkdown: TailorResumeUserMarkdownState | undefined,
) {
  const markdown = userMarkdown?.markdown.trim();

  if (!markdown || markdown === "# USER.md") {
    return "";
  }

  return (
    "USER.md memory context:\n" +
    "Follow-up questions are disabled for this run, so use this durable user-confirmed context only where it directly supports the accepted planned segment edits. Do not spread unrelated facts to unrelated blocks.\n" +
    `${markdown}\n\n`
  );
}

function buildTechnologyExtractionInput(input: {
  employerName?: string | null;
  jobDescription: string;
}) {
  const employerContext = input.employerName?.trim()
    ? `Employer name: ${input.employerName.trim()}\n\n`
    : "";

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: `${employerContext}Job description only:\n${input.jobDescription}`,
        },
      ],
    },
  ];
}

export function buildTechnologyExtractionInstructions() {
  return (
    "Extract resume-tailoring keywords from the job posting: " +
    "These scraped terms are shown to the user and drive resume edits or follow-up questions, so scraped-page junk creates bad resume edits. " +
    "Optimize for high recall for real job-fit signals and high precision against scraped-page noise. " +
    "You are extracting these terms so that we can include them in the resume and have a better chance of getting past the ATS, and get the job. These terms will primarily go in the skills section of the resume, but we may extract some small portion of terms like 'RESTful' to pepper the resume with keywords for the ATS, which maybe we don't quite want to put in the skills section. " +
    "You should distinguish between high-priority and low-priority categories in your response. High-priority keywords are the things they definitely want — required skills AND preferred skills. Low-priority keywords are things they mention off-hand as examples, or things they *may* be looking for or use on the job, but not for sure (ex. 'Looking for experience with databases, such as PostgreSQL or MySQL' — we can extract 'PostgreSQL' and 'MySQL' as low-priority keywords)" +
    
    "\nSome guidelines on extraction: " +
    "Focus only on the target job posting body, responsibilities, qualifications, and explicit tech-stack sections. Ignore navigation, footer text, browser UI, sidebar or extension UI, unrelated role listings, benefits boilerplate, and equal-opportunity boilerplate. " +
    "It's important to extract only the core resume skill — the thing a user would list under their skills section. So for example, return Kubernetes for Kubernetes-based PaaS. " +
    "Return only resume-searchable skills a realistic candidate could add to a resume Skills or Technical Skills section: concrete languages, named frameworks, named libraries, named databases, cloud platforms, named infrastructure tools, observability tools, CI/CD tools, developer tools, and named technical methods, with only some small leeway here to scrape terms like 'RESTful', but make sure ALL keywords you install you believe the ATS is tracking. " +
    "Do not return general domains, responsibilities, processes, or environment descriptions that are not concrete skills; never return Production Infrastructure or Production clusters. " +
    "Prefer named concrete tools over umbrella categories, and do not invent broad labels when the posting names specific tools. " +
    "Do not return employer-branded internal products, product suites, customer-facing product brands, team names, or nouns that describe what the company builds unless the posting explicitly asks candidates to have prior experience using that product. " +
    "Do not return feature/workflow nouns, UI labels, roadmap items, product capabilities, or generic system categories such as commit 'previews', 'blueprints', 'storage systems', 'frontend frameworks', 'platform', 'infrastructure', 'developer experience', 'production infrastructure' 'production clusters', or 'internationalization' — those would all be bad! " +
    "Do not return browser or project names such as Chromium merely because the company builds on or for them; return them only when the posting asks for candidate experience using or developing that technology. " +
    "Do not include generic practices, traits, or vague phrases such as collaboration, ownership, software engineering fundamentals, internet terminology, or fast-paced environment. " +
    "Include every named concrete technology in required/basic/minimum sections. " +
    "Include repeated or title/team-defining technical themes even when they are phrased in responsibilities rather than qualifications. " +
    "Return one atomic keyword per item, preserving the exact core skill name and capitalization where possible."
  );
}

export function buildTechnologyExtractionReasoning() {
  return { effort: "low" as const };
}

async function extractTailorResumeJobDescriptionTechnologies(input: {
  client: OpenAI;
  employerName?: string | null;
  jobDescription: string;
  model: string;
}) {
  const response = await runWithTransientModelRetries({
    operation: () =>
      input.client.responses.create({
        input: buildTechnologyExtractionInput({
          employerName: input.employerName,
          jobDescription: input.jobDescription,
        }),
        instructions: buildTechnologyExtractionInstructions(),
        model: input.model,
        reasoning: buildTechnologyExtractionReasoning(),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tailor_resume_job_technology_extraction",
            strict: true,
            schema: tailorResumeTechnologyExtractionSchema,
          },
        },
      }),
  });
  const outputText = readOutputText(response);

  if (!outputText) {
    throw new Error("The model returned an empty technology extraction.");
  }

  return parseTailorResumeTechnologyExtractionResponse(JSON.parse(outputText));
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

async function runTailorResumeStepModelRequest<T>(input: {
  attempt: number;
  onStepEvent:
    | ((event: TailorResumeGenerationStepEvent) => void | Promise<void>)
    | undefined;
  operation: () => Promise<T>;
  readDurationMs: () => number;
  stepNumber: number;
  summary: string;
}) {
  return runWithTransientModelRetries({
    operation: input.operation,
    onRetry: async (retryEvent) => {
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt: input.attempt,
        detail:
          `The model request hit a transient network error (${retryEvent.message}). ` +
          `Retrying automatically (${retryEvent.nextAttempt}/${retryEvent.maxAttempts}).`,
        durationMs: input.readDurationMs(),
        retrying: true,
        status: "failed",
        stepNumber: input.stepNumber,
        summary: input.summary,
      });
    },
  });
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
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobDescription: string;
  planningSnapshot: ReturnType<typeof buildTailorResumePlanningSnapshot>;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"] | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "Job description source for job fit and emphasizedTechnologies. " +
            "Use only this section as evidence for emphasizedTechnologies:\n" +
            input.jobDescription,
        },
        {
          type: "input_text" as const,
          text:
            "Resume context for planning edits only. Do not use this section as evidence for emphasizedTechnologies:\n" +
            `Whole resume plain text:\n${input.planningSnapshot.resumePlainText}\n\n` +
            buildQuestioningSummaryPlanningContext(input.questioningSummary) +
            buildUserMarkdownPlanningContext(input.userMarkdown) +
            "Editable resume blocks (document order):\n" +
            serializeTailorResumePlanningBlocks(input.planningSnapshot.blocks),
        },
        {
          type: "input_text" as const,
          text:
            "Step 1 pre-scanned technologies emphasized by the job description. Use this as keyword guidance when planning factually supported edits:\n" +
            serializeTailorResumeEmphasizedTechnologies(
              input.emphasizedTechnologies,
            ),
        },
      ],
    },
  ];
}

function buildImplementationRequiredTechnologies(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  plannedResumePlainText: string;
}) {
  return input.emphasizedTechnologies.filter(
    (technology) =>
      technology.priority === "high" ||
      resumeTextIncludesKeyword({
        term: technology.name,
        text: input.plannedResumePlainText,
      }),
  );
}

function userMarkdownRejectsTechnologyExperience(input: {
  technologyName: string;
  userMarkdown: string;
}) {
  const matchingSections: string[] = [];
  let currentHeadingMatchesTechnology = false;
  let currentSectionLines: string[] = [];
  const flushCurrentSection = () => {
    if (currentHeadingMatchesTechnology && currentSectionLines.length > 0) {
      matchingSections.push(currentSectionLines.join("\n"));
    }

    currentHeadingMatchesTechnology = false;
    currentSectionLines = [];
  };
  const matchingStandaloneLines = input.userMarkdown
    .split(/\n+/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const headingMatch = /^(?:#{1,6})\s+(.+)$/.exec(line);

      if (headingMatch) {
        flushCurrentSection();
        currentHeadingMatchesTechnology = resumeTextIncludesKeyword({
          term: input.technologyName,
          text: headingMatch[1] ?? "",
        });
        currentSectionLines = currentHeadingMatchesTechnology ? [line] : [];
        return [];
      }

      if (currentHeadingMatchesTechnology) {
        currentSectionLines.push(line);
      }

      return resumeTextIncludesKeyword({
        term: input.technologyName,
        text: line,
      })
        ? [line]
        : [];
    });

  flushCurrentSection();

  return [...matchingSections, ...matchingStandaloneLines].some((text) => {
    const grantsSkillsPermission =
      /\b(?:can|may|ok(?:ay)?\s+to)\s+(?:list|include)\b/i.test(text) &&
      /\bskills?\b/i.test(text);
    const rejectsExperience =
      /\b(?:no|without)\b[^.\n;]{0,120}\b(?:experience|exposure)\b/i.test(
        text,
      ) ||
      /\b(?:do\s+not|don't|does\s+not|doesn't|cannot|can't)\s+have\b[^.\n;]{0,120}\b(?:experience|exposure)\b/i.test(
        text,
      ) ||
      /\b(?:do\s+not|don't|should\s+not|shouldn't)\s+(?:invent|add|include|claim)\b/i.test(
        text,
      ) ||
      /\bunsupported\b/i.test(text);

    return rejectsExperience && !grantsSkillsPermission;
  });
}

export function filterUnsupportedEmphasizedTechnologiesForPlanning(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  resumePlainText: string;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  if (!input.userMarkdown) {
    return input.emphasizedTechnologies;
  }

  const userMarkdown = input.userMarkdown;
  const keywordPresenceContext = buildTailorResumeKeywordPresenceContext({
    emphasizedTechnologies: input.emphasizedTechnologies,
    originalResumeText: input.resumePlainText,
    userMarkdown: userMarkdown.markdown,
  });
  const supportedTechnologyNames = new Set(
    keywordPresenceContext.terms
      .filter(
        (term) =>
          term.presentInOriginalResume ||
          (term.presentInUserMarkdown &&
            !userMarkdownRejectsTechnologyExperience({
              technologyName: term.name,
              userMarkdown: userMarkdown.markdown,
            })),
      )
      .map((term) => normalizeTechnologyName(term.name)),
  );

  return input.emphasizedTechnologies.filter((technology) =>
    supportedTechnologyNames.has(normalizeTechnologyName(technology.name)),
  );
}

function buildTailoringImplementationInput(input: {
  jobDescription: string;
  planningBlocksById: Map<string, TailorResumePlanningBlock>;
  plan: TailoredResumePlanResponse;
  userMarkdown?: TailorResumeUserMarkdownState;
}) {
  const questioningLearningsText =
    input.plan.questioningSummary &&
    input.plan.questioningSummary.learnings.length > 0
      ? [
          "User-confirmed background learnings:",
          ...input.plan.questioningSummary.learnings.map((learning, index) =>
            [
              `${index + 1}. topic: ${learning.topic}`,
              `   targetSegmentIds: ${
                learning.targetSegmentIds.length > 0
                  ? learning.targetSegmentIds.join(", ")
                  : "[none]"
              }`,
              `   detail: ${learning.detail}`,
            ].join("\n"),
          ),
          "",
        ].join("\n")
      : "";

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
            "Technologies emphasized by the job description:\n" +
            serializeTailorResumeEmphasizedTechnologies(
              input.plan.emphasizedTechnologies,
            ) +
            "\n\n" +
            questioningLearningsText +
            serializeTailorResumeQuestioningKeywordRequirements(input.plan) +
            buildUserMarkdownImplementationContext(input.userMarkdown) +
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

function buildFallbackTailoredResumePlanningResult(): TailoredResumePlanningResult {
  const fallbackMetadata = normalizeTailoredResumeMetadata({});

  return {
    changes: [],
    companyName: fallbackMetadata.companyName,
    displayName: fallbackMetadata.displayName,
    emphasizedTechnologies: [],
    jobIdentifier: fallbackMetadata.jobIdentifier,
    positionTitle: fallbackMetadata.positionTitle,
    questioningSummary: null,
    thesis: {
      jobDescriptionFocus:
        "TEST_OPENAI_RESPONSE or fallback mode skipped the planning call, so no planner thesis was generated.",
      resumeChanges:
        "No intermediate plan was produced; the base resume was compiled without planned block edits.",
    },
  } satisfies TailoredResumePlanningResult;
}

export function buildPrePlanningTailoredResumePlanningResult(input: {
  companyName?: string | null;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  positionTitle?: string | null;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"];
}): TailoredResumePlanningResult {
  const companyName = input.companyName?.trim() ?? "";
  const positionTitle = input.positionTitle?.trim() ?? "";

  return {
    changes: [],
    companyName,
    displayName: buildDisplayName({ companyName, positionTitle }),
    emphasizedTechnologies: input.emphasizedTechnologies,
    jobIdentifier: "General",
    positionTitle,
    questioningSummary: input.questioningSummary ?? null,
    thesis: {
      jobDescriptionFocus:
        "Step 3 planning has not run yet; Step 2 is gathering missing resume context first.",
      resumeChanges:
        "The plaintext edit plan will be generated after Step 2 questions are skipped or completed.",
    },
  } satisfies TailoredResumePlanningResult;
}

function buildFallbackTailoredResumeOpenAiDebug() {
  return {
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
  } satisfies TailoredResumeOpenAiDebugTrace;
}

export async function extractTailorResumeEmphasizedTechnologiesForQuestioning(input: {
  employerName?: string | null;
  jobDescription: string;
  nonTechnologies?: readonly string[] | null;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
}): Promise<ExtractTailorResumeEmphasizedTechnologiesResult> {
  const startedAt = Date.now();
  const model =
    process.env.OPENAI_TAILOR_RESUME_KEYWORD_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5.5";
  const client = getOpenAIClient();
  const technologyHintTechnologies =
    extractTailorResumeJobDescriptionTechnologyHints(input.jobDescription, {
      employerName: input.employerName,
      nonTechnologies: input.nonTechnologies,
    });

  if (technologyHintTechnologies.length > 0) {
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail:
        `Identified ${technologyHintTechnologies.length} job keyword ` +
        `${technologyHintTechnologies.length === 1 ? "term" : "terms"} while preparing Step 2 questions.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: technologyHintTechnologies,
      retrying: false,
      status: "running",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
  } else {
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail: "Scanning the job description for concrete technologies before planning edits.",
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: [],
      retrying: false,
      status: "running",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
  }

  let extractedTechnologies: TailoredResumeEmphasizedTechnology[] = [];

  try {
    extractedTechnologies = await extractTailorResumeJobDescriptionTechnologies({
      client,
      employerName: input.employerName,
      jobDescription: input.jobDescription,
      model,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Model-assisted technology extraction failed.";
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: 1,
      detail:
        `${errorMessage} Falling back to deterministic keyword hints so the run can continue.`,
      durationMs: Math.max(0, Date.now() - startedAt),
      emphasizedTechnologies: technologyHintTechnologies,
      retrying: true,
      status: "failed",
      stepNumber: 1,
      summary: "Scrape keywords",
    });
    extractedTechnologies = [];
  }

  const emphasizedTechnologies = mergeTailorResumeJobDescriptionTechnologies({
    employerName: input.employerName,
    extractedTechnologies: [
      ...technologyHintTechnologies,
      ...extractedTechnologies,
    ],
    jobDescription: input.jobDescription,
    nonTechnologies: input.nonTechnologies,
    plannerTechnologies: [],
  });

  await emitTailorResumeGenerationStep(input.onStepEvent, {
    attempt: 1,
    detail:
      emphasizedTechnologies.length > 0
        ? `Prepared ${emphasizedTechnologies.length} job keyword ${emphasizedTechnologies.length === 1 ? "term" : "terms"} for Step 2 clarification and Step 3 planning.`
        : "No concrete job keyword terms were identified for Step 2 clarification.",
    durationMs: Math.max(0, Date.now() - startedAt),
    emphasizedTechnologies,
    retrying: false,
    status: "succeeded",
    stepNumber: 1,
    summary: "Scrape keywords",
  });

  return {
    emphasizedTechnologies,
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    model,
  };
}

export async function planTailoredResume(input: {
  annotatedLatexCode: string;
  employerName?: string | null;
  jobDescription: string;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  precomputedEmphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  promptSettings?: SystemPromptSettings;
  questioningSummary?: TailoredResumePlanningResult["questioningSummary"] | null;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<PlanTailoredResumeResult> {
  const startedAt = Date.now();
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const maxPlanningAttempts = Math.min(2, getRetryAttemptsToGenerateLatexEdits());
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const planningSnapshot = buildTailorResumePlanningSnapshot(
    normalizedInput.annotatedLatex,
  );
  const fallbackPlanningResult = buildFallbackTailoredResumePlanningResult();
  const client = getOpenAIClient();
  let planningFeedback = "";
  let lastError =
    `Unable to produce a tailored resume plan after ${maxPlanningAttempts} attempts.`;
  let lastModel = model;
  let lastPlanningResult = fallbackPlanningResult;
  let lastPlanningDebug: TailoredResumeOpenAiDebugStage = {
    outputJson: null,
    prompt: null,
    skippedReason:
      "Planning stage did not run because no valid planner response was produced.",
  };
  const technologyExtractionPromise = input.precomputedEmphasizedTechnologies
    ? Promise.resolve(input.precomputedEmphasizedTechnologies)
    : extractTailorResumeJobDescriptionTechnologies({
        client,
        employerName: input.employerName,
        jobDescription: input.jobDescription,
        model: process.env.OPENAI_TAILOR_RESUME_KEYWORD_MODEL ?? "gpt-5.5",
      })
        .catch(() => [] as TailoredResumeEmphasizedTechnology[])
        .then((extractedTechnologies) =>
          mergeTailorResumeJobDescriptionTechnologies({
            employerName: input.employerName,
            extractedTechnologies: [
              ...extractTailorResumeJobDescriptionTechnologyHints(
                input.jobDescription,
                {
                  employerName: input.employerName,
                  nonTechnologies: input.userMarkdown?.nonTechnologies,
                },
              ),
              ...extractedTechnologies,
            ],
            jobDescription: input.jobDescription,
            nonTechnologies: input.userMarkdown?.nonTechnologies,
            plannerTechnologies: [],
          }),
        );

  const emphasizedTechnologiesAfterNonTechnologyFilter =
    filterTailorResumeNonTechnologiesFromEmphasizedTechnologies(
      await technologyExtractionPromise,
      input.userMarkdown?.nonTechnologies,
    );
  const emphasizedTechnologiesForPlanning =
    filterUnsupportedEmphasizedTechnologiesForPlanning({
      emphasizedTechnologies: emphasizedTechnologiesAfterNonTechnologyFilter,
      resumePlainText: planningSnapshot.resumePlainText,
      userMarkdown: input.userMarkdown,
    });
  const supportedTechnologyNamesForPlanning = new Set(
    emphasizedTechnologiesForPlanning.map((technology) =>
      normalizeTechnologyName(technology.name),
    ),
  );

  for (let attempt = 1; attempt <= maxPlanningAttempts; attempt += 1) {
    const planInput = buildTailoringPlanInput({
      emphasizedTechnologies: emphasizedTechnologiesForPlanning,
      jobDescription: input.jobDescription,
      planningSnapshot,
      questioningSummary: input.questioningSummary,
      userMarkdown: input.userMarkdown,
    });
    const planInstructions = buildTailoringPlanInstructions({
      feedback: planningFeedback,
      promptSettings: input.promptSettings,
    });
    const planningPrompt = serializeTailoredResumePrompt({
      inputMessages: planInput,
      instructions: planInstructions,
    });
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail:
        attempt === 1
          ? "Starting the planning pass to decide which resume blocks should change."
          : "Retrying the planning pass after the previous attempt failed.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt > 1,
      status: "running",
      stepNumber: 3,
      summary: "Generating plaintext edit outline",
    });
    let response: TailoredResumeResponse;

    try {
      let previousResponseId: string | undefined;
      let responseInput: TailorResumeStepResponseInput = planInput;
      let finalResponse: TailoredResumeResponse | null = null;
      let keywordCheckCalled = false;

      for (
        let toolRound = 1;
        toolRound <= maxKeywordCheckToolRoundsPerAttempt;
        toolRound += 1
      ) {
        const roundResponse = (await runTailorResumeStepModelRequest({
          attempt,
          onStepEvent: input.onStepEvent,
          operation: () =>
            client.responses.create({
              input: responseInput,
              instructions: planInstructions,
              model,
              parallel_tool_calls: false,
              previous_response_id: previousResponseId,
              tools: [tailorResumePlanningKeywordCheckTool],
              text: {
                verbosity: "low",
                format: {
                  type: "json_schema",
                  name: "tailor_resume_edit_plan",
                  strict: true,
                  schema: tailorResumePlanSchema,
                },
              },
            }),
          readDurationMs: () => Math.max(0, Date.now() - startedAt),
          stepNumber: 3,
          summary: "Generating plaintext edit outline",
        })) as TailoredResumeResponse;

        previousResponseId = roundResponse.id;
        finalResponse = roundResponse;
        const keywordCheckToolCall =
          findPlanningKeywordCheckToolCall(roundResponse);

        if (!keywordCheckToolCall) {
          break;
        }

        keywordCheckCalled = true;
        const candidateChanges = parseKeywordCheckPlanningChanges(
          JSON.parse(keywordCheckToolCall.arguments),
        );
        validateTailoredResumePlanChanges({
          changes: candidateChanges.map((change) => ({
            ...change,
            reason: "[keyword check candidate]",
          })),
          planningBlocks: planningSnapshot.blocks,
        });
        const candidatePlainText = buildPlannedResumePlainText({
          changes: candidateChanges,
          planningSnapshot,
        });
        const keywordCheckResult = buildTailorResumeKeywordCheckResult({
          emphasizedTechnologies: emphasizedTechnologiesForPlanning,
          text: candidatePlainText,
        });
        responseInput = [
          {
            call_id: keywordCheckToolCall.call_id,
            output: buildKeywordCheckToolOutput(keywordCheckResult),
            type: "function_call_output" as const,
          },
        ];
      }

      if (!finalResponse) {
        throw new Error("The model did not return a planning response.");
      }

      if (!keywordCheckCalled) {
        throw new Error(
          `Call ${tailorResumePlanningKeywordCheckToolName} before returning the final Step 3 plan.`,
        );
      }

      response = finalResponse;
    } catch (error) {
      lastError = isTransientModelError(error)
        ? formatTransientModelError(error)
        : error instanceof Error
          ? error.message
          : "The planning pass failed before a valid response was produced.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating plaintext edit outline",
      });
      lastPlanningDebug = {
        outputJson: null,
        prompt: planningPrompt,
        skippedReason: null,
      };
      planningFeedback =
        `The previous planning attempt failed before producing a valid final plan.\n\nExact issue:\n${lastError}\n\nCall ${tailorResumePlanningKeywordCheckToolName} before returning the final structured response, and then return the full structured response with thesis, metadata, and plaintext block changes.`;

      if (attempt < maxPlanningAttempts) {
        continue;
      }

      break;
    }

    lastModel = response.model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty tailoring plan.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating plaintext edit outline",
      });
      planningFeedback =
        "The previous response was empty. Return the full structured response with thesis, metadata, and plaintext block changes.";
      lastPlanningDebug = {
        outputJson: null,
        prompt: planningPrompt,
        skippedReason: null,
      };
      continue;
    }

    try {
      const nextPlan = parseTailoredResumePlanResponse(JSON.parse(outputText));
      const nextPlanWithJobTechnologies: TailoredResumePlanResponse = {
        ...nextPlan,
        emphasizedTechnologies: filterUnsupportedEmphasizedTechnologiesForPlanning({
          emphasizedTechnologies: mergeTailorResumeJobDescriptionTechnologies({
            employerName: input.employerName,
            extractedTechnologies: emphasizedTechnologiesForPlanning,
            jobDescription: input.jobDescription,
            nonTechnologies: input.userMarkdown?.nonTechnologies,
            plannerTechnologies: nextPlan.emphasizedTechnologies,
          }),
          resumePlainText: planningSnapshot.resumePlainText,
          userMarkdown: input.userMarkdown,
        }),
      };
      const plannedResumePlainText = buildPlannedResumePlainText({
        changes: nextPlanWithJobTechnologies.changes,
        planningSnapshot,
      });
      const unsupportedPlannedTechnologies =
        emphasizedTechnologiesAfterNonTechnologyFilter.filter(
          (technology) =>
            !supportedTechnologyNamesForPlanning.has(
              normalizeTechnologyName(technology.name),
            ) &&
            resumeTextIncludesKeyword({
              term: technology.name,
              text: plannedResumePlainText,
            }),
        );

      if (unsupportedPlannedTechnologies.length > 0) {
        throw new Error(
          [
            "The Step 3 plan added technologies the user did not support in Step 2.",
            `Unsupported keywords in planned text: ${unsupportedPlannedTechnologies
              .map((technology) => technology.name)
              .join(", ")}`,
            "Remove those keywords from the planned resume text unless USER.md explicitly says they can be listed in skills or used as experience evidence.",
          ].join("\n"),
        );
      }
      validateTailoredResumePlanChanges({
        changes: nextPlanWithJobTechnologies.changes,
        planningBlocks: planningSnapshot.blocks,
      });
      validateTailoredResumePlanningKeywordCoverage({
        keywordCheckResult: buildTailorResumeKeywordCheckResult({
          emphasizedTechnologies: nextPlanWithJobTechnologies.emphasizedTechnologies,
          text: plannedResumePlainText,
        }),
      });
      lastPlanningResult = nextPlanWithJobTechnologies;
      lastPlanningDebug = {
        outputJson: outputText,
        prompt: planningPrompt,
        skippedReason: null,
      };
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail:
          nextPlanWithJobTechnologies.changes.length > 0
            ? `Planner identified ${nextPlanWithJobTechnologies.changes.length} block change${nextPlanWithJobTechnologies.changes.length === 1 ? "" : "s"}.`
            : "Planner found no block-level changes to apply.",
        durationMs: Math.max(0, Date.now() - startedAt),
        emphasizedTechnologies: nextPlanWithJobTechnologies.emphasizedTechnologies,
        retrying: false,
        status: "succeeded",
        stepNumber: 3,
        summary: "Generating plaintext edit outline",
      });

      return {
        attempts: attempt,
        generationDurationMs: Math.max(0, Date.now() - startedAt),
        model: lastModel,
        ok: true,
        planningDebug: lastPlanningDebug,
        planningResult: nextPlanWithJobTechnologies,
        planningSnapshot,
        thesis: nextPlanWithJobTechnologies.thesis,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable tailoring plan.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxPlanningAttempts,
        status: "failed",
        stepNumber: 3,
        summary: "Generating plaintext edit outline",
      });
      planningFeedback =
        `The previous response could not be parsed or validated.\n\nExact issue:\n${lastError}\n\nReturn the full structured response with thesis, metadata, and plaintext block changes.`;
      lastPlanningDebug = {
        outputJson: outputText,
        prompt: planningPrompt,
        skippedReason: null,
      };
    }
  }

  return {
    attempts: maxPlanningAttempts,
    generationDurationMs: Math.max(0, Date.now() - startedAt),
    model: lastModel,
    ok: false,
    planningDebug: lastPlanningDebug,
    planningResult: lastPlanningResult,
    planningSnapshot,
    thesis: lastPlanningResult.thesis,
    validationError: lastError,
  };
}

export async function implementTailoredResumePlan(input: {
  annotatedLatexCode: string;
  generationDurationMsBase?: number;
  jobDescription: string;
  linkOverrides?: TailorResumeLinkRecord[];
  model?: string;
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  planningDebug: TailoredResumeOpenAiDebugStage;
  planningResult: TailoredResumePlanningResult;
  planningSnapshot?: TailorResumePlanningSnapshot;
  promptSettings?: SystemPromptSettings;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const model = input.model ?? process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const planningSnapshot =
    input.planningSnapshot ??
    buildTailorResumePlanningSnapshot(normalizedInput.annotatedLatex);
  const plannedResumePlainText = buildPlannedResumePlainText({
    changes: input.planningResult.changes,
    planningSnapshot,
  });
  const implementationRequiredTechnologies = buildImplementationRequiredTechnologies({
    emphasizedTechnologies: input.planningResult.emphasizedTechnologies,
    plannedResumePlainText,
  });
  const planningBlocksById = new Map(
    planningSnapshot.blocks.map((block) => [block.segmentId, block]),
  );
  const readGenerationDurationMs = () =>
    (input.generationDurationMsBase ?? 0) + Math.max(0, Date.now() - startedAt);
  const fallbackMetadata = normalizeTailoredResumeMetadata(input.planningResult);
  let lastError: string | null = null;
  let lastAnnotatedLatex = normalizedInput.annotatedLatex;
  let lastEdits: TailoredResumeBlockEditRecord[] = [];
  let lastSavedLinkUpdateCount = 0;
  let lastSavedLinkUpdates: TailorResumeSavedLinkUpdate[] = [];
  let lastModel = model;
  let hasAppliedCandidate = false;
  let completedImplementationAttempts = 0;
  let implementationPrompt: string | null = null;
  let implementationOutputJson: string | null = null;
  let implementationSkippedReason: string | null =
    "Implementation stage has not run yet.";

  if (input.planningResult.changes.length === 0) {
    implementationSkippedReason =
      "Implementation stage was skipped because the planner returned no segment changes.";
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt: null,
      detail: "The accepted plan did not require any block-scoped LaTeX replacements.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: false,
      status: "skipped",
      stepNumber: 4,
      summary: "Planner found no block-scoped edits to apply",
    });
    const openAiDebug: TailoredResumeOpenAiDebugTrace = {
      implementation: {
        outputJson: null,
        prompt: null,
        skippedReason: implementationSkippedReason,
      },
      planning: input.planningDebug,
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
        attempts: 1,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: [],
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: input.planningResult.thesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      1,
    );

    return {
      annotatedLatexCode: lastAnnotatedLatex,
      attempts: 1,
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      edits: [],
      generationDurationMs: readGenerationDurationMs(),
      jobIdentifier: fallbackMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
      model: lastModel,
      openAiDebug,
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate,
        hasPreviewPdf: false,
      }),
      planningResult: input.planningResult,
      positionTitle: fallbackMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: lastSavedLinkUpdateCount,
      savedLinkUpdates: lastSavedLinkUpdates,
      thesis: input.planningResult.thesis,
      validationError: lastError,
    };
  }

  const client = getOpenAIClient();
  let implementationFeedback = "";
  const maxTailoredResumeAttempts = getRetryAttemptsToGenerateLatexEdits();

  for (let attempt = 1; attempt <= maxTailoredResumeAttempts; attempt += 1) {
    const implementationInput = buildTailoringImplementationInput({
      jobDescription: input.jobDescription,
      plan: input.planningResult,
      planningBlocksById,
      userMarkdown: input.userMarkdown,
    });
    const implementationInstructions = buildTailoringImplementationInstructions({
      feedback: implementationFeedback,
      promptSettings: input.promptSettings,
    });
    implementationPrompt = serializeTailoredResumePrompt({
      inputMessages: implementationInput,
      instructions: implementationInstructions,
    });
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail:
        attempt === 1
          ? "Starting block-scoped LaTeX generation from the accepted plan."
          : "Retrying block-scoped LaTeX generation after the previous attempt failed.",
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt > 1,
      status: "running",
      stepNumber: 4,
      summary: "Generating block-scoped edits",
    });
    let response: TailoredResumeResponse;

    try {
      let previousResponseId: string | undefined;
      let responseInput: TailorResumeStepResponseInput = implementationInput;
      let finalResponse: TailoredResumeResponse | null = null;
      let keywordCheckCalled = false;

      for (
        let toolRound = 1;
        toolRound <= maxKeywordCheckToolRoundsPerAttempt;
        toolRound += 1
      ) {
        const roundResponse = (await runTailorResumeStepModelRequest({
          attempt,
          onStepEvent: input.onStepEvent,
          operation: () =>
            client.responses.create({
              input: responseInput,
              instructions: implementationInstructions,
              model,
              parallel_tool_calls: false,
              previous_response_id: previousResponseId,
              tools: [tailorResumeImplementationKeywordCheckTool],
              text: {
                verbosity: "low",
                format: {
                  type: "json_schema",
                  name: "tailor_resume_latex_implementation",
                  strict: true,
                  schema: tailorResumeImplementationSchema,
                },
              },
            }),
          readDurationMs: () => Math.max(0, Date.now() - startedAt),
          stepNumber: 4,
          summary: "Generating block-scoped edits",
        })) as TailoredResumeResponse;

        previousResponseId = roundResponse.id;
        finalResponse = roundResponse;
        const keywordCheckToolCall =
          findImplementationKeywordCheckToolCall(roundResponse);

        if (!keywordCheckToolCall) {
          break;
        }

        keywordCheckCalled = true;
        const candidateChanges = parseKeywordCheckImplementationChanges(
          JSON.parse(keywordCheckToolCall.arguments),
        );
        const candidateBlockChanges = buildTailoredResumeBlockChanges({
          implementationChanges: candidateChanges.map((change) => ({
            latexCode: change.latexCode,
            segmentId: change.segmentId,
          })),
          plannedChanges: input.planningResult.changes,
        });
        const candidateAnnotatedLatex = applyTailorResumeBlockChanges({
          annotatedLatexCode: normalizedInput.annotatedLatex,
          changes: candidateBlockChanges,
        }).annotatedLatex;
        const keywordCheckResult = buildTailorResumeKeywordCheckResult({
          emphasizedTechnologies: implementationRequiredTechnologies,
          text: renderTailoredResumeLatexToPlainText(candidateAnnotatedLatex),
        });
        responseInput = [
          {
            call_id: keywordCheckToolCall.call_id,
            output: buildKeywordCheckToolOutput(keywordCheckResult),
            type: "function_call_output" as const,
          },
        ];
      }

      if (!finalResponse) {
        throw new Error("The model did not return an implementation response.");
      }

      if (!keywordCheckCalled) {
        throw new Error(
          `Call ${tailorResumeImplementationKeywordCheckToolName} before returning the final Step 4 JSON implementation.`,
        );
      }

      response = finalResponse;
    } catch (error) {
      completedImplementationAttempts = attempt;
      lastError = isTransientModelError(error)
        ? formatTransientModelError(error)
        : error instanceof Error
          ? error.message
          : "The implementation pass failed before a valid response was produced.";
      implementationSkippedReason = null;
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous implementation attempt failed before producing a valid final block-scoped response.\n\nExact issue:\n${lastError}\n\nCall ${tailorResumeImplementationKeywordCheckToolName} before returning the final strict JSON object with one LaTeX replacement per planned segment.`;

      if (attempt < maxTailoredResumeAttempts) {
        continue;
      }

      break;
    }

    completedImplementationAttempts = attempt;
    lastModel = response.model ?? model;
    const outputText = readOutputText(response);

    if (!outputText) {
      lastError = "The model returned an empty LaTeX implementation.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        "The previous response was empty. Return the strict JSON object with one LaTeX replacement per planned segment.";
      continue;
    }

    let implementation: TailoredResumeImplementationResponse;

    try {
      implementation = parseTailoredResumeImplementationResponse(
        JSON.parse(outputText),
      );
      implementation = {
        changes: applyTailorResumeUserMarkdownBoldFormatting({
          emphasizedTechnologies: implementationRequiredTechnologies,
          implementationChanges: implementation.changes,
          userMarkdown: input.userMarkdown,
        }),
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "The model returned an unreadable LaTeX implementation.";
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous implementation response could not be parsed.\n\nExact issue:\n${lastError}\n\nReturn the strict JSON object with one LaTeX replacement per planned segment.`;
      continue;
    }

    implementationOutputJson = outputText;
    const openAiDebug: TailoredResumeOpenAiDebugTrace = {
      implementation: {
        outputJson: implementationOutputJson,
        prompt: implementationPrompt,
        skippedReason: null,
      },
      planning: input.planningDebug,
    };
    const candidateForLogging: TailoredResumeStructuredResponse = {
      changes: implementation.changes.map((change) => ({
        latexCode: change.latexCode,
        reason:
          input.planningResult.changes.find(
            (plannedChange) => plannedChange.segmentId === change.segmentId,
          )?.reason ?? "[missing reason]",
        segmentId: change.segmentId,
      })),
      companyName: fallbackMetadata.companyName,
      displayName: fallbackMetadata.displayName,
      jobIdentifier: fallbackMetadata.jobIdentifier,
      positionTitle: fallbackMetadata.positionTitle,
      thesis: input.planningResult.thesis,
    };

    let candidateChanges: TailoredResumeBlockChange[];
    let candidateEdits: TailoredResumeBlockEditRecord[];
    let appliedCandidate;

    try {
      candidateChanges = buildTailoredResumeBlockChanges({
        implementationChanges: implementation.changes,
        plannedChanges: input.planningResult.changes,
      });
      validateTailoredResumeImplementationIncludesQuestioningLearnings({
        implementationChanges: candidateChanges,
        plan: input.planningResult,
      });
      appliedCandidate = applyTailorResumeBlockChanges({
        annotatedLatexCode: normalizedInput.annotatedLatex,
        changes: candidateChanges,
      });
      validateTailoredResumeImplementationKeywordCoverage({
        keywordCheckResult: buildTailorResumeKeywordCheckResult({
          emphasizedTechnologies: implementationRequiredTechnologies,
          text: renderTailoredResumeLatexToPlainText(appliedCandidate.annotatedLatex),
        }),
      });
      candidateEdits = buildTailoredResumeBlockEdits({
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
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: lastError,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: attempt < maxTailoredResumeAttempts,
        status: "failed",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      implementationFeedback =
        `The previous LaTeX implementation did not satisfy the block replacement requirements.\n\nExact issue:\n${lastError}\n\nReturn a corrected strict JSON object with one LaTeX replacement per planned segment.`;
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
      await emitTailorResumeGenerationStep(input.onStepEvent, {
        attempt,
        detail: `Generated ${candidateEdits.length} block edit${candidateEdits.length === 1 ? "" : "s"}.`,
        durationMs: Math.max(0, Date.now() - startedAt),
        retrying: false,
        status: "succeeded",
        stepNumber: 4,
        summary: "Generating block-scoped edits",
      });
      return {
        annotatedLatexCode: normalizedCandidate.normalizedLatex.annotatedLatex,
        attempts: attempt,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: candidateEdits,
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(
          normalizedCandidate.normalizedLatex.annotatedLatex,
        ),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate: true,
          hasPreviewPdf: true,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: validation.previewPdf,
        savedLinkUpdateCount: normalizedCandidate.updatedCount,
        savedLinkUpdates: normalizedCandidate.updatedLinks,
        thesis: input.planningResult.thesis,
        validationError: null,
      };
    }

    lastError = validation.error;

    await input.onBuildFailure?.(
      stripTailorResumeSegmentIds(normalizedCandidate.normalizedLatex.annotatedLatex),
      validation.error,
      attempt,
    );
    await emitTailorResumeGenerationStep(input.onStepEvent, {
      attempt,
      detail: validation.error,
      durationMs: Math.max(0, Date.now() - startedAt),
      retrying: attempt < maxTailoredResumeAttempts,
      status: "failed",
      stepNumber: 4,
      summary: "Generating block-scoped edits",
    });

    implementationFeedback =
      `Applying your previous LaTeX implementations produced a compile failure.\n\n` +
      `Compiler error:\n${validation.error}\n\n` +
      "Return corrected LaTeX replacements for the same planned segments only.";

    if (attempt === maxTailoredResumeAttempts) {
      return {
        annotatedLatexCode: lastAnnotatedLatex,
        attempts: completedImplementationAttempts,
        companyName: fallbackMetadata.companyName,
        displayName: fallbackMetadata.displayName,
        edits: lastEdits,
        generationDurationMs: readGenerationDurationMs(),
        jobIdentifier: fallbackMetadata.jobIdentifier,
        latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
        model: lastModel,
        openAiDebug,
        outcome: classifyTailoredResumeGenerationOutcome({
          hasAppliedCandidate,
          hasPreviewPdf: false,
        }),
        planningResult: input.planningResult,
        positionTitle: fallbackMetadata.positionTitle,
        previewPdf: null,
        savedLinkUpdateCount: lastSavedLinkUpdateCount,
        savedLinkUpdates: lastSavedLinkUpdates,
        thesis: input.planningResult.thesis,
        validationError:
          lastError ??
          `Unable to implement a tailored resume after ${completedImplementationAttempts} attempts.`,
      };
    }
  }

  const openAiDebug: TailoredResumeOpenAiDebugTrace = {
    implementation: {
      outputJson: implementationOutputJson,
      prompt: implementationPrompt,
      skippedReason: implementationSkippedReason,
    },
    planning: input.planningDebug,
  };

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: completedImplementationAttempts || maxTailoredResumeAttempts,
    companyName: fallbackMetadata.companyName,
    displayName: fallbackMetadata.displayName,
    edits: lastEdits,
    generationDurationMs: readGenerationDurationMs(),
    jobIdentifier: fallbackMetadata.jobIdentifier,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model: lastModel,
    openAiDebug,
    outcome: classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate,
      hasPreviewPdf: false,
    }),
    planningResult: input.planningResult,
    positionTitle: fallbackMetadata.positionTitle,
    previewPdf: null,
    savedLinkUpdateCount: lastSavedLinkUpdateCount,
    savedLinkUpdates: lastSavedLinkUpdates,
    thesis: input.planningResult.thesis,
    validationError:
      lastError ??
      `Unable to implement a tailored resume after ${completedImplementationAttempts || maxTailoredResumeAttempts} attempts.`,
  };
}

export async function generateTailoredResume(input: {
  annotatedLatexCode: string;
  companyName?: string | null;
  jobDescription: string;
  linkOverrides?: TailorResumeLinkRecord[];
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  onInvalidReplacement?: (
    payload: string,
    error: string,
    attempt: number,
  ) => Promise<void>;
  onStepEvent?: (
    event: TailorResumeGenerationStepEvent,
  ) => void | Promise<void>;
  promptSettings?: SystemPromptSettings;
  userMarkdown?: TailorResumeUserMarkdownState;
}): Promise<GenerateTailoredResumeResult> {
  const startedAt = Date.now();
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const linkOverrides = input.linkOverrides ?? [];
  const fallbackMetadata = normalizeTailoredResumeMetadata({});
  const fallbackPlanningResult = buildFallbackTailoredResumePlanningResult();
  const fallbackOpenAiDebug = buildFallbackTailoredResumeOpenAiDebug();
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

  const keywordStage = await extractTailorResumeEmphasizedTechnologiesForQuestioning({
    employerName: input.companyName,
    jobDescription: input.jobDescription,
    nonTechnologies: input.userMarkdown?.nonTechnologies,
    onStepEvent: input.onStepEvent,
  });
  const planningStage = await planTailoredResume({
    annotatedLatexCode: input.annotatedLatexCode,
    employerName: input.companyName,
    jobDescription: input.jobDescription,
    onStepEvent: input.onStepEvent,
    precomputedEmphasizedTechnologies: keywordStage.emphasizedTechnologies,
    promptSettings: input.promptSettings,
    userMarkdown: input.userMarkdown,
  });

  if (!planningStage.ok) {
    const lastMetadata = normalizeTailoredResumeMetadata(
      planningStage.planningResult,
    );

    return {
      annotatedLatexCode: normalizedInput.annotatedLatex,
      attempts: planningStage.attempts,
      companyName: lastMetadata.companyName,
      displayName: lastMetadata.displayName,
      edits: [],
      generationDurationMs:
        keywordStage.generationDurationMs + planningStage.generationDurationMs,
      jobIdentifier: lastMetadata.jobIdentifier,
      latexCode: stripTailorResumeSegmentIds(normalizedInput.annotatedLatex),
      model: planningStage.model,
      openAiDebug: {
        implementation: fallbackOpenAiDebug.implementation,
        planning: planningStage.planningDebug,
      },
      outcome: classifyTailoredResumeGenerationOutcome({
        hasAppliedCandidate: false,
        hasPreviewPdf: false,
      }),
      planningResult: planningStage.planningResult,
      positionTitle: lastMetadata.positionTitle,
      previewPdf: null,
      savedLinkUpdateCount: 0,
      savedLinkUpdates: [],
      thesis: planningStage.thesis,
      validationError: planningStage.validationError,
    };
  }

  return implementTailoredResumePlan({
    annotatedLatexCode: input.annotatedLatexCode,
    generationDurationMsBase:
      keywordStage.generationDurationMs + planningStage.generationDurationMs,
    jobDescription: input.jobDescription,
    linkOverrides,
    model: planningStage.model,
    onBuildFailure: input.onBuildFailure,
    onInvalidReplacement: input.onInvalidReplacement,
    onStepEvent: input.onStepEvent,
    planningDebug: planningStage.planningDebug,
    planningResult: planningStage.planningResult,
    planningSnapshot: planningStage.planningSnapshot,
    promptSettings: input.promptSettings,
    userMarkdown: input.userMarkdown,
  });
}
