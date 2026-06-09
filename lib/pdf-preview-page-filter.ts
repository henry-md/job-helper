// Removes blank trailing PDF pages while preserving real content pages.
export type PdfPreviewTextItem = {
  str: string;
};

export type PdfPreviewTextContent = {
  items?: unknown[];
};

export type PdfPreviewTextPage = {
  getTextContent: () => Promise<PdfPreviewTextContent>;
};

export function hasMeaningfulPdfPageText(textContent: PdfPreviewTextContent) {
  return (textContent.items ?? []).some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "str" in item &&
      typeof item.str === "string" &&
      item.str.trim(),
  );
}

export async function resolveLastMeaningfulPdfPageNumber(input: {
  getPage: (pageNumber: number) => Promise<PdfPreviewTextPage>;
  pageCount: number;
}) {
  const pageCount = Math.max(0, Math.floor(input.pageCount));

  for (let pageNumber = pageCount; pageNumber >= 1; pageNumber -= 1) {
    const page = await input.getPage(pageNumber);
    const textContent = await page.getTextContent();

    if (hasMeaningfulPdfPageText(textContent)) {
      return pageNumber;
    }
  }

  return pageCount;
}
