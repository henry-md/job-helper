import { getPrismaClient } from "./prisma.ts";
import type {
  AiUsageEventRecord,
  AiUsagePeriod,
  AiUsageResumeGroup,
  AiUsageReport,
  AiUsageSubjectStatus,
  AiUsageUrlGroup,
} from "./ai-usage-report-types.ts";

function normalizeSubjectStatus(value: string): AiUsageSubjectStatus {
  if (value === "ARCHIVED") {
    return "archived";
  }

  if (value === "DELETED") {
    return "deleted";
  }

  return "unarchived";
}

function normalizeStatus(value: string): "failed" | "succeeded" {
  return value === "FAILED" ? "failed" : "succeeded";
}

function addBigIntStrings(left: string, right: string) {
  return (BigInt(left) + BigInt(right)).toString();
}

export async function readAiUsageReport(input: {
  limit?: number;
  period?: AiUsagePeriod;
  userId: string;
}): Promise<AiUsageReport> {
  const period = input.period ?? "all";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(2000, Math.max(1, Math.floor(input.limit)))
      : 1000;
  const startedAfter = resolveAiUsagePeriodStart(period);
  const usageEvents = await getPrismaClient().aiUsageEvent.findMany({
    orderBy: [{ requestStartedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    where: {
      ...(startedAfter ? { requestStartedAt: { gte: startedAfter } } : {}),
      userId: input.userId,
    },
  });
  const events: AiUsageEventRecord[] = usageEvents.map((event) => ({
    applicationId: event.applicationId,
    attempt: event.attempt,
    cachedInputTokens: event.cachedInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    durationMs: event.durationMs,
    error: event.error,
    id: event.id,
    inputTokens: event.inputTokens,
    jobUrl: event.jobUrl,
    model: event.model,
    operation: event.operation,
    outputTokens: event.outputTokens,
    provider: event.provider.toLowerCase(),
    providerResponseId: event.providerResponseId,
    reasoningTokens: event.reasoningTokens,
    requestStartedAt: event.requestStartedAt.toISOString(),
    round: event.round,
    status: normalizeStatus(event.status),
    stepLabel: event.stepLabel,
    stepNumber: event.stepNumber,
    subjectStatus: normalizeSubjectStatus(event.subjectStatus),
    tailoredResumeId: event.tailoredResumeId,
    tailorResumeRunId: event.tailorResumeRunId,
    totalCostUsdMicros: event.totalCostUsdMicros.toString(),
    totalTokens: event.totalTokens,
  }));
  const summary = events.reduce(
    (current, event) => {
      current.eventCount += 1;
      current.failedEventCount += event.status === "failed" ? 1 : 0;
      current.inputTokens += event.inputTokens;
      current.outputTokens += event.outputTokens;
      current.totalTokens += event.totalTokens;
      current.totalCostUsdMicros = addBigIntStrings(
        current.totalCostUsdMicros,
        event.totalCostUsdMicros,
      );

      if (event.subjectStatus === "archived") {
        current.archivedCostUsdMicros = addBigIntStrings(
          current.archivedCostUsdMicros,
          event.totalCostUsdMicros,
        );
      } else if (event.subjectStatus === "deleted") {
        current.deletedCostUsdMicros = addBigIntStrings(
          current.deletedCostUsdMicros,
          event.totalCostUsdMicros,
        );
      } else {
        current.unarchivedCostUsdMicros = addBigIntStrings(
          current.unarchivedCostUsdMicros,
          event.totalCostUsdMicros,
        );
      }

      return current;
    },
    {
      archivedCostUsdMicros: "0",
      deletedCostUsdMicros: "0",
      eventCount: 0,
      failedEventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsdMicros: "0",
      totalTokens: 0,
      unarchivedCostUsdMicros: "0",
      urlCount: 0,
    },
  );
  const groupsByKey = new Map<string, AiUsageUrlGroup>();

  for (const event of events) {
    const key = event.jobUrl || event.applicationId || event.tailorResumeRunId || "unknown";
    const existingGroup = groupsByKey.get(key);

    if (existingGroup) {
      existingGroup.eventCount += 1;
      existingGroup.failedEventCount += event.status === "failed" ? 1 : 0;
      existingGroup.inputTokens += event.inputTokens;
      existingGroup.outputTokens += event.outputTokens;
      existingGroup.totalCostUsdMicros = addBigIntStrings(
        existingGroup.totalCostUsdMicros,
        event.totalCostUsdMicros,
      );
      existingGroup.totalTokens += event.totalTokens;
      existingGroup.status =
        existingGroup.status === "deleted" || event.subjectStatus === "deleted"
          ? "deleted"
          : existingGroup.status === "archived" || event.subjectStatus === "archived"
            ? "archived"
            : "unarchived";
      continue;
    }

    groupsByKey.set(key, {
      applicationId: event.applicationId,
      eventCount: 1,
      failedEventCount: event.status === "failed" ? 1 : 0,
      firstSeenAt: event.requestStartedAt,
      inputTokens: event.inputTokens,
      jobUrl: event.jobUrl,
      lastSeenAt: event.requestStartedAt,
      outputTokens: event.outputTokens,
      status: event.subjectStatus,
      totalCostUsdMicros: event.totalCostUsdMicros,
      totalTokens: event.totalTokens,
    });
  }

  const urlGroups = [...groupsByKey.values()].sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
  const resumeGroups = await buildAiUsageResumeGroups({
    events,
    startedAfter,
    userId: input.userId,
  });

  return {
    events,
    generatedAt: new Date().toISOString(),
    period,
    resumeGroups,
    summary: {
      ...summary,
      urlCount: urlGroups.length,
    },
    urlGroups,
  };
}

async function buildAiUsageResumeGroups(input: {
  events: AiUsageEventRecord[];
  startedAfter: Date | null;
  userId: string;
}) {
  const eventsByResumeId = new Map<string, AiUsageEventRecord[]>();

  for (const event of input.events) {
    if (!event.tailoredResumeId || event.subjectStatus === "deleted") {
      continue;
    }

    const events = eventsByResumeId.get(event.tailoredResumeId) ?? [];
    events.push(event);
    eventsByResumeId.set(event.tailoredResumeId, events);
  }

  const tailoredResumes = await getPrismaClient().tailoredResume.findMany({
    select: {
      applicationId: true,
      archivedAt: true,
      companyName: true,
      createdAt: true,
      displayName: true,
      id: true,
      jobUrl: true,
      positionTitle: true,
    },
    where: {
      OR: [
        ...(eventsByResumeId.size > 0
          ? [
              {
                id: {
                  in: [...eventsByResumeId.keys()],
                },
              },
            ]
          : []),
        ...(input.startedAfter
          ? [{ createdAt: { gte: input.startedAfter } }]
          : [{}]),
      ],
      userId: input.userId,
    },
  });
  const tailoredResumesById = new Map(
    tailoredResumes.map((tailoredResume) => [tailoredResume.id, tailoredResume]),
  );
  const resumeGroups: AiUsageResumeGroup[] = [];

  for (const tailoredResume of tailoredResumes) {
    const events = eventsByResumeId.get(tailoredResume.id) ?? [];
    const firstEvent = events[events.length - 1];
    const lastEvent = events[0];
    const aggregate = events.reduce(
      (current, event) => {
        current.eventCount += 1;
        current.failedEventCount += event.status === "failed" ? 1 : 0;
        current.inputTokens += event.inputTokens;
        current.outputTokens += event.outputTokens;
        current.totalCostUsdMicros = addBigIntStrings(
          current.totalCostUsdMicros,
          event.totalCostUsdMicros,
        );
        current.totalTokens += event.totalTokens;

        return current;
      },
      {
        eventCount: 0,
        failedEventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsdMicros: "0",
        totalTokens: 0,
      },
    );
    const inferredStatus =
      tailoredResume.archivedAt || events.some((event) => event.subjectStatus === "archived")
        ? "archived"
        : "unarchived";

    resumeGroups.push({
      applicationId: tailoredResume.applicationId ?? lastEvent?.applicationId ?? null,
      companyName: tailoredResume.companyName ?? null,
      displayName: tailoredResume.displayName?.trim() || "Tailored resume",
      firstSeenAt: firstEvent?.requestStartedAt ?? tailoredResume.createdAt.toISOString(),
      jobUrl: tailoredResume.jobUrl ?? lastEvent?.jobUrl ?? null,
      lastSeenAt:
        lastEvent?.requestStartedAt ?? tailoredResume.createdAt.toISOString(),
      positionTitle: tailoredResume.positionTitle ?? null,
      status: inferredStatus,
      tailoredResumeId: tailoredResume.id,
      ...aggregate,
    });
  }

  for (const [tailoredResumeId, events] of eventsByResumeId.entries()) {
    const tailoredResume = tailoredResumesById.get(tailoredResumeId);
    if (tailoredResume) {
      continue;
    }

    const firstEvent = events[events.length - 1];
    const lastEvent = events[0];
    const aggregate = events.reduce(
      (current, event) => {
        current.eventCount += 1;
        current.failedEventCount += event.status === "failed" ? 1 : 0;
        current.inputTokens += event.inputTokens;
        current.outputTokens += event.outputTokens;
        current.totalCostUsdMicros = addBigIntStrings(
          current.totalCostUsdMicros,
          event.totalCostUsdMicros,
        );
        current.totalTokens += event.totalTokens;

        return current;
      },
      {
        eventCount: 0,
        failedEventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsdMicros: "0",
        totalTokens: 0,
      },
    );
    const inferredStatus = events.some(
      (event) => event.subjectStatus === "archived",
    )
      ? "archived"
      : "unarchived";

    resumeGroups.push({
      applicationId: lastEvent.applicationId,
      companyName: null,
      displayName: "Tailored resume",
      firstSeenAt: firstEvent.requestStartedAt,
      jobUrl: lastEvent.jobUrl,
      lastSeenAt: lastEvent.requestStartedAt,
      positionTitle: null,
      status: inferredStatus,
      tailoredResumeId,
      ...aggregate,
    });
  }

  return resumeGroups.sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

function resolveAiUsagePeriodStart(period: AiUsagePeriod) {
  if (period === "all") {
    return null;
  }

  const startedAfter = new Date();

  if (period === "hour") {
    startedAfter.setHours(startedAfter.getHours() - 1);
  } else if (period === "day") {
    startedAfter.setDate(startedAfter.getDate() - 1);
  } else if (period === "7d") {
    startedAfter.setDate(startedAfter.getDate() - 7);
  } else if (period === "14d") {
    startedAfter.setDate(startedAfter.getDate() - 14);
  } else if (period === "month") {
    startedAfter.setDate(startedAfter.getDate() - 30);
  } else if (period === "6mo") {
    startedAfter.setMonth(startedAfter.getMonth() - 6);
  } else {
    startedAfter.setFullYear(startedAfter.getFullYear() - 1);
  }

  return startedAfter;
}
