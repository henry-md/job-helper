"use client";

import {
  Fragment,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Braces,
  BriefcaseBusiness,
  ChartColumnBig,
  ChevronDown,
  FileCode2,
  FileText,
  MessagesSquare,
  Minimize2,
  Sparkles,
} from "lucide-react";

const previewModes = [
  {
    id: "helper",
    label: "Resume Tailor",
    description:
      "See the real staged tailoring system: LaTeX first, then plan, clarify, implement, and compact if the page grows.",
  },
  {
    id: "tracker",
    label: "Job Tracker",
    description: "See interviews, follow-ups, and next steps stay organized.",
  },
] as const;

const tailorBaseStage = {
  chip: "source of truth",
  descriptor: "Compile the editable LaTeX base before any job-specific rewriting.",
  icon: FileCode2,
  step: "0",
  title: "Generate base LaTeX",
} as const;

const tailorPipelineStages = [
  {
    chip: "plaintext",
    descriptor: "Whole-resume generalized edits before touching block-level LaTeX.",
    icon: FileText,
    step: "1",
    title: "Plan edits",
  },
  {
    chip: "optional",
    descriptor: "Ask only when a grounded answer could materially improve the resume.",
    icon: MessagesSquare,
    step: "2",
    title: "Ask clarifying question",
  },
  {
    chip: "LaTeX",
    descriptor: "Translate only the approved segments back into scoped replacements.",
    icon: Braces,
    step: "3",
    title: "Apply block edits",
  },
  {
    chip: "1-page guardrail",
    descriptor: "Condense edited blocks only if the tailored preview grows past the source.",
    icon: Minimize2,
    step: "4",
    title: "Condense to fit",
  },
] as const;

type PreviewModeId = (typeof previewModes)[number]["id"];

const trackerStats = [
  ["Active", "18"],
  ["Interviews", "4"],
  ["Next up", "6"],
] as const;

const trackerRows = [
  ["Notion", "Product Designer", "Phone screen Thu"],
  ["Mercury", "Software Engineer", "Take-home due"],
  ["Vercel", "Frontend Engineer", "Follow-up today"],
  ["Linear", "Senior Product Designer", "Hiring manager Fri"],
  ["Figma", "Design Systems Lead", "Portfolio review"],
] as const;

const trackerRowGapPx = 8;
const defaultTrackerRowCount = 4;

