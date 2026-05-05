import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions } from "pdfjs-dist";
// Vite serves this as a real reachable URL in dev (`/@fs/.../pdf.worker.mjs`)
// and emits it as a hashed asset in production. Required because
// `pdfjs-dist/webpack.mjs` resolves the worker to
// `/node_modules/.vite/deps/build/pdf.worker.mjs?worker_file&type=module` in
// crxjs dev mode, which 404s — leaving the Loading… spinner forever.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
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
} from "../../lib/tailor-resume-preview-focus.ts";
import { resolveTailoredResumePreviewFocusRanges } from "../../lib/tailor-resume-preview-focus.ts";

type PdfJsModule = typeof import("pdfjs-dist/webpack.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;

type TailoredResumeOverlayPreviewProps = {
  displayName: string;
  focusKey?: string | null;
  focusMatchKey?: string | null;
  focusQuery?: TailoredResumePreviewFocusQuery | null;
  focusRequest?: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
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

type PreviewMagnifierState = {
  left: number;
  top: number;
  width: number;
  x: number;
  y: number;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
const previewLoadRetryDelays = [150, 400];
const previewGuidedFocusDurationMs = 320;
const previewMagnifierHeight = 136;
const previewMagnifierViewportInset = 6;
const previewMagnifierZoom = 1.35;

function waitForPreviewRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
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
  pdfJsModulePromise ??= (async () => {
    const mod = (await import(
      "pdfjs-dist/webpack.mjs"
    )) as PdfJsModule;
    // webpack.mjs unconditionally assigns a Worker pointing at a 404 URL in
    // crxjs dev mode; replace it with a Vite-emitted worker URL so
    // getDocument() can resolve.
    if (typeof window !== "undefined" && pdfWorkerUrl) {
      try {
        GlobalWorkerOptions.workerPort?.terminate?.();
      } catch {
        // ignore — the original worker may already be in a terminal state
      }
      GlobalWorkerOptions.workerPort = new Worker(pdfWorkerUrl, {
        type: "module",
      });
    }
    return mod;
  })();

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
  // Some pdfjs font styles report ascent/descent as 0 (e.g. embedded subset
  // fonts without metrics). Treat 0 as "missing" and fall back to typical
  // sans-serif ratios so the rect still has a sensible height.
  const rawAscent =
    typeof style?.ascent === "number" && style.ascent > 0 ? style.ascent : null;
  const rawDescent =
    typeof style?.descent === "number" && style.descent !== 0 ? style.descent : null;
  const ascentRatio =
    rawAscent ?? (rawDescent !== null ? 1 + rawDescent : 0.8);
  const descentRatio =
    rawDescent !== null
      ? Math.abs(rawDescent)
      : Math.max(0.05, 1 - ascentRatio);
  const itemWidth =
    Math.abs((style?.vertical ? input.item.height : input.item.width) ?? 0) *
    input.viewport.scale;
  const left = Math.min(transform[4] ?? 0, (transform[4] ?? 0) + itemWidth);
  const width = Math.abs(itemWidth);
  const ascentPixels = fontHeight * ascentRatio;
  const descentPixels = fontHeight * descentRatio;
  const top = (transform[5] ?? 0) - ascentPixels;
  // Tighten height to actual font bbox (ascent + |descent|) instead of the
  // full em-square fontHeight, which often overshoots the visible glyph and
  // pushes the bottom edge into the leading area below the baseline.
  const tightHeight = Math.max(ascentPixels + descentPixels, fontHeight * 0.6);

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  return {
    height: tightHeight,
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

function resolvePreviewMagnifierState(input: {
  horizontalBleed: number;
  pageHeight: number;
  pageViewportLeft: number;
  pageViewportTop: number;
  pageWidth: number;
  pointerX: number;
  pointerY: number;
}) {
  const width = input.pageWidth + input.horizontalBleed * 2;
  const height = Math.min(previewMagnifierHeight, Math.max(96, input.pageHeight - 24));
  const top = Math.max(
    12,
    Math.min(input.pointerY - height / 2, input.pageHeight - height - 12),
  );

  return {
    left: input.pageViewportLeft - input.horizontalBleed,
    top: input.pageViewportTop + top,
    width,
    x: Math.max(0, Math.min(input.pointerX, input.pageWidth)),
    y: Math.max(0, Math.min(input.pointerY, input.pageHeight)),
  } satisfies PreviewMagnifierState;
}

function resolvePreviewMagnifierHorizontalBleed(input: {
  pageRect: DOMRect;
  scrollContainer: HTMLDivElement | null;
}) {
  const viewportRight =
    typeof window === "undefined"
      ? input.scrollContainer?.getBoundingClientRect().right ?? input.pageRect.right
      : window.innerWidth;

  return Math.max(
    0,
    viewportRight - input.pageRect.right - previewMagnifierViewportInset,
  );
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

function OverlayPreviewPage({
  focusActive,
  focusKey,
  focusMatchKey,
  focusQuery,
  focusRequest,
  highlightQueries,
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
  page: LoadedPdfPage;
  scale: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [dismissedGuidedFocusToken, setDismissedGuidedFocusToken] = useState<
    string | null
  >(null);
  const [highlightSource, setHighlightSource] = useState<PageHighlightSource | null>(
    null,
  );
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const [magnifierCanvasDataUrl, setMagnifierCanvasDataUrl] = useState<string | null>(
    null,
  );
  const [magnifierState, setMagnifierState] =
    useState<PreviewMagnifierState | null>(null);
  const pageHeight = page.baseHeight * scale;
  const pageWidth = page.baseWidth * scale;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastScrolledFocusSignatureRef = useRef<string | null>(null);
  const { focusHighlightRects, pageHighlightMatches } = useMemo(() => {
    if (!highlightSource) {
      return {
        focusHighlightRects: [] as HighlightRect[],
        pageHighlightMatches: [] as PageHighlightMatch[],
      };
    }

    const nextPageHighlightMatches = buildPageHighlightMatches({
      pageMatchIndex: highlightSource.pageMatchIndex,
      queries: highlightQueries,
    });
    const nextFocusHighlightRects =
      buildFocusRectsFromPageHighlightMatches({
        focusMatchKey,
        pageHighlightMatches: nextPageHighlightMatches,
      });

    return {
      focusHighlightRects:
        nextFocusHighlightRects.length > 0
          ? nextFocusHighlightRects
          : buildFocusRects({
              focusQuery,
              pageMatchIndex: highlightSource.pageMatchIndex,
            }),
      pageHighlightMatches: nextPageHighlightMatches,
    };
  }, [focusMatchKey, focusQuery, highlightQueries, highlightSource]);
  const currentGuidedFocusToken =
    focusActive && focusKey && focusHighlightRects.length > 0
      ? `${focusKey}:${focusRequest}`
      : null;
  const shouldShowGuidedFocus =
    currentGuidedFocusToken !== null &&
    dismissedGuidedFocusToken !== currentGuidedFocusToken;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const resolvedCanvas = canvas;

    let isCancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setRenderState("loading");
      setHighlightSource(null);
      setMagnifierCanvasDataUrl(null);
      setMagnifierState(null);
      setRenderErrorMessage(null);

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const viewport = page.page.getViewport({ scale });
        const outputScale = Math.min(
          3,
          Math.max(window.devicePixelRatio || 1, 2),
        );
        const canvasContext = resolvedCanvas.getContext("2d");

        if (!canvasContext) {
          throw new Error("Unable to create a canvas rendering context.");
        }

        resolvedCanvas.width = Math.ceil(viewport.width * outputScale);
        resolvedCanvas.height = Math.ceil(viewport.height * outputScale);
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

        try {
          setMagnifierCanvasDataUrl(resolvedCanvas.toDataURL("image/png"));
        } catch (magnifierError) {
          console.warn("Unable to prepare preview magnifier image.", magnifierError);
          setMagnifierCanvasDataUrl(null);
        }

        const textContent = await page.page.getTextContent();

        if (isCancelled) {
          return;
        }

        setHighlightSource({
          pageMatchIndex: buildPageMatchIndex({
            pdfJs,
            textContent,
            viewport,
          }),
        });
        setRenderState("ready");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setHighlightSource(null);
        setMagnifierCanvasDataUrl(null);
        setMagnifierState(null);
        setRenderErrorMessage(
          error instanceof Error ? error.message : "Unknown PDF rendering error.",
        );
        setRenderState("error");
      }
    }

    void renderPage();

    return () => {
      isCancelled = true;
      renderTask?.cancel?.();
    };
  }, [page.page, scale]);

  useEffect(() => {
    if (!currentGuidedFocusToken) {
      return;
    }

    const focusScrollSignature = buildInteractivePreviewFocusScrollSignature({
      focusKey: focusKey ?? currentGuidedFocusToken,
      focusRequest,
      rects: focusHighlightRects,
    });

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
        setDismissedGuidedFocusToken((currentToken) =>
          currentToken === currentGuidedFocusToken
            ? currentToken
            : currentGuidedFocusToken,
        );
      }, previewGuidedFocusDurationMs);

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
      setDismissedGuidedFocusToken((currentToken) =>
        currentToken === currentGuidedFocusToken
          ? currentToken
          : currentGuidedFocusToken,
      );
    }, previewGuidedFocusDurationMs);

    return () => {
      window.clearTimeout(clearFocusTimer);
    };
  }, [
    currentGuidedFocusToken,
    focusHighlightRects,
    focusKey,
    focusRequest,
    scrollContainerRef,
  ]);

  return (
    <div
      className="tailored-preview-overlay-page"
      onPointerLeave={() => {
        setMagnifierState(null);
      }}
      onPointerMove={(event) => {
        if (renderState !== "ready" || !magnifierCanvasDataUrl) {
          return;
        }

        const pageRect = event.currentTarget.getBoundingClientRect();
        const horizontalBleed = resolvePreviewMagnifierHorizontalBleed({
          pageRect,
          scrollContainer: scrollContainerRef.current,
        });

        setMagnifierState(
          resolvePreviewMagnifierState({
            horizontalBleed,
            pageHeight,
            pageViewportLeft: pageRect.left,
            pageViewportTop: pageRect.top,
            pageWidth,
            pointerX: event.clientX - pageRect.left,
            pointerY: event.clientY - pageRect.top,
          }),
        );
      }}
      ref={pageRef}
      style={{
        height: `${pageHeight}px`,
        width: `${pageWidth}px`,
      }}
    >
      <canvas ref={canvasRef} />
      {pageHighlightMatches.length > 0 ? (
        <div className="tailored-preview-overlay-layer">
          {pageHighlightMatches.flatMap((match) =>
            match.rects.map((rect, index) => (
              <div
                className={`tailored-preview-overlay-highlight ${
                  match.tone === "changed"
                    ? "tailored-preview-overlay-highlight--changed"
                    : "tailored-preview-overlay-highlight--added"
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
      {shouldShowGuidedFocus ? (
        <div className="tailored-preview-overlay-layer">
          {focusHighlightRects.map((rect, index) => (
            <div
              className="tailored-preview-overlay-highlight tailored-preview-overlay-highlight--focus tailored-preview-overlay-highlight--guided tailored-preview-overlay-highlight--animated"
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
      {magnifierState && magnifierCanvasDataUrl && renderState === "ready" ? (
        <div
          aria-hidden="true"
          className="tailored-preview-overlay-magnifier"
          style={{
            backgroundImage: `url(${magnifierCanvasDataUrl})`,
            backgroundPosition: `${magnifierState.width / 2 - magnifierState.x * previewMagnifierZoom}px ${
              previewMagnifierHeight / 2 - magnifierState.y * previewMagnifierZoom
            }px`,
            backgroundSize: `${pageWidth * previewMagnifierZoom}px ${
              pageHeight * previewMagnifierZoom
            }px`,
            height: `${Math.min(previewMagnifierHeight, Math.max(96, pageHeight - 24))}px`,
            left: `${magnifierState.left}px`,
            top: `${magnifierState.top}px`,
            width: `${magnifierState.width}px`,
          }}
        >
          <div
            className="tailored-preview-overlay-magnifier-highlight-layer"
            style={{
              height: `${pageHeight}px`,
              transform: `translate(${magnifierState.width / 2 - magnifierState.x * previewMagnifierZoom}px, ${
                previewMagnifierHeight / 2 - magnifierState.y * previewMagnifierZoom
              }px) scale(${previewMagnifierZoom})`,
              width: `${pageWidth}px`,
            }}
          >
            {pageHighlightMatches.flatMap((match) =>
              match.rects.map((rect, index) => (
                <div
                  className={`tailored-preview-overlay-highlight ${
                    match.tone === "changed"
                      ? "tailored-preview-overlay-highlight--changed"
                      : "tailored-preview-overlay-highlight--added"
                  }`}
                  key={`magnifier-steady-${match.key}-${page.pageNumber}-${index}`}
                  style={{
                    height: `${rect.height}px`,
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                  }}
                />
              )),
            )}
            {shouldShowGuidedFocus
              ? focusHighlightRects.map((rect, index) => (
                  <div
                    className="tailored-preview-overlay-highlight tailored-preview-overlay-highlight--focus tailored-preview-overlay-highlight--guided"
                    key={`magnifier-focus-${focusKey ?? "steady"}-${focusRequest}-${page.pageNumber}-${index}`}
                    style={{
                      height: `${rect.height}px`,
                      left: `${rect.left}px`,
                      top: `${rect.top}px`,
                      width: `${rect.width}px`,
                    }}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
      {renderState === "loading" ? (
        <div className="tailored-preview-overlay-loading">
          <div className="tailored-preview-overlay-pill">
            Building highlighted preview...
          </div>
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="tailored-preview-overlay-error">
          <div className="tailored-preview-overlay-error-card">
            <p>The highlighted preview could not be rendered for this page.</p>
            {renderErrorMessage ? (
              <pre>{renderErrorMessage}</pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TailoredResumeOverlayPreview({
  displayName,
  focusKey = null,
  focusMatchKey = null,
  focusQuery = null,
  focusRequest = 0,
  highlightQueries,
  pdfUrl,
}: TailoredResumeOverlayPreviewProps) {
  const [loadedPages, setLoadedPages] = useState<LoadedPdfPage[]>([]);
  const [documentState, setDocumentState] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      setContainerSize({
        height: entry?.contentRect.height ?? 0,
        width: entry?.contentRect.width ?? 0,
      });
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pdfUrl) {
      const resetFrame = window.requestAnimationFrame(() => {
        setLoadedPages([]);
        setDocumentState("idle");
      });

      return () => {
        window.cancelAnimationFrame(resetFrame);
      };
    }

    const resolvedPdfUrl = pdfUrl;
    let isCancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadDocument() {
      setLoadedPages([]);
      setDocumentState("loading");

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const retryDelays = [0, ...previewLoadRetryDelays];
        let lastError: unknown = null;

        for (const [attemptIndex, retryDelay] of retryDelays.entries()) {
          if (retryDelay > 0) {
            await waitForPreviewRetry(retryDelay);
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
                "Retrying extension preview document load after a transient failure.",
                error,
              );
              continue;
            }
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("Unable to load the highlighted preview PDF.");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setLoadedPages([]);
        setDocumentState("error");
      }
    }

    void loadDocument();

    return () => {
      isCancelled = true;
      loadingTask?.destroy();
    };
  }, [pdfUrl]);

  const pageScale = useMemo(() => {
    const firstPageWidth = loadedPages[0]?.baseWidth;
    const firstPageHeight = loadedPages[0]?.baseHeight;

    if (
      !firstPageWidth ||
      !firstPageHeight ||
      !containerSize.width ||
      !containerSize.height
    ) {
      return 1;
    }

    const widthScale = (containerSize.width - 8) / firstPageWidth;
    const heightScale = (containerSize.height - 8) / firstPageHeight;

    return Math.max(0.15, Math.min(widthScale, heightScale));
  }, [containerSize, loadedPages]);

  return (
    <div className="tailored-preview-overlay-root">
      <div className="tailored-preview-overlay-scroller" ref={containerRef}>
        <div className="tailored-preview-overlay-stack">
          {documentState === "loading" ? (
            <div className="tailored-preview-overlay-pill">
              Loading {displayName}...
            </div>
          ) : null}

          {documentState === "error" ? (
            <div className="tailored-preview-overlay-empty">
              The highlighted preview could not be generated for this resume.
            </div>
          ) : null}

          {documentState === "ready"
            ? loadedPages.map((page) => (
              <OverlayPreviewPage
                  focusActive={Boolean(focusKey)}
                  focusKey={focusKey}
                  focusMatchKey={focusMatchKey}
                  focusQuery={focusQuery}
                  focusRequest={focusRequest}
                  highlightQueries={highlightQueries}
                  key={page.pageNumber}
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
