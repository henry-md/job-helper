"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
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

type AddMenuOption = {
  description?: string;
  label: string;
  onSelect: () => void;
};

type DraftSourceSegment = Omit<TailorResumeSourceSegment, "id">;
type DraftSourceFormatting = Omit<
  TailorResumeSourceSegment,
  "id" | "segmentType" | "text"
>;

type LinkActionState = {
  end: number;
  position: {
    left: number;
    top: number;
  };
  start: number;
  text: string;
};

type LinkEditorState = {
  end: number;
  mode: "create" | "edit";
  position: {
    left: number;
    top: number;
  };
  start: number;
  url: string;
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
    dates: null,
    description: null,
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

function isInlineSeparatorText(value: string) {
  return value.trim() === "|" || value.trim() === "•";
}

function isInlineSeparatorSegment(segment: Pick<TailorResumeSourceSegment, "text">) {
  return isInlineSeparatorText(segment.text);
}

const linkInlineStyle = [
  "color:#9acbff",
  "text-decoration-line:underline",
  "text-decoration-color:rgba(154,203,255,0.72)",
  "text-decoration-thickness:1.5px",
  "text-underline-offset:0.18em",
].join(";");

function renderFormattedSegmentHtml(
  segment: TailorResumeSourceSegment,
  options?: {
    omitUnderline?: boolean;
  },
) {
  let html = escapeHtml(
    isInlineSeparatorSegment(segment) ? segment.text.trim() : segment.text,
  );

  if (isInlineSeparatorSegment(segment)) {
    return `<span data-inline-separator="true" style="display:inline-block;margin:0 0.35em;">${html}</span>`;
  }

  if (segment.isUnderline && !options?.omitUnderline) {
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

function renderLinkGroupHtml(
  segments: TailorResumeSourceSegment[],
  linkUrl: string | null,
  start: number,
  end: number,
) {
  const href = escapeHtml(linkUrl ?? "#");
  const dataUrl = escapeHtml(linkUrl ?? "");
  const innerHtml = segments
    .map((segment) =>
      renderFormattedSegmentHtml(segment, {
        omitUnderline: true,
      }),
    )
    .join("");

  return `<a href="${href}" data-link-end="${end}" data-link-start="${start}" data-link-style="true" data-link-url="${dataUrl}" style="${linkInlineStyle}">${innerHtml}</a>`;
}

function renderSegmentsHtml(segments: TailorResumeSourceSegment[]) {
  let renderedHtml = "";
  let textOffset = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.isLinkStyle && !isInlineSeparatorSegment(segment)) {
      const linkUrl = segment.linkUrl ?? null;
      const groupedSegments = [segment];
      const groupStart = textOffset;
      textOffset += segment.text.length;

      while (index + 1 < segments.length) {
        const nextSegment = segments[index + 1];

        if (
          !nextSegment?.isLinkStyle ||
          isInlineSeparatorSegment(nextSegment) ||
          (nextSegment.linkUrl ?? null) !== linkUrl
        ) {
          break;
        }

        groupedSegments.push(nextSegment);
        textOffset += nextSegment.text.length;
        index += 1;
      }

      renderedHtml += renderLinkGroupHtml(
        groupedSegments,
        linkUrl,
        groupStart,
        textOffset,
      );
      continue;
    }

    renderedHtml += renderFormattedSegmentHtml(segment);
    textOffset += segment.text.length;
  }

  return renderedHtml;
}

function normalizeLinkUrlInput(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (
    /^https?:\/\//i.test(trimmedValue) ||
    /^mailto:/i.test(trimmedValue) ||
    /^tel:/i.test(trimmedValue)
  ) {
    return trimmedValue;
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedValue)) {
    return `mailto:${trimmedValue}`;
  }

  if (/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(trimmedValue)) {
    return `https://${trimmedValue}`;
  }

  return null;
}

function buildPopoverPosition(rect: DOMRect) {
  return {
    left: rect.left + rect.width / 2,
    top: rect.bottom + 10,
  };
}

function isNodeInsideEditor(container: HTMLElement, node: Node | null) {
  return Boolean(node && (node === container || container.contains(node)));
}

