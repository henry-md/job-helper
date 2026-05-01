import {
  buildTailorResumePreparationMessage,
  isJobHelperAppUrl,
  type JobPageContext,
  type JobPostingStructuredHint,
} from "./job-helper";

type OverlayTone = "error" | "info" | "success" | "warning";

type TailoredResumeBadgePayload = {
  badgeKey?: string;
  downloadName?: string;
  displayName?: string;
  emphasizedTechnologies?: TailoredResumeEmphasizedTechnologyPayload[];
  includeLowPriorityTermsInKeywordCoverage?: boolean;
  jobUrl?: string;
  keywordCoverage?: TailoredResumeKeywordCoveragePayload | null;
  tailoredResumeId?: string;
};

type TailoredResumeEmphasizedTechnologyPayload = {
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

const resumeBadgeRootId = "job-helper-tailored-resume-badge";
const emphasizedTechnologyBadgeRootId =
  "job-helper-emphasized-technologies-badge";
const pagePromptStyleId = "job-helper-page-prompt-styles";
const resumeBadgeDismissedStorageKey =
  "jobHelperDismissedTailoredResumeBadges";
const emphasizedTechnologyBadgeDismissedStorageKey =
  "jobHelperDismissedEmphasizedTechnologyBadges";
const pagePromptEdgeInset = 16;
const pagePromptGap = 12;
const pagePromptWidth = "min(420px, calc(100vw - 32px))";
let overlayTimeoutId: number | null = null;
let lastShortcutAt = 0;
const dismissedResumeBadgeKeys = readDismissedPagePromptKeys(
  resumeBadgeDismissedStorageKey,
);
const dismissedEmphasizedTechnologyBadgeKeys = readDismissedPagePromptKeys(
  emphasizedTechnologyBadgeDismissedStorageKey,
);

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
    20,
  );
}

function normalizeKeywordCoverageTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Required<TailoredResumeKeywordCoverageTermPayload>[];
  }

  const terms: Required<TailoredResumeKeywordCoverageTermPayload>[] = [];
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

    const key = name.toLowerCase();

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

    if (terms.length >= 30) {
      break;
    }
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
          20,
        )
      : normalizeCoverageTermNames(value.addedTerms);
  const sharedTerms =
    terms.length > 0
      ? uniqueStrings(
          terms
            .filter((term) => term.presentInOriginal && term.presentInTailored)
            .map((term) => term.name),
          20,
        )
      : intersectCoverageTermNames(matchedOriginalTerms, matchedTailoredTerms);
  const missingTerms =
    terms.length > 0
      ? uniqueStrings(
          terms
            .filter((term) => !term.presentInOriginal && !term.presentInTailored)
            .map((term) => term.name),
          20,
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
    totalTermCount,
  };
}

function readKeywordCoverageBucket(payload: TailoredResumeBadgePayload) {
  const coverage = payload.keywordCoverage;

  if (!coverage || typeof coverage !== "object") {
    return null;
  }

  return payload.includeLowPriorityTermsInKeywordCoverage
    ? normalizeKeywordCoverageBucket(coverage.allPriorities)
    : normalizeKeywordCoverageBucket(coverage.highPriority);
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

function readDismissedPagePromptKeys(storageKey: string) {
  try {
    const value = window.sessionStorage.getItem(storageKey);
    const parsed = value ? JSON.parse(value) : [];

    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean),
      );
    }
  } catch {
    // Session storage is a convenience only; dismissal still works in memory.
  }

  return new Set<string>();
}

function writeDismissedPagePromptKeys(storageKey: string, keys: Set<string>) {
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify([...keys].slice(-40)),
    );
  } catch {
    // Ignore pages that block session storage.
  }
}

