import { buildNormalizedJobUrlHash } from "./job-url-hash.ts";
import { deletePersistedJobScreenshot } from "./job-tracking.ts";
import { readTailorResumeProfileState } from "./tailor-resume-profile-state.ts";
import {
  deleteTailoredResumePdf,
  withTailorResumeProfileLock,
  writeTailorResumeProfile,
} from "./tailor-resume-storage.ts";
import type { TailorResumeProfile } from "./tailor-resume-types.ts";
import {
  readTailorResumeWorkspaceInterviews,
  withTailorResumeWorkspaceInterviews,
} from "./tailor-resume-workspace-interviews.ts";
import {
  isInvalidTailoredResumeArtifact,
  shouldDeleteActiveTailorResumeRun,
} from "./tailor-resume-artifact-cleanup.ts";
import { getPrismaClient } from "./prisma.ts";

export type TailorResumeDbRunRecord = {
  application: {
    company: {
      name: string;
    };
    title: string;
  };
  createdAt: Date;
  error: string | null;
  id: string;
  jobDescription: string;
  jobUrl: string | null;
  status: "CANCELLED" | "FAILED" | "NEEDS_INPUT" | "RUNNING" | "SUCCEEDED";
  stepAttempt: number | null;
  stepCount: number | null;
  stepDetail: string | null;
  stepNumber: number | null;
  stepRetrying: boolean | null;
  stepStatus: string | null;
  stepSummary: string | null;
  updatedAt: Date;
};

export function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = value?.trim();

    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    result.push(normalizedValue);
  }

  return result;
}

export async function findActiveTailorResumeRun(input: {
  applicationId: string | null;
  userId: string;
}) {
  if (!input.applicationId) {
    return null;
  }

  return getPrismaClient().tailorResumeRun.findFirst({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      application: {
        select: {
          company: {
            select: {
              name: true,
            },
          },
          title: true,
        },
      },
      createdAt: true,
      error: true,
      id: true,
      jobDescription: true,
      jobUrl: true,
      status: true,
      stepAttempt: true,
      stepCount: true,
      stepDetail: true,
      stepNumber: true,
      stepRetrying: true,
      stepStatus: true,
      stepSummary: true,
      updatedAt: true,
    },
    where: {
      applicationId: input.applicationId,
      status: {
        in: ["RUNNING", "NEEDS_INPUT"],
      },
      userId: input.userId,
    },
  });
}

export async function findActiveTailorResumeRunsForUser(input: {
  userId: string;
}) {
  return getPrismaClient().tailorResumeRun.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      application: {
        select: {
          company: {
            select: {
              name: true,
            },
          },
          title: true,
        },
      },
      createdAt: true,
      error: true,
      id: true,
      jobDescription: true,
      jobUrl: true,
      status: true,
      stepAttempt: true,
      stepCount: true,
      stepDetail: true,
      stepNumber: true,
      stepRetrying: true,
      stepStatus: true,
      stepSummary: true,
      updatedAt: true,
    },
    where: {
      status: {
        in: ["RUNNING", "NEEDS_INPUT"],
      },
      userId: input.userId,
    },
  });
}

export async function deleteDbTailoredResumes(input: {
  ids: string[];
  userId: string;
}) {
  const ids = uniqueNonEmptyStrings(input.ids);

  if (ids.length === 0) {
    return;
  }

  await getPrismaClient().tailoredResume.deleteMany({
    where: {
      OR: [
        {
          id: {
            in: ids,
          },
        },
        {
          profileRecordId: {
            in: ids,
          },
        },
      ],
      userId: input.userId,
    },
  });
}

async function deleteJobApplications(input: {
  applicationIds: string[];
  userId: string;
}) {
  const applicationIds = uniqueNonEmptyStrings(input.applicationIds);

  if (applicationIds.length === 0) {
    return;
  }

  const prisma = getPrismaClient();
  const applications = await prisma.jobApplication.findMany({
    select: {
      id: true,
      screenshots: {
        select: {
          storagePath: true,
        },
      },
    },
    where: {
      id: {
        in: applicationIds,
      },
      userId: input.userId,
    },
  });

  if (applications.length === 0) {
    return;
  }

  const persistedApplicationIds = applications.map((application) => application.id);

  await prisma.$transaction([
    prisma.jobApplicationScreenshot.deleteMany({
      where: {
        applicationId: {
          in: persistedApplicationIds,
        },
        userId: input.userId,
      },
    }),
    prisma.jobApplication.deleteMany({
      where: {
        id: {
          in: persistedApplicationIds,
        },
        userId: input.userId,
      },
    }),
  ]);

  await Promise.all(
    applications.flatMap((application) =>
      application.screenshots.map((screenshot) =>
        deletePersistedJobScreenshot(screenshot.storagePath),
      ),
    ),
  );
}

