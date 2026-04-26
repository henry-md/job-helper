"use client";

import {
  formatCompactDateOrSameDayTime,
  shouldIncludeShortYear,
} from "@/lib/date-format";
import {
  type TailorResumeExistingTailoringState,
} from "@/lib/tailor-resume-existing-tailoring-state";
import {
  formatTailorResumeProgressStepLabel,
  readTailorResumeDisplayAttempt,
  readTailorResumeProgressAttemptBadgeLabel,
} from "@/lib/tailor-resume-step-display";

type TailorRunDisplayStatus =
  | "current"
  | "failed"
  | "retrying"
  | "skipped"
  | "succeeded";

type TailorRunDisplayStep = {
  attempt: number | null;
  label: string;
  status: TailorRunDisplayStatus;
  stepNumber: number;
};

const tailorRunProgressStepDefinitions = [
  {
    label: "Plan targeted edits",
    stepNumber: 1,
  },
  {
    label: "Clarify missing details",
    stepNumber: 2,
  },
  {
    label: "Apply resume changes",
    stepNumber: 3,
  },
  {
    label: "Keep the original page count",
    stepNumber: 4,
  },
] as const;

function readActiveTailorRunTitle(
  activeTailoring: TailorResumeExistingTailoringState,
) {
  const positionTitle = activeTailoring.positionTitle?.trim() ?? "";
  const companyName = activeTailoring.companyName?.trim() ?? "";

  if (positionTitle && companyName) {
    return `${positionTitle} at ${companyName}`;
  }

  if (positionTitle) {
    return positionTitle;
  }

  if (companyName) {
    return companyName;
  }

  if (activeTailoring.kind === "completed") {
    return activeTailoring.displayName;
  }

  const jobUrl = activeTailoring.jobUrl?.trim() ?? "";

  if (jobUrl) {
    try {
      return new URL(jobUrl).hostname.replace(/^www\./i, "");
    } catch {
      return jobUrl;
    }
  }

  return "Tailoring run";
}

function readTailorRunDisplayStep(
  activeTailoring: TailorResumeExistingTailoringState,
): TailorRunDisplayStep {
  if (activeTailoring.kind === "pending_interview") {
    const stepDefinition = tailorRunProgressStepDefinitions[1];

    return {
      attempt: null,
      label: stepDefinition?.label ?? "Clarify missing details",
      status: "current",
      stepNumber: 2,
    };
  }

  if (activeTailoring.kind === "completed") {
    const stepDefinition = tailorRunProgressStepDefinitions[3];

    return {
      attempt: null,
      label: stepDefinition?.label ?? "Keep the original page count",
      status: "succeeded",
      stepNumber: 4,
    };
  }

  const generationStep = activeTailoring.lastStep;

  if (!generationStep) {
    const firstStep = tailorRunProgressStepDefinitions[0];

    return {
      attempt: null,
      label: firstStep?.label ?? "Plan targeted edits",
      status: "current",
      stepNumber: 1,
    };
  }

  const stepDefinition =
    tailorRunProgressStepDefinitions.find(
      (candidate) => candidate.stepNumber === generationStep.stepNumber,
    ) ?? tailorRunProgressStepDefinitions[0];

  return {
    attempt: readTailorResumeDisplayAttempt(generationStep),
    label: stepDefinition?.label ?? generationStep.summary,
    status:
      generationStep.status === "running"
        ? generationStep.retrying
          ? "retrying"
          : "current"
        : generationStep.status === "failed"
          ? generationStep.retrying
            ? "retrying"
            : "failed"
          : generationStep.status,
    stepNumber: generationStep.stepNumber,
  };
}

function getStepClassName(status: TailorRunDisplayStatus) {
  switch (status) {
    case "succeeded":
      return "border-emerald-200/40 bg-[linear-gradient(180deg,rgba(187,247,208,0.16),rgba(74,222,128,0.08))] text-emerald-50";
    case "current":
      return "border-sky-300/36 bg-[linear-gradient(180deg,rgba(125,211,252,0.15),rgba(14,165,233,0.08))] text-sky-50";
    case "retrying":
      return "border-amber-300/36 bg-[linear-gradient(180deg,rgba(253,230,138,0.16),rgba(251,191,36,0.08))] text-amber-50";
    case "failed":
      return "border-rose-300/30 bg-[linear-gradient(180deg,rgba(253,164,175,0.14),rgba(225,29,72,0.08))] text-rose-50";
    case "skipped":
    default:
      return "border-white/12 bg-white/[0.045] text-zinc-200";
  }
}

export default function TailorResumeActiveRuns({
  activeTailorings,
  embedded = false,
}: {
  activeTailorings: TailorResumeExistingTailoringState[];
  embedded?: boolean;
}) {
  if (activeTailorings.length === 0) {
    return null;
  }

  const includeYear = shouldIncludeShortYear(
    activeTailorings.map((activeTailoring) => activeTailoring.updatedAt),
  );

  const cards = (
    <div className={`${embedded ? "" : "mt-5 "}grid gap-3`.trim()}>
      {activeTailorings.map((activeTailoring) => {
        const displayStep = readTailorRunDisplayStep(activeTailoring);
        const attemptBadgeLabel = readTailorResumeProgressAttemptBadgeLabel({
          attempt: displayStep.attempt,
          status: displayStep.status,
        });
        const stepLabel = formatTailorResumeProgressStepLabel({
          label: displayStep.label,
          status: displayStep.status,
        });

        return (
          <article
            className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4"
            key={activeTailoring.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  {activeTailoring.kind === "pending_interview"
                    ? "Follow-up needed"
                    : "Generating"}
                </p>
                <h3
                  className="mt-2 truncate text-sm font-semibold tracking-tight text-zinc-50"
                  title={readActiveTailorRunTitle(activeTailoring)}
                >
                  {readActiveTailorRunTitle(activeTailoring)}
                </h3>
              </div>

              <span className="shrink-0 text-xs text-zinc-500">
                {formatCompactDateOrSameDayTime(activeTailoring.updatedAt, {
                  includeYear,
                })}
              </span>
            </div>

            <div className="mt-4">
              <div
                aria-current={
                  displayStep.status === "current" ||
                  displayStep.status === "retrying"
                    ? "step"
                    : undefined
                }
                className={`rounded-[1.1rem] border px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.14)] transition ${getStepClassName(displayStep.status)}`}
              >
                <span className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-current opacity-75">
                  <span>Step {displayStep.stepNumber}</span>
                  {attemptBadgeLabel ? (
                    <span className="rounded-full border border-current/15 bg-black/10 px-2 py-0.5 text-[10px] tracking-[0.18em] opacity-90">
                      {attemptBadgeLabel}
                    </span>
                  ) : null}
                </span>
                <span className="mt-2 block text-sm font-semibold leading-snug tracking-tight text-current">
                  {stepLabel}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );

  if (embedded) {
    return cards;
  }

  return (
    <section className="glass-panel soft-ring overflow-hidden rounded-[1.5rem] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Active runs
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
            Tailored resumes in flight
          </h2>
        </div>

        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
          {activeTailorings.length} active
        </span>
      </div>

      {cards}
    </section>
  );
}
