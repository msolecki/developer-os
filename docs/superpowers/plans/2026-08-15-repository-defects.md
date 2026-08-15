# Repository defects — the four with no open question

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four `BACKLOG.md` §1 rows whose fix is already specified and which take no
decision away from the founder — NEW-18, NEW-17, NEW-19 and NEW-15 — and correct one stale count in
`ORDER.md`.

**Architecture:** Four independent defects, four commits, one closing commit. Nothing here is a
subsystem, so this plan has no spec: **`BACKLOG.md` §1 is the specification**, row by row, and each
task quotes the row it discharges. Two of the four are security fixes (NEW-17, NEW-19) and one is a
security fix plus a new shared guard (NEW-15); NEW-18 is missing evidence for a guard that is already
correct.

**Tech Stack:** TypeScript strict, Vitest, pnpm workspaces. `npm run check` = `tsc -b` + `eslint` +
the self-containment enumerator + tests + build + `git diff --check`.

**Spec:** `docs/superpowers/BACKLOG.md` §1, rows NEW-15, NEW-17, NEW-18 and NEW-19. Read the row
before the task that discharges it; each row carries reasoning this plan does not repeat.

---

## Global Constraints

Every task's requirements implicitly include all of these.

- **`npm run check` before every commit.** Show failures only. It runs nearer four minutes than
  three since `fileParallelism: false` landed; that is expected, not a hang.
- **Fresh-context review per code-producing task.** Reviewer ≠ author, review only — no edits, no
  commits. After it returns, run `git status --short` and `git diff` to prove it did not touch the
  tree.
- **Exact-path staging.** `git add <exact paths>`. Never `git add -A`, never a wildcard. Then
  `git show --stat HEAD` and confirm it holds only what the task meant to ship.
- **Test-first.** Every test in this plan must be watched fail, for the stated reason, before its
  fix exists. A test that passes on first run has pinned nothing. A test pins the **contract**, not
  current behavior.
- **No literal control bytes in any file.** `tests/repository/control-bytes.test.ts` fails the build
  on a literal control character in any tracked *or untracked* text file. Task 1 is about NUL bytes
  and must write them as the escape `"\u0000"`, which is six source characters and not a control
  byte. **Writing a real NUL into the test source turns a green suite red at the repository gate,
  not at the case under test**, which is a confusing failure to debug. **This already happened once,
  to this plan**: its first draft carried three real NUL bytes in the Task 1 code block, which made
  `grep` report the plan as a binary file and would have failed `npm run check` on the plan itself.
  They were replaced with the escape before anything was committed.
- **Never read the founder's legacy runtime.** `SESSION.md`'s hard rules name the three path classes;
  this plan deliberately does not repeat them, because the self-containment enumerator in
  `npm run lint` fails on any reference to them outside its allowlist and **this plan is not on that
  allowlist**. The first draft of this very line named all three and failed the gate at
  `tests/dist/repository/check.js`, which is the enumerator doing its job. Rule of thumb while
  writing here: the enumerator also matches `home`/`userHome`/`homedir()` followed within forty
  characters by a quoted `brain`, so a test snippet that names its fixture `home` and then passes
  `"brain"` as an argument trips it. **The security suites name their fixture `fixture`**, which is
  one of the reasons to copy their conventions rather than invent names.
- **This repository is public.** No real client name, no real vault path, no real credential. All
  fixtures synthetic.
- **A plan step that turns out to be wrong rather than merely hard stops and says so.** These four
  rows were written by reviewers reading the code, not by anyone driving it. If a row's premise does
  not hold against the tree, that is information: record it and stop, do not implement a better idea.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `packages/security/src/process.test.ts` | 1 | gains four NUL cases for `assertSafeCommand` |
| `apps/cli/src/commands/brain.ts` | 2 | `readConfig` routes through `readConfigFile` so a TOML parse failure quotes nothing |
| `tests/e2e/foundation.test.ts` | 2 | its content-free-refusal case gains the `brain` command |
| `packages/security/src/executable-trust.ts` | 4 | **new** — `assertTrustedExecutable`, the owner-and-mode check `PlatformAdapter`'s type says an executor owes |
| `packages/security/src/executable-trust.test.ts` | 4 | **new** — its cases |
| `packages/security/src/index.ts` | 4 | exports the new guard |
| `apps/cli/src/context.ts` | 3, 4 | `resolveQuarantineRoot` generalized to `resolveContainedRoot` (3); the trust check reaches commands (4) |
| `apps/cli/src/commands/reindex.ts` | 3 | `writeIndexArtifacts` anchors its owned root on the vault root |
| `apps/cli/src/commands/ingest.ts` | 4 | `selectVendor` pays the check and lets a refusal propagate |
| `apps/cli/src/commands/capture.ts` | 4 | `discoverSourceAgent` pays the check and records `unknown` on refusal |
| `tests/security/symlink-escape.test.ts` | 3 | gains the relocated-`_indexes` case |
| `docs/superpowers/BACKLOG.md`, `ORDER.md` | 5 | the four rows close; the stale count is corrected |

