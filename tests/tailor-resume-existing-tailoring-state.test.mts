import assert from "node:assert/strict";
import test from "node:test";
import { readTailorResumeExistingTailoringStates } from "../lib/tailor-resume-existing-tailoring-state.ts";

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
