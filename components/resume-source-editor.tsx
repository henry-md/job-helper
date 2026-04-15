"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type {
  TailorResumeSourceDocument,
  TailorResumeSourceEntryItem,
  TailorResumeSourceItem,
  TailorResumeSourceLabeledLineItem,
  TailorResumeSourceParagraphItem,
  TailorResumeSourceSegment,
  TailorResumeSourceUnit,
  TailorResumeSourceUnitKind,
} from "@/lib/tailor-resume-types";

type ResumeSourceEditorProps = {
  disabled?: boolean;
  onChange: (nextValue: TailorResumeSourceDocument) => void;
  value: TailorResumeSourceDocument;
};

type RichTextLineEditorProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (nextUnit: TailorResumeSourceUnit) => void;
  placeholder?: string;
  unit: TailorResumeSourceUnit;
};

function createId(prefix: string) {
  if (
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptySourceSegment(
  id: string,
  overrides?: Partial<TailorResumeSourceSegment>,
): TailorResumeSourceSegment {
  return {
    id,
    isBold: false,
    isItalic: false,
    isLinkStyle: false,
    isUnderline: false,
    linkUrl: null,
    segmentType: "text",
    text: "",
    ...overrides,
  };
}

function createEmptySourceUnit(
  id: string,
  kind: TailorResumeSourceUnitKind,
  indentLevel = 0,
): TailorResumeSourceUnit {
  return {
    id,
    indentLevel,
    kind,
    segments: [createEmptySourceSegment(`${id}_seg_01`)],
  };
}

function createEntryItem(sectionId: string): TailorResumeSourceEntryItem {
  const id = createId(`${sectionId}_item`);

  return {
    bulletLines: [],
    dates: createEmptySourceUnit(`${id}_dates`, "entry_dates"),
    descriptionLines: [],
    heading: createEmptySourceUnit(`${id}_heading`, "entry_heading"),
    id,
    itemType: "entry",
  };
}

function createParagraphItem(sectionId: string): TailorResumeSourceParagraphItem {
  const id = createId(`${sectionId}_item`);

  return {
    content: createEmptySourceUnit(`${id}_content`, "paragraph"),
    id,
    itemType: "paragraph",
  };
}

function createLabeledLineItem(
  sectionId: string,
): TailorResumeSourceLabeledLineItem {
  const id = createId(`${sectionId}_item`);

  return {
    id,
    itemType: "labeled_line",
    label: createEmptySourceUnit(`${id}_label`, "labeled_line_label"),
    value: createEmptySourceUnit(`${id}_value`, "labeled_line_value"),
  };
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSegmentHtml(segment: TailorResumeSourceSegment) {
  const text =
    segment.segmentType === "separator_pipe"
      ? "|"
      : segment.segmentType === "separator_bullet"
        ? "•"
        : segment.text;
  let html = escapeHtml(text);

  if (segment.segmentType !== "text") {
    return `<span data-separator="${segment.segmentType}">${html}</span>`;
  }

  if (segment.isLinkStyle) {
    const href = segment.linkUrl ? escapeHtml(segment.linkUrl) : "#";
    html = `<a href="${href}" data-link-style="true">${html}</a>`;
  }

  if (segment.isUnderline && !segment.isLinkStyle) {
    html = `<u>${html}</u>`;
  }

  if (segment.isItalic) {
    html = `<em>${html}</em>`;
  }

  if (segment.isBold) {
    html = `<strong>${html}</strong>`;
  }

  return html;
}

function renderSegmentsHtml(segments: TailorResumeSourceSegment[]) {
  return segments.map(renderSegmentHtml).join("");
}

function splitTextIntoSegments(
  text: string,
  formatting: Omit<TailorResumeSourceSegment, "id" | "text" | "segmentType">,
) {
  if (!text) {
    return [] as Array<Omit<TailorResumeSourceSegment, "id">>;
  }

  const rawParts = text.split(/([|•])/g).filter((part) => part.length > 0);

  return rawParts.map((part) => {
    if (part === "|") {
      return {
        ...formatting,
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        isUnderline: false,
        linkUrl: null,
        segmentType: "separator_pipe" as const,
        text: "|",
      };
    }

    if (part === "•") {
      return {
        ...formatting,
        isBold: false,
        isItalic: false,
        isLinkStyle: false,
        isUnderline: false,
        linkUrl: null,
        segmentType: "separator_bullet" as const,
        text: "•",
      };
    }

    return {
      ...formatting,
      segmentType: "text" as const,
      text: part,
    };
  });
}

function mergeAdjacentSegments(
  segments: Array<Omit<TailorResumeSourceSegment, "id">>,
  unitId: string,
) {
  const merged: Array<Omit<TailorResumeSourceSegment, "id">> = [];

  for (const segment of segments) {
    const previousSegment = merged[merged.length - 1];

    if (
      previousSegment &&
      previousSegment.segmentType === segment.segmentType &&
      previousSegment.isBold === segment.isBold &&
      previousSegment.isItalic === segment.isItalic &&
      previousSegment.isLinkStyle === segment.isLinkStyle &&
      previousSegment.isUnderline === segment.isUnderline &&
      previousSegment.linkUrl === segment.linkUrl
    ) {
      previousSegment.text += segment.text;
      continue;
    }

    merged.push({ ...segment });
  }

  if (merged.length === 0) {
    return [createEmptySourceSegment(`${unitId}_seg_01`)];
  }

  return merged.map((segment, index) => ({
    ...segment,
    id: `${unitId}_seg_${String(index + 1).padStart(2, "0")}`,
  }));
}

function readSegmentsFromDomNode(
  node: Node,
  formatting: Omit<TailorResumeSourceSegment, "id" | "text" | "segmentType">,
): Array<Omit<TailorResumeSourceSegment, "id">> {
  if (node.nodeType === Node.TEXT_NODE) {
    return splitTextIntoSegments(node.textContent ?? "", formatting);
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const nextFormatting = { ...formatting };
  const tagName = node.tagName.toLowerCase();

  if (tagName === "strong" || tagName === "b") {
    nextFormatting.isBold = true;
  }

  if (tagName === "em" || tagName === "i") {
    nextFormatting.isItalic = true;
  }

  if (tagName === "u") {
    nextFormatting.isUnderline = true;
  }

  if (tagName === "a") {
    nextFormatting.isLinkStyle = true;
    nextFormatting.isUnderline = true;
    nextFormatting.linkUrl = node.getAttribute("href");
  }

  if (node.style.fontWeight && Number(node.style.fontWeight) >= 600) {
    nextFormatting.isBold = true;
  }

  if (node.style.fontStyle === "italic") {
    nextFormatting.isItalic = true;
  }

  if (node.style.textDecoration.includes("underline")) {
    nextFormatting.isUnderline = true;
  }

  return [...node.childNodes].flatMap((childNode) =>
    readSegmentsFromDomNode(childNode, nextFormatting),
  );
}

function parseSegmentsFromEditor(
  editorElement: HTMLDivElement,
  unitId: string,
): TailorResumeSourceSegment[] {
  const rawSegments = [...editorElement.childNodes].flatMap((node) =>
    readSegmentsFromDomNode(node, {
      isBold: false,
      isItalic: false,
      isLinkStyle: false,
      isUnderline: false,
      linkUrl: null,
    }),
  );

  return mergeAdjacentSegments(rawSegments, unitId);
}

function ToolbarButton({
  children,
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-zinc-300 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-zinc-600"
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function RichTextLineEditor({
  ariaLabel,
  className,
  disabled,
  onChange,
  placeholder,
  unit,
}: RichTextLineEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const serializedSegments = useMemo(
    () => JSON.stringify(unit.segments),
    [unit.segments],
  );
  const lastAppliedHtmlRef = useRef("");

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    if (document.activeElement === editorRef.current) {
      return;
    }

    const nextHtml = renderSegmentsHtml(unit.segments);

    if (lastAppliedHtmlRef.current === nextHtml) {
      return;
    }

    editorRef.current.innerHTML = nextHtml;
    lastAppliedHtmlRef.current = nextHtml;
  }, [serializedSegments, unit.segments]);

  function emitChangeFromDom() {
    if (!editorRef.current) {
      return;
    }

    const nextSegments = parseSegmentsFromEditor(editorRef.current, unit.id);
    lastAppliedHtmlRef.current = editorRef.current.innerHTML;
    onChange({
      ...unit,
      segments: nextSegments,
    });
  }

  function runFormattingCommand(command: string, value?: string) {
    if (!editorRef.current || disabled) {
      return;
    }

    editorRef.current.focus();
    document.execCommand(command, false, value);
    emitChangeFromDom();
  }

  function handleLinkClick() {
    if (disabled) {
      return;
    }

    const nextUrl = window.prompt(
      "Enter the destination URL for the selected text. Leave blank to remove the link.",
      "",
    );

    if (nextUrl === null) {
      return;
    }

    if (!nextUrl.trim()) {
      runFormattingCommand("unlink");
      return;
    }

    runFormattingCommand("createLink", nextUrl.trim());
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          disabled={disabled}
          onClick={() => runFormattingCommand("bold")}
          title="Bold the selected text"
        >
          Bold
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          onClick={() => runFormattingCommand("italic")}
          title="Italicize the selected text"
        >
          Italic
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          onClick={handleLinkClick}
          title="Add or remove link styling"
        >
          Link
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          onClick={() => {
            runFormattingCommand("removeFormat");
            runFormattingCommand("unlink");
          }}
          title="Remove inline formatting"
        >
          Clear
        </ToolbarButton>
      </div>

      <div
        aria-label={ariaLabel}
        className={classNames(
          "min-h-[3rem] rounded-[1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition empty:before:pointer-events-none empty:before:text-zinc-500 empty:before:content-[attr(data-placeholder)] focus:border-emerald-300/45",
          className,
          disabled && "cursor-not-allowed opacity-70",
        )}
        contentEditable={!disabled}
        data-placeholder={placeholder ?? ""}
        onBlur={emitChangeFromDom}
        onInput={emitChangeFromDom}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
        ref={editorRef}
        role="textbox"
        spellCheck={false}
        suppressContentEditableWarning
      />
    </div>
  );
}

function SectionCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{title}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function SubtleButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-zinc-300 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-zinc-600"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export default function ResumeSourceEditor({
  disabled,
  onChange,
  value,
}: ResumeSourceEditorProps) {
  function updateDocument(
    mutator: (draft: TailorResumeSourceDocument) => void,
  ) {
    const nextDocument =
      typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    mutator(nextDocument);
    onChange(nextDocument);
  }

  function replaceUnit(nextUnit: TailorResumeSourceUnit) {
    updateDocument((draft) => {
      if (draft.header.name.id === nextUnit.id) {
        draft.header.name = nextUnit;
        return;
      }

      const headerLineIndex = draft.header.lines.findIndex(
        (line) => line.id === nextUnit.id,
      );

      if (headerLineIndex !== -1) {
        draft.header.lines[headerLineIndex] = nextUnit;
        return;
      }

      for (const section of draft.sections) {
        if (section.title.id === nextUnit.id) {
          section.title = nextUnit;
          return;
        }

        for (const item of section.items) {
          if (item.itemType === "entry") {
            if (item.heading.id === nextUnit.id) {
              item.heading = nextUnit;
              return;
            }

            if (item.dates?.id === nextUnit.id) {
              item.dates = nextUnit;
              return;
            }

            const descriptionIndex = item.descriptionLines.findIndex(
              (line) => line.id === nextUnit.id,
            );

            if (descriptionIndex !== -1) {
              item.descriptionLines[descriptionIndex] = nextUnit;
              return;
            }

            const bulletIndex = item.bulletLines.findIndex(
              (line) => line.id === nextUnit.id,
            );

            if (bulletIndex !== -1) {
              item.bulletLines[bulletIndex] = nextUnit;
              return;
            }
          }

          if (item.itemType === "paragraph" && item.content.id === nextUnit.id) {
            item.content = nextUnit;
            return;
          }

          if (item.itemType === "labeled_line") {
            if (item.label.id === nextUnit.id) {
              item.label = nextUnit;
              return;
            }

            if (item.value.id === nextUnit.id) {
              item.value = nextUnit;
              return;
            }
          }
        }
      }
    });
  }

  function removeHeaderLine(lineId: string) {
    updateDocument((draft) => {
      draft.header.lines = draft.header.lines.filter((line) => line.id !== lineId);
    });
  }

  function addHeaderLine() {
    updateDocument((draft) => {
      draft.header.lines.push(
        createEmptySourceUnit(createId("header_line"), "header_line"),
      );
    });
  }

  function addItem(sectionId: string, item: TailorResumeSourceItem) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);

      if (!targetSection) {
        return;
      }

      targetSection.items.push(item);
    });
  }

  function removeItem(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);

      if (!targetSection) {
        return;
      }

      targetSection.items = targetSection.items.filter((item) => item.id !== itemId);
    });
  }

  function addEntryDescriptionLine(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.descriptionLines.push(
        createEmptySourceUnit(createId(`${itemId}_description`), "description_line"),
      );
    });
  }

  function removeEntryDescriptionLine(sectionId: string, itemId: string, unitId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.descriptionLines = targetItem.descriptionLines.filter(
        (line) => line.id !== unitId,
      );
    });
  }

  function addEntryBulletLine(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.bulletLines.push(
        createEmptySourceUnit(createId(`${itemId}_bullet`), "bullet", 1),
      );
    });
  }

  function removeEntryBulletLine(sectionId: string, itemId: string, unitId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.bulletLines = targetItem.bulletLines.filter(
        (line) => line.id !== unitId,
      );
    });
  }

  function clearEntryDates(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.dates = null;
    });
  }

  function addEntryDates(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem || targetItem.dates) {
        return;
      }

      targetItem.dates = createEmptySourceUnit(
        createId(`${itemId}_dates`),
        "entry_dates",
      );
    });
  }

  return (
    <div className="grid gap-5">
      <SectionCard title="Header">
        <div className="grid gap-3">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Name</p>
          <RichTextLineEditor
            ariaLabel="Resume name"
            disabled={disabled}
            onChange={replaceUnit}
            placeholder="Name"
            unit={value.header.name}
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Header lines
            </p>
            <SubtleButton disabled={disabled} onClick={addHeaderLine}>
              Add line
            </SubtleButton>
          </div>

          <div className="grid gap-3">
            {value.header.lines.map((line, index) => (
              <div
                className="rounded-[1rem] border border-white/8 bg-black/15 p-3"
                key={line.id}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Line {index + 1}
                  </p>
                  {value.header.lines.length > 1 ? (
                    <SubtleButton
                      disabled={disabled}
                      onClick={() => removeHeaderLine(line.id)}
                    >
                      Remove
                    </SubtleButton>
                  ) : null}
                </div>

                <RichTextLineEditor
                  ariaLabel={`Header line ${index + 1}`}
                  disabled={disabled}
                  onChange={replaceUnit}
                  placeholder="Contact line"
                  unit={line}
                />
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {value.sections.map((section, sectionIndex) => (
        <SectionCard
          key={section.id}
          title={`Section ${sectionIndex + 1}`}
        >
          <div className="grid gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Section title
            </p>
            <RichTextLineEditor
              ariaLabel={`Section ${sectionIndex + 1} title`}
              disabled={disabled}
              onChange={replaceUnit}
              placeholder="Section title"
              unit={section.title}
            />
          </div>

          <div className="grid gap-4">
            {section.items.map((item, itemIndex) => (
              <div
                className="rounded-[1.2rem] border border-white/10 bg-black/15 p-4"
                key={item.id}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    {item.itemType.replace("_", " ")} {itemIndex + 1}
                  </p>
                  <SubtleButton
                    disabled={disabled}
                    onClick={() => removeItem(section.id, item.id)}
                  >
                    Remove item
                  </SubtleButton>
                </div>

                {item.itemType === "entry" ? (
                  <div className="grid gap-4">
                    <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                      <div className="grid gap-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Heading
                        </p>
                        <RichTextLineEditor
                          ariaLabel={`Entry heading ${itemIndex + 1}`}
                          disabled={disabled}
                          onChange={replaceUnit}
                          placeholder="Company | Title"
                          unit={item.heading}
                        />
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                            Dates
                          </p>
                          {item.dates ? (
                            <SubtleButton
                              disabled={disabled}
                              onClick={() => clearEntryDates(section.id, item.id)}
                            >
                              Remove
                            </SubtleButton>
                          ) : (
                            <SubtleButton
                              disabled={disabled}
                              onClick={() => addEntryDates(section.id, item.id)}
                            >
                              Add
                            </SubtleButton>
                          )}
                        </div>

                        {item.dates ? (
                          <RichTextLineEditor
                            ariaLabel={`Entry dates ${itemIndex + 1}`}
                            disabled={disabled}
                            onChange={replaceUnit}
                            placeholder="Dates"
                            unit={item.dates}
                          />
                        ) : (
                          <div className="rounded-[1rem] border border-dashed border-white/10 bg-black/10 px-4 py-3 text-sm text-zinc-500">
                            No right-side dates for this entry.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Description lines
                        </p>
                        <SubtleButton
                          disabled={disabled}
                          onClick={() => addEntryDescriptionLine(section.id, item.id)}
                        >
                          Add line
                        </SubtleButton>
                      </div>

                      {item.descriptionLines.length > 0 ? (
                        <div className="grid gap-3">
                          {item.descriptionLines.map((line) => (
                            <div className="grid gap-2" key={line.id}>
                              <div className="flex justify-end">
                                <SubtleButton
                                  disabled={disabled}
                                  onClick={() =>
                                    removeEntryDescriptionLine(
                                      section.id,
                                      item.id,
                                      line.id,
                                    )
                                  }
                                >
                                  Remove
                                </SubtleButton>
                              </div>
                              <RichTextLineEditor
                                ariaLabel="Entry description line"
                                disabled={disabled}
                                onChange={replaceUnit}
                                placeholder="Description line"
                                unit={line}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[1rem] border border-dashed border-white/10 bg-black/10 px-4 py-3 text-sm text-zinc-500">
                          No description lines yet.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Bullet lines
                        </p>
                        <SubtleButton
                          disabled={disabled}
                          onClick={() => addEntryBulletLine(section.id, item.id)}
                        >
                          Add bullet
                        </SubtleButton>
                      </div>

                      {item.bulletLines.length > 0 ? (
                        <div className="grid gap-3">
                          {item.bulletLines.map((line) => (
                            <div
                              className="grid gap-2 rounded-[1rem] border border-white/8 bg-black/10 p-3"
                              key={line.id}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                                  Bullet
                                </p>
                                <SubtleButton
                                  disabled={disabled}
                                  onClick={() =>
                                    removeEntryBulletLine(section.id, item.id, line.id)
                                  }
                                >
                                  Remove
                                </SubtleButton>
                              </div>
                              <div className="flex items-start gap-3">
                                <span className="pt-4 text-lg leading-none text-zinc-500">
                                  •
                                </span>
                                <div className="min-w-0 flex-1">
                                  <RichTextLineEditor
                                    ariaLabel="Entry bullet line"
                                    disabled={disabled}
                                    onChange={replaceUnit}
                                    placeholder="Bullet point"
                                    unit={line}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[1rem] border border-dashed border-white/10 bg-black/10 px-4 py-3 text-sm text-zinc-500">
                          No bullets yet.
                        </div>
                      )}
                    </div>
                  </div>
                ) : item.itemType === "labeled_line" ? (
                  <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
                    <div className="grid gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                        Label
                      </p>
                      <RichTextLineEditor
                        ariaLabel={`Label ${itemIndex + 1}`}
                        disabled={disabled}
                        onChange={replaceUnit}
                        placeholder="Label"
                        unit={item.label}
                      />
                    </div>
                    <div className="grid gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                        Value
                      </p>
                      <RichTextLineEditor
                        ariaLabel={`Value ${itemIndex + 1}`}
                        disabled={disabled}
                        onChange={replaceUnit}
                        placeholder="Value"
                        unit={item.value}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                      Paragraph
                    </p>
                    <RichTextLineEditor
                      ariaLabel={`Paragraph ${itemIndex + 1}`}
                      disabled={disabled}
                      onChange={replaceUnit}
                      placeholder="Paragraph line"
                      unit={item.content}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <SubtleButton
              disabled={disabled}
              onClick={() => addItem(section.id, createEntryItem(section.id))}
            >
              Add entry
            </SubtleButton>
            <SubtleButton
              disabled={disabled}
              onClick={() => addItem(section.id, createParagraphItem(section.id))}
            >
              Add paragraph
            </SubtleButton>
            <SubtleButton
              disabled={disabled}
              onClick={() => addItem(section.id, createLabeledLineItem(section.id))}
            >
              Add labeled line
            </SubtleButton>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
