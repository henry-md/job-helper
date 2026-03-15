import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import SignInButton from "@/components/sign-in-button";
import { authOptions } from "@/auth";

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
    <main className="h-[100dvh] overflow-hidden px-5 py-6 text-zinc-100 sm:px-8 sm:py-8">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <section className="glass-panel soft-ring grid h-full max-h-[calc(100dvh-3rem)] w-full max-w-5xl gap-8 overflow-hidden rounded-[2rem] p-6 sm:max-h-[calc(100dvh-4rem)] sm:p-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 lg:p-10">
          <div className="flex min-h-0 flex-col justify-between gap-6 lg:gap-8">
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[0.72rem] uppercase tracking-[0.32em] text-zinc-500">
                  Job Helper
                </p>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-zinc-400">
                  Google sign-in
                </span>
              </div>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-[clamp(2.6rem,6vw,5.35rem)] leading-[0.9] font-semibold tracking-tight text-zinc-50">
                  Keep your job search organized from the first screenshot.
                </h1>
                <p className="max-w-2xl text-[clamp(1rem,1.8vw,1.125rem)] leading-relaxed text-zinc-300">
                  Sign in, drop in an application screenshot, confirm the details,
                  and save it to your dashboard.
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-3">
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.04] px-4 py-4">
                Upload screenshots
              </div>
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.04] px-4 py-4">
                Review extracted fields
              </div>
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.04] px-4 py-4">
                Track applications
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col justify-end">
            <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5 sm:p-6">
              <p className="text-sm font-medium text-zinc-100">
                Continue with Google to open your dashboard.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Your applications, companies, and screenshots stay tied to your account.
              </p>

              {authError ? (
                <div className="mt-5 rounded-[1rem] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
                  {errorMessages[authError] ??
                    `Authentication failed with error code: ${authError}.`}
                </div>
              ) : null}

              <div className="mt-6 sm:max-w-sm">
                <SignInButton />
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
