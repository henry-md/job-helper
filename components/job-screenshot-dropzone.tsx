"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type JobScreenshotDropzoneProps = {
  disabled?: boolean;
};

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
}: JobScreenshotDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionSource, setSelectionSource] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputId = useId();

  function syncFile(file: File, source: string) {
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

    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      acceptedMimeTypes.has(candidate.type),
    );

    if (!file) {
      setErrorMessage("Drop a PNG, JPG, or WebP screenshot.");
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
      syncFile(file, "Pasted");
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
          "group relative block rounded-[1.75rem] border border-dashed p-5 transition sm:p-6",
          disabled
            ? "cursor-not-allowed border-white/10 bg-black/15 opacity-70"
            : isDragging
              ? "border-emerald-300/60 bg-emerald-400/10"
              : "cursor-pointer border-white/12 bg-black/20 hover:border-emerald-300/30 hover:bg-white/6",
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
          name="jobScreenshot"
          onChange={handleFileInputChange}
          required
          type="file"
        />

        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="block text-sm font-medium text-zinc-100">
              Job screenshot
            </span>
            <span className="mt-2 block max-w-2xl text-sm leading-7 text-zinc-400">
              Drag the fresh macOS screenshot thumbnail here, paste with{" "}
              <span className="text-zinc-200">Cmd+V</span>, or click to browse.
              PNG, JPG, and WebP are supported up to 8 MB.
            </span>
          </div>

          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-zinc-300 transition group-hover:border-emerald-300/30 group-hover:text-zinc-100">
            Drag or paste first
          </div>
        </div>

        <div className="mt-5 grid gap-3 rounded-[1.5rem] border border-white/8 bg-zinc-950/40 p-4 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">
              {selectedFile ? selectedFile.name : "No screenshot selected yet"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {selectedFile
                ? `${selectionSource} from ${selectedFile.type || "image"} • ${describeFileSize(selectedFile.size)}`
                : "The screenshot should clearly show the job title and company name."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-400">
              Finder not required
            </span>
            {selectedFile ? (
              <button
                className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-300 transition hover:border-white/20 hover:text-zinc-100"
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
      </label>

      {errorMessage ? (
        <div className="rounded-[1.25rem] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
