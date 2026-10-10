import type { DescMessage } from "@bufbuild/protobuf";
import type { Text } from "../i18n";
import type { UnknownFieldRef } from "./unknownFields";

/** One HTTP exchange captured from chrome.devtools.network, kept undecoded. */
export interface RawCall {
  id: number;
  url: string;
  httpMethod: string;
  startedDateTime: string;
  /** Total time in ms. */
  time: number;
  httpStatus: number;
  requestHeaders: Header[];
  responseHeaders: Header[];
  /** HAR postData.text (Latin-1 for binary bodies). */
  requestBodyText: string | null;
  responseBody: { content: string | null; encoding: string };
}

export interface Header {
  name: string;
  value: string;
}

export type Transport = "grpc-web" | "grpc-web-text" | "connect" | "connect-stream" | "grpc";
export type Codec = "proto" | "json";

export interface Frame {
  flags: number;
  data: Uint8Array;
}

/** A decoded protobuf message, or why it could not be decoded. */
export interface DecodedMessage {
  /** "schema" = decoded with a registered type, "json" = JSON codec, "schemaless" = wire-format guess. */
  via: "schema" | "json" | "schemaless" | "error";
  typeName?: string;
  /** The message type when known: drives field tooltips and links to the schema browser. */
  type?: DescMessage;
  value: unknown;
  size: number;
  error?: Text;
  /** Fields on the wire that the schema does not define (schema may be outdated). */
  unknownFields?: UnknownFieldRef[];
}

export interface CallStatus {
  /** gRPC status code (0 = OK). */
  code: number;
  name: string;
  /** Server-sent grpc-message (literal) or a synthesized explanation (catalog key). */
  message?: Text;
  details?: unknown;
}

export interface DecodedCall {
  raw: RawCall;
  /** "/pkg.Service/Method" */
  path: string;
  service: string;
  method: string;
  transport: Transport;
  codec: Codec;
  /** True when a registered schema knows this method. */
  schemaFound: boolean;
  /** Id and name of the schema used for decoding, when found. */
  schemaId?: string;
  schemaName?: string;
  /** Schemas defining this service whose scopes exclude the request URL. */
  outOfScopeSchemas: string[];
  requestMessages: DecodedMessage[];
  responseMessages: DecodedMessage[];
  trailers: Header[];
  status: CallStatus;
  warnings: Text[];
}
