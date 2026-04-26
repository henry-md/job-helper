import type { TailorResumeRunRecord } from "./job-helper";

type TailorRunStorageRegistry<T> = Record<string, T>;

export function buildTailoringRunsRefreshKey(
  runsByKey: TailorRunStorageRegistry<TailorResumeRunRecord>,
) {
  return Object.entries(runsByKey)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([registryKey, run]) =>
      [
        registryKey,
        run.capturedAt,
        run.status,
        run.tailoredResumeId ?? "",
      ].join("::"),
    )
    .join("|");
}
