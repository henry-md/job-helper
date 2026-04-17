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
  assert.equal(profile.workspace.isBaseResumeStepComplete, false);
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
  assert.equal(profile.workspace.isBaseResumeStepComplete, false);
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
  assert.equal(profile.workspace.isBaseResumeStepComplete, false);
});

test("parseTailorResumeProfile keeps tailored resume metadata and workspace state", () => {
  const profile = parseTailorResumeProfile({
    tailoredResumes: [
      {
        annotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: document.documentclass-article-1\n\\documentclass{article}",
        companyName: "OpenAI",
        createdAt: "2026-04-15T12:00:00.000Z",
        displayName: "OpenAI - Research Engineer",
        edits: [
          {
            afterLatexCode: "\\resumeitem{Tailored bullet}",
            beforeLatexCode: "\\resumeitem{Original bullet}",
            command: "resumeitem",
            reason: 'Highlights CI/CD work. Matches "CI/CD" in the job description.',
            segmentId: "experience.entry-1.bullet-1",
          },
        ],
        error: null,
        id: "tailored-1",
        jobDescription: "Job description text",
        jobIdentifier: "Applied research",
        latexCode: "\\documentclass{article}",
        pdfUpdatedAt: "2026-04-15T12:00:00.000Z",
        positionTitle: "Research Engineer",
        status: "ready",
        updatedAt: "2026-04-15T12:00:00.000Z",
      },
    ],
    workspace: {
      isBaseResumeStepComplete: true,
      updatedAt: "2026-04-15T12:00:00.000Z",
    },
  });

  assert.equal(profile.workspace.isBaseResumeStepComplete, true);
  assert.equal(profile.tailoredResumes[0]?.companyName, "OpenAI");
  assert.equal(profile.tailoredResumes[0]?.edits.length, 1);
  assert.equal(
    profile.tailoredResumes[0]?.edits[0]?.reason,
    'Highlights CI/CD work. Matches "CI/CD" in the job description.',
  );
  assert.equal(profile.tailoredResumes[0]?.positionTitle, "Research Engineer");
  assert.equal(profile.tailoredResumes[0]?.jobIdentifier, "Applied research");
});

test("parseTailorResumeProfile backfills tailored resume metadata from displayName", () => {
  const profile = parseTailorResumeProfile({
    tailoredResumes: [
      {
        annotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: document.documentclass-article-1\n\\documentclass{article}",
        createdAt: "2026-04-15T12:00:00.000Z",
        displayName: "Anthropic - Product Engineer",
        error: null,
        id: "tailored-legacy",
        jobDescription: "Legacy job description",
        latexCode: "\\documentclass{article}",
        pdfUpdatedAt: null,
        status: "ready",
        updatedAt: "2026-04-15T12:00:00.000Z",
      },
    ],
  });

  assert.equal(profile.tailoredResumes[0]?.companyName, "Anthropic");
  assert.deepEqual(profile.tailoredResumes[0]?.edits, []);
  assert.equal(profile.tailoredResumes[0]?.positionTitle, "Product Engineer");
  assert.equal(profile.tailoredResumes[0]?.jobIdentifier, "General");
});
