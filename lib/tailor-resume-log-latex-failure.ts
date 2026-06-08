import { getPrismaClient } from "./prisma.ts";
import {
  buildTailorResumeStepFailureDebugSource,
  buildTailorResumeStepFailureLogPayload,
  type TailorResumeStepFailureLogPayload,
} from "./tailor-resume-debug-errors.ts";
import type { TailorResumeGenerationStepEvent } from "./tailor-resume-types.ts";

export async function logTailorResumeDebugError(input: {
  userId: string;
  source: string;
  latexCode: string;
  error: string;
  attempt: number;
}): Promise<void> {
  try {
    const prisma = getPrismaClient();
    await prisma.latexBuildFailure.create({
      data: {
        userId: input.userId,
        source: input.source,
        latexCode: input.latexCode,
        error: input.error,
        attempt: input.attempt,
      },
    });
  } catch (err) {
    console.error("Failed to log resume debug error:", err);
  }
}

export async function logLatexBuildFailure(input: {
  userId: string;
  source: string;
  latexCode: string;
  error: string;
  attempt: number;
}): Promise<void> {
  await logTailorResumeDebugError(input);
}

export async function logTailorResumeStepFailure(input: {
  action?: string | null;
  applicationId?: string | null;
  event: TailorResumeGenerationStepEvent;
  failureHistory?: TailorResumeStepFailureLogPayload["failureHistory"];
  interviewId?: string | null;
  jobDescription?: string | null;
  jobUrl?: string | null;
  loggedAt?: string;
  loggedAtLocal?: string;
  loggedAtTimeZone?: string;
  logKind: TailorResumeStepFailureLogPayload["logKind"];
  runId?: string | null;
  tailoredResumeId?: string | null;
  userId: string;
}): Promise<void> {
  if (input.event.status !== "failed") {
    return;
  }

  await logTailorResumeDebugError({
    attempt: Math.max(1, Math.floor(input.event.attempt ?? 1)),
    error:
      input.event.detail?.trim() ||
      input.event.summary.trim() ||
      "Tailor Resume step failed.",
    latexCode: buildTailorResumeStepFailureLogPayload(input),
    source: buildTailorResumeStepFailureDebugSource(input.event.stepNumber),
    userId: input.userId,
  });
}
