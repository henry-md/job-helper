import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  applyTailorResumeBlockChanges,
  applyTailorResumeUserMarkdownBoldFormatting,
  buildTechnologyExtractionInstructions,
  buildTechnologyExtractionReasoning,
  classifyTailoredResumeGenerationOutcome,
  extractTailorResumeJobDescriptionTechnologyHints,
  filterUnsupportedEmphasizedTechnologiesForPlanning,
  mergeTailorResumeJobDescriptionTechnologies,
  parseTailorResumeTechnologyExtractionResponse,
  parseTailoredResumePlanResponse,
  readRequiredTailorResumeQuestioningKeywords,
  validateTailoredResumeImplementationIncludesQuestioningLearnings,
  validateTailoredResumeImplementationKeywordCoverage,
  validateTailoredResumePlanningKeywordCoverage,
} from "../lib/tailor-resume-tailoring.ts";
import {
  hasValidTailorResumeSegmentIds,
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";

test("buildTechnologyExtractionInstructions frames Step 1 as resume-tailoring keyword scraping", () => {
  const prompt = buildTechnologyExtractionInstructions();

  assert.match(prompt, /resume-tailoring keywords/i);
  assert.match(prompt, /shown to the user/i);
  assert.match(prompt, /resume edits or follow-up questions/i);
  assert.match(prompt, /scraped-page junk creates bad resume edits/i);
  assert.match(prompt, /high recall for real job-fit signals/i);
  assert.match(prompt, /high precision against scraped-page noise/i);
  assert.match(prompt, /sidebar or extension UI/i);
  assert.match(prompt, /Skills or Technical Skills section/i);
  assert.match(prompt, /never return Production Infrastructure or Production clusters/i);
  assert.match(prompt, /return Kubernetes for Kubernetes-based PaaS/i);
  assert.match(prompt, /core resume skill/i);
  assert.match(prompt, /one atomic keyword per item/i);
});

test("buildTechnologyExtractionReasoning keeps Step 1 on low reasoning", () => {
  assert.deepEqual(buildTechnologyExtractionReasoning(), { effort: "low" });
});

test("filterUnsupportedEmphasizedTechnologiesForPlanning treats no-experience USER.md notes as unsupported", () => {
  const technologies = filterUnsupportedEmphasizedTechnologiesForPlanning({
    emphasizedTechnologies: [
      { evidence: "job posting", name: "Grafana", priority: "high" },
      { evidence: "job posting", name: "Kubernetes", priority: "high" },
      { evidence: "job posting", name: "Windsurf", priority: "low" },
    ],
    resumePlainText: "Built Kubernetes services with TypeScript.",
    userMarkdown: {
      markdown:
        "# USER.md\n\n## Grafana\n\n- No direct Grafana experience; do not invent work-experience bullets.\n\n## Windsurf\n\n- Can list Windsurf in AI developer tooling skills.\n",
      nonTechnologies: [],
      updatedAt: null,
    },
  });

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["Kubernetes", "Windsurf"],
  );
});

test("filterUnsupportedEmphasizedTechnologiesForPlanning reads no-experience notes under technology headings", () => {
  const technologies = filterUnsupportedEmphasizedTechnologiesForPlanning({
    emphasizedTechnologies: [
      { evidence: "job posting", name: "Grafana", priority: "high" },
      { evidence: "job posting", name: "Cilium", priority: "high" },
      { evidence: "job posting", name: "React", priority: "high" },
    ],
    resumePlainText: "Built React interfaces.",
    userMarkdown: {
      markdown:
        "# USER.md\n\n## ## Grafana\n\nNo direct Grafana experience.\n\n## ## Cilium\n\nDo not invent work-experience bullets.\n",
      nonTechnologies: [],
      updatedAt: null,
    },
  });

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["React"],
  );
});

