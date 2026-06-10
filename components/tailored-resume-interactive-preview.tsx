"use client";

import "./tailored-resume-interactive-preview.css";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type {
  TailoredResumeInteractivePreviewSegmentQuery,
  TailoredResumeInteractivePreviewQuery,
  TailoredResumePreviewFocusQuery,
  TailoredResumePreviewHighlightTone,
} from "@/lib/tailor-resume-preview-focus";
import {
  dedupeTailoredResumePreviewHighlightRanges,
  resolveTailoredResumePreviewFocusRanges,
} from "@/lib/tailor-resume-preview-focus";
import { resolveLastMeaningfulPdfPageNumber } from "@/lib/pdf-preview-page-filter";

type PdfJsModule = typeof import("pdfjs-dist/webpack.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;

export type TailoredResumeInteractivePreviewProps = {
  displayName: string;
  // Focus props are optional — the chrome extension doesn't have a click-to-
  // focus edit card, so it omits these. The dashboard review modal supplies
  // them to scroll/pulse a specific edit when its card is clicked.
  focusKey?: string | null;
  focusMatchKey?: string | null;
  focusQuery?: TailoredResumePreviewFocusQuery | null;
  focusRequest?: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  loadPdfJsModule?: () => Promise<PdfJsModule>;
  magnifierMaxWidthRatio?: number | null;
  onFocusViewportRectChange?: (
    rect: { height: number; top: number } | null,
  ) => void;
  onPageSnapshot?: (input: { dataUrl: string | null; pageNumber: number }) => void;
  onRenderFailure?: () => void;
  onSegmentClick?: (segmentId: string) => void;
  pdfUrl: string | null;
  presentation?: "frameless" | "web";
  scaleMode?: "fit" | "width";
  segmentQueries?: TailoredResumeInteractivePreviewSegmentQuery[];
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

type PageSegmentMatch = {
  key: string;
  rects: HighlightRect[];
  segmentId: string;
};

type PageHighlightSource = {
  pageMatchIndex: PageMatchIndex;
};

type PreviewMagnifierState = {
  height: number;
  left: number;
  top: number;
  width: number;
  x: number;
  y: number;
  zoom: number;
};

type PreviewViewportRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type PreviewMagnifierBounds = {
  left: number;
  width: number;
};

type PreviewMagnifierImage = {
  dataUrl: string;
  sourceScale: number;
};

type PreviewIdleWindow = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
export const ENABLE_HIGH_RES_SPOTLIGHT = true;
const interactivePreviewLoadRetryDelays = [150, 400];
const interactivePreviewGuidedFocusDurationMs = 320;
const interactivePreviewMagnifierZoom = 1.35;
const interactivePreviewMagnifierMaxZoom = 4.8;
const interactivePreviewHighResSpotlightMinPixelRatio = 2;
const interactivePreviewHighResSpotlightMaxPixelRatio = 3;
const interactivePreviewHighResSpotlightMaxPixels = 16_000_000;
const interactivePreviewHighResSpotlightMaxDimension = 4096;
const interactivePreviewHighResSpotlightIdleTimeoutMs = 700;
const interactivePreviewHighResSpotlightFallbackDelayMs = 80;
const maxPreviewSnapshotWidth = 1200;

type PreviewSnapshotHighlightTone = "added" | "changed" | "focus";

function waitForInteractivePreviewRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function scheduleHighResSpotlightRender(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const idleWindow = window as PreviewIdleWindow;
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;
  const frameHandle = window.requestAnimationFrame(() => {
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(callback, {
        timeout: interactivePreviewHighResSpotlightIdleTimeoutMs,
      });
      return;
    }

    timeoutHandle = window.setTimeout(
      callback,
      interactivePreviewHighResSpotlightFallbackDelayMs,
    );
  });

  return () => {
    window.cancelAnimationFrame(frameHandle);

    if (idleHandle !== null) {
      idleWindow.cancelIdleCallback?.(idleHandle);
    }

    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
  };
}

function buildCanvasObjectUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to export high-resolution magnifier image."));
        return;
      }

      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}

function waitForPreviewImageDecode(src: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error("Unable to decode high-resolution magnifier image."));
    };
    image.src = src;

    if (image.decode) {
      image.decode().then(resolve, reject);
    }
  });
}

function revokePreviewMagnifierImage(image: PreviewMagnifierImage | null) {
  if (image?.dataUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.dataUrl);
  }
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
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
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

function resolvePreviewMagnifierBounds(input: {
  maxWidthRatio: number | null;
  rootRect: DOMRect | null;
}) {
  const viewportWidth =
    typeof window === "undefined" ? 612 : Math.max(1, window.innerWidth);
  const rootLeft = input.rootRect?.left ?? 0;
  const rootWidth =
    input.rootRect && Number.isFinite(input.rootRect.width) && input.rootRect.width > 0
      ? input.rootRect.width
      : viewportWidth;
  const width =
    input.maxWidthRatio === null
      ? viewportWidth
      : Math.min(rootWidth, Math.max(320, rootWidth * input.maxWidthRatio));
  const desiredLeft =
    input.maxWidthRatio === null
      ? 0
      : rootLeft + Math.max(0, rootWidth - width);

  return {
    left: desiredLeft,
    width,
  } satisfies PreviewMagnifierBounds;
}

function resolvePreviewMagnifierState(input: {
  magnifierBounds: PreviewMagnifierBounds;
  pageHeight: number;
  pageViewportTop: number;
  pageWidth: number;
  pointerX: number;
  pointerY: number;
  targetGroup: { height: number; left: number; top: number; width: number } | null;
}) {
  const width = input.magnifierBounds.width;
  const targetGroup = input.targetGroup;
  const targetCenterX = targetGroup
    ? targetGroup.left + targetGroup.width / 2
    : input.pointerX;
  const targetCenterY = input.pointerY;
  const horizontalInset = 12;
  const safeTargetWidth =
    targetGroup && Number.isFinite(targetGroup.width) && targetGroup.width > 0
      ? targetGroup.width
      : input.pageWidth;
  const safeTargetHeight =
    targetGroup && Number.isFinite(targetGroup.height) && targetGroup.height > 0
      ? targetGroup.height
      : 12;
  const zoom = Math.max(
    interactivePreviewMagnifierZoom,
    Math.min(
      interactivePreviewMagnifierMaxZoom,
      (width - horizontalInset * 2) / Math.max(1, safeTargetWidth),
    ),
  );
  const height = Math.min(
    Math.max(96, input.pageHeight - 24),
    Math.max(172, Math.min(300, safeTargetHeight * zoom * 6.5)),
  );
  const top = Math.max(
    12,
    Math.min(targetCenterY - height / 2, input.pageHeight - height - 12),
  );

  return {
    height,
    left: input.magnifierBounds.left,
    top: input.pageViewportTop + top,
    width,
    x: Math.max(
      0,
      Math.min(targetCenterX, input.pageWidth),
    ),
    y: Math.max(0, Math.min(targetCenterY, input.pageHeight)),
    zoom,
  } satisfies PreviewMagnifierState;
}

