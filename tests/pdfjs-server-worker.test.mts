import assert from "node:assert/strict";
import test from "node:test";
import { ensurePdfJsServerWorker } from "../lib/pdfjs-server-worker.ts";

test("ensurePdfJsServerWorker preloads the pdfjs fake-worker bridge on globalThis", async () => {
  const originalPdfJsWorker = (globalThis as typeof globalThis & {
    pdfjsWorker?: unknown;
  }).pdfjsWorker;

  try {
    Object.defineProperty(globalThis, "pdfjsWorker", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const pdfJsWorker = await ensurePdfJsServerWorker();

    assert.ok(pdfJsWorker.WorkerMessageHandler);
    assert.equal(
      (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker,
      pdfJsWorker,
    );
  } finally {
    Object.defineProperty(globalThis, "pdfjsWorker", {
      configurable: true,
      value: originalPdfJsWorker,
      writable: true,
    });
  }
});