---

### Task 1: NEW-18 — `assertSafeCommand`'s four NUL branches get their evidence

**Complexity:** XS

**The row:** `BACKLOG.md` §1 NEW-18. `assertSafeCommand` refuses a NUL byte in the executable, the
working directory, any argument and stdin (`packages/security/src/process.ts:46-61`). **No test in
this repository exercises any of the four.** The guard is correct; only the evidence is missing.

Found because `docs/architecture/threat-model.md` tried to cite the coverage and a reviewer checked
whether it existed. This task adds the citation's subject.

**Files:**
- Modify: `packages/security/src/process.test.ts` — inside the existing `describe("assertSafeCommand")` block, which ends at the `foreignPlatformExecutable` case
- Test: the same file

**Interfaces:**
- Consumes: `assertSafeCommand(request: ProcessRequest): void` and the file's existing
  `createRequest(overrides: Partial<ProcessRequest>): ProcessRequest` helper, which defaults
  `executable` to `process.execPath`, `cwd` to `tmpdir()`, `args` to `[]` and `stdin` to `""`.
- Produces: nothing. No other task depends on this one.

**The two messages are different and the cases must not blur them.** The executable branch raises
`"Process executable must be an absolute path without NUL bytes"`; the other three raise
`"Process request contains a NUL byte"`. Asserting only the exit code would let the executable case
pass while actually failing the *absoluteness* half of the same `if`, which is already covered by the
`foreignPlatformExecutable` case. **Assert the message, or this task proves nothing new.**

- [ ] **Step 1: Write the four failing cases**

Append inside `describe("assertSafeCommand", …)`, before its closing `});`:

```ts
  const nul = "\u0000";

  it("refuses a NUL byte in the executable, by the executable's own message", () => {
    const request = createRequest({
      executable: `${process.execPath}${nul}`,
    });

    expect(() => {
      assertSafeCommand(request);
    }).toThrowError(/absolute path without NUL bytes/u);
  });

  it("refuses a NUL byte in the working directory", () => {
    const request = createRequest({ cwd: `${tmpdir()}${nul}` });

    expect(() => {
      assertSafeCommand(request);
    }).toThrowError(/request contains a NUL byte/u);
  });

  it("refuses a NUL byte in any argument, not only the first", () => {
    const request = createRequest({ args: ["--version", `value${nul}`] });

    expect(() => {
      assertSafeCommand(request);
    }).toThrowError(/request contains a NUL byte/u);
  });

  it("refuses a NUL byte in stdin", () => {
    const request = createRequest({ stdin: `body${nul}` });

    expect(() => {
      assertSafeCommand(request);
    }).toThrowError(/request contains a NUL byte/u);
  });
```

The third case puts the NUL in the **second** argument on purpose: `request.args.some(containsNul)`
is the branch under test, and a NUL in `args[0]` would also pass a hypothetical implementation that
only ever looked at the head.

- [ ] **Step 2: Watch them fail for the stated reason**

Temporarily neutralize the guard to prove the cases are load-bearing rather than tautological — this
is the watched-failure the Global Constraints require, and it is reverted in Step 3:

```bash
# in packages/security/src/process.ts, temporarily change
#   function containsNul(value: string): boolean { return value.includes("\u0000"); }
# to
#   function containsNul(value: string): boolean { return false; }
npx vitest run --root packages/security src/process.test.ts -t "NUL"
```

Expected: **all four red, each with "expected function to throw".** `process.execPath` and
`tmpdir()` are both absolute and neither is `curl` or `wget`, so with `containsNul` neutered
`assertSafeCommand` reaches its final `return` and throws nothing at all. That is the right red: it
says the NUL branch is the only thing standing in each of the four cases.

**Record which line was disabled and restore it in the same session.** This repository records
thirteen such reverts for `tests/security/`; a disabled guard left behind is the worst outcome this
step can have.

- [ ] **Step 3: Restore the guard and watch them pass**

```bash
git diff packages/security/src/process.ts   # must be empty — the neutering is reverted
npx vitest run --root packages/security src/process.test.ts
```

Expected: green, including the two pre-existing `assertSafeCommand` cases.

- [ ] **Step 4: Gates, fresh-context review, commit**

```bash
npm run check
```

Then dispatch a reviewer that did not write the cases, giving it: this task's text, the file list,
and instructions to review only. Ask it specifically whether any of the four cases would still pass
against a `containsNul` that returned `false`, because that is the failure mode a test like this
has.

```bash
git add packages/security/src/process.test.ts
git commit -m "test(security): drive assertSafeCommand's four NUL branches"
git show --stat HEAD
```

