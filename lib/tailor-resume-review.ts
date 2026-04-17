import { diffArrays } from "diff";
import type { TailoredResumeBlockEditRecord } from "./tailor-resume-types.ts";
import {
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";

type TailorResumeReviewChange = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

export type TailoredResumeDiffSegment = {
  text: string;
  type: "added" | "context" | "removed";
};

export type TailoredResumeDiffRow = {
  modifiedLineNumber: number | null;
  modifiedSegments?: TailoredResumeDiffSegment[];
  modifiedText: string | null;
  originalLineNumber: number | null;
  originalSegments?: TailoredResumeDiffSegment[];
  originalText: string | null;
  type: "added" | "context" | "modified" | "removed";
};

type DiffOperation = {
  text: string;
  type: "added" | "context" | "removed";
};

function splitLatexLines(value: string) {
  const normalizedValue = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!normalizedValue) {
    return [] as string[];
  }

  return normalizedValue.split("\n");
}

function tokenizeTailoredResumeInlineDiff(value: string) {
  return (
    value.match(
      /\\[A-Za-z@]+|\\.|[A-Za-z0-9]+(?:[\/+.:-][A-Za-z0-9]+)*|\s+|./g,
    ) ?? []
  );
}

function pushTailoredResumeDiffSegment(
  segments: TailoredResumeDiffSegment[],
  nextSegment: TailoredResumeDiffSegment,
) {
  if (!nextSegment.text) {
    return;
  }

  const previousSegment = segments.at(-1);

  if (previousSegment?.type === nextSegment.type) {
    previousSegment.text += nextSegment.text;
    return;
  }

  segments.push({ ...nextSegment });
}

function buildInlineTailoredResumeDiffSegments(
  originalText: string,
  modifiedText: string,
) {
  const originalSegments: TailoredResumeDiffSegment[] = [];
  const modifiedSegments: TailoredResumeDiffSegment[] = [];
  const diffParts = diffArrays(
    tokenizeTailoredResumeInlineDiff(originalText),
    tokenizeTailoredResumeInlineDiff(modifiedText),
  );

  for (const part of diffParts) {
    const segmentText = part.value.join("");

    if (!segmentText) {
      continue;
    }

    if (part.added) {
      pushTailoredResumeDiffSegment(modifiedSegments, {
        text: segmentText,
        type: "added",
      });
      continue;
    }

    if (part.removed) {
      pushTailoredResumeDiffSegment(originalSegments, {
        text: segmentText,
        type: "removed",
      });
      continue;
    }

    pushTailoredResumeDiffSegment(originalSegments, {
      text: segmentText,
      type: "context",
    });
    pushTailoredResumeDiffSegment(modifiedSegments, {
      text: segmentText,
      type: "context",
    });
  }

  return {
    modifiedSegments,
    originalSegments,
  };
}

function prettifySegmentPart(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pairDiffOperations(removed: DiffOperation[], added: DiffOperation[]) {
  const rowCount = Math.max(removed.length, added.length);
  const rows: Array<{
    modifiedText: string | null;
    originalText: string | null;
    type: TailoredResumeDiffRow["type"];
  }> = [];

  for (let index = 0; index < rowCount; index += 1) {
    const removedEntry = removed[index] ?? null;
    const addedEntry = added[index] ?? null;

    rows.push({
      modifiedText: addedEntry?.text ?? null,
      originalText: removedEntry?.text ?? null,
      type:
        removedEntry && addedEntry
          ? "modified"
          : removedEntry
            ? "removed"
            : "added",
    });
  }

  return rows;
}

function buildLineDiffOperations(
  originalLines: string[],
  modifiedLines: string[],
): DiffOperation[] {
  const rows = originalLines.length + 1;
  const columns = modifiedLines.length + 1;
  const lcsMatrix = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );

  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let modifiedIndex = modifiedLines.length - 1; modifiedIndex >= 0; modifiedIndex -= 1) {
      if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
        lcsMatrix[originalIndex][modifiedIndex] =
          lcsMatrix[originalIndex + 1][modifiedIndex + 1] + 1;
        continue;
      }

      lcsMatrix[originalIndex][modifiedIndex] = Math.max(
        lcsMatrix[originalIndex + 1][modifiedIndex],
        lcsMatrix[originalIndex][modifiedIndex + 1],
      );
    }
  }

  const operations: DiffOperation[] = [];
  let originalIndex = 0;
  let modifiedIndex = 0;

  while (originalIndex < originalLines.length && modifiedIndex < modifiedLines.length) {
    if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
      operations.push({
        text: originalLines[originalIndex],
        type: "context",
      });
      originalIndex += 1;
      modifiedIndex += 1;
      continue;
    }

    if (
      lcsMatrix[originalIndex + 1][modifiedIndex] >=
      lcsMatrix[originalIndex][modifiedIndex + 1]
    ) {
      operations.push({
        text: originalLines[originalIndex],
        type: "removed",
      });
      originalIndex += 1;
      continue;
    }

    operations.push({
      text: modifiedLines[modifiedIndex],
      type: "added",
    });
    modifiedIndex += 1;
  }

  while (originalIndex < originalLines.length) {
    operations.push({
      text: originalLines[originalIndex],
      type: "removed",
    });
    originalIndex += 1;
  }

  while (modifiedIndex < modifiedLines.length) {
    operations.push({
      text: modifiedLines[modifiedIndex],
      type: "added",
    });
    modifiedIndex += 1;
  }

  return operations;
}

