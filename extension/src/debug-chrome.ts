import {
  AUTH_SESSION_STORAGE_KEY,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  EXISTING_TAILORING_STORAGE_KEY,
  EXTENSION_PREFERENCES_STORAGE_KEY,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobPageContext,
  type TailorResumeRunRecord,
} from "./job-helper";

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

function createMockTailoringRun(
  status: TailorResumeRunRecord["status"],
  variant: "default" | "step4-error" | "step4-running" = "default",
) {
  const isStep4Error = variant === "step4-error";
  const isStep4Retry = isStep4Error || variant === "step4-running";

  return {
    capturedAt: new Date("2026-04-21T23:10:00.000Z").toISOString(),
    companyName: "Acme AI",
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    message:
      status === "success"
        ? "Tailored resume saved to Job Helper."
        : isStep4Retry
            ? "Stage 4/4: Keeping the tailored resume within the original page count - Retrying (attempt 2)"
        : status === "running"
          ? "Tailoring your resume for this job..."
          : "Tailor Resume failed while generating the PDF.",
    generationStep: isStep4Retry
      ? {
          attempt: 2,
          detail:
            "The model did not submit verified compaction candidates after 4 Step 4 tool rounds.",
          retrying: true,
          status: "running",
          stepCount: 4,
          stepNumber: 4,
          summary: "Keeping the tailored resume within the original page count",
        }
      : null,
    jobIdentifier: null,
    pageTitle: mockPageContext.title,
    pageUrl: mockPageContext.url,
    positionTitle: "Senior Product Engineer",
    status,
    tailoredResumeError:
      status === "error"
        ? isStep4Error
          ? "The model did not submit verified compaction candidates after 4 Step 4 tool rounds."
          : "Debug failure state for visual testing."
        : null,
    tailoredResumeId: status === "success" ? "debug-tailored-resume" : null,
  } satisfies TailorResumeRunRecord;
}

function createMockTailoredResumes() {
  return [
    {
      companyName: "Microsoft",
      displayName: "Microsoft - Software Engineer",
      id: "debug-tailored-resume",
      jobIdentifier: null,
      jobUrl: "https://careers.microsoft.com/jobs/debug-tailored-resume",
      positionTitle: "Software Engineer",
      status: "ready",
      updatedAt: new Date("2026-04-21T23:17:00.000Z").toISOString(),
    },
  ];
}

function readInitialAuthSession(searchParams: URLSearchParams) {
  return searchParams.get("auth") === "signed-in" ? mockSession : null;
}

function readInitialTailoringRun(searchParams: URLSearchParams) {
  const runState = searchParams.get("run");

  if (runState === "running" || runState === "success" || runState === "error") {
    return createMockTailoringRun(runState);
  }

  if (runState === "step4-running") {
    return createMockTailoringRun("running", "step4-running");
  }

  if (runState === "step4-error") {
    return createMockTailoringRun("error", "step4-error");
  }

  return null;
}

function readInitialExtensionPreferences(searchParams: URLSearchParams) {
  return {
    compactTailorRun:
      searchParams.get("compact") === "1" ||
      searchParams.get("compact") === "true" ||
      searchParams.get("compact") === "on",
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

  if (initialExtensionPreferences.compactTailorRun) {
    storage.set(
      EXTENSION_PREFERENCES_STORAGE_KEY,
      initialExtensionPreferences,
    );
  }

  function buildMockPersonalInfo() {
    const activeTailorings =
      mockTailoringRun?.status === "running"
        ? [
            {
              companyName: mockTailoringRun.companyName,
              createdAt: mockTailoringRun.capturedAt,
              id: "debug-active-tailoring",
              jobDescription: mockPageContext.description,
              jobIdentifier: mockTailoringRun.jobIdentifier,
              jobUrl: mockTailoringRun.pageUrl,
              kind: "active_generation" as const,
              lastStep: mockTailoringRun.generationStep ?? null,
              positionTitle: mockTailoringRun.positionTitle,
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
      originalResume: {
        error: null,
        filename: "Henry Deutsch Resume.pdf",
        latexStatus: "ready",
        pdfUpdatedAt: new Date("2026-04-21T22:45:00.000Z").toISOString(),
        resumeUpdatedAt: new Date("2026-04-21T22:45:00.000Z").toISOString(),
      },
      tailoredResumes: mockTailoredResumes,
      tailoringInterview: null,
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
          mockTailoringRun = createMockTailoringRun("running", "step4-running");
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

    if (url === DEFAULT_TAILOR_RESUME_ENDPOINT && method === "GET") {
      return new Response(
        JSON.stringify({
          profile: {
            tailoredResumes: authSession ? mockTailoredResumes : [],
          },
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
