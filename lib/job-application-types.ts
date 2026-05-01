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

export type ReferrerOption = {
  companyId: string | null;
  companyName: string | null;
  id: string;
  name: string;
  recruiterContact: string | null;
};

export type CompanyOption = {
  id: string;
  name: string;
};

export type FieldConfidence = {
  appliedAt: number;
  companyName: number;
  jobDescription: number;
  jobTitle: number;
  jobUrl: number;
  location: number;
  notes: number;
  onsiteDaysPerWeek: number;
  referrerName: number;
  recruiterContact: number;
  salaryRange: number;
  status: number;
  teamOrDepartment: number;
  employmentType: number;
};

export type FieldEvidence = {
  appliedAt: string | null;
  companyName: string | null;
  jobDescription: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  onsiteDaysPerWeek: string | null;
  referrerName: string | null;
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
  jobDescription: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: JobLocationType | null;
  notes: string | null;
  onsiteDaysPerWeek: number | null;
  referrerName: string | null;
  recruiterContact: string | null;
  salaryRange: string | null;
  status: ApplicationStatusValue | null;
  teamOrDepartment: string | null;
  employmentType: EmploymentTypeValue | null;
};

export type JobApplicationDraft = {
  appliedAt: string;
  companyName: string;
  jobDescription: string;
  jobTitle: string;
  jobUrl: string;
  location: "" | JobLocationType;
  notes: string;
  onsiteDaysPerWeek: string;
  referrerId: string;
  referrerName: string;
  recruiterContact: string;
  salaryRange: string;
  status: "" | ApplicationStatusValue;
  teamOrDepartment: string;
  employmentType: "" | EmploymentTypeValue;
};

export type JobApplicationRecord = {
  appliedAt: string;
  archivedAt: string | null;
  companyName: string;
  createdAt: string;
  id: string;
  jobDescription: string;
  jobTitle: string;
  jobUrl: string;
  location: "" | JobLocationType;
  notes: string;
  onsiteDaysPerWeek: string;
  referrerId: string;
  referrerName: string;
  recruiterContact: string;
  salaryRange: string;
  status: ApplicationStatusValue;
  teamOrDepartment: string;
  employmentType: "" | EmploymentTypeValue;
  updatedAt: string;
};
