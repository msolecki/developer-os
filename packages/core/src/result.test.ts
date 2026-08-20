import { describe, expect, it } from "vitest";

/** `MAX_NODES` plus the node that trips it; the module keeps the constant private. */
const MAX_NODES_CEILING = 100_001;

import type { CliError, CliResult, RedactedPayload } from "./result.js";
import {
  EXIT_CODES,
  publish,
  failure,
  formatJsonResult,
  redactPayload,
  success,
} from "./result.js";

describe("CLI result contracts", () => {
  it("pins every public exit code", () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      operationalFailure: 1,
      invalidInput: 2,
      decisionRequired: 3,
      capabilityUnavailable: 4,
      securityRefusal: 5,
      recoveryRequired: 6,
    });
  });

  /**
   * **Frozen, which the equality above does not ask.** `FAILURE_CODES` snapshots these
   * values at module load, so a later write desynchronizes the validator from
   * `EXIT_CODES.success` — the one comparison deciding whether a published document may
   * carry a success status. The docblock on the constant claimed this; nothing asked it.
   */
  it("refuses a write to the exit-code table", () => {
    expect(() => {
      (EXIT_CODES as unknown as { success: number }).success = 9;
    }).toThrow(TypeError);
  });

  /**
   * Both cases in one, because they were two exact-byte assertions over the same document
   * and a 117-mutation battery could not tell them apart. Warning *order* is a property of
   * the bytes, so the byte assertion is where it belongs.
   */
  it.each([
    [[], '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}'],
    [
      ["first", "second"],
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":["first","second"]}',
    ],
  ])(
    "formats a successful result as deterministic JSON bytes, warnings in order",
    (warnings, bytes) => {
      expect(formatJsonResult(success({ version: "0.0.0" }, warnings))).toBe(bytes);
    },
  );

  it("formats a redacted security refusal without success-only fields", () => {
    const result = failure(EXIT_CODES.securityRefusal, {
      kind: "security_refusal",
      message: "Operation refused",
      paths: ["<redacted>"],
      recovery: "developer-os doctor",
    });

    expect(formatJsonResult(result)).toBe(
      '{"ok":false,"code":5,"error":{"kind":"security_refusal","message":"Operation refused","paths":["<redacted>"],"recovery":"developer-os doctor"}}',
    );
  });

  /**
   * **What moved before the run failed, as fields.** A command that processes a batch and
   * refuses one member is neither wholly successful nor wholly failed. `ingest` contains
   * each capture's refusal to that capture, and without this slot the per-capture outcomes
   * shipped as lines inside `message` — a consumer parsing prose (BACKLOG, Foundation
   * request 3).
   *
   * **It has to go through `redactPayload`, which redacts rather than asserting — and
   * that is the whole design.** The slot is
   * typed `RedactedPayload`, a brand no module outside `result.ts` can name, so a raw
   * object here is a compile error rather than something a repository sweep has to notice —
   * which is what five rounds of that sweep being falsified bought. Try deleting the call:
   * `tsc` refuses the literal.
   *
   * What this case itself earns its place for is the serialization: the brand is type-only,
   * so the field survives `formatJsonResult` and reaches `--json` with exactly the bytes it
   * was given, brand invisible.
   */
  it("carries structured detail on the failure arm", () => {
    const result = failure(EXIT_CODES.operationalFailure, {
      kind: "partial",
      message: "one capture refused",
      paths: [],
      data: redactPayload(
        (text) => text,
        { ingested: ["cap-a"], refused: ["cap-b"] },
      ),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const published: unknown = JSON.parse(formatJsonResult(result));
    expect(published).toMatchObject({
      error: { data: { ingested: ["cap-a"], refused: ["cap-b"] } },
    });
  });

  /**
   * **The walk lives here now, so it is tested here.** It moved from
   * `apps/cli/src/context.ts` when `redactPayload` had to redact rather than assert, and
   * for one round every behavioural guarantee was asserted only from `apps/cli` through
   * `failureFrom` — so a change that stopped `failureFrom` calling it would have left the
   * walk untested in the package that owns it, with the sweep still green.
   *
   * These are the guarantees, driven directly. `apps/cli/src/context.test.ts` keeps its own
   * cases, because what it pins is that the *composition root* wires the product's redactor
   * into this, which is a different claim.
   */
  it.each([
    ["a nested string leaf", { a: { b: "SECRET" } }, "<R>"],
    ["an object key", { SECRET: 1 }, "<R>"],
    ["an array element", { a: ["SECRET"] }, "<R>"],
    ["a value behind toJSON", { a: { toJSON: () => ({ b: "SECRET" }) } }, "<R>"],
    ["a class instance", { a: new (class { readonly b = "SECRET"; })() }, "<R>"],
    ["a bigint", { a: 1n }, "1n"],
    ["a symbol", { a: Symbol("x") }, "[unserializable]"],
    ["a throwing getter", { get a(): string { throw new Error("no"); } }, "[unserializable]"],
  ])("redacts %s", (_name, value, expected) => {
    const redacted = redactPayload((text) => text.replaceAll("SECRET", "<R>"), value);

    expect(JSON.stringify(redacted)).toContain(expected);
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
  });

  /** A cycle and an unbounded depth both terminate rather than overflowing the stack. */
  it("contains a cycle and bounds the depth", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    let deep: Record<string, unknown> = { end: "leaf" };
    for (let index = 0; index < 5_000; index += 1) deep = { n: deep };

    expect(JSON.stringify(redactPayload((t) => t, cycle))).toContain("[circular]");
    expect(JSON.stringify(redactPayload((t) => t, deep))).toContain("[truncated]");
  });

  /**
   * **A non-plain value truncates one level shallower, and the difference is charged
   * deliberately.** The hop through `normalize` is another frame of recursion, so the branch
   * increments — and that makes the ceiling 63 for a class instance where it is 64 for a
   * plain object. A comment once called the increment an equivalent; it is not, and this case
   * is the measurement. Removing the increment publishes the leaf at 63.
   */
  it("charges a level for the hop through normalize", () => {
    const wrap = (depth: number): unknown => {
      let deep: unknown = new (class {
        readonly a = "leaf";
      })();
      for (let index = 0; index < depth; index += 1) deep = { n: deep };
      return deep;
    };

    expect(JSON.stringify(redactPayload((t) => t, wrap(62)))).toContain("leaf");
    expect(JSON.stringify(redactPayload((t) => t, wrap(63)))).toContain("[truncated]");
    /** And a plain object at the same depth still reaches its leaf, which is the asymmetry. */
    let plain: unknown = { a: "leaf" };
    for (let index = 0; index < 63; index += 1) plain = { n: plain };
    expect(JSON.stringify(redactPayload((t) => t, plain))).toContain("leaf");
  });

  /**
   * **The array branch counts depth too**, and nothing asked it: the case above nests
   * objects only, so passing `depth` unincremented there survived the whole suite. The
   * consequence is the one this module's own docblock names — the redactor stops truncating
   * below `JSON.stringify`'s limit and becomes the binding depth limit itself, so a deep
   * array runs to a `RangeError` and reads `"[unserializable]"` instead of `"[truncated]"`.
   * Fail-closed, and still the guard being removed.
   *
   * The *published depth* is the assertion, not the marker: both versions contain a marker,
   * and only the bounded one stops at `MAX_DEPTH`.
   */
  it("bounds the depth of a nested array, not only a nested object", () => {
    let deep: unknown = ["leaf"];
    for (let index = 0; index < 5_000; index += 1) deep = [deep];

    const published = JSON.stringify(redactPayload((t) => t, { d: deep }));

    expect(published).toContain("[truncated]");
    expect(published).not.toContain("[unserializable]");
    /** One `[` per level, so the byte count is the depth the walk actually reached. */
    expect((published.match(/\[/gu) ?? []).length).toBeLessThanOrEqual(70);
  });

  /**
   * **What reaches `--json`, asserted as bytes — because the mechanism that decides it had
   * no test at all.**
   *
   * `failure` rebuilds the error arm from five named fields and freezes it, and a review
   * reverted that whole body to `return { ok: false, code, error }` and ran 882 tests
   * green. Five documents described the mechanism and nothing pinned it, so any refactor
   * would have deleted it silently. These assert the published string, not the
   * implementation, so they survive a rewrite of how it is achieved.
   */
  it("carries no member the caller attached beside the five named fields", () => {
    const secret = "sk-live-DEADBEEF";
    const smuggled = {
      kind: "x",
      message: "m",
      paths: [] as readonly string[],
      toJSON: () => ({ kind: "x", message: "m", paths: [], data: secret }),
    };

    const published = formatJsonResult(failure(EXIT_CODES.invalidInput, smuggled));

    expect(published).toBe(
      '{"ok":false,"code":2,"error":{"kind":"x","message":"m","paths":[]}}',
    );
  });

  it("refuses a write to the returned result, and to the error inside it", () => {
    const result = failure(EXIT_CODES.invalidInput, {
      kind: "x",
      message: "m",
      paths: ["a.md"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    /** Module code is strict, so a write to a frozen object throws rather than passing. */
    expect(() => {
      (result.error as unknown as Record<string, unknown>).data = "leak";
    }).toThrow(TypeError);
    expect(formatJsonResult(result)).not.toContain("leak");
  });

  /**
   * **`paths` is copied, not referenced**, because `Object.freeze` is shallow: the array was
   * a live handle on the caller's, and a `push` after this returned reached `--json`.
   */
  it("does not share the caller's paths array", () => {
    const paths = ["a.md"];
    const result = failure(EXIT_CODES.invalidInput, {
      kind: "x",
      message: "m",
      paths,
    });
    paths.push("sk-live-DEADBEEF");

    expect(formatJsonResult(result)).toBe(
      '{"ok":false,"code":2,"error":{"kind":"x","message":"m","paths":["a.md"]}}',
    );
  });

  /**
   * **The success arm's copy, which the `paths` case above does not cover.** `warnings` was
   * handed straight into the frozen arm, so the caller kept a live handle on it: the freeze
   * is shallow and a `push` afterwards reached `--json`. Round 24 deleted the copy and the
   * whole 122-file suite stayed green, because every case near it pinned `failure`'s side.
   */
  it("does not share the caller's warnings array", () => {
    const warnings = ["one"];
    const result = success({ ok: 1 }, warnings);
    warnings.push("sk-live-DEADBEEF");

    expect(publish(result).text).toBe(
      '{"ok":true,"code":0,"data":{"ok":1},"warnings":["one"]}',
    );
  });

  /**
   * **The failure arm's outer freeze.** `success`'s identical freeze is pinned two cases
   * down; this one was not, and every case near it writes to `result.error` rather than to
   * `result`. Attaching `toJSON` to a *registered* arm is the reachable consequence: the
   * seam finds it in `published`, hands it to `JSON.stringify`, and the caller's function
   * decides the bytes.
   */
  it("refuses a toJSON attached to a registered failure arm", () => {
    const result = failure(EXIT_CODES.invalidInput, {
      kind: "x",
      message: "m",
      paths: [],
    });

    expect(() => {
      Object.assign(result, {
        toJSON: () => ({ error: { data: { token: "sk-live-DEADBEEF" } } }),
      });
    }).toThrow(TypeError);
    expect(publish(result).text).not.toContain("sk-live-DEADBEEF");
  });

  /** And a redacted payload cannot be widened after it has been redacted. */
  it("refuses a write to a payload that was already redacted", () => {
    const payload = redactPayload((text) => text, { note: "clean" });

    expect(() => {
      Object.assign(payload, { secret: "sk-live-DEADBEEF" });
    }).toThrow(TypeError);
  });

  /**
   * **And every level of it, which shallow freezing does not give.** The case above is
   * satisfied by a bare `Object.freeze`, so `deepFreeze`'s recursion could be deleted and
   * the full 122-file suite stayed green while this published a raw secret: identity is
   * what `failure` checks, and identity survives mutating the payload's interior.
   *
   * This is "publish an unredacted value" reached the long way round — through a value the
   * producer really did redact, at a level the freeze never reached.
   */
  it("refuses a write to a nested level of a redacted payload", () => {
    const payload = redactPayload((text) => text, {
      report: { note: "clean" },
      rows: ["clean"],
    });

    expect(() => {
      Object.assign((payload as unknown as { report: object }).report, {
        secret: "sk-live-DEADBEEF",
      });
    }).toThrow(TypeError);
    /**
     * **A nested *array*, because that is the shape this slot actually publishes.** The
     * object half alone kills only a `deepFreeze` with no recursion at all; skipping arrays
     * specifically survived the whole 122-file suite while `RunReportV1`'s `order`,
     * `ingested`, `refused`, `unreadable` and the `appliedNotes` nested under each refusal —
     * every array `ingest` puts on `data` — stayed writable
     * on a genuinely minted payload. Nothing is forged in that leak: every identity check
     * answers correctly.
     */
    expect(() => {
      (payload as unknown as { rows: string[] }).rows.push("sk-live-ARRAY");
    }).toThrow(TypeError);

    const result = failure(EXIT_CODES.securityRefusal, {
      kind: "x",
      message: "m",
      paths: [],
      data: payload,
    });
    expect(publish(result).text).not.toContain("sk-live-DEADBEEF");
  });

  /**
   * **The four operations that carry a phantom brand while discarding what it stood for.**
   *
   * Each produces a value that typechecks as `CliResult`, holds `Constructed`, and never
   * came from `failure` — so the rebuild, the `paths` copy and both freezes were all
   * skipped. Three of them need no cast and no runtime bypass; `{ ...result, error }` is
   * what re-wrapping a sub-command's failure looks like.
   *
   * Asserted as printed bytes, so they survive a change in how the seam decides.
   */
  it.each([
    [
      "Object.assign onto a real result",
      (real: CliResult<never>, hostile: CliError): CliResult<never> =>
        Object.assign({}, real, { error: hostile }),
    ],
    [
      "an object spread of a narrowed result",
      (real: CliResult<never>, hostile: CliError): CliResult<never> =>
        real.ok ? real : { ...real, error: hostile },
    ],
    [
      "a Proxy wrapping a real result",
      (real: CliResult<never>): CliResult<never> =>
        new Proxy(real, {
          get(target, key, receiver): unknown {
            return key === "toJSON"
              ? (): unknown => ({ error: { data: { token: "sk-live-DEADBEEF" } } })
              : Reflect.get(target, key, receiver);
          },
        }),
    ],
    [
      "a structuredClone that drops the freeze",
      (real: CliResult<never>): CliResult<never> => {
        const cloned = structuredClone(real);
        if (!cloned.ok) {
          Object.assign(cloned.error, { data: { token: "sk-live-DEADBEEF" } });
        }
        return cloned;
      },
    ],
  ])("publishes nothing extra through %s", (_name, reshape) => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    const hostile: CliError = {
      kind: "x",
      message: "m",
      paths: [],
      toJSON: (): unknown => ({ data: { token: "sk-live-DEADBEEF" } }),
    } as CliError;

    const published = formatJsonResult(reshape(real, hostile));

    expect(published).not.toContain("sk-live-DEADBEEF");
    expect(published).not.toContain("data");
  });

  /**
   * **A value that lies about which arm it is.** The membership check read `ok` off the
   * object it was checking, so a `Proxy` answering `true` short-circuited the lookup and
   * was serialized whole. Nothing unregistered reaches `JSON.stringify` now, whatever it
   * claims to be.
   */
  it("publishes nothing extra through a result that claims to be a success", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    const liar: CliResult<never> = new Proxy(
      { ...real },
      {
        get: (target, key): unknown => {
          if (key === "ok") return true;
          if (key === "toJSON") {
            return (): unknown => ({
              ok: false,
              code: 5,
              error: { kind: "k", message: "m", paths: [], data: { token: "sk-live" } },
            });
          }
          return Reflect.get(target, key);
        },
      },
    );

    expect(formatJsonResult(liar)).not.toContain("sk-live");
  });

  /**
   * **Provenance, not a predicate.** `failure` asked `Object.isFrozen(error.data)`, and both
   * of these defeat that: `Object.freeze` satisfies it for free, a `Proxy` over a
   * frozen target satisfies it while its `get` trap answers with anything, and it is shallow
   * where the guarantee it stood in for is deep. Membership answers what no predicate can.
   */
  it.each([
    ["a plainly frozen object nobody redacted", (): unknown => Object.freeze({ token: "sk-live" })],
    [
      "a Proxy that isFrozen answers true for",
      (): unknown =>
        new Proxy(Object.freeze({ harmless: 1 }), {
          get: (target, key): unknown =>
            key === "toJSON" ? (): unknown => ({ token: "sk-live" }) : Reflect.get(target, key),
        }),
    ],
  ])("refuses %s", (_name, makePayload) => {
    const hostile: CliError = new Proxy(
      { kind: "k", message: "m", paths: [] },
      {
        get: (target, key): unknown =>
          key === "data" ? makePayload() : Reflect.get(target, key),
      },
    );

    expect(formatJsonResult(failure(EXIT_CODES.invalidInput, hostile))).not.toContain(
      "sk-live",
    );
  });

  /**
   * **A registered success arm is frozen too**, and it was not: `Object.assign(result, …)`
   * or simply attaching a `toJSON` reshaped a *registered* result in place. Nothing was
   * forged — the real object was edited, so identity held and the gate waved it through.
   */
  it.each([
    [
      "an assignment over its fields",
      (result: CliResult<{ version: string }>): void => {
        Object.assign(result, {
          ok: false,
          error: { toJSON: (): unknown => ({ data: { token: "sk-live" } }) },
        });
      },
    ],
    [
      "a toJSON attached afterwards",
      (result: CliResult<{ version: string }>): void => {
        (result as unknown as Record<string, unknown>).toJSON = (): unknown => ({
          error: { data: { token: "sk-live" } },
        });
      },
    ],
  ])("refuses to publish %s of a registered success", (_name, reshape) => {
    const result = success({ version: "0.0.0" });

    try {
      reshape(result);
    } catch {
      /* frozen, which is the point */
    }

    expect(formatJsonResult(result)).toBe(
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}',
    );
  });

  /**
   * **The registered path is contained too**, and the containment added a round earlier
   * guarded only the rebuild branch — which no production code reaches, since every result
   * comes from `success` or `failure`. A `bigint` or a throwing getter in a *success*
   * payload threw straight out of `emit`, past every command's `catch`, printing no `--json`
   * line at all.
   */
  it.each([
    ["a bigint", { n: 1n }],
    ["a throwing getter", { get boom(): string { throw new Error("kaboom"); } }],
    ["a throwing toJSON", { toJSON: (): never => { throw new Error("kaboom"); } }],
  ])("publishes a diagnostic rather than throwing on %s", (_name, payload) => {
    const result = success(payload);

    expect(() => formatJsonResult(result)).not.toThrow();
    expect(formatJsonResult(result)).toContain("could not be published");
  });

  /**
   * **`asText` must not hand an object to `JSON.stringify`** — the one thing this module
   * forbids. Its first version did, so an attacker `toJSON` ran, a function or symbol
   * returned `undefined` and dropped the field out of the published schema while typed
   * `string`, and a `bigint` or a cycle threw uncontained out of `failure`.
   */
  /**
   * **Every coerced field, on both paths, not `kind` on one of them.** Only `kind` through
   * `failure` was covered, and the three siblings each survived deletion: a `toJSON` on
   * `message` decides the bytes of a **registered** arm — past the brand, past the rebuild,
   * past both membership checks — because `publish` hands a registered arm straight to
   * `JSON.stringify`. `rebuild`'s copies of `kind` and `recovery` are reached by
   * `{ ...result, error }`, the idiom `publish`'s own docblock calls an ordinary thing to
   * write.
   */
  it.each([
    ["an object carrying toJSON", { toJSON: (): unknown => ({ leaked: "sk-live" }) }],
    ["a bigint", 10n],
    ["a function", (): number => 1],
  ])("publishes a token rather than serializing %s in a coerced field", (_name, hostile) => {
    const value = hostile as unknown as string;
    const registered = [
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, { kind: value, message: "m", paths: [] }),
      ),
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, { kind: "k", message: value, paths: [] }),
      ),
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, {
          kind: "k",
          message: "m",
          paths: [],
          recovery: value,
        }),
      ),
    ];
    /** The same three fields through `rebuild`, which re-derives them independently. */
    const rebuilt = (["kind", "message", "recovery"] as const).map(
      (field) =>
        publish({
          ok: false,
          code: EXIT_CODES.invalidInput,
          error: { kind: "k", message: "m", paths: [], [field]: value },
        } as unknown as CliResult<never>).text,
    );

    for (const published of [...registered, ...rebuilt]) {
      expect(published).not.toContain("sk-live");
      expect(published).toContain('"[unpublishable]"');
    }
  });

  it("refuses a payload that was never frozen by the producer", () => {
    const hostile: CliError = new Proxy(
      { kind: "k", message: "m", paths: [] },
      {
        get: (target, key): unknown =>
          key === "data" ? { token: "sk-live" } : Reflect.get(target, key),
      },
    );

    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, hostile),
    );

    expect(published).not.toContain("sk-live");
    expect(published).not.toContain("data");
  });

  /**
   * **A getter that throws must not take the `--json` line with it.** This runs inside
   * `emit`, past every command's own `catch`, so a throw here prints nothing at all and
   * exits with Node's code instead of the command's.
   */
  it("publishes a diagnostic rather than throwing when a field cannot be read", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    class Hostile implements CliError {
      readonly kind = "k";
      readonly paths: readonly string[] = [];
      get message(): string {
        throw new Error("boom");
      }
    }
    const reshaped: CliResult<never> = { ...real, error: new Hostile() };

    expect(() => formatJsonResult(reshaped)).not.toThrow();
    expect(formatJsonResult(reshaped)).toContain("could not be published");
  });

  /**
   * **Read once, then check and publish the binding.** `data` was read three times — the
   * `undefined` test, the membership question, and the value stored — with nothing tying
   * them together, so an accessor answering honestly twice and hostilely on the third read
   * published a raw secret through a properly registered arm.
   */
  it("reads the payload exactly once, and publishes what it checked", () => {
    const clean = redactPayload((text) => text, { note: "clean" });
    let reads = 0;
    const hostile: CliError = {
      kind: "k",
      message: "m",
      paths: [],
      get data(): RedactedPayload {
        reads += 1;
        return reads <= 1 ? clean : ({ token: "sk-live" } as unknown as RedactedPayload);
      },
    };

    const published = formatJsonResult(failure(EXIT_CODES.invalidInput, hostile));

    expect(published).not.toContain("sk-live");
    /**
     * **The count is the assertion, not the leak.** `data` was read three times — the
     * `undefined` test, the membership question, and the value stored — and a getter
     * answering honestly for the first two published a raw secret on the third. Asserting
     * "no leak" instead makes the case depend on how many reads the *current* shape happens
     * to make: a threshold tuned for a three-read revert goes green on a two-read one and
     * vice versa, which is how this stayed vacuous through two mutation tests. One read is
     * the property; anything more is the defect, whatever it returns.
     */
    expect(reads).toBe(1);
  });

  /**
   * **An iterable that never reports `done`, which a spread cannot survive.** `paths` was
   * copied with `[...error.paths]`, so this ran the caller's iterator to completion: the
   * array grew until V8 aborted with `FATAL ERROR: invalid array length`, in 1.5 seconds,
   * out of a `catch` block whose docblock claimed every read of the caller's object was
   * contained. It was contained against a *throw*; an out-of-memory abort is not one, and
   * no `try` in this file could have caught it.
   *
   * The array branch of `walk` was fixed for exactly this one screen up, where its docblock
   * calls a runaway breadth "what no `catch` can contain". The three spreads were left
   * behind by that fix. Reverting this one kills the whole test run rather than reddening a
   * case, which is as red as a defect gets.
   */
  it.each([
    ["failure", (paths: readonly string[]): string =>
      formatJsonResult(failure(EXIT_CODES.invalidInput, { kind: "k", message: "m", paths })),
    ],
    ["publish, through an unregistered arm", (paths: readonly string[]): string =>
      publish({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "k", message: "m", paths },
      } as unknown as CliResult<never>).text,
    ],
  ])("bounds an endless paths iterable in %s", (_name, run) => {
    const endless = {
      [Symbol.iterator]: () => ({ next: () => ({ value: "a.md", done: false }) }),
    } as unknown as readonly string[];

    const published = JSON.parse(run(endless)) as {
      error: { paths: readonly string[] };
    };

    expect(published.error.paths.length).toBe(MAX_NODES_CEILING);
    expect(published.error.paths.at(-1)).toBe("[truncated]");
  });

  /**
   * **The iterator's `return()` is never called, and that is a security property.** The
   * bound was first written as `for…of` with a `break` — and every early exit from `for…of`
   * performs IteratorClose, which runs the caller's `return()`. A `return()` that never
   * returns is an uncatchable hang in the same field, by the same actor, as the abort the
   * bound was added for; a spread never called it at all, so that spelling was strictly
   * worse than the defect it replaced.
   *
   * The spinning trap here is the assertion: reaching it hangs the run rather than
   * reddening a case, and `invoked` proves it was not reached even in principle.
   */
  it("abandons a hostile paths iterator rather than closing it", () => {
    let invoked = 0;
    const hostile = {
      [Symbol.iterator]: () => ({
        next: () => ({ value: "a.md", done: false }),
        return: () => {
          invoked += 1;
          for (;;) {
            /* a `return()` the module must never call */
          }
        },
      }),
    } as unknown as readonly string[];

    const published = JSON.parse(
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, { kind: "k", message: "m", paths: hostile }),
      ),
    ) as { error: { paths: readonly string[] } };

    expect(invoked).toBe(0);
    expect(published.error.paths.length).toBe(MAX_NODES_CEILING);
  });

  /**
   * **The truncation marker means something was dropped, at the exact boundary.** The loop
   * was `while (copied.length < MAX_NODES)` with an unconditional push after it, so a list of
   * exactly `MAX_NODES` complete entries published `MAX_NODES + 1` and claimed truncation —
   * telling a reader the opposite of the truth in the function whose docblock promises they
   * will not "believe it saw everything". Both sides of the boundary are asserted because
   * either alone passes for a version off by one in the other direction.
   */
  it.each([
    [MAX_NODES_CEILING - 1, MAX_NODES_CEILING - 1, false],
    [MAX_NODES_CEILING, MAX_NODES_CEILING, true],
  ])("copies %i paths as %i entries, truncated: %s", (given, expected, marked) => {
    const paths = Array.from({ length: given }, (_unused, index) => `p${String(index)}`);

    const published = JSON.parse(
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, { kind: "k", message: "m", paths }),
      ),
    ) as { error: { paths: readonly string[] } };

    expect(published.error.paths).toHaveLength(expected);
    expect(published.error.paths.at(-1) === "[truncated]").toBe(marked);
  });

  /**
   * **A truthy `done` finishes the list, because `IteratorComplete` is `ToBoolean(done)`.**
   * A strict `=== true` test called a conforming iterator unfinished and copied it to the
   * cap, publishing 100 001 entries and a truncation marker for a list of two.
   */
  it("finishes on a truthy done, as the iteration protocol defines it", () => {
    let index = 0;
    const conforming = {
      [Symbol.iterator]: () => ({
        next: () => {
          index += 1;
          return index <= 2
            ? { value: `p${String(index)}`, done: 0 }
            : { value: undefined, done: 1 };
        },
      }),
    } as unknown as readonly string[];

    const published = JSON.parse(
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, { kind: "k", message: "m", paths: conforming }),
      ),
    ) as { error: { paths: readonly string[] } };

    expect(published.error.paths).toStrictEqual(["p1", "p2"]);
  });

  /** The same bound on the success arm's list, which is copied the same way. */
  it("bounds an endless warnings iterable in success", () => {
    const endless = {
      [Symbol.iterator]: () => ({ next: () => ({ value: "w", done: false }) }),
    } as unknown as readonly string[];

    const result = success({ ok: 1 }, endless);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBe(MAX_NODES_CEILING);
    expect(result.warnings.at(-1)).toBe("[truncated]");
  });

  /**
   * **A value the serializer refuses becomes a marker, not a throw.** `normalize` runs for
   * anything `isWalkable` rejects, and it stands under a command's `catch` — so a
   * `JSON.stringify` that throws here would replace a diagnostic with a stack trace.
   *
   * Only this half of `normalize`'s two markers is observable. Its `BudgetExceeded` arm
   * returns `"[truncated]"`, but `walk` hands the result straight back to `redactDeep`,
   * whose first line is the same budget check — so an over-budget value reads
   * `"[truncated]"` whichever marker `normalize` chose. That arm is an equivalent mutant by
   * construction, recorded on `normalize` itself rather than papered over with a case that
   * would pass either way. What *is* pinned is the budget, by
   * "bounds a graph reached through toJSON" below.
   */
  it("marks a value the serializer refuses rather than throwing", () => {
    expect(redactPayload((text) => text, { toJSON: (): unknown => 1n })).toBe(
      "[unserializable]",
    );
  });

  /**
   * **A function-valued `data`, which `primitiveKey` must never coerce.** `isRedactedPayload`
   * falls through to a value key for anything that is not an object, and `String(value)` on
   * a function runs an own `toString` — one returning an object throws `TypeError`, out of
   * `failure`, out of a command's `catch`, with no `--json` line printed. The guard is what
   * stops the coercion; a symbol is refused beside it for the same reason.
   */
  it.each([
    [
      "a function whose toString returns an object",
      Object.assign(() => undefined, { toString: (): unknown => ({}) }),
    ],
    ["a symbol", Symbol("s")],
  ])("refuses %s as data without throwing", (_name, data) => {
    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, {
        kind: "k",
        message: "m",
        paths: [],
        data: data as unknown as RedactedPayload,
      }),
    );

    /**
     * **The caller's own diagnostic, not the synthetic one.** `failure` contains a throw by
     * substituting `{kind:"internal", message:"a failure could not be described"}` — which
     * is also `ok:false`, so asserting the arm alone passes with the guard deleted while the
     * command's real diagnostic has been destroyed. The `kind` and `message` are what say
     * the coercion never happened.
     */
    expect(JSON.parse(published)).toMatchObject({
      ok: false,
      error: { kind: "k", message: "m" },
    });
    expect(published).not.toContain('"data"');
  });

  /**
   * **`failure` reads `recovery` once.** The file asserts this in two places and had a test
   * for `rebuild`'s copy of the same property and for `data`, but not for this one — so an
   * accessor answering honestly for the `undefined` test and a secret for the value read
   * published the secret, which is the "checked at one read, consumed at another" shape most
   * of this task's history is made of.
   */
  it("reads the caller's recovery once", () => {
    let reads = 0;
    const hostile: CliError = {
      kind: "k",
      message: "m",
      paths: [],
      get recovery(): string {
        reads += 1;
        return reads <= 1 ? "run doctor" : "sk-live-DEADBEEF";
      },
    };

    const published = formatJsonResult(failure(EXIT_CODES.invalidInput, hostile));

    expect(published).not.toContain("sk-live-DEADBEEF");
    expect(reads).toBe(1);
  });

  /**
   * **`success` coerces its warnings, as `failure` coerces its paths.** The copy stops a
   * later `push`; the coercion stops an *entry* from deciding the bytes. Without it a
   * `toJSON` on a warning runs inside `JSON.stringify(result)` on the **registered** arm —
   * past every membership check, because the arm really is one this module built.
   */
  it("coerces a warning that would otherwise decide its own bytes", () => {
    const hostile = [
      { toJSON: (): unknown => ({ leaked: "sk-live-DEADBEEF" }) },
    ] as unknown as readonly string[];

    const { text } = publish(success({ a: 1 }, hostile));

    expect(text).not.toContain("sk-live-DEADBEEF");
    expect(text).toContain('"warnings":["[unpublishable]"]');
  });

  /**
   * **The budget's early return, which every other budget case leans on.** It is what makes
   * `normalize`'s two markers indistinguishable — the equivalence recorded on `normalize` is
   * an equivalence *resting on this line*, so deleting it changes observable output while
   * every case written for the budget stayed green.
   */
  it("truncates a value reached after the budget is spent", () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 120_000; index += 1) {
      wide[`k${String(index)}`] = index < 50_000 ? index : { z: index };
    }

    const payload = redactPayload((text) => text, wide) as unknown as Record<
      string,
      unknown
    >;

    const keys = Object.keys(payload).filter((key) => key.startsWith("k"));
    const last = payload[keys[keys.length - 1] ?? ""];

    expect(payload["k119999"]).toBeUndefined();
    /**
     * The budget is spent *inside* the last object entry, so the entry survives and its
     * leaf is the marker. That leaf is the only thing this line produces.
     */
    expect(last).toStrictEqual({ z: "[truncated]" });
  });

  /**
   * **`isWalkable` is asked before `Array.isArray`, which is the ordering its docblock now
   * rests on.** An array carrying its own `toJSON` must be normalized rather than walked:
   * walked, the `toJSON` survives into the output and `JSON.stringify` calls it at publish
   * time, which is the attack `isWalkable` exists to stop.
   */
  it("normalizes an array that carries its own toJSON", () => {
    const rendered = Object.assign([1, 2], {
      toJSON: (): unknown => "RENDERED",
    });

    expect(redactPayload((text) => text, { a: rendered })).toStrictEqual({
      a: "RENDERED",
    });
  });

  /**
   * **A refused `length` is marked, not silently emptied.** `Array.isArray` is true for a
   * `Proxy` over an array, so a `length` trap returning `Infinity` published `[]` — every
   * entry gone, with neither of the markers this module emits for a value it could not take.
   */
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    /**
     * **The two the guard was actually written for**, and they were covered by nothing: the
     * first version tested `Infinity` and `NaN` only, which `Number.isSafeInteger` refuses
     * on its own — so dropping the sign test was a one-token revert that passed `tsc`,
     * `eslint` and the whole suite while re-creating the live defect it had just fixed.
     */
    ["a negative", -1],
    ["a fraction", 2.7],
  ])("marks an array whose length reads %s", (_name, declared) => {
    const hostile = new Proxy([1, 2, 3], {
      get: (target, key, receiver): unknown =>
        key === "length" ? declared : Reflect.get(target, key, receiver),
    });

    expect(redactPayload((text) => text, { rows: hostile })).toStrictEqual({
      rows: ["[unserializable]"],
    });
  });

  /**
   * **`deepFreeze`'s containment is live, under a redactor that does not honour its type.**
   * `redactDeep`'s string branch returns `redact(value)` verbatim, so a redactor returning an
   * object splices it into the walk's output — and `deepFreeze` reads that with
   * `Object.values`, which invokes getters, outside `redactDeep`'s own `try`. The guard was
   * labelled "cannot fire today" on the premise that the walk only sees objects it built.
   */
  it("contains a getter a redactor injected into the walk's output", () => {
    let reads = 0;
    const hostile = (): string =>
      ({
        get boom(): never {
          reads += 1;
          throw new TypeError("no");
        },
      }) as unknown as string;

    expect(() => redactPayload(hostile, { s: "x" })).not.toThrow();
    /** The count is the assertion: the getter really was reached, and contained. */
    expect(reads).toBe(1);
  });

  /**
   * **A non-callable `toJSON` is a key, not a renderer.** `isWalkable` asks whether `toJSON`
   * is *callable*, and every existing case here used a callable one — so reverting the
   * conjunct left the whole repository green while `{ toJSON: 42, s: "leaf" }` published
   * `"[truncated]"` and lost its subtree. `normalize` round-trips through
   * `JSON.stringify`/`parse`, and a non-callable `toJSON` survives that trip, so the parsed
   * copy re-normalizes once per level until `MAX_DEPTH` truncates it.
   */
  it("walks an object whose toJSON is a value rather than a function", () => {
    expect(redactPayload((text) => text, { toJSON: 42, s: "leaf" })).toStrictEqual({
      toJSON: 42,
      s: "leaf",
    });
  });

  /**
   * **`isWalkable`'s prototype test, which nothing asked.** A boxed primitive is the case
   * that separates walking from normalizing: walked, `new String(secret)` enumerates as one
   * string leaf *per character*, so the redactor is handed `"s"`, `"k"`, `"-"` … and no
   * pattern can match anything. The secret ships in full and reassembles trivially, under a
   * docblock promising "every string leaf".
   *
   * The existing cases — a class instance, an `Error` subclass, a `toJSON` carrier, a
   * `Date` — cannot reach it: the first two yield the same leaves either way, and the last
   * two are answered by the `toJSON` branch one line above.
   */
  it("normalizes a boxed primitive rather than walking its characters", () => {
    const published = JSON.stringify(
      redactPayload((text) => (text.includes("sk-live") ? "[R]" : text), {
          s: new String("sk-live-BOXED"),
      }),
    );

    expect(published).not.toContain("sk-live");
    expect(published).not.toContain('"0":"s"');
    expect(published).toBe('{"s":"[R]"}');
  });

  /**
   * **The inner freezes, which the copy cases beside them do not reach.** Copying stops a
   * `push` on the *caller's* array; freezing stops a `push` on the one this module built and
   * registered. Round 24 deleted the `warnings` copy with 122 files green, which is the
   * precedent for why the freeze beside it needs a case of its own.
   */
  it("refuses a push into a published paths array", () => {
    const result = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: ["a.md"],
    });
    if (result.ok) return;

    expect(() => {
      (result.error.paths as string[]).push("sk-live-PUSHED");
    }).toThrow(TypeError);
    expect(publish(result).text).not.toContain("sk-live-PUSHED");
  });

  it("refuses a push into a published warnings array", () => {
    const result = success({ a: 1 }, ["one"]);
    if (!result.ok) return;

    expect(() => {
      (result.warnings as string[]).push("sk-live-WARN");
    }).toThrow(TypeError);
    expect(publish(result).text).not.toContain("sk-live-WARN");
  });

  /**
   * **`normalize`'s budget *throw*, which the marker cannot pin.** The case below asserting
   * `payload.hostile === "[truncated]"` kills only the counting: `walk` hands `normalize`'s
   * return to `redactDeep`, whose first line is the same budget check, so the marker appears
   * whether or not the throw exists. Removing the throw restores the aliased-graph blow-up
   * the constant exists to prevent — measured at 27 levels, ~3 500× the work for identical
   * output, doubling per level until the process aborts.
   *
   * The replacer count is what the throw actually changes, so the count is the assertion.
   */
  it("stops serializing a graph reached through toJSON at the budget", () => {
    let reads = 0;
    /**
     * The leaf counts its own visits. The graph is 24 aliased levels — 25 plain objects, no
     * `Proxy` and no cycle — so `JSON.stringify` reaches this leaf 2^24 times unbounded and
     * at most `MAX_NODES` times with the throw in place. That count is the only thing the
     * throw changes; the published marker is identical either way.
     */
    let graph: unknown = {
      get v(): string {
        reads += 1;
        return "x";
      },
    };
    for (let index = 0; index < 24; index += 1) graph = { a: graph, b: graph };

    const payload = redactPayload((text) => text, {
      hostile: { toJSON: (): unknown => graph },
    }) as { readonly hostile?: unknown };

    expect(payload.hostile).toBe("[truncated]");
    expect(reads).toBeLessThanOrEqual(MAX_NODES_CEILING);
  });

  /**
   * **The last-resort document carries `paths`.** `CliError` declares it required and every
   * other published failure has it, so a consumer reading `error.paths.length` gets a
   * `TypeError` on the one document this module emits when everything else has failed.
   */
  it("carries paths on the last-resort document", () => {
    const hostile = {
      ok: false,
      get code(): number {
        throw new TypeError("no");
      },
    } as unknown as CliResult<never>;

    expect(JSON.parse(publish(hostile).text)).toStrictEqual({
      ok: false,
      code: EXIT_CODES.operationalFailure,
      error: {
        kind: "internal",
        message: "a result could not be published",
        paths: [],
      },
    });
  });

  /**
   * **`failure`'s synthetic document, byte for byte.** Its three fields could each be
   * changed freely with the suite green — the two cases reaching this path asserted only
   * `not.toThrow()`. `unpublishable`'s sibling document *is* pinned exactly; this one was
   * not, and it is the document a user sees when their command's own diagnostic could not
   * be read at all.
   */
  it("publishes an exact document when the failure cannot be described", () => {
    const unreadable = {
      get kind(): string {
        throw new TypeError("no");
      },
      message: "m",
      paths: [],
    } as unknown as CliError;

    const result = failure(EXIT_CODES.invalidInput, unreadable);

    expect(JSON.parse(formatJsonResult(result))).toStrictEqual({
      ok: false,
      code: EXIT_CODES.invalidInput,
      error: {
        kind: "internal",
        message: "a failure could not be described",
        paths: [],
      },
    });
    /**
     * **And the array is frozen, which the byte assertion above cannot see.** The outer
     * `Object.freeze` is shallow, so a bare `[]` here leaves a live handle on a registered
     * arm: `result.error.paths.push(secret)` reached `--json`, with the whole 122-file suite
     * green. The three sibling paths each pin this; the fallback document did not.
     */
    if (result.ok) return;
    expect(() => {
      (result.error.paths as string[]).push("sk-live-PUSHED");
    }).toThrow(TypeError);
  });

  /**
   * **A successful publication keeps the success code**, which no case here asked — the
   * property was held only by `apps/cli/src/main.test.ts`. Replacing the constant with
   * `observedCode`, which by construction never returns `0`, makes **every** successful
   * command exit `1` while its body says `"code":0`: the single defect this module's prose
   * says it exists to rule out, green across all of `result.test.ts`.
   */
  it("publishes a success with the success code", () => {
    const { text, code } = publish(success({ a: 1 }));

    expect(code).toBe(EXIT_CODES.success);
    expect(text).toContain('"code":0');
  });

  /**
   * **And a registered failure exits with its own code**, the twin of the case above. The
   * agreement `it.each` was reduced by a row on the argument that the branch reads `code`
   * once rather than twice and so could never fail — true of the *read*, and not of the
   * other half the row carried: that the arm's own code becomes the status. Hardcoding a
   * status here survived all of `result.test.ts` and was caught only by `tests/e2e`, which
   * is the same "held outside the package that owns it" gap the success twin was written
   * for.
   */
  it("publishes a registered failure with the arm's own code", () => {
    const { text, code } = publish(
      failure(EXIT_CODES.securityRefusal, { kind: "k", message: "m", paths: [] }),
    );

    expect(code).toBe(EXIT_CODES.securityRefusal);
    expect(text).toContain('"code":5');
  });

  /**
   * **A null-prototype payload is normalized rather than walked.** Fail-closed either way —
   * the re-walk still redacts — but a `bigint` or a cycle inside one degrades to
   * `"[unserializable]"` when the leg is dropped, so the two spellings are not equivalent.
   */
  it("walks a null-prototype object rather than normalizing it", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare["at"] = 1n;

    expect(redactPayload((text) => text, { bare })).toStrictEqual({
      bare: { at: "1n" },
    });
  });

  /**
   * **A minted *primitive* payload publishes**, which is the positive half of the one
   * registry keyed by value rather than identity. Every case here asked the negative — that
   * an unminted primitive is refused — so deleting the registration left them all green
   * while a legitimate payload was silently dropped. `apps/cli` held it; the walk lives
   * here, so the test does too.
   */
  it("publishes a primitive payload the producer minted, redacted", () => {
    /**
     * **A redactor that changes the string, which the first version of this case did not
     * have.** With `(text) => text` it asserted registration and could not observe
     * redaction at all — so the depth-0 string leaf could be returned unredacted and this
     * case, the only one driving a top-level string, stayed green while
     * `redactPayload(redact, "sk-live-…")` published the secret verbatim. Every row of the
     * `redacts %s` table wraps its secret in an object, so all of them enter through `walk`
     * and none reaches the leaf.
     */
    const payload = redactPayload(
      (text) => (text.includes("sk-live") ? "[REDACTED]" : text),
      "a diagnostic string with sk-live-TOP in it",
    );

    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, {
        kind: "k",
        message: "m",
        paths: [],
        data: payload,
      }),
    );

    expect(published).not.toContain("sk-live");
    expect(JSON.parse(published)).toMatchObject({ error: { data: "[REDACTED]" } });
  });

  /**
   * **Every falsy primitive the walk can return, minted and published.** `isRedactedPayload`
   * asks `payloads` for an object and `primitivePayloads` otherwise, and the `value !== null`
   * that routes `null` to the second registry could be deleted with the whole suite green:
   * `redactPayload(r, null)` mints legitimately and `failure` then dropped the field. Every
   * case here drove a *string* or a nested leaf, so the top-level primitives — the shapes
   * `primitivePayloads`' own docblock says are legitimate — were asserted by nothing.
   */
  it.each([
    ["null", null],
    ["zero", 0],
    ["false", false],
    ["an empty string", ""],
  ])("publishes %s as a minted top-level payload", (_name, value) => {
    const payload = redactPayload((text) => text, value);

    expect(
      JSON.parse(
        formatJsonResult(
          failure(EXIT_CODES.invalidInput, {
            kind: "k",
            message: "m",
            paths: [],
            data: payload,
          }),
        ),
      ),
    ).toStrictEqual({
      ok: false,
      code: EXIT_CODES.invalidInput,
      error: { kind: "k", message: "m", paths: [], data: value },
    });
  });

  /**
   * **`null` survives as `null`.** It falls into the object path, where `isWalkable`'s
   * `"toJSON" in value` throws on it and `redactDeep`'s own containment turns it into
   * `"[unserializable]"` — so dropping the `value === null` leg is fail-closed and silent.
   * It is a shipped shape, not a hypothetical: `RunReportV1.refused[].recovery` is
   * `string | null`, so `ingest` publishes `null` on `error.data` on the refusal path, and
   * under the mutant every such document reads `"recovery":"[unserializable]"` while still
   * declaring `schemaVersion: 1`.
   */
  it("publishes a null leaf as null, at every position", () => {
    expect(
      redactPayload((text) => text, { a: null, b: [null], c: 1 }),
    ).toStrictEqual({ a: null, b: [null], c: 1 });
  });

  /** A throwing iterator is contained in the same place, and reported rather than dropped. */
  it("contains a paths iterator that throws", () => {
    const hostile = {
      [Symbol.iterator]: (): Iterator<string> => {
        throw new TypeError("no");
      },
    } as unknown as readonly string[];

    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, { kind: "k", message: "m", paths: hostile }),
    );

    expect(JSON.parse(published)).toMatchObject({
      error: { paths: ["[unserializable]"] },
    });
  });

  /**
   * **The walk builds its own output.** `Array.prototype.map` goes through
   * ArraySpeciesCreate, so an array subclass with a hostile `Symbol.species` supplied the
   * object the walk wrote into — every other property on it survived, went through the deep
   * freeze, entered the payload registry as a legitimate product, and published. The species
   * output could even carry a `toJSON`, which is the attack `isWalkable` exists to stop,
   * reached *through* the producer.
   */
  it.each([
    [
      "a smuggled sibling property",
      /**
       * A **constructible** function, not an arrow: `ArraySpeciesCreate` calls `new` on it,
       * and an arrow throws there — which the walk contains, so a first version of this case
       * passed for the wrong reason and stayed green when the fix was reverted.
       */
      function SmuggledSpecies(this: unknown, n: number): unknown {
        return { smuggled: "sk-live", length: n };
      },
    ],
    [
      "a toJSON on the built object",
      function RenderingSpecies(this: unknown, n: number): unknown {
        return { toJSON: (): unknown => ({ leaked: "sk-live" }), length: n };
      },
    ],
  ])("does not let an array's species inject %s", (_name, species) => {
    const Evil = class extends Array<string> {} as unknown as ArrayConstructor;
    Object.defineProperty(Evil, Symbol.species, { get: () => species });

    const payload = redactPayload((text) => text, {
      report: Evil.from(["a"]) as unknown,
    });
    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, {
        kind: "k",
        message: "m",
        paths: [],
        data: payload,
      }),
    );

    expect(published).not.toContain("sk-live");
  });

  /**
   * **Every read of the caller's object is contained.** `kind`, `message`, `paths` (whose
   * spread invokes `Symbol.iterator`) and `data` are each a getter or a trap, and all were
   * read with no `try` — inside command `catch` blocks, so a throw replaced the diagnostic
   * with a rejected promise and no `--json` line at all.
   */
  it.each([
    [
      "a throwing kind getter",
      { get kind(): string { throw new Error("boom"); }, message: "m", paths: [] },
    ],
    [
      "a throwing paths iterator",
      {
        kind: "k",
        message: "m",
        paths: { [Symbol.iterator]: () => { throw new Error("boom"); } },
      },
    ],
  ])("describes a failure rather than throwing on %s", (_name, hostile) => {
    expect(() =>
      formatJsonResult(failure(EXIT_CODES.invalidInput, hostile as unknown as CliError)),
    ).not.toThrow();
  });

  /**
   * **The published code is one this module recognises**, and three things were unpinned
   * around it: the rebuild path wrote the caller's `code` straight through, `unpublishable`
   * accepted `0` — so a `success` arm that could not be serialized published `ok:false` with
   * a status meaning success — and the validator itself had no test, so reverting it to a
   * hardcoded `1` left the suite green.
   */
  it.each([
    ["an object with a toJSON", { toJSON: (): unknown => ({ leaked: "sk-live" }) }],
    ["a string", "sk-live-INJECTED"],
    ["a number outside the set", 42],
  ])("refuses %s as an exit code on the rebuild path", (_name, code) => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    const reshaped = { ...real, code } as unknown as CliResult<never>;

    const published = formatJsonResult(reshaped);

    expect(published).not.toContain("sk-live");
    expect(published).toContain('"code":1');
  });

  /** And a code this module does recognise is preserved, not flattened to the fallback. */
  it("keeps a valid failure code on the rebuild path", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    const reshaped = {
      ...real,
      code: EXIT_CODES.securityRefusal,
    } as unknown as CliResult<never>;

    expect(formatJsonResult(reshaped)).toContain('"code":5');
  });

  it("never publishes a failure document carrying the success code", () => {
    const published = formatJsonResult(success({ n: 1n }));

    expect(published).toContain("could not be published");
    expect(published).not.toContain('"code":0');
  });

  /**
   * **A raw string is not a payload**, and the membership test for primitives was unpinned:
   * dropping it to `typeof value === "string"` made any string publishable.
   */
  it("refuses a string payload the producer never minted", () => {
    const hostile: CliError = new Proxy(
      { kind: "k", message: "m", paths: [] },
      {
        get: (target, key): unknown =>
          key === "data" ? "sk-live" : Reflect.get(target, key),
      },
    );

    expect(formatJsonResult(failure(EXIT_CODES.invalidInput, hostile))).not.toContain(
      "sk-live",
    );
  });

  /** And a `paths` entry that is not a string is coerced, not published as it stands. */
  it("publishes no structure through a paths entry", () => {
    const published = formatJsonResult(
      failure(EXIT_CODES.invalidInput, {
        kind: "k",
        message: "m",
        paths: [{ toJSON: (): unknown => ({ leaked: "sk-live" }) }] as unknown as string[],
      }),
    );

    expect(published).not.toContain("sk-live");
  });

  /**
   * **The walk reads `length` once.** It was re-read every iteration, so a `Proxy` whose
   * trap kept growing it never terminated — a hang no `catch` contains, and unbounded
   * memory besides, since `MAX_DEPTH` bounds depth and nothing bounded breadth.
   */
  it("reads an array's length exactly once", () => {
    let reads = 0;
    const growing = new Proxy(["a"] as unknown[], {
      get: (target, key): unknown => {
        if (key === "length") {
          reads += 1;
          return reads + 1;
        }
        return Reflect.get(target, key);
      },
    });

    redactPayload((text) => text, { rows: growing });

    /**
     * **The count is the assertion, and it has to be.** The loop re-read `value.length`
     * every iteration, so a trap that keeps growing it never terminates — and a synchronous
     * hang cannot be timed out by the runner, so a case asserting the *output* would take
     * the suite down rather than fail. One read is the property; a second is the defect.
     */
    expect(reads).toBe(1);
  });

  /**
   * **The body and the status come from one decision.** `emit` read `result.code` itself
   * after `formatJsonResult` had already validated it, so a getter answering differently
   * each time published one status and exited with another — every mechanism in this module
   * guarded the body while the status came from an ungated second read.
   */
  it("decides the published body and the exit code together", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    let reads = 0;
    /**
     * **A different answer on *every* read, which the first version did not give.** It
     * returned `securityRefusal` once and `decisionRequired` for ever after, so a `publish`
     * that read `code` three times still agreed with itself on reads two and three — the
     * body and the status matched and the case passed while the binding it exists to pin was
     * gone. A getter that stabilises cannot tell one read from three.
     */
    const codes = [
      EXIT_CODES.securityRefusal,
      EXIT_CODES.decisionRequired,
      EXIT_CODES.invalidInput,
      EXIT_CODES.recoveryRequired,
    ];
    const shifting = {
      ...real,
      get code(): number {
        const answer = codes[reads % codes.length] ?? EXIT_CODES.operationalFailure;
        reads += 1;
        return answer;
      },
    } as unknown as CliResult<never>;

    const { text, code } = publish(shifting);

    expect(text).toContain(`"code":${String(code)}`);
    /**
     * And the count is the property, not only the agreement: `observedCode` reads once and
     * the binding is what both halves use. Anything more is the read-then-consume defect
     * this module's history is made of, whatever the two reads happen to return.
     */
    expect(reads).toBe(1);
  });

  /**
   * **A `code` getter that throws, which the shifting one above does not.** `observedCode`
   * contains its read; round 24 replaced that containment with a throw and the suite stayed
   * green. Escaping here escapes `publish` → `emit` → `run` → `bin.ts` and prints
   * `developer-os failed: TypeError` with no `--json` line at all — the exact outcome this
   * module exists to rule out, produced by the module.
   */
  it("survives a code getter that throws", () => {
    const hostile = {
      ok: false,
      error: { kind: "k", message: "m", paths: [] },
      get code(): number {
        throw new TypeError("no");
      },
    } as unknown as CliResult<never>;

    const { text, code } = publish(hostile);

    expect(text).toContain(`"code":${String(code)}`);
    expect(code).not.toBe(EXIT_CODES.success);
  });

  /** `failure` validates its own code, on the path production actually takes. */
  it.each([
    ["an object with a toJSON", { toJSON: (): unknown => "sk-live" }],
    ["the success code", 0],
    ["a number outside the set", 999],
  ])("refuses %s as a code passed to failure", (_name, code) => {
    const published = formatJsonResult(
      failure(code as unknown as 1, { kind: "k", message: "m", paths: [] }),
    );

    expect(published).not.toContain("sk-live");
    expect(published).toContain('"code":1');
  });

  /**
   * **A total node budget, because two per-axis bounds do not bound a product of axes.** An
   * aliased graph — 31 plain objects, no `Proxy`, no cycle — expands to 2^30 paths and
   * aborted the process with a fatal out-of-memory no `catch` can contain.
   */
  it("survives an aliased object graph", () => {
    let node: unknown = { v: "x" };
    for (let index = 0; index < 30; index += 1) node = { a: node, b: node };

    /**
     * **The marker is the assertion.** A size bound cannot report the defect it exists for:
     * without the budget this aborts the process with a fatal out-of-memory, which is not a
     * thrown error and not a failed assertion — the runner dies instead of reporting.
     */
    expect(JSON.stringify(redactPayload((text) => text, node))).toContain("[truncated]");
  });

  /** Two keys that redact to one token keep both entries rather than losing the first. */
  it("keeps both entries when redacted keys collide", () => {
    const payload = redactPayload((text) => (text.startsWith("k") ? "<same>" : text), {
      k1: "first",
      k2: "second",
    });

    const published = JSON.stringify(payload);
    expect(published).toContain("first");
    expect(published).toContain("second");
  });

  /** `formatJsonResult`'s rebuild binds `error` once, as `failure` does. */
  it("reads the error and its recovery exactly once on the rebuild path", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
      recovery: "r",
    });
    if (real.ok) return;
    let errorReads = 0;
    let recoveryReads = 0;
    const counted = {
      ...real,
      get error(): CliError {
        errorReads += 1;
        return {
          kind: "k",
          message: "m",
          paths: [],
          get recovery(): string {
            recoveryReads += 1;
            return "r";
          },
        };
      },
    } as unknown as CliResult<never>;

    formatJsonResult(counted);

    expect(errorReads).toBe(1);
    expect(recoveryReads).toBe(1);
  });

  /** And a `paths` entry is coerced on that path too, not only in `failure`. */
  it("coerces a paths entry on the rebuild path", () => {
    const real = failure(EXIT_CODES.invalidInput, {
      kind: "k",
      message: "m",
      paths: [],
    });
    if (real.ok) return;
    const reshaped = {
      ...real,
      error: {
        kind: "k",
        message: "m",
        paths: [{ toJSON: (): unknown => ({ leaked: "sk-live" }) }],
      },
    } as unknown as CliResult<never>;

    expect(formatJsonResult(reshaped)).not.toContain("sk-live");
  });

  /** A number and the string of that number are different payloads. */
  it("does not confuse a numeric payload with its string spelling", () => {
    redactPayload((text) => text, 1);

    const hostile: CliError = new Proxy(
      { kind: "k", message: "m", paths: [] },
      {
        get: (target, key): unknown => (key === "data" ? "1" : Reflect.get(target, key)),
      },
    );

    expect(formatJsonResult(failure(EXIT_CODES.invalidInput, hostile))).not.toContain(
      '"data"',
    );
  });

  /**
   * **The body and the status agree, on every branch including the ones that fail.**
   *
   * Each of these disagreed: a registered success whose payload could not be serialized
   * published a failure document and returned `0`; a spread of a success published
   * `{"ok":true,"code":0}` and returned `1`; and `rebuild`'s catch re-read the hostile
   * object instead of using the code it was handed. The assertion is the agreement itself,
   * not any particular value, so it cannot be tuned to one shape of the defect.
   */
  it.each([
    ["a registered success that cannot be serialized", (): CliResult<unknown> => success({ n: 1n })],
    [
      "a spread of a success",
      (): CliResult<unknown> => ({ ...success({ hello: "world" }) }),
    ],
    [
      "a shifting code beside a throwing error",
      (): CliResult<unknown> => {
        let reads = 0;
        return {
          ok: false,
          get code(): number {
            reads += 1;
            return reads === 1 ? 5 : 3;
          },
          get error(): CliError {
            throw new Error("boom");
          },
        } as unknown as CliResult<unknown>;
      },
    ],
    /**
     * A registered failure is deliberately **not** a row here: its arm is frozen before it
     * is registered, so `publish`'s own docblock calls that branch provably equivalent to
     * reading `code` twice — the row could never fail, and a 117-mutation battery confirmed
     * no mutant ever reddened it. Body-and-status agreement for that arm is asserted by the
     * exact-byte cases above instead.
     */
  ])("publishes a body whose code is the status, for %s", (_name, build) => {
    const { text, code } = publish(build());

    expect(text).toContain(`"code":${String(code)}`);
  });

  /**
   * **`normalize` is counted under the same budget as the walk.** It serialized the whole
   * reachable subgraph before a node was counted, so a plain object carrying `toJSON` — the
   * case `isWalkable`'s docblock calls the sharp one — re-opened the aliased-graph abort the
   * budget was added to close.
   */
  it("bounds a graph reached through toJSON", () => {
    let graph: unknown = { v: "x" };
    for (let index = 0; index < 23; index += 1) graph = { a: graph, b: graph };

    const payload = redactPayload((text) => text, {
      hostile: { toJSON: (): unknown => graph },
    }) as { readonly hostile?: unknown };

    /**
     * **Where the truncation happens is the assertion.** Asserting only that the marker
     * appears somewhere passes either way: an unbounded `normalize` serializes the whole
     * subgraph and the *walk* then truncates the parsed copy, so the marker shows up deep
     * inside a value that cost gigabytes to build. Bounded, the hostile node itself is the
     * marker, which is the only observable difference.
     */
    expect(payload.hostile).toBe("[truncated]");
  });

  /**
   * **A key named after an `Object.prototype` member is not a collision.** The check used
   * `in`, which sees the prototype chain, so `toString` was renamed to `toString#0` though
   * nothing collided — and this case **cannot** tell `Object.hasOwn` from `in` today,
   * because the accumulator is `Object.create(null)`, where the two are identical. Two
   * guards were added for one defect and either alone answers it; the `__proto__` case below
   * is what carries the accumulator, and this one carries `freeName` not widening a name
   * that is free — silent corruption of a published field name.
   */
  it("does not rename a key that only looks like a collision", () => {
    const payload = redactPayload((text) => text, {
      toString: "a",
      constructor: "b",
      valueOf: "c",
    });

    expect(JSON.parse(JSON.stringify(payload))).toStrictEqual({
      toString: "a",
      constructor: "b",
      valueOf: "c",
    });
  });

  /**
   * **`ok` as a getter, because a spread cannot exercise a re-read.**
   *
   * The agreement case beside this one builds `{ ...real, get code() {…} }` — a spread, so
   * `ok` is a plain data property and a second read of it necessarily agrees with the first.
   * That is why it went green over `rebuild` reading `ok` again and publishing
   * `{"ok":true,"code":0}` with an unvetted `data`, while `publish` returned the failure
   * status. Three rounds running, a fix was shipped beside a test using a construct that
   * could not reach the defect it was written for.
   */
  it.each([
    [
      "an ok that flips after the first read",
      (): CliResult<unknown> => {
        let reads = 0;
        return {
          get ok(): boolean {
            reads += 1;
            return reads > 1;
          },
          code: EXIT_CODES.securityRefusal,
          data: { secret: "sk-live" },
          warnings: [],
          error: { kind: "k", message: "m", paths: [] },
        } as unknown as CliResult<unknown>;
      },
    ],
    [
      "an ok that throws once and then claims success",
      (): CliResult<unknown> => {
        let reads = 0;
        return {
          get ok(): boolean {
            reads += 1;
            if (reads === 1) throw new Error("boom");
            return true;
          },
          code: EXIT_CODES.decisionRequired,
          data: { secret: "sk-live" },
          warnings: [],
          error: { kind: "k", message: "m", paths: [] },
        } as unknown as CliResult<unknown>;
      },
    ],
  ])("publishes no unvetted data through %s", (_name, build) => {
    const { text, code } = publish(build());

    expect(text).not.toContain("sk-live");
    expect(text).toContain(`"code":${String(code)}`);
    expect(text).toContain('"ok":false');
  });

  /**
   * **A `__proto__` key survives, and the null-prototype accumulator is what makes it.**
   * `Object.hasOwn` alone is not the fix: `walked["__proto__"] = …` on an ordinary object
   * sets the prototype and the entry vanishes from the output. `normalize`'s `JSON.parse`
   * creates `__proto__` as an own property, so this is reachable rather than theoretical.
   */
  it("publishes a __proto__ key rather than losing it to the prototype", () => {
    const payload = redactPayload(
      (text) => text,
      JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as unknown,
    );

    const published = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect(Object.keys(published).sort()).toStrictEqual(["__proto__", "safe"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  /**
   * **The marker key and the key count, not a substring.**
   *
   * A first version asserted `toContain("[truncated]")`, which an over-budget walk supplies
   * for free: `redactDeep` returns that string as the *value* of every node past the budget,
   * so deleting the guard entirely left the case green while 150 000 keys published against
   * a 100 000 budget. The defect it was named for was exactly what the reverted code did.
   */
  it("stops walking an object at the budget and marks it", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < 150_000; index += 1) wide[`k${String(index)}`] = index;

    const payload = JSON.parse(
      JSON.stringify(redactPayload((text) => text, wide)),
    ) as Record<string, unknown>;

    expect(Object.hasOwn(payload, "[truncated]")).toBe(true);
    expect(Object.keys(payload).length).toBeLessThan(150_000);
  });

  /**
   * **The array branch's break, which is the guard that prevents a hang.** Nothing covered
   * it: without it the loop runs `length` times and pushes a slot each time, so one sparse
   * array with a length far above the budget is unbounded work and unbounded memory.
   */
  it("stops walking an array at the budget", () => {
    const payload = redactPayload((text) => text, {
      rows: new Array<unknown>(500_000_000),
    }) as unknown as { readonly rows: readonly unknown[] };

    /**
     * **The exact length, because the marker is free.** Every element past the budget is
     * already `"[truncated]"` — `redactDeep`'s own first line returns it — so asserting the
     * last element, or a length bound, passes with the break's marker push deleted. What the
     * push adds is one entry, and that is the only observable difference.
     */
    expect(payload.rows.length).toBe(MAX_NODES_CEILING - 1);
    expect(payload.rows.at(-1)).toBe("[truncated]");
  });

  /**
   * **The truncation marker collides like any other synthesized name.** It was written with
   * a bare assignment twenty lines below the paragraph calling a silent drop "the worst
   * available answer", so a payload carrying its own `"[truncated]"` key had that key's
   * value overwritten and nothing said so. Both synthesized names go through `freeName` now.
   */
  it("does not overwrite a literal [truncated] key with the budget marker", () => {
    const wide: Record<string, unknown> = { "[truncated]": "kept" };
    for (let index = 0; index < 150_000; index += 1) {
      wide[`k${String(index)}`] = index;
    }

    const payload = redactPayload((text) => text, wide) as unknown as Record<
      string,
      unknown
    >;

    expect(payload["[truncated]"]).toBe("kept");
    /** The marker still lands, under a widened name, so truncation is not silent either. */
    expect(
      Object.keys(payload).filter((key) => key.startsWith("[truncated]#")),
    ).toHaveLength(1);
  });

  /**
   * **An unregistered success is refused, and its `data` never reaches the bytes.** A
   * previous version of this branch published the arm's `data` as given so that
   * `{ ...success(x) }` would keep its payload — and that made this the one place a value
   * the module did not construct reached `--json`. Measured then:
   * `publish({ ok: true, code: 5, data: { secret } })` printed the secret *and* returned
   * status `0`, converting a failure into a success on the way out.
   *
   * The failure arm survives being unregistered because `rebuild` coerces every field it
   * reads; a generic `data` has no such coercion, so there is nothing to re-derive it from
   * and the honest answer is the refusal document. What the branch is still for is the
   * agreement: `{ ...success(x) }` used to publish `{"ok":true,"code":0}` while exiting 1.
   */
  it("refuses an unregistered success rather than publishing its payload", () => {
    const { text, code } = publish({
      ...success({ hello: "world" }),
      /**
       * **An `error` the caller supplied, which is what makes this case non-vacuous.**
       * Without it, deleting the branch entirely leaves the suite green: the fall-through
       * runs `rebuild`, which throws on the missing `error` and returns the catch-all — for
       * this input, byte-identical to the refusal. Giving the arm an `error` makes the two
       * paths diverge, because the fall-through would publish *this* diagnostic.
       */
      error: { kind: "caller", message: "mine", paths: ["p"] },
    } as unknown as CliResult<never>);

    expect(text).not.toContain('"ok":true');
    expect(text).not.toContain("hello");
    expect(text).not.toContain("caller");
    expect(JSON.parse(text)).toMatchObject({
      error: {
        kind: "internal",
        message: "a success result this module did not construct cannot be published",
      },
    });
    expect(text).toContain(`"code":${String(code)}`);
    expect(code).toBe(EXIT_CODES.operationalFailure);
  });

  /**
   * The half that is a security property rather than a consistency one: the payload of an
   * arm this module never built does not reach the published bytes, and the arm's own code
   * does not become the status.
   */
  it("publishes neither the data nor the code of a forged success arm", () => {
    const { text, code } = publish({
      ok: true,
      code: EXIT_CODES.securityRefusal,
      data: { secret: "sk-live-DEADBEEF" },
      warnings: [],
    } as unknown as CliResult<never>);

    expect(text).not.toContain("sk-live-DEADBEEF");
    /**
     * **The exact code, not merely "not success".** The arm's own `code` is `5`, and the
     * fall-through this branch replaces publishes exactly that — so `not.toBe(success)`
     * passes with the branch deleted. `operationalFailure` is this module's answer; `5` is
     * the caller's, and taking the caller's is the defect.
     */
    expect(code).toBe(EXIT_CODES.operationalFailure);
    expect(text).toContain(`"code":${String(code)}`);
  });

  /**
   * **A bigint is a string leaf too.** Its digits went out untouched while the string
   * sibling beside it redacted — so a user pattern that would have matched a numeric
   * identifier did not fire, against three docblocks promising "every string leaf". The
   * redactor here has to be one that *would* change the digits; the product's own would
   * not, which is why the existing bigint case could not reach this.
   */
  it("redacts a bigint leaf, not only its string siblings", () => {
    const payload = redactPayload(
      (text) => text.replaceAll("9999", "[NUM]"),
      { n: 99_999_999n, s: "9999" },
    );

    expect(JSON.stringify(payload)).not.toContain("9999");
  });

  /**
   * **A synthesized collision name must not overwrite a literal key.** The suffix used the
   * entry counter, so a payload already carrying a key spelled like the synthesized one lost
   * its value silently — the outcome the collision docblock calls the worst available
   * answer, committed by the code written to avoid it.
   */
  it("keeps a literal key that looks like a synthesized collision name", () => {
    const payload = redactPayload(
      (text) => (text.startsWith("tok") ? "X" : text),
      { tokA: "first", "X#5": "LITERAL", a: 1, b: 2, c: 3, tokB: "second" },
    );

    const published = JSON.stringify(payload);
    expect(published).toContain("first");
    expect(published).toContain("second");
    expect(published).toContain("LITERAL");
  });

  /**
   * **Absent rather than `null` when nothing populates it**, so the existing shape is
   * byte-identical for every command that does not use it. That is what made this safe to
   * add to a type `foundation.md` §2 froze.
   */
  it("omits the slot entirely when no caller sets it", () => {
    const result = failure(EXIT_CODES.invalidInput, {
      kind: "invalid_input",
      message: "no",
      paths: [],
    });

    expect(formatJsonResult(result)).toBe(
      '{"ok":false,"code":2,"error":{"kind":"invalid_input","message":"no","paths":[]}}',
    );
  });
});
