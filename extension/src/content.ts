import {
  buildTailorResumePreparationMessage,
  isJobHelperAppUrl,
  type JobPageContext,
  type JobPostingStructuredHint,
} from "./job-helper";
import {
  deriveKeywordBadgeDismissalKey as computeKeywordBadgeDismissalKey,
  KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
  readDismissedKeywordBadgeMap,
} from "./keyword-badge-dismissal";

type OverlayTone = "error" | "info" | "success" | "warning";

type TailoredResumeBadgePayload = {
  badgeKey?: string;
  companyName?: string | null;
  downloadName?: string;
  displayName?: string;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnologyPayload[];
  includeLowPriorityTermsInKeywordCoverage?: boolean;
  jobUrl?: string;
  keywordCoverage?: TailoredResumeKeywordCoveragePayload | null;
  nonTechnologies?: string[];
  nonTechnologyNames?: string[];
  tailoredResumeId?: string;
};

type KeywordClassificationKind =
  | "narrative"
  | "non_skill"
  | "skills_section";

type TailoredResumeEmphasizedTechnologyPayload = {
  classification?: KeywordClassificationKind;
  evidence?: string;
  name?: string;
  priority?: "high" | "low";
};

type TailoredResumeKeywordCoverageTermPayload = {
  name?: string;
  presentInOriginal?: boolean;
  presentInTailored?: boolean;
  priority?: "high" | "low";
};

type TailoredResumeKeywordCoverageBucketPayload = {
  addedTerms?: string[];
  matchedOriginalTerms?: string[];
  matchedTailoredTerms?: string[];
  originalHitCount?: number;
  originalHitPercentage?: number;
  tailoredHitCount?: number;
  tailoredHitPercentage?: number;
  terms?: TailoredResumeKeywordCoverageTermPayload[];
  totalTermCount?: number;
};

type TailoredResumeKeywordCoveragePayload = {
  allPriorities?: TailoredResumeKeywordCoverageBucketPayload | null;
  highPriority?: TailoredResumeKeywordCoverageBucketPayload | null;
  matcherVersion?: number;
  updatedAt?: string;
};

type NormalizedKeywordCoverageTerm =
  Required<TailoredResumeKeywordCoverageTermPayload>;

type NormalizedKeywordCoverageBucket = {
  addedTerms: string[];
  missingTerms: string[];
  originalHitCount: number;
  sharedTerms: string[];
  tailoredHitCount: number;
  terms: NormalizedKeywordCoverageTerm[];
  totalTermCount: number;
};

type KeywordCoverageTone = "missing" | "new" | "original";

type KeywordClassificationOverride = {
  kind: KeywordClassificationKind;
  priority: "high" | "low" | null;
};

function normalizeKeywordClassificationKind(
  value: unknown,
): KeywordClassificationKind | null {
  if (value === "skills_section" || value === "hard") {
    return "skills_section";
  }

  if (value === "narrative" || value === "soft") {
    return "narrative";
  }

  if (value === "non_skill") {
    return "non_skill";
  }

  return null;
}

const emphasizedTechnologyBadgeRootId =
  "job-helper-emphasized-technologies-badge";
const pagePromptStyleId = "job-helper-page-prompt-styles";
const pagePromptEdgeInset = 16;
const pagePromptGap = 12;
const pagePromptWidth = "min(420px, calc(100vw - 32px))";
let overlayTimeoutId: number | null = null;
let lastShortcutAt = 0;
const dismissedKeywordBadgeKeys = new Set<string>();
let keywordClassificationSaveQueue: Promise<unknown> = Promise.resolve();
const keywordClassificationOverridesByScope = new Map<
  string,
  Map<string, KeywordClassificationOverride>
>();
let lastShownKeywordBadgePayload: {
  badgeKey: string;
  payload: TailoredResumeBadgePayload;
} | null = null;

void chrome.storage.local
  .get(KEYWORD_BADGE_DISMISSAL_STORAGE_KEY)
  .then((result) => {
    const initial = readDismissedKeywordBadgeMap(
      result?.[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY],
    );
    for (const key of initial) {
      dismissedKeywordBadgeKeys.add(key);
    }

    if (lastShownKeywordBadgePayload) {
      reapplyKeywordBadgeDismissalState();
    }
  })
  .catch(() => undefined);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const change = changes[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY];
  if (!change) {
    return;
  }

  dismissedKeywordBadgeKeys.clear();
  for (const key of readDismissedKeywordBadgeMap(change.newValue)) {
    dismissedKeywordBadgeKeys.add(key);
  }

  reapplyKeywordBadgeDismissalState();
});

function reapplyKeywordBadgeDismissalState() {
  if (!lastShownKeywordBadgePayload) {
    return;
  }

  const { badgeKey, payload } = lastShownKeywordBadgePayload;
  const dismissalKey = resolveKeywordBadgeDismissalKey(payload, badgeKey);

  if (dismissedKeywordBadgeKeys.has(dismissalKey)) {
    hideEmphasizedTechnologyBadge();
    return;
  }

  if (!document.getElementById(emphasizedTechnologyBadgeRootId)) {
    showEmphasizedTechnologyBadge(payload, badgeKey);
  }
}

function resolveKeywordBadgeDismissalKey(
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
) {
  return (
    computeKeywordBadgeDismissalKey({
      badgeKey,
      jobUrl: payload.jobUrl ?? null,
      tailoredResumeId: payload.tailoredResumeId ?? null,
    }) ?? `badge:${badgeKey}`
  );
}

function rememberKeywordClassificationOverride(input: {
  badgeKey: string;
  kind: KeywordClassificationKind;
  name: string;
  payload: TailoredResumeBadgePayload;
  priority?: "high" | "low" | null;
}) {
  const scope = resolveKeywordBadgeDismissalKey(input.payload, input.badgeKey);
  const normalizedName = normalizeNonTechnologyTerm(input.name);

  if (!scope || !normalizedName) {
    return;
  }

  const scopeOverrides =
    keywordClassificationOverridesByScope.get(scope) ?? new Map();
  scopeOverrides.set(normalizedName, {
    kind: input.kind,
    priority:
      input.kind === "non_skill" || !input.priority ? null : input.priority,
  });
  keywordClassificationOverridesByScope.set(scope, scopeOverrides);
}

function applyKeywordClassificationOverrides(
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
) {
  const scope = resolveKeywordBadgeDismissalKey(payload, badgeKey);
  const scopeOverrides = keywordClassificationOverridesByScope.get(scope);

  if (!scopeOverrides || scopeOverrides.size === 0) {
    return;
  }

  payload.emphasizedTechnologies = (payload.emphasizedTechnologies ?? []).map(
    (technology) => {
      const override = scopeOverrides.get(
        normalizeNonTechnologyTerm(technology.name),
      );

      if (!override) {
        return technology;
      }

      return {
        ...technology,
        classification: override.kind,
        priority:
          override.kind === "non_skill" || !override.priority
            ? technology.priority
            : override.priority,
      };
    },
  );
}