function rememberDismissedPagePromptKey(
  storageKey: string,
  keys: Set<string>,
  badgeKey: string,
) {
  keys.add(badgeKey);

  if (keys.size > 40) {
    const trimmedKeys = new Set([...keys].slice(-40));
    keys.clear();
    for (const key of trimmedKeys) {
      keys.add(key);
    }
  }

  writeDismissedPagePromptKeys(storageKey, keys);
}

function rememberDismissedResumeBadgeKey(badgeKey: string) {
  rememberDismissedPagePromptKey(
    resumeBadgeDismissedStorageKey,
    dismissedResumeBadgeKeys,
    badgeKey,
  );
}

function rememberDismissedEmphasizedTechnologyBadgeKey(badgeKey: string) {
  rememberDismissedPagePromptKey(
    emphasizedTechnologyBadgeDismissedStorageKey,
    dismissedEmphasizedTechnologyBadgeKeys,
    badgeKey,
  );
}

function hideTailoredResumeBadge() {
  document.getElementById(resumeBadgeRootId)?.remove();
  reflowPagePromptStack();
}

function hideEmphasizedTechnologyBadge() {
  document.getElementById(emphasizedTechnologyBadgeRootId)?.remove();
  reflowPagePromptStack();
}

function hideTailoredResumePrompts() {
  hideTailoredResumeBadge();
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
  return [resumeBadgeRootId, emphasizedTechnologyBadgeRootId]
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function clampPagePromptPosition(
  element: HTMLElement,
  position: { x: number; y: number },
) {
  const width = element.offsetWidth || element.getBoundingClientRect().width || 360;
  const height =
    element.offsetHeight || element.getBoundingClientRect().height || 160;
  const maxX = Math.max(pagePromptEdgeInset, window.innerWidth - width - pagePromptEdgeInset);
  const maxY = Math.max(
    pagePromptEdgeInset,
    window.innerHeight - height - pagePromptEdgeInset,
  );

  return {
    x: Math.min(Math.max(pagePromptEdgeInset, position.x), maxX),
    y: Math.min(Math.max(pagePromptEdgeInset, position.y), maxY),
  };
}

function setPagePromptPosition(
  element: HTMLElement,
  position: { x: number; y: number },
) {
  const nextPosition = clampPagePromptPosition(element, position);
  element.style.left = `${nextPosition.x}px`;
  element.style.top = `${nextPosition.y}px`;
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

function ensureTailoredResumeBadgeRoot() {
  const existingBadge = document.getElementById(resumeBadgeRootId);

  if (existingBadge instanceof HTMLDivElement) {
    return existingBadge;
  }

  const badge = document.createElement("div");
  badge.id = resumeBadgeRootId;
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  styleElement(badge, {
    alignItems: "start",
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
    gap: "12px",
    gridTemplateColumns: "minmax(0, 1fr) 28px",
    letterSpacing: "0",
    maxWidth: "calc(100vw - 32px)",
    padding: "13px 13px 13px 15px",
    pointerEvents: "auto",
    position: "fixed",
    left: `${pagePromptEdgeInset}px`,
    top: `${pagePromptEdgeInset}px`,
    width: pagePromptWidth,
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(badge);

  return badge;
}

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

function normalizeEmphasizedTechnologies(
  value: TailoredResumeEmphasizedTechnologyPayload[] | undefined,
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

    if (!name || !priority) {
      continue;
    }

    const dedupeKey = `${priority}:${name.toLowerCase()}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    technologies.push({
      evidence: cleanText(item.evidence, 180),
      name,
      priority,
    });

    if (technologies.length >= 16) {
      break;
    }
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

function appendTechnologyGroup(
  container: HTMLElement,
  label: string,
  technologies: Required<TailoredResumeEmphasizedTechnologyPayload>[],
) {
  if (technologies.length === 0) {
    return;
  }

  const section = document.createElement("div");
  const heading = document.createElement("div");
  const chipList = document.createElement("div");

  styleElement(section, {
    background: "transparent",
    border: "0",
    borderRadius: "0",
    boxShadow: "none",
    boxSizing: "border-box",
    display: "grid",
    gap: "8px",
    margin: "0",
    padding: "0",
  });
  styleElement(heading, {
    color: "#71717a",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.2em",
    lineHeight: "1.2",
    textTransform: "uppercase",
  });
  styleElement(chipList, {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  });
  heading.textContent = label;

  for (const technology of technologies) {
    const chip = document.createElement("span");

    chip.textContent = technology.name;
    if (technology.evidence) {
      chip.title = technology.evidence;
    }
    styleElement(chip, {
      background:
        technology.priority === "high"
          ? "rgba(16, 185, 129, 0.14)"
          : "rgba(244, 244, 245, 0.07)",
      border:
        technology.priority === "high"
          ? "1px solid rgba(52, 211, 153, 0.28)"
          : "1px solid rgba(244, 244, 245, 0.12)",
      borderRadius: "999px",
      color: technology.priority === "high" ? "#d1fae5" : "#d4d4d8",
      fontSize: "12px",
      fontWeight: "650",
      lineHeight: "1.35",
      maxWidth: "100%",
      overflowWrap: "anywhere",
      padding: "6px 10px",
    });
    chipList.append(chip);
  }

  section.append(heading, chipList);
  container.append(section);
}

function appendKeywordCoverageDisclosure(
  container: HTMLElement,
  payload: TailoredResumeBadgePayload,
) {
  const bucket = readKeywordCoverageBucket(payload);
  const tailoredResumeId = cleanText(payload.tailoredResumeId, 160);

  if (!bucket || !tailoredResumeId) {
    return;
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const summaryTitle = document.createElement("span");
  const summaryMeta = document.createElement("span");
  const chevron = document.createElement("span");
  const panel = document.createElement("div");
  const legend = document.createElement("div");
  const legendItems = document.createElement("div");
  const helpWrap = document.createElement("span");
  const helpButton = document.createElement("button");
  const helpTooltip = document.createElement("span");
  const termGrid = document.createElement("div");
  const action = document.createElement("button");
  const scopeLabel = formatKeywordCoverageScope(payload);

  styleElement(details, {
    background: "rgba(6, 95, 70, 0.18)",
    border: "1px solid rgba(52, 211, 153, 0.22)",
    borderRadius: "13px",
    display: "grid",
    gap: "8px",
    marginTop: "2px",
    overflow: "hidden",
  });
  styleElement(summary, {
    alignItems: "center",
    color: "#d1fae5",
    cursor: "pointer",
    display: "grid",
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
    padding: "0 10px 10px",
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
  styleElement(helpWrap, {
    display: "inline-flex",
    flex: "0 0 auto",
  });
  styleElement(helpButton, {
    appearance: "none",
    background: "rgba(244, 244, 245, 0.06)",
    border: "1px solid rgba(244, 244, 245, 0.16)",
    borderRadius: "999px",
    color: "rgba(244, 244, 245, 0.78)",
    cursor: "help",
    font: "800 10px/1 Inter, ui-sans-serif, system-ui, sans-serif",
    height: "18px",
    padding: "0",
    textAlign: "center",
    width: "18px",
  });
  styleElement(helpTooltip, {
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
  styleElement(termGrid, {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
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

  summaryTitle.textContent = "See Changes";
  summaryMeta.textContent =
    `${scopeLabel}: ${bucket.originalHitCount}/${bucket.totalTermCount} -> ` +
    `${bucket.tailoredHitCount}/${bucket.totalTermCount}`;
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

  function createLegendItem(label: string, color: string) {
    const item = document.createElement("span");
    const dot = document.createElement("span");

    styleElement(item, {
      alignItems: "center",
      display: "inline-flex",
      gap: "4px",
      whiteSpace: "nowrap",
    });
    styleElement(dot, {
      background: color,
      borderRadius: "999px",
      display: "inline-block",
      height: "7px",
      width: "7px",
    });
    item.append(dot, document.createTextNode(label));
    return item;
  }

  helpButton.type = "button";
  helpButton.textContent = "?";
  helpButton.setAttribute(
    "aria-label",
    "Explain resume keyword change colors",
  );
  helpTooltip.textContent =
    "Both = already present. New = added by tailoring. Missing = still absent.";

  const positionHelpTooltip = () => {
    const triggerRect = helpButton.getBoundingClientRect();
    const tooltipRect = helpTooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || 260;
    const tooltipHeight = tooltipRect.height || 48;
    const gap = 8;
    const inset = 10;
    const top =
      triggerRect.top - inset >= tooltipHeight + gap
        ? triggerRect.top - tooltipHeight - gap
        : triggerRect.bottom + gap;
    const left = Math.min(
      Math.max(inset, triggerRect.right - tooltipWidth),
      Math.max(inset, window.innerWidth - tooltipWidth - inset),
    );

    helpTooltip.style.left = `${left}px`;
    helpTooltip.style.top = `${Math.min(
      Math.max(inset, top),
      Math.max(inset, window.innerHeight - tooltipHeight - inset),
    )}px`;
  };
  const showHelpTooltip = () => {
    if (!helpTooltip.isConnected) {
      document.documentElement.append(helpTooltip);
    }
    positionHelpTooltip();
    helpTooltip.style.opacity = "1";
    helpTooltip.style.visibility = "visible";
  };
  const hideHelpTooltip = () => {
    helpTooltip.style.opacity = "0";
    helpTooltip.style.visibility = "hidden";
  };
  const repositionVisibleHelpTooltip = () => {
    if (helpTooltip.style.visibility === "visible") {
      positionHelpTooltip();
    }
  };

  helpWrap.addEventListener("mouseenter", showHelpTooltip);
  helpWrap.addEventListener("mouseleave", hideHelpTooltip);
  helpButton.addEventListener("focus", showHelpTooltip);
  helpButton.addEventListener("blur", hideHelpTooltip);
  window.addEventListener("resize", repositionVisibleHelpTooltip);
  window.addEventListener("scroll", repositionVisibleHelpTooltip, true);
  helpWrap.append(helpButton);

  function appendTermChips(input: {
    color: string;
    terms: string[];
    tone: "added" | "missing" | "shared";
  }) {
    for (const term of input.terms) {
      const chip = document.createElement("span");
      const isAdded = input.tone === "added";
      const isMissing = input.tone === "missing";

      chip.textContent = term;
      styleElement(chip, {
        background: isAdded
          ? "rgba(16, 185, 129, 0.18)"
          : isMissing
            ? "rgba(244, 63, 94, 0.13)"
            : "rgba(14, 165, 233, 0.13)",
        border: `1px solid ${input.color}`,
        borderRadius: "999px",
        color: isAdded ? "#d1fae5" : isMissing ? "#ffe4e6" : "#e0f2fe",
        fontSize: "11px",
        fontWeight: "750",
        lineHeight: "1.15",
        maxWidth: "100%",
        overflowWrap: "anywhere",
        padding: "4px 8px",
      });
      termGrid.append(chip);
    }
  }

  legendItems.append(
    createLegendItem(`Both ${bucket.sharedTerms.length}`, "#38bdf8"),
    createLegendItem(`New ${bucket.addedTerms.length}`, "#34d399"),
    createLegendItem(`Missing ${bucket.missingTerms.length}`, "#fb7185"),
  );
  legend.append(legendItems, helpWrap);
  appendTermChips({
    color: "rgba(56, 189, 248, 0.32)",
    terms: bucket.sharedTerms,
    tone: "shared",
  });
  appendTermChips({
    color: "rgba(52, 211, 153, 0.34)",
    terms: bucket.addedTerms,
    tone: "added",
  });
  appendTermChips({
    color: "rgba(251, 113, 133, 0.34)",
    terms: bucket.missingTerms,
    tone: "missing",
  });

  summary.append(summaryTitle, summaryMeta, chevron);
  panel.append(legend, termGrid, action);
  details.append(summary, panel);
  details.addEventListener("toggle", () => {
    chevron.textContent = details.open ? "^" : "v";
    hideHelpTooltip();
    window.requestAnimationFrame(reflowPagePromptStack);
  });
  container.append(details);
}

function showEmphasizedTechnologyBadge(
  payload: TailoredResumeBadgePayload,
  badgeKey: string,
) {
  const technologies = normalizeEmphasizedTechnologies(
    payload.emphasizedTechnologies,
  );
  const technologyBadgeKey = `emphasized-technologies:${badgeKey}`;

  if (technologies.length === 0) {
    hideEmphasizedTechnologyBadge();
    return;
  }

  if (dismissedEmphasizedTechnologyBadgeKeys.has(technologyBadgeKey)) {
    hideEmphasizedTechnologyBadge();
    return;
  }

  const highPriorityTechnologies = technologies.filter(
    (technology) => technology.priority === "high",
  );
  const lowPriorityTechnologies = technologies.filter(
    (technology) => technology.priority === "low",
  );
  const badge = ensureEmphasizedTechnologyBadgeRoot();
  const content = document.createElement("div");
  const eyebrow = document.createElement("div");
  const groups = document.createElement("div");
  const closeButton = createPromptCloseButton("Dismiss job keyword terms");

  badge.dataset.jobHelperBadgeKey = technologyBadgeKey;
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
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    rememberDismissedEmphasizedTechnologyBadgeKey(technologyBadgeKey);
    hideEmphasizedTechnologyBadge();
  });
  appendTechnologyGroup(groups, "High priority", highPriorityTechnologies);
  appendTechnologyGroup(groups, "Low priority", lowPriorityTechnologies);
  appendKeywordCoverageDisclosure(groups, payload);
  content.append(eyebrow);
  badge.replaceChildren(content, closeButton, groups);
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

  const displayName = cleanText(payload.displayName, 160);
  showEmphasizedTechnologyBadge(payload, badgeKey);

  if (dismissedResumeBadgeKeys.has(badgeKey)) {
    return;
  }

  const downloadName = cleanText(payload.downloadName, 180);
  const tailoredResumeId = cleanText(payload.tailoredResumeId, 160);
  const badge = ensureTailoredResumeBadgeRoot();
  const content = document.createElement("div");
  const eyebrow = document.createElement("div");
  const downloadButton = document.createElement("button");
  const closeButton = createPromptCloseButton("Dismiss resume download prompt");

  badge.dataset.jobHelperBadgeKey = badgeKey;
  badge.style.gridTemplateColumns = tailoredResumeId
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
  styleElement(downloadButton, {
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
  eyebrow.textContent = "Saved resume match";
  downloadButton.type = "button";
  downloadButton.append(createBadgeDownloadIcon());
  downloadButton.title = "Download";
  downloadButton.setAttribute("aria-label", "Download");
  downloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!tailoredResumeId || downloadButton.disabled) {
      return;
    }

    downloadButton.disabled = true;
    downloadButton.setAttribute("aria-busy", "true");
    downloadButton.style.cursor = "wait";
    downloadButton.style.opacity = "0.72";

    chrome.runtime.sendMessage(
      {
        payload: {
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
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    rememberDismissedResumeBadgeKey(badgeKey);
    hideTailoredResumeBadge();
  });

  if (displayName || downloadName) {
    content.title = displayName || downloadName;
  }
  content.append(eyebrow);
  badge.replaceChildren(
    content,
    ...(tailoredResumeId ? [downloadButton] : []),
    closeButton,
  );
  attachPagePromptDragHandle(badge, content);
  window.requestAnimationFrame(reflowPagePromptStack);
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
