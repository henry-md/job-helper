import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractTailorResumeActualLatexError } from "@/lib/tailor-resume-error-format";
import { compileTailorResumeLatex } from "@/lib/tailor-resume-latex";
import { buildTailoredResumeReviewHighlightedLatex } from "@/lib/tailor-resume-preview-highlight";
import { repairTailoredResumeForCompile } from "@/lib/tailored-resume-repair";
import {
  deleteTailoredResumePdf,
  readTailorResumeProfile,
  readTailoredResumePdf,
  readTailorResumePreviewPdf,
  withTailorResumeProfileLock,
  writeTailoredResumePdf,
  writeTailorResumeProfile,
} from "@/lib/tailor-resume-storage";

async function readOrCompileTailoredResumePdf(input: {
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

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in to view your resume preview." },
      { status: 401 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const tailoredResumeId = searchParams.get("tailoredResumeId");
    const withHighlights = searchParams.get("highlights") === "true";
    let previewPdf: Buffer;

    if (tailoredResumeId && withHighlights) {
      const profile = await readTailorResumeProfile(session.user.id);
      const tailoredResume = profile.tailoredResumes.find(
        (record) => record.id === tailoredResumeId,
      );

      if (!tailoredResume) {
        return NextResponse.json(
          { error: "The tailored resume preview could not be found." },
          { status: 404 },
        );
      }

      try {
        const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
          annotatedLatexCode: tailoredResume.annotatedLatexCode,
          edits: tailoredResume.edits,
          sourceAnnotatedLatexCode: tailoredResume.sourceAnnotatedLatexCode,
        });
        previewPdf = await compileTailorResumeLatex(highlightedLatex);
      } catch {
        const recoveredPreviewPdf = await readOrCompileTailoredResumePdf({
          tailoredResumeId,
          userId: session.user.id,
        });

        if (!recoveredPreviewPdf) {
          return NextResponse.json(
            { error: "The tailored resume preview could not be found." },
            { status: 404 },
          );
        }

        previewPdf = recoveredPreviewPdf;
      }
    } else {
      if (tailoredResumeId) {
        const recoveredPreviewPdf = await readOrCompileTailoredResumePdf({
          tailoredResumeId,
          userId: session.user.id,
        });

        if (!recoveredPreviewPdf) {
          return NextResponse.json(
            { error: "The tailored resume preview could not be found." },
            { status: 404 },
          );
        }

        previewPdf = recoveredPreviewPdf;
      } else {
        previewPdf = await readTailorResumePreviewPdf(session.user.id);
      }
    }

    const previewBytes = Uint8Array.from(previewPdf);
    const previewBody = new Blob([previewBytes], {
      type: "application/pdf",
    });

    return new NextResponse(previewBody, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json(
        {
          error: "No preview PDF is available yet.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Unable to load the resume preview." },
      { status: 500 },
    );
  }
}
