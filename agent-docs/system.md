Job Helper is a small Next.js App Router app for tracking job applications from screenshots.

Current product slice:
- Public `/` page handles Google sign-in.
- Protected `/dashboard` page shows counts/recent applications and the intake form.
- `/dashboard` also includes a Tailor Resume tab where each signed-in user can save one resume file plus a draft job description for later tailoring work.
- Important dashboard verification state is URL-addressable with `?tab=...`; currently `/dashboard?tab=tailor` opens the Tailor Resume view directly for screenshot verification, and `/dashboard?tab=tailor&tailoredResumeId=<id>` opens the saved tailored-resume review modal.
- Uploading a resume now triggers an OpenAI extraction pass that returns LaTeX directly, then the dashboard lets the user edit that LaTeX side-by-side with the rendered PDF preview.
- Users upload one or more screenshots, the app extracts draft fields with OpenAI, then saves screenshots + one `JobApplication`.
- Automation capture clients can also ingest evidence through `POST /api/job-applications/ingest`, which accepts screenshots, structured page context, raw text, or a mix.
- The Chrome extension hotkey is a separate Tailor Resume flow: it scrapes the active job page and calls `PATCH /api/tailor-resume` with `action: "tailor"`.

Core dependencies:
- Next.js 16 App Router, React 19, TypeScript.
- NextAuth v4 with Google provider and Prisma adapter.
- Prisma 7 with PostgreSQL.
- OpenAI Responses API for screenshot extraction.

Important runtime assumptions:
- `DATABASE_URL` must exist or any Prisma-backed server code throws early.
- `OPENAI_API_KEY` gates extraction/upload readiness on the dashboard.
- Default extraction model is `gpt-5-mini`, overridable with `OPENAI_JOB_EXTRACTION_MODEL`.

Dashboard UI note:
- The `/dashboard` shell is viewport-height constrained, so the intake form must tolerate extra extraction banners and multi-line OCR output without relying on equal-height rows. Keep the form/description area scrollable instead of clipping content after uploads.

When changing behavior, gather more context from:
- `app/dashboard/page.tsx` for the main server-rendered dashboard.
- `components/job-application-intake.tsx` for the client upload/save flow.
- `app/api/job-applications/*.ts` for persistence and extraction endpoints.
- `prisma/schema.prisma` for the real data model.
