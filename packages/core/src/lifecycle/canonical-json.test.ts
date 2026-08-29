import { describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
} from "./canonical-json.js";

describe("CanonicalJsonV1", () => {
  it("catches an encoder that preserves object insertion order instead of UTF-8 key order", () => {
    expect(encodeCanonicalJson({ z: 1, a: "é" })).toBe('{"a":"é","z":1}\n');
  });

  it("catches an encoder that orders non-ASCII keys by UTF-16 rather than unsigned UTF-8 bytes", () => {
    expect(encodeCanonicalJson({ "\u{10000}": 1, "\uE000": 2 })).toBe('{"":2,"𐀀":1}\n');
  });

  it("catches an encoder that emits noncanonical control escapes or a missing LF", () => {
    expect(encodeCanonicalJson({ control: "\u0001\b\t\n\f\r\\\"" })).toBe(
      '{"control":"\\u0001\\b\\t\\n\\f\\r\\\\\\""}\n',
    );
  });

  it("catches a decoder that accepts duplicate keys before an object is constructed", () => {
    expect(() => decodeCanonicalJson(new TextEncoder().encode('{"a":1,"a":2}\n'), 32)).toThrow();
  });

  it("catches a decoder that accepts alternate whitespace or omits the required LF", () => {
    expect(() => decodeCanonicalJson(new TextEncoder().encode('{ "a":1}\n'), 32)).toThrow();
    expect(() => decodeCanonicalJson(new TextEncoder().encode('{"a":1}'), 32)).toThrow();
  });

  it("catches a decoder that permits a value above its byte ceiling", () => {
    expect(() => decodeCanonicalJson(new TextEncoder().encode('{"a":1}\n'), 7)).toThrow();
  });
});
