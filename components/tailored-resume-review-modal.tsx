"use client";

import { Check, Download, Pencil, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import TailoredResumeInteractivePreview from "@/components/tailored-resume-interactive-preview";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  buildTailoredResumeResolvedSegmentMap,
  buildTailoredResumeReviewEdits,
  resolveTailoredResumeCurrentEditLatexCode,
} from "@/lib/tailor-resume-edit-history";
import { buildTailoredResumeInteractivePreviewQueries } from "@/lib/tailor-resume-preview-focus";
import type {
  TailoredResumeBlockEditRecord,
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";
import {
  buildTailoredResumeDiffRows,
  formatTailoredResumeEditLabel,
  type TailoredResumeDiffSegment,
} from "@/lib/tailor-resume-review";
import {
  buildTailoredResumePreviewPdfUrl,
} from "@/lib/tailored-resume-preview-url";
import { stripTailorResumeSegmentIds } from "@/lib/tailor-resume-segmentation";

function resolveSelectedEdit(
  edits: TailoredResumeBlockEditRecord[],
  selectedEditId: string | null,
) {
  if (edits.length === 0) {
    return null;
  }

  return edits.find((edit) => edit.editId === selectedEditId) ?? edits[0];
}

function summarizeEditRailScrollState(element: HTMLDivElement) {
  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  const hasOverflow = maxScrollLeft > 2;

  return {
    canScrollLeft: hasOverflow && element.scrollLeft > 2,
    canScrollRight: hasOverflow && maxScrollLeft - element.scrollLeft > 2,
    hasOverflow,
  };
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [role='textbox'], [contenteditable]:not([contenteditable='false'])",
    ),
  );
}

type TailoredResumeAcceptedBlockChoice = "original" | "tailored";
type TailoredResumeEditState = TailoredResumeBlockEditRecord["state"];

function normalizeComparedTailoredResumeBlock(latexCode: string | null | undefined) {
  return stripTailorResumeSegmentIds(latexCode ?? "").replace(/\n+$/, "");
}

function resolveAcceptedBlockChoiceFromEditState(
  editState: TailoredResumeEditState | null | undefined,
) {
  if (editState === "rejected") {
    return "original" satisfies TailoredResumeAcceptedBlockChoice;
  }

  if (editState === "applied") {
    return "tailored" satisfies TailoredResumeAcceptedBlockChoice;
  }

  return null;
}

function resolveAcceptedBlockChoice(input: {
  currentLatexCode: string | null;
  selectedEdit: TailoredResumeBlockEditRecord | null;
}) {
  if (!input.selectedEdit) {
    return null;
  }

  const normalizedCurrentLatexCode = normalizeComparedTailoredResumeBlock(
    input.currentLatexCode ?? resolveTailoredResumeCurrentEditLatexCode(input.selectedEdit),
  );

  if (
    normalizedCurrentLatexCode ===
    normalizeComparedTailoredResumeBlock(input.selectedEdit.beforeLatexCode)
  ) {
    return "original" satisfies TailoredResumeAcceptedBlockChoice;
  }

  if (
    normalizedCurrentLatexCode ===
    normalizeComparedTailoredResumeBlock(input.selectedEdit.afterLatexCode)
  ) {
    return "tailored" satisfies TailoredResumeAcceptedBlockChoice;
  }

  return null;
}

function buildTailoredResumeDownloadFilename(displayName: string) {
  const normalizedBaseName = displayName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[ .-]+$/g, "");

  return `${normalizedBaseName || "tailored-resume"}.pdf`;
}

function DiffCell({
  lineNumber,
  segments,
  text,
  tone,
}: {
  lineNumber: number | null;
  segments?: TailoredResumeDiffSegment[];
  text: string | null;
  tone: "added" | "context" | "modified" | "removed";
}) {
  const toneClassName =
    tone === "added"
      ? "bg-emerald-400/10 text-emerald-100"
      : tone === "modified"
        ? "bg-black/15 text-zinc-200"
      : tone === "removed"
        ? "bg-rose-400/10 text-rose-100"
        : "bg-black/15 text-zinc-200";

  const hasInlineSegments = tone === "modified" && (segments?.length ?? 0) > 0;

  return (
    <div
      className={`grid min-h-8 grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-2 px-2.5 py-1.5 ${toneClassName}`}
    >
      <div className="select-none border-r border-white/8 pr-2.5 text-right font-mono text-[10px] leading-[1.15rem] text-zinc-500">
        {lineNumber ?? ""}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.15rem]">
        {hasInlineSegments
          ? segments?.map((segment, index) => {
              const segmentClassName =
                tone === "modified" && segment.type !== "context"
                  ? "rounded [box-decoration-break:clone] bg-amber-300/18 text-amber-50"
                  : segment.type === "added"
                  ? "rounded [box-decoration-break:clone] bg-emerald-400/18 text-emerald-50"
                  : segment.type === "removed"
                    ? "rounded [box-decoration-break:clone] bg-rose-400/18 text-rose-50"
                    : undefined;

              return (
                <span className={segmentClassName} key={`${segment.type}-${index}`}>
                  {segment.text}
                </span>
              );
            })
          : (text ?? " ")}
      </pre>
    </div>
  );
}

type TailoredResumeMutationResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  tailoredResumeEditId?: string;
  tailoredResumeId?: string;
};

const defaultReviewDetailsPaneSize = 58;
const defaultReviewPreviewPaneSize = 42;
const editReasonClampLineCount = 4;
const maxTailoredResumeDisplayNameLength = 200;
const selectedReviewSurfaceClassName =
  "border-emerald-300/38 bg-[linear-gradient(180deg,rgba(52,211,153,0.06),rgba(16,185,129,0.02))] shadow-[0_0_0_1px_rgba(16,185,129,0.12),inset_0_1px_0_rgba(167,243,208,0.05)]";
const inlineMoreButtonClassName =
  "inline-flex translate-y-[-0.04rem] items-center rounded-[0.45rem] border border-emerald-300/35 px-1.5 py-[1px] text-[10px] font-medium leading-[1.05rem] tracking-[0.08em] lowercase text-emerald-200";

function trimInlineReasonPreviewText(reason: string, maxLength: number) {
  if (maxLength >= reason.length) {
    return reason.trimEnd();
  }

  let preview = reason.slice(0, Math.max(0, maxLength)).trimEnd();

  if (!preview) {
    return "";
  }

  const previousWhitespaceIndex = preview.search(/\s\S*$/);

  if (previousWhitespaceIndex >= Math.max(0, preview.length - 18)) {
    preview = preview.slice(0, previousWhitespaceIndex).trimEnd();
  }

  return preview || reason.slice(0, Math.max(1, maxLength)).trimEnd();
}

