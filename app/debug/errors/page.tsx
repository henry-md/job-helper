import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import {
  classifyTailorResumeDebugErrorSource,
  formatTailorResumeDebugErrorSource,
  formatTailorResumeDebugPayloadLabel,
  normalizeTailorResumeDebugErrorSignature,
  parseTailorResumeInvalidReplacementPayload,
} from "@/lib/tailor-resume-debug-errors";

function formatDebugTimestamp(date: Date) {
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function MetadataChip(input: { label: string; value: number | string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] tracking-[0.16em] text-zinc-300 uppercase">
      <span className="text-zinc-500">{input.label}</span>{" "}
      <span className="text-zinc-100 normal-case tracking-normal">
        {input.value}
      </span>
    </span>
  );
}

function FieldCard(input: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
        {input.label}
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-200">
        {input.value || "Not captured in the logged response."}
      </p>
    </div>
  );
}

function CodeBlock(input: {
  maxHeightClass?: string;
  tone?: "default" | "error";
  value: string;
}) {
  const toneClass =
    input.tone === "error"
      ? "border-rose-400/20 bg-rose-950/40 text-rose-50"
      : "border-white/10 bg-black/40 text-zinc-100";

  return (
    <pre
      className={`app-scrollbar overflow-auto whitespace-pre-wrap break-words rounded-2xl border p-4 text-[11px] leading-6 ${input.maxHeightClass ?? "max-h-[24rem]"} ${toneClass}`}
    >
      {input.value || "[empty]"}
    </pre>
  );
}

function ExpandableCodeSection(input: {
  charCount: number;
  title: string;
  tone?: "default" | "error";
  value: string;
}) {
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">
        <span>{input.title}</span>
        <span className="ml-2 text-xs font-normal text-zinc-500">
          {input.charCount.toLocaleString()} chars
        </span>
      </summary>
      <div className="mt-3">
        <CodeBlock tone={input.tone} value={input.value} />
      </div>
    </details>
  );
}

