function getValidDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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

export function formatCompactDateOrSameDayTime(
  value: string,
  options?: {
    includeYear?: boolean;
    now?: Date;
  },
) {
  const date = getValidDate(value);

  if (!date) {
    return value;
  }

  const now = options?.now ?? new Date();

  if (isSameLocalDay(date, now)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return formatCompactDate(value, options?.includeYear ?? false);
}
