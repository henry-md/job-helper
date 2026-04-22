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
export const DEFAULT_JOB_APPLICATIONS_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/job-applications`;
export const DEFAULT_TAILOR_RESUME_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/tailor-resume`;
export const DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT =
  `${DEFAULT_TAILOR_RESUME_ENDPOINT}/preview`;
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
  applicationCount: number;
  applications: TrackedApplicationSummary[];
  companyCount: number;
  originalResume: OriginalResumeSummary;
  tailoredResumes: TailoredResumeSummary[];
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

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNullableString(value: unknown) {
  const stringValue = readString(value);
  return stringValue || null;
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

  return {
    applicationCount: readNumber(applicationsPayload.applicationCount),
    applications: readTrackedApplicationSummaries(applicationsPayload),
    companyCount: readNumber(applicationsPayload.companyCount),
    originalResume: readOriginalResumeSummary(input.tailorResumePayload),
    tailoredResumes: readTailoredResumeSummaries(input.tailorResumePayload),
  };
}

export function readPersonalInfoPayload(value: unknown): PersonalInfoSummary {
  const payload = isRecord(value) && isRecord(value.personalInfo)
    ? value.personalInfo
    : value;
  const payloadRecord = isRecord(payload) ? payload : {};

  return {
    applicationCount: readNumber(payloadRecord.applicationCount),
    applications: readTrackedApplicationSummaries(payloadRecord.applications),
    companyCount: readNumber(payloadRecord.companyCount),
    originalResume: readOriginalResumeSummary(payloadRecord.originalResume),
    tailoredResumes: readTailoredResumeSummaries(payloadRecord.tailoredResumes),
  };
}
