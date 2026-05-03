import { randomUUID } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { hashTailorResumeChatUrl, maxTailorResumeChatMessageLength } from "./tailor-resume-chat.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import { readTailorResumeProfileState } from "./tailor-resume-profile-state.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import { buildTailorResumeSourcePreview } from "./tailor-resume-source-preview.ts";
import { writeTailorResumeConfigChatArtifactPdf } from "./tailor-resume-storage.ts";
import { applyTailorResumeBlockChanges } from "./tailor-resume-tailoring.ts";
import type { TailorResumeChatRole } from "./tailor-resume-chat.ts";
import { getPrismaClient } from "./prisma.ts";

const tailorResumeConfigChatThreadKey = "config://source-resume";
const tailorResumeConfigChatPageTitle = "Source resume";
const applySourceResumeBlockEditsToolName = "apply_source_resume_block_edits";
const inspectRenderedResumePdfToolName = "inspect_rendered_resume_pdf";
const configChatContentEnvelopePrefix = "__JOBHELPER_CONFIG_CHAT_V1__";
const maxConfigChatToolRounds = 8;

type StoredChatMessage = {
  content: string;
  createdAt: Date;
  id: string;
  model: string | null;
  role: "ASSISTANT" | "USER";
};

type StoredTailorResumeConfigChatTextBlock = {
  text: string;
  type: "text";
};

type StoredTailorResumeConfigChatPdfBlock = {
  artifactId: string;
  label: string;
  pageCount: number | null;
  type: "pdf";
};

type StoredTailorResumeConfigChatMessageBlock =
  | StoredTailorResumeConfigChatPdfBlock
  | StoredTailorResumeConfigChatTextBlock;

type TailorResumeConfigChatResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    arguments?: string;
    call_id?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    name?: string;
    type?: string;
  }>;
  output_text?: string;
};

type TailorResumeConfigChatToolCall = {
  arguments: string;
  call_id: string;
  name:
    | typeof applySourceResumeBlockEditsToolName
    | typeof inspectRenderedResumePdfToolName;
};

type TailorResumeConfigChatStoredMessageInput = {
  blocks: StoredTailorResumeConfigChatMessageBlock[];
  model: string | null;
  role: TailorResumeChatRole;
};

type TailorResumeConfigChatResponseInput = Array<
  | {
      call_id: string;
      output: string;
      type: "function_call_output";
    }
  | {
      content: Array<
        | {
            text: string;
            type: "input_text";
          }
        | {
            file_id: string;
            type: "input_file";
          }
      >;
      role: "user";
    }
>;

type TailorResumeConfigChatBlockChange = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

export type TailorResumeConfigChatMessageBlock =
  | {
      text: string;
      type: "text";
    }
  | {
      artifactId: string;
      label: string;
      pageCount: number | null;
      type: "pdf";
      url: string;
    };

export type TailorResumeConfigChatMessageRecord = {
  blocks: TailorResumeConfigChatMessageBlock[];
  createdAt: string;
  id: string;
  model: string | null;
  role: TailorResumeChatRole;
};

export type SubmitTailorResumeConfigChatResult = {
  draftLatexCode: string;
  messages: TailorResumeConfigChatMessageRecord[];
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeConfigChatMessageContent(
  blocks: StoredTailorResumeConfigChatMessageBlock[],
) {
  return (
    configChatContentEnvelopePrefix +
    JSON.stringify({
      blocks,
      version: 1,
    })
  );
}

function buildTailorResumeConfigChatArtifactUrl(artifactId: string) {
  const searchParams = new URLSearchParams({
    configChatArtifactId: artifactId,
  });
  return `/api/tailor-resume/preview?${searchParams.toString()}`;
}

function parseStoredConfigChatMessageBlocks(
  content: string,
): TailorResumeConfigChatMessageBlock[] {
  if (!content.startsWith(configChatContentEnvelopePrefix)) {
    return content.trim()
      ? [
          {
            text: content.trim(),
            type: "text",
          },
        ]
      : [];
  }

  try {
    const payload = JSON.parse(
      content.slice(configChatContentEnvelopePrefix.length),
    ) as {
      blocks?: unknown;
    };

    if (!Array.isArray(payload.blocks)) {
      return [];
    }

    const blocks: TailorResumeConfigChatMessageBlock[] = [];

    for (const block of payload.blocks) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const blockType =
        "type" in block && typeof block.type === "string" ? block.type : "";

      if (blockType === "text") {
        const text = "text" in block ? readTrimmedString(block.text) : "";

        if (text) {
          blocks.push({
            text,
            type: "text",
          });
        }

        continue;
      }

      if (blockType === "pdf") {
        const artifactId =
          "artifactId" in block ? readTrimmedString(block.artifactId) : "";
        const label = "label" in block ? readTrimmedString(block.label) : "";
        const pageCount =
          "pageCount" in block && typeof block.pageCount === "number"
            ? block.pageCount
            : null;

        if (!artifactId || !label) {
          continue;
        }

        blocks.push({
          artifactId,
          label,
          pageCount,
          type: "pdf",
          url: buildTailorResumeConfigChatArtifactUrl(artifactId),
        });
      }
    }

    return blocks;
  } catch {
    return [];
  }
}

