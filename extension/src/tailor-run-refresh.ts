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
        run.failureKind ?? "",
        run.generationStep?.stepNumber ?? "",
        run.generationStep?.stepCount ?? "",
        run.generationStep?.status ?? "",
        run.generationStep?.retrying === true ? "retrying" : "",
        run.generationStep?.attempt ?? "",
        run.generationStep?.summary ?? "",
        run.generationStep?.detail ?? "",
        run.message,
        run.tailoredResumeError ?? "",
        run.tailoredResumeId ?? "",
      ].join("::"),
    )
    .join("|");
}