function resolvePreviewMagnifierStateFromViewportPagePoint(input: {
  clientX: number;
  clientY: number;
  magnifierBounds: PreviewMagnifierBounds;
  pageHeight: number;
  pageMatchIndex: PageMatchIndex | null;
  pageRect: { left: number; top: number };
  pageWidth: number;
}) {
  // Use the real PDF page coordinates for spotlight movement. Feeding cursor
  // motion through the already-transformed magnifier image creates a feedback
  // loop where reversing direction can briefly accelerate or feel inverted.
  const pointerX = input.clientX - input.pageRect.left;
  const pointerY = input.clientY - input.pageRect.top;

  return resolvePreviewMagnifierState({
    magnifierBounds: input.magnifierBounds,
    pageHeight: input.pageHeight,
    pageViewportTop: input.pageRect.top,
    pageWidth: input.pageWidth,
    pointerX,
    pointerY,
    targetGroup: summarizePageTextLineNearY({
      pageMatchIndex: input.pageMatchIndex,
      pointerY,
    }),
  });
}

function resolvePreviewFocusMagnifierState(input: {
  focusGroup: { height: number; left: number; top: number; width: number };
  magnifierBounds: PreviewMagnifierBounds;
  pageHeight: number;
  pageViewportTop: number;
  pageWidth: number;
}) {
  const width = input.magnifierBounds.width;
  const horizontalInset = 12;
  const safeFocusWidth =
    Number.isFinite(input.focusGroup.width) && input.focusGroup.width > 0
      ? input.focusGroup.width
      : input.pageWidth;
  const safeFocusHeight =
    Number.isFinite(input.focusGroup.height) && input.focusGroup.height > 0
      ? input.focusGroup.height
      : 12;
  const safePageHeight =
    Number.isFinite(input.pageHeight) && input.pageHeight > 0
      ? input.pageHeight
      : 792;
  const zoom = Math.max(
    interactivePreviewMagnifierZoom,
    Math.min(
      interactivePreviewMagnifierMaxZoom,
      (width - horizontalInset * 2) / safeFocusWidth,
    ),
  );
  const contextHeight = Math.max(172, Math.min(300, safeFocusHeight * zoom * 6.5));
  const height = Math.min(
    Math.max(96, safePageHeight - 24),
    contextHeight,
  );
  const focusCenterY = input.focusGroup.top + input.focusGroup.height / 2;
  const top = Math.max(
    12,
    Math.min(focusCenterY - height / 2, input.pageHeight - height - 12),
  );

  return {
    height,
    left: input.magnifierBounds.left,
    top: input.pageViewportTop + top,
    width,
    x: Math.max(
      0,
      Math.min(input.focusGroup.left + input.focusGroup.width / 2, input.pageWidth),
    ),
    y: Math.max(0, Math.min(focusCenterY, input.pageHeight)),
    zoom,
  } satisfies PreviewMagnifierState;
}

function resolvePreviewMagnifierViewportState(input: {
  currentState: PreviewMagnifierState;
  magnifierBounds: PreviewMagnifierBounds;
  pageHeight: number;
  pageViewportTop: number;
}) {
  const topWithinPage = Math.max(
    12,
    Math.min(
      input.currentState.y - input.currentState.height / 2,
      input.pageHeight - input.currentState.height - 12,
    ),
  );

  return {
    ...input.currentState,
    left: input.magnifierBounds.left,
    top: input.pageViewportTop + topWithinPage,
    width: input.magnifierBounds.width,
  } satisfies PreviewMagnifierState;
}

function resolveHighResSpotlightSourceScale(input: {
  devicePixelRatio: number;
  pageHeight: number;
  pageWidth: number;
  zoom: number;
}) {
  const safePageWidth =
    Number.isFinite(input.pageWidth) && input.pageWidth > 0 ? input.pageWidth : 1;
  const safePageHeight =
    Number.isFinite(input.pageHeight) && input.pageHeight > 0
      ? input.pageHeight
      : 1;
  const targetPixelRatio = Math.min(
    interactivePreviewHighResSpotlightMaxPixelRatio,
    Math.max(
      interactivePreviewHighResSpotlightMinPixelRatio,
      input.devicePixelRatio || 1,
    ),
  );
  const desiredSourceScale = Math.max(1, input.zoom * targetPixelRatio);
  const maxPixelSourceScale = Math.sqrt(
    interactivePreviewHighResSpotlightMaxPixels /
      Math.max(1, safePageWidth * safePageHeight),
  );
  const maxDimensionSourceScale = Math.min(
    interactivePreviewHighResSpotlightMaxDimension / safePageWidth,
    interactivePreviewHighResSpotlightMaxDimension / safePageHeight,
  );

  return Math.max(
    1,
    Math.min(desiredSourceScale, maxPixelSourceScale, maxDimensionSourceScale),
  );
}

function isPreviewMagnifierImageUsable(input: {
  image: PreviewMagnifierImage | null;
  minSourceScale: number;
}) {
  return Boolean(
    input.image && input.image.sourceScale >= input.minSourceScale * 0.98,
  );
}

function isViewportPointInsideMagnifier(input: {
  clientX: number;
  clientY: number;
  magnifierViewportRect?: PreviewViewportRect;
  magnifierState: PreviewMagnifierState;
}) {
  const magnifierRect = input.magnifierViewportRect ?? input.magnifierState;

  return (
    input.clientX >= magnifierRect.left &&
    input.clientX <= magnifierRect.left + magnifierRect.width &&
    input.clientY >= magnifierRect.top &&
    input.clientY <= magnifierRect.top + magnifierRect.height
  );
}

function resolveRenderedMagnifierViewportRect(input: {
  magnifierElement: HTMLDivElement | null;
  magnifierState: PreviewMagnifierState;
}): PreviewViewportRect {
  const renderedRect = input.magnifierElement?.getBoundingClientRect();

  if (renderedRect && renderedRect.width > 0 && renderedRect.height > 0) {
    return {
      height: renderedRect.height,
      left: renderedRect.left,
      top: renderedRect.top,
      width: renderedRect.width,
    };
  }

  return {
    height: input.magnifierState.height,
    left: input.magnifierState.left,
    top: input.magnifierState.top,
    width: input.magnifierState.width,
  };
}

