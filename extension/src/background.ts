import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailorResumePreparationMessage,
  buildTailorResumePreparationState,
  buildJobDescriptionFromPageContext,
  buildTailorResumeApplicationContext,
  CAPTURE_COMMAND_NAME,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_SYNC_STATE_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  EXISTING_TAILORING_STORAGE_KEY,
  EXTENSION_AUTH_GOOGLE_ENDPOINT,
  EXTENSION_AUTH_SESSION_ENDPOINT,
  EXTENSION_BROWSER_SESSION_ENDPOINT,
  isJobHelperAppUrl,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_PREPARATIONS_STORAGE_KEY,
  TAILORING_PROMPTS_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  readPersonalInfoPayload,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeExistingTailoringState,
  readTailorResumeExistingTailoringStates,
  readTailoredResumeEmphasizedTechnologies,
  type TailoredResumeEmphasizedTechnology,
  type TailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepTiming,
  type PersonalInfoSummary,
  readTailorResumeProfileSummary,
  type TailorResumeRunRecord,
} from "./job-helper";
import {
  haveUserSyncStateChanged,
  readUserSyncStateSnapshot,
} from "../../lib/sync-state.ts";
import {
  buildCompanyResumeDownloadName,
  sanitizeResumeDownloadFilenameBase,
} from "../../lib/tailored-resume-download-filename.ts";
import {
  PAGE_CONTEXT_UNAVAILABLE_MESSAGE,
  collectPageContextFromTab,
  formatPageContextErrorMessage,
  isPageContextConnectionError,
} from "./page-context";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
} from "./tailor-resume-stream";
import { findMatchingCurrentWindowTabForUrl } from "./browser-tab-targeting";
import { buildCompletedTailoringMessage } from "./tailor-run-copy";
import {
  buildPersonalInfoCacheEntry,
  invalidateChangedPersonalInfoSlices,
  PERSONAL_INFO_CACHE_STORAGE_KEY,
  readPersonalInfoCacheEntry,
} from "./personal-info-cache";
import {
  resolvePotentialTailorOverwrite,
  resolvePotentialTailorOverwriteFromPersonalInfo,
  resolveActiveTailoringForPage,
  matchesTailorOverwritePageIdentity,
} from "./tailor-overwrite-guard";
import { resolveTailoredResumeTabBadge } from "./tailored-resume-tab-badge";
import {
  deriveKeywordBadgeDismissalKey,
  KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
} from "./keyword-badge-dismissal";
import {
  buildTailorRunRegistryKey,
  readTailorRunRegistryKeyFromPageContext,
  readTailorRunRegistryKeyFromTab,
} from "./tailor-run-registry";
import {
  readStoredTailoringRunRecord,
  resolveActiveTailorRunKeywordBadge,
} from "./tailor-run-keywords";
import {
  buildTailorResumeLiveStatusMessage as buildLiveTailorResumeStatusMessage,
} from "../../lib/tailor-resume-step-display.ts";
import { mergeTailorResumeGenerationStepTiming } from "./tailor-run-step-timing";
import {
  normalizeTailoredResumeBadgeTargetUrls,
  tailoredResumeBadgeTargetMatchesTabUrl,
} from "./tailored-resume-badge-targets";

type OverlayTone = "error" | "info" | "success" | "warning";

type TailorResumeSummary = {
  applicationId: string | null;
  companyName: string | null;
  id: string | null;
  jobIdentifier: string | null;
  positionTitle: string | null;
  status: string | null;
};

type RuntimeMessage = {
  payload?: unknown;
  type?: string;
};

type AuthStatus =
  | { session: JobHelperAuthSession; status: "signedIn" }
  | { status: "signedOut" };

class JobHelperSignInError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type TailorRunStorageRegistry<T> = Record<string, T>;

const activeTailorResumeAbortControllers = new Map<
  string,
  AbortController
>();
let personalInfoCacheRefreshPromise: Promise<{
  personalInfo: ReturnType<typeof readPersonalInfoPayload>;
}> | null = null;
const PERSONAL_INFO_REQUEST_TIMEOUT_MS = 8_000;
const SYNC_STATE_REQUEST_TIMEOUT_MS = 4_000;
const TAILORED_RESUME_BADGE_CHECK_DEBOUNCE_MS = 250;
let tailoredResumeBadgeCheckSequence = 0;
const scheduledTailoredResumeBadgeChecks = new Map<
  number,
  ReturnType<typeof globalThis.setTimeout>
>();
const latestTailoredResumeBadgeCheckByTabId = new Map<number, number>();

type TailoredResumeBadgeCheckOptions = {
  forceFreshPersonalInfo?: boolean;
};

type ActiveTailorRunKeywordBadgeSnapshot = {
  capturedAt: string;
  companyName: string | null;
  jobUrl: string | null;
  pageKey: string;
  positionTitle: string | null;
  technologies: TailoredResumeEmphasizedTechnology[];
};

const activeTailorRunKeywordBadgesByPageKey = new Map<
  string,
  ActiveTailorRunKeywordBadgeSnapshot
>();

async function configureSidePanelAction() {
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  } catch (error) {
    console.error("Failed to configure the Job Helper side panel.", error);
  }
}

function injectOverlayIntoPage(text: string, tone: OverlayTone) {
  const existingOverlay = document.getElementById("job-helper-command-banner");
  const overlay =
    existingOverlay instanceof HTMLDivElement
      ? existingOverlay
      : document.createElement("div");

  overlay.id = "job-helper-command-banner";
  overlay.setAttribute("aria-live", "polite");
  overlay.textContent = text;
  overlay.style.position = "fixed";
  overlay.style.top = "50%";
  overlay.style.left = "50%";
  overlay.style.transform = "translate(-50%, -50%)";
  overlay.style.maxWidth = "min(80vw, 720px)";
  overlay.style.padding = "18px 26px";
  overlay.style.borderRadius = "999px";
  overlay.style.fontFamily =
    '"IBM Plex Sans","Avenir Next","Segoe UI",sans-serif';
  overlay.style.fontSize = "18px";
  overlay.style.fontWeight = "700";
  overlay.style.letterSpacing = "0.01em";
  overlay.style.color = "#ffffff";
  overlay.style.boxShadow = "0 18px 60px rgba(0, 0, 0, 0.28)";
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.opacity = "1";
  overlay.style.transition = "opacity 120ms ease";
  overlay.style.background =
    tone === "success"
      ? "rgba(15, 118, 110, 0.92)"
      : tone === "warning"
        ? "rgba(180, 83, 9, 0.94)"
      : tone === "error"
        ? "rgba(185, 28, 28, 0.94)"
        : "rgba(17, 24, 39, 0.9)";

  if (!existingOverlay) {
    document.documentElement.appendChild(overlay);
  }

  const previousTimeoutId = Number(overlay.dataset.jobHelperTimeoutId || "0");

  if (previousTimeoutId) {
    window.clearTimeout(previousTimeoutId);
  }

  const timeoutId = window.setTimeout(() => {
    overlay.style.opacity = "0";
    overlay.dataset.jobHelperTimeoutId = "";
  }, 1_750);

  overlay.dataset.jobHelperTimeoutId = String(timeoutId);
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function readLatestTailoredResume(payload: Record<string, unknown>) {
  const tailoredResumeId = readPayloadString(payload, "tailoredResumeId");
  const tailoredResumes = readTailoredResumeSummaries(payload);
  const tailoredResume = tailoredResumeId
    ? tailoredResumes.find((record) => record.id === tailoredResumeId)
    : tailoredResumes[0];

  if (!tailoredResume) {
    return null;
  }

  return {
    applicationId: tailoredResume.applicationId,
    companyName: tailoredResume.companyName,
    id: tailoredResume.id,
    jobIdentifier: tailoredResume.jobIdentifier,
    positionTitle: tailoredResume.positionTitle,
    status: tailoredResume.status,
  } satisfies TailorResumeSummary;
}

function buildSuccessMessage(record: TailorResumeRunRecord) {
  const positionTitle = record.positionTitle?.trim();
  const companyName = record.companyName?.trim();
  const jobLabel =
    positionTitle && companyName
      ? `${positionTitle} at ${companyName}`
      : positionTitle || companyName || "this role";

  return buildCompletedTailoringMessage({
    jobLabel,
    tailoredResumeError: record.tailoredResumeError,
  });
}

function buildRunningTailoringRunRecord(input: {
  applicationId?: string | null;
  capturedAt: string;
  message?: string;
  pageContext?: JobPageContext | null;
  step?: TailorResumeGenerationStepSummary | null;
  stepTimings?: TailorResumeGenerationStepTiming[];
  suppressedTailoredResumeId?: string | null;
  tab: chrome.tabs.Tab | null;
}) {
  const pageApplicationContext = input.pageContext
    ? buildTailorResumeApplicationContext(input.pageContext)
    : null;

  return {
    applicationId: input.applicationId?.trim() || null,
    capturedAt: input.capturedAt,
    companyName: pageApplicationContext?.companyName ?? null,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: input.step ?? null,
    generationStepTimings: input.stepTimings ?? [],
    jobIdentifier: null,
    message:
      input.message ?? buildLiveTailorResumeStatusMessage(input.step ?? null),
    pageTitle: input.pageContext?.title || cleanText(input.tab?.title) || null,
    pageUrl: input.pageContext?.url || cleanText(input.tab?.url) || null,
    positionTitle: pageApplicationContext?.jobTitle ?? null,
    status: "running",
    suppressedTailoredResumeId: input.suppressedTailoredResumeId?.trim() || null,
    tailoredResumeError: null,
    tailoredResumeId: null,
  } satisfies TailorResumeRunRecord;
}

function buildFailedTailoringRunRecord(input: {
  capturedAt: string;
  message: string;
  pageContext?: JobPageContext | null;
  step?: TailorResumeGenerationStepSummary | null;
  stepTimings?: TailorResumeGenerationStepTiming[];
  tab: chrome.tabs.Tab | null;
}) {
  const pageApplicationContext = input.pageContext
    ? buildTailorResumeApplicationContext(input.pageContext)
    : null;

  return {
    applicationId: null,
    capturedAt: input.capturedAt,
    companyName: pageApplicationContext?.companyName ?? null,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: input.step ?? null,
    generationStepTimings: input.stepTimings ?? [],
    jobIdentifier: null,
    message: input.message,
    pageTitle: input.pageContext?.title || cleanText(input.tab?.title) || null,
    pageUrl: input.pageContext?.url || cleanText(input.tab?.url) || null,
    positionTitle: pageApplicationContext?.jobTitle ?? null,
    status: "error",
    suppressedTailoredResumeId: null,
    tailoredResumeError: input.message,
    tailoredResumeId: null,
  } satisfies TailorResumeRunRecord;
}

function buildExistingTailoringMessage(
  existingTailoring: ReturnType<typeof readTailorResumeExistingTailoringState>,
) {
  if (!existingTailoring) {
    return null;
  }

  if (existingTailoring.kind === "completed") {
    return `Already tailored ${existingTailoring.displayName}. Confirm overwrite in the side panel if you want to replace it.`;
  }

  if (existingTailoring.kind === "pending_interview") {
    const roleLabel =
      existingTailoring.positionTitle || existingTailoring.companyName || "this role";
    return `A Tailor Resume run for ${roleLabel} is waiting on Step 2 questions. Confirm overwrite in the side panel if you want to replace it.`;
  }

  const stageLabel = existingTailoring.lastStep
    ? `step ${existingTailoring.lastStep.stepNumber}/${existingTailoring.lastStep.stepCount}: ${existingTailoring.lastStep.summary}`
    : "the first tailoring step";

  return `A Tailor Resume run is already loading at ${stageLabel}. Confirm overwrite in the side panel if you want to replace it.`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab was found.");
  }

  return tab;
}

