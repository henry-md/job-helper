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

export function formatTailorResumeSpareBulletLineCount(lineCount: number) {
  return `${lineCount.toLocaleString()} line${lineCount === 1 ? "" : "s"}`;
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

export function isTailorResumeMalformedSpareBulletLine(input: {
  lastLineFillRatio: number | null;
  lineCount: number;
}) {
  return (
    input.lineCount > 1 &&
    input.lastLineFillRatio !== null &&
    input.lastLineFillRatio < 0.5
  );
}
