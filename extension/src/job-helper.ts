import {
  emptyUserSyncStateSnapshot,
  readUserSyncStateSnapshot,
  type UserSyncStateSnapshot,
} from "../../lib/sync-state.ts";
export {
  currentUrlMatchesSavedJobUrl,
  normalizeComparableUrl,
} from "./comparable-job-url.ts";

export const defaultUserMarkdown = "# USER.md\n\n";
export const maxNonTechnologyTermLength = 120;
export const maxNonTechnologyTermCount = 200;

export function normalizeNonTechnologyTerm(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatTermWithCapitalFirst(value: string) {
  const term = value.trim().replace(/\s+/g, " ");

  if (!term) {
    return "";
  }

  return `${term.slice(0, 1).toUpperCase()}${term.slice(1)}`;
}

export function formatNonTechnologyTerm(value: string) {
  const normalizedTerm = normalizeNonTechnologyTerm(value);

  if (!normalizedTerm) {
    return "";
  }

  return formatTermWithCapitalFirst(normalizedTerm);
}

export function normalizeNonTechnologyTerms(values: readonly string[]) {
  const seenTerms = new Set<string>();
  const normalizedTerms: string[] = [];

  for (const value of values) {
    const normalizedTerm = normalizeNonTechnologyTerm(value);

    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }

    if (normalizedTerm.length > maxNonTechnologyTermLength) {
      throw new Error(
        `Keep non-technology terms under ${maxNonTechnologyTermLength.toLocaleString()} characters each.`,
      );
    }

    seenTerms.add(normalizedTerm);
    normalizedTerms.push(normalizedTerm);
  }

  if (normalizedTerms.length > maxNonTechnologyTermCount) {
    throw new Error(
      `Keep the non-technology list under ${maxNonTechnologyTermCount.toLocaleString()} terms.`,
    );
  }

  return normalizedTerms;
}

export const CAPTURE_COMMAND_NAME = "capture_job_page";
const fallbackAppBaseUrl = "http://localhost:1285";
const extensionEnv: Record<string, string | undefined> =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env === "object" &&
  import.meta.env !== null
    ? (import.meta.env as Record<string, string | undefined>)
    : {};
export const EXTENSION_DEBUG_UI_ENABLED =
  typeof __DEBUG_UI__ !== "undefined" ? __DEBUG_UI__ : false;
export const EXTENSION_TOP_LEVEL_AI_CHAT_HIDDEN =
  typeof __HIDE_TOP_LVL_AI_CHAT__ !== "undefined"
    ? __HIDE_TOP_LVL_AI_CHAT__
    : false;

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
  extensionEnv.VITE_JOB_HELPER_APP_BASE_URL,
);
export const DEFAULT_DASHBOARD_URL = `${DEFAULT_APP_BASE_URL}/dashboard`;
export const DEFAULT_SYNC_STATE_ENDPOINT = `${DEFAULT_APP_BASE_URL}/api/sync-state`;
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

function isLoopbackHostname(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return (
    normalizedValue === "localhost" ||
    normalizedValue === "127.0.0.1" ||
    normalizedValue === "::1" ||
    normalizedValue === "[::1]"
  );
}

function readUrlPort(url: URL) {
  if (url.port) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "";
}

export function isJobHelperAppUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return false;
  }

  try {
    const appUrl = new URL(DEFAULT_APP_BASE_URL);
    const url = new URL(trimmedValue);

    if (url.origin === appUrl.origin) {
      return true;
    }

    return (
      url.protocol === appUrl.protocol &&
      readUrlPort(url) === readUrlPort(appUrl) &&
      isLoopbackHostname(url.hostname) &&
      isLoopbackHostname(appUrl.hostname)
    );
  } catch {
    return false;
  }
}

export const AUTH_SESSION_STORAGE_KEY = "jobHelperAuthSession";
export const EXTENSION_PREFERENCES_STORAGE_KEY = "jobHelperExtensionPreferences";
export const LAST_TAILORING_STORAGE_KEY = "jobHelperLastTailoringRun";
export const TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY =
  "jobHelperTailoredResumeReviewRequest";
