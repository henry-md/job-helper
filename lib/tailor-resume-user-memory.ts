import {
  normalizeTailorResumeNonTechnologyTerms,
} from "./tailor-resume-non-technologies.ts";

export {
  filterTailorResumeNonTechnologiesFromEmphasizedTechnologies,
  formatTailorResumeNonTechnologyTerm,
  formatTailorResumeTermWithCapitalFirst,
  isTailorResumeNonTechnologyTerm,
  maxTailorResumeNonTechnologyTermCount,
  maxTailorResumeNonTechnologyTermLength,
  mergeTailorResumeNonTechnologyTerms,
  normalizeTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerms,
} from "./tailor-resume-non-technologies.ts";

export const defaultTailorResumeUserMarkdown = "# USER.md\n\n";
export const maxTailorResumeUserMarkdownLength = 100_000;

export type TailorResumeUserMarkdownState = {
  markdown: string;
  nonTechnologies: string[];
  updatedAt: string | null;
};

export type TailorResumeUserMarkdownDocumentState = {
  markdown: string;
  updatedAt: string | null;
};

export type TailorResumeUserMemoryState = {
  nonTechnologyNames: string[];
  updatedAt: string | null;
  userMarkdown: TailorResumeUserMarkdownDocumentState;
};

export type TailorResumeUserMarkdownPatchOperation = {
  anchorMarkdown?: string;
  headingPath?: string[];
  markdown?: string;
  newMarkdown?: string;
  oldMarkdown?: string;
  op: "append" | "delete_exact" | "insert_after" | "insert_before" | "replace_exact";
};

export type TailorResumeUserMarkdownPatchOperationResult = {
  errorCode:
    | "ambiguous_match"
    | "anchor_not_found"
    | "document_too_large"
    | "invalid_operation"
    | "missing_markdown"
    | "old_markdown_not_found"
    | "placeholder_text_rejected"
    | null;
  index: number;
  matchCount: number | null;
  message: string | null;
  ok: boolean;
  op: TailorResumeUserMarkdownPatchOperation["op"];
};

export type TailorResumeUserMarkdownPatchResult =
  | {
      changed: boolean;
      markdown: string;
      ok: true;
      results: TailorResumeUserMarkdownPatchOperationResult[];
    }
  | {
      markdown: string;
      ok: false;
      results: TailorResumeUserMarkdownPatchOperationResult[];
    };

export type SaveTailorResumeUserMarkdownResult =
  | {
      ok: true;
      state: TailorResumeUserMarkdownState;
    }
  | {
      error: "stale_revision";
      ok: false;
      state: TailorResumeUserMarkdownState;
    };

const placeholderTextPattern =
  /(?:\.\.\.\s*(?:rest|remaining|unchanged|existing))|(?:\[(?:rest|remaining|existing|unchanged)[^\]]*\])|(?:(?:rest|remaining)\s+of\s+(?:the\s+)?(?:file|content|document))|(?:unchanged\s+(?:content|document|text))/i;

