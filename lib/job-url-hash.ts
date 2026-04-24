import { createHash } from "node:crypto";
import { normalizeTailorResumeJobUrl } from "./tailor-resume-job-url.ts";

export function buildNormalizedJobUrlHash(jobUrl: string | null | undefined) {
  const normalizedJobUrl = normalizeTailorResumeJobUrl(jobUrl);

  return normalizedJobUrl
    ? createHash("sha256").update(normalizedJobUrl).digest("hex")
    : null;
}