export default function PublicLandingShowcase() {
  const [activePreview, setActivePreview] = useState<PreviewModeId>("helper");

  return (
    <section className="relative h-full min-h-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.98))] p-2 sm:p-4">
      <div className="pointer-events-none absolute left-8 top-6 h-24 w-24 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_12s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-28 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_15s_ease-in-out_infinite_reverse]" />

      <div className="relative flex h-full min-h-0 flex-col gap-2 sm:gap-2">
        <div className="flex flex-col gap-2">
          <div className="inline-flex w-fit items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.75 sm:p-1">
            {previewModes.map((mode) => {
              const isActive = mode.id === activePreview;

              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={isActive}
                  className={`rounded-full px-3 py-1.5 text-[0.94rem] font-medium transition sm:px-4 sm:py-2 sm:text-sm ${
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
          {activePreview === "helper" ? (
            <TailorResumePreview />
          ) : (
            <JobTrackerPreview />
          )}
        </div>
      </div>
    </section>
  );
}

function TailorResumePreview() {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const pipelineStages = [tailorBaseStage, ...tailorPipelineStages];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.28em] text-zinc-500 sm:text-[0.64rem]">
            Actual pipeline
          </p>
          <p className="mt-0.5 text-[0.92rem] font-semibold text-zinc-50 sm:hidden">
            Tailor pipeline
          </p>
          <p className="mt-1 hidden text-[1.02rem] font-semibold text-zinc-50 sm:block">
            Tailor Resume pipeline
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.75 text-[0.48rem] uppercase tracking-[0.18em] text-emerald-100 sm:gap-2 sm:px-3 sm:py-1 sm:text-[0.52rem] sm:tracking-[0.2em]">
          <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          Auto retries
        </span>
      </div>

      <div className="relative mt-2 flex-1 overflow-hidden rounded-[1.15rem] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,21,0.98),rgba(10,10,12,0.98))] p-2.5 sm:rounded-[1.25rem] sm:p-3.5">
        <div className="pointer-events-none absolute left-6 top-0 h-24 w-24 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_13s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute bottom-0 right-8 h-24 w-24 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_16s_ease-in-out_infinite_reverse]" />

        <div className="relative h-full overflow-y-auto pr-1 app-scrollbar">
          <div className="mx-auto w-full max-w-[42rem] pb-1">
            {pipelineStages.map((stage, index) => (
              <Fragment key={stage.step}>
                <TailorPipelineNode
                  chip={stage.chip}
                  descriptor={stage.descriptor}
                  delayMs={index * 260}
                  expanded={expandedStep === stage.step}
                  icon={stage.icon}
                  onToggle={() =>
                    setExpandedStep((current) =>
                      current === stage.step ? null : stage.step,
                    )
                  }
                  step={stage.step}
                  title={stage.title}
                  tone={index === 0 ? "base" : "default"}
                />
                {index < pipelineStages.length - 1 ? (
                  <TailorPipelineArrow />
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TailorPipelineNode(input: {
  chip: string;
  delayMs: number;
  descriptor: string;
  expanded: boolean;
  icon: LucideIcon;
  onToggle: () => void;
  step: string;
  title: string;
  tone: "base" | "default";
}) {
  const detailsId = `pipeline-step-details-${input.step}`;
  const Icon = input.icon;
  const isBase = input.tone === "base";
  const descriptorRef = useRef<HTMLParagraphElement | null>(null);
  const [canExpand, setCanExpand] = useState(false);
  const showExpandButton = canExpand || input.expanded;

  useEffect(() => {
    const descriptorElement = descriptorRef.current;

    if (!descriptorElement) {
      return;
    }

    const updateCanExpand = () => {
      const nextCanExpand =
        descriptorElement.scrollWidth - descriptorElement.clientWidth > 1 ||
        descriptorElement.scrollHeight - descriptorElement.clientHeight > 1;
      setCanExpand(nextCanExpand);
    };

    const frameId = window.requestAnimationFrame(updateCanExpand);
    const resizeObserver = new ResizeObserver(updateCanExpand);
    resizeObserver.observe(descriptorElement);
    window.addEventListener("resize", updateCanExpand);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateCanExpand);
    };
  }, [input.expanded]);

  return (
    <div>
      <div
        className={`group relative block w-full overflow-hidden rounded-[0.95rem] border px-3 text-left transition sm:rounded-[1rem] sm:px-4 ${
          isBase
            ? "border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.34),rgba(20,20,24,0.96))]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.95),rgba(10,10,12,0.98))]"
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-y-0 left-[-28%] w-[30%] bg-gradient-to-r blur-md [animation:public-scan_4.8s_ease-in-out_infinite] ${
            isBase
              ? "from-transparent via-cyan-200/26 to-transparent"
              : "from-transparent via-white/14 to-transparent"
          }`}
          style={{ animationDelay: `${input.delayMs}ms` }}
        />
        <div
          className={`pointer-events-none absolute inset-0 ${
            isBase
              ? "bg-[radial-gradient(circle_at_left_center,rgba(103,232,249,0.14),transparent_48%)]"
              : "bg-[radial-gradient(circle_at_left_center,rgba(110,231,183,0.08),transparent_46%)]"
          }`}
        />

        <div className="relative flex items-start justify-between gap-3 py-2.5 sm:py-3">
          <div className="min-w-0 flex items-start gap-2.5 sm:gap-3">
            <span
              className={`inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border text-[0.56rem] font-semibold sm:h-8 sm:w-8 sm:text-[0.72rem] ${
                isBase
                  ? "border-cyan-200/22 bg-cyan-200/10 text-cyan-100"
                  : "border-emerald-200/20 bg-emerald-300/10 text-emerald-100"
              }`}
            >
              {input.step}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Icon
                  className={`hidden h-4 w-4 shrink-0 sm:block ${
                    isBase ? "text-cyan-100/90" : "text-zinc-300"
                  }`}
                />
                <p className="truncate text-[0.76rem] font-semibold text-zinc-50 sm:text-[0.96rem]">
                  {input.title}
                </p>
              </div>
              <p
                id={detailsId}
                ref={descriptorRef}
                className={`mt-1 text-[0.72rem] leading-relaxed text-zinc-400 transition-[opacity] duration-200 sm:text-[0.8rem] ${
                  input.expanded
                    ? "block max-w-[30rem] whitespace-normal opacity-100 lg:max-w-none"
                    : "block overflow-hidden text-ellipsis whitespace-nowrap opacity-100 lg:overflow-visible lg:whitespace-normal"
                }`}
              >
                {input.descriptor}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-[0.53rem] uppercase tracking-[0.18em] xl:inline-flex ${
                isBase
                  ? "border-cyan-200/16 bg-cyan-200/10 text-cyan-100"
                  : "border-white/10 bg-white/[0.04] text-zinc-300"
              }`}
            >
              {input.chip}
            </span>
            {showExpandButton ? (
              <button
                aria-controls={detailsId}
                aria-expanded={input.expanded}
                aria-label={`${input.expanded ? "Collapse" : "Expand"} step ${
                  input.step
                }: ${input.title}`}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-200 focus:outline-none ${
                  input.expanded ? "text-zinc-200" : ""
                }`}
                onClick={input.onToggle}
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition duration-200 sm:h-4 sm:w-4 ${
                    input.expanded ? "rotate-180" : ""
                  }`}
                />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TailorPipelineArrow() {
  return (
    <div className="relative flex h-6 items-center justify-center sm:h-7">
      <svg
        aria-hidden="true"
        className="h-3.5 w-4.5 text-emerald-100/72 sm:h-4 sm:w-5"
        fill="none"
        viewBox="0 0 24 34"
      >
        <path
          d="M12 2C10.9 8.4 13.2 14.5 12 23.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M12.9 3.1C11.3 8.8 13.8 14.8 11.4 22.8"
          opacity="0.34"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.15"
        />
        <path
          d="M7.8 19.8 12 24.6l4.2-4.8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M8.6 19.2 12.3 24.9l3.8-4.5"
          opacity="0.34"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.15"
        />
      </svg>
    </div>
  );
}

function JobTrackerPreview() {
  const rowsViewportRef = useRef<HTMLDivElement | null>(null);
  const rowMeasureRef = useRef<HTMLDivElement | null>(null);
  const [visibleRowCount, setVisibleRowCount] = useState(() =>
    Math.min(defaultTrackerRowCount, trackerRows.length),
  );

  useEffect(() => {
    const viewportElement = rowsViewportRef.current;
    const rowElement = rowMeasureRef.current;

    if (!viewportElement || !rowElement) {
      return;
    }

    let frameId = 0;

    const updateVisibleRowCount = () => {
      const viewportHeight = viewportElement.clientHeight;
      const rowHeight = rowElement.clientHeight;

      if (viewportHeight <= 0 || rowHeight <= 0) {
        return;
      }

      const nextVisibleRowCount = Math.max(
        1,
        Math.min(
          trackerRows.length,
          Math.floor(
            (viewportHeight + trackerRowGapPx) / (rowHeight + trackerRowGapPx),
          ),
        ),
      );

      setVisibleRowCount((current) =>
        current === nextVisibleRowCount ? current : nextVisibleRowCount,
      );
    };

    const scheduleVisibleRowCountUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateVisibleRowCount);
    };

    scheduleVisibleRowCountUpdate();

    const resizeObserver = new ResizeObserver(scheduleVisibleRowCountUpdate);
    resizeObserver.observe(viewportElement);
    resizeObserver.observe(rowElement);
    window.addEventListener("resize", scheduleVisibleRowCountUpdate);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleVisibleRowCountUpdate);
    };
  }, []);

  const visibleRows = trackerRows.slice(0, visibleRowCount);

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

      <div
        className="mt-2 flex flex-1 min-h-0 flex-col rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-2.5 sm:mt-3 sm:p-4"
        data-preview-section="job-tracker-week"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.64rem] uppercase tracking-[0.24em] text-zinc-500">
            This week
          </p>
          <ChartColumnBig className="h-4 w-4 text-cyan-200" />
        </div>

        <div
          ref={rowsViewportRef}
          className="relative mt-2 flex-1 min-h-0 overflow-hidden sm:mt-3"
          data-preview-row-viewport="true"
        >
          <div className="space-y-2">
            {visibleRows.map(([company, role, stage], index) => (
              <TrackerPreviewRow
                key={company}
                animationDelayMs={index * 120}
                company={company}
                role={role}
                stage={stage}
              />
            ))}
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10"
          >
            <div
              ref={rowMeasureRef}
              className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2 sm:px-3.5 sm:py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-50">
                  {trackerRows[0][0]}
                </p>
                <p className="truncate text-xs text-zinc-400">
                  {trackerRows[0][1]}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.52rem] uppercase tracking-[0.18em] text-zinc-300 sm:px-3 sm:text-[0.58rem]">
                {trackerRows[0][2]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackerPreviewRow(input: {
  animationDelayMs?: number;
  company: string;
  role: string;
  stage: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2 [animation:public-float_9s_ease-in-out_infinite] sm:px-3.5 sm:py-2.5"
      data-preview-row="true"
      style={
        input.animationDelayMs === undefined
          ? undefined
          : { animationDelay: `${input.animationDelayMs}ms` }
      }
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-50">
          {input.company}
        </p>
        <p className="truncate text-xs text-zinc-400">{input.role}</p>
      </div>
      <span className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.52rem] uppercase tracking-[0.18em] text-zinc-300 sm:px-3 sm:text-[0.58rem]">
        {input.stage}
      </span>
    </div>
  );
}
