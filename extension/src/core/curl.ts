import type { DecodedCall, Header } from "./types";

/** Where the schema came from, so the command can point the tool at the same descriptor. */
export interface SchemaRef {
  kind: "file" | "url";
  name: string;
  url?: string;
}

/** Headers the browser or the RPC library adds by itself; the tools set their own. */
const SKIPPED_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connect-accept-encoding",
  "connect-content-encoding",
  "connect-protocol-version",
  "connect-timeout-ms",
  "connection",
  "content-length",
  "content-type",
  "dnt",
  "grpc-accept-encoding",
  "grpc-encoding",
  "grpc-timeout",
  "host",
  "origin",
  "pragma",
  "priority",
  "referer",
  "te",
  "user-agent",
  "x-grpc-web",
  "x-user-agent",
]);

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function forwardedHeaders(headers: Header[]): Header[] {
  return headers.filter((h) => {
    const name = h.name.toLowerCase();
    return !name.startsWith(":") && !name.startsWith("sec-") && !SKIPPED_HEADERS.has(name);
  });
}

/** The request as JSON documents, or undefined when it could not be decoded with a schema. */
function requestData(call: DecodedCall): string | undefined {
  const messages = call.requestMessages;
  if (messages.length === 0 || messages.some((m) => m.via !== "schema" && m.via !== "json")) return undefined;
  return messages.map((m) => JSON.stringify(m.value)).join(" ");
}

function format(parts: string[]): string {
  return parts.join(" \\\n  ");
}

/** `buf curl` invocation reproducing the call, or undefined if the request body is not available as JSON. */
export function toBufCurl(call: DecodedCall, schema?: SchemaRef): string | undefined {
  const data = requestData(call);
  if (data === undefined) return undefined;
  const url = new URL(call.raw.url);
  url.search = "";
  const parts = ["buf curl"];
  if (schema) parts.push(`--schema ${shellQuote(schema.kind === "url" && schema.url ? schema.url : schema.name)}`);
  if (call.transport === "grpc-web" || call.transport === "grpc-web-text") parts.push("--protocol grpcweb");
  if (call.transport === "grpc") {
    parts.push("--protocol grpc");
    if (url.protocol === "http:") parts.push("--http2-prior-knowledge");
  }
  for (const h of forwardedHeaders(call.raw.requestHeaders)) parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  parts.push(`-d ${shellQuote(data)}`);
  parts.push(shellQuote(url.toString()));
  return format(parts);
}

/**
 * `grpcurl` invocation for the same method. grpcurl speaks native gRPC only, so
 * the target must serve gRPC (HTTP/2) at this host; a URL path prefix cannot be expressed.
 */
export function toGrpcurl(call: DecodedCall, schema?: SchemaRef): string | undefined {
  const data = requestData(call);
  if (data === undefined) return undefined;
  const url = new URL(call.raw.url);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const parts = ["grpcurl"];
  if (url.protocol === "http:") parts.push("-plaintext");
  // grpcurl reads descriptor sets from local files only.
  if (schema) parts.push(`-protoset ${shellQuote(schema.kind === "url" && schema.url ? basename(schema.url) : schema.name)}`);
  for (const h of forwardedHeaders(call.raw.requestHeaders)) parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  parts.push(`-d ${shellQuote(data)}`);
  parts.push(`${url.hostname}:${port}`);
  parts.push(`${call.service}/${call.method}`);
  return format(parts);
}

function basename(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "descriptor.binpb";
}
