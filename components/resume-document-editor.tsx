"use client";

import type { ReactNode } from "react";
import type {
  ResumeDocument,
  ResumeIndentedRichText,
  ResumeLabeledLineBlock,
  ResumeParagraphBlock,
  ResumeRichText,
  ResumeSection,
  ResumeSectionBlock,
  ResumeSegmentType,
  ResumeSubHeadLine,
  ResumeTextSegment,
} from "@/lib/tailor-resume-types";
import {
  createEmptyResumeEntryBlock,
  createEmptyResumeIndentedRichText,
  createEmptyResumeLabeledLineBlock,
  createEmptyResumeParagraphBlock,
  createEmptyResumeRichText,
  createEmptyResumeSection,
  createEmptyResumeTextSegment,
} from "@/lib/tailor-resume-types";

type ResumeDocumentEditorProps = {
  disabled?: boolean;
  onChange: (value: ResumeDocument) => void;
  value: ResumeDocument;
};

function replaceItem<T>(items: T[], index: number, nextItem: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
}

function removeItem<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function SmallActionButton({
  children,
  disabled = false,
  onClick,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  tone?: "default" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
        tone === "danger"
          ? "border-rose-400/25 bg-rose-400/10 text-rose-200 hover:border-rose-300/35 hover:bg-rose-400/15"
          : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10"
      } disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function SegmentEditor({
  canRemove = true,
  disabled = false,
  onChange,
  onRemove,
  value,
}: {
  canRemove?: boolean;
  disabled?: boolean;
  onChange: (value: ResumeTextSegment) => void;
  onRemove?: () => void;
  value: ResumeTextSegment;
}) {
  const isSeparator = value.segmentType !== "text";

  return (
    <div className="rounded-[1rem] border border-white/10 bg-black/15 p-3">
      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
        <select
          className="rounded-[0.85rem] border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-300/45"
          disabled={disabled}
          onChange={(event) => {
            const nextType = event.target.value as ResumeSegmentType;
            onChange({
              ...value,
              segmentType: nextType,
              text:
                nextType === "separator_pipe"
                  ? "|"
                  : nextType === "separator_bullet"
                    ? "•"
                    : value.text === "|" || value.text === "•"
                      ? ""
                      : value.text,
            });
          }}
          value={value.segmentType}
        >
          <option value="text">Text</option>
          <option value="separator_pipe">Separator |</option>
          <option value="separator_bullet">Separator •</option>
        </select>

        <input
          className="rounded-[0.85rem] border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/45"
          disabled={disabled || isSeparator}
          onChange={(event) =>
            onChange({
              ...value,
              text: event.target.value,
            })
          }
          placeholder="Segment text"
          value={value.text}
        />

        {canRemove ? (
          <SmallActionButton disabled={disabled} onClick={onRemove} tone="danger">
            Remove
          </SmallActionButton>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-400">
        <label className="flex items-center gap-2">
          <input
            checked={value.isBold}
            className="accent-emerald-400"
            disabled={disabled || isSeparator}
            onChange={(event) =>
              onChange({
                ...value,
                isBold: event.target.checked,
              })
            }
            type="checkbox"
          />
          Bold
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={value.isItalic}
            className="accent-emerald-400"
            disabled={disabled || isSeparator}
            onChange={(event) =>
              onChange({
                ...value,
                isItalic: event.target.checked,
              })
            }
            type="checkbox"
          />
          Italic
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={value.isLinkStyle}
            className="accent-emerald-400"
            disabled={disabled || isSeparator}
            onChange={(event) =>
              onChange({
                ...value,
                isLinkStyle: event.target.checked,
              })
            }
            type="checkbox"
          />
          Link style
        </label>
      </div>
    </div>
  );
}

function RichTextEditor({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: ResumeRichText) => void;
  value: ResumeRichText;
}) {
  return (
    <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </p>
        <SmallActionButton
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              segments: [...value.segments, createEmptyResumeTextSegment()],
            })
          }
        >
          Add segment
        </SmallActionButton>
      </div>

      <div className="grid gap-3">
        {value.segments.map((segment, segmentIndex) => (
          <SegmentEditor
            canRemove={value.segments.length > 1}
            disabled={disabled}
            key={`${label}-segment-${segmentIndex}`}
            onChange={(nextSegment) =>
              onChange({
                ...value,
                segments: replaceItem(value.segments, segmentIndex, nextSegment),
              })
            }
            onRemove={() =>
              onChange({
                ...value,
                segments: removeItem(value.segments, segmentIndex),
              })
            }
            value={segment}
          />
        ))}
      </div>
    </div>
  );
}