async function rememberDismissedKeywordBadgeKey(dismissalKey: string) {
  dismissedKeywordBadgeKeys.add(dismissalKey);

  try {
    const current = await chrome.storage.local.get(
      KEYWORD_BADGE_DISMISSAL_STORAGE_KEY,
    );
    const existing =
      (current?.[KEYWORD_BADGE_DISMISSAL_STORAGE_KEY] as
        | Record<string, boolean>
        | undefined) ?? {};
    await chrome.storage.local.set({
      [KEYWORD_BADGE_DISMISSAL_STORAGE_KEY]: {
        ...existing,
        [dismissalKey]: true,
      },
    });
  } catch {
    // Dismissal still works in-memory for this session even if storage fails.
  }
}

function enqueueKeywordClassificationSave(payload: {
  kind: KeywordClassificationKind;
  name: string;
  priority: "high" | "low" | null;
}) {
  keywordClassificationSaveQueue = keywordClassificationSaveQueue
    .catch(() => undefined)
    .then(() =>
      chrome.runtime.sendMessage({
        payload,
        type: "JOB_HELPER_SAVE_KEYWORD_CLASSIFICATION",
      }),
    )
    .then((response) => {
      const result =
        typeof response === "object" && response !== null
          ? (response as { error?: string; ok?: boolean })
          : null;

      if (result && result.ok === false) {
        throw new Error(result.error || "Could not save keyword classification.");
      }

      return response;
    })
    .catch((error) => {
      console.warn(
        "Job Helper could not save the keyword classification.",
        error,
      );
    });

  return keywordClassificationSaveQueue;
}

function cleanText(value: string | null | undefined, maxLength = 0) {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();

  if (!collapsed) {
    return "";
  }

  if (maxLength > 0 && collapsed.length > maxLength) {
    return `${collapsed.slice(0, maxLength)}…`;
  }

  return collapsed;
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = cleanText(value);

    if (!normalizedValue) {
      continue;
    }

    const dedupeKey = normalizedValue.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalizedValue);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function normalizeNonTechnologyTerm(value: string | null | undefined) {
  return cleanText(value).toLowerCase();
}

function readNonTechnologyTermSet(payload: TailoredResumeBadgePayload) {
  const terms = [
    ...(Array.isArray(payload.nonTechnologyNames)
      ? payload.nonTechnologyNames
      : []),
    ...(Array.isArray(payload.nonTechnologies) ? payload.nonTechnologies : []),
  ];

  return new Set(
    terms
      .map((term) => normalizeNonTechnologyTerm(term))
      .filter((term) => term.length > 0),
  );
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(Math.round(value), 0)
    : 0;
}

function normalizeCoverageTermNames(value: unknown) {
  return uniqueStrings(
    Array.isArray(value)
      ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
      : [],
    Number.POSITIVE_INFINITY,
  );
}

function normalizeKeywordCoverageTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as NormalizedKeywordCoverageTerm[];
  }

  const terms: NormalizedKeywordCoverageTerm[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const term = item as TailoredResumeKeywordCoverageTermPayload;
    const name = cleanText(term.name, 80);
    const priority =
      term.priority === "high" ? "high" : term.priority === "low" ? "low" : null;

    if (!name || !priority) {
      continue;
    }

    const key = `${priority}:${name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push({
      name,
      presentInOriginal: term.presentInOriginal === true,
      presentInTailored: term.presentInTailored === true,
      priority,
    });
  }

  return terms;
}

function intersectCoverageTermNames(left: string[], right: string[]) {
  const rightTerms = new Set(right.map((term) => term.toLowerCase()));

  return left.filter((term) => rightTerms.has(term.toLowerCase()));
}

function normalizeKeywordCoverageBucket(
  value: TailoredResumeKeywordCoverageBucketPayload | null | undefined,
) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const totalTermCount = readNonNegativeInteger(value.totalTermCount);
  const terms = normalizeKeywordCoverageTerms(value.terms);
  const matchedOriginalTerms = normalizeCoverageTermNames(
    value.matchedOriginalTerms,
  );
  const matchedTailoredTerms = normalizeCoverageTermNames(
    value.matchedTailoredTerms,
  );

  if (totalTermCount <= 0) {
    return null;
  }

  const addedTerms =
    terms.length > 0
      ? uniqueStrings(
          terms
            .filter((term) => !term.presentInOriginal && term.presentInTailored)
            .map((term) => term.name),
          Number.POSITIVE_INFINITY,
        )
      : normalizeCoverageTermNames(value.addedTerms);
  const sharedTerms =
    terms.length > 0
      ? uniqueStrings(
          terms
            .filter((term) => term.presentInOriginal && term.presentInTailored)
            .map((term) => term.name),
          Number.POSITIVE_INFINITY,
        )
      : intersectCoverageTermNames(matchedOriginalTerms, matchedTailoredTerms);
  const missingTerms =
    terms.length > 0
      ? uniqueStrings(
          terms
            .filter((term) => !term.presentInTailored)
            .map((term) => term.name),
          Number.POSITIVE_INFINITY,
        )
      : [];

  return {
    addedTerms,
    missingTerms,
    originalHitCount: Math.min(
      readNonNegativeInteger(value.originalHitCount),
      totalTermCount,
    ),
    sharedTerms,
    tailoredHitCount: Math.min(
      readNonNegativeInteger(value.tailoredHitCount),
      totalTermCount,
    ),
    terms,
    totalTermCount,
  };
}

function buildKeywordCoverageBucketFromTerms(
  terms: NormalizedKeywordCoverageTerm[],
): NormalizedKeywordCoverageBucket | null {
  if (terms.length === 0) {
    return null;
  }

  return {
    addedTerms: uniqueStrings(
      terms
        .filter((term) => !term.presentInOriginal && term.presentInTailored)
        .map((term) => term.name),
      Number.POSITIVE_INFINITY,
    ),
    missingTerms: uniqueStrings(
      terms
        .filter((term) => !term.presentInTailored)
        .map((term) => term.name),
      Number.POSITIVE_INFINITY,
    ),
    originalHitCount: terms.filter((term) => term.presentInOriginal).length,
    sharedTerms: uniqueStrings(
      terms
        .filter((term) => term.presentInOriginal && term.presentInTailored)
        .map((term) => term.name),
      Number.POSITIVE_INFINITY,
    ),
    tailoredHitCount: terms.filter((term) => term.presentInTailored).length,
    terms,
    totalTermCount: terms.length,
  };
}

function readKeywordCoverageBuckets(payload: TailoredResumeBadgePayload) {
  const coverage = payload.keywordCoverage;

  if (!coverage || typeof coverage !== "object") {
    return null;
  }

  const nonTechnologyTerms = readNonTechnologyTermSet(payload);
  const rawAllPriorities = normalizeKeywordCoverageBucket(coverage.allPriorities);
  const rawHighPriority = normalizeKeywordCoverageBucket(coverage.highPriority);
  const allPriorities =
    nonTechnologyTerms.size === 0
      ? rawAllPriorities
      : buildKeywordCoverageBucketFromTerms(
          rawAllPriorities?.terms.filter(
            (term) =>
              !nonTechnologyTerms.has(normalizeNonTechnologyTerm(term.name)),
          ) ?? [],
        );
  const highPriority =
    nonTechnologyTerms.size === 0
      ? rawHighPriority
      : buildKeywordCoverageBucketFromTerms(
          rawHighPriority?.terms.filter(
            (term) =>
              !nonTechnologyTerms.has(normalizeNonTechnologyTerm(term.name)),
          ) ?? [],
        );
  const displayAllPriorities = allPriorities ?? highPriority;
  const lowPriority = displayAllPriorities
    ? buildKeywordCoverageBucketFromTerms(
        displayAllPriorities.terms.filter((term) => term.priority === "low"),
      )
    : null;
  const summary = payload.includeLowPriorityTermsInKeywordCoverage
    ? displayAllPriorities
    : highPriority;

  if (!summary || !highPriority || !displayAllPriorities) {
    return null;
  }

  return {
    allPriorities: displayAllPriorities,
    highPriority,
    lowPriority,
    summary,
  };
}

function resolveKeywordCoverageTone(
  term: NormalizedKeywordCoverageTerm,
): KeywordCoverageTone {
  if (term.presentInOriginal) {
    return "original";
  }

  return term.presentInTailored ? "new" : "missing";
}

function buildKeywordCoverageToneMap(bucket: NormalizedKeywordCoverageBucket) {
  const tones = new Map<string, KeywordCoverageTone>();

  for (const term of bucket.terms) {
    const normalizedName = normalizeNonTechnologyTerm(term.name);

    if (!normalizedName) {
      continue;
    }

    const tone = resolveKeywordCoverageTone(term);
    tones.set(`${term.priority}:${normalizedName}`, tone);

    if (!tones.has(normalizedName)) {
      tones.set(normalizedName, tone);
    }
  }

  return tones;
}

function countKeywordCoverageTones(bucket: NormalizedKeywordCoverageBucket) {
  const counts = {
    missing: 0,
    new: 0,
    original: 0,
  };

  for (const term of bucket.terms) {
    counts[resolveKeywordCoverageTone(term)] += 1;
  }

  return counts;
}

function readTechnologyKeywordCoverageTone(
  technology: Required<TailoredResumeEmphasizedTechnologyPayload>,
  tones?: Map<string, KeywordCoverageTone>,
) {
  if (!tones || technology.classification === "non_skill") {
    return null;
  }

  const normalizedName = normalizeNonTechnologyTerm(technology.name);

  if (!normalizedName) {
    return null;
  }

  return (
    tones.get(`${technology.priority}:${normalizedName}`) ??
    tones.get(normalizedName) ??
    null
  );
}

function formatKeywordCoverageScope(payload: TailoredResumeBadgePayload) {
  return payload.includeLowPriorityTermsInKeywordCoverage
    ? "All"
    : "High";
}

function queryMetaContent(selector: string) {
  return cleanText(document.querySelector(selector)?.getAttribute("content"));
}

function parseJobPostingStructuredData(): JobPostingStructuredHint[] {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  );
  const jobPostings: JobPostingStructuredHint[] = [];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? "null");
      const entries = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "@graph" in parsed
          ? Array.isArray(parsed["@graph"])
            ? parsed["@graph"]
            : [parsed]
          : [parsed];

      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }

        const typeValue = entry["@type"];
        const normalizedTypes = Array.isArray(typeValue)
          ? typeValue
          : typeof typeValue === "string"
            ? [typeValue]
            : [];

        if (
          !normalizedTypes.some(
            (type) => typeof type === "string" && type.toLowerCase() === "jobposting",
          )
        ) {
          continue;
        }

        const jobPosting = {
          baseSalary: uniqueStrings(
            [
              cleanText(JSON.stringify(entry.baseSalary ?? "")),
              cleanText(JSON.stringify(entry.estimatedSalary ?? "")),
            ],
            4,
          ),
          datePosted: cleanText(String(entry.datePosted ?? "")) || null,
          description: cleanText(String(entry.description ?? ""), 2_000) || null,
          directApply:
            typeof entry.directApply === "boolean" ? entry.directApply : null,
          employmentType: uniqueStrings(
            Array.isArray(entry.employmentType)
              ? entry.employmentType.map((value: unknown) => String(value))
              : [String(entry.employmentType ?? "")],
            4,
          ),
          hiringOrganization:
            cleanText(
              typeof entry.hiringOrganization === "object" &&
                entry.hiringOrganization !== null &&
                "name" in entry.hiringOrganization
                ? String(entry.hiringOrganization.name ?? "")
                : String(entry.hiringOrganization ?? ""),
            ) || null,
          identifier:
            cleanText(
              typeof entry.identifier === "object" &&
                entry.identifier !== null &&
                "value" in entry.identifier
                ? String(entry.identifier.value ?? "")
                : String(entry.identifier ?? ""),
            ) || null,
          locations: uniqueStrings(
            [
              cleanText(JSON.stringify(entry.jobLocation ?? "")),
              cleanText(JSON.stringify(entry.applicantLocationRequirements ?? "")),
            ],
            6,
          ),
          title: cleanText(String(entry.title ?? "")) || null,
          validThrough: cleanText(String(entry.validThrough ?? "")) || null,
        } satisfies JobPostingStructuredHint;

        jobPostings.push(jobPosting);

        if (jobPostings.length >= 4) {
          return jobPostings;
        }
      }
    } catch {
      // Ignore broken JSON-LD blocks.
    }
  }

  return jobPostings;
}

function collectSalaryMentions(text: string) {
  const matches =
    text.match(
      /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?(?:\s*(?:-|–|—|to)\s*(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?)?(?:\s*(?:per year|a year|\/year|yearly|per hour|\/hr|hourly))?)/g,
    ) ?? [];

  return uniqueStrings(matches, 8);
}

function collectLocationCandidates(text: string) {
  const lines = text.split(/\n+/);

  return uniqueStrings(
    lines.filter((line) =>
      /\b(remote|hybrid|onsite|on-site|in office|in-office)\b/i.test(line),
    ),
    8,
  );
}

function collectEmploymentTypeCandidates(text: string) {
  const matches =
    text.match(
      /\b(full[- ]?time|part[- ]?time|contract|internship|temporary|intern)\b/gi,
    ) ?? [];

  return uniqueStrings(matches, 8);
}

function collectTopTextBlocks() {
  const candidates = Array.from(
    document.querySelectorAll(
      "main, article, [role='main'], section, div[data-testid], div[class]",
    ),
  )
    .map((element) => cleanText(element.textContent, 1_200))
    .filter((text) => text.length >= 180)
    .sort((left, right) => right.length - left.length);

  return uniqueStrings(candidates, 10);
}

function collectPageContext(): JobPageContext {
  const bodyText = cleanText(document.body?.innerText, 24_000);
  const title = cleanText(document.title, 300);
  const jsonLdJobPostings = parseJobPostingStructuredData();
  const siteName =
    queryMetaContent('meta[property="og:site_name"]') ||
    queryMetaContent('meta[name="application-name"]');
  const headings = uniqueStrings(
    Array.from(document.querySelectorAll("h1, h2, h3")).map((heading) =>
      cleanText(heading.textContent, 200),
    ),
    12,
  );
  const titleCandidates = uniqueStrings(
    [
      title.split("|")[0] ?? "",
      title.split("-")[0] ?? "",
      ...headings.slice(0, 4),
      ...jsonLdJobPostings.map((posting) => posting.title ?? ""),
    ],
    8,
  );
  const companyCandidates = uniqueStrings(
    [
      siteName,
      ...jsonLdJobPostings.map((posting) => posting.hiringOrganization ?? ""),
    ],
    8,
  );
  const locationCandidates = uniqueStrings(
    [
      ...collectLocationCandidates(bodyText),
      ...jsonLdJobPostings.flatMap((posting) => posting.locations),
    ],
    8,
  );
  const selectionText = cleanText(window.getSelection()?.toString(), 2_000);

  return {
    canonicalUrl:
      cleanText(document.querySelector("link[rel='canonical']")?.getAttribute("href")) ||
      "",
    companyCandidates,
    description:
      queryMetaContent('meta[name="description"]') ||
      queryMetaContent('meta[property="og:description"]'),
    employmentTypeCandidates: uniqueStrings(
      [
        ...collectEmploymentTypeCandidates(bodyText),
        ...jsonLdJobPostings.flatMap((posting) => posting.employmentType),
      ],
      8,
    ),
    headings,
    jsonLdJobPostings,
    locationCandidates,
    rawText: bodyText,
    salaryMentions: uniqueStrings(
      [
        ...collectSalaryMentions(bodyText),
        ...jsonLdJobPostings.flatMap((posting) => posting.baseSalary),
      ],
      8,
    ),
    selectionText,
    siteName,
    title,
    titleCandidates,
    topTextBlocks: collectTopTextBlocks(),
    url: window.location.href,
  };
}

function ensureOverlayRoot() {
  let overlay = document.getElementById("job-helper-command-banner");

  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.id = "job-helper-command-banner";
  overlay.setAttribute("aria-live", "polite");
  overlay.style.position = "fixed";
  overlay.style.top = "50%";
  overlay.style.left = "50%";
  overlay.style.transform = "translate(-50%, -50%)";
  overlay.style.maxWidth = "min(80vw, 720px)";
  overlay.style.padding = "18px 26px";
  overlay.style.borderRadius = "999px";
  overlay.style.fontFamily =
    '"IBM Plex Sans","Avenir Next","Segoe UI",sans-serif';
  overlay.style.fontSize = "18px";
  overlay.style.fontWeight = "700";
  overlay.style.letterSpacing = "0.01em";
  overlay.style.color = "#ffffff";
  overlay.style.background = "rgba(17, 24, 39, 0.9)";
  overlay.style.boxShadow = "0 18px 60px rgba(0, 0, 0, 0.28)";
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 120ms ease";
  document.documentElement.appendChild(overlay);

  return overlay;
}

function showOverlay(text: string, tone: OverlayTone) {
  const overlay = ensureOverlayRoot();
  overlay.textContent = text;
  overlay.style.background =
    tone === "success"
      ? "rgba(15, 118, 110, 0.92)"
      : tone === "warning"
        ? "rgba(180, 83, 9, 0.94)"
      : tone === "error"
        ? "rgba(185, 28, 28, 0.94)"
        : "rgba(17, 24, 39, 0.9)";
  overlay.style.opacity = "1";

  if (overlayTimeoutId !== null) {
    window.clearTimeout(overlayTimeoutId);
  }

  overlayTimeoutId = window.setTimeout(() => {
    overlay.style.opacity = "0";
    overlayTimeoutId = null;
  }, 1_750);
}

function hideEmphasizedTechnologyBadge() {
  document.getElementById(emphasizedTechnologyBadgeRootId)?.remove();
  reflowPagePromptStack();
}

function hideTailoredResumePrompts() {
  hideEmphasizedTechnologyBadge();
}

function shouldSuppressTailoredResumePagePrompts() {
  return isJobHelperAppUrl(window.location.href);
}

function styleElement(
  element: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
) {
  Object.assign(element.style, styles);
}

function ensurePagePromptStyles() {
  if (document.getElementById(pagePromptStyleId)) {
    return;
  }

  const style = document.createElement("style");

  style.id = pagePromptStyleId;
  style.textContent = `
    #${emphasizedTechnologyBadgeRootId} summary::-webkit-details-marker {
      display: none;
    }
    #${emphasizedTechnologyBadgeRootId} summary::marker {
      content: "";
    }
  `;
  document.documentElement.appendChild(style);
}

function getPagePromptElements() {
  return [emphasizedTechnologyBadgeRootId]
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function setPagePromptPosition(
  element: HTMLElement,
  position: { x: number; y: number },
) {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.transform = "none";
}

function reflowPagePromptStack() {
  let nextTop = pagePromptEdgeInset;

  for (const element of getPagePromptElements()) {
    if (element.dataset.jobHelperDragged === "true") {
      const rect = element.getBoundingClientRect();
      setPagePromptPosition(element, {
        x: rect.left,
        y: rect.top,
      });
      continue;
    }

    setPagePromptPosition(element, {
      x: pagePromptEdgeInset,
      y: nextTop,
    });
    nextTop += (element.offsetHeight || element.getBoundingClientRect().height) + pagePromptGap;
  }
}

function isInteractivePromptDragTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, textarea, select, summary"))
  );
}

function attachPagePromptDragHandle(element: HTMLElement, handle: HTMLElement) {
  if (handle.dataset.jobHelperDragHandle === "true") {
    return;
  }

  handle.dataset.jobHelperDragHandle = "true";
  handle.style.cursor = "move";
  handle.style.userSelect = "none";
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || isInteractivePromptDragTarget(event.target)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.left;
    const originY = rect.top;
    element.dataset.jobHelperDragged = "true";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPagePromptPosition(element, {
        x: originX + moveEvent.clientX - startX,
        y: originY + moveEvent.clientY - startY,
      });
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    event.preventDefault();
  });
}

window.addEventListener("resize", reflowPagePromptStack);

function createBadgeDownloadIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.style.width = "15px";
  icon.style.height = "15px";
  icon.style.fill = "none";
  icon.style.stroke = "currentColor";
  icon.style.strokeLinecap = "round";
  icon.style.strokeLinejoin = "round";
  icon.style.strokeWidth = "2.2";

  for (const pathData of [
    "M12 3v12",
    "m7 10 5 5 5-5",
    "M5 21h14",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  }

  return icon;
}

function createBadgeIconButton(label: string) {
  const button = document.createElement("button");

  button.type = "button";
  button.setAttribute("aria-label", label);
  styleElement(button, {
    alignItems: "center",
    appearance: "none",
    background: "rgba(16, 185, 129, 0.16)",
    border: "1px solid rgba(52, 211, 153, 0.28)",
    borderRadius: "999px",
    color: "#a7f3d0",
    cursor: "pointer",
    display: "inline-flex",
    height: "28px",
    justifyContent: "center",
    margin: "0",
    padding: "0",
    width: "28px",
  });

  return button;
}

function createResumeDownloadButton(payload: TailoredResumeBadgePayload) {
  const companyName = cleanText(payload.companyName, 120);
  const displayName = cleanText(payload.displayName, 160);
  const downloadName = cleanText(payload.downloadName, 180);
  const tailoredResumeId = cleanText(payload.tailoredResumeId, 160);

  if (!tailoredResumeId) {
    return null;
  }

  const downloadButton = createBadgeIconButton("Download tailored resume");

  downloadButton.append(createBadgeDownloadIcon());
  downloadButton.title = "Download";
  downloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (downloadButton.disabled) {
      return;
    }

    downloadButton.disabled = true;
    downloadButton.setAttribute("aria-busy", "true");
    downloadButton.style.cursor = "wait";
    downloadButton.style.opacity = "0.72";

    chrome.runtime.sendMessage(
      {
        payload: {
          companyName,
          displayName,
          downloadName,
          tailoredResumeId,
        },
        type: "JOB_HELPER_DOWNLOAD_TAILORED_RESUME",
      },
      (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          console.warn("Could not download the tailored resume.", runtimeError);
        } else if (
          typeof response === "object" &&
          response !== null &&
          "ok" in response &&
          response.ok === false
        ) {
          console.warn("Could not download the tailored resume.", response);
        }

        downloadButton.disabled = false;
        downloadButton.removeAttribute("aria-busy");
        downloadButton.style.cursor = "pointer";
        downloadButton.style.opacity = "1";
      },
    );
  });

  return downloadButton;
}

function normalizeEmphasizedTechnologies(
  value: TailoredResumeEmphasizedTechnologyPayload[] | undefined,
  nonTechnologyTerms = new Set<string>(),
) {
  if (!Array.isArray(value)) {
    return [] as Required<TailoredResumeEmphasizedTechnologyPayload>[];
  }

  const seen = new Set<string>();
  const technologies: Required<TailoredResumeEmphasizedTechnologyPayload>[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const name = cleanText(item.name, 80);
    const priority = item.priority === "high" ? "high" : item.priority === "low" ? "low" : null;
    const normalizedName = normalizeNonTechnologyTerm(name);
    const classification =
      normalizeKeywordClassificationKind(item.classification) ??
      "skills_section";

    if (
      !name ||
      !priority ||
      (classification !== "non_skill" && nonTechnologyTerms.has(normalizedName))
    ) {
      continue;
    }

    const dedupeKey = `${priority}:${normalizedName}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    technologies.push({
      classification,
      evidence: cleanText(item.evidence, 180),
      name,
      priority,
    });
  }

  return technologies;
}

