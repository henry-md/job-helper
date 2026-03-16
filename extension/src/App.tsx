import { useEffect, useState } from "react";
import "./App.css";
import {
  CAPTURE_COMMAND_NAME,
  LAST_INGESTION_STORAGE_KEY,
  type IngestionRecord,
  type JobPageContext,
} from "./job-helper";

type PopupState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: JobPageContext }
  | { status: "error"; error: string; snapshot: null };

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
  const [state, setState] = useState<PopupState>({
    status: "idle",
    snapshot: null,
  });
  const [lastIngestion, setLastIngestion] = useState<IngestionRecord | null>(null);

  useEffect(() => {
    void (async () => {
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
    })();
  }, []);

  useEffect(() => {
    void chrome.storage.local
      .get(LAST_INGESTION_STORAGE_KEY)
      .then((result) => {
        const storedValue = result[LAST_INGESTION_STORAGE_KEY];

        if (storedValue) {
          setLastIngestion(storedValue as IngestionRecord);
        }
      });

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[LAST_INGESTION_STORAGE_KEY]) {
        return;
      }

      setLastIngestion(
        (changes[LAST_INGESTION_STORAGE_KEY].newValue as IngestionRecord | null) ?? null,
      );
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  return (
    <main className="popup-shell">
      <section className="panel">
        <p className="eyebrow">Job Helper Extension</p>
        <h1>Chrome capture starter</h1>
        <p className="lede">
          Press <code>Cmd+Shift+S</code> on macOS to capture the current page, scrape
          structured browser evidence, and send it to Job Helper.
        </p>

        <div className="status-row">
          <span className={`status-dot status-dot-${state.status}`} />
          <span className="status-text">
            {state.status === "idle" && "Waiting for page details"}
            {state.status === "loading" && "Reading the active tab"}
            {state.status === "ready" && "Page details loaded"}
            {state.status === "error" && state.error}
          </span>
        </div>

        <section className="snapshot-card">
          <h2>Last ingestion</h2>
          {lastIngestion ? (
            <dl className="snapshot-grid">
              <div>
                <dt>Status</dt>
                <dd>{lastIngestion.message}</dd>
              </div>
              <div>
                <dt>Captured at</dt>
                <dd>{new Date(lastIngestion.capturedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Extracted title</dt>
                <dd>{lastIngestion.extraction?.jobTitle || "No title extracted."}</dd>
              </div>
              <div>
                <dt>Extracted company</dt>
                <dd>
                  {lastIngestion.extraction?.companyName || "No company extracted."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="placeholder">
              Run the <code>{CAPTURE_COMMAND_NAME}</code> shortcut once to store the
              latest ingestion result here.
            </p>
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
              Open the popup on a regular web page to verify the extension wiring.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
