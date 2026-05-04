"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  clearTailoredResumeDiffBlockScrollSyncGuard,
  createTailoredResumeDiffBlockScrollSyncState,
  syncTailoredResumeDiffBlockScrollToAnalogousRow,
  type TailoredResumeDiffBlockScrollSyncState,
  type TailoredResumeDiffBlockSide,
} from "@/lib/tailor-resume-diff-scroll-sync";
import type { TailoredResumeDiffSegment } from "@/lib/tailor-resume-review";

export function useTailoredResumeDiffScrollSync() {
  const originalScrollRef = useRef<HTMLDivElement | null>(null);
  const tailoredScrollRef = useRef<HTMLDivElement | null>(null);
  const originalRowRefs = useRef(new Map<number, HTMLDivElement>());
  const tailoredRowRefs = useRef(new Map<number, HTMLDivElement>());
  const stateRef = useRef<TailoredResumeDiffBlockScrollSyncState>(
    createTailoredResumeDiffBlockScrollSyncState(),
  );

  const registerRow = useCallback(
    (
      side: TailoredResumeDiffBlockSide,
      index: number,
      element: HTMLDivElement | null,
    ) => {
      const rowRefs =
        side === "original" ? originalRowRefs.current : tailoredRowRefs.current;

      if (element) {
        rowRefs.set(index, element);
        return;
      }

      rowRefs.delete(index);
    },
    [],
  );

  const handleScroll = useCallback(
    (sourceSide: TailoredResumeDiffBlockSide) => {
      const state = stateRef.current;
      const sourceScrollContainer =
        sourceSide === "original"
          ? originalScrollRef.current
          : tailoredScrollRef.current;

      if (!sourceScrollContainer) {
        return;
      }

      if (state.ignoredSide === sourceSide) {
        if (
          Math.abs(sourceScrollContainer.scrollTop - state.expectedScrollTop) <=
          2
        ) {
          return;
        }

        clearTailoredResumeDiffBlockScrollSyncGuard(state);
      }

      if (state.frame !== null) {
        window.cancelAnimationFrame(state.frame);
      }

      state.frame = window.requestAnimationFrame(() => {
        const latestState = stateRef.current;
        const latestSourceScrollContainer =
          sourceSide === "original"
            ? originalScrollRef.current
            : tailoredScrollRef.current;
        const targetSide: TailoredResumeDiffBlockSide =
          sourceSide === "original" ? "tailored" : "original";
        const targetScrollContainer =
          targetSide === "original"
            ? originalScrollRef.current
            : tailoredScrollRef.current;

        latestState.frame = null;

        if (!latestSourceScrollContainer || !targetScrollContainer) {
          return;
        }

        syncTailoredResumeDiffBlockScrollToAnalogousRow({
          sourceRowElements:
            sourceSide === "original"
              ? originalRowRefs.current
              : tailoredRowRefs.current,
          sourceScrollContainer: latestSourceScrollContainer,
          state: latestState,
          targetRowElements:
            targetSide === "original"
              ? originalRowRefs.current
              : tailoredRowRefs.current,
          targetScrollContainer,
          targetSide,
        });
      });
    },
    [],
  );

  const resetScrollAndGuard = useCallback(() => {
    const state = stateRef.current;

    clearTailoredResumeDiffBlockScrollSyncGuard(state);

    if (originalScrollRef.current) {
      originalScrollRef.current.scrollTop = 0;
    }

    if (tailoredScrollRef.current) {
      tailoredScrollRef.current.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    const state = stateRef.current;

    return () => {
      clearTailoredResumeDiffBlockScrollSyncGuard(state);
    };
  }, []);

  return {
    handleScroll,
    originalScrollRef,
    registerRow,
    resetScrollAndGuard,
    tailoredScrollRef,
  };
}

export function TailoredResumeDiffCell({
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
                <span
                  className={segmentClassName}
                  key={`${segment.type}-${index}`}
                >
                  {segment.text}
                </span>
              );
            })
          : (text ?? " ")}
      </pre>
    </div>
  );
}
