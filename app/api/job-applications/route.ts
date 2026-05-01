import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getApiSession } from "@/lib/api-auth";
import { normalizeJobApplicationWriteInput } from "@/lib/job-application-form";
import { getPrismaClient } from "@/lib/prisma";
import { bumpUserSyncState } from "@/lib/user-sync-state";
import { buildNormalizedJobUrlHash } from "@/lib/job-url-hash";
import type {
  JobApplicationExtraction,
} from "@/lib/job-application-types";
import {
  filterVisibleJobApplicationsByUrl,
  toJobApplicationRecord,
} from "@/lib/job-application-records";
import {
  normalizeCompanyName,
  resolveAppliedAt,
} from "@/lib/job-tracking-shared";
import { normalizeTailorResumeJobUrl } from "@/lib/tailor-resume-job-url";
import {
  assertSupportedImageFile,
  persistJobScreenshot,
} from "@/lib/job-tracking";

type DraftUploadSnapshot = {
  error: string | null;
  extraction: JobApplicationExtraction | null;
  model: string | null;
  status: "extracting" | "failed" | "ready";
};

function parseDraftUploadSnapshots(rawValue: FormDataEntryValue | null) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [] as DraftUploadSnapshot[];
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [] as DraftUploadSnapshot[];
    }

    return parsed.map((item) => {
      if (typeof item !== "object" || item === null) {
        return {
          error: null,
          extraction: null,
          model: null,
          status: "extracting",
        } satisfies DraftUploadSnapshot;
      }

      return {
        error: typeof item.error === "string" ? item.error : null,
        extraction:
          typeof item.extraction === "object" && item.extraction !== null
            ? (item.extraction as JobApplicationExtraction)
            : null,
        model: typeof item.model === "string" ? item.model : null,
        status:
          item.status === "ready" || item.status === "failed"
            ? item.status
            : "extracting",
      } satisfies DraftUploadSnapshot;
    });
  } catch {
    return [] as DraftUploadSnapshot[];
  }
}

function readApplicationListLimit(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");

  if (!rawLimit) {
    return 25;
  }

  if (rawLimit.trim().toLowerCase() === "all") {
    return null;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);

  if (!Number.isInteger(parsedLimit)) {
    return 25;
  }

  return Math.min(Math.max(parsedLimit, 1), 100);
}

function readIncludeArchivedFlag(request: Request) {
  const includeArchived = new URL(request.url).searchParams.get("includeArchived");

  return (
    includeArchived === "1" ||
    includeArchived === "true" ||
    includeArchived === "yes"
  );
}

