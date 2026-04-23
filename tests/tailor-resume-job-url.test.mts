import assert from "node:assert/strict";
import test from "node:test";
import {
  findTailoredResumeByJobUrl,
  normalizeTailorResumeJobUrl,
  readTailorResumeJobUrlFromDescription,
} from "../lib/tailor-resume-job-url.ts";
import type { TailoredResumeRecord } from "../lib/tailor-resume-types.ts";

function buildTailoredResume(
  overrides: Partial<TailoredResumeRecord>,
): TailoredResumeRecord {
  return {
    annotatedLatexCode: "% annotated",
    companyName: "OpenAI",
    createdAt: "2026-04-20T12:00:00.000Z",
    displayName: "OpenAI - Research Engineer",
    edits: [],
    error: null,
    id: overrides.id ?? "tailored-1",
    jobDescription: "Role text",
    jobIdentifier: "Research Engineer",
    jobUrl: overrides.jobUrl ?? "https://jobs.example.com/roles/123",
    latexCode: "\\documentclass{article}",
    openAiDebug: {
      implementation: {
        outputJson: "{}",
        prompt: "impl",
        skippedReason: null,
      },
      planning: {
        outputJson: "{}",
        prompt: "plan",
        skippedReason: null,
      },
    },
    pdfUpdatedAt: "2026-04-20T12:00:00.000Z",
    planningResult: {
      changes: [],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "Research Engineer",
      positionTitle: "Research Engineer",
      questioningSummary: null,
      thesis: {
        jobDescriptionFocus: "Focus",
        resumeChanges: "Changes",
      },
    },
    positionTitle: "Research Engineer",
    sourceAnnotatedLatexCode: null,
    status: "ready",
    thesis: {
      jobDescriptionFocus: "Focus",
      resumeChanges: "Changes",
    },
    updatedAt: "2026-04-20T12:00:00.000Z",
  };
}

test("normalizeTailorResumeJobUrl removes hash and sorts query params", () => {
  assert.equal(
    normalizeTailorResumeJobUrl(
      "HTTPS://Jobs.Example.com/roles/123/?b=2&utm_source=email&a=1#apply",
    ),
    "https://jobs.example.com/roles/123?a=1&b=2",
  );
});

test("readTailorResumeJobUrlFromDescription prefers canonical URL lines", () => {
  assert.equal(
    readTailorResumeJobUrlFromDescription(
      [
        "Job page summary:",
        "URL: https://jobs.example.com/roles/123?utm=sidepanel",
        "Canonical URL: https://jobs.example.com/roles/123",
      ].join("\n"),
    ),
    "https://jobs.example.com/roles/123",
  );
});

test("findTailoredResumeByJobUrl matches normalized saved job URLs", () => {
  const records = [
    buildTailoredResume({
      id: "first",
      jobUrl: "https://jobs.example.com/roles/first",
    }),
    buildTailoredResume({
      id: "matching",
      jobUrl: "https://jobs.example.com/roles/123?b=2&a=1",
    }),
  ];

  assert.equal(
    findTailoredResumeByJobUrl(
      records,
      "https://jobs.example.com/roles/123/?a=1&b=2#details",
    )?.id,
    "matching",
  );
});
