import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveTailoringStates,
  buildPendingInterviewExistingTailoringState,
  readTailorResumeExistingTailoringStates,
} from "../lib/tailor-resume-existing-tailoring-state.ts";
import type { TailorResumeDbRunRecord } from "../lib/tailor-resume-route-response-state.ts";
import type { TailorResumePendingInterview } from "../lib/tailor-resume-types.ts";

test("readTailorResumeExistingTailoringStates keeps query-distinct active runs", () => {
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
    ["run-newer", "run-neighbor", "run-older"],
  );
});

test("readTailorResumeExistingTailoringStates ranks only by created time", () => {
  const activeTailorings = readTailorResumeExistingTailoringStates({
    activeTailorings: [
      {
        companyName: "Older Corp",
        createdAt: "2026-05-24T15:00:00.000Z",
        id: "run-older-recently-updated",
        jobDescription: "Role text",
        jobIdentifier: "Older role",
        jobUrl: "https://jobs.example.com/older",
        kind: "active_generation",
        lastStep: null,
        positionTitle: "Software Engineer",
        updatedAt: "2026-05-24T17:00:00.000Z",
      },
      {
        companyName: "Newer Corp",
        createdAt: "2026-05-24T16:00:00.000Z",
        id: "run-newer",
        jobDescription: "Role text",
        jobIdentifier: "Newer role",
        jobUrl: "https://jobs.example.com/newer",
        kind: "active_generation",
        lastStep: null,
        positionTitle: "Software Engineer",
        updatedAt: "2026-05-24T16:01:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    activeTailorings.map((activeTailoring) => activeTailoring.id),
    ["run-newer", "run-older-recently-updated"],
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
          classification: "skills_section",
          evidence: "Required section lists TypeScript.",
          name: "TypeScript",
          priority: "high",
        },
        {
          classification: "skills_section",
          evidence: "Required section lists Kubernetes.",
          name: "Kubernetes",
          priority: "high",
        },
        {
          classification: "narrative",
          evidence: "Posting asks for load balancing.",
          name: "Load balancing",
          priority: "high",
        },
        {
          classification: "skills_section",
          evidence: "Nice-to-have section lists Terraform.",
          name: "Terraform",
          priority: "low",
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
        classification: "skills_section",
        evidence: "Resume did not mention Kubernetes.",
        name: "Kubernetes",
        priority: "high",
      },
      {
        classification: "narrative",
        evidence: "Resume did not mention load balancing.",
        name: "Load balancing",
        priority: "high",
      },
      {
        classification: "skills_section",
        evidence: "Resume did not mention Terraform.",
        name: "Terraform",
        priority: "low",
      },
    ],
    updatedAt: "2026-05-05T14:00:05.000Z",
  } satisfies TailorResumePendingInterview;

  const existingTailoring =
    buildPendingInterviewExistingTailoringState(interview);

  assert.deepEqual(
    existingTailoring.emphasizedTechnologies.map((technology) => technology.name),
    ["TypeScript", "Kubernetes", "Load balancing", "Terraform"],
  );
  assert.deepEqual(
    existingTailoring.blockingTechnologies.map((technology) => technology.name),
    ["Kubernetes", "Terraform"],
  );

  const activeRun = {
    application: {
      company: {
        name: "Example Corp",
      },
      title: "Software Engineer",
    },
    applicationId: "app-123",
    createdAt: new Date("2026-05-05T14:00:00.000Z"),
    error: null,
    id: "run-123",
    jobDescription: "Role text",
    jobUrl: "https://jobs.example.com/roles/123",
    status: "RUNNING",
    stepAttempt: 1,
    stepCount: 5,
    stepDetail: "Starting the planning pass.",
    stepNumber: 3,
    stepRetrying: false,
    stepStatus: "running",
    stepSummary: "Generating edit intent outline",
    updatedAt: new Date("2026-05-05T14:01:00.000Z"),
  } satisfies TailorResumeDbRunRecord;
  const [activeGeneration] = buildActiveTailoringStates({
    activeRuns: [activeRun],
    tailoringInterviews: [{ ...interview, status: "deciding" }],
  });

  assert.equal(activeGeneration?.kind, "active_generation");
  assert.deepEqual(
    activeGeneration?.kind === "active_generation"
      ? activeGeneration.emphasizedTechnologies?.map((technology) => [
          technology.name,
          technology.classification,
        ])
      : [],
    [
      ["TypeScript", "skills_section"],
      ["Kubernetes", "skills_section"],
      ["Load balancing", "narrative"],
      ["Terraform", "skills_section"],
    ],
  );
});

test("buildActiveTailoringStates ranks active runs only by created time", () => {
  const olderRun = {
    application: {
      company: {
        name: "Older Corp",
      },
      title: "Software Engineer",
    },
    applicationId: "app-older",
    createdAt: new Date("2026-05-24T15:00:00.000Z"),
    error: null,
    id: "run-older-recently-updated",
    jobDescription: "Role text",
    jobUrl: "https://jobs.example.com/older",
    status: "RUNNING",
    stepAttempt: null,
    stepCount: null,
    stepDetail: null,
    stepNumber: null,
    stepRetrying: false,
    stepStatus: null,
    stepSummary: null,
    updatedAt: new Date("2026-05-24T17:00:00.000Z"),
  } satisfies TailorResumeDbRunRecord;
  const newerRun = {
    ...olderRun,
    application: {
      company: {
        name: "Newer Corp",
      },
      title: "Software Engineer",
    },
    applicationId: "app-newer",
    createdAt: new Date("2026-05-24T16:00:00.000Z"),
    id: "run-newer",
    jobUrl: "https://jobs.example.com/newer",
    updatedAt: new Date("2026-05-24T16:01:00.000Z"),
  } satisfies TailorResumeDbRunRecord;

  const activeTailorings = buildActiveTailoringStates({
    activeRuns: [olderRun, newerRun],
    tailoringInterviews: [],
  });

  assert.deepEqual(
    activeTailorings.map((activeTailoring) => activeTailoring.id),
    ["run-newer", "run-older-recently-updated"],
  );
});

test("buildActiveTailoringStates ignores interviews whose run is no longer active", () => {
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
      emphasizedTechnologies: [],
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
    status: "ready",
    tailorResumeRunId: "failed-run-123",
    uncoveredEmphasizedTechnologies: [],
    updatedAt: "2026-05-05T14:00:05.000Z",
  } satisfies TailorResumePendingInterview;

  assert.deepEqual(
    buildActiveTailoringStates({
      activeRuns: [],
      tailoringInterviews: [interview],
    }),
    [],
  );

  const activeRun = {
    application: {
      company: {
        name: "Example Corp",
      },
      title: "Software Engineer",
    },
    applicationId: "app-123",
    createdAt: new Date("2026-05-05T14:00:00.000Z"),
    error: null,
    id: "failed-run-123",
    jobDescription: "Role text",
    jobUrl: "https://jobs.example.com/roles/123",
    status: "NEEDS_INPUT",
    stepAttempt: null,
    stepCount: null,
    stepDetail: null,
    stepNumber: null,
    stepRetrying: false,
    stepStatus: null,
    stepSummary: null,
    updatedAt: new Date("2026-05-05T14:00:05.000Z"),
  } satisfies TailorResumeDbRunRecord;

  assert.equal(
    buildActiveTailoringStates({
      activeRuns: [activeRun],
      tailoringInterviews: [interview],
    })[0]?.kind,
    "pending_interview",
  );
});
