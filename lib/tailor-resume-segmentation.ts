const segmentMarkerPrefix = "% JOBHELPER_SEGMENT_ID: ";

type ParsedCommand = {
  args: string[];
  command: string;
  end: number;
  optionalArgs: string[];
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
    cursor = skipWhitespace(value, cursor);
    const currentChar = value[cursor];

    if (currentChar === "[") {
      const group = readBalancedGroup(value, cursor, "[");

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

    const group = readBalancedGroup(value, cursor, "{");

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

export function normalizeTailorResumeLatex(latexCode: string): NormalizeTailorResumeLatexResult {
  const cleanLatex = stripTailorResumeSegmentIds(latexCode);
  const state = createInitialSegmentState();
  const seenSegmentIds = new Set<string>();
  const segments: TailorResumeSegment[] = [];
  const chunks: string[] = [];
  let cursor = 0;
  let searchIndex = 0;

  while (searchIndex < cleanLatex.length) {
    const slashIndex = cleanLatex.indexOf("\\", searchIndex);

    if (slashIndex === -1) {
      break;
    }

    const lineStart = cleanLatex.lastIndexOf("\n", slashIndex - 1) + 1;
    const leadingText = cleanLatex.slice(lineStart, slashIndex);

    if (!/^[ \t]*$/.test(leadingText)) {
      searchIndex = slashIndex + 1;
      continue;
    }

    const parsedCommand = readCommandAt(cleanLatex, slashIndex);

    if (!parsedCommand) {
      searchIndex = slashIndex + 1;
      continue;
    }

    const segmentId = buildUniqueTailorResumeSegmentId(
      nextSegmentId(
        parsedCommand.command,
        state,
        parsedCommand.args,
        parsedCommand.optionalArgs,
      ),
      seenSegmentIds,
    );
    const lineIndentation =
      /^[ \t]*$/.test(leadingText) ? leadingText : "";

    chunks.push(cleanLatex.slice(cursor, lineIndentation ? lineStart : parsedCommand.start));
    chunks.push(`${lineIndentation}${segmentMarkerPrefix}${segmentId}\n`);
    if (lineIndentation) {
      chunks.push(leadingText);
    }
    chunks.push(cleanLatex.slice(parsedCommand.start, parsedCommand.end));
    segments.push({
      command: parsedCommand.command,
      id: segmentId,
    });
    cursor = parsedCommand.end;
    searchIndex = parsedCommand.end;
  }

  chunks.push(cleanLatex.slice(cursor));

  return {
    annotatedLatex: chunks.join(""),
    segmentCount: segments.length,
    segments,
  };
}

export function hasValidTailorResumeSegmentIds(latexCode: string) {
  const matches = latexCode.match(/^% JOBHELPER_SEGMENT_ID:[^\n]+$/gm) ?? [];
  const ids = matches.map((match) => match.replace(segmentMarkerPrefix, "").trim());

  return ids.length > 0 && new Set(ids).size === ids.length;
}