async function findExistingApplicationByJobUrl(input: {
  jobUrl: string | null;
  jobUrlHash: string | null;
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
}) {
  const normalizedJobUrl = normalizeTailorResumeJobUrl(input.jobUrl);

  if (!normalizedJobUrl || !input.jobUrlHash) {
    return null;
  }

  const exactHashMatch = await input.prisma.jobApplication.findUnique({
    select: {
      id: true,
    },
    where: {
      userId_jobUrlHash: {
        jobUrlHash: input.jobUrlHash,
        userId: input.userId,
      },
    },
  });

  if (exactHashMatch) {
    return exactHashMatch;
  }

  const candidates = await input.prisma.jobApplication.findMany({
    select: {
      id: true,
      jobUrl: true,
    },
    where: {
      jobUrl: {
        not: null,
      },
      userId: input.userId,
    },
  });

  return (
    candidates.find(
      (candidate) =>
        normalizeTailorResumeJobUrl(candidate.jobUrl) === normalizedJobUrl,
    ) ?? null
  );
}

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const prisma = getPrismaClient();
  const limit = readApplicationListLimit(request);
  const includeArchived = readIncludeArchivedFlag(request);
  const applicationWhere = includeArchived
    ? { userId: session.user.id }
    : { archivedAt: null, userId: session.user.id };

  try {
    const [applications, companyCount] = await Promise.all([
      prisma.jobApplication.findMany({
        include: {
          company: true,
          referrer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        where: applicationWhere,
      }),
      prisma.company.count({
        where: {
          applications: {
            some: {
              ...applicationWhere,
            },
          },
          userId: session.user.id,
        },
      }),
    ]);
    const visibleApplications = filterVisibleJobApplicationsByUrl(applications);
    const limitedApplications =
      limit === null ? visibleApplications : visibleApplications.slice(0, limit);

    return NextResponse.json({
      applicationCount: visibleApplications.length,
      applications: limitedApplications.map(toJobApplicationRecord),
      companyCount,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to load applications.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFiles = formData
    .getAll("jobScreenshots")
    .filter((entry): entry is File => entry instanceof File);

  if (screenshotFiles.length === 0) {
    return NextResponse.json(
      { error: "Add at least one screenshot before saving." },
      { status: 400 },
    );
  }

  try {
    screenshotFiles.forEach(assertSupportedImageFile);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Upload a valid screenshot.";

    return NextResponse.json({ error: detail }, { status: 400 });
  }

  const jobTitle = formData.get("jobTitle");
  const companyName = formData.get("companyName");
  const appliedAt = formData.get("appliedAt");
  const jobDescription = formData.get("jobDescription");
  const location = formData.get("location");
  const onsiteDaysPerWeek = formData.get("onsiteDaysPerWeek");
  const referrerId = formData.get("referrerId");
  const jobUrl = formData.get("jobUrl");
  const salaryRange = formData.get("salaryRange");
  const employmentType = formData.get("employmentType");
  const teamOrDepartment = formData.get("teamOrDepartment");
  const recruiterContact = formData.get("recruiterContact");
  const notes = formData.get("notes");
  const status = formData.get("status");
  const normalizedInput = normalizeJobApplicationWriteInput({
    appliedAt,
    companyName,
    employmentType,
    jobDescription,
    jobTitle,
    jobUrl,
    location,
    notes,
    onsiteDaysPerWeek,
    recruiterContact,
    referrerId,
    salaryRange,
    status,
    teamOrDepartment,
  });

  if (!normalizedInput.ok) {
    return NextResponse.json({ error: normalizedInput.error }, { status: 400 });
  }

  const {
    appliedAt: normalizedAppliedAt,
    companyName: normalizedCompanyName,
    employmentType: normalizedEmploymentType,
    jobDescription: normalizedJobDescription,
    jobTitle: normalizedJobTitle,
    jobUrl: normalizedJobUrl,
    location: normalizedLocation,
    normalizedSalary,
    notes: normalizedNotes,
    persistedOnsiteDaysPerWeek,
    recruiterContact: normalizedRecruiterContact,
    referrerId: normalizedReferrerId,
    status: normalizedStatus,
    teamOrDepartment: normalizedTeamOrDepartment,
  } = normalizedInput.value;

  const draftSnapshots = parseDraftUploadSnapshots(formData.get("draftUploadSnapshots"));
  const prisma = getPrismaClient();

  try {
    let referrerRecord: { id: string; recruiterContact: string | null } | null = null;

    if (normalizedReferrerId) {
      referrerRecord = await prisma.person.findFirst({
        where: {
          id: normalizedReferrerId,
          userId: session.user.id,
        },
        select: { id: true, recruiterContact: true },
      });

      if (!referrerRecord) {
        return NextResponse.json(
          { error: "Selected referrer was not found." },
          { status: 400 },
        );
      }
    }

    const persistedScreenshots = await Promise.all(
      screenshotFiles.map((screenshotFile) =>
        persistJobScreenshot(screenshotFile, session.user.id),
      ),
    );

    const company = await prisma.company.upsert({
      where: {
        userId_normalizedName: {
          userId: session.user.id,
          normalizedName: normalizeCompanyName(normalizedCompanyName),
        },
      },
      create: {
        userId: session.user.id,
        name: normalizedCompanyName,
        normalizedName: normalizeCompanyName(normalizedCompanyName),
      },
      update: {
        name: normalizedCompanyName,
      },
    });

    const normalizedJobUrlHash = buildNormalizedJobUrlHash(normalizedJobUrl);
    const existingApplication = await findExistingApplicationByJobUrl({
      jobUrl: normalizedJobUrl,
      jobUrlHash: normalizedJobUrlHash,
      prisma,
      userId: session.user.id,
    });
    const applicationData = {
      userId: session.user.id,
      companyId: company.id,
      title: normalizedJobTitle,
      status: normalizedStatus,
      location: normalizedLocation,
      onsiteDaysPerWeek: persistedOnsiteDaysPerWeek,
      referrerId: referrerRecord?.id ?? null,
      jobUrl: normalizedJobUrl,
      jobUrlHash: normalizedJobUrlHash,
      salaryRange: normalizedSalary.text,
      salaryMinimum: normalizedSalary.minimum,
      salaryMaximum: normalizedSalary.maximum,
      employmentType: normalizedEmploymentType,
      teamOrDepartment: normalizedTeamOrDepartment,
      recruiterContact: referrerRecord?.recruiterContact ?? normalizedRecruiterContact,
      notes: normalizedNotes,
      hasReferral: Boolean(referrerRecord),
      jobDescription: normalizedJobDescription,
      archivedAt: null,
      appliedAt: resolveAppliedAt(normalizedAppliedAt),
    };

    const application = existingApplication
      ? await prisma.jobApplication.update({
          where: {
            id: existingApplication.id,
          },
          data: applicationData,
          include: {
            company: true,
            screenshots: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        })
      : await prisma.jobApplication.create({
          data: applicationData,
          include: {
            company: true,
            screenshots: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

    await Promise.all(
      screenshotFiles.map((screenshotFile, index) => {
        const snapshot = draftSnapshots[index];
        const extractionStatus =
          snapshot?.status === "failed"
            ? "FAILED"
            : snapshot?.status === "ready"
              ? "SUCCEEDED"
              : "PENDING";

        return prisma.jobApplicationScreenshot.create({
          data: {
            applicationId: application.id,
            userId: session.user.id,
            originalFilename: screenshotFile.name || "job-screenshot",
            storagePath: persistedScreenshots[index]?.storagePath ?? "",
            mimeType: screenshotFile.type || "application/octet-stream",
            sizeBytes: persistedScreenshots[index]?.sizeBytes ?? screenshotFile.size,
            extractionStatus,
            extractionModel: snapshot?.model ?? null,
            extractionError:
              extractionStatus === "FAILED"
                ? snapshot?.error ?? "Draft extraction failed before save."
                : null,
            ...(snapshot?.extraction
              ? { extractedPayload: snapshot.extraction }
              : {}),
          },
        });
      }),
    );

    const savedApplication = await prisma.jobApplication.findUniqueOrThrow({
      where: {
        id: application.id,
      },
      include: {
        company: true,
        screenshots: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    await bumpUserSyncState({
      applications: true,
      userId: session.user.id,
    });

    return NextResponse.json({ application: savedApplication });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to save the application.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
