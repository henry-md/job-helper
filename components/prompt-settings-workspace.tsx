"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  tailorResumeGenerationSettingDefinitions,
  tailorResumePromptFieldDefinitions,
} from "@/lib/tailor-resume-settings-metadata";
import { buildTailoredResumeHighlightedPreviewUrl } from "@/lib/tailored-resume-preview-url";
import type {
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";

type PromptSettingsWorkspaceProps = {
  defaultPromptValues: TailorResumeProfile["promptSettings"]["values"];
  initialGenerationSettings: TailorResumeProfile["generationSettings"];
  initialPromptSettings: TailorResumeProfile["promptSettings"];
  tailoredResumes: TailorResumeProfile["tailoredResumes"];
};

type PromptSettingsResponse = {
  error?: string;
  profile?: TailorResumeProfile;
};

type GenerationSettingKey =
  (typeof tailorResumeGenerationSettingDefinitions)[number]["key"];
type PromptFieldKey = (typeof tailorResumePromptFieldDefinitions)[number]["key"];

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

function buildPromptPreviewPdfUrl(record: TailoredResumeRecord | null) {
  if (!record) {
    return null;
  }

  const baseUrl = buildTailoredResumeHighlightedPreviewUrl(record);
  return `${baseUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
}

function compareTailoredResumeUpdatedAt(
  left: TailoredResumeRecord,
  right: TailoredResumeRecord,
) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function DefaultDocumentPreview({
  compact,
}: {
  compact: boolean;
}) {
  const lineClassName = compact ? "h-1" : "h-2";
  const gapClassName = compact ? "gap-1" : "gap-2";
  const paddingClassName = compact ? "p-2" : "p-4";

  return (
    <div
      className={`flex h-full w-full flex-col rounded-[inherit] border border-zinc-200/70 bg-[linear-gradient(180deg,#ffffff,#f4f4f5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${paddingClassName}`}
    >
      <div className={`flex flex-1 flex-col ${gapClassName}`}>
        <div className={`w-3/4 rounded-full bg-zinc-300/85 ${lineClassName}`} />
        <div className={`w-2/3 rounded-full bg-zinc-200/90 ${lineClassName}`} />
        <div className={`w-full rounded-full bg-amber-300/70 ${lineClassName}`} />
        <div className={`w-11/12 rounded-full bg-emerald-300/65 ${lineClassName}`} />
        <div className={`w-4/5 rounded-full bg-zinc-200/90 ${lineClassName}`} />
        {!compact ? (
          <>
            <div className={`w-full rounded-full bg-zinc-200/90 ${lineClassName}`} />
            <div className={`w-5/6 rounded-full bg-zinc-200/90 ${lineClassName}`} />
            <div className={`w-3/5 rounded-full bg-zinc-200/90 ${lineClassName}`} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function PromptRefinementDocumentPreview({
  latestTailoredResume,
}: {
  latestTailoredResume: TailoredResumeRecord | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hasActualPreview = latestTailoredResume !== null;
  const previewLabel = hasActualPreview
    ? `Most recent highlighted tailored resume preview: ${latestTailoredResume?.displayName}`
    : "Default document preview for the highlighted resume context";
  const previewTooltip = hasActualPreview
    ? "Most recent highlighted tailored resume example. Expand to inspect the kind of document preview sent alongside refinement prompts."
    : "Default highlighted document example. Expand to inspect the kind of visual preview used when no tailored resume exists yet.";
  const previewUrl = buildPromptPreviewPdfUrl(latestTailoredResume);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        event.target instanceof Node &&
        !popoverRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="absolute right-4 top-0 z-20 -translate-y-1/2" ref={popoverRef}>
      <button
        aria-expanded={isOpen}
        aria-label={previewLabel}
        className="group flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950 px-2.5 py-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.32)] transition hover:border-emerald-300/28 hover:bg-zinc-900"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        title={previewTooltip}
        type="button"
      >
        <span className="flex h-10 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[0.5rem] border border-white/10 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.16)]">
          {previewUrl ? (
            <iframe
              aria-hidden="true"
              className="pointer-events-none h-[30rem] w-[22rem] origin-top-left scale-[0.12] border-0"
              src={previewUrl}
              tabIndex={-1}
              title={`${previewLabel} thumbnail`}
            />
          ) : (
            <DefaultDocumentPreview compact />
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition group-hover:text-zinc-100">
          <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Preview
        </span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] w-[min(24rem,calc(100vw-4.5rem))] rounded-[1.1rem] border border-white/10 bg-zinc-950/98 p-3 shadow-[0_28px_80px_rgba(0,0,0,0.46)] ring-1 ring-white/8 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Prompt Example
              </p>
              <p className="mt-1 text-sm leading-6 text-zinc-200">
                {hasActualPreview
                  ? "Latest highlighted tailored resume preview used as the settings example."
                  : "Default document preview shown until you have a tailored resume example."}
              </p>
            </div>
            <button
              aria-label="Close prompt example preview"
              className="shrink-0 rounded-full border border-white/10 bg-white/5 p-1.5 text-zinc-300 transition hover:border-white/20 hover:bg-white/10"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            className="mt-3 overflow-hidden rounded-[0.95rem] border border-white/10 bg-zinc-900/70"
            title={previewTooltip}
          >
            {previewUrl ? (
              <iframe
                className="h-[22rem] w-full border-0 bg-white"
                src={previewUrl}
                title={previewLabel}
              />
            ) : (
              <div className="h-[22rem] w-full p-4">
                <DefaultDocumentPreview compact={false} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PromptSettingsWorkspace({
  defaultPromptValues,
  initialGenerationSettings,
  initialPromptSettings,
  tailoredResumes,
}: PromptSettingsWorkspaceProps) {
  const [generationSettings, setGenerationSettings] = useState(
    initialGenerationSettings,
  );
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
  const [isSavingGenerationSettings, setIsSavingGenerationSettings] =
    useState(false);
  const [savingPromptKey, setSavingPromptKey] = useState<PromptFieldKey | null>(
    null,
  );

  useEffect(() => {
    setGenerationSettings(initialGenerationSettings);
  }, [initialGenerationSettings]);

  useEffect(() => {
    setSavedPromptSettings(initialPromptSettings);
    setDraftPromptValues(initialPromptSettings.values);
  }, [initialPromptSettings]);

  const unsavedPromptCount = tailorResumePromptFieldDefinitions.filter(
    ({ key }) => draftPromptValues[key] !== savedPromptSettings.values[key],
  ).length;
  const hasUnsavedChanges = unsavedPromptCount > 0;
  const latestTailoredResume = useMemo(() => {
    if (tailoredResumes.length === 0) {
      return null;
    }

    return [...tailoredResumes].sort(compareTailoredResumeUpdatedAt)[0] ?? null;
  }, [tailoredResumes]);
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

  async function updateGenerationSetting(
    key: GenerationSettingKey,
    nextValue: boolean,
  ) {
    const previousGenerationSettings = generationSettings;

    setGenerationSettings((currentValue) => ({
      ...currentValue,
      values: {
        ...currentValue.values,
        [key]: nextValue,
      },
    }));
    setIsSavingGenerationSettings(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "saveGenerationSettings",
          generationSettings: {
            [key]: nextValue,
          },
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as PromptSettingsResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save the generation settings.");
      }

      setGenerationSettings(payload.profile.generationSettings);
      toast.success("Saved the generation setting.");
    } catch (error) {
      setGenerationSettings(previousGenerationSettings);
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save the generation settings.",
      );
    } finally {
      setIsSavingGenerationSettings(false);
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
            These prompts and generation guardrails are stored per user and are
            sent on the live model calls for job extraction, resume-to-LaTeX
            generation, optional follow-up questioning, tailoring planning,
            refinement, and automatic page-count compaction. Keep any runtime
            tokens you still want injected automatically.
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
        <section className="rounded-[1.35rem] border border-white/8 bg-black/20 p-4 sm:p-5">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Generation Guardrails
            </p>
            <h3 className="mt-2 text-base font-semibold text-zinc-100">
              Tailoring behavior
            </h3>
          </div>

          <div className="mt-4 grid gap-4">
            {tailorResumeGenerationSettingDefinitions.map((setting, index) => {
              const isEnabled = generationSettings.values[setting.key];

              return (
                <div
                  className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${
                    index < tailorResumeGenerationSettingDefinitions.length - 1
                      ? "border-b border-white/8 pb-4"
                      : ""
                  }`}
                  key={setting.key}
                >
                  <div className="max-w-3xl">
                    <h4 className="text-sm font-semibold text-zinc-100">
                      {setting.title}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {setting.description}
                    </p>
                  </div>

                  <button
                    aria-checked={isEnabled}
                    className={`inline-flex min-w-[10.5rem] items-center justify-between gap-3 rounded-full border px-4 py-3 text-sm font-medium transition ${
                      isEnabled
                        ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                        : "border-white/10 bg-white/[0.04] text-zinc-300"
                    } ${isSavingGenerationSettings ? "cursor-wait opacity-70" : "hover:border-white/20 hover:bg-white/[0.07]"}`}
                    disabled={isSavingGenerationSettings}
                    onClick={() =>
                      void updateGenerationSetting(setting.key, !isEnabled)
                    }
                    role="switch"
                    type="button"
                  >
                    <span className="text-left">{isEnabled ? "Enabled" : "Disabled"}</span>
                    <span
                      aria-hidden="true"
                      className={`relative h-6 w-11 rounded-full transition ${
                        isEnabled ? "bg-emerald-300/35" : "bg-white/12"
                      }`}
                    >
                      <span
                        className={`absolute top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.3)] transition ${
                          isEnabled ? "left-[1.35rem]" : "left-1"
                        }`}
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-black/20">
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
                  {tailorResumePromptFieldDefinitions.length} templates
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
              {tailorResumePromptFieldDefinitions.map((field) => {
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
                    className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-zinc-950/35"
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

                        <div className="relative mt-4">
                          {field.key === "tailorResumeRefinement" ||
                          field.key === "tailorResumePageCountCompaction" ? (
                            <PromptRefinementDocumentPreview
                              latestTailoredResume={latestTailoredResume}
                            />
                          ) : null}

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
