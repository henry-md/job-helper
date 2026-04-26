import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import { readUserSyncStateSnapshotForUser } from "@/lib/user-sync-state";

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const syncState = await readUserSyncStateSnapshotForUser(session.user.id);

  return NextResponse.json(syncState, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
