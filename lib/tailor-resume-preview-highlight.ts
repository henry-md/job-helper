import {
  buildTailoredResumeCombinedActiveEdits,
  resolveTailoredResumeSourceAnnotatedLatex,
} from "./tailor-resume-edit-history.ts";
import type { TailoredResumeBlockEditRecord } from "./tailor-resume-types.ts";
import { buildTailoredResumeDiffRows } from "./tailor-resume-review.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";

const reviewHighlightPreambleMarker = "% JOBHELPER_REVIEW_HIGHLIGHT_MACROS";
const annotatedSegmentPattern =
  /^[ \t]*% JOBHELPER_SEGMENT_ID:\s*([^\n]+)\s*(?:\n|$)/gm;

const reviewHighlightPreamble = String.raw`
% JOBHELPER_REVIEW_HIGHLIGHT_MACROS
\definecolor{JobHelperAddedHighlight}{RGB}{180,240,200}
\definecolor{JobHelperModifiedHighlight}{RGB}{255,225,128}
\newcommand{\jhladd}{\bgroup\markoverwith{\textcolor{JobHelperAddedHighlight}{\rule[-0.52ex]{2pt}{2.3ex}}}\ULon}
\newcommand{\jhlmod}{\bgroup\markoverwith{\textcolor{JobHelperModifiedHighlight}{\rule[-0.52ex]{2pt}{2.3ex}}}\ULon}
\newcommand{\jhladdlead}{\smash{\llap{\textcolor{JobHelperAddedHighlight}{\rule[-0.52ex]{0.34em}{2.3ex}}}}}
\newcommand{\jhlmodlead}{\smash{\llap{\textcolor{JobHelperModifiedHighlight}{\rule[-0.52ex]{0.34em}{2.3ex}}}}}
`;

const escapedInlinePunctuationPattern = /^\\[%&#_${}]$/;
const inlineHighlightCommandTokens = new Set([
  "\\textasciicircum",
  "\\textasciitilde",
  "\\textbackslash",
  "\\textbar",
]);
type PersistedAnnotatedBlock = {
  contentEnd: number;
  contentStart: number;
  id: string;
  latexCode: string;
};

function tokenizeHighlightableLatex(text: string) {
  return text.match(/\\[A-Za-z@]+|\\.|[{}]|%[^\n]*|\s+|[^\\{}%\s]+/g) ?? [];
}

function isInlineHighlightCommandToken(token: string) {
  return (
    escapedInlinePunctuationPattern.test(token) ||
    inlineHighlightCommandTokens.has(token)
  );
}

function isStructuralHighlightToken(token: string) {
  return (
    token === "{" ||
    token === "}" ||
    token.startsWith("%") ||
    (token.startsWith("\\") && !isInlineHighlightCommandToken(token))
  );
}

function canWrapWholeHighlightRange(text: string) {
  if (!text || text.includes("\n")) {
    return false;
  }

  return tokenizeHighlightableLatex(text).every((token) => {
    if (!token || token.startsWith("%")) {
      return false;
    }

    if (token.startsWith("\\")) {
      return isInlineHighlightCommandToken(token);
    }

    return true;
  });
}

function injectReviewHighlightPreamble(latexCode: string) {
  if (latexCode.includes(reviewHighlightPreambleMarker)) {
    return latexCode;
  }

  const documentStartIndex = latexCode.indexOf("\\begin{document}");

  if (documentStartIndex === -1) {
    throw new Error("Unable to inject review highlight macros into the LaTeX document.");
  }

  return (
    latexCode.slice(0, documentStartIndex) +
    reviewHighlightPreamble +
    "\n" +
    latexCode.slice(documentStartIndex)
  );
}

function readPersistedAnnotatedBlocks(annotatedLatexCode: string) {
  const matches: Array<{
    id: string;
    markerEnd: number;
    markerStart: number;
  }> = [];

  for (const match of annotatedLatexCode.matchAll(annotatedSegmentPattern)) {
    const markerStart = match.index ?? 0;
    const markerText = match[0] ?? "";
    const rawId = match[1] ?? "";
    const id = rawId.trim();

    if (!id || !markerText) {
      continue;
    }

    matches.push({
      id,
      markerEnd: markerStart + markerText.length,
      markerStart,
    });
  }

  return matches.map((match, index): PersistedAnnotatedBlock => {
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.markerStart ?? annotatedLatexCode.length;

    return {
      contentEnd,
      contentStart: match.markerEnd,
      id: match.id,
      latexCode: annotatedLatexCode
        .slice(match.markerEnd, contentEnd)
        .replace(/\n+$/, ""),
    };
  });
}

function highlightInlineLatexText(text: string, macroName: "jhladd" | "jhlmod") {
  const leadingWhitespace = text.match(/^\s+/)?.[0] ?? "";
  const trailingWhitespace = text.match(/\s+$/)?.[0] ?? "";
  const coreText = text.slice(
    leadingWhitespace.length,
    text.length - trailingWhitespace.length,
  );
  const leadMacroName = macroName === "jhladd" ? "jhladdlead" : "jhlmodlead";

  function buildHighlightedRun(value: string) {
    return `\\${macroName}{\\${leadMacroName}{}${value}}`;
  }

  if (coreText && canWrapWholeHighlightRange(coreText)) {
    return `${leadingWhitespace}${buildHighlightedRun(coreText)}${trailingWhitespace}`;
  }

  const tokens = tokenizeHighlightableLatex(coreText);
  const output: string[] = [];
  let buffer = "";

  function flushBuffer() {
    if (!buffer) {
      return;
    }

    output.push(buildHighlightedRun(buffer));
    buffer = "";
  }

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (isStructuralHighlightToken(token)) {
      flushBuffer();
      output.push(token);
      continue;
    }

    buffer += token;
  }

  flushBuffer();

  return leadingWhitespace + output.join("") + trailingWhitespace;
}

