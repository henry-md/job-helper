import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTailorResumeUserMarkdownPatch,
  filterTailorResumeNonTechnologiesFromEmphasizedTechnologies,
  formatTailorResumeNonTechnologyTerm,
  normalizeTailorResumeNonTechnologyTerms,
} from "../lib/tailor-resume-user-memory.ts";

test("applyTailorResumeUserMarkdownPatch appends under a created heading path", () => {
  const result = applyTailorResumeUserMarkdownPatch("# USER.md\n\n", [
    {
      headingPath: ["Experience", "Frontend"],
      markdown: "- React Native: Has shipped production mobile UI work.\n",
      op: "append",
    },
  ]);

  assert.equal(result.ok, true);
  assert.match(result.markdown, /## Experience/);
  assert.match(result.markdown, /### Frontend/);
  assert.match(result.markdown, /React Native/);
});

test("applyTailorResumeUserMarkdownPatch replaces exact text transactionally", () => {
  const markdown =
    "# USER.md\n\n## Experience\n\n- React: Has used React.\n- React Native: Some exposure.\n";
  const result = applyTailorResumeUserMarkdownPatch(markdown, [
    {
      newMarkdown:
        "- React / React Native: Has shipped production UI work across web and mobile.\n",
      oldMarkdown:
        "- React: Has used React.\n- React Native: Some exposure.\n",
      op: "replace_exact",
    },
  ]);

  assert.equal(result.ok, true);
  assert.match(result.markdown, /production UI work/);
  assert.doesNotMatch(result.markdown, /Some exposure/);
});

test("applyTailorResumeUserMarkdownPatch returns retryable exact-match errors", () => {
  const markdown = "# USER.md\n\n## Constraints\n\n- Avoid Kubernetes claims.\n";
  const result = applyTailorResumeUserMarkdownPatch(markdown, [
    {
      newMarkdown: "- Avoid production Kubernetes claims.\n",
      oldMarkdown: "- Avoid Kubernetes claims unless confirmed.\n",
      op: "replace_exact",
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.markdown, markdown);
  assert.equal(result.results[0]?.errorCode, "old_markdown_not_found");
  assert.equal(result.results[0]?.matchCount, 0);
});

test("applyTailorResumeUserMarkdownPatch rejects placeholder replacements", () => {
  const result = applyTailorResumeUserMarkdownPatch(
    "# USER.md\n\n## Experience\n\n- React: Confirmed.\n",
    [
      {
        newMarkdown: "- React: Confirmed.\n... rest unchanged\n",
        oldMarkdown: "- React: Confirmed.\n",
        op: "replace_exact",
      },
    ],
  );

  assert.equal(result.ok, false);
  assert.equal(result.results[0]?.errorCode, "placeholder_text_rejected");
});

test("normalizeTailorResumeNonTechnologyTerms dedupes case-insensitively", () => {
  assert.deepEqual(
    normalizeTailorResumeNonTechnologyTerms([
      " Chromium ",
      "chromium",
      "Internationalization",
    ]),
    ["chromium", "internationalization"],
  );
});

test("formatTailorResumeNonTechnologyTerm displays a capital first letter", () => {
  assert.equal(formatTailorResumeNonTechnologyTerm("chromium"), "Chromium");
  assert.equal(
    formatTailorResumeNonTechnologyTerm("internationalization"),
    "Internationalization",
  );
});

test("filterTailorResumeNonTechnologiesFromEmphasizedTechnologies is case-insensitive", () => {
  const technologies = filterTailorResumeNonTechnologiesFromEmphasizedTechnologies(
    [
      { name: "Chromium", priority: "high" },
      { name: "React", priority: "high" },
      { name: "internationalization", priority: "low" },
    ],
    ["chromium", "Internationalization"],
  );

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["React"],
  );
});
