import { isFieldSet, ScalarType, type DescField } from "@bufbuild/protobuf";
import { toText } from "@bufbuild/protobuf/txtpb";
import type {
  EnumOptionsSchema,
  EnumValueOptionsSchema,
  FieldOptionsSchema,
  FileOptionsSchema,
  MessageOptionsSchema,
  MethodOptionsSchema,
  OneofOptionsSchema,
  ServiceOptionsSchema,
} from "@bufbuild/protobuf/wkt";
import { kw, num, str, type Token } from "./protoTokens";

export type OptionsSchema =
  | typeof FileOptionsSchema
  | typeof MessageOptionsSchema
  | typeof FieldOptionsSchema
  | typeof OneofOptionsSchema
  | typeof EnumOptionsSchema
  | typeof EnumValueOptionsSchema
  | typeof ServiceOptionsSchema
  | typeof MethodOptionsSchema;

/**
 * Options set on a declaration, as `name = value` pairs. Message-valued options
 * such as `features` are flattened into dotted names (`features.field_presence`).
 */
export function optionEntries(
  schema: OptionsSchema,
  options: object | undefined,
): { name: string; number: number; value: Token }[] {
  if (!options) return [];
  const out: { name: string; number: number; value: Token }[] = [];
  const visit = (desc: { fields: DescField[] }, msg: object, prefix: string, number?: number) => {
    for (const field of desc.fields) {
      if (field.name === "uninterpreted_option") continue;
      if (!isFieldSet(msg as never, field)) continue;
      const value = (msg as Record<string, unknown>)[field.localName];
      const name = prefix + field.name;
      const n = number ?? field.number;
      if (field.fieldKind === "message") visit(field.message, value as object, `${name}.`, n);
      else if (field.fieldKind === "list") {
        for (const v of value as unknown[]) out.push({ name, number: n, value: optionValue(field, v) });
      } else out.push({ name, number: n, value: optionValue(field, value) });
    }
  };
  visit(schema, options, "");
  return out;
}

function optionValue(field: DescField, value: unknown): Token {
  if (field.enum) return { text: field.enum.value[value as number]?.name ?? String(value) };
  if (field.message) {
    // Repeated message options: written as an aggregate on one line.
    const text = toText(field.message, value as never)
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .join(" ");
    return { text: `{ ${text} }` };
  }
  switch (field.scalar) {
    case ScalarType.STRING:
      return str(value as string);
    case ScalarType.BYTES:
      return str(new TextDecoder().decode(value as Uint8Array));
    case ScalarType.BOOL:
      return kw(String(value));
    default:
      return num(String(value));
  }
}
