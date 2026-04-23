import OpenAI from "openai";
import {
  buildJobApplicationExtractionSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "@/lib/system-prompt-settings";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  FieldConfidence,
  JobApplicationDraft,
  JobLocationType,
  JobApplicationExtraction,
} from "@/lib/job-application-types";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobTitle: { type: ["string", "null"] },
    companyName: { type: ["string", "null"] },
    appliedAt: {
      type: ["string", "null"],
      description:
        "Calendar date in YYYY-MM-DD format when the screenshot clearly shows an applied date. Use null when no date is visible.",
    },
    jobDescription: {
      type: ["string", "null"],
      description:
        "Optional long-form job description or role summary visible in the screenshot. Use null when it is not present.",
    },
    jobUrl: {
      type: ["string", "null"],
      description:
        "Visible job posting URL or application URL. Use null when not visible.",
    },
    location: {
      type: ["string", "null"],
      enum: ["remote", "onsite", "hybrid", null],
      description:
        "Work arrangement shown in the screenshot. Use remote, onsite, or hybrid when explicitly visible, otherwise null.",
    },
    salaryRange: {
      type: ["string", "null"],
      description:
        "Visible salary or compensation range text. Use null when not visible.",
    },
    employmentType: {
      type: ["string", "null"],
      enum: ["full_time", "part_time", "contract", "internship", null],
      description:
        "Employment type if clearly visible. Use full_time, part_time, contract, or internship, otherwise null.",
    },
    teamOrDepartment: {
      type: ["string", "null"],
      description:
        "Visible team name or department. Use null when not visible.",
    },
    recruiterContact: {
      type: ["string", "null"],
      description:
        "Visible recruiter or contact name or email. Use null when not visible.",
    },
    status: {
      type: ["string", "null"],
      enum: ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", null],
      description:
        "Application status when clearly visible in the screenshot, otherwise null.",
    },
    notes: {
      type: ["string", "null"],
      description:
        "Optional extra visible notes worth preserving that do not fit the other fields. Use null when not present.",
    },
    referrerName: {
      type: ["string", "null"],
      description:
        "Name of the person explicitly shown as the referrer. Use null when no referrer person is visible.",
    },
    onsiteDaysPerWeek: {
      type: ["integer", "null"],
      description:
        "Optional number of days per week required onsite when the screenshot clearly states it. Use null when not visible.",
      minimum: 1,
      maximum: 7,
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobTitle: { type: "number" },
        companyName: { type: "number" },
        appliedAt: { type: "number" },
        jobDescription: { type: "number" },
        jobUrl: { type: "number" },
        location: { type: "number" },
        notes: { type: "number" },
        onsiteDaysPerWeek: { type: "number" },
        referrerName: { type: "number" },
        recruiterContact: { type: "number" },
        salaryRange: { type: "number" },
        status: { type: "number" },
        teamOrDepartment: { type: "number" },
        employmentType: { type: "number" },
      },
      required: [
        "jobTitle",
        "companyName",
        "appliedAt",
        "jobDescription",
        "jobUrl",
        "location",
        "notes",
        "onsiteDaysPerWeek",
        "referrerName",
        "recruiterContact",
        "salaryRange",
        "status",
        "teamOrDepartment",
        "employmentType",
      ],
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobTitle: { type: ["string", "null"] },
        companyName: { type: ["string", "null"] },
        appliedAt: { type: ["string", "null"] },
        jobDescription: { type: ["string", "null"] },
        jobUrl: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
        onsiteDaysPerWeek: { type: ["string", "null"] },
        referrerName: { type: ["string", "null"] },
        recruiterContact: { type: ["string", "null"] },
        salaryRange: { type: ["string", "null"] },
        status: { type: ["string", "null"] },
        teamOrDepartment: { type: ["string", "null"] },
        employmentType: { type: ["string", "null"] },
      },
      required: [
        "jobTitle",
        "companyName",
        "appliedAt",
        "jobDescription",
        "jobUrl",
        "location",
        "notes",
        "onsiteDaysPerWeek",
        "referrerName",
        "recruiterContact",
        "salaryRange",
        "status",
        "teamOrDepartment",
        "employmentType",
      ],
    },
  },
  required: [
    "jobTitle",
    "companyName",
    "appliedAt",
    "jobDescription",
    "jobUrl",
    "location",
    "notes",
    "onsiteDaysPerWeek",
    "referrerName",
    "recruiterContact",
    "salaryRange",
    "status",
    "teamOrDepartment",
    "employmentType",
    "confidence",
    "evidence",
  ],
} as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringOrNull(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value === null) {
    return null;
  }

  throw new Error("Expected a string or null in the extraction payload.");
}

