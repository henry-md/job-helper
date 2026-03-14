import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import type { JobApplicationExtraction } from "@/lib/job-application-types";
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
        hasReferral: hasReferral === "true",
        jobDescription:
          typeof jobDescription === "string" && jobDescription.trim().length > 0
            ? jobDescription.trim()
            : null,
        appliedAt: resolveAppliedAt(
          typeof appliedAt === "string" ? appliedAt.trim() : null,
        ),
        status: "APPLIED",
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
