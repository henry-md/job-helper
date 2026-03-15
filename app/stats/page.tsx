import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AppShellHeader from "@/components/app-shell-header";
import ApplicationStatsWorkspace from "@/components/application-stats-workspace";
import { authOptions } from "@/auth";
import {
  toJobApplicationRecord,
  toReferrerOption,
} from "@/lib/job-application-records";
import { getPrismaClient } from "@/lib/prisma";
import type {
  CompanyOption,
} from "@/lib/job-application-types";

export default async function StatsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const prisma = getPrismaClient();
  const [companies, people, applications] = await Promise.all([
    prisma.company.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.person.findMany({
      where: { userId: session.user.id },
      include: { company: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.jobApplication.findMany({
      where: { userId: session.user.id },
      include: {
        company: true,
        referrer: {
          include: {
            company: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <main className="h-[100dvh] overflow-hidden px-[clamp(1rem,2vw,1.5rem)] py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
        <AppShellHeader
          currentView="stats"
          pageLabel="Stats"
          userImage={session.user.image}
          userName={session.user.name}
        />
        <ApplicationStatsWorkspace
          companyOptions={companies as CompanyOption[]}
          applications={applications.map(toJobApplicationRecord)}
          referrerOptions={people.map(toReferrerOption)}
        />
      </div>
    </main>
  );
}
