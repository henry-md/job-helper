"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { TailorResumeProfile } from "@/lib/tailor-resume-types";
import type { TailorResumeUserMarkdownState } from "@/lib/tailor-resume-user-memory";

type UserMarkdownCardProps = {
  initialUserMarkdown: TailorResumeUserMarkdownState;
  onUserMarkdownChange?: (userMarkdown: TailorResumeUserMarkdownState) => void;
};

type UserMarkdownResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  userMarkdown?: TailorResumeUserMarkdownState;
};

export default function UserMarkdownCard({
  initialUserMarkdown,
  onUserMarkdownChange,
}: UserMarkdownCardProps) {
  const [savedUserMarkdown, setSavedUserMarkdown] =
    useState(initialUserMarkdown);
  const [draftUserMarkdown, setDraftUserMarkdown] = useState(
    initialUserMarkdown.markdown,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isChanged = draftUserMarkdown !== savedUserMarkdown.markdown;

  useEffect(() => {
    setSavedUserMarkdown(initialUserMarkdown);
    setDraftUserMarkdown(initialUserMarkdown.markdown);
  }, [initialUserMarkdown]);

  function applySavedUserMarkdown(nextUserMarkdown: TailorResumeUserMarkdownState) {
    setSavedUserMarkdown(nextUserMarkdown);
    setDraftUserMarkdown(nextUserMarkdown.markdown);
    onUserMarkdownChange?.(nextUserMarkdown);
  }

  function cancelEdits() {
    setDraftUserMarkdown(savedUserMarkdown.markdown);
    setIsOpen(false);
  }

  async function saveUserMarkdown() {
    if (!isChanged) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "saveUserMarkdown",
          markdown: draftUserMarkdown,
          updatedAt: savedUserMarkdown.updatedAt,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as UserMarkdownResponse;

      if (!response.ok || !payload.userMarkdown) {
        if (payload.userMarkdown) {
          applySavedUserMarkdown(payload.userMarkdown);
        }

        throw new Error(payload.error ?? "Unable to save USER.md.");
      }

      applySavedUserMarkdown(payload.userMarkdown);
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
            Durable resume context used by the extension when tailoring resumes.
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
                  : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
              }`}
              disabled={isSaving}
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
