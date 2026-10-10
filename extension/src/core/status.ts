const NAMES = [
  "OK",
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "UNAUTHENTICATED",
] as const;

export function codeName(code: number): string {
  return NAMES[code] ?? `CODE_${code}`;
}

/** Connect protocol uses snake_case string codes in JSON errors. */
export function codeFromConnectString(s: string): number {
  const i = NAMES.indexOf(s.toUpperCase() as (typeof NAMES)[number]);
  return i >= 0 ? i : 2;
}

/** https://connectrpc.com/docs/protocol/#http-to-error-code */
export function codeFromHttpStatus(status: number): number {
  switch (status) {
    case 400:
      return 13;
    case 401:
      return 16;
    case 403:
      return 7;
    case 404:
      return 12;
    case 429:
    case 502:
    case 503:
    case 504:
      return 14;
    default:
      return 2;
  }
}
