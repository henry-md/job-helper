import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  emptyTailorResumeProfile,
  parseTailorResumeProfile,
  type TailorResumeProfile,
} from "./tailor-resume-types.ts";
import { stripTailorResumeProfileLinkLocks } from "./tailor-resume-locked-links.ts";

// Tailor Resume persists one shared profile.json per user, so concurrent
// read-modify-write requests need to queue or they can drop newer mutations.
const tailorResumeProfileMutationQueueByUserId = new Map<string, Promise<void>>();

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

function buildAtomicTempPath(targetPath: string) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );
}

async function writeFileAtomically(
  targetPath: string,
  content: Parameters<typeof writeFile>[1],
  options?: Parameters<typeof writeFile>[2],
) {
  const tempPath = buildAtomicTempPath(targetPath);

  try {
    await writeFile(tempPath, content, options);
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
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

export async function withTailorResumeProfileLock<Result>(
  userId: string,
  task: () => Promise<Result>,
) {
  const previousTask =
    tailorResumeProfileMutationQueueByUserId.get(userId) ?? Promise.resolve();
  let releaseCurrentTask!: () => void;
  const currentTask = new Promise<void>((resolve) => {
    releaseCurrentTask = resolve;
  });
  const queuedTask = previousTask.catch(() => undefined).then(() => currentTask);

  tailorResumeProfileMutationQueueByUserId.set(userId, queuedTask);
  await previousTask.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrentTask();

    if (tailorResumeProfileMutationQueueByUserId.get(userId) === queuedTask) {
      tailorResumeProfileMutationQueueByUserId.delete(userId);
    }
  }
}

export async function writeTailorResumeProfile(
  userId: string,
  profile: TailorResumeProfile,
) {
  const privateDir = getTailorResumePrivateDir(userId);
  const sanitizedProfile = stripTailorResumeProfileLinkLocks(profile);

  await mkdir(privateDir, { recursive: true });
  await writeFileAtomically(
    getTailorResumeProfilePath(userId),
    `${JSON.stringify(sanitizedProfile, null, 2)}\n`,
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
  await writeFileAtomically(getTailorResumePreviewPdfPath(userId), pdfBuffer);
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
  await writeFileAtomically(
    getTailoredResumePdfPath(userId, tailoredResumeId),
    pdfBuffer,
  );
}

export async function deleteTailoredResumePdf(
  userId: string,
  tailoredResumeId: string,
) {
  await rm(getTailoredResumePdfPath(userId, tailoredResumeId), { force: true });
}
