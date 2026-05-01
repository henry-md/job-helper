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

function resolveBlockScopedSourceReplacementLatex(input: {
  replacementLatexCode: string;
  segmentId: string;
}):
  | {
      latexCode: string;
      ok: true;
    }
  | {
      ok: false;
      reason: "empty_replacement" | "multiple_replacement_segments";
    } {
  const normalizedReplacementLatexCode = normalizeStoredBlockLatex(
    input.replacementLatexCode,
  );

  if (!normalizedReplacementLatexCode.trim()) {
    return {
      ok: false,
      reason: "empty_replacement",
    };
  }

  const normalizedReplacement = normalizeTailorResumeLatex(
    normalizedReplacementLatexCode,
  );

  if (normalizedReplacement.segmentCount <= 1) {
    return {
      latexCode: normalizedReplacementLatexCode,
      ok: true,
    };
  }

  const replacementBlock = readAnnotatedTailorResumeBlocks(
    normalizedReplacement.annotatedLatex,
  ).find((block) => block.id === input.segmentId);

  if (!replacementBlock) {
    return {
      ok: false,
      reason: "multiple_replacement_segments",
    };
  }

  const blockLatexCode = normalizeStoredBlockLatex(replacementBlock.latexCode);

  if (!blockLatexCode.trim()) {
    return {
      ok: false,
      reason: "empty_replacement",
    };
  }

  return {
    latexCode: blockLatexCode,
    ok: true,
  };
}

export function resolveTailoredResumeCurrentEditLatexCode(
  edit: Pick<
    TailoredResumeBlockEditRecord,
    "afterLatexCode" | "beforeLatexCode" | "customLatexCode" | "state"
  >,
) {
  if (edit.customLatexCode !== null) {
    return edit.customLatexCode;
  }

  return edit.state === "applied" ? edit.afterLatexCode : edit.beforeLatexCode;
}

export function buildTailoredResumeReviewEdits(
  record: Pick<TailoredResumeRecord, "edits">,
) {
  return record.edits;
}

export function updateTailoredResumeEditState(input: {
  editId: string;
  edits: TailoredResumeBlockEditRecord[];
  nextState: TailoredResumeBlockEditRecord["state"];
}): TailoredResumeBlockEditRecord[] | null {
  const targetEdit = input.edits.find((edit) => edit.editId === input.editId);

  if (!targetEdit) {
    return null;
  }

  return input.edits.map<TailoredResumeBlockEditRecord>((edit) => {
    if (edit.editId === input.editId) {
      if (edit.state === input.nextState && edit.customLatexCode === null) {
        return edit;
      }

      return {
        ...edit,
        customLatexCode: null,
        state: input.nextState,
      };
    }

    return edit;
  });
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
  const editsBySegmentId = new Map(record.edits.map((edit) => [edit.segmentId, edit]));

  return sourceBlocks.flatMap((block) => {
    const latestAppliedEdit = editsBySegmentId.get(block.id);

    if (!latestAppliedEdit) {
      return [];
    }

    const normalizedAfterLatexCode = normalizeStoredBlockLatex(
      resolveTailoredResumeCurrentEditLatexCode(latestAppliedEdit),
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

export type ApplyTailoredResumeEditToSourceLatexResult =
  | {
      annotatedLatexCode: string;
      changed: boolean;
      latexCode: string;
      ok: true;
    }
  | {
      currentLatexCode?: string;
      ok: false;
      reason:
        | "empty_replacement"
        | "multiple_replacement_segments"
        | "segment_not_found"
        | "source_block_changed";
    };

export function applyTailoredResumeEditToSourceLatex(input: {
  beforeLatexCode: string;
  replacementLatexCode: string;
  segmentId: string;
  sourceLatexCode: string;
}): ApplyTailoredResumeEditToSourceLatexResult {
  const sourceAnnotatedLatexCode = readNormalizedAnnotatedLatex(input.sourceLatexCode);
  const sourceBlocks = readAnnotatedTailorResumeBlocks(sourceAnnotatedLatexCode);
  const sourceBlock = sourceBlocks.find((block) => block.id === input.segmentId);

  if (!sourceBlock) {
    return {
      ok: false,
      reason: "segment_not_found",
    };
  }

  const normalizedBeforeLatexCode = normalizeStoredBlockLatex(input.beforeLatexCode);
  const replacement = resolveBlockScopedSourceReplacementLatex({
    replacementLatexCode: input.replacementLatexCode,
    segmentId: input.segmentId,
  });

  if (!replacement.ok) {
    return {
      ok: false,
      reason: replacement.reason,
    };
  }

  const normalizedReplacementLatexCode = replacement.latexCode;

  const normalizedCurrentLatexCode = normalizeStoredBlockLatex(sourceBlock.latexCode);

  if (normalizedCurrentLatexCode === normalizedReplacementLatexCode) {
    return {
      annotatedLatexCode: sourceAnnotatedLatexCode,
      changed: false,
      latexCode: stripTailorResumeSegmentIds(sourceAnnotatedLatexCode),
      ok: true,
    };
  }

  if (normalizedCurrentLatexCode !== normalizedBeforeLatexCode) {
    return {
      currentLatexCode: normalizedCurrentLatexCode,
      ok: false,
      reason: "source_block_changed",
    };
  }

  const chunks: string[] = [];
  let cursor = 0;

  for (const block of sourceBlocks) {
    chunks.push(sourceAnnotatedLatexCode.slice(cursor, block.markerStart));

    appendReplacementChunk({
      chunks,
      contentEnd: block.contentEnd,
      replacementLatexCode:
        block.id === input.segmentId
          ? normalizedReplacementLatexCode
          : block.latexCode,
      totalLength: sourceAnnotatedLatexCode.length,
    });

    cursor = block.contentEnd;
  }

  chunks.push(sourceAnnotatedLatexCode.slice(cursor));

  const annotatedLatexCode = readNormalizedAnnotatedLatex(chunks.join(""));

  return {
    annotatedLatexCode,
    changed: true,
    latexCode: stripTailorResumeSegmentIds(annotatedLatexCode),
    ok: true,
  };
}
