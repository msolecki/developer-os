import { describe, expect, it } from "vitest";

import type { WorkflowContractV1 } from "./contract.js";
import { compareScopes, deriveScopes } from "./derive.js";

function workflow(
  steps: WorkflowContractV1["steps"],
  scopes: WorkflowContractV1["scopes"],
): WorkflowContractV1 {
  return {
    schemaVersion: 1,
    id: "sample",
    version: "1.0.0",
    description: "A sample.",
    triggers: ["manual"],
    inputs: {},
    output: {},
    capabilities: [],
    scopes,
    refusals: [],
    steps,
    validators: [],
    recovery: { leaves: "nothing", resume: "developer-os doctor" },
  };
}

describe("deriveScopes", () => {
  it("unions the footprints of every effect step and sorts byte-wise", () => {
    const derived = deriveScopes(
      workflow(
        [
          { id: "a", do: "brain.readNote" },
          { id: "b", do: "brain.readIndex" },
          { id: "c", prose: "explain" },
        ],
        { read: [], write: [] },
      ),
    );
    expect(derived.read).toStrictEqual(["content/**", "content/_indexes/**"]);
    expect(derived.write).toStrictEqual([]);
  });

  it("contributes no write scope for a staging-only verb, but does contribute its read", () => {
    /**
     * The second half is the half that can fail. `ingest.stage` carries
     * `write: []` in the vocabulary and `deriveScopes` never reads `staging`,
     * so asserting the empty write alone holds whether or not staging is
     * handled at all — which is right per spec §6, where staging is encoded as
     * absent globs rather than as a runtime suppression, but it names a
     * mechanism this module does not implement. Asserting the read axis pins
     * the real content: only vault paths become scopes.
     */
    const derived = deriveScopes(
      workflow([{ id: "a", do: "ingest.stage" }], { read: [], write: [] }),
    );
    expect(derived.write).toStrictEqual([]);
    expect(derived.read).toStrictEqual(["content/_raw/quarantine/**"]);
  });

  it("returns a set, not a bag, when two verbs differ only in composition", () => {
    /**
     * `[...new Set(values)].map(normalize)` de-duplicated on the *raw* string,
     * so `cafe` with an acute accent written pre-composed and decomposed both survived and only then
     * became identical — two findings reading exactly alike, with nothing to
     * tell their author apart.
     */
    const derived = deriveScopes(
      workflow(
        [
          { id: "a", do: "caf\u00E9" },
          { id: "b", do: "cafe\u0301" },
        ],
        { read: [], write: [] },
      ),
    );
    expect(derived.unknownVerbs).toStrictEqual(["caf\u00E9"]);
  });

  it("orders by code point, which is UTF-8 byte order and not the default `<`", () => {
    /**
     * `left < right` compares UTF-16 code units, so every code point at or above
     * U+10000 sorts *below* U+E000–U+FFFF — the reverse of UTF-8. Deterministic
     * either way inside Node, which is why nothing here caught it; wrong the
     * moment a renderer in another language orders the same set.
     */
    const derived = deriveScopes(
      workflow(
        [
          { id: "a", do: "\u{10000}" },
          { id: "b", do: "\uE000" },
        ],
        { read: [], write: [] },
      ),
    );
    expect(derived.unknownVerbs).toStrictEqual(["\uE000", "\u{10000}"]);
  });

  it("reports an unknown verb rather than silently deriving nothing", () => {
    const derived = deriveScopes(
      workflow([{ id: "a", do: "brain.nope" }], { read: [], write: [] }),
    );
    expect(derived.unknownVerbs).toStrictEqual(["brain.nope"]);
  });

  it("treats an inherited property name as an unknown verb, not as a footprint", () => {
    /**
     * `EFFECT_VOCABULARY[step.do]` resolved `toString` through the prototype
     * chain to a `Function`, which passed the `=== undefined` guard and then
     * failed at `footprint.read is not iterable`. Such a verb also never reached
     * `unknownVerbs`, so it bypassed the unknown-verb error entirely — the crash
     * was hiding a missing refusal.
     */
    for (const hostile of ["toString", "constructor", "valueOf", "__proto__"]) {
      const derived = deriveScopes(
        workflow([{ id: "a", do: hostile }], { read: [], write: [] }),
      );
      expect(derived.unknownVerbs, hostile).toStrictEqual([hostile]);
      expect(derived.read, hostile).toStrictEqual([]);
      expect(derived.write, hostile).toStrictEqual([]);
    }
  });
});

describe("compareScopes", () => {
  it("accepts equality", () => {
    const derived = deriveScopes(
      workflow([{ id: "a", do: "brain.search" }], {
        read: ["content/_indexes/**"],
        write: [],
      }),
    );
    expect(
      compareScopes({ read: ["content/_indexes/**"], write: [] }, derived),
    ).toStrictEqual([]);
  });

  it("reports under-declaration", () => {
    const derived = deriveScopes(
      workflow([{ id: "a", do: "brain.reindex" }], { read: [], write: [] }),
    );
    const mismatches = compareScopes({ read: ["content/**"], write: [] }, derived);
    expect(mismatches).toContainEqual({
      kind: "under-declared",
      axis: "write",
      glob: "content/_indexes/**",
    });
  });

  it("reports over-declaration, which a subset check would pass", () => {
    /**
     * Spec §6. A workflow claiming write access it never exercises is a lie the
     * adapter would faithfully grant, and it is how a scope grows without
     * anyone deciding to grow it.
     */
    const derived = deriveScopes(
      workflow([{ id: "a", do: "brain.search" }], { read: [], write: [] }),
    );
    const mismatches = compareScopes(
      { read: ["content/_indexes/**"], write: ["content/**"] },
      derived,
    );
    expect(mismatches).toStrictEqual([
      { kind: "over-declared", axis: "write", glob: "content/**" },
    ]);
  });

  it("normalizes both sides, not only the declared one", () => {
    /**
     * `declaredSet` was normalized at construction and `derivedSet` was trusted
     * to arrive that way — but the membership test compared a *normalized*
     * declared glob against the un-normalized derived set. Since `DerivedScopes`
     * is exported with nothing in its type promising normalization, and
     * `compareScopes` is exported independently of `deriveScopes`, a hand-built
     * derived set produced one spurious `over-declared` and no matching
     * `under-declared` to explain it.
     */
    const mismatches = compareScopes(
      { read: ["content/caf\u00E9/**"], write: [] },
      { read: ["content/cafe\u0301/**"], write: [], unknownVerbs: [] },
    );
    expect(mismatches).toStrictEqual([]);
  });
});
