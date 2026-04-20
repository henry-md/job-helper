import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import PublicLandingShowcase from "@/components/public-landing-showcase";
import SignInButton from "@/components/sign-in-button";
import StatusToast from "@/components/status-toast";
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
    "Google sign-in could not start. Double-check the deployed origin and callback URI in Google Cloud.",
};

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getServerSession(authOptions);
  const params = searchParams ? await searchParams : undefined;
  const authError = params?.error;
  const authErrorMessage = authError
    ? errorMessages[authError] ??
      `Authentication failed with error code: ${authError}.`
    : null;

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative h-[100vh] overflow-hidden px-3 py-3 text-zinc-100 sm:px-4 sm:py-4">
      <StatusToast message={authErrorMessage} tone="error" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10rem] top-[-8rem] h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_14s_ease-in-out_infinite]" />
        <div className="absolute right-[-8rem] top-16 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_18s_ease-in-out_infinite_reverse]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-72 w-72 rounded-full bg-white/6 blur-3xl [animation:public-pulse_9s_ease-in-out_infinite]" />
      </div>

      <section className="glass-panel soft-ring relative mx-auto grid h-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-[2rem] p-4 sm:p-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5">
        <div className="relative z-10 flex min-h-0 flex-col justify-center gap-4 lg:px-2">
          <div className="space-y-3">
            <p className="hidden text-[0.72rem] uppercase tracking-[0.34em] text-zinc-500 sm:block">
              No copy-paste required
            </p>
            <h1 className="max-w-md text-[clamp(2.2rem,10vw,3.45rem)] leading-[0.92] font-semibold tracking-tight text-zinc-50 sm:hidden">
              Save the role.
              <br />
              Track the search.
            </h1>
            <h1 className="hidden max-w-xl text-[clamp(2.6rem,8vw,5.2rem)] leading-[0.9] font-semibold tracking-tight text-zinc-50 sm:block">
              Save the role.
              <br />
              Track the search.
            </h1>
            <p className="max-w-md text-[0.98rem] leading-relaxed text-zinc-300 sm:hidden">
              Job Helper turns job post screenshots into clean drafts. Job
              Tracker keeps every company, stage, and next step in one place.
            </p>
            <p className="hidden max-w-xl text-[clamp(0.96rem,1.45vw,1.08rem)] leading-relaxed text-zinc-300 sm:block">
              Job Helper turns job post screenshots into clean drafts. Job
              Tracker keeps every company, stage, and follow-up in one clean
              workspace.
            </p>
          </div>

          <div className="max-w-md space-y-3">
            <SignInButton />
            <p className="hidden text-sm leading-relaxed text-zinc-500 sm:block">
              Sign in with Google to open your saved dashboard, screenshots, and
              tracked applications.
            </p>
          </div>
        </div>

        <aside className="relative z-10 min-h-0 min-w-0">
          <PublicLandingShowcase />
        </aside>
      </section>
    </main>
  );
}
