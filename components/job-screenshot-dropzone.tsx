"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";

type JobScreenshotDropzoneProps = {
  disabled?: boolean;
  disabledMessage?: string;
  isProcessing?: boolean;
  processingLabel?: string;
  onFileSelected?: (file: File, source: "Dropped" | "Pasted" | "Selected") => void;
};

type UploadSource = "Dropped" | "Pasted" | "Selected";

const acceptedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const maxScreenshotBytes = 8 * 1024 * 1024;

function formatBytes(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
  }).format(value / (value >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function describeFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${formatBytes(value)} MB`;
  }

  return `${formatBytes(value)} KB`;
}

function pickImageFile(items?: DataTransferItemList | null) {
  if (!items) {
    return null;
  }

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();

    if (file && acceptedMimeTypes.has(file.type)) {
      return file;
    }
  }

  return null;
}

function validateImageFile(file: File) {
  if (!acceptedMimeTypes.has(file.type)) {
    return "Use a PNG, JPG, or WebP screenshot.";
  }

  if (file.size === 0) {
    return "The screenshot is empty.";
  }

  if (file.size > maxScreenshotBytes) {
    return "Keep the screenshot under 8 MB.";
  }

  return null;
}

export default function JobScreenshotDropzone({
  disabled = false,
  disabledMessage,
  isProcessing = false,
  processingLabel,
  onFileSelected,
}: JobScreenshotDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionSource, setSelectionSource] = useState<UploadSource | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputId = useId();

  function syncFile(file: File, source: UploadSource) {
    const validationError = validateImageFile(file);

    if (validationError) {
      setErrorMessage(validationError);
      setSelectedFile(null);
      setSelectionSource(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    const input = inputRef.current;

    if (!input) {
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;

    setSelectedFile(file);
    setSelectionSource(source);
    setErrorMessage(null);
    onFileSelected?.(file, source);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setSelectedFile(null);
      setSelectionSource(null);
      setErrorMessage(null);
      return;
    }

    syncFile(file, "Selected");
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    if (disabled) {
      return;
    }

    const file =
      pickImageFile(event.dataTransfer.items) ??
      Array.from(event.dataTransfer.files).find((candidate) =>
        acceptedMimeTypes.has(candidate.type),
      );

    if (!file) {
      setErrorMessage(
        "This drag did not expose an image file to the browser. Paste with Cmd+V or drag a saved screenshot instead.",
      );
      return;
    }

    syncFile(file, "Dropped");
  }

  function clearSelection() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }

    setSelectedFile(null);
    setSelectionSource(null);
    setErrorMessage(null);
  }

  const syncPastedFile = useEffectEvent((file: File) => {
    syncFile(file, "Pasted");
  });

  useEffect(() => {
    if (disabled) {
      return;
    }

    function handlePaste(event: ClipboardEvent) {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      const file = pickImageFile(event.clipboardData?.items);

      if (!file) {
        return;
      }

      event.preventDefault();
      syncPastedFile(file);
    }

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [disabled]);

  return (
    <div className="grid gap-3">
      <label
        className={[
          "group relative block overflow-hidden rounded-[2rem] border-2 border-dashed transition",
          disabled
            ? "cursor-not-allowed border-white/10 bg-black/15 opacity-70"
            : isDragging
              ? "cursor-pointer border-emerald-300 bg-emerald-300/12 shadow-[0_0_0_1px_rgba(110,231,183,0.3),0_28px_80px_rgba(16,185,129,0.18)]"
              : "cursor-pointer border-emerald-300/40 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.18),rgba(9,9,11,0.86)_42%,rgba(5,5,7,0.96)_100%)] shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_24px_70px_rgba(0,0,0,0.35)] hover:border-emerald-200/70 hover:shadow-[0_0_0_1px_rgba(110,231,183,0.22),0_32px_90px_rgba(16,185,129,0.18)]",
        ].join(" ")}
        htmlFor={inputId}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled}
          id={inputId}
          onChange={handleFileInputChange}
          type="file"
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(110,231,183,0.08),transparent_54%)] opacity-80 transition group-hover:opacity-100" />

        <div className="relative flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="rounded-full border border-white/12 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.24em] text-zinc-200">
              Screenshot
            </div>
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Drag, paste, or click
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-emerald-300/30 bg-black/25 text-2xl text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {isProcessing ? (
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-emerald-200/20 border-t-emerald-200" />
              ) : (
                "+"
              )}
            </div>
            <h3 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight text-white">
              {disabledMessage
                ? "Uploads are unavailable right now"
                : isProcessing
                  ? "Extracting fields from your screenshot"
                  : "Drop your screenshot here"}
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
              {disabledMessage ? (
                disabledMessage
              ) : isProcessing ? (
                processingLabel ??
                "The draft fields will populate automatically when extraction finishes."
              ) : (
                <>
                  Drag the fresh macOS screenshot thumbnail from the lower-right
                  corner, paste with <span className="text-white">Cmd+V</span>, or
                  click this box to choose a file manually.
                </>
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200">
                PNG, JPG, WebP
              </span>
              <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200">
                Max 8 MB
              </span>
              <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200">
                {isProcessing ? "Extraction in progress" : "Paste is most reliable"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.25rem] border border-white/10 bg-black/30 p-3 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-50">
                {selectedFile ? selectedFile.name : "Waiting for a screenshot"}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {selectedFile
                  ? `${selectionSource} from ${selectedFile.type || "image"} • ${describeFileSize(selectedFile.size)}`
                  : "The screenshot should clearly show the job title and company name."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs uppercase tracking-[0.22em] text-emerald-200">
                Finder not required
              </span>
              {selectedFile ? (
                <button
                  className="pointer-events-auto rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200 transition hover:border-white/25 hover:text-white"
                  onClick={(event) => {
                    event.preventDefault();
                    clearSelection();
                  }}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </label>

      {errorMessage ? (
        <div className="rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
