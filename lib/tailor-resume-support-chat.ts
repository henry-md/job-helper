import OpenAI from "openai";
import { getPrismaClient } from "./prisma.ts";
import {
  maxTailorResumeChatMessageLength,
  type TailorResumeChatMessageRecord,
  type TailorResumeChatPageContext,
} from "./tailor-resume-chat.ts";
import { buildTailorResumePlanningSnapshot } from "./tailor-resume-planning.ts";
import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import { readTailorResumeProfileState } from "./tailor-resume-profile-state.ts";
import { buildTailorResumeRunStepUpdate } from "./tailor-resume-run-step.ts";
import {
  buildTailorResumeSkillsSectionKeywordCoverage,
  classifyTailorResumeEmphasizedTechnologies,
  readTailorResumeStoredSkillData,
  saveTailorResumeSkill,
  saveTailorResumeSpareBullet,
} from "./tailor-resume-skill-store.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
} from "./tailor-resume-segmentation.ts";
import {
  defaultTailorResumeUserMarkdown,
  readTailorResumeUserMarkdown,
} from "./tailor-resume-user-memory.ts";
import {
  isTailorResumeInterviewPendingQuestionStart,
  isTailorResumeInterviewReady,
  readTailorResumeWorkspaceInterviews,
  withTailorResumeWorkspaceInterviews,
} from "./tailor-resume-workspace-interviews.ts";
import {
  withTailorResumeProfileLock,
  writeTailorResumeProfile,
} from "./tailor-resume-storage.ts";
import { bumpUserSyncState } from "./user-sync-state.ts";
import type {
  TailorResumeGenerationStepEvent,
  TailorResumePendingInterview,
  TailorResumeProfile,
  TailorResumeStoredSkillData,
  TailoredResumeEmphasizedTechnology,
} from "./tailor-resume-types.ts";

export const tailorResumeSupportChatUrl = "job-helper://resume-support-chat";
export const tailorResumeSupportChatPageTitle = "Resume support";

const maxSupportChatToolRounds = 8;
const maxSupportChatUserMarkdownLength = 14_000;
const maxSupportChatPageContextLength = 14_000;
const maxSupportChatSkillSummaryLength = 16_000;
const maxSupportChatLatexLength = 80_000;
const listSkillSupportToolName = "list_resume_skill_support";
const listResumeExperiencesToolName = "list_resume_experiences";
const getCurrentLatexResumeToolName = "get_current_latex_resume";
const createSkillsSectionSkillToolName = "create_skills_section_skill";
const createResumeBulletSupportToolName = "create_resume_bullet_support";

type SupportChatResponseInput = Array<
  | {
      call_id: string;
      output: string;
      type: "function_call_output";
    }
  | {
      content: Array<{
        text: string;
        type: "input_text";
      }>;
      role: "user";
    }
>;

type SupportChatResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    arguments?: string;
    call_id?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    name?: string;
    type?: string;
  }>;
  output_text?: string;
};

type SupportChatToolCall = {
  arguments: string;
  call_id: string;
  name: string;
};

export type TailorResumeSupportChatToolCallRecord = {
  argumentsText: string;
  name: string;
};

type SupportChatToolResult = {
  output: unknown;
  skillData?: TailorResumeStoredSkillData | null;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to your environment before using resume chat.",
    );
  }

  return new OpenAI({ apiKey });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown) {
  return value === true;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter(Boolean);
}

