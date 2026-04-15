import OpenAI, { toFile } from "openai";
import { validateTailorResumeLatexDocument } from "@/lib/tailor-resume-link-validation";
import {
  maxResumeLatexAttempts,
  resumeLatexValidationTool,
  runResumeLatexToolLoop,
  type RunResumeLatexToolLoopResult,
} from "@/lib/tailor-resume-extraction-loop";
import { fileBufferToDataUrl } from "@/lib/job-tracking";
import {
  tailorResumeLatexExample,
  tailorResumeLatexTemplate,
} from "@/lib/tailor-resume-latex-example";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

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

function buildResumeLatexInstructions() {
  return `Convert the provided resume into a complete standalone LaTeX document. Preserve every word from the resume exactly as written whenever it is legible. Never summarize, shorten, compress, or omit text. In particular, never truncate bullets to their first sentence. Keep the original section order and keep all bullets, dates, headings, labeled lines, links, and separators. Preserve visible bold, italics, underlines, bullet structure, and link styling when possible. Return a full LaTeX document from \\documentclass through \\end{document} that compiles with pdflatex. Prefer the exact template and macro vocabulary shown below. Use only standard LaTeX plus the packages already present in that template unless absolutely necessary. Inline formatting such as \\textbf, \\textit, \\tightul, and \\href may appear anywhere inside macro arguments when needed.

Pay particular attention to these details because they are easy to get wrong:
1. Header: match the centered header structure from the reference example, including how the name is centered and how the contact lines are centered beneath it.
2. Education section: match the alignment pattern in the reference example, especially the left/right tabular alignment for school and dates, plus the indented follow-up lines below it.
3. Technical skills section: do not align the text like the education section. Follow the reference example where each skills line continues naturally after the colon using the hanging-indent style rather than trying to force tabular left/right alignment.
4. Bolding: pay special attention to what is visibly bolded in the uploaded image and reproduce that emphasis faithfully in LaTeX. Do not flatten bold emphasis, and do not assume only headings are bold; important phrases inside bullets, links, labels, names, and other inline fragments may need \\textbf{} as shown by the source image.
5. Vertical spacing: pay close attention to the tight vertical spacing in the source image and the reference example. Use small spacing adjustments, including negative \\vspace{...} values when appropriate, to pull sections closer together and match the visual density of the original resume, especially between the centered header and the first section and around section transitions. Avoid leaving the document with loose default spacing when the source image is visibly tighter.
6. Unicode safety: do not emit unsupported raw Unicode glyphs such as replacement characters or private-use characters. Replace them with LaTeX-safe ASCII or explicit LaTeX commands.
7. Link fidelity: only preserve hyperlink styling when the destination is explicitly supported by the visible resume content. If a destination fails validation or the visible text does not support a specific target, keep the visible text but remove \\href and link-only styling such as \\tightul instead of guessing a replacement.

Tool workflow:
- Use the validate_resume_latex tool every time you draft or revise the full document.
- Pass the complete standalone LaTeX document in the tool argument latexCode.
- The tool validates both pdflatex compilation and extracted hyperlinks.
- If the tool reports a compile error or failed links, fix that exact issue while preserving the resume content. For failed links, preserve the visible text but remove hyperlink-specific styling instead of inventing a destination.
- Stop as soon as the tool reports success. You have at most ${String(maxResumeLatexAttempts)} validation attempts.

Preferred template:

${tailorResumeLatexTemplate}

Reference example:

${tailorResumeLatexExample}`;
}

function buildResumeExtractionInput(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}, uploadedFileId: string | null) {
  if (!input.mimeType.startsWith("image/") && !uploadedFileId) {
    throw new Error("Unable to upload the resume file for extraction.");
  }

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "Extract this resume into LaTeX using the preferred template as closely as possible. Preserve all content and keep the document faithful to the uploaded resume.",
        },
        ...(input.mimeType.startsWith("image/")
          ? [
              {
                type: "input_text" as const,
                text: `Resume image: ${input.filename} (${input.mimeType}).`,
              },
              {
                type: "input_image" as const,
                image_url: fileBufferToDataUrl(input.buffer, input.mimeType),
                detail: "high" as const,
              },
            ]
          : [
              {
                type: "input_text" as const,
                text: `Resume file: ${input.filename} (${input.mimeType}).`,
              },
              {
                type: "input_file" as const,
                file_id: uploadedFileId,
              },
            ]),
      ],
    },
  ];
}

export type ExtractResumeLatexDocumentResult = RunResumeLatexToolLoopResult;

