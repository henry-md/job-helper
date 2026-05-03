"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTailoredResumeDiffRows,
  type TailoredResumeDiffSegment,
} from "@/lib/tailor-resume-review";

type SourceResumeDiffEditorProps = {
  baselineLatexCode: string;
  className?: string;
  disabled?: boolean;
  draftLatexCode: string;
  onChange: (value: string) => void;
};

type DiffSide = "baseline" | "draft";

type DiffScrollSyncState = {
  expectedScrollTop: number;
  frame: number | null;
  ignoredSide: DiffSide | null;
  releaseTimeout: number | null;
};

function clampScrollValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function measureElementTopWithinScrollContainer(
  element: HTMLElement,
  scrollContainer: HTMLElement,
) {
  const elementRect = element.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();

  return elementRect.top - scrollContainerRect.top + scrollContainer.scrollTop;
}

function findVisibleDiffRowAnchor(input: {
  rowElements: Map<number, HTMLElement>;
  scrollContainer: HTMLElement;
}) {
  const sortedRows = [...input.rowElements.entries()].sort(
    ([leftIndex], [rightIndex]) => leftIndex - rightIndex,
  );

  if (sortedRows.length === 0) {
    return null;
  }

  const scrollTop = input.scrollContainer.scrollTop;
  let fallbackAnchor: {
    index: number;
    relativeOffset: number;
  } | null = null;

  for (const [index, rowElement] of sortedRows) {
    const rowTop = measureElementTopWithinScrollContainer(
      rowElement,
      input.scrollContainer,
    );
    const rowHeight = Math.max(rowElement.offsetHeight, 1);
    const rowBottom = rowTop + rowHeight;

    fallbackAnchor = {
      index,
      relativeOffset: 1,
    };

    if (rowBottom < scrollTop + 1) {
      continue;
    }

    return {
      index,
      relativeOffset: clampScrollValue((scrollTop - rowTop) / rowHeight, 0, 1),
    };
  }

  return fallbackAnchor;
}

function clearDiffScrollSyncGuard(state: DiffScrollSyncState) {
  if (state.frame !== null) {
    window.cancelAnimationFrame(state.frame);
    state.frame = null;
  }

  if (state.releaseTimeout !== null) {
    window.clearTimeout(state.releaseTimeout);
    state.releaseTimeout = null;
  }

  state.ignoredSide = null;
}

function syncDiffScrollToAnalogousRow(input: {
  sourceRowElements: Map<number, HTMLElement>;
  sourceScrollContainer: HTMLElement;
  state: DiffScrollSyncState;
  targetRowElements: Map<number, HTMLElement>;
  targetScrollContainer: HTMLElement;
  targetSide: DiffSide;
}) {
  const sourceAnchor = findVisibleDiffRowAnchor({
    rowElements: input.sourceRowElements,
    scrollContainer: input.sourceScrollContainer,
  });

  if (!sourceAnchor) {
    return;
  }

  const targetRowElement = input.targetRowElements.get(sourceAnchor.index);

  if (!targetRowElement) {
    return;
  }

  const targetRowTop = measureElementTopWithinScrollContainer(
    targetRowElement,
    input.targetScrollContainer,
  );
  const targetRowHeight = Math.max(targetRowElement.offsetHeight, 1);
  const maxTargetScrollTop = Math.max(
    0,
    input.targetScrollContainer.scrollHeight -
      input.targetScrollContainer.clientHeight,
  );
  const nextScrollTop = clampScrollValue(
    targetRowTop + targetRowHeight * sourceAnchor.relativeOffset,
    0,
    maxTargetScrollTop,
  );

  if (Math.abs(input.targetScrollContainer.scrollTop - nextScrollTop) < 1) {
    return;
  }

  if (input.state.releaseTimeout !== null) {
    window.clearTimeout(input.state.releaseTimeout);
  }

  input.state.ignoredSide = input.targetSide;
  input.state.expectedScrollTop = nextScrollTop;
  input.targetScrollContainer.scrollTop = nextScrollTop;
  input.state.releaseTimeout = window.setTimeout(() => {
    if (
      input.state.ignoredSide === input.targetSide &&
      Math.abs(input.targetScrollContainer.scrollTop - nextScrollTop) <= 2
    ) {
      input.state.ignoredSide = null;
      input.state.releaseTimeout = null;
    }
  }, 80);
}

function readRowToneClassName(tone: "added" | "context" | "modified" | "removed") {
  if (tone === "added") {
    return "bg-emerald-400/10 text-emerald-100";
  }

  if (tone === "removed") {
    return "bg-rose-400/10 text-rose-100";
  }

  return "bg-black/15 text-zinc-200";
}

