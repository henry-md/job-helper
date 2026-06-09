import type { TailoredResumeRecord } from "./tailor-resume-types.ts";

export function buildTailoredResumePreviewPdfUrl(
  record: Pick<TailoredResumeRecord, "id" | "pdfUpdatedAt">,
) {
  const searchParams = new URLSearchParams({
    tailoredResumeId: record.id,
  });

  if (record.pdfUpdatedAt) {
    searchParams.set("updatedAt", record.pdfUpdatedAt);
  }

  return `/api/tailor-resume/preview?${searchParams.toString()}`;
}

export function buildTailoredResumeVersionPreviewPdfUrl(input: {
  pdfUpdatedAt: string | null;
  tailoredResumeId: string;
  versionId: string;
}) {
  const searchParams = new URLSearchParams({
    tailoredResumeId: input.tailoredResumeId,
    tailoredResumeVersionId: input.versionId,
  });

  if (input.pdfUpdatedAt) {
    searchParams.set("updatedAt", input.pdfUpdatedAt);
  }

  return `/api/tailor-resume/preview?${searchParams.toString()}`;
}
