import OpenAI, { toFile } from "openai";
import { fileBufferToDataUrl } from "@/lib/job-tracking";
import {
  tailorResumeLatexExample,
  tailorResumeLatexTemplate,
} from "@/lib/tailor-resume-latex-example";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

const extractedLatexSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    latexCode: { type: "string" },
  },
  required: ["latexCode"],
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

export async function extractResumeLatexDocument(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}) {
  const model = process.env.OPENAI_RESUME_EXTRACTION_MODEL ?? "gpt-5-mini";

  if (isTestOpenAIResponseEnabled()) {
    return {
      latexCode: tailorResumeLatexExample,
      model: TEST_OPENAI_RESPONSE_MODEL,
    };
  }

  const client = getOpenAIClient();
  const uploadedFile = input.mimeType.startsWith("image/")
    ? null
    : await client.files.create({
        file: await toFile(input.buffer, input.filename, {
          type: input.mimeType,
        }),
        purpose: "user_data",
      });

  try {
    const response = await client.responses.create({
      model,
      instructions:
        "Convert the provided resume into a complete standalone LaTeX document. The response schema only allows one field: latexCode. Preserve every word from the resume exactly as written whenever it is legible. Never summarize, shorten, compress, or omit text. In particular, never truncate bullets to their first sentence. Keep the original section order and keep all bullets, dates, headings, labeled lines, links, and separators. Preserve visible bold, italics, underlines, bullet structure, and link styling when possible. Return a full LaTeX document from \\documentclass through \\end{document} that compiles with pdflatex. Prefer the exact template and macro vocabulary shown below. Use only standard LaTeX plus the packages already present in that template unless absolutely necessary. Inline formatting such as \\textbf, \\textit, \\tightul, and \\href may appear anywhere inside macro arguments when needed. Do not include markdown fences or any explanation outside latexCode.\n\nPay particular attention to these details because they are easy to get wrong:\n1. Header: match the centered header structure from the reference example, including how the name is centered and how the contact lines are centered beneath it.\n2. Education section: match the alignment pattern in the reference example, especially the left/right tabular alignment for school and dates, plus the indented follow-up lines below it.\n3. Technical skills section: do not align the text like the education section. Follow the reference example where each skills line continues naturally after the colon using the hanging-indent style rather than trying to force tabular left/right alignment.\n4. Bolding: pay special attention to what is visibly bolded in the uploaded image and reproduce that emphasis faithfully in LaTeX. Do not flatten bold emphasis, and do not assume only headings are bold; important phrases inside bullets, links, labels, names, and other inline fragments may need \\textbf{} as shown by the source image.\n5. Vertical spacing: pay close attention to the tight vertical spacing in the source image and the reference example. Use small spacing adjustments, including negative \\vspace{...} values when appropriate, to pull sections closer together and match the visual density of the original resume, especially between the centered header and the first section and around section transitions. Avoid leaving the document with loose default spacing when the source image is visibly tighter.\n\nPreferred template:\n\n" +
        tailorResumeLatexTemplate +
        "\n\nReference example:\n\n" +
        tailorResumeLatexExample,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
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
                    file_id: uploadedFile?.id ?? null,
                  },
                ]),
          ],
        },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "resume_latex_extraction",
          strict: true,
          schema: extractedLatexSchema,
        },
      },
    });

    const outputText = readOutputText(response);

    if (!outputText) {
      throw new Error("The model returned an empty LaTeX extraction response.");
    }

    const latexCode = readExtractedLatexCode(JSON.parse(outputText));

    return {
      latexCode,
      model: (response as { model?: string }).model ?? model,
    };
  } finally {
    if (uploadedFile?.id) {
      await client.files.delete(uploadedFile.id);
    }
  }
}
