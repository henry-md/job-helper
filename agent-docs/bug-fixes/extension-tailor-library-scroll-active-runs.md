# Tailor Tab Active Runs Hid Saved Resumes

## Bug

When several background Tailor Resume runs were visible, the Tailor tab could not scroll down to generated saved resumes. The active run stack and saved resume list shared one flex column, but the saved resume list was the flexible child. Once the active cards exceeded the available panel height, the saved list shrank to zero instead of remaining reachable below the active cards.

## Fix

The Tailor tab shell now owns vertical scrolling, and the saved resume list keeps its natural height inside the library surface. This lets active runs and completed generated resumes scroll as one continuous Tailor tab.