async function showOverlay(tabId: number, text: string, tone: OverlayTone) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "JOB_HELPER_SHOW_OVERLAY",
      payload: {
        text,
        tone,
      },
    });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectOverlayIntoPage,
        args: [text, tone],
      });
    } catch {
      // Some pages like chrome:// do not allow script injection.
    }
  }
}

async function sendTailoredResumeBadgeMessage(
  tabId: number,
  message:
    | {
        payload: {
          badgeKey: string;
          companyName: string | null;
          displayName: string;
          downloadName: string;
          emphasizedTechnologies: {
            evidence: string;
            name: string;
            priority: "high" | "low";
          }[];
          includeLowPriorityTermsInKeywordCoverage: boolean;
          jobUrl: string | null;
          keywordCoverage: unknown;
          nonTechnologyNames?: string[];
          tailoredResumeId: string;
        };
        type: "JOB_HELPER_SHOW_TAILORED_RESUME_BADGE";
      }
    | { type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE" },
) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Some pages do not allow content scripts or have not finished injecting.
  }
}

async function hideTailoredResumeBadgesForMatchingTabs(input: {
  fallbackTab?: chrome.tabs.Tab | null;
  targetUrls: Array<string | null | undefined>;
}) {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls(input.targetUrls);
  const hideTabBadge = (tabId: number) =>
    sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });

  if (targetUrls.length === 0) {
    const fallbackTab = input.fallbackTab ?? (await getActiveTab().catch(() => null));

    if (typeof fallbackTab?.id === "number") {
      await hideTabBadge(fallbackTab.id);
    }

    return;
  }

  const tabs = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*"],
  });

  await Promise.all(
    tabs.map(async (tab) => {
      const tabId = tab.id;

      if (typeof tabId !== "number") {
        return;
      }

      const tabUrl = cleanText(tab.url) || cleanText(tab.pendingUrl);

      if (
        !tailoredResumeBadgeTargetMatchesTabUrl({
          tabUrl,
          targetUrls,
        })
      ) {
        return;
      }

      await hideTabBadge(tabId);
    }),
  );
}

async function sendEmphasizedTechnologiesBadgeMessage(
  tabId: number,
  message: {
    payload: {
      badgeKey: string;
      displayName: string;
      emphasizedTechnologies: NonNullable<
        TailorResumeGenerationStepSummary["emphasizedTechnologies"]
      >;
      includeLowPriorityTermsInKeywordCoverage: boolean;
      jobUrl: string | null;
      keywordCoverage: null;
      nonTechnologyNames?: string[];
    };
    type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE";
  },
) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {
    // Some pages do not allow content scripts or have not finished injecting.
  }

  try {
    await chrome.scripting.executeScript({
      files: ["src/content.ts-loader.js"],
      target: { tabId },
    });
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Some pages do not allow content scripts or have not finished injecting.
  }
}

function readExistingTailoringEmphasizedTechnologies(
  activeTailoring: PersonalInfoSummary["activeTailorings"][number] | null,
) {
  if (!activeTailoring || activeTailoring.kind === "completed") {
    return [];
  }

  return activeTailoring.kind === "pending_interview"
    ? activeTailoring.emphasizedTechnologies
    : activeTailoring.lastStep?.emphasizedTechnologies ?? [];
}

function readStepEventEmphasizedTechnologies(
  stepEvent: TailorResumeGenerationStepSummary,
) {
  return (
    stepEvent.emphasizedTechnologies?.filter((technology) =>
      Boolean(technology.name.trim()),
    ) ?? []
  );
}

function isScrapedKeywordStepEvent(stepEvent: TailorResumeGenerationStepSummary) {
  return stepEvent.stepNumber === 1;
}

function buildStepOneKeywordBadgeDisplayName(input: {
  companyName: string | null;
  positionTitle: string | null;
}) {
  if (input.positionTitle && input.companyName) {
    return `${input.positionTitle} at ${input.companyName}`;
  }

  return input.positionTitle || input.companyName || "Tailor Resume keywords";
}

function rememberActiveTailorRunKeywordBadge(input: {
  capturedAt: string;
  pageContext: JobPageContext;
  pageKey: string;
  stepEvent: TailorResumeGenerationStepSummary;
}) {
  if (!isScrapedKeywordStepEvent(input.stepEvent)) {
    return;
  }

  const technologies = readStepEventEmphasizedTechnologies(input.stepEvent);

  if (technologies.length === 0) {
    return;
  }

  const pageApplicationContext = buildTailorResumeApplicationContext(
    input.pageContext,
  );

  activeTailorRunKeywordBadgesByPageKey.set(input.pageKey, {
    capturedAt: input.capturedAt,
    companyName: pageApplicationContext.companyName,
    jobUrl: readJobUrlFromPageContext(input.pageContext),
    pageKey: input.pageKey,
    positionTitle: pageApplicationContext.jobTitle,
    technologies,
  });
}

function resolveRememberedActiveTailorRunKeywordBadge(input: {
  pageIdentity: Awaited<ReturnType<typeof readTailoredResumeBadgePageIdentity>>;
}) {
  return (
    [...activeTailorRunKeywordBadgesByPageKey.values()]
      .filter((snapshot) =>
        matchesTailorOverwritePageIdentity({
          jobUrl: snapshot.jobUrl,
          pageIdentity: input.pageIdentity,
        }),
      )
      .sort(
        (left, right) =>
          Date.parse(right.capturedAt || "") - Date.parse(left.capturedAt || ""),
      )[0] ?? null
  );
}

async function showStepOneKeywordBadge(input: {
  pageContext: JobPageContext;
  pageKey: string;
  stepEvent: TailorResumeGenerationStepSummary;
  tabId: number;
}) {
  if (!isScrapedKeywordStepEvent(input.stepEvent)) {
    return;
  }

  const emphasizedTechnologies = readStepEventEmphasizedTechnologies(
    input.stepEvent,
  );

  if (emphasizedTechnologies.length === 0) {
    return;
  }

  const pageApplicationContext = buildTailorResumeApplicationContext(
    input.pageContext,
  );

  await sendEmphasizedTechnologiesBadgeMessage(input.tabId, {
    payload: {
      badgeKey: `tailor-run-keywords:${input.pageKey}`,
      displayName: buildStepOneKeywordBadgeDisplayName({
        companyName: pageApplicationContext.companyName,
        positionTitle: pageApplicationContext.jobTitle,
      }),
      emphasizedTechnologies,
      includeLowPriorityTermsInKeywordCoverage: false,
      jobUrl: readJobUrlFromPageContext(input.pageContext),
      keywordCoverage: null,
    },
    type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
  });
}

async function showActiveTailoringKeywordBadgeForTab(input: {
  pageIdentity: Awaited<ReturnType<typeof readTailoredResumeBadgePageIdentity>>;
  personalInfo: PersonalInfoSummary;
  tabId: number;
}) {
  const activeTailoring = resolveActiveTailoringForPage({
    activeTailorings: input.personalInfo.activeTailorings,
    pageIdentity: input.pageIdentity,
  });

  const emphasizedTechnologies =
    readExistingTailoringEmphasizedTechnologies(activeTailoring).filter(
      (technology) => Boolean(technology.name.trim()),
    );

  if (!activeTailoring || emphasizedTechnologies.length === 0) {
    return false;
  }

  await sendEmphasizedTechnologiesBadgeMessage(input.tabId, {
    payload: {
      badgeKey: `tailor-run-keywords:${
        buildTailorRunRegistryKey(activeTailoring.jobUrl) ?? activeTailoring.id
      }`,
      displayName: buildStepOneKeywordBadgeDisplayName({
        companyName: activeTailoring.companyName,
        positionTitle: activeTailoring.positionTitle,
      }),
      emphasizedTechnologies,
      includeLowPriorityTermsInKeywordCoverage: false,
      jobUrl: activeTailoring.jobUrl,
      keywordCoverage: null,
      nonTechnologyNames: input.personalInfo.userMarkdown.nonTechnologies,
    },
    type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
  });

  return true;
}

async function showLocalActiveTailorRunKeywordBadgeForTab(input: {
  nonTechnologyNames?: string[];
  pageIdentity: Awaited<ReturnType<typeof readTailoredResumeBadgePageIdentity>>;
  tabId: number;
}) {
  const rememberedBadge = resolveRememberedActiveTailorRunKeywordBadge({
    pageIdentity: input.pageIdentity,
  });

  if (rememberedBadge) {
    await sendEmphasizedTechnologiesBadgeMessage(input.tabId, {
      payload: {
        badgeKey: `tailor-run-keywords:${rememberedBadge.pageKey}`,
        displayName: buildStepOneKeywordBadgeDisplayName({
          companyName: rememberedBadge.companyName,
          positionTitle: rememberedBadge.positionTitle,
        }),
        emphasizedTechnologies: rememberedBadge.technologies,
        includeLowPriorityTermsInKeywordCoverage: false,
        jobUrl: rememberedBadge.jobUrl,
        keywordCoverage: null,
        nonTechnologyNames: input.nonTechnologyNames,
      },
      type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
    });

    return {
      matchedActiveRun: true,
      showed: true,
    };
  }

  const registry = await readStorageRegistry(TAILORING_RUNS_STORAGE_KEY);
  const runs = Object.values(registry)
    .map(readStoredTailoringRunRecord)
    .filter((run): run is TailorResumeRunRecord => Boolean(run));
  const resolution = resolveActiveTailorRunKeywordBadge({
    pageIdentity: input.pageIdentity,
    runs,
  });

  if (!resolution) {
    return {
      matchedActiveRun: false,
      showed: false,
    };
  }

  if (resolution.technologies.length === 0) {
    return {
      matchedActiveRun: true,
      showed: false,
    };
  }

  await sendEmphasizedTechnologiesBadgeMessage(input.tabId, {
    payload: {
      badgeKey: `tailor-run-keywords:${
        buildTailorRunRegistryKey(resolution.run.pageUrl) ??
        resolution.run.pageUrl ??
        resolution.run.capturedAt
      }`,
      displayName: buildStepOneKeywordBadgeDisplayName({
        companyName: resolution.run.companyName,
        positionTitle: resolution.run.positionTitle,
      }),
      emphasizedTechnologies: resolution.technologies,
      includeLowPriorityTermsInKeywordCoverage: false,
      jobUrl: resolution.run.pageUrl,
      keywordCoverage: null,
      nonTechnologyNames: input.nonTechnologyNames,
    },
    type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
  });

  return {
    matchedActiveRun: true,
    showed: true,
  };
}

async function showActiveTailoringKeywordBadgeForCurrentTab(
  personalInfo: PersonalInfoSummary,
) {
  const activeTab = await getActiveTab().catch(() => null);
  const tabId = activeTab?.id;

  if (!activeTab || typeof tabId !== "number") {
    return;
  }

  const tabUrl = cleanText(activeTab.url) || cleanText(activeTab.pendingUrl);

  if (!isHttpTabUrl(tabUrl) || isJobHelperAppUrl(tabUrl)) {
    return;
  }

  const pageIdentity = await readTailoredResumeBadgePageIdentity(activeTab);

  if (
    isJobHelperAppUrl(pageIdentity.pageUrl) ||
    isJobHelperAppUrl(pageIdentity.jobUrl) ||
    isJobHelperAppUrl(pageIdentity.canonicalUrl)
  ) {
    return;
  }

  await showActiveTailoringKeywordBadgeForTab({
    pageIdentity,
    personalInfo,
    tabId,
  });
}

