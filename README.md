# Job Helper

Next.js workspace with Google OAuth, Prisma, and first-pass
automatic job tracking from uploaded screenshots.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, and `OPENAI_API_KEY`. For the Chrome extension, also set `GOOGLE_EXTENSION_CLIENT_ID` and `VITE_JOB_HELPER_APP_BASE_URL`.
3. Create and apply the Prisma migrations against Railway:

```bash
npx prisma migrate dev
```

4. In Google Cloud, add this redirect URI:

```text
http://localhost:3000/api/auth/callback/google
[And your Railway site]
```

For the Chrome extension, create a separate OAuth client with application type
`Chrome Extension`, using the unpacked or published extension id as the item id.
Put that client id in `GOOGLE_EXTENSION_CLIENT_ID`. If you need a stable unpacked
extension id across machines or paths, set `CHROME_EXTENSION_PUBLIC_KEY` before
building the extension.

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
- The Tailor Resume tab stores the uploaded resume under `public/uploads/resumes/<userId>/`, saves a private per-user profile under `.job-helper-data/tailor-resumes/<userId>/profile.json`, extracts LaTeX directly with the OpenAI Responses API, and keeps that LaTeX as the editable source of truth alongside a compiled PDF preview.
- The Chrome extension signs in through Chrome's identity API, exchanges the verified Google account for a normal database-backed Job Helper session, then sends a bearer session token to `PATCH /api/tailor-resume` with `action: "tailor"`.
- When the extension opens the dashboard or a tailored-resume review, it uses `/api/extension/auth/browser-session` to mint a short-lived handoff URL that sets the normal NextAuth cookie before redirecting into the protected app.
- The default extraction model is `gpt-5-mini`; override it with `OPENAI_JOB_EXTRACTION_MODEL`.
