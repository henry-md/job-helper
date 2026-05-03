import { countPdfPages } from "./tailor-resume-layout-measurement.ts";
import { applyTailorResumeSourceLinkOverridesWithSummary } from "./tailor-resume-link-overrides.ts";
import {
  type TailorResumeLatexDocumentValidationResult,
  validateTailorResumeLatexDocument,
} from "./tailor-resume-link-validation.ts";
import type {
  TailorResumeLockedLinkRecord,
  TailorResumeLinkRecord,
} from "./tailor-resume-types.ts";

export type TailorResumeSourcePreviewResult =
  | {
      compiledLatexCode: string;
      linkSummary: TailorResumeLatexDocumentValidationResult["linkSummary"];
      ok: true;
      pageCount: number;
      pdfBuffer: Buffer;
    }
  | {
      compiledLatexCode: string;
      error: string;
      ok: false;
    };

// Compiles a source-resume draft without mutating the saved profile state.
export async function buildTailorResumeSourcePreview(input: {
  currentLinks: TailorResumeLinkRecord[];
  latexCode: string;
  lockedLinks: TailorResumeLockedLinkRecord[];
}) : Promise<TailorResumeSourcePreviewResult> {
  const compileResult = applyTailorResumeSourceLinkOverridesWithSummary(
    input.latexCode,
    {
      currentLinks: input.currentLinks,
      lockedLinks: input.lockedLinks,
    },
  );
  const validation = await validateTailorResumeLatexDocument(
    compileResult.latexCode,
  );

  if (!validation.ok) {
    return {
      compiledLatexCode: compileResult.latexCode,
      error: validation.error,
      ok: false,
    };
  }

  return {
    compiledLatexCode: compileResult.latexCode,
    linkSummary: validation.linkSummary,
    ok: true,
    pageCount: await countPdfPages(validation.previewPdf),
    pdfBuffer: validation.previewPdf,
  };
}
