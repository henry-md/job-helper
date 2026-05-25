import assert from "node:assert/strict";
import test from "node:test";
import {
  readTailorResumeExistingTailoringStates,
  readTailoredResumeSummaries,
} from "../extension/src/job-helper.ts";

test("extension active tailorings rank only by created time", () => {
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

test("extension tailored resume summaries rank only by created time", () => {
  const tailoredResumes = readTailoredResumeSummaries({
    profile: {
      tailoredResumes: [
        {
          createdAt: "2026-05-24T15:00:00.000Z",
          displayName: "Older but edited",
          id: "tailored-older",
          updatedAt: "2026-05-24T17:00:00.000Z",
        },
        {
          createdAt: "2026-05-24T16:00:00.000Z",
          displayName: "Newer",
          id: "tailored-newer",
          updatedAt: "2026-05-24T16:01:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(
    tailoredResumes.map((tailoredResume) => tailoredResume.id),
    ["tailored-newer", "tailored-older"],
  );
});