async function showActiveTailoringKeywordBadgesForMatchingTabs(
  personalInfo: PersonalInfoSummary,
) {
  const activeTailoringsWithKeywords = personalInfo.activeTailorings.filter(
    (activeTailoring) =>
      activeTailoring.kind !== "completed" &&
      readExistingTailoringEmphasizedTechnologies(activeTailoring).some(
        (technology) => Boolean(technology.name.trim()),
      ),
  );

  if (activeTailoringsWithKeywords.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*"],
  });

  await Promise.all(
    tabs.map(async (tab) => {
      const tabId = tab.id;

      if (typeof tabId !== "number") {
        return;
      }

      const tabUrl = cleanText(tab.url) || cleanText(tab.pendingUrl);
      const tabComparableUrl = normalizeComparableUrl(tabUrl);

      if (!tabComparableUrl || isJobHelperAppUrl(tabUrl)) {
        return;
      }

      const matchingTailoring = activeTailoringsWithKeywords.find(
        (activeTailoring) =>
          normalizeComparableUrl(activeTailoring.jobUrl) === tabComparableUrl,
      );

      if (!matchingTailoring) {
        return;
      }

      await showActiveTailoringKeywordBadgeForTab({
        pageIdentity: {
          canonicalUrl: tabUrl,
          jobUrl: tabUrl,
          pageUrl: tabUrl,
        },
        personalInfo: {
          ...personalInfo,
          activeTailorings: [matchingTailoring],
        },
        tabId,
      });
    }),
  );
}

async function revealDismissedKeywordBadge(input: {
  badgeKey?: string | null;
  displayName?: string | null;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  includeLowPriorityTermsInKeywordCoverage?: boolean;
  jobUrl: string | null;
  keywordCoverage?: unknown;
  nonTechnologyNames?: string[];
  tailoredResumeId: string | null;
}) {
  let resolvedJobUrl = input.jobUrl;
  let resolvedPersonalInfo: PersonalInfoSummary | null = null;

  if (!resolvedJobUrl && input.tailoredResumeId) {
    try {
      const { personalInfo } = await getPersonalInfoSummary();
      resolvedPersonalInfo = personalInfo;
      const matchingResume = personalInfo.tailoredResumes.find(
        (resume) => resume.id === input.tailoredResumeId,
      );
      resolvedJobUrl = matchingResume?.jobUrl ?? null;
    } catch {
      // If personal info fails to load, fall through and try with whatever we have.
    }
  }

  const dismissalKey = deriveKeywordBadgeDismissalKey({
    badgeKey: input.badgeKey,
    jobUrl: resolvedJobUrl,
    tailoredResumeId: input.tailoredResumeId,
  });

  if (dismissalKey) {
    try {
      const current = await chrome.storage.local.get(
        KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
      );
      const existing =
        (current?.[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY] as
          | Record<string, boolean>
          | undefined) ?? {};

      if (existing[dismissalKey]) {
        const rest = { ...existing };
        delete rest[dismissalKey];
        await chrome.storage.local.set({
          [KEYWORD_BADGE_DISMISSAL_STORAGE_KEY]: rest,
        });
      }
    } catch {
      // If storage fails the in-page listener cannot react; fall through to refresh tabs.
    }
  }

  const normalizedTargetUrl = normalizeComparableUrl(resolvedJobUrl);
  if (!normalizedTargetUrl) {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({
      url: ["http://*/*", "https://*/*"],
    });
    const emphasizedTechnologies =
      input.emphasizedTechnologies?.filter((technology) =>
        Boolean(technology.name.trim()),
      ) ?? [];
    const nonTechnologyNames =
      input.nonTechnologyNames && input.nonTechnologyNames.length > 0
        ? input.nonTechnologyNames
        : resolvedPersonalInfo?.userMarkdown.nonTechnologies ?? [];

    await Promise.all(
      tabs.map(async (tab) => {
        const tabUrl = cleanText(tab.url) || cleanText(tab.pendingUrl);
        if (!tabUrl) {
          return;
        }

        if (normalizeComparableUrl(tabUrl) !== normalizedTargetUrl) {
          return;
        }

        if (typeof tab.id === "number" && emphasizedTechnologies.length > 0) {
          await sendEmphasizedTechnologiesBadgeMessage(tab.id, {
            payload: {
              badgeKey:
                input.badgeKey?.trim() ||
                `tailor-run-keywords:${normalizedTargetUrl}`,
              displayName:
                input.displayName?.trim() || "Tailor Resume keywords",
              emphasizedTechnologies,
              includeLowPriorityTermsInKeywordCoverage:
                input.includeLowPriorityTermsInKeywordCoverage === true,
              jobUrl: resolvedJobUrl,
              keywordCoverage: null,
              nonTechnologyNames,
            },
            type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
          });
          return;
        }

        scheduleTailoredResumeBadgeCheck(tab);
      }),
    );
  } catch {
    // No tabs to refresh is fine — the storage listener will cover any open tabs.
  }
}

async function refreshKeywordBadgeForMatchingTabs(input: {
  badgeKey?: string | null;
  displayName?: string | null;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnology[];
  includeLowPriorityTermsInKeywordCoverage?: boolean;
  jobUrl: string | null;
  nonTechnologyNames?: string[];
}) {
  const normalizedTargetUrl = normalizeComparableUrl(input.jobUrl);

  if (!normalizedTargetUrl) {
    return;
  }

  const emphasizedTechnologies =
    input.emphasizedTechnologies?.filter((technology) =>
      Boolean(technology.name.trim()),
    ) ?? [];

  if (emphasizedTechnologies.length === 0) {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({
      url: ["http://*/*", "https://*/*"],
    });

    await Promise.all(
      tabs.map(async (tab) => {
        const tabUrl = cleanText(tab.url) || cleanText(tab.pendingUrl);

        if (!tabUrl || normalizeComparableUrl(tabUrl) !== normalizedTargetUrl) {
          return;
        }

        if (typeof tab.id !== "number") {
          return;
        }

        await sendEmphasizedTechnologiesBadgeMessage(tab.id, {
          payload: {
            badgeKey:
              input.badgeKey?.trim() ||
              `tailor-run-keywords:${normalizedTargetUrl}`,
            displayName: input.displayName?.trim() || "Tailor Resume keywords",
            emphasizedTechnologies,
            includeLowPriorityTermsInKeywordCoverage:
              input.includeLowPriorityTermsInKeywordCoverage === true,
            jobUrl: input.jobUrl,
            keywordCoverage: null,
            nonTechnologyNames: input.nonTechnologyNames ?? [],
          },
          type: "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE",
        });
      }),
    );
  } catch {
    // Refreshing a visible in-page keyword badge is best-effort.
  }
}

function isHttpTabUrl(value: string | null | undefined) {
  const trimmedValue = cleanText(value);

  if (!trimmedValue) {
    return false;
  }

  try {
    const url = new URL(trimmedValue);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readTailoredResumeBadgePageIdentity(tab: chrome.tabs.Tab) {
  const tabUrl = cleanText(tab.url) || cleanText(tab.pendingUrl) || null;
  const tabId = tab.id;

  if (typeof tabId === "number" && tab.status === "complete") {
    try {
      const pageContext = await collectPageContext(tabId);
      const jobUrl = readJobUrlFromPageContext(pageContext);

      return {
        canonicalUrl: cleanText(pageContext.canonicalUrl) || null,
        jobUrl,
        pageUrl: cleanText(pageContext.url) || tabUrl,
      };
    } catch {
      // Fall back to Chrome's tab URL; URL matching still handles most job pages.
    }
  }

  return {
    canonicalUrl: null,
    jobUrl: tabUrl,
    pageUrl: tabUrl,
  };
}

function shouldIgnoreTailoredResumeBadgeCheckError(error: unknown) {
  const message =
    error instanceof Error ? error.message.trim().toLowerCase() : "";

  return (
    message === "failed to fetch" ||
    message === "load failed" ||
    message === "networkerror when attempting to fetch resource." ||
    message.includes("sign in to job helper") ||
    message.includes("no active tab was found")
  );
}

async function refreshTailoredResumeBadgeForTab(
  tab: chrome.tabs.Tab,
  checkSequence: number,
  options: TailoredResumeBadgeCheckOptions = {},
) {
  const tabId = tab.id;

  if (typeof tabId !== "number") {
    return;
  }

  const latestTab = await chrome.tabs.get(tabId).catch(() => tab);

  if (latestTailoredResumeBadgeCheckByTabId.get(tabId) !== checkSequence) {
    return;
  }

  if (!latestTab.active) {
    return;
  }

  const tabUrl = cleanText(latestTab.url) || cleanText(latestTab.pendingUrl);

  if (!isHttpTabUrl(tabUrl) || isJobHelperAppUrl(tabUrl)) {
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    return;
  }

  const pageIdentity = await readTailoredResumeBadgePageIdentity(latestTab);

  if (
    isJobHelperAppUrl(pageIdentity.pageUrl) ||
    isJobHelperAppUrl(pageIdentity.jobUrl) ||
    isJobHelperAppUrl(pageIdentity.canonicalUrl)
  ) {
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    return;
  }

  if (
    !isHttpTabUrl(pageIdentity.pageUrl) &&
    !isHttpTabUrl(pageIdentity.jobUrl) &&
    !isHttpTabUrl(pageIdentity.canonicalUrl)
  ) {
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    return;
  }

  const { personalInfo } = await getPersonalInfoSummary({
    forceFresh: options.forceFreshPersonalInfo === true,
  });

  if (latestTailoredResumeBadgeCheckByTabId.get(tabId) !== checkSequence) {
    return;
  }

  const matchingActiveTailoring = resolveActiveTailoringForPage({
    activeTailorings: personalInfo.activeTailorings,
    pageIdentity,
  });
  const showedActiveKeywordBadge = await showActiveTailoringKeywordBadgeForTab({
    pageIdentity,
    personalInfo,
    tabId,
  });
  const localActiveKeywordBadge = showedActiveKeywordBadge
    ? { matchedActiveRun: false, showed: false }
    : await showLocalActiveTailorRunKeywordBadgeForTab({
        nonTechnologyNames: personalInfo.userMarkdown.nonTechnologies,
        pageIdentity,
        tabId,
      });

  if (showedActiveKeywordBadge || localActiveKeywordBadge.showed) {
    return;
  }

  if (matchingActiveTailoring || localActiveKeywordBadge.matchedActiveRun) {
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    return;
  }

  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: personalInfo.activeTailorings,
    pageIdentity,
    tailoredResumes: personalInfo.tailoredResumes,
  });

  if (!badge) {
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    return;
  }

  await sendTailoredResumeBadgeMessage(tabId, {
    payload: {
      ...badge,
      includeLowPriorityTermsInKeywordCoverage:
        personalInfo.generationSettings.includeLowPriorityTermsInKeywordCoverage,
      nonTechnologyNames: personalInfo.userMarkdown.nonTechnologies,
    },
    type: "JOB_HELPER_SHOW_TAILORED_RESUME_BADGE",
  });
}

function scheduleTailoredResumeBadgeCheck(
  tab: chrome.tabs.Tab | null,
  options: TailoredResumeBadgeCheckOptions = {},
) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const tabId = tab.id;
  const targetTab = tab;
  const previousTimeout = scheduledTailoredResumeBadgeChecks.get(tabId);

  if (previousTimeout) {
    globalThis.clearTimeout(previousTimeout);
  }

  const checkSequence = (tailoredResumeBadgeCheckSequence += 1);
  latestTailoredResumeBadgeCheckByTabId.set(tabId, checkSequence);

  const timeout = globalThis.setTimeout(() => {
    scheduledTailoredResumeBadgeChecks.delete(tabId);
    void refreshTailoredResumeBadgeForTab(targetTab, checkSequence, options).catch(
      (error) => {
        if (!shouldIgnoreTailoredResumeBadgeCheckError(error)) {
          console.warn("Could not check this tab for a tailored resume.", error);
        }
        void sendTailoredResumeBadgeMessage(tabId, {
          type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
        });
      });
  }, TAILORED_RESUME_BADGE_CHECK_DEBOUNCE_MS);

  scheduledTailoredResumeBadgeChecks.set(tabId, timeout);
}

