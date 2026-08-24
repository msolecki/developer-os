import type { BrainConfigV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  EFFECT_VOCABULARY,
  isKnownVerb,
  lookupVerb,
  resolveScopeGlob,
  structuredResultVerbs,
} from "./vocabulary.js";

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
     * One `toStrictEqual` over the whole table, transcribed from Workflow architecture former §6.
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
     *
     * Task 9 shipped `developer-os capture`, so `capture.write` split out of
     * the shared `capture` const into a `captureWrite` of its own. Task 10
     * shipped `developer-os review` — the other three — which makes every
     * `capture.*` verb implemented and the split pointless, so it is folded
     * back rather than left as two consts that say the same thing.
     */
    const indexes = ["content/_indexes/**"];
    const notes = ["content/**"];
    const quarantine = ["content/_raw/quarantine/**"];
    const brain = { staging: false, capability: null, owner: "DOS-P2", implemented: true };
    const capture = { staging: false, capability: null, owner: "DOS-P6", implemented: true };

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
      "ingest.stage": { read: quarantine, write: [], staging: true, capability: "structured_result", owner: "DOS-P6", implemented: true, command: "developer-os ingest" },
      "ingest.validate": { read: [], write: [], staging: true, capability: null, owner: "DOS-P6", implemented: true, command: "developer-os ingest" },
      "ingest.apply": { read: [], write: notes, staging: true, capability: null, owner: "DOS-P6", implemented: true, command: "developer-os ingest" },
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
   * defect knowledge-pipeline architecture note §1 closes.
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
    "capture",
    "review",
    "ingest",
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
     * Workflow architecture former §6. Staging is governed by Foundation's transaction model; two
     * mechanisms guarding one directory would mean neither is the authority.
     */
    const stage = EFFECT_VOCABULARY["ingest.stage"];
    expect(stage?.write).toStrictEqual([]);
    expect(stage?.staging).toBe(true);
  });

  it("gives ingest.apply the only vault write in the ingest chain", () => {
    expect(EFFECT_VOCABULARY["ingest.apply"]?.write).toStrictEqual(["content/**"]);
  });

  it("marks the one unimplemented verb with its owning subsystem", () => {
    /**
     * Task 5 added `capture.edit`, unimplemented like its two `capture`
     * siblings, which grew the pinned set from seven to eight. Task 9 shipped
     * `developer-os capture` and took `capture.write` back out of it; Task 10
     * shipped `developer-os review` and took the next three; Task 13 shipped
     * `developer-os ingest` and took the last three of DOS-P6's. That is the
     * whole point of the pin — a verb leaves this list in the same change as
     * the handler that closes it — and it is why the test's own name is part
     * of what each of those tasks had to update.
     *
     * What is left is `agent.prompt`, and it is the adapters' rather than this
     * subsystem's: `invokeClaude` and `invokeCodex` exist, and what has no
     * handler is the *step executor* that would turn an `agent.prompt` step in
     * a workflow into one of those calls.
     */
    const pending = Object.entries(EFFECT_VOCABULARY)
      .filter(([, footprint]) => !footprint.implemented)
      .map(([verb]) => verb)
      .sort();
    expect(pending).toStrictEqual(["agent.prompt"]);
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

describe("resolveScopeGlob", () => {
  /**
   * Not imported from `@developer-os/brain` — `packages/workflow-schema` is not
   * on that dependency edge (`core ← security ← workflow-schema`), so this is a
   * hand-built literal of the same shape as `DEFAULT_BRAIN_CONFIG` rather than
   * that constant itself. Only the two roots this suite exercises are varied.
   */
  const DEFAULT: BrainConfigV1 = {
    schemaVersion: 1,
    contentRoot: "content",
    topicFolders: ["DEV"],
    topicAliases: {},
    indexesDir: "_indexes",
    retrieval: { maxCandidates: 10 },
    staleness: { reviewAfterDays: 365 },
  };
  const config: BrainConfigV1 = { ...DEFAULT, contentRoot: "notes", indexesDir: "_idx" };

  it.each([
    ["content/_raw/quarantine/**", "notes/_raw/quarantine/**"],
    ["content/_indexes/**", "notes/_idx/**"],
    ["content/**", "notes/**"],
  ])("resolves %s to %s", (glob, expected) => {
    expect(resolveScopeGlob(glob, config)).toBe(expected);
  });

  it("leaves a glob that names neither root alone", () => {
    expect(resolveScopeGlob("staging/**", config)).toBe("staging/**");
  });

  it("is identity under the default configuration, so the checked-in contracts are unchanged", () => {
    const globs = Object.values({ ...EFFECT_VOCABULARY }).flatMap((footprint) => [
      ...footprint.read,
      ...footprint.write,
    ]);
    /**
     * Four of the fourteen entries have empty read *and* write arrays, so
     * without this the loop below can quietly shrink toward a no-op that scans
     * nothing.
     */
    expect(globs.length).toBeGreaterThan(5);
    for (const glob of globs) expect(resolveScopeGlob(glob, DEFAULT)).toBe(glob);
  });

  it("refuses a configuration whose roots contain a path separator or a traversal", () => {
    expect(() =>
      resolveScopeGlob("content/**", { ...config, contentRoot: "../escape" }),
    ).toThrow(RangeError);
  });

  /**
   * Beyond the brief's `../escape` case: four more shapes a user could put in
   * `BrainConfigV1.contentRoot`/`indexesDir`, each a deliberate decision rather
   * than an oversight.
   */
  it("refuses an empty root, since joining onto it collapses the leading glob segment", () => {
    expect(() => resolveScopeGlob("content/**", { ...config, contentRoot: "" })).toThrow(
      RangeError,
    );
  });

  it("refuses an absolute root, caught by the same separator check as a relative traversal", () => {
    expect(() => resolveScopeGlob("content/**", { ...config, indexesDir: "/etc" })).toThrow(
      RangeError,
    );
  });

  it("refuses a lone '..' root even with no separator present to catch it otherwise", () => {
    expect(() => resolveScopeGlob("content/**", { ...config, contentRoot: ".." })).toThrow(
      RangeError,
    );
  });

  /**
   * Reversed from the first cut of this function, which accepted `.` on the
   * theory that a single current-directory segment "cannot leave the vault".
   * True, and the wrong property: `./**` matches the entire vault root, not
   * the content root, so a declared `content/**` scope would resolve to a
   * grant over everything in the vault, staging and `.git` included — a
   * widening of the declared subtree even though nothing left the vault. The
   * config loader (`packages/core/src/config/loader.ts`) has always rejected
   * `.` for `contentRoot`/`indexesDir`; this function now agrees with it via
   * the same shared validator instead of contradicting it.
   */
  it("refuses a root of '.', which widens content/** to the whole vault rather than leaving it", () => {
    expect(() => resolveScopeGlob("content/**", { ...config, contentRoot: "." })).toThrow(
      RangeError,
    );
  });

  /**
   * Reversed from a second cut of this function, which refused these
   * characters in `pathSegmentViolation` — the schema `contentRoot`,
   * `indexesDir`, `topicFolders`, and `topicAliases` all share — and so also
   * refused `!inbox`, the standard Obsidian convention for sorting a folder
   * to the top of an alphabetical listing, and any other ordinary directory
   * name using one of these characters. `loadConfig` threw for a vault
   * already named that way, with no way to rewrite the file to fix it either.
   * The value is a legitimate name; only being spliced unescaped into a glob
   * was ever the risk, so each character is now escaped at that splice
   * instead — this asserts the exact escaped output, not merely "does not
   * throw", so a regression that drops the escaping (leaving the character
   * live in the resolved glob) fails this test rather than passing silently.
   */
  it.each(["*", "?", "[", "]", "{", "}", "(", ")", "!", "|"])(
    "accepts a root containing the glob metacharacter %s, escaped in the resolved glob",
    (character) => {
      expect(resolveScopeGlob("content/**", { ...config, contentRoot: character })).toBe(
        `\\${character}/**`,
      );
    },
  );

  it("escapes a metacharacter root only where it is substituted, leaving the rest of the glob untouched", () => {
    expect(
      resolveScopeGlob("content/_raw/quarantine/**", { ...config, contentRoot: "notes!" }),
    ).toBe("notes\\!/_raw/quarantine/**");
  });

  /**
   * `|` is not a character-class member the way the other nine are — an
   * unescaped `|` inside a picomatch-compiled segment survives as a
   * top-level regex alternation. `contentRoot = "a|b"` used to resolve
   * `content/**` to `a|b/**`, matching neither the configured directory (the
   * literal name `a|b`) nor staying inside it — `b` and everything under any
   * sibling literally named `b` also matched. The degenerate case is worse:
   * `contentRoot = "|"` alone compiles an alternation with an empty left
   * branch, matching every path, including one rooted outside the vault
   * entirely — this is the case that would have caught `|`'s absence, since
   * the previous suite iterated the same nine characters it needed to and no
   * more.
   */
  it("escapes a lone '|' root rather than producing an alternation that matches everything", () => {
    expect(resolveScopeGlob("content/**", { ...config, contentRoot: "|" })).toBe("\\|/**");
  });

  it("refuses a root containing a NUL byte", () => {
    expect(() =>
      resolveScopeGlob("content/**", { ...config, indexesDir: "a\0b" }),
    ).toThrow(RangeError);
  });

  /**
   * Mutation-killing cases. A reviewer copied a `String.replace("content", cr)`
   * mutant of this function and an "unpin index 0" mutant, and both passed
   * every test that existed before these three cases — the earlier suite only
   * asserted what a segment-wise replace produces, never what a substring
   * replace would have produced differently. `my-content` and `contents` each
   * contain `content` as a substring but are not equal to it; `staging/
   * content/**` has `content` as a non-leading whole segment. All three must
   * survive resolution completely untouched.
   */
  it.each(["my-content/**", "contents/**", "staging/content/**"])(
    "leaves %s untouched — content only substitutes as the whole leading segment",
    (glob) => {
      expect(resolveScopeGlob(glob, config)).toBe(glob);
    },
  );

  /**
   * `_indexes` only substitutes at index 1, and only once index 0 was the
   * content root — never as a bare segment match anywhere else. Brain's real
   * indexes directory is one level under the content root
   * (`packages/brain/src/indexes/artifacts.ts`), so an `_indexes` segment
   * two levels down is a user's own folder, and one under a path that never
   * named the content root at all is not Brain's directory to begin with.
   */
  it("leaves a nested _indexes segment alone, substituting only the content root ahead of it", () => {
    expect(resolveScopeGlob("content/DEV/_indexes/notes.md", config)).toBe(
      "notes/DEV/_indexes/notes.md",
    );
  });

  it("leaves _indexes untouched under a root that never names the content root", () => {
    expect(resolveScopeGlob("staging/_indexes/**", config)).toBe("staging/_indexes/**");
  });

  /**
   * Every Brain consumer that turns `contentRoot`/`indexesDir` into a real
   * path normalizes to NFC first; `loadConfig` does not, so an NFD root here
   * must still resolve to the NFC form Brain actually writes to disk.
   * `decomposed` is the letter e followed by a standalone combining acute
   * (U+0065 U+0301); `composed` is the single precomposed code point
   * (U+00E9). Both escapes, not literal characters, so the byte-level
   * distinction this test exists to exercise cannot be silently folded away
   * by an editor or a normalizing paste.
   */
  it("normalizes a decomposed root to NFC, matching what Brain itself writes to disk", () => {
    const decomposed = "cafe\u0301";
    const composed = "caf\u00e9";
    expect(decomposed).not.toBe(composed);
    expect(resolveScopeGlob("content/**", { ...config, contentRoot: decomposed })).toBe(
      `${composed}/**`,
    );
  });
});

describe("structuredResultVerbs", () => {
  it("names every verb whose capability is structured_result, and only those", () => {
    /**
     * Equality rather than a non-empty check, and the member is pinned. A
     * non-empty check over a one-element set proves nothing, and pinning the
     * member makes a second structured-result verb a decision somebody has to
     * make here — beside the schema file it obliges the product to ship.
     */
    expect(structuredResultVerbs()).toStrictEqual(["ingest.stage"]);
  });

  it("derives from the table rather than from a list, so a capability change moves it", () => {
    /**
     * The one property a literal list cannot have. Every returned verb is a
     * verb the table agrees carries the capability, and every verb the table
     * says carries it is returned — checked in both directions against
     * `EFFECT_VOCABULARY` itself, so a hand-maintained copy that drifted from
     * the table would fail here rather than ship a schema for a verb that no
     * longer names one.
     */
    const derived = Object.entries(EFFECT_VOCABULARY)
      .filter(([, footprint]) => footprint.capability === "structured_result")
      .map(([verb]) => verb);
    expect(derived.length).toBeGreaterThan(0);
    expect([...structuredResultVerbs()].sort()).toStrictEqual([...derived].sort());
  });

  it("returns the table's own order, frozen, and equal contents on every call", () => {
    /**
     * The order is `EFFECT_VOCABULARY`'s declaration order rather than a
     * re-sort, so it is checked here as a property a caller may rely on:
     * `init` writes one file per verb and a run that ordered them differently
     * would write the same install two ways. Frozen because this is a
     * published surface.
     *
     * **Equal contents, not the same array.** A fresh array is built on every
     * call and nothing here memoizes one; `toStrictEqual` is deep equality and
     * is the property being asserted. Nothing needs referential identity, and
     * claiming it in the name while asserting equality is how a test comes to
     * describe behaviour the code does not have.
     */
    const verbs = structuredResultVerbs();
    expect(verbs.length).toBeGreaterThan(0);
    expect(Object.isFrozen(verbs)).toBe(true);
    expect(structuredResultVerbs()).toStrictEqual(verbs);
    expect(() => (verbs as string[]).push("ingest.apply")).toThrow(TypeError);
  });
});
