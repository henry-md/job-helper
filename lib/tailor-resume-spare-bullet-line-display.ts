export type TailorResumeSpareBulletLineTone =
  | "danger"
  | "empty"
  | "good"
  | "warning";

export type TailorResumeSpareBulletLineMeasurement = {
  lastLineFillRatio: number | null;
  lineCount: number;
  malformed: boolean;
  pageCount: number;
  targetSegmentId: string;
};

export const tailorResumeMalformedBulletDefinition =
  "A malformed bullet is any multi-line bullet whose final rendered line is less than 50% filled.";

export function formatTailorResumeSpareBulletLineCount(lineCount: number) {
  return `${lineCount.toLocaleString()} line${lineCount === 1 ? "" : "s"}`;
}

export function formatTailorResumeRenderedLineFillRatio(
  value: number | null,
) {
  return value === null ? "unknown" : `${Math.round(value * 100)}%`;
}

export function formatTailorResumeMalformedBulletCheckMessage(input: {
  lastLineFillRatio: number | null;
  lineCount: number;
  malformed: boolean;
}) {
  if (!input.malformed) {
    return `Not malformed. The bullet renders as ${formatTailorResumeSpareBulletLineCount(
      input.lineCount,
    )}.`;
  }

  return `Malformed. The bullet renders as ${formatTailorResumeSpareBulletLineCount(
    input.lineCount,
  )}, and the final line is only ${formatTailorResumeRenderedLineFillRatio(
    input.lastLineFillRatio,
  )} filled.`;
}

export function readTailorResumeSpareBulletLineTone(
  lineCount: number,
): TailorResumeSpareBulletLineTone {
  if (lineCount <= 0) {
    return "empty";
  }

  if (lineCount === 1) {
    return "good";
  }

  if (lineCount === 2) {
    return "warning";
  }

  return "danger";
}

export function readTailorResumeLastLineFillRatio(
  lineWidths: readonly number[],
) {
  if (lineWidths.length <= 1) {
    return null;
  }

  const lastLineWidth = lineWidths.at(-1);
  const widestPreviousLine = Math.max(...lineWidths.slice(0, -1));

  if (typeof lastLineWidth !== "number" || widestPreviousLine <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, lastLineWidth / widestPreviousLine));
}

export function isTailorResumeMalformedRenderedLineShape(input: {
  lastLineFillRatio: number | null;
  lineCount: number;
}) {
  return (
    input.lineCount > 1 &&
    input.lastLineFillRatio !== null &&
    input.lastLineFillRatio < 0.5
  );
}

export function isTailorResumeMalformedSpareBulletLine(input: {
  lastLineFillRatio: number | null;
  lineCount: number;
}) {
  return isTailorResumeMalformedRenderedLineShape(input);
}
