import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractJobApplicationFromScreenshot } from "@/lib/job-application-extraction";
import { parseJobApplicationDraftContext } from "@/lib/job-application-form";
import { readTailorResumeProfileState } from "@/lib/tailor-resume-profile-state";
import {
  assertSupportedImageFile,
  fileBufferToDataUrl,
} from "@/lib/job-tracking";

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFile = formData.get("jobScreenshot");
  const draftContext = parseJobApplicationDraftContext(formData.get("draftContext"));

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
