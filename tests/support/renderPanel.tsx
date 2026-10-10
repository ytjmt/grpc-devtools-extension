import { render } from "vitest-browser-react";
import descriptorUrl from "../../example/descriptor.binpb?url";
import { CaptureStore } from "../../extension/src/capture";
import type { SchemaSource } from "../../extension/src/core/storage";
import type { RawCall } from "../../extension/src/core/types";
import { App } from "../../extension/src/panel/App";
import { fakeSchemaBackend, loadDescriptor } from "./fakeSchemaBackend";

export { descriptorUrl };

export async function demoSchemaSource(overrides: Partial<SchemaSource> = {}): Promise<SchemaSource> {
  return {
    id: "demo",
    name: "descriptor.binpb",
    kind: "file",
    bytes: await loadDescriptor(descriptorUrl),
    enabled: true,
    updatedAt: Date.UTC(2026, 0, 1, 9, 0, 0),
    ...overrides,
  };
}

/** Renders the whole panel as DevTools would, with recorded calls and an in-memory schema backend. */
export async function renderPanel(
  options: {
    calls?: RawCall[];
    sources?: SchemaSource[];
    urls?: Record<string, ArrayBuffer>;
    grantPermission?: boolean;
    theme?: "light" | "dark";
    size?: { width: number; height: number };
  } = {},
) {
  if (options.theme === "dark") document.documentElement.classList.add("dark");
  const store = new CaptureStore();
  for (const { id: _id, ...call } of options.calls ?? []) store.add(call);
  const { backend, sources } = fakeSchemaBackend(options);

  const container = document.createElement("div");
  container.id = "root";
  const { width, height } = options.size ?? { width: 1000, height: 640 };
  container.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.append(container);

  const screen = await render(<App store={store} schemaBackend={backend} />, { container });
  return { screen, store, sources, container };
}
