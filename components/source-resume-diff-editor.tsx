"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TailoredResumeDiffCell } from "@/components/tailored-resume-diff-pane";
import {
  clearTailoredResumeDiffBlockScrollSyncGuard,
  createTailoredResumeDiffBlockScrollSyncState,
  syncTailoredResumeDiffBlockScrollToAnalogousRow,
  type TailoredResumeDiffBlockScrollSyncState,
} from "@/lib/tailor-resume-diff-scroll-sync";
import { buildTailoredResumeDiffRows } from "@/lib/tailor-resume-review";
import type { TailoredResumeDiffRow } from "@/lib/tailor-resume-review";

type SourceResumeDiffEditorProps = {
  baselineLatexCode: string;
  className?: string;
  disabled?: boolean;
  draftLatexCode: string;
  onChange: (value: string) => void;
};

type SourceDiffSide = "original" | "tailored";

function readSourceResumeDiffTone(
  rowType: TailoredResumeDiffRow["type"],
  side: SourceDiffSide,
) {
  if (side === "original" && rowType === "added") {
    return "context";
  }

  if (side === "tailored" && rowType === "removed") {
    return "context";
  }

  return rowType;
}

function SourceResumeReadonlyDiffPane({
  draftLineNumberByRowIndex,
  onFocusDraftLine,
  onScroll,
  registerRowRef,
  rows,
  scrollRef,
}: {
  draftLineNumberByRowIndex: Map<number, number | null>;
  onFocusDraftLine: (lineNumber: number | null) => void;
  onScroll: () => void;
  registerRowRef: (index: number, element: HTMLElement | null) => void;
  rows: ReturnType<typeof buildTailoredResumeDiffRows>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Original LaTeX
        </p>
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Read only
        </p>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
        <div
          className="app-scrollbar h-full w-full overflow-auto"
          onScroll={onScroll}
          ref={scrollRef}
        >
          {rows.map((row, index) => (
            <button
              className="block w-full text-left transition hover:bg-white/[0.03]"
              key={`baseline-${index}`}
              onClick={() => onFocusDraftLine(draftLineNumberByRowIndex.get(index) ?? null)}
              ref={(element) => registerRowRef(index, element)}
              type="button"
            >
              <TailoredResumeDiffCell
                lineNumber={row.originalLineNumber}
                segments={row.originalSegments}
                text={row.originalText}
                tone={readSourceResumeDiffTone(row.type, "original")}
                variant="source"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SourceResumeDiffEditor({
  baselineLatexCode,
  className,
  disabled = false,
  draftLatexCode,
  onChange,
}: SourceResumeDiffEditorProps) {
  const rows = useMemo(
    () => buildTailoredResumeDiffRows(baselineLatexCode, draftLatexCode),
    [baselineLatexCode, draftLatexCode],
  );
  const draftRows = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.modifiedText === null ? [] : [{ index, row }],
      ),
    [rows],
  );
  const baselineRowRefs = useRef(new Map<number, HTMLElement>());
  const draftRowRefs = useRef(new Map<number, HTMLElement>());
  const baselineScrollRef = useRef<HTMLDivElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const diffScrollSyncStateRef =
    useRef<TailoredResumeDiffBlockScrollSyncState>(
      createTailoredResumeDiffBlockScrollSyncState(),
    );
  const [draftMirrorScrollTop, setDraftMirrorScrollTop] = useState(0);

  const isDirty = baselineLatexCode !== draftLatexCode;
  const draftLineNumberByRowIndex = useMemo(() => {
    return new Map(rows.map((row, index) => [index, row.modifiedLineNumber ?? null]));
  }, [rows]);

  function registerDiffRowRef(
    side: SourceDiffSide,
    index: number,
    element: HTMLElement | null,
  ) {
    const rowRefs =
      side === "original" ? baselineRowRefs.current : draftRowRefs.current;

    if (element) {
      rowRefs.set(index, element);
      return;
    }

    rowRefs.delete(index);
  }

  function handleDiffScroll(sourceSide: SourceDiffSide) {
    const state = diffScrollSyncStateRef.current;
    const sourceScrollContainer =
      sourceSide === "original"
        ? baselineScrollRef.current
        : draftTextareaRef.current;

    if (!sourceScrollContainer) {
      return;
    }

    if (sourceSide === "tailored") {
      setDraftMirrorScrollTop(sourceScrollContainer.scrollTop);
    }

    if (state.ignoredSide === sourceSide) {
      if (Math.abs(sourceScrollContainer.scrollTop - state.expectedScrollTop) <= 2) {
        return;
      }

      clearTailoredResumeDiffBlockScrollSyncGuard(state);
    }

    if (state.frame !== null) {
      window.cancelAnimationFrame(state.frame);
    }

    state.frame = window.requestAnimationFrame(() => {
      const latestState = diffScrollSyncStateRef.current;
      const latestSourceScrollContainer =
        sourceSide === "original"
          ? baselineScrollRef.current
          : draftTextareaRef.current;
      const targetSide: SourceDiffSide =
        sourceSide === "original" ? "tailored" : "original";
      const targetScrollContainer =
        targetSide === "original"
          ? baselineScrollRef.current
          : draftTextareaRef.current;

      latestState.frame = null;

      if (!latestSourceScrollContainer || !targetScrollContainer) {
        return;
      }

      syncTailoredResumeDiffBlockScrollToAnalogousRow({
        sourceRowElements:
          sourceSide === "original"
            ? baselineRowRefs.current
            : draftRowRefs.current,
        sourceScrollContainer: latestSourceScrollContainer,
        state: latestState,
        targetRowElements:
          targetSide === "original"
            ? baselineRowRefs.current
            : draftRowRefs.current,
        targetScrollContainer,
        targetSide,
      });

      if (targetSide === "tailored") {
        setDraftMirrorScrollTop(targetScrollContainer.scrollTop);
      }
    });
  }

  function focusDraftLine(lineNumber: number | null) {
    const textarea = draftTextareaRef.current;

    if (!textarea) {
      return;
    }

    if (lineNumber === null || lineNumber <= 1) {
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      return;
    }

    const lines = draftLatexCode.split("\n");
    const targetLineIndex = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
    let cursor = 0;

    for (let index = 0; index < targetLineIndex; index += 1) {
      cursor += lines[index]?.length ?? 0;
      cursor += 1;
    }

    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  }

  useEffect(() => {
    const scrollSyncState = diffScrollSyncStateRef.current;

    return () => {
      clearTailoredResumeDiffBlockScrollSyncGuard(scrollSyncState);
    };
  }, []);

  if (!isDirty) {
    return (
      <section
        className={`flex min-h-0 flex-1 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 ${className ?? ""}`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            LaTeX Source
          </p>
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
          <textarea
            className={`app-scrollbar min-h-0 w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none placeholder:text-zinc-500 ${
              disabled ? "cursor-not-allowed text-zinc-500 opacity-35" : "text-zinc-100"
            }`}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            value={draftLatexCode}
          />
        </div>
      </section>
    );
  }

  return (
    <div className={`grid min-h-0 grid-cols-2 gap-3 ${className ?? ""}`}>
      <SourceResumeReadonlyDiffPane
        draftLineNumberByRowIndex={draftLineNumberByRowIndex}
        onFocusDraftLine={focusDraftLine}
        onScroll={() => handleDiffScroll("original")}
        registerRowRef={(index, element) =>
          registerDiffRowRef("original", index, element)
        }
        rows={rows}
        scrollRef={baselineScrollRef}
      />

      <section className="flex min-h-0 flex-1 flex-col rounded-[1.25rem] border border-white/8 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Edited LaTeX
          </p>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Live draft
          </p>
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            <div
              className="min-h-full"
              style={{ transform: `translateY(${-draftMirrorScrollTop}px)` }}
            >
              {draftRows.map(({ index, row }) => (
                <div
                  key={`draft-${index}`}
                  ref={(element) => registerDiffRowRef("tailored", index, element)}
                >
                  <TailoredResumeDiffCell
                    lineNumber={row.modifiedLineNumber}
                    segments={row.modifiedSegments}
                    text={row.modifiedText}
                    textMode="transparent"
                    tone={readSourceResumeDiffTone(row.type, "tailored")}
                    variant="source"
                  />
                </div>
              ))}
            </div>
          </div>

          <textarea
            className={`app-scrollbar relative z-10 min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-0 font-mono text-[13px] leading-6 outline-none ${
              disabled ? "cursor-not-allowed text-zinc-500 opacity-35" : "text-zinc-100"
            }`}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onScroll={() => handleDiffScroll("tailored")}
            ref={draftTextareaRef}
            spellCheck={false}
            style={{
              paddingLeft: "4rem",
              paddingRight: "0.75rem",
            }}
            value={draftLatexCode}
          />
        </div>
      </section>
    </div>
  );
}
