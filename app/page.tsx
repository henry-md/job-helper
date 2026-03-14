import Link from "next/link";
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
    <main className="min-h-screen px-6 py-10 text-zinc-100 sm:px-10 lg:px-14">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col justify-center">
        <section className="glass-panel soft-ring rounded-[2rem] p-8 sm:p-10">
          <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Job Helper
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-50 sm:text-4xl">
                Track applications from screenshots
              </h1>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
              Google sign-in
            </span>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-7 text-zinc-300 sm:text-base">
            Sign in to upload a job screenshot, extract the role details, and keep
            the latest applications in one place.
          </p>

          <div className="mt-6 grid gap-3 text-sm text-zinc-300 sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
              Saves the screenshot and structured application record.
            </div>
            <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
              Uses Google OAuth and sends signed-in users to the dashboard.
            </div>
          </div>

          <div className="mt-6 rounded-[1.25rem] border border-white/8 bg-black/20 p-4 text-sm text-zinc-300">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Callback URL
            </p>
            <p className="mt-2 break-all font-medium text-zinc-100">
              http://localhost:3000/api/auth/callback/google
            </p>
          </div>

          {authError ? (
            <div className="mt-6 rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-7 text-amber-100">
              {errorMessages[authError] ??
                `Authentication failed with error code: ${authError}.`}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-zinc-500">
              <Link className="text-zinc-300 transition hover:text-zinc-50" href="/dashboard">
                Dashboard opens after sign-in
              </Link>
            </div>
            <div className="w-full sm:w-auto sm:min-w-64">
              <SignInButton />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
