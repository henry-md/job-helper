import {
  CAPTURE_COMMAND_NAME,
  DEFAULT_INGEST_ENDPOINT,
  LAST_INGESTION_STORAGE_KEY,
  type IngestionRecord,
  type JobPageContext,
} from "./job-helper";
type OverlayTone = "error" | "info" | "success";
let isCaptureInFlight = false;

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

async function captureVisibleTabDataUrl(windowId?: number) {
  try {
    if (typeof windowId === "number") {
      return await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
    }

    return await chrome.tabs.captureVisibleTab({
      format: "png",
    });
  } catch {
    return null;
  }
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
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
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "JOB_HELPER_COLLECT_PAGE_CONTEXT",
    });

    if (!response?.ok) {
      return null;
    }

    return response.pageContext as JobPageContext;
  } catch {
    return null;
  }
}

async function persistResult(record: IngestionRecord) {
  await chrome.storage.local.set({
    [LAST_INGESTION_STORAGE_KEY]: record,
  });
}

function buildSuccessMessage(record: IngestionRecord) {
  const jobTitle = record.extraction?.jobTitle?.trim();
  const companyName = record.extraction?.companyName?.trim();

  if (jobTitle && companyName) {
    return `Saved ${jobTitle} at ${companyName}`;
  }

  return "Saved job evidence to Job Helper";
}

async function ingestActiveTab() {
  const activeTab = await getActiveTab();
  const tabId = activeTab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  const screenshotDataUrl = await captureVisibleTabDataUrl(activeTab.windowId);
  await showOverlay(tabId, "Job Helper read Cmd+Shift+S", "info");

  const pageContext = await collectPageContext(tabId);

  if (!pageContext && !screenshotDataUrl) {
    throw new Error("Could not read the page or capture a screenshot.");
  }

  const formData = new FormData();
  formData.append("source", "chrome_extension");

  if (pageContext) {
    formData.append("pageContext", JSON.stringify(pageContext));
  }

  if (screenshotDataUrl) {
    const screenshotBlob = await dataUrlToBlob(screenshotDataUrl);
    formData.append("jobScreenshots", screenshotBlob, "browser-capture.png");
  }

  const response = await fetch(DEFAULT_INGEST_ENDPOINT, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "The ingestion endpoint returned an error.",
    );
  }

  const extraction =
    typeof payload.extraction === "object" && payload.extraction !== null
      ? (payload.extraction as Record<string, unknown>)
      : null;
  const evidence =
    typeof payload.evidence === "object" && payload.evidence !== null
      ? (payload.evidence as {
          hasPageContext: boolean;
          screenshotCount: number;
          source: string;
        })
      : null;
  const application =
    typeof payload.application === "object" && payload.application !== null
      ? (payload.application as { id?: string })
      : null;
  const record: IngestionRecord = {
    applicationId: application?.id ?? null,
    capturedAt: new Date().toISOString(),
    endpoint: DEFAULT_INGEST_ENDPOINT,
    evidence,
    extraction: extraction
      ? {
          companyName:
            typeof extraction.companyName === "string" ? extraction.companyName : null,
          employmentType:
            typeof extraction.employmentType === "string"
              ? extraction.employmentType
              : null,
          jobTitle: typeof extraction.jobTitle === "string" ? extraction.jobTitle : null,
          jobUrl: typeof extraction.jobUrl === "string" ? extraction.jobUrl : null,
          location: typeof extraction.location === "string" ? extraction.location : null,
          salaryRange:
            typeof extraction.salaryRange === "string" ? extraction.salaryRange : null,
          status: typeof extraction.status === "string" ? extraction.status : null,
        }
      : null,
    message: "Saved job evidence to Job Helper.",
    status: "success",
  };

  record.message = buildSuccessMessage(record);

  await persistResult(record);
  await showOverlay(tabId, record.message, "success");
}

async function runCaptureFlow() {
  if (isCaptureInFlight) {
    return;
  }

  isCaptureInFlight = true;

  try {
    await ingestActiveTab();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ingest the active page.";

    const record: IngestionRecord = {
      applicationId: null,
      capturedAt: new Date().toISOString(),
      endpoint: DEFAULT_INGEST_ENDPOINT,
      evidence: null,
      extraction: null,
      message,
      status: "error",
    };

    await persistResult(record);

    try {
      const activeTab = await getActiveTab();

      if (typeof activeTab.id === "number") {
        await showOverlay(activeTab.id, message, "error");
      }
    } catch {
      // Ignore follow-up UI failures after persisting the error.
    }
  } finally {
    isCaptureInFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Job Helper extension installed.");
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== CAPTURE_COMMAND_NAME) {
    return;
  }

  void runCaptureFlow();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const typedMessage =
    typeof message === "object" && message !== null
      ? (message as { type?: string })
      : null;

  if (typedMessage?.type !== "JOB_HELPER_TRIGGER_CAPTURE") {
    return;
  }

  void runCaptureFlow();
});
