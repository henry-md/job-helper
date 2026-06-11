"use client";

import { useEffect, useRef, useState } from "react";
import SignOutButton from "@/components/sign-out-button";
import StatusToast from "@/components/status-toast";
import TailorResumeWorkspace from "@/components/tailor-resume-workspace";
import UserMarkdownCard, {
  NonTechnologyNamesCard,
  SpareBulletsCard,
} from "@/components/user-markdown-card";
import {
  haveUserSyncStateChanged,
  readUserSyncStateSnapshot,
  type UserSyncStateSnapshot,
} from "@/lib/sync-state";
import type {
  TailorResumeProfile,
  TailorResumeStoredSkillData,
} from "@/lib/tailor-resume-types";
import type { TailorResumeUserMemoryState } from "@/lib/tailor-resume-user-memory";

type DashboardTailorResumeResponse = {
  error?: string;
  profile?: TailorResumeProfile;
  skillData?: TailorResumeStoredSkillData | null;
};

function buildTailorResumeProfileRefreshKey(profile: TailorResumeProfile) {
  return [
    profile.resume?.updatedAt ?? "",
    profile.extraction.updatedAt ?? "",
    profile.latex.updatedAt ?? "",
    profile.annotatedLatex.updatedAt ?? "",
    profile.jobDescription,
    profile.workspace.updatedAt ?? "",
    profile.workspace.isBaseResumeStepComplete ? "1" : "0",
    profile.generationSettings.updatedAt ?? "",
    profile.promptSettings.updatedAt ?? "",
  ].join("::");
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
  initialSyncState,
  statusMessage,
  tailorResumeDebugUiEnabled,
  tailorResumeOpenAIReady,
  tailorResumeProfile,
  tailorResumeSkillData,
  tailorResumeUserMemory,
  userImage,
  userName,
}: {
  initialSyncState: UserSyncStateSnapshot;
  statusMessage?: {
    text: string;
    tone: "error" | "success";
  } | null;
  tailorResumeDebugUiEnabled: boolean;
  tailorResumeOpenAIReady: boolean;
  tailorResumeProfile: TailorResumeProfile;
  tailorResumeSkillData: TailorResumeStoredSkillData;
  tailorResumeUserMemory: TailorResumeUserMemoryState;
  userImage: string | null | undefined;
  userName: string | null | undefined;
}) {
  const [tailorResumeProfileState, setTailorResumeProfileState] =
    useState<TailorResumeProfile>(() => tailorResumeProfile);
  const [tailorResumeUserMemoryState, setTailorResumeUserMemoryState] =
    useState<TailorResumeUserMemoryState>(() => tailorResumeUserMemory);
  const [tailorResumeSkillDataState, setTailorResumeSkillDataState] =
    useState<TailorResumeStoredSkillData>(() => tailorResumeSkillData);
  const lastSeenSyncStateRef = useRef<UserSyncStateSnapshot>(initialSyncState);
  const tailorResumeProfileRefreshKeyRef = useRef(
    buildTailorResumeProfileRefreshKey(tailorResumeProfile),
  );
  const isSyncStateCheckInFlightRef = useRef(false);
  const isSyncRefreshInFlightRef = useRef(false);
  const displayName = userName?.trim()?.split(" ")[0] || userName || "there";
  const profileImageSrc = getValidProfileImageSrc(userImage);

  useEffect(() => {
    setTailorResumeProfileState(tailorResumeProfile);
    tailorResumeProfileRefreshKeyRef.current =
      buildTailorResumeProfileRefreshKey(tailorResumeProfile);
  }, [tailorResumeProfile]);

  useEffect(() => {
    setTailorResumeUserMemoryState(tailorResumeUserMemory);
  }, [tailorResumeUserMemory]);

  useEffect(() => {
    setTailorResumeSkillDataState(tailorResumeSkillData);
  }, [tailorResumeSkillData]);

  useEffect(() => {
    lastSeenSyncStateRef.current = initialSyncState;
  }, [initialSyncState]);

  function applyTailorResumeProfileChange(nextProfile: TailorResumeProfile) {
    setTailorResumeProfileState(nextProfile);
    tailorResumeProfileRefreshKeyRef.current =
      buildTailorResumeProfileRefreshKey(nextProfile);
  }

  function applyTailoredResumesChange(
    tailoredResumes: TailorResumeProfile["tailoredResumes"],
  ) {
    setTailorResumeProfileState((currentProfile) => {
      const nextProfile = {
        ...currentProfile,
        tailoredResumes,
      };
      tailorResumeProfileRefreshKeyRef.current =
        buildTailorResumeProfileRefreshKey(nextProfile);
      return nextProfile;
    });
  }

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
          if (previousSyncState.tailoringVersion !== nextSyncState.tailoringVersion) {
            const tailorResponse = await fetch("/api/tailor-resume", {
              cache: "no-store",
            });
            const tailorPayload =
              (await tailorResponse.json()) as DashboardTailorResumeResponse;

            if (!tailorResponse.ok || !tailorPayload.profile) {
              throw new Error(
                tailorPayload.error ?? "Unable to refresh the source resume.",
              );
            }

            const nextProfileRefreshKey = buildTailorResumeProfileRefreshKey(
              tailorPayload.profile,
            );

            if (
              nextProfileRefreshKey !== tailorResumeProfileRefreshKeyRef.current
            ) {
              applyTailorResumeProfileChange(tailorPayload.profile);
            }

            if (tailorPayload.skillData) {
              setTailorResumeSkillDataState(tailorPayload.skillData);
            }
          }

          lastSeenSyncStateRef.current = nextSyncState;
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
  }, []);

  return (
    <div className="flex min-h-0 flex-col gap-[clamp(0.75rem,1.2vh,1rem)] sm:h-full sm:min-h-0">
      <StatusToast
        message={statusMessage?.text}
        tone={statusMessage?.tone}
      />

      <header className="dashboard-header glass-panel soft-ring flex flex-col gap-3 rounded-[1.5rem] px-4 py-4 sm:min-h-[88px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar
            imageSrc={profileImageSrc}
            name={userName ?? "Profile"}
          />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              Config
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
              {displayName}
            </h1>
          </div>
        </div>

        <SignOutButton className="w-full sm:w-auto" />
      </header>

      <section className="flex-1 overflow-visible sm:app-scrollbar sm:min-h-0 sm:overflow-y-auto sm:pr-1">
        <div className="flex flex-col gap-[clamp(0.75rem,1.2vh,1rem)]">
          <TailorResumeWorkspace
            debugUiEnabled={tailorResumeDebugUiEnabled}
            openAIReady={tailorResumeOpenAIReady}
            initialProfile={tailorResumeProfileState}
            onTailoredResumesChange={applyTailoredResumesChange}
            onUserMemoryChange={setTailorResumeUserMemoryState}
            sourceOnly
          />
          <UserMarkdownCard
            initialUserMemory={tailorResumeUserMemoryState}
            onUserMemoryChange={setTailorResumeUserMemoryState}
          />
          <SpareBulletsCard
            initialSkillData={tailorResumeSkillDataState}
            onSkillDataChange={setTailorResumeSkillDataState}
            onTailorResumeProfileChange={applyTailorResumeProfileChange}
          />
          <NonTechnologyNamesCard
            initialUserMemory={tailorResumeUserMemoryState}
            onUserMemoryChange={setTailorResumeUserMemoryState}
          />
        </div>
      </section>
    </div>
  );
}
