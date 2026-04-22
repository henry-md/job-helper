import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildTailoredResumeReviewUrl,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  type PersonalInfoSummary,
  readPersonalInfoPayload,
  type TailorResumeRunRecord,
  type TrackedApplicationSummary,
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

type PanelTab = "personal" | "tailor";
type PersonalSectionId = "applications" | "resume" | "tailoredResumes";

type PersonalInfoState =
  | { personalInfo: null; status: "idle" | "loading" }
  | { personalInfo: PersonalInfoSummary; status: "ready" }
  | { error: string; personalInfo: null; status: "error" };

type ResumePreviewState =
  | { objectUrl: null; status: "idle" | "loading" }
  | { objectUrl: string; status: "ready" }
  | { error: string; objectUrl: null; status: "error" };

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

function App() {
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("tailor");
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionState, setAuthActionState] =
    useState<AuthActionState>("idle");
  const [personalInfoState, setPersonalInfoState] =
    useState<PersonalInfoState>({ personalInfo: null, status: "idle" });
  const [resumePreviewState, setResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [collapsedPersonalSections, setCollapsedPersonalSections] = useState<
    Record<PersonalSectionId, boolean>
  >({
    applications: true,
    resume: true,
    tailoredResumes: true,
  });
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

  const loadPersonalInfo = useCallback(async () => {
    setPersonalInfoState({ personalInfo: null, status: "loading" });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_PERSONAL_INFO",
      });

      if (!isRecord(response) || response.ok !== true) {
        throw new Error(
          readErrorMessage(response, "Could not load your Job Helper info."),
        );
      }

      setPersonalInfoState({
        personalInfo: readPersonalInfoPayload(response),
        status: "ready",
      });
    } catch (error) {
      setPersonalInfoState({
        error:
          error instanceof Error
            ? error.message
            : "Could not load your Job Helper info.",
        personalInfo: null,
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
      setPersonalInfoState({ personalInfo: null, status: "idle" });
      setResumePreviewState({ objectUrl: null, status: "idle" });
      return;
    }

    void loadPersonalInfo();
  }, [authState, lastTailoringRun?.capturedAt, loadPersonalInfo]);

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
  }, [authState, personalInfoState]);

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

  async function handleOpenApplicationsDashboard() {
    setAuthActionState("running");

    try {
      await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: `${DEFAULT_DASHBOARD_URL}?tab=new`,
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
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

  async function handleOpenTrackedApplication(
    application: TrackedApplicationSummary,
  ) {
    if (application.jobUrl) {
      await chrome.tabs.create({ url: application.jobUrl });
      return;
    }

    await handleOpenApplicationsDashboard();
  }

  function togglePersonalSection(sectionId: PersonalSectionId) {
    setCollapsedPersonalSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }));
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

  const personalInfo =
    personalInfoState.status === "ready" ? personalInfoState.personalInfo : null;
  const originalResume = personalInfo?.originalResume ?? null;
  const isResumeCollapsed = collapsedPersonalSections.resume;
  const isTailoredResumesCollapsed =
    collapsedPersonalSections.tailoredResumes;
  const isApplicationsCollapsed = collapsedPersonalSections.applications;

  return (
    <main className="side-panel-shell">
      <header className="panel-header">
        <a
          aria-label="Open Job Helper dashboard"
          className="eyebrow eyebrow-link"
          href={DEFAULT_DASHBOARD_URL}
          onClick={(event) => {
            event.preventDefault();

            if (authActionState !== "running") {
              void handleOpenDashboard();
            }
          }}
        >
          Job Helper
        </a>
        <h1>{activePanelTab === "tailor" ? "Tailor Resume" : "Personal Info"}</h1>
      </header>

      <section className="auth-card">
        <div className="auth-identity">
          {authState.status === "signedIn" && (
            <div className="auth-avatar" aria-hidden="true">
              {authState.session.user.image ? (
                <span
                  className="auth-avatar-image"
                  style={{
                    backgroundImage: `url(${JSON.stringify(authState.session.user.image)})`,
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

      <nav className="panel-tabs" aria-label="Job Helper sections">
        <button
          aria-current={activePanelTab === "tailor" ? "page" : undefined}
          className={`panel-tab ${activePanelTab === "tailor" ? "panel-tab-active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("tailor")}
        >
          Tailor
        </button>
        <button
          aria-current={activePanelTab === "personal" ? "page" : undefined}
          className={`panel-tab ${activePanelTab === "personal" ? "panel-tab-active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("personal")}
        >
          Personal
        </button>
      </nav>

      {activePanelTab === "tailor" ? (
        <>
          <div className="action-grid">
            <button
              className="primary-action"
              disabled={captureState === "running" || authState.status !== "signedIn"}
              type="button"
              onClick={handleTailorCurrentPage}
            >
              {captureState === "running" ? "Tailoring..." : "Tailor Current Page"}
            </button>
          </div>

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
        </>
      ) : (
        <>
          <section className="snapshot-card tailored-resume-card collapsible-card">
            <button
              aria-controls="personal-tailored-resumes-content"
              aria-expanded={!isTailoredResumesCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("tailoredResumes")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${isTailoredResumesCollapsed ? "" : "collapse-chevron-open"}`}
                />
                <span className="collapsible-heading-title">
                  Tailored resumes
                </span>
              </span>
              {personalInfo ? (
                <span className="collapsible-heading-badge">
                  {personalInfo.tailoredResumes.length}
                </span>
              ) : null}
            </button>
            {!isTailoredResumesCollapsed ? (
              <div id="personal-tailored-resumes-content">
                {authState.status !== "signedIn" ? (
                  <p className="placeholder">Connect Google to load saved resumes.</p>
                ) : personalInfoState.status === "loading" ? (
                  <p className="placeholder">Loading tailored resumes...</p>
                ) : personalInfoState.status === "error" ? (
                  <p className="placeholder">{personalInfoState.error}</p>
                ) : !personalInfo || personalInfo.tailoredResumes.length === 0 ? (
                  <p className="placeholder">No tailored resumes yet.</p>
                ) : (
                  <div className="tailored-resume-list">
                    {personalInfo.tailoredResumes.map((tailoredResume) => (
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
              </div>
            ) : null}
          </section>

          <section className="snapshot-card applications-card collapsible-card">
            <button
              aria-controls="personal-applications-content"
              aria-expanded={!isApplicationsCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("applications")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${isApplicationsCollapsed ? "" : "collapse-chevron-open"}`}
                />
                <span className="collapsible-heading-title">Tracked apps</span>
              </span>
              {personalInfo ? (
                <span className="collapsible-heading-badge">
                  {personalInfo.applicationCount}
                </span>
              ) : null}
            </button>
            {!isApplicationsCollapsed ? (
              <div id="personal-applications-content">
                {authState.status !== "signedIn" ? (
                  <p className="placeholder">Connect Google to load applications.</p>
                ) : personalInfoState.status === "loading" ? (
                  <p className="placeholder">Loading tracked applications...</p>
                ) : personalInfoState.status === "error" ? (
                  <p className="placeholder">{personalInfoState.error}</p>
                ) : !personalInfo || personalInfo.applications.length === 0 ? (
                  <p className="placeholder">No tracked applications yet.</p>
                ) : (
                  <div className="application-list">
                    {personalInfo.applications.map((application) => (
                      <button
                        key={application.id}
                        className="application-row"
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
                    ))}
                  </div>
                )}
                {personalInfo && personalInfo.applicationCount > personalInfo.applications.length ? (
                  <button
                    className="link-action more-action"
                    disabled={authActionState === "running"}
                    type="button"
                    onClick={handleOpenApplicationsDashboard}
                  >
                    View all applications
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="snapshot-card resume-preview-card collapsible-card">
            <button
              aria-controls="personal-resume-content"
              aria-expanded={!isResumeCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("resume")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${isResumeCollapsed ? "" : "collapse-chevron-open"}`}
                />
                <span className="collapsible-heading-title">Resume</span>
              </span>
            </button>
            {!isResumeCollapsed ? (
              <div id="personal-resume-content">
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
                          <p className="preview-error">{resumePreviewState.error}</p>
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
        </>
      )}
    </main>
  );
}

export default App;
