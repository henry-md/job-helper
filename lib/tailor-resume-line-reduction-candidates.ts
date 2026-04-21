import {
  indexTailorResumeSegmentMeasurements,
  measureTailorResumeLayout,
  type TailorResumeLayoutMeasurement,
} from "./tailor-resume-layout-measurement.ts";
import { applyTailorResumeBlockChanges } from "./tailor-resume-tailoring.ts";

export type TailorResumeLineReductionCandidate = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

export type TailorResumeLineReductionMeasurement = {
  candidateLineCount: number | null;
  candidate: TailorResumeLineReductionCandidate;
  originalLineCount: number | null;
  previousLineCount: number | null;
  rejectionReason: string | null;
};

export type TailorResumeLineReductionToolResult = {
  accepted: Array<
    TailorResumeLineReductionMeasurement & {
      candidateLineCount: number;
      previousLineCount: number;
    }
  >;
  rejected: TailorResumeLineReductionMeasurement[];
};

function indexCurrentLineCounts(layout: TailorResumeLayoutMeasurement) {
  return indexTailorResumeSegmentMeasurements(layout);
}

function applyCandidatesToAnnotatedLatex(input: {
  annotatedLatexCode: string;
  candidates: TailorResumeLineReductionCandidate[];
}) {
  return applyTailorResumeBlockChanges({
    annotatedLatexCode: input.annotatedLatexCode,
    changes: input.candidates.map((candidate) => ({
      latexCode: candidate.latexCode,
      reason: candidate.reason,
      segmentId: candidate.segmentId,
    })),
  }).annotatedLatex;
}

function filterUniqueCandidates(input: {
  candidates: TailorResumeLineReductionCandidate[];
  editableSegmentIds: Set<string>;
}) {
  const seenSegmentIds = new Set<string>();
  const validCandidates: TailorResumeLineReductionCandidate[] = [];
  const rejected: TailorResumeLineReductionMeasurement[] = [];

  for (const candidate of input.candidates) {
    if (!input.editableSegmentIds.has(candidate.segmentId)) {
      rejected.push({
        candidate,
        candidateLineCount: null,
        originalLineCount: null,
        previousLineCount: null,
        rejectionReason: "unknown_or_uneditable_segment",
      });
      continue;
    }

    if (seenSegmentIds.has(candidate.segmentId)) {
      rejected.push({
        candidate,
        candidateLineCount: null,
        originalLineCount: null,
        previousLineCount: null,
        rejectionReason: "duplicate_candidate_for_segment",
      });
      continue;
    }

    seenSegmentIds.add(candidate.segmentId);
    validCandidates.push(candidate);
  }

  return {
    rejected,
    validCandidates,
  };
}

async function measureCandidateBatch(input: {
  candidates: TailorResumeLineReductionCandidate[];
  currentAnnotatedLatexCode: string;
  currentLayout: TailorResumeLayoutMeasurement;
  sourceLayout: TailorResumeLayoutMeasurement;
}) {
  const currentLineCounts = indexCurrentLineCounts(input.currentLayout);
  const sourceLineCounts = indexCurrentLineCounts(input.sourceLayout);
  const candidateAnnotatedLatexCode = applyCandidatesToAnnotatedLatex({
    annotatedLatexCode: input.currentAnnotatedLatexCode,
    candidates: input.candidates,
  });
  const candidateLayout = await measureTailorResumeLayout({
    annotatedLatexCode: candidateAnnotatedLatexCode,
  });
  const candidateLineCounts = indexCurrentLineCounts(candidateLayout);

  return input.candidates.map((candidate) => {
    const originalLineCount =
      sourceLineCounts.get(candidate.segmentId)?.lineCount ?? null;
    const previousLineCount =
      currentLineCounts.get(candidate.segmentId)?.lineCount ?? null;
    const candidateLineCount =
      candidateLineCounts.get(candidate.segmentId)?.lineCount ?? null;

    if (previousLineCount === null) {
      return {
        candidate,
        candidateLineCount,
        originalLineCount,
        previousLineCount,
        rejectionReason: "current_segment_line_count_unavailable",
      } satisfies TailorResumeLineReductionMeasurement;
    }

    if (candidateLineCount === null) {
      return {
        candidate,
        candidateLineCount,
        originalLineCount,
        previousLineCount,
        rejectionReason: "candidate_segment_line_count_unavailable",
      } satisfies TailorResumeLineReductionMeasurement;
    }

    if (candidateLineCount >= previousLineCount) {
      return {
        candidate,
        candidateLineCount,
        originalLineCount,
        previousLineCount,
        rejectionReason: "candidate_did_not_reduce_rendered_line_count",
      } satisfies TailorResumeLineReductionMeasurement;
    }

    if (originalLineCount !== null && candidateLineCount >= originalLineCount) {
      return {
        candidate,
        candidateLineCount,
        originalLineCount,
        previousLineCount,
        rejectionReason:
          "candidate_did_not_reduce_original_rendered_line_count",
      } satisfies TailorResumeLineReductionMeasurement;
    }

    return {
      candidate,
      candidateLineCount,
      originalLineCount,
      previousLineCount,
      rejectionReason: null,
    } satisfies TailorResumeLineReductionMeasurement;
  });
}

