import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import {
  tailorResumeProfileSelect,
  toTailorResumeProfile,
} from "@/lib/tailor-resume-profile";
import {
  assertSupportedResumeFile,
  deletePersistedUserResume,
  persistUserResume,
} from "@/lib/job-tracking";

const maxJobDescriptionLength = 200_000;

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to manage your resume." }, { status: 401 });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const jobDescription =
    typeof body === "object" && body !== null && "jobDescription" in body
      ? body.jobDescription
      : undefined;

  if (typeof jobDescription !== "string") {
    return NextResponse.json(
      { error: "Provide job description text to save." },
      { status: 400 },
    );
  }

  if (jobDescription.length > maxJobDescriptionLength) {
    return NextResponse.json(
      { error: "Keep the job description under 200,000 characters." },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();
  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      tailorJobDescription: jobDescription,
    },
    select: tailorResumeProfileSelect,
  });

  return NextResponse.json({
    profile: toTailorResumeProfile(updatedUser),
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const formData = await request.formData();
  const resumeFile = formData.get("resume");

  if (!(resumeFile instanceof File)) {
    return NextResponse.json(
      { error: "Choose a resume file to upload." },
      { status: 400 },
    );
  }

  try {
    assertSupportedResumeFile(resumeFile);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload a PDF, PNG, JPG, or WebP resume.",
      },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();
  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      resumeStoragePath: true,
    },
  });

  if (!existingUser) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const persistedResume = await persistUserResume(resumeFile, session.user.id);

  try {
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        resumeMimeType: resumeFile.type || "application/octet-stream",
        resumeOriginalFilename: resumeFile.name || "resume",
        resumeSizeBytes: persistedResume.sizeBytes,
        resumeStoragePath: persistedResume.storagePath,
        resumeUpdatedAt: new Date(),
      },
      select: tailorResumeProfileSelect,
    });

    if (
      existingUser.resumeStoragePath &&
      existingUser.resumeStoragePath !== persistedResume.storagePath
    ) {
      await deletePersistedUserResume(existingUser.resumeStoragePath);
    }

    return NextResponse.json({
      profile: toTailorResumeProfile(updatedUser),
    });
  } catch (error) {
    await deletePersistedUserResume(persistedResume.storagePath);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the uploaded resume.",
      },
      { status: 500 },
    );
  }
}
