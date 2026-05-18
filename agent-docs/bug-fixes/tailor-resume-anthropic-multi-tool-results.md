Tailor Resume Anthropic multi-tool results:

- Symptom: Step 3 planning could fail with Anthropic 400 errors saying a `tool_use` id had no corresponding `tool_result` in the next message.
- Cause: Some lower-cost planning models may emit multiple tool calls in one assistant turn. Anthropic requires the immediately following user message to include one `tool_result` block for every `tool_use` id from that assistant message.
- Fix pattern: When adapting Responses-style function outputs to Anthropic messages, group consecutive tool outputs into one user message and only commit the transcript after the request succeeds. Step loops should answer every tool call from a model round before asking the model to continue.
