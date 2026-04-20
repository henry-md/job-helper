"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { TailorResumeProfile } from "@/lib/tailor-resume-types";

type PromptSettingsWorkspaceProps = {
  defaultPromptValues: TailorResumeProfile["promptSettings"]["values"];
  initialPromptSettings: TailorResumeProfile["promptSettings"];
};

type PromptSettingsResponse = {
  error?: string;
  profile?: TailorResumeProfile;
};

const promptFieldDefinitions = [
  {
    description:
      "Screenshots and browser evidence into structured application fields.",
    helper: "Runtime tokens: none.",
    key: "jobApplicationExtraction",
    minHeightClassName: "min-h-[220px]",
    title: "Job Application Extraction",
  },
  {
    description:
      "Uploaded base resume into the editable LaTeX source document.",
    helper:
      "Runtime tokens: {{RETRY_INSTRUCTIONS}}, {{MAX_ATTEMPTS}}.",
    key: "resumeLatexExtraction",
    minHeightClassName: "min-h-[420px]",
    title: "Resume To LaTeX",
  },
  {
    description:
      "Stage 1 tailoring strategy over plaintext resume blocks.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumePlanning",
    minHeightClassName: "min-h-[420px]",
    title: "Tailoring Plan",
  },
  {
    description:
      "Stage 2 LaTeX block generation for the tailored resume.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumeImplementation",
    minHeightClassName: "min-h-[420px]",
    title: "Tailored Block Generation",
  },
  {
    description:
      "Follow-up regeneration of existing tailored resume edit blocks.",
    helper: "Runtime tokens: {{FEEDBACK_BLOCK}}.",
    key: "tailorResumeRefinement",
    minHeightClassName: "min-h-[360px]",
    title: "Tailored Block Refinement",
  },
] as const;

type PromptFieldKey = (typeof promptFieldDefinitions)[number]["key"];

function formatSavedAt(value: string | null) {
  if (!value) {
    return "Using the shipped defaults.";
  }

  try {
    return `Saved ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))}.`;
  } catch {
    return "Saved.";
  }
}

