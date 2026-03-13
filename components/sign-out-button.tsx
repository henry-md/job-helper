"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      type="button"
      className="rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/10"
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      Sign out
    </button>
  );
}