function serializeTailorResumeConfigChatMessage(
  message: StoredChatMessage,
): TailorResumeConfigChatMessageRecord {
  return {
    blocks: parseStoredConfigChatMessageBlocks(message.content),
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    model: message.model,
    role: message.role === "ASSISTANT" ? "assistant" : "user",
  };
}

function summarizeConfigChatBlocksForModel(
  blocks: TailorResumeConfigChatMessageBlock[],
) {
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      const pageCountLabel =
        typeof block.pageCount === "number"
          ? `${block.pageCount} page${block.pageCount === 1 ? "" : "s"}`
          : "unknown page count";

      return `[Rendered PDF inspection attached: ${block.label}; ${pageCountLabel}.]`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildConfigChatConversationTranscript(input: {
  currentUserMessage: string;
  previousMessages: TailorResumeConfigChatMessageRecord[];
}) {
  const transcript = [
    ...input.previousMessages.map((message) => ({
      role: message.role,
      summary: summarizeConfigChatBlocksForModel(message.blocks),
    })),
    {
      role: "user" as const,
      summary: input.currentUserMessage.trim(),
    },
  ];

  return transcript
    .filter((message) => message.summary)
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `${speaker}: ${message.summary}`;
    })
    .join("\n\n");
}

function buildConfigChatBlockCatalog(annotatedLatexCode: string) {
  const blocks = readAnnotatedTailorResumeBlocks(annotatedLatexCode);

  if (blocks.length === 0) {
    return "[No editable blocks were found.]";
  }

  return blocks
    .map((block, index) => {
      const plainText = renderTailoredResumeLatexToPlainText(block.latexCode);
      return [
        `${index + 1}. segmentId: ${block.id}`,
        `   command: ${block.command ?? "[none]"}`,
        plainText ? `   visible text: ${plainText}` : null,
        "   current latex block:",
        stripTailorResumeSegmentIds(block.latexCode),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    })
    .join("\n\n");
}

function buildTailorResumeConfigChatInstructions() {
  return [
    "You are Job Helper's config chat for editing the user's original source resume inside the web dashboard.",
    "The saved source resume is the baseline reference. The current working draft is what your tools should edit.",
    `Use ${applySourceResumeBlockEditsToolName} for every resume change. Do not describe hypothetical edits without making them when the user asked for a concrete change.`,
    "Keep changes block-scoped, minimal, and pdflatex-safe.",
    "Formatting/layout requests should prefer adjustments to spacing, margins, font sizing, line breaks, list spacing, section spacing, and similar source-level presentation controls before rewriting substantive content.",
    `Use ${inspectRenderedResumePdfToolName} before your final answer whenever you make or review layout-affecting changes, when the user asks about spacing or fit, or when page count / visual balance matters.`,
    `Do not claim you visually checked the rendered document unless you actually called ${inspectRenderedResumePdfToolName} during this turn.`,
    "If no change is needed, say so clearly and leave the working draft untouched.",
    "Keep the final user-facing answer concise and action-oriented.",
  ].join("\n");
}

function buildTailorResumeConfigChatInput(input: {
  currentDraftLatexCode: string;
  currentUserMessage: string;
  previousMessages: TailorResumeConfigChatMessageRecord[];
  savedLatexCode: string;
}): TailorResumeConfigChatResponseInput {
  const normalizedCurrentDraft = normalizeTailorResumeLatex(
    input.currentDraftLatexCode,
  );
  const currentVisibleText = renderTailoredResumeLatexToPlainText(
    input.currentDraftLatexCode,
  );

  return [
    {
      role: "user" as const,
      content: [
        {
          text: `User request:\n${input.currentUserMessage.trim()}`,
          type: "input_text" as const,
        },
        {
          text: `Saved baseline LaTeX:\n${input.savedLatexCode || "[No saved source resume is available.]"}`,
          type: "input_text" as const,
        },
        {
          text: `Current working draft LaTeX:\n${input.currentDraftLatexCode || "[No working draft is available.]"}`,
          type: "input_text" as const,
        },
        {
          text: `Current rendered visible text:\n${currentVisibleText || "[The current draft does not render visible text.]"}`,
          type: "input_text" as const,
        },
        {
          text:
            "Editable block catalog for the current working draft. Use these current segmentIds with the edit tool:\n" +
            buildConfigChatBlockCatalog(normalizedCurrentDraft.annotatedLatex),
          type: "input_text" as const,
        },
        {
          text:
            "Conversation so far:\n" +
            (buildConfigChatConversationTranscript({
              currentUserMessage: input.currentUserMessage,
              previousMessages: input.previousMessages,
            }) || "[No prior config-chat messages.]"),
          type: "input_text" as const,
        },
      ],
    },
  ];
}

function readOutputText(response: TailorResumeConfigChatResponse) {
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

function findTailorResumeConfigChatToolCall(
  response: TailorResumeConfigChatResponse,
): TailorResumeConfigChatToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      (outputItem.name === applySourceResumeBlockEditsToolName ||
        outputItem.name === inspectRenderedResumePdfToolName) &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: outputItem.name,
      };
    }
  }

  return null;
}

