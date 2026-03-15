"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      theme="dark"
      toastOptions={{
        className:
          "border border-emerald-300/20 bg-zinc-950/95 text-zinc-100 shadow-[0_20px_60px_rgba(0,0,0,0.45)]",
      }}
    />
  );
}
