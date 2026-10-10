import type { DescEnum, DescMessage, DescService, FileRegistry } from "@bufbuild/protobuf";
import { fieldTypeRef } from "./fields";

export type TypeDesc = DescMessage | DescEnum | DescService;

export interface TreeNode {
  /** Unique within one schema: the fully qualified name, or "package:<name>". */
  key: string;
  kind: "package" | "service" | "method" | "message" | "enum";
  label: string;
  /** The declaration to show when selected; methods select their service. */
  typeName?: string;
  /** Method name, for methods. */
  member?: string;
  children: TreeNode[];
  /** Why a node matched the search when its own name did not, e.g. a field name. */
  hint?: string;
}

/** Packages → services (with methods), messages (with nested types), enums. */
export function buildTree(registry: FileRegistry): TreeNode[] {
  const packages = new Map<string, TreeNode>();
  const pkg = (name: string) => {
    let node = packages.get(name);
    if (!node) {
      node = { key: `package:${name}`, kind: "package", label: name || "(no package)", children: [] };
      packages.set(name, node);
    }
    return node;
  };
  const messageNode = (m: DescMessage): TreeNode => ({
    key: m.typeName,
    kind: "message",
    label: m.name,
    typeName: m.typeName,
    children: [...m.nestedMessages.map(messageNode), ...m.nestedEnums.map(enumNode)],
  });
  const enumNode = (e: DescEnum): TreeNode => ({ key: e.typeName, kind: "enum", label: e.name, typeName: e.typeName, children: [] });

  for (const file of registry.files) {
    const node = pkg(file.proto.package);
    for (const s of file.services) {
      node.children.push({
        key: s.typeName,
        kind: "service",
        label: s.name,
        typeName: s.typeName,
        children: s.methods.map((m) => ({
          key: `${s.typeName}.${m.name}`,
          kind: "method",
          label: m.name,
          typeName: s.typeName,
          member: m.name,
          children: [],
        })),
      });
    }
    node.children.push(...file.messages.map(messageNode), ...file.enums.map(enumNode));
  }

  const order: Record<TreeNode["kind"], number> = { package: 0, service: 1, method: 1, message: 2, enum: 3 };
  for (const node of packages.values()) {
    node.children.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  }
  // Well-known types (google.*) are references, not the user's API: list them last.
  return [...packages.values()].sort(
    (a, b) => Number(a.label.startsWith("google.")) - Number(b.label.startsWith("google.")) || a.label.localeCompare(b.label),
  );
}

/**
 * Keeps nodes whose name or full name matches, plus messages with a matching
 * field (with a hint), and the ancestors of any match.
 */
export function filterTree(nodes: TreeNode[], query: string, registry: FileRegistry): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, q, registry);
    const selfMatch = node.label.toLowerCase().includes(q) || (node.key.toLowerCase().includes(q) && node.kind !== "package");
    let hint: string | undefined;
    if (!selfMatch && node.kind === "message") {
      const field = registry.getMessage(node.key)?.fields.find((f) => f.name.toLowerCase().includes(q));
      if (field) hint = field.name;
    }
    if (selfMatch || hint || children.length) out.push({ ...node, children: selfMatch ? node.children : children, hint });
  }
  return out;
}

export interface UsageRef {
  /** What to open: a message or a service. */
  typeName: string;
  /** Human-readable location, e.g. "DemoService.Greet (request)" or "GreetResponse.extra". */
  label: string;
}

/** Where each message/enum is referenced: method inputs/outputs and fields. */
export function buildUsages(registry: FileRegistry): Map<string, UsageRef[]> {
  const usages = new Map<string, UsageRef[]>();
  const add = (typeName: string, ref: UsageRef) => {
    const list = usages.get(typeName) ?? [];
    if (!list.some((r) => r.label === ref.label)) list.push(ref);
    usages.set(typeName, list);
  };
  for (const t of registry) {
    if (t.kind === "service") {
      for (const m of t.methods) {
        add(m.input.typeName, { typeName: t.typeName, label: `${t.name}.${m.name} (request)` });
        add(m.output.typeName, { typeName: t.typeName, label: `${t.name}.${m.name} (response)` });
      }
    } else if (t.kind === "message") {
      for (const f of t.fields) {
        const ref = fieldTypeRef(f);
        if (ref) add(ref, { typeName: t.typeName, label: `${t.name}.${f.name}` });
      }
    }
  }
  return usages;
}

export function findType(registry: FileRegistry, typeName: string): TypeDesc | undefined {
  return registry.getMessage(typeName) ?? registry.getEnum(typeName) ?? registry.getService(typeName);
}
