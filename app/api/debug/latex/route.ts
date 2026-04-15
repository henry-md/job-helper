import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { isDebugToolsEnabled } from "@/lib/debug-tools";
import { compileTailorResumeLatex } from "@/lib/tailor-resume-latex";

const maxLatexCodeLength = 300_000;

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Sign in to use the LaTeX debug renderer." },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  if (!isDebugToolsEnabled()) {
    return NextResponse.json({ error: "Debug tools are unavailable." }, { status: 404 });
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
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

  if (
    !body ||
    typeof body !== "object" ||
    !("latexCode" in body) ||
    typeof body.latexCode !== "string"
  ) {
    return NextResponse.json(
      { error: "Provide a LaTeX string to render." },
      { status: 400 },
    );
  }

  if (body.latexCode.trim().length === 0) {
    return NextResponse.json(
      { error: "Paste some LaTeX before rendering." },
      { status: 400 },
    );
  }

  if (body.latexCode.length > maxLatexCodeLength) {
    return NextResponse.json(
      { error: "Keep the LaTeX under 300,000 characters." },
      { status: 413 },
    );
  }

  try {
    const previewPdf = await compileTailorResumeLatex(body.latexCode);

    return new NextResponse(previewPdf, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="debug-latex-preview.pdf"',
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to compile the pasted LaTeX.",
      },
      { status: 422 },
    );
  }
}
