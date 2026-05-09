import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTailorResumeMalformedBulletCheckMessage,
  formatTailorResumeRenderedLineFillRatio,
  formatTailorResumeSpareBulletLineCount,
  isTailorResumeMalformedSpareBulletLine,
  readTailorResumeLastLineFillRatio,
  readTailorResumeSpareBulletLineTone,
} from "../lib/tailor-resume-spare-bullet-line-display.ts";

test("formatTailorResumeSpareBulletLineCount uses singular and plural labels", () => {
  assert.equal(formatTailorResumeSpareBulletLineCount(1), "1 line");
  assert.equal(formatTailorResumeSpareBulletLineCount(2), "2 lines");
});

test("readTailorResumeSpareBulletLineTone maps one, two, and three-plus lines", () => {
  assert.equal(readTailorResumeSpareBulletLineTone(0), "empty");
  assert.equal(readTailorResumeSpareBulletLineTone(1), "good");
  assert.equal(readTailorResumeSpareBulletLineTone(2), "warning");
  assert.equal(readTailorResumeSpareBulletLineTone(3), "danger");
  assert.equal(readTailorResumeSpareBulletLineTone(4), "danger");
});

test("isTailorResumeMalformedSpareBulletLine requires a sparse final rendered line", () => {
  assert.equal(
    isTailorResumeMalformedSpareBulletLine({
      lastLineFillRatio: 0.49,
      lineCount: 2,
    }),
    true,
  );
  assert.equal(
    isTailorResumeMalformedSpareBulletLine({
      lastLineFillRatio: 0.5,
      lineCount: 2,
    }),
    false,
  );
  assert.equal(
    isTailorResumeMalformedSpareBulletLine({
      lastLineFillRatio: 0.1,
      lineCount: 1,
    }),
    false,
  );
  assert.equal(
    isTailorResumeMalformedSpareBulletLine({
      lastLineFillRatio: null,
      lineCount: 2,
    }),
    false,
  );
});

test("readTailorResumeLastLineFillRatio compares the final rendered line to previous lines", () => {
  assert.equal(readTailorResumeLastLineFillRatio([100]), null);
  assert.equal(readTailorResumeLastLineFillRatio([100, 40]), 0.4);
  assert.equal(readTailorResumeLastLineFillRatio([70, 100, 60]), 0.6);
});

test("rendered bullet shape messages are shared by chat tools and health checks", () => {
  assert.equal(formatTailorResumeRenderedLineFillRatio(null), "unknown");
  assert.equal(formatTailorResumeRenderedLineFillRatio(0.421), "42%");
  assert.equal(
    formatTailorResumeMalformedBulletCheckMessage({
      lastLineFillRatio: 0.42,
      lineCount: 2,
      malformed: true,
    }),
    "Malformed. The bullet renders as 2 lines, and the final line is only 42% filled.",
  );
  assert.equal(
    formatTailorResumeMalformedBulletCheckMessage({
      lastLineFillRatio: null,
      lineCount: 1,
      malformed: false,
    }),
    "Not malformed. The bullet renders as 1 line.",
  );
});
