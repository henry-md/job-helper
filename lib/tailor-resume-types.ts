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

export type TailorResumeProfile = {
  extraction: TailorResumeExtractionState;
  jobDescription: string;
  resume: SavedResumeRecord | null;
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

export function emptyTailorResumeProfile(): TailorResumeProfile {
  return {
    extraction: emptyTailorResumeExtractionState(),
    jobDescription: "",
    resume: null,
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

export function parseTailorResumeProfile(value: unknown): TailorResumeProfile {
  if (!isRecord(value)) {
    return emptyTailorResumeProfile();
  }

  return {
    extraction: parseTailorResumeExtractionState(value.extraction),
    jobDescription: readString(value.jobDescription),
    resume: parseSavedResumeRecord(value.resume),
  };
}
