Tailor Resume page-count self-check retries:

- Symptom: Step 4 could fail after three attempts while repeating the same non-winning compaction ideas because the model never saw the rendered-line measurement result for its own candidates.
- Root cause: the backend forced a line-measurement tool call, but it intercepted the tool arguments and validated them itself instead of returning the measurement output back into the model loop. Retry context only carried a thin summary of the last failure.
- Fix: give Step 4 a measured self-check loop where the model can call the rendered-line tool, read accepted/rejected results, revise candidates, and only then submit final candidates. Keep a dedicated Step-4 retry budget plus concise retry memory with segment ids, candidate snippets, line counts, and rejection reasons.
- Follow-up: add a second Step 4 tool that applies the candidate set to the full resume and reports the exact rendered page count using the same final validation logic, so the model can verify whether the resume is actually back within the target before deciding the pass is done.
- Follow-up: when a Step 4 pass produces real measured line savings but still misses the target page count, keep those verified reductions in the working draft for the next retry and in the saved reviewable output instead of discarding them at the end of the failed compaction run.
- Guardrail: prioritize multi-line edited blocks during page-count rescue and treat already-one-line blocks as last-resort cuts unless deletion is genuinely necessary.
