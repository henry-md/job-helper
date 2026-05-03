"use client";

import { MessageCircle, SendHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { TailorResumeConfigChatMessageRecord } from "@/lib/tailor-resume-config-chat";

type TailorResumeConfigChatResponse = {
  draftLatexCode?: string;
  error?: string;
  messages?: TailorResumeConfigChatMessageRecord[];
};

type SourceResumeConfigChatProps = {
  disabled?: boolean;
  draftLatexCode: string;
  hasResume: boolean;
  onApplyDraftLatex: (latexCode: string) => void;
};

function buildTemporaryMessageId() {
  return `config-chat-temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function SourceResumeConfigChat({
  disabled = false,
  draftLatexCode,
  hasResume,
  onApplyDraftLatex,
}: SourceResumeConfigChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState<TailorResumeConfigChatMessageRecord[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const canSubmit =
    hasResume && !disabled && !isSubmitting && draftMessage.trim().length > 0;
  const isChatDisabled = disabled || !hasResume;
  const placeholder = !hasResume
    ? "Upload a source resume before chatting."
    : "Ask for resume edits like spacing, margins, font size, or layout cleanup...";
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!isOpen || historyLoaded || isLoadingHistory) {
      return;
    }

    setIsLoadingHistory(true);

    void (async () => {
      try {
        const response = await fetch("/api/tailor-resume/config-chat", {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          error?: string;
          messages?: TailorResumeConfigChatMessageRecord[];
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load config chat.");
        }

        setMessages(payload.messages ?? []);
        setHistoryLoaded(true);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load config chat.",
        );
      } finally {
        setIsLoadingHistory(false);
      }
    })();
  }, [historyLoaded, isLoadingHistory, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [isOpen, messages]);

  const emptyState = useMemo(() => {
    if (isLoadingHistory) {
      return "Loading chat history...";
    }

    return "Ask for direct source-resume edits. The assistant can change the working draft and visually check the rendered PDF when layout matters.";
  }, [isLoadingHistory]);

  async function handleSubmit() {
    const trimmedMessage = draftMessage.trim();

    if (!trimmedMessage || !canSubmit) {
      return;
    }

    const temporaryUserMessage: TailorResumeConfigChatMessageRecord = {
      blocks: [
        {
          text: trimmedMessage,
          type: "text",
        },
      ],
      createdAt: new Date().toISOString(),
      id: buildTemporaryMessageId(),
      model: null,
      role: "user",
    };

    setMessages((currentMessages) => [...currentMessages, temporaryUserMessage]);
    setDraftMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/tailor-resume/config-chat", {
        body: JSON.stringify({
          draftLatexCode,
          message: trimmedMessage,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as TailorResumeConfigChatResponse;

      if (!response.ok || !payload.messages || typeof payload.draftLatexCode !== "string") {
        throw new Error(payload.error ?? "Unable to send the config chat message.");
      }

      const persistedMessages = payload.messages;
      onApplyDraftLatex(payload.draftLatexCode);
      setMessages((currentMessages) => [
        ...currentMessages.filter(
          (message) => message.id !== temporaryUserMessage.id,
        ),
        ...persistedMessages,
      ]);
      setHistoryLoaded(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to send the config chat message.";

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          blocks: [
            {
              text: errorMessage,
              type: "text",
            },
          ],
          createdAt: new Date().toISOString(),
          id: buildTemporaryMessageId(),
          model: null,
          role: "assistant",
        },
      ]);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClearHistory() {
    if (!hasMessages || isClearing) {
      return;
    }

    setIsClearing(true);

    try {
      const response = await fetch("/api/tailor-resume/config-chat", {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to clear config chat.");
      }

      setMessages([]);
      setHistoryLoaded(true);
      toast.success("Cleared config chat.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to clear config chat.",
      );
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex justify-end">
        <div className="pointer-events-auto">
          {isOpen ? (
            <section className="flex h-[min(72dvh,760px)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,16,0.96),rgba(8,10,14,0.98))] shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4 border-b border-white/8 px-4 py-4">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Config Chat
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-200">
                    Edit the working source-resume draft without saving it yet.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    aria-label="Clear config chat"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isClearing || !hasMessages}
                    onClick={() => void handleClearHistory()}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    aria-label="Close config chat"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08]"
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="app-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {!hasMessages ? (
                  <div className="rounded-[1.1rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-400">
                    {emptyState}
                  </div>
                ) : null}

                {messages.map((message) => (
                  <div
                    className={`rounded-[1.15rem] border px-4 py-3 text-sm leading-6 shadow-[0_18px_45px_rgba(0,0,0,0.18)] ${
                      message.role === "user"
                        ? "ml-auto border-emerald-300/18 bg-[linear-gradient(180deg,rgba(52,211,153,0.1),rgba(16,185,129,0.05))] text-zinc-100"
                        : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] text-zinc-100"
                    }`}
                    key={message.id}
                  >
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      {message.role === "user" ? "You" : "Assistant"}
                    </p>

                    <div className="space-y-3">
                      {message.blocks.map((block, index) =>
                        block.type === "text" ? (
                          <p
                            className="whitespace-pre-wrap break-words"
                            key={`${message.id}-text-${index}`}
                          >
                            {block.text}
                          </p>
                        ) : (
                          <div
                            className="space-y-2"
                            key={`${message.id}-pdf-${index}`}
                          >
                            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                              {block.label}
                            </p>
                            <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-black/25">
                              <object
                                className="h-[260px] w-full bg-white"
                                data={block.url}
                                type="application/pdf"
                              >
                                <div className="px-4 py-4 text-sm leading-6 text-zinc-300">
                                  PDF preview unavailable here.
                                </div>
                              </object>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}

                {isSubmitting ? (
                  <div className="rounded-[1.15rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] px-4 py-3 text-sm leading-6 text-zinc-100 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Assistant
                    </p>
                    <p className="text-zinc-400">Updating the working draft...</p>
                  </div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-white/8 px-4 py-4">
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                >
                  <textarea
                    className="min-h-[7.5rem] w-full resize-none rounded-[1.1rem] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isChatDisabled || isSubmitting}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSubmit();
                      }
                    }}
                    placeholder={placeholder}
                    value={draftMessage}
                  />

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-5 text-zinc-500">
                      Changes land in the working draft. Save or cancel them from the editor footer.
                    </p>
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/28 bg-emerald-400/10 text-emerald-100 transition hover:border-emerald-200/45 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canSubmit}
                      type="submit"
                    >
                      <SendHorizontal aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              </div>
            </section>
          ) : (
            <button
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-emerald-300/24 bg-[linear-gradient(180deg,rgba(16,185,129,0.18),rgba(5,150,105,0.14))] text-emerald-100 shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition hover:border-emerald-200/40 hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.24),rgba(5,150,105,0.18))] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isChatDisabled}
              onClick={() => setIsOpen(true)}
              title={hasResume ? "Open config chat" : "Upload a resume to use config chat"}
              type="button"
            >
              <MessageCircle aria-hidden="true" className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
