import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { readTailorResumePreviewPdf } from "@/lib/tailor-resume-storage";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in to view your resume preview." },
      { status: 401 },
    );
  }

  try {
    const previewPdf = await readTailorResumePreviewPdf(session.user.id);

    return new NextResponse(previewPdf, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json(
        { error: "No preview PDF is available yet." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Unable to load the resume preview." },
      { status: 500 },
    );
  }
}
