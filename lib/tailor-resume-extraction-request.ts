import { fileBufferToDataUrl } from "./file-data-url.ts";
import {
  buildResumeLatexSystemPrompt,
  createDefaultSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import type { ResumeLatexRetryContext } from "./tailor-resume-extraction-loop.ts";
import { extractResumeLatexLinks } from "./tailor-resume-link-validation.ts";
import type { ExtractedTailorResumeLink } from "./tailor-resume-links.ts";
import type { EmbeddedPdfLink } from "./tailor-resume-pdf-links.ts";
import type { TailorResumeLinkRecord } from "./tailor-resume-types";

type ResumeExtractionMessageContent =
  | {
      type: "input_file";
      file_id: string;
    }
  | {
      detail: "high";
      image_url: string;
      type: "input_image";
    }
  | {
      text: string;
      type: "input_text";
    };

function buildKnownResumeLinksText(knownLinks: TailorResumeLinkRecord[]) {
  const resolvedLinks = knownLinks.filter(
    (link) => !link.disabled && typeof link.url === "string",
  );
  const lockedResolvedLinks = resolvedLinks.filter((link) => link.locked);
  const unlockedResolvedLinks = resolvedLinks.filter((link) => !link.locked);
  const disabledLinks = knownLinks.filter((link) => link.disabled);

  if (
    lockedResolvedLinks.length === 0 &&
    unlockedResolvedLinks.length === 0 &&
    disabledLinks.length === 0
  ) {
    return null;
  }

  const lockedResolvedLines = lockedResolvedLinks.map(
    (link) => `- ${link.label} -> ${link.url}`,
  );
  const resolvedLines = unlockedResolvedLinks.map(
    (link) => `- ${link.label} -> ${link.url}`,
  );
  const disabledLines = disabledLinks.map((link) => `- ${link.label}`);

  return [
    ...(lockedResolvedLines.length > 0
      ? [
          "Locked saved link destinations for this resume:",
          ...lockedResolvedLines,
          "These label-to-destination pairs were explicitly locked by the user. When the same visible label appears, use exactly this destination.",
        ]
      : []),
    ...(resolvedLines.length > 0
      ? [
          "Known saved link destinations for this resume:",
          ...resolvedLines,
          "Reuse these exact destinations when the visible label clearly matches.",
        ]
      : []),
    ...(disabledLines.length > 0
      ? [
          "Saved labels that must remain plain text and must not be linked:",
          ...disabledLines,
          "For these labels, remove \\href and link-only styling such as \\tightul.",
        ]
      : []),
  ].join("\n");
}

function buildEmbeddedPdfLinksText(embeddedPdfLinks: EmbeddedPdfLink[]) {
  const uniqueLinks: EmbeddedPdfLink[] = [];
  const seenUrls = new Set<string>();

  for (const link of embeddedPdfLinks) {
    if (seenUrls.has(link.url)) {
      continue;
    }

    seenUrls.add(link.url);
    uniqueLinks.push(link);
  }

  if (uniqueLinks.length === 0) {
    return null;
  }

  const lines = uniqueLinks.map((link) => `- page ${link.pageNumber}: ${link.url}`);

  return [
    "Embedded PDF link destinations recovered from the uploaded resume:",
    ...lines,
    "Match these destinations to visible link text only when you are confident.",
  ].join("\n");
}

export function buildExtractedResumeLinksFromLatex(latexCode: string) {
  return extractResumeLatexLinks(latexCode).map<ExtractedTailorResumeLink>((link) => ({
    label: link.displayText?.trim() || link.url,
    url: link.url,
  }));
}

export function buildResumeLatexInstructions(input: {
  attempt: number;
  maxAttempts: number;
  promptSettings?: SystemPromptSettings;
}) {
  return buildResumeLatexSystemPrompt(
    input.promptSettings ?? createDefaultSystemPromptSettings(),
    {
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
    },
  );
}

function buildResumeSourceContent(
  input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
  uploadedFileId: string | null,
  context: {
    embeddedPdfLinks: EmbeddedPdfLink[];
    knownLinks: TailorResumeLinkRecord[];
  },
) {
  if (!input.mimeType.startsWith("image/") && !uploadedFileId) {
    throw new Error("Unable to upload the resume file for extraction.");
  }

  const knownResumeLinksText = buildKnownResumeLinksText(context.knownLinks);
  const embeddedPdfLinksText = buildEmbeddedPdfLinksText(context.embeddedPdfLinks);
  const content: ResumeExtractionMessageContent[] = [];

  if (knownResumeLinksText) {
    content.push({
      type: "input_text",
      text: knownResumeLinksText,
    });
  }

  if (embeddedPdfLinksText) {
    content.push({
      type: "input_text",
      text: embeddedPdfLinksText,
    });
  }

  if (input.mimeType.startsWith("image/")) {
    content.push({
      type: "input_text",
      text: `Resume image: ${input.filename} (${input.mimeType}).`,
    });
    content.push({
      type: "input_image",
      image_url: fileBufferToDataUrl(input.buffer, input.mimeType),
      detail: "high",
    });

    return content;
  }

  if (!uploadedFileId) {
    throw new Error("Unable to upload the resume file for extraction.");
  }

  content.push({
    type: "input_text",
    text: `Resume file: ${input.filename} (${input.mimeType}).`,
  });
  content.push({
    type: "input_file",
    file_id: uploadedFileId,
  });

  return content;
}

function buildRetryFailedLinksText(
  failedLinks: ResumeLatexRetryContext["failedLinks"],
) {
  if (failedLinks.length === 0) {
    return null;
  }

  return [
    "Known failed links from the previous validation:",
    ...failedLinks.map((failedLink) => {
      const label = failedLink.displayText?.trim() || "(missing visible label)";
      const url = failedLink.url.trim();
      const reason = failedLink.reason?.trim() || "No reason was provided.";
      return `- ${label} -> ${url}: ${reason}`;
    }),
  ].join("\n");
}

export function buildResumeExtractionInput(
  input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
  uploadedFileId: string | null,
  context: {
    embeddedPdfLinks: EmbeddedPdfLink[];
    knownLinks: TailorResumeLinkRecord[];
  },
) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            "Extract this resume into LaTeX using the preferred template as closely as possible. Preserve all content and keep the document faithful to the uploaded resume. Return every visible link/contact label in the tool call's links array, and set url to null whenever the destination is uncertain.",
        },
        ...buildResumeSourceContent(input, uploadedFileId, context),
      ],
    },
  ];
}

