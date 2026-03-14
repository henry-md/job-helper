import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AppShellHeader from "@/components/app-shell-header";
import ApplicationStatsWorkspace from "@/components/application-stats-workspace";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import type { JobApplicationRecord } from "@/lib/job-application-types";

function toApplicationRecord(application: {
  appliedAt: Date;
  company: { name: string };
  createdAt: Date;
  employmentType: string | null;
  hasReferral: boolean;
  id: string;
  jobDescription: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  onsiteDaysPerWeek: number | null;
  recruiterContact: string | null;
  salaryRange: string | null;
  status: string;
  teamOrDepartment: string | null;
  title: string;
  updatedAt: Date;
}): JobApplicationRecord {
  return {
    appliedAt: application.appliedAt.toISOString().slice(0, 10),
    companyName: application.company.name,
    createdAt: application.createdAt.toISOString(),
    employmentType: (application.employmentType as JobApplicationRecord["employmentType"]) ?? "",
    hasReferral: application.hasReferral,
    id: application.id,
    jobDescription: application.jobDescription ?? "",
    jobTitle: application.title,
    jobUrl: application.jobUrl ?? "",
    location: (application.location as JobApplicationRecord["location"]) ?? "",
    notes: application.notes ?? "",
    onsiteDaysPerWeek:
      application.onsiteDaysPerWeek !== null
        ? String(application.onsiteDaysPerWeek)
        : "",
    recruiterContact: application.recruiterContact ?? "",
    salaryRange: application.salaryRange ?? "",
    status: application.status as JobApplicationRecord["status"],
    teamOrDepartment: application.teamOrDepartment ?? "",
    updatedAt: application.updatedAt.toISOString(),
  };
}

export default async function StatsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const prisma = getPrismaClient();
  const [applicationCount, companyCount, applications] = await Promise.all([
    prisma.jobApplication.count({
      where: { userId: session.user.id },
    }),
    prisma.company.count({
      where: { userId: session.user.id },
    }),
    prisma.jobApplication.findMany({
      where: { userId: session.user.id },
      include: { company: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <main className="h-[100dvh] overflow-hidden px-[clamp(1rem,2vw,1.5rem)] py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
        <AppShellHeader
          applicationCount={applicationCount}
          companyCount={companyCount}
          currentView="stats"
          openAIReady={Boolean(process.env.OPENAI_API_KEY)}
          pageLabel="Stats"
          userImage={session.user.image}
          userName={session.user.name}
        />
        <ApplicationStatsWorkspace
          applications={applications.map(toApplicationRecord)}
        />
      </div>
    </main>
  );
}