test("applyTailorResumeBlockChanges replaces a segment and re-normalizes ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const updated = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode: "\\resumeitem{Tailored bullet one}",
        reason: 'Highlights CI/CD work. Matches "CI/CD" in the job description.',
        segmentId: targetSegment.id,
      },
    ],
  });

  assert.equal(hasValidTailorResumeSegmentIds(updated.annotatedLatex), true);

  const strippedLatex = stripTailorResumeSegmentIds(updated.annotatedLatex);

  assert.equal(strippedLatex.includes("Tailored bullet one"), true);
  assert.equal(strippedLatex.includes("Tailored bullet two"), false);
});

test("applyTailorResumeBlockChanges rejects duplicate segment edits", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode: "\\resumeitem{One}",
            reason: 'Highlights one requirement. Matches "Requirement one".',
            segmentId: targetSegment.id,
          },
          {
            latexCode: "\\resumeitem{Two}",
            reason: 'Highlights another requirement. Matches "Requirement two".',
            segmentId: targetSegment.id,
          },
        ],
      }),
    /duplicate edits/,
  );
});

test("applyTailorResumeBlockChanges rejects unknown segment ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode: "\\resumeitem{Tailored bullet}",
            reason: 'Highlights the quoted requirement. Matches "required experience".',
            segmentId: "missing.segment-id",
          },
        ],
      }),
    /unknown segment/,
  );
});

test("applyTailorResumeBlockChanges rejects replacements that span multiple logical blocks", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode:
              "\\resumeitem{Tailored bullet one}\n\\resumeitem{Tailored bullet two}",
            reason: 'Combines neighboring bullets. Matches "two separate accomplishments".',
            segmentId: targetSegment.id,
          },
        ],
      }),
    /multiple logical blocks/,
  );
});

test("applyTailorResumeBlockChanges repairs a lone bare dollar sign in model output", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const updated = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode: String.raw`\resumeitem{Saved \textbf{$50K+/mo} in spend}`,
        reason: 'Highlights scale. Matches "$50K+/mo" in the original resume.',
        segmentId: targetSegment.id,
      },
    ],
  });

  const strippedLatex = stripTailorResumeSegmentIds(updated.annotatedLatex);

  assert.equal(strippedLatex.includes(String.raw`\textbf{\$50K+/mo}`), true);
});

test("applyTailorResumeUserMarkdownBoldFormatting bolds job terms copied from quoted USER.md sentences", () => {
  const changes = applyTailorResumeUserMarkdownBoldFormatting({
    emphasizedTechnologies: [
      {
        evidence: "Posting names RESTful services.",
        name: "RESTful services",
        priority: "high",
      },
      {
        evidence: "Posting names Cassandra.",
        name: "Cassandra",
        priority: "high",
      },
      {
        evidence: "Posting names Go.",
        name: "Go",
        priority: "high",
      },
    ],
    implementationChanges: [
      {
        latexCode:
          String.raw`\resumeitem{Built Go streaming microservice to ingest data and expose RESTful services}`,
        segmentId: "experience.entry-1.bullet-1",
      },
      {
        latexCode:
          String.raw`\resumeitem{Migrated time-series data from MongoDB to Cassandra to reduce costs}`,
        segmentId: "experience.entry-2.bullet-1",
      },
      {
        latexCode:
          String.raw`\resumeitem{Technical Skills: Go, Cassandra, RESTful services}`,
        segmentId: "resume.entry-3.bullet-1",
      },
      {
        latexCode:
          String.raw`\resumeitem{Built Go streaming microservice to ingest data and expose RESTful services}`,
        segmentId: "technical-skills.section-1",
      },
      {
        latexCode:
          String.raw`\resumeSection{TECHNICAL SKILLS} **Go**, Cassandra, RESTful services`,
        segmentId: "experience.entry-3.bullet-1",
      },
    ],
    userMarkdown: {
      markdown:
        '# USER.md\n\n## Go\n\n- "Built Go streaming microservice to ingest data and expose RESTful services" -- Johns Hopkins University\n\n## Cassandra\n\n- "Migrated time-series data from MongoDB to Cassandra to reduce costs" -- KnoWhiz\n',
      nonTechnologies: [],
      updatedAt: null,
    },
  });

  assert.match(changes[0]?.latexCode ?? "", /\\textbf\{RESTful services\}/);
  assert.match(changes[0]?.latexCode ?? "", /\\textbf\{Go\}/);
  assert.match(changes[1]?.latexCode ?? "", /\\textbf\{Cassandra\}/);
  assert.equal(
    changes[2]?.latexCode,
    String.raw`\resumeitem{Technical Skills: Go, Cassandra, RESTful services}`,
  );
  assert.equal(
    changes[3]?.latexCode,
    String.raw`\resumeitem{Built Go streaming microservice to ingest data and expose RESTful services}`,
  );
  assert.equal(
    changes[4]?.latexCode,
    String.raw`\resumeSection{TECHNICAL SKILLS} Go, Cassandra, RESTful services`,
  );
});

