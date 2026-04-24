import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepSummary,
} from "./job-helper";

type TailorResumeRunStreamResult = {
  ok: boolean;
  payload: Record<string, unknown>;
  status: number;
};

type TailorResumeRunStreamEvent =
  | {
      stepEvent?: unknown;
      type: "generation-step";
    }
  | {
      error?: unknown;
      type: "error";
    }
  | {
      ok?: unknown;
      payload?: unknown;
      status?: unknown;
      type: "done";
    };

export function isNdjsonResponse(response: Response) {
  return (
    response.headers
      .get("Content-Type")
      ?.toLowerCase()
      .includes("text/x-ndjson") ?? false
  );
}

export async function readTailorResumeGenerationStream(
  response: Response,
  handlers: {
    onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
  },
) {
  if (!response.body) {
    throw new Error("The tailoring run did not return a readable response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: TailorResumeRunStreamResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      const event = JSON.parse(trimmedLine) as TailorResumeRunStreamEvent;

      if (event.type === "generation-step") {
        const stepEvent = readTailorResumeGenerationStepSummary(event.stepEvent);

        if (stepEvent) {
          handlers.onStepEvent?.(stepEvent);
        }

        continue;
      }

      if (event.type === "error") {
        throw new Error(
          typeof event.error === "string" && event.error.trim()
            ? event.error
            : "Unable to tailor the resume.",
        );
      }

      finalResult = {
        ok: event.ok === true,
        payload:
          typeof event.payload === "object" && event.payload !== null
            ? (event.payload as Record<string, unknown>)
            : {},
        status: typeof event.status === "number" ? event.status : 500,
      };
    }

    if (done) {
      break;
    }
  }

  if (!finalResult) {
    throw new Error("The tailoring run finished without a final response payload.");
  }

  return finalResult;
}
