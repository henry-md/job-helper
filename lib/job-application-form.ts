import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobApplicationDraft,
  JobLocationType,
} from "./job-application-types.ts";
import { normalizeSalaryRange } from "./job-tracking-shared.ts";

export const jobApplicationScreenshotMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;

export const jobApplicationScreenshotAccept =
  jobApplicationScreenshotMimeTypes.join(",");
export const maxJobApplicationScreenshotBytes = 8 * 1024 * 1024;

const jobApplicationScreenshotMimeTypeSet = new Set(jobApplicationScreenshotMimeTypes);
const allowedLocationTypes = new Set<JobLocationType>([
  "remote",
  "onsite",
  "hybrid",
]);
const allowedApplicationStatuses = new Set<ApplicationStatusValue>([
  "SAVED",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
]);
const allowedEmploymentTypes = new Set<EmploymentTypeValue>([
  "full_time",
  "part_time",
  "contract",
  "internship",
]);

const emptyJobApplicationDraft: JobApplicationDraft = {
  appliedAt: "",
  companyName: "",
  employmentType: "",
  jobDescription: "",
  jobTitle: "",
  jobUrl: "",
  location: "",
  notes: "",
  onsiteDaysPerWeek: "",
  recruiterContact: "",
  referrerId: "",
  referrerName: "",
  salaryRange: "",
  status: "APPLIED",
  teamOrDepartment: "",
};

export type NormalizedJobApplicationWriteInput = {
  appliedAt: string;
  companyName: string;
  employmentType: EmploymentTypeValue | null;
  jobDescription: string | null;
  jobTitle: string;
  jobUrl: string | null;
  location: JobLocationType | null;
  normalizedSalary: ReturnType<typeof normalizeSalaryRange>;
  notes: string | null;
  onsiteDaysPerWeek: number | null;
  persistedOnsiteDaysPerWeek: number | null;
  recruiterContact: string | null;
  referrerId: string | null;
  salaryRange: string | null;
  status: ApplicationStatusValue;
  teamOrDepartment: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readTrimmedString(value: unknown) {
  return readString(value).trim();
}

function readOptionalTrimmedString(value: unknown) {
  const normalizedValue = readTrimmedString(value);
  return normalizedValue || null;
}

export function createEmptyJobApplicationDraft(): JobApplicationDraft {
  return { ...emptyJobApplicationDraft };
}

export function readJobApplicationDraftLocation(
  value: unknown,
): JobApplicationDraft["location"] {
  return value === "remote" || value === "onsite" || value === "hybrid"
    ? value
    : "";
}

export function readJobApplicationDraftEmploymentType(
  value: unknown,
): JobApplicationDraft["employmentType"] {
  return value === "full_time" ||
    value === "part_time" ||
    value === "contract" ||
    value === "internship"
    ? value
    : "";
}

export function readJobApplicationDraftStatus(
  value: unknown,
): JobApplicationDraft["status"] {
  return value === "SAVED" ||
    value === "APPLIED" ||
    value === "INTERVIEW" ||
    value === "OFFER" ||
    value === "REJECTED" ||
    value === "WITHDRAWN"
    ? value
    : "";
}

export function parseJobApplicationDraftContext(
  rawValue: FormDataEntryValue | null,
) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!isRecord(parsed)) {
      return null;
    }

    return {
      appliedAt: readString(parsed.appliedAt),
      companyName: readString(parsed.companyName),
      employmentType: readJobApplicationDraftEmploymentType(parsed.employmentType),
      jobDescription: readString(parsed.jobDescription),
      jobTitle: readString(parsed.jobTitle),
      jobUrl: readString(parsed.jobUrl),
      location: readJobApplicationDraftLocation(parsed.location),
      notes: readString(parsed.notes),
      onsiteDaysPerWeek: readString(parsed.onsiteDaysPerWeek),
      recruiterContact: readString(parsed.recruiterContact),
      referrerId: readString(parsed.referrerId),
      referrerName: readString(parsed.referrerName),
      salaryRange: readString(parsed.salaryRange),
      status: readJobApplicationDraftStatus(parsed.status),
      teamOrDepartment: readString(parsed.teamOrDepartment),
    } satisfies JobApplicationDraft;
  } catch {
    return null;
  }
}

