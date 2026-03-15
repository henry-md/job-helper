import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const supportedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const maxScreenshotBytes = 8 * 1024 * 1024;
const salarySuffixMultipliers = {
  b: 1_000_000_000,
  k: 1_000,
  m: 1_000_000,
} as const;

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

function parseNumberWithDecimalSeparator(
  value: string,
  decimalSeparator: "," | ".",
) {
  const normalizedValue =
    decimalSeparator === ","
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  const parsedValue = Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseLocalizedNumber(value: string, hasSuffix: boolean) {
  const compactValue = value.replace(/\s+/g, "");
  const commaCount = compactValue.split(",").length - 1;
  const dotCount = compactValue.split(".").length - 1;

  if (commaCount > 0 && dotCount > 0) {
    return parseNumberWithDecimalSeparator(
      compactValue,
      compactValue.lastIndexOf(",") > compactValue.lastIndexOf(".") ? "," : ".",
    );
  }

  if (commaCount > 0) {
    if (!hasSuffix && /^\d{1,3}(,\d{3})+$/.test(compactValue)) {
      return Number.parseInt(compactValue.replace(/,/g, ""), 10);
    }

    if (!hasSuffix && commaCount > 1) {
      return Number.parseInt(compactValue.replace(/,/g, ""), 10);
    }

    const fractionalLength = compactValue.length - compactValue.lastIndexOf(",") - 1;

    if (hasSuffix || fractionalLength <= 2) {
      return parseNumberWithDecimalSeparator(compactValue, ",");
    }

    return Number.parseInt(compactValue.replace(/,/g, ""), 10);
  }

  if (dotCount > 0) {
    if (!hasSuffix && /^\d{1,3}(\.\d{3})+$/.test(compactValue)) {
      return Number.parseInt(compactValue.replace(/\./g, ""), 10);
    }

    if (!hasSuffix && dotCount > 1) {
      return Number.parseInt(compactValue.replace(/\./g, ""), 10);
    }

    const fractionalLength = compactValue.length - compactValue.lastIndexOf(".") - 1;

    if (hasSuffix || fractionalLength <= 2) {
      const parsedValue = Number.parseFloat(compactValue);

      return Number.isFinite(parsedValue) ? parsedValue : null;
    }

    return Number.parseInt(compactValue.replace(/\./g, ""), 10);
  }

  const parsedValue = Number.parseFloat(compactValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function parseSalaryInteger(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  const cleanedValue = trimmedValue
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/[$€£¥₹]/g, "")
    .replace(
      /(?:usd|eur|gbp|cad|aud|nzd|chf|sek|nok|dkk|pln|czk|ron|huf|jpy|cny|inr|sgd|hkd|brl|mxn)/g,
      "",
    )
    .replace(
      /(?:perannum|annum|yearly|year|yr|\/yr|\/year|monthly|month|mo|\/mo|\/month|pa)/g,
      "",
    )
    .replace(/^(?:from|up-?to|under|over|min(?:imum)?|max(?:imum)?)/g, "")
    .replace(/[+~≈]/g, "")
    .replace(/[()]/g, "");
  const salaryMatch = cleanedValue.match(/^(\d[\d.,]*)([bkm])?$/i);

  if (!salaryMatch) {
    return null;
  }

  const numericValue = parseLocalizedNumber(salaryMatch[1], Boolean(salaryMatch[2]));

  if (numericValue === null) {
    return null;
  }

  const multiplier = salaryMatch[2]
    ? salarySuffixMultipliers[
        salaryMatch[2].toLowerCase() as keyof typeof salarySuffixMultipliers
      ]
    : 1;

  return Math.round(numericValue * multiplier);
}

export function normalizeSalaryRange(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return {
      maximum: null,
      minimum: null,
      text: null,
    };
  }

  const rangeMatch = trimmedValue.match(/^(.*?)\s*(?:to|[-–—])\s*(.*)$/i);
  const rawMinimum = rangeMatch ? rangeMatch[1] : trimmedValue;
  const rawMaximum = rangeMatch ? rangeMatch[2] : null;
  let minimum = parseSalaryInteger(rawMinimum);
  let maximum = parseSalaryInteger(rawMaximum);

  if (minimum !== null && maximum !== null && minimum > maximum) {
    [minimum, maximum] = [maximum, minimum];
  }

  if (minimum === null && maximum === null) {
    return {
      maximum: null,
      minimum: null,
      text: trimmedValue,
    };
  }

  return {
    maximum,
    minimum,
    text:
      minimum !== null && maximum !== null
        ? `${minimum} - ${maximum}`
        : String(minimum ?? maximum),
  };
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

export function fileBufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function resolveAppliedAt(value: string | null | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }

  return new Date();
}
