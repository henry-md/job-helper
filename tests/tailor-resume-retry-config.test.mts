import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRetryAttemptsToGenerateLatexEdits,
  defaultRetryAttemptsToGenerateLatexFromPdf,
  defaultRetryAttemptsToGeneratePageCountCompaction,
  defaultRetryAttemptsForTransientModelErrors,
  getRetryAttemptsToGenerateLatexEdits,
  getRetryAttemptsToGenerateLatexFromPdf,
  getRetryAttemptsToGeneratePageCountCompaction,
  getRetryAttemptsForTransientModelErrors,
} from "../lib/tailor-resume-retry-config.ts";

test("retry attempt helpers fall back to defaults when env vars are missing", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
  const previousTransientValue =
    process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;

  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  delete process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
  delete process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;

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
    assert.equal(
      getRetryAttemptsForTransientModelErrors(),
      defaultRetryAttemptsForTransientModelErrors,
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

    if (typeof previousTransientValue === "string") {
      process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS =
        previousTransientValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;
    }
  }
});

test("retry attempt helpers read valid positive integers from env", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
  const previousTransientValue =
    process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "5";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "4";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "6";
  process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS = "7";

  try {
    assert.equal(getRetryAttemptsToGenerateLatexFromPdf(), 5);
    assert.equal(getRetryAttemptsToGenerateLatexEdits(), 4);
    assert.equal(getRetryAttemptsToGeneratePageCountCompaction(), 6);
    assert.equal(getRetryAttemptsForTransientModelErrors(), 7);
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

    if (typeof previousTransientValue === "string") {
      process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS =
        previousTransientValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;
    }
  }
});

test("retry attempt helpers ignore invalid env values", () => {
  const previousPdfValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF;
  const previousEditsValue = process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS;
  const previousCompactionValue =
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION;
  const previousTransientValue =
    process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;

  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF = "0";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS = "abc";
  process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION = "-2";
  process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS = "0";

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
    assert.equal(
      getRetryAttemptsForTransientModelErrors(),
      defaultRetryAttemptsForTransientModelErrors,
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

    if (typeof previousTransientValue === "string") {
      process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS =
        previousTransientValue;
    } else {
      delete process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS;
    }
  }
});
