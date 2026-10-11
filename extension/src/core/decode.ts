import { fromBinary, toJson, type DescMessage, type Registry } from "@bufbuild/protobuf";
import { errorText, msg, type Text } from "../i18n";
import { base64ToBytes, base64UrlToBytes, latin1ToBytes, tryUtf8, utf8Lossy } from "./bytes";
import {
  detectProtocol,
  FLAG_COMPRESSED,
  FLAG_CONNECT_END,
  FLAG_GRPC_WEB_TRAILER,
  headerValue,
  parseFrames,
  parseTrailerBlock,
} from "./framing";
import type { SchemaIndex } from "./schema";
import { decodeSchemaless } from "./schemaless";
import { decodeDetail, decodeStatusDetails, type ErrorDetail } from "./rpcStatus";
import { findUnknownFields } from "./unknownFields";
import { codeFromConnectString, codeFromHttpStatus, codeName } from "./status";
import type { CallStatus, Codec, DecodedCall, DecodedMessage, Frame, Header, RawCall, Transport } from "./types";

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

/**
 * Decodes a captured call. Pass `bodies` from decompressBodies() to decode
 * compressed calls; by default bodies are taken from the capture as-is.
 */
export function decodeCall(raw: RawCall, schemas: SchemaIndex, bodies: Bodies = extractBodies(raw)): DecodedCall {
  const detected = detectProtocol(raw.url, raw.httpMethod, raw.requestHeaders);
  if (!detected) throw new Error(`not an RPC: ${raw.url}`);
  const { transport, codec } = detected;
  const { service, method } = splitPath(raw.url);
  const resolution = schemas.resolve(raw.url, service, method);
  const { registry } = resolution;
  const desc = resolution.method;
  const warnings: Text[] = [];
  if (desc && resolution.shadowed.length) {
    warnings.push(
      msg("warn.schemaShadowed", { service, used: resolution.schema!.name, others: resolution.shadowed.join(", ") }),
    );
  }
  const decode = (bytes: Uint8Array, type: DescMessage | undefined) => decodeMessage(bytes, codec, type, registry);

  const { request: reqBytes, response: resBytes, requestEncoding, responseEncoding } = bodies;

  let requestMessages: DecodedMessage[] = [];
  let responseMessages: DecodedMessage[] = [];
  let trailers: Header[] = [];
  let status: CallStatus;

  if (transport === "connect") {
    // Unary Connect: bodies are bare messages, errors are JSON.
    if (reqBytes) {
      requestMessages = [
        requestEncoding ? compressedMessage(reqBytes.length, requestEncoding) : decode(reqBytes, desc?.input),
      ];
    }
    trailers = raw.responseHeaders
      .filter((h) => h.name.toLowerCase().startsWith("trailer-"))
      .map((h) => ({ name: h.name.slice("trailer-".length), value: h.value }));
    if (raw.httpStatus === 200) {
      if (resBytes) responseMessages = [decode(resBytes, desc?.output)];
      status = ok();
    } else {
      status = connectErrorStatus(resBytes, raw.httpStatus, registry);
    }
  } else {
    if (reqBytes) {
      const { frames, rest } = parseFrames(reqBytes);
      if (rest.length) warnings.push(msg("warn.incompleteRequestFrame", { bytes: rest.length }));
      requestMessages = frames.map((f) => decodeFrame(f, (b) => decode(b, desc?.input), requestEncoding));
    }
    let endStatus: CallStatus | undefined;
    // gRPC-Web compresses the trailer frame too; it stays unreadable if decompression failed.
    let compressedTrailers = false;
    if (resBytes) {
      const { frames, rest } = parseFrames(resBytes);
      if (rest.length) warnings.push(msg("warn.incompleteResponseFrame", { bytes: rest.length }));
      for (const f of frames) {
        if (transport === "connect-stream" && f.flags & FLAG_CONNECT_END) {
          if (f.flags & FLAG_COMPRESSED) {
            endStatus = unknown(msg("status.compressedTrailers", { encoding: responseEncoding ?? "unknown" }));
          } else {
            const end = parseConnectEnd(f.data, registry);
            trailers = end.trailers;
            endStatus = end.status;
          }
        } else if (transport !== "connect-stream" && f.flags & FLAG_GRPC_WEB_TRAILER) {
          if (f.flags & FLAG_COMPRESSED) compressedTrailers = true;
          else trailers = parseTrailerBlock(utf8Lossy(f.data));
        } else {
          responseMessages.push(decodeFrame(f, (b) => decode(b, desc?.output), responseEncoding));
        }
      }
    }
    if (transport === "connect-stream") {
      status =
        endStatus ??
        (raw.httpStatus !== 200
          ? connectErrorStatus(resBytes, raw.httpStatus, registry)
          : unknown(msg("status.missingEndStream")));
    } else {
      // gRPC-Web: status lives in the trailer frame, or in headers for trailers-only responses.
      status =
        grpcStatusFrom(trailers, registry) ??
        grpcStatusFrom(raw.responseHeaders, registry) ??
        (raw.httpStatus !== 200
          ? {
              code: codeFromHttpStatus(raw.httpStatus),
              name: codeName(codeFromHttpStatus(raw.httpStatus)),
              message: `HTTP ${raw.httpStatus}`,
            }
          : compressedTrailers
            ? unknown(msg("status.compressedTrailers", { encoding: responseEncoding ?? "unknown" }))
            : unknown(msg(transport === "grpc" ? "status.http2TrailersUnavailable" : "status.missingGrpcStatus")));
    }
  }

  return {
    raw,
    path: `/${service}/${method}`,
    service,
    method,
    transport,
    codec,
    schemaFound: desc !== undefined,
    schemaId: resolution.method ? resolution.schema?.id : undefined,
    schemaName: resolution.method ? resolution.schema?.name : undefined,
    outOfScopeSchemas: resolution.outOfScope,
    requestMessages,
    responseMessages,
    trailers,
    status,
    warnings,
  };
}

