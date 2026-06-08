import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_CONTEXT_UNAVAILABLE_MESSAGE,
  formatPageContextErrorMessage,
  isPageContextConnectionError,
  mergeJobPageContextFrames,
} from "../extension/src/page-context.ts";
import type { JobPageContext } from "../extension/src/job-helper.ts";

function makePageContext(
  overrides: Partial<JobPageContext> = {},
): JobPageContext {
  return {
    canonicalUrl: "",
    companyCandidates: [],
    description: "",
    employmentTypeCandidates: [],
    headings: [],
    jsonLdJobPostings: [],
    locationCandidates: [],
    rawText: "",
    salaryMentions: [],
    selectionText: "",
    siteName: "",
    title: "",
    titleCandidates: [],
    topTextBlocks: [],
    url: "https://example.com/job",
    ...overrides,
  };
}

test("formats Chrome missing content-script listeners as a page capture issue", () => {
  const error = new Error(
    "Could not establish connection. Receiving end does not exist.",
  );

  assert.equal(isPageContextConnectionError(error), true);
  assert.equal(formatPageContextErrorMessage(error), PAGE_CONTEXT_UNAVAILABLE_MESSAGE);
});

test("keeps unrelated page context errors intact", () => {
  assert.equal(
    formatPageContextErrorMessage(new Error("The content script returned unusable page details.")),
    "The content script returned unusable page details.",
  );
});

test("merges embedded job frame text into the top page context", () => {
  const merged = mergeJobPageContextFrames(
    makePageContext({
      headings: ["Loading Job Application..."],
      rawText: "Loading Job Application...",
      title: "Apply | Neuralink",
      url: "https://neuralink.com/careers/apply/?gh_jid=6569010003",
    }),
    [
      makePageContext({
        headings: ["Software Engineer, Implant", "Required Qualifications:"],
        rawText:
          "Required Qualifications: Fluent in Python and C or Rust. Experience with Linux/Unix systems and command line.",
        titleCandidates: ["Software Engineer, Implant"],
        topTextBlocks: [
          "Required Qualifications: Fluent in Python and C or Rust.",
        ],
        url: "https://job-boards.greenhouse.io/embed/job_app?token=6569010003",
      }),
    ],
  );

  assert.equal(
    merged.url,
    "https://neuralink.com/careers/apply/?gh_jid=6569010003",
  );
  assert.match(merged.rawText, /Loading Job Application/);
  assert.match(merged.rawText, /Fluent in Python and C or Rust/);
  assert.deepEqual(merged.titleCandidates, ["Software Engineer, Implant"]);
  assert.deepEqual(merged.headings, [
    "Loading Job Application...",
    "Software Engineer, Implant",
    "Required Qualifications:",
  ]);
});
