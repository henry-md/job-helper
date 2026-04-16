import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { compileTailorResumeLatex } from "../lib/tailor-resume-latex.ts";
import {
  applyTailorResumeSourceLinkOverrides,
  applyTailorResumeSourceLinkOverridesWithSummary,
  applyTailorResumeLinkOverrides,
  applyTailorResumeLinkOverridesWithSummary,
  extractTailorResumeTrackedLinks,
  stripDisabledTailorResumeLinks,
} from "../lib/tailor-resume-link-overrides.ts";
import {
  buildTailorResumeLinkRecords,
  normalizeTailorResumeLinkUrl,
} from "../lib/tailor-resume-links.ts";
import { mergeTailorResumeLinksWithLockedLinks } from "../lib/tailor-resume-locked-links.ts";
import {
  extractResumeLatexLinks,
  validateTailorResumeLatexDocument,
  validateTailorResumeLink,
} from "../lib/tailor-resume-link-validation.ts";
import { extractEmbeddedPdfLinks } from "../lib/tailor-resume-pdf-links.ts";

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
  return [
    ...new Set(extractResumeLatexLinks(tailorResumeLatexExample).map((link) => link.url)),
  ];
}

function isQpdfAvailable() {
  try {
    execFileSync("qpdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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

test("fixture lists cover every unique link from tailorResumeLatexExample", () => {
  const exampleLinks = readUniqueExampleLinks();
  const classifiedLinks = [...linksExpectedToPass, ...linksExpectedNotToPass];
  const classifiedLinkSet = new Set<string>(classifiedLinks);

  assert.equal(new Set(classifiedLinks).size, classifiedLinks.length);

  for (const exampleLink of exampleLinks) {
    assert.ok(
      classifiedLinkSet.has(exampleLink),
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

test("buildTailorResumeLinkRecords preserves saved destinations and infers obvious url labels", () => {
  const records = buildTailorResumeLinkRecords({
    existingLinks: [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/henry-deutsch",
      },
    ],
    extractedLinks: [
      {
        label: "LinkedIn",
        url: null,
      },
      {
        label: "github.com/henry-md",
        url: null,
      },
      {
        label: "HenryMDeutsch@gmail.com",
        url: null,
      },
      {
        label: "914-272-5561",
        url: null,
      },
      {
        label: "Portfolio",
        url: null,
      },
    ],
  });

  assert.equal(records[0]?.disabled, false);
  assert.equal(records[0]?.locked ?? false, false);
  assert.equal(records[0]?.url, "https://linkedin.com/in/henry-deutsch");
  assert.equal(records[1]?.url, "https://github.com/henry-md");
  assert.equal(records[2]?.url, "mailto:henrymdeutsch@gmail.com");
  assert.equal(records[3]?.url, "tel:9142725561");
  assert.equal(records[4]?.url, null);
});

test("buildTailorResumeLinkRecords preserves explicitly deleted links and carries them forward", () => {
  const records = buildTailorResumeLinkRecords({
    existingLinks: [
      {
        disabled: true,
        key: "github-com-henry-md",
        label: "github.com/henry-md",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: null,
      },
    ],
    extractedLinks: [
      {
        label: "github.com/henry-md",
        url: "https://github.com/henry-md",
      },
    ],
  });

  assert.equal(records[0]?.disabled, true);
  assert.equal(records[0]?.locked ?? false, false);
  assert.equal(records[0]?.url, null);
});

test("buildTailorResumeLinkRecords assigns stable suffixes to duplicate labels", () => {
  const records = buildTailorResumeLinkRecords({
    extractedLinks: [
      {
        label: "Portfolio",
        url: "https://henry-deutsch.com",
      },
      {
        label: "Portfolio",
        url: null,
      },
    ],
  });

  assert.equal(records[0]?.key, "portfolio");
  assert.equal(records[0]?.disabled, false);
  assert.equal(records[0]?.locked ?? false, false);
  assert.equal(records[0]?.url, "https://henry-deutsch.com/");
  assert.equal(records[1]?.key, "portfolio-2");
  assert.equal(records[1]?.disabled, false);
  assert.equal(records[1]?.locked ?? false, false);
  assert.equal(records[1]?.url, null);
});

test("buildTailorResumeLinkRecords can drop stale links while preserving saved values for current keys", () => {
  const records = buildTailorResumeLinkRecords({
    existingLinks: [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        locked: true,
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/henry-deutsch",
      },
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://henry-deutsch.com",
      },
    ],
    extractedLinks: [
      {
        label: "LinkedIn",
        url: "https://linkedin.com/in/some-other-profile",
      },
      {
        label: "GitHub",
        url: "https://github.com/henry-md",
      },
    ],
    preserveUnusedExisting: false,
  });

  assert.deepEqual(
    records.map((record) => ({
      disabled: record.disabled,
      key: record.key,
      label: record.label,
      url: record.url,
    })),
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        url: "https://linkedin.com/in/henry-deutsch",
      },
      {
        disabled: false,
        key: "github",
        label: "GitHub",
        url: "https://github.com/henry-md",
      },
    ],
  );
});

test("buildTailorResumeLinkRecords can prefer explicit LaTeX href destinations for current keys", () => {
  const records = buildTailorResumeLinkRecords({
    existingLinks: [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        locked: true,
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/henry-deutsch",
      },
      {
        disabled: true,
        key: "portfolio",
        label: "Portfolio",
        locked: false,
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: null,
      },
    ],
    extractedLinks: [
      {
        label: "LinkedIn",
        url: "https://linkedin.com/in/henry-deutsch-updated",
      },
      {
        label: "Portfolio",
        url: "https://henry-deutsch.com",
      },
    ],
    preferExtractedUrls: true,
    preserveUnusedExisting: false,
  });

  assert.deepEqual(
    records.map((record) => ({
      disabled: record.disabled,
      key: record.key,
      label: record.label,
      url: record.url,
    })),
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        url: "https://linkedin.com/in/henry-deutsch-updated",
      },
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        url: "https://henry-deutsch.com/",
      },
    ],
  );
});

