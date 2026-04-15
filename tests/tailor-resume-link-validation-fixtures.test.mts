import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  extractResumeLatexLinks,
  validateTailorResumeLink,
} from "../lib/tailor-resume-link-validation.ts";

const linksExpectedToPass = [
  "mailto:HenryMDeutsch@gmail.com",
  "tel:9142725561",
  "https://github.com/henry-md",
  "https://henry-deutsch.com",
  "https://devpost.com/software/check-it-out",
] as const;

const linksExpectedNotToPass = [
  "https://linkedin.com/in/henry-deutsch",
  "https://chiefoffd.com/",
  "https://github.com/henry-mdd",
] as const;

function readUniqueExampleLinks() {
  return [...new Set(extractResumeLatexLinks(tailorResumeLatexExample).map((link) => link.url))];
}

test("fixture lists cover every unique link from tailorResumeLatexExample", () => {
  const exampleLinks = readUniqueExampleLinks();
  const classifiedLinks = [...linksExpectedToPass, ...linksExpectedNotToPass];

  assert.equal(new Set(classifiedLinks).size, classifiedLinks.length);

  for (const exampleLink of exampleLinks) {
    assert.ok(
      classifiedLinks.includes(exampleLink),
      `${exampleLink} is present in tailorResumeLatexExample but missing from the test fixture lists.`,
    );
  }
});

test("links expected to pass do pass validation", async () => {
  for (const url of linksExpectedToPass) {
    const result = await validateTailorResumeLink({
      displayText: null,
      url,
    });

    assert.equal(
      result.outcome,
      "passed",
      `${url} should have passed validation, but returned ${result.outcome}${result.reason ? `: ${result.reason}` : "."}`,
    );
  }
});

test("links expected not to pass do not pass validation", async () => {
  for (const url of linksExpectedNotToPass) {
    const result = await validateTailorResumeLink({
      displayText: null,
      url,
    });

    assert.notEqual(
      result.outcome,
      "passed",
      `${url} unexpectedly passed validation.`,
    );
  }
});
