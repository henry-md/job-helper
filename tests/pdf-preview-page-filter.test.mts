import assert from "node:assert/strict";
import test from "node:test";
import {
  hasMeaningfulPdfPageText,
  resolveLastMeaningfulPdfPageNumber,
  type PdfPreviewTextContent,
} from "../lib/pdf-preview-page-filter.ts";

function textContent(...strings: string[]): PdfPreviewTextContent {
  return {
    items: strings.map((str) => ({ str })),
  };
}

test("hasMeaningfulPdfPageText ignores empty and whitespace-only text items", () => {
  assert.equal(hasMeaningfulPdfPageText(textContent("", "   ", "\n")), false);
  assert.equal(hasMeaningfulPdfPageText(textContent("", "Resume body")), true);
});

test("resolveLastMeaningfulPdfPageNumber trims trailing blank pages", async () => {
  const pages = new Map([
    [1, textContent("Resume page")],
    [2, textContent(" ")],
  ]);

  const pageNumber = await resolveLastMeaningfulPdfPageNumber({
    getPage: async (page) => ({
      getTextContent: async () => pages.get(page) ?? textContent(),
    }),
    pageCount: 2,
  });

  assert.equal(pageNumber, 1);
});

test("resolveLastMeaningfulPdfPageNumber preserves non-blank final pages", async () => {
  const pages = new Map([
    [1, textContent("Resume page")],
    [2, textContent("Portfolio links")],
  ]);

  const pageNumber = await resolveLastMeaningfulPdfPageNumber({
    getPage: async (page) => ({
      getTextContent: async () => pages.get(page) ?? textContent(),
    }),
    pageCount: 2,
  });

  assert.equal(pageNumber, 2);
});

test("resolveLastMeaningfulPdfPageNumber preserves all-blank documents", async () => {
  const pageNumber = await resolveLastMeaningfulPdfPageNumber({
    getPage: async () => ({
      getTextContent: async () => textContent(),
    }),
    pageCount: 2,
  });

  assert.equal(pageNumber, 2);
});
