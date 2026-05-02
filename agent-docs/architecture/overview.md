High-level structure:
- `app/`: App Router pages and route handlers.
- `components/`: client UI pieces; the intake component owns most interaction state.
- `lib/`: shared server/domain helpers for Prisma, extraction, and upload utilities.
- `prisma/`: schema and migrations.
- `generated/prisma/`: generated client output; treat as generated code.

Current request flow:
1. NextAuth session is resolved server-side with `getServerSession(authOptions)`.
2. `/dashboard` loads saved applications from Prisma and reads the saved tailor-resume profile from the local filesystem, including the source-resume assets, `USER.md`, and per-user prompt-settings payload used by the OpenAI-backed flows.
3. Config uses `POST /api/tailor-resume` to persist the uploaded source resume file, run resume extraction through OpenAI, store the extracted LaTeX as the saved draft, and compile the preview PDF in the per-user tailor-resume profile.
4. Saved uses `/api/tailor-resume` and `/api/job-applications` archive/delete endpoints to organize stored tailored resumes and job applications.
5. Application capture and tailoring are extension-owned flows; the web app keeps legacy dashboard tab aliases for extension-opened review links but does not expose manual tailoring intake.

Important boundaries:
- Auth config lives in `auth.ts`; route handler is `app/api/auth/[...nextauth]/route.ts`.
- Chrome extension session bridging is documented in `agent-docs/architecture/extension-auth.md`.
- Cross-surface extension/dashboard freshness is documented in `agent-docs/architecture/cross-surface-sync.md`.
- Prisma client is created in `lib/prisma.ts` using `@prisma/adapter-pg` and a global singleton.
- Extraction logic is centralized in `lib/job-application-extraction.ts`; it uses a strict JSON schema and validates the returned payload manually.
- Screenshot file persistence is local filesystem storage under `public/uploads/job-screenshots/<userId>/`, not object storage.
- Tailor Resume object naming and flow are documented in `agent-docs/architecture/tailor-resume-objects.md`.
- Tailor Resume pipeline staging is documented in `agent-docs/architecture/tailor-resume-pipeline.md`.

Current persistence nuance:
- A saved application can own multiple `JobApplicationScreenshot` records through `JobApplicationScreenshot.applicationId`.
- Screenshot records may store extraction payload/model/error snapshots from the client-side draft state.
- Cross-surface freshness uses a Prisma-backed per-user sync cursor (`UserSyncState`) with separate application and tailoring versions so clients can poll a tiny endpoint and only refetch the heavier application/profile data when something actually changed.
- `JobApplication.archivedAt` separates active and archived saved applications. `/api/job-applications` defaults to active records for extension compatibility and accepts `includeArchived=1` for the dashboard Saved tab.
- Tailor Resume stores the public resume asset under `public/uploads/resumes/<userId>/` and the private editable profile JSON under `.job-helper-data/tailor-resumes/<userId>/profile.json`.
- Saved tailored resumes live in both the profile JSON and the Prisma mirror, including `archivedAt`, so archive/unarchive UI should mutate both stores together and let both the extension and dashboard derive `working set` vs `stored` sections from one synced record list.
- The same profile JSON also stores prompt template overrides for job extraction, resume-to-LaTeX generation, tailoring, and tailored-resume refinement, so the dashboard settings tab and the API routes read from one source of truth.
- Tailor Resume locked links are the exception: they are persisted in Prisma (`TailorResumeLockedLink`) so lock state remains independent from raw LaTeX reparsing.
- Tailor Resume user memory is also persisted in Prisma (`TailorResumeUserMemory`) as a DB-backed Markdown document exposed as `USER.md` in settings. The Step 2 interview receives it to avoid repetitive questions and can update it with transactionally validated markdown patch operations before Step 3 planning runs.
- Verification-only seed nuance: the product still accepts PDF/image resume uploads, but the repo-local `/check` workflow for fresh isolated Tailor Resume accounts should prefer the canonical source LaTeX fixture and compile the matching backing PDF from that exact source instead of relying on PDF-to-LaTeX extraction. This keeps verification runs deterministic while still satisfying UI flows that expect a saved `resume` record.

Verification safety:
- This repo can now contain real user Tailor Resume data, not just disposable test fixtures.
- `/check`, `/checks`, and repo-local verification helpers must preserve existing saved applications, tailored resumes, interview state, and profile data by default.
- Cleanup during verification should be limited to artifacts created by the current automated run. If reproducing or resetting a scenario appears to require deleting older tailoring jobs or other existing user data, stop and ask the user what to do before making destructive changes.
