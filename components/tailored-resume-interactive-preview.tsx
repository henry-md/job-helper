"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type {
  TailoredResumeInteractivePreviewQuery,
  TailoredResumePreviewFocusQuery,
  TailoredResumePreviewHighlightTone,
} from "@/lib/tailor-resume-preview-focus";
import { resolveTailoredResumePreviewFocusRanges } from "@/lib/tailor-resume-preview-focus";

type PdfJsModule = typeof import("pdfjs-dist/webpack.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;

type TailoredResumeInteractivePreviewProps = {
  displayName: string;
  focusKey: string | null;
  focusMatchKey: string | null;
  focusQuery: TailoredResumePreviewFocusQuery | null;
  focusRequest: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  onPageSnapshot?: (input: { dataUrl: string | null; pageNumber: number }) => void;
  onRenderFailure?: () => void;
  pdfUrl: string | null;
};

type HighlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type PageMatchCharacter = {
  rect: HighlightRect | null;
};

type PageMatchIndex = {
  normalizedText: string;
  positions: PageMatchCharacter[];
};

type LoadedPdfPage = {
  baseHeight: number;
  baseWidth: number;
  page: PDFPageProxy;
  pageNumber: number;
};

type PageHighlightMatch = {
  key: string;
  tone: TailoredResumePreviewHighlightTone;
  rects: HighlightRect[];
};

type PageHighlightSource = {
  pageMatchIndex: PageMatchIndex;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
const interactivePreviewLoadRetryDelays = [150, 400];
const interactivePreviewGuidedFocusDurationMs = 320;
const maxPreviewSnapshotWidth = 1200;

type PreviewSnapshotHighlightTone = "added" | "changed" | "focus";

function waitForInteractivePreviewRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function buildPreviewSnapshotHighlightStyle(tone: PreviewSnapshotHighlightTone) {
  if (tone === "added") {
    return {
      fillStyle: "rgba(34, 197, 94, 0.24)",
      shadowBlur: 18,
      shadowColor: "rgba(22, 163, 74, 0.16)",
      strokeStyle: "rgba(22, 163, 74, 0.2)",
      strokeWidth: 1.2,
    };
  }

  if (tone === "focus") {
    return {
      fillStyle: "rgba(37, 99, 235, 0.18)",
      shadowBlur: 26,
      shadowColor: "rgba(37, 99, 235, 0.2)",
      strokeStyle: "rgba(96, 165, 250, 0.5)",
      strokeWidth: 2,
    };
  }

  return {
    fillStyle: "rgba(245, 158, 11, 0.28)",
    shadowBlur: 20,
    shadowColor: "rgba(217, 119, 6, 0.18)",
    strokeStyle: "rgba(217, 119, 6, 0.24)",
    strokeWidth: 1.2,
  };
}

function appendRoundedRectPath(input: {
  context: CanvasRenderingContext2D;
  height: number;
  left: number;
  radius: number;
  top: number;
  width: number;
}) {
  const right = input.left + input.width;
  const bottom = input.top + input.height;
  const radius = Math.max(
    0,
    Math.min(input.radius, input.width / 2, input.height / 2),
  );

  input.context.beginPath();
  input.context.moveTo(input.left + radius, input.top);
  input.context.lineTo(right - radius, input.top);
  input.context.quadraticCurveTo(right, input.top, right, input.top + radius);
  input.context.lineTo(right, bottom - radius);
  input.context.quadraticCurveTo(right, bottom, right - radius, bottom);
  input.context.lineTo(input.left + radius, bottom);
  input.context.quadraticCurveTo(input.left, bottom, input.left, bottom - radius);
  input.context.lineTo(input.left, input.top + radius);
  input.context.quadraticCurveTo(input.left, input.top, input.left + radius, input.top);
  input.context.closePath();
}

function drawPreviewSnapshotHighlight(input: {
  context: CanvasRenderingContext2D;
  downscaleRatio: number;
  pageHeight: number;
  pageWidth: number;
  rect: HighlightRect;
  tone: PreviewSnapshotHighlightTone;
}) {
  const style = buildPreviewSnapshotHighlightStyle(input.tone);
  const scaleX = input.pageWidth > 0 ? input.downscaleRatio : 1;
  const scaleY = input.pageHeight > 0 ? input.downscaleRatio : 1;
  const left = input.rect.left * scaleX;
  const top = input.rect.top * scaleY;
  const width = input.rect.width * scaleX;
  const height = input.rect.height * scaleY;
  const radius = Math.max(2, Math.min(width, height) * 0.18);

  input.context.save();
  input.context.fillStyle = style.fillStyle;
  input.context.strokeStyle = style.strokeStyle;
  input.context.lineWidth = style.strokeWidth;
  input.context.shadowBlur = style.shadowBlur;
  input.context.shadowColor = style.shadowColor;
  input.context.shadowOffsetX = 0;
  input.context.shadowOffsetY = 0;
  appendRoundedRectPath({
    context: input.context,
    height,
    left,
    radius,
    top,
    width,
  });
  input.context.fill();
  input.context.shadowBlur = 0;
  appendRoundedRectPath({
    context: input.context,
    height,
    left,
    radius,
    top,
    width,
  });
  input.context.stroke();
  input.context.restore();
}

function buildPreviewSnapshotDataUrl(input: {
  canvas: HTMLCanvasElement;
  focusHighlightRects: HighlightRect[];
  includeFocusHighlights: boolean;
  pageHeight: number;
  pageHighlightMatches: PageHighlightMatch[];
  pageWidth: number;
}) {
  const { canvas } = input;
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("Unable to snapshot an empty PDF canvas.");
  }

  const downscaleRatio =
    sourceWidth > maxPreviewSnapshotWidth
      ? maxPreviewSnapshotWidth / sourceWidth
      : 1;

  if (downscaleRatio === 1) {
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = Math.max(1, Math.round(sourceWidth * downscaleRatio));
  exportCanvas.height = Math.max(1, Math.round(sourceHeight * downscaleRatio));

  const exportContext = exportCanvas.getContext("2d");

  if (!exportContext) {
    throw new Error("Unable to create a preview snapshot canvas.");
  }

  exportContext.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);

  for (const match of input.pageHighlightMatches) {
    for (const rect of match.rects) {
      drawPreviewSnapshotHighlight({
        context: exportContext,
        downscaleRatio,
        pageHeight: input.pageHeight,
        pageWidth: input.pageWidth,
        rect,
        tone: match.tone,
      });
    }
  }

  if (input.includeFocusHighlights) {
    for (const rect of input.focusHighlightRects) {
      drawPreviewSnapshotHighlight({
        context: exportContext,
        downscaleRatio,
        pageHeight: input.pageHeight,
        pageWidth: input.pageWidth,
        rect,
        tone: "focus",
      });
    }
  }

  return exportCanvas.toDataURL("image/jpeg", 0.92);
}

function installPdfJsCollectionPolyfills() {
  const mapPrototype = Map.prototype as Map<unknown, unknown> & {
    getOrInsert?: (key: unknown, value: unknown) => unknown;
    getOrInsertComputed?: (
      key: unknown,
      callback: (key: unknown) => unknown,
    ) => unknown;
  };

  if (typeof mapPrototype.getOrInsertComputed !== "function") {
    Object.defineProperty(mapPrototype, "getOrInsertComputed", {
      configurable: true,
      value: function getOrInsertComputed(
        this: Map<unknown, unknown>,
        key: unknown,
        callback: (key: unknown) => unknown,
      ) {
        if (this.has(key)) {
          return this.get(key);
        }

        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
    });
  }

  if (typeof mapPrototype.getOrInsert !== "function") {
    Object.defineProperty(mapPrototype, "getOrInsert", {
      configurable: true,
      value: function getOrInsert(
        this: Map<unknown, unknown>,
        key: unknown,
        value: unknown,
      ) {
        if (this.has(key)) {
          return this.get(key);
        }

        this.set(key, value);
        return value;
      },
      writable: true,
    });
  }

  const weakMapPrototype = WeakMap.prototype as WeakMap<object, unknown> & {
    getOrInsert?: (key: object, value: unknown) => unknown;
    getOrInsertComputed?: (
      key: object,
      callback: (key: object) => unknown,
    ) => unknown;
  };

  if (typeof weakMapPrototype.getOrInsertComputed !== "function") {
    Object.defineProperty(weakMapPrototype, "getOrInsertComputed", {
      configurable: true,
      value: function getOrInsertComputed(
        this: WeakMap<object, unknown>,
        key: object,
        callback: (key: object) => unknown,
      ) {
        if (this.has(key)) {
          return this.get(key);
        }

        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
    });
  }

  if (typeof weakMapPrototype.getOrInsert !== "function") {
    Object.defineProperty(weakMapPrototype, "getOrInsert", {
      configurable: true,
      value: function getOrInsert(
        this: WeakMap<object, unknown>,
        key: object,
        value: unknown,
      ) {
        if (this.has(key)) {
          return this.get(key);
        }

        this.set(key, value);
        return value;
      },
      writable: true,
    });
  }
}

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (typeof window === "undefined") {
    throw new Error("PDF.js is only available in the browser.");
  }

  installPdfJsCollectionPolyfills();
  pdfJsModulePromise ??= import("pdfjs-dist/webpack.mjs");

  return pdfJsModulePromise;
}

function isTextItem(item: TextContent["items"][number]): item is TextItem {
  return "str" in item;
}

function appendNormalizedMatchCharacter(input: {
  char: string;
  normalizedTextParts: string[];
  positions: PageMatchCharacter[];
  previousWasWhitespace: boolean;
  rect: HighlightRect | null;
}) {
  const normalizedCharacters = Array.from(input.char.normalize("NFKC"));
  let previousWasWhitespace = input.previousWasWhitespace;
  const visibleCharacterCount = normalizedCharacters.filter(
    (normalizedCharacter) => !/\s/.test(normalizedCharacter),
  ).length;
  let visibleCharacterIndex = 0;

  for (const normalizedCharacter of normalizedCharacters) {
    if (/\s/.test(normalizedCharacter)) {
      if (!previousWasWhitespace && input.normalizedTextParts.length > 0) {
        input.normalizedTextParts.push(" ");
        input.positions.push({
          rect: null,
        });
        previousWasWhitespace = true;
      }

      continue;
    }

    const nextRect =
      input.rect && visibleCharacterCount > 0
        ? {
            height: input.rect.height,
            left:
              input.rect.left +
              (input.rect.width * visibleCharacterIndex) / visibleCharacterCount,
            top: input.rect.top,
            width: input.rect.width / visibleCharacterCount,
          }
        : input.rect;

    input.normalizedTextParts.push(normalizedCharacter);
    input.positions.push({
      rect: nextRect,
    });
    visibleCharacterIndex += 1;
    previousWasWhitespace = false;
  }

  return previousWasWhitespace;
}

function resolveTextItemRect(input: {
  item: TextItem;
  pdfJs: PdfJsModule;
  textContent: TextContent;
  viewport: PdfPageViewport;
}) {
  if (!input.item.str) {
    return null;
  }

  const transform = input.pdfJs.Util.transform(
    input.viewport.transform,
    input.item.transform,
  );
  const style = input.textContent.styles[input.item.fontName ?? ""];
  const fontHeight = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
  const ascentRatio = style?.ascent ?? (style?.descent ? 1 + style.descent : 0.8);
  const itemWidth =
    Math.abs((style?.vertical ? input.item.height : input.item.width) ?? 0) *
    input.viewport.scale;
  const left = Math.min(transform[4] ?? 0, (transform[4] ?? 0) + itemWidth);
  const width = Math.abs(itemWidth);
  const top = (transform[5] ?? 0) - fontHeight * ascentRatio;

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  return {
    height: Math.max(fontHeight, 1),
    left,
    top,
    width: Math.max(width, 1),
  } satisfies HighlightRect;
}

function buildPageMatchIndex(input: {
  pdfJs: PdfJsModule;
  textContent: TextContent;
  viewport: PdfPageViewport;
}): PageMatchIndex {
  const normalizedTextParts: string[] = [];
  const positions: PageMatchCharacter[] = [];
  let previousWasWhitespace = true;

  for (const item of input.textContent.items) {
    if (!isTextItem(item)) {
      continue;
    }

    const itemCharacters = Array.from(item.str);
    const itemRect = resolveTextItemRect({
      item,
      pdfJs: input.pdfJs,
      textContent: input.textContent,
      viewport: input.viewport,
    });
    const characterWidth =
      itemRect && itemCharacters.length > 0
        ? itemRect.width / itemCharacters.length
        : 0;

    for (const [index, character] of itemCharacters.entries()) {
      previousWasWhitespace = appendNormalizedMatchCharacter({
        char: character,
        normalizedTextParts,
        positions,
        previousWasWhitespace,
        rect:
          itemRect && characterWidth > 0
            ? {
                height: itemRect.height,
                left: itemRect.left + characterWidth * index,
                top: itemRect.top,
                width: characterWidth,
              }
            : itemRect,
      });
    }

    if (item.hasEOL) {
      previousWasWhitespace = appendNormalizedMatchCharacter({
        char: " ",
        normalizedTextParts,
        positions,
        previousWasWhitespace,
        rect: null,
      });
    }
  }

  return {
    normalizedText: normalizedTextParts.join(""),
    positions,
  };
}

function mergeHighlightRects(rects: HighlightRect[]) {
  const mergedRects: HighlightRect[] = [];

  for (const rect of rects) {
    const previousRect = mergedRects.at(-1);

    if (!previousRect) {
      mergedRects.push({ ...rect });
      continue;
    }

    const previousMidline = previousRect.top + previousRect.height / 2;
    const currentMidline = rect.top + rect.height / 2;
    const sameLine =
      Math.abs(previousMidline - currentMidline) <=
      Math.max(previousRect.height, rect.height) * 0.7;
    const gapThreshold = Math.max(
      4,
      Math.min(previousRect.height, rect.height) * 0.75,
    );
    const overlapsOrTouches =
      rect.left <= previousRect.left + previousRect.width + gapThreshold;

    if (!sameLine || !overlapsOrTouches) {
      mergedRects.push({ ...rect });
      continue;
    }

    const nextLeft = Math.min(previousRect.left, rect.left);
    const nextTop = Math.min(previousRect.top, rect.top);
    const nextRight = Math.max(
      previousRect.left + previousRect.width,
      rect.left + rect.width,
    );
    const nextBottom = Math.max(
      previousRect.top + previousRect.height,
      rect.top + rect.height,
    );

    previousRect.left = nextLeft;
    previousRect.top = nextTop;
    previousRect.width = nextRight - nextLeft;
    previousRect.height = nextBottom - nextTop;
  }

  return mergedRects;
}

function buildHighlightRectsForNormalizedSlice(input: {
  end: number;
  pageMatchIndex: PageMatchIndex;
  start: number;
}) {
  if (input.end <= input.start) {
    return null;
  }

  const rects = input.pageMatchIndex.positions
    .slice(input.start, input.end)
    .flatMap((position) =>
      position?.rect && position.rect.width > 0 && position.rect.height > 0
        ? [position.rect]
        : [],
    );

  if (rects.length === 0) {
    return null;
  }

  return mergeHighlightRects(rects);
}

function summarizeHighlightRectGroup(rects: HighlightRect[]) {
  if (rects.length === 0) {
    return null;
  }

  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    height: bottom - top,
    top,
  };
}

function buildInteractivePreviewFocusScrollSignature(input: {
  focusKey: string;
  focusRequest: number;
  rects: HighlightRect[];
}) {
  return `${input.focusKey}:${input.focusRequest}:${input.rects
    .map((rect) =>
      [
        rect.left.toFixed(2),
        rect.top.toFixed(2),
        rect.width.toFixed(2),
        rect.height.toFixed(2),
      ].join(","),
    )
    .join("|")}`;
}

function resolveInteractivePreviewCenteredScrollTop(input: {
  focusGroup: { height: number; top: number };
  pageElement: HTMLDivElement;
  scrollContainer: HTMLDivElement;
}) {
  const maxScrollTop = Math.max(
    0,
    input.scrollContainer.scrollHeight - input.scrollContainer.clientHeight,
  );

  if (maxScrollTop === 0) {
    return 0;
  }

  const pageRect = input.pageElement.getBoundingClientRect();
  const scrollContainerRect = input.scrollContainer.getBoundingClientRect();
  const pageTopWithinScrollContent =
    pageRect.top - scrollContainerRect.top + input.scrollContainer.scrollTop;
  const focusCenterWithinScrollContent =
    pageTopWithinScrollContent +
    input.focusGroup.top +
    input.focusGroup.height / 2;
  const idealScrollTop =
    focusCenterWithinScrollContent - input.scrollContainer.clientHeight / 2;

  return Math.max(0, Math.min(idealScrollTop, maxScrollTop));
}

function buildFocusRects(input: {
  focusQuery: TailoredResumePreviewFocusQuery | null;
  pageMatchIndex: PageMatchIndex;
}) {
  const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
    pageText: input.pageMatchIndex.normalizedText,
    query: input.focusQuery,
  });

  return resolvedRanges.flatMap((range) => {
    const rects = buildHighlightRectsForNormalizedSlice({
      end: range.end,
      pageMatchIndex: input.pageMatchIndex,
      start: range.start,
    });

    if (!rects) {
      return [];
    }

    return rects;
  });
}

