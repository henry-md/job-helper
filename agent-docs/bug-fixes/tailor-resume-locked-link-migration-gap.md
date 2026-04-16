Tailor Resume locked-link migration gap:

- Bug: Tailor Resume code and `prisma/schema.prisma` expected `TailorResumeLockedLink`, but the database schema had not been migrated to create the table.
- Result: `POST /api/tailor-resume` failed during resume upload with Prisma `P2021` before extraction started.
- Fix:
  - keep `TailorResumeLockedLink` as a required Prisma-backed dependency
  - add and apply the missing Prisma migration that creates `TailorResumeLockedLink`
  - reconcile `schema.prisma` with the existing `Person` column migration so Prisma can generate/apply the new migration cleanly
