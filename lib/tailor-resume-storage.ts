import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  emptyTailorResumeProfile,
  parseTailorResumeProfile,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";

function getTailorResumePrivateDir(userId: string) {
  return path.join(process.cwd(), ".job-helper-data", "tailor-resumes", userId);
}

function getTailorResumeProfilePath(userId: string) {
  return path.join(getTailorResumePrivateDir(userId), "profile.json");
}

function getTailorResumePreviewPdfPath(userId: string) {
  return path.join(getTailorResumePrivateDir(userId), "preview.pdf");
}

function getTailoredResumePdfPath(userId: string, tailoredResumeId: string) {
  return path.join(
    getTailorResumePrivateDir(userId),
    "tailored",
    `${tailoredResumeId}.pdf`,
  );
}

export async function readTailorResumeProfile(userId: string) {
  try {
    const rawValue = await readFile(getTailorResumeProfilePath(userId), "utf8");
    return parseTailorResumeProfile(JSON.parse(rawValue));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyTailorResumeProfile();
    }

    throw error;
  }
}

export async function writeTailorResumeProfile(
  userId: string,
  profile: TailorResumeProfile,
) {
  const privateDir = getTailorResumePrivateDir(userId);

  await mkdir(privateDir, { recursive: true });
  await writeFile(
    getTailorResumeProfilePath(userId),
    `${JSON.stringify(profile, null, 2)}\n`,
    "utf8",
  );
}

export async function readTailorResumePreviewPdf(userId: string) {
  return readFile(getTailorResumePreviewPdfPath(userId));
}

export async function writeTailorResumePreviewPdf(
  userId: string,
  pdfBuffer: Buffer,
) {
  const privateDir = getTailorResumePrivateDir(userId);

  await mkdir(privateDir, { recursive: true });
  await writeFile(getTailorResumePreviewPdfPath(userId), pdfBuffer);
}

export async function deleteTailorResumePreviewPdf(userId: string) {
  await rm(getTailorResumePreviewPdfPath(userId), { force: true });
}

export async function readTailoredResumePdf(
  userId: string,
  tailoredResumeId: string,
) {
  return readFile(getTailoredResumePdfPath(userId, tailoredResumeId));
}

export async function writeTailoredResumePdf(
  userId: string,
  tailoredResumeId: string,
  pdfBuffer: Buffer,
) {
  const privateDir = path.dirname(getTailoredResumePdfPath(userId, tailoredResumeId));

  await mkdir(privateDir, { recursive: true });
  await writeFile(getTailoredResumePdfPath(userId, tailoredResumeId), pdfBuffer);
}

export async function deleteTailoredResumePdf(
  userId: string,
  tailoredResumeId: string,
) {
  await rm(getTailoredResumePdfPath(userId, tailoredResumeId), { force: true });
}
