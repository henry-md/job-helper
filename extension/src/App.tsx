import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
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
import "./App.css";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailorResumePreparationMessage,
  buildTailorResumePreparationState,
  buildTailorResumeApplicationContext,
  buildTailoredResumeReviewUrl,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_JOB_APPLICATIONS_ENDPOINT,
  DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  EXTENSION_DEBUG_UI_ENABLED,
  EXISTING_TAILORING_STORAGE_KEY,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_PREPARATIONS_STORAGE_KEY,
  TAILORING_PROMPTS_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  type PersonalInfoSummary,
  type UserMarkdownSummary,
  defaultUserMarkdown,
  readPersonalInfoPayload,
  readTailorResumePreparationState,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeExistingTailoringState,
  readTailorResumeGenerationStepSummary,
  readTailorResumeProfileSummary,
  type TailorResumeExistingTailoringState,
  type TailorResumeConversationMessage,
  type TailorResumeGenerationStepSummary,
  type TailorResumeApplicationContext,
  type TailorResumePreparationState,
  type TailorResumePendingInterviewSummary,
  type TailorResumeRunRecord,
  type TailoredResumeSummary,
  type TrackedApplicationSummary,
} from "./job-helper";
import { collectPageContextFromTab } from "./page-context";
import TailoredResumeQuickReview from "./tailored-resume-quick-review";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
} from "./tailor-resume-stream";
import {
  buildTailorRunIdentityDisplay,
  readTailorRunDisplayUrl,
} from "./tailor-run-identity";
import {
  resolveDisplayedTailorRunIdentity,
  shouldRenderTailorRunShell,
} from "./tailor-run-display";
import { buildCompletedTailoringMessage } from "./tailor-run-copy";
import {
  buildTailorResumeLiveStatusMessage as buildLiveTailorResumeStatusMessage,
  formatTailorResumeProgressStepLabel,
  formatTailorResumeProgressStatusLabel,
  readTailorResumeProgressAttemptBadgeLabel,
  readTailorResumeDisplayAttempt,
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
import { buildTailoringRunsRefreshKey } from "./tailor-run-refresh";
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
  isTailoredResumeArchived,
  splitTailoredResumesByArchiveState,
} from "../../lib/tailored-resume-archive-state.ts";

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

type PanelTab = "applications" | "archived" | "debug" | "tailor";

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
  deleteTarget: TailorRunDeleteTarget | null;
  existingTailoringId: string | null;
  id: string;
  isCurrentPage: boolean;
  pageKey: string | null;
  sortTime: number;
  statusDisplayState: "loading" | "ready" | "warning";
  step: TailorRunProgressStep;
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
  const message =
    error instanceof Error ? error.message : "Failed to read the active page.";

  if (message.includes("Receiving end does not exist")) {
    return "Open a regular job page to inspect it here.";
  }

  return message;
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

function buildTailoredResumePreviewUrl(input: {
  pdfUpdatedAt?: string | null;
  tailoredResumeId: string;
}) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);
  url.searchParams.set("tailoredResumeId", input.tailoredResumeId);

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

function readStringPayloadValue(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
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
  capturedAt?: string;
  companyName: string | null;
  generationStep?: TailorResumeGenerationStepSummary | null;
  jobIdentifier?: string | null;
  message: string;
  pageContext: JobPageContext | null;
  positionTitle: string | null;
  status: TailorResumeRunRecord["status"];
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
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    companyName,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: input.generationStep ?? null,
    jobIdentifier: input.jobIdentifier || null,
    message: input.message,
    pageTitle: input.pageContext?.title || null,
    pageUrl: input.pageContext?.url || null,
    positionTitle,
    status: input.status,
    tailoredResumeError: input.tailoredResumeError ?? null,
    tailoredResumeId: input.tailoredResumeId ?? null,
  } satisfies TailorResumeRunRecord;
}

function isTransientTailoringRun(run: TailorResumeRunRecord | null) {
  return run?.status === "running" || run?.status === "needs_input";
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

function sameTailoringJobUrl(left: string | null, right: string | null) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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

  if (input.existingTailoring.kind === "pending_interview") {
    return {
      capturedAt: input.existingTailoring.updatedAt,
      companyName: input.existingTailoring.companyName,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      jobIdentifier,
      message: "Resume questions are waiting in the side panel.",
      pageTitle,
      pageUrl,
      positionTitle: input.existingTailoring.positionTitle,
      status: "needs_input",
      tailoredResumeError: null,
      tailoredResumeId: null,
    } satisfies TailorResumeRunRecord;
  }

  if (input.existingTailoring.kind === "completed") {
    return {
      capturedAt: input.existingTailoring.updatedAt,
      companyName: input.existingTailoring.companyName,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      jobIdentifier,
      message: buildCompletedTailoringMessage({
        jobLabel: input.existingTailoring.displayName,
        tailoredResumeError: input.existingTailoring.error,
      }),
      pageTitle,
      pageUrl,
      positionTitle: input.existingTailoring.positionTitle,
      status: input.existingTailoring.error ? "error" : "success",
      tailoredResumeError: input.existingTailoring.error,
      tailoredResumeId: input.existingTailoring.tailoredResumeId,
    } satisfies TailorResumeRunRecord;
  }

  const generationStep = input.existingTailoring.lastStep ?? null;

  return {
    capturedAt: input.existingTailoring.updatedAt,
    companyName:
      input.existingTailoring.companyName ??
      (reusePreviousPageMetadata ? input.previousRun?.companyName ?? null : null),
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep,
    jobIdentifier,
    message: buildLiveTailorResumeStatusMessage(
      generationStep,
      "Tailoring your resume for this job...",
    ),
    pageTitle,
    pageUrl,
    positionTitle:
      input.existingTailoring.positionTitle ??
      (reusePreviousPageMetadata ? input.previousRun?.positionTitle ?? null : null),
    status: "running",
    tailoredResumeError: null,
    tailoredResumeId: null,
  } satisfies TailorResumeRunRecord;
}

