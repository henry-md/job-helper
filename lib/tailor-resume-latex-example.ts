export const tailorResumeLatexTemplate = String.raw`\documentclass[10pt]{article}

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
  \vspace{0pt}
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\labelline}[2]{%
  {\BodyFont\noindent\makebox[74pt][l]{\textbf{#1}}#2\par}
}

\begin{document}
\BodyFont

% Fill in the resume body here.

\end{document}
`;

export const tailorResumeLatexExample = String.raw`\documentclass[10pt]{article}

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
  \vspace{0pt}
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\labelline}[2]{%
  {\BodyFont\noindent\makebox[74pt][l]{\textbf{#1}}#2\par}
}

\begin{document}
\BodyFont

{\NameFont\textbf{Henry Deutsch}}\par
\vspace{6pt}
HenryMDeutsch@gmail.com $\\cdot$ 914-272-5561 $\\cdot$ \href{https://linkedin.com/in/henry-deutsch}{\tightul{linkedin.com/in/henry-deutsch}}\par
\vspace{4pt}
\href{https://henry-deutsch.com}{\tightul{henry-deutsch.com}}\par

\resumeSection{WORK EXPERIENCE}

\entryheading{NewForm AI}{Software Engineer I -- Full Time}{Aug 2025 -- Feb 2026}
\descline{NewForm provides B2B analytics for consumer companies on their ads, synthesized using deep data modeling and AI.}
\begin{resumebullets}
  \resumeitem{Led major refactor enabling \$50K+/mo in TikTok ad spend by incorporating TikTok support for the full software suite.}
\end{resumebullets}

\resumeSection{TECHNICAL SKILLS}

\labelline{Languages:}{TypeScript, JavaScript, Python}

\end{document}
`;