export const EXISTING_TAILORING_STORAGE_KEY =
  "jobHelperExistingTailoringPrompt";
export const PREPARING_TAILORING_STORAGE_KEY =
  "jobHelperPreparingTailoringStart";
export const TAILORING_RUNS_STORAGE_KEY = "jobHelperTailoringRuns";
export const TAILORING_PROMPTS_STORAGE_KEY = "jobHelperTailoringPrompts";
export const TAILORING_PREPARATIONS_STORAGE_KEY =
  "jobHelperTailoringPreparations";

export type TailorRunTimeDisplayMode = "aggregate" | "specific";

export type ExtensionPreferences = {
  compactTailorRun: boolean;
  tailorRunTimeDisplayMode: TailorRunTimeDisplayMode;
};

export const defaultExtensionPreferences: ExtensionPreferences = {
  compactTailorRun: false,
  tailorRunTimeDisplayMode: "specific",
};

const currentTailorResumeGenerationSettingsVersion = 2;

export const defaultTailorResumeGenerationSettingsSummary:
  TailorResumeGenerationSettingsSummary = {
    allowTailorResumeFollowUpQuestions: true,
    includeLowPriorityTermsInKeywordCoverage: false,
    preventPageCountIncrease: true,
    version: currentTailorResumeGenerationSettingsVersion,
  };

export function buildTailoredResumeReviewUrl(
  tailoredResumeId: string | null | undefined,
) {
  const normalizedTailoredResumeId = tailoredResumeId?.trim();

  if (!normalizedTailoredResumeId) {
    return `${DEFAULT_DASHBOARD_URL}?tab=saved`;
  }

  return `${DEFAULT_DASHBOARD_URL}?${new URLSearchParams({
    tab: "saved",
    tailoredResumeId: normalizedTailoredResumeId,
  }).toString()}`;
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
  applicationId: string | null;
  capturedAt: string;
  endpoint: string;
  companyName: string | null;
  failureKind?: "page_capture" | null;
  generationStep?: TailorResumeGenerationStepSummary | null;
  generationStepTimings?: TailorResumeGenerationStepTiming[];
  jobIdentifier: string | null;
  message: string;
  pageTitle: string | null;
  pageUrl: string | null;
  positionTitle: string | null;
  status: "error" | "needs_input" | "running" | "success";
  suppressedTailoredResumeId: string | null;
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
  applicationId: string | null;
  archivedAt: string | null;
  companyName: string | null;
  createdAt: string;
  displayName: string;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  id: string;
  jobIdentifier: string | null;
  jobUrl: string | null;
  keywordCoverage: TailoredResumeKeywordCoverage | null;
  positionTitle: string | null;
  status: string | null;
  updatedAt: string;
};

export type TailoredResumeEmphasizedTechnology = {
  evidence: string;
  name: string;
  priority: "high" | "low";
};

