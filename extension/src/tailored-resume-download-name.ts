type TailoredResumeDownloadNameRecord = {
  companyName?: string | null;
  displayName?: string | null;
};

function cleanFilenameText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function sanitizeResumeDownloadFilenameBase(
  value: string | null | undefined,
) {
  return cleanFilenameText(value)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/[ .-]+$/g, "");
}

function readCompanyNameFromDisplayName(value: string | null | undefined) {
  const displayName = cleanFilenameText(value);

  if (!displayName) {
    return "";
  }

  const dashMatch = displayName.match(/^(.+?)\s+-\s+.+$/);

  if (dashMatch?.[1]) {
    return dashMatch[1];
  }

  const atMatch = displayName.match(/^.+?\s+at\s+(.+)$/i);

  return atMatch?.[1] ?? displayName;
}

export function buildCompanyResumeDownloadName(
  record: TailoredResumeDownloadNameRecord | null | undefined,
) {
  const companyName =
    sanitizeResumeDownloadFilenameBase(record?.companyName) ||
    sanitizeResumeDownloadFilenameBase(
      readCompanyNameFromDisplayName(record?.displayName),
    ) ||
    "Tailored";

  return `${companyName} Resume.pdf`;
}
