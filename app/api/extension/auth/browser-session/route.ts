import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import {
  createExtensionBrowserSessionTicket,
  getAppOrigin,
  normalizeExtensionCallbackPath,
} from "@/lib/extension-auth";

export const runtime = "nodejs";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await getApiSession(request);

  if (!session?.sessionToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const appOrigin = getAppOrigin(request);
  const callbackPath = normalizeExtensionCallbackPath(
    typeof body === "object" && body !== null
      ? readString((body as Record<string, unknown>).callbackUrl)
      : "",
    appOrigin,
  );
  const browserSession = createExtensionBrowserSessionTicket({
    callbackPath,
    sessionToken: session.sessionToken,
  });
  const url = new URL("/api/extension/auth/complete", appOrigin);
  url.searchParams.set("ticket", browserSession.ticket);

  return NextResponse.json({
    expires: browserSession.expiresAt.toISOString(),
    url: url.toString(),
  });
}