**Test:** `npx vitest run --root packages/security src/process.test.ts` is green, and was red for
all four cases with `containsNul` neutered.

---

### Task 2: NEW-17 — `brain`'s config parse failure stops quoting the file

**Complexity:** XS · **Security**

**The row:** `BACKLOG.md` §1 NEW-17. Seven of the eight commands route their config read through
`readConfigFile` (`apps/cli/src/commands/doctor.ts:209`), which catches the parse error and raises a
`ConfigurationError` quoting nothing. **`brain` does not**: `apps/cli/src/commands/brain.ts:109`
calls `loadConfig(serialized)` outside any `try`, the `TomlError` is not a `BrainRefusal`, and it
falls through to `failureFrom`, which emits `context.guards.redactDiagnostic(error.message)` — and
smol-toml puts **three raw source lines** of the file into that message.

So a hand-edited `config.toml` containing a secret is echoed back on a `brain` run, with the
heuristic redactor as the only thing standing. That is the one place in this product where redaction
is the sole defence rather than the last of several.

**Files:**
- Modify: `apps/cli/src/commands/brain.ts` — the `readConfig` function at `:97-110`
- Modify: `tests/e2e/foundation.test.ts` — the `it("never quotes the configuration it failed to parse")` case at `:1250`
- Test: `tests/e2e/foundation.test.ts`

**Interfaces:**
- Consumes: `readConfigFile(context: CliContext, configFile: string): Promise<DeveloperOsConfigV1 | null>`,
  exported from `./doctor.js`. It returns `null` when the file is **absent** and throws
  `ConfigurationError` when it is present and unparseable.
- Produces: nothing. No other task depends on this one.

**`brain`'s two refusals must stay distinguishable, and this is the whole difficulty of the task.**
`readConfig` today conflates them: any failure to *read* becomes
`"Developer OS is not initialized, so there is no Brain to work with"` with recovery
`developer-os init`. `readConfigFile` splits them for us — `null` is absence, a throw is a present
but unparseable file. **Absence must keep the existing message and the existing exit code**, because
`developer-os init` is the right recovery for it and is wrong for a corrupt file.

- [ ] **Step 1: Write the failing test**

Extend the existing case at `tests/e2e/foundation.test.ts:1250`. Its loop currently drives `status`
and `doctor`; add the two `brain` forms. `brain` requires a subcommand, and `status` is the one that
does not mutate:

```ts
      for (const args of [
        ["status", "--json"],
        ["doctor", "--json"],
        ["status"],
        ["doctor"],
        ["brain", "status", "--json"],
        ["brain", "status"],
      ]) {
```

The case's existing body already asserts what matters for each: the run did not time out, the
sentinel is absent from `stdout + stderr`, and the output was non-empty — the positive control that
keeps "the sentinel is absent" from being a statement about silence.

**Do not add a second case.** The contract is "no command quotes the configuration it failed to
parse", and one case that enumerates the commands is what keeps the next command added from
inheriting the gap. A separate `brain`-only case would leave the enumeration looking complete.

- [ ] **Step 2: Watch it fail**

```bash
npx vitest run --root tests e2e/foundation.test.ts -t "never quotes the configuration"
```

Expected: **red on the two new `brain` entries**, with the sentinel present in the output because
smol-toml's `TomlError` carried three source lines of the file through `redactDiagnostic`. The four
pre-existing entries stay green.

**If it passes, stop.** That would mean either the heuristic redactor happened to catch this
particular sentinel — in which case change the sentinel to something no redaction class matches and
try again, because the row's claim is about the *mechanism*, not this string — or the row's premise
is wrong, which is a finding to record rather than route around.

- [ ] **Step 3: Route the read through `readConfigFile`**

In `apps/cli/src/commands/brain.ts`, replace `readConfig` (`:97-110`) with:

```ts
async function readConfig(context: CliContext): Promise<DeveloperOsConfigV1> {
  const notInitialized = new BrainRefusal(
    EXIT_CODES.invalidInput,
    "Developer OS is not initialized, so there is no Brain to work with",
    [context.paths.configFile],
    "developer-os init",
  );

  let config: DeveloperOsConfigV1 | null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw notInitialized;
  }

  if (config === null) throw notInitialized;
  return config;
}
```

`ConfigurationError` is rethrown rather than folded into `notInitialized` for the reason
`readConfigFile`'s own docblock gives: absence and corruption want different recovery text, and
telling a user with a corrupt `config.toml` to run `init` sends them at a command that refuses on
drift. Every other failure — an unreadable file, a protected-path refusal — keeps `brain`'s existing
answer, which is the behaviour this task must not change.

Add the imports the new body needs:

```ts
import { ConfigurationError } from "../errors.js";   // confirm the real module before writing this
import { readConfigFile } from "./doctor.js";
```

