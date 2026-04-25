import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileBufferToDataUrl } from "@/lib/file-data-url";
import {
  jobApplicationScreenshotMimeTypes,
  validateJobApplicationScreenshotFile,
} from "@/lib/job-application-form";

const supportedResumeMimeTypes = new Set([
  "application/pdf",
  ...jobApplicationScreenshotMimeTypes,
]);

const maxResumeBytes = 10 * 1024 * 1024;

function sanitizeBaseName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function extensionForFile(file: File) {
  const originalExtension = path.extname(file.name).toLowerCase();

  if (originalExtension) {
    return originalExtension;
  }

  if (file.type === "application/pdf") {
    return ".pdf";
  }

  if (file.type === "image/png") {
    return ".png";
  }

  if (file.type === "image/webp") {
    return ".webp";
  }

  return ".jpg";
}

export function assertSupportedImageFile(file: File) {
  const validationError = validateJobApplicationScreenshotFile(file);

  if (validationError) {
    throw new Error(validationError);
  }
}

export function assertSupportedResumeFile(file: File) {
  if (!supportedResumeMimeTypes.has(file.type)) {
    throw new Error("Upload a PDF, PNG, JPG, or WebP resume.");
  }

  if (file.size === 0) {
    throw new Error("The uploaded resume is empty.");
  }

  if (file.size > maxResumeBytes) {
    throw new Error("Upload a resume smaller than 10 MB.");
  }
}

export async function persistJobScreenshot(file: File, userId: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeBaseName = sanitizeBaseName(path.parse(file.name).name) || "job-shot";
  const filename = `${Date.now()}-${safeBaseName}-${randomUUID()}${extensionForFile(file)}`;
  const relativeDir = path.posix.join("uploads", "job-screenshots", userId);
  const relativePath = path.posix.join(relativeDir, filename);
  const absoluteDir = path.join(process.cwd(), "public", "uploads", "job-screenshots", userId);
  const absolutePath = path.join(process.cwd(), "public", relativePath);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    buffer,
    sizeBytes: buffer.byteLength,
    storagePath: `/${relativePath}`,
  };
}

export async function persistUserResume(file: File, userId: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeBaseName = sanitizeBaseName(path.parse(file.name).name) || "resume";
  const filename = `${Date.now()}-${safeBaseName}-${randomUUID()}${extensionForFile(file)}`;
  const relativeDir = path.posix.join("uploads", "resumes", userId);
  const relativePath = path.posix.join(relativeDir, filename);
  const absoluteDir = path.join(process.cwd(), "public", "uploads", "resumes", userId);
  const absolutePath = path.join(process.cwd(), "public", relativePath);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    buffer,
    sizeBytes: buffer.byteLength,
    storagePath: `/${relativePath}`,
  };
}

export async function deletePersistedJobScreenshot(storagePath: string) {
  const trimmedPath = storagePath.trim();

  if (!trimmedPath.startsWith("/uploads/job-screenshots/")) {
    return;
  }

  const absolutePath = path.join(process.cwd(), "public", trimmedPath);

  try {
    await unlink(absolutePath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export async function deletePersistedUserResume(storagePath: string) {
  const trimmedPath = storagePath.trim();

  if (!trimmedPath.startsWith("/uploads/resumes/")) {
    return;
  }

  const absolutePath = path.join(process.cwd(), "public", trimmedPath);

  try {
    await unlink(absolutePath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export { fileBufferToDataUrl };
