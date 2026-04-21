import { NextResponse } from "next/server";
import {
  createDatabaseSession,
  ExtensionAuthConfigError,
  ExtensionAuthTokenError,
  findOrCreateUserForGoogleExtension,
  setNextAuthSessionCookie,
  verifyGoogleExtensionAccessToken,
} from "@/lib/extension-auth";

export const runtime = "nodejs";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function statusForError(error: unknown) {
  if (error instanceof ExtensionAuthConfigError) {
    return 500;
  }

  if (error instanceof ExtensionAuthTokenError) {
    return 401;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const accessToken =
    typeof body === "object" && body !== null
      ? readString((body as Record<string, unknown>).accessToken)
      : "";

  if (!accessToken) {
    return NextResponse.json(
      { error: "Provide a Google access token from the Chrome extension." },
      { status: 400 },
    );
  }

  try {
    const googleProfile = await verifyGoogleExtensionAccessToken(accessToken);
    const user = await findOrCreateUserForGoogleExtension(googleProfile);
    const session = await createDatabaseSession(user.id);
    const response = NextResponse.json({
      expires: session.expires.toISOString(),
      sessionToken: session.sessionToken,
      user,
    });

    setNextAuthSessionCookie(
      response,
      request,
      session.sessionToken,
      session.expires,
    );

    return response;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unable to sign in from Chrome.";

    return NextResponse.json({ error: detail }, { status: statusForError(error) });
  }
}
