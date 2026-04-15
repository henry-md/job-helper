import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  TailorResumeSourceDocument,
  TailorResumeSourceEntryItem,
  TailorResumeSourceLabeledLineItem,
  TailorResumeSourceSection,
  TailorResumeSourceSegment,
  TailorResumeSourceUnit,
} from "@/lib/tailor-resume-types";
import { readSourceUnitText } from "@/lib/tailor-resume-source";

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

\linespread{1.08}

\definecolor{LinkBlue}{RGB}{45,95,210}

\renewcommand{\ULdepth}{0.7pt}
\renewcommand{\ULthickness}{0.3pt}
\newcommand{\tightul}[1]{\uline{\smash{#1}}}

\newcommand{\NameFont}{\fontsize{14}{15}\selectfont}
\newcommand{\BodyFont}{\fontsize{10.2}{11.8}\selectfont}
\newcommand{\SectionFont}{\fontsize{10}{11}\selectfont}

\setlist[itemize]{
  leftmargin=18pt,
  itemsep=1pt,
  topsep=1pt,
  parsep=0pt,
  partopsep=0pt,
  after=\vspace{2pt}
}

\newcommand{\resumeSection}[1]{%
  \vspace{5pt}
  {\SectionFont\textbf{#1}}\par
  \vspace{1.2pt}
  \hrule height 0.5pt
  \vspace{3.8pt}
}

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
  \vspace{0}
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\EntryGap}{\vspace{3.8pt}}

\begin{document}
\BodyFont
`;

const latexPostamble = String.raw`\end{document}
`;

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSectionKey(section: TailorResumeSourceSection) {
  return collapseWhitespace(readSourceUnitText(section.title)).toUpperCase();
}

function escapeLatexText(value: string) {
  const normalizedValue = value
    .replace(/\u00a0/g, " ")
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/~/g, "\\textasciitilde")
    .replace(/</g, "\\textless")
    .replace(/>/g, "\\textgreater");

  return normalizedValue.replace(/[\\{}$&#_%^]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\textbackslash{}";
      case "{":
        return "\\{";
      case "}":
        return "\\}";
      case "$":
        return "\\$";
      case "&":
        return "\\&";
      case "#":
        return "\\#";
      case "_":
        return "\\_";
      case "%":
        return "\\%";
      case "^":
        return "\\textasciicircum{}";
      default:
        return character;
    }
  });
}

function escapeLatexUrl(value: string) {
  return value.replace(/[\\{}%#&]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\textbackslash{}";
      case "{":
        return "\\{";
      case "}":
        return "\\}";
      case "%":
        return "\\%";
      case "#":
        return "\\#";
      case "&":
        return "\\&";
      default:
        return character;
    }
  });
}

function renderTextSegment(
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

  if (segment.isLinkStyle) {
    if (segment.linkUrl) {
      renderedText = `\\href{${escapeLatexUrl(segment.linkUrl)}}{${renderedText}}`;
    } else {
      renderedText = `{\\color{LinkBlue}${renderedText}}`;
    }
  }

  return renderedText;
}

function renderSegments(
  segments: TailorResumeSourceSegment[],
  options?: {
    ignoreBold?: boolean;
    ignoreItalic?: boolean;
  },
) {
  return segments.map((segment) => renderTextSegment(segment, options)).join("");
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

function hasBoldText(segments: TailorResumeSourceSegment[]) {
  return segments.some(
    (segment) => segment.segmentType === "text" && segment.isBold,
  );
}

function renderWrappedSegments(
  segments: TailorResumeSourceSegment[],
  wrapper: "bold" | "italic",
  options?: {
    ignoreBold?: boolean;
    ignoreItalic?: boolean;
  },
) {
  const content = renderSegments(segments, options);

  if (!content) {
    return "";
  }

  return wrapper === "bold" ? `\\textbf{${content}}` : `\\textit{${content}}`;
}

function renderHeader(document: TailorResumeSourceDocument) {
  const nameLine = renderSegments(document.header.name.segments);
  const headerLines = document.header.lines
    .map(
      (line, index) =>
        `    {\\BodyFont ${renderSegments(line.segments)}}\\par${
          index === document.header.lines.length - 1 ? "" : "\n    \\vspace{1.1pt}"
        }`,
    )
    .join("\n");

  return [
    String.raw`\begin{center}`,
    `  {\\NameFont ${nameLine}}\\par`,
    String.raw`  \vspace{2.4pt}`,
    headerLines,
    String.raw`\end{center}`,
    String.raw`\vspace{4.2pt}`,
  ].join("\n");
}

function renderEntryBullets(item: TailorResumeSourceEntryItem) {
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

function renderWorkExperienceEntry(item: TailorResumeSourceEntryItem) {
  const parts = splitSegmentsByPipe(item.heading.segments);
  const companySegments = parts[0] ?? [];
  const roleSegments = parts.slice(1).flat();
  const company = renderSegments(companySegments, { ignoreBold: true });
  const role = renderSegments(roleSegments, { ignoreItalic: true });
  const dates = item.dates ? renderSegments(item.dates.segments) : "";
  const descriptionLines = item.descriptionLines.map(
    (line) => `\\descline{${renderSegments(line.segments)}}`,
  );
  const bullets = renderEntryBullets(item);

  return [
    `\\entryheading{${company}}{${role}}{${dates}}`,
    ...descriptionLines,
    bullets,
    String.raw`\EntryGap`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderEducationEntry(item: TailorResumeSourceEntryItem) {
  const parts = splitSegmentsByPipe(item.heading.segments);
  const firstPart = parts.shift() ?? [];
  const leftText = [
    hasBoldText(firstPart)
      ? renderSegments(firstPart)
      : renderWrappedSegments(firstPart, "bold"),
    ...parts.map((part) => renderSegments(part)),
  ].join("~|~");
  const dates = item.dates ? renderSegments(item.dates.segments) : "";
  const descriptionLines = item.descriptionLines.map((line) => {
    const content = hasBoldText(line.segments)
      ? renderSegments(line.segments)
      : renderWrappedSegments(line.segments, "bold");
    return `{\\BodyFont\\hspace*{20pt}${content}\\par}`;
  });
  const bullets = renderEntryBullets(item);

  return [
    String.raw`\noindent`,
    String.raw`\begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}`,
    `  {\\BodyFont ${leftText}} & {\\BodyFont ${dates}}`,
    String.raw`\end{tabular*}\par`,
    ...descriptionLines,
    bullets,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderProjectHeading(heading: TailorResumeSourceUnit) {
  const parts = splitSegmentsByPipe(heading.segments);
  const firstPart = parts.shift() ?? [];
  const firstPartRendered = hasBoldText(firstPart)
    ? renderSegments(firstPart)
    : renderWrappedSegments(firstPart, "bold");

  if (parts.length === 0) {
    return firstPartRendered;
  }

  return [firstPartRendered, ...parts.map((part) => renderSegments(part))].join("~|~");
}

function renderProjectEntry(item: TailorResumeSourceEntryItem) {
  const headingText = renderProjectHeading(item.heading);
  const dates = item.dates ? renderSegments(item.dates.segments) : null;
  const descriptionLines = item.descriptionLines.map(
    (line) => `\\descline{${renderSegments(line.segments)}}`,
  );
  const bullets = renderEntryBullets(item);

  return [
    dates
      ? `\\projectheading{${headingText}}{${dates}}`
      : `{\\BodyFont ${headingText}\\par}`,
    ...descriptionLines,
    bullets,
    String.raw`\EntryGap`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderParagraphUnit(
  unit: TailorResumeSourceUnit,
  options?: {
    indent?: number;
  },
) {
  const indentation = options?.indent ? `\\hspace*{${options.indent}pt}` : "";
  return `{\\BodyFont${indentation}${renderSegments(unit.segments)}\\par}`;
}

function renderLabeledLine(
  item: TailorResumeSourceLabeledLineItem,
  options?: {
    indent?: number;
  },
) {
  const indentation = options?.indent ? `\\hspace*{${options.indent}pt}` : "";
  const label = hasBoldText(item.label.segments)
    ? renderSegments(item.label.segments)
    : renderWrappedSegments(item.label.segments, "bold");
  const value = renderSegments(item.value.segments);

  return `{\\BodyFont\\noindent${indentation}${label}${value}\\par}`;
}

function renderSection(section: TailorResumeSourceSection) {
  const sectionKey = normalizeSectionKey(section);
  const title = renderSegments(section.title.segments, { ignoreBold: true });
  const renderedItems = section.items.map((item) => {
    if (item.itemType === "entry") {
      if (sectionKey === "WORK EXPERIENCE") {
        return renderWorkExperienceEntry(item);
      }

      if (sectionKey === "EDUCATION") {
        return renderEducationEntry(item);
      }

      if (sectionKey === "SOFTWARE PROJECTS") {
        return renderProjectEntry(item);
      }

      const dates = item.dates ? renderSegments(item.dates.segments) : "";
      const descriptions = item.descriptionLines.map(
        (line) => `\\descline{${renderSegments(line.segments)}}`,
      );
      const bullets = renderEntryBullets(item);

      return [
        dates
          ? `\\projectheading{${renderSegments(item.heading.segments)}}{${dates}}`
          : `{\\BodyFont ${renderSegments(item.heading.segments)}\\par}`,
        ...descriptions,
        bullets,
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (item.itemType === "labeled_line") {
      if (sectionKey === "EDUCATION") {
        const labelText = collapseWhitespace(readSourceUnitText(item.label)).toUpperCase();
        return renderLabeledLine(item, {
          indent: labelText.startsWith("COURSES:") ? 20 : 0,
        });
      }

      return renderLabeledLine(item);
    }

    return renderParagraphUnit(item.content);
  });

  return [`\\resumeSection{${title}}`, ...renderedItems].join("\n\n");
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

export function renderTailorResumeLatex(document: TailorResumeSourceDocument) {
  const sections = document.sections.map((section) => renderSection(section)).join("\n\n");

  return `${latexPreamble}
${renderHeader(document)}

${sections}

${latexPostamble}`;
}

export async function compileTailorResumeLatex(latexCode: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tailor-resume-latex-"));
  const texPath = path.join(tempDir, "resume.tex");
  const pdfPath = path.join(tempDir, "resume.pdf");

  try {
    await writeFile(texPath, latexCode, "utf8");

    await execFile(
      "pdflatex",
      [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-output-directory",
        tempDir,
        texPath,
      ],
      {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 20_000,
      },
    );

    return await readFile(pdfPath);
  } catch (error) {
    const output =
      error instanceof Error && "stdout" in error
        ? `${String((error as { stdout?: string }).stdout ?? "")}\n${String(
            (error as { stderr?: string }).stderr ?? "",
          )}`
        : "";

    throw new Error(
      output
        ? extractRelevantLatexError(output)
        : "Unable to compile the generated LaTeX preview.",
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
