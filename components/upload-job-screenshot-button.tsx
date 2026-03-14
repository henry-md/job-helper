"use client";

import { useFormStatus } from "react-dom";

type UploadJobScreenshotButtonProps = {
  disabled?: boolean;
};

export default function UploadJobScreenshotButton({
  disabled = false,
}: UploadJobScreenshotButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      className="inline-flex items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-5 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isDisabled}
      type="submit"
    >
      {pending ? "Extracting..." : "Upload screenshot"}
    </button>
  );
}
