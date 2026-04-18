import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompactDate,
  formatCompactDateOrSameDayTime,
} from "../lib/date-format.ts";

test("formatCompactDate keeps compact month/day formatting", () => {
  assert.equal(formatCompactDate("2026-04-17T17:16:28.500"), "04/17");
  assert.equal(formatCompactDate("2026-04-17T17:16:28.500", true), "04/17/26");
});

test("formatCompactDateOrSameDayTime shows a time for same-day values", () => {
  assert.equal(
    formatCompactDateOrSameDayTime("2026-04-17T20:51:05.235", {
      now: new Date("2026-04-17T23:00:00.000"),
    }),
    "8:51 PM",
  );
});

test("formatCompactDateOrSameDayTime falls back to compact dates for older values", () => {
  assert.equal(
    formatCompactDateOrSameDayTime("2026-04-16T20:51:05.235", {
      now: new Date("2026-04-17T23:00:00.000"),
    }),
    "04/16",
  );
  assert.equal(
    formatCompactDateOrSameDayTime("2025-04-16T20:51:05.235", {
      includeYear: true,
      now: new Date("2026-04-17T23:00:00.000"),
    }),
    "04/16/25",
  );
});
