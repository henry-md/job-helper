import assert from "node:assert/strict";
import test from "node:test";
import { isJobHelperAppUrl } from "../extension/src/job-helper.ts";

test("isJobHelperAppUrl recognizes the configured app origin", () => {
  assert.equal(isJobHelperAppUrl("http://localhost:1285/dashboard?tab=tailor"), true);
  assert.equal(isJobHelperAppUrl("http://localhost:1285/api/tailor-resume"), true);
});

test("isJobHelperAppUrl treats localhost and 127.0.0.1 as the same local app", () => {
  assert.equal(isJobHelperAppUrl("http://127.0.0.1:1285/dashboard"), true);
});

test("isJobHelperAppUrl does not match external job pages or other local ports", () => {
  assert.equal(isJobHelperAppUrl("https://jobs.example.com/roles/123"), false);
  assert.equal(isJobHelperAppUrl("http://127.0.0.1:1307/roles/123"), false);
});
