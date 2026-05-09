import { measureTailorResumeLayout } from "./tailor-resume-layout-measurement.ts";
import { findTailorResumeReplacementTarget } from "./tailor-resume-replacement-target.ts";
import {
  extractTailorResumeResumeExperiences,
  findTailorResumeResumeExperience,
} from "./tailor-resume-resume-experiences.ts";
import { applyTailorResumeBlockChanges } from "./tailor-resume-tailoring.ts";
import {
  isTailorResumeMalformedSpareBulletLine,
  readTailorResumeLastLineFillRatio,
  type TailorResumeSpareBulletLineMeasurement,
} from "./tailor-resume-spare-bullet-line-display.ts";

function escapePlainTextForLatex(value: string) {
  return value.replace(/[\\{}#%&$_^~]/g, (character) => {
    switch (character) {
      case "\\":
        return String.raw`\textbackslash{}`;
      case "{":
        return String.raw`\{`;
      case "}":
        return String.raw`\}`;
      case "#":
        return String.raw`\#`;
      case "%":
        return String.raw`\%`;
      case "&":
        return String.raw`\&`;
      case "$":
        return String.raw`\$`;
      case "_":
        return String.raw`\_`;
      case "^":
        return String.raw`\^{}`;
      case "~":
        return String.raw`\~{}`;
      default:
        return character;
    }
  });
}

function buildResumeItemLatex(quote: string) {
  return String.raw`\resumeitem{${escapePlainTextForLatex(
    quote.replace(/\s+/g, " ").trim(),
  )}}`;
}

function chooseMeasurementTargetSegmentId(input: {
  replacesQuote?: string | null;
  resumeExperienceId: string;
  sourceAnnotatedLatexCode: string;
}) {
  if (input.replacesQuote?.trim()) {
    const replacementTarget = findTailorResumeReplacementTarget({
      resumeExperienceId: input.resumeExperienceId,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      sourceQuote: input.replacesQuote,
    });

    if (replacementTarget) {
      return replacementTarget.segmentId;
    }
  }

  const experience = findTailorResumeResumeExperience(
    extractTailorResumeResumeExperiences(input.sourceAnnotatedLatexCode),
    input.resumeExperienceId,
  );

  return experience?.bulletSegmentIds[0] ?? null;
}

export async function measureTailorResumeSpareBulletLineCount(input: {
  quote: string;
  replacesQuote?: string | null;
  resumeExperienceId: string;
  sourceAnnotatedLatexCode: string;
}): Promise<TailorResumeSpareBulletLineMeasurement> {
  const quote = input.quote.trim();
  const resumeExperienceId = input.resumeExperienceId.trim();

  if (!quote) {
    throw new Error("Provide the spare bullet text to measure.");
  }

  if (!resumeExperienceId) {
    throw new Error("Choose the resume experience before measuring the bullet.");
  }

  const targetSegmentId = chooseMeasurementTargetSegmentId({
    replacesQuote: input.replacesQuote,
    resumeExperienceId,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
  });

  if (!targetSegmentId) {
    throw new Error(
      "Choose an experience with at least one bullet before measuring line count.",
    );
  }

  const candidateLatex = applyTailorResumeBlockChanges({
    annotatedLatexCode: input.sourceAnnotatedLatexCode,
    changes: [
      {
        latexCode: buildResumeItemLatex(quote),
        reason: "Measure spare bullet rendered line count.",
        segmentId: targetSegmentId,
      },
    ],
  });
  const layout = await measureTailorResumeLayout({
    annotatedLatexCode: candidateLatex.annotatedLatex,
  });
  const segment = layout.segments.find(
    (candidate) => candidate.segmentId === targetSegmentId,
  );

  if (!segment) {
    throw new Error("The measured bullet segment could not be found.");
  }

  const lastLineFillRatio = readTailorResumeLastLineFillRatio(
    segment.lines.map((line) => line.width),
  );

  return {
    lastLineFillRatio,
    lineCount: segment.lineCount,
    malformed: isTailorResumeMalformedSpareBulletLine({
      lastLineFillRatio,
      lineCount: segment.lineCount,
    }),
    pageCount: layout.pageCount,
    targetSegmentId,
  };
}
