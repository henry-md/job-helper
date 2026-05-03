export const tailorResumeLatexTemplate = String.raw`\documentclass[10pt]{article}

\usepackage[
  top=0.4in,
  bottom=0.44in,
  left=0.47in,
  right=0.47in
]{geometry}

\usepackage[T1]{fontenc}
\usepackage{cmap}
\usepackage{tgtermes}
\usepackage[protrusion=true,expansion=false]{microtype}
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
\pdfinterwordspaceon

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
\frenchspacing

% ---------- BULLETS ----------
\setlist[itemize]{
  leftmargin=18pt,
  itemsep=1pt,
  topsep=0pt,
  parsep=0pt,
  partopsep=0pt,
  after={} % ENV: space after last bullet
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
\newcommand{\resumeHeader}{%
  \begin{center}
    {\NameFont\textbf{HENRY DEUTSCH}}\par
    \vspace{2.4pt}
    {\BodyFont
      \href{mailto:HenryMDeutsch@gmail.com}{\tightul{HenryMDeutsch@gmail.com}} $\cdot$ 914-272-5561 $\cdot$
      \href{https://linkedin.com/in/henry-deutsch}{\tightul{linkedin.com/in/henry-deutsch}} $\cdot$
      \href{https://github.com/henry-md}{\tightul{github.com/henry-md}}\par
      \vspace{1.1pt}
      Portfolio: \href{https://henry-deutsch.com}{\tightul{\textbf{henry-deutsch.com}}
      \vspace{-20pt}} % ENV: space between header and 'WORK EXPERIENCE'
    }
  \end{center}
  \vspace{4.2pt}
}

% ---------- HEADINGS ----------
\newcommand{\entryheading}[3]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont\textbf{#1}~|~\textit{#2}} & {\BodyFont #3}
  \end{tabular*}\par\vspace{0pt}
}

\newcommand{\projectheading}[2]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont #1} & {\BodyFont #2}
  \end{tabular*}\par\vspace{0pt}
}

\newcommand{\descline}[1]{{\BodyFont #1\par}}

\newenvironment{resumebullets}{
  % \vspace{0} % ENV: If you want space between description and bullets
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\EntryGap}{\vspace{6.8pt}} % ENV: space between experiences

% labeled line for education/skills
\newcommand{\labelline}[2]{%
  {\BodyFont\noindent\makebox[74pt][l]{\textbf{#1}}#2\par}
}

\input{glyphtounicode}
\pdfgentounicode=1
\begin{document}
\BodyFont

% Fill in the resume body here.

\end{document}
`;

