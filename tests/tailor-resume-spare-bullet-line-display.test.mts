import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTailorResumeSpareBulletLineCount,
  isTailorResumeMalformedSpareBulletLine,
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
