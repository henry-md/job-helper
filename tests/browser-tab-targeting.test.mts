import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingCurrentWindowTabForUrl,
  normalizeExactTabMatchUrl,
  readExactComparableTabUrl,
} from "../extension/src/browser-tab-targeting.ts";

test("normalizeExactTabMatchUrl preserves query params while dropping hashes", () => {
  assert.equal(
    normalizeExactTabMatchUrl(
      "https://jobhelper.app/dashboard/?tailoredResumeId=resume_123&tab=tailor#review",
    ),
    "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_123",
  );
});

test("findMatchingCurrentWindowTabForUrl requires an exact dashboard query match", () => {
  const tabs = [
    {
      active: false,
      id: 12,
      url: "https://jobhelper.app/dashboard?tab=tailor",
    },
    {
      active: true,
      id: 14,
      url: "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_123",
    },
  ];

  assert.equal(
    findMatchingCurrentWindowTabForUrl(
      tabs,
      "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_123",
    )?.id,
    14,
  );
});

test("findMatchingCurrentWindowTabForUrl prefers a pendingUrl match", () => {
  const tab = {
    active: false,
    id: 9,
    pendingUrl:
      "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_999",
    url: "chrome://newtab/",
  };

  assert.equal(
    readExactComparableTabUrl(tab),
    "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_999",
  );
});

test("findMatchingCurrentWindowTabForUrl prefers the active tab when duplicates exist", () => {
  const tabs = [
    {
      active: false,
      id: 21,
      url: "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_123",
    },
    {
      active: true,
      id: 22,
      url: "https://jobhelper.app/dashboard?tailoredResumeId=resume_123&tab=tailor",
    },
  ];

  assert.equal(
    findMatchingCurrentWindowTabForUrl(
      tabs,
      "https://jobhelper.app/dashboard?tab=tailor&tailoredResumeId=resume_123",
    )?.id,
    22,
  );
});