export function buildResumeRetryInput(
  input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
  uploadedFileId: string | null,
  context: {
    embeddedPdfLinks: EmbeddedPdfLink[];
    knownLinks: TailorResumeLinkRecord[];
  },
  retryContext: ResumeLatexRetryContext,
) {
  const failedLinksText = buildRetryFailedLinksText(retryContext.failedLinks);
  const previousResumeLinksText =
    retryContext.previousResumeLinks.length > 0
      ? [
          "Links array returned with the previous LaTeX draft:",
          JSON.stringify(retryContext.previousResumeLinks, null, 2),
        ].join("\n")
      : null;
  const previousOutputText =
    retryContext.previousLatexCode?.trim()
      ? `Previous generated LaTeX from your last model call:\n\`\`\`latex\n${retryContext.previousLatexCode}\n\`\`\``
      : retryContext.previousModelOutput?.trim()
        ? `The previous model output could not be parsed into a usable LaTeX document. Raw prior output:\n\`\`\`\n${retryContext.previousModelOutput}\n\`\`\``
        : null;

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text:
            `Retry attempt ${String(retryContext.attempt + 1)} of ${String(
              retryContext.attempt + retryContext.remainingAttempts,
            )}.\n\n` +
            "Goal: convert the original uploaded resume into a complete standalone LaTeX document that preserves every visible word and compiles with pdflatex. The original resume is attached again below so you can compare against it directly.",
        },
        ...buildResumeSourceContent(input, uploadedFileId, context),
        {
          type: "input_text" as const,
          text:
            `The previous attempt failed with this exact validation error:\n${retryContext.error}\n\n` +
            "Edit the previous LaTeX draft surgically, fix the exact problem, and then verify the rest of the document carefully before validating again. Return the full standalone document again, not a diff and not only the changed sections. Keep every bullet fully intact and never crop a bullet to only its first sentence.",
        },
        ...(failedLinksText
          ? [
              {
                type: "input_text" as const,
                text: failedLinksText,
              },
            ]
          : []),
        ...(previousResumeLinksText
          ? [
              {
                type: "input_text" as const,
                text: previousResumeLinksText,
              },
            ]
          : []),
        ...(previousOutputText
          ? [
              {
                type: "input_text" as const,
                text: previousOutputText,
              },
            ]
          : []),
      ],
    },
  ];
}
