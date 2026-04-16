import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResumeLatexInstructions,
  buildResumeRetryInput,
} from "../lib/tailor-resume-extraction-request.ts";

test("retry request builders include the original file, prior latex, exact error, and anti-cropping guidance", () => {
  const instructions = buildResumeLatexInstructions({
    attempt: 2,
    maxAttempts: 3,
  });
  const retryInput = buildResumeRetryInput(
    {
      buffer: Buffer.from("%PDF-1.4 mock resume"),
      filename: "resume.pdf",
      mimeType: "application/pdf",
    },
    "file_123",
    {
      embeddedPdfLinks: [],
      knownLinks: [],
    },
    {
      attempt: 1,
      error: "resume.tex:42: Undefined control sequence.",
      failedLinks: [],
      linkSummary: null,
      previousLatexCode: "bad draft",
      previousModelOutput: null,
      previousResumeLinks: [
        {
          label: "Portfolio",
          url: "https://example.com/portfolio",
        },
      ],
      remainingAttempts: 2,
      retryType: "validation_failure",
    },
  );

  assert.match(instructions, /Retry attempt 2 of 3:/);
  assert.match(instructions, /Treat that prior LaTeX as the draft to edit surgically/);
  assert.match(
    instructions,
    /Never return only the changed snippets, never return a partial document/,
  );
  assert.match(
    instructions,
    /Preserve the full text of every bullet and every sentence from the source resume/,
  );

  assert.ok(Array.isArray(retryInput));
  assert.equal(retryInput.length, 1);
  assert.equal(retryInput[0]?.role, "user");

  const retryContent = Array.isArray(retryInput[0]?.content)
    ? retryInput[0].content
    : [];
  const retryTexts = retryContent
    .filter((item) => item?.type === "input_text")
    .map((item) => String(item.text));

  assert.ok(
    retryTexts.some((text) =>
      text.includes("Goal: convert the original uploaded resume into a complete standalone LaTeX document"),
    ),
  );
  assert.ok(
    retryTexts.some((text) =>
      text.includes("The previous attempt failed with this exact validation error"),
    ),
  );
  assert.ok(
    retryTexts.some((text) => text.includes("resume.tex:42: Undefined control sequence.")),
  );
  assert.ok(
    retryTexts.some((text) => text.includes("Previous generated LaTeX from your last model call")),
  );
  assert.ok(retryTexts.some((text) => text.includes("bad draft")));
  assert.ok(
    retryTexts.some((text) =>
      text.includes("Keep every bullet fully intact and never crop a bullet to only its first sentence."),
    ),
  );
  assert.ok(
    retryTexts.some((text) =>
      text.includes("Links array returned with the previous LaTeX draft"),
    ),
  );
  assert.ok(
    retryContent.some(
      (item) => item?.type === "input_file" && item.file_id === "file_123",
    ),
  );
});
