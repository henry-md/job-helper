import {
  AUTH_SESSION_STORAGE_KEY,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
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
  variant: "default" | "step2-blocked" | "step5-error" | "step5-running" =
    "default",
) {
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

function createMockTailoredResumes() {
  return [
    {
      applicationId: null,
      archivedAt: null as string | null,
      companyName: "Microsoft",
      createdAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
      displayName: "Microsoft - Software Engineer",
      emphasizedTechnologies: [],
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
      positionTitle: "Software Engineer",
      status: "ready",
      updatedAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
    },
  ];
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
  let mockTailoredResumes = authSession ? createMockTailoredResumes() : [];
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
