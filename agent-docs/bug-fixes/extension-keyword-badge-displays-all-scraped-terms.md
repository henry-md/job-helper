Extension keyword badge displays all scraped terms

- Symptom: Step 2 could ask about scraped technologies that were absent from the in-page Job Keywords badge.
- Root cause: the badge normalization path capped rendered emphasized technologies at 16 terms, while Step 2 used the full scraped keyword set. A separate Step 2 scraped-card helper also capped visible uncovered cards.
- Fix: render every normalized high- and low-priority scraped keyword in the badge and every uncovered scraped keyword card in the Step 2 review chat.
- Guardrail: do not add silent keyword display caps. If a long list needs UI treatment, show an explicit expandable/collapsed state that still makes all scraped terms reachable.
