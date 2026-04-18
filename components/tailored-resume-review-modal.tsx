"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import TailoredResumeInteractivePreview from "@/components/tailored-resume-interactive-preview";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { buildTailoredResumeResolvedSegmentMap } from "@/lib/tailor-resume-edit-history";
import { buildTailoredResumeInteractivePreviewQueries } from "@/lib/tailor-resume-preview-focus";
import type {
  TailoredResumeBlockEditRecord,
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";
import {
  buildTailoredResumeDiffRows,
  formatTailoredResumeEditLabel,
  summarizeTailoredResumeEdit,
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

function normalizeComparedTailoredResumeBlock(latexCode: string | null | undefined) {
  return stripTailorResumeSegmentIds(latexCode ?? "").replace(/\n+$/, "");
}

function resolveAcceptedBlockChoice(input: {
  currentLatexCode: string | null;
  selectedEdit: TailoredResumeBlockEditRecord | null;
}) {
  if (!input.selectedEdit) {
    return null;
  }

  const normalizedCurrentLatexCode = normalizeComparedTailoredResumeBlock(
    input.currentLatexCode ??
      (input.selectedEdit.state === "applied"
        ? input.selectedEdit.afterLatexCode
        : input.selectedEdit.beforeLatexCode),
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
const selectedReviewSurfaceClassName =
  "border-emerald-300/38 bg-[linear-gradient(180deg,rgba(52,211,153,0.06),rgba(16,185,129,0.02))] shadow-[0_0_0_1px_rgba(16,185,129,0.12),inset_0_1px_0_rgba(167,243,208,0.05)]";

export default function TailoredResumeReviewModal({
  onClose,
  onTailoredResumesChange,
  record,
}: {
  onClose: () => void;
  onTailoredResumesChange: (
    tailoredResumes: TailorResumeProfile["tailoredResumes"],
  ) => void;
  record: TailoredResumeRecord | null;
}) {
  const [selectedEditId, setSelectedEditId] = useState<string | null>(
    () => record?.edits[0]?.editId ?? null,
  );
  const [editRailScrollState, setEditRailScrollState] = useState(() => ({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  }));
  const [isEditingLatexSegment, setIsEditingLatexSegment] = useState(false);
  const [isThesisOpen, setIsThesisOpen] = useState(false);
  const [interactivePreviewFocusRequest, setInteractivePreviewFocusRequest] =
    useState(0);
  const [draftEditedLatexCode, setDraftEditedLatexCode] = useState("");
  const [suppressedAcceptedBlockChoiceEditId, setSuppressedAcceptedBlockChoiceEditId] =
    useState<string | null>(null);
  const [isSavingTailoredResumeEdit, setIsSavingTailoredResumeEdit] = useState(false);
  const [isRecoveringPreview, setIsRecoveringPreview] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches,
  );
  const editRailRef = useRef<HTMLDivElement | null>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
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

  const resolvedSelectedEditId =
    record?.edits.some((edit) => edit.editId === selectedEditId)
      ? selectedEditId
      : record?.edits[0]?.editId ?? null;
  const selectedEdit = record
    ? resolveSelectedEdit(record.edits, resolvedSelectedEditId)
    : null;

  useEffect(() => {
    if (!record) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isThesisOpen) {
          setIsThesisOpen(false);
          return;
        }

        onClose();
        return;
      }

      if (
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target) ||
        !record.edits.length
      ) {
        return;
      }

      const currentIndex = record.edits.findIndex(
        (edit) => edit.editId === resolvedSelectedEditId,
      );
      const fallbackIndex =
        event.key === "ArrowRight" ? 0 : record.edits.length - 1;
      const targetIndex =
        currentIndex === -1
          ? fallbackIndex
          : event.key === "ArrowRight"
            ? Math.min(currentIndex + 1, record.edits.length - 1)
            : Math.max(currentIndex - 1, 0);
      const targetEditId = record.edits[targetIndex]?.editId;

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
  }, [isThesisOpen, onClose, record, resolvedSelectedEditId]);

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
      (selectedEdit
        ? selectedEdit.state === "applied"
          ? selectedEdit.afterLatexCode
          : selectedEdit.beforeLatexCode
        : null),
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
    () =>
      selectedEdit &&
      suppressedAcceptedBlockChoiceEditId !== selectedEdit.editId
        ? resolveAcceptedBlockChoice({
            currentLatexCode: currentSelectedLatexCode,
            selectedEdit,
          })
        : null,
    [
      currentSelectedLatexCode,
      selectedEdit,
      suppressedAcceptedBlockChoiceEditId,
    ],
  );
  const selectedEditReasonToneClass =
    acceptedBlockChoice === "original"
      ? "border border-rose-300/20 bg-rose-400/8 text-rose-100"
      : acceptedBlockChoice === "tailored"
        ? "border border-emerald-400/20 bg-emerald-400/8 text-emerald-50"
        : "border border-white/10 bg-white/[0.03] text-zinc-100";
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
    if (!record?.edits.length) {
      setSelectedEditId(null);
      setSuppressedAcceptedBlockChoiceEditId(null);
      setIsEditingLatexSegment(false);
      setDraftEditedLatexCode("");
      return;
    }

    if (!record.edits.some((edit) => edit.editId === selectedEditId)) {
      if (suppressedAcceptedBlockChoiceEditId === selectedEditId) {
        return;
      }

      setSelectedEditId(record.edits[0]?.editId ?? null);
    }
  }, [record, selectedEditId, suppressedAcceptedBlockChoiceEditId]);

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
    setIsThesisOpen(false);
  }, [record?.id]);

  useEffect(() => {
    setInteractivePreviewFocusRequest(0);
    setSuppressedAcceptedBlockChoiceEditId(null);
    lastPreviewRecoveryRecordIdRef.current = null;
    setIsRecoveringPreview(false);
  }, [record?.id]);

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

  async function updateSelectedEditState(nextState: "applied" | "rejected") {
    if (!record || !selectedEdit) {
      return;
    }

    setIsSavingTailoredResumeEdit(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "setTailoredResumeEditState",
          editId: selectedEdit.editId,
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
      const nextSelectedEditId = payload.tailoredResumeEditId ?? selectedEdit.editId;
      setSelectedEditId(nextSelectedEditId);
      setSuppressedAcceptedBlockChoiceEditId(nextSelectedEditId);
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

    if (selectedEdit.state === nextState) {
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

  const reviewDetailsPane = (
    <section className="flex h-full min-h-0 flex-col gap-px bg-white/8">
      <div className="shrink-0 bg-zinc-950/96 px-4 py-3 sm:px-5">
        {record.edits.length === 0 ? (
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
                          This tailored resume was saved before thesis
                          summaries were added, so no thesis is available for
                          it.
                        </div>
                      )}
                    </div>
                  ) : null}
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
                    {record.edits.map((edit, index) => {
                      const isSelected = selectedEdit?.editId === edit.editId;

                      return (
                        <div className="flex items-stretch" key={edit.editId}>
                          <button
                            aria-pressed={isSelected}
                            className={`w-[min(21rem,70vw)] snap-start rounded-[1rem] border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-offset-0 sm:w-[17.5rem] xl:w-[18.5rem] ${
                              isSelected
                                ? `${selectedReviewSurfaceClassName} focus-visible:ring-white/15`
                                : "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] hover:border-white/15 hover:bg-white/5 focus-visible:ring-white/20"
                            }`}
                            onClick={() => {
                              setSuppressedAcceptedBlockChoiceEditId(null);
                              selectEdit(edit.editId, {
                                behavior: "smooth",
                              });
                            }}
                            ref={(element) => {
                              if (element) {
                                editButtonRefs.current.set(edit.editId, element);
                                return;
                              }

                              editButtonRefs.current.delete(edit.editId);
                            }}
                            type="button"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
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
                                    {edit.source === "user" ? "User" : "Model"}
                                  </span>
                                  {edit.state === "rejected" ? (
                                    <span className="shrink-0 rounded-full border border-rose-300/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-200">
                                      Rejected
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 line-clamp-2 text-[11px] leading-[1.2rem] text-zinc-400">
                                  {summarizeTailoredResumeEdit(
                                    edit.afterLatexCode || edit.beforeLatexCode,
                                    "Block removed.",
                                  )}
                                </p>
                              </div>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${
                                  isSelected
                                    ? "border-emerald-300/18 text-emerald-200"
                                    : "border-white/10 text-zinc-500"
                                }`}
                              >
                                {index + 1}
                              </span>
                            </div>
                          </button>

                          {index < record.edits.length - 1 ? (
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
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[1.15rem] border border-white/8 bg-black/20 px-3.5 py-3">
              {selectedEdit ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="text-[11px] uppercase tracking-[0.2em] text-zinc-500"
                        title={formatTailoredResumeEditLabel(selectedEdit)}
                      >
                        Why it changed
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {acceptedBlockChoice === "original" ? (
                        <span className="rounded-full border border-rose-300/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-200">
                          Rejected
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className={`mt-2 rounded-[0.95rem] px-3 py-2.5 text-[14px] leading-6 ${selectedEditReasonToneClass}`}>
                    {selectedEdit.reason}
                  </p>
                </>
              ) : (
                <div className="text-sm leading-6 text-zinc-400">
                  Select an edit to review the reasoning and diff.
                </div>
              )}
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
              <p
                className="mt-1 truncate text-sm font-medium text-zinc-100"
                title={record.displayName}
              >
                {record.displayName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-self-start sm:justify-self-end">
              {selectedEdit ? (
                <button
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-500"
                  disabled={!selectedSegmentSnapshot || isSavingTailoredResumeEdit}
                  onClick={startEditingSelectedBlock}
                  title={
                    selectedSegmentSnapshot
                      ? `Edit the selected ${formatTailoredResumeEditLabel(selectedEdit)} block.`
                      : "This block is not available for editing."
                  }
                  type="button"
                >
                  {isEditingLatexSegment ? "Editing" : "Edit"}
                </button>
              ) : null}
              {plainPdfUrl ? (
                <a
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                  href={plainPdfUrl}
                  rel="noreferrer"
                  target="_blank"
                  title="Open the PDF in a new tab."
                >
                  Open PDF
                </a>
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
    </div>,
    document.body,
  );
}
