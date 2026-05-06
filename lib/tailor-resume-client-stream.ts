type TailorResumeStreamLinkValidationSummary = {
  failedCount: number;
  passedCount: number;
  totalCount: number;
  unverifiedCount: number;
};

type TailorResumeStreamExtractionAttempt = {
  attempt: number;
  error: string | null;
  linkSummary: TailorResumeStreamLinkValidationSummary | null;
  outcome: "failed" | "succeeded";
  willRetry: boolean;
};

type TailorResumeUploadStreamEvent =
  | {
      attemptEvent?: unknown;
      type: "extraction-attempt";
    }
  | {
      error?: unknown;
      type: "error";
    }
  | {
      payload?: unknown;
      type: "done";
    };

type TailorResumeRunStreamEvent<StepEvent> =
  | {
      stepEvent?: StepEvent;
      type: "generation-step";
    }
  | {
      event?: unknown;
      type: "interview-stream";
    }
  | {
      payload?: unknown;
      type: "user-memory";
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

export type TailorResumeRunStreamResult<Payload> = {
  ok: boolean;
  payload: Payload;
  status: number;
};

function waitForNextStreamPaintOpportunity() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function readObjectPayload<Payload>(
  value: unknown,
  fallbackValue: Payload,
): Payload {
  return typeof value === "object" && value !== null
    ? (value as Payload)
    : fallbackValue;
}

export function isNdjsonResponse(response: Response) {
  return (
    response.headers
      .get("Content-Type")
      ?.toLowerCase()
      .includes("text/x-ndjson") ?? false
  );
}

export async function readTailorResumeUploadStream<
  Payload = Record<string, unknown>,
>(
  response: Response,
  handlers: {
    onAttemptEvent?: (attemptEvent: TailorResumeStreamExtractionAttempt) => void;
    parsePayload?: (value: unknown) => Payload;
  } = {},
) {
  if (!response.body) {
    throw new Error("The resume upload did not return a readable response stream.");
  }

  const parsePayload =
    handlers.parsePayload ??
    ((value: unknown) => readObjectPayload(value, {} as Payload));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: Payload | null = null;

  function processLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    const event = JSON.parse(trimmedLine) as TailorResumeUploadStreamEvent;

    if (event.type === "extraction-attempt") {
      handlers.onAttemptEvent?.(
        event.attemptEvent as TailorResumeStreamExtractionAttempt,
      );
      return;
    }

    if (event.type === "error") {
      throw new Error(
        typeof event.error === "string" && event.error.trim()
          ? event.error
          : "Unable to upload the resume.",
      );
    }

    finalPayload = parsePayload(event.payload);
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }

    if (done) {
      break;
    }
  }

  processLine(buffer);

  if (!finalPayload) {
    throw new Error("The resume upload finished without a final response payload.");
  }

  return finalPayload;
}

export async function readTailorResumeGenerationStream<
  StepEvent = unknown,
  InterviewStreamEvent = unknown,
  Payload = Record<string, unknown>,
  UserMemoryPayload = Payload,
>(
  response: Response,
  handlers: {
    onInterviewStreamEvent?: (event: InterviewStreamEvent) => void;
    onStepEvent?: (stepEvent: StepEvent) => void;
    onUserMemoryEvent?: (payload: UserMemoryPayload) => void;
    parseInterviewStreamEvent?: (value: unknown) => InterviewStreamEvent | null;
    parsePayload?: (value: unknown) => Payload;
    parseStepEvent: (value: unknown) => StepEvent | null;
    parseUserMemoryPayload?: (value: unknown) => UserMemoryPayload;
  },
) {
  if (!response.body) {
    throw new Error("The tailoring run did not return a readable response stream.");
  }

  const parsePayload =
    handlers.parsePayload ??
    ((value: unknown) => readObjectPayload(value, {} as Payload));
  const parseUserMemoryPayload =
    handlers.parseUserMemoryPayload ??
    ((value: unknown) =>
      readObjectPayload(value, {} as UserMemoryPayload));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: TailorResumeRunStreamResult<Payload> | null = null;

  async function processLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    const event = JSON.parse(trimmedLine) as TailorResumeRunStreamEvent<StepEvent>;

    if (event.type === "generation-step") {
      const stepEvent = handlers.parseStepEvent(event.stepEvent);

      if (stepEvent) {
        handlers.onStepEvent?.(stepEvent);
      }

      return;
    }

    if (event.type === "interview-stream") {
      if (handlers.parseInterviewStreamEvent && handlers.onInterviewStreamEvent) {
        const interviewStreamEvent = handlers.parseInterviewStreamEvent(
          event.event,
        );

        if (interviewStreamEvent) {
          handlers.onInterviewStreamEvent(interviewStreamEvent);
          await waitForNextStreamPaintOpportunity();
        }
      }

      return;
    }

    if (event.type === "user-memory") {
      handlers.onUserMemoryEvent?.(parseUserMemoryPayload(event.payload));
      await waitForNextStreamPaintOpportunity();
      return;
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
      payload: parsePayload(event.payload),
      status: typeof event.status === "number" ? event.status : 500,
    };
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      await processLine(line);
    }

    if (done) {
      break;
    }
  }

  await processLine(buffer);

  if (!finalResult) {
    throw new Error("The tailoring run finished without a final response payload.");
  }

  return finalResult;
}
