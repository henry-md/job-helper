import { diffArrays } from "diff";
import {
  buildTailoredResumeCombinedActiveEdits,
  buildTailoredResumeResolvedSegmentMap,
} from "./tailor-resume-edit-history.ts";
import type { TailoredResumeRecord } from "./tailor-resume-types.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";

export type TailoredResumePreviewHighlightRange = {
  end: number;
  start: number;
};

export type TailoredResumePreviewFocusQuery = {
  anchorText: string;
  highlightRanges: TailoredResumePreviewHighlightRange[];
  mode: "changed" | "focus";
};

export type TailoredResumeInteractivePreviewQuery = {
  key: string;
  query: TailoredResumePreviewFocusQuery;
};

type CompactPreviewTextIndex = {
  compactPositions: number[];
  compactText: string;
  normalizedBoundaryToCompact: number[];
};

type ParsedCommand = {
  args: string[];
  command: string;
  end: number;
};

const escapedLatexCharacters = new Map<string, string>([
  ["&", "&"],
  ["%", "%"],
  ["$", "$"],
  ["#", "#"],
  ["_", "_"],
  ["{", "{"],
  ["}", "}"],
]);

function skipWhitespace(value: string, index: number, end = value.length) {
  let cursor = index;

  while (cursor < end && /\s/.test(value[cursor] ?? "")) {
    cursor += 1;
  }

  return cursor;
}

function readBalancedGroup(value: string, start: number, end = value.length) {
  const openChar = value[start];

  if (openChar !== "{" && openChar !== "[") {
    return null;
  }

  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let cursor = start;

  while (cursor < end) {
    const currentChar = value[cursor];

    if (currentChar === "\\") {
      cursor += 2;
      continue;
    }

    if (currentChar === openChar) {
      depth += 1;
    } else if (currentChar === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return {
          content: value.slice(start + 1, cursor),
          end: cursor + 1,
        };
      }
    }

    cursor += 1;
  }

  return null;
}

function readCommandAt(value: string, start: number, end = value.length): ParsedCommand | null {
  if (value[start] !== "\\") {
    return null;
  }

  let cursor = start + 1;

  while (cursor < end && /[A-Za-z*@]/.test(value[cursor] ?? "")) {
    cursor += 1;
  }

  const commandName = value.slice(start + 1, cursor);

  if (!commandName) {
    return null;
  }

  const args: string[] = [];

  while (cursor < end) {
    const nextCursor = skipWhitespace(value, cursor, end);
    const nextChar = value[nextCursor];

    if (nextChar === "[") {
      const optionalGroup = readBalancedGroup(value, nextCursor, end);

      if (!optionalGroup) {
        break;
      }

      cursor = optionalGroup.end;
      continue;
    }

    if (nextChar !== "{") {
      break;
    }

    const group = readBalancedGroup(value, nextCursor, end);

    if (!group) {
      break;
    }

    args.push(group.content);
    cursor = group.end;
  }

  return {
    args,
    command: commandName,
    end: cursor,
  };
}

function stripTailorResumeComments(value: string) {
  return value.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

function joinRenderedParts(parts: string[], separator = " ") {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);
}