test("applyTailorResumeUserMarkdownBoldFormatting translates explicit markdown bold without double-wrapping", () => {
  const changes = applyTailorResumeUserMarkdownBoldFormatting({
    emphasizedTechnologies: [
      {
        evidence: "Posting names Go.",
        name: "Go",
        priority: "high",
      },
      {
        evidence: "Posting names Spark.",
        name: "Spark",
        priority: "high",
      },
    ],
    implementationChanges: [
      {
        latexCode:
          String.raw`\resumeitem{Built **Go** streaming microservice with Spark}`,
        segmentId: "experience.entry-1.bullet-1",
      },
      {
        latexCode:
          String.raw`\resumeitem{Built \textbf{Go} streaming microservice with Spark}`,
        segmentId: "experience.entry-2.bullet-1",
      },
    ],
    userMarkdown: {
      markdown:
        '# USER.md\n\n## Go\n\n- "Built **Go** streaming microservice with Spark" -- Johns Hopkins University\n',
      nonTechnologies: [],
      updatedAt: null,
    },
  });

  assert.match(changes[0]?.latexCode ?? "", /\\textbf\{Go\}/);
  assert.doesNotMatch(changes[0]?.latexCode ?? "", /\*\*Go\*\*/);
  assert.doesNotMatch(changes[1]?.latexCode ?? "", /\\textbf\{\\textbf\{Go\}\}/);
});

test("classifyTailoredResumeGenerationOutcome returns generation_failure when no candidate was applied", () => {
  assert.equal(
    classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate: false,
      hasPreviewPdf: false,
    }),
    "generation_failure",
  );
});

test("classifyTailoredResumeGenerationOutcome returns reviewable_failure when a candidate exists without a preview", () => {
  assert.equal(
    classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate: true,
      hasPreviewPdf: false,
    }),
    "reviewable_failure",
  );
});

test("classifyTailoredResumeGenerationOutcome returns success when a preview is available", () => {
  assert.equal(
    classifyTailoredResumeGenerationOutcome({
      hasAppliedCandidate: false,
      hasPreviewPdf: true,
    }),
    "success",
  );
});