function ensureEmphasizedTechnologyBadgeRoot() {
  ensurePagePromptStyles();

  const existingBadge = document.getElementById(emphasizedTechnologyBadgeRootId);

  if (existingBadge instanceof HTMLDivElement) {
    return existingBadge;
  }

  const badge = document.createElement("div");
  badge.id = emphasizedTechnologyBadgeRootId;
  badge.setAttribute("aria-label", "Job keywords extracted by Job Helper");
  badge.setAttribute("role", "region");
  styleElement(badge, {
    backdropFilter: "blur(18px)",
    boxSizing: "border-box",
    background:
      "linear-gradient(180deg, rgba(24, 24, 27, 0.97), rgba(5, 5, 7, 0.95))",
    border: "1px solid rgba(52, 211, 153, 0.24)",
    borderRadius: "16px",
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 18px 55px rgba(0, 0, 0, 0.28)",
    color: "#f4f4f5",
    display: "grid",
    fontFamily: '"DM Sans", Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    gap: "13px",
    gridTemplateColumns: "minmax(0, 1fr) 28px",
    left: `${pagePromptEdgeInset}px`,
    letterSpacing: "0",
    maxHeight: "calc(100vh - 32px)",
    maxWidth: "calc(100vw - 32px)",
    overflow: "hidden",
    padding: "13px 13px 15px 15px",
    pointerEvents: "auto",
    position: "fixed",
    top: `${pagePromptEdgeInset}px`,
    width: pagePromptWidth,
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(badge);

  return badge;
}

function createPromptCloseButton(label: string) {
  const closeButton = document.createElement("button");

  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.setAttribute("aria-label", label);
  styleElement(closeButton, {
    alignItems: "center",
    appearance: "none",
    background: "rgba(244, 244, 245, 0.06)",
    border: "1px solid rgba(244, 244, 245, 0.1)",
    borderRadius: "999px",
    color: "#e4e4e7",
    cursor: "pointer",
    display: "inline-flex",
    font: "700 14px/1 Inter, ui-sans-serif, system-ui, sans-serif",
    height: "28px",
    justifyContent: "center",
    margin: "0",
    padding: "0",
    width: "28px",
  });

  return closeButton;
}

function updateBadgePayloadKeywordClassification(input: {
  kind: KeywordClassificationKind;
  name: string;
  payload: TailoredResumeBadgePayload;
  priority?: "high" | "low" | null;
}) {
  const normalizedName = normalizeNonTechnologyTerm(input.name);

  input.payload.emphasizedTechnologies = (
    input.payload.emphasizedTechnologies ?? []
  ).map((technology) =>
      normalizeNonTechnologyTerm(technology.name) === normalizedName
        ? {
            ...technology,
            classification: input.kind,
            priority:
              input.kind === "non_skill" || !input.priority
                ? technology.priority
                : input.priority,
          }
        : technology,
  );
}

function appendDraggableKeywordMatrix(
  container: HTMLElement,
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
  technologies: Required<TailoredResumeEmphasizedTechnologyPayload>[],
  coverageTones?: Map<string, KeywordCoverageTone>,
) {
  const buckets = [
    {
      id: "high:skills_section",
      label: "High skills-section",
      priority: "high",
      kind: "skills_section",
    },
    {
      id: "high:narrative",
      label: "High narrative",
      priority: "high",
      kind: "narrative",
    },
    {
      id: "low:skills_section",
      label: "Low skills-section",
      priority: "low",
      kind: "skills_section",
    },
    {
      id: "low:narrative",
      label: "Low narrative",
      priority: "low",
      kind: "narrative",
    },
    { id: "non_skill", label: "Non-skill", priority: null, kind: "non_skill" },
  ] as const;
  const grid = document.createElement("div");
  const matrix = document.createElement("div");
  const nonSkillSection = document.createElement("div");

  styleElement(grid, {
    display: "grid",
    gap: "8px",
  });
  styleElement(matrix, {
    border: "1px solid rgba(244, 244, 245, 0.14)",
    borderRadius: "10px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    overflow: "hidden",
  });
  styleElement(nonSkillSection, {
    border: "1px solid rgba(244, 244, 245, 0.14)",
    borderRadius: "10px",
    minHeight: "70px",
    overflow: "hidden",
  });

  function createChip(technology: Required<TailoredResumeEmphasizedTechnologyPayload>) {
    const chip = document.createElement("button");
    const label = document.createElement("span");
    const handle = document.createElement("span");
    const coverageTone = readTechnologyKeywordCoverageTone(
      technology,
      coverageTones,
    );
    const coverageStatus =
      coverageTone === "original"
        ? "In Base"
        : coverageTone === "new"
          ? "In New"
          : coverageTone === "missing"
            ? "In Neither"
            : "";
    const titleParts: string[] = [];
    const chipBackground =
      coverageTone === "new"
        ? "rgba(52, 211, 153, 0.3)"
        : coverageTone === "missing"
          ? "rgba(244, 63, 94, 0.13)"
          : coverageTone === "original"
            ? "rgba(14, 165, 233, 0.13)"
            : technology.classification === "non_skill"
              ? "rgba(113, 113, 122, 0.16)"
              : technology.priority === "high"
                ? "rgba(16, 185, 129, 0.14)"
                : "rgba(244, 244, 245, 0.07)";
    const chipBorder =
      coverageTone === "new"
        ? "1px solid rgba(110, 231, 183, 0.68)"
        : coverageTone === "missing"
          ? "1px solid rgba(251, 113, 133, 0.34)"
          : coverageTone === "original"
            ? "1px solid rgba(56, 189, 248, 0.32)"
            : technology.classification === "non_skill"
              ? "1px solid rgba(161, 161, 170, 0.22)"
              : technology.priority === "high"
                ? "1px solid rgba(52, 211, 153, 0.28)"
                : "1px solid rgba(244, 244, 245, 0.12)";
    const chipColor =
      coverageTone === "new"
        ? "#d1fae5"
        : coverageTone === "missing"
          ? "#ffe4e6"
          : coverageTone === "original"
            ? "#f0f9ff"
            : technology.classification === "non_skill"
              ? "#a1a1aa"
              : "#f4f4f5";

    if (coverageStatus) {
      titleParts.push(coverageStatus);
    }
    if (technology.evidence) {
      titleParts.push(technology.evidence);
    }

    chip.type = "button";
    chip.draggable = true;
    chip.dataset.keywordName = technology.name;
    if (coverageTone) {
      chip.dataset.keywordCoverageTone = coverageTone;
    }
    chip.title = titleParts.join(" - ") || "Drag to change classification";
    styleElement(chip, {
      alignItems: "center",
      appearance: "none",
      background: chipBackground,
      border: chipBorder,
      borderRadius: "999px",
      color: chipColor,
      cursor: "grab",
      display: "inline-flex",
      font: "650 12px/1.35 Inter, ui-sans-serif, system-ui, sans-serif",
      gap: "6px",
      maxWidth: "100%",
      minHeight: "28px",
      overflowWrap: "anywhere",
      padding: "5px 7px 5px 10px",
      textAlign: "left",
    });
    styleElement(label, {
      minWidth: "0",
      overflowWrap: "anywhere",
    });
    styleElement(handle, {
      color: "rgba(244, 244, 245, 0.55)",
      flex: "0 0 auto",
      fontSize: "13px",
      lineHeight: "1",
    });
    label.textContent = technology.name;
    handle.textContent = "↕";
    chip.append(label, handle);
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", technology.name);
      event.dataTransfer?.setData("application/x-job-helper-keyword", technology.name);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      chip.style.opacity = "0.58";
    });
    chip.addEventListener("dragend", () => {
      chip.style.opacity = "1";
    });

    return chip;
  }

  function appendBucket(bucket: (typeof buckets)[number], parent: HTMLElement) {
    const bucketElement = document.createElement("div");
    const heading = document.createElement("div");
    const chipList = document.createElement("div");
    const bucketTechnologies = technologies.filter((technology) =>
      bucket.kind === "non_skill"
        ? technology.classification === "non_skill"
        : technology.priority === bucket.priority &&
          technology.classification === bucket.kind,
    );

    bucketElement.dataset.keywordKind = bucket.kind;
    bucketElement.dataset.keywordPriority = bucket.priority ?? "";
    styleElement(bucketElement, {
      background:
        bucket.kind === "non_skill"
          ? "rgba(39, 39, 42, 0.58)"
          : "rgba(9, 9, 11, 0.34)",
      borderRight: parent === matrix && bucket.kind === "skills_section"
        ? "1px solid rgba(244, 244, 245, 0.14)"
        : "0",
      borderTop: parent === matrix && bucket.id.startsWith("low")
        ? "1px solid rgba(244, 244, 245, 0.14)"
        : "0",
      boxSizing: "border-box",
      display: "grid",
      gap: "7px",
      gridTemplateRows: "auto minmax(42px, 1fr)",
      minHeight: parent === matrix ? "92px" : "70px",
      minWidth: "0",
      padding: "8px",
    });
    styleElement(heading, {
      color: "rgba(244, 244, 245, 0.62)",
      fontSize: "10px",
      fontWeight: "800",
      letterSpacing: "0.14em",
      lineHeight: "1.2",
      textTransform: "uppercase",
    });
    styleElement(chipList, {
      alignContent: "start",
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      height: "100%",
      minHeight: "30px",
    });
    heading.textContent = bucket.label;

    for (const technology of bucketTechnologies) {
      chipList.append(createChip(technology));
    }

    bucketElement.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      bucketElement.style.background =
        bucket.kind === "non_skill"
          ? "rgba(63, 63, 70, 0.76)"
          : "rgba(16, 185, 129, 0.1)";
    });
    bucketElement.addEventListener("dragleave", () => {
      bucketElement.style.background =
        bucket.kind === "non_skill"
          ? "rgba(39, 39, 42, 0.58)"
          : "rgba(9, 9, 11, 0.34)";
    });
    bucketElement.addEventListener("drop", (event) => {
      event.preventDefault();
      bucketElement.style.background =
        bucket.kind === "non_skill"
          ? "rgba(39, 39, 42, 0.58)"
          : "rgba(9, 9, 11, 0.34)";
      const name =
        event.dataTransfer?.getData("application/x-job-helper-keyword") ||
        event.dataTransfer?.getData("text/plain") ||
        "";

      if (!name) {
        return;
      }

      updateBadgePayloadKeywordClassification({
        kind: bucket.kind,
        name,
        payload,
        priority: bucket.priority,
      });
      rememberKeywordClassificationOverride({
        badgeKey,
        kind: bucket.kind,
        name,
        payload,
        priority: bucket.priority,
      });
      void enqueueKeywordClassificationSave({
        kind: bucket.kind,
        name,
        priority: bucket.priority,
      });
      showEmphasizedTechnologyBadge(payload, badgeKey);
    });

    bucketElement.append(heading, chipList);
    parent.append(bucketElement);
  }

  for (const bucket of buckets.slice(0, 4)) {
    appendBucket(bucket, matrix);
  }
  appendBucket(buckets[4]!, nonSkillSection);
  grid.append(matrix, nonSkillSection);
  container.append(grid);
}

