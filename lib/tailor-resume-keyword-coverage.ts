import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import type {
  TailorResumeKeywordCheckResult,
  TailorResumeKeywordCheckTerm,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeEmphasizedTechnologyPriority,
  TailoredResumeKeywordCoverage,
  TailoredResumeKeywordCoverageBucket,
  TailoredResumeKeywordCoverageTerm,
} from "./tailor-resume-types.ts";

export type TailorResumeKeywordPresenceContextTerm = {
  evidence: string;
  name: string;
  presentInOriginalResume: boolean;
  presentInUserMarkdown: boolean;
  priority: TailoredResumeEmphasizedTechnologyPriority;
};

export type TailorResumeKeywordPresenceContext = {
  highPriorityMissingFromOriginalResumeAndUserMarkdown: string[];
  lowPriorityMissingFromOriginalResumeAndUserMarkdown: string[];
  terms: TailorResumeKeywordPresenceContextTerm[];
};

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

export function buildTailorResumeKeywordPresenceContext(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  originalResumeText: string;
  userMarkdown: string;
}): TailorResumeKeywordPresenceContext {
  const terms = dedupeTechnologies(input.emphasizedTechnologies).map(
    (technology) => {
      const presentInOriginalResume = resumeTextIncludesKeyword({
        term: technology.name,
        text: input.originalResumeText,
      });
      const presentInUserMarkdown = resumeTextIncludesKeyword({
        term: technology.name,
        text: input.userMarkdown,
      });

      return {
        evidence: technology.evidence,
        name: technology.name,
        presentInOriginalResume,
        presentInUserMarkdown,
        priority: technology.priority,
      } satisfies TailorResumeKeywordPresenceContextTerm;
    },
  );

  const missingFromOriginalResumeAndUserMarkdown = terms.filter(
    (term) => !term.presentInOriginalResume && !term.presentInUserMarkdown,
  );

  return {
    highPriorityMissingFromOriginalResumeAndUserMarkdown:
      missingFromOriginalResumeAndUserMarkdown
        .filter((term) => term.priority === "high")
        .map((term) => term.name),
    lowPriorityMissingFromOriginalResumeAndUserMarkdown:
      missingFromOriginalResumeAndUserMarkdown
        .filter((term) => term.priority === "low")
        .map((term) => term.name),
    terms,
  };
}

export function buildTailorResumeKeywordCheckResult(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  text: string;
}): TailorResumeKeywordCheckResult {
  const technologies = dedupeTechnologies(input.emphasizedTechnologies);
  const terms = technologies.map<TailorResumeKeywordCheckTerm>((technology) => ({
    name: technology.name,
    present: resumeTextIncludesKeyword({
      term: technology.name,
      text: input.text,
    }),
    priority: technology.priority,
  }));

  return {
    missingHighPriority: terms
      .filter((term) => term.priority === "high" && !term.present)
      .map((term) => term.name),
    missingLowPriority: terms
      .filter((term) => term.priority === "low" && !term.present)
      .map((term) => term.name),
    presentHighPriority: terms
      .filter((term) => term.priority === "high" && term.present)
      .map((term) => term.name),
    presentLowPriority: terms
      .filter((term) => term.priority === "low" && term.present)
      .map((term) => term.name),
    terms,
  };
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
