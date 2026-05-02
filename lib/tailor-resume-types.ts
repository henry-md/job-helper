import {
  createDefaultTailorResumeGenerationSettings,
  currentTailorResumeGenerationSettingsVersion,
  mergeTailorResumeGenerationSettings,
  type TailorResumeGenerationSettings,
} from "./tailor-resume-generation-settings.ts";
import {
  createDefaultSystemPromptSettings,
  mergeSystemPromptSettings,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import { sortTailorResumeWorkspaceInterviews } from "./tailor-resume-workspace-interviews.ts";

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

export type TailorResumeGenerationSourceSnapshot = {
  latexCode: string;
  linkState: string;
  lockedLinkState: string;
  resumeStoragePath: string | null;
  resumeUpdatedAt: string | null;
};

export type TailorResumeConversationMessage = {
  id: string;
  role: "assistant" | "user";
  technologyContexts?: TailorResumeTechnologyContext[];
  text: string;
  toolCalls: TailorResumeConversationToolCall[];
};

export type TailorResumeConversationToolCall = {
  argumentsText: string;
  name: string;
};

export type TailorResumeTechnologyContext = {
  definition: string;
  examples: string[];
  name: string;
};

export type TailoredResumeQuestionLearning = {
  detail: string;
  targetSegmentIds: string[];
  topic: string;
};

export type TailorResumeInterviewDebugDecision =
  | "forced_only"
  | "not_applicable"
  | "would_ask_without_debug";

export type TailoredResumeQuestioningSummary = {
  agenda: string;
  askedQuestionCount: number;
  debugDecision: TailorResumeInterviewDebugDecision | null;
  learnings: TailoredResumeQuestionLearning[];
};

export type TailorResumeUserMarkdownPatchOperation = {
  anchorMarkdown?: string;
  headingPath?: string[];
  markdown?: string;
  newMarkdown?: string;
  oldMarkdown?: string;
  op: "append" | "delete_exact" | "insert_after" | "insert_before" | "replace_exact";
};

export type TailorResumePendingInterviewStatus =
  | "deciding"
  | "queued"
  | "ready";

export type TailoredResumeEmphasizedTechnologyPriority = "high" | "low";

export type TailoredResumeEmphasizedTechnology = {
  evidence: string;
  name: string;
  priority: TailoredResumeEmphasizedTechnologyPriority;
};

export type TailorResumeWorkspaceState = {
  tailoringInterview: TailorResumePendingInterview | null;
  tailoringInterviews: TailorResumePendingInterview[];
  isBaseResumeStepComplete: boolean;
  updatedAt: string | null;
};

export type TailorResumePromptSettingsState = {
  updatedAt: string | null;
  values: SystemPromptSettings;
};

export type TailorResumeGenerationSettingsState = {
  updatedAt: string | null;
  values: TailorResumeGenerationSettings;
  version: number;
};

export type TailoredResumeBlockGeneratedByStep = 4 | 5;

export type TailoredResumeBlockEditRecord = {
  afterLatexCode: string;
  beforeLatexCode: string;
  command: string | null;
  customLatexCode: string | null;
  editId: string;
  generatedByStep: TailoredResumeBlockGeneratedByStep;
  reason: string;
  state: "applied" | "rejected";
  segmentId: string;
};

export type TailoredResumeThesis = {
  jobDescriptionFocus: string;
  resumeChanges: string;
};

export type TailorResumeGenerationStepStatus =
  | "failed"
  | "running"
  | "skipped"
  | "succeeded";

export type TailorResumeGenerationStepEvent = {
  attempt: number | null;
  detail: string | null;
  durationMs: number;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  retrying: boolean;
  status: TailorResumeGenerationStepStatus;
  stepCount: number;
  stepNumber: number;
  summary: string;
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
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobIdentifier: string;
  positionTitle: string;
  questioningSummary: TailoredResumeQuestioningSummary | null;
  thesis: TailoredResumeThesis;
};

export type TailoredResumeKeywordCoverageTerm = {
  name: string;
  presentInOriginal: boolean;
  presentInTailored: boolean;
  priority: TailoredResumeEmphasizedTechnologyPriority;
};

export type TailoredResumeKeywordCoverageBucket = {
  addedTerms: string[];
  matchedOriginalTerms: string[];
  matchedTailoredTerms: string[];
  originalHitCount: number;
  originalHitPercentage: number;
  tailoredHitCount: number;
  tailoredHitPercentage: number;
  terms: TailoredResumeKeywordCoverageTerm[];
  totalTermCount: number;
};

export type TailoredResumeKeywordCoverage = {
  allPriorities: TailoredResumeKeywordCoverageBucket;
  highPriority: TailoredResumeKeywordCoverageBucket;
  matcherVersion: 1;
  updatedAt: string;
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

export type TailorResumePendingInterview = {
  accumulatedModelDurationMs: number;
  applicationId: string | null;
  completionRequestedAt: string | null;
  conversation: TailorResumeConversationMessage[];
  createdAt: string;
  generationSourceSnapshot: TailorResumeGenerationSourceSnapshot;
  id: string;
  jobDescription: string;
  jobUrl: string | null;
  planningDebug: TailoredResumeOpenAiDebugStage;
  planningResult: TailoredResumePlanningResult;
  pendingUserMarkdownEditOperations: TailorResumeUserMarkdownPatchOperation[];
  status: TailorResumePendingInterviewStatus;
  sourceAnnotatedLatexCode: string;
  tailorResumeRunId: string | null;
  updatedAt: string;
};

export type TailoredResumeRecord = {
  applicationId?: string | null;
  annotatedLatexCode: string;
  archivedAt: string | null;
  companyName: string;
  createdAt: string;
  displayName: string;
  edits: TailoredResumeBlockEditRecord[];
  error: string | null;
  id: string;
  jobDescription: string;
  jobIdentifier: string;
  jobUrl: string | null;
  keywordCoverage: TailoredResumeKeywordCoverage | null;
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
  generationSettings: TailorResumeGenerationSettingsState;
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
    tailoringInterview: null,
    tailoringInterviews: [],
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

export function emptyTailorResumeGenerationSettingsState(): TailorResumeGenerationSettingsState {
  return {
    updatedAt: null,
    values: createDefaultTailorResumeGenerationSettings(),
    version: currentTailorResumeGenerationSettingsVersion,
  };
}

export function emptyTailorResumeProfile(): TailorResumeProfile {
  return {
    annotatedLatex: emptyTailorResumeAnnotatedLatexState(),
    extraction: emptyTailorResumeExtractionState(),
    generationSettings: emptyTailorResumeGenerationSettingsState(),
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

  const tailoringInterviews = parseTailorResumePendingInterviews(
    value.tailoringInterviews,
  );
  const legacyTailoringInterview = parseTailorResumePendingInterview(
    value.tailoringInterview,
  );
  const normalizedTailoringInterviews =
    tailoringInterviews.length > 0
      ? sortTailorResumeWorkspaceInterviews(tailoringInterviews)
      : legacyTailoringInterview
        ? [legacyTailoringInterview]
        : [];

  return {
    tailoringInterview:
      normalizedTailoringInterviews.find(
        (interview) => interview.status === "ready",
      ) ?? null,
    tailoringInterviews: normalizedTailoringInterviews,
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

function parseTailorResumeGenerationSettingsState(
  value: unknown,
): TailorResumeGenerationSettingsState {
  if (!isRecord(value)) {
    return emptyTailorResumeGenerationSettingsState();
  }

  const rawVersion = value.version;
  const version =
    typeof rawVersion === "number" &&
    Number.isFinite(rawVersion) &&
    rawVersion >= 1
      ? Math.floor(rawVersion)
      : 1;
  const values = mergeTailorResumeGenerationSettings(value.values);

  if (
    version < currentTailorResumeGenerationSettingsVersion &&
    values.allowTailorResumeFollowUpQuestions === false
  ) {
    values.allowTailorResumeFollowUpQuestions = true;
  }

  return {
    updatedAt: readNullableString(value.updatedAt),
    values,
    version: currentTailorResumeGenerationSettingsVersion,
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
  const generatedByStep = value.generatedByStep === 5 ? 5 : 4;
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
    generatedByStep,
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
        generatedByStep: edit.generatedByStep,
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
        generatedByStep: edit.generatedByStep,
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

function parseTailoredResumeEmphasizedTechnology(
  value: unknown,
): TailoredResumeEmphasizedTechnology | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name).trim();
  const evidence = readString(value.evidence).trim();
  const priority =
    value.priority === "high" || value.priority === "low"
      ? value.priority
      : null;

  if (!name || !priority) {
    return null;
  }

  return {
    evidence,
    name,
    priority,
  };
}

function normalizeTailoredResumeEmphasizedTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[],
) {
  const normalizedTechnologies =
    new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of technologies) {
    const key = technology.name.toLowerCase();
    const existingTechnology = normalizedTechnologies.get(key);

    if (
      !existingTechnology ||
      (existingTechnology.priority === "low" && technology.priority === "high")
    ) {
      normalizedTechnologies.set(key, technology);
    }
  }

  return [...normalizedTechnologies.values()];
}

function parseTailoredResumeEmphasizedTechnologies(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeTailoredResumeEmphasizedTechnologies(
    value.flatMap((technology) => {
      const parsedTechnology = parseTailoredResumeEmphasizedTechnology(technology);
      return parsedTechnology ? [parsedTechnology] : [];
    }),
  );
}

function readPercentage(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseTailoredResumeKeywordCoverageTerm(
  value: unknown,
): TailoredResumeKeywordCoverageTerm | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name).trim();
  const priority =
    value.priority === "high" || value.priority === "low"
      ? value.priority
      : null;

  if (!name || !priority) {
    return null;
  }

  return {
    name,
    presentInOriginal: value.presentInOriginal === true,
    presentInTailored: value.presentInTailored === true,
    priority,
  };
}

function parseTailoredResumeKeywordCoverageTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeKeywordCoverageTerm[];
  }

  return value
    .map(parseTailoredResumeKeywordCoverageTerm)
    .filter((term): term is TailoredResumeKeywordCoverageTerm =>
      Boolean(term),
    );
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseTailoredResumeKeywordCoverageBucket(
  value: unknown,
): TailoredResumeKeywordCoverageBucket | null {
  if (!isRecord(value)) {
    return null;
  }

  const terms = parseTailoredResumeKeywordCoverageTerms(value.terms);
  const totalTermCount =
    typeof value.totalTermCount === "number" && Number.isFinite(value.totalTermCount)
      ? Math.max(0, Math.floor(value.totalTermCount))
      : terms.length;
  const originalHitCount =
    typeof value.originalHitCount === "number" && Number.isFinite(value.originalHitCount)
      ? Math.max(0, Math.floor(value.originalHitCount))
      : terms.filter((term) => term.presentInOriginal).length;
  const tailoredHitCount =
    typeof value.tailoredHitCount === "number" && Number.isFinite(value.tailoredHitCount)
      ? Math.max(0, Math.floor(value.tailoredHitCount))
      : terms.filter((term) => term.presentInTailored).length;

  return {
    addedTerms: parseStringArray(value.addedTerms),
    matchedOriginalTerms: parseStringArray(value.matchedOriginalTerms),
    matchedTailoredTerms: parseStringArray(value.matchedTailoredTerms),
    originalHitCount,
    originalHitPercentage: readPercentage(value.originalHitPercentage),
    tailoredHitCount,
    tailoredHitPercentage: readPercentage(value.tailoredHitPercentage),
    terms,
    totalTermCount,
  };
}

function parseTailoredResumeKeywordCoverage(
  value: unknown,
): TailoredResumeKeywordCoverage | null {
  if (!isRecord(value)) {
    return null;
  }

  const highPriority = parseTailoredResumeKeywordCoverageBucket(
    value.highPriority,
  );
  const allPriorities = parseTailoredResumeKeywordCoverageBucket(
    value.allPriorities,
  );
  const updatedAt = readNullableString(value.updatedAt);

  if (!highPriority || !allPriorities || !updatedAt) {
    return null;
  }

  return {
    allPriorities,
    highPriority,
    matcherVersion: 1,
    updatedAt,
  };
}

function parseTailoredResumeQuestionLearning(
  value: unknown,
): TailoredResumeQuestionLearning | null {
  if (!isRecord(value)) {
    return null;
  }

  const topic = readNullableString(value.topic)?.trim() ?? "";
  const detail = readNullableString(value.detail)?.trim() ?? "";

  if (!topic || !detail || !Array.isArray(value.targetSegmentIds)) {
    return null;
  }

  const targetSegmentIds = value.targetSegmentIds.flatMap((segmentId) => {
    const parsedSegmentId = readNullableString(segmentId)?.trim() ?? "";
    return parsedSegmentId ? [parsedSegmentId] : [];
  });

  if (targetSegmentIds.length !== value.targetSegmentIds.length) {
    return null;
  }

  return {
    detail,
    targetSegmentIds,
    topic,
  };
}

function parseTailoredResumeQuestioningSummary(
  value: unknown,
): TailoredResumeQuestioningSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const agenda = readNullableString(value.agenda)?.trim() ?? "";
  const debugDecision =
    value.debugDecision === "forced_only" ||
    value.debugDecision === "not_applicable" ||
    value.debugDecision === "would_ask_without_debug"
      ? value.debugDecision
      : value.debugDecision == null
        ? null
        : "__invalid__";
  const rawAskedQuestionCount = value.askedQuestionCount;

  if (
    !Array.isArray(value.learnings) ||
    debugDecision === "__invalid__" ||
    typeof rawAskedQuestionCount !== "number" ||
    !Number.isFinite(rawAskedQuestionCount)
  ) {
    return null;
  }

  const learnings = value.learnings.flatMap((learning) => {
    const parsedLearning = parseTailoredResumeQuestionLearning(learning);
    return parsedLearning ? [parsedLearning] : [];
  });

  if (learnings.length !== value.learnings.length) {
    return null;
  }

  return {
    agenda,
    askedQuestionCount: Math.max(0, Math.floor(rawAskedQuestionCount)),
    debugDecision,
    learnings,
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
  const questioningSummary = parseTailoredResumeQuestioningSummary(
    value.questioningSummary,
  );
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
    emphasizedTechnologies: parseTailoredResumeEmphasizedTechnologies(
      value.emphasizedTechnologies,
    ),
    jobIdentifier,
    positionTitle,
    questioningSummary,
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
    emphasizedTechnologies: [],
    jobIdentifier: input.jobIdentifier,
    positionTitle: input.positionTitle,
    questioningSummary: null,
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

function parseTailorResumeGenerationSourceSnapshot(
  value: unknown,
): TailorResumeGenerationSourceSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const latexCode = readNullableString(value.latexCode);
  const linkState = readNullableString(value.linkState);
  const lockedLinkState = readNullableString(value.lockedLinkState);
  const resumeStoragePath = readNullableString(value.resumeStoragePath);
  const resumeUpdatedAt = readNullableString(value.resumeUpdatedAt);

  if (!latexCode || !linkState || !lockedLinkState) {
    return null;
  }

  return {
    latexCode,
    linkState,
    lockedLinkState,
    resumeStoragePath,
    resumeUpdatedAt,
  };
}

function parseTailorResumeConversationMessage(
  value: unknown,
  index: number,
): TailorResumeConversationMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const text = readNullableString(value.text)?.trim() ?? "";
  const role = value.role === "user" ? "user" : value.role === "assistant" ? "assistant" : null;
  const id =
    readNullableString(value.id) ??
    (role ? `tailor-resume-conversation-${role}-${index + 1}` : null);

  if (!id || !role || !text) {
    return null;
  }

  return {
    id,
    role,
    technologyContexts: parseTailorResumeTechnologyContexts(
      value.technologyContexts,
    ),
    text,
    toolCalls: parseTailorResumeConversationToolCalls(value.toolCalls),
  };
}

function parseTailorResumeTechnologyContext(
  value: unknown,
): TailorResumeTechnologyContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readNullableString(value.name)?.trim() ?? "";
  const definition = readNullableString(value.definition)?.trim() ?? "";
  const examples = Array.isArray(value.examples)
    ? value.examples
        .map((example) => readNullableString(example)?.trim() ?? "")
        .filter(Boolean)
    : [];

  if (!name || !definition || examples.length < 2) {
    return null;
  }

  return {
    definition,
    examples,
    name,
  };
}