export default function PromptSettingsWorkspace({
  defaultPromptValues,
  initialPromptSettings,
}: PromptSettingsWorkspaceProps) {
  const [savedPromptSettings, setSavedPromptSettings] = useState(
    initialPromptSettings,
  );
  const [draftPromptValues, setDraftPromptValues] = useState(
    initialPromptSettings.values,
  );
  const [isSystemPromptsOpen, setIsSystemPromptsOpen] = useState(false);
  const [openPromptKeys, setOpenPromptKeys] = useState<
    Partial<Record<PromptFieldKey, boolean>>
  >({});
  const [previewingOriginalKey, setPreviewingOriginalKey] =
    useState<PromptFieldKey | null>(null);
  const [savingPromptKey, setSavingPromptKey] = useState<PromptFieldKey | null>(
    null,
  );

  useEffect(() => {
    setSavedPromptSettings(initialPromptSettings);
    setDraftPromptValues(initialPromptSettings.values);
  }, [initialPromptSettings]);

  const unsavedPromptCount = promptFieldDefinitions.filter(
    ({ key }) => draftPromptValues[key] !== savedPromptSettings.values[key],
  ).length;
  const hasUnsavedChanges = unsavedPromptCount > 0;

  function isPromptChanged(key: PromptFieldKey) {
    return draftPromptValues[key] !== savedPromptSettings.values[key];
  }

  function togglePromptOpen(key: PromptFieldKey) {
    setOpenPromptKeys((currentValue) => ({
      ...currentValue,
      [key]: !currentValue[key],
    }));
    setPreviewingOriginalKey((currentValue) =>
      currentValue === key ? null : currentValue,
    );
  }

  function cancelPromptEdits(key: PromptFieldKey) {
    setDraftPromptValues((currentValue) => ({
      ...currentValue,
      [key]: savedPromptSettings.values[key],
    }));
    setPreviewingOriginalKey((currentValue) =>
      currentValue === key ? null : currentValue,
    );
    setOpenPromptKeys((currentValue) => ({
      ...currentValue,
      [key]: false,
    }));
  }

  function revertPromptDraft(key: PromptFieldKey) {
    setDraftPromptValues((currentValue) => ({
      ...currentValue,
      [key]: defaultPromptValues[key],
    }));
    setPreviewingOriginalKey((currentValue) =>
      currentValue === key ? null : currentValue,
    );
  }

  async function savePromptField(key: PromptFieldKey) {
    if (!isPromptChanged(key)) {
      setOpenPromptKeys((currentValue) => ({
        ...currentValue,
        [key]: false,
      }));
      return;
    }

    setSavingPromptKey(key);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "savePromptSettings",
          promptSettings: {
            [key]: draftPromptValues[key],
          },
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as PromptSettingsResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save the prompt settings.");
      }

      const nextPromptSettings = payload.profile.promptSettings;

      setSavedPromptSettings(nextPromptSettings);
      setDraftPromptValues((currentValue) => ({
        ...currentValue,
        [key]: nextPromptSettings.values[key],
      }));
      setOpenPromptKeys((currentValue) => ({
        ...currentValue,
        [key]: false,
      }));
      setPreviewingOriginalKey((currentValue) =>
        currentValue === key ? null : currentValue,
      );
      toast.success("Saved the prompt.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save the prompt settings.",
      );
    } finally {
      setSavingPromptKey(null);
    }
  }

  return (
    <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-4">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Settings
          </p>
          <h2 className="mt-2 text-[1.45rem] font-semibold tracking-tight text-zinc-50">
            Prompt Controls
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            These prompts are stored per user and are sent on the live model
            calls for job extraction, resume-to-LaTeX generation, tailoring,
            and tailored block refinement. Keep any runtime tokens you still
            want injected automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
          <span className="rounded-full border border-white/10 px-3 py-1">
            {formatSavedAt(savedPromptSettings.updatedAt)}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">
            {hasUnsavedChanges
              ? `${unsavedPromptCount} unsaved prompt${unsavedPromptCount === 1 ? "" : "s"}`
              : "All changes saved"}
          </span>
        </div>
      </div>

      <div className="mt-5 overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
        <section className="rounded-[1.35rem] border border-white/8 bg-black/20">
          <button
            aria-controls="system-prompts-panel"
            aria-expanded={isSystemPromptsOpen}
            className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.03] sm:px-5"
            onClick={() => setIsSystemPromptsOpen((currentValue) => !currentValue)}
            type="button"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-base font-semibold text-zinc-100">
                  System Prompts
                </h3>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  {promptFieldDefinitions.length} templates
                </span>
                {hasUnsavedChanges ? (
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                    {unsavedPromptCount} unsaved
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                View and edit the live instruction templates used by the app.
                This section starts collapsed by default to keep settings tidy.
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`shrink-0 text-zinc-400 transition-transform ${
                isSystemPromptsOpen ? "rotate-180" : ""
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
          </button>

          {isSystemPromptsOpen ? (
            <div
              className="grid gap-4 border-t border-white/8 px-4 py-4 sm:px-5"
              id="system-prompts-panel"
            >
              {promptFieldDefinitions.map((field) => {
                const isOpen = openPromptKeys[field.key] === true;
                const isChanged = isPromptChanged(field.key);
                const isPreviewingOriginal = previewingOriginalKey === field.key;
                const isSaving = savingPromptKey === field.key;
                const isAtOriginalValue =
                  draftPromptValues[field.key] === defaultPromptValues[field.key];
                const displayedValue = isPreviewingOriginal
                  ? defaultPromptValues[field.key]
                  : draftPromptValues[field.key];

                return (
                  <section
                    className="rounded-[1.35rem] border border-white/8 bg-zinc-950/35"
                    key={field.key}
                  >
                    <button
                      aria-controls={`${field.key}-panel`}
                      aria-expanded={isOpen}
                      className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.03] sm:px-5"
                      onClick={() => togglePromptOpen(field.key)}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h4 className="text-base font-semibold text-zinc-100">
                            {field.title}
                          </h4>
                          <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            {draftPromptValues[field.key].length.toLocaleString()} chars
                          </span>
                          {isChanged ? (
                            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                              Unsaved
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          {field.description}
                        </p>
                      </div>
                      <span
                        aria-hidden="true"
                        className={`shrink-0 pt-1 text-zinc-400 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20">
                          <path
                            d="m5 7.5 5 5 5-5"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.7"
                          />
                        </svg>
                      </span>
                    </button>

                    {isOpen ? (
                      <div
                        className="border-t border-white/8 px-4 py-4 sm:px-5"
                        id={`${field.key}-panel`}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-xs leading-5 text-zinc-500">
                            {field.helper}
                          </p>
                          <span
                            aria-hidden={!isPreviewingOriginal}
                            className={`rounded-full border border-slate-300/15 bg-slate-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400 transition-opacity ${
                              isPreviewingOriginal
                                ? "opacity-100"
                                : "invisible opacity-0"
                            }`}
                          >
                            Previewing original text
                          </span>
                        </div>

                        <div className="mt-4">
                          <textarea
                            className={`${field.minHeightClassName} w-full resize-y rounded-[1.1rem] border border-white/10 bg-zinc-950/75 px-4 py-4 font-mono text-[12px] leading-6 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45 ${
                              isPreviewingOriginal
                                ? "text-zinc-500"
                                : "text-zinc-100"
                            }`}
                            onChange={(event) =>
                              setDraftPromptValues((currentValues) => ({
                                ...currentValues,
                                [field.key]: event.target.value,
                              }))
                            }
                            readOnly={isPreviewingOriginal || isSaving}
                            spellCheck={false}
                            value={displayedValue}
                          />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isSaving}
                            onClick={() => cancelPromptEdits(field.key)}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className={`rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                              isAtOriginalValue
                                ? "border-white/10 bg-white/[0.04] text-zinc-500"
                                : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-white/20 hover:bg-white/[0.08]"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                            disabled={isSaving || isAtOriginalValue}
                            onBlur={() =>
                              setPreviewingOriginalKey((currentValue) =>
                                currentValue === field.key ? null : currentValue,
                              )
                            }
                            onClick={() => revertPromptDraft(field.key)}
                            onFocus={() => setPreviewingOriginalKey(field.key)}
                            onMouseEnter={() => setPreviewingOriginalKey(field.key)}
                            onMouseLeave={() =>
                              setPreviewingOriginalKey((currentValue) =>
                                currentValue === field.key ? null : currentValue,
                              )
                            }
                            type="button"
                          >
                            Revert
                          </button>
                          <button
                            className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
                              isSaving
                                ? "cursor-wait border border-white/10 bg-white/[0.04] text-zinc-500"
                                : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                            }`}
                            disabled={isSaving}
                            onClick={() => void savePromptField(field.key)}
                            type="button"
                          >
                            {isSaving ? "Saving..." : "Done"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
