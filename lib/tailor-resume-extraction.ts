import OpenAI, { toFile } from "openai";
import { fileBufferToDataUrl } from "@/lib/job-tracking";
import {
  parseResumeDocument,
  type ResumeDocument,
} from "@/lib/tailor-resume-types";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

const textSegmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    segmentType: {
      type: "string",
      enum: ["text", "separator_pipe", "separator_bullet"],
    },
    text: { type: "string" },
    isBold: { type: "boolean" },
    isItalic: { type: "boolean" },
    isLinkStyle: { type: "boolean" },
  },
  required: ["segmentType", "text", "isBold", "isItalic", "isLinkStyle"],
} as const;

const richTextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: textSegmentSchema,
    },
  },
  required: ["segments"],
} as const;

const indentedRichTextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    indentLevel: {
      type: "integer",
      minimum: 0,
      maximum: 3,
    },
    segments: {
      type: "array",
      items: textSegmentSchema,
    },
  },
  required: ["indentLevel", "segments"],
} as const;

const blockSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    blockType: {
      type: "string",
      enum: ["entry", "paragraph", "labeled_line"],
    },
    subSectionText: {
      ...richTextSchema,
      type: ["object", "null"],
    },
    subSectionDates: {
      ...richTextSchema,
      type: ["object", "null"],
    },
    subSectionDescription: {
      type: "array",
      items: indentedRichTextSchema,
    },
    subSectionBullets: {
      type: "array",
      items: indentedRichTextSchema,
    },
    content: {
      ...indentedRichTextSchema,
      type: ["object", "null"],
    },
    label: {
      ...richTextSchema,
      type: ["object", "null"],
    },
    value: {
      ...richTextSchema,
      type: ["object", "null"],
    },
  },
  required: [
    "blockType",
    "subSectionText",
    "subSectionDates",
    "subSectionDescription",
    "subSectionBullets",
    "content",
    "label",
    "value",
  ],
} as const;

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headerText: richTextSchema,
    subHeadText: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lineItems: {
            type: "array",
            items: richTextSchema,
          },
          separatorBetweenItems: {
            type: ["string", "null"],
            enum: ["bullet", "pipe", null],
          },
        },
        required: ["lineItems", "separatorBetweenItems"],
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sectionText: richTextSchema,
          blocks: {
            type: "array",
            items: blockSchema,
          },
        },
        required: ["sectionText", "blocks"],
      },
    },
  },
  required: ["headerText", "subHeadText", "sections"],
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

