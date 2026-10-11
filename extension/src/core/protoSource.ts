import {
  isFieldSet,
  ScalarType,
  type DescEnum,
  type DescExtension,
  type DescField,
  type DescFile,
  type DescMessage,
  type DescMethod,
  type DescOneof,
  type DescService,
} from "@bufbuild/protobuf";
import { nestedTypes, protoCamelCase } from "@bufbuild/protobuf/reflect";
import { toText } from "@bufbuild/protobuf/txtpb";
import {
  Edition,
  EnumOptionsSchema,
  EnumValueOptionsSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldDescriptorProtoSchema,
  FieldOptionsSchema,
  FileOptionsSchema,
  MessageOptionsSchema,
  MethodOptionsSchema,
  OneofOptionsSchema,
  ServiceOptionsSchema,
  type SourceCodeInfo_Location,
} from "@bufbuild/protobuf/wkt";
import { locate, sourceLocation } from "./comments";
import { fieldTypeName, fieldTypeRef } from "./fields";

/**
 * Reconstructs .proto source text from descriptors, for reading a schema in its
 * familiar form. Declarations follow the original line order when the
 * descriptor set has source info; formatting and comment placement are
 * normalized. Custom options are not shown (they are extensions the descriptor
 * set does not resolve here).
 */

export interface Token {
  text: string;
  kind?: "keyword" | "comment" | "string" | "number" | "scalar";
  /** Fully qualified name of the type this token refers to. */
  ref?: string;
}

export interface ProtoSource {
  lines: Token[][];
  /** Lines [start, end) covered by each message, enum, and service, including its leading comment. */
  ranges: Map<string, { start: number; end: number }>;
}

export type TopLevelDesc = DescMessage | DescEnum | DescService;

/** The whole file: syntax, package, imports, options, and every declaration. */
export function fileSource(file: DescFile): ProtoSource {
  const w = new Writer(file);
  w.file();
  return w.result();
}

/** One message, enum, or service with everything nested in it. */
export function typeSource(desc: TopLevelDesc): ProtoSource {
  const w = new Writer(desc.file);
  if (desc.kind === "message") w.message(desc);
  else if (desc.kind === "enum") w.enum(desc);
  else w.service(desc);
  return w.result();
}

export function sourceText(source: ProtoSource): string {
  return source.lines.map((line) => line.map((t) => t.text).join("")).join("\n") + "\n";
}

type Part = Token | string;

const kw = (text: string): Token => ({ text, kind: "keyword" });
const num = (n: number | string): Token => ({ text: String(n), kind: "number" });
const str = (text: string): Token => ({ text: JSON.stringify(text), kind: "string" });

/** An entry in a declaration body; entries are sorted by source line and separated by blank lines between groups. */
interface Item {
  line: number;
  /** Source location, used to keep the original blank lines between entries. */
  loc?: SourceCodeInfo_Location;
  group: string;
  write: () => void;
}

const BLOCK = "block";
const UNKNOWN_LINE = Number.MAX_SAFE_INTEGER;
const MESSAGE_MAX = 536870911;
const ENUM_MAX = 2147483647;

// Field numbers in descriptor.proto that form SourceCodeInfo location paths.
const FILE_PACKAGE = 2;
const FILE_DEPENDENCY = 3;
const FILE_EXTENSION = 7;
const FILE_OPTIONS = 8;
const FILE_SYNTAX = 12;
const FILE_EDITION = 14;
const MESSAGE_EXTENSION_RANGE = 5;
const MESSAGE_EXTENSION = 6;
const MESSAGE_OPTIONS = 7;
const MESSAGE_RESERVED_RANGE = 9;
const MESSAGE_RESERVED_NAME = 10;
const ONEOF_OPTIONS = 2;
const ENUM_OPTIONS = 3;
const ENUM_RESERVED_RANGE = 4;
const ENUM_RESERVED_NAME = 5;
const SERVICE_OPTIONS = 3;
const METHOD_OPTIONS = 4;

class Writer {
  private lines: Token[][] = [];
  private ranges = new Map<string, { start: number; end: number }>();
  private depth = 0;
  /** Names visible to name resolution in this file: types and package prefixes. */
  private known = new Set<string>();

  constructor(private readonly f: DescFile) {
    const seen = new Set<DescFile>();
    const visit = (file: DescFile) => {
      if (seen.has(file)) return;
      seen.add(file);
      const parts = file.proto.package ? file.proto.package.split(".") : [];
      parts.forEach((_, i) => this.known.add(parts.slice(0, i + 1).join(".")));
      for (const t of nestedTypes(file)) this.known.add(t.typeName);
      file.dependencies.forEach(visit);
    };
    visit(f);
  }

