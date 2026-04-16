import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import { normalizeCompanyName } from "@/lib/job-tracking-shared";

function normalizePersonName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const companyName =
    typeof body.companyName === "string" ? body.companyName.trim() : "";
  const recruiterContact =
    typeof body.recruiterContact === "string"
      ? body.recruiterContact.trim()
      : "";

  if (!name) {
    return NextResponse.json(
      { error: "Add a referrer name before saving." },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();

  try {
    const company = companyName
      ? await prisma.company.upsert({
          where: {
            userId_normalizedName: {
              userId: session.user.id,
              normalizedName: normalizeCompanyName(companyName),
            },
          },
          create: {
            userId: session.user.id,
            name: companyName,
            normalizedName: normalizeCompanyName(companyName),
          },
          update: {
            name: companyName,
          },
        })
      : null;

    const person = await prisma.person.upsert({
      where: {
        userId_normalizedName: {
          userId: session.user.id,
          normalizedName: normalizePersonName(name),
        },
      },
      create: {
        userId: session.user.id,
        companyId: company?.id ?? null,
        name,
        normalizedName: normalizePersonName(name),
        recruiterContact: recruiterContact || null,
      },
      update: {
        companyId: company?.id ?? null,
        name,
        recruiterContact: recruiterContact || null,
      },
      include: {
        company: true,
      },
    });

    return NextResponse.json({
      referrer: {
        companyId: person.companyId,
        companyName: person.company?.name ?? null,
        id: person.id,
        name: person.name,
        recruiterContact: person.recruiterContact ?? null,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to create the referrer.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
