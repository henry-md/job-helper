"use client";

import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import ResumeDocumentEditor from "@/components/resume-document-editor";
import {
  serializeResumeDocument,
  type ResumeDocument,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";

type TailorResumeWorkspaceProps = {
  initialProfile: TailorResumeProfile;
  openAIReady: boolean;
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

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
      {children}
    </span>
  );
}

export default function TailorResumeWorkspace({
  initialProfile,
  openAIReady,
}: TailorResumeWorkspaceProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobDescriptionSaveSequenceRef = useRef(0);
  const documentSaveSequenceRef = useRef(0);
  const lastSavedJobDescriptionRef = useRef(initialProfile.jobDescription);
  const lastSavedEditedDocumentRef = useRef(
    serializeResumeDocument(initialProfile.extraction.editedDocument),
  );
  const [profile, setProfile] = useState(initialProfile);
  const [draftJobDescription, setDraftJobDescription] = useState(
    initialProfile.jobDescription,
  );
  const [draftEditedDocument, setDraftEditedDocument] = useState<ResumeDocument | null>(
    initialProfile.extraction.editedDocument,
  );
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSavingJobDescription, setIsSavingJobDescription] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isReextracting, setIsReextracting] = useState(false);
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "idle" | "saved" | "saving"
  >("idle");
  const [documentState, setDocumentState] = useState<"idle" | "saved" | "saving">(
    "idle",
  );

  const resume = profile.resume;
  const extraction = profile.extraction;
  const previewAsImage = resume?.mimeType.startsWith("image/") ?? false;
  const editorDisabled = isUploadingResume || isReextracting;

  useEffect(() => {
    setIsPreviewMounted(true);
  }, []);

  useEffect(() => {
    setProfile(initialProfile);
    setDraftJobDescription(initialProfile.jobDescription);
    setDraftEditedDocument(initialProfile.extraction.editedDocument);
    lastSavedJobDescriptionRef.current = initialProfile.jobDescription;
    lastSavedEditedDocumentRef.current = serializeResumeDocument(
      initialProfile.extraction.editedDocument,
    );
    setJobDescriptionState("idle");
    setDocumentState("idle");
  }, [initialProfile]);

  useEffect(() => {
    if (draftJobDescription === lastSavedJobDescriptionRef.current) {
      if (jobDescriptionState === "saving") {
        setIsSavingJobDescription(false);
        setJobDescriptionState("saved");
      }
      return;
    }

    const sequence = jobDescriptionSaveSequenceRef.current + 1;
    jobDescriptionSaveSequenceRef.current = sequence;
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

        if (!response.ok || !payload.profile) {
          throw new Error(payload.error ?? "Unable to save the job description.");
        }

        if (jobDescriptionSaveSequenceRef.current !== sequence) {
          return;
        }

        lastSavedJobDescriptionRef.current = payload.profile.jobDescription;
        setProfile(payload.profile);
        setIsSavingJobDescription(false);
        setJobDescriptionState("saved");
      } catch (error) {
        if (jobDescriptionSaveSequenceRef.current !== sequence) {
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
  }, [draftJobDescription, jobDescriptionState]);

  useEffect(() => {
    const serializedDraftDocument = serializeResumeDocument(draftEditedDocument);

    if (serializedDraftDocument === lastSavedEditedDocumentRef.current) {
      if (documentState === "saving") {
        setIsSavingDocument(false);
        setDocumentState("saved");
      }
      return;
    }

    if (!draftEditedDocument) {
      return;
    }

    const sequence = documentSaveSequenceRef.current + 1;
    documentSaveSequenceRef.current = sequence;
    setIsSavingDocument(true);
    setDocumentState("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/tailor-resume", {
          body: JSON.stringify({ editedDocument: draftEditedDocument }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        });

        const payload = (await response.json()) as {
          error?: string;
          profile?: TailorResumeProfile;
        };

        if (!response.ok || !payload.profile) {
          throw new Error(payload.error ?? "Unable to save resume corrections.");
        }

        if (documentSaveSequenceRef.current !== sequence) {
          return;
        }

        lastSavedEditedDocumentRef.current = serializeResumeDocument(
          payload.profile.extraction.editedDocument,
        );
        setProfile(payload.profile);
        setIsSavingDocument(false);
        setDocumentState("saved");
      } catch (error) {
        if (documentSaveSequenceRef.current !== sequence) {
          return;
        }

        setIsSavingDocument(false);
        setDocumentState("idle");
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to save resume corrections.",
        );
      }
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [documentState, draftEditedDocument]);

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

    if (!openAIReady) {
      toast.error("Add OPENAI_API_KEY before extracting resume structure.");
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
        extractionError?: string | null;
        profile?: TailorResumeProfile;
      };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save the resume.");
      }

      setProfile(payload.profile);
      setDraftEditedDocument(payload.profile.extraction.editedDocument);
      lastSavedEditedDocumentRef.current = serializeResumeDocument(
        payload.profile.extraction.editedDocument,
      );

      if (payload.extractionError) {
        toast.error(
          `Saved the resume, but extraction needs review: ${payload.extractionError}`,
        );
      } else {
        toast.success("Saved the resume and extracted its structure.");
      }
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

  async function reextractResume() {
    if (!resume) {
      return;
    }

    if (!openAIReady) {
      toast.error("Add OPENAI_API_KEY before extracting resume structure.");
      return;
    }

    setIsReextracting(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({ action: "reextract" }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        error?: string;
        extractionError?: string | null;
        profile?: TailorResumeProfile;
      };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to re-extract the resume.");
      }

      setProfile(payload.profile);
      setDraftEditedDocument(payload.profile.extraction.editedDocument);
      lastSavedEditedDocumentRef.current = serializeResumeDocument(
        payload.profile.extraction.editedDocument,
      );

      if (payload.extractionError) {
        toast.error(
          `Saved the resume, but extraction still failed: ${payload.extractionError}`,
        );
      } else {
        toast.success("Re-extracted the resume structure.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to re-extract the resume.",
      );
    } finally {
      setIsReextracting(false);
    }
  }

  function handleResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || isUploadingResume || isReextracting) {
      return;
    }

    void uploadResume(file);
  }

  return (
    <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)]">
      <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[0.78fr_1.22fr]">
        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Resume
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Upload once, then review the extracted structure
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
                Replacing the saved file reruns extraction and refreshes the
                correction form below.
              </p>
            </div>

            <label
              className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                !openAIReady || isUploadingResume || isReextracting
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
            disabled={!openAIReady || isUploadingResume || isReextracting}
            id={fileInputId}
            onChange={handleResumeChange}
            ref={fileInputRef}
            type="file"
          />

          {!openAIReady ? (
            <div className="mt-5 rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              Add `OPENAI_API_KEY` to extract a resume into the correction form.
            </div>
          ) : null}

          {resume ? (
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

              <div className="flex flex-wrap gap-2">
                <StatusPill>
                  {extraction.status === "ready"
                    ? "Extracted"
                    : extraction.status === "failed"
                      ? "Needs retry"
                      : extraction.status === "extracting"
                        ? "Extracting..."
                        : "Awaiting extraction"}
                </StatusPill>
                {extraction.model ? <StatusPill>{extraction.model}</StatusPill> : null}
                {extraction.updatedAt ? (
                  <StatusPill>{formatSavedAt(extraction.updatedAt)}</StatusPill>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[1.35rem] border border-dashed border-white/12 bg-black/15 p-6 text-sm leading-6 text-zinc-400">
              No saved resume yet. Upload a PDF or image resume and the app will
              extract a structured draft you can correct below.
            </div>
          )}
        </section>

        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Extraction
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                OpenAI turns the resume into editable structure
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                The editor below is driven by the extracted document, not raw OCR.
                You can correct text, styling, separators, blocks, and section order.
              </p>
            </div>

            {resume ? (
              <button
                className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                  !openAIReady || isUploadingResume || isReextracting
                    ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                    : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                }`}
                disabled={!openAIReady || isUploadingResume || isReextracting}
                onClick={() => void reextractResume()}
                type="button"
              >
                {isReextracting ? "Extracting..." : "Re-extract"}
              </button>
            ) : null}
          </div>

          <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-black/20 p-4">
            {resume ? (
              extraction.status === "ready" ? (
                <div className="space-y-2 text-sm leading-6 text-zinc-300">
                  <p>Structured extraction is ready to review.</p>
                  <p className="text-zinc-500">
                    Changes you make in the form below autosave back to your saved
                    resume profile.
                  </p>
                </div>
              ) : extraction.status === "failed" ? (
                <div className="space-y-2 text-sm leading-6 text-rose-100">
                  <p>Extraction failed for the current resume.</p>
                  <p className="text-rose-200/80">
                    {extraction.error ?? "Try re-extracting the saved file."}
                  </p>
                </div>
              ) : extraction.status === "extracting" ? (
                <p className="text-sm leading-6 text-zinc-300">
                  The resume is being processed now. The correction form will
                  appear as soon as extraction finishes.
                </p>
              ) : (
                <p className="text-sm leading-6 text-zinc-300">
                  Upload a resume to generate the editable structure.
                </p>
              )
            ) : (
              <p className="text-sm leading-6 text-zinc-300">
                Upload a resume first. Once extraction finishes, the correction form
                will appear here and persist on reload.
              </p>
            )}
          </div>
        </section>
      </section>

      <section className="glass-panel soft-ring flex min-h-[260px] flex-col rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Job description
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Paste the role you want to tailor for
            </h2>
          </div>

          <StatusPill>
            {isSavingJobDescription
              ? "Saving..."
              : jobDescriptionState === "saved"
                ? "Saved"
                : "Autosaves"}
          </StatusPill>
        </div>

        <textarea
          className="mt-5 min-h-[180px] w-full flex-1 resize-none rounded-[1.25rem] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
          onChange={(event) => setDraftJobDescription(event.target.value)}
          placeholder="Paste the full job description here. This saves separately from the extracted resume structure."
          value={draftJobDescription}
        />
      </section>

      <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Correction form
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Correct anything the model got wrong
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Edit the extracted structure directly, including text segments,
              italic/bold/link styling, separators, right-side dates, labeled lines,
              and bullets.
            </p>
          </div>

          <StatusPill>
            {isSavingDocument
              ? "Saving..."
              : documentState === "saved"
                ? "Saved"
                : "Autosaves"}
          </StatusPill>
        </div>

        {draftEditedDocument ? (
          <ResumeDocumentEditor
            disabled={editorDisabled}
            onChange={setDraftEditedDocument}
            value={draftEditedDocument}
          />
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-white/12 bg-black/15 p-6 text-sm leading-6 text-zinc-400">
            {resume
              ? extraction.status === "failed"
                ? "The resume is saved, but extraction failed. Use Re-extract after checking your OpenAI setup or trying the same file again."
                : "The resume is saved, but there is no extracted document yet."
              : "Upload a resume to populate the correction form."}
          </div>
        )}
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
