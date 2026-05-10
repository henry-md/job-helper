# Extension Tailor Run Retry Timers

The extension step timer used to key timing history only by `stepNumber`, so retry attempts overwrote the failed attempt and could make the visible timer reset or move backward. Step 5 page-fit timing also rendered as a separate slash-delimited step even though the UI presents it as Step 4b.

Fix approach: keep timing entries distinct by step plus attempt, preserve each attempt duration, and group multiple display entries for the same visible step with dot separators. Step 5 timings should display inside Step 4 as `4a.4b`, and retry attempts should display as `attempt1.attempt2`.
