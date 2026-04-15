export type ResumeSegmentType =
  | "separator_bullet"
  | "separator_pipe"
  | "text";

export type ResumeTextSegment = {
  isBold: boolean;
  isItalic: boolean;
  isLinkStyle: boolean;
  segmentType: ResumeSegmentType;
  text: string;
};

export type ResumeRichText = {
  segments: ResumeTextSegment[];
};

export type ResumeIndentedRichText = {
  indentLevel: number;
  segments: ResumeTextSegment[];
};

export type ResumeSubHeadSeparator = "bullet" | "pipe" | null;

export type ResumeSubHeadLine = {
  lineItems: ResumeRichText[];
  separatorBetweenItems: ResumeSubHeadSeparator;
};

export type ResumeEntryBlock = {
  blockType: "entry";
  subSectionBullets: ResumeIndentedRichText[];
  subSectionDates: ResumeRichText | null;
  subSectionDescription: ResumeIndentedRichText[];
  subSectionText: ResumeRichText;
};

export type ResumeParagraphBlock = {
  blockType: "paragraph";
  content: ResumeIndentedRichText;
};

export type ResumeLabeledLineBlock = {
  blockType: "labeled_line";
  label: ResumeRichText;
  value: ResumeRichText;
};

export type ResumeSectionBlock =
  | ResumeEntryBlock
  | ResumeParagraphBlock
  | ResumeLabeledLineBlock;

export type ResumeSection = {
  blocks: ResumeSectionBlock[];
  sectionText: ResumeRichText;
};

export type ResumeDocument = {
  headerText: ResumeRichText;
  sections: ResumeSection[];
  subHeadText: ResumeSubHeadLine[];
};

export type TailorResumeSourceSegment = {
  id: string;
  isBold: boolean;
  isItalic: boolean;
  isLinkStyle: boolean;
  isUnderline: boolean;
  linkUrl: string | null;
  segmentType: ResumeSegmentType;
  text: string;
};

export type TailorResumeSourceUnitKind =
  | "bullet"
  | "description_line"
  | "entry_dates"
  | "entry_heading"
  | "header_line"
  | "header_name"
  | "labeled_line_label"
  | "labeled_line_value"
  | "paragraph"
  | "section_title";

export type TailorResumeSourceUnit = {
  id: string;
  indentLevel: number;
  kind: TailorResumeSourceUnitKind;
  segments: TailorResumeSourceSegment[];
};

export type TailorResumeSourceEntryItem = {
  bulletLines: TailorResumeSourceUnit[];
  dates: TailorResumeSourceUnit | null;
  descriptionLines: TailorResumeSourceUnit[];
  heading: TailorResumeSourceUnit;
  id: string;
  itemType: "entry";
};

export type TailorResumeSourceParagraphItem = {
  content: TailorResumeSourceUnit;
  id: string;
  itemType: "paragraph";
};

export type TailorResumeSourceLabeledLineItem = {
  id: string;
  itemType: "labeled_line";
  label: TailorResumeSourceUnit;
  value: TailorResumeSourceUnit;
};

export type TailorResumeSourceItem =
  | TailorResumeSourceEntryItem
  | TailorResumeSourceParagraphItem
  | TailorResumeSourceLabeledLineItem;

export type TailorResumeSourceSection = {
  id: string;
  items: TailorResumeSourceItem[];
  title: TailorResumeSourceUnit;
};

export type TailorResumeSourceHeader = {
  id: string;
  lines: TailorResumeSourceUnit[];
  name: TailorResumeSourceUnit;
};

export type TailorResumeSourceDocument = {
  header: TailorResumeSourceHeader;
  sections: TailorResumeSourceSection[];
  version: 1;
};

export type SavedResumeRecord = {
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  storagePath: string;
  updatedAt: string;
};

export type TailorResumeExtractionStatus =
  | "failed"
  | "idle"
  | "ready"
  | "extracting";

export type TailorResumeExtractionState = {
  editedDocument: ResumeDocument | null;
  error: string | null;
  extractedDocument: ResumeDocument | null;
  model: string | null;
  rawText: string | null;
  status: TailorResumeExtractionStatus;
  updatedAt: string | null;
};

export type TailorResumeSourceState = {
  document: TailorResumeSourceDocument | null;
  updatedAt: string | null;
};

export type TailorResumeLatexStatus =
  | "compiling"
  | "failed"
  | "idle"
  | "ready";

export type TailorResumeLatexState = {
  draftCode: string;
  error: string | null;
  generatedCode: string | null;
  pdfUpdatedAt: string | null;
  status: TailorResumeLatexStatus;
  updatedAt: string | null;
};

