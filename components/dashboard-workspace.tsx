"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import PromptSettingsWorkspace from "@/components/prompt-settings-workspace";
import SignOutButton from "@/components/sign-out-button";
import StatusToast from "@/components/status-toast";
import TailorResumeActiveRuns from "@/components/tailor-resume-active-runs";
import TailoredResumeReviewModal from "@/components/tailored-resume-review-modal";
import TailorResumeWorkspace from "@/components/tailor-resume-workspace";
import UserMarkdownCard from "@/components/user-markdown-card";
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
import { buildJobApplicationDisplayParts } from "@/lib/job-application-display";
import {
  haveUserSyncStateChanged,
  readUserSyncStateSnapshot,
  type UserSyncStateSnapshot,
} from "@/lib/sync-state";
import {
  readTailorResumeExistingTailoringStates,
  type TailorResumeExistingTailoringState,
} from "@/lib/tailor-resume-existing-tailoring-state";
import { normalizeTailorResumeJobUrl } from "@/lib/tailor-resume-job-url";
import { splitTailoredResumesByArchiveState } from "@/lib/tailored-resume-archive-state";
import {
  getTailoredResumeGenerationFailureLabel,
  hasTailoredResumeGenerationFailure,
} from "@/lib/tailored-resume-generation-state";
import { formatTailoredResumeSidebarName } from "@/lib/tailored-resume-sidebar-name";
import type { JobApplicationRecord } from "@/lib/job-application-types";
import type {
  TailorResumeProfile,
  TailoredResumeRecord,
} from "@/lib/tailor-resume-types";
import type { TailorResumeUserMarkdownState } from "@/lib/tailor-resume-user-memory";

type DashboardDeleteImpact = {
  applicationCount: number;
  applicationIds: string[];
  tailoredResumeCount: number;
  tailoredResumeIds: string[];
  totalCount: number;
};

type DashboardDeleteMutationResponse = {
  deleteImpact?: DashboardDeleteImpact;
  error?: string;
  profile?: TailorResumeProfile;
  tailoredResumeId?: string;
};

type DashboardApplicationsResponse = {
  applicationCount?: number;
  applications?: JobApplicationRecord[];
  companyCount?: number;
  error?: string;
};

type DashboardApplicationMutationResponse = {
  application?: JobApplicationRecord;
  error?: string;
};

type DashboardTailorResumeResponse = {
  archived?: boolean;
  activeTailorings?: TailorResumeExistingTailoringState[];
  error?: string;
  profile?: TailorResumeProfile;
  syncState?: UserSyncStateSnapshot;
};

type PendingDashboardDelete =
  | {
      applicationId: string;
      kind: "application";
    }
  | {
      kind: "tailoredResume";
      tailoredResumeId: string;
    };

type ArchiveView = "archived" | "unarchived";

const dashboardTabs = [
  {
    id: "config",
    label: "Config",
  },
  {
    id: "saved",
    label: "Saved",
  },
  {
    id: "settings",
    label: "Settings",
  },
] as const satisfies Array<{
  id: DashboardTabId;
  label: string;
}>;

const historyDeleteButtonClassName =
  "tailor-history-delete mr-1 shrink-0 self-center rounded-full p-2 text-zinc-500 transition hover:bg-rose-400/10 hover:text-rose-200 focus-visible:bg-rose-400/10 focus-visible:text-rose-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-zinc-700";
const historyActionButtonClassName =
  "shrink-0 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-300 transition hover:border-emerald-300/35 hover:bg-emerald-400/10 hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-50";
const historySegmentControlClassName =
  "inline-grid grid-cols-2 rounded-full border border-white/10 bg-black/20 p-1";
const historySegmentButtonClassName =
  "rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/25 sm:px-4";

function uniqueTailoredResumes(records: TailoredResumeRecord[]) {
  const recordById = new Map<string, TailoredResumeRecord>();

  for (const record of records) {
    recordById.set(record.id, record);
  }

  return [...recordById.values()];
}

function buildTailorResumeProfileRefreshKey(profile: TailorResumeProfile) {
  return [
    profile.resume?.updatedAt ?? "",
    profile.extraction.updatedAt ?? "",
    profile.latex.updatedAt ?? "",
    profile.annotatedLatex.updatedAt ?? "",
    profile.jobDescription,
    profile.workspace.updatedAt ?? "",
    profile.workspace.isBaseResumeStepComplete ? "1" : "0",
    profile.workspace.tailoringInterviews
      .map(
        (interview) =>
          `${interview.id}:${interview.updatedAt}:${interview.completionRequestedAt ?? ""}:${interview.tailorResumeRunId ?? ""}`,
      )
      .join("|"),
    profile.tailoredResumes
      .map(
        (record) =>
          `${record.id}:${record.updatedAt}:${record.archivedAt ?? ""}:${record.status}:${record.pdfUpdatedAt ?? ""}:${record.applicationId ?? ""}:${record.error ?? ""}`,
      )
      .join("|"),
    profile.generationSettings.updatedAt ?? "",
    profile.promptSettings.updatedAt ?? "",
  ].join("::");
}

