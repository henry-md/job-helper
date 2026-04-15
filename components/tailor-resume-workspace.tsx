"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { TailorResumeProfile } from "@/lib/tailor-resume-types";

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
const defaultEditorPaneSize = 56;
const defaultPreviewPaneSize = 44;

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

function buildPreviewPdfUrl(updatedAt: string | null) {
  return updatedAt
    ? `/api/tailor-resume/preview?updatedAt=${encodeURIComponent(updatedAt)}`
    : null;
}

function resolveSavedLatexCode(profile: TailorResumeProfile) {
  return profile.latex.code;
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
  const previewPanelRef = useRef<PanelImperativeHandle | null>(null);
  const jobDescriptionSaveSequenceRef = useRef(0);
  const latexSaveSequenceRef = useRef(0);
  const lastSavedJobDescriptionRef = useRef(initialProfile.jobDescription);
  const lastSavedLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const previousPreviewPdfUrlRef = useRef(
    buildPreviewPdfUrl(initialProfile.latex.pdfUpdatedAt),
  );
  const [profile, setProfile] = useState(initialProfile);
  const [draftJobDescription, setDraftJobDescription] = useState(
    initialProfile.jobDescription,
  );
  const [draftLatexCode, setDraftLatexCode] = useState(
    resolveSavedLatexCode(initialProfile),
  );
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewFrameLoading, setIsPreviewFrameLoading] = useState(false);
  const [isSavingJobDescription, setIsSavingJobDescription] = useState(false);
  const [isSavingLatex, setIsSavingLatex] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isReextracting, setIsReextracting] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "idle" | "saved" | "saving"
  >("idle");
  const [latexState, setLatexState] = useState<"idle" | "saved" | "saving">(
    "idle",
  );

  const resume = profile.resume;
  const extraction = profile.extraction;
  const previewAsImage = resume?.mimeType.startsWith("image/") ?? false;
  const editorDisabled = isUploadingResume || isReextracting;
  const previewPdfUrl = buildPreviewPdfUrl(profile.latex.pdfUpdatedAt);
  const hasPreviewPdf = Boolean(previewPdfUrl);
  const isPreviewRefreshing = hasPreviewPdf && (
    isSavingLatex ||
    isUploadingResume ||
    isReextracting ||
    isPreviewFrameLoading
  );
  useEffect(() => {
    setIsPreviewMounted(true);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const syncLayoutMode = () => {
      setIsWideLayout(mediaQuery.matches);
    };

    syncLayoutMode();
    mediaQuery.addEventListener("change", syncLayoutMode);

    return () => {
      mediaQuery.removeEventListener("change", syncLayoutMode);
    };
  }, []);

  useEffect(() => {
    const resolvedLatexCode = resolveSavedLatexCode(initialProfile);

    setProfile(initialProfile);
    setDraftJobDescription(initialProfile.jobDescription);
    setDraftLatexCode(resolvedLatexCode);
    lastSavedJobDescriptionRef.current = initialProfile.jobDescription;
    lastSavedLatexCodeRef.current = resolvedLatexCode;
    previousPreviewPdfUrlRef.current = buildPreviewPdfUrl(
      initialProfile.latex.pdfUpdatedAt,
    );
    setIsPreviewCollapsed(false);
    setIsPreviewFrameLoading(false);
    setJobDescriptionState("idle");
    setLatexState("idle");
  }, [initialProfile]);

  useLayoutEffect(() => {
    if (!previewPdfUrl) {
      previousPreviewPdfUrlRef.current = null;
      setIsPreviewFrameLoading(false);
      return;
    }

    if (!previousPreviewPdfUrlRef.current) {
      previousPreviewPdfUrlRef.current = previewPdfUrl;
      return;
    }

    if (previousPreviewPdfUrlRef.current !== previewPdfUrl) {
      previousPreviewPdfUrlRef.current = previewPdfUrl;
      setIsPreviewFrameLoading(true);
    }
  }, [previewPdfUrl]);

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
    if (draftLatexCode === lastSavedLatexCodeRef.current) {
      if (latexState === "saving") {
        setIsSavingLatex(false);
        setLatexState("saved");
      }
      return;
    }

    if (draftLatexCode.trim().length === 0) {
      setIsSavingLatex(false);
      setLatexState("idle");
      return;
    }

    const sequence = latexSaveSequenceRef.current + 1;
    latexSaveSequenceRef.current = sequence;
    setIsSavingLatex(true);
    setLatexState("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/tailor-resume", {
          body: JSON.stringify({ latexCode: draftLatexCode }),
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
          throw new Error(payload.error ?? "Unable to save the LaTeX draft.");
        }

        if (latexSaveSequenceRef.current !== sequence) {
          return;
        }

        const resolvedLatexCode = resolveSavedLatexCode(payload.profile);

        lastSavedLatexCodeRef.current = resolvedLatexCode;
        setProfile(payload.profile);
        setDraftLatexCode(resolvedLatexCode);
        setIsSavingLatex(false);
        setLatexState("saved");
      } catch (error) {
        if (latexSaveSequenceRef.current !== sequence) {
          return;
        }

        setIsSavingLatex(false);
        setLatexState("idle");
        toast.error(
          error instanceof Error ? error.message : "Unable to save the LaTeX draft.",
        );
      }
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftLatexCode, latexState]);

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
      toast.error("Add OPENAI_API_KEY before extracting resume LaTeX.");
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

      const resolvedLatexCode = resolveSavedLatexCode(payload.profile);

      setProfile(payload.profile);
      setDraftLatexCode(resolvedLatexCode);
      lastSavedLatexCodeRef.current = resolvedLatexCode;

      if (payload.extractionError) {
        toast.error(
          `Saved the resume, but LaTeX extraction needs review: ${payload.extractionError}`,
        );
      } else if (payload.profile.latex.status === "failed") {
        toast.error(
          "Saved the resume, but the extracted LaTeX still needs a rendering fix before the preview can display.",
        );
      } else {
        toast.success("Saved the resume and opened the extracted LaTeX draft.");
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
      toast.error("Add OPENAI_API_KEY before extracting resume LaTeX.");
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

      const resolvedLatexCode = resolveSavedLatexCode(payload.profile);

      setProfile(payload.profile);
      setDraftLatexCode(resolvedLatexCode);
      lastSavedLatexCodeRef.current = resolvedLatexCode;

      if (payload.extractionError) {
        toast.error(
          `Saved the resume, but LaTeX extraction still failed: ${payload.extractionError}`,
        );
      } else if (payload.profile.latex.status === "failed") {
        toast.error(
          "The resume was re-extracted, but the returned LaTeX still needs a rendering fix.",
        );
      } else {
        toast.success("Re-extracted the resume and refreshed the LaTeX draft.");
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

  function handlePreviewPanelResize(panelSize: {
    asPercentage: number;
    inPixels: number;
  }) {
    setIsPreviewCollapsed(panelSize.asPercentage < 1);
  }

  function togglePreviewPane() {
    if (previewPanelRef.current?.isCollapsed()) {
      previewPanelRef.current.expand();
      return;
    }

    previewPanelRef.current?.collapse();
  }

  function stopHandleButtonEvent(
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
  }

  const editorPanelContent = (
    <section className="glass-panel soft-ring h-full min-w-0 rounded-[1.5rem] p-3 sm:p-4 xl:min-h-[560px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            LaTeX source
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
            Edit the resume directly in LaTeX
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            This is now the real source of truth. The extracted LaTeX autosaves as
            you type, then the PDF preview recompiles from that exact document.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusPill>
            {isSavingLatex
              ? "Saving..."
              : latexState === "saved"
                ? "Saved"
                : "Autosaves"}
          </StatusPill>
          {isWideLayout && isPreviewCollapsed ? (
            <StatusPill>Preview hidden</StatusPill>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-[640px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
          <span>
            {draftLatexCode.trim().length > 0
              ? `${draftLatexCode.split("\n").length} line${
                  draftLatexCode.split("\n").length === 1 ? "" : "s"
                } in the current source`
              : "Upload a resume to seed the LaTeX editor"}
          </span>
          <span>Editing the left pane updates the compiled PDF on the right</span>
        </div>

        {draftLatexCode.trim().length > 0 || resume ? (
          <textarea
            className="min-h-[600px] w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
            disabled={editorDisabled}
            onChange={(event) => setDraftLatexCode(event.target.value)}
            placeholder="Upload a resume to populate the LaTeX source."
            spellCheck={false}
            value={draftLatexCode}
          />
        ) : (
          <div className="flex min-h-[600px] items-center justify-center p-6 text-center text-sm leading-6 text-zinc-400">
            Upload a resume to generate the first LaTeX draft here.
          </div>
        )}
      </div>
    </section>
  );

  const previewPanelContent = (
    <section className="glass-panel soft-ring flex h-full min-w-0 flex-col rounded-[1.5rem] p-3 sm:p-4 xl:min-h-[560px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Preview
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
            Rendered PDF
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            The preview always compiles from the current saved LaTeX draft. If the
            draft stops compiling, the error appears here so you can fix it in the
            editor immediately.
          </p>
        </div>

        {hasPreviewPdf ? (
          <StatusPill>
            {isPreviewRefreshing
              ? "Updating preview..."
              : profile.latex.pdfUpdatedAt
                ? `Updated ${formatSavedAt(profile.latex.pdfUpdatedAt)}`
                : "Preview ready"}
          </StatusPill>
        ) : null}
      </div>

      {profile.latex.status === "failed" && profile.latex.error ? (
        <div className="mt-4 rounded-[1.1rem] border border-rose-400/20 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
          <p className="font-medium">The current LaTeX draft did not render cleanly.</p>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-rose-200/90">
            {profile.latex.error}
          </pre>
        </div>
      ) : null}

      <div className="relative mt-4 flex min-h-[500px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate">
        {previewPdfUrl ? (
          <div className="relative h-full min-h-[500px] w-full">
            <iframe
              className="relative z-0 h-full min-h-[500px] w-full bg-white"
              onLoad={() => setIsPreviewFrameLoading(false)}
              src={previewPdfUrl}
              title="Compiled resume preview"
            />

            {isPreviewRefreshing ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/14 backdrop-blur-[0.5px]">
                <div className="relative z-30 rounded-full border border-white/12 bg-black/42 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                  <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-100/25 border-t-emerald-100" />
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex w-full items-center justify-center p-6 text-center text-sm leading-6 text-zinc-400">
            {resume
              ? extraction.status === "extracting"
                ? "The preview will appear here as soon as extraction and rendering finish."
                : profile.latex.status === "failed" && profile.latex.error
                  ? "Fix the LaTeX on the left, then the preview will return here after the next successful compile."
                  : "The preview will appear here after the next successful render."
              : "Upload a resume to generate a live PDF preview."}
          </div>
        )}
      </div>
    </section>
  );

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
                Upload once, then replace whenever you want
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
                Replacing the saved file reruns extraction, seeds a fresh LaTeX
                draft, and refreshes the compiled preview below.
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
              Resume extraction is not configured yet, so uploads cannot be processed.
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
              keep the file, the extracted LaTeX source, and the preview on reload.
            </div>
          )}
        </section>

        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                LaTeX workflow
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Extract once, then tailor the actual document
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                The uploaded resume is converted straight into LaTeX. That LaTeX is
                what you edit, save, and compile from here on out.
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
                <div className="grid gap-4 text-sm leading-6 text-zinc-300 sm:grid-cols-3">
                  <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Source
                    </p>
                    <p className="mt-2 text-zinc-100">
                      {draftLatexCode.trim().length > 0
                        ? `${draftLatexCode.split("\n").length} editable line${
                            draftLatexCode.split("\n").length === 1 ? "" : "s"
                          }`
                        : "Waiting for LaTeX"}
                    </p>
                    <p className="mt-2 text-zinc-500">
                      {profile.latex.updatedAt
                        ? `Updated ${formatSavedAt(profile.latex.updatedAt)}`
                        : "No saved LaTeX yet"}
                    </p>
                  </div>

                  <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Editing
                    </p>
                    <p className="mt-2 text-zinc-100">
                      {isSavingLatex
                        ? "Saving your LaTeX now"
                        : latexState === "saved"
                          ? "Draft saved"
                          : "Autosaves as you work"}
                    </p>
                    <p className="mt-2 text-zinc-500">
                      Make changes in raw LaTeX and let the preview follow.
                    </p>
                  </div>

                  <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Preview
                    </p>
                    <p className="mt-2 text-zinc-100">
                      {isPreviewRefreshing
                        ? "Refreshing preview"
                        : previewPdfUrl
                          ? "PDF preview is ready"
                          : profile.latex.status === "failed"
                            ? "Preview needs a fix"
                            : "Preview will appear after rendering"}
                    </p>
                    <p className="mt-2 text-zinc-500">
                      {isPreviewRefreshing
                        ? "Keeping the current PDF visible while the update finishes."
                        : profile.latex.pdfUpdatedAt
                          ? `Updated ${formatSavedAt(profile.latex.pdfUpdatedAt)}`
                          : "Waiting for the next successful render"}
                    </p>
                  </div>
                </div>
              ) : extraction.status === "failed" ? (
                <div className="space-y-2 text-sm leading-6 text-rose-100">
                  <p>LaTeX extraction failed for the current resume.</p>
                  <p className="text-rose-200/80">
                    {extraction.error ?? "Try re-extracting the saved file."}
                  </p>
                </div>
              ) : extraction.status === "extracting" ? (
                <p className="text-sm leading-6 text-zinc-300">
                  The resume is being processed now. As soon as extraction finishes,
                  the LaTeX editor and compiled preview will appear below.
                </p>
              ) : (
                <p className="text-sm leading-6 text-zinc-300">
                  Upload a resume to generate the editable LaTeX draft and preview.
                </p>
              )
            ) : (
              <p className="text-sm leading-6 text-zinc-300">
                Upload a resume first. Once extraction finishes, the LaTeX editor
                and preview will persist here on reload.
              </p>
            )}
          </div>
        </section>
      </section>

      {isWideLayout ? (
        <section className="min-h-[560px]">
          <ResizablePanelGroup
            className="min-h-[560px] gap-0"
            orientation="horizontal"
          >
            <ResizablePanel
              className="min-w-0 overflow-hidden"
              defaultSize={defaultEditorPaneSize}
              minSize={42}
            >
              {editorPanelContent}
            </ResizablePanel>

            <ResizableHandle className="group relative w-6 bg-transparent after:hidden focus-visible:ring-0">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition group-data-[resize-handle-state=drag]:bg-emerald-300/40" />

              <button
                aria-label={isPreviewCollapsed ? "Show preview" : "Hide preview"}
                className="absolute left-1/2 top-3 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-white/14 bg-zinc-950/96 text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.32)] transition hover:border-white/25 hover:bg-zinc-900"
                onClick={(event) => {
                  stopHandleButtonEvent(event);
                  togglePreviewPane();
                }}
                onMouseDown={stopHandleButtonEvent}
                onPointerDown={stopHandleButtonEvent}
                type="button"
              >
                {isPreviewCollapsed ? (
                  <ChevronsLeft className="h-4 w-4" />
                ) : (
                  <ChevronsRight className="h-4 w-4" />
                )}
              </button>

              <div className="absolute left-1/2 top-1/2 z-10 flex h-14 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/8 bg-black/30 shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
                <div className="h-8 w-1 rounded-full bg-white/18 transition group-data-[resize-handle-state=drag]:bg-emerald-300/55" />
              </div>
            </ResizableHandle>

            <ResizablePanel
              className="min-w-0 overflow-hidden"
              collapsedSize={0}
              collapsible
              defaultSize={defaultPreviewPaneSize}
              minSize={22}
              onResize={handlePreviewPanelResize}
              panelRef={previewPanelRef}
            >
              {previewPanelContent}
            </ResizablePanel>
          </ResizablePanelGroup>
        </section>
      ) : (
        <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)]">
          {editorPanelContent}
          {previewPanelContent}
        </section>
      )}

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
          placeholder="Paste the full job description here. This saves separately from the LaTeX resume source."
          value={draftJobDescription}
        />
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
