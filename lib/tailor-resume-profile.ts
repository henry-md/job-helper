import type { Prisma } from "@/generated/prisma/client";
import type { TailorResumeProfile } from "@/lib/job-application-types";

export const tailorResumeProfileSelect = {
  resumeMimeType: true,
  resumeOriginalFilename: true,
  resumeSizeBytes: true,
  resumeStoragePath: true,
  resumeUpdatedAt: true,
  tailorJobDescription: true,
} satisfies Prisma.UserSelect;

type TailorResumeProfileSource = {
  resumeMimeType: string | null;
  resumeOriginalFilename: string | null;
  resumeSizeBytes: number | null;
  resumeStoragePath: string | null;
  resumeUpdatedAt: Date | null;
  tailorJobDescription: string | null;
};

export function toTailorResumeProfile(
  user: TailorResumeProfileSource | null | undefined,
): TailorResumeProfile {
  if (
    !user?.resumeOriginalFilename ||
    !user.resumeStoragePath ||
    !user.resumeMimeType ||
    user.resumeSizeBytes === null ||
    !user.resumeUpdatedAt
  ) {
    return {
      jobDescription: user?.tailorJobDescription ?? "",
      resume: null,
    };
  }

  return {
    jobDescription: user.tailorJobDescription ?? "",
    resume: {
      mimeType: user.resumeMimeType,
      originalFilename: user.resumeOriginalFilename,
      sizeBytes: user.resumeSizeBytes,
      storagePath: user.resumeStoragePath,
      updatedAt: user.resumeUpdatedAt.toISOString(),
    },
  };
}