test("tracked source latex extraction preserves locked plain-text labels but drops unlocked ones", () => {
  const existingLinks = [
    {
      disabled: false,
      key: "linkedin",
      label: "LinkedIn",
      locked: true,
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: "https://linkedin.com/in/henry-deutsch",
    },
    {
      disabled: false,
      key: "portfolio",
      label: "Portfolio",
      locked: false,
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: "https://henry-deutsch.com",
    },
  ];
  const extractedLinks = extractTailorResumeTrackedLinks(
    String.raw`\documentclass{article}
\begin{document}
LinkedIn
Portfolio
\end{document}`,
    existingLinks.filter((link) => link.disabled || link.locked),
  );
  const records = buildTailorResumeLinkRecords({
    existingLinks,
    extractedLinks,
    preferExtractedUrls: true,
    preserveUnusedExisting: false,
  });

  assert.deepEqual(extractedLinks, [
    {
      label: "LinkedIn",
      url: null,
    },
  ]);
  assert.deepEqual(
    records.map((record) => ({
      disabled: record.disabled,
      key: record.key,
      label: record.label,
      url: record.url,
    })),
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        url: "https://linkedin.com/in/henry-deutsch",
      },
    ],
  );
});

test("mergeTailorResumeLinksWithLockedLinks defaults to the persisted locked value on key conflicts", () => {
  const mergedLinks = mergeTailorResumeLinksWithLockedLinks(
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/edited-in-latex",
      },
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://henry-deutsch.com",
      },
    ],
    [
      {
        key: "linkedin",
        label: "LinkedIn",
        updatedAt: "2026-04-15T13:00:00.000Z",
        url: "https://linkedin.com/in/locked-profile",
      },
    ],
  );

  assert.deepEqual(
    mergedLinks.map((link) => ({
      disabled: link.disabled,
      key: link.key,
      label: link.label,
      locked: link.locked ?? false,
      url: link.url,
    })),
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        locked: true,
        url: "https://linkedin.com/in/locked-profile",
      },
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        locked: false,
        url: "https://henry-deutsch.com",
      },
    ],
  );
});

test("normalizeTailorResumeLinkUrl accepts the same url formats users paste into the form", () => {
  assert.equal(
    normalizeTailorResumeLinkUrl("github.com/henry-md"),
    "https://github.com/henry-md",
  );
  assert.equal(
    normalizeTailorResumeLinkUrl("mailto:HenryMDeutsch@gmail.com"),
    "mailto:henrymdeutsch@gmail.com",
  );
  assert.equal(
    normalizeTailorResumeLinkUrl("(914) 272-5561"),
    "tel:9142725561",
  );
  assert.equal(normalizeTailorResumeLinkUrl("not a valid url"), null);
});

