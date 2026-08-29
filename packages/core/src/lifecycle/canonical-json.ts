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
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("string has a lone high surrogate");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("string has a lone low surrogate");
    }
  }
}

function encodeString(value: string): string {
  assertString(value);
  let encoded = '"';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22) encoded += '\\"';
    else if (codeUnit === 0x5c) encoded += "\\\\";
    else if (codeUnit === 0x08) encoded += "\\b";
    else if (codeUnit === 0x09) encoded += "\\t";
    else if (codeUnit === 0x0a) encoded += "\\n";
    else if (codeUnit === 0x0c) encoded += "\\f";
    else if (codeUnit === 0x0d) encoded += "\\r";
    else if (codeUnit >= 0 && codeUnit <= 0x1f) encoded += `\\u00${codeUnit.toString(16).padStart(2, "0")}`;
    else encoded += value[index] as string;
  }
  return `${encoded}"`;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const common = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (leftBytes[index] as number) - (rightBytes[index] as number);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
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
      return `[${array.map((entry) => encodeValue(entry, stack)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) fail("object is not plain");
    const object = value as { readonly [key: string]: CanonicalJsonValue };
    const keys = Object.keys(object).sort(compareUtf8);
    return `{${keys.map((key) => `${encodeString(key)}:${encodeValue(object[key] as CanonicalJsonValue, stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function encodeCanonicalJson(value: CanonicalJsonValue): CanonicalJsonV1 {
  return `${encodeValue(value, new Set<object>())}\n` as CanonicalJsonV1;
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
  if (canonicalBytes.byteLength !== bytes.byteLength || canonicalBytes.some((byte, index) => byte !== bytes[index])) {
    fail("input is not byte-for-byte canonical");
  }
  return value;
}
