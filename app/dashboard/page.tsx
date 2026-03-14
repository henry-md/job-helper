import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AppShellHeader from "@/components/app-shell-header";
import JobApplicationIntake from "@/components/job-application-intake";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import type { CompanyOption, ReferrerOption } from "@/lib/job-application-types";

type DashboardPageProps = {
  searchParams?: Promise<{
    error?: string;
    ingested?: string;
  }>;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
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
      const [applicationCount, companyCount, applications, companies, people] =
        await Promise.all([
          prisma.jobApplication.count({
            where: { userId: session.user.id },
          }),
          prisma.company.count({
            where: { userId: session.user.id },
          }),
          prisma.jobApplication.findMany({
            where: { userId: session.user.id },
            include: {
              company: true,
              sourceScreenshot: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 8,
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

      return {
        ok: true,
        detail:
          applicationCount === 0
            ? "Connected"
            : `Tracking ${applicationCount} application${applicationCount === 1 ? "" : "s"}`,
        applicationCount,
        companyCount,
        applications,
        companies: companies as CompanyOption[],
        people: people.map((person) => ({
          companyId: person.company?.id ?? null,
          companyName: person.company?.name ?? null,
          id: person.id,
          name: person.name,
          recruiterContact: person.recruiterContact ?? null,
        })) as ReferrerOption[],
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

  const openAIReady = Boolean(process.env.OPENAI_API_KEY);
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

  return (
    <main className="h-[100dvh] overflow-hidden px-[clamp(1rem,2vw,1.5rem)] py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
        <AppShellHeader
          applicationCount={databaseStatus.applicationCount}
          companyCount={databaseStatus.companyCount}
          currentView="application-window"
          pageLabel="Application window"
          userImage={session.user.image}
          userName={session.user.name}
        />

        <section className="grid min-h-0 flex-1 gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[1.45fr_0.55fr]">
          <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
              <JobApplicationIntake
                companyOptions={databaseStatus.companies}
                disabled={uploadDisabled}
                extractionModel={extractionModel}
                referrerOptions={databaseStatus.people}
                statusMessage={statusMessage}
              />
          </section>

          <aside className="grid min-h-0 content-start gap-[clamp(0.75rem,1.2vh,1rem)] self-start">
            <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Recent applications
                </p>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                  {databaseStatus.applicationCount}
                </span>
              </div>
              {databaseStatus.applications.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No applications yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {databaseStatus.applications.slice(0, 4).map((application) => (
                    <article
                      key={application.id}
                      className="rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {application.title}
                          </p>
                          <p className="truncate text-sm text-zinc-400">
                            {application.company.name}
                          </p>
                        </div>
                        <span className="text-xs text-zinc-500">
                          {formatDate(application.appliedAt)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
