Tailor resume review chat keyword coverage refresh

- Symptom: after the review/tailor chat edited a saved tailored resume, the Job Keywords popup could keep showing stale In Base / In New / In Neither states from the pre-edit resume.
- Root cause: the refinement save path updated the saved LaTeX, edits, PDF, and version history, but preserved the old `keywordCoverage` ledger.
- Fix: after a successful refinement, rebuild `keywordCoverage` from the saved scraped terms, original source LaTeX, and newly refined LaTeX, then persist that refreshed ledger on the tailored resume record.
- Guardrail: any future save path that changes the final tailored LaTeX should either recompute keyword coverage from the same scraped terms or intentionally clear it when no scraped coverage exists.
