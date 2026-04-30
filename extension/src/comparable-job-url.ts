const COMPARABLE_URL_QUERY_PARAM_ALLOWLIST = new Set([
  "gh_jid",
  "jid",
  "job_id",
  "jobid",
  "jk",
  "pid",
  "req_id",
  "reqid",
]);

function normalizeWorkdayJobPath(parsedUrl: URL) {
  if (!parsedUrl.hostname.toLowerCase().endsWith(".myworkdayjobs.com")) {
    return;
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const jobSegmentIndex = pathSegments.findIndex(
    (segment) => segment.toLowerCase() === "job",
  );

  if (jobSegmentIndex < 1 || jobSegmentIndex >= pathSegments.length - 1) {
    return;
  }

  const postingSegment = pathSegments.at(-1);

  if (!postingSegment) {
    return;
  }

  parsedUrl.pathname = ["", "job", postingSegment].join("/");
}

export function normalizeComparableUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    parsedUrl.hash = "";
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      // Treat http/https variants of the same posting as one comparable URL.
      parsedUrl.protocol = "https:";
    }
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    normalizeWorkdayJobPath(parsedUrl);
    const comparableQueryEntries = [...parsedUrl.searchParams.entries()]
      .map(([key, entryValue]) => [key.toLowerCase(), entryValue.trim()] as const)
      .filter(
        ([key, entryValue]) =>
          entryValue.length > 0 &&
          COMPARABLE_URL_QUERY_PARAM_ALLOWLIST.has(key),
      )
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey
          ? leftValue.localeCompare(rightValue)
          : leftKey.localeCompare(rightKey),
      );
    const comparableSearchParams = new URLSearchParams();

    for (const [key, entryValue] of comparableQueryEntries) {
      comparableSearchParams.append(key, entryValue);
    }

    parsedUrl.search = comparableSearchParams.toString()
      ? `?${comparableSearchParams.toString()}`
      : "";
    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}