async function measureCandidateIndividually(input: {
  candidate: TailorResumeLineReductionCandidate;
  currentAnnotatedLatexCode: string;
  currentLayout: TailorResumeLayoutMeasurement;
  sourceLayout: TailorResumeLayoutMeasurement;
}) {
  try {
    const [measurement] = await measureCandidateBatch({
      candidates: [input.candidate],
      currentAnnotatedLatexCode: input.currentAnnotatedLatexCode,
      currentLayout: input.currentLayout,
      sourceLayout: input.sourceLayout,
    });

    return measurement;
  } catch (error) {
    return {
      candidate: input.candidate,
      candidateLineCount: null,
      originalLineCount:
        indexCurrentLineCounts(input.sourceLayout).get(input.candidate.segmentId)
          ?.lineCount ?? null,
      previousLineCount:
        indexCurrentLineCounts(input.currentLayout).get(input.candidate.segmentId)
          ?.lineCount ?? null,
      rejectionReason:
        error instanceof Error
          ? `candidate_failed_to_compile_or_measure: ${error.message}`
          : "candidate_failed_to_compile_or_measure",
    } satisfies TailorResumeLineReductionMeasurement;
  }
}

export async function measureTailorResumeLineReductionCandidates(input: {
  candidates: TailorResumeLineReductionCandidate[];
  currentAnnotatedLatexCode: string;
  currentLayout: TailorResumeLayoutMeasurement;
  editableSegmentIds: Set<string>;
  sourceLayout: TailorResumeLayoutMeasurement;
}): Promise<TailorResumeLineReductionToolResult> {
  const { rejected: initiallyRejected, validCandidates } = filterUniqueCandidates({
    candidates: input.candidates,
    editableSegmentIds: input.editableSegmentIds,
  });
  let measurements: TailorResumeLineReductionMeasurement[];

  if (validCandidates.length === 0) {
    measurements = [];
  } else {
    try {
      measurements = await measureCandidateBatch({
        candidates: validCandidates,
        currentAnnotatedLatexCode: input.currentAnnotatedLatexCode,
        currentLayout: input.currentLayout,
        sourceLayout: input.sourceLayout,
      });
    } catch {
      measurements = await Promise.all(
        validCandidates.map((candidate) =>
          measureCandidateIndividually({
            candidate,
            currentAnnotatedLatexCode: input.currentAnnotatedLatexCode,
            currentLayout: input.currentLayout,
            sourceLayout: input.sourceLayout,
          }),
        ),
      );
    }
  }

  const accepted = measurements.flatMap((measurement) =>
    measurement.rejectionReason === null &&
    measurement.previousLineCount !== null &&
    measurement.candidateLineCount !== null
      ? [
          {
            ...measurement,
            candidateLineCount: measurement.candidateLineCount,
            previousLineCount: measurement.previousLineCount,
          },
        ]
      : [],
  );
  const rejected = [
    ...initiallyRejected,
    ...measurements.filter((measurement) => measurement.rejectionReason !== null),
  ];

  return {
    accepted,
    rejected,
  };
}
