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
    <main className="h-[100vh] overflow-hidden px-[5vw] py-[4vh] text-zinc-100">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <section className="glass-panel soft-ring flex h-full max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] p-[clamp(1.25rem,2vw,2rem)]">
          <div className="flex h-[12%] min-h-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">
                Job Helper
              </p>
              <h1 className="mt-[1.2vh] max-w-xl text-[clamp(2rem,4.6vw,3.75rem)] leading-[0.94] font-semibold text-zinc-50">
                Track applications from screenshots
              </h1>
            </div>
            <span className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-zinc-400">
              Google
            </span>
          </div>

          <div className="flex h-[18%] min-h-0 items-center">
            <p className="max-w-2xl text-[clamp(0.95rem,1.7vw,1.05rem)] leading-relaxed text-zinc-300">
            Sign in, upload a screenshot, review the extracted fields, and save the application.
            </p>
          </div>

          <div className="flex h-[20%] min-h-0 items-stretch">
            <div className="flex w-full flex-col justify-center rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
              Callback URL
              </p>
              <p className="mt-2 break-all text-[clamp(0.82rem,1.45vw,0.95rem)] font-medium text-zinc-100">
              http://localhost:3000/api/auth/callback/google
              </p>
            </div>
          </div>

          <div className="flex h-[22%] min-h-0 items-center">
            {authError ? (
              <div className="w-full rounded-[1rem] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-[clamp(0.82rem,1.35vw,0.92rem)] leading-relaxed text-amber-100">
                {errorMessages[authError] ??
                  `Authentication failed with error code: ${authError}.`}
              </div>
            ) : (
              <div className="w-full rounded-[1rem] border border-white/8 bg-white/[0.03] px-4 py-3 text-[clamp(0.82rem,1.35vw,0.92rem)] leading-relaxed text-zinc-400">
                Designed to keep the first action visible immediately: authenticate, land in the dashboard, and start logging applications without scrolling.
              </div>
            )}
          </div>

          <div className="flex h-[16%] min-h-0 items-end">
            <div className="w-full sm:max-w-72">
              <SignInButton />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
