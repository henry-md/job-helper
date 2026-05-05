import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPendingInterviewExistingTailoringState,
  readTailorResumeExistingTailoringStates,
} from "../lib/tailor-resume-existing-tailoring-state.ts";
import type { TailorResumePendingInterview } from "../lib/tailor-resume-types.ts";

test("readTailorResumeExistingTailoringStates dedupes active runs by comparable job URL", () => {
  const activeTailorings = readTailorResumeExistingTailoringStates({
    activeTailorings: [
      {
        companyName: "Amentum",
        createdAt: "2026-04-29T19:00:00.000Z",
        id: "run-older",
        jobDescription: "Role text",
        jobIdentifier: "R0160036",
        jobUrl:
          "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160036",
        kind: "active_generation",
        lastStep: null,
        positionTitle: "Entry Level Software Engineer",
        updatedAt: "2026-04-29T19:00:00.000Z",
      },
      {
        companyName: "Amentum",
        createdAt: "2026-04-29T19:05:00.000Z",
        id: "run-newer",
        jobDescription: "Role text",
        jobIdentifier: "R0160036",
        jobUrl:
          "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?utm_source=Simplify&ref=Simplify",
        kind: "active_generation",
        lastStep: null,
        positionTitle: "Entry Level Software Engineer",
        updatedAt: "2026-04-29T19:05:00.000Z",
      },
      {
        companyName: "Amentum",
        createdAt: "2026-04-29T19:03:00.000Z",
        id: "run-neighbor",
        jobDescription: "Role text",
        jobIdentifier: "R0160035",
        jobUrl:
          "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160035?utm_source=Simplify&ref=Simplify",
        kind: "active_generation",
        lastStep: null,
        positionTitle: "Entry Level Software Engineer",
        updatedAt: "2026-04-29T19:03:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    activeTailorings.map((activeTailoring) => activeTailoring.id),
    ["run-newer", "run-neighbor"],
  );
});

test("buildPendingInterviewExistingTailoringState exposes all scraped keywords", () => {
  const interview = {
    accumulatedModelDurationMs: 1200,
    applicationId: "app-123",
    completionRequestedAt: null,
    conversation: [],
    createdAt: "2026-05-05T14:00:00.000Z",
    generationSourceSnapshot: {
      latexCode: "\\documentclass{article}\\begin{document}Hi\\end{document}",
      linkState: "[]",
      lockedLinkState: "[]",
      resumeStoragePath: null,
      resumeUpdatedAt: null,
    },
    id: "interview-123",
    jobDescription: "Role text",
    jobUrl: "https://jobs.example.com/roles/123",
    planningDebug: {
      outputJson: null,
      prompt: null,
      skippedReason: null,
    },
    planningResult: {
      changes: [],
      companyName: "Example Corp",
      displayName: "Example Corp - Software Engineer",
      emphasizedTechnologies: [
        {
          evidence: "Required section lists TypeScript.",
          name: "TypeScript",
          priority: "high",
        },
        {
          evidence: "Required section lists Kubernetes.",
          name: "Kubernetes",
          priority: "high",
        },
      ],
      jobIdentifier: "Software Engineer",
      positionTitle: "Software Engineer",
      questioningSummary: null,
      thesis: {
        jobDescriptionFocus: "Infrastructure platform role.",
        resumeChanges: "Highlight platform experience.",
      },
    },
    pendingUserMarkdownEditOperations: [],
    sourceAnnotatedLatexCode:
      "\\documentclass{article}\\begin{document}Hi\\end{document}",
    status: "pending",
    tailorResumeRunId: "run-123",
    uncoveredEmphasizedTechnologies: [
      {
        evidence: "Resume did not mention Kubernetes.",
        name: "Kubernetes",
        priority: "high",
      },
    ],
    updatedAt: "2026-05-05T14:00:05.000Z",
  } satisfies TailorResumePendingInterview;

  const existingTailoring =
    buildPendingInterviewExistingTailoringState(interview);

  assert.deepEqual(
    existingTailoring.emphasizedTechnologies.map((technology) => technology.name),
    ["TypeScript", "Kubernetes"],
  );
});