async function collectPageContext(tabId: number) {
  return collectPageContextFromTab(tabId, "JOB_HELPER_COLLECT_PAGE_CONTEXT");
}

async function readStorageRegistry(
  key: string,
): Promise<TailorRunStorageRegistry<unknown>> {
  const result = await chrome.storage.local.get(key);
  const registry = result[key];
  return isRecord(registry) ? { ...registry } : {};
}

function areStorageValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function setStorageRegistryEntry<T>(
  key: string,
  entryKey: string,
  value: T | null,
) {
  const registry = await readStorageRegistry(key);
  const previousValue = registry[entryKey] ?? null;

  if (areStorageValuesEqual(previousValue, value)) {
    return;
  }

  if (value) {
    registry[entryKey] = value;
  } else {
    delete registry[entryKey];
  }

  if (Object.keys(registry).length === 0) {
    await chrome.storage.local.remove(key);
    return;
  }

  await chrome.storage.local.set({
    [key]: registry,
  });
}

async function clearLegacyTailorRunStorageKeys() {
  await chrome.storage.local.remove([
    EXISTING_TAILORING_STORAGE_KEY,
    LAST_TAILORING_STORAGE_KEY,
    PREPARING_TAILORING_STORAGE_KEY,
  ]);
}

async function persistResult(
  pageKey: string,
  record: TailorResumeRunRecord | null,
) {
  await setStorageRegistryEntry(TAILORING_RUNS_STORAGE_KEY, pageKey, record);
  await clearLegacyTailorRunStorageKeys();
}

async function persistTailorPreparationState(
  pageKey: string,
  preparationState: ReturnType<typeof buildTailorResumePreparationState> | null,
) {
  await setStorageRegistryEntry(
    TAILORING_PREPARATIONS_STORAGE_KEY,
    pageKey,
    preparationState,
  );
  await clearLegacyTailorRunStorageKeys();
}

async function persistExistingTailoringPrompt(
  pageKey: string,
  prompt:
    | {
        existingTailoring: ReturnType<typeof readTailorResumeExistingTailoringState>;
        jobDescription: string;
        jobUrl: string | null;
        pageContext: JobPageContext;
      }
    | null,
) {
  await setStorageRegistryEntry(TAILORING_PROMPTS_STORAGE_KEY, pageKey, prompt);
  await clearLegacyTailorRunStorageKeys();
}

async function clearTailorStateForKey(pageKey: string | null) {
  if (pageKey) {
    activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
    await Promise.all([
      setStorageRegistryEntry(TAILORING_RUNS_STORAGE_KEY, pageKey, null),
      setStorageRegistryEntry(TAILORING_PREPARATIONS_STORAGE_KEY, pageKey, null),
      setStorageRegistryEntry(TAILORING_PROMPTS_STORAGE_KEY, pageKey, null),
    ]);
  } else {
    activeTailorRunKeywordBadgesByPageKey.clear();
    await chrome.storage.local.remove([
      TAILORING_RUNS_STORAGE_KEY,
      TAILORING_PREPARATIONS_STORAGE_KEY,
      TAILORING_PROMPTS_STORAGE_KEY,
    ]);
  }

  await clearLegacyTailorRunStorageKeys();
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  return (
    error instanceof Error &&
    /abort/i.test(error.name || error.message || "")
  );
}

function throwIfTailorCaptureAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("The Tailor Resume start was aborted.", "AbortError");
  }
}

async function patchTailorResume(
  body: Record<string, unknown>,
  authSession: JobHelperAuthSession,
  options: {
      onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
      signal?: AbortSignal;
  } = {},
) {
  const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
    method: "PATCH",
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      ...authorizationHeaders(authSession),
      "Content-Type": "application/json",
      "x-tailor-resume-stream": "1",
    },
    signal: options.signal,
  });

  if (isNdjsonResponse(response)) {
    return readTailorResumeGenerationStream(response, {
      onStepEvent: options.onStepEvent,
    });
  }

  const payload = await readJsonResponse(response);

  return {
    ok: response.ok,
    payload,
    status: response.status,
  };
}

async function cancelCurrentTailoring(input: {
  existingTailoringId?: string | null;
  jobUrl?: string | null;
  pageKey?: string | null;
} = {}) {
  const pageKey =
    input.pageKey ??
    buildTailorRunRegistryKey(input.jobUrl) ??
    null;
  const abortController = pageKey
    ? activeTailorResumeAbortControllers.get(pageKey) ?? null
    : null;

  if (pageKey) {
    activeTailorResumeAbortControllers.delete(pageKey);
  }

  abortController?.abort();

  try {
    const authSession = await ensureJobHelperSession({ interactive: false });
    const action =
      input.existingTailoringId?.trim()
        ? "cancelExistingTailoring"
        : input.jobUrl?.trim()
          ? "cancelTailoringByJobUrl"
          : "cancelCurrentTailoring";
    const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      method: "PATCH",
      body: JSON.stringify({
        action,
        ...(input.existingTailoringId?.trim()
          ? { existingTailoringId: input.existingTailoringId.trim() }
          : {}),
        ...(input.jobUrl?.trim() ? { jobUrl: input.jobUrl.trim() } : {}),
      }),
      credentials: "include",
      headers: {
        ...authorizationHeaders(authSession),
        "Content-Type": "application/json",
      },
    });
    const payload = await readJsonResponse(response);

    if (response.status === 401) {
      await clearStoredAuthSession();
    }

    if (!response.ok) {
      throw new Error(
        readResponseError(payload, "Unable to stop the current tailoring run."),
      );
    }
  } finally {
    await clearTailorStateForKey(pageKey);
    await hideTailoredResumeBadgesForMatchingTabs({
      targetUrls: [input.jobUrl, pageKey],
    });
  }

  const activeTab = await getActiveTab().catch(() => null);

  if (activeTab && typeof activeTab.id === "number") {
    await showOverlay(activeTab.id, "Stopped the current Tailor Resume run.", "info");
  }

  return getPersonalInfoSummary();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPayloadString(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return "";
  }

  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function readPayloadStringArray(payload: unknown, key: string) {
  if (!isRecord(payload) || !Array.isArray(payload[key])) {
    return [] as string[];
  }

  return payload[key]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function readPayloadBoolean(payload: unknown, key: string) {
  return isRecord(payload) && payload[key] === true;
}

function readAuthUser(value: unknown): JobHelperAuthUser | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return {
    email: typeof value.email === "string" ? value.email : null,
    id: value.id,
    image: typeof value.image === "string" ? value.image : null,
    name: typeof value.name === "string" ? value.name : null,
  };
}

function readAuthSession(value: unknown): JobHelperAuthSession | null {
  if (
    !isRecord(value) ||
    typeof value.sessionToken !== "string" ||
    typeof value.expires !== "string"
  ) {
    return null;
  }

  const user = readAuthUser(value.user);

  if (!user) {
    return null;
  }

  return {
    expires: value.expires,
    sessionToken: value.sessionToken,
    user,
  };
}

function isAuthSessionFresh(session: JobHelperAuthSession) {
  const expiresAt = new Date(session.expires).getTime();

  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

async function readStoredAuthSession() {
  const result = await chrome.storage.local.get(AUTH_SESSION_STORAGE_KEY);
  return readAuthSession(result[AUTH_SESSION_STORAGE_KEY]);
}

async function writeStoredAuthSession(session: JobHelperAuthSession) {
  await chrome.storage.local.set({
    [AUTH_SESSION_STORAGE_KEY]: session,
  });
}

async function clearStoredAuthSession() {
  await chrome.storage.local.remove([
    AUTH_SESSION_STORAGE_KEY,
    PERSONAL_INFO_CACHE_STORAGE_KEY,
  ]);
}

async function readJsonResponse(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readResponseError(
  payload: Record<string, unknown>,
  fallbackMessage: string,
) {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : fallbackMessage;
}

function authorizationHeaders(session: JobHelperAuthSession) {
  return {
    Authorization: `Bearer ${session.sessionToken}`,
  };
}

function buildTailoredResumePreviewDownloadUrl(tailoredResumeId: string) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);
  url.searchParams.set("tailoredResumeId", tailoredResumeId);
  return url.toString();
}

function normalizeTailoredResumeDownloadName(value: string) {
  const rawBaseName = value.replace(/\.pdf$/i, "");
  const baseName =
    sanitizeResumeDownloadFilenameBase(rawBaseName) ||
    sanitizeResumeDownloadFilenameBase(
      buildCompanyResumeDownloadName({
        companyName: null,
        displayName: null,
      }).replace(/\.pdf$/i, ""),
    );

  return `${baseName || "Tailored Resume"}.pdf`;
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return `data:${blob.type || "application/pdf"};base64,${btoa(binary)}`;
}

async function downloadTailoredResumePdf(input: {
  companyName: string;
  displayName: string;
  downloadName: string;
  tailoredResumeId: string;
}) {
  const tailoredResumeId = input.tailoredResumeId.trim();

  if (!tailoredResumeId) {
    throw new Error("Could not download the resume because its ID is missing.");
  }

  if (!chrome.downloads?.download) {
    throw new Error("Chrome downloads are not available in this extension context.");
  }

  const filename = normalizeTailoredResumeDownloadName(
    buildCompanyResumeDownloadName({
      companyName: input.companyName,
      displayName: input.displayName || input.downloadName,
    }),
  );
  const session = await ensureJobHelperSession({ interactive: false });
  const response = await fetch(
    buildTailoredResumePreviewDownloadUrl(tailoredResumeId),
    {
      cache: "no-store",
      credentials: "include",
      headers: authorizationHeaders(session),
    },
  );

  if (response.status === 401) {
    await clearStoredAuthSession();
  }

  if (!response.ok) {
    const payload = await response
      .clone()
      .json()
      .catch(() => ({} as Record<string, unknown>));

    throw new Error(
      readResponseError(payload, "Could not download the tailored resume."),
    );
  }

  const downloadId = await chrome.downloads.download({
    filename,
    saveAs: false,
    url: await blobToDataUrl(await response.blob()),
  });

  return {
    downloadId,
    filename,
  };
}

