import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const uploadsDir = path.join(process.cwd(), "public", "uploads");
const allowedMimeTypes = new Set(["image/png", "image/jpeg"]);
const allowedExtensions = new Set([".png", ".jpg", ".jpeg"]);

function sanitizeBaseName(filename: string) {
  const extension = path.extname(filename);
  const baseName = path.basename(filename, extension);
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "upload";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: 'Missing "file" upload' },
      { status: 400 },
    );
  }

  const extension = path.extname(file.name).toLowerCase();

  if (!allowedMimeTypes.has(file.type) || !allowedExtensions.has(extension)) {
    return NextResponse.json(
      { success: false, error: "Only PNG and JPG files are allowed" },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { success: false, error: "File size exceeds 5MB limit" },
      { status: 400 },
    );
  }

  await mkdir(uploadsDir, { recursive: true });

  const filename = `${Date.now()}-${sanitizeBaseName(file.name)}${extension}`;
  const filePath = path.join(uploadsDir, filename);
  const uploadedPath = `/uploads/${filename}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  await writeFile(filePath, fileBuffer);
  console.log(`Uploaded file saved to ${uploadedPath}`);

  return NextResponse.json({
    success: true,
    path: uploadedPath,
  });
}
