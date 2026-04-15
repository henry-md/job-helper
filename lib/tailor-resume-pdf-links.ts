import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type EmbeddedPdfLink = {
  pageNumber: number;
  rect: [number, number, number, number] | null;
  url: string;
};

function normalizePdfUri(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  return value.startsWith("u:") ? value.slice(2) : value;
}

function readRect(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const numbers = value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null,
  );

  if (numbers.some((entry) => entry === null)) {
    return null;
  }

  return numbers as [number, number, number, number];
}

function sortEmbeddedPdfLinks(links: EmbeddedPdfLink[]) {
  return [...links].sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    const leftRect = left.rect;
    const rightRect = right.rect;

    if (!leftRect || !rightRect) {
      return 0;
    }

    if (leftRect[3] !== rightRect[3]) {
      return rightRect[3] - leftRect[3];
    }

    return leftRect[0] - rightRect[0];
  });
}

export async function extractEmbeddedPdfLinks(pdfBuffer: Buffer) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tailor-resume-pdf-links-"));
  const pdfPath = path.join(tempDir, "resume.pdf");

  try {
    await writeFile(pdfPath, pdfBuffer);
    const { stdout } = await execFile("qpdf", ["--json", pdfPath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 20_000,
    });
    const parsedValue = JSON.parse(stdout) as {
      pages?: Array<{ object?: string; pageposfrom1?: number }>;
      qpdf?: Array<unknown>;
    };
    const objects =
      parsedValue.qpdf?.[1] &&
      typeof parsedValue.qpdf[1] === "object" &&
      parsedValue.qpdf[1] !== null
        ? (parsedValue.qpdf[1] as Record<string, { value?: Record<string, unknown> }>)
        : {};
    const collectedLinks: EmbeddedPdfLink[] = [];

    for (const page of parsedValue.pages ?? []) {
      if (typeof page.object !== "string") {
        continue;
      }

      const pageObject = objects[`obj:${page.object}`]?.value;
      const pageAnnotations = Array.isArray(pageObject?.["/Annots"])
        ? pageObject["/Annots"]
        : [];

      for (const annotationReference of pageAnnotations) {
        if (typeof annotationReference !== "string") {
          continue;
        }

        const annotation = objects[`obj:${annotationReference}`]?.value;

        if (!annotation || annotation["/Subtype"] !== "/Link") {
          continue;
        }

        const action =
          typeof annotation["/A"] === "object" && annotation["/A"] !== null
            ? (annotation["/A"] as Record<string, unknown>)
            : null;

        if (!action || action["/S"] !== "/URI") {
          continue;
        }

        const url = normalizePdfUri(action["/URI"]);

        if (!url) {
          continue;
        }

        collectedLinks.push({
          pageNumber:
            typeof page.pageposfrom1 === "number" && Number.isFinite(page.pageposfrom1)
              ? page.pageposfrom1
              : 1,
          rect: readRect(annotation["/Rect"]),
          url,
        });
      }
    }

    return sortEmbeddedPdfLinks(collectedLinks);
  } catch {
    return [] satisfies EmbeddedPdfLink[];
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