function renderDiffSegments(
  segments: TailoredResumeDiffSegment[] | undefined,
  fallbackText: string | null,
  tone: "modified" | "context" | "added" | "removed",
) {
  const hasInlineSegments =
    tone === "modified" && typeof segments !== "undefined" && segments.length > 0;

  if (!hasInlineSegments) {
    return fallbackText ?? " ";
  }

  return segments.map((segment, index) => {
    const segmentClassName =
      segment.type === "added"
        ? "rounded bg-emerald-400/24 text-transparent [box-decoration-break:clone]"
        : segment.type === "removed"
          ? "rounded bg-rose-400/24 text-transparent [box-decoration-break:clone]"
          : segment.type === "context" && tone === "modified"
            ? "text-transparent"
            : "rounded bg-amber-300/24 text-transparent [box-decoration-break:clone]";

    return (
      <span className={segmentClassName} key={`${segment.type}-${index}`}>
        {segment.text}
      </span>
    );
  });
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
              className={`grid min-h-6 w-full grid-cols-[3.25rem_minmax(0,1fr)] text-left transition hover:bg-white/[0.03] ${readRowToneClassName(row.type)}`}
              key={`baseline-${index}`}
              onClick={() => onFocusDraftLine(draftLineNumberByRowIndex.get(index) ?? null)}
              ref={(element) => registerRowRef(index, element)}
              type="button"
            >
              <span className="select-none border-r border-white/8 px-3 text-right font-mono text-[11px] leading-6 text-zinc-500">
                {row.originalLineNumber ?? ""}
              </span>
              <pre className="overflow-x-hidden whitespace-pre-wrap break-words px-3 font-mono text-[12px] leading-6">
                {row.type === "modified"
                  ? renderDiffSegments(
                      row.originalSegments,
                      row.originalText,
                      "modified",
                    )
                  : row.originalText ?? " "}
              </pre>
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
  const baselineRowRefs = useRef(new Map<number, HTMLElement>());
  const draftRowRefs = useRef(new Map<number, HTMLElement>());
  const baselineScrollRef = useRef<HTMLDivElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const diffScrollSyncStateRef = useRef<DiffScrollSyncState>({
    expectedScrollTop: 0,
    frame: null,
    ignoredSide: null,
    releaseTimeout: null,
  });
  const [draftMirrorScrollTop, setDraftMirrorScrollTop] = useState(0);

  const isDirty = baselineLatexCode !== draftLatexCode;
  const draftLineNumberByRowIndex = useMemo(() => {
    return new Map(rows.map((row, index) => [index, row.modifiedLineNumber ?? null]));
  }, [rows]);

  function registerDiffRowRef(
    side: DiffSide,
    index: number,
    element: HTMLElement | null,
  ) {
    const rowRefs = side === "baseline" ? baselineRowRefs.current : draftRowRefs.current;

    if (element) {
      rowRefs.set(index, element);
      return;
    }

    rowRefs.delete(index);
  }

  function handleDiffScroll(sourceSide: DiffSide) {
    const state = diffScrollSyncStateRef.current;
    const sourceScrollContainer =
      sourceSide === "baseline"
        ? baselineScrollRef.current
        : draftTextareaRef.current;

    if (!sourceScrollContainer) {
      return;
    }

    if (sourceSide === "draft") {
      setDraftMirrorScrollTop(sourceScrollContainer.scrollTop);
    }

    if (state.ignoredSide === sourceSide) {
      if (Math.abs(sourceScrollContainer.scrollTop - state.expectedScrollTop) <= 2) {
        return;
      }

      clearDiffScrollSyncGuard(state);
    }

    if (state.frame !== null) {
      window.cancelAnimationFrame(state.frame);
    }

    state.frame = window.requestAnimationFrame(() => {
      const latestState = diffScrollSyncStateRef.current;
      const latestSourceScrollContainer =
        sourceSide === "baseline"
          ? baselineScrollRef.current
          : draftTextareaRef.current;
      const targetSide: DiffSide = sourceSide === "baseline" ? "draft" : "baseline";
      const targetScrollContainer =
        targetSide === "baseline"
          ? baselineScrollRef.current
          : draftTextareaRef.current;

      latestState.frame = null;

      if (!latestSourceScrollContainer || !targetScrollContainer) {
        return;
      }

      syncDiffScrollToAnalogousRow({
        sourceRowElements:
          sourceSide === "baseline"
            ? baselineRowRefs.current
            : draftRowRefs.current,
        sourceScrollContainer: latestSourceScrollContainer,
        state: latestState,
        targetRowElements:
          targetSide === "baseline" ? baselineRowRefs.current : draftRowRefs.current,
        targetScrollContainer,
        targetSide,
      });

      if (targetSide === "draft") {
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
      clearDiffScrollSyncGuard(scrollSyncState);
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
        onScroll={() => handleDiffScroll("baseline")}
        registerRowRef={(index, element) =>
          registerDiffRowRef("baseline", index, element)
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
              {rows.map((row, index) => (
                <div
                  className={`grid min-h-6 grid-cols-[3.25rem_minmax(0,1fr)] ${readRowToneClassName(row.type)}`}
                  key={`draft-${index}`}
                  ref={(element) => registerDiffRowRef("draft", index, element)}
                >
                  <div className="select-none border-r border-white/8 px-3 text-right font-mono text-[11px] leading-6 text-zinc-500">
                    {row.modifiedLineNumber ?? ""}
                  </div>
                  <pre className="overflow-x-hidden whitespace-pre-wrap break-words px-3 font-mono text-[12px] leading-6 text-transparent">
                    {row.type === "modified"
                      ? renderDiffSegments(
                          row.modifiedSegments,
                          row.modifiedText,
                          "modified",
                        )
                      : row.modifiedText ?? " "}
                  </pre>
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
            onScroll={() => handleDiffScroll("draft")}
            ref={draftTextareaRef}
            spellCheck={false}
            style={{
              paddingLeft: "4.75rem",
              paddingRight: "0.75rem",
            }}
            value={draftLatexCode}
          />
        </div>
      </section>
    </div>
  );
}
