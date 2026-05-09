"use client";

import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  TailorResumeProfile,
  TailorResumeStoredSkillData,
} from "@/lib/tailor-resume-types";
import {
  formatTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerms,
} from "@/lib/tailor-resume-non-technologies";
import {
  filterTailorResumeSpareBulletsForSearch,
  tailorResumeSpareBulletSearchModes,
  type TailorResumeSpareBulletSearchMode,
} from "@/lib/tailor-resume-spare-bullet-search";
import {
  formatTailorResumeSpareBulletLineCount,
  readTailorResumeSpareBulletLineTone,
  type TailorResumeSpareBulletLineMeasurement,
} from "@/lib/tailor-resume-spare-bullet-line-display";
import type { TailorResumeUserMemoryState } from "@/lib/tailor-resume-user-memory";

type UserMemoryCardProps = {
  initialUserMemory: TailorResumeUserMemoryState;
  onUserMemoryChange?: (userMemory: TailorResumeUserMemoryState) => void;
};

type UserMemoryResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  skillData?: TailorResumeStoredSkillData | null;
  userMemory?: TailorResumeUserMemoryState;
};

type SkillDataResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  spareBulletMeasurement?: TailorResumeSpareBulletLineMeasurement | null;
  skillData?: TailorResumeStoredSkillData | null;
};

type SpareBulletsCardProps = {
  initialSkillData: TailorResumeStoredSkillData;
  onSkillDataChange?: (skillData: TailorResumeStoredSkillData) => void;
  onTailorResumeProfileChange?: (profile: TailorResumeProfile) => void;
};

type SpareBulletEditDraft = {
  id: string;
  quote: string;
  replacesQuote: string;
  resumeExperienceId: string;
  skillNames: string;
};

