import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTailoredResumeDiffRows,
  formatTailoredResumeEditLabel,
  type TailoredResumeDiffSegment,
} from "../../lib/tailor-resume-review.ts";
import type {
  TailoredResumeReviewEdit,
  TailoredResumeReviewRecord,
} from "../../lib/tailored-resume-review-record.ts";

type TailoredResumeQuickReviewProps = {
  error: string | null;
  isUpdating: boolean;
  onFocusEdit?: (editId: string) => void;
  record: TailoredResumeReviewRecord;
  variant?: "card" | "embedded" | "fullscreen";
  onSetEditState: (
    editId: string,
    nextState: TailoredResumeReviewEdit["state"],
  ) => void;
  onSaveUserEdit: (editId: string, latexCode: string) => Promise<boolean>;
};

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function RevertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 1 1-4.8 9.6" />
    </svg>
  );
}

function DiffCell({
  lineNumber,
  segments,
  text,
  tone,
}: {
  lineNumber: number | null;
  segments?: TailoredResumeDiffSegment[];
  text: string | null;
  tone: "added" | "context" | "modified" | "removed";
}) {
  return (
    <div className={`quick-review-diff-line quick-review-diff-line-${tone}`}>
      <div className="quick-review-diff-gutter">{lineNumber ?? ""}</div>
      <pre className="quick-review-diff-code">
        {segments && segments.length > 0
          ? segments.map((segment, index) => {
              const segmentClassName =
                segment.type === "added"
                  ? "quick-review-segment-added"
                  : segment.type === "removed"
                    ? "quick-review-segment-removed"
                    : segment.type === "context"
                      ? ""
                      : "";

              return (
                <span className={segmentClassName} key={`${segment.type}-${index}`}>
                  {segment.text}
                </span>
              );
            })
          : (text ?? " ")}
      </pre>
    </div>
  );
}

