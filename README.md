# Job Helper

Premium zinc-themed Next.js workspace with Google OAuth, Prisma, and first-pass
automatic job tracking from uploaded screenshots.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, and `OPENAI_API_KEY`.
3. Create and apply the Prisma migrations against Railway:

```bash
npx prisma migrate dev
```

4. In Google Cloud, add this redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

5. Start the app:

```bash
npm run dev
```

## Notes

- `/` is the public sign-in landing page.
- `/dashboard` is server-protected and redirects to `/` when there is no session.
- Authentication route handlers live under `app/api/auth/[...nextauth]/route.ts`.
- Prisma uses PostgreSQL and is configured in [`prisma/schema.prisma`](/Users/Henry/Developer/job-helper/prisma/schema.prisma).
- Google users, accounts, and sessions are persisted in Postgres through the Prisma adapter.
- Uploading a screenshot on `/dashboard` stores the image under `public/uploads/job-screenshots/`, sends it to the OpenAI Responses API with a strict JSON schema, and creates `Company`, `JobApplicationScreenshot`, and `JobApplication` records.
- The default extraction model is `gpt-5-mini`; override it with `OPENAI_JOB_EXTRACTION_MODEL`.
