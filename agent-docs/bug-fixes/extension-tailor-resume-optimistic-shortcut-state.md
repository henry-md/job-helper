Extension Tailor Resume optimistic shortcut state:

- Symptom: pressing the extension shortcut could leave the side panel and page looking idle for a beat before any "Tailor Resume" progress appeared, even though the extension had already started work locally.
- Root cause: the keyboard/background capture path only persisted state after the request completed or hit a server-side conflict, so the side panel had no immediate in-progress run to render and the shortcut banner copy did not reflect the tailoring action yet.
- Fix: the extension now writes a `running` Tailor Resume record immediately when the shortcut starts, opens the panel against that optimistic state, and updates the stored run from streamed step events until the final result replaces it.
- Guardrail: any extension entrypoint that starts Tailor Resume should publish a user-visible optimistic run state before auth, page capture, or backend latency can delay the first real pipeline update.
