import { base64ToBytes, base64UrlToBytes, latin1ToBytes, utf8Lossy } from "./bytes";
import { detectProtocol, headerValue } from "./framing";
import type { Header, RawCall, Transport } from "./types";

/**
 * Request and response bytes of a call, after undoing grpc-web-text base64 and
 * Connect GET query encoding. `*Encoding` names the RPC-level compression still
 * applied: to flagged frames, or to the whole body for unary Connect.
 */
export interface Bodies {
  request?: Uint8Array;
  response?: Uint8Array;
  requestEncoding?: string;
  responseEncoding?: string;
}

/** RPC-level compression per direction, from headers; undefined for identity. */
function compressionOf(raw: RawCall, transport: Transport): { request?: string; response?: string } {
  const pick = (headers: Header[], name: string) => {
    const v = headerValue(headers, name)?.trim().toLowerCase();
    return v && v !== "identity" ? v : undefined;
  };
  switch (transport) {
    case "connect-stream":
      return {
        request: pick(raw.requestHeaders, "connect-content-encoding"),
        response: pick(raw.responseHeaders, "connect-content-encoding"),
      };
    case "connect": {
      if (raw.httpMethod === "GET") {
        const query = new URL(raw.url).searchParams.get("compression");
        return { request: query && query !== "identity" ? query : undefined };
      }
      // Unary bodies use HTTP Content-Encoding, which Chrome undoes before the body
      // reaches HAR, for responses and (as observed) request bodies alike. Only treat
      // the request as compressed if the bytes still carry a gzip/zlib header.
      const encoding = pick(raw.requestHeaders, "content-encoding");
      const body = raw.requestBodyText ?? "";
      const gzipMagic = body.charCodeAt(0) === 0x1f && body.charCodeAt(1) === 0x8b;
      const zlibHeader =
        body.length > 1 &&
        (body.charCodeAt(0) & 0x0f) === 8 &&
        ((body.charCodeAt(0) << 8) | body.charCodeAt(1)) % 31 === 0;
      const stillCompressed = (encoding === "gzip" && gzipMagic) || (encoding === "deflate" && zlibHeader);
      return { request: stillCompressed ? encoding : undefined };
    }
    default:
      return {
        request: pick(raw.requestHeaders, "grpc-encoding"),
        response: pick(raw.responseHeaders, "grpc-encoding"),
      };
  }
}

export function extractBodies(raw: RawCall): Bodies {
  const detected = detectProtocol(raw.url, raw.httpMethod, raw.requestHeaders);
  if (!detected) throw new Error(`not an RPC: ${raw.url}`);
  const text = detected.transport === "grpc-web-text";
  const encoding = compressionOf(raw, detected.transport);
  return {
    request: requestBytes(raw, text),
    response: responseBytes(raw, text),
    requestEncoding: encoding.request,
    responseEncoding: encoding.response,
  };
}

function requestBytes(raw: RawCall, base64Text: boolean): Uint8Array | undefined {
  if (raw.httpMethod === "GET") {
    // Connect GET: ?message=...&encoding=proto|json&base64=1
    const q = new URL(raw.url).searchParams;
    const msg = q.get("message");
    if (msg === null) return undefined;
    return q.get("base64") === "1" ? base64UrlToBytes(msg) : new TextEncoder().encode(msg);
  }
  if (raw.requestBodyText === null) return undefined;
  if (base64Text) return decodeBase64Chunks(raw.requestBodyText);
  return latin1ToBytes(raw.requestBodyText);
}

function responseBytes(raw: RawCall, base64Text: boolean): Uint8Array | undefined {
  const { content, encoding } = raw.responseBody;
  if (content === null || content === undefined) return undefined;
  const bytes = encoding === "base64" ? base64ToBytes(content) : new TextEncoder().encode(content);
  return base64Text ? decodeBase64Chunks(utf8Lossy(bytes)) : bytes;
}

/** grpc-web-text responses may be several padded base64 chunks concatenated. */
function decodeBase64Chunks(text: string): Uint8Array {
  const chunks = text.replace(/\s+/g, "").split(/(?<==)(?=[^=])/);
  const parts = chunks.map(base64ToBytes);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** True when either direction still has RPC-level compression to undo. */
export function hasCompression(bodies: Bodies): boolean {
  return Boolean(bodies.requestEncoding || bodies.responseEncoding);
}
