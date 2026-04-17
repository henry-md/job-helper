export const CAPTURE_COMMAND_NAME = "capture_job_page";
export const DEFAULT_APP_BASE_URL = "http://localhost:3000";
export const DEFAULT_TAILOR_RESUME_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/tailor-resume`;
export const LAST_TAILORING_STORAGE_KEY = "jobHelperLastTailoringRun";

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
