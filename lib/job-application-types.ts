export type JobLocationType = "remote" | "onsite" | "hybrid";
export type ApplicationStatusValue =
  | "SAVED"
  | "APPLIED"
  | "INTERVIEW"
  | "OFFER"
  | "REJECTED"
  | "WITHDRAWN";
export type EmploymentTypeValue =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship";

export type FieldConfidence = {
  appliedAt: number;
  companyName: number;
  hasReferral: number;
  jobDescription: number;
  jobTitle: number;
  jobUrl: number;
  location: number;
  notes: number;
  onsiteDaysPerWeek: number;
  recruiterContact: number;
  salaryRange: number;
  status: number;
  teamOrDepartment: number;
  employmentType: number;
};

export type FieldEvidence = {
  appliedAt: string | null;
  companyName: string | null;
  hasReferral: string | null;
  jobDescription: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  onsiteDaysPerWeek: string | null;
  recruiterContact: string | null;
  salaryRange: string | null;
  status: string | null;
  teamOrDepartment: string | null;
  employmentType: string | null;
};

export type JobApplicationExtraction = {
  appliedAt: string | null;
  companyName: string | null;
  confidence: FieldConfidence;
  evidence: FieldEvidence;
  hasReferral: boolean;
  jobDescription: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: JobLocationType | null;
  notes: string | null;
  onsiteDaysPerWeek: number | null;
  recruiterContact: string | null;
  salaryRange: string | null;
  status: ApplicationStatusValue | null;
  teamOrDepartment: string | null;
  employmentType: EmploymentTypeValue | null;
};

export type JobApplicationDraft = {
  appliedAt: string;
  companyName: string;
  hasReferral: boolean;
  jobDescription: string;
  jobTitle: string;
  jobUrl: string;
  location: "" | JobLocationType;
  notes: string;
  onsiteDaysPerWeek: string;
  recruiterContact: string;
  salaryRange: string;
  status: "" | ApplicationStatusValue;
  teamOrDepartment: string;
  employmentType: "" | EmploymentTypeValue;
};

export type JobApplicationRecord = {
  appliedAt: string;
  companyName: string;
  createdAt: string;
  hasReferral: boolean;
  id: string;
  jobDescription: string;
  jobTitle: string;
  jobUrl: string;
  location: "" | JobLocationType;
  notes: string;
  onsiteDaysPerWeek: string;
  recruiterContact: string;
  salaryRange: string;
  status: ApplicationStatusValue;
  teamOrDepartment: string;
  employmentType: "" | EmploymentTypeValue;
  updatedAt: string;
};
