import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobApplicationDisplayParts,
  stripCompanyNameFromJobTitle,
} from "../lib/job-application-display.ts";

test("buildJobApplicationDisplayParts shows company over de-prefixed position", () => {
  assert.deepEqual(
    buildJobApplicationDisplayParts({
      companyName: "SeatGeek",
      jobTitle: "SeatGeek - Software Engineer - New Grad",
    }),
    {
      companyName: "SeatGeek",
      positionName: "Software Engineer - New Grad",
    },
  );
});

test("stripCompanyNameFromJobTitle handles common title/company formats", () => {
  assert.equal(
    stripCompanyNameFromJobTitle({
      companyName: "Acme AI",
      jobTitle: "Acme AI: Staff Engineer",
    }),
    "Staff Engineer",
  );
  assert.equal(
    stripCompanyNameFromJobTitle({
      companyName: "Notion",
      jobTitle: "Product Engineer at Notion",
    }),
    "Product Engineer",
  );
  assert.equal(
    stripCompanyNameFromJobTitle({
      companyName: "Stripe",
      jobTitle: "Frontend Engineer | Stripe",
    }),
    "Frontend Engineer",
  );
});

test("buildJobApplicationDisplayParts keeps distinct plain job titles", () => {
  assert.deepEqual(
    buildJobApplicationDisplayParts({
      companyName: "Linear",
      jobTitle: "Product Engineer",
    }),
    {
      companyName: "Linear",
      positionName: "Product Engineer",
    },
  );
});
