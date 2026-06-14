export function buildTailorResumeKeywordClassificationInstructions() {
  return [
    "Classify scraped resume-tailoring keywords in two indepenedent dimensions: (1) skills_section / narrative (2) high priority / low priority. Beside this 2x2 grid, we also allow a different bucket characterization that's essentially the trash can. If we scraped a keywrd but change our mind because the ATS probably won't care at all if we include it, we can throw it in the `non_skill` bin.",
    "First dimension: Choose `skills_section` only when the exact keyword is something a software engineering candidate would list in the skills section of their resume. If it would sound vague in the skills section of a resume, or you're not sure, choose `narrative`.",
    "`skills_section` examples: `Next.js`, `React`, `Node.js`, `Express.js`, `Prisma`, `Redis`, `tRPC`, `MongoDB (MERN stack)`, `SQL`, `Tailwind`, `Vite`, `TypeScript`, `JavaScript`, `Python`, `Java`, `C++`, `SQL`, `HTML`, `CSS`, `Firebase`, `Supabase`, `Git`, `GitLab`, `Jenkins`, `Jira`, `Confluence`, `Unix/Linux`, `Kubernetes`, `Docker`, `Plotly Dash`, `AWS (EC2, Amplify)`, `PyTorch`",
    "`narrative` examples: `Observability`, `Load balancing`, `Distributed systems`, `LLM`, `AI`, `Monitoring`, `Configuration management`",
    "Second dimension: `high priority` keywords are things the job description *definitely* wants, and not having it makes them a worse candidate. Low priority keywords are possibly desired, but may not hurt their candidacy depending on the other skills they list. It's things we definitely want to try to pepper into the resume and should really think hard to make sure we try to get all of them. This is highly contextual on job description so I will not give examples.",
    "`non_skill` is a trash can for bad extracted keywords. Examples: `Observe`, `Fast` — things the ATS is definitely not looking for.",
    "keep in mind that the two dimensions are truly independent. We can have non-skill keywords that are high or low priority. However, if we extract a skill that could go in the skills section of a resume, chances are it will be high priority to include in our tailored resume.",
    "Return one classification for every provided keyword. Preserve the names exactly in the output.",
  ].join("\n");
}
