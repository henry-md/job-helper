import OpenAI from "openai";
import { stripTailorResumeSegmentIds, normalizeTailorResumeLatex } from "@/lib/tailor-resume-segmentation";
import { validateTailorResumeLatexDocument } from "@/lib/tailor-resume-link-validation";

const maxTailoredResumeAttempts = 3;
const submitTailoredResumeToolName = "submit_tailored_resume";
const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

const submitTailoredResumeTool = {
  type: "function",
  name: submitTailoredResumeToolName,
  description:
    "Submit a complete tailored LaTeX resume document plus the user-facing display name for this job-specific resume.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      latexCode: { type: "string" },
    },
    required: ["displayName", "latexCode"],
  },
} as const;

type TailoredResumeOutputItem = {
  arguments?: string;
  call_id?: string;
  name?: string;
  type?: string;
};

type TailoredResumeResponse = {
  id?: string;
  model?: string;
  output?: TailoredResumeOutputItem[];
};

export type GenerateTailoredResumeResult = {
  annotatedLatexCode: string;
  attempts: number;
  displayName: string;
  latexCode: string;
  model: string;
  previewPdf: Buffer | null;
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

function readToolCall(response: TailoredResumeResponse) {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === submitTailoredResumeToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        callId: outputItem.call_id,
      };
    }
  }

  throw new Error("The model did not call submit_tailored_resume.");
}

function readCandidate(argumentsText: string) {
  const value = JSON.parse(argumentsText) as {
    displayName?: unknown;
    latexCode?: unknown;
  };
  const displayName =
    typeof value.displayName === "string" ? value.displayName.trim() : "";
  const latexCode = typeof value.latexCode === "string" ? value.latexCode.trim() : "";

  if (!displayName) {
    throw new Error("The model returned an empty tailored resume display name.");
  }

  if (!latexCode) {
    throw new Error("The model returned an empty tailored LaTeX document.");
  }

  return {
    displayName,
    latexCode,
  };
}

function buildTailoringInstructions() {
  return `Tailor the provided resume LaTeX for the provided job description. You will receive the resume as a full LaTeX document with server-owned segment comments in the form % JOBHELPER_SEGMENT_ID: ... before each logical block. Treat those comments as immutable metadata that helps map the document structure. You may revise any part of the LaTeX document for a job-specific version of the resume, including preamble and layout blocks when truly necessary, but do not invent or rename segment IDs. If your draft changes their placement, the server will normalize them again.

Goals:
1. Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.
2. Tailor wording toward the target role by rephrasing existing content, reordering emphasis, and selectively removing less relevant content when helpful.
3. Return a complete standalone LaTeX document.
4. Produce a concise displayName for the saved tailored resume in the form "Company - Role" whenever the company and role can be inferred from the job description. If only one is clear, use the clearest available value.
5. Prefer content edits over visual/style edits. It is heavily discouraged to change styling, page layout, margins, fonts, text sizing, spacing systems, or macro structure unless the user explicitly asked for visual/layout changes or the document cannot compile without such a fix.

Submission rules:
- Always call ${submitTailoredResumeToolName}.
- Pass the full LaTeX document in latexCode.
- Pass the user-facing saved name in displayName.
- Keep the document pdflatex-compatible.
- Do not add claims that are not supported by the source resume.
- If the company and role are unclear, still provide a deterministic fallback displayName using the clearest available role, company, or "Tailored Resume".`;
}

export async function generateTailoredResume(input: {
  annotatedLatexCode: string;
  jobDescription: string;
}) : Promise<GenerateTailoredResumeResult> {
  const model = process.env.OPENAI_TAILOR_RESUME_MODEL ?? "gpt-5-mini";
  const normalizedInput = normalizeTailorResumeLatex(input.annotatedLatexCode);

  if (isTestOpenAIResponseEnabled()) {
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedInput.annotatedLatex),
    );

    return {
      annotatedLatexCode: normalizedInput.annotatedLatex,
      attempts: 1,
      displayName: "Tailored Resume",
      latexCode: stripTailorResumeSegmentIds(normalizedInput.annotatedLatex),
      model: TEST_OPENAI_RESPONSE_MODEL,
      previewPdf: validation.ok ? validation.previewPdf : null,
      validationError: validation.ok ? null : validation.error,
    };
  }

  const client = getOpenAIClient();
  let previousResponseId: string | undefined;
  let nextInput:
    | Array<{
        role: "user";
        content: Array<{ type: "input_text"; text: string }>;
      }>
    | Array<{
        type: "function_call_output";
        call_id: string;
        output: string;
      }>
    | undefined = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `Job description:\n${input.jobDescription}\n\n` +
            `Base resume LaTeX with segment IDs:\n${normalizedInput.annotatedLatex}`,
        },
      ],
    },
  ];
  let lastError: string | null = null;
  let lastDisplayName = "Tailored Resume";
  let lastAnnotatedLatex = normalizedInput.annotatedLatex;

  for (let attempt = 1; attempt <= maxTailoredResumeAttempts; attempt += 1) {
    const response = await client.responses.create({
      input: nextInput as never,
      instructions: buildTailoringInstructions(),
      model,
      parallel_tool_calls: false,
      previous_response_id: previousResponseId,
      tool_choice: "required",
      tools: [submitTailoredResumeTool],
    });

    previousResponseId = response.id;

    const toolCall = readToolCall({
      id: response.id,
      model: response.model ?? undefined,
      output: response.output.map((outputItem) => ({
        arguments:
          "arguments" in outputItem && typeof outputItem.arguments === "string"
            ? outputItem.arguments
            : undefined,
        call_id:
          "call_id" in outputItem && typeof outputItem.call_id === "string"
            ? outputItem.call_id
            : undefined,
        name: "name" in outputItem ? outputItem.name : undefined,
        type: outputItem.type,
      })),
    });
    const candidate = readCandidate(toolCall.arguments);
    const normalizedCandidate = normalizeTailorResumeLatex(candidate.latexCode);
    const validation = await validateTailorResumeLatexDocument(
      stripTailorResumeSegmentIds(normalizedCandidate.annotatedLatex),
    );

    lastDisplayName = candidate.displayName;
    lastAnnotatedLatex = normalizedCandidate.annotatedLatex;

    if (validation.ok) {
      return {
        annotatedLatexCode: normalizedCandidate.annotatedLatex,
        attempts: attempt,
        displayName: candidate.displayName,
        latexCode: stripTailorResumeSegmentIds(normalizedCandidate.annotatedLatex),
        model: response.model ?? model,
        previewPdf: validation.previewPdf,
        validationError: null,
      };
    }

    lastError = validation.error;
    nextInput = [
      {
        type: "function_call_output",
        call_id: toolCall.callId,
        output: JSON.stringify({
          error: validation.error,
          instruction:
            "Revise the tailored resume, keep it factually grounded in the source resume, and call submit_tailored_resume again with a complete corrected latexCode and displayName.",
          remainingAttempts: maxTailoredResumeAttempts - attempt,
        }),
      },
    ];
  }

  return {
    annotatedLatexCode: lastAnnotatedLatex,
    attempts: maxTailoredResumeAttempts,
    displayName: lastDisplayName,
    latexCode: stripTailorResumeSegmentIds(lastAnnotatedLatex),
    model,
    previewPdf: null,
    validationError:
      lastError ??
      `Unable to produce a tailored resume after ${maxTailoredResumeAttempts} attempts.`,
  };
}