type ExtractResumeLatexDocumentDependencies = {
  client?: OpenAI;
  validateLatexDocument?: (
    latexCode: string,
  ) => ReturnType<typeof validateTailorResumeLatexDocument>;
};

export async function extractResumeLatexDocument(
  input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
  dependencies: ExtractResumeLatexDocumentDependencies = {},
): Promise<ExtractResumeLatexDocumentResult> {
  const model = process.env.OPENAI_RESUME_EXTRACTION_MODEL ?? "gpt-5-mini";
  const validateLatexDocument =
    dependencies.validateLatexDocument ?? validateTailorResumeLatexDocument;

  if (isTestOpenAIResponseEnabled()) {
    try {
      const validation = await validateLatexDocument(tailorResumeLatexExample);

      if (!validation.ok) {
        return {
          attempts: 1,
          attemptEvents: [
            {
              attempt: 1,
              error: validation.error,
              linkSummary: validation.linkSummary,
              outcome: "failed",
              willRetry: false,
            },
          ],
          latexCode: tailorResumeLatexExample,
          linkSummary: validation.linkSummary,
          model: TEST_OPENAI_RESPONSE_MODEL,
          previewPdf: null,
          validationError: validation.error,
        };
      }

      return {
        attempts: 1,
        attemptEvents: [
          {
            attempt: 1,
            error: null,
            linkSummary: validation.linkSummary,
            outcome: "succeeded",
            willRetry: false,
          },
        ],
        latexCode: tailorResumeLatexExample,
        linkSummary: validation.linkSummary,
        model: TEST_OPENAI_RESPONSE_MODEL,
        previewPdf: validation.previewPdf,
        validationError: null,
      };
    } catch (error) {
      return {
        attempts: 1,
        attemptEvents: [
          {
            attempt: 1,
            error:
              error instanceof Error
                ? error.message
                : "Unable to compile the test LaTeX document.",
            linkSummary: null,
            outcome: "failed",
            willRetry: false,
          },
        ],
        latexCode: tailorResumeLatexExample,
        linkSummary: null,
        model: TEST_OPENAI_RESPONSE_MODEL,
        previewPdf: null,
        validationError:
          error instanceof Error
            ? error.message
            : "Unable to compile the test LaTeX document.",
      };
    }
  }

  const client = dependencies.client ?? getOpenAIClient();
  const uploadedFile = input.mimeType.startsWith("image/")
    ? null
    : await client.files.create({
        file: await toFile(input.buffer, input.filename, {
          type: input.mimeType,
        }),
        purpose: "user_data",
      });

  try {
    return await runResumeLatexToolLoop({
      createResponse: async ({ previousResponseId, input: retryInput }) => {
        const response = await client.responses.create({
          model,
          instructions: buildResumeLatexInstructions(),
          input:
            retryInput ??
            buildResumeExtractionInput(input, uploadedFile?.id ?? null),
          parallel_tool_calls: false,
          previous_response_id: previousResponseId,
          tool_choice: "required",
          tools: [resumeLatexValidationTool],
        });

        return {
          id: response.id,
          model: response.model ?? undefined,
          output: response.output.map((outputItem) => {
            const mappedItem: {
              arguments?: string;
              call_id?: string;
              content?: Array<{ type?: string; text?: string }>;
              name?: string;
              type?: string;
            } = {
              type: outputItem.type,
            };

            if ("name" in outputItem && typeof outputItem.name === "string") {
              mappedItem.name = outputItem.name;
            }

            if ("call_id" in outputItem && typeof outputItem.call_id === "string") {
              mappedItem.call_id = outputItem.call_id;
            }

            if (
              "arguments" in outputItem &&
              typeof outputItem.arguments === "string"
            ) {
              mappedItem.arguments = outputItem.arguments;
            }

            if ("content" in outputItem && Array.isArray(outputItem.content)) {
              mappedItem.content = outputItem.content.map((contentItem) => {
                const mappedContent: { type?: string; text?: string } = {};

                if ("type" in contentItem && typeof contentItem.type === "string") {
                  mappedContent.type = contentItem.type;
                }

                if ("text" in contentItem && typeof contentItem.text === "string") {
                  mappedContent.text = contentItem.text;
                }

                return mappedContent;
              });
            }

            return mappedItem;
          }),
          output_text: response.output_text,
        };
      },
      fallbackModel: model,
      validateLatex: validateLatexDocument,
    });
  } finally {
    if (uploadedFile?.id) {
      await client.files.delete(uploadedFile.id);
    }
  }
}
