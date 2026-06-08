import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@/generated/prisma/client";
import { buildNormalizedJobUrlHash } from "./job-url-hash.ts";
import { getPrismaClient } from "./prisma.ts";

type AiUsageProvider = "anthropic" | "openai";
type AiUsageSubjectStatus = "archived" | "deleted" | "unarchived";

export type AiUsageContext = {
  applicationId?: string | null;
  jobUrl?: string | null;
  tailorResumeRunId?: string | null;
  tailoredResumeId?: string | null;
  userId: string;
};

type TrackAiModelUsageInput<T> = {
  attempt?: number | null;
  model: string;
  operation: string;
  provider: AiUsageProvider;
  request: () => Promise<T>;
  round?: number | null;
  stepLabel?: string | null;
  stepNumber?: number | null;
};

type NormalizedUsage = {
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  rawUsage: Record<string, unknown>;
  reasoningTokens: number;
  totalTokens: number;
};

type PriceSnapshot = {
  cachedInputUsdPerMillion: number;
  cacheCreationUsdPerMillion: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricingSource: string;
};

const aiUsageContextStorage = new AsyncLocalStorage<AiUsageContext>();

function normalizeProvider(value: AiUsageProvider) {
  return value === "anthropic" ? "ANTHROPIC" : "OPENAI";
}

