import type {
  ResumeSegmentType,
  TailorResumeSourceDocument,
  TailorResumeSourceSegment,
  TailorResumeSourceUnit,
  TailorResumeSourceUnitKind,
} from "../../../lib/tailor-resume-types.ts";

type SegmentInput =
  | {
      segmentType?: "text";
      text: string;
      isBold?: boolean;
      isItalic?: boolean;
      isLinkStyle?: boolean;
      isUnderline?: boolean;
      linkUrl?: string | null;
    }
  | {
      segmentType: Extract<ResumeSegmentType, "separator_bullet" | "separator_pipe">;
      text?: string;
    };

function segment(
  unitId: string,
  index: number,
  input: SegmentInput,
): TailorResumeSourceSegment {
  if (input.segmentType === "separator_pipe") {
    return {
      id: `${unitId}_seg_${String(index + 1).padStart(2, "0")}`,
      isBold: false,
      isItalic: false,
      isLinkStyle: false,
      isUnderline: false,
      linkUrl: null,
      segmentType: "separator_pipe",
      text: "|",
    };
  }

  if (input.segmentType === "separator_bullet") {
    return {
      id: `${unitId}_seg_${String(index + 1).padStart(2, "0")}`,
      isBold: false,
      isItalic: false,
      isLinkStyle: false,
      isUnderline: false,
      linkUrl: null,
      segmentType: "separator_bullet",
      text: "•",
    };
  }

  const textInput = input as Exclude<SegmentInput, { segmentType: "separator_pipe" | "separator_bullet" }>;

  return {
    id: `${unitId}_seg_${String(index + 1).padStart(2, "0")}`,
    isBold: textInput.isBold ?? false,
    isItalic: textInput.isItalic ?? false,
    isLinkStyle: textInput.isLinkStyle ?? false,
    isUnderline: textInput.isUnderline ?? textInput.isLinkStyle ?? false,
    linkUrl: textInput.linkUrl ?? null,
    segmentType: "text",
    text: textInput.text,
  };
}

function unit(
  id: string,
  kind: TailorResumeSourceUnitKind,
  parts: SegmentInput[],
  indentLevel = 0,
): TailorResumeSourceUnit {
  return {
    id,
    indentLevel,
    kind,
    segments: parts.map((part, index) => segment(id, index, part)),
  };
}