test("parseTailoredResumePlanResponse keeps the structured thesis payload", () => {
  const parsed = parseTailoredResumePlanResponse({
    changes: [
      {
        desiredPlainText: "Tailored bullet one",
        reason: 'Highlights CI/CD work. Required qualifications mention "CI/CD".',
        segmentId: "experience.entry-1.bullet-1",
      },
    ],
    companyName: "OpenAI",
    displayName: "OpenAI - Research Engineer",
    emphasizedTechnologies: [
      {
        evidence: 'Required qualifications mention "CI/CD".',
        name: "CI/CD",
        priority: "high",
      },
      {
        evidence: 'Preferred qualifications mention "Kubernetes".',
        name: "Kubernetes",
        priority: "low",
      },
      {
        evidence: 'Required qualifications mention "TypeScript/JavaScript".',
        name: "TypeScript/JavaScript",
        priority: "high",
      },
      {
        evidence: 'Preferred qualifications mention "React / Next.js".',
        name: "React / Next.js",
        priority: "low",
      },
    ],
    positionTitle: "Research Engineer",
    thesis: {
      jobDescriptionFocus:
        "Over-indexes on research infrastructure and rigorous CI/CD expectations beyond generic software engineering signals.",
      resumeChanges:
        "Raises the most relevant platform-delivery work and makes the research-systems context more explicit across the edited bullets.",
    },
  });

  assert.equal(parsed.companyName, "OpenAI");
  assert.equal(parsed.jobIdentifier, "General");
  assert.deepEqual(parsed.emphasizedTechnologies, [
    {
      evidence: 'Required qualifications mention "CI/CD".',
      name: "CI/CD",
      priority: "high",
    },
    {
      evidence: 'Preferred qualifications mention "Kubernetes".',
      name: "Kubernetes",
      priority: "low",
    },
    {
      evidence: 'Required qualifications mention "TypeScript/JavaScript".',
      name: "TypeScript/JavaScript",
      priority: "high",
    },
    {
      evidence: 'Preferred qualifications mention "React / Next.js".',
      name: "React / Next.js",
      priority: "low",
    },
  ]);
  assert.equal(
    parsed.thesis.jobDescriptionFocus,
    "Over-indexes on research infrastructure and rigorous CI/CD expectations beyond generic software engineering signals.",
  );
  assert.equal(
    parsed.thesis.resumeChanges,
    "Raises the most relevant platform-delivery work and makes the research-systems context more explicit across the edited bullets.",
  );
});

test("parseTailoredResumePlanResponse rejects a missing thesis payload", () => {
  assert.throws(
    () =>
      parseTailoredResumePlanResponse({
        changes: [],
        companyName: "OpenAI",
        displayName: "OpenAI - Research Engineer",
        positionTitle: "Research Engineer",
      }),
    /thesis/i,
  );
});

test("parseTailorResumeTechnologyExtractionResponse reads JD-only technology extraction", () => {
  const technologies = parseTailorResumeTechnologyExtractionResponse({
    emphasizedTechnologies: [
      {
        evidence: "Required qualifications mention Go.",
        name: "Go",
        priority: "high",
      },
      {
        evidence: "Preferred qualifications mention Redux.",
        name: "redux",
        priority: "low",
      },
      {
        evidence: "Environment Platform is a Kubernetes-based PaaS.",
        name: "Kubernetes-based PaaS",
        priority: "high",
      },
      {
        evidence: "Production Infrastructure team.",
        name: "Production Infrastructure",
        priority: "high",
      },
      {
        evidence: "Hundreds of production clusters.",
        name: "Production clusters",
        priority: "high",
      },
    ],
  });

  assert.deepEqual(technologies, [
    {
      evidence: "Required qualifications mention Go.",
      name: "Go",
      priority: "high",
    },
    {
      evidence: "Preferred qualifications mention Redux.",
      name: "Redux",
      priority: "low",
    },
    {
      evidence: "Environment Platform is a Kubernetes-based PaaS.",
      name: "Kubernetes",
      priority: "high",
    },
  ]);
});

test("mergeTailorResumeJobDescriptionTechnologies prefers JD extraction and filters resume-only planner terms", () => {
  const technologies = mergeTailorResumeJobDescriptionTechnologies({
    employerName: "Acme Systems",
    extractedTechnologies: [
      {
        evidence: "Required section names Go.",
        name: "Go",
        priority: "high",
      },
      {
        evidence: "Required section names Cassandra.",
        name: "Cassandra",
        priority: "high",
      },
      {
        evidence: "The product team builds Acme Foundry.",
        name: "Acme Foundry",
        priority: "high",
      },
    ],
    jobDescription:
      "Required: experience with Go, Cassandra, Spark, React, and Redux. The product team builds Acme Foundry.",
    plannerTechnologies: [
      {
        evidence: "Technical skills list Java.",
        name: "Java",
        priority: "high",
      },
      {
        evidence: "Planner also found React in the job description.",
        name: "React",
        priority: "low",
      },
    ],
  });

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["Go", "Cassandra", "React"],
  );
});

