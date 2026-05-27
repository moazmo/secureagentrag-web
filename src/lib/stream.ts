/**
 * SSE consumer for the `/api/chat/stream` proxy.
 *
 * The upstream FastAPI endpoint emits Server-Sent Events with the shape:
 *
 *   event: <type>
 *   data:  <json string>
 *   <blank line>
 *
 * The Fetch API does not give us an EventSource for POST requests, so we
 * parse the byte stream by hand: split on `\n\n`, look for the `event:`
 * and `data:` lines per frame, JSON.parse the data payload. This handles
 * partial chunks across reads correctly -- the `buffer` carries unparsed
 * trailing bytes to the next iteration.
 */

export type StreamEventType =
  | "open"
  | "phase"
  | "token"
  | "blocked"
  | "final"
  | "error"
  | "unknown";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export async function* streamSSE(
  response: Response,
): AsyncGenerator<StreamEvent, void, void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line. Process every complete frame
      // and keep the trailing partial frame in `buffer`.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseFrame(frame);
        if (evt) yield evt;
      }
    }
    // Flush any tail (rare -- backend always trails with \n\n).
    if (buffer.trim()) {
      const evt = parseFrame(buffer);
      if (evt) yield evt;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  let type: StreamEventType = "unknown";
  let dataRaw = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      type = line.slice(6).trim() as StreamEventType;
    } else if (line.startsWith("data:")) {
      dataRaw += line.slice(5).trim();
    }
  }
  if (!dataRaw) return null;
  try {
    return { type, data: JSON.parse(dataRaw) as Record<string, unknown> };
  } catch {
    return { type, data: { raw: dataRaw } };
  }
}
