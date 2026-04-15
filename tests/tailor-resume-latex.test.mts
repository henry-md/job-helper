import test from "node:test";
import assert from "node:assert/strict";
import { renderTailorResumeLatex } from "../lib/tailor-resume-latex.ts";
import { henryDeutschExpectedLatex } from "./fixtures/tailor-resume/henry-deutsch-latex.ts";
import { henryDeutschSourceDocument } from "./fixtures/tailor-resume/henry-deutsch-source.ts";

test("renderTailorResumeLatex matches the Henry Deutsch reference LaTeX exactly", () => {
  const actualLatex = renderTailorResumeLatex(henryDeutschSourceDocument);

  assert.equal(actualLatex, henryDeutschExpectedLatex);
});
