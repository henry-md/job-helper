import type { TailorResumeGenerationSettings } from "./tailor-resume-generation-settings.ts";
import type { SystemPromptSettingKey } from "./system-prompt-settings.ts";

export const tailorResumePromptFieldDefinitions = [
  {
    description: "Screenshots into structured application fields.",
    helper: "Runtime tokens: none.",
    key: "jobApplicationExtraction",
    minHeightClassName: "min-h-[220px]",
    title: "Job Application Extraction",
  },
  {
    description: "Uploaded base resume into the editable LaTeX source document.",
    helper: "Runtime tokens: {{RETRY_INSTRUCTIONS}}, {{MAX_ATTEMPTS}}.",
    key: "resumeLatexExtraction",
    minHeightClassName: "min-h-[420px]",
    title: "Resume To LaTeX",
  },
  {
    description: "Step 3 tailoring strategy over plaintext resume blocks.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumePlanning",
    minHeightClassName: "min-h-[420px]",
    title: "Tailoring Plan",
  },
  {
    description:
      "Optional Step 2 AI-led follow-up questions before tailoring planning.",
    helper: "Runtime tokens: none.",
    key: "tailorResumeInterview",
    minHeightClassName: "min-h-[320px]",
    title: "Tailoring Follow-Up Interview",
  },
  {
    description: "Step 4 LaTeX block generation for the tailored resume.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumeImplementation",
    minHeightClassName: "min-h-[420px]",
    title: "Tailored Block Generation",
  },
  {
    description: "Follow-up regeneration of existing tailored resume edit blocks.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumeRefinement",
    minHeightClassName: "min-h-[360px]",
    title: "Tailored Block Refinement",
  },
  {
    description:
      "Automatic follow-up request used when a tailored resume grows beyond the original page count.",
    helper:
      "Runtime tokens: {{TARGET_PAGE_COUNT}}, {{TARGET_PAGE_COUNT_REQUIREMENT}}, {{TARGET_PAGE_COUNT_HARD_REQUIREMENT}}, {{CURRENT_PAGE_COUNT}}, {{CURRENT_PAGE_LABEL}}.",
    key: "tailorResumePageCountCompaction",
    minHeightClassName: "min-h-[220px]",
    title: "Tailored Resume Page Count Compaction",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  helper: string;
  key: SystemPromptSettingKey;
  minHeightClassName: string;
  title: string;
}>;

export const tailorResumeGenerationSettingDefinitions = [
  {
    description:
      "When enabled, tailoring can ask concise follow-up questions before planning and writing LaTeX edits.",
    key: "allowTailorResumeFollowUpQuestions",
    title: "Allow Step 2 follow-up questions",
  },
  {
    description:
      "When enabled, tailoring automatically runs a highlighted follow-up compaction pass if the new preview exceeds the original resume's page count.",
    key: "preventPageCountIncrease",
    title: "Edits should not increase page count",
  },
  {
    description:
      "Low-priority terms are always tracked and shown. This only chooses whether the displayed coverage percentage is calculated from high-priority terms or all tracked terms.",
    key: "includeLowPriorityTermsInKeywordCoverage",
    title: "Coverage percentage uses all tracked terms",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  key: keyof TailorResumeGenerationSettings;
  title: string;
}>;
