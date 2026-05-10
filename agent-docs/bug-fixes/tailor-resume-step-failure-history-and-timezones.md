# Tailor Resume step failure history and timezones

- Symptom: when a Tailor Resume stage failed on a later retry, the terminal failure made it hard to see why the previous attempt failed, and debug timestamps could be misread because database `createdAt` values are UTC while local operator context is Eastern time.
- Fix: step-failure debug payloads now include a compact per-run `failureHistory` with earlier failed attempts, plus explicit `loggedAtUtc`, `loggedAtLocal`, and `loggedAtTimeZone` fields. Keep both UTC and local fields in future failure logs so operators can compare database rows, console output, and local observations without guessing.
