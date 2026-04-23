import {
  AUTH_SESSION_STORAGE_KEY,
  buildJobDescriptionFromPageContext,
  CAPTURE_COMMAND_NAME,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_JOB_APPLICATIONS_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  EXTENSION_AUTH_GOOGLE_ENDPOINT,
  EXTENSION_AUTH_SESSION_ENDPOINT,
  EXTENSION_BROWSER_SESSION_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  readPersonalInfoSummary,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeProfileSummary,
  type TailorResumeRunRecord,
} from "./job-helper";
import { collectPageContextFromTab } from "./page-context";

type OverlayTone = "error" | "info" | "success";

type TailorResumeSummary = {
  companyName: string | null;
  id: string | null;
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

let isCaptureInFlight = false;

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

  if (record.tailoredResumeError) {
    return `Saved a tailored draft for ${jobLabel}. Review it in the side panel`;
  }

  return `Tailored resume for ${jobLabel}. Preview is in the side panel`;
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

async function persistResult(record: TailorResumeRunRecord) {
  await chrome.storage.local.set({
    [LAST_TAILORING_STORAGE_KEY]: record,
  });
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

  await chrome.tabs.create({
    active: true,
    ...(windowId === null ? {} : { windowId }),
    url,
  });
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
  let url = normalizeDashboardCallbackUrl(callbackUrl);

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
      credentials: "include",
      headers: authorizationHeaders(session),
    }),
    fetch(`${DEFAULT_JOB_APPLICATIONS_ENDPOINT}?limit=12`, {
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

async function tailorResumeForTab(activeTab: chrome.tabs.Tab) {
  const tabId = activeTab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  const authSession = await ensureJobHelperSession({ interactive: true });

  await showOverlay(tabId, "Job Helper is reading this job post", "info");

  const pageContext = await collectPageContext(tabId);
  const jobDescription = buildJobDescriptionFromPageContext(pageContext);
  const jobUrl = readJobUrlFromPageContext(pageContext);

  if (!jobDescription) {
    throw new Error("Could not find job description text on this page.");
  }

  await showOverlay(tabId, "Tailoring your resume for this job...", "info");

  const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
    method: "PATCH",
    body: JSON.stringify({
      action: "tailor",
      jobDescription,
      jobUrl,
    }),
    credentials: "include",
    headers: {
      ...authorizationHeaders(authSession),
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    if (response.status === 401) {
      await clearStoredAuthSession();
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
      capturedAt: new Date().toISOString(),
      companyName: activeInterview?.companyName ?? null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      message: "Resume questions are waiting in the side panel.",
      pageTitle: pageContext.title || null,
      pageUrl: pageContext.url || null,
      positionTitle: activeInterview?.positionTitle ?? null,
      status: "needs_input",
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    await persistResult(record);
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
    capturedAt: new Date().toISOString(),
    companyName: latestTailoredResume?.companyName ?? null,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
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

  await persistResult(record);
  await showOverlay(
    tabId,
    record.message,
    record.status === "success" ? "success" : "error",
  );

  if (latestTailoredResume?.id) {
    await openSidePanelForTab(activeTab);
  }
}

async function runCaptureFlow(input: {
  openSidePanel?: boolean;
  tab?: chrome.tabs.Tab;
} = {}) {
  let activeTab = input.tab ?? null;

  if (isCaptureInFlight) {
    if (input.openSidePanel) {
      activeTab = activeTab ?? (await getActiveTab().catch(() => null));

      if (activeTab) {
        await openSidePanelForTab(activeTab);
      }
    }

    return;
  }

  isCaptureInFlight = true;

  try {
    activeTab = activeTab ?? (await getActiveTab());

    if (input.openSidePanel) {
      await openSidePanelForTab(activeTab);
    }

    await tailorResumeForTab(activeTab);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to tailor the resume.";
    activeTab = activeTab ?? (await getActiveTab().catch(() => null));

    const record: TailorResumeRunRecord = {
      capturedAt: new Date().toISOString(),
      companyName: null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      message,
      pageTitle: cleanText(activeTab?.title) || null,
      pageUrl: cleanText(activeTab?.url) || null,
      positionTitle: null,
      status: "error",
      tailoredResumeError: null,
      tailoredResumeId: null,
    };

    await persistResult(record);

    try {
      if (activeTab && typeof activeTab.id === "number") {
        await showOverlay(activeTab.id, message, "error");
      }
    } catch {
      // Ignore follow-up UI failures after persisting the error.
    }
  } finally {
    isCaptureInFlight = false;
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

  if (typedMessage?.type === "JOB_HELPER_OPEN_DASHBOARD") {
    return sendAsyncResponse(sendResponse, async () => {
      const callbackUrl =
        readPayloadString(typedMessage.payload, "callbackUrl") ||
        DEFAULT_DASHBOARD_URL;

      await openJobHelperCallbackUrl(callbackUrl);

      return {};
    });
  }
});
