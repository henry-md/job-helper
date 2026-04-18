import type { TailoredResumeRecord } from "@/lib/tailor-resume-types";

const DEFAULT_MAX_SIDEBAR_NAME_LENGTH = 44;

const INITIALISM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const ROLE_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bSoftware Development Engineer\b/gi, "SDE"],
  [/\bSoftware Engineer\b/gi, "SWE"],
  [/\bProduct Manager\b/gi, "PM"],
  [/\bProject Manager\b/gi, "Proj. Mgr."],
  [/\bProgram Manager\b/gi, "Prog. Mgr."],
];

const ROLE_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bSenior\b/gi, "Sr."],
  [/\bJunior\b/gi, "Jr."],
  [/\bPrincipal\b/gi, "Prin."],
  [/\bEngineer\b/gi, "Eng."],
  [/\bEngineering\b/gi, "Eng."],
  [/\bDeveloper\b/gi, "Dev."],
  [/\bManager\b/gi, "Mgr."],
  [/\bSpecialist\b/gi, "Spec."],
  [/\bAssociate\b/gi, "Assoc."],
  [/\bRepresentative\b/gi, "Rep."],
  [/\bCoordinator\b/gi, "Coord."],
  [/\bOperations\b/gi, "Ops"],
];

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildDisplayName(companyName: string, positionTitle: string) {
  if (companyName && positionTitle) {
    return `${companyName} - ${positionTitle}`;
  }

  return companyName || positionTitle || "Tailored Resume";
}

function abbreviateParentheticalContent(value: string) {
  return value.replace(/\(([^()]+)\)/g, (match, rawContent: string) => {
    const words = rawContent
      .split(/\s+/)
      .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
      .filter(Boolean);

    if (words.length < 2 || rawContent.trim().length <= 12) {
      return match;
    }

    const significantWords = words.filter(
      (word) => !INITIALISM_STOP_WORDS.has(word.toLowerCase()),
    );
    const initialismSource = significantWords.length > 0 ? significantWords : words;
    const initialism = initialismSource
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");

    return initialism.length >= 2 ? `(${initialism})` : match;
  });
}

function abbreviatePositionTitle(value: string) {
  let nextValue = abbreviateParentheticalContent(value);

  for (const [pattern, replacement] of ROLE_PHRASE_REPLACEMENTS) {
    nextValue = nextValue.replace(pattern, replacement);
  }

  for (const [pattern, replacement] of ROLE_WORD_REPLACEMENTS) {
    nextValue = nextValue.replace(pattern, replacement);
  }

  return collapseWhitespace(nextValue);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return ".".repeat(Math.max(0, maxLength));
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildCandidateList(companyName: string, positionTitle: string) {
  const candidates = [
    buildDisplayName(companyName, positionTitle),
    buildDisplayName(companyName, abbreviateParentheticalContent(positionTitle)),
    buildDisplayName(companyName, abbreviatePositionTitle(positionTitle)),
    positionTitle,
    abbreviateParentheticalContent(positionTitle),
    abbreviatePositionTitle(positionTitle),
  ];

  return candidates.filter((candidate, index) => {
    if (!candidate) {
      return false;
    }

    return candidates.indexOf(candidate) === index;
  });
}

export function formatTailoredResumeSidebarName(
  record: Pick<
    TailoredResumeRecord,
    "companyName" | "displayName" | "positionTitle"
  >,
  options?: {
    maxLength?: number;
  },
) {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_SIDEBAR_NAME_LENGTH;
  const companyName = collapseWhitespace(record.companyName);
  const positionTitle = collapseWhitespace(record.positionTitle);
  const displayName = collapseWhitespace(record.displayName);

  if (displayName && displayName.length <= maxLength) {
    return displayName;
  }

  if (positionTitle) {
    const candidates = buildCandidateList(companyName, positionTitle);
    const fittingCandidate = candidates.find((candidate) => candidate.length <= maxLength);

    if (fittingCandidate) {
      return fittingCandidate;
    }

    const mostCompactCandidate =
      candidates[candidates.length - 1] ??
      buildDisplayName(companyName, positionTitle) ??
      displayName;

    return truncateText(mostCompactCandidate, maxLength);
  }

  return truncateText(displayName || companyName || "Tailored Resume", maxLength);
}