export type TailoredResumeKeywordCoverageTerm = {
  name: string;
  presentInOriginal: boolean;
  presentInTailored: boolean;
  priority: "high" | "low";
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

export type TailorResumeGenerationSettingsSummary = {
  allowTailorResumeFollowUpQuestions: boolean;
  includeLowPriorityTermsInKeywordCoverage: boolean;
  preventPageCountIncrease: boolean;
  version: number;
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
  activeTailorings: TailorResumeExistingTailoringState[];
  applicationCount: number;
  applications: TrackedApplicationSummary[];
  companyCount: number;
  generationSettings: TailorResumeGenerationSettingsSummary;
  originalResume: OriginalResumeSummary;
  syncState: UserSyncStateSnapshot;
  tailoredResumes: TailoredResumeSummary[];
  tailoringInterview: TailorResumePendingInterviewSummary | null;
  tailoringInterviews: TailorResumePendingInterviewSummary[];
  userMemory: UserMemorySummary;
  userMarkdown: UserMarkdownSummary;
};

export type UserMarkdownSummary = {
  markdown: string;
  nonTechnologies: string[];
  updatedAt: string | null;
};

export type UserMemorySummary = {
  nonTechnologyNames: string[];
  updatedAt: string | null;
  userMarkdown: UserMarkdownSummary;
};

export type TailorResumeConversationMessage = {
  id: string;
  role: "assistant" | "user";
  technologyContexts: TailorResumeTechnologyContext[];
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

export type TailorResumeQuestioningSummary = {
  agenda: string;
  askedQuestionCount: number;
  learningsCount: number;
};

export type TailorResumePendingInterviewSummary = {
  applicationId: string | null;
  companyName: string | null;
  completionRequestedAt: string | null;
  conversation: TailorResumeConversationMessage[];
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  id: string;
  jobIdentifier: string | null;
  jobUrl: string | null;
  positionTitle: string | null;
  questioningSummary: TailorResumeQuestioningSummary | null;
  tailorResumeRunId: string | null;
  updatedAt: string;
};

export type TailorResumeGenerationStepSummary = {
  attempt: number | null;
  detail: string | null;
  durationMs: number;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  retrying: boolean;
  status: "failed" | "running" | "skipped" | "succeeded";
  stepCount: number;
  stepNumber: number;
  summary: string;
};

export type TailorResumeGenerationStepTiming =
  TailorResumeGenerationStepSummary & {
    observedAt: string | null;
  };

export type TailorResumeExistingTailoringState =
  | {
      applicationId: string | null;
      companyName: string | null;
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "active_generation";
      lastStep: TailorResumeGenerationStepSummary | null;
      positionTitle: string | null;
      updatedAt: string;
    }
  | {
      applicationId: string | null;
      companyName: string | null;
      createdAt: string;
      id: string;
      jobDescription: string;
      jobIdentifier: string | null;
      jobUrl: string | null;
      kind: "pending_interview";
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
      interviewStatus: "deciding" | "pending" | "ready";
      positionTitle: string | null;
      questionCount: number | null;
      updatedAt: string;
    }
  | {
      applicationId: string | null;
      companyName: string | null;
      createdAt: string;
      displayName: string;
      error: string | null;
      id: string;
      emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
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
  tailoringInterviews: TailorResumePendingInterviewSummary[];
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
  return pageContext.url.trim() || pageContext.canonicalUrl.trim() || null;
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
  const createdAt = readString(value.createdAt);
  const displayName = readString(value.displayName);
  const updatedAt = readString(value.updatedAt);
  const planningResult = isRecord(value.planningResult)
    ? value.planningResult
    : null;

  if (!createdAt || !id || !displayName || !updatedAt) {
    return null;
  }

  return {
    applicationId: readNullableString(value.applicationId),
    archivedAt: readNullableString(value.archivedAt),
    companyName: readString(value.companyName) || null,
    createdAt,
    displayName,
    emphasizedTechnologies: readTailoredResumeEmphasizedTechnologies(
      planningResult?.emphasizedTechnologies ?? value.emphasizedTechnologies,
    ),
    id,
    jobIdentifier: readNullableString(value.jobIdentifier),
    jobUrl: readNullableString(value.jobUrl),
    keywordCoverage: readTailoredResumeKeywordCoverage(value.keywordCoverage),
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
    .sort((left, right) => {
      const createdAtDifference =
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
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
    technologyContexts: readTailorResumeTechnologyContexts(
      value.technologyContexts,
    ),
    text,
    toolCalls: readTailorResumeConversationToolCalls(value.toolCalls),
  };
}

function readTailorResumeTechnologyContext(
  value: unknown,
): TailorResumeTechnologyContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);
  const definition = readString(value.definition);
  const examples = Array.isArray(value.examples)
    ? value.examples.map(readString).filter(Boolean)
    : [];

  if (!name || !definition) {
    return null;
  }

  return {
    definition,
    examples,
    name,
  };
}

function readTailorResumeTechnologyContexts(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeTechnologyContext[];
  }

  return value
    .map(readTailorResumeTechnologyContext)
    .filter((context): context is TailorResumeTechnologyContext =>
      Boolean(context),
    );
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

export function readTailoredResumeEmphasizedTechnologies(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeEmphasizedTechnology[];
  }

  const seen = new Set<string>();
  const technologies: TailoredResumeEmphasizedTechnology[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const name = readString(item.name);
    const priority =
      item.priority === "high" ? "high" : item.priority === "low" ? "low" : null;

    if (!name || !priority) {
      continue;
    }

    const dedupeKey = `${priority}:${name.toLowerCase()}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    technologies.push({
      evidence: readString(item.evidence),
      name,
      priority,
    });
  }

  return technologies;
}

function readPercentage(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readTailoredResumeKeywordCoverageTerm(
  value: unknown,
): TailoredResumeKeywordCoverageTerm | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);
  const priority =
    value.priority === "high" ? "high" : value.priority === "low" ? "low" : null;

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

function readTailoredResumeKeywordCoverageTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailoredResumeKeywordCoverageTerm[];
  }

  return value
    .map(readTailoredResumeKeywordCoverageTerm)
    .filter((term): term is TailoredResumeKeywordCoverageTerm => Boolean(term));
}

function readTailoredResumeKeywordCoverageBucket(
  value: unknown,
): TailoredResumeKeywordCoverageBucket | null {
  if (!isRecord(value)) {
    return null;
  }

  const terms = readTailoredResumeKeywordCoverageTerms(value.terms);
  const totalTermCount = readNumber(value.totalTermCount) || terms.length;
  const originalHitCount =
    readNumber(value.originalHitCount) ||
    terms.filter((term) => term.presentInOriginal).length;
  const tailoredHitCount =
    readNumber(value.tailoredHitCount) ||
    terms.filter((term) => term.presentInTailored).length;

  return {
    addedTerms: readStringArray(value.addedTerms),
    matchedOriginalTerms: readStringArray(value.matchedOriginalTerms),
    matchedTailoredTerms: readStringArray(value.matchedTailoredTerms),
    originalHitCount,
    originalHitPercentage: readPercentage(value.originalHitPercentage),
    tailoredHitCount,
    tailoredHitPercentage: readPercentage(value.tailoredHitPercentage),
    terms,
    totalTermCount,
  };
}

function readTailoredResumeKeywordCoverage(
  value: unknown,
): TailoredResumeKeywordCoverage | null {
  if (!isRecord(value)) {
    return null;
  }

  const highPriority = readTailoredResumeKeywordCoverageBucket(
    value.highPriority,
  );
  const allPriorities = readTailoredResumeKeywordCoverageBucket(
    value.allPriorities,
  );
  const updatedAt = readString(value.updatedAt);

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

export function readTailorResumeGenerationSettingsSummary(
  value: unknown,
): TailorResumeGenerationSettingsSummary {
  if (isRecord(value) && isRecord(value.profile)) {
    return readTailorResumeGenerationSettingsSummary(value.profile);
  }

  const generationSettingsRecord =
    isRecord(value) && isRecord(value.generationSettings)
      ? value.generationSettings
      : null;
  const settings = generationSettingsRecord
    ? isRecord(generationSettingsRecord.values)
      ? generationSettingsRecord.values
      : generationSettingsRecord
    : value;

  if (!isRecord(settings)) {
    return defaultTailorResumeGenerationSettingsSummary;
  }

  const rawVersion =
    generationSettingsRecord && typeof generationSettingsRecord.version === "number"
      ? generationSettingsRecord.version
      : typeof settings.version === "number"
        ? settings.version
        : 1;
  const version =
    Number.isFinite(rawVersion) && rawVersion >= 1
      ? Math.floor(rawVersion)
      : 1;
  const allowTailorResumeFollowUpQuestions =
    typeof settings.allowTailorResumeFollowUpQuestions === "boolean"
      ? settings.allowTailorResumeFollowUpQuestions
      : defaultTailorResumeGenerationSettingsSummary.allowTailorResumeFollowUpQuestions;

  return {
    allowTailorResumeFollowUpQuestions:
      version < currentTailorResumeGenerationSettingsVersion &&
      allowTailorResumeFollowUpQuestions === false
        ? true
        : allowTailorResumeFollowUpQuestions,
    includeLowPriorityTermsInKeywordCoverage:
      typeof settings.includeLowPriorityTermsInKeywordCoverage === "boolean"
        ? settings.includeLowPriorityTermsInKeywordCoverage
        : defaultTailorResumeGenerationSettingsSummary.includeLowPriorityTermsInKeywordCoverage,
    preventPageCountIncrease:
      typeof settings.preventPageCountIncrease === "boolean"
        ? settings.preventPageCountIncrease
        : defaultTailorResumeGenerationSettingsSummary.preventPageCountIncrease,
    version: currentTailorResumeGenerationSettingsVersion,
  };
}

export function readExtensionPreferences(
  value: unknown,
): ExtensionPreferences {
  if (!isRecord(value)) {
    return defaultExtensionPreferences;
  }

  const rawTimeDisplayMode = value.tailorRunTimeDisplayMode;

  return {
    compactTailorRun: value.compactTailorRun === true,
    tailorRunTimeDisplayMode:
      rawTimeDisplayMode === "aggregate" || rawTimeDisplayMode === "specific"
        ? rawTimeDisplayMode
        : defaultExtensionPreferences.tailorRunTimeDisplayMode,
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
    durationMs: Math.max(0, Math.floor(readNumber(value.durationMs))),
    emphasizedTechnologies: readTailoredResumeEmphasizedTechnologies(
      value.emphasizedTechnologies,
    ),
    retrying: value.retrying === true,
    status,
    stepCount: Math.max(1, Math.floor(stepCount)),
    stepNumber: Math.max(1, Math.floor(stepNumber)),
    summary,
  };
}

export function readTailorResumeGenerationStepTimings(
  value: unknown,
): TailorResumeGenerationStepTiming[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((candidate) => {
      const step = readTailorResumeGenerationStepSummary(candidate);

      if (!step) {
        return null;
      }

      return {
        ...step,
        observedAt: isRecord(candidate)
          ? readNullableString(candidate.observedAt)
          : null,
      } satisfies TailorResumeGenerationStepTiming;
    })
    .filter((step): step is TailorResumeGenerationStepTiming => Boolean(step));
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

function readExistingTailoringInterviewStatus(value: unknown) {
  const status = readString(value).trim().toLowerCase();

  return status === "deciding" || status === "pending" || status === "ready"
    ? status
    : "ready";
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
      applicationId: readNullableString(existingTailoring.applicationId),
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      id,
      jobDescription,
      jobIdentifier: readNullableString(existingTailoring.jobIdentifier),
      jobUrl: readNullableString(existingTailoring.jobUrl),
      kind,
      lastStep: readTailorResumeGenerationStepSummary(
        existingTailoring.lastStep,
      ),
      positionTitle: readNullableString(existingTailoring.positionTitle),
      updatedAt,
    };
  }

  if (kind === "pending_interview") {
    const createdAt = readString(existingTailoring.createdAt);

    if (!createdAt) {
      return null;
    }

    return {
      applicationId: readNullableString(existingTailoring.applicationId),
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      emphasizedTechnologies: readTailoredResumeEmphasizedTechnologies(
        existingTailoring.emphasizedTechnologies,
      ),
      id,
      interviewStatus: readExistingTailoringInterviewStatus(
        existingTailoring.interviewStatus,
      ),
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
    const createdAt = readString(existingTailoring.createdAt);
    const displayName = readString(existingTailoring.displayName);
    const tailoredResumeId = readString(existingTailoring.tailoredResumeId);

    if (!createdAt || !displayName || !tailoredResumeId) {
      return null;
    }

    return {
      applicationId: readNullableString(existingTailoring.applicationId),
      companyName: readNullableString(existingTailoring.companyName),
      createdAt,
      displayName,
      emphasizedTechnologies: readTailoredResumeEmphasizedTechnologies(
        existingTailoring.emphasizedTechnologies,
      ),
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

export function readTailorResumeExistingTailoringStates(value: unknown) {
  const activeTailorings = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.activeTailorings)
      ? value.activeTailorings
      : isRecord(value) && Array.isArray(value.existingTailorings)
        ? value.existingTailorings
        : [];

  const parsedActiveTailorings = activeTailorings
    .map(readTailorResumeExistingTailoringState)
    .filter(
      (
        activeTailoring,
      ): activeTailoring is TailorResumeExistingTailoringState =>
        Boolean(activeTailoring),
    );

  if (parsedActiveTailorings.length > 0) {
    return parsedActiveTailorings.sort((left, right) => {
      const createdAtDifference =
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    });
  }

  const singleActiveTailoring = readTailorResumeExistingTailoringState(value);
  return singleActiveTailoring ? [singleActiveTailoring] : [];
}

export function readTailorResumePendingInterviewSummary(
  value: unknown,
): TailorResumePendingInterviewSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const updatedAt = readString(value.updatedAt);
  const status = readString(value.status) || "ready";
  const conversation = Array.isArray(value.conversation)
    ? value.conversation
        .map(readTailorResumeConversationMessage)
        .filter((message): message is TailorResumeConversationMessage =>
          Boolean(message),
        )
    : [];

  if (!id || !updatedAt || status !== "ready" || conversation.length === 0) {
    return null;
  }

  const planningResult = isRecord(value.planningResult)
    ? value.planningResult
    : {};

  return {
    applicationId: readNullableString(value.applicationId),
    companyName: readNullableString(planningResult.companyName),
    completionRequestedAt: readNullableString(value.completionRequestedAt),
    conversation,
    emphasizedTechnologies: readTailoredResumeEmphasizedTechnologies(
      planningResult.emphasizedTechnologies,
    ),
    id,
    jobIdentifier: readNullableString(planningResult.jobIdentifier),
    jobUrl: readNullableString(value.jobUrl),
    positionTitle: readNullableString(planningResult.positionTitle),
    questioningSummary: readTailorResumeQuestioningSummary(
      planningResult.questioningSummary,
    ),
    tailorResumeRunId: readNullableString(value.tailorResumeRunId),
    updatedAt,
  };
}

export function readTailorResumePendingInterviewSummaries(value: unknown) {
  const tailoringInterviews = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.tailoringInterviews)
      ? value.tailoringInterviews
      : [];

  const parsedTailoringInterviews = tailoringInterviews
    .map(readTailorResumePendingInterviewSummary)
    .filter(
      (
        tailoringInterview,
      ): tailoringInterview is TailorResumePendingInterviewSummary =>
        Boolean(tailoringInterview),
    );

  if (parsedTailoringInterviews.length > 0) {
    return parsedTailoringInterviews;
  }

  const singleTailoringInterview = readTailorResumePendingInterviewSummary(value);
  return singleTailoringInterview ? [singleTailoringInterview] : [];
}

export function readTailorResumeProfileSummary(
  value: unknown,
): TailorResumeProfileSummary | null {
  const profile = isRecord(value) && isRecord(value.profile) ? value.profile : value;

  if (!isRecord(profile)) {
    return null;
  }

  const workspace = isRecord(profile.workspace) ? profile.workspace : {};
  const tailoringInterviews = readTailorResumePendingInterviewSummaries(workspace);

  return {
    tailoredResumes: readTailoredResumeSummaries(profile.tailoredResumes),
    tailoringInterview: tailoringInterviews[0] ?? null,
    tailoringInterviews,
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

function readUserMarkdownSummary(value: unknown): UserMarkdownSummary {
  const directValue =
    isRecord(value) && isRecord(value.userMarkdown) ? value.userMarkdown : value;

  if (isRecord(directValue) && typeof directValue.markdown === "string") {
    return {
      markdown: directValue.markdown,
      nonTechnologies: normalizeNonTechnologyTerms(
        Array.isArray(directValue.nonTechnologies)
          ? directValue.nonTechnologies.filter(
              (term): term is string => typeof term === "string",
            )
          : [],
      ),
      updatedAt: readNullableString(directValue.updatedAt),
    };
  }

  return {
    markdown: defaultUserMarkdown,
    nonTechnologies: [],
    updatedAt: null,
  };
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readUserMemorySummary(value: unknown): UserMemorySummary {
  const payloadRecord: Record<string, unknown> = isRecord(value) ? value : {};
  const directValue = isRecord(payloadRecord.userMemory)
    ? payloadRecord.userMemory
    : payloadRecord;
  const userMarkdown = readUserMarkdownSummary(
    isRecord(directValue) && "userMarkdown" in directValue
      ? directValue.userMarkdown
      : payloadRecord.userMarkdown,
  );
  const nonTechnologyNames = normalizeNonTechnologyTerms([
    ...readStringList(
      isRecord(directValue) ? directValue.nonTechnologyNames : undefined,
    ),
    ...readStringList(
      isRecord(payloadRecord) ? payloadRecord.nonTechnologyNames : undefined,
    ),
    ...userMarkdown.nonTechnologies,
  ]);
  const updatedAt =
    readNullableString(isRecord(directValue) ? directValue.updatedAt : null) ??
    userMarkdown.updatedAt;

  return {
    nonTechnologyNames,
    updatedAt,
    userMarkdown: {
      ...userMarkdown,
      nonTechnologies: nonTechnologyNames,
      updatedAt: userMarkdown.updatedAt ?? updatedAt,
    },
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
  const payloadRecord = isRecord(input.tailorResumePayload)
    ? input.tailorResumePayload
    : {};
  const activeTailorings = readTailorResumeExistingTailoringStates(
    input.tailorResumePayload,
  );

  const userMemory = readUserMemorySummary(payloadRecord);

  return {
    activeTailoring: activeTailorings[0] ?? null,
    activeTailorings,
    applicationCount: readNumber(applicationsPayload.applicationCount),
    applications: readTrackedApplicationSummaries(applicationsPayload),
    companyCount: readNumber(applicationsPayload.companyCount),
    generationSettings: readTailorResumeGenerationSettingsSummary(
      input.tailorResumePayload,
    ),
    originalResume: readOriginalResumeSummary(input.tailorResumePayload),
    syncState: readUserSyncStateSnapshot(input.tailorResumePayload),
    tailoredResumes: tailorResumeProfile?.tailoredResumes ?? [],
    tailoringInterview: tailorResumeProfile?.tailoringInterview ?? null,
    tailoringInterviews: tailorResumeProfile?.tailoringInterviews ?? [],
    userMarkdown: userMemory.userMarkdown,
    userMemory,
  };
}

export function readPersonalInfoPayload(value: unknown): PersonalInfoSummary {
  const payload = isRecord(value) && isRecord(value.personalInfo)
    ? value.personalInfo
    : value;
  const payloadRecord = isRecord(payload) ? payload : {};
  const tailorResumeProfile = readTailorResumeProfileSummary(payloadRecord);
  const activeTailorings = readTailorResumeExistingTailoringStates(payloadRecord);
  const directTailoredResumes = readTailoredResumeSummaries(
    payloadRecord.tailoredResumes,
  );
  const tailoringInterviews = readTailorResumePendingInterviewSummaries(
    payloadRecord.tailoringInterviews,
  );
  const fallbackTailoringInterview = readTailorResumePendingInterviewSummary(
    payloadRecord.tailoringInterview,
  );
  const normalizedTailoringInterviews =
    tailoringInterviews.length > 0
      ? tailoringInterviews
      : tailorResumeProfile && tailorResumeProfile.tailoringInterviews.length > 0
        ? tailorResumeProfile.tailoringInterviews
      : fallbackTailoringInterview
        ? [fallbackTailoringInterview]
        : [];
  const userMemory = readUserMemorySummary(payloadRecord);

  return {
    activeTailoring: activeTailorings[0] ?? null,
    activeTailorings,
    applicationCount: readNumber(payloadRecord.applicationCount),
    applications: readTrackedApplicationSummaries(payloadRecord.applications),
    companyCount: readNumber(payloadRecord.companyCount),
    generationSettings: readTailorResumeGenerationSettingsSummary(
      payloadRecord,
    ),
    originalResume: readOriginalResumeSummary(
      "originalResume" in payloadRecord
        ? payloadRecord.originalResume
        : payloadRecord,
    ),
    syncState:
      "syncState" in payloadRecord
        ? readUserSyncStateSnapshot(payloadRecord.syncState)
        : emptyUserSyncStateSnapshot(),
    tailoredResumes:
      directTailoredResumes.length > 0
        ? directTailoredResumes
        : tailorResumeProfile?.tailoredResumes ?? [],
    tailoringInterview: normalizedTailoringInterviews[0] ?? null,
    tailoringInterviews: normalizedTailoringInterviews,
    userMarkdown: userMemory.userMarkdown,
    userMemory,
  };
}
