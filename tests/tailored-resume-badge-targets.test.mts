import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTailoredResumeBadgeTargetUrls,
  tailoredResumeBadgeTargetMatchesTabUrl,
} from "../extension/src/tailored-resume-badge-targets.ts";

test("matches a badge target against the same job page after query cleanup", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123?utm_campaign=saved",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/123?utm_source=extension#overview",
      targetUrls,
    }),
    true,
  );
});

test("matches nested apply pages back to the saved job URL", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://jobs.example.com/roles/123",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl: "https://jobs.example.com/roles/123/apply?source=extension",
      targetUrls,
    }),
    true,
  );
});

test("matches Workday aliases when hiding a stale badge", () => {
  const targetUrls = normalizeTailoredResumeBadgeTargetUrls([
    "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160036",
  ]);

  assert.equal(
    tailoredResumeBadgeTargetMatchesTabUrl({
      tabUrl:
        "https://pae.wd1.myworkdayjobs.com/en-US/2/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?source=extension",
      targetUrls,
    }),
    true,
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
