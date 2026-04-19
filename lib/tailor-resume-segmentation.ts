const segmentMarkerPrefix = "% JOBHELPER_SEGMENT_ID: ";

type ParsedCommand = {
  args: string[];
  command: string;
  end: number;
  optionalArgs: string[];
  start: number;
};

type ParsedBraceBlock = {
  content: string;
  end: number;
  start: number;
};

type SegmentState = {
  bulletOrdinal: number;
  currentEntryOrdinal: number;
  currentSectionOrdinal: number;
  currentSectionSlug: string;
  descOrdinal: number;
  entryOrdinal: number;
  fallbackOrdinalsBySlug: Map<string, number>;
  labelOrdinal: number;
  projectOrdinal: number;
  sectionOrdinalsBySlug: Map<string, number>;
};

export type TailorResumeSegment = {
  command: string;
  id: string;
};

export type NormalizeTailorResumeLatexResult = {
  annotatedLatex: string;
  segmentCount: number;
  segments: TailorResumeSegment[];
};

export type TailorResumeAnnotatedBlock = {
  command: string | null;
  contentEnd: number;
  contentStart: number;
  id: string;
  latexCode: string;
  markerStart: number;
};

export function buildUniqueTailorResumeSegmentId(
  baseId: string,
  seenSegmentIds: Set<string>,
) {
  if (!seenSegmentIds.has(baseId)) {
    seenSegmentIds.add(baseId);
    return baseId;
  }

  let suffix = 2;

  while (seenSegmentIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueId = `${baseId}-${suffix}`;
  seenSegmentIds.add(uniqueId);
  return uniqueId;
}

function slugifySegmentPart(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function stripAnnotatedLine(value: string) {
  return value.replace(/^[ \t]*% JOBHELPER_SEGMENT_ID:[^\n]*\n?/gm, "");
}

function skipWhitespace(value: string, index: number) {
  let nextIndex = index;

  while (nextIndex < value.length && /\s/.test(value[nextIndex] ?? "")) {
    nextIndex += 1;
  }

  return nextIndex;
}

function readBalancedGroup(value: string, start: number, openChar: "{" | "[") {
  const closeChar = openChar === "{" ? "}" : "]";

  if (value[start] !== openChar) {
    return null;
  }

  let depth = 0;
  let cursor = start;

  while (cursor < value.length) {
    const currentChar = value[cursor];

    if (currentChar === "\\" && cursor + 1 < value.length) {
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

function readTopLevelBraceBlockAt(value: string, start: number): ParsedBraceBlock | null {
  const group = readBalancedGroup(value, start, "{");

  if (!group) {
    return null;
  }

  return {
    content: group.content,
    end: group.end,
    start,
  };
}

function readCommandAt(value: string, start: number): ParsedCommand | null {
  if (value[start] !== "\\") {
    return null;
  }

  let nameEnd = start + 1;

  while (nameEnd < value.length && /[A-Za-z]/.test(value[nameEnd] ?? "")) {
    nameEnd += 1;
  }

  const commandName = value.slice(start + 1, nameEnd);

  if (!commandName) {
    return null;
  }

  const args: string[] = [];
  const optionalArgs: string[] = [];
  let cursor = nameEnd;

  while (true) {
    const nextTokenStart = skipWhitespace(value, cursor);
    const skippedWhitespace = value.slice(cursor, nextTokenStart);
    const currentChar = value[nextTokenStart];

    if (
      (args.length > 0 || optionalArgs.length > 0) &&
      /\n\s*\n/.test(skippedWhitespace)
    ) {
      break;
    }

    if (currentChar === "[") {
      const group = readBalancedGroup(value, nextTokenStart, "[");

      if (!group) {
        return null;
      }

      optionalArgs.push(group.content);
      cursor = group.end;
      continue;
    }

    if (currentChar !== "{") {
      break;
    }

    const group = readBalancedGroup(value, nextTokenStart, "{");

    if (!group) {
      return null;
    }

    args.push(group.content);
    cursor = group.end;
  }

  return {
    args,
    command: commandName,
    end: cursor,
    optionalArgs,
    start,
  };
}

function createInitialSegmentState(): SegmentState {
  return {
    bulletOrdinal: 0,
    currentEntryOrdinal: 0,
    currentSectionOrdinal: 0,
    currentSectionSlug: "document",
    descOrdinal: 0,
    entryOrdinal: 0,
    fallbackOrdinalsBySlug: new Map<string, number>(),
    labelOrdinal: 0,
    projectOrdinal: 0,
    sectionOrdinalsBySlug: new Map<string, number>(),
  };
}

function nextFallbackSegmentId(
  command: string,
  state: SegmentState,
  args: string[],
  optionalArgs: string[],
) {
  const fallbackParts = [command];

  if (command === "begin" || command === "end") {
    fallbackParts.push(args[0] ?? "block");
  } else if (args.length > 0 && command !== "newcommand" && command !== "renewcommand") {
    fallbackParts.push(args[0] ?? "block");
  } else if (optionalArgs.length > 0) {
    fallbackParts.push(optionalArgs[0] ?? "block");
  }

  const fallbackSlug = slugifySegmentPart(fallbackParts.join(" "));
  const fallbackKey = `${state.currentSectionSlug}:${fallbackSlug}`;
  const ordinal = (state.fallbackOrdinalsBySlug.get(fallbackKey) ?? 0) + 1;
  state.fallbackOrdinalsBySlug.set(fallbackKey, ordinal);

  return `${state.currentSectionSlug}.${fallbackSlug}-${ordinal}`;
}

function extractBraceBlockSlug(blockContent: string) {
  const firstTextbfIndex = blockContent.indexOf("\\textbf");

  if (firstTextbfIndex !== -1) {
    const parsedCommand = readCommandAt(blockContent, firstTextbfIndex);
    const textbfLabel = parsedCommand?.args[0]?.trim();

    if (textbfLabel) {
      return slugifySegmentPart(textbfLabel);
    }
  }

  const firstCommandIndex = blockContent.indexOf("\\");

  if (firstCommandIndex !== -1) {
    const parsedCommand = readCommandAt(blockContent, firstCommandIndex);

    if (parsedCommand) {
      const commandLabel =
        parsedCommand.args[0]?.trim() ??
        parsedCommand.optionalArgs[0]?.trim() ??
        parsedCommand.command;

      if (commandLabel) {
        return slugifySegmentPart(commandLabel);
      }
    }
  }

  const plainText = blockContent
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plainText) {
    return slugifySegmentPart(plainText.slice(0, 60));
  }

  return "block";
}

function nextBraceBlockSegmentId(state: SegmentState, blockContent: string) {
  const blockSlug = extractBraceBlockSlug(blockContent);
  const blockKey = `${state.currentSectionSlug}:block:${blockSlug}`;
  const ordinal = (state.fallbackOrdinalsBySlug.get(blockKey) ?? 0) + 1;
  state.fallbackOrdinalsBySlug.set(blockKey, ordinal);

  return `${state.currentSectionSlug}.block-${blockSlug}-${ordinal}`;
}

function nextSegmentId(
  command: string,
  state: SegmentState,
  args: string[],
  optionalArgs: string[],
) {
  if (command === "resumeSection") {
    const sectionSlug = slugifySegmentPart(args[0] ?? "section");
    const sectionCount = (state.sectionOrdinalsBySlug.get(sectionSlug) ?? 0) + 1;
    state.sectionOrdinalsBySlug.set(sectionSlug, sectionCount);
    state.currentSectionSlug = sectionSlug;
    state.currentSectionOrdinal = sectionCount;
    state.currentEntryOrdinal = 0;
    state.bulletOrdinal = 0;
    state.descOrdinal = 0;
    state.entryOrdinal = 0;
    state.labelOrdinal = 0;
    state.projectOrdinal = 0;

    return `${sectionSlug}.section-${sectionCount}`;
  }

  if (command === "entryheading") {
    state.currentEntryOrdinal += 1;
    state.entryOrdinal = state.currentEntryOrdinal;
    state.bulletOrdinal = 0;
    state.descOrdinal = 0;

    return `${state.currentSectionSlug}.entry-${state.entryOrdinal}.heading`;
  }

  if (command === "projectheading") {
    state.projectOrdinal += 1;
    state.currentEntryOrdinal = state.projectOrdinal;
    state.bulletOrdinal = 0;
    state.descOrdinal = 0;

    return `${state.currentSectionSlug}.project-${state.projectOrdinal}.heading`;
  }

  if (command === "descline") {
    state.descOrdinal += 1;
    const entryOrdinal = Math.max(state.currentEntryOrdinal, 1);

    return `${state.currentSectionSlug}.entry-${entryOrdinal}.desc-${state.descOrdinal}`;
  }

  if (command === "resumeitem") {
    const entryOrdinal = Math.max(state.currentEntryOrdinal, 1);
    state.bulletOrdinal += 1;

    return `${state.currentSectionSlug}.entry-${entryOrdinal}.bullet-${state.bulletOrdinal}`;
  }

  if (command === "labelline") {
    state.labelOrdinal += 1;
    return `${state.currentSectionSlug}.label-${state.labelOrdinal}`;
  }

  return nextFallbackSegmentId(command, state, args, optionalArgs);
}

export function stripTailorResumeSegmentIds(latexCode: string) {
  return stripAnnotatedLine(latexCode);
}

type ParsedSegmentCandidate =
  | {
      kind: "block";
      lineIndentation: string;
      lineStart: number;
      parsedBlock: ParsedBraceBlock;
    }
  | {
      kind: "command";
      lineIndentation: string;
      lineStart: number;
      parsedCommand: ParsedCommand;
    };

function findNextSegmentCandidate(
  value: string,
  fromIndex: number,
): ParsedSegmentCandidate | null {
  const nextLineStart = fromIndex <= 0
    ? 0
    : (() => {
        const lastNewlineBeforeIndex = value.lastIndexOf("\n", fromIndex - 1);
        const candidateLineStart = lastNewlineBeforeIndex + 1;

        if (candidateLineStart >= fromIndex) {
          return candidateLineStart;
        }

        const nextNewline = value.indexOf("\n", fromIndex);
        return nextNewline === -1 ? value.length : nextNewline + 1;
      })();

  let lineStart = nextLineStart;

  while (lineStart < value.length) {
    let cursor = lineStart;

    while (cursor < value.length && /[ \t]/.test(value[cursor] ?? "")) {
      cursor += 1;
    }

    const firstChar = value[cursor];
    const lineIndentation = value.slice(lineStart, cursor);

    if (firstChar === "\\") {
      const parsedCommand = readCommandAt(value, cursor);

      if (parsedCommand) {
        return {
          kind: "command",
          lineIndentation,
          lineStart,
          parsedCommand,
        };
      }
    }

    if (firstChar === "{") {
      const parsedBlock = readTopLevelBraceBlockAt(value, cursor);

      if (parsedBlock) {
        return {
          kind: "block",
          lineIndentation,
          lineStart,
          parsedBlock,
        };
      }
    }

    const nextNewline = value.indexOf("\n", lineStart);

    if (nextNewline === -1) {
      break;
    }

    lineStart = nextNewline + 1;
  }

  return null;
}

export function normalizeTailorResumeLatex(latexCode: string): NormalizeTailorResumeLatexResult {
  const cleanLatex = stripTailorResumeSegmentIds(latexCode);
  const state = createInitialSegmentState();
  const seenSegmentIds = new Set<string>();
  const segments: TailorResumeSegment[] = [];
  const chunks: string[] = [];
  let cursor = 0;
  let candidate = findNextSegmentCandidate(cleanLatex, 0);

  while (candidate) {
    const parsedStart =
      candidate.kind === "command"
        ? candidate.parsedCommand.start
        : candidate.parsedBlock.start;
    const parsedEnd =
      candidate.kind === "command"
        ? candidate.parsedCommand.end
        : candidate.parsedBlock.end;
    const segmentId = buildUniqueTailorResumeSegmentId(
      candidate.kind === "command"
        ? nextSegmentId(
            candidate.parsedCommand.command,
            state,
            candidate.parsedCommand.args,
            candidate.parsedCommand.optionalArgs,
          )
        : nextBraceBlockSegmentId(state, candidate.parsedBlock.content),
      seenSegmentIds,
    );

    chunks.push(
      cleanLatex.slice(
        cursor,
        candidate.lineIndentation ? candidate.lineStart : parsedStart,
      ),
    );
    chunks.push(`${candidate.lineIndentation}${segmentMarkerPrefix}${segmentId}\n`);
    if (candidate.lineIndentation) {
      chunks.push(candidate.lineIndentation);
    }
    chunks.push(cleanLatex.slice(parsedStart, parsedEnd));
    segments.push({
      command: candidate.kind === "command" ? candidate.parsedCommand.command : "block",
      id: segmentId,
    });
    cursor = parsedEnd;
    candidate = findNextSegmentCandidate(cleanLatex, parsedEnd);
  }

  chunks.push(cleanLatex.slice(cursor));

  return {
    annotatedLatex: chunks.join(""),
    segmentCount: segments.length,
    segments,
  };
}

export function readAnnotatedTailorResumeBlocks(annotatedLatexCode: string) {
  const normalized = normalizeTailorResumeLatex(annotatedLatexCode);
  const commandsById = new Map(
    normalized.segments.map((segment) => [segment.id, segment.command]),
  );
  const matches: Array<{
    id: string;
    markerEnd: number;
    markerStart: number;
  }> = [];

  for (const match of normalized.annotatedLatex.matchAll(
    /^[ \t]*% JOBHELPER_SEGMENT_ID:\s*([^\n]+)\s*(?:\n|$)/gm,
  )) {
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

  return matches.map((match, index): TailorResumeAnnotatedBlock => {
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.markerStart ?? normalized.annotatedLatex.length;

    return {
      command: commandsById.get(match.id) ?? null,
      contentEnd,
      contentStart: match.markerEnd,
      id: match.id,
      latexCode: normalized.annotatedLatex
        .slice(match.markerEnd, contentEnd)
        .replace(/\n+$/, ""),
      markerStart: match.markerStart,
    };
  });
}

export function hasValidTailorResumeSegmentIds(latexCode: string) {
  const matches = latexCode.match(/^% JOBHELPER_SEGMENT_ID:[^\n]+$/gm) ?? [];
  const ids = matches.map((match) => match.replace(segmentMarkerPrefix, "").trim());

  return ids.length > 0 && new Set(ids).size === ids.length;
}
