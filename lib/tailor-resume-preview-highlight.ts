import { stripTailorResumeSegmentIds } from "./tailor-resume-segmentation.ts";

const reviewHighlightPreambleMarker = "% JOBHELPER_REVIEW_HIGHLIGHT_MACROS";
const missingSegmentErrorMessage =
  "Unable to locate the selected tailored resume segment.";
const annotatedSegmentPattern =
  /^[ \t]*% JOBHELPER_SEGMENT_ID:\s*([^\n]+)\s*(?:\n|$)/gm;

const reviewHighlightPreamble = String.raw`
% JOBHELPER_REVIEW_HIGHLIGHT_MACROS
\definecolor{JobHelperReviewAccent}{RGB}{196,118,24}
\newcommand{\jobhelperReviewMark}{%
  \llap{\hspace*{-0.2in}\textcolor{JobHelperReviewAccent}{\rule{0.11in}{0.82em}}\hspace{0.08in}}%
}
\newcommand{\jobhelperHighlightedResumeSection}[1]{%
  \vspace{5pt}
  {\SectionFont\jobhelperReviewMark\textcolor{JobHelperReviewAccent}{\textbf{#1}}}\par
  \vspace{1.2pt}
  {\color{JobHelperReviewAccent}\hrule height 0.7pt}
  \vspace{3.8pt}
}
\newcommand{\jobhelperHighlightedEntryheading}[3]{%
  \noindent
  \jobhelperReviewMark
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont\textcolor{JobHelperReviewAccent}{\textbf{#1}~|~\textit{#2}}} &
    {\BodyFont\textcolor{JobHelperReviewAccent}{#3}}
  \end{tabular*}\par
}
\newcommand{\jobhelperHighlightedProjectheading}[2]{%
  \noindent
  \jobhelperReviewMark
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont\textcolor{JobHelperReviewAccent}{#1}} &
    {\BodyFont\textcolor{JobHelperReviewAccent}{#2}}
  \end{tabular*}\par
}
\newcommand{\jobhelperHighlightedDescline}[1]{{\BodyFont\jobhelperReviewMark\textcolor{JobHelperReviewAccent}{#1}\par}}
\newcommand{\jobhelperHighlightedResumeitem}[1]{\item {\jobhelperReviewMark\textcolor{JobHelperReviewAccent}{#1}}}
\newcommand{\jobhelperHighlightedLabelline}[2]{%
  {\BodyFont\noindent\jobhelperReviewMark\makebox[74pt][l]{\textcolor{JobHelperReviewAccent}{\textbf{#1}}}\textcolor{JobHelperReviewAccent}{#2}\par}
}
`;

function injectReviewHighlightPreamble(latexCode: string) {
  if (latexCode.includes(reviewHighlightPreambleMarker)) {
    return latexCode;
  }

  const documentStartIndex = latexCode.indexOf("\\begin{document}");

  if (documentStartIndex === -1) {
    throw new Error("Unable to inject review highlight macros into the LaTeX document.");
  }

  return (
    latexCode.slice(0, documentStartIndex) +
    reviewHighlightPreamble +
    "\n" +
    latexCode.slice(documentStartIndex)
  );
}

function replaceLeadingCommand(
  latexCode: string,
  originalCommand: string,
  replacementCommand: string,
) {
  return latexCode.replace(
    new RegExp(`^(\\s*)\\\\${originalCommand}(?=\\s*[\\[{])`),
    (_match, indentation: string) => `${indentation}\\${replacementCommand}`,
  );
}

