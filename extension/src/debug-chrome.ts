import {
  AUTH_SESSION_STORAGE_KEY,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
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

function createMockTailoringRun(status: TailorResumeRunRecord["status"]) {
  return {
    capturedAt: new Date("2026-04-21T23:10:00.000Z").toISOString(),
    companyName: "Acme AI",
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    message:
      status === "success"
        ? "Tailored resume saved to Job Helper."
        : "Tailor Resume failed while generating the PDF.",
    pageTitle: mockPageContext.title,
    pageUrl: mockPageContext.url,
    positionTitle: "Senior Product Engineer",
    status,
    tailoredResumeError:
      status === "success" ? null : "Debug failure state for visual testing.",
    tailoredResumeId: status === "success" ? "debug-tailored-resume" : null,
  } satisfies TailorResumeRunRecord;
}

function createMockTailoredResumes() {
  return [
    {
      companyName: "Microsoft",
      displayName: "Microsoft - Software Engineer",
      id: "debug-tailored-resume",
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

  if (runState === "success" || runState === "error") {
    return createMockTailoringRun(runState);
  }

  return null;
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

  if (authSession) {
    storage.set(AUTH_SESSION_STORAGE_KEY, authSession);
  }

  const initialTailoringRun = readInitialTailoringRun(searchParams);

  if (initialTailoringRun) {
    storage.set(LAST_TAILORING_STORAGE_KEY, initialTailoringRun);
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
            records: authSession ? createMockTailoredResumes() : [],
          };
        }

        if (type === "JOB_HELPER_TRIGGER_CAPTURE") {
          window.setTimeout(() => {
            void storageArea.set({
              [LAST_TAILORING_STORAGE_KEY]: createMockTailoringRun("success"),
            });
          }, 500);

          return { ok: true };
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
            tailoredResumes: authSession ? createMockTailoredResumes() : [],
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

    return nativeFetch(input, init);
  };
}
