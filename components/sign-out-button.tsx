"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/10 ${className}`.trim()}
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      Sign out
    </button>
  );
}
