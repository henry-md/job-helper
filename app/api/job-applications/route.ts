import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobApplicationExtraction,
  JobLocationType,
} from "@/lib/job-application-types";
import {
  assertSupportedImageFile,
  normalizeCompanyName,
  persistJobScreenshot,
  resolveAppliedAt,
} from "@/lib/job-tracking";

type DraftUploadSnapshot = {
  error: string | null;
  extraction: JobApplicationExtraction | null;
  model: string | null;
  status: "extracting" | "failed" | "ready";
};

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
  const hasReferral = formData.get("hasReferral");
  const location = formData.get("location");
  const onsiteDaysPerWeek = formData.get("onsiteDaysPerWeek");
  const jobUrl = formData.get("jobUrl");
  const salaryRange = formData.get("salaryRange");
  const employmentType = formData.get("employmentType");
  const teamOrDepartment = formData.get("teamOrDepartment");
  const recruiterContact = formData.get("recruiterContact");
  const notes = formData.get("notes");
  const status = formData.get("status");

  if (typeof jobTitle !== "string" || jobTitle.trim().length === 0) {
    return NextResponse.json(
      { error: "Add a job title before saving." },
      { status: 400 },
    );
  }

  if (typeof companyName !== "string" || companyName.trim().length === 0) {
    return NextResponse.json(
      { error: "Add a company name before saving." },
      { status: 400 },
    );
  }

  if (
    typeof appliedAt === "string" &&
    appliedAt.trim().length > 0 &&
    !/^\d{4}-\d{2}-\d{2}$/.test(appliedAt.trim())
  ) {
    return NextResponse.json(
      { error: "Use YYYY-MM-DD for the applied date." },
      { status: 400 },
    );
  }

  const normalizedLocation =
    typeof location === "string" && location.trim().length > 0
      ? location.trim().toLowerCase()
      : null;

  if (
    normalizedLocation !== null &&
    !allowedLocationTypes.has(normalizedLocation as JobLocationType)
  ) {
    return NextResponse.json(
      { error: "Location must be remote, onsite, or hybrid." },
      { status: 400 },
    );
  }

  const normalizedOnsiteDaysPerWeek =
    typeof onsiteDaysPerWeek === "string" && onsiteDaysPerWeek.trim().length > 0
      ? Number.parseInt(onsiteDaysPerWeek.trim(), 10)
      : null;

  if (
    normalizedOnsiteDaysPerWeek !== null &&
    (!Number.isInteger(normalizedOnsiteDaysPerWeek) ||
      normalizedOnsiteDaysPerWeek < 1 ||
      normalizedOnsiteDaysPerWeek > 7)
  ) {
    return NextResponse.json(
      { error: "Onsite days per week must be a whole number between 1 and 7." },
      { status: 400 },
    );
  }

  const persistedOnsiteDaysPerWeek =
    normalizedLocation === "onsite" || normalizedLocation === "hybrid"
      ? normalizedOnsiteDaysPerWeek
      : null;

  const normalizedJobUrl =
    typeof jobUrl === "string" && jobUrl.trim().length > 0
      ? jobUrl.trim()
      : null;

  if (normalizedJobUrl !== null) {
    try {
      const parsedUrl = new URL(normalizedJobUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }
    } catch {
      return NextResponse.json(
        { error: "Job URL must be a valid http or https URL." },
        { status: 400 },
      );
    }
  }

  const normalizedSalaryRange =
    typeof salaryRange === "string" && salaryRange.trim().length > 0
      ? salaryRange.trim()
      : null;
  const normalizedTeamOrDepartment =
    typeof teamOrDepartment === "string" && teamOrDepartment.trim().length > 0
      ? teamOrDepartment.trim()
      : null;
  const normalizedRecruiterContact =
    typeof recruiterContact === "string" && recruiterContact.trim().length > 0
      ? recruiterContact.trim()
      : null;
  const normalizedNotes =
    typeof notes === "string" && notes.trim().length > 0
      ? notes.trim()
      : null;
  const normalizedStatus =
    typeof status === "string" && status.trim().length > 0
      ? status.trim().toUpperCase()
      : "APPLIED";

  if (!allowedApplicationStatuses.has(normalizedStatus as ApplicationStatusValue)) {
    return NextResponse.json(
      { error: "Status must be one of the supported application states." },
      { status: 400 },
    );
  }

  const normalizedEmploymentType =
    typeof employmentType === "string" && employmentType.trim().length > 0
      ? employmentType.trim().toLowerCase()
      : null;

  if (
    normalizedEmploymentType !== null &&
    !allowedEmploymentTypes.has(normalizedEmploymentType as EmploymentTypeValue)
  ) {
    return NextResponse.json(
      { error: "Employment type must be full_time, part_time, contract, or internship." },
      { status: 400 },
    );
  }

  const draftSnapshots = parseDraftUploadSnapshots(formData.get("draftUploadSnapshots"));
  const prisma = getPrismaClient();

  try {
    const persistedScreenshots = [];

    for (const [index, screenshotFile] of screenshotFiles.entries()) {
      const persistedScreenshot = await persistJobScreenshot(
        screenshotFile,
        session.user.id,
      );
      const snapshot = draftSnapshots[index];
      const extractionStatus =
        snapshot?.status === "failed"
          ? "FAILED"
          : snapshot?.status === "ready"
            ? "SUCCEEDED"
            : "PENDING";

      const screenshotRecord = await prisma.jobApplicationScreenshot.create({
        data: {
          userId: session.user.id,
          originalFilename: screenshotFile.name || "job-screenshot",
          storagePath: persistedScreenshot.storagePath,
          mimeType: screenshotFile.type || "application/octet-stream",
          sizeBytes: persistedScreenshot.sizeBytes,
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

      persistedScreenshots.push(screenshotRecord);
    }

    const company = await prisma.company.upsert({
      where: {
        userId_normalizedName: {
          userId: session.user.id,
          normalizedName: normalizeCompanyName(companyName),
        },
      },
      create: {
        userId: session.user.id,
        name: companyName.trim(),
        normalizedName: normalizeCompanyName(companyName),
      },
      update: {
        name: companyName.trim(),
      },
    });

    const sourceScreenshotId =
      persistedScreenshots[persistedScreenshots.length - 1]?.id ?? null;

    const application = await prisma.jobApplication.create({
      data: {
        userId: session.user.id,
        companyId: company.id,
        sourceScreenshotId,
        title: jobTitle.trim(),
        status: normalizedStatus as ApplicationStatusValue,
        location: normalizedLocation,
        onsiteDaysPerWeek: persistedOnsiteDaysPerWeek,
        jobUrl: normalizedJobUrl,
        salaryRange: normalizedSalaryRange,
        employmentType: normalizedEmploymentType,
        teamOrDepartment: normalizedTeamOrDepartment,
        recruiterContact: normalizedRecruiterContact,
        notes: normalizedNotes,
        hasReferral: hasReferral === "true",
        jobDescription:
          typeof jobDescription === "string" && jobDescription.trim().length > 0
            ? jobDescription.trim()
            : null,
        appliedAt: resolveAppliedAt(
          typeof appliedAt === "string" ? appliedAt.trim() : null,
        ),
      },
      include: {
        company: true,
        sourceScreenshot: true,
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to save the application.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
