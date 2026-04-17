import {
  CAPTURE_COMMAND_NAME,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
  type JobPageContext,
  type TailorResumeRunRecord,
} from "./job-helper";

type OverlayTone = "error" | "info" | "success";

type TailorResumeSummary = {
  companyName: string | null;
  id: string | null;
  positionTitle: string | null;
  status: string | null;
};

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

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = cleanText(value);

    if (!normalizedValue) {
      continue;
    }

    const dedupeKey = normalizedValue.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalizedValue);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildSummaryLine(label: string, values: string[], limit = 6) {
  const normalizedValues = uniqueStrings(values, limit);

  if (normalizedValues.length === 0) {
    return null;
  }

  return `${label}: ${normalizedValues.join(", ")}`;
}

function formatStructuredPosting(
  posting: JobPageContext["jsonLdJobPostings"][number],
  index: number,
) {
  const lines = [
    posting.title ? `Title: ${posting.title}` : null,
    posting.hiringOrganization
      ? `Company: ${posting.hiringOrganization}`
      : null,
    buildSummaryLine("Employment type", posting.employmentType),
    buildSummaryLine("Locations", posting.locations),
    buildSummaryLine("Compensation", posting.baseSalary),
    posting.datePosted ? `Date posted: ${posting.datePosted}` : null,
    posting.validThrough ? `Valid through: ${posting.validThrough}` : null,
    posting.identifier ? `Identifier: ${posting.identifier}` : null,
    posting.directApply === true
      ? "Direct apply: yes"
      : posting.directApply === false
        ? "Direct apply: no"
        : null,
    posting.description ? `Description:\n${posting.description}` : null,
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return null;
  }

  return [`Structured job posting ${index + 1}:`, ...lines].join("\n");
}

function buildJobDescriptionFromPageContext(pageContext: JobPageContext) {
  const sections: string[] = [];
  const summaryLines = [
    pageContext.url ? `URL: ${pageContext.url}` : null,
    pageContext.canonicalUrl &&
    pageContext.canonicalUrl !== pageContext.url
      ? `Canonical URL: ${pageContext.canonicalUrl}`
      : null,
    pageContext.title ? `Page title: ${pageContext.title}` : null,
    pageContext.siteName ? `Site name: ${pageContext.siteName}` : null,
    pageContext.description
      ? `Meta description: ${pageContext.description}`
      : null,
    buildSummaryLine("Role title hints", pageContext.titleCandidates),
    buildSummaryLine("Company hints", pageContext.companyCandidates),
    buildSummaryLine("Location hints", pageContext.locationCandidates),
    buildSummaryLine(
      "Employment type hints",
      pageContext.employmentTypeCandidates,
    ),
    buildSummaryLine("Salary hints", pageContext.salaryMentions),
    buildSummaryLine("Visible headings", pageContext.headings, 12),
  ].filter((line): line is string => Boolean(line));

  if (summaryLines.length > 0) {
    sections.push(["Job page summary:", ...summaryLines].join("\n"));
  }

  if (pageContext.selectionText) {
    sections.push(`Selected text from the page:\n${pageContext.selectionText}`);
  }

  const structuredPostings = pageContext.jsonLdJobPostings
    .map(formatStructuredPosting)
    .filter((section): section is string => Boolean(section));

  if (structuredPostings.length > 0) {
    sections.push(structuredPostings.join("\n\n"));
  }

  const topTextBlocks = uniqueStrings(pageContext.topTextBlocks, 5);

  if (topTextBlocks.length > 0) {
    sections.push(
      [
        "Main page text:",
        ...topTextBlocks.map(
          (block, index) => `Section ${index + 1}:\n${block}`,
        ),
      ].join("\n\n"),
    );
  }

  if (pageContext.rawText) {
    sections.push(`Full flattened page text:\n${pageContext.rawText}`);
  }

  return sections.join("\n\n").trim();
}

function readLatestTailoredResume(payload: Record<string, unknown>) {
  const profile =
    typeof payload.profile === "object" && payload.profile !== null
      ? (payload.profile as { tailoredResumes?: unknown })
      : null;
  const tailoredResumes = Array.isArray(profile?.tailoredResumes)
    ? profile.tailoredResumes
    : [];
  const latestTailoredResume = tailoredResumes[0];

  if (
    typeof latestTailoredResume !== "object" ||
    latestTailoredResume === null
  ) {
    return null;
  }

  const summary = latestTailoredResume as Record<string, unknown>;

  return {
    companyName:
      typeof summary.companyName === "string" ? summary.companyName : null,
    id: typeof summary.id === "string" ? summary.id : null,
    positionTitle:
      typeof summary.positionTitle === "string" ? summary.positionTitle : null,
    status: typeof summary.status === "string" ? summary.status : null,
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
    return `Saved a tailored draft for ${jobLabel}, but it needs review`;
  }

  return `Tailored resume for ${jobLabel}`;
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

async function persistResult(record: TailorResumeRunRecord) {
  await chrome.storage.local.set({
    [LAST_TAILORING_STORAGE_KEY]: record,
  });
}

async function tailorResumeForActiveTab() {
  const activeTab = await getActiveTab();
  const tabId = activeTab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  await showOverlay(tabId, "Job Helper is reading this job post", "info");

  const pageContext = await collectPageContext(tabId);

  if (!pageContext) {
    throw new Error("Could not read the current page.");
  }

  const jobDescription = buildJobDescriptionFromPageContext(pageContext);

  if (!jobDescription) {
    throw new Error("Could not find job description text on this page.");
  }

  await showOverlay(tabId, "Tailoring your resume for this job...", "info");

  const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
    method: "PATCH",
    body: JSON.stringify({
      action: "tailor",
      jobDescription,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "The Tailor Resume endpoint returned an error.",
    );
  }

  if (typeof payload.profile !== "object" || payload.profile === null) {
    throw new Error("Tailor Resume did not return a saved result.");
  }

  const latestTailoredResume = readLatestTailoredResume(payload);
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

  record.message = buildSuccessMessage(record);

  await persistResult(record);
  await showOverlay(
    tabId,
    record.message,
    record.status === "success" ? "success" : "error",
  );
}

async function runCaptureFlow() {
  if (isCaptureInFlight) {
    return;
  }

  isCaptureInFlight = true;

  try {
    await tailorResumeForActiveTab();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to tailor the resume.";

    const record: TailorResumeRunRecord = {
      capturedAt: new Date().toISOString(),
      companyName: null,
      endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
      message,
      pageTitle: null,
      pageUrl: null,
      positionTitle: null,
      status: "error",
      tailoredResumeError: null,
      tailoredResumeId: null,
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
