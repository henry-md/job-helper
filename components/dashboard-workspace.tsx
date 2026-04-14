"use client";

import { useEffect, useState } from "react";
import ApplicationStatsWorkspace from "@/components/application-stats-workspace";
import JobApplicationIntake from "@/components/job-application-intake";
import SignOutButton from "@/components/sign-out-button";
import StatusToast from "@/components/status-toast";
import TailorResumeWorkspace from "@/components/tailor-resume-workspace";
import { formatCompactDate, shouldIncludeShortYear } from "@/lib/date-format";
import type {
  CompanyOption,
  JobApplicationRecord,
  ReferrerOption,
} from "@/lib/job-application-types";
import type { TailorResumeProfile } from "@/lib/tailor-resume-types";

function getValidProfileImageSrc(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.startsWith("/")) {
    return normalizedValue;
  }

  try {
    const url = new URL(normalizedValue);
    return url.protocol === "http:" || url.protocol === "https:"
      ? normalizedValue
      : null;
  } catch {
    return null;
  }
}

function ProfileAvatar({
  imageSrc,
  name,
}: {
  imageSrc: string | null;
  name: string;
}) {
  const [resolvedImageSrc, setResolvedImageSrc] = useState<string | null>(null);
  const shouldRenderImage =
    imageSrc !== null && resolvedImageSrc === imageSrc;

  useEffect(() => {
    if (!imageSrc) {
      return;
    }

    let isActive = true;
    const probe = new window.Image();

    probe.onload = () => {
      if (isActive) {
        setResolvedImageSrc(imageSrc);
      }
    };

    probe.onerror = () => {
      if (isActive) {
        setResolvedImageSrc(null);
      }
    };

    probe.src = imageSrc;

    return () => {
      isActive = false;
    };
  }, [imageSrc]);

  if (shouldRenderImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={name}
        className="h-11 w-11 rounded-full object-cover"
        onError={() => setResolvedImageSrc(null)}
        src={imageSrc}
      />
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-300">
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M22 19v-1a4 4 0 0 0-3-3.87"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M16 3.13a4 4 0 0 1 0 7.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </div>
  );
}

export default function DashboardWorkspace({
  applicationCount,
  applications,
  companyCount,
  companyOptions,
  disabled,
  extractionModel,
  referrerOptions,
  statusMessage,
  tailorResumeOpenAIReady,
  tailorResumeProfile,
  userImage,
  userName,
}: {
  applicationCount: number;
  applications: JobApplicationRecord[];
  companyCount: number;
  companyOptions: CompanyOption[];
  disabled: boolean;
  extractionModel: string;
  referrerOptions: ReferrerOption[];
  statusMessage?: {
    text: string;
    tone: "error" | "success";
  } | null;
  tailorResumeOpenAIReady: boolean;
  tailorResumeProfile: TailorResumeProfile;
  userImage: string | null | undefined;
  userName: string | null | undefined;
}) {
  const [activeTab, setActiveTab] = useState<"history" | "new" | "tailor">("new");
  const [historyApplicationId, setHistoryApplicationId] = useState<string | null>(
    null,
  );
  const displayName = userName?.trim()?.split(" ")[0] || userName || "there";
  const profileImageSrc = getValidProfileImageSrc(userImage);
  const includeYearInDates = shouldIncludeShortYear(
    applications.map((application) => application.appliedAt),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
      <StatusToast
        message={statusMessage?.text}
        tone={statusMessage?.tone}
      />

      <header className="glass-panel soft-ring flex min-h-[88px] flex-wrap items-center justify-between gap-4 rounded-[1.5rem] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar
            imageSrc={profileImageSrc}
            name={userName ?? "Profile"}
          />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              Dashboard
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
              {displayName}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 p-1">
            <button
              className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                activeTab === "new"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveTab("new")}
              type="button"
            >
              New application
            </button>
            <button
              className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                activeTab === "tailor"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveTab("tailor")}
              type="button"
            >
              Tailor Resume
            </button>
            <button
              className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                activeTab === "history"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveTab("history")}
              type="button"
            >
              History
            </button>
          </nav>
          <SignOutButton />
        </div>
      </header>

      <div
        className={`min-h-0 flex-1 ${
          activeTab === "new" ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {activeTab === "new" ? (
          <section className="grid h-full min-h-0 gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-[1.45fr_0.55fr]">
            <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
              <JobApplicationIntake
                companyOptions={companyOptions}
                disabled={disabled}
                extractionModel={extractionModel}
                referrerOptions={referrerOptions}
              />
            </section>

            <aside className="grid min-h-0 content-start gap-[clamp(0.75rem,1.2vh,1rem)] self-start">
              <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    Recent applications
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                      {applicationCount} apps
                    </span>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                      {companyCount} companies
                    </span>
                  </div>
                </div>
                {applications.length === 0 ? (
                  <p className="text-sm text-zinc-400">No applications yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {applications.slice(0, 4).map((application) => (
                      <button
                        key={application.id}
                        className="rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5 text-left transition hover:border-emerald-400/25 hover:bg-emerald-400/6 focus-visible:border-emerald-300/45 focus-visible:outline-none"
                        onClick={() => {
                          setHistoryApplicationId(application.id);
                          setActiveTab("history");
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
                          <span className="text-xs text-zinc-500">
                            {formatCompactDate(
                              application.appliedAt,
                              includeYearInDates,
                            )}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </section>
        ) : activeTab === "tailor" ? (
          <TailorResumeWorkspace
            openAIReady={tailorResumeOpenAIReady}
            initialProfile={tailorResumeProfile}
          />
        ) : (
          <ApplicationStatsWorkspace
            companyOptions={companyOptions}
            applications={applications}
            initialExpandedId={historyApplicationId}
            referrerOptions={referrerOptions}
          />
        )}
      </div>
    </div>
  );
}
