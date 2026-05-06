import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTailoredResumeBadgeTargetUrls,
  tailoredResumeBadgeTargetMatchesTabUrl,
} from "../extension/src/tailored-resume-badge-targets.ts";

test("matches a badge target against the same exact job URL", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123?job=abc",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/123?job=abc#overview",
      targetUrls,
    }),
    true,
  );
});

test("does not match when query params differ", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123?job=abc",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/123?job=abc&utm_source=extension",
      targetUrls,
    }),
    false,
  );
});

test("does not match nested apply pages back to the saved job URL", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/123/apply?source=extension",
      targetUrls,
    }),
    false,
  );
});

test("ignores non-url registry tombstones and unrelated tabs", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "tab:123",
    "https://jobs.example.com/roles/123",
  ]);

  assert.deepEqual(targetUrls, ["https://jobs.example.com/roles/123"]);
  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/456",
      targetUrls,
    }),
    false,
  );
});

test("does not match neighboring job URLs that merely share a prefix", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/1234",
      targetUrls,
    }),
    false,
  );
});
