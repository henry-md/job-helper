import {
  AUTH_SESSION_STORAGE_KEY,
  DEFAULT_AI_USAGE_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT,
  defaultExtensionPreferences,
  EXISTING_TAILORING_STORAGE_KEY,
  EXTENSION_PREFERENCES_STORAGE_KEY,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobPageContext,
  type TailorResumeStoredSkillData,
  type TailorResumeRunRecord,
} from "./job-helper";
import { emptyUserSyncStateSnapshot } from "../../lib/sync-state.ts";

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

type TabActivatedListener = (activeInfo: {
  tabId: number;
  windowId: number;
}) => void;
type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
) => void;
type DebugChatMessage = {
  content: string;
  createdAt: string;
  id: string;
  model: string | null;
  role: "assistant" | "user";
  toolCalls: Array<{
    argumentsText: string;
    name: string;
  }>;
};

declare global {
  interface Window {
    __JOB_HELPER_DEBUG_PREVIEW_PDF_BYTES__?: ArrayBuffer | Uint8Array;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createEvent<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>();

  return {
    addListener(listener: (...args: T) => void) {
      listeners.add(listener);
    },
    emit(...args: T) {
      for (const listener of listeners) {
        listener(...args);
      }
    },
    hasListener(listener: (...args: T) => void) {
      return listeners.has(listener);
    },
    removeListener(listener: (...args: T) => void) {
      listeners.delete(listener);
    },
  };
}

const mockSession: JobHelperAuthSession = {
  expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
  sessionToken: "debug-session-token",
  user: {
    email: "henrymdeutsch@gmail.com",
    id: "debug-henry",
    image: null,
    name: "Henry Deutsch",
  },
};

const mockPageContext: JobPageContext = {
  canonicalUrl: "https://jobs.example.com/acme-ai/senior-product-engineer",
  companyCandidates: ["Acme AI"],
  description:
    "Build the browser-side workflow for job seekers, including fast page capture, resume tailoring, and polished review surfaces.",
  employmentTypeCandidates: ["Full-time"],
  headings: ["Senior Product Engineer", "About the role", "Compensation"],
  jsonLdJobPostings: [
    {
      baseSalary: ["$165,000 - $210,000"],
      datePosted: "2026-04-15",
      description:
        "Acme AI is hiring a senior product engineer to build AI-assisted job search workflows.",
      directApply: true,
      employmentType: ["FULL_TIME"],
      hiringOrganization: "Acme AI",
      identifier: "acme-ai-spe-2026",
      locations: ["New York, NY", "Remote US"],
      title: "Senior Product Engineer",
      validThrough: "2026-05-31",
    },
  ],
  locationCandidates: ["New York, NY", "Remote US"],
  rawText:
    "Senior Product Engineer Acme AI New York Remote Salary $165,000 - $210,000 Build AI-assisted job search workflows.",
  salaryMentions: ["$165,000 - $210,000"],
  selectionText: "",
  siteName: "Acme AI Careers",
  title: "Senior Product Engineer, Job Helper Platform",
  titleCandidates: ["Senior Product Engineer"],
  topTextBlocks: [
    "Senior Product Engineer",
    "Acme AI",
    "New York, NY or Remote US",
  ],
  url: "https://jobs.example.com/acme-ai/senior-product-engineer",
};

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, "\\$&");
}

