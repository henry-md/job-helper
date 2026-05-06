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
    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}

export function currentUrlMatchesSavedJobUrl(input: {
  currentUrl: string | null | undefined;
  savedJobUrl: string | null | undefined;
}) {
  const normalizedCurrentUrl = normalizeComparableUrl(input.currentUrl);
  const normalizedSavedJobUrl = normalizeComparableUrl(input.savedJobUrl);

  return Boolean(
    normalizedCurrentUrl &&
      normalizedSavedJobUrl &&
      normalizedCurrentUrl === normalizedSavedJobUrl,
  );
}
