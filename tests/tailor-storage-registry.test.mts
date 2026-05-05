import assert from "node:assert/strict";
import test from "node:test";
import { buildTailorRunRegistryKey } from "../extension/src/tailor-run-registry.ts";
import {
  collectTailorStorageRegistryKeys,
  findTailorStorageRegistryEntry,
  normalizeTailorStorageRegistry,
  pruneRawTailorStorageRegistry,
} from "../extension/src/tailor-storage-registry.ts";

type DummyEntry = {
  capturedAt: string;
  pageUrl: string | null;
};

function parseDummyEntry(value: unknown): DummyEntry | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { capturedAt?: unknown }).capturedAt !== "string"
  ) {
    return null;
  }

  return {
    capturedAt: (value as { capturedAt: string }).capturedAt,
    pageUrl:
      typeof (value as { pageUrl?: unknown }).pageUrl === "string"
        ? (value as { pageUrl: string }).pageUrl
        : null,
  };
}

function readDummyEntryKey(entry: DummyEntry, rawKey: string) {
  return buildTailorRunRegistryKey(entry.pageUrl) ?? buildTailorRunRegistryKey(rawKey);
}

function readDummyEntryUrls(entry: DummyEntry) {
  return [entry.pageUrl];
}

test("normalizes legacy Tailor storage keys onto one comparable URL", () => {
  const legacyKey =
    "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com";
  const normalizedKey = "https://apply.careers.microsoft.com/careers/job/123";
  const result = normalizeTailorStorageRegistry({
    compareEntries: (left, right) =>
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
    parse: parseDummyEntry,
    readEntryKey: readDummyEntryKey,
    value: {
      [legacyKey]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: legacyKey,
      },
      [normalizedKey]: {
        capturedAt: "2026-04-26T18:05:00.000Z",
        pageUrl: normalizedKey,
      },
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.registry), [normalizedKey]);
  assert.equal(result.registry[normalizedKey]?.capturedAt, "2026-04-26T18:05:00.000Z");
});

test("finds the current-page registry entry even when the stored key is legacy", () => {
  const legacyKey =
    "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com";
  const entry = findTailorStorageRegistryEntry({
    match: {
      pageIdentity: {
        canonicalUrl: "http://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com",
        jobUrl: "http://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com",
        pageUrl: legacyKey,
      },
      pageKey: "https://apply.careers.microsoft.com/careers/job/123",
    },
    readEntryKey: readDummyEntryKey,
    readEntryUrls: readDummyEntryUrls,
    registry: {
      [legacyKey]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: legacyKey,
      },
    },
  });

  assert.equal(entry?.key, legacyKey);
  assert.equal(entry?.value.pageUrl, legacyKey);
});

test("finds a saved registry entry when the current page is a nested apply URL", () => {
  const savedUrl = "https://jobs.example.com/roles/123";
  const entry = findTailorStorageRegistryEntry({
    match: {
      pageIdentity: {
        canonicalUrl: "https://jobs.example.com/roles/123/apply",
        jobUrl: null,
        pageUrl: "https://jobs.example.com/roles/123/apply?utm_source=extension",
      },
    },
    readEntryKey: readDummyEntryKey,
    readEntryUrls: readDummyEntryUrls,
    registry: {
      [savedUrl]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: savedUrl,
      },
    },
  });

  assert.equal(entry?.key, savedUrl);
  assert.equal(entry?.value.pageUrl, savedUrl);
});

test("collects saved registry keys under the current nested apply URL", () => {
  const savedUrl = "https://jobs.example.com/roles/123";
  const matchingKeys = collectTailorStorageRegistryKeys({
    match: {
      pageIdentity: {
        canonicalUrl: null,
        jobUrl: null,
        pageUrl: "https://jobs.example.com/roles/123/apply",
      },
    },
    readEntryKey: readDummyEntryKey,
    readEntryUrls: readDummyEntryUrls,
    registry: {
      [savedUrl]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: savedUrl,
      },
      "https://jobs.example.com/roles/456": {
        capturedAt: "2026-04-26T18:05:00.000Z",
        pageUrl: "https://jobs.example.com/roles/456",
      },
    },
  });

  assert.deepEqual(matchingKeys, [savedUrl]);
});

test("collects all matching registry keys for one comparable job URL", () => {
  const legacyKey =
    "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com";
  const normalizedKey = "https://apply.careers.microsoft.com/careers/job/123";
  const matchingKeys = collectTailorStorageRegistryKeys({
    match: {
      jobUrl: legacyKey,
      pageKey: normalizedKey,
    },
    readEntryKey: readDummyEntryKey,
    readEntryUrls: readDummyEntryUrls,
    registry: {
      [legacyKey]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: legacyKey,
      },
      [normalizedKey]: {
        capturedAt: "2026-04-26T18:05:00.000Z",
        pageUrl: normalizedKey,
      },
      "https://example.com/other-job": {
        capturedAt: "2026-04-26T18:10:00.000Z",
        pageUrl: "https://example.com/other-job",
      },
    },
  });

  assert.deepEqual(matchingKeys.sort(), [legacyKey, normalizedKey].sort());
});

test("prunes raw storage entries for every matching legacy/current key", () => {
  const legacyKey =
    "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com";
  const normalizedKey = "https://apply.careers.microsoft.com/careers/job/123";
  const pruned = pruneRawTailorStorageRegistry({
    match: {
      jobUrl: normalizedKey,
      pageKey: normalizedKey,
    },
    parse: parseDummyEntry,
    readEntryKey: readDummyEntryKey,
    readEntryUrls: readDummyEntryUrls,
    value: {
      [legacyKey]: {
        capturedAt: "2026-04-26T18:00:00.000Z",
        pageUrl: legacyKey,
      },
      [normalizedKey]: {
        capturedAt: "2026-04-26T18:05:00.000Z",
        pageUrl: normalizedKey,
      },
    },
  });

  assert.equal(pruned.changed, true);
  assert.equal(pruned.value, null);
});
