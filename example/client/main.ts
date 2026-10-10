import { createRegistry } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { DemoService, NoteSchema } from "../gen/demo/v1/demo_pb";
import { compressionCalls } from "./compression";
import { shopCalls } from "./shop";

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

/** Minimal demo; tests depend on exactly these calls (?auto=1). */
const demoCalls: Record<string, () => Promise<unknown>> = {
  "connect-greet": () => connect.greet(greetReq).then((r) => r.greeting),
  "connect-json-greet": () => connectJson.greet(greetReq).then((r) => r.greeting),
  "grpcweb-greet": () => grpcWeb.greet(greetReq).then((r) => r.greeting),
  "grpcweb-fail": () => grpcWeb.fail(greetReq),
  "connect-count": () => stream(connect),
  "grpcweb-count": () => stream(grpcWeb),
};

const scenarios = { demo: demoCalls, shop: shopCalls, compression: compressionCalls };

async function run(calls: Record<string, () => Promise<unknown>>, name: string) {
  try {
    log(`${name}: ok ${JSON.stringify(await calls[name](), (_, v) => (typeof v === "bigint" ? String(v) : v))}`);
  } catch (e) {
    log(`${name}: error ${String(e)}`);
  }
}

for (const [scenario, calls] of Object.entries(scenarios)) {
  const container = document.getElementById(`${scenario}-calls`)!;
  for (const name of Object.keys(calls)) {
    const button = document.createElement("button");
    button.textContent = name;
    button.addEventListener("click", () => run(calls, name));
    container.append(button, " ");
  }
}

// ?auto=1 (or ?auto=demo) runs the demo calls; ?auto=shop and ?auto=compression the others.
const auto = new URLSearchParams(location.search).get("auto");
if (auto !== null) {
  const calls = auto in scenarios ? scenarios[auto as keyof typeof scenarios] : demoCalls;
  (async () => {
    for (const name of Object.keys(calls)) await run(calls, name);
    document.title = "done";
  })();
}
