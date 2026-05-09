import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { extractTailorResumeResumeExperiences } from "../lib/tailor-resume-resume-experiences.ts";
import { normalizeTailorResumeLatex } from "../lib/tailor-resume-segmentation.ts";
import { measureTailorResumeSpareBulletLineCount } from "../lib/tailor-resume-spare-bullet-measurement.ts";

test("measureTailorResumeSpareBulletLineCount measures the rendered PDF bullet", async () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const experience = extractTailorResumeResumeExperiences(
    normalized.annotatedLatex,
  ).find((candidate) => candidate.bulletSegmentIds.length > 0);

  assert.ok(experience, "Expected the fixture to expose a bullet experience.");

  const measurement = await measureTailorResumeSpareBulletLineCount({
    quote:
      "Built p-hashing ad similarity service across 359K ads and 20 clients.",
    resumeExperienceId: experience.id,
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.equal(measurement.lineCount, 1);
  assert.equal(measurement.malformed, false);
  assert.equal(measurement.pageCount, 1);
  assert.equal(measurement.targetSegmentId, experience.bulletSegmentIds[0]);
});

test("measureTailorResumeSpareBulletLineCount matches escaped tilde text", async () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const experience = extractTailorResumeResumeExperiences(
    normalized.annotatedLatex,
  ).find((candidate) => candidate.id === "work-experience.entry-3.heading");

  assert.ok(experience, "Expected the fixture to expose the HF experience.");

  const measurement = await measureTailorResumeSpareBulletLineCount({
    quote:
      "Used AWS Amplify and CircleCI to build CI/CD pipelines, reducing design-to-dev handoff time by ~30% across 8 teams.",
    replacesQuote:
      "Used AWS Amplify to set up CI/CD pipelines, reducing design-to-dev handoff time by an avg. of ~30% across 8 teams",
    resumeExperienceId: experience.id,
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.equal(measurement.lineCount, 1);
  assert.equal(measurement.malformed, false);
  assert.equal(measurement.targetSegmentId, experience.bulletSegmentIds[0]);
});
