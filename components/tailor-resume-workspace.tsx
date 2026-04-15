"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
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
  const latestDraftLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const pendingLatexCodeRef = useRef<string | null>(null);
  const isLatexSaveInFlightRef = useRef(false);
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
  const [pendingUploadMimeType, setPendingUploadMimeType] = useState<
    string | null
  >(null);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "idle" | "saved" | "saving"
  >("idle");
  const [latexState, setLatexState] = useState<"idle" | "saved" | "saving">(
    "idle",
  );

  const resume = profile.resume;
  const previewAsImage = resume?.mimeType.startsWith("image/") ?? false;
  const editorDisabled = isUploadingResume;
  const isPendingPdfUpload = pendingUploadMimeType === "application/pdf";
  const latexLockTitle = isUploadingResume
    ? isPendingPdfUpload
      ? "Parsing your newly uploaded PDF"
      : "Parsing your newly uploaded resume"
    : null;
  const latexLockMessage = isUploadingResume
    ? isPendingPdfUpload
      ? "We're parsing your newly uploaded PDF now. The LaTeX draft will unlock as soon as the fresh extraction is ready."
      : "We're parsing your newly uploaded resume now. The LaTeX draft will unlock as soon as the fresh extraction is ready."
    : null;
  const previewPdfUrl = buildPreviewPdfUrl(profile.latex.pdfUpdatedAt);
  const hasPreviewPdf = Boolean(previewPdfUrl);
  const isPreviewRefreshing = hasPreviewPdf && (
    isSavingLatex || isUploadingResume || isPreviewFrameLoading
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
    latestDraftLatexCodeRef.current = resolvedLatexCode;
    pendingLatexCodeRef.current = null;
    isLatexSaveInFlightRef.current = false;
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
    latestDraftLatexCodeRef.current = draftLatexCode;
  }, [draftLatexCode]);

  const flushPendingLatexSave = useCallback(async () => {
    if (isLatexSaveInFlightRef.current) {
      return;
    }

    const nextLatexCode = pendingLatexCodeRef.current;

    if (!nextLatexCode || nextLatexCode === lastSavedLatexCodeRef.current) {
      setIsSavingLatex(false);
      setLatexState("saved");
      return;
    }

    if (nextLatexCode.trim().length === 0) {
      pendingLatexCodeRef.current = null;
      setIsSavingLatex(false);
      setLatexState("idle");
      return;
    }

    const sequence = latexSaveSequenceRef.current + 1;
    latexSaveSequenceRef.current = sequence;
    isLatexSaveInFlightRef.current = true;
    setIsSavingLatex(true);
    setLatexState("saving");

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({ latexCode: nextLatexCode }),
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

      if (pendingLatexCodeRef.current === resolvedLatexCode) {
        pendingLatexCodeRef.current = null;
      }

      if (latestDraftLatexCodeRef.current === resolvedLatexCode) {
        setIsSavingLatex(false);
        setLatexState("saved");
      }
    } catch (error) {
      if (latexSaveSequenceRef.current !== sequence) {
        return;
      }

      pendingLatexCodeRef.current = null;
      setIsSavingLatex(false);
      setLatexState("idle");
      toast.error(
        error instanceof Error ? error.message : "Unable to save the LaTeX draft.",
      );
    } finally {
      isLatexSaveInFlightRef.current = false;

      if (pendingLatexCodeRef.current) {
        void flushPendingLatexSave();
      }
    }
  }, []);

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
      pendingLatexCodeRef.current = null;
      setIsSavingLatex(false);
      setLatexState("idle");
      return;
    }

    pendingLatexCodeRef.current = draftLatexCode;
    setIsSavingLatex(true);
    setLatexState("saving");
    void flushPendingLatexSave();
  }, [draftLatexCode, latexState, flushPendingLatexSave]);

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

    setPendingUploadMimeType(file.type);
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
      setPendingUploadMimeType(null);
      setIsUploadingResume(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || isUploadingResume) {
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
    <section
      aria-busy={editorDisabled}
      className="flex h-full min-w-0 flex-col rounded-[1.25rem] border border-white/8 bg-black/10 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 xl:min-h-[560px]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          LATEX SOURCE
        </p>
        {latexLockTitle ? <StatusPill>{latexLockTitle}</StatusPill> : null}
      </div>

      <div className="relative flex min-h-[640px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
        {draftLatexCode.trim().length > 0 || resume ? (
          <textarea
            className={`min-h-[600px] w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none placeholder:text-zinc-500 transition ${
              editorDisabled
                ? "cursor-not-allowed text-zinc-500 opacity-35"
                : "text-zinc-100"
            }`}
            disabled={editorDisabled}
            onChange={(event) => setDraftLatexCode(event.target.value)}
            spellCheck={false}
            value={draftLatexCode}
          />
        ) : (
          <div aria-hidden="true" className="min-h-[600px] flex-1" />
        )}

        {latexLockTitle && latexLockMessage ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/65 px-6 backdrop-blur-[2px]">
            <div className="max-w-md rounded-[1.25rem] border border-white/10 bg-black/55 px-5 py-4 text-center shadow-[0_16px_45px_rgba(0,0,0,0.34)]">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-white/15 border-t-emerald-300" />
              <p className="mt-4 text-sm font-medium text-zinc-50">
                {latexLockTitle}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {latexLockMessage}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  const previewPanelContent = (
    <section className="flex h-full min-w-0 flex-col rounded-[1.25rem] border border-white/8 bg-black/10 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 xl:min-h-[560px]">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Preview
        </p>
      </div>

      {profile.latex.status === "failed" && profile.latex.error ? (
        <div className="mb-3 rounded-[1.1rem] border border-rose-400/20 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
          <p className="font-medium">The current LaTeX draft did not render cleanly.</p>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-rose-200/90">
            {profile.latex.error}
          </pre>
        </div>
      ) : null}

      <div className="relative flex min-h-[500px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate">
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
          <div aria-hidden="true" className="h-full w-full" />
        )}
      </div>
    </section>
  );

  return (
    <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)]">
      <input
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={!openAIReady || isUploadingResume}
        id={fileInputId}
        onChange={handleResumeChange}
        ref={fileInputRef}
        type="file"
      />

      {resume ? (
        <section className="glass-panel soft-ring overflow-hidden rounded-[1.5rem]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Resume
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                onClick={() => setIsPreviewOpen(true)}
                type="button"
              >
                View source
              </button>

              <label
                className={`inline-flex items-center rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.2em] transition ${
                  !openAIReady || isUploadingResume
                    ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                    : "cursor-pointer border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                }`}
                htmlFor={fileInputId}
              >
                {isUploadingResume ? "Saving..." : "Re-upload"}
              </label>
            </div>
          </div>

          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            {isWideLayout ? (
              <section className="min-h-[560px] pt-1">
                <ResizablePanelGroup
                  className="min-h-[560px] gap-0"
                  orientation="horizontal"
                >
                  <ResizablePanel
                    className="min-w-0 overflow-hidden pr-2"
                    defaultSize={defaultEditorPaneSize}
                    minSize={42}
                  >
                    {editorPanelContent}
                  </ResizablePanel>

                  <ResizableHandle className="group relative w-4 bg-transparent after:hidden focus-visible:ring-0">
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
                  </ResizableHandle>

                  <ResizablePanel
                    className="min-w-0 overflow-hidden pl-2"
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
              <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)] pt-1">
                {editorPanelContent}
                {previewPanelContent}
              </section>
            )}
          </div>
        </section>
      ) : (
        <section
          className={`glass-panel soft-ring rounded-[1.5rem] p-4 transition sm:p-5 ${
            isUploadingResume ? "border-white/8 bg-white/[0.02] opacity-85" : ""
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Resume
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Upload a resume
              </h2>
            </div>

            <label
              className={`inline-flex items-center rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                !openAIReady || isUploadingResume
                  ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                  : "cursor-pointer border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
              }`}
              htmlFor={fileInputId}
            >
              {isUploadingResume ? "Saving..." : "Upload resume"}
            </label>
          </div>

          {!openAIReady ? (
            <div className="mt-5 rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              Resume extraction is not configured yet, so uploads cannot be processed.
            </div>
          ) : (
            <div className="mt-5 rounded-[1.35rem] border border-dashed border-white/12 bg-black/15 p-6 text-sm leading-6 text-zinc-400">
              Upload a PDF or image to start editing the LaTeX and preview.
            </div>
          )}
        </section>
      )}

      {resume ? (
        <>
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
        </>
      ) : null}

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
