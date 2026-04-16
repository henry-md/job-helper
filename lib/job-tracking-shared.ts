const salarySuffixMultipliers = {
  b: 1_000_000_000,
  k: 1_000,
  m: 1_000_000,
} as const;

export function normalizeCompanyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumberWithDecimalSeparator(
  value: string,
  decimalSeparator: "," | ".",
) {
  const normalizedValue =
    decimalSeparator === ","
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  const parsedValue = Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseLocalizedNumber(value: string, hasSuffix: boolean) {
  const compactValue = value.replace(/\s+/g, "");
  const commaCount = compactValue.split(",").length - 1;
  const dotCount = compactValue.split(".").length - 1;

  if (commaCount > 0 && dotCount > 0) {
    return parseNumberWithDecimalSeparator(
      compactValue,
      compactValue.lastIndexOf(",") > compactValue.lastIndexOf(".") ? "," : ".",
    );
  }

  if (commaCount > 0) {
    if (!hasSuffix && /^\d{1,3}(,\d{3})+$/.test(compactValue)) {
      return Number.parseInt(compactValue.replace(/,/g, ""), 10);
    }

    if (!hasSuffix && commaCount > 1) {
      return Number.parseInt(compactValue.replace(/,/g, ""), 10);
    }

    const fractionalLength = compactValue.length - compactValue.lastIndexOf(",") - 1;

    if (hasSuffix || fractionalLength <= 2) {
      return parseNumberWithDecimalSeparator(compactValue, ",");
    }

    return Number.parseInt(compactValue.replace(/,/g, ""), 10);
  }

  if (dotCount > 0) {
    if (!hasSuffix && /^\d{1,3}(\.\d{3})+$/.test(compactValue)) {
      return Number.parseInt(compactValue.replace(/\./g, ""), 10);
    }

    if (!hasSuffix && dotCount > 1) {
      return Number.parseInt(compactValue.replace(/\./g, ""), 10);
    }

    const fractionalLength = compactValue.length - compactValue.lastIndexOf(".") - 1;

    if (hasSuffix || fractionalLength <= 2) {
      const parsedValue = Number.parseFloat(compactValue);

      return Number.isFinite(parsedValue) ? parsedValue : null;
    }

    return Number.parseInt(compactValue.replace(/\./g, ""), 10);
  }

  const parsedValue = Number.parseFloat(compactValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function parseSalaryInteger(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  const cleanedValue = trimmedValue
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/[$€£¥₹]/g, "")
    .replace(
      /(?:usd|eur|gbp|cad|aud|nzd|chf|sek|nok|dkk|pln|czk|ron|huf|jpy|cny|inr|sgd|hkd|brl|mxn)/g,
      "",
    )
    .replace(
      /(?:perannum|annum|yearly|year|yr|\/yr|\/year|monthly|month|mo|\/mo|\/month|pa)/g,
      "",
    )
    .replace(/^(?:from|up-?to|under|over|min(?:imum)?|max(?:imum)?)/g, "")
    .replace(/[+~≈]/g, "")
    .replace(/[()]/g, "");
  const salaryMatch = cleanedValue.match(/^(\d[\d.,]*)([bkm])?$/i);

  if (!salaryMatch) {
    return null;
  }

  const numericValue = parseLocalizedNumber(salaryMatch[1], Boolean(salaryMatch[2]));

  if (numericValue === null) {
    return null;
  }

  const multiplier = salaryMatch[2]
    ? salarySuffixMultipliers[
        salaryMatch[2].toLowerCase() as keyof typeof salarySuffixMultipliers
      ]
    : 1;

  return Math.round(numericValue * multiplier);
}

export function normalizeSalaryRange(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return {
      maximum: null,
      minimum: null,
      text: null,
    };
  }

  const rangeMatch = trimmedValue.match(/^(.*?)\s*(?:to|[-–—])\s*(.*)$/i);
  const rawMinimum = rangeMatch ? rangeMatch[1] : trimmedValue;
  const rawMaximum = rangeMatch ? rangeMatch[2] : null;
  let minimum = parseSalaryInteger(rawMinimum);
  let maximum = parseSalaryInteger(rawMaximum);

  if (minimum !== null && maximum !== null && minimum > maximum) {
    [minimum, maximum] = [maximum, minimum];
  }

  if (minimum === null && maximum === null) {
    return {
      maximum: null,
      minimum: null,
      text: trimmedValue,
    };
  }

  return {
    maximum,
    minimum,
    text:
      minimum !== null && maximum !== null
        ? `${minimum} - ${maximum}`
        : String(minimum ?? maximum),
  };
}

export function resolveAppliedAt(value: string | null | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }

  return new Date();
}
