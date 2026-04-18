import assert from "node:assert/strict";
import test from "node:test";
import { formatTailoredResumeSidebarName } from "../lib/tailored-resume-sidebar-name.ts";

test("formatTailoredResumeSidebarName keeps short display names unchanged", () => {
  assert.equal(
    formatTailoredResumeSidebarName({
      companyName: "Microsoft",
      displayName: "Microsoft - Software Engineer",
      positionTitle: "Software Engineer",
    }),
    "Microsoft - Software Engineer",
  );
});

test("formatTailoredResumeSidebarName abbreviates long parenthetical titles", () => {
  assert.equal(
    formatTailoredResumeSidebarName({
      companyName: "Microsoft",
      displayName: "Microsoft - Software Engineer (Azure Client Team)",
      positionTitle: "Software Engineer (Azure Client Team)",
    }),
    "Microsoft - Software Engineer (ACT)",
  );
});

test("formatTailoredResumeSidebarName falls back to the role label when company plus role is too wide", () => {
  assert.equal(
    formatTailoredResumeSidebarName(
      {
        companyName: "International Business Machines Corporation",
        displayName:
          "International Business Machines Corporation - Senior Software Engineer",
        positionTitle: "Senior Software Engineer",
      },
      {
        maxLength: 44,
      },
    ),
    "Senior Software Engineer",
  );
});

test("formatTailoredResumeSidebarName truncates the most compact fallback when needed", () => {
  assert.equal(
    formatTailoredResumeSidebarName(
      {
        companyName: "",
        displayName: "Extremely Long Title Without Breaks",
        positionTitle: "Extremely Long Title Without Breaks",
      },
      {
        maxLength: 18,
      },
    ),
    "Extremely Long...",
  );
});
