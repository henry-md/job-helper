import type {
  TailorResumeLayoutMeasurement,
  TailorResumeSegmentLineMeasurement,
} from "./tailor-resume-layout-measurement.ts";
import {
  formatTailorResumeRenderedLineFillRatio,
  isTailorResumeMalformedRenderedLineShape,
  readTailorResumeLastLineFillRatio,
  tailorResumeMalformedBulletDefinition,
} from "./tailor-resume-spare-bullet-line-display.ts";

export type TailorResumeRenderedBulletLineCheck = {
  changedByCandidate: boolean;
  lastLineFillRatio: number | null;
  lineCount: number;
  malformed: boolean;
  pageNumbers: number[];
  segmentId: string;
  textSnippet: string;
};

export type TailorResumeRenderedBulletHealthCheck = {
  malformedBullets: TailorResumeRenderedBulletLineCheck[];
  pageCount: number;
  requestedLineCounts: TailorResumeRenderedBulletLineCheck[];
  warnings: string[];
};

function truncateRenderedBulletSnippet(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177).trimEnd()}...`;
}

function buildRenderedBulletLineCheck(input: {
  changedSegmentIds: ReadonlySet<string>;
  segment: TailorResumeSegmentLineMeasurement;
}): TailorResumeRenderedBulletLineCheck {
  const lastLineFillRatio = readTailorResumeLastLineFillRatio(
    input.segment.lines.map((line) => line.width),
  );

  return {
    changedByCandidate: input.changedSegmentIds.has(input.segment.segmentId),
    lastLineFillRatio,
    lineCount: input.segment.lineCount,
    malformed: isTailorResumeMalformedRenderedLineShape({
      lastLineFillRatio,
      lineCount: input.segment.lineCount,
    }),
    pageNumbers: input.segment.pageNumbers,
    segmentId: input.segment.segmentId,
    textSnippet: truncateRenderedBulletSnippet(input.segment.plainText),
  };
}

export function formatTailorResumeMalformedBulletWarning(
  check: TailorResumeRenderedBulletLineCheck,
) {
  return [
    `${check.segmentId} renders as ${check.lineCount} lines`,
    `with the final line only ${formatTailorResumeRenderedLineFillRatio(
      check.lastLineFillRatio,
    )} filled.`,
    check.changedByCandidate
      ? "This candidate edit created or preserves the malformed shape."
      : "This malformed shape is elsewhere in the rendered resume.",
    `Text: ${check.textSnippet}`,
  ].join(" ");
}

// Summarizes rendered bullet line shape for the model's Step 4 self-check.
export function buildTailorResumeRenderedBulletHealthCheck(input: {
  changedSegmentIds: ReadonlySet<string>;
  layout: TailorResumeLayoutMeasurement;
  requestedLineCountSegmentIds?: ReadonlySet<string>;
}): TailorResumeRenderedBulletHealthCheck {
  const bulletChecks = input.layout.segments
    .filter((segment) => segment.command === "resumeitem")
    .map((segment) =>
      buildRenderedBulletLineCheck({
        changedSegmentIds: input.changedSegmentIds,
        segment,
      }),
    );
  const malformedBullets = bulletChecks.filter((check) => check.malformed);

  return {
    malformedBullets,
    pageCount: input.layout.pageCount,
    requestedLineCounts: input.requestedLineCountSegmentIds
      ? bulletChecks.filter((check) =>
          input.requestedLineCountSegmentIds?.has(check.segmentId),
        )
      : [],
    warnings: malformedBullets.map(formatTailorResumeMalformedBulletWarning),
  };
}

export function formatTailorResumeChangedMalformedBulletError(
  healthCheck: TailorResumeRenderedBulletHealthCheck,
) {
  const changedMalformedBullets = healthCheck.malformedBullets.filter(
    (check) => check.changedByCandidate,
  );

  if (changedMalformedBullets.length === 0) {
    return null;
  }

  return [
    "The Step 4 implementation produced malformed rendered bullets.",
    tailorResumeMalformedBulletDefinition,
    "Revise the affected block replacements so each final line is meaningfully filled or the bullet fits on fewer lines.",
    ...changedMalformedBullets.map(
      (check) => `- ${formatTailorResumeMalformedBulletWarning(check)}`,
    ),
  ].join("\n");
}