function readSelectionState(
  editorElement: HTMLDivElement,
): LinkActionState | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (
    !isNodeInsideEditor(editorElement, range.startContainer) ||
    !isNodeInsideEditor(editorElement, range.endContainer)
  ) {
    return null;
  }

  const selectedText = range.toString();

  if (!selectedText.trim()) {
    return null;
  }

  const startRange = document.createRange();
  startRange.selectNodeContents(editorElement);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(editorElement);
  endRange.setEnd(range.endContainer, range.endOffset);

  const start = startRange.toString().length;
  const end = endRange.toString().length;

  if (end <= start) {
    return null;
  }

  return {
    end,
    position: buildPopoverPosition(range.getBoundingClientRect()),
    start,
    text: selectedText,
  };
}

function toDraftSourceSegment(segment: TailorResumeSourceSegment): DraftSourceSegment {
  return {
    isBold: segment.isBold,
    isItalic: segment.isItalic,
    isLinkStyle: segment.isLinkStyle,
    isUnderline: segment.isUnderline,
    linkUrl: segment.linkUrl,
    segmentType: segment.segmentType,
    text: segment.text,
  };
}

function applyLinkRangeToSegments(
  segments: TailorResumeSourceSegment[],
  unitId: string,
  rangeStart: number,
  rangeEnd: number,
  linkUrl: string | null,
) {
  const nextSegments: DraftSourceSegment[] = [];
  let offset = 0;

  for (const segment of segments) {
    const segmentStart = offset;
    const segmentEnd = segmentStart + segment.text.length;
    offset = segmentEnd;

    if (
      segmentEnd <= rangeStart ||
      segmentStart >= rangeEnd ||
      isInlineSeparatorSegment(segment)
    ) {
      nextSegments.push(toDraftSourceSegment(segment));
      continue;
    }

    const localStart = Math.max(0, rangeStart - segmentStart);
    const localEnd = Math.min(segment.text.length, rangeEnd - segmentStart);
    const beforeText = segment.text.slice(0, localStart);
    const linkedText = segment.text.slice(localStart, localEnd);
    const afterText = segment.text.slice(localEnd);

    if (beforeText) {
      nextSegments.push({
        ...toDraftSourceSegment(segment),
        text: beforeText,
      });
    }

    if (linkedText) {
      nextSegments.push({
        ...toDraftSourceSegment(segment),
        isLinkStyle: Boolean(linkUrl),
        isUnderline: Boolean(linkUrl),
        linkUrl,
        text: linkedText,
      });
    }

    if (afterText) {
      nextSegments.push({
        ...toDraftSourceSegment(segment),
        text: afterText,
      });
    }
  }

  return mergeAdjacentSegments(nextSegments, unitId);
}

