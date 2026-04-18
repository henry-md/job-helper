import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailoredResumeHighlightedPreviewUrl,
  buildTailoredResumePreviewPdfUrl,
} from "../lib/tailored-resume-preview-url.ts";

test("tailored preview url stays addressable even before pdfUpdatedAt exists", () => {
  assert.equal(
    buildTailoredResumePreviewPdfUrl({
      id: "resume-123",
      pdfUpdatedAt: null,
    }),
    "/api/tailor-resume/preview?tailoredResumeId=resume-123",
  );
});

test("tailored preview url keeps updatedAt for cache busting when present", () => {
  assert.equal(
    buildTailoredResumePreviewPdfUrl({
      id: "resume-123",
      pdfUpdatedAt: "2026-04-18T20:00:00.000Z",
    }),
    "/api/tailor-resume/preview?tailoredResumeId=resume-123&updatedAt=2026-04-18T20%3A00%3A00.000Z",
  );
});

test("highlighted tailored preview stays addressable without a compiled pdf timestamp", () => {
  assert.equal(
    buildTailoredResumeHighlightedPreviewUrl({
      edits: [{} as never, {} as never],
      id: "resume-123",
      pdfUpdatedAt: null,
    }),
    "/api/tailor-resume/preview?highlights=true&tailoredResumeId=resume-123",
  );
});
