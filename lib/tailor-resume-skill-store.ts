import OpenAI from "openai";
import { getPrismaClient } from "./prisma.ts";
import { resumeTextIncludesKeyword } from "./tailor-resume-keyword-coverage.ts";
import { formatTailorResumeTermWithCapitalFirst } from "./tailor-resume-non-technologies.ts";
import {
  extractTailorResumeResumeExperiences,
  findTailorResumeResumeExperience,
} from "./tailor-resume-resume-experiences.ts";
import { buildTailorResumeKeywordClassificationInstructions } from "./tailor-resume-keyword-classification-prompt.ts";
import {
  findTailorResumeReplacementTarget,
  type TailorResumeReplacementTarget,
} from "./tailor-resume-replacement-target.ts";
import {
  normalizeTailorResumeKeywordKind,
  type TailorResumeKeywordClassificationRecord,
  type TailorResumeKeywordKind,
  type TailorResumeSkillRecord,
  type TailorResumeSpareBulletRecord,
  type TailorResumeStoredSkillData,
  type TailoredResumeEmphasizedTechnology,
  type TailoredResumeEmphasizedTechnologyPriority,
} from "./tailor-resume-types.ts";

export const tailorResumeKeywordKinds = [
  "skills_section",
  "narrative",
  "non_skill",
] as const satisfies TailorResumeKeywordKind[];

export {
  findTailorResumeReplacementTarget,
  type TailorResumeReplacementTarget,
};

const maxSpareBulletQuoteLength = 1_500;
const maxSpareBulletSkillCount = 12;
const dbKeywordKindByAppKind = {
  skills_section: "SKILLS_SECTION",
  narrative: "NARRATIVE",
  non_skill: "NON_SKILL",
} as const satisfies Record<TailorResumeKeywordKind, string>;
const dbKeywordPriorityByAppPriority = {
  high: "HIGH",
  low: "LOW",
} as const satisfies Record<TailoredResumeEmphasizedTechnologyPriority, string>;

function appKeywordKindFromDbKind(kind: string): TailorResumeKeywordKind {
  if (kind === "SKILLS_SECTION" || kind === "HARD") {
    return "skills_section";
  }

  if (kind === "NARRATIVE" || kind === "SOFT") {
    return "narrative";
  }

  return "non_skill";
}

function appKeywordPriorityFromDbPriority(
  priority: string | null,
): TailoredResumeEmphasizedTechnologyPriority | null {
  if (priority === "HIGH") {
    return "high";
  }

  if (priority === "LOW") {
    return "low";
  }

  return null;
}

export function normalizeTailorResumeSkillName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatSkillDisplayName(value: string) {
  const trimmed = value.normalize("NFKC").trim().replace(/\s+/g, " ");

  return trimmed || formatTailorResumeTermWithCapitalFirst(value);
}

