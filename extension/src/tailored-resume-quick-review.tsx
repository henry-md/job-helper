import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildTailoredResumeSnapshotComparisonEdits } from "../../lib/tailor-resume-edit-history.ts";
import {
  buildTailoredResumeDiffRows,
  formatTailoredResumeEditLabel,
  type TailoredResumeDiffSegment,
} from "../../lib/tailor-resume-review.ts";
import type {
  TailoredResumeReviewEdit,
  TailoredResumeReviewRecord,
  TailoredResumeReviewVersion,
} from "../../lib/tailored-resume-review-record.ts";

type TailoredResumeDiffEndpoint = {
  annotatedLatexCode: string;
  id: string;
  label: string;
  outputIndex: number | null;
  version: TailoredResumeReviewVersion | null;
};

type TailoredResumeAiChatMessage = {
  comparison?: {
    endVersionId: string;
    startVersionId: string;
  };
  id: string;
  role: "assistant" | "user";
  status: "error" | "ready" | "streaming";
  text: string;
};

type TailoredResumeQuickReviewProps = {
  error: string | null;
  isUpdating: boolean;
  actionPortalTarget?: HTMLElement | null;
  chatPortalTarget?: HTMLElement | null;
  onFocusEdit?: (editId: string) => void;
  record: TailoredResumeReviewRecord;
  variant?: "card" | "embedded" | "fullscreen";
  onDeleteVersion?: (versionId: string) => Promise<boolean>;
  onRefineWithChat?: (
    prompt: string,
    handlers?: {
      onTextDelta?: (delta: string) => void;
      onTextStart?: () => void;
    },
  ) => Promise<{
    comparison?: {
      endVersionId: string;
      startVersionId: string;
    };
    message: string;
  } | null>;
  onSetEditState: (
    editId: string,
    nextState: TailoredResumeReviewEdit["state"],
  ) => void;
  onCancelUserEditDraft?: (editId: string) => void;
  onSaveUserEdit: (editId: string, latexCode: string) => Promise<boolean>;
  openEditingEditId?: string | null;
  openEditRequest?: number;
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

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 18h10l1-18" />
    </svg>
  );
}

function createChatMessage(
  input: Omit<TailoredResumeAiChatMessage, "id">,
): TailoredResumeAiChatMessage {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tailored-resume-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    ...input,
  };
}

function buildInitialChatMessages(record: TailoredResumeReviewRecord) {
  if (record.reviewChatMessages.length > 0) {
    return record.reviewChatMessages.map((message) => ({
      id: message.id,
      role: message.role,
      status: "ready" as const,
      text: message.content,
    }));
  }

  return record.versions.flatMap((version) => {
    const messages: TailoredResumeAiChatMessage[] = [];

    if (version.userPrompt?.trim()) {
      messages.push({
        id: `${version.id}:user`,
        role: "user",
        status: "ready",
        text: version.userPrompt.trim(),
      });
    }

    if (version.assistantMessage?.trim()) {
      messages.push({
        id: `${version.id}:assistant`,
        role: "assistant",
        status: "ready",
        text: version.assistantMessage.trim(),
      });
    }

    return messages;
  });
}

function formatOutputTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildDiffEndpoints(record: TailoredResumeReviewRecord) {
  const endpoints: TailoredResumeDiffEndpoint[] = [];

  if (record.sourceAnnotatedLatexCode?.trim()) {
    endpoints.push({
      annotatedLatexCode: record.sourceAnnotatedLatexCode,
      id: "base",
      label: "Base",
      outputIndex: null,
      version: null,
    });
  }

  if (record.versions.length > 0) {
    record.versions.forEach((version, index) => {
      endpoints.push({
        annotatedLatexCode: version.annotatedLatexCode,
        id: version.id,
        label: `Output ${index + 1}`,
        outputIndex: index + 1,
        version,
      });
    });
  } else if (record.annotatedLatexCode?.trim()) {
    endpoints.push({
      annotatedLatexCode: record.annotatedLatexCode,
      id: "current",
      label: "Output 1",
      outputIndex: 1,
      version: null,
    });
  }

  return endpoints;
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
  readOnly = false,
  startLabel = "Original block",
  endLabel = "Tailored block",
  onCancelUserEditDraft,
  onFocusEdit,
  openEditRequest = 0,
  openEditingEditId = null,
  onSaveUserEdit,
  onSetEditState,
}: {
  edit: TailoredResumeReviewEdit;
  isUpdating: boolean;
  readOnly?: boolean;
  startLabel?: string;
  endLabel?: string;
  onCancelUserEditDraft?: TailoredResumeQuickReviewProps["onCancelUserEditDraft"];
  onFocusEdit?: TailoredResumeQuickReviewProps["onFocusEdit"];
  openEditRequest?: number;
  openEditingEditId?: string | null;
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
  const isUserEdit = edit.source === "user";
  const isSelectionLocked =
    readOnly || isUpdating || isCustomOverride || isUserEdit || isEditingLatex;

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
    if (openEditingEditId !== edit.editId || openEditRequest <= 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setDraftLatexCode(isUserEdit ? edit.beforeLatexCode : proposedLatexCode);
      setIsEditingLatex(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    edit.beforeLatexCode,
    edit.editId,
    isUserEdit,
    openEditRequest,
    openEditingEditId,
    proposedLatexCode,
  ]);

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
    if (readOnly || isUpdating) {
      return;
    }

    onFocusEdit?.(edit.editId);
    setDraftLatexCode(isUserEdit ? edit.beforeLatexCode : proposedLatexCode);
    setIsEditingLatex(true);
  }

  function cancelEditingLatex() {
    setDraftLatexCode(isUserEdit ? edit.beforeLatexCode : proposedLatexCode);
    setIsEditingLatex(false);

    if (isUserEdit) {
      onCancelUserEditDraft?.(edit.editId);
    }
  }

  function revertToModelSuggestion() {
    setDraftLatexCode(isUserEdit ? edit.beforeLatexCode : edit.afterLatexCode);
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
    <article className="quick-review-edit-card" data-quick-review-edit-id={edit.editId}>
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

      {(isCustomOverride || isUserEdit) && !isEditingLatex ? (
        <p className="quick-review-custom-note">
          {isUserEdit ? "User edit" : "This block has a custom edit."}
        </p>
      ) : null}

      <div className="quick-review-diff-grid">
        <button
          aria-disabled={isSelectionLocked}
          aria-pressed={readOnly ? undefined : edit.state === "rejected"}
          className={`quick-review-diff-surface ${
            !readOnly && edit.state === "rejected"
              ? "quick-review-diff-surface-selected"
              : ""
          } ${isSelectionLocked ? "quick-review-diff-surface-inert" : ""}`}
          title={isCustomOverride ? "Use the pencil to revise this custom edit." : undefined}
          type="button"
          onClick={() => handleSurfaceSelect("rejected")}
        >
          <div className="quick-review-diff-heading">{startLabel}</div>
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
            !readOnly && edit.state === "applied"
              ? "quick-review-diff-surface-selected"
              : ""
          } ${isSelectionLocked ? "quick-review-diff-surface-inert" : ""}`}
        >
          <div
            className={`quick-review-diff-heading-row ${
              isEditingLatex ? "quick-review-diff-heading-row-editing" : ""
            }`}
          >
            {isEditingLatex ? null : (
              <button
                aria-pressed={readOnly ? undefined : edit.state === "applied"}
                className="quick-review-diff-heading quick-review-diff-heading-action"
                disabled={isSelectionLocked}
                type="button"
                onClick={() => handleSurfaceSelect("applied")}
              >
                {endLabel}
              </button>
            )}
            {isEditingLatex ? (
              <div className="quick-review-inline-editor-actions">
                <button
                  aria-label="Revert to model suggestion"
                  className="quick-review-inline-editor-icon-action"
                  disabled={
                    isUpdating ||
                    draftLatexCode ===
                      (isUserEdit ? edit.beforeLatexCode : edit.afterLatexCode)
                  }
                  title={
                    isUserEdit
                      ? "Reset to the original block"
                      : "Revert to the model suggestion"
                  }
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
                  disabled={
                    isUpdating ||
                    draftLatexCode.replace(/\n+$/, "") ===
                      (isUserEdit
                        ? edit.beforeLatexCode
                        : proposedLatexCode
                      ).replace(/\n+$/, "")
                  }
                  type="button"
                  onClick={() => void saveEditingLatex()}
                >
                  {isUpdating ? "Saving" : "Done"}
                </button>
              </div>
            ) : readOnly ? null : (
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
              aria-pressed={readOnly ? undefined : edit.state === "applied"}
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
  actionPortalTarget,
  chatPortalTarget,
  onDeleteVersion,
  onCancelUserEditDraft,
  onFocusEdit,
  openEditRequest = 0,
  openEditingEditId = null,
  onRefineWithChat,
  onSaveUserEdit,
  record,
  variant = "card",
  onSetEditState,
}: TailoredResumeQuickReviewProps) {
  const [isDiffMenuOpen, setIsDiffMenuOpen] = useState(false);
  const [diffStartId, setDiffStartId] = useState<string | null>(null);
  const [diffEndId, setDiffEndId] = useState<string | null>(null);
  const [isDeletingVersionId, setIsDeletingVersionId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<TailoredResumeAiChatMessage[]>(
    () => buildInitialChatMessages(record),
  );
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const hydratedChatRecordIdRef = useRef(record.id);
  const acceptedEditCount = record.edits.filter((edit) => edit.state === "applied").length;
  const showIntro = variant === "card" || variant === "embedded";
  const diffEndpoints = useMemo(() => buildDiffEndpoints(record), [record]);
  const diffStart = diffEndpoints.find((endpoint) => endpoint.id === diffStartId) ?? null;
  const diffEnd = diffEndpoints.find((endpoint) => endpoint.id === diffEndId) ?? null;
  const isDiffMode = Boolean(diffStart && diffEnd && diffStart.id !== diffEnd.id);
  const diffComparisonEdits = useMemo(() => {
    if (!diffStart || !diffEnd || diffStart.id === diffEnd.id) {
      return [];
    }

    return buildTailoredResumeSnapshotComparisonEdits({
      endAnnotatedLatexCode: diffEnd.annotatedLatexCode,
      startAnnotatedLatexCode: diffStart.annotatedLatexCode,
    });
  }, [diffEnd, diffStart]);
  const displayedEdits = isDiffMode ? diffComparisonEdits : record.edits;
  const canOpenDiff = diffEndpoints.length >= 2;
  const chatDisabled = isDiffMode || isUpdating || isChatSubmitting || !onRefineWithChat;
  const shouldRenderInlineActions = variant !== "fullscreen" || !actionPortalTarget;

  useEffect(() => {
    if (hydratedChatRecordIdRef.current === record.id) {
      return;
    }

    hydratedChatRecordIdRef.current = record.id;
    setChatMessages(buildInitialChatMessages(record));
  }, [record]);

  useEffect(() => {
    const messagesElement = chatMessagesRef.current;

    if (!messagesElement) {
      return;
    }

    messagesElement.scrollTop = messagesElement.scrollHeight;
  }, [chatMessages]);

  function setChatPaneOpen(nextOpen: boolean) {
    setIsChatOpen(nextOpen);
  }

  function selectDiffEndpoint(endpointId: string) {
    const endpointIndex = diffEndpoints.findIndex(
      (endpoint) => endpoint.id === endpointId,
    );

    if (endpointIndex === -1) {
      return;
    }

    if (!diffStartId || (diffStartId && diffEndId)) {
      const validEndOptions = diffEndpoints.slice(endpointIndex + 1);
      const nextEnd = validEndOptions.length === 1 ? validEndOptions[0] : null;

      setDiffStartId(endpointId);
      setDiffEndId(nextEnd?.id ?? null);
      if (nextEnd) {
        setIsDiffMenuOpen(false);
      }
      return;
    }

    const startIndex = diffEndpoints.findIndex(
      (endpoint) => endpoint.id === diffStartId,
    );

    if (startIndex === -1 || endpointIndex <= startIndex) {
      setDiffStartId(endpointId);
      setDiffEndId(null);
      return;
    }

    setDiffEndId(endpointId);
    setIsDiffMenuOpen(false);
  }

  function exitDiffMode() {
    setDiffStartId(null);
    setDiffEndId(null);
    setIsDiffMenuOpen(false);
  }

  function enterNewestDiff(input?: { endVersionId: string; startVersionId: string }) {
    if (input) {
      setDiffStartId(input.startVersionId);
      setDiffEndId(input.endVersionId);
      setIsDiffMenuOpen(false);
      return;
    }

    if (diffEndpoints.length < 2) {
      return;
    }

    setDiffStartId(diffEndpoints[diffEndpoints.length - 2]?.id ?? null);
    setDiffEndId(diffEndpoints[diffEndpoints.length - 1]?.id ?? null);
    setIsDiffMenuOpen(false);
  }

  async function deleteVersion(version: TailoredResumeReviewVersion, index: number) {
    if (!onDeleteVersion || index <= 0 || isDeletingVersionId) {
      return;
    }

    const deletedCount = record.versions.length - index;

    if (
      deletedCount > 1 &&
      !window.confirm(
        `Delete Output ${index + 1} and ${deletedCount - 1} later output${
          deletedCount - 1 === 1 ? "" : "s"
        }?`,
      )
    ) {
      return;
    }

    setIsDeletingVersionId(version.id);

    try {
      const wasDeleted = await onDeleteVersion(version.id);

      if (wasDeleted) {
        exitDiffMode();
      }
    } finally {
      setIsDeletingVersionId(null);
    }
  }

  async function submitChat() {
    const trimmedPrompt = chatInput.trim();

    if (!trimmedPrompt || chatDisabled || !onRefineWithChat) {
      return;
    }

    const assistantMessage = createChatMessage({
      role: "assistant",
      status: "streaming",
      text: "",
    });

    setChatMessages((messages) => [
      ...messages,
      createChatMessage({
        role: "user",
        status: "ready",
        text: trimmedPrompt,
      }),
      assistantMessage,
    ]);
    setChatInput("");
    setIsChatSubmitting(true);

    try {
      const response = await onRefineWithChat(trimmedPrompt, {
        onTextDelta: (delta) => {
          setChatMessages((messages) =>
            messages.map((message) =>
              message.id === assistantMessage.id
                ? {
                    ...message,
                    status: "streaming",
                    text: `${message.text}${delta}`,
                  }
                : message,
            ),
          );
        },
        onTextStart: () => {
          setChatMessages((messages) =>
            messages.map((message) =>
              message.id === assistantMessage.id
                ? {
                    ...message,
                    status: "streaming",
                    text: "",
                  }
                : message,
            ),
          );
        },
      });

      if (response) {
        setChatMessages((messages) =>
          messages.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  comparison: response.comparison,
                  status: "ready",
                  text: response.message,
                }
              : message,
          ),
        );
      }
    } catch (error) {
      setChatMessages((messages) =>
        messages.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "error",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unable to update the tailored resume.",
              }
            : message,
        ),
      );
    } finally {
      setIsChatSubmitting(false);
    }
  }

  const diffPickerAction = (
    <div className="quick-review-diff-picker">
      <button
        className="quick-review-toolbar-action"
        disabled={!canOpenDiff}
        type="button"
        onClick={() => setIsDiffMenuOpen((open) => !open)}
      >
        See Diff
      </button>

      {isDiffMenuOpen ? (
        <div className="quick-review-diff-menu">
          <div className="quick-review-diff-menu-header">
            <span>Select start, then end</span>
            <button type="button" onClick={exitDiffMode}>
              Clear
            </button>
          </div>
          <div className="quick-review-diff-options">
            {diffEndpoints.map((endpoint) => {
              const endpointVersion = endpoint.version;
              const isStart = diffStartId === endpoint.id;
              const isEnd = diffEndId === endpoint.id;
              const versionIndex = endpointVersion
                ? record.versions.findIndex(
                    (version) => version.id === endpointVersion.id,
                  )
                : -1;
              const canDeleteVersion = Boolean(
                endpointVersion && versionIndex > 0 && onDeleteVersion,
              );

              return (
                <div className="quick-review-diff-option-row" key={endpoint.id}>
                  <button
                    className={`quick-review-diff-option ${
                      isStart || isEnd ? "quick-review-diff-option-selected" : ""
                    }`.trim()}
                    type="button"
                    onClick={() => selectDiffEndpoint(endpoint.id)}
                  >
                    <span>{endpoint.label}</span>
                    <small>
                      {endpoint.version
                        ? `${endpoint.version.editCount} blocks${
                            formatOutputTime(endpoint.version.createdAt)
                              ? ` · ${formatOutputTime(endpoint.version.createdAt)}`
                              : ""
                          }`
                        : endpoint.id === "base"
                          ? "Source resume"
                          : "Current output"}
                    </small>
                  </button>
                  {canDeleteVersion && endpointVersion ? (
                    <button
                      aria-label={`Delete ${endpoint.label}`}
                      className="quick-review-diff-delete"
                      disabled={isDeletingVersionId === endpointVersion.id}
                      title={`Delete ${endpoint.label} and later outputs`}
                      type="button"
                      onClick={() =>
                        void deleteVersion(endpointVersion, versionIndex)
                      }
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );

  const chatAction = (
    <button
      className="quick-review-toolbar-action"
      disabled={chatDisabled}
      type="button"
      onClick={() => setChatPaneOpen(!isChatOpen)}
    >
      Chat
    </button>
  );

  const reviewActions = (
    <>
      {diffPickerAction}
      {chatAction}
    </>
  );

  const portalActions =
    variant === "fullscreen" && actionPortalTarget
      ? createPortal(diffPickerAction, actionPortalTarget)
      : null;

  const reviewContent = (
    <>
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

      {shouldRenderInlineActions ? (
        <div className="quick-review-toolbar">{reviewActions}</div>
      ) : null}

      {isDiffMode && diffStart && diffEnd ? (
        <div className="quick-review-diff-mode-banner">
          <span>
            Diff: {diffStart.label} → {diffEnd.label}
          </span>
          <button type="button" onClick={exitDiffMode}>
            Exit
          </button>
        </div>
      ) : null}

      {error ? <p className="quick-review-error">{error}</p> : null}

      {displayedEdits.length > 0 ? (
        <div className="quick-review-list">
          {displayedEdits.map((edit) => (
            <QuickReviewEditCard
              edit={edit}
              isUpdating={isUpdating}
              onCancelUserEditDraft={onCancelUserEditDraft}
              onFocusEdit={onFocusEdit}
              openEditRequest={openEditRequest}
              openEditingEditId={openEditingEditId}
              onSaveUserEdit={onSaveUserEdit}
              key={edit.editId}
              readOnly={isDiffMode}
              startLabel={isDiffMode && diffStart ? diffStart.label : "Original block"}
              endLabel={isDiffMode && diffEnd ? diffEnd.label : "Tailored block"}
              onSetEditState={onSetEditState}
            />
          ))}
        </div>
      ) : (
        <p className="quick-review-placeholder quick-review-panel-placeholder">
          {isDiffMode
            ? "No block-level differences were found for this comparison."
            : "This draft does not have any block-level edits to review."}
        </p>
      )}
    </>
  );

  const chatContent = (
    <div className="quick-review-chat-panel">
      {isDiffMode ? (
        <p className="quick-review-chat-disabled">
          Exit diff mode before asking for more edits.
        </p>
      ) : null}

      {chatMessages.length > 0 ? (
        <div className="quick-review-chat-messages" ref={chatMessagesRef}>
          {chatMessages.map((message) => (
            <div
              className={`quick-review-chat-message quick-review-chat-message-${message.role} ${
                message.status === "error" ? "quick-review-chat-message-error" : ""
              }`.trim()}
              key={message.id}
            >
              {message.text ? (
                <p>
                  {message.text}
                  {message.status === "streaming" ? (
                    <span className="quick-review-chat-cursor" aria-hidden="true" />
                  ) : null}
                </p>
              ) : null}
              {message.status === "streaming" && !message.text ? (
                <div className="quick-review-chat-typing" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {message.comparison && message.status === "ready" ? (
                <button
                  className="quick-review-chat-diff-action"
                  type="button"
                  onClick={() => enterNewestDiff(message.comparison)}
                >
                  See Diff
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="quick-review-placeholder">
          Ask for a targeted edit. Chat only creates a new output when it saves
          resume changes.
        </p>
      )}

      <form
        className="quick-review-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitChat();
        }}
      >
        <textarea
          disabled={chatDisabled}
          placeholder={
            isDiffMode
              ? "Exit diff mode to continue editing..."
              : "Ask for another tailored resume edit..."
          }
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitChat();
            }
          }}
        />
        <button
          disabled={chatDisabled || chatInput.trim().length === 0}
          type="submit"
        >
          Send
        </button>
      </form>
    </div>
  );

  if (variant === "fullscreen") {
    return (
      <section
        className={`quick-review-panel quick-review-panel-fullscreen ${
          isDiffMode ? "quick-review-panel-diff-mode" : ""
        }`}
      >
        {portalActions}
        {chatPortalTarget
          ? createPortal(
              <div className="quick-review-chat-scroll">{chatContent}</div>,
              chatPortalTarget,
            )
          : null}
        <div className="quick-review-main-scroll">{reviewContent}</div>
      </section>
    );
  }

  return (
    <section
      className={`quick-review-panel ${
        variant === "embedded" ? "quick-review-panel-embedded" : ""
      } ${isDiffMode ? "quick-review-panel-diff-mode" : ""}`}
    >
      {reviewContent}

      <div className="quick-review-chat-shell">
        {isChatOpen ? chatContent : null}
      </div>
    </section>
  );
}