  result(): ProtoSource {
    while (this.lines.length && this.lines[this.lines.length - 1].length === 0) this.lines.pop();
    return { lines: this.lines, ranges: this.ranges };
  }

  // --- output primitives ---

  private line(...parts: Part[]) {
    const indent = "  ".repeat(this.depth);
    const tokens = parts.map((p) => (typeof p === "string" ? { text: p } : p)).filter((t) => t.text !== "");
    if (indent && tokens.length) tokens.unshift({ text: indent });
    this.lines.push(tokens);
  }

  private blank() {
    if (this.lines.length && this.lines[this.lines.length - 1].length) this.lines.push([]);
  }

  private comment(text: string) {
    for (const l of commentLines(text)) this.line({ text: `//${l}`, kind: "comment" });
  }

  /**
   * Writes one declaration with its comments: `parts;`, or `parts {` body `}`
   * when a body is given. `range` records the lines under that type name.
   */
  private decl(
    where: number[] | SourceCodeInfo_Location | undefined,
    parts: Part[],
    body?: () => void,
    range?: string,
  ) {
    const loc = Array.isArray(where) ? sourceLocation(this.f, where) : where;
    for (const d of loc?.leadingDetachedComments ?? []) {
      this.comment(d);
      this.blank();
    }
    const start = this.lines.length;
    if (loc?.leadingComments) this.comment(loc.leadingComments);
    const trailing = loc?.trailingComments ? commentLines(loc.trailingComments) : [];
    const inline: Part[] = trailing.length === 1 ? [" ", { text: `//${trailing[0]}`, kind: "comment" }] : [];
    const rest = () => {
      if (trailing.length > 1) for (const l of trailing) this.line({ text: `//${l}`, kind: "comment" });
    };
    if (body) {
      const open = this.lines.length;
      this.line(...parts, " {", ...inline);
      this.depth++;
      rest();
      body();
      this.depth--;
      if (this.lines.length === open + 1 && !inline.length) this.lines[open].at(-1)!.text = " {}";
      else this.line("}");
    } else {
      this.line(...parts, ";", ...inline);
      rest();
    }
    if (range) this.ranges.set(range, { start, end: this.lines.length });
  }

  private items(items: Item[]) {
    // Stable sort keeps the descriptor order for declarations without source info.
    const sorted = [...items].sort((a, b) => a.line - b.line);
    sorted.forEach((item, i) => {
      const prev = sorted[i - 1];
      if (prev && separated(prev, item)) this.blank();
      item.write();
    });
  }

  private editions(): boolean {
    return this.f.edition !== Edition.EDITION_PROTO2 && this.f.edition !== Edition.EDITION_PROTO3;
  }

  private at(path: number[]): { line: number; loc?: SourceCodeInfo_Location } {
    const loc = sourceLocation(this.f, path);
    return { line: loc?.span[0] ?? UNKNOWN_LINE, loc };
  }

  /** The location of a whole statement such as `reserved 1, 2;`, which shares its path with its siblings. */
  private statementAt(path: number[], line: number): SourceCodeInfo_Location | undefined {
    return this.f.proto.sourceCodeInfo?.location.find(
      (l) => l.span[0] === line && l.path.length === path.length && l.path.every((n, i) => n === path[i]),
    );
  }

  // --- declarations ---

  file() {
    const p = this.f.proto;
    const items: Item[] = [];
    items.push(
      this.editions()
        ? {
            ...this.at([FILE_EDITION]),
            group: "syntax",
            write: () => this.decl([FILE_EDITION], [kw("edition"), " = ", str(Edition[this.f.edition].replace("EDITION_", ""))]),
          }
        : {
            ...this.at([FILE_SYNTAX]),
            group: "syntax",
            write: () =>
              this.decl([FILE_SYNTAX], [kw("syntax"), " = ", str(this.f.edition === Edition.EDITION_PROTO2 ? "proto2" : "proto3")]),
          },
    );
    if (p.package) {
      items.push({
        ...this.at([FILE_PACKAGE]),
        group: "package",
        write: () => this.decl([FILE_PACKAGE], [kw("package"), " ", p.package]),
      });
    }
    p.dependency.forEach((dep, i) => {
      const modifier = p.publicDependency.includes(i) ? "public" : p.weakDependency.includes(i) ? "weak" : undefined;
      items.push({
        ...this.at([FILE_DEPENDENCY, i]),
        group: "import",
        write: () => this.decl([FILE_DEPENDENCY, i], [kw("import"), " ", ...(modifier ? [kw(modifier), " "] : []), str(dep)]),
      });
    });
    items.push(...this.optionItems(FileOptionsSchema, p.options, [FILE_OPTIONS]));
    items.push(...this.typeItems(this.f.enums, this.f.messages, this.f.services));
    items.push(...this.extendItems(this.f.extensions, FILE_EXTENSION, []));
    // Keep the header order (syntax, package, imports, options) even without source info.
    this.items(items.map((item, i) => (item.line === UNKNOWN_LINE && item.group !== BLOCK ? { ...item, line: i - items.length } : item)));
  }

