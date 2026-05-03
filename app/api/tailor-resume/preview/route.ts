import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import { compileTailorResumeLatex } from "@/lib/tailor-resume-latex";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import { buildTailoredResumeReviewHighlightedLatex } from "@/lib/tailor-resume-preview-highlight";
import { buildTailorResumeSourcePreview } from "@/lib/tailor-resume-source-preview";
import { readOrCompileTailoredResumePdf } from "@/lib/tailored-resume-preview-pdf";
import {
  readTailorResumeConfigChatArtifactPdf,
  readTailorResumeProfile,
  readTailorResumePreviewPdf,
} from "@/lib/tailor-resume-storage";

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in to view your resume preview." },
      { status: 401 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const configChatArtifactId =
      searchParams.get("configChatArtifactId")?.trim() ?? "";
    const tailoredResumeId = searchParams.get("tailoredResumeId");
    const withHighlights = searchParams.get("highlights") === "true";
    let previewPdf: Buffer;

    if (configChatArtifactId) {
      previewPdf = await readTailorResumeConfigChatArtifactPdf(
        session.user.id,
        configChatArtifactId,
      );
    } else if (tailoredResumeId && withHighlights) {
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

export async function POST(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in to view your resume preview." },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const latexCode = typeof payload.latexCode === "string" ? payload.latexCode : "";

  if (!latexCode.trim()) {
    return NextResponse.json(
      { error: "Provide LaTeX to preview." },
      { status: 400 },
    );
  }

  const { rawProfile, lockedLinks } = await readTailorResumeProfileState(
    session.user.id,
  );
  const preview = await buildTailorResumeSourcePreview({
    currentLinks: rawProfile.links,
    latexCode,
    lockedLinks,
  });

  if (!preview.ok) {
    return NextResponse.json(
      { error: preview.error },
      { status: 422 },
    );
  }

  return new NextResponse(new Blob([Uint8Array.from(preview.pdfBuffer)], {
    type: "application/pdf",
  }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/pdf",
      "X-JobHelper-Page-Count": String(preview.pageCount),
    },
    status: 200,
  });
}
