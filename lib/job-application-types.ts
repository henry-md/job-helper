export type FieldConfidence = {
  appliedAt: number;
  companyName: number;
  hasReferral: number;
  jobDescription: number;
  jobTitle: number;
};

export type FieldEvidence = {
  appliedAt: string | null;
  companyName: string | null;
  hasReferral: string | null;
  jobDescription: string | null;
  jobTitle: string | null;
};

export type JobApplicationExtraction = {
  appliedAt: string | null;
  companyName: string | null;
  confidence: FieldConfidence;
  evidence: FieldEvidence;
  hasReferral: boolean;
  jobDescription: string | null;
  jobTitle: string | null;
};

export type JobApplicationDraft = {
  appliedAt: string;
  companyName: string;
  hasReferral: boolean;
  jobDescription: string;
  jobTitle: string;
};
