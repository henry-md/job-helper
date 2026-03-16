export const CAPTURE_COMMAND_NAME = "capture_job_page";
export const DEFAULT_APP_BASE_URL = "http://localhost:3000";
export const DEFAULT_INGEST_ENDPOINT =
  `${DEFAULT_APP_BASE_URL}/api/job-applications/ingest`;
export const LAST_INGESTION_STORAGE_KEY = "jobHelperLastIngestion";

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

export type IngestionRecord = {
  applicationId: string | null;
  capturedAt: string;
  endpoint: string;
  evidence: {
    hasPageContext: boolean;
    screenshotCount: number;
    source: string;
  } | null;
  extraction: {
    companyName: string | null;
    employmentType: string | null;
    jobTitle: string | null;
    jobUrl: string | null;
    location: string | null;
    salaryRange: string | null;
    status: string | null;
  } | null;
  message: string;
  status: "error" | "success";
};
