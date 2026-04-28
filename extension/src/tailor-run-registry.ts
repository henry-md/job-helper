import {
  normalizeComparableUrl,
  readJobUrlFromPageContext,
  type JobPageContext,
} from "./job-helper.ts";

function cleanText(value: string | null | undefined) {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();
  return normalizedValue || null;
}

export function buildTailorRunRegistryKey(value: string | null | undefined) {
  return normalizeComparableUrl(cleanText(value));
}

export function readTailorRunRegistryKeyFromPage(input: {
  canonicalUrl?: string | null;
  jobUrl?: string | null;
  pageUrl?: string | null;
}) {
  return (
    buildTailorRunRegistryKey(input.jobUrl) ??
    buildTailorRunRegistryKey(input.canonicalUrl) ??
    buildTailorRunRegistryKey(input.pageUrl)
  );
}

export function readTailorRunRegistryKeyFromPageContext(
  pageContext: JobPageContext | null,
) {
  if (!pageContext) {
    return null;
  }

  return readTailorRunRegistryKeyFromPage({
    canonicalUrl: pageContext.canonicalUrl,
    jobUrl: readJobUrlFromPageContext(pageContext),
    pageUrl: pageContext.url,
  });
}

export function readTailorRunRegistryKeyFromTab(tab: chrome.tabs.Tab | null) {
  return readTailorRunRegistryKeyFromPage({
    pageUrl: cleanText(tab?.url) || null,
  });
}
