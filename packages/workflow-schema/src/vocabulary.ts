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
