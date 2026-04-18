import {
  rebuildTailoredResumeAnnotatedLatex,
  resolveTailoredResumeSourceAnnotatedLatex,
} from "./tailor-resume-edit-history.ts";
import { repairTailoredResumeModelLatexBlock } from "./tailor-resume-tailoring.ts";
import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";
import type { TailoredResumeRecord } from "./tailor-resume-types.ts";

export function repairTailoredResumeForCompile(record: TailoredResumeRecord) {
  let didChange = false;
  const repairedEdits = record.edits.map((edit) => {
    if (edit.source !== "model") {
      return edit;
    }

    const repairedAfterLatexCode = repairTailoredResumeModelLatexBlock(
      edit.afterLatexCode,
    );

    if (repairedAfterLatexCode === edit.afterLatexCode) {
      return edit;
    }

    didChange = true;

    return {
      ...edit,
      afterLatexCode: repairedAfterLatexCode,
    };
  });

  if (!didChange) {
    return {
      didChange,
      record,
    };
  }

  const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex({
    annotatedLatexCode: record.annotatedLatexCode,
    edits: record.edits,
    sourceAnnotatedLatexCode: record.sourceAnnotatedLatexCode,
  });
  const annotatedLatexCode = rebuildTailoredResumeAnnotatedLatex({
    annotatedLatexCode: record.annotatedLatexCode,
    edits: repairedEdits,
    sourceAnnotatedLatexCode,
  });

  return {
    didChange,
    record: {
      ...record,
      annotatedLatexCode,
      edits: repairedEdits,
      latexCode: stripTailorResumeSegmentIds(annotatedLatexCode),
      sourceAnnotatedLatexCode,
    } satisfies TailoredResumeRecord,
  };
}
