import type {
  PersonalInfoSummary,
  TailorResumeExistingTailoringState,
} from "./job-helper";
import { normalizeComparableUrl } from "./comparable-job-url";

const optimisticMutationStoreVersion = 1;
const optimisticMutationTtlMs = 120_000;

type OptimisticMutationBase = {
  createdAt: string;
  expiresAt: string;
  id: string;
  key: string;
  sequence: number;
  status: "pending";
};

export type SetStarredOptimisticMutation = OptimisticMutationBase & {
  action: "setStarred";
  target: {
    applicationId: string | null;
    tailoredResumeId: string | null;
  };
  patch: {
    starred: boolean;
  };
};

export type SetArchivedOptimisticMutation = OptimisticMutationBase & {
  action: "setArchived";
  target: {
    tailoredResumeIds: string[];
  };
  patch: {
    archived: boolean;
    archivedAt: string;
  };
};

export type DeleteTailoredResumesOptimisticMutation = OptimisticMutationBase & {
  action: "deleteTailoredResumes";
  target: {
    applicationIds: string[];
    jobUrls: string[];
    tailoredResumeIds: string[];
    tailorRunIds: string[];
  };
};

export type RetryTailorRunOptimisticMutation = OptimisticMutationBase & {
  action: "retryTailorRun" | "startTailorRun";
  target: {
    jobUrl: string | null;
    pageKey: string | null;
    suppressTailoredResumeIds: string[];
    tailorRunId: string | null;
  };
  patch: {
    activeTailoring: TailorResumeExistingTailoringState;
  };
};

export type OptimisticMutation =
  | DeleteTailoredResumesOptimisticMutation
  | RetryTailorRunOptimisticMutation
  | SetArchivedOptimisticMutation
  | SetStarredOptimisticMutation;

export type OptimisticMutationStore = {
  mutationsByKey: Record<string, OptimisticMutation>;
  sequence: number;
  updatedAt: string | null;
  version: 1;
};

export type OptimisticMutationDraft =
  | {
      action: "setStarred";
      applicationId?: string | null;
      starred: boolean;
      tailoredResumeId?: string | null;
    }
  | {
      action: "setArchived";
      archived: boolean;
      tailoredResumeIds: string[];
    }
  | {
      action: "deleteTailoredResumes";
      applicationIds?: string[];
      jobUrls?: string[];
      tailoredResumeIds?: string[];
      tailorRunIds?: string[];
    }
  | {
      action: "retryTailorRun" | "startTailorRun";
      activeTailoring: TailorResumeExistingTailoringState;
      jobUrl?: string | null;
      pageKey?: string | null;
      suppressTailoredResumeIds?: string[];
      tailorRunId?: string | null;
    };

