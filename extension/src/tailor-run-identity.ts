export type TailorRunIdentityDisplay = {
  label: string;
  title: string;
};

function cleanIdentityText(value: string | null | undefined) {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();
  return normalizedValue || null;
}

function normalizeTailorRunComparableUrl(value: string | null | undefined) {
  const trimmedValue = cleanIdentityText(value);

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    parsedUrl.hash = "";
    parsedUrl.search = "";
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}

export function readTailorRunDisplayUrl(value: string | null | undefined) {
  const trimmedValue = cleanIdentityText(value);

  if (!trimmedValue) {
    return null;
  }

  try {
    const normalizedUrl = normalizeTailorRunComparableUrl(trimmedValue);

    if (!normalizedUrl) {
      return trimmedValue;
    }

    const parsedUrl = new URL(normalizedUrl);
    return `${parsedUrl.host}${parsedUrl.pathname}`;
  } catch {
    return trimmedValue;
  }
}

export function buildTailorRunIdentityDisplay(input: {
  companyName: string | null | undefined;
  positionTitle: string | null | undefined;
}): TailorRunIdentityDisplay | null {
  const companyName = cleanIdentityText(input.companyName);
  const positionTitle = cleanIdentityText(input.positionTitle);

  if (!companyName && !positionTitle) {
    return null;
  }

  const label =
    companyName && positionTitle
      ? `${companyName} \u2014 ${positionTitle}`
      : companyName || positionTitle || "";

  return {
    label,
    title: label,
  };
}
