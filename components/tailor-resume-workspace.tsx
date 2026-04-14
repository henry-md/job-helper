"use client";

import {
  type ChangeEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { TailorResumeProfile } from "@/lib/job-application-types";

type TailorResumeWorkspaceProps = {
  disabled?: boolean;
  initialProfile: TailorResumeProfile;
};

const acceptedResumeMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const maxResumeBytes = 10 * 1024 * 1024;

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatSavedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function validateResumeFile(file: File) {
  if (!acceptedResumeMimeTypes.has(file.type)) {
    return "Use a PDF, PNG, JPG, or WebP resume.";
  }

  if (file.size === 0) {
    return "The resume file is empty.";
  }

  if (file.size > maxResumeBytes) {
    return "Keep the resume under 10 MB.";
  }

  return null;
}

export default function TailorResumeWorkspace({
  disabled = false,
  initialProfile,
}: TailorResumeWorkspaceProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autosaveSequenceRef = useRef(0);
  const lastSavedJobDescriptionRef = useRef(initialProfile.jobDescription);
  const [profile, setProfile] = useState(initialProfile);
  const [draftJobDescription, setDraftJobDescription] = useState(
    initialProfile.jobDescription,
  );
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSavingJobDescription, setIsSavingJobDescription] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "idle" | "saved" | "saving"
  >("idle");

  const resume = profile.resume;
  const previewAsImage = resume?.mimeType.startsWith("image/") ?? false;

  useEffect(() => {
    setIsPreviewMounted(true);
  }, []);

  useEffect(() => {
    setProfile(initialProfile);
    setDraftJobDescription(initialProfile.jobDescription);
    lastSavedJobDescriptionRef.current = initialProfile.jobDescription;
    setJobDescriptionState("idle");
  }, [initialProfile]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    if (draftJobDescription === lastSavedJobDescriptionRef.current) {
      if (jobDescriptionState === "saving") {
        setIsSavingJobDescription(false);
        setJobDescriptionState("saved");
      }
      return;
    }

    const sequence = autosaveSequenceRef.current + 1;
    autosaveSequenceRef.current = sequence;
    setIsSavingJobDescription(true);
    setJobDescriptionState("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/tailor-resume", {
          body: JSON.stringify({ jobDescription: draftJobDescription }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        });

        const payload = (await response.json()) as {
          error?: string;
          profile?: TailorResumeProfile;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to save the job description.");
        }

        if (autosaveSequenceRef.current !== sequence) {
          return;
        }

        const nextProfile = payload.profile ?? {
          jobDescription: draftJobDescription,
          resume,
        };

        lastSavedJobDescriptionRef.current = nextProfile.jobDescription;
        setProfile(nextProfile);
        setDraftJobDescription(nextProfile.jobDescription);
        setIsSavingJobDescription(false);
        setJobDescriptionState("saved");
      } catch (error) {
        if (autosaveSequenceRef.current !== sequence) {
          return;
        }

        setIsSavingJobDescription(false);
        setJobDescriptionState("idle");
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to save the job description.",
        );
      }
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [disabled, draftJobDescription, jobDescriptionState, resume]);

  useEffect(() => {
    if (!isPreviewOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPreviewOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPreviewOpen]);

  async function uploadResume(file: File) {
    const validationError = validateResumeFile(file);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsUploadingResume(true);

    try {
      const formData = new FormData();
      formData.append("resume", file);

      const response = await fetch("/api/tailor-resume", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        profile?: TailorResumeProfile;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save the resume.");
      }

      if (payload.profile) {
        setProfile(payload.profile);
      }

      toast.success(resume ? "Replaced the saved resume." : "Saved the resume.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save the resume.",
      );
    } finally {
      setIsUploadingResume(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || disabled || isUploadingResume) {
      return;
    }

    void uploadResume(file);
  }

  return (
    <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[0.9fr_1.1fr]">
      <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Resume
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Keep one working resume ready
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
              Upload a resume once for this profile, replace it whenever you want,
              and open it in a full-screen preview before you tailor anything.
            </p>
          </div>

          <label
            className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
              disabled || isUploadingResume
                ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
            }`}
            htmlFor={fileInputId}
          >
            {isUploadingResume
              ? "Saving..."
              : resume
                ? "Replace resume"
                : "Upload resume"}
          </label>
        </div>

        <input
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled || isUploadingResume}
          id={fileInputId}
          onChange={handleResumeChange}
          ref={fileInputRef}
          type="file"
        />

        {disabled ? (
          <div className="mt-5 rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            Resume storage is unavailable until the database connection is back.
          </div>
        ) : resume ? (
          <div className="mt-5 grid gap-4">
            <button
              className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4 text-left transition hover:border-emerald-400/25 hover:bg-emerald-400/6 focus-visible:border-emerald-300/45 focus-visible:outline-none"
              onClick={() => setIsPreviewOpen(true)}
              type="button"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-zinc-100">
                    {resume.originalFilename}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {resume.mimeType === "application/pdf" ? "PDF" : "Image"} •{" "}
                    {formatFileSize(resume.sizeBytes)}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Saved {formatSavedAt(resume.updatedAt)}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-300">
                  View full screen
                </span>
              </div>
            </button>

            <p className="text-xs leading-5 text-zinc-500">
              PDF, PNG, JPG, and WebP resumes are supported. Uploading a new file
              replaces the saved one for this person.
            </p>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.35rem] border border-dashed border-white/12 bg-black/15 p-6 text-sm leading-6 text-zinc-400">
            No saved resume yet. Start with a PDF or image resume and it will stay
            here on reload until you replace it.
          </div>
        )}
      </section>

      <section className="glass-panel soft-ring flex min-h-[420px] flex-col rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Job description
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Paste the role you want to tailor for
            </h2>
          </div>

          <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
            {isSavingJobDescription
              ? "Saving..."
              : jobDescriptionState === "saved"
                ? "Saved"
                : "Autosaves"}
          </span>
        </div>

        <textarea
          className="mt-5 min-h-[320px] w-full flex-1 resize-none rounded-[1.25rem] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
          disabled={disabled}
          onChange={(event) => setDraftJobDescription(event.target.value)}
          placeholder="Paste the full job description here. This will stay with your profile so it is waiting for the tailoring workflow later."
          value={draftJobDescription}
        />

        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Pipeline logic is not connected yet. This tab is only storing the resume
          and job description so they are ready for the next step.
        </p>
      </section>

      {isPreviewMounted && isPreviewOpen && resume
        ? createPortal(
            <div className="fixed inset-0 z-[180] flex bg-black/90 backdrop-blur-sm">
              <button
                aria-label="Close resume preview"
                className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/60"
                onClick={() => setIsPreviewOpen(false)}
                type="button"
              >
                Close
              </button>

              <a
                className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/60"
                href={resume.storagePath}
                rel="noreferrer"
                target="_blank"
              >
                Open in new tab
              </a>

              <div className="flex h-full w-full items-center justify-center p-4 pt-20">
                {previewAsImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={resume.originalFilename}
                    className="max-h-full max-w-full rounded-[1rem] object-contain shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
                    src={resume.storagePath}
                  />
                ) : (
                  <iframe
                    className="h-full w-full rounded-[1rem] border border-white/10 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
                    src={resume.storagePath}
                    title={resume.originalFilename}
                  />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
