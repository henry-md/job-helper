
Databases:
You are ONLY allowed to make db migrations with `npx prisma migrate dev --name <migration_name>`, and regenerate the client with `npx prisma generate`, and absolutely nothing else. If that doesn't work, you are not even allowed to run it again! You must give me your suggestion for what to run. NEVER, EVER, under ANY CIRCUMSTANCES can you run things like `db push`, `migrate deploy`, `db pull`, or anything else. This is punishable by death.

Prisma:
- The schema lives in `prisma/schema.prisma`.
- The Prisma client output is configured to `generated/prisma`; import app code from `@/generated/prisma/...`, not `@prisma/client`.
- Treat `generated/prisma/` as generated code. Change the schema, then regenerate.

App patterns:
- Prefer server components/pages for session checks and initial Prisma reads.
- Keep interactive upload/form logic in client components; the current intake flow already does this.
- Reuse `lib/job-application-types.ts` for extraction/draft shapes instead of redefining them.

Uploads and extraction:
- Keep screenshot validation rules aligned between client and server: PNG/JPG/WebP only, max 8 MB.
- Extraction uses the OpenAI Responses API with strict structured output. If you change extracted fields, update the JSON schema, parser, shared types, and save route together.

Storage:
- Screenshots are written to `public/uploads/job-screenshots/<userId>/`. If a task touches storage strategy, gather more context first because this is a local-filesystem assumption.