function splitTextIntoSegments(
  text: string,
  formatting: DraftSourceFormatting,
) {
  if (!text) {
    return [] as DraftSourceSegment[];
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
        segmentType: "text" as const,
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
        segmentType: "text" as const,
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
  segments: DraftSourceSegment[],
  unitId: string,
) {
  const merged: DraftSourceSegment[] = [];

  for (const segment of segments) {
    const previousSegment = merged[merged.length - 1];

    if (
      previousSegment &&
      !isInlineSeparatorText(previousSegment.text) &&
      !isInlineSeparatorText(segment.text) &&
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
  formatting: DraftSourceFormatting,
): DraftSourceSegment[] {
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

function RichTextLineEditor({
  ariaLabel,
  className,
  disabled,
  onChange,
  placeholder,
  unit,
}: RichTextLineEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeLinkEditorTimeoutRef = useRef<number | null>(null);
  const serializedSegments = useMemo(
    () => JSON.stringify(unit.segments),
    [unit.segments],
  );
  const lastAppliedHtmlRef = useRef("");
  const [selectionState, setSelectionState] = useState<LinkActionState | null>(
    null,
  );
  const [linkEditorState, setLinkEditorState] = useState<LinkEditorState | null>(
    null,
  );
  const [linkInputValue, setLinkInputValue] = useState("");
  const [linkInputError, setLinkInputError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (closeLinkEditorTimeoutRef.current !== null) {
        window.clearTimeout(closeLinkEditorTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (!linkEditorState) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [linkEditorState]);

  useEffect(() => {
    if (!selectionState && !linkEditorState) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const targetNode = event.target instanceof Node ? event.target : null;

      if (
        (popoverRef.current && targetNode && popoverRef.current.contains(targetNode)) ||
        (editorRef.current && targetNode && editorRef.current.contains(targetNode))
      ) {
        return;
      }

      setSelectionState(null);
      setLinkEditorState(null);
      setLinkInputError(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setSelectionState(null);
      setLinkEditorState(null);
      setLinkInputError(null);
    }

    function handleViewportChange() {
      setSelectionState(null);
      setLinkEditorState(null);
      setLinkInputError(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [linkEditorState, selectionState]);

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

  function applySegments(nextSegments: TailorResumeSourceSegment[]) {
    const nextHtml = renderSegmentsHtml(nextSegments);

    if (editorRef.current) {
      editorRef.current.innerHTML = nextHtml;
    }

    lastAppliedHtmlRef.current = nextHtml;
    onChange({
      ...unit,
      segments: nextSegments,
    });
  }

  function clearScheduledLinkEditorClose() {
    if (closeLinkEditorTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(closeLinkEditorTimeoutRef.current);
    closeLinkEditorTimeoutRef.current = null;
  }

  function scheduleLinkEditorClose() {
    if (document.activeElement === linkInputRef.current) {
      return;
    }

    clearScheduledLinkEditorClose();
    closeLinkEditorTimeoutRef.current = window.setTimeout(() => {
      setLinkEditorState((currentState) =>
        currentState?.mode === "edit" ? null : currentState,
      );
      closeLinkEditorTimeoutRef.current = null;
    }, 140);
  }

  function readCurrentSegments() {
    return editorRef.current
      ? parseSegmentsFromEditor(editorRef.current, unit.id)
      : unit.segments;
  }

  function refreshSelectionState() {
    if (!editorRef.current || disabled) {
      setSelectionState(null);
      return;
    }

    const nextSelectionState = readSelectionState(editorRef.current);
    setSelectionState(nextSelectionState);
  }

  function openCreateLinkEditor() {
    if (!selectionState || disabled) {
      return;
    }

    const initialUrl = normalizeLinkUrlInput(selectionState.text) ?? "";
    setLinkInputValue(initialUrl);
    setLinkInputError(null);
    setLinkEditorState({
      end: selectionState.end,
      mode: "create",
      position: selectionState.position,
      start: selectionState.start,
      url: initialUrl,
    });
    setSelectionState(null);
  }

  function openEditLinkEditor(anchorElement: HTMLElement) {
    if (disabled) {
      return;
    }

    const start = Number(anchorElement.dataset.linkStart);
    const end = Number(anchorElement.dataset.linkEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }

    clearScheduledLinkEditorClose();
    setLinkInputValue(anchorElement.dataset.linkUrl ?? "");
    setLinkInputError(null);
    setSelectionState(null);
    setLinkEditorState({
      end,
      mode: "edit",
      position: buildPopoverPosition(anchorElement.getBoundingClientRect()),
      start,
      url: anchorElement.dataset.linkUrl ?? "",
    });
  }

  function applyLinkChange(nextLinkUrl: string | null) {
    if (!linkEditorState || disabled) {
      return;
    }

    const nextSegments = applyLinkRangeToSegments(
      readCurrentSegments(),
      unit.id,
      linkEditorState.start,
      linkEditorState.end,
      nextLinkUrl,
    );

    applySegments(nextSegments);
    setLinkEditorState(null);
    setSelectionState(null);
    setLinkInputError(null);
  }

  function submitLinkEditor() {
    const trimmedValue = linkInputValue.trim();

    if (!trimmedValue) {
      applyLinkChange(null);
      return;
    }

    const normalizedLinkUrl = normalizeLinkUrlInput(trimmedValue);

    if (!normalizedLinkUrl) {
      setLinkInputError(
        "Use https://..., mailto:, tel:, a bare domain, or an email address.",
      );
      return;
    }

    applyLinkChange(normalizedLinkUrl);
  }

  const selectionPopover =
    typeof document !== "undefined" && selectionState && !linkEditorState
    ? createPortal(
        <div
          className="fixed z-[70] -translate-x-1/2"
          style={{
            left: selectionState.position.left,
            top: selectionState.position.top,
          }}
        >
          <button
            className="rounded-full border border-sky-300/20 bg-zinc-950/96 px-3 py-1.5 text-xs font-medium text-sky-100 shadow-[0_18px_40px_rgba(0,0,0,0.38)] transition hover:border-sky-200/35 hover:bg-zinc-900"
            onClick={openCreateLinkEditor}
            type="button"
          >
            Add link
          </button>
        </div>,
        document.body,
      )
    : null;

  const linkEditorPopover =
    typeof document !== "undefined" && linkEditorState
    ? createPortal(
        <div
          className="fixed z-[70] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2"
          onMouseEnter={clearScheduledLinkEditorClose}
          onMouseLeave={() => {
            if (linkEditorState.mode === "edit") {
              scheduleLinkEditorClose();
            }
          }}
          ref={popoverRef}
          style={{
            left: linkEditorState.position.left,
            top: linkEditorState.position.top,
          }}
        >
          <div className="rounded-[1.1rem] border border-sky-300/20 bg-zinc-950/98 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {linkEditorState.mode === "edit" ? "Edit link" : "Add link"}
            </p>
            <input
              className="mt-2 w-full rounded-[0.95rem] border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35 focus:bg-black/40"
              onChange={(event) => {
                setLinkInputValue(event.target.value);
                if (linkInputError) {
                  setLinkInputError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitLinkEditor();
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setLinkEditorState(null);
                  setLinkInputError(null);
                }
              }}
              placeholder="https://example.com"
              ref={linkInputRef}
              spellCheck={false}
              type="text"
              value={linkInputValue}
            />
            {linkInputError ? (
              <p className="mt-2 text-xs leading-5 text-rose-300">
                {linkInputError}
              </p>
            ) : (
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Bare domains become `https://` links, and emails become `mailto:`.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:border-sky-200/35 hover:bg-sky-400/15"
                  onClick={submitLinkEditor}
                  type="button"
                >
                  Save link
                </button>
                <button
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08]"
                  onClick={() => {
                    setLinkEditorState(null);
                    setLinkInputError(null);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>

              {linkEditorState.mode === "edit" ? (
                <button
                  className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:border-rose-200/35 hover:bg-rose-400/15"
                  onClick={() => applyLinkChange(null)}
                  type="button"
                >
                  Remove link
                </button>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  function queueSelectionRefresh() {
    window.setTimeout(() => {
      refreshSelectionState();
    }, 0);
  }

  return (
    <div className="grid gap-2">
      <div
        aria-label={ariaLabel}
        className={classNames(
          "min-h-[2.7rem] rounded-[1.05rem] border border-white/8 bg-black/25 px-3.5 py-2.5 text-sm leading-6 text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition empty:before:pointer-events-none empty:before:text-zinc-500/85 empty:before:content-[attr(data-placeholder)] focus:border-emerald-300/35 focus:bg-black/35",
          className,
          disabled && "cursor-not-allowed opacity-70",
        )}
        contentEditable={!disabled}
        data-placeholder={placeholder ?? ""}
        onBlur={emitChangeFromDom}
        onClick={(event) => {
          const anchorElement =
            event.target instanceof Element
              ? event.target.closest("a[data-link-style='true']")
              : null;

          if (anchorElement) {
            event.preventDefault();
          }
        }}
        onInput={() => {
          emitChangeFromDom();
          setSelectionState(null);
          setLinkEditorState(null);
          setLinkInputError(null);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (selectionState) {
              openCreateLinkEditor();
            }
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
        onKeyUp={queueSelectionRefresh}
        onMouseOut={(event) => {
          const currentAnchor =
            event.target instanceof Element
              ? event.target.closest("a[data-link-style='true']")
              : null;
          const relatedAnchor =
            event.relatedTarget instanceof Element
              ? event.relatedTarget.closest("a[data-link-style='true']")
              : null;

          if (currentAnchor && currentAnchor !== relatedAnchor) {
            scheduleLinkEditorClose();
          }
        }}
        onMouseOver={(event) => {
          const selection = window.getSelection();

          if (selection && !selection.isCollapsed) {
            return;
          }

          const anchorElement =
            event.target instanceof Element
              ? event.target.closest("a[data-link-style='true']")
              : null;

          if (
            anchorElement instanceof HTMLElement &&
            editorRef.current?.contains(anchorElement)
          ) {
            openEditLinkEditor(anchorElement);
          }
        }}
        onMouseUp={queueSelectionRefresh}
        ref={editorRef}
        role="textbox"
        spellCheck={false}
        suppressContentEditableWarning
      />
      {selectionPopover}
      {linkEditorPopover}
    </div>
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
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:border-white/8 disabled:text-zinc-600"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function AddMenu({
  align = "left",
  buttonLabel,
  disabled,
  items,
}: {
  align?: "left" | "right";
  buttonLabel: string;
  disabled?: boolean;
  items: AddMenuOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={classNames(
        "relative inline-flex",
        align === "right" && "justify-end",
      )}
      ref={rootRef}
    >
      <button
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:border-white/8 disabled:text-zinc-600"
        disabled={disabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        <Plus className="size-3.5" />
        {buttonLabel}
      </button>

      {isOpen ? (
        <div
          className={classNames(
            "absolute top-[calc(100%+0.65rem)] z-20 min-w-[220px] rounded-[1.1rem] border border-white/12 bg-zinc-950/98 p-2 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="grid gap-1">
            {items.map((item) => (
              <button
                className="rounded-[0.9rem] px-3 py-2 text-left transition hover:bg-white/[0.05]"
                key={item.label}
                onClick={() => {
                  item.onSelect();
                  setIsOpen(false);
                }}
                type="button"
              >
                <p className="text-sm font-medium text-zinc-100">{item.label}</p>
                {item.description ? (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    {item.description}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[1.65rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:p-4">
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function ScratchBlock({
  actions,
  children,
  tone = "neutral",
}: {
  actions?: ReactNode;
  children: ReactNode;
  tone?: "blue" | "gold" | "neutral";
}) {
  const toneClassName =
    tone === "blue"
      ? "border-sky-400/12 bg-[linear-gradient(180deg,rgba(56,189,248,0.08),rgba(255,255,255,0.02))]"
      : tone === "gold"
        ? "border-amber-300/12 bg-[linear-gradient(180deg,rgba(251,191,36,0.08),rgba(255,255,255,0.02))]"
        : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]";

  return (
    <div
      className={classNames(
        "rounded-[1.45rem] border p-3 shadow-[0_14px_30px_rgba(0,0,0,0.2)] sm:p-3.5",
        toneClassName,
      )}
    >
      {actions ? (
        <div className="mb-2 flex items-center justify-end gap-2">{actions}</div>
      ) : null}
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

function HoleEditor({
  ariaLabel,
  className,
  disabled,
  onChange,
  placeholder,
  unit,
}: RichTextLineEditorProps) {
  return (
    <RichTextLineEditor
      ariaLabel={ariaLabel}
      className={classNames(
        "min-h-[2.45rem] rounded-[1rem] border-black/10 bg-black/30 px-3.5 py-2.5 text-sm leading-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus:border-white/16 focus:bg-black/38",
        className,
      )}
      disabled={disabled}
      onChange={onChange}
      placeholder={placeholder}
      unit={unit}
    />
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
      if (draft.headerText.id === nextUnit.id) {
        draft.headerText = nextUnit;
        return;
      }

      const headerLineIndex = draft.subHeadLines.findIndex(
        (line) => line.id === nextUnit.id,
      );

      if (headerLineIndex !== -1) {
        draft.subHeadLines[headerLineIndex] = nextUnit;
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

            if (item.description?.id === nextUnit.id) {
              item.description = nextUnit;
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
      draft.subHeadLines = draft.subHeadLines.filter((line) => line.id !== lineId);
    });
  }

  function addHeaderLine() {
    updateDocument((draft) => {
      draft.subHeadLines.push(
        createEmptySourceUnit(createId("sub_head_line"), "sub_head_line"),
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

  function addEntryDescription(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem || targetItem.description) {
        return;
      }

      targetItem.description = createEmptySourceUnit(
        createId(`${itemId}_description`),
        "entry_description",
      );
    });
  }

  function removeEntryDescription(sectionId: string, itemId: string) {
    updateDocument((draft) => {
      const targetSection = draft.sections.find((section) => section.id === sectionId);
      const targetItem = targetSection?.items.find(
        (item): item is TailorResumeSourceEntryItem =>
          item.itemType === "entry" && item.id === itemId,
      );

      if (!targetItem) {
        return;
      }

      targetItem.description = null;
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
    <div className="space-y-4">
      <SectionCard>
        <div className="grid gap-3">
          <RichTextLineEditor
            ariaLabel="Header text"
            className="min-h-[3.3rem] border-transparent bg-transparent px-0 py-0 text-[clamp(1.7rem,2.6vw,2.45rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-zinc-50 shadow-none focus:border-transparent focus:bg-transparent"
            disabled={disabled}
            onChange={replaceUnit}
            placeholder="Resume title"
            unit={value.headerText}
          />

          <div className="grid gap-2">
            {value.subHeadLines.map((line, index) => (
              <div
                className="flex items-start gap-2 rounded-[1.1rem] border border-white/8 bg-black/15 p-2.5"
                key={line.id}
              >
                <div className="min-w-0 flex-1">
                  <RichTextLineEditor
                    ariaLabel={`Subhead line ${index + 1}`}
                    className="min-h-[2rem] border-transparent bg-transparent px-0 py-0 text-sm text-zinc-300 shadow-none focus:border-transparent focus:bg-transparent"
                    disabled={disabled}
                    onChange={replaceUnit}
                    placeholder="Add a subhead line"
                    unit={line}
                  />
                </div>

                {value.subHeadLines.length > 1 ? (
                  <SubtleButton
                    disabled={disabled}
                    onClick={() => removeHeaderLine(line.id)}
                  >
                    <X className="size-3.5" />
                    Remove
                  </SubtleButton>
                ) : null}
              </div>
            ))}
          </div>

          <div>
            <AddMenu
              buttonLabel="Add line"
              disabled={disabled}
              items={[
                {
                  description: "Add another compact line below the title.",
                  label: "Subhead line",
                  onSelect: addHeaderLine,
                },
              ]}
            />
          </div>
        </div>
      </SectionCard>

      {value.sections.map((section, sectionIndex) => (
        <SectionCard key={section.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 inline-flex rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-zinc-400">
                Section {sectionIndex + 1}
              </div>
              <RichTextLineEditor
                ariaLabel={`Section ${sectionIndex + 1} title`}
                className="min-h-[2.8rem] rounded-[1.2rem] border-white/8 bg-black/20 text-lg font-semibold tracking-[-0.01em] text-zinc-50 focus:border-white/14"
                disabled={disabled}
                onChange={replaceUnit}
                placeholder="Section title"
                unit={section.title}
              />
            </div>
          </div>

          <div className="grid gap-2.5">
            {section.items.map((item, itemIndex) => (
              <ScratchBlock
                actions={
                  <SubtleButton
                    disabled={disabled}
                    onClick={() => removeItem(section.id, item.id)}
                  >
                    <X className="size-3.5" />
                    Remove
                  </SubtleButton>
                }
                key={item.id}
                tone={
                  item.itemType === "entry"
                    ? "gold"
                    : item.itemType === "labeled_line"
                      ? "blue"
                      : "neutral"
                }
              >
                {item.itemType === "entry" ? (
                  <>
                    <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,210px)]">
                      <HoleEditor
                        ariaLabel={`Entry heading ${itemIndex + 1}`}
                        className="text-[15px] font-medium"
                        disabled={disabled}
                        onChange={replaceUnit}
                        placeholder="Company | Title"
                        unit={item.heading}
                      />

                      {item.dates ? (
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <HoleEditor
                              ariaLabel={`Entry dates ${itemIndex + 1}`}
                              className="text-zinc-300 xl:text-right"
                              disabled={disabled}
                              onChange={replaceUnit}
                              placeholder="Dates"
                              unit={item.dates}
                            />
                          </div>
                          <SubtleButton
                            disabled={disabled}
                            onClick={() => clearEntryDates(section.id, item.id)}
                          >
                            <X className="size-3.5" />
                          </SubtleButton>
                        </div>
                      ) : null}
                    </div>

                    {item.description ? (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <HoleEditor
                            ariaLabel="Entry description"
                            className="text-zinc-200"
                            disabled={disabled}
                            onChange={replaceUnit}
                            placeholder="Add a short description"
                            unit={item.description}
                          />
                        </div>
                        <SubtleButton
                          disabled={disabled}
                          onClick={() => removeEntryDescription(section.id, item.id)}
                        >
                          <X className="size-3.5" />
                        </SubtleButton>
                      </div>
                    ) : null}

                    {item.bulletLines.length > 0 ? (
                      <div className="grid gap-2.5">
                        {item.bulletLines.map((line) => (
                          <div
                            className="flex items-start gap-2.5"
                            key={line.id}
                          >
                            <span className="mt-4 h-2 w-2 rounded-full bg-amber-200/75" />
                            <div className="min-w-0 flex-1">
                              <HoleEditor
                                ariaLabel="Entry bullet line"
                                disabled={disabled}
                                onChange={replaceUnit}
                                placeholder="Bullet point"
                                unit={line}
                              />
                            </div>
                            <SubtleButton
                              disabled={disabled}
                              onClick={() =>
                                removeEntryBulletLine(section.id, item.id, line.id)
                              }
                            >
                              <X className="size-3.5" />
                            </SubtleButton>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="pt-0.5">
                      <AddMenu
                        buttonLabel="Add to block"
                        disabled={disabled}
                        items={[
                          ...(!item.dates
                            ? [
                                {
                                  description:
                                    "Add the compact date range on the right side.",
                                  label: "Dates",
                                  onSelect: () => addEntryDates(section.id, item.id),
                                },
                              ]
                            : []),
                          ...(!item.description
                            ? [
                                {
                                  description:
                                    "Add a one-line description below the heading.",
                                  label: "Description",
                                  onSelect: () =>
                                    addEntryDescription(section.id, item.id),
                                },
                              ]
                            : []),
                          {
                            description: "Add another bullet line inside this block.",
                            label: "Bullet line",
                            onSelect: () => addEntryBulletLine(section.id, item.id),
                          },
                        ]}
                      />
                    </div>
                  </>
                ) : item.itemType === "labeled_line" ? (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_auto_minmax(0,1fr)] md:items-center">
                    <HoleEditor
                      ariaLabel={`Label ${itemIndex + 1}`}
                      className="font-medium text-zinc-100"
                      disabled={disabled}
                      onChange={replaceUnit}
                      placeholder="Label"
                      unit={item.label}
                    />
                    <div className="hidden text-sm text-zinc-500 md:block">:</div>
                    <HoleEditor
                      ariaLabel={`Value ${itemIndex + 1}`}
                      disabled={disabled}
                      onChange={replaceUnit}
                      placeholder="Value"
                      unit={item.value}
                    />
                  </div>
                ) : (
                  <HoleEditor
                    ariaLabel={`Paragraph ${itemIndex + 1}`}
                    className="text-zinc-100"
                    disabled={disabled}
                    onChange={replaceUnit}
                    placeholder="Paragraph line"
                    unit={item.content}
                  />
                )}
              </ScratchBlock>
            ))}
          </div>

          <div className="pt-1">
            <AddMenu
              buttonLabel="Add block"
              disabled={disabled}
              items={[
                {
                  description: "Add a heading with optional dates, description, and bullets.",
                  label: "Entry",
                  onSelect: () => addItem(section.id, createEntryItem(section.id)),
                },
                {
                  description: "Add a freeform paragraph line.",
                  label: "Paragraph",
                  onSelect: () =>
                    addItem(section.id, createParagraphItem(section.id)),
                },
                {
                  description: "Add a compact label-and-value row.",
                  label: "Labeled line",
                  onSelect: () =>
                    addItem(section.id, createLabeledLineItem(section.id)),
                },
              ]}
            />
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