function findLinkedApplicationForTailoredResume(
  record: TailoredResumeRecord,
  applications: JobApplicationRecord[],
) {
  if (record.applicationId) {
    const linkedApplication = applications.find(
      (application) => application.id === record.applicationId,
    );

    if (linkedApplication) {
      return linkedApplication;
    }
  }

  const normalizedJobUrl = normalizeTailorResumeJobUrl(record.jobUrl);

  if (!normalizedJobUrl) {
    return null;
  }

  return (
    applications.find(
      (application) =>
        normalizeTailorResumeJobUrl(application.jobUrl) === normalizedJobUrl,
    ) ?? null
  );
}

function findLinkedTailoredResumesForApplication(
  application: JobApplicationRecord,
  tailoredResumes: TailoredResumeRecord[],
) {
  const normalizedJobUrl = normalizeTailorResumeJobUrl(application.jobUrl);

  return tailoredResumes.filter((record) => {
    if (record.applicationId) {
      return record.applicationId === application.id;
    }

    return Boolean(
      normalizedJobUrl &&
        normalizeTailorResumeJobUrl(record.jobUrl) === normalizedJobUrl,
    );
  });
}

function formatDeleteImpactSummary(impact: DashboardDeleteImpact) {
  const parts: string[] = [];

  if (impact.applicationCount > 0) {
    parts.push(
      `${impact.applicationCount} application${
        impact.applicationCount === 1 ? "" : "s"
      }`,
    );
  }

  if (impact.tailoredResumeCount > 0) {
    parts.push(
      `${impact.tailoredResumeCount} tailored resume${
        impact.tailoredResumeCount === 1 ? "" : "s"
      }`,
    );
  }

  if (parts.length === 0) {
    return "this item";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]} and ${parts[1]}`;
}

function formatApplicationStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function buildPendingDeleteImpact(input: {
  applications: JobApplicationRecord[];
  pendingDelete: PendingDashboardDelete | null;
  tailoredResumes: TailoredResumeRecord[];
}): DashboardDeleteImpact | null {
  if (!input.pendingDelete) {
    return null;
  }

  const pendingDelete = input.pendingDelete;

  if (pendingDelete.kind === "application") {
    const application =
      input.applications.find(
        (record) => record.id === pendingDelete.applicationId,
      ) ?? null;

    if (!application) {
      return null;
    }

    const linkedTailoredResumes = uniqueTailoredResumes(
      findLinkedTailoredResumesForApplication(
        application,
        input.tailoredResumes,
      ),
    );

    return {
      applicationCount: 1,
      applicationIds: [application.id],
      tailoredResumeCount: linkedTailoredResumes.length,
      tailoredResumeIds: linkedTailoredResumes.map((record) => record.id),
      totalCount: 1 + linkedTailoredResumes.length,
    };
  }

  const tailoredResume =
    input.tailoredResumes.find(
      (record) => record.id === pendingDelete.tailoredResumeId,
    ) ?? null;

  if (!tailoredResume) {
    return null;
  }

  const linkedApplication = findLinkedApplicationForTailoredResume(
    tailoredResume,
    input.applications,
  );
  const linkedTailoredResumes = uniqueTailoredResumes(
    linkedApplication
      ? [
          tailoredResume,
          ...findLinkedTailoredResumesForApplication(
            linkedApplication,
            input.tailoredResumes,
          ),
        ]
      : [tailoredResume],
  );

  return {
    applicationCount: linkedApplication ? 1 : 0,
    applicationIds: linkedApplication ? [linkedApplication.id] : [],
    tailoredResumeCount: linkedTailoredResumes.length,
    tailoredResumeIds: linkedTailoredResumes.map((record) => record.id),
    totalCount:
      linkedTailoredResumes.length + (linkedApplication ? 1 : 0),
  };
}

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
  applications,
  defaultPromptSettings,
  initialReviewingTailoredResumeId,
  initialSyncState,
  initialTab,
  statusMessage,
  tailorResumeDebugUiEnabled,
  tailorResumeOpenAIReady,
  initialActiveTailorings,
  tailorResumeProfile,
  tailorResumeUserMarkdown,
  userImage,
  userName,
}: {
  applications: JobApplicationRecord[];
  defaultPromptSettings: TailorResumeProfile["promptSettings"]["values"];
  initialReviewingTailoredResumeId?: string | null;
  initialSyncState: UserSyncStateSnapshot;
  initialTab: DashboardTabId;
  statusMessage?: {
    text: string;
    tone: "error" | "success";
  } | null;
  tailorResumeDebugUiEnabled: boolean;
  tailorResumeOpenAIReady: boolean;
  initialActiveTailorings: TailorResumeExistingTailoringState[];
  tailorResumeProfile: TailorResumeProfile;
  tailorResumeUserMarkdown: TailorResumeUserMarkdownState;
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
  const [applicationRecords, setApplicationRecords] = useState<JobApplicationRecord[]>(
    () => applications,
  );
  const [tailorResumeProfileState, setTailorResumeProfileState] =
    useState<TailorResumeProfile>(() => tailorResumeProfile);
  const [tailorResumeUserMarkdownState, setTailorResumeUserMarkdownState] =
    useState<TailorResumeUserMarkdownState>(() => tailorResumeUserMarkdown);
  const [activeTailorings, setActiveTailorings] =
    useState<TailorResumeExistingTailoringState[]>(() => initialActiveTailorings);
  const [pendingDashboardDelete, setPendingDashboardDelete] =
    useState<PendingDashboardDelete | null>(null);
  const [tailoredResumes, setTailoredResumes] = useState<TailoredResumeRecord[]>(
    () => tailorResumeProfile.tailoredResumes,
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDeletingDashboardItem, setIsDeletingDashboardItem] = useState(false);
  const [tailoredResumeArchiveActionId, setTailoredResumeArchiveActionId] =
    useState<string | null>(null);
  const [applicationArchiveActionId, setApplicationArchiveActionId] =
    useState<string | null>(null);
  const [resumeArchiveView, setResumeArchiveView] =
    useState<ArchiveView>("unarchived");
  const [applicationArchiveView, setApplicationArchiveView] =
    useState<ArchiveView>("unarchived");
  const lastSeenSyncStateRef = useRef<UserSyncStateSnapshot>(initialSyncState);
  const tailorResumeProfileRefreshKeyRef = useRef(
    buildTailorResumeProfileRefreshKey(tailorResumeProfile),
  );
  const isSyncStateCheckInFlightRef = useRef(false);
  const isSyncRefreshInFlightRef = useRef(false);
  const activeTab = dashboardRouteState.tab;
  const reviewingTailoredResumeId = dashboardRouteState.tailoredResumeId;
  const reviewingTailoredResume =
    tailoredResumes.find((tr) => tr.id === reviewingTailoredResumeId) ?? null;
  const pendingDeleteImpact = buildPendingDeleteImpact({
    applications: applicationRecords,
    pendingDelete: pendingDashboardDelete,
    tailoredResumes,
  });
  const displayName = userName?.trim()?.split(" ")[0] || userName || "there";
  const profileImageSrc = getValidProfileImageSrc(userImage);
  const includeYearInApplicationDates = shouldIncludeShortYear(
    applicationRecords.map((application) => application.appliedAt),
  );
  const includeYearInTailoredResumeDates = shouldIncludeShortYear(
    tailoredResumes.map((tailoredResume) => tailoredResume.updatedAt),
  );
  const { archived: archivedTailoredResumes, unarchived: unarchivedTailoredResumes } =
    splitTailoredResumesByArchiveState(tailoredResumes);
  const { archived: archivedApplications, unarchived: unarchivedApplications } =
    splitTailoredResumesByArchiveState(applicationRecords);
  const pendingDeleteTitle =
    pendingDeleteImpact && pendingDeleteImpact.totalCount > 1
      ? `Delete ${pendingDeleteImpact.totalCount} items?`
      : pendingDashboardDelete?.kind === "application"
        ? "Delete application?"
        : "Delete tailored resume?";
  const pendingDeleteEyebrow =
    pendingDeleteImpact && pendingDeleteImpact.totalCount > 1
      ? "Remove linked items"
      : pendingDashboardDelete?.kind === "application"
        ? "Remove application"
        : "Remove from history";
  const pendingDeleteDescription =
    pendingDeleteImpact && pendingDeleteImpact.totalCount > 1
      ? `This will delete ${formatDeleteImpactSummary(
          pendingDeleteImpact,
        )}. Any included tailored resume preview PDF will be removed too. This action can't be undone.`
      : pendingDashboardDelete?.kind === "application"
        ? "This will delete the saved application. This action can't be undone."
        : "This removes the saved tailored resume and its PDF preview from History. This action can't be undone.";
  const pendingDeleteActionLabel =
    pendingDeleteImpact && pendingDeleteImpact.totalCount > 1
      ? `Delete ${pendingDeleteImpact.totalCount} items`
      : pendingDashboardDelete?.kind === "application"
        ? "Delete application"
        : "Delete resume";

  useEffect(() => {
    setDashboardRouteState(parseDashboardRouteStateFromSearchParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    setApplicationRecords(applications);
  }, [applications]);

  useEffect(() => {
    setTailorResumeProfileState(tailorResumeProfile);
    setTailoredResumes(tailorResumeProfile.tailoredResumes);
    tailorResumeProfileRefreshKeyRef.current =
      buildTailorResumeProfileRefreshKey(tailorResumeProfile);
  }, [tailorResumeProfile]);

  useEffect(() => {
    setTailorResumeUserMarkdownState(tailorResumeUserMarkdown);
  }, [tailorResumeUserMarkdown]);

  useEffect(() => {
    setActiveTailorings(initialActiveTailorings);
  }, [initialActiveTailorings]);

  useEffect(() => {
    lastSeenSyncStateRef.current = initialSyncState;
  }, [initialSyncState]);

  const applyTailorResumeProfileChange = useCallback((nextProfile: TailorResumeProfile) => {
    setTailorResumeProfileState(nextProfile);
    setTailoredResumes(nextProfile.tailoredResumes);
    tailorResumeProfileRefreshKeyRef.current =
      buildTailorResumeProfileRefreshKey(nextProfile);
  }, []);

  const navigateDashboard = useCallback((nextRouteState: DashboardRouteState) => {
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
  }, [router, searchParams]);

  const setActiveDashboardTab = useCallback((nextTab: DashboardTabId) => {
    setIsMobileMenuOpen(false);
    navigateDashboard({
      tab: nextTab,
      tailoredResumeId: null,
    });
  }, [navigateDashboard]);

  const openTailoredResumeReview = useCallback((tailoredResumeId: string) => {
    navigateDashboard({
      tab: "saved",
      tailoredResumeId,
    });
  }, [navigateDashboard]);

  const closeTailoredResumeReview = useCallback(() => {
    navigateDashboard({
      tab: "saved",
      tailoredResumeId: null,
    });
  }, [navigateDashboard]);

  const refreshDashboardApplications = useCallback(async () => {
    const response = await fetch("/api/job-applications?limit=all&includeArchived=1", {
      cache: "no-store",
    });
    const payload = (await response.json()) as DashboardApplicationsResponse;

    if (!response.ok || !Array.isArray(payload.applications)) {
      throw new Error(payload.error ?? "Unable to refresh applications.");
    }

    setApplicationRecords(payload.applications);
  }, []);

  const refreshDashboardTailorResume = useCallback(async () => {
    const response = await fetch("/api/tailor-resume", {
      cache: "no-store",
    });
    const payload = (await response.json()) as DashboardTailorResumeResponse;

    if (!response.ok || !payload.profile) {
      throw new Error(payload.error ?? "Unable to refresh tailored resumes.");
    }

    setActiveTailorings(readTailorResumeExistingTailoringStates(payload));

    const nextProfileRefreshKey = buildTailorResumeProfileRefreshKey(
      payload.profile,
    );

    if (nextProfileRefreshKey !== tailorResumeProfileRefreshKeyRef.current) {
      applyTailorResumeProfileChange(payload.profile);
    }

    if (
      reviewingTailoredResumeId &&
      !payload.profile.tailoredResumes.some(
        (tailoredResume) => tailoredResume.id === reviewingTailoredResumeId,
      )
    ) {
      closeTailoredResumeReview();
    }
  }, [
    applyTailorResumeProfileChange,
    closeTailoredResumeReview,
    reviewingTailoredResumeId,
  ]);

  const refreshDashboardFromSyncState = useCallback(async (
    nextSyncState: UserSyncStateSnapshot,
  ) => {
    const previousSyncState = lastSeenSyncStateRef.current;

    const shouldRefreshApplications =
      previousSyncState.applicationsVersion !== nextSyncState.applicationsVersion;
    const shouldRefreshTailoring =
      previousSyncState.tailoringVersion !== nextSyncState.tailoringVersion;

    await Promise.all([
      shouldRefreshApplications ? refreshDashboardApplications() : Promise.resolve(),
      shouldRefreshTailoring ? refreshDashboardTailorResume() : Promise.resolve(),
    ]);

    lastSeenSyncStateRef.current = nextSyncState;
  }, [refreshDashboardApplications, refreshDashboardTailorResume]);

  const handleSetTailoredResumeArchivedState = useCallback(async (
    tailoredResumeId: string,
    archived: boolean,
  ) => {
    setTailoredResumeArchiveActionId(tailoredResumeId);

    try {
      const response = await fetch("/api/tailor-resume", {
        body: JSON.stringify({
          action: "setTailoredResumeArchivedState",
          archived,
          tailoredResumeId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json()) as DashboardTailorResumeResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(
          payload.error ??
            (archived
              ? "Unable to archive the tailored resume."
              : "Unable to restore the tailored resume."),
        );
      }

      applyTailorResumeProfileChange(payload.profile);
      toast.success(archived ? "Moved resume to Archived." : "Restored resume.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : archived
            ? "Unable to archive the tailored resume."
            : "Unable to restore the tailored resume.",
      );
    } finally {
      setTailoredResumeArchiveActionId(null);
    }
  }, [applyTailorResumeProfileChange]);

  const handleSetApplicationArchivedState = useCallback(async (
    applicationId: string,
    archived: boolean,
  ) => {
    setApplicationArchiveActionId(applicationId);

    try {
      const response = await fetch(
        `/api/job-applications/${encodeURIComponent(applicationId)}`,
        {
          body: JSON.stringify({
            action: "setArchivedState",
            archived,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        },
      );
      const payload = (await response.json()) as DashboardApplicationMutationResponse;

      if (!response.ok || !payload.application) {
        throw new Error(
          payload.error ??
            (archived
              ? "Unable to archive the application."
              : "Unable to restore the application."),
        );
      }

      setApplicationRecords((currentApplications) =>
        currentApplications.map((application) =>
          application.id === payload.application?.id
            ? payload.application
            : application,
        ),
      );
      toast.success(
        archived ? "Moved application to Archived." : "Restored application.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : archived
            ? "Unable to archive the application."
            : "Unable to restore the application.",
      );
    } finally {
      setApplicationArchiveActionId(null);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function refreshFromSyncState() {
      if (
        isCancelled ||
        document.visibilityState !== "visible" ||
        isSyncStateCheckInFlightRef.current ||
        isSyncRefreshInFlightRef.current
      ) {
        return;
      }

      isSyncStateCheckInFlightRef.current = true;

      try {
        const response = await fetch("/api/sync-state", {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            (typeof payload?.error === "string" && payload.error) ||
              "Unable to refresh sync state.",
          );
        }

        const nextSyncState = readUserSyncStateSnapshot(payload);
        const previousSyncState = lastSeenSyncStateRef.current;

        if (!haveUserSyncStateChanged(previousSyncState, nextSyncState)) {
          return;
        }

        isSyncRefreshInFlightRef.current = true;

        try {
          await refreshDashboardFromSyncState(nextSyncState);
        } finally {
          isSyncRefreshInFlightRef.current = false;
        }
      } catch (error) {
        console.error("Could not refresh dashboard sync state.", error);
      } finally {
        isSyncStateCheckInFlightRef.current = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshFromSyncState();
      }
    }

    void refreshFromSyncState();
    const intervalId = window.setInterval(() => {
      void refreshFromSyncState();
    }, 1000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshDashboardFromSyncState]);

  useEffect(() => {
    if (!pendingDashboardDelete) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingDashboardItem) {
        setPendingDashboardDelete(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeletingDashboardItem, pendingDashboardDelete]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  async function deletePendingDashboardItem() {
    if (!pendingDashboardDelete || !pendingDeleteImpact) {
      return;
    }

    const currentDelete = pendingDashboardDelete;
    const currentImpact = pendingDeleteImpact;
    setIsDeletingDashboardItem(true);

    try {
      const response =
        currentDelete.kind === "application"
          ? await fetch(`/api/job-applications/${currentDelete.applicationId}`, {
              method: "DELETE",
            })
          : await fetch("/api/tailor-resume", {
              body: JSON.stringify({
                action: "deleteTailoredResume",
                tailoredResumeId: currentDelete.tailoredResumeId,
              }),
              headers: {
                "Content-Type": "application/json",
              },
              method: "PATCH",
            });
      const payload = (await response.json()) as DashboardDeleteMutationResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(
          payload.error ??
            (currentDelete.kind === "application"
              ? "Unable to delete the application."
              : "Unable to delete the tailored resume."),
        );
      }

      applyTailorResumeProfileChange(payload.profile);
      setApplicationRecords((currentApplications) => {
        return currentApplications.filter(
          (application) => !currentImpact.applicationIds.includes(application.id),
        );
      });
      setPendingDashboardDelete(null);

      if (
        reviewingTailoredResumeId &&
        currentImpact.tailoredResumeIds.includes(reviewingTailoredResumeId)
      ) {
        closeTailoredResumeReview();
      }

      toast.success(
        `Deleted ${formatDeleteImpactSummary(
          payload.deleteImpact ?? currentImpact,
        )}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : pendingDashboardDelete.kind === "application"
            ? "Unable to delete the application."
            : "Unable to delete the tailored resume.",
      );
    } finally {
      setIsDeletingDashboardItem(false);
    }
  }

  const configWorkspacePane = (
    <div className="flex flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
      <UserMarkdownCard
        initialUserMarkdown={tailorResumeUserMarkdownState}
        onUserMarkdownChange={setTailorResumeUserMarkdownState}
      />
      <TailorResumeWorkspace
        debugUiEnabled={tailorResumeDebugUiEnabled}
        openAIReady={tailorResumeOpenAIReady}
        initialProfile={tailorResumeProfileState}
        onTailoredResumesChange={setTailoredResumes}
        sourceOnly
      />
    </div>
  );

  const renderTailoredResumeHistoryRows = (
    historyResumes: TailoredResumeRecord[],
    options: {
      archived: boolean;
    },
  ) => {
    if (historyResumes.length === 0) {
      return null;
    }

    return (
        <div className="tailor-history-list grid gap-2">
        {historyResumes.map((tailoredResume) => {
          const isArchiveActionPending =
            tailoredResumeArchiveActionId === tailoredResume.id;
          const generationFailureLabel =
            getTailoredResumeGenerationFailureLabel(tailoredResume);
          const hasGenerationFailure = hasTailoredResumeGenerationFailure(
            tailoredResume,
          );

          return (
            <div
              key={tailoredResume.id}
              className={`tailor-history-row group relative flex items-center justify-between gap-3 overflow-hidden rounded-[1rem] border transition focus-within:border-emerald-300/45 ${
                hasGenerationFailure
                  ? "border-rose-300/18 bg-[linear-gradient(180deg,rgba(251,113,133,0.14),rgba(127,29,29,0.16))] hover:border-rose-300/32 hover:bg-[linear-gradient(180deg,rgba(251,113,133,0.18),rgba(127,29,29,0.2))] focus-within:border-rose-300/36"
                  : "border-white/8 bg-black/20 hover:border-emerald-400/25 hover:bg-emerald-400/6"
              }`}
            >
              <button
                className="tailor-history-row-open min-w-0 flex-1 overflow-hidden px-3 py-2.5 text-left focus-visible:outline-none"
                onClick={() => openTailoredResumeReview(tailoredResume.id)}
                type="button"
              >
                <div className="min-w-0 overflow-hidden">
                  <p
                    className={`tailor-history-title truncate text-sm font-medium ${
                      hasGenerationFailure ? "text-rose-50" : "text-zinc-100"
                    }`}
                    title={tailoredResume.displayName}
                  >
                    {formatTailoredResumeSidebarName(tailoredResume)}
                  </p>
                  <div className="tailor-history-meta mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p
                      className={`tailor-history-company min-w-0 flex-1 truncate text-sm ${
                        hasGenerationFailure ? "text-rose-100/85" : "text-zinc-400"
                      }`}
                    >
                      {tailoredResume.companyName}
                    </p>
                    {generationFailureLabel ? (
                      <span className="rounded-full border border-rose-300/22 bg-rose-400/12 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-rose-100">
                        {generationFailureLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>

              <div className="flex shrink-0 items-center gap-2 px-2 py-2">
                <span
                  className={`tailor-history-date text-center text-xs ${
                    hasGenerationFailure ? "text-rose-100/75" : "text-zinc-500"
                  }`}
                >
                  {formatCompactDateOrSameDayTime(tailoredResume.updatedAt, {
                    includeYear: includeYearInTailoredResumeDates,
                  })}
                </span>
                <button
                  className={historyActionButtonClassName}
                  disabled={isDeletingDashboardItem || isArchiveActionPending}
                  onClick={() =>
                    void handleSetTailoredResumeArchivedState(
                      tailoredResume.id,
                      !options.archived,
                    )
                  }
                  type="button"
                >
                  {isArchiveActionPending
                    ? options.archived
                      ? "Restoring..."
                      : "Archiving..."
                    : options.archived
                      ? "Restore"
                      : "Archive"}
                </button>
                <button
                  aria-label={`Delete ${tailoredResume.displayName}`}
                  className={historyDeleteButtonClassName}
                  disabled={isDeletingDashboardItem || isArchiveActionPending}
                  onClick={() =>
                    setPendingDashboardDelete({
                      kind: "tailoredResume",
                      tailoredResumeId: tailoredResume.id,
                    })
                  }
                  title="Delete tailored resume"
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderApplicationHistoryRows = (
    historyApplications: JobApplicationRecord[],
    options: {
      archived: boolean;
    },
  ) => {
    if (historyApplications.length === 0) {
      return null;
    }

    return (
      <div className="tailor-history-list grid gap-2">
        {historyApplications.map((application) => {
          const applicationDisplay = buildJobApplicationDisplayParts({
            companyName: application.companyName,
            jobTitle: application.jobTitle,
          });
          const isArchiveActionPending =
            applicationArchiveActionId === application.id;

          return (
            <div
              className="tailor-history-row group relative flex items-center justify-between gap-3 overflow-hidden rounded-[1rem] border border-white/8 bg-black/20 transition hover:border-emerald-400/25 hover:bg-emerald-400/6 focus-within:border-emerald-300/45"
              key={application.id}
            >
              <a
                className="tailor-history-row-open min-w-0 flex-1 overflow-hidden px-3 py-2.5 text-left focus-visible:outline-none"
                href={application.jobUrl || undefined}
                onClick={(event) => {
                  if (!application.jobUrl) {
                    event.preventDefault();
                  }
                }}
                rel="noreferrer"
                target={application.jobUrl ? "_blank" : undefined}
              >
                <div className="min-w-0 overflow-hidden">
                  <p
                    className="tailor-history-title truncate text-sm font-medium text-zinc-100"
                    title={applicationDisplay.companyName}
                  >
                    {applicationDisplay.companyName}
                  </p>
                  <div className="tailor-history-meta mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="tailor-history-company min-w-0 flex-1 truncate text-sm text-zinc-400">
                      {applicationDisplay.positionName}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-400">
                      {formatApplicationStatus(application.status)}
                    </span>
                  </div>
                </div>
              </a>

              <div className="flex shrink-0 items-center gap-2 px-2 py-2">
                <span className="tailor-history-date text-center text-xs text-zinc-500">
                  {formatCompactDate(application.appliedAt, includeYearInApplicationDates)}
                </span>
                <button
                  className={historyActionButtonClassName}
                  disabled={isDeletingDashboardItem || isArchiveActionPending}
                  onClick={() =>
                    void handleSetApplicationArchivedState(
                      application.id,
                      !options.archived,
                    )
                  }
                  type="button"
                >
                  {isArchiveActionPending
                    ? options.archived
                      ? "Restoring..."
                      : "Archiving..."
                    : options.archived
                      ? "Restore"
                      : "Archive"}
                </button>
                <button
                  aria-label={`Delete ${application.jobTitle} at ${application.companyName}`}
                  className={historyDeleteButtonClassName}
                  disabled={isDeletingDashboardItem || isArchiveActionPending}
                  onClick={() =>
                    setPendingDashboardDelete({
                      applicationId: application.id,
                      kind: "application",
                    })
                  }
                  title="Delete application"
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const resumeHistoryRows =
    resumeArchiveView === "archived"
      ? archivedTailoredResumes
      : unarchivedTailoredResumes;
  const applicationHistoryRows =
    applicationArchiveView === "archived"
      ? archivedApplications
      : unarchivedApplications;

  const savedWorkspacePane = (
    <div className="tailor-history-shell h-full overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
      <div className="grid gap-[clamp(0.75rem,1.2vh,1rem)] xl:grid-cols-2">
        <section className="tailor-history-panel glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="tailor-history-header mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="tailor-history-heading text-xs uppercase tracking-[0.24em] text-zinc-500">
                Resumes
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Saved resumes
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div
                aria-label="Resume archive view"
                className={historySegmentControlClassName}
                role="group"
              >
                <button
                  aria-pressed={resumeArchiveView === "unarchived"}
                  className={`${historySegmentButtonClassName} ${
                    resumeArchiveView === "unarchived"
                      ? "bg-emerald-400/16 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                  onClick={() => setResumeArchiveView("unarchived")}
                  type="button"
                >
                  Unarchived
                  <span className="ml-2 text-zinc-500">
                    {unarchivedTailoredResumes.length}
                  </span>
                </button>
                <button
                  aria-pressed={resumeArchiveView === "archived"}
                  className={`${historySegmentButtonClassName} ${
                    resumeArchiveView === "archived"
                      ? "bg-emerald-400/16 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                  onClick={() => setResumeArchiveView("archived")}
                  type="button"
                >
                  Archived
                  <span className="ml-2 text-zinc-500">
                    {archivedTailoredResumes.length}
                  </span>
                </button>
              </div>
              {activeTailorings.length > 0 && resumeArchiveView === "unarchived" ? (
                <span className="tailor-history-count shrink-0 whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                  {activeTailorings.length} active
                </span>
              ) : null}
              <span className="tailor-history-count shrink-0 whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                {resumeHistoryRows.length} resumes
              </span>
            </div>
          </div>

          {resumeArchiveView === "unarchived" ? (
            activeTailorings.length === 0 && resumeHistoryRows.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No unarchived tailored resumes yet.
              </p>
            ) : (
              <div className="grid gap-3">
                <TailorResumeActiveRuns activeTailorings={activeTailorings} embedded />
                {renderTailoredResumeHistoryRows(resumeHistoryRows, {
                  archived: false,
                })}
              </div>
            )
          ) : resumeHistoryRows.length === 0 ? (
            <p className="text-sm text-zinc-400">No archived tailored resumes yet.</p>
          ) : (
            renderTailoredResumeHistoryRows(resumeHistoryRows, {
              archived: true,
            })
          )}
        </section>

        <section className="tailor-history-panel glass-panel soft-ring rounded-[1.5rem] p-4 sm:p-5">
          <div className="tailor-history-header mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="tailor-history-heading text-xs uppercase tracking-[0.24em] text-zinc-500">
                Applications
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
                Saved applications
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div
                aria-label="Application archive view"
                className={historySegmentControlClassName}
                role="group"
              >
                <button
                  aria-pressed={applicationArchiveView === "unarchived"}
                  className={`${historySegmentButtonClassName} ${
                    applicationArchiveView === "unarchived"
                      ? "bg-emerald-400/16 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                  onClick={() => setApplicationArchiveView("unarchived")}
                  type="button"
                >
                  Unarchived
                  <span className="ml-2 text-zinc-500">
                    {unarchivedApplications.length}
                  </span>
                </button>
                <button
                  aria-pressed={applicationArchiveView === "archived"}
                  className={`${historySegmentButtonClassName} ${
                    applicationArchiveView === "archived"
                      ? "bg-emerald-400/16 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                  onClick={() => setApplicationArchiveView("archived")}
                  type="button"
                >
                  Archived
                  <span className="ml-2 text-zinc-500">
                    {archivedApplications.length}
                  </span>
                </button>
              </div>
              <span className="tailor-history-count shrink-0 whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
                {applicationHistoryRows.length} apps
              </span>
            </div>
          </div>

          {applicationHistoryRows.length === 0 ? (
            <p className="text-sm text-zinc-400">
              {applicationArchiveView === "archived"
                ? "No archived applications yet."
                : "No unarchived applications yet."}
            </p>
          ) : (
            renderApplicationHistoryRows(applicationHistoryRows, {
              archived: applicationArchiveView === "archived",
            })
          )}
        </section>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-0">
      <StatusToast
        message={statusMessage?.text}
        tone={statusMessage?.tone}
      />

      <header className="dashboard-header glass-panel soft-ring flex flex-col gap-3 rounded-[1.5rem] px-4 py-4 sm:min-h-[88px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-start">
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

          <button
            aria-controls="dashboard-mobile-menu"
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? "Close dashboard menu" : "Open dashboard menu"}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30 sm:hidden"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
            type="button"
          >
            {isMobileMenuOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>

        <div className="hidden w-full flex-col gap-3 sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
          <nav className="grid w-full grid-cols-3 items-center gap-2 rounded-[1.4rem] border border-white/10 bg-black/20 p-1 sm:flex sm:w-auto sm:rounded-full">
            {dashboardTabs.map((tab) => (
              <button
                key={tab.id}
                className={`w-full min-w-0 whitespace-nowrap rounded-full px-2.5 py-2 text-center text-[0.7rem] uppercase leading-none tracking-[0.14em] transition sm:w-auto sm:px-3 sm:text-xs sm:tracking-[0.16em] ${
                  activeTab === tab.id
                    ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setActiveDashboardTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <SignOutButton className="w-full sm:w-auto" />
        </div>

      </header>

      {typeof document !== "undefined" && isMobileMenuOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[210] bg-black/64 backdrop-blur-sm sm:hidden"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsMobileMenuOpen(false);
                }
              }}
            >
              <div
                aria-modal="true"
                className="absolute inset-x-0 top-0 rounded-b-[1.75rem] border-b border-white/10 bg-zinc-950/96 px-5 pb-5 pt-[max(1rem,env(safe-area-inset-top))] shadow-[0_24px_90px_rgba(0,0,0,0.5)]"
                id="dashboard-mobile-menu"
                role="dialog"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                      Menu
                    </p>
                    <p className="mt-1 truncate text-lg font-semibold text-zinc-50">
                      {displayName}
                    </p>
                  </div>
                  <button
                    aria-label="Close dashboard menu"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30"
                    onClick={() => setIsMobileMenuOpen(false)}
                    type="button"
                  >
                    <X aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>

                <nav className="mt-5 grid gap-1">
                  {dashboardTabs.map((tab) => (
                    <button
                      key={tab.id}
                      aria-current={activeTab === tab.id ? "page" : undefined}
                      className={`flex min-h-12 items-center rounded-[0.95rem] px-1 text-left text-base font-medium transition ${
                        activeTab === tab.id
                          ? "text-emerald-200"
                          : "text-zinc-300 hover:text-zinc-100"
                      }`}
                      onClick={() => setActiveDashboardTab(tab.id)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <SignOutButton className="w-full justify-center" />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <TailoredResumeReviewModal
        debugUiEnabled={tailorResumeDebugUiEnabled}
        key={reviewingTailoredResume?.id ?? "closed"}
        onClose={closeTailoredResumeReview}
        onTailorResumeProfileChange={applyTailorResumeProfileChange}
        onTailoredResumesChange={setTailoredResumes}
        record={reviewingTailoredResume}
      />
      {typeof document !== "undefined" && pendingDashboardDelete
        ? createPortal(
            <div
              className="fixed inset-0 z-[220] flex items-center justify-center bg-black/58 p-4 backdrop-blur-sm"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setPendingDashboardDelete(null);
                }
              }}
            >
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
                      {pendingDeleteEyebrow}
                    </p>
                    <h2
                      className="mt-3 text-[1.35rem] font-semibold tracking-tight text-zinc-50"
                      id="delete-tailored-resume-title"
                    >
                      {pendingDeleteTitle}
                    </h2>
                    <p
                      className="mt-3 max-w-md text-sm leading-6 text-zinc-400"
                      id="delete-tailored-resume-description"
                    >
                      {pendingDeleteDescription}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-white/10 bg-black/20 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-5">
                  <button
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isDeletingDashboardItem}
                    onClick={() => setPendingDashboardDelete(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-full border border-rose-300/18 bg-[linear-gradient(180deg,rgba(251,113,133,0.16),rgba(159,18,57,0.24))] px-4 py-2.5 text-sm font-medium text-rose-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-[linear-gradient(180deg,rgba(251,113,133,0.2),rgba(159,18,57,0.28))] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isDeletingDashboardItem}
                    onClick={() => void deletePendingDashboardItem()}
                    type="button"
                  >
                    {isDeletingDashboardItem ? "Deleting..." : pendingDeleteActionLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <div className="flex-1 overflow-visible sm:min-h-0 sm:overflow-hidden">
        {activeTab === "config" ? (
          <section className="sm:app-scrollbar sm:h-full sm:min-h-0 sm:overflow-y-auto sm:pr-1">{configWorkspacePane}</section>
        ) : activeTab === "saved" ? (
          <section className="sm:h-full sm:min-h-0">{savedWorkspacePane}</section>
        ) : (
          <section className="sm:h-full sm:min-h-0 xl:w-[72%]">
            <div className="h-full overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto">
              <PromptSettingsWorkspace
                defaultPromptValues={defaultPromptSettings}
                initialGenerationSettings={tailorResumeProfileState.generationSettings}
                initialPromptSettings={tailorResumeProfileState.promptSettings}
                tailoredResumes={tailoredResumes}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
