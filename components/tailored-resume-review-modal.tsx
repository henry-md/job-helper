"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";
import {
  buildTailoredResumeDiffRows,
  formatTailoredResumeEditLabel,
  summarizeTailoredResumeEdit,
  type TailoredResumeDiffSegment,
} from "@/lib/tailor-resume-review";

function buildTailoredResumePreviewPdfUrl(
  record: TailoredResumeRecord,
  options: {
    highlightSegmentId?: string | null;
  } = {},
) {
  if (!record.pdfUpdatedAt) {
    return null;
  }

  const searchParams = new URLSearchParams({
    tailoredResumeId: record.id,
    updatedAt: record.pdfUpdatedAt,
  });

  if (options.highlightSegmentId) {
    searchParams.set("highlightSegmentId", options.highlightSegmentId);
  }

  return `/api/tailor-resume/preview?${searchParams.toString()}`;
}

function resolveSelectedEdit(
  edits: TailoredResumeBlockEditRecord[],
  selectedSegmentId: string | null,
) {
  if (edits.length === 0) {
    return null;
  }

  return edits.find((edit) => edit.segmentId === selectedSegmentId) ?? edits[0];
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
      : tone === "removed"
        ? "bg-rose-400/10 text-rose-100"
        : "bg-black/15 text-zinc-200";

  const hasInlineSegments = tone === "modified" && (segments?.length ?? 0) > 0;

  return (
    <div
      className={`grid min-h-9 grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3 px-3 py-2 ${toneClassName}`}
    >
      <div className="select-none border-r border-white/8 pr-3 text-right font-mono text-[11px] leading-5 text-zinc-500">
        {lineNumber ?? ""}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5">
        {hasInlineSegments
          ? segments?.map((segment, index) => {
              const segmentClassName =
                segment.type === "added"
                  ? "rounded bg-emerald-400/18 text-emerald-50"
                  : segment.type === "removed"
                    ? "rounded bg-rose-400/18 text-rose-50"
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

export default function TailoredResumeReviewModal({
  onClose,
  record,
}: {
  onClose: () => void;
  record: TailoredResumeRecord | null;
}) {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    () => record?.edits[0]?.segmentId ?? null,
  );
  const [isPdfHighlightEnabled, setIsPdfHighlightEnabled] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    setSelectedSegmentId(record?.edits[0]?.segmentId ?? null);
    setIsPdfHighlightEnabled(true);
  }, [record]);

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

  const resolvedSelectedSegmentId =
    record?.edits.some((edit) => edit.segmentId === selectedSegmentId)
      ? selectedSegmentId
      : record?.edits[0]?.segmentId ?? null;
  const selectedEdit = record
    ? resolveSelectedEdit(record.edits, resolvedSelectedSegmentId)
    : null;
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
  const previewUrl = record
    ? buildTailoredResumePreviewPdfUrl(record, {
        highlightSegmentId:
          isPdfHighlightEnabled && selectedEdit ? selectedEdit.segmentId : null,
      })
    : null;

  useEffect(() => {
    setIsPreviewLoading(Boolean(previewUrl));
  }, [previewUrl]);

  if (typeof document === "undefined" || !record) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[210] flex bg-black/88 px-4 py-5 backdrop-blur-sm sm:px-6">
      <button
        aria-label="Close tailored resume review"
        className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/45 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-white/30 hover:bg-black/65"
        onClick={onClose}
        type="button"
      >
        Close
      </button>

      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-center">
        <section className="glass-panel soft-ring flex h-full w-full flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950/96 shadow-[0_30px_120px_rgba(0,0,0,0.58)] ring-1 ring-white/10 backdrop-blur-xl">
          <header className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Tailored resume review
                </p>
                <h2 className="mt-2 truncate text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
                  {record.displayName}
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                  Review the AI-written content edits side by side, then use the
                  PDF to confirm the final layout still looks right.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                  {record.edits.length} edit{record.edits.length === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                  {record.status === "ready" ? "PDF ready" : "Needs review"}
                </span>
                {previewUrl ? (
                  <a
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                    href={previewUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open PDF
                  </a>
                ) : null}
                <button
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                  onClick={async () => {
                    await navigator.clipboard.writeText(record.latexCode);
                    toast.success("Copied tailored LaTeX.");
                  }}
                  type="button"
                >
                  Copy LaTeX
                </button>
              </div>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-px bg-white/8 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <section className="grid min-h-0 gap-px bg-white/8 xl:grid-rows-[auto_minmax(0,1fr)]">
              <div className="min-h-0 bg-zinc-950/96 px-5 py-4 sm:px-6">
                {record.edits.length === 0 ? (
                  <div className="rounded-[1.25rem] border border-white/8 bg-black/20 px-4 py-5 text-sm leading-6 text-zinc-400">
                    No block-level edit snapshots were saved for this tailored
                    resume. The PDF is still available on the right.
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.42fr)_minmax(0,0.58fr)]">
                    <div className="min-h-0 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
                      <p className="px-2 pb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Changed edits
                      </p>
                      <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
                        {record.edits.map((edit, index) => {
                          const isSelected =
                            selectedEdit?.segmentId === edit.segmentId;

                          return (
                            <button
                              key={edit.segmentId}
                              className={`w-full rounded-[1rem] border px-3 py-3 text-left transition ${
                                isSelected
                                  ? "border-emerald-300/35 bg-emerald-400/10"
                                  : "border-white/8 bg-black/10 hover:border-white/15 hover:bg-white/5"
                              }`}
                              onClick={() => setSelectedSegmentId(edit.segmentId)}
                              type="button"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-zinc-100">
                                    {formatTailoredResumeEditLabel(edit)}
                                  </p>
                                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                                    {summarizeTailoredResumeEdit(
                                      edit.afterLatexCode || edit.beforeLatexCode,
                                      "Block removed.",
                                    )}
                                  </p>
                                </div>
                                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                  {index + 1}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 px-4 py-4">
                      {selectedEdit ? (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                                Why it changed
                              </p>
                              <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                                {formatTailoredResumeEditLabel(selectedEdit)}
                              </h3>
                            </div>
                            <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                              {selectedEdit.afterLatexCode.trim().length === 0
                                ? "Removed"
                                : "Updated"}
                            </span>
                          </div>

                          <p className="mt-4 rounded-[1rem] border border-emerald-400/20 bg-emerald-400/8 px-4 py-3 text-sm leading-6 text-emerald-50">
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

              <div className="min-h-0 bg-zinc-950/96 px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-black/20">
                  <div className="grid grid-cols-2 border-b border-white/8 bg-black/25">
                    <div className="px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Original block
                    </div>
                    <div className="border-l border-white/8 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Tailored block
                    </div>
                  </div>

                  {selectedEdit ? (
                    diffRows.length > 0 ? (
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
                    )
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-6 py-10 text-sm text-zinc-400">
                      Select an edit to inspect the before and after LaTeX.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="min-h-0 bg-zinc-950/96 px-5 py-4 sm:px-6 sm:py-6">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-black/20">
                <div className="border-b border-white/8 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        Tailored PDF
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {selectedEdit && isPdfHighlightEnabled
                          ? "Showing a temporary review render with the selected change highlighted."
                          : "Use the rendered PDF to sanity-check spacing, line breaks, and overall presentation after each content edit."}
                      </p>
                    </div>

                    {selectedEdit ? (
                      <button
                        className={`rounded-full border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition ${
                          isPdfHighlightEnabled
                            ? "border-amber-300/35 bg-amber-400/10 text-amber-100 hover:border-amber-200/45 hover:bg-amber-400/14"
                            : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10"
                        }`}
                        onClick={() =>
                          setIsPdfHighlightEnabled((currentValue) => !currentValue)
                        }
                        type="button"
                      >
                        {isPdfHighlightEnabled ? "Highlight on" : "Highlight off"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {previewUrl ? (
                  <div className="relative min-h-0 flex-1">
                    <iframe
                      className="h-full min-h-0 w-full bg-white"
                      onLoad={() => setIsPreviewLoading(false)}
                      src={previewUrl}
                      title={`${record.displayName} preview`}
                    />
                    {isPreviewLoading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
                        <div className="rounded-full border border-white/12 bg-zinc-950/88 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200">
                          {selectedEdit && isPdfHighlightEnabled
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
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
