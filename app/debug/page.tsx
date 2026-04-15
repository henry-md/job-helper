import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import DebugLatexWorkspace from "@/components/debug-latex-workspace";
import { authOptions } from "@/auth";
import { isDebugToolsEnabled } from "@/lib/debug-tools";
import { readTailorResumeProfile } from "@/lib/tailor-resume-storage";
import {
  emptyTailorResumeProfile,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";

export default async function DebugPage() {
  if (!isDebugToolsEnabled()) {
    notFound();
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const tailorResumeProfile = await (async () => {
    try {
      return await readTailorResumeProfile(session.user.id);
    } catch {
      return emptyTailorResumeProfile() satisfies TailorResumeProfile;
    }
  })();

  const initialLatexCode =
    tailorResumeProfile.latex.draftCode ??
    tailorResumeProfile.latex.generatedCode ??
    "";

  return (
    <main className="min-h-[100dvh] px-[clamp(1rem,2vw,1.5rem)] py-[clamp(0.75rem,1.6vh,1.25rem)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Debug
              </p>
              <h1 className="mt-2 text-[clamp(2rem,3.5vw,3.2rem)] leading-[0.95] font-semibold tracking-tight text-zinc-50">
                Raw LaTeX renderer
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                Use this page to debug exactly what the compiler is doing with a full
                LaTeX document. It starts from your currently saved tailor-resume
                LaTeX when one exists, but you can paste anything and re-render it.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Auth required
              </span>
              <Link
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                href="/dashboard"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>

        <DebugLatexWorkspace initialLatexCode={initialLatexCode} />
      </div>
    </main>
  );
}
