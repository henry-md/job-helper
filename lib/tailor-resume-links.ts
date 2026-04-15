import type { TailorResumeLinkRecord } from "@/lib/tailor-resume-types";

export type ExtractedTailorResumeLink = {
  label: string;
  url: string | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUrlLikeValue(value: string) {
  const trimmedValue = normalizeWhitespace(value);

  if (!trimmedValue) {
    return null;
  }

  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(trimmedValue)) {
    return `mailto:${trimmedValue.toLowerCase()}`;
  }

  if (/^[+()\d.\-\s]+$/.test(trimmedValue)) {
    const digits = trimmedValue.replace(/\D/g, "");
    return digits.length >= 10 ? `tel:${digits}` : null;
  }

  if (/^mailto:/i.test(trimmedValue)) {
    const address = trimmedValue.slice("mailto:".length).split("?")[0]?.trim();

    if (!address || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(address)) {
      return null;
    }

    return `mailto:${address.toLowerCase()}`;
  }

  if (/^tel:/i.test(trimmedValue)) {
    const digits = trimmedValue.slice("tel:".length).replace(/\D/g, "");
    return digits.length >= 10 ? `tel:${digits}` : null;
  }

  const urlCandidate = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    const parsedUrl = new URL(urlCandidate);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export function normalizeTailorResumeLinkLabel(value: string) {
  return normalizeWhitespace(value);
}

export function normalizeTailorResumeLinkUrl(value: string) {
  return normalizeUrlLikeValue(value);
}

export function suggestTailorResumeLinkUrlFromLabel(label: string) {
  const normalizedLabel = normalizeTailorResumeLinkLabel(label);

  if (!normalizedLabel) {
    return null;
  }

  const emailMatch = normalizedLabel.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (emailMatch) {
    return `mailto:${emailMatch[0].toLowerCase()}`;
  }

  const digits = normalizedLabel.replace(/\D/g, "");

  if (digits.length >= 10) {
    return `tel:${digits}`;
  }

  if (/[./]/.test(normalizedLabel)) {
    return normalizeUrlLikeValue(normalizedLabel);
  }

  return null;
}

function buildLinkKeyBase(label: string) {
  const normalizedLabel = normalizeTailorResumeLinkLabel(label)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedLabel || "resume-link";
}

export function buildTailorResumeLinkKey(
  label: string,
  occurrenceCount = 1,
) {
  const baseKey = buildLinkKeyBase(label);
  return occurrenceCount > 1 ? `${baseKey}-${occurrenceCount}` : baseKey;
}

export function buildTailorResumeLinkRecords(input: {
  existingLinks?: TailorResumeLinkRecord[];
  extractedLinks: ExtractedTailorResumeLink[];
  preferExtractedUrls?: boolean;
  preserveUnusedExisting?: boolean;
}) {
  const existingLinksByKey = new Map(
    (input.existingLinks ?? []).map((link) => [link.key, link]),
  );
  const preferExtractedUrls = input.preferExtractedUrls ?? false;
  const preserveUnusedExisting = input.preserveUnusedExisting ?? true;
  const occurrencesByBaseKey = new Map<string, number>();
  const updatedAt = new Date().toISOString();
  const nextRecords: TailorResumeLinkRecord[] = [];
  const seenKeys = new Set<string>();

  for (const link of input.extractedLinks) {
    const normalizedLabel = normalizeTailorResumeLinkLabel(link.label);

    if (!normalizedLabel) {
      continue;
    }

    const baseKey = buildLinkKeyBase(normalizedLabel);
    const occurrenceCount = (occurrencesByBaseKey.get(baseKey) ?? 0) + 1;
    occurrencesByBaseKey.set(baseKey, occurrenceCount);

    const key = buildTailorResumeLinkKey(normalizedLabel, occurrenceCount);
    const existingLink = existingLinksByKey.get(key);
    const extractedUrl = link.url ? normalizeTailorResumeLinkUrl(link.url) : null;
    const shouldUseExtractedUrl = preferExtractedUrls && extractedUrl !== null;
    const disabled = shouldUseExtractedUrl ? false : existingLink?.disabled === true;
    const finalUrl =
      shouldUseExtractedUrl
        ? extractedUrl
        : disabled
        ? null
        : (existingLink?.url
            ? normalizeTailorResumeLinkUrl(existingLink.url)
            : null) ??
          extractedUrl ??
          suggestTailorResumeLinkUrlFromLabel(normalizedLabel);

    seenKeys.add(key);
    nextRecords.push({
      disabled,
      key,
      label: normalizedLabel,
      updatedAt,
      url: finalUrl,
    });
  }

  if (preserveUnusedExisting) {
    for (const existingLink of input.existingLinks ?? []) {
      if (seenKeys.has(existingLink.key)) {
        continue;
      }

      nextRecords.push(existingLink);
    }
  }

  return nextRecords;
}
