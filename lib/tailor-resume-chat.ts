import { createHash } from "node:crypto";
import OpenAI from "openai";
import { getPrismaClient } from "./prisma.ts";
import { buildTailorResumePlanningSnapshot } from "./tailor-resume-planning.ts";
import { readTailorResumeProfileState } from "./tailor-resume-profile-state.ts";
import {
  defaultTailorResumeUserMarkdown,
  readTailorResumeUserMarkdown,
} from "./tailor-resume-user-memory.ts";

export const maxTailorResumeChatMessageLength = 8_000;

const maxStoredPageUrlLength = 8_000;
const maxChatHistoryMessagesForModel = 18;
const maxJobPageSummaryLength = 26_000;
const maxResumePlainTextLength = 26_000;
const maxUserMarkdownContextLength = 20_000;

export type TailorResumeChatRole = "assistant" | "user";

export type TailorResumeChatMessageRecord = {
  content: string;
  createdAt: string;
  id: string;
  model: string | null;
  role: TailorResumeChatRole;
};

export type TailorResumeChatPageContext = {
  canonicalUrl: string;
  companyCandidates: string[];
  description: string;
  employmentTypeCandidates: string[];
  headings: string[];
  jsonLdJobPostings: Array<{
    baseSalary: string[];
    datePosted: string | null;
    description: string | null;
    directApply: boolean | null;
    employmentType: string[];
    hiringOrganization: string | null;
    identifier: string | null;
    locations: string[];
    title: string | null;
    validThrough: string | null;
  }>;
  locationCandidates: string[];
  rawText: string;
  salaryMentions: string[];
  selectionText: string;
  siteName: string;
  title: string;
  titleCandidates: string[];
  topTextBlocks: string[];
  url: string;
};

type StoredChatMessage = {
  content: string;
  createdAt: Date;
  id: string;
  model: string | null;
  role: "ASSISTANT" | "USER";
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to your environment before using chat.",
    );
  }

  return new OpenAI({ apiKey });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, maxLength = 0) {
  const stringValue = typeof value === "string" ? value.trim() : "";

  if (maxLength > 0 && stringValue.length > maxLength) {
    return stringValue.slice(0, maxLength);
  }

  return stringValue;
}

function readNullableString(value: unknown, maxLength = 0) {
  const stringValue = readString(value, maxLength);

  return stringValue || null;
}

function readStringArray(value: unknown, limit: number, maxEntryLength = 400) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry, maxEntryLength))
    .filter(Boolean)
    .slice(0, limit);
}

function readStructuredJobPostings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      return [
        {
          baseSalary: readStringArray(entry.baseSalary, 4),
          datePosted: readNullableString(entry.datePosted, 80),
          description: readNullableString(entry.description, 3_000),
          directApply:
            typeof entry.directApply === "boolean" ? entry.directApply : null,
          employmentType: readStringArray(entry.employmentType, 6),
          hiringOrganization: readNullableString(entry.hiringOrganization, 300),
          identifier: readNullableString(entry.identifier, 300),
          locations: readStringArray(entry.locations, 8),
          title: readNullableString(entry.title, 300),
          validThrough: readNullableString(entry.validThrough, 80),
        },
      ];
    })
    .slice(0, 4);
}

export function readTailorResumeChatPageContext(
  value: unknown,
): TailorResumeChatPageContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const url = readString(value.url, maxStoredPageUrlLength);

  if (!url) {
    return null;
  }

  return {
    canonicalUrl: readString(value.canonicalUrl, maxStoredPageUrlLength),
    companyCandidates: readStringArray(value.companyCandidates, 10),
    description: readString(value.description, 2_000),
    employmentTypeCandidates: readStringArray(value.employmentTypeCandidates, 10),
    headings: readStringArray(value.headings, 16),
    jsonLdJobPostings: readStructuredJobPostings(value.jsonLdJobPostings),
    locationCandidates: readStringArray(value.locationCandidates, 10),
    rawText: readString(value.rawText, 24_000),
    salaryMentions: readStringArray(value.salaryMentions, 10),
    selectionText: readString(value.selectionText, 3_000),
    siteName: readString(value.siteName, 300),
    title: readString(value.title, 300),
    titleCandidates: readStringArray(value.titleCandidates, 10),
    topTextBlocks: readStringArray(value.topTextBlocks, 8, 2_000),
    url,
  };
}

export function normalizeTailorResumeChatUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    const url = new URL(trimmedValue);

    url.hash = "";

    return url.toString().slice(0, maxStoredPageUrlLength);
  } catch {
    return trimmedValue.slice(0, maxStoredPageUrlLength);
  }
}

export function hashTailorResumeChatUrl(url: string) {
  return createHash("sha256").update(url).digest("hex");
}

export function serializeTailorResumeChatMessage(
  message: StoredChatMessage,
): TailorResumeChatMessageRecord {
  return {
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    model: message.model,
    role: message.role === "ASSISTANT" ? "assistant" : "user",
  };
}

function truncateWithNotice(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[Context truncated for length.]`;
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = value.replace(/\s+/g, " ").trim();

    if (!normalizedValue) {
      continue;
    }

    const key = normalizedValue.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalizedValue);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildSummaryLine(label: string, values: string[], limit = 8) {
  const normalizedValues = uniqueStrings(values, limit);

  if (normalizedValues.length === 0) {
    return null;
  }

  return `${label}: ${normalizedValues.join(", ")}`;
}

function formatStructuredPosting(
  posting: TailorResumeChatPageContext["jsonLdJobPostings"][number],
  index: number,
) {
  const lines = [
    posting.title ? `Title: ${posting.title}` : null,
    posting.hiringOrganization ? `Company: ${posting.hiringOrganization}` : null,
    buildSummaryLine("Employment type", posting.employmentType),
    buildSummaryLine("Locations", posting.locations),
    buildSummaryLine("Compensation", posting.baseSalary),
    posting.datePosted ? `Date posted: ${posting.datePosted}` : null,
    posting.validThrough ? `Valid through: ${posting.validThrough}` : null,
    posting.directApply === true
      ? "Direct apply: yes"
      : posting.directApply === false
        ? "Direct apply: no"
        : null,
    posting.description ? `Description:\n${posting.description}` : null,
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return null;
  }

  return [`Structured job posting ${index + 1}:`, ...lines].join("\n");
}

function buildSkimmedJobPageContext(pageContext: TailorResumeChatPageContext) {
  const sections: string[] = [];
  const summaryLines = [
    pageContext.url ? `URL: ${pageContext.url}` : null,
    pageContext.canonicalUrl && pageContext.canonicalUrl !== pageContext.url
      ? `Canonical URL: ${pageContext.canonicalUrl}`
      : null,
    pageContext.title ? `Page title: ${pageContext.title}` : null,
    pageContext.siteName ? `Site name: ${pageContext.siteName}` : null,
    pageContext.description
      ? `Meta description: ${pageContext.description}`
      : null,
    buildSummaryLine("Role title hints", pageContext.titleCandidates),
    buildSummaryLine("Company hints", pageContext.companyCandidates),
    buildSummaryLine("Location hints", pageContext.locationCandidates),
    buildSummaryLine(
      "Employment type hints",
      pageContext.employmentTypeCandidates,
    ),
    buildSummaryLine("Salary hints", pageContext.salaryMentions),
    buildSummaryLine("Visible headings", pageContext.headings, 14),
  ].filter((line): line is string => Boolean(line));

  if (summaryLines.length > 0) {
    sections.push(["Job page summary:", ...summaryLines].join("\n"));
  }

  if (pageContext.selectionText) {
    sections.push(`Selected page text:\n${pageContext.selectionText}`);
  }

  const structuredPostings = pageContext.jsonLdJobPostings
    .map(formatStructuredPosting)
    .filter((section): section is string => Boolean(section));

  if (structuredPostings.length > 0) {
    sections.push(structuredPostings.join("\n\n"));
  }

  const topTextBlocks = uniqueStrings(pageContext.topTextBlocks, 5);

  if (topTextBlocks.length > 0) {
    sections.push(
      [
        "Main visible page sections:",
        ...topTextBlocks.map(
          (block, index) => `Section ${index + 1}:\n${block}`,
        ),
      ].join("\n\n"),
    );
  }

  if (pageContext.rawText) {
    sections.push(`Flattened page text:\n${pageContext.rawText}`);
  }

  return truncateWithNotice(sections.join("\n\n").trim(), maxJobPageSummaryLength);
}

function isMeaningfulUserMarkdown(markdown: string) {
  const withoutDefaultHeading = markdown
    .replace(defaultTailorResumeUserMarkdown, "")
    .replace(/^#\s*USER\.md\s*/i, "")
    .trim();

  return withoutDefaultHeading.length > 0;
}

async function buildResumePlainText(userId: string) {
  const { rawProfile } = await readTailorResumeProfileState(userId);
  const annotatedLatexCode =
    rawProfile.annotatedLatex.code.trim() || rawProfile.latex.code.trim();

  if (!annotatedLatexCode) {
    return "";
  }

  const planningSnapshot = buildTailorResumePlanningSnapshot(annotatedLatexCode);

  return truncateWithNotice(
    planningSnapshot.resumePlainText.trim(),
    maxResumePlainTextLength,
  );
}

async function buildUserMarkdownContext(userId: string) {
  const userMarkdown = await readTailorResumeUserMarkdown(userId);

  if (!isMeaningfulUserMarkdown(userMarkdown.markdown)) {
    return "";
  }

  return truncateWithNotice(
    userMarkdown.markdown.trim(),
    maxUserMarkdownContextLength,
  );
}

function buildConversationTranscript(input: {
  currentUserMessage: string;
  previousMessages: TailorResumeChatMessageRecord[];
}) {
  const messages = [
    ...input.previousMessages,
    {
      content: input.currentUserMessage,
      createdAt: new Date().toISOString(),
      id: "current",
      model: null,
      role: "user" as const,
    },
  ];

  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `${speaker}: ${message.content.trim()}`;
    })
    .join("\n\n");
}

function buildTailorResumeChatInstructions() {
  return [
    "You are Job Helper Chat, a concise job-search copilot inside a Chrome extension side panel.",
    "Answer using the supplied current job page context, the user's base resume plaintext, and USER.md memory when it is provided.",
    "Keep advice grounded. If a fact is not in the page, resume, or USER.md, say what is missing instead of inventing it.",
    "When discussing fit or whether to apply, distinguish required qualifications from preferred qualifications. Pay special attention to degree requirements such as BS, MS, PhD, equivalent experience, and graduation timing.",
    "If the user asks whether the role is worth applying to, start with a 0-100 confidence score where 100 means the user looks ideal and 50 means it is genuinely ambiguous whether the application is worth the user's time.",
    "Prefer short, skimmable answers. Use bullets only when they improve clarity.",
  ].join("\n");
}

function buildTailorResumeChatInput(input: {
  currentUserMessage: string;
  jobPageContext: string;
  previousMessages: TailorResumeChatMessageRecord[];
  resumePlainText: string;
  userMarkdown: string;
}) {
  const contextSections = [
    `Current job page context:\n${input.jobPageContext || "[No page text was captured.]"}`,
    `Base resume plaintext:\n${
      input.resumePlainText || "[No base resume plaintext is available.]"
    }`,
    input.userMarkdown ? `USER.md memory:\n${input.userMarkdown}` : null,
    `Conversation:\n${buildConversationTranscript({
      currentUserMessage: input.currentUserMessage,
      previousMessages: input.previousMessages,
    })}`,
  ].filter((section): section is string => Boolean(section));

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: contextSections.join("\n\n---\n\n"),
        },
      ],
    },
  ];
}

export async function readTailorResumeChatForUrl(input: {
  url: string;
  userId: string;
}) {
  const normalizedUrl = normalizeTailorResumeChatUrl(input.url);
  const prisma = getPrismaClient();
  const thread = await prisma.tailorResumeChatThread.findUnique({
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    where: {
      userId_urlHash: {
        urlHash: hashTailorResumeChatUrl(normalizedUrl),
        userId: input.userId,
      },
    },
  });

  return {
    messages:
      thread?.messages.map((message) =>
        serializeTailorResumeChatMessage(message),
      ) ?? [],
    pageTitle: thread?.pageTitle ?? null,
    url: normalizedUrl,
  };
}

export async function deleteTailorResumeChatForUrl(input: {
  url: string;
  userId: string;
}) {
  const normalizedUrl = normalizeTailorResumeChatUrl(input.url);
  const prisma = getPrismaClient();

  await prisma.tailorResumeChatThread.deleteMany({
    where: {
      urlHash: hashTailorResumeChatUrl(normalizedUrl),
      userId: input.userId,
    },
  });

  return {
    messages: [],
    pageTitle: null,
    url: normalizedUrl,
  };
}

export async function createTailorResumeChatUserTurn(input: {
  content: string;
  pageTitle: string | null;
  url: string;
  userId: string;
}) {
  const normalizedUrl = normalizeTailorResumeChatUrl(input.url);
  const prisma = getPrismaClient();
  const urlHash = hashTailorResumeChatUrl(normalizedUrl);
  const thread = await prisma.tailorResumeChatThread.upsert({
    create: {
      pageTitle: input.pageTitle,
      url: normalizedUrl,
      urlHash,
      userId: input.userId,
    },
    update: {
      pageTitle: input.pageTitle,
      url: normalizedUrl,
    },
    where: {
      userId_urlHash: {
        urlHash,
        userId: input.userId,
      },
    },
  });
  const previousMessages = await prisma.tailorResumeChatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: maxChatHistoryMessagesForModel,
    where: { threadId: thread.id },
  });
  const userMessage = await prisma.tailorResumeChatMessage.create({
    data: {
      content: input.content,
      role: "USER",
      threadId: thread.id,
      userId: input.userId,
    },
  });

  return {
    previousMessages: previousMessages
      .reverse()
      .map((message) => serializeTailorResumeChatMessage(message)),
    threadId: thread.id,
    userMessage: serializeTailorResumeChatMessage(userMessage),
  };
}

export async function createTailorResumeChatAssistantMessage(input: {
  content: string;
  model: string | null;
  pageTitle: string | null;
  threadId: string;
  url: string;
  userId: string;
}) {
  const prisma = getPrismaClient();
  const assistantMessage = await prisma.tailorResumeChatMessage.create({
    data: {
      content: input.content,
      model: input.model,
      role: "ASSISTANT",
      threadId: input.threadId,
      userId: input.userId,
    },
  });

  await prisma.tailorResumeChatThread.update({
    data: {
      pageTitle: input.pageTitle,
      url: normalizeTailorResumeChatUrl(input.url),
    },
    where: { id: input.threadId },
  });

  return serializeTailorResumeChatMessage(assistantMessage);
}

export async function generateTailorResumeChatResponse(input: {
  currentUserMessage: string;
  onDelta: (delta: string) => void | Promise<void>;
  pageContext: TailorResumeChatPageContext;
  previousMessages: TailorResumeChatMessageRecord[];
  signal?: AbortSignal;
  userId: string;
}) {
  const [resumePlainText, userMarkdown] = await Promise.all([
    buildResumePlainText(input.userId),
    buildUserMarkdownContext(input.userId),
  ]);
  const client = getOpenAIClient();
  const model = process.env.OPENAI_TAILOR_RESUME_CHAT_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5-mini";
  const stream = client.responses.stream(
    {
      input: buildTailorResumeChatInput({
        currentUserMessage: input.currentUserMessage,
        jobPageContext: buildSkimmedJobPageContext(input.pageContext),
        previousMessages: input.previousMessages,
        resumePlainText,
        userMarkdown,
      }),
      instructions: buildTailorResumeChatInstructions(),
      model,
      text: {
        verbosity: "low",
      },
    },
    input.signal ? { signal: input.signal } : undefined,
  );
  const finalResponsePromise = stream.finalResponse();
  let content = "";

  for await (const event of stream) {
    if (event.type !== "response.output_text.delta") {
      continue;
    }

    if (!event.delta) {
      continue;
    }

    content += event.delta;
    await input.onDelta(event.delta);
  }

  const finalResponse = await finalResponsePromise;
  const finalOutputText =
    typeof finalResponse.output_text === "string" ? finalResponse.output_text : "";
  const finalContent = (content || finalOutputText).trim();

  if (!finalContent) {
    throw new Error("The chat model returned an empty response.");
  }

  return {
    content: finalContent,
    model: (finalResponse as { model?: string }).model ?? model,
  };
}
