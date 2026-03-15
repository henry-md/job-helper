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
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
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
  previewUrl: string;
  source: UploadSource;
  status: "extracting" | "failed" | "queued" | "ready";
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

function pickImageFilesFromItems(items?: DataTransferItemList | null) {
  if (!items) {
    return [] as File[];
  }

  const files: File[] = [];

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();

    if (file && acceptedMimeTypes.has(file.type)) {
      files.push(file);
    }
  }

  return files;
}

function pickImageFiles(
  items?: DataTransferItemList | null,
  files?: FileList | File[] | null,
) {
  const imageFilesFromItems = pickImageFilesFromItems(items);

  if (imageFilesFromItems.length > 0) {
    return imageFilesFromItems;
  }

  return Array.from(files ?? []).filter((file) => acceptedMimeTypes.has(file.type));
}

function pickImageFile(items?: DataTransferItemList | null) {
  return pickImageFilesFromItems(items)[0] ?? null;
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

function revokeUploadPreviews(uploads: DraftUpload[]) {
  for (const upload of uploads) {
    URL.revokeObjectURL(upload.previewUrl);
  }
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
  const editorShellRef = useRef<HTMLDivElement>(null);
  const applicationPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [draft, setDraft] = useState<JobApplicationDraft>(emptyDraft);
  const draftRef = useRef(draft);
  const [draftUploads, setDraftUploads] = useState<DraftUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [previewUploadId, setPreviewUploadId] = useState<string | null>(null);
  const [thumbnailRailStyle, setThumbnailRailStyle] = useState<{
    right: number;
    top: number;
  } | null>(null);
  const [referrerOptions, setReferrerOptions] = useState(initialReferrerOptions);
  const referrerOptionsRef = useRef(initialReferrerOptions);
  const uploadsRef = useRef<DraftUpload[]>([]);
  const inputId = useId();
  const screenshotThumbnailHalf = 35;
  const screenshotRightInset = 60;

  const extractingCount = draftUploads.filter(
    (upload) => upload.status === "extracting",
  ).length;
  const queuedCount = draftUploads.filter(
    (upload) => upload.status === "queued",
  ).length;
  const processingCount = extractingCount + queuedCount;
  const isExtracting = processingCount > 0;
  const isFormLocked = disabled || isSaving || isExtracting;
  const isUploadLocked = disabled || isSaving;
  const saveDisabled =
    disabled ||
    isSaving ||
    draftUploads.length === 0 ||
    isExtracting ||
    draft.jobTitle.trim().length === 0 ||
    draft.companyName.trim().length === 0;
  const newestUpload = draftUploads[draftUploads.length - 1] ?? null;
  const extractingUpload =
    [...draftUploads].reverse().find((upload) => upload.status === "extracting") ??
    null;
  const activeUpload =
    extractingUpload ??
    draftUploads.find((upload) => upload.status === "queued") ??
    newestUpload;
  const remainingQueuedCount =
    queuedCount - (activeUpload?.status === "queued" ? 1 : 0);
  const hasUploadedScreenshot = draftUploads.length > 0;
  const previewUpload =
    draftUploads.find((upload) => upload.id === previewUploadId) ?? null;
  const processingLabel = activeUpload
    ? remainingQueuedCount > 0
      ? `Working on ${activeUpload.file.name}. ${remainingQueuedCount} more screenshot${remainingQueuedCount === 1 ? "" : "s"} queued, and the draft will keep merging new details.`
      : `Working on ${activeUpload.file.name}. The draft fields below will update automatically.`
    : "The draft fields will populate automatically when extraction finishes.";

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    referrerOptionsRef.current = referrerOptions;
  }, [referrerOptions]);

  useEffect(() => {
    uploadsRef.current = draftUploads;
  }, [draftUploads]);

  useEffect(() => {
    return () => {
      revokeUploadPreviews(uploadsRef.current);
    };
  }, []);

  useEffect(() => {
    setIsPreviewMounted(true);
  }, []);

  const updateThumbnailRailPosition = useEffectEvent(() => {
    const applicationPanel = applicationPanelRef.current;
    const editorShell = editorShellRef.current;

    if (!applicationPanel || !editorShell) {
      return;
    }

    const rect = applicationPanel.getBoundingClientRect();

    setThumbnailRailStyle({
      right: Math.max(
        16,
        window.innerWidth - rect.right - screenshotThumbnailHalf + screenshotRightInset,
      ),
      top: Math.max(16, rect.top - screenshotThumbnailHalf),
    });
  });

  useEffect(() => {
    if (!isPreviewMounted || draftUploads.length === 0) {
      return;
    }

    updateThumbnailRailPosition();

    const resizeObserver = new ResizeObserver(() => {
      updateThumbnailRailPosition();
    });

    if (editorShellRef.current) {
      resizeObserver.observe(editorShellRef.current);
    }
    if (applicationPanelRef.current) {
      resizeObserver.observe(applicationPanelRef.current);
    }

    window.addEventListener("resize", updateThumbnailRailPosition);
    window.addEventListener("scroll", updateThumbnailRailPosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateThumbnailRailPosition);
      window.removeEventListener("scroll", updateThumbnailRailPosition, true);
    };
  }, [draftUploads.length, isPreviewMounted]);

  function queueSelectedFiles(files: File[], source: UploadSource) {
    const validFiles: File[] = [];
    const validationErrors: string[] = [];

    for (const file of files) {
      const validationError = validateImageFile(file);

      if (validationError) {
        validationErrors.push(
          `${file.name || "Screenshot"}: ${validationError}`,
        );
        continue;
      }

      validFiles.push(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (validFiles.length === 0) {
      setBanner({
        text: validationErrors[0] ?? "Select a PNG, JPG, or WebP screenshot.",
        tone: "error",
      });
      return;
    }

    if (validationErrors.length > 0) {
      setBanner({
        text: `${validationErrors[0]} Queued ${validFiles.length} screenshot${validFiles.length === 1 ? "" : "s"} anyway.`,
        tone: "info",
      });
    } else {
      setBanner(null);
    }

    setDraftUploads((currentUploads) => [
      ...currentUploads,
      ...validFiles.map((file) => ({
        error: null,
        extraction: null,
        file,
        id: crypto.randomUUID(),
        model: null,
        previewUrl: URL.createObjectURL(file),
        source,
        status: "queued" as const,
      })),
    ]);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0 || isUploadLocked) {
      return;
    }

    queueSelectedFiles(files, "Selected");
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (isUploadLocked) {
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

    if (isUploadLocked) {
      return;
    }

    const files = pickImageFiles(
      event.dataTransfer.items,
      event.dataTransfer.files,
    );

    if (files.length === 0) {
      setBanner({
        text: "Drop a PNG, JPG, or WebP screenshot onto the form.",
        tone: "error",
      });
      return;
    }

    queueSelectedFiles(files, "Dropped");
  }

  const syncPastedFile = useEffectEvent((file: File) => {
    queueSelectedFiles([file], "Pasted");
  });

  useEffect(() => {
    if (isUploadLocked) {
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
  }, [isUploadLocked]);

  const processQueuedUpload = useEffectEvent(
    async (uploadId: string, file: File) => {
      setDraftUploads((currentUploads) =>
        currentUploads.map((upload) =>
          upload.id === uploadId && upload.status === "queued"
            ? { ...upload, status: "extracting" }
            : upload,
        ),
      );

      const formData = new FormData();
      formData.append("jobScreenshot", file);
      formData.append("draftContext", JSON.stringify(draftRef.current));

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
          ? referrerOptionsRef.current.find(
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
    },
  );

  useEffect(() => {
    if (isUploadLocked || extractingCount > 0) {
      return;
    }

    const nextUpload = draftUploads.find((upload) => upload.status === "queued");

    if (!nextUpload) {
      return;
    }

    void processQueuedUpload(nextUpload.id, nextUpload.file);
  }, [draftUploads, extractingCount, isUploadLocked]);

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
      revokeUploadPreviews(draftUploads);
      setDraftUploads([]);
      setPreviewUploadId(null);
      setIsMoreOpen(false);
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
    revokeUploadPreviews(draftUploads);
    setDraft(emptyDraft);
    setDraftUploads([]);
    setPreviewUploadId(null);
    setIsMoreOpen(false);
    setBanner(null);
  }

  if (!hasUploadedScreenshot) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="shrink-0">
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
            disabled={isUploadLocked}
            id={inputId}
            onChange={handleFileInputChange}
            type="file"
            multiple
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
                  isUploadLocked ? "pointer-events-none opacity-60" : ""
                }`}
                htmlFor={inputId}
              >
                choose a file
              </label>
              . The editor appears after extraction finishes.
            </p>
            <p className="mt-4 text-sm text-zinc-400">
              PNG, JPG, WebP up to 8 MB each
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={editorShellRef} className="relative flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
          New application
        </p>
      </div>

      <ApplicationWindow
        companyOptions={companyOptions}
        draft={draft}
        extractingCount={processingCount}
        isFormLocked={isFormLocked}
        isExtracting={isExtracting}
        isMoreOpen={isMoreOpen}
        isSaving={isSaving}
        onReset={resetDraft}
        onPanelDragLeave={handleDragLeave}
        onPanelDragOver={handleDragOver}
        onPanelDrop={handleDrop}
        onSubmit={handleSubmit}
        panelClassName={`app-scrollbar flex h-full min-h-0 flex-col gap-3 rounded-[1.5rem] border-2 border-dashed border-emerald-300/45 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.12),rgba(9,9,11,0.92)_40%,rgba(5,5,7,0.98)_100%)] p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.14)] sm:p-4 ${
          isExtracting ? "overflow-hidden" : "overflow-auto"
        }`}
        panelRef={applicationPanelRef}
        processingLabel={processingLabel}
        referrerOptions={referrerOptions}
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

      {draftUploads.length > 0 && isPreviewMounted && thumbnailRailStyle
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[140] flex max-w-[20rem] flex-wrap justify-end gap-2"
              style={thumbnailRailStyle}
            >
              {draftUploads.map((upload, index) => (
                <div key={upload.id} className="pointer-events-auto">
                  <button
                    className="group relative h-[70px] w-[70px] shrink-0 overflow-hidden rounded-[1rem] border border-white/15 bg-black/85 shadow-[0_18px_40px_rgba(0,0,0,0.42)] ring-1 ring-emerald-300/10 transition hover:-translate-y-1 hover:border-emerald-300/40 hover:ring-emerald-300/30 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
                    onClick={() => setPreviewUploadId(upload.id)}
                    type="button"
                  >
                    <Image
                      alt={`${upload.file.name} preview`}
                      className="h-full w-full object-cover opacity-90 transition duration-200 group-hover:scale-[1.03] group-hover:opacity-100"
                      fill
                      sizes="70px"
                      src={upload.previewUrl}
                      unoptimized
                    />
                    {extractingUpload?.id === upload.id ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-emerald-200/25 border-t-emerald-200" />
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-1.5 pb-1.5 pt-4 text-left">
                      <p className="truncate text-[9px] font-medium uppercase tracking-[0.14em] text-white/90">
                        Shot {index + 1}
                      </p>
                      <p className="truncate text-[9px] text-zinc-300">
                        {upload.status === "failed"
                          ? "Needs review"
                          : upload.status === "extracting"
                            ? "Extracting"
                            : upload.status === "queued"
                              ? "Queued"
                              : ""}
                      </p>
                    </div>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      {previewUpload && isPreviewMounted
        ? createPortal(
            <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
              <button
                aria-label="Close screenshot preview"
                className="absolute inset-0"
                onClick={() => setPreviewUploadId(null)}
                type="button"
              />
              <div className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-emerald-300/30 bg-zinc-950/95 shadow-[0_30px_120px_rgba(0,0,0,0.58)]">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {previewUpload.file.name}
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                    onClick={() => setPreviewUploadId(null)}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0"
                      fill="none"
                      viewBox="0 0 14 14"
                    >
                      <path
                        d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span>Close</span>
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <Image
                    alt={previewUpload.file.name}
                    className="mx-auto h-auto max-h-[calc(90vh-7rem)] w-auto max-w-full rounded-[1.1rem] border border-white/10 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                    height={1200}
                    sizes="100vw"
                    src={previewUpload.previewUrl}
                    unoptimized
                    width={1200}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      </ApplicationWindow>
    </div>
  );
}
