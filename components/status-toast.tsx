"use client";

import { useEffect } from "react";
import { toast } from "sonner";

type StatusToastProps = {
  message?: string | null;
  tone?: "error" | "info" | "success";
};

export default function StatusToast({
  message,
  tone = "info",
}: StatusToastProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    if (tone === "success") {
      toast.success(message);
      return;
    }

    if (tone === "error") {
      toast.error(message);
      return;
    }

    toast.info(message);
  }, [message, tone]);

  return null;
}
