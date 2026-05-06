import { normalizeComparableUrl } from "./job-helper.ts";

function cleanText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function comparableJobUrlsMatch(left: string, right: string) {
  return left === right;
}

export function normalizeTailoredResumeBadgeTargetUrls(
  values: Array<string | null | undefined>,
) {
  const normalizedUrls: string[] = [];
  const seenUrls = new Set<string>();

  for (const value of values) {
    const normalizedUrl = normalizeComparableUrl(cleanText(value));

    if (!normalizedUrl || !isHttpUrl(normalizedUrl) || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    normalizedUrls.push(normalizedUrl);
  }

  return normalizedUrls;
}

export function tailoredResumeBadgeTargetMatchesTabUrl(input: {
  tabUrl: string | null | undefined;
  targetUrls: string[];
}) {
  const tabUrl = cleanText(input.tabUrl);

  if (!tabUrl || input.targetUrls.length === 0) {
    return false;
  }

  const comparableTabUrl = normalizeComparableUrl(tabUrl);

  if (!comparableTabUrl) {
    return false;
  }

  return input.targetUrls.some(
    (targetUrl) => comparableJobUrlsMatch(comparableTabUrl, targetUrl),
  );
}
