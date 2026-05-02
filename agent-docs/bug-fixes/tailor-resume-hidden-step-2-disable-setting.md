Tailor Resume hidden Step 2 question disable setting

- Bug: existing profiles could contain `generationSettings.values.allowTailorResumeFollowUpQuestions: false`, which silently skipped Step 2 questions and sent extension runs straight into planning and implementation. The extension did not expose this toggle, so real Chrome could disagree with fresh `$checks` sessions.
- Fix: Step 2 follow-up questions remain a real user setting, but the toggle is exposed in the extension settings panel as well as the web dashboard before saved state is allowed to affect tailoring.
- Migration: generation settings are versioned. Version 1 / unversioned profiles predate the visible Step 2 questions toggle, so a saved `allowTailorResumeFollowUpQuestions: false` is treated as legacy hidden state and migrated to `true` on read. Future saves write version 2, where an explicit off toggle remains off.
- Related cleanup: page-count protection also changes generated output, so it is exposed in the extension settings panel as well as the web dashboard.
- Rule: behavior-changing developer/debug switches belong in `.env`; behavior-changing product settings must be visible where users start the flow. Hidden persisted product state must not decide whether Step 2 questions run.
