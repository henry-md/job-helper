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
import { ChevronsLeft, ChevronsRight, Lock, LockOpen, Trash2 } from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { normalizeTailorResumeLinkUrl } from "@/lib/tailor-resume-links";
import type {
  SavedResumeRecord,
  TailorResumeLinkRecord,
  TailorResumeProfile,
  TailorResumeSavedLinkUpdate,
} from "@/lib/tailor-resume-types";

type TailorResumeWorkspaceProps = {
  debugUiEnabled: boolean;
  initialProfile: TailorResumeProfile;
  onTailoredResumesChange?: (
    tailoredResumes: TailorResumeProfile["tailoredResumes"],
  ) => void;
  openAIReady: boolean;
};

type TailorResumeExtractionAttempt = {
  attempt: number;
  error: string | null;
  linkSummary: TailorResumeLinkValidationSummary | null;
  outcome: "failed" | "succeeded";
  willRetry: boolean;
};

type TailorResumeLinkValidationSummary = {
  failedCount: number;
  passedCount: number;
  totalCount: number;
  unverifiedCount: number;
};

type TailorResumeLinkValidationEntry = {
  displayText: string | null;
  outcome: "failed" | "passed" | "unverified";
  reason: string | null;
  url: string;
};

type TailorResumeLatexLinkSyncSummary = {
  addedCount: number;
  addedLinks: Array<{
    key: string;
    label: string;
    url: string | null;
  }>;
};

type TailorResumeUploadResponsePayload = {
  error?: string;
  extractionError?: string | null;
  extractionAttempts?: TailorResumeExtractionAttempt[];
  linkValidationLinks?: TailorResumeLinkValidationEntry[] | null;
  linkValidationSummary?: TailorResumeLinkValidationSummary | null;
  profile?: TailorResumeProfile;
  savedLinkUpdateCount?: number;
  savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
};

type TailorResumeUploadStreamEvent =
  | {
      attemptEvent: TailorResumeExtractionAttempt;
      type: "extraction-attempt";
    }
  | {
      payload: TailorResumeUploadResponsePayload;
      type: "done";
    }
  | {
      error: string;
      type: "error";
    };

const acceptedResumeMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const maxResumeBytes = 10 * 1024 * 1024;
const defaultEditorPaneSize = 50;
const defaultPreviewPaneSize = 50;
const jobDescriptionToastId = "tailor-resume-job-description-save";
const latexSaveToastId = "tailor-resume-latex-save";
const latexLinkSyncToastId = "tailor-resume-latex-link-sync";
const linkValidationToastId = "tailor-resume-link-validation";
const resumeLinkSaveToastId = "tailor-resume-link-save";
const resumeUploadToastId = "tailor-resume-resume-upload";
const savedLinkUpdateToastId = "tailor-resume-saved-link-updates";
const failedLinkToastDurationMs = 5 * 60 * 1_000;

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

function buildLinkUrlDrafts(links: TailorResumeLinkRecord[]) {
  return links.reduce<Record<string, string>>((drafts, link) => {
    drafts[link.key] = link.url ?? "";
    return drafts;
  }, {});
}

function buildLinkLockDrafts(links: TailorResumeLinkRecord[]) {
  return links.reduce<Record<string, boolean>>((drafts, link) => {
    drafts[link.key] = link.locked === true;
    return drafts;
  }, {});
}

function hasPersistableLinkUrlChange(
  link: TailorResumeLinkRecord,
  draftValue: string | undefined,
) {
  const trimmedDraftValue = draftValue?.trim() ?? "";

  if (!trimmedDraftValue) {
    return false;
  }

  const normalizedDraftUrl = normalizeTailorResumeLinkUrl(trimmedDraftValue);
  return (normalizedDraftUrl ?? trimmedDraftValue) !== (link.url ?? "");
}

function readEffectiveLinkUrl(
  link: TailorResumeLinkRecord,
  draftValue: string | undefined,
) {
  const trimmedDraftValue = draftValue?.trim() ?? "";

  if (!trimmedDraftValue) {
    return link.url;
  }

  const normalizedDraftUrl = normalizeTailorResumeLinkUrl(trimmedDraftValue);
  return normalizedDraftUrl ?? trimmedDraftValue;
}

function hasLinkLockChanged(
  link: TailorResumeLinkRecord,
  draftLockedValue: boolean | undefined,
) {
  return (draftLockedValue ?? (link.locked === true)) !== (link.locked === true);
}

function canLockLink(
  link: TailorResumeLinkRecord,
  draftValue: string | undefined,
) {
  return Boolean(readEffectiveLinkUrl(link, draftValue));
}

function readUnresolvedResumeLinks(profile: TailorResumeProfile) {
  return profile.links.filter((link) => !link.disabled && link.url === null);
}

function buildPendingResumeRecord(file: File): SavedResumeRecord {
  return {
    mimeType: file.type || "application/octet-stream",
    originalFilename: file.name || "resume",
    sizeBytes: file.size,
    storagePath: URL.createObjectURL(file),
    updatedAt: new Date().toISOString(),
  };
}

function isObjectUrl(url: string) {
  return url.startsWith("blob:");
}

function hasActiveResumeLinks(profile: TailorResumeProfile) {
  return profile.links.some((link) => !link.disabled);
}

function revokeObjectUrl(url: string | null | undefined) {
  if (!url || !isObjectUrl(url)) {
    return;
  }

  URL.revokeObjectURL(url);
}

async function readTailorResumeUploadStream(
  response: Response,
  handlers: {
    onAttemptEvent: (attemptEvent: TailorResumeExtractionAttempt) => void;
  },
) {
  if (!response.body) {
    throw new Error("The resume upload did not return a readable response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: TailorResumeUploadResponsePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      const event = JSON.parse(trimmedLine) as TailorResumeUploadStreamEvent;

      if (event.type === "extraction-attempt") {
        handlers.onAttemptEvent(event.attemptEvent);
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.error);
      }

      finalPayload = event.payload;
    }

    if (done) {
      break;
    }
  }

  if (!finalPayload) {
    throw new Error("The resume upload finished without a final response payload.");
  }

  return finalPayload;
}

