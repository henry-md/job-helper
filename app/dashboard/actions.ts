"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { extractJobApplicationFromScreenshot } from "@/lib/job-application-extraction";
import {
  assertSupportedImageFile,
  fileBufferToDataUrl,
  normalizeCompanyName,
  persistJobScreenshot,
  resolveAppliedAt,
} from "@/lib/job-tracking";
import { getPrismaClient } from "@/lib/prisma";

function redirectToDashboard(query: string): never {
  revalidatePath("/dashboard");
  redirect(`/dashboard?${query}`);
}

export async function uploadJobScreenshotAction(formData: FormData) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const screenshotFile = formData.get("jobScreenshot");

  if (!(screenshotFile instanceof File)) {
    redirectToDashboard("error=Select+a+screenshot+to+upload.");
  }

  try {
    assertSupportedImageFile(screenshotFile);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Upload a valid screenshot.";

    redirectToDashboard(`error=${encodeURIComponent(detail)}`);
  }

  const prisma = getPrismaClient();
  const persistedScreenshot = await persistJobScreenshot(screenshotFile, session.user.id);
  const screenshotRecord = await prisma.jobApplicationScreenshot.create({
    data: {
      userId: session.user.id,
      originalFilename: screenshotFile.name || "job-screenshot",
      storagePath: persistedScreenshot.storagePath,
      mimeType: screenshotFile.type || "application/octet-stream",
      sizeBytes: persistedScreenshot.sizeBytes,
      extractionStatus: "PROCESSING",
    },
  });
  let extractedPayload: Awaited<
    ReturnType<typeof extractJobApplicationFromScreenshot>
  >["extraction"] | null = null;

  try {
    const extractionResult = await extractJobApplicationFromScreenshot({
      dataUrl: fileBufferToDataUrl(persistedScreenshot.buffer, screenshotFile.type),
      filename: screenshotFile.name || "job-screenshot",
      mimeType: screenshotFile.type,
    });
    extractedPayload = extractionResult.extraction;

    const companyName = extractionResult.extraction.companyName?.trim();
    const jobTitle = extractionResult.extraction.jobTitle?.trim();

    if (!companyName || !jobTitle) {
      throw new Error(
        "The screenshot did not contain a reliable job title and company name.",
      );
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
        name: companyName,
        normalizedName: normalizeCompanyName(companyName),
      },
      update: {
        name: companyName,
      },
    });

    await prisma.jobApplication.create({
      data: {
        userId: session.user.id,
        companyId: company.id,
        sourceScreenshotId: screenshotRecord.id,
        title: jobTitle,
        hasReferral: extractionResult.extraction.hasReferral,
        jobDescription: extractionResult.extraction.jobDescription,
        appliedAt: resolveAppliedAt(extractionResult.extraction.appliedAt),
        status: "APPLIED",
      },
    });

    await prisma.jobApplicationScreenshot.update({
      where: { id: screenshotRecord.id },
      data: {
        extractionStatus: "SUCCEEDED",
        extractionModel: extractionResult.model,
        extractedPayload: extractionResult.extraction,
      },
    });

    redirectToDashboard("ingested=1");
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to extract data from the screenshot.";

    await prisma.jobApplicationScreenshot.update({
      where: { id: screenshotRecord.id },
      data: {
        extractionStatus: "FAILED",
        extractionError: detail,
        ...(extractedPayload ? { extractedPayload } : {}),
      },
    });

    redirectToDashboard(`error=${encodeURIComponent(detail)}`);
  }
}
