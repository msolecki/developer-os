import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
} from "./canonical-json.js";

const escapedCodeUnits: readonly number[] = [
  ...Array.from({ length: 0x20 }, (_, unit) => unit),
  0x22,
  0x5c,
];

const encodeStringCorpus: readonly string[] = [
  "",
  "a",
  "/Users/founder/Library/Application Support/developer-os/state/plan.json",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "2026-09-08T13:30:25Z",
  "é",
  "ß",
  "€",
  "",
  "�",
  "￿",
  "\u{10000}",
  "\u{10ffff}",
  "a\u{10000}b",
  ...escapedCodeUnits.flatMap((unit) => {
    const character = String.fromCharCode(unit);
    return [
      character,
      `${character}tail`,
      `head${character}`,
      `head${character}tail`,
      `head${character}${character}tail`,
      `${"run".repeat(64)}${character}`,
      `${character}${"run".repeat(64)}`,
      `head${character}\u{10000}`,
    ];
  }),
  escapedCodeUnits.map((unit) => String.fromCharCode(unit)).join(""),
  escapedCodeUnits.map((unit) => `x${String.fromCharCode(unit)}y`).join(""),
];

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

  /**
   * NEW-53 measured `Buffer.compare` as a replacement for the per-byte loop and
   * kept the loop: at the 5-16 byte key sizes this format actually sorts, the
   * binding crossing costs 27.9 ns against the loop's 2.6 ns. The loop stays, so
   * it is pinned against `memcmp` over the cases the randomized corpus above
   * does not guarantee — an empty key, a shorter prefix, and a difference at the
   * final index.
   */
  it("catches key ordering that disagrees with memcmp on an empty, prefix or final-byte key", () => {
    const encoder = new TextEncoder();
    const keySets: readonly (readonly string[])[] = [
      ["b", "a"],
      ["a", "ab"],
      ["ab", "a"],
      ["", "a"],
      ["aa", "ab"],
      ["ab", "aa"],
      ["é", "e"],
      ["\u{10000}", ""],
      ["a", "é", "߿", "ࠀ", "퟿", "", "￿", "\u{10000}", "\u{10FFFF}"],
    ];

    for (const keys of keySets) {
      const value = Object.fromEntries(keys.map((key) => [key, 1]));
      const expected = [...keys].sort((left, right) =>
        Buffer.compare(encoder.encode(left), encoder.encode(right)),
      );

      const emitted = [...encodeCanonicalJson(value).matchAll(/"((?:[^"\\]|\\.)*)":/gu)].map(
        (match) => JSON.parse(`"${match[1] as string}"`) as string,
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
   * `JSON.stringify` applies exactly this escape rule and is written in C++, so
   * it pins the encoder's bytes against an implementation that shares no code
   * with it. Agreement holds for every string `assertString` admits; the corpus
   * covers an escape at index 0, an escape at the final index, adjacent escapes,
   * every C0 control including those with no short form, and astral characters.
   * NEW-53 rewrote this function and reverted it, and this is what proved the
   * rewrite byte-identical before the measurement rejected it.
   */
  it("catches a string encoder that disagrees with JSON.stringify on any escape boundary", () => {
    for (const value of encodeStringCorpus) {
      expect(encodeCanonicalJson(value)).toBe(`${JSON.stringify(value)}\n`);
      expect(encodeCanonicalJson({ [value]: value })).toBe(
        `{${JSON.stringify(value)}:${JSON.stringify(value)}}\n`,
      );
    }
  });

  it("catches a string encoder that admits a surrogate this format has always refused", () => {
    for (const value of ["\ud800", "a\ud800", "\ud800a", "\ud800\ud800"]) {
      expect(() => encodeCanonicalJson(value)).toThrow(
        "invalid canonical JSON: string has a lone high surrogate",
      );
    }
    for (const value of ["\udc00", "a\udc00", "\udc00a"]) {
      expect(() => encodeCanonicalJson(value)).toThrow(
        "invalid canonical JSON: string has a lone low surrogate",
      );
    }
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

/**
 * The one SHA-256-over-canonical-JSON helper. Every domain-separated hash in Spec 1
 * routes through it, so a second implementation would be the defect: the digest of a
 * plan, a record or a fingerprint is compared across subsystems and versions.
 */
describe("hashCanonicalJson", () => {
  it("hashes the ASCII domain, its trailing NUL, then the canonical bytes including the LF", () => {
    const expected = createHash("sha256")
      .update(Uint8Array.from([0x64, 0x00]))
      .update(new TextEncoder().encode('{"a":1}\n'))
      .digest("hex");
    expect(hashCanonicalJson("d", { a: 1 })).toBe(expected);
  });

  it("separates two domains over the same value", () => {
    expect(hashCanonicalJson("developer-os:lifecycle:git:v1", { a: 1 })).not.toBe(
      hashCanonicalJson("developer-os:lifecycle:automation:v1", { a: 1 }),
    );
  });

  /** A NUL or a multi-byte scalar in the domain would make two domains share a prefix. */
  it.each(["", "d\u0000e", "d\u00e9", "d e", "d\n"])("refuses the domain %j", (domain) => {
    expect(() => hashCanonicalJson(domain, { a: 1 })).toThrow();
  });

  it("refuses a value canonical JSON cannot encode", () => {
    expect(() => hashCanonicalJson("d", { a: 1.5 })).toThrow();
  });
});
