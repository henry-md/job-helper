import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import SignInButton from "@/components/sign-in-button";
import { authOptions } from "@/auth";

const highlights = [
  "Import your profile once, then tailor every application from a clean workspace.",
  "Keep resumes, outreach notes, and role tracking under one authenticated session.",
  "Start with Google sign-in and expand the stack after the hiring workflow is stable.",
];

type HomePageProps = {
  searchParams?: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  Callback:
    "Google returned successfully, but saving the user/session failed. Run your Prisma migration so the auth tables exist in Postgres, then try again.",
  OAuthSignin:
    "Google sign-in could not start. Double-check the localhost origin and callback URI in Google Cloud.",
};

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getServerSession(authOptions);
  const params = searchParams ? await searchParams : undefined;
  const authError = params?.error;

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 text-zinc-100 sm:px-10 lg:px-14">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-300 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span>Job Helper</span>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
            Google OAuth Ready
          </span>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="glass-panel soft-ring rounded-[2rem] p-8 sm:p-12">
            <p className="mb-5 text-sm uppercase tracking-[0.32em] text-zinc-400">
              Premium zinc workspace
            </p>
            <h1 className="serif-display max-w-4xl text-5xl leading-none font-semibold tracking-tight text-zinc-50 sm:text-7xl">
              A sharper home base for the job search you actually want to run.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-300 sm:text-lg">
              This project is now set up for Google authentication and a cleaner
              product shell. Start with secure sign-in, then build the resume,
              application, and outreach workflow on top of it.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {highlights.map((item) => (
                <div
                  key={item}
                  className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5 text-sm leading-7 text-zinc-300"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <aside className="glass-panel soft-ring flex rounded-[2rem] p-6 sm:p-8">
            <div className="flex w-full flex-col justify-between gap-8">
              <div>
                <div className="mb-5 inline-flex rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
                  Access
                </div>
                <h2 className="text-2xl font-semibold text-zinc-50">
                  Sign in with Google
                </h2>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  Use a Google Cloud OAuth client configured with the callback
                  route below. Once authenticated, you&apos;ll land in the protected
                  dashboard.
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5 text-sm text-zinc-300">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Callback URL
                </p>
                <p className="mt-3 break-all font-medium text-zinc-100">
                  http://localhost:3000/api/auth/callback/google
                </p>
              </div>

              {authError ? (
                <div className="rounded-[1.5rem] border border-amber-400/25 bg-amber-400/10 p-5 text-sm leading-7 text-amber-100">
                  <p className="text-xs uppercase tracking-[0.24em] text-amber-300">
                    Sign-in error
                  </p>
                  <p className="mt-3">
                    {errorMessages[authError] ??
                      `Authentication failed with error code: ${authError}.`}
                  </p>
                </div>
              ) : null}

              <SignInButton />

              <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-zinc-500">
                <span>App Router</span>
                <span>Auth.js</span>
                <span>Zinc UI</span>
              </div>
            </div>
          </aside>
        </section>

        <footer className="flex flex-col gap-3 px-1 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Next.js starter content removed in favor of a project-specific shell.</p>
          <Link className="text-zinc-300 transition hover:text-zinc-50" href="/dashboard">
            Dashboard is protected after sign-in
          </Link>
        </footer>
      </div>
    </main>
  );
}
