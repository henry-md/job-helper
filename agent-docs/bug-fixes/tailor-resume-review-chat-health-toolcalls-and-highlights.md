Tailor Resume review chat health toolcalls and highlights:

- Symptom: a review-chat refinement could create a new edit block without a steady PDF highlight, and the assistant could finish without checking rendered page count or malformed bullets.
- Cause: review chat used a direct final-JSON refinement path rather than the Step 4 rendered-health tool loop, and the extension review parser dropped added comparison edits whose original block was intentionally empty.
- Fix: expose a required `check_refined_resume_health` tool in the review-chat refinement loop, persist/display its compact transcript on review-chat assistant messages, block overflow or changed malformed bullets before save, and allow empty `beforeLatexCode` review edits so inserted blocks participate in preview highlighting.
- Guardrail: chat-created resume edits should be checked against the rendered PDF before final JSON, and added blocks with empty originals must remain in the review record, diff list, and interactive preview highlight queries.
