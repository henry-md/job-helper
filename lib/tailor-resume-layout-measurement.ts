import {
  DOMMatrix,
  ImageData,
  Path2D,
} from "@napi-rs/canvas";
import type {
  PDFPageProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import { compileTailorResumeLatex } from "./tailor-resume-latex.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import { ensurePdfJsServerWorker } from "./pdfjs-server-worker.ts";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPageViewport = ReturnType<PDFPageProxy["getViewport"]>;

type TextRect = {
  height: number;
  left: number;
  pageNumber: number;
  top: number;
  width: number;
};

export type TailorResumeRenderedLineMeasurement = {
  left: number;
  pageNumber: number;
  right: number;
  width: number;
};

type DocumentMatchCharacter = {
  rect: TextRect | null;
};

type DocumentMatchIndex = {
  compactPositions: number[];
  compactText: string;
  normalizedBoundaryToCompact: number[];
  normalizedText: string;
  positions: DocumentMatchCharacter[];
};

export type TailorResumeSegmentLineMeasurement = {
  command: string | null;
  lineCount: number;
  lines: TailorResumeRenderedLineMeasurement[];
  pageNumbers: number[];
  plainText: string;
  segmentId: string;
};

export type TailorResumeSectionLineMeasurement = {
  lineCount: number;
  sectionId: string;
  title: string;
};

export type TailorResumeLayoutMeasurement = {
  pageCount: number;
  pdfBuffer: Buffer;
  sections: TailorResumeSectionLineMeasurement[];
  segments: TailorResumeSegmentLineMeasurement[];
  unmatchedSegmentIds: string[];
};

export type TailorResumeOverflowLineEstimate = {
  actualPageCount: number;
  estimatedLinesToRecover: number;
  overflowRenderedLines: number;
  targetPageCount: number;
};

const excludedLayoutCommands = new Set([
  "begin",
  "documentclass",
  "end",
  "input",
  "newcommand",
  "newenvironment",
  "pagestyle",
  "pdfgentounicode",
  "renewcommand",
  "setlength",
  "setlist",
  "usepackage",
  "urlstyle",
]);

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
  await ensurePdfJsServerWorker();
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

export async function countPdfPages(pdfBuffer: Buffer) {
  const { loadingTask, pdfDocument } = await loadPdfDocument(pdfBuffer);

  try {
    return pdfDocument.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

function isTextItem(item: TextContent["items"][number]): item is TextItem {
  return "str" in item;
}

function normalizeLayoutSpecialCharacters(value: string) {
  return value
    .normalize("NFKC")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[˜∼\u0303]/g, "~")
    .replace(/ˆ/g, "^");
}

function normalizeLayoutText(value: string) {
  return normalizeLayoutSpecialCharacters(value)
    .replace(/([A-Za-z])-\s+(?=[A-Za-z])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSkipCompactLayoutCharacter(value: string, index: number) {
  const currentCharacter = value[index] ?? "";

  if (/\s/.test(currentCharacter) || currentCharacter === "•") {
    return true;
  }

  if (currentCharacter !== "-") {
    return false;
  }

  const previousCharacter = value[index - 1] ?? "";
  let nextIndex = index + 1;

  while (nextIndex < value.length && /\s/.test(value[nextIndex] ?? "")) {
    nextIndex += 1;
  }

  const nextCharacter = value[nextIndex] ?? "";

  return /[A-Za-z]/.test(previousCharacter) && /[A-Za-z]/.test(nextCharacter);
}

function appendNormalizedMatchCharacter(input: {
  char: string;
  normalizedTextParts: string[];
  positions: DocumentMatchCharacter[];
  previousWasWhitespace: boolean;
  rect: TextRect | null;
}) {
  const normalizedCharacters = Array.from(
    normalizeLayoutSpecialCharacters(input.char),
  );
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
            pageNumber: input.rect.pageNumber,
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
  pageNumber: number;
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
    pageNumber: input.pageNumber,
    top,
    width: Math.max(width, 1),
  } satisfies TextRect;
}

function appendTextContentToDocumentIndex(input: {
  documentIndex: Omit<DocumentMatchIndex, "compactPositions" | "compactText" | "normalizedBoundaryToCompact">;
  pageNumber: number;
  pdfJs: PdfJsModule;
  textContent: TextContent;
  viewport: PdfPageViewport;
}) {
  let previousWasWhitespace =
    input.documentIndex.normalizedText.endsWith(" ") ||
    input.documentIndex.normalizedText.length === 0;
  const normalizedTextParts = [input.documentIndex.normalizedText];

  for (const item of input.textContent.items) {
    if (!isTextItem(item)) {
      continue;
    }

    const itemCharacters = Array.from(item.str);
    const itemRect = resolveTextItemRect({
      item,
      pageNumber: input.pageNumber,
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
        positions: input.documentIndex.positions,
        previousWasWhitespace,
        rect:
          itemRect && characterWidth > 0
            ? {
                height: itemRect.height,
                left: itemRect.left + characterWidth * index,
                pageNumber: itemRect.pageNumber,
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
        positions: input.documentIndex.positions,
        previousWasWhitespace,
        rect: null,
      });
    }
  }

  previousWasWhitespace = appendNormalizedMatchCharacter({
    char: " ",
    normalizedTextParts,
    positions: input.documentIndex.positions,
    previousWasWhitespace,
    rect: null,
  });
  input.documentIndex.normalizedText = normalizedTextParts.join("");
}

function addCompactIndex(
  documentIndex: Omit<DocumentMatchIndex, "compactPositions" | "compactText" | "normalizedBoundaryToCompact">,
): DocumentMatchIndex {
  const compactPositions: number[] = [];
  const compactTextParts: string[] = [];
  const normalizedBoundaryToCompact = [0];
  let compactLength = 0;

  for (let index = 0; index < documentIndex.normalizedText.length; index += 1) {
    const currentCharacter = documentIndex.normalizedText[index] ?? "";

    if (
      !shouldSkipCompactLayoutCharacter(documentIndex.normalizedText, index)
    ) {
      compactTextParts.push(currentCharacter);
      compactPositions.push(index);
      compactLength += 1;
    }

    normalizedBoundaryToCompact.push(compactLength);
  }

  return {
    ...documentIndex,
    compactPositions,
    compactText: compactTextParts.join(""),
    normalizedBoundaryToCompact,
  };
}

async function buildDocumentMatchIndex(pdfBuffer: Buffer) {
  const { loadingTask, pdfDocument, pdfJs } = await loadPdfDocument(pdfBuffer);

  try {
    const documentIndex = {
      normalizedText: "",
      positions: [] as DocumentMatchCharacter[],
    };

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      appendTextContentToDocumentIndex({
        documentIndex,
        pageNumber,
        pdfJs,
        textContent,
        viewport,
      });
    }

    return {
      index: addCompactIndex(documentIndex),
      pageCount: pdfDocument.numPages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function findNormalizedRange(input: {
  anchorText: string;
  cursor: number;
  documentIndex: DocumentMatchIndex;
}) {
  const normalizedAnchorText = normalizeLayoutText(input.anchorText);

  if (!normalizedAnchorText) {
    return null;
  }

  const exactStart = input.documentIndex.normalizedText.indexOf(
    normalizedAnchorText,
    input.cursor,
  );

  if (exactStart !== -1) {
    return {
      end: exactStart + normalizedAnchorText.length,
      start: exactStart,
    };
  }

  const longAnchorChunkLength = Math.min(160, Math.floor(normalizedAnchorText.length / 3));

  if (longAnchorChunkLength >= 48) {
    const prefixText = normalizedAnchorText.slice(0, longAnchorChunkLength);
    const suffixText = normalizedAnchorText.slice(-longAnchorChunkLength);
    const prefixStart = input.documentIndex.normalizedText.indexOf(
      prefixText,
      input.cursor,
    );

    if (prefixStart !== -1) {
      const suffixStart = input.documentIndex.normalizedText.indexOf(
        suffixText,
        prefixStart + prefixText.length,
      );

      if (suffixStart !== -1) {
        return {
          end: suffixStart + suffixText.length,
          start: prefixStart,
        };
      }
    }
  }

  const compactAnchorPositions: number[] = [];
  const compactAnchorParts: string[] = [];

  for (let index = 0; index < normalizedAnchorText.length; index += 1) {
    const currentCharacter = normalizedAnchorText[index] ?? "";

    if (!shouldSkipCompactLayoutCharacter(normalizedAnchorText, index)) {
      compactAnchorParts.push(currentCharacter);
      compactAnchorPositions.push(index);
    }
  }

  const compactAnchorText = compactAnchorParts.join("");

  if (!compactAnchorText) {
    return null;
  }

  const compactCursor =
    input.documentIndex.normalizedBoundaryToCompact[input.cursor] ?? 0;
  const compactStart = input.documentIndex.compactText.indexOf(
    compactAnchorText,
    compactCursor,
  );

  if (compactStart === -1) {
    return null;
  }

  const startPosition = input.documentIndex.compactPositions[compactStart];
  const endPosition =
    input.documentIndex.compactPositions[
      compactStart + compactAnchorText.length - 1
    ];

  if (typeof startPosition !== "number" || typeof endPosition !== "number") {
    return null;
  }

  return {
    end: endPosition + 1,
    start: startPosition,
  };
}

function measureTextLines(rects: TextRect[]): TailorResumeRenderedLineMeasurement[] {
  const lines: Array<{
    bottom: number;
    height: number;
    left: number;
    midline: number;
    pageNumber: number;
    right: number;
    top: number;
  }> = [];

  for (const rect of [...rects].sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    if (Math.abs(left.top - right.top) > 0.01) {
      return left.top - right.top;
    }

    return left.left - right.left;
  })) {
    const midline = rect.top + rect.height / 2;
    const rectRight = rect.left + rect.width;
    const existingLine = lines.find(
      (line) =>
        line.pageNumber === rect.pageNumber &&
        Math.abs(line.midline - midline) <= Math.max(line.height, rect.height) * 0.7,
    );

    if (existingLine) {
      existingLine.midline =
        (existingLine.midline + midline) / 2;
      existingLine.height = Math.max(existingLine.height, rect.height);
      existingLine.left = Math.min(existingLine.left, rect.left);
      existingLine.right = Math.max(existingLine.right, rectRight);
      existingLine.top = Math.min(existingLine.top, rect.top);
      existingLine.bottom = Math.max(existingLine.bottom, rect.top + rect.height);
      continue;
    }

    lines.push({
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect.left,
      midline,
      pageNumber: rect.pageNumber,
      right: rectRight,
      top: rect.top,
    });
  }

  return lines.map((line) => ({
    left: line.left,
    pageNumber: line.pageNumber,
    right: line.right,
    width: Math.max(0, line.right - line.left),
  }));
}

function countTextLines(rects: TextRect[]) {
  return measureTextLines(rects).length;
}

function readRectsForRange(input: {
  documentIndex: DocumentMatchIndex;
  end: number;
  start: number;
}) {
  return input.documentIndex.positions
    .slice(input.start, input.end)
    .flatMap((position) =>
      position?.rect && position.rect.width > 0 && position.rect.height > 0
        ? [position.rect]
        : [],
    );
}

function readSectionIdFromSegmentId(segmentId: string) {
  return segmentId.split(".")[0]?.trim() || "unsectioned";
}

function buildSectionMeasurements(
  segments: TailorResumeSegmentLineMeasurement[],
) {
  const sectionsById = new Map<string, TailorResumeSectionLineMeasurement>();
  let currentSectionId = "unsectioned";

  for (const segment of segments) {
    if (segment.command === "resumeSection") {
      currentSectionId = readSectionIdFromSegmentId(segment.segmentId);
      sectionsById.set(currentSectionId, {
        lineCount: segment.lineCount,
        sectionId: currentSectionId,
        title: segment.plainText,
      });
      continue;
    }

    const sectionId = readSectionIdFromSegmentId(segment.segmentId) || currentSectionId;
    const currentSection = sectionsById.get(sectionId);

    if (!currentSection) {
      sectionsById.set(sectionId, {
        lineCount: segment.lineCount,
        sectionId,
        title: sectionId,
      });
      continue;
    }

    currentSection.lineCount += segment.lineCount;
  }

  return Array.from(sectionsById.values());
}

export async function measureTailorResumeLayout(input: {
  annotatedLatexCode: string;
  pdfBuffer?: Buffer;
}): Promise<TailorResumeLayoutMeasurement> {
  const normalized = normalizeTailorResumeLatex(input.annotatedLatexCode);
  const visibleBlocks = readAnnotatedTailorResumeBlocks(
    normalized.annotatedLatex,
  ).flatMap((block) => {
    if (block.command && excludedLayoutCommands.has(block.command)) {
      return [];
    }

    const plainText = renderTailoredResumeLatexToPlainText(block.latexCode);

    if (!plainText) {
      return [];
    }

    return [
      {
        command: block.command,
        plainText,
        segmentId: block.id,
      },
    ];
  });
  const pdfBuffer =
    input.pdfBuffer ??
    (await compileTailorResumeLatex(
      stripTailorResumeSegmentIds(normalized.annotatedLatex),
    ));
  const { index: documentIndex, pageCount } = await buildDocumentMatchIndex(pdfBuffer);
  const segments: TailorResumeSegmentLineMeasurement[] = [];
  const unmatchedSegmentIds: string[] = [];
  let cursor = 0;

  for (const block of visibleBlocks) {
    const range = findNormalizedRange({
      anchorText: block.plainText,
      cursor,
      documentIndex,
    });

    if (!range) {
      unmatchedSegmentIds.push(block.segmentId);
      continue;
    }

    const rects = readRectsForRange({
      documentIndex,
      end: range.end,
      start: range.start,
    });
    const pageNumbers = Array.from(
      new Set(rects.map((rect) => rect.pageNumber)),
    ).sort((left, right) => left - right);
    const lines = measureTextLines(rects);

    segments.push({
      command: block.command,
      lineCount: lines.length,
      lines,
      pageNumbers,
      plainText: block.plainText,
      segmentId: block.segmentId,
    });
    cursor = range.end;
  }

  return {
    pageCount,
    pdfBuffer,
    sections: buildSectionMeasurements(segments),
    segments,
    unmatchedSegmentIds,
  };
}

export async function estimateTailorResumeOverflowLines(input: {
  pdfBuffer: Buffer;
  targetPageCount: number;
}): Promise<TailorResumeOverflowLineEstimate> {
  const { loadingTask, pdfDocument, pdfJs } = await loadPdfDocument(input.pdfBuffer);
  const targetPageCount = Math.max(1, Math.floor(input.targetPageCount));

  try {
    const overflowRects: TextRect[] = [];

    for (
      let pageNumber = targetPageCount + 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        if (!isTextItem(item)) {
          continue;
        }

        const rect = resolveTextItemRect({
          item,
          pageNumber,
          pdfJs,
          textContent,
          viewport,
        });

        if (rect) {
          overflowRects.push(rect);
        }
      }
    }

    const overflowRenderedLines = countTextLines(overflowRects);

    return {
      actualPageCount: pdfDocument.numPages,
      estimatedLinesToRecover:
        pdfDocument.numPages > targetPageCount
          ? Math.max(1, overflowRenderedLines)
          : 0,
      overflowRenderedLines,
      targetPageCount,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export function indexTailorResumeSegmentMeasurements(
  layout: Pick<TailorResumeLayoutMeasurement, "segments">,
) {
  return new Map(layout.segments.map((segment) => [segment.segmentId, segment]));
}
