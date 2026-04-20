"use client";

import { useState } from "react";
import { startSignOut } from "@/lib/auth-client";

export default function SignOutButton({
  className = "",
}: {
  className?: string;
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleClick() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await startSignOut();
    } catch (error) {
      console.error("Sign-out failed to start.", error);
      setIsSigningOut(false);
      window.location.href = "/";
    }
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/10 ${className}`.trim()}
      disabled={isSigningOut}
      aria-busy={isSigningOut}
      onClick={handleClick}
    >
      {isSigningOut ? "Signing out..." : "Sign out"}
    </button>
  );
}
