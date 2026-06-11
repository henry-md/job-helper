Job Helper is a small Next.js App Router app for tracking job applications from screenshots.

Current product slice:
- Default product surface is the Chrome extension. If a request is ambiguous and could apply to either the web app or the extension, assume the extension is the primary target and verify it there first. The web app is usually supporting/admin surface unless the user explicitly names it.
- Public `/` page handles Google sign-in.
- Protected `/dashboard` is the Config surface.
- `/dashboard` lets each signed-in user upload/edit the source resume, review the rendered LaTeX PDF preview, and edit `USER.md` plus related resume memory cards.
- Creating the editable LaTeX source resume is the first dashboard step; saved tailored-resume review, usage, and app-facing settings live in the Chrome extension rather than web dashboard tabs.
- Uploading a resume triggers an OpenAI extraction pass that returns LaTeX directly, then Config lets the user edit that LaTeX side-by-side with the rendered PDF preview.
- The Chrome extension runs its React UI in Chrome's native Side Panel. Its Tailor Resume flow signs in with Chrome's Google identity API, exchanges that for a database-backed Job Helper session, scrapes the active job page from the side panel button or hotkey, then calls `PATCH /api/tailor-resume` with `action: "tailor"`.
- The extension side panel also exposes the master chat: the lower-right `Resume Chat` opened from the chat-bubble icon on all extension pages. It posts to `POST /api/tailor-resume/support-chat`, can use optional current-page context, and can create first-class skills-section skills, save reusable resume-bullet support, list resume experiences, and read the current source LaTeX. When a user or agent says "master chat," they mean this lower-right Resume Chat. Its primary model env var is `OPENAI_MASTER_CHAT_MODEL`.
- The older URL-scoped job-page chat route is `POST /api/tailor-resume/chat`; it also falls back to `OPENAI_MASTER_CHAT_MODEL` for model selection, but it is not the UI meant by "master chat."

Core dependencies:
- Next.js 16 App Router, React 19, TypeScript.
- NextAuth v4 with Google provider and Prisma adapter.
- Prisma 7 with PostgreSQL.
- OpenAI Responses API for screenshot extraction.

Important runtime assumptions:
- `DATABASE_URL` must exist or any Prisma-backed server code throws early.
- `GOOGLE_EXTENSION_CLIENT_ID` must exist before Chrome extension sign-in can verify Google tokens server-side.
- `OPENAI_API_KEY` gates extraction/upload readiness on the dashboard.
- Default extraction model is `gpt-5-mini`, overridable with `OPENAI_JOB_EXTRACTION_MODEL`.

Dashboard UI note:
- The `/dashboard` shell is viewport-height constrained, so the intake form must tolerate extra extraction banners and multi-line OCR output without relying on equal-height rows. Keep the form/description area scrollable instead of clipping content after uploads.

When changing behavior, gather more context from:
- `app/dashboard/page.tsx` for the main server-rendered dashboard.
- `components/dashboard-workspace.tsx` for the Config layout and source-resume interactions.
- `app/api/job-applications/*.ts` for persistence/extraction endpoints that still back Tailor Resume job identity and run linkage.
- `prisma/schema.prisma` for the real data model.
