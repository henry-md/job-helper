"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { buildTailoredResumeResolvedSegmentMap } from "@/lib/tailor-resume-edit-history";
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

function buildTailoredResumePreviewPdfUrl(record: TailoredResumeRecord) {
  if (!record.pdfUpdatedAt) {
    return null;
  }

  return `/api/tailor-resume/preview?${new URLSearchParams({
    tailoredResumeId: record.id,
    updatedAt: record.pdfUpdatedAt,
  }).toString()}`;
}

function buildTailoredResumeHighlightedPreviewUrl(record: TailoredResumeRecord) {
  if (!record.pdfUpdatedAt || record.edits.length === 0) {
    return buildTailoredResumePreviewPdfUrl(record);
  }

  return `/api/tailor-resume/preview?${new URLSearchParams({
    highlights: "true",
    tailoredResumeId: record.id,
    updatedAt: record.pdfUpdatedAt,
  }).toString()}`;
}

function buildEmbeddedPdfPreviewUrl(pdfUrl: string | null) {
  if (!pdfUrl) {
    return null;
  }

  // Ask the browser PDF viewer to fit horizontally inside the review pane.
  return `${pdfUrl}#view=FitH`;
}

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
  const [showHighlightedPreview, setShowHighlightedPreview] = useState(
    () => Boolean(record?.edits.length),
  );
  const [draftEditedLatexCode, setDraftEditedLatexCode] = useState("");
  const [isSavingTailoredResumeEdit, setIsSavingTailoredResumeEdit] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(
    () => Boolean(record?.pdfUpdatedAt),
  );
  const [isWideLayout, setIsWideLayout] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches,
  );
  const editRailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!record) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, record]);

  const resolvedSelectedEditId =
    record?.edits.some((edit) => edit.editId === selectedEditId)
      ? selectedEditId
      : record?.edits[0]?.editId ?? null;
  const selectedEdit = record
    ? resolveSelectedEdit(record.edits, resolvedSelectedEditId)
    : null;
  const isSelectedEditRejected = selectedEdit?.state === "rejected";
  const selectedEditActionLabel = isSelectedEditRejected ? "Accept" : "Revert";
  const selectedSegmentSnapshot = useMemo(
    () =>
      record
        ? buildTailoredResumeResolvedSegmentMap(record).get(
            selectedEdit?.segmentId ?? "",
          ) ?? null
        : null,
    [record, selectedEdit],
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
  // Stable URL for the highlighted iframe — does not change when navigating between edits
  const highlightedPreviewUrl = record
    ? buildTailoredResumeHighlightedPreviewUrl(record)
    : null;
  // Plain PDF URL for the Open PDF button
  const plainPdfUrl = record ? buildTailoredResumePreviewPdfUrl(record) : null;
  const canTogglePreviewHighlight = Boolean(
    record &&
      record.edits.length > 0 &&
      highlightedPreviewUrl &&
      plainPdfUrl &&
      highlightedPreviewUrl !== plainPdfUrl,
  );
  const activePreviewUrl =
    showHighlightedPreview && highlightedPreviewUrl
      ? highlightedPreviewUrl
      : plainPdfUrl ?? highlightedPreviewUrl;
  const embeddedPreviewUrl = buildEmbeddedPdfPreviewUrl(activePreviewUrl);

  useEffect(() => {
    setIsPreviewLoading(Boolean(embeddedPreviewUrl));
  }, [embeddedPreviewUrl]);

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
      setIsEditingLatexSegment(false);
      setDraftEditedLatexCode("");
      return;
    }

    if (!record.edits.some((edit) => edit.editId === selectedEditId)) {
      setSelectedEditId(record.edits[0]?.editId ?? null);
    }
  }, [record, selectedEditId]);

  useEffect(() => {
    if (!isEditingLatexSegment) {
      return;
    }

    setDraftEditedLatexCode(selectedSegmentSnapshot?.latexCode ?? "");
  }, [isEditingLatexSegment, selectedSegmentSnapshot]);

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
      toast.success(
        nextState === "rejected"
          ? "Reverted that block edit."
          : "Accepted that block edit.",
      );
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
      setSelectedEditId(payload.tailoredResumeEditId ?? selectedEdit.editId);
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
              <div className="flex items-center justify-between gap-3 px-1.5 pb-2">
                <p
                  className="text-[11px] uppercase tracking-[0.2em] text-zinc-500"
                  title="Browse changed blocks horizontally."
                >
                  Changed edits
                </p>
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
                  className="app-scrollbar snap-x snap-proximity overflow-x-auto overflow-y-hidden pb-2 [scroll-padding-inline:0.5rem] [scrollbar-gutter:stable] touch-pan-x"
                  ref={editRailRef}
                >
                  <div className="flex min-w-max items-stretch px-2">
                    {record.edits.map((edit, index) => {
                      const isSelected = selectedEdit?.editId === edit.editId;

                      return (
                        <div className="flex items-stretch" key={edit.editId}>
                          <button
                            className={`w-[min(21rem,70vw)] snap-start rounded-[1rem] border px-3 py-3 text-left transition sm:w-[17.5rem] xl:w-[18.5rem] ${
                              isSelected
                                ? "border-emerald-300/35 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(6,95,70,0.12))] shadow-[0_14px_36px_rgba(16,185,129,0.12)]"
                                : "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] hover:border-white/15 hover:bg-white/5"
                            }`}
                            onClick={(event) => {
                              setSelectedEditId(edit.editId);
                              setIsEditingLatexSegment(false);
                              event.currentTarget.scrollIntoView({
                                behavior: "smooth",
                                block: "nearest",
                                inline: "center",
                              });
                            }}
                            type="button"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`h-2 w-2 rounded-full ${
                                      isSelected
                                        ? "bg-emerald-300 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]"
                                        : "bg-zinc-600"
                                    }`}
                                  />
                                  <p className="truncate text-[15px] font-medium text-zinc-100">
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
                                    ? "border-emerald-200/20 text-emerald-100"
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
                      {selectedEdit.state === "rejected" ? (
                        <span className="rounded-full border border-rose-300/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-200">
                          Rejected
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p
                    className={`mt-2 rounded-[0.95rem] px-3 py-2.5 text-[14px] leading-6 ${
                      isSelectedEditRejected
                        ? "border border-rose-300/20 bg-rose-400/8 text-rose-100"
                        : "border border-emerald-400/20 bg-emerald-400/8 text-emerald-50"
                    }`}
                  >
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
              <div className="grid grid-cols-2 border-b border-white/8 bg-black/25">
                <div className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Original block
                </div>
                <div className="border-l border-white/8 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Tailored block
                </div>
              </div>

              {diffRows.length > 0 ? (
                <div className="grid min-h-0 flex-1 grid-cols-2 overflow-auto divide-x divide-white/8">
                  <div className="min-h-0">
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
                  <div className="min-h-0">
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
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 py-10 text-sm text-zinc-400">
                  No visible line changes were recorded for this block.
                </div>
              )}

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
                        {isSavingTailoredResumeEdit ? "Saving..." : "Save edit"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSavingTailoredResumeEdit}
                        onClick={() =>
                          updateSelectedEditState(
                            isSelectedEditRejected ? "applied" : "rejected",
                          )}
                        type="button"
                      >
                        {isSavingTailoredResumeEdit ? "Saving..." : selectedEditActionLabel}
                      </button>
                      <button
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSavingTailoredResumeEdit || !selectedSegmentSnapshot}
                        onClick={() => {
                          setDraftEditedLatexCode(
                            selectedSegmentSnapshot?.latexCode ?? "",
                          );
                          setIsEditingLatexSegment(true);
                        }}
                        type="button"
                      >
                        Edit yourself
                      </button>
                    </>
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
                Tailored PDF
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-self-start sm:justify-self-end">
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
              {canTogglePreviewHighlight ? (
                <div className="inline-flex shrink-0 rounded-full border border-white/10 bg-white/5 p-1">
                  <button
                    className={`rounded-full px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] transition ${
                      showHighlightedPreview
                        ? "bg-white text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                    onClick={() => setShowHighlightedPreview(true)}
                    title="Show the highlighted review render."
                    type="button"
                  >
                    Highlighted
                  </button>
                  <button
                    className={`rounded-full px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] transition ${
                      showHighlightedPreview
                        ? "text-zinc-400 hover:text-zinc-200"
                        : "bg-white text-zinc-950"
                    }`}
                    onClick={() => setShowHighlightedPreview(false)}
                    title="Show the clean PDF render."
                    type="button"
                  >
                    Clean
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {embeddedPreviewUrl ? (
          <div className="relative min-h-0 flex-1">
            <iframe
              className="h-full min-h-0 w-full bg-white"
              onLoad={() => setIsPreviewLoading(false)}
              src={embeddedPreviewUrl}
              title={`${record.displayName} preview`}
            />
            {isPreviewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
                <div className="rounded-full border border-white/12 bg-zinc-950/88 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200">
                  {showHighlightedPreview && record.edits.length > 0
                    ? "Rendering highlighted preview..."
                    : "Loading PDF..."}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-zinc-400">
            This tailored resume does not have a compiled PDF preview yet.
          </div>
        )}
      </div>
    </aside>
  );

  return createPortal(
    <div className="fixed inset-0 z-[210] flex bg-black/88 px-4 py-5 backdrop-blur-sm sm:px-6">
      <button
        aria-label="Close tailored resume review"
        className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/65"
        onClick={onClose}
        type="button"
      >
        Close
      </button>

      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-center">
        <section className="glass-panel soft-ring flex h-full w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl">
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
