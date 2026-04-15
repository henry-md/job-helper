import test from "node:test";
import assert from "node:assert/strict";
import { renderTailorResumeLatex } from "../lib/tailor-resume-latex.ts";
import { normalizeResumeDocument } from "../lib/tailor-resume-source.ts";
import { parseResumeDocument } from "../lib/tailor-resume-types.ts";

test("normalizeResumeDocument keeps explicit extraction link URLs for non-visible link text", () => {
  const extractedDocument = parseResumeDocument({
    headerText: {
      segments: [
        {
          segmentType: "text",
          text: "JANE DOE",
          isBold: true,
          isItalic: false,
          isLinkStyle: false,
          linkUrl: null,
        },
      ],
    },
    subHeadText: [],
    sections: [
      {
        sectionText: {
          segments: [
            {
              segmentType: "text",
              text: "SOFTWARE PROJECTS",
              isBold: true,
              isItalic: false,
              isLinkStyle: false,
              linkUrl: null,
            },
          ],
        },
        blocks: [
          {
            blockType: "entry",
            subSectionText: {
              segments: [
                {
                  segmentType: "text",
                  text: "Interactive Resume Builder",
                  isBold: true,
                  isItalic: false,
                  isLinkStyle: true,
                  linkUrl: "https://example.com/resume-builder",
                },
                {
                  segmentType: "text",
                  text: "|",
                  isBold: false,
                  isItalic: false,
                  isLinkStyle: false,
                  linkUrl: null,
                },
                {
                  segmentType: "text",
                  text: "Full Stack Project",
                  isBold: false,
                  isItalic: false,
                  isLinkStyle: false,
                  linkUrl: null,
                },
              ],
            },
            subSectionDates: null,
            subSectionDescription: [],
            subSectionBullets: [],
          },
        ],
      },
    ],
  });

  const sourceDocument = normalizeResumeDocument(extractedDocument);
  const headingSegments = sourceDocument.sections[0]?.items[0];

  assert.ok(headingSegments && headingSegments.itemType === "entry");
  assert.equal(
    headingSegments.heading.segments[0]?.linkUrl,
    "https://example.com/resume-builder",
  );
  assert.equal(headingSegments.heading.segments[0]?.isLinkStyle, true);

  const renderedLatex = renderTailorResumeLatex(sourceDocument);

  assert.match(
    renderedLatex,
    /\\href\{https:\/\/example\.com\/resume-builder\}\{\\tightul\{\\textbf\{Interactive Resume Builder\}\}\}/,
  );
});
