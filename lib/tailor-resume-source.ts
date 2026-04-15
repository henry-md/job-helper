import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type {
  ResumeDocument,
  ResumeRichText,
  ResumeSegmentType,
  ResumeSubHeadLine,
  ResumeTextSegment,
  TailorResumeSourceDocument,
  TailorResumeSourceEntryItem,
  TailorResumeSourceItem,
  TailorResumeSourceLabeledLineItem,
  TailorResumeSourceParagraphItem,
  TailorResumeSourceSection,
  TailorResumeSourceSegment,
  TailorResumeSourceUnit,
  TailorResumeSourceUnitKind,
} from "./tailor-resume-types.ts";

const execFile = promisify(execFileCallback);

type DraftSourceSegment = Omit<TailorResumeSourceSegment, "id">;

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUrlForMatching(value: string) {
  return value
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function inferVisibleLinkUrl(text: string) {
  const value = text.trim();

  if (!value) {
    return null;
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return `mailto:${value}`;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(value)) {
    return value.startsWith("www.") ? `https://${value}` : `https://${value}`;
  }

  return null;
}

function takeMatchingPdfLink(text: string, availablePdfLinks: string[]) {
  const normalizedText = normalizeUrlForMatching(text);

  if (!normalizedText) {
    return null;
  }

  const matchIndex = availablePdfLinks.findIndex((url) => {
    const normalizedUrl = normalizeUrlForMatching(url);
    return (
      normalizedUrl === normalizedText ||
      normalizedUrl.startsWith(normalizedText) ||
      normalizedText.startsWith(normalizedUrl)
    );
  });

  if (matchIndex === -1) {
    return null;
  }

  const [matchedUrl] = availablePdfLinks.splice(matchIndex, 1);
  return matchedUrl ?? null;
}

function buildTextSegment(
  segment: ResumeTextSegment,
  options: {
    availablePdfLinks: string[];
    nextSegmentType: ResumeSegmentType | null;
    previousSegmentType: ResumeSegmentType | null;
  },
): DraftSourceSegment | null {
  const shouldTrimForSeparator =
    options.previousSegmentType === "separator_bullet" ||
    options.previousSegmentType === "separator_pipe" ||
    options.nextSegmentType === "separator_bullet" ||
    options.nextSegmentType === "separator_pipe";
  const text = shouldTrimForSeparator ? segment.text.trim() : segment.text;

  if (!text) {
    return null;
  }

  const matchingPdfLink = segment.isLinkStyle
    ? takeMatchingPdfLink(text, options.availablePdfLinks)
    : null;
  const inferredLink = segment.isLinkStyle ? inferVisibleLinkUrl(text) : null;
  const linkUrl = matchingPdfLink ?? inferredLink;

  return {
    isBold: segment.isBold,
    isItalic: segment.isItalic,
    isLinkStyle: segment.isLinkStyle || Boolean(linkUrl),
    isUnderline: segment.isLinkStyle || Boolean(linkUrl),
    linkUrl,
    segmentType: "text",
    text,
  };
}

function normalizeResumeSegments(
  segments: ResumeTextSegment[],
  availablePdfLinks: string[],
): DraftSourceSegment[] {
  const normalizedSegments: DraftSourceSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.segmentType === "separator_pipe") {
      normalizedSegments.push({
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        isUnderline: false,
        linkUrl: null,
        segmentType: "separator_pipe",
        text: "|",
      });
      continue;
    }

    if (segment.segmentType === "separator_bullet") {
      normalizedSegments.push({
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        isUnderline: false,
        linkUrl: null,
        segmentType: "separator_bullet",
        text: "•",
      });
      continue;
    }

    const nextSegmentType = segments[index + 1]?.segmentType ?? null;
    const previousSegmentType = segments[index - 1]?.segmentType ?? null;
    const normalizedSegment = buildTextSegment(segment, {
      availablePdfLinks,
      nextSegmentType,
      previousSegmentType,
    });

    if (normalizedSegment) {
      normalizedSegments.push(normalizedSegment);
    }
  }

  return normalizedSegments.length > 0
    ? normalizedSegments
    : [
        {
          isBold: false,
          isItalic: false,
          isLinkStyle: false,
          isUnderline: false,
          linkUrl: null,
          segmentType: "text",
          text: "",
        },
      ];
}

function flattenSubHeadLine(
  line: ResumeSubHeadLine,
  availablePdfLinks: string[],
) {
  const flattenedSegments: ResumeTextSegment[] = [];

  line.lineItems.forEach((lineItem, index) => {
    flattenedSegments.push(...lineItem.segments);

    if (index === line.lineItems.length - 1) {
      return;
    }

    if (line.separatorBetweenItems === "bullet") {
      flattenedSegments.push({
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        segmentType: "separator_bullet",
        text: "•",
      });
    }

    if (line.separatorBetweenItems === "pipe") {
      flattenedSegments.push({
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        segmentType: "separator_pipe",
        text: "|",
      });
    }
  });

  return normalizeResumeSegments(flattenedSegments, availablePdfLinks);
}