  private typeItems(enums: DescEnum[], messages: DescMessage[], services: DescService[] = []): Item[] {
    const all: (DescEnum | DescMessage | DescService)[] = [...enums, ...messages, ...services];
    return all.map((d) => ({
      ...this.at(locate(d).path),
      group: BLOCK,
      write: () => (d.kind === "message" ? this.message(d) : d.kind === "enum" ? this.enum(d) : this.service(d)),
    }));
  }

  message(m: DescMessage) {
    const path = locate(m).path;
    this.decl(path, [kw("message"), " ", m.name], () => this.messageBody(m, path), m.typeName);
  }

  private messageBody(m: DescMessage, path: number[]) {
    const groups = new Set(m.fields.filter((f) => this.isGroup(f)).map((f) => f.message));
    const nested = m.nestedMessages.filter((n) => !n.proto.options?.mapEntry && !groups.has(n));
    const items: Item[] = [
      ...this.optionItems(MessageOptionsSchema, m.proto.options, [...path, MESSAGE_OPTIONS], ["map_entry"]),
      ...this.typeItems(m.nestedEnums, nested),
      ...this.rangeItems(path, MESSAGE_RESERVED_RANGE, "reserved", m.proto.reservedRange, MESSAGE_MAX, true),
      ...this.nameItems(path, MESSAGE_RESERVED_NAME, m.proto.reservedName),
      ...this.rangeItems(path, MESSAGE_EXTENSION_RANGE, "extensions", m.proto.extensionRange, MESSAGE_MAX, true),
      ...m.members.map((member) =>
        member.kind === "oneof"
          ? { ...this.at(locate(member).path), group: BLOCK, write: () => this.oneof(member) }
          : { ...this.at(locate(member).path), group: "field", write: () => this.field(member, m.typeName) },
      ),
      ...this.extendItems(m.nestedExtensions, MESSAGE_EXTENSION, path),
    ];
    this.items(items);
  }

  private oneof(o: DescOneof) {
    const path = locate(o).path;
    this.decl(path, [kw("oneof"), " ", o.name], () =>
      this.items([
        ...this.optionItems(OneofOptionsSchema, o.proto.options, [...path, ONEOF_OPTIONS]),
        ...o.fields.map((f) => ({
          ...this.at(locate(f).path),
          group: "field",
          write: () => this.field(f, o.parent.typeName),
        })),
      ]),
    );
  }

  private isGroup(f: DescField | DescExtension): f is (DescField | DescExtension) & { message: DescMessage } {
    // Editions encode delimited fields with TYPE_GROUP too, but write them as ordinary fields.
    return this.f.edition === Edition.EDITION_PROTO2 && f.proto.type === FieldDescriptorProto_Type.GROUP;
  }

  private field(f: DescField | DescExtension, scope: string, path = locate(f as DescField).path) {
    const label = this.label(f);
    const head: Part[] = label ? [kw(label), " "] : [];
    const options = this.fieldOptions(f);
    if (this.isGroup(f)) {
      const group = f.message;
      this.decl(path, [...head, kw("group"), " ", group.name, " = ", num(f.number), ...options], () =>
        this.messageBody(group, locate(group).path),
      );
      return;
    }
    this.decl(path, [...head, ...this.typeParts(f, scope), " ", f.name, " = ", num(f.number), ...options]);
  }

  private label(f: DescField | DescExtension): string | undefined {
    if (f.fieldKind === "list") return "repeated";
    if (f.fieldKind === "map" || f.oneof) return undefined;
    if (f.proto.label === FieldDescriptorProto_Label.REQUIRED) return "required";
    if (this.f.edition === Edition.EDITION_PROTO2) return "optional";
    if (f.proto.proto3Optional) return "optional";
    return undefined;
  }

  private typeParts(f: DescField | DescExtension, scope: string): Part[] {
    const name = fieldTypeName(f as DescField);
    const ref = fieldTypeRef(f as DescField);
    if (!ref) return [{ text: name, kind: f.fieldKind === "map" ? undefined : "scalar" }];
    const at = name.lastIndexOf(ref);
    return [name.slice(0, at), { text: this.relativeName(ref, scope), ref }, name.slice(at + ref.length)];
  }

