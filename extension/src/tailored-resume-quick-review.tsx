import { useMemo } from "react";
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
};

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
  onSetEditState,
}: {
  edit: TailoredResumeReviewEdit;
  isUpdating: boolean;
  onFocusEdit?: TailoredResumeQuickReviewProps["onFocusEdit"];
  onSetEditState: TailoredResumeQuickReviewProps["onSetEditState"];
}) {
  const proposedLatexCode = edit.customLatexCode ?? edit.afterLatexCode;
  const diffRows = useMemo(
    () => buildTailoredResumeDiffRows(edit.beforeLatexCode, proposedLatexCode),
    [edit.beforeLatexCode, proposedLatexCode],
  );
  const isCustomOverride = edit.customLatexCode !== null;
  const isInteractionLocked = isUpdating || isCustomOverride;

  function handleSurfaceSelect(nextState: TailoredResumeReviewEdit["state"]) {
    onFocusEdit?.(edit.editId);

    if (isInteractionLocked) {
      return;
    }

    onSetEditState(edit.editId, nextState);
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

      {isCustomOverride ? (
        <p className="quick-review-custom-note">
          This block has a custom edit from the web app. Review it there to avoid
          overwriting that manual change.
        </p>
      ) : null}

      <div className="quick-review-diff-grid">
        <button
          aria-disabled={isInteractionLocked}
          aria-pressed={edit.state === "rejected"}
          className={`quick-review-diff-surface ${
            edit.state === "rejected" ? "quick-review-diff-surface-selected" : ""
          } ${isInteractionLocked ? "quick-review-diff-surface-inert" : ""}`}
          title={isCustomOverride ? "Review custom edits in the web app." : undefined}
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

        <button
          aria-disabled={isInteractionLocked}
          aria-pressed={edit.state === "applied"}
          className={`quick-review-diff-surface ${
            edit.state === "applied" ? "quick-review-diff-surface-selected" : ""
          } ${isInteractionLocked ? "quick-review-diff-surface-inert" : ""}`}
          title={isCustomOverride ? "Review custom edits in the web app." : undefined}
          type="button"
          onClick={() => handleSurfaceSelect("applied")}
        >
          <div className="quick-review-diff-heading">Tailored block</div>
          <div className="quick-review-diff-body">
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
          </div>
        </button>
      </div>
    </article>
  );
}

export default function TailoredResumeQuickReview({
  error,
  isUpdating,
  onFocusEdit,
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
