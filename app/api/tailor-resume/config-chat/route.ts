import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import {
  deleteTailorResumeConfigChat,
  readTailorResumeConfigChat,
  submitTailorResumeConfigChat,
} from "@/lib/tailor-resume-config-chat";

export const runtime = "nodejs";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to use chat." }, { status: 401 });
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return NextResponse.json(
    await readTailorResumeConfigChat({
      userId: session.user.id,
    }),
  );
}

export async function DELETE(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return NextResponse.json(
    await deleteTailorResumeConfigChat({
      userId: session.user.id,
    }),
  );
}

export async function POST(request: Request) {
  const session = await getApiSession(request);

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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const draftLatexCode =
    typeof payload.draftLatexCode === "string" ? payload.draftLatexCode : "";
  const message = typeof payload.message === "string" ? payload.message : "";

  try {
    return NextResponse.json(
      await submitTailorResumeConfigChat({
        draftLatexCode,
        message,
        userId: session.user.id,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: readErrorMessage(error, "Unable to answer from config chat."),
      },
      { status: 400 },
    );
  }
}
