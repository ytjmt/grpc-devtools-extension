import type { DescEnum, DescEnumValue, DescField, DescFile, DescMessage, DescMethod, DescOneof, DescService } from "@bufbuild/protobuf";

export type Commentable = DescMessage | DescEnum | DescEnumValue | DescField | DescOneof | DescService | DescMethod;

// Field numbers in descriptor.proto that form SourceCodeInfo location paths.
const FILE_MESSAGE_TYPE = 4;
const FILE_ENUM_TYPE = 5;
const FILE_SERVICE = 6;
const MESSAGE_FIELD = 2;
const MESSAGE_NESTED_TYPE = 3;
const MESSAGE_ENUM_TYPE = 4;
const MESSAGE_ONEOF_DECL = 8;
const ENUM_VALUE = 2;
const SERVICE_METHOD = 2;

function locate(desc: Commentable): { file: DescFile; path: number[] } {
  switch (desc.kind) {
    case "message":
      return desc.parent
        ? child(desc.parent, MESSAGE_NESTED_TYPE, desc.parent.proto.nestedType.indexOf(desc.proto))
        : { file: desc.file, path: [FILE_MESSAGE_TYPE, desc.file.proto.messageType.indexOf(desc.proto)] };
    case "enum":
      return desc.parent
        ? child(desc.parent, MESSAGE_ENUM_TYPE, desc.parent.proto.enumType.indexOf(desc.proto))
        : { file: desc.file, path: [FILE_ENUM_TYPE, desc.file.proto.enumType.indexOf(desc.proto)] };
    case "enum_value":
      return child(desc.parent, ENUM_VALUE, desc.parent.proto.value.indexOf(desc.proto));
    case "field":
      return child(desc.parent, MESSAGE_FIELD, desc.parent.proto.field.indexOf(desc.proto));
    case "oneof":
      return child(desc.parent, MESSAGE_ONEOF_DECL, desc.parent.proto.oneofDecl.indexOf(desc.proto));
    case "service":
      return { file: desc.file, path: [FILE_SERVICE, desc.file.proto.service.indexOf(desc.proto)] };
    case "rpc":
      return child(desc.parent, SERVICE_METHOD, desc.parent.proto.method.indexOf(desc.proto));
  }
}

function child(parent: Commentable, fieldNumber: number, index: number) {
  const { file, path } = locate(parent);
  return { file, path: [...path, fieldNumber, index] };
}

/**
 * The comment attached to a declaration in the .proto source, if the descriptor
 * set was built with source info (`buf build` does; protoc needs --include_source_info).
 */
export function getComment(desc: Commentable): string | undefined {
  const { file, path } = locate(desc);
  const location = file.proto.sourceCodeInfo?.location.find(
    (l) => l.path.length === path.length && l.path.every((n, i) => n === path[i]),
  );
  const text = location?.leadingComments || location?.trailingComments;
  if (!text) return undefined;
  // Comments keep the space after `//` on each line; strip it and surrounding blank lines.
  return text
    .split("\n")
    .map((line) => line.replace(/^ /, "").trimEnd())
    .join("\n")
    .trim();
}
