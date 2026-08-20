/**
 * Frozen, like every other constant surface in this module. `as const` is a type-level
 * claim; `FAILURE_CODES` snapshots these values at module load, so a mutation afterwards
 * would desynchronize the validator from `EXIT_CODES.success` — which is the one comparison
 * that decides whether a published document may carry a success status.
 */
export const EXIT_CODES = Object.freeze({
  success: 0,
  operationalFailure: 1,
  invalidInput: 2,
  decisionRequired: 3,
  capabilityUnavailable: 4,
  securityRefusal: 5,
  recoveryRequired: 6,
} as const);

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

declare const redacted: unique symbol;

/**
 * **A value that has been through the redactor, and nothing else.**
 *
 * The brand is a `unique symbol` declared here and exported by no one, so no other module
 * can write the type structurally; `redactPayload` is the only producer. Anything published
 * as `CliError.data` therefore passed *some* redactor, checked by the compiler at every
 * call site rather than by a sweep that has to anticipate the syntax. That it passed *this
 * product's* redactor is what `tests/repository/failure-data-entry.test.ts` adds, by keeping
 * the producer's call sites down to the composition root — and that nothing rides into
 * `--json` *beside* it is what `failure` adds, by rebuilding the arm it publishes.
 *
 * It is `declare const`, so it exists only in the type system — the property is never
 * emitted, never serialized, and `--json` output is byte-for-byte what it was.
 */
export type RedactedPayload = { readonly [redacted]: true };

/**
 * **A redactor, as everything below it needs to see one.**
 *
 * `packages/core` does not depend on `packages/security` and must not, so the walk takes
 * the function rather than the module. That is also what makes the producer below a real
 * chokepoint: a caller cannot mint a `RedactedPayload` without handing over something to
 * redact with.
 */
export type Redactor = (text: string) => string;

/**
 * **A budget for the whole walk, because two per-axis bounds do not bound a product of
 * axes.** Depth was capped at 64 and breadth at 10 000, which is 10000^64 nodes — finite,
 * and useless. A caller-supplied *aliased* graph exploits it with no `Proxy` and no cycle:
 * `for (i=0;i<30;i++) node = { a: node, b: node }` is 31 plain objects and expands to 2^30
 * paths, because the cycle set is per-path by design.
 *
 * **Measured, and the operation is named because two earlier versions of this sentence did
 * not.** At 22 doublings over a `{ v: "x" }` leaf — 23 objects, since the leaf is one —
 * `JSON.stringify` produces 83,886,069 bytes and retains ~80 MB;
 * *this walk*, building a redacted copy with the budget removed, retains ~495 MB — six times
 * as much, because it materializes objects rather than text. At 31 objects the two also fail
 * differently: `JSON.stringify` throws a **catchable** `RangeError: Invalid string length`,
 * while the walk aborts the process with a fatal out-of-memory that no `catch` can contain.
 * It is the second that matters here, and `failureFrom` calls the producer outside any `try`.
 * The first version of this sentence reported the byte count as if it were memory; the second
 * gave a memory figure without saying which operation it belonged to.
 *
 * One counter over every node visited is the bound that actually holds, and it is far above
 * any report a run of ordinary size builds: `RunReportV1` nests one entry per capture and,
 * under a refusal, one per note that capture applied — a product of two batch sizes rather
 * than the flat per-capture list an earlier version of this sentence claimed. It is not a
 * *bound*: quarantine size is the user's and `--limit` caps only the accepted set, so a
 * large enough run reaches the counter honestly and is truncated with a marker, which is
 * the outcome this constant exists to produce.
 */
const MAX_NODES = 100_000;

/**
 * **A bounded copy of a caller's list, because a spread is not one.** Every place this
 * module copied `paths` or `warnings` wrote `[...value]`, which drives the value's own
 * `Symbol.iterator` to completion: an iterator that never reports `done` grows the array
 * until V8 aborts the process with `FATAL ERROR: invalid array length`. That is not a
 * throw, so the `try` blocks those spreads sat inside did not contain it — the same
 * distinction the array branch of `walk` was fixed for one screen up, where the docblock
 * says a runaway breadth is "what no `catch` can contain". The spreads were left behind by
 * that fix.
 *
 * **The iterator is abandoned, not closed, and that is the whole reason this is written by
 * hand.** The obvious spelling is `for…of` with a `break`, and it is wrong: *any* early exit
 * from `for…of` performs IteratorClose, which calls the iterator's `return()` — and
 * `return()` is the caller's code. A `return()` that loops forever is an uncatchable hang in
 * the same field, by the same actor, as the abort above; the first version of this function
 * shipped it, having replaced one uncontained failure with another and said in this
 * paragraph that closing the iterator *was* the bound. A spread never called `return()` at
 * all, so that spelling was strictly worse than what it replaced. Driving `next()` directly
 * and walking away leaves a suspended generator for the collector, which costs nothing and
 * runs none of the caller's code.
 *
 * Anything `next()` or the `Symbol.iterator` lookup throws is contained here rather than at
 * each call site, because a caller's list is inspected on the failure path, where the
 * alternative to a truncated list is no diagnostic at all.
 *
 * **What this bounds is the number of invocations, not the work inside one**, and the
 * distinction is worth stating because the paragraph above could be read as the stronger
 * claim. `value[Symbol.iterator]` is a caller getter, `next()` is caller code run up to
 * `MAX_NODES` times, and `step.done` and `step.value` can each be a caller accessor. A
 * `next()` that spins is the same uncatchable hang as the `return()` above, and nothing
 * here can prevent it — what it can do is never *choose* to call one, which is why
 * `return()` is the invocation that was removed.
 *
 * **A separate counter from the walk's, sharing the same constant.** There is one
 * `MAX_NODES`; what is not shared is the `Budget` object. Sharing it would let a large `data`
 * payload silently empty `paths`, which is the field a user needs most when a command
 * refuses. Because the counters are separate, a document can spend the full walk budget *and*
 * carry a full list — the bound is per surface, not per document.
 *
 * A truncated list is reported rather than silently short: the marker is an entry, so a
 * reader sees that the product stopped copying instead of believing it saw everything. A
 * list whose own entry is spelled `"[truncated]"` is indistinguishable from that marker;
 * unlike the object branch there is no name to widen, and a positional list has nowhere to
 * put the distinction.
 */
function boundedList(value: Iterable<unknown>): unknown[] {
  const copied: unknown[] = [];
  try {
    const iterator = value[Symbol.iterator]();
    for (;;) {
      const step = iterator.next();
      /**
       * **Truthiness, because that is what `IteratorComplete` is.** A strict `=== true` test
       * calls an iterator returning `{ done: 1 }` unfinished where the language calls it
       * finished, so a conforming iterator was copied to the cap and marked truncated. The
       * outcome was bounded either way; matching the protocol is what stops this from being
       * a second place the module has an opinion about a caller's value.
       */
      if (step.done ?? false) return copied;
      /**
       * **The marker is pushed only when something was actually dropped.** The loop was
       * `while (copied.length < MAX_NODES)` with an unconditional push after it, so a list of
       * exactly `MAX_NODES` entries — complete, nothing lost — published `MAX_NODES + 1`
       * entries ending in `"[truncated]"`. That tells a reader the opposite of the truth, in
       * the one function whose docblock promises they will not "believe it saw everything".
       * Asking the iterator for one more element and marking only if it answers is the
       * difference between a full list and a truncated one.
       */
      if (copied.length >= MAX_NODES) {
        copied.push("[truncated]");
        return copied;
      }
      copied.push(step.value);
    }
  } catch {
    copied.push("[unserializable]");
  }
  return copied;
}