  /** `[default = …, json_name = …, deprecated = true]`, or nothing. */
  private fieldOptions(f: DescField | DescExtension): Part[] {
    const entries: Part[][] = [];
    if (isFieldSet(f.proto, FieldDescriptorProtoSchema.field.defaultValue)) {
      entries.push(["default = ", this.defaultValue(f)]);
    }
    if (f.kind === "field" && f.proto.jsonName && f.proto.jsonName !== protoCamelCase(f.name)) {
      entries.push(["json_name = ", str(f.proto.jsonName)]);
    }
    for (const o of optionEntries(FieldOptionsSchema, f.proto.options)) entries.push([`${o.name} = `, o.value]);
    if (entries.length === 0) return [];
    return [" [", ...entries.flatMap((e, i) => (i ? [", ", ...e] : e)), "]"];
  }

  private defaultValue(f: DescField | DescExtension): Token {
    const v = f.proto.defaultValue;
    if (f.proto.type === FieldDescriptorProto_Type.STRING) return str(v);
    // Bytes defaults are stored C-escaped already.
    if (f.proto.type === FieldDescriptorProto_Type.BYTES) return { text: `"${v}"`, kind: "string" };
    if (f.proto.type === FieldDescriptorProto_Type.ENUM) return { text: v };
    return num(v);
  }

  enum(e: DescEnum) {
    const path = locate(e).path;
    this.decl(
      path,
      [kw("enum"), " ", e.name],
      () =>
        this.items([
          ...this.optionItems(EnumOptionsSchema, e.proto.options, [...path, ENUM_OPTIONS]),
          ...this.rangeItems(path, ENUM_RESERVED_RANGE, "reserved", e.proto.reservedRange, ENUM_MAX, false),
          ...this.nameItems(path, ENUM_RESERVED_NAME, e.proto.reservedName),
          ...e.values.map((v) => {
            const vpath = locate(v).path;
            const options = optionEntries(EnumValueOptionsSchema, v.proto.options);
            const opts: Part[] = options.length
              ? [" [", ...options.flatMap((o, i) => [...(i ? [", "] : []), `${o.name} = `, o.value]), "]"]
              : [];
            return {
              ...this.at(vpath),
              group: "value",
              write: () => this.decl(vpath, [v.name, " = ", num(v.number), ...opts]),
            };
          }),
        ]),
      e.typeName,
    );
  }

  service(s: DescService) {
    const path = locate(s).path;
    this.decl(
      path,
      [kw("service"), " ", s.name],
      () =>
        this.items([
          ...this.optionItems(ServiceOptionsSchema, s.proto.options, [...path, SERVICE_OPTIONS]),
          ...s.methods.map((m) => ({
            ...this.at(locate(m).path),
            group: "rpc",
            write: () => this.method(m, s),
          })),
        ]),
      s.typeName,
    );
  }

  private method(m: DescMethod, s: DescService) {
    const path = locate(m).path;
    const scope = s.file.proto.package;
    const stream = (yes: boolean): Part[] => (yes ? [kw("stream"), " "] : []);
    const parts: Part[] = [
      kw("rpc"),
      " ",
      m.name,
      "(",
      ...stream(m.methodKind === "client_streaming" || m.methodKind === "bidi_streaming"),
      { text: this.relativeName(m.input.typeName, scope), ref: m.input.typeName },
      ") ",
      kw("returns"),
      " (",
      ...stream(m.methodKind === "server_streaming" || m.methodKind === "bidi_streaming"),
      { text: this.relativeName(m.output.typeName, scope), ref: m.output.typeName },
      ")",
    ];
    const options = this.optionItems(MethodOptionsSchema, m.proto.options, [...path, METHOD_OPTIONS]);
    this.decl(path, parts, options.length ? () => this.items(options) : undefined);
  }

  /** `extend Foo { … }` blocks, one per run of consecutive extensions of the same message. */
  private extendItems(exts: DescExtension[], fieldNumber: number, parentPath: number[]): Item[] {
    const runs: DescExtension[][] = [];
    for (const x of exts) {
      const last = runs[runs.length - 1];
      if (last && last[0].extendee === x.extendee) last.push(x);
      else runs.push([x]);
    }
    const scope = exts[0]?.parent?.typeName ?? this.f.proto.package;
    const owner = exts[0]?.parent?.proto.extension ?? this.f.proto.extension;
    const pathOf = (x: DescExtension) => [...parentPath, fieldNumber, owner.indexOf(x.proto)];
    return runs.map((run) => ({
      ...this.at(pathOf(run[0])),
      group: BLOCK,
      write: () =>
        this.decl(
          undefined,
          [kw("extend"), " ", { text: this.relativeName(run[0].extendee.typeName, scope), ref: run[0].extendee.typeName }],
          () => {
            for (const x of run) this.field(x, scope, pathOf(x));
          },
        ),
    }));
  }

