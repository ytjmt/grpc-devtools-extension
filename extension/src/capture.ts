import { detectProtocol } from "./core/framing";
import type { RawCall } from "./core/types";

const MAX_CALLS = 2000;

/**
 * Lives in the devtools page, which exists for as long as DevTools is open,
 * so calls made before the panel is first shown are not lost.
 * Holds only strings/plain objects so the panel (another realm) can read them safely.
 */
export class CaptureStore {
  calls: RawCall[] = [];
  preserveLog = false;
  private nextId = 1;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /**
   * Inserts a call in start order. Calls arrive when they finish and their body
   * has been read, so a long call (a stream) lands before calls started after it.
   */
  add(call: Omit<RawCall, "id">) {
    const start = startTime(call);
    let i = this.calls.length;
    while (i > 0 && startTime(this.calls[i - 1]) > start) i--;
    this.calls = this.calls.toSpliced(i, 0, { ...call, id: this.nextId++ }).slice(-MAX_CALLS);
    this.emit();
  }

  clear() {
    this.calls = [];
    this.emit();
  }

  setPreserveLog(v: boolean) {
    this.preserveLog = v;
    this.emit();
  }
}

/** Start time in ms; 0 when missing, which keeps such calls in arrival order. */
function startTime(call: Pick<RawCall, "startedDateTime">): number {
  return Date.parse(call.startedDateTime) || 0;
}

export function startCapture(store: CaptureStore) {
  chrome.devtools.network.onRequestFinished.addListener((entry) => {
    const req = entry.request;
    if (!detectProtocol(req.url, req.method, req.headers)) return;
    (entry as chrome.devtools.network.Request).getContent((content, encoding) => {
      store.add({
        url: req.url,
        httpMethod: req.method,
        startedDateTime: entry.startedDateTime,
        time: entry.time,
        httpStatus: entry.response.status,
        requestHeaders: req.headers.map(({ name, value }) => ({ name, value })),
        responseHeaders: entry.response.headers.map(({ name, value }) => ({ name, value })),
        requestBodyText: req.postData?.text ?? null,
        responseBody: { content: content ?? null, encoding: encoding ?? "" },
      });
    });
  });
  chrome.devtools.network.onNavigated.addListener(() => {
    if (!store.preserveLog) store.clear();
  });
}