function appendKeywordCoverageDisclosure(
  container: HTMLElement,
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
  technologies: Required<TailoredResumeEmphasizedTechnologyPayload>[],
) {
  const buckets = readKeywordCoverageBuckets(payload);
  const tailoredResumeId = cleanText(payload.tailoredResumeId, 160);

  if (!buckets || !tailoredResumeId) {
    return false;
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const summaryTitle = document.createElement("span");
  const summaryMeta = document.createElement("span");
  const chevron = document.createElement("span");
  const panel = document.createElement("div");
  const legend = document.createElement("div");
  const legendItems = document.createElement("div");
  const legendTooltip = document.createElement("span");
  const matrixContainer = document.createElement("div");
  const action = document.createElement("button");
  const scopeLabel = formatKeywordCoverageScope(payload);
  const coverageToneCounts = countKeywordCoverageTones(buckets.allPriorities);
  const coverageTones = buildKeywordCoverageToneMap(buckets.allPriorities);

  legendTooltip.dataset.keywordCoverageLegendTooltip = "true";

  styleElement(details, {
    background: "transparent",
    border: "0",
    borderRadius: "0",
    boxShadow: "none",
    boxSizing: "border-box",
    display: "grid",
    gap: "8px",
    margin: "0",
    overflow: "hidden",
    padding: "0",
  });
  styleElement(summary, {
    alignItems: "center",
    color: "#d1fae5",
    cursor: "pointer",
    display: "none",
    gap: "8px",
    gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr) auto",
    listStyle: "none",
    minHeight: "34px",
    padding: "8px 10px",
  });
  styleElement(summaryTitle, {
    color: "#f0fdf4",
    fontSize: "12px",
    fontWeight: "800",
    lineHeight: "1.2",
    whiteSpace: "nowrap",
  });
  styleElement(summaryMeta, {
    color: "rgba(209, 250, 229, 0.82)",
    fontSize: "11px",
    fontWeight: "700",
    lineHeight: "1.25",
    minWidth: "0",
    overflow: "hidden",
    textAlign: "right",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  styleElement(chevron, {
    color: "rgba(209, 250, 229, 0.72)",
    fontSize: "14px",
    fontWeight: "800",
    lineHeight: "1",
  });
  styleElement(panel, {
    display: "grid",
    gap: "9px",
    padding: "0",
  });
  styleElement(legend, {
    alignItems: "center",
    color: "rgba(212, 212, 216, 0.76)",
    display: "flex",
    fontSize: "10px",
    fontWeight: "750",
    gap: "6px",
    justifyContent: "space-between",
    lineHeight: "1.25",
    minWidth: "0",
  });
  styleElement(legendItems, {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    minWidth: "0",
  });
  styleElement(legendTooltip, {
    background: "rgba(18, 18, 22, 0.96)",
    border: "1px solid rgba(244, 244, 245, 0.16)",
    borderRadius: "10px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.34)",
    color: "#e4e4e7",
    fontFamily:
      '"DM Sans", Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    fontSize: "11px",
    fontWeight: "600",
    lineHeight: "1.35",
    opacity: "0",
    padding: "8px 9px",
    pointerEvents: "none",
    position: "fixed",
    transition: "opacity 120ms ease, visibility 120ms ease",
    visibility: "hidden",
    width: "260px",
    zIndex: "2147483647",
  });
  styleElement(matrixContainer, {
    display: "grid",
    minWidth: "0",
  });
  styleElement(action, {
    appearance: "none",
    background: "rgba(16, 185, 129, 0.16)",
    border: "1px solid rgba(52, 211, 153, 0.28)",
    borderRadius: "999px",
    color: "#a7f3d0",
    cursor: "pointer",
    font: "700 12px/1 Inter, ui-sans-serif, system-ui, sans-serif",
    minHeight: "31px",
    padding: "0 12px",
    width: "100%",
  });

  details.open = true;
  summaryTitle.textContent = "See Changes";
  summaryMeta.textContent =
    `${scopeLabel}: ${buckets.summary.originalHitCount}/${buckets.summary.totalTermCount} -> ` +
    `${buckets.summary.tailoredHitCount}/${buckets.summary.totalTermCount}`;
  chevron.textContent = "v";
  action.type = "button";
  action.textContent = "See Full Diff";
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (action.disabled) {
      return;
    }

    action.disabled = true;
    action.style.cursor = "wait";
    action.style.opacity = "0.72";

    chrome.runtime.sendMessage(
      {
        payload: { tailoredResumeId },
        type: "JOB_HELPER_OPEN_TAILORED_RESUME_REVIEW",
      },
      () => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          console.warn("Could not open the tailored resume review.", runtimeError);
        }

        action.disabled = false;
        action.style.cursor = "pointer";
        action.style.opacity = "1";
      },
    );
  });

  const positionLegendTooltip = (trigger: HTMLElement) => {
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = legendTooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || 260;
    const tooltipHeight = tooltipRect.height || 48;
    const gap = 8;
    const inset = 10;
    const minimumClearanceAbove = tooltipHeight + gap + 36;
    const top =
      triggerRect.top >= minimumClearanceAbove
        ? triggerRect.top - tooltipHeight - gap
        : triggerRect.bottom + gap;
    const left = Math.min(
      Math.max(inset, triggerRect.left),
      Math.max(inset, window.innerWidth - tooltipWidth - inset),
    );

    legendTooltip.style.left = `${left}px`;
    legendTooltip.style.top = `${Math.min(
      Math.max(inset, top),
      Math.max(inset, window.innerHeight - tooltipHeight - inset),
    )}px`;
  };
  const showLegendTooltip = (trigger: HTMLElement, description: string) => {
    legendTooltip.textContent = description;
    if (!legendTooltip.isConnected) {
      document.documentElement.append(legendTooltip);
    }
    positionLegendTooltip(trigger);
    legendTooltip.style.opacity = "1";
    legendTooltip.style.visibility = "visible";
  };
  const hideLegendTooltip = () => {
    legendTooltip.style.opacity = "0";
    legendTooltip.style.visibility = "hidden";
  };
  const repositionVisibleLegendTooltip = () => {
    const activeLegendItem = document.querySelector<HTMLElement>(
      `#${emphasizedTechnologyBadgeRootId} [data-keyword-coverage-legend-active="true"]`,
    );

    if (legendTooltip.style.visibility === "visible" && activeLegendItem) {
      positionLegendTooltip(activeLegendItem);
    }
  };

  function createLegendItem(
    tone: KeywordCoverageTone,
    label: string,
    color: string,
    description: string,
  ) {
    const item = document.createElement("span");
    const dot = document.createElement("span");

    item.tabIndex = 0;
    item.dataset.keywordCoverageLegendTone = tone;
    item.setAttribute("aria-label", `${label}: ${description}`);
    item.setAttribute("role", "button");
    styleElement(item, {
      alignItems: "center",
      cursor: "help",
      display: "inline-flex",
      gap: "4px",
      whiteSpace: "nowrap",
    });
    dot.dataset.keywordCoverageColor = tone;
    styleElement(dot, {
      background: color,
      borderRadius: "999px",
      display: "inline-block",
      height: "7px",
      width: "7px",
    });
    item.addEventListener("mouseenter", () => {
      item.dataset.keywordCoverageLegendActive = "true";
      showLegendTooltip(item, description);
    });
    item.addEventListener("mouseleave", () => {
      delete item.dataset.keywordCoverageLegendActive;
      hideLegendTooltip();
    });
    item.addEventListener("focus", () => {
      item.dataset.keywordCoverageLegendActive = "true";
      showLegendTooltip(item, description);
    });
    item.addEventListener("blur", () => {
      delete item.dataset.keywordCoverageLegendActive;
      hideLegendTooltip();
    });
    item.append(dot, document.createTextNode(label));
    return item;
  }

  window.addEventListener("resize", repositionVisibleLegendTooltip);
  window.addEventListener("scroll", repositionVisibleLegendTooltip, true);

  legendItems.append(
    createLegendItem(
      "original",
      `In Base ${coverageToneCounts.original}`,
      "#38bdf8",
      "In Base: this job keyword is present in the original base resume.",
    ),
    createLegendItem(
      "new",
      `In New ${coverageToneCounts.new}`,
      "#6ee7b7",
      "In New: this job keyword is present in the new tailored resume, but not in the original base resume.",
    ),
    createLegendItem(
      "missing",
      `In Neither ${coverageToneCounts.missing}`,
      "#fb7185",
      "In Neither: this job keyword is not present in the original base resume or the new tailored resume.",
    ),
  );
  legend.append(legendItems);
  appendDraggableKeywordMatrix(
    matrixContainer,
    payload,
    badgeKey,
    technologies,
    coverageTones,
  );

  summary.append(summaryTitle, summaryMeta, chevron);
  panel.append(legend, matrixContainer, action);
  details.append(summary, panel);
  details.addEventListener("toggle", () => {
    chevron.textContent = details.open ? "^" : "v";
    hideLegendTooltip();
    window.requestAnimationFrame(reflowPagePromptStack);
  });
  container.append(details);
  return true;
}

