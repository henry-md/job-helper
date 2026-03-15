Multi-screenshot extraction could lose context after the first upload because the editor locked all interactions while extraction was in progress and each new screenshot was extracted in isolation.

Fix approach:
- Keep uploads available while extraction is running, but queue screenshots and process them one at a time so each extraction can use the latest merged draft as context.
- Pass the current draft into `POST /api/job-applications/extract` and instruct the model to preserve prior fields while merging new screenshot details, especially for split job descriptions across multiple screenshots.
- Keep the extraction overlay non-interactive so drag-and-drop still reaches the green editor panel during processing.
