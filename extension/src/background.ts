import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailorResumePreparationMessage,
  buildTailorResumePreparationState,
  buildJobDescriptionFromPageContext,
  buildTailorResumeApplicationContext,
  CAPTURE_COMMAND_NAME,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_JOB_APPLICATIONS_ENDPOINT,
  DEFAULT_SYNC_STATE_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  EXISTING_TAILORING_STORAGE_KEY,
  EXTENSION_AUTH_GOOGLE_ENDPOINT,
  EXTENSION_AUTH_SESSION_ENDPOINT,
  EXTENSION_BROWSER_SESSION_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
  normalizeComparableUrl,
  PREPARING_TAILORING_STORAGE_KEY,
  TAILORING_PREPARATIONS_STORAGE_KEY,
  TAILORING_PROMPTS_STORAGE_KEY,
  TAILORING_RUNS_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  readPersonalInfoSummary,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeExistingTailoringState,
  readTailorResumeExistingTailoringStates,
  type TailorResumeGenerationStepSummary,
  readTailorResumeProfileSummary,
  type TailorResumeRunRecord,
} from "./job-helper";
import { readUserSyncStateSnapshot } from "../../lib/sync-state.ts";
import { collectPageContextFromTab } from "./page-context";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
} from "./tailor-resume-stream";
import { findMatchingCurrentWindowTabForUrl } from "./browser-tab-targeting";
import { buildCompletedTailoringMessage } from "./tailor-run-copy";
import { resolvePotentialTailorOverwrite } from "./tailor-overwrite-guard";
import {
  buildTailorRunRegistryKey,
  readTailorRunRegistryKeyFromPageContext,
  readTailorRunRegistryKeyFromTab,
} from "./tailor-run-registry";
import {
  buildTailorResumeLiveStatusMessage as buildLiveTailorResumeStatusMessage,
} from "../../lib/tailor-resume-step-display.ts";

type OverlayTone = "error" | "info" | "success" | "warning";

