# Repository Defects R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five `BACKLOG.md` §1 rows and four unowned product gaps that were waiting on a founder decision, now that all nine decisions are taken — so `ORDER.md` Track R stops being an empty track with a nine-row backlog behind it.

**Architecture:** Nine independent defects across five packages, each already specified by its own row and each now carrying a decided policy. No task depends on another's output; they are ordered so that the two that share `packages/core/src/transactions/executor.ts` do not run concurrently, and so the widest refactor (Task 2) lands before the two commands it touches are edited again. Every task is one row, one test cycle, one commit, one fresh-context review.

**Tech Stack:** TypeScript strict, zod 4.4.3, Vitest, pnpm workspaces, Node 24.16.0.

**Decisions of record:** taken by the founder on 2026-08-17 in this session, recorded per task under **Decision**. Where this plan and a `BACKLOG.md` §1 row disagree about what to build, the Decision line wins — the rows were written while the question was open.

## Global Constraints

Every task's requirements implicitly include this section. Each line is the repository's, with the document that carries it.

- **Redact before truncating, hashing, logging, persisting, or sending to a model.** Absolute (`SESSION.md`). Truncation and hashing do not make a secret safe.
- **The redaction key is never logged, never in `--json`, never in `installation-manifest.json`, never backed up, never staged by Git** (knowledge-pipeline spec §8.4). Task 2 moves the key behind a closure; it must not move it into any of those.
- **`CAPTURE_STATUSES` is frozen, in order, and gains no seventh member** (spec §5.5). Task 9 adds a *transition*, not a status.
- **`CaptureEnvelopeV1` is frozen.** No task here redesigns it.
- **Every filesystem mutation follows** `plan → backup → stage → validate → apply → verify → finalize`, through `TransactionExecutor`.
- **A gate that can pass by scanning nothing is not a gate.** Every check that sweeps a set asserts the set is non-empty, **per scope**, not in total.
- **Fixtures are synthetic.** No real vault, no real client name, no real repository, no copied third-party content.
- **No absolute machine path in any artifact checked into this repository.** This repository is public.
- **Dependency direction is one-way:** `core` ← `security` ← `workflow-schema` ← each adapter. `platform-macos` depends on `core` and `security`. Neither adapter may import the other.
- **A package is entered only through its `index.ts`**, never a module inside it.
- **A test pins the contract, not current behavior.** Every test below must be watched fail first, for the stated reason. A test that passes on first run has not pinned anything.
- **Exact-path staging.** Never `git add -A`. Before every commit: `npm run check`. Show failures only.
- **Every task gets a fresh-context review by an agent that is not its author**, with the constraints, the exact file list, and instructions to review only. After it returns, run `git status --short` and `git diff` yourself to prove it did not touch the tree.
- **An approved document is not silently rewritten.** Tasks 2 and 9 amend approved documents; each registers its pair in `BACKLOG.md` §8 and cross-references from the document it amends.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/security/src/cli.ts` | adds `screenDerivedPathArgument` beside the existing two screens | 1 |
| `packages/security/src/redaction.ts` | adds `createRedactor`, the only production entry to `redactText` | 2 |
| `packages/core/src/config/loader.ts` | adds the `[redaction]` table to the `.strict()` schema | 2 |
| `packages/security/src/text.ts` (new) | `isVisuallyBlank` and `perceptualKey`, moved out of `note.ts` on their second call site | 3 |
| `packages/brain/src/lint/lint.ts` | blank-tag and blank-summary findings; duplicates keyed perceptually | 3 |
| `packages/brain/src/discovery/discover.ts` | content root becomes the containment anchor | 4 |
| `packages/platform-macos/src/macos.ts` | `assertTrustedExecutable` on the boundary that made the promise | 5 |
| `packages/core/src/transactions/executor.ts` | backup prune in the `finalized` transition; caller-supplied precondition | 6, 8 |
| `packages/core/src/result.ts` | `data` slot on the failure arm | 7 |
| `packages/brain/src/review/decide.ts` | `accepted → rejected` | 9 |

---

## Task 1: NEW-12 — split the argv screen by provenance

**Decision (2026-08-17):** split by provenance. A value this product derived itself gets the positional dash rule only; a value originating outside — tool name, write scope, sandbox mode — keeps both rules. **Do not close this by narrowing the word list.**

**The defect.** `screenValueArgument` applies `/permission|danger|bypass/iu` to `invocation.workingRoot` and `invocation.outputSchemaPath` (`packages/adapter-codex/src/invoke.ts:211`, `:215`). Both are paths this product derived from the user's own configuration and its own shipped templates. A vault at `~/Danger/DeveloperBrain` therefore refuses every `codex` ingest, forever, with "the working root names a permission or bypass surface".

**Files:**
- Modify: `packages/security/src/cli.ts` — add `screenDerivedPathArgument` after `screenProseArgument`
- Modify: `packages/security/src/index.ts` — export it
- Modify: `packages/adapter-codex/src/invoke.ts:211-219` — two call sites
- Test: `packages/security/src/cli.test.ts`, `packages/adapter-codex/src/invoke.test.ts`

**Interfaces:**
- Produces: `screenDerivedPathArgument(value: string, field: string): string | null` — same shape as its two neighbours, `null` meaning accepted.

- [ ] **Step 1: Write the failing tests**

In `packages/security/src/cli.test.ts`:

```ts
describe("screenDerivedPathArgument", () => {
  it("accepts a product-derived path containing a word list term", () => {
    expect(screenDerivedPathArgument("/vault/Danger/brain", "the working root")).toBeNull();
  });

  it("keeps the dash rule, which is the one that is load-bearing", () => {
    expect(screenDerivedPathArgument("-/vault", "the working root")).toBe(
      'the working root may not begin with "-": it would be read as an option, not a value',
    );
  });

  it("leaves screenValueArgument's word list intact for values that originate outside", () => {
    expect(screenValueArgument("bypassPermissions", "an allowed tool")).toBe(
      "an allowed tool names a permission or bypass surface that is refused in a value position",
    );
  });
});
```

In `packages/adapter-codex/src/invoke.test.ts`:

```ts
it("ingests from a vault whose own path names a word-list term", async () => {
  const result = await invokeCodex(
    { ...baseInvocation, workingRoot: "/vault/Danger/DeveloperBrain" },
    dependencies,
  );
  expect(result.kind).not.toBe("refused");
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/security/src/cli.test.ts packages/adapter-codex/src/invoke.test.ts`
Expected: FAIL — `screenDerivedPathArgument is not defined`, and the codex case FAILs with `kind === "refused"` naming a permission or bypass surface. **The third case must pass on first run**; it is the guard that the split did not weaken the values that need both rules.

- [ ] **Step 3: Add the third screen**

In `packages/security/src/cli.ts`, after `screenProseArgument`:

```ts
/**
 * **The third screen, and the one whose name states a provenance rather than a
 * shape.** A derived path is a value this product computed from the user's own
 * configuration (`workingRoot`) or from its own shipped templates
 * (`outputSchemaPath`). Nothing outside this process chooses its text, so the
 * word list — which exists to catch a value naming a permission surface that a
 * *workflow author or a model* supplied without a leading dash — screens
 * nothing here while refusing a directory the user named themselves. A vault at
 * `~/Danger/DeveloperBrain` refused every `codex` ingest until this existed
 * (BACKLOG NEW-12).
 *
 * The dash rule is kept, and it is the one that was ever load-bearing: an
 * absolute path cannot begin with `-`, so a value that does is not the path
 * this product derived, whatever produced it.
 *
 * **Choosing between the three screens is a question about where the value came
 * from, never about which one accepts your string.** A caller reaching for this
 * because `screenValueArgument` refused its input has chosen wrongly by
 * construction unless it can name the code that derived the value.
 */
export function screenDerivedPathArgument(
  value: string,
  field: string,
): string | null {
  return screenProseArgument(value, field);
}
```

Export it from `packages/security/src/index.ts` beside the other two.

- [ ] **Step 4: Move the two call sites**

In `packages/adapter-codex/src/invoke.ts`, replace `screenValueArgument` with `screenDerivedPathArgument` at the `workingRoot` and `outputSchemaPath` sites only. Leave the write-scope loop at `:200` on `screenValueArgument` — a write scope is declared by a workflow author, which is outside.

Update the module docblock at `:15` and `:65`, both of which name `screenValueArgument` as what these fields get.

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: exit 0. Show failures only.

- [ ] **Step 6: Fresh-context review, then commit**

**Stage what `git status --short` actually lists, not what this step predicted.** The first draft
named five paths; the task really touched thirteen, and each omission had the same consequence —
green locally, red in every other checkout, which is the failure mode `SESSION.md` opens with. Two
were not obvious: `packages/security/src/index.test.ts` is an exact-set door test that goes red the
moment the export list widens, and `apps/cli/src/commands/ingest.test.ts` asserted the refusal this
task removes. **This file is the thirteenth** — the corrected staging list and these ticked
checkboxes are themselves part of the change, and leaving them unstaged hands the next session the
instruction that caused the problem.

**Run `git status --short` and stage every path it prints.** That is the rule for every task in this
plan; a hardcoded list in a document is a prediction, and this one was wrong twice.

```bash
git status --short          # read it; stage exactly these paths
git add packages/security/src/cli.ts packages/security/src/index.ts packages/security/src/cli.test.ts packages/security/src/index.test.ts packages/adapter-codex/src/invoke.ts packages/adapter-codex/src/invoke.test.ts apps/cli/src/commands/ingest.ts apps/cli/src/commands/ingest.test.ts docs/architecture/threat-model.md docs/architecture/codex-adapter.md docs/architecture/knowledge-pipeline.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-08-17-repository-defects-r2.md
git commit -m "fix(security): screen a product-assembled path by provenance, not by word list"
```

---

## Task 2: NEW-16 — make spec §8.2's user redaction patterns reachable

**Decision (2026-08-17):** add the config table. A `[redaction] patterns = [...]` table of literal, non-backtracking strings, wired from the composition root through every call site, with the `.strict()` schema amendment registered as a `BACKLOG.md` §8 row cross-referenced from `foundation.md`.

**The defect.** `redactText`'s `userPatterns` parameter has no production caller — all fourteen sites pass two arguments — and `configSchema` is `.strict()` (`packages/core/src/config/loader.ts:130-153`) with no redaction table, so there is no key a user could set even if a caller existed. The four built-in classes work; the *user-extensible* class the spec describes, the one a founder uses to redact a client name no generic pattern catches, was specified and never wired.

**Files:**
- Modify: `packages/core/src/config/loader.ts` — `redactionSchema`, `configSchema`, `serializeConfig`
- Modify: `packages/core/src/config/types.ts` — `DeveloperOsConfigV1.redaction`
- Modify: `packages/security/src/redaction.ts` — `createRedactor`
- Modify: `packages/security/src/index.ts` — export `createRedactor`, `Redactor`
- Modify: `apps/cli/src/context.ts:358`, `:665` — construct the redactor once, from config
- Modify: `apps/cli/src/commands/capture.ts:458`, `:629`, `:686`; `review.ts:245`, `:435`, `:475`; `ingest.ts:531`, `:814`, `:1095`, `:1146`, `:1254`; `init.ts:734`

> **These line numbers are instructions, not history, so they were re-resolved on 2026-08-17** after
> Task 1 moved four of them by twenty lines. Re-resolve them again before starting: `ingest.ts` is
> edited by Tasks 1, 7 and 8 of this plan. **Task 1's own citations are the opposite case** — its
> `invoke.ts:211`, `:215`, `:200` and the docblock lines describe code that task has already changed,
> so they are a record of where the work was done and must not be "corrected" into nonsense by a
> later sweep. A line number in a **Files** block ages; a line number in a closed task's prose does
> not.
- Create: `tests/repository/redactor-entry.test.ts` — the gate
- Test: `packages/core/src/config/loader.test.ts`, `packages/security/src/redaction.test.ts`
- Modify: `docs/superpowers/BACKLOG.md` §8 — the amendment row; `docs/architecture/foundation.md` §2 — the cross-reference

**Interfaces:**
- Produces: `type Redactor = (text: string) => RedactionResult`
- Produces: `createRedactor(key: Uint8Array, options?: RedactionOptions): Redactor`
- Produces: `DeveloperOsConfigV1.redaction?: { readonly patterns: readonly string[] }`

- [ ] **Step 1: Write the failing config test**

In `packages/core/src/config/loader.test.ts`:

```ts
it("accepts a redaction table of literal patterns", () => {
  const config = loadConfig(`
schemaVersion = 1
brainPath = "/synthetic/vault"
telemetry = false
[adapters]
claude = true
codex = true
[git]
enabled = false
[automation]
enabled = false
[redaction]
patterns = ["Northwind Traders", "acme-internal"]
`);
  expect(config.redaction?.patterns).toEqual(["Northwind Traders", "acme-internal"]);
});

it("refuses an empty pattern, which would redact every position in the text", () => {
  expect(() => loadConfig(`${BASE_CONFIG}\n[redaction]\npatterns = [""]\n`)).toThrow();
});

it("round-trips a redaction table through serializeConfig", () => {
  const source = `${BASE_CONFIG}\n[redaction]\npatterns = ["Northwind Traders"]\n`;
  expect(loadConfig(serializeConfig(loadConfig(source)))).toEqual(loadConfig(source));
});

it("keeps a configuration that predates the table loadable", () => {
  expect(loadConfig(BASE_CONFIG).redaction).toBeUndefined();
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run packages/core/src/config/loader.test.ts`
Expected: FAIL — the first case throws on an unrecognized key, because the schema is `.strict()`. That failure is the point: it is what makes this a documented amendment rather than a widening nobody noticed.

- [ ] **Step 3: Add the table to the schema**

In `packages/core/src/config/loader.ts`, above `configSchema`:

```ts
/**
 * **Literal substrings, never expressions.** `redactText` matches these with
 * `String.prototype.indexOf` and not with a compiled pattern: a user-supplied
 * regular expression run over capture text is a ReDoS surface, and this
 * codebase bounds no expression anywhere (`RedactionOptions`'s own docblock
 * states the rule this table has to honour).
 *
 * **Bounded on both axes, and the bounds are the reason the table is safe to
 * expose.** Redaction is O(patterns x text) and runs on every capture, every
 * review and every ingest; an unbounded list turns a configuration file into a
 * denial of service against the user's own vault. Sixty-four patterns of up to
 * 200 characters is far above any real client-name list and far below anything
 * measurable.
 *
 * **An empty string is refused rather than ignored**, because `indexOf("")`
 * matches at every position: a single empty entry would redact the whole of
 * every text this product ever handles, and the failure would look like the
 * redactor working.
 *
 * Optional, like `[brain]` and for the same reason: `configSchema` is
 * `.strict()`, so a required table would refuse every installation that
 * predates it. Amends `foundation.md` §2's frozen schema; BACKLOG §8 carries
 * the row.
 */
const redactionSchema = z
  .object({
    patterns: z.array(z.string().min(1).max(200)).max(64),
  })
  .strict();
```

Add `redaction: redactionSchema.optional(),` to `configSchema`. Destructure it out of `loadConfig` alongside `brain` — `exactOptionalPropertyTypes` makes a present-and-`undefined` key unassignable, exactly as the existing `brain` docblock records — and re-add it only when present. Emit it from `serializeConfig` only when present, so a configuration that never had one does not gain an empty `[redaction]` table.

Add `readonly redaction?: { readonly patterns: readonly string[] }` to `DeveloperOsConfigV1`.

- [ ] **Step 4: Run the config tests and verify they pass**

Run: `pnpm vitest run packages/core/src/config/loader.test.ts`
Expected: PASS, all four.

- [ ] **Step 5: Write the failing redactor test**

In `packages/security/src/redaction.test.ts`:

```ts
it("binds user patterns to the key, so a caller cannot redact without them", () => {
  const redact = createRedactor(KEY, { userPatterns: ["Northwind Traders"] });
  const result = redact("a note about Northwind Traders and nothing else");
  expect(result.text).not.toContain("Northwind Traders");
  expect(result.findings.map((f) => f.class)).toContain("user-pattern");
});

it("matches a configured pattern case-insensitively, as addUserPatterns already does", () => {
  const redact = createRedactor(KEY, { userPatterns: ["Northwind Traders"] });
  expect(redact("northwind traders").text).not.toContain("northwind traders");
});

it("returns a redactor that behaves as redactText does when no patterns are configured", () => {
  expect(createRedactor(KEY)("plain text")).toEqual(redactText("plain text", KEY));
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `pnpm vitest run packages/security/src/redaction.test.ts`
Expected: FAIL — `createRedactor is not defined`.

- [ ] **Step 7: Add `createRedactor`**

In `packages/security/src/redaction.ts`:

```ts
export type Redactor = (text: string) => RedactionResult;

/**
 * **The one production entry to `redactText`, and the reason it exists is the
 * key rather than the patterns.** Binding both into a closure means the key
 * stops travelling as a parameter through capture, review, ingest and init —
 * fourteen call sites that each had to be trusted not to log, hash or persist
 * it (spec §8.4). A closure cannot be logged into a diagnostic by accident.
 *
 * The patterns come from `config.toml`'s `[redaction]` table and are literal
 * substrings; `RedactionOptions` states why they are not expressions.
 *
 * `tests/repository/redactor-entry.test.ts` asserts that no production module
 * outside this file calls `redactText` directly, per scope, so a fifteenth call
 * site cannot quietly reintroduce the threading this replaced.
 */
export function createRedactor(
  key: Uint8Array,
  options: RedactionOptions = {},
): Redactor {
  return (text: string) => redactText(text, key, options);
}
```

- [ ] **Step 8: Thread the redactor from the composition root**

In `apps/cli/src/context.ts`, build one redactor from the loaded config's `redaction?.patterns ?? []` and the durable key, and expose it as `CliContext.redact: Redactor`. Replace every `redactText(value, key)` in `capture.ts`, `review.ts`, `ingest.ts`, `init.ts` and `context.ts` with a call to the bound redactor, changing the parameter each helper receives from `key: Uint8Array` to `redact: Redactor` **where the function only redacts**. The key stays where it is genuinely needed for fingerprinting — `fingerprintDirectory(workingDirectory, key)` in `capture.ts:684` is the case to leave alone.

`init.ts:734` runs before a config exists; it passes no patterns and keeps the built-in classes only. Say so in a comment at that site.

- [ ] **Step 9: Write the gate that keeps the entry single**

Create `tests/repository/redactor-entry.test.ts`:

```ts
it("routes every production redaction through createRedactor, per package", async () => {
  const scopes = ["apps/cli/src", "packages/brain/src", "packages/security/src"];
  for (const scope of scopes) {
    const files = await productionSourceFiles(scope);
    expect(files.length, `${scope} enumerated no files`).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith("packages/security/src/redaction.ts")) continue;
      const source = await readFile(file, "utf8");
      expect(source, `${file} calls redactText directly`).not.toMatch(/\bredactText\s*\(/u);
    }
  }
});
```

The per-scope non-empty assertion is not optional: `SESSION.md`'s hard rule is that a gate which can pass by scanning nothing is not a gate, and the self-containment enumerator has already been caught passing over an empty set once.

- [ ] **Step 10: Run the gate**

Run: `npm run check`
Expected: exit 0. Show failures only.

- [ ] **Step 11: Register the amendment**

Add a `BACKLOG.md` §8 row: `foundation.md` §2's frozen `.strict()` config schema, amended 2026-08-17 by this task with an optional `[redaction]` table, outcome pending founder ratification. Cross-reference it from `docs/architecture/foundation.md` §2 in that same commit — four amendments were once recorded and never cross-referenced, and readers of the amended sections got the superseded contract for four days.

- [ ] **Step 12: Fresh-context review, then commit**

```bash
git add packages/core/src/config packages/security/src/redaction.ts packages/security/src/index.ts packages/security/src/redaction.test.ts apps/cli/src/context.ts apps/cli/src/commands/capture.ts apps/cli/src/commands/review.ts apps/cli/src/commands/ingest.ts apps/cli/src/commands/init.ts tests/repository/redactor-entry.test.ts docs/superpowers/BACKLOG.md docs/architecture/foundation.md
git commit -m "feat(security): wire spec 8.2's user redaction patterns to a config table"
```

---

## Task 3: NEW-11 — the invisible-title rule reaches its three neighbours

**Decision (2026-08-17):** an invisible tag is **a lint warning** — a `frontmatter`-class finding. It needs no renderer change and no new module, and the note still indexes.

**The defect.** NEW-10 gave `title` a predicate meaning *at least one visible character*. Three neighbours did not get it. `tags: [""]` and `tags: ["\u200B"]` both pass, and the tag cloud renders `-  (3)`: a count attached to no label. `summary: "\u3164"` renders a dangling em-dash. And `lint.ts`'s `duplicates` key screens `\p{Cf}` only, so `Deploy keys` and `Deploy\u3164keys` produce different keys and no duplicate is reported, while `catalog.md` shows two rows a human reads as identical — the failure NEW-6 was opened for, one character class over.

**Two rules from the row, both binding.** `isBlank` is **moved** to `packages/security` on its second call site, not copied — that module's own header states the rule. And the duplicates key needs something `isBlank` cannot give: a **perceptual grouping key**, a separate function returning a string. Anyone who starts by reaching for `isBlank` there has started wrong. **Do not fix either by widening `screenControlCharacters`** — deleting non-spacing marks would corrupt every accented and every Indic title it touches.

**Files:**
- Create: `packages/security/src/text.ts` — `isVisuallyBlank`, `perceptualKey`
- Modify: `packages/security/src/index.ts` — export both
- Modify: `packages/brain/src/schema/note.ts:228-232` — delete the local `isBlank`, import it
- Modify: `packages/brain/src/lint/lint.ts` — tag and summary findings; the duplicates key
- Test: `packages/security/src/text.test.ts`, `packages/brain/src/lint/lint.test.ts`

**Interfaces:**
- Produces: `isVisuallyBlank(value: string): boolean` — the predicate `note.ts` already applies to `title`, verbatim, including its `INVISIBLE_ONLY` character classes and the ICU-drift docblock.
- Produces: `perceptualKey(value: string): string` — invisibles removed, marks untouched, NFC-folded.

**Write every invisible as a `\uXXXX` escape, in the tests and in this plan.** `tests/repository/control-bytes.test.ts` refuses a literal U+200B anywhere in the tree, and it caught this plan's first draft. A test about invisible characters that cannot itself be committed is a test nobody runs — and an escape is legible to a reviewer where the character it stands for is, by construction, not.

- [ ] **Step 1: Write the failing tests**

In `packages/security/src/text.test.ts`:

```ts
describe("perceptualKey", () => {
  it("groups two titles a human reads as identical", () => {
    expect(perceptualKey("Deploy\u3164keys")).toBe(perceptualKey("Deploykeys"));
  });

  it("leaves combining marks alone, so an accented title keeps its identity", () => {
    expect(perceptualKey("Café")).not.toBe(perceptualKey("Cafe"));
  });
});
```

In `packages/brain/src/lint/lint.test.ts`:

```ts
it("warns about a tag with no visible character", async () => {
  const findings = await lintVault(vaultWith({ tags: ["deploy", "\u200B"] }));
  expect(findings).toContainEqual(
    expect.objectContaining({
      class: "frontmatter",
      severity: "warn",
      key: "tags",
    }),
  );
});

it("warns about a summary with no visible character", async () => {
  const findings = await lintVault(vaultWith({ summary: "\u3164" }));
  expect(findings.map((f) => f.key)).toContain("summary");
});

it("reports two titles that differ only by an invisible as duplicates", async () => {
  const findings = await lintVault(
    vaultWithTitles(["Deploy keys", "Deploy\u3164keys"]),
  );
  expect(findings.filter((f) => f.class === "duplicates")).toHaveLength(2);
});

it("still indexes a note whose tag is blank, because this is a warning", async () => {
  const build = await buildIndexFor(vaultWith({ tags: ["\u200B"] }));
  expect(build.index.notes).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/security/src/text.test.ts packages/brain/src/lint/lint.test.ts`
Expected: FAIL — `perceptualKey is not defined`; the tag and summary cases find no finding; the duplicates case finds 0 findings rather than 2. **The fourth case must pass on first run** — it pins that this decision is a warning and not a validation error, and it would go red if a later hand reached for `note.ts` instead.

- [ ] **Step 3: Move the predicate and add the key**

Create `packages/security/src/text.ts`. Move `INVISIBLE_ONLY` and `isBlank` out of `packages/brain/src/schema/note.ts` verbatim — the regex, and the whole docblock above it, including the ICU-drift paragraph, which is as true here as it was there. Rename the export to `isVisuallyBlank`; the local name said what it tested, the exported one has to say what it means.

```ts
/**
 * **A grouping key, not a predicate, and not `isVisuallyBlank` with a different
 * return type.** `duplicates` asks whether two titles are the *same* to a
 * reader; `isVisuallyBlank` asks whether one title is *empty* to a reader. The
 * two need different character sets and conflating them is the mistake this
 * docblock exists to prevent (BACKLOG NEW-11).
 *
 * **Invisibles are removed; marks are untouched.** Removing `\p{Cf}` and the
 * default-ignorable set makes `Deploy\u3164keys` group with `Deploy keys`,
 * which is the defect. Removing `\p{Mn}` or `\p{Me}` as well would make `Café`
 * group with `Cafe` — two genuinely different titles in every language that
 * uses a diacritic to distinguish words, and the same corruption that
 * `screenControlCharacters` is forbidden to introduce.
 *
 * NFC-folded last, so a decomposed and a precomposed spelling of one title
 * produce one key.
 */
export function perceptualKey(value: string): string {
  return value.replace(INVISIBLE, "").normalize("NFC");
}
```

where `INVISIBLE` is `/[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu` — the invisible classes of `INVISIBLE_ONLY` with `\p{Mn}`, `\p{Me}` and `\s` deliberately absent. Whitespace stays: two titles differing by a real space are two titles.

In `note.ts`, delete the local definition and import `isVisuallyBlank` from `@developer-os/security`. The `title` check at `:424` keeps its current behaviour exactly.

- [ ] **Step 4: Add the two findings and rekey duplicates**

In `packages/brain/src/lint/lint.ts`, extend `frontmatterFindings` to walk `build.index.notes` — the parsed notes, not `build.parseIssues`, because a blank tag *parses*:

```ts
for (const note of build.index.notes) {
  for (const tag of note.tags) {
    if (!isVisuallyBlank(tag)) continue;
    findings.push(
      finding(
        "frontmatter",
        "warn",
        note.path,
        "tags",
        "a tag with no visible character renders as a count attached to no label in the tag cloud; remove it or give it a name",
      ),
    );
  }
  if (isVisuallyBlank(note.summary)) {
    findings.push(
      finding(
        "frontmatter",
        "warn",
        note.path,
        "summary",
        "a summary with no visible character renders as a dangling em-dash in the catalog; remove it or write one",
      ),
    );
  }
}
```

`summary` is a required key typed `readonly summary: string` (`note.ts:72`, `build.ts:38`), so there is no `undefined` branch to guard — and `summary: ""` passes validation today and renders the same dangling em-dash, so it is in scope rather than a false positive. `isVisuallyBlank("")` is `true`, because `INVISIBLE_ONLY` is anchored over a `*` quantifier.

In `duplicateFindings`, replace the screened-title group key with `perceptualKey(screenControlCharacters(note.title))`. The screen stays — it is what makes this class agree with the artifact it is about, since `catalog.md` renders a screened title — and the perceptual key is applied over its result.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm vitest run packages/security/src/text.test.ts packages/brain/src/lint/lint.test.ts packages/brain/src/schema/note.test.ts`
Expected: PASS. `note.test.ts` must be green **unchanged** — the title predicate moved packages and did not change.

- [ ] **Step 6: Run the gate, review, commit**

Run: `npm run check`

```bash
git add packages/security/src/text.ts packages/security/src/text.test.ts packages/security/src/index.ts packages/brain/src/schema/note.ts packages/brain/src/lint/lint.ts packages/brain/src/lint/lint.test.ts
git commit -m "fix(brain): carry the invisible-title rule to tags, summary and the duplicates key"
```

---

## Task 4: NEW-22 — a symlinked content root is supported

**Decision (2026-08-17):** support it. Canonicalize the content root once at entry, walk from the canonical path, and anchor containment on it so a link and its target collapse to one note.

**The defect.** `discoverNotes` calls `refuseEscapingLink(contentDir, …)` unconditionally before any per-entry walk (`packages/brain/src/discovery/discover.ts:230-243`), which refuses **any** content root reached through a link — not only one that escapes the vault. `BrainService.reindex()` reaches it through `buildIndex()` → `discoverNotes()`, so `brain reindex` and `ingest`'s third transaction both fail on such a vault with `Vault entry resolves outside the vault: content`. The scenario is ordinary: a user with an existing Obsidian vault points `brainPath` at a new directory and symlinks `content` at the vault they already have.

**The guard's reason is good and is not in dispute** — its docblock records that a symlinked `content` would let another vault's notes be indexed as this vault's own. What changes is the *anchor*, not the guarantee: the content root becomes the boundary it is already the subject of. This is the same narrowing R1 applied to `writeIndexArtifacts` on 2026-08-15, one layer up.

**The compatibility clause, and it is the part to get right.** Per-entry checks today accept a link that resolves anywhere inside the **vault** and skip it. Anchoring entries on the content root alone would start *refusing* a link from `content/` to a sibling such as `_indexes` — a layout that works today. So an entry is refused only when its target is outside **both** roots.

**Files:**
- Modify: `packages/brain/src/discovery/discover.ts:132-144` (`refuseEscapingLink`), `:155-159` (`WalkContext`), `:183-190`, `:225-265`
- Test: `packages/brain/src/discovery/discover.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `refuseEscapingLink(absolutePath: string, vaultPath: string, permittedRoots: readonly string[], canonicalize: (path: string) => Promise<string>): Promise<void>` — refuses when the target is contained by none of the roots.

- [ ] **Step 1: Write the failing tests**

In `packages/brain/src/discovery/discover.test.ts`:

```ts
it("indexes a vault whose content root is a symlink to an existing vault", async () => {
  const result = await discoverNotes(requestWithSymlinkedContentRoot());
  expect(result.notes.map((n) => n.vaultPath)).toEqual(["content/DEV/pattern.md"]);
});

it("still refuses an entry inside content that resolves outside both roots", async () => {
  await expect(discoverNotes(requestWithEntryEscapingTo("/etc"))).rejects.toThrow(
    SecurityRefusalError,
  );
});

it("still skips, and does not refuse, a link from content into the vault", async () => {
  const result = await discoverNotes(requestWithEntryLinkedTo("_indexes"));
  expect(result.symlinkedFolders).toEqual(["content/_indexes-link"]);
  expect(result.notes).toEqual([]);
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/brain/src/discovery/discover.test.ts`
Expected: the first FAILs with `Vault entry resolves outside the vault: content`. **The second and third must pass on first run** — they are the two guarantees this change is forbidden to spend, and a green start is what proves the change did not buy the first case with either of them.

- [ ] **Step 3: Widen the anchor to a set of roots**

Change `refuseEscapingLink`'s third parameter from `vaultRootCanonical: string` to `permittedRoots: readonly string[]`, and its test from one `containsPath` to `permittedRoots.some(...)`. Its docblock gains the reason the set has two members:

```ts
/**
 * Spec §5: every path is resolved through Foundation's canonicalization, so a
 * link out of the vault is refused rather than followed.
 *
 * **Two roots, because the content root is no longer required to sit inside the
 * vault root.** A user may symlink `content` at an Obsidian vault they already
 * have (BACKLOG NEW-22); after that the vault root holds the configuration and
 * the indexes while every note lives under the content root, and neither
 * contains the other. An entry is refused when it escapes *both* — which keeps
 * the guarantee this function was written for, that another vault's notes
 * cannot be indexed as this vault's own, and keeps accepting the in-vault link
 * to a sibling such as `_indexes` that works today.
 */
```

- [ ] **Step 4: Make the content root an anchor rather than a subject**

In `discoverNotes`, replace the `refuseEscapingLink(contentDir, …)` call with a canonicalization:

```ts
/**
 * The content root is canonicalized rather than contained. It is the anchor
 * every entry beneath it is measured against, so asking whether it sits inside
 * the vault root is asking the wrong question of the wrong path — and asking it
 * refused every vault whose `content` is a symlink, which is an ordinary
 * Obsidian layout (BACKLOG NEW-22).
 *
 * **The walk starts from the canonical path**, so `absolutePath` on every
 * discovered note is the real file rather than a path through the link. That is
 * what makes a link and its target collapse to one note instead of two rows
 * naming one file. `vaultPath` is unchanged and stays declared — it is what
 * `catalog.md` renders and what the user typed.
 */
const contentRootCanonical = await canonicalize(contentDir);
```

Thread `permittedRoots: [contentRootCanonical, vaultRootCanonical]` into `WalkContext`, replacing `vaultRootCanonical`, and pass it at both per-entry sites (`:184-189` and `:259-264`). Start the top-level `readDir` and every `join` from `contentRootCanonical` rather than `contentDir`.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm vitest run packages/brain`
Expected: PASS, including `build.test.ts` and `lint.test.ts`, which consume discovery's output.

- [ ] **Step 6: Run the gate, review, commit**

Run: `npm run check`

```bash
git add packages/brain/src/discovery/discover.ts packages/brain/src/discovery/discover.test.ts
git commit -m "fix(brain): anchor discovery on the content root so a symlinked vault indexes"
```

---

## Task 5: NEW-15 — pay the check the platform type demands

**Decision (2026-08-17): resolve, then check.** Canonicalize the binary and check the resolved target plus its ancestors: refuse an owner that is neither the current uid nor root, refuse other-writable (`0o002`), **allow group-writable when the directory's owner is the current uid**. Accept a check-then-use window of the NEW-20 shape, registered rather than hidden.

**Why the obvious policy was withdrawn, and why this one is not it.** R1 built the strict guard on 2026-08-15 — refusing a symlink anywhere in the chain and refusing any group-writable ancestor — and withdrew it before commit: `claude` and `codex` are both symlinks on the founder's machine and `/opt/homebrew/bin` is `drwxrwxr-x`, so shipped as specified `capture` would record `sourceAgent: "unknown"` forever and `ingest` would exit 5 on every run. **Resolving instead of refusing is not a loosening of the symlink rule; it is the correct rule** — the kernel executes the resolved target, so that is the file whose ownership decides anything.

**One loosening remains rejected, and the argument survives from the withdrawn attempt: a sticky bit does not make a world-writable directory safe here.** It stops another user deleting or renaming a file they do not own; it does not stop them *creating* one under a name nothing owns yet, which is exactly the planted binary this check exists to refuse. `0o002` is refused with or without `0o1000`.

**Files:**
- Modify: `packages/platform-macos/src/types.ts` — `PlatformAdapter.assertTrustedExecutable`
- Modify: `packages/platform-macos/src/macos.ts` — the implementation, plus `lstat`/`stat`/`currentUid` on `MacOsPlatformAdapterOptions`
- Modify: `apps/cli/src/commands/ingest.ts:449-463` — `selectVendor`
- Modify: `apps/cli/src/commands/capture.ts:229-250` — `discoverSourceAgent`
- Modify: `tests/helpers/temp-home.ts` — see Step 5
- Test: `packages/platform-macos/src/macos.test.ts`, `apps/cli/src/commands/ingest.test.ts`, `apps/cli/src/commands/capture.test.ts`

**Interfaces:**
- Produces: `PlatformAdapter.assertTrustedExecutable(path: string): Promise<void>` — resolves, or throws `MacOsPlatformTrustError`.

- [ ] **Step 1: Write the failing tests**

In `packages/platform-macos/src/macos.test.ts`:

```ts
describe("assertTrustedExecutable", () => {
  it("accepts a symlink whose resolved target and ancestors are the user's", async () => {
    const adapter = adapterWith({
      canonicalize: async () => "/opt/homebrew/bin/claude",
      stat: fakeStat({ "/": ROOT_755, "/opt": USER_755, "/opt/homebrew": USER_775, "/opt/homebrew/bin": USER_775, "/opt/homebrew/bin/claude": USER_755 }),
      currentUid: () => 501,
    });
    await expect(adapter.assertTrustedExecutable("~/.local/bin/claude")).resolves.toBeUndefined();
  });

  it("accepts a group-writable ancestor the user owns, because that is Homebrew", async () => {
    // covered by the case above; asserted separately so the rule cannot be
    // removed without a named failure
    const adapter = adapterWith({ stat: fakeStat({ "/opt/homebrew/bin": USER_775 }), currentUid: () => 501 });
    await expect(adapter.assertTrustedExecutable("/opt/homebrew/bin/claude")).resolves.toBeUndefined();
  });

  it("refuses an other-writable ancestor even when it carries the sticky bit", async () => {
    const adapter = adapterWith({ stat: fakeStat({ "/tmp": USER_1777 }), currentUid: () => 501 });
    await expect(adapter.assertTrustedExecutable("/tmp/bin/claude")).rejects.toThrow(
      MacOsPlatformTrustError,
    );
  });

  it("refuses an ancestor owned by neither the user nor root", async () => {
    const adapter = adapterWith({ stat: fakeStat({ "/opt/other": { uid: 502, mode: 0o755 } }), currentUid: () => 501 });
    await expect(adapter.assertTrustedExecutable("/opt/other/claude")).rejects.toThrow(
      MacOsPlatformTrustError,
    );
  });

  it("checks the resolved target, not the path it was given", async () => {
    const adapter = adapterWith({
      canonicalize: async () => "/tmp/planted/claude",
      stat: fakeStat({ "/tmp": USER_1777 }),
      currentUid: () => 501,
    });
    await expect(adapter.assertTrustedExecutable("/opt/homebrew/bin/claude")).rejects.toThrow(
      MacOsPlatformTrustError,
    );
  });
});
```

In `apps/cli/src/commands/capture.test.ts` and `ingest.test.ts`:

```ts
it("records an unknown source agent when the binary is not trusted", async () => {
  const result = await runCapture(contextWithUntrustedVendor());
  expect(result.data.sourceAgent).toBe("unknown");
});

it("refuses ingest with a security exit code when the binary is not trusted", async () => {
  const result = await runIngest(contextWithUntrustedVendor());
  expect(result.code).toBe(EXIT_CODES.securityRefusal);
});
```

The two commands differ on purpose and each follows the contract it already has: `capture` swallows the refusal and records `unknown` (spec §5.4), while `ingest` refuses **outside** the `catch` at `:459` that would otherwise hide it.

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/platform-macos apps/cli/src/commands/capture.test.ts apps/cli/src/commands/ingest.test.ts`
Expected: FAIL — `assertTrustedExecutable is not a function`, and both command cases return the trusting result.

- [ ] **Step 3: Implement the check at the boundary that made the promise**

The check belongs in `packages/platform-macos` because that is where the contract is written: `types.ts:13-18` says the discovered path is untrusted and "anything that executes it owes that check first". Putting the payment beside the promise means a second executor cannot arrive without meeting it.

Add optional `stat`, `lstat` and `currentUid` to `MacOsPlatformAdapterOptions`, defaulting to `node:fs/promises` and `process.getuid`, so tests drive fakes — the discipline every other dependency in that constructor already follows.

```ts
/**
 * **Resolve first, then check what the kernel will actually execute.** The
 * founder decided this on 2026-08-17 against the alternative of refusing a
 * symlink outright: `claude` and `codex` arrive as symlinks on an ordinary
 * install, and refusing the link refuses the product's own vendors while saying
 * nothing about the file that runs (BACKLOG NEW-15).
 *
 * **Group-writable is accepted when the directory's owner is the current uid,
 * and refused otherwise.** `/opt/homebrew/bin` is `drwxrwxr-x` owned by the
 * installing user, which is how these CLIs ordinarily arrive; a user who owns a
 * directory can write it regardless of its group bit, so refusing it buys
 * nothing and costs every Homebrew installation.
 *
 * **Other-writable is refused with or without the sticky bit.** Sticky stops
 * another user deleting or renaming a file they do not own; it does not stop
 * them creating one under a name nothing owns yet, which is precisely the
 * planted binary this refuses.
 *
 * **The residual is a check-then-use window** of the shape already registered
 * as BACKLOG NEW-20: the target is resolved and checked, then executed by path.
 * Closing it needs an exec-by-descriptor this runtime does not offer. Registered
 * rather than hidden.
 */
async assertTrustedExecutable(path: string): Promise<void>
```

Resolve with `#canonicalize`, then walk the resolved path and every ancestor to `/` with `stat`, refusing on the first component whose `uid` is neither `currentUid()` nor `0`, or whose mode has `0o002` set, or whose mode has `0o020` set while its `uid` is not `currentUid()`.

- [ ] **Step 4: Pay it at both call sites**

`ingest.ts` `selectVendor`: call `await context.platform.assertTrustedExecutable(discovery.executablePath)` **outside** the `try` at `:456-461`. That `catch` maps any throw to "not installed" and would turn a security refusal into a fall-through to the other vendor, which is the opposite of refusing.

`capture.ts` `discoverSourceAgent`: call it inside the existing `try` at `:235`, before `VERSION_PROBES[agent]`. Its `catch` returns `UNKNOWN_SOURCE`, which is what spec §5.4 requires of an undetectable agent, and an untrusted binary is one.

- [ ] **Step 5: Relocate the test harness off `/tmp`**

`tests/helpers/temp-home.ts` sandboxes under `/tmp` on purpose — its docblock records that `os.tmpdir()` paths are long and high-entropy enough that the product's own redactor rewrites them, after which discovery reports nothing. `/tmp` resolves to `/private/tmp`, mode `41777`, so the one e2e case that spawns the real binary goes red on a correct refusal.

Relocate the sandbox to a short, low-entropy directory the test process owns and creates with mode `0o755` — `<repo>/.tmp-home/<n>` — and **replace the redaction-threshold reasoning in that docblock with the new reason**, rather than deleting it. Add `.tmp-home/` to `.gitignore`. A helper whose comment explains a constraint it no longer meets is worse than one with no comment.

- [ ] **Step 6: Run the gate, review, commit**

Run: `npm run check`
Expected: exit 0. The e2e case that spawns the real binary must be green **without** an exemption.

```bash
git add packages/platform-macos/src apps/cli/src/commands/ingest.ts apps/cli/src/commands/capture.ts apps/cli/src/commands/ingest.test.ts apps/cli/src/commands/capture.test.ts tests/helpers/temp-home.ts .gitignore
git commit -m "fix(security): check the resolved executable and its ancestors before running it"
```

---

## Task 6: Foundation — prune a transaction's backups when it finalizes

**Decision (2026-08-17):** implement. This is the one of the three Foundation requests with a live secret in it.

**The defect.** `review --decision edit` exists to remove a secret a user pasted into a vault file by hand. It does — and `TransactionExecutor.backUp` writes the pre-edit file, raw, to `~/.developer-os/backups/transactions/<id>/0.bin` at mode `0600` (`executor.ts:449-467`), where nothing ever removes it. **This is a missing prune, not an inherent cost:** `rollbackLocked` throws on a finalized journal (`executor.ts:280`), so once `finalize` runs those bytes can never be read by this product again.

**Files:**
- Modify: `packages/core/src/transactions/executor.ts:262-266` (the `verified → finalized` transition), and `backupDirectory` if a helper is wanted
- Test: `packages/core/src/transactions/transactions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("removes the backup directory when a transaction finalizes", async () => {
  const executor = realExecutor();
  const journal = await executor.execute(planWritingOver("secret.md"));
  expect(journal.phase).toBe("finalized");
  await expect(stat(backupDirectoryFor(journal.id))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps the backup while the transaction can still roll back", async () => {
  const executor = realExecutor();
  const journal = await executor.executeToPhase(planWritingOver("secret.md"), "applied");
  await expect(stat(backupDirectoryFor(journal.id))).resolves.toBeDefined();
});

it("still refuses to roll back a finalized transaction", async () => {
  const executor = realExecutor();
  const journal = await executor.execute(planWritingOver("secret.md"));
  await expect(executor.rollback(journal.id)).rejects.toThrow(TransactionStateError);
});
```

Use the **real** lock-materializing provider, not the fake. A prior test in this file asserted the journal held exactly `['tx-0001.json']` and thereby pinned a fake provider's zero-artifact behaviour instead of the side effect under test; that is the mistake to avoid here, and it is recorded in this project's own notes.

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/core/src/transactions/transactions.test.ts`
Expected: the first FAILs — `stat` resolves, because the directory is still there. **The second and third must pass on first run**: they pin that the prune happens at `finalized` and nowhere earlier, and that rollback's refusal is unchanged.

- [ ] **Step 3: Prune in the `finalized` transition**

In `resumeLocked`'s `case "verified"`, after `verifyDesired` and before or after `transition(journal, "finalized")` — after, so a crash between them leaves the backup rather than losing it:

```ts
case "verified":
  await this.verifyDesired(journal);
  journal = await this.transition(journal, "finalized");
  /**
   * **The backup is dead bytes from this line onward, and one of them may be a
   * secret.** `rollbackLocked` throws on a finalized journal, so nothing in this
   * product can ever read these again — while `review --decision edit` exists
   * precisely to remove a secret a user pasted into a vault file by hand, and
   * `backUp` wrote that file here raw at mode 0600 before the edit landed.
   * Retaining it would undo the one operation whose whole purpose is removal.
   *
   * **After the transition, never before.** A crash between the two leaves an
   * unreadable backup on disk, which costs nothing; the reverse order would
   * lose the backup of a transaction that had not yet committed to being
   * unrollbackable.
   *
   * Failure to remove is swallowed deliberately: a finalized transaction
   * succeeded, and a leftover directory is a housekeeping problem rather than a
   * reason to report the user's write as failed. `doctor` is where a leftover
   * surfaces.
   */
  await this.pruneBackups(journal.id);
  break;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm vitest run packages/core tests/security`
Expected: PASS. `tests/security/`'s interruption suites exercise every phase and are the ones most likely to notice a prune placed one transition too early.

- [ ] **Step 5: Run the gate, review, commit**

Run: `npm run check`

```bash
git add packages/core/src/transactions/executor.ts packages/core/src/transactions/transactions.test.ts
git commit -m "fix(core): prune a transaction's backups once it can no longer roll back"
```

---

## Task 7: Foundation — a `data` slot on the failure arm

**Decision (2026-08-17):** implement.

**The defect.** `CliResult`'s failure arm has no `data` slot (`packages/core/src/result.ts:29-33`), so a command that partly succeeded cannot report machine-readably what moved. `ingest` processes a batch and contains each capture's refusal to that capture; when any refuses, the run ends on the failure arm and the per-capture outcomes ship as lines inside `error.message`. A consumer parses prose where it should read fields.

**It changes no existing caller**, because nothing populates a field that does not exist yet.

**Files:**
- Modify: `packages/core/src/result.ts:14-19` (`CliError`), `:46-56` (`failure`)
- Modify: `apps/cli/src/commands/ingest.ts` — populate it where the per-capture outcomes are assembled
- Test: `packages/core/src/result.test.ts`, `apps/cli/src/commands/ingest.test.ts`

**Interfaces:**
- Produces: `CliError.data?: unknown` and `failure(code, error)` unchanged in arity.

- [ ] **Step 1: Write the failing tests**

```ts
it("carries structured detail on the failure arm", () => {
  const result = failure(EXIT_CODES.operationalFailure, {
    kind: "partial",
    message: "one capture refused",
    paths: [],
    data: { ingested: ["cap-a"], refused: ["cap-b"] },
  });
  expect(result.ok).toBe(false);
  expect(JSON.parse(formatJsonResult(result)).error.data.refused).toEqual(["cap-b"]);
});
```

In `ingest.test.ts`:

```ts
it("reports per-capture outcomes as fields rather than as lines in a message", async () => {
  const result = await runIngest(contextWithOneRefusingCapture());
  expect(result.ok).toBe(false);
  expect(result.error.data).toMatchObject({
    ingested: expect.arrayContaining([expect.any(String)]),
    refused: expect.arrayContaining([expect.any(String)]),
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/core/src/result.test.ts apps/cli/src/commands/ingest.test.ts`
Expected: FAIL — `data` is not assignable to `CliError`, and `result.error.data` is `undefined`.

- [ ] **Step 3: Add the slot**

```ts
export interface CliError {
  readonly kind: string;
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
  /**
   * **What moved before the run failed, as fields.** A command that processes a
   * batch and refuses one member is neither wholly successful nor wholly
   * failed: `ingest` contains each capture's refusal to that capture, and
   * without this the per-capture outcomes shipped as lines inside `message`,
   * where a consumer had to parse prose (BACKLOG, Foundation request 3).
   *
   * **Redacted before it is set, like everything else this product prints.**
   * The failure arm is serialized into `--json`, so this field is a publishing
   * surface and not a debugging one; a value that has not been through the
   * redactor does not belong here.
   *
   * Optional, so no existing caller changes — nothing populates a field that
   * does not exist yet, which is what made this safe to add to a frozen type.
   */
  readonly data?: unknown;
}
```

In `ingest.ts`, populate it where the per-capture outcome lines are built today, keeping the human-readable `message` exactly as it is: the field is added beside the prose, not instead of it, because the prose is what a person reads.

- [ ] **Step 4: Run the tests, the gate, review, commit**

Run: `pnpm vitest run packages/core apps/cli` then `npm run check`

```bash
git add packages/core/src/result.ts packages/core/src/result.test.ts apps/cli/src/commands/ingest.ts apps/cli/src/commands/ingest.test.ts
git commit -m "feat(core): let a partly-succeeded run report what moved as fields"
```

---

## Task 8: Foundation — a caller-supplied precondition

**Decision (2026-08-17):** implement. The largest of the three.

**The defect.** `PlannedFileMutation` is `{targetPath, operation, content}`; the executor computes `expectedBeforeHash` from the snapshot it takes when `execute()` runs. Two consequences, found a task apart. **`capture`:** spec §5.2 says a duplicate "is an `O_EXCL` create that fails", and no transaction-mediated write can deliver that — tolerable there, because the id is the content hash and colliding captures are byte-identical. **`review --decision edit`:** the same missing precondition leaves a read-to-execute window, and here the loss is **not** benign — the discarded content is the user's own hand edit, in the verb that exists to bring a hand edit back under the product's guarantees.

**Files:**
- Modify: `packages/core/src/transactions/types.ts` — `PlannedFileMutation.expectedBeforeHash?`
- Modify: `packages/core/src/transactions/executor.ts` — honour it in `backUp`/`validate`
- Modify: `apps/cli/src/commands/review.ts` — supply it on the `edit` path
- Test: `packages/core/src/transactions/transactions.test.ts`, `apps/cli/src/commands/review.test.ts`

**Interfaces:**
- Consumes: Task 6's pruned `finalized` transition — same file, so Task 6 lands first.
- Produces: `PlannedFileMutation.expectedBeforeHash?: string` — when present, the executor refuses rather than computing its own.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses when the file changed between the caller's read and the execute", async () => {
  const executor = realExecutor();
  const plan = planWith({ targetPath: "note.md", expectedBeforeHash: hashOf("as read") });
  await writeFile(targetOf("note.md"), "changed by someone else");
  await expect(executor.execute(plan)).rejects.toThrow(TransactionPreconditionError);
});

it("computes its own hash when the caller supplies none, unchanged", async () => {
  const executor = realExecutor();
  await expect(executor.execute(planWith({ targetPath: "note.md" }))).resolves.toMatchObject({
    phase: "finalized",
  });
});

it("does not discard a hand edit made while review was reading", async () => {
  const result = await runReviewEdit(contextWhereFileChangesAfterRead());
  expect(result.ok).toBe(false);
  expect(result.code).toBe(EXIT_CODES.recoveryRequired);
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/core/src/transactions apps/cli/src/commands/review.test.ts`
Expected: the first and third FAIL — the execute resolves and the hand edit is overwritten. **The second must pass on first run**: it is what proves the precondition is additive and that `capture`, which supplies none, is untouched.

- [ ] **Step 3: Add the optional precondition**

```ts
/**
 * **A precondition the caller read, not one the executor computed.** Without
 * this the executor snapshots the file when `execute()` runs, so everything
 * between a caller's read and that snapshot is invisible — and
 * `review --decision edit` reads the file, re-redacts it, and writes it back.
 * The content that window discards is the user's own hand edit, in the one verb
 * that exists to bring a hand edit under this product's guarantees (BACKLOG,
 * Foundation request 1).
 *
 * **Optional, and absence keeps the previous behaviour exactly.** `capture`
 * supplies none and wants none: spec §5.2 calls a duplicate an `O_EXCL` create
 * that fails, which no transaction-mediated write delivers, and the residual is
 * benign there because the id is the content hash and colliding captures are
 * byte-identical.
 */
readonly expectedBeforeHash?: string;
```

Honour it in the phase that takes the snapshot: when present and the observed hash differs, throw `TransactionPreconditionError` **before** any mutation is staged. A missing file with a supplied hash is a mismatch, not an absent precondition.

- [ ] **Step 4: Supply it from the edit path**

In `review.ts`, hash the bytes the edit path actually read and pass them as `expectedBeforeHash` on the planned mutation. Map the refusal to `EXIT_CODES.recoveryRequired` with a recovery string that tells the user their file changed and the edit was not applied — the outcome the window used to produce silently.

- [ ] **Step 5: Run the tests, the gate, review, commit**

Run: `pnpm vitest run packages/core apps/cli tests/security` then `npm run check`

```bash
git add packages/core/src/transactions apps/cli/src/commands/review.ts apps/cli/src/commands/review.test.ts
git commit -m "feat(core): let a caller supply the precondition its own read established"
```

---

## Task 9: the `accepted → rejected` transition

**Decision (2026-08-17):** add the transition. Amend spec §5.5's table and widen `applyReviewDecision`'s reviewable set.

**The defect.** `applyReviewDecision` permits a decision only from `quarantined` (`packages/brain/src/review/decide.ts:36`), so nothing moves a capture from `accepted` to `rejected`. A user who accepts a capture and then changes their mind — or whose capture refuses ingest deterministically — has only a hand edit of the file's frontmatter, which is what both of `ingest`'s recovery strings now tell them to do. The product recommending a hand edit of its own data is the gap.

**`CAPTURE_STATUSES` is frozen and gains no member.** This adds a row to a transition table, not a seventh status.

**Files:**
- Modify: `packages/brain/src/review/decide.ts:30-48, 71-80`
- Modify: `apps/cli/src/commands/ingest.ts` — the two recovery strings that recommend a hand edit
- Modify: `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md` §5.5 — a dated in-place amendment
- Modify: `docs/superpowers/BACKLOG.md` §8 — the amendment row
- Test: `packages/brain/src/review/decide.test.ts`, `apps/cli/src/commands/review.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("rejects a capture the user already accepted", () => {
  const outcome = applyReviewDecision({ ...envelope, status: "accepted" }, "reject");
  expect(outcome).toEqual({ ok: true, envelope: { ...envelope, status: "rejected" } });
});

it("does not let accept re-run on an accepted capture", () => {
  expect(applyReviewDecision({ ...envelope, status: "accepted" }, "accept")).toEqual({
    ok: false,
    reason: "illegal-transition",
  });
});

it("does not let edit re-run on an accepted capture", () => {
  expect(applyReviewDecision({ ...envelope, status: "accepted" }, "edit")).toEqual({
    ok: false,
    reason: "illegal-transition",
  });
});

it("leaves every other status terminal", () => {
  for (const status of ["rejected", "staging", "ingested", "failed"] as const) {
    expect(applyReviewDecision({ ...envelope, status }, "reject")).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  }
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run packages/brain/src/review/decide.test.ts`
Expected: the first FAILs with `illegal-transition`. **The other three must pass on first run** — they are the boundary, and a change that makes any of them go red has widened the table past what was decided.

- [ ] **Step 3: Make the reviewable set depend on the decision**

Replace the single `REVIEWABLE` constant with a per-decision table, so the widening is exactly one cell:

```ts
/**
 * The statuses each decision is legal from. **`reject` has two rows and the
 * other two have one**, decided by the founder on 2026-08-17: a user who
 * accepts a capture and then changes their mind — or whose capture refuses
 * ingest deterministically — previously had only a hand edit of the file's
 * frontmatter, which is what both of `ingest`'s recovery strings told them to
 * do. A product recommending a hand edit of its own data is the gap this row
 * closes.
 *
 * **`accept` and `edit` deliberately do not gain the second row.** Re-accepting
 * an accepted capture is a no-op that would make the verb's success message
 * lie, and `edit` re-redacts the file — running it after `accepted` would
 * re-open content the pipeline has already selected, in a status `ingest` polls.
 * Rejection is the only direction that is safe from `accepted`, because
 * `rejected` is terminal for automation and no later phase reads it.
 *
 * Amends spec §5.5's transition table; BACKLOG §8 carries the row.
 */
const LEGAL_FROM: Readonly<Record<ReviewDecision, readonly CaptureStatus[]>> =
  Object.freeze({
    accept: ["quarantined"],
    reject: ["quarantined", "accepted"],
    edit: ["quarantined"],
  });
```

`applyReviewDecision` tests membership in `LEGAL_FROM[decision]`. `DECIDED` is unchanged — `edit` still maps to `quarantined`, because no status means "edited" and `CAPTURE_STATUSES` gains no seventh member.

- [ ] **Step 4: Retire the recovery strings that recommend a hand edit**

In `ingest.ts`, replace both recovery strings that tell a user to hand-edit frontmatter with `developer-os review --decision reject <id>`. Those strings are the reason this gap was visible; leaving them would leave the product recommending the worse of two paths it now offers.

- [ ] **Step 5: Amend the spec and register it**

Add a dated amendment to knowledge-pipeline spec §5.5 recording the new row and the two that were deliberately not added, and a `BACKLOG.md` §8 row cross-referencing it. Both in this commit.

- [ ] **Step 6: Run the gate, review, commit**

Run: `npm run check`

```bash
git add packages/brain/src/review apps/cli/src/commands/ingest.ts apps/cli/src/commands/review.test.ts docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md docs/superpowers/BACKLOG.md
git commit -m "feat(brain): let a user reject a capture they already accepted"
```

---

## Task 10: Close R2

**Files:**
- Modify: `docs/superpowers/BACKLOG.md` §1 — remove the five closed rows; §0 summary table
- Modify: `docs/superpowers/ORDER.md` — the Track R row, the "Open on the product path" section, the counting section
- Delete: this plan

- [ ] **Step 1: Remove what closed, and carry forward what did not**

Remove NEW-11, NEW-12, NEW-15, NEW-16 and NEW-22 from `BACKLOG.md` §1 — closed rows leave a §8 row, a spec clause or a test, never a row here. **Four rows survive and must not be swept up with them:** NEW-21 (the founder's, blocks A10), NEW-20 and NEW-13 (registered as deliberately not fixed), and NEW-7 (needs a machine with Obsidian).

Register the two residuals this work created rather than closed:
- Task 5's check-then-use window on the resolved executable, as a clause on **NEW-20**, whose shape it shares.
- Task 2's `[redaction]` schema amendment and Task 9's §5.5 amendment stay in §8 until a founder ratifies them.

- [ ] **Step 2: Update `ORDER.md`**

Track R gains the R2 row as `done` with its date. The "Four Foundation requests" section loses items 1 to 3 and keeps item 4, the two open founder questions, which nothing here answered. The "One product gap that is DOS-P7's" section goes — Task 9 closed it. The counting section is recounted **by reading the files**, which is the discipline that section imposes on itself.

Delete the sentence "Nothing on this queue is startable by an agent today." It was true on 2026-08-17 morning and this plan is the reason it stopped being true.

- [ ] **Step 3: Delete this plan**

Finished plans get deleted, not archived, in the commit that closes them. Everything a later reader needs is in the nine commit messages, the amended specs and the surviving `BACKLOG.md` rows.

- [ ] **Step 4: Run the gate, commit, open the pull request**

```bash
npm run check
git add docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md
git rm docs/superpowers/plans/2026-08-17-repository-defects-r2.md
git commit -m "docs: close Track R entry R2"
git push -u origin <topic-branch>
gh pr create --fill
gh pr checks <n>
```

**CI green on the commit is the fifth gate and it is not optional.** A red run nobody reads is worse than the no CI it replaced. Merging stays the founder's.
