import { timingSafeEqual } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractJobApplicationFromEvidence } from "@/lib/job-application-extraction";
import { getPrismaClient } from "@/lib/prisma";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobPageContext,
  JobPostingStructuredHint,
  JobLocationType,
} from "@/lib/job-application-types";
import {
  assertSupportedImageFile,
  fileBufferToDataUrl,
  normalizeCompanyName,
  normalizeSalaryRange,
  persistJobScreenshot,
  resolveAppliedAt,
} from "@/lib/job-tracking";

export const runtime = "nodejs";

const allowedLocationTypes = new Set<JobLocationType>([
  "remote",
  "onsite",
  "hybrid",
]);
const allowedApplicationStatuses = new Set<ApplicationStatusValue>([
  "SAVED",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
]);
const allowedEmploymentTypes = new Set<EmploymentTypeValue>([
  "full_time",
  "part_time",
  "contract",
  "internship",
]);

function readHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  return value?.trim() ?? "";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 24);
}

function readBooleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStructuredHint(value: unknown): JobPostingStructuredHint | null {
  if (!isRecord(value)) {
    return null;
  }

  const hint = {
    baseSalary: readStringArray(value.baseSalary),
    datePosted: readString(value.datePosted) || null,
    description: readString(value.description) || null,
    directApply: readBooleanOrNull(value.directApply),
    employmentType: readStringArray(value.employmentType),
    hiringOrganization: readString(value.hiringOrganization) || null,
    identifier: readString(value.identifier) || null,
    locations: readStringArray(value.locations),
    title: readString(value.title) || null,
    validThrough: readString(value.validThrough) || null,
  } satisfies JobPostingStructuredHint;

  const hasContent = Object.values(hint).some((fieldValue) => {
    if (Array.isArray(fieldValue)) {
      return fieldValue.length > 0;
    }

    return fieldValue !== null;
  });

  return hasContent ? hint : null;
}

function parsePageContext(rawValue: FormDataEntryValue | null) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!isRecord(parsed)) {
      return null;
    }

    return {
      canonicalUrl: readString(parsed.canonicalUrl),
      companyCandidates: readStringArray(parsed.companyCandidates),
      description: readString(parsed.description),
      employmentTypeCandidates: readStringArray(parsed.employmentTypeCandidates),
      headings: readStringArray(parsed.headings),
      jsonLdJobPostings: Array.isArray(parsed.jsonLdJobPostings)
        ? parsed.jsonLdJobPostings
            .map(parseStructuredHint)
            .filter((hint): hint is JobPostingStructuredHint => Boolean(hint))
            .slice(0, 4)
        : [],
      locationCandidates: readStringArray(parsed.locationCandidates),
      rawText: readString(parsed.rawText),
      salaryMentions: readStringArray(parsed.salaryMentions),
      selectionText: readString(parsed.selectionText),
      siteName: readString(parsed.siteName),
      title: readString(parsed.title),
      titleCandidates: readStringArray(parsed.titleCandidates),
      topTextBlocks: readStringArray(parsed.topTextBlocks),
      url: readString(parsed.url),
    } satisfies JobPageContext;
  } catch {
    return null;
  }
}

function hasPageContextEvidence(pageContext: JobPageContext | null) {
  if (!pageContext) {
    return false;
  }

  return Object.values(pageContext).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value.length > 0;
  });
}

function getConfiguredIngestSecret() {
  return (
    process.env.JOB_HELPER_INGEST_SECRET?.trim() ||
    process.env.HAMMERSPOON_INGEST_SECRET?.trim() ||
    ""
  );
}

function matchesConfiguredSecret(receivedSecret: string) {
  const configuredSecret = getConfiguredIngestSecret();

  if (!configuredSecret || !receivedSecret) {
    return false;
  }

  const configuredBuffer = Buffer.from(configuredSecret);
  const receivedBuffer = Buffer.from(receivedSecret);

  if (configuredBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, receivedBuffer);
}

async function resolveUserId(request: Request) {
  const session = await getServerSession(authOptions);

  if (session?.user?.id) {
    return session.user.id;
  }

  if (!getConfiguredIngestSecret()) {
    throw new Error(
      "JOB_HELPER_INGEST_SECRET is not configured. Set it in .env for non-session ingestion clients.",
    );
  }

  if (!matchesConfiguredSecret(readHeader(request, "x-job-helper-secret"))) {
    return null;
  }

  const userEmail = readHeader(request, "x-job-helper-user-email");

  if (!userEmail) {
    throw new Error("Provide X-Job-Helper-User-Email for secret-based ingestion.");
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: userEmail,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`No user exists for ${userEmail}.`);
  }

  return user.id;
}

function readScreenshotFiles(formData: FormData) {
  const files = formData
    .getAll("jobScreenshots")
    .filter((entry): entry is File => entry instanceof File);
  const singleFile = formData.get("jobScreenshot");

  if (singleFile instanceof File) {
    files.push(singleFile);
  }

  return files;
}

function requireExtractedText(value: string | null | undefined, fieldName: string) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`Could not determine the ${fieldName} from the provided evidence.`);
  }

  return normalizedValue;
}

function normalizeLocation(value: JobLocationType | null) {
  return value && allowedLocationTypes.has(value) ? value : null;
}

function normalizeStatus(value: ApplicationStatusValue | null) {
  return value && allowedApplicationStatuses.has(value) ? value : "APPLIED";
}