type TailorResumeSummary = {
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

type TailorRunStorageRegistry<T> = Record<string, T>;

const activeTailorResumeAbortControllers = new Map<
  string,
  AbortController
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
  capturedAt: string;
  message?: string;
  pageContext?: JobPageContext | null;
  step?: TailorResumeGenerationStepSummary | null;
  tab: chrome.tabs.Tab | null;
}) {
  const pageApplicationContext = input.pageContext
    ? buildTailorResumeApplicationContext(input.pageContext)
    : null;

  return {
    capturedAt: input.capturedAt,
    companyName: pageApplicationContext?.companyName ?? null,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    generationStep: input.step ?? null,
    jobIdentifier: null,
    message:
      input.message ?? buildLiveTailorResumeStatusMessage(input.step ?? null),
    pageTitle: input.pageContext?.title || cleanText(input.tab?.title) || null,
    pageUrl: input.pageContext?.url || cleanText(input.tab?.url) || null,
    positionTitle: pageApplicationContext?.jobTitle ?? null,
    status: "running",
    tailoredResumeError: null,
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
    return `A Tailor Resume run for ${roleLabel} is waiting on stage 2/4. Confirm overwrite in the side panel if you want to replace it.`;
  }

  const stageLabel = existingTailoring.lastStep
    ? `stage ${existingTailoring.lastStep.stepNumber}/${existingTailoring.lastStep.stepCount}: ${existingTailoring.lastStep.summary}`
    : "the first tailoring stage";

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

async function setStorageRegistryEntry<T>(
  key: string,
  entryKey: string,
  value: T | null,
) {
  const registry = await readStorageRegistry(key);

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
    await Promise.all([
      setStorageRegistryEntry(TAILORING_RUNS_STORAGE_KEY, pageKey, null),
      setStorageRegistryEntry(TAILORING_PREPARATIONS_STORAGE_KEY, pageKey, null),
      setStorageRegistryEntry(TAILORING_PROMPTS_STORAGE_KEY, pageKey, null),
    ]);
  } else {
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
  await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
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
    return { status: "signedOut" };
  }

  const validatedSession = await validateStoredAuthSession(storedSession);

  return validatedSession
    ? { session: validatedSession, status: "signedIn" }
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

async function signInToJobHelper() {
  const accessToken = await requestGoogleAccessToken(true);
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
    throw new Error(readResponseError(payload, "Unable to connect Job Helper."));
  }

  const session = readAuthSession(payload);

  if (!session || !isAuthSessionFresh(session)) {
    throw new Error("Job Helper did not return a usable extension session.");
  }

  await writeStoredAuthSession(session);

  return session;
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

  if (!input.interactive) {
    throw new Error("Sign in to Job Helper from the extension first.");
  }

  return signInToJobHelper();
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

async function triggerTailorResumeRegeneration(url: string) {
  const result = await focusOrCreateBrowserTab(url);
  void runCaptureFlow({
    openSidePanel: true,
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

async function getPersonalInfoSummary() {
  const session = await ensureJobHelperSession({ interactive: false });
  const [tailorResumeResponse, applicationsResponse] = await Promise.all([
    fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      cache: "no-store",
      credentials: "include",
      headers: authorizationHeaders(session),
    }),
    fetch(`${DEFAULT_JOB_APPLICATIONS_ENDPOINT}?limit=100`, {
      cache: "no-store",
      credentials: "include",
      headers: authorizationHeaders(session),
    }),
  ]);
  const [tailorResumePayload, applicationsPayload] = await Promise.all([
    readJsonResponse(tailorResumeResponse),
    readJsonResponse(applicationsResponse),
  ]);

  if (!tailorResumeResponse.ok || !applicationsResponse.ok) {
    if (tailorResumeResponse.status === 401 || applicationsResponse.status === 401) {
      await clearStoredAuthSession();
    }

    throw new Error(
      readResponseError(
        !tailorResumeResponse.ok ? tailorResumePayload : applicationsPayload,
        "Could not load your Job Helper info.",
      ),
    );
  }

  return {
    personalInfo: readPersonalInfoSummary({
      applicationsPayload,
      tailorResumePayload,
    }),
  };
}

async function getSyncStateSummary() {
  const session = await ensureJobHelperSession({ interactive: false });
  const response = await fetch(DEFAULT_SYNC_STATE_ENDPOINT, {
    cache: "no-store",
    credentials: "include",
    headers: authorizationHeaders(session),
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

async function loadTailorResumeOverwriteSummary(session: JobHelperAuthSession) {
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
    overwriteExisting,
    pageKey,
    pageContext,
  } = input;
  const readyTab = await waitForTabToFinishLoading(activeTab);
  const tabId = readyTab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  const result = await patchTailorResume(
    {
      action: "tailor",
      applicationContext: buildTailorResumeApplicationContext(pageContext),
      ...(overwriteExisting
        ? { existingTailoringAction: "overwrite" }
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

        void persistResult(
          pageKey,
          buildRunningTailoringRunRecord({
            capturedAt,
            pageContext,
            step: stepEvent,
            tab: readyTab,
          }),
        );
      },
      signal: abortController.signal,
    },
  );
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
        tailoredResumeError: null,
        tailoredResumeId: null,
      };

      await persistResult(pageKey, record);
      await persistExistingTailoringPrompt(pageKey, {
        existingTailoring,
        jobDescription,
        jobUrl,
        pageContext,
      });
      await showOverlay(tabId, existingTailoringMessage, "info");
      await openSidePanelForTab(activeTab);
      return;
    }

    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "The Tailor Resume endpoint returned an error.",
    );
  }

  if (typeof payload.profile !== "object" || payload.profile === null) {
    throw new Error("Tailor Resume did not return a saved result.");
  }

  const profileSummary = readTailorResumeProfileSummary(payload.profile);
  const activeInterview = profileSummary?.tailoringInterview ?? null;

  if (payload.tailoringStatus === "needs_user_input" || activeInterview) {
    const record: TailorResumeRunRecord = {
      capturedAt,
      companyName: activeInterview?.companyName ?? null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      jobIdentifier: activeInterview?.jobIdentifier ?? null,
      message: "Resume questions are waiting in the side panel.",
      pageTitle: pageContext.title || null,
      pageUrl: pageContext.url || null,
      positionTitle: activeInterview?.positionTitle ?? null,
      status: "needs_input",
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    await persistResult(pageKey, record);
    await showOverlay(tabId, record.message, "info");
    return;
  }

  const latestTailoredResume = readLatestTailoredResume(payload);
  const alreadyTailored = payload.tailoringStatus === "already_tailored";
  const tailoredResumeError =
    typeof payload.tailoredResumeError === "string"
      ? payload.tailoredResumeError
      : null;
  const record: TailorResumeRunRecord = {
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
    tailoredResumeError,
    tailoredResumeId: latestTailoredResume?.id ?? null,
  };

  record.message = alreadyTailored
    ? "Already tailored this job. Showing the saved resume in the side panel."
    : buildSuccessMessage(record);

  await persistResult(pageKey, record);
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
    await openSidePanelForTab(activeTab);
  }
}

