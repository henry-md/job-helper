## Tailor Resume Transient Model Retries

- Bug: transient OpenAI/network failures during Tailor Resume generation could bubble out of a stage before the existing validation retry loop ran, leaving extension runs failed with messages like "network error".
- Fix: wrap non-streaming Tailor Resume model requests in a shared transient retry helper that recognizes network, timeout, rate-limit, and 5xx-style failures. Planning and implementation also emit step retry events so active-run UIs show an automatic retry instead of an immediate terminal failure.
- Keep validation retries separate from transient request retries: malformed model output may still use stage feedback loops outside Step 2, while Step 2 chat responses must be normalized or shown as-is. Transport/server errors should retry the same request automatically.
