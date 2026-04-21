import "server-only";

import {
  type Canvas,
  DOMMatrix,
  ImageData,
  Path2D,
  createCanvas,
} from "@napi-rs/canvas";
import type {
  PDFPageProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import {
  resolveTailoredResumePreviewFocusRanges,
  type TailoredResumeInteractivePreviewQuery,
  type TailoredResumePreviewHighlightTone,
} from "./tailor-resume-preview-focus.ts";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;
type CanvasContext2D = NonNullable<ReturnType<Canvas["getContext"]>>;

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

type PageHighlightMatch = {
  key: string;
  rects: HighlightRect[];
  tone: TailoredResumePreviewHighlightTone;
};

const snapshotTargetWidth = 1200;
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

function installPdfJsNodeGlobals() {
  installPdfJsCollectionPolyfills();

  if (typeof globalThis.DOMMatrix === "undefined") {
    Object.defineProperty(globalThis, "DOMMatrix", {
      configurable: true,
      value: DOMMatrix,
      writable: true,
    });
  }

  if (typeof globalThis.ImageData === "undefined") {
    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      value: ImageData,
      writable: true,
    });
  }

  if (typeof globalThis.Path2D === "undefined") {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: Path2D,
      writable: true,
    });
  }
}

async function loadPdfJsModule() {
  installPdfJsNodeGlobals();
  pdfJsModulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsModulePromise;
}

async function loadPdfDocument(pdfBuffer: Buffer) {
  const pdfJs = await loadPdfJsModule();
  const loadingTask = pdfJs.getDocument({
    data: new Uint8Array(pdfBuffer),
  });
  const pdfDocument = await loadingTask.promise;

  return {
    loadingTask,
    pdfDocument,
    pdfJs,
  };
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
}) {
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
  } satisfies PageMatchIndex;
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

function buildPreviewSnapshotHighlightStyle(tone: TailoredResumePreviewHighlightTone) {
  if (tone === "added") {
    return {
      fillStyle: "rgba(34, 197, 94, 0.24)",
      shadowBlur: 18,
      shadowColor: "rgba(22, 163, 74, 0.16)",
      strokeStyle: "rgba(22, 163, 74, 0.2)",
      strokeWidth: 1.2,
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
  context: CanvasContext2D;
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
  context: CanvasContext2D;
  rect: HighlightRect;
  tone: TailoredResumePreviewHighlightTone;
}) {
  const style = buildPreviewSnapshotHighlightStyle(input.tone);
  const radius = Math.max(2, Math.min(input.rect.width, input.rect.height) * 0.18);

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
    height: input.rect.height,
    left: input.rect.left,
    radius,
    top: input.rect.top,
    width: input.rect.width,
  });
  input.context.fill();
  input.context.shadowBlur = 0;
  appendRoundedRectPath({
    context: input.context,
    height: input.rect.height,
    left: input.rect.left,
    radius,
    top: input.rect.top,
    width: input.rect.width,
  });
  input.context.stroke();
  input.context.restore();
}

export async function countPdfPages(pdfBuffer: Buffer) {
  const { loadingTask, pdfDocument } = await loadPdfDocument(pdfBuffer);

  try {
    return pdfDocument.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

export async function buildTailoredResumePreviewImageDataUrls(input: {
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  pdfBuffer: Buffer;
}) {
  const { loadingTask, pdfDocument, pdfJs } = await loadPdfDocument(input.pdfBuffer);

  try {
    const imageDataUrls: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, snapshotTargetWidth / Math.max(baseViewport.width, 1));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to create a PDF preview snapshot canvas.");
      }

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      } as Parameters<typeof page.render>[0]).promise;

      const textContent = await page.getTextContent();
      const pageHighlightMatches = buildPageHighlightMatches({
        pageMatchIndex: buildPageMatchIndex({
          pdfJs,
          textContent,
          viewport,
        }),
        queries: input.highlightQueries,
      });

      for (const match of pageHighlightMatches) {
        for (const rect of match.rects) {
          drawPreviewSnapshotHighlight({
            context,
            rect,
            tone: match.tone,
          });
        }
      }

      const imageBuffer = canvas.toBuffer("image/jpeg", 0.92);
      imageDataUrls.push(`data:image/jpeg;base64,${imageBuffer.toString("base64")}`);
    }

    return imageDataUrls;
  } finally {
    await loadingTask.destroy();
  }
}
