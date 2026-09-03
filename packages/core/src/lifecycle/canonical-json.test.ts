import { describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
} from "./canonical-json.js";

describe("CanonicalJsonV1", () => {
  it("catches an encoder that preserves object insertion order instead of UTF-8 key order", () => {
    expect(encodeCanonicalJson({ z: 1, a: "é" })).toBe('{"a":"é","z":1}\n');
  });

  /**
   * A count, not an elapsed time: ordering encoded each key once per comparison
   * rather than once per key, so a 32-key object cost hundreds of TextEncoder
   * allocations. Init publishes its plan on every journal write, which made
   * this the single largest cost in `developer-os init` (48.8s of a 219s run).
   */
  it("catches an encoder that re-encodes a key for every ordering comparison", () => {
    const keys = Array.from({ length: 32 }, (_, index) => `key${String(31 - index)}`);
    const value = Object.fromEntries(keys.map((key) => [key, 1]));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; only ever invoked with an explicit `this`
    const original = TextEncoder.prototype.encode;
    let encodeCalls = 0;

    try {
      TextEncoder.prototype.encode = function encode(
        this: InstanceType<typeof TextEncoder>,
        input?: string,
      ) {
        encodeCalls += 1;
        return original.call(this, input as string);
      };
      encodeCanonicalJson(value);
    } finally {
      TextEncoder.prototype.encode = original;
    }

    expect(encodeCalls).toBe(keys.length);
  });

  it("catches an encoder that orders a single-key object it never needs to compare", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; only ever invoked with an explicit `this`
    const original = TextEncoder.prototype.encode;
    let encodeCalls = 0;

    try {
      TextEncoder.prototype.encode = function encode(
        this: InstanceType<typeof TextEncoder>,
        input?: string,
      ) {
        encodeCalls += 1;
        return original.call(this, input);
      };
      encodeCanonicalJson({ only: 1 });
    } finally {
      TextEncoder.prototype.encode = original;
    }

    expect(encodeCalls).toBe(0);
  });

  /**
   * The ordering rewrite is the part that could corrupt the wire format, so it
   * is pinned against an independent reference rather than against itself.
   */
  it("catches key ordering that disagrees with unsigned UTF-8 byte order", () => {
    const alphabet = ["a", "b", "é", "߿", "ࠀ", "퟿", "", "￿", "\u{10000}", "\u{10FFFF}"];
    const encoder = new TextEncoder();

    for (let iteration = 0; iteration < 500; iteration += 1) {
      const keys = new Set<string>();
      for (let index = 0; index < 6; index += 1) {
        let key = "";
        for (let length = 0; length < 1 + (iteration % 4); length += 1) {
          key += alphabet[(iteration * 7 + index * 3 + length * 5) % alphabet.length] as string;
        }
        keys.add(key);
      }
      const value = Object.fromEntries([...keys].map((key) => [key, 1]));
      const expected = [...keys].sort((left, right) =>
        Buffer.compare(encoder.encode(left), encoder.encode(right)),
      );

      const encoded = encodeCanonicalJson(value);
      const emitted = [...encoded.matchAll(/"((?:[^"\\]|\\.)*)":/gu)].map((match) =>
        JSON.parse(`"${match[1] as string}"`) as string,
      );

      expect(emitted).toEqual(expected);
    }
  });

  it("catches an encoder that orders non-ASCII keys by UTF-16 rather than unsigned UTF-8 bytes", () => {
    expect(encodeCanonicalJson({ "\u{10000}": 1, "\uE000": 2 })).toBe('{"":2,"𐀀":1}\n');
  });

  it("catches an encoder that emits noncanonical control escapes or a missing LF", () => {
    expect(encodeCanonicalJson({ control: "\u0001\b\t\n\f\r\\\"" })).toBe(
      '{"control":"\\u0001\\b\\t\\n\\f\\r\\\\\\""}\n',
    );
  });

  /**
   * The lone-surrogate scan read `charCodeAt(index + 1)` past the final index,
   * where it is `NaN` and both range comparisons are false, so a trailing high
   * surrogate escaped. Two distinct keys then encoded to the same replacement
   * bytes, producing a duplicate key this module's own decoder rejects and a
   * SHA-256 collision in a format used for integrity.
   */
  it("catches an encoder that accepts a trailing lone high surrogate", () => {
    expect(() => encodeCanonicalJson({ value: "a\ud800" })).toThrow(/lone high surrogate/u);
  });

  it("catches an encoder that emits two distinct keys as one byte sequence", () => {
    expect(() => encodeCanonicalJson({ "\ud800": 1, "�": 2 })).toThrow(
      /lone high surrogate/u,
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

  it("catches an encoder that serializes sparse array holes as invalid commas or drops them", () => {
    const oneAfterHole = new Array<number>(2);
    oneAfterHole[1] = 1;
    expect(() => encodeCanonicalJson(oneAfterHole)).toThrow();
    expect(() => encodeCanonicalJson(new Array(1) as unknown as readonly number[])).toThrow();
  });
});
