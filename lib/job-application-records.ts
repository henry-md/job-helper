import type {
  JobApplicationRecord,
  ReferrerOption,
} from "@/lib/job-application-types";
import { normalizeCompanyName } from "@/lib/job-tracking";

export function countDistinctApplicationCompanies(
  applications: Array<{ company: { name: string } }>,
) {
  return new Set(
    applications
      .map((application) => normalizeCompanyName(application.company.name))
      .filter((name) => name.length > 0),
  ).size;
}

export function toJobApplicationRecord(application: {
  appliedAt: Date;
  company: { name: string };
  createdAt: Date;
  employmentType: string | null;
  id: string;
  jobDescription: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  onsiteDaysPerWeek: number | null;
  referrer: {
    id: string;
    name: string;
  } | null;
  recruiterContact: string | null;
  salaryRange: string | null;
  status: string;
  teamOrDepartment: string | null;
  title: string;
  updatedAt: Date;
}): JobApplicationRecord {
  return {
    appliedAt: application.appliedAt.toISOString().slice(0, 10),
    companyName: application.company.name,
    createdAt: application.createdAt.toISOString(),
    employmentType: (application.employmentType as JobApplicationRecord["employmentType"]) ?? "",
    id: application.id,
    jobDescription: application.jobDescription ?? "",
    jobTitle: application.title,
    jobUrl: application.jobUrl ?? "",
    location: (application.location as JobApplicationRecord["location"]) ?? "",
    notes: application.notes ?? "",
    onsiteDaysPerWeek:
      application.onsiteDaysPerWeek !== null
        ? String(application.onsiteDaysPerWeek)
        : "",
    referrerId: application.referrer?.id ?? "",
    referrerName: application.referrer?.name ?? "",
    recruiterContact: application.recruiterContact ?? "",
    salaryRange: application.salaryRange ?? "",
    status: application.status as JobApplicationRecord["status"],
    teamOrDepartment: application.teamOrDepartment ?? "",
    updatedAt: application.updatedAt.toISOString(),
  };
}

export function toReferrerOption(person: {
  company: { id: string; name: string } | { name: string } | null;
  companyId: string | null;
  id: string;
  name: string;
  recruiterContact: string | null;
}): ReferrerOption {
  return {
    companyId: person.companyId,
    companyName: person.company?.name ?? null,
    id: person.id,
    name: person.name,
    recruiterContact: person.recruiterContact ?? null,
  };
}
