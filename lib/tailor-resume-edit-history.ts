import type {
  TailoredResumeBlockEditRecord,
  TailoredResumeRecord,
} from "./tailor-resume-types.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";

function normalizeStoredBlockLatex(latexCode: string) {
  return stripTailorResumeSegmentIds(latexCode).replace(/\n+$/, "");
}

function appendReplacementChunk(input: {
  chunks: string[];
  contentEnd: number;
  replacementLatexCode: string;
  totalLength: number;
}) {
  const replacementLatexCode = normalizeStoredBlockLatex(input.replacementLatexCode);

  if (!replacementLatexCode.trim()) {
    return;
  }

  input.chunks.push(replacementLatexCode);

  if (
    !replacementLatexCode.endsWith("\n") &&
    input.contentEnd < input.totalLength
  ) {
    input.chunks.push("\n");
  }
}

function readNormalizedAnnotatedLatex(latexCode: string) {
  return normalizeTailorResumeLatex(latexCode).annotatedLatex;
}

export function resolveTailoredResumeSourceAnnotatedLatex(
  record: Pick<
    TailoredResumeRecord,
    "annotatedLatexCode" | "edits" | "sourceAnnotatedLatexCode"
  >,
) {
  if (record.sourceAnnotatedLatexCode?.trim()) {
    return readNormalizedAnnotatedLatex(record.sourceAnnotatedLatexCode);
  }

  const normalizedCurrentAnnotatedLatex = readNormalizedAnnotatedLatex(
    record.annotatedLatexCode,
  );
  const currentBlocks = readAnnotatedTailorResumeBlocks(normalizedCurrentAnnotatedLatex);
  const earliestEditsBySegmentId = new Map<string, TailoredResumeBlockEditRecord>();

  for (const edit of record.edits) {
    if (!earliestEditsBySegmentId.has(edit.segmentId)) {
      earliestEditsBySegmentId.set(edit.segmentId, edit);
    }
  }

  const chunks: string[] = [];
  let cursor = 0;

  for (const block of currentBlocks) {
    chunks.push(normalizedCurrentAnnotatedLatex.slice(cursor, block.markerStart));

    const earliestEdit = earliestEditsBySegmentId.get(block.id);

    appendReplacementChunk({
      chunks,
      contentEnd: block.contentEnd,
      replacementLatexCode: earliestEdit?.beforeLatexCode ?? block.latexCode,
      totalLength: normalizedCurrentAnnotatedLatex.length,
    });

    cursor = block.contentEnd;
  }

  chunks.push(normalizedCurrentAnnotatedLatex.slice(cursor));

  return readNormalizedAnnotatedLatex(chunks.join(""));
}

export function buildTailoredResumeCombinedActiveEdits(
  record: Pick<
    TailoredResumeRecord,
    "annotatedLatexCode" | "edits" | "sourceAnnotatedLatexCode"
  >,
) {
  const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex(record);
  const sourceBlocks = readAnnotatedTailorResumeBlocks(sourceAnnotatedLatexCode);
  const latestAppliedEditsBySegmentId = new Map<string, TailoredResumeBlockEditRecord>();

  for (const edit of record.edits) {
    if (edit.state !== "applied") {
      continue;
    }

    latestAppliedEditsBySegmentId.set(edit.segmentId, edit);
  }

  return sourceBlocks.flatMap((block) => {
    const latestAppliedEdit = latestAppliedEditsBySegmentId.get(block.id);

    if (!latestAppliedEdit) {
      return [];
    }

    const normalizedAfterLatexCode = normalizeStoredBlockLatex(
      latestAppliedEdit.afterLatexCode,
    );

    if (normalizedAfterLatexCode === block.latexCode) {
      return [];
    }

    return [
      {
        ...latestAppliedEdit,
        afterLatexCode: normalizedAfterLatexCode,
        beforeLatexCode: block.latexCode,
      },
    ];
  });
}

export function rebuildTailoredResumeAnnotatedLatex(
  record: Pick<
    TailoredResumeRecord,
    "annotatedLatexCode" | "edits" | "sourceAnnotatedLatexCode"
  >,
) {
  const sourceAnnotatedLatexCode = resolveTailoredResumeSourceAnnotatedLatex(record);
  const sourceBlocks = readAnnotatedTailorResumeBlocks(sourceAnnotatedLatexCode);
  const combinedEdits = buildTailoredResumeCombinedActiveEdits(record);
  const combinedEditsBySegmentId = new Map(
    combinedEdits.map((edit) => [edit.segmentId, edit]),
  );
  const chunks: string[] = [];
  let cursor = 0;

  for (const block of sourceBlocks) {
    chunks.push(sourceAnnotatedLatexCode.slice(cursor, block.markerStart));

    const combinedEdit = combinedEditsBySegmentId.get(block.id);

    appendReplacementChunk({
      chunks,
      contentEnd: block.contentEnd,
      replacementLatexCode: combinedEdit?.afterLatexCode ?? block.latexCode,
      totalLength: sourceAnnotatedLatexCode.length,
    });

    cursor = block.contentEnd;
  }

  chunks.push(sourceAnnotatedLatexCode.slice(cursor));

  return readNormalizedAnnotatedLatex(chunks.join(""));
}

export function buildTailoredResumeResolvedSegmentMap(
  record: Pick<
    TailoredResumeRecord,
    "annotatedLatexCode" | "edits" | "sourceAnnotatedLatexCode"
  >,
) {
  const rebuiltAnnotatedLatexCode = rebuildTailoredResumeAnnotatedLatex(record);
  const rebuiltBlocks = readAnnotatedTailorResumeBlocks(rebuiltAnnotatedLatexCode);

  return new Map(rebuiltBlocks.map((block) => [block.id, block]));
}