async function runCaptureFlow(input: {
  openSidePanel?: boolean;
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
    const tabId = readyTab.id;

    if (typeof tabId !== "number") {
      throw new Error("The active tab does not expose an id.");
    }

    const authSession = await ensureJobHelperSession({ interactive: true });
    const pageContext = await collectPageContext(tabId);
    const jobDescription = buildJobDescriptionFromPageContext(pageContext);
    const jobUrl = readJobUrlFromPageContext(pageContext);
    pageKey =
      readTailorRunRegistryKeyFromPageContext(pageContext) ?? initialPageKey;

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

    try {
      overwriteSummary = await loadTailorResumeOverwriteSummary(authSession);
    } catch (error) {
      console.warn(
        "Could not refresh Tailor Resume overwrite state before starting.",
        error,
      );
    }

    if (!input.overwriteExisting) {
      const existingTailoring = resolvePotentialTailorOverwrite({
        activeTailorings: overwriteSummary?.activeTailorings ?? [],
        pageIdentity: {
          canonicalUrl: pageContext.canonicalUrl,
          jobUrl,
          pageUrl: pageContext.url,
        },
        tailoredResumes: overwriteSummary?.tailoredResumes ?? [],
      });
      const existingTailoringMessage =
        buildExistingTailoringMessage(existingTailoring);

      if (existingTailoring && existingTailoringMessage) {
        const record: TailorResumeRunRecord = {
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

    await persistTailorPreparationState(pageKey, null);
    await persistExistingTailoringPrompt(pageKey, null);
    await persistResult(
      pageKey,
      buildRunningTailoringRunRecord({
        capturedAt,
        pageContext,
        tab: readyTab,
      }),
    );

    await showOverlay(tabId, "Tailoring your resume for this job...", "info");

    await tailorResumeForTab({
      abortController,
      activeTab: readyTab,
      authSession,
      capturedAt,
      jobDescription,
      jobUrl,
      overwriteExisting: input.overwriteExisting,
      pageKey,
      pageContext,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    const message =
      error instanceof Error ? error.message : "Failed to tailor the resume.";
    activeTab = activeTab ?? (await getActiveTab().catch(() => null));
    const targetPageKey = pageKey ?? initialPageKey;

    if (targetPageKey) {
      await persistTailorPreparationState(targetPageKey, null);
    }

    const record: TailorResumeRunRecord = {
      capturedAt,
      companyName: null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      generationStep: null,
      jobIdentifier: null,
      message,
      pageTitle: cleanText(activeTab?.title) || null,
      pageUrl: cleanText(activeTab?.url) || null,
      positionTitle: null,
      status: "error",
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
      session: await signInToJobHelper(),
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
    return sendAsyncResponse(sendResponse, getPersonalInfoSummary);
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

  if (typedMessage?.type === "JOB_HELPER_OPEN_DASHBOARD") {
    return sendAsyncResponse(sendResponse, async () => {
      const callbackUrl =
        readPayloadString(typedMessage.payload, "callbackUrl") ||
        DEFAULT_DASHBOARD_URL;

      await openJobHelperCallbackUrl(callbackUrl);

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

  if (typedMessage?.type === "JOB_HELPER_REGENERATE_TAILORING") {
    return sendAsyncResponse(sendResponse, async () => {
      const url = readPayloadString(typedMessage.payload, "url");

      if (!url) {
        throw new Error("Could not regenerate those edits because the job URL is missing.");
      }

      return triggerTailorResumeRegeneration(url);
    });
  }
});
