import type { JobPageContext } from "./job-helper";

export type PageContextMessageType =
  | "JOB_HELPER_CAPTURE_PAGE"
  | "JOB_HELPER_COLLECT_PAGE_CONTEXT";

type PageContextResponse = {
  error?: unknown;
  ok?: unknown;
  pageContext?: unknown;
  snapshot?: unknown;
};

export const PAGE_CONTEXT_UNAVAILABLE_MESSAGE =
  "Could not read this page. Refresh the tab, then try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : fallbackMessage;
}

export function isPageContextConnectionError(error: unknown) {
  const message = readErrorMessage(error, "").toLowerCase();

  return (
    message.includes("receiving end does not exist") ||
    message.includes("could not establish connection")
  );
}

export function formatPageContextErrorMessage(
  error: unknown,
  fallbackMessage = "Failed to read the active page.",
) {
  if (isPageContextConnectionError(error)) {
    return PAGE_CONTEXT_UNAVAILABLE_MESSAGE;
  }

  return readErrorMessage(error, fallbackMessage);
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isJobPageContext(value: unknown): value is JobPageContext {
  return (
    isRecord(value) &&
    typeof value.canonicalUrl === "string" &&
    isStringArray(value.companyCandidates) &&
    typeof value.description === "string" &&
    isStringArray(value.employmentTypeCandidates) &&
    isStringArray(value.headings) &&
    Array.isArray(value.jsonLdJobPostings) &&
    isStringArray(value.locationCandidates) &&
    typeof value.rawText === "string" &&
    isStringArray(value.salaryMentions) &&
    typeof value.selectionText === "string" &&
    typeof value.siteName === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.titleCandidates) &&
    isStringArray(value.topTextBlocks) &&
    typeof value.url === "string"
  );
}

function readResponseError(response: PageContextResponse) {
  return typeof response.error === "string" && response.error.trim()
    ? response.error
    : "The content script did not return page details.";
}

async function requestPageContext(
  tabId: number,
  messageType: PageContextMessageType,
) {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: messageType,
  })) as PageContextResponse | undefined;

  if (!isRecord(response) || response.ok !== true) {
    throw new Error(
      response && isRecord(response)
        ? readResponseError(response)
        : "The content script did not return page details.",
    );
  }

  const pageContext = response.pageContext ?? response.snapshot;

  if (!isJobPageContext(pageContext)) {
    throw new Error("The content script returned unusable page details.");
  }

  return pageContext;
}

function readContentScriptFiles() {
  const manifest = chrome.runtime.getManifest();
  const contentScript = manifest.content_scripts?.find(
    (script) => Array.isArray(script.js) && script.js.length > 0,
  );

  return contentScript?.js ?? [];
}

async function injectContentScript(tabId: number) {
  const files = readContentScriptFiles();

  if (files.length === 0) {
    throw new Error("The Job Helper content script is not available.");
  }

  await chrome.scripting.executeScript({
    files,
    target: { tabId },
  });
}

export async function collectPageContextFromTab(
  tabId: number,
  messageType: PageContextMessageType,
) {
  try {
    return await requestPageContext(tabId, messageType);
  } catch (firstError) {
    try {
      await injectContentScript(tabId);
    } catch {
      throw new Error(formatPageContextErrorMessage(firstError));
    }
  }

  try {
    return await requestPageContext(tabId, messageType);
  } catch (secondError) {
    throw new Error(formatPageContextErrorMessage(secondError));
  }
}