function createDebugPdfBytes(lines: string[]) {
  const content = [
    "BT",
    "/F1 12 Tf",
    "40 735 Td",
    ...lines.flatMap((line, index) =>
      index === lines.length - 1
        ? [`(${escapePdfText(line)}) Tj`]
        : [`(${escapePdfText(line)}) Tj`, "0 -16 Td"],
    ),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

const mockPdfBytes = createDebugPdfBytes([
  "Henry Deutsch - Software Engineer",
  "Work Experience",
  "Led major refactor enabling $50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.",
  "Built and migrated 100% of internal account managers and external clients to a streamlined messaging and reporting system.",
  "Refactored 31K+ LOC in 365 files, reworking 140+ tRPC endpoints & Bayesian inference engine for platform-agnostic objectives.",
]);

function createMockAiUsageReport() {
  const now = new Date("2026-05-25T23:35:00.000Z").toISOString();
  const events = [
    {
      applicationId: "debug-application-acme",
      attempt: 2,
      cachedInputTokens: 900,
      cacheCreationInputTokens: 0,
      durationMs: 18400,
      error: null,
      id: "debug-usage-implementation",
      inputTokens: 4200,
      jobUrl: mockPageContext.url,
      model: "gpt-5-mini",
      operation: "tailor-resume.step-4a.implementation",
      outputTokens: 760,
      provider: "openai",
      providerResponseId: "debug-response-implementation",
      reasoningTokens: 0,
      requestStartedAt: now,
      round: 1,
      status: "succeeded",
      stepLabel: "Step 4A implementation",
      stepNumber: 4,
      subjectStatus: "unarchived",
      tailoredResumeId: "debug-tailored-resume-current",
      tailorResumeRunId: "debug-tailor-run-current",
      totalCostUsdMicros: "18500",
      totalTokens: 4960,
    },
    {
      applicationId: "debug-application-acme",
      attempt: 1,
      cachedInputTokens: 300,
      cacheCreationInputTokens: 0,
      durationMs: 8600,
      error: null,
      id: "debug-usage-keywords",
      inputTokens: 3100,
      jobUrl: mockPageContext.url,
      model: "gpt-5-mini",
      operation: "tailor-resume.step-1.keywords",
      outputTokens: 520,
      provider: "openai",
      providerResponseId: "debug-response-keywords",
      reasoningTokens: 0,
      requestStartedAt: new Date("2026-05-25T20:05:00.000Z").toISOString(),
      round: 1,
      status: "succeeded",
      stepLabel: "Step 1 keyword extraction",
      stepNumber: 1,
      subjectStatus: "unarchived",
      tailoredResumeId: "debug-tailored-resume-current",
      tailorResumeRunId: "debug-tailor-run-current",
      totalCostUsdMicros: "8400",
      totalTokens: 3640,
    },
    {
      applicationId: "debug-application-product",
      attempt: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 1200,
      durationMs: 12100,
      error: null,
      id: "debug-usage-planning",
      inputTokens: 5600,
      jobUrl: "https://jobs.example.com/product-engineer",
      model: "claude-sonnet-4-6",
      operation: "tailor-resume.step-3.planning",
      outputTokens: 1020,
      provider: "anthropic",
      providerResponseId: "debug-response-planning",
      reasoningTokens: 0,
      requestStartedAt: new Date("2026-05-25T23:21:00.000Z").toISOString(),
      round: 1,
      status: "succeeded",
      stepLabel: "Step 3 planning",
      stepNumber: 3,
      subjectStatus: "archived",
      tailoredResumeId: "debug-tailored-resume-archived",
      tailorResumeRunId: "debug-tailor-run-archived",
      totalCostUsdMicros: "12200",
      totalTokens: 6620,
    },
    {
      applicationId: "debug-application-data",
      attempt: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 800,
      durationMs: 10200,
      error: null,
      id: "debug-usage-data-planning",
      inputTokens: 3800,
      jobUrl: "https://jobs.example.com/data-platform",
      model: "claude-sonnet-4-6",
      operation: "tailor-resume.step-3.planning",
      outputTokens: 640,
      provider: "anthropic",
      providerResponseId: "debug-response-data-planning",
      reasoningTokens: 0,
      requestStartedAt: new Date("2026-05-24T19:48:00.000Z").toISOString(),
      round: 1,
      status: "succeeded",
      stepLabel: "Step 3 planning",
      stepNumber: 3,
      subjectStatus: "unarchived",
      tailoredResumeId: "debug-tailored-resume-data",
      tailorResumeRunId: "debug-tailor-run-data",
      totalCostUsdMicros: "9800",
      totalTokens: 4440,
    },
    {
      applicationId: null,
      attempt: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: 3200,
      error: "Provider request failed after URL capture.",
      id: "debug-usage-failed",
      inputTokens: 1600,
      jobUrl: "https://jobs.example.com/data-platform",
      model: "gpt-5-mini",
      operation: "tailor-resume.step-1.keywords",
      outputTokens: 360,
      provider: "openai",
      providerResponseId: null,
      reasoningTokens: 0,
      requestStartedAt: new Date("2026-05-25T22:58:00.000Z").toISOString(),
      round: 1,
      status: "failed",
      stepLabel: "Step 1 keyword extraction",
      stepNumber: 1,
      subjectStatus: "deleted",
      tailoredResumeId: null,
      tailorResumeRunId: "debug-tailor-run-deleted",
      totalCostUsdMicros: "2100",
      totalTokens: 1960,
    },
  ];

  return {
    events,
    generatedAt: now,
    period: "all",
    resumeGroups: [
      {
        applicationId: "debug-application-acme",
        companyName: "Acme AI",
        displayName: "Senior Product Engineer",
        eventCount: 2,
        failedEventCount: 0,
        firstSeenAt: new Date("2026-05-25T20:05:00.000Z").toISOString(),
        inputTokens: 7300,
        jobUrl: mockPageContext.url,
        lastSeenAt: now,
        outputTokens: 1280,
        positionTitle: "Senior Product Engineer",
        status: "unarchived",
        tailoredResumeId: "debug-tailored-resume-current",
        totalCostUsdMicros: "27000",
        totalTokens: 8600,
      },
      {
        applicationId: "debug-application-product",
        companyName: "Product Co",
        displayName: "Product Engineer",
        eventCount: 1,
        failedEventCount: 0,
        firstSeenAt: new Date("2026-05-25T23:21:00.000Z").toISOString(),
        inputTokens: 5600,
        jobUrl: "https://jobs.example.com/product-engineer",
        lastSeenAt: new Date("2026-05-25T23:21:00.000Z").toISOString(),
        outputTokens: 1020,
        positionTitle: "Product Engineer",
        status: "archived",
        tailoredResumeId: "debug-tailored-resume-archived",
        totalCostUsdMicros: "12200",
        totalTokens: 6620,
      },
      {
        applicationId: "debug-application-data",
        companyName: "Data Platform Co",
        displayName: "Data Platform Engineer",
        eventCount: 1,
        failedEventCount: 0,
        firstSeenAt: new Date("2026-05-24T19:48:00.000Z").toISOString(),
        inputTokens: 3800,
        jobUrl: "https://jobs.example.com/data-platform",
        lastSeenAt: new Date("2026-05-24T19:48:00.000Z").toISOString(),
        outputTokens: 640,
        positionTitle: "Data Platform Engineer",
        status: "unarchived",
        tailoredResumeId: "debug-tailored-resume-data",
        totalCostUsdMicros: "9800",
        totalTokens: 4440,
      },
      {
        applicationId: "debug-application-legacy-security",
        companyName: "Security Co",
        displayName: "Security Engineer",
        eventCount: 0,
        failedEventCount: 0,
        firstSeenAt: new Date("2026-05-20T16:30:00.000Z").toISOString(),
        inputTokens: 0,
        jobUrl: "https://jobs.example.com/security-engineer",
        lastSeenAt: new Date("2026-05-20T16:30:00.000Z").toISOString(),
        outputTokens: 0,
        positionTitle: "Security Engineer",
        status: "unarchived",
        tailoredResumeId: "debug-tailored-resume-legacy-security",
        totalCostUsdMicros: "0",
        totalTokens: 0,
      },
      {
        applicationId: "debug-application-legacy-design",
        companyName: "Design Systems Co",
        displayName: "Design Systems Engineer",
        eventCount: 0,
        failedEventCount: 0,
        firstSeenAt: new Date("2026-05-12T15:15:00.000Z").toISOString(),
        inputTokens: 0,
        jobUrl: "https://jobs.example.com/design-systems",
        lastSeenAt: new Date("2026-05-12T15:15:00.000Z").toISOString(),
        outputTokens: 0,
        positionTitle: "Design Systems Engineer",
        status: "archived",
        tailoredResumeId: "debug-tailored-resume-legacy-design",
        totalCostUsdMicros: "0",
        totalTokens: 0,
      },
    ],
    summary: {
      archivedCostUsdMicros: "12200",
      deletedCostUsdMicros: "2100",
      eventCount: events.length,
      failedEventCount: 1,
      inputTokens: 19300,
      outputTokens: 3300,
      totalCostUsdMicros: "47000",
      totalTokens: 23300,
      unarchivedCostUsdMicros: "36700",
      urlCount: 3,
    },
    urlGroups: [],
  };
}

const mockStep2EmphasizedTechnologies = [
  {
    classification: "skills_section",
    evidence: "Posting lists Kubernetes as a required platform skill.",
    name: "Kubernetes",
    priority: "high",
  },
  {
    classification: "narrative",
    evidence: "Posting asks for load balancing judgment.",
    name: "Load balancing",
    priority: "high",
  },
  {
    classification: "skills_section",
    evidence: "Posting lists Terraform as a preferred platform skill.",
    name: "Terraform",
    priority: "low",
  },
] satisfies NonNullable<
  TailorResumeRunRecord["generationStep"]
>["emphasizedTechnologies"];

const mockStep2BlockingTechnologies = mockStep2EmphasizedTechnologies.filter(
  (technology) => technology.classification === "skills_section",
);

function createMockTailoringRun(
  status: TailorResumeRunRecord["status"],
  variant:
    | "default"
    | "step2-blocked"
    | "step3-retry-running"
    | "step5-error"
    | "step5-running" = "default",
) {
  const isStep3Retry = variant === "step3-retry-running";
  const isStep5Error = variant === "step5-error";
  const isStep5Retry = isStep5Error || variant === "step5-running";
  const isStep2Blocked = variant === "step2-blocked";
  const nowTime = Date.now();
  const step1DurationMs = 44_000;
  const step2DurationMs = 72_000;
  const step3DurationMs = 132_000;
  const step4DurationMs = 17_000;
  const runningStartedAtTime = nowTime - step4DurationMs;
  const capturedAtTime =
    status === "running" && isStep5Retry
      ? nowTime -
        step1DurationMs -
        step2DurationMs -
        step3DurationMs -
        step4DurationMs
      : Date.parse("2026-04-21T23:10:00.000Z");

	  return {
	    applicationId: null,
	    capturedAt: new Date(capturedAtTime).toISOString(),
    companyName: "Acme AI",
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    message:
      isStep2Blocked
        ? "Review keywords in the side panel, then press play."
        : status === "success"
        ? "Tailored resume saved to Job Helper."
      : isStep3Retry
        ? "Step 3/4: Planning targeted edits - Retrying (attempt 2)"
        : isStep5Retry
            ? "Step 4/4: Keeping the tailored resume within the original page count - Retrying (attempt 2)"
        : status === "running"
          ? "Tailoring your resume for this job..."
          : "Tailor Resume failed while generating the PDF.",
    generationStep: isStep2Blocked
      ? {
          attempt: 1,
          blockingTechnologies: mockStep2BlockingTechnologies,
          detail:
            "Still waiting on 2 skills-section blockers. Add support or mark the terms narrative/non-skill before pressing play again.",
          durationMs: step2DurationMs,
          emphasizedTechnologies: mockStep2EmphasizedTechnologies,
          retrying: false,
          status: "running",
          stepCount: 5,
          stepNumber: 2,
          summary: "Waiting for skills-section support",
        }
      : isStep3Retry
      ? {
          attempt: 2,
          detail: "Retrying the planning pass after validation failed.",
          durationMs: 0,
          retrying: true,
          status: "running",
          stepCount: 5,
          stepNumber: 3,
          summary: "Plan targeted edits",
        }
      : isStep5Retry
      ? {
          attempt: 2,
          detail:
            "The model did not submit verified compaction candidates after 4 page-fit tool rounds.",
          durationMs: isStep5Error ? step4DurationMs : 0,
          retrying: true,
          status: "running",
          stepCount: 5,
          stepNumber: 5,
          summary: "Keeping the tailored resume within the original page count",
        }
      : null,
    generationStepTimings: isStep2Blocked
      ? [
          {
            attempt: 1,
            detail: "Classified scraped job keywords.",
            durationMs: step1DurationMs,
            emphasizedTechnologies: mockStep2EmphasizedTechnologies,
            observedAt: new Date(capturedAtTime + step1DurationMs).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 1,
            summary: "Scrape keywords",
          },
          {
            attempt: 1,
            blockingTechnologies: mockStep2BlockingTechnologies,
            detail:
              "Still waiting on 2 skills-section blockers. Add support or mark the terms narrative/non-skill before pressing play again.",
            durationMs: step2DurationMs,
            emphasizedTechnologies: mockStep2EmphasizedTechnologies,
            observedAt: new Date(
              capturedAtTime + step1DurationMs + step2DurationMs,
            ).toISOString(),
            retrying: false,
            status: "running",
            stepCount: 5,
            stepNumber: 2,
            summary: "Waiting for skills-section support",
          },
        ]
      : isStep3Retry
      ? [
          {
            attempt: 1,
            detail: "Prepared job keywords for clarification and planning.",
            durationMs: step1DurationMs,
            observedAt: new Date(capturedAtTime + step1DurationMs).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 1,
            summary: "Scrape keywords",
          },
          {
            attempt: 1,
            detail: "No follow-up questions were needed.",
            durationMs: step2DurationMs,
            observedAt: new Date(
              capturedAtTime + step1DurationMs + step2DurationMs,
            ).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 2,
            summary: "Clarify missing details",
          },
          {
            attempt: 1,
            detail: "The Step 3 plan still misses required keyword assignments.",
            durationMs: step3DurationMs,
            observedAt: new Date(
              capturedAtTime +
                step1DurationMs +
                step2DurationMs +
                step3DurationMs,
            ).toISOString(),
            retrying: false,
            status: "failed",
            stepCount: 5,
            stepNumber: 3,
            summary: "Plan targeted edits",
          },
          {
            attempt: 2,
            detail: "Retrying the planning pass after validation failed.",
            durationMs: 0,
            observedAt: new Date(runningStartedAtTime).toISOString(),
            retrying: true,
            status: "running",
            stepCount: 5,
            stepNumber: 3,
            summary: "Plan targeted edits",
          },
        ]
      : isStep5Retry
      ? [
          {
            attempt: 1,
            detail: "Prepared job keywords for clarification and planning.",
            durationMs: step1DurationMs,
            observedAt: new Date(capturedAtTime + step1DurationMs).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 1,
            summary: "Scrape keywords",
          },
          {
            attempt: 1,
            detail: "No follow-up questions were needed.",
            durationMs: step2DurationMs,
            observedAt: new Date(
              capturedAtTime + step1DurationMs + step2DurationMs,
            ).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 2,
            summary: "Clarify missing details",
          },
          {
            attempt: 1,
            detail: "Finished planning targeted edits.",
            durationMs: step3DurationMs,
            observedAt: new Date(
              capturedAtTime +
                step1DurationMs +
                step2DurationMs +
                step3DurationMs,
            ).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 3,
            summary: "Plan targeted edits",
          },
          {
            attempt: 1,
            detail: "Generated block-scoped edits.",
            durationMs: step4DurationMs,
            observedAt: new Date(
              capturedAtTime +
                step1DurationMs +
                step2DurationMs +
                step3DurationMs +
                step4DurationMs,
            ).toISOString(),
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 4,
            summary: "Apply resume changes",
          },
          {
            attempt: 2,
            detail:
              "The model did not submit verified compaction candidates after 4 page-fit tool rounds.",
            durationMs: isStep5Error ? step4DurationMs : 0,
            observedAt: new Date(runningStartedAtTime).toISOString(),
            retrying: true,
            status: "running",
            stepCount: 5,
            stepNumber: 5,
            summary: "Keeping the tailored resume within the original page count",
          },
        ]
      : [],
    jobIdentifier: null,
    pageTitle: mockPageContext.title,
    pageUrl: mockPageContext.url,
	    positionTitle: "Senior Product Engineer",
	    status,
	    suppressedTailoredResumeId: null,
	    tailoredResumeError:
      status === "error"
        ? isStep5Error
          ? "The model did not submit verified compaction candidates after 4 page-fit tool rounds."
          : "Debug failure state for visual testing."
        : null,
    tailoredResumeId: status === "success" ? "debug-tailored-resume" : null,
  } satisfies TailorResumeRunRecord;
}

function createMockTailoredResumes(input: { includeUserEdit?: boolean } = {}) {
  const sourceAnnotatedLatexCode = [
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-1",
    "\\resumeItem{Supported backend platform work across consumer analytics and ads tooling.}",
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
    "\\resumeItem{Refactored backend services and maintained internal account management workflows.}",
  ].join("\n");
  const initialAnnotatedLatexCode = [
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-1",
    "\\resumeItem{Led major refactor enabling \\$50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.}",
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
    "\\resumeItem{Built and migrated 100\\% of internal account managers and external clients to a streamlined messaging and reporting system.}",
  ].join("\n");
  const refinedAnnotatedLatexCode = [
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-1",
    "\\resumeItem{Led major refactor enabling \\$50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.}",
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
    "\\resumeItem{Built and migrated 100\\% of internal account managers and external clients to a streamlined messaging and reporting system.}",
    "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2.inserted-debug",
    "\\resumeItem{Refactored 31K+ LOC in 365 files, reworking 140+ tRPC endpoints \\& Bayesian inference engine for platform-agnostic objectives.}",
  ].join("\n");
  const initialEdit = {
    afterLatexCode:
      "\\resumeItem{Led major refactor enabling \\$50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.}",
    beforeLatexCode:
      "\\resumeItem{Supported backend platform work across consumer analytics and ads tooling.}",
    command: null,
    customLatexCode: null,
    editId: "debug-edit-tiktok-refactor",
    generatedByStep: 4 as const,
    reason: "Highlights the NewForm AI platform refactor from the rendered resume.",
    segmentId: "work-experience.entry-1.bullet-1",
    state: "applied" as const,
  };
  const refinedEdits = [
    {
      ...initialEdit,
      afterLatexCode:
        "\\resumeItem{Led major refactor enabling \\$50K+/mo in TikTok ad spend by incorporating TikTok support for our entire suite of software.}",
      editId: "debug-edit-tiktok-refactor",
      reason:
        "Highlights the NewForm AI platform refactor from the rendered resume.",
    },
    {
      afterLatexCode:
        "\\resumeItem{Refactored 31K+ LOC in 365 files, reworking 140+ tRPC endpoints \\& Bayesian inference engine for platform-agnostic objectives.}",
      beforeLatexCode: "",
      command: null,
      customLatexCode: null,
      editId: "debug-edit-inserted-bullet",
      generatedByStep: 4 as const,
      reason: "Shows another rendered NewForm AI bullet in the review timeline.",
      segmentId: "work-experience.entry-1.bullet-2.inserted-debug",
      state: "applied" as const,
    },
  ];
  const userEdit = {
    afterLatexCode:
      "\\resumeItem{User-authored browser check edit for deleting a saved block edit.}",
    beforeLatexCode:
      "\\resumeItem{Refactored backend services and maintained internal account management workflows.}",
    command: null,
    customLatexCode: null,
    editId: "work-experience.entry-1.bullet-2:user",
    generatedByStep: 4 as const,
    reason: "User edit",
    source: "user" as const,
    segmentId: "work-experience.entry-1.bullet-2",
    state: "applied" as const,
  };
  const visibleEdits = input.includeUserEdit
    ? [...refinedEdits, userEdit]
    : refinedEdits;
  const visibleAnnotatedLatexCode = input.includeUserEdit
    ? rebuildDebugAnnotatedLatexCode({
        edits: visibleEdits,
        sourceAnnotatedLatexCode,
      })
    : refinedAnnotatedLatexCode;

  return [
    {
      annotatedLatexCode: visibleAnnotatedLatexCode,
      applicationId: null,
      archivedAt: null as string | null,
      companyName: "Microsoft",
      createdAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
      displayName: "Microsoft - Software Engineer",
      edits: visibleEdits,
      emphasizedTechnologies: [],
      error: null,
      id: "debug-tailored-resume",
      jobIdentifier: null,
      jobUrl: "https://careers.microsoft.com/jobs/debug-tailored-resume",
      keywordCoverage: null,
      openAiDebug: {
        implementation: {
          outputJson:
            '{\n  "changes": [\n    {\n      "segmentId": "work-experience.entry-1.bullet-1",\n      "latexCode": "\\\\resumeItem{Shipped Kubernetes deployment automation for production services.}"\n    }\n  ]\n}',
          prompt: "Debug Step 4 implementation prompt.",
          skippedReason: null,
          systemPrompt: "Debug Step 4 implementation system prompt.",
          toolCalls: [
            {
              id: "debug-step-4-tool-1",
              input:
                '{\n  "changes": [\n    {\n      "segmentId": "work-experience.entry-1.bullet-1",\n      "latexCode": "\\\\resumeItem{Shipped Kubernetes deployment automation for production services.}"\n    }\n  ],\n  "lineCountSegmentIds": []\n}',
              output:
                '{\n  "keywordCoverage": {\n    "missingHighPriority": [],\n    "presentHighPriority": ["Kubernetes"]\n  }\n}',
              toolName: "check_implemented_resume_keyword_coverage",
            },
          ],
        },
        keywordExtraction: {
          outputJson:
            '{\n  "emphasizedTechnologies": [\n    {\n      "name": "Kubernetes",\n      "priority": "high",\n      "evidence": "Required infrastructure experience."\n    }\n  ]\n}',
          prompt: "Debug Step 1 keyword extraction prompt.",
          skippedReason: null,
          systemPrompt: "Debug Step 1 keyword extraction system prompt.",
        },
        keywordReview: {
          outputJson:
            '{\n  "conversation": [],\n  "questioningSummary": null\n}',
          prompt: null,
          skippedReason:
            "Step 2 used deterministic keyword review without follow-up model tool calls.",
          systemPrompt: "Debug Step 2 interview system prompt.",
        },
        planning: {
          outputJson:
            '{\n  "changes": [\n    {\n      "segmentId": "work-experience.entry-1.bullet-1",\n      "editIntent": "Fit Kubernetes deployment automation into this production services bullet.",\n      "targetKeywords": ["Kubernetes"],\n      "reason": "Highlights required infrastructure experience."\n    }\n  ]\n}',
          prompt: "Debug Step 3 planning prompt.",
          skippedReason: null,
          systemPrompt: "Debug Step 3 planning system prompt.",
          toolCalls: [
            {
              id: "debug-step-3-tool-1",
              input:
                '{\n  "changes": [\n    {\n      "segmentId": "work-experience.entry-1.bullet-1",\n      "editIntent": "Fit Kubernetes deployment automation into this production services bullet.",\n      "targetKeywords": ["Kubernetes"]\n    }\n  ]\n}',
              output:
                '{\n  "missingHighPriority": [],\n  "satisfiedHighPriority": ["Kubernetes"]\n}',
              toolName: "check_planned_keyword_assignments",
            },
          ],
        },
      },
      pdfUpdatedAt: new Date("2026-04-21T23:19:00.000Z").toISOString(),
      positionTitle: "Software Engineer",
      sourceAnnotatedLatexCode,
      status: "ready",
      updatedAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
      versions: [
        {
          annotatedLatexCode: initialAnnotatedLatexCode,
          assistantMessage: "Generated the first tailored resume output.",
          createdAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
          edits: [initialEdit],
          id: "debug-version-initial",
          latexCode: initialAnnotatedLatexCode,
          pdfUpdatedAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
          source: "initial" as const,
          userPrompt: null,
        },
        {
          annotatedLatexCode: refinedAnnotatedLatexCode,
          assistantMessage:
            "Updated the Kubernetes bullet and added a timeline verification bullet. [[see_diff:debug-version-initial..debug-version-chat-1]]",
          createdAt: new Date("2026-04-21T23:19:00.000Z").toISOString(),
          edits: refinedEdits,
          id: "debug-version-chat-1",
          latexCode: refinedAnnotatedLatexCode,
          pdfUpdatedAt: new Date("2026-04-21T23:19:00.000Z").toISOString(),
          source: "refinement" as const,
          userPrompt: "Add PostgreSQL and one extra implementation bullet.",
        },
      ],
    },
  ];
}

function readDebugAnnotatedSegments(annotatedLatexCode: string) {
  const markerPattern =
    /^% JOBHELPER_SEGMENT_ID:\s*(?<segmentId>[^\n]+)\n(?<latexCode>[\s\S]*?)(?=^% JOBHELPER_SEGMENT_ID:|\s*$)/gm;
  const segments: Array<{
    latexCode: string;
    segmentId: string;
  }> = [];

  for (const match of annotatedLatexCode.matchAll(markerPattern)) {
    const segmentId = match.groups?.segmentId?.trim();
    const latexCode = match.groups?.latexCode?.replace(/\n+$/, "");

    if (segmentId && latexCode !== undefined) {
      segments.push({ latexCode, segmentId });
    }
  }

  return segments;
}

function rebuildDebugAnnotatedLatexCode(input: {
  edits: Array<{
    afterLatexCode: string;
    customLatexCode?: string | null;
    segmentId: string;
    state: "applied" | "rejected";
  }>;
  sourceAnnotatedLatexCode: string;
}) {
  const activeEditsBySegmentId = new Map(
    input.edits
      .filter((edit) => edit.state === "applied")
      .map((edit) => [
        edit.segmentId,
        edit.customLatexCode ?? edit.afterLatexCode,
      ]),
  );

  return readDebugAnnotatedSegments(input.sourceAnnotatedLatexCode)
    .map((segment) =>
      [
        `% JOBHELPER_SEGMENT_ID: ${segment.segmentId}`,
        activeEditsBySegmentId.get(segment.segmentId) ?? segment.latexCode,
      ].join("\n"),
    )
    .join("\n");
}

function createMockSkillData(): TailorResumeStoredSkillData {
  const updatedAt = new Date("2026-04-21T22:50:00.000Z").toISOString();
  const kubernetesSkill = {
    id: "debug-skill-kubernetes",
    listInSkillsOnly: false,
    name: "Kubernetes",
    normalizedName: "kubernetes",
    updatedAt,
  };
  const postgresSkill = {
    id: "debug-skill-postgresql",
    listInSkillsOnly: false,
    name: "PostgreSQL",
    normalizedName: "postgresql",
    updatedAt,
  };

  return {
    keywordClassifications: [],
    resumeExperiences: [
      {
        bulletSegmentIds: [
          "work-experience.entry-1.bullet-1",
          "work-experience.entry-1.bullet-2",
        ],
        headingSegmentId: "work-experience.entry-1",
        id: "work-experience.entry-1",
        label: "NewForm AI - Software Engineer Intern",
      },
      {
        bulletSegmentIds: ["projects.entry-1.bullet-1"],
        headingSegmentId: "projects.entry-1",
        id: "projects.entry-1",
        label: "Ray Tracer",
      },
    ],
    skills: [kubernetesSkill, postgresSkill],
    spareBullets: [
      {
        createdAt: updatedAt,
        id: "debug-spare-bullet-kubernetes",
        quote:
          "Deployed Kubernetes-backed services with PostgreSQL persistence to support low-latency resume-tailoring review workflows.",
        replacesQuote:
          "Built backend review workflows with persistent storage and low-latency APIs.",
        resumeExperienceId: "work-experience.entry-1",
        skillIds: [kubernetesSkill.id, postgresSkill.id],
        skills: [kubernetesSkill, postgresSkill],
        updatedAt,
      },
    ],
    updatedAt,
  };
}

function readInitialAuthSession(searchParams: URLSearchParams) {
  if (searchParams.get("auth") !== "signed-in") {
    return null;
  }

  const debugEmail = searchParams.get("debugEmail")?.trim();
  const debugUserId = searchParams.get("debugUserId")?.trim();
  const debugName = searchParams.get("debugName")?.trim();

  return {
    ...mockSession,
    sessionToken:
      searchParams.get("debugSessionToken")?.trim() || mockSession.sessionToken,
    user: {
      ...mockSession.user,
      email: debugEmail || mockSession.user.email,
      id: debugUserId || mockSession.user.id,
      name: debugName || mockSession.user.name,
    },
  };
}

function readInitialTailoringRun(searchParams: URLSearchParams) {
  const runState = searchParams.get("run");

  if (runState === "running" || runState === "success" || runState === "error") {
    return createMockTailoringRun(runState);
  }

  if (runState === "step4-running" || runState === "step5-running") {
    return createMockTailoringRun("running", "step5-running");
  }

  if (runState === "step2-blocked") {
    return createMockTailoringRun("needs_input", "step2-blocked");
  }

  if (runState === "step3-retry") {
    return createMockTailoringRun("running", "step3-retry-running");
  }

  if (runState === "step4-error" || runState === "step5-error") {
    return createMockTailoringRun("error", "step5-error");
  }

  return null;
}

function readInitialExtensionPreferences(searchParams: URLSearchParams) {
  const rawTimeMode =
    searchParams.get("timeMode") ?? searchParams.get("time") ?? "";

  return {
    compactTailorRun:
      searchParams.get("compact") === "1" ||
      searchParams.get("compact") === "true" ||
      searchParams.get("compact") === "on",
    supportChatTipDismissed:
      searchParams.get("dismissSupportChatTip") === "1" ||
      searchParams.get("dismissSupportChatTip") === "true" ||
      searchParams.get("dismissSupportChatTip") === "on",
    tailorRunTimeDisplayMode:
      rawTimeMode === "aggregate" || rawTimeMode === "specific"
        ? rawTimeMode
        : defaultExtensionPreferences.tailorRunTimeDisplayMode,
  };
}

function readInitialPromptSettings(searchParams: URLSearchParams) {
  const step2ExperienceChat =
    searchParams.get("step2ExperienceChatPrompt")?.trim() ?? "";

  return {
    tailorResumeStep2ExperienceChat: step2ExperienceChat || null,
  };
}

function readRequestBody(
  body: BodyInit | null | undefined,
): Record<string, unknown> {
  if (typeof body !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(body);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readBodyString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function readBodyStringArray(body: Record<string, unknown>, key: string) {
  const value = body[key];

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function createDebugNdjsonResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/x-ndjson; charset=utf-8",
    },
    status: 200,
  });
}

function waitForDebugDelay(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function readStorageValue(
  storage: Map<string, unknown>,
  keys?: string | string[] | Record<string, unknown> | null,
) {
  if (typeof keys === "string") {
    return { [keys]: storage.get(keys) };
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storage.get(key)]));
  }

  if (isRecord(keys)) {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallbackValue]) => [
        key,
        storage.get(key) ?? fallbackValue,
      ]),
    );
  }

  return Object.fromEntries(storage);
}

