import { readFile } from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { extractResumeDocument } from "@/lib/tailor-resume-extraction";
import { readTailorResumeProfile, writeTailorResumeProfile } from "@/lib/tailor-resume-storage";
import {
  emptyTailorResumeExtractionState,
  parseResumeDocument,
  type TailorResumeProfile,
} from "@/lib/tailor-resume-types";
import {
  assertSupportedResumeFile,
  deletePersistedUserResume,
  persistUserResume,
} from "@/lib/job-tracking";

const maxJobDescriptionLength = 200_000;

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to manage your resume." }, { status: 401 });
}

function buildResumeRecord(input: {
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  storagePath: string;
}) {
  return {
    mimeType: input.mimeType,
    originalFilename: input.originalFilename,
    sizeBytes: input.sizeBytes,
    storagePath: input.storagePath,
    updatedAt: new Date().toISOString(),
  };
}

async function runResumeExtraction(
  userId: string,
  profile: TailorResumeProfile,
) {
  const savedResume = profile.resume;

  if (!savedResume) {
    throw new Error("Upload a resume before extracting.");
  }

  const extractingProfile: TailorResumeProfile = {
    ...profile,
    extraction: {
      ...emptyTailorResumeExtractionState(),
      status: "extracting",
      updatedAt: new Date().toISOString(),
    },
  };

  await writeTailorResumeProfile(userId, extractingProfile);

  try {
    const buffer = await readFile(
      path.join(process.cwd(), "public", savedResume.storagePath),
    );
    const extraction = await extractResumeDocument({
      buffer,
      filename: savedResume.originalFilename,
      mimeType: savedResume.mimeType,
    });

    const readyProfile: TailorResumeProfile = {
      ...extractingProfile,
      extraction: {
        editedDocument: extraction.document,
        error: null,
        extractedDocument: extraction.document,
        model: extraction.model,
        rawText: extraction.rawText,
        status: "ready",
        updatedAt: new Date().toISOString(),
      },
    };

    await writeTailorResumeProfile(userId, readyProfile);
    return readyProfile;
  } catch (error) {
    const failedProfile: TailorResumeProfile = {
      ...extractingProfile,
      extraction: {
        ...emptyTailorResumeExtractionState(),
        error:
          error instanceof Error
            ? error.message
            : "Unable to extract the uploaded resume.",
        status: "failed",
        updatedAt: new Date().toISOString(),
      },
    };

    await writeTailorResumeProfile(userId, failedProfile);
    return failedProfile;
  }
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const profile = await readTailorResumeProfile(session.user.id);

  if ("action" in body && body.action === "reextract") {
    if (!profile.resume) {
      return NextResponse.json(
        { error: "Upload a resume before extracting." },
        { status: 400 },
      );
    }

    const updatedProfile = await runResumeExtraction(session.user.id, profile);

    return NextResponse.json({
      extractionError:
        updatedProfile.extraction.status === "failed"
          ? updatedProfile.extraction.error
          : null,
      profile: updatedProfile,
    });
  }

  const nextProfile: TailorResumeProfile = {
    ...profile,
    extraction: {
      ...profile.extraction,
    },
  };
  let didUpdate = false;

  if ("jobDescription" in body) {
    if (typeof body.jobDescription !== "string") {
      return NextResponse.json(
        { error: "Provide job description text to save." },
        { status: 400 },
      );
    }

    if (body.jobDescription.length > maxJobDescriptionLength) {
      return NextResponse.json(
        { error: "Keep the job description under 200,000 characters." },
        { status: 400 },
      );
    }

    nextProfile.jobDescription = body.jobDescription;
    didUpdate = true;
  }

  if ("editedDocument" in body) {
    nextProfile.extraction.editedDocument =
      body.editedDocument === null ? null : parseResumeDocument(body.editedDocument);
    nextProfile.extraction.updatedAt = new Date().toISOString();
    didUpdate = true;
  }

  if (!didUpdate) {
    return NextResponse.json(
      { error: "No Tailor Resume updates were provided." },
      { status: 400 },
    );
  }

  await writeTailorResumeProfile(session.user.id, nextProfile);

  return NextResponse.json({
    profile: nextProfile,
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

  const existingProfile = await readTailorResumeProfile(session.user.id);
  const previousResumeStoragePath = existingProfile.resume?.storagePath ?? null;
  const persistedResume = await persistUserResume(resumeFile, session.user.id);
  const profileWithSavedResume: TailorResumeProfile = {
    ...existingProfile,
    extraction: {
      ...emptyTailorResumeExtractionState(),
      status: "extracting",
      updatedAt: new Date().toISOString(),
    },
    resume: buildResumeRecord({
      mimeType: resumeFile.type || "application/octet-stream",
      originalFilename: resumeFile.name || "resume",
      sizeBytes: persistedResume.sizeBytes,
      storagePath: persistedResume.storagePath,
    }),
  };

  await writeTailorResumeProfile(session.user.id, profileWithSavedResume);

  const updatedProfile = await runResumeExtraction(
    session.user.id,
    profileWithSavedResume,
  );

  if (
    previousResumeStoragePath &&
    previousResumeStoragePath !== persistedResume.storagePath
  ) {
    await deletePersistedUserResume(previousResumeStoragePath);
  }

  return NextResponse.json({
    extractionError:
      updatedProfile.extraction.status === "failed"
        ? updatedProfile.extraction.error
        : null,
    profile: updatedProfile,
  });
}