function isViewportPointInsidePage(input: {
  clientX: number;
  clientY: number;
  pageRect: DOMRect;
}) {
  return (
    input.clientX >= input.pageRect.left &&
    input.clientX <= input.pageRect.right &&
    input.clientY >= input.pageRect.top &&
    input.clientY <= input.pageRect.bottom
  );
}

function mapViewportPointToMagnifierPagePoint(input: {
  clientX: number;
  clientY: number;
  magnifierViewportRect?: PreviewViewportRect;
  magnifierState: PreviewMagnifierState;
}) {
  const magnifierRect = input.magnifierViewportRect ?? input.magnifierState;
  const translatedX =
    input.magnifierState.width / 2 -
    input.magnifierState.x * input.magnifierState.zoom;
  const translatedY =
    input.magnifierState.height / 2 -
    input.magnifierState.y * input.magnifierState.zoom;

  return {
    x:
      (input.clientX - magnifierRect.left - translatedX) /
      input.magnifierState.zoom,
    y:
      (input.clientY - magnifierRect.top - translatedY) /
      input.magnifierState.zoom,
  };
}

function findSegmentKeyAtPagePoint(input: {
  pageSegmentMatches: PageSegmentMatch[];
  x: number;
  y: number;
  zoom?: number;
}) {
  const tolerance = Math.max(2, 6 / Math.max(1, input.zoom ?? 1));
  let nearestMatch: { distance: number; key: string } | null = null;

  for (const match of input.pageSegmentMatches) {
    for (const rect of match.rects) {
      const left = rect.left - tolerance;
      const right = rect.left + rect.width + tolerance;
      const top = rect.top - tolerance;
      const bottom = rect.top + rect.height + tolerance;

      if (
        input.x >= left &&
        input.x <= right &&
        input.y >= top &&
        input.y <= bottom
      ) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(input.x - centerX, input.y - centerY);

        if (!nearestMatch || distance < nearestMatch.distance) {
          nearestMatch = { distance, key: match.key };
        }
      }
    }
  }

  return nearestMatch?.key ?? null;
}

function findSegmentKeyAtMagnifierPoint(input: {
  clientX: number;
  clientY: number;
  magnifierViewportRect?: PreviewViewportRect;
  magnifierState: PreviewMagnifierState;
  pageSegmentMatches: PageSegmentMatch[];
}) {
  if (
    !isViewportPointInsideMagnifier({
      clientX: input.clientX,
      clientY: input.clientY,
      magnifierViewportRect: input.magnifierViewportRect,
      magnifierState: input.magnifierState,
    })
  ) {
    return null;
  }

  const translatedX =
    input.magnifierState.width / 2 -
    input.magnifierState.x * input.magnifierState.zoom;
  const translatedY =
    input.magnifierState.height / 2 -
    input.magnifierState.y * input.magnifierState.zoom;
  const magnifierRect = input.magnifierViewportRect ?? input.magnifierState;
  const tolerance = 6;
  let nearestMatch: { distance: number; key: string } | null = null;

  for (const match of input.pageSegmentMatches) {
    for (const rect of match.rects) {
      const left =
        magnifierRect.left +
        translatedX +
        rect.left * input.magnifierState.zoom;
      const top =
        magnifierRect.top +
        translatedY +
        rect.top * input.magnifierState.zoom;
      const width = rect.width * input.magnifierState.zoom;
      const height = rect.height * input.magnifierState.zoom;
      const right = left + width;
      const bottom = top + height;

      if (
        input.clientX >= left - tolerance &&
        input.clientX <= right + tolerance &&
        input.clientY >= top - tolerance &&
        input.clientY <= bottom + tolerance
      ) {
        const centerX = left + width / 2;
        const centerY = top + height / 2;
        const distance = Math.hypot(input.clientX - centerX, input.clientY - centerY);

        if (!nearestMatch || distance < nearestMatch.distance) {
          nearestMatch = { distance, key: match.key };
        }
      }
    }
  }

  if (nearestMatch) {
    return nearestMatch.key;
  }

  const pagePoint = mapViewportPointToMagnifierPagePoint({
    clientX: input.clientX,
    clientY: input.clientY,
    magnifierViewportRect: input.magnifierViewportRect,
    magnifierState: input.magnifierState,
  });

  return findSegmentKeyAtPagePoint({
    pageSegmentMatches: input.pageSegmentMatches,
    x: pagePoint.x,
    y: pagePoint.y,
    zoom: input.magnifierState.zoom,
  });
}

function summarizePageTextLineNearY(input: {
  pageMatchIndex: PageMatchIndex | null;
  pointerY: number;
}) {
  if (!input.pageMatchIndex) {
    return null;
  }

  const allRects = input.pageMatchIndex.positions.flatMap((position) =>
    position.rect ? [position.rect] : [],
  );
  const pageTextGroup = summarizeHighlightRectGroup(allRects);

  if (!pageTextGroup) {
    return null;
  }

  const lineTolerance = 4;
  const nearestPosition = input.pageMatchIndex.positions.reduce<{
    distance: number;
    rect: HighlightRect;
  } | null>((nearest, position) => {
    if (!position.rect) {
      return nearest;
    }

    const centerY = position.rect.top + position.rect.height / 2;
    const distance = Math.abs(centerY - input.pointerY);

    if (!nearest || distance < nearest.distance) {
      return { distance, rect: position.rect };
    }

    return nearest;
  }, null);

  if (!nearestPosition) {
    return null;
  }

  const nearestCenterY =
    nearestPosition.rect.top + nearestPosition.rect.height / 2;
  const lineRects = input.pageMatchIndex.positions.flatMap((position) => {
    if (!position.rect) {
      return [];
    }

    const centerY = position.rect.top + position.rect.height / 2;

    return Math.abs(centerY - nearestCenterY) <=
      Math.max(lineTolerance, position.rect.height * 0.65)
      ? [position.rect]
      : [];
  });

  const lineGroup = summarizeHighlightRectGroup(lineRects);

  if (!lineGroup) {
    return pageTextGroup;
  }

  return {
    height: lineGroup.height,
    left: pageTextGroup.left,
    top: lineGroup.top,
    width: pageTextGroup.width,
  };
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
  const resolvedRanges = input.queries.flatMap((entry) => {
    const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
      pageText: input.pageMatchIndex.normalizedText,
      query: entry.query,
    });

    return resolvedRanges.map((range, index) => ({
      ...range,
      key: `${entry.key}:${index}`,
    }));
  });

  return dedupeTailoredResumePreviewHighlightRanges(resolvedRanges).flatMap(
    (range) => {
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
          key: range.key,
          rects,
          tone: range.tone,
        } satisfies PageHighlightMatch,
      ];
    },
  );
}

