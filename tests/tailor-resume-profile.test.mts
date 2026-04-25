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
  assert.equal(
    typeof profile.promptSettings.values.resumeLatexExtraction,
    "string",
  );
  assert.equal(
    typeof profile.promptSettings.values.tailorResumeInterview,
    "string",
  );
  assert.equal(
    typeof profile.promptSettings.values.tailorResumeRefinement,
    "string",
  );
  assert.equal(
    profile.generationSettings.values.allowTailorResumeFollowUpQuestions,
    true,
  );
  assert.equal(
    profile.generationSettings.values.preventPageCountIncrease,
    true,
  );
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

test("parseTailorResumeProfile merges saved prompt overrides onto the defaults", () => {
  const profile = parseTailorResumeProfile({
    promptSettings: {
      updatedAt: "2026-04-20T12:00:00.000Z",
      values: {
        tailorResumePlanning: "Custom planning prompt",
      },
    },
  });

  assert.equal(profile.promptSettings.updatedAt, "2026-04-20T12:00:00.000Z");
  assert.equal(
    profile.promptSettings.values.tailorResumePlanning,
    "Custom planning prompt",
  );
  assert.equal(
    typeof profile.promptSettings.values.resumeLatexExtraction,
    "string",
  );
  assert.equal(
    typeof profile.promptSettings.values.tailorResumeInterview,
    "string",
  );
  assert.equal(
    typeof profile.promptSettings.values.tailorResumeRefinement,
    "string",
  );
  assert.equal(
    profile.generationSettings.values.allowTailorResumeFollowUpQuestions,
    true,
  );
  assert.equal(
    profile.generationSettings.values.preventPageCountIncrease,
    true,
  );
});

test("emptyTailorResumeProfile defaults to an empty LaTeX draft", () => {
  const profile = emptyTailorResumeProfile();

  assert.equal(profile.latex.code, "");
  assert.equal(profile.annotatedLatex.code, "");
  assert.equal(profile.annotatedLatex.segmentCount, 0);
  assert.equal(profile.extraction.status, "idle");
  assert.deepEqual(profile.links, []);
  assert.equal(profile.promptSettings.updatedAt, null);
  assert.equal(
    typeof profile.promptSettings.values.jobApplicationExtraction,
    "string",
  );
  assert.equal(
    profile.generationSettings.values.allowTailorResumeFollowUpQuestions,
    true,
  );
  assert.equal(
    profile.generationSettings.values.preventPageCountIncrease,
    true,
  );
  assert.equal(profile.resume, null);
  assert.deepEqual(profile.tailoredResumes, []);
  assert.equal(profile.workspace.isBaseResumeStepComplete, false);
});

test("parseTailorResumeProfile keeps saved generation settings", () => {
  const profile = parseTailorResumeProfile({
    generationSettings: {
      updatedAt: "2026-04-20T12:00:00.000Z",
      values: {
        allowTailorResumeFollowUpQuestions: false,
        preventPageCountIncrease: false,
      },
    },
  });

  assert.equal(
    profile.generationSettings.updatedAt,
    "2026-04-20T12:00:00.000Z",
  );
  assert.equal(
    profile.generationSettings.values.allowTailorResumeFollowUpQuestions,
    false,
  );
  assert.equal(
    profile.generationSettings.values.preventPageCountIncrease,
    false,
  );
});

test("parseTailorResumeProfile keeps an active tailoring interview", () => {
  const profile = parseTailorResumeProfile({
    workspace: {
      isBaseResumeStepComplete: true,
      tailoringInterview: {
        accumulatedModelDurationMs: 2450,
        applicationId: "application-1",
        conversation: [
          {
            id: "assistant-1",
            role: "assistant",
            text: "I have up to 2 quick questions.\n\nWhat scale did this migration reach?",
          },
        ],
        createdAt: "2026-04-20T10:00:00.000Z",
        generationSourceSnapshot: {
          latexCode: "\\documentclass{article}",
          linkState: "[]",
          lockedLinkState: "[]",
          resumeStoragePath: "/uploads/resumes/user/resume.pdf",
          resumeUpdatedAt: "2026-04-20T09:55:00.000Z",
        },
        id: "interview-1",
        jobDescription: "Role text",
        planningDebug: {
          outputJson:
            '{\n  "changes": [\n    {\n      "segmentId": "experience.entry-1.bullet-1",\n      "desiredPlainText": "Tailored bullet",\n      "reason": "Highlights migration ownership."\n    }\n  ]\n}',
          prompt: "First call prompt",
          skippedReason: null,
        },
        planningResult: {
          changes: [
            {
              desiredPlainText: "Tailored bullet",
              reason: "Highlights migration ownership.",
              segmentId: "experience.entry-1.bullet-1",
            },
          ],
          companyName: "OpenAI",
          displayName: "OpenAI - Research Engineer",
          jobIdentifier: "Applied research",
          positionTitle: "Research Engineer",
          questioningSummary: {
            agenda: "the migration scope and ownership in the existing platform bullet",
            askedQuestionCount: 1,
            debugDecision: "would_ask_without_debug",
            learnings: [
              {
                detail: "No confirmed detail yet.",
                targetSegmentIds: ["experience.entry-1.bullet-1"],
                topic: "migration scope",
              },
            ],
          },
          thesis: {
            jobDescriptionFocus: "Research systems delivery",
            resumeChanges: "Elevates the most relevant platform work.",
          },
        },
        sourceAnnotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{Original bullet}",
        tailorResumeRunId: "tailor-run-1",
        updatedAt: "2026-04-20T10:01:00.000Z",
      },
      updatedAt: "2026-04-20T10:01:00.000Z",
    },
  });

  assert.equal(profile.workspace.tailoringInterview?.id, "interview-1");
  assert.equal(
    profile.workspace.tailoringInterview?.planningResult.questioningSummary
      ?.askedQuestionCount,
    1,
  );
  assert.equal(
    profile.workspace.tailoringInterview?.planningResult.questioningSummary
      ?.debugDecision,
    "would_ask_without_debug",
  );
  assert.equal(
    profile.workspace.tailoringInterview?.conversation[0]?.role,
    "assistant",
  );
  assert.equal(profile.workspace.tailoringInterview?.applicationId, "application-1");
  assert.equal(
    profile.workspace.tailoringInterview?.tailorResumeRunId,
    "tailor-run-1",
  );
  assert.equal(profile.workspace.tailoringInterviews.length, 1);
  assert.equal(profile.workspace.tailoringInterviews[0]?.id, "interview-1");
});

