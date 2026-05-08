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
