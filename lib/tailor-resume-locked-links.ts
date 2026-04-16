import type {
  TailorResumeLinkRecord,
  TailorResumeLockedLinkRecord,
  TailorResumeProfile,
} from "./tailor-resume-types.ts";

function normalizeLockedLinkRecord(
  link: TailorResumeLockedLinkRecord,
): TailorResumeLockedLinkRecord {
  return {
    key: link.key,
    label: link.label,
    updatedAt: link.updatedAt,
    url: link.url,
  };
}

export function tailorResumeLockedLinkToLinkRecord(
  link: TailorResumeLockedLinkRecord,
  existingLink?: TailorResumeLinkRecord,
): TailorResumeLinkRecord {
  return {
    disabled: false,
    key: link.key,
    label: existingLink?.label ?? link.label,
    locked: true,
    updatedAt: link.updatedAt,
    url: link.url,
  };
}

export function stripTailorResumeLinkLocks(
  links: TailorResumeLinkRecord[],
): TailorResumeLinkRecord[] {
  return links.map((link) => ({
    disabled: link.disabled,
    key: link.key,
    label: link.label,
    updatedAt: link.updatedAt,
    url: link.url,
  }));
}

export function stripTailorResumeProfileLinkLocks(
  profile: TailorResumeProfile,
): TailorResumeProfile {
  return {
    ...profile,
    links: stripTailorResumeLinkLocks(profile.links),
  };
}

export function readLockedTailorResumeLinksFromLinks(
  links: TailorResumeLinkRecord[],
): TailorResumeLockedLinkRecord[] {
  const lockedLinksByKey = new Map<string, TailorResumeLockedLinkRecord>();

  for (const link of links) {
    if (link.disabled || link.locked !== true || !link.url) {
      continue;
    }

    lockedLinksByKey.set(link.key, {
      key: link.key,
      label: link.label,
      updatedAt: link.updatedAt,
      url: link.url,
    });
  }

  return [...lockedLinksByKey.values()];
}

export function mergeTailorResumeLinksWithLockedLinks(
  links: TailorResumeLinkRecord[],
  lockedLinks: TailorResumeLockedLinkRecord[],
  options: {
    includeLockedOnly?: boolean;
  } = {},
): TailorResumeLinkRecord[] {
  const includeLockedOnly = options.includeLockedOnly ?? false;
  const lockedLinksByKey = new Map(
    lockedLinks.map((link) => [link.key, normalizeLockedLinkRecord(link)]),
  );
  const mergedLinks: TailorResumeLinkRecord[] = [];
  const seenKeys = new Set<string>();

  for (const link of links) {
    const lockedLink = lockedLinksByKey.get(link.key);

    seenKeys.add(link.key);
    mergedLinks.push(
      lockedLink
        ? tailorResumeLockedLinkToLinkRecord(lockedLink, link)
        : {
            ...link,
            locked: false,
          },
    );
  }

  if (!includeLockedOnly) {
    return mergedLinks;
  }

  for (const lockedLink of lockedLinks) {
    if (seenKeys.has(lockedLink.key)) {
      continue;
    }

    mergedLinks.push(tailorResumeLockedLinkToLinkRecord(lockedLink));
  }

  return mergedLinks;
}

export function mergeTailorResumeProfileWithLockedLinks(
  profile: TailorResumeProfile,
  lockedLinks: TailorResumeLockedLinkRecord[],
  options: {
    includeLockedOnly?: boolean;
  } = {},
): TailorResumeProfile {
  return {
    ...profile,
    links: mergeTailorResumeLinksWithLockedLinks(
      profile.links,
      lockedLinks,
      options,
    ),
  };
}

export async function readTailorResumeLockedLinks(
  userId: string,
): Promise<TailorResumeLockedLinkRecord[]> {
  const { getPrismaClient } = await import("./prisma.ts");
  const prisma = getPrismaClient();
  const lockedLinks = await prisma.tailorResumeLockedLink.findMany({
    orderBy: [{ updatedAt: "asc" }, { key: "asc" }],
    where: { userId },
  });

  return lockedLinks.map((link) => ({
    key: link.key,
    label: link.label,
    updatedAt: link.updatedAt.toISOString(),
    url: link.url,
  }));
}

export async function upsertTailorResumeLockedLinks(
  userId: string,
  lockedLinks: TailorResumeLockedLinkRecord[],
) {
  const { getPrismaClient } = await import("./prisma.ts");
  const prisma = getPrismaClient();
  const normalizedLinks = [...new Map(
    lockedLinks.map((link) => [link.key, normalizeLockedLinkRecord(link)]),
  ).values()];

  if (normalizedLinks.length === 0) {
    return;
  }

  await prisma.$transaction(
    normalizedLinks.map((link) =>
      prisma.tailorResumeLockedLink.upsert({
        create: {
          key: link.key,
          label: link.label,
          url: link.url,
          userId,
        },
        update: {
          label: link.label,
          url: link.url,
        },
        where: {
          userId_key: {
            key: link.key,
            userId,
          },
        },
      }),
    ),
  );
}

export async function replaceTailorResumeLockedLinks(
  userId: string,
  lockedLinks: TailorResumeLockedLinkRecord[],
) {
  const { getPrismaClient } = await import("./prisma.ts");
  const prisma = getPrismaClient();
  const normalizedLinks = [...new Map(
    lockedLinks.map((link) => [link.key, normalizeLockedLinkRecord(link)]),
  ).values()];
  const lockedKeys = normalizedLinks.map((link) => link.key);

  await prisma.$transaction(async (tx) => {
    if (lockedKeys.length === 0) {
      await tx.tailorResumeLockedLink.deleteMany({
        where: { userId },
      });
    } else {
      await tx.tailorResumeLockedLink.deleteMany({
        where: {
          key: {
            notIn: lockedKeys,
          },
          userId,
        },
      });
    }

    for (const link of normalizedLinks) {
      await tx.tailorResumeLockedLink.upsert({
        create: {
          key: link.key,
          label: link.label,
          url: link.url,
          userId,
        },
        update: {
          label: link.label,
          url: link.url,
        },
        where: {
          userId_key: {
            key: link.key,
            userId,
          },
        },
      });
    }
  });
}
