import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function extractRelevantLatexError(output: string) {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const bangIndex = lines.findIndex((line) => line.startsWith("!"));

  if (bangIndex !== -1) {
    return lines.slice(bangIndex, Math.min(lines.length, bangIndex + 8)).join("\n");
  }

  return lines.slice(-12).join("\n");
}

function buildCompilablePreviewLatex(latexCode: string) {
  return latexCode.replace(
    String.raw`\vspace{0} % ENV: If you want space between description and bullets`,
    String.raw`\vspace{0pt} % ENV: If you want space between description and bullets`,
  );
}

async function runPdflatex(texPath: string, outputDirectory: string) {
  await execFile(
    "pdflatex",
    [
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-output-directory",
      outputDirectory,
      texPath,
    ],
    {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20_000,
    },
  );
}

function readLatexProcessOutput(error: unknown) {
  return error instanceof Error && "stdout" in error
    ? `${String((error as { stdout?: string }).stdout ?? "")}\n${String(
        (error as { stderr?: string }).stderr ?? "",
      )}`
    : "";
}

export async function compileTailorResumeLatex(latexCode: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tailor-resume-latex-"));
  const texPath = path.join(tempDir, "resume.tex");
  const pdfPath = path.join(tempDir, "resume.pdf");

  try {
    await writeFile(texPath, buildCompilablePreviewLatex(latexCode), "utf8");
    await runPdflatex(texPath, tempDir);

    return await readFile(pdfPath);
  } catch (error) {
    const output = readLatexProcessOutput(error);

    throw new Error(
      output
        ? extractRelevantLatexError(output)
        : "Unable to compile the LaTeX preview.",
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