test("mergeTailorResumeJobDescriptionTechnologies filters saved non-technologies case-insensitively", () => {
  const technologies = mergeTailorResumeJobDescriptionTechnologies({
    extractedTechnologies: [
      {
        evidence: "Required section names Chromium.",
        name: "Chromium",
        priority: "high",
      },
      {
        evidence: "Required section names React.",
        name: "React",
        priority: "high",
      },
    ],
    jobDescription: "Required: Chromium, React, and Internationalization.",
    nonTechnologies: ["chromium", "internationalization"],
    plannerTechnologies: [
      {
        evidence: "Planner also found Internationalization.",
        name: "Internationalization",
        priority: "low",
      },
    ],
  });

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["React"],
  );
});

test("mergeTailorResumeJobDescriptionTechnologies applies deterministic denylist only when enabled", (t) => {
  const previousValue = process.env.USE_DENY_LIST_FOR_KEYWORDS;

  t.after(() => {
    if (typeof previousValue === "undefined") {
      delete process.env.USE_DENY_LIST_FOR_KEYWORDS;
      return;
    }

    process.env.USE_DENY_LIST_FOR_KEYWORDS = previousValue;
  });

  const input = {
    extractedTechnologies: [
      {
        evidence: "Required section names Blueprint.",
        name: "Blueprint",
        priority: "high" as const,
      },
      {
        evidence: "Required section names React.",
        name: "React",
        priority: "high" as const,
      },
    ],
    jobDescription: "Required: Blueprint and React.",
    plannerTechnologies: [],
  };

  process.env.USE_DENY_LIST_FOR_KEYWORDS = "false";
  assert.deepEqual(
    mergeTailorResumeJobDescriptionTechnologies(input).map(
      (technology) => technology.name,
    ),
    ["Blueprint", "React"],
  );

  process.env.USE_DENY_LIST_FOR_KEYWORDS = "true";
  assert.deepEqual(
    mergeTailorResumeJobDescriptionTechnologies(input).map(
      (technology) => technology.name,
    ),
    ["React"],
  );
});

test("extractTailorResumeJobDescriptionTechnologyHints finds concrete stack terms without a model call", () => {
  const technologies = extractTailorResumeJobDescriptionTechnologyHints(`
    Technologies We Use
    A variety of languages, including Java and Go for backend and Typescript for frontend.
    Open-source technologies like Cassandra, Spark, Elasticsearch, React, and Redux.
    Industry-standard build tooling, including Gradle and GitHub.
    Nice to have: Palantir Foundry.
  `);

  assert.deepEqual(
    technologies.map((technology) => [
      technology.name,
      technology.priority,
    ]),
    [
      ["Elasticsearch", "high"],
      ["TypeScript", "high"],
      ["Cassandra", "high"],
      ["Gradle", "high"],
      ["GitHub", "high"],
      ["React", "high"],
      ["Redux", "high"],
      ["Spark", "high"],
      ["Java", "high"],
      ["Go", "high"],
    ],
  );
});

