import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResumeLatexLinks,
  validateTailorResumeLatexDocument,
} from "../lib/tailor-resume-link-validation.ts";

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

test("extractResumeLatexLinks preserves visible link text through nested styling", () => {
  const links = extractResumeLatexLinks(
    String.raw`\href{https://github.com/henry-md}{\tightul{\textbf{github.com/henry-md}}}`,
  );

  assert.deepEqual(links, [
    {
      displayText: "github.com/henry-md",
      url: "https://github.com/henry-md",
    },
  ]);
});

test("validateTailorResumeLatexDocument fails when visible link text mismatches the href target", async () => {
  let fetchCalls = 0;

  const result = await validateTailorResumeLatexDocument(
    String.raw`\href{https://github.com/not-henry}{\tightul{github.com/henry-md}}`,
    {
      compileLatex: async () => Buffer.from("pdf"),
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(
    result.linkSummary,
    buildLinkSummary({
      failedCount: 1,
      passedCount: 0,
      totalCount: 1,
    }),
  );
  assert.match(
    result.error ?? "",
    /Visible link text points to github\.com\/henry-md, but the href target was github\.com\/not-henry\./,
  );
});

test("validateTailorResumeLatexDocument treats 404 links as failed and blocked links as unverified", async () => {
  const requests: Array<{ method: string; url: string }> = [];

  const result = await validateTailorResumeLatexDocument(
    [
      String.raw`\href{https://missing.example/role}{\tightul{missing.example/role}}`,
      String.raw`\href{https://blocked.example/profile}{\tightul{blocked.example/profile}}`,
    ].join("\n"),
    {
      compileLatex: async () => Buffer.from("pdf"),
      fetchImpl: async (input, init) => {
        const method = String(init?.method ?? "GET");
        const url = String(input);
        requests.push({ method, url });

        if (url.includes("missing.example")) {
          return new Response(null, { status: 404 });
        }

        if (url.includes("blocked.example")) {
          return new Response(null, { status: 403 });
        }

        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.linkSummary,
    buildLinkSummary({
      failedCount: 1,
      passedCount: 0,
      totalCount: 2,
      unverifiedCount: 1,
    }),
  );
  assert.match(result.error ?? "", /Validated 2 extracted links, and 1 failed\./);
  assert.deepEqual(requests, [
    { method: "HEAD", url: "https://missing.example/role" },
    { method: "HEAD", url: "https://blocked.example/profile" },
    { method: "GET", url: "https://blocked.example/profile" },
  ]);
});
