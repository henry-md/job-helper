const wordBoundaryCharacters = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "-",
  "_",
  "/",
  ".",
  ",",
  ":",
  ";",
  "(",
  ")",
  "[",
  "]",
]);

export function normalizeFuzzySearchText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreFuzzyText(
  value: string | null | undefined,
  query: string | null | undefined,
) {
  const normalizedValue = normalizeFuzzySearchText(value);
  const normalizedQuery = normalizeFuzzySearchText(query);

  if (!normalizedQuery) {
    return 1;
  }

  if (!normalizedValue) {
    return -1;
  }

  const directMatchIndex = normalizedValue.indexOf(normalizedQuery);

  if (directMatchIndex >= 0) {
    return (
      100 +
      normalizedQuery.length * 4 +
      (directMatchIndex === 0 ? 20 : 0)
    );
  }

  let score = 0;
  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -2;

  for (
    let valueIndex = 0;
    valueIndex < normalizedValue.length && queryIndex < normalizedQuery.length;
    valueIndex += 1
  ) {
    if (normalizedValue[valueIndex] !== normalizedQuery[queryIndex]) {
      continue;
    }

    const previousCharacter = normalizedValue[valueIndex - 1];
    firstMatchIndex = firstMatchIndex < 0 ? valueIndex : firstMatchIndex;
    score += 1;

    if (
      valueIndex === 0 ||
      (previousCharacter && wordBoundaryCharacters.has(previousCharacter))
    ) {
      score += 2;
    }

    if (valueIndex === previousMatchIndex + 1) {
      score += 2;
    }

    previousMatchIndex = valueIndex;
    queryIndex += 1;
  }

  if (queryIndex !== normalizedQuery.length || firstMatchIndex < 0) {
    return -1;
  }

  const matchSpan = previousMatchIndex - firstMatchIndex + 1;
  const maxFuzzySpan = normalizedQuery.length * 4 + 4;

  if (matchSpan > maxFuzzySpan) {
    return -1;
  }

  return score + Math.max(0, maxFuzzySpan - matchSpan);
}

export function bestFuzzyTextScore(
  values: readonly (string | null | undefined)[],
  query: string | null | undefined,
) {
  return values.reduce(
    (bestScore, value) => Math.max(bestScore, scoreFuzzyText(value, query)),
    -1,
  );
}
