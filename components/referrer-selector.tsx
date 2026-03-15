"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CompanyOption,
  JobApplicationDraft,
  ReferrerOption,
} from "@/lib/job-application-types";

function scoreMatch(name: string, query: string) {
  const normalizedName = name.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 1;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return normalizedQuery.length + 10;
  }

  let score = 0;
  let queryIndex = 0;

  for (const character of normalizedName) {
    if (character === normalizedQuery[queryIndex]) {
      score += 1;
      queryIndex += 1;

      if (queryIndex === normalizedQuery.length) {
        return score;
      }
    }
  }

  return -1;
}

export default function ReferrerSelector({
  companyOptions,
  currentCompanyName,
  draft,
  isFormLocked,
  referrerOptions,
  setDraft,
  setReferrerOptions,
}: {
  companyOptions: CompanyOption[];
  currentCompanyName: string;
  draft: JobApplicationDraft;
  isFormLocked: boolean;
  referrerOptions: ReferrerOption[];
  setDraft: React.Dispatch<React.SetStateAction<JobApplicationDraft>>;
  setReferrerOptions: React.Dispatch<React.SetStateAction<ReferrerOption[]>>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCompanyName, setCreateCompanyName] = useState(currentCompanyName);
  const [createRecruiterContact, setCreateRecruiterContact] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedReferrer =
    referrerOptions.find((option) => option.id === draft.referrerId) ?? null;

  useEffect(() => {
    if (!isCreateOpen) {
      return;
    }

    setCreateCompanyName(currentCompanyName);
  }, [currentCompanyName, isCreateOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerOrFocusOutside(event: MouseEvent | FocusEvent) {
      const eventTarget = event.target;

      if (
        eventTarget instanceof Node &&
        containerRef.current?.contains(eventTarget)
      ) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerOrFocusOutside);
    document.addEventListener("focusin", handlePointerOrFocusOutside);

    return () => {
      document.removeEventListener("mousedown", handlePointerOrFocusOutside);
      document.removeEventListener("focusin", handlePointerOrFocusOutside);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    return referrerOptions
      .map((option) => ({
        option,
        score: scoreMatch(
          `${option.name} ${option.companyName ?? ""}`,
          query,
        ),
      }))
      .filter((item) => item.score >= 0)
      .sort((left, right) => right.score - left.score || left.option.name.localeCompare(right.option.name))
      .map((item) => item.option);
  }, [query, referrerOptions]);

  function openCreatePersonModal() {
    setCreateError(null);
    setCreateName(draft.referrerName || query);
    setCreateCompanyName(currentCompanyName);
    setCreateRecruiterContact(selectedReferrer?.recruiterContact ?? draft.recruiterContact);
    setIsCreateOpen(true);
    setIsOpen(false);
  }

  async function handleCreateReferrer() {
    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch("/api/referrers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: createName,
          companyName: createCompanyName,
          recruiterContact: createRecruiterContact,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        referrer?: ReferrerOption;
      };

      if (!response.ok || !payload.referrer) {
        throw new Error(payload.error ?? "Failed to create the referrer.");
      }

      setReferrerOptions((currentOptions) => {
        const otherOptions = currentOptions.filter(
          (option) => option.id !== payload.referrer?.id,
        );

        return [...otherOptions, payload.referrer as ReferrerOption].sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      });
      setDraft((currentDraft) => ({
        ...currentDraft,
        referrerId: payload.referrer?.id ?? "",
        referrerName: payload.referrer?.name ?? "",
        recruiterContact: payload.referrer?.recruiterContact ?? "",
      }));
      setCreateName("");
      setCreateCompanyName(currentCompanyName);
      setCreateRecruiterContact("");
      setQuery(payload.referrer.name);
      setIsCreateOpen(false);
      setIsOpen(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create the referrer.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex min-w-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-100">Referrer</span>
        <button
          className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-400 transition hover:border-white/20 hover:text-zinc-200 disabled:opacity-60"
          disabled={isFormLocked}
          onClick={openCreatePersonModal}
          type="button"
        >
          Create person
        </button>
      </div>

      <button
        className="mt-2 flex min-h-[42px] items-center justify-between rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-left text-sm text-zinc-100 transition disabled:opacity-60"
        disabled={isFormLocked}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        <span className={selectedReferrer ? "text-zinc-100" : "text-zinc-500"}>
          {selectedReferrer?.name || draft.referrerName || "Optional"}
        </span>
        <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">
          {isOpen ? "Hide" : "Choose"}
        </span>
      </button>

      {selectedReferrer?.companyName ? (
        <p className="mt-2 text-xs text-zinc-500">
          {selectedReferrer.companyName}
        </p>
      ) : null}

      {selectedReferrer?.recruiterContact ? (
        <p className="mt-1 text-xs text-zinc-500">
          {selectedReferrer.recruiterContact}
        </p>
      ) : null}

      {isOpen ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-[1rem] border border-white/10 bg-zinc-950/95 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <input
            autoFocus
            className="w-full rounded-[0.9rem] border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-300/45"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search referrers"
            type="search"
            value={query}
          />
          <div className="mt-3 max-h-60 overflow-auto">
            <button
              className="flex w-full items-center justify-between rounded-[0.9rem] px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
              onClick={() => {
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  referrerId: "",
                  referrerName: "",
                  recruiterContact: "",
                }));
                setIsOpen(false);
              }}
              type="button"
            >
              <span>No referrer</span>
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2">
                <p className="text-sm text-zinc-500">
                  No matches. Create a new referrer.
                </p>
                <button
                  className="mt-3 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-emerald-200 transition hover:bg-emerald-400/15"
                  onClick={openCreatePersonModal}
                  type="button"
                >
                  Create person
                </button>
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  className={`mt-1 flex w-full items-center justify-between rounded-[0.9rem] px-3 py-2 text-left text-sm transition ${
                    option.id === draft.referrerId
                      ? "bg-emerald-400/10 text-emerald-200"
                      : "text-zinc-200 hover:bg-white/5"
                  }`}
                  onClick={() => {
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      referrerId: option.id,
                      referrerName: option.name,
                      recruiterContact: option.recruiterContact ?? "",
                    }));
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  <div>
                    <p>{option.name}</p>
                    {option.companyName ? (
                      <p className="text-xs text-zinc-500">{option.companyName}</p>
                    ) : null}
                    {option.recruiterContact ? (
                      <p className="text-xs text-zinc-500">{option.recruiterContact}</p>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
          {filteredOptions.length > 0 ? (
            <div className="mt-3 border-t border-white/8 pt-3">
              <button
                className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-emerald-200 transition hover:bg-emerald-400/15"
                onClick={openCreatePersonModal}
                type="button"
              >
                Create person
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.25rem] border border-white/10 bg-zinc-950 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  New referrer
                </p>
                <h3 className="mt-1 text-lg font-semibold text-zinc-50">
                  Create person
                </h3>
              </div>
              <button
                className="text-sm text-zinc-500 transition hover:text-zinc-200"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <label className="mt-4 block text-sm font-medium text-zinc-100">
              Name
              <input
                className="mt-2 w-full rounded-[1rem] border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-300/45"
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Jane Smith"
                type="text"
                value={createName}
              />
            </label>

            <label className="mt-3 block text-sm font-medium text-zinc-100">
              Company
              <input
                className="mt-2 w-full rounded-[1rem] border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-300/45"
                list="referrer-company-options"
                onChange={(event) => setCreateCompanyName(event.target.value)}
                placeholder="Optional company"
                type="text"
                value={createCompanyName}
              />
              <datalist id="referrer-company-options">
                {companyOptions.map((company) => (
                  <option key={company.id} value={company.name} />
                ))}
              </datalist>
            </label>

            <label className="mt-3 block text-sm font-medium text-zinc-100">
              Contact
              <input
                className="mt-2 w-full rounded-[1rem] border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-300/45"
                onChange={(event) => setCreateRecruiterContact(event.target.value)}
                placeholder="Optional recruiter name or email"
                type="text"
                value={createRecruiterContact}
              />
            </label>

            {createError ? (
              <p className="mt-3 text-sm text-amber-200">{createError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-3">
              <button
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/20 hover:text-zinc-100"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-400/15 disabled:opacity-60"
                disabled={isCreating || createName.trim().length === 0}
                onClick={() => void handleCreateReferrer()}
                type="button"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
