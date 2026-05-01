export type JobApplicationDisplayParts = {
  companyName: string;
  positionName: string;
};

function cleanDisplayText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleTextPattern(value: string) {
  return escapeRegExp(value).replace(/\s+/g, "\\s+");
}

function areSameDisplayText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function stripCompanyNameFromJobTitle(input: {
  companyName: string | null | undefined;
  jobTitle: string | null | undefined;
}) {
  const companyName = cleanDisplayText(input.companyName);
  const jobTitle = cleanDisplayText(input.jobTitle);

  if (!companyName || !jobTitle) {
    return jobTitle;
  }

  const companyPattern = buildFlexibleTextPattern(companyName);
  const prefixMatch = jobTitle.match(
    new RegExp(`^${companyPattern}\\s*(?:-|\\u2013|\\u2014|:|\\|)\\s*(.+)$`, "i"),
  );

  if (prefixMatch?.[1]) {
    return cleanDisplayText(prefixMatch[1]);
  }

  const atSuffixMatch = jobTitle.match(
    new RegExp(`^(.+?)\\s+at\\s+${companyPattern}$`, "i"),
  );

  if (atSuffixMatch?.[1]) {
    return cleanDisplayText(atSuffixMatch[1]);
  }

  const separatorSuffixMatch = jobTitle.match(
    new RegExp(`^(.+?)\\s*(?:-|\\u2013|\\u2014|\\|)\\s*${companyPattern}$`, "i"),
  );

  if (separatorSuffixMatch?.[1]) {
    return cleanDisplayText(separatorSuffixMatch[1]);
  }

  return jobTitle;
}

export function buildJobApplicationDisplayParts(input: {
  companyName: string | null | undefined;
  jobTitle: string | null | undefined;
}): JobApplicationDisplayParts {
  const companyName = cleanDisplayText(input.companyName);
  const jobTitle = cleanDisplayText(input.jobTitle);
  const strippedJobTitle = stripCompanyNameFromJobTitle({
    companyName,
    jobTitle,
  });
  const hasDistinctJobTitle =
    strippedJobTitle && !areSameDisplayText(strippedJobTitle, companyName);

  return {
    companyName: companyName || jobTitle || "Application",
    positionName: companyName && hasDistinctJobTitle ? strippedJobTitle : "Application",
  };
}