function QuickReviewEditCard({
  edit,
  isUpdating,
  onFocusEdit,
  onSaveUserEdit,
  onSetEditState,
}: {
  edit: TailoredResumeReviewEdit;
  isUpdating: boolean;
  onFocusEdit?: TailoredResumeQuickReviewProps["onFocusEdit"];
  onSaveUserEdit: TailoredResumeQuickReviewProps["onSaveUserEdit"];
  onSetEditState: TailoredResumeQuickReviewProps["onSetEditState"];
}) {
  const proposedLatexCode = edit.customLatexCode ?? edit.afterLatexCode;
  const [isEditingLatex, setIsEditingLatex] = useState(false);
  const [draftLatexCode, setDraftLatexCode] = useState(proposedLatexCode);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const diffRows = useMemo(
    () => buildTailoredResumeDiffRows(edit.beforeLatexCode, proposedLatexCode),
    [edit.beforeLatexCode, proposedLatexCode],
  );
  const isCustomOverride = edit.customLatexCode !== null;
  const isSelectionLocked = isUpdating || isCustomOverride || isEditingLatex;

  function resizeDraftTextarea() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const borderHeight = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
  }

  useEffect(() => {
    if (isEditingLatex) {
      textareaRef.current?.focus();
      resizeDraftTextarea();
    }
  }, [isEditingLatex]);

  useEffect(() => {
    if (isEditingLatex) {
      resizeDraftTextarea();
    }
  }, [draftLatexCode, isEditingLatex]);

  function handleSurfaceSelect(nextState: TailoredResumeReviewEdit["state"]) {
    onFocusEdit?.(edit.editId);

    if (isSelectionLocked) {
      return;
    }

    onSetEditState(edit.editId, nextState);
  }

  function startEditingLatex() {
    if (isUpdating) {
      return;
    }

    onFocusEdit?.(edit.editId);
    setDraftLatexCode(proposedLatexCode);
    setIsEditingLatex(true);
  }

  function cancelEditingLatex() {
    setDraftLatexCode(proposedLatexCode);
    setIsEditingLatex(false);
  }

  function revertToModelSuggestion() {
    setDraftLatexCode(edit.afterLatexCode);
    textareaRef.current?.focus();
  }

  async function saveEditingLatex() {
    if (isUpdating) {
      return;
    }

    const wasSaved = await onSaveUserEdit(edit.editId, draftLatexCode);

    if (wasSaved) {
      setIsEditingLatex(false);
    }
  }

  return (
    <article className="quick-review-edit-card">
      <button
        className="quick-review-edit-header quick-review-edit-focus-action"
        type="button"
        title="Jump to this block in the preview"
        onClick={() => onFocusEdit?.(edit.editId)}
      >
        <span className="quick-review-edit-copy">
          <span className="quick-review-edit-title-row">
            <span className="quick-review-edit-title">
              {formatTailoredResumeEditLabel(edit)}
            </span>
          </span>
        </span>
      </button>

      {isCustomOverride && !isEditingLatex ? (
        <p className="quick-review-custom-note">
          This block has a custom edit.
        </p>
      ) : null}

      <div className="quick-review-diff-grid">
        <button
          aria-disabled={isSelectionLocked}
          aria-pressed={edit.state === "rejected"}
          className={`quick-review-diff-surface ${
            edit.state === "rejected" ? "quick-review-diff-surface-selected" : ""
          } ${isSelectionLocked ? "quick-review-diff-surface-inert" : ""}`}
          title={isCustomOverride ? "Use the pencil to revise this custom edit." : undefined}
          type="button"
          onClick={() => handleSurfaceSelect("rejected")}
        >
          <div className="quick-review-diff-heading">Original block</div>
          <div className="quick-review-diff-body">
            {diffRows.length > 0 ? (
              diffRows.map((row, index) => (
                <DiffCell
                  key={`original-${edit.editId}-${index}`}
                  lineNumber={row.originalLineNumber}
                  segments={row.originalSegments}
                  text={row.originalText}
                  tone={
                    row.type === "removed"
                      ? "removed"
                      : row.type === "modified"
                        ? "modified"
                        : "context"
                  }
                />
              ))
            ) : (
              <p className="quick-review-placeholder">
                No visible line changes were recorded for this block.
              </p>
            )}
          </div>
        </button>

        <div
          aria-disabled={isSelectionLocked}
          className={`quick-review-diff-surface ${
            edit.state === "applied" ? "quick-review-diff-surface-selected" : ""
          } ${isSelectionLocked ? "quick-review-diff-surface-inert" : ""}`}
        >
          <div className="quick-review-diff-heading-row">
            <button
              aria-pressed={edit.state === "applied"}
              className="quick-review-diff-heading quick-review-diff-heading-action"
              disabled={isSelectionLocked}
              type="button"
              onClick={() => handleSurfaceSelect("applied")}
            >
              Tailored block
            </button>
            {isEditingLatex ? (
              <div className="quick-review-inline-editor-actions">
                <button
                  aria-label="Revert to model suggestion"
                  className="quick-review-inline-editor-icon-action"
                  disabled={isUpdating || draftLatexCode === edit.afterLatexCode}
                  title="Revert to the model suggestion"
                  type="button"
                  onClick={revertToModelSuggestion}
                >
                  <RevertIcon />
                </button>
                <button
                  className="quick-review-inline-editor-cancel"
                  disabled={isUpdating}
                  type="button"
                  onClick={cancelEditingLatex}
                >
                  Cancel
                </button>
                <button
                  className="quick-review-inline-editor-done"
                  disabled={isUpdating}
                  type="button"
                  onClick={() => void saveEditingLatex()}
                >
                  {isUpdating ? "Saving" : "Done"}
                </button>
              </div>
            ) : (
              <button
                aria-label="Edit tailored block"
                className="quick-review-edit-latex-action"
                disabled={isUpdating}
                title="Edit tailored block"
                type="button"
                onClick={startEditingLatex}
              >
                <PencilIcon />
              </button>
            )}
          </div>
          {isEditingLatex ? (
            <div className="quick-review-inline-editor">
              <textarea
                ref={textareaRef}
                spellCheck={false}
                value={draftLatexCode}
                onChange={(event) => {
                  setDraftLatexCode(event.target.value);
                  window.requestAnimationFrame(resizeDraftTextarea);
                }}
              />
            </div>
          ) : (
            <button
              aria-pressed={edit.state === "applied"}
              className="quick-review-diff-body quick-review-diff-body-action"
              disabled={isSelectionLocked}
              type="button"
              onClick={() => handleSurfaceSelect("applied")}
            >
              {diffRows.length > 0 ? (
                diffRows.map((row, index) => (
                  <DiffCell
                    key={`tailored-${edit.editId}-${index}`}
                    lineNumber={row.modifiedLineNumber}
                    segments={row.modifiedSegments}
                    text={row.modifiedText}
                    tone={
                      row.type === "added"
                        ? "added"
                        : row.type === "modified"
                          ? "modified"
                          : "context"
                    }
                  />
                ))
              ) : (
                <p className="quick-review-placeholder">
                  No tailored block preview is available yet.
                </p>
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function TailoredResumeQuickReview({
  error,
  isUpdating,
  onFocusEdit,
  onSaveUserEdit,
  record,
  variant = "card",
  onSetEditState,
}: TailoredResumeQuickReviewProps) {
  const acceptedEditCount = record.edits.filter((edit) => edit.state === "applied").length;
  const showIntro = variant === "card" || variant === "embedded";

  return (
    <section
      className={`quick-review-panel ${
        variant === "embedded" || variant === "fullscreen"
          ? "quick-review-panel-embedded"
          : ""
      }`}
    >
      {showIntro ? (
        <>
          <div className="card-heading-row">
            <h3>Quick review</h3>
            <span>
              {record.edits.length > 0
                ? `${acceptedEditCount}/${record.edits.length}`
                : "0"}
            </span>
          </div>
          <p className="quick-review-copy">
            Keep or reject each tailored block here, then open the full review if you
            want detailed PDF and LaTeX controls.
          </p>
        </>
      ) : null}

      {error ? <p className="quick-review-error">{error}</p> : null}

      {record.edits.length > 0 ? (
        <div className="quick-review-list">
          {record.edits.map((edit) => (
            <QuickReviewEditCard
              edit={edit}
              isUpdating={isUpdating}
              onFocusEdit={onFocusEdit}
              onSaveUserEdit={onSaveUserEdit}
              key={edit.editId}
              onSetEditState={onSetEditState}
            />
          ))}
        </div>
      ) : (
        <p className="quick-review-placeholder quick-review-panel-placeholder">
          This draft does not have any block-level edits to review.
        </p>
      )}
    </section>
  );
}
