import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import JobApplicationIntake from "@/components/job-application-intake";
import SignOutButton from "@/components/sign-out-button";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";

type DashboardPageProps = {
  searchParams?: Promise<{
    error?: string;
    ingested?: string;
  }>;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await getServerSession(authOptions);
  const params = searchParams ? await searchParams : undefined;
  const displayName =
    session?.user?.name?.trim()?.split(" ")[0] || session?.user?.name || "there";

  if (!session?.user?.id) {
    redirect("/");
  }

  const databaseStatus = await (async () => {
    try {
      const prisma = getPrismaClient();
      const [applicationCount, companyCount, applications, companies, screenshots] =
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
            include: {
              _count: {
                select: { applications: true },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 6,
          }),
          prisma.jobApplicationScreenshot.findMany({
            where: { userId: session.user.id },
            orderBy: {
              createdAt: "desc",
            },
            take: 6,
          }),
        ]);

      return {
        ok: true,
        detail:
          applicationCount === 0
            ? "Connected. Upload a screenshot to create your first tracked application."
            : `Connected. Tracking ${applicationCount} application${applicationCount === 1 ? "" : "s"} across ${companyCount} compan${companyCount === 1 ? "y" : "ies"}.`,
        applicationCount,
        applications,
        companies,
        screenshots,
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
        companies: [],
        screenshots: [],
      };
    }
  })();

  const openAIReady = Boolean(process.env.OPENAI_API_KEY);
  const extractionModel = process.env.OPENAI_JOB_EXTRACTION_MODEL ?? "gpt-5-mini";
  const uploadDisabled = !databaseStatus.ok || !openAIReady;
  const uploadDisabledMessage = !databaseStatus.ok && !openAIReady
    ? "Configure Postgres and set OPENAI_API_KEY before testing uploads."
    : !databaseStatus.ok
      ? "Connect Postgres before testing uploads."
      : "Set OPENAI_API_KEY before testing uploads.";

  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="glass-panel soft-ring flex flex-col justify-between gap-6 rounded-[2rem] p-8 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-zinc-500">
              Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              {displayName}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
              Upload a screenshot to create a job application record. Recent
              applications and upload results stay below.
            </p>
          </div>

          <SignOutButton />
        </header>

        {params?.ingested ? (
          <div className="rounded-[1.5rem] border border-emerald-400/25 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-100">
            Saved a new application from the uploaded screenshot.
          </div>
        ) : null}

        {params?.error ? (
          <div className="rounded-[1.5rem] border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
            {params.error}
          </div>
        ) : null}

        <section className="grid items-start gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="grid gap-6">
            <section className="glass-panel soft-ring rounded-[2rem] p-7 sm:p-8">
              <div className="mb-6 flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                    Draft intake
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                    Build the application before saving
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                    Each screenshot now fills the draft immediately. You can review or
                    edit the extracted fields, add more screenshots to enrich the
                    draft, and save only when the row looks correct.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-300">
                  {extractionModel}
                </span>
              </div>

              <JobApplicationIntake
                disabled={uploadDisabled}
                disabledMessage={uploadDisabled ? uploadDisabledMessage : undefined}
                extractionModel={extractionModel}
              />
            </section>

            <section className="glass-panel soft-ring rounded-[2rem] p-7 sm:p-8">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                    Recent applications
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                    Structured records from screenshots
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                  {databaseStatus.applicationCount} saved
                </span>
              </div>

              {databaseStatus.applications.length === 0 ? (
                <div className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5 text-sm leading-7 text-zinc-400">
                  No applications yet. Upload a screenshot to create the first one.
                </div>
              ) : (
                <div className="grid gap-4">
                  {databaseStatus.applications.map((application) => (
                    <article
                      key={application.id}
                      className="grid gap-4 rounded-[1.5rem] border border-white/8 bg-black/20 p-5 md:grid-cols-[176px_1fr]"
                    >
                      <div className="overflow-hidden rounded-[1.25rem] border border-white/8 bg-zinc-950/80">
                        {application.sourceScreenshot ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`${application.title} screenshot`}
                            className="h-full w-full object-cover"
                            src={application.sourceScreenshot.storagePath}
                          />
                        ) : (
                          <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-sm text-zinc-500">
                            No screenshot available
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-xl font-semibold text-zinc-50">
                            {application.title}
                          </h3>
                          <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                            {application.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm uppercase tracking-[0.22em] text-zinc-500">
                          {application.company.name}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                            Applied {formatDate(application.appliedAt)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                            {application.hasReferral ? "Referral detected" : "No referral detected"}
                          </span>
                        </div>
                        <p className="mt-4 text-sm leading-7 text-zinc-400">
                          {application.jobDescription
                            ? truncate(application.jobDescription, 280)
                            : "No long job description was visible in the screenshot."}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="grid content-start gap-6 self-start">
            <div className="glass-panel soft-ring h-fit rounded-[2rem] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    Account
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    {session.user.email ?? "No email available"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                    databaseStatus.ok && openAIReady
                      ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                      : "border border-amber-400/25 bg-amber-400/10 text-amber-200"
                  }`}
                >
                  {databaseStatus.ok && openAIReady ? "Ready" : "Setup needed"}
                </span>
              </div>
              <div className="mt-5 flex items-center gap-4">
                {session.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={session.user.name ?? "Google profile"}
                    className="h-16 w-16 rounded-full object-cover"
                    src={session.user.image}
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800 text-xl font-semibold text-zinc-200">
                    {session.user.name?.[0] ?? "U"}
                  </div>
                )}
                <div>
                  <p className="text-lg font-medium text-zinc-100">
                    {session.user.name ?? "Authenticated user"}
                  </p>
                  <p className="text-sm text-zinc-400">
                    {databaseStatus.detail}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-panel soft-ring h-fit rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Companies
              </p>

              {databaseStatus.companies.length === 0 ? (
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  Companies appear automatically as screenshots are processed.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {databaseStatus.companies.map((company) => (
                    <div
                      key={company.id}
                      className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4"
                    >
                      <p className="text-base font-medium text-zinc-100">
                        {company.name}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {company._count.applications} application
                        {company._count.applications === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-panel soft-ring h-fit rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Recent uploads
              </p>
              {databaseStatus.screenshots.length === 0 ? (
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  Upload history appears here.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {databaseStatus.screenshots.map((screenshot) => (
                    <div
                      key={screenshot.id}
                      className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {screenshot.originalFilename}
                        </p>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                            screenshot.extractionStatus === "SUCCEEDED"
                              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                              : screenshot.extractionStatus === "FAILED"
                                ? "border border-amber-400/25 bg-amber-400/10 text-amber-200"
                                : "border border-white/10 bg-white/5 text-zinc-400"
                          }`}
                        >
                          {screenshot.extractionStatus}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-500">
                        {formatDate(screenshot.createdAt)}
                      </p>
                      {screenshot.extractionError ? (
                        <p className="mt-3 text-sm leading-6 text-amber-100">
                          {screenshot.extractionError}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