function buildPageSegmentMatches(input: {
  pageMatchIndex: PageMatchIndex;
  queries: TailoredResumeInteractivePreviewSegmentQuery[];
}) {
  return input.queries.flatMap((entry) => {
    const resolvedRanges = resolveTailoredResumePreviewFocusRanges({
      pageText: input.pageMatchIndex.normalizedText,
      query: entry.query,
    });
    const rects = resolvedRanges.flatMap((range) => {
      const rangeRects = buildHighlightRectsForNormalizedSlice({
        end: range.end,
        pageMatchIndex: input.pageMatchIndex,
        start: range.start,
      });

      return rangeRects ?? [];
    });

    if (rects.length === 0) {
      return [];
    }

    return [
      {
        key: entry.key,
        rects,
        segmentId: entry.segmentId,
      } satisfies PageSegmentMatch,
    ];
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
  loadPdfJsModuleForPreview,
  magnifierMaxWidthRatio,
  onFocusViewportRectChange,
  onPageSnapshot,
  onRenderFailure,
  onSegmentClick,
  page,
  rootRef,
  scale,
  scrollContainerRef,
  segmentQueries,
}: {
  focusActive: boolean;
  focusKey: string | null;
  focusMatchKey: string | null;
  focusQuery: TailoredResumePreviewFocusQuery | null;
  focusRequest: number;
  highlightQueries: TailoredResumeInteractivePreviewQuery[];
  onFocusViewportRectChange?: (
    rect: { height: number; top: number } | null,
  ) => void;
  onPageSnapshot?: (input: { dataUrl: string | null; pageNumber: number }) => void;
  onRenderFailure?: () => void;
  onSegmentClick?: (segmentId: string) => void;
  page: LoadedPdfPage;
  rootRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  loadPdfJsModuleForPreview: () => Promise<PdfJsModule>;
  magnifierMaxWidthRatio: number | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  segmentQueries: TailoredResumeInteractivePreviewSegmentQuery[];
}) {
  const [focusHighlightRects, setFocusHighlightRects] = useState<HighlightRect[]>([]);
  const [pageHighlightMatches, setPageHighlightMatches] = useState<PageHighlightMatch[]>(
    [],
  );
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const hoveredSegmentKeyRef = useRef<string | null>(null);
  const [pageSegmentMatches, setPageSegmentMatches] = useState<PageSegmentMatch[]>([]);
  const [guidedFocusToken, setGuidedFocusToken] = useState<string | null>(null);
  const [highlightSource, setHighlightSource] = useState<PageHighlightSource | null>(
    null,
  );
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const [baseMagnifierCanvasDataUrl, setBaseMagnifierCanvasDataUrl] = useState<
    string | null
  >(null);
  const [highResMagnifierImage, setHighResMagnifierImage] =
    useState<PreviewMagnifierImage | null>(null);
  const [magnifierState, setMagnifierState] =
    useState<PreviewMagnifierState | null>(null);
  const pageHeight = page.baseHeight * scale;
  const pageWidth = page.baseWidth * scale;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledFocusSignatureRef = useRef<string | null>(null);
  const suppressNextSegmentClickRef = useRef(false);
  const hoveredSegmentMatch =
    pageSegmentMatches.find((match) => match.key === hoveredSegmentKey) ?? null;

  const updateHoveredSegmentKey = useCallback(
    (nextHoveredSegmentKey: string | null) => {
      hoveredSegmentKeyRef.current = nextHoveredSegmentKey;
      setHoveredSegmentKey(nextHoveredSegmentKey);
    },
    [],
  );

  const clearHoveredSegmentKeyIfCurrent = useCallback((segmentKey: string) => {
    setHoveredSegmentKey((currentKey) => {
      const nextHoveredSegmentKey = currentKey === segmentKey ? null : currentKey;
      hoveredSegmentKeyRef.current = nextHoveredSegmentKey;
      return nextHoveredSegmentKey;
    });
  }, []);
  const targetMagnifierSourceScale = magnifierState
    ? resolveHighResSpotlightSourceScale({
        devicePixelRatio:
          typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
        pageHeight,
        pageWidth,
        zoom: magnifierState.zoom,
      })
    : null;
  const highResMagnifierSourceScale = highResMagnifierImage?.sourceScale ?? null;
  const magnifierCanvasDataUrl =
    ENABLE_HIGH_RES_SPOTLIGHT &&
    targetMagnifierSourceScale !== null &&
    isPreviewMagnifierImageUsable({
      image: highResMagnifierImage,
      minSourceScale: targetMagnifierSourceScale,
    })
      ? highResMagnifierImage?.dataUrl ?? baseMagnifierCanvasDataUrl
      : baseMagnifierCanvasDataUrl;
  const emitPageSnapshot = useEffectEvent(
    (input: { dataUrl: string | null; pageNumber: number }) => {
      onPageSnapshot?.(input);
    },
  );

  useEffect(() => {
    return () => {
      revokePreviewMagnifierImage(highResMagnifierImage);
    };
  }, [highResMagnifierImage]);

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
      setPageSegmentMatches([]);
      setBaseMagnifierCanvasDataUrl(null);
      setHighResMagnifierImage((currentImage) => {
        revokePreviewMagnifierImage(currentImage);
        return null;
      });
      setMagnifierState(null);
      setRenderErrorMessage(null);

      try {
        const pdfJs = await loadPdfJsModuleForPreview();

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

        try {
          setBaseMagnifierCanvasDataUrl(resolvedCanvas.toDataURL("image/png"));
        } catch (magnifierError) {
          console.warn("Unable to prepare preview magnifier image.", magnifierError);
          setBaseMagnifierCanvasDataUrl(null);
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
        setPageSegmentMatches([]);
        setBaseMagnifierCanvasDataUrl(null);
        setHighResMagnifierImage((currentImage) => {
          revokePreviewMagnifierImage(currentImage);
          return null;
        });
        setMagnifierState(null);
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
  }, [loadPdfJsModuleForPreview, onRenderFailure, page.page, scale]);

  useEffect(() => {
    if (!pageRef.current || !highlightSource) {
      setFocusHighlightRects([]);
      setPageHighlightMatches([]);
      setPageSegmentMatches([]);
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
      setPageSegmentMatches(
        onSegmentClick
          ? buildPageSegmentMatches({
              pageMatchIndex: highlightSource.pageMatchIndex,
              queries: segmentQueries,
            })
          : [],
      );
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
      setPageSegmentMatches([]);
    }
  }, [
    focusMatchKey,
    focusQuery,
    highlightQueries,
    highlightSource,
    onSegmentClick,
    segmentQueries,
  ]);

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
    if (
      !ENABLE_HIGH_RES_SPOTLIGHT ||
      renderState !== "ready" ||
      !baseMagnifierCanvasDataUrl ||
      targetMagnifierSourceScale === null ||
      (highResMagnifierSourceScale !== null &&
        highResMagnifierSourceScale >= targetMagnifierSourceScale * 0.98)
    ) {
      return;
    }

    const highResSourceScale = targetMagnifierSourceScale;
    let isCancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderHighResMagnifierImage() {
      try {
        const viewport = page.page.getViewport({
          scale: scale * highResSourceScale,
        });
        const highResCanvas = document.createElement("canvas");
        const canvasContext = highResCanvas.getContext("2d");

        if (!canvasContext) {
          throw new Error("Unable to create a high-resolution magnifier canvas.");
        }

        highResCanvas.width = Math.max(1, Math.floor(viewport.width));
        highResCanvas.height = Math.max(1, Math.floor(viewport.height));

        renderTask = page.page.render({
          canvas: highResCanvas,
          canvasContext,
          viewport,
        });
        await renderTask.promise;

        if (isCancelled) {
          return;
        }

        const imageObjectUrl = await buildCanvasObjectUrl(highResCanvas);

        try {
          await waitForPreviewImageDecode(imageObjectUrl);
        } catch (decodeError) {
          URL.revokeObjectURL(imageObjectUrl);
          throw decodeError;
        }

        if (isCancelled) {
          URL.revokeObjectURL(imageObjectUrl);
          return;
        }

        setHighResMagnifierImage((currentImage) => {
          revokePreviewMagnifierImage(currentImage);
          return {
            dataUrl: imageObjectUrl,
            sourceScale: highResSourceScale,
          };
        });
      } catch (magnifierError) {
        if (isCancelled) {
          return;
        }

        console.warn(
          "Unable to prepare high-resolution preview magnifier image.",
          magnifierError,
        );
      }
    }

    const cancelScheduledRender = scheduleHighResSpotlightRender(() => {
      if (!isCancelled) {
        void renderHighResMagnifierImage();
      }
    });

    return () => {
      isCancelled = true;
      cancelScheduledRender();
      renderTask?.cancel?.();
    };
  }, [
    baseMagnifierCanvasDataUrl,
    highResMagnifierSourceScale,
    page.page,
    renderState,
    scale,
    targetMagnifierSourceScale,
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

  useEffect(() => {
    if (
      !focusActive ||
      !focusKey ||
      focusHighlightRects.length === 0 ||
      renderState !== "ready" ||
      !baseMagnifierCanvasDataUrl
    ) {
      return;
    }

    const focusGroup = summarizeHighlightRectGroup(focusHighlightRects);
    const pageElement = pageRef.current;

    if (!focusGroup || !pageElement) {
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    onFocusViewportRectChange?.({
      height: focusGroup.height,
      top: pageRect.top + focusGroup.top,
    });
    const nextFocusMagnifierState = resolvePreviewFocusMagnifierState({
      focusGroup,
      magnifierBounds: resolvePreviewMagnifierBounds({
        maxWidthRatio: magnifierMaxWidthRatio,
        rootRect: rootRef.current?.getBoundingClientRect() ?? null,
      }),
      pageHeight,
      pageViewportTop: pageRect.top,
      pageWidth,
    });

    setMagnifierState(nextFocusMagnifierState);

    const clearMagnifierTimer = window.setTimeout(() => {
      setMagnifierState((currentState) => {
        if (
          !currentState ||
          Math.abs(currentState.left - nextFocusMagnifierState.left) >= 0.01 ||
          Math.abs(currentState.top - nextFocusMagnifierState.top) >= 0.01 ||
          Math.abs(currentState.width - nextFocusMagnifierState.width) >= 0.01 ||
          Math.abs(currentState.height - nextFocusMagnifierState.height) >= 0.01 ||
          Math.abs(currentState.x - nextFocusMagnifierState.x) >= 0.01 ||
          Math.abs(currentState.y - nextFocusMagnifierState.y) >= 0.01 ||
          Math.abs(currentState.zoom - nextFocusMagnifierState.zoom) >= 0.01
        ) {
          return currentState;
        }

        return null;
      });
    }, 950);

    return () => {
      window.clearTimeout(clearMagnifierTimer);
      onFocusViewportRectChange?.(null);
    };
  }, [
    baseMagnifierCanvasDataUrl,
    focusActive,
    focusHighlightRects,
    focusKey,
    focusRequest,
    magnifierMaxWidthRatio,
    onFocusViewportRectChange,
    pageHeight,
    pageWidth,
    renderState,
    rootRef,
  ]);

  useEffect(() => {
    if (renderState !== "ready") {
      return;
    }

    let animationFrameId: number | null = null;

    const updateMagnifierViewportState = () => {
      animationFrameId = null;
      const pageElement = pageRef.current;

      if (!pageElement) {
        return;
      }

      const pageRect = pageElement.getBoundingClientRect();
      const magnifierBounds = resolvePreviewMagnifierBounds({
        maxWidthRatio: magnifierMaxWidthRatio,
        rootRect: rootRef.current?.getBoundingClientRect() ?? null,
      });

      setMagnifierState((currentState) => {
        if (!currentState) {
          return currentState;
        }

        const nextState = resolvePreviewMagnifierViewportState({
          currentState,
          magnifierBounds,
          pageHeight,
          pageViewportTop: pageRect.top,
        });

        if (
          Math.abs(nextState.left - currentState.left) < 0.01 &&
          Math.abs(nextState.top - currentState.top) < 0.01 &&
          Math.abs(nextState.width - currentState.width) < 0.01
        ) {
          return currentState;
        }

        return nextState;
      });
    };

    const scheduleMagnifierViewportUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(updateMagnifierViewportState);
    };

    const scrollContainer = scrollContainerRef.current;
    scrollContainer?.addEventListener("scroll", scheduleMagnifierViewportUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleMagnifierViewportUpdate);
    scheduleMagnifierViewportUpdate();

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      scrollContainer?.removeEventListener("scroll", scheduleMagnifierViewportUpdate);
      window.removeEventListener("resize", scheduleMagnifierViewportUpdate);
    };
  }, [
    magnifierMaxWidthRatio,
    pageHeight,
    renderState,
    rootRef,
    scrollContainerRef,
  ]);

  useEffect(() => {
    if (!magnifierState || renderState !== "ready") {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      if (!magnifierState) {
        return;
      }

      const magnifierViewportRect = resolveRenderedMagnifierViewportRect({
        magnifierElement: magnifierRef.current,
        magnifierState,
      });

      if (
        isViewportPointInsideMagnifier({
          clientX: event.clientX,
          clientY: event.clientY,
          magnifierViewportRect,
          magnifierState,
        })
      ) {
        updateHoveredSegmentKey(
          findSegmentKeyAtMagnifierPoint({
            clientX: event.clientX,
            clientY: event.clientY,
            magnifierViewportRect,
            magnifierState,
            pageSegmentMatches,
          }),
        );
        return;
      }

      const pageElement = pageRef.current;
      const pageRect = pageElement?.getBoundingClientRect() ?? null;

      if (
        pageRect &&
        isViewportPointInsidePage({
          clientX: event.clientX,
          clientY: event.clientY,
          pageRect,
        })
      ) {
        return;
      }

      if (!pageElement) {
        setMagnifierState(null);
        updateHoveredSegmentKey(null);
        return;
      }

      if (
        pageRect &&
        !isViewportPointInsidePage({
          clientX: event.clientX,
          clientY: event.clientY,
          pageRect,
        })
      ) {
        setMagnifierState(null);
        updateHoveredSegmentKey(null);
      }
    }

    window.addEventListener("pointermove", handleWindowPointerMove);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
    };
  }, [magnifierState, pageSegmentMatches, renderState, updateHoveredSegmentKey]);

  return (
    <div
      className="resume-interactive-page"
      onClickCapture={(event) => {
        if (!suppressNextSegmentClickRef.current) {
          return;
        }

        suppressNextSegmentClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerLeave={(event) => {
        const magnifierViewportRect = magnifierState
          ? resolveRenderedMagnifierViewportRect({
              magnifierElement: magnifierRef.current,
              magnifierState,
            })
          : null;

        if (
          magnifierState &&
          isViewportPointInsideMagnifier({
            clientX: event.clientX,
            clientY: event.clientY,
            magnifierViewportRect: magnifierViewportRect ?? undefined,
            magnifierState,
          })
        ) {
          return;
        }

        setMagnifierState(null);
        updateHoveredSegmentKey(null);
      }}
      onPointerMove={(event) => {
        if (renderState !== "ready" || !magnifierCanvasDataUrl) {
          return;
        }

        const magnifierViewportRect = magnifierState
          ? resolveRenderedMagnifierViewportRect({
              magnifierElement: magnifierRef.current,
              magnifierState,
            })
          : null;

        if (
          magnifierState &&
          isViewportPointInsideMagnifier({
            clientX: event.clientX,
            clientY: event.clientY,
            magnifierViewportRect: magnifierViewportRect ?? undefined,
            magnifierState,
          })
        ) {
          // The fixed spotlight can sit under the cursor, but if the cursor is
          // still over the rendered PDF, scroll from PDF coordinates, not from
          // the magnifier transform. The latter causes speed bursts.
          const pageRect = event.currentTarget.getBoundingClientRect();
          const nextMagnifierState = isViewportPointInsidePage({
            clientX: event.clientX,
            clientY: event.clientY,
            pageRect,
          })
            ? resolvePreviewMagnifierStateFromViewportPagePoint({
                clientX: event.clientX,
                clientY: event.clientY,
                magnifierBounds: resolvePreviewMagnifierBounds({
                  maxWidthRatio: magnifierMaxWidthRatio,
                  rootRect: rootRef.current?.getBoundingClientRect() ?? null,
                }),
                pageHeight,
                pageMatchIndex: highlightSource?.pageMatchIndex ?? null,
                pageRect,
                pageWidth,
              })
            : magnifierState;

          setMagnifierState(nextMagnifierState);
          updateHoveredSegmentKey(
            findSegmentKeyAtMagnifierPoint({
              clientX: event.clientX,
              clientY: event.clientY,
              magnifierViewportRect: magnifierViewportRect ?? undefined,
              magnifierState: nextMagnifierState,
              pageSegmentMatches,
            }),
          );
          return;
        }

        const pageRect = event.currentTarget.getBoundingClientRect();
        const nextMagnifierState = resolvePreviewMagnifierStateFromViewportPagePoint({
          clientX: event.clientX,
          clientY: event.clientY,
          magnifierBounds: resolvePreviewMagnifierBounds({
            maxWidthRatio: magnifierMaxWidthRatio,
            rootRect: rootRef.current?.getBoundingClientRect() ?? null,
          }),
          pageHeight,
          pageMatchIndex: highlightSource?.pageMatchIndex ?? null,
          pageRect,
          pageWidth,
        });
        const pointerX = event.clientX - pageRect.left;
        const pointerY = event.clientY - pageRect.top;

        const nextHoveredSegmentKey = findSegmentKeyAtPagePoint({
          pageSegmentMatches,
          x: pointerX,
          y: pointerY,
        });

        setMagnifierState(nextMagnifierState);
        updateHoveredSegmentKey(nextHoveredSegmentKey);
      }}
      ref={pageRef}
      style={{
        height: `${pageHeight}px`,
        width: `${pageWidth}px`,
        ["--scale-factor" as string]: `${scale}`,
      }}
    >
      <canvas ref={canvasRef} />
      {pageHighlightMatches.length > 0 ? (
        <div className="resume-interactive-layer">
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
      {pageSegmentMatches.length > 0 ? (
        <div className="resume-interactive-layer resume-interactive-layer--segments">
          {pageSegmentMatches.flatMap((match) =>
            match.rects.map((rect, index) => (
              <button
                aria-label={`Edit resume segment ${match.segmentId}`}
                className={`resume-interactive-segment-target ${
                  hoveredSegmentKey === match.key
                    ? "resume-interactive-segment-target--hovered"
                    : ""
                }`}
                key={`segment-${match.key}-${page.pageNumber}-${index}`}
                onClick={(event) => {
                  if (suppressNextSegmentClickRef.current) {
                    suppressNextSegmentClickRef.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }

                  setMagnifierState(null);
                  onSegmentClick?.(match.segmentId);
                }}
                onMouseEnter={(event) => {
                  const magnifierViewportRect = magnifierState
                    ? resolveRenderedMagnifierViewportRect({
                        magnifierElement: magnifierRef.current,
                        magnifierState,
                      })
                    : null;

                  if (
                    magnifierState &&
                    isViewportPointInsideMagnifier({
                      clientX: event.clientX,
                      clientY: event.clientY,
                      magnifierViewportRect: magnifierViewportRect ?? undefined,
                      magnifierState,
                    })
                  ) {
                    updateHoveredSegmentKey(
                      findSegmentKeyAtMagnifierPoint({
                        clientX: event.clientX,
                        clientY: event.clientY,
                        magnifierViewportRect: magnifierViewportRect ?? undefined,
                        magnifierState,
                        pageSegmentMatches,
                      }),
                    );
                    return;
                  }

                  updateHoveredSegmentKey(match.key);
                }}
                onMouseLeave={(event) => {
                  const magnifierViewportRect = magnifierState
                    ? resolveRenderedMagnifierViewportRect({
                        magnifierElement: magnifierRef.current,
                        magnifierState,
                      })
                    : null;

                  if (
                    magnifierState &&
                    isViewportPointInsideMagnifier({
                      clientX: event.clientX,
                      clientY: event.clientY,
                      magnifierViewportRect: magnifierViewportRect ?? undefined,
                      magnifierState,
                    })
                  ) {
                    updateHoveredSegmentKey(
                      findSegmentKeyAtMagnifierPoint({
                        clientX: event.clientX,
                        clientY: event.clientY,
                        magnifierViewportRect: magnifierViewportRect ?? undefined,
                        magnifierState,
                        pageSegmentMatches,
                      }),
                    );
                    return;
                  }

                  clearHoveredSegmentKeyIfCurrent(match.key);
                }}
                style={{
                  height: `${rect.height}px`,
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                }}
                type="button"
              />
            )),
          )}
        </div>
      ) : null}
      {hoveredSegmentMatch ? (
        <div className="resume-interactive-layer">
          {hoveredSegmentMatch.rects.map((rect, index) => (
            <div
              className="resume-interactive-highlight resume-interactive-highlight--hover"
              key={`hover-${hoveredSegmentMatch.key}-${page.pageNumber}-${index}`}
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
      {focusActive &&
      focusHighlightRects.length > 0 &&
      guidedFocusToken === `${focusKey}:${focusRequest}` ? (
        <div className="resume-interactive-layer">
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
      {magnifierState && magnifierCanvasDataUrl && renderState === "ready" ? (
        <div
          aria-hidden="true"
          className="resume-interactive-magnifier"
          data-hovered-segment-key={hoveredSegmentMatch?.key ?? undefined}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();

            const renderedMagnifierRect = event.currentTarget.getBoundingClientRect();
            const magnifierViewportRect = {
              height: renderedMagnifierRect.height,
              left: renderedMagnifierRect.left,
              top: renderedMagnifierRect.top,
              width: renderedMagnifierRect.width,
            };
            const renderedSpotlightSegmentKey =
              event.currentTarget.dataset.hoveredSegmentKey ?? null;
            const highlightedSpotlightSegmentKey =
              renderedSpotlightSegmentKey ?? hoveredSegmentKeyRef.current;
            const highlightedSpotlightMatch = highlightedSpotlightSegmentKey
              ? pageSegmentMatches.find(
                  (match) => match.key === highlightedSpotlightSegmentKey,
                ) ?? null
              : null;
            const fallbackSpotlightSegmentKey =
              highlightedSpotlightMatch === null
                ? findSegmentKeyAtMagnifierPoint({
                    clientX: event.clientX,
                    clientY: event.clientY,
                    magnifierViewportRect,
                    magnifierState,
                    pageSegmentMatches,
                  })
                : null;
            const spotlightMatch =
              highlightedSpotlightMatch ??
              pageSegmentMatches.find(
                (match) => match.key === fallbackSpotlightSegmentKey,
              ) ??
              null;

            if (!spotlightMatch) {
              updateHoveredSegmentKey(null);
              return;
            }

            suppressNextSegmentClickRef.current = true;
            window.setTimeout(() => {
              suppressNextSegmentClickRef.current = false;
            }, 1000);
            setMagnifierState(null);
            updateHoveredSegmentKey(null);
            onSegmentClick?.(spotlightMatch.segmentId);
          }}
          onPointerMove={(event) => {
            const renderedMagnifierRect = event.currentTarget.getBoundingClientRect();
            const magnifierViewportRect = {
              height: renderedMagnifierRect.height,
              left: renderedMagnifierRect.left,
              top: renderedMagnifierRect.top,
              width: renderedMagnifierRect.width,
            };
            const pageRect = pageRef.current?.getBoundingClientRect() ?? null;
            // Keep movement tied to the underlying PDF while the cursor is over
            // it; use magnifier-space math below only for segment hit testing.
            const nextMagnifierState =
              pageRect &&
              isViewportPointInsidePage({
                clientX: event.clientX,
                clientY: event.clientY,
                pageRect,
              })
                ? resolvePreviewMagnifierStateFromViewportPagePoint({
                    clientX: event.clientX,
                    clientY: event.clientY,
                    pageHeight,
                    pageMatchIndex: highlightSource?.pageMatchIndex ?? null,
                    pageRect,
                    pageWidth,
                    magnifierBounds: resolvePreviewMagnifierBounds({
                      maxWidthRatio: magnifierMaxWidthRatio,
                      rootRect: rootRef.current?.getBoundingClientRect() ?? null,
                    }),
                  })
                : magnifierState;

            setMagnifierState(nextMagnifierState);
            updateHoveredSegmentKey(
              findSegmentKeyAtMagnifierPoint({
                clientX: event.clientX,
                clientY: event.clientY,
                magnifierViewportRect,
                magnifierState: nextMagnifierState,
                pageSegmentMatches,
              }),
            );
          }}
          ref={magnifierRef}
          style={{
            backgroundImage: `url(${magnifierCanvasDataUrl})`,
            backgroundPosition: `${magnifierState.width / 2 - magnifierState.x * magnifierState.zoom}px ${
              magnifierState.height / 2 -
              magnifierState.y * magnifierState.zoom
            }px`,
            backgroundSize: `${pageWidth * magnifierState.zoom}px ${
              pageHeight * magnifierState.zoom
            }px`,
            height: `${magnifierState.height}px`,
            left: `${magnifierState.left}px`,
            top: `${magnifierState.top}px`,
            width: `${magnifierState.width}px`,
          }}
        >
          <div
            className="resume-interactive-magnifier-highlight-layer"
            style={{
              height: `${pageHeight}px`,
              transform: `translate(${magnifierState.width / 2 - magnifierState.x * magnifierState.zoom}px, ${
                magnifierState.height / 2 -
                magnifierState.y * magnifierState.zoom
              }px) scale(${magnifierState.zoom})`,
              width: `${pageWidth}px`,
            }}
          >
            {pageHighlightMatches.flatMap((match) =>
              match.rects.map((rect, index) => (
                <div
                  className={`resume-interactive-highlight ${
                    match.tone === "changed"
                      ? "resume-interactive-highlight--changed"
                      : "resume-interactive-highlight--added"
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
            {hoveredSegmentMatch
              ? hoveredSegmentMatch.rects.map((rect, index) => (
                  <div
                    className="resume-interactive-highlight resume-interactive-highlight--hover"
                    key={`magnifier-hover-${hoveredSegmentMatch.key}-${page.pageNumber}-${index}`}
                    style={{
                      height: `${rect.height}px`,
                      left: `${rect.left}px`,
                      top: `${rect.top}px`,
                      width: `${rect.width}px`,
                    }}
                  />
                ))
              : null}
            {focusActive &&
            focusHighlightRects.length > 0 &&
            guidedFocusToken === `${focusKey}:${focusRequest}`
              ? focusHighlightRects.map((rect, index) => (
                  <div
                    className="resume-interactive-highlight resume-interactive-highlight--focus resume-interactive-highlight--guided"
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
        <div className="resume-interactive-page-loading">
          <div className="resume-interactive-pill">
            Building interactive preview...
          </div>
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="resume-interactive-page-error">
          <div className="resume-interactive-error-content">
            <p>The interactive renderer could not paint this page.</p>
            {renderErrorMessage ? (
              <pre>
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
  focusRequest = 0,
  focusKey = null,
  focusMatchKey = null,
  focusQuery = null,
  highlightQueries,
  loadPdfJsModule: loadPdfJsModuleProp,
  magnifierMaxWidthRatio = 0.6,
  onFocusViewportRectChange,
  onPageSnapshot,
  onRenderFailure,
  onSegmentClick,
  pdfUrl,
  presentation = "web",
  scaleMode = "width",
  segmentQueries = [],
}: TailoredResumeInteractivePreviewProps) {
  const [loadedPages, setLoadedPages] = useState<LoadedPdfPage[]>([]);
  const [documentState, setDocumentState] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });
  const resolvedLoadPdfJsModule = loadPdfJsModuleProp ?? loadPdfJsModule;

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
      return;
    }

    const resolvedPdfUrl = pdfUrl;
    let isCancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadDocument() {
      setDocumentState("loading");

      try {
        const pdfJs = await resolvedLoadPdfJsModule();

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
            const lastMeaningfulPageNumber =
              await resolveLastMeaningfulPdfPageNumber({
                getPage: (pageNumber) => pdfDocument.getPage(pageNumber),
                pageCount: pdfDocument.numPages,
              });
            const nextLoadedPages: LoadedPdfPage[] = [];

            for (
              let pageNumber = 1;
              pageNumber <= lastMeaningfulPageNumber;
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
  }, [onRenderFailure, pdfUrl, resolvedLoadPdfJsModule]);

  const pageScale = useMemo(() => {
    const firstPageWidth = loadedPages[0]?.baseWidth;
    const firstPageHeight = loadedPages[0]?.baseHeight;

    if (!firstPageWidth || !containerSize.width) {
      return 1;
    }

    if (scaleMode === "fit") {
      if (!firstPageHeight || !containerSize.height) {
        return 1;
      }

      const widthScale = (containerSize.width - 8) / firstPageWidth;
      const heightScale = (containerSize.height - 8) / firstPageHeight;

      return Math.max(0.15, Math.min(widthScale, heightScale));
    }

    return Math.max(0.4, (containerSize.width - 8) / firstPageWidth);
  }, [containerSize, loadedPages, scaleMode]);

  if (!pdfUrl) {
    return (
      <div className="resume-interactive-empty">
        This tailored resume does not have a compiled PDF preview yet.
      </div>
    );
  }

  if (presentation === "frameless") {
    return (
      <div
        className="resume-interactive-root resume-interactive-root--frameless"
        ref={rootRef}
      >
        <div className="resume-interactive-scroller" ref={containerRef}>
          <div className="resume-interactive-stack resume-interactive-stack--fit">
            {documentState === "loading" ? (
              <div className="resume-interactive-pill">
                Loading {displayName}...
              </div>
            ) : null}

            {documentState === "error" ? (
              <div className="resume-interactive-error-card">
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
                    loadPdfJsModuleForPreview={resolvedLoadPdfJsModule}
                    magnifierMaxWidthRatio={magnifierMaxWidthRatio}
                    onFocusViewportRectChange={onFocusViewportRectChange}
                    onPageSnapshot={onPageSnapshot}
                    onRenderFailure={onRenderFailure}
                    onSegmentClick={onSegmentClick}
                    page={page}
                    rootRef={rootRef}
                    scale={pageScale}
                    scrollContainerRef={containerRef}
                    segmentQueries={segmentQueries}
                  />
                ))
              : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="resume-interactive-root resume-interactive-root--web"
      ref={rootRef}
    >
      <div className="resume-interactive-header">
        <p>
          Interactive render
        </p>
      </div>

      <div className="app-scrollbar resume-interactive-scroller" ref={containerRef}>
        <div className="resume-interactive-stack resume-interactive-stack--width">
          {documentState === "loading" ? (
            <div className="resume-interactive-pill">
              Loading {displayName}...
            </div>
          ) : null}

          {documentState === "error" ? (
            <div className="resume-interactive-error-card">
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
                  loadPdfJsModuleForPreview={resolvedLoadPdfJsModule}
                  magnifierMaxWidthRatio={magnifierMaxWidthRatio}
                  onFocusViewportRectChange={onFocusViewportRectChange}
                  onPageSnapshot={onPageSnapshot}
                  onRenderFailure={onRenderFailure}
                  onSegmentClick={onSegmentClick}
                  page={page}
                  rootRef={rootRef}
                  scale={pageScale}
                  scrollContainerRef={containerRef}
                  segmentQueries={segmentQueries}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
