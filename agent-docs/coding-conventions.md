
Required final checks:
- After any implementation change, run a lint check.
- After any feature update, bug fix, or other implementation task, run `npm run build` before considering the work done.
- If a required check is blocked by an unrelated pre-existing failure, surface that clearly.

Local dev server hygiene:
- If you start or take over a local dev server or other long-running verification process, stop it before ending your response unless the user explicitly asked you to leave it running, and mention the released port or command when relevant.

Databases:
You are ONLY allowed to make db migrations with `npx prisma migrate dev --name <migration_name>`, and regenerate the client with `npx prisma generate`, and absolutely nothing else. If that doesn't work, you are not even allowed to run it again (unless given extra-top-secret permission)! You must give me your suggestion for what to run. NEVER, EVER, under ANY CIRCUMSTANCES can you run things like `db push`, `migrate deploy`, `db pull`, or anything else without explicitly asking the user pretty-please. This is punishable by death. 

Commits:
Never commit anything. Let the user do git add, etc, unless explicitly asked.

Git and workspace safety:
- Default to working on the currently checked out `main` branch in this repo.
- Do not create or switch branches unless the user gives explicit permission for that branch action.
- Do not create linked worktrees or alternate checkouts unless the user gives explicit permission for that worktree action.
- If a task involves staging, committing, or pushing after an earlier conversation about splitting work, do not infer permission to branch or create worktrees from that alone. Stay on `main` unless the user explicitly says otherwise.
- If the user's wording about branches is ambiguous, stop and ask a direct follow-up instead of guessing. Use exact branch names in the question and in the answer.

Prisma:
- The schema lives in `prisma/schema.prisma`.
- The Prisma client output is configured to `generated/prisma`; import app code from `@/generated/prisma/...`, not `@prisma/client`.
- Treat `generated/prisma/` as generated code. Change the schema, then regenerate.

App patterns:
- Prefer server components/pages for session checks and initial Prisma reads.
- Keep interactive upload/form logic in client components; the current intake flow already does this.
- Reuse `lib/job-application-types.ts` for extraction/draft shapes instead of redefining them.
- Do not put developer setup/configuration instructions in the product UI. Keep user-facing copy product-focused; if setup context matters, tell the developer separately or add a short note to `notes.md`.

Agent-docs authoring:
- When editing `agent-docs`, prefer generic language and reusable principles so the docs transfer cleanly to future repos. Why: these docs are most valuable when they teach durable patterns instead of locking the guidance to one codebase's temporary route names, feature labels, or implementation details.
- Use repo-specific examples only when they clarify the rule, and keep them clearly framed as examples rather than the rule itself. Why: future agents should be able to reuse the guidance even when the next repo has different pages, frameworks, or auth providers.

Making Check Command Work:
- `/check` does not require Next.js specifically, and it does not require Google OAuth specifically. What it actually needs is: one stable page URL, one reproducible way to open the important UI state, and one reusable signed-in browser session for the expected user. Why: browser verification cares about what a real browser can reliably open and reproduce, not which framework rendered the page.
- Treat `/check` as a first-class development workflow. Protected pages and important UI states should be reachable in a deterministic way so a browser agent can verify them with screenshots instead of guessing from code. Why: code can look correct while the rendered UI is still wrong, empty, clipped, or loading the wrong user state.
- Prefer URL-addressable state for major protected surfaces that are likely to need verification. Query-param tabs, nested routes, or other stable route patterns are all fine. Why: direct entry by URL is less flaky than post-load clicking and gives the agent a canonical way to revisit the exact state it just changed.
- Deep-linkable does not mean every in-app click must update the URL. It means there is at least one stable URL that recreates the important state when opened directly. Why: `/check` needs a reliable entrypoint, not necessarily full bidirectional router syncing between every client interaction and the browser location bar.
- For tabbed or multi-mode pages, keep the canonical `/check` entrypoint self-documenting in code instead of maintaining a second list in docs. Use one stable id per mode, parse that id wherever initial route state is resolved, and reuse the same id in the client state. Why: the fewer duplicated route maps we maintain, the less likely the docs and the actual deep links are to drift apart.
- When adding a new tab, mode, or workspace selector that a human is likely to ask `/check` to inspect, give it one stable id and make the canonical deep link inferable from code. Why: stable ids turn verification routes into a convention instead of a one-off implementation detail.
- Good candidates for URL-addressable state include tabs, selected workspaces, review modes, important modal or drawer entry points, and stepper states that represent a real user-visible milestone. Why: these are the views most likely to matter to a human reviewer and most likely to be hard to recover from scratch if they only exist in ephemeral client state.
- If a feature can only be reached by a fragile click path, `/check` can still try to drive it, but that is less reliable than landing directly on the target state from the URL. Why: browser automation is much more brittle when it depends on timing-sensitive clicks, animation state, or hidden prerequisite UI.
- Never refactor existing product code just to make a tab/view deep-linkable without the user's explicit sign-off. Why: this kind of change affects product behavior and URL semantics, not just developer tooling.
- Prefer server-side session resolution for protected pages so the signed-in state is deterministic at request time and easier for `/check` to verify. Why: when the server decides the initial user context, the first render is more predictable and less dependent on client hydration races.
- The key auth requirement is a stable cookie-backed session plus a local way to mint, refresh, or impersonate the expected user without driving a third-party OAuth flow in the browser. Why: once a reusable browser session exists, screenshot capture can run headlessly and repeatedly without interrupting the developer.
- Good auth patterns for `/check` are database-backed sessions that can be seeded locally, a dev-only impersonation route or command, or a repo-specific session refresh command that the global skill can call. Why: these give the agent a deterministic local way to become the right user.
- Avoid architectures where Google/Auth0/etc. browser login is the only way to obtain a usable local session for development verification. Why: that path is slower, harder to automate, more fragile, and often blocked by secure-browser restrictions.
- If the auth library already exposes a session-inspection endpoint, keep it working in development. Why: it is much safer to verify the identity behind a screenshot than to assume a cookie file still belongs to the right user. When a framework provides a route like `/api/auth/session`, `/check` can use it to confirm that the saved browser state still resolves to the expected account.
- Protected routes that matter for verification should have one obvious canonical URL and one obvious expected signed-in user context. Avoid flows where the same view depends on hidden client-only state with no stable way to reconstruct it. Why: the agent needs to know what page to revisit and what success should look like.
- Keep reusable `/check` automation, scripts, per-repo config, auth state, notes, and screenshots under the global `$check` skill directory. Do not build repo-local helper scripts or runtime folders unless the global skill genuinely cannot support the project shape. Why: the workflow should get more portable over time, not leave one-off local scaffolding behind in each repo.
- Repo docs should describe the product and architecture choices that make `/check` effective, not duplicate tool runtime setup. If a project-specific convention matters, document the convention here and let the global skill own the mechanics. Why: future repos should inherit the principles, while the global skill stays the reusable implementation.

Uploads and extraction:
- Keep screenshot validation rules aligned between client and server: PNG/JPG/WebP only, max 8 MB.
- Extraction uses the OpenAI Responses API with strict structured output. If you change extracted fields, update the JSON schema, parser, shared types, and save route together.

Storage:
- Screenshots are written to `public/uploads/job-screenshots/<userId>/`. If a task touches storage strategy, gather more context first because this is a local-filesystem assumption.

Comments:
- Write them! Add single-line comments above large functions, or complex pieces of functionality. Do NOT over-engineer comments with 5 lines of inputs and outputs. Just a singe line explaining what it does: // Does X Y Z. Try to make the codebase approachable to new developers. 
