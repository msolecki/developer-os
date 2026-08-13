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
     *
     * Task 5 added `command` to every entry and added `capture.edit` as a
     * fifteenth verb, so this pin now carries both: every footprint below gained
     * a `command` field, and `capture.edit` is a new row rather than a change to
     * an existing one.
     */
    const indexes = ["content/_indexes/**"];
    const notes = ["content/**"];
    const quarantine = ["content/_raw/quarantine/**"];
    const brain = { staging: false, capability: null, owner: "DOS-P2", implemented: true };
    const capture = { staging: false, capability: null, owner: "DOS-P6", implemented: false };

    /** Spread, because `toStrictEqual` compares prototypes and this table has none. */
    expect({ ...EFFECT_VOCABULARY }).toStrictEqual({
      "brain.readIndex": { read: indexes, write: [], ...brain, command: null },
      "brain.search": { read: indexes, write: [], ...brain, command: "developer-os brain search" },
      "brain.readNote": { read: notes, write: [], ...brain, command: null },
      "brain.reindex": { read: notes, write: indexes, ...brain, command: "developer-os brain reindex" },
      "brain.lint": { read: notes, write: [], ...brain, command: "developer-os brain lint" },
      "capture.write": { read: [], write: quarantine, ...capture, command: "developer-os capture" },
      "capture.list": { read: quarantine, write: [], ...capture, command: "developer-os review" },
      "capture.setStatus": { read: [], write: quarantine, ...capture, command: "developer-os review" },
      "capture.edit": { read: quarantine, write: quarantine, ...capture, command: "developer-os review" },
      "ingest.stage": { read: quarantine, write: [], staging: true, capability: "structured_result", owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
      "ingest.validate": { read: [], write: [], staging: true, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
      "ingest.apply": { read: [], write: notes, staging: true, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
      "doctor.report": { read: [], write: [], staging: false, capability: null, owner: "Foundation", implemented: true, command: "developer-os doctor" },
      "cli.run": { read: [], write: [], staging: false, capability: "non_interactive_run", owner: "Foundation", implemented: true, command: null },
      "agent.prompt": { read: [], write: [], staging: false, capability: null, owner: "adapters", implemented: false, command: null },
    });
  });

  /**
   * The four verbs with no command, each for its own reason. `brain.readIndex`
   * and `brain.readNote` are here because `BRAIN_SUBCOMMANDS` in `main.ts` is
   * `reindex | lint | search | status` — there is no `developer-os brain
   * read-index` and no `read-note`, and inventing one would render a skill
   * telling an agent to run a command that does not exist, which is the whole
   * defect spec §4 closes.
   */
  const COMMANDLESS = [
    "agent.prompt",
    "cli.run",
    "brain.readIndex",
    "brain.readNote",
  ] as const;

  it("gives every verb a developer-os command, except the four that cannot have one", () => {
    const table = { ...EFFECT_VOCABULARY };
    expect(Object.keys(table).length).toBeGreaterThan(10);

    for (const [verb, footprint] of Object.entries(table)) {
      if ((COMMANDLESS as readonly string[]).includes(verb)) {
        expect(footprint.command, verb).toBeNull();
        continue;
      }
      expect(footprint.command, verb).toMatch(/^developer-os [a-z]/u);
    }
  });

  /**
   * Named "a fifth cannot appear by omission" rather than "a third": the task-5
   * brief's original prose said "two verbs carry no command" and left that word
   * in these two test names after `COMMANDLESS` grew to four during the
   * pre-flight correction. Fixed here per the Task-5 fix-pass review, so the
   * miscount is not copied forward into a later task that reads this file as a
   * template.
   */
  it("names exactly the four commandless verbs, so a fifth cannot appear by omission", () => {
    const without = Object.entries({ ...EFFECT_VOCABULARY })
      .filter(([, footprint]) => footprint.command === null)
      .map(([verb]) => verb)
      .sort();
    expect(without).toStrictEqual([...COMMANDLESS].sort());
  });

  it("knows capture.edit, whose scopes match the review workflow's declared ones", () => {
    const footprint = lookupVerb("capture.edit");
    expect(footprint?.read).toStrictEqual(["content/_raw/quarantine/**"]);
    expect(footprint?.write).toStrictEqual(["content/_raw/quarantine/**"]);
  });

  /**
   * Transcribed from `apps/cli/src/main.ts`, not imported: `packages/workflow-
   * schema` is a dependency of the CLI, not the other way around, so this list
   * cannot be `import`ed without inverting that direction. `KNOWN_CLI_COMMANDS`
   * is `Object.keys(COMMAND_POSITIONALS)` (`main.ts:89-99`) — the arity table is
   * the actual dispatch surface, not the prose in `USAGE` — and
   * `KNOWN_BRAIN_SUBCOMMANDS` is `Object.keys(BRAIN_SUBCOMMANDS)`
   * (`main.ts:101-108`). If `main.ts` adds or renames a command, this list goes
   * stale by hand rather than by import; that is the cost of not inverting the
   * dependency, accepted because a command name was previously checked by
   * nothing at all — a comment and a list, per the fix-pass review.
   */
  const KNOWN_CLI_COMMANDS = [
    "init",
    "status",
    "doctor",
    "repair",
    "uninstall",
    "brain",
    "search",
  ] as const;
  const KNOWN_BRAIN_SUBCOMMANDS = ["reindex", "lint", "search", "status"] as const;

  it("names a real CLI command once a verb's handler ships, and a real brain subcommand for brain *", () => {
    /**
     * Scoped to `implemented && command !== null`, deliberately narrower than
     * "every verb with a command": a verb can be commanded before it is
     * implemented (all seven from this task are), and the CLI genuinely does
     * not have that subcommand yet — that is not a typo, it is the plan. This
     * check is the gate Tasks 9, 10 and 13 must satisfy in the same change that
     * flips `implemented` to `true`.
     */
    for (const [verb, footprint] of Object.entries({ ...EFFECT_VOCABULARY })) {
      if (!footprint.implemented || footprint.command === null) continue;
      const [, first, second] = footprint.command.split(" ");
      expect(KNOWN_CLI_COMMANDS as readonly string[], verb).toContain(first);
      if (first === "brain") {
        expect(KNOWN_BRAIN_SUBCOMMANDS as readonly string[], verb).toContain(second);
      }
    }
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

  it("marks the eight unimplemented verbs with their owning subsystem", () => {
    /**
     * Task 5 adds `capture.edit`, unimplemented like its two `capture` siblings
     * until Task 10 ships the review handler, so the pinned set grows from
     * seven to eight without changing any of the original seven.
     */
    const pending = Object.entries(EFFECT_VOCABULARY)
      .filter(([, footprint]) => !footprint.implemented)
      .map(([verb]) => verb)
      .sort();
    expect(pending).toStrictEqual([
      "agent.prompt",
      "capture.edit",
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