function renderCommandToPlainText(
  commandName: string,
  args: string[],
  renderGroup: (value: string) => string,
) {
  switch (commandName) {
    case "textbf":
    case "textit":
    case "textsc":
    case "texttt":
    case "tightul":
    case "uline":
    case "underline":
    case "emph":
      return renderGroup(args[0] ?? "");
    case "href":
      return renderGroup(args[1] ?? args[0] ?? "");
    case "resumeitem":
    case "descline":
    case "resumeSection":
      return renderGroup(args[0] ?? "");
    case "entryheading": {
      const left = renderGroup(args[0] ?? "");
      const middle = renderGroup(args[1] ?? "");
      const right = renderGroup(args[2] ?? "");

      return joinRenderedParts(
        [
          joinRenderedParts([left, middle], " | "),
          right,
        ],
        " ",
      );
    }
    case "projectheading":
    case "labelline":
      return joinRenderedParts(args.map((arg) => renderGroup(arg)));
    case "resumeHeader":
      return "";
    case "textasciitilde":
      return "~";
    case "textless":
      return "<";
    case "textgreater":
      return ">";
    case "textbar":
      return "|";
    case "textbackslash":
      return "\\";
    case "textemdash":
      return "—";
    case "textendash":
      return "–";
    case "ldots":
      return "...";
    case "cdot":
      return "·";
    case "par":
    case "\\":
      return "\n";
    case "BodyFont":
    case "NameFont":
    case "SectionFont":
    case "EntryGap":
    case "noindent":
    case "hangindent":
    case "hangafter":
    case "hspace":
    case "hspace*":
    case "vspace":
    case "vspace*":
    case "pagestyle":
    case "setlength":
    case "linespread":
    case "urlstyle":
    case "definecolor":
    case "usepackage":
    case "documentclass":
    case "renewcommand":
    case "newcommand":
    case "input":
    case "pdfgentounicode":
      return "";
    case "begin":
    case "end":
      return "";
    default:
      return joinRenderedParts(args.map((arg) => renderGroup(arg)));
  }
}

function renderLatexFragmentToPlainText(value: string) {
  let cursor = 0;
  let output = "";

  while (cursor < value.length) {
    const currentChar = value[cursor];

    if (!currentChar) {
      break;
    }

    if (currentChar === "\\") {
      const escapedCharacter = value[cursor + 1];

      if (escapedCharacter && escapedLatexCharacters.has(escapedCharacter)) {
        output += escapedLatexCharacters.get(escapedCharacter);
        cursor += 2;
        continue;
      }

      if (escapedCharacter === "~") {
        output += "~";
        cursor += 2;
        continue;
      }

      if (escapedCharacter === "\\") {
        output += "\n";
        cursor += 2;
        continue;
      }

      const parsedCommand = readCommandAt(value, cursor);

      if (!parsedCommand) {
        cursor += 1;
        continue;
      }

      output += renderCommandToPlainText(
        parsedCommand.command,
        parsedCommand.args,
        renderLatexFragmentToPlainText,
      );
      cursor = parsedCommand.end;
      continue;
    }

    if (currentChar === "{") {
      const group = readBalancedGroup(value, cursor);

      if (!group) {
        cursor += 1;
        continue;
      }

      output += renderLatexFragmentToPlainText(group.content);
      cursor = group.end;
      continue;
    }

    if (currentChar === "~") {
      output += " ";
      cursor += 1;
      continue;
    }

    if (currentChar === "&") {
      output += " ";
      cursor += 1;
      continue;
    }

    output += currentChar;
    cursor += 1;
  }

  return output;
}

function tokenizeTailoredResumePreviewText(value: string) {
  return value.match(/[A-Za-z0-9]+(?:[\/+.:-][A-Za-z0-9]+)*|\s+|./g) ?? [];
}

function normalizePreviewWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildCompactPreviewTextIndex(value: string): CompactPreviewTextIndex {
  const compactPositions: number[] = [];
  const compactTextParts: string[] = [];
  const normalizedBoundaryToCompact = [0];
  let compactLength = 0;

  for (let index = 0; index < value.length; index += 1) {
    const currentCharacter = value[index] ?? "";

    if (!/\s/.test(currentCharacter)) {
      compactTextParts.push(currentCharacter);
      compactPositions.push(index);
      compactLength += 1;
    }

    normalizedBoundaryToCompact.push(compactLength);
  }

  return {
    compactPositions,
    compactText: compactTextParts.join(""),
    normalizedBoundaryToCompact,
  };
}

