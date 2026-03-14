"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import JobScreenshotDropzone from "@/components/job-screenshot-dropzone";
import type {
  JobApplicationDraft,
  JobApplicationExtraction,
} from "@/lib/job-application-types";

type JobApplicationIntakeProps = {
  disabled?: boolean;
  disabledMessage?: string;
  extractionModel: string;
};

type DraftUpload = {
  error: string | null;
  extraction: JobApplicationExtraction | null;
  file: File;
  id: string;
  model: string | null;
  source: "Dropped" | "Pasted" | "Selected";
  status: "extracting" | "failed" | "ready";
};

type BannerState = {
  text: string;
  tone: "error" | "info" | "success";
};

const emptyDraft: JobApplicationDraft = {
  appliedAt: "",
  companyName: "",
  hasReferral: false,
  jobDescription: "",
  jobTitle: "",
};

function mergeTextField(currentValue: string, nextValue: string | null) {
  return nextValue?.trim() ? nextValue.trim() : currentValue;
}

function mergeJobDescription(currentValue: string, nextValue: string | null) {
  const normalizedCurrent = currentValue.trim();
  const normalizedNext = nextValue?.trim() ?? "";

  if (!normalizedNext) {
    return currentValue;
  }

  if (!normalizedCurrent) {
    return normalizedNext;
  }

  if (normalizedCurrent.includes(normalizedNext)) {
    return normalizedCurrent;
  }

  if (normalizedNext.includes(normalizedCurrent)) {
    return normalizedNext;
  }

  return `${normalizedCurrent}\n\n${normalizedNext}`;
}

function mergeDraftWithExtraction(
  currentDraft: JobApplicationDraft,
  extraction: JobApplicationExtraction,
) {
  return {
    jobTitle: mergeTextField(currentDraft.jobTitle, extraction.jobTitle),
    companyName: mergeTextField(currentDraft.companyName, extraction.companyName),
    hasReferral: currentDraft.hasReferral || extraction.hasReferral,
    appliedAt: extraction.appliedAt ?? currentDraft.appliedAt,
    jobDescription: mergeJobDescription(
      currentDraft.jobDescription,
      extraction.jobDescription,
    ),
  } satisfies JobApplicationDraft;
}

function fieldClassName() {
  return "mt-3 w-full rounded-[1.25rem] border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45";
}