function parseApplySourceResumeBlockEditsArguments(
  value: unknown,
): TailorResumeConfigChatBlockChange[] {
  if (!value || typeof value !== "object") {
    throw new Error("The edit tool did not return a valid object.");
  }

  const rawChanges = "changes" in value ? value.changes : null;

  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    throw new Error("The edit tool must include at least one block change.");
  }

  return rawChanges.map((change) => {
    if (!change || typeof change !== "object") {
      throw new Error("The edit tool included an invalid block change.");
    }

    const segmentId =
      "segmentId" in change ? readTrimmedString(change.segmentId) : "";
    const latexCode =
      "latexCode" in change && typeof change.latexCode === "string"
        ? change.latexCode
        : "";
    const reason = "reason" in change ? readTrimmedString(change.reason) : "";

    if (!segmentId) {
      throw new Error("The edit tool returned a change without a segmentId.");
    }

    if (!reason) {
      throw new Error(
        `The edit tool returned a change without a reason for ${segmentId}.`,
      );
    }

    return {
      latexCode,
      reason,
      segmentId,
    };
  });
}

async function createTailorResumeConfigChatMessages(input: {
  messages: TailorResumeConfigChatStoredMessageInput[];
  threadId: string;
  userId: string;
}) {
  const prisma = getPrismaClient();

  if (input.messages.length === 0) {
    return [] as TailorResumeConfigChatMessageRecord[];
  }

  const createdMessages = await Promise.all(
    input.messages.map((message) =>
      prisma.tailorResumeChatMessage.create({
        data: {
          content: serializeConfigChatMessageContent(message.blocks),
          model: message.model,
          role: message.role === "assistant" ? "ASSISTANT" : "USER",
          threadId: input.threadId,
          userId: input.userId,
        },
      }),
    ),
  );

  return createdMessages.map((message) =>
    serializeTailorResumeConfigChatMessage(message),
  );
}

export async function readTailorResumeConfigChat(input: { userId: string }) {
  const prisma = getPrismaClient();
  const thread = await prisma.tailorResumeChatThread.findUnique({
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    where: {
      userId_urlHash: {
        urlHash: hashTailorResumeChatUrl(tailorResumeConfigChatThreadKey),
        userId: input.userId,
      },
    },
  });

  return {
    messages:
      thread?.messages.map((message) =>
        serializeTailorResumeConfigChatMessage(message),
      ) ?? [],
  };
}

