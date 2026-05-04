"use client";

import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import SourceResumeConfigChat from "@/components/source-resume-config-chat";
import SourceResumeDiffEditor from "@/components/source-resume-diff-editor";
import {
  TailorResumeProgressModal,
  TailorResumeProgressToast,
  type TailorResumeGenerationProgressNotification,
  type TailorResumeGenerationProgressStep,
} from "@/components/tailor-resume-generation-progress";
import TailoredResumeInteractivePreview from "@/components/tailored-resume-interactive-preview";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream,
  readTailorResumeUploadStream,
} from "@/lib/tailor-resume-client-stream";
import type {
  TailorResumeExtractionAttempt,
  TailorResumeRunResponsePayload,
  TailorResumeUploadResponsePayload,
} from "@/lib/tailor-resume-client-payloads";
import { formatTailorResumeLatexError } from "@/lib/tailor-resume-error-format";
import { normalizeTailorResumeLinkUrl } from "@/lib/tailor-resume-links";
import type {
  TailorResumeLinkValidationEntry,
  TailorResumeLinkValidationSummary,
} from "@/lib/tailor-resume-link-validation";
import {
  formatTailorResumeRetryLabel,
  readTailorResumeDisplayAttempt,
} from "@/lib/tailor-resume-step-display";
import type { TailorResumeInterviewStreamEvent } from "@/lib/tailor-resume-interview-stream-parser";
import type {
  SavedResumeRecord,
  TailorResumeConversationMessage,
  TailorResumeGenerationStepEvent,
  TailorResumeLinkRecord,
  TailorResumeProfile,
  TailorResumeSavedLinkUpdate,
  TailorResumeTechnologyContext,
} from "@/lib/tailor-resume-types";
import type { TailorResumeUserMarkdownState } from "@/lib/tailor-resume-user-memory";

type TailorResumeWorkspaceProps = {
  debugUiEnabled: boolean;
  initialProfile: TailorResumeProfile;
  linkReviewUiEnabled?: boolean;
  onReviewTailoredResume?: (tailoredResumeId: string) => void;
  onSourceResumeEditRequestHandled?: () => void;
  onTailoredResumesChange?: (
    tailoredResumes: TailorResumeProfile["tailoredResumes"],
  ) => void;
  onUserMarkdownChange?: (userMarkdown: TailorResumeUserMarkdownState) => void;
  openAIReady: boolean;
  sourceOnly?: boolean;
  sourceResumeEditRequestKey?: number;
};

type TailorResumeStepId = "base" | "job";

