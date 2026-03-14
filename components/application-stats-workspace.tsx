"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ApplicationWindow from "@/components/application-window";
import type {
  CompanyOption,
  JobApplicationDraft,
  JobApplicationRecord,
  ReferrerOption,
} from "@/lib/job-application-types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function toDraft(application: JobApplicationRecord): JobApplicationDraft {
  return {
    appliedAt: application.appliedAt,
    companyName: application.companyName,
    jobDescription: application.jobDescription,
    jobTitle: application.jobTitle,
    jobUrl: application.jobUrl,
    location: application.location,
    notes: application.notes,
    onsiteDaysPerWeek: application.onsiteDaysPerWeek,
    referrerId: application.referrerId,
    referrerName: application.referrerName,
    recruiterContact: application.recruiterContact,
    salaryRange: application.salaryRange,
    status: application.status,
    teamOrDepartment: application.teamOrDepartment,
    employmentType: application.employmentType,
  };
}

function matchesSearch(application: JobApplicationRecord, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    application.jobTitle,
    application.companyName,
    application.status,
    application.location,
    application.teamOrDepartment,
    application.recruiterContact,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export default function ApplicationStatsWorkspace({
  companyOptions,
  applications: initialApplications,
  referrerOptions: initialReferrerOptions,
}: {
  companyOptions: CompanyOption[];
  applications: JobApplicationRecord[];
  referrerOptions: ReferrerOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [applications, setApplications] = useState(initialApplications);
  const [selectedId, setSelectedId] = useState(initialApplications[0]?.id ?? null);
  const [draft, setDraft] = useState<JobApplicationDraft>(
    initialApplications[0]
      ? toDraft(initialApplications[0])
      : {
          appliedAt: "",
          companyName: "",
          jobDescription: "",
          jobTitle: "",
          jobUrl: "",
          location: "",
          notes: "",
          onsiteDaysPerWeek: "",
          referrerId: "",
          referrerName: "",
          recruiterContact: "",
          salaryRange: "",
          status: "APPLIED",
          teamOrDepartment: "",
          employmentType: "",
        },
  );
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [referrerOptions, setReferrerOptions] = useState(initialReferrerOptions);
  const [searchQuery, setSearchQuery] = useState("");
  const [banner, setBanner] = useState<{
    text: string;
    tone: "error" | "success";
  } | null>(null);

  const filteredApplications = applications.filter((application) =>
    matchesSearch(application, searchQuery),
  );
  const selectedApplication =
    applications.find((application) => application.id === selectedId) ?? null;
  const activePipelineCount = applications.filter((application) =>
    ["APPLIED", "INTERVIEW", "OFFER"].includes(application.status),
  ).length;
  const referredCount = applications.filter((application) => application.referrerId).length;
  const flexibleCount = applications.filter((application) =>
    application.location === "remote" || application.location === "hybrid",
  ).length;
  const statusCounts = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"].map(
    (status) => ({
      count: applications.filter((application) => application.status === status).length,
      label: status,
    }),
  );

  useEffect(() => {
    if (!selectedApplication) {
      return;
    }

    setDraft(toDraft(selectedApplication));
    setIsMoreOpen(false);
  }, [selectedApplication]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedApplication) {
      return;
    }

    setIsSaving(true);
    setBanner(null);

    try {
      const response = await fetch(`/api/job-applications/${selectedApplication.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as {
        application?: {
          id: string;
          title: string;
          status: string;
          location: string | null;
          onsiteDaysPerWeek: number | null;
          jobUrl: string | null;
          salaryRange: string | null;
          employmentType: string | null;
          teamOrDepartment: string | null;
          recruiterContact: string | null;
          notes: string | null;
          referrer: {
            id: string;
            name: string;
            company: { id: string; name: string } | null;
          } | null;
          jobDescription: string | null;
          appliedAt: string;
          createdAt: string;
          updatedAt: string;
          company: { name: string };
        };
        error?: string;
      };

      if (!response.ok || !payload.application) {
        throw new Error(payload.error ?? "Failed to update the application.");
      }

      const updatedApplication: JobApplicationRecord = {
        appliedAt: payload.application.appliedAt.slice(0, 10),
        companyName: payload.application.company.name,
        createdAt: payload.application.createdAt,
        id: payload.application.id,
        jobDescription: payload.application.jobDescription ?? "",
        jobTitle: payload.application.title,
        jobUrl: payload.application.jobUrl ?? "",
        location: (payload.application.location as JobApplicationRecord["location"]) ?? "",
        notes: payload.application.notes ?? "",
        onsiteDaysPerWeek:
          payload.application.onsiteDaysPerWeek !== null
            ? String(payload.application.onsiteDaysPerWeek)
            : "",
        referrerId: payload.application.referrer?.id ?? "",
        referrerName: payload.application.referrer?.name ?? "",
        recruiterContact: payload.application.recruiterContact ?? "",
        salaryRange: payload.application.salaryRange ?? "",
        status: payload.application.status as JobApplicationRecord["status"],
        teamOrDepartment: payload.application.teamOrDepartment ?? "",
        employmentType:
          (payload.application.employmentType as JobApplicationRecord["employmentType"]) ?? "",
        updatedAt: payload.application.updatedAt,
      };

      setApplications((currentApplications) =>
        currentApplications.map((application) =>
          application.id === updatedApplication.id ? updatedApplication : application,
        ),
      );
      setBanner({
        text: "Updated the application.",
        tone: "success",
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setBanner({
        text:
          error instanceof Error
            ? error.message
            : "Failed to update the application.",
        tone: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function resetSelectedDraft() {
    if (!selectedApplication) {
      return;
    }

    setDraft(toDraft(selectedApplication));
    setIsMoreOpen(false);
    setBanner(null);
  }

  return (
    <section className="grid min-h-0 flex-1 gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[0.72fr_1.28fr]">
      <aside className="grid min-h-0 content-start gap-[clamp(0.75rem,1.2vh,1rem)]">
        <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Stats overview
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <article className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {applications.length}
              </p>
            </article>
            <article className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Active pipeline
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {activePipelineCount}
              </p>
            </article>
            <article className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Referred</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {referredCount}
              </p>
            </article>
            <article className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Remote or hybrid
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {flexibleCount}
              </p>
            </article>
          </div>

          <div className="mt-4 rounded-[1rem] border border-white/8 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Status mix
            </p>
            <div className="mt-3 grid gap-2">
              {statusCounts.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-[0.85rem] border border-white/6 px-3 py-2"
                >
                  <span className="text-sm text-zinc-300">{item.label}</span>
                  <span className="text-sm font-medium text-zinc-100">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Applications
            </p>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
              {filteredApplications.length}
            </span>
          </div>
          <input
            className="mt-3 rounded-[1rem] border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-300/45"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search title, company, status..."
            type="search"
            value={searchQuery}
          />
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            {filteredApplications.length === 0 ? (
              <p className="text-sm text-zinc-400">No applications match this filter.</p>
            ) : (
              <div className="grid gap-2">
                {filteredApplications.map((application) => (
                  <button
                    key={application.id}
                    className={`rounded-[1rem] border px-3 py-3 text-left transition ${
                      application.id === selectedId
                        ? "border-emerald-400/30 bg-emerald-400/10"
                        : "border-white/8 bg-black/20 hover:border-white/14"
                    }`}
                    onClick={() => {
                      setSelectedId(application.id);
                      setBanner(null);
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {application.jobTitle}
                        </p>
                        <p className="truncate text-sm text-zinc-400">
                          {application.companyName}
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      Updated {formatDate(application.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </aside>

      <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
        {!selectedApplication ? (
          <div className="flex h-full items-center justify-center rounded-[1.25rem] border border-white/8 bg-black/20 p-6 text-center text-sm text-zinc-400">
            Select an application to edit it.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Application window
                </p>
                <h2 className="mt-1 text-lg font-semibold text-zinc-50">
                  {selectedApplication.companyName}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Last updated {formatDate(selectedApplication.updatedAt)}
                </p>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                {selectedApplication.status}
              </span>
            </div>

            {banner ? (
              <div
                className={`mb-3 shrink-0 rounded-[1rem] px-4 py-2.5 text-sm ${
                  banner.tone === "success"
                    ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                    : "border border-amber-400/25 bg-amber-400/10 text-amber-100"
                }`}
              >
                {banner.text}
              </div>
            ) : null}

            <ApplicationWindow
              companyOptions={companyOptions}
              draft={draft}
              footerMessage="Edit the application, then save changes."
              isFormLocked={isSaving}
              isMoreOpen={isMoreOpen}
              isSaving={isSaving}
              onReset={resetSelectedDraft}
              onSubmit={handleSubmit}
              referrerOptions={referrerOptions}
              saveDisabled={
                isSaving ||
                draft.jobTitle.trim().length === 0 ||
                draft.companyName.trim().length === 0
              }
              setDraft={setDraft}
              setIsMoreOpen={setIsMoreOpen}
              setReferrerOptions={setReferrerOptions}
            />
          </>
        )}
      </section>
    </section>
  );
}