type SpareBulletQuoteFieldProps = {
  disabled: boolean;
  labelClassName: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resumeExperienceId: string;
  textareaClassName: string;
  value: string;
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

async function patchTailorResumeSkillData(
  body: Record<string, unknown>,
): Promise<SkillDataResponse> {
  const response = await fetch("/api/tailor-resume", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json()) as SkillDataResponse;

  if (!response.ok) {
    throw new Error(
      payload.error ?? "Unable to save skills-section support.",
    );
  }

  return payload;
}

async function measureTailorResumeSpareBulletLineCount(input: {
  quote: string;
  resumeExperienceId: string;
}) {
  const payload = await patchTailorResumeSkillData({
    action: "measureSpareBullet",
    quote: input.quote,
    resumeExperienceId: input.resumeExperienceId,
  });

  if (!payload.spareBulletMeasurement) {
    throw new Error("Unable to measure the rendered bullet line count.");
  }

  return payload.spareBulletMeasurement;
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

function splitSkillNames(value: string) {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function formatSpareBulletSkills(
  spareBullet: TailorResumeStoredSkillData["spareBullets"][number],
) {
  return spareBullet.skills.map((skill) => skill.name).join(", ");
}

type SpareBulletLineMeasurementState =
  | { key: string; status: "error"; message: string }
  | { key: string; status: "idle" }
  | { key: string; status: "measuring" }
  | {
      key: string;
      measurement: TailorResumeSpareBulletLineMeasurement;
      status: "ready";
    };

function buildSpareBulletMeasurementKey(input: {
  quote: string;
  resumeExperienceId: string;
}) {
  const quote = input.quote.trim();
  const resumeExperienceId = input.resumeExperienceId.trim();

  if (!quote || !resumeExperienceId) {
    return "";
  }

  return JSON.stringify([quote, resumeExperienceId]);
}

function useSpareBulletLineMeasurement(input: {
  quote: string;
  resumeExperienceId: string;
}) {
  const { quote, resumeExperienceId } = input;
  const key = useMemo(
    () =>
      buildSpareBulletMeasurementKey({
        quote,
        resumeExperienceId,
      }),
    [quote, resumeExperienceId],
  );
  const [state, setState] = useState<SpareBulletLineMeasurementState>({
    key: "",
    status: "idle",
  });

  useEffect(() => {
    if (!key) {
      return;
    }

    let isCancelled = false;
    const timeout = window.setTimeout(() => {
      setState({ key, status: "measuring" });

      void measureTailorResumeSpareBulletLineCount({
        quote,
        resumeExperienceId,
      })
        .then((measurement) => {
          if (!isCancelled) {
            setState({ key, measurement, status: "ready" });
          }
        })
        .catch((error: unknown) => {
          if (!isCancelled) {
            setState({
              key,
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to measure line count.",
              status: "error",
            });
          }
        });
    }, 650);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeout);
    };
  }, [key, quote, resumeExperienceId]);

  return state.key === key ? state : { key, status: "idle" as const };
}

function SpareBulletLineCountBadge({
  state,
}: {
  state: SpareBulletLineMeasurementState;
}) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "measuring") {
    return (
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Measuring
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200"
        title={state.message}
      >
        Check failed
      </span>
    );
  }

  const { measurement } = state;
  const tone = readTailorResumeSpareBulletLineTone(measurement.lineCount);
  const toneClassName =
    tone === "good"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
        : "border-rose-300/30 bg-rose-300/10 text-rose-200";
  const titleParts = [
    `Rendered PDF line count for this selected resume experience.`,
    `Candidate PDF pages: ${measurement.pageCount.toLocaleString()}.`,
  ];

  if (measurement.lastLineFillRatio !== null) {
    titleParts.push(
      `Last line fill: ${Math.round(measurement.lastLineFillRatio * 100)}%.`,
    );
  }

  if (measurement.malformed) {
    titleParts.push("Malformed shape: final line is under 50% filled.");
  }

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClassName}`}
      title={titleParts.join(" ")}
    >
      {formatTailorResumeSpareBulletLineCount(measurement.lineCount)}
    </span>
  );
}

function SpareBulletQuoteField({
  disabled,
  labelClassName,
  onChange,
  placeholder,
  resumeExperienceId,
  textareaClassName,
  value,
}: SpareBulletQuoteFieldProps) {
  const lineMeasurement = useSpareBulletLineMeasurement({
    quote: value,
    resumeExperienceId,
  });

  return (
    <label className={labelClassName}>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span>Resume bullet</span>
        <SpareBulletLineCountBadge state={lineMeasurement} />
      </span>
      <textarea
        className={textareaClassName}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

export function SpareBulletsCard({
  initialSkillData,
  onSkillDataChange,
  onTailorResumeProfileChange,
}: SpareBulletsCardProps) {
  const [skillData, setSkillData] = useState(initialSkillData);
  const [spareBulletEditDraft, setSpareBulletEditDraft] =
    useState<SpareBulletEditDraft | null>(null);
  const [resumeExperienceId, setResumeExperienceId] = useState(
    initialSkillData.resumeExperiences[0]?.id ?? "",
  );
  const [quote, setQuote] = useState("");
  const [replacesQuote, setReplacesQuote] = useState("");
  const [skillNames, setSkillNames] = useState("");
  const [skillsOnlyName, setSkillsOnlyName] = useState("");
  const [spareBulletSearchQuery, setSpareBulletSearchQuery] = useState("");
  const [spareBulletSearchMode, setSpareBulletSearchMode] =
    useState<TailorResumeSpareBulletSearchMode>("both");
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingSkillsOnly, setIsSavingSkillsOnly] = useState(false);

  useEffect(() => {
    setSkillData(initialSkillData);
    setResumeExperienceId((currentValue) =>
      initialSkillData.resumeExperiences.some(
        (experience) => experience.id === currentValue,
      )
        ? currentValue
        : initialSkillData.resumeExperiences[0]?.id ?? "",
    );
    setSpareBulletEditDraft((currentDraft) =>
      currentDraft &&
      initialSkillData.spareBullets.some(
        (spareBullet) => spareBullet.id === currentDraft.id,
      )
        ? currentDraft
        : null,
    );
  }, [initialSkillData]);

  function applySkillData(
    payload: SkillDataResponse,
    options: { preserveEditDraft?: boolean } = {},
  ) {
    if (payload.profile) {
      onTailorResumeProfileChange?.(payload.profile);
    }

    if (payload.skillData) {
      setSkillData(payload.skillData);
      onSkillDataChange?.(payload.skillData);
      if (!options.preserveEditDraft) {
        setSpareBulletEditDraft(null);
      }
    }
  }

  function clearForm() {
    setQuote("");
    setReplacesQuote("");
    setSkillNames("");
  }

  function editSpareBullet(
    spareBullet: TailorResumeStoredSkillData["spareBullets"][number],
  ) {
    setSpareBulletEditDraft({
      id: spareBullet.id,
      quote: spareBullet.quote,
      replacesQuote: spareBullet.replacesQuote ?? "",
      resumeExperienceId: spareBullet.resumeExperienceId,
      skillNames: formatSpareBulletSkills(spareBullet),
    });
  }

  function updateSpareBulletEditDraft(
    patch: Partial<Omit<SpareBulletEditDraft, "id">>,
  ) {
    setSpareBulletEditDraft((currentDraft) =>
      currentDraft ? { ...currentDraft, ...patch } : currentDraft,
    );
  }

  async function saveSpareBullet() {
    setIsSaving(true);

    try {
      const payload = await patchTailorResumeSkillData({
        action: "saveSpareBullet",
        id: null,
        quote,
        replacesQuote: replacesQuote.trim() || null,
        resumeExperienceId,
        skillNames: splitSkillNames(skillNames),
      });

      applySkillData(payload, { preserveEditDraft: true });
      clearForm();
      toast.success("Added spare bullet.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save spare bullet.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSpareBulletEdit() {
    if (!spareBulletEditDraft) {
      return;
    }

    setIsSaving(true);

    try {
      const payload = await patchTailorResumeSkillData({
        action: "saveSpareBullet",
        id: spareBulletEditDraft.id,
        quote: spareBulletEditDraft.quote,
        replacesQuote: spareBulletEditDraft.replacesQuote.trim() || null,
        resumeExperienceId: spareBulletEditDraft.resumeExperienceId,
        skillNames: splitSkillNames(spareBulletEditDraft.skillNames),
      });

      setSpareBulletEditDraft(null);
      applySkillData(payload);
      toast.success("Updated spare bullet.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save spare bullet.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSpareBullet(spareBulletId: string) {
    setIsSaving(true);

    try {
      const payload = await patchTailorResumeSkillData({
        action: "deleteSpareBullet",
        id: spareBulletId,
      });

      applySkillData(payload);
      if (spareBulletEditDraft?.id === spareBulletId) {
        setSpareBulletEditDraft(null);
      }
      toast.success("Deleted spare bullet.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete spare bullet.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSkillsOnlySupport() {
    if (!skillsOnlyName.trim()) {
      return;
    }

    setIsSavingSkillsOnly(true);

    try {
      const payload = await patchTailorResumeSkillData({
        action: "saveSkill",
        listInSkillsOnly: true,
        name: skillsOnlyName.trim(),
      });

      applySkillData(payload, { preserveEditDraft: true });
      setSkillsOnlyName("");
      toast.success("Saved skills-only support.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save skills-only support.",
      );
    } finally {
      setIsSavingSkillsOnly(false);
    }
  }

  async function deleteSkillsOnlySupport(skillId: string) {
    setIsSavingSkillsOnly(true);

    try {
      const payload = await patchTailorResumeSkillData({
        action: "deleteSkill",
        id: skillId,
      });

      applySkillData(payload, { preserveEditDraft: true });
      toast.success("Removed skills-only support.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to remove skills-only support.",
      );
    } finally {
      setIsSavingSkillsOnly(false);
    }
  }

  const canSaveSpareBullet =
    quote.trim().length > 0 &&
    resumeExperienceId.trim().length > 0 &&
    splitSkillNames(skillNames).length > 0;
  const canSaveSpareBulletEdit =
    spareBulletEditDraft !== null &&
    spareBulletEditDraft.quote.trim().length > 0 &&
    spareBulletEditDraft.resumeExperienceId.trim().length > 0 &&
    splitSkillNames(spareBulletEditDraft.skillNames).length > 0;
  const listInSkillsOnlySkills = skillData.skills.filter(
    (skill) => skill.listInSkillsOnly,
  );
  const canSaveSkillsOnlySupport = skillsOnlyName.trim().length > 0;
  const visibleSpareBullets = useMemo(
    () =>
      filterTailorResumeSpareBulletsForSearch({
        mode: spareBulletSearchMode,
        query: spareBulletSearchQuery,
        spareBullets: skillData.spareBullets,
      }),
    [skillData.spareBullets, spareBulletSearchMode, spareBulletSearchQuery],
  );
  const isSpareBulletSearchActive = spareBulletSearchQuery.trim().length > 0;

  return (
    <section className="glass-panel soft-ring rounded-[1.5rem] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Skills-Section Support
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
              Spare bullets
            </h2>
            <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {skillData.spareBullets.length.toLocaleString()} saved
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Skills-section keywords that are not already in the resume can be
            supported by a new or replacement bullet tied to a resume
            experience.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-[1rem] border border-white/10 bg-white/[0.025] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-200">
              Skills-only keywords
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Exact tools or technologies that can be listed in Skills without
              adding an experience bullet.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-400">
            {listInSkillsOnlySkills.length.toLocaleString()} saved
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="min-h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-zinc-950/75 px-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
            disabled={isSavingSkillsOnly}
            onChange={(event) => setSkillsOnlyName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveSkillsOnlySupport();
              }
            }}
            placeholder="Keyword to list only in Skills"
            value={skillsOnlyName}
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:border-emerald-300/35 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSavingSkillsOnly || !canSaveSkillsOnlySupport}
            onClick={() => void saveSkillsOnlySupport()}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            {isSavingSkillsOnly ? "Saving..." : "Add keyword"}
          </button>
        </div>

        {listInSkillsOnlySkills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {listInSkillsOnlySkills.map((skill) => (
              <span
                className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-zinc-300"
                key={skill.id}
              >
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {skill.name}
                </span>
                <button
                  aria-label={`Remove ${skill.name}`}
                  className="-mr-1 ml-1.5 inline-flex size-5 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingSkillsOnly}
                  onClick={() => void deleteSkillsOnlySupport(skill.id)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="rounded-[0.9rem] border border-dashed border-white/10 px-3 py-3 text-sm text-zinc-500">
            No skills-only keywords yet.
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="grid gap-1.5 text-sm text-zinc-300">
            Resume experience
            <select
              className="min-h-11 w-full min-w-0 rounded-[0.9rem] border border-white/10 bg-zinc-950/75 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-300/45"
              disabled={isSaving || skillData.resumeExperiences.length === 0}
              onChange={(event) => setResumeExperienceId(event.target.value)}
              value={resumeExperienceId}
            >
              {skillData.resumeExperiences.length === 0 ? (
                <option value="">No parsed experiences</option>
              ) : null}
              {skillData.resumeExperiences.map((experience) => (
                <option key={experience.id} value={experience.id}>
                  {experience.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm text-zinc-300">
            Skills-section keywords
            <input
              className="min-h-11 w-full min-w-0 rounded-[0.9rem] border border-white/10 bg-zinc-950/75 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
              disabled={isSaving}
              onChange={(event) => setSkillNames(event.target.value)}
              placeholder="Comma-separated keywords"
              value={skillNames}
            />
          </label>
        </div>

        <SpareBulletQuoteField
          disabled={isSaving}
          labelClassName="grid gap-1.5 text-sm text-zinc-300"
          onChange={setQuote}
          placeholder="Built ..."
          resumeExperienceId={resumeExperienceId}
          textareaClassName="min-h-24 w-full min-w-0 rounded-[0.9rem] border border-white/10 bg-zinc-950/75 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
          value={quote}
        />

        <label className="grid gap-1.5 text-sm text-zinc-300">
          Replaces quote
          <textarea
            className="min-h-20 w-full min-w-0 rounded-[0.9rem] border border-white/10 bg-zinc-950/75 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
            disabled={isSaving}
            onChange={(event) => setReplacesQuote(event.target.value)}
              placeholder="Original bullet to replace"
            value={replacesQuote}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:border-emerald-300/35 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSaving || !canSaveSpareBullet}
            onClick={() => void saveSpareBullet()}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            {isSaving ? "Saving..." : "Add bullet"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {skillData.spareBullets.length > 0 ? (
          <div className="grid gap-2 rounded-[1rem] border border-white/10 bg-white/[0.025] p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="relative min-w-0">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
              />
              <span className="sr-only">Search resume bullets</span>
              <input
                className="min-h-10 w-full min-w-0 rounded-full border border-white/10 bg-zinc-950/75 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/45"
                onChange={(event) =>
                  setSpareBulletSearchQuery(event.target.value)
                }
                placeholder="Search skills or bullet text"
                type="search"
                value={spareBulletSearchQuery}
              />
            </label>
            <div
              aria-label="Resume bullet search mode"
              className="inline-flex rounded-full border border-white/10 bg-black/20 p-1"
            >
              {tailorResumeSpareBulletSearchModes.map((mode) => (
                <button
                  aria-pressed={spareBulletSearchMode === mode.value}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    spareBulletSearchMode === mode.value
                      ? "bg-emerald-300 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                  key={mode.value}
                  onClick={() => setSpareBulletSearchMode(mode.value)}
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {isSpareBulletSearchActive ? (
              <p className="text-xs text-zinc-500 sm:col-span-2">
                {visibleSpareBullets.length.toLocaleString()} of{" "}
                {skillData.spareBullets.length.toLocaleString()} resume bullets
              </p>
            ) : null}
          </div>
        ) : null}

        {skillData.spareBullets.length > 0 ? (
          visibleSpareBullets.length > 0 ? (
            visibleSpareBullets.map((spareBullet) => {
              const experience = skillData.resumeExperiences.find(
                (candidate) => candidate.id === spareBullet.resumeExperienceId,
              );
              const editDraft =
                spareBulletEditDraft?.id === spareBullet.id
                  ? spareBulletEditDraft
                  : null;

              return (
                <div
                  className="grid gap-3 border-t border-white/8 py-3 first:border-t-0 first:pt-0"
                  key={spareBullet.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {editDraft ? (
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <label className="grid gap-1 text-xs text-zinc-400">
                            Skills-section keywords
                            <input
                              className="min-h-9 w-full min-w-0 rounded-[0.8rem] border border-white/10 bg-zinc-950/75 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-300/45"
                              disabled={isSaving}
                              onChange={(event) =>
                                updateSpareBulletEditDraft({
                                  skillNames: event.target.value,
                                })
                              }
                              value={editDraft.skillNames}
                            />
                          </label>
                          <label className="grid gap-1 text-xs text-zinc-400">
                            Resume experience
                            <select
                              className="min-h-9 w-full min-w-0 rounded-[0.8rem] border border-white/10 bg-zinc-950/75 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-300/45"
                              disabled={
                                isSaving ||
                                skillData.resumeExperiences.length === 0
                              }
                              onChange={(event) =>
                                updateSpareBulletEditDraft({
                                  resumeExperienceId: event.target.value,
                                })
                              }
                              value={editDraft.resumeExperienceId}
                            >
                              {skillData.resumeExperiences.map(
                                (resumeExperience) => (
                                  <option
                                    key={resumeExperience.id}
                                    value={resumeExperience.id}
                                  >
                                    {resumeExperience.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {spareBullet.skills.map((skill) => (
                              <span
                                className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300"
                                key={skill.id}
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">
                            {experience?.label ?? spareBullet.resumeExperienceId}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        aria-label={
                          editDraft ? "Save resume bullet" : "Edit resume bullet"
                        }
                        className={`inline-flex size-8 items-center justify-center rounded-full transition ${
                          editDraft
                            ? "text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200"
                            : "text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
                        }`}
                        disabled={
                          isSaving || (Boolean(editDraft) && !canSaveSpareBulletEdit)
                        }
                        onClick={() =>
                          editDraft
                            ? void saveSpareBulletEdit()
                            : editSpareBullet(spareBullet)
                        }
                        type="button"
                      >
                        {editDraft ? (
                          <Check aria-hidden="true" className="size-4" />
                        ) : (
                          <Pencil aria-hidden="true" className="size-4" />
                        )}
                      </button>
                      <button
                        aria-label="Delete spare bullet"
                        className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-rose-400/10 hover:text-rose-200"
                        disabled={isSaving}
                        onClick={() => void deleteSpareBullet(spareBullet.id)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  </div>
                  {editDraft ? (
                    <div className="grid gap-2">
                      <SpareBulletQuoteField
                        disabled={isSaving}
                        labelClassName="grid gap-1 text-xs text-zinc-400"
                        onChange={(value) =>
                          updateSpareBulletEditDraft({
                            quote: value,
                          })
                        }
                        resumeExperienceId={editDraft.resumeExperienceId}
                        textareaClassName="min-h-20 w-full min-w-0 rounded-[0.8rem] border border-white/10 bg-zinc-950/75 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition focus:border-emerald-300/45"
                        value={editDraft.quote}
                      />
                      <label className="grid gap-1 text-xs text-zinc-400">
                        Replaces quote
                        <textarea
                          className="min-h-16 w-full min-w-0 rounded-[0.8rem] border border-white/10 bg-zinc-950/75 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition focus:border-emerald-300/45"
                          disabled={isSaving}
                          onChange={(event) =>
                            updateSpareBulletEditDraft({
                              replacesQuote: event.target.value,
                            })
                          }
                          placeholder="Original bullet to replace"
                          value={editDraft.replacesQuote}
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm leading-6 text-zinc-200">
                        {spareBullet.quote}
                      </p>
                      {spareBullet.replacesQuote ? (
                        <details className="border-l border-white/10 pl-3">
                          <summary className="cursor-pointer list-none text-[10px] font-bold uppercase leading-4 tracking-[0.14em] text-zinc-500 marker:hidden">
                            Replaces quote
                          </summary>
                          <blockquote className="mt-1 text-sm leading-6 text-zinc-200">
                          {spareBullet.replacesQuote}
                          </blockquote>
                        </details>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })
          ) : (
            <p className="rounded-[0.9rem] border border-dashed border-white/10 px-3 py-3 text-sm text-zinc-500">
              No resume bullets match that search.
            </p>
          )
        ) : (
          <p className="rounded-[0.9rem] border border-dashed border-white/10 px-3 py-3 text-sm text-zinc-500">
            No spare bullets yet.
          </p>
        )}
      </div>

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