**Confirm where `ConfigurationError` actually lives** with
`grep -rn "class ConfigurationError" apps/cli/src` before writing the import — this plan names the
symbol, not its file, because the file is not something this plan verified.

Delete the now-unused `loadConfig` import if nothing else in `brain.ts` uses it; `tsc -b` and
`eslint` will both say so.

- [ ] **Step 4: Watch it pass, and watch the absence path stay put**

```bash
npx vitest run --root tests e2e/foundation.test.ts
npx vitest run --root apps/cli src/commands/brain.test.ts
```

Expected: green. **The second command is the one that matters** — it holds `brain`'s own
uninitialized-machine cases, and the split above is exactly where they would break.

- [ ] **Step 5: Gates, fresh-context review, commit**

```bash
npm run check
```

Reviewer question to ask explicitly: **does an unreadable-but-present `config.toml` still produce
the uninitialized message, and does a *missing* one?** The `null`-versus-throw split is where this
change can silently swap two user-facing recoveries.

```bash
git add apps/cli/src/commands/brain.ts tests/e2e/foundation.test.ts
git commit -m "fix(cli): stop brain quoting the configuration it failed to parse"
git show --stat HEAD
```

**Test:** the extended `foundation.test.ts` case is green over all six command forms, and was red on
the two `brain` forms before the fix.

---

### Task 3: NEW-19 — `reindex` stops building its owned root textually

**Complexity:** XS · **Security**

**The row:** `BACKLOG.md` §1 NEW-19. `writeIndexArtifacts` passes
`ownedRoots: [join(vaultRoot, indexesDir)]` (`apps/cli/src/commands/reindex.ts:283`) — built from
strings, never proven to resolve inside the vault. **It is the same shape `capture.ts:579` had**, and
the same three checks miss it for the same reasons: `assertUsableRoots` refuses a root that *grew*
authority or sits in `excludedRoots` and **permits a sideways relocation on purpose**
(`packages/core/src/plans/validate.ts:186-206`); `ProtectedPathPolicy` returns early outside `$HOME`;
nothing else on that path asks where the directory resolves.

Replace `content/_indexes` with a link out of the vault and `brain reindex` — and `ingest`'s third
transaction — write `index.json`, `catalog.md`, `tags.md` and `topics.md` there. Derived rather than
raw, but they carry every note's title, path, summary and tags: vault-metadata disclosure into an
attacker-chosen directory.

**The row says how to fix it and the instruction is load-bearing:** `resolveQuarantineRoot`
(`apps/cli/src/context.ts:263-305`) is the same check one directory over. **"Generalize its name when
the second caller shape appears rather than copying it."** The second caller shape is this task.

**Files:**
- Modify: `apps/cli/src/context.ts` — `resolveQuarantineRoot` at `:263-305`
- Modify: `apps/cli/src/commands/reindex.ts` — `writeIndexArtifacts` at `:270-287`
- Modify: `apps/cli/src/commands/capture.ts`, `ingest.ts`, `review.ts` — the three existing callers, for the rename only
- Test: `tests/security/symlink-escape.test.ts`

**Interfaces:**
- Consumes: `containsPath`, `context.guards.canonicalize`, and the injected
  `refuse(message, paths) => Error` convention the existing function documents.
- Produces:
  ```ts
  export async function resolveContainedRoot(
    context: CliContext,
    containerRoot: string,
    candidate: string,
    what: string,
    refuse: (message: string, paths: readonly string[]) => Error,
  ): Promise<string>
  ```
  Task 4 does not use it. No later task depends on this one.

**The generalization is a rename plus one parameter, and nothing else.** The existing body is
already general — it canonicalizes both sides and asks `containsPath`. What is specific is the
refusal *string*, `"the quarantine directory resolves outside the content root"`. The new `what`
parameter carries it: `resolveContainedRoot(…, "the quarantine directory", refuse)` produces
`"the quarantine directory resolves outside the content root"` **only if the message template also
stops naming the content root specifically**. Use:

```ts
throw refuse(`${what} resolves outside ${describeContainer}`, [candidate]);
```

— which needs a sixth parameter, or a single pre-composed message. **Take the simpler option: pass
one `refusalMessage: string` rather than a `what` fragment**, so each caller owns its own sentence
and no template has to be right for both. The three existing callers then pass
`"the quarantine directory resolves outside the content root"` verbatim and their messages do not
change by a byte, which is what keeps their tests green.

Final signature:

```ts
export async function resolveContainedRoot(
  context: CliContext,
  containerRoot: string,
  candidate: string,
  refusalMessage: string,
  refuse: (message: string, paths: readonly string[]) => Error,
): Promise<string>
```

**Keep the existing docblock and amend it** rather than rewriting: it records why `refuse` is
injected, what `assertUsableRoots` and `ProtectedPathPolicy` each miss, and that this arrived as two
copies plus one command with no check at all. Add one paragraph naming `reindex` as the fourth
caller and NEW-19 as what it closes.