test("parseTailorResumeProfile keeps parallel tailoring interviews and preserves the first alias", () => {
  const profile = parseTailorResumeProfile({
    workspace: {
      isBaseResumeStepComplete: true,
      tailoringInterviews: [
        {
          accumulatedModelDurationMs: 2450,
          applicationId: "application-1",
          completionRequestedAt: null,
          conversation: [],
          createdAt: "2026-04-20T10:00:00.000Z",
          generationSourceSnapshot: {
            latexCode: "\\documentclass{article}",
            linkState: "[]",
            lockedLinkState: "[]",
            resumeStoragePath: "/uploads/resumes/user/resume.pdf",
            resumeUpdatedAt: "2026-04-20T09:55:00.000Z",
          },
          id: "interview-1",
          jobDescription: "Role text",
          jobUrl: "https://jobs.example.com/roles/1",
          planningDebug: {
            outputJson: null,
            prompt: "First call prompt",
            skippedReason: null,
          },
          planningResult: {
            changes: [],
            companyName: "OpenAI",
            displayName: "OpenAI - Research Engineer",
            jobIdentifier: "Applied research",
            positionTitle: "Research Engineer",
            questioningSummary: null,
            thesis: {
              jobDescriptionFocus: "Research systems delivery",
              resumeChanges: "Elevates the most relevant platform work.",
            },
          },
          sourceAnnotatedLatexCode:
            "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{Original bullet}",
          tailorResumeRunId: "tailor-run-1",
          updatedAt: "2026-04-20T10:01:00.000Z",
        },
        {
          accumulatedModelDurationMs: 1500,
          applicationId: "application-2",
          completionRequestedAt: "2026-04-20T11:05:00.000Z",
          conversation: [],
          createdAt: "2026-04-20T11:00:00.000Z",
          generationSourceSnapshot: {
            latexCode: "\\documentclass{article}",
            linkState: "[]",
            lockedLinkState: "[]",
            resumeStoragePath: "/uploads/resumes/user/resume.pdf",
            resumeUpdatedAt: "2026-04-20T10:55:00.000Z",
          },
          id: "interview-2",
          jobDescription: "Another role",
          jobUrl: "https://jobs.example.com/roles/2",
          planningDebug: {
            outputJson: null,
            prompt: "Second call prompt",
            skippedReason: null,
          },
          planningResult: {
            changes: [],
            companyName: "Anthropic",
            displayName: "Anthropic - Product Engineer",
            jobIdentifier: "Product systems",
            positionTitle: "Product Engineer",
            questioningSummary: null,
            thesis: {
              jobDescriptionFocus: "Product engineering execution",
              resumeChanges: "Highlights product ownership and iteration speed.",
            },
          },
          sourceAnnotatedLatexCode:
            "% JOBHELPER_SEGMENT_ID: experience.entry-2.bullet-1\n\\resumeitem{Original bullet}",
          tailorResumeRunId: "tailor-run-2",
          updatedAt: "2026-04-20T11:01:00.000Z",
        },
      ],
      updatedAt: "2026-04-20T11:01:00.000Z",
    },
  });

  assert.equal(profile.workspace.tailoringInterviews.length, 2);
  assert.equal(profile.workspace.tailoringInterviews[0]?.id, "interview-1");
  assert.equal(profile.workspace.tailoringInterviews[1]?.id, "interview-2");
  assert.equal(profile.workspace.tailoringInterview?.id, "interview-1");
});