function showEmphasizedTechnologyBadge(
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
) {
  applyKeywordClassificationOverrides(payload, badgeKey);
  const normalizedTechnologies = normalizeEmphasizedTechnologies(
    payload.emphasizedTechnologies,
    readNonTechnologyTermSet(payload),
  );
  const coverageBuckets = readKeywordCoverageBuckets(payload);
  const technologies =
    normalizedTechnologies.length > 0
      ? normalizedTechnologies
      : coverageBuckets?.allPriorities.terms.map((term) => ({
          classification: "skills_section" as const,
          evidence: "",
          name: term.name,
          priority: term.priority,
        })) ?? [];
  const technologyBadgeKey = `emphasized-technologies:${badgeKey}`;
  const dismissalKey = resolveKeywordBadgeDismissalKey(payload, badgeKey);
  lastShownKeywordBadgePayload = { badgeKey, payload };

  if (technologies.length === 0) {
    hideEmphasizedTechnologyBadge();
    return;
  }

  if (dismissedKeywordBadgeKeys.has(dismissalKey)) {
    hideEmphasizedTechnologyBadge();
    return;
  }

  const badge = ensureEmphasizedTechnologyBadgeRoot();
  const content = document.createElement("div");
  const eyebrow = document.createElement("div");
  const groups = document.createElement("div");
  const downloadButton = createResumeDownloadButton(payload);
  const closeButton = createPromptCloseButton("Dismiss job keyword terms");

  badge.dataset.jobHelperBadgeKey = technologyBadgeKey;
  badge.style.gridTemplateColumns = downloadButton
    ? "minmax(0, 1fr) 28px 28px"
    : "minmax(0, 1fr) 28px";
  styleElement(content, {
    display: "grid",
    gap: "5px",
    minWidth: "0",
  });
  styleElement(eyebrow, {
    color: "#6ee7b7",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.22em",
    lineHeight: "1.2",
    textTransform: "uppercase",
  });
  styleElement(groups, {
    display: "grid",
    gap: "12px",
    gridColumn: "1 / -1",
    maxHeight: "min(520px, calc(100vh - 160px))",
    overflowY: "auto",
  });

  eyebrow.textContent = "Job keywords";
  badge.dataset.jobHelperDismissalKey = dismissalKey;
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void rememberDismissedKeywordBadgeKey(dismissalKey);
    hideEmphasizedTechnologyBadge();
  });
  if (!appendKeywordCoverageDisclosure(groups, payload, badgeKey, technologies)) {
    appendDraggableKeywordMatrix(groups, payload, badgeKey, technologies);
  }
  content.append(eyebrow);
  badge.replaceChildren(
    content,
    ...(downloadButton ? [downloadButton] : []),
    closeButton,
    groups,
  );
  attachPagePromptDragHandle(badge, content);
  window.requestAnimationFrame(reflowPagePromptStack);
}

