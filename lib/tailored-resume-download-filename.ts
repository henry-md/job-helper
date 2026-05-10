type TailoredResumeDownloadFilenameRecord = {
  companyName?: string | null;
  displayName?: string | null;
};

function collapseWhitespace(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function sanitizeResumeDownloadFilenameBase(
  value: string | null | undefined,
) {
  return collapseWhitespace(value)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/[ .-]+$/g, "");
}

function readCompanyNameFromDisplayName(value: string | null | undefined) {
  const displayName = collapseWhitespace(value);

  if (!displayName) {
    return "";
  }

  const dashMatch = displayName.match(/^(.+?)\s+-\s+.+$/);

  if (dashMatch?.[1]) {
    return dashMatch[1];
  }

  const resumeFilenameMatch = displayName.match(/^(.+?)\s+Resume(?:\.pdf)?$/i);

  if (resumeFilenameMatch?.[1]) {
    return resumeFilenameMatch[1];
  }

  const pdfFilenameMatch = displayName.match(/^(.+?)\.pdf$/i);

  if (pdfFilenameMatch?.[1]) {
    return pdfFilenameMatch[1];
  }

  const atMatch = displayName.match(/^.+?\s+at\s+(.+)$/i);

  return atMatch?.[1] ?? displayName;
}

export function buildTailoredResumeDownloadFilename(
  record: TailoredResumeDownloadFilenameRecord,
) {
  const companyName =
    sanitizeResumeDownloadFilenameBase(record.companyName) ||
    sanitizeResumeDownloadFilenameBase(
      readCompanyNameFromDisplayName(record.displayName),
    ) ||
    "Tailored";

  return `${companyName}.pdf`;
}

export function buildUniqueTailoredResumeDownloadFilename(input: {
  existingDisplayNames: Array<string | null | undefined>;
  record: TailoredResumeDownloadFilenameRecord;
}) {
  const filename = buildTailoredResumeDownloadFilename(input.record);
  const extensionMatch = filename.match(/^(.*?)(\.pdf)$/i);
  const baseName = extensionMatch?.[1] ?? filename.replace(/\.pdf$/i, "");
  const extension = extensionMatch?.[2] ?? ".pdf";
  const existingNames = new Set(
    input.existingDisplayNames
      .map((value) => collapseWhitespace(value).toLowerCase())
      .filter(Boolean),
  );

  if (!existingNames.has(filename.toLowerCase())) {
    return filename;
  }

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${baseName} ${index}${extension}`;

    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${baseName} ${Date.now()}${extension}`;
}

export const buildCompanyResumeDownloadName =
  buildTailoredResumeDownloadFilename;
