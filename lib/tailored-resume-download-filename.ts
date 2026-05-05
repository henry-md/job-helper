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

  return `${companyName} Resume.pdf`;
}

export const buildCompanyResumeDownloadName =
  buildTailoredResumeDownloadFilename;