function showExtractionAttemptToasts(
  attempts: TailorResumeExtractionAttempt[],
) {
  attempts.forEach((attempt, index) => {
    window.setTimeout(() => {
      showExtractionAttemptToast(attempt);
    }, index * 140);
  });
}

function showExtractionAttemptToast(attempt: TailorResumeExtractionAttempt) {
  if (attempt.outcome === "failed") {
    toast.error(
      attempt.willRetry
        ? `LaTeX generation attempt ${attempt.attempt} failed, so we retried it automatically.${attempt.error ? ` ${attempt.error}` : ""}`
        : `LaTeX generation attempt ${attempt.attempt} failed and no retries remain.${attempt.error ? ` ${attempt.error}` : ""}`,
      {
        id: `tailor-resume-extraction-attempt-${attempt.attempt}-failed`,
      },
    );
    return;
  }

  toast.success(`LaTeX generation attempt ${attempt.attempt} succeeded.`, {
    id: `tailor-resume-extraction-attempt-${attempt.attempt}-succeeded`,
  });
}

function showLinkValidationSummaryToast(
  linkSummary: TailorResumeLinkValidationSummary | null | undefined,
  links: TailorResumeLinkValidationEntry[] | null | undefined,
  delayMs = 0,
) {
  if (!linkSummary || linkSummary.totalCount === 0) {
    return;
  }

  window.setTimeout(() => {
    const groupedLinks = (links ?? []).reduce<
      Array<{
        count: number;
        outcome: TailorResumeLinkValidationEntry["outcome"];
        reason: string | null;
        url: string;
      }>
    >((accumulator, link) => {
      const existingLink = accumulator.find(
        (item) =>
          item.outcome === link.outcome &&
          item.reason === link.reason &&
          item.url === link.url,
      );

      if (existingLink) {
        existingLink.count += 1;
        return accumulator;
      }

      accumulator.push({
        count: 1,
        outcome: link.outcome,
        reason: link.reason,
        url: link.url,
      });

      return accumulator;
    }, []);
    const passedLinks = groupedLinks.filter((link) => link.outcome === "passed");
    const notPassedLinks = groupedLinks.filter((link) => link.outcome !== "passed");
    const unverifiedFragment =
      linkSummary.unverifiedCount > 0
        ? `, ${linkSummary.unverifiedCount} couldn't be verified`
        : "";
    const message =
      `Validated ${linkSummary.totalCount} extracted ` +
      `link${linkSummary.totalCount === 1 ? "" : "s"}: ` +
      `${linkSummary.passedCount} passed, ${linkSummary.failedCount} failed${unverifiedFragment}.`;
    const description = (
      <div className="space-y-3 text-left">
        <div className="space-y-1">
          <div className="text-xs font-medium text-zinc-100">Passed</div>
          {passedLinks.length > 0 ? (
            <ul className="space-y-1 text-xs text-zinc-300">
              {passedLinks.map((link) => (
                <li
                  key={`${link.outcome}:${link.url}:${link.reason ?? ""}`}
                  className="break-all"
                >
                  {link.url}
                  {link.count > 1 ? ` (${link.count}x)` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-zinc-400">none</div>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-zinc-100">Didn&apos;t pass</div>
          {notPassedLinks.length > 0 ? (
            <ul className="space-y-1 text-xs text-zinc-300">
              {notPassedLinks.map((link) => (
                <li
                  key={`${link.outcome}:${link.url}:${link.reason ?? ""}`}
                  className="break-all"
                >
                  {link.url}
                  {link.count > 1 ? ` (${link.count}x)` : ""}
                  {link.outcome === "failed" ? " (failed)" : " (unverified)"}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-zinc-400">none</div>
          )}
        </div>
      </div>
    );

    if (linkSummary.failedCount > 0) {
      toast.error(message, {
        description,
        duration: failedLinkToastDurationMs,
        id: linkValidationToastId,
      });
      return;
    }

    toast.success(message, {
      description,
      id: linkValidationToastId,
    });
  }, delayMs);
}

function formatSavedLinkUpdateValue(url: string | null) {
  if (!url) {
    return "no link";
  }

  let formattedUrl = url.trim();

  while (formattedUrl.length > 1 && formattedUrl.endsWith("/")) {
    const withoutTrailingSlashes = formattedUrl.replace(/\/+$/, "");

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:$/.test(withoutTrailingSlashes)) {
      break;
    }

    formattedUrl = withoutTrailingSlashes;
  }

  return formattedUrl;
}

function showSavedLinkUpdateToast(
  updatedCount: number | null | undefined,
  savedLinkUpdates: TailorResumeSavedLinkUpdate[] | null | undefined,
) {
  const resolvedUpdates = (savedLinkUpdates ?? [])
    .map((update) => ({
      ...update,
      displayNextUrl: formatSavedLinkUpdateValue(update.nextUrl),
      displayPreviousUrl: formatSavedLinkUpdateValue(update.previousUrl),
    }))
    .filter((update) => update.displayPreviousUrl !== update.displayNextUrl);
  const resolvedCount =
    savedLinkUpdates !== undefined && savedLinkUpdates !== null
      ? resolvedUpdates.length
      : updatedCount ?? 0;

  if (resolvedCount < 1) {
    return;
  }

  toast.success(
    resolvedCount === 1
      ? "1 link was updated based on saved links."
      : `${resolvedCount} links were updated based on saved links.`,
    {
      description:
        resolvedUpdates.length > 0 ? (
          <div className="space-y-1 text-xs text-zinc-300">
            {resolvedUpdates.map((update, index) => (
              <div
                key={`${update.key}:${update.previousUrl ?? "none"}:${update.nextUrl}:${String(index)}`}
                className="break-all"
              >
                {update.displayPreviousUrl} -&gt; {update.displayNextUrl}
              </div>
            ))}
          </div>
        ) : undefined,
      id: savedLinkUpdateToastId,
    },
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
      {children}
    </span>
  );
}

export default function TailorResumeWorkspace({
  debugUiEnabled,
  initialProfile,
  onTailoredResumesChange,
  openAIReady,
}: TailorResumeWorkspaceProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewPanelRef = useRef<PanelImperativeHandle | null>(null);
  const jobDescriptionSaveSequenceRef = useRef(0);
  const latexSaveSequenceRef = useRef(0);
  const lastSavedJobDescriptionRef = useRef(initialProfile.jobDescription);
  const latestDraftJobDescriptionRef = useRef(initialProfile.jobDescription);
  const lastSavedLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const latestDraftLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const pendingLatexCodeRef = useRef<string | null>(null);
  const isLatexSaveInFlightRef = useRef(false);
  const lastAutoOpenedLinkReviewRef = useRef(initialProfile.extraction.updatedAt);
  const previousPreviewPdfUrlRef = useRef(
    buildPreviewPdfUrl(initialProfile.latex.pdfUpdatedAt),
  );
  const [profile, setProfile] = useState(initialProfile);
  const [pendingResume, setPendingResume] = useState<SavedResumeRecord | null>(
    null,
  );
  const [draftJobDescription, setDraftJobDescription] = useState(
    initialProfile.jobDescription,
  );
  const [draftLatexCode, setDraftLatexCode] = useState(
    resolveSavedLatexCode(initialProfile),
  );
  const [pendingDeletedLinkKeys, setPendingDeletedLinkKeys] = useState<string[]>([]);
  const [isLinkEditorOpen, setIsLinkEditorOpen] = useState(false);
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewFrameLoading, setIsPreviewFrameLoading] = useState(false);
  const [isSavingJobDescription, setIsSavingJobDescription] = useState(false);
  const [isSavingLatex, setIsSavingLatex] = useState(false);
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [isTailoringResume, setIsTailoringResume] = useState(false);
  const [isUpdatingBaseResumeStep, setIsUpdatingBaseResumeStep] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [activeLatexView, setActiveLatexView] = useState<"annotated" | "source">(
    "source",
  );
  const [draftLinkLocks, setDraftLinkLocks] = useState<Record<string, boolean>>({});
  const [draftLinkUrls, setDraftLinkUrls] = useState<Record<string, string>>({});
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "dirty" | "idle" | "saved" | "saving"
  >("idle");
  const [latexState, setLatexState] = useState<"idle" | "saved" | "saving">(
    "idle",
  );

  const resume = profile.resume;
  const displayedResume = pendingResume ?? resume;
  const pendingDeletedLinkKeySet = new Set(pendingDeletedLinkKeys);
  const editableLinks = profile.links.filter(
    (link) => !link.disabled && !pendingDeletedLinkKeySet.has(link.key),
  );
  const visibleLinkCount = editableLinks.length;
  const queuedRemovalCount = pendingDeletedLinkKeys.length;
  const hasEditableOrPendingLinks =
    visibleLinkCount > 0 || queuedRemovalCount > 0;
  const unresolvedLinks = editableLinks.filter((link) => link.url === null);
  const hasLinkEdits =
    queuedRemovalCount > 0 ||
    editableLinks.some((link) =>
      hasPersistableLinkUrlChange(link, draftLinkUrls[link.key]) ||
      hasLinkLockChanged(link, draftLinkLocks[link.key]),
    );
  const previewAsImage = displayedResume?.mimeType.startsWith("image/") ?? false;
  const isBaseResumeStepComplete = profile.workspace.isBaseResumeStepComplete;
  const isJobDescriptionLocked = !isBaseResumeStepComplete;
  const hasUnsavedJobDescriptionChanges =
    draftJobDescription !== lastSavedJobDescriptionRef.current;
  const editorDisabled = isUploadingResume;
  const displayedLatexCode =
    debugUiEnabled && activeLatexView === "annotated"
      ? profile.annotatedLatex.code
      : draftLatexCode;
  const previewPdfUrl = buildPreviewPdfUrl(profile.latex.pdfUpdatedAt);
  const previewErrorMessage =
    profile.latex.status === "failed"
      ? profile.latex.error ?? "Unable to compile the LaTeX preview."
      : null;
  const showEditorLoadingOverlay = isUploadingResume;
  const showPreviewLoadingOverlay =
    isSavingLatex || isUploadingResume || isPreviewFrameLoading;
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
    setPendingResume(null);
    setDraftJobDescription(initialProfile.jobDescription);
    latestDraftJobDescriptionRef.current = initialProfile.jobDescription;
    setDraftLatexCode(resolvedLatexCode);
    jobDescriptionSaveSequenceRef.current = 0;
    lastSavedJobDescriptionRef.current = initialProfile.jobDescription;
    lastSavedLatexCodeRef.current = resolvedLatexCode;
    latestDraftLatexCodeRef.current = resolvedLatexCode;
    pendingLatexCodeRef.current = null;
    isLatexSaveInFlightRef.current = false;
    lastAutoOpenedLinkReviewRef.current = initialProfile.extraction.updatedAt;
    previousPreviewPdfUrlRef.current = buildPreviewPdfUrl(
      initialProfile.latex.pdfUpdatedAt,
    );
    setPendingDeletedLinkKeys([]);
    setIsLinkEditorOpen(false);
    setIsPreviewCollapsed(false);
    setIsPreviewFrameLoading(false);
    setIsSavingLinks(false);
    setIsTailoringResume(false);
    setIsUpdatingBaseResumeStep(false);
    setActiveLatexView("source");
    setDraftLinkLocks(buildLinkLockDrafts(initialProfile.links));
    setDraftLinkUrls(buildLinkUrlDrafts(initialProfile.links));
    setJobDescriptionState(
      initialProfile.jobDescription.trim().length > 0 ? "saved" : "idle",
    );
    setLatexState("idle");
  }, [initialProfile]);

  useEffect(() => {
    setDraftLinkUrls((currentDraftLinkUrls) => {
      const nextDraftLinkUrls = { ...currentDraftLinkUrls };
      const editableLinkKeys = new Set(editableLinks.map((link) => link.key));
      let didChange = false;

      for (const link of editableLinks) {
        if (!(link.key in nextDraftLinkUrls)) {
          nextDraftLinkUrls[link.key] = link.url ?? "";
          didChange = true;
        }
      }

      for (const linkKey of Object.keys(nextDraftLinkUrls)) {
        if (!editableLinkKeys.has(linkKey)) {
          delete nextDraftLinkUrls[linkKey];
          didChange = true;
        }
      }

      return didChange ? nextDraftLinkUrls : currentDraftLinkUrls;
    });
  }, [editableLinks]);

  useEffect(() => {
    setDraftLinkLocks((currentDraftLinkLocks) => {
      const nextDraftLinkLocks = { ...currentDraftLinkLocks };
      const editableLinkKeys = new Set(editableLinks.map((link) => link.key));
      let didChange = false;

      for (const link of editableLinks) {
        if (!(link.key in nextDraftLinkLocks)) {
          nextDraftLinkLocks[link.key] = link.locked === true;
          didChange = true;
        }
      }

      for (const linkKey of Object.keys(nextDraftLinkLocks)) {
        if (!editableLinkKeys.has(linkKey)) {
          delete nextDraftLinkLocks[linkKey];
          didChange = true;
        }
      }

      return didChange ? nextDraftLinkLocks : currentDraftLinkLocks;
    });
  }, [editableLinks]);

  useEffect(() => {
    if (
      profile.extraction.status !== "ready" ||
      !profile.extraction.updatedAt ||
      editableLinks.length === 0 ||
      lastAutoOpenedLinkReviewRef.current === profile.extraction.updatedAt
    ) {
      return;
    }

    lastAutoOpenedLinkReviewRef.current = profile.extraction.updatedAt;
    setIsLinkEditorOpen(true);
  }, [
    editableLinks.length,
    profile.extraction.status,
    profile.extraction.updatedAt,
  ]);

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
    latestDraftJobDescriptionRef.current = draftJobDescription;
  }, [draftJobDescription]);

  useEffect(() => {
    latestDraftLatexCodeRef.current = draftLatexCode;
  }, [draftLatexCode]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(pendingResume?.storagePath);
    };
  }, [pendingResume]);

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
      const submittedLatexCode = nextLatexCode;
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({ latexCode: submittedLatexCode }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        error?: string;
        savedLinkUpdateCount?: number;
        savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
        latexLinkSyncSummary?: TailorResumeLatexLinkSyncSummary | null;
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
      setDraftLinkLocks(buildLinkLockDrafts(payload.profile.links));
      setDraftLinkUrls(buildLinkUrlDrafts(payload.profile.links));

      if (pendingLatexCodeRef.current === resolvedLatexCode) {
        pendingLatexCodeRef.current = null;
      }

      if (latestDraftLatexCodeRef.current === resolvedLatexCode) {
        setIsSavingLatex(false);
        setLatexState("saved");
        toast.success("Saved the LaTeX draft.", {
          id: latexSaveToastId,
        });

        if ((payload.latexLinkSyncSummary?.addedCount ?? 0) > 0) {
          const addedLinks = payload.latexLinkSyncSummary?.addedLinks ?? [];
          const labels = addedLinks
            .map((link) => link.label)
            .filter((label, index, values) => values.indexOf(label) === index);
          const previewText = labels.slice(0, 3).join(", ");
          const remainingCount = labels.length - Math.min(labels.length, 3);

          toast(
            `Found ${addedLinks.length} new link${addedLinks.length === 1 ? "" : "s"} in the LaTeX.`,
            {
              description:
                labels.length > 0
                  ? `${previewText}${remainingCount > 0 ? `, and ${remainingCount} more.` : "."}`
                  : undefined,
              id: latexLinkSyncToastId,
            },
          );
        }

        showSavedLinkUpdateToast(
          payload.savedLinkUpdateCount,
          payload.savedLinkUpdates,
        );
      } else if (latestDraftLatexCodeRef.current === submittedLatexCode) {
        // The server normalized or reprocessed the saved LaTeX, but the user
        // has not typed anything newer since this request started. Accept the
        // server-returned document so we do not immediately resave forever.
        pendingLatexCodeRef.current = null;
        latestDraftLatexCodeRef.current = resolvedLatexCode;
        setDraftLatexCode(resolvedLatexCode);
        setIsSavingLatex(false);
        setLatexState("saved");
        toast.success("Saved the LaTeX draft.", {
          id: latexSaveToastId,
        });

        if ((payload.latexLinkSyncSummary?.addedCount ?? 0) > 0) {
          const addedLinks = payload.latexLinkSyncSummary?.addedLinks ?? [];
          const labels = addedLinks
            .map((link) => link.label)
            .filter((label, index, values) => values.indexOf(label) === index);
          const previewText = labels.slice(0, 3).join(", ");
          const remainingCount = labels.length - Math.min(labels.length, 3);

          toast(
            `Found ${addedLinks.length} new link${addedLinks.length === 1 ? "" : "s"} in the LaTeX.`,
            {
              description:
                labels.length > 0
                  ? `${previewText}${remainingCount > 0 ? `, and ${remainingCount} more.` : "."}`
                  : undefined,
              id: latexLinkSyncToastId,
            },
          );
        }

        showSavedLinkUpdateToast(
          payload.savedLinkUpdateCount,
          payload.savedLinkUpdates,
        );
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
        {
          id: latexSaveToastId,
        },
      );
    } finally {
      isLatexSaveInFlightRef.current = false;

      if (pendingLatexCodeRef.current) {
        void flushPendingLatexSave();
      }
    }
  }, []);

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

  useEffect(() => {
    if (!isLinkEditorOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsLinkEditorOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLinkEditorOpen]);

  async function uploadResume(file: File) {
    const validationError = validateResumeFile(file);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!openAIReady) {
      toast.error("Add OPENAI_API_KEY before generating resume LaTeX.");
      return;
    }

    setPendingResume(buildPendingResumeRecord(file));
    setIsUploadingResume(true);
    toast.loading("Uploading the resume and generating LaTeX...", {
      id: resumeUploadToastId,
    });

    try {
      const formData = new FormData();
      formData.append("resume", file);

      const response = await fetch("/api/tailor-resume", {
        body: formData,
        headers: {
          "x-tailor-resume-stream": "1",
        },
        method: "POST",
      });

      let payload: TailorResumeUploadResponsePayload;
      let streamedAttemptEvents = false;

      if (!response.ok) {
        payload = (await response.json()) as TailorResumeUploadResponsePayload;
      } else if (
        response.headers.get("content-type")?.includes("text/x-ndjson")
      ) {
        streamedAttemptEvents = true;
        payload = await readTailorResumeUploadStream(response, {
          onAttemptEvent: (attemptEvent) => {
            showExtractionAttemptToast(attemptEvent);
          },
        });
      } else {
        payload = (await response.json()) as TailorResumeUploadResponsePayload;
      }

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save the resume.");
      }

      const resolvedLatexCode = resolveSavedLatexCode(payload.profile);

      setProfile(payload.profile);
      onTailoredResumesChange?.(payload.profile.tailoredResumes);
      setPendingResume(null);
      setDraftLatexCode(resolvedLatexCode);
      setDraftLinkLocks(buildLinkLockDrafts(payload.profile.links));
      setDraftLinkUrls(buildLinkUrlDrafts(payload.profile.links));
      setIsLinkEditorOpen(hasActiveResumeLinks(payload.profile));
      lastSavedLatexCodeRef.current = resolvedLatexCode;
      latestDraftLatexCodeRef.current = resolvedLatexCode;
      if (!streamedAttemptEvents) {
        showExtractionAttemptToasts(payload.extractionAttempts ?? []);
      }
      showLinkValidationSummaryToast(
        payload.linkValidationSummary,
        payload.linkValidationLinks,
      );
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );

      if (payload.extractionError) {
        toast.error(
          `Saved the resume, but LaTeX generation needs review: ${payload.extractionError}`,
          {
            id: resumeUploadToastId,
          },
        );
      } else if (payload.profile.latex.status === "failed") {
        toast.error(
          "Saved the resume, but the generated LaTeX still needs a rendering fix before the preview can display.",
          {
            id: resumeUploadToastId,
          },
        );
      } else {
        toast.success("Saved the resume and opened the generated LaTeX draft.", {
          id: resumeUploadToastId,
        });
      }
    } catch (error) {
      setPendingResume(null);
      toast.error(
        error instanceof Error ? error.message : "Unable to save the resume.",
        {
          id: resumeUploadToastId,
        },
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

    if (!file || isUploadingResume) {
      return;
    }

    void uploadResume(file);
  }

  async function saveLinkUrls(links: TailorResumeLinkRecord[]) {
    const invalidLockedLinks = links.filter((link) => {
      const nextLocked = draftLinkLocks[link.key] ?? (link.locked === true);
      return nextLocked && !readEffectiveLinkUrl(link, draftLinkUrls[link.key]);
    });

    if (invalidLockedLinks.length > 0) {
      toast.error(
        `Enter a destination URL before locking ${invalidLockedLinks[0]?.label}.`,
        {
          id: resumeLinkSaveToastId,
        },
      );
      return;
    }

    const linkUpdates = [
      ...profile.links
        .filter((link) => pendingDeletedLinkKeySet.has(link.key))
        .map((link) => ({ key: link.key, locked: false, url: null })),
      ...links.flatMap((link) => {
        const nextLocked = draftLinkLocks[link.key] ?? (link.locked === true);
        const effectiveUrl = readEffectiveLinkUrl(link, draftLinkUrls[link.key]);
        const urlChanged = hasPersistableLinkUrlChange(
          link,
          draftLinkUrls[link.key],
        );
        const lockedChanged = hasLinkLockChanged(
          link,
          draftLinkLocks[link.key],
        );

        if (!urlChanged && !lockedChanged) {
          return [];
        }

        return [
          {
            key: link.key,
            locked: nextLocked,
            url: effectiveUrl,
          },
        ];
      }),
    ];

    if (linkUpdates.length === 0) {
      toast("No link changes to save yet.", {
        id: resumeLinkSaveToastId,
      });
      return;
    }

    setIsSavingLinks(true);
    toast.loading("Saving link changes and refreshing the preview...", {
      id: resumeLinkSaveToastId,
    });

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "saveLinksAndReextract",
          links: linkUpdates,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        error?: string;
        extractionError?: string | null;
        extractionAttempts?: TailorResumeExtractionAttempt[];
        linkValidationLinks?: TailorResumeLinkValidationEntry[] | null;
        linkValidationSummary?: TailorResumeLinkValidationSummary | null;
        profile?: TailorResumeProfile;
        savedLinkUpdateCount?: number;
        savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
      };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save the link changes.");
      }

      const resolvedLatexCode = resolveSavedLatexCode(payload.profile);
      const remainingUnresolvedLinks = readUnresolvedResumeLinks(payload.profile);

      setProfile(payload.profile);
      setPendingDeletedLinkKeys([]);
      setDraftLatexCode(resolvedLatexCode);
      setDraftLinkLocks(buildLinkLockDrafts(payload.profile.links));
      setDraftLinkUrls(buildLinkUrlDrafts(payload.profile.links));
      setIsLinkEditorOpen(hasActiveResumeLinks(payload.profile));
      lastSavedLatexCodeRef.current = resolvedLatexCode;
      latestDraftLatexCodeRef.current = resolvedLatexCode;
      showExtractionAttemptToasts(payload.extractionAttempts ?? []);
      showLinkValidationSummaryToast(
        payload.linkValidationSummary,
        payload.linkValidationLinks,
        (payload.extractionAttempts?.length ?? 0) * 140,
      );
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );

      if (payload.extractionError) {
        toast.error(
          `Saved the link changes, but LaTeX generation still needs review: ${payload.extractionError}`,
          {
            id: resumeLinkSaveToastId,
          },
        );
      } else if (payload.profile.latex.status === "failed") {
        toast.error(
          "Saved the link changes, but the updated LaTeX still needs a rendering fix before the preview can display.",
          {
            id: resumeLinkSaveToastId,
          },
        );
      } else if (remainingUnresolvedLinks.length > 0) {
        toast.success(
          `Saved ${linkUpdates.length} link change${linkUpdates.length === 1 ? "" : "s"}. ${remainingUnresolvedLinks.length} destination${remainingUnresolvedLinks.length === 1 ? "" : "s"} still need${remainingUnresolvedLinks.length === 1 ? "s" : ""} review.`,
          {
            id: resumeLinkSaveToastId,
          },
        );
      } else {
        toast.success("Saved the link changes and updated the LaTeX draft.", {
          id: resumeLinkSaveToastId,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save the link changes.",
        {
          id: resumeLinkSaveToastId,
        },
      );
    } finally {
      setIsSavingLinks(false);
    }
  }

  async function setBaseResumeStepComplete(nextValue: boolean) {
    if (!resume || isUpdatingBaseResumeStep) {
      return;
    }

    setIsUpdatingBaseResumeStep(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          baseResumeStepComplete: nextValue,
        }),
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
        throw new Error(payload.error ?? "Unable to update the resume step.");
      }

      setProfile(payload.profile);

      if (nextValue) {
        toast.success("Step 1 marked complete. You can tailor for a job below.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update the resume step.",
      );
    } finally {
      setIsUpdatingBaseResumeStep(false);
    }
  }

  function handleJobDescriptionChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setDraftJobDescription(nextValue);

    if (nextValue === lastSavedJobDescriptionRef.current) {
      setJobDescriptionState(nextValue.trim().length > 0 ? "saved" : "idle");
      return;
    }

    setJobDescriptionState("dirty");
  }

  async function saveJobDescription() {
    if (isJobDescriptionLocked) {
      return;
    }

    if (!hasUnsavedJobDescriptionChanges) {
      toast("No job description changes to save yet.", {
        id: jobDescriptionToastId,
      });
      return;
    }

    const sequence = jobDescriptionSaveSequenceRef.current + 1;
    jobDescriptionSaveSequenceRef.current = sequence;
    setIsSavingJobDescription(true);
    setJobDescriptionState("saving");

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          jobDescription: latestDraftJobDescriptionRef.current,
        }),
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
      setJobDescriptionState(
        latestDraftJobDescriptionRef.current === payload.profile.jobDescription
          ? payload.profile.jobDescription.trim().length > 0
            ? "saved"
            : "idle"
          : "dirty",
      );
      toast.success("Saved the job description.", {
        id: jobDescriptionToastId,
      });
    } catch (error) {
      if (jobDescriptionSaveSequenceRef.current !== sequence) {
        return;
      }

      setIsSavingJobDescription(false);
      setJobDescriptionState(
        latestDraftJobDescriptionRef.current === lastSavedJobDescriptionRef.current
          ? latestDraftJobDescriptionRef.current.trim().length > 0
            ? "saved"
            : "idle"
          : "dirty",
      );
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save the job description.",
        {
          id: jobDescriptionToastId,
        },
      );
    }
  }

  async function tailorResume() {
    if (!openAIReady) {
      toast.error("Add OPENAI_API_KEY before tailoring the resume.");
      return;
    }

    if (!profile.latex.code.trim()) {
      toast.error("Upload or save a resume before tailoring it.");
      return;
    }

    if (!draftJobDescription.trim()) {
      toast.error("Paste a job description before tailoring the resume.");
      return;
    }

    setIsTailoringResume(true);
    toast.loading("Tailoring a job-specific LaTeX resume...", {
      id: "tailor-resume-run",
    });

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "tailor",
          jobDescription: draftJobDescription,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        error?: string;
        profile?: TailorResumeProfile;
        savedLinkUpdateCount?: number;
        savedLinkUpdates?: TailorResumeSavedLinkUpdate[];
        tailoredResumeError?: string | null;
      };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to tailor the resume.");
      }

      setProfile(payload.profile);
      lastSavedJobDescriptionRef.current = payload.profile.jobDescription;
      onTailoredResumesChange?.(payload.profile.tailoredResumes);
      setJobDescriptionState(
        latestDraftJobDescriptionRef.current === payload.profile.jobDescription
          ? payload.profile.jobDescription.trim().length > 0
            ? "saved"
            : "idle"
          : "dirty",
      );
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );

      if (payload.tailoredResumeError) {
        toast.error(
          `Saved a tailored draft, but it still needs review: ${payload.tailoredResumeError}`,
          {
            id: "tailor-resume-run",
          },
        );
      } else {
        toast.success("Saved a job-specific tailored resume. Find it in History.", {
          id: "tailor-resume-run",
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to tailor the resume.",
        {
          id: "tailor-resume-run",
        },
      );
    } finally {
      setIsTailoringResume(false);
    }
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
      className="flex h-full min-w-0 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 xl:min-h-[560px]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          {debugUiEnabled && activeLatexView === "annotated"
            ? "Annotated LaTeX"
            : "LaTeX Source"}
        </p>
        {debugUiEnabled ? (
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 p-1">
            <button
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
                activeLatexView === "source"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveLatexView("source")}
              type="button"
            >
              Source
            </button>
            <button
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
                activeLatexView === "annotated"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveLatexView("annotated")}
              type="button"
            >
              Annotated
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="relative flex min-h-[640px] flex-1 overflow-hidden rounded-[1.25rem]"
      >
        {showEditorLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-black/20" />
        ) : null}

        <div className="relative z-10 flex min-h-[640px] flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate">
          {displayedLatexCode.trim().length > 0 || resume ? (
            <textarea
              className={`min-h-[600px] w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none placeholder:text-zinc-500 transition ${
                editorDisabled
                  ? "cursor-not-allowed text-zinc-500 opacity-35"
                  : "text-zinc-100"
              }`}
              disabled={editorDisabled}
              onChange={(event) => setDraftLatexCode(event.target.value)}
              readOnly={activeLatexView === "annotated"}
              spellCheck={false}
              value={displayedLatexCode}
            />
          ) : (
            <div
              aria-hidden="true"
              className="min-h-[600px] flex-1 rounded-[1.25rem]"
            />
          )}

          {showEditorLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/65 px-6 backdrop-blur-[2px]">
              <div className="rounded-full border border-white/12 bg-black/42 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-emerald-300" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );

  const previewPanelContent = (
    <section
      aria-busy={showPreviewLoadingOverlay}
      className="flex h-full min-w-0 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 xl:min-h-[560px]"
    >
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Preview
        </p>
      </div>

      <div
        className="relative flex min-h-[500px] flex-1 overflow-hidden rounded-[1.25rem]"
      >
        {showPreviewLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-black/20" />
        ) : null}

        <div className="relative z-10 flex min-h-[500px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate">
          {previewErrorMessage ? (
            <div className="h-full w-full overflow-auto rounded-[1.25rem] bg-rose-950/70 p-5 text-sm leading-6 text-rose-100">
              <p className="font-medium text-rose-50">
                The current LaTeX draft did not render cleanly.
              </p>
              <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-6 text-rose-100/90">
                {previewErrorMessage}
              </pre>
            </div>
          ) : previewPdfUrl ? (
            <div className="h-full min-h-[500px] w-full rounded-[1.25rem]">
              <iframe
                className="relative z-0 h-full min-h-[500px] w-full rounded-[1.25rem] bg-white"
                onLoad={() => setIsPreviewFrameLoading(false)}
                src={previewPdfUrl}
                title="Compiled resume preview"
              />
            </div>
          ) : (
            <div aria-hidden="true" className="h-full w-full rounded-[1.25rem]" />
          )}

          {showPreviewLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/14 backdrop-blur-[0.5px]">
              <div className="relative z-30 rounded-full border border-white/12 bg-black/42 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-100/25 border-t-emerald-100" />
              </div>
            </div>
          ) : null}
        </div>
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
          <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-5 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Step 1
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Review the base resume
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Start in the split-screen editor, confirm the LaTeX and preview
                look right, then mark this step complete to collapse it before
                tailoring for a specific job.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill>
                {isUpdatingBaseResumeStep
                  ? "Updating..."
                  : isBaseResumeStepComplete
                    ? "Completed"
                    : isSavingLatex
                      ? "Saving edits..."
                      : latexState === "saved"
                        ? "Ready"
                        : "In progress"}
              </StatusPill>
              {hasEditableOrPendingLinks ? (
                <button
                  aria-label={`Review links. ${visibleLinkCount} link${visibleLinkCount === 1 ? "" : "s"} currently listed.`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                  onClick={() => setIsLinkEditorOpen(true)}
                  type="button"
                >
                  <span>Review links</span>
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-emerald-200">
                    {visibleLinkCount}
                  </span>
                </button>
              ) : null}

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

              <button
                className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.2em] transition ${
                  isUpdatingBaseResumeStep
                    ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                    : isBaseResumeStepComplete
                      ? "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                      : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                }`}
                disabled={isUpdatingBaseResumeStep}
                onClick={() =>
                  void setBaseResumeStepComplete(!isBaseResumeStepComplete)
                }
                type="button"
              >
                {isUpdatingBaseResumeStep
                  ? "Updating..."
                  : isBaseResumeStepComplete
                    ? "Edit again"
                    : "Mark complete"}
              </button>
            </div>
          </div>

          {isBaseResumeStepComplete ? (
            <div className="border-t border-white/8 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
              <div className="rounded-[1.25rem] border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-medium text-zinc-100">
                  Base resume locked in for tailoring.
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Reopen this step any time if you want to keep editing the
                  LaTeX, review links, or replace the uploaded source file.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  <span>{resume.originalFilename}</span>
                  {debugUiEnabled ? (
                    <span>{profile.annotatedLatex.segmentCount} annotated segments</span>
                  ) : null}
                  <span>
                    {profile.latex.status === "ready"
                      ? "Preview ready"
                      : "Preview needs review"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
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
          )}
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
                Step 1
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Upload and review your base resume
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
                  Step 2
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                  Paste the job description
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                  Submitting this creates a separate tailored resume with saved
                  company, role, and job-specific identifier metadata.
                </p>
                {isJobDescriptionLocked ? (
                  <p className="mt-3 rounded-[1rem] border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-zinc-400">
                    Mark step 1 complete to unlock job descriptions and resume tailoring.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>
                  {isJobDescriptionLocked
                    ? "Step 1 required"
                    : isSavingJobDescription
                    ? "Saving..."
                    : jobDescriptionState === "saved"
                      ? "Draft saved"
                      : jobDescriptionState === "dirty"
                        ? "Unsaved changes"
                        : "Draft idle"}
                </StatusPill>
                <button
                  className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    isJobDescriptionLocked ||
                    isSavingJobDescription ||
                    !hasUnsavedJobDescriptionChanges
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                      : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                  }`}
                  disabled={
                    isJobDescriptionLocked ||
                    isSavingJobDescription ||
                    !hasUnsavedJobDescriptionChanges
                  }
                  onClick={() => void saveJobDescription()}
                  type="button"
                >
                  {isSavingJobDescription ? "Saving..." : "Save description"}
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    !openAIReady ||
                    isTailoringResume ||
                    isJobDescriptionLocked ||
                    draftJobDescription.trim().length === 0
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                      : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                  }`}
                  disabled={
                    !openAIReady ||
                    isTailoringResume ||
                    isJobDescriptionLocked ||
                    draftJobDescription.trim().length === 0
                  }
                  onClick={() => void tailorResume()}
                  type="button"
                >
                  {isTailoringResume
                    ? "Creating..."
                    : "Create tailored resume"}
                </button>
              </div>
            </div>

            <textarea
              className={`mt-5 min-h-[180px] w-full flex-1 resize-none rounded-[1.25rem] border px-4 py-4 text-sm leading-6 outline-none transition placeholder:text-zinc-500 ${
                isJobDescriptionLocked
                  ? "cursor-not-allowed border-white/8 bg-black/10 text-zinc-500"
                  : "border-white/10 bg-black/20 text-zinc-100 focus:border-emerald-300/45"
              }`}
              disabled={isJobDescriptionLocked}
              onChange={handleJobDescriptionChange}
              placeholder={
                isJobDescriptionLocked
                  ? "Complete step 1 to unlock the job description field."
                  : "Paste job-description snippets here from as many sources as you need, then save or create the tailored resume."
              }
              value={draftJobDescription}
            />
          </section>
        </>
      ) : null}

      {isPreviewMounted && isPreviewOpen && displayedResume
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
                href={displayedResume.storagePath}
                rel="noreferrer"
                target="_blank"
              >
                Open in new tab
              </a>

              <div className="flex h-full w-full items-center justify-center p-4 pt-20">
                {previewAsImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={displayedResume.originalFilename}
                    className="max-h-full max-w-full rounded-[1rem] object-contain shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
                    src={displayedResume.storagePath}
                  />
                ) : (
                  <iframe
                    className="h-full w-full rounded-[1rem] border border-white/10 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
                    src={displayedResume.storagePath}
                    title={displayedResume.originalFilename}
                  />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {isPreviewMounted && isLinkEditorOpen && hasEditableOrPendingLinks
        ? createPortal(
            <div className="fixed inset-0 z-[190] flex bg-black/82 px-4 py-6 backdrop-blur-sm sm:px-6">
              <button
                aria-label="Close link review"
                className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/60"
                onClick={() => setIsLinkEditorOpen(false)}
                type="button"
              >
                Close
              </button>

              <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center">
                <section className="glass-panel soft-ring flex max-h-full w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl">
                  <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                          Resume links
                        </p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                          Review and edit the generated link URLs
                        </h2>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                          OpenAI currently has {visibleLinkCount} link
                          {visibleLinkCount === 1 ? "" : "s"} in this draft
                          ready for review.
                          {queuedRemovalCount > 0
                            ? ` ${queuedRemovalCount} link${queuedRemovalCount === 1 ? "" : "s"} ${queuedRemovalCount === 1 ? "is" : "are"} queued for removal.`
                            : ""}
                          {" "}You can change any destination here, even if it
                          already passed validation, and we&apos;ll save it on
                          this resume for future extractions.
                        </p>
                      </div>

                      <StatusPill>
                        {isSavingLinks
                          ? "Saving..."
                          : unresolvedLinks.length > 0
                            ? `${unresolvedLinks.length} need review`
                            : `${visibleLinkCount} found`}
                      </StatusPill>
                    </div>
                  </div>

                  <form
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveLinkUrls(editableLinks);
                    }}
                  >
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                      <div className="grid gap-3">
                        {editableLinks.length > 0 ? (
                          <div className="hidden grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)_auto] items-center gap-3 px-4 text-[10px] uppercase tracking-[0.22em] text-zinc-500 sm:grid">
                            <span>Link text</span>
                            <span>Destination URL</span>
                            <span aria-hidden="true" />
                          </div>
                        ) : null}
                        {editableLinks.map((link) => (
                          <div
                            className="grid gap-3 rounded-[1.1rem] border border-white/10 bg-black/20 p-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)_auto] sm:items-center"
                            key={link.key}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-zinc-100 sm:whitespace-normal sm:break-words">
                                {link.label}
                              </div>
                            </div>

                            <label
                              className="min-w-0"
                              htmlFor={`tailor-resume-link-${link.key}`}
                            >
                              <span className="sr-only">{`${link.label} destination URL`}</span>
                              <input
                                className="w-full rounded-[0.95rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
                                disabled={isSavingLinks}
                                id={`tailor-resume-link-${link.key}`}
                                onChange={(event) =>
                                  setDraftLinkUrls((currentDraftLinkUrls) => ({
                                    ...currentDraftLinkUrls,
                                    [link.key]: event.target.value,
                                  }))
                                }
                                placeholder="https://example.com/your-link"
                                spellCheck={false}
                                value={draftLinkUrls[link.key] ?? ""}
                              />
                            </label>

                            <div className="flex items-center justify-self-end gap-1 self-center">
                              <button
                                className={`rounded-full p-1.5 transition disabled:cursor-not-allowed ${
                                  (draftLinkLocks[link.key] ?? (link.locked === true))
                                    ? "text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
                                    : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                                } disabled:text-zinc-600`}
                                disabled={
                                  isSavingLinks ||
                                  !canLockLink(link, draftLinkUrls[link.key])
                                }
                                onClick={() =>
                                  setDraftLinkLocks((currentDraftLinkLocks) => ({
                                    ...currentDraftLinkLocks,
                                    [link.key]: !(
                                      currentDraftLinkLocks[link.key] ??
                                      (link.locked === true)
                                    ),
                                  }))
                                }
                                title={
                                  (draftLinkLocks[link.key] ?? (link.locked === true))
                                    ? "Unlock saved text-to-link preference"
                                    : "Lock this text to this destination"
                                }
                                type="button"
                              >
                                {(draftLinkLocks[link.key] ?? (link.locked === true)) ? (
                                  <Lock aria-hidden="true" className="h-4 w-4" />
                                ) : (
                                  <LockOpen aria-hidden="true" className="h-4 w-4" />
                                )}
                                <span className="sr-only">
                                  {(draftLinkLocks[link.key] ?? (link.locked === true))
                                    ? "Unlock link preference"
                                    : "Lock link preference"}
                                </span>
                              </button>

                              <button
                                className="rounded-full p-1.5 text-rose-300 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-zinc-600"
                                disabled={isSavingLinks}
                                onClick={() =>
                                  setPendingDeletedLinkKeys((currentKeys) =>
                                    currentKeys.includes(link.key)
                                      ? currentKeys
                                      : [...currentKeys, link.key],
                                  )
                                }
                                title="Delete link"
                                type="button"
                              >
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                                <span className="sr-only">Delete link</span>
                              </button>
                            </div>
                          </div>
                        ))}
                        {visibleLinkCount === 0 ? (
                          <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-black/20 p-6 text-sm leading-6 text-zinc-400">
                            All generated links in this draft are currently queued for removal. Save to apply the LaTeX cleanup.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/5 px-5 py-4 sm:px-6">
                      <p className="text-xs leading-5 text-zinc-500">
                        Blank fields stay unresolved. Changed URLs are saved to
                        this resume and reused the next time we regenerate it.
                        Saving refreshes the preview from the stored link
                        preferences, with no model call. Deleted links keep the
                        visible text and only strip the hyperlink styling.
                        Locked links are reapplied when the same text appears in
                        the source LaTeX or a future upload.
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                          onClick={() => setIsLinkEditorOpen(false)}
                          type="button"
                        >
                          Close
                        </button>
                        <button
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                            isSavingLinks || !hasLinkEdits
                              ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                              : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                          }`}
                          disabled={isSavingLinks || !hasLinkEdits}
                          type="submit"
                        >
                          {isSavingLinks ? "Saving..." : "Save link changes"}
                        </button>
                      </div>
                    </div>
                  </form>
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