function normalizeSubjectStatus(value: AiUsageSubjectStatus) {
  if (value === "archived") {
    return "ARCHIVED";
  }

  if (value === "deleted") {
    return "DELETED";
  }

  return "UNARCHIVED";
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readUsageRecord(response: unknown) {
  if (!response || typeof response !== "object" || !("usage" in response)) {
    return null;
  }

  const usage = (response as { usage?: unknown }).usage;
  return usage && typeof usage === "object"
    ? (usage as Record<string, unknown>)
    : null;
}

export function readAiModelUsage(response: unknown): NormalizedUsage | null {
  const usage = readUsageRecord(response);

  if (!usage) {
    return null;
  }

  const inputTokens = readPositiveInteger(usage.input_tokens);
  const outputTokens = readPositiveInteger(usage.output_tokens);
  const totalTokens = readPositiveInteger(usage.total_tokens);
  const cachedInputTokens =
    readPositiveInteger(usage.input_cached_tokens) ||
    readPositiveInteger(usage.cache_read_input_tokens) ||
    readPositiveInteger(
      usage.input_tokens_details &&
        typeof usage.input_tokens_details === "object"
        ? (usage.input_tokens_details as Record<string, unknown>).cached_tokens
        : null,
    );
  const cacheCreationInputTokens = readPositiveInteger(
    usage.cache_creation_input_tokens,
  );
  const reasoningTokens = readPositiveInteger(
    usage.output_tokens_details &&
      typeof usage.output_tokens_details === "object"
      ? (usage.output_tokens_details as Record<string, unknown>).reasoning_tokens
      : null,
  );

  return {
    cachedInputTokens,
    cacheCreationInputTokens,
    inputTokens,
    outputTokens,
    rawUsage: usage,
    reasoningTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
  };
}

function normalizeModelName(model: string) {
  return model.trim().toLowerCase().replace(/^anthropic:/, "");
}

function resolveOpenAiPriceSnapshot(model: string): PriceSnapshot {
  const normalized = normalizeModelName(model);

  if (normalized.startsWith("gpt-5.5")) {
    return {
      cachedInputUsdPerMillion: 0.5,
      cacheCreationUsdPerMillion: 5,
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 30,
      pricingSource: "openai-pricing-2026-05-25:gpt-5.5",
    };
  }

  if (normalized.startsWith("gpt-5.4-mini")) {
    return {
      cachedInputUsdPerMillion: 0.075,
      cacheCreationUsdPerMillion: 0.75,
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 4.5,
      pricingSource: "openai-pricing-2026-05-25:gpt-5.4-mini",
    };
  }

  if (normalized.startsWith("gpt-5.4")) {
    return {
      cachedInputUsdPerMillion: 0.25,
      cacheCreationUsdPerMillion: 2.5,
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
      pricingSource: "openai-pricing-2026-05-25:gpt-5.4",
    };
  }

  if (normalized.startsWith("gpt-5-mini")) {
    return {
      cachedInputUsdPerMillion: 0.025,
      cacheCreationUsdPerMillion: 0.25,
      inputUsdPerMillion: 0.25,
      outputUsdPerMillion: 2,
      pricingSource: "openai-legacy-pricing:gpt-5-mini",
    };
  }

  return {
    cachedInputUsdPerMillion: 0,
    cacheCreationUsdPerMillion: 0,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    pricingSource: "unknown-openai-model",
  };
}

function resolveAnthropicPriceSnapshot(model: string): PriceSnapshot {
  const normalized = normalizeModelName(model);

  if (normalized.includes("opus-4-7") || normalized.includes("opus-4-6")) {
    return {
      cachedInputUsdPerMillion: 0.5,
      cacheCreationUsdPerMillion: 6.25,
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 25,
      pricingSource: "anthropic-pricing-2026-05-25:opus-4.6-plus",
    };
  }

  if (normalized.includes("sonnet-4-6") || normalized.includes("sonnet-4.6")) {
    return {
      cachedInputUsdPerMillion: 0.3,
      cacheCreationUsdPerMillion: 3.75,
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      pricingSource: "anthropic-pricing-2026-05-25:sonnet-4.6",
    };
  }

  if (normalized.includes("sonnet-4")) {
    return {
      cachedInputUsdPerMillion: 0.3,
      cacheCreationUsdPerMillion: 3.75,
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      pricingSource: "anthropic-pricing-2026-05-25:sonnet-4",
    };
  }

  if (normalized.includes("haiku-4-5") || normalized.includes("haiku-4.5")) {
    return {
      cachedInputUsdPerMillion: 0.1,
      cacheCreationUsdPerMillion: 1.25,
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 5,
      pricingSource: "anthropic-pricing-2026-05-25:haiku-4.5",
    };
  }

  return {
    cachedInputUsdPerMillion: 0,
    cacheCreationUsdPerMillion: 0,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    pricingSource: "unknown-anthropic-model",
  };
}

function resolvePriceSnapshot(input: {
  model: string;
  provider: AiUsageProvider;
}): PriceSnapshot {
  return input.provider === "anthropic"
    ? resolveAnthropicPriceSnapshot(input.model)
    : resolveOpenAiPriceSnapshot(input.model);
}

function calculateCostMicros(tokens: number, usdPerMillion: number) {
  if (tokens <= 0 || usdPerMillion <= 0) {
    return BigInt(0);
  }

  return BigInt(Math.round(tokens * usdPerMillion));
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAiUsageEvent(input: {
  attempt?: number | null;
  context: AiUsageContext;
  durationMs?: number | null;
  error?: string | null;
  model: string;
  operation: string;
  provider: AiUsageProvider;
  providerResponseId?: string | null;
  requestFinishedAt?: Date | null;
  requestStartedAt: Date;
  round?: number | null;
  status: "failed" | "succeeded";
  stepLabel?: string | null;
  stepNumber?: number | null;
  usage?: NormalizedUsage | null;
}) {
  const usage = input.usage ?? {
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    rawUsage: {},
    reasoningTokens: 0,
    totalTokens: 0,
  };
  const pricingSnapshot = resolvePriceSnapshot({
    model: input.model,
    provider: input.provider,
  });
  const billableInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationInputTokens,
  );
  const inputCostUsdMicros = calculateCostMicros(
    billableInputTokens,
    pricingSnapshot.inputUsdPerMillion,
  );
  const cachedInputCostUsdMicros = calculateCostMicros(
    usage.cachedInputTokens,
    pricingSnapshot.cachedInputUsdPerMillion,
  );
  const cacheCreationCostUsdMicros = calculateCostMicros(
    usage.cacheCreationInputTokens,
    pricingSnapshot.cacheCreationUsdPerMillion,
  );
  const outputCostUsdMicros = calculateCostMicros(
    usage.outputTokens,
    pricingSnapshot.outputUsdPerMillion,
  );
  const totalCostUsdMicros =
    inputCostUsdMicros +
    cachedInputCostUsdMicros +
    cacheCreationCostUsdMicros +
    outputCostUsdMicros;

  await getPrismaClient().aiUsageEvent.create({
    data: {
      applicationId: input.context.applicationId || null,
      attempt: input.attempt ?? null,
      cachedInputCostUsdMicros,
      cachedInputTokens: usage.cachedInputTokens,
      cacheCreationCostUsdMicros,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
      inputCostUsdMicros,
      inputTokens: usage.inputTokens,
      jobUrl: input.context.jobUrl || null,
      jobUrlHash: buildNormalizedJobUrlHash(input.context.jobUrl) || null,
      model: input.model,
      operation: input.operation,
      outputCostUsdMicros,
      outputTokens: usage.outputTokens,
      pricingSnapshot: toInputJsonValue(pricingSnapshot),
      provider: normalizeProvider(input.provider),
      providerResponseId: input.providerResponseId ?? null,
      rawUsage: toInputJsonValue(usage.rawUsage),
      reasoningTokens: usage.reasoningTokens,
      requestFinishedAt: input.requestFinishedAt ?? null,
      requestStartedAt: input.requestStartedAt,
      round: input.round ?? null,
      status: input.status === "succeeded" ? "SUCCEEDED" : "FAILED",
      stepLabel: input.stepLabel ?? null,
      stepNumber: input.stepNumber ?? null,
      subjectStatus: "UNARCHIVED",
      tailoredResumeId: input.context.tailoredResumeId || null,
      tailorResumeRunId: input.context.tailorResumeRunId || null,
      totalCostUsdMicros,
      totalTokens: usage.totalTokens,
      userId: input.context.userId,
    },
  });
}

function readProviderResponseId(response: unknown) {
  if (!response || typeof response !== "object" || !("id" in response)) {
    return null;
  }

  const id = (response as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function withAiUsageContext<T>(
  context: AiUsageContext,
  run: () => Promise<T>,
) {
  return aiUsageContextStorage.run(context, run);
}

export function mergeAiUsageContext<T>(
  context: Partial<AiUsageContext>,
  run: () => Promise<T>,
) {
  const currentContext = aiUsageContextStorage.getStore();

  if (!currentContext) {
    return run();
  }

  return aiUsageContextStorage.run(
    {
      ...currentContext,
      ...context,
    },
    run,
  );
}

export async function trackAiModelUsage<T>(input: TrackAiModelUsageInput<T>) {
  const context = aiUsageContextStorage.getStore();
  const requestStartedAt = new Date();
  const startedMs = Date.now();

  try {
    const response = await input.request();
    const requestFinishedAt = new Date();

    if (context) {
      await writeAiUsageEvent({
        attempt: input.attempt,
        context,
        durationMs: Math.max(0, Date.now() - startedMs),
        model: input.model,
        operation: input.operation,
        provider: input.provider,
        providerResponseId: readProviderResponseId(response),
        requestFinishedAt,
        requestStartedAt,
        round: input.round,
        status: "succeeded",
        stepLabel: input.stepLabel,
        stepNumber: input.stepNumber,
        usage: readAiModelUsage(response),
      }).catch((error) => {
        console.error("Could not write AI usage event.", error);
      });
    }

    return response;
  } catch (error) {
    if (context) {
      await writeAiUsageEvent({
        attempt: input.attempt,
        context,
        durationMs: Math.max(0, Date.now() - startedMs),
        error: error instanceof Error ? error.message : "The model request failed.",
        model: input.model,
        operation: input.operation,
        provider: input.provider,
        requestFinishedAt: new Date(),
        requestStartedAt,
        round: input.round,
        status: "failed",
        stepLabel: input.stepLabel,
        stepNumber: input.stepNumber,
      }).catch((writeError) => {
        console.error("Could not write failed AI usage event.", writeError);
      });
    }

    throw error;
  }
}

export async function setAiUsageSubjectStatus(input: {
  applicationIds?: string[];
  jobUrls?: Array<string | null | undefined>;
  runIds?: string[];
  status: AiUsageSubjectStatus;
  tailoredResumeIds?: string[];
  userId: string;
}) {
  const jobUrlHashes = [
    ...(input.jobUrls ?? [])
      .map((jobUrl) => buildNormalizedJobUrlHash(jobUrl))
      .filter((hash): hash is string => Boolean(hash)),
  ];
  const filters = [
    ...(input.applicationIds?.length
      ? [{ applicationId: { in: input.applicationIds } }]
      : []),
    ...(input.runIds?.length
      ? [{ tailorResumeRunId: { in: input.runIds } }]
      : []),
    ...(input.tailoredResumeIds?.length
      ? [{ tailoredResumeId: { in: input.tailoredResumeIds } }]
      : []),
    ...(jobUrlHashes.length ? [{ jobUrlHash: { in: jobUrlHashes } }] : []),
  ];

  if (filters.length === 0) {
    return;
  }

  await getPrismaClient().aiUsageEvent.updateMany({
    data: {
      subjectStatus: normalizeSubjectStatus(input.status),
    },
    where: {
      OR: filters,
      userId: input.userId,
    },
  });
}

export async function attachAiUsageToTailoredResume(input: {
  runId: string | null;
  tailoredResumeId: string;
  userId: string;
}) {
  if (!input.runId) {
    return;
  }

  await getPrismaClient().aiUsageEvent.updateMany({
    data: {
      tailoredResumeId: input.tailoredResumeId,
    },
    where: {
      tailorResumeRunId: input.runId,
      tailoredResumeId: null,
      userId: input.userId,
    },
  });
}
