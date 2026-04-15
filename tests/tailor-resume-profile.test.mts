import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTailorResumeProfile,
  parseTailorResumeProfile,
} from "../lib/tailor-resume-types.ts";

test("parseTailorResumeProfile reads the current LaTeX-only shape", () => {
  const profile = parseTailorResumeProfile({
    extraction: {
      error: null,
      model: "gpt-5-mini",
      status: "ready",
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
    jobDescription: "Role text",
    links: [
      {
        key: "linkedin",
        label: "LinkedIn",
        locked: true,
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: "https://linkedin.com/in/example",
      },
      {
        disabled: true,
        key: "portfolio",
        label: "Portfolio",
        updatedAt: "2026-04-15T12:00:00.000Z",
        url: null,
      },
    ],
    latex: {
      code: "\\documentclass{article}\n\\begin{document}Hello\\end{document}",
      error: null,
      pdfUpdatedAt: "2026-04-15T12:00:00.000Z",
      status: "ready",
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
    resume: {
      mimeType: "application/pdf",
      originalFilename: "resume.pdf",
      sizeBytes: 1234,
      storagePath: "/uploads/resumes/user/resume.pdf",
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
  });

  assert.equal(profile.latex.code.includes("\\begin{document}"), true);
  assert.equal(profile.annotatedLatex.code, "");
  assert.equal(profile.extraction.model, "gpt-5-mini");
  assert.equal(profile.links[0]?.disabled, false);
  assert.equal(profile.links[0]?.locked, true);
  assert.equal(profile.links[0]?.url, "https://linkedin.com/in/example");
  assert.equal(profile.links[1]?.disabled, true);
  assert.equal(profile.links[1]?.locked, false);
  assert.equal(profile.links[1]?.url, null);
  assert.equal(profile.resume?.originalFilename, "resume.pdf");
  assert.deepEqual(profile.tailoredResumes, []);
});

test("parseTailorResumeProfile upgrades legacy draft/generated fields into code", () => {
  const profile = parseTailorResumeProfile({
    latex: {
      draftCode: "",
      generatedCode: "\\documentclass{article}\n\\begin{document}Legacy\\end{document}",
      error: null,
      pdfUpdatedAt: null,
      status: "ready",
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
    source: {
      document: { old: true },
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
  });

  assert.equal(profile.latex.code.includes("Legacy"), true);
  assert.equal(profile.annotatedLatex.code, "");
  assert.deepEqual(profile.resume, null);
});

test("emptyTailorResumeProfile defaults to an empty LaTeX draft", () => {
  const profile = emptyTailorResumeProfile();

  assert.equal(profile.latex.code, "");
  assert.equal(profile.annotatedLatex.code, "");
  assert.equal(profile.annotatedLatex.segmentCount, 0);
  assert.equal(profile.extraction.status, "idle");
  assert.deepEqual(profile.links, []);
  assert.equal(profile.resume, null);
  assert.deepEqual(profile.tailoredResumes, []);
});
