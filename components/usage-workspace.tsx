"use client";

import { useMemo, useState } from "react";
import type {
  AiUsageEventRecord,
  AiUsagePeriod,
  AiUsageReport,
  AiUsageResumeGroup,
  AiUsageSubjectStatus,
} from "@/lib/ai-usage-report-types";
import {
  aiUsagePeriods,
  defaultAiUsagePeriod,
} from "@/lib/ai-usage-report-types";

const statusLabels: Record<AiUsageSubjectStatus, string> = {
  archived: "Archived",
  deleted: "Deleted",
  unarchived: "Unarchived",
};

const statusClassNames: Record<AiUsageSubjectStatus, string> = {
  archived: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  deleted: "border-rose-300/20 bg-rose-400/10 text-rose-100",
  unarchived: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
};

function formatUsd(micros: string) {
  const value = Number(BigInt(micros)) / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function truncateUrl(value: string | null) {
  if (!value) {
    return "Unknown URL";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function sumCost(events: AiUsageEventRecord[]) {
  return events
    .reduce(
      (total, event) => total + BigInt(event.totalCostUsdMicros),
      BigInt(0),
    )
    .toString();
}

function countUniqueUsageUrls(events: AiUsageEventRecord[]) {
  return new Set(
    events.map(
      (event) =>
        event.jobUrl ||
        event.applicationId ||
        event.tailorResumeRunId ||
        event.id,
    ),
  ).size;
}

function getUsageStepKey(event: AiUsageEventRecord) {
  return event.stepNumber ? String(event.stepNumber) : "other";
}

function formatUsageStepLabel(stepKey: string) {
  return stepKey === "other" ? "Other" : `Step ${stepKey}`;
}

export default function UsageWorkspace({
  initialReport,
  onOpenTailoredResume,
}: {
  initialReport: AiUsageReport;
  onOpenTailoredResume?: (tailoredResumeId: string) => void;
}) {
  const [report, setReport] = useState(initialReport);
  const [period, setPeriod] = useState<AiUsagePeriod>(
    initialReport.period ?? defaultAiUsagePeriod,
  );
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isLoadingPeriod, setIsLoadingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [enabledStatuses, setEnabledStatuses] = useState<
    Record<AiUsageSubjectStatus, boolean>
  >({
    archived: true,
    deleted: true,
    unarchived: true,
  });
  const [enabledSteps, setEnabledSteps] = useState<Record<string, boolean>>({});
  const [isUnarchivedOpen, setIsUnarchivedOpen] = useState(true);
  const [isArchivedOpen, setIsArchivedOpen] = useState(true);
  const usageStepOptions = useMemo(() => {
    const options = new Map<string, string>();

    for (const event of report.events) {
      const stepKey = getUsageStepKey(event);
      options.set(stepKey, formatUsageStepLabel(stepKey));
    }

    return [...options.entries()].sort(([leftKey], [rightKey]) => {
      if (leftKey === "other") {
        return 1;
      }

      if (rightKey === "other") {
        return -1;
      }

      return Number(leftKey) - Number(rightKey);
    });
  }, [report.events]);
  const visibleEvents = useMemo(
    () =>
      report.events.filter(
        (event) =>
          enabledStatuses[event.subjectStatus] &&
          (enabledSteps[getUsageStepKey(event)] ?? true),
      ),
    [enabledStatuses, enabledSteps, report.events],
  );
  const filteredCost = sumCost(visibleEvents);
  const filteredTokens = visibleEvents.reduce(
    (total, event) => total + event.totalTokens,
    0,
  );
  const filteredUrlCount = countUniqueUsageUrls(visibleEvents);
  const visibleResumeGroupIds = useMemo(
    () =>
      new Set(
        visibleEvents
          .map((event) => event.tailoredResumeId)
          .filter((tailoredResumeId): tailoredResumeId is string =>
            Boolean(tailoredResumeId),
          ),
      ),
    [visibleEvents],
  );
  const visibleResumeGroups = useMemo(
    () =>
      report.resumeGroups.filter(
        (group) =>
          visibleResumeGroupIds.has(group.tailoredResumeId) &&
          enabledStatuses[group.status],
      ),
    [enabledStatuses, report.resumeGroups, visibleResumeGroupIds],
  );
  const unarchivedResumeGroups = visibleResumeGroups.filter(
    (group) => group.status === "unarchived",
  );
  const archivedResumeGroups = visibleResumeGroups.filter(
    (group) => group.status === "archived",
  );
  const toggleStatus = (status: AiUsageSubjectStatus) => {
    setEnabledStatuses((current) => ({
      ...current,
      [status]: !current[status],
    }));
  };
  const toggleStep = (stepKey: string) => {
    setEnabledSteps((current) => ({
      ...current,
      [stepKey]: !(current[stepKey] ?? true),
    }));
  };
  const selectPeriod = async (nextPeriod: AiUsagePeriod) => {
    setPeriod(nextPeriod);
    setIsLoadingPeriod(true);
    setPeriodError(null);

    try {
      const response = await fetch(
        `/api/ai-usage?limit=2000&period=${encodeURIComponent(nextPeriod)}`,
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Could not load usage data.",
        );
      }

      setReport(payload as AiUsageReport);
    } catch (error) {
      setPeriodError(
        error instanceof Error ? error.message : "Could not load usage data.",
      );
    } finally {
      setIsLoadingPeriod(false);
    }
  };
  const renderResumeRow = (group: AiUsageResumeGroup) => {
    const displayName = group.displayName.trim() || "Tailored resume";
    const subtitle =
      group.companyName ||
      group.positionTitle ||
      (group.jobUrl ? truncateUrl(group.jobUrl) : "Tailored resume");

    return (
      <button
        className="grid min-h-[54px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5 text-left transition hover:border-emerald-400/25 hover:bg-emerald-400/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/25"
        key={group.tailoredResumeId}
        onClick={() => onOpenTailoredResume?.(group.tailoredResumeId)}
        type="button"
      >
        <span className="grid min-w-0 gap-1">
          <span className="truncate text-sm font-semibold text-zinc-100">
            {displayName}
          </span>
          <span className="truncate text-sm text-zinc-400">{subtitle}</span>
        </span>
        <span className="grid justify-items-end gap-1 text-right">
          <strong className="text-sm font-semibold text-zinc-50">
            {formatUsd(group.totalCostUsdMicros)}
          </strong>
          <span className="text-xs font-medium text-zinc-500">
            {formatDate(group.lastSeenAt)}
          </span>
        </span>
      </button>
    );
  };
  const renderResumeSection = (input: {
    groups: AiUsageResumeGroup[];
    isOpen: boolean;
    label: string;
    onToggle: () => void;
  }) => (
    <section className="grid gap-2">
      <button
        aria-expanded={input.isOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-0.5 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500"
        onClick={input.onToggle}
        type="button"
      >
        <span aria-hidden="true">{input.isOpen ? "▾" : "▸"}</span>
        <span>{input.label}</span>
        <strong className="text-xs tracking-normal text-zinc-500">
          {formatInteger(input.groups.length)}
        </strong>
      </button>
      {input.isOpen ? (
        input.groups.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No tailored resumes match those filters.
          </p>
        ) : (
          <div className="grid gap-2">
            {input.groups.map((group) => renderResumeRow(group))}
          </div>
        )
      ) : null}
    </section>
  );

  return (
    <div className="usage-shell h-full overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
      <div className="grid gap-[clamp(0.75rem,1.2vh,1rem)]">
        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Usage
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                AI spend ledger
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isLoadingPeriod ? (
                <span className="text-xs text-zinc-500">Loading...</span>
              ) : null}
              <button
                aria-expanded={isFiltersOpen}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/25"
                onClick={() => setIsFiltersOpen((isOpen) => !isOpen)}
                type="button"
              >
                <span aria-hidden="true">🔎</span>
                Filters
              </button>
            </div>
          </div>

          {isFiltersOpen ? (
            <div className="mt-4 grid gap-4 rounded-[1rem] border border-white/8 bg-black/16 p-4 lg:grid-cols-[1.25fr_1fr_1fr]">
              <fieldset className="min-w-0">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Time period
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {aiUsagePeriods.map((option) => (
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        period === option.value
                          ? "border-emerald-300/45 bg-emerald-300/15 text-emerald-50"
                          : "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"
                      }`}
                      disabled={isLoadingPeriod}
                      key={option.value}
                      onClick={() => void selectPeriod(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="min-w-0">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Status
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["unarchived", "archived", "deleted"] as AiUsageSubjectStatus[]).map(
                    (status) => (
                      <label
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${statusClassNames[status]}`}
                        key={status}
                      >
                        <input
                          checked={enabledStatuses[status]}
                          className="h-3.5 w-3.5 accent-emerald-300"
                          onChange={() => toggleStatus(status)}
                          type="checkbox"
                        />
                        {statusLabels[status]}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>

              <fieldset className="min-w-0">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Steps
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {usageStepOptions.length === 0 ? (
                    <span className="text-xs text-zinc-500">No steps yet</span>
                  ) : (
                    usageStepOptions.map(([stepKey, label]) => (
                      <label
                        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300"
                        key={stepKey}
                      >
                        <input
                          checked={enabledSteps[stepKey] ?? true}
                          className="h-3.5 w-3.5 accent-emerald-300"
                          onChange={() => toggleStep(stepKey)}
                          type="checkbox"
                        />
                        {label}
                      </label>
                    ))
                  )}
                </div>
              </fieldset>
            </div>
          ) : null}

          {periodError ? (
            <p className="mt-3 text-sm text-rose-200">{periodError}</p>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1rem] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Filtered spend
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {formatUsd(filteredCost)}
              </p>
            </div>
            <div className="rounded-[1rem] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                API calls
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {formatInteger(visibleEvents.length)}
              </p>
            </div>
            <div className="rounded-[1rem] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Tokens
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {formatInteger(filteredTokens)}
              </p>
            </div>
            <div className="rounded-[1rem] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                URLs
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {formatInteger(filteredUrlCount)}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-3">
          {renderResumeSection({
            groups: unarchivedResumeGroups,
            isOpen: isUnarchivedOpen,
            label: "Unarchived",
            onToggle: () => setIsUnarchivedOpen((isOpen) => !isOpen),
          })}
          {renderResumeSection({
            groups: archivedResumeGroups,
            isOpen: isArchivedOpen,
            label: "Archived",
            onToggle: () => setIsArchivedOpen((isOpen) => !isOpen),
          })}
        </div>
      </div>
    </div>
  );
}
