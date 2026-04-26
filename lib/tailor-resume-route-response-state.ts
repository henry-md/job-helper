import { buildNormalizedJobUrlHash } from "./job-url-hash.ts";
import { deletePersistedJobScreenshot } from "./job-tracking.ts";
import { normalizeTailorResumeJobUrl } from "./tailor-resume-job-url.ts";
import { readTailorResumeProfileState } from "./tailor-resume-profile-state.ts";
import {
  deleteTailoredResumePdf,
  withTailorResumeProfileLock,
  writeTailorResumeProfile,
} from "./tailor-resume-storage.ts";
import type {
  TailorResumeLockedLinkRecord,
  TailorResumeProfile,
} from "./tailor-resume-types.ts";
import {
  readTailorResumeWorkspaceInterviews,
  withTailorResumeWorkspaceInterviews,
} from "./tailor-resume-workspace-interviews.ts";
import {
  isInvalidTailoredResumeArtifact,
  shouldDeleteActiveTailorResumeRun,
} from "./tailor-resume-artifact-cleanup.ts";
import { getPrismaClient } from "./prisma.ts";
import { bumpUserSyncState } from "./user-sync-state.ts";

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

export type LinkedDashboardDeleteImpact = {
  applicationCount: number;
  applicationIds: string[];
  tailoredResumeCount: number;
  tailoredResumeIds: string[];
  totalCount: number;
};

type ResolvedLinkedDashboardDeleteImpact = LinkedDashboardDeleteImpact & {
  dbTailoredResumeIds: string[];
  interviewIds: string[];
};