function buildSampleResumeDocument(): ResumeDocument {
  return parseResumeDocument({
    headerText: {
      segments: [
        {
          segmentType: "text",
          text: "HENRY DEUTSCH",
          isBold: true,
          isItalic: false,
          isLinkStyle: false,
        },
      ],
    },
    subHeadText: [
      {
        lineItems: [
          {
            segments: [
              {
                segmentType: "text",
                text: "HenryMDeutsch@gmail.com",
                isBold: false,
                isItalic: false,
                isLinkStyle: false,
              },
            ],
          },
          {
            segments: [
              {
                segmentType: "text",
                text: "914-272-5561",
                isBold: false,
                isItalic: false,
                isLinkStyle: false,
              },
            ],
          },
          {
            segments: [
              {
                segmentType: "text",
                text: "linkedin.com/in/henry-deutsch",
                isBold: false,
                isItalic: false,
                isLinkStyle: true,
              },
            ],
          },
        ],
        separatorBetweenItems: "bullet",
      },
      {
        lineItems: [
          {
            segments: [
              {
                segmentType: "text",
                text: "Portfolio: ",
                isBold: false,
                isItalic: false,
                isLinkStyle: false,
              },
              {
                segmentType: "text",
                text: "henry-deutsch.com",
                isBold: false,
                isItalic: false,
                isLinkStyle: true,
              },
            ],
          },
        ],
        separatorBetweenItems: null,
      },
    ],
    sections: [
      {
        sectionText: {
          segments: [
            {
              segmentType: "text",
              text: "WORK EXPERIENCE",
              isBold: true,
              isItalic: false,
              isLinkStyle: false,
            },
          ],
        },
        blocks: [
          {
            blockType: "entry",
            subSectionText: {
              segments: [
                {
                  segmentType: "text",
                  text: "NewForm AI",
                  isBold: true,
                  isItalic: false,
                  isLinkStyle: false,
                },
                {
                  segmentType: "separator_pipe",
                  text: "|",
                  isBold: false,
                  isItalic: false,
                  isLinkStyle: false,
                },
                {
                  segmentType: "text",
                  text: "Software Engineer I — Full Time",
                  isBold: false,
                  isItalic: true,
                  isLinkStyle: false,
                },
              ],
            },
            subSectionDates: {
              segments: [
                {
                  segmentType: "text",
                  text: "Aug 2025 - Feb 2026",
                  isBold: false,
                  isItalic: false,
                  isLinkStyle: false,
                },
              ],
            },
            subSectionDescription: [
              {
                indentLevel: 0,
                segments: [
                  {
                    segmentType: "text",
                    text: "NewForm provides B2B analytics for consumer companies on their ads, synthesized using deep data modeling and AI.",
                    isBold: false,
                    isItalic: false,
                    isLinkStyle: false,
                  },
                ],
              },
            ],
            subSectionBullets: [
              {
                indentLevel: 1,
                segments: [
                  {
                    segmentType: "text",
                    text: "Led major refactor enabling $50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.",
                    isBold: false,
                    isItalic: false,
                    isLinkStyle: false,
                  },
                ],
              },
            ],
            content: null,
            label: null,
            value: null,
          },
        ],
      },
      {
        sectionText: {
          segments: [
            {
              segmentType: "text",
              text: "TECHNICAL SKILLS",
              isBold: true,
              isItalic: false,
              isLinkStyle: false,
            },
          ],
        },
        blocks: [
          {
            blockType: "labeled_line",
            subSectionText: null,
            subSectionDates: null,
            subSectionDescription: [],
            subSectionBullets: [],
            content: null,
            label: {
              segments: [
                {
                  segmentType: "text",
                  text: "Languages:",
                  isBold: true,
                  isItalic: false,
                  isLinkStyle: false,
                },
              ],
            },
            value: {
              segments: [
                {
                  segmentType: "text",
                  text: "TypeScript, JavaScript, Python",
                  isBold: false,
                  isItalic: false,
                  isLinkStyle: false,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

export async function extractResumeDocument(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}) {
  const model = process.env.OPENAI_RESUME_EXTRACTION_MODEL ?? "gpt-5-mini";

  if (isTestOpenAIResponseEnabled()) {
    const document = buildSampleResumeDocument();

    return {
      document,
      model: TEST_OPENAI_RESPONSE_MODEL,
      rawText: JSON.stringify(document),
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
        "Extract a structured resume document from the provided resume. Preserve intentional header lines, section order, entries, paragraph lines, bullet lists, and labeled lines such as 'Languages:' or 'Awards:'. Use blockType 'entry' for rows with main left-side content and optional right-side companion text such as dates. Put right-side dates or similar companion text into subSectionDates instead of encoding alignment. Use blockType 'paragraph' for standalone prose lines. Use blockType 'labeled_line' for lines with a label and value. Represent list bullets in subSectionBullets, not as separator segments. Use segmentType 'separator_pipe' only for the literal '|' character. Use segmentType 'separator_bullet' only for the literal '•' separator when it is part of inline content, not for list bullets. Keep em dashes and hyphens as normal text. Use isItalic only when text is visually italicized. Use isLinkStyle only when text visually appears link-styled, such as blue and underlined. Ignore exact spacing and visual centering. Never invent content that is not present in the resume.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract the resume into the requested structured format. Keep the original section order. If a section mixes entries, labeled lines, and paragraphs, preserve that order in blocks. Use null for unused block fields and [] for empty arrays.",
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
          name: "resume_document_extraction",
          strict: true,
          schema: extractionSchema,
        },
      },
    });

    const outputText = readOutputText(response);

    if (!outputText) {
      throw new Error("The model returned an empty resume extraction response.");
    }

    return {
      document: parseResumeDocument(JSON.parse(outputText)),
      model: (response as { model?: string }).model ?? model,
      rawText: outputText,
    };
  } finally {
    if (uploadedFile?.id) {
      await client.files.delete(uploadedFile.id);
    }
  }
}
