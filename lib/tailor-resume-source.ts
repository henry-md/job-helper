import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type {
  ResumeDocument,
  ResumeRichText,
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

function normalizeProvidedLinkUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  if (
    /^https?:\/\//i.test(trimmedValue) ||
    /^mailto:/i.test(trimmedValue) ||
    /^tel:/i.test(trimmedValue)
  ) {
    return trimmedValue;
  }

  return inferVisibleLinkUrl(trimmedValue) ?? trimmedValue;
}

function isPipeSeparatorText(value: string) {
  return value.trim() === "|";
}

function isBulletSeparatorText(value: string) {
  return value.trim() === "•";
}

function isInlineSeparatorText(value: string) {
  return isPipeSeparatorText(value) || isBulletSeparatorText(value);
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

function splitResumeTextSegment(segment: ResumeTextSegment) {
  const rawParts = segment.text.split(/([|•])/g).filter((part) => part.length > 0);

  return rawParts.map((part) =>
    isInlineSeparatorText(part)
      ? {
          ...segment,
          isBold: false,
          isItalic: false,
          isLinkStyle: false,
          linkUrl: null,
          text: part,
        }
      : {
          ...segment,
          text: part,
        },
  );
}

function buildTextSegment(
  segment: ResumeTextSegment,
  availablePdfLinks: string[],
): DraftSourceSegment | null {
  const isInlineSeparator = isInlineSeparatorText(segment.text);
  const text = isInlineSeparator ? segment.text.trim() : segment.text;

  if (!text) {
    return null;
  }

  const providedLinkUrl = normalizeProvidedLinkUrl(segment.linkUrl);
  const matchingPdfLink = segment.isLinkStyle && !providedLinkUrl
    ? takeMatchingPdfLink(text, availablePdfLinks)
    : null;
  const inferredLink = segment.isLinkStyle ? inferVisibleLinkUrl(text) : null;
  const linkUrl = isInlineSeparator
    ? null
    : providedLinkUrl ?? matchingPdfLink ?? inferredLink;

  return {
    isBold: isInlineSeparator ? false : segment.isBold,
    isItalic: isInlineSeparator ? false : segment.isItalic,
    isLinkStyle: isInlineSeparator ? false : segment.isLinkStyle || Boolean(linkUrl),
    isUnderline: isInlineSeparator ? false : segment.isLinkStyle || Boolean(linkUrl),
    linkUrl,
    segmentType: "text",
    text,
  };
}

function normalizeResumeSegments(
  segments: ResumeTextSegment[],
  availablePdfLinks: string[],
): DraftSourceSegment[] {
  const normalizedSegments = segments
    .flatMap((segment) => splitResumeTextSegment(segment))
    .map((segment) => buildTextSegment(segment, availablePdfLinks))
    .filter((segment): segment is DraftSourceSegment => segment !== null);

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
        linkUrl: null,
        segmentType: "text",
        text: "•",
      });
    }

    if (line.separatorBetweenItems === "pipe") {
      flattenedSegments.push({
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        linkUrl: null,
        segmentType: "text",
        text: "|",
      });
    }
  });

  return normalizeResumeSegments(flattenedSegments, availablePdfLinks);
}

function normalizeSubHeadLineUnits(
  lines: ResumeSubHeadLine[],
  availablePdfLinks: string[],
) {
  const normalizedLines: DraftSourceSegment[][] = [];

  lines.forEach((line) => {
    if (line.separatorBetweenItems === null && line.lineItems.length > 1) {
      line.lineItems.forEach((lineItem) => {
        normalizedLines.push(
          normalizeResumeSegments(lineItem.segments, availablePdfLinks),
        );
      });
      return;
    }

    normalizedLines.push(flattenSubHeadLine(line, availablePdfLinks));
  });

  return normalizedLines.map((segments, index) =>
    createSourceUnit(
      `sub_head_line_${String(index + 1).padStart(2, "0")}`,
      "sub_head_line",
      segments,
    ),
  );
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

function joinDraftSegmentGroupsWithSpaces(groups: DraftSourceSegment[][]) {
  const nonEmptyGroups = groups.filter(
    (group) => readDraftSegmentText(group).trim().length > 0,
  );

  if (nonEmptyGroups.length === 0) {
    return [] as DraftSourceSegment[];
  }

  return nonEmptyGroups.flatMap((group, index) =>
    index === 0
      ? group
      : [
          {
            isBold: false,
            isItalic: false,
            isLinkStyle: false,
            isUnderline: false,
            linkUrl: null,
            segmentType: "text" as const,
            text: " ",
          },
          ...group,
        ],
  );
}

function splitAwardValueIntoLinkedTail(segments: DraftSourceSegment[]) {
  const nextSegments = [...segments];

  for (let index = nextSegments.length - 1; index >= 0; index -= 1) {
    const segment = nextSegments[index];

    if (isInlineSeparatorText(segment.text)) {
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
  let targetIndex = segments.findIndex((segment) => isPipeSeparatorText(segment.text));
  targetIndex =
    targetIndex === -1
      ? segments.findIndex(
          (segment) => !isInlineSeparatorText(segment.text) && segment.text.trim().length > 0,
        )
      : segments
          .slice(0, targetIndex)
          .findIndex(
            (segment) =>
              !isInlineSeparatorText(segment.text) && segment.text.trim().length > 0,
          );

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

  const descriptionSegments = joinDraftSegmentGroupsWithSpaces(
    subSectionDescription.map((line) =>
      normalizeResumeSegments(line.segments, availablePdfLinks),
    ),
  );

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
    description:
      descriptionSegments.length > 0
        ? createSourceUnit(
            `${itemId}_description`,
            "entry_description",
            descriptionSegments,
          )
        : null,
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
          index === segments.length - 1 && !isInlineSeparatorText(segment.text)
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
  const headerText = createSourceUnit(
    "header_text",
    "header_text",
    normalizeResumeSegments(document.headerText.segments, availablePdfLinks),
  );
  const subHeadLines = normalizeSubHeadLineUnits(
    document.subHeadText,
    availablePdfLinks,
  );

  return {
    headerText,
    sections: document.sections.map((section, sectionIndex) =>
      normalizeSection(section, sectionIndex, availablePdfLinks),
    ),
    subHeadLines,
    version: 1,
  };
}
