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
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
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