/** Below what `JSON.stringify` survives, so this is never the binding limit. */
const MAX_DEPTH = 64;

/**
 * **A plain object carrying `toJSON` is not walkable, and that is the case that got away.**
 * Its prototype is `Object.prototype`, so a prototype test alone calls it plain and walks
 * its entries — where the `toJSON` function is a non-object and passes through untouched.
 * `JSON.stringify` then calls it, and the bytes it returns were never redacted. Whatever
 * the serializer will *substitute* has to be what this function sees.
 */
function isWalkable(value: object): boolean {
  /**
   * **The callability test is load-bearing, and an earlier version of this comment called it
   * an equivalent.** It claimed a non-callable `toJSON` produces "the same bytes walking it
   * would". It does not: `normalize` round-trips through `JSON.stringify`/`parse`, and a
   * non-callable `toJSON` *survives* that round trip — so the parsed copy fails `isWalkable`
   * again and re-normalizes, once per level, until `MAX_DEPTH` truncates the whole subtree.
   * Measured: `{ toJSON: 42, s: "leaf" }` publishes its leaf today and `"[truncated]"` with
   * the conjunct removed. `normalize` is idempotent for a *callable* `toJSON` and not for a
   * non-callable one, which is the asymmetry this test encodes.
   *
   * That makes it the second wrong inertness label found in this file, and the reason both
   * mattered is the convention: a labelled site is one later reviews skip.
   */
  if ("toJSON" in value && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return false;
  }
  if (Array.isArray(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A non-plain value as `JSON.stringify` would render it, so the redactor sees the same
 * bytes the serializer will emit. A marker on refusal rather than a throw —
 * `"[truncated]"` when the budget ran out, `"[unserializable]"` otherwise — because this
 * runs inside a `catch`.
 */
function normalize(value: object, budget: Budget): unknown {
  try {
    /**
     * **Counted under the same budget as the walk.** This serialized the whole reachable
     * subgraph before a single node was counted, so any value `isWalkable` rejects — a
     * plain object carrying `toJSON`, a class instance — re-opened the aliased-graph hole
     * the budget was added to close: 23 levels aborted the process with a fatal
     * out-of-memory, uncatchable, from a producer `failureFrom` calls outside any `try`.
     * The replacer is the only place a node can be counted before it is built.
     */
    const text = JSON.stringify(value, (_key: string, entry: unknown) => {
      budget.spent += 1;
      if (budget.spent > MAX_NODES) throw new BudgetExceeded();
      return entry;
    });
    return JSON.parse(text) as unknown;
  } catch (error) {
    /**
     * **Only the second marker is observable, and saying so is the point.** `walk` hands
     * this return straight back to `redactDeep`, whose first line is the same budget check
     * — so an over-budget value reads `"[truncated]"` whichever marker is chosen here. The
     * distinction is kept because it stops being free the moment that re-entry changes, and
     * it is recorded as unpinnable rather than pinned by a case that would pass either way.
     */
    return error instanceof BudgetExceeded ? "[truncated]" : "[unserializable]";
  }
}

class BudgetExceeded extends Error {}


/** The single total-node counter `redactDeep` threads through the whole traversal. */
interface Budget {
  spent: number;
}

/**
 * **Every string leaf of a published value, redacted — keys as well as values, and not the
 * top level only.**
 *
 * `CliError.data` is serialized into `--json`, so it is a publishing surface, and the rule
 * this product has always applied to `message` applies to it identically. Doing it here
 * rather than at each call site is the point: a nested `{ refused: [{ message }] }` is
 * exactly the shape where forgetting is invisible until a secret is already in someone's
 * terminal. **Keys are redacted too** — a first version walked values only, so
 * `{ "Authorization: Bearer …": 1 }` published the secret verbatim under a docblock
 * promising "every string leaf".
 *
 * **Bounded and cycle-safe, because this runs inside a `catch`.** A first version had
 * neither: a self-referencing `data` raised `RangeError: Maximum call stack size exceeded`
 * out of a command's error handler, and it overflowed at depth ~1875 where
 * `JSON.stringify` survives to ~6172 — so the redactor became the binding depth limit and
 * turned the error path into the crash path. A seen-set collapses a cycle to
 * `"[circular]"` and `MAX_DEPTH` truncates below both limits. Neither can be reached by
 * anything shipping today; the slot exists so that others will populate it.
 *
 * **Anything the serializer would substitute is normalized before it is walked, not
 * skipped.** A first version walked every object and emptied `Date`, `Map`, `Set` and
 * `Error` to `{}`; the fix was to leave them alone, and that opened a redaction hole the
 * fix's own headline denied — a class instance, an `Error` subclass and an object carrying
 * `toJSON` all reached `--json` with their strings unredacted, because `JSON.stringify`
 * renders them and `JSON.stringify` is not the redactor. `toJSON` is the sharp one: the
 * *containing* object is plain, so it is walked, the function property is copied through,
 * and the bytes the serializer finally emits never passed here at all.
 *
 * So a non-plain object is put through `JSON.stringify`/`parse` first — which applies
 * `toJSON`, turns a `Date` into its ISO string and a class instance into a plain object —
 * and the result is walked like anything else. A value the serializer refuses (a `BigInt`,
 * or a cycle inside a non-plain object that the seen-set above never entered) becomes
 * `"[unserializable]"`, because a published field must not be able to throw out of a
 * `catch` block.
 *
 * **No inspection of a caller-supplied value may throw out of here**, and stating it as
 * one rule rather than a list of branches is the point: `Object.entries` invokes getters,
 * `"toJSON" in value` runs a Proxy `has` trap, `Array.prototype.map` reads
 * `Symbol.species`, and `Object.getPrototypeOf` runs another trap. A version that wrapped
 * only the first left the other three escaping, and enumerating branches is how that
 * happened. Anything that throws yields `"[unserializable]"` — every caller of this
 * function stands in a `catch` block, and a redactor that throws replaces a command's
 * diagnostic with a stack trace.
 */
function redactDeep(
  redact: Redactor,
  value: unknown,
  seen: ReadonlySet<object> = new Set(),
  depth = 0,
  budget: Budget = { spent: 0 },
): unknown {
  budget.spent += 1;
  if (budget.spent > MAX_NODES) return "[truncated]";
  /**
   * The depth-0 string leaf is outside the containment below, deliberately and for
   * consistency: `message` is redacted on the line above every call to this function with
   * no protection either. A `redactDiagnostic` that throws is a broken redactor, not a
   * hostile value, and the two should fail the same way.
   */
  if (typeof value === "string") return redact(value);
  /**
   * **A `bigint` reaches the serializer and kills the process, so it is stopped here.**
   * It is not an object, so it left through the line below untouched, and
   * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` — at
   * *publish* time, in `main.ts`, long after the `catch` that built this result returned.
   * No `--json` line is printed at all and the process dies with Node's exit code instead
   * of the command's. `symbol` and `function` are dropped silently by the serializer
   * rather than throwing, and are named for the same reason: what is published should be
   * decided here, not by what `JSON.stringify` happens to do with it.
    *
   * **Redacted because it is published as text, which is the whole of the reason.** A
   * `bigint` cannot be a JSON number — it has to be stringified to be published at all —
   * and every string this module emits goes through the redactor. Its digits went out
   * untouched while the string sibling beside them redacted, against three docblocks here
   * promising "every string leaf".
   *
   * **A `number` deliberately does not get the same treatment, and the difference is the
   * published type rather than the risk.** `redact` is `string => string`, so applying it
   * to a `number` leaf would publish `"1"` where `RunReportV1` declares `schemaVersion: 1`,
   * and a consumer validating the document would reject every report to redact a field that
   * is a product-chosen constant. A numeric identifier a user listed in `[redaction]
   * patterns` therefore escapes through a `number` leaf — a real limitation, registered as
   * NEW-37 rather than papered over here, because the fix is a redactor that can answer
   * about a value without changing its type and this module cannot invent one.
   */
  if (typeof value === "bigint") return redact(`${value.toString()}n`);
  if (typeof value === "symbol" || typeof value === "function") {
    return "[unserializable]";
  }
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";

  const nested = new Set(seen).add(value);
  /**
   * **The whole traversal is contained, not just the plain-object branch.** A first version
   * wrapped only `Object.entries`, and four other reads of a hostile value still escaped:
   * `isWalkable`'s own `"toJSON" in value` (an *accessor* named `toJSON` that throws, and a
   * Proxy `has` trap), `Array.prototype.map` (a `Symbol.species` getter that throws), and a
   * `getPrototypeOf` trap. Each of those is a read this function performs *about* the value
   * rather than *of* it, which is why enumerating the branches missed them.
   *
   * Every caller stands in a `catch` block, so the rule is one line rather than a list: no
   * inspection of a caller-supplied value may throw out of here.
   */
  try {
    return walk(redact, value, nested, depth, budget);
  } catch {
    return "[unserializable]";
  }
}


/**
 * **A name no entry already holds.** Widening a suffix until it is free is the only
 * spelling that terminates and cannot overwrite: `${name}#${written}` used the entry
 * counter, so a payload already containing a key spelled like the synthesized one lost its
 * value. Both synthesized names in the object branch — a redacted key and the truncation
 * marker — go through here, because the marker collides exactly like a key does.
 */
function freeName(
  walked: Record<string, unknown>,
  name: string,
  written: number,
): string {
  let unique = name;
  while (Object.hasOwn(walked, unique)) unique = `${unique}#${String(written)}`;
  return unique;
}

function walk(
  redact: Redactor,
  value: object,
  nested: ReadonlySet<object>,
  depth: number,
  budget: Budget,
): unknown {
  /**
   * **`isWalkable` is asked before `Array.isArray`, and the reason is now history rather
   * than an invariant.** It mattered when the array branch used `Array.prototype.map`,
   * which builds through ArraySpeciesCreate: mapping a subclass returned another instance
   * of it, still carrying a prototype `toJSON` for `JSON.stringify` to call. The branch
   * builds a literal now, so either order produces a plain array — the ordering is kept
   * because a `toJSON` carrier should be normalized rather than walked, which is a separate
   * reason and the one that still applies.
   */
  if (!isWalkable(value)) {
    /**
     * **The increment is real, and an earlier version of this comment called it an
     * equivalent.** It is not: this branch charges a level for the hop through `normalize`,
     * so a non-plain value truncates one level shallower than a plain one — measured, a class
     * instance nested 63 deep reads `"[truncated]"` where a plain object at 63 still reads
     * its leaf. That is correct, because the hop *is* another frame of recursion and
     * `MAX_DEPTH` exists to stay below the stack limit, not to promise a uniform ceiling. It
     * is charged and the asymmetry is pinned below.
     *
     * The label mattered more than the line: this file's convention is that a labelled site
     * is inert, so calling a live boundary an equivalent would have excused it from every
     * later review.
     */
    return redactDeep(redact, normalize(value, budget), nested, depth + 1, budget);
  }
  if (Array.isArray(value)) {
    /**
     * **Built with a literal, not with `map`.** `Array.prototype.map` goes through
     * ArraySpeciesCreate, so an array subclass with a hostile `Symbol.species` supplied the
     * object this walk wrote its results into — and every other own property the attacker
     * had put on it survived untouched, then went through `deepFreeze`, into `payloads` as
     * a legitimate product, and out to `--json`. The species output could even carry a
     * `toJSON`, which is the attack `isWalkable` exists to stop, reached *through* the
     * producer. This module's own rule is never to ask the value; delegating construction
     * asks it to build the thing membership will then vouch for.
     *
     * **`length` is read once.** The loop re-read `value.length` every iteration, so a
     * `Proxy` whose trap kept growing it never terminated — 22 million reads and still
     * going, which no `catch` can contain and `MAX_DEPTH` does not bound, since it bounds
     * depth and this is breadth. `Array.prototype.map`, which this replaced to close a
     * `Symbol.species` hole, took its own snapshot; swapping one for the other traded a
     * species hole for a re-read hole, which is the same class of defect one line over.
     */
    /**
     * **A refused `length` is a marker, not an empty array.** `Array.isArray` is true for a
     * `Proxy` over an array, so a `length` trap can answer anything. A value that is not a
     * non-negative safe integer published `[]` — every entry gone, with none of the two
     * markers this module emits for a value it could not take. That is the silent drop the
     * object branch's own docblock calls the worst available answer, in the branch beside
     * it. `"[unserializable]"` is the right word: the array is not truncated, it is a shape
     * this walk cannot take at all.
     *
     * **`Number.isSafeInteger` and an explicit sign test, because the first fix covered two
     * of the three cases its own paragraph named.** It refused `Infinity` and `NaN` and
     * clamped the rest with `Math.max(Math.trunc(declared), 0)` — so `-1` still published
     * `[]`, and the clamp that looked like the guard for it was dead code, since a `for`
     * loop with a negative bound runs zero times either way. A fractional length was worse
     * than either: `2.7` truncated to `2` and dropped a real third entry with no marker at
     * all. A length that is not already an exact index count is a length this module did not
     * get from an array.
     */
    const declared: unknown = value.length;
    if (!Number.isSafeInteger(declared) || (declared as number) < 0) {
      return ["[unserializable]"];
    }
    const length: number = declared as number;
    const copied: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      if (budget.spent > MAX_NODES) {
        copied.push("[truncated]");
        break;
      }
      copied.push(redactDeep(redact, value[index], nested, depth + 1, budget));
    }
    return copied;
  }
  /**
   * **A collision keeps both entries.** Redaction is not injective — two distinct keys can
   * reduce to the same token, and `{ "ghp_AAA…": "first", "ghp_BBB…": "second" }` became a
   * single `"[REDACTED:provider-token]": "second"` through `Object.fromEntries`, losing the
   * first with no marker. That is the exact shape the key-redaction docblock above cites as
   * its reason for existing, so silently dropping half of it is the worst available answer.
    *
   * **A null-prototype accumulator, and an own-property test — and only one of them is still
   * observable.** With the accumulator being `Object.create(null)`, `Object.hasOwn` and `in`
   * agree on every input, so reverting the own-property test alone changes nothing and no
   * test can pin it. Both landed for one defect and either alone answers it; the pair is kept
   * because the accumulator is the load-bearing half and a future refactor that gives it a
   * prototype should not silently re-open the other. `redacted in walked` sees
   * `Object.prototype`, so a payload with a key named `toString` or `constructor` was
   * renamed to `toString#0` though nothing collided. `Object.hasOwn` alone is not the fix:
   * assigning `walked["__proto__"]` on an ordinary object sets the prototype and the entry
   * vanishes from the output — today that case is saved only by the bug being fixed here.
   */
  const walked: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let written = 0;
  for (const [key, entry] of Object.entries(value)) {
    /**
     * **The object branch stops at the budget, as the array branch does.** It iterated every
     * entry regardless: a 250 000-key payload ran the redactor 350 000 times and published
     * 250 000 keys against a 100 000 budget, with no marker — so a consumer could not tell a
     * complete report from an over-budget one, and the two branches disagreed about what the
     * budget meant.
     */
    if (budget.spent > MAX_NODES) {
      /**
       * **Through the uniquifier below, not past it.** This was a bare assignment, so a
       * payload carrying its own `"[truncated]"` key had that key's value overwritten by
       * the marker — the silent drop the collision paragraph above calls the worst
       * available answer, committed a second time by the guard written after it. The marker
       * is a synthesized name like any other and collides like any other.
       */
      walked[freeName(walked, "[truncated]", written)] = true;
      break;
    }
    const redacted = redact(key);
    /**
     * **A suffix that cannot collide with a literal key.** `${redacted}#${written}` used the
     * entry counter, so a payload already containing a key spelled like the synthesized one
     * lost its value — the outcome the paragraph above calls the worst available answer,
     * committed by the code written to avoid it. Widening the suffix until it is free is the
     * only spelling that terminates and cannot overwrite.
     */
    walked[freeName(walked, redacted, written)] = redactDeep(
      redact,
      entry,
      nested,
      depth + 1,
      budget,
    );
    /**
     * **Not vestigial — it decides the published key names**, which an earlier version of
     * this comment denied in the same breath as explaining why they matter. `freeName` widens
     * `unique` until it is free, so *correctness* does not depend on the counter: any
     * constant terminates and none can overwrite. But the names differ. Measured, with a
     * collapsing redactor over three keys: `{"R":1,"R#1":2,"R#2":3}` today,
     * `{"R":1,"R#0":2,"R#0#0":3}` without the increment — a suffix that grows by
     * concatenation instead of counting. No test reddens on removal, because no case asserts
     * a collided key's exact name; what is asserted is that both entries survive.
     */
    written += 1;
  }
  return { ...walked };
}


/**
 * **The only producer of `RedactedPayload`, and it redacts rather than asserting.**
 *
 * A first version was `redactPayload(value)` — a bare cast, exported on the package's
 * public surface. That was **weaker than the sweep it replaced**: the sweep at least
 * demanded entry through `failureFrom`, while an exported assertion let any of the eight
 * `failure(` sites write `data: redactPayload(secret)`, compile clean, lint clean, pass the
 * gate, and publish a raw token. It was the one call the docblock told people to make.
 *
 * Requiring the redactor is what fixes it: the brand now means "every string leaf of this
 * value went through the function supplied here", which is a property the type can carry
 * because obtaining the type requires performing the walk.
 *
 * **What it still cannot mean** — stated because the last four versions of this docblock each
 * claimed more than they enforced, the previous one by claiming *less* than the runtime does.
 * A caller can supply an identity function, and a caller can defeat the type **before**
 * calling. That is the whole of it: merging with `Object.assign` and spreading into a wider
 * object type-check, because an intersection is still assignable, but both produce a *new*
 * object that `payloads` does not hold, so `failure` drops it; and a cast cannot mutate one
 * afterwards, because this function deep-freezes what it returns. Those three were listed
 * here as open residuals after the freeze that closed them landed in `deepFreeze` below.
 *
 * The remaining acts are deliberate rather than shapes somebody writes by accident, and
 * `tests/repository/failure-data-entry.test.ts` sweeps for the two that were greppable
 * first — a cast onto the brand, and a call to this function outside the composition root —
 * plus four more that later reviews reached it with.
 */
export function redactPayload(redact: Redactor, value: unknown): RedactedPayload {
  /**
   * **Frozen deeply here rather than at the seam that publishes it.** The walk already
   * visits every node, and a payload that can be mutated after it is redacted is a payload
   * that was not redacted: `Object.assign(payload, { secret })` reached `--json` through a
   * reference `failure`'s own freeze could not follow.
   */
  const payload = deepFreeze(redactDeep(redact, value));
  if (typeof payload === "object" && payload !== null) payloads.add(payload);
  else primitivePayloads.add(primitiveKey(payload));
  return payload as RedactedPayload;
}

/** Every reachable object, frozen. The walk's output is a tree, so this terminates. */
function deepFreeze(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  /**
   * `Object.values` invokes getters, and this runs outside `redactDeep`'s own containment —
   * a getter injected into the walk's output threw straight out of `redactPayload`.
   *
   * **It is live, and an earlier version of this comment said it could not fire.** That
   * claimed the walk only ever sees objects it built itself. It does not: `redactDeep`'s
   * string branch returns `redact(value)` **verbatim**, so whatever the supplied redactor
   * hands back is spliced into the output and read here. Measured — a redactor returning an
   * object with a throwing getter has that getter invoked exactly once, inside this `catch`.
   * The unstated premise was that a `Redactor` honours `(text: string) => string`, and
   * `asText` refuses to rely on exactly that assumption for `CliError`'s fields.
   *
   * That is the fifth wrong inertness label found in this file, and they share a shape: an
   * argument that establishes something *adjacent* to the claim reads as proof of it.
   */
  try {
    for (const entry of Object.values(value)) deepFreeze(entry);
  } catch {
    /* a value that cannot be enumerated cannot be frozen deeper */
  }
  return Object.freeze(value);
}

export interface CliError {
  readonly kind: string;
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
  /**
   * **What moved before the run failed, as fields.** A command that processes a batch and
   * refuses one member is neither wholly successful nor wholly failed: `ingest` contains
   * each capture's refusal to that capture, and without this the per-capture outcomes
   * shipped as lines inside `message`, where a consumer had to parse prose (BACKLOG,
   * Foundation request 3). `brain lint` and `doctor` recorded the same constraint, so three
   * commands wanted it before it was built.
   *
   * **The type is the chokepoint, and five review rounds went into learning that it had to
   * be.** This was `data?: unknown`, guarded by a repository sweep for anyone writing the
   * field outside `failureFrom` — and the sweep was falsified in every round: four evasions,
   * then seven, then a conditional spread, then five inline shapes, then five more. The
   * count never fell, because `CliResult` is a plain structural union and the set of
   * syntactic shapes that can produce a failure arm is unbounded. A sweep that enumerates
   * syntax is playing a game it cannot finish.
   *
   * `RedactedPayload` ends the *shape* half of it. The brand is a `unique symbol` no module
   * can name, so obtaining one means calling `redactPayload`, which performs the walk — and
   * every shape the sweep chased now fails `tsc` for one reason instead of one rule each:
   * `{ …, data }` shorthand, `as CliError`, an IIFE, a bound identifier, a hand-built
   * `{ ok: false, error }` arm.
   *
   * **What it does not end**, because a review falsified the first version of this
   * paragraph for claiming otherwise, a later one falsified the correction for claiming too
   * little, and a third named the wrong mechanism: a caller can supply an identity redactor,
   * and a caller can defeat the type **before** calling the producer.
   *
   * `Object.assign` onto a payload and spreading one both type-check, since an intersection
   * is still assignable, and **two different things stop them**. `Object.assign(payload, …)`
   * returns *`payload`* — the object is still in `payloads`, and what refuses it is the deep
   * freeze, which makes the write throw from any caller: `Object.assign` sets with
   * `throw = true` internally, so strict mode is not what decides it. (Strict mode decides
   * throw-versus-silent-no-op for a *bare* assignment, which is a different act.) `Object.assign({}, payload, …)` and `{ ...payload }`
   * build a *new* object, which `payloads` does not hold, so `failure` drops the field. A
   * version of this paragraph attributed both to the registry; moving the freeze elsewhere
   * would then have looked safe, and it is not. Those are deliberate acts. The sweep covers what is greppable — a cast onto the brand, `as never`,
   * a type predicate or `asserts` signature naming it, a producer call, a variable bound to
   * the producer, and a re-export of it. That list grew twice under review, which is why it
   * is a list of what was measured rather than a claim about what remains.
   *
   * **The brand is type-only**, so `--json` bytes are unchanged: `JSON.stringify` never sees
   * a property that does not exist at runtime.
   *
   * **Optional, so no existing caller changes** — nothing populates a field that does not
   * exist yet, which is what made this safe to add to the shape `foundation.md` §2 froze.
   * It is absent rather than `null` when unset, so every existing `--json` document is
   * byte-identical.
   */
  readonly data?: RedactedPayload;
}

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

declare const constructed: unique symbol;

/**
 * **The failure arm is unconstructable outside `failure`, and that is the only thing that
 * ends the class.**
 *
 * `CliResult` was a plain structural union, so `{ ok: false, code, error }` written by hand
 * typechecked — and a hand-built arm skips every guarantee `failure` provides. A review
 * demonstrated it with a class `implements CliError` carrying a `toJSON` that injects `data`
 * at serialization time: the brand on `data` never sees it, because `toJSON` names no field
 * at the type level, and the rebuild in `failure` never runs, because `failure` was never
 * called.
 *
 * **Rebuilding inside `failure` was the previous answer and it was not enough** — it closes
 * the routes only for callers who choose to go through it, which is a promise about
 * politeness rather than a property of the type. Worse, the sweep that had covered
 * hand-built arms was retired in the same change, on the argument that the `data` brand made
 * them a compile error. It does not: a `toJSON` never mentions `data`.
 *
 * Branding the arm makes the *literal* spelling a compile error, which is worth having and
 * is not the whole answer: a phantom property rides through `Object.assign`, object spread,
 * `Proxy` and `structuredClone` while every runtime property it stood for is discarded, so
 * a reshaped result still typechecks. What closes the class is `publish` asking whether the
 * value in its hand is one `failure` returned — identity is the thing those operations
 * cannot forge.
 *
 * Type-only, like `RedactedPayload`: no property is emitted and `--json` is unchanged.
 */
type Constructed = { readonly [constructed]: true };

export type CliResult<T> =
  | {
      readonly ok: true;
      readonly code: typeof EXIT_CODES.success;
      readonly data: T;
      readonly warnings: readonly string[];
    }
  | ({
      readonly ok: false;
      readonly code: FailureExitCode;
      readonly error: CliError;
    } & Constructed);

/** Produced by `redactPayload`, asked by identity for an object and by value otherwise. */
function isRedactedPayload(value: unknown): boolean {
  if (typeof value === "object" && value !== null) return payloads.has(value);
  /**
   * **A primitive only, so no caller-supplied `toString` runs.** An earlier key coerced any
   * value, so a function-valued `data` threw out of `failure` and a `toString` returning an
   * object threw a `TypeError`, both uncontained. A function or a symbol is not a primitive
   * the walk can produce, so refusing them here costs nothing.
   */
  if (typeof value === "function" || typeof value === "symbol") return false;
  return primitivePayloads.has(primitiveKey(value));
}

/**
 * A primitive's identity for the set above. `JSON.stringify` is not used: its declared
 * return type is `string` while it genuinely returns `undefined` for a function, a symbol or
 * `undefined`, so the `??` that handles it reads as unnecessary to the linter — the same
 * lie about the same function that `asText` was written around.
 *
 * **Every primitive, not only strings.** The walk returns numbers, booleans and `null`
 * unchanged, so a payload the producer legitimately minted from one of those was silently
 * discarded by `failure` — and the docblock justifying the narrower version said "the walk's
 * non-object output is always a string", which is false.
 *
 * `typeof` is part of the key so `1` and `"1"` cannot collide, and no caller-supplied
 * `toString` is invoked: a primitive's own conversion is the language's, not the value's.
 */
function primitiveKey(value: unknown): string {
  return `${typeof value}:${String(value)}`;
}

/**
 * **A string, whatever the value really is.**
 *
 * `CliError`'s fields are typed `string`, so `String(x)` reads as unnecessary and ESLint
 * says so — and that is precisely the assumption a `Proxy` or an `any`-laundered value
 * breaks. The coercion exists for the values the type has already been talked out of
 * checking, so it is written once, here, with the reason attached rather than repeated as
 * a suppression at each site.
 */
function asText(value: unknown): string {
  /**
   * **Anything that is not a string becomes a fixed token, not its serialization.** The
   * first version returned `JSON.stringify(value)`, which hands a caller-supplied object to
   * the one function this module must never hand it to: it ran an attacker `toJSON`,
   * returned `undefined` for a function or a symbol — dropping `kind` and `message` out of
   * the published schema while typed `string` — and threw, uncontained, out of `failure`
   * on a `bigint` or a cycle. `redactDeep` already answers all three the right way; this
   * needed to answer none of them.
   */
  return typeof value === "string" ? value : "[unpublishable]";
}

export function success<T>(
  data: T,
  warnings: readonly string[] = [],
): CliResult<T> {
  /**
   * **Frozen, because registering a mutable object hands the gate a live handle.** The
   * failure arm was frozen and this one was not, so `Object.assign(result, { ok: false,
   * error })` — or simply assigning a `toJSON` — reshaped a *registered* result in place and
   * published whatever it liked. Identity was preserved because nothing was forged; the real
   * object was edited.
   */
  const result: CliResult<T> = Object.freeze({
    ok: true,
    code: EXIT_CODES.success,
    data,
    warnings: Object.freeze(boundedList(warnings).map((w) => asText(w))),
  });

  /**
   * **Registered too, so membership is the *only* question the seam asks.** It was asked as
   * `result.ok || published.has(result)`, which reads `ok` off the value being checked — so
   * a `Proxy` answering `ok: true` short-circuited the lookup and was handed to
   * `JSON.stringify` whole, `toJSON` and all. A gate that consults its subject before
   * deciding whether to trust it is not a gate.
   */
  published.add(result);
  return result;
}


/**
 * **The failure arm is rebuilt field by field and frozen, not stored by reference.**
 *
 * The brand closed every *shape* that writes `data` — but `failure` kept the caller's
 * object, and the seam serialized it whole, so the runtime surface stayed open and
 * a review walked through it six ways: a `toJSON` on the error object injecting `data` at
 * serialization time, a class `implements CliError` doing the same, `Object.defineProperty`
 * attaching the field afterwards, and mutation of the returned result. None of those is a
 * shape a parse can enumerate, which is why five rounds of sweeping for syntax kept losing.
 *
 * **Rebuilding here closes them only for callers who come here**, which is why the failure
 * arm carries `Constructed`. A hand-built `{ ok: false, code, error }` skipped this function
 * entirely, and the sweep that had covered that was retired in the same change on the
 * argument that the `data` brand made it a compile error — it does not, because a `toJSON`
 * names no field at the type level. The arm's brand is what makes coming here compulsory.
 *
 * Rebuilding makes "what reaches `--json`" a fact about this function rather than a promise
 * about how the caller's object was constructed. Only the five named fields survive, so an
 * extra member cannot ride along and a `toJSON` is not carried; `Object.freeze` closes the
 * after-the-fact write, because module code is strict and the assignment throws.
 *
 * **What this does not close**, measured by construction rather than assumed — and the last
 * three versions of this paragraph each named something that *is* closed. It said a caller
 * who defeats the type at runtime before calling, `Object.defineProperty(literal, "data", …)`
 * or `Object.assign(base, { data })`, could not be told from a redacted one. It can:
 * `failure` asks `isRedactedPayload` before it accepts the field, and that asks `payloads` — a registry only
 * `redactPayload` writes — so a `data` put there by any means publishes nothing at all. Both
 * acts were run against the built module and both drop the field.
 *
 * What is left is two things. **A redactor that does not redact**: the producer performs the
 * walk, so obtaining the brand means having redacted, but with what the caller supplied — an
 * identity function yields a genuine `RedactedPayload` containing the secret verbatim, and
 * nothing here can audit a function. And **a producer call outside the composition root**,
 * which is not closed by this module at all but by `failure-data-entry.test.ts`, and is the
 * load-bearing rule that gate exists for.
 *
 * Every route that reshapes the result *after* this returns is closed at the publishing seam
 * instead, by identity.
 */
export function failure(
  code: FailureExitCode,
  error: CliError,
): CliResult<never> {
  /**
   * **Every read of the caller's object is contained.** `kind`, `message`, `paths` (whose
   * spread invokes `Symbol.iterator`), `recovery` and `data` are each a getter or a trap a
   * hostile object controls, and all five were read with no `try`. This runs inside command
   * `catch` blocks, so a throw replaces the diagnostic with a rejected promise —
   * `developer-os failed: TypeError`, exit 1, and no `--json` line at all. That is the
   * failure `publish` was hardened against one function over.
   */
  let rebuilt: CliError;
  try {
    /**
     * **Read once, then check and publish the binding.** The payload was read three times —
     * for the `undefined` test, for the membership question, and again for the value stored —
     * and nothing tied them together. An accessor returned a genuine `redactPayload` output
     * for the first two and a raw secret for the third, through an arm that was properly
     * registered, so every mechanism in this file was bypassed by one re-read. Membership was
     * correct; it was just asked about a different value than the one published.
     */
    const payload: unknown = error.data;
    const kind = error.kind;
    const message = error.message;
    const recovery = error.recovery;
    const paths = boundedList(error.paths);

    rebuilt = {
      /**
       * **Coerced, not referenced.** Only `paths` was copied, so an object hung off `kind`
       * through a `Proxy` stayed live and its `toJSON` ran at serialization — after the
       * result was registered, which is exactly when nothing looks again. A `string` read
       * once cannot be changed afterwards.
       */
      kind: asText(kind),
      message: asText(message),
      /**
       * **Copied and frozen, not referenced.** `Object.freeze` is shallow, so freezing the
       * error left `paths` a live handle on the caller's array: a `push` after this returned
       * reached `--json`, and an `Array` subclass carrying `toJSON` replaced the whole field.
       * `vocabulary.test.ts` records this repository learning the same lesson before —
       * "Object.freeze is shallow. The entries were reassignable."
       */
      paths: Object.freeze(paths.map((path) => asText(path))),
      ...(recovery === undefined
        ? {}
        : { recovery: asText(recovery) }),
      /**
       * **A payload is accepted only if `redactPayload` produced it**, asked of `payloads`
       * rather than of the value. The previous test was `Object.isFrozen`, which
       * `Object.freeze({ token })` passes for free, which a `Proxy` over a frozen target
       * passes while its `get` trap answers with anything, and which is shallow where the
       * guarantee is deep — all three verified. Identity answers what no predicate can.
       */
      /**
       * The `undefined` test is **an equivalent for the published bytes, on a different
       * ground than an earlier version of this comment gave.** It claimed `redactPayload`
       * can never register `"undefined:undefined"`. It can: `redactPayload(redact, undefined)`
       * returns `undefined`, takes the non-object branch, and writes exactly that key — so
       * after one such call the membership question answers `true`. What makes the two
       * spellings equivalent is downstream instead: `JSON.stringify` omits a property whose
       * value is `undefined`, so the field is absent from the document either way.
       *
       * It is kept because "absent" and "not vouched for" are different questions that
       * happen to share an answer, and because the reason they share it is a property of the
       * serializer rather than of this module.
       */
      ...(payload === undefined || !isRedactedPayload(payload)
        ? {}
        : { data: payload as RedactedPayload }),
    };
  } catch {
    rebuilt = {
      kind: "internal",
      message: "a failure could not be described",
      paths: Object.freeze([]),
    };
  }

  const result = Object.freeze({
    ok: false,
    /**
     * **Validated, not stored.** Every other field is coerced *because* the declared type is
     * not the enforcement — and `code` was handed to `JSON.stringify` by reference, so a
     * `toJSON` on it published its output as the exit status and `failure(0, …)` produced an
     * `ok:false` document carrying the success code. The rebuild path got this a round
     * earlier; this is the path production actually takes.
     */
    code: observedCode({ code }),
    error: Object.freeze(rebuilt),
  }) as CliResult<never>;

  published.add(result);
  return result;
}

/**
 * **Every failure arm this function has ever returned**, so the seam that publishes can ask
 * whether the thing in its hand actually came from here.
 *
 * A `WeakSet` because the answer is about *identity*, and identity is the one thing the
 * operations that defeated every earlier design cannot forge: `Object.assign({}, result, …)`,
 * `{ ...result, error }`, `structuredClone(result)` and `new Proxy(result, …)` all produce a
 * value that is not this one. It holds no strong reference, so a result is collected exactly
 * as before.
 */
const published = new WeakSet<object>();

/**
 * **Every payload `redactPayload` produced**, for the same reason and by the same means.
 *
 * `failure` asked `Object.isFrozen(error.data)` instead, and that is a *predicate* where the
 * question is *provenance*: `Object.freeze({ token })` satisfies it for free, a `Proxy` over
 * a frozen target satisfies it while its `get` trap answers with anything, and it is shallow
 * where the guarantee it stood in for is deep. No predicate can distinguish "this went
 * through `redactPayload`" from "this is frozen" — that distinction is what identity is for,
 * and this module already had the mechanism.
 *
 * This is the second time a trusted predicate was added beside an identity check and then
 * falsified — `result.ok ||` short-circuiting membership, `Object.isFrozen` standing in for
 * redaction. The rule that survives is: ask membership, never ask the value.
 */
const payloads = new WeakSet<object>();

/**
 * **The same question for a payload that is not an object**, which a `WeakSet` cannot hold.
 *
 * The walk reduces a hostile value to a token — `"[unserializable]"`, `"[circular]"` —
 * redacts a top-level string to another string, and returns a number, a boolean or `null`
 * unchanged, so `redactPayload` can legitimately return any primitive. Dropping those would
 * throw away exactly the diagnostics the walk exists to produce; accepting any primitive
 * would let a `Proxy` answer `data` with a raw secret string. The values are recorded
 * instead. That retention is **not** bounded, and an earlier version of this sentence called
 * it small on the ground that "only what the walk itself can return ever reaches it" — true,
 * and no bound, because what the walk returns includes a string of any length its redactor
 * hands back. `redactPayload(id, { toJSON: () => "S".repeat(1e6) })` stores a megabyte in a
 * module-level `Set` that never evicts. Nothing leaks: the stored copy is the redacted one.
 * What is unbounded is the retention, harmless in a CLI that exits and worth stating because
 * `packages/core` is a library and `redactPayload` is on its public surface.
 *
 * **This is the one registry here keyed by value rather than by identity, and it is the
 * exception rather than a precedent.** The module's rule is "ask membership, never ask the
 * value" — which holds here only because for a primitive the value *is* the identity. It
 * never evicts, so minting one primitive payload blesses that exact primitive for any later
 * `error.data` in the process: correct for the value in question, harmless in a CLI that
 * exits, and not a pattern to extend to objects.
 */
const primitivePayloads = new Set<string>();

/**
 * **The publishing seam re-derives what it prints, rather than trusting what it was given.**
 *
 * Two designs went round this before the one below, and both failed the same way: enumerate
 * the syntax that writes `data` (falsified every round — the shapes are unbounded), then
 * brand the type so the shapes cannot compile (falsified again — a *phantom* brand rides
 * through `Object.assign`, object spread, `Proxy` and `structuredClone` while every runtime
 * property it stood for is discarded). Both enforce at *construction* while the value is
 * published somewhere else and can be reshaped freely in between.
 *
 * So the check is here, where the bytes are decided. A failure arm that `failure` returned
 * is printed as it stands. Anything else is rebuilt from the fields this type declares —
 * which drops a `toJSON` that would have injected members, and drops `data`, because a
 * payload on an arm this module never produced cannot be vouched for. Fail-closed and
 * silent rather than throwing: a serializer that throws turns a diagnostic into a crash, and
 * every caller of this is already on an error path.
 *
 * `{ ...result, error }` — re-wrapping a sub-command's failure — is an ordinary thing to
 * write and is what makes this necessary rather than adversarial.
  *
 * **The body and the status, decided once and together.**
 *
 * `formatJsonResult` returned only a string, and `emit` then read `result.code` off the same
 * object — so every mechanism in this file guarded the body while the status came from an
 * ungated second read. A `code` getter answering `5` and then `3` published one and exited
 * with the other. That is the round-after-round defect in this task's history — a value
 * checked at one read and consumed at another — relocated across a module boundary, and it
 * cannot be fixed inside a function that does not decide both.
 *
 * `formatJsonResult` delegates here for the bytes and has no production caller of its own;
 * `emit` calls this for both halves, so there is no second read to disagree with.
 */
export function publish<T>(result: CliResult<T>): {
  readonly text: string;
  readonly code: ExitCode;
} {
  /**
   * **One attempt decides both, including when the attempt fails.** A first version asked
   * `formatJsonResult` for the bytes and computed the status separately — so when
   * `JSON.stringify` threw inside it and it silently fell back to a failure document, the
   * status stayed `0`: the shell was told the command succeeded, the JSON said it failed,
   * and the command's own output was never printed. A second version handed `rebuild` a
   * validated code and then re-read the hostile object in its catch. Both are the defect
   * this function exists to remove, committed inside it.
   *
   * `ok` and `code` are read here, once, and every return below uses those bindings — which
   * `rebuild` relies on rather than re-deriving, because a second read of `ok` there was
   * exactly how the body and the status came to disagree again.
   */
  if (published.has(result)) {
    if (result.ok) {
      try {
        /**
         * Writing the constant rather than `result.code` is **a provable equivalent**, and
         * labelled because this file labels the rest: a registered success was frozen by
         * `success()` with `code: EXIT_CODES.success`, so the two cannot differ. The
         * constant is written because the *reason* the status is zero here is that this is
         * the success arm, not that the arm happens to carry a zero — and `publish` is the
         * one function in this module that must never take a status from a value.
         */
        return { text: JSON.stringify(result), code: EXIT_CODES.success };
      } catch {
        /**
         * A registered success whose own `data` cannot be serialized is an operational
         * failure of this command, and the status has to say so — the body already does.
         */
        return {
          text: unpublishable(EXIT_CODES.operationalFailure),
          code: EXIT_CODES.operationalFailure,
        };
      }
    }
    /**
     * Bound once, like every other read of a caller-reachable value here — though on this
     * branch alone it is provably equivalent to reading twice: a registered arm was frozen
     * by `failure` before it was registered, so `code` is a data property nothing can
     * change between the two reads. It is written this way because the *rule* is one read,
     * and a branch that is exempt today stops being exempt the moment the freeze moves.
     */
    const code = result.code;
    try {
      return { text: JSON.stringify(result), code };
    } catch {
      /**
       * **Reachable, and an earlier version of this comment called it unreachable.** Its
       * argument was that a `failure()`-built arm has `kind`, `message` and `recovery`
       * coerced, `paths` a frozen array of strings, and `data` a `redactPayload` output —
       * all true, and all about *types*. None of them bounds a *length*: `boundedList` caps
       * `paths` at `MAX_NODES` entries and the walk caps itself at `MAX_NODES` nodes, and
       * neither caps a string. `JSON.stringify` throws `RangeError: Invalid string length`
       * past V8's limit, which this file's own `MAX_NODES` docblock says out loud one screen
       * up. Measured: a single ~536 MB string on `data` lands here and publishes the
       * last-resort document at the arm's own code.
       *
       * **Reachable and deliberately unpinned**, which is stated because every other site in
       * this file that a test cannot reach says so. Constructing it needs a half-gigabyte
       * string per run; the sibling branch one arm up — the *success* arm's stringify catch —
       * is pinned, and this one is left to the measurement above.
       *
       * So the behaviour was always right and only the label was wrong — which is the fourth
       * such label found in this file, and the reason they matter is that a labelled site is
       * one later reviews skip.
       */
      return { text: unpublishable(code), code };
    }
  }

  /**
   * **An unregistered success is refused, because there is nothing here to re-derive it
   * from.** The failure arm below survives being unregistered: `rebuild` reads `kind`,
   * `message`, `recovery` and `paths` once each and coerces every one of them to a string,
   * so the bytes are this module's even when the arm is not. A success arm's payload is
   * `data`, generic and unconstrained — there is no coercion that makes an arbitrary `T`
   * safe, and serializing it as given runs any `toJSON` hanging off it and publishes
   * whatever the caller put there. An earlier version of this branch did exactly that:
   * `publish({ ok: true, code: 5, data: { secret } })` printed the secret and returned
   * status `0`, turning a failure into a success on the way.
   *
   * So the answer is the refusal document, whose bytes are a constant, with the status that
   * matches it. The bug this branch was added for is still fixed — `{ ...success(data) }`
   * used to publish `{"ok":true,"code":0}` while exiting `1`, and a body and a status that
   * disagree is the one outcome this seam exists to rule out. They agree now; they simply
   * agree on a refusal, which is the honest reading of an arm this module cannot vouch for.
   *
   * Nothing in this repository reaches here — `emit` is the only caller and commands pass
   * `success`/`failure` output — so this is provenance held to the same standard on both
   * arms rather than a live path.
   */
  let claimsSuccess = false;
  try {
    claimsSuccess = result.ok;
  } catch {
    claimsSuccess = false;
  }
  if (claimsSuccess) {
    return {
      text: unpublishable(EXIT_CODES.operationalFailure, UNREGISTERED_SUCCESS),
      code: EXIT_CODES.operationalFailure,
    };
  }

  const code = observedCode(result);
  /**
   * **Unreachable, and kept** — labelled because the file labels its other dead
   * branches and a reviewer read this one as live containment. `rebuild` wraps its whole
   * body in a `try` whose `catch` returns `unpublishable(code)`, which stringifies a number
   * and two string literals; it is total, so nothing reaches here. It stays because
   * "`rebuild` cannot throw" is a property of today's `rebuild` and not of the signature,
   * and the alternative on the day that changes is a rejected promise out of `emit`.
   */
  try {
    return { text: rebuild(result as { readonly error: CliError }, code), code };
  } catch {
    return { text: unpublishable(code), code };
  }
}

/**
 * The published bytes alone. **No production code calls this** — `emit` calls `publish`,
 * which is the seam — and it survives as exported API exercised by tests, which is worth
 * saying plainly rather than leaving a docblock claiming callers that do not exist. It
 * delegates, so there is one implementation of what gets published and it cannot drift from
 * the one that decides the exit code, which is how the body and the status came to disagree
 * twice.
 */
export function formatJsonResult<T>(result: CliResult<T>): string {
  return publish(result).text;
}

/**
 * The published bytes for a value this module did not construct, from a code already
 * decided. Its one caller passes the code it decided, so no read of `result.code` can differ from
 * the status the process exits with. (`formatJsonResult` delegates to `publish` and does not
 * call this — an earlier version of this sentence said "both callers".)
 */
function rebuild(result: { readonly error: CliError }, code: FailureExitCode): string {
  try {
    /**
     * **`ok` is not read here, and reading it was the defect.** `publish` decides which arm
     * this is, once, before calling — so a branch on `result.ok` was a *second* read of a
     * value already decided, and a getter answering `false` then `true` published
     * `{"ok":true,"code":0,…}` carrying an unvetted `data` verbatim while `publish` returned
     * the failure status it had computed. The branch was also unreachable by design, since
     * every success case is handled before this is called: it existed only to contradict the
     * invariant its own docblock states.
      *
     * **Bound once, exactly as `failure` binds.** `result.error` was read five times, so a
     * `get` trap could return a different object per field, and `recovery` was read twice —
     * the `undefined` test and the value — which is the shape removed from `failure` a round
     * earlier and left standing here, in the function whose docblock says it re-derives what
     * it prints.
     */
    const error = result.error;
    const recovery = error.recovery;
    return JSON.stringify({
      ok: false,
      code,
      error: {
        kind: asText(error.kind),
        message: asText(error.message),
        paths: boundedList(error.paths).map((path) => asText(path)),
        ...(recovery === undefined ? {} : { recovery: asText(recovery) }),
      },
    });
  } catch {
    /**
     * **The code the process will actually use**, read once inside the containment above's
     * sibling try so a hostile getter cannot both throw and pick the status. `emit` returns
     * `result.code` off this same object, and the body used to hardcode `1` — on the only
     * branch where the two could ever disagree.
     *
     * **This catch and `publish`'s around the call are mutually redundant**, which neither
     * said: both return `unpublishable(code)` for the same `code`, so deleting either alone
     * leaves the suite green and deleting both reddens it. Exactly one is load-bearing.
     * Keeping both is deliberate — `publish` is the seam and must publish *something*
     * whatever `rebuild` becomes, and `rebuild` is exported-adjacent enough that a future
     * caller should not have to know — but a reviewer counting revert-survivors should find
     * this stated rather than discover it.
     */
    return unpublishable(code);
  }
}

/**
 * **A failure code this module recognises, never the caller's number.**
 *
 * `unpublishable` took an `ExitCode`, which includes `0` — so a `success` arm that could not
 * be serialized published `{"ok":false,…,"code":0}` and `emit` returned `0`, telling a shell
 * the command succeeded while the body said the opposite and nothing was published. The
 * failure arm's own type excludes `0`; this makes the runtime agree with it.
 */
function observedCode(result: { readonly code?: unknown }): FailureExitCode {
  try {
    const code = result.code;
    /**
     * The `typeof` test is **an equivalent**, labelled for the same reason as the others in
     * this file: `Array.prototype.includes` compares with SameValueZero and coerces nothing,
     * so a non-number can never match a member of `FAILURE_CODES` and the guard cannot change
     * an outcome. It is kept because it states the intent that `includes` only implies.
     */
    return typeof code === "number" && FAILURE_CODES.includes(code as FailureExitCode)
      ? (code as FailureExitCode)
      : EXIT_CODES.operationalFailure;
  } catch {
    return EXIT_CODES.operationalFailure;
  }
}

/**
 * **Frozen, and no test can observe that it is** — module-private, so there is no handle to
 * write through and nothing to assert. It is stated here rather than pinned, which is the
 * honest version: `EXIT_CODES`'s freeze at the top of this file *is* observable, and is pinned.
 * A round-24 review caught this file's own change log claiming a revert-verification for
 * this constant that is not possible for it.
 */
const FAILURE_CODES: readonly FailureExitCode[] = Object.freeze(
  Object.values(EXIT_CODES).filter(
    (code): code is FailureExitCode => code !== EXIT_CODES.success,
  ),
);

/**
 * The last resort, carrying the exit code the process will actually use so the body and the
 * status cannot disagree — they did, because the catch-all hardcoded `1` while `emit`
 * returned `result.code` read off the hostile object.
 */
function unpublishable(
  code: FailureExitCode,
  message = "a result could not be published",
): string {
  return JSON.stringify({
    ok: false,
    code,
    error: {
      kind: "internal",
      message,
      paths: [],
    },
  });
}

/**
 * **Why the refusal of an unregistered success says something specific.** It shared the
 * catch-all's message, and two things went wrong at once. A caller who wrote
 * `{ ...success(data) }` — an ordinary idiom, and one this module's own prose calls
 * ordinary — lost their whole output to a message pointing at a serialization failure that
 * did not happen. And the branch became *undetectable*: deleting it entirely left the suite
 * green, because the fall-through through `rebuild` produces byte-identical output for that
 * input. A distinct message is the diagnosis and the test hook in one.
 */
const UNREGISTERED_SUCCESS =
  "a success result this module did not construct cannot be published";
