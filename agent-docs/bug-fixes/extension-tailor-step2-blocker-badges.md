# Extension Tailor Step 2 Blocker Badges

Bug: Step 2 could return uncovered skills-section keywords but the extension card only showed the generic "Recheck" action, with no badges for the blocking terms. This was easy to reintroduce because the full scraped keyword list and the blocking keyword subset travel through different UI paths.

Fix pattern: carry `blockingTechnologies` separately from `emphasizedTechnologies` through generation step events, pending-interview state, extension parsing, and active-run cards. Keep the blocker list restricted to skills-section keywords across both high and low priorities; narrative and non-skill keywords should not block Step 2 or render as blocker badges.

Verification: include blocker terms in the active-run refresh key so another tab or the extension side panel refreshes when the badge set changes, even if the step label and status stay the same.