function buildRawHighlightRange(beforeText: string, currentText: string) {
  const diffParts = diffArrays(
    tokenizeTailoredResumePreviewText(beforeText),
    tokenizeTailoredResumePreviewText(currentText),
  );
  const addedRanges: TailoredResumePreviewHighlightRange[] = [];
  let currentCursor = 0;

  for (const part of diffParts) {
    const partText = part.value.join("");

    if (!partText) {
      continue;
    }

    if (part.added) {
      addedRanges.push({
        end: currentCursor + partText.length,
        start: currentCursor,
      });
      currentCursor += partText.length;
      continue;
    }

    if (part.removed) {
      continue;
    }

    currentCursor += partText.length;
  }

  if (addedRanges.length === 0) {
    return null;
  }

  let start = addedRanges[0]?.start ?? 0;
  let end = addedRanges.at(-1)?.end ?? start;

  while (start < end && /\s/.test(currentText[start] ?? "")) {
    start += 1;
  }

  while (end > start && /\s/.test(currentText[end - 1] ?? "")) {
    end -= 1;
  }

  if (start >= end) {
    return null;
  }

  return { end, start };
}

export function normalizeTailoredResumePreviewMatchText(value: string) {
  return normalizePreviewWhitespace(value.normalize("NFKC"));
}

export function resolveTailoredResumePreviewFocusRanges(input: {
  pageText: string;
  query: TailoredResumePreviewFocusQuery | null;
}) {
  if (!input.query) {
    return [] satisfies TailoredResumePreviewHighlightRange[];
  }

  const normalizedAnchorText = normalizeTailoredResumePreviewMatchText(
    input.query.anchorText,
  );

  if (!normalizedAnchorText) {
    return [] satisfies TailoredResumePreviewHighlightRange[];
  }

  const highlightRanges =
    input.query.highlightRanges.length > 0
      ? input.query.highlightRanges
      : [{ end: normalizedAnchorText.length, start: 0 }];
  const clampRange = (range: TailoredResumePreviewHighlightRange) => {
    const start = Math.max(0, Math.min(range.start, normalizedAnchorText.length));
    const end = Math.max(start, Math.min(range.end, normalizedAnchorText.length));

    return end > start ? { end, start } : null;
  };
  const anchorStart = input.pageText.indexOf(normalizedAnchorText);

  if (anchorStart !== -1) {
    return highlightRanges.flatMap((range) => {
      const clampedRange = clampRange(range);

      if (!clampedRange) {
        return [];
      }

      return [
        {
          end: anchorStart + clampedRange.end,
          start: anchorStart + clampedRange.start,
        },
      ] satisfies TailoredResumePreviewHighlightRange[];
    });
  }

  const pageCompactIndex = buildCompactPreviewTextIndex(input.pageText);
  const anchorCompactIndex = buildCompactPreviewTextIndex(normalizedAnchorText);

  if (!anchorCompactIndex.compactText) {
    return [] satisfies TailoredResumePreviewHighlightRange[];
  }

  const compactAnchorStart = pageCompactIndex.compactText.indexOf(
    anchorCompactIndex.compactText,
  );

  if (compactAnchorStart === -1) {
    return [] satisfies TailoredResumePreviewHighlightRange[];
  }

  return highlightRanges.flatMap((range) => {
    const clampedRange = clampRange(range);

    if (!clampedRange) {
      return [];
    }

    const compactStart =
      anchorCompactIndex.normalizedBoundaryToCompact[clampedRange.start] ?? 0;
    const compactEnd =
      anchorCompactIndex.normalizedBoundaryToCompact[clampedRange.end] ??
      anchorCompactIndex.compactText.length;

    if (compactEnd <= compactStart) {
      return [];
    }

    const startPosition =
      pageCompactIndex.compactPositions[compactAnchorStart + compactStart];
    const endPosition =
      pageCompactIndex.compactPositions[compactAnchorStart + compactEnd - 1];

    if (typeof startPosition !== "number" || typeof endPosition !== "number") {
      return [];
    }

    return [
      {
        end: endPosition + 1,
        start: startPosition,
      },
    ] satisfies TailoredResumePreviewHighlightRange[];
  });
}