- [ ] **Step 1: Write the failing security case**

In `tests/security/symlink-escape.test.ts`, in a new `describe` beside the existing quarantine ones.
**Drive `ingest` rather than `brain reindex`**: the row names *"`brain reindex` — and `ingest`'s
third transaction"* as the two writers, `ingest` is the one this suite already has a helper for, and
a case built on `installSecurityFixture` needs no CLI process and no second fixture shape.

```ts
describe("a symlink out of the index root", () => {
  it("refuses to write index artifacts through a relocated _indexes directory", async () => {
    const fixture = await installSecurityFixture("symlink-indexes");
    const outside = join(fixture.root, "outside-indexes");
    await mkdir(outside, { recursive: true, mode: 0o700 });

    const indexes = join(fixture.content, "_indexes");
    await rm(indexes, { recursive: true, force: true });
    await symlink(outside, indexes);

    const seeded = await fixture.seedAccepted("an observation about the index root");
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/note.md", "An ordinary note"));

    const result = await fixture.ingest();

    expect(result.ok).toBe(false);
    expect(await filesUnder(outside)).toStrictEqual([]);
  });
});
```

**The second assertion is the one that matters.** A refusal alone would also be satisfied by `ingest`
failing for an unrelated reason; an empty `outside-indexes` is what says nothing was written outside
the vault. `filesUnder` and `oneNote` are already imported at the top of that file; `installSecurityFixture`
and `removeSecurityFixtures` are too, and the file's single `afterEach(removeSecurityFixtures)` covers
a new `describe` without any further wiring.

**Read the top of that file and copy its conventions exactly.** The names above were checked against
it, but the suite is the authority and it has changed under four fix rounds this week.

- [ ] **Step 2: Watch it fail**

```bash
npx vitest run --root tests security/symlink-escape.test.ts -t "relocated _indexes"
```

Expected: **red**, with `ingest` succeeding and the four artifacts sitting in `outside-indexes/`.
That is the disclosure the row describes, driven rather than read — which the row explicitly says
nobody has done: *"Traced by reading, not driven. No test was written, so nobody should treat this
row as demonstrated."* This step is what changes that.

**If it passes, stop and record why.** Something else on that path is already refusing, and the row
is then wrong rather than merely unfixed. That is a finding, not an obstacle.

- [ ] **Step 3: Generalize the guard**

Rename `resolveQuarantineRoot` to `resolveContainedRoot` in `apps/cli/src/context.ts` with the
signature above, moving the refusal sentence into the new `refusalMessage` parameter. Update the
three existing call sites — `capture.ts`, `ingest.ts`, `review.ts` — to pass
`"the quarantine directory resolves outside the content root"`. Their behaviour must not change:
same message, same paths array, same injected `refuse`.

- [ ] **Step 4: Pay the check in `writeIndexArtifacts`**

In `apps/cli/src/commands/reindex.ts`, before the `validateChangePlan` call at `:270`:

```ts
  const ownedIndexRoot = await resolveContainedRoot(
    context,
    vaultRoot,
    join(vaultRoot, indexesDir),
    "the index directory resolves outside the vault",
    request.refuse,
  );
```

and pass `ownedRoots: [ownedIndexRoot]`. **Amend the existing comment above `ownedRoots` rather than
deleting it** — it explains that the root is deliberately narrower than it needs to be, which is
still true and still worth a reader's time; add that the root is now *proven* rather than
constructed.

`request.refuse` is what the surrounding code already uses (`reindex.ts:93-99` documents why the
refusal is injected). Confirm the exact name at the call site before writing it.

- [ ] **Step 5: Watch it pass**

```bash
npx vitest run --root tests security/symlink-escape.test.ts
npx vitest run --root apps/cli src/commands/reindex.test.ts src/commands/capture.test.ts src/commands/ingest.test.ts src/commands/review.test.ts
```

Expected: green. The four command suites are the rename's blast radius.

- [ ] **Step 6: Gates, fresh-context review, commit**

```bash
npm run check
```

Reviewer questions to ask explicitly: **did any of the three existing callers' refusal messages
change by a byte?** and **does the new case fail if the guard is removed again?** The second is the
only thing that distinguishes this from a test written against the fix.

```bash
git add apps/cli/src/context.ts apps/cli/src/commands/reindex.ts \
        apps/cli/src/commands/capture.ts apps/cli/src/commands/ingest.ts \
        apps/cli/src/commands/review.ts tests/security/symlink-escape.test.ts
git commit -m "fix(cli): anchor reindex's owned root on the vault it belongs to"
git show --stat HEAD
```

**Test:** the new `symlink-escape` case is green and was red before Step 4, with the four artifacts
observed outside the vault in the red run.

---

