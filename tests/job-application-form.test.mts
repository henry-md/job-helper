import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyJobApplicationDraft,
  normalizeJobApplicationWriteInput,
  parseJobApplicationDraftContext,
  validateJobApplicationScreenshotFile,
} from "../lib/job-application-form.ts";

test("createEmptyJobApplicationDraft returns a fresh default draft", () => {
  const firstDraft = createEmptyJobApplicationDraft();
  const secondDraft = createEmptyJobApplicationDraft();

  firstDraft.companyName = "Acme";

  assert.equal(secondDraft.companyName, "");
  assert.equal(secondDraft.status, "APPLIED");
});

test("validateJobApplicationScreenshotFile rejects invalid screenshots", () => {
  assert.equal(
    validateJobApplicationScreenshotFile({
      size: 0,
      type: "image/png",
    }),
    "The screenshot is empty.",
  );
  assert.equal(
    validateJobApplicationScreenshotFile({
      size: 1024,
      type: "application/pdf",
    }),
    "Use a PNG, JPG, or WebP screenshot.",
  );
});

test("parseJobApplicationDraftContext reuses shared draft field parsing", () => {
  const parsedDraft = parseJobApplicationDraftContext(
    JSON.stringify({
      companyName: "Acme",
      employmentType: "contract",
      jobTitle: "Engineer",
      location: "remote",
      status: "INTERVIEW",
    }),
  );

  assert.deepEqual(parsedDraft, {
    appliedAt: "",
    companyName: "Acme",
    employmentType: "contract",
    jobDescription: "",
    jobTitle: "Engineer",
    jobUrl: "",
    location: "remote",
    notes: "",
    onsiteDaysPerWeek: "",
    recruiterContact: "",
    referrerId: "",
    referrerName: "",
    salaryRange: "",
    status: "INTERVIEW",
    teamOrDepartment: "",
  });
});

test("normalizeJobApplicationWriteInput normalizes valid payloads", () => {
  const result = normalizeJobApplicationWriteInput({
    appliedAt: "2026-04-25",
    companyName: " Acme ",
    employmentType: "FULL_TIME",
    jobDescription: " Build things ",
    jobTitle: " Staff Engineer ",
    jobUrl: "https://example.com/jobs/123",
    location: "Hybrid",
    notes: " Important ",
    onsiteDaysPerWeek: "3",
    recruiterContact: " recruiter@example.com ",
    referrerId: " ref-123 ",
    salaryRange: "$120k-$150k",
    status: "interview",
    teamOrDepartment: " Platform ",
  });

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.deepEqual(result.value, {
    appliedAt: "2026-04-25",
    companyName: "Acme",
    employmentType: "full_time",
    jobDescription: "Build things",
    jobTitle: "Staff Engineer",
    jobUrl: "https://example.com/jobs/123",
    location: "hybrid",
    normalizedSalary: result.value.normalizedSalary,
    notes: "Important",
    onsiteDaysPerWeek: 3,
    persistedOnsiteDaysPerWeek: 3,
    recruiterContact: "recruiter@example.com",
    referrerId: "ref-123",
    salaryRange: "$120k-$150k",
    status: "INTERVIEW",
    teamOrDepartment: "Platform",
  });
  assert.equal(result.value.normalizedSalary.text, "120000 - 150000");
});

test("normalizeJobApplicationWriteInput rejects invalid values", () => {
  assert.deepEqual(
    normalizeJobApplicationWriteInput({
      appliedAt: "04/25/2026",
      companyName: "Acme",
      employmentType: "",
      jobDescription: "",
      jobTitle: "Engineer",
      jobUrl: "",
      location: "",
      notes: "",
      onsiteDaysPerWeek: "",
      recruiterContact: "",
      referrerId: "",
      salaryRange: "",
      status: "",
      teamOrDepartment: "",
    }),
    {
      error: "Use YYYY-MM-DD for the applied date.",
      ok: false,
    },
  );
  assert.deepEqual(
    normalizeJobApplicationWriteInput({
      appliedAt: "2026-04-25",
      companyName: "Acme",
      employmentType: "seasonal",
      jobDescription: "",
      jobTitle: "Engineer",
      jobUrl: "notaurl",
      location: "remote",
      notes: "",
      onsiteDaysPerWeek: "9",
      recruiterContact: "",
      referrerId: "",
      salaryRange: "",
      status: "APPLIED",
      teamOrDepartment: "",
    }),
    {
      error: "Onsite days per week must be a whole number between 1 and 7.",
      ok: false,
    },
  );
});