function parseTailorResumeTechnologyContexts(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeTechnologyContext[];
  }

  return value.flatMap((entry) => {
    const parsedEntry = parseTailorResumeTechnologyContext(entry);
    return parsedEntry ? [parsedEntry] : [];
  });
}

function parseTailorResumeConversationToolCall(
  value: unknown,
): TailorResumeConversationToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readNullableString(value.name)?.trim() ?? "";
  const argumentsText =
    typeof value.argumentsText === "string" ? value.argumentsText : null;

  if (!name || argumentsText === null) {
    return null;
  }

  return {
    argumentsText,
    name,
  };
}

function parseTailorResumeConversationToolCalls(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeConversationToolCall[];
  }

  return value.flatMap((toolCall) => {
    const parsedToolCall = parseTailorResumeConversationToolCall(toolCall);
    return parsedToolCall ? [parsedToolCall] : [];
  });
}

function parseTailorResumeConversationMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeConversationMessage[];
  }

  return value.flatMap((message, index) => {
    const parsedMessage = parseTailorResumeConversationMessage(message, index);
    return parsedMessage ? [parsedMessage] : [];
  });
}

function parseTailorResumeUserMarkdownPatchOperations(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeUserMarkdownPatchOperation[];
  }

  return value.flatMap((operation) => {
    if (!isRecord(operation)) {
      return [];
    }

    const op =
      operation.op === "append" ||
      operation.op === "delete_exact" ||
      operation.op === "insert_after" ||
      operation.op === "insert_before" ||
      operation.op === "replace_exact"
        ? operation.op
        : null;

    if (!op) {
      return [];
    }

    return [
      {
        anchorMarkdown: readNullableString(operation.anchorMarkdown) ?? undefined,
        headingPath: Array.isArray(operation.headingPath)
          ? operation.headingPath.flatMap((heading) => {
              const parsedHeading = readNullableString(heading)?.trim() ?? "";
              return parsedHeading ? [parsedHeading] : [];
            })
          : undefined,
        markdown: readNullableString(operation.markdown) ?? undefined,
        newMarkdown: readNullableString(operation.newMarkdown) ?? undefined,
        oldMarkdown: readNullableString(operation.oldMarkdown) ?? undefined,
        op,
      } satisfies TailorResumeUserMarkdownPatchOperation,
    ];
  });
}

