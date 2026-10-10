import { ScalarType, type DescField, type DescMessage } from "@bufbuild/protobuf";

/** proto source spelling of a scalar type, e.g. ScalarType.INT64 → "int64". */
export function scalarName(t: ScalarType): string {
  return ScalarType[t].toLowerCase();
}

/** The field's type as written in .proto, without the label: "string", "demo.v1.Mood", "map<string, int32>". */
export function fieldTypeName(field: DescField): string {
  switch (field.fieldKind) {
    case "scalar":
      return scalarName(field.scalar);
    case "enum":
      return field.enum.typeName;
    case "message":
      return field.message.typeName;
    case "list":
      return field.listKind === "scalar"
        ? scalarName(field.scalar)
        : field.listKind === "enum"
          ? field.enum.typeName
          : field.message.typeName;
    case "map": {
      const value =
        field.mapKind === "scalar"
          ? scalarName(field.scalar)
          : field.mapKind === "enum"
            ? field.enum.typeName
            : field.message.typeName;
      return `map<${scalarName(field.mapKey)}, ${value}>`;
    }
  }
}

/** The message or enum a field refers to, for linking. Maps link to their value type. */
export function fieldTypeRef(field: DescField): string | undefined {
  return field.message?.typeName ?? field.enum?.typeName;
}

/** "repeated", "optional", or undefined, as written in .proto. */
export function fieldLabel(field: DescField): "repeated" | "optional" | undefined {
  if (field.fieldKind === "list") return "repeated";
  if (field.proto.proto3Optional) return "optional";
  return undefined;
}

/**
 * Finds the field a JSON path (as produced by toJson) refers to, e.g.
 * ["extra"] or ["items", "0", "name"]. Keys may be JSON names or proto names.
 * Returns undefined for paths that leave the schema, such as inside Any or Struct.
 */
export function fieldAt(message: DescMessage, path: readonly string[]): DescField | undefined {
  let current: DescMessage | undefined = message;
  let field: DescField | undefined;
  for (let i = 0; i < path.length; i++) {
    if (!current) return undefined;
    const key = path[i];
    field = current.fields.find((f) => f.jsonName === key || f.name === key);
    if (!field) return undefined;
    // Skip the list index or map key that follows a repeated or map field.
    if ((field.fieldKind === "list" || field.fieldKind === "map") && i + 1 < path.length) i++;
    current = field.message;
  }
  return field;
}
