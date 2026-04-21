import { NextResponse } from "next/server";
import { getApiSession, readBearerToken } from "@/lib/api-auth";
import { getPrismaClient } from "@/lib/prisma";
import { clearNextAuthSessionCookie } from "@/lib/extension-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    expires: session.expires?.toISOString() ?? null,
    source: session.source,
    user: session.user,
  });
}

export async function DELETE(request: Request) {
  const sessionToken = readBearerToken(request);

  if (sessionToken) {
    await getPrismaClient().session.deleteMany({
      where: { sessionToken },
    });
  }

  const response = NextResponse.json({ ok: true });
  clearNextAuthSessionCookie(response, request);

  return response;
}
