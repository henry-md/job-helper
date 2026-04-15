import {
  buildTailorResumeLinkKey,
  normalizeTailorResumeLinkLabel,
} from "./tailor-resume-links.ts";
import type { TailorResumeLinkRecord } from "./tailor-resume-types.ts";

function isEscaped(value: string, index: number) {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function readBalancedGroup(value: string, openBraceIndex: number) {
  if (value[openBraceIndex] !== "{") {
    return null;
  }

  let depth = 0;

  for (let index = openBraceIndex; index < value.length; index += 1) {
    const current = value[index];

    if (current === "{" && !isEscaped(value, index)) {
      depth += 1;
      continue;
    }

    if (current === "}" && !isEscaped(value, index)) {
      depth -= 1;

      if (depth === 0) {
        return {
          nextIndex: index + 1,
          value: value.slice(openBraceIndex + 1, index),
        };
      }
    }
  }

  return null;
}

function skipWhitespace(value: string, startIndex: number) {
  let index = startIndex;

  while (index < value.length && /\s/.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
}

function simplifyLatexText(value: string): string {
  let index = 0;
  let result = "";

  while (index < value.length) {
    const current = value[index];

    if (current === "\\") {
      const escapedSymbol = value[index + 1];

      if (escapedSymbol && "{}%$&#_~".includes(escapedSymbol)) {
        result += escapedSymbol === "~" ? " " : escapedSymbol;
        index += 2;
        continue;
      }

      if (escapedSymbol === "\\") {
        result += " ";
        index += 2;
        continue;
      }

      const commandMatch = value.slice(index + 1).match(/^[a-zA-Z]+/);

      if (!commandMatch) {
        index += 1;
        continue;
      }

      const command = commandMatch[0];
      index += command.length + 1;
      index = skipWhitespace(value, index);

      if (value[index] === "{") {
        const group = readBalancedGroup(value, index);

        if (!group) {
          continue;
        }

        result += simplifyLatexText(group.value);
        index = group.nextIndex;
        continue;
      }

      continue;
    }

    if (current === "{") {
      const group = readBalancedGroup(value, index);

      if (!group) {
        index += 1;
        continue;
      }

      result += simplifyLatexText(group.value);
      index = group.nextIndex;
      continue;
    }

    if (current === "}" || current === "%") {
      index += 1;
      continue;
    }

    if (current === "~") {
      result += " ";
      index += 1;
      continue;
    }

    result += current;
    index += 1;
  }

  return result.replace(/\s+/g, " ").trim();
}

function stripLinkStyling(value: string): string {
  let index = 0;
  let result = "";

  while (index < value.length) {
    if (value[index] !== "\\") {
      result += value[index];
      index += 1;
      continue;
    }

    const commandMatch = value.slice(index + 1).match(/^[a-zA-Z]+/);

    if (!commandMatch) {
      result += value[index];
      index += 1;
      continue;
    }

    const command = commandMatch[0];
    const commandEndIndex = index + command.length + 1;
    const nextIndex = skipWhitespace(value, commandEndIndex);

    if (value[nextIndex] !== "{") {
      result += value.slice(index, commandEndIndex);
      index = commandEndIndex;
      continue;
    }

    const group = readBalancedGroup(value, nextIndex);

    if (!group) {
      result += value.slice(index, commandEndIndex);
      index = commandEndIndex;
      continue;
    }

    if (command === "tightul") {
      result += stripLinkStyling(group.value);
      index = group.nextIndex;
      continue;
    }

    result += `${value.slice(index, commandEndIndex)}{${stripLinkStyling(group.value)}}`;
    index = group.nextIndex;
  }

  return result;
}

function escapeLatexSearchText(value: string) {
  return value.replace(/[\\{}%$&#_~]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\textbackslash{}";
      case "{":
        return "\\{";
      case "}":
        return "\\}";
      case "%":
        return "\\%";
      case "$":
        return "\\$";
      case "&":
        return "\\&";
      case "#":
        return "\\#";
      case "_":
        return "\\_";
      case "~":
        return "\\~{}";
      default:
        return character;
    }
  });
}

function readLinkOccurrence(
  label: string,
  occurrencesByLabel: Map<string, number>,
) {
  const normalizedLabel = normalizeTailorResumeLinkLabel(label);

  if (!normalizedLabel) {
    return null;
  }

  const occurrenceCount = (occurrencesByLabel.get(normalizedLabel) ?? 0) + 1;
  occurrencesByLabel.set(normalizedLabel, occurrenceCount);

  return {
    key: buildTailorResumeLinkKey(normalizedLabel, occurrenceCount),
    normalizedLabel,
    occurrenceCount,
  };
}

function buildLabelPatterns(links: TailorResumeLinkRecord[]) {
  const labelPatterns = new Map<string, string[]>();

  for (const link of links) {
    const normalizedLabel = normalizeTailorResumeLinkLabel(link.label);

    if (!normalizedLabel || labelPatterns.has(normalizedLabel)) {
      continue;
    }

    const patterns = [normalizedLabel];
    const escapedLabel = escapeLatexSearchText(normalizedLabel);

    if (escapedLabel !== normalizedLabel) {
      patterns.push(escapedLabel);
    }

    labelPatterns.set(normalizedLabel, patterns);
  }

  return [...labelPatterns.entries()];
}

function findNextPlainTextLabelMatch(
  value: string,
  startIndex: number,
  labelPatterns: Array<[string, string[]]>,
) {
  let nextMatch:
    | {
        label: string;
        pattern: string;
        startIndex: number;
      }
    | null = null;

  for (const [label, patterns] of labelPatterns) {
    for (const pattern of patterns) {
      const matchIndex = value.indexOf(pattern, startIndex);

      if (matchIndex === -1) {
        continue;
      }

      if (
        !nextMatch ||
        matchIndex < nextMatch.startIndex ||
        (matchIndex === nextMatch.startIndex &&
          pattern.length > nextMatch.pattern.length)
      ) {
        nextMatch = {
          label,
          pattern,
          startIndex: matchIndex,
        };
      }
    }
  }

  return nextMatch;
}

function applyPlainTextLinkOverrides(
  value: string,
  linksByKey: Map<string, TailorResumeLinkRecord>,
  labelPatterns: Array<[string, string[]]>,
  occurrencesByLabel: Map<string, number>,
) {
  if (labelPatterns.length === 0 || !value) {
    return value;
  }

  let result = "";
  let index = 0;

  while (index < value.length) {
    const nextMatch = findNextPlainTextLabelMatch(value, index, labelPatterns);

    if (!nextMatch) {
      result += value.slice(index);
      break;
    }

    result += value.slice(index, nextMatch.startIndex);

    const occurrence = readLinkOccurrence(nextMatch.label, occurrencesByLabel);
    const link = occurrence ? linksByKey.get(occurrence.key) : null;
    const matchEndIndex = nextMatch.startIndex + nextMatch.pattern.length;
    const matchedText = value.slice(nextMatch.startIndex, matchEndIndex);

    if (link && !link.disabled && link.url) {
      result += `\\href{${link.url}}{\\tightul{${matchedText}}}`;
    } else {
      result += matchedText;
    }

    index = matchEndIndex;
  }

  return result;
}

export function applyTailorResumeLinkOverrides(
  latexCode: string,
  links: TailorResumeLinkRecord[],
) {
  const linksByKey = new Map(links.map((link) => [link.key, link]));
  const labelPatterns = buildLabelPatterns(links);

  if (linksByKey.size === 0) {
    return latexCode;
  }

  let result = "";
  let index = 0;
  const occurrencesByLabel = new Map<string, number>();

  while (index < latexCode.length) {
    const hrefIndex = latexCode.indexOf("\\href", index);

    if (hrefIndex === -1) {
      result += applyPlainTextLinkOverrides(
        latexCode.slice(index),
        linksByKey,
        labelPatterns,
        occurrencesByLabel,
      );
      break;
    }

    result += applyPlainTextLinkOverrides(
      latexCode.slice(index, hrefIndex),
      linksByKey,
      labelPatterns,
      occurrencesByLabel,
    );

    let cursor = hrefIndex + "\\href".length;
    cursor = skipWhitespace(latexCode, cursor);

    const urlGroup = readBalancedGroup(latexCode, cursor);

    if (!urlGroup) {
      result += "\\href";
      index = hrefIndex + "\\href".length;
      continue;
    }

    cursor = skipWhitespace(latexCode, urlGroup.nextIndex);
    const textGroup = readBalancedGroup(latexCode, cursor);

    if (!textGroup) {
      result += latexCode.slice(hrefIndex, urlGroup.nextIndex);
      index = urlGroup.nextIndex;
      continue;
    }

    const occurrence = readLinkOccurrence(
      simplifyLatexText(textGroup.value),
      occurrencesByLabel,
    );
    const linkKey = occurrence?.key ?? null;
    const link = linkKey ? linksByKey.get(linkKey) : null;

    if (link?.disabled || link?.url === null) {
      result += stripLinkStyling(textGroup.value);
    } else if (link?.url) {
      result += `\\href{${link.url}}{${textGroup.value}}`;
    } else {
      result += latexCode.slice(hrefIndex, textGroup.nextIndex);
    }

    index = textGroup.nextIndex;
  }

  return result;
}

export function stripDisabledTailorResumeLinks(
  latexCode: string,
  links: TailorResumeLinkRecord[],
) {
  return applyTailorResumeLinkOverrides(
    latexCode,
    links.filter((link) => link.disabled),
  );
}
