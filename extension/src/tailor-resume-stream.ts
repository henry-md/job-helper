import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepSummary,
} from "./job-helper";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream as readSharedTailorResumeGenerationStream,
  type TailorResumeRunStreamResult,
} from "../../lib/tailor-resume-client-stream.ts";

export { isNdjsonResponse };

export async function readTailorResumeGenerationStream(
  response: Response,
  handlers: {
    onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
  },
) {
  return readSharedTailorResumeGenerationStream(response, {
    onStepEvent: handlers.onStepEvent,
    parsePayload: (value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {},
    parseStepEvent: readTailorResumeGenerationStepSummary,
  }) as Promise<TailorResumeRunStreamResult<Record<string, unknown>>>;
}
