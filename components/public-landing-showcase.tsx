"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Braces,
  BriefcaseBusiness,
  ChevronDown,
  FileCode2,
  FileText,
  Minimize2,
  Search,
  Sparkles,
} from "lucide-react";

const tailorBaseStage = {
  chip: "source of truth",
  descriptor: "Compile the editable LaTeX base before any job-specific rewriting.",
  icon: FileCode2,
  step: "0",
  title: "Generate base LaTeX",
} as const;

const tailorPipelineStages = [
  {
    chip: "deterministic",
    descriptor:
      "Extract and classify job technology signals before rewrite planning starts.",
    icon: Search,
    step: "1",
    title: "Scrape keywords",
  },
  {
    chip: "checkpoint",
    descriptor:
      "Wait until high-priority skills-section gaps have source, skill, or spare-bullet support.",
    icon: BriefcaseBusiness,
    step: "2",
    title: "Review coverage",
  },
  {
    chip: "OpenAI",
    descriptor:
      "Draft targeted plaintext edits from resume, job text, and stored support evidence.",
    icon: FileText,
    step: "3",
    title: "Plan edits",
  },
  {
    chip: "LaTeX",
    descriptor: "Translate only the approved segments back into scoped replacements.",
    icon: Braces,
    step: "4A",
    title: "Apply block edits",
  },
  {
    chip: "same-page guardrail",
    descriptor:
      "Measure the compiled PDF and compact edited blocks only if the tailored preview grows.",
    icon: Minimize2,
    step: "4B",
    title: "Keep page count",
  },
] as const;

export default function PublicLandingShowcase() {
  return (
    <section className="public-showcase-card relative h-full min-h-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.98))] p-2 sm:p-4">
      <div className="pointer-events-none absolute left-8 top-6 h-24 w-24 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_12s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-28 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_15s_ease-in-out_infinite_reverse]" />

      <div className="public-showcase-inner relative flex h-full min-h-0 flex-col gap-2 sm:gap-2">
        <div className="public-showcase-body min-h-0 flex-1">
          <TailorResumePreview />
        </div>
      </div>
    </section>
  );
}

function TailorResumePreview() {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const pipelineStages = [tailorBaseStage, ...tailorPipelineStages];

  return (
    <div className="public-tailor-preview flex h-full min-h-0 flex-col">
      <div className="public-tailor-heading flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.28em] text-zinc-500 sm:text-[0.64rem]">
            {/* Actual pipeline */} &nbsp;
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

      <div className="public-pipeline-frame relative mt-1.5 flex-1 overflow-hidden rounded-[1.15rem] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,21,0.98),rgba(10,10,12,0.98))] p-2 sm:rounded-[1.25rem] sm:p-2.5">
        <div className="pointer-events-none absolute left-6 top-0 h-24 w-24 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_13s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute bottom-0 right-8 h-24 w-24 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_16s_ease-in-out_infinite_reverse]" />

        <div className="public-pipeline-scroll relative h-full overflow-y-auto pr-1 app-scrollbar">
          <div className="public-pipeline-list mx-auto w-full max-w-[42rem] pb-1">
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
        className={`public-pipeline-node group relative block w-full overflow-hidden rounded-[0.95rem] border px-3 text-left transition sm:rounded-[1rem] sm:px-4 ${
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

        <div className="public-pipeline-node-content relative flex items-start justify-between gap-3 py-1.5 sm:py-2">
          <div className="min-w-0 flex items-start gap-2.5 sm:gap-3">
            <span
              className={`public-pipeline-step-badge inline-flex h-5.5 min-w-5.5 shrink-0 items-center justify-center rounded-full border px-1 text-[0.5rem] font-semibold sm:h-7 sm:min-w-7 sm:px-1.5 sm:text-[0.62rem] ${
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
                <p className="public-pipeline-title truncate text-[0.76rem] font-semibold text-zinc-50 sm:text-[0.96rem]">
                  {input.title}
                </p>
              </div>
              <p
                id={detailsId}
                ref={descriptorRef}
                data-expanded={input.expanded ? "true" : "false"}
                className={`public-pipeline-description mt-0.5 text-[0.7rem] leading-snug text-zinc-400 transition-[opacity] duration-200 sm:text-[0.74rem] ${
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
    <div className="public-pipeline-arrow relative flex h-4 items-center justify-center sm:h-4">
      <svg
        aria-hidden="true"
        className="h-4 w-3 text-emerald-100/72"
        fill="none"
        viewBox="0 0 16 48"
      >
        <defs>
          <marker
            id="pipeline-vertical-arrowhead"
            markerHeight="7"
            markerWidth="7"
            orient="auto"
            refX="6"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path d="M0.8 0.9 6 3.5 0.8 6.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
          </marker>
        </defs>
        <path
          d="M8 2V42"
          markerEnd="url(#pipeline-vertical-arrowhead)"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    </div>
  );
}
