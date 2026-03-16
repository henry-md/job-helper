import { timingSafeEqual } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractJobApplicationFromScreenshot } from "@/lib/job-application-extraction";
import { getPrismaClient } from "@/lib/prisma";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobApplicationExtraction,
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

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function normalizePersonName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  return value?.trim() ?? "";
}

function matchesConfiguredSecret(receivedSecret: string) {
  const configuredSecret = process.env.HAMMERSPOON_INGEST_SECRET?.trim();

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

  const receivedSecret = readHeader(request, "x-job-helper-secret");

  if (!process.env.HAMMERSPOON_INGEST_SECRET?.trim()) {
    throw new Error("HAMMERSPOON_INGEST_SECRET is not configured.");
  }

  if (!matchesConfiguredSecret(receivedSecret)) {
    return null;
  }

  const userEmail = readHeader(request, "x-job-helper-user-email");

  if (!userEmail) {
    throw new Error("Provide X-Job-Helper-User-Email for Hammerspoon uploads.");
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

function requireText(value: string | null | undefined, fieldName: string) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`Could not determine the ${fieldName} from the screenshot.`);
  }

  return normalizedValue;
}

function normalizeLocation(value: JobApplicationExtraction["location"]) {
  return value && allowedLocationTypes.has(value) ? value : null;
}

function normalizeStatus(value: JobApplicationExtraction["status"]) {
  return value && allowedApplicationStatuses.has(value) ? value : "APPLIED";
}

function normalizeEmploymentType(value: JobApplicationExtraction["employmentType"]) {
  return value && allowedEmploymentTypes.has(value) ? value : null;
}

function normalizeOnsiteDaysPerWeek(
  location: JobLocationType | null,
  value: JobApplicationExtraction["onsiteDaysPerWeek"],
) {
  if (
    location !== "onsite" &&
    location !== "hybrid"
  ) {
    return null;
  }

  if (!Number.isInteger(value) || value === null || value < 1 || value > 7) {
    return null;
  }

  return value;
}

function normalizeUrl(value: string | null) {
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

function normalizeOptionalText(value: string | null) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

export async function POST(request: Request) {
  let userId: string | null = null;

  try {
    userId = await resolveUserId(request);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to authorize the upload.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFile = formData.get("jobScreenshot");

  if (!(screenshotFile instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "jobScreenshot" upload.' },
      { status: 400 },
    );
  }

  try {
    assertSupportedImageFile(screenshotFile);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Upload a valid screenshot.";

    return NextResponse.json({ error: detail }, { status: 400 });
  }

  try {
    const testOpenAIResponseEnabled = isTestOpenAIResponseEnabled();
    const extractionResult = await extractJobApplicationFromScreenshot({
      dataUrl: testOpenAIResponseEnabled
        ? "data:image/png;base64,"
        : fileBufferToDataUrl(
            Buffer.from(await screenshotFile.arrayBuffer()),
            screenshotFile.type,
          ),
      existingDraft: null,
      filename: screenshotFile.name || "job-screenshot",
      mimeType: screenshotFile.type,
    });
    const extraction = extractionResult.extraction;
    const prisma = getPrismaClient();
    const companyName = requireText(extraction.companyName, "company name");
    const jobTitle = requireText(extraction.jobTitle, "job title");
    const location = normalizeLocation(extraction.location);
    const appliedAt = extraction.appliedAt?.trim() || null;
    const normalizedJobUrl = normalizeUrl(extraction.jobUrl);
    const normalizedSalary = normalizeSalaryRange(extraction.salaryRange);
    const normalizedEmploymentType = normalizeEmploymentType(
      extraction.employmentType,
    );
    const normalizedStatus = normalizeStatus(extraction.status);
    const normalizedOnsiteDaysPerWeek = normalizeOnsiteDaysPerWeek(
      location,
      extraction.onsiteDaysPerWeek,
    );
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
    const persistedScreenshot = await persistJobScreenshot(screenshotFile, userId);

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
              normalizedName: normalizePersonName(normalizedReferrerName),
            },
          },
          create: {
            userId,
            companyId: company.id,
            name: normalizedReferrerName,
            normalizedName: normalizePersonName(normalizedReferrerName),
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
        appliedAt: resolveAppliedAt(appliedAt),
        screenshots: {
          create: {
            userId,
            originalFilename: screenshotFile.name || "job-screenshot",
            storagePath: persistedScreenshot.storagePath,
            mimeType: screenshotFile.type || "application/octet-stream",
            sizeBytes: persistedScreenshot.sizeBytes,
            extractionStatus: "SUCCEEDED",
            extractionModel: extractionResult.model,
            extractedPayload: extraction,
          },
        },
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
      application,
      extraction,
      model: extractionResult.model,
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Failed to ingest the screenshot.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