function applyDiffHighlights(input: {
  after: string;
  before: string;
}) {
  const diffRows = buildTailoredResumeDiffRows(input.before, input.after);
  const outputLines: string[] = [];

  for (const row of diffRows) {
    if (row.modifiedText === null) {
      continue;
    }

    if (row.type === "context") {
      outputLines.push(row.modifiedText);
      continue;
    }

    if (row.type === "added") {
      outputLines.push(highlightInlineLatexText(row.modifiedText, "jhladd"));
      continue;
    }

    const segments = row.modifiedSegments;

    if (segments && segments.some((segment) => segment.type === "added")) {
      const firstAddedIndex = segments.findIndex(
        (segment) => segment.type === "added",
      );
      let lastAddedIndex = -1;

      for (let index = segments.length - 1; index >= 0; index -= 1) {
        if (segments[index]?.type === "added") {
          lastAddedIndex = index;
          break;
        }
      }

      if (firstAddedIndex === -1 || lastAddedIndex === -1) {
        outputLines.push(row.modifiedText);
        continue;
      }

      const leadingContext = segments
        .slice(0, firstAddedIndex)
        .map((segment) => segment.text)
        .join("");
      const highlightedRange = segments
        .slice(firstAddedIndex, lastAddedIndex + 1)
        .map((segment) => segment.text)
        .join("");
      const trailingContext = segments
        .slice(lastAddedIndex + 1)
        .map((segment) => segment.text)
        .join("");

      outputLines.push(
        leadingContext +
          highlightInlineLatexText(highlightedRange, "jhlmod") +
          trailingContext,
      );
      continue;
    }

    outputLines.push(row.modifiedText);
  }

  return outputLines.join("\n");
}

export function buildTailoredResumeReviewHighlightedLatex(input: {
  annotatedLatexCode: string;
  edits: TailoredResumeBlockEditRecord[];
  sourceAnnotatedLatexCode?: string | null;
}) {
  const combinedEdits = buildTailoredResumeCombinedActiveEdits({
    annotatedLatexCode: input.annotatedLatexCode,
    edits: input.edits,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode ?? null,
  });
  const normalizedAnnotatedLatex = resolveTailoredResumeSourceAnnotatedLatex({
    annotatedLatexCode: input.annotatedLatexCode,
    edits: input.edits,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode ?? null,
  })
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = readPersistedAnnotatedBlocks(normalizedAnnotatedLatex);
  const editsBySegmentId = new Map(combinedEdits.map((edit) => [edit.segmentId, edit]));
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    result += normalizedAnnotatedLatex.slice(cursor, block.contentStart);

    const edit = editsBySegmentId.get(block.id);

    if (edit) {
      const originalChunk = normalizedAnnotatedLatex.slice(
        block.contentStart,
        block.contentEnd,
      );
      const trailingWhitespace = originalChunk.slice(block.latexCode.length);

      result +=
        applyDiffHighlights({
          after: edit.afterLatexCode,
          before: edit.beforeLatexCode,
        }) + trailingWhitespace;
    } else {
      result += normalizedAnnotatedLatex.slice(block.contentStart, block.contentEnd);
    }

    cursor = block.contentEnd;
  }

  result += normalizedAnnotatedLatex.slice(cursor);

  return injectReviewHighlightPreamble(stripTailorResumeSegmentIds(result));
}
