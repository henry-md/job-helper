export type InterviewStreamEmittedEvent =
  | {
      field: (typeof interviewTextKeys)[number];
      kind: "text-start";
    }
  | {
      delta: string;
      field: (typeof interviewTextKeys)[number];
      kind: "text-delta";
    };

export type TailorResumeInterviewStreamEvent =
  | InterviewStreamEmittedEvent
  | { kind: "reset" };

const interviewTextKeys = ["assistantMessage", "completionMessage"] as const;

export class TailorResumeInterviewArgsStreamer {
  private buffer = "";
  private emittedTextLength = 0;
  private emittedTextKey: (typeof interviewTextKeys)[number] | null = null;

  feed(chunk: string): InterviewStreamEmittedEvent[] {
    this.buffer += chunk;
    const events: InterviewStreamEmittedEvent[] = [];

    const streamingText = this.extractStreamingText();
    if (streamingText !== null && streamingText.key !== this.emittedTextKey) {
      this.emittedTextKey = streamingText.key;
      this.emittedTextLength = 0;
      events.push({
        field: streamingText.key,
        kind: "text-start",
      });
    }

    if (
      streamingText !== null &&
      streamingText.text.length > this.emittedTextLength
    ) {
      events.push({
        delta: streamingText.text.slice(this.emittedTextLength),
        field: streamingText.key,
        kind: "text-delta",
      });
      this.emittedTextLength = streamingText.text.length;
    }

    return events;
  }

  private findKeyValueStart(key: string): number {
    const needle = `"${key}"`;
    const keyIdx = this.buffer.indexOf(needle);

    if (keyIdx === -1) {
      return -1;
    }

    let i = keyIdx + needle.length;

    while (i < this.buffer.length && /\s/.test(this.buffer[i]!)) {
      i += 1;
    }

    if (this.buffer[i] !== ":") {
      return -1;
    }

    i += 1;

    while (i < this.buffer.length && /\s/.test(this.buffer[i]!)) {
      i += 1;
    }

    return i;
  }

  private extractStringValueFrom(startIdx: number): string | null {
    if (startIdx < 0 || this.buffer[startIdx] !== '"') {
      return null;
    }

    let i = startIdx + 1;
    let result = "";

    while (i < this.buffer.length) {
      const c = this.buffer[i]!;

      if (c === "\\") {
        if (i + 1 >= this.buffer.length) {
          return result;
        }

        const next = this.buffer[i + 1]!;

        if (next === "n") { result += "\n"; i += 2; continue; }
        if (next === "t") { result += "\t"; i += 2; continue; }
        if (next === "r") { result += "\r"; i += 2; continue; }
        if (next === '"') { result += '"'; i += 2; continue; }
        if (next === "\\") { result += "\\"; i += 2; continue; }
        if (next === "/") { result += "/"; i += 2; continue; }
        if (next === "b") { result += "\b"; i += 2; continue; }
        if (next === "f") { result += "\f"; i += 2; continue; }

        if (next === "u") {
          if (i + 6 > this.buffer.length) {
            return result;
          }

          const hex = this.buffer.slice(i + 2, i + 6);

          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return result;
          }

          result += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }

        result += next;
        i += 2;
        continue;
      }

      if (c === '"') {
        return result;
      }

      result += c;
      i += 1;
    }

    return result;
  }

  private extractStreamingText(): {
    key: (typeof interviewTextKeys)[number];
    text: string;
  } | null {
    for (const key of interviewTextKeys) {
      const valueStart = this.findKeyValueStart(key);

      if (valueStart >= 0) {
        const text = this.extractStringValueFrom(valueStart);

        return text === null ? null : { key, text };
      }
    }

    return null;
  }

}
