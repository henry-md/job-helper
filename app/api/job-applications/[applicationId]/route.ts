import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import type {
  ApplicationStatusValue,
  EmploymentTypeValue,
  JobLocationType,
} from "@/lib/job-application-types";
import {
  normalizeCompanyName,
  normalizeSalaryRange,
  resolveAppliedAt,
} from "@/lib/job-tracking";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { applicationId } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;

  const jobTitle =
    typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
  const companyName =
    typeof body.companyName === "string" ? body.companyName.trim() : "";
  const appliedAt =
    typeof body.appliedAt === "string" ? body.appliedAt.trim() : "";
  const jobDescription =
    typeof body.jobDescription === "string" ? body.jobDescription.trim() : null;
  const referrerId =
    typeof body.referrerId === "string" ? body.referrerId.trim() : "";
  const jobUrl = typeof body.jobUrl === "string" ? body.jobUrl.trim() : null;
  const location =
    typeof body.location === "string" ? body.location.trim().toLowerCase() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;
  const onsiteDaysPerWeek =
    typeof body.onsiteDaysPerWeek === "string"
      ? body.onsiteDaysPerWeek.trim()
      : "";
  const recruiterContact =
    typeof body.recruiterContact === "string"
      ? body.recruiterContact.trim()
      : null;
  const salaryRange =
    typeof body.salaryRange === "string" ? body.salaryRange.trim() : null;
  const status =
    typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  const teamOrDepartment =
    typeof body.teamOrDepartment === "string"
      ? body.teamOrDepartment.trim()
      : null;
  const employmentType =
    typeof body.employmentType === "string"
      ? body.employmentType.trim().toLowerCase()
      : "";

  if (!jobTitle) {
    return NextResponse.json(
      { error: "Add a job title before saving." },
      { status: 400 },
    );
  }

  if (!companyName) {
    return NextResponse.json(
      { error: "Add a company name before saving." },
      { status: 400 },
    );
  }

  if (appliedAt && !/^\d{4}-\d{2}-\d{2}$/.test(appliedAt)) {
    return NextResponse.json(
      { error: "Use YYYY-MM-DD for the applied date." },
      { status: 400 },
    );
  }

  const normalizedLocation = location || null;

  if (
    normalizedLocation !== null &&
    !allowedLocationTypes.has(normalizedLocation as JobLocationType)
  ) {
    return NextResponse.json(
      { error: "Location must be remote, onsite, or hybrid." },
      { status: 400 },
    );
  }

  const normalizedOnsiteDaysPerWeek = onsiteDaysPerWeek
    ? Number.parseInt(onsiteDaysPerWeek, 10)
    : null;

  if (
    normalizedOnsiteDaysPerWeek !== null &&
    (!Number.isInteger(normalizedOnsiteDaysPerWeek) ||
      normalizedOnsiteDaysPerWeek < 1 ||
      normalizedOnsiteDaysPerWeek > 7)
  ) {
    return NextResponse.json(
      { error: "Onsite days per week must be a whole number between 1 and 7." },
      { status: 400 },
    );
  }

  const persistedOnsiteDaysPerWeek =
    normalizedLocation === "onsite" || normalizedLocation === "hybrid"
      ? normalizedOnsiteDaysPerWeek
      : null;

  if (jobUrl) {
    try {
      const parsedUrl = new URL(jobUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }
    } catch {
      return NextResponse.json(
        { error: "Job URL must be a valid http or https URL." },
        { status: 400 },
      );
    }
  }

  const normalizedStatus = status || "APPLIED";
  const normalizedSalary = normalizeSalaryRange(salaryRange);

  if (!allowedApplicationStatuses.has(normalizedStatus as ApplicationStatusValue)) {
    return NextResponse.json(
      { error: "Status must be one of the supported application states." },
      { status: 400 },
    );
  }

  const normalizedEmploymentType = employmentType || null;

  if (
    normalizedEmploymentType !== null &&
    !allowedEmploymentTypes.has(normalizedEmploymentType as EmploymentTypeValue)
  ) {
    return NextResponse.json(
      { error: "Employment type must be full_time, part_time, contract, or internship." },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();

  try {
    const normalizedReferrerId = referrerId || null;

    let referrerRecord: { id: string; recruiterContact: string | null } | null = null;

    if (normalizedReferrerId) {
      referrerRecord = await prisma.person.findFirst({
        where: {
          id: normalizedReferrerId,
          userId: session.user.id,
        },
        select: { id: true, recruiterContact: true },
      });

      if (!referrerRecord) {
        return NextResponse.json(
          { error: "Selected referrer was not found." },
          { status: 400 },
        );
      }
    }

    const existingApplication = await prisma.jobApplication.findFirst({
      where: {
        id: applicationId,
        userId: session.user.id,
      },
    });

    if (!existingApplication) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }

    const company = await prisma.company.upsert({
      where: {
        userId_normalizedName: {
          userId: session.user.id,
          normalizedName: normalizeCompanyName(companyName),
        },
      },
      create: {
        userId: session.user.id,
        name: companyName,
        normalizedName: normalizeCompanyName(companyName),
      },
      update: {
        name: companyName,
      },
    });

    const application = await prisma.jobApplication.update({
      where: { id: existingApplication.id },
      data: {
        companyId: company.id,
        title: jobTitle,
        status: normalizedStatus as ApplicationStatusValue,
        location: normalizedLocation,
        onsiteDaysPerWeek: persistedOnsiteDaysPerWeek,
        referrerId: referrerRecord?.id ?? null,
        jobUrl: jobUrl || null,
        salaryRange: normalizedSalary.text,
        salaryMinimum: normalizedSalary.minimum,
        salaryMaximum: normalizedSalary.maximum,
        employmentType: normalizedEmploymentType,
        teamOrDepartment: teamOrDepartment || null,
        recruiterContact: (referrerRecord?.recruiterContact ?? recruiterContact) || null,
        notes: notes || null,
        hasReferral: Boolean(referrerRecord),
        jobDescription: jobDescription || null,
        appliedAt: resolveAppliedAt(appliedAt || null),
      },
      include: {
        company: true,
        referrer: {
          include: {
            company: true,
          },
        },
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to update the application.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
