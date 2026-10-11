import { create, createFileRegistry, type DescFile } from "@bufbuild/protobuf";
import {
  Edition,
  FeatureSet_FieldPresence,
  FieldDescriptorProto_Label as Label,
  FieldDescriptorProto_Type as Type,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { fileSource, sourceText, typeSource } from "../../extension/src/core/protoSource";
import { loadDescriptorSet } from "../../extension/src/core/schema";

const { registry } = loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url)));

/** Builds a file without source info, as protoc does without --include_source_info. */
function file(init: Parameters<typeof create<typeof FileDescriptorProtoSchema>>[1]): DescFile {
  const proto = create(FileDescriptorProtoSchema, { name: "test.proto", ...init });
  return createFileRegistry(create(FileDescriptorSetSchema, { file: [proto] })).getFile("test.proto")!;
}

describe(".proto reconstruction", () => {
  const files = [...registry.files].filter((f) => !f.proto.name.startsWith("google/"));

  it.each(files.map((f) => f.proto.name))("reproduces example/proto/%s from its source info", (name) => {
    const original = readFileSync(new URL(`../../example/proto/${name}`, import.meta.url), "utf8");
    expect(sourceText(fileSource(registry.getFile(name)!))).toBe(original);
  });

  it("renders one type with links and records type ranges", () => {
    const product = registry.getMessage("shop.v1.Product")!;
    const source = typeSource(product);
    const text = sourceText(source);
    expect(text).toMatch(/^\/\/ Something the shop sells\.\nmessage Product \{\n/);
    expect(text).toMatch(/\n}\n$/);
    const refs = source.lines.flat().filter((t) => t.ref);
    expect(refs).toContainEqual({ text: "Color", ref: "shop.v1.Product.Color" });
    expect(refs).toContainEqual({ text: "common.v1.Money", ref: "common.v1.Money" });

    const whole = fileSource(product.file);
    const range = whole.ranges.get("shop.v1.Product")!;
    const lines = sourceText(whole).split("\n");
    expect(lines[range.start]).toBe("// Something the shop sells.");
    expect(lines[range.end - 1]).toBe("}");
    expect(whole.ranges.get("shop.v1.CatalogService")).toBeDefined();
  });

  it("qualifies names that an inner declaration would capture", () => {
    const f = file({
      syntax: "proto3",
      package: "a.b",
      enumType: [{ name: "Color", value: [{ name: "COLOR_UNSPECIFIED", number: 0 }] }],
      messageType: [
        {
          name: "Paint",
          enumType: [{ name: "Color", value: [{ name: "PAINT_COLOR_UNSPECIFIED", number: 0 }] }],
          field: [
            {
              name: "outer",
              number: 1,
              label: Label.OPTIONAL,
              type: Type.ENUM,
              typeName: ".a.b.Color",
              jsonName: "outer",
            },
            {
              name: "inner",
              number: 2,
              label: Label.OPTIONAL,
              type: Type.ENUM,
              typeName: ".a.b.Paint.Color",
              jsonName: "inner",
            },
          ],
        },
      ],
    });
    const text = sourceText(typeSource(f.messages[0]));
    expect(text).toContain("  .a.b.Color outer = 1;\n");
    expect(text).toContain("  Color inner = 2;\n");
  });

  it("writes proto2 labels, defaults, groups, extension ranges, and extensions", () => {
    const f = file({
      syntax: "proto2",
      package: "p",
      messageType: [
        {
          name: "Req",
          field: [
            { name: "id", number: 1, label: Label.REQUIRED, type: Type.INT64, jsonName: "id" },
            {
              name: "name",
              number: 2,
              label: Label.OPTIONAL,
              type: Type.STRING,
              defaultValue: 'a "b"',
              jsonName: "name",
            },
            {
              name: "result",
              number: 3,
              label: Label.REPEATED,
              type: Type.GROUP,
              typeName: ".p.Req.Result",
              jsonName: "result",
            },
          ],
          nestedType: [
            {
              name: "Result",
              field: [{ name: "url", number: 4, label: Label.OPTIONAL, type: Type.STRING, jsonName: "url" }],
            },
          ],
          extensionRange: [
            { start: 100, end: 200 },
            { start: 1000, end: 536870912 },
          ],
          reservedRange: [{ start: 10, end: 11 }],
        },
      ],
      extension: [
        { name: "tag", number: 100, label: Label.OPTIONAL, type: Type.STRING, extendee: ".p.Req", jsonName: "tag" },
      ],
    });
    expect(sourceText(fileSource(f))).toBe(
      [
        'syntax = "proto2";',
        "",
        "package p;",
        "",
        "message Req {",
        "  reserved 10;",
        "",
        "  extensions 100 to 199, 1000 to max;",
        "",
        "  required int64 id = 1;",
        '  optional string name = 2 [default = "a \\"b\\""];',
        "  repeated group Result = 3 {",
        "    optional string url = 4;",
        "  }",
        "}",
        "",
        "extend Req {",
        "  optional string tag = 100;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes editions syntax with features and identifier reserved names", () => {
    const f = file({
      syntax: "editions",
      edition: Edition.EDITION_2023,
      package: "e",
      messageType: [
        {
          name: "M",
          field: [
            {
              name: "x",
              number: 1,
              label: Label.OPTIONAL,
              type: Type.INT32,
              jsonName: "x",
              options: { features: { fieldPresence: FeatureSet_FieldPresence.IMPLICIT }, deprecated: true },
            },
          ],
          reservedName: ["old", "older"],
        },
      ],
    });
    const text = sourceText(fileSource(f));
    expect(text).toMatch(/^edition = "2023";\n/);
    expect(text).toContain("  reserved old, older;\n");
    expect(text).toContain("  int32 x = 1 [deprecated = true, features.field_presence = IMPLICIT];\n");
  });
});
