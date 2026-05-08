import {
  bestFuzzyTextScore,
  normalizeFuzzySearchText,
  scoreFuzzyText,
} from "./fuzzy-search.ts";
import type { TailorResumeSpareBulletRecord } from "./tailor-resume-types.ts";

export type TailorResumeSpareBulletSearchMode = "body" | "both" | "skills";

export const tailorResumeSpareBulletSearchModes: readonly {
  label: string;
  value: TailorResumeSpareBulletSearchMode;
}[] = [
  { label: "Both", value: "both" },
  { label: "Skills", value: "skills" },
  { label: "Body", value: "body" },
];

function scoreTailorResumeSpareBulletSkills(
  spareBullet: TailorResumeSpareBulletRecord,
  query: string,
) {
  return Math.max(
    bestFuzzyTextScore(
      spareBullet.skills.map((skill) => skill.name),
      query,
    ),
    scoreFuzzyText(
      spareBullet.skills.map((skill) => skill.name).join(" "),
      query,
    ),
  );
}

function splitSearchTokens(value: string) {
  return normalizeFuzzySearchText(value)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreTailorResumeSpareBulletBodyText(
  value: string | null | undefined,
  query: string,
) {
  const normalizedValue = normalizeFuzzySearchText(value);
  const normalizedQuery = normalizeFuzzySearchText(query);

  if (!normalizedQuery) {
    return 1;
  }

  if (!normalizedValue) {
    return -1;
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return scoreFuzzyText(normalizedValue, normalizedQuery);
  }

  const queryTokens = splitSearchTokens(normalizedQuery);
  const valueTokens = splitSearchTokens(normalizedValue);

  if (queryTokens.length === 0 || valueTokens.length === 0) {
    return -1;
  }

  let tokenScore = 0;

  for (const queryToken of queryTokens) {
    const bestTokenScore = bestFuzzyTextScore(valueTokens, queryToken);

    if (bestTokenScore < 0) {
      return -1;
    }

    tokenScore += bestTokenScore;
  }

  return 40 + tokenScore;
}

function scoreTailorResumeSpareBulletBody(
  spareBullet: TailorResumeSpareBulletRecord,
  query: string,
) {
  return Math.max(
    scoreTailorResumeSpareBulletBodyText(spareBullet.quote, query),
    scoreTailorResumeSpareBulletBodyText(spareBullet.replacesQuote, query),
  );
}

export function scoreTailorResumeSpareBulletSearch(input: {
  mode: TailorResumeSpareBulletSearchMode;
  query: string | null | undefined;
  spareBullet: TailorResumeSpareBulletRecord;
}) {
  const normalizedQuery = normalizeFuzzySearchText(input.query);

  if (!normalizedQuery) {
    return 1;
  }

  const skillScore =
    input.mode === "body"
      ? -1
      : scoreTailorResumeSpareBulletSkills(
          input.spareBullet,
          normalizedQuery,
        );
  const bodyScore =
    input.mode === "skills"
      ? -1
      : scoreTailorResumeSpareBulletBody(input.spareBullet, normalizedQuery);

  return Math.max(skillScore, bodyScore);
}

export function filterTailorResumeSpareBulletsForSearch(input: {
  mode: TailorResumeSpareBulletSearchMode;
  query: string | null | undefined;
  spareBullets: readonly TailorResumeSpareBulletRecord[];
}) {
  if (!normalizeFuzzySearchText(input.query)) {
    return [...input.spareBullets];
  }

  return input.spareBullets
    .map((spareBullet, index) => ({
      index,
      score: scoreTailorResumeSpareBulletSearch({
        mode: input.mode,
        query: input.query,
        spareBullet,
      }),
      spareBullet,
    }))
    .filter((item) => item.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.index - right.index,
    )
    .map((item) => item.spareBullet);
}