function TailoredResumeEditSummaryCard({
  displayedEditState,
  edit,
  index,
  isSelected,
  onOpenReason,
  onSelect,
  registerButtonRef,
  totalEdits,
}: {
  displayedEditState: TailoredResumeEditState;
  edit: TailoredResumeBlockEditRecord;
  index: number;
  isSelected: boolean;
  onOpenReason: () => void;
  onSelect: () => void;
  registerButtonRef: (element: HTMLButtonElement | null) => void;
  totalEdits: number;
}) {
  const [reasonPreview, setReasonPreview] = useState(() => ({
    isOverflowing: false,
    text: edit.reason,
  }));
  const reasonMeasureRef = useRef<HTMLParagraphElement | null>(null);
  const reasonMeasureTextRef = useRef<HTMLSpanElement | null>(null);
  const reasonMeasureButtonRef = useRef<HTMLSpanElement | null>(null);
  const reasonShellRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const measureElement = reasonMeasureRef.current;
    const measureTextElement = reasonMeasureTextRef.current;
    const measureButtonElement = reasonMeasureButtonRef.current;
    const shellElement = reasonShellRef.current;

    if (
      !measureElement ||
      !measureTextElement ||
      !measureButtonElement ||
      !shellElement
    ) {
      return;
    }

    const updateOverflowState = () => {
      const computedStyle = window.getComputedStyle(measureElement);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight);
      const shellHeight = shellElement.getBoundingClientRect().height;
      const clampHeight = Number.isFinite(lineHeight)
        ? Math.max(shellHeight, lineHeight * editReasonClampLineCount)
        : Math.max(shellHeight, 80);
      const setMeasuredPreview = (text: string, overflowing: boolean) => {
        measureTextElement.textContent = overflowing ? `${text}... ` : text;
        measureButtonElement.hidden = !overflowing;
      };

      setMeasuredPreview(edit.reason, false);

      if (measureElement.getBoundingClientRect().height <= clampHeight + 1) {
        setReasonPreview((currentPreview) =>
          !currentPreview.isOverflowing && currentPreview.text === edit.reason
            ? currentPreview
            : {
                isOverflowing: false,
                text: edit.reason,
              },
        );
        return;
      }

      let low = 0;
      let high = edit.reason.length;
      let bestFitText = "";

      while (low <= high) {
        const candidateLength = Math.floor((low + high) / 2);
        const candidateText = trimInlineReasonPreviewText(edit.reason, candidateLength);

        setMeasuredPreview(candidateText, true);

        if (measureElement.getBoundingClientRect().height <= clampHeight + 1) {
          bestFitText = candidateText;
          low = candidateLength + 1;
        } else {
          high = candidateLength - 1;
        }
      }

      setReasonPreview((currentPreview) =>
        currentPreview.isOverflowing && currentPreview.text === bestFitText
          ? currentPreview
          : {
              isOverflowing: true,
              text: bestFitText,
            },
      );
    };

    let frame = window.requestAnimationFrame(updateOverflowState);
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateOverflowState);
    });
    resizeObserver.observe(shellElement);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [edit.reason]);

  const editReasonToneClass =
    displayedEditState === "rejected"
      ? "text-rose-100"
      : isSelected
        ? "text-zinc-50"
        : "text-zinc-300";

  return (
    <div className="flex items-stretch">
      <div
        className={`relative h-full w-[min(21rem,70vw)] snap-start overflow-hidden rounded-[1rem] border transition focus-within:ring-1 focus-within:ring-inset focus-within:ring-offset-0 sm:w-[17.5rem] xl:w-[18.5rem] ${
          isSelected
            ? `${selectedReviewSurfaceClassName} focus-within:ring-white/15`
            : "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] hover:border-white/15 hover:bg-white/5 focus-within:ring-white/20"
        }`}
      >
        <button
          aria-label={`Select ${formatTailoredResumeEditLabel(edit)}`}
          aria-pressed={isSelected}
          className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none"
          onClick={onSelect}
          ref={registerButtonRef}
          type="button"
        />

        <div className="relative z-10 flex h-full min-w-0 flex-col px-3 pb-3 pt-3 pointer-events-none">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  isSelected
                    ? "bg-emerald-300 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                    : "bg-zinc-600"
                }`}
              />
              <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-zinc-100">
                {formatTailoredResumeEditLabel(edit)}
              </p>
              <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                {edit.customLatexCode !== null ? "Custom" : "Model"}
              </span>
              {displayedEditState === "rejected" ? (
                <span className="shrink-0 rounded-full border border-rose-300/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-200">
                  Rejected
                </span>
                ) : null}
            </div>

            <div className="relative mt-3 flex min-h-[6.25rem] flex-1" ref={reasonShellRef}>
              <p
                className={`whitespace-pre-wrap break-words text-[13px] leading-5 ${editReasonToneClass}`}
                title={edit.reason}
              >
                {reasonPreview.isOverflowing ? (
                  <>
                    {reasonPreview.text}
                    {"... "}
                    <button
                      aria-label="Show full edit reason"
                      className={`${inlineMoreButtonClassName} pointer-events-auto transition hover:border-emerald-200/55 hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-300/35`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenReason();
                      }}
                      type="button"
                    >
                      more
                    </button>
                  </>
                ) : (
                  reasonPreview.text
                )}
              </p>

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 invisible"
              >
                <p
                  className={`whitespace-pre-wrap break-words text-[13px] leading-5 ${editReasonToneClass}`}
                  ref={reasonMeasureRef}
                >
                  <span ref={reasonMeasureTextRef} />
                  <span
                    className={inlineMoreButtonClassName}
                    hidden
                    ref={reasonMeasureButtonRef}
                  >
                    more
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {index < totalEdits - 1 ? (
        <div
          aria-hidden="true"
          className="flex w-10 shrink-0 items-center justify-center"
        >
          <span className="h-px w-3 bg-gradient-to-r from-transparent via-white/15 to-white/25" />
          <span className="mx-1 h-2 w-2 rounded-full border border-white/20 bg-zinc-700/70" />
          <span className="h-px w-3 bg-gradient-to-r from-white/25 via-white/15 to-transparent" />
        </div>
      ) : null}
    </div>
  );
}

function TailoredResumeDevInspectorSection({
  content,
  emptyState,
  label,
}: {
  content: string | null;
  emptyState: string;
  label: string;
}) {
  const resolvedContent = content?.trim() ? content : null;

  return (
    <details className="group overflow-hidden rounded-[1rem] border border-white/8 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
        <span className="text-sm font-medium text-zinc-100">{label}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition group-open:border-sky-300/25 group-open:bg-sky-400/10 group-open:text-sky-100">
          Toggle
        </span>
      </summary>

      <div className="border-t border-white/8 px-4 py-4">
        {resolvedContent ? (
          <pre className="app-scrollbar max-h-[min(36rem,60vh)] overflow-auto whitespace-pre-wrap break-words rounded-[0.95rem] border border-white/8 bg-zinc-950/80 px-3 py-3 font-mono text-[11px] leading-5 text-zinc-200">
            {resolvedContent}
          </pre>
        ) : (
          <div className="rounded-[0.95rem] border border-white/8 bg-black/20 px-3 py-2.5 text-sm leading-6 text-zinc-300">
            {emptyState}
          </div>
        )}
      </div>
    </details>
  );
}

export default function TailoredResumeReviewModal({
  debugUiEnabled,
  onClose,
  onTailoredResumesChange,
  record,
}: {
  debugUiEnabled: boolean;
  onClose: () => void;
  onTailoredResumesChange: (
    tailoredResumes: TailorResumeProfile["tailoredResumes"],
  ) => void;
  record: TailoredResumeRecord | null;
}) {
  const [selectedEditId, setSelectedEditId] = useState<string | null>(
    () => (record ? buildTailoredResumeReviewEdits(record)[0]?.editId ?? null : null),
  );
  const [editRailScrollState, setEditRailScrollState] = useState(() => ({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  }));
  const [isEditingLatexSegment, setIsEditingLatexSegment] = useState(false);
  const [isRenamingDisplayName, setIsRenamingDisplayName] = useState(false);
  const [isThesisOpen, setIsThesisOpen] = useState(false);
  const [isDevInspectorOpen, setIsDevInspectorOpen] = useState(false);
  const [interactivePreviewFocusRequest, setInteractivePreviewFocusRequest] =
    useState(0);
  const [draftDisplayName, setDraftDisplayName] = useState(
    () => record?.displayName ?? "",
  );
  const [draftEditedLatexCode, setDraftEditedLatexCode] = useState("");
  const [isDownloadingPreviewPdf, setIsDownloadingPreviewPdf] = useState(false);
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false);
  const [optimisticEditStateById, setOptimisticEditStateById] = useState<
    Partial<Record<string, TailoredResumeEditState>>
  >({});
  const [suppressedAcceptedBlockChoiceEditId, setSuppressedAcceptedBlockChoiceEditId] =
    useState<string | null>(null);
  const [isSavingTailoredResumeEdit, setIsSavingTailoredResumeEdit] = useState(false);
  const [isRecoveringPreview, setIsRecoveringPreview] = useState(false);
  const [expandedEditReasonEditId, setExpandedEditReasonEditId] = useState<
    string | null
  >(null);
  const [isWideLayout, setIsWideLayout] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches,
  );
  const editRailRef = useRef<HTMLDivElement | null>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const devInspectorCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedReasonCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const editedLatexTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPreviewRecoveryRecordIdRef = useRef<string | null>(null);
  const thesisPopoverRef = useRef<HTMLDivElement | null>(null);

  function scrollEditIntoView(editId: string, behavior: ScrollBehavior) {
    const editButton = editButtonRefs.current.get(editId);

    if (!editButton) {
      return;
    }

    editButton.scrollIntoView({
      behavior,
      block: "nearest",
      inline: "start",
    });
  }

  function selectEdit(
    editId: string,
    options: {
      behavior?: ScrollBehavior;
      focusButton?: boolean;
    } = {},
  ) {
    setSelectedEditId(editId);
    setIsEditingLatexSegment(false);
    setInteractivePreviewFocusRequest((currentRequest) => currentRequest + 1);

    if (options.focusButton) {
      editButtonRefs.current.get(editId)?.focus({ preventScroll: true });
    }

    scrollEditIntoView(editId, options.behavior ?? "smooth");
  }

  const reviewEdits = useMemo(
    () => (record ? buildTailoredResumeReviewEdits(record) : []),
    [record],
  );
  const resolvedSelectedEditId =
    reviewEdits.some((edit) => edit.editId === selectedEditId)
      ? selectedEditId
      : reviewEdits[0]?.editId ?? null;
  const selectedEdit = resolveSelectedEdit(reviewEdits, resolvedSelectedEditId);
  const selectedEditOptimisticState = selectedEdit
    ? optimisticEditStateById[selectedEdit.editId]
    : undefined;

  useEffect(() => {
    if (!record) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isDevInspectorOpen) {
          setIsDevInspectorOpen(false);
          return;
        }

        if (expandedEditReasonEditId) {
          setExpandedEditReasonEditId(null);
          return;
        }

        if (isThesisOpen) {
          setIsThesisOpen(false);
          return;
        }

        if (isRenamingDisplayName) {
          setDraftDisplayName(record.displayName);
          setIsRenamingDisplayName(false);
          return;
        }

        onClose();
        return;
      }

      if (expandedEditReasonEditId || isDevInspectorOpen) {
        return;
      }

      if (
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target) ||
        reviewEdits.length === 0
      ) {
        return;
      }

      const currentIndex = reviewEdits.findIndex(
        (edit) => edit.editId === resolvedSelectedEditId,
      );
      const fallbackIndex = event.key === "ArrowRight" ? 0 : reviewEdits.length - 1;
      const targetIndex =
        currentIndex === -1
          ? fallbackIndex
          : event.key === "ArrowRight"
            ? Math.min(currentIndex + 1, reviewEdits.length - 1)
            : Math.max(currentIndex - 1, 0);
      const targetEditId = reviewEdits[targetIndex]?.editId;

      if (!targetEditId) {
        return;
      }

      event.preventDefault();
      setSuppressedAcceptedBlockChoiceEditId(null);
      editRailRef.current?.focus({ preventScroll: true });
      setSelectedEditId(targetEditId);
      setIsEditingLatexSegment(false);
      setInteractivePreviewFocusRequest((currentRequest) => currentRequest + 1);
      editButtonRefs.current.get(targetEditId)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    expandedEditReasonEditId,
    isDevInspectorOpen,
    isRenamingDisplayName,
    isThesisOpen,
    onClose,
    record,
    reviewEdits,
    resolvedSelectedEditId,
  ]);

  useEffect(() => {
    if (!record) {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousHtmlOverscrollBehavior = documentElement.style.overscrollBehavior;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    documentElement.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      documentElement.style.overscrollBehavior =
        previousHtmlOverscrollBehavior;
    };
  }, [record]);

  const resolvedSegmentMap = useMemo(
    () => (record ? buildTailoredResumeResolvedSegmentMap(record) : null),
    [record],
  );
  const selectedSegmentSnapshot = useMemo(
    () => resolvedSegmentMap?.get(selectedEdit?.segmentId ?? "") ?? null,
    [resolvedSegmentMap, selectedEdit],
  );
  const currentSelectedLatexCode = useMemo(
    () =>
      selectedSegmentSnapshot?.latexCode ??
      (selectedEdit ? resolveTailoredResumeCurrentEditLatexCode(selectedEdit) : null),
    [selectedEdit, selectedSegmentSnapshot],
  );
  const interactivePreviewQueries = useMemo(
    () => (record ? buildTailoredResumeInteractivePreviewQueries(record) : null),
    [record],
  );
  const diffRows = useMemo(
    () =>
      selectedEdit
        ? buildTailoredResumeDiffRows(
            selectedEdit.beforeLatexCode,
            selectedEdit.afterLatexCode,
          )
        : [],
    [selectedEdit],
  );
  const interactiveFocusQuery = useMemo(
    () =>
      selectedEdit
        ? interactivePreviewQueries?.focusQueryByEditId.get(selectedEdit.editId) ?? null
        : null,
    [interactivePreviewQueries, selectedEdit],
  );
  const acceptedBlockChoice = useMemo(
    () => {
      const optimisticAcceptedBlockChoice =
        resolveAcceptedBlockChoiceFromEditState(selectedEditOptimisticState);

      if (optimisticAcceptedBlockChoice) {
        return optimisticAcceptedBlockChoice;
      }

      return selectedEdit &&
        suppressedAcceptedBlockChoiceEditId !== selectedEdit.editId
        ? resolveAcceptedBlockChoice({
            currentLatexCode: currentSelectedLatexCode,
            selectedEdit,
          })
        : null;
    },
    [
      currentSelectedLatexCode,
      selectedEdit,
      selectedEditOptimisticState,
      suppressedAcceptedBlockChoiceEditId,
    ],
  );
  // Plain PDF URL for the interactive renderer and external PDF link.
  const plainPdfUrl = record ? buildTailoredResumePreviewPdfUrl(record) : null;
  const interactivePreviewUrl = plainPdfUrl;
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
    if (reviewEdits.length === 0) {
      setSelectedEditId(null);
      setSuppressedAcceptedBlockChoiceEditId(null);
      setIsEditingLatexSegment(false);
      setDraftEditedLatexCode("");
      return;
    }

    if (!reviewEdits.some((edit) => edit.editId === selectedEditId)) {
      if (suppressedAcceptedBlockChoiceEditId === selectedEditId) {
        return;
      }

      setSelectedEditId(reviewEdits[0]?.editId ?? null);
    }
  }, [reviewEdits, selectedEditId, suppressedAcceptedBlockChoiceEditId]);

  useEffect(() => {
    if (!record) {
      setOptimisticEditStateById({});
      return;
    }

    setOptimisticEditStateById((currentState) => {
      const entries = Object.entries(currentState);

      if (entries.length === 0) {
        return currentState;
      }

      let didChange = false;
      const nextState: Partial<Record<string, TailoredResumeEditState>> = {};

      for (const [editId, optimisticState] of entries) {
        const matchingEdit = record.edits.find((edit) => edit.editId === editId);

        if (matchingEdit && matchingEdit.state !== optimisticState) {
          nextState[editId] = optimisticState;
          continue;
        }

        didChange = true;
      }

      return didChange ? nextState : currentState;
    });
  }, [record]);

  useEffect(() => {
    if (!isEditingLatexSegment) {
      return;
    }

    setDraftEditedLatexCode(currentSelectedLatexCode ?? "");
  }, [currentSelectedLatexCode, isEditingLatexSegment]);

  useEffect(() => {
    if (!isEditingLatexSegment) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const textarea = editedLatexTextareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();

      if (!isWideLayout) {
        textarea.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isEditingLatexSegment, isWideLayout, selectedEdit?.editId]);

  useEffect(() => {
    setDraftDisplayName(record?.displayName ?? "");
    setIsRenamingDisplayName(false);
    setIsThesisOpen(false);
  }, [record?.displayName, record?.id]);

  useEffect(() => {
    if (!isRenamingDisplayName) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const input = displayNameInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isRenamingDisplayName]);

  useEffect(() => {
    setInteractivePreviewFocusRequest(0);
    setOptimisticEditStateById({});
    setExpandedEditReasonEditId(null);
    setSuppressedAcceptedBlockChoiceEditId(null);
    lastPreviewRecoveryRecordIdRef.current = null;
    setIsRecoveringPreview(false);
  }, [record?.id]);

  useEffect(() => {
    if (
      !expandedEditReasonEditId ||
      reviewEdits.some((edit) => edit.editId === expandedEditReasonEditId)
    ) {
      return;
    }

    setExpandedEditReasonEditId(null);
  }, [expandedEditReasonEditId, reviewEdits]);

  useEffect(() => {
    if (!expandedEditReasonEditId) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      expandedReasonCloseButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [expandedEditReasonEditId]);

  useEffect(() => {
    if (!record || record.pdfUpdatedAt) {
      setIsRecoveringPreview(false);
      return;
    }

    const recordId = record.id;

    if (lastPreviewRecoveryRecordIdRef.current === recordId) {
      return;
    }

    let isCancelled = false;
    lastPreviewRecoveryRecordIdRef.current = recordId;
    setIsRecoveringPreview(true);

    async function ensurePreview() {
      try {
        const response = await fetch("/api/tailor-resume", {
          body: JSON.stringify({
            action: "ensureTailoredResumePreview",
            tailoredResumeId: recordId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        });
        const payload = (await response.json()) as TailoredResumeMutationResponse;

        if (payload.profile && !isCancelled) {
          onTailoredResumesChange(payload.profile.tailoredResumes);
        }

        if (!response.ok) {
          throw new Error(
            payload.error ?? "Unable to compile the tailored resume preview.",
          );
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to compile the tailored resume preview.",
        );
      } finally {
        if (!isCancelled) {
          setIsRecoveringPreview(false);
        }
      }
    }

    void ensurePreview();

    return () => {
      isCancelled = true;
    };
  }, [onTailoredResumesChange, record]);

  useEffect(() => {
    if (!isThesisOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        thesisPopoverRef.current &&
        event.target instanceof Node &&
        !thesisPopoverRef.current.contains(event.target)
      ) {
        setIsThesisOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isThesisOpen]);

  useEffect(() => {
    if (!isDevInspectorOpen) {
      return;
    }

    devInspectorCloseButtonRef.current?.focus();
  }, [isDevInspectorOpen]);

  useEffect(() => {
    setIsDevInspectorOpen(false);
  }, [record?.id]);

  async function updateSelectedEditState(nextState: "applied" | "rejected") {
    if (!record || !selectedEdit) {
      return;
    }

    const targetEditId = selectedEdit.editId;
    setOptimisticEditStateById((currentState) => {
      if (currentState[targetEditId] === nextState) {
        return currentState;
      }

      return {
        ...currentState,
        [targetEditId]: nextState,
      };
    });
    setIsSavingTailoredResumeEdit(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "setTailoredResumeEditState",
          editId: targetEditId,
          state: nextState,
          tailoredResumeId: record.id,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as TailoredResumeMutationResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to update the tailored resume edit.");
      }

      onTailoredResumesChange(payload.profile.tailoredResumes);
      setSuppressedAcceptedBlockChoiceEditId(null);
      setInteractivePreviewFocusRequest((currentRequest) => currentRequest + 1);
    } catch (error) {
      setOptimisticEditStateById((currentState) => {
        if (!(targetEditId in currentState)) {
          return currentState;
        }

        const nextOptimisticState = {
          ...currentState,
        };
        delete nextOptimisticState[targetEditId];
        return nextOptimisticState;
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update the tailored resume edit.",
      );
    } finally {
      setIsSavingTailoredResumeEdit(false);
    }
  }

  async function saveUserEditedLatexSegment() {
    if (!record || !selectedEdit) {
      return;
    }

    setIsSavingTailoredResumeEdit(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "saveTailoredResumeUserEdit",
          latexCode: draftEditedLatexCode,
          segmentId: selectedEdit.segmentId,
          tailoredResumeId: record.id,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as TailoredResumeMutationResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to save your LaTeX block edit.");
      }

      onTailoredResumesChange(payload.profile.tailoredResumes);
      setIsEditingLatexSegment(false);
      setSelectedEditId(selectedEdit.editId);
      setSuppressedAcceptedBlockChoiceEditId(null);
      setInteractivePreviewFocusRequest((currentRequest) => currentRequest + 1);
      toast.success("Saved your block edit.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save your LaTeX block edit.",
      );
    } finally {
      setIsSavingTailoredResumeEdit(false);
    }
  }

  function startRenamingDisplayName() {
    if (!record || isSavingDisplayName) {
      return;
    }

    setDraftDisplayName(record.displayName);
    setIsRenamingDisplayName(true);
  }

  function cancelRenamingDisplayName() {
    setDraftDisplayName(record?.displayName ?? "");
    setIsRenamingDisplayName(false);
  }

  async function saveRenamedDisplayName() {
    if (!record) {
      return;
    }

    const nextDisplayName = draftDisplayName.trim();

    if (!nextDisplayName) {
      toast.error("Add a name for the tailored resume.");
      return;
    }

    if (nextDisplayName.length > maxTailoredResumeDisplayNameLength) {
      toast.error("Keep the tailored resume name under 200 characters.");
      return;
    }

    if (nextDisplayName === record.displayName) {
      setIsRenamingDisplayName(false);
      return;
    }

    setIsSavingDisplayName(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "renameTailoredResume",
          displayName: nextDisplayName,
          tailoredResumeId: record.id,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as TailoredResumeMutationResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to rename the tailored resume.");
      }

      onTailoredResumesChange(payload.profile.tailoredResumes);
      setDraftDisplayName(nextDisplayName);
      setIsRenamingDisplayName(false);
      toast.success("Updated the tailored resume name.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to rename the tailored resume.",
      );
    } finally {
      setIsSavingDisplayName(false);
    }
  }

  async function downloadPreviewPdf() {
    if (!plainPdfUrl || !record || isDownloadingPreviewPdf) {
      return;
    }

    setIsDownloadingPreviewPdf(true);

    try {
      const response = await fetch(plainPdfUrl, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to download the tailored resume PDF.");
      }

      const pdfBlob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = buildTailoredResumeDownloadFilename(record.displayName);
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to download the tailored resume PDF.",
      );
    } finally {
      setIsDownloadingPreviewPdf(false);
    }
  }

  function startEditingSelectedBlock() {
    if (!selectedSegmentSnapshot || isSavingTailoredResumeEdit) {
      return;
    }

    if (isEditingLatexSegment) {
      editedLatexTextareaRef.current?.focus();
      return;
    }

    setDraftEditedLatexCode(currentSelectedLatexCode ?? selectedSegmentSnapshot.latexCode);
    setIsEditingLatexSegment(true);
  }

  function handleAcceptedBlockChoice(choice: TailoredResumeAcceptedBlockChoice) {
    if (!selectedEdit || isEditingLatexSegment || isSavingTailoredResumeEdit) {
      return;
    }

    const nextState = choice === "tailored" ? "applied" : "rejected";

    if (acceptedBlockChoice === choice) {
      setSuppressedAcceptedBlockChoiceEditId(null);
      return;
    }

    void updateSelectedEditState(nextState);
  }

  useEffect(() => {
    const element = editRailRef.current;

    if (!element) {
      setEditRailScrollState({
        canScrollLeft: false,
        canScrollRight: false,
        hasOverflow: false,
      });
      return;
    }

    const updateScrollState = () => {
      setEditRailScrollState(summarizeEditRailScrollState(element));
    };

    updateScrollState();
    element.addEventListener("scroll", updateScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);

    const railContent = element.firstElementChild;
    if (railContent instanceof HTMLElement) {
      resizeObserver.observe(railContent);
    }

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [record?.id, record?.edits.length]);

  if (typeof document === "undefined" || !record) {
    return null;
  }

  const thesisPopoverId = `tailored-resume-thesis-${record.id}`;
  const devInspectorDialogId = `tailored-resume-dev-inspector-${record.id}`;
  const devInspectorDescriptionId = `${devInspectorDialogId}-description`;
  const expandedEditReason =
    reviewEdits.find((edit) => edit.editId === expandedEditReasonEditId) ?? null;
  const expandedEditReasonDialogId = expandedEditReason
    ? `tailored-resume-edit-reason-${record.id}-${expandedEditReason.editId}`
    : null;
  const expandedEditReasonDescriptionId = expandedEditReason
    ? `${expandedEditReasonDialogId}-description`
    : null;

  const reviewDetailsPane = (
    <section className="flex h-full min-h-0 flex-col gap-px bg-white/8">
      <div className="shrink-0 bg-zinc-950/96 px-4 py-3 sm:px-5">
        {reviewEdits.length === 0 ? (
          <div className="rounded-[1.25rem] border border-white/8 bg-black/20 px-4 py-5 text-sm leading-6 text-zinc-400">
            No block-level edit snapshots were saved for this tailored
            resume. The PDF is still available on the right.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="min-h-0 rounded-[1.15rem] border border-white/8 bg-black/20 p-2.5">
              <div className="flex items-start justify-between gap-3 px-1.5 pb-2">
                <p
                  className="pt-1 text-[11px] uppercase tracking-[0.2em] text-zinc-500"
                  title="Browse changed blocks horizontally with clicks or the left and right arrow keys."
                >
                  Changed edits
                </p>

                <div className="flex items-center gap-2">
                  {debugUiEnabled ? (
                    <button
                      aria-controls={devInspectorDialogId}
                      aria-expanded={isDevInspectorOpen}
                      className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] transition ${
                        isDevInspectorOpen
                          ? "border-sky-300/35 bg-sky-400/12 text-sky-100"
                          : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10"
                      }`}
                      onClick={() => {
                        setIsThesisOpen(false);
                        setIsDevInspectorOpen(true);
                      }}
                      title="Show the saved OpenAI calls."
                      type="button"
                    >
                      Dev
                    </button>
                  ) : null}

                  <div className="relative shrink-0" ref={thesisPopoverRef}>
                    <button
                      aria-controls={thesisPopoverId}
                      aria-expanded={isThesisOpen}
                      className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] transition ${
                        isThesisOpen
                          ? "border-emerald-300/30 bg-emerald-400/12 text-emerald-100"
                          : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10"
                      }`}
                      onClick={() => setIsThesisOpen((open) => !open)}
                      title="Show the tailoring thesis."
                      type="button"
                    >
                      Thesis
                    </button>

                    {isThesisOpen ? (
                      <div
                        className="app-scrollbar absolute right-0 top-full z-30 mt-2 w-[min(32rem,calc(100vw-4.5rem))] max-h-[min(34rem,70vh)] overflow-y-auto overscroll-contain rounded-[1rem] border border-white/12 bg-zinc-950/98 p-3 shadow-[0_26px_70px_rgba(0,0,0,0.48)]"
                        id={thesisPopoverId}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                              Tailoring thesis
                            </p>
                            <p className="mt-1 text-sm leading-6 text-zinc-300">
                              What the model focused on in the job description
                              and the broad resume strategy it used.
                            </p>
                          </div>
                          <button
                            className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                            onClick={() => setIsThesisOpen(false)}
                            type="button"
                          >
                            Close
                          </button>
                        </div>

                        {record.thesis ? (
                          <div className="mt-3 space-y-3">
                            <section className="rounded-[0.95rem] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                Job-specific emphasis
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                                {record.thesis.jobDescriptionFocus}
                              </p>
                            </section>

                            <section className="rounded-[0.95rem] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                Resume adaptation
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                                {record.thesis.resumeChanges}
                              </p>
                            </section>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-[0.95rem] border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm leading-6 text-zinc-300">
                            This tailored resume does not have a saved thesis.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="relative">
                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-black/85 via-zinc-950/55 to-transparent transition-opacity ${
                    editRailScrollState.canScrollLeft ? "opacity-100" : "opacity-0"
                  }`}
                />
                <div
                  className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-black/85 via-zinc-950/55 to-transparent transition-opacity ${
                    editRailScrollState.canScrollRight ? "opacity-100" : "opacity-0"
                  }`}
                />

                <div
                  className="app-scrollbar snap-x snap-proximity overflow-x-auto overflow-y-hidden pb-2 outline-none [scroll-padding-inline:0.5rem] [scrollbar-gutter:stable] touch-pan-x"
                  aria-label="Changed edits. Use the left and right arrow keys to navigate."
                  ref={editRailRef}
                  tabIndex={-1}
                >
                  <div className="flex min-w-max items-stretch px-2">
                    {reviewEdits.map((edit, index) => {
                      const displayedEditState =
                        optimisticEditStateById[edit.editId] ?? edit.state;
                      const isSelected = selectedEdit?.editId === edit.editId;

                      return (
                        <TailoredResumeEditSummaryCard
                          displayedEditState={displayedEditState}
                          edit={edit}
                          index={index}
                          isSelected={isSelected}
                          key={edit.editId}
                          onOpenReason={() => {
                            setSuppressedAcceptedBlockChoiceEditId(null);
                            selectEdit(edit.editId, {
                              behavior: "smooth",
                            });
                            setExpandedEditReasonEditId(edit.editId);
                          }}
                          onSelect={() => {
                            setSuppressedAcceptedBlockChoiceEditId(null);
                            selectEdit(edit.editId, {
                              behavior: "smooth",
                            });
                          }}
                          registerButtonRef={(element) => {
                            if (element) {
                              editButtonRefs.current.set(edit.editId, element);
                              return;
                            }

                            editButtonRefs.current.delete(edit.editId);
                          }}
                          totalEdits={reviewEdits.length}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-zinc-950/96 px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-black/20">
          {selectedEdit ? (
            <>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-px rounded-t-[1rem] bg-white/8 p-px">
                <button
                  aria-pressed={acceptedBlockChoice === "original"}
                  className={`flex min-h-0 flex-col overflow-hidden rounded-tl-[1rem] border border-transparent bg-black/15 text-left transition ${
                    acceptedBlockChoice === "original"
                      ? selectedReviewSurfaceClassName
                      : "hover:bg-white/[0.03]"
                  } ${isSavingTailoredResumeEdit || isEditingLatexSegment ? "cursor-not-allowed" : ""}`}
                  disabled={isSavingTailoredResumeEdit || isEditingLatexSegment}
                  onClick={() => handleAcceptedBlockChoice("original")}
                  type="button"
                >
                  <div
                    className={`border-b border-white/8 px-3 py-2 text-[11px] uppercase tracking-[0.18em] ${
                      acceptedBlockChoice === "original"
                        ? "text-emerald-300"
                        : "text-zinc-500"
                    }`}
                  >
                    Original block
                  </div>
                  {diffRows.length > 0 ? (
                    <div className="app-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain">
                      {diffRows.map((row, index) => (
                        <DiffCell
                          key={`original-${index}`}
                          lineNumber={row.originalLineNumber}
                          segments={row.originalSegments}
                          text={row.originalText}
                          tone={
                            row.type === "added"
                              ? "context"
                              : row.type === "modified"
                                ? "modified"
                                : row.type
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-sm text-zinc-400">
                      No visible line changes were recorded for this block.
                    </div>
                  )}
                </button>

                <button
                  aria-pressed={acceptedBlockChoice === "tailored"}
                  className={`flex min-h-0 flex-col overflow-hidden rounded-tr-[1rem] border border-transparent bg-black/15 text-left transition ${
                    acceptedBlockChoice === "tailored"
                      ? selectedReviewSurfaceClassName
                      : "hover:bg-white/[0.03]"
                  } ${isSavingTailoredResumeEdit || isEditingLatexSegment ? "cursor-not-allowed" : ""}`}
                  disabled={isSavingTailoredResumeEdit || isEditingLatexSegment}
                  onClick={() => handleAcceptedBlockChoice("tailored")}
                  type="button"
                >
                  <div
                    className={`border-b border-white/8 px-3 py-2 text-[11px] uppercase tracking-[0.18em] ${
                      acceptedBlockChoice === "tailored"
                        ? "text-emerald-300"
                        : "text-zinc-500"
                    }`}
                  >
                    Tailored block
                  </div>
                  {diffRows.length > 0 ? (
                    <div className="app-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain">
                      {diffRows.map((row, index) => (
                        <DiffCell
                          key={`modified-${index}`}
                          lineNumber={row.modifiedLineNumber}
                          segments={row.modifiedSegments}
                          text={row.modifiedText}
                          tone={
                            row.type === "removed"
                              ? "context"
                              : row.type === "modified"
                                ? "modified"
                                : row.type
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-sm text-zinc-400">
                      No visible line changes were recorded for this block.
                    </div>
                  )}
                </button>
              </div>

              <div className="shrink-0 border-t border-white/8 bg-black/15 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isEditingLatexSegment ? (
                    <>
                      <button
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSavingTailoredResumeEdit}
                        onClick={() => {
                          setIsEditingLatexSegment(false);
                          setDraftEditedLatexCode(
                            selectedSegmentSnapshot?.latexCode ?? "",
                          );
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-200/45 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSavingTailoredResumeEdit}
                        onClick={() => void saveUserEditedLatexSegment()}
                        type="button"
                      >
                        {isSavingTailoredResumeEdit ? "Saving..." : "Done"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingTailoredResumeEdit || !selectedSegmentSnapshot}
                      onClick={startEditingSelectedBlock}
                      type="button"
                    >
                      Edit yourself
                    </button>
                  )}
                </div>

                {isEditingLatexSegment ? (
                  <div className="mt-2 rounded-[1rem] border border-white/10 bg-zinc-950/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Interactive LaTeX segment
                    </p>
                    <textarea
                      className="mt-3 min-h-[10rem] w-full rounded-[1rem] border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[11px] leading-5 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-300/20"
                      onChange={(event) =>
                        setDraftEditedLatexCode(event.target.value)
                      }
                      ref={editedLatexTextareaRef}
                      spellCheck={false}
                      value={draftEditedLatexCode}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-sm text-zinc-400">
              Select an edit to inspect the before and after LaTeX.
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const pdfPreviewPane = (
    <aside className="flex h-full min-h-0 flex-col bg-zinc-950/96 px-4 py-3 sm:px-5 sm:py-5">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-black/20">
        <div className="border-b border-white/8 px-3 py-2">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-4">
            <div className="min-w-0 sm:pr-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Tailored preview
              </p>
              {isRenamingDisplayName ? (
                <form
                  className="mt-1 flex min-w-0 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRenamedDisplayName();
                  }}
                >
                  <input
                    className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-300/20"
                    maxLength={maxTailoredResumeDisplayNameLength}
                    onChange={(event) => setDraftDisplayName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenamingDisplayName();
                      }
                    }}
                    placeholder="Tailored resume name"
                    ref={displayNameInputRef}
                    spellCheck={false}
                    value={draftDisplayName}
                  />
                  <button
                    aria-label="Save tailored resume name"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-300/24 bg-emerald-400/10 text-emerald-100 transition hover:border-emerald-200/40 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingDisplayName}
                    title="Save name"
                    type="submit"
                  >
                    <Check aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    aria-label="Cancel renaming tailored resume"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingDisplayName}
                    onClick={cancelRenamingDisplayName}
                    title="Cancel"
                    type="button"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <div className="mt-1 min-w-0">
                  <p
                    className="truncate text-sm font-medium text-zinc-100"
                    title={record.displayName}
                  >
                    {record.displayName}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-self-start self-center sm:justify-self-end">
              {!isRenamingDisplayName ? (
                <button
                  aria-label={`Rename ${record.displayName}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition hover:border-white/20 hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-500"
                  disabled={isSavingDisplayName}
                  onClick={startRenamingDisplayName}
                  title="Rename tailored resume"
                  type="button"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
              {plainPdfUrl ? (
                <button
                  aria-label="Download tailored resume PDF"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-500"
                  disabled={isDownloadingPreviewPdf}
                  onClick={() => void downloadPreviewPdf()}
                  title="Download the tailored resume PDF."
                  type="button"
                >
                  <Download
                    aria-hidden="true"
                    className={`h-4 w-4 ${isDownloadingPreviewPdf ? "animate-pulse" : ""}`}
                  />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {isRecoveringPreview && !record.pdfUpdatedAt ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-zinc-400">
            <div className="space-y-3">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-emerald-300" />
              <p>Compiling the tailored PDF preview...</p>
            </div>
          </div>
        ) : !record.pdfUpdatedAt && record.status === "failed" ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <div className="max-w-md rounded-[1.1rem] border border-rose-300/14 bg-[linear-gradient(180deg,rgba(251,113,133,0.08),rgba(127,29,29,0.12))] px-5 py-4 text-center text-sm leading-6 text-rose-100/90">
              <p className="font-medium text-rose-50">
                This tailored resume could not be compiled into a PDF preview.
              </p>
              {record.error ? (
                <pre className="mt-3 whitespace-pre-wrap break-words text-left font-mono text-[11px] leading-5 text-rose-100/75">
                  {record.error}
                </pre>
              ) : (
                <p className="mt-2 text-rose-100/75">
                  Try opening the review again after the current edits are saved.
                </p>
              )}
            </div>
          </div>
        ) : interactivePreviewUrl ? (
          <TailoredResumeInteractivePreview
            displayName={record.displayName}
            focusKey={selectedEdit?.editId ?? null}
            focusMatchKey={
              selectedEdit ? `segment:${selectedEdit.segmentId}` : null
            }
            focusQuery={interactiveFocusQuery}
            focusRequest={interactivePreviewFocusRequest}
            highlightQueries={interactivePreviewQueries?.highlightQueries ?? []}
            pdfUrl={interactivePreviewUrl}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-zinc-400">
            This tailored resume does not have a compiled PDF preview yet.
          </div>
        )}
      </div>
    </aside>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[210] flex overflow-hidden bg-black/88 px-4 py-5 backdrop-blur-sm sm:px-6">
        <button
          aria-label="Close tailored resume review"
          className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-zinc-100 transition hover:border-white/30 hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 sm:right-5 sm:top-5"
          onClick={onClose}
          title="Close"
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
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
        </button>

        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] items-center justify-center">
          <section className="glass-panel soft-ring flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl">
            <ResizablePanelGroup
              className="min-h-0 flex-1 bg-zinc-950/96"
              orientation={isWideLayout ? "horizontal" : "vertical"}
            >
              <ResizablePanel
                className="min-h-0 min-w-0 overflow-hidden"
                defaultSize={defaultReviewDetailsPaneSize}
                minSize={isWideLayout ? 40 : 55}
              >
                {reviewDetailsPane}
              </ResizablePanel>

              <ResizableHandle className="group relative bg-transparent after:hidden before:absolute before:bg-white/8 before:content-[''] before:transition-colors focus-visible:ring-0 hover:before:bg-white/15 aria-[orientation=vertical]:w-4 aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:left-1/2 aria-[orientation=vertical]:before:w-px aria-[orientation=vertical]:before:-translate-x-1/2 aria-[orientation=horizontal]:h-4 aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1/2 aria-[orientation=horizontal]:before:h-px aria-[orientation=horizontal]:before:-translate-y-1/2" />

              <ResizablePanel
                className="min-h-0 min-w-0 overflow-hidden"
                defaultSize={defaultReviewPreviewPaneSize}
                minSize={isWideLayout ? 28 : 22}
              >
                {pdfPreviewPane}
              </ResizablePanel>
            </ResizablePanelGroup>
          </section>
        </div>
      </div>

      {debugUiEnabled && isDevInspectorOpen ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/48 p-4 backdrop-blur-[1px] sm:p-5">
          <button
            aria-label="Close saved OpenAI calls"
            className="absolute inset-0"
            onClick={() => setIsDevInspectorOpen(false)}
            type="button"
          />
          <div
            aria-describedby={devInspectorDescriptionId}
            aria-labelledby={devInspectorDialogId}
            aria-modal="true"
            className="relative z-10 flex max-h-[min(46rem,88vh)] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/97 shadow-[0_30px_120px_rgba(0,0,0,0.52)] ring-1 ring-white/10"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Dev inspector
                </p>
                <h2
                  className="mt-2 text-base font-medium text-zinc-50"
                  id={devInspectorDialogId}
                >
                  Saved OpenAI tailoring calls
                </h2>
                <p
                  className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300"
                  id={devInspectorDescriptionId}
                >
                  This shows the persisted stage-1 and stage-2 prompts plus the
                  exact JSON returned for each stage.
                </p>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                onClick={() => setIsDevInspectorOpen(false)}
                ref={devInspectorCloseButtonRef}
                type="button"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span>Close</span>
              </button>
            </div>

            <div className="app-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <TailoredResumeDevInspectorSection
                content={record.openAiDebug.planning.prompt}
                emptyState={
                  record.openAiDebug.planning.skippedReason ??
                  "No saved stage-1 prompt is available for this tailored resume."
                }
                label="First Call Prompt"
              />

              <TailoredResumeDevInspectorSection
                content={record.openAiDebug.planning.outputJson}
                emptyState={
                  record.openAiDebug.planning.skippedReason ??
                  "No saved stage-1 JSON output is available for this tailored resume."
                }
                label="First Call JSON Output"
              />

              <TailoredResumeDevInspectorSection
                content={record.openAiDebug.implementation.prompt}
                emptyState={
                  record.openAiDebug.implementation.skippedReason ??
                  "No saved stage-2 prompt is available for this tailored resume."
                }
                label="Second Call Prompt"
              />

              <TailoredResumeDevInspectorSection
                content={record.openAiDebug.implementation.outputJson}
                emptyState={
                  record.openAiDebug.implementation.skippedReason ??
                  "No saved stage-2 JSON output is available for this tailored resume."
                }
                label="Second Call JSON Output"
              />
            </div>
          </div>
        </div>
      ) : null}

      {expandedEditReason ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/38 p-4 backdrop-blur-[1px] sm:p-5">
          <button
            aria-label="Close full edit reason"
            className="absolute inset-0"
            onClick={() => setExpandedEditReasonEditId(null)}
            type="button"
          />
          <div
            aria-describedby={expandedEditReasonDescriptionId ?? undefined}
            aria-labelledby={expandedEditReasonDialogId ?? undefined}
            aria-modal="true"
            className="relative z-10 flex max-h-[min(42rem,85vh)] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/97 shadow-[0_30px_120px_rgba(0,0,0,0.52)] ring-1 ring-white/10"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Full edit reason
                </p>
                <h2
                  className="mt-2 text-base font-medium text-zinc-50"
                  id={expandedEditReasonDialogId ?? undefined}
                >
                  {formatTailoredResumeEditLabel(expandedEditReason)}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-zinc-400">
                    {expandedEditReason.customLatexCode !== null ? "Custom" : "Model"}
                  </span>
                  {expandedEditReason.state === "rejected" ? (
                    <span className="rounded-full border border-rose-300/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-200">
                      Rejected
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                onClick={() => setExpandedEditReasonEditId(null)}
                ref={expandedReasonCloseButtonRef}
                type="button"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span>Close</span>
              </button>
            </div>

            <div className="app-scrollbar overflow-y-auto px-5 py-4">
              <p
                className={`whitespace-pre-wrap text-sm leading-7 ${
                  expandedEditReason.state === "rejected"
                    ? "text-rose-100"
                    : "text-zinc-100"
                }`}
                id={expandedEditReasonDescriptionId ?? undefined}
              >
                {expandedEditReason.reason}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
