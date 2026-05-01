Job Helper is a small Next.js App Router app for tracking job applications from screenshots.

Current product slice:
- Public `/` page handles Google sign-in.
- Protected `/dashboard` has Config, Saved, and Settings tabs.
- `/dashboard?tab=config` lets each signed-in user upload/edit the source resume, review the rendered LaTeX PDF preview, and edit `USER.md` from a collapsed memory card.
- `/dashboard?tab=saved` shows two panels: saved resumes and saved applications. Each panel has an extension-style Unarchived/Archived switch so only one list is visible at a time. The web app is a saved-data/configuration surface; resume tailoring and application capture happen through the Chrome extension.
- `/dashboard?tab=settings` exposes per-user AI prompt settings plus Tailor Resume generation guardrails so users can inspect and edit the live templates, Step 2 follow-up-question behavior, and page-count behavior that drive extraction and resume-generation flows.
- Important dashboard verification state is URL-addressable with `?tab=...`; legacy `/dashboard?tab=tailor` and `/dashboard?tab=new` links resolve to Saved so extension dashboard links keep working, and `tailoredResumeId=<id>` opens the saved tailored-resume review modal there.
- Uploading a resume triggers an OpenAI extraction pass that returns LaTeX directly, then Config lets the user edit that LaTeX side-by-side with the rendered PDF preview.
- The Chrome extension runs its React UI in Chrome's native Side Panel. Its Tailor Resume flow signs in with Chrome's Google identity API, exchanges that for a database-backed Job Helper session, scrapes the active job page from the side panel button or hotkey, then calls `PATCH /api/tailor-resume` with `action: "tailor"`.
- The extension side panel also exposes a URL-scoped streamed chat. The extension captures the current page context and renders chunks, while the app API owns chat history persistence, resume/USER.md context loading, prompt construction, and the OpenAI call.

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
- `components/dashboard-workspace.tsx` for tab layout and Saved/Config interactions.
- `app/api/job-applications/*.ts` for persistence, extraction endpoints, and application archive state.
- `prisma/schema.prisma` for the real data model.