export async function deleteTailorResumeConfigChat(input: { userId: string }) {
  const prisma = getPrismaClient();

  await prisma.tailorResumeChatThread.deleteMany({
    where: {
      urlHash: hashTailorResumeChatUrl(tailorResumeConfigChatThreadKey),
      userId: input.userId,
    },
  });

  return {
    messages: [],
  };
}

export async function submitTailorResumeConfigChat(input: {
  draftLatexCode: string;
  message: string;
  userId: string;
}): Promise<SubmitTailorResumeConfigChatResult> {
  const trimmedMessage = input.message.trim();

  if (!trimmedMessage) {
    throw new Error("Write a message first.");
  }

  if (trimmedMessage.length > maxTailorResumeChatMessageLength) {
    throw new Error(
      `Keep chat messages under ${maxTailorResumeChatMessageLength.toLocaleString()} characters.`,
    );
  }

  if (!input.draftLatexCode.trim()) {
    throw new Error("Upload or save a source resume before chatting.");
  }

  const prisma = getPrismaClient();
  const { rawProfile, lockedLinks } = await readTailorResumeProfileState(input.userId);
  const savedLatexCode = rawProfile.latex.code.trim();

  if (!savedLatexCode) {
    throw new Error("Upload or save a source resume before chatting.");
  }

  const thread = await prisma.tailorResumeChatThread.upsert({
    create: {
      pageTitle: tailorResumeConfigChatPageTitle,
      url: tailorResumeConfigChatThreadKey,
      urlHash: hashTailorResumeChatUrl(tailorResumeConfigChatThreadKey),
      userId: input.userId,
    },
    update: {
      pageTitle: tailorResumeConfigChatPageTitle,
      url: tailorResumeConfigChatThreadKey,
    },
    where: {
      userId_urlHash: {
        urlHash: hashTailorResumeChatUrl(tailorResumeConfigChatThreadKey),
        userId: input.userId,
      },
    },
  });
  const previousMessages = (
    await prisma.tailorResumeChatMessage.findMany({
      orderBy: { createdAt: "asc" },
      where: { threadId: thread.id },
    })
  ).map((message) => serializeTailorResumeConfigChatMessage(message));

  const createdUserMessages = await createTailorResumeConfigChatMessages({
    messages: [
      {
        blocks: [
          {
            text: trimmedMessage,
            type: "text",
          },
        ],
        model: null,
        role: "user",
      },
    ],
    threadId: thread.id,
    userId: input.userId,
  });

  const client = getOpenAIClient();
  const model =
    process.env.OPENAI_TAILOR_RESUME_CONFIG_CHAT_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5-mini";
  let currentAnnotatedLatex = normalizeTailorResumeLatex(
    input.draftLatexCode,
  ).annotatedLatex;
  let currentDraftLatexCode = stripTailorResumeSegmentIds(currentAnnotatedLatex);
  let previousResponseId: string | undefined;
  let responseInput: TailorResumeConfigChatResponseInput =
    buildTailorResumeConfigChatInput({
    currentDraftLatexCode,
    currentUserMessage: trimmedMessage,
    previousMessages,
    savedLatexCode,
  });
  const assistantMessagesToStore: TailorResumeConfigChatStoredMessageInput[] = [];
  let finalAssistantText = "";
  let lastModel = model;

  for (let toolRound = 1; toolRound <= maxConfigChatToolRounds; toolRound += 1) {
    const response = (await client.responses.create({
      input: responseInput,
      instructions: buildTailorResumeConfigChatInstructions(),
      model,
      parallel_tool_calls: false,
      previous_response_id: previousResponseId,
      tools: [
        {
          description:
            "Apply one or more direct block-scoped edits to the current source-resume working draft.",
          name: applySourceResumeBlockEditsToolName,
          parameters: {
            additionalProperties: false,
            properties: {
              changes: {
                items: {
                  additionalProperties: false,
                  properties: {
                    latexCode: { type: "string" },
                    reason: { type: "string" },
                    segmentId: { type: "string" },
                  },
                  required: ["segmentId", "latexCode", "reason"],
                  type: "object",
                },
                type: "array",
              },
            },
            required: ["changes"],
            type: "object",
          },
          strict: true,
          type: "function",
        },
        {
          description:
            "Compile the current working draft to a rendered PDF so you can visually inspect layout, page fit, spacing, and other formatting details.",
          name: inspectRenderedResumePdfToolName,
          parameters: {
            additionalProperties: false,
            properties: {
              reason: { type: "string" },
            },
            required: ["reason"],
            type: "object",
          },
          strict: true,
          type: "function",
        },
      ],
      text: {
        verbosity: "low",
      },
    })) as TailorResumeConfigChatResponse;

    previousResponseId = response.id;
    lastModel = response.model ?? model;

    const toolCall = findTailorResumeConfigChatToolCall(response);

    if (!toolCall) {
      finalAssistantText = readOutputText(response);
      break;
    }

    if (toolCall.name === applySourceResumeBlockEditsToolName) {
      const changes = parseApplySourceResumeBlockEditsArguments(
        JSON.parse(toolCall.arguments),
      );
      const nextAnnotatedLatex = applyTailorResumeBlockChanges({
        annotatedLatexCode: currentAnnotatedLatex,
        changes,
      }).annotatedLatex;

      currentAnnotatedLatex = nextAnnotatedLatex;
      currentDraftLatexCode = stripTailorResumeSegmentIds(nextAnnotatedLatex);
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: JSON.stringify({
            changedSegmentIds: changes.map((change) => change.segmentId),
            currentBlockCatalog: buildConfigChatBlockCatalog(nextAnnotatedLatex),
            currentVisibleText:
              renderTailoredResumeLatexToPlainText(currentDraftLatexCode),
            ok: true,
          }),
          type: "function_call_output" as const,
        },
      ];
      continue;
    }

    const preview = await buildTailorResumeSourcePreview({
      currentLinks: rawProfile.links,
      latexCode: currentDraftLatexCode,
      lockedLinks,
    });

    if (!preview.ok) {
      responseInput = [
        {
          call_id: toolCall.call_id,
          output: JSON.stringify({
            error: preview.error,
            ok: false,
          }),
          type: "function_call_output" as const,
        },
      ];
      continue;
    }

    const artifactId = randomUUID();
    const artifactLabel =
      preview.pageCount > 1
        ? `Rendered PDF (${preview.pageCount} pages)`
        : "Rendered PDF";

    await writeTailorResumeConfigChatArtifactPdf(
      input.userId,
      artifactId,
      preview.pdfBuffer,
    );

    assistantMessagesToStore.push({
      blocks: [
        {
          artifactId,
          label: artifactLabel,
          pageCount: preview.pageCount,
          type: "pdf",
        },
      ],
      model: lastModel,
      role: "assistant",
    });

    const uploadedFile = await client.files.create({
      file: await toFile(preview.pdfBuffer, "source-resume-preview.pdf", {
        type: "application/pdf",
      }),
      purpose: "user_data",
    });

    responseInput = [
      {
        call_id: toolCall.call_id,
        output: JSON.stringify({
          artifactId,
          label: artifactLabel,
          ok: true,
          pageCount: preview.pageCount,
        }),
        type: "function_call_output" as const,
      },
      {
        content: [
          {
            text:
              `The current rendered PDF is attached for visual inspection. ` +
              `It is ${preview.pageCount} page${
                preview.pageCount === 1 ? "" : "s"
              }. Review spacing, page fit, typography, and overall layout before deciding whether more edits are needed.`,
            type: "input_text" as const,
          },
          {
            file_id: uploadedFile.id,
            type: "input_file" as const,
          },
        ],
        role: "user" as const,
      },
    ];
  }

  const normalizedAssistantText = finalAssistantText.trim();

  assistantMessagesToStore.push({
    blocks: [
      {
        text:
          normalizedAssistantText ||
          (currentDraftLatexCode === input.draftLatexCode
            ? "Reviewed the working draft and did not make any changes."
            : "Updated the working draft."),
        type: "text",
      },
    ],
    model: lastModel,
    role: "assistant",
  });

  const createdAssistantMessages = await createTailorResumeConfigChatMessages({
    messages: assistantMessagesToStore,
    threadId: thread.id,
    userId: input.userId,
  });

  return {
    draftLatexCode: currentDraftLatexCode,
    messages: [...createdUserMessages, ...createdAssistantMessages],
  };
}
