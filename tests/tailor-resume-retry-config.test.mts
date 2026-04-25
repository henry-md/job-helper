import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRetryAttemptsToGenerateLatexEdits,
  defaultRetryAttemptsToGenerateLatexFromPdf,
  defaultRetryAttemptsToGeneratePageCountCompaction,
  getRetryAttemptsToGenerateLatexEdits,
  getRetryAttemptsToGenerateLatexFromPdf,
  getRetryAttemptsToGeneratePageCountCompaction,
} from "../lib/tailor-resume-retry-config.ts";

test("retry attempt helpers fall back to defaults when env vars are missing", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  try {
    assert.equal(
      getRetryAttemptsToGenerateLatexFromPdf(),
      defaultRetryAttemptsToGenerateLatexFromPdf,
    );
    assert.equal(
      getRetryAttemptsToGenerateLatexEdits(),
      defaultRetryAttemptsToGenerateLatexEdits,
    );
    assert.equal(
      getRetryAttemptsToGeneratePageCountCompaction(),
      defaultRetryAttemptsToGeneratePageCountCompaction,
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

    if (typeof previousCompactionValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION =
        previousCompactionValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
    }
  }
});

test("retry attempt helpers read valid positive integers from env", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "5";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "4";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "6";

  try {
    assert.equal(getRetryAttemptsToGenerateLatexFromPdf(), 5);
    assert.equal(getRetryAttemptsToGenerateLatexEdits(), 4);
    assert.equal(getRetryAttemptsToGeneratePageCountCompaction(), 6);
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

    if (typeof previousCompactionValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION =
        previousCompactionValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
    }
  }
});

test("retry attempt helpers ignore invalid env values", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "0";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "abc";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "-2";

  try {
    assert.equal(
      getRetryAttemptsToGenerateLatexFromPdf(),
      defaultRetryAttemptsToGenerateLatexFromPdf,
    );
    assert.equal(
      getRetryAttemptsToGenerateLatexEdits(),
      defaultRetryAttemptsToGenerateLatexEdits,
    );
    assert.equal(
      getRetryAttemptsToGeneratePageCountCompaction(),
      defaultRetryAttemptsToGeneratePageCountCompaction,
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

    if (typeof previousCompactionValue === "string") {
      process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION =
        previousCompactionValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
    }
  }
});
