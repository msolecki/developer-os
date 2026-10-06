import { createHash } from "node:crypto";

import type { LowerHexSha256 } from "../update/scalars.js";

export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

declare const canonicalJsonV1: unique symbol;
export type CanonicalJsonV1 = string & { readonly [canonicalJsonV1]: true };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const maximumInteger = Number.MAX_SAFE_INTEGER;

function fail(message: string): never {
  throw new Error(`invalid canonical JSON: ${message}`);
}

function assertString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      // Past the final index `charCodeAt` is NaN, which fails every comparison.
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) fail("string has a lone high surrogate");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("string has a lone low surrogate");
    }
  }
}

const escapes: Readonly<Record<number, string>> = {
  0x22: '\\"',
  0x5c: "\\\\",
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
};

/**
 * Scan, then slice: the run between two escapes is copied as one `slice`, and a
 * string with nothing to escape (almost every path, hash and timestamp) is one
 * template concatenation instead of one append per character (NEW-53). An
 * earlier revision of this comment rejected the slice form on 2026-09-08 because
 * it doubled young-generation scavenges in the bootstrap test (2,782 to 6,226).
 * Re-measured end to end on 2026-10-06, packed releases at 4c4150ab (per-char)
 * against this form, unsandboxed, load average 9-15, runs interleaved:
 * `init --yes --adapters none` took 163.7 s and 150.7 s before, 121.7 s and
 * 118.2 s after; user+sys 135.8 s and 137.0 s before, 127.3 s and 123.8 s after;
 * max RSS about 328 MB before, 356 MB after. `evidence-identity.v2.test.ts`
 * (8 cases) was within noise: 376 s and 397 s before, 443 s and 407 s after, so
 * no win is claimed there. Scavenge counts were not obtainable: `--trace-gc` is
 * refused in NODE_OPTIONS and vitest workers swallow it from `--execArgv`.
 */
function encodeString(value: string): string {
  assertString(value);
  let encoded = "";
  let runStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > 0x5c || (codeUnit > 0x22 && codeUnit < 0x5c)) continue;
    let escape = escapes[codeUnit];
    if (escape === undefined) {
      if (codeUnit > 0x1f) continue;
      escape = `\\u00${codeUnit.toString(16).padStart(2, "0")}`;
    }
    encoded += value.slice(runStart, index) + escape;
    runStart = index + 1;
  }
  return runStart === 0 ? `"${value}"` : `"${encoded}${value.slice(runStart)}"`;
}

/**
 * `Buffer.compare` is one `memcmp` and looks like the obvious replacement for
 * this loop. It was measured on 2026-09-08 and rejected: the keys this sorts are
 * 5-16 bytes, where crossing into the binding costs 27.9 ns against this loop's
 * 2.6 ns. `memcmp` only wins above roughly 32 bytes, which a key never reaches
 * (NEW-53).
 */
function compareUtf8Bytes(left: Uint8Array, right: Uint8Array): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function holdsCodeUnitFromD800(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) >= 0xd800) return true;
  }
  return false;
}

/** Unsigned UTF-8 byte order for one comparison; a sort uses `sortUtf8` instead. */
export function compareUtf8(left: string, right: string): number {
  return compareUtf8Bytes(encoder.encode(left), encoder.encode(right));
}

/**
 * Encodes each key once rather than once per comparison. `sort` performs
 * O(k log k) comparisons, so encoding inside the comparator made key ordering
 * the largest single cost in `developer-os init`.
 */
