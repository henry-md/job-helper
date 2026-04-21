"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TailorResumeGenerationProgressStepStatus =
  | "current"
  | "failed"
  | "pending"
  | "retrying"
  | "skipped"
  | "succeeded";

export type TailorResumeGenerationProgressStep = {
  attempt: number | null;
  detail: string | null;
  label: string;
  stepNumber: number;
  status: TailorResumeGenerationProgressStepStatus;
};

export type TailorResumeGenerationProgressNotification = {
  detail: string | null;
  title: string;
  tone: "error" | "info" | "success";
};

function getStepCardClassName(status: TailorResumeGenerationProgressStepStatus) {
  switch (status) {
    case "succeeded":
      return "border-emerald-200/45 bg-[linear-gradient(180deg,rgba(187,247,208,0.24),rgba(74,222,128,0.14))] text-emerald-50 shadow-[0_16px_40px_rgba(16,185,129,0.16)]";
    case "current":
      return "border-sky-300/40 bg-[linear-gradient(180deg,rgba(125,211,252,0.2),rgba(14,165,233,0.14))] text-sky-50 shadow-[0_16px_40px_rgba(14,165,233,0.14)]";
    case "retrying":
      return "border-amber-300/40 bg-[linear-gradient(180deg,rgba(253,230,138,0.22),rgba(251,191,36,0.14))] text-amber-50 shadow-[0_16px_40px_rgba(245,158,11,0.14)]";
    case "failed":
      return "border-rose-300/35 bg-[linear-gradient(180deg,rgba(253,164,175,0.18),rgba(225,29,72,0.16))] text-rose-50 shadow-[0_16px_40px_rgba(225,29,72,0.14)]";
    case "skipped":
      return "border-white/12 bg-white/[0.045] text-zinc-200";
    case "pending":
    default:
      return "border-white/10 bg-black/20 text-zinc-300";
  }
}

function getStatusBadge(step: TailorResumeGenerationProgressStep) {
  switch (step.status) {
    case "succeeded":
      return {
        className: "border-emerald-300/35 bg-emerald-200/16 text-emerald-100",
        icon: CheckCircle2,
        iconClassName: "text-emerald-200",
        label: "Done",
      };
    case "current":
      return {
        className: "border-sky-300/35 bg-sky-200/14 text-sky-100",
        icon: LoaderCircle,
        iconClassName: "animate-spin text-sky-200",
        label: "Running",
      };
    case "retrying":
      return {
        className: "border-amber-300/35 bg-amber-200/14 text-amber-100",
        icon: RefreshCcw,
        iconClassName: "animate-spin text-amber-200",
        label: "Retrying",
      };
    case "failed":
      return {
        className: "border-rose-300/35 bg-rose-200/14 text-rose-100",
        icon: XCircle,
        iconClassName: "text-rose-200",
        label: "Failed",
      };
    case "skipped":
      return {
        className: "border-white/12 bg-white/[0.06] text-zinc-200",
        icon: Clock3,
        iconClassName: "text-zinc-300",
        label: "Skipped",
      };
    case "pending":
    default:
      return {
        className: "border-white/10 bg-black/20 text-zinc-300",
        icon: Clock3,
        iconClassName: "text-zinc-500",
        label: "Waiting",
      };
  }
}

function getNotificationClassName(
  tone: TailorResumeGenerationProgressNotification["tone"],
) {
  if (tone === "success") {
    return "border-emerald-300/26 bg-[linear-gradient(180deg,rgba(52,211,153,0.14),rgba(6,95,70,0.22))] text-emerald-50";
  }

  if (tone === "error") {
    return "border-rose-300/24 bg-[linear-gradient(180deg,rgba(251,113,133,0.16),rgba(159,18,57,0.22))] text-rose-50";
  }

  return "border-sky-300/20 bg-[linear-gradient(180deg,rgba(56,189,248,0.12),rgba(8,47,73,0.24))] text-sky-50";
}

export function TailorResumeProgressToast({
  ariaLabel = "Open resume generation progress",
  label = "Generating resume...",
  onOpen,
}: {
  ariaLabel?: string;
  label?: string;
  onOpen: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="flex w-full min-w-0 appearance-none items-center border-0 bg-transparent p-0 text-left shadow-none outline-none"
      onClick={onOpen}
      type="button"
    >
      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-zinc-50">
        {label}
      </span>
    </button>
  );
}

export function TailorResumeProgressModal({
  isOpen,
  latestNotification,
  onClose,
  steps,
}: {
  isOpen: boolean;
  latestNotification: TailorResumeGenerationProgressNotification | null;
  onClose: () => void;
  steps: TailorResumeGenerationProgressStep[];
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[205] flex bg-black/82 px-4 py-6 backdrop-blur-sm sm:px-6">
      <button
        aria-label="Close resume generation progress"
        className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/60"
        onClick={onClose}
        type="button"
      >
        Close
      </button>

      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <section
          aria-describedby="tailor-resume-progress-description"
          aria-modal="true"
          className="glass-panel soft-ring flex max-h-full w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl"
          role="dialog"
        >
          <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Resume generation
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Live progress across the 4 tailoring steps
            </h2>
            <p
              className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400"
              id="tailor-resume-progress-description"
            >
              We keep the toast lightweight and show the latest pipeline update here
              instead of stacking a long notification history.
            </p>
          </div>

          <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:gap-4">
              {steps.map((step, index) => {
                const badge = getStatusBadge(step);
                const BadgeIcon = badge.icon;
                return (
                  <div
                    className="flex flex-col gap-3 xl:flex-1 xl:flex-row xl:items-center"
                    key={step.stepNumber}
                  >
                    <article
                      className={cn(
                        "min-w-0 flex-1 rounded-[1.25rem] border px-4 py-4 shadow-[0_16px_40px_rgba(0,0,0,0.2)] transition",
                        getStepCardClassName(step.status),
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-current opacity-70">
                          Step {step.stepNumber}
                        </p>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                            badge.className,
                          )}
                        >
                          <BadgeIcon className={cn("size-3.5", badge.iconClassName)} />
                          {badge.label}
                        </span>
                      </div>

                      <h3 className="mt-3 text-sm font-semibold leading-snug tracking-tight text-current">
                        {step.label}
                      </h3>

                      {step.attempt && step.attempt > 1 ? (
                        <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-current opacity-70">
                          Attempt {step.attempt}
                        </p>
                      ) : null}
                    </article>

                    {index < steps.length - 1 ? (
                      <div className="flex items-center justify-center xl:self-stretch">
                        <ArrowRight className="size-5 rotate-90 text-zinc-500 xl:rotate-0" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-white/10 px-5 py-5 sm:px-6">
            <div
              className={cn(
                "rounded-[1.25rem] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
                getNotificationClassName(latestNotification?.tone ?? "info"),
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-current opacity-70">
                Latest update
              </p>
              <p className="mt-2 text-sm font-semibold tracking-tight text-current">
                {latestNotification?.title ?? "Generating resume..."}
              </p>
              {latestNotification?.detail ? (
                <p className="mt-2 text-sm leading-6 text-current opacity-80">
                  {latestNotification.detail}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
