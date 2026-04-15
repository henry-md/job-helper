Tailor Resume object model:

1. Extraction Document (`ResumeDocument`)
- File: `lib/tailor-resume-types.ts`
- This is the deeply nested structured response returned from the first OpenAI extraction call.
- It preserves the extractor-facing shape: `headerText`, `subHeadText`, `sections`, and nested `blocks`.
- It is useful for capture fidelity and debugging, but it is not the long-term editing surface.
- Condensed shape:

```ts
type ResumeDocument = {
  headerText: ResumeRichText;
  subHeadText: ResumeSubHeadLine[];
  sections: {
    sectionText: ResumeRichText;
    blocks: ResumeSectionBlock[];
  }[];
};
```

2. Source Document (`TailorResumeSourceDocument`)
- Files: `lib/tailor-resume-types.ts`, `lib/tailor-resume-source.ts`
- This is the simplified, editable resume object created deterministically from the Extraction Document.
- This is the product-facing source of truth for resume tailoring.
- The UI edits this shape directly with stable ids on every editable unit and inline segment.
- Main shape:
  - `header.name`
  - `header.lines[]`
  - `sections[]`
  - each section has `title` and `items[]`
  - each item is `entry`, `paragraph`, or `labeled_line`
  - each editable line is a `TailorResumeSourceUnit`
  - each inline run is a `TailorResumeSourceSegment`
- Condensed shape:

```ts
type TailorResumeSourceDocument = {
  version: 1;
  header: {
    id: string;
    name: TailorResumeSourceUnit;
    lines: TailorResumeSourceUnit[];
  };
  sections: {
    id: string;
    title: TailorResumeSourceUnit;
    items: TailorResumeSourceItem[];
  }[];
};

type TailorResumeSourceItem =
  | {
      id: string;
      itemType: "entry";
      heading: TailorResumeSourceUnit;
      dates: TailorResumeSourceUnit | null;
      descriptionLines: TailorResumeSourceUnit[];
      bulletLines: TailorResumeSourceUnit[];
    }
  | {
      id: string;
      itemType: "paragraph";
      content: TailorResumeSourceUnit;
    }
  | {
      id: string;
      itemType: "labeled_line";
      label: TailorResumeSourceUnit;
      value: TailorResumeSourceUnit;
    };

type TailorResumeSourceUnit = {
  id: string;
  kind: TailorResumeSourceUnitKind;
  indentLevel: number;
  segments: TailorResumeSourceSegment[];
};

type TailorResumeSourceSegment = {
  id: string;
  segmentType: "text" | "separator_pipe" | "separator_bullet";
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isLinkStyle: boolean;
  linkUrl: string | null;
};
```
- Important rule:
  - OpenAI tailoring should consume and patch this object, not raw LaTeX and not the original extraction shape.

3. Rendered LaTeX Document (`string`)
- File: `lib/tailor-resume-latex.ts`
- This is the pure LaTeX string generated deterministically from the Source Document.
- It is presentation output only.
- The PDF preview is compiled from this string.
- We do not parse edited LaTeX back into the Source Document.
- Condensed shape:

```ts
type RenderedLatexDocument = string;
```

- Companion derived artifact:

```ts
type TailorResumePreviewPdf = Buffer;
```

Parsing/rendering flow:

1. Resume upload is saved locally.
2. OpenAI extraction produces the Extraction Document (`ResumeDocument`).
3. `normalizeResumeDocument(...)` converts that Extraction Document into the Source Document (`TailorResumeSourceDocument`).
4. The dashboard rich-text editor edits the Source Document directly.
5. `renderTailorResumeLatex(...)` converts the Source Document into the Rendered LaTeX Document.
6. `compileTailorResumeLatex(...)` turns that LaTeX into the preview PDF.

Why this split exists:

- `ResumeDocument -> TailorResumeSourceDocument` is deterministic and stable.
- `TailorResumeSourceDocument -> LaTeX` is deterministic and stable.
- `LaTeX -> TailorResumeSourceDocument` is intentionally unsupported because it is brittle and would break future tailoring correctness.

Relevant code paths:

- Extraction call: `lib/tailor-resume-extraction.ts`
- Extraction schema + source schema: `lib/tailor-resume-types.ts`
- Deterministic normalization: `lib/tailor-resume-source.ts`
- Deterministic LaTeX rendering: `lib/tailor-resume-latex.ts`
- Saved profile + preview persistence: `lib/tailor-resume-storage.ts`
- API orchestration: `app/api/tailor-resume/route.ts`
- Preview route: `app/api/tailor-resume/preview/route.ts`
- Source editor UI: `components/resume-source-editor.tsx`
- Tailor Resume workspace: `components/tailor-resume-workspace.tsx`

Testing:

- Henry reference fixture source object: `tests/fixtures/tailor-resume/henry-deutsch-source.ts`
- Henry reference expected LaTeX: `tests/fixtures/tailor-resume/henry-deutsch-latex.ts`
- Deterministic renderer regression test: `tests/tailor-resume-latex.test.mts`
