import {
  mergeTailorResumeProfileWithLockedLinks,
  readLockedTailorResumeLinksFromLinks,
  readTailorResumeLockedLinks,
  stripTailorResumeProfileLinkLocks,
  upsertTailorResumeLockedLinks,
} from "./tailor-resume-locked-links.ts";
import { readTailorResumeProfile, writeTailorResumeProfile } from "./tailor-resume-storage.ts";

export async function readTailorResumeProfileState(userId: string) {
  const storedProfile = await readTailorResumeProfile(userId);
  const legacyLockedLinks = readLockedTailorResumeLinksFromLinks(storedProfile.links);
  const rawProfile = stripTailorResumeProfileLinkLocks(storedProfile);

  if (legacyLockedLinks.length > 0) {
    await upsertTailorResumeLockedLinks(userId, legacyLockedLinks);
    await writeTailorResumeProfile(userId, rawProfile);
  }

  const lockedLinks = await readTailorResumeLockedLinks(userId);

  return {
    lockedLinks,
    profile: mergeTailorResumeProfileWithLockedLinks(rawProfile, lockedLinks, {
      includeLockedOnly: true,
    }),
    rawProfile,
  };
}
