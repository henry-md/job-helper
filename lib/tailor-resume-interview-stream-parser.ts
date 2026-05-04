import type { TailorResumeTechnologyContext } from "./tailor-resume-types.ts";

export type InterviewStreamEmittedEvent =
  | { delta: string; kind: "text-delta" }
  | { card: TailorResumeTechnologyContext; kind: "card" };

export type TailorResumeInterviewStreamEvent =
  | InterviewStreamEmittedEvent
  | { kind: "reset" };

const interviewTextKeys = ["assistantMessage", "completionMessage"] as const;

export class TailorResumeInterviewArgsStreamer {
  private buffer = "";
  private emittedTextLength = 0;
  private emittedCardCount = 0;

  feed(chunk: string): InterviewStreamEmittedEvent[] {
    this.buffer += chunk;
    const events: InterviewStreamEmittedEvent[] = [];

    const text = this.extractStreamingText();
    if (text !== null && text.length > this.emittedTextLength) {
      events.push({
        delta: text.slice(this.emittedTextLength),
        kind: "text-delta",
      });
      this.emittedTextLength = text.length;
    }

    const cards = this.extractCompletedCards();
    while (this.emittedCardCount < cards.length) {
      events.push({ card: cards[this.emittedCardCount]!, kind: "card" });
      this.emittedCardCount += 1;
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

  private extractStreamingText(): string | null {
    for (const key of interviewTextKeys) {
      const valueStart = this.findKeyValueStart(key);

      if (valueStart >= 0) {
        return this.extractStringValueFrom(valueStart);
      }
    }

    return null;
  }

  private extractCompletedCards(): TailorResumeTechnologyContext[] {
    const valueStart = this.findKeyValueStart("technologyContexts");

    if (valueStart < 0 || this.buffer[valueStart] !== "[") {
      return [];
    }

    let i = valueStart + 1;
    const cards: TailorResumeTechnologyContext[] = [];

    while (i < this.buffer.length) {
      while (i < this.buffer.length && /[\s,]/.test(this.buffer[i]!)) {
        i += 1;
      }

      if (i >= this.buffer.length) {
        break;
      }

      if (this.buffer[i] === "]") {
        break;
      }

      if (this.buffer[i] !== "{") {
        break;
      }

      const start = i;
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;

      for (; i < this.buffer.length; i += 1) {
        const c = this.buffer[i]!;

        if (escape) {
          escape = false;
          continue;
        }

        if (c === "\\") {
          escape = true;
          continue;
        }

        if (inString) {
          if (c === '"') {
            inString = false;
          }

          continue;
        }

        if (c === '"') {
          inString = true;
          continue;
        }

        if (c === "{") {
          depth += 1;
        } else if (c === "}") {
          depth -= 1;

          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx === -1) {
        break;
      }

      const objStr = this.buffer.slice(start, endIdx + 1);

      try {
        const parsed = JSON.parse(objStr) as Record<string, unknown>;
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        const definition =
          typeof parsed.definition === "string" ? parsed.definition.trim() : "";
        const examples = Array.isArray(parsed.examples)
          ? parsed.examples
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];

        if (name && definition && examples.length >= 2) {
          cards.push({ definition, examples, name });
        }
      } catch {
        // Balanced braces but invalid JSON — skip and resume scanning past it.
      }

      i = endIdx + 1;
    }

    return cards;
  }
}
