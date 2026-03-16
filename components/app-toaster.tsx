"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      closeButton
      expand
      gap={14}
      offset={24}
      position="bottom-right"
      theme="dark"
      toastOptions={{
        duration: 3600,
        className:
          "rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(39,39,42,0.88),rgba(9,9,11,0.96))] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl ring-1 ring-white/6",
      }}
    />
  );
}
