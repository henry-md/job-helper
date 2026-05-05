export const maxTailorResumeNonTechnologyTermLength = 120;
export const maxTailorResumeNonTechnologyTermCount = 200;

export function normalizeTailorResumeNonTechnologyTerm(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatTailorResumeTermWithCapitalFirst(value: string) {
  const term = value.trim().replace(/\s+/g, " ");

  if (!term) {
    return "";
  }

  return `${term.slice(0, 1).toUpperCase()}${term.slice(1)}`;
}

export function formatTailorResumeNonTechnologyTerm(value: string) {
  const normalizedTerm = normalizeTailorResumeNonTechnologyTerm(value);

  if (!normalizedTerm) {
    return "";
  }

  return formatTailorResumeTermWithCapitalFirst(normalizedTerm);
}

export function normalizeTailorResumeNonTechnologyTerms(
  values: readonly string[] | null | undefined,
) {
  const seenTerms = new Set<string>();
  const normalizedTerms: string[] = [];

  for (const value of values ?? []) {
    const normalizedTerm = normalizeTailorResumeNonTechnologyTerm(value);

    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }

    if (normalizedTerm.length > maxTailorResumeNonTechnologyTermLength) {
      throw new Error(
        `Keep non-technology terms under ${maxTailorResumeNonTechnologyTermLength.toLocaleString()} characters each.`,
      );
    }

    seenTerms.add(normalizedTerm);
    normalizedTerms.push(normalizedTerm);
  }

  if (normalizedTerms.length > maxTailorResumeNonTechnologyTermCount) {
    throw new Error(
      `Keep the non-technology list under ${maxTailorResumeNonTechnologyTermCount.toLocaleString()} terms.`,
    );
  }

  return normalizedTerms;
}

export function mergeTailorResumeNonTechnologyTerms(
  currentTerms: readonly string[] | null | undefined,
  addedTerms: readonly string[] | null | undefined,
) {
  return normalizeTailorResumeNonTechnologyTerms([
    ...(currentTerms ?? []),
    ...(addedTerms ?? []),
  ]);
}

export function isTailorResumeNonTechnologyTerm(
  term: string,
  nonTechnologies: readonly string[] | null | undefined,
) {
  const normalizedTerm = normalizeTailorResumeNonTechnologyTerm(term);

  if (!normalizedTerm) {
    return false;
  }

  return new Set(
    (nonTechnologies ?? []).map(normalizeTailorResumeNonTechnologyTerm),
  ).has(normalizedTerm);
}

export function filterTailorResumeNonTechnologiesFromEmphasizedTechnologies<
  Technology extends { name: string },
>(
  technologies: readonly Technology[],
  nonTechnologies: readonly string[] | null | undefined,
) {
  const nonTechnologyTerms = new Set(
    (nonTechnologies ?? []).map(normalizeTailorResumeNonTechnologyTerm),
  );

  if (nonTechnologyTerms.size === 0) {
    return [...technologies];
  }

  return technologies.filter(
    (technology) =>
      !nonTechnologyTerms.has(
        normalizeTailorResumeNonTechnologyTerm(technology.name),
      ),
  );
}
