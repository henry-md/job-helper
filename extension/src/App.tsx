import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  resolveTailoredResumeReviewRecordFromPayload,
  type TailoredResumeReviewEdit,
  type TailoredResumeReviewRecord,
} from "../../lib/tailored-resume-review-record.ts";
import type { TailoredResumeOpenAiDebugStage } from "../../lib/tailor-resume-types.ts";
import { buildJobApplicationDisplayParts } from "../../lib/job-application-display.ts";
import { buildTailoredResumeInteractivePreviewQueries } from "../../lib/tailor-resume-preview-focus.ts";
import type { TailoredResumeInteractivePreviewQuery } from "../../lib/tailor-resume-preview-focus.ts";
import TailoredResumeInteractivePreview from "../../components/tailored-resume-interactive-preview";
import { buildTailoredResumeDownloadFilename } from "../../lib/tailored-resume-download-filename.ts";
import "./App.css";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailorResumePreparationMessage,
  buildTailorResumePreparationState,
  buildTailorResumeApplicationContext,
  buildTailoredResumeReviewUrl,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_JOB_APPLICATIONS_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT,
  EXTENSION_DEBUG_UI_ENABLED,
  EXTENSION_PREFERENCES_STORAGE_KEY,
  EXISTING_TAILORING_STORAGE_KEY,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_PREPARATIONS_STORAGE_KEY,
  TAILORING_PROMPTS_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY,
  type ExtensionPreferences,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  type PersonalInfoSummary,
  type TailorResumeStoredSkillData,
  type UserMarkdownSummary,
  buildEmptyTailorResumeStoredSkillData,
  defaultUserMarkdown,
  defaultExtensionPreferences,
  formatNonTechnologyTerm,
  normalizeNonTechnologyTerm,
  normalizeNonTechnologyTerms,
  readExtensionPreferences,
  readPersonalInfoPayload,
  readTailorResumeStoredSkillData,
  readTailorResumePreparationState,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeExistingTailoringState,
  readTailorResumeGenerationStepSummary,
  readTailorResumeGenerationStepTimings,
  readTailorResumeGenerationSettingsSummary,
  readTailorResumeProfileSummary,
  type TailorResumeExistingTailoringState,
  type TailorResumeConversationMessage,
  type TailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepTiming,
  type TailorResumeApplicationContext,
  type TailorResumePreparationState,
  type TailorResumePendingInterviewSummary,
  type TailorResumeRunRecord,
  type TailorRunTimeDisplayMode,
  type TailoredResumeEmphasizedTechnology,
  type TailoredResumeSummary,
  type TrackedApplicationSummary,
} from "./job-helper";
import {
  PAGE_CONTEXT_UNAVAILABLE_MESSAGE,
  collectPageContextFromTab,
  formatPageContextErrorMessage,
  isPageContextConnectionError,
} from "./page-context";
import { loadExtensionTailoredPreviewPdfJsModule } from "./tailored-resume-preview-pdfjs";
import TailoredResumeQuickReview from "./tailored-resume-quick-review";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
  type TailorResumeInterviewStreamEvent,
} from "./tailor-resume-stream";
import {
  buildTailorRunIdentityDisplay,
  readTailorRunDisplayUrl,
} from "./tailor-run-identity";
import {
  formatTailorRunDurationMs,
  formatTailorRunElapsedTime,
  formatTailorRunStepTimeDisplay,
  resolveDisplayedTailorRunIdentity,
  resolveReviewableTailoredResumeId,
  shouldClearCompletedLocalTailorRun,
  shouldRenderLegacyTailorRunShell as resolveShouldRenderLegacyTailorRunShell,
  shouldRenderTailorRunShell,
  shouldShowTailorRunInterviewAction,
} from "./tailor-run-display";
import {
  mergeTailorResumeGenerationStepTiming,
  mergeTailorResumeGenerationStepTimingHistory,
} from "./tailor-run-step-timing";
import {
  applyTailorInterviewStreamEventToMessage,
  hasTailorInterviewStreamedMessageContent,
  isTailorResumeInterviewEndStepEvent,
  mergeTailorInterviewWithStreamedAssistantMessage,
} from "./tailor-interview-flow";
import { readTailorRunKeywordTechnologies } from "./tailor-run-keywords";
import { buildCompletedTailoringMessage } from "./tailor-run-copy";
import {
  buildTailorResumeLiveStatusMessage as buildLiveTailorResumeStatusMessage,
  formatTailorResumeProgressStepLabel,
  formatTailorResumeProgressStatusLabel,
  readTailorResumeProgressAttemptBadgeLabel,
  readTailorResumeDisplayAttempt,
  readTailorResumeDisplayStepNumber,
} from "../../lib/tailor-resume-step-display.ts";
import {
  resolveCompletedTailoringForPage,
  resolveActiveTailoringForPage,
  matchesTailorOverwritePageIdentity,
} from "./tailor-overwrite-guard";
import {
  buildTailorRunRegistryKey,
  readTailorRunRegistryKeyFromPageContext,
} from "./tailor-run-registry";
import {
  collectTailorStorageRegistryKeys,
  findTailorStorageRegistryEntry,
  normalizeTailorStorageRegistry,
  pruneRawTailorStorageRegistry,
} from "./tailor-storage-registry";
import { buildTailoringRunsRefreshKey } from "./tailor-run-refresh";
import {
  filterVisibleTailoredResumes,
  filterVisibleTailorRunCardsForSavedResumes,
} from "./tailored-resume-visibility";
import {
  deriveKeywordBadgeDismissalKey,
  KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
  readDismissedKeywordBadgeMap,
} from "./keyword-badge-dismissal";
import {
  buildPersonalInfoCacheEntry,
  PERSONAL_INFO_CACHE_STORAGE_KEY,
  readPersonalInfoCacheEntry,
} from "./personal-info-cache";
import {
  haveUserSyncStateChanged,
  readUserSyncStateSnapshot,
  type UserSyncStateSnapshot,
} from "../../lib/sync-state.ts";
import {
  splitTailoredResumesByArchiveState,
} from "../../lib/tailored-resume-archive-state.ts";
import {
  bestFuzzyTextScore,
  normalizeFuzzySearchText,
  scoreFuzzyText,
} from "../../lib/fuzzy-search.ts";
import {
  filterTailorResumeSpareBulletsForSearch,
  tailorResumeSpareBulletSearchModes,
  type TailorResumeSpareBulletSearchMode,
} from "../../lib/tailor-resume-spare-bullet-search.ts";
import {
  formatTailorResumeSpareBulletLineCount,
  readTailorResumeSpareBulletLineTone,
  type TailorResumeSpareBulletLineMeasurement,
} from "../../lib/tailor-resume-spare-bullet-line-display.ts";

type PanelState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: JobPageContext }
  | { status: "error"; error: string; snapshot: null };

type CaptureState =
  | "blocked"
  | "error"
  | "finishing"
  | "idle"
  | "needs_input"
  | "running"
  | "sent";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; session: JobHelperAuthSession }
  | { status: "error"; error: string };

type AuthActionState = "idle" | "running";
type DashboardOpenActionState = "idle" | "running";

type PanelTab = "applications" | "debug" | "settings" | "tailor";
type TailoredResumeArchiveFilter = "archived" | "unarchived";

function splitFuzzySearchTokens(value: string | null | undefined) {
  return normalizeFuzzySearchText(value)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreTailoredResumeArchiveSearch(input: {
  query: string | null | undefined;
  resume: TailoredResumeSummary;
}) {
  const normalizedQuery = normalizeFuzzySearchText(input.query);

  if (!normalizedQuery) {
    return 1;
  }

  const searchValues = [
    input.resume.companyName,
    input.resume.positionTitle,
  ];
  const combinedValue = searchValues.filter(Boolean).join(" ");
  const directScore = Math.max(
    bestFuzzyTextScore(searchValues, normalizedQuery),
    scoreFuzzyText(combinedValue, normalizedQuery),
  );

  if (directScore >= 0) {
    return directScore;
  }

  const queryTokens = splitFuzzySearchTokens(normalizedQuery);
  const valueTokens = splitFuzzySearchTokens(combinedValue);

  if (queryTokens.length === 0 || valueTokens.length === 0) {
    return -1;
  }

  let tokenScore = 0;

  for (const queryToken of queryTokens) {
    const bestTokenScore = bestFuzzyTextScore(valueTokens, queryToken);

    if (bestTokenScore < 0) {
      return -1;
    }

    tokenScore += bestTokenScore;
  }

  return 40 + tokenScore;
}

function filterTailoredResumesForArchiveSearch(input: {
  query: string | null | undefined;
  resumes: readonly TailoredResumeSummary[];
}) {
  if (!normalizeFuzzySearchText(input.query)) {
    return [...input.resumes];
  }

  return input.resumes
    .map((resume, index) => ({
      index,
      resume,
      score: scoreTailoredResumeArchiveSearch({
        query: input.query,
        resume,
      }),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.resume);
}

type SettingsSpareBulletEditDraft = {
  id: string;
  quote: string;
  replacesQuote: string;
  resumeExperienceId: string;
  skillNames: string;
};

type SettingsSpareBulletQuoteFieldProps = {
  disabled: boolean;
  fieldClassName?: string;
  measureLineCount: (
    input: SettingsSpareBulletLineMeasurementInput,
  ) => Promise<TailorResumeSpareBulletLineMeasurement | null>;
  onChange: (value: string) => void;
  placeholder?: string;
  resumeExperienceId: string;
  value: string;
};

type SettingsSpareBulletLineMeasurementInput = {
  quote: string;
  resumeExperienceId: string;
};

type SettingsSpareBulletLineMeasurementCacheValue =
  | Promise<TailorResumeSpareBulletLineMeasurement | null>
  | TailorResumeSpareBulletLineMeasurement
  | null;

type PersonalInfoState =
  | { personalInfo: null; status: "idle" | "loading" }
  | { personalInfo: PersonalInfoSummary; status: "ready" }
  | { error: string; personalInfo: null; status: "error" };

type ResumePreviewState =
  | { objectUrl: null; status: "idle" | "loading" }
  | { objectUrl: string; status: "ready" }
  | { error: string; objectUrl: null; status: "error" };

type TailoredResumeReviewState =
  | { record: null; status: "idle" }
  | { record: TailoredResumeReviewRecord | null; status: "loading" }
  | { record: TailoredResumeReviewRecord; status: "ready" }
  | {
      error: string;
      record: TailoredResumeReviewRecord | null;
      status: "error";
    };

type PendingPersonalDelete =
  | { applicationId: string; kind: "application" }
  | { kind: "tailoredResume"; tailoredResumeId: string };

type PersonalDeleteImpact = {
  applicationCount: number;
  applicationIds: string[];
  tailoredResumeCount: number;
  tailoredResumeIds: string[];
  totalCount: number;
};

type ActiveTailorRunCard = {
  applicationId: string | null;
  blockingTechnologies: TailoredResumeEmphasizedTechnology[];
  deleteTarget: TailorRunDeleteTarget | null;
  detail: string | null;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  existingTailoringId: string | null;
  elapsedTimeEndTime: number | null;
  id: string;
  interviewStatus: "deciding" | "pending" | "ready" | null;
  isCurrentPage: boolean;
  message: string | null;
  pageKey: string | null;
  sortTime: number;
  statusDisplayState: "error" | "loading" | "ready" | "warning";
  startedAtTime: number;
  suppressedTailoredResumeId: string | null;
  step: TailorRunProgressStep;
  stepTimings: TailorResumeGenerationStepTiming[];
  title: string;
  url: string | null;
};

type FloatingMenuPosition = {
  left: number;
  top: number;
};

const TAILOR_RESUME_SHORTCUT_KEYS = ["⌘", "⇧", "S"] as const;
const TAILOR_RESUME_SHORTCUT_ARIA_LABEL = "Command Shift S";
const STALE_TAILORING_RUN_MAX_AGE_MS = 1000 * 60 * 2;
const AUTH_RECONNECT_INTERVAL_MS = 1000;
const SYNC_STATE_POLL_INTERVAL_MS = 500;
const TAILOR_RUN_DETAIL_WIDE_LAYOUT_QUERY = "(min-width: 650px)";
const FLOATING_MENU_VIEWPORT_PADDING = 12;
const TAILORED_RESUME_MENU_FALLBACK_WIDTH = 176;
const TAILORED_RESUME_MENU_FALLBACK_HEIGHT = 260;
const EMPTY_TAILORED_PREVIEW_HIGHLIGHT_QUERIES: TailoredResumeInteractivePreviewQuery[] =
  [];
const DEFAULT_STEP_2_EXPERIENCE_CHAT_PROMPT =
  "Help me craft resume experiences for the following technologies. Be optimistic about what my experience may be and I can correct you if it's too much. Create FAANG level experiences for each resume point, and give 3 sample bullets for each of the following experiences. Suggest them *in the context of my actual resume*, and for each bullet say which of my previous experiences you would put them under. List your bullets in letter order A. B. C., and be ready for me to answer like '[keyword] A' which should tell you to (1) iterate on this one by checking that it's not malformed (2) save it as a new resume bullet for me if you didn't have to change the string, or give a version that isn't malformed and ask me if you can add it.";

function readDebugPreviewFlag(name: string) {
  if (
    typeof window === "undefined" ||
    window.location.protocol === "chrome-extension:"
  ) {
    return false;
  }

  const value = new URLSearchParams(window.location.search).get(name);
  return value === "1" || value === "true" || value === "on" || value === "open";
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

async function fetchSnapshot() {
  const tab = await getActiveTab();
  const tabId = tab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  return collectPageContextFromTab(tabId, "JOB_HELPER_CAPTURE_PAGE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readUserMarkdownFromTailorResumePayload(
  payload: unknown,
): UserMarkdownSummary | null {
  if (
    !isRecord(payload) ||
    (!("userMemory" in payload) &&
      !("userMarkdown" in payload) &&
      !("nonTechnologyNames" in payload))
  ) {
    return null;
  }

  return readPersonalInfoPayload(payload).userMarkdown;
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

function readErrorMessage(value: unknown, fallbackMessage: string) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallbackMessage;
}

function shouldIgnoreSyncRefreshError(error: unknown) {
  const message =
    error instanceof Error ? error.message.trim().toLowerCase() : "";

  return (
    message === "failed to fetch" ||
    message === "load failed" ||
    message === "networkerror when attempting to fetch resource."
  );
}

function assertRuntimeResponseOk(value: unknown, fallbackMessage: string) {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(readErrorMessage(value, fallbackMessage));
  }
}

function readAuthResponse(value: unknown): AuthState {
  if (!isRecord(value) || value.ok !== true) {
    return {
      error: readErrorMessage(value, "Could not connect to Job Helper."),
      status: "error",
    };
  }

  if (value.status === "signedIn") {
    const session = readAuthSession(value.session);

    if (session) {
      return { session, status: "signedIn" };
    }
  }

  return { status: "signedOut" };
}

function getSnapshotErrorMessage(error: unknown) {
  return formatPageContextErrorMessage(error);
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

function getUserInitial(user: JobHelperAuthUser) {
  return (user.name || user.email || "J").trim().slice(0, 1).toUpperCase();
}

function formatTailoredResumeDate(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const today = new Date();
  const isSameDay = date.toDateString() === today.toDateString();

  return date.toLocaleString(undefined, {
    day: isSameDay ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: isSameDay ? undefined : "short",
  });
}

function formatApplicationStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function buildOriginalResumePreviewUrl(pdfUpdatedAt: string | null) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);

  if (pdfUpdatedAt) {
    url.searchParams.set("updatedAt", pdfUpdatedAt);
  }

  return url.toString();
}

async function persistPersonalInfoCacheEntry(
  personalInfo: PersonalInfoSummary,
  userId: string,
) {
  try {
    await chrome.storage.local.set({
      [PERSONAL_INFO_CACHE_STORAGE_KEY]: buildPersonalInfoCacheEntry({
        personalInfo,
        userId,
      }),
    });
  } catch (error) {
    console.error("Could not persist the shared personal info cache.", error);
  }
}

const STOPPED_TAILORING_STORAGE_KEY = "jobHelperStoppedTailoringRuns";
const STOPPED_TAILORING_TOMBSTONE_TTL_MS = 30_000;

type StoppedTailoringRecord = {
  createdAt: string;
  existingTailoringId: string | null;
  expiresAt: string;
  jobUrl: string | null;
  pageKey: string | null;
};

type StoppedTailoringRegistry = Record<string, StoppedTailoringRecord>;

function buildStoppedTailoringRecordKey(input: {
  existingTailoringId?: string | null;
  jobUrl?: string | null;
  pageKey?: string | null;
}) {
  const existingTailoringId = input.existingTailoringId?.trim();

  if (existingTailoringId) {
    return `id:${existingTailoringId}`;
  }

  const pageKey =
    buildTailorRunRegistryKey(input.pageKey) ??
    buildTailorRunRegistryKey(input.jobUrl);

  return pageKey ? `url:${pageKey}` : null;
}

function buildStoppedTailoringRecord(input: {
  existingTailoringId?: string | null;
  jobUrl?: string | null;
  pageKey?: string | null;
}) {
  const createdAt = new Date();
  return {
    createdAt: createdAt.toISOString(),
    existingTailoringId: input.existingTailoringId?.trim() || null,
    expiresAt: new Date(
      createdAt.getTime() + STOPPED_TAILORING_TOMBSTONE_TTL_MS,
    ).toISOString(),
    jobUrl: input.jobUrl?.trim() || null,
    pageKey: input.pageKey?.trim() || null,
  } satisfies StoppedTailoringRecord;
}

function readStoppedTailoringRecord(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : "";

  if (!createdAt || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    return null;
  }

  return {
    createdAt,
    existingTailoringId:
      typeof value.existingTailoringId === "string"
        ? value.existingTailoringId
        : null,
    expiresAt,
    jobUrl: typeof value.jobUrl === "string" ? value.jobUrl : null,
    pageKey: typeof value.pageKey === "string" ? value.pageKey : null,
  } satisfies StoppedTailoringRecord;
}

function readStoppedTailoringRegistry(value: unknown) {
  if (!isRecord(value)) {
    return {
      changed: false,
      registry: {} as StoppedTailoringRegistry,
    };
  }

  const nowTime = Date.now();
  const registry: StoppedTailoringRegistry = {};
  let changed = false;

  for (const [rawKey, candidate] of Object.entries(value)) {
    const record = readStoppedTailoringRecord(candidate);

    if (!record || Date.parse(record.expiresAt) <= nowTime) {
      changed = true;
      continue;
    }

    const recordKey = buildStoppedTailoringRecordKey(record) ?? rawKey;
    registry[recordKey] = record;

    if (recordKey !== rawKey) {
      changed = true;
    }
  }

  return {
    changed,
    registry,
  };
}

function stoppedTailoringMatchesExistingTailoring(
  record: StoppedTailoringRecord,
  existingTailoring: TailorResumeExistingTailoringState,
) {
  if (record.existingTailoringId) {
    return existingTailoring.id === record.existingTailoringId;
  }

  return (
    sameTailoringJobUrl(record.jobUrl, existingTailoring.jobUrl) ||
    sameTailoringJobUrl(record.pageKey, existingTailoring.jobUrl)
  );
}

function stoppedTailoringMatchesInterview(
  record: StoppedTailoringRecord,
  interview: TailorResumePendingInterviewSummary,
) {
  if (
    record.existingTailoringId &&
    interview.tailorResumeRunId === record.existingTailoringId
  ) {
    return true;
  }

  if (record.existingTailoringId) {
    return false;
  }

  return (
    sameTailoringJobUrl(record.jobUrl, interview.jobUrl) ||
    sameTailoringJobUrl(record.pageKey, interview.jobUrl)
  );
}

function removeStoppedTailoringsFromPersonalInfo(
  personalInfo: PersonalInfoSummary,
  stoppedTailoringsByKey: StoppedTailoringRegistry,
) {
  const stoppedTailorings = Object.values(stoppedTailoringsByKey);

  if (stoppedTailorings.length === 0) {
    return personalInfo;
  }

  const activeTailorings = personalInfo.activeTailorings.filter(
    (activeTailoring) =>
      !stoppedTailorings.some((record) =>
        stoppedTailoringMatchesExistingTailoring(record, activeTailoring),
      ),
  );
  const tailoringInterviews = personalInfo.tailoringInterviews.filter(
    (interview) =>
      !stoppedTailorings.some((record) =>
        stoppedTailoringMatchesInterview(record, interview),
      ),
  );
  const activeTailoring = activeTailorings[0] ?? null;
  const tailoringInterview =
    personalInfo.tailoringInterview &&
    tailoringInterviews.some(
      (interview) => interview.id === personalInfo.tailoringInterview?.id,
    )
      ? personalInfo.tailoringInterview
      : null;

  if (
    activeTailorings.length === personalInfo.activeTailorings.length &&
    tailoringInterviews.length === personalInfo.tailoringInterviews.length &&
    activeTailoring === personalInfo.activeTailoring &&
    tailoringInterview === personalInfo.tailoringInterview
  ) {
    return personalInfo;
  }

  return {
    ...personalInfo,
    activeTailoring,
    activeTailorings,
    tailoringInterview,
    tailoringInterviews,
  } satisfies PersonalInfoSummary;
}

function buildTailoredResumePreviewUrl(input: {
  highlights?: boolean;
  pdfUpdatedAt?: string | null;
  tailoredResumeId: string;
}) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);
  url.searchParams.set("tailoredResumeId", input.tailoredResumeId);

  if (input.highlights) {
    url.searchParams.set("highlights", "true");
  }

  if (input.pdfUpdatedAt) {
    url.searchParams.set("updatedAt", input.pdfUpdatedAt);
  }

  return url.toString();
}

function readTailorResumePayloadError(value: unknown, fallbackMessage: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim()
    ? value.error
    : fallbackMessage;
}

function readTailorResumeSpareBulletLineMeasurement(
  value: unknown,
): TailorResumeSpareBulletLineMeasurement | null {
  if (!isRecord(value)) {
    return null;
  }

  const lineCount = typeof value.lineCount === "number" ? value.lineCount : 0;
  const pageCount = typeof value.pageCount === "number" ? value.pageCount : 0;
  const targetSegmentId =
    typeof value.targetSegmentId === "string" ? value.targetSegmentId : "";

  if (!Number.isFinite(lineCount) || lineCount <= 0 || !targetSegmentId) {
    return null;
  }

  return {
    lastLineFillRatio:
      typeof value.lastLineFillRatio === "number" &&
      Number.isFinite(value.lastLineFillRatio)
        ? value.lastLineFillRatio
        : null,
    lineCount,
    malformed: value.malformed === true,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 0,
    targetSegmentId,
  };
}

function readStringPayloadValue(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function payloadIncludesTailoredResumeSummaries(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return true;
  }

  if (!isRecord(payload)) {
    return false;
  }

  if (Array.isArray(payload.tailoredResumes)) {
    return true;
  }

  if (
    isRecord(payload.profile) &&
    Array.isArray(payload.profile.tailoredResumes)
  ) {
    return true;
  }

  if (isRecord(payload.personalInfo)) {
    return payloadIncludesTailoredResumeSummaries(payload.personalInfo);
  }

  return false;
}

function isMissingTailoredResumeErrorMessage(message: string) {
  const normalizedMessage = message.trim().toLowerCase();

  return (
    normalizedMessage.includes("tailored resume") &&
    normalizedMessage.includes("could not be found")
  );
}

function isInactiveTailoringErrorMessage(message: string) {
  const normalizedMessage = message.trim().toLowerCase();

  return (
    normalizedMessage.includes("no longer active") ||
    normalizedMessage.includes("already stopped") ||
    normalizedMessage.includes("no active tailoring")
  );
}

function resolveTailoredResumeFromPayload(payload: unknown) {
  const tailoredResumeId = readStringPayloadValue(payload, "tailoredResumeId");
  const tailoredResumes = readTailoredResumeSummaries(payload);

  if (tailoredResumeId) {
    return (
      tailoredResumes.find(
        (tailoredResume) => tailoredResume.id === tailoredResumeId,
      ) ?? null
    );
  }

  return tailoredResumes[0] ?? null;
}

function resolveTailoredResumeReviewFromPayload(payload: unknown) {
  const tailoredResumeId = readStringPayloadValue(payload, "tailoredResumeId");
  return resolveTailoredResumeReviewRecordFromPayload(payload, tailoredResumeId);
}

function buildTailoringJobLabel(input: {
  companyName: string | null;
  positionTitle: string | null;
}) {
  const positionTitle = input.positionTitle?.trim();
  const companyName = input.companyName?.trim();

  if (positionTitle && companyName) {
    return `${positionTitle} at ${companyName}`;
  }

  return positionTitle || companyName || "this role";
}

function buildTailoringInterviewHeading(input: {
  companyName: string | null;
  fallbackTitle?: string | null;
  positionTitle: string | null;
}) {
  const companyName = input.companyName?.trim();
  const fallbackTitle = input.fallbackTitle?.trim();
  const positionTitle = input.positionTitle?.trim();

  if (companyName && positionTitle) {
    return `${companyName} — ${positionTitle}`;
  }

  return companyName || positionTitle || fallbackTitle || "Resume questions";
}

function buildExistingTailoringTitle(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  if (existingTailoring.kind === "completed") {
    return existingTailoring.displayName;
  }

  return buildTailoringJobLabel({
    companyName:
      existingTailoring.kind === "pending_interview"
        ? existingTailoring.companyName
        : null,
    positionTitle:
      existingTailoring.kind === "pending_interview"
        ? existingTailoring.positionTitle
        : null,
  });
}

function buildLiveTailorResumeStatusDetail(
  step: TailorResumeGenerationStepSummary | null,
) {
  return step?.detail?.trim() || null;
}

function buildTailorInterviewPreview(
  message: TailorResumeConversationMessage | null,
) {
  const text = message?.text.replace(/\s+/g, " ").trim() || "";

  if (!text) {
    return null;
  }

  return text.length > 220 ? `${text.slice(0, 217).trimEnd()}...` : text;
}

function buildTailoringRunRecord(input: {
  applicationId?: string | null;
  capturedAt?: string;
  companyName: string | null;
  failureKind?: TailorResumeRunRecord["failureKind"];
  generationStep?: TailorResumeGenerationStepSummary | null;
  generationStepTimings?: TailorResumeGenerationStepTiming[];
  jobIdentifier?: string | null;
  message: string;
  pageContext: JobPageContext | null;
  pageTitle?: string | null;
  pageUrl?: string | null;
  positionTitle: string | null;
  status: TailorResumeRunRecord["status"];
  suppressedTailoredResumeId?: string | null;
  tailoredResumeError?: string | null;
  tailoredResumeId?: string | null;
}) {
  const pageApplicationContext = input.pageContext
    ? buildTailorResumeApplicationContext(input.pageContext)
    : null;
  const companyName =
    input.companyName?.trim() || pageApplicationContext?.companyName || null;
  const positionTitle =
    input.positionTitle?.trim() || pageApplicationContext?.jobTitle || null;

  return {
    applicationId: input.applicationId?.trim() || null,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    companyName,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    failureKind: input.failureKind ?? null,
    generationStep: input.generationStep ?? null,
    generationStepTimings: input.generationStepTimings ?? [],
    jobIdentifier: input.jobIdentifier || null,
    message: input.message,
    pageTitle: input.pageContext?.title || input.pageTitle?.trim() || null,
    pageUrl: input.pageContext?.url || input.pageUrl?.trim() || null,
    positionTitle,
    status: input.status,
    suppressedTailoredResumeId: input.suppressedTailoredResumeId?.trim() || null,
    tailoredResumeError: input.tailoredResumeError ?? null,
    tailoredResumeId: input.tailoredResumeId ?? null,
  } satisfies TailorResumeRunRecord;
}

function buildTailorInterviewFailureStep(input: {
  message: string;
  timings: TailorResumeGenerationStepTiming[];
}): TailorResumeGenerationStepSummary {
  const lastTiming = input.timings[input.timings.length - 1];

  if (lastTiming) {
    return {
      attempt: lastTiming.attempt,
      blockingTechnologies: lastTiming.blockingTechnologies,
      detail: input.message,
      durationMs: lastTiming.durationMs,
      emphasizedTechnologies: lastTiming.emphasizedTechnologies,
      retrying: false,
      status: "failed",
      stepCount: lastTiming.stepCount,
      stepNumber: lastTiming.stepNumber,
      summary: lastTiming.summary,
    };
  }

  return {
    attempt: null,
    detail: input.message,
    durationMs: 0,
    retrying: false,
    status: "failed",
    stepCount: 5,
    stepNumber: 2,
    summary: "Clarify missing details",
  };
}

function isTransientTailoringRun(run: TailorResumeRunRecord | null) {
  return run?.status === "running" || run?.status === "needs_input";
}

function isLocalTailoringRunShadowedByServerState(input: {
  activeTailorings: TailorResumeExistingTailoringState[];
  run: TailorResumeRunRecord | null;
}) {
  const run = input.run;

  if (!run || run.status !== "needs_input") {
    return false;
  }

  return input.activeTailorings.some(
    (activeTailoring) =>
      activeTailoring.kind !== "completed" &&
      ((run.applicationId &&
        activeTailoring.applicationId === run.applicationId) ||
        sameTailoringJobUrl(activeTailoring.jobUrl, run.pageUrl)),
  );
}

function isStaleTailoringRun(run: TailorResumeRunRecord | null) {
  if (!isTransientTailoringRun(run)) {
    return false;
  }

  if (!run) {
    return false;
  }

  const capturedAt = Date.parse(run.capturedAt);

  if (!Number.isFinite(capturedAt)) {
    return true;
  }

  return Date.now() - capturedAt > STALE_TAILORING_RUN_MAX_AGE_MS;
}

function isPageCaptureFailureRun(run: TailorResumeRunRecord | null) {
  if (!run || run.status !== "error") {
    return false;
  }

  return (
    run.failureKind === "page_capture" ||
    run.message === PAGE_CONTEXT_UNAVAILABLE_MESSAGE ||
    isPageContextConnectionError(run.message)
  );
}

function sameTailoringJobUrl(left: string | null, right: string | null) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function mergeTailoringRunTimingHistory(
  nextRun: TailorResumeRunRecord | null,
  previousRun: TailorResumeRunRecord | null,
) {
  if (!nextRun || !previousRun) {
    return nextRun;
  }

  if ((previousRun.generationStepTimings ?? []).length === 0) {
    return nextRun;
  }

  return {
    ...nextRun,
    generationStepTimings: mergeTailorResumeGenerationStepTimingHistory({
      observedAt: new Date().toISOString(),
      previousTimings: previousRun.generationStepTimings ?? [],
      step: nextRun.generationStep ?? null,
      timings: nextRun.generationStepTimings ?? [],
    }),
  } satisfies TailorResumeRunRecord;
}

function resolveTailoredResumeByComparableUrl(input: {
  candidates: Array<string | null | undefined>;
  tailoredResumes: TailoredResumeSummary[];
}) {
  const comparableCandidates = input.candidates
    .map((candidate) => normalizeComparableUrl(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (comparableCandidates.length === 0) {
    return null;
  }

  return (
    input.tailoredResumes.find((tailoredResume) => {
      const comparableTailoredResumeUrl = normalizeComparableUrl(
        tailoredResume.jobUrl,
      );

      return Boolean(
        comparableTailoredResumeUrl &&
          comparableCandidates.includes(comparableTailoredResumeUrl),
      );
    }) ?? null
  );
}

function uniqueTailoredResumeSummaries(records: TailoredResumeSummary[]) {
  const recordById = new Map<string, TailoredResumeSummary>();

  for (const record of records) {
    recordById.set(record.id, record);
  }

  return [...recordById.values()];
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  ];
}

async function requestHideTailoredResumeBadgesForUrls(
  values: Array<string | null | undefined>,
) {
  const jobUrls = uniqueNonEmptyStrings(values);

  if (jobUrls.length === 0) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      payload: { jobUrls },
      type: "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE_FOR_URL",
    });
  } catch (error) {
    console.error("Could not hide the Tailor Resume page popup.", error);
  }
}

function buildRetryTailorRunRecord(input: {
  applicationId?: string | null;
  companyName?: string | null;
  jobIdentifier?: string | null;
  pageContext?: JobPageContext | null;
  pageTitle?: string | null;
  pageUrl: string;
  positionTitle?: string | null;
  suppressedTailoredResumeId?: string | null;
}) {
  const capturedAt = new Date().toISOString();

  return buildTailoringRunRecord({
    applicationId: input.applicationId,
    capturedAt,
    companyName: input.companyName ?? null,
    generationStep: {
      attempt: 1,
      blockingTechnologies: [],
      detail: "Reloading the job page and starting a fresh tailoring run.",
      durationMs: 0,
      emphasizedTechnologies: [],
      retrying: false,
      status: "running",
      stepCount: 5,
      stepNumber: 1,
      summary: "Reload job keywords",
    },
    generationStepTimings: [],
    jobIdentifier: input.jobIdentifier,
    message: buildLiveTailorResumeStatusMessage(
      null,
      "Reloading keywords and restarting tailoring...",
    ),
    pageContext: input.pageContext ?? null,
    pageTitle: input.pageTitle,
    pageUrl: input.pageUrl,
    positionTitle: input.positionTitle ?? null,
    status: "running",
    suppressedTailoredResumeId: input.suppressedTailoredResumeId,
  });
}

function findLinkedApplicationForTailoredResume(
  record: TailoredResumeSummary,
  applications: TrackedApplicationSummary[],
) {
  if (record.applicationId) {
    const linkedApplication =
      applications.find((application) => application.id === record.applicationId) ??
      null;

    return {
      application: linkedApplication,
      applicationId: record.applicationId,
      jobUrl: linkedApplication?.jobUrl ?? record.jobUrl,
    };
  }

  const normalizedJobUrl = normalizeComparableUrl(record.jobUrl);

  if (!normalizedJobUrl) {
    return null;
  }

  const linkedApplication =
    applications.find(
      (application) => normalizeComparableUrl(application.jobUrl) === normalizedJobUrl,
    ) ?? null;

  if (!linkedApplication) {
    return null;
  }

  return {
    application: linkedApplication,
    applicationId: linkedApplication.id,
    jobUrl: linkedApplication.jobUrl,
  };
}

function findLinkedTailoredResumesForApplication(
  input: {
    applicationId: string;
    jobUrl: string | null;
  },
  tailoredResumes: TailoredResumeSummary[],
) {
  const normalizedJobUrl = normalizeComparableUrl(input.jobUrl);

  return tailoredResumes.filter((record) => {
    if (record.applicationId) {
      return record.applicationId === input.applicationId;
    }

    return Boolean(
      normalizedJobUrl &&
        normalizeComparableUrl(record.jobUrl) === normalizedJobUrl,
    );
  });
}

function formatDeleteImpactSummary(impact: PersonalDeleteImpact) {
  const parts: string[] = [];

  if (impact.applicationCount > 0) {
    parts.push(
      `${impact.applicationCount} application${
        impact.applicationCount === 1 ? "" : "s"
      }`,
    );
  }

  if (impact.tailoredResumeCount > 0) {
    parts.push(
      `${impact.tailoredResumeCount} tailored resume${
        impact.tailoredResumeCount === 1 ? "" : "s"
      }`,
    );
  }

  if (parts.length === 0) {
    return "this item";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]} and ${parts[1]}`;
}

function buildPendingPersonalDeleteImpact(input: {
  applications: TrackedApplicationSummary[];
  pendingDelete: PendingPersonalDelete | null;
  tailoredResumes: TailoredResumeSummary[];
}): PersonalDeleteImpact | null {
  const pendingDelete = input.pendingDelete;

  if (!pendingDelete) {
    return null;
  }

  if (pendingDelete.kind === "application") {
    const application =
      input.applications.find(
        (record) => record.id === pendingDelete.applicationId,
      ) ?? null;

    if (!application) {
      return null;
    }

    const linkedTailoredResumes = uniqueTailoredResumeSummaries(
      findLinkedTailoredResumesForApplication(
        {
          applicationId: application.id,
          jobUrl: application.jobUrl,
        },
        input.tailoredResumes,
      ),
    );

    return {
      applicationCount: 1,
      applicationIds: [application.id],
      tailoredResumeCount: linkedTailoredResumes.length,
      tailoredResumeIds: linkedTailoredResumes.map((record) => record.id),
      totalCount: 1 + linkedTailoredResumes.length,
    };
  }

  const tailoredResume =
    input.tailoredResumes.find(
      (record) => record.id === pendingDelete.tailoredResumeId,
    ) ?? null;

  if (!tailoredResume) {
    return null;
  }

  const linkedApplication = findLinkedApplicationForTailoredResume(
    tailoredResume,
    input.applications,
  );
  const linkedTailoredResumes = uniqueTailoredResumeSummaries(
    linkedApplication
      ? [
          tailoredResume,
          ...findLinkedTailoredResumesForApplication(
            {
              applicationId: linkedApplication.applicationId,
              jobUrl: linkedApplication.jobUrl,
            },
            input.tailoredResumes,
          ),
        ]
      : [tailoredResume],
  );

  return {
    applicationCount: linkedApplication ? 1 : 0,
    applicationIds: linkedApplication ? [linkedApplication.applicationId] : [],
    tailoredResumeCount: linkedTailoredResumes.length,
    tailoredResumeIds: linkedTailoredResumes.map((record) => record.id),
    totalCount:
      linkedTailoredResumes.length + (linkedApplication ? 1 : 0),
  };
}

function removeDeletedItemsFromPersonalInfo(input: {
  impact: PersonalDeleteImpact;
  personalInfo: PersonalInfoSummary;
}): PersonalInfoSummary {
  const applicationIds = new Set(input.impact.applicationIds);
  const tailoredResumeIds = new Set(input.impact.tailoredResumeIds);

  return {
    ...input.personalInfo,
    applications: input.personalInfo.applications.filter(
      (application) => !applicationIds.has(application.id),
    ),
    tailoredResumes: input.personalInfo.tailoredResumes.filter(
      (tailoredResume) => !tailoredResumeIds.has(tailoredResume.id),
    ),
  };
}

function readDeletedPersonalInfoJobUrls(input: {
  impact: PersonalDeleteImpact;
  personalInfo: PersonalInfoSummary;
}) {
  const applicationIds = new Set(input.impact.applicationIds);
  const tailoredResumeIds = new Set(input.impact.tailoredResumeIds);

  return uniqueNonEmptyStrings([
    ...input.personalInfo.applications
      .filter((application) => applicationIds.has(application.id))
      .map((application) => application.jobUrl),
    ...input.personalInfo.tailoredResumes
      .filter((tailoredResume) => tailoredResumeIds.has(tailoredResume.id))
      .map((tailoredResume) => tailoredResume.jobUrl),
  ]);
}

function removeTailorRunArtifactsFromPersonalInfo(input: {
  jobUrl: string;
  personalInfo: PersonalInfoSummary;
  tailoredResumeId: string;
  tailorRunId: string;
}): PersonalInfoSummary {
  const matchesActiveTailoring = (
    activeTailoring: TailorResumeExistingTailoringState,
  ) =>
    (input.tailoredResumeId &&
      activeTailoring.kind === "completed" &&
      activeTailoring.tailoredResumeId === input.tailoredResumeId) ||
    (input.tailorRunId && activeTailoring.id === input.tailorRunId) ||
    (input.jobUrl && sameTailoringJobUrl(activeTailoring.jobUrl, input.jobUrl));
  const matchesTailoringInterview = (
    tailoringInterview: TailorResumePendingInterviewSummary,
  ) =>
    (input.tailorRunId &&
      tailoringInterview.tailorResumeRunId === input.tailorRunId) ||
    (input.jobUrl &&
      sameTailoringJobUrl(tailoringInterview.jobUrl, input.jobUrl));
  const matchesTailoredResume = (tailoredResume: TailoredResumeSummary) =>
    (input.tailoredResumeId && tailoredResume.id === input.tailoredResumeId) ||
    (input.jobUrl && sameTailoringJobUrl(tailoredResume.jobUrl, input.jobUrl));
  const matchesApplication = (application: TrackedApplicationSummary) =>
    input.jobUrl && sameTailoringJobUrl(application.jobUrl, input.jobUrl);
  const removedApplicationCount = input.personalInfo.applications.filter(
    matchesApplication,
  ).length;

  return {
    ...input.personalInfo,
    activeTailoring:
      input.personalInfo.activeTailoring &&
      matchesActiveTailoring(input.personalInfo.activeTailoring)
        ? null
        : input.personalInfo.activeTailoring,
    activeTailorings: input.personalInfo.activeTailorings.filter(
      (activeTailoring) => !matchesActiveTailoring(activeTailoring),
    ),
    applicationCount: Math.max(
      0,
      input.personalInfo.applicationCount - removedApplicationCount,
    ),
    applications: input.personalInfo.applications.filter(
      (application) => !matchesApplication(application),
    ),
    tailoredResumes: input.personalInfo.tailoredResumes.filter(
      (tailoredResume) => !matchesTailoredResume(tailoredResume),
    ),
    tailoringInterview:
      input.personalInfo.tailoringInterview &&
      matchesTailoringInterview(input.personalInfo.tailoringInterview)
        ? null
        : input.personalInfo.tailoringInterview,
    tailoringInterviews: input.personalInfo.tailoringInterviews.filter(
      (tailoringInterview) => !matchesTailoringInterview(tailoringInterview),
    ),
  };
}

function removeInFlightTailorRunFromPersonalInfo(input: {
  jobUrl: string;
  personalInfo: PersonalInfoSummary;
  tailorRunId: string;
}) {
  const matchesActiveTailoring = (
    activeTailoring: TailorResumeExistingTailoringState,
  ) =>
    activeTailoring.kind !== "completed" &&
    ((input.tailorRunId && activeTailoring.id === input.tailorRunId) ||
      (input.jobUrl && sameTailoringJobUrl(activeTailoring.jobUrl, input.jobUrl)));
  const matchesTailoringInterview = (
    tailoringInterview: TailorResumePendingInterviewSummary,
  ) =>
    (input.tailorRunId &&
      tailoringInterview.tailorResumeRunId === input.tailorRunId) ||
    (input.jobUrl &&
      sameTailoringJobUrl(tailoringInterview.jobUrl, input.jobUrl));

  return {
    ...input.personalInfo,
    activeTailoring:
      input.personalInfo.activeTailoring &&
      matchesActiveTailoring(input.personalInfo.activeTailoring)
        ? null
        : input.personalInfo.activeTailoring,
    activeTailorings: input.personalInfo.activeTailorings.filter(
      (activeTailoring) => !matchesActiveTailoring(activeTailoring),
    ),
    tailoringInterview:
      input.personalInfo.tailoringInterview &&
      matchesTailoringInterview(input.personalInfo.tailoringInterview)
        ? null
        : input.personalInfo.tailoringInterview,
    tailoringInterviews: input.personalInfo.tailoringInterviews.filter(
      (tailoringInterview) => !matchesTailoringInterview(tailoringInterview),
    ),
  };
}

function setTailoredResumeArchiveStateInPersonalInfo(input: {
  archived: boolean;
  personalInfo: PersonalInfoSummary;
  tailoredResumeId: string;
  updatedAt: string;
}): PersonalInfoSummary {
  return setTailoredResumesArchiveStateInPersonalInfo({
    archived: input.archived,
    personalInfo: input.personalInfo,
    tailoredResumeIds: [input.tailoredResumeId],
    updatedAt: input.updatedAt,
  });
}

function setTailoredResumesArchiveStateInPersonalInfo(input: {
  archived: boolean;
  personalInfo: PersonalInfoSummary;
  tailoredResumeIds: string[];
  updatedAt: string;
}): PersonalInfoSummary {
  const tailoredResumeIds = new Set(
    input.tailoredResumeIds.map((id) => id.trim()).filter(Boolean),
  );

  if (tailoredResumeIds.size === 0) {
    return input.personalInfo;
  }

  return {
    ...input.personalInfo,
    tailoredResumes: input.personalInfo.tailoredResumes.map((tailoredResume) =>
      tailoredResumeIds.has(tailoredResume.id)
        ? {
            ...tailoredResume,
            archivedAt: input.archived ? input.updatedAt : null,
            updatedAt: input.updatedAt,
          }
        : tailoredResume,
    ),
  };
}

function removeTailoredResumesFromPersonalInfo(input: {
  personalInfo: PersonalInfoSummary;
  tailoredResumeIds: string[];
}): PersonalInfoSummary {
  const tailoredResumeIds = new Set(
    input.tailoredResumeIds.map((id) => id.trim()).filter(Boolean),
  );

  if (tailoredResumeIds.size === 0) {
    return input.personalInfo;
  }

  return {
    ...input.personalInfo,
    tailoredResumes: input.personalInfo.tailoredResumes.filter(
      (tailoredResume) => !tailoredResumeIds.has(tailoredResume.id),
    ),
  };
}

function buildTailoringRunRecordFromExistingTailoring(input: {
  existingTailoring: TailorResumeExistingTailoringState;
  previousRun: TailorResumeRunRecord | null;
}) {
  const reusePreviousPageMetadata = sameTailoringJobUrl(
    input.previousRun?.pageUrl ?? null,
    input.existingTailoring.jobUrl,
  );
  const pageTitle = reusePreviousPageMetadata
    ? input.previousRun?.pageTitle ?? null
    : null;
  const pageUrl = input.existingTailoring.jobUrl ?? input.previousRun?.pageUrl ?? null;
  const jobIdentifier =
    input.existingTailoring.jobIdentifier ??
    (reusePreviousPageMetadata ? input.previousRun?.jobIdentifier ?? null : null);
  const activeCapturedAt =
    reusePreviousPageMetadata && input.previousRun?.capturedAt
      ? input.previousRun.capturedAt
      : input.existingTailoring.createdAt || input.existingTailoring.updatedAt;
  const previousGenerationStepTimings = reusePreviousPageMetadata
    ? input.previousRun?.generationStepTimings ?? []
    : [];

  if (input.existingTailoring.kind === "pending_interview") {
    const interviewStatus = input.existingTailoring.interviewStatus;

    return {
      applicationId: input.existingTailoring.applicationId,
      capturedAt: activeCapturedAt,
      companyName: input.existingTailoring.companyName,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      generationStepTimings: mergeTailorResumeGenerationStepTimingHistory({
        observedAt: input.existingTailoring.updatedAt,
        previousTimings: previousGenerationStepTimings,
        step: null,
        timings: [],
      }),
      jobIdentifier,
      message:
        interviewStatus === "pending"
          ? "Review the classified keywords when you are ready."
          : interviewStatus === "deciding"
            ? "Classifying the job keywords."
            : "Review keywords, then press play in the side panel.",
      pageTitle,
      pageUrl,
      positionTitle: input.existingTailoring.positionTitle,
      status: interviewStatus === "deciding" ? "running" : "needs_input",
      suppressedTailoredResumeId: null,
      tailoredResumeError: null,
      tailoredResumeId: null,
    } satisfies TailorResumeRunRecord;
  }

  if (input.existingTailoring.kind === "completed") {
    return {
      applicationId: input.existingTailoring.applicationId,
      capturedAt: input.existingTailoring.updatedAt,
      companyName: input.existingTailoring.companyName,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      generationStepTimings: [],
      jobIdentifier,
      message: buildCompletedTailoringMessage({
        jobLabel: input.existingTailoring.displayName,
        tailoredResumeError: input.existingTailoring.error,
      }),
      pageTitle,
      pageUrl,
      positionTitle: input.existingTailoring.positionTitle,
      status: input.existingTailoring.error ? "error" : "success",
      suppressedTailoredResumeId: null,
      tailoredResumeError: input.existingTailoring.error,
      tailoredResumeId: input.existingTailoring.tailoredResumeId,
    } satisfies TailorResumeRunRecord;
  }

  const generationStep = input.existingTailoring.lastStep ?? null;
  const generationStepTimings = mergeTailorResumeGenerationStepTimingHistory({
    observedAt: input.existingTailoring.updatedAt,
    previousTimings: previousGenerationStepTimings,
    step: generationStep,
    timings: [],
  });
  const isFailedGeneration = input.existingTailoring.status === "FAILED";

  return {
    applicationId: input.existingTailoring.applicationId,
    capturedAt: activeCapturedAt,
    companyName:
      input.existingTailoring.companyName ??
      (reusePreviousPageMetadata ? input.previousRun?.companyName ?? null : null),
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep,
    generationStepTimings,
    jobIdentifier,
    message: isFailedGeneration
      ? "Failed generation"
      : buildLiveTailorResumeStatusMessage(
          generationStep,
          "Tailoring your resume for this job...",
        ),
    pageTitle,
    pageUrl,
    positionTitle:
      input.existingTailoring.positionTitle ??
      (reusePreviousPageMetadata ? input.previousRun?.positionTitle ?? null : null),
    status: isFailedGeneration ? "error" : "running",
    suppressedTailoredResumeId: null,
    tailoredResumeError: isFailedGeneration ? input.existingTailoring.error : null,
    tailoredResumeId: null,
  } satisfies TailorResumeRunRecord;
}

function isActiveGenerationStepTwoReviewGate(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  if (
    existingTailoring.kind !== "active_generation" ||
    existingTailoring.lastStep?.stepNumber !== 2
  ) {
    return false;
  }

  if (existingTailoring.status === "NEEDS_INPUT") {
    return true;
  }

  const stepSummary = existingTailoring.lastStep.summary.trim().toLowerCase();
  const stepDetail = existingTailoring.lastStep.detail?.trim().toLowerCase() ?? "";

  return (
    stepSummary === "review classified keywords" &&
    (stepDetail.includes("waiting for review") ||
      stepDetail.includes("waiting on") ||
      stepDetail.includes("press play"))
  );
}

function areTailoringRunRecordsEqual(
  left: TailorResumeRunRecord | null,
  right: TailorResumeRunRecord | null,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function areJsonSnapshotsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function areTailorStorageRegistriesEqual<T>(
  left: TailorStorageRegistry<T>,
  right: TailorStorageRegistry<T>,
) {
  return areJsonSnapshotsEqual(left, right);
}

type TailorRunProgressStepStatus =
  | "current"
  | "failed"
  | "pending"
  | "retrying"
  | "skipped"
  | "succeeded";

type TailorRunProgressStep = {
  attempt: number | null;
  label: string;
  shortLabel: string;
  status: TailorRunProgressStepStatus;
  stepNumber: number;
};

const TAILOR_RUN_PROGRESS_STEP_DEFINITIONS = [
  {
    label: "Scrape keywords",
    shortLabel: "Scrape",
    stepNumber: 1,
  },
  {
    label: "Clarify missing details",
    shortLabel: "Clarify",
    stepNumber: 2,
  },
  {
    label: "Plan targeted edits",
    shortLabel: "Plan",
    stepNumber: 3,
  },
  {
    label: "Apply changes and fit page",
    shortLabel: "Edit",
    stepNumber: 4,
  },
] as const;

function createTailorRunProgressSteps(): TailorRunProgressStep[] {
  return TAILOR_RUN_PROGRESS_STEP_DEFINITIONS.map((step) => ({
    attempt: null,
    ...step,
    status: "pending" as const,
  }));
}

function buildCompletedTailorRunProgressSteps() {
  return createTailorRunProgressSteps().map((step) => ({
    ...step,
    status: "succeeded" as const,
  })) satisfies TailorRunProgressStep[];
}

function buildNeedsInputTailorRunProgressSteps() {
  return createTailorRunProgressSteps().map((step) => {
    if (step.stepNumber === 2) {
      return { ...step, status: "current" as const };
    }

    return step;
  }) satisfies TailorRunProgressStep[];
}

function buildTailorRunProgressStepsFromGenerationStep(
  step: TailorResumeGenerationStepSummary | null,
): TailorRunProgressStep[] {
  if (!step) {
    return createTailorRunProgressSteps().map((candidate) =>
      candidate.stepNumber === 1
        ? { ...candidate, status: "current" as const }
        : candidate,
    ) satisfies TailorRunProgressStep[];
  }

  const displayAttempt = readTailorResumeDisplayAttempt(step);
  const activeStepNumber = readTailorResumeDisplayStepNumber(step.stepNumber);

  return createTailorRunProgressSteps().map((candidate) => {
    if (candidate.stepNumber < activeStepNumber) {
      return { ...candidate, status: "succeeded" as const };
    }

    if (candidate.stepNumber > activeStepNumber) {
      return candidate;
    }

    return {
      ...candidate,
      attempt: displayAttempt,
      status:
        step.status === "running"
          ? step.retrying
            ? "retrying"
            : "current"
          : step.status === "failed"
            ? step.retrying
              ? "retrying"
              : "failed"
          : step.status,
    };
  }) satisfies TailorRunProgressStep[];
}

function buildFailedTailorRunProgressSteps(
  step: TailorResumeGenerationStepSummary | null,
): TailorRunProgressStep[] {
  return buildTailorRunProgressStepsFromGenerationStep(
    step
      ? {
          ...step,
          retrying: false,
          status: "failed",
        }
      : {
          attempt: null,
          detail: null,
          durationMs: 0,
          retrying: false,
          status: "failed",
          stepCount: 5,
          stepNumber: 1,
          summary: "Scrape keywords",
        },
  );
}

function readTailorRunProgressSteps(input: {
  captureState: CaptureState;
  existingTailoring: TailorResumeExistingTailoringState | null;
  lastTailoringRun: TailorResumeRunRecord | null;
  tailorGenerationStep: TailorResumeGenerationStepSummary | null;
  tailorInterview: TailorResumePendingInterviewSummary | null;
}): TailorRunProgressStep[] {
  if (input.existingTailoring) {
    if (input.existingTailoring.kind === "completed") {
      return buildCompletedTailorRunProgressSteps();
    }

    if (input.existingTailoring.kind === "pending_interview") {
      return buildNeedsInputTailorRunProgressSteps();
    }

    return buildTailorRunProgressStepsFromGenerationStep(
      input.existingTailoring.lastStep,
    );
  }

  if (input.captureState === "needs_input" || input.tailorInterview) {
    return buildNeedsInputTailorRunProgressSteps();
  }

  if (
    input.captureState === "running" ||
    input.captureState === "finishing" ||
    input.lastTailoringRun?.status === "running"
  ) {
    return buildTailorRunProgressStepsFromGenerationStep(
      input.tailorGenerationStep ?? input.lastTailoringRun?.generationStep ?? null,
    );
  }

  if (
    input.captureState === "sent" ||
    input.lastTailoringRun?.status === "success" ||
    input.lastTailoringRun?.tailoredResumeId
  ) {
    return buildCompletedTailorRunProgressSteps();
  }

  if (
    input.lastTailoringRun?.status === "error" &&
    !isPageCaptureFailureRun(input.lastTailoringRun)
  ) {
    return buildFailedTailorRunProgressSteps(
      input.lastTailoringRun.generationStep ?? null,
    );
  }

  return createTailorRunProgressSteps();
}

function readTailorRunCompactStep(steps: TailorRunProgressStep[]) {
  return (
    steps.find(
      (step) =>
        step.status === "retrying" ||
        step.status === "current" ||
        step.status === "failed",
    ) ??
    [...steps]
      .reverse()
      .find(
        (step) => step.status === "succeeded" || step.status === "skipped",
      ) ??
    steps[0] ??
    null
  );
}

function buildTailorRunCardTitle(input: {
  companyName: string | null;
  pageTitle: string | null;
  positionTitle: string | null;
  url: string | null;
}) {
  const identity = buildTailorRunIdentityDisplay({
    companyName: input.companyName,
    positionTitle: input.positionTitle,
  });

  if (identity?.label) {
    return identity.label;
  }

  const pageTitle = input.pageTitle?.replace(/\s+/g, " ").trim();

  if (pageTitle) {
    return pageTitle;
  }

  return readTailorRunDisplayUrl(input.url) ?? "Tailoring run";
}

function readActiveTailorRunStep(input: {
  captureState: CaptureState;
  existingTailoring: TailorResumeExistingTailoringState | null;
  lastTailoringRun: TailorResumeRunRecord | null;
  tailorGenerationStep: TailorResumeGenerationStepSummary | null;
  tailorInterview: TailorResumePendingInterviewSummary | null;
}) {
  const compactStep = readTailorRunCompactStep(
    readTailorRunProgressSteps(input),
  );

  if (!compactStep || compactStep.status === "pending") {
    const firstStep = createTailorRunProgressSteps()[0];

    return {
      ...firstStep,
      status: "current" as const,
    };
  }

  return compactStep;
}

function readActiveTailorRunSortTime(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildTailorRunStepTimingDisplayInputs(
  timings: TailorResumeGenerationStepTiming[],
) {
  return timings.map((timing) => ({
    attempt: timing.attempt,
    durationMs: timing.durationMs,
    observedAtTime: readActiveTailorRunSortTime(timing.observedAt),
    retrying: timing.retrying,
    status: timing.status,
    stepNumber: timing.stepNumber,
  }));
}

function readLatestTailorRunTimingObservedAtTime(
  timings: TailorResumeGenerationStepTiming[],
) {
  return timings.reduce<number | null>((latestTime, timing) => {
    const observedAtTime = readActiveTailorRunSortTime(timing.observedAt);

    if (!observedAtTime) {
      return latestTime;
    }

    return latestTime === null ? observedAtTime : Math.max(latestTime, observedAtTime);
  }, null);
}

function readTailorRunFrozenStepDurationLabel(input: {
  stepNumber: number;
  stepTimings: TailorResumeGenerationStepTiming[];
}) {
  const matchingTiming = [...input.stepTimings]
    .reverse()
    .find((timing) => timing.stepNumber === input.stepNumber);

  if (!matchingTiming) {
    return null;
  }

  return formatTailorRunDurationMs(matchingTiming.durationMs);
}

function readTailorRunElapsedEndTime(input: {
  isWaiting: boolean;
  startedAtTime: number;
  status: TailorResumeRunRecord["status"];
  stepTimings: TailorResumeGenerationStepTiming[];
}) {
  if (input.status === "running" && !input.isWaiting) {
    return null;
  }

  return readLatestTailorRunTimingObservedAtTime(input.stepTimings) ??
    input.startedAtTime;
}

function readExistingTailoringSortTime(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  const createdAtTimestamp = Date.parse(existingTailoring.createdAt);

  return Number.isFinite(createdAtTimestamp) ? createdAtTimestamp : 0;
}

function buildTailorRunDeleteTarget(input: TailorRunDeleteTarget) {
  return input.jobUrl || input.tailoredResumeId || input.tailorRunId ? input : null;
}

function readTailorRunKeywordTechnologiesFromRun(
  run: TailorResumeRunRecord,
) {
  return readTailorRunKeywordTechnologies(run);
}

function readTailorRunKeywordTechnologiesFromExistingTailoring(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  if (existingTailoring.kind === "pending_interview") {
    return existingTailoring.emphasizedTechnologies;
  }

  if (existingTailoring.kind === "active_generation") {
    return existingTailoring.emphasizedTechnologies?.length
      ? existingTailoring.emphasizedTechnologies
      : existingTailoring.lastStep?.emphasizedTechnologies ?? [];
  }

  return existingTailoring.emphasizedTechnologies;
}

function readTailorRunBlockingTechnologiesFromRun(
  run: Pick<TailorResumeRunRecord, "generationStep" | "generationStepTimings">,
) {
  if (run.generationStep?.blockingTechnologies) {
    return run.generationStep.blockingTechnologies;
  }

  const stepTimings = run.generationStepTimings ?? [];

  for (let index = stepTimings.length - 1; index >= 0; index -= 1) {
    const blockers = stepTimings[index]?.blockingTechnologies;

    if (blockers) {
      return blockers;
    }
  }

  return [];
}

function isTailoringRunStepTwoReviewGate(run: TailorResumeRunRecord) {
  if (run.generationStep?.stepNumber !== 2) {
    return false;
  }

  if (run.status === "needs_input") {
    return true;
  }

  const stepSummary = run.generationStep.summary.trim().toLowerCase();
  const stepDetail = run.generationStep.detail?.trim().toLowerCase() ?? "";

  return (
    stepSummary === "review classified keywords" &&
    (stepDetail.includes("waiting for review") ||
      stepDetail.includes("waiting on") ||
      stepDetail.includes("press play"))
  );
}

function readTailorRunBlockingTechnologiesFromExistingTailoring(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  if (existingTailoring.kind === "pending_interview") {
    return existingTailoring.blockingTechnologies;
  }

  if (existingTailoring.kind === "active_generation") {
    return existingTailoring.lastStep?.blockingTechnologies ?? [];
  }

  return [];
}

function buildResumeExperienceCraftingPromptForCard(input: {
  basePrompt: string | null | undefined;
  card: ActiveTailorRunCard;
}) {
  const skillNames = [
    ...new Set(
      input.card.blockingTechnologies
        .filter(
          (technology) =>
            technology.classification === "skills_section" &&
            technology.name.trim().length > 0,
        )
        .map((technology) => technology.name.trim()),
    ),
  ];
  const basePrompt =
    input.basePrompt?.trim() || DEFAULT_STEP_2_EXPERIENCE_CHAT_PROMPT;

  return [
    basePrompt,
    skillNames.length > 0 ? `Technologies: ${skillNames.join(", ")}.` : "",
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}

function buildActiveTailorRunKeywordBadgeKey(card: ActiveTailorRunCard) {
  return `tailor-run-keywords:${
    card.pageKey ??
    buildTailorRunRegistryKey(card.url) ??
    card.existingTailoringId ??
    card.id
  }`;
}

function buildActiveTailorRunCardFromRun(input: {
  id: string;
  isCurrentPage?: boolean;
  pageKey?: string | null;
  run: TailorResumeRunRecord;
  titleFallback?: {
    companyName: string | null;
    pageTitle: string | null;
    positionTitle: string | null;
    url: string | null;
  };
}): ActiveTailorRunCard | null {
  if (isPageCaptureFailureRun(input.run)) {
    return null;
  }

  if (
    input.run.status !== "running" &&
    input.run.status !== "needs_input" &&
    input.run.status !== "error"
  ) {
    return null;
  }

  const url = input.run.pageUrl ?? input.titleFallback?.url ?? null;
  const startedAtTime = readActiveTailorRunSortTime(input.run.capturedAt);
  const isStepTwoReviewGate = isTailoringRunStepTwoReviewGate(input.run);
  const step = isStepTwoReviewGate
    ? {
        ...readActiveTailorRunStep({
          captureState: readCaptureStateFromTailoringRun(input.run) ?? "idle",
          existingTailoring: null,
          lastTailoringRun: input.run,
          tailorGenerationStep: input.run.generationStep ?? null,
          tailorInterview: null,
        }),
        label:
          readTailorRunBlockingTechnologiesFromRun(input.run).length > 0
            ? "Resolve skills-section"
            : "Ready to tailor",
        shortLabel:
          readTailorRunBlockingTechnologiesFromRun(input.run).length > 0
            ? "Blocked"
            : "Play",
        status: "current" as const,
        stepNumber: 2,
      }
    : readActiveTailorRunStep({
        captureState: readCaptureStateFromTailoringRun(input.run) ?? "idle",
        existingTailoring: null,
        lastTailoringRun: input.run,
        tailorGenerationStep: input.run.generationStep ?? null,
        tailorInterview: null,
      });

  return {
    applicationId: input.run.applicationId ?? null,
    blockingTechnologies: readTailorRunBlockingTechnologiesFromRun(input.run),
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: input.run.tailoredResumeId ?? null,
      tailorRunId: null,
    }),
    detail:
      input.run.status === "error"
        ? input.run.tailoredResumeError?.trim() || input.run.message
        : null,
    emphasizedTechnologies: readTailorRunKeywordTechnologiesFromRun(input.run),
    existingTailoringId: null,
    elapsedTimeEndTime: readTailorRunElapsedEndTime({
      isWaiting: false,
      startedAtTime,
      status: input.run.status,
      stepTimings: input.run.generationStepTimings ?? [],
    }),
    id: input.id,
    interviewStatus: isStepTwoReviewGate ? "ready" : null,
    isCurrentPage: input.isCurrentPage ?? false,
    message: input.run.status === "error"
        ? "Failed generation"
        : null,
    pageKey: input.pageKey ?? null,
    sortTime: startedAtTime,
    statusDisplayState:
      input.run.status === "needs_input"
        ? "ready"
        : input.run.status === "error"
          ? "error"
          : "loading",
    startedAtTime,
    suppressedTailoredResumeId: input.run.suppressedTailoredResumeId ?? null,
    step,
    stepTimings: input.run.generationStepTimings ?? [],
    title: buildTailorRunCardTitle({
      companyName: input.run.companyName ?? input.titleFallback?.companyName ?? null,
      pageTitle: input.run.pageTitle ?? input.titleFallback?.pageTitle ?? null,
      positionTitle:
        input.run.positionTitle ?? input.titleFallback?.positionTitle ?? null,
      url,
    }),
    url,
  };
}

function buildActiveTailorRunCardFromExistingTailoring(input: {
  existingTailoring: TailorResumeExistingTailoringState;
  id: string;
  isCurrentPage?: boolean;
  pageKey?: string | null;
  previousRun: TailorResumeRunRecord | null;
  statusDisplayState?: ActiveTailorRunCard["statusDisplayState"];
  titleFallback?: {
    companyName: string | null;
    pageTitle: string | null;
    positionTitle: string | null;
    url: string | null;
  };
}): ActiveTailorRunCard | null {
  if (input.existingTailoring.kind === "completed") {
    return null;
  }

  const run = buildTailoringRunRecordFromExistingTailoring({
    existingTailoring: input.existingTailoring,
    previousRun: input.previousRun,
  });
  const nextCard = buildActiveTailorRunCardFromRun({
    id: input.id,
    isCurrentPage: input.isCurrentPage,
    pageKey: input.pageKey,
    run,
    titleFallback: input.titleFallback,
  });

  if (!nextCard) {
    return null;
  }

  const url = input.existingTailoring.jobUrl ?? nextCard.url;
  const startedAtTime = readExistingTailoringSortTime(input.existingTailoring);
  const interviewStatus =
    input.existingTailoring.kind === "pending_interview"
      ? input.existingTailoring.interviewStatus
      : input.existingTailoring.kind === "active_generation" &&
          isActiveGenerationStepTwoReviewGate(input.existingTailoring)
        ? "ready"
      : null;
  const previousRunStepNumber =
    typeof input.previousRun?.generationStep?.stepNumber === "number"
      ? input.previousRun.generationStep.stepNumber
      : null;
  const shouldUsePendingInterviewStep =
    previousRunStepNumber === null || previousRunStepNumber <= 2;
  const pendingInterviewStep = !shouldUsePendingInterviewStep
    ? null
    : interviewStatus === "pending"
      ? {
          ...nextCard.step,
          label: "Resolve skills-section",
          shortLabel: "Blocked",
          status: "current" as const,
          stepNumber: 2,
        }
      : interviewStatus === "ready"
        ? {
            ...nextCard.step,
            label: "Ready to tailor",
            shortLabel: "Play",
            status: "current" as const,
            stepNumber: 2,
          }
        : interviewStatus === "deciding"
          ? {
              ...nextCard.step,
              label: "Starting tailoring",
              shortLabel: "Starting",
              status: "current" as const,
              stepNumber: 2,
            }
          : null;

  return {
    ...nextCard,
    applicationId: input.existingTailoring.applicationId,
    blockingTechnologies:
      readTailorRunBlockingTechnologiesFromExistingTailoring(
        input.existingTailoring,
      ),
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: null,
      tailorRunId: input.existingTailoring.id,
    }),
    emphasizedTechnologies:
      readTailorRunKeywordTechnologiesFromExistingTailoring(
        input.existingTailoring,
      ),
    existingTailoringId: input.existingTailoring.id,
    elapsedTimeEndTime: readActiveTailorRunSortTime(
      input.existingTailoring.updatedAt,
    ),
    interviewStatus,
    sortTime: startedAtTime,
    statusDisplayState:
      input.existingTailoring.kind === "active_generation" &&
      input.existingTailoring.status === "FAILED"
        ? "error"
        : shouldUsePendingInterviewStep &&
            (interviewStatus === "pending" || interviewStatus === "ready")
          ? "ready"
          : shouldUsePendingInterviewStep && interviewStatus === "deciding"
            ? "loading"
            : input.statusDisplayState ?? nextCard.statusDisplayState,
    startedAtTime,
    step: pendingInterviewStep ?? nextCard.step,
    suppressedTailoredResumeId: null,
    url,
  };
}

function buildActiveTailorRunCardFromPreparation(input: {
  id: string;
  isCurrentPage?: boolean;
  pageKey?: string | null;
  preparation: TailorResumePreparationState;
  run: TailorResumeRunRecord | null;
  titleFallback?: {
    companyName: string | null;
    pageTitle: string | null;
    positionTitle: string | null;
    url: string | null;
  };
}): ActiveTailorRunCard {
  const url =
    input.preparation.pageUrl ?? input.run?.pageUrl ?? input.titleFallback?.url ?? null;
  const startedAtTime = readActiveTailorRunSortTime(input.preparation.capturedAt);

  return {
    applicationId: input.run?.applicationId ?? null,
    blockingTechnologies: input.run
      ? readTailorRunBlockingTechnologiesFromRun(input.run)
      : [],
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: null,
      tailorRunId: null,
    }),
    detail: null,
    emphasizedTechnologies: input.run
      ? readTailorRunKeywordTechnologiesFromRun(input.run)
      : [],
    existingTailoringId: null,
    elapsedTimeEndTime: null,
    id: input.id,
    interviewStatus: null,
    isCurrentPage: input.isCurrentPage ?? false,
    message: null,
    pageKey: input.pageKey ?? null,
    sortTime: startedAtTime,
    statusDisplayState: "loading",
    startedAtTime,
    suppressedTailoredResumeId: input.run?.suppressedTailoredResumeId ?? null,
    step: readActiveTailorRunStep({
      captureState: "running",
      existingTailoring: null,
      lastTailoringRun: input.run,
      tailorGenerationStep: input.run?.generationStep ?? null,
      tailorInterview: null,
    }),
    stepTimings: input.run?.generationStepTimings ?? [],
    title: buildTailorRunCardTitle({
      companyName: input.run?.companyName ?? input.titleFallback?.companyName ?? null,
      pageTitle:
        input.preparation.pageTitle ??
        input.run?.pageTitle ??
        input.titleFallback?.pageTitle ??
        null,
      positionTitle:
        input.run?.positionTitle ?? input.titleFallback?.positionTitle ?? null,
      url,
    }),
    url,
  };
}

function buildCurrentActiveTailorRunCard(input: {
  hasCurrentPageCompletedTailoring: boolean;
  currentPageApplicationContext: TailorResumeApplicationContext | null;
  currentPageContext: JobPageContext | null;
  currentPagePersonalInfoTailoring: TailorResumeExistingTailoringState | null;
  currentPageRegistryKey: string | null;
  currentPageStoredTailoringRun: TailorResumeRunRecord | null;
  currentTailorPreparationState: TailorResumePreparationState | null;
  currentPageUrl: string | null;
}) {
  const titleFallback = {
    companyName:
      input.currentPagePersonalInfoTailoring?.companyName ??
      input.currentPageStoredTailoringRun?.companyName ??
      input.currentPageApplicationContext?.companyName ??
      null,
    pageTitle:
      input.currentPageStoredTailoringRun?.pageTitle ??
      input.currentTailorPreparationState?.pageTitle ??
      input.currentPageContext?.title ??
      null,
    positionTitle:
      input.currentPagePersonalInfoTailoring?.positionTitle ??
      input.currentPageStoredTailoringRun?.positionTitle ??
      input.currentPageApplicationContext?.jobTitle ??
      null,
    url:
      input.currentPagePersonalInfoTailoring?.jobUrl ??
      input.currentPageStoredTailoringRun?.pageUrl ??
      input.currentTailorPreparationState?.pageUrl ??
      input.currentPageUrl,
  };
  const cardId = `current:${input.currentPageRegistryKey ?? titleFallback.url ?? "active"}`;

  // Keep the current page on the local stream so server polling cannot reset live timers.
  if (
    input.currentPageStoredTailoringRun?.status === "running" ||
    (input.currentPageStoredTailoringRun?.status === "needs_input" &&
      !input.currentPagePersonalInfoTailoring)
  ) {
    const currentRun = input.currentPageStoredTailoringRun;

    if (!currentRun) {
      return null;
    }

    return buildActiveTailorRunCardFromRun({
      id: cardId,
      isCurrentPage: true,
      pageKey: input.currentPageRegistryKey,
      run: currentRun,
      titleFallback,
    });
  }

  if (
    input.currentPagePersonalInfoTailoring &&
    input.currentPagePersonalInfoTailoring.kind !== "completed"
  ) {
    return buildActiveTailorRunCardFromExistingTailoring({
      existingTailoring: input.currentPagePersonalInfoTailoring,
      id: cardId,
      isCurrentPage: true,
      pageKey: input.currentPageRegistryKey,
      previousRun: input.currentPageStoredTailoringRun,
      titleFallback,
    });
  }

  if (input.currentTailorPreparationState) {
    return buildActiveTailorRunCardFromPreparation({
      id: cardId,
      isCurrentPage: true,
      pageKey: input.currentPageRegistryKey,
      preparation: input.currentTailorPreparationState,
      run: input.currentPageStoredTailoringRun,
      titleFallback,
    });
  }

  if (input.hasCurrentPageCompletedTailoring) {
    return null;
  }

  return null;
}

function buildParallelTailorRunCards(input: {
  currentPageContext: JobPageContext | null;
  currentPageRegistryKey: string | null;
  existingTailoringPromptsByKey: TailorStorageRegistry<ExistingTailoringPromptState>;
  personalInfo: PersonalInfoSummary | null;
  tailorPreparationsByKey: TailorStorageRegistry<TailorResumePreparationState>;
  tailoringRunsByKey: TailorStorageRegistry<TailorResumeRunRecord>;
}) {
  const cards: ActiveTailorRunCard[] = [];
  const seenComparableUrls = new Set<string>();
  const localRegistryKeys = new Set<string>([
    ...Object.keys(input.existingTailoringPromptsByKey),
    ...Object.keys(input.tailorPreparationsByKey),
    ...Object.keys(input.tailoringRunsByKey),
  ]);

  for (const registryKey of localRegistryKeys) {
    if (registryKey === input.currentPageRegistryKey) {
      continue;
    }

    const prompt = input.existingTailoringPromptsByKey[registryKey] ?? null;
    const preparation = input.tailorPreparationsByKey[registryKey] ?? null;
    const run = input.tailoringRunsByKey[registryKey] ?? null;

    if (
      !prompt &&
      !preparation &&
      isLocalTailoringRunShadowedByServerState({
        activeTailorings: input.personalInfo?.activeTailorings ?? [],
        run,
      })
    ) {
      continue;
    }

    const nextCard = prompt
      ? buildActiveTailorRunCardFromExistingTailoring({
          existingTailoring: prompt.existingTailoring,
          id: `prompt:${registryKey}`,
          pageKey: registryKey,
          previousRun: run,
          statusDisplayState: "warning",
        })
      : preparation
        ? buildActiveTailorRunCardFromPreparation({
            id: `preparation:${registryKey}`,
            pageKey: registryKey,
            preparation,
            run,
          })
        : run
          ? buildActiveTailorRunCardFromRun({
              id: `run:${registryKey}`,
              pageKey: registryKey,
              run,
            })
          : null;

    if (!nextCard) {
      continue;
    }

    if (
      nextCard.url &&
      tailoringRunMatchesPageContext(nextCard.url, input.currentPageContext)
    ) {
      continue;
    }

    const comparableUrl = normalizeComparableUrl(nextCard.url);

    if (comparableUrl) {
      seenComparableUrls.add(comparableUrl);
    }

    cards.push(nextCard);
  }

  for (const activeTailoring of input.personalInfo?.activeTailorings ?? []) {
    if (activeTailoring.kind === "completed") {
      continue;
    }

    const comparableUrl = normalizeComparableUrl(activeTailoring.jobUrl);

    if (
      (activeTailoring.jobUrl &&
        tailoringRunMatchesPageContext(
          activeTailoring.jobUrl,
          input.currentPageContext,
        )) ||
      (comparableUrl && seenComparableUrls.has(comparableUrl))
    ) {
      continue;
    }

    const nextCard = buildActiveTailorRunCardFromExistingTailoring({
      existingTailoring: activeTailoring,
      id: `server:${activeTailoring.id}`,
      previousRun: null,
    });

    if (!nextCard) {
      continue;
    }

    if (comparableUrl) {
      seenComparableUrls.add(comparableUrl);
    }

    cards.push(nextCard);
  }

  cards.sort((left, right) => right.sortTime - left.sortTime);

  return cards;
}

function readActiveTailorRunCardPreference(card: ActiveTailorRunCard) {
  return [
    card.isCurrentPage ? 1 : 0,
    card.existingTailoringId ? 1 : 0,
    card.statusDisplayState === "loading" ? 1 : 0,
    card.sortTime,
  ] as const;
}

function compareActiveTailorRunCardPreference(
  left: ActiveTailorRunCard,
  right: ActiveTailorRunCard,
) {
  const leftPreference = readActiveTailorRunCardPreference(left);
  const rightPreference = readActiveTailorRunCardPreference(right);

  for (let index = 0; index < leftPreference.length; index += 1) {
    const difference = leftPreference[index] - rightPreference[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function dedupeActiveTailorRunCards(cards: ActiveTailorRunCard[]) {
  const selectedCards: ActiveTailorRunCard[] = [];
  const selectedCardIndexesByKey = new Map<string, number>();

  const readKeys = (card: ActiveTailorRunCard) => {
    const keys: string[] = [];
    const applicationId = card.applicationId?.trim();
    const comparableUrl = normalizeComparableUrl(card.url);

    if (applicationId) {
      keys.push(`application:${applicationId}`);
    }

    if (comparableUrl) {
      keys.push(`url:${comparableUrl}`);
    }

    return keys;
  };

  for (const card of cards) {
    const keys = readKeys(card);

    if (keys.length === 0) {
      selectedCards.push(card);
      continue;
    }

    const previousIndex = keys
      .map((key) => selectedCardIndexesByKey.get(key))
      .find((index): index is number => typeof index === "number");

    if (typeof previousIndex !== "number") {
      const nextIndex = selectedCards.length;
      selectedCards.push(card);
      for (const key of keys) {
        selectedCardIndexesByKey.set(key, nextIndex);
      }
      continue;
    }

    const previousCard = selectedCards[previousIndex];

    if (compareActiveTailorRunCardPreference(card, previousCard) < 0) {
      continue;
    }

    for (const key of readKeys(previousCard)) {
      if (selectedCardIndexesByKey.get(key) === previousIndex) {
        selectedCardIndexesByKey.delete(key);
      }
    }

    selectedCards[previousIndex] = card;
    for (const key of keys) {
      selectedCardIndexesByKey.set(key, previousIndex);
    }
  }

  return selectedCards.sort((left, right) => right.sortTime - left.sortTime);
}

function readJobPageIdentity(pageContext: JobPageContext | null) {
  if (!pageContext) {
    return null;
  }

  const jobUrl = readJobUrlFromPageContext(pageContext);
  const fallbackUrl = pageContext.url.trim();
  return jobUrl ?? (fallbackUrl || null);
}

function tailoringRunMatchesPageContext(
  runUrl: string | null,
  pageContext: JobPageContext | null,
) {
  const normalizedRunUrl = normalizeComparableUrl(runUrl);

  if (!normalizedRunUrl || !pageContext) {
    return false;
  }

  return [
    pageContext.url,
    pageContext.canonicalUrl,
    readJobUrlFromPageContext(pageContext),
  ]
    .map(normalizeComparableUrl)
    .some((candidate) => candidate === normalizedRunUrl);
}

type ChatMessageRecord = {
  content: string;
  createdAt: string;
  id: string;
  model: string | null;
  role: "assistant" | "user";
  toolCalls: ToolCallRecord[];
};

type ToolCallRecord = {
  argumentsText: string;
  name: string;
  outputText?: string;
};

type ChatStatus = "error" | "idle" | "loading" | "ready";
type ChatSendStatus = "idle" | "streaming";
type TailorRunDetailView = "debug" | "preview" | "quickReview";
type TailorRunMenuActionState =
  | "archiving"
  | "deleting"
  | "goingToTab"
  | "idle"
  | "retrying"
  | "showingKeywords";
type BackgroundTailorRunActionState =
  | "deleting"
  | "goingToTab"
  | "retrying"
  | "showingKeywords"
  | "stopping";
type TailoredResumeMenuActionState =
  | "downloading"
  | "goingToTab"
  | "idle"
  | "openingWeb"
  | "retrying";

type ExistingTailoringPromptState = {
  actionState: "idle" | "overwriting";
  existingTailoring: TailorResumeExistingTailoringState;
  jobDescription: string;
  jobUrl: string | null;
  pageContext: JobPageContext;
};

type ActiveTailoringOverrideState = "idle" | "overwriting";
type TailorStorageRegistry<T> = Record<string, T>;

function readTailorPreparationRegistryKey(
  preparationState: TailorResumePreparationState,
  rawKey: string,
) {
  return (
    buildTailorRunRegistryKey(preparationState.pageUrl) ??
    buildTailorRunRegistryKey(rawKey)
  );
}

function readTailorRunRecordRegistryKey(
  run: TailorResumeRunRecord,
  rawKey: string,
) {
  return buildTailorRunRegistryKey(run.pageUrl) ?? buildTailorRunRegistryKey(rawKey);
}

function readExistingTailoringPromptRegistryKey(
  prompt: ExistingTailoringPromptState,
  rawKey: string,
) {
  return (
    buildTailorRunRegistryKey(prompt.jobUrl) ??
    readTailorRunRegistryKeyFromPageContext(prompt.pageContext) ??
    buildTailorRunRegistryKey(rawKey)
  );
}

function compareIsoTimestampStrings(left: string | null, right: string | null) {
  return Date.parse(left || "") - Date.parse(right || "");
}

function compareTailorPreparationStates(
  left: TailorResumePreparationState,
  right: TailorResumePreparationState,
) {
  return compareIsoTimestampStrings(left.capturedAt, right.capturedAt);
}

function compareTailorRunRecords(
  left: TailorResumeRunRecord,
  right: TailorResumeRunRecord,
) {
  return compareIsoTimestampStrings(left.capturedAt, right.capturedAt);
}

function compareExistingTailoringPrompts(
  left: ExistingTailoringPromptState,
  right: ExistingTailoringPromptState,
) {
  return compareIsoTimestampStrings(
    left.existingTailoring.createdAt,
    right.existingTailoring.createdAt,
  );
}

function readCaptureStateFromTailoringRun(
  run: TailorResumeRunRecord | null,
): CaptureState | null {
  if (!run || isPageCaptureFailureRun(run)) {
    return null;
  }

  if (run.status === "running") {
    return "running";
  }

  if (run.status === "needs_input") {
    return "needs_input";
  }

  if (run.status === "success") {
    return "sent";
  }

  return "error";
}

type TailorRunDeleteTarget = {
  jobUrl: string | null;
  tailoredResumeId: string | null;
  tailorRunId: string | null;
};

function readStoredExistingTailoringPrompt(
  value: unknown,
): ExistingTailoringPromptState | null {
  if (!isRecord(value)) {
    return null;
  }

  const existingTailoring = readTailorResumeExistingTailoringState(
    value.existingTailoring,
  );
  const jobDescription =
    typeof value.jobDescription === "string" ? value.jobDescription.trim() : "";
  const jobUrl =
    typeof value.jobUrl === "string" && value.jobUrl.trim()
      ? value.jobUrl.trim()
      : null;
  const pageContext = isRecord(value.pageContext)
    ? (value.pageContext as unknown as JobPageContext)
    : null;

  if (!existingTailoring || !jobDescription || !pageContext) {
    return null;
  }

  return {
    actionState: "idle",
    existingTailoring,
    jobDescription,
    jobUrl,
    pageContext,
  };
}

function readStoredTailoringRunRecord(
  value: unknown,
): TailorResumeRunRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const capturedAt = typeof value.capturedAt === "string" ? value.capturedAt : "";
  const message = typeof value.message === "string" ? value.message : "";
  const status =
    value.status === "error" ||
    value.status === "needs_input" ||
    value.status === "running" ||
    value.status === "success"
      ? value.status
      : null;

  if (!capturedAt || !message || !status) {
    return null;
  }

  return {
    applicationId:
      typeof value.applicationId === "string" ? value.applicationId : null,
    capturedAt,
    companyName:
      typeof value.companyName === "string" ? value.companyName : null,
    endpoint:
      typeof value.endpoint === "string"
        ? value.endpoint
        : DEFAULT_TAILOR_RESUME_ENDPOINT,
    failureKind: value.failureKind === "page_capture" ? "page_capture" : null,
    generationStep: readTailorResumeGenerationStepSummary(value.generationStep),
    generationStepTimings: readTailorResumeGenerationStepTimings(
      value.generationStepTimings,
    ),
    jobIdentifier:
      typeof value.jobIdentifier === "string" ? value.jobIdentifier : null,
    message,
    pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : null,
    pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : null,
    positionTitle:
      typeof value.positionTitle === "string" ? value.positionTitle : null,
    status,
    suppressedTailoredResumeId:
      typeof value.suppressedTailoredResumeId === "string"
        ? value.suppressedTailoredResumeId
        : null,
    tailoredResumeError:
      typeof value.tailoredResumeError === "string"
        ? value.tailoredResumeError
        : null,
    tailoredResumeId:
      typeof value.tailoredResumeId === "string" ? value.tailoredResumeId : null,
  };
}

function readStoredTailoringRunRegistry(value: unknown) {
  return normalizeTailorStorageRegistry({
    compareEntries: compareTailorRunRecords,
    parse: readStoredTailoringRunRecord,
    readEntryKey: readTailorRunRecordRegistryKey,
    value,
  });
}

function readStoredTailorPreparationRegistry(value: unknown) {
  return normalizeTailorStorageRegistry({
    compareEntries: compareTailorPreparationStates,
    parse: readTailorResumePreparationState,
    readEntryKey: readTailorPreparationRegistryKey,
    value,
  });
}

function readStoredExistingTailoringPromptRegistry(value: unknown) {
  return normalizeTailorStorageRegistry({
    compareEntries: compareExistingTailoringPrompts,
    parse: readStoredExistingTailoringPrompt,
    readEntryKey: readExistingTailoringPromptRegistryKey,
    value,
  });
}

function resolveTailorInterviewForPage(input: {
  pageIdentity: {
    canonicalUrl: string | null;
    jobUrl: string | null;
    pageUrl: string | null;
  };
  tailoringInterviews: TailorResumePendingInterviewSummary[];
}) {
  return (
    input.tailoringInterviews.find((tailoringInterview) =>
      matchesTailorOverwritePageIdentity({
        jobUrl: tailoringInterview.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null
  );
}

function activeTailorRunCardMatchesInterview(input: {
  card: ActiveTailorRunCard;
  interview: TailorResumePendingInterviewSummary;
}) {
  return (
    Boolean(
      input.interview.tailorResumeRunId &&
        input.card.existingTailoringId === input.interview.tailorResumeRunId,
    ) ||
    sameTailoringJobUrl(input.interview.jobUrl, input.card.url) ||
    sameTailoringJobUrl(input.interview.jobUrl, input.card.pageKey)
  );
}

function buildGeneratingTailorInterviewForCard(input: {
  card: ActiveTailorRunCard;
  existingTailoringId: string;
  interviewId: string;
}) {
  return {
    applicationId: input.card.applicationId,
    companyName: null,
    completionRequestedAt: null,
    conversation: [],
    emphasizedTechnologies: input.card.emphasizedTechnologies,
    id: input.interviewId,
    jobIdentifier: null,
    jobUrl: input.card.url,
    positionTitle: input.card.title,
    questioningSummary: null,
    tailorResumeRunId: input.existingTailoringId,
    updatedAt: new Date().toISOString(),
  } satisfies TailorResumePendingInterviewSummary;
}

function readChatMessage(value: unknown): ChatMessageRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const content = typeof value.content === "string" ? value.content : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const role =
    value.role === "assistant" || value.role === "user" ? value.role : null;

  if (!id || !createdAt || !role) {
    return null;
  }

  return {
    content,
    createdAt,
    id,
    model: typeof value.model === "string" ? value.model : null,
    role,
    toolCalls: readToolCallRecords(value.toolCalls),
  };
}

function readChatMessages(value: unknown) {
  const messages = isRecord(value) && Array.isArray(value.messages)
    ? value.messages
    : [];

  return messages
    .map(readChatMessage)
    .filter((message): message is ChatMessageRecord => Boolean(message));
}

function buildSupportChatHistoryUrl() {
  return DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT;
}

function createTemporaryChatMessage(
  role: ChatMessageRecord["role"],
  content: string,
): ChatMessageRecord {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `temporary-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: null,
    role,
    toolCalls: [],
  };
}

function mergeChatStreamedContent(baseContent: string, streamedContent: string) {
  if (!streamedContent) {
    return baseContent;
  }

  if (!baseContent) {
    return streamedContent;
  }

  if (
    baseContent.startsWith(streamedContent) ||
    baseContent.includes(streamedContent.trim())
  ) {
    return baseContent;
  }

  if (streamedContent.startsWith(baseContent)) {
    return streamedContent;
  }

  return `${streamedContent.trimEnd()}\n\n${baseContent}`;
}

async function readChatStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Chat did not return a stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  function readLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    const event = JSON.parse(trimmedLine) as unknown;

    if (isRecord(event)) {
      onEvent(event);
    }
  }

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      readLine(line);
    }

    if (done) {
      break;
    }
  }

  readLine(buffer);
}

function ChatBubbleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.4 18.2 4 20V5.8C4 4.8 4.8 4 5.8 4h12.4c1 0 1.8.8 1.8 1.8v10.6c0 1-.8 1.8-1.8 1.8H6.4Z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 12 16-8-6 16-3-7-7-1Z" />
      <path d="m11 13 4-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7h14" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 7l1-2h4l1 2" />
      <path d="M7 7l1 13h8l1-13" />
    </svg>
  );
}

function CompactChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3v6" />
      <path d="M12 15v6" />
      <path d="M4 12h16" />
      <path d="m8 6 4 3 4-3" />
      <path d="m8 18 4-3 4 3" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

type SettingsSpareBulletLineMeasurementState =
  | { key: string; status: "error"; message: string }
  | { key: string; status: "idle" }
  | { key: string; status: "measuring" }
  | {
      key: string;
      measurement: TailorResumeSpareBulletLineMeasurement;
      status: "ready";
    };

function buildSettingsSpareBulletMeasurementKey(
  input: SettingsSpareBulletLineMeasurementInput,
) {
  const quote = input.quote.trim();
  const resumeExperienceId = input.resumeExperienceId.trim();

  if (!quote || !resumeExperienceId) {
    return "";
  }

  return JSON.stringify([quote, resumeExperienceId]);
}

function useSettingsSpareBulletLineMeasurement(input: {
  cachedMeasurement?: TailorResumeSpareBulletLineMeasurement | null;
  measureLineCount: SettingsSpareBulletQuoteFieldProps["measureLineCount"];
  quote: string;
  resumeExperienceId: string;
}) {
  const { cachedMeasurement, measureLineCount, quote, resumeExperienceId } =
    input;
  const key = useMemo(
    () =>
      buildSettingsSpareBulletMeasurementKey({
        quote,
        resumeExperienceId,
      }),
    [quote, resumeExperienceId],
  );
  const [state, setState] = useState<SettingsSpareBulletLineMeasurementState>({
    key: "",
    status: "idle",
  });

  useEffect(() => {
    if (!key || cachedMeasurement) {
      return;
    }

    let isCancelled = false;
    const timeout = window.setTimeout(() => {
      setState({ key, status: "measuring" });

      void measureLineCount({
        quote,
        resumeExperienceId,
      })
        .then((measurement) => {
          if (!isCancelled) {
            setState(
              measurement
                ? { key, measurement, status: "ready" }
                : { key, status: "idle" },
            );
          }
        })
        .catch((error: unknown) => {
          if (!isCancelled) {
            setState({
              key,
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to measure line count.",
              status: "error",
            });
          }
        });
    }, 650);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeout);
    };
  }, [cachedMeasurement, key, measureLineCount, quote, resumeExperienceId]);

  if (key && cachedMeasurement) {
    return { key, measurement: cachedMeasurement, status: "ready" as const };
  }

  return state.key === key ? state : { key, status: "idle" as const };
}

function SettingsSpareBulletLineCountBadge({
  state,
}: {
  state: SettingsSpareBulletLineMeasurementState;
}) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "measuring") {
    return (
      <span className="settings-spare-bullet-line-badge settings-spare-bullet-line-badge-measuring">
        Measuring
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        className="settings-spare-bullet-line-badge settings-spare-bullet-line-badge-danger"
        title={state.message}
      >
        Check failed
      </span>
    );
  }

  const { measurement } = state;
  const titleParts = [
    "Rendered PDF line count for this selected resume experience.",
    `Candidate PDF pages: ${measurement.pageCount.toLocaleString()}.`,
  ];

  if (measurement.lastLineFillRatio !== null) {
    titleParts.push(
      `Last line fill: ${Math.round(measurement.lastLineFillRatio * 100)}%.`,
    );
  }

  if (measurement.malformed) {
    titleParts.push("Malformed shape: final line is under 50% filled.");
  }

  return (
    <span
      className={`settings-spare-bullet-line-badge settings-spare-bullet-line-badge-${readTailorResumeSpareBulletLineTone(measurement.lineCount)}`}
      title={titleParts.join(" ")}
    >
      {formatTailorResumeSpareBulletLineCount(measurement.lineCount)}
    </span>
  );
}

function buildSettingsSpareBulletLineMeasurementTitle(
  measurement: TailorResumeSpareBulletLineMeasurement,
) {
  const titleParts = [
    "Rendered PDF line count for this selected resume experience.",
    `Candidate PDF pages: ${measurement.pageCount.toLocaleString()}.`,
  ];

  if (measurement.lastLineFillRatio !== null) {
    titleParts.push(
      `Last line fill: ${Math.round(measurement.lastLineFillRatio * 100)}%.`,
    );
  }

  if (measurement.malformed) {
    titleParts.push("Malformed shape: final line is under 50% filled.");
  }

  return titleParts.join(" ");
}

function SettingsSpareBulletSavedLineCountBadge({
  cachedMeasurement,
  measureLineCount,
  quote,
  resumeExperienceId,
}: {
  cachedMeasurement?: TailorResumeSpareBulletLineMeasurement | null;
  measureLineCount: SettingsSpareBulletQuoteFieldProps["measureLineCount"];
  quote: string;
  resumeExperienceId: string;
}) {
  const lineMeasurement = useSettingsSpareBulletLineMeasurement({
    cachedMeasurement,
    measureLineCount,
    quote,
    resumeExperienceId,
  });

  if (lineMeasurement.status === "idle") {
    return null;
  }

  if (lineMeasurement.status === "measuring") {
    return (
      <span className="settings-spare-bullet-saved-line-badge settings-spare-bullet-saved-line-badge-muted">
        Measuring
      </span>
    );
  }

  if (lineMeasurement.status === "error") {
    return (
      <span
        className="settings-spare-bullet-saved-line-badge settings-spare-bullet-saved-line-badge-danger"
        title={lineMeasurement.message}
      >
        Check failed
      </span>
    );
  }

  const { measurement } = lineMeasurement;

  return (
    <span
      className={`settings-spare-bullet-saved-line-badge ${
        measurement.malformed
          ? "settings-spare-bullet-saved-line-badge-danger"
          : "settings-spare-bullet-saved-line-badge-muted"
      }`}
      title={buildSettingsSpareBulletLineMeasurementTitle(measurement)}
    >
      {measurement.malformed
        ? "Malformed"
        : formatTailorResumeSpareBulletLineCount(measurement.lineCount)}
    </span>
  );
}

function SettingsSpareBulletQuoteField({
  disabled,
  fieldClassName,
  measureLineCount,
  onChange,
  placeholder,
  resumeExperienceId,
  value,
}: SettingsSpareBulletQuoteFieldProps) {
  const lineMeasurement = useSettingsSpareBulletLineMeasurement({
    measureLineCount,
    quote: value,
    resumeExperienceId,
  });

  return (
    <label
      className={`settings-spare-bullet-field ${fieldClassName ?? ""}`.trim()}
    >
      <span className="settings-spare-bullet-label-row">
        <span>Resume bullet</span>
        <SettingsSpareBulletLineCountBadge state={lineMeasurement} />
      </span>
      <textarea
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m11 6-6 6 6 6" />
      <path d="M6 12h13" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function EllipsisHorizontalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  );
}

function TailorEmptyStateGraphic() {
  return (
    <svg
      aria-hidden="true"
      className="tailor-empty-state-graphic"
      viewBox="0 0 260 196"
    >
      <ellipse className="tailor-empty-shadow" cx="130" cy="170" rx="76" ry="14" />
      <circle className="tailor-empty-halo" cx="130" cy="88" r="54" />

      <g className="tailor-empty-chip tailor-empty-chip-left">
        <rect
          className="tailor-empty-chip-card"
          height="32"
          rx="12"
          width="42"
          x="54"
          y="72"
        />
        <circle className="tailor-empty-chip-dot" cx="67" cy="88" r="2.6" />
        <circle className="tailor-empty-chip-dot" cx="75" cy="88" r="2.6" />
        <circle className="tailor-empty-chip-dot" cx="83" cy="88" r="2.6" />
      </g>

      <g className="tailor-empty-chip tailor-empty-chip-right">
        <rect
          className="tailor-empty-chip-card"
          height="48"
          rx="12"
          width="38"
          x="176"
          y="64"
        />
        <path className="tailor-empty-chip-line" d="M186 80h18M186 88h18M186 96h12" />
      </g>

      <g className="tailor-empty-sparkles">
        <circle className="tailor-empty-sparkle" cx="88" cy="46" r="3" />
        <circle className="tailor-empty-sparkle" cx="195" cy="46" r="2.5" />
        <circle className="tailor-empty-sparkle" cx="205" cy="127" r="2.5" />
      </g>

      <g className="tailor-empty-mascot">
        <path
          className="tailor-empty-bubble"
          d="M130 40C161 40 186 62 186 90C186 116 165 138 137 141L123 156L118 140C93 135 74 114 74 90C74 62 99 40 130 40Z"
        />
        <path
          className="tailor-empty-bubble-sheen"
          d="M96 63C106 53 120 48 135 48C149 48 161 51 169 58C159 50 146 46 131 46C117 46 104 52 96 63Z"
        />
        <ellipse className="tailor-empty-eye" cx="108" cy="94" rx="10" ry="8" />
        <ellipse className="tailor-empty-eye" cx="152" cy="94" rx="10" ry="8" />
        <path
          className="tailor-empty-mouth"
          d="M108 124C114 131 122 134 130 134C138 134 146 131 152 124"
        />
      </g>
    </svg>
  );
}

function DocumentEmptyState({ message }: { message: string }) {
  return (
    <section aria-label={message} className="tailor-empty-state">
      <div className="tailor-empty-state-inner">
        <TailorEmptyStateGraphic />
        <p className="tailor-empty-state-copy">{message}</p>
      </div>
    </section>
  );
}

function DocumentEmptySurface(input: {
  count: number;
  message: string;
  title: string;
}) {
  return (
    <section className="document-empty-surface">
      <div className="document-empty-heading-row">
        <h2>{input.title}</h2>
        <span>{input.count}</span>
      </div>
      <DocumentEmptyState message={input.message} />
    </section>
  );
}

function readToolCallRecord(value: unknown): ToolCallRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.name !== "string" || typeof value.argumentsText !== "string") {
    return null;
  }

  return {
    argumentsText: value.argumentsText,
    name: value.name,
    ...(typeof value.outputText === "string"
      ? { outputText: value.outputText }
      : {}),
  };
}

function readToolCallRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as ToolCallRecord[];
  }

  return value
    .map(readToolCallRecord)
    .filter((toolCall): toolCall is ToolCallRecord => Boolean(toolCall));
}

function formatCompactToolCallText(value: string) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, " ").trim();
  }
}

function ToolCallDetails({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <details className="toolcall-details">
      <summary>See Toolcalls ({toolCalls.length})</summary>
      <div className="toolcall-details-body">
        {toolCalls.map((toolCall, index) => (
          <div
            className="toolcall-entry"
            key={`${toolCall.name}:${String(index)}`}
          >
            <p className="toolcall-name">{toolCall.name}</p>
            <div className="toolcall-io-row">
              <span>In</span>
              <pre>{formatCompactToolCallText(toolCall.argumentsText)}</pre>
            </div>
            {toolCall.outputText ? (
              <div className="toolcall-io-row">
                <span>Out</span>
                <pre>{formatCompactToolCallText(toolCall.outputText)}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function TailorInterviewMessageContent({
  message,
}: {
  message: TailorResumeConversationMessage;
}) {
  return (
    <>
      <div className="interview-message-body">{message.text}</div>
      <ToolCallDetails toolCalls={message.toolCalls} />
    </>
  );
}

function splitSettingsSkillNames(value: string) {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function formatSettingsSpareBulletSkills(
  spareBullet: TailorResumeStoredSkillData["spareBullets"][number],
) {
  return spareBullet.skills.map((skill) => skill.name).join(", ");
}

function TailorInterviewThinkingIndicator() {
  return (
    <div
      className="interview-thinking-indicator"
      aria-label="Job Helper is thinking"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function ChatMessageMarkdown({
  content,
  isThinking = false,
  toolCalls,
}: {
  content: string;
  isThinking?: boolean;
  toolCalls: ToolCallRecord[];
}) {
  return (
    <>
      <div className="chat-message-content">
        {isThinking ? (
          <div className="chat-thinking-indicator" aria-label="Job Helper is thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || "Thinking..."}
          </ReactMarkdown>
        )}
      </div>
      <ToolCallDetails toolCalls={toolCalls} />
    </>
  );
}

type TailorRunDebugStep = {
  emptyState: string;
  label: string;
  responseLabel: string;
  stage: TailoredResumeOpenAiDebugStage | null | undefined;
  stepNumber: number;
};

function TailorRunDebugDisclosure({
  content,
  emptyState,
  label,
}: {
  content: string | null | undefined;
  emptyState: string;
  label: string;
}) {
  if (!content?.trim()) {
    return <p className="tailor-debug-empty-detail">{emptyState}</p>;
  }

  return (
    <details className="tailor-debug-disclosure">
      <summary>{label}</summary>
      <pre>{content}</pre>
    </details>
  );
}

function TailorRunDebugStepCard({ step }: { step: TailorRunDebugStep }) {
  const stage = step.stage ?? null;
  const toolCalls = stage?.toolCalls ?? [];

  return (
    <article className="tailor-debug-step-card">
      <header className="tailor-debug-step-header">
        <h2>
          <span>Step {step.stepNumber}</span>
          {step.label}
        </h2>
      </header>

      {!stage ? (
        <p className="tailor-debug-empty-detail">{step.emptyState}</p>
      ) : (
        <div className="tailor-debug-step-body">
          <TailorRunDebugDisclosure
            content={stage.systemPrompt}
            emptyState="No saved system prompt for this step."
            label="System prompt"
          />
          <TailorRunDebugDisclosure
            content={stage.prompt}
            emptyState="No saved model input for this step."
            label="Model input"
          />
          <TailorRunDebugDisclosure
            content={stage.outputJson}
            emptyState={
              stage.skippedReason ??
              `No saved ${step.responseLabel.toLowerCase()} for this step.`
            }
            label={step.responseLabel}
          />
          {toolCalls.length > 0 ? (
            <div className="tailor-debug-toolcall-list">
              {toolCalls.map((toolCall, index) => (
                <section
                  className="tailor-debug-toolcall"
                  key={`${toolCall.id}:${String(index)}`}
                >
                  <p>{toolCall.toolName}</p>
                  <TailorRunDebugDisclosure
                    content={toolCall.input}
                    emptyState="No saved tool input."
                    label="Tool input"
                  />
                  <TailorRunDebugDisclosure
                    content={toolCall.output}
                    emptyState="No saved tool output."
                    label="Tool output"
                  />
                </section>
              ))}
            </div>
          ) : (
            <p className="tailor-debug-empty-detail">
              No tool calls were recorded for this step.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function App() {
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>(() =>
    readDebugPreviewFlag("settings") ? "settings" : "tailor",
  );
  const [tailoredResumeArchiveFilter, setTailoredResumeArchiveFilter] =
    useState<TailoredResumeArchiveFilter>("unarchived");
  const [tailoredResumeSearchQuery, setTailoredResumeSearchQuery] =
    useState("");
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [extensionPreferences, setExtensionPreferences] =
    useState<ExtensionPreferences>(defaultExtensionPreferences);
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionState, setAuthActionState] =
    useState<AuthActionState>("idle");
  const [dashboardOpenActionState, setDashboardOpenActionState] =
    useState<DashboardOpenActionState>("idle");
  const [isTailorAuthPromptOpen, setIsTailorAuthPromptOpen] = useState(false);
  const [personalInfoState, setPersonalInfoState] =
    useState<PersonalInfoState>({ personalInfo: null, status: "idle" });
  const [pendingPersonalDelete, setPendingPersonalDelete] =
    useState<PendingPersonalDelete | null>(null);
  const [personalDeleteActionState, setPersonalDeleteActionState] =
    useState<"idle" | "deleting">("idle");
  const [personalDeleteError, setPersonalDeleteError] = useState<string | null>(
    null,
  );
  const [resumePreviewState, setResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [savedSettingsUserMarkdown, setSavedSettingsUserMarkdown] =
    useState<UserMarkdownSummary>({
      markdown: defaultUserMarkdown,
      nonTechnologies: [],
      updatedAt: null,
    });
  const [draftSettingsUserMarkdown, setDraftSettingsUserMarkdown] = useState(
    defaultUserMarkdown,
  );
  const [draftSettingsNonTechnologies, setDraftSettingsNonTechnologies] =
    useState<string[]>([]);
  const [settingsSkillData, setSettingsSkillData] =
    useState<TailorResumeStoredSkillData>(buildEmptyTailorResumeStoredSkillData);
  const [settingsSpareBulletSearchQuery, setSettingsSpareBulletSearchQuery] =
    useState("");
  const [settingsSpareBulletSearchMode, setSettingsSpareBulletSearchMode] =
    useState<TailorResumeSpareBulletSearchMode>("both");
  const [settingsSpareBulletEditDraft, setSettingsSpareBulletEditDraft] =
    useState<SettingsSpareBulletEditDraft | null>(null);
  const [draftSettingsSpareBulletExperienceId, setDraftSettingsSpareBulletExperienceId] =
    useState("");
  const [draftSettingsSpareBulletSkillNames, setDraftSettingsSpareBulletSkillNames] =
    useState("");
  const [draftSettingsSkillsOnlyName, setDraftSettingsSkillsOnlyName] =
    useState("");
  const [draftSettingsSpareBulletQuote, setDraftSettingsSpareBulletQuote] =
    useState("");
  const [
    draftSettingsSpareBulletReplacesQuote,
    setDraftSettingsSpareBulletReplacesQuote,
  ] = useState("");
  const [
    draftSettingsNonTechnologyInput,
    setDraftSettingsNonTechnologyInput,
  ] = useState("");
  const [isSettingsOriginalResumeOpen, setIsSettingsOriginalResumeOpen] =
    useState(false);
  const [isSettingsUserMarkdownOpen, setIsSettingsUserMarkdownOpen] =
    useState(false);
  const [isSavingSettingsUserMarkdown, setIsSavingSettingsUserMarkdown] =
    useState(false);
  const [isSavingSettingsNonTechnologies, setIsSavingSettingsNonTechnologies] =
    useState(false);
  const [isSavingSettingsSpareBullet, setIsSavingSettingsSpareBullet] =
    useState(false);
  const [isSavingSettingsSkillsOnly, setIsSavingSettingsSkillsOnly] =
    useState(false);
  const [settingsUserMarkdownError, setSettingsUserMarkdownError] =
    useState<string | null>(null);
  const [settingsNonTechnologyError, setSettingsNonTechnologyError] =
    useState<string | null>(null);
  const [settingsSpareBulletError, setSettingsSpareBulletError] =
    useState<string | null>(null);
  const [settingsSkillsOnlyError, setSettingsSkillsOnlyError] =
    useState<string | null>(null);
  const settingsSpareBulletLineMeasurementCacheRef = useRef(
    new Map<string, SettingsSpareBulletLineMeasurementCacheValue>(),
  );
  const [
    settingsSpareBulletLineMeasurementCacheVersion,
    setSettingsSpareBulletLineMeasurementCacheVersion,
  ] = useState(0);
  const [tailoredResumePreviewState, setTailoredResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [isTailoredPreviewDiffHighlightingEnabled, setIsTailoredPreviewDiffHighlightingEnabled] =
    useState(true);
  const [tailoredPreviewFocusEditId, setTailoredPreviewFocusEditId] =
    useState<string | null>(null);
  const [tailoredPreviewFocusRequest, setTailoredPreviewFocusRequest] =
    useState(0);
  const [tailoredResumeReviewState, setTailoredResumeReviewState] =
    useState<TailoredResumeReviewState>({ record: null, status: "idle" });
  const [pendingTailoredResumeReviewEditId, setPendingTailoredResumeReviewEditId] =
    useState<string | null>(null);
  const [activeTailorRunDetailView, setActiveTailorRunDetailView] =
    useState<TailorRunDetailView | null>(null);
  const [isTailorRunDetailWideLayout, setIsTailorRunDetailWideLayout] =
    useState(false);
  const [isTailorRunMenuOpen, setIsTailorRunMenuOpen] = useState(false);
  const [tailorRunMenuActionState, setTailorRunMenuActionState] =
    useState<TailorRunMenuActionState>("idle");
  const [tailorRunMenuError, setTailorRunMenuError] = useState<string | null>(
    null,
  );
  const [backgroundTailorRunMenuId, setBackgroundTailorRunMenuId] =
    useState<string | null>(null);
  const [backgroundTailorRunActionStates, setBackgroundTailorRunActionStates] =
    useState<Record<string, BackgroundTailorRunActionState>>({});
  const [generatingTailorQuestionCardIds, setGeneratingTailorQuestionCardIds] =
    useState<Set<string>>(() => new Set());
  const [
    generatingTailorQuestionInterviewId,
    setGeneratingTailorQuestionInterviewId,
  ] = useState<string | null>(null);
  const [backgroundTailorRunMenuError, setBackgroundTailorRunMenuError] =
    useState<string | null>(null);
  const [backgroundTailorRunMenuErrorCardId, setBackgroundTailorRunMenuErrorCardId] =
    useState<string | null>(null);
  const [tailorRunElapsedNow, setTailorRunElapsedNow] = useState(() =>
    Date.now(),
  );
  const [selectedTailoredResumeId, setSelectedTailoredResumeId] =
    useState<string | null>(null);
  const [tailoredResumeMenuId, setTailoredResumeMenuId] =
    useState<string | null>(null);
  const [tailoredResumeMenuActionState, setTailoredResumeMenuActionState] =
    useState<TailoredResumeMenuActionState>("idle");
  const [tailoredResumeMenuActionResumeId, setTailoredResumeMenuActionResumeId] =
    useState<string | null>(null);
  const [tailoredResumeMenuError, setTailoredResumeMenuError] =
    useState<string | null>(null);
  const [tailoredResumeMenuErrorResumeId, setTailoredResumeMenuErrorResumeId] =
    useState<string | null>(null);
  const [tailoredResumeMenuPosition, setTailoredResumeMenuPosition] =
    useState<FloatingMenuPosition | null>(null);
  const [tailoredResumeArchiveActionIds, setTailoredResumeArchiveActionIds] =
    useState<Set<string>>(() => new Set());
  const [dismissedKeywordBadgeKeys, setDismissedKeywordBadgeKeys] = useState<
    Set<string>
  >(() => new Set());
  const [isSavingKeywordCoverageSetting, setIsSavingKeywordCoverageSetting] =
    useState(false);
  const [keywordCoverageSettingError, setKeywordCoverageSettingError] =
    useState<string | null>(null);
  const [isArchivingAllTailoredResumes, setIsArchivingAllTailoredResumes] =
    useState(false);
  const [isDeletingAllTailoredResumes, setIsDeletingAllTailoredResumes] =
    useState(false);
  const [
    isDeleteAllTailoredResumesPromptOpen,
    setIsDeleteAllTailoredResumesPromptOpen,
  ] = useState(false);
  const [isRetryingAllTailorRuns, setIsRetryingAllTailorRuns] =
    useState(false);
  const [retryingTailorRunBatchScope, setRetryingTailorRunBatchScope] =
    useState<"inFlight" | "all" | null>(null);
  const [tailoredResumeMutationError, setTailoredResumeMutationError] =
    useState<string | null>(null);
  const [tailoringRunsByKey, setTailoringRunsByKey] = useState<
    TailorStorageRegistry<TailorResumeRunRecord>
  >({});
  const [tailorPreparationsByKey, setTailorPreparationsByKey] = useState<
    TailorStorageRegistry<TailorResumePreparationState>
  >({});
  const [existingTailoringPromptsByKey, setExistingTailoringPromptsByKey] =
    useState<TailorStorageRegistry<ExistingTailoringPromptState>>({});
  const [, setStoppedTailoringsByKey] =
    useState<StoppedTailoringRegistry>({});
  const [lastTailoringRun, setLastTailoringRun] =
    useState<TailorResumeRunRecord | null>(null);
  const [tailorGenerationStep, setTailorGenerationStep] =
    useState<TailorResumeGenerationStepSummary | null>(null);
  const [tailorGenerationStepTimings, setTailorGenerationStepTimings] =
    useState<TailorResumeGenerationStepTiming[]>([]);
  const tailorGenerationStepTimingsRef = useRef<TailorResumeGenerationStepTiming[]>([]);
  const [tailorInterview, setTailorInterview] =
    useState<TailorResumePendingInterviewSummary | null>(null);
  const [selectedTailorInterviewId, setSelectedTailorInterviewId] =
    useState<string | null>(null);
  const [isTailorInterviewOpen, setIsTailorInterviewOpen] = useState(false);
  const [existingTailoringPrompt, setExistingTailoringPrompt] =
    useState<ExistingTailoringPromptState | null>(null);
  const [tailorPreparationState, setTailorPreparationState] =
    useState<TailorResumePreparationState | null>(null);
  const [isPreparingTailorStart, setIsPreparingTailorStart] = useState(false);
  const [activeTailoringOverrideState, setActiveTailoringOverrideState] =
    useState<ActiveTailoringOverrideState>("idle");
  const [isStoppingCurrentTailoring, setIsStoppingCurrentTailoring] =
    useState(false);
  const [draftTailorInterviewAnswer, setDraftTailorInterviewAnswer] =
    useState("");
  const [
    pendingTailorInterviewAnswerMessage,
    setPendingTailorInterviewAnswerMessage,
  ] =
    useState<TailorResumeConversationMessage | null>(null);
  const [
    pendingTailorInterviewAssistantMessage,
    setPendingTailorInterviewAssistantMessage,
  ] =
    useState<TailorResumeConversationMessage | null>(null);
  const [tailorInterviewError, setTailorInterviewError] = useState<string | null>(
    null,
  );
  const [isTailorInterviewFinishPromptOpen, setIsTailorInterviewFinishPromptOpen] =
    useState(false);
  const [isFinishingTailorInterview, setIsFinishingTailorInterview] =
    useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("idle");
  const [chatSendStatus, setChatSendStatus] =
    useState<ChatSendStatus>("idle");
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const chatHistoryRequestIdRef = useRef(0);
  const tailorInterviewMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const tailorInterviewCardRef = useRef<HTMLElement | null>(null);
  const tailorInterviewInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dismissedTailorInterviewPageIdRef = useRef<string | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const tailorRunMenuRef = useRef<HTMLDivElement | null>(null);
  const backgroundTailorRunMenuRef = useRef<HTMLDivElement | null>(null);
  const tailoredResumeMenuRef = useRef<HTMLDivElement | null>(null);
  const tailoredResumeMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const currentPageTailoredResumeRowRef = useRef<HTMLDivElement | null>(null);
  const lastReadyPersonalInfoRef = useRef<PersonalInfoSummary | null>(null);
  const lastSeenSyncStateRef = useRef<UserSyncStateSnapshot | null>(null);
  const stoppedTailoringsByKeyRef = useRef<StoppedTailoringRegistry>({});
  const isSyncRefreshInFlightRef = useRef(false);
  const isSyncStateCheckInFlightRef = useRef(false);
  const lastSeenTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const dismissedTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const lastAutoFocusedTailorArtifactKeyRef = useRef<string | null>(null);
  const lastAutoScrolledTailoredResumeKeyRef = useRef<string | null>(null);
  const activeTailorRequestAbortControllerRef =
    useRef<AbortController | null>(null);
  const availablePanelTabs = [
    { id: "tailor" as const, label: "Tailor", title: "Tailor Resume" },
    { id: "applications" as const, label: "Applications", title: "Applications" },
    { id: "settings" as const, label: "Settings", title: "Settings" },
    ...(EXTENSION_DEBUG_UI_ENABLED
      ? [{ id: "debug" as const, label: "Debug", title: "Debug" }]
      : []),
  ];
  const readCurrentPageRegistryKey = useCallback(
    () =>
      readTailorRunRegistryKeyFromPageContext(
        state.status === "ready" ? state.snapshot : null,
      ),
    [state],
  );
  const tailoringRunsRefreshKey =
    buildTailoringRunsRefreshKey(tailoringRunsByKey);

  useEffect(() => {
    const mediaQuery = window.matchMedia(TAILOR_RUN_DETAIL_WIDE_LAYOUT_QUERY);
    const syncWideLayout = () => {
      setIsTailorRunDetailWideLayout(mediaQuery.matches);
    };

    syncWideLayout();
    mediaQuery.addEventListener("change", syncWideLayout);

    return () => {
      mediaQuery.removeEventListener("change", syncWideLayout);
    };
  }, []);

  const loadExtensionPreferences = useCallback(async () => {
    const result = await chrome.storage.local.get(EXTENSION_PREFERENCES_STORAGE_KEY);
    setExtensionPreferences(
      readExtensionPreferences(result[EXTENSION_PREFERENCES_STORAGE_KEY]),
    );
  }, []);

  const loadSnapshot = useCallback(async () => {
    setState({ status: "loading", snapshot: null });

    try {
      const snapshot = await fetchSnapshot();
      setState({ status: "ready", snapshot });
    } catch (error) {
      setState({
        status: "error",
        error: getSnapshotErrorMessage(error),
        snapshot: null,
      });
    }
  }, []);

  const loadAuthStatus = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_AUTH_STATUS",
      });
      setAuthState(readAuthResponse(response));
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not read your Job Helper account.",
        status: "error",
      });
    }
  }, []);

  const invalidateAuthSession = useCallback(async () => {
    setAuthState({ status: "signedOut" });

    try {
      await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear the Job Helper auth session.", error);
    }
  }, []);

  const applyStoppedTailoringFilter = useCallback(
    (nextPersonalInfo: PersonalInfoSummary) =>
      removeStoppedTailoringsFromPersonalInfo(
        nextPersonalInfo,
        stoppedTailoringsByKeyRef.current,
      ),
    [],
  );

  const publishPersonalInfoToSharedCache = useCallback(
    (nextPersonalInfo: PersonalInfoSummary | null) => {
      if (!nextPersonalInfo || authState.status !== "signedIn") {
        return;
      }

      const filteredPersonalInfo =
        applyStoppedTailoringFilter(nextPersonalInfo);

      void persistPersonalInfoCacheEntry(
        filteredPersonalInfo,
        authState.session.user.id,
      );
    },
    [applyStoppedTailoringFilter, authState],
  );

  const loadCachedPersonalInfo = useCallback(async (userId: string) => {
    try {
      const result = await chrome.storage.local.get(PERSONAL_INFO_CACHE_STORAGE_KEY);
      const cacheEntry = readPersonalInfoCacheEntry(
        result[PERSONAL_INFO_CACHE_STORAGE_KEY],
      );

      if (!cacheEntry || cacheEntry.userId !== userId) {
        return false;
      }

      const nextPersonalInfo = applyStoppedTailoringFilter(
        cacheEntry.personalInfo,
      );

      setPersonalInfoState({
        personalInfo: nextPersonalInfo,
        status: "ready",
      });

      if (!areJsonSnapshotsEqual(nextPersonalInfo, cacheEntry.personalInfo)) {
        void persistPersonalInfoCacheEntry(nextPersonalInfo, userId);
      }

      return true;
    } catch (error) {
      console.error("Could not load the shared personal info cache.", error);
      return false;
    }
  }, [applyStoppedTailoringFilter]);

  const loadPersonalInfo = useCallback(
    async (options: { forceFresh?: boolean; preserveCurrent?: boolean } = {}) => {
      if (!options.preserveCurrent) {
        setPersonalInfoState({ personalInfo: null, status: "loading" });
      }

      try {
        const response = await chrome.runtime.sendMessage({
          payload: options.forceFresh ? { forceFresh: true } : undefined,
          type: "JOB_HELPER_PERSONAL_INFO",
        });

        if (!isRecord(response) || response.ok !== true) {
          throw new Error(
            readErrorMessage(response, "Could not load your Job Helper info."),
          );
        }

        const nextPersonalInfo = applyStoppedTailoringFilter(
          readPersonalInfoPayload(response),
        );
        lastSeenSyncStateRef.current = nextPersonalInfo.syncState;

        setPersonalInfoState({
          personalInfo: nextPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(nextPersonalInfo);
      } catch (error) {
        if (options.preserveCurrent && lastReadyPersonalInfoRef.current) {
          setPersonalInfoState({
            personalInfo: lastReadyPersonalInfoRef.current,
            status: "ready",
          });
          return;
        }

        setPersonalInfoState({
          error:
            error instanceof Error
              ? error.message
              : "Could not load your Job Helper info.",
          personalInfo: null,
          status: "error",
        });
      }
    },
    [applyStoppedTailoringFilter, publishPersonalInfoToSharedCache],
  );

  const loadTailorStorageRegistries = useCallback(async () => {
    try {
      const result = await chrome.storage.local.get([
        TAILORING_RUNS_STORAGE_KEY,
        TAILORING_PREPARATIONS_STORAGE_KEY,
        TAILORING_PROMPTS_STORAGE_KEY,
      ]);
      const tailoringRunsRegistry = readStoredTailoringRunRegistry(
        result[TAILORING_RUNS_STORAGE_KEY],
      );
      const tailorPreparationsRegistry = readStoredTailorPreparationRegistry(
        result[TAILORING_PREPARATIONS_STORAGE_KEY],
      );
      const tailoringPromptsRegistry = readStoredExistingTailoringPromptRegistry(
        result[TAILORING_PROMPTS_STORAGE_KEY],
      );
      const nextStorageEntries: Record<string, unknown> = {};
      const storageKeysToRemove: string[] = [];

      setTailoringRunsByKey((currentRegistry) =>
        areTailorStorageRegistriesEqual(
          currentRegistry,
          tailoringRunsRegistry.registry,
        )
          ? currentRegistry
          : tailoringRunsRegistry.registry,
      );
      setTailorPreparationsByKey((currentRegistry) =>
        areTailorStorageRegistriesEqual(
          currentRegistry,
          tailorPreparationsRegistry.registry,
        )
          ? currentRegistry
          : tailorPreparationsRegistry.registry,
      );
      setExistingTailoringPromptsByKey((currentRegistry) =>
        areTailorStorageRegistriesEqual(
          currentRegistry,
          tailoringPromptsRegistry.registry,
        )
          ? currentRegistry
          : tailoringPromptsRegistry.registry,
      );

      if (tailoringRunsRegistry.changed) {
        if (Object.keys(tailoringRunsRegistry.registry).length > 0) {
          nextStorageEntries[TAILORING_RUNS_STORAGE_KEY] =
            tailoringRunsRegistry.registry;
        } else {
          storageKeysToRemove.push(TAILORING_RUNS_STORAGE_KEY);
        }
      }

      if (tailorPreparationsRegistry.changed) {
        if (Object.keys(tailorPreparationsRegistry.registry).length > 0) {
          nextStorageEntries[TAILORING_PREPARATIONS_STORAGE_KEY] =
            tailorPreparationsRegistry.registry;
        } else {
          storageKeysToRemove.push(TAILORING_PREPARATIONS_STORAGE_KEY);
        }
      }

      if (tailoringPromptsRegistry.changed) {
        if (Object.keys(tailoringPromptsRegistry.registry).length > 0) {
          nextStorageEntries[TAILORING_PROMPTS_STORAGE_KEY] =
            tailoringPromptsRegistry.registry;
        } else {
          storageKeysToRemove.push(TAILORING_PROMPTS_STORAGE_KEY);
        }
      }

      if (storageKeysToRemove.length > 0) {
        await chrome.storage.local.remove(storageKeysToRemove);
      }

      if (Object.keys(nextStorageEntries).length > 0) {
        await chrome.storage.local.set(nextStorageEntries);
      }
    } catch (error) {
      console.error("Could not reload the Tailor Resume storage state.", error);
    }
  }, []);

  const applyStoppedTailoringRegistry = useCallback(
    (registry: StoppedTailoringRegistry) => {
      stoppedTailoringsByKeyRef.current = registry;
      setStoppedTailoringsByKey((currentRegistry) =>
        areJsonSnapshotsEqual(currentRegistry, registry)
          ? currentRegistry
          : registry,
      );
      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        const nextPersonalInfo = removeStoppedTailoringsFromPersonalInfo(
          currentState.personalInfo,
          registry,
        );

        return nextPersonalInfo === currentState.personalInfo
          ? currentState
          : {
              personalInfo: nextPersonalInfo,
              status: "ready",
            };
      });
    },
    [],
  );

  const loadStoppedTailoringRegistry = useCallback(async () => {
    try {
      const result = await chrome.storage.local.get(STOPPED_TAILORING_STORAGE_KEY);
      const stoppedTailoringsRegistry = readStoppedTailoringRegistry(
        result[STOPPED_TAILORING_STORAGE_KEY],
      );

      applyStoppedTailoringRegistry(stoppedTailoringsRegistry.registry);

      if (stoppedTailoringsRegistry.changed) {
        if (Object.keys(stoppedTailoringsRegistry.registry).length === 0) {
          await chrome.storage.local.remove(STOPPED_TAILORING_STORAGE_KEY);
        } else {
          await chrome.storage.local.set({
            [STOPPED_TAILORING_STORAGE_KEY]: stoppedTailoringsRegistry.registry,
          });
        }
      }
    } catch (error) {
      console.error("Could not reload the stopped tailoring state.", error);
    }
  }, [applyStoppedTailoringRegistry]);

  const persistStoppedTailoringRecord = useCallback(
    async (record: StoppedTailoringRecord) => {
      const recordKey = buildStoppedTailoringRecordKey(record);

      if (!recordKey) {
        return;
      }

      const nextRegistry = {
        ...stoppedTailoringsByKeyRef.current,
        [recordKey]: record,
      };

      applyStoppedTailoringRegistry(nextRegistry);

      try {
        await chrome.storage.local.set({
          [STOPPED_TAILORING_STORAGE_KEY]: nextRegistry,
        });
      } catch (error) {
        console.error("Could not persist the stopped tailoring state.", error);
      }
    },
    [applyStoppedTailoringRegistry],
  );

  const loadSyncState = useCallback(
    async () => {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SYNC_STATE",
      });

      if (!isRecord(response) || response.ok !== true) {
        throw new Error(readErrorMessage(response, "Could not read sync state."));
      }

      return readUserSyncStateSnapshot(response);
    },
    [],
  );

  const updateTailoredResumeMenuPosition = useCallback(() => {
    const menuShell = tailoredResumeMenuRef.current;

    if (!menuShell || typeof window === "undefined") {
      setTailoredResumeMenuPosition(null);
      return;
    }

    const anchorRect = menuShell.getBoundingClientRect();
    const popoverRect =
      tailoredResumeMenuPopoverRef.current?.getBoundingClientRect();
    const menuWidth =
      popoverRect?.width ?? TAILORED_RESUME_MENU_FALLBACK_WIDTH;
    const menuHeight =
      popoverRect?.height ?? TAILORED_RESUME_MENU_FALLBACK_HEIGHT;
    const maxLeft = Math.max(
      FLOATING_MENU_VIEWPORT_PADDING,
      window.innerWidth - menuWidth - FLOATING_MENU_VIEWPORT_PADDING,
    );
    const maxTop = Math.max(
      FLOATING_MENU_VIEWPORT_PADDING,
      window.innerHeight - menuHeight - FLOATING_MENU_VIEWPORT_PADDING,
    );
    const nextLeft = Math.min(
      Math.max(FLOATING_MENU_VIEWPORT_PADDING, anchorRect.right - menuWidth),
      maxLeft,
    );
    const nextTop = Math.min(
      Math.max(FLOATING_MENU_VIEWPORT_PADDING, anchorRect.bottom + 8),
      maxTop,
    );

    setTailoredResumeMenuPosition((currentPosition) => {
      if (
        currentPosition &&
        Math.abs(currentPosition.left - nextLeft) < 0.5 &&
        Math.abs(currentPosition.top - nextTop) < 0.5
      ) {
        return currentPosition;
      }

      return {
        left: nextLeft,
        top: nextTop,
      };
    });
  }, []);

  const persistTailorPreparationState = useCallback(
    async (
      nextState: TailorResumePreparationState | null,
      pageKeyOverride?: string | null,
    ) => {
      setTailorPreparationState(nextState);
      const pageKey =
        pageKeyOverride ??
        buildTailorRunRegistryKey(nextState?.pageUrl) ??
        readCurrentPageRegistryKey();

      try {
        if (!pageKey) {
          return;
        }

        const result = await chrome.storage.local.get(TAILORING_PREPARATIONS_STORAGE_KEY);
        const registry = isRecord(result[TAILORING_PREPARATIONS_STORAGE_KEY])
          ? {
              ...result[TAILORING_PREPARATIONS_STORAGE_KEY],
            }
          : {};

        setTailorPreparationsByKey((currentRegistry) => {
          const nextRegistry = { ...currentRegistry };

          if (nextState) {
            nextRegistry[pageKey] = nextState;
          } else {
            delete nextRegistry[pageKey];
          }

          return nextRegistry;
        });

        if (nextState) {
          registry[pageKey] = nextState;
        } else {
          delete registry[pageKey];
        }

        if (Object.keys(registry).length === 0) {
          await chrome.storage.local.remove(TAILORING_PREPARATIONS_STORAGE_KEY);
        } else {
          await chrome.storage.local.set({
            [TAILORING_PREPARATIONS_STORAGE_KEY]: registry,
          });
        }

        await chrome.storage.local.remove(PREPARING_TAILORING_STORAGE_KEY);
      } catch (error) {
        console.error("Could not sync the Tailor Resume preparation state.", error);
      }
    },
    [readCurrentPageRegistryKey],
  );

  const persistExistingTailoringPrompt = useCallback(
    async (
      prompt: ExistingTailoringPromptState | null,
      pageKeyOverride?: string | null,
    ) => {
      const pageKey =
        pageKeyOverride ??
        buildTailorRunRegistryKey(prompt?.jobUrl) ??
        readTailorRunRegistryKeyFromPageContext(prompt?.pageContext ?? null) ??
        readCurrentPageRegistryKey();

      setExistingTailoringPrompt(prompt);

      if (!pageKey) {
        return;
      }

      try {
        const result = await chrome.storage.local.get(TAILORING_PROMPTS_STORAGE_KEY);
        const registry = isRecord(result[TAILORING_PROMPTS_STORAGE_KEY])
          ? {
              ...result[TAILORING_PROMPTS_STORAGE_KEY],
            }
          : {};

        setExistingTailoringPromptsByKey((currentRegistry) => {
          const nextRegistry = { ...currentRegistry };

          if (prompt) {
            nextRegistry[pageKey] = prompt;
          } else {
            delete nextRegistry[pageKey];
          }

          return nextRegistry;
        });

        if (prompt) {
          registry[pageKey] = prompt;
        } else {
          delete registry[pageKey];
        }

        if (Object.keys(registry).length === 0) {
          await chrome.storage.local.remove(TAILORING_PROMPTS_STORAGE_KEY);
        } else {
          await chrome.storage.local.set({
            [TAILORING_PROMPTS_STORAGE_KEY]: registry,
          });
        }

        await chrome.storage.local.remove(EXISTING_TAILORING_STORAGE_KEY);
      } catch (error) {
        console.error("Could not sync the Tailor Resume overwrite prompt.", error);
      }
    },
    [readCurrentPageRegistryKey],
  );

  const persistTailoringRun = useCallback(
    async (
      record: TailorResumeRunRecord | null,
      pageKeyOverride?: string | null,
    ) => {
      const pageKey =
        pageKeyOverride ??
        buildTailorRunRegistryKey(record?.pageUrl) ??
        readCurrentPageRegistryKey();

      if (!pageKey) {
        setLastTailoringRun(record);
        return;
      }

      try {
        const result = await chrome.storage.local.get(TAILORING_RUNS_STORAGE_KEY);
        const registry = isRecord(result[TAILORING_RUNS_STORAGE_KEY])
          ? {
              ...result[TAILORING_RUNS_STORAGE_KEY],
            }
          : {};
        const previousStoredRun = pageKey
          ? readStoredTailoringRunRecord(registry[pageKey])
          : null;
        const nextRecord = mergeTailoringRunTimingHistory(
          record,
          previousStoredRun,
        );

        setLastTailoringRun(nextRecord);

        setTailoringRunsByKey((currentRegistry) => {
          const nextRegistry = { ...currentRegistry };

          if (nextRecord) {
            nextRegistry[pageKey] = nextRecord;
          } else {
            delete nextRegistry[pageKey];
          }

          return nextRegistry;
        });

        if (nextRecord) {
          registry[pageKey] = nextRecord;
        } else {
          delete registry[pageKey];
        }

        if (Object.keys(registry).length === 0) {
          await chrome.storage.local.remove(TAILORING_RUNS_STORAGE_KEY);
        } else {
          await chrome.storage.local.set({
            [TAILORING_RUNS_STORAGE_KEY]: registry,
          });
        }

        await chrome.storage.local.remove(LAST_TAILORING_STORAGE_KEY);
      } catch (error) {
        console.error("Could not sync the Tailor Resume run state.", error);
      }
    },
    [readCurrentPageRegistryKey],
  );

  const clearTailorRegistryEntriesForMatch = useCallback(
    async (match: {
      pageIdentity?: {
        canonicalUrl: string | null;
        jobUrl: string | null;
        pageUrl: string | null;
      } | null;
      pageKey?: string | null;
      jobUrl?: string | null;
    }) => {
      const matchingRegistryKeys = new Set<string>([
        ...collectTailorStorageRegistryKeys({
          match,
          readEntryKey: readTailorRunRecordRegistryKey,
          readEntryUrls: (run) => [run.pageUrl],
          registry: tailoringRunsByKey,
        }),
        ...collectTailorStorageRegistryKeys({
          match,
          readEntryKey: readTailorPreparationRegistryKey,
          readEntryUrls: (preparation) => [preparation.pageUrl],
          registry: tailorPreparationsByKey,
        }),
        ...collectTailorStorageRegistryKeys({
          match,
          readEntryKey: readExistingTailoringPromptRegistryKey,
          readEntryUrls: (prompt) => [
            prompt.jobUrl,
            prompt.pageContext.canonicalUrl,
            prompt.pageContext.url,
          ],
          registry: existingTailoringPromptsByKey,
        }),
      ]);

      if (matchingRegistryKeys.size > 0) {
        setTailoringRunsByKey((currentRegistry) =>
          Object.fromEntries(
            Object.entries(currentRegistry).filter(
              ([registryKey]) => !matchingRegistryKeys.has(registryKey),
            ),
          ),
        );
        setTailorPreparationsByKey((currentRegistry) =>
          Object.fromEntries(
            Object.entries(currentRegistry).filter(
              ([registryKey]) => !matchingRegistryKeys.has(registryKey),
            ),
          ),
        );
        setExistingTailoringPromptsByKey((currentRegistry) =>
          Object.fromEntries(
            Object.entries(currentRegistry).filter(
              ([registryKey]) => !matchingRegistryKeys.has(registryKey),
            ),
          ),
        );
      }

      try {
        const result = await chrome.storage.local.get([
          TAILORING_PREPARATIONS_STORAGE_KEY,
          TAILORING_PROMPTS_STORAGE_KEY,
          TAILORING_RUNS_STORAGE_KEY,
        ]);
        const nextEntries: Record<string, unknown> = {};
        const storageKeysToRemove: string[] = [];
        const pruneRegistry = <T,>(
          storageKey: string,
          input: {
            parse: (candidate: unknown) => T | null;
            readEntryKey: (entry: T, rawKey: string) => string | null;
            readEntryUrls: (entry: T) => Array<string | null | undefined>;
          },
        ) => {
          const prunedRegistry = pruneRawTailorStorageRegistry({
            match,
            parse: input.parse,
            readEntryKey: input.readEntryKey,
            readEntryUrls: input.readEntryUrls,
            value: result[storageKey],
          });

          if (!prunedRegistry.changed) {
            return;
          }

          if (prunedRegistry.value) {
            nextEntries[storageKey] = prunedRegistry.value;
          } else {
            storageKeysToRemove.push(storageKey);
          }
        };

        pruneRegistry(TAILORING_RUNS_STORAGE_KEY, {
          parse: readStoredTailoringRunRecord,
          readEntryKey: readTailorRunRecordRegistryKey,
          readEntryUrls: (run) => [run.pageUrl],
        });
        pruneRegistry(TAILORING_PREPARATIONS_STORAGE_KEY, {
          parse: readTailorResumePreparationState,
          readEntryKey: readTailorPreparationRegistryKey,
          readEntryUrls: (preparation) => [preparation.pageUrl],
        });
        pruneRegistry(TAILORING_PROMPTS_STORAGE_KEY, {
          parse: readStoredExistingTailoringPrompt,
          readEntryKey: readExistingTailoringPromptRegistryKey,
          readEntryUrls: (prompt) => [
            prompt.jobUrl,
            prompt.pageContext.canonicalUrl,
            prompt.pageContext.url,
          ],
        });

        if (storageKeysToRemove.length > 0) {
          await chrome.storage.local.remove(storageKeysToRemove);
        }

        if (Object.keys(nextEntries).length > 0) {
          await chrome.storage.local.set(nextEntries);
        }
      } catch (error) {
        console.error(
          "Could not clear the local Tailor Resume registry entry.",
          error,
        );
      }
    },
    [
      existingTailoringPromptsByKey,
      tailorPreparationsByKey,
      tailoringRunsByKey,
    ],
  );

  useEffect(() => {
    if (personalInfoState.status !== "ready") {
      return;
    }

    const staleCompletedRuns = Object.entries(tailoringRunsByKey).filter(
      ([, run]) =>
        shouldClearCompletedLocalTailorRun({
          activeTailorings: personalInfoState.personalInfo.activeTailorings,
          run,
          tailoredResumes: personalInfoState.personalInfo.tailoredResumes,
          tailoringInterviews: personalInfoState.personalInfo.tailoringInterviews,
        }),
    );

    if (staleCompletedRuns.length === 0) {
      return;
    }

    for (const [pageKey, run] of staleCompletedRuns) {
      void clearTailorRegistryEntriesForMatch({
        jobUrl: run.pageUrl,
        pageKey,
      });
    }
  }, [
    clearTailorRegistryEntriesForMatch,
    personalInfoState,
    tailoringRunsByKey,
  ]);

  const showTailorPreparationOverlayOnActivePage = useCallback(
    async (message: string) => {
      try {
        const tab = await getActiveTab();

        if (typeof tab.id !== "number") {
          return;
        }

        await chrome.tabs.sendMessage(tab.id, {
          payload: {
            text: message,
            tone: "info",
          },
          type: "JOB_HELPER_SHOW_OVERLAY",
        });
      } catch {
        // Ignore pages that do not allow the overlay helper.
      }
    },
    [],
  );

  const loadTailoredResumeReview = useCallback(
    async (input: {
      sessionToken: string;
      tailoredResumeId: string;
    }) => {
      const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${input.sessionToken}`,
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        await invalidateAuthSession();
        return null;
      }

      if (!response.ok) {
        throw new Error(
          readTailorResumePayloadError(
            payload,
            "Could not load the tailored resume review.",
          ),
        );
      }

      return (
        resolveTailoredResumeReviewRecordFromPayload(
          payload,
          input.tailoredResumeId,
        ) ?? null
      );
    },
    [invalidateAuthSession],
  );

  const loadChatHistory = useCallback(
    async (sessionToken: string) => {
      const requestId = chatHistoryRequestIdRef.current + 1;
      chatHistoryRequestIdRef.current = requestId;
      setChatMessages([]);
      setChatStatus("loading");
      setChatError(null);

      try {
        const response = await fetch(buildSupportChatHistoryUrl(), {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });
        const payload = await response.json().catch(() => ({}));

        if (response.status === 401) {
          await invalidateAuthSession();
          return;
        }

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "Could not load chat."));
        }

        if (chatHistoryRequestIdRef.current !== requestId) {
          return;
        }

        setChatMessages(readChatMessages(payload));
        setChatStatus("ready");
      } catch (error) {
        if (chatHistoryRequestIdRef.current !== requestId) {
          return;
        }

        setChatMessages([]);
        setChatError(
          error instanceof Error ? error.message : "Could not load chat.",
        );
        setChatStatus("error");
      }
    },
    [invalidateAuthSession],
  );

  const personalInfo =
    personalInfoState.status === "ready"
      ? personalInfoState.personalInfo
      : lastReadyPersonalInfoRef.current;
  const includeLowPriorityTermsInKeywordCoverage =
    personalInfo?.generationSettings.includeLowPriorityTermsInKeywordCoverage ??
    false;
  const ludicrousMode = personalInfo?.generationSettings.ludicrousMode ?? true;
  const useCustomResumeDownloadName =
    personalInfo?.generationSettings.useCustomResumeDownloadName ?? false;
  const customResumeDownloadName =
    personalInfo?.generationSettings.customResumeDownloadName ?? "Resume";
  const displayedApplications = personalInfo?.applications.slice(0, 12) ?? [];
  const pendingPersonalDeleteImpact = buildPendingPersonalDeleteImpact({
    applications: personalInfo?.applications ?? [],
    pendingDelete: pendingPersonalDelete,
    tailoredResumes: personalInfo?.tailoredResumes ?? [],
  });
  const isDeletingPersonalItem =
    personalDeleteActionState === "deleting" && Boolean(pendingPersonalDelete);
  const hasTailoredResumeArchiveAction =
    tailoredResumeArchiveActionIds.size > 0;
  const pendingPersonalDeleteTitle =
    pendingPersonalDeleteImpact && pendingPersonalDeleteImpact.totalCount > 1
      ? `Delete ${pendingPersonalDeleteImpact.totalCount} items?`
      : pendingPersonalDelete?.kind === "application"
        ? "Delete application?"
        : "Delete tailored resume?";
  const pendingPersonalDeleteEyebrow =
    pendingPersonalDeleteImpact && pendingPersonalDeleteImpact.totalCount > 1
      ? "Remove linked items"
      : pendingPersonalDelete?.kind === "application"
        ? "Remove application"
        : "Remove from history";
  const pendingPersonalDeleteDescription =
    pendingPersonalDeleteImpact && pendingPersonalDeleteImpact.totalCount > 1
      ? `This will delete ${formatDeleteImpactSummary(
          pendingPersonalDeleteImpact,
        )}. Any included tailored resume preview PDF will be removed too. This action can't be undone.`
      : pendingPersonalDelete?.kind === "application"
        ? "This will delete the saved application. This action can't be undone."
        : "This removes the saved tailored resume and its PDF preview from History. This action can't be undone.";
  const pendingPersonalDeleteActionLabel =
    pendingPersonalDeleteImpact && pendingPersonalDeleteImpact.totalCount > 1
      ? `Delete ${pendingPersonalDeleteImpact.totalCount} items`
      : pendingPersonalDelete?.kind === "application"
        ? "Delete application"
        : "Delete resume";
  const currentPageContext = state.status === "ready" ? state.snapshot : null;
  const currentPageIdentity = currentPageContext
    ? {
        canonicalUrl: currentPageContext.canonicalUrl,
        jobUrl: readJobUrlFromPageContext(currentPageContext),
        pageUrl: currentPageContext.url,
      }
    : null;
  const currentPageUrl = readJobPageIdentity(currentPageContext);
  const currentPageRegistryKey =
    readTailorRunRegistryKeyFromPageContext(currentPageContext);
  const currentPageRegistryMatch = {
    jobUrl: currentPageUrl,
    pageIdentity: currentPageIdentity,
    pageKey: currentPageRegistryKey,
  };
  const currentPageStoredTailoringRunEntry = findTailorStorageRegistryEntry({
    match: currentPageRegistryMatch,
    readEntryKey: readTailorRunRecordRegistryKey,
    readEntryUrls: (run) => [run.pageUrl],
    registry: tailoringRunsByKey,
  });
  const currentPageStoredTailoringRun =
    currentPageStoredTailoringRunEntry?.value ?? null;
  const currentPageTailorPreparationEntry = findTailorStorageRegistryEntry({
    match: currentPageRegistryMatch,
    readEntryKey: readTailorPreparationRegistryKey,
    readEntryUrls: (preparation) => [preparation.pageUrl],
    registry: tailorPreparationsByKey,
  });
  const currentPageTailorPreparationState =
    currentPageTailorPreparationEntry?.value ?? null;
  const currentPageExistingTailoringPromptEntry = findTailorStorageRegistryEntry({
    match: currentPageRegistryMatch,
    readEntryKey: readExistingTailoringPromptRegistryKey,
    readEntryUrls: (prompt) => [
      prompt.jobUrl,
      prompt.pageContext.canonicalUrl,
      prompt.pageContext.url,
    ],
    registry: existingTailoringPromptsByKey,
  });
  const currentPageExistingTailoringPrompt =
    currentPageExistingTailoringPromptEntry?.value ?? null;
  const currentPageResolvedRegistryKey =
    currentPageExistingTailoringPromptEntry?.key ??
    currentPageStoredTailoringRunEntry?.key ??
    currentPageTailorPreparationEntry?.key ??
    currentPageRegistryKey;
  const currentPagePersonalInfoTailoring =
    currentPageIdentity && personalInfo
      ? resolveActiveTailoringForPage({
          activeTailorings: personalInfo.activeTailorings,
          pageIdentity: currentPageIdentity,
        })
      : null;
  const currentPagePersonalInfoInterview =
    currentPageIdentity && personalInfo
      ? resolveTailorInterviewForPage({
          pageIdentity: currentPageIdentity,
          tailoringInterviews: personalInfo.tailoringInterviews,
        })
      : null;
  const selectedPersonalInfoInterview =
    selectedTailorInterviewId && personalInfo
      ? personalInfo.tailoringInterviews.find(
          (interview) => interview.id === selectedTailorInterviewId,
        ) ?? null
      : null;
  const activePersonalInfoInterview =
    selectedPersonalInfoInterview ?? currentPagePersonalInfoInterview;
  const currentPageApplicationContext = currentPageContext
    ? buildTailorResumeApplicationContext(currentPageContext)
    : null;
  const { archived: archivedTailoredResumes, unarchived: unarchivedTailoredResumes } =
    splitTailoredResumesByArchiveState(personalInfo?.tailoredResumes ?? []);
  const displayedArchivedTailoredResumes = useMemo(
    () =>
      filterTailoredResumesForArchiveSearch({
        query: tailoredResumeSearchQuery,
        resumes: archivedTailoredResumes,
      }),
    [tailoredResumeSearchQuery, archivedTailoredResumes],
  );
  const isTailoredResumeSearchActive =
    tailoredResumeSearchQuery.trim().length > 0;
  const unarchivedTailoredResumeCount = unarchivedTailoredResumes.length;
  const currentPageCompletedTailoring =
    !existingTailoringPrompt &&
    !(activeTailoringOverrideState === "overwriting" || isStoppingCurrentTailoring) &&
    currentPageIdentity &&
    personalInfo
      ? resolveCompletedTailoringForPage({
          activeTailorings: personalInfo.activeTailorings,
          pageIdentity: currentPageIdentity,
          tailoredResumes: unarchivedTailoredResumes,
        })
      : null;
  const currentPageCompletedTailoredResume =
    resolveTailoredResumeByComparableUrl({
      candidates: [
        currentPageCompletedTailoring?.jobUrl ?? null,
        currentPageStoredTailoringRun?.pageUrl ?? null,
        currentPageUrl,
        currentPageIdentity?.jobUrl ?? null,
        currentPageIdentity?.canonicalUrl ?? null,
        currentPageIdentity?.pageUrl ?? null,
        currentPageResolvedRegistryKey,
      ],
      tailoredResumes: unarchivedTailoredResumes,
    }) ??
    (currentPageCompletedTailoring?.kind === "completed"
      ? unarchivedTailoredResumes.find(
          (tailoredResume) =>
            tailoredResume.id === currentPageCompletedTailoring.tailoredResumeId,
        ) ?? null
      : null);
  const currentPageCompletedTailoredResumeAutoScrollKey =
    currentPageCompletedTailoredResume
      ? [
          currentPageCompletedTailoredResume.id,
          normalizeComparableUrl(currentPageUrl),
          normalizeComparableUrl(currentPageIdentity?.jobUrl),
          normalizeComparableUrl(currentPageIdentity?.canonicalUrl),
          normalizeComparableUrl(currentPageIdentity?.pageUrl),
        ]
          .filter((value): value is string => Boolean(value))
          .join(":")
      : null;
  const currentPageArchivedTailoredResume =
    currentPageCompletedTailoredResume
      ? null
      : resolveTailoredResumeByComparableUrl({
          candidates: [
            currentPageCompletedTailoring?.jobUrl ?? null,
            currentPageStoredTailoringRun?.pageUrl ?? null,
            currentPageUrl,
            currentPageIdentity?.jobUrl ?? null,
            currentPageIdentity?.canonicalUrl ?? null,
            currentPageIdentity?.pageUrl ?? null,
            currentPageResolvedRegistryKey,
          ],
          tailoredResumes: archivedTailoredResumes,
        });
  const hasCurrentPageCompletedTailoring =
    Boolean(currentPageCompletedTailoredResume);
  const currentActiveTailorRunCard = buildCurrentActiveTailorRunCard({
    hasCurrentPageCompletedTailoring,
    currentPageApplicationContext,
    currentPageContext,
    currentPagePersonalInfoTailoring,
    currentPageRegistryKey: currentPageResolvedRegistryKey,
    currentPageStoredTailoringRun,
    currentTailorPreparationState:
      currentPageTailorPreparationState ?? tailorPreparationState,
    currentPageUrl,
  });
  const parallelTailorRunCards = buildParallelTailorRunCards({
    currentPageContext,
    currentPageRegistryKey: currentPageResolvedRegistryKey,
    existingTailoringPromptsByKey,
    personalInfo,
    tailorPreparationsByKey,
    tailoringRunsByKey,
  });
  const activeTailorRunCards = dedupeActiveTailorRunCards([
    ...(currentActiveTailorRunCard ? [currentActiveTailorRunCard] : []),
    ...parallelTailorRunCards,
  ]);
  const isCurrentPageActiveTailoringVisible = Boolean(
    currentActiveTailorRunCard &&
      currentActiveTailorRunCard.statusDisplayState !== "error",
  );
  const isSuppressingActiveTailoringHydration =
    activeTailoringOverrideState === "overwriting" || isStoppingCurrentTailoring;
  const isTailorPreparationPending =
    isPreparingTailorStart || Boolean(tailorPreparationState);
  const tailorPreparationMessage =
    tailorPreparationState?.message?.trim() ||
    buildTailorResumePreparationMessage(false);
  const originalResume = personalInfo?.originalResume ?? null;
  const isSettingsNonTechnologiesChanged =
    draftSettingsNonTechnologies.join("\n") !==
    savedSettingsUserMarkdown.nonTechnologies.join("\n");
  const isSettingsUserMarkdownChanged =
    draftSettingsUserMarkdown !== savedSettingsUserMarkdown.markdown;
  const canSaveSettingsSpareBullet =
    draftSettingsSpareBulletQuote.trim().length > 0 &&
    draftSettingsSpareBulletExperienceId.trim().length > 0 &&
    splitSettingsSkillNames(draftSettingsSpareBulletSkillNames).length > 0;
  const settingsSkillsOnlySkills = settingsSkillData.skills.filter(
    (skill) => skill.listInSkillsOnly,
  );
  const canSaveSettingsSkillsOnly =
    draftSettingsSkillsOnlyName.trim().length > 0;
  const canSaveSettingsSpareBulletEdit =
    settingsSpareBulletEditDraft !== null &&
    settingsSpareBulletEditDraft.quote.trim().length > 0 &&
    settingsSpareBulletEditDraft.resumeExperienceId.trim().length > 0 &&
    splitSettingsSkillNames(settingsSpareBulletEditDraft.skillNames).length > 0;
  const visibleSettingsSpareBullets = useMemo(
    () =>
      filterTailorResumeSpareBulletsForSearch({
        mode: settingsSpareBulletSearchMode,
        query: settingsSpareBulletSearchQuery,
        spareBullets: settingsSkillData.spareBullets,
      }),
    [
      settingsSkillData.spareBullets,
      settingsSpareBulletSearchMode,
      settingsSpareBulletSearchQuery,
    ],
  );
  const isSettingsSpareBulletSearchActive =
    settingsSpareBulletSearchQuery.trim().length > 0;
  const isTailorInterviewAwaitingCompletion = Boolean(
    tailorInterview?.completionRequestedAt,
  );
  const tailorInterviewFinishRequestKey =
    tailorInterview?.completionRequestedAt
      ? `${tailorInterview.id}:${tailorInterview.completionRequestedAt}`
      : null;
  const displayedTailorInterviewConversation = tailorInterview
    ? [
        ...tailorInterview.conversation,
        ...(pendingTailorInterviewAnswerMessage &&
        tailorInterview.conversation.at(-1)?.id !==
          pendingTailorInterviewAnswerMessage.id
          ? [pendingTailorInterviewAnswerMessage]
          : []),
        ...(pendingTailorInterviewAssistantMessage &&
        pendingTailorInterviewAssistantMessage.id !==
          tailorInterview.conversation.at(-1)?.id
          ? [pendingTailorInterviewAssistantMessage]
          : []),
      ]
    : [];
  const displayedTailorInterviewMessageCount =
    displayedTailorInterviewConversation.length;
  const lastDisplayedTailorInterviewMessageId =
    displayedTailorInterviewConversation.at(-1)?.id ?? null;
  const latestTailorInterviewAssistantMessage =
    [...displayedTailorInterviewConversation]
      .reverse()
      .find((message) => message.role === "assistant") ?? null;
  const tailorInterviewPreview = buildTailorInterviewPreview(
    latestTailorInterviewAssistantMessage,
  );
  const matchingTailorInterviewRun =
    tailorInterview &&
    lastTailoringRun &&
    sameTailoringJobUrl(tailorInterview.jobUrl, lastTailoringRun.pageUrl)
      ? lastTailoringRun
      : null;
  const matchingTailorInterviewActiveRunCard = tailorInterview
    ? activeTailorRunCards.find(
        (card) =>
          activeTailorRunCardMatchesInterview({
            card,
            interview: tailorInterview,
          }),
      ) ?? null
    : null;
  const matchingTailorInterviewPageContext =
    tailorInterview &&
    currentPageApplicationContext &&
    currentPageIdentity &&
    matchesTailorOverwritePageIdentity({
      jobUrl: tailorInterview.jobUrl,
      pageIdentity: currentPageIdentity,
    })
      ? currentPageApplicationContext
      : null;
  const tailorInterviewHeading = tailorInterview
    ? buildTailoringInterviewHeading({
        companyName:
          tailorInterview.companyName ??
          matchingTailorInterviewRun?.companyName ??
          matchingTailorInterviewPageContext?.companyName ??
          null,
        fallbackTitle: matchingTailorInterviewActiveRunCard?.title ?? null,
        positionTitle:
          tailorInterview.positionTitle ??
          matchingTailorInterviewRun?.positionTitle ??
          matchingTailorInterviewPageContext?.jobTitle ??
          null,
      })
    : "Resume questions";
  const isTailorInterviewAnswerPending = Boolean(pendingTailorInterviewAnswerMessage);
  const hasPendingTailorInterviewAssistantContent = Boolean(
    pendingTailorInterviewAssistantMessage &&
      pendingTailorInterviewAssistantMessage.text.trim(),
  );
  const isGeneratingTailorQuestionForOpenInterview = Boolean(
    tailorInterview?.id &&
      generatingTailorQuestionInterviewId === tailorInterview.id,
  );
  const isTailorInterviewBusy =
    captureState === "finishing" ||
    isTailorInterviewAnswerPending ||
    isStoppingCurrentTailoring ||
    isFinishingTailorInterview ||
    isGeneratingTailorQuestionForOpenInterview;
  const isTailorInterviewThinking =
    Boolean(tailorInterview) &&
    !tailorInterviewError &&
    (isTailorInterviewAnswerPending ||
      isFinishingTailorInterview ||
      isGeneratingTailorQuestionForOpenInterview);
  const shouldShowTailorInterviewThinkingIndicator =
    isTailorInterviewThinking && !hasPendingTailorInterviewAssistantContent;
  const lastTailoringRunMessage = lastTailoringRun?.message?.trim() || null;
  const lastTailoringRunError = lastTailoringRun?.tailoredResumeError?.trim() || null;
  const pageCaptureFailureRun = isPageCaptureFailureRun(currentPageStoredTailoringRun)
    ? currentPageStoredTailoringRun
    : isPageCaptureFailureRun(lastTailoringRun)
      ? lastTailoringRun
      : null;
  const activeTailoring =
    existingTailoringPrompt?.existingTailoring ??
    currentPagePersonalInfoTailoring ??
    null;
  const completedTailoringForDisplay =
    isCurrentPageActiveTailoringVisible
      ? null
      : activeTailoring?.kind === "completed"
        ? activeTailoring
        : currentPageCompletedTailoring;
  const latestTailoredResumeId = resolveReviewableTailoredResumeId({
    completedTailoringId: completedTailoringForDisplay?.tailoredResumeId ?? null,
    currentPageTailoredResumeId: isCurrentPageActiveTailoringVisible
      ? null
      : currentPageCompletedTailoredResume?.id ?? null,
  });
  const topLevelTailoredResumeId =
    isCurrentPageActiveTailoringVisible
      ? null
      : currentPageCompletedTailoredResume?.id ||
        currentPageCompletedTailoring?.tailoredResumeId ||
        latestTailoredResumeId;
  const selectedTailoredResume =
    selectedTailoredResumeId && personalInfo
      ? personalInfo.tailoredResumes.find(
          (tailoredResume) => tailoredResume.id === selectedTailoredResumeId,
        ) ?? null
      : null;
  const focusedTailoredResumeId =
    selectedTailoredResume?.id ?? latestTailoredResumeId ?? null;
  const completedTailoringError =
    completedTailoringForDisplay?.error?.trim() || null;
  const completedTailoringJobLabel = completedTailoringForDisplay?.displayName || null;
  const completedTailoringUpdatedAt =
    completedTailoringForDisplay?.updatedAt || null;
  const completedTailoringCompanyName =
    completedTailoringForDisplay?.companyName ?? null;
  const completedTailoringPositionTitle =
    completedTailoringForDisplay?.positionTitle ?? null;
  const currentPageSuppressedTailoredResumeId =
    existingTailoringPrompt?.existingTailoring.kind === "completed"
      ? existingTailoringPrompt.existingTailoring.tailoredResumeId
      : currentPageCompletedTailoredResume?.id ??
        currentPageCompletedTailoring?.tailoredResumeId ??
        null;
  const currentPageSuppressedApplicationId =
    existingTailoringPrompt?.existingTailoring.applicationId ??
    currentPageCompletedTailoredResume?.applicationId ??
    currentPageCompletedTailoring?.applicationId ??
    currentPageStoredTailoringRun?.applicationId ??
    currentActiveTailorRunCard?.applicationId ??
    null;
  const currentPageVisibilityReferenceUrls = uniqueNonEmptyStrings([
    currentActiveTailorRunCard?.url,
    currentPageUrl,
    currentPageIdentity?.jobUrl,
    currentPageIdentity?.canonicalUrl,
    currentPageIdentity?.pageUrl,
    currentPageStoredTailoringRun?.pageUrl,
    currentPageTailorPreparationState?.pageUrl,
    tailorPreparationState?.pageUrl,
    existingTailoringPrompt?.jobUrl,
    existingTailoringPrompt?.pageContext.canonicalUrl,
    existingTailoringPrompt?.pageContext.url,
    currentPageCompletedTailoredResume?.jobUrl,
    currentPageCompletedTailoring?.jobUrl,
  ]);
  const currentPageSavedTailoringVisibilityReferences =
    isCurrentPageActiveTailoringVisible
      ? (currentPageVisibilityReferenceUrls.length > 0
          ? currentPageVisibilityReferenceUrls
          : [null]
        ).map((url) => ({
          applicationId: currentPageSuppressedApplicationId,
          existingTailoringId: null,
          suppressedTailoredResumeId: currentPageSuppressedTailoredResumeId,
          url,
        }))
      : [];
  const activeTailorRunVisibilityReferences = [
    ...activeTailorRunCards
      .filter((card) => card.statusDisplayState !== "error")
      .map((card) => ({
        applicationId: card.applicationId,
        existingTailoringId: card.existingTailoringId,
        suppressedTailoredResumeId: card.suppressedTailoredResumeId,
        url: card.url,
      })),
    ...Object.values(tailoringRunsByKey)
      .filter(isTransientTailoringRun)
      .map((run) => ({
        applicationId: run.applicationId,
        existingTailoringId: null,
        suppressedTailoredResumeId: run.suppressedTailoredResumeId,
        url: run.pageUrl,
      })),
    ...currentPageSavedTailoringVisibilityReferences,
  ];
  const visibleUnarchivedTailoredResumes = filterVisibleTailoredResumes({
    activeReferences: activeTailorRunVisibilityReferences,
    resumes: unarchivedTailoredResumes,
  });
  const displayedUnarchivedTailoredResumes = useMemo(
    () =>
      filterTailoredResumesForArchiveSearch({
        query: tailoredResumeSearchQuery,
        resumes: visibleUnarchivedTailoredResumes,
      }),
    [tailoredResumeSearchQuery, visibleUnarchivedTailoredResumes],
  );
  const displayedActiveTailorRunCards = filterVisibleTailorRunCardsForSavedResumes({
    cards: activeTailorRunCards,
    resumes: displayedUnarchivedTailoredResumes,
  });
  const shouldRenderUnarchivedResumeLibrary =
    authState.status !== "signedIn" ||
    personalInfoState.status !== "ready" ||
    isTailoredResumeSearchActive ||
    visibleUnarchivedTailoredResumes.length > 0 ||
    displayedUnarchivedTailoredResumes.length > 0;
  const shouldRenderArchivedResumeEmptySurface =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    archivedTailoredResumes.length === 0;
  const isShowingArchivedTailoredResumes =
    tailoredResumeArchiveFilter === "archived";
  const retryableTailorRunCards = displayedActiveTailorRunCards.filter((card) => {
    const targetUrl = card.deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";

    return Boolean(targetUrl);
  });
  const retryableUnarchivedTailoredResumes =
    displayedUnarchivedTailoredResumes.filter((tailoredResume) =>
      Boolean(tailoredResume.jobUrl?.trim()),
    );
  const hasBackgroundTailorRunAction =
    Object.keys(backgroundTailorRunActionStates).length > 0;
  const canRetryTailorRunBatch =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    !isRetryingAllTailorRuns &&
    tailorRunMenuActionState === "idle" &&
    tailoredResumeMenuActionState === "idle" &&
    !hasBackgroundTailorRunAction &&
    !isStoppingCurrentTailoring &&
    !isDeletingAllTailoredResumes &&
    authActionState !== "running" &&
    !isDeletingPersonalItem;
  const canRetryInFlightTailorRuns =
    canRetryTailorRunBatch && retryableTailorRunCards.length > 0;
  const canRetryAllTailorRuns =
    canRetryTailorRunBatch &&
    (retryableTailorRunCards.length > 0 ||
      retryableUnarchivedTailoredResumes.length > 0);
  const canArchiveAllTailoredResumes =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    unarchivedTailoredResumeCount > 0 &&
    !isArchivingAllTailoredResumes &&
    !isDeletingAllTailoredResumes &&
    !hasTailoredResumeArchiveAction &&
    authActionState !== "running" &&
    !isDeletingPersonalItem;
  const canDeleteAllTailoredResumes =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    (unarchivedTailoredResumeCount > 0 ||
      displayedActiveTailorRunCards.length > 0);
  const shouldRenderApplicationsEmptySurface =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    (!personalInfo || personalInfo.applications.length === 0);
  const hasCompletedTailorRun = Boolean(latestTailoredResumeId);
  const hasCompletedTailorRunWarning = Boolean(
    completedTailoringError || (latestTailoredResumeId && lastTailoringRunError),
  );
  const statusDisplayState =
    existingTailoringPrompt
      ? "warning"
      : isTailorPreparationPending
        ? "loading"
        : captureState === "running" || captureState === "finishing"
          ? "loading"
          : hasCompletedTailorRun
            ? hasCompletedTailorRunWarning
              ? "warning"
              : "ready"
            : captureState === "error"
              ? "error"
              : captureState === "blocked"
                ? "ready"
                : captureState === "needs_input" || tailorInterview
                  ? "ready"
                  : state.status;
  const statusMessage =
    isTailorPreparationPending
      ? tailorPreparationMessage
      : captureState === "running"
      ? buildLiveTailorResumeStatusMessage(
          tailorGenerationStep,
          "Tailoring your resume for this job...",
        )
      : captureState === "finishing"
        ? buildLiveTailorResumeStatusMessage(
            tailorGenerationStep,
            "Finishing the tailored resume",
          )
        : captureState === "blocked"
          ? "Existing tailoring work found"
          : captureState === "sent"
            ? lastTailoringRunMessage ||
              "Tailoring finished. Open Preview or Review edits in the side panel."
            : captureState === "needs_input" || tailorInterview
              ? isTailorInterviewAwaitingCompletion
                ? "Review keywords, then press play to start tailoring."
                : "Review keywords, then press play to start tailoring."
              : captureState === "error"
                ? lastTailoringRunMessage ||
                  (authState.status !== "signedIn"
                    ? "Could not start Tailor Resume. Connect Google first."
                    : "Could not start Tailor Resume.")
                : state.status === "idle"
                  ? "Waiting for page details"
                  : state.status === "loading"
                    ? "Reading the active tab"
                    : state.status === "ready"
                      ? "Page details loaded"
                      : state.error;
  const statusDetail =
    captureState === "running" || captureState === "finishing"
      ? buildLiveTailorResumeStatusDetail(tailorGenerationStep)
      : captureState === "error" &&
          lastTailoringRunError &&
          lastTailoringRunError !== lastTailoringRunMessage
        ? lastTailoringRunError
        : null;
  const debugStatusLabel =
    state.status === "ready"
      ? "Live"
      : state.status === "loading"
        ? "Loading"
        : state.status === "error"
          ? "Error"
          : "Idle";
  const debugPageIdentityDisplay =
    state.status === "loading"
      ? "Loading..."
      : readTailorRunDisplayUrl(currentPageUrl) ?? "None";
  const displayedTailorRunUrl =
    existingTailoringPrompt?.jobUrl ??
    activeTailoring?.jobUrl ??
    currentPageCompletedTailoring?.jobUrl ??
    tailorPreparationState?.pageUrl ??
    lastTailoringRun?.pageUrl ??
    currentPageUrl;
  const isTailoringRunOnCurrentPage = tailoringRunMatchesPageContext(
    displayedTailorRunUrl,
    currentPageContext,
  );
  const shouldShowTailorRunShell = shouldRenderTailorRunShell({
    activeTailoringKind: activeTailoring?.kind ?? null,
    captureState,
    hasCurrentPageCompletedTailoring: Boolean(currentPageCompletedTailoring),
    hasExistingTailoringPrompt: Boolean(existingTailoringPrompt),
    hasTailorInterview: Boolean(tailorInterview),
    isStoppingCurrentTailoring,
    isTailorPreparationPending,
    lastTailoringRunStatus: pageCaptureFailureRun
      ? null
      : lastTailoringRun?.status ?? null,
  });
  const shouldUseOptimisticTailorRunIdentity =
    Boolean(existingTailoringPrompt) ||
    isTailorPreparationPending ||
    captureState === "running" ||
    captureState === "finishing" ||
    isStoppingCurrentTailoring;
  const activeTailorRunIdentitySource = activeTailoring
    ? {
        companyName: activeTailoring.companyName,
        positionTitle: activeTailoring.positionTitle,
      }
    : null;
  const completedTailorRunIdentitySource =
    completedTailoringCompanyName || completedTailoringPositionTitle
      ? {
          companyName: completedTailoringCompanyName,
          positionTitle: completedTailoringPositionTitle,
        }
      : null;
  const currentPageTailorRunIdentitySource =
    currentPageApplicationContext?.companyName ||
    currentPageApplicationContext?.jobTitle
      ? {
          companyName: currentPageApplicationContext.companyName ?? null,
          jobTitle: currentPageApplicationContext.jobTitle ?? null,
        }
      : null;
  const lastTailorRunIdentitySource =
    lastTailoringRun?.companyName || lastTailoringRun?.positionTitle
      ? {
          companyName: lastTailoringRun.companyName,
          positionTitle: lastTailoringRun.positionTitle,
        }
      : null;
  const displayedTailorRunIdentity = resolveDisplayedTailorRunIdentity({
    activeTailoring: activeTailorRunIdentitySource,
    completedTailoring: completedTailorRunIdentitySource,
    currentPageApplicationContext: currentPageTailorRunIdentitySource,
    lastTailoringRun: lastTailorRunIdentitySource,
    shouldUseOptimisticTailorRunIdentity,
  });
  const shouldShowTailorRunIdentity = Boolean(displayedTailorRunIdentity);
  const tailorRunProgressSteps = readTailorRunProgressSteps({
    captureState,
    existingTailoring: activeTailoring,
    lastTailoringRun,
    tailorGenerationStep,
    tailorInterview,
  });
  const compactTailorRunStep = readTailorRunCompactStep(tailorRunProgressSteps);
  const compactTailorRunStepLabel = compactTailorRunStep
    ? formatTailorResumeProgressStepLabel({
        label: compactTailorRunStep.label,
        status: compactTailorRunStep.status,
      })
    : null;
  const compactTailorRunAttemptBadgeLabel = compactTailorRunStep
    ? readTailorResumeProgressAttemptBadgeLabel({
        attempt: compactTailorRunStep.attempt,
        status: compactTailorRunStep.status,
      })
    : null;
  const tailorRunMessage =
    activeTailoring?.kind === "active_generation"
      ? buildLiveTailorResumeStatusMessage(
          activeTailoring.lastStep,
          "Tailoring your resume for this job...",
        )
      : activeTailoring?.kind === "pending_interview"
        ? activeTailoring.interviewStatus === "pending"
          ? "Review the classified keywords when you are ready."
          : activeTailoring.interviewStatus === "deciding"
            ? "Classifying the job keywords."
            : isTailorInterviewAwaitingCompletion
              ? "Review keywords, then press play to start tailoring."
              : "Review keywords, then press play to start tailoring."
        : completedTailoringJobLabel
          ? buildCompletedTailoringMessage({
              jobLabel: completedTailoringJobLabel,
              tailoredResumeError: completedTailoringError,
            })
          : latestTailoredResumeId
            ? buildCompletedTailoringMessage({
                jobLabel: buildTailoringJobLabel({
                  companyName: lastTailoringRun?.companyName ?? null,
                  positionTitle: lastTailoringRun?.positionTitle ?? null,
                }),
                tailoredResumeError: lastTailoringRunError,
              })
            : statusMessage;
  const tailorRunDetail =
    activeTailoring?.kind === "active_generation"
      ? buildLiveTailorResumeStatusDetail(activeTailoring.lastStep)
      : activeTailoring?.kind === "pending_interview"
        ? buildExistingTailoringTitle(activeTailoring)
        : completedTailoringError
          ? completedTailoringError
          : statusDetail;
  const activeTailoredResumeReviewRecord =
    focusedTailoredResumeId &&
    tailoredResumeReviewState.record?.id === focusedTailoredResumeId
      ? tailoredResumeReviewState.record
      : null;
  const activeTailoredResumeError =
    activeTailoredResumeReviewRecord?.error?.trim() || null;
  const tailoredPreviewInteractiveQueries = useMemo(() => {
    if (!activeTailoredResumeReviewRecord?.annotatedLatexCode) {
      return null;
    }

    return buildTailoredResumeInteractivePreviewQueries({
      annotatedLatexCode: activeTailoredResumeReviewRecord.annotatedLatexCode,
      edits: activeTailoredResumeReviewRecord.edits,
      sourceAnnotatedLatexCode:
        activeTailoredResumeReviewRecord.sourceAnnotatedLatexCode,
    });
  }, [activeTailoredResumeReviewRecord]);
  const tailoredPreviewHighlightQueries =
    tailoredPreviewInteractiveQueries?.highlightQueries ??
    EMPTY_TAILORED_PREVIEW_HIGHLIGHT_QUERIES;
  const tailoredPreviewFocusEdit =
    activeTailoredResumeReviewRecord?.edits.find(
      (edit) => edit.editId === tailoredPreviewFocusEditId,
    ) ?? null;
  const tailoredPreviewFocusQuery =
    tailoredPreviewFocusEditId && tailoredPreviewInteractiveQueries
      ? tailoredPreviewInteractiveQueries.focusQueryByEditId.get(
          tailoredPreviewFocusEditId,
        ) ?? null
      : null;
  const tailoredPreviewFocusMatchKey = tailoredPreviewFocusEdit
    ? `segment:${tailoredPreviewFocusEdit.segmentId}`
    : null;
  const tailoredResumeReviewError =
    tailoredResumeReviewState.status === "error"
      ? tailoredResumeReviewState.error
      : null;
  const canToggleTailoredPreviewDiffHighlighting = Boolean(
    activeTailoredResumeReviewRecord?.edits.length &&
      activeTailoredResumeReviewRecord?.annotatedLatexCode,
  );
  const shouldShowTailoredPreviewDiffHighlighting =
    isTailoredPreviewDiffHighlightingEnabled &&
    canToggleTailoredPreviewDiffHighlighting;
  const showTailoredPreview = Boolean(latestTailoredResumeId);
  const showTopLevelTailoredWebAction = true;
  const previewButtonLabel = "Preview";
  const quickReviewButtonLabel = "Review edits";
  const debugButtonLabel = "Debug";
  const tailoredRunSavedAtLabel =
    formatTailoredResumeDate(
      completedTailoringUpdatedAt
        ? completedTailoringUpdatedAt
        : lastTailoringRun?.capturedAt ?? "",
    ) || null;
  const shouldShowTailorRunTimestamp = Boolean(
    showTailoredPreview && tailoredRunSavedAtLabel,
  );
  const showTailorRunMenu = true;
  const showRetryTailorRunAction = Boolean(displayedTailorRunUrl);
  const tailorRunDeleteTarget: TailorRunDeleteTarget | null =
    latestTailoredResumeId
      ? {
          jobUrl: displayedTailorRunUrl,
          tailoredResumeId: latestTailoredResumeId,
          tailorRunId: null,
        }
      : existingTailoringPrompt?.existingTailoring
        ? {
            jobUrl:
              existingTailoringPrompt.jobUrl ??
              existingTailoringPrompt.existingTailoring.jobUrl ??
              displayedTailorRunUrl,
            tailoredResumeId:
              existingTailoringPrompt.existingTailoring.kind === "completed"
                ? existingTailoringPrompt.existingTailoring.tailoredResumeId
                : null,
            tailorRunId:
              existingTailoringPrompt.existingTailoring.kind === "completed"
                ? null
                : existingTailoringPrompt.existingTailoring.id,
          }
      : activeTailoring
        ? {
            jobUrl: activeTailoring.jobUrl,
            tailoredResumeId: null,
            tailorRunId:
              activeTailoring.kind === "completed" ? null : activeTailoring.id,
          }
        : lastTailoringRun?.tailoredResumeId ||
            displayedTailorRunUrl ||
            lastTailoringRun?.pageUrl ||
            tailorPreparationState?.pageUrl ||
            currentPageUrl
          ? {
              jobUrl:
                displayedTailorRunUrl ??
                lastTailoringRun?.pageUrl ??
                tailorPreparationState?.pageUrl ??
                currentPageUrl,
              tailoredResumeId: lastTailoringRun?.tailoredResumeId ?? null,
              tailorRunId: null,
            }
          : null;
  const showStopCurrentTailoringAction =
    !existingTailoringPrompt &&
    (isStoppingCurrentTailoring ||
      captureState === "running" ||
      captureState === "finishing" ||
      captureState === "needs_input" ||
      Boolean(tailorInterview) ||
      Boolean(
        currentPagePersonalInfoTailoring &&
          currentPagePersonalInfoTailoring.kind !== "completed",
      ) ||
      isTransientTailoringRun(lastTailoringRun));
  const canDeleteTailorRun = Boolean(
    tailorRunDeleteTarget ||
      existingTailoringPrompt ||
      activeTailoring ||
      lastTailoringRun ||
      tailorPreparationState ||
      tailorInterview ||
      isTailorPreparationPending ||
      captureState !== "idle" ||
      isStoppingCurrentTailoring,
  );
  const showArchiveTailorRunAction = Boolean(topLevelTailoredResumeId);
  const showDeleteTailorRunAction = canDeleteTailorRun;
  const shouldShowTailorRunMetaActions =
    showStopCurrentTailoringAction ||
    showArchiveTailorRunAction ||
    isTailoringRunOnCurrentPage ||
    shouldShowTailorRunTimestamp ||
    showTailorRunMenu;
  const showCompactTailorRunSummary =
    showTailoredPreview &&
    !existingTailoringPrompt;
  const shouldShowTailorRunProgress = !showTailoredPreview;
  const isTailorRunGenerating =
    activeTailoring?.kind === "active_generation" ||
    captureState === "running" ||
    captureState === "finishing" ||
    (!showTailoredPreview && lastTailoringRun?.status === "running");
  const shouldShowTailorRunFocusedStep =
    shouldShowTailorRunProgress &&
    Boolean(compactTailorRunStep) &&
    compactTailorRunStep.status !== "pending";
  const shouldShowTailorRunCopy =
    !showTailoredPreview &&
    !isTailorRunGenerating &&
    Boolean(tailorRunMessage || tailorRunDetail);
  const shouldShowTailorRunDetail =
    shouldShowTailorRunCopy && Boolean(tailorRunDetail);
  const showPreviewTailorRunAction = Boolean(latestTailoredResumeId);
  const showQuickReviewTailorRunAction = Boolean(latestTailoredResumeId);
  const showDebugTailorRunAction =
    EXTENSION_DEBUG_UI_ENABLED && Boolean(focusedTailoredResumeId);
  const isTailorRunShellOverlayActive =
    Boolean(existingTailoringPrompt) || isTailorPreparationPending;
  const shouldObscureTailorRunBody = Boolean(existingTailoringPrompt);
  const shouldRenderLegacyTailorRunShell =
    !matchingTailorInterviewActiveRunCard &&
    resolveShouldRenderLegacyTailorRunShell({
      hasCurrentPageCompletedTailoring,
      hasCurrentPageExistingTailoringPrompt: Boolean(existingTailoringPrompt),
      hasCurrentPageRunCard: Boolean(currentActiveTailorRunCard),
      shouldShowTailorRunShell,
    });
  const shouldShowLegacyTailorRunElapsedTime =
    shouldRenderLegacyTailorRunShell &&
    statusDisplayState === "loading" &&
    shouldShowTailorRunFocusedStep;
  const tailorRunTimeDisplayMode = extensionPreferences.tailorRunTimeDisplayMode;
  const hasLoadingTailorRunTimer =
    displayedActiveTailorRunCards.some(
      (card) => card.statusDisplayState === "loading",
    ) || shouldShowLegacyTailorRunElapsedTime;
  const legacyTailorRunElapsedStartTime = readActiveTailorRunSortTime(
    tailorPreparationState?.capturedAt ??
      (activeTailoring?.kind === "active_generation"
        ? activeTailoring.createdAt
        : null) ??
      (lastTailoringRun?.status === "running"
        ? lastTailoringRun.capturedAt
        : null),
  );
  const legacyTailorRunElapsedTimeLabel =
    shouldShowLegacyTailorRunElapsedTime
      ? formatTailorRunStepTimeDisplay({
          activeStepNumber: compactTailorRunStep?.stepNumber ?? null,
          mode: tailorRunTimeDisplayMode,
          nowTime: tailorRunElapsedNow,
          runStartedAtTime: legacyTailorRunElapsedStartTime,
          timings: buildTailorRunStepTimingDisplayInputs(
            tailorGenerationStepTimings,
          ),
        })
      : null;
  const hasUnarchivedTailorItems =
    visibleUnarchivedTailoredResumes.length > 0 ||
    displayedActiveTailorRunCards.length > 0 ||
    Boolean(pageCaptureFailureRun) ||
    Boolean(currentPageArchivedTailoredResume) ||
    shouldRenderLegacyTailorRunShell;
  const shouldRenderUnarchivedResumeEmptySurface =
    authState.status === "signedIn" &&
    personalInfoState.status === "ready" &&
    !hasUnarchivedTailorItems;
  const unarchivedTailorDisplayCount =
    displayedUnarchivedTailoredResumes.length +
    displayedActiveTailorRunCards.length +
    (pageCaptureFailureRun ? 1 : 0) +
    (shouldRenderLegacyTailorRunShell &&
    displayedUnarchivedTailoredResumes.length === 0 &&
    displayedActiveTailorRunCards.length === 0
      ? 1
      : 0);
  const unarchivedTailorDeleteCount =
    unarchivedTailoredResumeCount + displayedActiveTailorRunCards.length;
  const showFullscreenTailorRunDetail =
    Boolean(activeTailorRunDetailView && focusedTailoredResumeId);
  const activeTailorRunDetailIdentity =
    selectedTailoredResume?.displayName ?? displayedTailorRunIdentity?.label ?? null;
  const shouldShowTailorAuthPrompt =
    activePanelTab === "tailor" &&
    isTailorAuthPromptOpen &&
    authState.status !== "signedIn";

  useEffect(() => {
    if (!hasLoadingTailorRunTimer) {
      return;
    }

    const updateElapsedTime = () => setTailorRunElapsedNow(Date.now());

    updateElapsedTime();
    const intervalId = window.setInterval(updateElapsedTime, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasLoadingTailorRunTimer]);

  useEffect(() => {
    if (!isTailorRunMenuOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (tailorRunMenuActionState !== "idle") {
        return;
      }

      if (!tailorRunMenuRef.current?.contains(event.target as Node)) {
        setIsTailorRunMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (tailorRunMenuActionState !== "idle") {
        return;
      }

      if (event.key === "Escape") {
        setIsTailorRunMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTailorRunMenuOpen, tailorRunMenuActionState]);

  useEffect(() => {
    setIsTailorRunMenuOpen(false);
    setTailorRunMenuError(null);
  }, [displayedTailorRunUrl]);

  useEffect(() => {
    if (!backgroundTailorRunMenuId) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (backgroundTailorRunActionStates[backgroundTailorRunMenuId]) {
        return;
      }

      if (!backgroundTailorRunMenuRef.current?.contains(event.target as Node)) {
        setBackgroundTailorRunMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (backgroundTailorRunActionStates[backgroundTailorRunMenuId]) {
        return;
      }

      if (event.key === "Escape") {
        setBackgroundTailorRunMenuId(null);
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [backgroundTailorRunActionStates, backgroundTailorRunMenuId]);

  useEffect(() => {
    if (
      backgroundTailorRunMenuId &&
      !parallelTailorRunCards.some((card) => card.id === backgroundTailorRunMenuId)
    ) {
      setBackgroundTailorRunMenuId(null);
      setBackgroundTailorRunMenuError(null);
      setBackgroundTailorRunMenuErrorCardId(null);
    }
  }, [backgroundTailorRunMenuId, parallelTailorRunCards]);

  useEffect(() => {
    if (!tailoredResumeMenuId) {
      setTailoredResumeMenuPosition(null);
      return;
    }

    updateTailoredResumeMenuPosition();

    const handleMouseDown = (event: MouseEvent) => {
      if (tailoredResumeMenuActionState !== "idle") {
        return;
      }

      const clickedNode = event.target as Node;
      const clickedInsideShell = tailoredResumeMenuRef.current?.contains(
        clickedNode,
      );
      const clickedInsidePopover = tailoredResumeMenuPopoverRef.current?.contains(
        clickedNode,
      );

      if (!clickedInsideShell && !clickedInsidePopover) {
        setTailoredResumeMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (tailoredResumeMenuActionState !== "idle") {
        return;
      }

      if (event.key === "Escape") {
        setTailoredResumeMenuId(null);
      }
    };

    const handleViewportChange = () => {
      updateTailoredResumeMenuPosition();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [
    tailoredResumeMenuActionState,
    tailoredResumeMenuId,
    updateTailoredResumeMenuPosition,
  ]);

  useEffect(() => {
    if (!tailoredResumeMenuId || !tailoredResumeMenuPosition) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      updateTailoredResumeMenuPosition();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    tailoredResumeMenuId,
    tailoredResumeMenuPosition,
    updateTailoredResumeMenuPosition,
  ]);

  useEffect(() => {
    if (
      tailoredResumeMenuId &&
      !personalInfo?.tailoredResumes.some(
        (tailoredResume) => tailoredResume.id === tailoredResumeMenuId,
      )
    ) {
      setTailoredResumeMenuId(null);
      setTailoredResumeMenuError(null);
      setTailoredResumeMenuErrorResumeId(null);
      setTailoredResumeMenuPosition(null);
    }
  }, [personalInfo?.tailoredResumes, tailoredResumeMenuId]);

  useEffect(() => {
    if (
      selectedTailoredResumeId &&
      !personalInfo?.tailoredResumes.some(
        (tailoredResume) => tailoredResume.id === selectedTailoredResumeId,
      )
    ) {
      setSelectedTailoredResumeId(null);
      setActiveTailorRunDetailView(null);
    }
  }, [personalInfo?.tailoredResumes, selectedTailoredResumeId]);

  function beginTailorRequest() {
    activeTailorRequestAbortControllerRef.current?.abort();
    const controller = new AbortController();
    activeTailorRequestAbortControllerRef.current = controller;
    return controller;
  }

  function clearTailorRequest(controller: AbortController) {
    if (activeTailorRequestAbortControllerRef.current === controller) {
      activeTailorRequestAbortControllerRef.current = null;
    }
  }

  function dismissTailorInterviewFinishPrompt() {
    if (tailorInterviewFinishRequestKey) {
      dismissedTailorInterviewFinishRequestRef.current =
        tailorInterviewFinishRequestKey;
    }

    setIsTailorInterviewFinishPromptOpen(false);
  }

  const revealTailorInterview = useCallback(
    (options: { focusComposer?: boolean } = {}) => {
      dismissedTailorInterviewPageIdRef.current = null;
      setIsTailorInterviewOpen(true);

      window.requestAnimationFrame(() => {
        tailorInterviewCardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

        if (!options.focusComposer) {
          return;
        }

        window.requestAnimationFrame(() => {
          tailorInterviewInputRef.current?.focus({ preventScroll: true });
        });
      });
    },
    [],
  );

  function closeTailorInterviewPage() {
    if (tailorInterview?.id) {
      dismissedTailorInterviewPageIdRef.current = tailorInterview.id;
    }

    setIsTailorInterviewOpen(false);
  }

  function openTailorRunDetailView(
    nextView: TailorRunDetailView,
    tailoredResumeId: string | null = null,
  ) {
    setSelectedTailoredResumeId(tailoredResumeId);
    setActiveTailorRunDetailView(nextView);
  }

  function closeTailorRunDetailView() {
    setActiveTailorRunDetailView(null);
    setSelectedTailoredResumeId(null);
  }

  function prepareSettingsSurface() {
    setIsSettingsOriginalResumeOpen(false);
    setIsSettingsUserMarkdownOpen(false);
    setSettingsUserMarkdownError(null);
    setSettingsNonTechnologyError(null);
    setSettingsSpareBulletError(null);
    setKeywordCoverageSettingError(null);
  }

  function handlePanelTabClick(nextPanelTab: PanelTab) {
    if (nextPanelTab === "settings" && activePanelTab !== "settings") {
      prepareSettingsSurface();
    }

    setActivePanelTab(nextPanelTab);
  }

  function cancelSettingsUserMarkdownEdits() {
    setDraftSettingsUserMarkdown(savedSettingsUserMarkdown.markdown);
    setSettingsUserMarkdownError(null);
    setIsSettingsUserMarkdownOpen(false);
  }

  function cancelSettingsNonTechnologyEdits() {
    setDraftSettingsNonTechnologies(savedSettingsUserMarkdown.nonTechnologies);
    setDraftSettingsNonTechnologyInput("");
    setSettingsNonTechnologyError(null);
  }

  function addSettingsNonTechnology() {
    const normalizedTerm = normalizeNonTechnologyTerm(
      draftSettingsNonTechnologyInput,
    );

    if (!normalizedTerm) {
      return;
    }

    try {
      setDraftSettingsNonTechnologies((currentTerms) =>
        normalizeNonTechnologyTerms([...currentTerms, normalizedTerm]),
      );
      setDraftSettingsNonTechnologyInput("");
      setSettingsNonTechnologyError(null);
    } catch (error) {
      setSettingsNonTechnologyError(
        error instanceof Error
          ? error.message
          : "Unable to add non-technology term.",
      );
    }
  }

  function removeSettingsNonTechnology(term: string) {
    const normalizedTerm = normalizeNonTechnologyTerm(term);

    setDraftSettingsNonTechnologies((currentTerms) =>
      currentTerms.filter(
        (currentTerm) =>
          normalizeNonTechnologyTerm(currentTerm) !== normalizedTerm,
      ),
    );
    setSettingsNonTechnologyError(null);
  }

  function chooseDefaultSettingsSpareBulletExperience(
    skillData: TailorResumeStoredSkillData,
  ) {
    return skillData.resumeExperiences[0]?.id ?? "";
  }

  function applySettingsSkillData(
    nextSkillData: TailorResumeStoredSkillData,
    options: { preserveEditDraft?: boolean } = {},
  ) {
    setSettingsSkillData(nextSkillData);
    setDraftSettingsSpareBulletExperienceId((currentValue) =>
      nextSkillData.resumeExperiences.some(
        (experience) => experience.id === currentValue,
      )
        ? currentValue
        : chooseDefaultSettingsSpareBulletExperience(nextSkillData),
    );
    setSettingsSpareBulletEditDraft((currentDraft) => {
      if (!options.preserveEditDraft) {
        return null;
      }

      return currentDraft &&
        nextSkillData.spareBullets.some(
          (spareBullet) => spareBullet.id === currentDraft.id,
        )
        ? currentDraft
        : null;
    });
  }

  function clearSettingsSpareBulletForm(
    skillData: TailorResumeStoredSkillData = settingsSkillData,
  ) {
    setDraftSettingsSpareBulletExperienceId(
      chooseDefaultSettingsSpareBulletExperience(skillData),
    );
    setDraftSettingsSpareBulletSkillNames("");
    setDraftSettingsSpareBulletQuote("");
    setDraftSettingsSpareBulletReplacesQuote("");
    setSettingsSpareBulletError(null);
  }

  function editSettingsSpareBullet(
    spareBullet: TailorResumeStoredSkillData["spareBullets"][number],
  ) {
    setSettingsSpareBulletEditDraft({
      id: spareBullet.id,
      quote: spareBullet.quote,
      replacesQuote: spareBullet.replacesQuote ?? "",
      resumeExperienceId: spareBullet.resumeExperienceId,
      skillNames: formatSettingsSpareBulletSkills(spareBullet),
    });
    setSettingsSpareBulletError(null);
  }

  function updateSettingsSpareBulletEditDraft(
    patch: Partial<Omit<SettingsSpareBulletEditDraft, "id">>,
  ) {
    setSettingsSpareBulletEditDraft((currentDraft) =>
      currentDraft ? { ...currentDraft, ...patch } : currentDraft,
    );
  }

  async function patchSettingsSkillData(body: Record<string, unknown>) {
    if (authState.status !== "signedIn") {
      return null;
    }

    const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authState.session.sessionToken}`,
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      await invalidateAuthSession();
      return null;
    }

    if (!response.ok) {
      throw new Error(
        readTailorResumePayloadError(
          payload,
          "Unable to save resume bullet support.",
        ),
      );
    }

    return readTailorResumeStoredSkillData(payload);
  }

  async function saveSettingsSkillsOnlySupport() {
    if (!canSaveSettingsSkillsOnly) {
      return;
    }

    setIsSavingSettingsSkillsOnly(true);
    setSettingsSkillsOnlyError(null);

    try {
      const nextSkillData = await patchSettingsSkillData({
        action: "saveSkill",
        listInSkillsOnly: true,
        name: draftSettingsSkillsOnlyName.trim(),
      });

      if (nextSkillData) {
        applySettingsSkillData(nextSkillData, { preserveEditDraft: true });
        setDraftSettingsSkillsOnlyName("");
        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } catch (error) {
      setSettingsSkillsOnlyError(
        error instanceof Error
          ? error.message
          : "Unable to save skills-only support.",
      );
    } finally {
      setIsSavingSettingsSkillsOnly(false);
    }
  }

  async function deleteSettingsSkillsOnlySupport(skillId: string) {
    setIsSavingSettingsSkillsOnly(true);
    setSettingsSkillsOnlyError(null);

    try {
      const nextSkillData = await patchSettingsSkillData({
        action: "deleteSkill",
        id: skillId,
      });

      if (nextSkillData) {
        applySettingsSkillData(nextSkillData, { preserveEditDraft: true });
        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } catch (error) {
      setSettingsSkillsOnlyError(
        error instanceof Error
          ? error.message
          : "Unable to remove skills-only support.",
      );
    } finally {
      setIsSavingSettingsSkillsOnly(false);
    }
  }

  const measureSettingsSpareBulletLineCount = useCallback(
    async (input: SettingsSpareBulletLineMeasurementInput) => {
      if (authState.status !== "signedIn") {
        return null;
      }

      const measurementKey = buildSettingsSpareBulletMeasurementKey(input);
      const cachedMeasurement = settingsSpareBulletLineMeasurementCacheRef.current.get(
        measurementKey,
      );

      if (measurementKey && cachedMeasurement !== undefined) {
        return cachedMeasurement;
      }

      const measurementPromise = fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
        body: JSON.stringify({
          action: "measureSpareBullet",
          quote: input.quote,
          resumeExperienceId: input.resumeExperienceId,
        }),
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        await invalidateAuthSession();
        return null;
      }

      if (!response.ok) {
        throw new Error(
          readTailorResumePayloadError(
            payload,
            "Unable to measure the rendered bullet line count.",
          ),
        );
      }

      const measurement = isRecord(payload)
        ? readTailorResumeSpareBulletLineMeasurement(
            payload.spareBulletMeasurement,
          )
        : null;

      if (!measurement) {
        throw new Error("Unable to measure the rendered bullet line count.");
      }

      return measurement;
      });

      if (measurementKey) {
        settingsSpareBulletLineMeasurementCacheRef.current.set(
          measurementKey,
          measurementPromise,
        );
      }

      try {
        const measurement = await measurementPromise;

        if (measurementKey) {
          settingsSpareBulletLineMeasurementCacheRef.current.set(
            measurementKey,
            measurement,
          );
          setSettingsSpareBulletLineMeasurementCacheVersion(
            (version) => version + 1,
          );
        }

        return measurement;
      } catch (error) {
        if (measurementKey) {
          settingsSpareBulletLineMeasurementCacheRef.current.delete(
            measurementKey,
          );
        }

        throw error;
      }
    },
    [authState, invalidateAuthSession],
  );

  function readSettingsSpareBulletCachedLineMeasurement(
    input: SettingsSpareBulletLineMeasurementInput,
  ) {
    // Keep render subscribed to cache writes so saved bullets show measurements immediately.
    void settingsSpareBulletLineMeasurementCacheVersion;
    const measurementKey = buildSettingsSpareBulletMeasurementKey(input);

    if (!measurementKey) {
      return null;
    }

    const cachedMeasurement =
      settingsSpareBulletLineMeasurementCacheRef.current.get(measurementKey);

    if (
      cachedMeasurement &&
      typeof (cachedMeasurement as PromiseLike<unknown>).then !== "function"
    ) {
      return cachedMeasurement as TailorResumeSpareBulletLineMeasurement;
    }

    return null;
  }

  async function saveSettingsSpareBullet() {
    if (!canSaveSettingsSpareBullet) {
      return;
    }

    setIsSavingSettingsSpareBullet(true);
    setSettingsSpareBulletError(null);

    try {
      const nextSkillData = await patchSettingsSkillData({
        action: "saveSpareBullet",
        id: null,
        quote: draftSettingsSpareBulletQuote,
        replacesQuote: draftSettingsSpareBulletReplacesQuote.trim() || null,
        resumeExperienceId: draftSettingsSpareBulletExperienceId,
        skillNames: splitSettingsSkillNames(draftSettingsSpareBulletSkillNames),
      });

      if (nextSkillData) {
        applySettingsSkillData(nextSkillData, { preserveEditDraft: true });
        clearSettingsSpareBulletForm(nextSkillData);
        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } catch (error) {
      setSettingsSpareBulletError(
        error instanceof Error
          ? error.message
          : "Unable to save resume bullet support.",
      );
    } finally {
      setIsSavingSettingsSpareBullet(false);
    }
  }

  async function saveSettingsSpareBulletEdit() {
    if (!settingsSpareBulletEditDraft || !canSaveSettingsSpareBulletEdit) {
      return;
    }

    setIsSavingSettingsSpareBullet(true);
    setSettingsSpareBulletError(null);

    try {
      const nextSkillData = await patchSettingsSkillData({
        action: "saveSpareBullet",
        id: settingsSpareBulletEditDraft.id,
        quote: settingsSpareBulletEditDraft.quote,
        replacesQuote: settingsSpareBulletEditDraft.replacesQuote.trim() || null,
        resumeExperienceId: settingsSpareBulletEditDraft.resumeExperienceId,
        skillNames: splitSettingsSkillNames(
          settingsSpareBulletEditDraft.skillNames,
        ),
      });

      if (nextSkillData) {
        setSettingsSpareBulletEditDraft(null);
        applySettingsSkillData(nextSkillData);
        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } catch (error) {
      setSettingsSpareBulletError(
        error instanceof Error
          ? error.message
          : "Unable to save resume bullet support.",
      );
    } finally {
      setIsSavingSettingsSpareBullet(false);
    }
  }

  async function deleteSettingsSpareBullet(spareBulletId: string) {
    setIsSavingSettingsSpareBullet(true);
    setSettingsSpareBulletError(null);

    try {
      const nextSkillData = await patchSettingsSkillData({
        action: "deleteSpareBullet",
        id: spareBulletId,
      });

      if (nextSkillData) {
        applySettingsSkillData(nextSkillData);

        if (settingsSpareBulletEditDraft?.id === spareBulletId) {
          setSettingsSpareBulletEditDraft(null);
        }

        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } catch (error) {
      setSettingsSpareBulletError(
        error instanceof Error
          ? error.message
          : "Unable to delete resume bullet support.",
      );
    } finally {
      setIsSavingSettingsSpareBullet(false);
    }
  }

  function applySavedUserMarkdown(nextUserMarkdown: UserMarkdownSummary) {
    setSavedSettingsUserMarkdown(nextUserMarkdown);
    setDraftSettingsUserMarkdown(nextUserMarkdown.markdown);
    setDraftSettingsNonTechnologies(nextUserMarkdown.nonTechnologies);
    setDraftSettingsNonTechnologyInput("");
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: {
              ...currentState.personalInfo,
              userMemory: {
                nonTechnologyNames: nextUserMarkdown.nonTechnologies,
                updatedAt: nextUserMarkdown.updatedAt,
                userMarkdown: nextUserMarkdown,
              },
              userMarkdown: nextUserMarkdown,
            },
            status: "ready",
          }
        : currentState,
    );
  }

  async function persistUserMarkdown(input: {
    markdown: string;
    nonTechnologies: readonly string[];
    updatedAt: string | null;
  }) {
    if (authState.status !== "signedIn") {
      return null;
    }

    const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      body: JSON.stringify({
        action: "saveUserMarkdown",
        markdown: input.markdown,
        nonTechnologyNames: input.nonTechnologies,
        updatedAt: input.updatedAt,
      }),
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authState.session.sessionToken}`,
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      nonTechnologyNames?: string[];
      userMarkdown?: {
        markdown?: string;
        nonTechnologies?: string[];
        updatedAt?: string | null;
      };
      userMemory?: {
        nonTechnologyNames?: string[];
        updatedAt?: string | null;
        userMarkdown?: {
          markdown?: string;
          updatedAt?: string | null;
        };
      };
    };

    if (response.status === 401) {
      await invalidateAuthSession();
      return null;
    }

    const nextMarkdown =
      payload.userMemory?.userMarkdown?.markdown ??
      payload.userMarkdown?.markdown;
    const nextNonTechnologies =
      payload.userMemory?.nonTechnologyNames ??
      payload.nonTechnologyNames ??
      payload.userMarkdown?.nonTechnologies;
    const nextUpdatedAt =
      payload.userMemory?.updatedAt ??
      payload.userMemory?.userMarkdown?.updatedAt ??
      payload.userMarkdown?.updatedAt ??
      null;

    if (!response.ok || typeof nextMarkdown !== "string") {
      throw new Error(
        readTailorResumePayloadError(payload, "Unable to save USER.md."),
      );
    }

    return {
      markdown: nextMarkdown,
      nonTechnologies: normalizeNonTechnologyTerms(nextNonTechnologies ?? []),
      updatedAt: nextUpdatedAt,
    } satisfies UserMarkdownSummary;
  }

  async function refreshTailorInterviewKeywordBadge(
    nonTechnologyNames: readonly string[],
  ) {
    if (!tailorInterview) {
      return;
    }

    const cardTechnologies =
      matchingTailorInterviewActiveRunCard?.emphasizedTechnologies ?? [];
    const emphasizedTechnologies = (
      cardTechnologies.length > 0
        ? cardTechnologies
        : tailorInterview.emphasizedTechnologies
    ).filter((technology) => technology.name.trim().length > 0);
    const matchingCurrentPageUrl =
      matchingTailorInterviewPageContext && currentPageIdentity
        ? currentPageIdentity.jobUrl ??
          currentPageIdentity.canonicalUrl ??
          currentPageIdentity.pageUrl ??
          currentPageUrl
        : null;
    const jobUrl =
      tailorInterview.jobUrl ??
      matchingTailorInterviewActiveRunCard?.url ??
      matchingCurrentPageUrl;

    if (!jobUrl || emphasizedTechnologies.length === 0) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        payload: {
          badgeKey: matchingTailorInterviewActiveRunCard
            ? buildActiveTailorRunKeywordBadgeKey(
                matchingTailorInterviewActiveRunCard,
              )
            : `tailor-run-keywords:${
                buildTailorRunRegistryKey(jobUrl) ??
                tailorInterview.tailorResumeRunId ??
                tailorInterview.id
              }`,
          displayName: tailorInterviewHeading,
          emphasizedTechnologies,
          includeLowPriorityTermsInKeywordCoverage: false,
          jobUrl,
          nonTechnologyNames: normalizeNonTechnologyTerms([
            ...nonTechnologyNames,
          ]),
        },
        type: "JOB_HELPER_REFRESH_KEYWORD_BADGE",
      });
    } catch {
      // Some job pages cannot receive extension messages; the side panel still updates.
    }
  }

  async function saveSettingsUserMarkdown() {
    if (authState.status !== "signedIn") {
      return;
    }

    if (!isSettingsUserMarkdownChanged) {
      setSettingsUserMarkdownError(null);
      setIsSettingsUserMarkdownOpen(false);
      return;
    }

    setIsSavingSettingsUserMarkdown(true);
    setSettingsUserMarkdownError(null);

    try {
      const nextUserMarkdown = await persistUserMarkdown({
        markdown: draftSettingsUserMarkdown,
        nonTechnologies: savedSettingsUserMarkdown.nonTechnologies,
        updatedAt: savedSettingsUserMarkdown.updatedAt,
      });

      if (nextUserMarkdown) {
        applySavedUserMarkdown(nextUserMarkdown);
        setIsSettingsUserMarkdownOpen(false);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save USER.md.";
      setSettingsUserMarkdownError(message);
    } finally {
      setIsSavingSettingsUserMarkdown(false);
    }
  }

  async function saveSettingsNonTechnologies() {
    if (authState.status !== "signedIn") {
      return;
    }

    if (!isSettingsNonTechnologiesChanged) {
      setSettingsNonTechnologyError(null);
      return;
    }

    setIsSavingSettingsNonTechnologies(true);
    setSettingsNonTechnologyError(null);

    try {
      const nextUserMarkdown = await persistUserMarkdown({
        markdown: savedSettingsUserMarkdown.markdown,
        nonTechnologies: draftSettingsNonTechnologies,
        updatedAt: savedSettingsUserMarkdown.updatedAt,
      });

      if (nextUserMarkdown) {
        applySavedUserMarkdown(nextUserMarkdown);
        void refreshTailorInterviewKeywordBadge(
          nextUserMarkdown.nonTechnologies,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save non-technology terms.";
      setSettingsNonTechnologyError(message);
    } finally {
      setIsSavingSettingsNonTechnologies(false);
    }
  }

  async function updateKeywordCoveragePriorityScope(
    includeLowPriorityTerms: boolean,
  ) {
    if (authState.status !== "signedIn") {
      setKeywordCoverageSettingError(
        "Connect Google before changing the coverage percentage basis.",
      );
      return;
    }

    if (
      includeLowPriorityTermsInKeywordCoverage === includeLowPriorityTerms ||
      isSavingKeywordCoverageSetting
    ) {
      return;
    }

    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const optimisticPersonalInfo = previousPersonalInfo
      ? {
          ...previousPersonalInfo,
          generationSettings: {
            ...previousPersonalInfo.generationSettings,
            includeLowPriorityTermsInKeywordCoverage: includeLowPriorityTerms,
          },
        }
      : null;

    setIsSavingKeywordCoverageSetting(true);
    setKeywordCoverageSettingError(null);

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    try {
      const result = await patchTailorResume({
        action: "saveGenerationSettings",
        generationSettings: {
          includeLowPriorityTermsInKeywordCoverage: includeLowPriorityTerms,
        },
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to save the coverage percentage basis.",
          ),
        );
      }

      const nextGenerationSettings =
        readTailorResumeGenerationSettingsSummary(result.payload);

      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        const nextPersonalInfo = {
          ...currentState.personalInfo,
          generationSettings: nextGenerationSettings,
        };

        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);

        return {
          personalInfo: nextPersonalInfo,
          status: "ready",
        };
      });

      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save the coverage percentage basis.";

      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setKeywordCoverageSettingError(message);
    } finally {
      setIsSavingKeywordCoverageSetting(false);
    }
  }

  async function updateLudicrousMode(nextValue: boolean) {
    if (authState.status !== "signedIn") {
      setKeywordCoverageSettingError(
        "Connect Google before changing Ludicrous Mode.",
      );
      return;
    }

    if (ludicrousMode === nextValue || isSavingKeywordCoverageSetting) {
      return;
    }

    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const optimisticPersonalInfo = previousPersonalInfo
      ? {
          ...previousPersonalInfo,
          generationSettings: {
            ...previousPersonalInfo.generationSettings,
            ludicrousMode: nextValue,
          },
        }
      : null;

    setIsSavingKeywordCoverageSetting(true);
    setKeywordCoverageSettingError(null);

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    try {
      const result = await patchTailorResume({
        action: "saveGenerationSettings",
        generationSettings: {
          ludicrousMode: nextValue,
        },
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to save Ludicrous Mode.",
          ),
        );
      }

      const nextGenerationSettings =
        readTailorResumeGenerationSettingsSummary(result.payload);

      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        const nextPersonalInfo = {
          ...currentState.personalInfo,
          generationSettings: nextGenerationSettings,
        };

        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);

        return {
          personalInfo: nextPersonalInfo,
          status: "ready",
        };
      });

      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save Ludicrous Mode.";

      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setKeywordCoverageSettingError(message);
    } finally {
      setIsSavingKeywordCoverageSetting(false);
    }
  }

  async function updateResumeDownloadNaming(
    updates: {
      customResumeDownloadName?: string;
      useCustomResumeDownloadName?: boolean;
    },
  ) {
    if (authState.status !== "signedIn") {
      setKeywordCoverageSettingError(
        "Connect Google before changing resume download names.",
      );
      return;
    }

    if (isSavingKeywordCoverageSetting) {
      return;
    }

    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const nextGenerationSettings = previousPersonalInfo
      ? {
          ...previousPersonalInfo.generationSettings,
          ...updates,
        }
      : null;
    const optimisticPersonalInfo =
      previousPersonalInfo && nextGenerationSettings
        ? {
            ...previousPersonalInfo,
            generationSettings: nextGenerationSettings,
          }
        : null;

    setIsSavingKeywordCoverageSetting(true);
    setKeywordCoverageSettingError(null);

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    try {
      const result = await patchTailorResume({
        action: "saveGenerationSettings",
        generationSettings: updates,
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to save resume download naming.",
          ),
        );
      }

      const savedGenerationSettings =
        readTailorResumeGenerationSettingsSummary(result.payload);

      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        const nextPersonalInfo = {
          ...currentState.personalInfo,
          generationSettings: savedGenerationSettings,
        };

        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);

        return {
          personalInfo: nextPersonalInfo,
          status: "ready",
        };
      });

      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setKeywordCoverageSettingError(
        error instanceof Error
          ? error.message
          : "Unable to save resume download naming.",
      );
    } finally {
      setIsSavingKeywordCoverageSetting(false);
    }
  }

  function openTailorAuthPrompt() {
    setActivePanelTab("tailor");
    setIsTailorAuthPromptOpen(true);
  }

  async function updateTailorRunTimeDisplayMode(
    mode: TailorRunTimeDisplayMode,
  ) {
    const nextPreferences = {
      ...extensionPreferences,
      tailorRunTimeDisplayMode: mode,
    };

    setExtensionPreferences(nextPreferences);
    await chrome.storage.local.set({
      [EXTENSION_PREFERENCES_STORAGE_KEY]: nextPreferences,
    });
  }

  async function dismissSupportChatTip() {
    const nextPreferences = {
      ...extensionPreferences,
      supportChatTipDismissed: true,
    };

    setExtensionPreferences(nextPreferences);

    try {
      await chrome.storage.local.set({
        [EXTENSION_PREFERENCES_STORAGE_KEY]: nextPreferences,
      });
    } catch (error) {
      console.error("Could not dismiss the resume chat tip.", error);
    }
  }

  function handleOpenChat() {
    if (authState.status === "signedIn") {
      setChatMessages([]);
      setChatStatus("loading");
      setChatError(null);
    } else {
      setChatMessages((currentMessages) =>
        currentMessages.length === 0 ? currentMessages : [],
      );
      setChatStatus("idle");
      setChatError(null);
    }

    setIsChatOpen(true);
  }

  function handleOpenResumeExperienceChatForCard(card: ActiveTailorRunCard) {
    setChatInput(
      buildResumeExperienceCraftingPromptForCard({
        basePrompt:
          personalInfo?.promptSettings.tailorResumeStep2ExperienceChat ?? null,
        card,
      }),
    );
    handleOpenChat();
    window.setTimeout(() => {
      chatInputRef.current?.focus();
      chatInputRef.current?.setSelectionRange(
        chatInputRef.current.value.length,
        chatInputRef.current.value.length,
      );
    }, 0);
  }

  function recordTailorGenerationStepEvent(
    stepEvent: TailorResumeGenerationStepSummary,
  ) {
    setTailorGenerationStep(stepEvent);
    setTailorGenerationStepTimings((currentTimings) => {
      const nextTimings = mergeTailorResumeGenerationStepTiming({
        observedAt: new Date().toISOString(),
        step: stepEvent,
        timings: currentTimings,
      });

      tailorGenerationStepTimingsRef.current = nextTimings;
      return nextTimings;
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialSnapshot() {
      try {
        const snapshot = await fetchSnapshot();

        if (isMounted) {
          setState({ status: "ready", snapshot });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            error: getSnapshotErrorMessage(error),
            snapshot: null,
          });
        }
      }
    }

    void loadInitialSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void loadExtensionPreferences();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[EXTENSION_PREFERENCES_STORAGE_KEY]) {
        return;
      }

      setExtensionPreferences(
        readExtensionPreferences(
          changes[EXTENSION_PREFERENCES_STORAGE_KEY].newValue,
        ),
      );
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadExtensionPreferences]);

  useEffect(() => {
    void loadAuthStatus();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[AUTH_SESSION_STORAGE_KEY]) {
        return;
      }

      void loadAuthStatus();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadAuthStatus]);

  useEffect(() => {
    if (authState.status === "signedIn" || authActionState === "running") {
      return;
    }

    let isCancelled = false;
    let isReconnectCheckInFlight = false;

    async function reconnectIfNeeded() {
      if (isCancelled || isReconnectCheckInFlight) {
        return;
      }

      isReconnectCheckInFlight = true;

      try {
        await loadAuthStatus();
      } finally {
        isReconnectCheckInFlight = false;
      }
    }

    const intervalId = window.setInterval(() => {
      void reconnectIfNeeded();
    }, AUTH_RECONNECT_INTERVAL_MS);

    void reconnectIfNeeded();

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authActionState, authState.status, loadAuthStatus]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      return;
    }

    setTailorInterviewError(null);
    setChatError(null);
  }, [authState.status]);

  useEffect(() => {
    if (authState.status === "signedIn" || activePanelTab !== "tailor") {
      setIsTailorAuthPromptOpen(false);
    }
  }, [activePanelTab, authState.status]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      setPersonalInfoState({ personalInfo: null, status: "idle" });
      setPendingPersonalDelete(null);
      setPersonalDeleteActionState("idle");
      setPersonalDeleteError(null);
      setResumePreviewState({ objectUrl: null, status: "idle" });
      setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      setTailorInterview(null);
      setIsTailorInterviewFinishPromptOpen(false);
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      return;
    }

    const authUserId = authState.session.user.id;
    let isCancelled = false;

    async function hydratePersonalInfo() {
      const hydratedFromCache = await loadCachedPersonalInfo(authUserId);

      if (isCancelled) {
        return;
      }

      if (!hydratedFromCache && !lastReadyPersonalInfoRef.current) {
        setPersonalInfoState({ personalInfo: null, status: "loading" });
      }

      await loadPersonalInfo({ preserveCurrent: true });
    }

    void hydratePersonalInfo();

    return () => {
      isCancelled = true;
    };
  }, [
    authState,
    loadCachedPersonalInfo,
    loadPersonalInfo,
    tailoringRunsRefreshKey,
  ]);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (
        areaName !== "local" ||
        !changes[PERSONAL_INFO_CACHE_STORAGE_KEY] ||
        authState.status !== "signedIn" ||
        isSuppressingActiveTailoringHydration
      ) {
        return;
      }

      const cacheEntry = readPersonalInfoCacheEntry(
        changes[PERSONAL_INFO_CACHE_STORAGE_KEY].newValue,
      );

      if (!cacheEntry || cacheEntry.userId !== authState.session.user.id) {
        return;
      }

      setPersonalInfoState({
        personalInfo: applyStoppedTailoringFilter(cacheEntry.personalInfo),
        status: "ready",
      });
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [applyStoppedTailoringFilter, authState, isSuppressingActiveTailoringHydration]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await chrome.storage.local.get(
          KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
        );
        setDismissedKeywordBadgeKeys(
          readDismissedKeywordBadgeMap(
            result?.[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY],
          ),
        );
      } catch {
        // Empty set means the menu item just won't appear until storage works.
      }
    })();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (
        areaName !== "local" ||
        !changes[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY]
      ) {
        return;
      }

      setDismissedKeywordBadgeKeys(
        readDismissedKeywordBadgeMap(
          changes[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY].newValue,
        ),
      );
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!pendingPersonalDelete) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingPersonalItem) {
        setPendingPersonalDelete(null);
        setPersonalDeleteError(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeletingPersonalItem, pendingPersonalDelete]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      lastReadyPersonalInfoRef.current = null;
      lastSeenSyncStateRef.current = null;
      return;
    }

    if (personalInfoState.status === "ready") {
      lastReadyPersonalInfoRef.current = personalInfoState.personalInfo;
      lastSeenSyncStateRef.current = personalInfoState.personalInfo.syncState;
    }
  }, [authState.status, personalInfoState]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      setSavedSettingsUserMarkdown((currentSummary) =>
        currentSummary.markdown === defaultUserMarkdown &&
        currentSummary.updatedAt === null &&
        currentSummary.nonTechnologies.length === 0
          ? currentSummary
          : {
              markdown: defaultUserMarkdown,
              nonTechnologies: [],
              updatedAt: null,
            },
      );
      setDraftSettingsUserMarkdown((currentValue) =>
        currentValue === defaultUserMarkdown ? currentValue : defaultUserMarkdown,
      );
      setDraftSettingsNonTechnologies((currentTerms) =>
        currentTerms.length === 0 ? currentTerms : [],
      );
      setDraftSettingsNonTechnologyInput((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setSettingsSkillData((currentSkillData) =>
        currentSkillData.keywordClassifications.length === 0 &&
        currentSkillData.resumeExperiences.length === 0 &&
        currentSkillData.skills.length === 0 &&
        currentSkillData.spareBullets.length === 0 &&
        currentSkillData.updatedAt === ""
          ? currentSkillData
          : buildEmptyTailorResumeStoredSkillData(),
      );
      setSettingsSpareBulletEditDraft((currentDraft) =>
        currentDraft === null ? currentDraft : null,
      );
      setDraftSettingsSpareBulletExperienceId((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setDraftSettingsSpareBulletSkillNames((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setDraftSettingsSkillsOnlyName((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setDraftSettingsSpareBulletQuote((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setDraftSettingsSpareBulletReplacesQuote((currentValue) =>
        currentValue === "" ? currentValue : "",
      );
      setSettingsUserMarkdownError((currentError) =>
        currentError === null ? currentError : null,
      );
      setSettingsSpareBulletError((currentError) =>
        currentError === null ? currentError : null,
      );
      setSettingsSkillsOnlyError((currentError) =>
        currentError === null ? currentError : null,
      );
      return;
    }

    if (personalInfoState.status !== "ready") {
      return;
    }

    const nextUserMarkdown = personalInfoState.personalInfo.userMarkdown;

    if (
      savedSettingsUserMarkdown.updatedAt === nextUserMarkdown.updatedAt &&
      savedSettingsUserMarkdown.markdown === nextUserMarkdown.markdown &&
      savedSettingsUserMarkdown.nonTechnologies.join("\n") ===
        nextUserMarkdown.nonTechnologies.join("\n")
    ) {
      return;
    }

    setSavedSettingsUserMarkdown(nextUserMarkdown);
    setDraftSettingsUserMarkdown(nextUserMarkdown.markdown);
    setDraftSettingsNonTechnologies(nextUserMarkdown.nonTechnologies);
    setDraftSettingsNonTechnologyInput("");
    setSettingsUserMarkdownError(null);
    setSettingsSkillData(personalInfoState.personalInfo.skillData);
    setDraftSettingsSpareBulletExperienceId((currentValue) =>
      personalInfoState.personalInfo.skillData.resumeExperiences.some(
        (experience) => experience.id === currentValue,
      )
        ? currentValue
        : personalInfoState.personalInfo.skillData.resumeExperiences[0]?.id ?? "",
    );
  }, [
    authState.status,
    personalInfoState,
    savedSettingsUserMarkdown.markdown,
    savedSettingsUserMarkdown.nonTechnologies,
    savedSettingsUserMarkdown.updatedAt,
  ]);

  useEffect(() => {
    if (authState.status !== "signedIn" || personalInfoState.status !== "ready") {
      return;
    }

    const nextSkillData = personalInfoState.personalInfo.skillData;

    setSettingsSkillData(nextSkillData);
    setDraftSettingsSpareBulletExperienceId((currentValue) =>
      nextSkillData.resumeExperiences.some(
        (experience) => experience.id === currentValue,
      )
        ? currentValue
        : nextSkillData.resumeExperiences[0]?.id ?? "",
    );
  }, [authState.status, personalInfoState]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      return;
    }

    let isCancelled = false;

    async function refreshFromSyncState() {
      if (
        isCancelled ||
        document.visibilityState !== "visible" ||
        isSyncStateCheckInFlightRef.current ||
        isSyncRefreshInFlightRef.current
      ) {
        return;
      }

      isSyncStateCheckInFlightRef.current = true;

      try {
        const nextSyncState = await loadSyncState();

        if (isCancelled || !nextSyncState) {
          return;
        }

        const previousSyncState = lastSeenSyncStateRef.current;

        if (!previousSyncState) {
          lastSeenSyncStateRef.current = nextSyncState;
          return;
        }

        if (!haveUserSyncStateChanged(previousSyncState, nextSyncState)) {
          return;
        }

        isSyncRefreshInFlightRef.current = true;

        try {
          await loadPersonalInfo({ preserveCurrent: true });
          if (!isCancelled) {
            lastSeenSyncStateRef.current = nextSyncState;
          }
        } finally {
          isSyncRefreshInFlightRef.current = false;
        }
      } catch (error) {
        if (!shouldIgnoreSyncRefreshError(error)) {
          console.error("Could not refresh Job Helper sync state.", error);
        }
      } finally {
        isSyncStateCheckInFlightRef.current = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadTailorStorageRegistries();
        void refreshFromSyncState();
      }
    }

    void refreshFromSyncState();
    const intervalId = window.setInterval(() => {
      void refreshFromSyncState();
    }, SYNC_STATE_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authState, loadPersonalInfo, loadSyncState, loadTailorStorageRegistries]);

  useEffect(() => {
    if (personalInfoState.status !== "ready") {
      return;
    }

    if (isSuppressingActiveTailoringHydration) {
      return;
    }

    if (
      isGeneratingTailorQuestionForOpenInterview &&
      !selectedPersonalInfoInterview
    ) {
      return;
    }

    if (selectedTailorInterviewId && !selectedPersonalInfoInterview) {
      setSelectedTailorInterviewId(null);
    }

    setTailorInterview(activePersonalInfoInterview);

    if (!activePersonalInfoInterview) {
      dismissedTailorInterviewPageIdRef.current = null;
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setIsTailorInterviewFinishPromptOpen(false);
      setIsTailorInterviewOpen(false);
      setTailorInterviewError(null);
    } else {
      setActivePanelTab("tailor");

      if (
        dismissedTailorInterviewPageIdRef.current !==
        activePersonalInfoInterview.id
      ) {
        setIsTailorInterviewOpen(true);
      }
    }
  }, [
    activePersonalInfoInterview,
    isGeneratingTailorQuestionForOpenInterview,
    isSuppressingActiveTailoringHydration,
    personalInfoState,
    selectedPersonalInfoInterview,
    selectedTailorInterviewId,
  ]);

  useEffect(() => {
    if (personalInfoState.status !== "ready") {
      return;
    }

    const activeTailoring = currentPagePersonalInfoTailoring;

    if (isSuppressingActiveTailoringHydration) {
      return;
    }

    if (activeTailoring) {
      const nextRun = buildTailoringRunRecordFromExistingTailoring({
        existingTailoring: activeTailoring,
        previousRun: currentPageStoredTailoringRun ?? lastTailoringRun,
      });

      if (!areTailoringRunRecordsEqual(currentPageStoredTailoringRun, nextRun)) {
        void persistTailoringRun(nextRun);
      }

      return;
    }

    if (
      hasCurrentPageCompletedTailoring &&
      isTransientTailoringRun(currentPageStoredTailoringRun ?? lastTailoringRun)
    ) {
      setLastTailoringRun(null);
      setTailorGenerationStep(null);
      setTailorGenerationStepTimings([]);
      setCaptureState((currentCaptureState) =>
        currentCaptureState === "blocked" ? "blocked" : "idle",
      );
      void persistTailoringRun(null, currentPageResolvedRegistryKey).catch((error) => {
        console.error(
          "Could not clear a completed tailoring run from local storage.",
          error,
        );
      });
      return;
    }

    if (!isStaleTailoringRun(lastTailoringRun)) {
      return;
    }

    setLastTailoringRun(null);
    setTailorGenerationStep(null);
    setTailorGenerationStepTimings([]);
    setCaptureState((currentCaptureState) =>
      currentCaptureState === "blocked" ? "blocked" : "idle",
    );
    void persistTailoringRun(null).catch((error) => {
      console.error("Could not clear a stale tailoring run.", error);
    });
  }, [
    currentPageResolvedRegistryKey,
    currentPageStoredTailoringRun,
    currentPagePersonalInfoTailoring,
    hasCurrentPageCompletedTailoring,
    isSuppressingActiveTailoringHydration,
    lastTailoringRun,
    personalInfoState,
    persistTailoringRun,
  ]);

  useEffect(() => {
    if (!tailorInterviewFinishRequestKey) {
      dismissedTailorInterviewFinishRequestRef.current = null;
      setIsTailorInterviewFinishPromptOpen(false);
      return;
    }

    if (
      dismissedTailorInterviewFinishRequestRef.current ===
      tailorInterviewFinishRequestKey
    ) {
      return;
    }

    if (
      lastSeenTailorInterviewFinishRequestRef.current ===
      tailorInterviewFinishRequestKey
    ) {
      return;
    }

    lastSeenTailorInterviewFinishRequestRef.current =
      tailorInterviewFinishRequestKey;
    setIsTailorInterviewFinishPromptOpen(true);
  }, [tailorInterviewFinishRequestKey]);

  useEffect(() => {
    const sessionToken =
      authState.status === "signedIn" ? authState.session.sessionToken : null;
    const pdfUpdatedAt =
      personalInfoState.status === "ready"
        ? personalInfoState.personalInfo.originalResume.pdfUpdatedAt
        : null;

    if (!sessionToken || !pdfUpdatedAt) {
      setResumePreviewState({ objectUrl: null, status: "idle" });
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;

    async function loadOriginalResumePreview() {
      setResumePreviewState({ objectUrl: null, status: "loading" });

      try {
        const response = await fetch(buildOriginalResumePreviewUrl(pdfUpdatedAt), {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });

        if (response.status === 401) {
          await invalidateAuthSession();
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            readErrorMessage(payload, "Could not load the resume preview."),
          );
        }

        const previewBlob = await response.blob();
        objectUrl = URL.createObjectURL(previewBlob);

        if (isMounted) {
          setResumePreviewState({ objectUrl, status: "ready" });
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        if (isMounted) {
          setResumePreviewState({
            error:
              error instanceof Error
                ? error.message
                : "Could not load the resume preview.",
            objectUrl: null,
            status: "error",
          });
        }
      }
    }

    void loadOriginalResumePreview();

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [authState, invalidateAuthSession, personalInfoState]);

  useEffect(() => {
    const sessionToken =
      authState.status === "signedIn" ? authState.session.sessionToken : null;
    const tailoredResumeId = focusedTailoredResumeId;

    if (!sessionToken || !tailoredResumeId) {
      setTailoredResumeReviewState({ record: null, status: "idle" });
      setPendingTailoredResumeReviewEditId(null);
      return;
    }

    let isMounted = true;

    setTailoredResumeReviewState((currentState) => ({
      record:
        currentState.record?.id === tailoredResumeId ? currentState.record : null,
      status: "loading",
    }));

    void loadTailoredResumeReview({
      sessionToken,
      tailoredResumeId,
    })
      .then((record) => {
        if (!isMounted) {
          return;
        }

        if (!record) {
          setTailoredResumeReviewState({
            error: "Could not find the tailored resume review.",
            record: null,
            status: "error",
          });
          return;
        }

        setTailoredResumeReviewState({
          record,
          status: "ready",
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setTailoredResumeReviewState((currentState) => ({
          error:
            error instanceof Error
              ? error.message
              : "Could not load the tailored resume review.",
          record:
            currentState.record?.id === tailoredResumeId ? currentState.record : null,
          status: "error",
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [authState, focusedTailoredResumeId, loadTailoredResumeReview]);

  useEffect(() => {
    if (!focusedTailoredResumeId) {
      setActiveTailorRunDetailView(null);
      setSelectedTailoredResumeId(null);
    }
  }, [focusedTailoredResumeId]);

  useEffect(() => {
    const autoScrollKey = currentPageCompletedTailoredResumeAutoScrollKey;

    if (!autoScrollKey || showFullscreenTailorRunDetail) {
      if (state.status === "ready" && !autoScrollKey) {
        lastAutoScrolledTailoredResumeKeyRef.current = null;
      }
      return;
    }

    if (lastAutoScrolledTailoredResumeKeyRef.current === autoScrollKey) {
      return;
    }

    if (activePanelTab !== "tailor") {
      setActivePanelTab("tailor");
    }

    if (tailoredResumeArchiveFilter !== "unarchived") {
      setTailoredResumeArchiveFilter("unarchived");
    }

    const frameId = window.requestAnimationFrame(() => {
      const targetRow = currentPageTailoredResumeRowRef.current;

      if (!targetRow) {
        return;
      }

      targetRow.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      lastAutoScrolledTailoredResumeKeyRef.current = autoScrollKey;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    activePanelTab,
    currentPageCompletedTailoredResumeAutoScrollKey,
    showFullscreenTailorRunDetail,
    state.status,
    tailoredResumeArchiveFilter,
  ]);

  const tailoredResumePreviewSessionToken =
    authState.status === "signedIn" ? authState.session.sessionToken : null;
  const tailoredResumePreviewPdfUpdatedAt =
    activeTailoredResumeReviewRecord?.pdfUpdatedAt ?? null;
  const shouldRequestHighlightedTailoredResumePreview =
    shouldShowTailoredPreviewDiffHighlighting;
  const tailoredResumePreviewObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const sessionToken = tailoredResumePreviewSessionToken;
    const tailoredResumeId = focusedTailoredResumeId ?? "";
    const tailoredResumePdfUpdatedAt = tailoredResumePreviewPdfUpdatedAt;

    if (!sessionToken || !tailoredResumeId) {
      const previousObjectUrl = tailoredResumePreviewObjectUrlRef.current;
      tailoredResumePreviewObjectUrlRef.current = null;
      setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      if (previousObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
      }
      return;
    }

    let isCancelled = false;

    async function loadTailoredResumePreview() {
      setTailoredResumePreviewState((currentState) =>
        currentState.status === "loading"
          ? currentState
          : { objectUrl: null, status: "loading" },
      );

      try {
        const response = await fetch(
          buildTailoredResumePreviewUrl({
            highlights: shouldRequestHighlightedTailoredResumePreview,
            pdfUpdatedAt: tailoredResumePdfUpdatedAt,
            tailoredResumeId,
          }),
          {
            credentials: "include",
            headers: {
              Authorization: `Bearer ${sessionToken}`,
            },
          },
        );

        if (isCancelled) {
          return;
        }

        if (response.status === 401) {
          await invalidateAuthSession();
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            readErrorMessage(
              payload,
              "Could not load the tailored resume preview.",
            ),
          );
        }

        const previewBlob = await response.blob();

        if (isCancelled) {
          return;
        }

        const newObjectUrl = URL.createObjectURL(previewBlob);
        const previousObjectUrl = tailoredResumePreviewObjectUrlRef.current;
        tailoredResumePreviewObjectUrlRef.current = newObjectUrl;
        setTailoredResumePreviewState({
          objectUrl: newObjectUrl,
          status: "ready",
        });

        if (previousObjectUrl && previousObjectUrl !== newObjectUrl) {
          URL.revokeObjectURL(previousObjectUrl);
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setTailoredResumePreviewState({
          error:
            error instanceof Error
              ? error.message
              : "Could not load the tailored resume preview.",
          objectUrl: null,
          status: "error",
        });
      }
    }

    void loadTailoredResumePreview();

    return () => {
      isCancelled = true;
    };
  }, [
    focusedTailoredResumeId,
    invalidateAuthSession,
    shouldRequestHighlightedTailoredResumePreview,
    tailoredResumePreviewPdfUpdatedAt,
    tailoredResumePreviewSessionToken,
  ]);

  useEffect(() => {
    return () => {
      const objectUrl = tailoredResumePreviewObjectUrlRef.current;
      tailoredResumePreviewObjectUrlRef.current = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    function handleActiveTabChange() {
      void loadTailorStorageRegistries();
      if (authState.status === "signedIn") {
        void loadCachedPersonalInfo(authState.session.user.id);
        void loadPersonalInfo({ preserveCurrent: true });
      }
      void loadSnapshot();
    }

    function handleTabUpdate(
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) {
      if (!tab.active || (changeInfo.status !== "complete" && !changeInfo.url)) {
        return;
      }

      void loadTailorStorageRegistries();
      if (authState.status === "signedIn") {
        void loadCachedPersonalInfo(authState.session.user.id);
        void loadPersonalInfo({ preserveCurrent: true });
      }
      void loadSnapshot();
    }

    chrome.tabs.onActivated.addListener(handleActiveTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActiveTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
    };
  }, [
    authState,
    loadCachedPersonalInfo,
    loadPersonalInfo,
    loadSnapshot,
    loadTailorStorageRegistries,
  ]);

  useEffect(() => {
    void loadTailorStorageRegistries();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[TAILORING_RUNS_STORAGE_KEY]) {
        return;
      }

      void loadTailorStorageRegistries();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadTailorStorageRegistries]);

  useEffect(() => {
    void loadStoppedTailoringRegistry();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[STOPPED_TAILORING_STORAGE_KEY]) {
        return;
      }

      const stoppedTailoringsRegistry = readStoppedTailoringRegistry(
        changes[STOPPED_TAILORING_STORAGE_KEY].newValue,
      );
      applyStoppedTailoringRegistry(stoppedTailoringsRegistry.registry);
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [applyStoppedTailoringRegistry, loadStoppedTailoringRegistry]);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[TAILORING_PREPARATIONS_STORAGE_KEY]) {
        return;
      }

      void loadTailorStorageRegistries();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadTailorStorageRegistries]);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[TAILORING_PROMPTS_STORAGE_KEY]) {
        return;
      }

      void loadTailorStorageRegistries();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadTailorStorageRegistries]);

  useEffect(() => {
    setLastTailoringRun(currentPageStoredTailoringRun);
    setTailorPreparationState(currentPageTailorPreparationState);
    setExistingTailoringPrompt(currentPageExistingTailoringPrompt);
    setTailorGenerationStep(
      readTailorResumeGenerationStepSummary(
        currentPageStoredTailoringRun?.generationStep,
      ) ?? null,
    );
    tailorGenerationStepTimingsRef.current =
      currentPageStoredTailoringRun?.generationStepTimings ?? [];
    setTailorGenerationStepTimings(
      currentPageStoredTailoringRun?.generationStepTimings ?? [],
    );
    setCaptureState((currentCaptureState) => {
      if (currentPageExistingTailoringPrompt) {
        return "blocked";
      }

      return (
        readCaptureStateFromTailoringRun(currentPageStoredTailoringRun) ??
        (currentCaptureState === "blocked" ? "blocked" : "idle")
      );
    });

    const nextTailorArtifactKey = currentPageExistingTailoringPrompt
      ? `prompt:${
          currentPageExistingTailoringPromptEntry?.key ??
          readExistingTailoringPromptRegistryKey(
            currentPageExistingTailoringPrompt,
            "",
          ) ??
          currentPageExistingTailoringPrompt.existingTailoring.id
        }`
      : currentPageTailorPreparationState
        ? `preparation:${
            currentPageTailorPreparationEntry?.key ??
            readTailorPreparationRegistryKey(currentPageTailorPreparationState, "") ??
            currentPageTailorPreparationState.capturedAt
          }`
        : currentPageStoredTailoringRun
          ? `run:${
              currentPageStoredTailoringRunEntry?.key ??
              readTailorRunRecordRegistryKey(currentPageStoredTailoringRun, "") ??
              currentPageStoredTailoringRun.capturedAt
            }`
          : null;

    if (!nextTailorArtifactKey) {
      if (state.status === "ready") {
        lastAutoFocusedTailorArtifactKeyRef.current = null;
      }
      return;
    }

    if (
      lastAutoFocusedTailorArtifactKeyRef.current !== nextTailorArtifactKey
    ) {
      lastAutoFocusedTailorArtifactKeyRef.current = nextTailorArtifactKey;
      if (activePanelTab !== "tailor") {
        setActivePanelTab("tailor");
      }
    }
  }, [
    activePanelTab,
    currentPageExistingTailoringPromptEntry?.key,
    currentPageExistingTailoringPrompt,
    currentPageStoredTailoringRunEntry?.key,
    currentPageStoredTailoringRun,
    currentPageTailorPreparationEntry?.key,
    currentPageTailorPreparationState,
    state.status,
  ]);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    if (authState.status !== "signedIn") {
      setChatMessages([]);
      setChatStatus("idle");
      setChatError(null);
      return;
    }

    void loadChatHistory(authState.session.sessionToken);
  }, [authState, isChatOpen, loadChatHistory]);

  useEffect(() => {
    if (!tailorInterview?.id) {
      return;
    }

    tailorInterviewMessagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    displayedTailorInterviewMessageCount,
    lastDisplayedTailorInterviewMessageId,
    tailorInterview?.id,
  ]);

  const triggerTailorCapture = useCallback(
    async (
      input: {
        overwriteExisting?: boolean;
        overwriteTargetApplicationId?: string | null;
        overwriteTargetTailoredResumeId?: string | null;
      } = {},
    ) => {
      const response = await chrome.runtime.sendMessage({
        ...(input.overwriteExisting
          ? {
              payload: {
                overwriteExisting: true,
                ...(input.overwriteTargetApplicationId?.trim()
                  ? {
                      existingTailoringApplicationId:
                        input.overwriteTargetApplicationId.trim(),
                    }
                  : {}),
                ...(input.overwriteTargetTailoredResumeId?.trim()
                  ? {
                      existingTailoringTailoredResumeId:
                        input.overwriteTargetTailoredResumeId.trim(),
                    }
                  : {}),
              },
            }
          : {}),
        type: "JOB_HELPER_TRIGGER_CAPTURE",
      });

      assertRuntimeResponseOk(
        response,
        input.overwriteExisting
          ? "Could not overwrite the current tailored resume."
          : "Could not start tailoring the current page.",
      );
    },
    [],
  );

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    chatMessagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [chatMessages, chatSendStatus, isChatOpen]);

  async function handleTailorCurrentPage() {
    if (authState.status !== "signedIn") {
      setActivePanelTab("tailor");
      const nextAuthState = await connectGoogleAccount();

      if (nextAuthState.status !== "signedIn") {
        setIsTailorAuthPromptOpen(true);
        return;
      }
    }

    const preparingMessage = buildTailorResumePreparationMessage(false);
    const pageContext = state.status === "ready" ? state.snapshot : null;
    setIsPreparingTailorStart(true);
    setActiveTailoringOverrideState("idle");
    setIsStoppingCurrentTailoring(false);
    setTailorInterviewError(null);
    setIsTailorInterviewOpen(false);
    setActivePanelTab("tailor");
    void showTailorPreparationOverlayOnActivePage(preparingMessage);

    try {
      await persistTailorPreparationState(
        buildTailorResumePreparationState({
          message: preparingMessage,
          pageContext,
        }),
      );
      await triggerTailorCapture();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to tailor the resume.";
      if (message === "Connect Google before tailoring a resume.") {
        openTailorAuthPrompt();
      }

      await persistTailorPreparationState(null);
      setTailorGenerationStep(null);
      setTailorGenerationStepTimings([]);
      const record = buildTailoringRunRecord({
        companyName: null,
        message,
        pageContext,
        positionTitle: null,
        status: "error",
      });

      await persistTailoringRun(record);
      setCaptureState("error");
    } finally {
      setIsPreparingTailorStart(false);
    }
  }

  async function overwriteExistingTailoring() {
    if (!existingTailoringPrompt) {
      return;
    }

    const prompt = existingTailoringPrompt;
    const preparingMessage = buildTailorResumePreparationMessage(true);
    const pageKey =
      currentPageResolvedRegistryKey ??
      buildTailorRunRegistryKey(prompt.jobUrl) ??
      readTailorRunRegistryKeyFromPageContext(prompt.pageContext);
    const suppressedTailoredResumeId =
      prompt.existingTailoring.kind === "completed"
        ? prompt.existingTailoring.tailoredResumeId
        : null;
    const optimisticPreparation = buildTailorResumePreparationState({
      message: preparingMessage,
      pageContext: prompt.pageContext,
    });
    const optimisticRun = buildTailoringRunRecord({
      applicationId: prompt.existingTailoring.applicationId,
      companyName: prompt.existingTailoring.companyName,
      capturedAt: optimisticPreparation.capturedAt,
      jobIdentifier: prompt.existingTailoring.jobIdentifier,
      message: buildLiveTailorResumeStatusMessage(
        null,
        "Tailoring your resume for this job...",
      ),
      pageContext: prompt.pageContext,
      positionTitle: prompt.existingTailoring.positionTitle,
      status: "running",
      suppressedTailoredResumeId,
    });

    setExistingTailoringPrompt(null);
    setExistingTailoringPromptsByKey((currentRegistry) => {
      if (!pageKey || !(pageKey in currentRegistry)) {
        return currentRegistry;
      }

      const nextRegistry = { ...currentRegistry };
      delete nextRegistry[pageKey];
      return nextRegistry;
    });
    setTailorPreparationState(optimisticPreparation);
    setTailorPreparationsByKey((currentRegistry) =>
      pageKey
        ? {
            ...currentRegistry,
            [pageKey]: optimisticPreparation,
          }
        : currentRegistry,
    );
    setLastTailoringRun(optimisticRun);
    setTailoringRunsByKey((currentRegistry) =>
      pageKey
        ? {
            ...currentRegistry,
            [pageKey]: optimisticRun,
          }
        : currentRegistry,
    );
    setIsPreparingTailorStart(true);
    setActiveTailoringOverrideState("overwriting");
    setTailorInterview(null);
    setIsTailorInterviewOpen(false);
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
    setIsTailorInterviewFinishPromptOpen(false);
    setTailorInterviewError(null);
    setTailorGenerationStep(null);
    setTailorGenerationStepTimings([]);
    setCaptureState("running");
    const removeJobUrl = prompt.jobUrl ?? prompt.existingTailoring.jobUrl ?? null;
    const buildOptimisticPersonalInfo = (currentPersonalInfo: PersonalInfoSummary) => ({
      ...currentPersonalInfo,
      activeTailoring: null,
      activeTailorings: currentPersonalInfo.activeTailorings.filter(
        (activeTailoring) =>
          !sameTailoringJobUrl(activeTailoring.jobUrl, removeJobUrl),
      ),
      tailoringInterview: null,
      tailoringInterviews: currentPersonalInfo.tailoringInterviews.filter(
        (tailoringInterview) =>
          !sameTailoringJobUrl(tailoringInterview.jobUrl, removeJobUrl),
      ),
    }) satisfies PersonalInfoSummary;
    const optimisticPersonalInfo = personalInfo
      ? buildOptimisticPersonalInfo(personalInfo)
      : null;

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: buildOptimisticPersonalInfo(currentState.personalInfo),
            status: "ready",
          }
        : currentState,
    );

    void persistExistingTailoringPrompt(null, pageKey).catch((error) => {
      console.error("Could not clear the Tailor Resume overwrite prompt.", error);
    });
    void persistTailorPreparationState(optimisticPreparation, pageKey).catch(
      (error) => {
        console.error("Could not sync the Tailor Resume preparation state.", error);
      },
    );
    void persistTailoringRun(optimisticRun, pageKey).catch((error) => {
      console.error("Could not sync the Tailor Resume run state.", error);
    });

    try {
      await triggerTailorCapture({
        overwriteExisting: true,
        overwriteTargetApplicationId: prompt.existingTailoring.applicationId,
        overwriteTargetTailoredResumeId:
          prompt.existingTailoring.kind === "completed"
            ? prompt.existingTailoring.tailoredResumeId
            : null,
      });
      setActiveTailoringOverrideState("idle");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to tailor the resume.";
      await persistTailorPreparationState(null);
      setTailorGenerationStep(null);
      setTailorGenerationStepTimings([]);
      const record = buildTailoringRunRecord({
        companyName: null,
        message,
        pageContext: prompt.pageContext,
        positionTitle: null,
        status: "error",
      });

      await persistTailoringRun(record);
      setActiveTailoringOverrideState("idle");
      setCaptureState("error");
      const restoredPrompt: ExistingTailoringPromptState = {
        ...prompt,
        actionState: "idle",
      };
      setExistingTailoringPrompt(restoredPrompt);
      await persistExistingTailoringPrompt(restoredPrompt, pageKey);
      await loadPersonalInfo();
    } finally {
      setIsPreparingTailorStart(false);
    }
  }

  async function dismissExistingTailoringPrompt() {
    if (!existingTailoringPrompt) {
      return;
    }

    const prompt = existingTailoringPrompt;
    const nextRun = buildTailoringRunRecordFromExistingTailoring({
      existingTailoring: prompt.existingTailoring,
      previousRun: lastTailoringRun,
    });

    setExistingTailoringPrompt(null);
    setTailorInterviewError(null);
    setTailorGenerationStep(
      prompt.existingTailoring.kind === "active_generation"
        ? prompt.existingTailoring.lastStep
        : null,
    );
    setCaptureState(
      prompt.existingTailoring.kind === "completed"
        ? "sent"
        : prompt.existingTailoring.kind === "pending_interview"
          ? "needs_input"
          : "running",
    );
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: {
              ...currentState.personalInfo,
              activeTailoring: prompt.existingTailoring,
              activeTailorings: [
                prompt.existingTailoring,
                ...currentState.personalInfo.activeTailorings.filter(
                  (activeTailoring) => activeTailoring.id !== prompt.existingTailoring.id,
                ),
              ],
            },
            status: "ready",
          }
        : currentState,
    );

    await persistTailoringRun(nextRun, currentPageResolvedRegistryKey);
    await persistExistingTailoringPrompt(null, currentPageResolvedRegistryKey);
    void loadPersonalInfo();
  }

  async function stopCurrentTailoring() {
    if (isStoppingCurrentTailoring) {
      return;
    }

    const existingTailoringId =
      tailorInterview?.tailorResumeRunId ??
      (activeTailoring?.kind === "completed" ? null : activeTailoring?.id ?? null);
    const jobUrl =
      tailorInterview?.jobUrl ??
      currentPageUrl ??
      activeTailoring?.jobUrl ??
      existingTailoringPrompt?.jobUrl ??
      lastTailoringRun?.pageUrl ??
      tailorPreparationState?.pageUrl ??
      null;
    const registryPageKey =
      currentPageResolvedRegistryKey ??
      buildTailorRunRegistryKey(jobUrl);
    const stoppedTailoringRecord = buildStoppedTailoringRecord({
      existingTailoringId,
      jobUrl,
      pageKey: registryPageKey,
    });

    setIsStoppingCurrentTailoring(true);
    setActiveTailoringOverrideState("idle");
    void persistStoppedTailoringRecord(stoppedTailoringRecord);
    void requestHideTailoredResumeBadgesForUrls([jobUrl, registryPageKey]);
    activeTailorRequestAbortControllerRef.current?.abort();
    activeTailorRequestAbortControllerRef.current = null;
    setExistingTailoringPrompt(null);
    setTailorInterview(null);
    setIsTailorInterviewOpen(false);
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
    setIsTailorInterviewFinishPromptOpen(false);
    setTailorInterviewError(null);
    setTailorGenerationStep(null);
    setTailorGenerationStepTimings([]);
    setLastTailoringRun(null);
    setCaptureState("idle");
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: (nextPersonalInfo = removeInFlightTailorRunFromPersonalInfo(
              {
                jobUrl: jobUrl ?? "",
                personalInfo: currentState.personalInfo,
                tailorRunId: existingTailoringId ?? "",
              },
            )),
            status: "ready",
          }
        : currentState,
    );

    if (nextPersonalInfo) {
      lastReadyPersonalInfoRef.current = nextPersonalInfo;
      publishPersonalInfoToSharedCache(nextPersonalInfo);
    }

    setIsStoppingCurrentTailoring(false);

    void (async () => {
      try {
        await clearTailorRegistryEntriesForMatch({
          jobUrl,
          pageIdentity: currentPageIdentity,
          pageKey: registryPageKey,
        });
      } catch (error) {
        console.error("Could not clear the active tailoring state.", error);
      }

      try {
        const response = await chrome.runtime.sendMessage({
          payload: {
            existingTailoringId,
            jobUrl,
            pageKey: registryPageKey,
          },
          type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
        });

        assertRuntimeResponseOk(response, "Unable to stop the current tailoring run.");
        void loadPersonalInfo({ preserveCurrent: true });
      } catch (error) {
        await loadPersonalInfo();
        setTailorInterviewError(
          error instanceof Error
            ? error.message
            : "Unable to stop the current tailoring run.",
        );
      }
    })();
  }

  function handleTailorInterviewAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitTailorInterviewAnswer();
  }

  async function submitTailorInterviewAnswer() {
    if (
      !tailorInterview ||
      captureState === "finishing" ||
      isStoppingCurrentTailoring
    ) {
      return;
    }

    const trimmedAnswer = draftTailorInterviewAnswer.trim();

    if (!trimmedAnswer) {
      return;
    }

    const optimisticAnswerMessage: TailorResumeConversationMessage = {
      id: `pending-tailor-interview-answer-${Date.now()}`,
      role: "user",
      technologyContexts: [],
      text: trimmedAnswer,
      toolCalls: [],
    };
    const pageContext = state.status === "ready" ? state.snapshot : null;
    const requestController = beginTailorRequest();
    const streamedMessageId = `streaming-tailor-interview:${tailorInterview.id}:${Date.now()}`;
    let didModelEndTailorInterview = false;
    let streamedAssistantMessage: TailorResumeConversationMessage = {
      id: streamedMessageId,
      role: "assistant",
      technologyContexts: [],
      text: "",
      toolCalls: [],
    };
    const publishPendingAssistantMessage = () => {
      setPendingTailorInterviewAssistantMessage(
        hasTailorInterviewStreamedMessageContent(streamedAssistantMessage)
          ? {
              ...streamedAssistantMessage,
              toolCalls: [...streamedAssistantMessage.toolCalls],
            }
          : null,
      );
    };
    const handleInterviewStreamEvent = (
      event: TailorResumeInterviewStreamEvent,
    ) => {
      if (event.kind === "reset" || event.kind === "text-start") {
        return;
      }

      if (
        event.kind === "text-delta" &&
        event.field !== "assistantMessage" &&
        event.field !== "completionMessage"
      ) {
        return;
      }

      streamedAssistantMessage = applyTailorInterviewStreamEventToMessage(
        streamedAssistantMessage,
        event,
      );
      publishPendingAssistantMessage();
    };

    setPendingTailorInterviewAnswerMessage(optimisticAnswerMessage);
    setPendingTailorInterviewAssistantMessage(null);
    setDraftTailorInterviewAnswer("");
    dismissTailorInterviewFinishPrompt();
    setTailorInterviewError(null);
    setTailorGenerationStep(null);
    tailorGenerationStepTimingsRef.current = [];
    setTailorGenerationStepTimings([]);
    setCaptureState("finishing");

    try {
      const result = await patchTailorResume(
        {
          action: "advanceTailorResumeInterview",
          answer: trimmedAnswer,
          interviewId: tailorInterview.id,
        },
        {
          onStepEvent: (stepEvent) => {
            if (activeTailorRequestAbortControllerRef.current !== requestController) {
              return;
            }

            recordTailorGenerationStepEvent(stepEvent);

            if (isTailorResumeInterviewEndStepEvent(stepEvent)) {
              didModelEndTailorInterview = true;
              dismissedTailorInterviewPageIdRef.current = tailorInterview.id;
              setPendingTailorInterviewAssistantMessage(null);
              setIsTailorInterviewFinishPromptOpen(false);
              setIsTailorInterviewOpen(false);
            }
          },
          onInterviewStreamEvent: handleInterviewStreamEvent,
          onUserMemoryEvent: (payload) => {
            if (activeTailorRequestAbortControllerRef.current !== requestController) {
              return;
            }

            const streamedUserMarkdown =
              readUserMarkdownFromTailorResumePayload(payload);

            if (streamedUserMarkdown) {
              applySavedUserMarkdown(streamedUserMarkdown);
              void refreshTailorInterviewKeywordBadge(
                streamedUserMarkdown.nonTechnologies,
              );
            }
          },
          signal: requestController.signal,
        },
      );
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to continue the tailoring follow-up questions.",
          ),
        );
      }

      const resultUserMarkdown = readUserMarkdownFromTailorResumePayload(
        result.payload,
      );

      if (resultUserMarkdown) {
        applySavedUserMarkdown(resultUserMarkdown);
        void refreshTailorInterviewKeywordBadge(
          resultUserMarkdown.nonTechnologies,
        );
      }

      const nextTailoringInterview =
        mergeTailorInterviewWithStreamedAssistantMessage(
          profileSummary.tailoringInterview,
          streamedAssistantMessage,
        );

      setPendingTailorInterviewAnswerMessage(null);
      setPendingTailorInterviewAssistantMessage(null);
      setTailorInterview(nextTailoringInterview);
      void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });

      if (nextTailoringInterview) {
        const record = buildTailoringRunRecord({
          companyName: nextTailoringInterview.companyName,
          generationStepTimings: tailorGenerationStepTimingsRef.current,
          message: "One more resume question is waiting in the sidebar.",
          pageContext,
          positionTitle: nextTailoringInterview.positionTitle,
          status: "needs_input",
        });

        await persistTailoringRun(record);
        setTailorGenerationStep(null);
        tailorGenerationStepTimingsRef.current = [];
        setTailorGenerationStepTimings([]);
        setCaptureState("needs_input");
        return;
      }

      const tailoredResume = resolveTailoredResumeFromPayload(result.payload);

      if (!tailoredResume) {
        throw new Error("Tailor Resume finished without returning a saved result.");
      }

      syncTailoredResumeReviewFromPayload(result.payload);
      syncTailoredResumeSummariesFromPayload(result.payload);

      const tailoredResumeError = readStringPayloadValue(
        result.payload,
        "tailoredResumeError",
      ) || null;
      const alreadyTailored =
        readStringPayloadValue(result.payload, "tailoringStatus") ===
        "already_tailored";
      const jobLabel = buildTailoringJobLabel({
        companyName: tailoredResume.companyName,
        positionTitle: tailoredResume.positionTitle,
      });
      const record = buildTailoringRunRecord({
        companyName: tailoredResume.companyName,
        message: buildCompletedTailoringMessage({
          alreadyTailored,
          jobLabel,
          tailoredResumeError,
        }),
        pageContext,
        positionTitle: tailoredResume.positionTitle,
        status:
          tailoredResume.status === "ready" && !tailoredResumeError
            ? "success"
            : "error",
        tailoredResumeError,
        tailoredResumeId: tailoredResume.id,
      });

      await persistTailoringRun(record);
      setTailorInterview(null);
      setIsTailorInterviewOpen(false);
      setTailorGenerationStep(null);
      setTailorGenerationStepTimings([]);
      setCaptureState("sent");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unable to continue the tailoring follow-up questions.";
      const failureStep = buildTailorInterviewFailureStep({
        message,
        timings: tailorGenerationStepTimingsRef.current,
      });
      const record = buildTailoringRunRecord({
        companyName: tailorInterview.companyName,
        generationStep: failureStep,
        generationStepTimings: tailorGenerationStepTimingsRef.current,
        jobIdentifier: tailorInterview.jobIdentifier,
        message,
        pageContext,
        positionTitle: tailorInterview.positionTitle,
        status: "error",
        tailoredResumeError: message,
      });

      await persistTailoringRun(record);
      setPendingTailorInterviewAnswerMessage(null);
      if (didModelEndTailorInterview) {
        setTailorInterview(null);
        setIsTailorInterviewOpen(false);
      } else {
        setIsTailorInterviewOpen(true);
      }
      setDraftTailorInterviewAnswer(trimmedAnswer);
      setTailorInterviewError(message);
      setTailorGenerationStep(failureStep);
      setCaptureState("error");
      if (didModelEndTailorInterview) {
        void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
      }
    } finally {
      clearTailorRequest(requestController);
    }
  }

  async function completeTailorInterview() {
    if (
      !tailorInterview ||
      !tailorInterview.completionRequestedAt ||
      captureState === "finishing" ||
      isStoppingCurrentTailoring ||
      isFinishingTailorInterview
    ) {
      return;
    }

    const pageContext = state.status === "ready" ? state.snapshot : null;

    setIsTailorInterviewFinishPromptOpen(false);
    setIsTailorInterviewOpen(false);
    setTailorInterviewError(null);
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
    setPendingTailorInterviewAssistantMessage(null);
    setIsFinishingTailorInterview(true);
    setTailorGenerationStep(null);
    setTailorGenerationStepTimings([]);
    setCaptureState("finishing");
    const requestController = beginTailorRequest();

    try {
      const result = await patchTailorResume(
        {
          action: "completeTailorResumeInterview",
          interviewId: tailorInterview.id,
        },
        {
          onStepEvent: (stepEvent) => {
            if (activeTailorRequestAbortControllerRef.current !== requestController) {
              return;
            }

            recordTailorGenerationStepEvent(stepEvent);
          },
          signal: requestController.signal,
        },
      );
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to finish the tailoring follow-up questions.",
          ),
        );
      }

      setTailorInterview(profileSummary.tailoringInterview);
      await loadPersonalInfo({ forceFresh: true, preserveCurrent: true });

      if (profileSummary.tailoringInterview) {
        const returnedInterviewMatchesCurrentPage = Boolean(
          pageContext &&
            (sameTailoringJobUrl(
              profileSummary.tailoringInterview.jobUrl,
              readJobUrlFromPageContext(pageContext),
            ) ||
              sameTailoringJobUrl(
                profileSummary.tailoringInterview.jobUrl,
                pageContext.url,
              )),
        );

        if (returnedInterviewMatchesCurrentPage) {
          const record = buildTailoringRunRecord({
            companyName: profileSummary.tailoringInterview.companyName,
            generationStepTimings: tailorGenerationStepTimingsRef.current,
            message: "One more resume question is waiting in the sidebar.",
            pageContext,
            positionTitle: profileSummary.tailoringInterview.positionTitle,
            status: "needs_input",
          });

          await persistTailoringRun(record);
        }
        setTailorInterviewError(null);
        setIsTailorInterviewOpen(true);
        setTailorGenerationStep(null);
        tailorGenerationStepTimingsRef.current = [];
        setTailorGenerationStepTimings([]);
        setCaptureState("needs_input");
        return;
      }

      const tailoredResume = resolveTailoredResumeFromPayload(result.payload);

      if (!tailoredResume) {
        throw new Error("Tailor Resume finished without returning a saved result.");
      }

      syncTailoredResumeReviewFromPayload(result.payload);
      syncTailoredResumeSummariesFromPayload(result.payload);

      const tailoredResumeError = readStringPayloadValue(
        result.payload,
        "tailoredResumeError",
      ) || null;
      const alreadyTailored =
        readStringPayloadValue(result.payload, "tailoringStatus") ===
        "already_tailored";
      const jobLabel = buildTailoringJobLabel({
        companyName: tailoredResume.companyName,
        positionTitle: tailoredResume.positionTitle,
      });
      const record = buildTailoringRunRecord({
        companyName: tailoredResume.companyName,
        message: buildCompletedTailoringMessage({
          alreadyTailored,
          jobLabel,
          tailoredResumeError,
        }),
        pageContext,
        positionTitle: tailoredResume.positionTitle,
        status:
          tailoredResume.status === "ready" && !tailoredResumeError
            ? "success"
            : "error",
        tailoredResumeError,
        tailoredResumeId: tailoredResume.id,
      });

      await persistTailoringRun(record);
      setTailorGenerationStep(null);
      setTailorGenerationStepTimings([]);
      setCaptureState("sent");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unable to finish the tailoring follow-up questions.";
      const failureStep = buildTailorInterviewFailureStep({
        message,
        timings: tailorGenerationStepTimingsRef.current,
      });
      const record = buildTailoringRunRecord({
        companyName: tailorInterview.companyName,
        generationStep: failureStep,
        generationStepTimings: tailorGenerationStepTimingsRef.current,
        jobIdentifier: tailorInterview.jobIdentifier,
        message,
        pageContext,
        positionTitle: tailorInterview.positionTitle,
        status: "error",
        tailoredResumeError: message,
      });

      await persistTailoringRun(record);
      setTailorInterviewError(message);
      setIsTailorInterviewOpen(true);
      setIsTailorInterviewFinishPromptOpen(false);
      setTailorGenerationStep(failureStep);
      setCaptureState("error");
      void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
    } finally {
      clearTailorRequest(requestController);
      setIsFinishingTailorInterview(false);
    }
  }

  async function cancelTailorInterview() {
    await stopCurrentTailoring();
  }

  async function handleDeleteChat() {
    if (
      authState.status !== "signedIn" ||
      chatSendStatus === "streaming"
    ) {
      return;
    }

    setChatStatus("loading");
    setChatError(null);

    try {
      const response = await fetch(buildSupportChatHistoryUrl(), {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
        },
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        await invalidateAuthSession();
        return;
      }

      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "Could not delete chat."));
      }

      setChatMessages([]);
      setChatStatus("ready");
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not delete chat.",
      );
      setChatStatus("error");
    }
  }

  async function handleCompactChat() {
    if (
      authState.status !== "signedIn" ||
      chatSendStatus === "streaming" ||
      chatMessages.length <= 10
    ) {
      return;
    }

    setChatStatus("loading");
    setChatError(null);

    try {
      const response = await fetch(buildSupportChatHistoryUrl(), {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
        },
        method: "PATCH",
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        await invalidateAuthSession();
        return;
      }

      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "Could not compact chat."));
      }

      setChatMessages(readChatMessages(payload));
      setChatStatus("ready");
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not compact chat.",
      );
      setChatStatus("error");
    }
  }

  async function handleSubmitChat() {
    if (authState.status !== "signedIn" || chatSendStatus === "streaming") {
      return;
    }

    const trimmedMessage = chatInput.trim();

    if (!trimmedMessage) {
      return;
    }

    chatHistoryRequestIdRef.current += 1;

    let pageContext: JobPageContext | null =
      state.status === "ready" ? state.snapshot : null;

    try {
      const snapshot = await fetchSnapshot();
      pageContext = snapshot;
      setState({ snapshot, status: "ready" });
    } catch {
      // Resume support chat is still useful away from a regular job page.
    }

    const optimisticUserMessage = createTemporaryChatMessage(
      "user",
      trimmedMessage,
    );
    const optimisticAssistantMessage = createTemporaryChatMessage(
      "assistant",
      "",
    );

    setChatInput("");
    setChatError(null);
    setChatStatus("ready");
    setChatSendStatus("streaming");
    setChatMessages((currentMessages) => [
      ...currentMessages,
      optimisticUserMessage,
      optimisticAssistantMessage,
    ]);

    try {
      const response = await fetch(DEFAULT_TAILOR_RESUME_SUPPORT_CHAT_ENDPOINT, {
        body: JSON.stringify({
          message: trimmedMessage,
          pageContext,
        }),
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (response.status === 401) {
        await invalidateAuthSession();
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(readErrorMessage(payload, "Could not send chat."));
      }

      await readChatStream(response, (event) => {
        if (event.type === "error") {
          throw new Error(readErrorMessage(event, "Could not send chat."));
        }

        if (event.type === "user-message") {
          const savedUserMessage = readChatMessage(event.message);

          if (savedUserMessage) {
            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === optimisticUserMessage.id
                  ? savedUserMessage
                  : message,
              ),
            );
          }
        }

        if (event.type === "delta" && typeof event.delta === "string") {
          setChatMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === optimisticAssistantMessage.id
                ? { ...message, content: `${message.content}${event.delta}` }
                : message,
            ),
          );
        }

        if (event.type === "done") {
          const savedAssistantMessage = readChatMessage(event.message);
          const nextSkillData = isRecord(event.skillData)
            ? readTailorResumeStoredSkillData(event.skillData)
            : null;

          if (savedAssistantMessage) {
            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === optimisticAssistantMessage.id
                  ? {
                      ...savedAssistantMessage,
                      content: mergeChatStreamedContent(
                        savedAssistantMessage.content,
                        message.content,
                      ),
                    }
                  : message,
              ),
            );
          }

          if (nextSkillData) {
            applySettingsSkillData(nextSkillData, { preserveEditDraft: true });
            setPersonalInfoState((currentState) =>
              currentState.status === "ready"
                ? {
                    personalInfo: {
                      ...currentState.personalInfo,
                      skillData: nextSkillData,
                    },
                    status: "ready",
                  }
                : currentState,
            );
            void loadPersonalInfo({ forceFresh: true, preserveCurrent: true });
          }
        }
      });
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not send chat.",
      );
      setChatMessages((currentMessages) =>
        currentMessages.filter(
          (message) =>
            message.id !== optimisticAssistantMessage.id ||
            message.content.length > 0,
        ),
      );
    } finally {
      setChatSendStatus("idle");
    }
  }

  function handleChatFormSubmit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmitChat();
  }

  function handleChatInputKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    void handleSubmitChat();
  }

  async function handleOpenApplicationsDashboard() {
    if (dashboardOpenActionState === "running") {
      return;
    }

    setDashboardOpenActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: `${DEFAULT_DASHBOARD_URL}?tab=new`,
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open applications.");
      void loadAuthStatus();
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open applications.",
        status: "error",
      });
    } finally {
      setDashboardOpenActionState("idle");
    }
  }

  const openTailoredResumeDetailView = useCallback((
    tailoredResumeId: string,
    nextView: TailorRunDetailView = "quickReview",
  ) => {
    setActivePanelTab("tailor");
    setSelectedTailoredResumeId(tailoredResumeId);
    setActiveTailorRunDetailView(nextView);
    setTailoredResumeMenuId(null);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);
  }, []);

  const consumeTailoredResumeReviewRequest = useCallback(
    (value: unknown) => {
      const tailoredResumeId = readStringPayloadValue(
        value,
        "tailoredResumeId",
      );

      if (!tailoredResumeId) {
        return false;
      }

      openTailoredResumeDetailView(tailoredResumeId, "quickReview");
      return true;
    },
    [openTailoredResumeDetailView],
  );

  useEffect(() => {
    let isCancelled = false;

    async function consumeStoredRequest() {
      const result = await chrome.storage.local.get(
        TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY,
      );

      if (isCancelled) {
        return;
      }

      if (
        consumeTailoredResumeReviewRequest(
          result[TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY],
        )
      ) {
        await chrome.storage.local.remove(
          TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY,
        );
      }
    }

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (
        areaName !== "local" ||
        !changes[TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY]
      ) {
        return;
      }

      if (
        consumeTailoredResumeReviewRequest(
          changes[TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY].newValue,
        )
      ) {
        void chrome.storage.local.remove(
          TAILORED_RESUME_REVIEW_REQUEST_STORAGE_KEY,
        );
      }
    }

    void consumeStoredRequest();
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      isCancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [consumeTailoredResumeReviewRequest]);

  async function handleOpenTailoredResumeOnWeb(
    tailoredResumeId: string | null = null,
  ) {
    if (dashboardOpenActionState === "running") {
      return;
    }

    setDashboardOpenActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: buildTailoredResumeReviewUrl(tailoredResumeId),
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open the tailored resume.");
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open the tailored resume.",
        status: "error",
      });
    } finally {
      setDashboardOpenActionState("idle");
    }
  }

  async function handleDownloadTailoredResumeFromMenu(
    tailoredResume: TailoredResumeSummary,
  ) {
    if (tailoredResumeMenuActionState !== "idle") {
      return;
    }

    setTailoredResumeMenuActionState("downloading");
    setTailoredResumeMenuActionResumeId(tailoredResume.id);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          companyName: tailoredResume.companyName,
          displayName: tailoredResume.displayName,
          downloadName: buildTailoredResumeDownloadFilename(
            tailoredResume,
            personalInfo?.generationSettings,
          ),
          tailoredResumeId: tailoredResume.id,
        },
        type: "JOB_HELPER_DOWNLOAD_TAILORED_RESUME",
      });
      assertRuntimeResponseOk(response, "Could not download that resume.");
      setTailoredResumeMenuId(null);
    } catch (error) {
      setTailoredResumeMenuError(
        error instanceof Error ? error.message : "Could not download that resume.",
      );
      setTailoredResumeMenuErrorResumeId(tailoredResume.id);
    } finally {
      setTailoredResumeMenuActionState("idle");
      setTailoredResumeMenuActionResumeId(null);
    }
  }

  async function handleGoToTailoredResumeTab(tailoredResume: TailoredResumeSummary) {
    const targetUrl = tailoredResume.jobUrl?.trim() ?? "";

    if (!targetUrl || tailoredResumeMenuActionState !== "idle") {
      return;
    }

    setTailoredResumeMenuActionState("goingToTab");
    setTailoredResumeMenuActionResumeId(tailoredResume.id);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          url: targetUrl,
        },
        type: "JOB_HELPER_GO_TO_TAB",
      });
      assertRuntimeResponseOk(response, "Could not open that job tab.");
      await revealTailoredResumeKeywordsOnPage(tailoredResume);
      setTailoredResumeMenuId(null);
    } catch (error) {
      setTailoredResumeMenuError(
        error instanceof Error ? error.message : "Could not open that job tab.",
      );
      setTailoredResumeMenuErrorResumeId(tailoredResume.id);
    } finally {
      setTailoredResumeMenuActionState("idle");
      setTailoredResumeMenuActionResumeId(null);
    }
  }

  async function handleOpenTailoredResumeInWebAppFromMenu(
    tailoredResume: TailoredResumeSummary,
  ) {
    if (tailoredResumeMenuActionState !== "idle") {
      return;
    }

    setTailoredResumeMenuActionState("openingWeb");
    setTailoredResumeMenuActionResumeId(tailoredResume.id);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: buildTailoredResumeReviewUrl(tailoredResume.id),
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open that resume in the web app.");
      setTailoredResumeMenuId(null);
      setTailoredResumeMenuPosition(null);
    } catch (error) {
      setTailoredResumeMenuError(
        error instanceof Error
          ? error.message
          : "Could not open that resume in the web app.",
      );
      setTailoredResumeMenuErrorResumeId(tailoredResume.id);
    } finally {
      setTailoredResumeMenuActionState("idle");
      setTailoredResumeMenuActionResumeId(null);
    }
  }

  async function handleRetryTailoredResumeFromMenu(
    tailoredResume: TailoredResumeSummary,
  ) {
    const targetUrl = tailoredResume.jobUrl?.trim() ?? "";

    if (!targetUrl || tailoredResumeMenuActionState !== "idle") {
      return;
    }

    setTailoredResumeMenuActionState("retrying");
    setTailoredResumeMenuActionResumeId(tailoredResume.id);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);
    void requestHideTailoredResumeBadgesForUrls([targetUrl]);

    const registryPageKey = buildTailorRunRegistryKey(targetUrl);
    const optimisticRun = buildRetryTailorRunRecord({
      applicationId: tailoredResume.applicationId,
      companyName: tailoredResume.companyName,
      jobIdentifier: tailoredResume.jobIdentifier,
      pageTitle: tailoredResume.displayName,
      pageUrl: targetUrl,
      positionTitle: tailoredResume.positionTitle,
      suppressedTailoredResumeId: tailoredResume.id,
    });
    const optimisticActiveTailoring = {
      applicationId: tailoredResume.applicationId,
      blockingTechnologies: [],
      companyName: tailoredResume.companyName,
      createdAt: optimisticRun.capturedAt,
      error: null,
      emphasizedTechnologies: [],
      id: `retry:${tailoredResume.id}`,
      jobDescription: "",
      jobIdentifier: tailoredResume.jobIdentifier,
      jobUrl: targetUrl,
      kind: "active_generation" as const,
      lastStep: optimisticRun.generationStep,
      positionTitle: tailoredResume.positionTitle,
      status: "RUNNING" as const,
      updatedAt: optimisticRun.capturedAt,
    } satisfies TailorResumeExistingTailoringState;

    setTailoringRunsByKey((currentRegistry) =>
      registryPageKey
        ? {
            ...currentRegistry,
            [registryPageKey]: optimisticRun,
          }
        : currentRegistry,
    );
    setPersonalInfoState((currentState) => {
      if (currentState.status !== "ready") {
        return currentState;
      }

      const nextPersonalInfo = {
        ...currentState.personalInfo,
        activeTailoring: optimisticActiveTailoring,
        activeTailorings: [
          optimisticActiveTailoring,
          ...currentState.personalInfo.activeTailorings.filter(
            (activeTailoring) =>
              !sameTailoringJobUrl(activeTailoring.jobUrl, targetUrl),
          ),
        ],
      } satisfies PersonalInfoSummary;

      lastReadyPersonalInfoRef.current = nextPersonalInfo;
      publishPersonalInfoToSharedCache(nextPersonalInfo);

      return {
        personalInfo: nextPersonalInfo,
        status: "ready",
      };
    });

    try {
      await sendRetryTailoringRequest({
        applicationId: tailoredResume.applicationId,
        tailoredResumeId: tailoredResume.id,
        url: targetUrl,
      });
      setTailoredResumeMenuId(null);
      setTailoredResumeMenuPosition(null);
      setActiveTailorRunDetailView(null);
      setSelectedTailoredResumeId(null);
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      setTailoredResumeMenuError(
        error instanceof Error
          ? error.message
          : "Could not retry tailoring for that job.",
      );
      setTailoredResumeMenuErrorResumeId(tailoredResume.id);
    } finally {
      setTailoredResumeMenuActionState("idle");
      setTailoredResumeMenuActionResumeId(null);
    }
  }

  function handleDeleteTailoredResumeFromMenu(tailoredResumeId: string) {
    setTailoredResumeMenuId(null);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);
    setPendingPersonalDelete({
      kind: "tailoredResume",
      tailoredResumeId,
    });
    setPersonalDeleteError(null);
  }

  async function handleArchiveTailoredResumeFromMenu(input: {
    archived: boolean;
    tailoredResumeId: string;
  }) {
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);

    const result = await setTailoredResumeArchivedState(input);

    if (result.ok) {
      setTailoredResumeMenuId(null);
      setTailoredResumeMenuPosition(null);
      return;
    }

    setTailoredResumeMenuError(result.error);
    setTailoredResumeMenuErrorResumeId(input.tailoredResumeId);
  }

  async function handleRevealKeywordBadge(tailoredResume: TailoredResumeSummary) {
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);

    try {
      await revealTailoredResumeKeywordsOnPage(tailoredResume);
      setTailoredResumeMenuId(null);
      setTailoredResumeMenuPosition(null);
    } catch (error) {
      setTailoredResumeMenuError(
        error instanceof Error
          ? error.message
          : "Could not show the keywords popup.",
      );
      setTailoredResumeMenuErrorResumeId(tailoredResume.id);
    }
  }

  async function revealTailoredResumeKeywordsOnPage(
    tailoredResume: TailoredResumeSummary,
  ) {
    await chrome.runtime.sendMessage({
      payload: {
        displayName: tailoredResume.displayName,
        emphasizedTechnologies: tailoredResume.emphasizedTechnologies,
        includeLowPriorityTermsInKeywordCoverage,
        jobUrl: tailoredResume.jobUrl ?? null,
        keywordCoverage: tailoredResume.keywordCoverage,
        nonTechnologyNames:
          personalInfo?.userMarkdown.nonTechnologies ??
          savedSettingsUserMarkdown.nonTechnologies,
        tailoredResumeId: tailoredResume.id,
      },
      type: "JOB_HELPER_REVEAL_KEYWORD_BADGE",
    });
  }

  async function revealActiveTailorRunKeywordsOnPage(card: ActiveTailorRunCard) {
    const emphasizedTechnologies = card.emphasizedTechnologies.filter(
      (technology) => technology.name.trim(),
    );

    if (emphasizedTechnologies.length === 0) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      payload: {
        badgeKey: buildActiveTailorRunKeywordBadgeKey(card),
        displayName: card.title,
        emphasizedTechnologies,
        includeLowPriorityTermsInKeywordCoverage: false,
        jobUrl: card.url,
        keywordCoverage: null,
        nonTechnologyNames:
          personalInfo?.userMarkdown.nonTechnologies ??
          savedSettingsUserMarkdown.nonTechnologies,
      },
      type: "JOB_HELPER_REVEAL_KEYWORD_BADGE",
    });
    assertRuntimeResponseOk(response, "Could not show the keywords popup.");
  }

  async function handleRevealActiveTailorRunKeywords(card: ActiveTailorRunCard) {
    const emphasizedTechnologies = card.emphasizedTechnologies.filter(
      (technology) => technology.name.trim(),
    );

    if (emphasizedTechnologies.length === 0) {
      return;
    }

    const isCurrentCard = card.isCurrentPage;
    const backgroundActionState =
      backgroundTailorRunActionStates[card.id] ?? null;

    if (
      (isCurrentCard && tailorRunMenuActionState !== "idle") ||
      (!isCurrentCard && backgroundActionState)
    ) {
      return;
    }

    if (isCurrentCard) {
      setTailorRunMenuActionState("showingKeywords");
      setTailorRunMenuError(null);
    } else {
      setBackgroundTailorRunActionStates((currentStates) => ({
        ...currentStates,
        [card.id]: "showingKeywords",
      }));
      setBackgroundTailorRunMenuError(null);
      setBackgroundTailorRunMenuErrorCardId(null);
    }

    try {
      await revealActiveTailorRunKeywordsOnPage(card);

      if (isCurrentCard) {
        setIsTailorRunMenuOpen(false);
      } else {
        setBackgroundTailorRunMenuId(null);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not show the keywords popup.";

      if (isCurrentCard) {
        setTailorRunMenuError(message);
        setIsTailorRunMenuOpen(true);
      } else {
        setBackgroundTailorRunMenuErrorCardId(card.id);
        setBackgroundTailorRunMenuError(message);
        setBackgroundTailorRunMenuId(card.id);
      }
    } finally {
      if (isCurrentCard) {
        setTailorRunMenuActionState("idle");
      } else {
        setBackgroundTailorRunActionStates((currentStates) => {
          const nextStates = { ...currentStates };
          delete nextStates[card.id];
          return nextStates;
        });
      }
    }
  }

  async function handleOpenTrackedApplication(
    application: TrackedApplicationSummary,
  ) {
    if (application.jobUrl) {
      await chrome.tabs.create({ url: application.jobUrl });
      return;
    }

    await handleOpenApplicationsDashboard();
  }

  async function deletePendingPersonalItem() {
    if (
      authState.status !== "signedIn" ||
      !pendingPersonalDelete ||
      !pendingPersonalDeleteImpact
    ) {
      return;
    }

    const currentDelete = pendingPersonalDelete;
    const currentDeleteImpact = pendingPersonalDeleteImpact;
    const fallbackMessage =
      currentDelete.kind === "application"
        ? "Unable to delete the application."
        : "Unable to delete the tailored resume.";
    const previousPersonalInfo = personalInfo ?? null;
    const optimisticPersonalInfo =
      previousPersonalInfo && currentDeleteImpact
        ? removeDeletedItemsFromPersonalInfo({
            impact: currentDeleteImpact,
            personalInfo: previousPersonalInfo,
          })
        : null;
    const deletedJobUrls =
      previousPersonalInfo && currentDeleteImpact
        ? readDeletedPersonalInfoJobUrls({
            impact: currentDeleteImpact,
            personalInfo: previousPersonalInfo,
          })
        : [];
    let shouldRefreshPersonalInfo = false;

    setPersonalDeleteActionState("deleting");
    setPersonalDeleteError(null);
    setTailoredResumeMutationError(null);
    void requestHideTailoredResumeBadgesForUrls(deletedJobUrls);

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    setPendingPersonalDelete(null);

    try {
      if (currentDelete.kind === "application") {
        const response = await fetch(
          `${DEFAULT_JOB_APPLICATIONS_ENDPOINT}/${encodeURIComponent(
            currentDelete.applicationId,
          )}`,
          {
            credentials: "include",
            headers: {
              Authorization: `Bearer ${authState.session.sessionToken}`,
            },
            method: "DELETE",
          },
        );
        const payload = await response.json().catch(() => ({}));

        if (response.status === 401) {
          await invalidateAuthSession();
          throw new Error("Connect Google before managing applications.");
        }

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, fallbackMessage));
        }
      } else {
        const result = await patchTailorResume({
          action: "deleteTailoredResume",
          tailoredResumeId: currentDelete.tailoredResumeId,
        });

        if (!result.ok) {
          throw new Error(
            readTailorResumePayloadError(result.payload, fallbackMessage),
          );
        }
      }

      setPersonalDeleteError(null);
      shouldRefreshPersonalInfo = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;

      if (
        currentDelete.kind === "tailoredResume" &&
        isMissingTailoredResumeErrorMessage(message)
      ) {
        await evictMissingTailoredResumeLocally(currentDelete.tailoredResumeId);
        setPersonalDeleteError(null);
        shouldRefreshPersonalInfo = true;
      } else {
        if (previousPersonalInfo) {
          lastReadyPersonalInfoRef.current = previousPersonalInfo;
          setPersonalInfoState({
            personalInfo: previousPersonalInfo,
            status: "ready",
          });
          publishPersonalInfoToSharedCache(previousPersonalInfo);
        }

        setPendingPersonalDelete(currentDelete);
        setPersonalDeleteError(message);

        if (currentDelete.kind === "tailoredResume") {
          setTailoredResumeMutationError(message);
        }
      }
    } finally {
      setPersonalDeleteActionState("idle");
    }

    if (shouldRefreshPersonalInfo) {
      void loadPersonalInfo({ preserveCurrent: true });
    }
  }

  async function handleGoToTailorRunTab() {
    const targetUrl = displayedTailorRunUrl?.trim() ?? "";

    if (!targetUrl || tailorRunMenuActionState !== "idle") {
      return;
    }

    setTailorRunMenuActionState("goingToTab");
    setTailorRunMenuError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          url: targetUrl,
        },
        type: "JOB_HELPER_GO_TO_TAB",
      });
      assertRuntimeResponseOk(response, "Could not open that job tab.");
      if (currentActiveTailorRunCard) {
        await revealActiveTailorRunKeywordsOnPage(currentActiveTailorRunCard);
      } else if (currentPageCompletedTailoredResume) {
        await revealTailoredResumeKeywordsOnPage(currentPageCompletedTailoredResume);
      }
      setIsTailorRunMenuOpen(false);
    } catch (error) {
      setTailorRunMenuError(
        error instanceof Error ? error.message : "Could not open that job tab.",
      );
    } finally {
      setTailorRunMenuActionState("idle");
    }
  }

  async function cancelTailoringBeforeRetry(input: {
    existingTailoringId: string | null;
    fallbackMessage: string;
    jobUrl: string | null;
    pageKey: string | null;
  }) {
    const response = await chrome.runtime.sendMessage({
      payload: {
        existingTailoringId: input.existingTailoringId,
        jobUrl: input.jobUrl,
        pageKey: input.pageKey,
      },
      type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
    });

    if (isRecord(response) && response.ok === true) {
      return;
    }

    const message = readErrorMessage(response, input.fallbackMessage);

    if (isInactiveTailoringErrorMessage(message)) {
      return;
    }

    throw new Error(message);
  }

  async function sendRetryTailoringRequest(input: {
    applicationId?: string | null;
    tailoredResumeId?: string | null;
    url: string;
  }) {
    const response = await chrome.runtime.sendMessage({
      payload: {
        ...(input.applicationId?.trim()
          ? { existingTailoringApplicationId: input.applicationId.trim() }
          : {}),
        ...(input.tailoredResumeId?.trim()
          ? { existingTailoringTailoredResumeId: input.tailoredResumeId.trim() }
          : {}),
        url: input.url,
      },
      type: "JOB_HELPER_REGENERATE_TAILORING",
    });

    assertRuntimeResponseOk(response, "Could not retry tailoring for that job.");
  }

  async function handleRetryTailorRun() {
    const targetUrl = displayedTailorRunUrl?.trim() ?? "";

    if (!targetUrl || tailorRunMenuActionState !== "idle") {
      return;
    }

    const existingTailoringId =
      currentPagePersonalInfoTailoring &&
      currentPagePersonalInfoTailoring.kind !== "completed"
        ? currentPagePersonalInfoTailoring.id
        : existingTailoringPrompt &&
            existingTailoringPrompt.existingTailoring.kind !== "completed"
          ? existingTailoringPrompt.existingTailoring.id
          : activeTailoring?.kind === "completed"
            ? null
            : activeTailoring?.id ?? null;
    const retryApplicationId =
      currentPageCompletedTailoredResume?.applicationId ??
      currentPageCompletedTailoring?.applicationId ??
      currentPagePersonalInfoTailoring?.applicationId ??
      existingTailoringPrompt?.existingTailoring.applicationId ??
      activeTailoring?.applicationId ??
      lastTailoringRun?.applicationId ??
      currentActiveTailorRunCard?.applicationId ??
      null;
    const retryTailoredResumeId =
      topLevelTailoredResumeId ??
      (existingTailoringPrompt?.existingTailoring.kind === "completed"
        ? existingTailoringPrompt.existingTailoring.tailoredResumeId
        : null) ??
      currentPageCompletedTailoredResume?.id ??
      currentPageCompletedTailoring?.tailoredResumeId ??
      lastTailoringRun?.tailoredResumeId ??
      null;
    const shouldCancelCurrentTailoring = Boolean(
      isTailorPreparationPending ||
        (existingTailoringPrompt
          ? existingTailoringPrompt.existingTailoring.kind !== "completed"
          : false) ||
        captureState === "running" ||
        captureState === "finishing" ||
        captureState === "needs_input" ||
        Boolean(tailorInterview) ||
        Boolean(
          currentPagePersonalInfoTailoring &&
            currentPagePersonalInfoTailoring.kind !== "completed",
        ) ||
        isTransientTailoringRun(lastTailoringRun),
    );
    const registryPageKey =
      currentPageResolvedRegistryKey ?? buildTailorRunRegistryKey(targetUrl);
    let previousPersonalInfo: PersonalInfoSummary | null = null;
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    let cancelSettled = !shouldCancelCurrentTailoring;

    setTailorRunMenuActionState("retrying");
    setTailorRunMenuError(null);
    setIsTailorRunMenuOpen(false);
    void requestHideTailoredResumeBadgesForUrls([targetUrl, registryPageKey]);

    const optimisticRun = buildRetryTailorRunRecord({
      applicationId: retryApplicationId,
      companyName:
        currentPageCompletedTailoring?.companyName ??
        currentPageCompletedTailoredResume?.companyName ??
        currentPagePersonalInfoTailoring?.companyName ??
        existingTailoringPrompt?.existingTailoring.companyName ??
        activeTailoring?.companyName ??
        lastTailoringRun?.companyName ??
        currentActiveTailorRunCard?.title ??
        null,
      jobIdentifier:
        currentPageCompletedTailoring?.jobIdentifier ??
        currentPageCompletedTailoredResume?.jobIdentifier ??
        currentPagePersonalInfoTailoring?.jobIdentifier ??
        existingTailoringPrompt?.existingTailoring.jobIdentifier ??
        activeTailoring?.jobIdentifier ??
        lastTailoringRun?.jobIdentifier ??
        null,
      pageContext: currentPageContext,
      pageTitle: lastTailoringRun?.pageTitle ?? currentPageContext?.title ?? null,
      pageUrl: targetUrl,
      positionTitle:
        currentPageCompletedTailoring?.positionTitle ??
        currentPageCompletedTailoredResume?.positionTitle ??
        currentPagePersonalInfoTailoring?.positionTitle ??
        existingTailoringPrompt?.existingTailoring.positionTitle ??
        activeTailoring?.positionTitle ??
        lastTailoringRun?.positionTitle ??
        null,
      suppressedTailoredResumeId: retryTailoredResumeId,
    });

    setTailorGenerationStep(optimisticRun.generationStep);
    setTailorGenerationStepTimings([]);
    setLastTailoringRun(optimisticRun);
    setCaptureState("running");
    setTailoringRunsByKey((currentRegistry) =>
      registryPageKey
        ? {
            ...currentRegistry,
            [registryPageKey]: optimisticRun,
          }
        : currentRegistry,
    );

    if (shouldCancelCurrentTailoring) {
      activeTailorRequestAbortControllerRef.current?.abort();
      activeTailorRequestAbortControllerRef.current = null;
      setActiveTailoringOverrideState("idle");
      setIsPreparingTailorStart(false);
      setIsStoppingCurrentTailoring(false);
      setExistingTailoringPrompt(null);
      setTailorPreparationState(null);
      setTailorInterview(null);
      setIsTailorInterviewOpen(false);
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setIsTailorInterviewFinishPromptOpen(false);
      setTailorInterviewError(null);
      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        previousPersonalInfo = currentState.personalInfo;
        nextPersonalInfo = removeInFlightTailorRunFromPersonalInfo({
          jobUrl: targetUrl,
          personalInfo: currentState.personalInfo,
          tailorRunId: existingTailoringId ?? "",
        });

        return {
          personalInfo: nextPersonalInfo,
          status: "ready",
        };
      });

      if (nextPersonalInfo) {
        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);
      }
    }

    try {
      if (shouldCancelCurrentTailoring) {
        await clearTailorRegistryEntriesForMatch({
          jobUrl: targetUrl,
          pageIdentity: currentPageIdentity,
          pageKey: registryPageKey,
        }).catch((error) => {
          console.error("Could not clear the retried tailoring run.", error);
        });
        setTailoringRunsByKey((currentRegistry) =>
          registryPageKey
            ? {
                ...currentRegistry,
                [registryPageKey]: optimisticRun,
              }
            : currentRegistry,
        );
        await cancelTailoringBeforeRetry({
          existingTailoringId,
          fallbackMessage: "Unable to stop the current tailoring run before retrying.",
          jobUrl: targetUrl,
          pageKey: registryPageKey,
        });
        cancelSettled = true;
      }

      await sendRetryTailoringRequest({
        applicationId: retryApplicationId,
        tailoredResumeId: retryTailoredResumeId,
        url: targetUrl,
      });
      setActiveTailorRunDetailView(null);
      setSelectedTailoredResumeId(null);
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      if (!cancelSettled && previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setTailorRunMenuError(
        error instanceof Error
          ? error.message
          : "Could not retry tailoring for that job.",
      );
    } finally {
      setTailorRunMenuActionState("idle");
    }
  }

  async function handleArchiveTailorRun() {
    const tailoredResumeId = topLevelTailoredResumeId?.trim() ?? "";

    if (!tailoredResumeId || tailorRunMenuActionState !== "idle") {
      return;
    }

    setTailorRunMenuActionState("archiving");
    setTailorRunMenuError(null);

    const result = await setTailoredResumeArchivedState({
      archived: true,
      tailoredResumeId,
    });

    if (result.ok) {
      setActiveTailorRunDetailView(null);
      setIsTailorRunMenuOpen(false);
    } else {
      setTailorRunMenuError(
        result.error ?? "Unable to archive the tailored resume.",
      );
    }

    setTailorRunMenuActionState("idle");
  }

  async function handleDeleteTailorRun() {
    const deleteTarget = tailorRunDeleteTarget;
    const isFailedTailorRunDelete =
      currentActiveTailorRunCard?.statusDisplayState === "error" ||
      (currentPagePersonalInfoTailoring?.kind === "active_generation" &&
        currentPagePersonalInfoTailoring.status === "FAILED") ||
      lastTailoringRun?.status === "error";
    const shouldCancelCurrentTailoring = Boolean(
      !isFailedTailorRunDelete &&
        (isTailorPreparationPending ||
          (existingTailoringPrompt
            ? existingTailoringPrompt.existingTailoring.kind !== "completed"
            : false) ||
          captureState === "running" ||
          captureState === "finishing" ||
          captureState === "needs_input" ||
          Boolean(tailorInterview) ||
          Boolean(
            currentPagePersonalInfoTailoring &&
              currentPagePersonalInfoTailoring.kind !== "completed",
          ) ||
          isTransientTailoringRun(lastTailoringRun)),
    );

    if ((!deleteTarget && !canDeleteTailorRun) || tailorRunMenuActionState !== "idle") {
      return;
    }

    const tailoredResumeId = deleteTarget?.tailoredResumeId?.trim() ?? "";
    const jobUrl = deleteTarget?.jobUrl?.trim() ?? "";
    const tailorRunId = deleteTarget?.tailorRunId?.trim() ?? "";
    const existingTailoringId =
      currentPagePersonalInfoTailoring &&
      currentPagePersonalInfoTailoring.kind !== "completed"
        ? currentPagePersonalInfoTailoring.id
        : existingTailoringPrompt &&
            existingTailoringPrompt.existingTailoring.kind !== "completed"
          ? existingTailoringPrompt.existingTailoring.id
          : activeTailoring?.kind === "completed"
            ? null
            : activeTailoring?.id ?? null;
    const cancelJobUrl =
      jobUrl ||
      currentPageUrl ||
      currentPagePersonalInfoTailoring?.jobUrl ||
      existingTailoringPrompt?.jobUrl ||
      lastTailoringRun?.pageUrl ||
      tailorPreparationState?.pageUrl ||
      tailorInterview?.jobUrl ||
      activeTailoring?.jobUrl ||
      null;
    const registryPageKey =
      currentPageResolvedRegistryKey ??
      buildTailorRunRegistryKey(cancelJobUrl);
    const shouldRemoveSavedArtifacts = Boolean(tailoredResumeId);
    const fallbackMessage = "Unable to delete the tailored resume.";
    void requestHideTailoredResumeBadgesForUrls([
      jobUrl,
      cancelJobUrl,
      registryPageKey,
      currentPageUrl,
    ]);

    setTailorRunMenuActionState("deleting");
    setTailorRunMenuError(null);
    setIsTailorRunMenuOpen(false);
    setActiveTailorRunDetailView(null);
    setExistingTailoringPrompt(null);
    setPendingTailoredResumeReviewEditId(null);
    setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
    setTailoredResumeReviewState((currentState) =>
      tailoredResumeId && currentState.record?.id === tailoredResumeId
        ? { record: null, status: "idle" }
        : currentState,
    );
    setTailorInterview(null);
    setIsTailorInterviewOpen(false);
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
    setIsTailorInterviewFinishPromptOpen(false);
    setTailorInterviewError(null);
    setTailorGenerationStep(null);
    setTailorGenerationStepTimings([]);
    setLastTailoringRun(null);
    setCaptureState("idle");
    let previousPersonalInfo: PersonalInfoSummary | null = null;
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    setPersonalInfoState((currentState) => {
      if (currentState.status !== "ready") {
        return currentState;
      }

      previousPersonalInfo = currentState.personalInfo;
      nextPersonalInfo = shouldRemoveSavedArtifacts
        ? removeTailorRunArtifactsFromPersonalInfo({
            jobUrl,
            personalInfo: currentState.personalInfo,
            tailoredResumeId,
            tailorRunId,
          })
        : removeInFlightTailorRunFromPersonalInfo({
            jobUrl: cancelJobUrl ?? jobUrl,
            personalInfo: currentState.personalInfo,
            tailorRunId: tailorRunId || existingTailoringId || "",
          });

      return {
        personalInfo: nextPersonalInfo,
        status: "ready",
      };
    });

    if (nextPersonalInfo) {
      lastReadyPersonalInfoRef.current = nextPersonalInfo;
      publishPersonalInfoToSharedCache(nextPersonalInfo);
    }

    let shouldRefreshPersonalInfo = false;

    try {
      activeTailorRequestAbortControllerRef.current?.abort();
      activeTailorRequestAbortControllerRef.current = null;
      setActiveTailoringOverrideState("idle");
      await clearTailorRegistryEntriesForMatch({
        jobUrl: cancelJobUrl,
        pageIdentity: currentPageIdentity,
        pageKey: registryPageKey,
      }).catch((error) => {
        console.error("Could not clear the deleted tailoring run.", error);
      });

      if (shouldCancelCurrentTailoring) {
        try {
          const response = await chrome.runtime.sendMessage({
            payload: {
              existingTailoringId: tailorRunId || existingTailoringId,
              jobUrl: cancelJobUrl,
              pageKey: registryPageKey,
            },
            type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
          });

          assertRuntimeResponseOk(
            response,
            "Unable to stop the current tailoring run.",
          );
        } catch (error) {
          await loadPersonalInfo();
          throw error;
        }
      }

      if (deleteTarget) {
        const result = await patchTailorResume({
          action: "deleteTailoredResumeArtifact",
          ...(jobUrl ? { jobUrl } : {}),
          ...(tailorRunId ? { tailorRunId } : {}),
          ...(tailoredResumeId ? { tailoredResumeId } : {}),
        });

        if (!result.ok) {
          const message = readTailorResumePayloadError(result.payload, fallbackMessage);

          if (isMissingTailoredResumeErrorMessage(message)) {
            shouldRefreshPersonalInfo = true;
          } else {
            throw new Error(message);
          }
        }
      }
      shouldRefreshPersonalInfo = true;
    } catch (error) {
      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setTailorRunMenuError(
        error instanceof Error ? error.message : fallbackMessage,
      );
    } finally {
      setTailorRunMenuActionState("idle");
    }

    if (shouldRefreshPersonalInfo) {
      void loadPersonalInfo({ preserveCurrent: true });
    }
  }

  async function handleGoToBackgroundTailorRunTab(card: ActiveTailorRunCard) {
    const targetUrl = card.url?.trim() ?? "";

    if (
      card.isCurrentPage ||
      !targetUrl ||
      backgroundTailorRunActionStates[card.id]
    ) {
      return;
    }

    setBackgroundTailorRunActionStates((currentStates) => ({
      ...currentStates,
      [card.id]: "goingToTab",
    }));
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          url: targetUrl,
        },
        type: "JOB_HELPER_GO_TO_TAB",
      });
      assertRuntimeResponseOk(response, "Could not open that job tab.");
      await revealActiveTailorRunKeywordsOnPage(card);
      setBackgroundTailorRunMenuId(null);
    } catch (error) {
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error ? error.message : "Could not open that job tab.",
      );
    } finally {
      setBackgroundTailorRunActionStates((currentStates) => {
        const nextStates = { ...currentStates };
        delete nextStates[card.id];
        return nextStates;
      });
    }
  }

  async function handleStopBackgroundTailorRun(card: ActiveTailorRunCard) {
    const jobUrl = card.deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";

    if (
      card.isCurrentPage ||
      backgroundTailorRunActionStates[card.id] ||
      (!jobUrl && !existingTailoringId)
    ) {
      return;
    }

    setBackgroundTailorRunActionStates((currentStates) => ({
      ...currentStates,
      [card.id]: "stopping",
    }));
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    setBackgroundTailorRunMenuId(null);
    let previousPersonalInfo: PersonalInfoSummary | null = null;
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    setPersonalInfoState((currentState) => {
      if (currentState.status !== "ready") {
        return currentState;
      }

      previousPersonalInfo = currentState.personalInfo;
      nextPersonalInfo = removeInFlightTailorRunFromPersonalInfo({
        jobUrl,
        personalInfo: currentState.personalInfo,
        tailorRunId: existingTailoringId,
      });

      return {
        personalInfo: nextPersonalInfo,
        status: "ready",
      };
    });

    if (nextPersonalInfo) {
      lastReadyPersonalInfoRef.current = nextPersonalInfo;
      publishPersonalInfoToSharedCache(nextPersonalInfo);
    }

    void requestHideTailoredResumeBadgesForUrls([jobUrl, card.pageKey]);

    await clearTailorRegistryEntriesForMatch({
      jobUrl,
      pageKey: card.pageKey,
    });

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          existingTailoringId: existingTailoringId || null,
          jobUrl: jobUrl || null,
          pageKey: card.pageKey,
        },
        type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
      });
      assertRuntimeResponseOk(response, "Unable to stop the tailoring run.");
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      await loadPersonalInfo();
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error ? error.message : "Unable to stop the tailoring run.",
      );
    } finally {
      setBackgroundTailorRunActionStates((currentStates) => {
        const nextStates = { ...currentStates };
        delete nextStates[card.id];
        return nextStates;
      });
    }
  }

  async function handleRetryBackgroundTailorRun(card: ActiveTailorRunCard) {
    const targetUrl = card.deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";
    const shouldCancelExistingRun =
      card.statusDisplayState !== "error" || Boolean(existingTailoringId);

    if (
      card.isCurrentPage ||
      backgroundTailorRunActionStates[card.id] ||
      !targetUrl
    ) {
      return;
    }

    setBackgroundTailorRunActionStates((currentStates) => ({
      ...currentStates,
      [card.id]: "retrying",
    }));
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    setBackgroundTailorRunMenuId(null);
    void requestHideTailoredResumeBadgesForUrls([targetUrl, card.pageKey]);

    const registryPageKey = card.pageKey ?? buildTailorRunRegistryKey(targetUrl);
    const optimisticRun = buildRetryTailorRunRecord({
      applicationId: card.applicationId,
      companyName: card.title,
      pageTitle: card.title,
      pageUrl: targetUrl,
      suppressedTailoredResumeId:
        card.deleteTarget?.tailoredResumeId ?? card.suppressedTailoredResumeId,
    });

    setTailoringRunsByKey((currentRegistry) =>
      registryPageKey
        ? {
            ...currentRegistry,
            [registryPageKey]: optimisticRun,
          }
        : currentRegistry,
    );

    let previousPersonalInfo: PersonalInfoSummary | null = null;
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    let cancelSettled = !shouldCancelExistingRun;

    if (shouldCancelExistingRun) {
      setPersonalInfoState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        previousPersonalInfo = currentState.personalInfo;
        nextPersonalInfo = removeInFlightTailorRunFromPersonalInfo({
          jobUrl: targetUrl,
          personalInfo: currentState.personalInfo,
          tailorRunId: existingTailoringId,
        });

        return {
          personalInfo: nextPersonalInfo,
          status: "ready",
        };
      });

      if (nextPersonalInfo) {
        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);
      }
    }

    await clearTailorRegistryEntriesForMatch({
      jobUrl: targetUrl,
      pageKey: card.pageKey,
    }).catch((error) => {
      console.error("Could not clear the retried tailoring run.", error);
    });
    setTailoringRunsByKey((currentRegistry) =>
      registryPageKey
        ? {
            ...currentRegistry,
            [registryPageKey]: optimisticRun,
          }
        : currentRegistry,
    );

    try {
      if (shouldCancelExistingRun) {
        await cancelTailoringBeforeRetry({
          existingTailoringId: existingTailoringId || null,
          fallbackMessage: "Unable to stop the tailoring run before retrying.",
          jobUrl: targetUrl,
          pageKey: card.pageKey,
        });
        cancelSettled = true;
      }

      await sendRetryTailoringRequest({
        applicationId: card.applicationId,
        tailoredResumeId:
          card.deleteTarget?.tailoredResumeId ?? card.suppressedTailoredResumeId,
        url: targetUrl,
      });
      setActiveTailorRunDetailView(null);
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      if (!cancelSettled && previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      await loadPersonalInfo();
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error
          ? error.message
          : "Could not retry tailoring for that job.",
      );
    } finally {
      setBackgroundTailorRunActionStates((currentStates) => {
        const nextStates = { ...currentStates };
        delete nextStates[card.id];
        return nextStates;
      });
    }
  }

  async function retryTailorRunBatch(scope: "inFlight" | "all") {
    const canRetryRequestedBatch =
      scope === "inFlight" ? canRetryInFlightTailorRuns : canRetryAllTailorRuns;

    if (!canRetryRequestedBatch) {
      return;
    }

    const cardsToRetry = retryableTailorRunCards;
    const resumesToRetry =
      scope === "all" ? retryableUnarchivedTailoredResumes : [];

    if (cardsToRetry.length === 0 && resumesToRetry.length === 0) {
      return;
    }

    setIsRetryingAllTailorRuns(true);
    setRetryingTailorRunBatchScope(scope);
    setTailorRunMenuError(null);
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);
    setIsTailorRunMenuOpen(false);
    setBackgroundTailorRunMenuId(null);
    setTailoredResumeMenuId(null);
    setTailoredResumeMenuPosition(null);

    try {
      for (const card of cardsToRetry) {
        if (card.isCurrentPage) {
          await handleRetryTailorRun();
        } else {
          await handleRetryBackgroundTailorRun(card);
        }
      }

      for (const tailoredResume of resumesToRetry) {
        await handleRetryTailoredResumeFromMenu(tailoredResume);
      }
    } finally {
      setIsRetryingAllTailorRuns(false);
      setRetryingTailorRunBatchScope(null);
    }
  }

  async function handleDeleteBackgroundTailorRun(card: ActiveTailorRunCard) {
    const deleteTarget = card.deleteTarget;
    const jobUrl = deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";
    const tailoredResumeId = deleteTarget?.tailoredResumeId?.trim() ?? "";
    const tailorRunId = deleteTarget?.tailorRunId?.trim() ?? "";
    const shouldRemoveSavedArtifacts = Boolean(tailoredResumeId);
    const shouldCancelBeforeDelete = card.statusDisplayState !== "error";
    const fallbackMessage = "Unable to delete the tailored resume.";

    if (
      card.isCurrentPage ||
      backgroundTailorRunActionStates[card.id] ||
      (!deleteTarget && !jobUrl && !existingTailoringId)
    ) {
      return;
    }

    setBackgroundTailorRunActionStates((currentStates) => ({
      ...currentStates,
      [card.id]: "deleting",
    }));
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    setBackgroundTailorRunMenuId(null);
    let shouldRefreshPersonalInfo = false;
    let previousPersonalInfo: PersonalInfoSummary | null = null;
    let nextPersonalInfo: PersonalInfoSummary | null = null;
    setPersonalInfoState((currentState) => {
      if (currentState.status !== "ready") {
        return currentState;
      }

      previousPersonalInfo = currentState.personalInfo;
      nextPersonalInfo = shouldRemoveSavedArtifacts
        ? removeTailorRunArtifactsFromPersonalInfo({
            jobUrl,
            personalInfo: currentState.personalInfo,
            tailoredResumeId,
            tailorRunId,
          })
        : removeInFlightTailorRunFromPersonalInfo({
            jobUrl,
            personalInfo: currentState.personalInfo,
            tailorRunId: tailorRunId || existingTailoringId,
          });

      return {
        personalInfo: nextPersonalInfo,
        status: "ready",
      };
    });

    if (nextPersonalInfo) {
      lastReadyPersonalInfoRef.current = nextPersonalInfo;
      publishPersonalInfoToSharedCache(nextPersonalInfo);
    }

    void requestHideTailoredResumeBadgesForUrls([jobUrl, card.pageKey]);

    await clearTailorRegistryEntriesForMatch({
      jobUrl,
      pageKey: card.pageKey,
    });

    try {
      if (shouldCancelBeforeDelete && (jobUrl || existingTailoringId)) {
        const cancelResponse = await chrome.runtime.sendMessage({
          payload: {
            existingTailoringId: existingTailoringId || null,
            jobUrl: jobUrl || null,
            pageKey: card.pageKey,
          },
          type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
        });
        assertRuntimeResponseOk(
          cancelResponse,
          "Unable to stop the tailoring run before deleting it.",
        );
      }

      if (deleteTarget) {
        const result = await patchTailorResume({
          action: "deleteTailoredResumeArtifact",
          ...(deleteTarget.jobUrl ? { jobUrl: deleteTarget.jobUrl } : {}),
          ...(deleteTarget.tailorRunId ? { tailorRunId: deleteTarget.tailorRunId } : {}),
          ...(deleteTarget.tailoredResumeId
            ? { tailoredResumeId: deleteTarget.tailoredResumeId }
            : {}),
        });

        if (!result.ok) {
          const message = readTailorResumePayloadError(result.payload, fallbackMessage);

          if (isMissingTailoredResumeErrorMessage(message)) {
            shouldRefreshPersonalInfo = true;
          } else {
            throw new Error(message);
          }
        }
      }

      setActiveTailorRunDetailView(null);
      shouldRefreshPersonalInfo = true;
    } catch (error) {
      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      await loadPersonalInfo();
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error ? error.message : fallbackMessage,
      );
    } finally {
      setBackgroundTailorRunActionStates((currentStates) => {
        const nextStates = { ...currentStates };
        delete nextStates[card.id];
        return nextStates;
      });
    }

    if (shouldRefreshPersonalInfo) {
      void loadPersonalInfo({ preserveCurrent: true });
    }
  }

  async function handleStartTailorChatForCard(card: ActiveTailorRunCard) {
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";

    if (!existingTailoringId || generatingTailorQuestionCardIds.has(card.id)) {
      return;
    }

    const optimisticInterviewId = `generating:${existingTailoringId}`;
    let hasOpenedQuestionChat = false;
    let streamedQuestionMessage: TailorResumeConversationMessage = {
      id: `streaming-tailor-question:${existingTailoringId}`,
      role: "assistant",
      technologyContexts: [],
      text: "",
      toolCalls: [],
    };

    const readOptimisticConversation = () =>
      streamedQuestionMessage.text
        ? [
            {
              ...streamedQuestionMessage,
              toolCalls: [...streamedQuestionMessage.toolCalls],
            },
          ]
        : [];

    const publishOptimisticQuestionChat = () => {
      setTailorInterview((currentInterview) => {
        const baseInterview =
          currentInterview?.id === optimisticInterviewId
            ? currentInterview
            : buildGeneratingTailorInterviewForCard({
                card,
                existingTailoringId,
                interviewId: optimisticInterviewId,
              });

        return {
          ...baseInterview,
          conversation: readOptimisticConversation(),
          updatedAt: new Date().toISOString(),
        };
      });
    };

    const openOptimisticQuestionChat = () => {
      if (hasOpenedQuestionChat) {
        return;
      }

      hasOpenedQuestionChat = true;
      setSelectedTailorInterviewId(optimisticInterviewId);
      setPendingTailorInterviewAnswerMessage(null);
      setDraftTailorInterviewAnswer("");
      setCaptureState("needs_input");
      setIsTailorInterviewFinishPromptOpen(false);
      setGeneratingTailorQuestionInterviewId(optimisticInterviewId);
      publishOptimisticQuestionChat();
      revealTailorInterview();
    };

    const handleInterviewStreamEvent = (
      event: TailorResumeInterviewStreamEvent,
    ) => {
      if (event.kind === "reset" || event.kind === "text-start") {
        return;
      }

      if (
        event.kind === "text-delta" &&
        event.field !== "assistantMessage"
      ) {
        return;
      }

      openOptimisticQuestionChat();
      streamedQuestionMessage = applyTailorInterviewStreamEventToMessage(
        streamedQuestionMessage,
        event,
      );
      publishOptimisticQuestionChat();
    };

    setGeneratingTailorQuestionCardIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(card.id);
      return nextIds;
    });
    setTailorInterviewError(null);
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    setTailorRunMenuError(null);

    try {
      const result = await patchTailorResume({
        action: "startTailorResumeInterview",
        existingTailoringId,
      }, {
        onInterviewStreamEvent: handleInterviewStreamEvent,
      });
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to continue tailoring from Step 2.",
          ),
        );
      }

      syncTailoredResumeReviewFromPayload(result.payload);
      syncTailoredResumeSummariesFromPayload(result.payload);

      const fallbackInterview = profileSummary.tailoringInterview;
      const matchingInterview =
        profileSummary.tailoringInterviews.find((interview) =>
          activeTailorRunCardMatchesInterview({ card, interview }),
        ) ??
        (fallbackInterview &&
        activeTailorRunCardMatchesInterview({
          card,
          interview: fallbackInterview,
        })
          ? fallbackInterview
          : null) ??
        null;

      await loadPersonalInfo({ forceFresh: true, preserveCurrent: true });

      if (matchingInterview && matchingInterview.conversation.length > 0) {
        const mergedMatchingInterview =
          mergeTailorInterviewWithStreamedAssistantMessage(
            matchingInterview,
            streamedQuestionMessage,
          ) ?? matchingInterview;

        setGeneratingTailorQuestionInterviewId((currentId) =>
          currentId === optimisticInterviewId ? null : currentId,
        );
        setSelectedTailorInterviewId(mergedMatchingInterview.id);
        setTailorInterview(mergedMatchingInterview);
        setPendingTailorInterviewAnswerMessage(null);
        setDraftTailorInterviewAnswer("");
        setCaptureState("needs_input");
        revealTailorInterview({ focusComposer: true });
        return;
      }

      setGeneratingTailorQuestionInterviewId((currentId) =>
        currentId === optimisticInterviewId ? null : currentId,
      );
      setSelectedTailorInterviewId(null);
      setTailorInterview(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to continue tailoring from Step 2.";

      if (hasOpenedQuestionChat) {
        setTailorInterviewError(message);
      }

      if (card.isCurrentPage) {
        setTailorRunMenuError(message);
        setIsTailorRunMenuOpen(true);
      } else {
        setBackgroundTailorRunMenuErrorCardId(card.id);
        setBackgroundTailorRunMenuError(message);
        setBackgroundTailorRunMenuId(card.id);
      }

      void loadPersonalInfo({ preserveCurrent: true });
    } finally {
      setGeneratingTailorQuestionInterviewId((currentId) =>
        currentId === optimisticInterviewId ? null : currentId,
      );
      setGeneratingTailorQuestionCardIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(card.id);
        return nextIds;
      });
    }
  }

  const renderActiveTailorRunCard = (card: ActiveTailorRunCard) => {
    const isCurrentCard = card.isCurrentPage;
    const backgroundActionState = backgroundTailorRunActionStates[card.id] ?? null;
    const matchingCardInterview =
      personalInfo?.tailoringInterviews.find((interview) =>
        activeTailorRunCardMatchesInterview({ card, interview }),
      ) ??
      (tailorInterview &&
      activeTailorRunCardMatchesInterview({ card, interview: tailorInterview })
        ? tailorInterview
        : null);
    const canOpenInterviewChat = Boolean(
      matchingCardInterview && matchingCardInterview.conversation.length > 0,
    );
    const isQuestionStartPending =
      !canOpenInterviewChat &&
      (card.interviewStatus === "pending" || card.interviewStatus === "ready");
    const isQuestionGenerating =
      !canOpenInterviewChat &&
      (card.interviewStatus === "deciding" ||
        generatingTailorQuestionCardIds.has(card.id));
    const shouldShowInterviewAction = shouldShowTailorRunInterviewAction({
      canOpenInterviewChat,
      interviewStatus: card.interviewStatus,
      isQuestionGenerating,
      stepNumber: card.step.stepNumber,
    });
    const interviewActionState = canOpenInterviewChat
      ? "ready"
      : isQuestionStartPending
        ? "pending"
        : isQuestionGenerating
          ? "generating"
          : null;
    const isMenuOpen = isCurrentCard
      ? isTailorRunMenuOpen
      : backgroundTailorRunMenuId === card.id;
    const isMenuBusy = isCurrentCard
      ? tailorRunMenuActionState !== "idle" || isQuestionGenerating
      : Boolean(backgroundActionState) || isQuestionGenerating;
    const isStopBusy = isCurrentCard
      ? isStoppingCurrentTailoring
      : backgroundActionState === "stopping";
    const showMenuError = isCurrentCard
      ? tailorRunMenuError
      : backgroundTailorRunMenuErrorCardId === card.id
        ? backgroundTailorRunMenuError
        : null;
    const menuActionStateLabel = isCurrentCard
      ? tailorRunMenuActionState
      : backgroundActionState ?? "idle";
    const attemptBadgeLabel = readTailorResumeProgressAttemptBadgeLabel({
      attempt: card.step.attempt,
      status: card.step.status,
    });
    const stepLabel =
      card.step.label === "Resolve skills-section" ||
      card.step.label === "Ready to tailor"
        ? card.step.label
        : formatTailorResumeProgressStepLabel({
            label: card.step.label,
            status: card.step.status,
          });
    const waitingReachedAtTime =
      matchingCardInterview
        ? readActiveTailorRunSortTime(matchingCardInterview.updatedAt)
        : card.elapsedTimeEndTime;
    const frozenWaitingStepDurationLabel = matchingCardInterview
      ? readTailorRunFrozenStepDurationLabel({
          stepNumber: 2,
          stepTimings: card.stepTimings,
        })
      : null;
    const isStepTimingElapsedLabel =
      tailorRunTimeDisplayMode === "specific" &&
      (card.statusDisplayState === "loading" ||
        card.statusDisplayState === "ready" ||
        card.statusDisplayState === "warning");
    const elapsedTimeLabel =
      card.statusDisplayState === "loading"
        ? formatTailorRunStepTimeDisplay({
            activeStepNumber: card.step.stepNumber,
            mode: tailorRunTimeDisplayMode,
            nowTime: tailorRunElapsedNow,
            runStartedAtTime: card.startedAtTime,
            timings: buildTailorRunStepTimingDisplayInputs(card.stepTimings),
          })
        : card.statusDisplayState === "ready" ||
            card.statusDisplayState === "warning"
          ? tailorRunTimeDisplayMode === "specific"
            ? formatTailorRunStepTimeDisplay({
                activeStepNumber: card.step.stepNumber,
                mode: "specific",
                nowTime: waitingReachedAtTime ?? card.startedAtTime,
                runStartedAtTime: card.startedAtTime,
                timings: buildTailorRunStepTimingDisplayInputs(card.stepTimings),
              })
            : canOpenInterviewChat
              ? frozenWaitingStepDurationLabel
              : formatTailorRunElapsedTime({
                  nowTime: waitingReachedAtTime ?? card.startedAtTime,
                  startedAtTime: card.startedAtTime,
                })
          : null;
    const elapsedTimeAriaLabel =
      card.statusDisplayState === "loading"
        ? isStepTimingElapsedLabel
          ? `Step timings ${elapsedTimeLabel}`
          : `Loading for ${elapsedTimeLabel}`
        : isStepTimingElapsedLabel
          ? `Step timings ${elapsedTimeLabel}`
        : `Waited after ${elapsedTimeLabel}`;
    const elapsedTimeTitle =
      card.statusDisplayState === "loading"
        ? isStepTimingElapsedLabel
          ? `Step timings: ${elapsedTimeLabel}`
          : `Loading for ${elapsedTimeLabel}`
        : isStepTimingElapsedLabel
          ? `Step timings: ${elapsedTimeLabel}`
        : `Reached this waiting state after ${elapsedTimeLabel}`;
    const canStopCard = card.statusDisplayState !== "error";
    const canRetryCard = card.statusDisplayState === "error" && Boolean(card.url);
    const shouldShowCardProgressCopy =
      card.statusDisplayState === "error" && Boolean(card.message || card.detail);
    const showKeywordAction =
      card.emphasizedTechnologies.length > 0 && Boolean(card.url);
    const blockingTechnologyBadges = card.blockingTechnologies.filter(
      (technology) =>
        technology.classification === "skills_section" &&
        technology.name.trim().length > 0,
    );

    return (
      <section
        aria-label={card.title}
        className={`snapshot-card tailor-run-shell tailor-run-shell-${card.statusDisplayState} ${
          isCurrentCard ? "tailor-run-shell-current-page" : ""
        } ${canOpenInterviewChat ? "tailor-run-shell-chat-ready" : ""} ${
          isQuestionStartPending ? "tailor-run-shell-chat-pending" : ""
        } ${isQuestionGenerating ? "tailor-run-shell-chat-generating" : ""} ${
          isMenuOpen ? "tailor-run-shell-menu-open" : ""
        }`.trim()}
        key={card.id}
      >
        <div className="tailor-run-shell-body">
          <div className="tailor-run-meta">
            <div className="tailor-run-heading">
              <p
                className="tailor-run-url tailor-run-identity-structured"
                title={card.title}
              >
                {card.title}
              </p>
            </div>
            <div className="tailor-run-meta-badges">
              {canStopCard ? (
                <button
                  className="secondary-action compact-action"
                  disabled={
                    isCurrentCard
                      ? isStoppingCurrentTailoring || isMenuBusy
                      : isMenuBusy
                  }
                  type="button"
                  onClick={() =>
                    isCurrentCard
                      ? void stopCurrentTailoring()
                      : void handleStopBackgroundTailorRun(card)
                  }
                >
                  {isStopBusy ? "Stopping..." : "Stop run"}
                </button>
              ) : null}
              {canRetryCard ? (
                <button
                  className="secondary-action compact-action"
                  disabled={isMenuBusy}
                  type="button"
                  onClick={() =>
                    isCurrentCard
                      ? void handleRetryTailorRun()
                      : void handleRetryBackgroundTailorRun(card)
                  }
                >
                  {menuActionStateLabel === "retrying" ? "Retrying..." : "Retry"}
                </button>
              ) : null}
              <div
                className="tailor-run-menu-shell"
                ref={isCurrentCard && isMenuOpen
                  ? tailorRunMenuRef
                  : !isCurrentCard && isMenuOpen
                    ? backgroundTailorRunMenuRef
                    : undefined}
              >
                <button
                  aria-expanded={isMenuOpen}
                  aria-label="More tailor run actions"
                  className="secondary-action compact-action tailor-run-menu-trigger"
                  type="button"
                  onClick={() => {
                    if (isCurrentCard) {
                      setTailorRunMenuError(null);
                      setIsTailorRunMenuOpen((currentValue) => !currentValue);
                      return;
                    }

                    setBackgroundTailorRunMenuError(null);
                    setBackgroundTailorRunMenuErrorCardId(null);
                    setBackgroundTailorRunMenuId((currentValue) =>
                      currentValue === card.id ? null : card.id,
                    );
                  }}
                >
                  <EllipsisHorizontalIcon />
                </button>
                {isMenuOpen ? (
                  <div className="tailor-run-menu-popover">
                    <div className="tailor-run-menu">
                      {card.url ? (
                        <button
                          className="tailor-run-menu-item"
                          disabled={isMenuBusy}
                          type="button"
                          onClick={() =>
                            isCurrentCard
                              ? void handleGoToTailorRunTab()
                              : void handleGoToBackgroundTailorRunTab(card)
                          }
                        >
                          {menuActionStateLabel === "goingToTab"
                            ? "Opening..."
                            : "Go to tab"}
                        </button>
                      ) : null}
                      {showKeywordAction ? (
                        <button
                          className="tailor-run-menu-item"
                          disabled={isMenuBusy}
                          type="button"
                          onClick={() =>
                            void handleRevealActiveTailorRunKeywords(card)
                          }
                        >
                          {menuActionStateLabel === "showingKeywords"
                            ? "Showing..."
                            : "Show keywords"}
                        </button>
                      ) : null}
                      {card.url ? (
                        <button
                          className="tailor-run-menu-item"
                          disabled={isMenuBusy}
                          type="button"
                          onClick={() =>
                            isCurrentCard
                              ? void handleRetryTailorRun()
                              : void handleRetryBackgroundTailorRun(card)
                          }
                        >
                          {menuActionStateLabel === "retrying"
                            ? "Retrying..."
                            : "Retry"}
                        </button>
                      ) : null}
                      <button
                        className="tailor-run-menu-item"
                        disabled={isMenuBusy}
                        type="button"
                        onClick={() =>
                          isCurrentCard
                            ? void handleDeleteTailorRun()
                            : void handleDeleteBackgroundTailorRun(card)
                        }
                      >
                        {menuActionStateLabel === "deleting"
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    </div>
                    {showMenuError ? (
                      <p className="tailor-run-menu-error">{showMenuError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {shouldShowInterviewAction ? (
            <button
              aria-label={`Step 2 ${
                isQuestionGenerating
                  ? "Starting"
                  : isQuestionStartPending
                    ? card.interviewStatus === "ready"
                      ? "Play"
                      : "Recheck"
                    : "Answer"
              }`}
              className={`tailor-run-answer-block ${
                interviewActionState
                  ? `tailor-run-answer-block-${interviewActionState}`
                  : ""
              }`.trim()}
              disabled={
                isQuestionGenerating ||
                (!isQuestionStartPending && isTailorInterviewBusy)
              }
              type="button"
              onClick={() => {
                if (canOpenInterviewChat && matchingCardInterview) {
                  setSelectedTailorInterviewId(matchingCardInterview.id);
                  setTailorInterview(matchingCardInterview);
                  revealTailorInterview({ focusComposer: true });
                  return;
                }

                if (isQuestionStartPending) {
                  void handleStartTailorChatForCard(card);
                }
              }}
            >
              <span className="tailor-run-answer-block-copy">
                <span className="tailor-run-answer-block-kicker">Step 2</span>
                <span className="tailor-run-answer-block-label">
                  {isQuestionGenerating
                    ? "Starting..."
                    : isQuestionStartPending
                      ? card.interviewStatus === "ready"
                        ? "Play"
                        : "Recheck"
                      : "Answer"}
                </span>
                {blockingTechnologyBadges.length > 0 ? (
                  <span
                    aria-label={`Blocking skills-section keywords: ${blockingTechnologyBadges
                      .map((technology) => technology.name)
                      .join(", ")}`}
                    className="tailor-run-blocker-badges"
                  >
                    {blockingTechnologyBadges.map((technology) => (
                      <span
                        className={`tailor-run-blocker-badge tailor-run-blocker-badge-${technology.priority}`}
                        key={`${technology.priority}:${technology.name}`}
                        title={technology.evidence || technology.name}
                      >
                        {technology.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {elapsedTimeLabel ? (
                <span
                  aria-label={elapsedTimeAriaLabel}
                  className="tailor-run-answer-block-elapsed"
                  title={elapsedTimeTitle}
                >
                  {elapsedTimeLabel}
                </span>
              ) : null}
              <span
                aria-label="Open resume chat with experience prompt"
                className="tailor-run-answer-block-icon"
                role="button"
                tabIndex={0}
                title="Open resume chat with experience prompt"
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenResumeExperienceChatForCard(card);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  handleOpenResumeExperienceChatForCard(card);
                }}
              >
                <ChatBubbleIcon />
              </span>
            </button>
          ) : (
            <div className="tailor-progress-focus">
              <div
                aria-current={
                  card.step.status === "current" || card.step.status === "retrying"
                    ? "step"
                    : undefined
                }
                className={`tailor-progress-step tailor-progress-step-${card.step.status} tailor-progress-step-focus ${
                  elapsedTimeLabel ? "tailor-progress-step-with-elapsed" : ""
                }`.trim()}
                title={`Step ${card.step.stepNumber}: ${card.step.label} (${formatTailorResumeProgressStatusLabel({
                  attempt: card.step.attempt,
                  status: card.step.status,
                })})`}
              >
                <span className="tailor-progress-step-topline">
                  <span className="tailor-progress-step-number">
                    Step {card.step.stepNumber}
                  </span>
                  {attemptBadgeLabel ? (
                    <span className="tailor-progress-step-attempt-badge">
                      {attemptBadgeLabel}
                    </span>
                  ) : null}
                </span>
                <span className="tailor-progress-step-label">{stepLabel}</span>
                {elapsedTimeLabel ? (
                  <span
                    aria-label={elapsedTimeAriaLabel}
                    className="tailor-progress-step-elapsed"
                    title={elapsedTimeTitle}
                  >
                    {elapsedTimeLabel}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          {shouldShowCardProgressCopy ? (
            <div className="tailor-progress-copy">
              {card.message ? (
                <p className="tailor-progress-message">{card.message}</p>
              ) : null}
              {card.detail ? (
                <p className="tailor-progress-detail">{card.detail}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  const legacyTailorRunShell = shouldRenderLegacyTailorRunShell ? (
    <section
      aria-label="Tailoring run"
      className={`snapshot-card tailor-run-shell tailor-run-shell-${statusDisplayState} ${
        showCompactTailorRunSummary ? "tailor-run-shell-compact" : ""
      } ${
        showCompactTailorRunSummary ? "tailor-run-shell-complete" : ""
      } ${
        isTailorRunMenuOpen ? "tailor-run-shell-menu-open" : ""
      } ${
        isTailoringRunOnCurrentPage ? "tailor-run-shell-current-page" : ""
      } ${
        isTailorRunShellOverlayActive ? "tailor-run-shell-overlay-active" : ""
      }`.trim()}
    >
      <div
        aria-hidden={shouldObscureTailorRunBody ? "true" : undefined}
        className={`tailor-run-shell-body ${
          shouldObscureTailorRunBody
            ? "tailor-run-shell-body-obscured"
            : ""
        }`.trim()}
      >
        {showCompactTailorRunSummary ? (
          <>
            <div className="tailor-run-compact-row">
              <div className="tailor-run-compact-button">
                <span className="tailor-run-compact-title">
                  {displayedTailorRunIdentity?.label ?? "Tailoring run"}
                </span>
              </div>
              {shouldShowTailorRunTimestamp ? (
                <span className="tailor-run-detail-time">
                  {tailoredRunSavedAtLabel}
                </span>
              ) : null}
              {showArchiveTailorRunAction ? (
                <button
                  className="secondary-action compact-action"
                  disabled={tailorRunMenuActionState !== "idle"}
                  type="button"
                  onClick={() => void handleArchiveTailorRun()}
                >
                  {tailorRunMenuActionState === "archiving"
                    ? "Archiving..."
                    : "Archive"}
                </button>
              ) : null}
              {showTailorRunMenu ? (
                <div
                  className="tailor-run-menu-shell"
                  ref={tailorRunMenuRef}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    aria-expanded={isTailorRunMenuOpen}
                    aria-label="More tailor run actions"
                    className="secondary-action compact-action tailor-run-menu-trigger"
                    type="button"
                    onClick={() => {
                      setTailorRunMenuError(null);
                      setIsTailorRunMenuOpen((currentValue) => !currentValue);
                    }}
                  >
                    <EllipsisHorizontalIcon />
                  </button>
                  {isTailorRunMenuOpen ? (
                    <div className="tailor-run-menu-popover">
                      <div className="tailor-run-menu">
                        {showPreviewTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => {
                              openTailorRunDetailView("preview");
                              setIsTailorRunMenuOpen(false);
                            }}
                          >
                            {previewButtonLabel}
                          </button>
                        ) : null}
                        {showQuickReviewTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => {
                              openTailorRunDetailView("quickReview");
                              setIsTailorRunMenuOpen(false);
                            }}
                          >
                            {quickReviewButtonLabel}
                          </button>
                        ) : null}
                        {showDebugTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => {
                              openTailorRunDetailView("debug");
                              setIsTailorRunMenuOpen(false);
                            }}
                          >
                            {debugButtonLabel}
                          </button>
                        ) : null}
                        {displayedTailorRunUrl ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => void handleGoToTailorRunTab()}
                          >
                            {tailorRunMenuActionState === "goingToTab"
                              ? "Opening..."
                              : "Go to tab"}
                          </button>
                        ) : null}
                        {showRetryTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => void handleRetryTailorRun()}
                          >
                            {tailorRunMenuActionState === "retrying"
                              ? "Retrying..."
                              : "Retry"}
                          </button>
                        ) : null}
                        {showArchiveTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={tailorRunMenuActionState !== "idle"}
                            type="button"
                            onClick={() => void handleArchiveTailorRun()}
                          >
                            {tailorRunMenuActionState === "archiving"
                              ? "Archiving..."
                              : "Archive"}
                          </button>
                        ) : null}
                        {showDeleteTailorRunAction ? (
                          <button
                            className="tailor-run-menu-item"
                            disabled={
                              !canDeleteTailorRun ||
                              tailorRunMenuActionState !== "idle"
                            }
                            type="button"
                            onClick={() => void handleDeleteTailorRun()}
                          >
                            {tailorRunMenuActionState === "deleting"
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        ) : null}
                      </div>
                      {tailorRunMenuError ? (
                        <p className="tailor-run-menu-error">
                          {tailorRunMenuError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="tailor-run-meta">
              <div className="tailor-run-heading">
                {shouldShowTailorRunIdentity || showStopCurrentTailoringAction ? (
                  <p
                    className="tailor-run-url tailor-run-identity-structured"
                    title={displayedTailorRunIdentity?.title ?? undefined}
                  >
                    {displayedTailorRunIdentity?.label ?? "Tailoring run"}
                  </p>
                ) : null}
              </div>
              {shouldShowTailorRunMetaActions ? (
                <div className="tailor-run-meta-badges">
                  {showStopCurrentTailoringAction ? (
                    <button
                      className="secondary-action compact-action"
                      disabled={isStoppingCurrentTailoring}
                      type="button"
                      onClick={() => void stopCurrentTailoring()}
                    >
                      {isStoppingCurrentTailoring ? "Stopping..." : "Stop run"}
                    </button>
                  ) : null}
                  {showArchiveTailorRunAction ? (
                    <button
                      className="secondary-action compact-action"
                      disabled={tailorRunMenuActionState !== "idle"}
                      type="button"
                      onClick={() => void handleArchiveTailorRun()}
                    >
                      {tailorRunMenuActionState === "archiving"
                        ? "Archiving..."
                        : "Archive"}
                    </button>
                  ) : null}
                  {shouldShowTailorRunTimestamp ? (
                    <span className="tailor-run-detail-time">
                      {tailoredRunSavedAtLabel}
                    </span>
                  ) : null}
                  {showTailorRunMenu ? (
                    <div className="tailor-run-menu-shell" ref={tailorRunMenuRef}>
                      <button
                        aria-expanded={isTailorRunMenuOpen}
                        aria-label="More tailor run actions"
                        className="secondary-action compact-action tailor-run-menu-trigger"
                        type="button"
                        onClick={() => {
                          setTailorRunMenuError(null);
                          setIsTailorRunMenuOpen((currentValue) => !currentValue);
                        }}
                      >
                        <EllipsisHorizontalIcon />
                      </button>
                      {isTailorRunMenuOpen ? (
                        <div className="tailor-run-menu-popover">
                          <div className="tailor-run-menu">
                            {displayedTailorRunUrl ? (
                              <button
                                className="tailor-run-menu-item"
                                disabled={tailorRunMenuActionState !== "idle"}
                                type="button"
                                onClick={() => void handleGoToTailorRunTab()}
                              >
                                {tailorRunMenuActionState === "goingToTab"
                                  ? "Opening..."
                                  : "Go to tab"}
                              </button>
                            ) : null}
                            {showRetryTailorRunAction ? (
                              <button
                                className="tailor-run-menu-item"
                                disabled={tailorRunMenuActionState !== "idle"}
                                type="button"
                                onClick={() => void handleRetryTailorRun()}
                              >
                                {tailorRunMenuActionState === "retrying"
                                  ? "Retrying..."
                                  : "Retry"}
                              </button>
                            ) : null}
                            {showArchiveTailorRunAction ? (
                              <button
                                className="tailor-run-menu-item"
                                disabled={tailorRunMenuActionState !== "idle"}
                                type="button"
                                onClick={() => void handleArchiveTailorRun()}
                              >
                                {tailorRunMenuActionState === "archiving"
                                  ? "Archiving..."
                                  : "Archive"}
                              </button>
                            ) : null}
                            {showDeleteTailorRunAction ? (
                              <button
                                className="tailor-run-menu-item"
                                disabled={
                                  !canDeleteTailorRun ||
                                  tailorRunMenuActionState !== "idle"
                                }
                                type="button"
                                onClick={() => void handleDeleteTailorRun()}
                              >
                                {tailorRunMenuActionState === "deleting"
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            ) : null}
                          </div>
                          {tailorRunMenuError ? (
                            <p className="tailor-run-menu-error">
                              {tailorRunMenuError}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {shouldShowTailorRunFocusedStep && compactTailorRunStep ? (
              <div className="tailor-progress-focus">
                <div
                  aria-current={
                    compactTailorRunStep.status === "current" ||
                    compactTailorRunStep.status === "retrying"
                      ? "step"
                      : undefined
                  }
                  className={`tailor-progress-step tailor-progress-step-${compactTailorRunStep.status} tailor-progress-step-focus ${
                    legacyTailorRunElapsedTimeLabel
                      ? "tailor-progress-step-with-elapsed"
                      : ""
                  }`.trim()}
                  title={`Step ${compactTailorRunStep.stepNumber}: ${compactTailorRunStep.label} (${formatTailorResumeProgressStatusLabel({
                    attempt: compactTailorRunStep.attempt,
                    status: compactTailorRunStep.status,
                  })})`}
                >
                  <span className="tailor-progress-step-topline">
                    <span className="tailor-progress-step-number">
                      Step {compactTailorRunStep.stepNumber}
                    </span>
                    {compactTailorRunAttemptBadgeLabel ? (
                      <span className="tailor-progress-step-attempt-badge">
                        {compactTailorRunAttemptBadgeLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="tailor-progress-step-label">
                    {compactTailorRunStepLabel}
                  </span>
                  {legacyTailorRunElapsedTimeLabel ? (
                    <span
                      aria-label={
                        tailorRunTimeDisplayMode === "specific"
                          ? `Step timings ${legacyTailorRunElapsedTimeLabel}`
                          : `Loading for ${legacyTailorRunElapsedTimeLabel}`
                      }
                      className="tailor-progress-step-elapsed"
                      title={
                        tailorRunTimeDisplayMode === "specific"
                          ? `Step timings: ${legacyTailorRunElapsedTimeLabel}`
                          : `Loading for ${legacyTailorRunElapsedTimeLabel}`
                      }
                    >
                      {legacyTailorRunElapsedTimeLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {shouldShowTailorRunCopy ? (
              <div className="tailor-progress-copy">
                <p className="tailor-progress-message">{tailorRunMessage}</p>
                {shouldShowTailorRunDetail ? (
                  <p className="tailor-progress-detail">{tailorRunDetail}</p>
                ) : null}
              </div>
            ) : null}

            {tailorInterview ? (
              <div className="tailor-run-interview-callout">
                <div className="tailor-run-interview-copy">
                  <p className="tailor-run-interview-title">
                    {isTailorInterviewAwaitingCompletion
                      ? "Follow-up chat ready"
                      : "Question ready to answer"}
                  </p>
                  <p className="tailor-run-interview-preview">
                    {tailorInterviewPreview ??
                      (isTailorInterviewAwaitingCompletion
                        ? "The assistant has enough context to finish, but you can still add one more clarification before wrapping up."
                        : "Open the follow-up chat to answer the current question.")}
                  </p>
                </div>
                <button
                  className="secondary-action compact-action tailor-run-interview-action"
                  disabled={isTailorInterviewBusy}
                  type="button"
                  onClick={() =>
                    revealTailorInterview({ focusComposer: true })
                  }
                >
                  Open chat
                </button>
              </div>
            ) : null}

            {showTailoredPreview && !showCompactTailorRunSummary ? (
              <div className="tailor-run-detail-shell">
                <div className="tailor-run-detail-nav-row">
                  <div
                    aria-label="Tailored resume actions"
                    className={`tailor-run-detail-actions-group ${
                      showDebugTailorRunAction
                        ? "tailor-run-detail-actions-group-three-up"
                        : "tailor-run-detail-actions-group-two-up"
                    }`.trim()}
                    role="group"
                  >
                    <button
                      className="tailor-run-detail-toggle tailor-run-detail-action"
                      type="button"
                      onClick={() => openTailorRunDetailView("preview")}
                    >
                      {previewButtonLabel}
                    </button>
                    <button
                      className="tailor-run-detail-toggle tailor-run-detail-action"
                      type="button"
                      onClick={() => openTailorRunDetailView("quickReview")}
                    >
                      {quickReviewButtonLabel}
                    </button>
                    {showDebugTailorRunAction ? (
                      <button
                        className="tailor-run-detail-toggle tailor-run-detail-action"
                        type="button"
                        onClick={() => openTailorRunDetailView("debug")}
                      >
                        {debugButtonLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {isTailorPreparationPending && !existingTailoringPrompt ? (
        <div className="tailor-run-preparing-overlay" role="presentation">
          <section
            aria-label={tailorPreparationMessage}
            className="tailor-run-preparing-dialog"
            role="status"
          >
            <div
              aria-hidden="true"
              className="tailor-run-preparing-spinner"
            />
          </section>
        </div>
      ) : null}

      {existingTailoringPrompt ? (
        <div className="existing-tailoring-inline-overlay" role="presentation">
          <section className="existing-tailoring-inline-dialog">
            <p className="existing-tailoring-inline-title">Overwrite?</p>
            <div className="existing-tailoring-inline-actions">
              <button
                className="secondary-action compact-action"
                disabled={existingTailoringPrompt.actionState !== "idle"}
                type="button"
                onClick={() => void dismissExistingTailoringPrompt()}
              >
                Cancel
              </button>
              <button
                className="primary-action compact-action"
                disabled={existingTailoringPrompt.actionState !== "idle"}
                type="button"
                onClick={() => void overwriteExistingTailoring()}
              >
                {existingTailoringPrompt.actionState === "overwriting"
                  ? "Overwriting..."
                  : "Yes"}
              </button>
            </div>
            {tailorInterviewError ? (
              <p className="interview-error existing-tailoring-inline-error">
                {tailorInterviewError}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  ) : null;

  function tailoredResumeMatchesCurrentPage(tailoredResume: {
    jobUrl: string | null;
  }) {
    if (!currentPageIdentity) {
      return false;
    }

    return matchesTailorOverwritePageIdentity({
      jobUrl: tailoredResume.jobUrl,
      pageIdentity: currentPageIdentity,
    });
  }

  function renderTailoredResumeArchiveControls() {
    return (
      <div className="tailored-resume-archive-controls">
        <div
          aria-label="Resume archive filter"
          className="tailored-resume-filter-toggle"
          role="group"
        >
          <button
            aria-pressed={!isShowingArchivedTailoredResumes}
            className={`tailored-resume-filter-option ${
              !isShowingArchivedTailoredResumes
                ? "tailored-resume-filter-option-active"
                : ""
            }`.trim()}
            type="button"
            onClick={() => setTailoredResumeArchiveFilter("unarchived")}
          >
            Unarchived
          </button>
          <button
            aria-pressed={isShowingArchivedTailoredResumes}
            className={`tailored-resume-filter-option ${
              isShowingArchivedTailoredResumes
                ? "tailored-resume-filter-option-active"
                : ""
            }`.trim()}
            type="button"
            onClick={() => setTailoredResumeArchiveFilter("archived")}
          >
            Archived
          </button>
        </div>
        <label className="tailored-resume-archive-search">
          <span className="sr-only">
            Search tailored resumes by scraped company or title
          </span>
          <SearchIcon />
          <input
            aria-label="Search tailored resumes by company or title"
            placeholder="Search company or title"
            type="search"
            value={tailoredResumeSearchQuery}
            onChange={(event) =>
              setTailoredResumeSearchQuery(event.target.value)
            }
          />
          {isTailoredResumeSearchActive ? (
            <button
              aria-label="Clear tailored resume search"
              className="tailored-resume-archive-search-clear"
              type="button"
              onClick={() => setTailoredResumeSearchQuery("")}
            >
              <CloseIcon />
            </button>
          ) : null}
        </label>
        {!isShowingArchivedTailoredResumes ? (
          <>
            <div className="tailored-resume-retry-all-shell">
              <div
                aria-label="Retry tailoring runs"
                className="tailored-resume-retry-all-options"
                role="group"
              >
                <button
                  className="secondary-action compact-action"
                  disabled={!canRetryInFlightTailorRuns}
                  title={
                    retryableTailorRunCards.length > 0
                      ? "Retry in-flight tailoring runs"
                      : "No in-flight tailoring runs to retry"
                  }
                  type="button"
                  onClick={() => void retryTailorRunBatch("inFlight")}
                >
                  {retryingTailorRunBatchScope === "inFlight"
                    ? "Retrying..."
                    : "Retry in-flight"}
                </button>
                <button
                  className="secondary-action compact-action"
                  disabled={!canRetryAllTailorRuns}
                  title={
                    canRetryAllTailorRuns
                      ? "Retry every unarchived tailoring run"
                      : "No unarchived tailoring runs to retry"
                  }
                  type="button"
                  onClick={() => void retryTailorRunBatch("all")}
                >
                  {retryingTailorRunBatchScope === "all" ? "Retrying..." : "Retry all"}
                </button>
              </div>
            </div>
            <button
              className="secondary-action compact-action tailored-resume-archive-all-action"
              disabled={!canArchiveAllTailoredResumes}
              title="Archive every unarchived saved resume"
              type="button"
              onClick={() => void archiveAllTailoredResumes()}
            >
              {isArchivingAllTailoredResumes ? "Archiving..." : "Archive all"}
            </button>
            <button
              className="danger-action compact-action tailored-resume-delete-all-action"
              disabled={!canDeleteAllTailoredResumes}
              title="Delete every unarchived saved resume"
              type="button"
              onClick={() => setIsDeleteAllTailoredResumesPromptOpen(true)}
            >
              {isDeletingAllTailoredResumes ? "Deleting..." : "Delete all"}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  function renderCurrentPageArchivedTailoredResumeSuggestion() {
    if (!currentPageArchivedTailoredResume || isShowingArchivedTailoredResumes) {
      return null;
    }

    const isActionPending = tailoredResumeArchiveActionIds.has(
      currentPageArchivedTailoredResume.id,
    );
    const displayName =
      currentPageArchivedTailoredResume.displayName.trim().toLowerCase() ===
      "tailored resume"
        ? buildTailoredResumeDownloadFilename(
            currentPageArchivedTailoredResume,
            personalInfo?.generationSettings,
          )
        : currentPageArchivedTailoredResume.displayName;
    const restoreDisabled =
      authActionState === "running" ||
      isDeletingPersonalItem ||
      isArchivingAllTailoredResumes ||
      isDeletingAllTailoredResumes ||
      isActionPending;

    return (
      <div className="current-page-archived-resume-suggestion">
        <div className="current-page-archived-resume-copy">
          <p className="current-page-archived-resume-title">
            Archived resume for this job
          </p>
          <p className="current-page-archived-resume-detail">
            {displayName} is archived. Restore it to bring it back into your
            active tailored resumes.
          </p>
        </div>
        <div className="current-page-archived-resume-actions">
          <button
            className="secondary-action compact-action"
            disabled={authActionState === "running"}
            type="button"
            onClick={() =>
              openTailoredResumeDetailView(
                currentPageArchivedTailoredResume.id,
                "quickReview",
              )
            }
          >
            View
          </button>
          <button
            className="primary-action compact-action"
            disabled={restoreDisabled}
            type="button"
            onClick={() =>
              void setTailoredResumeArchivedState({
                archived: false,
                tailoredResumeId: currentPageArchivedTailoredResume.id,
              })
            }
          >
            {isActionPending ? "Restoring..." : "Restore"}
          </button>
        </div>
      </div>
    );
  }

  function renderSelectedTailoredResumeLibrarySurface() {
    if (isShowingArchivedTailoredResumes) {
      return shouldRenderArchivedResumeEmptySurface ? (
        <DocumentEmptySurface
          count={archivedTailoredResumes.length}
          message="No archived tailored resumes yet."
          title="Archived resumes"
        />
      ) : (
        <section
          aria-label="Archived tailored resumes"
          className="tailor-resume-library-surface"
        >
          <div className="tailored-resume-card-stack">
            {renderTailoredResumeLibrary({
              actionLabel: "restore",
              emptyMessage:
                isTailoredResumeSearchActive
                  ? "No archived resumes match that search."
                  : "No archived tailored resumes yet.",
              flush: true,
              resumes: displayedArchivedTailoredResumes,
              title: "Archived tailored resume",
            })}
          </div>
        </section>
      );
    }

    return shouldRenderUnarchivedResumeEmptySurface ? (
      <DocumentEmptySurface
        count={unarchivedTailorDisplayCount}
        message="No active or completed tailored resumes yet."
        title="Tailor Resume"
      />
    ) : (
      <section
        aria-label="Active and completed tailored resumes"
        className="tailor-resume-library-surface"
      >
        <div className="tailored-resume-card-stack">
          {renderCurrentPageArchivedTailoredResumeSuggestion()}
          {renderPageCaptureFailureNotice()}
          {legacyTailorRunShell}
          {displayedActiveTailorRunCards.length > 0 ? (
            <section
              aria-label="Active tailoring runs"
              className="active-tailor-run-stack"
            >
              {displayedActiveTailorRunCards.map((card) =>
                renderActiveTailorRunCard(card),
              )}
            </section>
          ) : null}

          {shouldRenderUnarchivedResumeLibrary
            ? renderTailoredResumeLibrary({
                actionLabel: "archive",
                emptyMessage: isTailoredResumeSearchActive
                  ? "No unarchived resumes match that search."
                  : "No active or completed tailored resumes yet.",
                flush: true,
                highlightCurrentPage: true,
                resumes: displayedUnarchivedTailoredResumes,
                title: "Saved tailored resume",
              })
            : null}
        </div>
      </section>
    );
  }

  function renderTailoredResumeLibrary(input: {
    actionLabel: "archive" | "restore";
    emptyMessage: string;
    flush?: boolean;
    resumes: TailoredResumeSummary[];
    title: string;
    highlightCurrentPage?: boolean;
  }) {
    if (authState.status !== "signedIn") {
      return (
        <p
          className={`placeholder ${
            input.flush ? "tailored-resume-placeholder-flush" : ""
          }`.trim()}
        >
          Connect Google to load saved resumes.
        </p>
      );
    }

    if (personalInfoState.status === "loading") {
      return (
        <p
          className={`placeholder ${
            input.flush ? "tailored-resume-placeholder-flush" : ""
          }`.trim()}
        >
          Loading tailored resumes...
        </p>
      );
    }

    if (personalInfoState.status === "error") {
      return (
        <p
          className={`placeholder ${
            input.flush ? "tailored-resume-placeholder-flush" : ""
          }`.trim()}
        >
          {personalInfoState.error}
        </p>
      );
    }

    if (input.resumes.length === 0) {
      return <DocumentEmptyState message={input.emptyMessage} />;
    }

    return (
      <>
        {tailoredResumeMutationError ? (
          <p className="preview-error tailored-resume-action-error">
            {tailoredResumeMutationError}
          </p>
        ) : null}
        <div
          className={`tailored-resume-list ${
            input.flush ? "tailored-resume-list-flush" : ""
          }`.trim()}
        >
          {input.resumes.map((tailoredResume) => {
            const isCurrentPageMatch =
              input.highlightCurrentPage === true &&
              tailoredResumeMatchesCurrentPage(tailoredResume);
            const isActionPending =
              tailoredResumeArchiveActionIds.has(tailoredResume.id);
            const isMenuOpen = tailoredResumeMenuId === tailoredResume.id;
            const isMenuBusy =
              tailoredResumeMenuActionState !== "idle" &&
              tailoredResumeMenuActionResumeId === tailoredResume.id;
            const menuActionState = isMenuBusy
              ? tailoredResumeMenuActionState
              : "idle";
            const menuError =
              tailoredResumeMenuErrorResumeId === tailoredResume.id
                ? tailoredResumeMenuError
                : null;
            const canGoToTab = Boolean(tailoredResume.jobUrl?.trim());
            const archiveActionLabel =
              input.actionLabel === "archive" ? "Archive" : "Restore";
            const archiveActionPendingLabel =
              input.actionLabel === "archive" ? "Archiving..." : "Restoring...";
            const isMenuTriggerDisabled =
              authActionState === "running" ||
              isDeletingPersonalItem ||
              isArchivingAllTailoredResumes ||
              isDeletingAllTailoredResumes ||
              isActionPending;
            const keywordBadgeDismissalKey = deriveKeywordBadgeDismissalKey({
              jobUrl: tailoredResume.jobUrl ?? null,
              tailoredResumeId: tailoredResume.id,
            });
            const isKeywordBadgeDismissed = keywordBadgeDismissalKey
              ? dismissedKeywordBadgeKeys.has(keywordBadgeDismissalKey)
              : false;
            const canShowKeywordBadge =
              tailoredResume.emphasizedTechnologies.length > 0 ||
              Boolean(tailoredResume.keywordCoverage) ||
              isKeywordBadgeDismissed;
            const displayName =
              tailoredResume.displayName.trim().toLowerCase() ===
              "tailored resume"
                ? buildTailoredResumeDownloadFilename(
                    tailoredResume,
                    personalInfo?.generationSettings,
                  )
                : tailoredResume.displayName;

            return (
              <div
                key={tailoredResume.id}
                ref={
                  isCurrentPageMatch ? currentPageTailoredResumeRowRef : undefined
                }
                className={`tailored-resume-row-shell ${
                  isCurrentPageMatch
                    ? "tailored-resume-row-shell-current-page"
                    : ""
                }`.trim()}
              >
                <button
                  className={`tailored-resume-row ${
                    isCurrentPageMatch ? "tailored-resume-row-current-page" : ""
                  }`.trim()}
                  type="button"
                  onClick={() =>
                    openTailoredResumeDetailView(
                      tailoredResume.id,
                      "quickReview",
                    )
                  }
                >
                  <span className="tailored-resume-main">
                    <span className="tailored-resume-title">
                      {displayName}
                    </span>
                    <span className="tailored-resume-meta">
                      {tailoredResume.companyName ||
                        tailoredResume.positionTitle ||
                        input.title}
                    </span>
                  </span>
                  <span className="tailored-resume-date">
                    {formatTailoredResumeDate(tailoredResume.updatedAt)}
                  </span>
                </button>

                <div className="tailored-resume-row-actions">
                  <div
                    className="tailor-run-menu-shell tailored-resume-row-menu-shell"
                    ref={isMenuOpen ? tailoredResumeMenuRef : undefined}
                  >
                    <button
                      aria-expanded={isMenuOpen}
                      aria-label={`Actions for ${displayName}`}
                      className="secondary-action compact-action tailor-run-menu-trigger"
                      disabled={isMenuTriggerDisabled}
                      type="button"
                      onClick={() => {
                        const shouldOpen = tailoredResumeMenuId !== tailoredResume.id;

                        setTailoredResumeMenuId(
                          shouldOpen ? tailoredResume.id : null,
                        );
                        setTailoredResumeMenuError(null);
                        setTailoredResumeMenuErrorResumeId(null);
                        setTailoredResumeMenuPosition(null);

                        if (shouldOpen) {
                          window.requestAnimationFrame(() => {
                            updateTailoredResumeMenuPosition();
                          });
                        }
                      }}
                    >
                      <EllipsisHorizontalIcon />
                    </button>
                    {isMenuOpen && tailoredResumeMenuPosition
                      ? createPortal(
                          <div
                            className="tailor-run-menu-popover tailored-resume-row-menu-popover-floating"
                            ref={tailoredResumeMenuPopoverRef}
                            style={{
                              left: `${tailoredResumeMenuPosition.left}px`,
                              top: `${tailoredResumeMenuPosition.top}px`,
                            }}
                          >
                            <div className="tailor-run-menu">
                              <button
                                className="tailor-run-menu-item"
                                disabled={isMenuBusy}
                                type="button"
                                onClick={() =>
                                  void handleDownloadTailoredResumeFromMenu(
                                    tailoredResume,
                                  )
                                }
                              >
                                {menuActionState === "downloading"
                                  ? "Downloading..."
                                  : "Download"}
                              </button>
                              <button
                                className="tailor-run-menu-item"
                                disabled={isMenuBusy}
                                type="button"
                                onClick={() =>
                                  void handleOpenTailoredResumeInWebAppFromMenu(
                                    tailoredResume,
                                  )
                                }
                              >
                                {menuActionState === "openingWeb"
                                  ? "Opening..."
                                  : "See in web app"}
                              </button>
                              {canShowKeywordBadge ? (
                                <button
                                  className="tailor-run-menu-item"
                                  disabled={isMenuBusy}
                                  type="button"
                                  onClick={() =>
                                    void handleRevealKeywordBadge(tailoredResume)
                                  }
                                >
                                  Show keywords
                                </button>
                              ) : null}
                              {canGoToTab ? (
                                <button
                                  className="tailor-run-menu-item"
                                  disabled={isMenuBusy}
                                  type="button"
                                  onClick={() =>
                                    void handleGoToTailoredResumeTab(tailoredResume)
                                  }
                                >
                                  {menuActionState === "goingToTab"
                                    ? "Opening..."
                                    : "Go to tab"}
                                </button>
                              ) : null}
                              {canGoToTab ? (
                                <button
                                  className="tailor-run-menu-item"
                                  disabled={isMenuBusy || isActionPending}
                                  type="button"
                                  onClick={() =>
                                    void handleRetryTailoredResumeFromMenu(
                                      tailoredResume,
                                    )
                                  }
                                >
                                  {menuActionState === "retrying"
                                    ? "Retrying..."
                                    : "Retry"}
                                </button>
                              ) : null}
                              <button
                                className="tailor-run-menu-item"
                                disabled={isMenuBusy || isActionPending}
                                type="button"
                                onClick={() =>
                                  void handleArchiveTailoredResumeFromMenu({
                                    archived: input.actionLabel === "archive",
                                    tailoredResumeId: tailoredResume.id,
                                  })
                                }
                              >
                                {isActionPending
                                  ? archiveActionPendingLabel
                                  : archiveActionLabel}
                              </button>
                              <button
                                className="tailor-run-menu-item"
                                disabled={isMenuBusy || isActionPending}
                                type="button"
                                onClick={() =>
                                  handleDeleteTailoredResumeFromMenu(tailoredResume.id)
                                }
                              >
                                Delete
                              </button>
                            </div>
                            {menuError ? (
                              <p className="tailor-run-menu-error">{menuError}</p>
                            ) : null}
                          </div>,
                          document.body,
                        )
                      : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderApplicationsSurface() {
    if (authState.status !== "signedIn") {
      return <p className="placeholder">Connect Google to load applications.</p>;
    }

    if (personalInfoState.status === "loading") {
      return <p className="placeholder">Loading tracked applications...</p>;
    }

    if (personalInfoState.status === "error") {
      return <p className="placeholder">{personalInfoState.error}</p>;
    }

    if (!personalInfo || personalInfo.applications.length === 0) {
      return <DocumentEmptyState message="No tracked applications yet." />;
    }

    return (
      <>
        <div className="application-list">
          {displayedApplications.map((application) => {
            const isDeleteDisabled =
              authActionState === "running" || isDeletingPersonalItem;
            const applicationDisplay = buildJobApplicationDisplayParts({
              companyName: application.companyName,
              jobTitle: application.jobTitle,
            });

            return (
              <div
                key={application.id}
                className="application-row-shell"
              >
                <button
                  className="application-row"
                  disabled={authActionState === "running"}
                  type="button"
                  onClick={() => void handleOpenTrackedApplication(application)}
                >
                  <span className="application-main">
                    <span className="application-title">
                      {applicationDisplay.companyName}
                    </span>
                    <span className="application-meta">
                      {applicationDisplay.positionName}
                    </span>
                  </span>
                  <span className="application-side">
                    <span className="application-status">
                      {formatApplicationStatus(application.status)}
                    </span>
                    <span className="tailored-resume-date">
                      {formatTailoredResumeDate(application.appliedAt)}
                    </span>
                  </span>
                </button>
                <button
                  aria-label={`Delete ${application.jobTitle} at ${application.companyName}`}
                  className="icon-action personal-row-delete-action"
                  disabled={isDeleteDisabled}
                  title="Delete application"
                  type="button"
                  onClick={() => {
                    setPendingPersonalDelete({
                      applicationId: application.id,
                      kind: "application",
                    });
                    setPersonalDeleteError(null);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
        {personalInfo.applicationCount > displayedApplications.length ? (
          <button
            className="link-action more-action"
            disabled={dashboardOpenActionState === "running"}
            type="button"
            onClick={handleOpenApplicationsDashboard}
          >
            View all applications
          </button>
        ) : null}
      </>
    );
  }

  function syncTailoredResumeReviewFromPayload(payload: unknown) {
    const reviewRecord = resolveTailoredResumeReviewFromPayload(payload);

    if (!reviewRecord) {
      return null;
    }

    setTailoredResumeReviewState({
      record: reviewRecord,
      status: "ready",
    });
    setPendingTailoredResumeReviewEditId(null);

    return reviewRecord;
  }

  const evictMissingTailoredResumeLocally = useCallback(
    async (tailoredResumeId: string) => {
      if (!tailoredResumeId) {
        return;
      }

      const matchingTailoredResume =
        personalInfo?.tailoredResumes.find(
          (tailoredResume) => tailoredResume.id === tailoredResumeId,
        ) ?? null;
      void requestHideTailoredResumeBadgesForUrls([
        matchingTailoredResume?.jobUrl,
      ]);
      let nextPersonalInfo: PersonalInfoSummary | null = null;

      setPersonalInfoState((currentState) =>
        currentState.status === "ready"
          ? {
              personalInfo: (nextPersonalInfo = removeTailorRunArtifactsFromPersonalInfo(
                {
                  jobUrl: matchingTailoredResume?.jobUrl ?? "",
                  personalInfo: currentState.personalInfo,
                  tailoredResumeId,
                  tailorRunId: "",
                },
              )),
              status: "ready",
            }
          : currentState,
      );

      if (nextPersonalInfo) {
        lastReadyPersonalInfoRef.current = nextPersonalInfo;
        publishPersonalInfoToSharedCache(nextPersonalInfo);
      }

      if (selectedTailoredResumeId === tailoredResumeId) {
        setSelectedTailoredResumeId(null);
        setActiveTailorRunDetailView(null);
        setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      }

      if (tailoredResumeMenuId === tailoredResumeId) {
        setTailoredResumeMenuId(null);
        setTailoredResumeMenuPosition(null);
      }

      if (tailoredResumeMenuErrorResumeId === tailoredResumeId) {
        setTailoredResumeMenuError(null);
        setTailoredResumeMenuErrorResumeId(null);
      }

      setTailoredResumeMutationError(null);
      setPendingPersonalDelete((currentDelete) =>
        currentDelete?.kind === "tailoredResume" &&
        currentDelete.tailoredResumeId === tailoredResumeId
          ? null
          : currentDelete,
      );
      setPersonalDeleteError(null);
      setPendingTailoredResumeReviewEditId((currentId) =>
        currentId === tailoredResumeId ? null : currentId,
      );
      setTailoredResumeReviewState((currentState) =>
        currentState.record?.id === tailoredResumeId
          ? { record: null, status: "idle" }
          : currentState,
      );

      if (lastTailoringRun?.tailoredResumeId === tailoredResumeId) {
        const pageKey = buildTailorRunRegistryKey(lastTailoringRun.pageUrl);

        setTailorGenerationStep(null);
        setTailorGenerationStepTimings([]);
        setLastTailoringRun(null);
        setCaptureState((currentCaptureState) =>
          currentCaptureState === "blocked" ? "blocked" : "idle",
        );

        try {
          await persistTailoringRun(null, pageKey);
        } catch (error) {
          console.error(
            "Could not clear a missing tailored resume run from local storage.",
            error,
          );
        }
      }
    },
    [
      lastTailoringRun,
      personalInfo,
      persistTailoringRun,
      publishPersonalInfoToSharedCache,
      selectedTailoredResumeId,
      tailoredResumeMenuErrorResumeId,
      tailoredResumeMenuId,
    ],
  );

  function syncTailoredResumeSummariesFromPayload(payload: unknown) {
    if (!payloadIncludesTailoredResumeSummaries(payload)) {
      return;
    }

    const tailoredResumes = readTailoredResumeSummaries(payload);

    let nextPersonalInfo: PersonalInfoSummary | null = null;
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: (nextPersonalInfo = {
              ...currentState.personalInfo,
              tailoredResumes,
            }),
            status: "ready",
          }
        : currentState,
    );

    publishPersonalInfoToSharedCache(nextPersonalInfo);
  }

  async function setTailoredResumeArchivedState(input: {
    archived: boolean;
    tailoredResumeId: string;
  }) {
    const tailoredResumeId = input.tailoredResumeId.trim();

    if (
      authState.status !== "signedIn" ||
      !tailoredResumeId ||
      tailoredResumeArchiveActionIds.has(tailoredResumeId) ||
      isArchivingAllTailoredResumes ||
      isDeletingAllTailoredResumes
    ) {
      return {
        error: input.archived
          ? "Unable to archive the tailored resume."
          : "Unable to restore the tailored resume.",
        ok: false as const,
      };
    }

    setTailoredResumeArchiveActionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(tailoredResumeId);
      return nextIds;
    });
    setTailoredResumeMutationError(null);
    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const optimisticPersonalInfo = previousPersonalInfo
      ? setTailoredResumeArchiveStateInPersonalInfo({
          archived: input.archived,
          personalInfo: previousPersonalInfo,
          tailoredResumeId,
          updatedAt: new Date().toISOString(),
        })
      : null;

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    try {
      const result = await patchTailorResume({
        action: "setTailoredResumeArchivedState",
        archived: input.archived,
        tailoredResumeId,
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            input.archived
              ? "Unable to archive the tailored resume."
              : "Unable to restore the tailored resume.",
          ),
        );
      }

      syncTailoredResumeSummariesFromPayload(result.payload);
      await loadPersonalInfo({ preserveCurrent: true });

      return {
        ok: true as const,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : input.archived
            ? "Unable to archive the tailored resume."
            : "Unable to restore the tailored resume.";

      if (isMissingTailoredResumeErrorMessage(message)) {
        await evictMissingTailoredResumeLocally(tailoredResumeId);
        await loadPersonalInfo({ preserveCurrent: true });

        return {
          ok: true as const,
        };
      }

      setTailoredResumeMutationError(message);
      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      return {
        error: message,
        ok: false as const,
      };
    } finally {
      setTailoredResumeArchiveActionIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(tailoredResumeId);
        return nextIds;
      });
    }
  }

  async function archiveAllTailoredResumes() {
    if (
      authState.status !== "signedIn" ||
      isArchivingAllTailoredResumes ||
      hasTailoredResumeArchiveAction
    ) {
      return;
    }

    const tailoredResumeIds = unarchivedTailoredResumes
      .map((tailoredResume) => tailoredResume.id.trim())
      .filter(Boolean);

    if (tailoredResumeIds.length === 0) {
      return;
    }

    setIsArchivingAllTailoredResumes(true);
    setTailoredResumeMutationError(null);
    setTailoredResumeArchiveActionIds(new Set(tailoredResumeIds));

    const previousArchiveFilter = tailoredResumeArchiveFilter;
    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const optimisticPersonalInfo = previousPersonalInfo
      ? setTailoredResumesArchiveStateInPersonalInfo({
          archived: true,
          personalInfo: previousPersonalInfo,
          tailoredResumeIds,
          updatedAt: new Date().toISOString(),
        })
      : null;

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    setTailoredResumeArchiveFilter("archived");

    try {
      const result = await patchTailorResume({
        action: "archiveAllTailoredResumes",
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to archive all tailored resumes.",
          ),
        );
      }

      syncTailoredResumeSummariesFromPayload(result.payload);
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      setTailoredResumeMutationError(
        error instanceof Error
          ? error.message
          : "Unable to archive all tailored resumes.",
      );

      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }

      setTailoredResumeArchiveFilter(previousArchiveFilter);
    } finally {
      setIsArchivingAllTailoredResumes(false);
      setTailoredResumeArchiveActionIds(new Set());
    }
  }

  async function deleteAllTailoredResumes() {
    if (
      authState.status !== "signedIn" ||
      isDeletingAllTailoredResumes ||
      isArchivingAllTailoredResumes ||
      hasTailoredResumeArchiveAction
    ) {
      return;
    }

    const tailoredResumeIds = unarchivedTailoredResumes
      .map((tailoredResume) => tailoredResume.id.trim())
      .filter(Boolean);
    const activeRunCardsToCancel = activeTailorRunCards.filter(
      (card) => card.statusDisplayState !== "error",
    );
    const activeRunIdsToDelete = uniqueNonEmptyStrings(
      activeTailorRunCards.flatMap((card) => [
        card.existingTailoringId,
        card.deleteTarget?.tailorRunId,
      ]),
    );
    const activeRunUrlsToDelete = uniqueNonEmptyStrings(
      activeTailorRunCards.flatMap((card) => [
        card.url,
        card.deleteTarget?.jobUrl,
        card.pageKey,
      ]),
    );

    if (tailoredResumeIds.length === 0 && activeTailorRunCards.length === 0) {
      setIsDeleteAllTailoredResumesPromptOpen(false);
      return;
    }

    setIsDeletingAllTailoredResumes(true);
    setTailoredResumeMutationError(null);
    setTailoredResumeArchiveActionIds(new Set(tailoredResumeIds));

    const previousPersonalInfo = personalInfo ?? lastReadyPersonalInfoRef.current;
    const optimisticPersonalInfo = previousPersonalInfo
      ? {
          ...removeTailoredResumesFromPersonalInfo({
            personalInfo: previousPersonalInfo,
            tailoredResumeIds,
          }),
          activeTailoring: null,
          activeTailorings: [],
          tailoringInterviews: [],
        }
      : null;

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
      publishPersonalInfoToSharedCache(optimisticPersonalInfo);
    }

    void requestHideTailoredResumeBadgesForUrls(
      [
        ...unarchivedTailoredResumes.map((tailoredResume) => tailoredResume.jobUrl),
        ...activeRunUrlsToDelete,
      ],
    );

    try {
      if (activeRunCardsToCancel.length > 0) {
        activeTailorRequestAbortControllerRef.current?.abort();
        activeTailorRequestAbortControllerRef.current = null;
        setIsStoppingCurrentTailoring(true);

        const cancelResponse = await chrome.runtime.sendMessage({
          payload: {},
          type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
        });
        assertRuntimeResponseOk(
          cancelResponse,
          "Unable to stop the current tailoring runs before deleting them.",
        );

        await Promise.all(
          activeTailorRunCards.map((card) =>
            clearTailorRegistryEntriesForMatch({
              jobUrl: card.url,
              pageKey: card.pageKey,
            }),
          ),
        );
      }

      const result = await patchTailorResume({
        action: "deleteAllTailoredResumeArtifacts",
        jobUrls: activeRunUrlsToDelete,
        runIds: activeRunIdsToDelete,
        tailoredResumeIds,
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to delete all tailored resumes.",
          ),
        );
      }

      syncTailoredResumeSummariesFromPayload(result.payload);
      setSelectedTailoredResumeId((currentId) =>
        currentId && tailoredResumeIds.includes(currentId) ? null : currentId,
      );
      setActiveTailorRunDetailView(null);
      setIsDeleteAllTailoredResumesPromptOpen(false);
      void loadPersonalInfo({ preserveCurrent: true });
    } catch (error) {
      setTailoredResumeMutationError(
        error instanceof Error
          ? error.message
          : "Unable to delete all tailored resumes.",
      );

      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
        publishPersonalInfoToSharedCache(previousPersonalInfo);
      }
    } finally {
      setIsDeletingAllTailoredResumes(false);
      setIsStoppingCurrentTailoring(false);
      setTailoredResumeArchiveActionIds(new Set());
    }
  }

  async function setTailoredResumeReviewEditState(
    editId: string,
    nextState: TailoredResumeReviewEdit["state"],
  ) {
    if (
      authState.status !== "signedIn" ||
      !activeTailoredResumeReviewRecord ||
      pendingTailoredResumeReviewEditId
    ) {
      return;
    }

    const currentEdit = activeTailoredResumeReviewRecord.edits.find(
      (edit) => edit.editId === editId,
    );

    if (
      !currentEdit ||
      currentEdit.customLatexCode !== null ||
      currentEdit.state === nextState
    ) {
      return;
    }

    const previousRecord = activeTailoredResumeReviewRecord;
    const optimisticRecord: TailoredResumeReviewRecord = {
      ...previousRecord,
      edits: previousRecord.edits.map((edit) =>
        edit.editId === editId
          ? {
              ...edit,
              customLatexCode: null,
              state: nextState,
            }
          : edit,
      ),
    };

    setPendingTailoredResumeReviewEditId(editId);
    setTailoredResumeReviewState({
      record: optimisticRecord,
      status: "ready",
    });

    try {
      const result = await patchTailorResume({
        action: "setTailoredResumeEditState",
        editId,
        state: nextState,
        tailoredResumeId: previousRecord.id,
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to update the tailored resume block.",
          ),
        );
      }

      const reviewRecord =
        resolveTailoredResumeReviewRecordFromPayload(
          result.payload,
          previousRecord.id,
        ) ?? null;

      if (!reviewRecord) {
        throw new Error("The tailored resume review could not be refreshed.");
      }

      setTailoredResumeReviewState({
        record: reviewRecord,
        status: "ready",
      });
      syncTailoredResumeSummariesFromPayload(result.payload);
    } catch (error) {
      setTailoredResumeReviewState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to update the tailored resume block.",
        record: previousRecord,
        status: "error",
      });
    } finally {
      setPendingTailoredResumeReviewEditId(null);
    }
  }

  async function saveTailoredResumeReviewUserEdit(editId: string, latexCode: string) {
    if (
      authState.status !== "signedIn" ||
      !activeTailoredResumeReviewRecord ||
      pendingTailoredResumeReviewEditId
    ) {
      return false;
    }

    const currentEdit = activeTailoredResumeReviewRecord.edits.find(
      (edit) => edit.editId === editId,
    );

    if (!currentEdit) {
      return false;
    }

    const previousRecord = activeTailoredResumeReviewRecord;
    const optimisticRecord: TailoredResumeReviewRecord = {
      ...previousRecord,
      edits: previousRecord.edits.map((edit) => {
        if (edit.editId !== editId) {
          return edit;
        }

        if (latexCode === edit.beforeLatexCode) {
          return {
            ...edit,
            customLatexCode: null,
            state: "rejected",
          };
        }

        if (latexCode === edit.afterLatexCode) {
          return {
            ...edit,
            customLatexCode: null,
            state: "applied",
          };
        }

        return {
          ...edit,
          customLatexCode: latexCode,
        };
      }),
    };

    setPendingTailoredResumeReviewEditId(editId);
    setTailoredResumeReviewState({
      record: optimisticRecord,
      status: "ready",
    });

    try {
      const result = await patchTailorResume({
        action: "saveTailoredResumeUserEdit",
        latexCode,
        segmentId: currentEdit.segmentId,
        tailoredResumeId: previousRecord.id,
      });

      if (!result.ok) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to save the tailored resume block edit.",
          ),
        );
      }

      const reviewRecord =
        resolveTailoredResumeReviewRecordFromPayload(
          result.payload,
          previousRecord.id,
        ) ?? null;

      if (!reviewRecord) {
        throw new Error("The tailored resume review could not be refreshed.");
      }

      setTailoredResumeReviewState({
        record: reviewRecord,
        status: "ready",
      });
      syncTailoredResumeSummariesFromPayload(result.payload);
      return true;
    } catch (error) {
      setTailoredResumeReviewState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the tailored resume block edit.",
        record: previousRecord,
        status: "error",
      });
      return false;
    } finally {
      setPendingTailoredResumeReviewEditId(null);
    }
  }

  async function patchTailorResume(
    body: Record<string, unknown>,
    options: {
      onInterviewStreamEvent?: (
        interviewStreamEvent: TailorResumeInterviewStreamEvent,
      ) => void;
      onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
      onUserMemoryEvent?: (payload: Record<string, unknown>) => void;
      signal?: AbortSignal;
    } = {},
  ) {
    if (authState.status !== "signedIn") {
      throw new Error("Connect Google before tailoring a resume.");
    }

    const action = typeof body.action === "string" ? body.action : "";
    const shouldStream =
      action === "tailor" ||
      action === "advanceTailorResumeInterview" ||
      action === "completeTailorResumeInterview" ||
      action === "startTailorResumeInterview";
    const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authState.session.sessionToken}`,
        "Content-Type": "application/json",
        ...(shouldStream ? { "x-tailor-resume-stream": "1" } : {}),
      },
      method: "PATCH",
      signal: options.signal,
    });

    if (isNdjsonResponse(response)) {
      const streamedResult = await readTailorResumeGenerationStream(response, {
        onInterviewStreamEvent: options.onInterviewStreamEvent,
        onStepEvent: options.onStepEvent,
        onUserMemoryEvent: options.onUserMemoryEvent,
      });

      return streamedResult;
    }

    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      await invalidateAuthSession();
      throw new Error("Connect Google before tailoring a resume.");
    }

    return {
      ok: response.ok,
      payload,
      status: response.status,
    };
  }

  async function connectGoogleAccount(): Promise<AuthState> {
    if (authActionState === "running") {
      return authState;
    }

    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SIGN_IN",
      });
      const nextAuthState = readAuthResponse(response);
      setAuthState(nextAuthState);

      if (nextAuthState.status === "signedIn") {
        setIsTailorAuthPromptOpen(false);
      }

      return nextAuthState;
    } catch (error) {
      const nextAuthState = {
        error:
          error instanceof Error ? error.message : "Could not connect to Google.",
        status: "error",
      } satisfies AuthState;
      setAuthState(nextAuthState);
      return nextAuthState;
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleSignIn() {
    await connectGoogleAccount();
  }

  async function handleSignOut() {
    setAuthActionState("running");

    try {
      await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SIGN_OUT",
      });
      setAuthState({ status: "signedOut" });
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error ? error.message : "Could not disconnect.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  const chatPageLabel =
    state.status === "ready"
      ? `Page attached: ${state.snapshot.title || state.snapshot.url || "Current page"}`
      : "Resume support";
  const canSendChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatInput.trim().length > 0;
  const canDeleteChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatMessages.length > 0;
  const canCompactChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatMessages.length > 10;

  const focusTailoredPreviewEdit = useCallback(
    (editId: string) => {
      setTailoredPreviewFocusEditId(editId);
      setTailoredPreviewFocusRequest((currentValue) => currentValue + 1);

      if (!isTailorRunDetailWideLayout) {
        setActiveTailorRunDetailView("preview");
      }
    },
    [isTailorRunDetailWideLayout],
  );

  function renderTailoredPreviewSurface() {
    const isShowingHighlightedPreview =
      shouldShowTailoredPreviewDiffHighlighting;
    const previewHighlightQueries = isShowingHighlightedPreview
      ? tailoredPreviewHighlightQueries
      : EMPTY_TAILORED_PREVIEW_HIGHLIGHT_QUERIES;

    return (
      <div className="tailor-run-detail-page-body tailor-run-detail-page-body-preview">
        <div className="tailored-preview-stage">
          {activeTailoredResumeError ? (
            <div className="tailored-preview-error-banner" role="alert">
              <p>
                This tailored resume failed generation and should not be used as
                a final PDF.
              </p>
              <pre>{activeTailoredResumeError}</pre>
            </div>
          ) : null}
          <div className="resume-preview-shell tailored-preview-shell tailor-run-fullscreen-preview">
            {tailoredResumePreviewState.status === "loading" ? (
              <p className="placeholder">Rendering tailored preview...</p>
            ) : tailoredResumePreviewState.status === "error" ? (
              <p className="preview-error">{tailoredResumePreviewState.error}</p>
            ) : tailoredResumePreviewState.status === "ready" ? (
              <TailoredResumeInteractivePreview
                displayName={activeTailoredResumeReviewRecord?.displayName ?? "Resume"}
                focusKey={tailoredPreviewFocusEditId}
                focusMatchKey={tailoredPreviewFocusMatchKey}
                focusQuery={tailoredPreviewFocusQuery}
                focusRequest={tailoredPreviewFocusRequest}
                highlightQueries={previewHighlightQueries}
                loadPdfJsModule={loadExtensionTailoredPreviewPdfJsModule}
                pdfUrl={tailoredResumePreviewState.objectUrl}
                presentation="frameless"
                scaleMode="fit"
              />
            ) : (
              <p className="placeholder preview-placeholder">
                Tailored preview will appear here.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderTailoredPreviewHighlightToggle() {
    const isShowingHighlightedPreview =
      shouldShowTailoredPreviewDiffHighlighting;

    if (!canToggleTailoredPreviewDiffHighlighting) {
      return null;
    }

    return (
      <button
        aria-label={
          isShowingHighlightedPreview
            ? "Hide diff highlighting"
            : "Show diff highlighting"
        }
        aria-pressed={isShowingHighlightedPreview}
        className={`tailored-preview-highlight-toggle tailored-preview-highlight-toggle-icon ${
          isShowingHighlightedPreview
            ? "tailored-preview-highlight-toggle-active"
            : ""
        }`.trim()}
        onClick={() =>
          setIsTailoredPreviewDiffHighlightingEnabled(
            (currentValue) => !currentValue,
          )
        }
        title={
          isShowingHighlightedPreview
            ? "Hide diff highlighting"
            : "Show diff highlighting"
        }
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </button>
    );
  }

  function renderTailoredQuickReviewSurface() {
    if (
      tailoredResumeReviewState.status === "loading" &&
      !activeTailoredResumeReviewRecord
    ) {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-review">
          <p className="quick-review-placeholder">Loading block-level review…</p>
        </div>
      );
    }

    if (activeTailoredResumeReviewRecord) {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-review">
          <TailoredResumeQuickReview
            error={tailoredResumeReviewError}
            isUpdating={pendingTailoredResumeReviewEditId !== null}
            onFocusEdit={focusTailoredPreviewEdit}
            record={activeTailoredResumeReviewRecord}
            variant="fullscreen"
            onSaveUserEdit={saveTailoredResumeReviewUserEdit}
            onSetEditState={(editId, nextState) =>
              void setTailoredResumeReviewEditState(editId, nextState)
            }
          />
        </div>
      );
    }

    if (tailoredResumeReviewState.status === "error") {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-review">
          <p className="quick-review-error">{tailoredResumeReviewError}</p>
        </div>
      );
    }

    return null;
  }

  function renderTailorRunDebugSurface() {
    if (
      tailoredResumeReviewState.status === "loading" &&
      !activeTailoredResumeReviewRecord
    ) {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-debug">
          <p className="quick-review-placeholder">Loading debug trace...</p>
        </div>
      );
    }

    if (tailoredResumeReviewState.status === "error") {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-debug">
          <p className="quick-review-error">{tailoredResumeReviewError}</p>
        </div>
      );
    }

    if (!activeTailoredResumeReviewRecord) {
      return (
        <div className="tailor-run-detail-page-body tailor-run-detail-page-body-debug">
          <p className="quick-review-placeholder">
            Open a tailored resume to inspect its debug trace.
          </p>
        </div>
      );
    }

    const debugTrace = activeTailoredResumeReviewRecord.openAiDebug;
    const debugSteps: TailorRunDebugStep[] = [
      {
        emptyState: "No saved Step 1 keyword extraction trace is available.",
        label: "Scrape keywords",
        responseLabel: "Model response",
        stage: debugTrace.keywordExtraction,
        stepNumber: 1,
      },
      {
        emptyState: "No saved Step 2 keyword review trace is available.",
        label: "Review skills-section blockers",
        responseLabel: "Step response",
        stage: debugTrace.keywordReview,
        stepNumber: 2,
      },
      {
        emptyState: "No saved Step 3 planning trace is available.",
        label: "Generate plaintext targeted edit plan",
        responseLabel: "Model response",
        stage: debugTrace.planning,
        stepNumber: 3,
      },
      {
        emptyState: "No saved Step 4 implementation trace is available.",
        label: "Generate block-scoped edits",
        responseLabel: "Model response",
        stage: debugTrace.implementation,
        stepNumber: 4,
      },
    ];

    return (
      <div className="tailor-run-detail-page-body tailor-run-detail-page-body-debug">
        <section className="tailor-debug-page" aria-label="Tailor Resume debug trace">
          {debugSteps.map((step) => (
            <TailorRunDebugStepCard key={step.stepNumber} step={step} />
          ))}
        </section>
      </div>
    );
  }

  function renderSettingsSurface() {
    const accountSummary =
      authState.status === "loading"
        ? "Checking connection..."
        : authState.status === "signedOut"
          ? "Not connected"
          : authState.status === "error"
            ? authState.error
            : authState.session.user.email ||
              authState.session.user.name ||
              "Connected";
    const originalResumeSummary =
      authState.status !== "signedIn"
        ? "Connect Google to preview your resume."
        : personalInfoState.status === "loading"
          ? "Loading resume preview..."
          : personalInfoState.status === "error"
            ? personalInfoState.error
            : originalResume?.filename?.trim() || "No resume data loaded yet.";
    const userMarkdownSummary =
      authState.status !== "signedIn"
        ? "Connect Google to view USER.md."
        : personalInfoState.status === "loading"
          ? "Loading USER.md..."
          : personalInfoState.status === "error"
            ? personalInfoState.error
            : `${draftSettingsUserMarkdown.length.toLocaleString()} chars`;
    const skillsOnlySummary =
      authState.status !== "signedIn"
        ? "Connect Google to edit skills-only keywords."
        : personalInfoState.status === "loading"
          ? "Loading skills-only keywords..."
          : personalInfoState.status === "error"
            ? personalInfoState.error
            : `${settingsSkillsOnlySkills.length.toLocaleString()} saved`;
    const resumeBulletsSummary =
      authState.status !== "signedIn"
        ? "Connect Google to edit resume bullets."
        : personalInfoState.status === "loading"
          ? "Loading resume bullets..."
          : personalInfoState.status === "error"
            ? personalInfoState.error
            : `${settingsSkillData.spareBullets.length.toLocaleString()} saved`;

    return (
      <section className="settings-page">
        <section className="snapshot-card settings-card">
          <div className="settings-section-heading">
            <p className="settings-section-eyebrow">Account</p>
          </div>
          <div className="settings-account-row">
            <div className="settings-account-identity">
              {authState.status === "signedIn" ? (
                <span className="auth-avatar" aria-hidden="true">
                  {authState.session.user.image ? (
                    <span
                      className="auth-avatar-image"
                      style={{
                        backgroundImage: `url(${JSON.stringify(
                          authState.session.user.image,
                        )})`,
                      }}
                    />
                  ) : (
                    <span>{getUserInitial(authState.session.user)}</span>
                  )}
                </span>
              ) : (
                <span className="settings-account-placeholder" aria-hidden="true">
                  G
                </span>
              )}
              <div className="settings-account-copy">
                <p className="settings-account-label">Google</p>
                <p className="settings-account-value">{accountSummary}</p>
              </div>
            </div>
            {authState.status === "signedIn" ? (
              <button
                className="secondary-action compact-action settings-account-action"
                disabled={authActionState === "running"}
                type="button"
                onClick={handleSignOut}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="primary-action compact-action settings-account-action"
                disabled={authActionState === "running"}
                type="button"
                onClick={handleSignIn}
              >
                {authActionState === "running" ? "Connecting..." : "Connect Google"}
              </button>
            )}
          </div>
        </section>

        <section className="snapshot-card settings-card">
          <div className="settings-section-heading">
            <p className="settings-section-eyebrow">Tailor Runs</p>
          </div>
          <div className="settings-toggle-row">
            <div className="settings-toggle-copy">
              <p className="settings-toggle-title">Progress time</p>
              <p className="settings-toggle-description">
                Choose whether running cards show total runtime or per-step
                timings.
              </p>
            </div>
            <div
              aria-label="Tailor run progress time display"
              className="panel-detail-toggle-group settings-time-toggle-group"
            >
              {(["specific", "aggregate"] as const).map((mode) => (
                <button
                  aria-pressed={tailorRunTimeDisplayMode === mode}
                  className={`panel-detail-toggle ${
                    tailorRunTimeDisplayMode === mode
                      ? "panel-detail-toggle-active"
                      : ""
                  }`.trim()}
                  key={mode}
                  type="button"
                  onClick={() => void updateTailorRunTimeDisplayMode(mode)}
                >
                  {mode === "specific" ? "Specific" : "Aggregate"}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-toggle-row settings-toggle-row-keyword">
            <div className="settings-toggle-copy">
              <p className="settings-toggle-title">Ludicrous Mode</p>
              <p className="settings-toggle-description">
                Skip Step 2 user input and let tailoring continue immediately,
                even when skills-section support is missing.
              </p>
            </div>
            <button
              aria-checked={ludicrousMode}
              className={`settings-account-action settings-toggle-switch ${
                ludicrousMode ? "settings-toggle-switch-active" : ""
              }`.trim()}
              disabled={
                authState.status !== "signedIn" ||
                isSavingKeywordCoverageSetting
              }
              role="switch"
              type="button"
              onClick={() => void updateLudicrousMode(!ludicrousMode)}
            >
              <span className="settings-toggle-switch-label">
                {ludicrousMode ? "Enabled" : "Disabled"}
              </span>
              <span className="settings-toggle-switch-track" aria-hidden="true">
                <span className="settings-toggle-switch-thumb" />
              </span>
            </button>
          </div>
          <div className="settings-toggle-row settings-toggle-row-keyword">
            <div className="settings-toggle-copy">
              <p className="settings-toggle-title">Resume download name</p>
              <p className="settings-toggle-description">
                Download PDFs as the company name or one fixed filename.
              </p>
            </div>
            <button
              aria-checked={useCustomResumeDownloadName}
              className={`settings-account-action settings-toggle-switch ${
                useCustomResumeDownloadName ? "settings-toggle-switch-active" : ""
              }`.trim()}
              disabled={
                authState.status !== "signedIn" ||
                isSavingKeywordCoverageSetting
              }
              role="switch"
              type="button"
              onClick={() =>
                void updateResumeDownloadNaming({
                  useCustomResumeDownloadName: !useCustomResumeDownloadName,
                })
              }
            >
              <span className="settings-toggle-switch-label">
                {useCustomResumeDownloadName ? "Fixed name" : "Company"}
              </span>
              <span className="settings-toggle-switch-track" aria-hidden="true">
                <span className="settings-toggle-switch-thumb" />
              </span>
            </button>
          </div>
          <label className="settings-spare-bullet-field">
            <span>Fixed PDF name</span>
            <input
              defaultValue={customResumeDownloadName}
              disabled={
                authState.status !== "signedIn" ||
                isSavingKeywordCoverageSetting
              }
              maxLength={160}
              onBlur={(event) => {
                const nextName = event.currentTarget.value.trim();

                if (nextName && nextName !== customResumeDownloadName) {
                  void updateResumeDownloadNaming({
                    customResumeDownloadName: nextName,
                  });
                }
              }}
              key={customResumeDownloadName}
              placeholder="Resume"
              type="text"
            />
          </label>
          <div className="settings-toggle-row settings-toggle-row-keyword">
            <div className="settings-toggle-copy">
              <p className="settings-toggle-title">Coverage percentage basis</p>
              <p className="settings-toggle-description">
                Low-priority terms are always tracked and shown. Choose which
                tracked terms calculate the popup percentage.
              </p>
            </div>
            <div
              aria-label="Coverage percentage basis"
              className="panel-detail-toggle-group settings-keyword-toggle-group"
            >
              {[
                { includeLowPriorityTerms: false, label: "High priority" },
                { includeLowPriorityTerms: true, label: "All tracked" },
              ].map((option) => (
                <button
                  aria-pressed={
                    includeLowPriorityTermsInKeywordCoverage ===
                    option.includeLowPriorityTerms
                  }
                  className={`panel-detail-toggle ${
                    includeLowPriorityTermsInKeywordCoverage ===
                    option.includeLowPriorityTerms
                      ? "panel-detail-toggle-active"
                      : ""
                  }`.trim()}
                  disabled={
                    authState.status !== "signedIn" ||
                    isSavingKeywordCoverageSetting
                  }
                  key={option.label}
                  type="button"
                  onClick={() =>
                    void updateKeywordCoveragePriorityScope(
                      option.includeLowPriorityTerms,
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {keywordCoverageSettingError ? (
            <p className="settings-inline-error">
              {keywordCoverageSettingError}
            </p>
          ) : null}
        </section>

        <section className="snapshot-card settings-card">
          <div className="settings-section-heading">
            <p className="settings-section-eyebrow">Scraper Reliability</p>
          </div>
          <div className="settings-non-technology-panel">
            <div className="settings-non-technology-copy">
              <p className="settings-non-technology-title">Non-technologies</p>
              <p className="settings-non-technology-description">
                These terms are ignored when job keywords are scraped.
              </p>
            </div>
            <div className="settings-non-technology-badges">
              {draftSettingsNonTechnologies.length > 0 ? (
                draftSettingsNonTechnologies.map((term) => (
                  <span className="settings-non-technology-badge" key={term}>
                    <span>{formatNonTechnologyTerm(term)}</span>
                    <button
                      aria-label={`Remove ${formatNonTechnologyTerm(term)}`}
                      className="settings-non-technology-remove"
                      disabled={isSavingSettingsNonTechnologies}
                      onClick={() => removeSettingsNonTechnology(term)}
                      type="button"
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ))
              ) : (
                <span className="settings-non-technology-empty">No terms</span>
              )}
            </div>
            <div className="settings-non-technology-add">
              <input
                disabled={isSavingSettingsNonTechnologies}
                onChange={(event) =>
                  setDraftSettingsNonTechnologyInput(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSettingsNonTechnology();
                  }
                }}
                placeholder="Add a term"
                value={draftSettingsNonTechnologyInput}
              />
              <button
                className="secondary-action compact-action settings-account-action"
                disabled={
                  isSavingSettingsNonTechnologies ||
                  !normalizeNonTechnologyTerm(draftSettingsNonTechnologyInput)
                }
                onClick={addSettingsNonTechnology}
                type="button"
              >
                Add
              </button>
            </div>
            {settingsNonTechnologyError ? (
              <p className="preview-error">{settingsNonTechnologyError}</p>
            ) : null}
            <div className="settings-non-technology-actions">
              <button
                className="secondary-action compact-action settings-account-action"
                disabled={
                  isSavingSettingsNonTechnologies ||
                  !isSettingsNonTechnologiesChanged
                }
                onClick={cancelSettingsNonTechnologyEdits}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-action compact-action settings-account-action"
                disabled={
                  isSavingSettingsNonTechnologies ||
                  !isSettingsNonTechnologiesChanged
                }
                onClick={() => void saveSettingsNonTechnologies()}
                type="button"
              >
                {isSavingSettingsNonTechnologies ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>

        <section className="snapshot-card resume-preview-card settings-card">
          <button
            aria-controls="settings-original-resume-panel"
            aria-expanded={isSettingsOriginalResumeOpen}
            className="settings-disclosure"
            onClick={() =>
              setIsSettingsOriginalResumeOpen((currentValue) => !currentValue)
            }
            type="button"
          >
            <div className="settings-disclosure-copy">
              <p className="settings-section-eyebrow">Base Resume</p>
              <div className="settings-disclosure-title-row">
                <h2 className="settings-disclosure-title">
                  Original Resume Preview
                </h2>
                <span className="settings-disclosure-pill">
                  {originalResumeSummary}
                </span>
              </div>
              <p className="settings-disclosure-description">
                Review the uploaded base resume and its rendered preview. This
                section starts collapsed by default.
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`settings-disclosure-chevron ${
                isSettingsOriginalResumeOpen
                  ? "settings-disclosure-chevron-open"
                  : ""
              }`}
            >
              <svg fill="none" viewBox="0 0 20 20">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
          </button>

          {isSettingsOriginalResumeOpen ? (
            <div
              className="settings-disclosure-panel"
              id="settings-original-resume-panel"
            >
              {authState.status !== "signedIn" ? (
                <p className="placeholder">Connect Google to preview your resume.</p>
              ) : personalInfoState.status === "loading" ? (
                <p className="placeholder">Loading resume preview...</p>
              ) : personalInfoState.status === "error" ? (
                <p className="placeholder">{personalInfoState.error}</p>
              ) : originalResume ? (
                <>
                  {originalResume.error ? (
                    <p className="preview-error">{originalResume.error}</p>
                  ) : null}
                  {originalResume.pdfUpdatedAt ? (
                    <div className="resume-preview-shell">
                      {resumePreviewState.status === "loading" ? (
                        <p className="placeholder">Rendering preview...</p>
                      ) : resumePreviewState.status === "error" ? (
                        <p className="placeholder">{resumePreviewState.error}</p>
                      ) : resumePreviewState.status === "ready" ? (
                        <iframe
                          className="resume-preview-frame"
                          src={resumePreviewState.objectUrl}
                          title="Resume preview"
                        />
                      ) : (
                        <p className="placeholder">Preview will appear here.</p>
                      )}
                    </div>
                  ) : (
                    <p className="placeholder preview-placeholder">
                      No rendered preview is available yet.
                    </p>
                  )}
                  {originalResume.resumeUpdatedAt ? (
                    <dl className="snapshot-grid resume-updated-grid">
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatTailoredResumeDate(originalResume.resumeUpdatedAt)}</dd>
                      </div>
                    </dl>
                  ) : null}
                </>
              ) : (
                <p className="placeholder">No resume data loaded yet.</p>
              )}
            </div>
          ) : null}
        </section>

        <section className="snapshot-card settings-card">
          <button
            aria-controls="settings-user-markdown-panel"
            aria-expanded={isSettingsUserMarkdownOpen}
            className="settings-disclosure"
            onClick={() =>
              setIsSettingsUserMarkdownOpen((currentValue) => !currentValue)
            }
            type="button"
          >
            <div className="settings-disclosure-copy">
              <p className="settings-section-eyebrow">User Memory</p>
              <div className="settings-disclosure-title-row">
                <h2 className="settings-disclosure-title">USER.md</h2>
                <span className="settings-disclosure-pill">
                  {userMarkdownSummary}
                </span>
                {isSettingsUserMarkdownChanged ? (
                  <span className="settings-disclosure-pill settings-disclosure-pill-warning">
                    Unsaved
                  </span>
                ) : null}
              </div>
              <p className="settings-disclosure-description">
                Durable resume context used during tailoring. This section
                starts collapsed by default.
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`settings-disclosure-chevron ${
                isSettingsUserMarkdownOpen
                  ? "settings-disclosure-chevron-open"
                  : ""
              }`}
            >
              <svg fill="none" viewBox="0 0 20 20">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
          </button>

          {isSettingsUserMarkdownOpen ? (
            <div
              className="settings-disclosure-panel"
              id="settings-user-markdown-panel"
            >
              {authState.status !== "signedIn" ? (
                <p className="placeholder">Connect Google to view USER.md.</p>
              ) : personalInfoState.status === "loading" ? (
                <p className="placeholder">Loading USER.md...</p>
              ) : personalInfoState.status === "error" ? (
                <p className="placeholder">{personalInfoState.error}</p>
              ) : (
                <>
                  <textarea
                    className="settings-user-markdown-input"
                    disabled={isSavingSettingsUserMarkdown}
                    onChange={(event) =>
                      setDraftSettingsUserMarkdown(event.target.value)
                    }
                    spellCheck={false}
                    value={draftSettingsUserMarkdown}
                  />
                  {settingsUserMarkdownError ? (
                    <p className="preview-error">{settingsUserMarkdownError}</p>
                  ) : null}
                  <div className="settings-user-markdown-actions">
                    <button
                      className="secondary-action compact-action settings-account-action"
                      disabled={isSavingSettingsUserMarkdown}
                      onClick={cancelSettingsUserMarkdownEdits}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-action compact-action settings-account-action"
                      disabled={
                        isSavingSettingsUserMarkdown ||
                        !isSettingsUserMarkdownChanged
                      }
                      onClick={() => void saveSettingsUserMarkdown()}
                      type="button"
                    >
                      {isSavingSettingsUserMarkdown ? "Saving..." : "Save"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>

        <section className="snapshot-card settings-card">
          <div className="settings-section-heading">
            <p className="settings-section-eyebrow">User Memory</p>
            <div className="settings-disclosure-title-row">
              <h2 className="settings-disclosure-title">Skills-only keywords</h2>
              <span className="settings-disclosure-pill">
                {skillsOnlySummary}
              </span>
            </div>
            <p className="settings-disclosure-description">
              Exact tools that can be listed in Skills without adding a resume
              bullet.
            </p>
          </div>

          {authState.status !== "signedIn" ? (
            <p className="placeholder">
              Connect Google to edit skills-only keywords.
            </p>
          ) : personalInfoState.status === "loading" ? (
            <p className="placeholder">Loading skills-only keywords...</p>
          ) : personalInfoState.status === "error" ? (
            <p className="placeholder">{personalInfoState.error}</p>
          ) : (
            <div className="settings-skills-only-panel">
              <div className="settings-skills-only-add">
                <input
                  disabled={isSavingSettingsSkillsOnly}
                  onChange={(event) =>
                    setDraftSettingsSkillsOnlyName(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveSettingsSkillsOnlySupport();
                    }
                  }}
                  placeholder="Keyword to list only in Skills"
                  value={draftSettingsSkillsOnlyName}
                />
                <button
                  className="primary-action compact-action settings-account-action settings-skills-only-save"
                  disabled={
                    isSavingSettingsSkillsOnly ||
                    !canSaveSettingsSkillsOnly
                  }
                  onClick={() => void saveSettingsSkillsOnlySupport()}
                  type="button"
                >
                  <PlusIcon />
                  <span>
                    {isSavingSettingsSkillsOnly ? "Saving..." : "Add keyword"}
                  </span>
                </button>
              </div>

              {settingsSkillsOnlyError ? (
                <p className="preview-error">{settingsSkillsOnlyError}</p>
              ) : null}

              <div className="settings-skills-only-list">
                {settingsSkillsOnlySkills.length > 0 ? (
                  settingsSkillsOnlySkills.map((skill) => (
                    <span className="settings-skills-only-badge" key={skill.id}>
                      <span>{skill.name}</span>
                      <button
                        aria-label={`Remove ${skill.name}`}
                        className="settings-skills-only-remove"
                        disabled={isSavingSettingsSkillsOnly}
                        onClick={() =>
                          void deleteSettingsSkillsOnlySupport(skill.id)
                        }
                        title={`Remove ${skill.name}`}
                        type="button"
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="settings-skills-only-empty">
                    No skills-only keywords yet.
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="snapshot-card settings-card">
          <div className="settings-section-heading">
            <p className="settings-section-eyebrow">User Memory</p>
            <div className="settings-disclosure-title-row">
              <h2 className="settings-disclosure-title">Resume bullets</h2>
              <span className="settings-disclosure-pill">
                {resumeBulletsSummary}
              </span>
            </div>
            <p className="settings-disclosure-description">
              Saved skills-section support tied to specific resume experiences.
            </p>
          </div>

          {authState.status !== "signedIn" ? (
            <p className="placeholder">Connect Google to edit resume bullets.</p>
          ) : personalInfoState.status === "loading" ? (
            <p className="placeholder">Loading resume bullets...</p>
          ) : personalInfoState.status === "error" ? (
            <p className="placeholder">{personalInfoState.error}</p>
          ) : (
            <div className="settings-spare-bullet-panel">
              <div className="settings-spare-bullet-form">
                <label className="settings-spare-bullet-field">
                  <span>Resume experience</span>
                  <select
                    disabled={
                      isSavingSettingsSpareBullet ||
                      settingsSkillData.resumeExperiences.length === 0
                    }
                    onChange={(event) =>
                      setDraftSettingsSpareBulletExperienceId(
                        event.target.value,
                      )
                    }
                    value={draftSettingsSpareBulletExperienceId}
                  >
                    {settingsSkillData.resumeExperiences.length === 0 ? (
                      <option value="">No parsed experiences</option>
                    ) : null}
                    {settingsSkillData.resumeExperiences.map((experience) => (
                      <option key={experience.id} value={experience.id}>
                        {experience.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="settings-spare-bullet-field">
                  <span>Skills-section keywords</span>
                  <input
                    disabled={isSavingSettingsSpareBullet}
                    onChange={(event) =>
                      setDraftSettingsSpareBulletSkillNames(event.target.value)
                    }
                    placeholder="Comma-separated keywords"
                    value={draftSettingsSpareBulletSkillNames}
                  />
                </label>

                <SettingsSpareBulletQuoteField
                  disabled={isSavingSettingsSpareBullet}
                  fieldClassName="settings-spare-bullet-field-wide"
                  measureLineCount={measureSettingsSpareBulletLineCount}
                  onChange={setDraftSettingsSpareBulletQuote}
                  placeholder="Built ..."
                  resumeExperienceId={draftSettingsSpareBulletExperienceId}
                  value={draftSettingsSpareBulletQuote}
                />

                <label className="settings-spare-bullet-field settings-spare-bullet-field-wide">
                  <span>Replaces quote</span>
                  <textarea
                    disabled={isSavingSettingsSpareBullet}
                    onChange={(event) =>
                      setDraftSettingsSpareBulletReplacesQuote(
                        event.target.value,
                      )
                    }
                    placeholder="Original bullet to replace"
                    value={draftSettingsSpareBulletReplacesQuote}
                  />
                </label>
              </div>

              {settingsSpareBulletError ? (
                <p className="preview-error">{settingsSpareBulletError}</p>
              ) : null}

              <div className="settings-spare-bullet-actions">
                <button
                  className="primary-action compact-action settings-account-action settings-spare-bullet-save"
                  disabled={
                    isSavingSettingsSpareBullet ||
                    !canSaveSettingsSpareBullet
                  }
                  onClick={() => void saveSettingsSpareBullet()}
                  type="button"
                >
                  <PlusIcon />
                  <span>
                    {isSavingSettingsSpareBullet ? "Saving..." : "Add bullet"}
                  </span>
                </button>
              </div>

              {settingsSkillData.spareBullets.length > 0 ? (
                <div className="settings-spare-bullet-search">
                  <label className="settings-spare-bullet-search-input-shell">
                    <SearchIcon />
                    <span className="sr-only">Search resume bullets</span>
                    <input
                      aria-label="Search resume bullets"
                      onChange={(event) =>
                        setSettingsSpareBulletSearchQuery(event.target.value)
                      }
                      placeholder="Search skills or bullet text"
                      type="search"
                      value={settingsSpareBulletSearchQuery}
                    />
                  </label>
                  <div
                    aria-label="Resume bullet search mode"
                    className="settings-spare-bullet-search-modes"
                  >
                    {tailorResumeSpareBulletSearchModes.map((mode) => (
                      <button
                        aria-pressed={
                          settingsSpareBulletSearchMode === mode.value
                        }
                        className={`settings-spare-bullet-search-mode ${
                          settingsSpareBulletSearchMode === mode.value
                            ? "settings-spare-bullet-search-mode-active"
                            : ""
                        }`.trim()}
                        key={mode.value}
                        onClick={() =>
                          setSettingsSpareBulletSearchMode(mode.value)
                        }
                        type="button"
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  {isSettingsSpareBulletSearchActive ? (
                    <p className="settings-spare-bullet-search-summary">
                      {visibleSettingsSpareBullets.length.toLocaleString()} of{" "}
                      {settingsSkillData.spareBullets.length.toLocaleString()}{" "}
                      resume bullets
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="settings-spare-bullet-list">
                {settingsSkillData.spareBullets.length > 0 ? (
                  visibleSettingsSpareBullets.length > 0 ? (
	                    visibleSettingsSpareBullets.map((spareBullet) => {
	                      const experience = settingsSkillData.resumeExperiences.find(
	                        (candidate) =>
	                          candidate.id === spareBullet.resumeExperienceId,
	                      );
                      const editDraft =
                        settingsSpareBulletEditDraft?.id === spareBullet.id
                          ? settingsSpareBulletEditDraft
                          : null;

	                      return (
	                        <article
	                          className="settings-spare-bullet-card"
	                          key={spareBullet.id}
	                        >
	                          <div className="settings-spare-bullet-card-header">
	                            <div className="settings-spare-bullet-card-copy">
                              {editDraft ? (
                                <div className="settings-spare-bullet-inline-grid">
                                  <label className="settings-spare-bullet-field settings-spare-bullet-inline-field">
                                    <span>Skills-section keywords</span>
                                    <input
                                      disabled={isSavingSettingsSpareBullet}
                                      onChange={(event) =>
                                        updateSettingsSpareBulletEditDraft({
                                          skillNames: event.target.value,
                                        })
                                      }
                                      value={editDraft.skillNames}
                                    />
                                  </label>
                                  <label className="settings-spare-bullet-field settings-spare-bullet-inline-field">
                                    <span>Resume experience</span>
                                    <select
                                      disabled={
                                        isSavingSettingsSpareBullet ||
                                        settingsSkillData.resumeExperiences
                                          .length === 0
                                      }
                                      onChange={(event) =>
                                        updateSettingsSpareBulletEditDraft({
                                          resumeExperienceId:
                                            event.target.value,
                                        })
                                      }
                                      value={editDraft.resumeExperienceId}
                                    >
                                      {settingsSkillData.resumeExperiences.map(
                                        (resumeExperience) => (
                                          <option
                                            key={resumeExperience.id}
                                            value={resumeExperience.id}
                                          >
                                            {resumeExperience.label}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </label>
                                </div>
                              ) : (
                                <>
                                  <div className="settings-spare-bullet-skills">
                                    {spareBullet.skills.length > 0 ? (
                                      spareBullet.skills.map((skill) => (
                                        <span key={skill.id}>{skill.name}</span>
                                      ))
                                    ) : (
                                      <span>No skills</span>
                                    )}
                                    <SettingsSpareBulletSavedLineCountBadge
                                      cachedMeasurement={readSettingsSpareBulletCachedLineMeasurement(
                                        {
                                          quote: spareBullet.quote,
                                          resumeExperienceId:
                                            spareBullet.resumeExperienceId,
                                        },
                                      )}
                                      measureLineCount={
                                        measureSettingsSpareBulletLineCount
                                      }
                                      quote={spareBullet.quote}
                                      resumeExperienceId={
                                        spareBullet.resumeExperienceId
                                      }
                                    />
                                  </div>
                                  <p className="settings-spare-bullet-experience">
                                    {experience?.label ??
                                      spareBullet.resumeExperienceId}
                                  </p>
                                </>
                              )}
	                            </div>
	                            <div className="settings-spare-bullet-card-actions">
	                              <button
                                aria-label={
                                  editDraft
                                    ? "Save resume bullet"
                                    : "Edit resume bullet"
                                }
                                className={
                                  editDraft
                                    ? "settings-spare-bullet-card-action-save"
                                    : undefined
                                }
	                                disabled={
                                  isSavingSettingsSpareBullet ||
                                  (Boolean(editDraft) &&
                                    !canSaveSettingsSpareBulletEdit)
                                }
	                                onClick={() =>
                                  editDraft
                                    ? void saveSettingsSpareBulletEdit()
                                    : editSettingsSpareBullet(spareBullet)
                                }
	                                title={
                                  editDraft
                                    ? "Save resume bullet"
                                    : "Edit resume bullet"
                                }
	                                type="button"
	                              >
                                {editDraft ? <CheckIcon /> : <PencilIcon />}
	                              </button>
	                              <button
	                                aria-label="Delete resume bullet"
                                disabled={isSavingSettingsSpareBullet}
                                onClick={() =>
                                  void deleteSettingsSpareBullet(spareBullet.id)
                                }
                                title="Delete resume bullet"
                                type="button"
                              >
                                <TrashIcon />
                              </button>
	                            </div>
	                          </div>

                          {editDraft ? (
                            <div className="settings-spare-bullet-inline-edit">
                              <SettingsSpareBulletQuoteField
                                disabled={isSavingSettingsSpareBullet}
                                fieldClassName="settings-spare-bullet-inline-field"
                                measureLineCount={
                                  measureSettingsSpareBulletLineCount
                                }
                                onChange={(value) =>
                                  updateSettingsSpareBulletEditDraft({
                                    quote: value,
                                  })
                                }
                                resumeExperienceId={
                                  editDraft.resumeExperienceId
                                }
                                value={editDraft.quote}
                              />
                              <label className="settings-spare-bullet-field settings-spare-bullet-inline-field">
                                <span>Replaces quote</span>
                                <textarea
                                  disabled={isSavingSettingsSpareBullet}
                                  onChange={(event) =>
                                    updateSettingsSpareBulletEditDraft({
                                      replacesQuote: event.target.value,
                                    })
                                  }
                                  placeholder="Original bullet to replace"
                                  value={editDraft.replacesQuote}
                                />
                              </label>
                            </div>
                          ) : (
                            <>
                              <p className="settings-spare-bullet-quote">
                                {spareBullet.quote}
                              </p>
                              {spareBullet.replacesQuote ? (
                                <details className="settings-spare-bullet-replaces">
                                  <summary>Replaces quote</summary>
                                  <blockquote>
                                    {spareBullet.replacesQuote}
                                  </blockquote>
                                </details>
                              ) : null}
                            </>
                          )}
	                        </article>
	                      );
	                    })
                  ) : (
                    <p className="settings-spare-bullet-empty">
                      No resume bullets match that search.
                    </p>
                  )
                ) : (
                  <p className="settings-spare-bullet-empty">
                    No resume bullets yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderPageCaptureFailureNotice() {
    if (!pageCaptureFailureRun) {
      return null;
    }

    const message = formatPageContextErrorMessage(pageCaptureFailureRun.message);

    return (
      <section
        aria-label="Page capture issue"
        className="snapshot-card page-capture-error-card"
        role="alert"
      >
        <div className="page-capture-error-copy">
          <p className="page-capture-error-title">Could not read this page</p>
          <p className="page-capture-error-message">{message}</p>
        </div>
        <button
          className="secondary-action compact-action"
          disabled={isStoppingCurrentTailoring}
          type="button"
          onClick={() => void stopCurrentTailoring()}
        >
          {isStoppingCurrentTailoring ? "Clearing..." : "Dismiss"}
        </button>
      </section>
    );
  }

  if (tailorInterview && isTailorInterviewOpen) {
    return (
      <main className="side-panel-shell side-panel-shell-interview">
        <section className="tailor-interview-page" ref={tailorInterviewCardRef}>
          <header className="tailor-interview-page-header">
            <div className="tailor-interview-page-kicker">
              <button
                aria-label="Back to Tailor Resume"
                className="secondary-action compact-action tailor-interview-back-action"
                title="Back to Tailor Resume"
                type="button"
                onClick={closeTailorInterviewPage}
              >
                <ArrowLeftIcon />
              </button>
              <p className="eyebrow">Resume questions</p>
            </div>
            <h1 title={tailorInterviewHeading}>{tailorInterviewHeading}</h1>
            {tailorInterview.questioningSummary?.agenda ? (
              <p className="interview-agenda">
                {tailorInterview.questioningSummary.agenda}
              </p>
            ) : null}
          </header>

          <div className="interview-thread tailor-interview-page-thread" aria-live="polite">
            {displayedTailorInterviewConversation.map((message) => (
              <div
                className={`interview-message interview-message-${message.role}`}
                key={message.id}
              >
                <TailorInterviewMessageContent
                  message={message}
                />
              </div>
            ))}
            {shouldShowTailorInterviewThinkingIndicator ? (
              <div className="interview-message interview-message-assistant interview-message-thinking">
                <TailorInterviewThinkingIndicator />
              </div>
            ) : null}
            <div ref={tailorInterviewMessagesEndRef} />
          </div>

          {tailorInterviewError ? (
            <p className="interview-error">{tailorInterviewError}</p>
          ) : null}

          <textarea
            className="interview-input tailor-interview-page-input"
            disabled={isStoppingCurrentTailoring}
            onChange={(event) =>
              setDraftTailorInterviewAnswer(event.target.value)
            }
            onKeyDown={handleTailorInterviewAnswerKeyDown}
            placeholder={
              isTailorInterviewAwaitingCompletion
                ? "Anything else you want to clarify before we finish?"
                : "Answer the current question..."
            }
            ref={tailorInterviewInputRef}
            value={draftTailorInterviewAnswer}
          />

          <div
            className={`interview-actions tailor-interview-page-actions ${
              isTailorInterviewAwaitingCompletion
                ? "interview-actions-with-done"
                : ""
            }`}
          >
            <button
              className="secondary-action compact-action"
              disabled={isStoppingCurrentTailoring}
              type="button"
              onClick={() => void cancelTailorInterview()}
            >
              {isStoppingCurrentTailoring ? "Stopping..." : "Stop run"}
            </button>
            {isTailorInterviewAwaitingCompletion ? (
              <button
                className="primary-action compact-action"
                disabled={isTailorInterviewBusy || isFinishingTailorInterview}
                type="button"
                onClick={() => void completeTailorInterview()}
              >
                {isFinishingTailorInterview ? "Finishing..." : "Done"}
              </button>
            ) : null}
            <button
              className="primary-action compact-action"
              disabled={
                isTailorInterviewBusy ||
                draftTailorInterviewAnswer.trim().length === 0
              }
              type="button"
              onClick={() => void submitTailorInterviewAnswer()}
            >
              {isTailorInterviewThinking
                ? "Thinking..."
                : isTailorInterviewAwaitingCompletion
                  ? "Send clarification"
                  : "Send answer"}
            </button>
          </div>

          {captureState === "finishing" && tailorGenerationStep ? (
            <p className="interview-progress">
              {buildLiveTailorResumeStatusMessage(
                tailorGenerationStep,
                "Finishing the tailored resume",
              )}
              {tailorGenerationStep.detail ? ` ${tailorGenerationStep.detail}` : ""}
            </p>
          ) : null}
        </section>

        {tailorInterview && isTailorInterviewFinishPromptOpen ? (
          <div className="tailor-interview-finish-overlay" role="presentation">
            <section
              aria-modal="true"
              className="tailor-interview-finish-dialog"
              role="dialog"
            >
              <p className="eyebrow">Tailor Resume Keywords</p>
              <h2>Ready to start?</h2>
              <p className="tailor-interview-finish-copy">
                Review the keyword buckets, then press play to start tailoring.
              </p>
              <div className="tailor-interview-finish-actions">
                <button
                  className="secondary-action compact-action"
                  disabled={isFinishingTailorInterview}
                  type="button"
                  onClick={dismissTailorInterviewFinishPrompt}
                >
                  Keep reviewing
                </button>
                <button
                  className="primary-action compact-action"
                  disabled={isFinishingTailorInterview}
                  type="button"
                  onClick={() => void completeTailorInterview()}
                >
                  {isFinishingTailorInterview ? "Starting..." : "Play"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    );
  }

  if (showFullscreenTailorRunDetail) {
    return (
      <main className="side-panel-shell side-panel-shell-detail">
        <div className="panel-detail-header">
          <button
            className="panel-back-link"
            type="button"
            onClick={closeTailorRunDetailView}
            aria-label="Back to run"
            title="Back to run"
          >
            <ArrowLeftIcon />
          </button>
          {activeTailorRunDetailIdentity ? (
            <p
              className="panel-detail-job-id tailor-run-identity-structured"
              title={displayedTailorRunIdentity?.title ?? activeTailorRunDetailIdentity}
            >
              {activeTailorRunDetailIdentity}
            </p>
          ) : null}
          <div className="panel-detail-meta-actions">
            {renderTailoredPreviewHighlightToggle()}
          </div>
          {!isTailorRunDetailWideLayout || EXTENSION_DEBUG_UI_ENABLED ? (
            <div
              className="panel-detail-toggle-group"
              aria-label="Tailored resume detail"
            >
              {isTailorRunDetailWideLayout ? (
                <button
                  aria-pressed={activeTailorRunDetailView !== "debug"}
                  className={`panel-detail-toggle ${
                    activeTailorRunDetailView !== "debug"
                      ? "panel-detail-toggle-active"
                      : ""
                  }`.trim()}
                  type="button"
                  onClick={() =>
                    openTailorRunDetailView("quickReview", focusedTailoredResumeId)
                  }
                >
                  Review + Preview
                </button>
              ) : (
                <>
                  <button
                    aria-pressed={activeTailorRunDetailView === "quickReview"}
                    className={`panel-detail-toggle ${
                      activeTailorRunDetailView === "quickReview"
                        ? "panel-detail-toggle-active"
                        : ""
                    }`.trim()}
                    type="button"
                    onClick={() =>
                      openTailorRunDetailView(
                        "quickReview",
                        focusedTailoredResumeId,
                      )
                    }
                  >
                    Review edits
                  </button>
                  <button
                    aria-pressed={activeTailorRunDetailView === "preview"}
                    className={`panel-detail-toggle ${
                      activeTailorRunDetailView === "preview"
                        ? "panel-detail-toggle-active"
                        : ""
                    }`.trim()}
                    type="button"
                    onClick={() =>
                      openTailorRunDetailView("preview", focusedTailoredResumeId)
                    }
                  >
                    Preview
                  </button>
                </>
              )}
              {EXTENSION_DEBUG_UI_ENABLED ? (
                <button
                  aria-pressed={activeTailorRunDetailView === "debug"}
                  className={`panel-detail-toggle ${
                    activeTailorRunDetailView === "debug"
                      ? "panel-detail-toggle-active"
                      : ""
                  }`.trim()}
                  type="button"
                  onClick={() =>
                    openTailorRunDetailView("debug", focusedTailoredResumeId)
                  }
                >
                  {debugButtonLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <section
          className={`tailor-run-detail-page ${
            isTailorRunDetailWideLayout ? "tailor-run-detail-page-split" : ""
          }`.trim()}
        >
          {activeTailorRunDetailView === "debug" ? (
            renderTailorRunDebugSurface()
          ) : isTailorRunDetailWideLayout ? (
            <ResizablePanelGroup
              className="tailor-run-detail-resizable"
              orientation="horizontal"
            >
              <ResizablePanel
                collapsedSize={0}
                collapsible
                className="tailor-run-detail-split-pane tailor-run-detail-split-pane-review"
                defaultSize={48}
                id="tailored-resume-review-edits"
                minSize={24}
              >
                <section aria-label="Block edits">
                  {renderTailoredQuickReviewSurface()}
                </section>
              </ResizablePanel>

              <ResizableHandle
                className="tailor-run-detail-resize-handle"
                withHandle
              />

              <ResizablePanel
                collapsedSize={0}
                collapsible
                className="tailor-run-detail-split-pane tailor-run-detail-split-pane-preview"
                defaultSize={52}
                id="tailored-resume-preview"
                minSize={24}
              >
                <section aria-label="Tailored resume preview">
                  {renderTailoredPreviewSurface()}
                </section>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : activeTailorRunDetailView === "quickReview" ? (
            renderTailoredQuickReviewSurface()
          ) : (
            renderTailoredPreviewSurface()
          )}
        </section>
      </main>
    );
  }

  return (
    <main
      className={`side-panel-shell ${
        activePanelTab === "tailor" ? "side-panel-shell-tailor" : ""
      }`.trim()}
    >
      <div className="panel-topbar">
        <nav
          aria-label="Job Helper sections"
          className="panel-tabs"
          style={{
            gridTemplateColumns: `repeat(${availablePanelTabs.length}, minmax(0, 1fr))`,
          }}
        >
          {availablePanelTabs.map((tab) => (
            <button
              key={tab.id}
              aria-current={activePanelTab === tab.id ? "page" : undefined}
              className={`panel-tab ${activePanelTab === tab.id ? "panel-tab-active" : ""}`}
              type="button"
              onClick={() => handlePanelTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activePanelTab === "tailor" ? (
        <>
          {renderTailoredResumeArchiveControls()}

          <div
            className={`action-grid ${
              showTopLevelTailoredWebAction ? "action-grid-split" : ""
            }`.trim()}
          >
            <button
              aria-keyshortcuts="Meta+Shift+S"
              className={`primary-action tailor-action ${
                showTopLevelTailoredWebAction ? "tailor-action-split" : ""
              }`.trim()}
              disabled={
                authActionState === "running" ||
                authState.status === "loading" ||
                isTailorPreparationPending ||
                captureState === "running" ||
                Boolean(existingTailoringPrompt) ||
                isStoppingCurrentTailoring
              }
              title={`Tailor current page (${TAILOR_RESUME_SHORTCUT_ARIA_LABEL})`}
              type="button"
              onClick={handleTailorCurrentPage}
            >
              <span className="tailor-action-label">
                {isTailorPreparationPending
                  ? "Checking..."
                  : captureState === "running"
                    ? "Tailoring..."
                    : "Tailor Current Page"}
              </span>
              {showTopLevelTailoredWebAction ? null : (
                <span
                  aria-label={TAILOR_RESUME_SHORTCUT_ARIA_LABEL}
                  className="tailor-action-shortcut"
                >
                  {TAILOR_RESUME_SHORTCUT_KEYS.map((key) => (
                    <kbd className="tailor-shortcut-key" key={key}>
                      {key}
                    </kbd>
                  ))}
                </span>
              )}
            </button>
            {showTopLevelTailoredWebAction ? (
              <button
                className="secondary-action compact-action top-web-action"
                aria-label="Open tailored resume on web"
                disabled={dashboardOpenActionState === "running"}
                type="button"
                onClick={() =>
                  void handleOpenTailoredResumeOnWeb(topLevelTailoredResumeId)
                }
              >
                <span>Web</span>
                <ArrowUpRightIcon />
              </button>
            ) : null}
          </div>

          {renderSelectedTailoredResumeLibrarySurface()}

          {tailorInterview && isTailorInterviewOpen ? (
            <section
              className="snapshot-card interview-card"
              ref={tailorInterviewCardRef}
            >
              <div className="card-heading-row">
                <h2>Resume questions</h2>
                {tailorInterview.questioningSummary ? (
                  <span>
                    Question {tailorInterview.questioningSummary.askedQuestionCount}
                  </span>
                ) : null}
              </div>

              {tailorInterview.questioningSummary?.agenda ? (
                <p className="interview-agenda">
                  {tailorInterview.questioningSummary.agenda}
                </p>
              ) : null}

              <div className="interview-thread" aria-live="polite">
                {displayedTailorInterviewConversation.map((message) => (
                  <div
                    className={`interview-message interview-message-${message.role}`}
                    key={message.id}
                  >
                    <TailorInterviewMessageContent
                      message={message}
                    />
                  </div>
                ))}
                {shouldShowTailorInterviewThinkingIndicator ? (
                  <div className="interview-message interview-message-assistant interview-message-thinking">
                    <TailorInterviewThinkingIndicator />
                  </div>
                ) : null}
                <div ref={tailorInterviewMessagesEndRef} />
              </div>

              {tailorInterviewError ? (
                <p className="interview-error">{tailorInterviewError}</p>
              ) : null}

              <textarea
                className="interview-input"
                disabled={isStoppingCurrentTailoring}
                onChange={(event) =>
                  setDraftTailorInterviewAnswer(event.target.value)
                }
                onKeyDown={handleTailorInterviewAnswerKeyDown}
                placeholder={
                  isTailorInterviewAwaitingCompletion
                    ? "Anything else you want to clarify before we finish?"
                    : "Answer the current question..."
                }
                ref={tailorInterviewInputRef}
                value={draftTailorInterviewAnswer}
              />

              <div
                className={`interview-actions ${
                  isTailorInterviewAwaitingCompletion
                    ? "interview-actions-with-done"
                    : ""
                }`}
              >
                <button
                  className="secondary-action compact-action"
                  disabled={isStoppingCurrentTailoring}
                  type="button"
                  onClick={() => void cancelTailorInterview()}
                >
                  {isStoppingCurrentTailoring ? "Stopping..." : "Stop run"}
                </button>
                {isTailorInterviewAwaitingCompletion ? (
                  <button
                    className="primary-action compact-action"
                    disabled={isTailorInterviewBusy || isFinishingTailorInterview}
                    type="button"
                    onClick={() => void completeTailorInterview()}
                  >
                    {isFinishingTailorInterview ? "Finishing..." : "Done"}
                  </button>
                ) : null}
                <button
                  className="primary-action compact-action"
                  disabled={
                    isTailorInterviewBusy ||
                    draftTailorInterviewAnswer.trim().length === 0
                  }
                  type="button"
                  onClick={() => void submitTailorInterviewAnswer()}
                >
                  {isTailorInterviewThinking
                    ? "Thinking..."
                    : isTailorInterviewAwaitingCompletion
                      ? "Send clarification"
                      : "Send answer"}
                </button>
              </div>

              {captureState === "finishing" && tailorGenerationStep ? (
                <p className="interview-progress">
                  {buildLiveTailorResumeStatusMessage(
                    tailorGenerationStep,
                    "Finishing the tailored resume",
                  )}
                  {tailorGenerationStep.detail
                    ? ` ${tailorGenerationStep.detail}`
                    : ""}
                </p>
              ) : null}
            </section>
          ) : null}

          {tailorInterview && isTailorInterviewFinishPromptOpen ? (
            <div className="tailor-interview-finish-overlay" role="presentation">
              <section
                aria-modal="true"
                className="tailor-interview-finish-dialog"
                role="dialog"
              >
                <p className="eyebrow">Tailor Resume Keywords</p>
                <h2>Ready to start?</h2>
                <p className="tailor-interview-finish-copy">
                  Review the keyword buckets, then press play to start tailoring.
                </p>
                <div className="tailor-interview-finish-actions">
                  <button
                    className="secondary-action compact-action"
                    disabled={isFinishingTailorInterview}
                    type="button"
                    onClick={dismissTailorInterviewFinishPrompt}
                  >
                    Keep reviewing
                  </button>
                  <button
                    className="primary-action compact-action"
                    disabled={isFinishingTailorInterview}
                    type="button"
                    onClick={() => void completeTailorInterview()}
                  >
                    {isFinishingTailorInterview ? "Starting..." : "Play"}
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {shouldShowTailorAuthPrompt ? (
            <div className="tailor-auth-overlay" role="presentation">
              <section
                aria-labelledby="tailor-auth-title"
                aria-modal="true"
                className="tailor-auth-dialog"
                role="dialog"
              >
                <h2 id="tailor-auth-title">You&apos;re not connected</h2>
                <button
                  className="primary-action tailor-auth-connect-action"
                  disabled={authActionState === "running"}
                  type="button"
                  onClick={() => void handleSignIn()}
                >
                  <span
                    aria-hidden="true"
                    className="tailor-auth-connect-mark"
                  >
                    G
                  </span>
                  <span>
                    {authActionState === "running"
                      ? "Signing in..."
                      : "Sign in with Google"}
                  </span>
                </button>
              </section>
            </div>
          ) : null}
        </>
      ) : activePanelTab === "settings" ? (
        renderSettingsSurface()
      ) : activePanelTab === "applications" ? (
        shouldRenderApplicationsEmptySurface ? (
          <DocumentEmptySurface
            count={personalInfo?.applicationCount ?? 0}
            message="No tracked applications yet."
            title="Tracked apps"
          />
        ) : (
          <section className="applications-surface">
            <div className="card-heading-row">
              <h2>Tracked apps</h2>
              <span>{personalInfo?.applicationCount ?? 0}</span>
            </div>
            {renderApplicationsSurface()}
          </section>
        )
      ) : (
        <section className="snapshot-card">
          <div className="card-heading-row">
            <h2>Page identity</h2>
            <span>{debugStatusLabel}</span>
          </div>
          <dl className="snapshot-grid">
            <div>
              <dt>URL</dt>
              <dd className="wrap-anywhere">{debugPageIdentityDisplay}</dd>
            </div>
          </dl>
        </section>
      )}
      {pendingPersonalDelete ? (
        <div
          className="personal-delete-overlay"
          role="presentation"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !isDeletingPersonalItem
            ) {
              setPendingPersonalDelete(null);
              setPersonalDeleteError(null);
            }
          }}
        >
          <section
            aria-describedby="personal-delete-description"
            aria-labelledby="personal-delete-title"
            aria-modal="true"
            className="personal-delete-dialog"
            role="dialog"
          >
            <p className="eyebrow">{pendingPersonalDeleteEyebrow}</p>
            <h2 id="personal-delete-title">{pendingPersonalDeleteTitle}</h2>
            <p
              className="personal-delete-copy"
              id="personal-delete-description"
            >
              {pendingPersonalDeleteDescription}
            </p>
            {personalDeleteError ? (
              <p className="personal-delete-error">{personalDeleteError}</p>
            ) : null}
            <div className="personal-delete-actions">
              <button
                className="secondary-action compact-action"
                disabled={isDeletingPersonalItem}
                type="button"
                onClick={() => {
                  setPendingPersonalDelete(null);
                  setPersonalDeleteError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="danger-action compact-action"
                disabled={isDeletingPersonalItem || !pendingPersonalDeleteImpact}
                type="button"
                onClick={() => void deletePendingPersonalItem()}
              >
                {isDeletingPersonalItem
                  ? "Deleting..."
                  : pendingPersonalDeleteActionLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isDeleteAllTailoredResumesPromptOpen ? (
        <div
          className="personal-delete-overlay"
          role="presentation"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !isDeletingAllTailoredResumes
            ) {
              setIsDeleteAllTailoredResumesPromptOpen(false);
            }
          }}
        >
          <section
            aria-describedby="tailored-resume-delete-all-description"
            aria-labelledby="tailored-resume-delete-all-title"
            aria-modal="true"
            className="personal-delete-dialog"
            role="dialog"
          >
            <p className="eyebrow">Delete saved resumes</p>
            <h2 id="tailored-resume-delete-all-title">
              Delete{" "}
              {unarchivedTailorDeleteCount} tailored{" "}
              {unarchivedTailorDeleteCount === 1 ? "resume" : "resumes"}
              ?
            </h2>
            <p
              className="personal-delete-copy"
              id="tailored-resume-delete-all-description"
            >
              This stops active tailoring runs, then removes every unarchived
              tailored resume and its PDF preview from History. This action
              can&apos;t be undone.
            </p>
            <div className="personal-delete-actions">
              <button
                className="secondary-action compact-action"
                disabled={isDeletingAllTailoredResumes}
                type="button"
                onClick={() => setIsDeleteAllTailoredResumesPromptOpen(false)}
              >
                Cancel
              </button>
              <button
                className="danger-action compact-action"
                disabled={
                  isDeletingAllTailoredResumes ||
                  unarchivedTailorDeleteCount === 0
                }
                type="button"
                onClick={() => void deleteAllTailoredResumes()}
              >
                {isDeletingAllTailoredResumes
                  ? "Deleting..."
                  : `Delete ${unarchivedTailorDeleteCount}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <div className={`chat-dock ${isChatOpen ? "chat-dock-open" : ""}`}>
          {isChatOpen ? (
            <section className="chat-panel" aria-label="Resume support chat">
              <header className="chat-header">
                <div className="chat-title-group">
                  <p>Resume Chat</p>
                  <span title={chatPageLabel}>{chatPageLabel}</span>
                </div>
                <div className="chat-header-actions">
                  <button
                    aria-label="Delete resume chat"
                    className="icon-action"
                    disabled={!canDeleteChat}
                    title="Delete resume chat"
                    type="button"
                    onClick={() => void handleDeleteChat()}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    aria-label="Compact resume chat"
                    className="icon-action"
                    disabled={!canCompactChat}
                    title="Keep the 10 most recent chat messages"
                    type="button"
                    onClick={() => void handleCompactChat()}
                  >
                    <CompactChatIcon />
                  </button>
                  <button
                    aria-label="Close chat"
                    className="icon-action"
                    type="button"
                    onClick={() => setIsChatOpen(false)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </header>

              <div className="chat-tip-slot">
                {!extensionPreferences.supportChatTipDismissed ? (
                  <div className="chat-tip">
                    <span>
                      This chat can save skills-section support, fetch resume
                      experiences, and read your current LaTeX resume.
                    </span>
                    <button
                      aria-label="Dismiss resume chat tip"
                      className="chat-tip-dismiss"
                      title="Dismiss tip"
                      type="button"
                      onClick={() => void dismissSupportChatTip()}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="chat-messages" aria-live="polite">
                {authState.status !== "signedIn" ? (
                  <p className="chat-placeholder">
                    Connect Google to start chatting.
                  </p>
                ) : chatStatus === "loading" ? (
                  <p className="chat-placeholder">Loading chat...</p>
                ) : chatStatus === "error" && chatMessages.length === 0 ? (
                  <p className="chat-placeholder">{chatError}</p>
                ) : chatMessages.length === 0 ? (
                  <p className="chat-placeholder">
                    Ask me to add a skills-section keyword, draft reusable
                    resume bullet support, or inspect the current resume.
                  </p>
                ) : (
                  chatMessages.map((message, index) => (
                    <article
                      key={message.id}
                      className={`chat-message chat-message-${message.role} ${
                        chatSendStatus === "streaming" &&
                        message.role === "assistant" &&
                        message.content.length === 0 &&
                        index === chatMessages.length - 1
                          ? "chat-message-thinking"
                          : ""
                      }`.trim()}
                    >
                      <div className="chat-message-role">
                        {message.role === "assistant" ? "Job Helper" : "You"}
                      </div>
                      <ChatMessageMarkdown
                        content={message.content}
                        isThinking={
                          chatSendStatus === "streaming" &&
                          message.role === "assistant" &&
                          message.content.length === 0 &&
                          index === chatMessages.length - 1
                        }
                        toolCalls={message.toolCalls}
                      />
                    </article>
                  ))
                )}
                {chatError && chatMessages.length > 0 ? (
                  <p className="chat-inline-error">{chatError}</p>
                ) : null}
                <div ref={chatMessagesEndRef} />
              </div>

              <form className="chat-form" onSubmit={handleChatFormSubmit}>
                <textarea
                  aria-label="Message Job Helper"
                  disabled={authState.status !== "signedIn"}
                  placeholder="Ask about your resume support"
                  ref={chatInputRef}
                  rows={2}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={handleChatInputKeyDown}
                />
                <button
                  aria-label="Send message"
                  className="chat-send-action"
                  disabled={!canSendChat}
                  type="submit"
                >
                  <SendIcon />
                </button>
              </form>
            </section>
          ) : (
            <button
              aria-label="Open resume chat"
              className="chat-launcher"
              title="Open resume chat"
              type="button"
              onClick={handleOpenChat}
            >
              <ChatBubbleIcon />
            </button>
          )}
      </div>
    </main>
  );
}

export default App;
