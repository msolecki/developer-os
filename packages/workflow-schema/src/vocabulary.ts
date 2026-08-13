import type { BrainConfigV1 } from "@developer-os/core";
import { pathSegmentViolation } from "@developer-os/core";

import type { WorkflowCapability } from "./contract.js";

export interface EffectFootprint {
  readonly read: readonly string[];
  readonly write: readonly string[];
  /**
   * Touches the transaction staging directory — reads it or writes it. Staging
   * is outside the vault by product spec §13.4 and is governed by Foundation's
   * transaction model, so it contributes nothing to either derived scope; two
   * mechanisms guarding one directory would mean neither is the authority.
   * `ingest.apply` carries both this flag and a real vault write, which are
   * different axes rather than an exclusive mode.
   */
  readonly staging: boolean;
  readonly capability: WorkflowCapability | null;
  /** The subsystem that owes the handler. A verb with no handler is a promise. */
  readonly owner: string;
  readonly implemented: boolean;
  /**
   * The `developer-os` invocation a rendered skill names for this verb, or
   * `null` when none exists to name. `command` and `implemented` are
   * different facts: a command is a declaration of what an agent would run,
   * `implemented` is whether running it does anything yet. Claiming a handler
   * before one exists is the defect `implemented` guards against one layer
   * down; naming no command for a verb that has one is the defect spec §4
   * records against three shipped skills, in both vendor trees, before this
   * field existed.
   */
  readonly command: string | null;
}

const INDEXES = ["content/_indexes/**"] as const;
const QUARANTINE = ["content/_raw/quarantine/**"] as const;

/**
 * A null prototype and a freeze that reaches the leaves. Both halves were found
 * by this task's review, and both are load-bearing for a table the whole scope
 * model is derived from.
 *
 * **Null prototype**, because `Object.freeze({…})` over a plain literal leaves
 * `Object.prototype` on the chain: `EFFECT_VOCABULARY["toString"]` returned a
 * `Function`, every consumer's `=== undefined` guard passed through it, and the
 * next line failed at `footprint.read is not iterable`. The declared type said
 * that value could not exist, so nothing warned. Worse than the crash, such a
 * verb never reached `unknownVerbs` — the refusal it should have triggered was
 * missing, and the crash was hiding that.
 *
 * **Deep freeze with copied arrays**, because `Object.freeze` is shallow and the
 * glob constants were shared by reference: one `push` onto `brain.search.read`
 * widened `brain.readIndex` with it, and an unfrozen entry let `capability` be
 * nulled to drop a requirement outright. `readonly` and `as const` are erased at
 * runtime, and this is a published surface.
 *
 * **What a null prototype costs, so a consumer is not surprised by it.** The
 * declared type is still `Record<string, …>`, which advertises every
 * `Object.prototype` member, so three things type-check and then throw:
 * `EFFECT_VOCABULARY.hasOwnProperty(verb)` (use `lookupVerb`), string coercion
 * (`String(table)`, a template literal), and `assert.deepStrictEqual` or
 * vitest's `toStrictEqual` against a plain literal, both of which compare
 * prototypes — spread the table first. Everything else behaves normally:
 * `Object.keys`/`entries`/`values`, spread, `JSON.stringify`, `in`, `for...in`,
 * and `structuredClone`.
 */
function sealVocabulary(
  table: Readonly<Record<string, EffectFootprint>>,
): Readonly<Record<string, EffectFootprint>> {
  const sealed = Object.create(null) as Record<string, EffectFootprint>;
  for (const [verb, footprint] of Object.entries(table)) {
    sealed[verb] = Object.freeze({
      ...footprint,
      read: Object.freeze([...footprint.read]),
      write: Object.freeze([...footprint.write]),
    });
  }
  return Object.freeze(sealed);
}

