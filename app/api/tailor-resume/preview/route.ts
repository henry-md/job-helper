import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { compileTailorResumeLatex } from "@/lib/tailor-resume-latex";
import { buildTailoredResumeReviewHighlightedLatex } from "@/lib/tailor-resume-preview-highlight";
import {
  readTailorResumeProfile,
  readTailoredResumePdf,
  readTailorResumePreviewPdf,
} from "@/lib/tailor-resume-storage";

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
        previewPdf = await readTailoredResumePdf(session.user.id, tailoredResumeId);
      }
    } else {
      previewPdf = tailoredResumeId
        ? await readTailoredResumePdf(session.user.id, tailoredResumeId)
        : await readTailorResumePreviewPdf(session.user.id);
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
