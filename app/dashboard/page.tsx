import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DashboardWorkspace from "@/components/dashboard-workspace";
import { authOptions } from "@/auth";
import { parseDashboardRouteState } from "@/lib/dashboard-route-state";
import { createDefaultSystemPromptSettings } from "@/lib/system-prompt-settings";
import {
  filterVisibleJobApplicationsByUrl,
  toJobApplicationRecord,
} from "@/lib/job-application-records";
import { getPrismaClient } from "@/lib/prisma";
import { buildActiveTailoringStates } from "@/lib/tailor-resume-existing-tailoring-state";
import { readTailorResumeResponseState } from "@/lib/tailor-resume-route-response-state";
import { readTailorResumeUserMarkdown } from "@/lib/tailor-resume-user-memory";
import { readTailorResumeWorkspaceInterviews } from "@/lib/tailor-resume-workspace-interviews";
import { readUserSyncStateSnapshotForUser } from "@/lib/user-sync-state";
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
      const applications = await prisma.jobApplication.findMany({
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
      });
      const visibleApplications = filterVisibleJobApplicationsByUrl(applications);

      return {
        ok: true,
        detail:
          visibleApplications.length === 0
            ? "Connected"
            : `Tracking ${visibleApplications.length} application${
                visibleApplications.length === 1 ? "" : "s"
              }`,
        applicationCount: visibleApplications.length,
        applications: visibleApplications.map(toJobApplicationRecord),
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Unable to connect to Postgres.",
        applicationCount: 0,
        applications: [],
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
  const statusMessage = params?.error
    ? {
        tone: "error" as const,
        text: params.error,
      }
    : !databaseStatus.ok
      ? {
          tone: "error" as const,
          text: databaseStatus.detail,
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
            applications={databaseStatus.applications}
            defaultPromptSettings={createDefaultSystemPromptSettings()}
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
