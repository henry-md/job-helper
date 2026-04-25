import type {
  TailorResumeLinkValidationEntry,
  TailorResumeLinkValidationSummary,
} from "./tailor-resume-link-validation.ts";
import type {
  TailorResumeProfile,
  TailorResumeSavedLinkUpdate,
} from "./tailor-resume-types.ts";
import type { TailorResumeUserMarkdownState } from "./tailor-resume-user-memory.ts";

export type TailorResumeExtractionAttempt = {
  attempt: number;
  error: string | null;
  linkSummary: TailorResumeLinkValidationSummary | null;
  outcome: "failed" | "succeeded";
  willRetry: boolean;
};

export type TailorResumeUploadResponsePayload = {
  error?: string;
  extractionError?: string | null;
  extractionAttempts?: TailorResumeExtractionAttempt[];
  linkValidationLinks?: TailorResumeLinkValidationEntry[] | null;
  linkValidationSummary?: TailorResumeLinkValidationSummary | null;
  profile?: TailorResumeProfile;
  savedLinkUpdateCount?: number;
  savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
};

export type TailorResumeRunResponsePayload = {
  error?: string;
  profile?: TailorResumeProfile;
  savedLinkUpdateCount?: number;
  savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
  tailoringStatus?: "already_tailored" | "needs_user_input";
  tailoredResumeDurationMs?: number;
  tailoredResumeError?: string | null;
  tailoredResumeId?: string;
  userMarkdown?: TailorResumeUserMarkdownState;
};
