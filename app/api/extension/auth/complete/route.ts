import { NextResponse } from "next/server";
import {
  getAppOrigin,
  normalizeExtensionCallbackPath,
  readExtensionBrowserSessionTicket,
  setNextAuthSessionCookie,
} from "@/lib/extension-auth";
import { getPrismaClient } from "@/lib/prisma";

export const runtime = "nodejs";

function buildAuthErrorRedirect(request: Request) {
  const url = new URL("/", getAppOrigin(request));
  url.searchParams.set("error", "ExtensionAuth");
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ticket = requestUrl.searchParams.get("ticket")?.trim() ?? "";

  if (!ticket) {
    return buildAuthErrorRedirect(request);
  }

  try {
    const appOrigin = getAppOrigin(request);
    const payload = readExtensionBrowserSessionTicket(ticket);
    const session = await getPrismaClient().session.findUnique({
      where: {
        sessionToken: payload.sessionToken,
      },
    });

    if (!session || session.expires <= new Date()) {
      return buildAuthErrorRedirect(request);
    }

    const callbackPath = normalizeExtensionCallbackPath(
      payload.callbackPath,
      appOrigin,
    );
    const response = NextResponse.redirect(new URL(callbackPath, appOrigin));
    setNextAuthSessionCookie(response, request, session.sessionToken, session.expires);

    return response;
  } catch {
    return buildAuthErrorRedirect(request);
  }
}
