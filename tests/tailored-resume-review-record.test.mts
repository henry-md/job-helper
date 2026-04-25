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
            error: "Step 4: Example review warning.",
            id: "tailored-resume-1",
            pdfUpdatedAt: "2026-04-24T18:00:00.000Z",
            positionTitle: "Software Engineer",
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
  assert.equal(
    record.edits[0]?.segmentId,
    "work-experience.entry-1.bullet-1",
  );
});
