export type AiUsageSubjectStatus = "archived" | "deleted" | "unarchived";
export type AiUsagePeriod =
  | "hour"
  | "day"
  | "7d"
  | "14d"
  | "month"
  | "6mo"
  | "1y"
  | "all";

export const aiUsagePeriods: {
  label: string;
  value: AiUsagePeriod;
}[] = [
  { label: "Last hour", value: "hour" },
  { label: "Last day", value: "day" },
  { label: "7 days", value: "7d" },
  { label: "14 days", value: "14d" },
  { label: "30 days", value: "month" },
  { label: "6 mos", value: "6mo" },
  { label: "1 yr", value: "1y" },
  { label: "All time", value: "all" },
];

export const defaultAiUsagePeriod: AiUsagePeriod = "7d";

export type AiUsageEventRecord = {
  applicationId: string | null;
  attempt: number | null;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  durationMs: number | null;
  error: string | null;
  id: string;
  inputTokens: number;
  jobUrl: string | null;
  model: string;
  operation: string;
  outputTokens: number;
  provider: string;
  providerResponseId: string | null;
  reasoningTokens: number;
  requestStartedAt: string;
  round: number | null;
  status: "failed" | "succeeded";
  stepLabel: string | null;
  stepNumber: number | null;
  subjectStatus: AiUsageSubjectStatus;
  tailoredResumeId: string | null;
  tailorResumeRunId: string | null;
  totalCostUsdMicros: string;
  totalTokens: number;
};

export type AiUsageUrlGroup = {
  applicationId: string | null;
  eventCount: number;
  failedEventCount: number;
  firstSeenAt: string;
  inputTokens: number;
  jobUrl: string | null;
  lastSeenAt: string;
  outputTokens: number;
  status: AiUsageSubjectStatus;
  totalCostUsdMicros: string;
  totalTokens: number;
};

export type AiUsageResumeGroup = {
  applicationId: string | null;
  companyName: string | null;
  displayName: string;
  eventCount: number;
  failedEventCount: number;
  firstSeenAt: string;
  inputTokens: number;
  jobUrl: string | null;
  lastSeenAt: string;
  outputTokens: number;
  positionTitle: string | null;
  status: Extract<AiUsageSubjectStatus, "archived" | "unarchived">;
  tailoredResumeId: string;
  totalCostUsdMicros: string;
  totalTokens: number;
};

export type AiUsageReport = {
  events: AiUsageEventRecord[];
  generatedAt: string;
  period: AiUsagePeriod;
  resumeGroups: AiUsageResumeGroup[];
  summary: {
    archivedCostUsdMicros: string;
    deletedCostUsdMicros: string;
    eventCount: number;
    failedEventCount: number;
    inputTokens: number;
    outputTokens: number;
    totalCostUsdMicros: string;
    totalTokens: number;
    unarchivedCostUsdMicros: string;
    urlCount: number;
  };
  urlGroups: AiUsageUrlGroup[];
};

export function normalizeAiUsagePeriod(value: string | null | undefined) {
  return aiUsagePeriods.some((period) => period.value === value)
    ? (value as AiUsagePeriod)
    : defaultAiUsagePeriod;
}
