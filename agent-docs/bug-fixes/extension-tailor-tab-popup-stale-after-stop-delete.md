Extension Tailor tab popup cleanup:

- Symptom: stopping or deleting a Tailor Resume run from the extension could clear the side panel state while leaving the injected job-page keyword popup visible on the browser tab.
- Root cause: stop/delete flows removed local Tailor registries and optimistic personal-info rows, but they did not explicitly tell matching job tabs to remove the content-script popup. Later tab checks could also briefly reuse cached Tailor state after navigation.
- Fix: stop/delete flows now request a badge hide for matching job URLs, background cancel cleanup hides matching tab popups, and tab badge checks force a fresh Tailor read on navigation/activation before deciding whether to show or hide a popup.
- Guardrail: job-tab popup visibility must be reconciled from fresh server-backed Tailor state on navigation, and local stop/delete cleanup should clear both side-panel registries and injected page UI.
