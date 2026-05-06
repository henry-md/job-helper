Tailor Resume Step 2 chat closed immediately after answers

- Bug: The extension called `setIsTailorInterviewOpen(false)` as soon as the user submitted a Step 2 answer, before the interview model decided whether to ask another question or finish.
- Impact: Users were bounced back to the Tailor Resume list even when the model later returned another `initiate_tailor_resume_probing_questions` question.
- Fix: Keep the chat open while `advanceTailorResumeInterview` runs. Close it only after the streamed Step 2 generation event reports `stepNumber: 2` and `status: "succeeded"`, which is emitted after the model's finish/update tool path has been accepted. If the model returns another ask, the chat remains open and the new assistant message can stream into the thread.
