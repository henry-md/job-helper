import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTailoredResumeReviewRecordFromPayload,
} from "../lib/tailored-resume-review-record.ts";

test("resolveTailoredResumeReviewRecordFromPayload returns the requested record", () => {
  const record = resolveTailoredResumeReviewRecordFromPayload(
    {
      profile: {
        tailoredResumes: [
          {
            companyName: "Microsoft",
            displayName: "Software Engineer at Microsoft",
            edits: [
              {
                afterLatexCode: "\\resumeitem{Inserted chat-created block}",
                beforeLatexCode: "",
                command: "resumeitem",
                customLatexCode: null,
                editId: "work-experience.entry-1.bullet-2.inserted:comparison",
                generatedByStep: 4,
                reason: "Added in the selected output comparison.",
                segmentId: "work-experience.entry-1.bullet-2.inserted",
                state: "applied",
              },
              {
                afterLatexCode: "\\resumeitem{Built the tailored block}",
                beforeLatexCode: "\\resumeitem{Built the original block}",
                command: "resumeitem",
                customLatexCode: null,
                editId: "work-experience.entry-1.bullet-1:model",
                generatedByStep: 4,
                reason: "Emphasized backend ownership.",
                segmentId: "work-experience.entry-1.bullet-1",
                state: "applied",
              },
            ],
            error: "Step 5: Example review warning.",
            id: "tailored-resume-1",
            pdfUpdatedAt: "2026-04-24T18:00:00.000Z",
            positionTitle: "Software Engineer",
            reviewChatMessages: [
              {
                content: "Turn the first bullet to test 1.",
                createdAt: "2026-06-09T21:19:00.000Z",
                id: "chat-message-1",
                role: "user",
              },
              {
                content: "Updated the first bullet.",
                createdAt: "2026-06-09T21:20:00.000Z",
                id: "chat-message-2",
                role: "assistant",
                toolCalls: [
                  {
                    argumentsText: "{\"changes\":[]}",
                    name: "check_refined_resume_health",
                    outputText: "{\"ok\":true,\"pageCount\":1}",
                  },
                ],
              },
            ],
            updatedAt: "2026-04-24T18:00:00.000Z",
          },
          {
            companyName: "Other",
            displayName: "Other role",
            edits: [],
            error: null,
            id: "tailored-resume-2",
            pdfUpdatedAt: null,
            positionTitle: "Engineer",
            updatedAt: "2026-04-23T18:00:00.000Z",
          },
        ],
      },
      tailoredResumeId: "tailored-resume-1",
    },
    "tailored-resume-1",
  );

  assert.ok(record);
  assert.equal(record.id, "tailored-resume-1");
  assert.equal(record.companyName, "Microsoft");
  assert.equal(record.edits[0]?.generatedByStep, 4);
  assert.equal(record.edits[0]?.beforeLatexCode, "");
  assert.equal(
    record.edits[1]?.segmentId,
    "work-experience.entry-1.bullet-1",
  );
  assert.equal(record.reviewChatMessages[0]?.toolCalls.length, 0);
  assert.equal(
    record.reviewChatMessages[1]?.toolCalls[0]?.name,
    "check_refined_resume_health",
  );
  assert.deepEqual(
    record.reviewChatMessages.map((message) => [message.role, message.content]),
    [
      ["user", "Turn the first bullet to test 1."],
      ["assistant", "Updated the first bullet."],
    ],
  );
});
