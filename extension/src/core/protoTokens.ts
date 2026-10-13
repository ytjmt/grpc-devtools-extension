/** Tokens of reconstructed .proto source (see protoSource.ts). */

export interface Token {
  text: string;
  kind?: "keyword" | "comment" | "string" | "number" | "scalar";
  /** Fully qualified name of the type this token refers to. */
  ref?: string;
}

export type Part = Token | string;

export const kw = (text: string): Token => ({ text, kind: "keyword" });
export const num = (n: number | string): Token => ({ text: String(n), kind: "number" });
export const str = (text: string): Token => ({ text: JSON.stringify(text), kind: "string" });
