import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildJobDescriptionFromPageContext,
  buildTailoredResumeReviewUrl,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT,
  DEFAULT_TAILOR_RESUME_ENDPOINT,
  DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT,
  LAST_TAILORING_STORAGE_KEY,
  type JobHelperAuthSession,
  type JobHelperAuthUser,
  type JobPageContext,
  type PersonalInfoSummary,
  readPersonalInfoPayload,
  readJobUrlFromPageContext,
  readTailoredResumeSummaries,
  readTailorResumeProfileSummary,
  type TailorResumeConversationMessage,
  type TailorResumePendingInterviewSummary,
  type TailorResumeRunRecord,
  type TrackedApplicationSummary,
} from "./job-helper";
import { collectPageContextFromTab } from "./page-context";

type PanelState =
  | { status: "idle"; snapshot: null }
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: JobPageContext }
  | { status: "error"; error: string; snapshot: null };

type CaptureState =
  | "error"
  | "finishing"
  | "idle"
  | "needs_input"
  | "running"
  | "sent";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; session: JobHelperAuthSession }
  | { status: "error"; error: string };

type AuthActionState = "idle" | "running";

type PanelTab = "personal" | "tailor";
type PersonalSectionId = "applications" | "resume" | "tailoredResumes";

type PersonalInfoState =
  | { personalInfo: null; status: "idle" | "loading" }
  | { personalInfo: PersonalInfoSummary; status: "ready" }
  | { error: string; personalInfo: null; status: "error" };

type ResumePreviewState =
  | { objectUrl: null; status: "idle" | "loading" }
  | { objectUrl: string; status: "ready" }
  | { error: string; objectUrl: null; status: "error" };

const TAILOR_RESUME_SHORTCUT_KEYS = ["⌘", "⇧", "S"] as const;
const TAILOR_RESUME_SHORTCUT_ARIA_LABEL = "Command Shift S";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab was found.");
  }

  return tab;
}

async function fetchSnapshot() {
  const tab = await getActiveTab();
  const tabId = tab.id;

  if (typeof tabId !== "number") {
    throw new Error("The active tab does not expose an id.");
  }

  return collectPageContextFromTab(tabId, "JOB_HELPER_CAPTURE_PAGE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAuthUser(value: unknown): JobHelperAuthUser | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return {
    email: typeof value.email === "string" ? value.email : null,
    id: value.id,
    image: typeof value.image === "string" ? value.image : null,
    name: typeof value.name === "string" ? value.name : null,
  };
}

function readAuthSession(value: unknown): JobHelperAuthSession | null {
  if (
    !isRecord(value) ||
    typeof value.sessionToken !== "string" ||
    typeof value.expires !== "string"
  ) {
    return null;
  }

  const user = readAuthUser(value.user);

  if (!user) {
    return null;
  }

  return {
    expires: value.expires,
    sessionToken: value.sessionToken,
    user,
  };
}

function readErrorMessage(value: unknown, fallbackMessage: string) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallbackMessage;
}

function assertRuntimeResponseOk(value: unknown, fallbackMessage: string) {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(readErrorMessage(value, fallbackMessage));
  }
}

function readAuthResponse(value: unknown): AuthState {
  if (!isRecord(value) || value.ok !== true) {
    return {
      error: readErrorMessage(value, "Could not connect to Job Helper."),
      status: "error",
    };
  }

  if (value.status === "signedIn") {
    const session = readAuthSession(value.session);

    if (session) {
      return { session, status: "signedIn" };
    }
  }

  return { status: "signedOut" };
}

function getSnapshotErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Failed to read the active page.";

  if (message.includes("Receiving end does not exist")) {
    return "Open a regular job page to inspect it here.";
  }

  return message;
}

function getUserInitial(user: JobHelperAuthUser) {
  return (user.name || user.email || "J").trim().slice(0, 1).toUpperCase();
}

function formatTailoredResumeDate(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const today = new Date();
  const isSameDay = date.toDateString() === today.toDateString();

  return date.toLocaleString(undefined, {
    day: isSameDay ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: isSameDay ? undefined : "short",
  });
}

function formatApplicationStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function buildOriginalResumePreviewUrl(pdfUpdatedAt: string | null) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);

  if (pdfUpdatedAt) {
    url.searchParams.set("updatedAt", pdfUpdatedAt);
  }

  return url.toString();
}

function buildTailoredResumePreviewUrl(tailoredResumeId: string) {
  const url = new URL(DEFAULT_TAILOR_RESUME_PREVIEW_ENDPOINT);
  url.searchParams.set("tailoredResumeId", tailoredResumeId);
  return url.toString();
}

function readTailorResumePayloadError(value: unknown, fallbackMessage: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim()
    ? value.error
    : fallbackMessage;
}

function readStringPayloadValue(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function resolveTailoredResumeFromPayload(payload: unknown) {
  const tailoredResumeId = readStringPayloadValue(payload, "tailoredResumeId");
  const tailoredResumes = readTailoredResumeSummaries(payload);

  if (tailoredResumeId) {
    return (
      tailoredResumes.find(
        (tailoredResume) => tailoredResume.id === tailoredResumeId,
      ) ?? null
    );
  }

  return tailoredResumes[0] ?? null;
}

function buildTailoringJobLabel(input: {
  companyName: string | null;
  positionTitle: string | null;
}) {
  const positionTitle = input.positionTitle?.trim();
  const companyName = input.companyName?.trim();

  if (positionTitle && companyName) {
    return `${positionTitle} at ${companyName}`;
  }

  return positionTitle || companyName || "this role";
}

function buildTailoringRunRecord(input: {
  capturedAt?: string;
  companyName: string | null;
  message: string;
  pageContext: JobPageContext | null;
  positionTitle: string | null;
  status: TailorResumeRunRecord["status"];
  tailoredResumeError?: string | null;
  tailoredResumeId?: string | null;
}) {
  return {
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    companyName: input.companyName,
    endpoint: DEFAULT_TAILOR_RESUME_ENDPOINT,
    message: input.message,
    pageTitle: input.pageContext?.title || null,
    pageUrl: input.pageContext?.url || null,
    positionTitle: input.positionTitle,
    status: input.status,
    tailoredResumeError: input.tailoredResumeError ?? null,
    tailoredResumeId: input.tailoredResumeId ?? null,
  } satisfies TailorResumeRunRecord;
}

type ChatMessageRecord = {
  content: string;
  createdAt: string;
  id: string;
  model: string | null;
  role: "assistant" | "user";
};

type ChatStatus = "error" | "idle" | "loading" | "ready";
type ChatSendStatus = "idle" | "streaming";

function readChatMessage(value: unknown): ChatMessageRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const content = typeof value.content === "string" ? value.content : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const role =
    value.role === "assistant" || value.role === "user" ? value.role : null;

  if (!id || !createdAt || !role) {
    return null;
  }

  return {
    content,
    createdAt,
    id,
    model: typeof value.model === "string" ? value.model : null,
    role,
  };
}