async function validateStoredAuthSession(session: JobHelperAuthSession) {
  const response = await fetch(EXTENSION_AUTH_SESSION_ENDPOINT, {
    credentials: "include",
    headers: authorizationHeaders(session),
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    await clearStoredAuthSession();
    return null;
  }

  const user = readAuthUser(payload.user);
  const expires = typeof payload.expires === "string" ? payload.expires : session.expires;
  const validatedSession = user
    ? {
        ...session,
        expires,
        user,
      }
    : session;

  if (!isAuthSessionFresh(validatedSession)) {
    await clearStoredAuthSession();
    return null;
  }

  await writeStoredAuthSession(validatedSession);
  return validatedSession;
}

async function getAuthStatus(): Promise<AuthStatus> {
  const storedSession = await readStoredAuthSession();

  if (!storedSession || !isAuthSessionFresh(storedSession)) {
    await clearStoredAuthSession();
    const silentSession = await trySignInToJobHelperSilently();

    return silentSession
      ? { session: silentSession, status: "signedIn" }
      : { status: "signedOut" };
  }

  const validatedSession = await validateStoredAuthSession(storedSession);

  if (validatedSession) {
    return { session: validatedSession, status: "signedIn" };
  }

  const silentSession = await trySignInToJobHelperSilently();

  return silentSession
    ? { session: silentSession, status: "signedIn" }
    : { status: "signedOut" };
}

async function requestGoogleAccessToken(interactive: boolean) {
  if (!chrome.identity?.getAuthToken) {
    throw new Error("Chrome identity permissions are not available.");
  }

  const result = (await chrome.identity.getAuthToken({
    interactive,
  })) as { token?: string } | string;
  const token = typeof result === "string" ? result : result.token;

  if (!token) {
    throw new Error("Google did not return an extension access token.");
  }

  return token;
}

async function removeCachedGoogleAccessToken(accessToken: string) {
  if (!chrome.identity?.removeCachedAuthToken) {
    return;
  }

  try {
    await chrome.identity.removeCachedAuthToken({ token: accessToken });
  } catch {
    // Best effort only: the next request will still surface the auth error.
  }
}

async function exchangeGoogleAccessTokenForJobHelperSession(accessToken: string) {
  const response = await fetch(EXTENSION_AUTH_GOOGLE_ENDPOINT, {
    body: JSON.stringify({ accessToken }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new JobHelperSignInError(
      readResponseError(payload, "Unable to connect Job Helper."),
      response.status,
    );
  }

  const session = readAuthSession(payload);

  if (!session || !isAuthSessionFresh(session)) {
    throw new Error("Job Helper did not return a usable extension session.");
  }

  await writeStoredAuthSession(session);

  return session;
}

async function signInToJobHelper(input: { interactive?: boolean } = {}) {
  const interactive = input.interactive ?? true;
  const accessToken = await requestGoogleAccessToken(interactive);

  try {
    return await exchangeGoogleAccessTokenForJobHelperSession(accessToken);
  } catch (error) {
    await removeCachedGoogleAccessToken(accessToken);

    if (!(error instanceof JobHelperSignInError) || error.status !== 401) {
      throw error;
    }

    const retryAccessToken = await requestGoogleAccessToken(interactive);

    try {
      return await exchangeGoogleAccessTokenForJobHelperSession(retryAccessToken);
    } catch (retryError) {
      await removeCachedGoogleAccessToken(retryAccessToken);
      throw retryError;
    }
  }
}

async function trySignInToJobHelperSilently() {
  try {
    return await signInToJobHelper({ interactive: false });
  } catch {
    await clearStoredAuthSession();
    return null;
  }
}

async function ensureJobHelperSession(input: { interactive: boolean }) {
  const storedSession = await readStoredAuthSession();

  if (storedSession && isAuthSessionFresh(storedSession)) {
    const validatedSession = await validateStoredAuthSession(storedSession);

    if (validatedSession) {
      return validatedSession;
    }
  }

  await clearStoredAuthSession();

  const silentSession = await trySignInToJobHelperSilently();

  if (silentSession) {
    return silentSession;
  }

  if (!input.interactive) {
    throw new Error("Sign in to Job Helper from the extension first.");
  }

  return signInToJobHelper({ interactive: true });
}

async function signOutOfJobHelper() {
  const storedSession = await readStoredAuthSession();

  if (storedSession) {
    await fetch(EXTENSION_AUTH_SESSION_ENDPOINT, {
      credentials: "include",
      headers: authorizationHeaders(storedSession),
      method: "DELETE",
    }).catch(() => undefined);
  }

  await clearStoredAuthSession();

  return { status: "signedOut" } satisfies AuthStatus;
}

async function buildBrowserSessionUrl(
  session: JobHelperAuthSession,
  callbackUrl: string,
) {
  const response = await fetch(EXTENSION_BROWSER_SESSION_ENDPOINT, {
    body: JSON.stringify({ callbackUrl }),
    credentials: "include",
    headers: {
      ...authorizationHeaders(session),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse(response);

  if (!response.ok || typeof payload.url !== "string") {
    throw new Error(
      readResponseError(payload, "Unable to open Job Helper in the browser."),
    );
  }

  return payload.url;
}

async function openUrlInCurrentWindow(url: string) {
  let windowId: number | null = null;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    windowId =
      typeof activeTab?.windowId === "number" ? activeTab.windowId : null;
  } catch {
    windowId = null;
  }

  return chrome.tabs.create({
    active: true,
    ...(windowId === null ? {} : { windowId }),
    url,
  });
}

async function waitForTabToFinishLoading(
  tab: chrome.tabs.Tab,
  timeoutMs = 15_000,
) {
  const tabId = tab.id;

  if (typeof tabId !== "number") {
    throw new Error("Could not open that job tab.");
  }

  const readLatestTab = async () => {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return tab;
    }
  };

  const latestTab = await readLatestTab();

  if (latestTab.status === "complete") {
    return latestTab;
  }

  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    let settled = false;

    const settle = (nextTab: chrome.tabs.Tab | Error, rejectPromise = false) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);

      if (rejectPromise) {
        reject(nextTab);
        return;
      }

      resolve(nextTab as chrome.tabs.Tab);
    };

    const handleUpdated = (
      updatedTabId: number,
      changeInfo: { status?: string },
      updatedTab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      settle(updatedTab);
    };

    const handleRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) {
        return;
      }

      settle(
        new Error("The job tab was closed before Tailor Resume could restart."),
        true,
      );
    };

    const timeoutId = globalThis.setTimeout(() => {
      void readLatestTab().then((updatedTab) => settle(updatedTab));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
  });
}

function readComparableTabUrl(tab: chrome.tabs.Tab) {
  const comparablePendingUrl =
    typeof tab.pendingUrl === "string"
      ? normalizeComparableUrl(tab.pendingUrl)
      : null;

  if (comparablePendingUrl) {
    return comparablePendingUrl;
  }

  return typeof tab.url === "string" ? normalizeComparableUrl(tab.url) : null;
}

async function findBrowserTabForUrl(url: string) {
  const normalizedTargetUrl = normalizeComparableUrl(url);

  if (!normalizedTargetUrl) {
    return null;
  }

  let currentWindowId: number | null = null;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentWindowId =
      typeof activeTab?.windowId === "number" ? activeTab.windowId : null;
  } catch {
    currentWindowId = null;
  }

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter(
    (tab) => readComparableTabUrl(tab) === normalizedTargetUrl,
  );

  matchingTabs.sort((left, right) => {
    const leftCurrentWindow =
      currentWindowId !== null && left.windowId === currentWindowId ? 1 : 0;
    const rightCurrentWindow =
      currentWindowId !== null && right.windowId === currentWindowId ? 1 : 0;

    if (leftCurrentWindow !== rightCurrentWindow) {
      return rightCurrentWindow - leftCurrentWindow;
    }

    const leftActive = left.active ? 1 : 0;
    const rightActive = right.active ? 1 : 0;

    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    return 0;
  });

  return matchingTabs[0] ?? null;
}

async function focusOrCreateBrowserTab(url: string) {
  const targetUrl = url.trim();

  if (!normalizeComparableUrl(targetUrl)) {
    throw new Error("Could not open that job because its URL is missing.");
  }

  const existingTab = await findBrowserTabForUrl(targetUrl);

  if (typeof existingTab?.id === "number") {
    const activatedTab = await chrome.tabs.update(existingTab.id, {
      active: true,
    });

    if (!activatedTab) {
      throw new Error("Could not focus the existing job tab.");
    }

    if (typeof activatedTab.windowId === "number") {
      await chrome.windows.update(activatedTab.windowId, { focused: true });
    }

    return {
      created: false,
      tab: activatedTab,
    };
  }

  const createdTab = await openUrlInCurrentWindow(targetUrl);

  return {
    created: true,
    tab: createdTab,
  };
}

async function goToBrowserTab(url: string) {
  const result = await focusOrCreateBrowserTab(url);
  await openSidePanelForTab(result.tab);

  return {
    created: result.created,
    tabId: result.tab.id ?? null,
    windowId: result.tab.windowId ?? null,
  };
}

async function triggerTailorResumeRegeneration(input: {
  overwriteTargetApplicationId?: string | null;
  overwriteTargetTailoredResumeId?: string | null;
  url: string;
}) {
  const result = await focusOrCreateBrowserTab(input.url);
  void runCaptureFlow({
    openSidePanel: true,
    overwriteTargetApplicationId: input.overwriteTargetApplicationId,
    overwriteTargetTailoredResumeId: input.overwriteTargetTailoredResumeId,
    overwriteExisting: true,
    tab: result.tab,
  });

  return {
    created: result.created,
    tabId: result.tab.id ?? null,
    windowId: result.tab.windowId ?? null,
  };
}

async function openSidePanelForTab(tab: chrome.tabs.Tab) {
  try {
    const windowId = typeof tab.windowId === "number" ? tab.windowId : undefined;

    if (typeof windowId === "number") {
      await chrome.sidePanel.open({ windowId });
    }
  } catch (error) {
    console.warn("Could not open the Job Helper side panel.", error);
  }
}

function normalizeDashboardCallbackUrl(callbackUrl: string) {
  try {
    const dashboardUrl = new URL(DEFAULT_DASHBOARD_URL);
    const url =
      callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? new URL(callbackUrl, dashboardUrl.origin)
        : new URL(callbackUrl);

    if (url.origin !== dashboardUrl.origin) {
      return dashboardUrl.toString();
    }

    return url.toString();
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

async function openJobHelperCallbackUrl(callbackUrl: string) {
  const normalizedCallbackUrl = normalizeDashboardCallbackUrl(callbackUrl);
  const currentWindowTabs = await chrome.tabs
    .query({ currentWindow: true })
    .catch(() => [] as chrome.tabs.Tab[]);
  const existingTab = findMatchingCurrentWindowTabForUrl(
    currentWindowTabs,
    normalizedCallbackUrl,
  );

  if (typeof existingTab?.id === "number") {
    const activatedTab = await chrome.tabs.update(existingTab.id, {
      active: true,
    });

    if (typeof activatedTab?.windowId === "number") {
      await chrome.windows.update(activatedTab.windowId, { focused: true });
    }

    return;
  }

  let url = normalizedCallbackUrl;

  try {
    const session = await ensureJobHelperSession({ interactive: false });
    url = await buildBrowserSessionUrl(session, url);
  } catch (error) {
    console.warn(
      "Opening Job Helper without an extension browser-session handoff.",
      error,
    );
  }

  await openUrlInCurrentWindow(url);
}

async function getTailoredResumeSummaries() {
  const session = await ensureJobHelperSession({ interactive: false });
  const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
    cache: "no-store",
    credentials: "include",
    headers: authorizationHeaders(session),
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      await clearStoredAuthSession();
    }

    throw new Error(
      readResponseError(payload, "Could not load tailored resumes."),
    );
  }

  return {
    records: readTailoredResumeSummaries(payload),
  };
}

async function writeStoredPersonalInfoCache(input: {
  personalInfo: ReturnType<typeof readPersonalInfoPayload>;
  userId: string;
}) {
  await chrome.storage.local.set({
    [PERSONAL_INFO_CACHE_STORAGE_KEY]: buildPersonalInfoCacheEntry({
      personalInfo: input.personalInfo,
      userId: input.userId,
    }),
  });
}

async function readStoredPersonalInfoCache(userId: string) {
  const result = await chrome.storage.local.get(PERSONAL_INFO_CACHE_STORAGE_KEY);
  const cacheEntry = readPersonalInfoCacheEntry(
    result[PERSONAL_INFO_CACHE_STORAGE_KEY],
  );

  if (!cacheEntry || cacheEntry.userId !== userId) {
    return null;
  }

  return cacheEntry;
}

function hasVolatileTailorResumeState(personalInfo: PersonalInfoSummary) {
  return (
    personalInfo.tailoringInterviews.length > 0 ||
    personalInfo.activeTailorings.some(
      (activeTailoring) =>
        activeTailoring.kind === "active_generation" ||
        activeTailoring.kind === "pending_interview",
    )
  );
}