export default async function DebugErrorsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const prisma = getPrismaClient();
  const failures = await prisma.latexBuildFailure.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const invalidReplacementFailures = failures.filter(
    (failure) =>
      classifyTailorResumeDebugErrorSource(failure.source) ===
      "invalid_replacement",
  );
  const badLatexGenerationFailures = failures.filter(
    (failure) =>
      classifyTailorResumeDebugErrorSource(failure.source) ===
      "bad_latex_generation",
  );
  const failureGroups = [
    {
      description:
        "Rejected tailoring responses whose block replacements were structurally invalid before LaTeX compilation even started.",
      failures: invalidReplacementFailures,
      title: "Invalid Replacements",
    },
    {
      description:
        "Generated LaTeX documents that were structurally valid enough to attempt compilation, but still failed to build.",
      failures: badLatexGenerationFailures,
      title: "Bad LaTeX Generations",
    },
  ].filter((group) => group.failures.length > 0);
  const recurringFailureSignatures = [...(() => {
    const signatureMap = new Map<
      string,
      {
        count: number;
        signature: string;
        source: string;
      }
    >();

    for (const failure of failures) {
      const signature = normalizeTailorResumeDebugErrorSignature(failure.error);
      const key = `${failure.source}::${signature}`;
      const existingEntry = signatureMap.get(key);

      if (existingEntry) {
        existingEntry.count += 1;
        continue;
      }

      signatureMap.set(key, {
        count: 1,
        signature,
        source: failure.source,
      });
    }

    return signatureMap.values();
  })()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  return (
    <main className="min-h-screen px-[clamp(1rem,2vw,2rem)] py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="glass-panel rounded-[28px] border border-white/10 px-6 py-6">
          <p className="text-[11px] font-medium tracking-[0.28em] text-zinc-500 uppercase">
            Tailor Resume Debug
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
            Resume Generation Debug Errors
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
            {failures.length === 0
              ? "No failures recorded."
              : `Showing the ${failures.length} most recent failures. Invalid replacement payloads are expanded into the original source block, the proposed replacement, and the structured response metadata so the failure is readable without digging through one large blob.`}
          </p>
        </section>

        {recurringFailureSignatures.length > 0 ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-zinc-100">
                  Recurring Failure Signatures
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  Repeated retries often come from one deterministic guardrail. This
                  summary clusters the recent failures so the common cause is visible
                  before you inspect each attempt.
                </p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {recurringFailureSignatures.map((signature) => (
                <article
                  key={`${signature.source}:${signature.signature}`}
                  className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap gap-2">
                    <MetadataChip label="count" value={signature.count} />
                    <MetadataChip
                      label="source"
                      value={formatTailorResumeDebugErrorSource(signature.source)}
                    />
                  </div>
                  <div className="mt-3">
                    <CodeBlock
                      maxHeightClass="max-h-[10rem]"
                      tone="error"
                      value={signature.signature}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {failureGroups.length === 0 ? (
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-6 text-sm text-zinc-300">
            No failures recorded yet.
          </section>
        ) : null}

        {failureGroups.map((group) => (
          <section key={group.title} className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-zinc-100">
                  {group.title}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  {group.description}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300">
                {group.failures.length} failure
                {group.failures.length === 1 ? "" : "s"}
              </span>
            </div>

            {group.failures.map((failure) => {
              const invalidReplacementPayload =
                classifyTailorResumeDebugErrorSource(failure.source) ===
                "invalid_replacement"
                  ? parseTailorResumeInvalidReplacementPayload(failure.latexCode)
                  : null;

              return (
                <article
                  key={failure.id}
                  className="glass-panel overflow-hidden rounded-[28px] border border-white/10"
                >
                  <div className="border-b border-white/10 bg-white/[0.04] px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <MetadataChip
                        label="time"
                        value={formatDebugTimestamp(failure.createdAt)}
                      />
                      <MetadataChip
                        label="source"
                        value={formatTailorResumeDebugErrorSource(failure.source)}
                      />
                      <MetadataChip label="attempt" value={failure.attempt} />
                      <MetadataChip label="user" value={failure.userId} />
                    </div>
                  </div>

                  <div className="space-y-4 px-5 py-5">
                    <div>
                      <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
                        Error
                      </p>
                      <div className="mt-2">
                        <CodeBlock
                          maxHeightClass="max-h-[12rem]"
                          tone="error"
                          value={failure.error}
                        />
                      </div>
                    </div>

                    {invalidReplacementPayload ? (
                      <>
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                          <div className="grid gap-4">
                            <FieldCard
                              label="Job Description Focus"
                              value={
                                invalidReplacementPayload.structuredResponse?.thesis
                                  ?.jobDescriptionFocus ?? null
                              }
                            />
                            <FieldCard
                              label="Resume Changes"
                              value={
                                invalidReplacementPayload.structuredResponse?.thesis
                                  ?.resumeChanges ?? null
                              }
                            />
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
                              Structured Response Metadata
                            </p>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <FieldCard
                                label="Company"
                                value={
                                  invalidReplacementPayload.structuredResponse
                                    ?.companyName ?? null
                                }
                              />
                              <FieldCard
                                label="Role"
                                value={
                                  invalidReplacementPayload.structuredResponse
                                    ?.positionTitle ?? null
                                }
                              />
                              <FieldCard
                                label="Display Name"
                                value={
                                  invalidReplacementPayload.structuredResponse
                                    ?.displayName ?? null
                                }
                              />
                              <FieldCard
                                label="Job Identifier"
                                value={
                                  invalidReplacementPayload.structuredResponse
                                    ?.jobIdentifier ?? null
                                }
                              />
                            </div>
                          </div>
                        </div>

                        <section className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-zinc-100">
                              Rejected Changes
                            </h3>
                            <span className="text-xs text-zinc-500">
                              {invalidReplacementPayload.changes.length} change
                              {invalidReplacementPayload.changes.length === 1
                                ? ""
                                : "s"}
                            </span>
                          </div>

                          {invalidReplacementPayload.changes.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-zinc-400">
                              The structured response could not be reconstructed
                              from the logged payload, so only the raw payload is
                              available below.
                            </div>
                          ) : (
                            invalidReplacementPayload.changes.map(
                              (change, index) => (
                                <article
                                  key={`${failure.id}:${change.segmentId}:${index}`}
                                  className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4"
                                >
                                  <div className="flex flex-wrap gap-2">
                                    <MetadataChip
                                      label="segment"
                                      value={change.segmentId}
                                    />
                                    <MetadataChip
                                      label="command"
                                      value={change.sourceCommand ?? "unknown"}
                                    />
                                  </div>

                                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                                    <div className="space-y-2">
                                      <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
                                        Reason
                                      </p>
                                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-200">
                                        {change.reason || "No reason returned."}
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
                                        Source Block
                                      </p>
                                      <CodeBlock
                                        value={
                                          change.sourceLatexCode ??
                                          "[segment not found in annotated source LaTeX]"
                                        }
                                      />
                                    </div>
                                    <div className="space-y-2 xl:col-span-2">
                                      <p className="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
                                        Replacement Block
                                      </p>
                                      <CodeBlock
                                        value={
                                          change.replacementLatexCode ||
                                          "[empty string]"
                                        }
                                      />
                                    </div>
                                  </div>
                                </article>
                              ),
                            )
                          )}
                        </section>

                        {invalidReplacementPayload.structuredResponseJson ? (
                          <ExpandableCodeSection
                            charCount={
                              invalidReplacementPayload.structuredResponseJson.length
                            }
                            title="Full Structured Response JSON"
                            value={
                              invalidReplacementPayload.structuredResponseJson
                            }
                          />
                        ) : null}

                        <ExpandableCodeSection
                          charCount={
                            invalidReplacementPayload.annotatedLatexCode.length
                          }
                          title="Annotated Source LaTeX"
                          value={invalidReplacementPayload.annotatedLatexCode}
                        />
                      </>
                    ) : (
                      <ExpandableCodeSection
                        charCount={failure.latexCode.length}
                        title={formatTailorResumeDebugPayloadLabel(failure.source)}
                        value={failure.latexCode}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </main>
  );
}