export type TailorResumeProfile = {
  extraction: TailorResumeExtractionState;
  jobDescription: string;
  latex: TailorResumeLatexState;
  resume: SavedResumeRecord | null;
  source: TailorResumeSourceState;
};

const separatorBetweenItemValues = new Set<ResumeSubHeadSeparator>([
  null,
  "bullet",
  "pipe",
]);
const segmentTypeValues = new Set<ResumeSegmentType>([
  "separator_bullet",
  "separator_pipe",
  "text",
]);
const sourceUnitKindValues = new Set<TailorResumeSourceUnitKind>([
  "bullet",
  "description_line",
  "entry_dates",
  "entry_heading",
  "header_line",
  "header_name",
  "labeled_line_label",
  "labeled_line_value",
  "paragraph",
  "section_title",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function createEmptyResumeTextSegment(): ResumeTextSegment {
  return {
    isBold: false,
    isItalic: false,
    isLinkStyle: false,
    segmentType: "text",
    text: "",
  };
}

export function createEmptyResumeRichText(): ResumeRichText {
  return {
    segments: [createEmptyResumeTextSegment()],
  };
}

export function createEmptyResumeIndentedRichText(
  indentLevel = 0,
): ResumeIndentedRichText {
  return {
    indentLevel,
    segments: [createEmptyResumeTextSegment()],
  };
}

export function createEmptyResumeEntryBlock(): ResumeEntryBlock {
  return {
    blockType: "entry",
    subSectionBullets: [createEmptyResumeIndentedRichText(1)],
    subSectionDates: createEmptyResumeRichText(),
    subSectionDescription: [createEmptyResumeIndentedRichText(0)],
    subSectionText: createEmptyResumeRichText(),
  };
}

export function createEmptyResumeParagraphBlock(): ResumeParagraphBlock {
  return {
    blockType: "paragraph",
    content: createEmptyResumeIndentedRichText(0),
  };
}

export function createEmptyResumeLabeledLineBlock(): ResumeLabeledLineBlock {
  return {
    blockType: "labeled_line",
    label: createEmptyResumeRichText(),
    value: createEmptyResumeRichText(),
  };
}

export function createEmptyResumeSection(): ResumeSection {
  return {
    blocks: [createEmptyResumeEntryBlock()],
    sectionText: createEmptyResumeRichText(),
  };
}

export function createEmptyResumeDocument(): ResumeDocument {
  return {
    headerText: createEmptyResumeRichText(),
    sections: [createEmptyResumeSection()],
    subHeadText: [
      {
        lineItems: [createEmptyResumeRichText()],
        separatorBetweenItems: "bullet",
      },
    ],
  };
}

function createEmptyTailorResumeSourceSegment(
  id = "segment",
): TailorResumeSourceSegment {
  return {
    id,
    isBold: false,
    isItalic: false,
    isLinkStyle: false,
    isUnderline: false,
    linkUrl: null,
    segmentType: "text",
    text: "",
  };
}

function createEmptyTailorResumeSourceUnit(
  id = "unit",
  kind: TailorResumeSourceUnitKind = "paragraph",
  indentLevel = 0,
): TailorResumeSourceUnit {
  return {
    id,
    indentLevel,
    kind,
    segments: [createEmptyTailorResumeSourceSegment(`${id}_seg_01`)],
  };
}

function createEmptyTailorResumeSourceDocument(): TailorResumeSourceDocument {
  return {
    header: {
      id: "header",
      lines: [createEmptyTailorResumeSourceUnit("header_line_01", "header_line")],
      name: createEmptyTailorResumeSourceUnit("header_name", "header_name"),
    },
    sections: [
      {
        id: "section_01",
        items: [
          {
            bulletLines: [],
            dates: null,
            descriptionLines: [],
            heading: createEmptyTailorResumeSourceUnit(
              "section_01_item_01_heading",
              "entry_heading",
            ),
            id: "section_01_item_01",
            itemType: "entry",
          },
        ],
        title: createEmptyTailorResumeSourceUnit(
          "section_01_title",
          "section_title",
        ),
      },
    ],
    version: 1,
  };
}

export function emptyTailorResumeExtractionState(): TailorResumeExtractionState {
  return {
    editedDocument: null,
    error: null,
    extractedDocument: null,
    model: null,
    rawText: null,
    status: "idle",
    updatedAt: null,
  };
}

export function emptyTailorResumeSourceState(): TailorResumeSourceState {
  return {
    document: null,
    updatedAt: null,
  };
}

export function emptyTailorResumeLatexState(): TailorResumeLatexState {
  return {
    draftCode: "",
    error: null,
    generatedCode: null,
    pdfUpdatedAt: null,
    status: "idle",
    updatedAt: null,
  };
}

export function emptyTailorResumeProfile(): TailorResumeProfile {
  return {
    extraction: emptyTailorResumeExtractionState(),
    jobDescription: "",
    latex: emptyTailorResumeLatexState(),
    resume: null,
    source: emptyTailorResumeSourceState(),
  };
}

export function serializeResumeDocument(document: ResumeDocument | null) {
  return document ? JSON.stringify(document) : "";
}

function parseResumeTextSegment(value: unknown): ResumeTextSegment {
  if (!isRecord(value)) {
    return createEmptyResumeTextSegment();
  }

  const rawSegmentType = value.segmentType;
  const segmentType = segmentTypeValues.has(rawSegmentType as ResumeSegmentType)
    ? (rawSegmentType as ResumeSegmentType)
    : "text";
  const text = readString(value.text);

  return {
    isBold: readBoolean(value.isBold),
    isItalic: readBoolean(value.isItalic),
    isLinkStyle: readBoolean(value.isLinkStyle),
    segmentType,
    text:
      segmentType === "separator_pipe"
        ? "|"
        : segmentType === "separator_bullet"
          ? "•"
          : text,
  };
}

export function parseResumeRichText(value: unknown): ResumeRichText {
  if (!isRecord(value)) {
    return createEmptyResumeRichText();
  }

  const segments = Array.isArray(value.segments)
    ? value.segments.map(parseResumeTextSegment)
    : [];

  return {
    segments: segments.length > 0 ? segments : [createEmptyResumeTextSegment()],
  };
}

export function parseResumeIndentedRichText(
  value: unknown,
): ResumeIndentedRichText {
  if (!isRecord(value)) {
    return createEmptyResumeIndentedRichText();
  }

  return {
    indentLevel: Math.max(0, Math.min(3, readInteger(value.indentLevel))),
    segments: parseResumeRichText(value).segments,
  };
}

function parseResumeSubHeadLine(value: unknown): ResumeSubHeadLine {
  if (!isRecord(value)) {
    return {
      lineItems: [createEmptyResumeRichText()],
      separatorBetweenItems: "bullet",
    };
  }

  const lineItems = Array.isArray(value.lineItems)
    ? value.lineItems.map(parseResumeRichText)
    : [];
  const separatorBetweenItems = separatorBetweenItemValues.has(
    (value.separatorBetweenItems as ResumeSubHeadSeparator) ?? null,
  )
    ? ((value.separatorBetweenItems as ResumeSubHeadSeparator) ?? null)
    : null;

  return {
    lineItems: lineItems.length > 0 ? lineItems : [createEmptyResumeRichText()],
    separatorBetweenItems,
  };
}

function parseResumeSectionBlock(value: unknown): ResumeSectionBlock {
  if (!isRecord(value) || typeof value.blockType !== "string") {
    return createEmptyResumeParagraphBlock();
  }

  if (value.blockType === "entry") {
    return {
      blockType: "entry",
      subSectionBullets: Array.isArray(value.subSectionBullets)
        ? value.subSectionBullets.map(parseResumeIndentedRichText)
        : [],
      subSectionDates: value.subSectionDates
        ? parseResumeRichText(value.subSectionDates)
        : null,
      subSectionDescription: Array.isArray(value.subSectionDescription)
        ? value.subSectionDescription.map(parseResumeIndentedRichText)
        : [],
      subSectionText: parseResumeRichText(value.subSectionText),
    };
  }

  if (value.blockType === "labeled_line") {
    return {
      blockType: "labeled_line",
      label: parseResumeRichText(value.label),
      value: parseResumeRichText(value.value),
    };
  }

  return {
    blockType: "paragraph",
    content: parseResumeIndentedRichText(value.content),
  };
}

function parseResumeSection(value: unknown): ResumeSection {
  if (!isRecord(value)) {
    return createEmptyResumeSection();
  }

  const blocks = Array.isArray(value.blocks)
    ? value.blocks.map(parseResumeSectionBlock)
    : [];

  return {
    blocks: blocks.length > 0 ? blocks : [createEmptyResumeParagraphBlock()],
    sectionText: parseResumeRichText(value.sectionText),
  };
}

export function parseResumeDocument(value: unknown): ResumeDocument {
  if (!isRecord(value)) {
    return createEmptyResumeDocument();
  }

  const sections = Array.isArray(value.sections)
    ? value.sections.map(parseResumeSection)
    : [];
  const subHeadText = Array.isArray(value.subHeadText)
    ? value.subHeadText.map(parseResumeSubHeadLine)
    : [];

  return {
    headerText: parseResumeRichText(value.headerText),
    sections: sections.length > 0 ? sections : [createEmptyResumeSection()],
    subHeadText,
  };
}

function parseTailorResumeSourceSegment(
  value: unknown,
  fallbackId: string,
): TailorResumeSourceSegment {
  if (!isRecord(value)) {
    return createEmptyTailorResumeSourceSegment(fallbackId);
  }

  const rawSegmentType = value.segmentType;
  const segmentType = segmentTypeValues.has(rawSegmentType as ResumeSegmentType)
    ? (rawSegmentType as ResumeSegmentType)
    : "text";

  return {
    id: readString(value.id, fallbackId),
    isBold: readBoolean(value.isBold),
    isItalic: readBoolean(value.isItalic),
    isLinkStyle: readBoolean(value.isLinkStyle),
    isUnderline: readBoolean(value.isUnderline),
    linkUrl: readNullableString(value.linkUrl),
    segmentType,
    text:
      segmentType === "separator_pipe"
        ? "|"
        : segmentType === "separator_bullet"
          ? "•"
          : readString(value.text),
  };
}

function parseTailorResumeSourceUnit(
  value: unknown,
  fallbackId: string,
  fallbackKind: TailorResumeSourceUnitKind,
): TailorResumeSourceUnit {
  if (!isRecord(value)) {
    return createEmptyTailorResumeSourceUnit(fallbackId, fallbackKind);
  }

  const rawKind = value.kind;
  const kind = sourceUnitKindValues.has(rawKind as TailorResumeSourceUnitKind)
    ? (rawKind as TailorResumeSourceUnitKind)
    : fallbackKind;
  const id = readString(value.id, fallbackId);
  const segments = Array.isArray(value.segments)
    ? value.segments.map((segment, index) =>
        parseTailorResumeSourceSegment(segment, `${id}_seg_${String(index + 1).padStart(2, "0")}`),
      )
    : [];

  return {
    id,
    indentLevel: Math.max(0, Math.min(3, readInteger(value.indentLevel))),
    kind,
    segments:
      segments.length > 0
        ? segments
        : [createEmptyTailorResumeSourceSegment(`${id}_seg_01`)],
  };
}

function parseTailorResumeSourceItem(
  value: unknown,
  fallbackId: string,
): TailorResumeSourceItem {
  if (!isRecord(value) || typeof value.itemType !== "string") {
    return {
      content: createEmptyTailorResumeSourceUnit(
        `${fallbackId}_content`,
        "paragraph",
      ),
      id: fallbackId,
      itemType: "paragraph",
    };
  }

  const id = readString(value.id, fallbackId);

  if (value.itemType === "entry") {
    return {
      bulletLines: Array.isArray(value.bulletLines)
        ? value.bulletLines.map((unit, index) =>
            parseTailorResumeSourceUnit(
              unit,
              `${id}_bullet_${String(index + 1).padStart(2, "0")}`,
              "bullet",
            ),
          )
        : [],
      dates: value.dates
        ? parseTailorResumeSourceUnit(value.dates, `${id}_dates`, "entry_dates")
        : null,
      descriptionLines: Array.isArray(value.descriptionLines)
        ? value.descriptionLines.map((unit, index) =>
            parseTailorResumeSourceUnit(
              unit,
              `${id}_description_${String(index + 1).padStart(2, "0")}`,
              "description_line",
            ),
          )
        : [],
      heading: parseTailorResumeSourceUnit(
        value.heading,
        `${id}_heading`,
        "entry_heading",
      ),
      id,
      itemType: "entry",
    };
  }

  if (value.itemType === "labeled_line") {
    return {
      id,
      itemType: "labeled_line",
      label: parseTailorResumeSourceUnit(
        value.label,
        `${id}_label`,
        "labeled_line_label",
      ),
      value: parseTailorResumeSourceUnit(
        value.value,
        `${id}_value`,
        "labeled_line_value",
      ),
    };
  }

  return {
    content: parseTailorResumeSourceUnit(
      value.content,
      `${id}_content`,
      "paragraph",
    ),
    id,
    itemType: "paragraph",
  };
}

function parseTailorResumeSourceSection(
  value: unknown,
  fallbackId: string,
): TailorResumeSourceSection {
  if (!isRecord(value)) {
    return {
      id: fallbackId,
      items: [parseTailorResumeSourceItem(null, `${fallbackId}_item_01`)],
      title: createEmptyTailorResumeSourceUnit(
        `${fallbackId}_title`,
        "section_title",
      ),
    };
  }

  const id = readString(value.id, fallbackId);
  const items = Array.isArray(value.items)
    ? value.items.map((item, index) =>
        parseTailorResumeSourceItem(
          item,
          `${id}_item_${String(index + 1).padStart(2, "0")}`,
        ),
      )
    : [];

  return {
    id,
    items:
      items.length > 0 ? items : [parseTailorResumeSourceItem(null, `${id}_item_01`)],
    title: parseTailorResumeSourceUnit(
      value.title,
      `${id}_title`,
      "section_title",
    ),
  };
}

export function parseTailorResumeSourceDocument(
  value: unknown,
): TailorResumeSourceDocument {
  if (!isRecord(value)) {
    return createEmptyTailorResumeSourceDocument();
  }

  const headerValue = isRecord(value.header) ? value.header : null;
  const headerId = readString(headerValue?.id, "header");
  const lines = Array.isArray(headerValue?.lines)
    ? headerValue.lines.map((line, index) =>
        parseTailorResumeSourceUnit(
          line,
          `header_line_${String(index + 1).padStart(2, "0")}`,
          "header_line",
        ),
      )
    : [];
  const sections = Array.isArray(value.sections)
    ? value.sections.map((section, index) =>
        parseTailorResumeSourceSection(
          section,
          `section_${String(index + 1).padStart(2, "0")}`,
        ),
      )
    : [];

  return {
    header: {
      id: headerId,
      lines:
        lines.length > 0
          ? lines
          : [createEmptyTailorResumeSourceUnit("header_line_01", "header_line")],
      name: parseTailorResumeSourceUnit(
        headerValue?.name,
        "header_name",
        "header_name",
      ),
    },
    sections:
      sections.length > 0 ? sections : createEmptyTailorResumeSourceDocument().sections,
    version: value.version === 1 ? 1 : 1,
  };
}

function parseSavedResumeRecord(value: unknown): SavedResumeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const originalFilename = readNullableString(value.originalFilename);
  const storagePath = readNullableString(value.storagePath);
  const mimeType = readNullableString(value.mimeType);
  const updatedAt = readNullableString(value.updatedAt);
  const sizeBytes =
    typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
      ? value.sizeBytes
      : null;

  if (!originalFilename || !storagePath || !mimeType || !updatedAt || sizeBytes === null) {
    return null;
  }

  return {
    mimeType,
    originalFilename,
    sizeBytes,
    storagePath,
    updatedAt,
  };
}

function parseTailorResumeExtractionState(
  value: unknown,
): TailorResumeExtractionState {
  if (!isRecord(value)) {
    return emptyTailorResumeExtractionState();
  }

  const rawStatus = value.status;
  const status =
    rawStatus === "extracting" ||
    rawStatus === "ready" ||
    rawStatus === "failed" ||
    rawStatus === "idle"
      ? rawStatus
      : "idle";

  return {
    editedDocument: value.editedDocument
      ? parseResumeDocument(value.editedDocument)
      : null,
    error: readNullableString(value.error),
    extractedDocument: value.extractedDocument
      ? parseResumeDocument(value.extractedDocument)
      : null,
    model: readNullableString(value.model),
    rawText: readNullableString(value.rawText),
    status,
    updatedAt: readNullableString(value.updatedAt),
  };
}

function parseTailorResumeSourceState(value: unknown): TailorResumeSourceState {
  if (!isRecord(value)) {
    return emptyTailorResumeSourceState();
  }

  return {
    document: value.document ? parseTailorResumeSourceDocument(value.document) : null,
    updatedAt: readNullableString(value.updatedAt),
  };
}

function parseTailorResumeLatexState(value: unknown): TailorResumeLatexState {
  if (!isRecord(value)) {
    return emptyTailorResumeLatexState();
  }

  const rawStatus = value.status;
  const status =
    rawStatus === "compiling" ||
    rawStatus === "ready" ||
    rawStatus === "failed" ||
    rawStatus === "idle"
      ? rawStatus
      : "idle";

  return {
    draftCode: readString(value.draftCode),
    error: readNullableString(value.error),
    generatedCode: readNullableString(value.generatedCode),
    pdfUpdatedAt: readNullableString(value.pdfUpdatedAt),
    status,
    updatedAt: readNullableString(value.updatedAt),
  };
}

export function parseTailorResumeProfile(value: unknown): TailorResumeProfile {
  if (!isRecord(value)) {
    return emptyTailorResumeProfile();
  }

  return {
    extraction: parseTailorResumeExtractionState(value.extraction),
    jobDescription: readString(value.jobDescription),
    latex: parseTailorResumeLatexState(value.latex),
    resume: parseSavedResumeRecord(value.resume),
    source: parseTailorResumeSourceState(value.source),
  };
}