type TailoredResumeLinkRecord = {
  applicationId: string | null;
  id: string;
  jobUrl: string | null;
  profileRecordId: string;
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

function uniqueNormalizedJobUrls(values: Array<string | null | undefined>) {
  return uniqueNonEmptyStrings(
    values.map((value) => normalizeTailorResumeJobUrl(value)),
  );
}

export async function findActiveTailorResumeRun(input: {
  applicationId: string | null;
  userId: string;
}) {
  if (!input.applicationId) {
    return null;
  }

  return getPrismaClient().tailorResumeRun.findFirst({
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
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
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
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

async function resolveLinkedDashboardDeleteImpact(input: {
  applicationIds?: string[];
  rawProfile: TailorResumeProfile;
  tailoredResumeIds?: string[];
  userId: string;
}): Promise<ResolvedLinkedDashboardDeleteImpact> {
  const prisma = getPrismaClient();
  const requestedTailoredResumeIds = uniqueNonEmptyStrings(
    input.tailoredResumeIds ?? [],
  );
  const requestedProfileTailoredResumes = input.rawProfile.tailoredResumes.filter(
    (record) => requestedTailoredResumeIds.includes(record.id),
  );
  const requestedDbTailoredResumes = requestedTailoredResumeIds.length
    ? await prisma.tailoredResume.findMany({
        select: {
          applicationId: true,
          id: true,
          jobUrl: true,
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
    : [];
  const requestedApplicationIds = uniqueNonEmptyStrings([
    ...(input.applicationIds ?? []),
    ...requestedProfileTailoredResumes.map((record) => record.applicationId),
    ...requestedDbTailoredResumes.map((record) => record.applicationId),
  ]);
  const requestedJobUrlHashes = uniqueNonEmptyStrings(
    [
      ...requestedProfileTailoredResumes.map((record) => record.jobUrl),
      ...requestedDbTailoredResumes.map((record) => record.jobUrl),
    ].map((jobUrl) => buildNormalizedJobUrlHash(jobUrl)),
  );
  const [applicationsById, applicationsByJobUrl] = await Promise.all([
    requestedApplicationIds.length > 0
      ? prisma.jobApplication.findMany({
          select: {
            id: true,
            jobUrl: true,
          },
          where: {
            id: {
              in: requestedApplicationIds,
            },
            userId: input.userId,
          },
        })
      : Promise.resolve([]),
    requestedJobUrlHashes.length > 0
      ? prisma.jobApplication.findMany({
          select: {
            id: true,
            jobUrl: true,
          },
          where: {
            jobUrlHash: {
              in: requestedJobUrlHashes,
            },
            userId: input.userId,
          },
        })
      : Promise.resolve([]),
  ]);
  const applicationById = new Map<
    string,
    {
      id: string;
      jobUrl: string | null;
    }
  >();

  for (const application of [...applicationsById, ...applicationsByJobUrl]) {
    applicationById.set(application.id, application);
  }

  const linkedApplications = [...applicationById.values()];
  const linkedApplicationIds = linkedApplications.map((application) => application.id);
  const linkedApplicationIdSet = new Set(linkedApplicationIds);
  const linkedApplicationJobUrls = uniqueNormalizedJobUrls(
    linkedApplications.map((application) => application.jobUrl),
  );
  const linkedApplicationJobUrlSet = new Set(linkedApplicationJobUrls);
  const linkedDbTailoredResumes: TailoredResumeLinkRecord[] =
    linkedApplicationIds.length > 0
      ? await prisma.tailoredResume.findMany({
          select: {
            applicationId: true,
            id: true,
            jobUrl: true,
            profileRecordId: true,
          },
          where: {
            applicationId: {
              in: linkedApplicationIds,
            },
            userId: input.userId,
          },
        })
      : [];
  const allLinkedDbTailoredResumes = [
    ...requestedDbTailoredResumes,
    ...linkedDbTailoredResumes,
  ];
  const tailoredResumeIds = uniqueNonEmptyStrings([
    ...requestedTailoredResumeIds,
    ...allLinkedDbTailoredResumes.map((record) => record.profileRecordId),
    ...input.rawProfile.tailoredResumes
      .filter((record) => {
        if (
          record.applicationId &&
          linkedApplicationIdSet.has(record.applicationId)
        ) {
          return true;
        }

        const normalizedJobUrl = normalizeTailorResumeJobUrl(record.jobUrl);
        return Boolean(
          normalizedJobUrl &&
            linkedApplicationJobUrlSet.has(normalizedJobUrl),
        );
      })
      .map((record) => record.id),
  ]);
  const interviewIds = uniqueNonEmptyStrings(
    readTailorResumeWorkspaceInterviews(input.rawProfile.workspace)
      .filter((interview) => {
        if (
          interview.applicationId &&
          linkedApplicationIdSet.has(interview.applicationId)
        ) {
          return true;
        }

        const normalizedJobUrl = normalizeTailorResumeJobUrl(interview.jobUrl);
        return Boolean(
          normalizedJobUrl &&
            linkedApplicationJobUrlSet.has(normalizedJobUrl),
        );
      })
      .map((interview) => interview.id),
  );

  return {
    applicationCount: linkedApplicationIds.length,
    applicationIds: linkedApplicationIds,
    dbTailoredResumeIds: uniqueNonEmptyStrings(
      allLinkedDbTailoredResumes.map((record) => record.id),
    ),
    interviewIds,
    tailoredResumeCount: tailoredResumeIds.length,
    tailoredResumeIds,
    totalCount: linkedApplicationIds.length + tailoredResumeIds.length,
  };
}

export async function deleteLinkedDashboardArtifacts(input: {
  applicationId?: string | null;
  tailoredResumeId?: string | null;
  userId: string;
}): Promise<{
  impact: LinkedDashboardDeleteImpact;
  lockedLinks: TailorResumeLockedLinkRecord[];
  rawProfile: TailorResumeProfile;
}> {
  return withTailorResumeProfileLock(input.userId, async () => {
    const latestState = await readTailorResumeProfileState(input.userId);
    const impact = await resolveLinkedDashboardDeleteImpact({
      applicationIds: input.applicationId ? [input.applicationId] : [],
      rawProfile: latestState.rawProfile,
      tailoredResumeIds: input.tailoredResumeId ? [input.tailoredResumeId] : [],
      userId: input.userId,
    });

    if (impact.totalCount === 0) {
      return {
        impact,
        lockedLinks: latestState.lockedLinks,
        rawProfile: latestState.rawProfile,
      };
    }

    await Promise.all(
      impact.tailoredResumeIds.map((tailoredResumeId) =>
        deleteTailoredResumePdf(input.userId, tailoredResumeId),
      ),
    );
    await deleteDbTailoredResumes({
      ids: [...impact.dbTailoredResumeIds, ...impact.tailoredResumeIds],
      userId: input.userId,
    });
    await deleteJobApplications({
      applicationIds: impact.applicationIds,
      userId: input.userId,
    });

    const tailoredResumeIdSet = new Set(impact.tailoredResumeIds);
    const interviewIdSet = new Set(impact.interviewIds);
    const nextRawProfile: TailorResumeProfile = {
      ...latestState.rawProfile,
      tailoredResumes: latestState.rawProfile.tailoredResumes.filter(
        (record) => !tailoredResumeIdSet.has(record.id),
      ),
      workspace:
        interviewIdSet.size > 0
          ? withTailorResumeWorkspaceInterviews(
              latestState.rawProfile.workspace,
              readTailorResumeWorkspaceInterviews(
                latestState.rawProfile.workspace,
              ).filter((interview) => !interviewIdSet.has(interview.id)),
              new Date().toISOString(),
            )
          : latestState.rawProfile.workspace,
    };

    if (impact.tailoredResumeCount > 0 || interviewIdSet.size > 0) {
      await writeTailorResumeProfile(input.userId, nextRawProfile);
    }

    await bumpUserSyncState({
      applications: impact.applicationCount > 0,
      tailoring: impact.tailoredResumeCount > 0 || interviewIdSet.size > 0,
      userId: input.userId,
    });

    return {
      impact: {
        applicationCount: impact.applicationCount,
        applicationIds: impact.applicationIds,
        tailoredResumeCount: impact.tailoredResumeCount,
        tailoredResumeIds: impact.tailoredResumeIds,
        totalCount: impact.totalCount,
      },
      lockedLinks: latestState.lockedLinks,
      rawProfile: nextRawProfile,
    };
  });
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

  await bumpUserSyncState({
    applications: applicationIds.length > 0,
    tailoring: dbTailoredResumes.length > 0 || dbRuns.length > 0,
    userId: input.userId,
  });
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

    await bumpUserSyncState({
      applications: false,
      tailoring: invalidTailoredResumes.length > 0 || staleRunIds.length > 0,
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
