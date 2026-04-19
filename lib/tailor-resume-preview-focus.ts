import {
  buildTailoredResumeCombinedActiveEdits,
  buildTailoredResumeResolvedSegmentMap,
  resolveTailoredResumeCurrentEditLatexCode,
} from "./tailor-resume-edit-history.ts";
import { buildTailoredResumeDiffRows } from "./tailor-resume-review.ts";
import type { TailoredResumeRecord } from "./tailor-resume-types.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";

export type TailoredResumePreviewHighlightTone = "added" | "changed";

export type TailoredResumePreviewHighlightRange = {
  end: number;
  start: number;
  tone: TailoredResumePreviewHighlightTone;
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

  if (value[cursor] === "=") {
    cursor += 1;

    while (cursor < end && !/\s/.test(value[cursor] ?? "")) {
      cursor += 1;
    }
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

    if (!/\s/.test(currentCharacter) && currentCharacter !== "•") {
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

function buildPreviewLineStartOffsets(value: string) {
  const normalizedValue = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedValue ? normalizedValue.split("\n") : [""];
  const lineStartOffsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }

  return lineStartOffsets;
}

function trimPreviewHighlightRange(input: {
  start: number;
  text: string;
  tone: TailoredResumePreviewHighlightTone;
}) {
  const leadingWhitespace = input.text.match(/^\s+/)?.[0].length ?? 0;
  const trailingWhitespace = input.text.match(/\s+$/)?.[0].length ?? 0;
  const trimmedStart = input.start + leadingWhitespace;
  const trimmedEnd = input.start + input.text.length - trailingWhitespace;

  if (trimmedEnd <= trimmedStart) {
    return null;
  }

  return {
    end: trimmedEnd,
    start: trimmedStart,
    tone: input.tone,
  } satisfies TailoredResumePreviewHighlightRange;
}

function buildRawHighlightRanges(beforeText: string, currentText: string) {
  const diffRows = buildTailoredResumeDiffRows(beforeText, currentText);
  const lineStartOffsets = buildPreviewLineStartOffsets(currentText);
  const highlightRanges: TailoredResumePreviewHighlightRange[] = [];

  for (const row of diffRows) {
    if (row.modifiedText === null || row.modifiedLineNumber === null) {
      continue;
    }

    const rowStartOffset = lineStartOffsets[row.modifiedLineNumber - 1] ?? 0;

    if (row.type === "context") {
      continue;
    }

    if (row.type === "added") {
      const trimmedRange = trimPreviewHighlightRange({
        start: rowStartOffset,
        text: row.modifiedText,
        tone: "added",
      });

      if (trimmedRange) {
        highlightRanges.push(trimmedRange);
      }

      continue;
    }

    if (!row.modifiedSegments || row.modifiedSegments.length === 0) {
      const trimmedRange = trimPreviewHighlightRange({
        start: rowStartOffset,
        text: row.modifiedText,
        tone: "changed",
      });

      if (trimmedRange) {
        highlightRanges.push(trimmedRange);
      }

      continue;
    }

    let segmentCursor = rowStartOffset;

    for (const segment of row.modifiedSegments) {
      const segmentStart = segmentCursor;
      segmentCursor += segment.text.length;

      if (segment.type !== "added") {
        continue;
      }

      const trimmedRange = trimPreviewHighlightRange({
        start: segmentStart,
        text: segment.text,
        tone: "changed",
      });

      if (trimmedRange) {
        highlightRanges.push(trimmedRange);
      }
    }
  }

  return highlightRanges;
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
      : ([
          {
            end: normalizedAnchorText.length,
            start: 0,
            tone: "changed",
          } satisfies TailoredResumePreviewHighlightRange,
        ] as TailoredResumePreviewHighlightRange[]);
  const clampRange = (range: TailoredResumePreviewHighlightRange) => {
    const start = Math.max(0, Math.min(range.start, normalizedAnchorText.length));
    const end = Math.max(start, Math.min(range.end, normalizedAnchorText.length));

    return end > start ? { end, start, tone: range.tone } : null;
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
          tone: clampedRange.tone,
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
        tone: clampedRange.tone,
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
  const rawHighlightRanges = buildRawHighlightRanges(beforePlainText, currentPlainText);

  if (rawHighlightRanges.length === 0) {
    return {
      anchorText: currentPlainText,
      highlightRanges: [],
      mode: "focus",
    } satisfies TailoredResumePreviewFocusQuery;
  }

  const highlightRanges = rawHighlightRanges.flatMap((range) => {
    const normalizedStart = normalizeTailoredResumePreviewMatchText(
      currentPlainText.slice(0, range.start),
    ).length;
    const normalizedEnd = normalizeTailoredResumePreviewMatchText(
      currentPlainText.slice(0, range.end),
    ).length;

    if (normalizedEnd <= normalizedStart) {
      return [];
    }

    return [
      {
        end: normalizedEnd,
        start: normalizedStart,
        tone: range.tone,
      } satisfies TailoredResumePreviewHighlightRange,
    ];
  });

  return {
    anchorText: currentPlainText,
    highlightRanges,
    mode: highlightRanges.length > 0 ? "changed" : "focus",
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
            resolveTailoredResumeCurrentEditLatexCode(edit),
          state: edit.state,
        });

    focusQueryByEditId.set(edit.editId, query);
  }

  return {
    focusQueryByEditId,
    highlightQueries,
  };
}
