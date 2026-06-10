import type { TailorResumeRunRecord } from "./job-helper";

type TailorRunStorageRegistry<T> = Record<string, T>;
type TailorRunRefreshStep = NonNullable<TailorResumeRunRecord["generationStep"]>;

function buildTailorRunTechnologyRefreshKey(
  technologies: TailorRunRefreshStep["emphasizedTechnologies"],
) {
  return (technologies ?? [])
    .map((technology) =>
      [
        technology.priority,
        technology.classification ?? "",
        technology.name,
        technology.evidence,
      ].join("~"),
    )
    .join(",");
}

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
        buildTailorRunTechnologyRefreshKey(
          run.generationStep?.blockingTechnologies,
        ),
        buildTailorRunTechnologyRefreshKey(
          run.generationStep?.emphasizedTechnologies,
        ),
        ...(run.generationStepTimings ?? []).flatMap((timing) => [
          timing.stepNumber,
          timing.status,
          timing.retrying === true ? "retrying" : "",
          timing.durationMs,
          timing.model ?? "",
          timing.observedAt ?? "",
          buildTailorRunTechnologyRefreshKey(timing.blockingTechnologies),
          buildTailorRunTechnologyRefreshKey(timing.emphasizedTechnologies),
        ]),
        run.message,
        run.tailoredResumeError ?? "",
        run.tailoredResumeId ?? "",
      ].join("::"),
    )
    .join("|");
}
