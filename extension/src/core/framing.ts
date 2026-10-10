import type { Codec, Frame, Header, Transport } from "./types";

export const FLAG_COMPRESSED = 0x01;
/** Connect streaming: end-of-stream message (JSON). */
export const FLAG_CONNECT_END = 0x02;
/** gRPC-Web: trailers frame (HTTP/1 header block). */
export const FLAG_GRPC_WEB_TRAILER = 0x80;

/** Splits an enveloped body: repeated [flags:1][length:4 BE][data:length]. */
export function parseFrames(body: Uint8Array): { frames: Frame[]; rest: Uint8Array } {
  const frames: Frame[] = [];
  let off = 0;
  while (off + 5 <= body.length) {
    const flags = body[off];
    const len = new DataView(body.buffer, body.byteOffset + off + 1, 4).getUint32(0);
    if (off + 5 + len > body.length) break;
    frames.push({ flags, data: body.subarray(off + 5, off + 5 + len) });
    off += 5 + len;
  }
  return { frames, rest: body.subarray(off) };
}

/** Parses a gRPC-Web trailer frame ("key: value\r\n" lines). */
export function parseTrailerBlock(text: string): Header[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.includes(":"))
    .map((l) => {
      const i = l.indexOf(":");
      return { name: l.slice(0, i).trim().toLowerCase(), value: l.slice(i + 1).trim() };
    });
}

export interface Detected {
  transport: Transport;
  codec: Codec;
}

export function headerValue(headers: Header[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

/**
 * Decides whether an HTTP exchange is an RPC and which wire protocol it uses.
 * Returns undefined for ordinary traffic.
 */
export function detectProtocol(
  url: string,
  httpMethod: string,
  requestHeaders: Header[],
): Detected | undefined {
  const ct = (headerValue(requestHeaders, "content-type") ?? "").split(";")[0].trim().toLowerCase();
  const codecOf = (suffix: string | undefined): Codec => (suffix === "json" ? "json" : "proto");

  let m = /^application\/grpc-web-text(?:\+(\w+))?$/.exec(ct);
  if (m) return { transport: "grpc-web-text", codec: codecOf(m[1]) };
  m = /^application\/grpc-web(?:\+(\w+))?$/.exec(ct);
  if (m) return { transport: "grpc-web", codec: codecOf(m[1]) };
  m = /^application\/grpc(?:\+(\w+))?$/.exec(ct);
  if (m) return { transport: "grpc", codec: codecOf(m[1]) };
  m = /^application\/connect\+(\w+)$/.exec(ct);
  if (m) return { transport: "connect-stream", codec: codecOf(m[1]) };

  if (!parseRpcPath(url)) return undefined;
  const isConnect = headerValue(requestHeaders, "connect-protocol-version") !== undefined;
  if (httpMethod === "POST") {
    if (ct === "application/proto") return { transport: "connect", codec: "proto" };
    if (ct === "application/json" && isConnect) return { transport: "connect", codec: "json" };
  }
  if (httpMethod === "GET") {
    const q = new URL(url).searchParams;
    if (q.get("connect") === "v1" || q.has("message")) {
      return { transport: "connect", codec: q.get("encoding") === "json" ? "json" : "proto" };
    }
  }
  return undefined;
}

/** "/prefix/pkg.Service/Method" → { service: "pkg.Service", method: "Method" } */
export function parseRpcPath(url: string): { service: string; method: string } | undefined {
  const path = new URL(url).pathname;
  const m = /\/([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\/([A-Za-z_]\w*)\/?$/.exec(path);
  return m ? { service: m[1], method: m[2] } : undefined;
}
