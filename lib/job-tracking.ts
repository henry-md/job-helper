import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supportedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const maxScreenshotBytes = 8 * 1024 * 1024;

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

  if (file.type === "image/png") {
    return ".png";
  }

  if (file.type === "image/webp") {
    return ".webp";
  }

  return ".jpg";
}

export function assertSupportedImageFile(file: File) {
  if (!supportedMimeTypes.has(file.type)) {
    throw new Error("Upload a PNG, JPG, or WebP screenshot.");
  }

  if (file.size === 0) {
    throw new Error("The uploaded file is empty.");
  }

  if (file.size > maxScreenshotBytes) {
    throw new Error("Upload a screenshot smaller than 8 MB.");
  }
}

export function normalizeCompanyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function fileBufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function resolveAppliedAt(value: string | null | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }

  return new Date();
}
