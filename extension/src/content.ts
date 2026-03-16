chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => {
  const typedMessage =
    typeof message === "object" && message !== null
      ? (message as { type?: string })
      : null;

  if (typedMessage?.type !== "JOB_HELPER_CAPTURE_PAGE") {
    return;
  }

  const description =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content")
      ?.trim() ?? "";

  sendResponse({
    ok: true,
    snapshot: {
      description,
      title: document.title,
      url: window.location.href,
    },
  });
});
