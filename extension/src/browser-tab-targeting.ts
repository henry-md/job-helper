type BrowserTabLike = {
  active?: boolean;
  pendingUrl?: string;
  url?: string;
};

export function normalizeExactTabMatchUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    parsedUrl.hash = "";
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    const normalizedSearchParams = new URLSearchParams();
    const sortedSearchEntries = [...parsedUrl.searchParams.entries()].sort(
      ([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey !== rightKey) {
          return leftKey.localeCompare(rightKey);
        }

        return leftValue.localeCompare(rightValue);
      },
    );

    for (const [key, value] of sortedSearchEntries) {
      normalizedSearchParams.append(key, value);
    }

    parsedUrl.search = normalizedSearchParams.toString();

    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}

export function readExactComparableTabUrl(tab: BrowserTabLike) {
  const comparablePendingUrl = normalizeExactTabMatchUrl(tab.pendingUrl);

  if (comparablePendingUrl) {
    return comparablePendingUrl;
  }

  return normalizeExactTabMatchUrl(tab.url);
}

export function findMatchingCurrentWindowTabForUrl<T extends BrowserTabLike>(
  tabs: readonly T[],
  url: string,
) {
  const normalizedTargetUrl = normalizeExactTabMatchUrl(url);

  if (!normalizedTargetUrl) {
    return null;
  }

  const matchingTabs = tabs.filter(
    (tab) => readExactComparableTabUrl(tab) === normalizedTargetUrl,
  );

  matchingTabs.sort((left, right) => {
    const leftActive = left.active ? 1 : 0;
    const rightActive = right.active ? 1 : 0;
    return rightActive - leftActive;
  });

  return matchingTabs[0] ?? null;
}
