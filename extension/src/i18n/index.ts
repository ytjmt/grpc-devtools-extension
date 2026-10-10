import { en, type MessageKey } from "./en";

export type { MessageKey } from "./en";

type Params = Record<string, string | number>;

/**
 * Text that core code hands to the UI: either a literal (e.g. a server-sent
 * grpc-message) or a catalog key, so all UI wording lives in the catalog.
 */
export type Text = string | { key: MessageKey; params?: Params };

export function msg(key: MessageKey, params?: Params): Text {
  return { key, params };
}

/** Thrown by core code; the UI renders `text` through the catalog. */
export class LocalizedError extends Error {
  constructor(readonly text: Exclude<Text, string>) {
    super(t(text.key, text.params));
  }
}

function format(template: string, params?: Params): string {
  return params ? template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : template;
}

export function t(key: MessageKey, params?: Params): string {
  return format(en[key], params);
}

/** Renders core-provided Text: literals pass through, keys are looked up. */
export function renderText(text: Text): string {
  return typeof text === "string" ? text : t(text.key, text.params);
}

/** Renders any thrown value, using the catalog for LocalizedError. */
export function errorText(e: unknown): string {
  if (e instanceof LocalizedError) return renderText(e.text);
  return e instanceof Error ? e.message : String(e);
}
