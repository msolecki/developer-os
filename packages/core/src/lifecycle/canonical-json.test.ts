import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
  sortUtf8,
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
  // Keys at or above U+D800 take the byte path; NEW-133's code-unit fast path below them encodes nothing.
  it("catches an encoder that re-encodes a key for every ordering comparison", () => {
    const keys = Array.from({ length: 32 }, (_, index) => `\u{1F600}key${String(31 - index)}`);
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

  it("orders keys below U+D800 without encoding any of them (NEW-133)", () => {
    const value = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`k\u00e9y${String(31 - index)}`, 1]));
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
      encodeCanonicalJson(value);
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

  /**
   * NEW-53 removed repeated encodes around this module, never the encoder, so a
   * plan-sized document is pinned against a reference that shares no code with
   * it, and a same-length noncanonical copy that differs only near its last byte
   * must still be refused by the decoder's byte comparison.
   */
  it("catches a large plan-shaped document whose bytes differ from an independent reference or survive a late noncanonical edit", () => {
    const encoder = new TextEncoder();
    const reference = (value: unknown): string => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        return JSON.stringify(value);
      }
      if (Array.isArray(value)) return `[${value.map(reference).join(",")}]`;
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort((left, right) => Buffer.compare(encoder.encode(left), encoder.encode(right)))
        .map((key) => `${JSON.stringify(key)}:${reference(object[key])}`)
        .join(",")}}`;
    };
    const payloads = Array.from({ length: 2000 }, (_, ordinal) => ({
      ordinal,
      path: `/Users/founder/Library/Application Support/developer-os/payload-${String(ordinal)}/notes é\u{10000}.md`,
      sha256: createHash("sha256").update(String(ordinal)).digest("hex"),
      recordedAt: "2030-01-01T08:00:00Z",
      mode: ordinal % 2 === 0 ? 0o600 : 0o644,
      executable: ordinal % 3 === 0,
      previous: ordinal === 0 ? null : ordinal - 1,
      label: `line\t${String(ordinal)}\n"quoted"\\`,
      "": { "\u{10000}": [ordinal, "ß"] },
    }));
    const document = {
      schemaVersion: 1,
      payloads,
      createdPaths: payloads.map((payload) => payload.path),
      maximumPlanBytes: 268_435_456,
      y: 1,
      z: 1,
    };

    const canonical = encodeCanonicalJson(document);
    expect(canonical).toBe(`${reference(document)}\n`);
    expect(canonical.endsWith(',"y":1,"z":1}\n')).toBe(true);

    const bytes = encoder.encode(canonical);
    expect(decodeCanonicalJson(bytes, bytes.byteLength)).toEqual(document);
    const lateSwap = encoder.encode(`${canonical.slice(0, -14)},"z":1,"y":1}\n`);
    expect(lateSwap.byteLength).toBe(bytes.byteLength);
    expect(() => decodeCanonicalJson(lateSwap, lateSwap.byteLength)).toThrow(
      "invalid canonical JSON: input is not byte-for-byte canonical",
    );
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
describe("sortUtf8", () => {
  it("catches a sort that places a surrogate-pair key before a higher BMP key by UTF-16 code unit", () => {
    const rows = [{ path: "a/\u{1F600}" }, { path: "a/�" }];

    expect(sortUtf8(rows, (row) => row.path).map((row) => row.path)).toEqual(["a/�", "a/\u{1F600}"]);
  });

  /** NEW-133: the pre-fast-path algorithm, kept verbatim as the oracle. */
  const oracleEncoder = new TextEncoder();
  function oracleSort<T>(values: readonly T[], key: (value: T) => string): T[] {
    const encoded = values.map((value) => ({ value, bytes: oracleEncoder.encode(key(value)) }));
    encoded.sort((left, right) => {
      const common = Math.min(left.bytes.length, right.bytes.length);
      for (let index = 0; index < common; index += 1) {
        const difference = (left.bytes[index] as number) - (right.bytes[index] as number);
        if (difference !== 0) return difference;
      }
      return left.bytes.length - right.bytes.length;
    });
    return encoded.map((entry) => entry.value);
  }
  type Value = string | number | readonly Value[] | { readonly [key: string]: Value };
  function oracleEncode(value: Value): string {
    if (Array.isArray(value)) return `[${(value as readonly Value[]).map(oracleEncode).join(",")}]`;
    if (typeof value === "object") {
      const object = value as { readonly [key: string]: Value };
      return `{${oracleSort(Object.keys(object), (key) => key)
        .map((key) => `${encodeCanonicalJson(key).slice(0, -1)}:${oracleEncode(object[key] as Value)}`)
        .join(",")}}`;
    }
    return encodeCanonicalJson(value).slice(0, -1);
  }
  // `￿` against an astral key is the pair where UTF-16 code-unit order and UTF-8 byte order disagree.
  const alphabet = ["", "a", "b", "Z", "0", "~", "\u007f", "é", "ࠀ", "퟿", "", "￿", "\u{10000}", "\u{1F600}", "\u{10FFFF}"];
  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = Math.imul(state ^ (state >>> 15), state | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  it("orders keys and encodes objects byte-identically to the pre-fast-path algorithm (NEW-133)", () => {
    const random = generator(133);
    const pick = (): string => alphabet[Math.floor(random() * alphabet.length)] as string;
    const key = (): string => Array.from({ length: 1 + Math.floor(random() * 4) }, pick).join("");
    const value = (depth: number): Value => {
      const roll = random();
      if (depth > 2 || roll < 0.3) return random() < 0.5 ? key() : Math.floor(random() * 1000);
      if (roll < 0.45) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
      const object: Record<string, Value> = {};
      for (let index = Math.floor(random() * 8); index > 0; index -= 1) object[key()] = value(depth + 1);
      return object;
    };
    let astralAgainstFfff = 0;
    for (let round = 0; round < 2_000; round += 1) {
      const sample = value(0);
      expect(encodeCanonicalJson(sample)).toBe(`${oracleEncode(sample)}\n`);
      const keys = Array.from({ length: Math.floor(random() * 12) }, key);
      if (keys.some((entry) => entry.includes("￿")) && keys.some((entry) => /[\u{10000}-\u{10FFFF}]/u.test(entry))) {
        astralAgainstFfff += 1;
      }
      expect(sortUtf8(keys, (entry) => entry)).toEqual(oracleSort(keys, (entry) => entry));
    }
    expect(astralAgainstFfff).toBeGreaterThan(50);
    const ascii = ["b", "a~", "a", "Z", "a\u007f", ""];
    expect(sortUtf8(ascii, (entry) => entry)).toEqual(oracleSort(ascii, (entry) => entry));
    expect(sortUtf8(["\u{10000}", "￿", ""], (entry) => entry)).toEqual(["", "￿", "\u{10000}"]);
  });
});

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

  describe("encodeString against the per-character oracle (NEW-53)", () => {
    // The pre-NEW-53 encoder, copied verbatim: one append per character.
    function oracleEncodeString(value: string): string {
      for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
          if (next < 0xdc00 || next > 0xdfff) throw new Error("invalid canonical JSON: string has a lone high surrogate");
          index += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          throw new Error("invalid canonical JSON: string has a lone low surrogate");
        }
      }
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

    // Deterministic xorshift so a failure reproduces.
    let seed = 0x2545f491;
    const random = (limit: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % limit;
    };
    const pieces = [
      "a", "Z", "0", " ", "/", "é", "€", "\u{10000}", "\u{1f600}", "\u2028", "\u2029", "\u007f", "\uffff",
      '"', "\\", "\b", "\t", "\n", "\f", "\r", "\u0000", "\u001f", "\u0001",
      "\ud800", "\udbff", "\udc00", "\udfff",
    ];

    function outcome(encode: () => string): string {
      try {
        return `ok:${encode()}`;
      } catch (error) {
        return `err:${(error as Error).message}`;
      }
    }

    it("matches the oracle byte for byte, including refusals, over random strings", () => {
      for (let round = 0; round < 20000; round += 1) {
        let value = "";
        const length = random(4) === 0 ? random(300) : random(12);
        for (let i = 0; i < length; i += 1) value += pieces[random(pieces.length)] as string;
        const expected = outcome(() => oracleEncodeString(value));
        const actual = outcome(() => encodeCanonicalJson(value).slice(0, -1));
        expect(actual).toBe(expected);
      }
    });

    it("matches the oracle on long strings with sparse escapes and an edge-placed escape", () => {
      const base = "0123456789abcdef/é€\u{10000}".repeat(5000);
      for (const value of [base, `"${base}`, `${base}\n`, `${base}\\${base}`, `${base}\u0000${base}\u{1f600}`]) {
        expect(encodeCanonicalJson(value).slice(0, -1)).toBe(oracleEncodeString(value));
      }
    });

    it("refuses a lone surrogate at the start, middle and end of a long string", () => {
      for (const lone of ["\ud800", "\udc00"]) {
        for (const value of [`${lone}abc`, `abc${lone}abc`, `abc${lone}`, `${"x".repeat(10000)}${lone}`]) {
          expect(() => encodeCanonicalJson(value)).toThrow(/lone (high|low) surrogate/);
        }
      }
    });
  });
});
