Tailor Resume page-count soft save (superseded):

- Previous behavior: Step 5 page-count verification or compaction failures could be soft-saved when Step 4 had already produced a previewable tailored PDF.
- Superseding policy: generated tailored resumes that do not retain the required original page count are generation failures, even when a preview PDF exists.
- Current guardrail: do not save or present a page-count-invalid tailored resume as a ready/reviewable result. Step 5 returned validation errors and thrown compaction errors must both become hard generation failures.
