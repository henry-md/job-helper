import { fileBufferToDataUrl } from "./file-data-url.ts";
import type { ResumeLatexRetryContext } from "./tailor-resume-extraction-loop.ts";
import { extractResumeLatexLinks } from "./tailor-resume-link-validation.ts";
import {
  tailorResumeLatexExample,
  tailorResumeLatexTemplate,
} from "./tailor-resume-latex-example.ts";
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
}) {
  const retryInstructions =
    input.attempt > 1
      ? `Retry attempt ${String(input.attempt)} of ${String(input.maxAttempts)}:
- The retry input includes the original uploaded resume again plus the full LaTeX draft that was the output of your last model call.
- Treat that prior LaTeX as the draft to edit surgically rather than starting over from scratch, unless a larger rewrite is absolutely necessary to stay faithful to the source resume.
- Fix the exact reported validation error first, then review the rest of the document for any other compile or link problems before you call validate_resume_latex again.
- Return the full standalone LaTeX document again from \\documentclass through \\end{document}. Never return only the changed snippets, never return a partial document, and never shorten bullets to their first sentence.
- Preserve the full text of every bullet and every sentence from the source resume even if you are only making a small localized fix.

`
      : "";

  return `${retryInstructions}Convert the provided resume into a complete standalone LaTeX document. Preserve every word from the resume exactly as written whenever it is legible. Never summarize, shorten, compress, or omit text. In particular, never truncate bullets to their first sentence. Keep the original section order and keep all bullets, dates, headings, labeled lines, links, and separators. Preserve visible bold, italics, underlines, bullet structure, and link styling when possible. Return a full LaTeX document from \\documentclass through \\end{document} that compiles with pdflatex. Prefer the exact template and macro vocabulary shown below. Use only standard LaTeX plus the packages already present in that template unless absolutely necessary. Inline formatting such as \\textbf, \\textit, \\tightul, and \\href may appear anywhere inside macro arguments when needed.

Pay particular attention to these details because they are easy to get wrong:
1. Header: match the centered header structure from the reference example, including how the name is centered and how the contact lines are centered beneath it.
2. Education section: match the alignment pattern in the reference example, especially the left/right tabular alignment for school and dates, plus the indented follow-up lines below it.
3. Technical skills section: do not align the text like the education section. Follow the reference example where each skills line continues naturally after the colon using the hanging-indent style rather than trying to force tabular left/right alignment.
4. Bolding: pay special attention to what is visibly bolded in the uploaded image and reproduce that emphasis faithfully in LaTeX. Do not flatten bold emphasis, and do not assume only headings are bold; important phrases inside bullets, links, labels, names, and other inline fragments may need \\textbf{} as shown by the source image.
5. Vertical spacing: pay close attention to the tight vertical spacing in the source image and the reference example. Use small spacing adjustments, including negative \\vspace{...} values when appropriate, to pull sections closer together and match the visual density of the original resume, especially between the centered header and the first section and around section transitions. Avoid leaving the document with loose default spacing when the source image is visibly tighter.
6. Unicode safety: do not emit unsupported raw Unicode glyphs such as replacement characters or private-use characters. Replace them with LaTeX-safe ASCII or explicit LaTeX commands.
7. Link fidelity: only preserve hyperlink styling when the destination is explicitly supported by the visible resume content, saved known links, or embedded PDF link metadata. If a destination fails validation or the visible text does not support a specific target, keep the visible text but remove \\href and link-only styling such as \\tightul instead of guessing a replacement.
8. Deleted links: if saved context says a label should remain plain text, do not recreate a hyperlink for it even if the label looks like a valid URL.
9. Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).

Tool workflow:
- Use the validate_resume_latex tool every time you draft or revise the full document.
- Pass the complete standalone LaTeX document in the tool argument latexCode.
- Always include a complete links array in the tool call. Each entry must describe one visible resume link or contact destination using { "label": "...", "url": "..." | null }.
- Use the exact visible link text or label for links[].label whenever possible. If you are not confident about the destination URL, set links[].url to null.
- The tool validates both pdflatex compilation and extracted hyperlinks.
- If the tool reports a compile error or failed links, fix that exact issue while preserving the resume content. For failed links, preserve the visible text, remove hyperlink-specific styling, and keep the affected entry in links with url set to null instead of inventing a destination.
- Never add link-style formatting when the destination does not resolve confidently.
- Stop as soon as the tool reports success. You have at most ${String(input.maxAttempts)} validation attempts.

Preferred template:

${tailorResumeLatexTemplate}

Reference example:

${tailorResumeLatexExample}`;
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