function readPersonalInfoCacheAgeMs(cachedAt: string) {
  const cachedAtTime = Date.parse(cachedAt);

  return Number.isFinite(cachedAtTime)
    ? Date.now() - cachedAtTime
    : Number.POSITIVE_INFINITY;
}

async function fetchWithTimeout(
  input: {
    errorMessage: string;
    timeoutMs: number;
    url: string | URL;
  } & RequestInit,
) {
  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    timeoutController.abort();
  }, input.timeoutMs);

  try {
    return await fetch(input.url, {
      ...input,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(input.errorMessage);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function fetchFreshPersonalInfoSummary(session: JobHelperAuthSession) {
  const personalInfoUrl = new URL(DEFAULT_TAILOR_RESUME_ENDPOINT);
  personalInfoUrl.searchParams.set("includeApplications", "1");
  personalInfoUrl.searchParams.set("applicationLimit", "12");
  const tailorResumeResponse = await fetchWithTimeout({
    cache: "no-store",
    credentials: "include",
    errorMessage: "Timed out while loading your Job Helper info.",
    headers: authorizationHeaders(session),
    timeoutMs: PERSONAL_INFO_REQUEST_TIMEOUT_MS,
    url: personalInfoUrl,
  });
  const tailorResumePayload = await readJsonResponse(tailorResumeResponse);

  if (!tailorResumeResponse.ok) {
    if (tailorResumeResponse.status === 401) {
      await clearStoredAuthSession();
    }

    throw new Error(
      readResponseError(
        tailorResumePayload,
        "Could not load your Job Helper info.",
      ),
    );
  }

  const personalInfo = readPersonalInfoPayload(tailorResumePayload);
  await writeStoredPersonalInfoCache({
    personalInfo,
    userId: session.user.id,
  });
  await showActiveTailoringKeywordBadgeForCurrentTab(personalInfo).catch(
    (error) => {
      if (!shouldIgnoreTailoredResumeBadgeCheckError(error)) {
        console.warn(
          "Could not replay the Tailor Resume keyword badge for this tab.",
          error,
        );
      }
    },
  );
  await showActiveTailoringKeywordBadgesForMatchingTabs(personalInfo).catch(
    (error) => {
      if (!shouldIgnoreTailoredResumeBadgeCheckError(error)) {
        console.warn(
          "Could not replay Tailor Resume keyword badges for open job tabs.",
          error,
        );
      }
    },
  );

  return {
    personalInfo,
  };
}

async function refreshPersonalInfoCache(session: JobHelperAuthSession) {
  if (personalInfoCacheRefreshPromise) {
    return personalInfoCacheRefreshPromise;
  }

  const refreshPromise = fetchFreshPersonalInfoSummary(session).finally(() => {
    personalInfoCacheRefreshPromise = null;
  });
  personalInfoCacheRefreshPromise = refreshPromise;

  return refreshPromise;
}

function refreshSharedPersonalInfoCache(
  session: JobHelperAuthSession,
  reason: string,
) {
  void refreshPersonalInfoCache(session).catch((error) => {
    console.warn(
      `Could not refresh the shared personal info cache after ${reason}.`,
      error,
    );
  });
}

async function writeInvalidatedPersonalInfoCache(input: {
  cachedPersonalInfo: PersonalInfoSummary;
  nextSyncState: ReturnType<typeof readUserSyncStateSnapshot>;
  userId: string;
}) {
  const invalidatedPersonalInfo = invalidateChangedPersonalInfoSlices({
    nextSyncState: input.nextSyncState,
    personalInfo: input.cachedPersonalInfo,
  });

  if (invalidatedPersonalInfo === input.cachedPersonalInfo) {
    return {
      personalInfo: input.cachedPersonalInfo,
    };
  }

  await writeStoredPersonalInfoCache({
    personalInfo: invalidatedPersonalInfo,
    userId: input.userId,
  });

  return {
    personalInfo: invalidatedPersonalInfo,
  };
}

async function fetchSyncStateSummary(session: JobHelperAuthSession) {
  const response = await fetchWithTimeout({
    cache: "no-store",
    credentials: "include",
    errorMessage: "Timed out while reading sync state.",
    headers: authorizationHeaders(session),
    timeoutMs: SYNC_STATE_REQUEST_TIMEOUT_MS,
    url: DEFAULT_SYNC_STATE_ENDPOINT,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      await clearStoredAuthSession();
    }

    throw new Error(readResponseError(payload, "Could not read sync state."));
  }

  return {
    syncState: readUserSyncStateSnapshot(payload),
  };
}

async function getPersonalInfoSummary(
  options: { forceFresh?: boolean } = {},
) {
  const session = await ensureJobHelperSession({ interactive: false });

  if (options.forceFresh) {
    return refreshPersonalInfoCache(session);
  }

  const cachedPersonalInfo = await readStoredPersonalInfoCache(session.user.id);

  if (!cachedPersonalInfo) {
    return refreshPersonalInfoCache(session);
  }

  const cacheAgeMs = readPersonalInfoCacheAgeMs(cachedPersonalInfo.cachedAt);

  if (
    cacheAgeMs > 5_000 ||
    hasVolatileTailorResumeState(cachedPersonalInfo.personalInfo)
  ) {
    try {
      return await refreshPersonalInfoCache(session);
    } catch (error) {
      console.warn(
        "Could not refresh stale or volatile personal info; falling back to sync-state reconciliation.",
        error,
      );
    }
  }

  try {
    const { syncState } = await fetchSyncStateSummary(session);

    if (!haveUserSyncStateChanged(cachedPersonalInfo.personalInfo.syncState, syncState)) {
      return {
        personalInfo: cachedPersonalInfo.personalInfo,
      };
    }

    try {
      return await refreshPersonalInfoCache(session);
    } catch (error) {
      console.warn(
        "Could not refresh shared personal info after a sync-state change; invalidating stale cache slices instead.",
        error,
      );

      return writeInvalidatedPersonalInfoCache({
        cachedPersonalInfo: cachedPersonalInfo.personalInfo,
        nextSyncState: syncState,
        userId: session.user.id,
      });
    }
  } catch (error) {
    if (cacheAgeMs <= 15_000) {
      return {
        personalInfo: cachedPersonalInfo.personalInfo,
      };
    }

    throw error;
  }
}

async function getSyncStateSummary() {
  const session = await ensureJobHelperSession({ interactive: false });
  return fetchSyncStateSummary(session);
}

async function loadTailorResumeOverwriteSummary(
  session: JobHelperAuthSession,
  options: {
    signal?: AbortSignal;
  } = {},
) {
  const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
    cache: "no-store",
    credentials: "include",
    headers: authorizationHeaders(session),
    signal: options.signal,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      await clearStoredAuthSession();
    }

    throw new Error(
      readResponseError(payload, "Could not check for existing tailoring."),
    );
  }

  return {
    activeTailorings: readTailorResumeExistingTailoringStates(payload),
    tailoredResumes: readTailoredResumeSummaries(payload),
  };
}

async function tailorResumeForTab(input: {
  abortController: AbortController;
  activeTab: chrome.tabs.Tab;
  authSession: JobHelperAuthSession;
  capturedAt: string;
  jobDescription: string;
  jobUrl: string | null;
  overwriteTargetApplicationId?: string | null;
  overwriteTargetTailoredResumeId?: string | null;
  overwriteExisting?: boolean;
  pageKey: string;
  pageContext: JobPageContext;
}) {
  const {
    abortController,
    activeTab,
    authSession,
    capturedAt,
    jobDescription,
    jobUrl,
    overwriteTargetApplicationId,
    overwriteTargetTailoredResumeId,
    overwriteExisting,
    pageKey,
    pageContext,
  } = input;
  let hasRequestedSharedPersonalInfoRefresh = false;
  const requestSharedPersonalInfoRefresh = () => {
    if (hasRequestedSharedPersonalInfoRefresh) {
      return;
    }

    hasRequestedSharedPersonalInfoRefresh = true;
    refreshSharedPersonalInfoCache(authSession, "the tailoring run started");
  };
  const readyTab = await waitForTabToFinishLoading(activeTab);
  const tabId = readyTab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  let latestStepEvent: TailorResumeGenerationStepSummary | null = null;
  let latestStepTimings: TailorResumeGenerationStepTiming[] = [];
  let result: Awaited<ReturnType<typeof patchTailorResume>>;

  try {
    result = await patchTailorResume(
      {
        action: "tailor",
        applicationContext: buildTailorResumeApplicationContext(pageContext),
        ...(overwriteExisting
          ? {
              existingTailoringAction: "overwrite",
              ...(overwriteTargetApplicationId?.trim()
                ? {
                    existingTailoringApplicationId:
                      overwriteTargetApplicationId.trim(),
                  }
                : {}),
              ...(overwriteTargetTailoredResumeId?.trim()
                ? {
                    existingTailoringTailoredResumeId:
                      overwriteTargetTailoredResumeId.trim(),
                  }
                : {}),
            }
          : {}),
        jobDescription,
        jobUrl,
      },
      authSession,
      {
        onStepEvent: (stepEvent) => {
          if (activeTailorResumeAbortControllers.get(pageKey) !== abortController) {
            return;
          }

          latestStepEvent = stepEvent;
          latestStepTimings = mergeTailorResumeGenerationStepTiming({
            observedAt: new Date().toISOString(),
            step: stepEvent,
            timings: latestStepTimings,
          });
          rememberActiveTailorRunKeywordBadge({
            capturedAt,
            pageContext,
            pageKey,
            stepEvent,
          });
          requestSharedPersonalInfoRefresh();
          void persistResult(
            pageKey,
            buildRunningTailoringRunRecord({
              applicationId: overwriteTargetApplicationId,
              capturedAt,
              pageContext,
              step: stepEvent,
              stepTimings: latestStepTimings,
              suppressedTailoredResumeId: overwriteTargetTailoredResumeId,
              tab: readyTab,
            }),
          );
          void showStepOneKeywordBadge({
            pageContext,
            pageKey,
            stepEvent,
            tabId,
          });
        },
        signal: abortController.signal,
      },
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Failed to tailor the resume.";
    const record = buildFailedTailoringRunRecord({
      capturedAt,
      message,
      pageContext,
      step: latestStepEvent,
      stepTimings: latestStepTimings,
      tab: readyTab,
    });

    activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
    await persistResult(pageKey, record);
    refreshSharedPersonalInfoCache(authSession, "the tailoring run failed");
    await showOverlay(tabId, message, "error");
    await openSidePanelForTab(activeTab);
    return;
  }
  const payload = result.payload;

  if (!result.ok) {
    if (result.status === 401) {
      await clearStoredAuthSession();
    }

    const existingTailoring = readTailorResumeExistingTailoringState(payload);
    const existingTailoringMessage = existingTailoring
      ? buildExistingTailoringMessage(existingTailoring)
      : null;

    if (existingTailoring && existingTailoringMessage) {
      const record: TailorResumeRunRecord = {
        applicationId: existingTailoring.applicationId,
        capturedAt,
        companyName: null,
        endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
        generationStep: null,
        jobIdentifier: existingTailoring.jobIdentifier,
        message: existingTailoringMessage,
        pageTitle: pageContext.title || null,
        pageUrl: pageContext.url || null,
        positionTitle: null,
        status: "error",
        suppressedTailoredResumeId: null,
        tailoredResumeError: null,
        tailoredResumeId: null,
      };

      activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
      await persistResult(pageKey, record);
      await persistExistingTailoringPrompt(pageKey, {
        existingTailoring,
        jobDescription,
        jobUrl,
        pageContext,
      });
      refreshSharedPersonalInfoCache(
        authSession,
        "an existing tailoring run blocked a new start",
      );
      await showOverlay(tabId, existingTailoringMessage, "info");
      await openSidePanelForTab(activeTab);
      return;
    }

    const message =
      typeof payload.error === "string"
        ? payload.error
        : "The Tailor Resume endpoint returned an error.";
    const record = buildFailedTailoringRunRecord({
      capturedAt,
      message,
      pageContext,
      step: latestStepEvent,
      stepTimings: latestStepTimings,
      tab: readyTab,
    });

    activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
    await persistResult(pageKey, record);
    refreshSharedPersonalInfoCache(authSession, "the tailoring run failed");
    await showOverlay(tabId, message, "error");
    await openSidePanelForTab(activeTab);
    return;
  }

  if (typeof payload.profile !== "object" || payload.profile === null) {
    activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
    throw new Error("Tailor Resume did not return a saved result.");
  }

  const profileSummary = readTailorResumeProfileSummary(payload.profile);
  const activeInterview = profileSummary?.tailoringInterview ?? null;
  const activeQuestionStart = resolveActiveTailoringForPage({
    activeTailorings: readTailorResumeExistingTailoringStates(payload),
    pageIdentity: {
      canonicalUrl: pageContext.canonicalUrl,
      jobUrl,
      pageUrl: pageContext.url,
    },
  });

  if (payload.tailoringStatus === "question_start_pending") {
    const isPendingInterview =
      activeQuestionStart?.kind === "pending_interview";
    const record: TailorResumeRunRecord = {
      applicationId:
        activeQuestionStart?.applicationId ?? overwriteTargetApplicationId ?? null,
      capturedAt,
      companyName: isPendingInterview ? activeQuestionStart.companyName : null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep:
        latestStepEvent ?? {
	          attempt: null,
	          detail:
	            "Start the Step 2 chat when you are ready so the latest USER.md edits are used.",
          durationMs: 0,
          retrying: false,
          status: "running",
          stepCount: 5,
          stepNumber: 2,
	          summary: "Ready to review scraped technologies",
	        },
      generationStepTimings: latestStepTimings,
      jobIdentifier:
        activeQuestionStart?.jobIdentifier ?? null,
	      message: "Start the Step 2 chat in the side panel.",
      pageTitle: pageContext.title || null,
      pageUrl: pageContext.url || null,
      positionTitle: isPendingInterview ? activeQuestionStart.positionTitle : null,
      status: "needs_input",
      suppressedTailoredResumeId: overwriteTargetTailoredResumeId?.trim() || null,
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    await persistResult(pageKey, record);
    try {
      await refreshPersonalInfoCache(authSession);
    } catch (error) {
      console.warn(
        "Could not refresh the shared personal info cache before opening the Step 2 chat-start card.",
        error,
      );
    }
    await showOverlay(tabId, record.message, "info");
    await openSidePanelForTab(activeTab);
    return;
  }

  if (payload.tailoringStatus === "needs_user_input" || activeInterview) {
    const record: TailorResumeRunRecord = {
      applicationId: activeInterview?.applicationId ?? overwriteTargetApplicationId ?? null,
      capturedAt,
      companyName: activeInterview?.companyName ?? null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      generationStepTimings: latestStepTimings,
      jobIdentifier: activeInterview?.jobIdentifier ?? null,
      message: "Resume questions are waiting in the side panel.",
      pageTitle: pageContext.title || null,
      pageUrl: pageContext.url || null,
      positionTitle: activeInterview?.positionTitle ?? null,
      status: "needs_input",
      suppressedTailoredResumeId: overwriteTargetTailoredResumeId?.trim() || null,
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    await persistResult(pageKey, record);
    refreshSharedPersonalInfoCache(
      authSession,
      "the tailoring run moved into interview follow-up",
    );
    await showOverlay(tabId, record.message, "info");
    await openSidePanelForTab(activeTab);
    return;
  }

  const latestTailoredResume = readLatestTailoredResume(payload);
  const alreadyTailored = payload.tailoringStatus === "already_tailored";
  const tailoredResumeError =
    typeof payload.tailoredResumeError === "string"
      ? payload.tailoredResumeError
      : null;
  const record: TailorResumeRunRecord = {
    applicationId: latestTailoredResume?.applicationId ?? null,
    capturedAt,
    companyName: latestTailoredResume?.companyName ?? null,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: null,
    jobIdentifier: latestTailoredResume?.jobIdentifier ?? null,
    message: "",
    pageTitle: pageContext.title || null,
    pageUrl: pageContext.url || null,
    positionTitle: latestTailoredResume?.positionTitle ?? null,
    status:
      latestTailoredResume?.status === "ready" && !tailoredResumeError
        ? "success"
        : "error",
    suppressedTailoredResumeId: null,
    tailoredResumeError,
    tailoredResumeId: latestTailoredResume?.id ?? null,
  };

  record.message = alreadyTailored
    ? "Already tailored this job. Showing the saved resume in the side panel."
    : buildSuccessMessage(record);

  activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
  await persistResult(pageKey, record);
  refreshSharedPersonalInfoCache(
    authSession,
    "the tailoring run finished",
  );
  await showOverlay(
    tabId,
    record.message,
    record.tailoredResumeId && record.tailoredResumeError
      ? "warning"
      : record.status === "success"
        ? "success"
        : "error",
  );

  if (latestTailoredResume?.id) {
    scheduleTailoredResumeBadgeCheck(activeTab);
    await openSidePanelForTab(activeTab);
  }
}

async function runCaptureFlow(input: {
  openSidePanel?: boolean;
  overwriteTargetApplicationId?: string | null;
  overwriteTargetTailoredResumeId?: string | null;
  overwriteExisting?: boolean;
  tab?: chrome.tabs.Tab;
} = {}) {
  let activeTab = input.tab ?? null;
  let capturedAt = new Date().toISOString();
  let initialPageKey: string | null = null;
  let pageKey: string | null = null;
  const preparingMessage = buildTailorResumePreparationMessage(
    input.overwriteExisting === true,
  );

  try {
    activeTab = activeTab ?? (await getActiveTab());
    initialPageKey =
      readTailorRunRegistryKeyFromTab(activeTab) ??
      `tab:${activeTab.id ?? Date.now()}`;

    if (activeTailorResumeAbortControllers.has(initialPageKey)) {
      if (input.openSidePanel && activeTab) {
        await openSidePanelForTab(activeTab);
      }

      return;
    }

    capturedAt = new Date().toISOString();
    const abortController = new AbortController();
    activeTailorResumeAbortControllers.set(initialPageKey, abortController);

    if (typeof activeTab.id === "number") {
      await showOverlay(activeTab.id, preparingMessage, "info");
    }

    await persistTailorPreparationState(
      initialPageKey,
      buildTailorResumePreparationState({
        capturedAt,
        message: preparingMessage,
        pageTitle: cleanText(activeTab.title) || null,
        pageUrl: cleanText(activeTab.url) || null,
      }),
    );

    if (input.openSidePanel) {
      await openSidePanelForTab(activeTab);
    }

    const readyTab = await waitForTabToFinishLoading(activeTab);
    throwIfTailorCaptureAborted(abortController.signal);
    const tabId = readyTab.id;

    if (typeof tabId !== "number") {
      throw new Error("The active tab does not expose an id.");
    }

    const authSession = await ensureJobHelperSession({ interactive: true });
    throwIfTailorCaptureAborted(abortController.signal);
    const pageContext = await collectPageContext(tabId);
    throwIfTailorCaptureAborted(abortController.signal);
    const jobDescription = buildJobDescriptionFromPageContext(pageContext);
    const jobUrl = readJobUrlFromPageContext(pageContext);
    pageKey =
      readTailorRunRegistryKeyFromPageContext(pageContext) ?? initialPageKey;
    const pageIdentity = {
      canonicalUrl: pageContext.canonicalUrl,
      jobUrl,
      pageUrl: pageContext.url,
    };

    if (pageKey !== initialPageKey) {
      activeTailorResumeAbortControllers.delete(initialPageKey);
      activeTailorResumeAbortControllers.set(pageKey, abortController);
      await Promise.all([
        persistTailorPreparationState(initialPageKey, null),
        persistExistingTailoringPrompt(initialPageKey, null),
        persistResult(initialPageKey, null),
      ]);
      await persistTailorPreparationState(
        pageKey,
        buildTailorResumePreparationState({
          capturedAt,
          message: preparingMessage,
          pageContext,
        }),
      );
    }

    if (!jobDescription) {
      throw new Error("Could not find job description text on this page.");
    }

    let overwriteSummary:
      | Awaited<ReturnType<typeof loadTailorResumeOverwriteSummary>>
      | null = null;
    const cachedPersonalInfo =
      (await readStoredPersonalInfoCache(authSession.user.id))?.personalInfo ?? null;
    throwIfTailorCaptureAborted(abortController.signal);

    if (!input.overwriteExisting) {
      const cachedExistingTailoring =
        resolvePotentialTailorOverwriteFromPersonalInfo({
          pageIdentity,
          personalInfo: cachedPersonalInfo,
        });
      const cachedExistingTailoringMessage = buildExistingTailoringMessage(
        cachedExistingTailoring,
      );

      if (cachedExistingTailoring && cachedExistingTailoringMessage) {
        const record: TailorResumeRunRecord = {
          applicationId: cachedExistingTailoring.applicationId,
          capturedAt,
          companyName: null,
          endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
          generationStep: null,
          jobIdentifier: cachedExistingTailoring.jobIdentifier,
          message: cachedExistingTailoringMessage,
          pageTitle: pageContext.title || null,
          pageUrl: pageContext.url || null,
          positionTitle: null,
          status: "error",
          suppressedTailoredResumeId: null,
          tailoredResumeError: null,
          tailoredResumeId: null,
        };

        await persistTailorPreparationState(pageKey, null);
        await persistResult(pageKey, record);
        await persistExistingTailoringPrompt(pageKey, {
          existingTailoring: cachedExistingTailoring,
          jobDescription,
          jobUrl,
          pageContext,
        });
        await showOverlay(tabId, cachedExistingTailoringMessage, "info");
        await openSidePanelForTab(readyTab);
        return;
      }

      try {
        overwriteSummary = await loadTailorResumeOverwriteSummary(authSession, {
          signal: abortController.signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        if (cachedPersonalInfo) {
          throw new Error(
            "Could not confirm whether this page already has tailoring. Try again in a moment.",
          );
        }

        throw error;
      }

      throwIfTailorCaptureAborted(abortController.signal);
      const existingTailoring = resolvePotentialTailorOverwrite({
        activeTailorings: overwriteSummary?.activeTailorings ?? [],
        pageIdentity,
        tailoredResumes: overwriteSummary?.tailoredResumes ?? [],
      });
      const existingTailoringMessage =
        buildExistingTailoringMessage(existingTailoring);

      if (existingTailoring && existingTailoringMessage) {
        const record: TailorResumeRunRecord = {
          applicationId: existingTailoring.applicationId,
          capturedAt,
          companyName: null,
          endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
          generationStep: null,
          jobIdentifier: existingTailoring.jobIdentifier,
          message: existingTailoringMessage,
          pageTitle: pageContext.title || null,
          pageUrl: pageContext.url || null,
          positionTitle: null,
          status: "error",
          suppressedTailoredResumeId: null,
          tailoredResumeError: null,
          tailoredResumeId: null,
        };

        await persistTailorPreparationState(pageKey, null);
        await persistResult(pageKey, record);
        await persistExistingTailoringPrompt(pageKey, {
          existingTailoring,
          jobDescription,
          jobUrl,
          pageContext,
        });
        await showOverlay(tabId, existingTailoringMessage, "info");
        await openSidePanelForTab(readyTab);
        return;
      }
    }

    throwIfTailorCaptureAborted(abortController.signal);
    activeTailorRunKeywordBadgesByPageKey.delete(pageKey);
    await persistTailorPreparationState(pageKey, null);
    await persistExistingTailoringPrompt(pageKey, null);
    await persistResult(
      pageKey,
      buildRunningTailoringRunRecord({
        applicationId: input.overwriteTargetApplicationId,
        capturedAt,
        pageContext,
        suppressedTailoredResumeId: input.overwriteTargetTailoredResumeId,
        tab: readyTab,
      }),
    );
    await sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
    refreshSharedPersonalInfoCache(
      authSession,
      "the tailoring run was dispatched",
    );

    await showOverlay(tabId, "Tailoring your resume for this job...", "info");

    await tailorResumeForTab({
      abortController,
      activeTab: readyTab,
      authSession,
      capturedAt,
      jobDescription,
      jobUrl,
      overwriteTargetApplicationId: input.overwriteTargetApplicationId,
      overwriteTargetTailoredResumeId: input.overwriteTargetTailoredResumeId,
      overwriteExisting: input.overwriteExisting,
      pageKey,
      pageContext,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    const message = formatPageContextErrorMessage(
      error,
      "Failed to tailor the resume.",
    );
    const failureKind =
      isPageContextConnectionError(error) ||
      message === PAGE_CONTEXT_UNAVAILABLE_MESSAGE
        ? "page_capture"
        : null;
    activeTab = activeTab ?? (await getActiveTab().catch(() => null));
    const targetPageKey = pageKey ?? initialPageKey;

    if (targetPageKey) {
      await persistTailorPreparationState(targetPageKey, null);
    }

    const record: TailorResumeRunRecord = {
      applicationId: null,
      capturedAt,
      companyName: null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      failureKind,
      generationStep: null,
      jobIdentifier: null,
      message,
      pageTitle: cleanText(activeTab?.title) || null,
      pageUrl: cleanText(activeTab?.url) || null,
      positionTitle: null,
      status: "error",
      suppressedTailoredResumeId: null,
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    if (targetPageKey) {
      await persistResult(targetPageKey, record);
    }

    try {
      if (activeTab && typeof activeTab.id === "number") {
        await showOverlay(activeTab.id, message, "error");
      }
    } catch {
      // Ignore follow-up UI failures after persisting the error.
    }
  } finally {
    const targetPageKey = pageKey ?? initialPageKey;

    if (targetPageKey) {
      await persistTailorPreparationState(targetPageKey, null);
      activeTailorResumeAbortControllers.delete(targetPageKey);
    }

    if (initialPageKey && targetPageKey !== initialPageKey) {
      activeTailorResumeAbortControllers.delete(initialPageKey);
      await persistTailorPreparationState(initialPageKey, null);
    }
  }
}

void configureSidePanelAction();

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanelAction();
  console.log("Job Helper extension installed.");
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== CAPTURE_COMMAND_NAME) {
    return;
  }

  void runCaptureFlow({ openSidePanel: true });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) =>
      scheduleTailoredResumeBadgeCheck(tab, {
        forceFreshPersonalInfo: true,
      }),
    )
    .catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || (changeInfo.status !== "complete" && !changeInfo.url)) {
    return;
  }

  if (changeInfo.url) {
    void sendTailoredResumeBadgeMessage(tabId, {
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE",
    });
  }

  scheduleTailoredResumeBadgeCheck(tab, {
    forceFreshPersonalInfo: true,
  });
});

function sendAsyncResponse(
  sendResponse: (response?: unknown) => void,
  handler: () => Promise<object>,
) {
  void handler()
    .then((response) => {
      sendResponse({ ok: true, ...response });
    })
    .catch((error) => {
      sendResponse({
        error: error instanceof Error ? error.message : "Job Helper failed.",
        ok: false,
      });
    });

  return true;
}

chrome.runtime.onMessage.addListener((
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => {
  const typedMessage =
    typeof message === "object" && message !== null
      ? (message as RuntimeMessage)
      : null;

  if (typedMessage?.type === "JOB_HELPER_TRIGGER_CAPTURE") {
    void runCaptureFlow({
      openSidePanel: true,
      overwriteTargetApplicationId: readPayloadString(
        typedMessage.payload,
        "existingTailoringApplicationId",
      ),
      overwriteTargetTailoredResumeId: readPayloadString(
        typedMessage.payload,
        "existingTailoringTailoredResumeId",
      ),
      overwriteExisting: readPayloadBoolean(
        typedMessage.payload,
        "overwriteExisting",
      ),
      tab: sender.tab,
    });
    sendResponse({ ok: true });
    return;
  }

  if (typedMessage?.type === "JOB_HELPER_AUTH_STATUS") {
    return sendAsyncResponse(sendResponse, async () => getAuthStatus());
  }

  if (typedMessage?.type === "JOB_HELPER_SIGN_IN") {
    return sendAsyncResponse(sendResponse, async () => ({
      session: await signInToJobHelper({ interactive: true }),
      status: "signedIn",
    }));
  }

  if (typedMessage?.type === "JOB_HELPER_SIGN_OUT") {
    return sendAsyncResponse(sendResponse, signOutOfJobHelper);
  }

  if (typedMessage?.type === "JOB_HELPER_TAILORED_RESUMES") {
    return sendAsyncResponse(sendResponse, getTailoredResumeSummaries);
  }

  if (typedMessage?.type === "JOB_HELPER_PERSONAL_INFO") {
    return sendAsyncResponse(sendResponse, () =>
      getPersonalInfoSummary({
        forceFresh: readPayloadBoolean(typedMessage.payload, "forceFresh"),
      }),
    );
  }

  if (typedMessage?.type === "JOB_HELPER_SYNC_STATE") {
    return sendAsyncResponse(sendResponse, getSyncStateSummary);
  }

  if (typedMessage?.type === "JOB_HELPER_CANCEL_CURRENT_TAILORING") {
    return sendAsyncResponse(sendResponse, async () =>
      cancelCurrentTailoring({
        existingTailoringId: readPayloadString(
          typedMessage.payload,
          "existingTailoringId",
        ),
        jobUrl: readPayloadString(typedMessage.payload, "jobUrl"),
        pageKey: readPayloadString(typedMessage.payload, "pageKey"),
      }),
    );
  }

  if (typedMessage?.type === "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE_FOR_URL") {
    return sendAsyncResponse(sendResponse, async () => {
      await hideTailoredResumeBadgesForMatchingTabs({
        fallbackTab: sender.tab,
        targetUrls: [
          readPayloadString(typedMessage.payload, "jobUrl"),
          readPayloadString(typedMessage.payload, "pageKey"),
          ...readPayloadStringArray(typedMessage.payload, "jobUrls"),
        ],
      });

      return {};
    });
  }

  if (typedMessage?.type === "JOB_HELPER_OPEN_DASHBOARD") {
    return sendAsyncResponse(sendResponse, async () => {
      const callbackUrl =
        readPayloadString(typedMessage.payload, "callbackUrl") ||
        DEFAULT_DASHBOARD_URL;

      await openJobHelperCallbackUrl(callbackUrl);

      return {};
    });
  }

  if (typedMessage?.type === "JOB_HELPER_OPEN_TAILORED_RESUME_REVIEW") {
    return sendAsyncResponse(sendResponse, async () => {
      const tailoredResumeId = readPayloadString(
        typedMessage.payload,
        "tailoredResumeId",
      );

      if (!tailoredResumeId) {
        throw new Error("Could not open the resume review because the id is missing.");
      }

      await chrome.storage.local.set({
        [TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY]: {
          createdAt: new Date().toISOString(),
          tailoredResumeId,
          view: "quickReview",
        },
      });

      await openSidePanelForTab(sender.tab ?? (await getActiveTab()));

      return {};
    });
  }

  if (typedMessage?.type === "JOB_HELPER_GO_TO_TAB") {
    return sendAsyncResponse(sendResponse, async () => {
      const url = readPayloadString(typedMessage.payload, "url");

      if (!url) {
        throw new Error("Could not open that job because its URL is missing.");
      }

      return goToBrowserTab(url);
    });
  }

  if (typedMessage?.type === "JOB_HELPER_DOWNLOAD_TAILORED_RESUME") {
    return sendAsyncResponse(sendResponse, async () =>
      downloadTailoredResumePdf({
        companyName: readPayloadString(typedMessage.payload, "companyName"),
        displayName: readPayloadString(typedMessage.payload, "displayName"),
        downloadName: readPayloadString(typedMessage.payload, "downloadName"),
        tailoredResumeId: readPayloadString(
          typedMessage.payload,
          "tailoredResumeId",
        ),
      }),
    );
  }

  if (typedMessage?.type === "JOB_HELPER_REVEAL_KEYWORD_BADGE") {
    return sendAsyncResponse(sendResponse, async () => {
      const emphasizedTechnologies = isRecord(typedMessage.payload)
        ? readTailoredResumeEmphasizedTechnologies(
            typedMessage.payload.emphasizedTechnologies,
          )
        : [];
      const tailoredResumeId = readPayloadString(
        typedMessage.payload,
        "tailoredResumeId",
      );
      const badgeKey = readPayloadString(typedMessage.payload, "badgeKey");
      const displayName = readPayloadString(typedMessage.payload, "displayName");
      const jobUrlFromPayload = readPayloadString(
        typedMessage.payload,
        "jobUrl",
      );
      const nonTechnologyNames = [
        ...readPayloadStringArray(typedMessage.payload, "nonTechnologyNames"),
        ...readPayloadStringArray(typedMessage.payload, "nonTechnologies"),
      ];

      await revealDismissedKeywordBadge({
        badgeKey,
        displayName,
        emphasizedTechnologies,
        includeLowPriorityTermsInKeywordCoverage: readPayloadBoolean(
          typedMessage.payload,
          "includeLowPriorityTermsInKeywordCoverage",
        ),
        jobUrl: jobUrlFromPayload,
        keywordCoverage: isRecord(typedMessage.payload)
          ? typedMessage.payload.keywordCoverage
          : null,
        nonTechnologyNames,
        tailoredResumeId,
      });

      return {};
    });
  }

  if (typedMessage?.type === "JOB_HELPER_REFRESH_KEYWORD_BADGE") {
    return sendAsyncResponse(sendResponse, async () => {
      const emphasizedTechnologies = isRecord(typedMessage.payload)
        ? readTailoredResumeEmphasizedTechnologies(
            typedMessage.payload.emphasizedTechnologies,
          )
        : [];

      await refreshKeywordBadgeForMatchingTabs({
        badgeKey: readPayloadString(typedMessage.payload, "badgeKey"),
        displayName: readPayloadString(typedMessage.payload, "displayName"),
        emphasizedTechnologies,
        includeLowPriorityTermsInKeywordCoverage: readPayloadBoolean(
          typedMessage.payload,
          "includeLowPriorityTermsInKeywordCoverage",
        ),
        jobUrl: readPayloadString(typedMessage.payload, "jobUrl"),
        nonTechnologyNames: [
          ...readPayloadStringArray(typedMessage.payload, "nonTechnologyNames"),
          ...readPayloadStringArray(typedMessage.payload, "nonTechnologies"),
        ],
      });

      return {};
    });
  }

  if (typedMessage?.type === "JOB_HELPER_REGENERATE_TAILORING") {
    return sendAsyncResponse(sendResponse, async () => {
      const url = readPayloadString(typedMessage.payload, "url");

      if (!url) {
        throw new Error("Could not retry tailoring because the job URL is missing.");
      }

      return triggerTailorResumeRegeneration({
        overwriteTargetApplicationId: readPayloadString(
          typedMessage.payload,
          "existingTailoringApplicationId",
        ),
        overwriteTargetTailoredResumeId: readPayloadString(
          typedMessage.payload,
          "existingTailoringTailoredResumeId",
        ),
        url,
      });
    });
  }
});
