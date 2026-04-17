const lastValidationErrorMarker = "Last validation error:\n";

function trimTrailingEllipsis(value: string) {
  return value.replace(/[ \t\r\n.]+$/u, "").replace(/…+$/u, "").trimEnd();
}

function appendEllipsis(value: string, multiline: boolean) {
  const trimmedValue = trimTrailingEllipsis(value);

  if (!trimmedValue) {
    return "…";
  }

  return multiline ? `${trimmedValue}\n…` : `${trimmedValue}…`;
}

export function extractTailorResumeActualLatexError(error: string) {
  const trimmedError = error.trim();

  if (!trimmedError) {
    return "";
  }

  const markerIndex = trimmedError.lastIndexOf(lastValidationErrorMarker);

  if (markerIndex === -1) {
    return trimmedError;
  }

  const extractedError = trimmedError
    .slice(markerIndex + lastValidationErrorMarker.length)
    .trim();

  return extractedError || trimmedError;
}

export function formatTailorResumeLatexError(
  error: string,
  options: {
    maxChars?: number;
    maxLines?: number;
    singleLine?: boolean;
  } = {},
) {
  const actualMessage = extractTailorResumeActualLatexError(error);
  const normalizedMessage = options.singleLine
    ? actualMessage.replace(/\s+/g, " ").trim()
    : actualMessage
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();

  if (!normalizedMessage) {
    return {
      actualMessage,
      displayMessage: "",
      wasTruncated: false,
    };
  }

  let displayMessage = normalizedMessage;
  let wasTruncated = false;

  if (!options.singleLine && options.maxLines) {
    const lines = displayMessage.split("\n");

    if (lines.length > options.maxLines) {
      displayMessage = lines.slice(0, options.maxLines).join("\n");
      wasTruncated = true;
    }
  }

  if (
    typeof options.maxChars === "number" &&
    options.maxChars > 0 &&
    displayMessage.length > options.maxChars
  ) {
    displayMessage = displayMessage.slice(0, options.maxChars).trimEnd();
    wasTruncated = true;
  }

  return {
    actualMessage,
    displayMessage: wasTruncated
      ? appendEllipsis(displayMessage, options.singleLine !== true)
      : displayMessage,
    wasTruncated,
  };
}
