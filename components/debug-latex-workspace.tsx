"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type DebugLatexWorkspaceProps = {
  initialLatexCode: string;
};

function formatRenderedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DebugLatexWorkspace({
  initialLatexCode,
}: DebugLatexWorkspaceProps) {
  const initializedRef = useRef(false);
  const pdfUrlRef = useRef<string | null>(null);
  const [latexCode, setLatexCode] = useState(initialLatexCode);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderedAt, setRenderedAt] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<
    "idle" | "rendering" | "ready" | "failed"
  >(initialLatexCode.trim() ? "rendering" : "idle");

  const replacePdfUrl = useCallback((nextUrl: string | null) => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
    }

    pdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }, []);

  const renderLatex = useCallback(async (code: string) => {
    setRenderState("rendering");
    setError(null);

    try {
      const response = await fetch("/api/debug/latex", {
        body: JSON.stringify({ latexCode: code }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Unable to render the pasted LaTeX.");
      }

      const nextPdfUrl = URL.createObjectURL(await response.blob());
      replacePdfUrl(nextPdfUrl);
      setRenderedAt(new Date().toISOString());
      setRenderState("ready");
    } catch (nextError) {
      replacePdfUrl(null);
      setRenderedAt(null);
      setRenderState("failed");
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to render the pasted LaTeX.",
      );
    }
  }, [replacePdfUrl]);

  useEffect(() => {
    if (initializedRef.current || !initialLatexCode.trim()) {
      return;
    }

    initializedRef.current = true;
    void renderLatex(initialLatexCode);
  }, [initialLatexCode, renderLatex]);

  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
      }
    };
  }, []);

  function handleReset() {
    setLatexCode(initialLatexCode);
    setError(null);
    replacePdfUrl(null);
    setRenderedAt(null);
    setRenderState(initialLatexCode.trim() ? "idle" : "idle");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();

      if (latexCode.trim()) {
        void renderLatex(latexCode);
      }
    }
  }

  return (
    <section className="grid gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[1.02fr_0.98fr]">
      <section className="glass-panel soft-ring min-h-[760px] rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              LaTeX input
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Paste the exact document you want to inspect
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              This uses the same server-side compiler path as the resume preview, so
              we can compare raw LaTeX against the rendered PDF without the source
              editor in the middle.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-500"
              disabled={!initialLatexCode.trim() || renderState === "rendering"}
              onClick={handleReset}
              type="button"
            >
              Reset to saved
            </button>
            <button
              className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-300/35 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500"
              disabled={!latexCode.trim() || renderState === "rendering"}
              onClick={() => void renderLatex(latexCode)}
              type="button"
            >
              {renderState === "rendering" ? "Rendering..." : "Render PDF"}
            </button>
          </div>
        </div>

        <div className="mt-5 flex min-h-[640px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
            <span>
              {initialLatexCode.trim()
                ? "Seeded from your saved tailor resume LaTeX"
                : "Start from a blank document"}
            </span>
            <span>Cmd/Ctrl + Enter to render</span>
          </div>

          <textarea
            className="min-h-[600px] w-full flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
            onChange={(event) => setLatexCode(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste a full LaTeX document here."
            spellCheck={false}
            value={latexCode}
          />
        </div>
      </section>

      <section className="glass-panel soft-ring flex min-h-[760px] flex-col rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              PDF output
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
              Compiled with the same preview pipeline
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              If the PDF still looks off here, the issue is in the LaTeX or the
              compile environment rather than the rich-text mapping step.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {renderedAt ? (
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Rendered {formatRenderedAt(renderedAt)}
              </span>
            ) : null}
            {pdfUrl ? (
              <a
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/10"
                download="debug-latex-preview.pdf"
                href={pdfUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open PDF
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex min-h-[640px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/20">
          {renderState === "failed" && error ? (
            <div className="w-full overflow-auto p-4">
              <p className="text-sm font-medium text-rose-100">
                The pasted LaTeX did not render cleanly.
              </p>
              <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-6 text-rose-200/90">
                {error}
              </pre>
            </div>
          ) : pdfUrl ? (
            <iframe
              className="h-full min-h-[640px] w-full bg-white"
              src={pdfUrl}
              title="Debug LaTeX PDF preview"
            />
          ) : (
            <div className="flex w-full items-center justify-center p-6 text-center text-sm leading-6 text-zinc-400">
              {renderState === "rendering"
                ? "Rendering the pasted LaTeX now."
                : "Paste LaTeX on the left and render to inspect the PDF here."}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
