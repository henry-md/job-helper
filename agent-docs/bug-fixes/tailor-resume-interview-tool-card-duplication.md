# Tailor Resume interview tool-card duplication

Step 2 interview turns render both the assistant message and structured `technologyContexts` tool fields in the chat UI. Prompt wording must make clear that those tool fields are visible user-facing content, not hidden metadata.

When asking about technology experience, keep `assistantMessage` to the compact question and put definitions/examples only in `technologyContexts`. Use two examples by default, but when the user asks for more technology examples, keep using `technologyContexts` and return the requested count within the tool limit. Duplicated rendered content is a presentation-quality issue only; Step 2 should preserve the answer instead of failing the tailoring run. Do not reintroduce validation or retry plumbing for this.
