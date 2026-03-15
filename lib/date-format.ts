function getValidDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function shouldIncludeShortYear(values: string[]) {
  const years = new Set<number>();

  for (const value of values) {
    const date = getValidDate(value);

    if (date) {
      years.add(date.getFullYear());
    }
  }

  return years.size > 1;
}

export function formatCompactDate(value: string, includeYear = false) {
  const date = getValidDate(value);

  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    ...(includeYear ? { year: "2-digit" } : {}),
  }).format(date);
}
