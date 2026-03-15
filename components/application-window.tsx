"use client";

import type {
  Dispatch,
  DragEvent,
  FormEvent,
  ReactNode,
  SetStateAction,
} from "react";
import ReferrerSelector from "@/components/referrer-selector";
import type {
  CompanyOption,
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobApplicationDraft,
  JobLocationType,
  ReferrerOption,
} from "@/lib/job-application-types";

function fieldClassName() {
  return "mt-2 w-full rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45";
}

function splitSalaryRange(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return { minimum: "", maximum: "" };
  }

  const rangeMatch = trimmedValue.match(/^(.*?)\s*(?:to|[-–—])\s*(.*)$/i);

  if (!rangeMatch) {
    return { minimum: trimmedValue, maximum: "" };
  }

  return {
    minimum: rangeMatch[1]?.trim() ?? "",
    maximum: rangeMatch[2]?.trim() ?? "",
  };
}

function composeSalaryRange(minimum: string, maximum: string) {
  const normalizedMinimum = minimum.trim();
  const normalizedMaximum = maximum.trim();

  if (normalizedMinimum && normalizedMaximum) {
    return `${normalizedMinimum} - ${normalizedMaximum}`;
  }

  return normalizedMinimum || normalizedMaximum;
}

export default function ApplicationWindow({
  companyOptions,
  children,
  draft,
  extractingCount = 0,
  footerMessage = "Save when title and company look correct.",
  isFormLocked,
  isExtracting = false,
  isMoreOpen,
  isSaving,
  onReset,
  onPanelDragLeave,
  onPanelDragOver,
  onPanelDrop,
  onSubmit,
  panelClassName,
  processingLabel,
  saveDisabled,
  setDraft,
  setIsMoreOpen,
  setReferrerOptions,
  referrerOptions,
}: {
  companyOptions: CompanyOption[];
  children?: ReactNode;
  draft: JobApplicationDraft;
  extractingCount?: number;
  footerMessage?: string;
  isFormLocked: boolean;
  isExtracting?: boolean;
  isMoreOpen: boolean;
  isSaving: boolean;
  onReset: () => void;
  onPanelDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onPanelDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onPanelDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  panelClassName?: string;
  processingLabel?: string;
  saveDisabled: boolean;
  setDraft: Dispatch<SetStateAction<JobApplicationDraft>>;
  setIsMoreOpen: Dispatch<SetStateAction<boolean>>;
  setReferrerOptions: Dispatch<SetStateAction<ReferrerOption[]>>;
  referrerOptions: ReferrerOption[];
}) {
  const locationRequiresOnsiteDays =
    draft.location === "onsite" || draft.location === "hybrid";
  const salaryRange = splitSalaryRange(draft.salaryRange);

  function handleSalaryRangeChange(field: "minimum" | "maximum", value: string) {
    setDraft((currentDraft) => {
      const currentSalaryRange = splitSalaryRange(currentDraft.salaryRange);

      return {
        ...currentDraft,
        salaryRange: composeSalaryRange(
          field === "minimum" ? value : currentSalaryRange.minimum,
          field === "maximum" ? value : currentSalaryRange.maximum,
        ),
      };
    });
  }

  return (
    <form className="flex h-full min-h-0 flex-col gap-3" onSubmit={onSubmit}>
      <div className="relative min-h-0 flex-1">
        <div
          className={
            panelClassName ??
            "app-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-auto rounded-[1.25rem] border border-white/8 bg-black/20 p-3"
          }
          onDragLeave={onPanelDragLeave}
          onDragOver={onPanelDragOver}
          onDrop={onPanelDrop}
        >
          {children}

          <div className="flex min-h-0 w-full flex-col gap-2">
            <div className="grid w-full gap-2 [&>*]:min-w-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:[&>*:last-child:nth-child(odd)]:col-span-2">
              <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
                <span className="text-sm font-medium text-zinc-100">Job title</span>
                <input
                  className={fieldClassName()}
                  disabled={isFormLocked}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      jobTitle: event.target.value,
                    }))
                  }
                  placeholder="Software Engineer"
                  type="text"
                  value={draft.jobTitle}
                />
              </label>

              <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
                <span className="text-sm font-medium text-zinc-100">Company</span>
                <input
                  className={fieldClassName()}
                  disabled={isFormLocked}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      companyName: event.target.value,
                    }))
                  }
                  placeholder="OpenAI"
                  type="text"
                  value={draft.companyName}
                />
              </label>

              <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
                <span className="text-sm font-medium text-zinc-100">Applied</span>
                <input
                  className={fieldClassName()}
                  disabled={isFormLocked}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      appliedAt: event.target.value,
                    }))
                  }
                  type="date"
                  value={draft.appliedAt}
                />
              </label>

              <ReferrerSelector
                companyOptions={companyOptions}
                currentCompanyName={draft.companyName}
                draft={draft}
                isFormLocked={isFormLocked}
                referrerOptions={referrerOptions}
                setDraft={setDraft}
                setReferrerOptions={setReferrerOptions}
              />

              <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
                <span className="text-sm font-medium text-zinc-100">Location</span>
                <select
                  className={fieldClassName()}
                  disabled={isFormLocked}
                  onChange={(event) => {
                    const nextLocation = event.target.value as "" | JobLocationType;

                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      location: nextLocation,
                      onsiteDaysPerWeek:
                        nextLocation === "onsite" || nextLocation === "hybrid"
                          ? currentDraft.onsiteDaysPerWeek
                          : "",
                    }));
                  }}
                  value={draft.location}
                >
                  <option value="">Optional</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </select>
              </label>

              <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
                <span className="text-sm font-medium text-zinc-100">Job URL</span>
                <input
                  className={fieldClassName()}
                  disabled={isFormLocked}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      jobUrl: event.target.value,
                    }))
                  }
                  placeholder="https://company.com/jobs/role"
                  type="url"
                  value={draft.jobUrl}
                />
              </label>

              <div className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3 sm:col-span-2">
                <span className="text-sm font-medium text-zinc-100">Salary range</span>
                <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <input
                    className="w-full rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
                    disabled={isFormLocked}
                    onChange={(event) =>
                      handleSalaryRangeChange("minimum", event.target.value)
                    }
                    placeholder="$120k"
                    type="text"
                    value={salaryRange.minimum}
                  />
                  <span className="hidden shrink-0 text-sm text-zinc-500 sm:inline">
                    —
                  </span>
                  <input
                    className="w-full rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
                    disabled={isFormLocked}
                    onChange={(event) =>
                      handleSalaryRangeChange("maximum", event.target.value)
                    }
                    placeholder="$150k"
                    type="text"
                    value={salaryRange.maximum}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-zinc-100">Description</span>
              </div>
              <textarea
                className={`${fieldClassName()} min-h-24 max-h-32 resize-none overflow-y-auto`}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    jobDescription: event.target.value,
                  }))
                }
                placeholder="Optional job description from the screenshot."
                value={draft.jobDescription}
              />
            </div>

            <div className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
              <span className="text-sm font-medium text-zinc-100">Notes</span>
              <textarea
                className={`${fieldClassName()} min-h-24 max-h-32 resize-none overflow-y-auto`}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    notes: event.target.value,
                  }))
                }
                placeholder="Optional notes for follow-up or anything extraction missed."
                value={draft.notes}
              />
            </div>

            <details
              className="rounded-[1rem] border border-white/8 bg-white/5"
              onToggle={(event) =>
                setIsMoreOpen((event.currentTarget as HTMLDetailsElement).open)
              }
              open={isMoreOpen}
            >
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-100 marker:hidden">
                <div className="flex items-center justify-between gap-3">
                  <span>More</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {isMoreOpen ? "Hide" : "Show"}
                  </span>
                </div>
              </summary>

              <div className="grid gap-3 border-t border-white/8 px-3 py-3 sm:grid-cols-2">
                <label className="flex flex-col rounded-[1rem] border border-white/8 bg-black/20 p-3">
                  <span className="text-sm font-medium text-zinc-100">
                    Onsite days / week
                  </span>
                  <input
                    className={fieldClassName()}
                    disabled={isFormLocked || !locationRequiresOnsiteDays}
                    inputMode="numeric"
                    max="7"
                    min="1"
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        onsiteDaysPerWeek: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                    type="number"
                    value={draft.onsiteDaysPerWeek}
                  />
                </label>

            <label className="flex flex-col rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <span className="text-sm font-medium text-zinc-100">Status</span>
              <select
                className={fieldClassName()}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    status: event.target.value as ApplicationStatusValue,
                  }))
                }
                value={draft.status}
              >
                <option value="SAVED">Saved</option>
                <option value="APPLIED">Applied</option>
                <option value="INTERVIEW">Interview</option>
                <option value="OFFER">Offer</option>
                <option value="REJECTED">Rejected</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </label>

            <label className="flex flex-col rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <span className="text-sm font-medium text-zinc-100">
                Employment type
              </span>
              <select
                className={fieldClassName()}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    employmentType: event.target.value as "" | EmploymentTypeValue,
                  }))
                }
                value={draft.employmentType}
              >
                <option value="">Optional</option>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
              </select>
            </label>

            <label className="flex flex-col rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <span className="text-sm font-medium text-zinc-100">
                Team / department
              </span>
              <input
                className={fieldClassName()}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    teamOrDepartment: event.target.value,
                  }))
                }
                placeholder="Platform Engineering"
                type="text"
                value={draft.teamOrDepartment}
              />
            </label>

              </div>
            </details>

            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-400">{footerMessage}</p>
              <div className="flex gap-3">
                <button
                  className="rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isFormLocked}
                  onClick={onReset}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={saveDisabled}
                  type="submit"
                >
                  {isSaving
                    ? "Saving..."
                    : extractingCount > 0
                      ? "Extracting..."
                      : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {isExtracting ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.5rem] bg-black/35 p-4">
            <div className="w-full max-w-sm rounded-[1.5rem] border border-white/10 bg-black/70 px-6 py-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-md">
              <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-emerald-200/15 border-t-emerald-200" />
              <p className="mt-5 text-lg font-semibold text-zinc-50">Processing screenshot</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                {processingLabel ??
                  "The draft fields will update automatically when extraction finishes."}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
