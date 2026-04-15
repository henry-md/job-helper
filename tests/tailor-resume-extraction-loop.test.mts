import assert from "node:assert/strict";
import test from "node:test";
import { runResumeLatexToolLoop } from "../lib/tailor-resume-extraction-loop.ts";

test("runResumeLatexToolLoop retries with the exact compile error", async () => {
  const compileError =
    "resume.tex:137: LaTeX Error: Unicode character (U+FFFE) not set up for use with LaTeX.";
  const requests: Array<{ previousResponseId?: string; input?: unknown }> = [];
  const responses = [
    {
      id: "resp_1",
      model: "gpt-5-mini",
      output: [
        {
          type: "function_call",
          name: "validate_resume_latex",
          call_id: "call_1",
          arguments: JSON.stringify({ latexCode: "\\documentclass{article}\nBAD" }),
        },
      ],
    },
    {
      id: "resp_2",
      model: "gpt-5-mini",
      output: [
        {
          type: "function_call",
          name: "validate_resume_latex",
          call_id: "call_2",
          arguments: JSON.stringify({
            latexCode: "\\documentclass{article}\n\\begin{document}Fixed\\end{document}",
          }),
        },
      ],
    },
  ];

  const result = await runResumeLatexToolLoop({
    createResponse: async (request) => {
      requests.push(request);
      const nextResponse = responses.shift();

      if (!nextResponse) {
        throw new Error("Received more tool-loop requests than expected.");
      }

      return nextResponse;
    },
    fallbackModel: "gpt-5-mini",
    validateLatex: async (latexCode) => {
      if (latexCode.includes("BAD")) {
        throw new Error(compileError);
      }

      return Buffer.from("pdf");
    },
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.attemptEvents, [
    {
      attempt: 1,
      error: compileError,
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 2,
      error: null,
      outcome: "succeeded",
      willRetry: false,
    },
  ]);
  assert.equal(
    result.latexCode,
    "\\documentclass{article}\n\\begin{document}Fixed\\end{document}",
  );
  assert.deepEqual(result.previewPdf, Buffer.from("pdf"));
  assert.equal(result.validationError, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.previousResponseId, "resp_1");

  const retryInput = requests[1]?.input;
  assert.ok(Array.isArray(retryInput));
  assert.equal(retryInput[0]?.type, "function_call_output");
  assert.equal(retryInput[0]?.call_id, "call_1");

  const retryPayload = JSON.parse(String(retryInput[0]?.output)) as {
    attempt: number;
    error: string;
    ok: boolean;
    remainingAttempts: number;
  };

  assert.equal(retryPayload.attempt, 1);
  assert.equal(retryPayload.error, compileError);
  assert.equal(retryPayload.ok, false);
  assert.equal(retryPayload.remainingAttempts, 2);
});

test("runResumeLatexToolLoop returns the last draft plus the final error after three failures", async () => {
  const compileErrors = [
    "resume.tex:31: Undefined control sequence.",
    "resume.tex:64: Missing $ inserted.",
    "resume.tex:92: Extra alignment tab has been changed to \\cr.",
  ];
  const requests: Array<{ previousResponseId?: string; input?: unknown }> = [];
  const responses = [
    {
      id: "resp_1",
      model: "gpt-5-mini",
      output: [
        {
          type: "function_call",
          name: "validate_resume_latex",
          call_id: "call_1",
          arguments: JSON.stringify({ latexCode: "draft-one" }),
        },
      ],
    },
    {
      id: "resp_2",
      model: "gpt-5-mini",
      output: [
        {
          type: "function_call",
          name: "validate_resume_latex",
          call_id: "call_2",
          arguments: JSON.stringify({ latexCode: "draft-two" }),
        },
      ],
    },
    {
      id: "resp_3",
      model: "gpt-5-mini",
      output: [
        {
          type: "function_call",
          name: "validate_resume_latex",
          call_id: "call_3",
          arguments: JSON.stringify({ latexCode: "draft-three" }),
        },
      ],
    },
  ];
  let compileAttempt = 0;

  const result = await runResumeLatexToolLoop({
    createResponse: async (request) => {
      requests.push(request);
      const nextResponse = responses.shift();

      if (!nextResponse) {
        throw new Error("Received more tool-loop requests than expected.");
      }

      return nextResponse;
    },
    fallbackModel: "gpt-5-mini",
    validateLatex: async () => {
      const error = compileErrors[compileAttempt] ?? "Unexpected compile failure.";
      compileAttempt += 1;
      throw new Error(error);
    },
  });

  assert.equal(result.attempts, 3);
  assert.deepEqual(result.attemptEvents, [
    {
      attempt: 1,
      error: "resume.tex:31: Undefined control sequence.",
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 2,
      error: "resume.tex:64: Missing $ inserted.",
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 3,
      error: "resume.tex:92: Extra alignment tab has been changed to \\cr.",
      outcome: "failed",
      willRetry: false,
    },
  ]);
  assert.equal(result.latexCode, "draft-three");
  assert.equal(result.previewPdf, null);
  assert.equal(requests.length, 3);
  assert.equal(requests[1]?.previousResponseId, "resp_1");
  assert.equal(requests[2]?.previousResponseId, "resp_2");
  assert.match(
    result.validationError ?? "",
    /Unable to produce a compilable LaTeX resume after 3 attempts\./,
  );
  assert.match(
    result.validationError ?? "",
    /resume\.tex:92: Extra alignment tab has been changed to \\cr\./,
  );
});