type TailorResumeLatexLinkSyncSummary = {
  addedCount: number;
  addedLinks: Array<{
    key: string;
    label: string;
    url: string | null;
  }>;
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
const tailorResumeRunToastId = "tailor-resume-run";
const resumeUploadToastId = "tailor-resume-resume-upload";
const savedLinkUpdateToastId = "tailor-resume-saved-link-updates";
const tailorResumeClickableToastClassNames = {
  content: "min-w-0 flex-1 cursor-pointer",
  title: "min-w-0 w-full cursor-pointer",
  toast: "cursor-pointer",
};
const failedLinkToastDurationMs = 5 * 60 * 1_000;
const tailorResumeGenerationStepLabels = [
  {
    label: "Scrape keywords",
    stepNumber: 1,
  },
  {
    label: "Clarify missing details",
    stepNumber: 2,
  },
  {
    label: "Plan targeted edits",
    stepNumber: 3,
  },
  {
    label: "Apply block-level resume changes",
    stepNumber: 4,
  },
  {
    label: "Keep the original page count",
    stepNumber: 5,
  },
] as const;

type TailorResumeGenerationProgressState = {
  latestNotification: TailorResumeGenerationProgressNotification;
  steps: TailorResumeGenerationProgressStep[];
};

function createTailorResumeProgressState(input?: {
  activeStepNumber?: number;
  completedStepNumbers?: number[];
  detail?: string;
}): TailorResumeGenerationProgressState {
  const completedStepNumberSet = new Set(input?.completedStepNumbers ?? []);
  const activeStepNumber = Math.min(
    tailorResumeGenerationStepLabels.length,
    Math.max(1, input?.activeStepNumber ?? 1),
  );

  return {
    latestNotification: {
      detail:
        input?.detail ??
        "Tracking the latest update from the 5-step generation flow.",
      title: "Generating resume...",
      tone: "info" as const,
    },
    steps: tailorResumeGenerationStepLabels.map(
      (step): TailorResumeGenerationProgressStep => ({
        attempt: null,
        detail: null,
        label: step.label,
        stepNumber: step.stepNumber,
        status: completedStepNumberSet.has(step.stepNumber)
          ? "succeeded"
          : step.stepNumber === activeStepNumber
            ? "current"
            : "pending",
      }),
    ),
  };
}

function formatElapsedDuration(durationMs: number | null | undefined) {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1_000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildTailorResumeProgressNotification(
  event: TailorResumeGenerationStepEvent,
): TailorResumeGenerationProgressNotification {
  const displayAttempt = readTailorResumeDisplayAttempt(event);

  if (event.status === "running") {
    if (event.retrying) {
      return {
        detail: event.detail,
        title:
          `Step ${event.stepNumber}: ${event.summary} - ` +
          formatTailorResumeRetryLabel(displayAttempt),
        tone: "info",
      };
    }

    return {
      detail: event.detail,
      title: `Step ${event.stepNumber} is running: ${event.summary}`,
      tone: "info",
    };
  }

  if (event.status === "failed" && event.retrying) {
    return {
      detail:
        event.detail ??
        `Attempt ${event.attempt ?? 1} failed, so this step started another pass automatically.`,
      title:
        `Step ${event.stepNumber}: ${event.summary} - ` +
        formatTailorResumeRetryLabel(displayAttempt),
      tone: "error",
    };
  }

  if (event.status === "failed") {
    return {
      detail: event.detail,
      title: `Step ${event.stepNumber} failed: ${event.summary}`,
      tone: "error",
    };
  }

  if (event.status === "succeeded") {
    return {
      detail: event.detail,
      title: `Step ${event.stepNumber} finished: ${event.summary}`,
      tone: "success",
    };
  }

  return {
    detail: event.detail,
    title: `Step ${event.stepNumber} skipped: ${event.summary}`,
    tone: "info",
  };
}

function applyTailorResumeStepEventToProgressState(
  currentState: TailorResumeGenerationProgressState,
  event: TailorResumeGenerationStepEvent,
): TailorResumeGenerationProgressState {
  const displayAttempt = readTailorResumeDisplayAttempt(event);
  const nextActiveStepNumber =
    event.status === "running"
      ? event.stepNumber
      : event.status === "failed"
        ? event.retrying
          ? event.stepNumber
          : null
        : event.stepNumber < event.stepCount
          ? event.stepNumber + 1
          : null;

  return {
    latestNotification: buildTailorResumeProgressNotification(event),
    steps: currentState.steps.map((step): TailorResumeGenerationProgressStep => {
      if (step.stepNumber < event.stepNumber) {
        return step;
      }

      if (step.stepNumber === event.stepNumber) {
        return {
          ...step,
          attempt: displayAttempt,
          detail: event.detail,
          status:
            event.status === "running"
              ? event.retrying
                ? "retrying"
                : "current"
              : event.status === "failed"
              ? event.retrying
                ? "retrying"
                : "failed"
              : event.status,
        };
      }

      return {
        ...step,
        status: nextActiveStepNumber === step.stepNumber ? "current" : "pending",
      };
    }),
  };
}

function resolveElapsedDurationMs(
  serverDurationMs: number | null | undefined,
  startedAt: number,
) {
  if (
    typeof serverDurationMs === "number" &&
    Number.isFinite(serverDurationMs) &&
    serverDurationMs >= 0
  ) {
    return serverDurationMs;
  }

  return Math.max(0, performance.now() - startedAt);
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

function buildInlineLatexError(error: string) {
  const formattedError = formatTailorResumeLatexError(error, {
    maxChars: 220,
    singleLine: true,
  });

  return formattedError.displayMessage || "Unable to compile the LaTeX preview.";
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
    const failedLinkCount = attempt.linkSummary?.failedCount ?? 0;
    const errorSuffix = failedLinkCount > 0
      ? ` ${failedLinkCount} link${failedLinkCount === 1 ? "" : "s"} failed validation.`
      : attempt.error
        ? ` ${attempt.error}`
        : "";
    toast.error(
      attempt.willRetry
        ? `LaTeX generation attempt ${attempt.attempt} failed, so we retried it automatically.${errorSuffix}`
        : `LaTeX generation attempt ${attempt.attempt} failed and no retries remain.${errorSuffix}`,
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
  if (!linkSummary || linkSummary.failedCount === 0) {
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
    const failedLinks = groupedLinks.filter((link) => link.outcome === "failed");
    const unverifiedLinks = groupedLinks.filter((link) => link.outcome === "unverified");
    const notPassedLinks = [...failedLinks, ...unverifiedLinks];
    const unverifiedFragment =
      linkSummary.unverifiedCount > 0
        ? `, ${linkSummary.unverifiedCount} unverified`
        : "";
    const message =
      `${linkSummary.failedCount} link${linkSummary.failedCount === 1 ? "" : "s"} failed validation${unverifiedFragment}.`;
    const description = (
      <ul className="space-y-1 text-left text-xs text-zinc-300">
        {notPassedLinks.map((link) => (
          <li
            key={`${link.outcome}:${link.url}:${link.reason ?? ""}`}
            className="break-all"
          >
            {link.url}
            {link.count > 1 ? ` (${link.count}x)` : ""}
            {link.reason ? `: ${link.reason}` : ""}
            {link.outcome === "unverified" ? " (unverified)" : ""}
          </li>
        ))}
      </ul>
    );

    toast.error(message, {
      description,
      duration: failedLinkToastDurationMs,
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

function ChatThinkingDots({ label = "Assistant is thinking" }: { label?: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex min-h-5 w-max items-center gap-1.5"
      role="status"
    >
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-260ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-130ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function TailorResumeToolCallDetails({
  toolCalls,
}: {
  toolCalls: TailorResumeConversationMessage["toolCalls"];
}) {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <details className="mt-3 rounded-[0.95rem] border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
      <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        See toolcalls ({toolCalls.length})
      </summary>
      <div className="mt-3 space-y-3">
        {toolCalls.map((toolCall, index) => (
          <div
            className="rounded-[0.85rem] border border-white/10 bg-black/25 p-3"
            key={`${toolCall.name}:${String(index)}`}
          >
            <p className="font-mono text-[11px] text-emerald-200">
              {toolCall.name}
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
              {toolCall.argumentsText}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function TailorResumeTechnologyContexts({
  contexts,
  messageId,
  openContextKey,
  setOpenContextKey,
}: {
  contexts?: TailorResumeConversationMessage["technologyContexts"];
  messageId: string;
  openContextKey: string | null;
  setOpenContextKey: Dispatch<SetStateAction<string | null>>;
}) {
  if (!contexts || contexts.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-1.5">
      {contexts.map((context, index) => {
        const contextKey = `${messageId}:${context.name}:${String(index)}`;

        return (
          <details
            className="overflow-hidden rounded-lg border border-slate-500/70 bg-[#181c25] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            key={contextKey}
            onToggle={(event) => {
              if (event.currentTarget.open) {
                setOpenContextKey(contextKey);
                return;
              }

              setOpenContextKey((currentContextKey) =>
                currentContextKey === contextKey ? null : currentContextKey,
              );
            }}
            open={openContextKey === contextKey}
          >
            <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 text-xs [&::-webkit-details-marker]:hidden">
              <span className="truncate font-semibold text-zinc-100">
                {context.name}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">
                {context.examples.length}{" "}
                {context.examples.length === 1 ? "example" : "examples"}
              </span>
            </summary>
            <div className="grid gap-1.5 border-t border-slate-600/80 px-2.5 pb-2 pt-1.5 text-xs leading-5 text-slate-200">
              <p>{context.definition}</p>
              <ul className="grid list-disc gap-1 pl-4">
                {context.examples.map((example, exampleIndex) => (
                  <li key={`${context.name}:${String(exampleIndex)}`}>
                    {example}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function resolveInitialOpenTailorResumeStep(
  profile: TailorResumeProfile,
): TailorResumeStepId {
  return profile.resume && profile.workspace.isBaseResumeStepComplete
    ? "job"
    : "base";
}

export default function TailorResumeWorkspace({
  debugUiEnabled,
  initialProfile,
  linkReviewUiEnabled = false,
  onReviewTailoredResume,
  onSourceResumeEditRequestHandled,
  onTailoredResumesChange,
  onUserMarkdownChange,
  openAIReady,
  sourceOnly = false,
  sourceResumeEditRequestKey = 0,
}: TailorResumeWorkspaceProps) {
  const fileInputId = useId();
  const jobDescriptionExtensionNudgeDescriptionId = useId();
  const jobDescriptionExtensionNudgeTitleId = useId();
  const tailorInterviewFinishDescriptionId = useId();
  const tailorInterviewFinishTitleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobDescriptionSaveSequenceRef = useRef(0);
  const latexSaveSequenceRef = useRef(0);
  const lastSavedJobDescriptionRef = useRef(initialProfile.jobDescription);
  const latestDraftJobDescriptionRef = useRef(initialProfile.jobDescription);
  const lastSavedLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const latestDraftLatexCodeRef = useRef(resolveSavedLatexCode(initialProfile));
  const pendingLatexCodeRef = useRef<string | null>(null);
  const isLatexSaveInFlightRef = useRef(false);
  const isTailorInterviewSubmitInFlightRef = useRef(false);
  const hasShownJobDescriptionExtensionNudgeRef = useRef(false);
  const lastAutoOpenedLinkReviewRef = useRef(initialProfile.extraction.updatedAt);
  const lastHandledSourceResumeEditRequestKeyRef = useRef(0);
  const lastSeenTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const dismissedTailorInterviewFinishRequestRef = useRef<string | null>(null);
  const tailorInterviewMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const workspaceLayoutRef = useRef<HTMLElement | null>(null);
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
  const [
    isJobDescriptionExtensionNudgeOpen,
    setIsJobDescriptionExtensionNudgeOpen,
  ] = useState(false);
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewFrameLoading, setIsPreviewFrameLoading] = useState(false);
  const handlePreviewRenderSettled = useCallback(() => {
    setIsPreviewFrameLoading(false);
  }, []);
  const draftPreviewRequestSequenceRef = useRef(0);
  const draftPreviewObjectUrlRef = useRef<string | null>(null);
  const [draftPreviewPageCount, setDraftPreviewPageCount] = useState<number | null>(
    null,
  );
  const [draftPreviewPdfUrl, setDraftPreviewPdfUrl] = useState<string | null>(null);
  const [draftPreviewError, setDraftPreviewError] = useState<ReturnType<
    typeof formatTailorResumeLatexError
  > | null>(null);
  const [isRefreshingDraftPreview, setIsRefreshingDraftPreview] = useState(false);
  const [isSavingJobDescription, setIsSavingJobDescription] = useState(false);
  const [isSavingLatex, setIsSavingLatex] = useState(false);
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [isTailorInterviewOpen, setIsTailorInterviewOpen] = useState(false);
  const [isTailorInterviewFinishPromptOpen, setIsTailorInterviewFinishPromptOpen] =
    useState(false);
  const [isTailorResumeProgressOpen, setIsTailorResumeProgressOpen] = useState(false);
  const [
    openTailorInterviewTechnologyContextKey,
    setOpenTailorInterviewTechnologyContextKey,
  ] = useState<string | null>(null);
  const [isCancellingTailorInterview, setIsCancellingTailorInterview] =
    useState(false);
  const [isSubmittingTailorInterviewAnswer, setIsSubmittingTailorInterviewAnswer] =
    useState(false);
  const [isFinishingTailorInterview, setIsFinishingTailorInterview] =
    useState(false);
  const [isTailoringResume, setIsTailoringResume] = useState(false);
  const [isUpdatingBaseResumeStep, setIsUpdatingBaseResumeStep] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [compactResumePane, setCompactResumePane] = useState<
    "latex" | "rendered"
  >("latex");
  const [openTailorResumeStep, setOpenTailorResumeStep] =
    useState<TailorResumeStepId | null>(() =>
      sourceOnly ? "base" : resolveInitialOpenTailorResumeStep(initialProfile),
    );
  const [activeLatexView, setActiveLatexView] = useState<"annotated" | "source">(
    "source",
  );
  const [draftLinkLocks, setDraftLinkLocks] = useState<Record<string, boolean>>({});
  const [draftLinkUrls, setDraftLinkUrls] = useState<Record<string, string>>({});
  const [jobDescriptionState, setJobDescriptionState] = useState<
    "dirty" | "idle" | "saved" | "saving"
  >("idle");
  const [latexState, setLatexState] = useState<
    "dirty" | "idle" | "saved" | "saving"
  >("idle");
  const [tailorResumeGenerationProgress, setTailorResumeGenerationProgress] =
    useState<TailorResumeGenerationProgressState>(() =>
      createTailorResumeProgressState(),
    );
  const [draftTailorInterviewAnswer, setDraftTailorInterviewAnswer] = useState("");
  const [pendingTailorInterviewAnswerMessage, setPendingTailorInterviewAnswerMessage] =
    useState<TailorResumeConversationMessage | null>(null);
  const [streamingInterviewMessage, setStreamingInterviewMessage] = useState<
    { cards: TailorResumeTechnologyContext[]; text: string } | null
  >(null);

  const resume = profile.resume;
  const tailoringInterview = profile.workspace.tailoringInterview;
  const tailoringInterviewSummary =
    tailoringInterview?.planningResult.questioningSummary ?? null;
  const hasTailoringInterview = tailoringInterview !== null;
  const isTailorInterviewAwaitingCompletion = Boolean(
    tailoringInterview?.completionRequestedAt,
  );
  const tailorInterviewFinishRequestKey =
    tailoringInterview?.completionRequestedAt
      ? `${tailoringInterview.id}:${tailoringInterview.completionRequestedAt}`
      : null;
  const displayedTailoringInterviewConversation = tailoringInterview
    ? pendingTailorInterviewAnswerMessage &&
        tailoringInterview.conversation.at(-1)?.id !==
          pendingTailorInterviewAnswerMessage.id
      ? [
          ...tailoringInterview.conversation,
          pendingTailorInterviewAnswerMessage,
        ]
      : tailoringInterview.conversation
    : [];
  const displayedTailoringInterviewMessageCount =
    displayedTailoringInterviewConversation.length;
  const lastDisplayedTailoringInterviewMessageId =
    displayedTailoringInterviewConversation.at(-1)?.id ?? null;
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
  const isTailorInterviewBusy =
    isCancellingTailorInterview ||
    isSubmittingTailorInterviewAnswer ||
    isFinishingTailorInterview;
  const isTailorInterviewThinking =
    hasTailoringInterview &&
    (isSubmittingTailorInterviewAnswer || isFinishingTailorInterview);
  const isBaseResumeStepComplete = profile.workspace.isBaseResumeStepComplete;
  const hasUnsavedJobDescriptionChanges =
    draftJobDescription !== lastSavedJobDescriptionRef.current;
  const isBaseResumeStepOpen =
    sourceOnly || (openTailorResumeStep === "base" && !isBaseResumeStepComplete);
  const isJobStepOpen =
    !sourceOnly && openTailorResumeStep === "job" && isBaseResumeStepComplete;
  const isJobStepBlockedByBaseStep = !isBaseResumeStepComplete;
  const hasUnfinishedJobStepWork =
    !sourceOnly &&
    (hasUnsavedJobDescriptionChanges ||
      hasTailoringInterview ||
      isSavingJobDescription ||
      isTailoringResume);
  const isBaseResumeBlockedByJobStep =
    !sourceOnly && isBaseResumeStepComplete && hasUnfinishedJobStepWork;
  const baseResumeBlockedByJobStepMessage =
    "Finish or discard the current job-tailoring step before editing the base resume.";
  const isJobDescriptionLocked =
    isJobStepBlockedByBaseStep || hasTailoringInterview;
  const editorDisabled =
    isUploadingResume ||
    isBaseResumeBlockedByJobStep ||
    (sourceOnly && isSavingLatex);
  const displayedLatexCode =
    debugUiEnabled && activeLatexView === "annotated"
      ? profile.annotatedLatex.code
      : draftLatexCode;
  const hasUnsavedLatexChanges =
    draftLatexCode !== lastSavedLatexCodeRef.current;
  const savedPreviewPdfUrl = buildPreviewPdfUrl(profile.latex.pdfUpdatedAt);
  const previewPdfUrl =
    sourceOnly && hasUnsavedLatexChanges
      ? draftPreviewPdfUrl
      : savedPreviewPdfUrl;
  const previewError =
    sourceOnly && hasUnsavedLatexChanges
      ? draftPreviewError
      : profile.latex.status === "failed"
        ? formatTailorResumeLatexError(
            profile.latex.error ?? "Unable to compile the LaTeX preview.",
            {
              maxChars: 900,
              maxLines: 10,
            },
          )
        : null;
  const showEditorLoadingOverlay = isUploadingResume;
  const showPreviewLoadingOverlay =
    (sourceOnly ? isRefreshingDraftPreview || isSavingLatex : isSavingLatex) ||
    isUploadingResume ||
    isPreviewFrameLoading;
  const isSourceResumeSaveDisabled =
    isSavingLatex ||
    !hasUnsavedLatexChanges ||
    draftLatexCode.trim().length === 0;
  useEffect(() => {
    setIsPreviewMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (draftPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(draftPreviewObjectUrlRef.current);
        draftPreviewObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isJobDescriptionExtensionNudgeOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsJobDescriptionExtensionNudgeOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isJobDescriptionExtensionNudgeOpen]);

  useEffect(() => {
    const layoutHost = workspaceLayoutRef.current;

    if (!layoutHost) {
      return;
    }

    const syncLayoutMode = (width: number) => {
      setIsWideLayout(width >= (sourceOnly ? 720 : 1280));
    };

    syncLayoutMode(layoutHost.getBoundingClientRect().width);

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;

      if (typeof nextWidth === "number" && Number.isFinite(nextWidth)) {
        syncLayoutMode(nextWidth);
      }
    });

    resizeObserver.observe(layoutHost);

    return () => {
      resizeObserver.disconnect();
    };
  }, [sourceOnly]);

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
    isTailorInterviewSubmitInFlightRef.current = false;
    lastAutoOpenedLinkReviewRef.current = initialProfile.extraction.updatedAt;
    previousPreviewPdfUrlRef.current = buildPreviewPdfUrl(
      initialProfile.latex.pdfUpdatedAt,
    );
    setPendingDeletedLinkKeys([]);
    setIsLinkEditorOpen(false);
    setIsPreviewFrameLoading(false);
    setDraftPreviewPageCount(null);
    setDraftPreviewPdfUrl(null);
    setDraftPreviewError(null);
    setIsRefreshingDraftPreview(false);
    setIsSavingLinks(false);
    setIsTailorInterviewOpen(false);
    setIsTailorResumeProgressOpen(false);
    setIsCancellingTailorInterview(false);
    setIsSubmittingTailorInterviewAnswer(false);
    setIsTailoringResume(false);
    setIsUpdatingBaseResumeStep(false);
    setCompactResumePane("latex");
    setOpenTailorResumeStep(
      sourceOnly ? "base" : resolveInitialOpenTailorResumeStep(initialProfile),
    );
    setActiveLatexView("source");
    setTailorResumeGenerationProgress(createTailorResumeProgressState());
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
    setDraftLinkLocks(buildLinkLockDrafts(initialProfile.links));
    setDraftLinkUrls(buildLinkUrlDrafts(initialProfile.links));
    setJobDescriptionState(
      initialProfile.jobDescription.trim().length > 0 ? "saved" : "idle",
    );
    draftPreviewRequestSequenceRef.current = 0;

    if (draftPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(draftPreviewObjectUrlRef.current);
      draftPreviewObjectUrlRef.current = null;
    }
    setLatexState("idle");
  }, [initialProfile, sourceOnly]);

  useEffect(() => {
    if (!sourceOnly) {
      return;
    }

    if (!hasUnsavedLatexChanges || draftLatexCode.trim().length === 0) {
      draftPreviewRequestSequenceRef.current += 1;
      setIsRefreshingDraftPreview(false);
      setDraftPreviewPageCount(null);
      setDraftPreviewError(null);
      setDraftPreviewPdfUrl(null);

      if (draftPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(draftPreviewObjectUrlRef.current);
        draftPreviewObjectUrlRef.current = null;
      }

      return;
    }

    const requestSequence = draftPreviewRequestSequenceRef.current + 1;
    draftPreviewRequestSequenceRef.current = requestSequence;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsRefreshingDraftPreview(true);

      void (async () => {
        try {
          const response = await fetch("/api/tailor-resume/preview", {
            body: JSON.stringify({
              latexCode: draftLatexCode,
            }),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: abortController.signal,
          });

          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error ?? "Unable to compile the draft preview.");
          }

          const previewBlob = await response.blob();
          const pageCountHeader = response.headers.get("X-JobHelper-Page-Count");
          const nextDraftPreviewPdfUrl = URL.createObjectURL(previewBlob);

          if (draftPreviewRequestSequenceRef.current !== requestSequence) {
            URL.revokeObjectURL(nextDraftPreviewPdfUrl);
            return;
          }

          if (draftPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(draftPreviewObjectUrlRef.current);
          }

          draftPreviewObjectUrlRef.current = nextDraftPreviewPdfUrl;
          setDraftPreviewPdfUrl(nextDraftPreviewPdfUrl);
          setDraftPreviewError(null);
          setDraftPreviewPageCount(
            pageCountHeader && !Number.isNaN(Number(pageCountHeader))
              ? Number(pageCountHeader)
              : null,
          );
        } catch (error) {
          if (abortController.signal.aborted) {
            return;
          }

          if (draftPreviewRequestSequenceRef.current !== requestSequence) {
            return;
          }

          if (draftPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(draftPreviewObjectUrlRef.current);
            draftPreviewObjectUrlRef.current = null;
          }

          setDraftPreviewPdfUrl(null);
          setDraftPreviewPageCount(null);
          setDraftPreviewError(
            formatTailorResumeLatexError(
              error instanceof Error
                ? error.message
                : "Unable to compile the draft preview.",
              {
                maxChars: 900,
                maxLines: 10,
              },
            ),
          );
        } finally {
          if (draftPreviewRequestSequenceRef.current === requestSequence) {
            setIsRefreshingDraftPreview(false);
          }
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [draftLatexCode, hasUnsavedLatexChanges, sourceOnly]);

  useEffect(() => {
    if (!tailoringInterview) {
      isTailorInterviewSubmitInFlightRef.current = false;
      setIsTailorInterviewOpen(false);
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setIsCancellingTailorInterview(false);
      setIsSubmittingTailorInterviewAnswer(false);
      return;
    }

    isTailorInterviewSubmitInFlightRef.current = false;
    setDraftTailorInterviewAnswer("");
    setPendingTailorInterviewAnswerMessage(null);
  }, [tailoringInterview?.id, tailoringInterview]);

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
      !linkReviewUiEnabled ||
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
    linkReviewUiEnabled,
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

  const closeTailorResumeProgress = useCallback(() => {
    setIsTailorResumeProgressOpen(false);
  }, []);

  const openTailorResumeProgress = useCallback(() => {
    setIsTailorResumeProgressOpen(true);
  }, []);

  const openTailorResumeInterview = useCallback(() => {
    setIsTailorInterviewOpen(true);
  }, []);

  const showTailorResumeInterviewToast = useCallback(() => {
    toast(
      <TailorResumeProgressToast
        ariaLabel="Open resume follow-up questions"
        label="Resume chat needs your attention..."
        onOpen={openTailorResumeInterview}
      />,
      {
        classNames: tailorResumeClickableToastClassNames,
        id: tailorResumeRunToastId,
      },
    );
  }, [openTailorResumeInterview]);

  const startTailorResumeProgress = useCallback(
    (input?: {
      activeStepNumber?: number;
      completedStepNumbers?: number[];
      detail?: string;
    }) => {
      setIsTailorResumeProgressOpen(true);
      setTailorResumeGenerationProgress(createTailorResumeProgressState(input));
      toast.loading(
        <TailorResumeProgressToast onOpen={openTailorResumeProgress} />,
        {
          classNames: tailorResumeClickableToastClassNames,
          id: tailorResumeRunToastId,
        },
      );
    },
    [openTailorResumeProgress],
  );

  const handleTailorResumeStepEvent = useCallback(
    (stepEvent: TailorResumeGenerationStepEvent) => {
      setTailorResumeGenerationProgress((currentProgress) =>
        applyTailorResumeStepEventToProgressState(currentProgress, stepEvent),
      );
    },
    [],
  );

  const handleInterviewStreamEvent = useCallback(
    (event: TailorResumeInterviewStreamEvent) => {
      if (event.kind === "reset") {
        setStreamingInterviewMessage({ cards: [], text: "" });
        return;
      }

      setStreamingInterviewMessage((current) => {
        const base = current ?? { cards: [], text: "" };

        if (event.kind === "text-delta") {
          return { ...base, text: base.text + event.delta };
        }

        return { ...base, cards: [...base.cards, event.card] };
      });
    },
    [],
  );

  function dismissTailorInterviewFinishPrompt() {
    if (tailorInterviewFinishRequestKey) {
      dismissedTailorInterviewFinishRequestRef.current =
        tailorInterviewFinishRequestKey;
    }

    setIsTailorInterviewFinishPromptOpen(false);
    setIsTailorInterviewOpen(true);
  }

  useEffect(() => {
    if (!hasTailoringInterview) {
      return;
    }

    showTailorResumeInterviewToast();
  }, [hasTailoringInterview, showTailorResumeInterviewToast, tailoringInterview?.id]);

  useEffect(() => {
    if (!tailorInterviewFinishRequestKey) {
      dismissedTailorInterviewFinishRequestRef.current = null;
      setIsTailorInterviewFinishPromptOpen(false);
      return;
    }

    if (
      dismissedTailorInterviewFinishRequestRef.current ===
      tailorInterviewFinishRequestKey
    ) {
      return;
    }

    if (lastSeenTailorInterviewFinishRequestRef.current === tailorInterviewFinishRequestKey) {
      return;
    }

    lastSeenTailorInterviewFinishRequestRef.current = tailorInterviewFinishRequestKey;
    setIsTailorInterviewOpen(true);
    setIsTailorInterviewFinishPromptOpen(true);
  }, [tailorInterviewFinishRequestKey]);

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
    if (sourceOnly) {
      if (isLatexSaveInFlightRef.current || latexState === "saving") {
        return;
      }

      if (draftLatexCode === lastSavedLatexCodeRef.current) {
        pendingLatexCodeRef.current = null;
        setIsSavingLatex(false);
        setLatexState(draftLatexCode.trim().length > 0 ? "saved" : "idle");
        return;
      }

      pendingLatexCodeRef.current =
        draftLatexCode.trim().length > 0 ? draftLatexCode : null;
      setIsSavingLatex(false);
      setLatexState(draftLatexCode.trim().length > 0 ? "dirty" : "idle");
      return;
    }

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
  }, [draftLatexCode, latexState, flushPendingLatexSave, sourceOnly]);

  function cancelLatexEdits() {
    const savedLatexCode = lastSavedLatexCodeRef.current;

    pendingLatexCodeRef.current = null;
    latestDraftLatexCodeRef.current = savedLatexCode;
    setDraftLatexCode(savedLatexCode);
    setIsSavingLatex(false);
    setLatexState(savedLatexCode.trim().length > 0 ? "saved" : "idle");
  }

  async function saveLatexEdits() {
    if (!hasUnsavedLatexChanges) {
      setLatexState(draftLatexCode.trim().length > 0 ? "saved" : "idle");
      return;
    }

    if (draftLatexCode.trim().length === 0) {
      toast.error("Paste some LaTeX before saving.", {
        id: latexSaveToastId,
      });
      return;
    }

    pendingLatexCodeRef.current = draftLatexCode;
    await flushPendingLatexSave();
  }

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

  useEffect(() => {
    if (!isTailorInterviewOpen) {
      setOpenTailorInterviewTechnologyContextKey(null);
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsTailorInterviewOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTailorInterviewOpen]);

  useEffect(() => {
    if (!isTailorInterviewOpen || !tailoringInterview?.id) {
      return;
    }

    tailorInterviewMessagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    displayedTailoringInterviewMessageCount,
    draftTailorInterviewAnswer,
    isTailorInterviewOpen,
    lastDisplayedTailoringInterviewMessageId,
    tailoringInterview?.id,
  ]);

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
      } else if (isNdjsonResponse(response)) {
        streamedAttemptEvents = true;
        payload = await readTailorResumeUploadStream(response, {
          onAttemptEvent: (attemptEvent) => {
            showExtractionAttemptToast(attemptEvent);
          },
          parsePayload: (value) =>
            (typeof value === "object" && value !== null
              ? value
              : {}) as TailorResumeUploadResponsePayload,
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
      setIsLinkEditorOpen(
        linkReviewUiEnabled && hasActiveResumeLinks(payload.profile),
      );
      setCompactResumePane("latex");
      setOpenTailorResumeStep("base");
      lastSavedLatexCodeRef.current = resolvedLatexCode;
      latestDraftLatexCodeRef.current = resolvedLatexCode;
      if (!streamedAttemptEvents) {
        showExtractionAttemptToasts(payload.extractionAttempts ?? []);
      }
      if (linkReviewUiEnabled) {
        showLinkValidationSummaryToast(
          payload.linkValidationSummary,
          payload.linkValidationLinks,
        );
      }
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );

      if (payload.extractionError) {
        const inlineError = buildInlineLatexError(payload.extractionError);
        toast.error(
          `Saved the resume, but LaTeX generation needs review: ${inlineError}`,
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
      setIsLinkEditorOpen(
        linkReviewUiEnabled && hasActiveResumeLinks(payload.profile),
      );
      lastSavedLatexCodeRef.current = resolvedLatexCode;
      latestDraftLatexCodeRef.current = resolvedLatexCode;
      showExtractionAttemptToasts(payload.extractionAttempts ?? []);
      if (linkReviewUiEnabled) {
        showLinkValidationSummaryToast(
          payload.linkValidationSummary,
          payload.linkValidationLinks,
          (payload.extractionAttempts?.length ?? 0) * 140,
        );
      }
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );

      if (payload.extractionError) {
        const inlineError = buildInlineLatexError(payload.extractionError);
        toast.error(
          `Saved the link changes, but LaTeX generation still needs review: ${inlineError}`,
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

  const setBaseResumeStepComplete = useCallback(async (nextValue: boolean) => {
    if (!resume || isUpdatingBaseResumeStep) {
      return;
    }

    if (!nextValue && isBaseResumeBlockedByJobStep) {
      toast(baseResumeBlockedByJobStepMessage, {
        id: latexSaveToastId,
      });
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
      setOpenTailorResumeStep(nextValue ? "job" : "base");

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
  }, [
    baseResumeBlockedByJobStepMessage,
    isBaseResumeBlockedByJobStep,
    isUpdatingBaseResumeStep,
    resume,
  ]);

  const openSourceResumeEditor = useCallback(() => {
    if (!resume) {
      setOpenTailorResumeStep("base");
      toast("Upload a base resume before editing source LaTeX.", {
        id: latexSaveToastId,
      });
      return;
    }

    setActiveLatexView("source");
    setCompactResumePane("latex");

    if (isBaseResumeStepComplete) {
      void setBaseResumeStepComplete(false);
      return;
    }

    setOpenTailorResumeStep("base");
  }, [isBaseResumeStepComplete, resume, setBaseResumeStepComplete]);

  useEffect(() => {
    if (
      sourceResumeEditRequestKey === 0 ||
      lastHandledSourceResumeEditRequestKeyRef.current ===
        sourceResumeEditRequestKey
    ) {
      return;
    }

    lastHandledSourceResumeEditRequestKeyRef.current =
      sourceResumeEditRequestKey;
    openSourceResumeEditor();
    onSourceResumeEditRequestHandled?.();
  }, [
    onSourceResumeEditRequestHandled,
    openSourceResumeEditor,
    sourceResumeEditRequestKey,
  ]);

  function toggleBaseResumeStep() {
    if (!resume) {
      return;
    }

    if (isBaseResumeStepComplete) {
      void setBaseResumeStepComplete(false);
      return;
    }

    setOpenTailorResumeStep((currentStep) =>
      currentStep === "base" ? null : "base",
    );
  }

  function toggleJobDescriptionStep() {
    if (isJobStepBlockedByBaseStep) {
      return;
    }

    setOpenTailorResumeStep((currentStep) =>
      currentStep === "job" ? null : "job",
    );
  }

  function handleJobDescriptionChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;

    if (!hasShownJobDescriptionExtensionNudgeRef.current) {
      hasShownJobDescriptionExtensionNudgeRef.current = true;
      setIsJobDescriptionExtensionNudgeOpen(true);
    }

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
    if (tailoringInterview) {
      setIsTailorInterviewOpen(true);
      return;
    }

    if (!openAIReady) {
      toast.error("Add OPENAI_API_KEY before tailoring the resume.");
      return;
    }

    if (!profile.latex.code.trim()) {
      toast.error("Upload or save a resume before tailoring it.");
      return;
    }

    if (!draftJobDescription.trim()) {
      toast.error(
        "Use the Chrome extension from the job post, or paste a job description as a fallback.",
      );
      return;
    }

    setIsTailoringResume(true);
    const tailoringStartedAt = performance.now();
    startTailorResumeProgress({
      activeStepNumber: 1,
      detail: "Tracking each of the 4 tailoring steps while the resume is being generated.",
    });

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "tailor",
          jobDescription: draftJobDescription,
        }),
        headers: {
          "Content-Type": "application/json",
          "x-tailor-resume-stream": "1",
        },
        method: "PATCH",
      });
      const streamedResult = isNdjsonResponse(response)
        ? await readTailorResumeGenerationStream(response, {
            onInterviewStreamEvent: handleInterviewStreamEvent,
            onStepEvent: handleTailorResumeStepEvent,
            parseInterviewStreamEvent: (value) =>
              typeof value === "object" && value !== null
                ? (value as TailorResumeInterviewStreamEvent)
                : null,
            parsePayload: (value) =>
              (typeof value === "object" && value !== null
                ? value
                : {}) as TailorResumeRunResponsePayload,
            parseStepEvent: (value) =>
              typeof value === "object" && value !== null
                ? (value as TailorResumeGenerationStepEvent)
                : null,
          })
        : {
            ok: response.ok,
            payload: (await response.json()) as TailorResumeRunResponsePayload,
            status: response.status,
          };
      const payload = streamedResult.payload;
      const tailoringDurationMs = resolveElapsedDurationMs(
        payload.tailoredResumeDurationMs,
        tailoringStartedAt,
      );
      const formattedTailoringDuration = formatElapsedDuration(
        tailoringDurationMs,
      );

      if (payload.userMarkdown) {
        onUserMarkdownChange?.(payload.userMarkdown);
      }

      if (!streamedResult.ok || !payload.profile) {
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
      closeTailorResumeProgress();
      if (payload.profile.workspace.tailoringInterview) {
        setIsTailorInterviewOpen(true);
        showTailorResumeInterviewToast();
        return;
      }

      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );
      const nextTailoredResumeId =
        payload.tailoredResumeId ?? payload.profile.tailoredResumes[0]?.id ?? null;

      if (payload.tailoringStatus === "already_tailored") {
        toast.success(
          "You already tailored a resume for this job. Opening the saved review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      } else if (payload.tailoredResumeError) {
        toast.error(
          formattedTailoringDuration
            ? `Saved a tailored draft in ${formattedTailoringDuration}, but it still needs review: ${payload.tailoredResumeError}. Opening review.`
            : `Saved a tailored draft, but it still needs review: ${payload.tailoredResumeError}. Opening review.`,
          {
            id: tailorResumeRunToastId,
          },
        );
      } else {
        toast.success(
          formattedTailoringDuration
            ? `Saved a job-specific tailored resume in ${formattedTailoringDuration}. Opening review.`
            : "Saved a job-specific tailored resume. Opening review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      }

      if (nextTailoredResumeId) {
        onReviewTailoredResume?.(nextTailoredResumeId);
      }
    } catch (error) {
      const formattedTailoringDuration = formatElapsedDuration(
        Math.max(0, performance.now() - tailoringStartedAt),
      );
      const errorMessage =
        error instanceof Error ? error.message : "Unable to tailor the resume.";
      closeTailorResumeProgress();
      toast.error(
        formattedTailoringDuration
          ? `${errorMessage} (${formattedTailoringDuration})`
          : errorMessage,
        {
          id: tailorResumeRunToastId,
        },
      );
    } finally {
      setIsTailoringResume(false);
    }
  }

  async function submitTailorResumeInterviewAnswer() {
    if (
      !tailoringInterview ||
      isTailorInterviewSubmitInFlightRef.current ||
      isSubmittingTailorInterviewAnswer ||
      isCancellingTailorInterview
    ) {
      return;
    }

    const trimmedAnswer = draftTailorInterviewAnswer.trim();

    if (!trimmedAnswer) {
      return;
    }

    const optimisticAnswerMessage: TailorResumeConversationMessage = {
      id: `pending-tailor-interview-answer-${Date.now()}`,
      role: "user",
      text: trimmedAnswer,
      toolCalls: [],
    };

    isTailorInterviewSubmitInFlightRef.current = true;
    setPendingTailorInterviewAnswerMessage(optimisticAnswerMessage);
    setDraftTailorInterviewAnswer("");
    dismissTailorInterviewFinishPrompt();
    setIsTailorInterviewOpen(false);
    setIsSubmittingTailorInterviewAnswer(true);
    const tailoringStartedAt = performance.now();
    startTailorResumeProgress({
      activeStepNumber: 2,
      completedStepNumbers: [1],
      detail:
        "Picking back up from the follow-up question step before we finish the remaining stages.",
    });

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "advanceTailorResumeInterview",
          answer: trimmedAnswer,
          interviewId: tailoringInterview.id,
        }),
        headers: {
          "Content-Type": "application/json",
          "x-tailor-resume-stream": "1",
        },
        method: "PATCH",
      });
      const streamedResult = isNdjsonResponse(response)
        ? await readTailorResumeGenerationStream(response, {
            onInterviewStreamEvent: handleInterviewStreamEvent,
            onStepEvent: handleTailorResumeStepEvent,
            parseInterviewStreamEvent: (value) =>
              typeof value === "object" && value !== null
                ? (value as TailorResumeInterviewStreamEvent)
                : null,
            parsePayload: (value) =>
              (typeof value === "object" && value !== null
                ? value
                : {}) as TailorResumeRunResponsePayload,
            parseStepEvent: (value) =>
              typeof value === "object" && value !== null
                ? (value as TailorResumeGenerationStepEvent)
                : null,
          })
        : {
            ok: response.ok,
            payload: (await response.json()) as TailorResumeRunResponsePayload,
            status: response.status,
      };
      const payload = streamedResult.payload;

      if (payload.userMarkdown) {
        onUserMarkdownChange?.(payload.userMarkdown);
      }

      if (!streamedResult.ok || !payload.profile) {
        throw new Error(
          payload.error ?? "Unable to continue the tailoring follow-up questions.",
        );
      }

      setPendingTailorInterviewAnswerMessage(null);
      setStreamingInterviewMessage(null);
      setProfile(payload.profile);
      lastSavedJobDescriptionRef.current = payload.profile.jobDescription;
      onTailoredResumesChange?.(payload.profile.tailoredResumes);
      closeTailorResumeProgress();

      if (payload.profile.workspace.tailoringInterview) {
        setIsTailorInterviewOpen(true);
        showTailorResumeInterviewToast();
        return;
      }

      setIsTailorInterviewOpen(false);
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );
      const formattedTailoringDuration = formatElapsedDuration(
        resolveElapsedDurationMs(
          payload.tailoredResumeDurationMs,
          tailoringStartedAt,
        ),
      );
      const nextTailoredResumeId =
        payload.tailoredResumeId ?? payload.profile.tailoredResumes[0]?.id ?? null;

      if (payload.tailoringStatus === "already_tailored") {
        toast.success(
          "You already tailored a resume for this job. Opening the saved review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      } else if (payload.tailoredResumeError) {
        toast.error(
          formattedTailoringDuration
            ? `Saved a tailored draft in ${formattedTailoringDuration}, but it still needs review: ${payload.tailoredResumeError}. Opening review.`
            : `Saved a tailored draft, but it still needs review: ${payload.tailoredResumeError}. Opening review.`,
          {
            id: tailorResumeRunToastId,
          },
        );
      } else {
        toast.success(
          formattedTailoringDuration
            ? `Saved a job-specific tailored resume in ${formattedTailoringDuration}. Opening review.`
            : "Saved a job-specific tailored resume. Opening review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      }

      if (nextTailoredResumeId) {
        onReviewTailoredResume?.(nextTailoredResumeId);
      }
    } catch (error) {
      const formattedTailoringDuration = formatElapsedDuration(
        Math.max(0, performance.now() - tailoringStartedAt),
      );
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to continue the tailoring follow-up questions.";
      setPendingTailorInterviewAnswerMessage(null);
      setStreamingInterviewMessage(null);
      setDraftTailorInterviewAnswer(trimmedAnswer);
      setIsTailorInterviewOpen(true);
      closeTailorResumeProgress();
      toast.error(
        formattedTailoringDuration
          ? `${errorMessage} (${formattedTailoringDuration})`
          : errorMessage,
        {
          id: tailorResumeRunToastId,
        },
      );
    } finally {
      isTailorInterviewSubmitInFlightRef.current = false;
      setIsSubmittingTailorInterviewAnswer(false);
    }
  }

  async function finishTailorResumeInterview() {
    if (
      !tailoringInterview ||
      !tailoringInterview.completionRequestedAt ||
      isFinishingTailorInterview ||
      isCancellingTailorInterview ||
      isSubmittingTailorInterviewAnswer
    ) {
      return;
    }

    setIsTailorInterviewFinishPromptOpen(false);
    setIsTailorInterviewOpen(false);
    setIsFinishingTailorInterview(true);
    const tailoringStartedAt = performance.now();
    startTailorResumeProgress({
      activeStepNumber: 2,
      completedStepNumbers: [1],
      detail:
        "Wrapping up the follow-up chat before we finish the remaining resume stages.",
    });

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "completeTailorResumeInterview",
          interviewId: tailoringInterview.id,
        }),
        headers: {
          "Content-Type": "application/json",
          "x-tailor-resume-stream": "1",
        },
        method: "PATCH",
      });
      const streamedResult = isNdjsonResponse(response)
        ? await readTailorResumeGenerationStream(response, {
            onStepEvent: handleTailorResumeStepEvent,
            parsePayload: (value) =>
              (typeof value === "object" && value !== null
                ? value
                : {}) as TailorResumeRunResponsePayload,
            parseStepEvent: (value) =>
              typeof value === "object" && value !== null
                ? (value as TailorResumeGenerationStepEvent)
                : null,
          })
        : {
            ok: response.ok,
            payload: (await response.json()) as TailorResumeRunResponsePayload,
            status: response.status,
          };
      const payload = streamedResult.payload;

      if (payload.userMarkdown) {
        onUserMarkdownChange?.(payload.userMarkdown);
      }

      if (!streamedResult.ok || !payload.profile) {
        throw new Error(
          payload.error ?? "Unable to finish the tailoring follow-up questions.",
        );
      }

      setPendingTailorInterviewAnswerMessage(null);
      setProfile(payload.profile);
      lastSavedJobDescriptionRef.current = payload.profile.jobDescription;
      onTailoredResumesChange?.(payload.profile.tailoredResumes);
      closeTailorResumeProgress();
      showSavedLinkUpdateToast(
        payload.savedLinkUpdateCount,
        payload.savedLinkUpdates,
      );
      const formattedTailoringDuration = formatElapsedDuration(
        resolveElapsedDurationMs(
          payload.tailoredResumeDurationMs,
          tailoringStartedAt,
        ),
      );
      const nextTailoredResumeId =
        payload.tailoredResumeId ?? payload.profile.tailoredResumes[0]?.id ?? null;

      if (payload.tailoringStatus === "already_tailored") {
        toast.success(
          "You already tailored a resume for this job. Opening the saved review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      } else if (payload.tailoredResumeError) {
        toast.error(
          formattedTailoringDuration
            ? `Saved a tailored draft in ${formattedTailoringDuration}, but it still needs review: ${payload.tailoredResumeError}. Opening review.`
            : `Saved a tailored draft, but it still needs review: ${payload.tailoredResumeError}. Opening review.`,
          {
            id: tailorResumeRunToastId,
          },
        );
      } else {
        toast.success(
          formattedTailoringDuration
            ? `Saved a job-specific tailored resume in ${formattedTailoringDuration}. Opening review.`
            : "Saved a job-specific tailored resume. Opening review.",
          {
            id: tailorResumeRunToastId,
          },
        );
      }

      if (nextTailoredResumeId) {
        onReviewTailoredResume?.(nextTailoredResumeId);
      }
    } catch (error) {
      const formattedTailoringDuration = formatElapsedDuration(
        Math.max(0, performance.now() - tailoringStartedAt),
      );
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to finish the tailoring follow-up questions.";
      setIsTailorInterviewOpen(true);
      if (tailoringInterview.completionRequestedAt) {
        setIsTailorInterviewFinishPromptOpen(true);
      }
      closeTailorResumeProgress();
      toast.error(
        formattedTailoringDuration
          ? `${errorMessage} (${formattedTailoringDuration})`
          : errorMessage,
        {
          id: tailorResumeRunToastId,
        },
      );
    } finally {
      setIsFinishingTailorInterview(false);
    }
  }

  function handleTailorInterviewAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitTailorResumeInterviewAnswer();
  }

  async function cancelTailorResumeInterview() {
    if (!tailoringInterview || isCancellingTailorInterview) {
      return;
    }

    setIsCancellingTailorInterview(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "cancelTailorResumeInterview",
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
        throw new Error(
          payload.error ?? "Unable to discard the tailoring follow-up questions.",
        );
      }

      setProfile(payload.profile);
      setIsTailorInterviewFinishPromptOpen(false);
      setIsTailorInterviewOpen(false);
      setDraftTailorInterviewAnswer("");
      toast.success("Discarded the tailoring follow-up questions.", {
        id: tailorResumeRunToastId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to discard the tailoring follow-up questions.",
        {
          id: tailorResumeRunToastId,
        },
      );
    } finally {
      setIsCancellingTailorInterview(false);
    }
  }

  const editorPanelContent = sourceOnly ? (
    <div className="relative h-full">
      <SourceResumeDiffEditor
        baselineLatexCode={lastSavedLatexCodeRef.current}
        className="h-full"
        disabled={editorDisabled}
        draftLatexCode={draftLatexCode}
        onChange={setDraftLatexCode}
      />
      {showEditorLoadingOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.25rem] bg-zinc-950/65 px-6 backdrop-blur-[2px]">
          <div className="rounded-full border border-white/12 bg-black/42 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-emerald-300" />
          </div>
        </div>
      ) : null}
    </div>
  ) : (
    <section
      aria-busy={editorDisabled}
      className="flex min-w-0 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:h-full sm:px-4 sm:pb-4 xl:min-h-[560px]"
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

      <div className="relative flex min-h-[420px] flex-1 overflow-hidden rounded-[1.25rem] sm:min-h-[640px]">
        {showEditorLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-black/20" />
        ) : null}

        <div className="relative z-10 flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate sm:min-h-[640px]">
          {displayedLatexCode.trim().length > 0 || resume ? (
            <textarea
              className={`min-h-[380px] w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none placeholder:text-zinc-500 transition sm:min-h-[600px] ${
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
              className="min-h-[380px] flex-1 rounded-[1.25rem] sm:min-h-[600px]"
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
      className={`flex min-w-0 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:h-full sm:px-4 sm:pb-4 ${
        sourceOnly ? "min-[720px]:min-h-0" : "xl:min-h-[560px]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          {sourceOnly ? "Rendered PDF" : "Preview"}
        </p>
        {sourceOnly && draftPreviewPageCount ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {draftPreviewPageCount} page{draftPreviewPageCount === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <div
        className={`relative flex min-h-[320px] flex-1 overflow-hidden rounded-[1.25rem] ${
          sourceOnly ? "sm:min-h-[420px]" : "sm:min-h-[500px]"
        }`}
      >
        {showPreviewLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-black/20" />
        ) : null}

        <div
          className={`relative z-10 flex min-h-[320px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20 isolation-isolate ${
            sourceOnly ? "sm:min-h-[420px]" : "sm:min-h-[500px]"
          }`}
        >
          {previewError ? (
            <div className="h-full w-full overflow-auto rounded-[1.25rem] border border-rose-300/12 bg-[linear-gradient(180deg,rgba(251,113,133,0.16),rgba(159,18,57,0.2))] p-5 text-sm leading-6 text-rose-50/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <p className="font-medium text-rose-50">
                The current LaTeX draft did not render cleanly.
              </p>
              {previewError.wasTruncated ? (
                <p className="mt-2 text-xs leading-5 text-rose-100/70">
                  Showing an abbreviated version of the latest LaTeX error.
                </p>
              ) : null}
              <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-6 text-rose-50/78">
                {previewError.displayMessage}
              </pre>
            </div>
          ) : previewPdfUrl ? (
            <div
              className={`h-full min-h-[320px] w-full overflow-hidden rounded-[1.25rem] bg-white ${
                sourceOnly ? "sm:min-h-[420px]" : "sm:min-h-[500px]"
              }`}
            >
              <TailoredResumeInteractivePreview
                displayName="source resume"
                focusKey={null}
                focusMatchKey={null}
                focusQuery={null}
                focusRequest={0}
                highlightQueries={[]}
                onPageSnapshot={handlePreviewRenderSettled}
                onRenderFailure={handlePreviewRenderSettled}
                pdfUrl={previewPdfUrl}
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

  const compactResumePaneToggle = (
    <div className="mb-3 flex justify-end">
      <div className="grid w-full grid-cols-2 rounded-full border border-white/10 bg-black/20 p-1 sm:w-auto">
        <button
          aria-pressed={compactResumePane === "latex"}
          className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition ${
            compactResumePane === "latex"
              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          onClick={() => setCompactResumePane("latex")}
          type="button"
        >
          LaTeX
        </button>
        <button
          aria-pressed={compactResumePane === "rendered"}
          className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition ${
            compactResumePane === "rendered"
              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          onClick={() => setCompactResumePane("rendered")}
          type="button"
        >
          Rendered
        </button>
      </div>
    </div>
  );

  const shouldUseWideResumeLayout = sourceOnly || isWideLayout;

  return (
    <section
      className="grid gap-[clamp(0.75rem,1.2vh,1rem)]"
      ref={workspaceLayoutRef}
    >
      <input
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={!openAIReady || isUploadingResume || isBaseResumeBlockedByJobStep}
        id={fileInputId}
        onChange={handleResumeChange}
        ref={fileInputRef}
        type="file"
      />

      {resume ? (
        <section className="glass-panel soft-ring overflow-hidden rounded-[1.5rem]">
          <div
            className={`flex flex-wrap items-start justify-between gap-4 ${
              sourceOnly ? "px-4 py-3 sm:px-5 sm:py-4" : "px-4 py-4 sm:px-5 sm:py-5"
            }`}
          >
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                {sourceOnly ? "Config" : "Step 1"}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                {sourceOnly ? "Source resume" : "Review the base resume"}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                {sourceOnly
                  ? "Edit the working LaTeX draft, compare it against the saved version, and use config chat for layout-focused resume changes."
                  : "Start in the split-screen editor, confirm the LaTeX and preview look right, then mark this step complete to collapse it before tailoring for a specific job."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {sourceOnly ? (
                <StatusPill>
                  {isSavingLatex
                    ? "Saving..."
                    : hasUnsavedLatexChanges
                      ? "Unsaved changes"
                      : "Saved"}
                </StatusPill>
              ) : null}
              {sourceOnly ? null : (
                <StatusPill>
                  {isUpdatingBaseResumeStep
                    ? "Updating..."
                    : isBaseResumeStepComplete
                      ? "Completed"
                      : !isBaseResumeStepOpen
                        ? "Collapsed"
                      : isSavingLatex
                        ? "Saving edits..."
                        : latexState === "saved"
                          ? "Ready"
                          : "In progress"}
                </StatusPill>
              )}
              {isBaseResumeStepOpen ? (
                <label
                  className={`inline-flex items-center rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.2em] transition ${
                    !openAIReady || isUploadingResume || isBaseResumeBlockedByJobStep
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                      : "cursor-pointer border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                  }`}
                  htmlFor={
                    !openAIReady || isUploadingResume || isBaseResumeBlockedByJobStep
                      ? undefined
                      : fileInputId
                  }
                >
                  {isUploadingResume ? "Saving..." : "Re-upload"}
                </label>
              ) : null}

              {sourceOnly ? null : (
                <button
                  className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.2em] transition ${
                    isUpdatingBaseResumeStep ||
                    (isBaseResumeStepComplete && isBaseResumeBlockedByJobStep)
                      ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                      : isBaseResumeStepComplete || !isBaseResumeStepOpen
                        ? "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                        : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                  }`}
                  disabled={
                    isUpdatingBaseResumeStep ||
                    (isBaseResumeStepComplete && isBaseResumeBlockedByJobStep)
                  }
                  onClick={() =>
                    isBaseResumeStepOpen
                      ? void setBaseResumeStepComplete(true)
                      : toggleBaseResumeStep()
                  }
                  type="button"
                >
                  {isUpdatingBaseResumeStep
                    ? "Updating..."
                    : isBaseResumeStepComplete && isBaseResumeBlockedByJobStep
                      ? "Tailoring active"
                    : isBaseResumeStepComplete
                      ? "Edit source LaTeX"
                    : !isBaseResumeStepOpen
                      ? "Open step"
                      : "Mark complete"}
                </button>
              )}
            </div>
          </div>

          {isBaseResumeStepOpen ? (
            <div className="px-3 pb-3 sm:px-4 sm:pb-4">
              {shouldUseWideResumeLayout ? (
                <section
                  className={
                    sourceOnly
                      ? "min-h-0 overflow-x-auto pt-1"
                      : "min-h-[560px] pt-1"
                  }
                >
                  {/*
                    react-resizable-panels applies inline `height: auto` on horizontal panel groups,
                    overriding any Tailwind height class. A CSS grid wrapper fixes this: grid tracks
                    honor explicit sizing regardless of children's inline height style.
                  */}
                  <div
                    className={sourceOnly ? "min-w-[900px]" : undefined}
                    style={
                      sourceOnly
                        ? {
                            display: "grid",
                            gridTemplateRows: "min(58dvh, 620px)",
                            minHeight: "420px",
                          }
                        : undefined
                    }
                  >
                  <ResizablePanelGroup
                    className={
                      sourceOnly
                        ? "min-h-0 gap-0"
                        : "min-h-[560px] gap-0"
                    }
                    key={sourceOnly && hasUnsavedLatexChanges ? "dirty" : "clean"}
                    orientation="horizontal"
                  >
                    <ResizablePanel
                      className="min-w-0 overflow-hidden pr-1"
                      defaultSize={
                        sourceOnly && hasUnsavedLatexChanges ? 67 : defaultEditorPaneSize
                      }
                      minSize={sourceOnly && hasUnsavedLatexChanges ? 50 : 42}
                    >
                      {editorPanelContent}
                    </ResizablePanel>

                    <ResizableHandle className="group relative w-2 bg-transparent after:hidden focus-visible:ring-0" />

                    <ResizablePanel
                      className="min-w-0 overflow-hidden pl-1"
                      collapsedSize={0}
                      collapsible
                      defaultSize={
                        sourceOnly && hasUnsavedLatexChanges ? 33 : defaultPreviewPaneSize
                      }
                      minSize={22}
                    >
                      {previewPanelContent}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                  </div>
                </section>
              ) : (
                <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)] pt-1">
                  {compactResumePaneToggle}
                  {compactResumePane === "latex"
                    ? editorPanelContent
                    : previewPanelContent}
                </section>
              )}
              {sourceOnly ? (
                <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/8 pt-4 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSavingLatex || !hasUnsavedLatexChanges}
                    onClick={cancelLatexEdits}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
                      isSourceResumeSaveDisabled
                        ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-zinc-500"
                        : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                    }`}
                    disabled={isSourceResumeSaveDisabled}
                    onClick={() => void saveLatexEdits()}
                    type="button"
                  >
                    {isSavingLatex ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="border-t border-white/8 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
              <div className="rounded-[1.25rem] border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-medium text-zinc-100">
                  {isBaseResumeStepComplete
                    ? "Base resume locked in for tailoring."
                    : "Step 1 is collapsed."}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {isBaseResumeBlockedByJobStep
                    ? baseResumeBlockedByJobStepMessage
                    : isBaseResumeStepComplete
                      ? "Open this step again only when you need to revise the base resume."
                      : "Open this step to finish reviewing the base resume before moving on."}
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
                {sourceOnly ? "Config" : "Step 1"}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                {sourceOnly
                  ? "Upload your source resume"
                  : "Upload and review your base resume"}
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
              {sourceOnly
                ? "Upload a PDF or image to extract editable LaTeX and render the preview."
                : "Upload a PDF or image to start editing the LaTeX and preview."}
            </div>
          )}
        </section>
      )}

      {sourceOnly && resume ? (
        <SourceResumeConfigChat
          disabled={editorDisabled || !openAIReady}
          draftLatexCode={draftLatexCode}
          hasResume
          onApplyDraftLatex={setDraftLatexCode}
        />
      ) : null}

      {!sourceOnly && resume ? (
        <>
          <section
            className={`glass-panel soft-ring flex flex-col rounded-[1.5rem] p-4 sm:p-5 ${
              isJobStepOpen ? "min-h-[260px]" : ""
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Step 2
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                  Tailor from the Chrome extension
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                  The extension captures the job URL with the posting, which lets
                  Job Helper recognize when a saved tailored resume already
                  exists for the same role. Pasting text here is a fallback.
                </p>
                {!isBaseResumeStepComplete ? (
                  <p className="mt-3 rounded-[1rem] border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-zinc-400">
                    Mark step 1 complete before tailoring from the extension or
                    using the paste fallback.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>
                  {!isBaseResumeStepComplete
                    ? "Step 1 unfinished"
                    : !isJobStepOpen
                    ? "Collapsed"
                    : hasTailoringInterview
                    ? isTailorInterviewAwaitingCompletion
                      ? "Ready to finish"
                      : "Questions pending"
                    : isSavingJobDescription
                    ? "Saving..."
                    : jobDescriptionState === "saved"
                      ? "Draft saved"
                      : jobDescriptionState === "dirty"
                        ? "Unsaved changes"
                        : "Draft idle"}
                </StatusPill>
                {isJobStepBlockedByBaseStep ? null : (
                  <button
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                    onClick={toggleJobDescriptionStep}
                    type="button"
                  >
                    {isJobStepOpen ? "Collapse" : "Open step"}
                  </button>
                )}
                {isJobStepOpen ? (
                  <>
                    <button
                      className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                        !isBaseResumeStepComplete ||
                        hasTailoringInterview ||
                        isSavingJobDescription ||
                        !hasUnsavedJobDescriptionChanges
                          ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                          : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                      }`}
                      disabled={
                        !isBaseResumeStepComplete ||
                        hasTailoringInterview ||
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
                        (!hasTailoringInterview && isJobDescriptionLocked) ||
                        (!hasTailoringInterview &&
                          draftJobDescription.trim().length === 0)
                          ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                          : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                      }`}
                      disabled={
                        !openAIReady ||
                        isTailoringResume ||
                        (!hasTailoringInterview && isJobDescriptionLocked) ||
                        (!hasTailoringInterview &&
                          draftJobDescription.trim().length === 0)
                      }
                      onClick={() => void tailorResume()}
                      type="button"
                    >
                      {isTailoringResume
                        ? "Creating..."
                        : hasTailoringInterview
                        ? isTailorInterviewAwaitingCompletion
                          ? "Finish or clarify"
                          : "Resume questions"
                        : "Create tailored resume"}
                    </button>
                    {hasTailoringInterview ? (
                      <button
                        className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                          isCancellingTailorInterview
                            ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                            : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                        }`}
                        disabled={isCancellingTailorInterview}
                        onClick={() => void cancelTailorResumeInterview()}
                        type="button"
                      >
                        {isCancellingTailorInterview ? "Discarding..." : "Discard"}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            {isJobStepOpen ? (
              <textarea
                className={`mt-5 min-h-[180px] w-full flex-1 resize-none rounded-[1.25rem] border px-4 py-4 text-sm leading-6 outline-none transition placeholder:text-zinc-500 ${
                  isJobDescriptionLocked
                    ? "cursor-not-allowed border-white/8 bg-black/10 text-zinc-500"
                    : "border-white/10 bg-black/20 text-zinc-100 focus:border-emerald-300/45"
                }`}
                disabled={isJobDescriptionLocked}
                onChange={handleJobDescriptionChange}
                placeholder={
                  hasTailoringInterview
                    ? "Resume or discard the follow-up questions before editing the description."
                    : "Fallback only: paste job-description snippets here if the Chrome extension cannot read the job page."
                }
                value={draftJobDescription}
              />
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-medium text-zinc-100">
                  {isJobStepBlockedByBaseStep
                    ? "Step 2 is waiting for Step 1."
                    : "Step 2 is collapsed."}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {isJobStepBlockedByBaseStep
                    ? "Finish reviewing the base resume before moving on to job-specific tailoring."
                    : "Open this step when you are ready to tailor from the extension or use the paste fallback."}
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}

      <TailorResumeProgressModal
        isOpen={isPreviewMounted && isTailorResumeProgressOpen}
        latestNotification={tailorResumeGenerationProgress.latestNotification}
        onClose={closeTailorResumeProgress}
        steps={tailorResumeGenerationProgress.steps}
      />

      {isPreviewMounted && isJobDescriptionExtensionNudgeOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[205] flex items-center justify-center bg-black/82 px-4 py-6 backdrop-blur-sm sm:px-6"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsJobDescriptionExtensionNudgeOpen(false);
                }
              }}
            >
              <section
                aria-describedby={jobDescriptionExtensionNudgeDescriptionId}
                aria-modal="true"
                aria-labelledby={jobDescriptionExtensionNudgeTitleId}
                className="glass-panel soft-ring w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl"
                role="dialog"
              >
                <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    Tailor resume
                  </p>
                  <h2
                    className="mt-2 text-xl font-semibold tracking-tight text-zinc-50"
                    id={jobDescriptionExtensionNudgeTitleId}
                  >
                    The Chrome extension is better for this
                  </h2>
                  <p
                    className="mt-3 text-sm leading-6 text-zinc-400"
                    id={jobDescriptionExtensionNudgeDescriptionId}
                  >
                    We encourage using the Chrome extension because it can parse
                    the page better than Cmd A and Cmd V, and it is faster.
                  </p>
                </div>

                <div className="px-5 py-5 sm:px-6">
                  <div className="rounded-[1rem] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-50/88">
                    Pasting here still works as a fallback, but the extension
                    usually captures cleaner job details and the job URL in one
                    pass.
                  </div>

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                      onClick={() => setIsJobDescriptionExtensionNudgeOpen(false)}
                      type="button"
                    >
                      Keep editing
                    </button>
                    <button
                      className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-emerald-300 transition hover:border-emerald-300/35 hover:bg-emerald-400/15"
                      onClick={() => setIsJobDescriptionExtensionNudgeOpen(false)}
                      type="button"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {isPreviewMounted && isTailorInterviewOpen && tailoringInterview
        ? createPortal(
            <div
              className="fixed inset-0 z-[195] flex bg-black/82 px-4 py-6 backdrop-blur-sm sm:px-6"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsTailorInterviewOpen(false);
                }
              }}
            >
              <button
                aria-label="Close tailoring follow-up"
                className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/60"
                onClick={() => setIsTailorInterviewOpen(false)}
                type="button"
              >
                Close
              </button>

              <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
                <section className="glass-panel soft-ring flex max-h-full w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl">
                  <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                          Tailor Resume Follow-Up
                        </p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                          Quick background questions
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-zinc-400">
                          {tailoringInterviewSummary?.agenda
                            ? `The assistant is clarifying ${tailoringInterviewSummary.agenda}.`
                            : "The assistant is gathering a little more adjacent context before rewriting the tailored resume."}
                        </p>
                        {tailoringInterviewSummary?.debugDecision ===
                        "would_ask_without_debug" ? (
                          <p className="mt-2 text-xs leading-5 text-amber-200/85">
                            Debug mode is forcing the interview stage on, but
                            the assistant believes this question would still be
                            worth asking normally.
                          </p>
                        ) : tailoringInterviewSummary?.debugDecision ===
                          "forced_only" ? (
                          <p className="mt-2 text-xs leading-5 text-amber-200/85">
                            Debug mode is forcing the interview stage on, and
                            this question is being asked only because the
                            override requires at least one follow-up.
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <StatusPill>
                          Question{" "}
                          {String(
                            tailoringInterviewSummary?.askedQuestionCount ?? 1,
                          )}
                        </StatusPill>
                        <StatusPill>
                          {tailoringInterviewSummary?.learnings.length ?? 0}{" "}
                          learning
                          {(tailoringInterviewSummary?.learnings.length ?? 0) === 1
                            ? ""
                            : "s"}
                        </StatusPill>
                      </div>
                    </div>
                  </div>

                  <div className="app-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
                    {displayedTailoringInterviewConversation.map((message) => (
                      <div
                        className={`max-w-[85%] rounded-[1.15rem] border px-4 py-3 text-sm leading-6 shadow-[0_18px_40px_rgba(0,0,0,0.18)] ${
                          message.role === "assistant"
                            ? "border-emerald-300/18 bg-emerald-400/10 text-emerald-50"
                            : "ml-auto border-white/10 bg-white/[0.06] text-zinc-100"
                        }`}
                        key={message.id}
                      >
                        <p className="whitespace-pre-wrap">{message.text}</p>
                        <TailorResumeTechnologyContexts
                          contexts={message.technologyContexts}
                          messageId={message.id}
                          openContextKey={openTailorInterviewTechnologyContextKey}
                          setOpenContextKey={
                            setOpenTailorInterviewTechnologyContextKey
                          }
                        />
                        <TailorResumeToolCallDetails toolCalls={message.toolCalls} />
                      </div>
                    ))}
                    {isTailorInterviewThinking ? (
                      streamingInterviewMessage &&
                      (streamingInterviewMessage.text.length > 0 ||
                        streamingInterviewMessage.cards.length > 0) ? (
                        <div className="max-w-[85%] rounded-[1.15rem] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-50 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                          <p className="whitespace-pre-wrap">
                            {streamingInterviewMessage.text}
                            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-300 align-[-1px]" />
                          </p>
                          {streamingInterviewMessage.cards.length > 0 ? (
                            <TailorResumeTechnologyContexts
                              contexts={streamingInterviewMessage.cards}
                              messageId="tailor-interview-streaming"
                              openContextKey={
                                openTailorInterviewTechnologyContextKey
                              }
                              setOpenContextKey={
                                setOpenTailorInterviewTechnologyContextKey
                              }
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div className="max-w-[85%] rounded-[1.15rem] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-50 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                          <ChatThinkingDots label="Job Helper is thinking" />
                        </div>
                      )
                    ) : null}
                    <div ref={tailorInterviewMessagesEndRef} />
                  </div>

                  <div className="border-t border-white/10 px-5 py-5 sm:px-6">
                    <textarea
                      className="min-h-[8.5rem] w-full rounded-[1.1rem] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-300/18"
                      disabled={isTailorInterviewBusy}
                      onKeyDown={handleTailorInterviewAnswerKeyDown}
                      onChange={(event) =>
                        setDraftTailorInterviewAnswer(event.target.value)
                      }
                      placeholder={
                        isTailorInterviewAwaitingCompletion
                          ? "Anything else you want to clarify before we finish?"
                          : "Answer the current question here..."
                      }
                      value={draftTailorInterviewAnswer}
                    />

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs leading-5 text-zinc-500">
                        {isTailorInterviewAwaitingCompletion
                          ? "The assistant thinks it has enough context. You can press Done or send one more clarification before the resume-writing step starts."
                          : "The follow-up stays compact and only the compressed learnings are passed into the next resume-writing step."}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <button
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                            isTailorInterviewBusy
                              ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                              : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10"
                          }`}
                          disabled={isTailorInterviewBusy}
                          onClick={() => void cancelTailorResumeInterview()}
                          type="button"
                        >
                          {isCancellingTailorInterview ? "Discarding..." : "Discard"}
                        </button>
                        <button
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                            isTailorInterviewBusy ||
                            draftTailorInterviewAnswer.trim().length === 0
                              ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                              : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                          }`}
                          disabled={
                            isTailorInterviewBusy ||
                            draftTailorInterviewAnswer.trim().length === 0
                          }
                          onClick={() => void submitTailorResumeInterviewAnswer()}
                          type="button"
                        >
                          {isSubmittingTailorInterviewAnswer
                            ? "Thinking..."
                            : isTailorInterviewAwaitingCompletion
                              ? "Send clarification"
                              : "Send answer"}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isPreviewMounted &&
      isTailorInterviewFinishPromptOpen &&
      tailoringInterview &&
      tailoringInterview.completionRequestedAt
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/86 px-4 py-6 backdrop-blur-sm sm:px-6"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  dismissTailorInterviewFinishPrompt();
                }
              }}
            >
              <section
                aria-describedby={tailorInterviewFinishDescriptionId}
                aria-modal="true"
                aria-labelledby={tailorInterviewFinishTitleId}
                className="glass-panel soft-ring w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl"
                role="dialog"
              >
                <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    Tailor Resume Follow-Up
                  </p>
                  <h2
                    className="mt-2 text-xl font-semibold tracking-tight text-zinc-50"
                    id={tailorInterviewFinishTitleId}
                  >
                    We&apos;d like to end this chat
                  </h2>
                  <p
                    className="mt-3 text-sm leading-6 text-zinc-400"
                    id={tailorInterviewFinishDescriptionId}
                  >
                    The assistant thinks it has enough detail to finish the tailored
                    resume. Press Done to continue, or keep chatting if you want to
                    clarify anything else first.
                  </p>
                </div>

                <div className="px-5 py-5 sm:px-6">
                  <div className="rounded-[1rem] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-50/88">
                    Choosing Done will close the follow-up chat and resume the
                    remaining tailoring steps.
                  </div>

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                      disabled={isFinishingTailorInterview}
                      onClick={dismissTailorInterviewFinishPrompt}
                      type="button"
                    >
                      Keep chatting
                    </button>
                    <button
                      className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                        isFinishingTailorInterview
                          ? "cursor-wait border border-white/10 bg-white/5 text-zinc-500"
                          : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35 hover:bg-emerald-400/15"
                      }`}
                      disabled={isFinishingTailorInterview}
                      onClick={() => void finishTailorResumeInterview()}
                      type="button"
                    >
                      {isFinishingTailorInterview ? "Finishing..." : "Done"}
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {isPreviewMounted && isPreviewOpen && displayedResume
        ? createPortal(
            <div
              className="fixed inset-0 z-[180] flex bg-black/90 backdrop-blur-sm"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsPreviewOpen(false);
                }
              }}
            >
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

      {linkReviewUiEnabled &&
      isPreviewMounted &&
      isLinkEditorOpen &&
      hasEditableOrPendingLinks
        ? createPortal(
            <div
              className="fixed inset-0 z-[190] flex bg-black/82 px-4 py-6 backdrop-blur-sm sm:px-6"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsLinkEditorOpen(false);
                }
              }}
            >
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
