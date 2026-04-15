Tailor Resume preview autosave race:

- The LaTeX editor preview felt stale because autosave waited 700 ms after typing stopped before sending the compile request.
- Removing that delay naively would introduce overlapping PATCH requests, and a slower older compile could finish after a newer edit and overwrite the saved LaTeX/PDF preview on disk.

Fix:

- Trigger the LaTeX autosave immediately when the editor value changes.
- Keep LaTeX saves sequential on the client: while one compile/save request is in flight, remember only the latest pending editor value and send that next.
- Do not write the server-returned LaTeX back into the textarea during autosave, or the cursor can jump while the user is typing.

Guardrail:

- For Tailor Resume LaTeX edits, prefer immediate queued autosave over debounce-only autosave so the PDF preview stays responsive without reintroducing stale-write races.
