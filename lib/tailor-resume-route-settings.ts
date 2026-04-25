import { NextResponse } from "next/server";
import {
  tailorResumeGenerationSettingKeys,
  type TailorResumeGenerationSettings,
} from "./tailor-resume-generation-settings.ts";
import { mergeTailorResumeProfileWithLockedLinks } from "./tailor-resume-locked-links.ts";
import { writeTailorResumeProfile } from "./tailor-resume-storage.ts";
import {
  systemPromptSettingKeys,
  type SystemPromptSettings,
} from "./system-prompt-settings.ts";
import type {
  TailorResumeLockedLinkRecord,
  TailorResumeProfile,
} from "./tailor-resume-types.ts";
import {
  maxTailorResumeUserMarkdownLength,
  saveTailorResumeUserMarkdown,
} from "./tailor-resume-user-memory.ts";

const maxSystemPromptLength = 200_000;

export function readPromptSettingsUpdates(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawUpdates = value as Partial<Record<(typeof systemPromptSettingKeys)[number], unknown>>;
  const updates: Partial<SystemPromptSettings> = {};
  let changeCount = 0;

  for (const key of systemPromptSettingKeys) {
    const nextValue = rawUpdates[key];

    if (typeof nextValue !== "string") {
      continue;
    }

    if (nextValue.length > maxSystemPromptLength) {
      throw new Error(
        `Keep the ${key} prompt under ${maxSystemPromptLength.toLocaleString()} characters.`,
      );
    }

    updates[key] = nextValue;
    changeCount += 1;
  }

  if (changeCount === 0) {
    return null;
  }

  return updates;
}

export function readGenerationSettingsUpdates(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawUpdates = value as Partial<
    Record<(typeof tailorResumeGenerationSettingKeys)[number], unknown>
  >;
  const updates: Partial<TailorResumeGenerationSettings> = {};
  let changeCount = 0;

  for (const key of tailorResumeGenerationSettingKeys) {
    if (typeof rawUpdates[key] !== "boolean") {
      continue;
    }

    updates[key] = rawUpdates[key];
    changeCount += 1;
  }

  if (changeCount === 0) {
    return null;
  }

  return updates;
}

export async function saveTailorResumeUserMarkdownAction(
  userId: string,
  body: Record<string, unknown>,
) {
  const markdown = "markdown" in body ? body.markdown : null;
  const expectedUpdatedAt =
    "updatedAt" in body
      ? typeof body.updatedAt === "string"
        ? body.updatedAt
        : body.updatedAt === null
          ? null
          : undefined
      : undefined;

  if (typeof markdown !== "string") {
    return NextResponse.json(
      { error: "Provide USER.md markdown to save." },
      { status: 400 },
    );
  }

  if (markdown.length > maxTailorResumeUserMarkdownLength) {
    return NextResponse.json(
      {
        error: `Keep USER.md under ${maxTailorResumeUserMarkdownLength.toLocaleString()} characters.`,
      },
      { status: 413 },
    );
  }

  let saveResult: Awaited<ReturnType<typeof saveTailorResumeUserMarkdown>>;

  try {
    saveResult = await saveTailorResumeUserMarkdown(
      userId,
      markdown,
      expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save USER.md.",
      },
      { status: 413 },
    );
  }

  if (!saveResult.ok) {
    return NextResponse.json(
      {
        error:
          "USER.md changed since you opened it. Review the latest version before saving.",
        userMarkdown: saveResult.state,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    userMarkdown: saveResult.state,
  });
}

function buildLockedProfileResponse(
  profile: TailorResumeProfile,
  lockedLinks: TailorResumeLockedLinkRecord[],
) {
  return NextResponse.json({
    profile: mergeTailorResumeProfileWithLockedLinks(profile, lockedLinks, {
      includeLockedOnly: true,
    }),
  });
}

export async function saveTailorResumePromptSettingsAction(input: {
  body: Record<string, unknown>;
  lockedLinks: TailorResumeLockedLinkRecord[];
  rawProfile: TailorResumeProfile;
  userId: string;
}) {
  let promptSettingsUpdates: Partial<SystemPromptSettings> | null = null;

  try {
    promptSettingsUpdates = readPromptSettingsUpdates(
      "promptSettings" in input.body ? input.body.promptSettings : null,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the prompt settings.",
      },
      { status: 413 },
    );
  }

  if (!promptSettingsUpdates) {
    return NextResponse.json(
      { error: "Provide at least one prompt setting to save." },
      { status: 400 },
    );
  }

  const nextRawProfile: TailorResumeProfile = {
    ...input.rawProfile,
    promptSettings: {
      updatedAt: new Date().toISOString(),
      values: {
        ...input.rawProfile.promptSettings.values,
        ...promptSettingsUpdates,
      },
    },
  };

  await writeTailorResumeProfile(input.userId, nextRawProfile);

  return buildLockedProfileResponse(nextRawProfile, input.lockedLinks);
}

export async function saveTailorResumeGenerationSettingsAction(input: {
  body: Record<string, unknown>;
  lockedLinks: TailorResumeLockedLinkRecord[];
  rawProfile: TailorResumeProfile;
  userId: string;
}) {
  const generationSettingsUpdates = readGenerationSettingsUpdates(
    "generationSettings" in input.body ? input.body.generationSettings : null,
  );

  if (!generationSettingsUpdates) {
    return NextResponse.json(
      { error: "Provide at least one generation setting to save." },
      { status: 400 },
    );
  }

  const nextRawProfile: TailorResumeProfile = {
    ...input.rawProfile,
    generationSettings: {
      updatedAt: new Date().toISOString(),
      values: {
        ...input.rawProfile.generationSettings.values,
        ...generationSettingsUpdates,
      },
    },
  };

  await writeTailorResumeProfile(input.userId, nextRawProfile);

  return buildLockedProfileResponse(nextRawProfile, input.lockedLinks);
}
