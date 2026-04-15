export type SavedResumeRecord = {
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  storagePath: string;
  updatedAt: string;
};

export type TailorResumeLinkRecord = {
  disabled: boolean;
  key: string;
  label: string;
  updatedAt: string;
  url: string | null;
};

export type TailorResumeExtractionStatus =
  | "failed"
  | "idle"
  | "ready"
  | "extracting";

export type TailorResumeExtractionState = {
  error: string | null;
  model: string | null;
  status: TailorResumeExtractionStatus;
  updatedAt: string | null;
};

export type TailorResumeLatexStatus =
  | "compiling"
  | "failed"
  | "idle"
  | "ready";

export type TailorResumeLatexState = {
  code: string;
  error: string | null;
  pdfUpdatedAt: string | null;
  status: TailorResumeLatexStatus;
  updatedAt: string | null;
};

export type TailorResumeProfile = {
  extraction: TailorResumeExtractionState;
  jobDescription: string;
  latex: TailorResumeLatexState;
  links: TailorResumeLinkRecord[];
  resume: SavedResumeRecord | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function emptyTailorResumeExtractionState(): TailorResumeExtractionState {
  return {
    error: null,
    model: null,
    status: "idle",
    updatedAt: null,
  };
}

export function emptyTailorResumeLatexState(): TailorResumeLatexState {
  return {
    code: "",
    error: null,
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
    links: [],
    resume: null,
  };
}

function parseTailorResumeLinkRecord(value: unknown): TailorResumeLinkRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = readNullableString(value.key);
  const label = readNullableString(value.label);
  const updatedAt = readNullableString(value.updatedAt);
  const url = value.url === null ? null : readNullableString(value.url);
  const disabled = value.disabled === true;

  if (!key || !label || !updatedAt) {
    return null;
  }

  return {
    disabled,
    key,
    label,
    updatedAt,
    url,
  };
}

function parseTailorResumeLinkRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeLinkRecord[];
  }

  return value.flatMap((entry) => {
    const parsedLink = parseTailorResumeLinkRecord(entry);
    return parsedLink ? [parsedLink] : [];
  });
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
    error: readNullableString(value.error),
    model: readNullableString(value.model),
    status,
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
  const rawCode = readString(value.code);
  const legacyDraftCode = readString(value.draftCode);
  const legacyGeneratedCode = readString(value.generatedCode);
  const code = rawCode || legacyDraftCode || legacyGeneratedCode;

  return {
    code,
    error: readNullableString(value.error),
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
    links: parseTailorResumeLinkRecords(value.links),
    resume: parseSavedResumeRecord(value.resume),
  };
}
