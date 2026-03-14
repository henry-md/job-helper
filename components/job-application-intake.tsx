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
import ApplicationWindow from "@/components/application-window";
import type {
  CompanyOption,
  JobApplicationDraft,
  JobApplicationExtraction,
  ReferrerOption,
} from "@/lib/job-application-types";

type JobApplicationIntakeProps = {
  companyOptions: CompanyOption[];
  disabled?: boolean;
  extractionModel: string;
  referrerOptions: ReferrerOption[];
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
  jobDescription: "",
  jobTitle: "",
  jobUrl: "",
  location: "",
  notes: "",
  onsiteDaysPerWeek: "",
  referrerId: "",
  referrerName: "",
  recruiterContact: "",
  salaryRange: "",
  status: "APPLIED",
  teamOrDepartment: "",
  employmentType: "",
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

function mergeSelectionField<T extends string>(
  currentValue: T | "",
  nextValue: T | null,
) {
  return nextValue ?? currentValue;
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
  matchingReferrer: ReferrerOption | null,
) {
  const extractedAppliedAt = extraction.appliedAt?.trim();

  return {
    jobTitle: mergeTextField(currentDraft.jobTitle, extraction.jobTitle),
    companyName: mergeTextField(currentDraft.companyName, extraction.companyName),
    appliedAt:
      extractedAppliedAt ||
      currentDraft.appliedAt ||
      fallbackAppliedAt,
    jobUrl: mergeTextField(currentDraft.jobUrl, extraction.jobUrl),
    location: extraction.location ?? currentDraft.location,
    notes: mergeTextField(currentDraft.notes, extraction.notes),
    onsiteDaysPerWeek:
      extraction.onsiteDaysPerWeek !== null
        ? String(extraction.onsiteDaysPerWeek)
        : currentDraft.onsiteDaysPerWeek,
    referrerId: matchingReferrer?.id ?? currentDraft.referrerId,
    referrerName: mergeTextField(
      matchingReferrer?.name ?? currentDraft.referrerName,
      extraction.referrerName,
    ),
    recruiterContact: mergeTextField(
      matchingReferrer?.recruiterContact ?? currentDraft.recruiterContact,
      extraction.recruiterContact,
    ),
    salaryRange: mergeTextField(currentDraft.salaryRange, extraction.salaryRange),
    status: mergeSelectionField(currentDraft.status, extraction.status),
    teamOrDepartment: mergeTextField(
      currentDraft.teamOrDepartment,
      extraction.teamOrDepartment,
    ),
    employmentType: mergeSelectionField(
      currentDraft.employmentType,
      extraction.employmentType,
    ),
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

export default function JobApplicationIntake({
  companyOptions,
  disabled = false,
  extractionModel,
  referrerOptions: initialReferrerOptions,
  statusMessage,
}: JobApplicationIntakeProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [draft, setDraft] = useState<JobApplicationDraft>(emptyDraft);
  const [draftUploads, setDraftUploads] = useState<DraftUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [latestModel, setLatestModel] = useState(extractionModel);
  const [referrerOptions, setReferrerOptions] = useState(initialReferrerOptions);
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
  const hasUploadedScreenshot = draftUploads.length > 0;
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

    setBanner(null);
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
      const matchingReferrer = extraction.referrerName
        ? referrerOptions.find(
            (option) =>
              option.name.trim().toLowerCase() ===
              extraction.referrerName?.trim().toLowerCase(),
          ) ?? null
        : null;

      setDraft((currentDraft) =>
        mergeDraftWithExtraction(
          currentDraft,
          extraction,
          fallbackAppliedAt,
          matchingReferrer,
        ),
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
      text: "Saving your application...",
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
    formData.append("jobUrl", draft.jobUrl);
    formData.append("location", draft.location);
    formData.append("notes", draft.notes);
    formData.append("onsiteDaysPerWeek", draft.onsiteDaysPerWeek);
    formData.append("referrerId", draft.referrerId);
    formData.append("recruiterContact", draft.recruiterContact);
    formData.append("salaryRange", draft.salaryRange);
    formData.append("status", draft.status);
    formData.append("teamOrDepartment", draft.teamOrDepartment);
    formData.append("employmentType", draft.employmentType);
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
      setIsMoreOpen(false);
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
    setIsMoreOpen(false);
    setLatestModel(extractionModel);
    setBanner(null);
  }

  if (!hasUploadedScreenshot) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              New application
            </p>
            <h2 className="mt-1 text-[clamp(1.125rem,1.8vw,1.35rem)] font-semibold text-zinc-50">
              Upload and save
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Screenshot in, key fields out.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-300">
            {extractionModel}
          </span>
        </div>

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
            "relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-[1.5rem] border-2 border-dashed p-5 transition",
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

          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Screenshot intake
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-zinc-50">
              Upload a screenshot to start
            </h3>
            <p className="mt-3 max-w-xl text-sm text-zinc-300">
              Drag a screenshot anywhere into this area, paste it, or{" "}
              <label
                className={`cursor-pointer text-emerald-300 underline-offset-4 hover:underline ${
                  isFormLocked ? "pointer-events-none opacity-60" : ""
                }`}
                htmlFor={inputId}
              >
                choose a file
              </label>
              . The editor appears after extraction finishes.
            </p>
            <p className="mt-4 text-sm text-zinc-400">PNG, JPG, WebP up to 8 MB</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ApplicationWindow
      companyOptions={companyOptions}
      draft={draft}
      extractingCount={extractingCount}
      isFormLocked={isFormLocked}
      isExtracting={isExtracting}
      isMoreOpen={isMoreOpen}
      isSaving={isSaving}
      referrerOptions={referrerOptions}
      latestModel={latestModel}
      onReset={resetDraft}
      onSubmit={handleSubmit}
      panelClassName="flex h-full min-h-0 flex-col gap-3 overflow-auto rounded-[1.5rem] border-2 border-dashed border-emerald-300/45 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.12),rgba(9,9,11,0.92)_40%,rgba(5,5,7,0.98)_100%)] p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.14)] sm:p-4"
      processingLabel={processingLabel}
      saveDisabled={saveDisabled}
      setDraft={setDraft}
      setIsMoreOpen={setIsMoreOpen}
      setReferrerOptions={setReferrerOptions}
    >
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
          "relative flex min-h-0 flex-col gap-3 overflow-hidden rounded-[1.25rem] border border-emerald-300/30 bg-black/20 p-4 transition",
          disabled
            ? "border-white/10 bg-black/15 opacity-70"
            : isDragging
              ? "border-emerald-300 bg-emerald-300/10 shadow-[0_0_0_1px_rgba(110,231,183,0.3),0_28px_80px_rgba(16,185,129,0.18)]"
              : "shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
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

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Screenshot intake
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              Review the extracted draft, make corrections, and save.
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
      </div>
    </ApplicationWindow>
  );
}
