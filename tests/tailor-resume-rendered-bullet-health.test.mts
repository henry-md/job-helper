import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumeRenderedBulletHealthCheck,
  formatTailorResumeChangedMalformedBulletError,
} from "../lib/tailor-resume-rendered-bullet-health.ts";
import type { TailorResumeLayoutMeasurement } from "../lib/tailor-resume-layout-measurement.ts";

function buildLayoutFixture(): TailorResumeLayoutMeasurement {
  return {
    pageCount: 1,
    pdfBuffer: Buffer.from(""),
    sections: [],
    segments: [
      {
        command: "resumeitem",
        lineCount: 2,
        lines: [
          { left: 0, pageNumber: 1, right: 100, width: 100 },
          { left: 0, pageNumber: 1, right: 34, width: 34 },
        ],
        pageNumbers: [1],
        plainText:
          "Built the platform automation, but left a very short final line.",
        segmentId: "experience.1.bullet-1",
      },
      {
        command: "resumeitem",
        lineCount: 2,
        lines: [
          { left: 0, pageNumber: 1, right: 100, width: 100 },
          { left: 0, pageNumber: 1, right: 76, width: 76 },
        ],
        pageNumbers: [1],
        plainText: "Built a healthy two-line bullet with a filled final line.",
        segmentId: "experience.1.bullet-2",
      },
    ],
    unmatchedSegmentIds: [],
  };
}

test("rendered bullet health reports all malformed bullets but only requested line counts", () => {
  const healthCheck = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds: new Set(["experience.1.bullet-2"]),
    layout: buildLayoutFixture(),
    requestedLineCountSegmentIds: new Set(["experience.1.bullet-2"]),
  });

  assert.deepEqual(
    healthCheck.malformedBullets.map((bullet) => bullet.segmentId),
    ["experience.1.bullet-1"],
  );
  assert.deepEqual(
    healthCheck.requestedLineCounts.map((bullet) => bullet.segmentId),
    ["experience.1.bullet-2"],
  );
  assert.equal(healthCheck.requestedLineCounts[0]?.lineCount, 2);
});

test("rendered bullet health errors only when a changed bullet is malformed", () => {
  const preExistingHealthCheck = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds: new Set(["experience.1.bullet-2"]),
    layout: buildLayoutFixture(),
  });

  assert.equal(
    formatTailorResumeChangedMalformedBulletError(preExistingHealthCheck),
    null,
  );

  const changedHealthCheck = buildTailorResumeRenderedBulletHealthCheck({
    changedSegmentIds: new Set(["experience.1.bullet-1"]),
    layout: buildLayoutFixture(),
  });

  assert.match(
    formatTailorResumeChangedMalformedBulletError(changedHealthCheck) ?? "",
    /malformed rendered bullets/i,
  );
});