export const tailorResumeLatexExample = String.raw`\documentclass[10pt]{article}

\usepackage[
  top=0.4in,
  bottom=0.44in,
  left=0.47in,
  right=0.47in
]{geometry}

\usepackage[T1]{fontenc}
\usepackage{cmap}
\usepackage{tgtermes}
\usepackage[protrusion=true,expansion=false]{microtype}
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
\pdfinterwordspaceon

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
\frenchspacing

% ---------- BULLETS ----------
\setlist[itemize]{
  leftmargin=18pt,
  itemsep=1pt,
  topsep=0pt,
  parsep=0pt,
  partopsep=0pt,
  after={} % ENV: space after last bullet
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
\newcommand{\resumeHeader}{%
  \begin{center}
    {\NameFont\textbf{HENRY DEUTSCH}}\par
    \vspace{2.4pt}
    {\BodyFont
      \href{mailto:HenryMDeutsch@gmail.com}{\tightul{HenryMDeutsch@gmail.com}} $\cdot$ 914-272-5561 $\cdot$
      \href{https://linkedin.com/in/henry-deutsch}{\tightul{linkedin.com/in/henry-deutsch}} $\cdot$
      \href{https://github.com/henry-md}{\tightul{github.com/henry-md}}\par
      \vspace{1.1pt}
      Portfolio: \href{https://henry-deutsch.com}{\tightul{\textbf{henry-deutsch.com}}
      \vspace{-20pt}} % ENV: space between header and 'WORK EXPERIENCE'
    }
  \end{center}
  \vspace{4.2pt}
}

% ---------- HEADINGS ----------
\newcommand{\entryheading}[3]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont\textbf{#1}~|~\textit{#2}} & {\BodyFont #3}
  \end{tabular*}\par\vspace{0pt}
}

\newcommand{\projectheading}[2]{%
  \noindent
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    {\BodyFont #1} & {\BodyFont #2}
  \end{tabular*}\par\vspace{0pt}
}

\newcommand{\descline}[1]{{\BodyFont #1\par}}

\newenvironment{resumebullets}{
  % \vspace{0} % ENV: If you want space between description and bullets
  \begin{itemize}\BodyFont
}{
  \end{itemize}
}

\newcommand{\resumeitem}[1]{\item #1}
\newcommand{\EntryGap}{\vspace{6.8pt}} % ENV: space between experiences

% labeled line for education/skills
\newcommand{\labelline}[2]{%
  {\BodyFont\noindent\makebox[74pt][l]{\textbf{#1}}#2\par}
}

\input{glyphtounicode}
\pdfgentounicode=1
\begin{document}
% removed for ATS
% \spaceskip=0.25em plus 0.2em minus 0.1em
% \xspaceskip=\spaceskip
\BodyFont

\resumeHeader

% ================= WORK EXPERIENCE =================
\resumeSection{WORK EXPERIENCE}

\entryheading{NewForm AI}{Software Engineer I --- Full Time}{Aug 2025 - Feb 2026}
\descline{NewForm provides B2B analytics for consumer companies on their ads, synthesized using deep data modeling and AI.}
\descline{Reported to the CTO and took ownership of 6 major initiatives from inception to implementation in direct collaboration with C-suite}
\begin{resumebullets}
  \resumeitem{Led major refactor enabling \textbf{\$50K+/mo in TikTok ad spend} by incorporating TikTok support for our entire suite of software. Refactored \textbf{31K+ LOC in 365 files}, reworking \textbf{140+ tRPC endpoints \& Bayesian inference engine} for platform-agnostic objects}
  \resumeitem{Conceived and led ad similarity detection service, authoring white paper and deploying \textbf{p-hashing to 359K ads across 20 clients}}
  \resumeitem{Built and migrated \textbf{100\% of internal account managers and external clients} to a streamlined messaging and reporting system}
\end{resumebullets}
\EntryGap

\entryheading{KnoWhiz}{Software Engineering Intern}{May 2024 - Sep 2024}
\descline{Developed full-stack features for LLM-based AI learning platform that serves 4.3K+ monthly active users}
\begin{resumebullets}
  \resumeitem{Rearchitected full-stack Quizlet import feature to cut large import failures from \textbf{\textasciitilde50\% to \textless4\%} on 4.3K MAUs, \textbf{saving \textasciitilde200 user hours /mo}. Used WebSocket-based progress updates, Java Spring Boot batching and two-phase commit patterns}
  \resumeitem{Led \textbf{SEO} improvements and created a gateway Explore page, \textbf{increasing monthly organic traffic by \textasciitilde10\%}}
  \resumeitem{\textbf{Mentored} developer in React and TypeScript, cutting PR review cycles by \textbf{\textasciitilde50\%} and enabling delivery of 12+ production features}
\end{resumebullets}
\EntryGap

\entryheading{HF Engineering}{Software Engineering Intern}{May 2024 - Sep 2024}
\descline{Led development of internal onboarding platform enabling 18,000 volunteers to collaborate on open source projects}
\begin{resumebullets}
  \resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines, \textbf{reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}}
  \resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}
\end{resumebullets}
\EntryGap

\entryheading{Johns Hopkins University}{Software Development Intern}{May 2023 - Aug 2023}
\descline{Built full-stack disaster relief analytics platform for the National Institute of Standards and Technology (NIST)}
\begin{resumebullets}
  \resumeitem{Developed a \textbf{Python and SQL} backend and \textbf{Plotly Dash} frontend. Followed \textbf{agile sprint} cycles and \textbf{Scrum} within a team}
  \resumeitem{Led database redesign and SQL schema optimization to support new media type uploads, allowing new GPS analysis features}
  \resumeitem{Integrated \textbf{transformer-based deep neural network} to analyze audio. Achieved 92\% accuracy in extreme-condition classification}
\end{resumebullets}

% ================= EDUCATION =================
\resumeSection{EDUCATION}

\noindent
\begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
  {\BodyFont\textbf{Johns Hopkins University}~|~Bachelor of Science in Computer Science~|~Baltimore, MD} &
  {\BodyFont Aug 2021 - May 2025}
\end{tabular*}\par\vspace{0pt}

{\BodyFont\hspace*{20pt}\textbf{Graduated with Departmental Honors in Computer Science}\par}

{\BodyFont
\noindent\hspace*{20pt}\textbf{Courses: }%
\hangindent=61pt
\hangafter=1
Full-Stack JavaScript, Artificial Intelligence, Machine Learning, Practical Generative AI, Computer Graphics, Intermediate Programming (C++), Computer System Fundamentals, Data Structures, Algorithms, Calculus III, Physics II\par
}

{\BodyFont
\noindent\textbf{Awards: }%
Placed 3rd of 43 teams, won \$250 prize at HopHacks Hackathon for \href{https://devpost.com/software/check-it-out}{\tightul{reimagining grocery checkout with computer vision}}\par
}

% ================= SOFTWARE PROJECTS =================
\resumeSection{SOFTWARE PROJECTS}

\projectheading{\href{https://vincentdunn.com/}{\tightul{\textbf{Chief of NYC Fire Dept Website}}}~|~Paid Contract --- Full Stack Developer}{Sep 2021 - Present}
\begin{resumebullets}
  \resumeitem{Improved SEO, increasing traffic from \textbf{\textless100 to \textgreater3.6k visits per mo.} and book royalties from \textbf{8K to \textasciitilde24K YoY (2.99x)}}
  \resumeitem{Used custom \textbf{Java-based PDF parser} to extract structured content from 200+ pages and generate \textbf{HTML and CSS} layouts}
  \resumeitem{Developed learning platform with \textbf{React and JavaScript} with quiz functionality, content management, and progress tracking}
\end{resumebullets}
\EntryGap

\projectheading{\href{https://github.com/henry-md/ray-tracer}{\tightul{\textbf{C++ Ray Tracing Engine}}}~}{}
\begin{resumebullets}
  \resumeitem{Architected ray tracing engine with \textbf{C++}, \textbf{OpenGL}, and \textbf{multithreading} --- achieved 2.5x speedup over single-thread approach}
  \resumeitem{Engineered 3D rendering pipeline with \textbf{GLSL} shaders and parallel \textbf{computational geometry} intersection algorithms}
  \resumeitem{Developed Phong illumination with quaternion camera controls, bilinear \textbf{texture mapping}, and ray-traced shadow systems}
\end{resumebullets}
\EntryGap

{\BodyFont\href{https://github.com/sciserver/BOOM}{\tightul{\textbf{N-Body Orbit Simulations}}}~|~Research at Johns Hopkins\par}
\descline{Developed AI-powered orbit analysis system using autoencoder \textbf{neural network}, and latent space analysis with clustering algorithms}
\begin{resumebullets}
  \resumeitem{Built convolutional autoencoder with \textbf{PyTorch and NumPy}. Achieved 200:1 compression with .02 MSE loss on orbit data}
  \resumeitem{Classified orbit paths by their latent space in the NN with \textbf{K-means, Hierarchical, Agglomerative} clustering methods in \textbf{Python}}
  \resumeitem{Deployed scalable ML infrastructure on \textbf{AWS EC2} cloud stores enabling parallel processing of 10k+ orbit simulations}
\end{resumebullets}

% ================= TECHNICAL SKILLS =================
\resumeSection{TECHNICAL SKILLS}

{\BodyFont
\noindent\textbf{Full-Stack Web Dev: }%
\hangindent=112pt
\hangafter=1
Next.js, React, Node.js, Express.js, Prisma, Redis, tRPC, MongoDB (MERN stack), SQL, Tailwind, Vite\par
}

{\BodyFont
\noindent\textbf{Languages: }%
\hangindent=74pt
\hangafter=1
TypeScript, JavaScript, Python, Java, C++, SQL, HTML, CSS\par
}

{\BodyFont
\noindent\textbf{Other Software: }%
\hangindent=104pt
\hangafter=1
Firebase, Supabase, Git, Jira, Unix/Linux, Kubernetes, Docker, Plotly Dash, AWS (EC2, Amplify), PyTorch\par
}

\end{document}
`;
