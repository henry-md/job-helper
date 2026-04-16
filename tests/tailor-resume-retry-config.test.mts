import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRetryAttemptsToGenerateLatexEdits,
  defaultRetryAttemptsToGenerateLatexFromPdf,
  getRetryAttemptsToGenerateLatexEdits,
  getRetryAttemptsToGenerateLatexFromPdf,
} from "../lib/tailor-resume-retry-config.ts";

test("retry attempt helpers fall back to defaults when env vars are missing", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;

  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;

  try {
    assert.equal(
      getRetryAttemptsToGenerateLatexFromPdf(),
      defaultRetryAttemptsToGenerateLatexFromPdf,
    );
    assert.equal(
      getRetryAttemptsToGenerateLatexEdits(),
      defaultRetryAttemptsToGenerateLatexEdits,
    );
  } finally {
    if (typeof previousPdfValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = previousPdfValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
    }

    if (typeof previousEditsValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = previousEditsValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
    }
  }
});

test("retry attempt helpers read valid positive integers from env", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "5";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "4";

  try {
    assert.equal(getRetryAttemptsToGenerateLatexFromPdf(), 5);
    assert.equal(getRetryAttemptsToGenerateLatexEdits(), 4);
  } finally {
    if (typeof previousPdfValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = previousPdfValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
    }

    if (typeof previousEditsValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = previousEditsValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
    }
  }
});

test("retry attempt helpers ignore invalid env values", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "0";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "abc";

  try {
    assert.equal(
      getRetryAttemptsToGenerateLatexFromPdf(),
      defaultRetryAttemptsToGenerateLatexFromPdf,
    );
    assert.equal(
      getRetryAttemptsToGenerateLatexEdits(),
      defaultRetryAttemptsToGenerateLatexEdits,
    );
  } finally {
    if (typeof previousPdfValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = previousPdfValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
    }

    if (typeof previousEditsValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = previousEditsValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
    }
  }
});
