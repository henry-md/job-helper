import assert from "node:assert/strict";
import test from "node:test";
import {
  filterTailorResumeSpareBulletsForSearch,
  scoreTailorResumeSpareBulletSearch,
} from "../lib/tailor-resume-spare-bullet-search.ts";
import type {
  TailorResumeSkillRecord,
  TailorResumeSpareBulletRecord,
} from "../lib/tailor-resume-types.ts";

const now = "2026-05-08T12:00:00.000Z";

function skill(name: string): TailorResumeSkillRecord {
  return {
    id: `skill-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    listInSkillsOnly: false,
    name,
    normalizedName: name.toLowerCase(),
    updatedAt: now,
  };
}

function spareBullet(input: {
  id: string;
  quote: string;
  replacesQuote?: string | null;
  skills: TailorResumeSkillRecord[];
}): TailorResumeSpareBulletRecord {
  return {
    createdAt: now,
    id: input.id,
    quote: input.quote,
    replacesQuote: input.replacesQuote ?? null,
    resumeExperienceId: "work-experience.entry-1",
    skillIds: input.skills.map((item) => item.id),
    skills: input.skills,
    updatedAt: now,
  };
}

const kubernetes = skill("Kubernetes");
const postgres = skill("PostgreSQL");
const redis = skill("Redis");

const spareBullets = [
  spareBullet({
    id: "kubernetes-platform",
    quote:
      "Deployed Kubernetes-backed services with PostgreSQL persistence for review workflows.",
    replacesQuote:
      "Built backend review workflows with persistent storage and low-latency APIs.",
    skills: [kubernetes, postgres],
  }),
  spareBullet({
    id: "cache-observability",
    quote:
      "Added cache hit instrumentation and release dashboards for distributed services.",
    skills: [redis],
  }),
];

test("filters resume bullets by associated skill names", () => {
  const results = filterTailorResumeSpareBulletsForSearch({
    mode: "skills",
    query: "kube",
    spareBullets,
  });

  assert.deepEqual(
    results.map((item) => item.id),
    ["kubernetes-platform"],
  );
});

test("body-only mode searches bullet and replacement text without skill names", () => {
  assert.deepEqual(
    filterTailorResumeSpareBulletsForSearch({
      mode: "body",
      query: "persistent storage",
      spareBullets,
    }).map((item) => item.id),
    ["kubernetes-platform"],
  );

  assert.deepEqual(
    filterTailorResumeSpareBulletsForSearch({
      mode: "body",
      query: "redis",
      spareBullets,
    }).map((item) => item.id),
    [],
  );
});

test("both mode searches skills and body text", () => {
  assert.deepEqual(
    filterTailorResumeSpareBulletsForSearch({
      mode: "both",
      query: "redis",
      spareBullets,
    }).map((item) => item.id),
    ["cache-observability"],
  );

  assert.deepEqual(
    filterTailorResumeSpareBulletsForSearch({
      mode: "both",
      query: "release dashboards",
      spareBullets,
    }).map((item) => item.id),
    ["cache-observability"],
  );
});

test("fuzzy scoring ranks stronger resume bullet matches first", () => {
  assert.equal(
    scoreTailorResumeSpareBulletSearch({
      mode: "skills",
      query: "kbrnts",
      spareBullet: spareBullets[0],
    }) > 0,
    true,
  );

  assert.deepEqual(
    filterTailorResumeSpareBulletsForSearch({
      mode: "both",
      query: "postgre",
      spareBullets,
    }).map((item) => item.id),
    ["kubernetes-platform"],
  );
});