export const emptyOptimisticMutationStore: OptimisticMutationStore = {
  mutationsByKey: {},
  sequence: 0,
  updatedAt: null,
  version: optimisticMutationStoreVersion,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringOrNull(value: unknown) {
  const text = readString(value);
  return text || null;
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map(readString).filter((item) => item.length > 0)
    : [];
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readPendingStatus(value: unknown): "pending" | null {
  return value === "pending" ? "pending" : null;
}

function isExpired(expiresAt: string, nowTime = Date.now()) {
  const expiresAtTime = Date.parse(expiresAt);
  return Number.isFinite(expiresAtTime) && expiresAtTime <= nowTime;
}

function readMutationBase(
  value: Record<string, unknown>,
): OptimisticMutationBase | null {
  const createdAt = readString(value.createdAt);
  const expiresAt = readString(value.expiresAt);
  const id = readString(value.id);
  const key = readString(value.key);
  const sequence = readNumber(value.sequence);
  const status = readPendingStatus(value.status);

  if (!createdAt || !expiresAt || !id || !key || !status || sequence <= 0) {
    return null;
  }

  return {
    createdAt,
    expiresAt,
    id,
    key,
    sequence,
    status,
  };
}

function readOptimisticMutation(value: unknown): OptimisticMutation | null {
  if (!isRecord(value)) {
    return null;
  }

  const base = readMutationBase(value);
  const action = readString(value.action);
  const target = isRecord(value.target) ? value.target : {};
  const patch = isRecord(value.patch) ? value.patch : {};

  if (!base) {
    return null;
  }

  if (action === "setStarred") {
    const starred = typeof patch.starred === "boolean" ? patch.starred : null;

    if (starred === null) {
      return null;
    }

    return {
      ...base,
      action,
      patch: {
        starred,
      },
      target: {
        applicationId: readStringOrNull(target.applicationId),
        tailoredResumeId: readStringOrNull(target.tailoredResumeId),
      },
    };
  }

  if (action === "setArchived") {
    const archived = typeof patch.archived === "boolean" ? patch.archived : null;
    const archivedAt = readString(patch.archivedAt);
    const tailoredResumeIds = readStringList(target.tailoredResumeIds);

    if (archived === null || tailoredResumeIds.length === 0) {
      return null;
    }

    return {
      ...base,
      action,
      patch: {
        archived,
        archivedAt,
      },
      target: {
        tailoredResumeIds,
      },
    };
  }

  if (action === "deleteTailoredResumes") {
    return {
      ...base,
      action,
      target: {
        applicationIds: readStringList(target.applicationIds),
        jobUrls: readStringList(target.jobUrls),
        tailoredResumeIds: readStringList(target.tailoredResumeIds),
        tailorRunIds: readStringList(target.tailorRunIds),
      },
    };
  }

  if (action === "retryTailorRun" || action === "startTailorRun") {
    const activeTailoring = patch.activeTailoring;

    if (!isRecord(activeTailoring)) {
      return null;
    }

    return {
      ...base,
      action,
      patch: {
        activeTailoring: activeTailoring as TailorResumeExistingTailoringState,
      },
      target: {
        jobUrl: readStringOrNull(target.jobUrl),
        pageKey: readStringOrNull(target.pageKey),
        suppressTailoredResumeIds: readStringList(target.suppressTailoredResumeIds),
        tailorRunId: readStringOrNull(target.tailorRunId),
      },
    };
  }

  return null;
}

export function pruneOptimisticMutationStore(
  store: OptimisticMutationStore,
  nowTime = Date.now(),
): OptimisticMutationStore {
  const mutationsByKey = Object.fromEntries(
    Object.entries(store.mutationsByKey).filter(
      ([, mutation]) => !isExpired(mutation.expiresAt, nowTime),
    ),
  );

  if (Object.keys(mutationsByKey).length === Object.keys(store.mutationsByKey).length) {
    return store;
  }

  return {
    ...store,
    mutationsByKey,
  };
}

export function readOptimisticMutationStore(
  value: unknown,
): OptimisticMutationStore {
  if (!isRecord(value)) {
    return emptyOptimisticMutationStore;
  }

  const mutationsRecord = isRecord(value.mutationsByKey)
    ? value.mutationsByKey
    : {};
  const mutationsByKey = Object.fromEntries(
    Object.entries(mutationsRecord)
      .map(([key, mutationValue]) => [key, readOptimisticMutation(mutationValue)] as const)
      .filter(
        (entry): entry is readonly [string, OptimisticMutation] =>
          Boolean(entry[1]),
      ),
  );

  return pruneOptimisticMutationStore({
    mutationsByKey,
    sequence: Math.max(
      readNumber(value.sequence),
      ...Object.values(mutationsByKey).map((mutation) => mutation.sequence),
      0,
    ),
    updatedAt: readStringOrNull(value.updatedAt),
    version: optimisticMutationStoreVersion,
  });
}

function readTargetKeyPart(prefix: string, value: string | null | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? `${prefix}:${trimmedValue}` : null;
}

function sameTailoringJobUrl(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function buildOptimisticMutationKey(input: OptimisticMutationDraft) {
  if (input.action === "setStarred") {
    return [
      readTargetKeyPart("tailoredResume", input.tailoredResumeId),
      readTargetKeyPart("application", input.applicationId),
      "starred",
    ]
      .filter((part): part is string => Boolean(part))
      .join(":");
  }

  if (input.action === "setArchived") {
    return `tailoredResumes:${input.tailoredResumeIds
      .map((id) => id.trim())
      .filter(Boolean)
      .sort()
      .join(",")}:archived`;
  }

  if (input.action === "deleteTailoredResumes") {
    return `tailoredResumes:${[
      ...(input.tailoredResumeIds ?? []),
      ...(input.applicationIds ?? []),
      ...(input.tailorRunIds ?? []),
      ...(input.jobUrls ?? []),
    ]
      .map((id) => id.trim())
      .filter(Boolean)
      .sort()
      .join(",")}:delete`;
  }

  return [
    "tailorRun",
    input.pageKey?.trim() || input.jobUrl?.trim() || input.tailorRunId?.trim() || "retry",
    "retry",
  ].join(":");
}

export function buildOptimisticMutation(input: {
  draft: OptimisticMutationDraft;
  now?: Date;
  sequence: number;
}): OptimisticMutation | null {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + optimisticMutationTtlMs).toISOString();
  const key = buildOptimisticMutationKey(input.draft);

  if (!key) {
    return null;
  }

  const base: OptimisticMutationBase = {
    createdAt,
    expiresAt,
    id: `${key}:${input.sequence}`,
    key,
    sequence: input.sequence,
    status: "pending",
  };

  if (input.draft.action === "setStarred") {
    return {
      ...base,
      action: input.draft.action,
      patch: {
        starred: input.draft.starred,
      },
      target: {
        applicationId: input.draft.applicationId?.trim() || null,
        tailoredResumeId: input.draft.tailoredResumeId?.trim() || null,
      },
    };
  }

  if (input.draft.action === "setArchived") {
    const tailoredResumeIds = input.draft.tailoredResumeIds
      .map((id) => id.trim())
      .filter(Boolean);

    if (tailoredResumeIds.length === 0) {
      return null;
    }

    return {
      ...base,
      action: input.draft.action,
      patch: {
        archived: input.draft.archived,
        archivedAt: input.draft.archived ? createdAt : "",
      },
      target: {
        tailoredResumeIds,
      },
    };
  }

  if (input.draft.action === "deleteTailoredResumes") {
    return {
      ...base,
      action: input.draft.action,
      target: {
        applicationIds: input.draft.applicationIds ?? [],
        jobUrls: input.draft.jobUrls ?? [],
        tailoredResumeIds: input.draft.tailoredResumeIds ?? [],
        tailorRunIds: input.draft.tailorRunIds ?? [],
      },
    };
  }

  return {
    ...base,
    action: input.draft.action,
    patch: {
      activeTailoring: input.draft.activeTailoring,
    },
    target: {
      jobUrl: input.draft.jobUrl?.trim() || null,
      pageKey: input.draft.pageKey?.trim() || null,
      suppressTailoredResumeIds: input.draft.suppressTailoredResumeIds ?? [],
      tailorRunId: input.draft.tailorRunId?.trim() || null,
    },
  };
}

export function upsertOptimisticMutation(
  store: OptimisticMutationStore,
  draft: OptimisticMutationDraft,
) {
  const prunedStore = pruneOptimisticMutationStore(store);
  const sequence = prunedStore.sequence + 1;
  const mutation = buildOptimisticMutation({
    draft,
    sequence,
  });

  if (!mutation) {
    return {
      mutation: null,
      store: prunedStore,
    };
  }

  return {
    mutation,
    store: {
      ...prunedStore,
      mutationsByKey: {
        ...prunedStore.mutationsByKey,
        [mutation.key]: mutation,
      },
      sequence,
      updatedAt: mutation.createdAt,
    },
  };
}

export function removeOptimisticMutation(
  store: OptimisticMutationStore,
  mutation: OptimisticMutation | null,
) {
  if (!mutation || store.mutationsByKey[mutation.key]?.id !== mutation.id) {
    return store;
  }

  const mutationsByKey = { ...store.mutationsByKey };
  delete mutationsByKey[mutation.key];

  return {
    ...store,
    mutationsByKey,
    updatedAt: new Date().toISOString(),
  };
}

function activeTailoringMatchesTargets(
  activeTailoring: TailorResumeExistingTailoringState,
  input: {
    applicationIds?: readonly string[];
    jobUrls?: readonly string[];
    tailoredResumeIds?: readonly string[];
    tailorRunIds?: readonly string[];
  },
) {
  return (
    Boolean(activeTailoring.applicationId && input.applicationIds?.includes(activeTailoring.applicationId)) ||
    Boolean(input.tailorRunIds?.includes(activeTailoring.id)) ||
    Boolean(
      activeTailoring.kind === "completed" &&
        input.tailoredResumeIds?.includes(activeTailoring.tailoredResumeId),
    ) ||
    Boolean(
      activeTailoring.jobUrl &&
        input.jobUrls?.some((jobUrl) => sameTailoringJobUrl(activeTailoring.jobUrl, jobUrl)),
    )
  );
}

function tailoringInterviewMatchesTargets(
  tailoringInterview: PersonalInfoSummary["tailoringInterviews"][number],
  input: {
    jobUrls?: readonly string[];
    tailorRunIds?: readonly string[];
  },
) {
  return (
    Boolean(
      tailoringInterview.tailorResumeRunId &&
        input.tailorRunIds?.includes(tailoringInterview.tailorResumeRunId),
    ) ||
    Boolean(
      tailoringInterview.jobUrl &&
        input.jobUrls?.some((jobUrl) =>
          sameTailoringJobUrl(tailoringInterview.jobUrl, jobUrl),
        ),
    )
  );
}

function tailoredResumeMatchesTargets(
  tailoredResume: PersonalInfoSummary["tailoredResumes"][number],
  input: {
    applicationIds?: readonly string[];
    jobUrls?: readonly string[];
    tailoredResumeIds?: readonly string[];
  },
) {
  return (
    Boolean(
      tailoredResume.id && input.tailoredResumeIds?.includes(tailoredResume.id),
    ) ||
    Boolean(
      tailoredResume.applicationId &&
        input.applicationIds?.includes(tailoredResume.applicationId),
    ) ||
    Boolean(
      tailoredResume.jobUrl &&
        input.jobUrls?.some((jobUrl) =>
          sameTailoringJobUrl(tailoredResume.jobUrl, jobUrl),
        ),
    )
  );
}

function readComparableTime(value: string | null | undefined) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function recordMayReflectMutation(input: {
  createdAt?: string | null;
  mutationCreatedAt: string;
  updatedAt?: string | null;
}) {
  const mutationCreatedAt = readComparableTime(input.mutationCreatedAt);
  const recordCreatedAt = readComparableTime(input.createdAt);
  const recordUpdatedAt = readComparableTime(input.updatedAt);
  const recordTime = Math.max(recordCreatedAt ?? 0, recordUpdatedAt ?? 0);

  if (mutationCreatedAt === null || recordTime <= 0) {
    return true;
  }

  return recordTime + 1_000 >= mutationCreatedAt;
}

function activeTailoringSatisfiesRetryMutation(
  activeTailoring: TailorResumeExistingTailoringState,
  mutation: RetryTailorRunOptimisticMutation,
) {
  const activeJobUrl = activeTailoring.jobUrl;
  const mutationJobUrl =
    mutation.target.jobUrl ?? mutation.patch.activeTailoring.jobUrl;
  const mutationApplicationId = mutation.patch.activeTailoring.applicationId;

  const matchesTarget =
    activeTailoring.id === mutation.patch.activeTailoring.id ||
    Boolean(
      mutation.target.tailorRunId &&
        activeTailoring.id === mutation.target.tailorRunId,
    ) ||
    Boolean(
      mutationApplicationId &&
        activeTailoring.applicationId === mutationApplicationId,
    ) ||
    Boolean(
      mutationJobUrl && activeJobUrl && sameTailoringJobUrl(activeJobUrl, mutationJobUrl),
    );

  return (
    matchesTarget &&
    recordMayReflectMutation({
      createdAt: activeTailoring.createdAt,
      mutationCreatedAt: mutation.createdAt,
      updatedAt: activeTailoring.updatedAt,
    })
  );
}

function completedResumeSatisfiesRetryMutation(
  personalInfo: PersonalInfoSummary,
  mutation: RetryTailorRunOptimisticMutation,
) {
  const suppressedTailoredResumeIds = new Set(
    mutation.target.suppressTailoredResumeIds,
  );
  const mutationJobUrl =
    mutation.target.jobUrl ?? mutation.patch.activeTailoring.jobUrl;
  const mutationCreatedAt = readComparableTime(mutation.createdAt);
  const stillHasSuppressedResume = personalInfo.tailoredResumes.some(
    (tailoredResume) => suppressedTailoredResumeIds.has(tailoredResume.id),
  );

  if (stillHasSuppressedResume) {
    return false;
  }

  if (suppressedTailoredResumeIds.size > 0) {
    return personalInfo.tailoredResumes.some(
      (tailoredResume) =>
        !suppressedTailoredResumeIds.has(tailoredResume.id) &&
        (!mutationJobUrl ||
          sameTailoringJobUrl(tailoredResume.jobUrl, mutationJobUrl)) &&
        recordMayReflectMutation({
          createdAt: tailoredResume.createdAt,
          mutationCreatedAt: mutation.createdAt,
          updatedAt: tailoredResume.updatedAt,
        }),
    );
  }

  if (!mutationJobUrl || mutationCreatedAt === null) {
    return false;
  }

  return personalInfo.tailoredResumes.some((tailoredResume) => {
    if (!sameTailoringJobUrl(tailoredResume.jobUrl, mutationJobUrl)) {
      return false;
    }

    const createdAt = readComparableTime(tailoredResume.createdAt);
    const updatedAt = readComparableTime(tailoredResume.updatedAt);
    return Boolean(
      (createdAt !== null && createdAt >= mutationCreatedAt) ||
        (updatedAt !== null && updatedAt >= mutationCreatedAt),
    );
  });
}

export function isOptimisticMutationSatisfiedByPersonalInfo(
  personalInfo: PersonalInfoSummary,
  mutation: OptimisticMutation,
) {
  if (mutation.action === "setStarred") {
    const matchingActiveTailorings = [
      personalInfo.activeTailoring,
      ...personalInfo.activeTailorings,
    ].filter(
      (activeTailoring): activeTailoring is TailorResumeExistingTailoringState =>
        Boolean(
          activeTailoring &&
            activeTailoringMatchesTargets(activeTailoring, {
              applicationIds: mutation.target.applicationId
                ? [mutation.target.applicationId]
                : [],
              tailoredResumeIds: mutation.target.tailoredResumeId
                ? [mutation.target.tailoredResumeId]
                : [],
            }),
        ),
    );
    const matchingTailoredResumes = personalInfo.tailoredResumes.filter(
      (tailoredResume) =>
        tailoredResumeMatchesTargets(tailoredResume, {
          applicationIds: mutation.target.applicationId
            ? [mutation.target.applicationId]
            : [],
          tailoredResumeIds: mutation.target.tailoredResumeId
            ? [mutation.target.tailoredResumeId]
            : [],
        }),
    );
    const matches = [...matchingActiveTailorings, ...matchingTailoredResumes];

    return (
      matches.length === 0 ||
      matches.every((item) => item.starred === mutation.patch.starred)
    );
  }

  if (mutation.action === "setArchived") {
    const targetIds = new Set(mutation.target.tailoredResumeIds);
    const matchingTailoredResumes = personalInfo.tailoredResumes.filter(
      (tailoredResume) => targetIds.has(tailoredResume.id),
    );

    return (
      matchingTailoredResumes.length === 0 ||
      matchingTailoredResumes.every((tailoredResume) =>
        mutation.patch.archived
          ? Boolean(tailoredResume.archivedAt)
          : !tailoredResume.archivedAt,
      )
    );
  }

  if (mutation.action === "deleteTailoredResumes") {
    const activeTailoringTargets = {
      applicationIds: mutation.target.applicationIds,
      jobUrls: mutation.target.jobUrls,
      tailoredResumeIds: mutation.target.tailoredResumeIds,
      tailorRunIds: mutation.target.tailorRunIds,
    };
    const tailoredResumeTargets = {
      applicationIds: mutation.target.applicationIds,
      jobUrls: mutation.target.jobUrls,
      tailoredResumeIds: mutation.target.tailoredResumeIds,
    };
    const tailoringInterviewTargets = {
      jobUrls: mutation.target.jobUrls,
      tailorRunIds: mutation.target.tailorRunIds,
    };

    return (
      !(
        personalInfo.activeTailoring &&
        activeTailoringMatchesTargets(
          personalInfo.activeTailoring,
          activeTailoringTargets,
        )
      ) &&
      !personalInfo.activeTailorings.some((activeTailoring) =>
        activeTailoringMatchesTargets(activeTailoring, activeTailoringTargets),
      ) &&
      !personalInfo.tailoredResumes.some((tailoredResume) =>
        tailoredResumeMatchesTargets(tailoredResume, tailoredResumeTargets),
      ) &&
      !(
        personalInfo.tailoringInterview &&
        tailoringInterviewMatchesTargets(
          personalInfo.tailoringInterview,
          tailoringInterviewTargets,
        )
      ) &&
      !personalInfo.tailoringInterviews.some((tailoringInterview) =>
        tailoringInterviewMatchesTargets(
          tailoringInterview,
          tailoringInterviewTargets,
        ),
      )
    );
  }

  return (
    [
      personalInfo.activeTailoring,
      ...personalInfo.activeTailorings,
    ].some(
      (activeTailoring) =>
        activeTailoring &&
        activeTailoringSatisfiesRetryMutation(activeTailoring, mutation),
    ) || completedResumeSatisfiesRetryMutation(personalInfo, mutation)
  );
}

export function reconcileOptimisticMutationStoreWithPersonalInfo(
  store: OptimisticMutationStore,
  personalInfo: PersonalInfoSummary,
) {
  const prunedStore = pruneOptimisticMutationStore(store);
  const mutationsByKey = Object.fromEntries(
    Object.entries(prunedStore.mutationsByKey).filter(
      ([, mutation]) =>
        !isOptimisticMutationSatisfiedByPersonalInfo(personalInfo, mutation),
    ),
  );

  if (
    Object.keys(mutationsByKey).length ===
    Object.keys(prunedStore.mutationsByKey).length
  ) {
    return prunedStore;
  }

  return {
    ...prunedStore,
    mutationsByKey,
    updatedAt: new Date().toISOString(),
  };
}

function applyMutation(
  personalInfo: PersonalInfoSummary,
  mutation: OptimisticMutation,
): PersonalInfoSummary {
  if (mutation.action === "setStarred") {
    const { applicationId, tailoredResumeId } = mutation.target;
    const { starred } = mutation.patch;

    return {
      ...personalInfo,
      activeTailoring: personalInfo.activeTailoring
        ? applyMutationToActiveTailoringStarred(
            personalInfo.activeTailoring,
            applicationId,
            tailoredResumeId,
            starred,
          )
        : null,
      activeTailorings: personalInfo.activeTailorings.map((activeTailoring) =>
        applyMutationToActiveTailoringStarred(
          activeTailoring,
          applicationId,
          tailoredResumeId,
          starred,
        ),
      ),
      tailoredResumes: personalInfo.tailoredResumes.map((tailoredResume) =>
        (tailoredResumeId && tailoredResume.id === tailoredResumeId) ||
        (applicationId && tailoredResume.applicationId === applicationId)
          ? {
              ...tailoredResume,
              starred,
            }
          : tailoredResume,
      ),
    };
  }

  if (mutation.action === "setArchived") {
    const targetIds = new Set(mutation.target.tailoredResumeIds);

    return {
      ...personalInfo,
      tailoredResumes: personalInfo.tailoredResumes.map((tailoredResume) =>
        targetIds.has(tailoredResume.id)
          ? {
              ...tailoredResume,
              archivedAt: mutation.patch.archived
                ? mutation.patch.archivedAt || mutation.createdAt
                : null,
            }
          : tailoredResume,
      ),
    };
  }

  if (mutation.action === "deleteTailoredResumes") {
    const applicationIds = new Set(mutation.target.applicationIds);
    const tailoredResumeIds = new Set(mutation.target.tailoredResumeIds);

    return {
      ...personalInfo,
      activeTailoring:
        personalInfo.activeTailoring &&
        activeTailoringMatchesTargets(personalInfo.activeTailoring, mutation.target)
          ? null
          : personalInfo.activeTailoring,
      activeTailorings: personalInfo.activeTailorings.filter(
        (activeTailoring) =>
          !activeTailoringMatchesTargets(activeTailoring, mutation.target),
      ),
      tailoredResumes: personalInfo.tailoredResumes.filter(
        (tailoredResume) =>
          !tailoredResumeIds.has(tailoredResume.id) &&
          !(
            tailoredResume.applicationId &&
            applicationIds.has(tailoredResume.applicationId)
          ),
      ),
      tailoringInterview: null,
      tailoringInterviews: [],
    };
  }

  const retryJobUrl = mutation.target.jobUrl;
  const retryTailorRunId = mutation.target.tailorRunId;
  const suppressTailoredResumeIds = new Set(
    mutation.target.suppressTailoredResumeIds,
  );
  const nextActiveTailorings = [
    mutation.patch.activeTailoring,
    ...personalInfo.activeTailorings.filter(
      (activeTailoring) =>
        activeTailoring.id !== mutation.patch.activeTailoring.id &&
        !(retryTailorRunId && activeTailoring.id === retryTailorRunId) &&
        !(retryJobUrl && sameTailoringJobUrl(activeTailoring.jobUrl, retryJobUrl)),
    ),
  ];

  return {
    ...personalInfo,
    activeTailoring: nextActiveTailorings[0] ?? null,
    activeTailorings: nextActiveTailorings,
    tailoredResumes: personalInfo.tailoredResumes.filter(
      (tailoredResume) => !suppressTailoredResumeIds.has(tailoredResume.id),
    ),
    tailoringInterview:
      personalInfo.tailoringInterview &&
      tailoringInterviewMatchesTargets(personalInfo.tailoringInterview, {
        jobUrls: retryJobUrl ? [retryJobUrl] : [],
        tailorRunIds: retryTailorRunId ? [retryTailorRunId] : [],
      })
        ? null
        : personalInfo.tailoringInterview,
    tailoringInterviews: personalInfo.tailoringInterviews.filter(
      (tailoringInterview) =>
        !tailoringInterviewMatchesTargets(tailoringInterview, {
          jobUrls: retryJobUrl ? [retryJobUrl] : [],
          tailorRunIds: retryTailorRunId ? [retryTailorRunId] : [],
        }),
    ),
  };
}

function applyMutationToActiveTailoringStarred(
  activeTailoring: TailorResumeExistingTailoringState,
  applicationId: string | null,
  tailoredResumeId: string | null,
  starred: boolean,
): TailorResumeExistingTailoringState {
  const matches =
    (applicationId && activeTailoring.applicationId === applicationId) ||
    (tailoredResumeId &&
      activeTailoring.kind === "completed" &&
      activeTailoring.tailoredResumeId === tailoredResumeId);

  return matches
    ? {
        ...activeTailoring,
        starred,
      }
    : activeTailoring;
}

export function applyOptimisticMutationsToPersonalInfo(
  personalInfo: PersonalInfoSummary,
  store: OptimisticMutationStore,
): PersonalInfoSummary {
  const mutations = Object.values(pruneOptimisticMutationStore(store).mutationsByKey)
    .sort((left, right) => left.sequence - right.sequence);

  return mutations.reduce(applyMutation, personalInfo);
}