export const henryDeutschSourceDocument = {
  headerText: unit("header_text", "header_text", [
    { text: "HENRY DEUTSCH", isBold: true },
  ]),
  sections: [
    {
      id: "section_01",
      title: unit("section_01_title", "section_title", [
        { text: "WORK EXPERIENCE", isBold: true },
      ]),
      items: [
        {
          id: "section_01_item_01",
          itemType: "entry",
          heading: unit("section_01_item_01_heading", "entry_heading", [
            { text: "NewForm AI", isBold: true },
            { segmentType: "separator_pipe" },
            { text: "Software Engineer I --- Full Time", isItalic: true },
          ]),
          dates: unit("section_01_item_01_dates", "entry_dates", [
            { text: "Aug 2025 - Feb 2026" },
          ]),
          description: unit("section_01_item_01_description", "entry_description", [
            {
              text: "NewForm provides B2B analytics for consumer companies on their ads, synthesized using deep data modeling and AI. Reported to the CTO and took ownership of 6 major initiatives from inception to implementation in direct collaboration with C-suite",
            },
          ]),
          bulletLines: [
            unit("section_01_item_01_bullet_01", "bullet", [
              { text: "Led major refactor enabling " },
              { text: "$50K+/mo in TikTok ad spend", isBold: true },
              {
                text: " by incorporating TikTok support for our entire suite of software. Refactored ",
              },
              { text: "31K+ LOC in 365 files", isBold: true },
              { text: ", reworking " },
              { text: "140+ tRPC endpoints & Bayesian inference engine", isBold: true },
              { text: " for platform-agnostic objects" },
            ], 1),
            unit("section_01_item_01_bullet_02", "bullet", [
              {
                text: "Conceived and led ad similarity detection service, authoring white paper and deploying ",
              },
              { text: "p-hashing to 359K ads across 20 clients", isBold: true },
            ], 1),
            unit("section_01_item_01_bullet_03", "bullet", [
              { text: "Built and migrated " },
              {
                text: "100% of internal account managers and external clients",
                isBold: true,
              },
              { text: " to a streamlined messaging and reporting system" },
            ], 1),
          ],
        },
        {
          id: "section_01_item_02",
          itemType: "entry",
          heading: unit("section_01_item_02_heading", "entry_heading", [
            { text: "KnoWhiz", isBold: true },
            { segmentType: "separator_pipe" },
            { text: "Software Engineering Intern", isItalic: true },
          ]),
          dates: unit("section_01_item_02_dates", "entry_dates", [
            { text: "May 2024 - Sep 2024" },
          ]),
          description: unit("section_01_item_02_description", "entry_description", [
            {
              text: "Developed full-stack features for LLM-based AI learning platform that serves 4.3K+ monthly active users",
            },
          ]),
          bulletLines: [
            unit("section_01_item_02_bullet_01", "bullet", [
              {
                text: "Rearchitected full-stack Quizlet import feature to cut large import failures from ",
              },
              { text: "~50% to <4%", isBold: true },
              { text: " on 4.3K MAUs, " },
              { text: "saving ~200 user hours /mo", isBold: true },
              {
                text: ". Used WebSocket-based progress updates, Java Spring Boot batching and two-phase commit patterns",
              },
            ], 1),
            unit("section_01_item_02_bullet_02", "bullet", [
              { text: "Led " },
              { text: "SEO", isBold: true },
              { text: " improvements and created a gateway Explore page, " },
              { text: "increasing monthly organic traffic by ~10%", isBold: true },
            ], 1),
            unit("section_01_item_02_bullet_03", "bullet", [
              { text: "Mentored", isBold: true },
              { text: " developer in React and TypeScript, cutting PR review cycles by " },
              { text: "~50%", isBold: true },
              { text: " and enabling delivery of 12+ production features" },
            ], 1),
          ],
        },
        {
          id: "section_01_item_03",
          itemType: "entry",
          heading: unit("section_01_item_03_heading", "entry_heading", [
            { text: "HF Engineering", isBold: true },
            { segmentType: "separator_pipe" },
            { text: "Software Engineering Intern", isItalic: true },
          ]),
          dates: unit("section_01_item_03_dates", "entry_dates", [
            { text: "May 2024 - Sep 2024" },
          ]),
          description: unit("section_01_item_03_description", "entry_description", [
            {
              text: "Led development of internal onboarding platform enabling 18,000 volunteers to collaborate on open source projects",
            },
          ]),
          bulletLines: [
            unit("section_01_item_03_bullet_01", "bullet", [
              { text: "Used " },
              { text: "AWS Amplify", isBold: true },
              { text: " to set up " },
              { text: "CI/CD", isBold: true },
              { text: " pipelines, " },
              {
                text: "reducing design-to-dev handoff time by an avg. of ~30% across 8 teams",
                isBold: true,
              },
            ], 1),
            unit("section_01_item_03_bullet_02", "bullet", [
              { text: "Created full-stack dashboard for project management with " },
              { text: "React (Next.js) and JavaScript", isBold: true },
              { text: ", with user authentication" },
            ], 1),
          ],
        },
        {
          id: "section_01_item_04",
          itemType: "entry",
          heading: unit("section_01_item_04_heading", "entry_heading", [
            { text: "Johns Hopkins University", isBold: true },
            { segmentType: "separator_pipe" },
            { text: "Software Development Intern", isItalic: true },
          ]),
          dates: unit("section_01_item_04_dates", "entry_dates", [
            { text: "May 2023 - Aug 2023" },
          ]),
          description: unit("section_01_item_04_description", "entry_description", [
            {
              text: "Built full-stack disaster relief analytics platform for the National Institute of Standards and Technology (NIST)",
            },
          ]),
          bulletLines: [
            unit("section_01_item_04_bullet_01", "bullet", [
              { text: "Developed a " },
              { text: "Python and SQL", isBold: true },
              { text: " backend and " },
              { text: "Plotly Dash", isBold: true },
              { text: " frontend. Followed " },
              { text: "agile sprint", isBold: true },
              { text: " cycles and " },
              { text: "Scrum", isBold: true },
              { text: " within a team" },
            ], 1),
            unit("section_01_item_04_bullet_02", "bullet", [
              {
                text: "Led database redesign and SQL schema optimization to support new media type uploads, allowing new GPS analysis features",
              },
            ], 1),
            unit("section_01_item_04_bullet_03", "bullet", [
              { text: "Integrated " },
              { text: "transformer-based deep neural network", isBold: true },
              {
                text: " to analyze audio. Achieved 92% accuracy in extreme-condition classification",
              },
            ], 1),
          ],
        },
      ],
    },
    {
      id: "section_02",
      title: unit("section_02_title", "section_title", [
        { text: "EDUCATION", isBold: true },
      ]),
      items: [
        {
          id: "section_02_item_01",
          itemType: "entry",
          heading: unit("section_02_item_01_heading", "entry_heading", [
            { text: "Johns Hopkins University", isBold: true },
            { segmentType: "separator_pipe" },
            { text: "Bachelor of Science in Computer Science" },
            { segmentType: "separator_pipe" },
            { text: "Baltimore, MD" },
          ]),
          dates: unit("section_02_item_01_dates", "entry_dates", [
            { text: "Aug 2021 - May 2025" },
          ]),
          description: unit("section_02_item_01_description", "entry_description", [
            {
              text: "Graduated with Departmental Honors in Computer Science",
              isBold: true,
            },
          ]),
          bulletLines: [],
        },
        {
          id: "section_02_item_02",
          itemType: "labeled_line",
          label: unit("section_02_item_02_label", "labeled_line_label", [
            { text: "Courses: ", isBold: true },
          ]),
          value: unit("section_02_item_02_value", "labeled_line_value", [
            {
              text: "Full-Stack JavaScript, Artificial Intelligence, Machine Learning, Practical Generative AI, Computer Graphics, Intermediate Programming (C++), Computer System Fundamentals, Data Structures, Algorithms, Calculus III, Physics II",
            },
          ]),
        },
        {
          id: "section_02_item_03",
          itemType: "labeled_line",
          label: unit("section_02_item_03_label", "labeled_line_label", [
            { text: "Awards: ", isBold: true },
          ]),
          value: unit("section_02_item_03_value", "labeled_line_value", [
            {
              text: "Placed 3rd of 43 teams, won $250 prize at HopHacks Hackathon for ",
            },
            {
              text: "reimagining grocery checkout with computer vision",
              isLinkStyle: true,
              linkUrl: "https://devpost.com/software/check-it-out",
            },
          ]),
        },
      ],
    },
    {
      id: "section_03",
      title: unit("section_03_title", "section_title", [
        { text: "SOFTWARE PROJECTS", isBold: true },
      ]),
      items: [
        {
          id: "section_03_item_01",
          itemType: "entry",
          heading: unit("section_03_item_01_heading", "entry_heading", [
            {
              text: "Chief of NYC Fire Dept Website",
              isBold: true,
              isLinkStyle: true,
              linkUrl: "https://chiefoffd.com/",
            },
            { segmentType: "separator_pipe" },
            { text: "Paid Contract --- Full Stack Developer" },
          ]),
          dates: unit("section_03_item_01_dates", "entry_dates", [
            { text: "Sep 2021 - Present" },
          ]),
          description: null,
          bulletLines: [
            unit("section_03_item_01_bullet_01", "bullet", [
              { text: "Improved SEO, increasing traffic from " },
              { text: "<100 to >3.6k visits per mo.", isBold: true },
              { text: " and book royalties from " },
              { text: "8K to ~24K YoY (2.99x)", isBold: true },
            ], 1),
            unit("section_03_item_01_bullet_02", "bullet", [
              { text: "Used custom " },
              { text: "Java-based PDF parser", isBold: true },
              {
                text: " to extract structured content from 200+ pages and generate ",
              },
              { text: "HTML and CSS", isBold: true },
              { text: " layouts" },
            ], 1),
            unit("section_03_item_01_bullet_03", "bullet", [
              { text: "Developed learning platform with " },
              { text: "React and JavaScript", isBold: true },
              {
                text: " with quiz functionality, content management, and progress tracking",
              },
            ], 1),
          ],
        },
        {
          id: "section_03_item_02",
          itemType: "entry",
          heading: unit("section_03_item_02_heading", "entry_heading", [
            {
              text: "C++ Ray Tracing Engine",
              isBold: true,
              isLinkStyle: true,
              linkUrl: "https://github.com/henry-md",
            },
          ]),
          dates: null,
          description: null,
          bulletLines: [
            unit("section_03_item_02_bullet_01", "bullet", [
              { text: "Architected ray tracing engine with " },
              { text: "C++", isBold: true },
              { text: ", " },
              { text: "OpenGL", isBold: true },
              { text: ", and " },
              { text: "multithreading", isBold: true },
              { text: " --- achieved 2.5x speedup over single-thread approach" },
            ], 1),
            unit("section_03_item_02_bullet_02", "bullet", [
              { text: "Engineered 3D rendering pipeline with " },
              { text: "GLSL", isBold: true },
              { text: " shaders and parallel " },
              { text: "computational geometry", isBold: true },
              { text: " intersection algorithms" },
            ], 1),
            unit("section_03_item_02_bullet_03", "bullet", [
              {
                text: "Developed Phong illumination with quaternion camera controls, bilinear ",
              },
              { text: "texture mapping", isBold: true },
              { text: ", and ray-traced shadow systems" },
            ], 1),
          ],
        },
        {
          id: "section_03_item_03",
          itemType: "entry",
          heading: unit("section_03_item_03_heading", "entry_heading", [
            {
              text: "N-Body Orbit Simulations",
              isBold: true,
              isLinkStyle: true,
              linkUrl: "https://github.com/henry-md",
            },
            { segmentType: "separator_pipe" },
            { text: "Research at Johns Hopkins" },
          ]),
          dates: null,
          description: unit("section_03_item_03_description", "entry_description", [
            {
              text: "Developed AI-powered orbit analysis system using autoencoder ",
            },
            { text: "neural network", isBold: true },
            { text: ", and latent space analysis with clustering algorithms" },
          ]),
          bulletLines: [
            unit("section_03_item_03_bullet_01", "bullet", [
              { text: "Built convolutional autoencoder with " },
              { text: "PyTorch and NumPy", isBold: true },
              { text: ". Achieved 200:1 compression with .02 MSE loss on orbit data" },
            ], 1),
            unit("section_03_item_03_bullet_02", "bullet", [
              {
                text: "Classified orbit paths by their latent space in the NN with ",
              },
              { text: "K-means, Hierarchical, Agglomerative", isBold: true },
              { text: " clustering methods in " },
              { text: "Python", isBold: true },
            ], 1),
            unit("section_03_item_03_bullet_03", "bullet", [
              { text: "Deployed scalable ML infrastructure on " },
              { text: "AWS EC2", isBold: true },
              { text: " cloud stores enabling parallel processing of 10k+ orbit simulations" },
            ], 1),
          ],
        },
      ],
    },
    {
      id: "section_04",
      title: unit("section_04_title", "section_title", [
        { text: "TECHNICAL SKILLS", isBold: true },
      ]),
      items: [
        {
          id: "section_04_item_01",
          itemType: "labeled_line",
          label: unit("section_04_item_01_label", "labeled_line_label", [
            { text: "Full-Stack Web Dev: ", isBold: true },
          ]),
          value: unit("section_04_item_01_value", "labeled_line_value", [
            {
              text: "Next.js, React, Node.js, Express.js, Prisma, Redis, tRPC, MongoDB (MERN stack), SQL, Tailwind, Vite",
            },
          ]),
        },
        {
          id: "section_04_item_02",
          itemType: "labeled_line",
          label: unit("section_04_item_02_label", "labeled_line_label", [
            { text: "Languages: ", isBold: true },
          ]),
          value: unit("section_04_item_02_value", "labeled_line_value", [
            { text: "TypeScript, JavaScript, Python, Java, C++, SQL, HTML, CSS" },
          ]),
        },
        {
          id: "section_04_item_03",
          itemType: "labeled_line",
          label: unit("section_04_item_03_label", "labeled_line_label", [
            { text: "Other Software: ", isBold: true },
          ]),
          value: unit("section_04_item_03_value", "labeled_line_value", [
            {
              text: "Firebase, Supabase, Git, Jira, Unix/Linux, Kubernetes, Docker, Plotly Dash, AWS (EC2, Amplify), PyTorch",
            },
          ]),
        },
      ],
    },
  ],
  subHeadLines: [
    unit("sub_head_line_01", "sub_head_line", [
      { text: "HenryMDeutsch@gmail.com" },
      { segmentType: "separator_bullet" },
      { text: "914-272-5561" },
      { segmentType: "separator_bullet" },
      {
        text: "linkedin.com/in/henry-deutsch",
        isLinkStyle: true,
        linkUrl: "https://linkedin.com/in/henry-deutsch",
      },
      { segmentType: "separator_bullet" },
      {
        text: "github.com/henry-md",
        isLinkStyle: true,
        linkUrl: "https://github.com/henry-md",
      },
    ]),
    unit("sub_head_line_02", "sub_head_line", [
      { text: "Portfolio: " },
      {
        text: "henry-deutsch.com",
        isBold: true,
        isLinkStyle: true,
        linkUrl: "https://henry-deutsch.com",
      },
    ]),
  ],
  version: 1,
} satisfies TailorResumeSourceDocument;
