Tailor Resume debug errors for invalid replacements:

- Symptom: `/debug/errors` only recorded compile failures, so structurally invalid tailoring responses such as multi-block replacements were invisible unless a user happened to see the inline toast.
- Root cause: the tailoring loop retried invalid block replacements in memory, but only compile failures were persisted to the debug error log.

Fix:

- Log invalid tailoring replacements separately from bad generated LaTeX documents.
- For invalid replacements, store the rejected structured response alongside the annotated source LaTeX so the debug page shows the exact segment ids, replacement text, and source context the model saw.
- Keep compile-failure entries separate so `/debug/errors` can split them into distinct sections.

Guardrail:

- If a tailoring run fails before LaTeX compilation starts, `/debug/errors` should still show that attempt under invalid replacements rather than hiding it inside compile-failure logs or only the UI toast.
- The debug page should render invalid-replacement payloads with explicit text colors and structured sections for thesis, metadata, source block, and replacement block. Dumping the raw payload into a light `<pre>` inside the app-wide dark theme makes the failure effectively unreadable.
