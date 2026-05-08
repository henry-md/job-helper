import { renderTailoredResumeLatexToPlainText } from "./tailor-resume-preview-focus.ts";
import {
  readAnnotatedTailorResumeBlocks,
  type TailorResumeAnnotatedBlock,
} from "./tailor-resume-segmentation.ts";
import type { TailorResumeResumeExperienceRecord } from "./tailor-resume-types.ts";

type MutableResumeExperience = TailorResumeResumeExperienceRecord & {
  sortIndex: number;
};

function cleanExperienceLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function blockPlainText(block: TailorResumeAnnotatedBlock) {
  return cleanExperienceLabel(renderTailoredResumeLatexToPlainText(block.latexCode));
}

function formatFallbackExperienceLabel(block: TailorResumeAnnotatedBlock) {
  const plainText = blockPlainText(block);

  if (plainText) {
    return plainText;
  }

  return block.command === "projectheading" ? "Project" : "Experience";
}

// Extracts the resume experiences that can own skills-section spare bullets.
export function extractTailorResumeResumeExperiences(
  annotatedLatexCode: string,
): TailorResumeResumeExperienceRecord[] {
  const blocks = readAnnotatedTailorResumeBlocks(annotatedLatexCode);
  const experiences: MutableResumeExperience[] = [];
  let currentExperience: MutableResumeExperience | null = null;

  for (const block of blocks) {
    if (block.command === "entryheading" || block.command === "projectheading") {
      currentExperience = {
        bulletSegmentIds: [],
        headingSegmentId: block.id,
        id: block.id,
        label: formatFallbackExperienceLabel(block),
        sortIndex: experiences.length,
      };
      experiences.push(currentExperience);
      continue;
    }

    if (block.command === "resumeitem" && currentExperience) {
      currentExperience.bulletSegmentIds.push(block.id);
    }
  }

  return experiences.map((experience) => ({
    bulletSegmentIds: experience.bulletSegmentIds,
    headingSegmentId: experience.headingSegmentId,
    id: experience.id,
    label: experience.label,
  }));
}

export function findTailorResumeResumeExperience(
  experiences: TailorResumeResumeExperienceRecord[],
  id: string,
) {
  return experiences.find((experience) => experience.id === id) ?? null;
}