function areTailoringRunRecordsEqual(
  left: TailorResumeRunRecord | null,
  right: TailorResumeRunRecord | null,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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
    label: "Plan targeted edits",
    shortLabel: "Plan",
    stepNumber: 1,
  },
  {
    label: "Clarify missing details",
    shortLabel: "Clarify",
    stepNumber: 2,
  },
  {
    label: "Apply resume changes",
    shortLabel: "Edit",
    stepNumber: 3,
  },
  {
    label: "Keep the original page count",
    shortLabel: "Fit",
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
    if (step.stepNumber === 1) {
      return { ...step, status: "succeeded" as const };
    }

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

  return createTailorRunProgressSteps().map((candidate) => {
    if (candidate.stepNumber < step.stepNumber) {
      return { ...candidate, status: "succeeded" as const };
    }

    if (candidate.stepNumber > step.stepNumber) {
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
    input.lastTailoringRun.generationStep
  ) {
    return buildTailorRunProgressStepsFromGenerationStep(
      input.lastTailoringRun.generationStep,
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

function readExistingTailoringSortTime(
  existingTailoring: TailorResumeExistingTailoringState,
) {
  const createdAtTimestamp = Date.parse(existingTailoring.createdAt);

  if (Number.isFinite(createdAtTimestamp)) {
    return createdAtTimestamp;
  }

  return readActiveTailorRunSortTime(existingTailoring.updatedAt);
}

function buildTailorRunDeleteTarget(input: TailorRunDeleteTarget) {
  return input.jobUrl || input.tailoredResumeId || input.tailorRunId ? input : null;
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
  if (input.run.status !== "running" && input.run.status !== "needs_input") {
    return null;
  }

  const url = input.run.pageUrl ?? input.titleFallback?.url ?? null;

  return {
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: input.run.tailoredResumeId ?? null,
      tailorRunId: null,
    }),
    existingTailoringId: null,
    id: input.id,
    isCurrentPage: input.isCurrentPage ?? false,
    pageKey: input.pageKey ?? null,
    sortTime: readActiveTailorRunSortTime(input.run.capturedAt),
    statusDisplayState:
      input.run.status === "needs_input" ? "ready" : "loading",
    step: readActiveTailorRunStep({
      captureState: readCaptureStateFromTailoringRun(input.run) ?? "idle",
      existingTailoring: null,
      lastTailoringRun: input.run,
      tailorGenerationStep: input.run.generationStep ?? null,
      tailorInterview: null,
    }),
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

  return {
    ...nextCard,
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: null,
      tailorRunId: input.existingTailoring.id,
    }),
    existingTailoringId: input.existingTailoring.id,
    sortTime: readExistingTailoringSortTime(input.existingTailoring),
    statusDisplayState:
      input.statusDisplayState ??
      (input.existingTailoring.kind === "pending_interview" ? "ready" : "loading"),
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

  return {
    deleteTarget: buildTailorRunDeleteTarget({
      jobUrl: url,
      tailoredResumeId: null,
      tailorRunId: null,
    }),
    existingTailoringId: null,
    id: input.id,
    isCurrentPage: input.isCurrentPage ?? false,
    pageKey: input.pageKey ?? null,
    sortTime: readActiveTailorRunSortTime(input.preparation.capturedAt),
    statusDisplayState: "loading",
    step: readActiveTailorRunStep({
      captureState: "running",
      existingTailoring: null,
      lastTailoringRun: input.run,
      tailorGenerationStep: input.run?.generationStep ?? null,
      tailorInterview: null,
    }),
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

  if (input.hasCurrentPageCompletedTailoring) {
    return null;
  }

  if (isTransientTailoringRun(input.currentPageStoredTailoringRun)) {
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
};

type ChatStatus = "error" | "idle" | "loading" | "ready";
type ChatSendStatus = "idle" | "streaming";
type TailorRunDetailView = "preview" | "quickReview";
type TailorRunMenuActionState =
  | "archiving"
  | "deleting"
  | "goingToTab"
  | "idle"
  | "regenerating";
type TailoredResumeMenuActionState = "goingToTab" | "idle";

type ExistingTailoringPromptState = {
  actionState: "idle" | "overwriting";
  existingTailoring: TailorResumeExistingTailoringState;
  jobDescription: string;
  jobUrl: string | null;
  pageContext: JobPageContext;
};

type ActiveTailoringOverrideState = "idle" | "overwriting";
type TailorStorageRegistry<T> = Record<string, T>;

function readCaptureStateFromTailoringRun(
  run: TailorResumeRunRecord | null,
): CaptureState | null {
  if (!run) {
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
    capturedAt,
    companyName:
      typeof value.companyName === "string" ? value.companyName : null,
    endpoint:
      typeof value.endpoint === "string"
        ? value.endpoint
        : DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: readTailorResumeGenerationStepSummary(value.generationStep),
    jobIdentifier:
      typeof value.jobIdentifier === "string" ? value.jobIdentifier : null,
    message,
    pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : null,
    pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : null,
    positionTitle:
      typeof value.positionTitle === "string" ? value.positionTitle : null,
    status,
    tailoredResumeError:
      typeof value.tailoredResumeError === "string"
        ? value.tailoredResumeError
        : null,
    tailoredResumeId:
      typeof value.tailoredResumeId === "string" ? value.tailoredResumeId : null,
  };
}

function readStoredTailoringRunRegistry(value: unknown) {
  if (!isRecord(value)) {
    return {} as TailorStorageRegistry<TailorResumeRunRecord>;
  }

  const entries = Object.entries(value)
    .map(([key, candidate]) => {
      const run = readStoredTailoringRunRecord(candidate);
      return run ? ([key, run] as const) : null;
    })
    .filter(
      (
        entry,
      ): entry is readonly [string, TailorResumeRunRecord] => Boolean(entry),
    );

  return Object.fromEntries(entries) as TailorStorageRegistry<TailorResumeRunRecord>;
}

function readStoredTailorPreparationRegistry(value: unknown) {
  if (!isRecord(value)) {
    return {} as TailorStorageRegistry<TailorResumePreparationState>;
  }

  const entries = Object.entries(value)
    .map(([key, candidate]) => {
      const preparationState = readTailorResumePreparationState(candidate);
      return preparationState ? ([key, preparationState] as const) : null;
    })
    .filter(
      (
        entry,
      ): entry is readonly [string, TailorResumePreparationState] =>
        Boolean(entry),
    );

  return Object.fromEntries(entries) as TailorStorageRegistry<TailorResumePreparationState>;
}

function readStoredExistingTailoringPromptRegistry(value: unknown) {
  if (!isRecord(value)) {
    return {} as TailorStorageRegistry<ExistingTailoringPromptState>;
  }

  const entries = Object.entries(value)
    .map(([key, candidate]) => {
      const prompt = readStoredExistingTailoringPrompt(candidate);
      return prompt ? ([key, prompt] as const) : null;
    })
    .filter(
      (
        entry,
      ): entry is readonly [string, ExistingTailoringPromptState] =>
        Boolean(entry),
    );

  return Object.fromEntries(entries) as TailorStorageRegistry<ExistingTailoringPromptState>;
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

function buildChatHistoryUrl(pageUrl: string) {
  const url = new URL(DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT);
  url.searchParams.set("url", pageUrl);
  return url.toString();
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

function ArchiveTrayDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7.25h14v3.1c0 .9-.72 1.65-1.62 1.65H6.62C5.72 12 5 11.25 5 10.35v-3.1Z" />
      <path d="M6.8 12v5.25c0 .97.78 1.75 1.75 1.75h6.9c.97 0 1.75-.78 1.75-1.75V12" />
      <path d="M12 9v5" />
      <path d="m9.8 11.8 2.2 2.2 2.2-2.2" />
    </svg>
  );
}

function ArchiveTrayUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7.25h14v3.1c0 .9-.72 1.65-1.62 1.65H6.62C5.72 12 5 11.25 5 10.35v-3.1Z" />
      <path d="M6.8 12v5.25c0 .97.78 1.75 1.75 1.75h6.9c.97 0 1.75-.78 1.75-1.75V12" />
      <path d="M12 14V9" />
      <path d="m9.8 11.2 2.2-2.2 2.2 2.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 12a7.5 7.5 0 0 1 .165-1.575L3.323 9.393a.75.75 0 0 1-.165-.982l1.5-2.598a.75.75 0 0 1 .92-.33l1.581.638A7.5 7.5 0 0 1 9 4.935l.24-1.677a.75.75 0 0 1 .742-.633h3.036a.75.75 0 0 1 .742.633L14 4.935a7.5 7.5 0 0 1 1.84 1.186l1.581-.638a.75.75 0 0 1 .92.33l1.5 2.598a.75.75 0 0 1-.165.982l-1.342 1.032c.11.514.165 1.041.165 1.575s-.055 1.061-.165 1.575l1.342 1.032a.75.75 0 0 1 .165.982l-1.5 2.598a.75.75 0 0 1-.92.33l-1.581-.638A7.5 7.5 0 0 1 14 19.065l-.24 1.677a.75.75 0 0 1-.742.633H9.982a.75.75 0 0 1-.742-.633L9 19.065a7.5 7.5 0 0 1-1.84-1.186l-1.581.638a.75.75 0 0 1-.92-.33l-1.5-2.598a.75.75 0 0 1 .165-.982l1.342-1.032A7.5 7.5 0 0 1 4.5 12Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
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

function ToolCallDetails({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <details className="toolcall-details">
      <summary>See toolcalls ({toolCalls.length})</summary>
      <div className="toolcall-details-body">
        {toolCalls.map((toolCall, index) => (
          <div
            className="toolcall-entry"
            key={`${toolCall.name}:${String(index)}`}
          >
            <p className="toolcall-name">{toolCall.name}</p>
            <pre>{toolCall.argumentsText}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function ChatMessageMarkdown({
  content,
  toolCalls,
}: {
  content: string;
  toolCalls: ToolCallRecord[];
}) {
  return (
    <>
      <div className="chat-message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content || "Thinking..."}
        </ReactMarkdown>
      </div>
      <ToolCallDetails toolCalls={toolCalls} />
    </>
  );
}

function App() {
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("tailor");
  const [isSettingsViewOpen, setIsSettingsViewOpen] = useState(() =>
    readDebugPreviewFlag("settings"),
  );
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionState, setAuthActionState] =
    useState<AuthActionState>("idle");
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
      updatedAt: null,
    });
  const [draftSettingsUserMarkdown, setDraftSettingsUserMarkdown] = useState(
    defaultUserMarkdown,
  );
  const [isSettingsOriginalResumeOpen, setIsSettingsOriginalResumeOpen] =
    useState(false);
  const [isSettingsUserMarkdownOpen, setIsSettingsUserMarkdownOpen] =
    useState(false);
  const [isSavingSettingsUserMarkdown, setIsSavingSettingsUserMarkdown] =
    useState(false);
  const [settingsUserMarkdownError, setSettingsUserMarkdownError] =
    useState<string | null>(null);
  const [tailoredResumePreviewState, setTailoredResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [tailoredResumeReviewState, setTailoredResumeReviewState] =
    useState<TailoredResumeReviewState>({ record: null, status: "idle" });
  const [pendingTailoredResumeReviewEditId, setPendingTailoredResumeReviewEditId] =
    useState<string | null>(null);
  const [activeTailorRunDetailView, setActiveTailorRunDetailView] =
    useState<TailorRunDetailView | null>(null);
  const [isTailorRunMenuOpen, setIsTailorRunMenuOpen] = useState(false);
  const [tailorRunMenuActionState, setTailorRunMenuActionState] =
    useState<TailorRunMenuActionState>("idle");
  const [tailorRunMenuError, setTailorRunMenuError] = useState<string | null>(
    null,
  );
  const [backgroundTailorRunMenuId, setBackgroundTailorRunMenuId] =
    useState<string | null>(null);
  const [backgroundTailorRunMenuActionState, setBackgroundTailorRunMenuActionState] =
    useState<"deleting" | "goingToTab" | "idle" | "stopping">("idle");
  const [backgroundTailorRunMenuActionCardId, setBackgroundTailorRunMenuActionCardId] =
    useState<string | null>(null);
  const [backgroundTailorRunMenuError, setBackgroundTailorRunMenuError] =
    useState<string | null>(null);
  const [backgroundTailorRunMenuErrorCardId, setBackgroundTailorRunMenuErrorCardId] =
    useState<string | null>(null);
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
  const [tailoredResumeArchiveActionId, setTailoredResumeArchiveActionId] =
    useState<string | null>(null);
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
  const [lastTailoringRun, setLastTailoringRun] =
    useState<TailorResumeRunRecord | null>(null);
  const [tailorGenerationStep, setTailorGenerationStep] =
    useState<TailorResumeGenerationStepSummary | null>(null);
  const [tailorInterview, setTailorInterview] =
    useState<TailorResumePendingInterviewSummary | null>(null);
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
  const [chatPageUrl, setChatPageUrl] = useState<string | null>(null);
  const chatHistoryRequestIdRef = useRef(0);
  const tailorInterviewMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const tailorInterviewCardRef = useRef<HTMLElement | null>(null);
  const tailorInterviewInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const tailorRunMenuRef = useRef<HTMLDivElement | null>(null);
  const backgroundTailorRunMenuRef = useRef<HTMLDivElement | null>(null);
  const tailoredResumeMenuRef = useRef<HTMLDivElement | null>(null);
  const tailoredResumeMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const lastReadyPersonalInfoRef = useRef<PersonalInfoSummary | null>(null);
  const lastSeenSyncStateRef = useRef<UserSyncStateSnapshot | null>(null);
  const isSyncRefreshInFlightRef = useRef(false);
  const isSyncStateCheckInFlightRef = useRef(false);
  const lastSeenTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const dismissedTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const activeTailorRequestAbortControllerRef =
    useRef<AbortController | null>(null);
  const availablePanelTabs = [
    { id: "tailor" as const, label: "Tailor", title: "Tailor Resume" },
    { id: "archived" as const, label: "Archived", title: "Archived Resumes" },
    { id: "applications" as const, label: "Applications", title: "Applications" },
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

  const loadCachedPersonalInfo = useCallback(async (userId: string) => {
    try {
      const result = await chrome.storage.local.get(PERSONAL_INFO_CACHE_STORAGE_KEY);
      const cacheEntry = readPersonalInfoCacheEntry(
        result[PERSONAL_INFO_CACHE_STORAGE_KEY],
      );

      if (!cacheEntry || cacheEntry.userId !== userId) {
        return false;
      }

      setPersonalInfoState({
        personalInfo: cacheEntry.personalInfo,
        status: "ready",
      });
      return true;
    } catch (error) {
      console.error("Could not load the shared personal info cache.", error);
      return false;
    }
  }, []);

  const applyAuthoritativePersonalInfo = useCallback(
    (nextPersonalInfo: PersonalInfoSummary) => {
      setPersonalInfoState({
        personalInfo: nextPersonalInfo,
        status: "ready",
      });

      if (authState.status === "signedIn") {
        void persistPersonalInfoCacheEntry(
          nextPersonalInfo,
          authState.session.user.id,
        );
      }
    },
    [authState],
  );

  const loadPersonalInfo = useCallback(
    async (options: { preserveCurrent?: boolean } = {}) => {
      if (!options.preserveCurrent) {
        setPersonalInfoState({ personalInfo: null, status: "loading" });
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: "JOB_HELPER_PERSONAL_INFO",
        });

        if (!isRecord(response) || response.ok !== true) {
          throw new Error(
            readErrorMessage(response, "Could not load your Job Helper info."),
          );
        }

        const nextPersonalInfo = readPersonalInfoPayload(response);
        lastSeenSyncStateRef.current = nextPersonalInfo.syncState;

        setPersonalInfoState({
          personalInfo: nextPersonalInfo,
          status: "ready",
        });
        if (authState.status === "signedIn") {
          void persistPersonalInfoCacheEntry(
            nextPersonalInfo,
            authState.session.user.id,
          );
        }
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
    [authState],
  );

  const loadTailorStorageRegistries = useCallback(async () => {
    try {
      const result = await chrome.storage.local.get([
        TAILORING_RUNS_STORAGE_KEY,
        TAILORING_PREPARATIONS_STORAGE_KEY,
        TAILORING_PROMPTS_STORAGE_KEY,
      ]);

      setTailoringRunsByKey(
        readStoredTailoringRunRegistry(result[TAILORING_RUNS_STORAGE_KEY]),
      );
      setTailorPreparationsByKey(
        readStoredTailorPreparationRegistry(
          result[TAILORING_PREPARATIONS_STORAGE_KEY],
        ),
      );
      setExistingTailoringPromptsByKey(
        readStoredExistingTailoringPromptRegistry(
          result[TAILORING_PROMPTS_STORAGE_KEY],
        ),
      );
    } catch (error) {
      console.error("Could not reload the Tailor Resume storage state.", error);
    }
  }, []);

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
    const menuWidth = 176;
    const viewportPadding = 12;
    const nextLeft = Math.min(
      Math.max(viewportPadding, anchorRect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );
    const nextTop = Math.max(viewportPadding, anchorRect.bottom + 8);

    setTailoredResumeMenuPosition({
      left: nextLeft,
      top: nextTop,
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

      setLastTailoringRun(record);

      if (!pageKey) {
        return;
      }

      try {
        const result = await chrome.storage.local.get(TAILORING_RUNS_STORAGE_KEY);
        const registry = isRecord(result[TAILORING_RUNS_STORAGE_KEY])
          ? {
              ...result[TAILORING_RUNS_STORAGE_KEY],
            }
          : {};

        setTailoringRunsByKey((currentRegistry) => {
          const nextRegistry = { ...currentRegistry };

          if (record) {
            nextRegistry[pageKey] = record;
          } else {
            delete nextRegistry[pageKey];
          }

          return nextRegistry;
        });

        if (record) {
          registry[pageKey] = record;
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
    async (pageUrl: string, sessionToken: string) => {
      const requestId = chatHistoryRequestIdRef.current + 1;
      chatHistoryRequestIdRef.current = requestId;
      setChatPageUrl(pageUrl);
      setChatMessages([]);
      setChatStatus("loading");
      setChatError(null);

      try {
        const response = await fetch(buildChatHistoryUrl(pageUrl), {
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
  const displayedApplications = personalInfo?.applications.slice(0, 12) ?? [];
  const pendingPersonalDeleteImpact = buildPendingPersonalDeleteImpact({
    applications: personalInfo?.applications ?? [],
    pendingDelete: pendingPersonalDelete,
    tailoredResumes: personalInfo?.tailoredResumes ?? [],
  });
  const isDeletingPersonalItem = personalDeleteActionState === "deleting";
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
  const currentPageRegistryKey =
    readTailorRunRegistryKeyFromPageContext(currentPageContext);
  const currentPageStoredTailoringRun =
    currentPageRegistryKey ? tailoringRunsByKey[currentPageRegistryKey] ?? null : null;
  const currentPageTailorPreparationState =
    currentPageRegistryKey
      ? tailorPreparationsByKey[currentPageRegistryKey] ?? null
      : null;
  const currentPageExistingTailoringPrompt =
    currentPageRegistryKey
      ? existingTailoringPromptsByKey[currentPageRegistryKey] ?? null
      : null;
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
  const currentPageUrl = readJobPageIdentity(currentPageContext);
  const currentPageApplicationContext = currentPageContext
    ? buildTailorResumeApplicationContext(currentPageContext)
    : null;
  const { archived: archivedTailoredResumes, unarchived: unarchivedTailoredResumes } =
    splitTailoredResumesByArchiveState(personalInfo?.tailoredResumes ?? []);
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
        currentPageRegistryKey,
      ],
      tailoredResumes: unarchivedTailoredResumes,
    }) ??
    (currentPageCompletedTailoring?.kind === "completed"
      ? unarchivedTailoredResumes.find(
          (tailoredResume) =>
            tailoredResume.id === currentPageCompletedTailoring.tailoredResumeId,
        ) ?? null
      : null);
  const hasCurrentPageCompletedTailoring =
    Boolean(currentPageCompletedTailoredResume);
  const currentActiveTailorRunCard = buildCurrentActiveTailorRunCard({
    hasCurrentPageCompletedTailoring,
    currentPageApplicationContext,
    currentPageContext,
    currentPagePersonalInfoTailoring,
    currentPageRegistryKey,
    currentPageStoredTailoringRun,
    currentTailorPreparationState:
      currentPageTailorPreparationState ?? tailorPreparationState,
    currentPageUrl,
  });
  const parallelTailorRunCards = buildParallelTailorRunCards({
    currentPageContext,
    currentPageRegistryKey,
    existingTailoringPromptsByKey,
    personalInfo,
    tailorPreparationsByKey,
    tailoringRunsByKey,
  });
  const activeTailorRunCards = [
    ...(currentActiveTailorRunCard ? [currentActiveTailorRunCard] : []),
    ...parallelTailorRunCards,
  ].sort((left, right) => right.sortTime - left.sortTime);
  const isSuppressingActiveTailoringHydration =
    activeTailoringOverrideState === "overwriting" || isStoppingCurrentTailoring;
  const isTailorPreparationPending =
    isPreparingTailorStart || Boolean(tailorPreparationState);
  const tailorPreparationMessage =
    tailorPreparationState?.message?.trim() ||
    buildTailorResumePreparationMessage(false);
  const originalResume = personalInfo?.originalResume ?? null;
  const isSettingsUserMarkdownChanged =
    draftSettingsUserMarkdown !== savedSettingsUserMarkdown.markdown;
  const isTailorInterviewAwaitingCompletion = Boolean(
    tailorInterview?.completionRequestedAt,
  );
  const tailorInterviewFinishRequestKey =
    tailorInterview?.completionRequestedAt
      ? `${tailorInterview.id}:${tailorInterview.completionRequestedAt}`
      : null;
  const displayedTailorInterviewConversation = tailorInterview
    ? pendingTailorInterviewAnswerMessage &&
        tailorInterview.conversation.at(-1)?.id !==
          pendingTailorInterviewAnswerMessage.id
      ? [...tailorInterview.conversation, pendingTailorInterviewAnswerMessage]
      : tailorInterview.conversation
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
  const isTailorInterviewBusy =
    captureState === "finishing" ||
    isStoppingCurrentTailoring ||
    isFinishingTailorInterview;
  const lastTailoringRunMessage = lastTailoringRun?.message?.trim() || null;
  const lastTailoringRunError = lastTailoringRun?.tailoredResumeError?.trim() || null;
  const activeTailoring =
    existingTailoringPrompt?.existingTailoring ??
    currentPagePersonalInfoTailoring ??
    null;
  const completedTailoringForDisplay =
    activeTailoring?.kind === "completed"
      ? activeTailoring
      : currentPageCompletedTailoring;
  const persistedLatestTailoredResumeId =
    lastTailoringRun?.tailoredResumeId?.trim() || null;
  const persistedLatestTailoredResume =
    persistedLatestTailoredResumeId && personalInfo
      ? personalInfo.tailoredResumes.find(
          (tailoredResume) => tailoredResume.id === persistedLatestTailoredResumeId,
        ) ?? null
      : null;
  const latestTailoredResumeId =
    completedTailoringForDisplay?.tailoredResumeId ||
    currentPageCompletedTailoredResume?.id ||
    (persistedLatestTailoredResume &&
    !isTailoredResumeArchived(persistedLatestTailoredResume)
      ? persistedLatestTailoredResume.id
      : null) ||
    null;
  const topLevelTailoredResumeId =
    currentPageCompletedTailoredResume?.id ||
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
  const visibleUnarchivedTailoredResumes = unarchivedTailoredResumes;
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
                ? "Press Done or keep chatting to wrap up the resume follow-up."
                : "Answer the resume follow-up below."
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
    lastTailoringRunStatus: lastTailoringRun?.status ?? null,
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
        ? isTailorInterviewAwaitingCompletion
          ? "Press Done or keep chatting to wrap up the resume follow-up."
          : "Answer the resume follow-up below."
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
            : !lastTailoringRun && state.status === "ready"
              ? authState.status === "signedIn"
                ? "Ready to tailor this page."
                : "Connect Google to tailor this page."
              : statusMessage;
  const tailorRunDetail =
    activeTailoring?.kind === "active_generation"
      ? buildLiveTailorResumeStatusDetail(activeTailoring.lastStep)
      : activeTailoring?.kind === "pending_interview"
        ? buildExistingTailoringTitle(activeTailoring)
        : completedTailoringError
          ? completedTailoringError
          : !lastTailoringRun && state.status === "ready"
            ? currentPageContext?.title?.trim() || null
            : statusDetail;
  const activeTailoredResumeReviewRecord =
    focusedTailoredResumeId &&
    tailoredResumeReviewState.record?.id === focusedTailoredResumeId
      ? tailoredResumeReviewState.record
      : null;
  const tailoredResumeReviewError =
    tailoredResumeReviewState.status === "error"
      ? tailoredResumeReviewState.error
      : null;
  const showTailoredPreview = Boolean(latestTailoredResumeId);
  const showTopLevelTailoredWebAction = true;
  const previewButtonLabel = "Preview";
  const quickReviewButtonLabel = "Review edits";
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
  const showRegenerateTailorRunAction =
    showTailoredPreview && Boolean(displayedTailorRunUrl);
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
  const isTailorRunShellOverlayActive =
    Boolean(existingTailoringPrompt) || isTailorPreparationPending;
  const shouldRenderLegacyTailorRunShell =
    shouldShowTailorRunShell &&
    !currentActiveTailorRunCard &&
    !hasCurrentPageCompletedTailoring;
  const showFullscreenTailorRunDetail =
    Boolean(activeTailorRunDetailView && focusedTailoredResumeId);
  const activeTailorRunDetailIdentity =
    selectedTailoredResume?.displayName ?? displayedTailorRunIdentity?.label ?? null;
  const shouldShowTailorAuthPrompt =
    activePanelTab === "tailor" &&
    isTailorAuthPromptOpen &&
    authState.status !== "signedIn";

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
      if (backgroundTailorRunMenuActionState !== "idle") {
        return;
      }

      if (!backgroundTailorRunMenuRef.current?.contains(event.target as Node)) {
        setBackgroundTailorRunMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (backgroundTailorRunMenuActionState !== "idle") {
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
  }, [backgroundTailorRunMenuActionState, backgroundTailorRunMenuId]);

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

  function openSettingsView() {
    setIsSettingsOriginalResumeOpen(false);
    setIsSettingsUserMarkdownOpen(false);
    setSettingsUserMarkdownError(null);
    setIsSettingsViewOpen(true);
  }

  function closeSettingsView() {
    setSettingsUserMarkdownError(null);
    setIsSettingsViewOpen(false);
  }

  function cancelSettingsUserMarkdownEdits() {
    setDraftSettingsUserMarkdown(savedSettingsUserMarkdown.markdown);
    setSettingsUserMarkdownError(null);
    setIsSettingsUserMarkdownOpen(false);
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
      const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
        body: JSON.stringify({
          action: "saveUserMarkdown",
          markdown: draftSettingsUserMarkdown,
          updatedAt: savedSettingsUserMarkdown.updatedAt,
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
        userMarkdown?: UserMarkdownSummary;
      };

      if (response.status === 401) {
        await invalidateAuthSession();
        return;
      }

      if (!response.ok || !payload.userMarkdown) {
        throw new Error(
          readTailorResumePayloadError(payload, "Unable to save USER.md."),
        );
      }

      const nextUserMarkdown: UserMarkdownSummary = {
        markdown: payload.userMarkdown.markdown,
        updatedAt: payload.userMarkdown.updatedAt ?? null,
      };

      setSavedSettingsUserMarkdown(nextUserMarkdown);
      setDraftSettingsUserMarkdown(nextUserMarkdown.markdown);
      setIsSettingsUserMarkdownOpen(false);
      setPersonalInfoState((currentState) =>
        currentState.status === "ready"
          ? {
              personalInfo: {
                ...currentState.personalInfo,
                userMarkdown: nextUserMarkdown,
              },
              status: "ready",
            }
          : currentState,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save USER.md.";
      setSettingsUserMarkdownError(message);
    } finally {
      setIsSavingSettingsUserMarkdown(false);
    }
  }

  function openTailorAuthPrompt() {
    setActivePanelTab("tailor");
    setIsTailorAuthPromptOpen(true);
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
        personalInfo: cacheEntry.personalInfo,
        status: "ready",
      });
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [authState, isSuppressingActiveTailoringHydration]);

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
      setSavedSettingsUserMarkdown({
        markdown: defaultUserMarkdown,
        updatedAt: null,
      });
      setDraftSettingsUserMarkdown(defaultUserMarkdown);
      setSettingsUserMarkdownError(null);
      return;
    }

    if (personalInfoState.status !== "ready") {
      return;
    }

    const nextUserMarkdown = personalInfoState.personalInfo.userMarkdown;

    if (
      savedSettingsUserMarkdown.updatedAt === nextUserMarkdown.updatedAt &&
      savedSettingsUserMarkdown.markdown === nextUserMarkdown.markdown
    ) {
      return;
    }

    setSavedSettingsUserMarkdown(nextUserMarkdown);
    setDraftSettingsUserMarkdown(nextUserMarkdown.markdown);
    setSettingsUserMarkdownError(null);
  }, [
    authState.status,
    personalInfoState,
    savedSettingsUserMarkdown.markdown,
    savedSettingsUserMarkdown.updatedAt,
  ]);

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
    }, 1000);
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

    setTailorInterview(currentPagePersonalInfoInterview);

    if (!currentPagePersonalInfoInterview) {
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setIsTailorInterviewFinishPromptOpen(false);
      setIsTailorInterviewOpen(false);
      setTailorInterviewError(null);
    }
  }, [
    currentPagePersonalInfoInterview,
    isSuppressingActiveTailoringHydration,
    personalInfoState,
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
        previousRun: lastTailoringRun,
      });

      if (!areTailoringRunRecordsEqual(lastTailoringRun, nextRun)) {
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
      setCaptureState((currentCaptureState) =>
        currentCaptureState === "blocked" ? "blocked" : "idle",
      );
      void persistTailoringRun(null, currentPageRegistryKey).catch((error) => {
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
    setCaptureState((currentCaptureState) =>
      currentCaptureState === "blocked" ? "blocked" : "idle",
    );
    void persistTailoringRun(null).catch((error) => {
      console.error("Could not clear a stale tailoring run.", error);
    });
  }, [
    currentPageRegistryKey,
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
    const sessionToken =
      authState.status === "signedIn" ? authState.session.sessionToken : null;
    const tailoredResumeId = focusedTailoredResumeId ?? "";
    const tailoredResumePdfUpdatedAt = activeTailoredResumeReviewRecord?.pdfUpdatedAt ?? null;

    if (!sessionToken || !tailoredResumeId) {
      setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;

    async function loadTailoredResumePreview() {
      setTailoredResumePreviewState({ objectUrl: null, status: "loading" });

      try {
        const response = await fetch(
          buildTailoredResumePreviewUrl({
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
        objectUrl = URL.createObjectURL(previewBlob);

        if (isMounted) {
          setTailoredResumePreviewState({ objectUrl, status: "ready" });
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        if (isMounted) {
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
    }

    void loadTailoredResumePreview();

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    activeTailoredResumeReviewRecord?.pdfUpdatedAt,
    authState,
    focusedTailoredResumeId,
    invalidateAuthSession,
  ]);

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

      setTailoringRunsByKey(
        readStoredTailoringRunRegistry(
          changes[TAILORING_RUNS_STORAGE_KEY].newValue,
        ),
      );
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
      if (areaName !== "local" || !changes[TAILORING_PREPARATIONS_STORAGE_KEY]) {
        return;
      }

      setTailorPreparationsByKey(
        readStoredTailorPreparationRegistry(
          changes[TAILORING_PREPARATIONS_STORAGE_KEY].newValue,
        ),
      );
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[TAILORING_PROMPTS_STORAGE_KEY]) {
        return;
      }

      setExistingTailoringPromptsByKey(
        readStoredExistingTailoringPromptRegistry(
          changes[TAILORING_PROMPTS_STORAGE_KEY].newValue,
        ),
      );
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    setLastTailoringRun(currentPageStoredTailoringRun);
    setTailorPreparationState(currentPageTailorPreparationState);
    setExistingTailoringPrompt(currentPageExistingTailoringPrompt);
    setTailorGenerationStep(
      readTailorResumeGenerationStepSummary(
        currentPageStoredTailoringRun?.generationStep,
      ) ?? null,
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

    if (
      currentPageStoredTailoringRun ||
      currentPageTailorPreparationState ||
      currentPageExistingTailoringPrompt
    ) {
      setActivePanelTab("tailor");
    }
  }, [
    currentPageExistingTailoringPrompt,
    currentPageStoredTailoringRun,
    currentPageTailorPreparationState,
  ]);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    if (chatSendStatus === "streaming") {
      return;
    }

    if (authState.status !== "signedIn") {
      setChatMessages([]);
      setChatPageUrl(null);
      setChatStatus("idle");
      setChatError(null);
      return;
    }

    if (state.status !== "ready") {
      setChatMessages([]);
      setChatPageUrl(null);
      setChatStatus("idle");
      setChatError(null);
      return;
    }

    void loadChatHistory(state.snapshot.url, authState.session.sessionToken);
  }, [authState, chatSendStatus, isChatOpen, loadChatHistory, state]);

  useEffect(() => {
    if (!tailorInterview?.id) {
      return;
    }

    tailorInterviewMessagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    displayedTailorInterviewMessageCount,
    draftTailorInterviewAnswer,
    lastDisplayedTailorInterviewMessageId,
    tailorInterview?.id,
  ]);

  const triggerTailorCapture = useCallback(
    async (input: { overwriteExisting?: boolean } = {}) => {
      const response = await chrome.runtime.sendMessage({
        ...(input.overwriteExisting
          ? {
              payload: {
                overwriteExisting: true,
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
  }, [chatInput, chatMessages, chatSendStatus, isChatOpen]);

  async function handleTailorCurrentPage() {
    if (authState.status !== "signedIn") {
      openTailorAuthPrompt();
      return;
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
    const nextPrompt = {
      ...prompt,
      actionState: "overwriting" as const,
    };
    const preparingMessage = buildTailorResumePreparationMessage(true);

    setExistingTailoringPrompt(nextPrompt);
    await persistTailorPreparationState(
      buildTailorResumePreparationState({
        message: preparingMessage,
        pageContext: prompt.pageContext,
      }),
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
    setCaptureState("running");
    setLastTailoringRun(null);
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: {
              ...currentState.personalInfo,
              activeTailoring: null,
              activeTailorings: currentState.personalInfo.activeTailorings.filter(
                (activeTailoring) =>
                  !sameTailoringJobUrl(
                    activeTailoring.jobUrl,
                    prompt.jobUrl ?? prompt.existingTailoring.jobUrl ?? null,
                  ),
              ),
              tailoringInterview: null,
              tailoringInterviews:
                currentState.personalInfo.tailoringInterviews.filter(
                  (tailoringInterview) =>
                    !sameTailoringJobUrl(
                      tailoringInterview.jobUrl,
                      prompt.jobUrl ?? prompt.existingTailoring.jobUrl ?? null,
                    ),
                ),
            },
            status: "ready",
          }
        : currentState,
    );

    try {
      await triggerTailorCapture({ overwriteExisting: true });
      setActiveTailoringOverrideState("idle");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to tailor the resume.";
      await persistTailorPreparationState(null);
      setTailorGenerationStep(null);
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

    await persistTailoringRun(nextRun);
    await persistExistingTailoringPrompt(null);
    void loadPersonalInfo();
  }

  async function stopCurrentTailoring() {
    if (isStoppingCurrentTailoring) {
      return;
    }

    await persistTailorPreparationState(null);
    setIsStoppingCurrentTailoring(true);
    setActiveTailoringOverrideState("idle");
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
    setLastTailoringRun(null);
    setCaptureState("idle");
    setPersonalInfoState((currentState) =>
      currentState.status === "ready"
        ? {
            personalInfo: {
              ...currentState.personalInfo,
              activeTailoring: null,
              activeTailorings: currentState.personalInfo.activeTailorings.filter(
                (activeTailoring) =>
                  !sameTailoringJobUrl(activeTailoring.jobUrl, currentPageUrl),
              ),
              tailoringInterview: null,
              tailoringInterviews:
                currentState.personalInfo.tailoringInterviews.filter(
                  (tailoringInterview) =>
                    !sameTailoringJobUrl(tailoringInterview.jobUrl, currentPageUrl),
                ),
            },
            status: "ready",
          }
        : currentState,
    );

    try {
      await Promise.all([
        persistExistingTailoringPrompt(null),
        persistTailoringRun(null),
        persistTailorPreparationState(null),
      ]);
    } catch (error) {
      console.error("Could not clear the active tailoring state.", error);
    }

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          existingTailoringId:
            activeTailoring?.kind === "completed" ? null : activeTailoring?.id ?? null,
          jobUrl:
            currentPageUrl ??
            activeTailoring?.jobUrl ??
            tailorInterview?.jobUrl ??
            null,
          pageKey: currentPageRegistryKey,
        },
        type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
      });

      assertRuntimeResponseOk(response, "Unable to stop the current tailoring run.");
      applyAuthoritativePersonalInfo(readPersonalInfoPayload(response));
    } catch (error) {
      await loadPersonalInfo();
      setTailorInterviewError(
        error instanceof Error
          ? error.message
          : "Unable to stop the current tailoring run.",
      );
    } finally {
      setIsStoppingCurrentTailoring(false);
    }
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
      text: trimmedAnswer,
      toolCalls: [],
    };
    const pageContext = state.status === "ready" ? state.snapshot : null;

    setPendingTailorInterviewAnswerMessage(optimisticAnswerMessage);
    setDraftTailorInterviewAnswer("");
    dismissTailorInterviewFinishPrompt();
    setTailorInterviewError(null);
    setTailorGenerationStep(null);
    setCaptureState("finishing");
    const requestController = beginTailorRequest();

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

            setTailorGenerationStep(stepEvent);
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

      setPendingTailorInterviewAnswerMessage(null);
      setTailorInterview(profileSummary.tailoringInterview);
      void loadPersonalInfo();

      if (profileSummary.tailoringInterview) {
        const record = buildTailoringRunRecord({
          companyName: profileSummary.tailoringInterview.companyName,
          message: "One more resume question is waiting in the sidebar.",
          pageContext,
          positionTitle: profileSummary.tailoringInterview.positionTitle,
          status: "needs_input",
        });

        await persistTailoringRun(record);
        setTailorGenerationStep(null);
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
      setTailorGenerationStep(null);
      setCaptureState("sent");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unable to continue the tailoring follow-up questions.";

      setPendingTailorInterviewAnswerMessage(null);
      setDraftTailorInterviewAnswer(trimmedAnswer);
      setTailorInterviewError(message);
      setTailorGenerationStep(null);
      setCaptureState("needs_input");
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
    setTailorInterviewError(null);
    setIsFinishingTailorInterview(true);
    setTailorGenerationStep(null);
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

            setTailorGenerationStep(stepEvent);
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
      void loadPersonalInfo();

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
      setCaptureState("sent");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      setTailorInterviewError(
        error instanceof Error
          ? error.message
          : "Unable to finish the tailoring follow-up questions.",
      );
      setIsTailorInterviewFinishPromptOpen(true);
      setTailorGenerationStep(null);
      setCaptureState("needs_input");
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
      !chatPageUrl ||
      chatSendStatus === "streaming"
    ) {
      return;
    }

    setChatStatus("loading");
    setChatError(null);

    try {
      const response = await fetch(buildChatHistoryUrl(chatPageUrl), {
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

  async function handleSubmitChat() {
    if (authState.status !== "signedIn" || chatSendStatus === "streaming") {
      return;
    }

    const trimmedMessage = chatInput.trim();

    if (!trimmedMessage) {
      return;
    }

    let pageContext: JobPageContext;

    try {
      pageContext = await fetchSnapshot();
      setState({ snapshot: pageContext, status: "ready" });
    } catch (error) {
      setChatError(getSnapshotErrorMessage(error));
      setChatStatus("error");
      return;
    }

    const nextChatPageUrl = pageContext.url;
    const shouldResetForUrl = chatPageUrl !== nextChatPageUrl;
    const optimisticUserMessage = createTemporaryChatMessage(
      "user",
      trimmedMessage,
    );
    const optimisticAssistantMessage = createTemporaryChatMessage(
      "assistant",
      "",
    );

    setChatPageUrl(nextChatPageUrl);
    setChatInput("");
    setChatError(null);
    setChatStatus("ready");
    setChatSendStatus("streaming");
    setChatMessages((currentMessages) => [
      ...(shouldResetForUrl ? [] : currentMessages),
      optimisticUserMessage,
      optimisticAssistantMessage,
    ]);

    try {
      const response = await fetch(DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT, {
        body: JSON.stringify({
          message: trimmedMessage,
          pageContext,
          url: nextChatPageUrl,
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

          if (savedAssistantMessage) {
            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === optimisticAssistantMessage.id
                  ? savedAssistantMessage
                  : message,
              ),
            );
          }
        }
      });
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not send chat.",
      );
      setChatMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== optimisticAssistantMessage.id,
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
    setAuthActionState("running");

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
      setAuthActionState("idle");
    }
  }

  function openTailoredResumeDetailView(
    tailoredResumeId: string,
    nextView: TailorRunDetailView = "quickReview",
  ) {
    setSelectedTailoredResumeId(tailoredResumeId);
    setActiveTailorRunDetailView(nextView);
    setTailoredResumeMenuId(null);
    setTailoredResumeMenuError(null);
    setTailoredResumeMenuErrorResumeId(null);
  }

  async function handleOpenTailoredResumeOnWeb(
    tailoredResumeId: string | null = null,
  ) {
    setAuthActionState("running");

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
      setAuthActionState("idle");
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
    let shouldRefreshPersonalInfo = false;

    setPersonalDeleteActionState("deleting");
    setPersonalDeleteError(null);
    setTailoredResumeMutationError(null);

    if (optimisticPersonalInfo) {
      lastReadyPersonalInfoRef.current = optimisticPersonalInfo;
      setPersonalInfoState({
        personalInfo: optimisticPersonalInfo,
        status: "ready",
      });
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

      if (previousPersonalInfo) {
        lastReadyPersonalInfoRef.current = previousPersonalInfo;
        setPersonalInfoState({
          personalInfo: previousPersonalInfo,
          status: "ready",
        });
      }

      setPendingPersonalDelete(currentDelete);
      setPersonalDeleteError(message);

      if (currentDelete.kind === "tailoredResume") {
        setTailoredResumeMutationError(message);
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
      setIsTailorRunMenuOpen(false);
    } catch (error) {
      setTailorRunMenuError(
        error instanceof Error ? error.message : "Could not open that job tab.",
      );
    } finally {
      setTailorRunMenuActionState("idle");
    }
  }

  async function handleRegenerateTailorRun() {
    const targetUrl = displayedTailorRunUrl?.trim() ?? "";

    if (!targetUrl || tailorRunMenuActionState !== "idle") {
      return;
    }

    setTailorRunMenuActionState("regenerating");
    setTailorRunMenuError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          url: targetUrl,
        },
        type: "JOB_HELPER_REGENERATE_TAILORING",
      });
      assertRuntimeResponseOk(response, "Could not regenerate those edits.");
      setIsTailorRunMenuOpen(false);
    } catch (error) {
      setTailorRunMenuError(
        error instanceof Error
          ? error.message
          : "Could not regenerate those edits.",
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

    if ((!deleteTarget && !canDeleteTailorRun) || tailorRunMenuActionState !== "idle") {
      return;
    }

    const tailoredResumeId = deleteTarget?.tailoredResumeId?.trim() ?? "";
    const jobUrl = deleteTarget?.jobUrl?.trim() ?? "";
    const tailorRunId = deleteTarget?.tailorRunId?.trim() ?? "";

    setTailorRunMenuActionState("deleting");
    setTailorRunMenuError(null);
    let shouldRefreshPersonalInfo = false;

    try {
      await persistTailorPreparationState(null);
      activeTailorRequestAbortControllerRef.current?.abort();
      activeTailorRequestAbortControllerRef.current = null;
      setActiveTailoringOverrideState("idle");

      if (shouldCancelCurrentTailoring) {
        setIsStoppingCurrentTailoring(true);

        try {
          const response = await chrome.runtime.sendMessage({
            payload: {
              existingTailoringId:
                tailorRunId ||
                (activeTailoring?.kind === "completed"
                  ? null
                  : activeTailoring?.id ?? null),
              jobUrl:
                jobUrl ||
                currentPageUrl ||
                activeTailoring?.jobUrl ||
                tailorInterview?.jobUrl ||
                null,
              pageKey: currentPageRegistryKey,
            },
            type: "JOB_HELPER_CANCEL_CURRENT_TAILORING",
          });

          assertRuntimeResponseOk(
            response,
            "Unable to stop the current tailoring run.",
          );
          applyAuthoritativePersonalInfo(readPersonalInfoPayload(response));
        } catch (error) {
          await loadPersonalInfo();
          throw new Error(
            error instanceof Error
              ? error.message
              : "Unable to stop the current tailoring run.",
          );
        } finally {
          setIsStoppingCurrentTailoring(false);
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
          throw new Error(
            readTailorResumePayloadError(
              result.payload,
              "Unable to delete the tailored resume.",
            ),
          );
        }
      }

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
      setLastTailoringRun(null);
      setCaptureState("idle");
      setPersonalInfoState((currentState) =>
        currentState.status === "ready"
          ? {
              personalInfo: removeTailorRunArtifactsFromPersonalInfo({
                jobUrl,
                personalInfo: currentState.personalInfo,
                tailoredResumeId,
                tailorRunId,
              }),
              status: "ready",
            }
          : currentState,
      );

      await Promise.all([
        persistExistingTailoringPrompt(null),
        persistTailoringRun(null),
        persistTailorPreparationState(null),
      ]).catch((error) => {
        console.error("Could not clear the deleted tailoring run.", error);
      });
      shouldRefreshPersonalInfo = true;
    } catch (error) {
      setTailorRunMenuError(
        error instanceof Error
          ? error.message
          : "Unable to delete the tailored resume.",
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
      backgroundTailorRunMenuActionState !== "idle"
    ) {
      return;
    }

    setBackgroundTailorRunMenuActionState("goingToTab");
    setBackgroundTailorRunMenuActionCardId(card.id);
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
      setBackgroundTailorRunMenuId(null);
    } catch (error) {
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error ? error.message : "Could not open that job tab.",
      );
    } finally {
      setBackgroundTailorRunMenuActionState("idle");
      setBackgroundTailorRunMenuActionCardId(null);
    }
  }

  async function handleStopBackgroundTailorRun(card: ActiveTailorRunCard) {
    const jobUrl = card.deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";

    if (
      card.isCurrentPage ||
      backgroundTailorRunMenuActionState !== "idle" ||
      (!jobUrl && !existingTailoringId)
    ) {
      return;
    }

    setBackgroundTailorRunMenuActionState("stopping");
    setBackgroundTailorRunMenuActionCardId(card.id);
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);

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
      setBackgroundTailorRunMenuId(null);
      applyAuthoritativePersonalInfo(readPersonalInfoPayload(response));
    } catch (error) {
      await loadPersonalInfo();
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error ? error.message : "Unable to stop the tailoring run.",
      );
    } finally {
      setBackgroundTailorRunMenuActionState("idle");
      setBackgroundTailorRunMenuActionCardId(null);
    }
  }

  async function handleDeleteBackgroundTailorRun(card: ActiveTailorRunCard) {
    const deleteTarget = card.deleteTarget;
    const jobUrl = deleteTarget?.jobUrl?.trim() || card.url?.trim() || "";
    const existingTailoringId = card.existingTailoringId?.trim() ?? "";

    if (
      card.isCurrentPage ||
      backgroundTailorRunMenuActionState !== "idle" ||
      (!deleteTarget && !jobUrl && !existingTailoringId)
    ) {
      return;
    }

    setBackgroundTailorRunMenuActionState("deleting");
    setBackgroundTailorRunMenuActionCardId(card.id);
    setBackgroundTailorRunMenuError(null);
    setBackgroundTailorRunMenuErrorCardId(null);
    let shouldRefreshPersonalInfo = false;

    try {
      if (jobUrl || existingTailoringId) {
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
        applyAuthoritativePersonalInfo(readPersonalInfoPayload(cancelResponse));
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
          throw new Error(
            readTailorResumePayloadError(
              result.payload,
              "Unable to delete the tailored resume.",
            ),
          );
        }
      }

      setBackgroundTailorRunMenuId(null);
      setActiveTailorRunDetailView(null);
      setPersonalInfoState((currentState) =>
        currentState.status === "ready"
          ? {
              personalInfo: removeTailorRunArtifactsFromPersonalInfo({
                jobUrl,
                personalInfo: currentState.personalInfo,
                tailoredResumeId: deleteTarget?.tailoredResumeId?.trim() ?? "",
                tailorRunId: deleteTarget?.tailorRunId?.trim() ?? "",
              }),
              status: "ready",
            }
          : currentState,
      );
      shouldRefreshPersonalInfo = true;
    } catch (error) {
      await loadPersonalInfo();
      setBackgroundTailorRunMenuErrorCardId(card.id);
      setBackgroundTailorRunMenuError(
        error instanceof Error
          ? error.message
          : "Unable to delete the tailored resume.",
      );
    } finally {
      setBackgroundTailorRunMenuActionState("idle");
      setBackgroundTailorRunMenuActionCardId(null);
    }

    if (shouldRefreshPersonalInfo) {
      void loadPersonalInfo({ preserveCurrent: true });
    }
  }

  const renderActiveTailorRunCard = (card: ActiveTailorRunCard) => {
    const isCurrentCard = card.isCurrentPage;
    const isMenuOpen = isCurrentCard
      ? isTailorRunMenuOpen
      : backgroundTailorRunMenuId === card.id;
    const isMenuBusy = isCurrentCard
      ? tailorRunMenuActionState !== "idle"
      : backgroundTailorRunMenuActionState !== "idle";
    const isStopBusy = isCurrentCard
      ? isStoppingCurrentTailoring
      : backgroundTailorRunMenuActionState === "stopping" &&
        backgroundTailorRunMenuActionCardId === card.id;
    const showMenuError = isCurrentCard
      ? tailorRunMenuError
      : backgroundTailorRunMenuErrorCardId === card.id
        ? backgroundTailorRunMenuError
        : null;
    const menuActionStateLabel = isCurrentCard
      ? tailorRunMenuActionState
      : backgroundTailorRunMenuActionCardId === card.id
        ? backgroundTailorRunMenuActionState
        : "idle";
    const attemptBadgeLabel = readTailorResumeProgressAttemptBadgeLabel({
      attempt: card.step.attempt,
      status: card.step.status,
    });
    const stepLabel = formatTailorResumeProgressStepLabel({
      label: card.step.label,
      status: card.step.status,
    });

    return (
      <section
        aria-label={card.title}
        className={`snapshot-card tailor-run-shell tailor-run-shell-${card.statusDisplayState} ${
          isCurrentCard ? "tailor-run-shell-current-page" : ""
        } ${isMenuOpen ? "tailor-run-shell-menu-open" : ""}`.trim()}
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
              <button
                className="secondary-action compact-action"
                disabled={
                  isCurrentCard
                    ? isStoppingCurrentTailoring ||
                      tailorRunMenuActionState !== "idle"
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
                  disabled={isMenuBusy}
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

          <div className="tailor-progress-focus">
            <div
              aria-current={
                card.step.status === "current" || card.step.status === "retrying"
                  ? "step"
                  : undefined
              }
              className={`tailor-progress-step tailor-progress-step-${card.step.status} tailor-progress-step-focus`}
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
            </div>
          </div>
        </div>
      </section>
    );
  };

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

  function renderTailoredResumeLibrary(input: {
    actionLabel: "archive" | "restore";
    emptyMessage: string;
    resumes: TailoredResumeSummary[];
    title: string;
    highlightCurrentPage?: boolean;
  }) {
    if (authState.status !== "signedIn") {
      return <p className="placeholder">Connect Google to load saved resumes.</p>;
    }

    if (personalInfoState.status === "loading") {
      return <p className="placeholder">Loading tailored resumes...</p>;
    }

    if (personalInfoState.status === "error") {
      return <p className="placeholder">{personalInfoState.error}</p>;
    }

    if (input.resumes.length === 0) {
      return <p className="placeholder">{input.emptyMessage}</p>;
    }

    return (
      <>
        {tailoredResumeMutationError ? (
          <p className="preview-error tailored-resume-action-error">
            {tailoredResumeMutationError}
          </p>
        ) : null}
        <div className="tailored-resume-list">
          {input.resumes.map((tailoredResume) => {
            const isCurrentPageMatch =
              input.highlightCurrentPage === true &&
              tailoredResumeMatchesCurrentPage(tailoredResume);
            const isActionPending =
              tailoredResumeArchiveActionId === tailoredResume.id;
            const isMenuOpen = tailoredResumeMenuId === tailoredResume.id;
            const isMenuBusy =
              tailoredResumeMenuActionState !== "idle" &&
              tailoredResumeMenuActionResumeId === tailoredResume.id;
            const menuError =
              tailoredResumeMenuErrorResumeId === tailoredResume.id
                ? tailoredResumeMenuError
                : null;
            const canGoToTab = Boolean(tailoredResume.jobUrl?.trim());
            const isResumeActionDisabled =
              authActionState === "running" ||
              isDeletingPersonalItem ||
              isActionPending ||
              isMenuBusy;

            return (
              <div
                key={tailoredResume.id}
                className="tailored-resume-row-shell"
              >
                <button
                  className={`tailored-resume-row ${
                    isCurrentPageMatch ? "tailored-resume-row-current-page" : ""
                  }`.trim()}
                  disabled={authActionState === "running"}
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
                      {tailoredResume.displayName}
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
                  <button
                    aria-label={
                      input.actionLabel === "archive"
                        ? `Archive ${tailoredResume.displayName}`
                        : `Restore ${tailoredResume.displayName}`
                    }
                    className="icon-action tailored-resume-row-action-icon"
                    disabled={isResumeActionDisabled}
                    title={
                      isActionPending
                        ? input.actionLabel === "archive"
                          ? "Archiving..."
                          : "Restoring..."
                        : input.actionLabel === "archive"
                          ? "Archive"
                          : "Restore"
                    }
                    type="button"
                    onClick={() =>
                      void setTailoredResumeArchivedState({
                        archived: input.actionLabel === "archive",
                        tailoredResumeId: tailoredResume.id,
                      })
                    }
                  >
                    {input.actionLabel === "archive" ? (
                      <ArchiveTrayDownIcon />
                    ) : (
                      <ArchiveTrayUpIcon />
                    )}
                  </button>
                  <div
                    className="tailor-run-menu-shell tailored-resume-row-menu-shell"
                    ref={isMenuOpen ? tailoredResumeMenuRef : undefined}
                  >
                    <button
                      aria-expanded={isMenuOpen}
                      aria-label={`Actions for ${tailoredResume.displayName}`}
                      className="secondary-action compact-action tailor-run-menu-trigger"
                      disabled={authActionState === "running" || isDeletingPersonalItem}
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
                              {canGoToTab ? (
                                <button
                                  className="tailor-run-menu-item"
                                  disabled={isMenuBusy}
                                  type="button"
                                  onClick={() =>
                                    void handleGoToTailoredResumeTab(tailoredResume)
                                  }
                                >
                                  {isMenuBusy ? "Opening..." : "Go to tab"}
                                </button>
                              ) : null}
                              <button
                                className="tailor-run-menu-item"
                                disabled={isMenuBusy}
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
      return <p className="placeholder">No tracked applications yet.</p>;
    }

    return (
      <>
        <div className="application-list">
          {displayedApplications.map((application) => {
            const isDeleteDisabled =
              authActionState === "running" || isDeletingPersonalItem;

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
                      {application.jobTitle}
                    </span>
                    <span className="application-meta">
                      {application.companyName}
                      {application.location ? ` - ${application.location}` : ""}
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
            disabled={authActionState === "running"}
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

  function syncTailoredResumeSummariesFromPayload(payload: unknown) {
    const tailoredResumes = readTailoredResumeSummaries(payload);

    if (tailoredResumes.length === 0) {
      return;
    }

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

    if (nextPersonalInfo && authState.status === "signedIn") {
      void persistPersonalInfoCacheEntry(
        nextPersonalInfo,
        authState.session.user.id,
      );
    }
  }

  async function setTailoredResumeArchivedState(input: {
    archived: boolean;
    tailoredResumeId: string;
  }) {
    if (
      authState.status !== "signedIn" ||
      !input.tailoredResumeId ||
      tailoredResumeArchiveActionId
    ) {
      return {
        error: input.archived
          ? "Unable to archive the tailored resume."
          : "Unable to restore the tailored resume.",
        ok: false as const,
      };
    }

    setTailoredResumeArchiveActionId(input.tailoredResumeId);
    setTailoredResumeMutationError(null);

    try {
      const result = await patchTailorResume({
        action: "setTailoredResumeArchivedState",
        archived: input.archived,
        tailoredResumeId: input.tailoredResumeId,
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

      setTailoredResumeMutationError(message);

      return {
        error: message,
        ok: false as const,
      };
    } finally {
      setTailoredResumeArchiveActionId(null);
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

  async function patchTailorResume(
    body: Record<string, unknown>,
    options: {
      onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
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
      action === "completeTailorResumeInterview";
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
        onStepEvent: options.onStepEvent,
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

  async function handleSignIn() {
    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SIGN_IN",
      });
      setAuthState(readAuthResponse(response));
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error ? error.message : "Could not connect to Google.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
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
      ? state.snapshot.title || state.snapshot.url || "Current page"
      : "Current page";
  const canSendChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatInput.trim().length > 0;
  const canDeleteChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatMessages.length > 0 &&
    Boolean(chatPageUrl);

  function renderTailoredPreviewSurface() {
    return (
      <div className="tailor-run-detail-page-body tailor-run-detail-page-body-preview">
        <div className="resume-preview-shell tailored-preview-shell tailor-run-fullscreen-preview">
          {tailoredResumePreviewState.status === "loading" ? (
            <p className="placeholder">Rendering tailored preview...</p>
          ) : tailoredResumePreviewState.status === "error" ? (
            <p className="preview-error">{tailoredResumePreviewState.error}</p>
          ) : tailoredResumePreviewState.status === "ready" ? (
            <iframe
              className="resume-preview-frame"
              src={tailoredResumePreviewState.objectUrl}
              title="Tailored resume preview"
            />
          ) : (
            <p className="placeholder preview-placeholder">
              Tailored preview will appear here.
            </p>
          )}
        </div>
      </div>
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
            pendingEditId={pendingTailoredResumeReviewEditId}
            record={activeTailoredResumeReviewRecord}
            variant="fullscreen"
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
      </section>
    );
  }

  if (isSettingsViewOpen) {
    return (
      <main className="side-panel-shell side-panel-shell-detail">
        <div className="panel-detail-header">
          <button
            className="panel-back-link"
            type="button"
            onClick={closeSettingsView}
            aria-label="Back from settings"
            title="Back"
          >
            <ArrowLeftIcon />
          </button>
          <p className="panel-detail-title">Settings</p>
        </div>

        {renderSettingsSurface()}
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
          <div className="panel-detail-toggle-group" aria-label="Tailored resume detail">
            <button
              aria-pressed={activeTailorRunDetailView === "quickReview"}
              className={`panel-detail-toggle ${
                activeTailorRunDetailView === "quickReview"
                  ? "panel-detail-toggle-active"
                  : ""
              }`.trim()}
              type="button"
              onClick={() =>
                openTailorRunDetailView("quickReview", focusedTailoredResumeId)
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
          </div>
        </div>

        <section className="tailor-run-detail-page">
          {activeTailorRunDetailView === "quickReview"
            ? renderTailoredQuickReviewSurface()
            : renderTailoredPreviewSurface()}
        </section>
      </main>
    );
  }

  return (
    <main className="side-panel-shell">
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
              onClick={() => setActivePanelTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="panel-topbar-actions">
          <button
            aria-label="Open settings"
            className="secondary-action panel-settings-button"
            disabled={authActionState === "running"}
            type="button"
            onClick={openSettingsView}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {activePanelTab === "tailor" ? (
        <>
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
                disabled={authActionState === "running"}
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

          {shouldRenderLegacyTailorRunShell ? (
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
                    isTailorRunShellOverlayActive
                      ? "tailor-run-shell-overlay-active"
                      : ""
                  }`}
                >
            <div
              aria-hidden={isTailorRunShellOverlayActive ? "true" : undefined}
              className={`tailor-run-shell-body ${
                isTailorRunShellOverlayActive
                  ? "tailor-run-shell-body-obscured"
                  : ""
              }`.trim()}
            >
              {showCompactTailorRunSummary ? (
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
                        disabled={tailorRunMenuActionState !== "idle"}
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
                            {showRegenerateTailorRunAction ? (
                              <button
                                className="tailor-run-menu-item"
                                disabled={tailorRunMenuActionState !== "idle"}
                                type="button"
                                onClick={() => void handleRegenerateTailorRun()}
                              >
                                {tailorRunMenuActionState === "regenerating"
                                  ? "Regenerating..."
                                  : "Regenerate edits"}
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
                              disabled={tailorRunMenuActionState !== "idle"}
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
                                  {showRegenerateTailorRunAction ? (
                                    <button
                                      className="tailor-run-menu-item"
                                      disabled={tailorRunMenuActionState !== "idle"}
                                      type="button"
                                      onClick={() => void handleRegenerateTailorRun()}
                                    >
                                      {tailorRunMenuActionState === "regenerating"
                                        ? "Regenerating..."
                                        : "Regenerate edits"}
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
                        className={`tailor-progress-step tailor-progress-step-${compactTailorRunStep.status} tailor-progress-step-focus`}
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
                          className="tailor-run-detail-actions-group tailor-run-detail-actions-group-two-up"
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
                        : "Confirm"}
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
          ) : null}

          {activeTailorRunCards.length > 0 ? (
            <section
              aria-label="Active tailoring runs"
              className="active-tailor-run-stack"
            >
              {activeTailorRunCards.map((card) => renderActiveTailorRunCard(card))}
            </section>
          ) : null}

          <section className="snapshot-card tailored-resume-card">
            <div className="card-heading-row">
              <h2>Unarchived resumes</h2>
              <span>{unarchivedTailoredResumes.length}</span>
            </div>
            {renderTailoredResumeLibrary({
              actionLabel: "archive",
              emptyMessage:
                "Completed tailored resumes stay here until you archive them.",
              highlightCurrentPage: true,
              resumes: visibleUnarchivedTailoredResumes,
              title: "Saved tailored resume",
            })}
          </section>

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
                    <div>{message.text}</div>
                    <ToolCallDetails toolCalls={message.toolCalls} />
                  </div>
                ))}
                <div ref={tailorInterviewMessagesEndRef} />
              </div>

              {tailorInterviewError ? (
                <p className="interview-error">{tailorInterviewError}</p>
              ) : null}

              <textarea
                className="interview-input"
                disabled={isTailorInterviewBusy}
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

              <div className="interview-actions">
                <button
                  className="secondary-action compact-action"
                  disabled={isStoppingCurrentTailoring}
                  type="button"
                  onClick={() => void cancelTailorInterview()}
                >
                  {isStoppingCurrentTailoring ? "Stopping..." : "Stop run"}
                </button>
                <button
                  className="primary-action compact-action"
                  disabled={
                    isTailorInterviewBusy ||
                    draftTailorInterviewAnswer.trim().length === 0
                  }
                  type="button"
                  onClick={() => void submitTailorInterviewAnswer()}
                >
                  {captureState === "finishing"
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
                <p className="eyebrow">Tailor Resume Follow-Up</p>
                <h2>We&apos;d like to end this chat</h2>
                <p className="tailor-interview-finish-copy">
                  The assistant thinks it has enough detail to finish the tailored
                  resume. Press Done to continue, or keep chatting if you want to
                  clarify anything else first.
                </p>
                <div className="tailor-interview-finish-actions">
                  <button
                    className="secondary-action compact-action"
                    disabled={isFinishingTailorInterview}
                    type="button"
                    onClick={dismissTailorInterviewFinishPrompt}
                  >
                    Keep chatting
                  </button>
                  <button
                    className="primary-action compact-action"
                    disabled={isFinishingTailorInterview}
                    type="button"
                    onClick={() => void completeTailorInterview()}
                  >
                    {isFinishingTailorInterview ? "Finishing..." : "Done"}
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
      ) : activePanelTab === "archived" ? (
        <section className="snapshot-card tailored-resume-card">
          <div className="card-heading-row">
            <h2>Archived resumes</h2>
            <span>{archivedTailoredResumes.length}</span>
          </div>
          {renderTailoredResumeLibrary({
            actionLabel: "restore",
            emptyMessage: "No archived tailored resumes yet.",
            resumes: archivedTailoredResumes,
            title: "Archived tailored resume",
          })}
        </section>
      ) : activePanelTab === "applications" ? (
        <section className="snapshot-card applications-card">
          <div className="card-heading-row">
            <h2>Tracked apps</h2>
            <span>{personalInfo?.applicationCount ?? 0}</span>
          </div>
          {renderApplicationsSurface()}
        </section>
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
      <div className={`chat-dock ${isChatOpen ? "chat-dock-open" : ""}`}>
        {isChatOpen ? (
          <section className="chat-panel" aria-label="Job page chat">
            <header className="chat-header">
              <div className="chat-title-group">
                <p>Job Chat</p>
                <span title={chatPageLabel}>{chatPageLabel}</span>
              </div>
              <div className="chat-header-actions">
                <button
                  aria-label="Delete chat for this URL"
                  className="icon-action"
                  disabled={!canDeleteChat}
                  title="Delete chat for this URL"
                  type="button"
                  onClick={() => void handleDeleteChat()}
                >
                  <TrashIcon />
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

            <div className="chat-tip">
              This chat sees the current job page, your resume, and USER.md.
            </div>

            <div className="chat-messages" aria-live="polite">
              {authState.status !== "signedIn" ? (
                <p className="chat-placeholder">Connect Google to start chatting.</p>
              ) : state.status !== "ready" ? (
                <p className="chat-placeholder">Open a regular job page to chat.</p>
              ) : chatStatus === "loading" ? (
                <p className="chat-placeholder">Loading chat...</p>
              ) : chatStatus === "error" && chatMessages.length === 0 ? (
                <p className="chat-placeholder">{chatError}</p>
              ) : chatMessages.length === 0 ? (
                <p className="chat-placeholder">
                  Ask whether this role is worth applying to, where your resume
                  matches, or what the posting really requires.
                </p>
              ) : (
                chatMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`chat-message chat-message-${message.role}`}
                  >
                    <div className="chat-message-role">
                      {message.role === "assistant" ? "Job Helper" : "You"}
                    </div>
                    <ChatMessageMarkdown
                      content={message.content}
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
                disabled={
                  authState.status !== "signedIn" ||
                  chatSendStatus === "streaming"
                }
                placeholder="Ask about this job"
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
            aria-label="Open job chat"
            className="chat-launcher"
            title="Open job chat"
            type="button"
            onClick={() => setIsChatOpen(true)}
          >
            <ChatBubbleIcon />
          </button>
        )}
      </div>
    </main>
  );
}

export default App;
