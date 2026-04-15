import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  TailorResumeSourceDocument,
  TailorResumeSourceEntryItem,
  TailorResumeSourceSection,
  TailorResumeSourceSegment,
  TailorResumeSourceUnit,
} from "./tailor-resume-types.ts";
import { readSourceUnitText } from "./tailor-resume-source.ts";

const execFile = promisify(execFileCallback);

const latexPreamble = String.raw`\documentclass[10pt]{article}

\usepackage[
  top=0.36in,
  bottom=0.44in,
  left=0.47in,
  right=0.47in
]{geometry}

\usepackage[T1]{fontenc}
\usepackage{newtxtext,newtxmath}
\usepackage{microtype}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage[normalem]{ulem}
\usepackage[
  colorlinks=true,
  urlcolor=LinkBlue,
  linkcolor=LinkBlue
]{hyperref}

\input{glyphtounicode}
\pdfgentounicode=1

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\urlstyle{same}

\linespread{1.08} % ENV: global line-spacing

% ---------- COLORS ----------
\definecolor{LinkBlue}{RGB}{45,95,210}

% ---------- UNDERLINE ----------
\renewcommand{\ULdepth}{0.7pt}
\renewcommand{\ULthickness}{0.3pt}
\newcommand{\tightul}[1]{\uline{\smash{#1}}}

% ---------- TYPOGRAPHY ----------
\newcommand{\NameFont}{\fontsize{14}{15}\selectfont}
\newcommand{\BodyFont}{\fontsize{10.2}{11.8}\selectfont}
\newcommand{\SectionFont}{\fontsize{10}{11}\selectfont}

% ---------- BULLETS ----------
\setlist[itemize]{
  leftmargin=18pt,
  itemsep=1pt,
  topsep=1pt,
  parsep=0pt,
  partopsep=0pt,
  after=\vspace{2pt} % ENV: space after last bullet
}

% ---------- SECTION ----------
\newcommand{\resumeSection}[1]{%
  \vspace{5pt}
  {\SectionFont\textbf{#1}}\par
  \vspace{1.2pt}
  \hrule height 0.5pt
  \vspace{3.8pt}
}

% ---------- HEADER ----------
`;

const latexHeadingMacros = String.raw`% ---------- HEADINGS ----------
\newcommand{\entryheading}[3]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont\textbf{#1}~|~\textit{#2}} & {\BodyFont #3}
  \end{tabular*}\par
}

\newcommand{\projectheading}[2]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont #1} & {\BodyFont #2}
  \end{tabular*}\par
}

\newcommand{\descline}[1]{{\BodyFont #1\par}}

\newenvironment{resumebullets}{
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\EntryGap}{\vspace{3.8pt}}

% labeled line for education/skills
\newcommand{\labelline}[2]{%
  {\BodyFont\noindent\makebox[74pt][l]{\textbf{#1}}#2\par}
}

\begin{document}
\BodyFont
`;

const latexPostamble = String.raw`\end{document}`;

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSectionKey(section: TailorResumeSourceSection) {
  return collapseWhitespace(readSourceUnitText(section.title)).toUpperCase();
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\$/g, "\\$")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/%/g, "\\%")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde")
    .replace(/</g, "\\textless")
    .replace(/>/g, "\\textgreater")
    .replace(/—/g, "---")
    .replace(/–/g, "--");
}

function escapeLatexUrl(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/&/g, "\\&");
}

function renderStyledTextSegment(
  segment: TailorResumeSourceSegment,
  options?: {
    ignoreBold?: boolean;
    ignoreItalic?: boolean;
  },
) {
  if (segment.segmentType === "separator_pipe") {
    return "~|~";
  }

  if (segment.segmentType === "separator_bullet") {
    return " $\\cdot$ ";
  }

  let renderedText = escapeLatexText(segment.text);

  if (segment.isBold && !options?.ignoreBold) {
    renderedText = `\\textbf{${renderedText}}`;
  }

  if (segment.isItalic && !options?.ignoreItalic) {
    renderedText = `\\textit{${renderedText}}`;
  }

  if (segment.isUnderline || segment.isLinkStyle) {
    renderedText = `\\tightul{${renderedText}}`;
  }

  return renderedText;
}

function renderSegment(
  segment: TailorResumeSourceSegment,
  options?: {
    ignoreBold?: boolean;
    ignoreItalic?: boolean;
    omitLinkWrapper?: boolean;
  },
) {
  const renderedText = renderStyledTextSegment(segment, options);

  if (segment.segmentType !== "text" || options?.omitLinkWrapper || !segment.isLinkStyle) {
    return renderedText;
  }

  if (!segment.linkUrl) {
    return `{\\color{LinkBlue}${renderedText}}`;
  }

  return `\\href{${escapeLatexUrl(segment.linkUrl)}}{${renderedText}}`;
}

