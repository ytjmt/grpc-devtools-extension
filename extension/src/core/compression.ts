import { extractBodies, type Bodies } from "./decode";
import { detectProtocol, encodeFrames, FLAG_COMPRESSED, parseFrames } from "./framing";
import type { RawCall } from "./types";

/** gRPC / Connect encoding names → Compression Streams formats. */
const FORMATS: Record<string, string> = { gzip: "gzip", deflate: "deflate", br: "brotli" };

/** The DecompressionStream format for an encoding, if this browser supports it. */
function formatFor(encoding: string): CompressionFormat | undefined {
  const format = FORMATS[encoding] as CompressionFormat | undefined;
  if (!format) return undefined;
  try {
    new DecompressionStream(format);
    return format;
  } catch {
    return undefined; // e.g. brotli in older browsers
  }
}

async function inflate(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** True when the call uses RPC-level compression, so decompressBodies() is worth awaiting. */
export function isCompressed(raw: RawCall): boolean {
  if (!detectProtocol(raw.url, raw.httpMethod, raw.requestHeaders)) return false;
  const { requestEncoding, responseEncoding } = extractBodies(raw);
  return Boolean(requestEncoding || responseEncoding);
}

/**
 * Bodies with RPC-level compression undone. Frames (or unary bodies) that use an
 * unsupported encoding or fail to inflate are left compressed; decodeCall then
 * reports them with the encoding's name.
 */
export async function decompressBodies(raw: RawCall): Promise<Bodies> {
  const detected = detectProtocol(raw.url, raw.httpMethod, raw.requestHeaders);
  const bodies = extractBodies(raw);
  if (!detected) return bodies;
  const enveloped = detected.transport !== "connect";

  const undo = async (bytes: Uint8Array | undefined, encoding: string | undefined) => {
    const format = encoding ? formatFor(encoding) : undefined;
    if (!bytes || !format) return { bytes, encoding };
    if (!enveloped) {
      try {
        return { bytes: await inflate(bytes, format), encoding: undefined };
      } catch {
        return { bytes, encoding };
      }
    }
    const { frames, rest } = parseFrames(bytes);
    const inflated = await Promise.all(
      frames.map(async (f) => {
        if (!(f.flags & FLAG_COMPRESSED)) return f;
        try {
          return { flags: f.flags & ~FLAG_COMPRESSED, data: await inflate(f.data, format) };
        } catch {
          return f; // stays flagged, reported by decodeCall
        }
      }),
    );
    return { bytes: encodeFrames(inflated, rest), encoding };
  };

  const request = await undo(bodies.request, bodies.requestEncoding);
  const response = await undo(bodies.response, bodies.responseEncoding);
  return {
    request: request.bytes,
    response: response.bytes,
    requestEncoding: request.encoding,
    responseEncoding: response.encoding,
  };
}
