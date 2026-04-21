import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
  DEFAULT_DASHBOARD_URL,
  LAST_TAILORING_STORAGE_KEY,
  type JobPageContext,
  type TailorResumeRunRecord,
} from "./job-helper";

type PanelState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: JobPageContext }
  | { status: "error"; error: string; snapshot: null };

type CaptureState = "idle" | "running" | "sent" | "error";

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

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "JOB_HELPER_CAPTURE_PAGE",
  });

  if (!response?.ok) {
    throw new Error(
      response?.error ?? "The content script did not return page details.",
    );
  }

  return (response.pageContext ?? response.snapshot) as JobPageContext;
}

function App() {
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the active page.",
        snapshot: null,
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
            error:
              error instanceof Error
                ? error.message
                : "Failed to read the active page.",
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
    await chrome.tabs.create({
      url: DEFAULT_DASHBOARD_URL,
    });
  }

  return (
    <main className="side-panel-shell">
      <header className="panel-header">
        <p className="eyebrow">Job Helper</p>
        <h1>Tailor Resume</h1>
      </header>

      <div className="action-grid">
        <button
          className="primary-action"
          disabled={captureState === "running"}
          type="button"
          onClick={handleTailorCurrentPage}
        >
          {captureState === "running" ? "Tailoring..." : "Tailor Current Page"}
        </button>
        <button className="secondary-action" type="button" onClick={loadSnapshot}>
          Refresh Page
        </button>
      </div>

      <button className="link-action" type="button" onClick={handleOpenDashboard}>
        Open Dashboard
      </button>

      <div className="status-row">
        <span className={`status-dot status-dot-${state.status}`} />
        <span className="status-text">
          {captureState === "running" && "Starting Tailor Resume"}
          {captureState === "sent" &&
            "Tailoring started. Results will appear here."}
          {captureState === "error" && "Could not start Tailor Resume."}
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
