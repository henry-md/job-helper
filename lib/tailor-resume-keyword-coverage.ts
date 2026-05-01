import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import type {
  TailoredResumeEmphasizedTechnology,
  TailoredResumeKeywordCoverage,
  TailoredResumeKeywordCoverageBucket,
  TailoredResumeKeywordCoverageTerm,
} from "./tailor-resume-types.ts";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMatchText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function buildBoundaryTermRegExp(term: string) {
  const normalizedTerm = normalizeMatchText(term);

  if (!normalizedTerm) {
    return null;
  }

  const escapedTerm = escapeRegExp(normalizedTerm).replace(/\s+/g, "\\s+");

  if (/^[a-z0-9]$/i.test(normalizedTerm)) {
    return new RegExp(`(^|[^a-z0-9+#])${escapedTerm}(?=$|[^a-z0-9+#])`, "i");
  }

  return new RegExp(`(^|[^a-z0-9])${escapedTerm}(?=$|[^a-z0-9])`, "i");
}

export function resumeTextIncludesKeyword(input: {
  text: string;
  term: string;
}) {
  const regexp = buildBoundaryTermRegExp(input.term);

  if (!regexp) {
    return false;
  }

  return regexp.test(normalizeMatchText(input.text));
}

function dedupeTechnologies(
  technologies: TailoredResumeEmphasizedTechnology[],
) {
  const technologiesByName = new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of technologies) {
    const name = technology.name.trim();

    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existingTechnology = technologiesByName.get(key);

    if (
      !existingTechnology ||
      (existingTechnology.priority === "low" && technology.priority === "high")
    ) {
      technologiesByName.set(key, {
        ...technology,
        name,
      });
    }
  }

  return [...technologiesByName.values()];
}

function calculateHitPercentage(hitCount: number, totalTermCount: number) {
  if (totalTermCount <= 0) {
    return 0;
  }

  return Math.round((hitCount / totalTermCount) * 100);
}

function buildCoverageBucket(input: {
  originalText: string;
  tailoredText: string;
  technologies: TailoredResumeEmphasizedTechnology[];
}): TailoredResumeKeywordCoverageBucket {
  const terms = input.technologies.map<TailoredResumeKeywordCoverageTerm>(
    (technology) => {
      const presentInOriginal = resumeTextIncludesKeyword({
        term: technology.name,
        text: input.originalText,
      });
      const presentInTailored = resumeTextIncludesKeyword({
        term: technology.name,
        text: input.tailoredText,
      });

      return {
        name: technology.name,
        presentInOriginal,
        presentInTailored,
        priority: technology.priority,
      };
    },
  );
  const matchedOriginalTerms = terms
    .filter((term) => term.presentInOriginal)
    .map((term) => term.name);
  const matchedTailoredTerms = terms
    .filter((term) => term.presentInTailored)
    .map((term) => term.name);
  const addedTerms = terms
    .filter((term) => !term.presentInOriginal && term.presentInTailored)
    .map((term) => term.name);
  const totalTermCount = terms.length;
  const originalHitCount = matchedOriginalTerms.length;
  const tailoredHitCount = matchedTailoredTerms.length;

  return {
    addedTerms,
    matchedOriginalTerms,
    matchedTailoredTerms,
    originalHitCount,
    originalHitPercentage: calculateHitPercentage(
      originalHitCount,
      totalTermCount,
    ),
    tailoredHitCount,
    tailoredHitPercentage: calculateHitPercentage(
      tailoredHitCount,
      totalTermCount,
    ),
    terms,
    totalTermCount,
  };
}

export function buildTailoredResumeKeywordCoverage(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  originalLatexCode: string;
  tailoredLatexCode: string;
  updatedAt?: string;
}): TailoredResumeKeywordCoverage {
  const technologies = dedupeTechnologies(input.emphasizedTechnologies);
  const highPriorityTechnologies = technologies.filter(
    (technology) => technology.priority === "high",
  );
  const originalText = renderTailoredResumeLatexToPlainText(
    input.originalLatexCode,
  );
  const tailoredText = renderTailoredResumeLatexToPlainText(
    input.tailoredLatexCode,
  );

  return {
    allPriorities: buildCoverageBucket({
      originalText,
      tailoredText,
      technologies,
    }),
    highPriority: buildCoverageBucket({
      originalText,
      tailoredText,
      technologies: highPriorityTechnologies,
    }),
    matcherVersion: 1,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}
