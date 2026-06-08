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
