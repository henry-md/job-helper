import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailoredResumeReviewUrl,
  DEFAULT_DASHBOARD_URL,
  LAST_TAILORING_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  readTailoredResumeSummaries,
  type TailoredResumeSummary,
  type TailorResumeRunRecord,
} from "./job-helper";
import { collectPageContextFromTab } from "./page-context";

type PanelState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: JobPageContext }
  | { status: "error"; error: string; snapshot: null };

type CaptureState = "idle" | "running" | "sent" | "error";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; session: JobHelperAuthSession }
  | { status: "error"; error: string };

type AuthActionState = "idle" | "running";

type TailoredResumeListState =
  | { records: []; status: "idle" | "loading" }
  | { records: TailoredResumeSummary[]; status: "ready" }
  | { error: string; records: []; status: "error" };

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

function App() {
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionState, setAuthActionState] =
    useState<AuthActionState>("idle");
  const [tailoredResumeListState, setTailoredResumeListState] =
    useState<TailoredResumeListState>({ records: [], status: "idle" });
  const [lastTailoringRun, setLastTailoringRun] =
    useState<TailorResumeRunRecord | null>(null);

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

  const loadTailoredResumes = useCallback(async () => {
    setTailoredResumeListState({ records: [], status: "loading" });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_TAILORED_RESUMES",
      });

      if (!isRecord(response) || response.ok !== true) {
        throw new Error(
          readErrorMessage(response, "Could not load tailored resumes."),
        );
      }

      setTailoredResumeListState({
        records: readTailoredResumeSummaries(response.records),
        status: "ready",
      });
    } catch (error) {
      setTailoredResumeListState({
        error:
          error instanceof Error
            ? error.message
            : "Could not load tailored resumes.",
        records: [],
        status: "error",
      });
    }
  }, []);

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
      setTailoredResumeListState({ records: [], status: "idle" });
      return;
    }

    void loadTailoredResumes();
  }, [authState, lastTailoringRun?.capturedAt, loadTailoredResumes]);

  useEffect(() => {
    function handleActiveTabChange() {
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

      void loadSnapshot();
    }

    chrome.tabs.onActivated.addListener(handleActiveTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActiveTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
    };
  }, [loadSnapshot]);

  useEffect(() => {
    void chrome.storage.local
      .get(LAST_TAILORING_STORAGE_KEY)
      .then((result) => {
        const storedValue = result[LAST_TAILORING_STORAGE_KEY];

        if (storedValue) {
          setLastTailoringRun(storedValue as TailorResumeRunRecord);
        }
      });

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[LAST_TAILORING_STORAGE_KEY]) {
        return;
      }

      const nextRun =
        (changes[LAST_TAILORING_STORAGE_KEY]
          .newValue as TailorResumeRunRecord | null) ?? null;

      setLastTailoringRun(nextRun);
      setCaptureState("idle");
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  async function handleTailorCurrentPage() {
    if (authState.status !== "signedIn") {
      setCaptureState("error");
      return;
    }

    setCaptureState("running");

    try {
      await chrome.runtime.sendMessage({
        type: "JOB_HELPER_TRIGGER_CAPTURE",
      });
      setCaptureState("sent");
    } catch {
      setCaptureState("error");
    }
  }

  async function handleOpenDashboard() {
    setAuthActionState("running");

    try {
      await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: DEFAULT_DASHBOARD_URL,
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      void loadAuthStatus();
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open Job Helper.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleOpenTailoredResume(tailoredResumeId: string) {
    setAuthActionState("running");

    try {
      await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: buildTailoredResumeReviewUrl(tailoredResumeId),
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
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

  return (
    <main className="side-panel-shell">
      <header className="panel-header">
        <p className="eyebrow">Job Helper</p>
        <h1>Tailor Resume</h1>
      </header>

      <section className="auth-card">
        <div className="auth-identity">
          {authState.status === "signedIn" && (
            <div className="auth-avatar" aria-hidden="true">
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
            </div>
          )}
          <div className="auth-copy">
            <h2>Account</h2>
            <p>
              {authState.status === "loading" && "Checking connection..."}
              {authState.status === "signedOut" && "Not connected"}
              {authState.status === "error" && authState.error}
              {authState.status === "signedIn" &&
                (authState.session.user.email ||
                  authState.session.user.name ||
                  "Connected")}
            </p>
          </div>
        </div>
        {authState.status === "signedIn" ? (
          <button
            className="secondary-action compact-action"
            disabled={authActionState === "running"}
            type="button"
            onClick={handleSignOut}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="primary-action compact-action"
            disabled={authActionState === "running"}
            type="button"
            onClick={handleSignIn}
          >
            {authActionState === "running" ? "Connecting..." : "Connect Google"}
          </button>
        )}
      </section>

      <div className="action-grid">
        <button
          className="primary-action"
          disabled={captureState === "running" || authState.status !== "signedIn"}
          type="button"
          onClick={handleTailorCurrentPage}
        >
          {captureState === "running" ? "Tailoring..." : "Tailor Current Page"}
        </button>
        <button className="secondary-action" type="button" onClick={loadSnapshot}>
          Refresh Page
        </button>
      </div>

      <button
        className="link-action"
        disabled={authActionState === "running"}
        type="button"
        onClick={handleOpenDashboard}
      >
        Open Dashboard
      </button>

      <section className="snapshot-card tailored-resume-card">
        <div className="card-heading-row">
          <h2>Tailored resumes</h2>
          {tailoredResumeListState.status === "ready" && (
            <span>{tailoredResumeListState.records.length}</span>
          )}
        </div>
        {authState.status !== "signedIn" ? (
          <p className="placeholder">Connect Google to load saved resumes.</p>
        ) : tailoredResumeListState.status === "loading" ? (
          <p className="placeholder">Loading tailored resumes...</p>
        ) : tailoredResumeListState.status === "error" ? (
          <p className="placeholder">{tailoredResumeListState.error}</p>
        ) : tailoredResumeListState.records.length === 0 ? (
          <p className="placeholder">No tailored resumes yet.</p>
        ) : (
          <div className="tailored-resume-list">
            {tailoredResumeListState.records.map((tailoredResume) => (
              <button
                key={tailoredResume.id}
                className="tailored-resume-row"
                disabled={authActionState === "running"}
                type="button"
                onClick={() => handleOpenTailoredResume(tailoredResume.id)}
              >
                <span className="tailored-resume-main">
                  <span className="tailored-resume-title">
                    {tailoredResume.displayName}
                  </span>
                  <span className="tailored-resume-meta">
                    {tailoredResume.companyName ||
                      tailoredResume.positionTitle ||
                      "Saved tailored resume"}
                  </span>
                </span>
                <span className="tailored-resume-date">
                  {formatTailoredResumeDate(tailoredResume.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="status-row">
        <span className={`status-dot status-dot-${state.status}`} />
        <span className="status-text">
          {captureState === "running" && "Starting Tailor Resume"}
          {captureState === "sent" &&
            "Tailoring started. Results will appear here."}
          {captureState === "error" && "Could not start Tailor Resume."}
          {captureState === "error" &&
            authState.status !== "signedIn" &&
            " Connect Google first."}
          {captureState === "idle" &&
            state.status === "idle" &&
            "Waiting for page details"}
          {captureState === "idle" &&
            state.status === "loading" &&
            "Reading the active tab"}
          {captureState === "idle" &&
            state.status === "ready" &&
            "Page details loaded"}
          {captureState === "idle" && state.status === "error" && state.error}
        </span>
      </div>

      <section className="snapshot-card">
        <h2>Last tailoring run</h2>
        {lastTailoringRun ? (
          <dl className="snapshot-grid">
            <div>
              <dt>Status</dt>
              <dd>{lastTailoringRun.message}</dd>
            </div>
            <div>
              <dt>Ran at</dt>
              <dd>{new Date(lastTailoringRun.capturedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{lastTailoringRun.positionTitle || "No role was returned."}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{lastTailoringRun.companyName || "No company was returned."}</dd>
            </div>
            <div>
              <dt>Tailor Resume</dt>
              <dd className="wrap-anywhere">{lastTailoringRun.endpoint}</dd>
            </div>
            <div>
              <dt>Page</dt>
              <dd className="wrap-anywhere">
                {lastTailoringRun.pageUrl || "No page URL was captured."}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="placeholder">No tailoring runs yet.</p>
        )}
      </section>

      <section className="snapshot-card">
        <h2>Active page</h2>
        {state.status === "ready" ? (
          <dl className="snapshot-grid">
            <div>
              <dt>Title</dt>
              <dd>{state.snapshot.title || "Untitled page"}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd className="wrap-anywhere">{state.snapshot.url}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{state.snapshot.description || "No meta description found."}</dd>
            </div>
            <div>
              <dt>Salary hints</dt>
              <dd>
                {state.snapshot.salaryMentions.length > 0
                  ? state.snapshot.salaryMentions.join(", ")
                  : "No salary hints detected."}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="placeholder">
            Select a regular web page to inspect its job details here.
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
