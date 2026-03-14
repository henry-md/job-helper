"use client";

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobApplicationDraft,
  JobLocationType,
} from "@/lib/job-application-types";

function fieldClassName() {
  return "mt-2 w-full rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45";
}

export default function ApplicationWindow({
  children,
  draft,
  extractingCount = 0,
  footerMessage = "Save when title and company look correct.",
  isFormLocked,
  isMoreOpen,
  isSaving,
  latestModel,
  onReset,
  onSubmit,
  saveDisabled,
  setDraft,
  setIsMoreOpen,
}: {
  children?: ReactNode;
  draft: JobApplicationDraft;
  extractingCount?: number;
  footerMessage?: string;
  isFormLocked: boolean;
  isMoreOpen: boolean;
  isSaving: boolean;
  latestModel?: string | null;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saveDisabled: boolean;
  setDraft: Dispatch<SetStateAction<JobApplicationDraft>>;
  setIsMoreOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const locationRequiresOnsiteDays =
    draft.location === "onsite" || draft.location === "hybrid";

  return (
    <form className="flex h-full min-h-0 flex-col gap-3" onSubmit={onSubmit}>
      {children}

      <div className="grid min-h-0 gap-3 overflow-auto rounded-[1.25rem] border border-white/8 bg-black/20 p-3 sm:grid-cols-2">
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

        <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
          <span className="text-sm font-medium text-zinc-100">Referral</span>
          <div className="mt-2 flex h-[42px] items-center rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3">
            <input
              checked={draft.hasReferral}
              className="h-4 w-4 accent-emerald-300"
              disabled={isFormLocked}
              id="hasReferral"
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  hasReferral: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <label className="ml-3 text-sm text-zinc-300" htmlFor="hasReferral">
              Referred
            </label>
          </div>
        </label>

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

        <label className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
          <span className="text-sm font-medium text-zinc-100">Salary range</span>
          <input
            className={fieldClassName()}
            disabled={isFormLocked}
            onChange={(event) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                salaryRange: event.target.value,
              }))
            }
            placeholder="$120k - $150k"
            type="text"
            value={draft.salaryRange}
          />
        </label>

        <div className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-100">Description</span>
            {latestModel ? (
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                {latestModel}
              </span>
            ) : null}
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

        <div className="flex flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3 sm:col-span-2">
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
          className="rounded-[1rem] border border-white/8 bg-white/5 sm:col-span-2"
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

            <label className="flex flex-col rounded-[1rem] border border-white/8 bg-black/20 p-3 sm:col-span-2">
              <span className="text-sm font-medium text-zinc-100">
                Recruiter / contact
              </span>
              <input
                className={fieldClassName()}
                disabled={isFormLocked}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    recruiterContact: event.target.value,
                  }))
                }
                placeholder="Recruiter name or email"
                type="text"
                value={draft.recruiterContact}
              />
            </label>
          </div>
        </details>

        <div className="flex flex-col justify-center gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
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
    </form>
  );
}
