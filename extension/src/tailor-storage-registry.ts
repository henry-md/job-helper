import {
  currentUrlMatchesSavedJobUrl,
  normalizeComparableUrl,
} from "./job-helper.ts";
import { buildTailorRunRegistryKey } from "./tailor-run-registry.ts";

export type ComparablePageIdentity = {
  canonicalUrl: string | null;
  jobUrl: string | null;
  pageUrl: string | null;
};

type RegistryParser<T> = (candidate: unknown) => T | null;
type RegistryEntryKeyReader<T> = (entry: T, rawKey: string) => string | null;
type RegistryEntryUrlReader<T> = (entry: T) => Array<string | null | undefined>;

type RegistryMatchInput = {
  jobUrl?: string | null;
  pageIdentity?: ComparablePageIdentity | null;
  pageKey?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildComparableCandidateSet(input: RegistryMatchInput) {
  const candidates = new Set<string>();
  const addComparableValue = (value: string | null | undefined) => {
    const comparableValue =
      buildTailorRunRegistryKey(value) ?? normalizeComparableUrl(value);

    if (comparableValue) {
      candidates.add(comparableValue);
    }
  };

  addComparableValue(input.pageKey);
  addComparableValue(input.jobUrl);
  addComparableValue(input.pageIdentity?.jobUrl ?? null);
  addComparableValue(input.pageIdentity?.canonicalUrl ?? null);
  addComparableValue(input.pageIdentity?.pageUrl ?? null);

  return candidates;
}

function entryMatchesComparableCandidates<T>(input: {
  comparableCandidates: Set<string>;
  entry: T;
  rawKey: string;
  readEntryKey: RegistryEntryKeyReader<T>;
  readEntryUrls: RegistryEntryUrlReader<T>;
}) {
  if (input.comparableCandidates.size === 0) {
    return false;
  }

  const entryComparableKey =
    input.readEntryKey(input.entry, input.rawKey) ??
    buildTailorRunRegistryKey(input.rawKey);

  if (
    entryComparableKey &&
    [...input.comparableCandidates].some((candidate) =>
      currentUrlMatchesSavedJobUrl({
        currentUrl: candidate,
        savedJobUrl: entryComparableKey,
      }),
    )
  ) {
    return true;
  }

  return input.readEntryUrls(input.entry).some((candidateUrl) => {
    const comparableCandidate = buildTailorRunRegistryKey(candidateUrl);
    return Boolean(
      comparableCandidate &&
        [...input.comparableCandidates].some((candidate) =>
          currentUrlMatchesSavedJobUrl({
            currentUrl: candidate,
            savedJobUrl: comparableCandidate,
          }),
        ),
    );
  });
}

export function normalizeTailorStorageRegistry<T>(input: {
  compareEntries?: (left: T, right: T) => number;
  parse: RegistryParser<T>;
  readEntryKey: RegistryEntryKeyReader<T>;
  value: unknown;
}) {
  if (!isRecord(input.value)) {
    return {
      changed: false,
      registry: {} as Record<string, T>,
    };
  }

  const registry = {} as Record<string, T>;
  let changed = false;
  let parseableEntryCount = 0;

  for (const [rawKey, candidate] of Object.entries(input.value)) {
    const entry = input.parse(candidate);

    if (!entry) {
      changed = true;
      continue;
    }

    parseableEntryCount += 1;
    const normalizedKey =
      input.readEntryKey(entry, rawKey) ?? buildTailorRunRegistryKey(rawKey);

    if (!normalizedKey) {
      changed = true;
      continue;
    }

    if (normalizedKey !== rawKey) {
      changed = true;
    }

    const previousEntry = registry[normalizedKey];

    if (
      !previousEntry ||
      !input.compareEntries ||
      input.compareEntries(entry, previousEntry) >= 0
    ) {
      if (previousEntry) {
        changed = true;
      }

      registry[normalizedKey] = entry;
    } else {
      changed = true;
    }
  }

  if (Object.keys(registry).length !== parseableEntryCount) {
    changed = true;
  }

  return {
    changed,
    registry,
  };
}

export function findTailorStorageRegistryEntry<T>(input: {
  match: RegistryMatchInput;
  readEntryKey: RegistryEntryKeyReader<T>;
  readEntryUrls: RegistryEntryUrlReader<T>;
  registry: Record<string, T>;
}) {
  const exactPageKey = input.match.pageKey?.trim() ?? "";

  if (exactPageKey) {
    const exactEntry = input.registry[exactPageKey];

    if (exactEntry) {
      return {
        key: exactPageKey,
        value: exactEntry,
      };
    }
  }

  const comparableCandidates = buildComparableCandidateSet(input.match);

  if (comparableCandidates.size === 0) {
    return null;
  }

  for (const [rawKey, entry] of Object.entries(input.registry)) {
    if (
      entryMatchesComparableCandidates({
        comparableCandidates,
        entry,
        rawKey,
        readEntryKey: input.readEntryKey,
        readEntryUrls: input.readEntryUrls,
      })
    ) {
      return {
        key: rawKey,
        value: entry,
      };
    }
  }

  return null;
}

export function collectTailorStorageRegistryKeys<T>(input: {
  match: RegistryMatchInput;
  readEntryKey: RegistryEntryKeyReader<T>;
  readEntryUrls: RegistryEntryUrlReader<T>;
  registry: Record<string, T>;
}) {
  const comparableCandidates = buildComparableCandidateSet(input.match);

  if (comparableCandidates.size === 0) {
    return [] as string[];
  }

  return Object.entries(input.registry)
    .filter(([rawKey, entry]) =>
      entryMatchesComparableCandidates({
        comparableCandidates,
        entry,
        rawKey,
        readEntryKey: input.readEntryKey,
        readEntryUrls: input.readEntryUrls,
      }),
    )
    .map(([rawKey]) => rawKey);
}

export function pruneRawTailorStorageRegistry<T>(input: {
  match: RegistryMatchInput;
  parse: RegistryParser<T>;
  readEntryKey: RegistryEntryKeyReader<T>;
  readEntryUrls: RegistryEntryUrlReader<T>;
  value: unknown;
}) {
  if (!isRecord(input.value)) {
    return {
      changed: false,
      value: null,
    };
  }

  const comparableCandidates = buildComparableCandidateSet(input.match);

  if (comparableCandidates.size === 0) {
    return {
      changed: false,
      value: input.value,
    };
  }

  let changed = false;
  const nextRegistry: Record<string, unknown> = {};

  for (const [rawKey, candidate] of Object.entries(input.value)) {
    const entry = input.parse(candidate);

    if (!entry) {
      changed = true;
      continue;
    }

    if (
      entryMatchesComparableCandidates({
        comparableCandidates,
        entry,
        rawKey,
        readEntryKey: input.readEntryKey,
        readEntryUrls: input.readEntryUrls,
      })
    ) {
      changed = true;
      continue;
    }

    nextRegistry[rawKey] = candidate;
  }

  return {
    changed,
    value: Object.keys(nextRegistry).length > 0 ? nextRegistry : null,
  };
}