function shouldInstallDebugChrome() {
  const currentChrome = globalThis.chrome as Partial<typeof chrome> | undefined;

  return (
    typeof window !== "undefined" &&
    window.location.protocol !== "chrome-extension:" &&
    !currentChrome?.runtime?.id
  );
}

export function installDebugChromeRuntime() {
  if (!shouldInstallDebugChrome()) {
    return;
  }

  document.documentElement.dataset.jobHelperChromeDebug = "true";

  const searchParams = new URLSearchParams(window.location.search);
  const storageChangedEvent = createEvent<Parameters<StorageChangeListener>>();
  const tabActivatedEvent = createEvent<Parameters<TabActivatedListener>>();
  const tabUpdatedEvent = createEvent<Parameters<TabUpdatedListener>>();
  const storage = new Map<string, unknown>();
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let authSession = readInitialAuthSession(searchParams);
  let mockTailoredResumes = authSession
    ? createMockTailoredResumes({
        includeUserEdit:
          searchParams.get("userEdit") === "1" ||
          searchParams.get("userEdit") === "true",
      })
    : [];
  let mockSkillData = createMockSkillData();
  let mockSupportChatMessages: DebugChatMessage[] = [];
  let mockTailoringRun = readInitialTailoringRun(searchParams);

  if (authSession) {
    storage.set(AUTH_SESSION_STORAGE_KEY, authSession);
  }

  const initialTailoringRunKey = normalizeComparableUrl(
    mockTailoringRun?.pageUrl ?? null,
  );
  const initialExtensionPreferences =
    readInitialExtensionPreferences(searchParams);
  const initialPromptSettings = readInitialPromptSettings(searchParams);
  const debugPreviewPdfUrl = searchParams.get("previewPdfUrl")?.trim() ?? "";

  if (mockTailoringRun) {
    storage.set(LAST_TAILORING_STORAGE_KEY, mockTailoringRun);
    if (initialTailoringRunKey) {
      storage.set(TAILORING_RUNS_STORAGE_KEY, {
        [initialTailoringRunKey]: mockTailoringRun,
      });
    }
  }

  if (
    initialExtensionPreferences.compactTailorRun ||
    initialExtensionPreferences.supportChatTipDismissed ||
    initialExtensionPreferences.tailorRunTimeDisplayMode !==
      defaultExtensionPreferences.tailorRunTimeDisplayMode
  ) {
    storage.set(
      EXTENSION_PREFERENCES_STORAGE_KEY,
      initialExtensionPreferences,
    );
  }

  function buildMockPersonalInfo() {
    const activeTailorings =
      mockTailoringRun?.status === "needs_input" &&
      mockTailoringRun.generationStep?.stepNumber === 2
        ? [
            {
              applicationId: mockTailoringRun.applicationId,
              blockingTechnologies: mockStep2BlockingTechnologies,
              companyName: mockTailoringRun.companyName,
              createdAt: mockTailoringRun.capturedAt,
              emphasizedTechnologies: mockStep2EmphasizedTechnologies,
              id: "debug-pending-tailoring",
              interviewStatus: "pending" as const,
              jobDescription: mockPageContext.description,
              jobIdentifier: mockTailoringRun.jobIdentifier,
              jobUrl: mockTailoringRun.pageUrl,
              kind: "pending_interview" as const,
              positionTitle: mockTailoringRun.positionTitle,
              questionCount: null,
              updatedAt: mockTailoringRun.capturedAt,
            },
          ]
        : mockTailoringRun?.status === "running"
          ? [
            {
              applicationId: mockTailoringRun.applicationId,
              blockingTechnologies: mockTailoringRun.generationStep
                ?.blockingTechnologies ?? [],
              companyName: mockTailoringRun.companyName,
              createdAt: mockTailoringRun.capturedAt,
              id: "debug-active-tailoring",
              jobDescription: mockPageContext.description,
              jobIdentifier: mockTailoringRun.jobIdentifier,
              jobUrl: mockTailoringRun.pageUrl,
              kind: "active_generation" as const,
              lastStep: mockTailoringRun.generationStep ?? null,
              positionTitle: mockTailoringRun.positionTitle,
              error: null,
              status: "RUNNING" as const,
              updatedAt: mockTailoringRun.capturedAt,
            },
          ]
        : [];

    return {
      activeTailoring: activeTailorings[0] ?? null,
      activeTailorings,
      applicationCount: 0,
      applications: [],
      companyCount: 0,
      generationSettings: {
        allowTailorResumeFollowUpQuestions: true,
        includeLowPriorityTermsInKeywordCoverage: false,
        preventPageCountIncrease: true,
      },
      originalResume: {
        error: null,
        filename: "Henry Deutsch Resume.pdf",
        latexStatus: "ready",
        pdfUpdatedAt: new Date("2026-04-21T22:45:00.000Z").toISOString(),
        resumeUpdatedAt: new Date("2026-04-21T22:45:00.000Z").toISOString(),
      },
      promptSettings: initialPromptSettings,
      syncState: emptyUserSyncStateSnapshot(),
      skillData: mockSkillData,
      tailoredResumes: mockTailoredResumes,
      tailoringInterview: null,
      tailoringInterviews: [],
      userMarkdown: {
        markdown:
          "# USER.md\n\n- C language was also used in the Ray Tracer project, so we can lean on this even though it is primarily a C++ project.\n",
        nonTechnologies: [],
        updatedAt: new Date("2026-04-21T22:45:00.000Z").toISOString(),
      },
    };
  }

  async function clearTailoringState() {
    mockTailoringRun = null;
    await storageArea.remove([
      EXISTING_TAILORING_STORAGE_KEY,
      LAST_TAILORING_STORAGE_KEY,
      PREPARING_TAILORING_STORAGE_KEY,
      TAILORING_RUNS_STORAGE_KEY,
    ]);
  }

  function shouldDeleteTailoredResume(input: {
    jobUrl: string;
    tailoredResumeId: string;
  }) {
    const normalizedTargetJobUrl = normalizeComparableUrl(input.jobUrl);

    return (record: { id: string; jobUrl: string | null }) => {
      if (input.tailoredResumeId && record.id === input.tailoredResumeId) {
        return true;
      }

      return Boolean(
        normalizedTargetJobUrl &&
          normalizeComparableUrl(record.jobUrl) === normalizedTargetJobUrl,
      );
    };
  }

  function emitStorageChange(
    key: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    storageChangedEvent.emit(
      {
        [key]: {
          newValue,
          oldValue,
        },
      },
      "local",
    );
  }

  const storageArea = {
    async clear() {
      const previousEntries = Array.from(storage.entries());
      storage.clear();

      for (const [key, oldValue] of previousEntries) {
        emitStorageChange(key, oldValue, undefined);
      }
    },
    async get(
      keys?: string | string[] | Record<string, unknown> | null,
    ): Promise<Record<string, unknown>> {
      return readStorageValue(storage, keys);
    },
    async remove(keys: string | string[]) {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];

      for (const key of normalizedKeys) {
        const oldValue = storage.get(key);
        storage.delete(key);
        emitStorageChange(key, oldValue, undefined);
      }
    },
    async set(items: Record<string, unknown>) {
      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = storage.get(key);
        storage.set(key, newValue);
        emitStorageChange(key, oldValue, newValue);
      }
    },
  };

  const debugChrome = {
    runtime: {
      id: "job-helper-debug-runtime",
      async sendMessage(message: unknown) {
        const type = isRecord(message) ? message.type : null;

        if (type === "JOB_HELPER_AUTH_STATUS") {
          return authSession
            ? { ok: true, session: authSession, status: "signedIn" }
            : { ok: true, status: "signedOut" };
        }

        if (type === "JOB_HELPER_SIGN_IN") {
          authSession = mockSession;
          await storageArea.set({ [AUTH_SESSION_STORAGE_KEY]: authSession });

          return { ok: true, session: authSession, status: "signedIn" };
        }

        if (type === "JOB_HELPER_SIGN_OUT") {
          authSession = null;
          await storageArea.remove(AUTH_SESSION_STORAGE_KEY);

          return { ok: true, status: "signedOut" };
        }

        if (type === "JOB_HELPER_TAILORED_RESUMES") {
          return {
            ok: true,
            records: authSession ? mockTailoredResumes : [],
          };
        }

        if (type === "JOB_HELPER_PERSONAL_INFO") {
          return {
            ok: true,
            personalInfo: buildMockPersonalInfo(),
          };
        }

        if (type === "JOB_HELPER_TRIGGER_CAPTURE") {
          window.setTimeout(() => {
            mockTailoringRun = createMockTailoringRun("success");
            void storageArea.set({
              [TAILORING_RUNS_STORAGE_KEY]: {
                [normalizeComparableUrl(mockPageContext.url) ?? mockPageContext.url]:
                  mockTailoringRun,
              },
            });
          }, 500);

          return { ok: true };
        }

        if (type === "JOB_HELPER_REGENERATE_TAILORING") {
          mockTailoringRun = createMockTailoringRun("running", "step5-running");
          void storageArea.set({
            [TAILORING_RUNS_STORAGE_KEY]: {
              [normalizeComparableUrl(mockPageContext.url) ?? mockPageContext.url]:
                mockTailoringRun,
            },
          });

          window.setTimeout(() => {
            mockTailoringRun = createMockTailoringRun("success");
            void storageArea.set({
              [TAILORING_RUNS_STORAGE_KEY]: {
                [normalizeComparableUrl(mockPageContext.url) ?? mockPageContext.url]:
                  mockTailoringRun,
              },
            });
          }, 750);

          return { ok: true };
        }

        if (type === "JOB_HELPER_CANCEL_CURRENT_TAILORING") {
          await clearTailoringState();
          return {
            ok: true,
            personalInfo: buildMockPersonalInfo(),
          };
        }

        if (type === "JOB_HELPER_OPEN_DASHBOARD") {
          return { ok: true };
        }

        if (type === "JOB_HELPER_DOWNLOAD_TAILORED_RESUME") {
          const payload =
            isRecord(message) && isRecord(message.payload)
              ? message.payload
              : {};
          const filename =
            typeof payload.downloadName === "string" && payload.downloadName.trim()
              ? payload.downloadName.trim()
              : "Tailored Resume.pdf";
          const debugDownloadsHost = globalThis as typeof globalThis & {
            __jobHelperDebugDownloads?: Array<{
              filename: string;
              tailoredResumeId: string | null;
            }>;
          };

          debugDownloadsHost.__jobHelperDebugDownloads = [
            ...(debugDownloadsHost.__jobHelperDebugDownloads ?? []),
            {
              filename,
              tailoredResumeId:
                typeof payload.tailoredResumeId === "string"
                  ? payload.tailoredResumeId
                  : null,
            },
          ];

          return { filename, ok: true };
        }

        return { ok: true };
      },
    },
    storage: {
      local: storageArea,
      onChanged: storageChangedEvent,
    },
    tabs: {
      onActivated: tabActivatedEvent,
      onUpdated: tabUpdatedEvent,
      async query(): Promise<chrome.tabs.Tab[]> {
        return [
          {
            active: true,
            autoDiscardable: true,
            discarded: false,
            frozen: false,
            groupId: -1,
            highlighted: true,
            id: 1,
            incognito: false,
            index: 0,
            pinned: false,
            selected: true,
            title: mockPageContext.title,
            url: mockPageContext.url,
            windowId: 1,
          },
        ];
      },
      async sendMessage() {
        if (searchParams.get("snapshot") === "error") {
          return {
            error: "Debug mode could not read this tab.",
            ok: false,
          };
        }

        return {
          ok: true,
          pageContext: mockPageContext,
        };
      },
    },
  };

  globalThis.chrome = debugChrome as unknown as typeof chrome;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (
      (url === DEFAULT_AI_USAGE_ENDPOINT ||
        url.startsWith(`${DEFAULT_AI_USAGE_ENDPOINT}?`)) &&
      method === "GET"
    ) {
      return new Response(JSON.stringify(createMockAiUsageReport()), {
        headers: {
          "Content-Type": "application/json",
        },
        status: authSession ? 200 : 401,
      });
    }

    if (
      (url === DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT ||
        url.startsWith(`${DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT}?`)) &&
      method === "GET"
    ) {
      if (debugPreviewPdfUrl && authSession) {
        const injectedPdfBytes = window.__JOB_HELPER_DEBUG_PREVIEW_PDF_BYTES__;

        if (injectedPdfBytes) {
          return new Response(injectedPdfBytes.slice(0), {
            headers: {
              "Content-Type": "application/pdf",
            },
            status: 200,
          });
        }

        return nativeFetch(debugPreviewPdfUrl);
      }

      return new Response(mockPdfBytes, {
        headers: {
          "Content-Type": "application/pdf",
        },
        status: authSession ? 200 : 401,
      });
    }

    if (url === DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT && method === "GET") {
      return new Response(
        JSON.stringify({
          messages: authSession ? mockSupportChatMessages : [],
          pageTitle: "Resume support",
          url: "job-helper://resume-support-chat",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: authSession ? 200 : 401,
        },
      );
    }

    if (
      url === DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT &&
      method === "DELETE"
    ) {
      mockSupportChatMessages = [];

      return new Response(
        JSON.stringify({
          messages: [],
          pageTitle: "Resume support",
          url: "job-helper://resume-support-chat",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: authSession ? 200 : 401,
        },
      );
    }

    if (url === DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT && method === "POST") {
      if (!authSession) {
        return new Response(JSON.stringify({ error: "Sign in to use chat." }), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 401,
        });
      }

      const body = readRequestBody(init?.body);
      const message = readBodyString(body, "message");
      const debugChatDelayMs = Math.min(
        Math.max(Number(searchParams.get("chatDelayMs") ?? "0") || 0, 0),
        10_000,
      );
      const createdAt = new Date().toISOString();
      const userMessage: DebugChatMessage = {
        content: message,
        createdAt,
        id: `debug-chat-user-${String(Date.now())}`,
        model: null,
        role: "user",
        toolCalls: [],
      };
      const shouldCreateSkill = /\b(add|save|remember|create)\b/i.test(message);
      const skillName = /\brust\b/i.test(message)
        ? "Rust"
        : /\bkubernetes\b/i.test(message)
          ? "Kubernetes"
          : "";
      const toolCalls =
        shouldCreateSkill && skillName
          ? [
              {
                argumentsText: JSON.stringify(
                  {
                    listInSkillsOnly: true,
                    name: skillName,
                    reason: "Debug resume chat skill creation.",
                  },
                  null,
                  2,
                ),
                name: "create_skills_section_skill",
              },
            ]
          : [];

      if (skillName) {
        const normalizedName = skillName.toLowerCase();
        const updatedAt = new Date().toISOString();
        const existingSkill = mockSkillData.skills.find(
          (skill) => skill.normalizedName === normalizedName,
        );
        const nextSkill =
          existingSkill ??
          {
            id: `debug-skill-${normalizedName}`,
            listInSkillsOnly: true,
            name: skillName,
            normalizedName,
            updatedAt,
          };

        mockSkillData = {
          ...mockSkillData,
          skills: [
            ...mockSkillData.skills.filter(
              (skill) => skill.normalizedName !== normalizedName,
            ),
            {
              ...nextSkill,
              listInSkillsOnly: true,
              updatedAt,
            },
          ],
          updatedAt,
        };
      }

      if (debugChatDelayMs > 0) {
        await waitForDebugDelay(debugChatDelayMs);
      }

      const assistantMessage: DebugChatMessage = {
        content: skillName
          ? `Saved ${skillName} as skills-section support.`
          : "I can help save skills-section support or draft reusable resume bullets.",
        createdAt,
        id: `debug-chat-assistant-${String(Date.now())}`,
        model: "debug",
        role: "assistant",
        toolCalls,
      };

      mockSupportChatMessages = [
        ...mockSupportChatMessages,
        userMessage,
        assistantMessage,
      ];

      return createDebugNdjsonResponse([
        {
          message: userMessage,
          type: "user-message",
        },
        {
          message: assistantMessage,
          skillData: skillName ? mockSkillData : null,
          type: "done",
        },
      ]);
    }

    if (url === DEFAULT_TAILOR_RESUME_ENDPOINT && method === "GET") {
      return new Response(
        JSON.stringify({
          profile: {
            tailoredResumes: authSession ? mockTailoredResumes : [],
          },
          skillData: authSession ? mockSkillData : null,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: authSession ? 200 : 401,
        },
      );
    }

    if (url === DEFAULT_TAILOR_RESUME_ENDPOINT && method === "PATCH") {
      const body = readRequestBody(init?.body);
      const action = readBodyString(body, "action");

      if (action === "measureSpareBullet") {
        const quote = readBodyString(body, "quote");
        const lineCount =
          quote.length > 120 ? 3 : quote.length > 70 ? 2 : quote ? 1 : 0;
        const shouldRenderMalformed = /\bmalformed\b/i.test(quote);
        const lastLineFillRatio = lineCount > 1
          ? shouldRenderMalformed
            ? 0.32
            : 0.72
          : null;

        return new Response(
          JSON.stringify({
            spareBulletMeasurement: {
              lastLineFillRatio,
              lineCount,
              malformed:
                lineCount > 1 &&
                lastLineFillRatio !== null &&
                lastLineFillRatio < 0.5,
              pageCount: 1,
              targetSegmentId: "debug-spare-bullet-target",
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "saveSpareBullet") {
        const updatedAt = new Date().toISOString();
        const id =
          readBodyString(body, "id") ||
          `debug-spare-bullet-${String(Date.now())}`;
        const skillNames = readBodyStringArray(body, "skillNames")
          .map((skill) => skill.trim())
          .filter(Boolean);
        const skills = skillNames.map((skillName) => {
          const normalizedName = skillName.toLowerCase();
          const existingSkill = mockSkillData.skills.find(
            (skill) => skill.normalizedName === normalizedName,
          );

          return (
            existingSkill ?? {
              id: `debug-skill-${normalizedName.replace(/[^a-z0-9]+/g, "-")}`,
              listInSkillsOnly: false,
              name: skillName,
              normalizedName,
              updatedAt,
            }
          );
        });
        const nextSpareBullet = {
          createdAt:
            mockSkillData.spareBullets.find((bullet) => bullet.id === id)
              ?.createdAt ?? updatedAt,
          id,
          quote: readBodyString(body, "quote"),
          replacesQuote: readBodyString(body, "replacesQuote") || null,
          resumeExperienceId: readBodyString(body, "resumeExperienceId"),
          skillIds: skills.map((skill) => skill.id),
          skills,
          updatedAt,
        };

        mockSkillData = {
          ...mockSkillData,
          skills: [
            ...mockSkillData.skills.filter(
              (skill) =>
                !skills.some(
                  (nextSkill) => nextSkill.normalizedName === skill.normalizedName,
                ),
            ),
            ...skills,
          ],
          spareBullets: [
            nextSpareBullet,
            ...mockSkillData.spareBullets.filter((bullet) => bullet.id !== id),
          ],
          updatedAt,
        };

        return new Response(JSON.stringify({ skillData: mockSkillData }), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        });
      }

      if (action === "deleteSpareBullet") {
        const id = readBodyString(body, "id");
        const updatedAt = new Date().toISOString();

        mockSkillData = {
          ...mockSkillData,
          spareBullets: mockSkillData.spareBullets.filter(
            (bullet) => bullet.id !== id,
          ),
          updatedAt,
        };

        return new Response(JSON.stringify({ skillData: mockSkillData }), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        });
      }

      if (action === "deleteTailoredResumeArtifact") {
        const jobUrl = readBodyString(body, "jobUrl");
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");

        mockTailoredResumes = mockTailoredResumes.filter(
          (record) =>
            !shouldDeleteTailoredResume({
              jobUrl,
              tailoredResumeId,
            })(record),
        );
        await clearTailoringState();

        return new Response(
          JSON.stringify({
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeId: tailoredResumeId || null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "setTailoredResumeArchivedState") {
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");
        const archived = body.archived === true;
        const updatedAt = new Date().toISOString();

        mockTailoredResumes = mockTailoredResumes.map((record) =>
          record.id === tailoredResumeId
            ? {
                ...record,
                archivedAt: archived ? updatedAt : null,
                updatedAt,
              }
            : record,
        );

        return new Response(
          JSON.stringify({
            archived,
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeId: tailoredResumeId || null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "archiveAllTailoredResumes") {
        const updatedAt = new Date().toISOString();
        const archivedResumeIds = mockTailoredResumes
          .filter((record) => !record.archivedAt)
          .map((record) => record.id);
        const archivedResumeIdSet = new Set(archivedResumeIds);

        mockTailoredResumes = mockTailoredResumes.map((record) =>
          archivedResumeIdSet.has(record.id)
            ? {
                ...record,
                archivedAt: updatedAt,
                updatedAt,
              }
            : record,
        );

        return new Response(
          JSON.stringify({
            archived: true,
            archivedCount: archivedResumeIds.length,
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeIds: archivedResumeIds,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "deleteAllTailoredResumeArtifacts") {
        const requestedIds = Array.isArray(body.tailoredResumeIds)
          ? body.tailoredResumeIds
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter(Boolean)
          : [];
        const requestedIdSet = new Set(requestedIds);
        const deletedResumeIds =
          requestedIds.length > 0
            ? mockTailoredResumes
                .filter((record) => requestedIdSet.has(record.id))
                .map((record) => record.id)
            : mockTailoredResumes
                .filter((record) => !record.archivedAt)
                .map((record) => record.id);
        const deletedResumeIdSet = new Set(deletedResumeIds);

        mockTailoredResumes = mockTailoredResumes.filter(
          (record) => !deletedResumeIdSet.has(record.id),
        );

        return new Response(
          JSON.stringify({
            deletedCount: deletedResumeIds.length,
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeIds: deletedResumeIds,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (
        action === "createTailoredResumeUserEdit" ||
        action === "editExistingTailoredResumeUserEdit"
      ) {
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");
        const segmentId = readBodyString(body, "segmentId");
        const latexCode = readBodyString(body, "latexCode").replace(/\n+$/, "");
        const updatedAt = new Date().toISOString();

        mockTailoredResumes = mockTailoredResumes.map((record) => {
          if (record.id !== tailoredResumeId) {
            return record;
          }

          const existingEdit = record.edits.find(
            (edit) => edit.segmentId === segmentId,
          );
          const sourceSegment = readDebugAnnotatedSegments(
            record.sourceAnnotatedLatexCode ?? record.annotatedLatexCode,
          ).find((segment) => segment.segmentId === segmentId);

          if (!sourceSegment || (action === "createTailoredResumeUserEdit" && existingEdit)) {
            return record;
          }

          const nextEdit = existingEdit
            ? {
                ...existingEdit,
                afterLatexCode: latexCode,
                customLatexCode: null,
                state: "applied" as const,
              }
            : {
                afterLatexCode: latexCode,
                beforeLatexCode: sourceSegment.latexCode,
                command: null,
                customLatexCode: null,
                editId: `${segmentId}:user`,
                generatedByStep: 4 as const,
                reason: "User edit",
                source: "user" as const,
                segmentId,
                state: "applied" as const,
              };
          const nextEdits = existingEdit
            ? record.edits.map((edit) =>
                edit.editId === existingEdit.editId ? nextEdit : edit,
              )
            : [...record.edits, nextEdit];
          const annotatedLatexCode = rebuildDebugAnnotatedLatexCode({
            edits: nextEdits,
            sourceAnnotatedLatexCode:
              record.sourceAnnotatedLatexCode ?? record.annotatedLatexCode,
          });

          return {
            ...record,
            annotatedLatexCode,
            edits: nextEdits,
            pdfUpdatedAt: updatedAt,
            updatedAt,
          };
        });

        return new Response(
          JSON.stringify({
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeEditId: `${segmentId}:user`,
            tailoredResumeId: tailoredResumeId || null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "deleteTailoredResumeEdit") {
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");
        const editId = readBodyString(body, "editId");
        const updatedAt = new Date().toISOString();

        mockTailoredResumes = mockTailoredResumes.map((record) => {
          if (record.id !== tailoredResumeId) {
            return record;
          }

          const nextEdits = record.edits.filter((edit) => edit.editId !== editId);

          if (nextEdits.length === record.edits.length) {
            return record;
          }

          const annotatedLatexCode = rebuildDebugAnnotatedLatexCode({
            edits: nextEdits,
            sourceAnnotatedLatexCode:
              record.sourceAnnotatedLatexCode ?? record.annotatedLatexCode,
          });

          return {
            ...record,
            annotatedLatexCode,
            edits: nextEdits,
            pdfUpdatedAt: updatedAt,
            updatedAt,
          };
        });

        return new Response(
          JSON.stringify({
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeEditId: editId || null,
            tailoredResumeId: tailoredResumeId || null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "refineTailoredResume") {
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");
        const userPrompt = readBodyString(body, "userPrompt");
        const updatedAt = new Date().toISOString();
        let tailoredResumeDiff: {
          endVersionId: string;
          startVersionId: string;
        } | null = null;
        let assistantMessage =
          "I can talk through the changes without changing the resume yet.";
        const shouldLeaveUnchanged =
          /\b(header|name|henry|deutsch|test)\b/i.test(userPrompt) ||
          /\b(no change|talk through|question)\b/i.test(userPrompt);
        const debugRefinementDelayMs = Math.min(
          Math.max(Number(searchParams.get("chatDelayMs") ?? "0") || 0, 0),
          10_000,
        );

        if (shouldLeaveUnchanged) {
          assistantMessage =
            "The requested change is outside the current editable block set, so I left the tailored resume unchanged.";

          if (debugRefinementDelayMs > 0) {
            await waitForDebugDelay(debugRefinementDelayMs);
          }

          return createDebugNdjsonResponse([
            {
              event: {
                delta: "The requested change is outside ",
                field: "assistantMessage",
                kind: "text-delta",
              },
              type: "interview-stream",
            },
            {
              event: {
                delta: "the current editable block set, ",
                field: "assistantMessage",
                kind: "text-delta",
              },
              type: "interview-stream",
            },
            {
              event: {
                delta: "so I left the tailored resume unchanged.",
                field: "assistantMessage",
                kind: "text-delta",
              },
              type: "interview-stream",
            },
            {
              ok: true,
              payload: {
                assistantMessage,
                profile: {
                  tailoredResumes: mockTailoredResumes,
                  tailoringInterview: null,
                },
                tailoredResumeDiff: null,
                tailoredResumeId: tailoredResumeId || null,
              },
              status: 200,
              type: "done",
            },
          ]);
        }

        mockTailoredResumes = mockTailoredResumes.map((record) => {
          if (record.id !== tailoredResumeId) {
            return record;
          }

          const versions = Array.isArray(record.versions) ? record.versions : [];
          const lastVersion = versions[versions.length - 1];

          if (!lastVersion) {
            return record;
          }

          const nextVersionId = `debug-version-chat-${String(versions.length)}`;
          const nextInsertedSegmentId =
            "work-experience.entry-1.bullet-2.inserted-debug-chat";
          const nextAnnotatedLatexCode = [
            "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-1",
            "\\resumeItem{Shipped Kubernetes deployment automation for production services with PostgreSQL persistence, observability, and low-latency APIs.}",
            "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
            "\\resumeItem{Developed React interfaces for reviewing resume changes and PDF previews.}",
            "% JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2.inserted-debug",
            "\\resumeItem{Added a debug-mode timeline bullet to verify inserted segments keep downstream IDs stable.}",
            `% JOBHELPER_SEGMENT_ID: ${nextInsertedSegmentId}`,
            "\\resumeItem{Captured a chat-generated output so the inline assistant message can expose a See Diff action.}",
          ].join("\n");
          const nextEdits = [
            ...(Array.isArray(record.edits) ? record.edits : []),
            {
              afterLatexCode:
                "\\resumeItem{Captured a chat-generated output so the inline assistant message can expose a See Diff action.}",
              beforeLatexCode: "",
              command: null,
              customLatexCode: null,
              editId: "debug-edit-chat-see-diff",
              generatedByStep: 4 as const,
              reason: "Adds a chat-generated output for diff-mode verification.",
              segmentId: nextInsertedSegmentId,
              state: "applied" as const,
            },
          ];

          tailoredResumeDiff = {
            endVersionId: nextVersionId,
            startVersionId: lastVersion.id,
          };
          assistantMessage =
            "Applied the chat changes. Use See Diff to compare this output against the previous one.";

          return {
            ...record,
            annotatedLatexCode: nextAnnotatedLatexCode,
            edits: nextEdits,
            pdfUpdatedAt: updatedAt,
            updatedAt,
            versions: [
              ...versions,
              {
                annotatedLatexCode: nextAnnotatedLatexCode,
                assistantMessage,
                createdAt: updatedAt,
                edits: nextEdits,
                id: nextVersionId,
                latexCode: nextAnnotatedLatexCode,
                pdfUpdatedAt: updatedAt,
                source: "refinement" as const,
                userPrompt: userPrompt || "Debug chat refinement.",
              },
            ],
          };
        });

        if (debugRefinementDelayMs > 0) {
          await waitForDebugDelay(debugRefinementDelayMs);
        }

        return createDebugNdjsonResponse([
          {
            event: {
              delta: "Applied the chat changes. ",
              field: "assistantMessage",
              kind: "text-delta",
            },
            type: "interview-stream",
          },
          {
            event: {
              delta: "Use See Diff to compare this output ",
              field: "assistantMessage",
              kind: "text-delta",
            },
            type: "interview-stream",
          },
          {
            event: {
              delta: "against the previous one.",
              field: "assistantMessage",
              kind: "text-delta",
            },
            type: "interview-stream",
          },
          {
            ok: true,
            payload: {
            assistantMessage,
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeDiff,
            tailoredResumeId: tailoredResumeId || null,
            },
          },
        ]);
      }

      if (action === "deleteTailoredResumeVersion") {
        const tailoredResumeId = readBodyString(body, "tailoredResumeId");
        const versionId = readBodyString(body, "versionId");
        const updatedAt = new Date().toISOString();

        mockTailoredResumes = mockTailoredResumes.map((record) => {
          if (record.id !== tailoredResumeId) {
            return record;
          }

          const versions = Array.isArray(record.versions) ? record.versions : [];
          const deleteIndex = versions.findIndex(
            (version) => version.id === versionId,
          );

          if (deleteIndex <= 0) {
            return record;
          }

          const nextVersions = versions.slice(0, deleteIndex);
          const restoredVersion = nextVersions[nextVersions.length - 1];

          return {
            ...record,
            annotatedLatexCode:
              restoredVersion?.annotatedLatexCode ?? record.annotatedLatexCode,
            edits: Array.isArray(restoredVersion?.edits)
              ? restoredVersion.edits
              : record.edits,
            pdfUpdatedAt: updatedAt,
            updatedAt,
            versions: nextVersions,
          };
        });

        return new Response(
          JSON.stringify({
            deletedVersionId: versionId || null,
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
            tailoredResumeId: tailoredResumeId || null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (action === "cancelCurrentTailoring") {
        await clearTailoringState();

        return new Response(
          JSON.stringify({
            profile: {
              tailoredResumes: mockTailoredResumes,
              tailoringInterview: null,
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        );
      }
    }

    return nativeFetch(input, init);
  };
}