export default function JobApplicationIntake({
  disabled = false,
  disabledMessage,
  extractionModel,
}: JobApplicationIntakeProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [draft, setDraft] = useState<JobApplicationDraft>(emptyDraft);
  const [draftUploads, setDraftUploads] = useState<DraftUpload[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [latestModel, setLatestModel] = useState(extractionModel);
  const draftFieldsRef = useRef<HTMLDivElement>(null);

  const extractingCount = draftUploads.filter(
    (upload) => upload.status === "extracting",
  ).length;
  const saveDisabled =
    disabled ||
    isSaving ||
    draftUploads.length === 0 ||
    extractingCount > 0 ||
    draft.jobTitle.trim().length === 0 ||
    draft.companyName.trim().length === 0;
  const newestUpload = draftUploads[draftUploads.length - 1] ?? null;
  const processingLabel = newestUpload
    ? `Working on ${newestUpload.file.name}. The draft fields below will update automatically.`
    : "The draft fields will populate automatically when extraction finishes.";

  useEffect(() => {
    if (draftUploads.length === 0) {
      return;
    }

    draftFieldsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [draftUploads.length]);

  async function handleFileSelected(
    file: File,
    source: DraftUpload["source"],
  ) {
    const uploadId = crypto.randomUUID();

    setBanner({
      text: `Extracting fields from ${file.name}...`,
      tone: "info",
    });
    setDraftUploads((currentUploads) => [
      ...currentUploads,
      {
        error: null,
        extraction: null,
        file,
        id: uploadId,
        model: null,
        source,
        status: "extracting",
      },
    ]);

    const formData = new FormData();
    formData.append("jobScreenshot", file);

    try {
      const response = await fetch("/api/job-applications/extract", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        error?: string;
        extraction?: JobApplicationExtraction;
        model?: string;
      };

      if (!response.ok || !payload.extraction) {
        throw new Error(payload.error ?? "Failed to extract the screenshot.");
      }

      const extraction = payload.extraction;

      setDraft((currentDraft) =>
        mergeDraftWithExtraction(currentDraft, extraction),
      );
      setDraftUploads((currentUploads) =>
        currentUploads.map((upload) =>
          upload.id === uploadId
            ? {
                ...upload,
                extraction,
                model: payload.model ?? extractionModel,
                status: "ready",
              }
            : upload,
        ),
      );
      setLatestModel(payload.model ?? extractionModel);
      setBanner({
        text: `Updated the draft from ${file.name}. Review the fields, then save when ready.`,
        tone: "success",
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to extract the screenshot.";

      setDraftUploads((currentUploads) =>
        currentUploads.map((upload) =>
          upload.id === uploadId
            ? {
                ...upload,
                error: detail,
                status: "failed",
              }
            : upload,
        ),
      );
      setBanner({
        text: `${detail} You can upload another screenshot or fill the fields manually.`,
        tone: "error",
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saveDisabled) {
      return;
    }

    setIsSaving(true);
    setBanner({
      text: "Saving the draft to Postgres...",
      tone: "info",
    });

    const formData = new FormData();

    for (const upload of draftUploads) {
      formData.append("jobScreenshots", upload.file);
    }

    formData.append("jobTitle", draft.jobTitle);
    formData.append("companyName", draft.companyName);
    formData.append("appliedAt", draft.appliedAt);
    formData.append("jobDescription", draft.jobDescription);
    formData.append("hasReferral", String(draft.hasReferral));
    formData.append(
      "draftUploadSnapshots",
      JSON.stringify(
        draftUploads.map((upload) => ({
          error: upload.error,
          extraction: upload.extraction,
          model: upload.model,
          status: upload.status,
        })),
      ),
    );

    try {
      const response = await fetch("/api/job-applications", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save the application.");
      }

      setDraft(emptyDraft);
      setDraftUploads([]);
      setLatestModel(extractionModel);
      setBanner({
        text: "Saved the application. You can start a new draft immediately.",
        tone: "success",
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to save the application.";

      setBanner({
        text: detail,
        tone: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function resetDraft() {
    setDraft(emptyDraft);
    setDraftUploads([]);
    setLatestModel(extractionModel);
    setBanner(null);
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <JobScreenshotDropzone
        disabled={disabled}
        disabledMessage={disabled ? disabledMessage : undefined}
        isProcessing={extractingCount > 0}
        processingLabel={processingLabel}
        onFileSelected={handleFileSelected}
      />

      <div className="grid gap-3 rounded-[1.5rem] border border-white/8 bg-black/20 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              Draft uploads
            </p>
            <p className="mt-2 text-sm leading-7 text-zinc-400">
              Every screenshot starts extraction automatically. Later uploads can keep
              filling in missing fields before you save.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-300">
            {draftUploads.length} loaded
          </span>
        </div>

        {draftUploads.length === 0 ? (
          <div className="rounded-[1.25rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-zinc-500">
            No draft screenshots yet. Drop one into the box above to begin.
          </div>
        ) : (
          <div className="grid gap-3">
            {draftUploads.map((upload) => (
              <div
                key={upload.id}
                className="rounded-[1.25rem] border border-white/8 bg-white/5 px-4 py-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {upload.file.name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {upload.source} • {(upload.file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                      upload.status === "ready"
                        ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : upload.status === "failed"
                          ? "border border-amber-400/25 bg-amber-400/10 text-amber-200"
                          : "border border-white/10 bg-white/5 text-zinc-400"
                    }`}
                  >
                    {upload.status === "ready"
                      ? "Extracted"
                      : upload.status === "failed"
                        ? "Needs review"
                        : "Extracting"}
                  </span>
                </div>

                {upload.error ? (
                  <p className="mt-3 text-sm leading-6 text-amber-100">
                    {upload.error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {banner ? (
        <div
          className={`rounded-[1.5rem] px-5 py-4 text-sm ${
            banner.tone === "success"
              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
              : banner.tone === "error"
                ? "border border-amber-400/25 bg-amber-400/10 text-amber-100"
                : "border border-white/10 bg-white/5 text-zinc-200"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <div
        ref={draftFieldsRef}
        className="grid gap-4 rounded-[1.5rem] border border-white/8 bg-black/20 p-5 sm:grid-cols-2"
      >
        <div className="rounded-[1.25rem] border border-emerald-400/15 bg-emerald-400/6 p-4 sm:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-emerald-300">
                Editable draft
              </p>
              <p className="mt-2 text-sm leading-7 text-zinc-300">
                These fields auto-fill from screenshots and stay editable until you
                save.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-300">
              {extractingCount > 0 ? "Updating now" : "Ready to review"}
            </span>
          </div>
        </div>

        <label className="rounded-[1.25rem] border border-white/8 bg-white/5 p-4">
          <span className="text-sm font-medium text-zinc-100">Job title</span>
          <input
            className={fieldClassName()}
            disabled={disabled || isSaving}
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

        <label className="rounded-[1.25rem] border border-white/8 bg-white/5 p-4">
          <span className="text-sm font-medium text-zinc-100">Company name</span>
          <input
            className={fieldClassName()}
            disabled={disabled || isSaving}
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

        <label className="rounded-[1.25rem] border border-white/8 bg-white/5 p-4">
          <span className="text-sm font-medium text-zinc-100">Applied date</span>
          <input
            className={fieldClassName()}
            disabled={disabled || isSaving}
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

        <div className="rounded-[1.25rem] border border-white/8 bg-white/5 p-4">
          <span className="text-sm font-medium text-zinc-100">Referral status</span>
          <div className="mt-3 flex h-[52px] items-center rounded-[1.25rem] border border-white/10 bg-zinc-950/70 px-4">
            <input
              checked={draft.hasReferral}
              className="h-4 w-4 accent-emerald-300"
              disabled={disabled || isSaving}
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
              Mark this application as referral-backed
            </label>
          </div>
        </div>

        <label className="rounded-[1.25rem] border border-white/8 bg-white/5 p-4 sm:col-span-2">
          <span className="text-sm font-medium text-zinc-100">
            Job description
          </span>
          <textarea
            className={`${fieldClassName()} min-h-40 resize-y`}
            disabled={disabled || isSaving}
            onChange={(event) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                jobDescription: event.target.value,
              }))
            }
            placeholder="Longer job description text will accumulate here when later screenshots reveal more detail."
            value={draft.jobDescription}
          />
        </label>
      </div>

      {disabled ? (
        <div className="rounded-[1.5rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-7 text-amber-100">
          {disabledMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-white/8 bg-black/20 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm leading-7 text-zinc-300">
            Extraction runs immediately after each upload. The draft does not hit the
            database until you save it.
          </p>
          <p className="text-sm leading-7 text-zinc-500">
            Latest extraction model: {latestModel}. The newest screenshot becomes the
            application thumbnail after save.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            className="rounded-full border border-white/10 bg-transparent px-5 py-3 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving || draftUploads.length === 0}
            onClick={resetDraft}
            type="button"
          >
            Reset draft
          </button>
          <button
            className="inline-flex items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-5 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saveDisabled}
            type="submit"
          >
            {isSaving
              ? "Saving..."
              : extractingCount > 0
                ? `Extracting ${extractingCount} screenshot${extractingCount === 1 ? "" : "s"}...`
                : "Save application"}
          </button>
        </div>
      </div>
    </form>
  );
}