export function normalizeTailoredResumeEditReason(reason: string) {
  const trimmedReason = reason.replace(/\s+/g, " ").trim();

  if (!trimmedReason) {
    return "Tailored to the role requirements.";
  }

  const sentenceMatches = [...trimmedReason.matchAll(/[.!?](?=\s|$)/g)];

  if (sentenceMatches.length <= 2) {
    return trimmedReason;
  }

  const cutoff = sentenceMatches[1]?.index;

  return cutoff === undefined ? trimmedReason : trimmedReason.slice(0, cutoff + 1).trim();
}

export function buildTailoredResumeBlockEdits(input: {
  annotatedLatexCode: string;
  changes: TailorResumeReviewChange[];
}): TailoredResumeBlockEditRecord[] {
  const blocks = readAnnotatedTailorResumeBlocks(input.annotatedLatexCode);
  const changesById = new Map(
    input.changes.map((change) => [change.segmentId, change]),
  );

  return blocks.flatMap((block) => {
    const change = changesById.get(block.id);

    if (!change) {
      return [];
    }

    return [
      {
        afterLatexCode: stripTailorResumeSegmentIds(change.latexCode).replace(/\n+$/, ""),
        beforeLatexCode: block.latexCode,
        command: block.command,
        reason: normalizeTailoredResumeEditReason(change.reason),
        segmentId: block.id,
      },
    ];
  });
}

export function buildTailoredResumeDiffRows(
  originalLatexCode: string,
  modifiedLatexCode: string,
) {
  const operations = buildLineDiffOperations(
    splitLatexLines(originalLatexCode),
    splitLatexLines(modifiedLatexCode),
  );
  const rows: TailoredResumeDiffRow[] = [];
  let originalLineNumber = 1;
  let modifiedLineNumber = 1;

  for (let index = 0; index < operations.length; index += 1) {
    const currentOperation = operations[index];

    if (currentOperation.type === "context") {
      rows.push({
        modifiedLineNumber,
        modifiedText: currentOperation.text,
        originalLineNumber,
        originalText: currentOperation.text,
        type: "context",
      });
      originalLineNumber += 1;
      modifiedLineNumber += 1;
      continue;
    }

    const removedOperations: DiffOperation[] = [];
    const addedOperations: DiffOperation[] = [];

    while (operations[index]?.type !== "context") {
      const operation = operations[index];

      if (!operation) {
        break;
      }

      if (operation.type === "removed") {
        removedOperations.push(operation);
      } else if (operation.type === "added") {
        addedOperations.push(operation);
      }

      index += 1;
    }

    index -= 1;

    for (const row of pairDiffOperations(removedOperations, addedOperations)) {
      const inlineSegments =
        row.type === "modified" && row.originalText !== null && row.modifiedText !== null
          ? buildInlineTailoredResumeDiffSegments(
              row.originalText,
              row.modifiedText,
            )
          : {};

      rows.push({
        modifiedLineNumber: row.modifiedText !== null ? modifiedLineNumber : null,
        modifiedSegments: inlineSegments.modifiedSegments,
        modifiedText: row.modifiedText,
        originalLineNumber: row.originalText !== null ? originalLineNumber : null,
        originalSegments: inlineSegments.originalSegments,
        originalText: row.originalText,
        type: row.type,
      });

      if (row.originalText !== null) {
        originalLineNumber += 1;
      }

      if (row.modifiedText !== null) {
        modifiedLineNumber += 1;
      }
    }
  }

  return rows;
}

export function formatTailoredResumeEditLabel(edit: Pick<
  TailoredResumeBlockEditRecord,
  "command" | "segmentId"
>) {
  const [sectionSlug = "document"] = edit.segmentId.split(".");
  const sectionLabel = prettifySegmentPart(sectionSlug);

  if (edit.command === "block") {
    const blockMatch = edit.segmentId.match(/\.block-(.+)-(\d+)$/);
    const blockLabel = blockMatch?.[1]
      ? prettifySegmentPart(blockMatch[1])
      : null;

    if (blockLabel) {
      return `${sectionLabel} ${blockLabel}`;
    }

    return `${sectionLabel} block`;
  }

  if (edit.command === "resumeitem") {
    const bulletOrdinal = edit.segmentId.match(/\.bullet-(\d+)/)?.[1];
    return `${sectionLabel} bullet${bulletOrdinal ? ` ${bulletOrdinal}` : ""}`;
  }

  if (edit.command === "entryheading") {
    const entryOrdinal = edit.segmentId.match(/\.entry-(\d+)/)?.[1];
    return `${sectionLabel} entry${entryOrdinal ? ` ${entryOrdinal}` : ""} heading`;
  }

  if (edit.command === "projectheading") {
    const projectOrdinal = edit.segmentId.match(/\.project-(\d+)/)?.[1];
    return `${sectionLabel} project${projectOrdinal ? ` ${projectOrdinal}` : ""} heading`;
  }

  if (edit.command === "descline") {
    const detailOrdinal = edit.segmentId.match(/\.desc-(\d+)/)?.[1];
    return `${sectionLabel} detail${detailOrdinal ? ` ${detailOrdinal}` : ""}`;
  }

  if (edit.command === "labelline") {
    const labelOrdinal = edit.segmentId.match(/\.label-(\d+)/)?.[1];
    return `${sectionLabel} line${labelOrdinal ? ` ${labelOrdinal}` : ""}`;
  }

  if (edit.command === "resumeSection") {
    return `${sectionLabel} section heading`;
  }

  return `${sectionLabel} update`;
}

export function summarizeTailoredResumeEdit(
  latexCode: string,
  fallback = "No visible LaTeX content.",
) {
  const summary = latexCode
    .replace(/\s+/g, " ")
    .replace(/\\+/g, "\\")
    .trim();

  if (!summary) {
    return fallback;
  }

  if (summary.length <= 90) {
    return summary;
  }

  return `${summary.slice(0, 87).trimEnd()}...`;
}
