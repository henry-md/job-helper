import { getRetryAttemptsForTransientModelErrors } from "./tailor-resume-retry-config.ts";

const transientStatusCodes = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const transientErrorCodes = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

const transientMessagePattern =
  /\b(network error|connection error|fetch failed|socket hang up|timeout|timed out|temporarily unavailable|rate limit|too many requests|service unavailable|bad gateway|gateway timeout|internal server error)\b/i;

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
};

export type TransientModelRetryEvent = {
  attempt: number;
  delayMs: number;
  error: unknown;
  maxAttempts: number;
  message: string;
  nextAttempt: number;
};

function readErrorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? (error as ErrorLike) : {};
}

function readErrorNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readErrorString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const errorLike = readErrorLike(error);
  const message = readErrorString(errorLike.message);

  return message || "";
}

function readErrorStatus(error: unknown) {
  const errorLike = readErrorLike(error);

  return (
    readErrorNumber(errorLike.status) ??
    readErrorNumber(errorLike.statusCode)
  );
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  const errorLike = readErrorLike(error);
  const name = readErrorString(errorLike.name);

  return name === "AbortError";
}

export function isTransientModelError(error: unknown) {
  if (isAbortError(error)) {
    return false;
  }

  const status = readErrorStatus(error);

  if (status !== null && transientStatusCodes.has(status)) {
    return true;
  }

  const errorLike = readErrorLike(error);
  const code = readErrorString(errorLike.code).toUpperCase();

  if (transientErrorCodes.has(code)) {
    return true;
  }

  const name = readErrorString(errorLike.name);

  if (/^(APIConnection|APIConnectionTimeout|APITimeout|Timeout)/i.test(name)) {
    return true;
  }

  const type = readErrorString(errorLike.type);

  if (/^(server_error|rate_limit_error)$/i.test(type)) {
    return true;
  }

  return transientMessagePattern.test(readErrorMessage(error));
}

export function formatTransientModelError(
  error: unknown,
  fallback = "The model request failed with a transient network error.",
) {
  const message = readErrorMessage(error);

  return message || fallback;
}

function normalizeRetryAttemptCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function getTransientModelRetryDelayMs(failedAttempt: number) {
  const normalizedAttempt =
    Number.isFinite(failedAttempt) && failedAttempt > 0
      ? Math.floor(failedAttempt)
      : 1;

  return Math.min(4_000, 500 * 2 ** (normalizedAttempt - 1));
}

export async function runWithTransientModelRetries<T>(input: {
  delayMsForAttempt?: (failedAttempt: number) => number;
  maxAttempts?: number;
  onRetry?: (event: TransientModelRetryEvent) => void | Promise<void>;
  operation: () => Promise<T>;
  sleep?: (delayMs: number) => Promise<void>;
}) {
  const maxAttempts = normalizeRetryAttemptCount(
    input.maxAttempts ?? getRetryAttemptsForTransientModelErrors(),
  );
  const sleep =
    input.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const readDelayMs =
    input.delayMsForAttempt ?? getTransientModelRetryDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientModelError(error)) {
        throw error;
      }

      const delayMs = Math.max(0, Math.floor(readDelayMs(attempt)));
      await input.onRetry?.({
        attempt,
        delayMs,
        error,
        maxAttempts,
        message: formatTransientModelError(error),
        nextAttempt: attempt + 1,
      });

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw new Error("The model request did not return a response.");
}
