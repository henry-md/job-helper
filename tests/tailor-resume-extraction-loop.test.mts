import assert from "node:assert/strict";
import test from "node:test";
import { runResumeLatexToolLoop } from "../lib/tailor-resume-extraction-loop.ts";

function buildLinkSummary(input: {
  failedCount: number;
  passedCount: number;
  totalCount: number;
  unverifiedCount?: number;
}) {
  return {
    failedCount: input.failedCount,
    passedCount: input.passedCount,
    totalCount: input.totalCount,
    unverifiedCount: input.unverifiedCount ?? 0,
  };
}

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
          arguments: JSON.stringify({
            latexCode: "\\documentclass{article}\nBAD",
            links: [
              {
                label: "Portfolio",
                url: "https://example.com/bad-link",
              },
            ],
          }),
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
            links: [
              {
                label: "Portfolio",
                url: null,
              },
            ],
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
        return {
          error: compileError,
          linkSummary: null,
          links: [],
          ok: false as const,
          previewPdf: null,
        };
      }

      return {
        error: null,
        linkSummary: buildLinkSummary({
          failedCount: 0,
          passedCount: 0,
          totalCount: 0,
        }),
        links: [],
        ok: true as const,
        previewPdf: Buffer.from("pdf"),
      };
    },
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.attemptEvents, [
    {
      attempt: 1,
      error: compileError,
      linkSummary: null,
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 2,
      error: null,
      linkSummary: buildLinkSummary({
        failedCount: 0,
        passedCount: 0,
        totalCount: 0,
      }),
      outcome: "succeeded",
      willRetry: false,
    },
  ]);
  assert.equal(
    result.latexCode,
    "\\documentclass{article}\n\\begin{document}Fixed\\end{document}",
  );
  assert.deepEqual(result.extractedResumeLinks, [
    {
      label: "Portfolio",
      url: null,
    },
  ]);
  assert.deepEqual(result.previewPdf, Buffer.from("pdf"));
  assert.deepEqual(
    result.linkSummary,
    buildLinkSummary({
      failedCount: 0,
      passedCount: 0,
      totalCount: 0,
    }),
  );
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
    failedLinks: unknown[];
    linkSummary: unknown;
    ok: boolean;
    remainingAttempts: number;
  };

  assert.equal(retryPayload.attempt, 1);
  assert.equal(retryPayload.error, compileError);
  assert.deepEqual(retryPayload.failedLinks, []);
  assert.equal(retryPayload.linkSummary, null);
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
          arguments: JSON.stringify({
            latexCode: "draft-one",
            links: [],
          }),
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
            latexCode: "draft-two",
            links: [],
          }),
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
          arguments: JSON.stringify({
            latexCode: "draft-three",
            links: [],
          }),
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
      return {
        error,
        linkSummary: null,
        links: [],
        ok: false as const,
        previewPdf: null,
      };
    },
  });

  assert.equal(result.attempts, 3);
  assert.deepEqual(result.attemptEvents, [
    {
      attempt: 1,
      error: "resume.tex:31: Undefined control sequence.",
      linkSummary: null,
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 2,
      error: "resume.tex:64: Missing $ inserted.",
      linkSummary: null,
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 3,
      error: "resume.tex:92: Extra alignment tab has been changed to \\cr.",
      linkSummary: null,
      outcome: "failed",
      willRetry: false,
    },
  ]);
  assert.equal(result.latexCode, "draft-three");
  assert.deepEqual(result.extractedResumeLinks, []);
  assert.equal(result.linkSummary, null);
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

test("runResumeLatexToolLoop retries when link validation fails", async () => {
  const linkFailure =
    "Validated 1 extracted link, and 1 failed.\n- https://github.com/not-henry: Visible link text points to github.com/henry-md, but the href target was github.com/not-henry. Preserve the visible text, but do not invent a different destination.";
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
          arguments: JSON.stringify({
            latexCode:
              "\\href{https://github.com/not-henry}{\\tightul{github.com/henry-md}}",
          }),
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
            latexCode:
              "\\href{https://github.com/henry-md}{\\tightul{github.com/henry-md}}",
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
      if (latexCode.includes("not-henry")) {
        return {
          error: linkFailure,
          linkSummary: buildLinkSummary({
            failedCount: 1,
            passedCount: 0,
            totalCount: 1,
          }),
          links: [
            {
              displayText: "github.com/henry-md",
              outcome: "failed" as const,
              reason:
                "Visible link text points to github.com/henry-md, but the href target was github.com/not-henry. Preserve the visible text, but do not invent a different destination.",
              url: "https://github.com/not-henry",
            },
          ],
          ok: false as const,
          previewPdf: null,
        };
      }

      return {
        error: null,
        linkSummary: buildLinkSummary({
          failedCount: 0,
          passedCount: 1,
          totalCount: 1,
        }),
        links: [
          {
            displayText: "github.com/henry-md",
            outcome: "passed" as const,
            reason: null,
            url: "https://github.com/henry-md",
          },
        ],
        ok: true as const,
        previewPdf: Buffer.from("pdf"),
      };
    },
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.attemptEvents, [
    {
      attempt: 1,
      error: linkFailure,
      linkSummary: buildLinkSummary({
        failedCount: 1,
        passedCount: 0,
        totalCount: 1,
      }),
      outcome: "failed",
      willRetry: true,
    },
    {
      attempt: 2,
      error: null,
      linkSummary: buildLinkSummary({
        failedCount: 0,
        passedCount: 1,
        totalCount: 1,
      }),
      outcome: "succeeded",
      willRetry: false,
    },
  ]);
  assert.deepEqual(
    result.linkSummary,
    buildLinkSummary({
      failedCount: 0,
      passedCount: 1,
      totalCount: 1,
    }),
  );
  assert.equal(
    result.latexCode,
    "\\href{https://github.com/henry-md}{\\tightul{github.com/henry-md}}",
  );
  assert.deepEqual(result.previewPdf, Buffer.from("pdf"));

  const retryInput = requests[1]?.input;
  assert.ok(Array.isArray(retryInput));
  assert.equal(retryInput[0]?.type, "function_call_output");
  assert.equal(retryInput[0]?.call_id, "call_1");

  const retryPayload = JSON.parse(String(retryInput[0]?.output)) as {
    attempt: number;
    error: string;
    failedLinks: Array<{ displayText: string | null; reason: string | null; url: string }>;
    linkSummary: { failedCount: number; passedCount: number; totalCount: number };
    ok: boolean;
    remainingAttempts: number;
  };

  assert.equal(retryPayload.attempt, 1);
  assert.equal(retryPayload.error, linkFailure);
  assert.deepEqual(retryPayload.failedLinks, [
    {
      displayText: "github.com/henry-md",
      reason:
        "Visible link text points to github.com/henry-md, but the href target was github.com/not-henry. Preserve the visible text, but do not invent a different destination.",
      url: "https://github.com/not-henry",
    },
  ]);
  assert.deepEqual(
    retryPayload.linkSummary,
    buildLinkSummary({
      failedCount: 1,
      passedCount: 0,
      totalCount: 1,
    }),
  );
  assert.equal(retryPayload.ok, false);
  assert.equal(retryPayload.remainingAttempts, 2);
});
