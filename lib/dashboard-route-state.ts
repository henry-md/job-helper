export type DashboardTabId = "new" | "settings" | "tailor";

export type DashboardRouteState = {
  tab: DashboardTabId;
  tailoredResumeId: string | null;
};

type DashboardSearchParamsLike = {
  get(name: string): string | null;
};

function normalizeRouteParamValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

export function parseDashboardRouteState(input?: {
  tab?: string | null | undefined;
  tailoredResumeId?: string | null | undefined;
}): DashboardRouteState {
  const tab =
    input?.tab === "new"
      ? "new"
      : input?.tab === "settings"
        ? "settings"
        : "tailor";
  const tailoredResumeId =
    tab === "tailor"
      ? normalizeRouteParamValue(input?.tailoredResumeId)
      : null;

  return {
    tab,
    tailoredResumeId,
  };
}

export function parseDashboardRouteStateFromSearchParams(
  searchParams: DashboardSearchParamsLike,
) {
  return parseDashboardRouteState({
    tab: searchParams.get("tab"),
    tailoredResumeId: searchParams.get("tailoredResumeId"),
  });
}

export function buildDashboardHref(input: {
  tab?: DashboardTabId | null | undefined;
  tailoredResumeId?: string | null | undefined;
}) {
  const routeState = parseDashboardRouteState({
    tab: input.tab,
    tailoredResumeId: input.tailoredResumeId,
  });
  const searchParams = new URLSearchParams();

  if (routeState.tab === "new" || routeState.tab === "settings") {
    searchParams.set("tab", routeState.tab);
  }

  if (routeState.tab === "tailor" && routeState.tailoredResumeId) {
    searchParams.set("tailoredResumeId", routeState.tailoredResumeId);
  }

  const queryString = searchParams.toString();

  return queryString ? `/dashboard?${queryString}` : "/dashboard";
}
