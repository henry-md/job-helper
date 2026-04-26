import { getPrismaClient } from "./prisma.ts";
import {
  emptyUserSyncStateSnapshot,
  type UserSyncStateSnapshot,
} from "./sync-state";

export async function readUserSyncStateSnapshotForUser(
  userId: string,
): Promise<UserSyncStateSnapshot> {
  const syncState = await getPrismaClient().userSyncState.findUnique({
    select: {
      applicationsVersion: true,
      tailoringVersion: true,
    },
    where: {
      userId,
    },
  });

  if (!syncState) {
    return emptyUserSyncStateSnapshot();
  }

  return {
    applicationsVersion: syncState.applicationsVersion,
    tailoringVersion: syncState.tailoringVersion,
  };
}

export async function bumpUserSyncState(input: {
  applications?: boolean;
  tailoring?: boolean;
  userId: string;
}) {
  if (!input.applications && !input.tailoring) {
    return null;
  }

  return getPrismaClient().userSyncState.upsert({
    create: {
      applicationsVersion: input.applications ? 1 : 0,
      tailoringVersion: input.tailoring ? 1 : 0,
      userId: input.userId,
    },
    select: {
      applicationsVersion: true,
      tailoringVersion: true,
    },
    update: {
      ...(input.applications
        ? {
            applicationsVersion: {
              increment: 1,
            },
          }
        : {}),
      ...(input.tailoring
        ? {
            tailoringVersion: {
              increment: 1,
            },
          }
        : {}),
    },
    where: {
      userId: input.userId,
    },
  });
}