export const EFFECT_VOCABULARY: Readonly<Record<string, EffectFootprint>> =
  sealVocabulary({
    "brain.readIndex": { read: INDEXES, write: [], staging: false, capability: null, owner: "DOS-P2", implemented: true, command: null },
    "brain.search": { read: INDEXES, write: [], staging: false, capability: null, owner: "DOS-P2", implemented: true, command: "developer-os brain search" },
    "brain.readNote": { read: ["content/**"], write: [], staging: false, capability: null, owner: "DOS-P2", implemented: true, command: null },
    "brain.reindex": { read: ["content/**"], write: ["content/_indexes/**"], staging: false, capability: null, owner: "DOS-P2", implemented: true, command: "developer-os brain reindex" },
    "brain.lint": { read: ["content/**"], write: [], staging: false, capability: null, owner: "DOS-P2", implemented: true, command: "developer-os brain lint" },
    "capture.write": { read: [], write: QUARANTINE, staging: false, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os capture" },
    "capture.list": { read: QUARANTINE, write: [], staging: false, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os review" },
    "capture.setStatus": { read: [], write: QUARANTINE, staging: false, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os review" },
    /**
     * Spec §4's seventh Brain-adjacent verb. Same quarantine footprint as
     * `capture.setStatus` — a review edit only ever touches a quarantined
     * observation — plus the read the edit itself needs to show the author
     * what they are changing.
     */
    "capture.edit": { read: QUARANTINE, write: QUARANTINE, staging: false, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os review" },
    "ingest.stage": { read: QUARANTINE, write: [], staging: true, capability: "structured_result", owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
    "ingest.validate": { read: [], write: [], staging: true, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
    "ingest.apply": { read: [], write: ["content/**"], staging: true, capability: null, owner: "DOS-P6", implemented: false, command: "developer-os ingest" },
    "doctor.report": { read: [], write: [], staging: false, capability: null, owner: "Foundation", implemented: true, command: "developer-os doctor" },
    "cli.run": { read: [], write: [], staging: false, capability: "non_interactive_run", owner: "Foundation", implemented: true, command: null },
    "agent.prompt": { read: [], write: [], staging: false, capability: null, owner: "adapters", implemented: false, command: null },
  });

/**
 * The one way to read this table. The null prototype above already makes a bare
 * index sound, but every consumer going through one function means there is a
 * single place to reason about, and it stays sound if the table is ever rebuilt
 * from something with a prototype. `isKnownVerb` had no caller outside its own
 * test while both real consumers indexed the table directly — which is exactly
 * how the defect above survived a guard that existed.
 */
export function lookupVerb(verb: string): EffectFootprint | undefined {
  return Object.hasOwn(EFFECT_VOCABULARY, verb) ? EFFECT_VOCABULARY[verb] : undefined;
}

export function isKnownVerb(verb: string): boolean {
  return lookupVerb(verb) !== undefined;
}

/**
 * `EFFECT_VOCABULARY`'s globs are literal vault-relative paths — `content/**`,
 * not `$brain.contentRoot/**` — deliberately: a substitution syntax inside the
 * workflow contract would need its own validator and would put a configuration
 * value inside the one document meant to be comparable across installs (spec
 * §6, `workflow-schema.md` §8.1). This function is the resolution step §8.1
 * named as its own acceptance condition: the first handler or adapter to check
 * a scope glob against a real filesystem must resolve it through here rather
 * than hardcode `content/` and `_indexes` a second time.
 *
 * Validation is `pathSegmentViolation` from `@developer-os/core`, not a local
 * reimplementation. A first cut of this function rebuilt the rule from
 * `BrainConfigV1`'s docblock rather than from the config loader that actually
 * enforces it (`packages/core/src/config/loader.ts`'s `pathSegmentSchema`),
 * landed three of its four clauses, and — critically — accepted `.`, which
 * the loader has always rejected. A root of `.` reads as "one segment that
 * cannot leave the vault", which is true and is the wrong property: the
 * guarantee this function owes is that the declared *subtree* is not widened,
 * and `./**` matches the entire vault root, not the content root, so every
 * declared `content/**` scope would resolve to a grant over the whole vault —
 * staging and `.git` included. Two independent guards over one value that
 * disagree means neither is the authority; `pathSegmentViolation` is now the
 * one place this rule lives.
 *
 * `pathSegmentViolation` does **not** refuse a glob metacharacter (`*`, `?`,
 * …). A second cut of this function added that clause there, which also
 * governs `topicFolders` and `topicAliases` and made ordinary directory names
 * like `!inbox` fail to load. A metacharacter is a fine *name*; it is
 * dangerous only once spliced unescaped into a *pattern*, and that splice
 * happens below, in `escapeGlobSegment` — which is where the mitigation now
 * lives instead.
 */
function assertValidRoot(root: string, field: "contentRoot" | "indexesDir"): void {
  const violation = pathSegmentViolation(root);
  if (violation !== null) {
    throw new RangeError(`BrainConfigV1.${field} (${JSON.stringify(root)}) ${violation}`);
  }
}

/**
 * Escapes the nine ASCII characters picomatch (and glob syntax generally)
 * treats specially, so a root containing one is matched as a literal
 * directory name rather than as a pattern. `pathSegmentViolation` never
 * refuses these characters in a root — `!inbox`, `PROJECTS (2024)`, and
 * `notes{drafts}` are all valid, ordinary directory names — so a root
 * reaching this function can legitimately contain any of them, and this is
 * the one place, right before the splice into a glob, where that stops being
 * a live risk. A root can never contain the backslash used to escape with:
 * `pathSegmentViolation` refuses `\` unconditionally as a separator, so this
 * function never has to escape an escape.
 */
const GLOB_METACHARACTERS = /[*?[\]{}()!]/gu;

function escapeGlobSegment(segment: string): string {
  return segment.replace(GLOB_METACHARACTERS, (character) => `\\${character}`);
}

/**
 * Rewrites the leading `content` segment, and an immediately-following
 * `_indexes` segment, of a vocabulary glob to the roots a real `BrainConfigV1`
 * names, so a vault configured with `contentRoot: "notes"` gets a grant
 * naming `notes/**` instead of a `content/**` directory that does not exist
 * in it.
 *
 * Both substitutions are pinned to a position, not a bare segment match:
 * - `content` only at index 0. `content` is a substring of `contents`, and
 *   `String.replace` or an unpositioned segment match would rewrite either
 *   one — a vault folder literally named `content` nested under `staging/`
 *   would be corrupted the same way. Requiring index 0 makes both defects
 *   structurally impossible rather than merely untested.
 * - `_indexes` only at index 1, and only once index 0 was actually `content`.
 *   Brain's real indexes directory is one level under the content root
 *   (`packages/brain/src/indexes/artifacts.ts`); an `_indexes` folder a user
 *   made two levels down, or a `staging/_indexes/**` path that never named
 *   the content root at all, is not that directory, and rewriting it anyway
 *   would point a grant at a directory that does not exist (or, worse, apply
 *   Brain's configuration to a path that was never Brain's to begin with).
 *   Gating on index 0 is what keeps this from firing on either case.
 *
 * A glob whose first segment is not `content` is returned unchanged — no
 * substitution applies. Both roots are still validated on every call before
 * that check runs, not only when a glob happens to reference them: resolving
 * `EFFECT_VOCABULARY` entries one glob at a time against a bad config would
 * otherwise throw for some globs and silently succeed for others in the same
 * run, which is a config error surfacing as a heisenbug instead of a refusal.
 *
 * **NFC, on the way in.** Every Brain consumer that builds a real path from
 * `contentRoot`/`indexesDir` normalizes to NFC first (`indexes/artifacts.ts`,
 * `indexes/build.ts`, `discovery/discover.ts`, `lint/lint.ts`, `service.ts`),
 * but `loadConfig` does not — a TOML file can hand either form to this
 * function. Normalizing the substituted root here makes this function's
 * output match what Brain actually writes to disk, which is the property
 * that matters for a byte-comparing scope check. It is a partial fix: a
 * caller that reads `config.contentRoot` directly, without going through
 * `resolveScopeGlob`, still sees whatever normalization form the TOML file
 * happened to use. `loadConfig` normalizing at load time would close that
 * gap for every consumer at once and is the more complete fix — out of this
 * task's scope (`vocabulary.ts`/`index.ts` only), left for whoever wires the
 * first real caller.
 *
 * **Escaped, then substituted.** `escapeGlobSegment` runs on the root after
 * normalization and before it is spliced in, so a root of `!inbox` produces
 * a literal `\!inbox` segment that matches only a directory named `!inbox` —
 * not the "any sibling of the vault root" a bare `!inbox` would read as once
 * a real glob matcher resolved it.
 */
export function resolveScopeGlob(glob: string, config: BrainConfigV1): string {
  assertValidRoot(config.contentRoot, "contentRoot");
  assertValidRoot(config.indexesDir, "indexesDir");

  const segments = glob.split("/");
  if (segments[0] !== "content") return glob;

  const resolved = [escapeGlobSegment(config.contentRoot.normalize("NFC"))];
  if (segments[1] === "_indexes") {
    resolved.push(escapeGlobSegment(config.indexesDir.normalize("NFC")), ...segments.slice(2));
  } else {
    resolved.push(...segments.slice(1));
  }
  return resolved.join("/");
}
