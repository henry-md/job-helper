import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTailorResumeActualLatexError,
  formatTailorResumeLatexError,
} from "../lib/tailor-resume-error-format.ts";

test("extractTailorResumeActualLatexError unwraps the last validation error", () => {
  const wrappedError =
    "Unable to produce a compilable LaTeX resume after 3 attempts.\n\n" +
    "Last validation error:\n" +
    "resume.tex:137: LaTeX Error: Unicode character (U+FFFE) not set up for use with LaTeX.";

  assert.equal(
    extractTailorResumeActualLatexError(wrappedError),
    "resume.tex:137: LaTeX Error: Unicode character (U+FFFE) not set up for use with LaTeX.",
  );
});

test("formatTailorResumeLatexError abbreviates long block errors", () => {
  const formattedError = formatTailorResumeLatexError(
    [
      "resume.tex:31: Undefined control sequence.",
      "l.31 \\badcommand",
      "! Extra alignment tab has been changed to \\cr.",
      "l.42 ... & too many columns",
      "See the LaTeX manual for more details.",
    ].join("\n"),
    {
      maxChars: 90,
      maxLines: 2,
    },
  );

  assert.equal(
    formattedError.actualMessage,
    [
      "resume.tex:31: Undefined control sequence.",
      "l.31 \\badcommand",
      "! Extra alignment tab has been changed to \\cr.",
      "l.42 ... & too many columns",
      "See the LaTeX manual for more details.",
    ].join("\n"),
  );
  assert.equal(formattedError.wasTruncated, true);
  assert.match(formattedError.displayMessage, /resume\.tex:31: Undefined control sequence\./);
  assert.match(formattedError.displayMessage, /l\.31 \\badcommand/);
  assert.match(formattedError.displayMessage, /\n…$/);
});

test("formatTailorResumeLatexError abbreviates inline errors on one line", () => {
  const formattedError = formatTailorResumeLatexError(
    "Validated 4 extracted links, and 2 failed.\n- https://example.com/a: bad\n- https://example.com/b: bad",
    {
      maxChars: 48,
      singleLine: true,
    },
  );

  assert.equal(formattedError.wasTruncated, true);
  assert.equal(formattedError.displayMessage.includes("\n"), false);
  assert.match(formattedError.displayMessage, /^Validated 4 extracted links, and 2 failed/);
  assert.match(formattedError.displayMessage, /…$/);
});