  private optionItems(
    schema: Parameters<typeof optionEntries>[0],
    options: Parameters<typeof optionEntries>[1],
    path: number[],
    skip: string[] = [],
  ): Item[] {
    return optionEntries(schema, options)
      .filter((o) => !skip.includes(o.name))
      .map((o) => ({
        ...this.at([...path, o.number]),
        group: "option",
        write: () => this.decl([...path, o.number], [kw("option"), " ", o.name, " = ", o.value]),
      }));
  }

  /**
   * `reserved 9, 15 to 20;` and `extensions 100 to max;`. Ranges written in one
   * statement share a source line, which is how they are grouped back together.
   */
  private rangeItems(
    path: number[],
    fieldNumber: number,
    keyword: string,
    ranges: { start: number; end: number }[],
    max: number,
    exclusiveEnd: boolean,
  ): Item[] {
    const statements: { line: number; ranges: { start: number; end: number }[] }[] = [];
    ranges.forEach((r, i) => {
      const { line } = this.at([...path, fieldNumber, i]);
      const last = statements[statements.length - 1];
      if (last && last.line === line) last.ranges.push(r);
      else statements.push({ line, ranges: [r] });
    });
    return statements.map((s) => {
      const loc = this.statementAt([...path, fieldNumber], s.line);
      return {
        line: s.line,
        loc,
        group: keyword,
        write: () =>
          this.decl(loc, [
            kw(keyword),
            " ",
            ...s.ranges.flatMap((r, i) => {
              const end = exclusiveEnd ? r.end - 1 : r.end;
              const parts: Part[] = i ? [", ", num(r.start)] : [num(r.start)];
              if (end !== r.start) parts.push(" ", kw("to"), " ", end === max ? kw("max") : num(end));
              return parts;
            }),
          ]),
      };
    });
  }

  private nameItems(path: number[], fieldNumber: number, names: string[]): Item[] {
    const statements: { line: number; names: string[] }[] = [];
    names.forEach((n, i) => {
      const { line } = this.at([...path, fieldNumber, i]);
      const last = statements[statements.length - 1];
      if (last && last.line === line) last.names.push(n);
      else statements.push({ line, names: [n] });
    });
    // Editions write reserved names as identifiers rather than strings.
    const identifiers = this.editions();
    return statements.map((s) => {
      const loc = this.statementAt([...path, fieldNumber], s.line);
      return {
        line: s.line,
        loc,
        group: "reserved",
        write: () =>
          this.decl(loc, [
            kw("reserved"),
            " ",
            ...s.names.flatMap((n, i) => [...(i ? [", "] : []), identifiers ? n : str(n)]),
          ]),
      };
    });
  }

  /**
   * The shortest name that still resolves to `target` from `scope`, following
   * protobuf's scoping rules: the innermost scope declaring the first name
   * component wins, so a shorter name is only used when nothing captures it.
   */
  private relativeName(target: string, scope: string): string {
    const scopes: string[] = [];
    for (let s = scope; s; s = s.includes(".") ? s.slice(0, s.lastIndexOf(".")) : "") scopes.push(s);
    scopes.push("");
    for (let i = 0; i < scopes.length; i++) {
      const prefix = scopes[i] ? `${scopes[i]}.` : "";
      if (!target.startsWith(prefix)) continue;
      const rel = target.slice(prefix.length);
      const head = rel.split(".")[0];
      const captured = scopes.slice(0, i).some((inner) => this.known.has(`${inner}.${head}`));
      return captured ? `.${target}` : rel;
    }
    return `.${target}`;
  }
}

/**
 * Whether a blank line goes between two entries: as in the source when both
 * have locations, else between groups and around blocks.
 */
function separated(prev: Item, next: Item): boolean {
  if (prev.loc && next.loc) {
    const prevEnd = prev.loc.span.length === 4 ? prev.loc.span[2] : prev.loc.span[0];
    const comment = next.loc.leadingComments ? commentLines(next.loc.leadingComments).length : 0;
    return next.loc.span[0] - comment > prevEnd + 1;
  }
  return prev.group !== next.group || next.group === BLOCK;
}

function commentLines(text: string): string[] {
  return text.replace(/\n$/, "").split("\n");
}

type OptionsSchema =
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
function optionEntries(
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