function normalizeEmploymentType(value: EmploymentTypeValue | null) {
  return value && allowedEmploymentTypes.has(value) ? value : null;
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

function normalizeOnsiteDaysPerWeek(
  location: JobLocationType | null,
  value: number | null,
) {
  if (location !== "onsite" && location !== "hybrid") {
    return null;
  }

  if (!Number.isInteger(value) || value === null || value < 1 || value > 7) {
    return null;
  }

  return value;
}

function normalizeUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }

    return trimmedValue;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;

  try {
    userId = await resolveUserId(request);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to authorize the ingestion request.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFiles = readScreenshotFiles(formData);
  const pageContext = parsePageContext(formData.get("pageContext"));
  const source = readString(formData.get("source")) || "api";

  if (screenshotFiles.length === 0 && !hasPageContextEvidence(pageContext)) {
    return NextResponse.json(
      { error: "Provide at least one screenshot or some page text/context to ingest." },
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

  try {
    const extractionResult = await extractJobApplicationFromEvidence({
      pageContext,
      screenshots: await Promise.all(
        screenshotFiles.map(async (screenshotFile) => ({
          dataUrl: fileBufferToDataUrl(
            Buffer.from(await screenshotFile.arrayBuffer()),
            screenshotFile.type,
          ),
          filename: screenshotFile.name || "job-screenshot",
          mimeType: screenshotFile.type,
        })),
      ),
    });
    const extraction = extractionResult.extraction;
    let companyName: string;
    let jobTitle: string;

    try {
      companyName = requireExtractedText(extraction.companyName, "company name");
      jobTitle = requireExtractedText(extraction.jobTitle, "job title");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "The extracted evidence is incomplete.";

      return NextResponse.json(
        {
          error: detail,
          extraction,
          model: extractionResult.model,
        },
        { status: 422 },
      );
    }

    const prisma = getPrismaClient();
    const location = normalizeLocation(extraction.location);
    const normalizedStatus = normalizeStatus(extraction.status);
    const normalizedEmploymentType = normalizeEmploymentType(
      extraction.employmentType,
    );
    const normalizedOnsiteDaysPerWeek = normalizeOnsiteDaysPerWeek(
      location,
      extraction.onsiteDaysPerWeek,
    );
    const normalizedJobUrl = normalizeUrl(extraction.jobUrl);
    const normalizedSalary = normalizeSalaryRange(extraction.salaryRange);
    const normalizedNotes = normalizeOptionalText(extraction.notes);
    const normalizedJobDescription = normalizeOptionalText(
      extraction.jobDescription,
    );
    const normalizedTeamOrDepartment = normalizeOptionalText(
      extraction.teamOrDepartment,
    );
    const normalizedRecruiterContact = normalizeOptionalText(
      extraction.recruiterContact,
    );
    const normalizedReferrerName = normalizeOptionalText(extraction.referrerName);
    const persistedScreenshots = await Promise.all(
      screenshotFiles.map((screenshotFile) =>
        persistJobScreenshot(screenshotFile, userId),
      ),
    );

    const company = await prisma.company.upsert({
      where: {
        userId_normalizedName: {
          userId,
          normalizedName: normalizeCompanyName(companyName),
        },
      },
      create: {
        userId,
        name: companyName,
        normalizedName: normalizeCompanyName(companyName),
      },
      update: {
        name: companyName,
      },
    });

    const referrer = normalizedReferrerName
      ? await prisma.person.upsert({
          where: {
            userId_normalizedName: {
              userId,
              normalizedName: normalizedReferrerName
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
            },
          },
          create: {
            userId,
            companyId: company.id,
            name: normalizedReferrerName,
            normalizedName: normalizedReferrerName
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
            recruiterContact: normalizedRecruiterContact,
          },
          update: {
            companyId: company.id,
            name: normalizedReferrerName,
            recruiterContact: normalizedRecruiterContact,
          },
          select: {
            id: true,
            recruiterContact: true,
          },
        })
      : null;

    const application = await prisma.jobApplication.create({
      data: {
        userId,
        companyId: company.id,
        referrerId: referrer?.id ?? null,
        title: jobTitle,
        status: normalizedStatus,
        location,
        onsiteDaysPerWeek: normalizedOnsiteDaysPerWeek,
        jobUrl: normalizedJobUrl,
        salaryRange: normalizedSalary.text,
        salaryMinimum: normalizedSalary.minimum,
        salaryMaximum: normalizedSalary.maximum,
        employmentType: normalizedEmploymentType,
        teamOrDepartment: normalizedTeamOrDepartment,
        recruiterContact:
          referrer?.recruiterContact ?? normalizedRecruiterContact,
        notes: normalizedNotes,
        hasReferral: Boolean(referrer),
        jobDescription: normalizedJobDescription,
        appliedAt: resolveAppliedAt(extraction.appliedAt),
      },
      include: {
        company: true,
        referrer: {
          include: {
            company: true,
          },
        },
        screenshots: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    await Promise.all(
      screenshotFiles.map((screenshotFile, index) =>
        prisma.jobApplicationScreenshot.create({
          data: {
            applicationId: application.id,
            userId,
            originalFilename: screenshotFile.name || "job-screenshot",
            storagePath: persistedScreenshots[index]?.storagePath ?? "",
            mimeType: screenshotFile.type || "application/octet-stream",
            sizeBytes: persistedScreenshots[index]?.sizeBytes ?? screenshotFile.size,
            extractionStatus: "SUCCEEDED",
            extractionModel: extractionResult.model,
            extractedPayload: extraction,
          },
        }),
      ),
    );

    const savedApplication = await prisma.jobApplication.findUniqueOrThrow({
      where: {
        id: application.id,
      },
      include: {
        company: true,
        referrer: {
          include: {
            company: true,
          },
        },
        screenshots: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    return NextResponse.json({
      application: savedApplication,
      extraction,
      evidence: {
        hasPageContext: hasPageContextEvidence(pageContext),
        screenshotCount: screenshotFiles.length,
        source,
      },
      model: extractionResult.model,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to ingest the job evidence.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
