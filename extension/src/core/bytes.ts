/**
 * HAR's request.postData.text holds binary bodies as a Latin-1 string
 * (one char per byte, code 0-255), so the bytes can be recovered exactly.
 */
export function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  return latin1ToBytes(bin);
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return base64ToBytes(s);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
export function tryUtf8(bytes: Uint8Array): string | undefined {
  try {
    return utf8.decode(bytes);
  } catch {
    return undefined;
  }
}

export function utf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
