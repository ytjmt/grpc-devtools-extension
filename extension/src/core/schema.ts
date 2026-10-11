import {
  createFileRegistry,
  createRegistry,
  fromBinary,
  type DescEnum,
  type DescEnumValue,
  type DescFile,
  type DescMethod,
  type DescService,
  type FileRegistry,
  type Registry,
} from "@bufbuild/protobuf";
import * as wkt from "@bufbuild/protobuf/wkt";
import { LocalizedError } from "../i18n";
import { matchesScope } from "./scope";
import { FileDescriptorSetSchema, type FileDescriptorProto } from "@bufbuild/protobuf/wkt";

/** Well-known types bundled with protobuf-es, used when a descriptor set omits them. */
const BUNDLED: Map<string, DescFile> = new Map(
  Object.entries(wkt)
    .filter(([k]) => k.startsWith("file_google_protobuf_"))
    .map(([, f]) => [(f as DescFile).proto.name, f as DescFile]),
);

export interface LoadedSchema {
  registry: FileRegistry;
  /** Files whose imports could not be resolved and were skipped. */
  skipped: string[];
  services: string[];
}

/**
 * Builds a registry from a serialized google.protobuf.FileDescriptorSet
 * (`buf build -o x.binpb` / `protoc --include_imports --descriptor_set_out=x.pb`).
 * Missing google/protobuf/* imports are filled from the bundled well-known types.
 */
export function loadDescriptorSet(bytes: Uint8Array): LoadedSchema {
  const set = fromBinary(FileDescriptorSetSchema, bytes);
  if (set.file.length === 0) throw new LocalizedError({ key: "error.emptyDescriptorSet" });

  let registry: FileRegistry;
  const skipped: string[] = [];
  try {
    registry = createFileRegistry(set);
  } catch {
    // Fall back to resolving file by file, so one bad import doesn't sink the whole set.
    const byName = new Map(set.file.map((f) => [f.name, f]));
    const built = new Map<string, DescFile>();
    const regs: FileRegistry[] = [];
    const build = (proto: FileDescriptorProto, stack: Set<string>): DescFile | undefined => {
      const done = built.get(proto.name);
      if (done) return done;
      if (stack.has(proto.name)) return undefined;
      stack.add(proto.name);
      try {
        const reg = createFileRegistry(proto, (name) => {
          const dep = byName.get(name);
          const file = dep ? build(dep, stack) : BUNDLED.get(name);
          if (!file) throw new LocalizedError({ key: "error.importNotFound", params: { name } });
          return file;
        });
        const file = reg.getFile(proto.name);
        if (file) {
          built.set(proto.name, file);
          regs.push(reg);
        }
        return file;
      } catch {
        skipped.push(proto.name);
        return undefined;
      } finally {
        stack.delete(proto.name);
      }
    };
    for (const f of set.file) build(f, new Set());
    if (built.size === 0)
      throw new LocalizedError({ key: "error.allFilesFailed", params: { files: skipped.join(", ") } });
    registry = createFileRegistry(...regs);
  }

  const services: string[] = [];
  for (const t of registry) {
    if (t.kind === "service") services.push(t.typeName);
    if (t.kind === "enum") preferFirstAlias(t);
  }
  return { registry, skipped, services: services.sort() };
}

/**
 * With `allow_alias`, several names share a number. protobuf-es looks names up
 * through `DescEnum.value[number]`, which ends up holding the last alias; point
 * it at the first declared name instead, as protoc-based JSON printers do.
 */
function preferFirstAlias(desc: DescEnum) {
  const byNumber = desc.value as Record<number, DescEnumValue>;
  for (const v of [...desc.values].reverse()) byNumber[v.number] = v;
}

export interface IndexedSchema {
  id: string;
  name: string;
  /** Request-URL patterns this schema applies to; empty = every request. */
  scopes: string[];
  loaded: LoadedSchema;
}

export interface Resolution {
  /** Applicable schemas merged, higher priority winning; used for Any / error details too. */
  registry: Registry;
  method?: DescMethod;
  /** The schema that supplied `method`. */
  schema?: Pick<IndexedSchema, "id" | "name">;
  /**
   * Schemas at the same priority as the winner that also define the service:
   * a real ambiguity, unlike an unscoped fallback overridden by a scoped match.
   */
  shadowed: string[];
  /** Schemas that define the service but whose scopes exclude this URL. */
  outOfScope: string[];
}

/**
 * Looks up schemas for a request. Priority: schemas whose scope matches the
 * request URL, then unscoped schemas; within each group, the given order.
 */
export class SchemaIndex {
  private registries = new Map<string, Registry>();

  constructor(readonly schemas: IndexedSchema[]) {}

  /** Convenience for a single unscoped schema (tests, previews). */
  static of(...loaded: LoadedSchema[]): SchemaIndex {
    return new SchemaIndex(loaded.map((l, i) => ({ id: `schema-${i}`, name: `schema-${i}`, scopes: [], loaded: l })));
  }

  static empty = new SchemaIndex([]);

  /** Applicable schemas grouped by priority: scoped matches, then unscoped. */
  private tiers(url: string): IndexedSchema[][] {
    return [
      this.schemas.filter((s) => s.scopes.some((p) => matchesScope(p, url))),
      this.schemas.filter((s) => s.scopes.length === 0),
    ];
  }

  resolve(url: string, service: string, method: string): Resolution {
    const tiers = this.tiers(url);
    const applicable = tiers.flat();
    const defines = (s: IndexedSchema) => s.loaded.registry.getService(service) !== undefined;
    const tier = tiers.find((t) => t.some(defines)) ?? [];
    const [winner, ...shadowed] = tier.filter(defines);
    const desc: DescService | undefined = winner?.loaded.registry.getService(service);
    return {
      registry: this.registryFor(applicable),
      method: desc?.methods.find((m) => m.name === method),
      schema: winner && { id: winner.id, name: winner.name },
      shadowed: shadowed.map((s) => s.name),
      outOfScope: winner
        ? []
        : this.schemas
            .filter((s) => !applicable.includes(s) && s.loaded.registry.getService(service))
            .map((s) => s.name),
    };
  }

  private registryFor(applicable: IndexedSchema[]): Registry {
    const key = applicable.map((s) => s.id).join("\0");
    let registry = this.registries.get(key);
    if (!registry) {
      // createRegistry lets later inputs override earlier ones, so add lowest priority first.
      registry = createRegistry(...BUNDLED.values(), ...[...applicable].reverse().map((s) => s.loaded.registry));
      this.registries.set(key, registry);
    }
    return registry;
  }
}