### Task 4: NEW-15 — the owner-and-mode check an executor owes

**Complexity:** S · **Security**

**The row:** `BACKLOG.md` §1 NEW-15. `packages/platform-macos/src/types.ts:13-18` states the
contract in its own words: **whoever executes a discovered binary owes an owner and mode check
first.** `discoverExecutable` finds a name on `PATH` and returns a path; it does not vouch for it.

**Two executors pay nothing.** `selectVendor` returns `discovery.executablePath`
(`apps/cli/src/commands/ingest.ts:454-463`) and the run spawns it through `invokeVendor`; and since
2026-08-15 `discoverSourceAgent` (`apps/cli/src/commands/capture.ts:229`) spawns the PATH-resolved
`claude` whenever `CLAUDECODE` is exactly `1` — **on the product's most-run command.** No `stat`, no
uid comparison and no mode comparison exists anywhere on either path.

**What it is not:** privilege escalation; the binary runs as the user either way. **What it is:** the
product hands that binary the user's captured observations and read access to the whole vault, on the
strength of a name match. A world-writable directory earlier on `PATH` is the ordinary way this goes
wrong.

**Files:**
- Create: `packages/security/src/executable-trust.ts`
- Create: `packages/security/src/executable-trust.test.ts`
- Modify: `packages/security/src/index.ts` — export the guard
- Modify: `apps/cli/src/commands/ingest.ts` — `selectVendor` at `:448-470`
- Modify: `apps/cli/src/commands/capture.ts` — `discoverSourceAgent` at `:229-249`
- Test: `packages/security/src/executable-trust.test.ts`, plus the two command suites

**Interfaces:**
- Consumes: `SecurityRefusalError` from `./paths.js`.
- Produces:
  ```ts
  export interface ExecutableTrustDependencies {
    readonly lstat: (path: string) => Promise<{
      uid: number;
      mode: number;
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    }>;
    readonly currentUid: () => number;
  }

  export async function assertTrustedExecutable(
    executablePath: string,
    dependencies: ExecutableTrustDependencies,
  ): Promise<void>;
  ```
  Throws `SecurityRefusalError` and returns nothing on success.

**The policy, stated once so both call sites cannot disagree.** An executable is trusted when, for
the file itself **and every ancestor directory up to `/`**:

1. the path component is owned by the current uid **or by root (uid 0)**, and
2. it is not group-writable and not world-writable — `(mode & 0o022) === 0`.

Root ownership is admitted because `/usr/bin/which`, `/bin` and `/usr` are root-owned on every macOS
machine and refusing them would refuse the product's own discovery. Group- and world-writability is
the actual threat: a directory anyone can write to is a directory anyone can put a `claude` in.

**`lstat`, not `stat`, and this is deliberate.** A symlink in the chain is followed by the kernel at
`exec` time, so the target must be checked — but a symlink whose *own* containing directory is
world-writable can be repointed, which is exactly the substitution this guard exists to refuse.
Refuse a symbolic link anywhere in the chain rather than trying to follow and re-check it: the
resolved path is what `which` already returned, and a second resolution here would open the
check-then-use window NEW-20 exists to describe. **Record this choice in the module's docblock**, and
record that it means a `claude` installed behind a symlink is refused rather than probed — which is a
real behaviour change for anyone whose package manager installs that way.

**The two call sites treat a refusal differently, and each is already committed to its answer.**

- **`capture` swallows it.** Spec §5.4: *"a discovery failure records `unknown` for both fields
  rather than failing the capture."* An untrusted binary **is** a discovery failure, and *not*
  probing it is the safe outcome. `discoverSourceAgent`'s existing `catch` already returns
  `UNKNOWN_SOURCE` for everything, so this requires **no change to its control flow** — only the
  check, placed before the version probe.
- **`ingest` refuses loudly.** It hands the binary the observation and the vault. `selectVendor`'s
  existing `catch` treats any error as "not installed" and falls through to the next vendor, which
  would **hide** this finding — so the refusal must be raised *outside* that `catch`. This is the
  one place in the task where control flow genuinely changes.

- [ ] **Step 1: Write the failing guard cases**

`packages/security/src/executable-trust.test.ts`, driving a fake `lstat` so the cases are hermetic —
a test that needs a world-writable directory on a real filesystem is a test CI cannot run:

