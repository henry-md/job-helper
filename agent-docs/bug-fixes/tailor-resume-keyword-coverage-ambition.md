Tailor Resume keyword coverage ambition

- Symptom: Step 3/4 could make only a few conservative edits and finish with several scraped job keywords still missing, especially low-priority narrative terms.
- Root cause: the prompts treated high-priority coverage as the hard obligation and framed low-priority terms as optional/natural-fit guidance, so the model often stopped once the resume was merely improved. Step 3 also produced near-final plaintext, which made it duplicate Step 4 and discouraged small keyword-placement decisions.
- Fix: planning and implementation prompts now frame the target as the ideal job-specific resume. Step 3 emits block-level intent (`editIntent` plus `targetKeywords`) and calls `check_planned_keyword_assignments`; Step 4 receives those keyword assignments and writes the actual LaTeX.
- Guardrail: future prompt changes should keep low-priority missing terms as actionable revise-again signals, not as decorative suggestions, and should not move final sentence-writing back into Step 3.
