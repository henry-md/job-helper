export const maxResumeLatexAttempts = 3;
export const resumeLatexValidationToolName = "validate_resume_latex";

export const resumeLatexValidationTool = {
  type: "function",
  name: resumeLatexValidationToolName,
  description:
    "Compile a full standalone LaTeX resume candidate with pdflatex and return any compile error so it can be fixed.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      latexCode: { type: "string" },
    },
    required: ["latexCode"],
  },
} as const;

type ResumeLatexMessageOutput = {
  type?: string;
  text?: string;
};

type ResumeLatexOutputItem = {
  arguments?: string;
  call_id?: string;
  content?: ResumeLatexMessageOutput[];
  name?: string;
  type?: string;
};

type ResumeLatexToolCall = {
  arguments: string;
  call_id: string;
  name: string;
  type: "function_call";
};

export type ResumeLatexLoopResponse = {
  id?: string;
  model?: string;
  output?: ResumeLatexOutputItem[];
  output_text?: string;
};

type ResumeLatexRetryMessage = {
  role: "user";
  content: Array<{
    type: "input_text";
    text: string;
  }>;
};

type ResumeLatexFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ResumeLatexLoopInput =
  | ResumeLatexRetryMessage[]
  | ResumeLatexFunctionCallOutput[];

export type RunResumeLatexToolLoopArgs = {
  createResponse: (input: {
    previousResponseId?: string;
    input?: ResumeLatexLoopInput;
  }) => Promise<ResumeLatexLoopResponse>;
  fallbackModel: string;
  maxAttempts?: number;
  validateLatex: (latexCode: string) => Promise<Buffer>;
};

export type RunResumeLatexToolLoopResult = {
  attempts: number;
  attemptEvents: Array<{
    attempt: number;
    error: string | null;
    outcome: "failed" | "succeeded";
    willRetry: boolean;
  }>;
  latexCode: string;
  model: string;
  previewPdf: Buffer | null;
  validationError: string | null;
};

function readOutputText(response: ResumeLatexLoopResponse) {
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

function readExtractedLatexCode(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("latexCode" in value) ||
    typeof value.latexCode !== "string"
  ) {
    throw new Error("The model did not return a LaTeX document.");
  }

  const latexCode = value.latexCode.trim();

  if (!latexCode) {
    throw new Error("The model returned an empty LaTeX document.");
  }

  return latexCode;
}

function buildRetryMessage(error: string): ResumeLatexRetryMessage[] {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `The previous response did not call ${resumeLatexValidationToolName} correctly.\n\n` +
            `Exact issue:\n${error}\n\n` +
            `Return to the resume, produce the full corrected LaTeX document, and call ${resumeLatexValidationToolName} with the entire document in latexCode.`,
        },
      ],
    },
  ];
}

function buildValidationFailureOutput(input: {
  attempt: number;
  callId: string;
  error: string;
  maxAttempts: number;
}): ResumeLatexFunctionCallOutput[] {
  return [
    {
      type: "function_call_output",
      call_id: input.callId,
      output: JSON.stringify({
        attempt: input.attempt,
        error: input.error,
        instruction:
          "Revise the full LaTeX document, preserve the visible resume content, and call validate_resume_latex again with the complete corrected latexCode.",
        ok: false,
        remainingAttempts: input.maxAttempts - input.attempt,
      }),
    },
  ];
}

function buildRetryExhaustedError(lastError: string | null, maxAttempts: number) {
  if (!lastError) {
    return `Unable to produce a compilable LaTeX resume after ${maxAttempts} attempts.`;
  }

  return (
    `Unable to produce a compilable LaTeX resume after ${maxAttempts} attempts.\n\n` +
    `Last validation error:\n${lastError}`
  );
}

function findResumeLatexToolCall(
  response: ResumeLatexLoopResponse,
): ResumeLatexToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === resumeLatexValidationToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: outputItem.name,
        type: "function_call",
      };
    }
  }

  return null;
}

export async function runResumeLatexToolLoop(
  args: RunResumeLatexToolLoopArgs,
): Promise<RunResumeLatexToolLoopResult> {
  const maxAttempts = args.maxAttempts ?? maxResumeLatexAttempts;
  const attemptEvents: RunResumeLatexToolLoopResult["attemptEvents"] = [];
  let previousResponseId: string | undefined;
  let nextInput: ResumeLatexLoopInput | undefined;
  let lastError: string | null = null;
  let lastLatexCode: string | null = null;
  let resolvedModel: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await args.createResponse({
      input: nextInput,
      previousResponseId,
    });

    if (typeof response.id === "string") {
      previousResponseId = response.id;
    }

    if (typeof response.model === "string" && response.model.length > 0) {
      resolvedModel = response.model;
    }

    const toolCall = findResumeLatexToolCall(response);

    if (!toolCall) {
      const outputText = readOutputText(response);

      if (outputText) {
        try {
          const fallbackLatexCode = readExtractedLatexCode(JSON.parse(outputText));
          lastLatexCode = fallbackLatexCode;
          const previewPdf = await args.validateLatex(fallbackLatexCode);

          return {
            attempts: attempt,
            attemptEvents: [
              ...attemptEvents,
              {
                attempt,
                error: null,
                outcome: "succeeded",
                willRetry: false,
              },
            ],
            latexCode: fallbackLatexCode,
            model: resolvedModel ?? args.fallbackModel,
            previewPdf,
            validationError: null,
          };
        } catch (error) {
          lastError =
            error instanceof Error
              ? error.message
              : `The model did not call ${resumeLatexValidationToolName}.`;
        }
      } else {
        lastError = `The model did not call ${resumeLatexValidationToolName}.`;
      }

      attemptEvents.push({
        attempt,
        error: lastError,
        outcome: "failed",
        willRetry: attempt < maxAttempts,
      });

      if (attempt === maxAttempts) {
        break;
      }

      nextInput = buildRetryMessage(lastError);
      continue;
    }

    try {
      const latexCode = readExtractedLatexCode(JSON.parse(toolCall.arguments));
      lastLatexCode = latexCode;
      const previewPdf = await args.validateLatex(latexCode);

      return {
        attempts: attempt,
        attemptEvents: [
          ...attemptEvents,
          {
            attempt,
            error: null,
            outcome: "succeeded",
            willRetry: false,
          },
        ],
        latexCode,
        model: resolvedModel ?? args.fallbackModel,
        previewPdf,
        validationError: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to validate the generated LaTeX document.";

      attemptEvents.push({
        attempt,
        error: lastError,
        outcome: "failed",
        willRetry: attempt < maxAttempts,
      });

      if (attempt === maxAttempts) {
        break;
      }

      nextInput = buildValidationFailureOutput({
        attempt,
        callId: toolCall.call_id,
        error: lastError,
        maxAttempts,
      });
    }
  }

  if (!lastLatexCode) {
    throw new Error(buildRetryExhaustedError(lastError, maxAttempts));
  }

  return {
    attempts: maxAttempts,
    attemptEvents,
    latexCode: lastLatexCode,
    model: resolvedModel ?? args.fallbackModel,
    previewPdf: null,
    validationError: buildRetryExhaustedError(lastError, maxAttempts),
  };
}
