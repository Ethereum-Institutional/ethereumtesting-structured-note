/**
 * Canonical JSON, byte for byte as the credential protocol computes it, because a verifier
 * request is signed over these bytes and the holder wallet checks the signature against the
 * same serialisation (ADR 0045).
 *
 * Objects: keys NFC-normalised, sorted by UTF-16 code unit. Arrays in order. Strings NFC and
 * minimally escaped. Integers only; NaN, infinities and fractions are refused. No whitespace.
 * Refused as well: cycles, nesting deeper than 32, strings over 64 KiB, and any other type.
 */

const DEPTH_LIMIT = 32;
const STRING_BYTE_LIMIT = 64 * 1024;
const encoder = new TextEncoder();

export type CanonicalizeErrorCode = "float" | "cycle" | "depth" | "string-too-long" | "nan-or-inf";

export class CanonicalizeError extends Error {
  readonly code: CanonicalizeErrorCode;
  constructor(code: CanonicalizeErrorCode, message: string) {
    super(message);
    this.name = "CanonicalizeError";
    this.code = code;
  }
}

function str(s: string): string {
  const nfc = s.normalize("NFC");
  if (encoder.encode(nfc).byteLength > STRING_BYTE_LIMIT) {
    throw new CanonicalizeError("string-too-long", `string exceeds ${STRING_BYTE_LIMIT} bytes`);
  }
  return JSON.stringify(nfc);
}

function emit(value: unknown, depth: number, path: Set<object>): string {
  if (depth > DEPTH_LIMIT) throw new CanonicalizeError("depth", `nesting deeper than ${DEPTH_LIMIT}`);
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return str(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalizeError("nan-or-inf", `not finite: ${value}`);
    if (!Number.isInteger(value)) throw new CanonicalizeError("float", `not an integer: ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (path.has(value)) throw new CanonicalizeError("cycle", "cyclic array");
    path.add(value);
    const out = "[" + value.map((v) => emit(v, depth + 1, path)).join(",") + "]";
    path.delete(value);
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (path.has(obj)) throw new CanonicalizeError("cycle", "cyclic object");
    path.add(obj);
    const keys = Object.keys(obj).map((raw) => ({ raw, nfc: raw.normalize("NFC") }));
    keys.sort((a, b) => (a.nfc < b.nfc ? -1 : a.nfc > b.nfc ? 1 : 0));
    const out = "{" + keys.map(({ raw, nfc }) => str(nfc) + ":" + emit(obj[raw], depth + 1, path)).join(",") + "}";
    path.delete(obj);
    return out;
  }
  throw new CanonicalizeError("nan-or-inf", `unsupported type ${typeof value}`);
}

export function canonicalString(value: unknown): string {
  return emit(value, 0, new Set());
}

export function canonicalize(value: unknown): Uint8Array {
  return encoder.encode(canonicalString(value));
}
