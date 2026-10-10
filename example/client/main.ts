import { createRegistry } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { DemoService, NoteSchema } from "../gen/demo/v1/demo_pb";

const baseUrl = location.origin;
const connect = createClient(DemoService, createConnectTransport({ baseUrl, useBinaryFormat: true }));
const connectJson = createClient(DemoService, createConnectTransport({ baseUrl, jsonOptions: { registry: createRegistry(NoteSchema) } }));
const grpcWeb = createClient(DemoService, createGrpcWebTransport({ baseUrl }));

const logEl = document.getElementById("log")!;
const log = (s: string) => (logEl.textContent += s + "\n");

// Request body intentionally contains non-UTF-8 bytes to exercise HAR postData handling.
const greetReq = {
  name: "ytjmt",
  bigNumber: 9007199254740993n,
  blob: new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x7f]),
  tags: ["a", "b"],
  scores: { math: 90, art: -1 },
  contact: { case: "email" as const, value: "x@example.com" },
};

async function stream(client: ReturnType<typeof createClient<typeof DemoService>>) {
  const ns: number[] = [];
  for await (const r of client.count({ upTo: 5, delayMs: 300 })) ns.push(r.n);
  return ns.join(",");
}

const calls: Record<string, () => Promise<unknown>> = {
  "connect-greet": () => connect.greet(greetReq).then((r) => r.greeting),
  "connect-json-greet": () => connectJson.greet(greetReq).then((r) => r.greeting),
  "grpcweb-greet": () => grpcWeb.greet(greetReq).then((r) => r.greeting),
  "grpcweb-fail": () => grpcWeb.fail(greetReq),
  "connect-count": () => stream(connect),
  "grpcweb-count": () => stream(grpcWeb),
};

async function run(name: string) {
  try {
    log(`${name}: ok ${JSON.stringify(await calls[name]())}`);
  } catch (e) {
    log(`${name}: error ${String(e)}`);
  }
}

document.querySelectorAll<HTMLButtonElement>("button[data-call]").forEach((b) =>
  b.addEventListener("click", () => run(b.dataset.call!)),
);

if (new URLSearchParams(location.search).has("auto")) {
  (async () => {
    for (const name of Object.keys(calls)) await run(name);
    document.title = "done";
  })();
}

