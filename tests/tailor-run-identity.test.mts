import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorRunIdentityDisplay,
  readTailorRunDisplayUrl,
} from "../extension/src/tailor-run-identity.ts";

test("buildTailorRunIdentityDisplay prefers structured company and role labels", () => {
  assert.deepEqual(
    buildTailorRunIdentityDisplay({
      companyName: "Microsoft",
      positionTitle: "Software Engineer",
    }),
    {
      label: "Microsoft \u2014 Software Engineer",
      title: "Microsoft \u2014 Software Engineer",
    },
  );
});

test("buildTailorRunIdentityDisplay falls back to a single available label", () => {
  assert.deepEqual(
    buildTailorRunIdentityDisplay({
      companyName: "Microsoft",
      positionTitle: null,
    }),
    {
      label: "Microsoft",
      title: "Microsoft",
    },
  );
  assert.deepEqual(
    buildTailorRunIdentityDisplay({
      companyName: null,
      positionTitle: "Software Engineer",
    }),
    {
      label: "Software Engineer",
      title: "Software Engineer",
    },
  );
});

test("readTailorRunDisplayUrl strips query params and hashes from URLs", () => {
  assert.equal(
    readTailorRunDisplayUrl(
      "https://jobs.example.com/roles/123?gh_src=foo#overview",
    ),
    "jobs.example.com/roles/123",
  );
});