test("stripDisabledTailorResumeLinks removes href and tightul styling for deleted links", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
\href{https://github.com/henry-md}{\tightul{github.com/henry-md}}
\href{https://henry-deutsch.com}{\tightul{\textbf{henry-deutsch.com}}}
\end{document}`;

  const strippedLatexCode = stripDisabledTailorResumeLinks(latexCode, [
    {
      disabled: true,
      key: "github-com-henry-md",
      label: "github.com/henry-md",
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: null,
    },
  ]);

  assert.match(strippedLatexCode, /\ngithub\.com\/henry-md\n/);
  assert.doesNotMatch(strippedLatexCode, /\\href\{https:\/\/github\.com\/henry-md\}/);
  assert.doesNotMatch(strippedLatexCode, /\\tightul\{github\.com\/henry-md\}/);
  assert.match(
    strippedLatexCode,
    /\\href\{https:\/\/henry-deutsch\.com\}\{\\tightul\{\\textbf\{henry-deutsch\.com\}\}\}/,
  );
});

test("stripDisabledTailorResumeLinks removes only the exact duplicate occurrence that was deleted", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
\href{https://portfolio-one.example}{\tightul{Portfolio}}
\href{https://portfolio-two.example}{\tightul{\textbf{Portfolio}}}
\end{document}`;

  const strippedLatexCode = stripDisabledTailorResumeLinks(latexCode, [
    {
      disabled: true,
      key: "portfolio-2",
      label: "Portfolio",
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: null,
    },
  ]);

  assert.match(
    strippedLatexCode,
    /\\href\{https:\/\/portfolio-one\.example\}\{\\tightul\{Portfolio\}\}/,
  );
  assert.doesNotMatch(
    strippedLatexCode,
    /\\href\{https:\/\/portfolio-two\.example\}/,
  );
  assert.match(strippedLatexCode, /\n\\textbf\{Portfolio\}\n/);
});

test("applyTailorResumeLinkOverrides updates href destinations without changing visible text", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
\href{https://old.example/profile}{\tightul{LinkedIn}}
\end{document}`;

  const overriddenLatexCode = applyTailorResumeLinkOverrides(latexCode, [
    {
      disabled: false,
      key: "linkedin",
      label: "LinkedIn",
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: "https://linkedin.com/in/henry-deutsch",
    },
  ]);

  assert.match(
    overriddenLatexCode,
    /\\href\{https:\/\/linkedin\.com\/in\/henry-deutsch\}\{\\tightul\{LinkedIn\}\}/,
  );
});

test("applyTailorResumeLinkOverridesWithSummary counts only actual saved-link rewrites", () => {
  const overrideResult = applyTailorResumeLinkOverridesWithSummary(
    String.raw`\documentclass{article}
\begin{document}
\href{https://old.example/profile}{\tightul{LinkedIn}}
\href{https://github.com/henry-md}{\tightul{GitHub}}
\end{document}`,
    [
      {
        disabled: false,
        key: "linkedin",
        label: "LinkedIn",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/henry-deutsch",
      },
      {
        disabled: false,
        key: "github",
        label: "GitHub",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://github.com/henry-md",
      },
    ],
  );

  assert.equal(overrideResult.updatedCount, 1);
  assert.match(
    overrideResult.latexCode,
    /\\href\{https:\/\/linkedin\.com\/in\/henry-deutsch\}\{\\tightul\{LinkedIn\}\}/,
  );
});

test("applyTailorResumeLinkOverrides wraps plain text labels with deterministic link styling", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
\textbf{Portfolio}
\end{document}`;

  const overriddenLatexCode = applyTailorResumeLinkOverrides(latexCode, [
    {
      disabled: false,
      key: "portfolio",
      label: "Portfolio",
      updatedAt: "2026-04-15T12:00:00.000Z",
      url: "https://henry-deutsch.com",
    },
  ]);

  assert.match(
    overriddenLatexCode,
    /\\textbf\{\\href\{https:\/\/henry-deutsch\.com\}\{\\tightul\{Portfolio\}\}\}/,
  );
});

test("applyTailorResumeSourceLinkOverrides injects only locked links and strips deleted ones", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
LinkedIn
Portfolio
\href{https://github.com/old-profile}{\tightul{GitHub}}
\end{document}`;

  const overriddenLatexCode = applyTailorResumeSourceLinkOverrides(latexCode, {
    currentLinks: [
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://henry-deutsch.com",
      },
      {
        disabled: true,
        key: "github",
        label: "GitHub",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: null,
      },
    ],
    lockedLinks: [
      {
        key: "linkedin",
        label: "LinkedIn",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/henry-deutsch",
      },
    ],
  });

  assert.match(
    overriddenLatexCode,
    /\\href\{https:\/\/linkedin\.com\/in\/henry-deutsch\}\{\\tightul\{LinkedIn\}\}/,
  );
  assert.match(overriddenLatexCode, /\nPortfolio\n/);
  assert.doesNotMatch(
    overriddenLatexCode,
    /\\href\{https:\/\/henry-deutsch\.com\}\{\\tightul\{Portfolio\}\}/,
  );
  assert.doesNotMatch(
    overriddenLatexCode,
    /\\href\{https:\/\/github\.com\/old-profile\}/,
  );
  assert.match(overriddenLatexCode, /\nGitHub\n/);
});

test("applyTailorResumeSourceLinkOverrides rewrites a locked href inside a styled block", () => {
  const latexCode = String.raw`\documentclass{article}
\begin{document}
{\BodyFont\href{https://github.com/scisegrver/BOOMmmm}{\tightul{\textbf{N-Body Orbit Simulations}}}~|~Research at Johns Hopkins\par}
\end{document}`;

  const overriddenLatexCode = applyTailorResumeSourceLinkOverrides(latexCode, {
    currentLinks: [],
    lockedLinks: [
      {
        key: "n-body-orbit-simulations",
        label: "N-Body Orbit Simulations",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://github.com/scisegrver/BOOM",
      },
    ],
  });

  assert.match(
    overriddenLatexCode,
    /\\href\{https:\/\/github\.com\/scisegrver\/BOOM\}\{\\tightul\{\\textbf\{N-Body Orbit Simulations\}\}\}/,
  );
  assert.doesNotMatch(
    overriddenLatexCode,
    /\\href\{https:\/\/github\.com\/scisegrver\/BOOMmmm\}/,
  );
});

test("applyTailorResumeSourceLinkOverridesWithSummary counts locked-link injections", () => {
  const overrideResult = applyTailorResumeSourceLinkOverridesWithSummary(
    String.raw`\documentclass{article}
\begin{document}
LinkedIn
Portfolio
\end{document}`,
    {
      currentLinks: [
        {
          disabled: false,
          key: "portfolio",
          label: "Portfolio",
          updatedAt: "2026-04-15T12:00:00.000Z",
          url: "https://henry-deutsch.com",
        },
      ],
      lockedLinks: [
        {
          key: "linkedin",
          label: "LinkedIn",
          updatedAt: "2026-04-15T12:00:00.000Z",
          url: "https://linkedin.com/in/henry-deutsch",
        },
      ],
    },
  );

  assert.equal(overrideResult.updatedCount, 1);
  assert.match(
    overrideResult.latexCode,
    /\\href\{https:\/\/linkedin\.com\/in\/henry-deutsch\}\{\\tightul\{LinkedIn\}\}/,
  );
  assert.doesNotMatch(
    overrideResult.latexCode,
    /\\href\{https:\/\/henry-deutsch\.com\}\{\\tightul\{Portfolio\}\}/,
  );
});

test(
  "extractEmbeddedPdfLinks recovers every unique destination from the example resume PDF",
  {
    skip: !isQpdfAvailable() && "qpdf is not available in this environment.",
  },
  async () => {
    const compiledPdf = await compileTailorResumeLatex(tailorResumeLatexExample);
    const embeddedPdfLinks = await extractEmbeddedPdfLinks(compiledPdf);
    const uniquePdfUrls = [...new Set(embeddedPdfLinks.map((link) => link.url))].sort();
    const uniqueLatexUrls = readUniqueExampleLinks().sort();

    assert.deepEqual(uniquePdfUrls, uniqueLatexUrls);
  },
);