function readConfidence(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Expected a confidence object in the extraction payload.");
  }

  const fields = [
    "jobTitle",
    "companyName",
    "appliedAt",
    "jobDescription",
    "jobUrl",
    "location",
    "notes",
    "onsiteDaysPerWeek",
    "referrerName",
    "recruiterContact",
    "salaryRange",
    "status",
    "teamOrDepartment",
    "employmentType",
  ] as const;

  return Object.fromEntries(
    fields.map((field) => {
      const rawValue = value[field];

      if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        throw new Error(`Expected a numeric confidence score for ${field}.`);
      }

      return [field, Math.max(0, Math.min(1, rawValue))];
    }),
  ) as FieldConfidence;
}

function readEvidence(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Expected an evidence object in the extraction payload.");
  }

  return {
    jobTitle: readStringOrNull(value.jobTitle),
    companyName: readStringOrNull(value.companyName),
    appliedAt: readStringOrNull(value.appliedAt),
    jobDescription: readStringOrNull(value.jobDescription),
    jobUrl: readStringOrNull(value.jobUrl),
    location: readStringOrNull(value.location),
    notes: readStringOrNull(value.notes),
    onsiteDaysPerWeek: readStringOrNull(value.onsiteDaysPerWeek),
    referrerName: readStringOrNull(value.referrerName),
    recruiterContact: readStringOrNull(value.recruiterContact),
    salaryRange: readStringOrNull(value.salaryRange),
    status: readStringOrNull(value.status),
    teamOrDepartment: readStringOrNull(value.teamOrDepartment),
    employmentType: readStringOrNull(value.employmentType),
  };
}

function readLocationType(value: unknown): JobLocationType | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Expected location to be remote, onsite, hybrid, or null.");
  }

  const normalizedValue = value.trim().toLowerCase();

  if (
    normalizedValue === "remote" ||
    normalizedValue === "onsite" ||
    normalizedValue === "hybrid"
  ) {
    return normalizedValue;
  }

  if (
    normalizedValue.includes("remote") ||
    normalizedValue.includes("work from home")
  ) {
    return "remote";
  }

  if (normalizedValue.includes("hybrid")) {
    return "hybrid";
  }

  if (
    normalizedValue.includes("onsite") ||
    normalizedValue.includes("on-site") ||
    normalizedValue.includes("in office") ||
    normalizedValue.includes("in-office")
  ) {
    return "onsite";
  }

  return null;
}

function readOnsiteDaysPerWeek(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Expected onsiteDaysPerWeek to be an integer or null.");
  }

  if (value < 1 || value > 7) {
    throw new Error("Expected onsiteDaysPerWeek to be between 1 and 7.");
  }

  return value;
}

function readStatus(value: unknown): ApplicationStatusValue | null {
  if (value === null) {
    return null;
  }

  if (
    value === "SAVED" ||
    value === "APPLIED" ||
    value === "INTERVIEW" ||
    value === "OFFER" ||
    value === "REJECTED" ||
    value === "WITHDRAWN"
  ) {
    return value;
  }

  throw new Error("Expected a valid application status or null.");
}

function readEmploymentType(value: unknown): EmploymentTypeValue | null {
  if (value === null) {
    return null;
  }

  if (
    value === "full_time" ||
    value === "part_time" ||
    value === "contract" ||
    value === "internship"
  ) {
    return value;
  }

  throw new Error("Expected a valid employment type or null.");
}

function parseExtractionPayload(value: unknown): JobApplicationExtraction {
  if (!isRecord(value)) {
    throw new Error("The model did not return a valid structured extraction payload.");
  }

  const appliedAt = readStringOrNull(value.appliedAt);
  const location = readLocationType(value.location);
  const onsiteDaysPerWeek = readOnsiteDaysPerWeek(value.onsiteDaysPerWeek);

  if (appliedAt && !/^\d{4}-\d{2}-\d{2}$/.test(appliedAt)) {
    throw new Error("The model returned an invalid applied date.");
  }

  return {
    appliedAt,
    companyName: readStringOrNull(value.companyName),
    confidence: readConfidence(value.confidence),
    evidence: readEvidence(value.evidence),
    jobDescription: readStringOrNull(value.jobDescription),
    jobTitle: readStringOrNull(value.jobTitle),
    jobUrl: readStringOrNull(value.jobUrl),
    location,
    notes: readStringOrNull(value.notes),
    onsiteDaysPerWeek:
      location === "onsite" || location === "hybrid" ? onsiteDaysPerWeek : null,
    referrerName: readStringOrNull(value.referrerName),
    recruiterContact: readStringOrNull(value.recruiterContact),
    salaryRange: readStringOrNull(value.salaryRange),
    status: readStatus(value.status),
    teamOrDepartment: readStringOrNull(value.teamOrDepartment),
    employmentType: readEmploymentType(value.employmentType),
  };
}

