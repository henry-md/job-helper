import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import SignOutButton from "@/components/sign-out-button";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";

const workflow = [
  {
    title: "Resume tailoring",
    detail: "Generate role-specific versions from a stable source profile.",
  },
  {
    title: "Application tracking",
    detail: "Keep role status, deadlines, and notes attached to a real account.",
  },
  {
    title: "Outreach prep",
    detail: "Store recruiter messages and follow-ups inside the same workspace.",
  },
];

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const displayName =
    session?.user?.name?.trim()?.split(" ")[0] || session?.user?.name || "there";

  if (!session?.user) {
    redirect("/");
  }

  const databaseStatus = await (async () => {
    try {
      const prisma = getPrismaClient();
      const applicationCount = await prisma.jobApplication.count();

      return {
        ok: true,
        detail:
          applicationCount === 0
            ? "Connected. Prisma can reach Postgres and the schema is ready."
            : `Connected. Found ${applicationCount} job application${applicationCount === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Unable to connect to Postgres.",
      };
    }
  })();

  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-14">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="glass-panel soft-ring flex flex-col justify-between gap-6 rounded-[2rem] p-8 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-zinc-500">
              Protected workspace
            </p>
            <h1 className="serif-display mt-3 text-5xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
              {displayName}
            </h1>
            <p className="mt-2 text-sm uppercase tracking-[0.28em] text-zinc-500">
              Signed in with Google
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
              Google OAuth is active. This dashboard is server-rendered and only
              available to authenticated users.
            </p>
          </div>

          <SignOutButton />
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="glass-panel soft-ring rounded-[2rem] p-7 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                  Workflow foundation
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                  Your next product layer can sit here
                </h2>
              </div>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-300">
                Auth online
              </span>
            </div>

            <div className="grid gap-4">
              {workflow.map((item, index) => (
                <div
                  key={item.title}
                  className="flex gap-4 rounded-[1.5rem] border border-white/8 bg-black/20 p-5"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm text-zinc-300">
                    0{index + 1}
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-zinc-100">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-zinc-400">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="grid gap-6">
            <div className="glass-panel soft-ring rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Account
              </p>
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
                    {session.user.email ?? "No email available"}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-panel soft-ring rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Environment
              </p>
              <div className="mt-4 space-y-3 text-sm text-zinc-300">
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <span className="block text-zinc-500">Required vars</span>
                  <span className="mt-1 block text-zinc-100">
                    NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
                  </span>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-zinc-400">
                  The app is ready for local auth once those values are present.
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <span className="block text-zinc-500">Database</span>
                  <span
                    className={`mt-1 block ${
                      databaseStatus.ok ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    {databaseStatus.ok ? "Connected" : "Needs setup"}
                  </span>
                  <span className="mt-2 block leading-6 text-zinc-400">
                    {databaseStatus.detail}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
