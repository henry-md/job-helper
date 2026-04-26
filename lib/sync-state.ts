export type UserSyncStateSnapshot = {
  applicationsVersion: number;
  tailoringVersion: number;
};

export function emptyUserSyncStateSnapshot(): UserSyncStateSnapshot {
  return {
    applicationsVersion: 0,
    tailoringVersion: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function readUserSyncStateSnapshot(value: unknown): UserSyncStateSnapshot {
  const syncState = isRecord(value) && isRecord(value.syncState) ? value.syncState : value;

  if (!isRecord(syncState)) {
    return emptyUserSyncStateSnapshot();
  }

  return {
    applicationsVersion: readNonNegativeInteger(syncState.applicationsVersion),
    tailoringVersion: readNonNegativeInteger(syncState.tailoringVersion),
  };
}

export function haveUserSyncStateChanged(
  previousState: UserSyncStateSnapshot,
  nextState: UserSyncStateSnapshot,
) {
  return (
    previousState.applicationsVersion !== nextState.applicationsVersion ||
    previousState.tailoringVersion !== nextState.tailoringVersion
  );
}
