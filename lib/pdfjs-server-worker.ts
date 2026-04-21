export type PdfJsWorkerModule = typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs");

let pdfJsWorkerModulePromise: Promise<PdfJsWorkerModule> | null = null;

export async function ensurePdfJsServerWorker() {
  const pdfJsWorkerHost = globalThis as typeof globalThis & {
    pdfjsWorker?: PdfJsWorkerModule;
  };

  if (pdfJsWorkerHost.pdfjsWorker?.WorkerMessageHandler) {
    return pdfJsWorkerHost.pdfjsWorker;
  }

  pdfJsWorkerModulePromise ??= import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfJsWorker = await pdfJsWorkerModulePromise;

  if (!pdfJsWorkerHost.pdfjsWorker?.WorkerMessageHandler) {
    Object.defineProperty(pdfJsWorkerHost, "pdfjsWorker", {
      configurable: true,
      value: pdfJsWorker,
      writable: true,
    });
  }

  return pdfJsWorkerHost.pdfjsWorker!;
}
