import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import { normalizeJobApplicationWriteInput } from "@/lib/job-application-form";
import { getPrismaClient } from "@/lib/prisma";
import { bumpUserSyncState } from "@/lib/user-sync-state";
import { buildNormalizedJobUrlHash } from "@/lib/job-url-hash";
import { toJobApplicationRecord } from "@/lib/job-application-records";
import {
  normalizeCompanyName,
  resolveAppliedAt,
} from "@/lib/job-tracking-shared";
import { mergeTailorResumeProfileWithLockedLinks } from "@/lib/tailor-resume-locked-links";
import { deleteLinkedDashboardArtifacts } from "@/lib/tailor-resume-route-response-state";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { applicationId } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;
  const prisma = getPrismaClient();

  if (body.action === "setArchivedState") {
    const archived =
      typeof body.archived === "boolean" ? body.archived : null;

    if (archived === null) {
      return NextResponse.json(
        { error: "Provide whether the application should be archived." },
        { status: 400 },
      );
    }

    try {
      const existingApplication = await prisma.jobApplication.findFirst({
        where: {
          id: applicationId,
          userId: session.user.id,
        },
      });

      if (!existingApplication) {
        return NextResponse.json(
          { error: "Application not found." },
          { status: 404 },
        );
      }

      const nextArchivedAt = archived
        ? existingApplication.archivedAt ?? new Date()
        : null;
      const application = await prisma.jobApplication.update({
        where: { id: existingApplication.id },
        data: {
          archivedAt: nextArchivedAt,
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

      await bumpUserSyncState({
        applications: true,
        userId: session.user.id,
      });

      return NextResponse.json({
        application: toJobApplicationRecord(application),
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : archived
            ? "Failed to archive the application."
            : "Failed to restore the application.";

      return NextResponse.json({ error: detail }, { status: 500 });
    }
  }

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
  const normalizedInput = normalizeJobApplicationWriteInput({
    appliedAt,
    companyName,
    employmentType,
    jobDescription,
    jobTitle,
    jobUrl,
    location,
    notes,
    onsiteDaysPerWeek,
    recruiterContact,
    referrerId,
    salaryRange,
    status,
    teamOrDepartment,
  });

  if (!normalizedInput.ok) {
    return NextResponse.json({ error: normalizedInput.error }, { status: 400 });
  }

  const {
    appliedAt: normalizedAppliedAt,
    companyName: normalizedCompanyName,
    employmentType: normalizedEmploymentType,
    jobDescription: normalizedJobDescription,
    jobTitle: normalizedJobTitle,
    jobUrl: normalizedJobUrl,
    location: normalizedLocation,
    normalizedSalary,
    notes: normalizedNotes,
    persistedOnsiteDaysPerWeek,
    recruiterContact: normalizedRecruiterContact,
    referrerId: normalizedReferrerId,
    status: normalizedStatus,
    teamOrDepartment: normalizedTeamOrDepartment,
  } = normalizedInput.value;

  try {
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
          normalizedName: normalizeCompanyName(normalizedCompanyName),
        },
      },
      create: {
        userId: session.user.id,
        name: normalizedCompanyName,
        normalizedName: normalizeCompanyName(normalizedCompanyName),
      },
      update: {
        name: normalizedCompanyName,
      },
    });

    const application = await prisma.jobApplication.update({
      where: { id: existingApplication.id },
      data: {
        companyId: company.id,
        title: normalizedJobTitle,
        status: normalizedStatus,
        location: normalizedLocation,
        onsiteDaysPerWeek: persistedOnsiteDaysPerWeek,
        referrerId: referrerRecord?.id ?? null,
        jobUrl: normalizedJobUrl,
        jobUrlHash: buildNormalizedJobUrlHash(normalizedJobUrl),
        salaryRange: normalizedSalary.text,
        salaryMinimum: normalizedSalary.minimum,
        salaryMaximum: normalizedSalary.maximum,
        employmentType: normalizedEmploymentType,
        teamOrDepartment: normalizedTeamOrDepartment,
        recruiterContact: referrerRecord?.recruiterContact ?? normalizedRecruiterContact,
        notes: normalizedNotes,
        hasReferral: Boolean(referrerRecord),
        jobDescription: normalizedJobDescription,
        appliedAt: resolveAppliedAt(normalizedAppliedAt),
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

    await bumpUserSyncState({
      applications: true,
      userId: session.user.id,
    });

    return NextResponse.json({ application });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to update the application.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { applicationId } = await context.params;

  try {
    const deleteResult = await deleteLinkedDashboardArtifacts({
      applicationId,
      userId: session.user.id,
    });

    if (deleteResult.impact.applicationCount === 0) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }

    return NextResponse.json({
      deleteImpact: deleteResult.impact,
      ok: true,
      profile: mergeTailorResumeProfileWithLockedLinks(
        deleteResult.rawProfile,
        deleteResult.lockedLinks,
        {
          includeLockedOnly: true,
        },
      ),
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to delete the application.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
