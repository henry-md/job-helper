export const CAPTURE_COMMAND_NAME = "capture_job_page";
const fallbackAppBaseUrl = "http://localhost:3000";

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
export const DEFAULT_TAILOR_RESUME_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/tailor-resume`;
export const EXTENSION_AUTH_GOOGLE_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/google`;
export const EXTENSION_AUTH_SESSION_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/session`;
export const EXTENSION_BROWSER_SESSION_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/extension/auth/browser-session`;
export const AUTH_SESSION_STORAGE_KEY = "jobHelperAuthSession";
export const LAST_TAILORING_STORAGE_KEY = "jobHelperLastTailoringRun";

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

export type TailorResumeRunRecord = {
  capturedAt: string;
  endpoint: string;
  companyName: string | null;
  message: string;
  pageTitle: string | null;
  pageUrl: string | null;
  positionTitle: string | null;
  status: "error" | "success";
  tailoredResumeError: string | null;
  tailoredResumeId: string | null;
};

export type TailoredResumeSummary = {
  companyName: string | null;
  displayName: string;
  id: string;
  positionTitle: string | null;
  status: string | null;
  updatedAt: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
