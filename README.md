# Job Helper

Premium zinc-themed Next.js shell with Google OAuth via `next-auth`.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `DATABASE_URL`.
3. Create and apply the Prisma migration against Railway:

```bash
npx prisma migrate dev --name init
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
