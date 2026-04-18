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
  locked?: boolean;
  updatedAt: string;
  url: string | null;
};

export type TailorResumeLockedLinkRecord = {
  key: string;
  label: string;
  updatedAt: string;
  url: string;
};

export type TailorResumeSavedLinkUpdate = {
  key: string;
  label: string;
  nextUrl: string;
  previousUrl: string | null;
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

export type TailorResumeAnnotatedLatexState = {
  code: string;
  segmentCount: number;
  updatedAt: string | null;
};

export type TailorResumeWorkspaceState = {
  isBaseResumeStepComplete: boolean;
  updatedAt: string | null;
};

export type TailoredResumeBlockEditRecord = {
  afterLatexCode: string;
  beforeLatexCode: string;
  command: string | null;
  editId: string;
  reason: string;
  source: "model" | "user";
  state: "applied" | "rejected";
  segmentId: string;
};

export type TailoredResumeThesis = {
  jobDescriptionFocus: string;
  resumeChanges: string;
};

export type TailoredResumeRecord = {
  annotatedLatexCode: string;
  companyName: string;
  createdAt: string;
  displayName: string;
  edits: TailoredResumeBlockEditRecord[];
  error: string | null;
  id: string;
  jobDescription: string;
  jobIdentifier: string;
  latexCode: string;
  pdfUpdatedAt: string | null;
  positionTitle: string;
  sourceAnnotatedLatexCode: string | null;
  status: TailorResumeLatexStatus;
  thesis: TailoredResumeThesis | null;
  updatedAt: string;
};

export type TailorResumeProfile = {
  annotatedLatex: TailorResumeAnnotatedLatexState;
  extraction: TailorResumeExtractionState;
  jobDescription: string;
  latex: TailorResumeLatexState;
  links: TailorResumeLinkRecord[];
  resume: SavedResumeRecord | null;
  tailoredResumes: TailoredResumeRecord[];
  workspace: TailorResumeWorkspaceState;
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

export function emptyTailorResumeAnnotatedLatexState(): TailorResumeAnnotatedLatexState {
  return {
    code: "",
    segmentCount: 0,
    updatedAt: null,
  };
}

export function emptyTailorResumeWorkspaceState(): TailorResumeWorkspaceState {
  return {
    isBaseResumeStepComplete: false,
    updatedAt: null,
  };
}

export function emptyTailorResumeProfile(): TailorResumeProfile {
  return {
    annotatedLatex: emptyTailorResumeAnnotatedLatexState(),
    extraction: emptyTailorResumeExtractionState(),
    jobDescription: "",
    latex: emptyTailorResumeLatexState(),
    links: [],
    resume: null,
    tailoredResumes: [],
    workspace: emptyTailorResumeWorkspaceState(),
  };
}

function parseTailorResumeLinkRecord(value: unknown): TailorResumeLinkRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = readNullableString(value.key);
  const label = readNullableString(value.label);
  const locked = value.locked === true;
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
    locked,
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

function parseTailorResumeAnnotatedLatexState(
  value: unknown,
): TailorResumeAnnotatedLatexState {
  if (!isRecord(value)) {
    return emptyTailorResumeAnnotatedLatexState();
  }

  const rawSegmentCount = value.segmentCount;
  const segmentCount =
    typeof rawSegmentCount === "number" && Number.isFinite(rawSegmentCount)
      ? Math.max(0, Math.floor(rawSegmentCount))
      : 0;

  return {
    code: readString(value.code),
    segmentCount,
    updatedAt: readNullableString(value.updatedAt),
  };
}

function buildTailoredResumeDisplayName(input: {
  companyName: string;
  positionTitle: string;
}) {
  const companyName = input.companyName.trim();
  const positionTitle = input.positionTitle.trim();

  if (companyName && positionTitle) {
    return `${companyName} - ${positionTitle}`;
  }

  return companyName || positionTitle || "Tailored Resume";
}

function parseTailorResumeWorkspaceState(value: unknown): TailorResumeWorkspaceState {
  if (!isRecord(value)) {
    return emptyTailorResumeWorkspaceState();
  }

  return {
    isBaseResumeStepComplete: value.isBaseResumeStepComplete === true,
    updatedAt: readNullableString(value.updatedAt),
  };
}

function parseTailoredResumeBlockEditRecord(
  value: unknown,
  index: number,
): TailoredResumeBlockEditRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const editId = readNullableString(value.editId);
  const segmentId = readNullableString(value.segmentId);
  const beforeLatexCode = readNullableString(value.beforeLatexCode);
  const afterLatexCode = readNullableString(value.afterLatexCode);
  const reason = readNullableString(value.reason);
  const command = readNullableString(value.command);
  const rawSource = value.source;
  const source = rawSource === "user" ? "user" : "model";
  const rawState = value.state;
  const state = rawState === "rejected" ? "rejected" : "applied";

  if (
    !segmentId ||
    beforeLatexCode === null ||
    afterLatexCode === null ||
    !reason
  ) {
    return null;
  }

  return {
    afterLatexCode,
    beforeLatexCode,
    command,
    editId: editId ?? `${segmentId}:${index + 1}`,
    reason,
    source,
    state,
    segmentId,
  };
}

function parseTailoredResumeBlockEditRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeBlockEditRecord[];
  }

  return value.flatMap((entry, index) => {
    const parsedEdit = parseTailoredResumeBlockEditRecord(entry, index);
    return parsedEdit ? [parsedEdit] : [];
  });
}

