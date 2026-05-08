import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  extractTailorResumeResumeExperiences,
  findTailorResumeResumeExperience,
} from "./tailor-resume-resume-experiences.ts";
import { readAnnotatedTailorResumeBlocks } from "./tailor-resume-segmentation.ts";

export type TailorResumeReplacementTarget = {
  confidence: number;
  currentText: string;
  segmentId: string;
};

function normalizeFuzzyText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[^a-z0-9+#.]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeFuzzyText(value: string) {
  return normalizeFuzzyText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function scoreFuzzyText(left: string, right: string) {
  const normalizedLeft = normalizeFuzzyText(left);
  const normalizedRight = normalizeFuzzyText(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const containsScore =
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
      ? Math.min(normalizedLeft.length, normalizedRight.length) /
        Math.max(normalizedLeft.length, normalizedRight.length)
      : 0;
  const leftTokens = tokenizeFuzzyText(normalizedLeft);
  const rightTokens = tokenizeFuzzyText(normalizedRight);
  const rightTokenSet = new Set(rightTokens);
  const sharedTokenCount = leftTokens.filter((token) =>
    rightTokenSet.has(token),
  ).length;
  const diceScore =
    leftTokens.length + rightTokens.length === 0
      ? 0
      : (2 * sharedTokenCount) / (leftTokens.length + rightTokens.length);

  return Math.max(containsScore * 0.95, diceScore);
}

// Fuzzily finds the current source bullet that a replacement spare bullet targets.
export function findTailorResumeReplacementTarget(input: {
  resumeExperienceId: string;
  sourceAnnotatedLatexCode: string;
  sourceQuote: string;
}): TailorResumeReplacementTarget | null {
  const experiences = extractTailorResumeResumeExperiences(
    input.sourceAnnotatedLatexCode,
  );
  const experience = findTailorResumeResumeExperience(
    experiences,
    input.resumeExperienceId,
  );

  if (!experience) {
    return null;
  }

  const blocksById = new Map(
    readAnnotatedTailorResumeBlocks(input.sourceAnnotatedLatexCode).map(
      (block) => [block.id, block] as const,
    ),
  );
  let bestTarget: TailorResumeReplacementTarget | null = null;

  for (const segmentId of experience.bulletSegmentIds) {
    const block = blocksById.get(segmentId);

    if (!block) {
      continue;
    }

    const currentText = renderTailoredResumeLatexToPlainText(block.latexCode);
    const confidence = scoreFuzzyText(input.sourceQuote, currentText);

    if (!bestTarget || confidence > bestTarget.confidence) {
      bestTarget = {
        confidence,
        currentText,
        segmentId,
      };
    }
  }

  return bestTarget;
}