export function validateJobApplicationScreenshotFile(file: {
  size: number;
  type: string;
}) {
  if (!jobApplicationScreenshotMimeTypeSet.has(file.type as (typeof jobApplicationScreenshotMimeTypes)[number])) {
    return "Use a PNG, JPG, or WebP screenshot.";
  }

  if (file.size === 0) {
    return "The screenshot is empty.";
  }

  if (file.size > maxJobApplicationScreenshotBytes) {
    return "Keep the screenshot under 8 MB.";
  }

  return null;
}

export function normalizeJobApplicationWriteInput(input: {
  appliedAt: unknown;
  companyName: unknown;
  employmentType: unknown;
  jobDescription: unknown;
  jobTitle: unknown;
  jobUrl: unknown;
  location: unknown;
  notes: unknown;
  onsiteDaysPerWeek: unknown;
  recruiterContact: unknown;
  referrerId: unknown;
  salaryRange: unknown;
  status: unknown;
  teamOrDepartment: unknown;
}):
  | {
      ok: true;
      value: NormalizedJobApplicationWriteInput;
    }
  | {
      error: string;
      ok: false;
    } {
  const jobTitle = readTrimmedString(input.jobTitle);

  if (!jobTitle) {
    return {
      error: "Add a job title before saving.",
      ok: false,
    };
  }

  const companyName = readTrimmedString(input.companyName);

  if (!companyName) {
    return {
      error: "Add a company name before saving.",
      ok: false,
    };
  }

  const appliedAt = readTrimmedString(input.appliedAt);

  if (appliedAt && !/^\d{4}-\d{2}-\d{2}$/.test(appliedAt)) {
    return {
      error: "Use YYYY-MM-DD for the applied date.",
      ok: false,
    };
  }

  const normalizedLocation = readOptionalTrimmedString(input.location)?.toLowerCase() ?? null;

  if (
    normalizedLocation !== null &&
    !allowedLocationTypes.has(normalizedLocation as JobLocationType)
  ) {
    return {
      error: "Location must be remote, onsite, or hybrid.",
      ok: false,
    };
  }

  const rawOnsiteDaysPerWeek = readTrimmedString(input.onsiteDaysPerWeek);
  const onsiteDaysPerWeek = rawOnsiteDaysPerWeek
    ? Number.parseInt(rawOnsiteDaysPerWeek, 10)
    : null;

  if (
    onsiteDaysPerWeek !== null &&
    (!Number.isInteger(onsiteDaysPerWeek) ||
      onsiteDaysPerWeek < 1 ||
      onsiteDaysPerWeek > 7)
  ) {
    return {
      error: "Onsite days per week must be a whole number between 1 and 7.",
      ok: false,
    };
  }

  const persistedOnsiteDaysPerWeek =
    normalizedLocation === "onsite" || normalizedLocation === "hybrid"
      ? onsiteDaysPerWeek
      : null;
  const jobUrl = readOptionalTrimmedString(input.jobUrl);

  if (jobUrl) {
    try {
      const parsedUrl = new URL(jobUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }
    } catch {
      return {
        error: "Job URL must be a valid http or https URL.",
        ok: false,
      };
    }
  }

  const normalizedStatus = readTrimmedString(input.status).toUpperCase() || "APPLIED";

  if (!allowedApplicationStatuses.has(normalizedStatus as ApplicationStatusValue)) {
    return {
      error: "Status must be one of the supported application states.",
      ok: false,
    };
  }

  const normalizedEmploymentType =
    readOptionalTrimmedString(input.employmentType)?.toLowerCase() ?? null;

  if (
    normalizedEmploymentType !== null &&
    !allowedEmploymentTypes.has(normalizedEmploymentType as EmploymentTypeValue)
  ) {
    return {
      error:
        "Employment type must be full_time, part_time, contract, or internship.",
      ok: false,
    };
  }

  const salaryRange = readOptionalTrimmedString(input.salaryRange);

  return {
    ok: true,
    value: {
      appliedAt,
      companyName,
      employmentType: normalizedEmploymentType as EmploymentTypeValue | null,
      jobDescription: readOptionalTrimmedString(input.jobDescription),
      jobTitle,
      jobUrl,
      location: normalizedLocation as JobLocationType | null,
      normalizedSalary: normalizeSalaryRange(salaryRange),
      notes: readOptionalTrimmedString(input.notes),
      onsiteDaysPerWeek,
      persistedOnsiteDaysPerWeek,
      recruiterContact: readOptionalTrimmedString(input.recruiterContact),
      referrerId: readOptionalTrimmedString(input.referrerId),
      salaryRange,
      status: normalizedStatus as ApplicationStatusValue,
      teamOrDepartment: readOptionalTrimmedString(input.teamOrDepartment),
    },
  };
}