```ts
import { describe, expect, it } from "vitest";
import { assertTrustedExecutable } from "./executable-trust.js";

const USER = 501;

function tree(entries: Record<string, { uid: number; mode: number; link?: boolean }>) {
  return {
    currentUid: () => USER,
    lstat: async (path: string) => {
      const entry = entries[path];
      if (entry === undefined) throw new Error(`unexpected lstat: ${path}`);
      return {
        uid: entry.uid,
        mode: entry.mode,
        isFile: () => !entry.link && path.includes("."),
        isDirectory: () => !entry.link && !path.includes("."),
        isSymbolicLink: () => entry.link === true,
      };
    },
  };
}

const ROOT_DIRS = {
  "/": { uid: 0, mode: 0o755 },
  "/opt": { uid: 0, mode: 0o755 },
  "/opt/bin": { uid: USER, mode: 0o755 },
};

describe("assertTrustedExecutable", () => {
  it("accepts a user-owned binary under root-owned, non-writable ancestors", async () => {
    await expect(
      assertTrustedExecutable("/opt/bin/claude.bin", tree({
        ...ROOT_DIRS,
        "/opt/bin/claude.bin": { uid: USER, mode: 0o755 },
      })),
    ).resolves.toBeUndefined();
  });

  it("refuses a binary owned by neither the user nor root", async () => {
    await expect(
      assertTrustedExecutable("/opt/bin/claude.bin", tree({
        ...ROOT_DIRS,
        "/opt/bin/claude.bin": { uid: 999, mode: 0o755 },
      })),
    ).rejects.toThrowError(/owner/u);
  });

  it("refuses a group-writable binary", async () => {
    await expect(
      assertTrustedExecutable("/opt/bin/claude.bin", tree({
        ...ROOT_DIRS,
        "/opt/bin/claude.bin": { uid: USER, mode: 0o775 },
      })),
    ).rejects.toThrowError(/writable/u);
  });

  it("refuses a world-writable ancestor directory even when the binary itself is sound", async () => {
    await expect(
      assertTrustedExecutable("/opt/bin/claude.bin", tree({
        "/": { uid: 0, mode: 0o755 },
        "/opt": { uid: 0, mode: 0o777 },
        "/opt/bin": { uid: USER, mode: 0o755 },
        "/opt/bin/claude.bin": { uid: USER, mode: 0o755 },
      })),
    ).rejects.toThrowError(/writable/u);
  });

  it("refuses a symbolic link anywhere in the chain", async () => {
    await expect(
      assertTrustedExecutable("/opt/bin/claude.bin", tree({
        ...ROOT_DIRS,
        "/opt/bin/claude.bin": { uid: USER, mode: 0o755, link: true },
      })),
    ).rejects.toThrowError(/symbolic link/u);
  });

  it("refuses a relative path rather than walking an ambiguous chain", async () => {
    await expect(
      assertTrustedExecutable("bin/claude", tree({})),
    ).rejects.toThrowError(/absolute/u);
  });
});
```

The fourth case is the one that carries the row's actual threat — *"a world-writable directory
earlier on `PATH`"* — and it is deliberately the case where the binary itself looks perfect.

- [ ] **Step 2: Watch them fail**

```bash
npx vitest run --root packages/security src/executable-trust.test.ts
```

Expected: **all six red**, on the module not existing. That is the correct first failure; the
per-branch failures come next.

- [ ] **Step 3: Write the guard**

`packages/security/src/executable-trust.ts`. Walk from the executable up to `/` using
`node:path`'s `dirname`, stopping when `dirname(p) === p`. Refuse a non-absolute input first.
Assert per component: not a symbolic link; `uid === currentUid() || uid === 0`;
`(mode & 0o022) === 0`. Raise `SecurityRefusalError` with a message naming which rule failed and at
which component — the messages the tests match on are `absolute`, `symbolic link`, `owner` and
`writable`.

Export it from `packages/security/src/index.ts` beside `assertSafeCommand`, with its type.

- [ ] **Step 4: Watch them pass**

```bash
npx vitest run --root packages/security src/executable-trust.test.ts
```

Expected: green, all six.

- [ ] **Step 5: Pay the check at both executors**

`apps/cli/src/commands/capture.ts`, inside `discoverSourceAgent`'s existing `try`, between the
`installed` guard and the version probe:

```ts
    await assertTrustedExecutable(discovery.executablePath, context.executableTrust);
```

Its existing `catch` returns `UNKNOWN_SOURCE`, so a refusal records `unknown` and the capture
survives — which is spec §5.4's answer and requires no other change. **Amend the docblock**: the
paragraph beginning *"What it spawns is a PATH-resolved binary that nothing here vouches for"* is
now false and must say what is checked instead.

`apps/cli/src/commands/ingest.ts`, in `selectVendor`, **outside** the `try` that swallows discovery
failures:

```ts
  for (const name of candidates) {
    let executable: string | null = null;
    try {
      const discovery = await context.platform.discoverExecutable(name);
      executable = discovery.installed ? discovery.executablePath : null;
    } catch {
      executable = null;
    }
    if (executable === null) continue;
    await assertTrustedExecutable(executable, context.executableTrust);
    return { name, executable };
  }
```

The refusal propagates as `SecurityRefusalError`, whose `code` is `EXIT_CODES.securityRefusal`.
**Confirm `ingest`'s failure mapping surfaces a `SecurityRefusalError` with that code** rather than
folding it into `IngestRefusal` — read how the command's catch clauses are arranged before writing
this, and if it does not, that is a finding to record.

