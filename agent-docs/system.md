Job Helper is a small Next.js App Router app for tracking job applications from screenshots.

Current product slice:
- Public `/` page handles Google sign-in.
- Protected `/dashboard` page shows counts/recent applications and the intake form.
- Users upload one or more screenshots, the app extracts draft fields with OpenAI, then saves screenshots + one `JobApplication`.

Core dependencies:
- Next.js 16 App Router, React 19, TypeScript.
- NextAuth v4 with Google provider and Prisma adapter.
- Prisma 7 with PostgreSQL.
- OpenAI Responses API for screenshot extraction.

Important runtime assumptions:
- `DATABASE_URL` must exist or any Prisma-backed server code throws early.
- `OPENAI_API_KEY` gates extraction/upload readiness on the dashboard.
- Default extraction model is `gpt-5-mini`, overridable with `OPENAI_JOB_EXTRACTION_MODEL`.

When changing behavior, gather more context from:
- `app/dashboard/page.tsx` for the main server-rendered dashboard.
- `components/job-application-intake.tsx` for the client upload/save flow.
- `app/api/job-applications/*.ts` for persistence and extraction endpoints.
- `prisma/schema.prisma` for the real data model.
