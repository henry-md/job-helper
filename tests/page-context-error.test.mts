import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_CONTEXT_UNAVAILABLE_MESSAGE,
  formatPageContextErrorMessage,
  isPageContextConnectionError,
} from "../extension/src/page-context.ts";

test("formats Chrome missing content-script listeners as a page capture issue", () => {
  const error = new Error(
    "Could not establish connection. Receiving end does not exist.",
  );

  assert.equal(isPageContextConnectionError(error), true);
  assert.equal(formatPageContextErrorMessage(error), PAGE_CONTEXT_UNAVAILABLE_MESSAGE);
});

test("keeps unrelated page context errors intact", () => {
  assert.equal(
    formatPageContextErrorMessage(new Error("The content script returned unusable page details.")),
    "The content script returned unusable page details.",
  );
});
