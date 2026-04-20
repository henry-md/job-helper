import {
  createDefaultSystemPromptSettings,
  mergeSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";

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

export type TailorResumePromptSettingsState = {
  updatedAt: string | null;
  values: SystemPromptSettings;
};

export type TailoredResumeBlockEditRecord = {
  afterLatexCode: string;
  beforeLatexCode: string;
  command: string | null;
  customLatexCode: string | null;
  editId: string;
  reason: string;
  state: "applied" | "rejected";
  segmentId: string;
};

export type TailoredResumeThesis = {
  jobDescriptionFocus: string;
  resumeChanges: string;
};

export type TailoredResumePlanningChange = {
  desiredPlainText: string;
  reason: string;
  segmentId: string;
};

export type TailoredResumePlanningResult = {
  changes: TailoredResumePlanningChange[];
  companyName: string;
  displayName: string;
  jobIdentifier: string;
  positionTitle: string;
  thesis: TailoredResumeThesis;
};

export type TailoredResumeOpenAiDebugStage = {
  outputJson: string | null;
  prompt: string | null;
  skippedReason: string | null;
};

export type TailoredResumeOpenAiDebugTrace = {
  implementation: TailoredResumeOpenAiDebugStage;
  planning: TailoredResumeOpenAiDebugStage;
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
  openAiDebug: TailoredResumeOpenAiDebugTrace;
  pdfUpdatedAt: string | null;
  planningResult: TailoredResumePlanningResult;
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
  promptSettings: TailorResumePromptSettingsState;
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

export function emptyTailorResumePromptSettingsState(): TailorResumePromptSettingsState {
  return {
    updatedAt: null,
    values: createDefaultSystemPromptSettings(),
  };
}

export function emptyTailorResumeProfile(): TailorResumeProfile {
  return {
    annotatedLatex: emptyTailorResumeAnnotatedLatexState(),
    extraction: emptyTailorResumeExtractionState(),
    jobDescription: "",
    latex: emptyTailorResumeLatexState(),
    links: [],
    promptSettings: emptyTailorResumePromptSettingsState(),
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

function parseTailorResumeWorkspaceState(value: unknown): TailorResumeWorkspaceState {
  if (!isRecord(value)) {
    return emptyTailorResumeWorkspaceState();
  }

  return {
    isBaseResumeStepComplete: value.isBaseResumeStepComplete === true,
    updatedAt: readNullableString(value.updatedAt),
  };
}

function parseTailorResumePromptSettingsState(
  value: unknown,
): TailorResumePromptSettingsState {
  if (!isRecord(value)) {
    return emptyTailorResumePromptSettingsState();
  }

  return {
    updatedAt: readNullableString(value.updatedAt),
    values: mergeSystemPromptSettings(value.values),
  };
}

type ParsedTailoredResumeBlockEditRecord = TailoredResumeBlockEditRecord & {
  source: "model" | "user";
};

function parseTailoredResumeBlockEditRecord(
  value: unknown,
  index: number,
): ParsedTailoredResumeBlockEditRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const editId = readNullableString(value.editId);
  const segmentId = readNullableString(value.segmentId);
  const beforeLatexCode = readNullableString(value.beforeLatexCode);
  const afterLatexCode = readNullableString(value.afterLatexCode);
  const customLatexCode =
    value.customLatexCode === null ? null : readNullableString(value.customLatexCode);
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
    customLatexCode,
    editId: editId ?? `${segmentId}:${index + 1}`,
    reason,
    source,
    state,
    segmentId,
  };
}

function normalizeTailoredResumeBlockEditRecords(
  edits: ParsedTailoredResumeBlockEditRecord[],
) {
  const normalizedEditsBySegmentId = new Map<string, TailoredResumeBlockEditRecord>();
  const orderedSegmentIds: string[] = [];

  for (const edit of edits) {
    const currentEdit = normalizedEditsBySegmentId.get(edit.segmentId);

    if (!currentEdit) {
      orderedSegmentIds.push(edit.segmentId);
      normalizedEditsBySegmentId.set(edit.segmentId, {
        afterLatexCode:
          edit.source === "user" ? edit.beforeLatexCode : edit.afterLatexCode,
        beforeLatexCode: edit.beforeLatexCode,
        command: edit.command,
        customLatexCode:
          edit.customLatexCode ??
          (edit.source === "user" && edit.state === "applied"
            ? edit.afterLatexCode
            : null),
        editId: edit.editId,
        reason: edit.reason,
        state: edit.state,
        segmentId: edit.segmentId,
      });
      continue;
    }

    if (edit.source === "model") {
      normalizedEditsBySegmentId.set(edit.segmentId, {
        afterLatexCode: edit.afterLatexCode,
        beforeLatexCode: edit.beforeLatexCode,
        command: edit.command,
        customLatexCode: edit.customLatexCode ?? currentEdit.customLatexCode,
        editId: edit.editId,
        reason: edit.reason,
        state: edit.state,
        segmentId: edit.segmentId,
      });
      continue;
    }

    normalizedEditsBySegmentId.set(edit.segmentId, {
      ...currentEdit,
      command: edit.command ?? currentEdit.command,
      customLatexCode: edit.state === "applied" ? edit.afterLatexCode : null,
    });
  }

  return orderedSegmentIds.flatMap((segmentId) => {
    const edit = normalizedEditsBySegmentId.get(segmentId);
    return edit ? [edit] : [];
  });
}

function parseTailoredResumeBlockEditRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeBlockEditRecord[];
  }

  const parsedEdits = value.flatMap((entry, index) => {
    const parsedEdit = parseTailoredResumeBlockEditRecord(entry, index);
    return parsedEdit ? [parsedEdit] : [];
  });

  return normalizeTailoredResumeBlockEditRecords(parsedEdits);
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

function parseTailoredResumePlanningChange(
  value: unknown,
): TailoredResumePlanningChange | null {
  if (!isRecord(value)) {
    return null;
  }

  const segmentId = readNullableString(value.segmentId);
  const reason = readNullableString(value.reason);
  const desiredPlainText =
    typeof value.desiredPlainText === "string" ? value.desiredPlainText : null;

  if (!segmentId || desiredPlainText === null) {
    return null;
  }

  if (!reason?.trim()) {
    return null;
  }

  return {
    desiredPlainText,
    reason,
    segmentId,
  };
}

function parseTailoredResumePlanningResult(
  value: unknown,
): TailoredResumePlanningResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const companyName =
    typeof value.companyName === "string" ? value.companyName : null;
  const displayName = readNullableString(value.displayName);
  const jobIdentifier = readNullableString(value.jobIdentifier);
  const positionTitle =
    typeof value.positionTitle === "string" ? value.positionTitle : null;
  const thesis = parseTailoredResumeThesis(value.thesis);

  if (
    companyName === null ||
    !displayName ||
    !jobIdentifier ||
    positionTitle === null ||
    !thesis ||
    !Array.isArray(value.changes)
  ) {
    return null;
  }

  const changes = value.changes.flatMap((change) => {
    const parsedChange = parseTailoredResumePlanningChange(change);
    return parsedChange ? [parsedChange] : [];
  });

  if (changes.length !== value.changes.length) {
    return null;
  }

  return {
    changes,
    companyName,
    displayName,
    jobIdentifier,
    positionTitle,
    thesis,
  };
}