function parseTailorResumePendingInterview(
  value: unknown,
): TailorResumePendingInterview | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNullableString(value.id);
  const createdAt = readNullableString(value.createdAt);
  const updatedAt = readNullableString(value.updatedAt);
  const jobDescription = readNullableString(value.jobDescription);
  const jobUrl = readNullableString(value.jobUrl);
  const sourceAnnotatedLatexCode = readNullableString(value.sourceAnnotatedLatexCode);
  const planningDebug = parseTailoredResumeOpenAiDebugStage(value.planningDebug);
  const planningResult = parseTailoredResumePlanningResult(value.planningResult);
  const generationSourceSnapshot = parseTailorResumeGenerationSourceSnapshot(
    value.generationSourceSnapshot,
  );
  const accumulatedModelDurationMs =
    typeof value.accumulatedModelDurationMs === "number" &&
    Number.isFinite(value.accumulatedModelDurationMs)
      ? Math.max(0, value.accumulatedModelDurationMs)
      : null;
  const conversation = parseTailorResumeConversationMessages(value.conversation);
  const status =
    value.status === "queued" || value.status === "deciding"
      ? value.status
      : "ready";
  const pendingUserMarkdownEditOperations =
    parseTailorResumeUserMarkdownPatchOperations(
      value.pendingUserMarkdownEditOperations,
    );

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    jobDescription === null ||
    sourceAnnotatedLatexCode === null ||
    !planningDebug ||
    !planningResult ||
    !generationSourceSnapshot ||
    accumulatedModelDurationMs === null ||
    !Array.isArray(value.conversation) ||
    conversation.length !== value.conversation.length
  ) {
    return null;
  }

  return {
    accumulatedModelDurationMs,
    applicationId: readNullableString(value.applicationId),
    completionRequestedAt: readNullableString(value.completionRequestedAt),
    conversation,
    createdAt,
    generationSourceSnapshot,
    id,
    jobDescription,
    jobUrl,
    planningDebug,
    planningResult,
    pendingUserMarkdownEditOperations,
    status,
    sourceAnnotatedLatexCode,
    tailorResumeRunId: readNullableString(value.tailorResumeRunId),
    updatedAt,
  };
}

