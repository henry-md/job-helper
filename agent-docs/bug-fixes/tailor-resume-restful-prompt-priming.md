# Tailor Resume RESTful Prompt Priming

Tailor Resume was over-inserting `RESTful` because several prompts used it as the repeated example for narrative keyword peppering. Even when Step 1 did not capture that keyword, later stages could treat the example as a latent preferred phrase.

Fix by deleting named capability-phrase examples from production prompts and using category wording instead. Keep checks focused on whether a term came from the emphasized keyword list or accepted plan, not on adding another post-generation deny filter.
