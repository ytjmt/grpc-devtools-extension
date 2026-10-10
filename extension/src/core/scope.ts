/**
 * Schema scopes: URL patterns matched against the *request* URL of an RPC
 * (not the inspected page), e.g. `http://localhost:8080/*` or `https://*.stg.example.com/*`.
 * `*` matches any run of characters; the whole URL must match.
 */

const SCOPE_RE = /^(\*|https?):\/\/[^/\s]+(\/\S*)?$/;

export function isValidScope(pattern: string): boolean {
  return SCOPE_RE.test(pattern);
}

/** "http://localhost:8080" → "http://localhost:8080/*" so origin-only input works as expected. */
export function normalizeScope(pattern: string): string {
  const p = pattern.trim();
  return /^[^:]+:\/\/[^/]+$/.test(p) ? `${p}/*` : p;
}

/** Splits user input (one pattern per line or comma-separated) into normalized patterns. */
export function parseScopes(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map(normalizeScope).filter(Boolean))];
}

export function matchesScope(pattern: string, url: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return re.test(url);
}

/** Suggested scope for a schema fetched from a URL: the same origin. */
export function defaultScopeFor(descriptorUrl: string): string {
  return `${new URL(descriptorUrl).origin}/*`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
