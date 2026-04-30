import {
  buildTailorResumePreparationMessage,
  type JobPageContext,
  type JobPostingStructuredHint,
} from "./job-helper";

type OverlayTone = "error" | "info" | "success" | "warning";

type TailoredResumeBadgePayload = {
  badgeKey?: string;
  displayName?: string;
  jobUrl?: string;
};

const resumeBadgeRootId = "job-helper-tailored-resume-badge";
const resumeBadgeDismissedStorageKey =
  "jobHelperDismissedTailoredResumeBadges";
let overlayTimeoutId: number | null = null;
let lastShortcutAt = 0;
let dismissedResumeBadgeKeys = readDismissedResumeBadgeKeys();

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

function readDismissedResumeBadgeKeys() {
  try {
    const value = window.sessionStorage.getItem(resumeBadgeDismissedStorageKey);
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

function writeDismissedResumeBadgeKeys() {
  try {
    window.sessionStorage.setItem(
      resumeBadgeDismissedStorageKey,
      JSON.stringify([...dismissedResumeBadgeKeys].slice(-40)),
    );
  } catch {
    // Ignore pages that block session storage.
  }
}

function rememberDismissedResumeBadgeKey(badgeKey: string) {
  dismissedResumeBadgeKeys.add(badgeKey);

  if (dismissedResumeBadgeKeys.size > 40) {
    dismissedResumeBadgeKeys = new Set([...dismissedResumeBadgeKeys].slice(-40));
  }

  writeDismissedResumeBadgeKeys();
}

function hideTailoredResumeBadge() {
  document.getElementById(resumeBadgeRootId)?.remove();
}

function styleElement(
  element: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
) {
  Object.assign(element.style, styles);
}

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
    right: "16px",
    top: "16px",
    width: "min(360px, calc(100vw - 32px))",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(badge);

  return badge;
}

function showTailoredResumeBadge(payload: TailoredResumeBadgePayload) {
  const badgeKey =
    cleanText(payload.badgeKey, 220) ||
    cleanText(payload.jobUrl, 220) ||
    cleanText(payload.displayName, 220);

  if (!badgeKey || dismissedResumeBadgeKeys.has(badgeKey)) {
    return;
  }

  const displayName = cleanText(payload.displayName, 160);
  const badge = ensureTailoredResumeBadgeRoot();
  const content = document.createElement("div");
  const eyebrow = document.createElement("div");
  const title = document.createElement("div");
  const detail = document.createElement("div");
  const closeButton = document.createElement("button");

  badge.dataset.jobHelperBadgeKey = badgeKey;
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
  styleElement(title, {
    color: "#f4f4f5",
    fontSize: "14px",
    fontWeight: "750",
    lineHeight: "1.25",
  });
  styleElement(detail, {
    color: "#a1a1aa",
    fontSize: "12px",
    lineHeight: "1.35",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
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

  eyebrow.textContent = "Resume ready";
  title.textContent = "Resume already generated";
  detail.textContent =
    displayName || "Job Helper has a saved tailored resume for this tab.";
  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.setAttribute("aria-label", "Dismiss resume badge");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    rememberDismissedResumeBadgeKey(badgeKey);
    hideTailoredResumeBadge();
  });

  content.append(eyebrow, title, detail);
  badge.replaceChildren(content, closeButton);
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
    showTailoredResumeBadge(typedMessage.payload ?? {});
    sendResponse({ ok: true });
    return;
  }

  if (typedMessage?.type === "JOB_HELPER_HIDE_TAILORED_RESUME_BADGE") {
    hideTailoredResumeBadge();
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
