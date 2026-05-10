import assert from "node:assert/strict";
import test from "node:test";
import { buildTailoredResumeDownloadFilename } from "../lib/tailored-resume-download-filename.ts";

test("buildTailoredResumeDownloadFilename uses only the company name", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      companyName: "Palantir",
      displayName: "Forward Deployed Engineer at Palantir",
    }),
    "Palantir.pdf",
  );
});

test("buildTailoredResumeDownloadFilename can infer company from display name", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      companyName: "",
      displayName: "Acme/AI - Senior Product Engineer",
    }),
    "Acme-AI.pdf",
  );
  assert.equal(
    buildTailoredResumeDownloadFilename({
      companyName: "",
      displayName: "Palantir Resume.pdf",
    }),
    "Palantir.pdf",
  );
  assert.equal(
    buildTailoredResumeDownloadFilename({
      companyName: "",
      displayName: "Palantir.pdf",
    }),
    "Palantir.pdf",
  );
});

test("buildTailoredResumeDownloadFilename never includes job identifiers", () => {
  assert.equal(
    buildTailoredResumeDownloadFilename({
      companyName: "OpenAI",
      displayName: "Research Engineer - REQ-12345",
    }),
    "OpenAI.pdf",
  );
});