function buildSampleExtraction(): JobApplicationExtraction {
  return parseExtractionPayload({
    appliedAt: "2025-01-15",
    companyName: "OpenAI",
    confidence: {
      jobTitle: 0.99,
      companyName: 0.99,
      appliedAt: 0.99,
      jobDescription: 0.99,
      jobUrl: 0.88,
      location: 0.76,
      notes: 0.41,
      onsiteDaysPerWeek: 0.12,
      referrerName: 0.08,
      recruiterContact: 0.16,
      salaryRange: 0.81,
      status: 0.93,
      teamOrDepartment: 0.62,
      employmentType: 0.89,
    },
    evidence: {
      jobTitle: "Senior Software Engineer",
      companyName: "OpenAI",
      appliedAt: "Applied on Jan 15, 2025",
      jobDescription:
        "Build backend and AI-powered product features for internal tools.",
      jobUrl: "careers.openai.com/jobs/senior-software-engineer",
      location: "Hybrid",
      notes: null,
      onsiteDaysPerWeek: null,
      referrerName: null,
      recruiterContact: null,
      salaryRange: "$120k - $150k",
      status: "Applied",
      teamOrDepartment: "Platform Engineering",
      employmentType: "Full-time",
    },
    jobDescription:
      "Build backend and AI-powered product features for internal tools.",
    jobTitle: "Senior Software Engineer",
    jobUrl: "https://careers.openai.com/jobs/senior-software-engineer",
    location: "hybrid",
    notes: null,
    onsiteDaysPerWeek: null,
    referrerName: null,
    recruiterContact: null,
    salaryRange: "$120k - $150k",
    status: "APPLIED",
    teamOrDepartment: "Platform Engineering",
    employmentType: "full_time",
  });
}

function readOutputText(response: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
}) {
  if (response.output_text) {
    return response.output_text;
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

function buildExistingDraftContext(existingDraft?: JobApplicationDraft | null) {
  if (!existingDraft) {
    return null;
  }

  const populatedEntries = Object.entries(existingDraft).filter(
    ([field, value]) =>
      field !== "referrerId" &&
      typeof value === "string" &&
      value.trim().length > 0,
  );

  if (populatedEntries.length === 0) {
    return null;
  }

  return JSON.stringify(Object.fromEntries(populatedEntries), null, 2);
}

export async function extractJobApplicationFromScreenshot(input: {
  dataUrl: string;
  existingDraft?: JobApplicationDraft | null;
  filename: string;
  mimeType: string;
  promptSettings?: SystemPromptSettings;
}) {
  const model = process.env.OPENAI_JOB_EXTRACTION_MODEL ?? "gpt-5-mini";

  if (isTestOpenAIResponseEnabled()) {
    const extraction = buildSampleExtraction();

    return {
      extraction,
      model: TEST_OPENAI_RESPONSE_MODEL,
      rawText: JSON.stringify(extraction),
    };
  }

  const existingDraftContext = buildExistingDraftContext(input.existingDraft);
  const client = getOpenAIClient();
  const response = await client.responses.create({
    model,
    instructions: buildJobApplicationExtractionSystemPrompt(
      input.promptSettings ?? createDefaultSystemPromptSettings(),
    ),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the job title, company name, job URL, applied date, location, salary range, employment type, team or department, recruiter or contact, referrer name, onsite days per week, status, notes, and job description from this job-posting screenshot.",
          },
          ...(existingDraftContext
            ? [
                {
                  type: "input_text" as const,
                  text:
                    `Existing draft context from earlier screenshots or user edits:\n${existingDraftContext}\n\nMerge the new evidence into that draft. Preserve earlier details that are still consistent, fill in anything newly visible, and rewrite the full jobDescription when the new evidence extends or clarifies it.`,
                },
              ]
            : []),
          {
            type: "input_text",
            text: `Screenshot evidence: ${input.filename} (${input.mimeType}).`,
          },
          {
            type: "input_image",
            image_url: input.dataUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "job_application_extraction",
        strict: true,
        schema: extractionSchema,
      },
    },
  });

  const outputText = readOutputText(response);

  if (!outputText) {
    throw new Error("The model returned an empty extraction response.");
  }

  return {
    extraction: parseExtractionPayload(JSON.parse(outputText)),
    model: (response as { model?: string }).model ?? model,
    rawText: outputText,
  };
}