function createSourceUnit(
  id: string,
  kind: TailorResumeSourceUnitKind,
  segments: DraftSourceSegment[],
  indentLevel = 0,
): TailorResumeSourceUnit {
  return {
    id,
    indentLevel,
    kind,
    segments:
      segments.length > 0
        ? segments.map((segment, index) => ({
            ...segment,
            id: `${id}_seg_${String(index + 1).padStart(2, "0")}`,
          }))
        : [
            {
              id: `${id}_seg_01`,
              isBold: false,
              isItalic: false,
              isLinkStyle: false,
              isUnderline: false,
              linkUrl: null,
              segmentType: "text",
              text: "",
            },
          ],
  };
}

function readDraftSegmentText(segments: DraftSourceSegment[]) {
  return segments.map((segment) => segment.text).join("");
}

function splitAwardValueIntoLinkedTail(segments: DraftSourceSegment[]) {
  const nextSegments = [...segments];

  for (let index = nextSegments.length - 1; index >= 0; index -= 1) {
    const segment = nextSegments[index];

    if (segment.segmentType !== "text") {
      continue;
    }

    const markerIndex = segment.text.lastIndexOf(" for ");

    if (markerIndex === -1) {
      continue;
    }

    const prefixText = segment.text.slice(0, markerIndex + 5);
    const linkedText = segment.text.slice(markerIndex + 5);

    if (!linkedText.trim()) {
      return nextSegments;
    }

    const prefixSegment =
      prefixText.length > 0
        ? {
            ...segment,
            isLinkStyle: false,
            isUnderline: false,
            linkUrl: null,
            text: prefixText,
          }
        : null;
    const linkedSegment = {
      ...segment,
      isLinkStyle: true,
      isUnderline: true,
      text: linkedText,
    };

    return [
      ...nextSegments.slice(0, index),
      ...(prefixSegment ? [prefixSegment] : []),
      linkedSegment,
      ...nextSegments.slice(index + 1),
    ];
  }

  return nextSegments;
}

function applyProjectHeadingLink(
  segments: DraftSourceSegment[],
  linkUrl: string,
): DraftSourceSegment[] {
  let targetIndex = segments.findIndex(
    (segment) => segment.segmentType === "separator_pipe",
  );
  targetIndex =
    targetIndex === -1
      ? segments.findIndex((segment) => segment.segmentType === "text")
      : segments
          .slice(0, targetIndex)
          .findIndex((segment) => segment.segmentType === "text");

  if (targetIndex === -1) {
    return segments;
  }

  return segments.map((segment, index) =>
    index === targetIndex
      ? {
          ...segment,
          isLinkStyle: true,
          isUnderline: true,
          linkUrl,
        }
      : segment,
  );
}

function normalizeSectionKey(richText: ResumeRichText) {
  return collapseWhitespace(
    richText.segments.map((segment) => segment.text).join(""),
  ).toUpperCase();
}

function normalizeEntryItem(
  sectionKey: string,
  itemId: string,
  subSectionText: ResumeRichText,
  subSectionDates: ResumeRichText | null,
  subSectionDescription: ResumeDocument["sections"][number]["blocks"][number] extends infer T
    ? T extends { blockType: "entry"; subSectionDescription: infer U }
      ? U
      : never
    : never,
  subSectionBullets: ResumeDocument["sections"][number]["blocks"][number] extends infer T
    ? T extends { blockType: "entry"; subSectionBullets: infer U }
      ? U
      : never
    : never,
  availablePdfLinks: string[],
): TailorResumeSourceEntryItem {
  let headingSegments = normalizeResumeSegments(
    subSectionText.segments,
    availablePdfLinks,
  );

  if (
    sectionKey === "SOFTWARE PROJECTS" &&
    !headingSegments.some((segment) => segment.linkUrl || segment.isLinkStyle) &&
    availablePdfLinks.length > 0
  ) {
    const nextPdfLink = availablePdfLinks.shift();

    if (nextPdfLink) {
      headingSegments = applyProjectHeadingLink(headingSegments, nextPdfLink);
    }
  }

  return {
    bulletLines: subSectionBullets.map((bullet, index) =>
      createSourceUnit(
        `${itemId}_bullet_${String(index + 1).padStart(2, "0")}`,
        "bullet",
        normalizeResumeSegments(bullet.segments, availablePdfLinks),
        bullet.indentLevel,
      ),
    ),
    dates: subSectionDates
      ? createSourceUnit(
          `${itemId}_dates`,
          "entry_dates",
          normalizeResumeSegments(subSectionDates.segments, availablePdfLinks),
        )
      : null,
    descriptionLines: subSectionDescription.map((line, index) =>
      createSourceUnit(
        `${itemId}_description_${String(index + 1).padStart(2, "0")}`,
        "description_line",
        normalizeResumeSegments(line.segments, availablePdfLinks),
        line.indentLevel,
      ),
    ),
    heading: createSourceUnit(`${itemId}_heading`, "entry_heading", headingSegments),
    id: itemId,
    itemType: "entry",
  };
}

