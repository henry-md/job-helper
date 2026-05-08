import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-auth";
import {
  createTailorResumeChatAssistantMessage,
  createTailorResumeChatUserTurn,
  deleteTailorResumeChatForUrl,
  maxTailorResumeChatMessageLength,
  readTailorResumeChatForUrl,
  readTailorResumeChatPageContext,
} from "@/lib/tailor-resume-chat";
import {
  generateTailorResumeSupportChatResponse,
  tailorResumeSupportChatPageTitle,
  tailorResumeSupportChatUrl,
} from "@/lib/tailor-resume-support-chat";

export const runtime = "nodejs";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to use resume chat." }, { status: 401 });
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}

function streamChatEvents(run: (sendEvent: (event: unknown) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          await run(sendEvent);
        } catch (error) {
          sendEvent({
            error: readErrorMessage(error, "Unable to answer from resume chat."),
            type: "error",
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/x-ndjson; charset=utf-8",
    },
    status: 200,
  });
}

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return NextResponse.json(
    await readTailorResumeChatForUrl({
      url: tailorResumeSupportChatUrl,
      userId: session.user.id,
    }),
  );
}

export async function DELETE(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return NextResponse.json(
    await deleteTailorResumeChatForUrl({
      url: tailorResumeSupportChatUrl,
      userId: session.user.id,
    }),
  );
}

export async function POST(request: Request) {
  const session = await getApiSession(request);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Use a valid JSON request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const content = typeof payload.message === "string" ? payload.message.trim() : "";
  const pageContext = readTailorResumeChatPageContext(payload.pageContext);

  if (!content) {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }

  if (content.length > maxTailorResumeChatMessageLength) {
    return NextResponse.json(
      {
        error: `Keep chat messages under ${maxTailorResumeChatMessageLength.toLocaleString()} characters.`,
      },
      { status: 413 },
    );
  }

  return streamChatEvents(async (sendEvent) => {
    const userTurn = await createTailorResumeChatUserTurn({
      content,
      pageTitle: tailorResumeSupportChatPageTitle,
      url: tailorResumeSupportChatUrl,
      userId: session.user.id,
    });

    sendEvent({
      message: userTurn.userMessage,
      type: "user-message",
    });

    const assistantResponse = await generateTailorResumeSupportChatResponse({
      currentUserMessage: content,
      pageContext,
      previousMessages: userTurn.previousMessages,
      signal: request.signal,
      userId: session.user.id,
    });
    const assistantMessage = await createTailorResumeChatAssistantMessage({
      content: assistantResponse.content,
      model: assistantResponse.model,
      pageTitle: tailorResumeSupportChatPageTitle,
      threadId: userTurn.threadId,
      url: tailorResumeSupportChatUrl,
      userId: session.user.id,
    });

    sendEvent({
      message: {
        ...assistantMessage,
        toolCalls: assistantResponse.toolCalls,
      },
      skillData: assistantResponse.skillData,
      type: "done",
    });
  });
}