Add `executableTrust: ExecutableTrustDependencies` to `CliContext` in `apps/cli/src/context.ts`,
built in the production context from `lstat` and `process.getuid`. **`process.getuid` is `undefined`
on some platforms** — `packages/platform-macos/src/transaction-lock.ts:109` already handles exactly
this and its handling is the precedent to copy, not to reinvent.

- [ ] **Step 6: Watch the command suites**

```bash
npx vitest run --root apps/cli src/commands/capture.test.ts src/commands/ingest.test.ts
npx vitest run --root tests
```

Expected: green. **Every existing test that drives a fake vendor now walks a real path chain**, so
this is where the task most likely goes red for a reason that is the test harness's rather than the
product's — a fixture binary in a `mkdtemp` directory under `/var/folders/…`. If that happens, the
fix is the harness's `executableTrust` fake, not a weakened policy.

- [ ] **Step 7: Gates, fresh-context review, commit**

```bash
npm run check
```

Reviewer questions to ask explicitly: **does `capture` still produce a capture when the check
refuses**, **does `ingest` refuse rather than falling through to the second vendor**, and **is the
symlink decision recorded where someone whose `claude` is symlinked will find it?**

```bash
git add packages/security/src/executable-trust.ts packages/security/src/executable-trust.test.ts \
        packages/security/src/index.ts apps/cli/src/context.ts \
        apps/cli/src/commands/capture.ts apps/cli/src/commands/ingest.ts
git commit -m "fix(security): pay the owner and mode check before executing a discovered binary"
git show --stat HEAD
```

**Test:** six guard cases green and each watched red; `capture` records `unknown` rather than failing
when the check refuses; `ingest` exits `securityRefusal` rather than trying the next vendor.

---

### Task 5: Close the documents

**Complexity:** XS

**Files:**
- Modify: `docs/superpowers/BACKLOG.md` — §0's glance row, and §1's four rows
- Modify: `docs/superpowers/ORDER.md` — the R1 row, and the stale count in the closing section
- Delete: `docs/superpowers/plans/2026-08-15-repository-defects.md` — this file

- [ ] **Step 1: Close the four rows**

Remove NEW-15, NEW-17, NEW-18 and NEW-19 from `BACKLOG.md` §1 — *"nothing closed stays here"* — and
extend that section's preamble sentence, which already lists what was removed and when, with these
four and this date. Update §0's glance row to the rows that remain.

- [ ] **Step 2: Correct the stale count**

`ORDER.md`'s closing section says *"`BACKLOG.md` §1 is four repository defects: NEW-7, NEW-11,
NEW-12, NEW-13"*. It was eleven before this plan and is seven after it. **Restate it from §1 as it
stands, do not edit the number** — this is the same class of error Task 19 Step 5 exists to stop
carrying forward, and a recount is what fixes it.

- [ ] **Step 3: Mark R1 done and leave A10 exactly as it was**

`ORDER.md`'s R1 row goes to `done`. **`NOW` returns to A10, still held for NEW-21 on the founder's
2026-08-15 decision.** Nothing in this plan touches DOS-P6, its plan, or its checkpoint; a reader
must not be able to mistake R1 closing for anything having moved on A10.

Record what this plan deliberately did **not** close, because a later session will otherwise
rediscover the same three rows and wonder why they were skipped: **NEW-16**, **NEW-11** and
**NEW-12's path half** each carry an open question their own row states — whether a user-supplied
redaction pattern is a config table (NEW-16), whether an invisible tag is an error, a warning or
silently dropped (NEW-11), and whether a path this product derived itself belongs under a word list
at all (NEW-12). Each is a decision, and decisions are the founder's. **NEW-20** and **NEW-13** were
registered as deliberately-not-fixed and stay that way; **NEW-7** needs a machine with Obsidian;
**NEW-21** is the founder's.

- [ ] **Step 4: Delete this plan, gate, commit, open the pull request**

```bash
npm run check
git add docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md docs/superpowers/plans
git commit -m "docs: close the four repository defects that took no decision"
git show --stat HEAD
git push -u origin <branch>
gh pr create --fill
gh pr checks <n>
```

**A red run that nobody reads is worse than the no CI it replaced.** Watch it.

**Test:** `grep -c "^### NEW-" docs/superpowers/BACKLOG.md` returns 7, and every number `ORDER.md`
states about §1 agrees with it.

---

## Checkpoint

Four `BACKLOG.md` §1 rows are closed with a regression test each, two of them security fixes and one
of them a guard this product's own type has demanded since Foundation. It is met when all four
commits are on a branch, `npm run check` is green on the last of them, each task's fresh-context
review has returned, and CI is green on the pull request. Not before.
