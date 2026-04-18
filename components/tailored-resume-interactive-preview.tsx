"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/tailor-resume-preview-focus";
import { resolveTailoredResumePreviewFocusRanges } from "@/lib/tailor-resume-preview-focus";

type PdfJsModule = typeof import("pdfjs-dist/webpack.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;

type TailoredResumeInteractivePreviewProps = {
  displayName: string;
  focusKey: string | null;
  focusQuery: TailoredResumePreviewFocusQuery | null;
  focusRequest: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
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
  mode: TailoredResumePreviewFocusQuery["mode"];
  rects: HighlightRect[];
};

type PageHighlightSource = {
  pageMatchIndex: PageMatchIndex;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

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
    const rects = buildFocusRects({
      focusQuery: entry.query,
      pageMatchIndex: input.pageMatchIndex,
    });

    if (rects.length === 0) {
      return [];
    }

    return [
      {
        key: entry.key,
        mode: entry.query.mode,
        rects,
      } satisfies PageHighlightMatch,
    ];
  });
}

function InteractivePreviewPage({
  focusActive,
  focusKey,
  focusQuery,
  focusRequest,
  highlightQueries,
  onRenderFailure,
  page,
  scale,
}: {
  focusActive: boolean;
  focusKey: string | null;
  focusQuery: TailoredResumePreviewFocusQuery | null;
  focusRequest: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  onRenderFailure?: () => void;
  page: LoadedPdfPage;
  scale: number;
}) {
  const [focusHighlightRects, setFocusHighlightRects] = useState<HighlightRect[]>([]);
  const [pageHighlightMatches, setPageHighlightMatches] = useState<PageHighlightMatch[]>(
    [],
  );
  const [highlightSource, setHighlightSource] = useState<PageHighlightSource | null>(
    null,
  );
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastScrolledFocusTokenRef = useRef<string | null>(null);

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
      setPageHighlightMatches(
        buildPageHighlightMatches({
          pageMatchIndex: highlightSource.pageMatchIndex,
          queries: highlightQueries,
        }),
      );
      setFocusHighlightRects(
        buildFocusRects({
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
  }, [focusQuery, highlightQueries, highlightSource]);

  useEffect(() => {
    if (!focusActive || !focusKey || focusHighlightRects.length === 0) {
      return;
    }

    const focusToken = `${focusKey}:${focusRequest}`;

    if (lastScrolledFocusTokenRef.current === focusToken) {
      return;
    }

    lastScrolledFocusTokenRef.current = focusToken;

    const pageElement = pageRef.current;

    if (!pageElement) {
      return;
    }

    const focusElement = pageElement.querySelector<HTMLElement>(
      "[data-tailor-resume-active-highlight='true']",
    );

    focusElement?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [focusActive, focusHighlightRects, focusKey, focusRequest]);

  const pageHeight = page.baseHeight * scale;
  const pageWidth = page.baseWidth * scale;

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
                  match.mode === "changed"
                    ? "resume-interactive-highlight--changed"
                    : "resume-interactive-highlight--focus"
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
      {focusActive && focusHighlightRects.length > 0 ? (
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
  focusQuery,
  highlightQueries,
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

        loadingTask = pdfJs.getDocument(resolvedPdfUrl);
        const pdfDocument = (await loadingTask.promise) as PDFDocumentProxy;
        const nextLoadedPages: LoadedPdfPage[] = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
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
                  focusQuery={focusQuery}
                  focusRequest={focusRequest}
                  highlightQueries={highlightQueries}
                  key={page.pageNumber}
                  onRenderFailure={onRenderFailure}
                  page={page}
                  scale={pageScale}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