function IndentedRichTextEditor({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: ResumeIndentedRichText) => void;
  value: ResumeIndentedRichText;
}) {
  return (
    <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </p>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Indent</span>
          <select
            className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-300/45"
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                indentLevel: Number.parseInt(event.target.value, 10),
              })
            }
            value={String(value.indentLevel)}
          >
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>
      </div>

      <RichTextEditor
        disabled={disabled}
        label={`${label} segments`}
        onChange={(nextValue) =>
          onChange({
            ...value,
            segments: nextValue.segments,
          })
        }
        value={{ segments: value.segments }}
      />
    </div>
  );
}

function SubHeadLineEditor({
  disabled = false,
  onChange,
  onRemove,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSubHeadLine) => void;
  onRemove: () => void;
  value: ResumeSubHeadLine;
}) {
  return (
    <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Sub-head line
        </p>
        <div className="flex items-center gap-2">
          <select
            className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-300/45"
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                separatorBetweenItems:
                  event.target.value === "none"
                    ? null
                    : (event.target.value as ResumeSubHeadLine["separatorBetweenItems"]),
              })
            }
            value={value.separatorBetweenItems ?? "none"}
          >
            <option value="bullet">Separator •</option>
            <option value="pipe">Separator |</option>
            <option value="none">No separator</option>
          </select>
          <SmallActionButton disabled={disabled} onClick={onRemove} tone="danger">
            Remove line
          </SmallActionButton>
        </div>
      </div>

      <div className="grid gap-3">
        {value.lineItems.map((lineItem, lineItemIndex) => (
          <div
            className="rounded-[1rem] border border-white/10 bg-black/15 p-3"
            key={`line-item-${lineItemIndex}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                Line item {lineItemIndex + 1}
              </p>
              <SmallActionButton
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...value,
                    lineItems: removeItem(value.lineItems, lineItemIndex),
                  })
                }
                tone="danger"
              >
                Remove item
              </SmallActionButton>
            </div>
            <RichTextEditor
              disabled={disabled}
              label={`Line item ${lineItemIndex + 1}`}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  lineItems: replaceItem(value.lineItems, lineItemIndex, nextValue),
                })
              }
              value={lineItem}
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <SmallActionButton
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              lineItems: [...value.lineItems, createEmptyResumeRichText()],
            })
          }
        >
          Add line item
        </SmallActionButton>
      </div>
    </div>
  );
}

function EntryBlockEditor({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSectionBlock) => void;
  value: ResumeSectionBlock;
}) {
  if (value.blockType !== "entry") {
    return null;
  }

  return (
    <div className="grid gap-3">
      <RichTextEditor
        disabled={disabled}
        label="Entry header"
        onChange={(nextValue) =>
          onChange({
            ...value,
            subSectionText: nextValue,
          })
        }
        value={value.subSectionText}
      />

      {value.subSectionDates ? (
        <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Right-side text
            </p>
            <SmallActionButton
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  subSectionDates: null,
                })
              }
              tone="danger"
            >
              Remove
            </SmallActionButton>
          </div>
          <RichTextEditor
            disabled={disabled}
            label="Right-side text"
            onChange={(nextValue) =>
              onChange({
                ...value,
                subSectionDates: nextValue,
              })
            }
            value={value.subSectionDates}
          />
        </div>
      ) : (
        <SmallActionButton
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              subSectionDates: createEmptyResumeRichText(),
            })
          }
        >
          Add right-side text
        </SmallActionButton>
      )}

      <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Description paragraphs
          </p>
          <SmallActionButton
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                subSectionDescription: [
                  ...value.subSectionDescription,
                  createEmptyResumeIndentedRichText(0),
                ],
              })
            }
          >
            Add paragraph
          </SmallActionButton>
        </div>
        <div className="grid gap-3">
          {value.subSectionDescription.map((paragraph, paragraphIndex) => (
            <div key={`description-${paragraphIndex}`}>
              <div className="mb-2 flex justify-end">
                <SmallActionButton
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      subSectionDescription: removeItem(
                        value.subSectionDescription,
                        paragraphIndex,
                      ),
                    })
                  }
                  tone="danger"
                >
                  Remove paragraph
                </SmallActionButton>
              </div>
              <IndentedRichTextEditor
                disabled={disabled}
                label={`Paragraph ${paragraphIndex + 1}`}
                onChange={(nextValue) =>
                  onChange({
                    ...value,
                    subSectionDescription: replaceItem(
                      value.subSectionDescription,
                      paragraphIndex,
                      nextValue,
                    ),
                  })
                }
                value={paragraph}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[1.1rem] border border-white/8 bg-white/4 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Bullets
          </p>
          <SmallActionButton
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                subSectionBullets: [
                  ...value.subSectionBullets,
                  createEmptyResumeIndentedRichText(1),
                ],
              })
            }
          >
            Add bullet
          </SmallActionButton>
        </div>
        <div className="grid gap-3">
          {value.subSectionBullets.map((bullet, bulletIndex) => (
            <div key={`bullet-${bulletIndex}`}>
              <div className="mb-2 flex justify-end">
                <SmallActionButton
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      subSectionBullets: removeItem(
                        value.subSectionBullets,
                        bulletIndex,
                      ),
                    })
                  }
                  tone="danger"
                >
                  Remove bullet
                </SmallActionButton>
              </div>
              <IndentedRichTextEditor
                disabled={disabled}
                label={`Bullet ${bulletIndex + 1}`}
                onChange={(nextValue) =>
                  onChange({
                    ...value,
                    subSectionBullets: replaceItem(
                      value.subSectionBullets,
                      bulletIndex,
                      nextValue,
                    ),
                  })
                }
                value={bullet}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ParagraphBlockEditor({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSectionBlock) => void;
  value: ResumeSectionBlock;
}) {
  if (value.blockType !== "paragraph") {
    return null;
  }

  return (
    <IndentedRichTextEditor
      disabled={disabled}
      label="Paragraph"
      onChange={(nextValue) =>
        onChange({
          ...value,
          content: nextValue,
        } as ResumeParagraphBlock)
      }
      value={value.content}
    />
  );
}

function LabeledLineBlockEditor({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSectionBlock) => void;
  value: ResumeSectionBlock;
}) {
  if (value.blockType !== "labeled_line") {
    return null;
  }

  return (
    <div className="grid gap-3">
      <RichTextEditor
        disabled={disabled}
        label="Label"
        onChange={(nextValue) =>
          onChange({
            ...value,
            label: nextValue,
          } as ResumeLabeledLineBlock)
        }
        value={value.label}
      />
      <RichTextEditor
        disabled={disabled}
        label="Value"
        onChange={(nextValue) =>
          onChange({
            ...value,
            value: nextValue,
          } as ResumeLabeledLineBlock)
        }
        value={value.value}
      />
    </div>
  );
}

function SectionBlockEditor({
  disabled = false,
  onChange,
  onRemove,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSectionBlock) => void;
  onRemove: () => void;
  value: ResumeSectionBlock;
}) {
  return (
    <div className="rounded-[1.2rem] border border-white/10 bg-black/15 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Block
          </p>
          <select
            className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-300/45"
            disabled={disabled}
            onChange={(event) => {
              const nextType = event.target.value;

              onChange(
                nextType === "entry"
                  ? createEmptyResumeEntryBlock()
                  : nextType === "labeled_line"
                    ? createEmptyResumeLabeledLineBlock()
                    : createEmptyResumeParagraphBlock(),
              );
            }}
            value={value.blockType}
          >
            <option value="entry">Entry</option>
            <option value="paragraph">Paragraph</option>
            <option value="labeled_line">Labeled line</option>
          </select>
        </div>

        <SmallActionButton disabled={disabled} onClick={onRemove} tone="danger">
          Remove block
        </SmallActionButton>
      </div>

      <EntryBlockEditor disabled={disabled} onChange={onChange} value={value} />
      <ParagraphBlockEditor disabled={disabled} onChange={onChange} value={value} />
      <LabeledLineBlockEditor disabled={disabled} onChange={onChange} value={value} />
    </div>
  );
}

function SectionEditor({
  disabled = false,
  onChange,
  onRemove,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ResumeSection) => void;
  onRemove: () => void;
  value: ResumeSection;
}) {
  return (
    <div className="rounded-[1.35rem] border border-white/10 bg-black/15 p-4 sm:p-5">
      <div className="mb-4 flex justify-end">
        <SmallActionButton disabled={disabled} onClick={onRemove} tone="danger">
          Remove section
        </SmallActionButton>
      </div>

      <RichTextEditor
        disabled={disabled}
        label="Section title"
        onChange={(nextValue) =>
          onChange({
            ...value,
            sectionText: nextValue,
          })
        }
        value={value.sectionText}
      />

      <div className="mt-4 grid gap-4">
        {value.blocks.map((block, blockIndex) => (
          <SectionBlockEditor
            disabled={disabled}
            key={`section-block-${blockIndex}`}
            onChange={(nextValue) =>
              onChange({
                ...value,
                blocks: replaceItem(value.blocks, blockIndex, nextValue),
              })
            }
            onRemove={() =>
              onChange({
                ...value,
                blocks: removeItem(value.blocks, blockIndex),
              })
            }
            value={block}
          />
        ))}
      </div>

      <div className="mt-4">
        <SmallActionButton
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              blocks: [...value.blocks, createEmptyResumeEntryBlock()],
            })
          }
        >
          Add block
        </SmallActionButton>
      </div>
    </div>
  );
}

export default function ResumeDocumentEditor({
  disabled = false,
  onChange,
  value,
}: ResumeDocumentEditorProps) {
  return (
    <div className="grid gap-4">
      <RichTextEditor
        disabled={disabled}
        label="Header text"
        onChange={(nextValue) =>
          onChange({
            ...value,
            headerText: nextValue,
          })
        }
        value={value.headerText}
      />

      <section className="rounded-[1.35rem] border border-white/10 bg-black/15 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
            Sub-head lines
          </p>
          <SmallActionButton
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                subHeadText: [
                  ...value.subHeadText,
                  {
                    lineItems: [createEmptyResumeRichText()],
                    separatorBetweenItems: "bullet",
                  },
                ],
              })
            }
          >
            Add line
          </SmallActionButton>
        </div>

        <div className="grid gap-4">
          {value.subHeadText.map((line, lineIndex) => (
            <SubHeadLineEditor
              disabled={disabled}
              key={`sub-head-line-${lineIndex}`}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  subHeadText: replaceItem(value.subHeadText, lineIndex, nextValue),
                })
              }
              onRemove={() =>
                onChange({
                  ...value,
                  subHeadText: removeItem(value.subHeadText, lineIndex),
                })
              }
              value={line}
            />
          ))}
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-white/10 bg-black/15 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
            Sections
          </p>
          <SmallActionButton
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                sections: [...value.sections, createEmptyResumeSection()],
              })
            }
          >
            Add section
          </SmallActionButton>
        </div>

        <div className="grid gap-4">
          {value.sections.map((section, sectionIndex) => (
            <SectionEditor
              disabled={disabled}
              key={`resume-section-${sectionIndex}`}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  sections: replaceItem(value.sections, sectionIndex, nextValue),
                })
              }
              onRemove={() =>
                onChange({
                  ...value,
                  sections: removeItem(value.sections, sectionIndex),
                })
              }
              value={section}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
