import type { DescMessage, Message } from "@bufbuild/protobuf";
import { reflect, type ReflectMessage } from "@bufbuild/protobuf/reflect";

export interface UnknownFieldRef {
  /** JSON-style path to the message holding the field, e.g. "items[0].extra"; "" for the root. */
  path: string;
  number: number;
}

/**
 * Field numbers present on the wire but missing from the schema, anywhere in
 * the message tree. A non-empty result usually means the registered schema is
 * older than the server.
 */
export function findUnknownFields(desc: DescMessage, message: Message): UnknownFieldRef[] {
  const out: UnknownFieldRef[] = [];
  visit(reflect(desc, message as never), "", out);
  return out;
}

function visit(r: ReflectMessage, path: string, out: UnknownFieldRef[]) {
  for (const u of r.getUnknown() ?? []) {
    if (!out.some((o) => o.path === path && o.number === u.no)) out.push({ path, number: u.no });
  }
  const join = (name: string) => (path ? `${path}.${name}` : name);
  for (const field of r.fields) {
    if (!r.isSet(field)) continue;
    if (field.fieldKind === "message") {
      visit(r.get(field) as ReflectMessage, join(field.jsonName), out);
    } else if (field.fieldKind === "list" && field.listKind === "message") {
      let i = 0;
      for (const item of r.get(field) as Iterable<ReflectMessage>) visit(item, `${join(field.jsonName)}[${i++}]`, out);
    } else if (field.fieldKind === "map" && field.mapKind === "message") {
      for (const [key, value] of r.get(field) as Iterable<[unknown, ReflectMessage]>) {
        visit(value, `${join(field.jsonName)}[${String(key)}]`, out);
      }
    }
  }
}
