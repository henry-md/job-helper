import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailoredResumeDownloadFilename,
  looksLikeTailoredResumeJobNumber,
} from "../lib/tailored-resume-download-filename.ts";

test("buildTailoredResumeDownloadFilename prefers job title and job number", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      displayName: "OpenAI - Research Engineer",
      jobDescription: "",
      jobIdentifier: "REQ-12345",
      positionTitle: "Research Engineer",
    }),
    "Research Engineer - REQ-12345.pdf",
  );
});

test("buildTailoredResumeDownloadFilename falls back to display name without a job number", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      displayName: "OpenAI - Research Engineer",
      jobDescription: "",
      jobIdentifier: "Applied research",
      positionTitle: "Research Engineer",
    }),
    "OpenAI - Research Engineer.pdf",
  );
});

test("buildTailoredResumeDownloadFilename sanitizes job-number filenames", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      displayName: "Acme - Senior Engineer / ML",
      jobDescription: "",
      jobIdentifier: "Job ID: 24",
      positionTitle: "Senior Engineer / ML",
    }),
    "Senior Engineer - ML - 24.pdf",
  );
});

test("buildTailoredResumeDownloadFilename can use a job number from the description", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      displayName: "OpenAI - Research Engineer",
      jobDescription:
        "Research Engineer, Applied AI. Job ID: 98765. The team builds evaluation infrastructure.",
      jobIdentifier: "Applied AI",
      positionTitle: "Research Engineer",
    }),
    "Research Engineer - 98765.pdf",
  );
});

test("looksLikeTailoredResumeJobNumber accepts common job id shapes", () => {
  assert.equal(looksLikeTailoredResumeJobNumber("123456"), true);
  assert.equal(looksLikeTailoredResumeJobNumber("JR-42"), true);
  assert.equal(looksLikeTailoredResumeJobNumber("#42"), true);
  assert.equal(looksLikeTailoredResumeJobNumber("Team 2"), false);
  assert.equal(looksLikeTailoredResumeJobNumber("General"), false);
});