function normalizeParagraphItem(
  itemId: string,
  richText: ResumeRichText,
  indentLevel: number,
  availablePdfLinks: string[],
): TailorResumeSourceParagraphItem {
  return {
    content: createSourceUnit(
      `${itemId}_content`,
      "paragraph",
      normalizeResumeSegments(richText.segments, availablePdfLinks),
      indentLevel,
    ),
    id: itemId,
    itemType: "paragraph",
  };
}

function normalizeLabeledLineItem(
  sectionKey: string,
  itemId: string,
  label: ResumeRichText,
  value: ResumeRichText,
  availablePdfLinks: string[],
): TailorResumeSourceLabeledLineItem {
  let valueSegments = normalizeResumeSegments(value.segments, availablePdfLinks);
  const labelText = collapseWhitespace(readDraftSegmentText(
    normalizeResumeSegments(label.segments, []),
  )).toUpperCase();

  if (
    sectionKey === "EDUCATION" &&
    labelText.startsWith("AWARDS:") &&
    !valueSegments.some((segment) => segment.linkUrl || segment.isLinkStyle) &&
    availablePdfLinks.length > 0
  ) {
    const nextPdfLink = availablePdfLinks.shift();

    if (nextPdfLink) {
      valueSegments = splitAwardValueIntoLinkedTail(valueSegments).map(
        (segment, index, segments) =>
          index === segments.length - 1 && segment.segmentType === "text"
            ? {
                ...segment,
                isLinkStyle: true,
                isUnderline: true,
                linkUrl: nextPdfLink,
              }
            : segment,
      );
    }
  }

  return {
    id: itemId,
    itemType: "labeled_line",
    label: createSourceUnit(
      `${itemId}_label`,
      "labeled_line_label",
      normalizeResumeSegments(label.segments, availablePdfLinks),
    ),
    value: createSourceUnit(
      `${itemId}_value`,
      "labeled_line_value",
      valueSegments,
    ),
  };
}

function normalizeSection(
  section: ResumeDocument["sections"][number],
  sectionIndex: number,
  availablePdfLinks: string[],
): TailorResumeSourceSection {
  const sectionId = `section_${String(sectionIndex + 1).padStart(2, "0")}`;
  const sectionKey = normalizeSectionKey(section.sectionText);

  const items: TailorResumeSourceItem[] = section.blocks.map((block, blockIndex) => {
    const itemId = `${sectionId}_item_${String(blockIndex + 1).padStart(2, "0")}`;

    if (block.blockType === "entry") {
      return normalizeEntryItem(
        sectionKey,
        itemId,
        block.subSectionText,
        block.subSectionDates,
        block.subSectionDescription,
        block.subSectionBullets,
        availablePdfLinks,
      );
    }

    if (block.blockType === "labeled_line") {
      return normalizeLabeledLineItem(
        sectionKey,
        itemId,
        block.label,
        block.value,
        availablePdfLinks,
      );
    }

    return normalizeParagraphItem(
      itemId,
      { segments: block.content.segments },
      block.content.indentLevel,
      availablePdfLinks,
    );
  });

  return {
    id: sectionId,
    items,
    title: createSourceUnit(
      `${sectionId}_title`,
      "section_title",
      normalizeResumeSegments(section.sectionText.segments, availablePdfLinks),
    ),
  };
}

export function readSourceUnitText(unit: TailorResumeSourceUnit) {
  return unit.segments.map((segment) => segment.text).join("");
}

export async function extractPdfLinkUrls(filePath: string) {
  try {
    const { stdout } = await execFile("qpdf", ["--json", filePath], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    });
    const matches = stdout.matchAll(/"\/URI"\s*:\s*"u:([^"]+)"/g);

    return [...matches].map((match) => match[1] ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizeResumeDocument(
  document: ResumeDocument,
  options?: {
    pdfLinkUrls?: string[];
  },
): TailorResumeSourceDocument {
  const availablePdfLinks = [...(options?.pdfLinkUrls ?? [])];
  const headerName = createSourceUnit(
    "header_name",
    "header_name",
    normalizeResumeSegments(document.headerText.segments, availablePdfLinks),
  );
  const headerLines = document.subHeadText.map((line, index) =>
    createSourceUnit(
      `header_line_${String(index + 1).padStart(2, "0")}`,
      "header_line",
      flattenSubHeadLine(line, availablePdfLinks),
    ),
  );

  return {
    header: {
      id: "header",
      lines: headerLines,
      name: headerName,
    },
    sections: document.sections.map((section, sectionIndex) =>
      normalizeSection(section, sectionIndex, availablePdfLinks),
    ),
    version: 1,
  };
}