function mapKeywordClassificationRecord(record: {
  id: string;
  kind: string;
  name: string;
  normalizedName: string;
  priority: string | null;
  updatedAt: Date;
}): TailorResumeKeywordClassificationRecord {
  return {
    id: record.id,
    kind: appKeywordKindFromDbKind(record.kind),
    name: record.name,
    normalizedName: record.normalizedName,
    priority: appKeywordPriorityFromDbPriority(record.priority),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapSkillRecord(record: {
  id: string;
  listInSkillsOnly: boolean;
  name: string;
  normalizedName: string;
  updatedAt: Date;
}): TailorResumeSkillRecord {
  return {
    id: record.id,
    listInSkillsOnly: record.listInSkillsOnly,
    name: record.name,
    normalizedName: record.normalizedName,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapSpareBulletRecord(record: {
  createdAt: Date;
  id: string;
  quote: string;
  replacesQuote: string | null;
  resumeExperienceId: string;
  skills: Array<{
    skill: {
      id: string;
      listInSkillsOnly: boolean;
      name: string;
      normalizedName: string;
      updatedAt: Date;
    };
    skillId: string;
  }>;
  updatedAt: Date;
}): TailorResumeSpareBulletRecord {
  const skills = record.skills.map((link) => mapSkillRecord(link.skill));

  return {
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    quote: record.quote,
    replacesQuote: record.replacesQuote,
    resumeExperienceId: record.resumeExperienceId,
    skillIds: skills.map((skill) => skill.id),
    skills,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function readTailorResumeStoredSkillData(input: {
  sourceAnnotatedLatexCode?: string | null;
  userId: string;
}): Promise<TailorResumeStoredSkillData> {
  const prisma = getPrismaClient();
  const [classificationRecords, skillRecords, spareBulletRecords] =
    await Promise.all([
      prisma.tailorResumeKeywordClassification.findMany({
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        where: { userId: input.userId },
      }),
      prisma.tailorResumeSkill.findMany({
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        where: { userId: input.userId },
      }),
      prisma.tailorResumeSpareBullet.findMany({
        include: {
          skills: {
            include: {
              skill: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        where: { userId: input.userId },
      }),
    ]);

  return {
    keywordClassifications: classificationRecords.map(
      mapKeywordClassificationRecord,
    ),
    resumeExperiences: input.sourceAnnotatedLatexCode
      ? extractTailorResumeResumeExperiences(input.sourceAnnotatedLatexCode)
      : [],
    skills: skillRecords.map(mapSkillRecord),
    spareBullets: spareBulletRecords.map(mapSpareBulletRecord),
    updatedAt: new Date().toISOString(),
  };
}

export async function readTailorResumeNonSkillClassificationNames(userId: string) {
  const records = await getPrismaClient().tailorResumeKeywordClassification.findMany({
    select: {
      name: true,
    },
    where: {
      kind: "NON_SKILL",
      userId,
    },
  });

  return records.map((record) => record.name);
}

async function upsertTailorResumeSkill(input: {
  listInSkillsOnly?: boolean;
  name: string;
  userId: string;
}) {
  const normalizedName = normalizeTailorResumeSkillName(input.name);
  const name = formatSkillDisplayName(input.name);

  if (!normalizedName || !name) {
    throw new Error("Provide a skill name.");
  }

  const prisma = getPrismaClient();

  await prisma.tailorResumeKeywordClassification.upsert({
    create: {
      kind: "SKILLS_SECTION",
      name,
      normalizedName,
      userId: input.userId,
    },
    update: {
      kind: "SKILLS_SECTION",
      name,
    },
    where: {
      userId_normalizedName: {
        normalizedName,
        userId: input.userId,
      },
    },
  });

  return prisma.tailorResumeSkill.upsert({
    create: {
      listInSkillsOnly: input.listInSkillsOnly === true,
      name,
      normalizedName,
      userId: input.userId,
    },
    update: {
      ...(typeof input.listInSkillsOnly === "boolean"
        ? { listInSkillsOnly: input.listInSkillsOnly }
        : {}),
      name,
    },
    where: {
      userId_normalizedName: {
        normalizedName,
        userId: input.userId,
      },
    },
  });
}

export async function saveTailorResumeKeywordClassification(input: {
  kind: TailorResumeKeywordKind;
  name: string;
  priority?: TailoredResumeEmphasizedTechnologyPriority | null;
  userId: string;
}) {
  const normalizedName = normalizeTailorResumeSkillName(input.name);
  const name = formatSkillDisplayName(input.name);

  if (!name || !normalizedName) {
    throw new Error("Provide a keyword name.");
  }

  if (!tailorResumeKeywordKinds.includes(input.kind)) {
    throw new Error("Choose skills-section, narrative, or non-skill.");
  }

  const priority =
    input.priority === "high" || input.priority === "low"
      ? input.priority
      : null;
  const priorityCreateValue =
    input.kind === "non_skill" || !priority
      ? null
      : dbKeywordPriorityByAppPriority[priority];
  const priorityUpdate =
    input.kind === "non_skill"
      ? { priority: null }
      : priority
        ? { priority: dbKeywordPriorityByAppPriority[priority] }
        : {};
  const prisma = getPrismaClient();
  const record = await prisma.tailorResumeKeywordClassification.upsert({
    create: {
      kind: dbKeywordKindByAppKind[input.kind],
      name,
      normalizedName,
      priority: priorityCreateValue,
      userId: input.userId,
    },
    update: {
      kind: dbKeywordKindByAppKind[input.kind],
      name,
      ...priorityUpdate,
    },
    where: {
      userId_normalizedName: {
        normalizedName,
        userId: input.userId,
      },
    },
  });

  if (input.kind === "skills_section") {
    await upsertTailorResumeSkill({
      name,
      userId: input.userId,
    });
  }

  return mapKeywordClassificationRecord(record);
}

function heuristicKeywordKind(term: TailoredResumeEmphasizedTechnology) {
  const normalizedName = normalizeTailorResumeSkillName(term.name);

  if (
    /\b(?:collaboration|communication|ownership|leadership|mentorship|fast paced|team player)\b/.test(
      normalizedName,
    )
  ) {
    return "non_skill" satisfies TailorResumeKeywordKind;
  }

  if (
    /\b(?:restful|api design|apis?|ci\/cd|scalability|scalable|distributed systems?|cloud infrastructure|production infrastructure|data structures?|algorithms?|microservices?|observability|reliability|testing|performance|security|agile|system design)\b/.test(
      normalizedName,
    )
  ) {
    return "narrative" satisfies TailorResumeKeywordKind;
  }

  return "skills_section" satisfies TailorResumeKeywordKind;
}

function isTestOpenAIResponseEnabled() {
  return ["1", "true", "yes", "on"].includes(
    process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase() ?? "",
  );
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

async function classifyUnknownKeywordsWithModel(
  technologies: TailoredResumeEmphasizedTechnology[],
): Promise<Map<string, TailorResumeKeywordKind>> {
  if (technologies.length === 0 || isTestOpenAIResponseEnabled()) {
    return new Map(
      technologies.map((technology) => [
        normalizeTailorResumeSkillName(technology.name),
        heuristicKeywordKind(technology),
      ]),
    );
  }

  try {
    const client = getOpenAIClient();
    const response = await client.responses.create({
      input: [
        {
          content: [
            {
              text:
                "Keywords to classify:\n\n" +
                JSON.stringify(
                  technologies.map((technology) => ({
                    evidence: technology.evidence,
                    name: technology.name,
                    priority: technology.priority,
                  })),
                  null,
                  2,
                ),
              type: "input_text",
            },
          ],
          role: "user",
        },
      ],
      instructions: buildTailorResumeKeywordClassificationInstructions(),
      model:
        process.env.OPENAI_TAILOR_RESUME_KEYWORD_CLASSIFICATION_MODEL ??
        process.env.OPENAI_TAILOR_RESUME_KEYWORD_MODEL ??
        "gpt-5.5",
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "tailor_resume_keyword_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              classifications: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    kind: {
                      enum: ["skills_section", "narrative", "non_skill"],
                      type: "string",
                    },
                    name: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["name", "kind", "reason"],
                },
              },
            },
            required: ["classifications"],
          },
        },
      },
    });
    const outputText = response.output_text?.trim();
    const parsed = outputText ? JSON.parse(outputText) : null;
    const classifications = Array.isArray(parsed?.classifications)
      ? parsed.classifications
      : [];
    const kindByName = new Map<string, TailorResumeKeywordKind>();

    for (const item of classifications) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const normalizedName =
        "name" in item && typeof item.name === "string"
          ? normalizeTailorResumeSkillName(item.name)
          : "";
      const kind =
        "kind" in item ? normalizeTailorResumeKeywordKind(item.kind) : null;

      if (normalizedName && kind) {
        kindByName.set(normalizedName, kind);
      }
    }

    return new Map(
      technologies.map((technology) => {
        const normalizedName = normalizeTailorResumeSkillName(technology.name);

        return [
          normalizedName,
          kindByName.get(normalizedName) ?? heuristicKeywordKind(technology),
        ] as const;
      }),
    );
  } catch {
    return new Map(
      technologies.map((technology) => [
        normalizeTailorResumeSkillName(technology.name),
        heuristicKeywordKind(technology),
      ]),
    );
  }
}

export async function classifyTailorResumeEmphasizedTechnologies(input: {
  legacyNonSkillNames?: readonly string[] | null;
  technologies: TailoredResumeEmphasizedTechnology[];
  userId: string;
}) {
  const normalizedLegacyNonSkills = new Set(
    (input.legacyNonSkillNames ?? []).map(normalizeTailorResumeSkillName),
  );
  const uniqueTechnologies = new Map<string, TailoredResumeEmphasizedTechnology>();

  for (const technology of input.technologies) {
    const normalizedName = normalizeTailorResumeSkillName(technology.name);

    if (!normalizedName) {
      continue;
    }

    const existing = uniqueTechnologies.get(normalizedName);

    if (!existing || (existing.priority === "low" && technology.priority === "high")) {
      uniqueTechnologies.set(normalizedName, technology);
    }
  }

  const technologies = [...uniqueTechnologies.values()];
  const normalizedNames = technologies.map((technology) =>
    normalizeTailorResumeSkillName(technology.name),
  );
  const prisma = getPrismaClient();
  const storedRecords = await prisma.tailorResumeKeywordClassification.findMany({
    where: {
      normalizedName: {
        in: normalizedNames,
      },
      userId: input.userId,
    },
  });
  const storedClassificationByName = new Map(
    storedRecords.map((record) => [
      record.normalizedName,
      {
        kind: appKeywordKindFromDbKind(record.kind),
        priority: appKeywordPriorityFromDbPriority(record.priority),
      },
    ] as const),
  );
  const unknownTechnologies = technologies.filter((technology) => {
    const normalizedName = normalizeTailorResumeSkillName(technology.name);

    return (
      !storedClassificationByName.has(normalizedName) &&
      !normalizedLegacyNonSkills.has(normalizedName)
    );
  });
  const modelClassifications =
    await classifyUnknownKeywordsWithModel(unknownTechnologies);

  for (const technology of technologies) {
    const normalizedName = normalizeTailorResumeSkillName(technology.name);
    const legacyKind = normalizedLegacyNonSkills.has(normalizedName)
      ? "non_skill"
      : null;
    const storedClassification = storedClassificationByName.get(normalizedName);
    const kind =
      storedClassification?.kind ??
      legacyKind ??
      modelClassifications.get(normalizedName) ??
      heuristicKeywordKind(technology);
    const priority =
      kind === "non_skill"
        ? technology.priority
        : storedClassification?.priority ?? technology.priority;

    await saveTailorResumeKeywordClassification({
      kind,
      name: technology.name,
      priority,
      userId: input.userId,
    });
    storedClassificationByName.set(normalizedName, {
      kind,
      priority: kind === "non_skill" ? null : priority,
    });
  }

  return technologies.map((technology) => {
    const classification = storedClassificationByName.get(
      normalizeTailorResumeSkillName(technology.name),
    );

    return {
      ...technology,
      classification: classification?.kind ?? heuristicKeywordKind(technology),
      priority:
        classification?.kind === "non_skill"
          ? technology.priority
          : classification?.priority ?? technology.priority,
    };
  });
}

function normalizeSkillNames(values: readonly string[] | null | undefined) {
  const skillsByNormalizedName = new Map<string, string>();

  for (const value of values ?? []) {
    const name = formatSkillDisplayName(value);
    const normalizedName = normalizeTailorResumeSkillName(name);

    if (!name || !normalizedName) {
      continue;
    }

    skillsByNormalizedName.set(normalizedName, name);
  }

  return [...skillsByNormalizedName.values()];
}

async function assertNoSpareBulletReplacementConflict(input: {
  excludeSpareBulletId?: string | null;
  replacesQuote: string;
  resumeExperienceId: string;
  sourceAnnotatedLatexCode: string;
  userId: string;
}) {
  const target = findTailorResumeReplacementTarget({
    resumeExperienceId: input.resumeExperienceId,
    sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
    sourceQuote: input.replacesQuote,
  });

  if (!target) {
    throw new Error(
      "Choose an experience with at least one bullet before saving a replacement bullet.",
    );
  }

  const existingModBullets =
    await getPrismaClient().tailorResumeSpareBullet.findMany({
      select: {
        id: true,
        replacesQuote: true,
      },
      where: {
        id: input.excludeSpareBulletId
          ? { not: input.excludeSpareBulletId }
          : undefined,
        replacesQuote: {
          not: null,
        },
        resumeExperienceId: input.resumeExperienceId,
        userId: input.userId,
      },
    });

  for (const existingBullet of existingModBullets) {
    const existingTarget = existingBullet.replacesQuote
      ? findTailorResumeReplacementTarget({
          resumeExperienceId: input.resumeExperienceId,
          sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
          sourceQuote: existingBullet.replacesQuote,
        })
      : null;

    if (existingTarget?.segmentId === target.segmentId) {
      throw new Error(
        [
          "Only one replacement spare bullet can target a source bullet.",
          `Both replacements currently match ${target.segmentId} (${Math.round(target.confidence * 100)}% confidence).`,
          "Edit the existing spare bullet to cover multiple skills-section keywords, or choose a different source bullet.",
        ].join(" "),
      );
    }
  }
}

export async function saveTailorResumeSkill(input: {
  listInSkillsOnly: boolean;
  name: string;
  userId: string;
}) {
  const skill = await upsertTailorResumeSkill({
    listInSkillsOnly: input.listInSkillsOnly,
    name: input.name,
    userId: input.userId,
  });

  return mapSkillRecord(skill);
}

export async function deleteTailorResumeSkill(input: {
  id: string;
  userId: string;
}) {
  const id = input.id.trim();

  if (!id) {
    throw new Error("Provide the skills-only keyword to remove.");
  }

  const prisma = getPrismaClient();
  const skill = await prisma.tailorResumeSkill.findFirst({
    select: {
      _count: {
        select: {
          spareBullets: true,
        },
      },
      id: true,
    },
    where: {
      id,
      userId: input.userId,
    },
  });

  if (!skill) {
    throw new Error("The skills-only keyword could not be found.");
  }

  if (skill._count.spareBullets > 0) {
    await prisma.tailorResumeSkill.update({
      data: {
        listInSkillsOnly: false,
      },
      where: {
        id: skill.id,
      },
    });
    return;
  }

  await prisma.tailorResumeSkill.delete({
    where: {
      id: skill.id,
    },
  });
}

export async function saveTailorResumeSpareBullet(input: {
  id?: string | null;
  quote: string;
  replacesQuote?: string | null;
  resumeExperienceId: string;
  skillNames: string[];
  sourceAnnotatedLatexCode: string;
  userId: string;
}) {
  const quote = input.quote.trim();
  const replacesQuote = input.replacesQuote?.trim() || null;
  const resumeExperienceId = input.resumeExperienceId.trim();
  const skillNames = normalizeSkillNames(input.skillNames);
  const experiences = extractTailorResumeResumeExperiences(
    input.sourceAnnotatedLatexCode,
  );

  if (!quote) {
    throw new Error("Provide the spare bullet text.");
  }

  if (quote.length > maxSpareBulletQuoteLength) {
    throw new Error(
      `Keep spare bullets under ${maxSpareBulletQuoteLength.toLocaleString()} characters.`,
    );
  }

  if (replacesQuote && replacesQuote.length > maxSpareBulletQuoteLength) {
    throw new Error(
      `Keep replacement source quotes under ${maxSpareBulletQuoteLength.toLocaleString()} characters.`,
    );
  }

  if (!findTailorResumeResumeExperience(experiences, resumeExperienceId)) {
    throw new Error("Choose the resume experience this spare bullet belongs to.");
  }

  if (skillNames.length === 0) {
    throw new Error(
      "Tag the spare bullet with at least one skills-section keyword.",
    );
  }

  if (skillNames.length > maxSpareBulletSkillCount) {
    throw new Error(
      `Tag each spare bullet with at most ${maxSpareBulletSkillCount.toLocaleString()} skills.`,
    );
  }

  if (replacesQuote) {
    await assertNoSpareBulletReplacementConflict({
      excludeSpareBulletId: input.id,
      replacesQuote,
      resumeExperienceId,
      sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
      userId: input.userId,
    });
  }

  const skills = await Promise.all(
    skillNames.map((name) =>
      upsertTailorResumeSkill({
        name,
        userId: input.userId,
      }),
    ),
  );
  const prisma = getPrismaClient();
  const existingId = input.id?.trim() || null;

  if (existingId) {
    const existing = await prisma.tailorResumeSpareBullet.findFirst({
      select: { id: true },
      where: {
        id: existingId,
        userId: input.userId,
      },
    });

    if (!existing) {
      throw new Error("The spare bullet could not be found.");
    }
  }

  const savedBullet = existingId
    ? await prisma.tailorResumeSpareBullet.update({
        data: {
          quote,
          replacesQuote,
          resumeExperienceId,
        },
        where: {
          id: existingId,
        },
      })
    : await prisma.tailorResumeSpareBullet.create({
        data: {
          quote,
          replacesQuote,
          resumeExperienceId,
          userId: input.userId,
        },
      });

  await prisma.tailorResumeSpareBulletSkill.deleteMany({
    where: {
      spareBulletId: savedBullet.id,
    },
  });

  await prisma.tailorResumeSpareBulletSkill.createMany({
    data: skills.map((skill) => ({
      skillId: skill.id,
      spareBulletId: savedBullet.id,
    })),
    skipDuplicates: true,
  });

  const record = await prisma.tailorResumeSpareBullet.findFirstOrThrow({
    include: {
      skills: {
        include: {
          skill: true,
        },
      },
    },
    where: {
      id: savedBullet.id,
      userId: input.userId,
    },
  });

  return mapSpareBulletRecord(record);
}

export async function deleteTailorResumeSpareBullet(input: {
  id: string;
  userId: string;
}) {
  const id = input.id.trim();

  if (!id) {
    throw new Error("Provide the spare bullet to delete.");
  }

  await getPrismaClient().tailorResumeSpareBullet.deleteMany({
    where: {
      id,
      userId: input.userId,
    },
  });
}

export async function buildTailorResumeSkillsSectionKeywordCoverage(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  originalResumeText: string;
  userId: string;
}) {
  const skillData = await readTailorResumeStoredSkillData({
    userId: input.userId,
  });
  const skillsByNormalizedName = new Map(
    skillData.skills.map((skill) => [skill.normalizedName, skill]),
  );
  const spareSkillNames = new Set(
    skillData.spareBullets.flatMap((spareBullet) =>
      spareBullet.skills.map((skill) => skill.normalizedName),
    ),
  );

  return input.emphasizedTechnologies.map((technology) => {
    const normalizedName = normalizeTailorResumeSkillName(technology.name);
    const skill = skillsByNormalizedName.get(normalizedName);
    const presentInResume = resumeTextIncludesKeyword({
      term: technology.name,
      text: input.originalResumeText,
    });
    const coveredBySpareBullet = spareSkillNames.has(normalizedName);
    const coveredBySkillsOnly = skill?.listInSkillsOnly === true;

    return {
      covered: presentInResume || coveredBySpareBullet || coveredBySkillsOnly,
      coveredBySkillsOnly,
      coveredBySpareBullet,
      presentInResume,
      technology,
    };
  });
}

export async function buildTailorResumeSkillEvidenceMarkdown(input: {
  sourceAnnotatedLatexCode?: string | null;
  userId: string;
}) {
  const skillData = await readTailorResumeStoredSkillData({ userId: input.userId });
  const sections: string[] = [];

  for (const spareBullet of skillData.spareBullets) {
    const skillNames = spareBullet.skills.map((skill) => skill.name).join(", ");
    const header = skillNames || "Spare bullet";
    const replacementTarget =
      spareBullet.replacesQuote && input.sourceAnnotatedLatexCode
        ? findTailorResumeReplacementTarget({
            resumeExperienceId: spareBullet.resumeExperienceId,
            sourceAnnotatedLatexCode: input.sourceAnnotatedLatexCode,
            sourceQuote: spareBullet.replacesQuote,
          })
        : null;
    const sourceLine = spareBullet.replacesQuote
      ? `\n  Source quote to replace: "${spareBullet.replacesQuote}"`
      : "";
    const targetLine = replacementTarget
      ? `\n  Fuzzy replacement target: segmentId ${replacementTarget.segmentId}; confidence ${Math.round(replacementTarget.confidence * 100)}%; current text "${replacementTarget.currentText}"`
      : "";

    sections.push(
      [
        `## ${header}`,
        `- Resume experience id: ${spareBullet.resumeExperienceId}`,
        `- Candidate spare bullet: "${spareBullet.quote}"${sourceLine}${targetLine}`,
      ].join("\n"),
    );
  }

  for (const skill of skillData.skills) {
    if (!skill.listInSkillsOnly) {
      continue;
    }

    sections.push(
      [
        `## ${skill.name}`,
        `- Can list ${skill.name} in the Skills section without adding or replacing an experience bullet.`,
      ].join("\n"),
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return [
    "## Structured skills-section keyword support",
    "The following entries come from first-class skills-section support objects, not USER.md. Treat quoted spare bullets as user-approved evidence candidates.",
    ...sections,
  ].join("\n\n");
}
