"use client";

import { signIn } from "next-auth/react";

export default function SignInButton() {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-3 rounded-full bg-zinc-50 px-5 py-4 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] font-bold text-zinc-900">
        G
      </span>
      Continue with Google
    </button>
  );
}