function parseTailorResumePendingInterviews(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumePendingInterview[];
  }

  return value.flatMap((entry) => {
    const parsedInterview = parseTailorResumePendingInterview(entry);
    return parsedInterview ? [parsedInterview] : [];
  });
}

function parseTailoredResumeRecord(value: unknown): TailoredResumeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNullableString(value.id);
  const displayName = readNullableString(value.displayName);
  const jobDescription = readNullableString(value.jobDescription);
  const jobUrl = readNullableString(value.jobUrl);
  const latexCode = readNullableString(value.latexCode);
  const annotatedLatexCode = readNullableString(value.annotatedLatexCode);
  const createdAt = readNullableString(value.createdAt);
  const updatedAt = readNullableString(value.updatedAt);
  const pdfUpdatedAt = readNullableString(value.pdfUpdatedAt);
  const archivedAt = readNullableString(value.archivedAt);
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
    applicationId: readNullableString(value.applicationId),
    annotatedLatexCode,
    archivedAt,
    companyName,
    createdAt,
    displayName,
    edits: parseTailoredResumeBlockEditRecords(value.edits),
    error,
    id,
    jobDescription,
    jobIdentifier,
    jobUrl,
    keywordCoverage: parseTailoredResumeKeywordCoverage(value.keywordCoverage),
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
    generationSettings: parseTailorResumeGenerationSettingsState(
      value.generationSettings,
    ),
    jobDescription: readString(value.jobDescription),
    latex: parseTailorResumeLatexState(value.latex),
    links: parseTailorResumeLinkRecords(value.links),
    promptSettings: parseTailorResumePromptSettingsState(value.promptSettings),
    resume: parseSavedResumeRecord(value.resume),
    tailoredResumes: parseTailoredResumeRecords(value.tailoredResumes),
    workspace: parseTailorResumeWorkspaceState(value.workspace),
  };
}
