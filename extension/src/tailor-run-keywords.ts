import {
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  readTailorResumeGenerationStepSummary,
  readTailorResumeGenerationStepTimings,
  type TailorResumeRunRecord,
  type TailoredResumeEmphasizedTechnology,
} from "./job-helper.ts";
import {
  matchesTailorOverwritePageIdentity,
  type TailorOverwritePageIdentity,
} from "./tailor-overwrite-guard.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function readStoredTailoringRunRecord(
  value: unknown,
): TailorResumeRunRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const capturedAt = typeof value.capturedAt === "string" ? value.capturedAt : "";
  const message = typeof value.message === "string" ? value.message : "";
  const status =
    value.status === "error" ||
    value.status === "needs_input" ||
    value.status === "running" ||
    value.status === "success"
      ? value.status
      : null;

  if (!capturedAt || !message || !status) {
    return null;
  }

  return {
    applicationId: readNullableString(value.applicationId),
    capturedAt,
    companyName: readNullableString(value.companyName),
    endpoint:
      typeof value.endpoint === "string"
        ? value.endpoint
        : DEFAULT_TAILOR_RESUME_ENDPOINT,
    failureKind: value.failureKind === "page_capture" ? "page_capture" : null,
    generationStep: readTailorResumeGenerationStepSummary(value.generationStep),
    generationStepTimings: readTailorResumeGenerationStepTimings(
      value.generationStepTimings,
    ),
    jobIdentifier: readNullableString(value.jobIdentifier),
    message,
    pageTitle: readNullableString(value.pageTitle),
    pageUrl: readNullableString(value.pageUrl),
    positionTitle: readNullableString(value.positionTitle),
    status,
    suppressedTailoredResumeId: readNullableString(
      value.suppressedTailoredResumeId,
    ),
    tailoredResumeError: readNullableString(value.tailoredResumeError),
    tailoredResumeId: readNullableString(value.tailoredResumeId),
  };
}

export function readTailorRunKeywordTechnologies(
  run: Pick<TailorResumeRunRecord, "generationStep" | "generationStepTimings">,
) {
  const stepTimings = run.generationStepTimings ?? [];

  for (let index = stepTimings.length - 1; index >= 0; index -= 1) {
    const timing = stepTimings[index];
    const technologies = timing?.emphasizedTechnologies ?? [];

    if (timing?.stepNumber === 1 && technologies.length > 0) {
      return technologies;
    }
  }

  const generationStepTechnologies =
    run.generationStep?.emphasizedTechnologies ?? [];

  if (
    run.generationStep?.stepNumber === 1 &&
    generationStepTechnologies.length > 0
  ) {
    return generationStepTechnologies;
  }

  if (generationStepTechnologies.length > 0) {
    return generationStepTechnologies;
  }

  for (let index = stepTimings.length - 1; index >= 0; index -= 1) {
    const technologies = stepTimings[index]?.emphasizedTechnologies ?? [];

    if (technologies.length > 0) {
      return technologies;
    }
  }

  return [] satisfies TailoredResumeEmphasizedTechnology[];
}

export function isActiveTailoringRunForKeywords(run: TailorResumeRunRecord) {
  return run.status === "running" || run.status === "needs_input";
}

export function resolveActiveTailorRunKeywordBadge(input: {
  pageIdentity: TailorOverwritePageIdentity;
  runs: TailorResumeRunRecord[];
}) {
  const matchingRun =
    input.runs
      .filter(
        (run) =>
          isActiveTailoringRunForKeywords(run) &&
          matchesTailorOverwritePageIdentity({
            jobUrl: run.pageUrl,
            pageIdentity: input.pageIdentity,
          }),
      )
      .sort(
        (left, right) =>
          readTimestamp(right.capturedAt) - readTimestamp(left.capturedAt),
      )[0] ?? null;

  if (!matchingRun) {
    return null;
  }

  return {
    run: matchingRun,
    technologies: readTailorRunKeywordTechnologies(matchingRun).filter(
      (technology) => Boolean(technology.name.trim()),
    ),
  };
}
