import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DashboardWorkspace from "@/components/dashboard-workspace";
import { authOptions } from "@/auth";
import { readAiUsageReport } from "@/lib/ai-usage-report";
import { defaultAiUsagePeriod } from "@/lib/ai-usage-report-types";
import { parseDashboardRouteState } from "@/lib/dashboard-route-state";
import { createDefaultSystemPromptSettings } from "@/lib/system-prompt-settings";
import { buildActiveTailoringStates } from "@/lib/tailor-resume-existing-tailoring-state";
import { readTailorResumeResponseState } from "@/lib/tailor-resume-route-response-state";
import { readTailorResumeStoredSkillData } from "@/lib/tailor-resume-skill-store";
import { readTailorResumeUserMemory } from "@/lib/tailor-resume-user-memory";
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
  const tailorResumeUserMemory = await (async () => {
    try {
      return await readTailorResumeUserMemory(session.user.id);
    } catch {
      return {
        nonTechnologyNames: [],
        userMarkdown: {
          markdown: "# USER.md\n\n",
          updatedAt: null,
        },
        updatedAt: null,
      };
    }
  })();
  const tailorResumeSkillData = await (async () => {
    try {
      return await readTailorResumeStoredSkillData({
        sourceAnnotatedLatexCode: tailorResumeState.profile.annotatedLatex.code,
        userId: session.user.id,
      });
    } catch {
      return {
        keywordClassifications: [],
        resumeExperiences: [],
        skills: [],
        spareBullets: [],
        updatedAt: new Date().toISOString(),
      };
    }
  })();
  const aiUsageReport = await (async () => {
    try {
      return await readAiUsageReport({
        userId: session.user.id,
      });
    } catch {
      return {
        events: [],
        generatedAt: new Date().toISOString(),
        period: defaultAiUsagePeriod,
        resumeGroups: [],
        summary: {
          archivedCostUsdMicros: "0",
          deletedCostUsdMicros: "0",
          eventCount: 0,
          failedEventCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalCostUsdMicros: "0",
          totalTokens: 0,
          unarchivedCostUsdMicros: "0",
          urlCount: 0,
        },
        urlGroups: [],
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
            aiUsageReport={aiUsageReport}
            defaultPromptSettings={createDefaultSystemPromptSettings()}
            statusMessage={statusMessage}
            initialSyncState={initialSyncState}
            initialActiveTailorings={tailorResumeState.activeTailorings}
            tailorResumeDebugUiEnabled={isTruthyEnvValue(process.env.DEBUG_UI)}
            tailorResumeOpenAIReady={openAIReady}
            tailorResumeProfile={tailorResumeState.profile}
            tailorResumeSkillData={tailorResumeSkillData}
            tailorResumeUserMemory={tailorResumeUserMemory}
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