function truncateWithNotice(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[Context truncated for length.]`;
}

function readCurrentAnnotatedLatexCode(profile: TailorResumeProfile) {
  const storedAnnotatedLatexCode = profile.annotatedLatex.code.trim();

  if (storedAnnotatedLatexCode) {
    return storedAnnotatedLatexCode;
  }

  return normalizeTailorResumeLatex(profile.latex.code).annotatedLatex;
}

function readCurrentLatexCode(profile: TailorResumeProfile) {
  const latexCode = profile.latex.code.trim();

  if (latexCode) {
    return latexCode;
  }

  const annotatedLatexCode = profile.annotatedLatex.code.trim();

  return annotatedLatexCode ? stripTailorResumeSegmentIds(annotatedLatexCode) : "";
}

async function readCurrentResumeContext(userId: string) {
  const { rawProfile } = await readTailorResumeProfileState(userId);
  const annotatedLatexCode = readCurrentAnnotatedLatexCode(rawProfile);
  const latexCode = readCurrentLatexCode(rawProfile);

  return {
    annotatedLatexCode,
    latexCode,
    profile: rawProfile,
  };
}

function isMeaningfulUserMarkdown(markdown: string) {
  const withoutDefaultHeading = markdown
    .replace(defaultTailorResumeUserMarkdown, "")
    .replace(/^#\s*USER\.md\s*/i, "")
    .trim();

  return withoutDefaultHeading.length > 0;
}

async function buildUserMarkdownContext(userId: string) {
  const userMarkdown = await readTailorResumeUserMarkdown(userId);

  if (!isMeaningfulUserMarkdown(userMarkdown.markdown)) {
    return "";
  }

  return truncateWithNotice(
    userMarkdown.markdown.trim(),
    maxSupportChatUserMarkdownLength,
  );
}

function formatSkillSupportSummary(skillData: TailorResumeStoredSkillData) {
  const sections = [
    `Skills-section keywords (${skillData.skills.length}):\n${
      skillData.skills.length > 0
        ? skillData.skills
            .slice(0, 80)
            .map((skill) =>
              `- ${skill.name}${skill.listInSkillsOnly ? " (skills-only support)" : ""}`,
            )
            .join("\n")
        : "[None saved.]"
    }`,
    `Resume experience categories (${skillData.resumeExperiences.length}):\n${
      skillData.resumeExperiences.length > 0
        ? skillData.resumeExperiences
            .map(
              (experience) =>
                `- ${experience.id}: ${experience.label} (${experience.bulletSegmentIds.length} bullets)`,
            )
            .join("\n")
        : "[No resume experiences found. The user may need to upload or fix the source resume first.]"
    }`,
    `Saved resume bullet support (${skillData.spareBullets.length}):\n${
      skillData.spareBullets.length > 0
        ? skillData.spareBullets
            .slice(0, 40)
            .map((spareBullet) => {
              const skills = spareBullet.skills.map((skill) => skill.name).join(", ");
              const replacement = spareBullet.replacesQuote
                ? ` replaces "${spareBullet.replacesQuote}"`
                : " new bullet";

              return `- ${spareBullet.resumeExperienceId}; ${skills};${replacement}: "${spareBullet.quote}"`;
            })
            .join("\n")
        : "[None saved.]"
    }`,
  ];

  return truncateWithNotice(sections.join("\n\n"), maxSupportChatSkillSummaryLength);
}

function buildSupportChatPageContext(pageContext: TailorResumeChatPageContext | null) {
  if (!pageContext) {
    return "";
  }

  const sections = [
    pageContext.url ? `URL: ${pageContext.url}` : null,
    pageContext.title ? `Title: ${pageContext.title}` : null,
    pageContext.siteName ? `Site: ${pageContext.siteName}` : null,
    pageContext.description ? `Description: ${pageContext.description}` : null,
    pageContext.selectionText
      ? `Selected text:\n${pageContext.selectionText}`
      : null,
    pageContext.topTextBlocks.length > 0
      ? `Top visible sections:\n${pageContext.topTextBlocks
          .slice(0, 4)
          .map((block, index) => `Section ${index + 1}:\n${block}`)
          .join("\n\n")}`
      : null,
    pageContext.rawText ? `Flattened page text:\n${pageContext.rawText}` : null,
  ].filter((section): section is string => Boolean(section));

  return truncateWithNotice(sections.join("\n\n"), maxSupportChatPageContextLength);
}

function buildConversationTranscript(input: {
  currentUserMessage: string;
  previousMessages: TailorResumeChatMessageRecord[];
}) {
  const messages = [
    ...input.previousMessages,
    {
      content: input.currentUserMessage,
      createdAt: new Date().toISOString(),
      id: "current",
      model: null,
      role: "user" as const,
    },
  ];

  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `${speaker}: ${message.content.trim()}`;
    })
    .join("\n\n");
}

function buildTailorResumeSupportChatInstructions() {
  return [
    "You are Job Helper Resume Chat, a top-level assistant inside the Chrome extension.",
    "Your main job is to maintain durable user skill support for Tailor Resume. The user may ask you to add skills-section keywords, create reusable resume bullet support, or inspect the current resume.",
    "Most important taxonomy rule: `skills_section` means the exact keyword is something that could reasonably appear in the Skills, Technical Skills, Tools, Certifications, or similar skills portion of the resume. Examples include languages, frameworks, libraries, databases, cloud platforms, infrastructure tools, developer tools, certifications, spoken languages, and named technical methods.",
    "`narrative` means a job-relevant phrase that belongs in experience bullets or story framing but usually would not stand alone in the Skills section. `non_skill` means it is not a resume skill keyword.",
    "When the user asks you to save, add, remember, create, or install skills-section support, use the function tools. Do not merely explain that the user can use Settings. The tool calls are how you create persistent user skills and resume-bullet support.",
    "Use `create_skills_section_skill` for a concrete skills-section keyword that the user says can be listed in Skills without needing a new experience bullet. Set `listInSkillsOnly` to true when it is intended to clear a skills-section blocker by allowing a Skills-section entry on its own.",
    "Use `create_resume_bullet_support` when the keyword needs a new or modified resume bullet. A valid bullet support record needs the bullet text, one or more skills-section keywords, and an allowed `resumeExperienceId`.",
    "Call `list_resume_experiences` before creating resume bullet support unless the correct resumeExperienceId is already present in the conversation. If the user names an employer, role, or project instead of an id, fetch the categories and map it to the closest unambiguous id; ask a short clarification if there are multiple plausible matches.",
    "For modified-bullet support, `replacesQuote` must be the current source bullet being replaced or a close quote from it. Use `list_resume_experiences` or `get_current_latex_resume` when you need to inspect current source bullets.",
    "Use `get_current_latex_resume` when the user asks to inspect the full current LaTeX resume, when exact source wording matters, or when you need source context that is not in the short summaries.",
    "Never invent user experience. If the user has not provided enough factual evidence for a bullet, ask for the missing facts instead of saving a fabricated bullet.",
    "After a tool succeeds, briefly summarize exactly what changed. If a tool returns an error, explain the blocker and the next piece of information needed.",
    "Keep responses concise and practical.",
  ].join("\n");
}

function buildTailorResumeSupportChatInput(input: {
  currentUserMessage: string;
  pageContext: TailorResumeChatPageContext | null;
  previousMessages: TailorResumeChatMessageRecord[];
  skillData: TailorResumeStoredSkillData;
  userMarkdown: string;
}) {
  const pageContext = buildSupportChatPageContext(input.pageContext);
  const contextSections = [
    `Current durable skill support:\n${formatSkillSupportSummary(input.skillData)}`,
    input.userMarkdown ? `USER.md memory:\n${input.userMarkdown}` : null,
    pageContext
      ? `Current browser page context, if useful:\n${pageContext}`
      : "Current browser page context: [No regular job page is attached.]",
    `Conversation:\n${buildConversationTranscript({
      currentUserMessage: input.currentUserMessage,
      previousMessages: input.previousMessages,
    })}`,
  ].filter((section): section is string => Boolean(section));

  return [
    {
      content: [
        {
          text: contextSections.join("\n\n---\n\n"),
          type: "input_text" as const,
        },
      ],
      role: "user" as const,
    },
  ];
}

function readOutputText(response: SupportChatResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  return (
    response.output
      ?.flatMap((item) =>
        item.content?.flatMap((contentItem) =>
          typeof contentItem.text === "string" ? [contentItem.text] : [],
        ) ?? [],
      )
      .join("")
      .trim() ?? ""
  );
}

function readSupportChatToolCall(response: SupportChatResponse) {
  const toolCall = response.output?.find(
    (item) =>
      item.type === "function_call" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string" &&
      typeof item.call_id === "string",
  );

  if (!toolCall?.name || !toolCall.arguments || !toolCall.call_id) {
    return null;
  }

  return {
    arguments: toolCall.arguments,
    call_id: toolCall.call_id,
    name: toolCall.name,
  } satisfies SupportChatToolCall;
}

function serializeSupportChatToolCall(
  toolCall: SupportChatToolCall,
): TailorResumeSupportChatToolCallRecord {
  let argumentsText = toolCall.arguments;

  try {
    argumentsText = JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
  } catch {
    // Keep the raw arguments when the model returned non-JSON tool data.
  }

  return {
    argumentsText,
    name: toolCall.name,
  };
}

function parseToolArguments(toolCall: SupportChatToolCall) {
  try {
    const parsed = JSON.parse(toolCall.arguments) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasTailorResumeQuestionTechnologyListChanged(
  before: TailoredResumeEmphasizedTechnology[] | undefined,
  after: TailoredResumeEmphasizedTechnology[],
) {
  return JSON.stringify(before ?? []) !== JSON.stringify(after);
}

function formatSkillsSectionBlockerCount(count: number) {
  return `${count} skills-section ${count === 1 ? "blocker" : "blockers"}`;
}

async function buildUncoveredTailorResumeQuestionTechnologies(input: {
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  resumePlainText: string;
  userId: string;
}) {
  const blockingSkillsSectionTechnologies = input.emphasizedTechnologies.filter(
    (technology) => technology.classification === "skills_section",
  );
  const coverage = await buildTailorResumeSkillsSectionKeywordCoverage({
    emphasizedTechnologies: blockingSkillsSectionTechnologies,
    originalResumeText: input.resumePlainText,
    userId: input.userId,
  });

  return coverage.filter((term) => !term.covered).map((term) => term.technology);
}

async function markTailoringChanged(userId: string) {
  await bumpUserSyncState({
    tailoring: true,
    userId,
  });
}

async function updateTailorResumeRunStep(input: {
  event: TailorResumeGenerationStepEvent;
  runId: string | null;
  userId: string;
}) {
  if (!input.runId) {
    await markTailoringChanged(input.userId);
    return;
  }

  const updatedRuns = await getPrismaClient().tailorResumeRun.updateMany({
    data: buildTailorResumeRunStepUpdate(input.event),
    where: {
      id: input.runId,
      status: {
        in: ["RUNNING", "NEEDS_INPUT"],
      },
      userId: input.userId,
    },
  });

  if (updatedRuns.count > 0) {
    await markTailoringChanged(input.userId);
  }
}

async function reevaluateTailorResumeSkillSupportCheckpoints(userId: string) {
  return withTailorResumeProfileLock(userId, async () => {
    const { rawProfile } = await readTailorResumeProfileState(userId);
    const interviews = readTailorResumeWorkspaceInterviews(rawProfile.workspace);

    if (interviews.length === 0) {
      await markTailoringChanged(userId);
      return rawProfile;
    }

    let changed = false;
    const nextInterviews: TailorResumePendingInterview[] = [];

    for (const interview of interviews) {
      if (
        !isTailorResumeInterviewPendingQuestionStart(interview) &&
        !isTailorResumeInterviewReady(interview)
      ) {
        nextInterviews.push(interview);
        continue;
      }

      const classifiedTechnologies =
        await classifyTailorResumeEmphasizedTechnologies({
          technologies: interview.planningResult.emphasizedTechnologies,
          userId,
        });
      const planningSnapshot = buildTailorResumePlanningSnapshot(
        interview.sourceAnnotatedLatexCode,
      );
      const uncoveredEmphasizedTechnologies =
        await buildUncoveredTailorResumeQuestionTechnologies({
          emphasizedTechnologies: classifiedTechnologies,
          resumePlainText: planningSnapshot.resumePlainText,
          userId,
        });
      const nextStatus =
        uncoveredEmphasizedTechnologies.length > 0 ? "pending" : "ready";
      const nextInterview: TailorResumePendingInterview = {
        ...interview,
        planningResult: {
          ...interview.planningResult,
          emphasizedTechnologies: classifiedTechnologies,
        },
        status: nextStatus,
        uncoveredEmphasizedTechnologies,
        updatedAt: new Date().toISOString(),
      };
      const interviewChanged =
        interview.status !== nextInterview.status ||
        hasTailorResumeQuestionTechnologyListChanged(
          interview.uncoveredEmphasizedTechnologies,
          uncoveredEmphasizedTechnologies,
        ) ||
        hasTailorResumeQuestionTechnologyListChanged(
          interview.planningResult.emphasizedTechnologies,
          classifiedTechnologies,
        );

      if (interviewChanged) {
        changed = true;
        await updateTailorResumeRunStep({
          event: {
            attempt: null,
            blockingTechnologies: uncoveredEmphasizedTechnologies,
            detail:
              uncoveredEmphasizedTechnologies.length > 0
                ? `Waiting on ${formatSkillsSectionBlockerCount(uncoveredEmphasizedTechnologies.length)}.`
                : "All skills-section keywords are covered. Press play to start tailoring.",
            durationMs: 0,
            emphasizedTechnologies: classifiedTechnologies,
            retrying: false,
            status: "running",
            stepCount: 5,
            stepNumber: 2,
            summary: "Review classified keywords",
          },
          runId: interview.tailorResumeRunId,
          userId,
        });
      }

      nextInterviews.push(interviewChanged ? nextInterview : interview);
    }

    if (!changed) {
      await markTailoringChanged(userId);
      return rawProfile;
    }

    const nextRawProfile: TailorResumeProfile = {
      ...rawProfile,
      workspace: withTailorResumeWorkspaceInterviews(
        rawProfile.workspace,
        nextInterviews,
        new Date().toISOString(),
      ),
    };

    await writeTailorResumeProfile(userId, nextRawProfile);
    await markTailoringChanged(userId);

    return nextRawProfile;
  });
}

async function readFreshSkillData(userId: string) {
  const { annotatedLatexCode } = await readCurrentResumeContext(userId);

  return readTailorResumeStoredSkillData({
    sourceAnnotatedLatexCode: annotatedLatexCode,
    userId,
  });
}

async function executeSupportChatToolCall(input: {
  toolCall: SupportChatToolCall;
  userId: string;
}): Promise<SupportChatToolResult> {
  const args = parseToolArguments(input.toolCall);

  try {
    if (input.toolCall.name === listSkillSupportToolName) {
      const skillData = await readFreshSkillData(input.userId);

      return {
        output: {
          ok: true,
          skillData,
        },
      };
    }

    if (input.toolCall.name === getCurrentLatexResumeToolName) {
      const includeSegmentIds = readBoolean(args.includeSegmentIds);
      const { annotatedLatexCode, latexCode, profile } =
        await readCurrentResumeContext(input.userId);

      return {
        output: {
          annotatedLatexCode: includeSegmentIds
            ? truncateWithNotice(annotatedLatexCode, maxSupportChatLatexLength)
            : null,
          hasResume: Boolean(profile.resume),
          latexCode: truncateWithNotice(latexCode, maxSupportChatLatexLength),
          ok: true,
          status: profile.latex.status,
          updatedAt: profile.latex.updatedAt,
        },
      };
    }

    if (input.toolCall.name === listResumeExperiencesToolName) {
      const { annotatedLatexCode } = await readCurrentResumeContext(input.userId);
      const skillData = await readTailorResumeStoredSkillData({
        sourceAnnotatedLatexCode: annotatedLatexCode,
        userId: input.userId,
      });
      const blocks = readAnnotatedTailorResumeBlocks(annotatedLatexCode);
      const blocksById = new Map(blocks.map((block) => [block.id, block]));

      return {
        output: {
          experiences: skillData.resumeExperiences.map((experience) => ({
            bulletCount: experience.bulletSegmentIds.length,
            bullets: experience.bulletSegmentIds.flatMap((segmentId) => {
              const block = blocksById.get(segmentId);

              if (!block) {
                return [];
              }

              return [
                {
                  segmentId,
                  text: renderTailoredResumeLatexToPlainText(block.latexCode),
                },
              ];
            }),
            headingSegmentId: experience.headingSegmentId,
            id: experience.id,
            label: experience.label,
          })),
          ok: true,
        },
      };
    }

    if (input.toolCall.name === createSkillsSectionSkillToolName) {
      const name = readString(args.name);
      const listInSkillsOnly = readBoolean(args.listInSkillsOnly);

      if (!name) {
        return {
          output: {
            error: "Provide the skills-section keyword name.",
            ok: false,
          },
        };
      }

      const skill = await saveTailorResumeSkill({
        listInSkillsOnly,
        name,
        userId: input.userId,
      });

      await reevaluateTailorResumeSkillSupportCheckpoints(input.userId);
      const skillData = await readFreshSkillData(input.userId);

      return {
        output: {
          listInSkillsOnly,
          ok: true,
          skill,
          skillData,
        },
        skillData,
      };
    }

    if (input.toolCall.name === createResumeBulletSupportToolName) {
      const quote = readString(args.quote);
      const replacesQuote = readString(args.replacesQuote) || null;
      const resumeExperienceId = readString(args.resumeExperienceId);
      const skillNames = readStringArray(args.skillNames);
      const { annotatedLatexCode } = await readCurrentResumeContext(input.userId);

      const spareBullet = await saveTailorResumeSpareBullet({
        quote,
        replacesQuote,
        resumeExperienceId,
        skillNames,
        sourceAnnotatedLatexCode: annotatedLatexCode,
        userId: input.userId,
      });

      await reevaluateTailorResumeSkillSupportCheckpoints(input.userId);
      const skillData = await readFreshSkillData(input.userId);

      return {
        output: {
          ok: true,
          skillData,
          spareBullet,
        },
        skillData,
      };
    }

    return {
      output: {
        error: `Unknown tool: ${input.toolCall.name}`,
        ok: false,
      },
    };
  } catch (error) {
    return {
      output: {
        error:
          error instanceof Error
            ? error.message
            : "The resume support tool failed.",
        ok: false,
      },
    };
  }
}

const supportChatTools = [
  {
    description:
      "Fetch the user's current saved skills-section keywords, saved resume bullet support, keyword classifications, and allowed resume experience categories.",
    name: listSkillSupportToolName,
    parameters: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    },
    strict: true,
    type: "function",
  },
  {
    description:
      "Fetch the allowed resumeExperienceId categories from the current source resume, including current bullet text under each experience.",
    name: listResumeExperiencesToolName,
    parameters: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    },
    strict: true,
    type: "function",
  },
  {
    description:
      "Fetch the full current source LaTeX resume. Use includeSegmentIds when source segment ids are useful for exact placement or debugging.",
    name: getCurrentLatexResumeToolName,
    parameters: {
      additionalProperties: false,
      properties: {
        includeSegmentIds: {
          description:
            "Whether to include the annotated LaTeX with resume segment ids in addition to the clean saved LaTeX.",
          type: "boolean",
        },
        reason: {
          description: "Why the full current LaTeX is needed.",
          type: "string",
        },
      },
      required: ["includeSegmentIds", "reason"],
      type: "object",
    },
    strict: true,
    type: "function",
  },
  {
    description:
      "Create or update a durable skills-section keyword that can be used by Tailor Resume. This is for exact terms that could go in the resume's Skills section.",
    name: createSkillsSectionSkillToolName,
    parameters: {
      additionalProperties: false,
      properties: {
        listInSkillsOnly: {
          description:
            "True when this skill is allowed as skills-section-only support without requiring a new experience bullet.",
          type: "boolean",
        },
        name: {
          description:
            "The exact skills-section keyword, such as Kubernetes, PostgreSQL, React, AWS, or Spanish.",
          type: "string",
        },
        reason: {
          description:
            "A short explanation of why this keyword belongs in the Skills section.",
          type: "string",
        },
      },
      required: ["name", "listInSkillsOnly", "reason"],
      type: "object",
    },
    strict: true,
    type: "function",
  },
  {
    description:
      "Create or update durable resume bullet support for one or more skills-section keywords. Use this when the keyword needs a new bullet or a modified source bullet.",
    name: createResumeBulletSupportToolName,
    parameters: {
      additionalProperties: false,
      properties: {
        quote: {
          description:
            "The user-approved resume bullet text Tailor Resume may use or adapt.",
          type: "string",
        },
        reason: {
          description:
            "Why this bullet supports the selected skills-section keyword(s).",
          type: "string",
        },
        replacesQuote: {
          description:
            "The current source resume bullet this should replace, or null for a new spare bullet.",
          type: ["string", "null"],
        },
        resumeExperienceId: {
          description:
            "The allowed resumeExperienceId returned by list_resume_experiences.",
          type: "string",
        },
        skillNames: {
          description:
            "One or more exact skills-section keywords supported by this bullet.",
          items: {
            type: "string",
          },
          type: "array",
        },
      },
      required: [
        "quote",
        "replacesQuote",
        "resumeExperienceId",
        "skillNames",
        "reason",
      ],
      type: "object",
    },
    strict: true,
    type: "function",
  },
] as const;

export async function generateTailorResumeSupportChatResponse(input: {
  currentUserMessage: string;
  pageContext: TailorResumeChatPageContext | null;
  previousMessages: TailorResumeChatMessageRecord[];
  signal?: AbortSignal;
  userId: string;
}) {
  if (input.currentUserMessage.length > maxTailorResumeChatMessageLength) {
    throw new Error(
      `Keep chat messages under ${maxTailorResumeChatMessageLength.toLocaleString()} characters.`,
    );
  }

  const [{ annotatedLatexCode }, userMarkdown] = await Promise.all([
    readCurrentResumeContext(input.userId),
    buildUserMarkdownContext(input.userId),
  ]);
  const skillData = await readTailorResumeStoredSkillData({
    sourceAnnotatedLatexCode: annotatedLatexCode,
    userId: input.userId,
  });
  const client = getOpenAIClient();
  const model =
    process.env.OPENAI_TAILOR_RESUME_SUPPORT_CHAT_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_CHAT_MODEL ??
    process.env.OPENAI_TAILOR_RESUME_MODEL ??
    "gpt-5-mini";
  let responseInput: SupportChatResponseInput = buildTailorResumeSupportChatInput({
    currentUserMessage: input.currentUserMessage,
    pageContext: input.pageContext,
    previousMessages: input.previousMessages,
    skillData,
    userMarkdown,
  });
  let previousResponseId: string | undefined;
  let finalAssistantText = "";
  let latestModel = model;
  let latestSkillData: TailorResumeStoredSkillData | null = null;
  const toolCalls: TailorResumeSupportChatToolCallRecord[] = [];

  for (let round = 1; round <= maxSupportChatToolRounds; round += 1) {
    const response = (await client.responses.create(
      {
        input: responseInput,
        instructions: buildTailorResumeSupportChatInstructions(),
        model,
        parallel_tool_calls: false,
        previous_response_id: previousResponseId,
        reasoning: {
          effort: "low",
        },
        text: {
          verbosity: "low",
        },
        tools: [...supportChatTools],
      },
      input.signal ? { signal: input.signal } : undefined,
    )) as SupportChatResponse;

    previousResponseId = response.id;
    latestModel = response.model ?? latestModel;

    const toolCall = readSupportChatToolCall(response);

    if (!toolCall) {
      finalAssistantText = readOutputText(response);
      break;
    }

    toolCalls.push(serializeSupportChatToolCall(toolCall));

    const toolResult = await executeSupportChatToolCall({
      toolCall,
      userId: input.userId,
    });

    if (toolResult.skillData) {
      latestSkillData = toolResult.skillData;
    }

    responseInput = [
      {
        call_id: toolCall.call_id,
        output: JSON.stringify(toolResult.output),
        type: "function_call_output",
      },
    ];
  }

  if (!finalAssistantText && toolCalls.length > 0) {
    finalAssistantText =
      "I ran the resume support tool, but the model did not return a final summary.";
  }

  if (!finalAssistantText) {
    throw new Error("The resume chat model returned an empty response.");
  }

  return {
    content: finalAssistantText,
    model: latestModel,
    skillData: latestSkillData,
    toolCalls,
  };
}
