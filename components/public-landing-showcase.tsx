"use client";

import { startTransition, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  ChartColumnBig,
  FileSearch2,
  Sparkles,
} from "lucide-react";

const previewModes = [
  {
    id: "helper",
    label: "Job Helper",
    description: "See a job post screenshot turn into a clean application draft.",
  },
  {
    id: "tracker",
    label: "Job Tracker",
    description: "See interviews, follow-ups, and next steps stay organized.",
  },
] as const;

type PreviewModeId = (typeof previewModes)[number]["id"];

const helperFields = [
  ["Role", "Software Engineer"],
  ["Company", "Microsoft"],
  ["Location", "Hybrid"],
  ["Stage", "Ready to save"],
] as const;

const trackerStats = [
  ["Active", "18"],
  ["Interviews", "4"],
  ["Next up", "6"],
] as const;

const trackerRows = [
  ["Notion", "Product Designer", "Phone screen Thu"],
  ["Mercury", "Software Engineer", "Take-home due"],
  ["Vercel", "Frontend Engineer", "Follow-up today"],
] as const;

export default function PublicLandingShowcase() {
  const [activePreview, setActivePreview] = useState<PreviewModeId>("helper");
  const activeMode =
    previewModes.find((mode) => mode.id === activePreview) ?? previewModes[0];

  return (
    <section className="relative h-full min-h-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.98))] p-3 sm:p-4">
      <div className="pointer-events-none absolute left-8 top-6 h-24 w-24 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_12s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-28 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_15s_ease-in-out_infinite_reverse]" />

      <div className="relative flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-col gap-3">
          <p className="hidden max-w-sm text-sm leading-relaxed text-zinc-400 sm:block">
            {activeMode.description}
          </p>

          <div className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.04] p-1">
            {previewModes.map((mode) => {
              const isActive = mode.id === activePreview;

              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={isActive}
                  className={`rounded-full px-3 py-2 text-sm font-medium transition sm:px-4 ${
                    isActive
                      ? "bg-zinc-50 text-zinc-950 shadow-[0_12px_30px_rgba(255,255,255,0.14)]"
                      : "text-zinc-300 hover:bg-white/6 hover:text-zinc-100"
                  }`}
                  onClick={() => {
                    startTransition(() => setActivePreview(mode.id));
                  }}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {activePreview === "helper" ? <JobHelperPreview /> : <JobTrackerPreview />}
        </div>
      </div>
    </section>
  );
}

function JobHelperPreview() {
  return (
    <>
      <div className="h-full md:hidden">
        <div className="flex h-full min-h-0 flex-col rounded-[1.45rem] border border-white/10 bg-[#0d0d10]/95 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-100">Application draft</p>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.18em] text-zinc-300">
              <FileSearch2 className="h-3 w-3" />
              Ready
            </span>
          </div>

          <div className="relative mt-3 overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(39,39,42,0.98),rgba(10,10,12,0.98))] p-3">
            <div className="pointer-events-none absolute inset-y-2 left-[-24%] w-[48%] bg-gradient-to-r from-transparent via-emerald-300/35 to-transparent blur-xl [animation:public-scan_4s_ease-in-out_infinite]" />
            <div className="flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.24em] text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 [animation:public-pulse_2s_ease-in-out_infinite]" />
              careers.microsoft.com
            </div>

            <div className="mt-3 space-y-2">
              <div className="h-3 w-[82%] rounded-full bg-white/12" />
              <div className="h-3 w-[60%] rounded-full bg-white/8" />
              <div className="h-3 w-[70%] rounded-full bg-white/8" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {helperFields.slice(0, 2).map(([label, value], index) => (
              <div
                key={label}
                className="rounded-[1rem] border border-white/8 bg-white/[0.04] p-2.5 [animation:public-float_8s_ease-in-out_infinite]"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <p className="text-[0.55rem] uppercase tracking-[0.2em] text-zinc-500">
                  {label}
                </p>
                <p className="mt-1.5 text-xs text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 pt-1 text-xs text-zinc-300">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
              Hybrid
            </span>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-emerald-100">
              Ready to save
            </span>
          </div>
        </div>
      </div>

      <div className="hidden h-full min-h-0 md:grid md:grid-cols-[1.05fr_0.95fr] md:gap-3">
        <div className="flex min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-[#0d0d10]/95 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.66rem] uppercase tracking-[0.28em] text-zinc-500">
                Job post
              </p>
              <p className="mt-1 text-lg font-semibold text-zinc-50">Screenshot</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.62rem] uppercase tracking-[0.2em] text-zinc-300">
              <FileSearch2 className="h-3.5 w-3.5" />
              Details found
            </span>
          </div>

          <div className="relative mt-4 flex-1 overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(39,39,42,0.98),rgba(10,10,12,0.98))] p-4">
            <div className="pointer-events-none absolute inset-y-3 left-[-24%] w-[44%] bg-gradient-to-r from-transparent via-emerald-300/35 to-transparent blur-xl [animation:public-scan_4s_ease-in-out_infinite]" />
            <div className="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.24em] text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 [animation:public-pulse_2s_ease-in-out_infinite]" />
              careers.microsoft.com
            </div>

            <div className="mt-4 space-y-3">
              <div className="h-4 w-[84%] rounded-full bg-white/12" />
              <div className="h-4 w-[62%] rounded-full bg-white/8" />
              <div className="h-4 w-[74%] rounded-full bg-white/8" />
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {helperFields.map(([label, value], index) => (
                <div
                  key={label}
                  className="rounded-[1rem] border border-white/8 bg-white/[0.04] p-3 [animation:public-float_8s_ease-in-out_infinite]"
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <p className="text-[0.56rem] uppercase tracking-[0.2em] text-zinc-500">
                    {label}
                  </p>
                  <p className="mt-2 text-sm text-zinc-100">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 gap-3">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.66rem] uppercase tracking-[0.28em] text-zinc-500">
                  Ready to save
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-50">
                  Application draft
                </p>
              </div>
              <Sparkles className="h-4 w-4 text-emerald-200" />
            </div>

            <div className="mt-4 space-y-2">
              {helperFields.map(([label, value], index) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-[1rem] border border-white/8 bg-black/20 px-3 py-3 [animation:public-float_9s_ease-in-out_infinite]"
                  style={{ animationDelay: `${index * 110}ms` }}
                >
                  <span className="text-[0.64rem] uppercase tracking-[0.2em] text-zinc-500">
                    {label}
                  </span>
                  <span className="text-sm text-zinc-100">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-300/[0.08] p-4">
            <p className="text-lg font-semibold text-zinc-50">
              Save it once, then keep moving.
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm text-zinc-100">
              <span>Screenshot</span>
              <ArrowRight className="h-4 w-4 text-emerald-200/70" />
              <span>Draft</span>
              <ArrowRight className="h-4 w-4 text-emerald-200/70" />
              <span className="text-emerald-100">Tracker</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function JobTrackerPreview() {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-[#0d0d10]/95 p-2.5 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.66rem] uppercase tracking-[0.28em] text-zinc-500">
            Job Tracker
          </p>
          <p className="mt-1 text-[1.05rem] font-semibold text-zinc-50 sm:text-lg">
            Your search, organized.
          </p>
        </div>
        <BriefcaseBusiness className="h-4 w-4 text-cyan-200" />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 sm:mt-3">
        {trackerStats.map(([label, value], index) => (
          <div
            key={label}
            className="rounded-[1rem] border border-white/8 bg-white/[0.04] p-2 [animation:public-float_8s_ease-in-out_infinite] sm:p-2.5"
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <p className="text-[0.55rem] uppercase tracking-[0.2em] text-zinc-500">
              {label}
            </p>
            <p className="mt-1.5 text-base font-semibold text-zinc-50 sm:text-lg">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-2 flex-1 rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-2.5 sm:mt-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.64rem] uppercase tracking-[0.24em] text-zinc-500">
            This week
          </p>
          <ChartColumnBig className="h-4 w-4 text-cyan-200" />
        </div>

        <div className="mt-2 space-y-2 sm:mt-3">
          {trackerRows.slice(0, 2).map(([company, role, stage], index) => (
            <div
              key={company}
              className={`items-center justify-between rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5 [animation:public-float_9s_ease-in-out_infinite] ${
                index === 0 ? "flex" : "hidden sm:flex"
              }`}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div>
                <p className="text-sm font-medium text-zinc-50">{company}</p>
                <p className="text-xs text-zinc-400">{role}</p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.58rem] uppercase tracking-[0.18em] text-zinc-300">
                {stage}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