test("readRequiredTailorResumeQuestioningKeywords keeps confirmed tech and skips negative learnings", () => {
  const requirements = readRequiredTailorResumeQuestioningKeywords({
    changes: [
      {
        desiredPlainText: "Skills with confirmed tools",
        reason: "Adds confirmed tools.",
        segmentId: "technical-skills.section-1",
      },
    ],
    emphasizedTechnologies: [
      {
        evidence: "Job names Go.",
        name: "Go",
        priority: "high",
      },
      {
        evidence: "Job names Palantir Foundry.",
        name: "Palantir Foundry",
        priority: "high",
      },
    ],
    questioningSummary: {
      agenda: "Go and Palantir products",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [
        {
          detail: "Go — confirmed backend/API experience; list under skills.",
          targetSegmentIds: ["technical-skills.section-1"],
          topic: "Go",
        },
        {
          detail: "Palantir Foundry — no direct experience; do not add.",
          targetSegmentIds: ["technical-skills.section-1"],
          topic: "Palantir Foundry",
        },
      ],
    },
  });

  assert.deepEqual(requirements, [
    {
      detail: "Go — confirmed backend/API experience; list under skills.",
      keyword: "Go",
      targetSegmentIds: ["technical-skills.section-1"],
    },
  ]);
});

test("validateTailoredResumeImplementationIncludesQuestioningLearnings rejects ignored confirmed tech", () => {
  const plan = {
    changes: [
      {
        desiredPlainText: "Skills with confirmed tools",
        reason: "Adds confirmed tools.",
        segmentId: "technical-skills.section-1",
      },
    ],
    emphasizedTechnologies: [
      {
        evidence: "Job names Go.",
        name: "Go",
        priority: "high" as const,
      },
      {
        evidence: "Job names Cassandra.",
        name: "Cassandra",
        priority: "high" as const,
      },
    ],
    questioningSummary: {
      agenda: "Go and Cassandra",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [
        {
          detail: "Go — confirmed backend/API experience; list under skills.",
          targetSegmentIds: ["technical-skills.section-1"],
          topic: "Go",
        },
        {
          detail: "Cassandra — confirmed data-modeling experience; list under skills.",
          targetSegmentIds: ["technical-skills.section-1"],
          topic: "Cassandra",
        },
      ],
    },
  };

  assert.throws(
    () =>
      validateTailoredResumeImplementationIncludesQuestioningLearnings({
        implementationChanges: [
          {
            latexCode: String.raw`\resumeSection{TECHNICAL SKILLS} Java, React`,
            segmentId: "technical-skills.section-1",
          },
        ],
        plan,
      }),
    /Go -> technical-skills\.section-1[\s\S]*Cassandra -> technical-skills\.section-1/,
  );

  assert.doesNotThrow(() =>
    validateTailoredResumeImplementationIncludesQuestioningLearnings({
      implementationChanges: [
        {
          latexCode:
            String.raw`\resumeSection{TECHNICAL SKILLS} Java, Go, Cassandra, React`,
          segmentId: "technical-skills.section-1",
        },
      ],
      plan,
    }),
  );
});

test("validateTailoredResumePlanningKeywordCoverage rejects missing high-priority keywords", () => {
  assert.throws(
    () =>
      validateTailoredResumePlanningKeywordCoverage({
        keywordCheckResult: {
          missingHighPriority: ["Cassandra"],
          missingLowPriority: ["Redux"],
          presentHighPriority: ["Go"],
          presentLowPriority: [],
          terms: [
            { name: "Go", present: true, priority: "high" },
            { name: "Cassandra", present: false, priority: "high" },
            { name: "Redux", present: false, priority: "low" },
          ],
        },
      }),
    /missing high-priority keywords/i,
  );
});

test("validateTailoredResumeImplementationKeywordCoverage rejects high-priority regressions", () => {
  assert.throws(
    () =>
      validateTailoredResumeImplementationKeywordCoverage({
        keywordCheckResult: {
          missingHighPriority: ["Spark"],
          missingLowPriority: [],
          presentHighPriority: ["Go"],
          presentLowPriority: ["Redux"],
          terms: [
            { name: "Go", present: true, priority: "high" },
            { name: "Spark", present: false, priority: "high" },
            { name: "Redux", present: true, priority: "low" },
          ],
        },
      }),
    /regressed required high-priority keywords/i,
  );
});