function renderSegments(
  segments: TailorResumeSourceSegment[],
  options?: {
    ignoreBold?: boolean;
    ignoreItalic?: boolean;
    omitLinkWrapper?: boolean;
  },
) {
  return segments.map((segment) => renderSegment(segment, options)).join("");
}

function splitSegmentsByPipe(segments: TailorResumeSourceSegment[]) {
  const parts: TailorResumeSourceSegment[][] = [[]];

  for (const segment of segments) {
    if (segment.segmentType === "separator_pipe") {
      parts.push([]);
      continue;
    }

    parts[parts.length - 1]?.push(segment);
  }

  return parts.filter((part) => part.length > 0);
}

function splitSegmentsByBullet(segments: TailorResumeSourceSegment[]) {
  const parts: TailorResumeSourceSegment[][] = [[]];

  for (const segment of segments) {
    if (segment.segmentType === "separator_bullet") {
      parts.push([]);
      continue;
    }

    parts[parts.length - 1]?.push(segment);
  }

  return parts.filter((part) => part.length > 0);
}

function sectionComment(title: string) {
  return `% ================= ${title} =================`;
}

function renderHeaderName(unit: TailorResumeSourceUnit) {
  return renderSegments(unit.segments, { ignoreBold: true });
}

function renderHeaderLastLine(unit: TailorResumeSourceUnit) {
  const segments = [...unit.segments];
  const lastSegment = segments[segments.length - 1];

  if (
    lastSegment &&
    lastSegment.segmentType === "text" &&
    lastSegment.isLinkStyle &&
    lastSegment.linkUrl
  ) {
    const prefix = renderSegments(segments.slice(0, -1));
    const linkedText = renderStyledTextSegment(lastSegment);

    return `${prefix}\\href{${escapeLatexUrl(lastSegment.linkUrl)}}{${linkedText}
      \\vspace{-20pt}} % ENV: space between header and 'WORK EXPERIENCE'`;
  }

  return `${renderSegments(unit.segments)}
      \\vspace{-20pt} % ENV: space between header and 'WORK EXPERIENCE'`;
}

function renderResumeHeaderMacro(document: TailorResumeSourceDocument) {
  const lines = document.subHeadLines;
  const renderedLines = lines.map((line, index) => {
    const isLastLine = index === lines.length - 1;

    if (isLastLine) {
      return [`      ${renderHeaderLastLine(line)}`];
    }

    const groupedSegments = splitSegmentsByBullet(line.segments);

    if (groupedSegments.length <= 2) {
      return [`      ${renderSegments(line.segments)}\\par`];
    }

    return groupedSegments
      .map((group, groupIndex) => {
        if (groupIndex === 0) {
          const firstTwoGroups = groupedSegments
            .slice(0, 2)
            .map((part) => renderSegments(part))
            .join(" $\\cdot$ ");
          return `      ${firstTwoGroups} $\\cdot$`;
        }

        if (groupIndex === 1) {
          return null;
        }

        const renderedGroup = renderSegments(group);
        const suffix =
          groupIndex === groupedSegments.length - 1 ? "\\par" : " $\\cdot$";
        return `      ${renderedGroup}${suffix}`;
      })
      .filter((value): value is string => Boolean(value));
  });

  const headerBody = renderedLines
    .flatMap((lineGroup, index) =>
      index < renderedLines.length - 1
        ? [...lineGroup, "      \\vspace{1.1pt}"]
        : lineGroup,
    )
    .join("\n");

  return [
    String.raw`\newcommand{\resumeHeader}{%`,
    String.raw`  \begin{center}`,
    `    {\\NameFont\\textbf{${renderHeaderName(document.headerText)}}}\\par`,
    String.raw`    \vspace{2.4pt}`,
    String.raw`    {\BodyFont`,
    headerBody,
    String.raw`    }`,
    String.raw`  \end{center}`,
    String.raw`  \vspace{4.2pt}`,
    String.raw`}`,
  ].join("\n");
}

function renderEntryHeading(item: TailorResumeSourceEntryItem) {
  const parts = splitSegmentsByPipe(item.heading.segments);
  const left = renderSegments(parts[0] ?? [], { ignoreBold: true });
  const middle = renderSegments(parts.slice(1).flat(), { ignoreItalic: true });
  const right = item.dates ? renderSegments(item.dates.segments) : "";

  return `\\entryheading{${left}}{${middle}}{${right}}`;
}

