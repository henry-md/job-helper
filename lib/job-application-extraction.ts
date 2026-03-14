import OpenAI from "openai";

type FieldConfidence = {
  appliedAt: number;
  companyName: number;
  hasReferral: number;
  jobDescription: number;
  jobTitle: number;
};

type FieldEvidence = {
  appliedAt: string | null;
  companyName: string | null;
  hasReferral: string | null;
  jobDescription: string | null;
  jobTitle: string | null;
};

export type JobApplicationExtraction = {
  appliedAt: string | null;
  companyName: string | null;
  confidence: FieldConfidence;
  evidence: FieldEvidence;
  hasReferral: boolean;
  jobDescription: string | null;
  jobTitle: string | null;
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobTitle: { type: ["string", "null"] },
    companyName: { type: ["string", "null"] },
    hasReferral: { type: "boolean" },
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
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobTitle: { type: "number" },
        companyName: { type: "number" },
        hasReferral: { type: "number" },
        appliedAt: { type: "number" },
        jobDescription: { type: "number" },
      },
      required: [
        "jobTitle",
        "companyName",
        "hasReferral",
        "appliedAt",
        "jobDescription",
      ],
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobTitle: { type: ["string", "null"] },
        companyName: { type: ["string", "null"] },
        hasReferral: { type: ["string", "null"] },
        appliedAt: { type: ["string", "null"] },
        jobDescription: { type: ["string", "null"] },
      },
      required: [
        "jobTitle",
        "companyName",
        "hasReferral",
        "appliedAt",
        "jobDescription",
      ],
    },
  },
  required: [
    "jobTitle",
    "companyName",
    "hasReferral",
    "appliedAt",
    "jobDescription",
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

function readBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Expected a boolean for ${field}.`);
  }

  return value;
}

function readConfidence(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Expected a confidence object in the extraction payload.");
  }

  const fields = [
    "jobTitle",
    "companyName",
    "hasReferral",
    "appliedAt",
    "jobDescription",
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
    hasReferral: readStringOrNull(value.hasReferral),
    appliedAt: readStringOrNull(value.appliedAt),
    jobDescription: readStringOrNull(value.jobDescription),
  };
}

function parseExtractionPayload(value: unknown): JobApplicationExtraction {
  if (!isRecord(value)) {
    throw new Error("The model did not return a valid structured extraction payload.");
  }

  const appliedAt = readStringOrNull(value.appliedAt);

  if (appliedAt && !/^\d{4}-\d{2}-\d{2}$/.test(appliedAt)) {
    throw new Error("The model returned an invalid applied date.");
  }

  return {
    appliedAt,
    companyName: readStringOrNull(value.companyName),
    confidence: readConfidence(value.confidence),
    evidence: readEvidence(value.evidence),
    hasReferral: readBoolean(value.hasReferral, "hasReferral"),
    jobDescription: readStringOrNull(value.jobDescription),
    jobTitle: readStringOrNull(value.jobTitle),
  };
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

export async function extractJobApplicationFromScreenshot(input: {
  dataUrl: string;
  filename: string;
  mimeType: string;
}) {
  const model = process.env.OPENAI_JOB_EXTRACTION_MODEL ?? "gpt-5-mini";
  const client = getOpenAIClient();

  const response = await client.responses.create({
    model,
    instructions:
      "Extract job application details from a screenshot. Never invent values that are not visible. Return null for missing title, company, date, or job description. Only mark hasReferral true when the screenshot explicitly indicates a referral, referred-by flow, or employee referral.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `This image is a job-application screenshot named ${input.filename}. Extract the visible job title, company name, whether a referral is shown, the date applied if visible, and an optional longer job description.`,
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
