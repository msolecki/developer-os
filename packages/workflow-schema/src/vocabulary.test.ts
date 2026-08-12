import { describe, expect, it } from "vitest";

import { EFFECT_VOCABULARY, isKnownVerb, lookupVerb } from "./vocabulary.js";

describe("EFFECT_VOCABULARY", () => {
  it("is not empty, and every entry is fully specified", () => {
    const entries = Object.entries(EFFECT_VOCABULARY);
    expect(entries.length).toBeGreaterThan(0);
    for (const [verb, footprint] of entries) {
      expect(verb, "verb is namespaced").toMatch(/^[a-z]+\.[a-zA-Z]+$/u);
      expect(footprint.owner.length).toBeGreaterThan(0);
      expect(typeof footprint.implemented).toBe("boolean");
    }
  });

  it("pins every footprint, because this table is the root of the scope model", () => {
    /**
     * One `toStrictEqual` over the whole table, transcribed from spec §6.
     * The previous tests asserted values for two verbs and incidentally covered
     * four more, so eight were unpinned: the review widened `brain.lint` to
     * `read: ["/**"]` — the entire filesystem — and `capture.write` to the whole
     * vault, and every test in this package still passed. A derived scope is only
     * as true as this table, so the table is checked whole or not at all.
     */
    const indexes = ["content/_indexes/**"];
    const notes = ["content/**"];
    const quarantine = ["content/_raw/quarantine/**"];
    const brain = { staging: false, capability: null, owner: "DOS-P2", implemented: true };
    const capture = { staging: false, capability: null, owner: "DOS-P6", implemented: false };

    /** Spread, because `toStrictEqual` compares prototypes and this table has none. */
    expect({ ...EFFECT_VOCABULARY }).toStrictEqual({
      "brain.readIndex": { read: indexes, write: [], ...brain },
      "brain.search": { read: indexes, write: [], ...brain },
      "brain.readNote": { read: notes, write: [], ...brain },
      "brain.reindex": { read: notes, write: indexes, ...brain },
      "brain.lint": { read: notes, write: [], ...brain },
      "capture.write": { read: [], write: quarantine, ...capture },
      "capture.list": { read: quarantine, write: [], ...capture },
      "capture.setStatus": { read: [], write: quarantine, ...capture },
      "ingest.stage": { read: quarantine, write: [], staging: true, capability: "structured_result", owner: "DOS-P6", implemented: false },
      "ingest.validate": { read: [], write: [], staging: true, capability: null, owner: "DOS-P6", implemented: false },
      "ingest.apply": { read: [], write: notes, staging: true, capability: null, owner: "DOS-P6", implemented: false },
      "doctor.report": { read: [], write: [], staging: false, capability: null, owner: "Foundation", implemented: true },
      "cli.run": { read: [], write: [], staging: false, capability: "non_interactive_run", owner: "Foundation", implemented: true },
      "agent.prompt": { read: [], write: [], staging: false, capability: null, owner: "adapters", implemented: false },
    });
  });

  it("holds no prototype member, so an inherited name is not a verb", () => {
    /**
     * `Object.freeze({...})` over a plain literal leaves `Object.prototype` on
     * the chain, so `EFFECT_VOCABULARY["toString"]` returned a `Function` — not
     * `undefined` — and every consumer's `=== undefined` guard passed straight
     * through it into `footprint.read is not iterable`. The declared type said
     * that value could not exist. The table now has a null prototype.
     */
    expect(Object.getPrototypeOf(EFFECT_VOCABULARY)).toBeNull();
    for (const inherited of ["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(EFFECT_VOCABULARY[inherited], inherited).toBeUndefined();
      expect(lookupVerb(inherited), inherited).toBeUndefined();
      expect(isKnownVerb(inherited), inherited).toBe(false);
    }
  });

  it("is frozen all the way down, including the glob arrays it shares", () => {
    /**
     * `Object.freeze` is shallow. The entries were reassignable and the glob
     * arrays were both mutable *and shared by reference* — one `push` onto
     * `brain.search.read` widened `brain.readIndex` with it, and `capability`
     * could be nulled to drop a requirement. `readonly` stops an honest
     * TypeScript caller and nothing else; this is a published surface.
     */
    expect(Object.isFrozen(EFFECT_VOCABULARY)).toBe(true);
    const entries = Object.values(EFFECT_VOCABULARY);
    expect(entries.length).toBeGreaterThan(0);
    for (const footprint of entries) {
      expect(Object.isFrozen(footprint)).toBe(true);
      expect(Object.isFrozen(footprint.read)).toBe(true);
      expect(Object.isFrozen(footprint.write)).toBe(true);
    }

    const search = EFFECT_VOCABULARY["brain.search"];
    const readIndex = EFFECT_VOCABULARY["brain.readIndex"];
    expect(search?.read).not.toBe(readIndex?.read);
    expect(() => (search?.read as string[]).push("**")).toThrow(TypeError);
    expect(readIndex?.read).toStrictEqual(["content/_indexes/**"]);
  });

  it("gives ingest.stage no write scope, because staging is outside the vault", () => {
    /**
     * Spec §6. Staging is governed by Foundation's transaction model; two
     * mechanisms guarding one directory would mean neither is the authority.
     */
    const stage = EFFECT_VOCABULARY["ingest.stage"];
    expect(stage?.write).toStrictEqual([]);
    expect(stage?.staging).toBe(true);
  });

  it("gives ingest.apply the only vault write in the ingest chain", () => {
    expect(EFFECT_VOCABULARY["ingest.apply"]?.write).toStrictEqual(["content/**"]);
  });

  it("marks the seven unimplemented verbs with their owning subsystem", () => {
    const pending = Object.entries(EFFECT_VOCABULARY)
      .filter(([, footprint]) => !footprint.implemented)
      .map(([verb]) => verb)
      .sort();
    expect(pending).toStrictEqual([
      "agent.prompt",
      "capture.list",
      "capture.setStatus",
      "capture.write",
      "ingest.apply",
      "ingest.stage",
      "ingest.validate",
    ]);
    /**
     * Anchored. The first version was `/DOS-P\d|adapters/u`, which matched
     * `xDOS-P9x` and `not-adapters-really` — it constrained nothing an owner
     * string could realistically get wrong.
     */
    for (const verb of pending) {
      expect(EFFECT_VOCABULARY[verb]?.owner, verb).toMatch(/^(?:DOS-P[1-9]|adapters)$/u);
    }
  });

  it("requires a capability only where the verb genuinely needs one", () => {
    expect(EFFECT_VOCABULARY["cli.run"]?.capability).toBe("non_interactive_run");
    expect(EFFECT_VOCABULARY["ingest.stage"]?.capability).toBe("structured_result");
    expect(EFFECT_VOCABULARY["brain.search"]?.capability).toBeNull();
  });

  it("recognises only vocabulary verbs", () => {
    expect(isKnownVerb("brain.search")).toBe(true);
    expect(isKnownVerb("brain.deleteEverything")).toBe(false);
  });
});
