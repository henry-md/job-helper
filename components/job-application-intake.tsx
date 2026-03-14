"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  JobApplicationDraft,
  JobApplicationExtraction,
} from "@/lib/job-application-types";

type JobApplicationIntakeProps = {
  disabled?: boolean;
  disabledMessage?: string;
  extractionModel: string;
  statusMessage?: {
    text: string;
    tone: "error" | "success";
  } | null;
};

type UploadSource = "Dropped" | "Pasted" | "Selected";

type DraftUpload = {
  error: string | null;
  extraction: JobApplicationExtraction | null;
  file: File;
  id: string;
  model: string | null;
  source: UploadSource;
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

const acceptedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const maxScreenshotBytes = 8 * 1024 * 1024;

function formatBytes(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
  }).format(value / (value >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function describeFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${formatBytes(value)} MB`;
  }

  return `${formatBytes(value)} KB`;
}

function pickImageFile(items?: DataTransferItemList | null) {
  if (!items) {
    return null;
  }

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();

    if (file && acceptedMimeTypes.has(file.type)) {
      return file;
    }
  }

  return null;
}

function validateImageFile(file: File) {
  if (!acceptedMimeTypes.has(file.type)) {
    return "Use a PNG, JPG, or WebP screenshot.";
  }

  if (file.size === 0) {
    return "The screenshot is empty.";
  }

  if (file.size > maxScreenshotBytes) {
    return "Keep the screenshot under 8 MB.";
  }

  return null;
}

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
  fallbackAppliedAt: string,
) {
  const extractedAppliedAt = extraction.appliedAt?.trim();

  return {
    jobTitle: mergeTextField(currentDraft.jobTitle, extraction.jobTitle),
    companyName: mergeTextField(currentDraft.companyName, extraction.companyName),
    hasReferral: currentDraft.hasReferral || extraction.hasReferral,
    appliedAt:
      extractedAppliedAt ||
      currentDraft.appliedAt ||
      fallbackAppliedAt,
    jobDescription: mergeJobDescription(
      currentDraft.jobDescription,
      extraction.jobDescription,
    ),
  } satisfies JobApplicationDraft;
}

function getLocalDateInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function fieldClassName() {
  return "mt-2 w-full rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45";
}

export default function JobApplicationIntake({
  disabled = false,
  disabledMessage,
  extractionModel,
  statusMessage,
}: JobApplicationIntakeProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [draft, setDraft] = useState<JobApplicationDraft>(emptyDraft);
  const [draftUploads, setDraftUploads] = useState<DraftUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [latestModel, setLatestModel] = useState(extractionModel);
  const inputId = useId();

  const extractingCount = draftUploads.filter(
    (upload) => upload.status === "extracting",
  ).length;
  const isExtracting = extractingCount > 0;
  const isFormLocked = disabled || isSaving || isExtracting;
  const saveDisabled =
    disabled ||
    isSaving ||
    draftUploads.length === 0 ||
    isExtracting ||
    draft.jobTitle.trim().length === 0 ||
    draft.companyName.trim().length === 0;
  const newestUpload = draftUploads[draftUploads.length - 1] ?? null;
  const processingLabel = newestUpload
    ? `Working on ${newestUpload.file.name}. The draft fields below will update automatically.`
    : "The draft fields will populate automatically when extraction finishes.";

  function queueSelectedFile(file: File, source: UploadSource) {
    const validationError = validateImageFile(file);

    if (validationError) {
      setBanner({
        text: validationError,
        tone: "error",
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    void handleFileSelected(file, source);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || isFormLocked) {
      return;
    }

    queueSelectedFile(file, "Selected");
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (isFormLocked) {
      return;
    }

    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    if (isFormLocked) {
      return;
    }

    const file =
      pickImageFile(event.dataTransfer.items) ??
      Array.from(event.dataTransfer.files).find((candidate) =>
        acceptedMimeTypes.has(candidate.type),
      );

    if (!file) {
      setBanner({
        text: "Drop a PNG, JPG, or WebP screenshot onto the form.",
        tone: "error",
      });
      return;
    }

    queueSelectedFile(file, "Dropped");
  }

  const syncPastedFile = useEffectEvent((file: File) => {
    queueSelectedFile(file, "Pasted");
  });

  useEffect(() => {
    if (isFormLocked) {
      return;
    }

    function handlePaste(event: ClipboardEvent) {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      const file = pickImageFile(event.clipboardData?.items);

      if (!file) {
        return;
      }

      event.preventDefault();
      syncPastedFile(file);
    }

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [isFormLocked]);

  async function handleFileSelected(
    file: File,
    source: UploadSource,
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
      const fallbackAppliedAt = getLocalDateInputValue();

      setDraft((currentDraft) =>
        mergeDraftWithExtraction(currentDraft, extraction, fallbackAppliedAt),
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
    <form className="flex h-full min-h-0 flex-col gap-3" onSubmit={handleSubmit}>
      {statusMessage ? (
        <div
          className={`shrink-0 rounded-[1rem] px-4 py-2.5 text-sm ${
            statusMessage.tone === "success"
              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
              : "border border-amber-400/25 bg-amber-400/10 text-amber-100"
          }`}
        >
          {statusMessage.text}
        </div>
      ) : null}

      {banner ? (
        <div
          className={`shrink-0 rounded-[1rem] px-4 py-2.5 text-sm ${
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
        className={[
          "relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[1.5rem] border-2 border-dashed p-4 transition sm:p-4",
          disabled
            ? "border-white/10 bg-black/15 opacity-70"
            : isDragging
              ? "border-emerald-300 bg-emerald-300/10 shadow-[0_0_0_1px_rgba(110,231,183,0.3),0_28px_80px_rgba(16,185,129,0.18)]"
              : "border-emerald-300/45 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.12),rgba(9,9,11,0.92)_40%,rgba(5,5,7,0.98)_100%)] shadow-[0_0_0_1px_rgba(16,185,129,0.14)]",
        ].join(" ")}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={isFormLocked}
          id={inputId}
          onChange={handleFileInputChange}
          type="file"
        />

        {isExtracting ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[1.5rem] bg-black/72 backdrop-blur-[2px]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200/20 border-t-emerald-200" />
            <p className="text-sm font-medium text-zinc-100">Extracting screenshot</p>
            <p className="max-w-sm text-center text-sm text-zinc-400">
              {processingLabel}
            </p>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Screenshot intake
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              Drag a screenshot anywhere into this section, paste it, or{" "}
              <label
                className={`cursor-pointer text-emerald-300 underline-offset-4 hover:underline ${
                  isFormLocked ? "pointer-events-none opacity-60" : ""
                }`}
                htmlFor={inputId}
              >
                choose a file
              </label>
              .
            </p>
          </div>
          <div className="text-right text-sm text-zinc-400">
            <p className="truncate font-medium text-zinc-100">
              {newestUpload ? newestUpload.file.name : "No screenshot loaded"}
            </p>
            <p className="mt-1">
              {newestUpload
                ? `${newestUpload.source} • ${describeFileSize(newestUpload.file.size)}`
                : "PNG, JPG, WebP up to 8 MB"}
            </p>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[repeat(4,minmax(0,1fr))] gap-3 rounded-[1.25rem] border border-white/8 bg-black/20 p-3 sm:grid-cols-2 sm:grid-rows-[repeat(3,minmax(0,1fr))]">
          <label className="flex min-h-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
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

          <label className="flex min-h-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
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

          <label className="flex min-h-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
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

          <label className="flex min-h-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3">
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

          <div className="flex min-h-0 flex-col rounded-[1rem] border border-white/8 bg-white/5 p-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-100">Description</span>
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                {latestModel}
              </span>
            </div>
            <textarea
              className={`${fieldClassName()} min-h-0 flex-1 resize-none`}
              disabled={isFormLocked}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  jobDescription: event.target.value,
                }))
              }
              placeholder="Optional notes from the screenshot."
              value={draft.jobDescription}
            />
          </div>

          <div className="flex min-h-0 flex-col justify-center gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-400">
              Save when title and company look correct.
            </p>
            <div className="flex gap-3">
              <button
                className="rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isFormLocked || draftUploads.length === 0}
                onClick={resetDraft}
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

      {disabled ? (
        <div className="rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
          {disabledMessage}
        </div>
      ) : null}
    </form>
  );
}
