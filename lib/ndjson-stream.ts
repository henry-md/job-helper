export type NdjsonStreamController = {
  close: () => void;
  enqueue: (chunk: Uint8Array) => void;
};

export function createNdjsonStreamWriter(
  controller: NdjsonStreamController,
  encoder = new TextEncoder(),
) {
  let closed = false;

  return {
    close() {
      if (closed) {
        return false;
      }

      closed = true;

      try {
        controller.close();
        return true;
      } catch {
        return false;
      }
    },
    sendEvent(event: unknown) {
      if (closed) {
        return false;
      }

      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
  };
}
