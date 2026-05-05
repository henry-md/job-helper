"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { TailorResumeProfile } from "@/lib/tailor-resume-types";
import {
  formatTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerms,
} from "@/lib/tailor-resume-non-technologies";
import type { TailorResumeUserMemoryState } from "@/lib/tailor-resume-user-memory";

type UserMemoryCardProps = {
  initialUserMemory: TailorResumeUserMemoryState;
  onUserMemoryChange?: (userMemory: TailorResumeUserMemoryState) => void;
};

type UserMemoryResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  userMemory?: TailorResumeUserMemoryState;
};

async function saveTailorResumeUserMemory(input: {
  markdown: string;
  nonTechnologyNames: readonly string[];
  updatedAt: string | null;
}) {
  const response = await fetch("/api/tailor-resume", {
    body: JSON.stringify({
      action: "saveUserMarkdown",
      markdown: input.markdown,
      nonTechnologyNames: input.nonTechnologyNames,
      updatedAt: input.updatedAt,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json()) as UserMemoryResponse;

  if (!response.ok || !payload.userMemory) {
    throw new Error(payload.error ?? "Unable to save user memory.");
  }

  return payload.userMemory;
}

export default function UserMarkdownCard({
  initialUserMemory,
  onUserMemoryChange,
}: UserMemoryCardProps) {
  const [savedUserMemory, setSavedUserMemory] = useState(initialUserMemory);
  const [draftUserMarkdown, setDraftUserMarkdown] = useState(
    initialUserMemory.userMarkdown.markdown,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isChanged =
    draftUserMarkdown !== savedUserMemory.userMarkdown.markdown;

  useEffect(() => {
    setSavedUserMemory(initialUserMemory);
    setDraftUserMarkdown(initialUserMemory.userMarkdown.markdown);
  }, [initialUserMemory]);

  function applySavedUserMemory(nextUserMemory: TailorResumeUserMemoryState) {
    setSavedUserMemory(nextUserMemory);
    setDraftUserMarkdown(nextUserMemory.userMarkdown.markdown);
    onUserMemoryChange?.(nextUserMemory);
  }

  function cancelEdits() {
    setDraftUserMarkdown(savedUserMemory.userMarkdown.markdown);
    setIsOpen(false);
  }

  async function saveUserMarkdown() {
    if (!isChanged) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);

    try {
      const nextUserMemory = await saveTailorResumeUserMemory({
        markdown: draftUserMarkdown,
        nonTechnologyNames: savedUserMemory.nonTechnologyNames,
        updatedAt: savedUserMemory.updatedAt,
      });

      applySavedUserMemory(nextUserMemory);
      setIsOpen(false);
      toast.success("Saved USER.md.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save USER.md.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="glass-panel soft-ring overflow-hidden rounded-[1.5rem]">
      <button
        aria-controls="config-user-markdown-panel"
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.03] sm:px-5"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            User Memory
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
              USER.md
            </h2>
            <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {draftUserMarkdown.length.toLocaleString()} chars
            </span>
            {isChanged ? (
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                Unsaved
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Durable resume context about you, used when tailoring resumes.
            This section starts collapsed by default.
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`mt-1 h-5 w-5 shrink-0 text-zinc-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          className="border-t border-white/8 px-4 py-4 sm:px-5"
          id="config-user-markdown-panel"
        >
          <textarea
            className="min-h-[280px] w-full resize-y rounded-[1.1rem] border border-white/10 bg-zinc-950/75 px-4 py-4 font-mono text-[12px] leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
            onChange={(event) => setDraftUserMarkdown(event.target.value)}
            readOnly={isSaving}
            spellCheck={false}
            value={draftUserMarkdown}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving}
              onClick={cancelEdits}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
                isSaving
                  ? "cursor-wait border border-white/10 bg-white/[0.04] text-zinc-500"
                  : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              }`}
              disabled={isSaving || !isChanged}
              onClick={() => void saveUserMarkdown()}
              type="button"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function NonTechnologyNamesCard({
  initialUserMemory,
  onUserMemoryChange,
}: UserMemoryCardProps) {
  const [savedUserMemory, setSavedUserMemory] = useState(initialUserMemory);
  const [draftNonTechnologies, setDraftNonTechnologies] = useState(
    initialUserMemory.nonTechnologyNames,
  );
  const [draftInput, setDraftInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isChanged =
    draftNonTechnologies.join("\n") !==
    savedUserMemory.nonTechnologyNames.join("\n");

  useEffect(() => {
    setSavedUserMemory(initialUserMemory);
    setDraftNonTechnologies(initialUserMemory.nonTechnologyNames);
    setDraftInput("");
  }, [initialUserMemory]);

  function applySavedUserMemory(nextUserMemory: TailorResumeUserMemoryState) {
    setSavedUserMemory(nextUserMemory);
    setDraftNonTechnologies(nextUserMemory.nonTechnologyNames);
    setDraftInput("");
    onUserMemoryChange?.(nextUserMemory);
  }

  function addDraftTerm() {
    const normalizedTerm = normalizeTailorResumeNonTechnologyTerm(draftInput);

    if (!normalizedTerm) {
      return;
    }

    try {
      setDraftNonTechnologies((currentTerms) =>
        normalizeTailorResumeNonTechnologyTerms([
          ...currentTerms,
          normalizedTerm,
        ]),
      );
      setDraftInput("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to add non-technology term.",
      );
    }
  }

  function removeDraftTerm(term: string) {
    const normalizedTerm = normalizeTailorResumeNonTechnologyTerm(term);

    setDraftNonTechnologies((currentTerms) =>
      currentTerms.filter(
        (currentTerm) =>
          normalizeTailorResumeNonTechnologyTerm(currentTerm) !== normalizedTerm,
      ),
    );
  }

  function cancelEdits() {
    setDraftNonTechnologies(savedUserMemory.nonTechnologyNames);
    setDraftInput("");
  }

  async function saveNonTechnologies() {
    if (!isChanged) {
      return;
    }

    setIsSaving(true);

    try {
      const nextUserMemory = await saveTailorResumeUserMemory({
        markdown: savedUserMemory.userMarkdown.markdown,
        nonTechnologyNames: draftNonTechnologies,
        updatedAt: savedUserMemory.updatedAt,
      });

      applySavedUserMemory(nextUserMemory);
      toast.success("Saved non-technologies.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save non-technologies.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="glass-panel soft-ring rounded-[1.5rem] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Scraper Reliability
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
              Non-technologies
            </h2>
            {isChanged ? (
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                Unsaved
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Terms ignored when job keywords are scraped.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {draftNonTechnologies.length > 0 ? (
          draftNonTechnologies.map((term) => (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-zinc-200"
              key={term}
            >
              <span className="truncate">
                {formatTailorResumeNonTechnologyTerm(term)}
              </span>
              <button
                aria-label={`Remove ${formatTailorResumeNonTechnologyTerm(
                  term,
                )}`}
                className="inline-flex size-4 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/10 hover:text-zinc-100"
                disabled={isSaving}
                onClick={() => removeDraftTerm(term)}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))
        ) : (
          <span className="rounded-full border border-dashed border-white/10 px-3 py-1 text-xs text-zinc-500">
            No terms
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="min-h-10 flex-1 rounded-full border border-white/10 bg-zinc-950/75 px-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
          disabled={isSaving}
          onChange={(event) => setDraftInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraftTerm();
            }
          }}
          placeholder="Add a term"
          value={draftInput}
        />
        <button
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            isSaving || !normalizeTailorResumeNonTechnologyTerm(draftInput)
          }
          onClick={addDraftTerm}
          type="button"
        >
          Add
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || !isChanged}
          onClick={cancelEdits}
          type="button"
        >
          Cancel
        </button>
        <button
          className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
            isSaving
              ? "cursor-wait border border-white/10 bg-white/[0.04] text-zinc-500"
              : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          }`}
          disabled={isSaving || !isChanged}
          onClick={() => void saveNonTechnologies()}
          type="button"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}
