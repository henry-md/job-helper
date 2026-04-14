import { mkdir, readFile, writeFile } from "node:fs/promises";
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
