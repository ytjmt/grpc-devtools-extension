import { LocalizedError } from "../i18n";
import { bytesToBase64, tryUtf8 } from "./bytes";

/**
 * Best-effort decoding of protobuf wire format without a schema.
 * Output keys are field numbers; length-delimited values are shown as a
 * nested message, a string, or base64 bytes, whichever fits best.
 */
export function decodeSchemaless(bytes: Uint8Array, depth = 0): Record<string, unknown> {
  const fields = parseFields(bytes);
  if (!fields) throw new LocalizedError({ key: "warn.notProtobuf" });
  const byNo = new Map<number, unknown[]>();
  for (const f of fields) {
    const list = byNo.get(f.no) ?? [];
    list.push(render(f, depth));
    byNo.set(f.no, list);
  }
  const out: Record<string, unknown> = {};
  for (const [no, values] of byNo) out[no] = values.length === 1 ? values[0] : values;
  return out;
}

type Field =
  | { no: number; wire: 0; value: bigint }
  | { no: number; wire: 1; value: Uint8Array }
  | { no: number; wire: 2; value: Uint8Array }
  | { no: number; wire: 5; value: Uint8Array };

function readVarint(b: Uint8Array, off: number): [bigint, number] | undefined {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (off >= b.length) return undefined;
    const byte = b[off++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, off];
    shift += 7n;
  }
  return undefined;
}

/** Returns undefined unless the whole buffer parses as well-formed fields. */
function parseFields(b: Uint8Array): Field[] | undefined {
  const fields: Field[] = [];
  let off = 0;
  while (off < b.length) {
    const tag = readVarint(b, off);
    if (!tag) return undefined;
    off = tag[1];
    const no = Number(tag[0] >> 3n);
    const wire = Number(tag[0] & 7n);
    if (no < 1 || no > 536870911) return undefined;
    switch (wire) {
      case 0: {
        const v = readVarint(b, off);
        if (!v) return undefined;
        fields.push({ no, wire, value: v[0] });
        off = v[1];
        break;
      }
      case 1:
        if (off + 8 > b.length) return undefined;
        fields.push({ no, wire, value: b.subarray(off, off + 8) });
        off += 8;
        break;
      case 2: {
        const len = readVarint(b, off);
        if (!len) return undefined;
        off = len[1];
        const end = off + Number(len[0]);
        if (end > b.length) return undefined;
        fields.push({ no, wire, value: b.subarray(off, end) });
        off = end;
        break;
      }
      case 5:
        if (off + 4 > b.length) return undefined;
        fields.push({ no, wire, value: b.subarray(off, off + 4) });
        off += 4;
        break;
      default:
        // Groups (3/4) are deprecated; treat as undecodable.
        return undefined;
    }
  }
  return fields;
}

/** No control characters other than tab/newline: almost certainly a string field. */
function isCleanText(s: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
}

function render(f: Field, depth: number): unknown {
  switch (f.wire) {
    case 0: {
      const v = f.value;
      // Negative int32/int64 are encoded as 10-byte two's complement.
      const signed = v >= 1n << 63n ? v - (1n << 64n) : v;
      return Number.isSafeInteger(Number(signed)) ? Number(signed) : signed.toString();
    }
    case 1: {
      const dv = new DataView(f.value.buffer, f.value.byteOffset, 8);
      return { fixed64: dv.getBigUint64(0, true).toString(), double: dv.getFloat64(0, true) };
    }
    case 5: {
      const dv = new DataView(f.value.buffer, f.value.byteOffset, 4);
      return { fixed32: dv.getUint32(0, true), float: dv.getFloat32(0, true) };
    }
    case 2: {
      // Prefer: clean text → nested message → bytes. Text with control chars that
      // also parses as fields is almost always an embedded message.
      const text = tryUtf8(f.value);
      if (text !== undefined && isCleanText(text)) return text;
      if (depth < 32 && f.value.length > 0 && parseFields(f.value)) {
        return decodeSchemaless(f.value, depth + 1);
      }
      return { bytes: bytesToBase64(f.value) };
    }
  }
}