export function renderTailoredResumeLatexToPlainText(latexCode: string) {
  const strippedLatex = stripTailorResumeComments(
    stripTailorResumeSegmentIds(latexCode),
  );

  return normalizePreviewWhitespace(renderLatexFragmentToPlainText(strippedLatex));
}

export function buildTailoredResumePreviewFocusQuery(input: {
  beforeLatexCode: string;
  currentLatexCode: string | null;
  state: "applied" | "rejected";
}) {
  const currentPlainText = renderTailoredResumeLatexToPlainText(
    input.currentLatexCode ?? input.beforeLatexCode,
  );

  if (!currentPlainText) {
    return null;
  }

  if (input.state === "rejected") {
    return {
      anchorText: currentPlainText,
      highlightRanges: [],
      mode: "focus",
    } satisfies TailoredResumePreviewFocusQuery;
  }

  const beforePlainText = renderTailoredResumeLatexToPlainText(input.beforeLatexCode);
  const rawHighlightRange = buildRawHighlightRange(beforePlainText, currentPlainText);

  if (!rawHighlightRange) {
    return {
      anchorText: currentPlainText,
      highlightRanges: [],
      mode: "focus",
    } satisfies TailoredResumePreviewFocusQuery;
  }

  const normalizedStart = normalizeTailoredResumePreviewMatchText(
    currentPlainText.slice(0, rawHighlightRange.start),
  ).length;
  const normalizedEnd = normalizeTailoredResumePreviewMatchText(
    currentPlainText.slice(0, rawHighlightRange.end),
  ).length;

  return {
    anchorText: currentPlainText,
    highlightRanges:
      normalizedEnd > normalizedStart
        ? [{ end: normalizedEnd, start: normalizedStart }]
        : [],
    mode: normalizedEnd > normalizedStart ? "changed" : "focus",
  } satisfies TailoredResumePreviewFocusQuery;
}

export function buildTailoredResumeInteractivePreviewQueries(
  record: Pick<
    TailoredResumeRecord,
    "annotatedLatexCode" | "edits" | "sourceAnnotatedLatexCode"
  >,
) {
  const combinedActiveEdits = buildTailoredResumeCombinedActiveEdits(record);
  const combinedActiveEditBySegmentId = new Map(
    combinedActiveEdits.map((edit) => [edit.segmentId, edit]),
  );
  const resolvedSegmentMap = buildTailoredResumeResolvedSegmentMap(record);
  const focusQueryByEditId = new Map<string, TailoredResumePreviewFocusQuery | null>();
  const highlightQueries: TailoredResumeInteractivePreviewQuery[] = [];

  for (const edit of combinedActiveEdits) {
    const query = buildTailoredResumePreviewFocusQuery({
      beforeLatexCode: edit.beforeLatexCode,
      currentLatexCode: edit.afterLatexCode,
      state: "applied",
    });

    if (!query) {
      continue;
    }

    highlightQueries.push({
      key: `segment:${edit.segmentId}`,
      query,
    });
  }

  for (const edit of record.edits) {
    const combinedActiveEdit = combinedActiveEditBySegmentId.get(edit.segmentId);
    const query = combinedActiveEdit
      ? buildTailoredResumePreviewFocusQuery({
          beforeLatexCode: combinedActiveEdit.beforeLatexCode,
          currentLatexCode: combinedActiveEdit.afterLatexCode,
          state: "applied",
        })
      : buildTailoredResumePreviewFocusQuery({
          beforeLatexCode: edit.beforeLatexCode,
          currentLatexCode:
            resolvedSegmentMap.get(edit.segmentId)?.latexCode ??
            (edit.state === "applied" ? edit.afterLatexCode : edit.beforeLatexCode),
          state: edit.state,
        });

    focusQueryByEditId.set(edit.editId, query);
  }

  return {
    focusQueryByEditId,
    highlightQueries,
  };
}