function readPersistedAnnotatedBlocks(annotatedLatexCode: string) {
  const matches: Array<{
    id: string;
    markerEnd: number;
    markerStart: number;
  }> = [];

  for (const match of annotatedLatexCode.matchAll(annotatedSegmentPattern)) {
    const markerStart = match.index ?? 0;
    const markerText = match[0] ?? "";
    const rawId = match[1] ?? "";
    const id = rawId.trim();

    if (!id || !markerText) {
      continue;
    }

    matches.push({
      id,
      markerEnd: markerStart + markerText.length,
      markerStart,
    });
  }

  return matches.map((match, index) => {
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.markerStart ?? annotatedLatexCode.length;
    const latexCode = annotatedLatexCode
      .slice(match.markerEnd, contentEnd)
      .replace(/\n+$/, "");

    return {
      contentEnd,
      contentStart: match.markerEnd,
      id: match.id,
      latexCode,
    };
  });
}

function detectTailoredResumeBlockCommand(latexCode: string, segmentId: string) {
  if (segmentId.includes(".block-")) {
    return "block";
  }

  const trimmedLatexCode = latexCode.trimStart();

  if (trimmedLatexCode.startsWith("\\resumeSection")) {
    return "resumeSection";
  }

  if (trimmedLatexCode.startsWith("\\entryheading")) {
    return "entryheading";
  }

  if (trimmedLatexCode.startsWith("\\projectheading")) {
    return "projectheading";
  }

  if (trimmedLatexCode.startsWith("\\descline")) {
    return "descline";
  }

  if (trimmedLatexCode.startsWith("\\resumeitem")) {
    return "resumeitem";
  }

  if (trimmedLatexCode.startsWith("\\labelline")) {
    return "labelline";
  }

  return null;
}

function highlightTailoredResumeBlock(input: {
  command: string | null;
  latexCode: string;
}) {
  switch (input.command) {
    case "resumeSection":
      return replaceLeadingCommand(
        input.latexCode,
        "resumeSection",
        "jobhelperHighlightedResumeSection",
      );
    case "entryheading":
      return replaceLeadingCommand(
        input.latexCode,
        "entryheading",
        "jobhelperHighlightedEntryheading",
      );
    case "projectheading":
      return replaceLeadingCommand(
        input.latexCode,
        "projectheading",
        "jobhelperHighlightedProjectheading",
      );
    case "descline":
      return replaceLeadingCommand(
        input.latexCode,
        "descline",
        "jobhelperHighlightedDescline",
      );
    case "resumeitem":
      return replaceLeadingCommand(
        input.latexCode,
        "resumeitem",
        "jobhelperHighlightedResumeitem",
      );
    case "labelline":
      return replaceLeadingCommand(
        input.latexCode,
        "labelline",
        "jobhelperHighlightedLabelline",
      );
    default:
      return `{
\\jobhelperReviewMark\\color{JobHelperReviewAccent}
${input.latexCode}
}`;
  }
}

export function isMissingTailoredResumeReviewSegmentError(error: unknown) {
  return error instanceof Error && error.message === missingSegmentErrorMessage;
}

export function buildTailoredResumeReviewHighlightedLatex(input: {
  annotatedLatexCode: string;
  segmentId: string;
}) {
  const annotatedLatexCode = input.annotatedLatexCode
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = readPersistedAnnotatedBlocks(annotatedLatexCode);
  const targetBlock = blocks.find((block) => block.id === input.segmentId);

  if (!targetBlock) {
    throw new Error(missingSegmentErrorMessage);
  }

  const originalBlockChunk = annotatedLatexCode.slice(
    targetBlock.contentStart,
    targetBlock.contentEnd,
  );
  const trailingWhitespace = originalBlockChunk.slice(targetBlock.latexCode.length);
  const highlightedAnnotatedLatex =
    annotatedLatexCode.slice(0, targetBlock.contentStart) +
    highlightTailoredResumeBlock({
      command: detectTailoredResumeBlockCommand(
        targetBlock.latexCode,
        targetBlock.id,
      ),
      latexCode: targetBlock.latexCode,
    }) +
    trailingWhitespace +
    annotatedLatexCode.slice(targetBlock.contentEnd);

  return injectReviewHighlightPreamble(
    stripTailorResumeSegmentIds(highlightedAnnotatedLatex),
  );
}