function buildLegacyTailoredResumePlanningResult(input: {
  companyName: string | null;
  displayName: string | null;
  jobIdentifier: string | null;
  positionTitle: string | null;
  thesis: TailoredResumeThesis | null;
}) {
  if (
    input.companyName === null ||
    !input.displayName ||
    !input.jobIdentifier ||
    input.positionTitle === null ||
    !input.thesis
  ) {
    return null;
  }

  return {
    changes: [],
    companyName: input.companyName,
    displayName: input.displayName,
    jobIdentifier: input.jobIdentifier,
    positionTitle: input.positionTitle,
    thesis: input.thesis,
  } satisfies TailoredResumePlanningResult;
}

function parseTailoredResumeOpenAiDebugStage(
  value: unknown,
): TailoredResumeOpenAiDebugStage | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = value.prompt === null ? null : readNullableString(value.prompt);
  const outputJson =
    value.outputJson === null ? null : readNullableString(value.outputJson);
  const skippedReason =
    value.skippedReason === null
      ? null
      : readNullableString(value.skippedReason);

  if (
    (value.prompt !== null && prompt === null) ||
    (value.outputJson !== null && outputJson === null) ||
    (value.skippedReason !== null && skippedReason === null)
  ) {
    return null;
  }

  if (prompt === null && outputJson === null && !skippedReason) {
    return null;
  }

  return {
    outputJson,
    prompt,
    skippedReason,
  };
}

function parseTailoredResumeOpenAiDebugTrace(
  value: unknown,
): TailoredResumeOpenAiDebugTrace | null {
  if (!isRecord(value)) {
    return null;
  }

  const planning = parseTailoredResumeOpenAiDebugStage(value.planning);
  const implementation = parseTailoredResumeOpenAiDebugStage(
    value.implementation,
  );

  if (!planning || !implementation) {
    return null;
  }

  return {
    implementation,
    planning,
  };
}

function parseTailoredResumeRecord(value: unknown): TailoredResumeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNullableString(value.id);
  const displayName = readNullableString(value.displayName);
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
    typeof value.companyName === "string" ? value.companyName : null;
  const positionTitle =
    typeof value.positionTitle === "string" ? value.positionTitle : null;
  const jobIdentifier = readNullableString(value.jobIdentifier);
  const openAiDebug = parseTailoredResumeOpenAiDebugTrace(value.openAiDebug);
  const planningResult =
    parseTailoredResumePlanningResult(value.planningResult) ??
    buildLegacyTailoredResumePlanningResult({
      companyName,
      displayName,
      jobIdentifier,
      positionTitle,
      thesis,
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
    !updatedAt ||
    companyName === null ||
    positionTitle === null ||
    !jobIdentifier ||
    !openAiDebug ||
    !planningResult ||
    !thesis
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
    openAiDebug,
    pdfUpdatedAt,
    planningResult,
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
    promptSettings: parseTailorResumePromptSettingsState(value.promptSettings),
    resume: parseSavedResumeRecord(value.resume),
    tailoredResumes: parseTailoredResumeRecords(value.tailoredResumes),
    workspace: parseTailorResumeWorkspaceState(value.workspace),
  };
}
