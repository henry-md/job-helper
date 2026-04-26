import { extractTailorResumeActualLatexError } from "./tailor-resume-error-format.ts";
import { compileTailorResumeLatex } from "./tailor-resume-latex.ts";
import { repairTailoredResumeForCompile } from "./tailored-resume-repair.ts";
import {
  deleteTailoredResumePdf,
  readTailorResumeProfile,
  readTailoredResumePdf,
  withTailorResumeProfileLock,
  writeTailoredResumePdf,
  writeTailorResumeProfile,
} from "./tailor-resume-storage.ts";

export async function readOrCompileTailoredResumePdf(input: {
  tailoredResumeId: string;
  userId: string;
}) {
  return withTailorResumeProfileLock(input.userId, async () => {
    const profile = await readTailorResumeProfile(input.userId);
    const tailoredResumeIndex = profile.tailoredResumes.findIndex(
      (record) => record.id === input.tailoredResumeId,
    );

    if (tailoredResumeIndex === -1) {
      return null;
    }

    const repairedTailoredResume = repairTailoredResumeForCompile(
      profile.tailoredResumes[tailoredResumeIndex],
    ).record;

    if (repairedTailoredResume.pdfUpdatedAt) {
      try {
        return await readTailoredResumePdf(input.userId, input.tailoredResumeId);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    }

    const updatedAt = new Date().toISOString();

    try {
      const previewPdf = await compileTailorResumeLatex(
        repairedTailoredResume.latexCode,
      );

      await writeTailoredResumePdf(input.userId, input.tailoredResumeId, previewPdf);
      await writeTailorResumeProfile(input.userId, {
        ...profile,
        tailoredResumes: profile.tailoredResumes.map((record, index) =>
          index === tailoredResumeIndex
            ? {
                ...repairedTailoredResume,
                error: null,
                pdfUpdatedAt: updatedAt,
                status: "ready",
                updatedAt,
              }
            : record,
        ),
      });

      return previewPdf;
    } catch (error) {
      await deleteTailoredResumePdf(input.userId, input.tailoredResumeId);
      await writeTailorResumeProfile(input.userId, {
        ...profile,
        tailoredResumes: profile.tailoredResumes.map((record, index) =>
          index === tailoredResumeIndex
            ? {
                ...repairedTailoredResume,
                error: extractTailorResumeActualLatexError(
                  error instanceof Error
                    ? error.message
                    : "Unable to compile the tailored resume preview.",
                ),
                pdfUpdatedAt: null,
                status: "failed",
                updatedAt,
              }
            : record,
        ),
      });

      throw error;
    }
  });
}