function renderProjectHeadingUnit(unit: TailorResumeSourceUnit) {
  const parts = splitSegmentsByPipe(unit.segments);
  const first = renderSegments(parts[0] ?? []);

  if (parts.length === 1) {
    return first;
  }

  return [first, ...parts.slice(1).map((part) => renderSegments(part))].join("~|~");
}

function renderBulletBlock(item: TailorResumeSourceEntryItem) {
  if (item.bulletLines.length === 0) {
    return "";
  }

  return [
    String.raw`\begin{resumebullets}`,
    ...item.bulletLines.map(
      (bulletLine) => `  \\resumeitem{${renderSegments(bulletLine.segments)}}`,
    ),
    String.raw`\end{resumebullets}`,
  ].join("\n");
}

function renderWorkExperienceSection(section: TailorResumeSourceSection) {
  const blocks = section.items
    .filter((item): item is TailorResumeSourceEntryItem => item.itemType === "entry")
    .map((item, index, items) => {
      const lines = [
        renderEntryHeading(item),
        ...(item.description
          ? [`\\descline{${renderSegments(item.description.segments)}}`]
          : []),
        renderBulletBlock(item),
      ].filter(Boolean);

      if (index < items.length - 1) {
        lines.push(String.raw`\EntryGap`);
      }

      return lines.join("\n");
    });

  return [
    sectionComment("WORK EXPERIENCE"),
    "\\resumeSection{WORK EXPERIENCE}",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderEducationSection(section: TailorResumeSourceSection) {
  const blocks: string[] = [sectionComment("EDUCATION"), "\\resumeSection{EDUCATION}", ""];

  for (const item of section.items) {
    if (item.itemType === "entry") {
      const headingParts = splitSegmentsByPipe(item.heading.segments);
      const left = [
        `\\textbf{${renderSegments(headingParts[0] ?? [], { ignoreBold: true })}}`,
        ...headingParts.slice(1).map((part) => renderSegments(part)),
      ].join("~|~");
      const dates = item.dates ? renderSegments(item.dates.segments) : "";

      blocks.push(String.raw`\noindent`);
      blocks.push(String.raw`\begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}`);
      blocks.push(`  {\\BodyFont${left}} &`);
      blocks.push(`  {\\BodyFont ${dates}}`);
      blocks.push(String.raw`\end{tabular*}\par`);

      if (item.description) {
        blocks.push("");
        blocks.push(`{\\BodyFont\\hspace*{20pt}${renderSegments(item.description.segments)}\\par}`);
      }
      continue;
    }

    if (item.itemType === "labeled_line") {
      const labelKey = collapseWhitespace(readSourceUnitText(item.label)).toUpperCase();
      const label = renderSegments(item.label.segments, { ignoreBold: true });
      const value = renderSegments(item.value.segments);

      blocks.push("");

      if (labelKey === "COURSES:") {
        blocks.push(`{\\BodyFont
\\noindent\\hspace*{20pt}\\textbf{${label}}%
\\hangindent=61pt
\\hangafter=1
${value}\\par
}`);
      } else {
        blocks.push(`{\\BodyFont
\\noindent\\textbf{${label}}%
${value}\\par
}`);
      }
    }
  }

  return blocks.join("\n");
}

function renderSoftwareProjectsSection(section: TailorResumeSourceSection) {
  const entryItems = section.items.filter(
    (item): item is TailorResumeSourceEntryItem => item.itemType === "entry",
  );
  const blocks = entryItems.map((item, index, items) => {
    const heading = renderProjectHeadingUnit(item.heading);
    const lines = [
      item.dates
        ? `\\projectheading{${heading}}{${renderSegments(item.dates.segments)}}`
        : `{\\BodyFont${heading}\\par}`,
      ...(item.description
        ? [`\\descline{${renderSegments(item.description.segments)}}`]
        : []),
      renderBulletBlock(item),
    ].filter(Boolean);

    if (index < items.length - 1) {
      lines.push(String.raw`\EntryGap`);
    }

    return lines.join("\n");
  });

  return [
    sectionComment("SOFTWARE PROJECTS"),
    "\\resumeSection{SOFTWARE PROJECTS}",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderTechnicalSkillsSection(section: TailorResumeSourceSection) {
  const blocks = [sectionComment("TECHNICAL SKILLS"), "\\resumeSection{TECHNICAL SKILLS}", ""];

  for (const item of section.items) {
    if (item.itemType !== "labeled_line") {
      continue;
    }

    const labelKey = collapseWhitespace(readSourceUnitText(item.label)).toUpperCase();
    const hangIndent =
      labelKey === "FULL-STACK WEB DEV:"
        ? 112
        : labelKey === "LANGUAGES:"
          ? 74
          : labelKey === "OTHER SOFTWARE:"
            ? 104
            : 74;
    const label = renderSegments(item.label.segments, { ignoreBold: true });
    const value = renderSegments(item.value.segments);

    blocks.push(`{\\BodyFont
\\noindent\\textbf{${label}}%
\\hangindent=${hangIndent}pt
\\hangafter=1
${value}\\par
}`);
    blocks.push("");
  }

  if (blocks[blocks.length - 1] === "") {
    blocks.pop();
  }

  return blocks.join("\n");
}

function renderGenericSection(section: TailorResumeSourceSection) {
  const title = collapseWhitespace(readSourceUnitText(section.title));

  return [
    sectionComment(title),
    `\\resumeSection{${title}}`,
    "",
    ...section.items.map((item) => {
      if (item.itemType === "entry") {
        const lines = [
          item.dates
            ? `\\projectheading{${renderProjectHeadingUnit(item.heading)}}{${renderSegments(item.dates.segments)}}`
            : `{\\BodyFont${renderProjectHeadingUnit(item.heading)}\\par}`,
          ...(item.description
            ? [`\\descline{${renderSegments(item.description.segments)}}`]
            : []),
          renderBulletBlock(item),
        ].filter(Boolean);

        return lines.join("\n");
      }

      if (item.itemType === "labeled_line") {
        return `{\\BodyFont\\noindent\\textbf{${renderSegments(item.label.segments, {
          ignoreBold: true,
        })}}%${renderSegments(item.value.segments)}\\par}`;
      }

      return `{\\BodyFont${renderSegments(item.content.segments)}\\par}`;
    }),
  ].join("\n");
}

function renderSection(section: TailorResumeSourceSection) {
  const sectionKey = normalizeSectionKey(section);

  if (sectionKey === "WORK EXPERIENCE") {
    return renderWorkExperienceSection(section);
  }

  if (sectionKey === "EDUCATION") {
    return renderEducationSection(section);
  }

  if (sectionKey === "SOFTWARE PROJECTS") {
    return renderSoftwareProjectsSection(section);
  }

  if (sectionKey === "TECHNICAL SKILLS") {
    return renderTechnicalSkillsSection(section);
  }

  return renderGenericSection(section);
}

function extractRelevantLatexError(output: string) {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const bangIndex = lines.findIndex((line) => line.startsWith("!"));

  if (bangIndex !== -1) {
    return lines.slice(bangIndex, Math.min(lines.length, bangIndex + 8)).join("\n");
  }

  return lines.slice(-12).join("\n");
}

function buildPreviewFallbackLatex(latexCode: string, compileOutput: string) {
  if (/newtx(text|math)\.sty/i.test(compileOutput)) {
    return latexCode.replace(
      String.raw`\usepackage{newtxtext,newtxmath}`,
      String.raw`\usepackage{lmodern}`,
    );
  }

  return null;
}

async function runPdflatex(texPath: string, outputDirectory: string) {
  await execFile(
    "pdflatex",
    [
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-output-directory",
      outputDirectory,
      texPath,
    ],
    {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20_000,
    },
  );
}

function readLatexProcessOutput(error: unknown) {
  return error instanceof Error && "stdout" in error
    ? `${String((error as { stdout?: string }).stdout ?? "")}\n${String(
        (error as { stderr?: string }).stderr ?? "",
      )}`
    : "";
}

export function renderTailorResumeLatex(document: TailorResumeSourceDocument) {
  const headerMacro = renderResumeHeaderMacro(document);
  const sections = document.sections.map((section) => renderSection(section)).join("\n\n");

  return `${latexPreamble}${headerMacro}

${latexHeadingMacros}
\\resumeHeader

${sections}

${latexPostamble}`;
}

export async function compileTailorResumeLatex(latexCode: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tailor-resume-latex-"));
  const texPath = path.join(tempDir, "resume.tex");
  const pdfPath = path.join(tempDir, "resume.pdf");

  try {
    await writeFile(texPath, latexCode, "utf8");
    await runPdflatex(texPath, tempDir);

    return await readFile(pdfPath);
  } catch (error) {
    const output = readLatexProcessOutput(error);
    const fallbackLatex = buildPreviewFallbackLatex(latexCode, output);

    if (fallbackLatex) {
      try {
        await writeFile(texPath, fallbackLatex, "utf8");
        await runPdflatex(texPath, tempDir);
        return await readFile(pdfPath);
      } catch (fallbackError) {
        const fallbackOutput = readLatexProcessOutput(fallbackError);

        throw new Error(
          fallbackOutput
            ? extractRelevantLatexError(fallbackOutput)
            : "Unable to compile the generated LaTeX preview.",
        );
      }
    }

    throw new Error(
      output
        ? extractRelevantLatexError(output)
        : "Unable to compile the generated LaTeX preview.",
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
