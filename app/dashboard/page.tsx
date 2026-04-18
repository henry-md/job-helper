import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DashboardWorkspace from "@/components/dashboard-workspace";
import { authOptions } from "@/auth";
import { parseDashboardRouteState } from "@/lib/dashboard-route-state";
import {
  countDistinctApplicationCompanies,
  toJobApplicationRecord,
  toReferrerOption,
} from "@/lib/job-application-records";
import { getPrismaClient } from "@/lib/prisma";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import type { CompanyOption, ReferrerOption } from "@/lib/job-application-types";
import {
  emptyTailorResumeProfile,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";

type DashboardPageProps = {
  searchParams?: Promise<{
    error?: string;
    ingested?: string;
    tab?: string;
    tailoredResumeId?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await getServerSession(authOptions);
  const params = searchParams ? await searchParams : undefined;

  if (!session?.user?.id) {
    redirect("/");
  }

  const databaseStatus = await (async () => {
    try {
      const prisma = getPrismaClient();
      const [applicationCount, applications, companies, people] =
        await Promise.all([
          prisma.jobApplication.count({
            where: { userId: session.user.id },
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
          prisma.company.findMany({
            where: { userId: session.user.id },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          }),
          prisma.person.findMany({
            where: { userId: session.user.id },
            include: { company: { select: { id: true, name: true } } },
            orderBy: { name: "asc" },
          }),
        ]);
      const companyCount = countDistinctApplicationCompanies(applications);

      return {
        ok: true,
        detail:
          applicationCount === 0
            ? "Connected"
            : `Tracking ${applicationCount} application${applicationCount === 1 ? "" : "s"}`,
        applicationCount,
        companyCount,
        applications: applications.map(toJobApplicationRecord),
        companies: companies as CompanyOption[],
        people: people.map(toReferrerOption),
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Unable to connect to Postgres.",
        applicationCount: 0,
        companyCount: 0,
        applications: [],
        companies: [] as CompanyOption[],
        people: [] as ReferrerOption[],
      };
    }
  })();
  const tailorResumeProfile = await (async () => {
    try {
      const state = await readTailorResumeProfileState(session.user.id);
      return state.profile;
    } catch {
      return emptyTailorResumeProfile() satisfies TailorResumeProfile;
    }
  })();

  const testOpenAIResponseEnabled = ["true", "1", "yes"].includes(
    process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase() ?? "",
  );
  const openAIReady =
    testOpenAIResponseEnabled || Boolean(process.env.OPENAI_API_KEY);
  const extractionModel = process.env.OPENAI_JOB_EXTRACTION_MODEL ?? "gpt-5-mini";
  const uploadDisabled = !databaseStatus.ok || !openAIReady;
  const statusMessage = params?.ingested
    ? {
        tone: "success" as const,
        text: "Saved a new application from the uploaded screenshot.",
      }
    : params?.error
      ? {
          tone: "error" as const,
          text: params.error,
        }
      : null;
  const initialDashboardRouteState = parseDashboardRouteState({
    tab: params?.tab,
    tailoredResumeId: params?.tailoredResumeId,
  });

  return (
    <main className="h-[100dvh] overflow-hidden px-[clamp(1.4rem,2.4vw,2.8rem)] py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
        <section className="flex min-h-0 flex-1 flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
          <DashboardWorkspace
            applicationCount={databaseStatus.applicationCount}
            applications={databaseStatus.applications}
            companyCount={databaseStatus.companyCount}
            companyOptions={databaseStatus.companies}
            disabled={uploadDisabled}
            extractionModel={extractionModel}
            referrerOptions={databaseStatus.people}
            statusMessage={statusMessage}
            tailorResumeDebugUiEnabled={Boolean(process.env.DEBUG_UI)}
            tailorResumeOpenAIReady={openAIReady}
            tailorResumeProfile={tailorResumeProfile}
            initialReviewingTailoredResumeId={
              initialDashboardRouteState.tailoredResumeId
            }
            initialTab={initialDashboardRouteState.tab}
            userImage={session.user.image}
            userName={session.user.name}
          />
        </section>
      </div>
    </main>
  );
}