function buildPageHighlightMatches(input: {
  pageMatchIndex: PageMatchIndex;
  queries: TailoredResumeInteractivePreviewQuery[];
}) {
  return input.queries.flatMap((entry) => {
    const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
      pageText: input.pageMatchIndex.normalizedText,
      query: entry.query,
    });

    return resolvedRanges.flatMap((range, index) => {
      const rects = buildHighlightRectsForNormalizedSlice({
        end: range.end,
        pageMatchIndex: input.pageMatchIndex,
        start: range.start,
      });

      if (!rects) {
        return [];
      }

      return [
        {
          key: `${entry.key}:${index}`,
          rects,
          tone: range.tone,
        } satisfies PageHighlightMatch,
      ];
    });
  });
}

function buildFocusRectsFromPageHighlightMatches(input: {
  focusMatchKey: string | null;
  pageHighlightMatches: PageHighlightMatch[];
}) {
  if (!input.focusMatchKey) {
    return [];
  }

  return input.pageHighlightMatches.flatMap((match) =>
    match.key.startsWith(`${input.focusMatchKey}:`) ? match.rects : [],
  );
}

function InteractivePreviewPage({
  focusActive,
  focusKey,
  focusMatchKey,
  focusQuery,
  focusRequest,
  highlightQueries,
  onPageSnapshot,
  onRenderFailure,
  page,
  scale,
  scrollContainerRef,
}: {
  focusActive: boolean;
  focusKey: string | null;
  focusMatchKey: string | null;
  focusQuery: TailoredResumePreviewFocusQuery | null;
  focusRequest: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  onPageSnapshot?: (input: { dataUrl: string | null; pageNumber: number }) => void;
  onRenderFailure?: () => void;
  page: LoadedPdfPage;
  scale: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [focusHighlightRects, setFocusHighlightRects] = useState<HighlightRect[]>([]);
  const [pageHighlightMatches, setPageHighlightMatches] = useState<PageHighlightMatch[]>(
    [],
  );
  const [guidedFocusToken, setGuidedFocusToken] = useState<string | null>(null);
  const [highlightSource, setHighlightSource] = useState<PageHighlightSource | null>(
    null,
  );
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const pageHeight = page.baseHeight * scale;
  const pageWidth = page.baseWidth * scale;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastScrolledFocusSignatureRef = useRef<string | null>(null);
  const emitPageSnapshot = useEffectEvent(
    (input: { dataUrl: string | null; pageNumber: number }) => {
      onPageSnapshot?.(input);
    },
  );

  // Recompute overlays without repainting the underlying PDF page on every edit click.
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!pageRef.current || !canvas) {
      return;
    }

    const resolvedCanvas = canvas;
    let isCancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setRenderState("loading");
      setFocusHighlightRects([]);
      setHighlightSource(null);
      setPageHighlightMatches([]);
      setRenderErrorMessage(null);

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const viewport = page.page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const canvasContext = resolvedCanvas.getContext("2d");

        if (!canvasContext) {
          throw new Error("Unable to create a canvas rendering context.");
        }

        resolvedCanvas.width = Math.floor(viewport.width * outputScale);
        resolvedCanvas.height = Math.floor(viewport.height * outputScale);
        resolvedCanvas.style.width = `${viewport.width}px`;
        resolvedCanvas.style.height = `${viewport.height}px`;

        renderTask = page.page.render({
          canvas: resolvedCanvas,
          canvasContext,
          transform:
            outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        await renderTask.promise;

        if (isCancelled) {
          return;
        }

        const textContent = await page.page.getTextContent();

        if (isCancelled) {
          return;
        }

        try {
          setHighlightSource({
            pageMatchIndex: buildPageMatchIndex({
              pdfJs,
              textContent,
              viewport,
            }),
          });
        } catch (highlightError) {
          console.warn(
            "Unable to prepare interactive preview highlights.",
            highlightError,
          );
        }

        setRenderState("ready");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setFocusHighlightRects([]);
        setHighlightSource(null);
        setPageHighlightMatches([]);
        setRenderErrorMessage(
          error instanceof Error ? error.message : "Unknown PDF rendering error.",
        );
        setRenderState("error");
        onRenderFailure?.();
      }
    }

    void renderPage();

    return () => {
      isCancelled = true;
      renderTask?.cancel?.();
    };
  }, [onRenderFailure, page.page, scale]);

  useEffect(() => {
    if (!pageRef.current || !highlightSource) {
      setFocusHighlightRects([]);
      setPageHighlightMatches([]);
      return;
    }

    try {
      const nextPageHighlightMatches = buildPageHighlightMatches({
        pageMatchIndex: highlightSource.pageMatchIndex,
        queries: highlightQueries,
      });
      const nextFocusHighlightRects =
        buildFocusRectsFromPageHighlightMatches({
          focusMatchKey,
          pageHighlightMatches: nextPageHighlightMatches,
        });

      setPageHighlightMatches(nextPageHighlightMatches);
      setFocusHighlightRects(
        nextFocusHighlightRects.length > 0
          ? nextFocusHighlightRects
          : buildFocusRects({
              focusQuery,
              pageMatchIndex: highlightSource.pageMatchIndex,
            }),
      );
    } catch (highlightError) {
      console.warn(
        "Unable to compute interactive preview highlights.",
        highlightError,
      );
      setFocusHighlightRects([]);
      setPageHighlightMatches([]);
    }
  }, [focusMatchKey, focusQuery, highlightQueries, highlightSource]);

  useEffect(() => {
    const shouldIncludeFocusHighlight =
      focusActive &&
      focusHighlightRects.length > 0 &&
      guidedFocusToken === `${focusKey}:${focusRequest}`;

    if (renderState !== "ready") {
      emitPageSnapshot({
        dataUrl: null,
        pageNumber: page.pageNumber,
      });
      return;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
      emitPageSnapshot({
        dataUrl: null,
        pageNumber: page.pageNumber,
      });
      return;
    }

    try {
      emitPageSnapshot({
        dataUrl: buildPreviewSnapshotDataUrl({
          canvas,
          focusHighlightRects,
          includeFocusHighlights: shouldIncludeFocusHighlight,
          pageHeight,
          pageHighlightMatches,
          pageWidth,
        }),
        pageNumber: page.pageNumber,
      });
    } catch (snapshotError) {
      console.warn("Unable to snapshot the interactive preview canvas.", snapshotError);
      emitPageSnapshot({
        dataUrl: null,
        pageNumber: page.pageNumber,
      });
    }
  }, [
    focusActive,
    focusHighlightRects,
    focusKey,
    focusRequest,
    guidedFocusToken,
    page.pageNumber,
    pageHeight,
    pageHighlightMatches,
    pageWidth,
    renderState,
  ]);

  useEffect(() => {
    if (!focusActive || !focusKey || focusHighlightRects.length === 0) {
      setGuidedFocusToken(null);
      return;
    }

    const focusToken = `${focusKey}:${focusRequest}`;
    const focusScrollSignature = buildInteractivePreviewFocusScrollSignature({
      focusKey,
      focusRequest,
      rects: focusHighlightRects,
    });

    setGuidedFocusToken(focusToken);

    const pageElement = pageRef.current;
    const scrollContainer = scrollContainerRef.current;
    const focusGroup = summarizeHighlightRectGroup(focusHighlightRects);

    if (
      lastScrolledFocusSignatureRef.current === focusScrollSignature ||
      !pageElement ||
      !scrollContainer ||
      !focusGroup
    ) {
      const clearFocusTimer = window.setTimeout(() => {
        setGuidedFocusToken((currentToken) =>
          currentToken === focusToken ? null : currentToken,
        );
      }, interactivePreviewGuidedFocusDurationMs);

      return () => {
        window.clearTimeout(clearFocusTimer);
      };
    }

    lastScrolledFocusSignatureRef.current = focusScrollSignature;

    const clampedScrollTop = resolveInteractivePreviewCenteredScrollTop({
      focusGroup,
      pageElement,
      scrollContainer,
    });

    scrollContainer.scrollTo({
      behavior: "smooth",
      top: clampedScrollTop,
    });

    const clearFocusTimer = window.setTimeout(() => {
      setGuidedFocusToken((currentToken) =>
        currentToken === focusToken ? null : currentToken,
      );
    }, interactivePreviewGuidedFocusDurationMs);

    return () => {
      window.clearTimeout(clearFocusTimer);
    };
  }, [focusActive, focusHighlightRects, focusKey, focusRequest, scrollContainerRef]);

  return (
    <div
      className="resume-interactive-page relative overflow-hidden rounded-[0.35rem] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.24)]"
      ref={pageRef}
      style={{
        height: `${pageHeight}px`,
        width: `${pageWidth}px`,
        ["--scale-factor" as string]: `${scale}`,
      }}
    >
      <canvas ref={canvasRef} />
      {pageHighlightMatches.length > 0 ? (
        <div className="pointer-events-none absolute inset-0">
          {pageHighlightMatches.flatMap((match) =>
            match.rects.map((rect, index) => (
              <div
                className={`resume-interactive-highlight ${
                  match.tone === "changed"
                    ? "resume-interactive-highlight--changed"
                    : "resume-interactive-highlight--added"
                }`}
                key={`steady-${match.key}-${page.pageNumber}-${index}`}
                style={{
                  height: `${rect.height}px`,
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                }}
              />
            )),
          )}
        </div>
      ) : null}
      {focusActive &&
      focusHighlightRects.length > 0 &&
      guidedFocusToken === `${focusKey}:${focusRequest}` ? (
        <div className="pointer-events-none absolute inset-0">
          {focusHighlightRects.map((rect, index) => (
            <div
              className="resume-interactive-highlight resume-interactive-highlight--focus resume-interactive-highlight--guided resume-interactive-highlight--animated"
              data-tailor-resume-active-highlight={index === 0 ? "true" : undefined}
              key={`${focusKey ?? "steady"}-${focusRequest}-${page.pageNumber}-${index}`}
              style={{
                height: `${rect.height}px`,
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
              }}
            />
          ))}
        </div>
      ) : null}
      {renderState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/72">
          <div className="rounded-full border border-zinc-200 bg-white/95 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-zinc-700 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
            Building interactive preview...
          </div>
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/88 px-5 text-center text-sm leading-6 text-zinc-600">
          <div className="max-w-sm space-y-3">
            <p>The interactive renderer could not paint this page.</p>
            {renderErrorMessage ? (
              <pre className="whitespace-pre-wrap break-words rounded-2xl border border-zinc-200 bg-white/92 px-4 py-3 text-left font-mono text-[11px] leading-5 text-zinc-500 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                {renderErrorMessage}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TailoredResumeInteractivePreview({
  displayName,
  focusRequest,
  focusKey,
  focusMatchKey,
  focusQuery,
  highlightQueries,
  onPageSnapshot,
  onRenderFailure,
  pdfUrl,
}: TailoredResumeInteractivePreviewProps) {
  const [loadedPages, setLoadedPages] = useState<LoadedPdfPage[]>([]);
  const [documentState, setDocumentState] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      setContainerWidth(entry?.contentRect.width ?? 0);
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pdfUrl) {
      return;
    }

    const resolvedPdfUrl = pdfUrl;
    let isCancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadDocument() {
      setDocumentState("loading");

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const retryDelays = [0, ...interactivePreviewLoadRetryDelays];
        let lastError: unknown = null;

        for (const [attemptIndex, retryDelay] of retryDelays.entries()) {
          if (retryDelay > 0) {
            await waitForInteractivePreviewRetry(retryDelay);
          }

          if (isCancelled) {
            return;
          }

          try {
            loadingTask = pdfJs.getDocument(resolvedPdfUrl);
            const pdfDocument = (await loadingTask.promise) as PDFDocumentProxy;
            const nextLoadedPages: LoadedPdfPage[] = [];

            for (
              let pageNumber = 1;
              pageNumber <= pdfDocument.numPages;
              pageNumber += 1
            ) {
              const page = await pdfDocument.getPage(pageNumber);
              const viewport = page.getViewport({ scale: 1 });

              nextLoadedPages.push({
                baseHeight: viewport.height,
                baseWidth: viewport.width,
                page,
                pageNumber,
              });
            }

            if (isCancelled) {
              return;
            }

            setLoadedPages(nextLoadedPages);
            setDocumentState("ready");
            return;
          } catch (error) {
            if (isCancelled) {
              return;
            }

            lastError = error;
            loadingTask = null;

            if (attemptIndex < retryDelays.length - 1) {
              console.warn(
                "Retrying interactive preview document load after a transient failure.",
                error,
              );
              continue;
            }
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("Unable to load the interactive preview PDF.");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setLoadedPages([]);
        setDocumentState("error");
        onRenderFailure?.();
      }
    }

    void loadDocument();

    return () => {
      isCancelled = true;
      loadingTask?.destroy();
    };
  }, [onRenderFailure, pdfUrl]);

  const pageScale = useMemo(() => {
    const firstPageWidth = loadedPages[0]?.baseWidth;

    if (!firstPageWidth || !containerWidth) {
      return 1;
    }

    return Math.max(0.4, (containerWidth - 8) / firstPageWidth);
  }, [containerWidth, loadedPages]);

  if (!pdfUrl) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-zinc-500">
        This tailored resume does not have a compiled PDF preview yet.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#f6f6f7,#ececee)]">
      <div className="border-b border-zinc-200/80 bg-white/80 px-4 py-2 backdrop-blur-sm">
        <p className="truncate text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Interactive render
        </p>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto" ref={containerRef}>
        <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col items-center gap-6 px-4 py-6">
          {documentState === "loading" ? (
            <div className="rounded-full border border-zinc-200 bg-white/90 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-zinc-700 shadow-[0_20px_45px_rgba(15,23,42,0.12)]">
              Loading {displayName}...
            </div>
          ) : null}

          {documentState === "error" ? (
            <div className="rounded-[1.1rem] border border-rose-200 bg-white/92 px-5 py-4 text-center text-sm leading-6 text-rose-700 shadow-[0_22px_55px_rgba(15,23,42,0.1)]">
              The interactive preview could not be generated for this resume.
            </div>
          ) : null}

          {documentState === "ready"
            ? loadedPages.map((page) => (
                <InteractivePreviewPage
                  focusActive={Boolean(focusKey)}
                  focusKey={focusKey}
                  focusMatchKey={focusMatchKey}
                  focusQuery={focusQuery}
                  focusRequest={focusRequest}
                  highlightQueries={highlightQueries}
                  key={page.pageNumber}
                  onPageSnapshot={onPageSnapshot}
                  onRenderFailure={onRenderFailure}
                  page={page}
                  scale={pageScale}
                  scrollContainerRef={containerRef}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
