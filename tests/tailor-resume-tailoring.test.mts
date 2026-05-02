import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  applyTailorResumeBlockChanges,
  classifyTailoredResumeGenerationOutcome,
  extractTailorResumeJobDescriptionTechnologyHints,
  mergeTailorResumeJobDescriptionTechnologies,
  parseTailorResumeTechnologyExtractionResponse,
  parseTailoredResumePlanResponse,
  readRequiredTailorResumeQuestioningKeywords,
  validateTailoredResumeImplementationIncludesQuestioningLearnings,
} from "../lib/tailor-resume-tailoring.ts";
import {
  hasValidTailorResumeSegmentIds,
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";

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
        name: "Redux",
        priority: "low",
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
