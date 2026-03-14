import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractJobApplicationFromScreenshot } from "@/lib/job-application-extraction";
import {
  assertSupportedImageFile,
  fileBufferToDataUrl,
} from "@/lib/job-tracking";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const screenshotFile = formData.get("jobScreenshot");

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
    const buffer = Buffer.from(await screenshotFile.arrayBuffer());
    const extractionResult = await extractJobApplicationFromScreenshot({
      dataUrl: fileBufferToDataUrl(buffer, screenshotFile.type),
      filename: screenshotFile.name || "job-screenshot",
      mimeType: screenshotFile.type,
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