function showTailoredResumeBadge(payload: TailoredResumeBadgePayload) {
  if (shouldSuppressTailoredResumePagePrompts()) {
    hideTailoredResumePrompts();
    return;
  }

  const badgeKey =
    cleanText(payload.badgeKey, 220) ||
    cleanText(payload.jobUrl, 220) ||
    cleanText(payload.tailoredResumeId, 220) ||
    cleanText(payload.displayName, 220);

  if (!badgeKey) {
    return;
  }

  showEmphasizedTechnologyBadge(payload, badgeKey);
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function isCaptureShortcut(event: KeyboardEvent) {
  const isMacShortcut = event.metaKey && event.shiftKey && !event.ctrlKey;
  const isNonMacShortcut = event.ctrlKey && event.shiftKey && !event.metaKey;

  return (
    !event.altKey &&
    (isMacShortcut || isNonMacShortcut) &&
    event.key.toLowerCase() === "s"
  );
}

window.addEventListener(
  "keydown",
  (event) => {
    if (event.repeat || isEditableTarget(event.target) || !isCaptureShortcut(event)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const now = Date.now();

    if (now - lastShortcutAt < 750) {
      return;
    }

    lastShortcutAt = now;
    showOverlay(buildTailorResumePreparationMessage(false), "info");
    void chrome.runtime.sendMessage({
      type: "JOB_HELPER_TRIGGER_CAPTURE",
    });
  },
  true,
);

chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => {
  const typedMessage =
    typeof message === "object" && message !== null
      ? (message as {
          payload?: TailoredResumeBadgePayload & {
            text?: string;
            tone?: OverlayTone;
          };
          type?: string;
        })
      : null;

  if (typedMessage?.type === "JOB_HELPER_SHOW_OVERLAY") {
    showOverlay(
      cleanText(typedMessage.payload?.text, 240) ||
        "Job Helper is working on this page",
      typedMessage.payload?.tone ?? "info",
    );
    sendResponse({ ok: true });
    return;
  }

  if (typedMessage?.type === "JOB_HELPER_SHOW_TAILORED_RESUME_BADGE") {
    if (shouldSuppressTailoredResumePagePrompts()) {
      hideTailoredResumePrompts();
      sendResponse({
        ok: false,
        skipped: "job_helper_app_page",
      });
      return;
    }

    showTailoredResumeBadge(typedMessage.payload ?? {});
    sendResponse({ ok: true });
    return;
  }

  if (typedMessage?.type === "JOB_HELPER_SHOW_EMPHASIZED_TECHNOLOGIES_BADGE") {
    if (shouldSuppressTailoredResumePagePrompts()) {
      hideTailoredResumePrompts();
      sendResponse({
        ok: false,
        skipped: "job_helper_app_page",
      });
      return;
    }

    const payload = typedMessage.payload ?? {};
    const badgeKey =
      cleanText(payload.badgeKey, 220) ||
      cleanText(payload.jobUrl, 220) ||
      cleanText(payload.displayName, 220);

    if (badgeKey) {
      showEmphasizedTechnologyBadge(payload, badgeKey);
    }

    sendResponse({ ok: true });
    return;
  }

  if (typedMessage?.type === "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE") {
    hideTailoredResumePrompts();
    sendResponse({ ok: true });
    return;
  }

  if (
    typedMessage?.type !== "JOB_HELPER_CAPTURE_PAGE" &&
    typedMessage?.type !== "JOB_HELPER_COLLECT_PAGE_CONTEXT"
  ) {
    return;
  }

  sendResponse({
    ok: true,
    pageContext: collectPageContext(),
  });
});
