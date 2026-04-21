import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import PublicHeroTitle from "@/components/public-hero-title";
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

function getHeroTypingSpeedAnimation() {
  const parsedValue = Number(process.env.TYPING_SPEED_ANIMTION);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 80;
  }

  return parsedValue;
}

function getHeroTypingAnimationSentencePauseMs() {
  const parsedValue = Number(
    process.env.TYPING_SPEED_ANIMATION_SENTENCE_PAUSE_MS,
  );

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 200;
  }

  return parsedValue;
}

function getHeroTypingAnimationWordPauseMs() {
  const parsedValue = Number(process.env.TYPING_SPEED_ANIMATION_WORD_PAUSE_MS);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 150;
  }

  return parsedValue;
}

const errorMessages: Record<string, string> = {
  Callback:
    "Google returned successfully, but saving the user/session failed. Run your Prisma migration so the auth tables exist in Postgres, then try again.",
  ExtensionAuth:
    "Chrome extension sign-in could not be completed. Try connecting from the extension again.",
  OAuthSignin:
    "Google sign-in could not start. Double-check the deployed origin and callback URI in Google Cloud.",
};

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getServerSession(authOptions);
  const params = searchParams ? await searchParams : undefined;
  const heroTypingSpeedAnimation = getHeroTypingSpeedAnimation();
  const heroTypingAnimationSentencePauseMs =
    getHeroTypingAnimationSentencePauseMs();
  const heroTypingAnimationWordPauseMs = getHeroTypingAnimationWordPauseMs();
  const authError = params?.error;
  const authErrorMessage = authError
    ? errorMessages[authError] ??
      `Authentication failed with error code: ${authError}.`
    : null;

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="public-home-page relative min-h-svh overflow-x-hidden px-2.5 py-2.5 text-zinc-100 sm:h-[100vh] sm:overflow-hidden sm:px-4 sm:py-4">
      <StatusToast message={authErrorMessage} tone="error" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10rem] top-[-8rem] h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl [animation:public-drift_14s_ease-in-out_infinite]" />
        <div className="absolute right-[-8rem] top-16 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl [animation:public-drift_18s_ease-in-out_infinite_reverse]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-72 w-72 rounded-full bg-white/6 blur-3xl [animation:public-pulse_9s_ease-in-out_infinite]" />
      </div>

      <section className="public-home-shell glass-panel soft-ring relative mx-auto grid h-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden rounded-[2rem] p-2.5 sm:p-5 lg:grid-cols-[minmax(0,0.56fr)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-4 xl:gap-5">
        <div className="public-home-copy relative z-10 flex min-h-0 flex-col justify-center gap-3 lg:px-2">
          <div className="space-y-2 sm:space-y-3">
            <p className="hidden text-[0.72rem] uppercase tracking-[0.34em] text-zinc-500 sm:block">
              No one-shot rewriting
            </p>
            <PublicHeroTitle
              className="public-home-title max-w-sm text-[clamp(1.72rem,8vw,2.56rem)] leading-[0.92] font-semibold tracking-tight text-zinc-50 sm:max-w-xl sm:text-[clamp(2.45rem,7.4vw,4.9rem)] sm:leading-[0.9]"
              sentencePauseMs={heroTypingAnimationSentencePauseMs}
              text={"Tailor the resume.\nTrack the search."}
              wordPauseMs={heroTypingAnimationWordPauseMs}
              wordsPerMinute={heroTypingSpeedAnimation}
            />
            <p className="hidden max-w-xl text-[clamp(0.96rem,1.45vw,1.08rem)] leading-relaxed text-zinc-300 sm:block">
              Job Helper turns a base resume into a job-specific PDF through a
              staged LaTeX pipeline with planning, selective clarifying
              questions, block-scoped edits, and page-count compaction. Job
              Tracker keeps every company, stage, and next step in one clean
              workspace.
            </p>
          </div>

          <div className="public-home-actions max-w-md space-y-2 sm:space-y-3">
            <SignInButton />
            <p className="hidden text-sm leading-relaxed text-zinc-500 sm:block">
              Sign in with Google to open your saved dashboard, tailored
              resumes, and tracked applications.
            </p>
          </div>
        </div>

        <aside className="public-home-showcase relative z-10 min-h-0 min-w-0">
          <PublicLandingShowcase />
        </aside>
      </section>
    </main>
  );
}
