import { createServer } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { create, createRegistry } from "@bufbuild/protobuf";
import { anyPack, timestampNow } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { DemoService, Mood, NoteSchema } from "../gen/demo/v1/demo_pb.js";

const PORT = Number(process.env.PORT ?? 8080);
// Native gRPC needs HTTP/2; served separately (h2c) for tools like grpcurl.
const GRPC_PORT = Number(process.env.GRPC_PORT ?? PORT + 1);
const STATIC_DIR = new URL("../client/dist/", import.meta.url).pathname;
const DESCRIPTOR = new URL("../descriptor.binpb", import.meta.url).pathname;

const routes = (router: ConnectRouter) =>
  router.service(DemoService, {
    greet(req) {
      return {
        greeting: `Hello, ${req.name}! (${req.blob.length} bytes received)`,
        mood: Mood.HAPPY,
        at: timestampNow(),
        extra: anyPack(NoteSchema, create(NoteSchema, { text: `tags=${req.tags.join(",")}` })),
      };
    },
    fail(req) {
      throw new ConnectError(`no greeting for ${req.name}`, Code.PermissionDenied);
    },
    async *count(req) {
      for (let n = 1; n <= req.upTo; n++) {
        await new Promise((r) => setTimeout(r, req.delayMs));
        yield { n };
      }
    },
  });

const rpc = connectNodeAdapter({ routes, jsonOptions: { registry: createRegistry(NoteSchema) } });

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/demo.v1.")) return rpc(req, res);
  if (url.pathname === "/_devtools/descriptor.binpb") {
    res.writeHead(200, { "content-type": "application/octet-stream", "access-control-allow-origin": "*" });
    return res.end(await readFile(DESCRIPTOR));
  }
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  try {
    const body = await readFile(join(STATIC_DIR, rel));
    res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`demo server on http://localhost:${PORT}`));

createHttp2Server(rpc).listen(GRPC_PORT, () => console.log(`demo gRPC (h2c) on localhost:${GRPC_PORT}`));
