import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
} from "./tailor-resume-segmentation.ts";

export type TailorResumePlanningBlock = {
  command: string | null;
  latexCode: string;
  plainText: string;
  segmentId: string;
};

export type TailorResumePlanningSnapshot = {
  blocks: TailorResumePlanningBlock[];
  resumePlainText: string;
};

const excludedPlanningCommands = new Set([
  "begin",
  "documentclass",
  "end",
  "input",
  "newcommand",
  "newenvironment",
  "pagestyle",
  "pdfgentounicode",
  "renewcommand",
  "setlength",
  "setlist",
  "usepackage",
  "urlstyle",
]);

export function buildTailorResumePlanningSnapshot(
  annotatedLatexCode: string,
): TailorResumePlanningSnapshot {
  const normalized = normalizeTailorResumeLatex(annotatedLatexCode);
  const blocks = readAnnotatedTailorResumeBlocks(normalized.annotatedLatex).flatMap(
    (block) => {
      if (block.command && excludedPlanningCommands.has(block.command)) {
        return [];
      }

      const plainText = renderTailoredResumeLatexToPlainText(block.latexCode);

      if (!plainText) {
        return [];
      }

      return [
        {
          command: block.command,
          latexCode: block.latexCode,
          plainText,
          segmentId: block.id,
        } satisfies TailorResumePlanningBlock,
      ];
    },
  );

  return {
    blocks,
    resumePlainText: blocks.map((block) => block.plainText).join("\n"),
  };
}