export function sortUtf8<T>(values: readonly T[], key: (value: T) => string): T[] {
  /**
   * NEW-133 fast path. Below U+D800 a UTF-16 code unit is the code point, and UTF-8 preserves
   * code-point order, so code-unit order is byte order and nothing needs encoding. A surrogate
   * (an astral scalar) sorts below U+E000..U+FFFF by code unit but above it by bytes, so any key
   * holding a code unit at or above U+D800 takes the byte path. Both sorts are stable.
   */
  const keys = values.map(key);
  if (!keys.some(holdsCodeUnitFromD800)) {
    const indices = keys.map((_, index) => index);
    indices.sort((left, right) => {
      const a = keys[left] as string;
      const b = keys[right] as string;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return indices.map((index) => values[index] as T);
  }
  const encoded = values.map((value, index) => ({ value, bytes: encoder.encode(keys[index] as string) }));
  encoded.sort((left, right) => compareUtf8Bytes(left.bytes, right.bytes));
  return encoded.map((entry) => entry.value);
}

function sortKeysUtf8(keys: readonly string[]): readonly string[] {
  return keys.length < 2 ? keys : sortUtf8(keys, (key) => key);
}

function encodeValue(value: CanonicalJsonValue, stack: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || Math.abs(value) > maximumInteger) {
      fail("number is not a safe non-negative-zero integer");
    }
    return value.toString(10);
  }
  if (typeof value !== "object") fail("value is not JSON");
  if (stack.has(value)) fail("value is cyclic");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const array = value as unknown as readonly CanonicalJsonValue[];
      const encoded: string[] = [];
      for (let index = 0; index < array.length; index += 1) {
        if (!Object.hasOwn(array, index)) fail("array has a hole");
        encoded.push(encodeValue(array[index] as CanonicalJsonValue, stack));
      }
      return `[${encoded.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) fail("object is not plain");
    const object = value as { readonly [key: string]: CanonicalJsonValue };
    const keys = sortKeysUtf8(Object.keys(object));
    return `{${keys.map((key) => `${encodeString(key)}:${encodeValue(object[key] as CanonicalJsonValue, stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function encodeCanonicalJson(value: CanonicalJsonValue): CanonicalJsonV1 {
  return `${encodeValue(value, new Set<object>())}\n` as CanonicalJsonV1;
}

/**
 * The one SHA-256-over-canonical-JSON helper, so every domain-separated digest in
 * Spec 1 — plan, preview, effect-plan, lifecycle config, Git scope — is produced by the
 * same bytes: the ASCII domain, its trailing NUL, then the canonical encoding including
 * its single LF. A NUL or a multi-byte scalar in the domain would let two domains share
 * a prefix, which is the whole point of separating them, so the domain is bounded to
 * printable ASCII here rather than at each of the nine call sites.
 */
export function hashCanonicalJson(domain: string, value: CanonicalJsonValue): LowerHexSha256 {
  return domainHash(domain, encodeCanonicalJson(value));
}

/**
 * Spec 2 §9.2's variant: the same domain and NUL, then the canonical encoding without
 * its trailing LF. The update plans, previews and journals bind these digests across
 * processes, so every no-LF digest goes through this one function. It takes `unknown`
 * because its callers hash typed records; the encoder refuses anything not canonical JSON.
 */
export function hashCanonicalJsonNoLf(domain: string, value: unknown): LowerHexSha256 {
  return domainHash(domain, encodeCanonicalJson(value as CanonicalJsonValue).slice(0, -1));
}

function domainHash(domain: string, bytes: string): LowerHexSha256 {
  if (!/^[\x21-\x7e]+$/.test(domain)) fail("hash domain is not printable ASCII");
  return createHash("sha256")
    .update(`${domain}\0`, "ascii")
    .update(bytes, "utf8")
    .digest("hex") as LowerHexSha256;
}

class JsonParser {
  #index = 0;

  constructor(private readonly text: string) {}

  parse(): CanonicalJsonValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.#index !== this.text.length) fail("trailing data");
    return value;
  }

  private current(): string | undefined {
    return this.text[this.#index];
  }

  private skipWhitespace(): void {
    while (this.current() === " " || this.current() === "\t" || this.current() === "\n" || this.current() === "\r") this.#index += 1;
  }

  private parseValue(): CanonicalJsonValue {
    const current = this.current();
    if (current === '"') return this.parseString();
    if (current === "{") return this.parseObject();
    if (current === "[") return this.parseArray();
    if (this.text.startsWith("true", this.#index)) {
      this.#index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.#index)) {
      this.#index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.#index)) {
      this.#index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseString(): string {
    if (this.current() !== '"') fail("expected string");
    this.#index += 1;
    let value = "";
    for (;;) {
      const current = this.current();
      if (current === undefined) fail("unterminated string");
      this.#index += 1;
      if (current === '"') {
        assertString(value);
        return value;
      }
      if (current === "\\") {
        const escape = this.current();
        if (escape === undefined) fail("unterminated escape");
        this.#index += 1;
        if (escape === '"' || escape === "\\" || escape === "/") value += escape;
        else if (escape === "b") value += "\b";
        else if (escape === "f") value += "\f";
        else if (escape === "n") value += "\n";
        else if (escape === "r") value += "\r";
        else if (escape === "t") value += "\t";
        else if (escape === "u") {
          const hex = this.text.slice(this.#index, this.#index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid unicode escape");
          value += String.fromCharCode(Number.parseInt(hex, 16));
          this.#index += 4;
        } else fail("invalid escape");
      } else {
        if (current.charCodeAt(0) <= 0x1f) fail("unescaped control character");
        value += current;
      }
    }
  }

  private parseArray(): readonly CanonicalJsonValue[] {
    this.#index += 1;
    this.skipWhitespace();
    const result: CanonicalJsonValue[] = [];
    if (this.current() === "]") {
      this.#index += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.current() === "]") {
        this.#index += 1;
        return result;
      }
      if (this.current() !== ",") fail("expected array comma");
      this.#index += 1;
      this.skipWhitespace();
    }
  }

  private parseObject(): { readonly [key: string]: CanonicalJsonValue } {
    this.#index += 1;
    this.skipWhitespace();
    const result: Record<string, CanonicalJsonValue> = Object.create(null) as Record<string, CanonicalJsonValue>;
    const keys = new Set<string>();
    if (this.current() === "}") {
      this.#index += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.parseString();
      if (keys.has(key)) fail("duplicate object key");
      keys.add(key);
      this.skipWhitespace();
      if (this.current() !== ":") fail("expected object colon");
      this.#index += 1;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.current() === "}") {
        this.#index += 1;
        return result;
      }
      if (this.current() !== ",") fail("expected object comma");
      this.#index += 1;
      this.skipWhitespace();
    }
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.#index));
    if (match === null) fail("expected value");
    this.#index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("number is not finite");
    return number;
  }
}

export function decodeCanonicalJson(bytes: Uint8Array, maximumBytes: number): CanonicalJsonValue {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("maximumBytes must be a positive safe integer");
  if (bytes.byteLength > maximumBytes) fail("input exceeds maximum bytes");
  let decoded: string;
  try {
    decoded = decoder.decode(bytes);
  } catch {
    fail("input is not UTF-8");
  }
  if (!decoded.endsWith("\n") || decoded.endsWith("\n\n")) fail("input does not end with exactly one LF");
  const value = new JsonParser(decoded.slice(0, -1)).parse();
  const canonical = encodeCanonicalJson(value);
  const canonicalBytes = encoder.encode(canonical);
  if (Buffer.compare(canonicalBytes, bytes) !== 0) fail("input is not byte-for-byte canonical");
  return value;
}
