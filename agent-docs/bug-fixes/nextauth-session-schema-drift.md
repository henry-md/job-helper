Problem:
- Visiting a page that calls `getServerSession(authOptions)` started failing with NextAuth `adapter_error_getSessionAndUser` / Prisma `P2022`, even though the auth code itself had not changed.

Cause:
- `auth.ts` uses the Prisma adapter with database sessions, so session lookup reads both `Session` and the related `User`.
- New resume-tailoring fields were added to `model User` in `prisma/schema.prisma`, but the database had not been migrated yet.
- Prisma then generated queries that expected those `User` columns to exist, and NextAuth surfaced the failure during session resolution.

Fix:
- Create and apply a Prisma migration immediately after adding new auth-adjacent `User` fields.
- Regenerate the Prisma client as part of that same migration flow.
- If session lookup suddenly starts failing with `P2022`, compare the live `User` table against `prisma/schema.prisma` before changing auth logic.

Rule:
- Treat `User` schema changes as auth changes too, because NextAuth database sessions load the related user record on every request.
