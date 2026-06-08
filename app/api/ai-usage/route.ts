import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import { readAiUsageReport } from "@/lib/ai-usage-report";
import { normalizeAiUsagePeriod } from "@/lib/ai-usage-report-types";

function readUsageLimit(request: Request) {
  const rawLimit = new URL(request.url).searchParams.get("limit");

  if (!rawLimit) {
    return 250;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);

  return Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 1000)
    : 250;
}

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const report = await readAiUsageReport({
    limit: readUsageLimit(request),
    period: normalizeAiUsagePeriod(new URL(request.url).searchParams.get("period")),
    userId: session.user.id,
  });

  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
