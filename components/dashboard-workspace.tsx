"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import JobApplicationIntake from "@/components/job-application-intake";
import PromptSettingsWorkspace from "@/components/prompt-settings-workspace";
import SignOutButton from "@/components/sign-out-button";
import StatusToast from "@/components/status-toast";
import TailoredResumeReviewModal from "@/components/tailored-resume-review-modal";
import TailorResumeWorkspace from "@/components/tailor-resume-workspace";
import {
  buildDashboardHref,
  parseDashboardRouteStateFromSearchParams,
  type DashboardRouteState,
  type DashboardTabId,
} from "@/lib/dashboard-route-state";
import {
  formatCompactDate,
  formatCompactDateOrSameDayTime,
  shouldIncludeShortYear,
} from "@/lib/date-format";
import { formatTailoredResumeSidebarName } from "@/lib/tailored-resume-sidebar-name";
import type {
  CompanyOption,
  JobApplicationRecord,
  ReferrerOption,
} from "@/lib/job-application-types";
import type {
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";

type TailoredResumeSidebarMutationResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  tailoredResumeId?: string;
};

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
  defaultPromptSettings,
  disabled,
  extractionModel,
  initialReviewingTailoredResumeId,
  initialTab,
  referrerOptions,
  statusMessage,
  tailorResumeDebugUiEnabled,
  tailorResumeOpenAIReady,
  tailorResumeProfile,
  userImage,
  userName,
}: {
  applicationCount: number;
  applications: JobApplicationRecord[];
  companyCount: number;
  companyOptions: CompanyOption[];
  defaultPromptSettings: TailorResumeProfile["promptSettings"]["values"];
  disabled: boolean;
  extractionModel: string;
  initialReviewingTailoredResumeId?: string | null;
  initialTab: "new" | "settings" | "tailor";
  referrerOptions: ReferrerOption[];
  statusMessage?: {
    text: string;
    tone: "error" | "success";
  } | null;
  tailorResumeDebugUiEnabled: boolean;
  tailorResumeOpenAIReady: boolean;
  tailorResumeProfile: TailorResumeProfile;
  userImage: string | null | undefined;
  userName: string | null | undefined;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dashboardRouteState, setDashboardRouteState] = useState<DashboardRouteState>(
    () => ({
      tab: initialTab,
      tailoredResumeId: initialReviewingTailoredResumeId ?? null,
    }),
  );
  const [tailoredResumePendingDeleteId, setTailoredResumePendingDeleteId] = useState<string | null>(null);
  const [tailoredResumes, setTailoredResumes] = useState<TailoredResumeRecord[]>(
    () => tailorResumeProfile.tailoredResumes,
  );
  const [isDeletingTailoredResume, setIsDeletingTailoredResume] = useState(false);
  const activeTab = dashboardRouteState.tab;
  const reviewingTailoredResumeId = dashboardRouteState.tailoredResumeId;
  const reviewingTailoredResume =
    tailoredResumes.find((tr) => tr.id === reviewingTailoredResumeId) ?? null;
  const tailoredResumePendingDelete =
    tailoredResumes.find((tr) => tr.id === tailoredResumePendingDeleteId) ?? null;
  const displayName = userName?.trim()?.split(" ")[0] || userName || "there";
  const profileImageSrc = getValidProfileImageSrc(userImage);
  const includeYearInApplicationDates = shouldIncludeShortYear(
    applications.map((application) => application.appliedAt),
  );
  const includeYearInTailoredResumeDates = shouldIncludeShortYear(
    tailoredResumes.map((tailoredResume) => tailoredResume.updatedAt),
  );
  const tailoredResumeCountLabel =
    `${tailoredResumes.length} ${tailoredResumes.length === 1 ? "resume" : "resumes"}`;

  useEffect(() => {
    setDashboardRouteState(parseDashboardRouteStateFromSearchParams(searchParams));
  }, [searchParams]);

  function navigateDashboard(nextRouteState: DashboardRouteState) {
    setDashboardRouteState(nextRouteState);

    const nextHref = buildDashboardHref(nextRouteState);
    const currentQueryString = searchParams.toString();
    const currentHref = currentQueryString
      ? `/dashboard?${currentQueryString}`
      : "/dashboard";

    if (nextHref !== currentHref) {
      router.replace(nextHref, {
        scroll: false,
      });
    }
  }

  function setActiveDashboardTab(nextTab: DashboardTabId) {
    navigateDashboard({
      tab: nextTab,
      tailoredResumeId: null,
    });
  }

  function openTailoredResumeReview(tailoredResumeId: string) {
    navigateDashboard({
      tab: "tailor",
      tailoredResumeId,
    });
  }

  function closeTailoredResumeReview() {
    navigateDashboard({
      tab: "tailor",
      tailoredResumeId: null,
    });
  }

  useEffect(() => {
    if (!tailoredResumePendingDelete) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingTailoredResume) {
        setTailoredResumePendingDeleteId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeletingTailoredResume, tailoredResumePendingDelete]);

  async function deleteTailoredResume() {
    if (!tailoredResumePendingDelete) {
      return;
    }

    setIsDeletingTailoredResume(true);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "deleteTailoredResume",
          tailoredResumeId: tailoredResumePendingDelete.id,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as TailoredResumeSidebarMutationResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to delete the tailored resume.");
      }

      setTailoredResumes(payload.profile.tailoredResumes);
      setTailoredResumePendingDeleteId(null);

      if (reviewingTailoredResumeId === tailoredResumePendingDelete.id) {
        closeTailoredResumeReview();
      }

      toast.success("Deleted the tailored resume.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete the tailored resume.",
      );
    } finally {
      setIsDeletingTailoredResume(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-0">
      <StatusToast
        message={statusMessage?.text}
        tone={statusMessage?.tone}
      />

      <header className="glass-panel soft-ring flex flex-col gap-4 rounded-[1.5rem] px-4 py-4 sm:min-h-[88px] sm:flex-row sm:items-center sm:justify-between sm:px-5">
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

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
          <nav className="grid w-full grid-cols-3 items-center gap-2 rounded-[1.4rem] border border-white/10 bg-black/20 p-1 sm:flex sm:w-auto sm:rounded-full">
            <button
              className={`w-full min-w-0 whitespace-nowrap rounded-full px-2.5 py-2 text-center text-[0.7rem] uppercase leading-none tracking-[0.14em] transition sm:w-auto sm:px-3 sm:text-xs sm:tracking-[0.16em] ${
                activeTab === "tailor"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveDashboardTab("tailor")}
              type="button"
            >
              Tailor Resume
            </button>
            <button
              className={`w-full min-w-0 whitespace-nowrap rounded-full px-2.5 py-2 text-center text-[0.7rem] uppercase leading-none tracking-[0.14em] transition sm:w-auto sm:px-3 sm:text-xs sm:tracking-[0.16em] ${
                activeTab === "new"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveDashboardTab("new")}
              type="button"
            >
              Applications
            </button>
            <button
              className={`w-full min-w-0 whitespace-nowrap rounded-full px-2.5 py-2 text-center text-[0.7rem] uppercase leading-none tracking-[0.14em] transition sm:w-auto sm:px-3 sm:text-xs sm:tracking-[0.16em] ${
                activeTab === "settings"
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => setActiveDashboardTab("settings")}
              type="button"
            >
              Settings
            </button>
          </nav>
          <SignOutButton className="w-full sm:w-auto" />
        </div>
      </header>

      <TailoredResumeReviewModal
        debugUiEnabled={tailorResumeDebugUiEnabled}
        key={reviewingTailoredResume?.id ?? "closed"}
        onClose={closeTailoredResumeReview}
        onTailoredResumesChange={setTailoredResumes}
        record={reviewingTailoredResume}
      />
      {typeof document !== "undefined" && tailoredResumePendingDelete
        ? createPortal(
            <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/58 p-4 backdrop-blur-sm">
              <div
                aria-describedby="delete-tailored-resume-description"
                aria-labelledby="delete-tailored-resume-title"
                aria-modal="true"
                className="glass-panel soft-ring relative w-full max-w-md overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(251,113,133,0.06),rgba(39,39,42,0.72)_22%,rgba(9,9,11,0.94)_100%)] text-zinc-50 shadow-[0_30px_120px_rgba(0,0,0,0.56)]"
                role="dialog"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(251,113,133,0.12),transparent_72%)]" />
                <div className="relative grid gap-3 px-5 pb-5 pt-5 text-left sm:px-6 sm:pb-6 sm:pt-6">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-rose-100/75">
                      Remove from history
                    </p>
                    <h2
                      className="mt-3 text-[1.35rem] font-semibold tracking-tight text-zinc-50"
                      id="delete-tailored-resume-title"
                    >
                      Delete tailored resume?
                    </h2>
                    <p
                      className="mt-3 max-w-md text-sm leading-6 text-zinc-400"
                      id="delete-tailored-resume-description"
                    >
                      This removes the saved tailored resume and its PDF preview
                      from History. This action can&apos;t be undone.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-white/10 bg-black/20 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-5">
                  <button
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isDeletingTailoredResume}
                    onClick={() => setTailoredResumePendingDeleteId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-full border border-rose-300/18 bg-[linear-gradient(180deg,rgba(251,113,133,0.16),rgba(159,18,57,0.24))] px-4 py-2.5 text-sm font-medium text-rose-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-[linear-gradient(180deg,rgba(251,113,133,0.2),rgba(159,18,57,0.28))] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isDeletingTailoredResume}
                    onClick={() => void deleteTailoredResume()}
                    type="button"
                  >
                    {isDeletingTailoredResume ? "Deleting..." : "Delete resume"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <div className="flex-1 overflow-visible sm:min-h-0 sm:overflow-hidden">
        {activeTab === "new" ? (
          <section className="grid content-start gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-0 xl:grid-cols-[1.45fr_0.55fr]">
            <section className="glass-panel soft-ring flex min-h-0 flex-col rounded-[1.5rem] p-4 sm:p-5">
              <JobApplicationIntake
                companyOptions={companyOptions}
                disabled={disabled}
                extractionModel={extractionModel}
                referrerOptions={referrerOptions}
              />
            </section>

            <aside className="overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
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
                      <div
                        key={application.id}
                        className="rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5"
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
                          <span className="shrink-0 text-xs text-zinc-500">
                            {formatCompactDate(
                              application.appliedAt,
                              includeYearInApplicationDates,
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </section>
        ) : activeTab === "tailor" ? (
          <section className="grid content-start gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-0 xl:grid-cols-[1fr_0.4fr]">
            <div className="overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto">
              <TailorResumeWorkspace
                debugUiEnabled={tailorResumeDebugUiEnabled}
                openAIReady={tailorResumeOpenAIReady}
                initialProfile={tailorResumeProfile}
                onReviewTailoredResume={openTailoredResumeReview}
                onTailoredResumesChange={setTailoredResumes}
              />
            </div>

            <aside className="overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
              <section className="glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    Recent tailored resumes
                  </p>
                  <span
                    className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400"
                    title={`${tailoredResumes.length} total tailored resume${
                      tailoredResumes.length === 1 ? "" : "s"
                    }`}
                  >
                    {tailoredResumeCountLabel}
                  </span>
                </div>
                {tailoredResumes.length === 0 ? (
                  <p className="text-sm text-zinc-400">No tailored resumes yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {tailoredResumes.map((tailoredResume) => (
                      <div
                        key={tailoredResume.id}
                        className="group flex items-start gap-1 rounded-[1rem] border border-white/8 bg-black/20 transition hover:border-emerald-400/25 hover:bg-emerald-400/6 focus-within:border-emerald-300/45"
                      >
                        <button
                          className="min-w-0 flex-1 overflow-hidden px-3 py-2.5 text-left focus-visible:outline-none"
                          onClick={() => openTailoredResumeReview(tailoredResume.id)}
                          type="button"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm font-medium text-zinc-100"
                                title={tailoredResume.displayName}
                              >
                                {formatTailoredResumeSidebarName(tailoredResume)}
                              </p>
                              <p className="truncate text-sm text-zinc-400">
                                {tailoredResume.companyName}
                              </p>
                            </div>
                            <span className="shrink-0 self-center text-xs text-zinc-500">
                              {formatCompactDateOrSameDayTime(
                                tailoredResume.updatedAt,
                                {
                                  includeYear: includeYearInTailoredResumeDates,
                                },
                              )}
                            </span>
                          </div>
                        </button>
                        <button
                          aria-label={`Delete ${tailoredResume.displayName}`}
                          className="mr-1 mt-2 shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-rose-400/10 hover:text-rose-200 focus-visible:bg-rose-400/10 focus-visible:text-rose-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-zinc-700"
                          disabled={isDeletingTailoredResume}
                          onClick={() => setTailoredResumePendingDeleteId(tailoredResume.id)}
                          title="Delete tailored resume"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </section>
        ) : (
          <section className="sm:h-full sm:min-h-0">
            <div className="h-full overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto">
              <PromptSettingsWorkspace
                defaultPromptValues={defaultPromptSettings}
                initialPromptSettings={tailorResumeProfile.promptSettings}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
