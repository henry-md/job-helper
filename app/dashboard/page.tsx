import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DashboardWorkspace from "@/components/dashboard-workspace";
import { authOptions } from "@/auth";
import { parseDashboardRouteState } from "@/lib/dashboard-route-state";
import { createDefaultSystemPromptSettings } from "@/lib/system-prompt-settings";
import {
  countDistinctApplicationCompanies,
  toJobApplicationRecord,
  toReferrerOption,
} from "@/lib/job-application-records";
import { getPrismaClient } from "@/lib/prisma";
import { buildActiveTailoringStates } from "@/lib/tailor-resume-existing-tailoring-state";
import { readTailorResumeResponseState } from "@/lib/tailor-resume-route-response-state";
import { readTailorResumeUserMarkdown } from "@/lib/tailor-resume-user-memory";
import { readTailorResumeWorkspaceInterviews } from "@/lib/tailor-resume-workspace-interviews";
import { readUserSyncStateSnapshotForUser } from "@/lib/user-sync-state";
import type { CompanyOption, ReferrerOption } from "@/lib/job-application-types";
import {
  emptyTailorResumeProfile,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";

type DashboardPageProps = {
  searchParams?: Promise<{
    error?: string;
    tab?: string;
    tailoredResumeId?: string;
  }>;
};

function isTruthyEnvValue(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

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
  const tailorResumeState = await (async () => {
    try {
      const state = await readTailorResumeResponseState(session.user.id);
      return {
        activeTailorings: buildActiveTailoringStates({
          activeRuns: state.activeRuns,
          tailoringInterviews: readTailorResumeWorkspaceInterviews(
            state.rawProfile.workspace,
          ),
        }),
        profile: state.profile,
      };
    } catch {
      return {
        activeTailorings: [],
        profile: emptyTailorResumeProfile() satisfies TailorResumeProfile,
      };
    }
  })();
  const tailorResumeUserMarkdown = await (async () => {
    try {
      return await readTailorResumeUserMarkdown(session.user.id);
    } catch {
      return {
        markdown: "# USER.md\n\n",
        updatedAt: null,
      };
    }
  })();
  const initialSyncState = await readUserSyncStateSnapshotForUser(session.user.id);

  const testOpenAIResponseEnabled = ["true", "1", "yes"].includes(
    process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase() ?? "",
  );
  const openAIReady =
    testOpenAIResponseEnabled || Boolean(process.env.OPENAI_API_KEY);
  const extractionModel = process.env.OPENAI_JOB_EXTRACTION_MODEL ?? "gpt-5-mini";
  const uploadDisabled = !databaseStatus.ok || !openAIReady;
  const statusMessage = params?.error
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
    <main className="dashboard-page min-h-svh overflow-x-hidden px-4 pb-8 pt-4 sm:h-[100dvh] sm:overflow-hidden sm:px-[clamp(1.4rem,2.4vw,2.8rem)] sm:py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-full">
        <section className="flex flex-1 flex-col gap-[clamp(0.75rem,1.2vh,1rem)] sm:min-h-0">
          <DashboardWorkspace
            applicationCount={databaseStatus.applicationCount}
            applications={databaseStatus.applications}
            companyCount={databaseStatus.companyCount}
            companyOptions={databaseStatus.companies}
            defaultPromptSettings={createDefaultSystemPromptSettings()}
            disabled={uploadDisabled}
            extractionModel={extractionModel}
            referrerOptions={databaseStatus.people}
            statusMessage={statusMessage}
            initialSyncState={initialSyncState}
            initialActiveTailorings={tailorResumeState.activeTailorings}
            tailorResumeDebugUiEnabled={isTruthyEnvValue(process.env.DEBUG_UI)}
            tailorResumeOpenAIReady={openAIReady}
            tailorResumeProfile={tailorResumeState.profile}
            tailorResumeUserMarkdown={tailorResumeUserMarkdown}
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
