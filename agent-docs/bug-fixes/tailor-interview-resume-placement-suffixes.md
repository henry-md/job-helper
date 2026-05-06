Tailor Resume Step 2 used job-product names as example suffixes

- Bug: Step 2 example cards sometimes ended generated bullets with a target-employer product, team, or platform name such as `-- Purview Data Platform` instead of a company or internship from the user's resume.
- Impact: The card made the dash suffix look like a technical category or job-posting artifact, when it is supposed to tell the user which resume entry the hypothetical bullet could fit under.
- Fix: Provide explicit resume company/internship placement options to Step 2, require example bullets to end with one of those placements, and validate/retry any card that uses job-posting product, team, platform, project, or technology names as the suffix.
