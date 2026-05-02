Tailor Resume global question queue order

- Bug: Step 2 queue order was decided only after a run finished Step 1 keyword scraping. A later-started run that scraped faster could become the ready chat before older active runs reached Step 2.
- Fix: question-queue claiming now uses active Tailor Resume run order as the global source of truth. Older active runs that have not completed Step 2 block newer runs from becoming `deciding`; newer runs stay `queued` until the head run either asks, skips, completes, fails, or is canceled.
- Guardrail: do not derive the active interview from load timing or from the newest queued marker. Queued interviews should be sorted FIFO, with at most one popped `ready` or `deciding` item ahead of the remaining queued items.
