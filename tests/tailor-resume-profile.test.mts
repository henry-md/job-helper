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
        planningResult: {
          changes: [
            {
              desiredPlainText: "Tailored bullet",
              reason:
                'Highlights CI/CD work. Matches "CI/CD" in the job description.',
              segmentId: "experience.entry-1.bullet-1",
            },
          ],
          companyName: "OpenAI",
          displayName: "OpenAI - Research Engineer",
          jobIdentifier: "Applied research",
          positionTitle: "Research Engineer",
          thesis: {
            jobDescriptionFocus:
              "Over-indexes on applied research systems and CI/CD rigor rather than generic software engineering requirements.",
            resumeChanges:
              "Moves the most directly relevant research-platform and delivery bullets higher and makes the systems context more explicit.",
          },
        },
        positionTitle: "Research Engineer",
        status: "ready",
        thesis: {
          jobDescriptionFocus:
            'Over-indexes on applied research systems and CI/CD rigor rather than generic software engineering requirements.',
          resumeChanges:
            "Moves the most directly relevant research-platform and delivery bullets higher and makes the systems context more explicit.",
        },
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
  assert.equal(profile.tailoredResumes[0]?.edits[0]?.editId, "experience.entry-1.bullet-1:1");
  assert.equal(profile.tailoredResumes[0]?.edits[0]?.customLatexCode, null);
  assert.equal(profile.tailoredResumes[0]?.edits[0]?.state, "applied");
  assert.equal(profile.tailoredResumes[0]?.positionTitle, "Research Engineer");
  assert.equal(profile.tailoredResumes[0]?.jobIdentifier, "Applied research");
  assert.equal(
    profile.tailoredResumes[0]?.planningResult.changes[0]?.desiredPlainText,
    "Tailored bullet",
  );
  assert.equal(profile.tailoredResumes[0]?.sourceAnnotatedLatexCode, null);
  assert.equal(
    profile.tailoredResumes[0]?.thesis?.jobDescriptionFocus,
    "Over-indexes on applied research systems and CI/CD rigor rather than generic software engineering requirements.",
  );
  assert.equal(
    profile.tailoredResumes[0]?.thesis?.resumeChanges,
    "Moves the most directly relevant research-platform and delivery bullets higher and makes the systems context more explicit.",
  );
});

test("parseTailorResumeProfile folds legacy model and user rows into one block edit", () => {
  const profile = parseTailorResumeProfile({
    tailoredResumes: [
      {
        annotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{User custom bullet}",
        companyName: "OpenAI",
        createdAt: "2026-04-15T12:00:00.000Z",
        displayName: "OpenAI - Research Engineer",
        edits: [
          {
            afterLatexCode: "\\resumeitem{Model suggested bullet}",
            beforeLatexCode: "\\resumeitem{Original bullet}",
            command: "resumeitem",
            editId: "experience.entry-1.bullet-1:model",
            reason: "Model edit",
            source: "model",
            state: "applied",
            segmentId: "experience.entry-1.bullet-1",
          },
          {
            afterLatexCode: "\\resumeitem{User custom bullet}",
            beforeLatexCode: "\\resumeitem{Model suggested bullet}",
            command: "resumeitem",
            editId: "experience.entry-1.bullet-1:user",
            reason: "User edit",
            source: "user",
            state: "applied",
            segmentId: "experience.entry-1.bullet-1",
          },
        ],
        error: null,
        id: "tailored-legacy-merged",
        jobDescription: "Role text",
        jobIdentifier: "Applied research",
        latexCode: "\\documentclass{article}",
        pdfUpdatedAt: "2026-04-15T12:00:00.000Z",
        planningResult: {
          changes: [
            {
              desiredPlainText: "Model suggested bullet",
              reason: "Model edit",
              segmentId: "experience.entry-1.bullet-1",
            },
          ],
          companyName: "OpenAI",
          displayName: "OpenAI - Research Engineer",
          jobIdentifier: "Applied research",
          positionTitle: "Research Engineer",
          thesis: {
            jobDescriptionFocus: "Legacy focus",
            resumeChanges: "Legacy changes",
          },
        },
        positionTitle: "Research Engineer",
        status: "ready",
        thesis: {
          jobDescriptionFocus: "Legacy focus",
          resumeChanges: "Legacy changes",
        },
        updatedAt: "2026-04-15T12:00:00.000Z",
      },
    ],
  });

  assert.equal(profile.tailoredResumes[0]?.edits.length, 1);
  assert.equal(
    profile.tailoredResumes[0]?.edits[0]?.beforeLatexCode,
    "\\resumeitem{Original bullet}",
  );
  assert.equal(
    profile.tailoredResumes[0]?.edits[0]?.afterLatexCode,
    "\\resumeitem{Model suggested bullet}",
  );
  assert.equal(
    profile.tailoredResumes[0]?.edits[0]?.customLatexCode,
    "\\resumeitem{User custom bullet}",
  );
});

test("parseTailorResumeProfile rebuilds legacy tailored resume metadata when planningResult is missing", () => {
  const profile = parseTailorResumeProfile({
    tailoredResumes: [
      {
        annotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: document.documentclass-article-1\n\\documentclass{article}",
        companyName: "Anthropic",
        createdAt: "2026-04-15T12:00:00.000Z",
        displayName: "Anthropic - Product Engineer",
        error: null,
        id: "tailored-legacy",
        jobDescription: "Legacy job description",
        jobIdentifier: "General",
        latexCode: "\\documentclass{article}",
        pdfUpdatedAt: null,
        positionTitle: "Product Engineer",
        status: "ready",
        thesis: {
          jobDescriptionFocus: "Legacy focus",
          resumeChanges: "Legacy changes",
        },
        updatedAt: "2026-04-15T12:00:00.000Z",
      },
    ],
  });

  assert.equal(profile.tailoredResumes.length, 1);
  assert.equal(profile.tailoredResumes[0]?.planningResult.companyName, "Anthropic");
  assert.equal(profile.tailoredResumes[0]?.planningResult.displayName, "Anthropic - Product Engineer");
  assert.equal(profile.tailoredResumes[0]?.planningResult.positionTitle, "Product Engineer");
  assert.equal(profile.tailoredResumes[0]?.planningResult.jobIdentifier, "General");
  assert.deepEqual(profile.tailoredResumes[0]?.planningResult.changes, []);
});
