"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { startGoogleSignIn } from "@/lib/auth-client";

export default function SignInButton() {
  const [isRedirecting, setIsRedirecting] = useState(false);

  async function handleClick() {
    if (isRedirecting) {
      return;
    }

    setIsRedirecting(true);

    try {
      await startGoogleSignIn();
    } catch (error) {
      console.error("Google sign-in failed to start.", error);
      setIsRedirecting(false);
      window.location.href = "/?error=OAuthSignin";
    }
  }

  return (
    <button
      type="button"
      className="group flex w-full items-center justify-center gap-2.5 rounded-[1rem] border border-white/12 bg-zinc-50 px-4 py-2.5 text-[0.96rem] font-semibold text-zinc-950 shadow-[0_18px_40px_rgba(255,255,255,0.1)] transition duration-200 hover:-translate-y-0.5 hover:bg-white sm:gap-3 sm:py-3 sm:text-sm"
      disabled={isRedirecting}
      aria-busy={isRedirecting}
      onClick={handleClick}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-[10px] font-bold text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:h-7 sm:w-7 sm:text-[11px]">
        G
      </span>
      <span>{isRedirecting ? "Redirecting..." : "Continue with Google"}</span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </button>
  );
}