export async function deleteTailorResumeArtifacts(input: {
  jobUrls?: Array<string | null | undefined>;
  runIds?: string[];
  tailoredResumeIds?: string[];
  userId: string;
}) {
  const prisma = getPrismaClient();
  const requestedRunIds = uniqueNonEmptyStrings(input.runIds ?? []);
  const requestedTailoredResumeIds = uniqueNonEmptyStrings(
    input.tailoredResumeIds ?? [],
  );
  const jobUrlHashes = uniqueNonEmptyStrings(
    (input.jobUrls ?? []).map((jobUrl) => buildNormalizedJobUrlHash(jobUrl)),
  );

  const [dbTailoredResumes, dbRuns, dbApplications] = await Promise.all([
    requestedTailoredResumeIds.length > 0
      ? prisma.tailoredResume.findMany({
          select: {
            applicationId: true,
            id: true,
            profileRecordId: true,
          },
          where: {
            OR: [
              {
                id: {
                  in: requestedTailoredResumeIds,
                },
              },
              {
                profileRecordId: {
                  in: requestedTailoredResumeIds,
                },
              },
            ],
            userId: input.userId,
          },
        })
      : Promise.resolve([]),
    requestedRunIds.length > 0
      ? prisma.tailorResumeRun.findMany({
          select: {
            applicationId: true,
            id: true,
            tailoredResumeId: true,
          },
          where: {
            id: {
              in: requestedRunIds,
            },
            userId: input.userId,
          },
        })
      : Promise.resolve([]),
    jobUrlHashes.length > 0
      ? prisma.jobApplication.findMany({
          select: {
            id: true,
          },
          where: {
            jobUrlHash: {
              in: jobUrlHashes,
            },
            userId: input.userId,
          },
        })
      : Promise.resolve([]),
  ]);

  const tailoredResumePdfIds = uniqueNonEmptyStrings([
    ...requestedTailoredResumeIds,
    ...dbTailoredResumes.map((record) => record.id),
    ...dbTailoredResumes.map((record) => record.profileRecordId),
    ...dbRuns.map((run) => run.tailoredResumeId),
  ]);
  const dbTailoredResumeIds = uniqueNonEmptyStrings([
    ...dbTailoredResumes.map((record) => record.id),
    ...dbRuns.map((run) => run.tailoredResumeId),
  ]);
  const applicationIds = uniqueNonEmptyStrings([
    ...dbTailoredResumes.map((record) => record.applicationId),
    ...dbRuns.map((run) => run.applicationId),
    ...dbApplications.map((application) => application.id),
  ]);

  await Promise.all(
    tailoredResumePdfIds.map((tailoredResumeId) =>
      deleteTailoredResumePdf(input.userId, tailoredResumeId),
    ),
  );
  await deleteDbTailoredResumes({
    ids: dbTailoredResumeIds,
    userId: input.userId,
  });
  await deleteJobApplications({
    applicationIds,
    userId: input.userId,
  });

  if (requestedRunIds.length > 0) {
    await prisma.tailorResumeRun.deleteMany({
      where: {
        id: {
          in: requestedRunIds,
        },
        userId: input.userId,
      },
    });
  }
}

async function cleanupInvalidTailorResumeArtifacts(userId: string) {
  await withTailorResumeProfileLock(userId, async () => {
    const { rawProfile } = await readTailorResumeProfileState(userId);
    const activeRuns = await getPrismaClient().tailorResumeRun.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        stepStatus: true,
        updatedAt: true,
      },
      where: {
        status: {
          in: ["RUNNING", "NEEDS_INPUT"],
        },
        userId,
      },
    });
    const invalidTailoredResumes = rawProfile.tailoredResumes.filter(
      isInvalidTailoredResumeArtifact,
    );
    const activeInterviewRunIds = new Set(
      readTailorResumeWorkspaceInterviews(rawProfile.workspace)
        .map((interview) => interview.tailorResumeRunId)
        .filter((runId): runId is string => Boolean(runId)),
    );
    const staleRunIds = activeRuns
      .filter((run) =>
        shouldDeleteActiveTailorResumeRun({
          hasMatchingInterview: activeInterviewRunIds.has(run.id),
          status: run.status,
          stepStatus: run.stepStatus,
          updatedAt: run.updatedAt,
        }),
      )
      .map((run) => run.id);

    if (invalidTailoredResumes.length === 0 && staleRunIds.length === 0) {
      return;
    }

    const staleRunIdSet = new Set(staleRunIds);
    const invalidTailoredResumeIdSet = new Set(
      invalidTailoredResumes.map((record) => record.id),
    );
    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      tailoredResumes: rawProfile.tailoredResumes.filter(
        (record) => !invalidTailoredResumeIdSet.has(record.id),
      ),
      workspace: withTailorResumeWorkspaceInterviews(
        rawProfile.workspace,
        readTailorResumeWorkspaceInterviews(rawProfile.workspace).filter(
          (interview) =>
            !(
              interview.tailorResumeRunId &&
              staleRunIdSet.has(interview.tailorResumeRunId)
            ),
        ),
        new Date().toISOString(),
      ),
    };

    if (nextRawProfile !== rawProfile) {
      await writeTailorResumeProfile(userId, nextRawProfile);
    }

    await deleteTailorResumeArtifacts({
      jobUrls: invalidTailoredResumes.map((record) => record.jobUrl),
      runIds: staleRunIds,
      tailoredResumeIds: invalidTailoredResumes.map((record) => record.id),
      userId,
    });
  });
}

export async function readTailorResumeResponseState(userId: string) {
  await cleanupInvalidTailorResumeArtifacts(userId);

  const { profile, rawProfile } = await readTailorResumeProfileState(userId);
  const activeRuns = await findActiveTailorResumeRunsForUser({
    userId,
  });

  return {
    activeRun: activeRuns[0] ?? null,
    activeRuns,
    profile,
    rawProfile,
  };
}
