import { create, createFileRegistry, fromBinary, toJson, type DescMessage, type Registry } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  file_google_protobuf_any,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { bytesToBase64 } from "./bytes";
import { decodeSchemaless } from "./schemaless";

const { OPTIONAL, REPEATED } = FieldDescriptorProto_Label;
const { INT32, STRING, MESSAGE } = FieldDescriptorProto_Type;

/**
 * google.rpc.Status, which gRPC sends base64-encoded in `grpc-status-details-bin`.
 * Bundled so error details decode even when the user's schema lacks googleapis.
 */
export const RpcStatusSchema: DescMessage = createFileRegistry(
  create(FileDescriptorProtoSchema, {
    name: "google/rpc/status.proto",
    package: "google.rpc",
    dependency: ["google/protobuf/any.proto"],
    syntax: "proto3",
    messageType: [
      {
        name: "Status",
        field: [
          { name: "code", number: 1, type: INT32, label: OPTIONAL, jsonName: "code" },
          { name: "message", number: 2, type: STRING, label: OPTIONAL, jsonName: "message" },
          {
            name: "details",
            number: 3,
            type: MESSAGE,
            label: REPEATED,
            typeName: ".google.protobuf.Any",
            jsonName: "details",
          },
        ],
      },
    ],
  }),
  (name) => (name === "google/protobuf/any.proto" ? file_google_protobuf_any : undefined),
).getMessage("google.rpc.Status")!;

/** One error detail, the same shape for gRPC and Connect. */
export interface ErrorDetail {
  /** Fully qualified message name, e.g. "shop.v1.OutOfStock". */
  type: string;
  value: unknown;
}

/**
 * Decodes an error detail with the registered schema. Without one, falls back
 * to `fallback` (Connect's debug JSON), then a schemaless guess, then base64.
 */
export function decodeDetail(typeUrl: string, bytes: Uint8Array, registry: Registry, fallback?: unknown): ErrorDetail {
  const type = typeUrl.slice(typeUrl.lastIndexOf("/") + 1);
  const desc = registry.getMessage(type);
  if (desc) {
    try {
      return { type, value: toJson(desc, fromBinary(desc, bytes), { registry }) };
    } catch {
      // Stale schema: fall through.
    }
  }
  if (fallback !== undefined) return { type, value: fallback };
  try {
    return { type, value: decodeSchemaless(bytes) };
  } catch {
    return { type, value: { bytes: bytesToBase64(bytes) } };
  }
}

/** The details carried by a serialized google.rpc.Status. */
export function decodeStatusDetails(bytes: Uint8Array, registry: Registry): ErrorDetail[] {
  const status = fromBinary(RpcStatusSchema, bytes) as unknown as { details: { typeUrl: string; value: Uint8Array }[] };
  return status.details.map((d) => decodeDetail(d.typeUrl, d.value, registry));
}