function parseTailoredResumeThesis(value: unknown): TailoredResumeThesis | null {
  if (!isRecord(value)) {
    return null;
  }

  const jobDescriptionFocus = readNullableString(value.jobDescriptionFocus)?.trim() ?? "";
  const resumeChanges = readNullableString(value.resumeChanges)?.trim() ?? "";

  if (!jobDescriptionFocus || !resumeChanges) {
    return null;
  }

  return {
    jobDescriptionFocus,
    resumeChanges,
  };
}

function parseTailoredResumeRecord(value: unknown): TailoredResumeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNullableString(value.id);
  const rawDisplayName = readNullableString(value.displayName);
  const jobDescription = readNullableString(value.jobDescription);
  const latexCode = readNullableString(value.latexCode);
  const annotatedLatexCode = readNullableString(value.annotatedLatexCode);
  const createdAt = readNullableString(value.createdAt);
  const updatedAt = readNullableString(value.updatedAt);
  const pdfUpdatedAt = readNullableString(value.pdfUpdatedAt);
  const error = readNullableString(value.error);
  const sourceAnnotatedLatexCode = readNullableString(value.sourceAnnotatedLatexCode);
  const thesis = parseTailoredResumeThesis(value.thesis);
  const companyName =
    readNullableString(value.companyName) ??
    rawDisplayName?.split(" - ")[0]?.trim() ??
    "";
  const positionTitle =
    readNullableString(value.positionTitle) ??
    rawDisplayName?.split(" - ")[1]?.trim() ??
    "";
  const jobIdentifier = readNullableString(value.jobIdentifier) ?? "General";
  const displayName =
    rawDisplayName ??
    buildTailoredResumeDisplayName({
      companyName,
      positionTitle,
    });
  const rawStatus = value.status;
  const status =
    rawStatus === "compiling" ||
    rawStatus === "ready" ||
    rawStatus === "failed" ||
    rawStatus === "idle"
      ? rawStatus
      : "idle";

  if (
    !id ||
    !displayName ||
    jobDescription === null ||
    !latexCode ||
    !annotatedLatexCode ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    annotatedLatexCode,
    companyName,
    createdAt,
    displayName,
    edits: parseTailoredResumeBlockEditRecords(value.edits),
    error,
    id,
    jobDescription,
    jobIdentifier,
    latexCode,
    pdfUpdatedAt,
    positionTitle,
    sourceAnnotatedLatexCode,
    status,
    thesis,
    updatedAt,
  };
}

function parseTailoredResumeRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeRecord[];
  }

  return value.flatMap((entry) => {
    const parsedRecord = parseTailoredResumeRecord(entry);
    return parsedRecord ? [parsedRecord] : [];
  });
}

export function parseTailorResumeProfile(value: unknown): TailorResumeProfile {
  if (!isRecord(value)) {
    return emptyTailorResumeProfile();
  }

  return {
    annotatedLatex: parseTailorResumeAnnotatedLatexState(value.annotatedLatex),
    extraction: parseTailorResumeExtractionState(value.extraction),
    jobDescription: readString(value.jobDescription),
    latex: parseTailorResumeLatexState(value.latex),
    links: parseTailorResumeLinkRecords(value.links),
    resume: parseSavedResumeRecord(value.resume),
    tailoredResumes: parseTailoredResumeRecords(value.tailoredResumes),
    workspace: parseTailorResumeWorkspaceState(value.workspace),
  };
}