function normalizeStoredMarkdown(markdown: string) {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function buildUserMarkdownState(record: {
  markdown: string;
  nonTechnologies?: string[] | null;
  updatedAt: Date;
} | null): TailorResumeUserMarkdownState {
  if (!record) {
    return {
      markdown: defaultTailorResumeUserMarkdown,
      nonTechnologies: [],
      updatedAt: null,
    };
  }

  return {
    markdown: normalizeStoredMarkdown(record.markdown),
    nonTechnologies: normalizeTailorResumeNonTechnologyTerms(
      record.nonTechnologies ?? [],
    ),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function buildTailorResumeUserMemoryState(
  state: TailorResumeUserMarkdownState,
): TailorResumeUserMemoryState {
  return {
    nonTechnologyNames: normalizeTailorResumeNonTechnologyTerms(
      state.nonTechnologies,
    ),
    updatedAt: state.updatedAt,
    userMarkdown: {
      markdown: state.markdown,
      updatedAt: state.updatedAt,
    },
  };
}

function countExactMatches(markdown: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let cursor = 0;

  while (cursor <= markdown.length) {
    const index = markdown.indexOf(needle, cursor);

    if (index === -1) {
      return count;
    }

    count += 1;
    cursor = index + needle.length;
  }

  return count;
}

function operationResult(input: {
  errorCode: TailorResumeUserMarkdownPatchOperationResult["errorCode"];
  index: number;
  matchCount?: number | null;
  message: string | null;
  ok: boolean;
  op: TailorResumeUserMarkdownPatchOperation["op"];
}): TailorResumeUserMarkdownPatchOperationResult {
  return {
    errorCode: input.errorCode,
    index: input.index,
    matchCount: input.matchCount ?? null,
    message: input.message,
    ok: input.ok,
    op: input.op,
  };
}

function normalizeHeadingTitle(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function findHeadingSection(markdown: string, headingPath: string[]) {
  const normalizedPath = headingPath.map(normalizeHeadingTitle).filter(Boolean);

  if (normalizedPath.length === 0) {
    return null;
  }

  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map(
    (match) => ({
      end: (match.index ?? 0) + match[0].length,
      level: match[1]!.length,
      start: match.index ?? 0,
      title: normalizeHeadingTitle(match[2] ?? ""),
    }),
  );
  let parentStart = 0;
  let parentEnd = markdown.length;
  let target: (typeof headings)[number] | null = null;

  for (let index = 0; index < normalizedPath.length; index += 1) {
    const expectedLevel = Math.min(6, index + 2);
    const title = normalizedPath[index]!;
    const heading = headings.find(
      (candidate) =>
        candidate.level === expectedLevel &&
        candidate.title === title &&
        candidate.start >= parentStart &&
        candidate.start < parentEnd,
    );

    if (!heading) {
      return null;
    }

    const nextSibling = headings.find(
      (candidate) =>
        candidate.start > heading.start && candidate.level <= heading.level,
    );

    parentStart = heading.end;
    parentEnd = nextSibling?.start ?? markdown.length;
    target = heading;
  }

  if (!target) {
    return null;
  }

  return {
    contentEnd: parentEnd,
    heading: target,
  };
}

function appendWithSpacing(markdown: string, addition: string) {
  const normalizedMarkdown = normalizeStoredMarkdown(markdown);
  const prefix = normalizedMarkdown.endsWith("\n\n") ? "" : "\n";
  const normalizedAddition = normalizeStoredMarkdown(addition.trimEnd());

  return `${normalizedMarkdown}${prefix}${normalizedAddition}`;
}

function appendToHeadingPath(
  markdown: string,
  headingPath: string[] | undefined,
  addition: string,
) {
  const normalizedHeadingPath =
    headingPath?.map(normalizeHeadingTitle).filter(Boolean) ?? [];

  if (normalizedHeadingPath.length === 0) {
    return appendWithSpacing(markdown, addition);
  }

  const section = findHeadingSection(markdown, normalizedHeadingPath);

  if (!section) {
    const headingMarkdown = normalizedHeadingPath
      .map((heading, index) => `${"#".repeat(Math.min(6, index + 2))} ${heading}`)
      .join("\n\n");

    return appendWithSpacing(markdown, `${headingMarkdown}\n\n${addition}`);
  }

  const beforeSectionEnd = markdown.slice(0, section.contentEnd);
  const afterSectionEnd = markdown.slice(section.contentEnd);
  const prefix = beforeSectionEnd.endsWith("\n\n")
    ? ""
    : beforeSectionEnd.endsWith("\n")
      ? "\n"
      : "\n\n";
  const suffix = afterSectionEnd.startsWith("\n") ? "" : "\n";

  return `${beforeSectionEnd}${prefix}${normalizeStoredMarkdown(
    addition.trimEnd(),
  )}${suffix}${afterSectionEnd}`;
}

function containsPlaceholderText(...values: string[]) {
  return values.some((value) => placeholderTextPattern.test(value));
}

function readRequiredMarkdown(
  operation: TailorResumeUserMarkdownPatchOperation,
  key: "anchorMarkdown" | "markdown" | "newMarkdown" | "oldMarkdown",
) {
  const value = operation[key];

  return typeof value === "string" ? value : "";
}

export function applyTailorResumeUserMarkdownPatch(
  markdown: string,
  operations: TailorResumeUserMarkdownPatchOperation[],
): TailorResumeUserMarkdownPatchResult {
  const originalMarkdown = normalizeStoredMarkdown(markdown);
  let nextMarkdown = originalMarkdown;
  const results: TailorResumeUserMarkdownPatchOperationResult[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;

    if (operation.op === "append") {
      const addition = readRequiredMarkdown(operation, "markdown");

      if (!addition.trim()) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: "missing_markdown",
              index,
              message: "append requires non-empty markdown.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      if (containsPlaceholderText(addition)) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: "placeholder_text_rejected",
              index,
              message: "append markdown contains placeholder text.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      nextMarkdown = appendToHeadingPath(
        nextMarkdown,
        operation.headingPath,
        addition,
      );
      results.push(
        operationResult({
          errorCode: null,
          index,
          message: null,
          ok: true,
          op: operation.op,
        }),
      );
    } else if (operation.op === "replace_exact") {
      const oldMarkdown = readRequiredMarkdown(operation, "oldMarkdown");
      const newMarkdown = readRequiredMarkdown(operation, "newMarkdown");
      const matchCount = countExactMatches(nextMarkdown, oldMarkdown);

      if (!oldMarkdown || matchCount !== 1) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode:
                matchCount === 0 ? "old_markdown_not_found" : "ambiguous_match",
              index,
              matchCount,
              message: "oldMarkdown must match exactly once.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      if (containsPlaceholderText(newMarkdown)) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: "placeholder_text_rejected",
              index,
              message: "newMarkdown contains placeholder text.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      nextMarkdown = nextMarkdown.replace(oldMarkdown, newMarkdown);
      results.push(
        operationResult({
          errorCode: null,
          index,
          matchCount,
          message: null,
          ok: true,
          op: operation.op,
        }),
      );
    } else if (operation.op === "delete_exact") {
      const deletedMarkdown = readRequiredMarkdown(operation, "markdown");
      const matchCount = countExactMatches(nextMarkdown, deletedMarkdown);

      if (!deletedMarkdown || matchCount !== 1) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode:
                matchCount === 0 ? "old_markdown_not_found" : "ambiguous_match",
              index,
              matchCount,
              message: "delete_exact markdown must match exactly once.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      nextMarkdown = nextMarkdown.replace(deletedMarkdown, "");
      results.push(
        operationResult({
          errorCode: null,
          index,
          matchCount,
          message: null,
          ok: true,
          op: operation.op,
        }),
      );
    } else if (operation.op === "insert_before" || operation.op === "insert_after") {
      const anchorMarkdown = readRequiredMarkdown(operation, "anchorMarkdown");
      const insertedMarkdown = readRequiredMarkdown(operation, "markdown");
      const matchCount = countExactMatches(nextMarkdown, anchorMarkdown);

      if (!anchorMarkdown || matchCount !== 1) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: matchCount === 0 ? "anchor_not_found" : "ambiguous_match",
              index,
              matchCount,
              message: "anchorMarkdown must match exactly once.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      if (!insertedMarkdown.trim()) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: "missing_markdown",
              index,
              matchCount,
              message: `${operation.op} requires non-empty markdown.`,
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      if (containsPlaceholderText(insertedMarkdown)) {
        return {
          markdown: originalMarkdown,
          ok: false,
          results: [
            ...results,
            operationResult({
              errorCode: "placeholder_text_rejected",
              index,
              matchCount,
              message: "inserted markdown contains placeholder text.",
              ok: false,
              op: operation.op,
            }),
          ],
        };
      }

      const anchorIndex = nextMarkdown.indexOf(anchorMarkdown);
      const insertIndex =
        operation.op === "insert_before"
          ? anchorIndex
          : anchorIndex + anchorMarkdown.length;

      nextMarkdown =
        nextMarkdown.slice(0, insertIndex) +
        insertedMarkdown +
        nextMarkdown.slice(insertIndex);
      results.push(
        operationResult({
          errorCode: null,
          index,
          matchCount,
          message: null,
          ok: true,
          op: operation.op,
        }),
      );
    } else {
      return {
        markdown: originalMarkdown,
        ok: false,
        results: [
          ...results,
          operationResult({
            errorCode: "invalid_operation",
            index,
            message: "Unsupported USER.md edit operation.",
            ok: false,
            op: operation.op,
          }),
        ],
      };
    }

    if (nextMarkdown.length > maxTailorResumeUserMarkdownLength) {
      return {
        markdown: originalMarkdown,
        ok: false,
        results: [
          ...results,
          operationResult({
            errorCode: "document_too_large",
            index,
            message: `Keep USER.md under ${maxTailorResumeUserMarkdownLength.toLocaleString()} characters.`,
            ok: false,
            op: operation.op,
          }),
        ],
      };
    }
  }

  const normalizedNextMarkdown = normalizeStoredMarkdown(nextMarkdown);

  return {
    changed: normalizedNextMarkdown !== originalMarkdown,
    markdown: normalizedNextMarkdown,
    ok: true,
    results,
  };
}

export async function readTailorResumeUserMarkdown(
  userId: string,
): Promise<TailorResumeUserMarkdownState> {
  const { getPrismaClient } = await import("./prisma.ts");
  const prisma = getPrismaClient();
  const record = await prisma.tailorResumeUserMemory.findUnique({
    select: {
      markdown: true,
      nonTechnologies: true,
      updatedAt: true,
    },
    where: { userId },
  });

  return buildUserMarkdownState(record);
}

export async function readTailorResumeUserMemory(
  userId: string,
): Promise<TailorResumeUserMemoryState> {
  return buildTailorResumeUserMemoryState(
    await readTailorResumeUserMarkdown(userId),
  );
}

export async function saveTailorResumeUserMarkdown(
  userId: string,
  markdown: string,
  options: {
    expectedUpdatedAt?: string | null;
    nonTechnologies?: readonly string[] | null;
  } = {},
): Promise<SaveTailorResumeUserMarkdownResult> {
  const { getPrismaClient } = await import("./prisma.ts");
  const prisma = getPrismaClient();
  const currentRecord = await prisma.tailorResumeUserMemory.findUnique({
    select: {
      markdown: true,
      nonTechnologies: true,
      updatedAt: true,
    },
    where: { userId },
  });
  const currentState = buildUserMarkdownState(currentRecord);

  if (
    "expectedUpdatedAt" in options &&
    options.expectedUpdatedAt !== currentState.updatedAt
  ) {
    return {
      error: "stale_revision",
      ok: false,
      state: currentState,
    };
  }

  const normalizedMarkdown = normalizeStoredMarkdown(markdown);
  const normalizedNonTechnologies =
    "nonTechnologies" in options
      ? normalizeTailorResumeNonTechnologyTerms(options.nonTechnologies)
      : currentState.nonTechnologies;

  if (normalizedMarkdown.length > maxTailorResumeUserMarkdownLength) {
    throw new Error(
      `Keep USER.md under ${maxTailorResumeUserMarkdownLength.toLocaleString()} characters.`,
    );
  }

  const savedRecord = await prisma.tailorResumeUserMemory.upsert({
    create: {
      markdown: normalizedMarkdown,
      nonTechnologies: normalizedNonTechnologies,
      userId,
    },
    update: {
      markdown: normalizedMarkdown,
      nonTechnologies: normalizedNonTechnologies,
    },
    where: { userId },
  });

  return {
    ok: true,
    state: buildUserMarkdownState(savedRecord),
  };
}
