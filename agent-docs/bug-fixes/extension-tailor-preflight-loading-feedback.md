Extension Tailor Resume preflight loading feedback:

- Symptom: after moving overwrite detection ahead of the optimistic run state, the shortcut and side panel button could feel unresponsive before either the editing flow or overwrite prompt appeared.
- Root cause: the extension was doing the safer preflight first, but it no longer published an immediate transient UI state while that check was running.
- Fix: the extension now writes a short-lived preparation state immediately, opens the side panel against that state, shows a page overlay right away, and renders the Tailor card with a blurred loading treatment until the flow resolves into either the live run or the overwrite prompt.
- Guardrail: when a safety preflight intentionally delays the optimistic success UI, add a distinct “checking” state immediately so the product still feels responsive without pretending work has already started.
