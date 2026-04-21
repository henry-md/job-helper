import type { TailoredResumeRecord } from "./tailor-resume-types.ts";

type TailoredResumeDownloadFilenameRecord = Pick<
  TailoredResumeRecord,
  "displayName" | "jobIdentifier" | "positionTitle"
> &
  Partial<Pick<TailoredResumeRecord, "jobDescription">>;

const genericJobIdentifiers = new Set([
  "general",
  "n/a",
  "na",
  "none",
  "not available",
  "unknown",
  "unspecified",
]);

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function sanitizeFilenameBaseName(value: string) {
  return collapseWhitespace(value)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/[ .-]+$/g, "");
}

function normalizeJobNumberForFilename(value: string) {
  return collapseWhitespace(value).replace(
    /^(?:id|job(?:\s+(?:id|number))?|opening(?:\s+(?:id|number))?|posting(?:\s+(?:id|number))?|ref(?:\s+(?:id|number))?|reference(?:\s+(?:id|number))?|req(?:\s+(?:id|number))?|requisition(?:\s+(?:id|number))?)\s*(?::|#)\s*/i,
    "",
  );
}

function readJobNumberCandidate(match: RegExpMatchArray | null) {
  const candidate = match?.[1]?.trim();

  return looksLikeTailoredResumeJobNumber(candidate) ? candidate : null;
}

function extractJobNumberFromJobDescription(
  jobDescription: string | null | undefined,
) {
  const normalizedJobDescription = collapseWhitespace(jobDescription ?? "");

  if (!normalizedJobDescription) {
    return null;
  }

  return (
    readJobNumberCandidate(
      normalizedJobDescription.match(
        /\b(?:job|position)\s*(?:id|number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{0,40})/i,
      ),
    ) ??
    readJobNumberCandidate(
      normalizedJobDescription.match(
        /\b(?:opening|posting|ref|reference|req|requisition)\s*(?:id|number|no\.?|#)?\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]{0,40})/i,
      ),
    )
  );
}

function resolveTailoredResumeJobNumber(
  record: TailoredResumeDownloadFilenameRecord,
) {
  if (looksLikeTailoredResumeJobNumber(record.jobIdentifier)) {
    return record.jobIdentifier;
  }

  return extractJobNumberFromJobDescription(record.jobDescription);
}

export function looksLikeTailoredResumeJobNumber(
  value: string | null | undefined,
) {
  const identifier = collapseWhitespace(value ?? "");

  if (!identifier) {
    return false;
  }

  if (genericJobIdentifiers.has(identifier.toLowerCase())) {
    return false;
  }

  const digitCount = identifier.match(/\d/g)?.length ?? 0;

  if (digitCount >= 3) {
    return true;
  }

  return (
    digitCount > 0 &&
    /(?:#|\b(?:id|job|jr|opening|posting|ref|reference|req|requisition)\b)/i.test(
      identifier,
    )
  );
}

export function buildTailoredResumeDownloadFilename(
  record: TailoredResumeDownloadFilenameRecord,
) {
  const resolvedJobNumber = resolveTailoredResumeJobNumber(record);

  if (resolvedJobNumber) {
    const title =
      sanitizeFilenameBaseName(record.positionTitle) ||
      sanitizeFilenameBaseName(record.displayName);
    const jobNumber = sanitizeFilenameBaseName(
      normalizeJobNumberForFilename(resolvedJobNumber),
    );

    if (title && jobNumber) {
      return `${title} - ${jobNumber}.pdf`;
    }
  }

  const fallbackBaseName = sanitizeFilenameBaseName(record.displayName);

  return `${fallbackBaseName || "tailored-resume"}.pdf`;
}
