High-level structure:
- `app/`: App Router pages and route handlers.
- `components/`: client UI pieces; the intake component owns most interaction state.
- `lib/`: shared server/domain helpers for Prisma, extraction, and upload utilities.
- `prisma/`: schema and migrations.
- `generated/prisma/`: generated client output; treat as generated code.

Current request flow:
1. NextAuth session is resolved server-side with `getServerSession(authOptions)`.
2. `/dashboard` loads counts and recent applications directly with Prisma.
3. Client uploads screenshots to `POST /api/job-applications/extract` for draft extraction.
4. Final form submit goes to `POST /api/job-applications`, which persists screenshots, upserts `Company`, then creates one `JobApplication`.

Important boundaries:
- Auth config lives in `auth.ts`; route handler is `app/api/auth/[...nextauth]/route.ts`.
- Prisma client is created in `lib/prisma.ts` using `@prisma/adapter-pg` and a global singleton.
- Extraction logic is centralized in `lib/job-application-extraction.ts`; it uses a strict JSON schema and validates the returned payload manually.
- Screenshot file persistence is local filesystem storage under `public/uploads/job-screenshots/<userId>/`, not object storage.

Current persistence nuance:
- A saved application can own multiple `JobApplicationScreenshot` records through `JobApplicationScreenshot.applicationId`.
- Screenshot records may store extraction payload/model/error snapshots from the client-side draft state.