function splitPath(url: string): { service: string; method: string } {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return { service: parts.at(-2) ?? "", method: parts.at(-1) ?? "" };
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

function compressedMessage(size: number, encoding: string | undefined): DecodedMessage {
  const error = encoding ? msg("warn.compressed", { encoding }) : msg("warn.compressedNoEncoding");
  return { via: "error", value: null, size, error };
}

/** Frames still flagged as compressed here could not be decompressed by decompressBodies(). */
function decodeFrame(f: Frame, decode: (b: Uint8Array) => DecodedMessage, encoding?: string): DecodedMessage {
  if (f.flags & FLAG_COMPRESSED) return compressedMessage(f.data.length, encoding);
  return decode(f.data);
}

export function decodeMessage(
  bytes: Uint8Array,
  codec: Codec,
  type: DescMessage | undefined,
  registry: Registry,
): DecodedMessage {
  const size = bytes.length;
  if (codec === "json") {
    const text = utf8Lossy(bytes);
    try {
      return { via: "json", typeName: type?.typeName, type, value: JSON.parse(text), size };
    } catch (e) {
      return { via: "error", value: text, size, error: msg("warn.jsonParseFailed", { error: String(e) }) };
    }
  }
  let schemaError: Text | undefined;
  if (type) {
    try {
      const message = fromBinary(type, bytes);
      const value = toJson(type, message, { registry });
      const unknownFields = findUnknownFields(type, message);
      return {
        via: "schema",
        typeName: type.typeName,
        type,
        value,
        size,
        ...(unknownFields.length ? { unknownFields } : {}),
      };
    } catch (e) {
      // e.g. the registered schema is stale; fall through to schemaless.
      schemaError = msg("warn.decodeAsTypeFailed", { type: type.typeName, error: String(e) });
    }
  }
  try {
    return { via: "schemaless", value: decodeSchemaless(bytes), size, error: schemaError };
  } catch (e) {
    return { via: "error", value: tryUtf8(bytes) ?? null, size, error: schemaError ?? errorText(e) };
  }
}

function ok(): CallStatus {
  return { code: 0, name: "OK" };
}

function unknown(message: Text): CallStatus {
  return { code: 2, name: "UNKNOWN", message };
}

function grpcStatusFrom(headers: Header[], registry: Registry): CallStatus | undefined {
  const raw = headerValue(headers, "grpc-status");
  if (raw === undefined) return undefined;
  const code = Number(raw);
  const message = headerValue(headers, "grpc-message");
  const detailsBin = headerValue(headers, "grpc-status-details-bin");
  let details: ErrorDetail[] | undefined;
  if (detailsBin) {
    try {
      details = decodeStatusDetails(base64ToBytes(detailsBin), registry);
    } catch {
      // Not a google.rpc.Status; leave details out rather than guess.
    }
  }
  return {
    code,
    name: codeName(code),
    message: message !== undefined ? safeDecodeURIComponent(message) : undefined,
    details,
  };
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

interface ConnectErrorJson {
  code?: string;
  message?: string;
  details?: { type?: string; value?: string; debug?: unknown }[];
}

function connectErrorFromJson(err: ConnectErrorJson, registry: Registry): CallStatus {
  const code = err.code ? codeFromConnectString(err.code) : 2;
  // Prefer decoding the bytes with the schema; the server's debug JSON is only a fallback.
  const details = err.details?.map((d): ErrorDetail =>
    d.value
      ? decodeDetail(d.type ?? "", base64UrlToBytes(d.value), registry, d.debug)
      : { type: d.type ?? "", value: d.debug },
  );
  return { code, name: codeName(code), message: err.message, details };
}

function connectErrorStatus(body: Uint8Array | undefined, httpStatus: number, registry: Registry): CallStatus {
  try {
    const err = JSON.parse(utf8Lossy(body ?? new Uint8Array())) as ConnectErrorJson;
    return connectErrorFromJson(err, registry);
  } catch {
    const code = codeFromHttpStatus(httpStatus);
    return { code, name: codeName(code), message: `HTTP ${httpStatus}` };
  }
}

function parseConnectEnd(data: Uint8Array, registry: Registry): { status: CallStatus; trailers: Header[] } {
  try {
    const end = JSON.parse(utf8Lossy(data)) as { error?: ConnectErrorJson; metadata?: Record<string, string[]> };
    const trailers = Object.entries(end.metadata ?? {}).flatMap(([name, values]) =>
      values.map((value) => ({ name, value })),
    );
    return { status: end.error ? connectErrorFromJson(end.error, registry) : ok(), trailers };
  } catch {
    return { status: unknown(msg("status.badEndStream")), trailers: [] };
  }
}
