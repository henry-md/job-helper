import { useEffect, useState } from "react";
import "./App.css";

type PageSnapshot = {
  description: string;
  title: string;
  url: string;
};

type PopupState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: PageSnapshot }
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

  return response.snapshot as PageSnapshot;
}

function App() {
  const [state, setState] = useState<PopupState>({
    status: "idle",
    snapshot: null,
  });

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

  return (
    <main className="popup-shell">
      <section className="panel">
        <p className="eyebrow">Job Helper Extension</p>
        <h1>Chrome capture starter</h1>
        <p className="lede">
          This starter reads the active tab title, URL, and meta description through a
          content script. Build on this to send structured job-page data to your app.
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
