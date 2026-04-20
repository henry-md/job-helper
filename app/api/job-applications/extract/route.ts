import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractJobApplicationFromScreenshot } from "@/lib/job-application-extraction";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import type { JobApplicationDraft } from "@/lib/job-application-types";
import {
  assertSupportedImageFile,
  fileBufferToDataUrl,
} from "@/lib/job-tracking";

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readLocation(value: unknown): JobApplicationDraft["location"] {
  return value === "remote" || value === "onsite" || value === "hybrid"
    ? value
    : "";
}

function readEmploymentType(
  value: unknown,
): JobApplicationDraft["employmentType"] {
  return value === "full_time" ||
    value === "part_time" ||
    value === "contract" ||
    value === "internship"
    ? value
    : "";
}

function readStatus(value: unknown): JobApplicationDraft["status"] {
  return value === "SAVED" ||
    value === "APPLIED" ||
    value === "INTERVIEW" ||
    value === "OFFER" ||
    value === "REJECTED" ||
    value === "WITHDRAWN"
    ? value
    : "";
}

function parseDraftContext(rawValue: FormDataEntryValue | null) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    return {
      appliedAt: readString(parsed.appliedAt),
      companyName: readString(parsed.companyName),
      employmentType: readEmploymentType(parsed.employmentType),
      jobDescription: readString(parsed.jobDescription),
      jobTitle: readString(parsed.jobTitle),
      jobUrl: readString(parsed.jobUrl),
      location: readLocation(parsed.location),
      notes: readString(parsed.notes),
      onsiteDaysPerWeek: readString(parsed.onsiteDaysPerWeek),
      recruiterContact: readString(parsed.recruiterContact),
      referrerId: readString(parsed.referrerId),
      referrerName: readString(parsed.referrerName),
      salaryRange: readString(parsed.salaryRange),
      status: readStatus(parsed.status),
      teamOrDepartment: readString(parsed.teamOrDepartment),
    } satisfies JobApplicationDraft;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFile = formData.get("jobScreenshot");
  const draftContext = parseDraftContext(formData.get("draftContext"));

  if (!(screenshotFile instanceof File)) {
    return NextResponse.json(
      { error: "Select a screenshot to extract." },
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
    const promptSettings = (
      await readTailorResumeProfileState(session.user.id)
    ).profile.promptSettings.values;
    const extractionResult = await extractJobApplicationFromScreenshot({
      dataUrl: testOpenAIResponseEnabled
        ? "data:image/png;base64,"
        : fileBufferToDataUrl(
            Buffer.from(await screenshotFile.arrayBuffer()),
            screenshotFile.type,
          ),
      existingDraft: draftContext,
      filename: screenshotFile.name || "job-screenshot",
      mimeType: screenshotFile.type,
      promptSettings,
    });

    return NextResponse.json({
      extraction: extractionResult.extraction,
      model: extractionResult.model,
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Failed to extract data from the screenshot.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
