export const CAPTURE_COMMAND_NAME = "capture_job_page";
const fallbackAppBaseUrl = "http://localhost:3000";
export const EXTENSION_DEBUG_UI_ENABLED = __DEBUG_UI__;

function normalizeAppBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return fallbackAppBaseUrl;
  }

  try {
    return new URL(trimmedValue).origin;
  } catch {
    return fallbackAppBaseUrl;
  }
}

export const DEFAULT_APP_BASE_URL = normalizeAppBaseUrl(
  import.meta.env.VITE_JOB_HELPER_APP_BASE_URL,
);
export const DEFAULT_DASHBOARD_URL = `${DEFAULT_APP_BASE_URL}/dashboard`;
export const DEFAULT_JOB_APPLICATIONS_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/job-applications`;
export const DEFAULT_TAILOR_RESUME_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/tailor-resume`;
export const DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT =
  `${DEFAULT_TAILOR_RESUME_ENDPOINT}/chat`;
export const DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT =
  `${DEFAULT_TAILOR_RESUME_ENDPOINT}/preview`;
export const EXTENSION_AUTH_GOOGLE_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/google`;
export const EXTENSION_AUTH_SESSION_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/session`;
export const EXTENSION_BROWSER_SESSION_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/browser-session`;
export const AUTH_SESSION_STORAGE_KEY = "jobHelperAuthSession";
export const EXTENSION_PREFERENCES_STORAGE_KEY = "jobHelperExtensionPreferences";
export const LAST_TAILORING_STORAGE_KEY = "jobHelperLastTailoringRun";
export const EXISTING_TAILORING_STORAGE_KEY =
  "jobHelperExistingTailoringPrompt";
export const PREPARING_TAILORING_STORAGE_KEY =
  "jobHelperPreparingTailoringStart";

export function buildTailoredResumeReviewUrl(
  tailoredResumeId: string | null | undefined,
) {
  const normalizedTailoredResumeId = tailoredResumeId?.trim();

  if (!normalizedTailoredResumeId) {
    return `${DEFAULT_DASHBOARD_URL}?tab=tailor`;
  }

  return `${DEFAULT_DASHBOARD_URL}?${new URLSearchParams({
    tab: "tailor",
    tailoredResumeId: normalizedTailoredResumeId,
  }).toString()}`;
}

export function normalizeComparableUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    parsedUrl.hash = "";
    parsedUrl.search = "";
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      // Treat http/https variants of the same posting as one comparable URL.
      parsedUrl.protocol = "https:";
    }
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}

export type JobPostingStructuredHint = {
  baseSalary: string[];
  datePosted: string | null;
  description: string | null;
  directApply: boolean | null;
  employmentType: string[];
  hiringOrganization: string | null;
  identifier: string | null;
  locations: string[];
  title: string | null;
  validThrough: string | null;
};

export type JobPageContext = {
  canonicalUrl: string;
  companyCandidates: string[];
  description: string;
  employmentTypeCandidates: string[];
  headings: string[];
  jsonLdJobPostings: JobPostingStructuredHint[];
  locationCandidates: string[];
  rawText: string;
  salaryMentions: string[];
  selectionText: string;
  siteName: string;
  title: string;
  titleCandidates: string[];
  topTextBlocks: string[];
  url: string;
};

export type TailorResumeApplicationContext = {
  companyName: string | null;
  employmentType: string | null;
  jobTitle: string | null;
  location: string | null;
  pageTitle: string | null;
};

export type TailorResumeRunRecord = {
  capturedAt: string;
  endpoint: string;
  companyName: string | null;
  generationStep?: TailorResumeGenerationStepSummary | null;
  jobIdentifier: string | null;
  message: string;
  pageTitle: string | null;
  pageUrl: string | null;
  positionTitle: string | null;
  status: "error" | "needs_input" | "running" | "success";
  tailoredResumeError: string | null;
  tailoredResumeId: string | null;
};

export type TailorResumePreparationState = {
  capturedAt: string;
  message: string;
  pageTitle: string | null;
  pageUrl: string | null;
};

export type TailoredResumeSummary = {
  companyName: string | null;
  displayName: string;
  id: string;
  jobIdentifier: string | null;
  jobUrl: string | null;
  positionTitle: string | null;
  status: string | null;
  updatedAt: string;
};

export type TrackedApplicationSummary = {
  appliedAt: string;
  companyName: string;
  id: string;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  status: string;
  updatedAt: string;
};

export type OriginalResumeSummary = {
  error: string | null;
  filename: string | null;
  latexStatus: string | null;
  pdfUpdatedAt: string | null;
  resumeUpdatedAt: string | null;
};

export type PersonalInfoSummary = {
  activeTailoring: TailorResumeExistingTailoringState | null;
  applicationCount: number;
  applications: TrackedApplicationSummary[];
  companyCount: number;
  originalResume: OriginalResumeSummary;
  tailoredResumes: TailoredResumeSummary[];
  tailoringInterview: TailorResumePendingInterviewSummary | null;
};

export type TailorResumeConversationMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  toolCalls: TailorResumeConversationToolCall[];
};

export type TailorResumeConversationToolCall = {
  argumentsText: string;
  name: string;
};

export type TailorResumeQuestioningSummary = {
  agenda: string;
  askedQuestionCount: number;
  learningsCount: number;
};

export type TailorResumePendingInterviewSummary = {
  companyName: string | null;
  completionRequestedAt: string | null;
  conversation: TailorResumeConversationMessage[];
  id: string;
  jobIdentifier: string | null;
  positionTitle: string | null;
  questioningSummary: TailorResumeQuestioningSummary | null;
  updatedAt: string;
};

export type TailorResumeGenerationStepSummary = {
  attempt: number | null;
  detail: string | null;
  retrying: boolean;
  status: "failed" | "running" | "skipped" | "succeeded";
  stepCount: number;
  stepNumber: number;
  summary: string;
};

export type TailorResumeExistingTailoringState =
  | {
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "active_generation";
      lastStep: TailorResumeGenerationStepSummary | null;
      updatedAt: string;
    }
  | {
      companyName: string | null;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "pending_interview";
      positionTitle: string | null;
      questionCount: number | null;
      updatedAt: string;
    }
  | {
      companyName: string | null;
      displayName: string;
      error: string | null;
      id: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "completed";
      positionTitle: string | null;
      status: string;
      tailoredResumeId: string;
      updatedAt: string;
    };

export type TailorResumeProfileSummary = {
  tailoredResumes: TailoredResumeSummary[];
  tailoringInterview: TailorResumePendingInterviewSummary | null;
};

export type JobHelperAuthUser = {
  email: string | null;
  id: string;
  image: string | null;
  name: string | null;
};

export type JobHelperAuthSession = {
  expires: string;
  sessionToken: string;
  user: JobHelperAuthUser;
};

export function buildTailorResumePreparationMessage(overwriteExisting = false) {
  return overwriteExisting
    ? "Starting tailored edits..."
    : "Checking if this job already has tailoring...";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNullableString(value: unknown) {
  const stringValue = readString(value);
  return stringValue || null;
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = cleanText(value);

    if (!normalizedValue) {
      continue;
    }

    const dedupeKey = normalizedValue.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalizedValue);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildSummaryLine(label: string, values: string[], limit = 6) {
  const normalizedValues = uniqueStrings(values, limit);

  if (normalizedValues.length === 0) {
    return null;
  }

  return `${label}: ${normalizedValues.join(", ")}`;
}

function firstCleanText(values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalizedValue = cleanText(value);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
}

function normalizeApplicationLocation(value: string | null) {
  const normalizedValue = value?.toLowerCase() ?? "";

  if (normalizedValue.includes("hybrid")) {
    return "hybrid";
  }

  if (normalizedValue.includes("remote")) {
    return "remote";
  }

  if (
    normalizedValue.includes("on-site") ||
    normalizedValue.includes("onsite") ||
    normalizedValue.includes("in-office") ||
    normalizedValue.includes("office")
  ) {
    return "onsite";
  }

  return null;
}

function normalizeApplicationEmploymentType(value: string | null) {
  const normalizedValue = value
    ?.toLowerCase()
    .replace(/[-\s]+/g, "_")
    .trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.includes("full_time") || normalizedValue.includes("fulltime")) {
    return "full_time";
  }

  if (normalizedValue.includes("part_time") || normalizedValue.includes("parttime")) {
    return "part_time";
  }

  if (normalizedValue.includes("contract")) {
    return "contract";
  }

  if (normalizedValue.includes("intern")) {
    return "internship";
  }

  return null;
}

export function buildTailorResumeApplicationContext(
  pageContext: JobPageContext,
): TailorResumeApplicationContext {
  const primaryStructuredPosting = pageContext.jsonLdJobPostings[0] ?? null;

  return {
    companyName: firstCleanText([
      primaryStructuredPosting?.hiringOrganization,
      ...pageContext.companyCandidates,
      pageContext.siteName,
    ]),
    employmentType: normalizeApplicationEmploymentType(
      firstCleanText([
        ...(primaryStructuredPosting?.employmentType ?? []),
        ...pageContext.employmentTypeCandidates,
      ]),
    ),
    jobTitle: firstCleanText([
      primaryStructuredPosting?.title,
      ...pageContext.titleCandidates,
      pageContext.title,
    ]),
    location: normalizeApplicationLocation(
      firstCleanText([
        ...(primaryStructuredPosting?.locations ?? []),
        ...pageContext.locationCandidates,
      ]),
    ),
    pageTitle: cleanText(pageContext.title) || null,
  };
}

function formatStructuredPosting(
  posting: JobPageContext["jsonLdJobPostings"][number],
  index: number,
) {
  const lines = [
    posting.title ? `Title: ${posting.title}` : null,
    posting.hiringOrganization
      ? `Company: ${posting.hiringOrganization}`
      : null,
    buildSummaryLine("Employment type", posting.employmentType),
    buildSummaryLine("Locations", posting.locations),
    buildSummaryLine("Compensation", posting.baseSalary),
    posting.datePosted ? `Date posted: ${posting.datePosted}` : null,
    posting.validThrough ? `Valid through: ${posting.validThrough}` : null,
    posting.directApply === true
      ? "Direct apply: yes"
      : posting.directApply === false
        ? "Direct apply: no"
        : null,
    posting.description ? `Description:\n${posting.description}` : null,
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return null;
  }

  return [`Structured job posting ${index + 1}:`, ...lines].join("\n");
}

export function buildJobDescriptionFromPageContext(pageContext: JobPageContext) {
  const sections: string[] = [];
  const summaryLines = [
    pageContext.url ? `URL: ${pageContext.url}` : null,
    pageContext.canonicalUrl &&
    pageContext.canonicalUrl !== pageContext.url
      ? `Canonical URL: ${pageContext.canonicalUrl}`
      : null,
    pageContext.title ? `Page title: ${pageContext.title}` : null,
    pageContext.siteName ? `Site name: ${pageContext.siteName}` : null,
    pageContext.description
      ? `Meta description: ${pageContext.description}`
      : null,
    buildSummaryLine("Role title hints", pageContext.titleCandidates),
    buildSummaryLine("Company hints", pageContext.companyCandidates),
    buildSummaryLine("Location hints", pageContext.locationCandidates),
    buildSummaryLine(
      "Employment type hints",
      pageContext.employmentTypeCandidates,
    ),
    buildSummaryLine("Salary hints", pageContext.salaryMentions),
    buildSummaryLine("Visible headings", pageContext.headings, 12),
  ].filter((line): line is string => Boolean(line));

  if (summaryLines.length > 0) {
    sections.push(["Job page summary:", ...summaryLines].join("\n"));
  }

  if (pageContext.selectionText) {
    sections.push(`Selected text from the page:\n${pageContext.selectionText}`);
  }

  const structuredPostings = pageContext.jsonLdJobPostings
    .map(formatStructuredPosting)
    .filter((section): section is string => Boolean(section));

  if (structuredPostings.length > 0) {
    sections.push(structuredPostings.join("\n\n"));
  }

  const topTextBlocks = uniqueStrings(pageContext.topTextBlocks, 5);

  if (topTextBlocks.length > 0) {
    sections.push(
      [
        "Main page text:",
        ...topTextBlocks.map(
          (block, index) => `Section ${index + 1}:\n${block}`,
        ),
      ].join("\n\n"),
    );
  }

  if (pageContext.rawText) {
    sections.push(`Full flattened page text:\n${pageContext.rawText}`);
  }

  return sections.join("\n\n").trim();
}

export function readJobUrlFromPageContext(pageContext: JobPageContext) {
  return pageContext.canonicalUrl.trim() || pageContext.url.trim() || null;
}

export function buildTailorResumePreparationState(input: {
  capturedAt?: string;
  message?: string | null;
  pageContext?: JobPageContext | null;
  pageTitle?: string | null;
  pageUrl?: string | null;
}) {
  return {
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    message:
      cleanText(input.message) || buildTailorResumePreparationMessage(false),
    pageTitle: cleanText(input.pageContext?.title ?? input.pageTitle) || null,
    pageUrl:
      cleanText(
        input.pageContext
          ? readJobUrlFromPageContext(input.pageContext) ?? input.pageContext.url
          : input.pageUrl,
      ) || null,
  } satisfies TailorResumePreparationState;
}

export function readTailoredResumeSummary(
  value: unknown,
): TailoredResumeSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const displayName = readString(value.displayName);
  const updatedAt = readString(value.updatedAt);

  if (!id || !displayName || !updatedAt) {
    return null;
  }

  return {
    companyName: readString(value.companyName) || null,
    displayName,
    id,
    jobIdentifier: readNullableString(value.jobIdentifier),
    jobUrl: readNullableString(value.jobUrl),
    positionTitle: readString(value.positionTitle) || null,
    status: readString(value.status) || null,
    updatedAt,
  };
}

export function readTailoredResumeSummaries(value: unknown) {
  const tailoredResumes = Array.isArray(value)
    ? value
    : isRecord(value) &&
        isRecord(value.profile) &&
        Array.isArray(value.profile.tailoredResumes)
      ? value.profile.tailoredResumes
      : [];

  return tailoredResumes
    .map(readTailoredResumeSummary)
    .filter((record): record is TailoredResumeSummary => Boolean(record))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function readTailorResumePreparationState(
  value: unknown,
): TailorResumePreparationState | null {
  if (!isRecord(value)) {
    return null;
  }

  const capturedAt = readString(value.capturedAt);
  const message = readString(value.message);

  if (!capturedAt || !message) {
    return null;
  }

  return {
    capturedAt,
    message,
    pageTitle: readNullableString(value.pageTitle),
    pageUrl: readNullableString(value.pageUrl),
  };
}

function readTailorResumeConversationMessage(
  value: unknown,
): TailorResumeConversationMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const text = readString(value.text);
  const role =
    value.role === "assistant" || value.role === "user" ? value.role : null;

  if (!id || !text || !role) {
    return null;
  }

  return {
    id,
    role,
    text,
    toolCalls: readTailorResumeConversationToolCalls(value.toolCalls),
  };
}

function readTailorResumeConversationToolCall(
  value: unknown,
): TailorResumeConversationToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);

  if (!name || typeof value.argumentsText !== "string") {
    return null;
  }

  return {
    argumentsText: value.argumentsText,
    name,
  };
}

function readTailorResumeConversationToolCalls(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeConversationToolCall[];
  }

  return value
    .map(readTailorResumeConversationToolCall)
    .filter((toolCall): toolCall is TailorResumeConversationToolCall =>
      Boolean(toolCall),
    );
}

function readTailorResumeQuestioningSummary(
  value: unknown,
): TailorResumeQuestioningSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const askedQuestionCount = readNumber(value.askedQuestionCount);

  return {
    agenda: readString(value.agenda),
    askedQuestionCount:
      askedQuestionCount > 0 ? Math.floor(askedQuestionCount) : 1,
    learningsCount: Array.isArray(value.learnings) ? value.learnings.length : 0,
  };
}

export function readTailorResumeGenerationStepSummary(
  value: unknown,
): TailorResumeGenerationStepSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const stepNumber = readNumber(value.stepNumber);
  const stepCount = readNumber(value.stepCount);
  const rawStatus = value.status;
  const status =
    rawStatus === "failed" ||
    rawStatus === "running" ||
    rawStatus === "skipped" ||
    rawStatus === "succeeded"
      ? rawStatus
      : null;
  const summary = readString(value.summary);

  if (!stepNumber || !stepCount || !status || !summary) {
    return null;
  }

  const attempt = readNumber(value.attempt);

  return {
    attempt: attempt > 0 ? Math.floor(attempt) : null,
    detail: readNullableString(value.detail),
    retrying: value.retrying === true,
    status,
    stepCount: Math.max(1, Math.floor(stepCount)),
    stepNumber: Math.max(1, Math.floor(stepNumber)),
    summary,
  };
}

function readExistingTailoringQuestionCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (!isRecord(value)) {
    return null;
  }

  const asked = readNumber(value.asked);

  return asked > 0 ? Math.floor(asked) : null;
}

export function readTailorResumeExistingTailoringState(
  value: unknown,
): TailorResumeExistingTailoringState | null {
  const existingTailoring =
    isRecord(value) && isRecord(value.existingTailoring)
      ? value.existingTailoring
      : value;

  if (!isRecord(existingTailoring)) {
    return null;
  }

  const id = readString(existingTailoring.id);
  const kind = readString(existingTailoring.kind);
  const updatedAt = readString(existingTailoring.updatedAt);

  if (!id || !updatedAt) {
    return null;
  }

  if (kind === "active_generation") {
    const createdAt = readString(existingTailoring.createdAt);
    const jobDescription = readString(existingTailoring.jobDescription);

    if (!createdAt) {
      return null;
    }

    return {
      createdAt,
      id,
      jobDescription,
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      lastStep: readTailorResumeGenerationStepSummary(
        existingTailoring.lastStep,
      ),
      updatedAt,
    };
  }

  if (kind === "pending_interview") {
    return {
      companyName: readNullableString(existingTailoring.companyName),
      id,
      jobDescription: readString(existingTailoring.jobDescription),
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      positionTitle: readNullableString(existingTailoring.positionTitle),
      questionCount: readExistingTailoringQuestionCount(
        existingTailoring.questionCount,
      ),
      updatedAt,
    };
  }

  if (kind === "completed") {
    const displayName = readString(existingTailoring.displayName);
    const tailoredResumeId = readString(existingTailoring.tailoredResumeId);

    if (!displayName || !tailoredResumeId) {
      return null;
    }

    return {
      companyName: readNullableString(existingTailoring.companyName),
      displayName,
      error: readNullableString(existingTailoring.error),
      id,
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      positionTitle: readNullableString(existingTailoring.positionTitle),
      status: readString(existingTailoring.status) || "ready",
      tailoredResumeId,
      updatedAt,
    };
  }

  return null;
}

export function readTailorResumePendingInterviewSummary(
  value: unknown,
): TailorResumePendingInterviewSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const updatedAt = readString(value.updatedAt);
  const conversation = Array.isArray(value.conversation)
    ? value.conversation
        .map(readTailorResumeConversationMessage)
        .filter((message): message is TailorResumeConversationMessage =>
          Boolean(message),
        )
    : [];

  if (!id || !updatedAt || conversation.length === 0) {
    return null;
  }

  const planningResult = isRecord(value.planningResult)
    ? value.planningResult
    : {};

  return {
    companyName: readNullableString(planningResult.companyName),
    completionRequestedAt: readNullableString(value.completionRequestedAt),
    conversation,
    id,
    jobIdentifier: readNullableString(planningResult.jobIdentifier),
    positionTitle: readNullableString(planningResult.positionTitle),
    questioningSummary: readTailorResumeQuestioningSummary(
      planningResult.questioningSummary,
    ),
    updatedAt,
  };
}

export function readTailorResumeProfileSummary(
  value: unknown,
): TailorResumeProfileSummary | null {
  const profile = isRecord(value) && isRecord(value.profile) ? value.profile : value;

  if (!isRecord(profile)) {
    return null;
  }

  const workspace = isRecord(profile.workspace) ? profile.workspace : {};

  return {
    tailoredResumes: readTailoredResumeSummaries(profile.tailoredResumes),
    tailoringInterview: readTailorResumePendingInterviewSummary(
      workspace.tailoringInterview,
    ),
  };
}

function readTrackedApplicationSummary(
  value: unknown,
): TrackedApplicationSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const jobTitle = readString(value.jobTitle);
  const companyName = readString(value.companyName);
  const appliedAt = readString(value.appliedAt);
  const updatedAt = readString(value.updatedAt);

  if (!id || !jobTitle || !companyName || !appliedAt || !updatedAt) {
    return null;
  }

  return {
    appliedAt,
    companyName,
    id,
    jobTitle,
    jobUrl: readNullableString(value.jobUrl),
    location: readNullableString(value.location),
    status: readString(value.status) || "APPLIED",
    updatedAt,
  };
}

export function readTrackedApplicationSummaries(value: unknown) {
  const applications = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.applications)
      ? value.applications
      : [];

  return applications
    .map(readTrackedApplicationSummary)
    .filter((record): record is TrackedApplicationSummary => Boolean(record));
}

export function readOriginalResumeSummary(value: unknown): OriginalResumeSummary {
  if (
    isRecord(value) &&
    ("filename" in value || "latexStatus" in value || "pdfUpdatedAt" in value)
  ) {
    return {
      error: readNullableString(value.error),
      filename: readNullableString(value.filename),
      latexStatus: readNullableString(value.latexStatus),
      pdfUpdatedAt: readNullableString(value.pdfUpdatedAt),
      resumeUpdatedAt: readNullableString(value.resumeUpdatedAt),
    };
  }

  const profile =
    isRecord(value) && isRecord(value.profile) ? value.profile : value;
  const resume = isRecord(profile) && isRecord(profile.resume)
    ? profile.resume
    : null;
  const latex = isRecord(profile) && isRecord(profile.latex)
    ? profile.latex
    : null;

  return {
    error: latex ? readNullableString(latex.error) : null,
    filename: resume ? readNullableString(resume.originalFilename) : null,
    latexStatus: latex ? readNullableString(latex.status) : null,
    pdfUpdatedAt: latex ? readNullableString(latex.pdfUpdatedAt) : null,
    resumeUpdatedAt: resume ? readNullableString(resume.updatedAt) : null,
  };
}

export function readPersonalInfoSummary(input: {
  applicationsPayload: unknown;
  tailorResumePayload: unknown;
}): PersonalInfoSummary {
  const applicationsPayload = isRecord(input.applicationsPayload)
    ? input.applicationsPayload
    : {};
  const tailorResumeProfile = readTailorResumeProfileSummary(
    input.tailorResumePayload,
  );

  return {
    activeTailoring: readTailorResumeExistingTailoringState(
      input.tailorResumePayload,
    ),
    applicationCount: readNumber(applicationsPayload.applicationCount),
    applications: readTrackedApplicationSummaries(applicationsPayload),
    companyCount: readNumber(applicationsPayload.companyCount),
    originalResume: readOriginalResumeSummary(input.tailorResumePayload),
    tailoredResumes: tailorResumeProfile?.tailoredResumes ?? [],
    tailoringInterview: tailorResumeProfile?.tailoringInterview ?? null,
  };
}

export function readPersonalInfoPayload(value: unknown): PersonalInfoSummary {
  const payload = isRecord(value) && isRecord(value.personalInfo)
    ? value.personalInfo
    : value;
  const payloadRecord = isRecord(payload) ? payload : {};

  return {
    activeTailoring: readTailorResumeExistingTailoringState(
      payloadRecord.activeTailoring,
    ),
    applicationCount: readNumber(payloadRecord.applicationCount),
    applications: readTrackedApplicationSummaries(payloadRecord.applications),
    companyCount: readNumber(payloadRecord.companyCount),
    originalResume: readOriginalResumeSummary(payloadRecord.originalResume),
    tailoredResumes: readTailoredResumeSummaries(payloadRecord.tailoredResumes),
    tailoringInterview: readTailorResumePendingInterviewSummary(
      payloadRecord.tailoringInterview,
    ),
  };
}