test("parseTailorResumeProfile upgrades a legacy singular tailoring interview into the array", () => {
  const profile = parseTailorResumeProfile({
    workspace: {
      isBaseResumeStepComplete: true,
      tailoringInterview: {
        accumulatedModelDurationMs: 2450,
        applicationId: "application-1",
        completionRequestedAt: null,
        conversation: [],
        createdAt: "2026-04-20T10:00:00.000Z",
        generationSourceSnapshot: {
          latexCode: "\\documentclass{article}",
          linkState: "[]",
          lockedLinkState: "[]",
          resumeStoragePath: "/uploads/resumes/user/resume.pdf",
          resumeUpdatedAt: "2026-04-20T09:55:00.000Z",
        },
        id: "interview-1",
        jobDescription: "Role text",
        jobUrl: "https://jobs.example.com/roles/1",
        planningDebug: {
          outputJson: null,
          prompt: "First call prompt",
          skippedReason: null,
        },
        planningResult: {
          changes: [],
          companyName: "OpenAI",
          displayName: "OpenAI - Research Engineer",
          jobIdentifier: "Applied research",
          positionTitle: "Research Engineer",
          questioningSummary: null,
          thesis: {
            jobDescriptionFocus: "Research systems delivery",
            resumeChanges: "Elevates the most relevant platform work.",
          },
        },
        sourceAnnotatedLatexCode:
          "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{Original bullet}",
        tailorResumeRunId: "tailor-run-1",
        updatedAt: "2026-04-20T10:01:00.000Z",
      },
      updatedAt: "2026-04-20T10:01:00.000Z",
    },
  });

  assert.equal(profile.workspace.tailoringInterview?.id, "interview-1");
  assert.deepEqual(
    profile.workspace.tailoringInterviews.map((interview) => interview.id),
    ["interview-1"],
  );
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
            generatedByStep: 4,
            reason: 'Highlights CI/CD work. Matches "CI/CD" in the job description.',
            segmentId: "experience.entry-1.bullet-1",
          },
        ],
        error: null,
        id: "tailored-1",
        jobDescription: "Job description text",
        jobIdentifier: "Applied research",
        jobUrl: "https://jobs.example.com/openai/research-engineer",
        latexCode: "\\documentclass{article}",
        openAiDebug: {
          implementation: {
            outputJson:
              '{\n  "changes": [\n    {\n      "segmentId": "experience.entry-1.bullet-1",\n      "latexCode": "\\\\resumeitem{Tailored bullet}"\n    }\n  ]\n}',
            prompt: "Second call prompt",
            skippedReason: null,
          },
          planning: {
            outputJson:
              '{\n  "changes": [\n    {\n      "segmentId": "experience.entry-1.bullet-1",\n      "desiredPlainText": "Tailored bullet",\n      "reason": "Highlights CI/CD work."\n    }\n  ]\n}',
            prompt: "First call prompt",
            skippedReason: null,
          },
        },
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
  assert.equal(profile.tailoredResumes[0]?.edits[0]?.generatedByStep, 4);
  assert.equal(profile.tailoredResumes[0]?.edits[0]?.state, "applied");
  assert.equal(profile.tailoredResumes[0]?.positionTitle, "Research Engineer");
  assert.equal(profile.tailoredResumes[0]?.jobIdentifier, "Applied research");
  assert.equal(
    profile.tailoredResumes[0]?.jobUrl,
    "https://jobs.example.com/openai/research-engineer",
  );
  assert.equal(
    profile.tailoredResumes[0]?.planningResult.changes[0]?.desiredPlainText,
    "Tailored bullet",
  );
  assert.equal(
    profile.tailoredResumes[0]?.openAiDebug.planning.prompt,
    "First call prompt",
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
        openAiDebug: {
          implementation: {
            outputJson:
              '{\n  "changes": [\n    {\n      "segmentId": "experience.entry-1.bullet-1",\n      "latexCode": "\\\\resumeitem{Model suggested bullet}"\n    }\n  ]\n}',
            prompt: "Second call prompt",
            skippedReason: null,
          },
          planning: {
            outputJson:
              '{\n  "changes": [\n    {\n      "segmentId": "experience.entry-1.bullet-1",\n      "desiredPlainText": "Model suggested bullet",\n      "reason": "Model edit"\n    }\n  ]\n}',
            prompt: "First call prompt",
            skippedReason: null,
          },
        },
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

test("parseTailorResumeProfile drops tailored resumes without the saved openai debug trace", () => {
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
        planningResult: {
          changes: [],
          companyName: "Anthropic",
          displayName: "Anthropic - Product Engineer",
          jobIdentifier: "General",
          positionTitle: "Product Engineer",
          thesis: {
            jobDescriptionFocus: "Legacy focus",
            resumeChanges: "Legacy changes",
          },
        },
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

  assert.deepEqual(profile.tailoredResumes, []);
});