function readChatMessages(value: unknown) {
  const messages = isRecord(value) && Array.isArray(value.messages)
    ? value.messages
    : [];

  return messages
    .map(readChatMessage)
    .filter((message): message is ChatMessageRecord => Boolean(message));
}

function buildChatHistoryUrl(pageUrl: string) {
  const url = new URL(DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT);
  url.searchParams.set("url", pageUrl);
  return url.toString();
}

function createTemporaryChatMessage(
  role: ChatMessageRecord["role"],
  content: string,
): ChatMessageRecord {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `temporary-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: null,
    role,
  };
}

async function readChatStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Chat did not return a stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  function readLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    const event = JSON.parse(trimmedLine) as unknown;

    if (isRecord(event)) {
      onEvent(event);
    }
  }

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      readLine(line);
    }

    if (done) {
      break;
    }
  }

  readLine(buffer);
}

function ChatBubbleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.4 18.2 4 20V5.8C4 4.8 4.8 4 5.8 4h12.4c1 0 1.8.8 1.8 1.8v10.6c0 1-.8 1.8-1.8 1.8H6.4Z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 12 16-8-6 16-3-7-7-1Z" />
      <path d="m11 13 4-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7h14" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 7l1-2h4l1 2" />
      <path d="M7 7l1 13h8l1-13" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ChatMessageMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-message-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || "Thinking..."}
      </ReactMarkdown>
    </div>
  );
}

function App() {
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("tailor");
  const [state, setState] = useState<PanelState>({
    status: "loading",
    snapshot: null,
  });
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionState, setAuthActionState] =
    useState<AuthActionState>("idle");
  const [personalInfoState, setPersonalInfoState] =
    useState<PersonalInfoState>({ personalInfo: null, status: "idle" });
  const [resumePreviewState, setResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [tailoredResumePreviewState, setTailoredResumePreviewState] =
    useState<ResumePreviewState>({ objectUrl: null, status: "idle" });
  const [collapsedPersonalSections, setCollapsedPersonalSections] = useState<
    Record<PersonalSectionId, boolean>
  >({
    applications: true,
    resume: true,
    tailoredResumes: true,
  });
  const [lastTailoringRun, setLastTailoringRun] =
    useState<TailorResumeRunRecord | null>(null);
  const [tailorInterview, setTailorInterview] =
    useState<TailorResumePendingInterviewSummary | null>(null);
  const [draftTailorInterviewAnswer, setDraftTailorInterviewAnswer] =
    useState("");
  const [
    pendingTailorInterviewAnswerMessage,
    setPendingTailorInterviewAnswerMessage,
  ] =
    useState<TailorResumeConversationMessage | null>(null);
  const [tailorInterviewError, setTailorInterviewError] = useState<string | null>(
    null,
  );
  const [isCancellingTailorInterview, setIsCancellingTailorInterview] =
    useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("idle");
  const [chatSendStatus, setChatSendStatus] =
    useState<ChatSendStatus>("idle");
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPageUrl, setChatPageUrl] = useState<string | null>(null);
  const chatHistoryRequestIdRef = useRef(0);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    setState({ status: "loading", snapshot: null });

    try {
      const snapshot = await fetchSnapshot();
      setState({ status: "ready", snapshot });
    } catch (error) {
      setState({
        status: "error",
        error: getSnapshotErrorMessage(error),
        snapshot: null,
      });
    }
  }, []);

  const loadAuthStatus = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_AUTH_STATUS",
      });
      setAuthState(readAuthResponse(response));
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not read your Job Helper account.",
        status: "error",
      });
    }
  }, []);

  const loadPersonalInfo = useCallback(async () => {
    setPersonalInfoState({ personalInfo: null, status: "loading" });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_PERSONAL_INFO",
      });

      if (!isRecord(response) || response.ok !== true) {
        throw new Error(
          readErrorMessage(response, "Could not load your Job Helper info."),
        );
      }

      setPersonalInfoState({
        personalInfo: readPersonalInfoPayload(response),
        status: "ready",
      });
    } catch (error) {
      setPersonalInfoState({
        error:
          error instanceof Error
            ? error.message
            : "Could not load your Job Helper info.",
        personalInfo: null,
        status: "error",
      });
    }
  }, []);

  const loadChatHistory = useCallback(
    async (pageUrl: string, sessionToken: string) => {
      const requestId = chatHistoryRequestIdRef.current + 1;
      chatHistoryRequestIdRef.current = requestId;
      setChatPageUrl(pageUrl);
      setChatMessages([]);
      setChatStatus("loading");
      setChatError(null);

      try {
        const response = await fetch(buildChatHistoryUrl(pageUrl), {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "Could not load chat."));
        }

        if (chatHistoryRequestIdRef.current !== requestId) {
          return;
        }

        setChatMessages(readChatMessages(payload));
        setChatStatus("ready");
      } catch (error) {
        if (chatHistoryRequestIdRef.current !== requestId) {
          return;
        }

        setChatMessages([]);
        setChatError(
          error instanceof Error ? error.message : "Could not load chat.",
        );
        setChatStatus("error");
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadInitialSnapshot() {
      try {
        const snapshot = await fetchSnapshot();

        if (isMounted) {
          setState({ status: "ready", snapshot });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            error: getSnapshotErrorMessage(error),
            snapshot: null,
          });
        }
      }
    }

    void loadInitialSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void loadAuthStatus();

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[AUTH_SESSION_STORAGE_KEY]) {
        return;
      }

      void loadAuthStatus();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadAuthStatus]);

  useEffect(() => {
    if (authState.status !== "signedIn") {
      setPersonalInfoState({ personalInfo: null, status: "idle" });
      setResumePreviewState({ objectUrl: null, status: "idle" });
      setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      setTailorInterview(null);
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      return;
    }

    void loadPersonalInfo();
  }, [authState, lastTailoringRun?.capturedAt, loadPersonalInfo]);

  useEffect(() => {
    if (personalInfoState.status !== "ready") {
      return;
    }

    setTailorInterview(personalInfoState.personalInfo.tailoringInterview);

    if (!personalInfoState.personalInfo.tailoringInterview) {
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setTailorInterviewError(null);
    }
  }, [personalInfoState]);

  useEffect(() => {
    const sessionToken =
      authState.status === "signedIn" ? authState.session.sessionToken : null;
    const pdfUpdatedAt =
      personalInfoState.status === "ready"
        ? personalInfoState.personalInfo.originalResume.pdfUpdatedAt
        : null;

    if (!sessionToken || !pdfUpdatedAt) {
      setResumePreviewState({ objectUrl: null, status: "idle" });
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;

    async function loadOriginalResumePreview() {
      setResumePreviewState({ objectUrl: null, status: "loading" });

      try {
        const response = await fetch(buildOriginalResumePreviewUrl(pdfUpdatedAt), {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            readErrorMessage(payload, "Could not load the resume preview."),
          );
        }

        const previewBlob = await response.blob();
        objectUrl = URL.createObjectURL(previewBlob);

        if (isMounted) {
          setResumePreviewState({ objectUrl, status: "ready" });
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        if (isMounted) {
          setResumePreviewState({
            error:
              error instanceof Error
                ? error.message
                : "Could not load the resume preview.",
            objectUrl: null,
            status: "error",
          });
        }
      }
    }

    void loadOriginalResumePreview();

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [authState, personalInfoState]);

  useEffect(() => {
    const sessionToken =
      authState.status === "signedIn" ? authState.session.sessionToken : null;
    const tailoredResumeId = lastTailoringRun?.tailoredResumeId?.trim() ?? "";

    if (!sessionToken || !tailoredResumeId) {
      setTailoredResumePreviewState({ objectUrl: null, status: "idle" });
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;

    async function loadTailoredResumePreview() {
      setTailoredResumePreviewState({ objectUrl: null, status: "loading" });

      try {
        const response = await fetch(
          buildTailoredResumePreviewUrl(tailoredResumeId),
          {
            credentials: "include",
            headers: {
              Authorization: `Bearer ${sessionToken}`,
            },
          },
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            readErrorMessage(
              payload,
              "Could not load the tailored resume preview.",
            ),
          );
        }

        const previewBlob = await response.blob();
        objectUrl = URL.createObjectURL(previewBlob);

        if (isMounted) {
          setTailoredResumePreviewState({ objectUrl, status: "ready" });
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        if (isMounted) {
          setTailoredResumePreviewState({
            error:
              error instanceof Error
                ? error.message
                : "Could not load the tailored resume preview.",
            objectUrl: null,
            status: "error",
          });
        }
      }
    }

    void loadTailoredResumePreview();

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [authState, lastTailoringRun?.tailoredResumeId]);

  useEffect(() => {
    function handleActiveTabChange() {
      void loadSnapshot();
    }

    function handleTabUpdate(
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) {
      if (!tab.active || (changeInfo.status !== "complete" && !changeInfo.url)) {
        return;
      }

      void loadSnapshot();
    }

    chrome.tabs.onActivated.addListener(handleActiveTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActiveTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
    };
  }, [loadSnapshot]);

  useEffect(() => {
    void chrome.storage.local
      .get(LAST_TAILORING_STORAGE_KEY)
      .then((result) => {
        const storedValue = result[LAST_TAILORING_STORAGE_KEY];

        if (storedValue) {
          setLastTailoringRun(storedValue as TailorResumeRunRecord);
        }
      });

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "local" || !changes[LAST_TAILORING_STORAGE_KEY]) {
        return;
      }

      const nextRun =
        (changes[LAST_TAILORING_STORAGE_KEY]
          .newValue as TailorResumeRunRecord | null) ?? null;

      setLastTailoringRun(nextRun);
      setCaptureState(nextRun?.status === "needs_input" ? "needs_input" : "idle");
    }

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    if (chatSendStatus === "streaming") {
      return;
    }

    if (authState.status !== "signedIn") {
      setChatMessages([]);
      setChatPageUrl(null);
      setChatStatus("idle");
      setChatError(null);
      return;
    }

    if (state.status !== "ready") {
      setChatMessages([]);
      setChatPageUrl(null);
      setChatStatus("idle");
      setChatError(null);
      return;
    }

    void loadChatHistory(state.snapshot.url, authState.session.sessionToken);
  }, [authState, chatSendStatus, isChatOpen, loadChatHistory, state]);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    chatMessagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [chatMessages, chatSendStatus, isChatOpen]);

  async function handleTailorCurrentPage() {
    if (authState.status !== "signedIn") {
      setCaptureState("error");
      return;
    }

    setCaptureState("running");
    setTailorInterviewError(null);
    setActivePanelTab("tailor");

    let pageContext: JobPageContext | null =
      state.status === "ready" ? state.snapshot : null;

    try {
      pageContext = await fetchSnapshot();
      setState({ snapshot: pageContext, status: "ready" });

      const jobDescription = buildJobDescriptionFromPageContext(pageContext);

      if (!jobDescription) {
        throw new Error("Could not find job description text on this page.");
      }

      const result = await patchTailorResume({
        action: "tailor",
        jobDescription,
        jobUrl: readJobUrlFromPageContext(pageContext),
      });
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to tailor the resume.",
          ),
        );
      }

      setTailorInterview(profileSummary.tailoringInterview);
      void loadPersonalInfo();

      if (profileSummary.tailoringInterview) {
        const record = buildTailoringRunRecord({
          companyName: profileSummary.tailoringInterview.companyName,
          message: "Resume questions are waiting in the sidebar.",
          pageContext,
          positionTitle: profileSummary.tailoringInterview.positionTitle,
          status: "needs_input",
        });

        await persistTailoringRun(record);
        setCaptureState("needs_input");
        return;
      }

      const tailoredResume = resolveTailoredResumeFromPayload(result.payload);

      if (!tailoredResume) {
        throw new Error("Tailor Resume finished without returning a saved result.");
      }

      const tailoredResumeError = readStringPayloadValue(
        result.payload,
        "tailoredResumeError",
      ) || null;
      const alreadyTailored =
        readStringPayloadValue(result.payload, "tailoringStatus") ===
        "already_tailored";
      const jobLabel = buildTailoringJobLabel({
        companyName: tailoredResume.companyName,
        positionTitle: tailoredResume.positionTitle,
      });
      const record = buildTailoringRunRecord({
        companyName: tailoredResume.companyName,
        message: alreadyTailored
          ? `Already tailored ${jobLabel}. Showing the saved resume.`
          : tailoredResumeError
            ? `Saved a tailored draft for ${jobLabel}. Preview below.`
            : `Tailored resume for ${jobLabel}. Preview below.`,
        pageContext,
        positionTitle: tailoredResume.positionTitle,
        status:
          tailoredResume.status === "ready" && !tailoredResumeError
            ? "success"
            : "error",
        tailoredResumeError,
        tailoredResumeId: tailoredResume.id,
      });

      await persistTailoringRun(record);
      setCaptureState("sent");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to tailor the resume.";
      const record = buildTailoringRunRecord({
        companyName: null,
        message,
        pageContext,
        positionTitle: null,
        status: "error",
      });

      await persistTailoringRun(record);
      setCaptureState("error");
    }
  }

  function handleTailorInterviewAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey ||
      (!event.metaKey && !event.ctrlKey)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitTailorInterviewAnswer();
  }

  async function submitTailorInterviewAnswer() {
    if (
      !tailorInterview ||
      captureState === "finishing" ||
      isCancellingTailorInterview
    ) {
      return;
    }

    const trimmedAnswer = draftTailorInterviewAnswer.trim();

    if (!trimmedAnswer) {
      return;
    }

    const optimisticAnswerMessage: TailorResumeConversationMessage = {
      id: `pending-tailor-interview-answer-${Date.now()}`,
      role: "user",
      text: trimmedAnswer,
    };
    const pageContext = state.status === "ready" ? state.snapshot : null;

    setPendingTailorInterviewAnswerMessage(optimisticAnswerMessage);
    setDraftTailorInterviewAnswer("");
    setTailorInterviewError(null);
    setCaptureState("finishing");

    try {
      const result = await patchTailorResume({
        action: "advanceTailorResumeInterview",
        answer: trimmedAnswer,
        interviewId: tailorInterview.id,
      });
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to continue the tailoring follow-up questions.",
          ),
        );
      }

      setPendingTailorInterviewAnswerMessage(null);
      setTailorInterview(profileSummary.tailoringInterview);
      void loadPersonalInfo();

      if (profileSummary.tailoringInterview) {
        const record = buildTailoringRunRecord({
          companyName: profileSummary.tailoringInterview.companyName,
          message: "One more resume question is waiting in the sidebar.",
          pageContext,
          positionTitle: profileSummary.tailoringInterview.positionTitle,
          status: "needs_input",
        });

        await persistTailoringRun(record);
        setCaptureState("needs_input");
        return;
      }

      const tailoredResume = resolveTailoredResumeFromPayload(result.payload);

      if (!tailoredResume) {
        throw new Error("Tailor Resume finished without returning a saved result.");
      }

      const tailoredResumeError = readStringPayloadValue(
        result.payload,
        "tailoredResumeError",
      ) || null;
      const alreadyTailored =
        readStringPayloadValue(result.payload, "tailoringStatus") ===
        "already_tailored";
      const jobLabel = buildTailoringJobLabel({
        companyName: tailoredResume.companyName,
        positionTitle: tailoredResume.positionTitle,
      });
      const record = buildTailoringRunRecord({
        companyName: tailoredResume.companyName,
        message: alreadyTailored
          ? `Already tailored ${jobLabel}. Showing the saved resume.`
          : tailoredResumeError
            ? `Saved a tailored draft for ${jobLabel}. Preview below.`
            : `Tailored resume for ${jobLabel}. Preview below.`,
        pageContext,
        positionTitle: tailoredResume.positionTitle,
        status:
          tailoredResume.status === "ready" && !tailoredResumeError
            ? "success"
            : "error",
        tailoredResumeError,
        tailoredResumeId: tailoredResume.id,
      });

      await persistTailoringRun(record);
      setTailorInterview(null);
      setCaptureState("sent");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to continue the tailoring follow-up questions.";

      setPendingTailorInterviewAnswerMessage(null);
      setDraftTailorInterviewAnswer(trimmedAnswer);
      setTailorInterviewError(message);
      setCaptureState("needs_input");
    }
  }

  async function cancelTailorInterview() {
    if (!tailorInterview || isCancellingTailorInterview) {
      return;
    }

    setIsCancellingTailorInterview(true);
    setTailorInterviewError(null);

    try {
      const result = await patchTailorResume({
        action: "cancelTailorResumeInterview",
      });
      const profileSummary = readTailorResumeProfileSummary(result.payload);

      if (!result.ok || !profileSummary) {
        throw new Error(
          readTailorResumePayloadError(
            result.payload,
            "Unable to discard the tailoring follow-up questions.",
          ),
        );
      }

      setTailorInterview(null);
      setDraftTailorInterviewAnswer("");
      setPendingTailorInterviewAnswerMessage(null);
      setCaptureState("idle");
      void loadPersonalInfo();
    } catch (error) {
      setTailorInterviewError(
        error instanceof Error
          ? error.message
          : "Unable to discard the tailoring follow-up questions.",
      );
    } finally {
      setIsCancellingTailorInterview(false);
    }
  }

  async function handleDeleteChat() {
    if (
      authState.status !== "signedIn" ||
      !chatPageUrl ||
      chatSendStatus === "streaming"
    ) {
      return;
    }

    setChatStatus("loading");
    setChatError(null);

    try {
      const response = await fetch(buildChatHistoryUrl(chatPageUrl), {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
        },
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "Could not delete chat."));
      }

      setChatMessages([]);
      setChatStatus("ready");
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not delete chat.",
      );
      setChatStatus("error");
    }
  }

  async function handleSubmitChat() {
    if (authState.status !== "signedIn" || chatSendStatus === "streaming") {
      return;
    }

    const trimmedMessage = chatInput.trim();

    if (!trimmedMessage) {
      return;
    }

    let pageContext: JobPageContext;

    try {
      pageContext = await fetchSnapshot();
      setState({ snapshot: pageContext, status: "ready" });
    } catch (error) {
      setChatError(getSnapshotErrorMessage(error));
      setChatStatus("error");
      return;
    }

    const nextChatPageUrl = pageContext.url;
    const shouldResetForUrl = chatPageUrl !== nextChatPageUrl;
    const optimisticUserMessage = createTemporaryChatMessage(
      "user",
      trimmedMessage,
    );
    const optimisticAssistantMessage = createTemporaryChatMessage(
      "assistant",
      "",
    );

    setChatPageUrl(nextChatPageUrl);
    setChatInput("");
    setChatError(null);
    setChatStatus("ready");
    setChatSendStatus("streaming");
    setChatMessages((currentMessages) => [
      ...(shouldResetForUrl ? [] : currentMessages),
      optimisticUserMessage,
      optimisticAssistantMessage,
    ]);

    try {
      const response = await fetch(DEFAULT_TAILOR_RESUME_CHAT_ENDPOINT, {
        body: JSON.stringify({
          message: trimmedMessage,
          pageContext,
          url: nextChatPageUrl,
        }),
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authState.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(readErrorMessage(payload, "Could not send chat."));
      }

      await readChatStream(response, (event) => {
        if (event.type === "error") {
          throw new Error(readErrorMessage(event, "Could not send chat."));
        }

        if (event.type === "user-message") {
          const savedUserMessage = readChatMessage(event.message);

          if (savedUserMessage) {
            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === optimisticUserMessage.id
                  ? savedUserMessage
                  : message,
              ),
            );
          }
        }

        if (event.type === "delta" && typeof event.delta === "string") {
          setChatMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === optimisticAssistantMessage.id
                ? { ...message, content: `${message.content}${event.delta}` }
                : message,
            ),
          );
        }

        if (event.type === "done") {
          const savedAssistantMessage = readChatMessage(event.message);

          if (savedAssistantMessage) {
            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === optimisticAssistantMessage.id
                  ? savedAssistantMessage
                  : message,
              ),
            );
          }
        }
      });
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not send chat.",
      );
      setChatMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== optimisticAssistantMessage.id,
        ),
      );
    } finally {
      setChatSendStatus("idle");
    }
  }

  function handleChatFormSubmit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmitChat();
  }

  function handleChatInputKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    void handleSubmitChat();
  }

  async function handleOpenDashboard() {
    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: DEFAULT_DASHBOARD_URL,
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open Job Helper.");
      void loadAuthStatus();
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open Job Helper.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleOpenApplicationsDashboard() {
    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: `${DEFAULT_DASHBOARD_URL}?tab=new`,
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open applications.");
      void loadAuthStatus();
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open applications.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleOpenTailoredResume(tailoredResumeId: string) {
    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {
          callbackUrl: buildTailoredResumeReviewUrl(tailoredResumeId),
        },
        type: "JOB_HELPER_OPEN_DASHBOARD",
      });
      assertRuntimeResponseOk(response, "Could not open the tailored resume.");
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error
            ? error.message
            : "Could not open the tailored resume.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleOpenTrackedApplication(
    application: TrackedApplicationSummary,
  ) {
    if (application.jobUrl) {
      await chrome.tabs.create({ url: application.jobUrl });
      return;
    }

    await handleOpenApplicationsDashboard();
  }

  function togglePersonalSection(sectionId: PersonalSectionId) {
    setCollapsedPersonalSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }));
  }

  async function persistTailoringRun(record: TailorResumeRunRecord) {
    setLastTailoringRun(record);
    await chrome.storage.local.set({
      [LAST_TAILORING_STORAGE_KEY]: record,
    });
  }

  async function patchTailorResume(body: Record<string, unknown>) {
    if (authState.status !== "signedIn") {
      throw new Error("Connect Google before tailoring a resume.");
    }

    const response = await fetch(DEFAULT_TAILOR_RESUME_ENDPOINT, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authState.session.sessionToken}`,
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      setAuthState({ status: "signedOut" });
      throw new Error("Connect Google before tailoring a resume.");
    }

    return {
      ok: response.ok,
      payload,
      status: response.status,
    };
  }

  async function handleSignIn() {
    setAuthActionState("running");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SIGN_IN",
      });
      setAuthState(readAuthResponse(response));
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error ? error.message : "Could not connect to Google.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  async function handleSignOut() {
    setAuthActionState("running");

    try {
      await chrome.runtime.sendMessage({
        type: "JOB_HELPER_SIGN_OUT",
      });
      setAuthState({ status: "signedOut" });
    } catch (error) {
      setAuthState({
        error:
          error instanceof Error ? error.message : "Could not disconnect.",
        status: "error",
      });
    } finally {
      setAuthActionState("idle");
    }
  }

  const personalInfo =
    personalInfoState.status === "ready" ? personalInfoState.personalInfo : null;
  const originalResume = personalInfo?.originalResume ?? null;
  const isResumeCollapsed = collapsedPersonalSections.resume;
  const isTailoredResumesCollapsed =
    collapsedPersonalSections.tailoredResumes;
  const isApplicationsCollapsed = collapsedPersonalSections.applications;
  const displayedTailorInterviewConversation = tailorInterview
    ? pendingTailorInterviewAnswerMessage &&
        tailorInterview.conversation.at(-1)?.id !==
          pendingTailorInterviewAnswerMessage.id
      ? [...tailorInterview.conversation, pendingTailorInterviewAnswerMessage]
      : tailorInterview.conversation
    : [];
  const statusDisplayState =
    captureState === "running" || captureState === "finishing"
      ? "loading"
    : captureState === "error"
        ? "error"
        : captureState === "needs_input" || tailorInterview
          ? "ready"
        : state.status;
  const statusMessage =
    captureState === "running"
      ? "Starting Tailor Resume"
      : captureState === "finishing"
        ? "Finishing the tailored resume"
      : captureState === "sent"
        ? "Tailoring finished. Preview ready below."
        : captureState === "needs_input" || tailorInterview
          ? "Answer the resume follow-up below."
      : captureState === "error"
          ? authState.status !== "signedIn"
            ? "Could not start Tailor Resume. Connect Google first."
            : "Could not start Tailor Resume."
          : state.status === "idle"
            ? "Waiting for page details"
            : state.status === "loading"
              ? "Reading the active tab"
              : state.status === "ready"
                ? "Page details loaded"
                : state.error;
  const chatPageLabel =
    state.status === "ready"
      ? state.snapshot.title || state.snapshot.url || "Current page"
      : "Current page";
  const canSendChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatInput.trim().length > 0;
  const canDeleteChat =
    authState.status === "signedIn" &&
    chatSendStatus !== "streaming" &&
    chatMessages.length > 0 &&
    Boolean(chatPageUrl);

  return (
    <main className="side-panel-shell">
      <header className="panel-header">
        <a
          aria-label="Open Job Helper dashboard"
          className="eyebrow eyebrow-link"
          href={DEFAULT_DASHBOARD_URL}
          onClick={(event) => {
            event.preventDefault();

            if (authActionState !== "running") {
              void handleOpenDashboard();
            }
          }}
        >
          Job Helper
        </a>
        <h1>{activePanelTab === "tailor" ? "Tailor Resume" : "Personal Info"}</h1>
      </header>

      <section className="auth-card">
        <div className="auth-identity">
          {authState.status === "signedIn" && (
            <div className="auth-avatar" aria-hidden="true">
              {authState.session.user.image ? (
                <span
                  className="auth-avatar-image"
                  style={{
                    backgroundImage: `url(${JSON.stringify(
                      authState.session.user.image,
                    )})`,
                  }}
                />
              ) : (
                <span>{getUserInitial(authState.session.user)}</span>
              )}
            </div>
          )}
          <div className="auth-copy">
            <h2>Account</h2>
            <p>
              {authState.status === "loading" && "Checking connection..."}
              {authState.status === "signedOut" && "Not connected"}
              {authState.status === "error" && authState.error}
              {authState.status === "signedIn" &&
                (authState.session.user.email ||
                  authState.session.user.name ||
                  "Connected")}
            </p>
          </div>
        </div>
        {authState.status === "signedIn" ? (
          <button
            className="secondary-action compact-action"
            disabled={authActionState === "running"}
            type="button"
            onClick={handleSignOut}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="primary-action compact-action"
            disabled={authActionState === "running"}
            type="button"
            onClick={handleSignIn}
          >
            {authActionState === "running" ? "Connecting..." : "Connect Google"}
          </button>
        )}
      </section>

      <nav className="panel-tabs" aria-label="Job Helper sections">
        <button
          aria-current={activePanelTab === "tailor" ? "page" : undefined}
          className={`panel-tab ${activePanelTab === "tailor" ? "panel-tab-active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("tailor")}
        >
          Tailor
        </button>
        <button
          aria-current={activePanelTab === "personal" ? "page" : undefined}
          className={`panel-tab ${activePanelTab === "personal" ? "panel-tab-active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("personal")}
        >
          Personal
        </button>
      </nav>

      {activePanelTab === "tailor" ? (
        <>
          <div className="action-grid">
            <button
              aria-keyshortcuts="Meta+Shift+S"
              className="primary-action tailor-action"
              disabled={
                captureState === "running" || authState.status !== "signedIn"
              }
              title={`Tailor current page (${TAILOR_RESUME_SHORTCUT_ARIA_LABEL})`}
              type="button"
              onClick={handleTailorCurrentPage}
            >
              <span className="tailor-action-label">
                {captureState === "running" ? "Tailoring..." : "Tailor Current Page"}
              </span>
              <span
                aria-label={TAILOR_RESUME_SHORTCUT_ARIA_LABEL}
                className="tailor-action-shortcut"
              >
                {TAILOR_RESUME_SHORTCUT_KEYS.map((key) => (
                  <kbd className="tailor-shortcut-key" key={key}>
                    {key}
                  </kbd>
                ))}
              </span>
            </button>
          </div>

          <div className="status-row">
            <span className={`status-dot status-dot-${statusDisplayState}`} />
            <span className="status-text">{statusMessage}</span>
          </div>

          {tailorInterview ? (
            <section className="snapshot-card interview-card">
              <div className="card-heading-row">
                <h2>Resume questions</h2>
                {tailorInterview.questioningSummary ? (
                  <span>
                    {tailorInterview.questioningSummary.askedQuestionCount}/
                    {tailorInterview.questioningSummary.totalQuestionBudget}
                  </span>
                ) : null}
              </div>

              {tailorInterview.questioningSummary?.agenda ? (
                <p className="interview-agenda">
                  {tailorInterview.questioningSummary.agenda}
                </p>
              ) : null}

              <div className="interview-thread" aria-live="polite">
                {displayedTailorInterviewConversation.map((message) => (
                  <div
                    className={`interview-message interview-message-${message.role}`}
                    key={message.id}
                  >
                    {message.text}
                  </div>
                ))}
              </div>

              {tailorInterviewError ? (
                <p className="interview-error">{tailorInterviewError}</p>
              ) : null}

              <textarea
                className="interview-input"
                disabled={
                  captureState === "finishing" || isCancellingTailorInterview
                }
                onChange={(event) =>
                  setDraftTailorInterviewAnswer(event.target.value)
                }
                onKeyDown={handleTailorInterviewAnswerKeyDown}
                placeholder="Answer the current question..."
                value={draftTailorInterviewAnswer}
              />

              <div className="interview-actions">
                <button
                  className="secondary-action compact-action"
                  disabled={
                    captureState === "finishing" || isCancellingTailorInterview
                  }
                  type="button"
                  onClick={() => void cancelTailorInterview()}
                >
                  {isCancellingTailorInterview ? "Discarding..." : "Discard"}
                </button>
                <button
                  className="primary-action compact-action"
                  disabled={
                    captureState === "finishing" ||
                    isCancellingTailorInterview ||
                    draftTailorInterviewAnswer.trim().length === 0
                  }
                  type="button"
                  onClick={() => void submitTailorInterviewAnswer()}
                >
                  {captureState === "finishing" ? "Thinking..." : "Send answer"}
                </button>
              </div>
            </section>
          ) : null}

          <section className="snapshot-card">
            <h2>Last tailoring run</h2>
            {lastTailoringRun ? (
              <>
                <dl className="snapshot-grid">
                  <div>
                    <dt>Status</dt>
                    <dd>{lastTailoringRun.message}</dd>
                  </div>
                  <div>
                    <dt>Ran at</dt>
                    <dd>{new Date(lastTailoringRun.capturedAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>
                      {lastTailoringRun.positionTitle || "No role was returned."}
                    </dd>
                  </div>
                  <div>
                    <dt>Company</dt>
                    <dd>{lastTailoringRun.companyName || "No company was returned."}</dd>
                  </div>
                  <div>
                    <dt>Tailor Resume</dt>
                    <dd className="wrap-anywhere">{lastTailoringRun.endpoint}</dd>
                  </div>
                  <div>
                    <dt>Page</dt>
                    <dd className="wrap-anywhere">
                      {lastTailoringRun.pageUrl || "No page URL was captured."}
                    </dd>
                  </div>
                </dl>

                {lastTailoringRun.tailoredResumeId ? (
                  <div className="tailored-preview-block">
                    <div className="tailored-preview-actions">
                      {tailoredResumePreviewState.status === "ready" ? (
                        <a
                          className="secondary-action compact-action"
                          download="tailored-resume.pdf"
                          href={tailoredResumePreviewState.objectUrl}
                        >
                          Download PDF
                        </a>
                      ) : null}
                      <button
                        className="secondary-action compact-action"
                        disabled={authActionState === "running"}
                        type="button"
                        onClick={() =>
                          void handleOpenTailoredResume(
                            lastTailoringRun.tailoredResumeId!,
                          )
                        }
                      >
                        Open review
                      </button>
                    </div>

                    <div className="resume-preview-shell tailored-preview-shell">
                      {tailoredResumePreviewState.status === "loading" ? (
                        <p className="placeholder">Rendering tailored preview...</p>
                      ) : tailoredResumePreviewState.status === "error" ? (
                        <p className="preview-error">
                          {tailoredResumePreviewState.error}
                        </p>
                      ) : tailoredResumePreviewState.status === "ready" ? (
                        <iframe
                          className="resume-preview-frame"
                          src={tailoredResumePreviewState.objectUrl}
                          title="Tailored resume preview"
                        />
                      ) : (
                        <p className="placeholder preview-placeholder">
                          Tailored preview will appear here.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="placeholder">No tailoring runs yet.</p>
            )}
          </section>

          <section className="snapshot-card">
            <h2>Active page</h2>
            {state.status === "ready" ? (
              <dl className="snapshot-grid">
                <div>
                  <dt>Title</dt>
                  <dd>{state.snapshot.title || "Untitled page"}</dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd className="wrap-anywhere">{state.snapshot.url}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>
                    {state.snapshot.description || "No meta description found."}
                  </dd>
                </div>
                <div>
                  <dt>Salary hints</dt>
                  <dd>
                    {state.snapshot.salaryMentions.length > 0
                      ? state.snapshot.salaryMentions.join(", ")
                      : "No salary hints detected."}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="placeholder">
                Select a regular web page to inspect its job details here.
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="snapshot-card tailored-resume-card collapsible-card">
            <button
              aria-controls="personal-tailored-resumes-content"
              aria-expanded={!isTailoredResumesCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("tailoredResumes")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${
                    isTailoredResumesCollapsed ? "" : "collapse-chevron-open"
                  }`}
                />
                <span className="collapsible-heading-title">
                  Tailored resumes
                </span>
              </span>
              {personalInfo ? (
                <span className="collapsible-heading-badge">
                  {personalInfo.tailoredResumes.length}
                </span>
              ) : null}
            </button>
            {!isTailoredResumesCollapsed ? (
              <div id="personal-tailored-resumes-content">
                {authState.status !== "signedIn" ? (
              <p className="placeholder">Connect Google to load saved resumes.</p>
            ) : personalInfoState.status === "loading" ? (
              <p className="placeholder">Loading tailored resumes...</p>
            ) : personalInfoState.status === "error" ? (
              <p className="placeholder">{personalInfoState.error}</p>
            ) : !personalInfo || personalInfo.tailoredResumes.length === 0 ? (
              <p className="placeholder">No tailored resumes yet.</p>
            ) : (
              <div className="tailored-resume-list">
                {personalInfo.tailoredResumes.map((tailoredResume) => (
                  <button
                    key={tailoredResume.id}
                    className="tailored-resume-row"
                    disabled={authActionState === "running"}
                    type="button"
                    onClick={() => handleOpenTailoredResume(tailoredResume.id)}
                  >
                    <span className="tailored-resume-main">
                      <span className="tailored-resume-title">
                        {tailoredResume.displayName}
                      </span>
                      <span className="tailored-resume-meta">
                        {tailoredResume.companyName ||
                          tailoredResume.positionTitle ||
                          "Saved tailored resume"}
                      </span>
                    </span>
                    <span className="tailored-resume-date">
                      {formatTailoredResumeDate(tailoredResume.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
              </div>
            ) : null}
          </section>

          <section className="snapshot-card applications-card collapsible-card">
            <button
              aria-controls="personal-applications-content"
              aria-expanded={!isApplicationsCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("applications")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${
                    isApplicationsCollapsed ? "" : "collapse-chevron-open"
                  }`}
                />
                <span className="collapsible-heading-title">Tracked apps</span>
              </span>
              {personalInfo ? (
                <span className="collapsible-heading-badge">
                  {personalInfo.applicationCount}
                </span>
              ) : null}
            </button>
            {!isApplicationsCollapsed ? (
              <div id="personal-applications-content">
                {authState.status !== "signedIn" ? (
              <p className="placeholder">Connect Google to load applications.</p>
            ) : personalInfoState.status === "loading" ? (
              <p className="placeholder">Loading tracked applications...</p>
            ) : personalInfoState.status === "error" ? (
              <p className="placeholder">{personalInfoState.error}</p>
            ) : !personalInfo || personalInfo.applications.length === 0 ? (
              <p className="placeholder">No tracked applications yet.</p>
            ) : (
              <div className="application-list">
                {personalInfo.applications.map((application) => (
                  <button
                    key={application.id}
                    className="application-row"
                    type="button"
                    onClick={() => void handleOpenTrackedApplication(application)}
                  >
                    <span className="application-main">
                      <span className="application-title">
                        {application.jobTitle}
                      </span>
                      <span className="application-meta">
                        {application.companyName}
                        {application.location ? ` - ${application.location}` : ""}
                      </span>
                    </span>
                    <span className="application-side">
                      <span className="application-status">
                        {formatApplicationStatus(application.status)}
                      </span>
                      <span className="tailored-resume-date">
                        {formatTailoredResumeDate(application.appliedAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {personalInfo && personalInfo.applicationCount > personalInfo.applications.length ? (
              <button
                className="link-action more-action"
                disabled={authActionState === "running"}
                type="button"
                onClick={handleOpenApplicationsDashboard}
              >
                View all applications
              </button>
            ) : null}
              </div>
            ) : null}
          </section>

          <section className="snapshot-card resume-preview-card collapsible-card">
            <button
              aria-controls="personal-resume-content"
              aria-expanded={!isResumeCollapsed}
              className="collapsible-heading"
              type="button"
              onClick={() => togglePersonalSection("resume")}
            >
              <span className="collapsible-heading-main">
                <span
                  aria-hidden="true"
                  className={`collapse-chevron ${
                    isResumeCollapsed ? "" : "collapse-chevron-open"
                  }`}
                />
                <span className="collapsible-heading-title">Resume</span>
              </span>
            </button>
            {!isResumeCollapsed ? (
              <div id="personal-resume-content">
                {authState.status !== "signedIn" ? (
              <p className="placeholder">Connect Google to preview your resume.</p>
            ) : personalInfoState.status === "loading" ? (
              <p className="placeholder">Loading resume preview...</p>
            ) : personalInfoState.status === "error" ? (
              <p className="placeholder">{personalInfoState.error}</p>
            ) : originalResume ? (
              <>
                {originalResume.error ? (
                  <p className="preview-error">{originalResume.error}</p>
                ) : null}
                {originalResume.pdfUpdatedAt ? (
                  <div className="resume-preview-shell">
                    {resumePreviewState.status === "loading" ? (
                      <p className="placeholder">Rendering preview...</p>
                    ) : resumePreviewState.status === "error" ? (
                      <p className="placeholder">{resumePreviewState.error}</p>
                    ) : resumePreviewState.status === "ready" ? (
                      <iframe
                        className="resume-preview-frame"
                        src={resumePreviewState.objectUrl}
                        title="Resume preview"
                      />
                    ) : (
                      <p className="placeholder">Preview will appear here.</p>
                    )}
                  </div>
                ) : (
                  <p className="placeholder preview-placeholder">
                    No rendered preview is available yet.
                  </p>
                )}
                {originalResume.resumeUpdatedAt ? (
                  <dl className="snapshot-grid resume-updated-grid">
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatTailoredResumeDate(originalResume.resumeUpdatedAt)}</dd>
                    </div>
                  </dl>
                ) : null}
              </>
            ) : (
              <p className="placeholder">No resume data loaded yet.</p>
            )}
              </div>
            ) : null}
          </section>
        </>
      )}
      <div className={`chat-dock ${isChatOpen ? "chat-dock-open" : ""}`}>
        {isChatOpen ? (
          <section className="chat-panel" aria-label="Job page chat">
            <header className="chat-header">
              <div className="chat-title-group">
                <p>Job Chat</p>
                <span title={chatPageLabel}>{chatPageLabel}</span>
              </div>
              <div className="chat-header-actions">
                <button
                  aria-label="Delete chat for this URL"
                  className="icon-action"
                  disabled={!canDeleteChat}
                  title="Delete chat for this URL"
                  type="button"
                  onClick={() => void handleDeleteChat()}
                >
                  <TrashIcon />
                </button>
                <button
                  aria-label="Close chat"
                  className="icon-action"
                  type="button"
                  onClick={() => setIsChatOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="chat-tip">
              This chat sees the current job page, your resume, and USER.md.
            </div>

            <div className="chat-messages" aria-live="polite">
              {authState.status !== "signedIn" ? (
                <p className="chat-placeholder">Connect Google to start chatting.</p>
              ) : state.status !== "ready" ? (
                <p className="chat-placeholder">Open a regular job page to chat.</p>
              ) : chatStatus === "loading" ? (
                <p className="chat-placeholder">Loading chat...</p>
              ) : chatStatus === "error" && chatMessages.length === 0 ? (
                <p className="chat-placeholder">{chatError}</p>
              ) : chatMessages.length === 0 ? (
                <p className="chat-placeholder">
                  Ask whether this role is worth applying to, where your resume
                  matches, or what the posting really requires.
                </p>
              ) : (
                chatMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`chat-message chat-message-${message.role}`}
                  >
                    <div className="chat-message-role">
                      {message.role === "assistant" ? "Job Helper" : "You"}
                    </div>
                    <ChatMessageMarkdown content={message.content} />
                  </article>
                ))
              )}
              {chatError && chatMessages.length > 0 ? (
                <p className="chat-inline-error">{chatError}</p>
              ) : null}
              <div ref={chatMessagesEndRef} />
            </div>

            <form className="chat-form" onSubmit={handleChatFormSubmit}>
              <textarea
                aria-label="Message Job Helper"
                disabled={
                  authState.status !== "signedIn" ||
                  chatSendStatus === "streaming"
                }
                placeholder="Ask about this job"
                rows={2}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleChatInputKeyDown}
              />
              <button
                aria-label="Send message"
                className="chat-send-action"
                disabled={!canSendChat}
                type="submit"
              >
                <SendIcon />
              </button>
            </form>
          </section>
        ) : (
          <button
            aria-label="Open job chat"
            className="chat-launcher"
            title="Open job chat"
            type="button"
            onClick={() => setIsChatOpen(true)}
          >
            <ChatBubbleIcon />
          </button>
        )}
      </div>
    </main>
  );
}

export default App;
