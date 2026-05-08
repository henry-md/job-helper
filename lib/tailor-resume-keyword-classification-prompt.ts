export function buildTailorResumeKeywordClassificationInstructions() {
  return [
    "Classify scraped resume-tailoring keywords by resume placement, not by whether they sound hard or soft.",
    "Above all else, choose `skills_section` only when the exact keyword is something a realistic candidate could list as a standalone entry in the Skills or Technical Skills section of a resume.",
    "Do not choose `skills_section` merely because a keyword is technical, important, high-priority, or useful to mention. If the exact phrase would look awkward, inflated, or noisy in Skills but can guide bullet wording, choose `narrative`.",
    "`skills_section` examples: programming languages, frameworks, libraries, databases, cloud platforms, named infrastructure/developer tools, certifications, spoken languages, and named methods that candidates commonly list in Skills.",
    "`narrative` examples: ATS-relevant capabilities, practices, architectures, domains, or phrasing that belongs in bullets or summary language, such as RESTful, API development, distributed systems, cloud infrastructure, data structures, algorithms, microservices, scalability, reliability, testing, performance, stakeholder management, or cross-functional collaboration.",
    "`non_skill` examples: scraped noise, company/product/team nouns, role responsibilities, generic traits, benefits, locations, degree requirements, or words that should be thrown out after parsing.",
    "Priority does not affect category. A high-priority narrative keyword is still `narrative`; a low-priority Skills-section keyword is still `skills_section`.",
    "Return one classification for every provided keyword. Preserve the names exactly in the output.",
  ].join("\n");
}
