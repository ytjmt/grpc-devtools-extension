import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureStore, startCapture } from "../../extension/src/capture";

type Listener<T> = (arg: T) => void;

/** Minimal stand-in for chrome.devtools.network with manual event dispatch. */
function stubChrome() {
  const finished: Listener<unknown>[] = [];
  const navigated: Listener<string>[] = [];
  vi.stubGlobal("chrome", {
    devtools: {
      network: {
        onRequestFinished: { addListener: (fn: Listener<unknown>) => finished.push(fn) },
        onNavigated: { addListener: (fn: Listener<string>) => navigated.push(fn) },
      },
    },
  });
  return {
    finish: (entry: unknown) => finished.forEach((fn) => fn(entry)),
    navigate: () => navigated.forEach((fn) => fn("http://localhost/")),
  };
}

function harEntry(url: string, contentType: string, body: { content: string; encoding: string }) {
  return {
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 5,
    request: {
      url,
      method: "POST",
      headers: [{ name: "Content-Type", value: contentType, comment: "dropped" }],
      postData: { mimeType: contentType, text: "\u0000ÿ" },
    },
    response: { status: 200, headers: [{ name: "grpc-status", value: "0" }] },
    getContent: (cb: (content: string, encoding: string) => void) => cb(body.content, body.encoding),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("startCapture", () => {
  it("stores RPCs as plain data and ignores other traffic", () => {
    const chrome = stubChrome();
    const store = new CaptureStore();
    startCapture(store);

    chrome.finish(harEntry("http://x/a.B/C", "application/grpc-web+proto", { content: "AAAA", encoding: "base64" }));
    chrome.finish(harEntry("http://x/api/users", "application/json", { content: "{}", encoding: "" }));

    expect(store.calls).toEqual([
      {
        id: 1,
        url: "http://x/a.B/C",
        httpMethod: "POST",
        startedDateTime: "2026-01-01T00:00:00.000Z",
        time: 5,
        httpStatus: 200,
        requestHeaders: [{ name: "Content-Type", value: "application/grpc-web+proto" }],
        responseHeaders: [{ name: "grpc-status", value: "0" }],
        requestBodyText: "\u0000ÿ",
        responseBody: { content: "AAAA", encoding: "base64" },
      },
    ]);
  });

  it("clears on navigation unless preserveLog is set", () => {
    const chrome = stubChrome();
    const store = new CaptureStore();
    startCapture(store);
    const entry = harEntry("http://x/a.B/C", "application/grpc-web", { content: "", encoding: "" });

    chrome.finish(entry);
    chrome.navigate();
    expect(store.calls).toHaveLength(0);

    store.setPreserveLog(true);
    chrome.finish(entry);
    chrome.navigate();
    expect(store.calls).toHaveLength(1);
  });
});

describe("CaptureStore", () => {
  it("notifies subscribers and caps the log at 2000 calls", () => {
    const store = new CaptureStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const call = {
      url: "http://x/a.B/C",
      httpMethod: "POST",
      startedDateTime: "",
      time: 0,
      httpStatus: 200,
      requestHeaders: [],
      responseHeaders: [],
      requestBodyText: null,
      responseBody: { content: null, encoding: "" },
    };
    for (let i = 0; i < 2005; i++) store.add(call);
    expect(store.calls).toHaveLength(2000);
    expect(store.calls[0].id).toBe(6);
    expect(listener).toHaveBeenCalledTimes(2005);

    unsubscribe();
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2005);
  });
});
