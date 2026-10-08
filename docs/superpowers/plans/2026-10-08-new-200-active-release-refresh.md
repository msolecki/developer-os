# NEW-200: The Active Release Refreshes Its Own Workflows (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking. The orchestration rules in `docs/superpowers/SESSION.md` §4.1 apply. Each task runs in its own worktree at `../developer-os.worktrees/<task>`. Only the orchestrator edits `docs/superpowers/`.
>
> Destination once approved: `docs/superpowers/plans/2026-10-08-new-200-active-release-refresh.md` (stage it with `git add -f`; `docs/superpowers` is globally git-ignored).

**Goal:** After a successful `update --apply` or `update rollback --apply`, the CLI runs `<product home>/bin/developer-os.mjs init`, so the newly active release's own code, to re-render the stored adapters from the active bundle. A refresh failure never reverts the swap, and `doctor` warns until every instruction row matches the active release.

**Architecture:** On an installed V2 home, `init` without `--adapters` renders from the active bundle under `releases/<version>/<platform>-<architecture>`, never from the keg (ruling C2). A keg that is absent, or whose version differs from the active release, is therefore no handoff rather than a refusal. `runUpdate` calls one new port, `CliUpdateContext.refresh`, after the update has returned and its global lock is released. In production the port spawns the active bundle's runtime on `<home>/bin/developer-os.mjs init` with the launcher's closed environment. The swap stops restamping instruction rows (ruling C1); the refresh stamps every row it renders, so `doctor` sees a refresh that did not happen. On a `package-channel` home every rendered hook names Node through the fixed `opt` path of the K2 table, so no swap changes or breaks a hook (ruling C3).

**Tech Stack:** TypeScript (strict), Node 24, pnpm workspace, vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`, block "**Amended 2026-10-07 (D84, Task 11b)**", item **K8** (founder-approved 2026-10-08), with the founder's rulings C1–C3 of 2026-10-08 below (Task 6 lists the spec sentences). Read K2 (the source table), K5 (NEW-171 (b)) and K7 (e), (f) with it. Also read `docs/architecture/foundation.md` §12.1–§12.4 and §12.6.

---

## Founder rulings (2026-10-08) and how the plan implements them

- **C1: the swap no longer restamps instruction rows; this reverses K7 (f).** `apps/cli/src/update/planning.ts` (around line 344–348) and `apps/cli/src/update/compose.ts` (around line 1007–1009) carry instruction rows unchanged, `productVersion` included, as K5 words it. `attach.ts` `settle()` stops masking `productVersion`, so the refresh stamps every row it renders at the manifest's version. `doctor` warns while any instruction row's `productVersion` differs from the active release. Two tests pin K7 (f), `planning.test.ts` (line 120) and `compose.test.ts` (line 437). Task 5 rewrites them to the new contract and renames them; this is a contract change, not a skipped test.
- **C2: `init` on an installed home without `--adapters` renders from the active bundle.** `settleExistingV2` passes `source: "active-release"` whenever `options.adapters` is null. `bin.ts` treats a `release_mismatch` keg as no handoff for `init` without `--adapters`, through a new factory-request field, `packageMismatchIsAbsent`. "Run developer-os init" therefore works after a rollback, after `brew upgrade` with no `update`, and with no keg.
  - **The refresh spawns plain `init`.** The hidden `--active-release-refresh` argv from the first draft is dropped, so the public grammar is unchanged.
  - **Why the hidden argv was not kept:** its only extra effect was never admitting the keg at all. With plain `init`, a keg that fails admission for any reason other than the version (a tampered or wrongly owned keg) still refuses with exit 6 and fails the refresh. That is the same loud refusal a user-run `init` gives, and it is wanted, not a reason for a second code path.
  - `init --adapters …` keeps the keg render and §12.3's `release_mismatch` rule unchanged.
  - **Dev homes:** a home with no active record, or whose trust is not `package-channel` (an `unsigned-local` dev home: its retained manifest is `{files, schemaVersion, trust}`, D96 Q4), falls back to the existing behaviour, `context.bootstrap`'s release or `packaged_release_unavailable`.
  - **One message changes:** a fresh `init` without `--adapters` against a mismatched keg now reports "fresh V2 initialization requires the admitted packaged bootstrap capability", still exit 4. The launcher runs the keg's own CLI on a fresh home, so in practice the mismatch cannot occur there.
- **C3: hooks name a stable Node path.** On a `package-channel` home, `HookCommandExecutable.node` is `<table[arch].opt>/<table[arch].fallback>/<PACKAGE_CHANNEL_LAYOUT.bundleRoot>/<runtimeEntrypoint>`. On arm64 that is `/opt/homebrew/opt/developer-os/libexec/fallback/bundle/bin/node`.
  - `arch` is the active record's `architecture`, `runtimeEntrypoint` comes from the active release's retained bundle manifest, and `table` is `PACKAGE_CHANNEL_SOURCE_TABLE` (no `PATH`, never `realpath`, so no version is pinned). This applies to every render on such a home, the first `init --adapters` included.
  - **`unsigned-local` (dev) home: keeps its current behaviour,** `stableNodePath(process.execPath)`. It has no keg, and such a home never updates (NEW-147), so no swap ever retires the Node it names.
  - **Hook exit-2 semantics are unchanged:** hooks still run `<node> <home>/bin/developer-os.mjs …`, and that script exits 2 for the three guards when the active release cannot load.
  - **Accepted residuals:** with the keg removed (`brew uninstall` without `developer-os uninstall`), every hook exits 127, which neither vendor blocks on. Between `brew upgrade` and `update`, hooks run the new keg's Node on the active release's code; both are Node 24.
  - **Consequence for NEW-200's proof:** a swap no longer changes `hooks/hooks.json`. The e2e therefore proves that the skill changes and is restored, and that the hook stays byte-identical across every swap and runs the current keg's Node. A change to `CLAUDE_HOOK_ROWS` itself needs a real release (Task 7 gate).
  - **Out of scope, same defect class, one line for the founder:** launchd plists name Node through `stableNodePath` (`apps/cli/src/commands/automation/service.ts` line 367).

## Design answers

1. **What the refresh spawns:** the active runtime `<active.bundleRoot>/<runtimeEntrypoint>` with argv `[<home>/bin/developer-os.mjs, "init"]`. It runs plain `init` (C2), and the public grammar does not change.
2. **Where the render source switches:** `settleExistingV2` (`apps/cli/src/commands/init.ts`, around line 340) → `applyInstructions` (`apps/cli/src/instructions/apply.ts`) with `source: "active-release"`. The tree is `readActiveReleaseTree` (new, `apps/cli/src/instructions/active-release.ts`).
   - It reads `state/active-release.json` and `state/release-trust.json`, and returns `null` unless the trust is `package-channel`.
   - It then reads the retained `state/release-metadata/bundles/<bundleManifestHash>.json`, hash-checked against the record as `retainedBundleManifest` in `apps/cli/src/update/apply-ports.ts` does.
   - It lists the file entries under `instructions/` and `workflows/` with absolute `relativePath`s `<bundleRoot>/<path>`. Each `readFile` checks the entry's size and SHA-256 and refuses `active_release_tree_invalid`, exit 6, on any mismatch.
   - `loadReleaseWorkflows` and `loadInstructionDefaults` (`apps/cli/src/instructions/sources.ts`) narrow their parameter to a structural `ReleaseTreeV1`, which `AdmittedPackagedReleaseV1` already satisfies.
3. **The e2e fixture:**
   - **Release trees:** `syntheticBundle`'s new `extraFiles` gives 1.1.0 and 1.2.0 the repository's `workflows/` and `instructions/` (`SYNTHETIC_INSTRUCTIONS`). Today they carry only `bin/*`, so the first refresh would refuse `instruction_catalog_invalid`.
   - **The skill:** 1.2.0's `skills/triage/SKILL.md` body is `Triage, then reproduce.`. It changes on the update to 1.2.0 and is restored on the rollback.
   - **The hook (C3):** `hooks.json` names `<fixture root>/prefix/opt/developer-os/libexec/fallback/bundle/bin/runtime`, through the fixture's table seam. It stays byte-identical across every swap, and that path runs the Node of whichever keg `world.install` linked.
   - **The refresh:** runs in-process as `runInit(context, { dryRun: false, assumeYes: true })`, the same code the spawned child runs. The fixture's Claude is not discoverable through the fallback search path a child without `PATH` would use.
4. **The spawn's environment and exit codes:**
   - **Environment:** exactly `{ HOME, DEVELOPER_OS_HOME, DEVELOPER_OS_BRAIN? }` from `context.userHome`, `context.paths.home` and a set, non-empty `context.env.DEVELOPER_OS_BRAIN`. No `PATH` and nothing inherited, mirroring `apps/launcher/src/environment.ts` `buildLauncherEnvironment` (restated, because `apps/cli` may not import `apps/launcher`).
   - **stdio:** `["ignore", "ignore", "inherit"]`.
   - **Exit codes:** child 0 keeps the success. Child 1–6 becomes `failure(code, { kind: "workflows_not_refreshed", message: "workflows not refreshed: run developer-os init", paths: [], recovery: "developer-os init", data: <the applied result> })`. A `null` code, a signal, any other number or a spawn error becomes exit 1 with the same message.
   - **Resumed runs:** a resumed finalized coordinator refreshes too.

---

## Global Constraints

- Work on `integrate/task-11b` (orchestrator). Implementers branch `task/n200-<n>` from it in `../developer-os.worktrees/n200-<n>` (D33; a worktree inside the repository breaks `eslint`).
- **Sequencing with the Task 11 follow-up:** `task/t11b-11fix` (`../developer-os.worktrees/t11b-11fix`) edits `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/doctor.ts`, `init.test.ts` and `doctor.test.ts`. Tasks 3 and 4 touch `init.ts` or `doctor.ts`, so they branch only after that fix is integrated on `integrate/task-11b`.
- Per commit: the task's fast commands, then `npm run lint`. Slow suites (any `npm run test…`, `npm run check`, `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security`, `tests/integration`) run only for the task's own cases, filtered with `-t`, red then green. Everything else waits for plan close (D32). Tick a deferred step "deferred to plan close (D32)".
- `npm run check` runs once, at Task 7, by the founder, on a quiet machine (no other agent running tests). Detach it, because a background shell is killed at about 29 minutes.
- Exact-path staging only. Never `git add -A`, `git add .` or a wildcard.
- Message, verbatim from K8: `workflows not refreshed: run developer-os init`. Error kind: `workflows_not_refreshed`. Recovery: `developer-os init`.
- "A refresh failure never reverts the release swap" (K8). Nothing calls a compensation after `finalized`.
- Render source (K8, C2): on a `package-channel` home, `init` without `--adapters` reads only `releases/<version>/<platform>-<architecture>`, never the keg.
- The refresh is §12.3 unchanged: an edited managed file refuses `instruction_target_drifted` (exit 3) and is left as it is, a deleted one is restored, and a row no longer rendered is removed unless edited.
- Hook Node (C3): on a `package-channel` home, `<table.opt>/libexec/fallback/bundle/<runtimeEntrypoint>` from `PACKAGE_CHANNEL_SOURCE_TABLE`; on an `unsigned-local` home, `stableNodePath(process.execPath)`. The product never reads `PATH` and never runs `brew`.
- The spawn's environment is exactly `HOME`, `DEVELOPER_OS_HOME` and, when set, `DEVELOPER_OS_BRAIN`.
- The planner stays keep-all (D96 Q3). No change in `packages/security/src/update/graph.ts` or the planner protocol.
- Exit codes come from `packages/core/src/result.ts` `EXIT_CODES` only.
- Public-bound repository: synthetic fixtures only. No founder paths or private content in committed files.
- Every enumerating gate asserts a non-empty set per scope (SESSION hard rule).

## Review Focus

1. **"Run developer-os init" after a rollback, with the keg one release ahead or removed (C2).** Expected: exit 0, rendering from `releases/<active>`; no `release_mismatch`. Tests: Task 3 step 1 cases (a) and (b); Task 5 e2e case (d).
2. **A hook fired right after a swap or after a rollback retired a bundle (C3).** Expected: `hooks.json` still names the `opt` path and its Node runs. Tests: Task 1 step 1 case (d) and Task 5's e2e hook assertions after each swap.
3. **`update --apply --json` while the child writes to stdout.** Expected: exactly the parent's one JSON line. Test: Task 2 step 1 case (c).
4. **The swap happened but the refresh refused.** Expected: the update exits with the refresh's code and K8's message, the new release stays active, and `doctor` warns until a refresh succeeds. Tests: Task 5 e2e case (e) and Task 4 step 1.
5. **A dev (`unsigned-local`) home re-runs `init` without flags.** Expected: unchanged behaviour (no exit 6 from the active-tree reader), and its hooks still name the Node that ran `init`. Tests: Task 1 step 1 case (g) and Task 3 step 1 case (c).

---

## Wave table

| Wave | Tasks (size) | Starts when integrated |
|---|---|---|
| 1 | 1 (L), 6 (S, spec text) | nothing |
| 2 | 2 (S), 4 (S) | 2 ← 1; 4 ← `task/t11b-11fix` |
| 3 | 3 (M) | 1 **and** `task/t11b-11fix` |
| 4 | 5 (L) | 1–4 |
| 5 | 7 (S, founder gate) | 1–6 |

No file is shared inside a wave. Task 3 follows Task 1 because both edit `apps/cli/src/commands/init-instructions.v2.test.ts`.

---

### Task 1: Render from the active bundle; stamp every rendered row; hooks name the stable `opt` Node (L)

**Files:**
- Create: `apps/cli/src/instructions/active-release.ts`
- Create: `apps/cli/src/instructions/active-release.v2.test.ts`
- Modify: `apps/cli/src/instructions/sources.ts` (`loadReleaseWorkflows`, `loadInstructionDefaults` parameter types; new `ReleaseTreeV1`)
- Modify: `apps/cli/src/instructions/apply.ts` (`applyInstructions` input and body around lines 324–461, `loadSources`)
- Modify: `apps/cli/src/instructions/attach.ts` (`settle`, around line 177)
- Modify: `apps/cli/src/context.ts` (`CliContext`, around line 217: optional `packageChannelTable`)
- Modify: `apps/cli/src/commands/testing.ts` (`createCommandFixture`, around line 591: set the fixture table)
- Modify: `apps/cli/src/commands/init-instructions.v2.test.ts` (line 372: the hook prefix becomes the `opt` path)

**Interfaces:**
- Consumes: `validateActiveReleaseRecord`, `validateBundleManifest`, `validateReleaseTrustState`, `isPackageChannelTrust`, `decodeCanonicalJson`, `hashBytes`, `EXIT_CODES`, `PACKAGE_CHANNEL_SOURCE_TABLE`, `PACKAGE_CHANNEL_LAYOUT` (`@developer-os/core`); `createCanonicalPathEvidence` (`apps/cli/src/bootstrap/admission.ts`); `readNoFollow`, `stableNodePath` (`apps/cli/src/instructions/apply.ts`); `InstructionRefusal` (`apps/cli/src/instructions/attach.ts`).
- Produces:
  - `sources.ts`: `export interface ReleaseTreeV1 { readonly bundleRoot: string; readonly files: readonly { readonly relativePath: string }[]; readonly readFile: (relativePath: string) => Promise<Uint8Array> }`
  - `active-release.ts`: `export interface ActiveReleaseTreeV1 extends ReleaseTreeV1 { readonly version: string; readonly architecture: "arm64" | "x64"; readonly runtimeEntrypoint: string }`
  - `active-release.ts`: `export async function readActiveReleaseTree(context: CliContext): Promise<ActiveReleaseTreeV1 | null>`. It returns `null` with no active record or a non-`package-channel` trust, and otherwise refuses `active_release_tree_invalid`, exit 6, on any mismatch.
  - `active-release.ts`: `export async function hookNodePath(context: CliContext, tree: ActiveReleaseTreeV1 | null): Promise<string>`
  - `apply.ts`: the `applyInstructions` input gains `readonly source?: "active-release"`. With it, a non-null active tree is the render source and `assertInstalledRelease` is skipped; with a `null` tree, `input.release` is used as before.
  - `context.ts`: `readonly packageChannelTable?: typeof PACKAGE_CHANNEL_SOURCE_TABLE` (the K6 fixed-path test seam; production leaves it unset).
  - `attach.ts`: `settle()` keeps a previous row only when it is equal ignoring `verifiedAt`.

- [ ] **Step 1: Write the failing tests.** Create `apps/cli/src/instructions/active-release.v2.test.ts`:

```ts
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson, EXIT_CODES, hashBytes } from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2 } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import { hookNodePath, readActiveReleaseTree } from "./active-release.js";
import { applyInstructions, stableNodePath } from "./apply.js";

afterAll(removeCommandFixtures);

const CLAUDE = "/opt/synthetic/bin/claude";
const encoder = new TextEncoder();
const INSTRUCTIONS = [
  { relativePath: "catalog.json", bytes: encoder.encode(`${JSON.stringify({ schemaVersion: 1, artifacts: [{ category: "skill", id: "triage", legacyName: "triage", vendors: ["claude"], thinCommand: false }] })}\n`), mode: 0o600 },
  { relativePath: "skills/triage/SKILL.md", bytes: encoder.encode("---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n"), mode: 0o600 },
] as const;
const CLAUDE_ONLY = {
  agents: {
    claude: { name: "claude", installed: true, executablePath: CLAUDE, version: null },
    codex: { name: "codex", installed: false, executablePath: null, version: null },
  },
  runner: {
    run: (request: { readonly args: readonly string[] }) => request.args.join(" ") === "--version"
      ? Promise.resolve({ stdout: "2.1.280 (Claude Code)\n", stderr: "", exitCode: 0, signal: null, timedOut: false })
      : Promise.reject(new Error(`unexpected spawn: ${request.args.join(" ")}`)),
  },
} as const;

async function installed(label: string): Promise<{ readonly fixture: CommandFixture; readonly bundleRoot: string }> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true, instructions: INSTRUCTIONS, ...CLAUDE_ONLY });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const result = await runInit(fixture.context, { dryRun: false, assumeYes: true, adapters: ["claude"] });
  if (!result.ok) throw new Error(JSON.stringify(result));
  const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleRoot: string };
  return { fixture, bundleRoot: active.bundleRoot };
}

async function manifestOf(fixture: CommandFixture): Promise<InstallationManifestV2> {
  return decodeCanonicalJson(await nodeFs.readFile(fixture.paths.manifestFile), 1 << 26) as unknown as InstallationManifestV2;
}

/** A second context over the same home with no packaged release and the keg deleted. */
async function kegless(fixture: CommandFixture) {
  await nodeFs.rm(join(fixture.root, "prefix"), { recursive: true, force: true });
  return (await createCommandFixture("kegless", { root: fixture.root, ...CLAUDE_ONLY })).context;
}

/** C3: the fixture table's `opt` path, `<root>/prefix/opt/developer-os/libexec/fallback/bundle/bin/runtime`. */
function optNode(fixture: CommandFixture): string {
  return join(fixture.root, "prefix", "opt", "developer-os", "libexec", "fallback", "bundle", "bin", "runtime");
}

describe("readActiveReleaseTree (K8)", () => {
  it("(a) lists the active bundle's instructions/ and workflows/ files", async () => {
    const { fixture, bundleRoot } = await installed("active-tree");
    const tree = await readActiveReleaseTree(fixture.context);
    if (tree === null) throw new Error("a package-channel home must have an active tree");
    expect(tree).toMatchObject({ bundleRoot, version: "1.0.0", runtimeEntrypoint: "bin/runtime" });
    const paths = tree.files.map((file) => file.relativePath);
    expect(paths).toContain(`${bundleRoot}/instructions/catalog.json`);
    expect(paths.some((path) => path.startsWith(`${bundleRoot}/workflows/`))).toBe(true);
    expect(paths.every((path) => path.startsWith(`${bundleRoot}/instructions/`) || path.startsWith(`${bundleRoot}/workflows/`))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(b) refuses a bundle file whose bytes differ from the retained manifest, exit 6", async () => {
    const { fixture, bundleRoot } = await installed("active-tree-tampered");
    const skill = join(bundleRoot, "instructions", "skills", "triage", "SKILL.md");
    await nodeFs.writeFile(skill, "tampered\n");
    const tree = await readActiveReleaseTree(fixture.context);
    await expect(tree?.readFile(skill)).rejects.toMatchObject({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(c) refuses a retained bundle manifest that does not hash to the active record, exit 6", async () => {
    const { fixture } = await installed("active-tree-manifest");
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleManifestHash: string };
    await nodeFs.appendFile(join(fixture.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`), " ");
    await expect(readActiveReleaseTree(fixture.context)).rejects.toMatchObject({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("applyInstructions({ source: \"active-release\" }) (K8, C1, C3)", () => {
  it("(d) restores a deleted managed file with no keg; hooks name the stable opt Node, unchanged", async () => {
    const { fixture } = await installed("active-refresh-restore");
    const rows = (await manifestOf(fixture)).artifacts;
    const skill = rows.find((row) => row.kind === "instruction" && row.owner === "claude" && row.path.endsWith("/SKILL.md"));
    const hooks = rows.find((row) => row.owner === "claude" && row.path.endsWith("/hooks/hooks.json"));
    if (skill === undefined || hooks === undefined) throw new Error("no rendered skill or hooks");
    const hooksBefore = await nodeFs.readFile(hooks.path, "utf8");
    expect(hooksBefore).toContain(`${optNode(fixture)} ${join(fixture.paths.home, "bin", "developer-os.mjs")} `);
    const skillBytes = await nodeFs.readFile(skill.path);
    await nodeFs.rm(skill.path);
    const context = await kegless(fixture);

    const result = await applyInstructions(context, { selection: null, release: null, source: "active-release" });

    expect(result.restored.length).toBeGreaterThan(0);
    expect(await nodeFs.readFile(skill.path)).toEqual(skillBytes);
    expect(await nodeFs.readFile(hooks.path, "utf8")).toBe(hooksBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(e) refuses an edited managed file with instruction_target_drifted, exit 3, and leaves it as is", async () => {
    const { fixture } = await installed("active-refresh-drift");
    const skill = (await manifestOf(fixture)).artifacts.find((row) => row.kind === "instruction" && row.path.endsWith("/SKILL.md"));
    if (skill === undefined) throw new Error("no rendered skill");
    await nodeFs.writeFile(skill.path, "edited by the user\n");
    await expect(applyInstructions(await kegless(fixture), { selection: null, release: null, source: "active-release" }))
      .rejects.toMatchObject({ reason: "instruction_target_drifted", code: EXIT_CODES.decisionRequired });
    expect(await nodeFs.readFile(skill.path, "utf8")).toBe("edited by the user\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(f) stamps every rendered row at the manifest's version even when no byte changes (C1)", async () => {
    const { fixture } = await installed("active-refresh-stamp");
    const before = await nodeFs.readFile(fixture.paths.manifestFile);
    const manifest = decodeCanonicalJson(before, 1 << 26) as unknown as InstallationManifestV2;
    const older = { ...manifest, artifacts: manifest.artifacts.map((row) => (row.kind === "instruction" ? { ...row, productVersion: "0.9.0" } : row)) };
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("no lifecycle context");
    await withLifecycleMutation(fixture.context, lifecycle, () => fixture.context.executor.execute({
      kind: "instructions",
      mutations: [{ targetPath: fixture.paths.manifestFile, operation: "replace", content: encoder.encode(encodeCanonicalJson(older as unknown as CanonicalJsonValue)), expectedBeforeHash: hashBytes(before) }],
    }));

    await applyInstructions(await kegless(fixture), { selection: null, release: null, source: "active-release" });

    const rows = (await manifestOf(fixture)).artifacts.filter((row) => row.kind === "instruction");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.productVersion === "1.0.0")).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(g) names the Node that ran init when the home has no package-channel tree (unsigned-local, C3)", async () => {
    const fixture = await createCommandFixture("hook-node-dev", {});
    expect(await hookNodePath(fixture.context, null)).toBe(await stableNodePath(process.execPath));
    // A home with no active record reads as no tree, never as exit 6.
    expect(await readActiveReleaseTree(fixture.context)).toBeNull();
  });
});
```

In `apps/cli/src/commands/init-instructions.v2.test.ts` line 372, replace the prefix with the C3 path:

```ts
    const prefix = `${join(fixture.root, "prefix", "opt", "developer-os", "libexec", "fallback", "bundle", "bin", "runtime")} ${join(fixture.paths.home, "bin", "developer-os.mjs")} `;
```

Rename that case "installs hooks/hooks.json as a manifest row whose every command is <opt node> <entrypoint> (C3)".

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/instructions/active-release.v2.test.ts`. Expected: FAIL at compile time, because `./active-release.js` does not exist and `applyInstructions` has no `source` input. After stubbing:
  - (d) fails with `packaged_release_unavailable`, and its first `hooksBefore` assertion fails because hooks name `process.execPath`.
  - (f) fails because `settle()` keeps `0.9.0`.

  Run `npx vitest run apps/cli/src/commands/init-instructions.v2.test.ts -t "every command is"`. Expected: FAIL on the prefix.

- [ ] **Step 3: Implement.**

`apps/cli/src/instructions/sources.ts`:

```ts
/** What the loaders read from a release: an admitted keg (`AdmittedPackagedReleaseV1`) or the active bundle (K8). */
export interface ReleaseTreeV1 {
  readonly bundleRoot: string;
  readonly files: readonly { readonly relativePath: string }[];
  readonly readFile: (relativePath: string) => Promise<Uint8Array>;
}
```

Retype both loaders' first parameter to `ReleaseTreeV1`. Their bodies already read only these three members.

Create `apps/cli/src/instructions/active-release.ts`:

```ts
import { join } from "node:path";

import {
  decodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  isPackageChannelTrust,
  PACKAGE_CHANNEL_LAYOUT,
  PACKAGE_CHANNEL_SOURCE_TABLE,
  validateActiveReleaseRecord,
  validateBundleManifest,
  validateReleaseTrustState,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import type { CliContext } from "../context.js";
import { readNoFollow, stableNodePath } from "./apply.js";
import { InstructionRefusal } from "./attach.js";
import type { ReleaseTreeV1 } from "./sources.js";

const MAX_RECORD_BYTES = 16 * 1024;
const MAX_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024;
const RENDERED = /^(?:instructions|workflows)\//u;

export interface ActiveReleaseTreeV1 extends ReleaseTreeV1 {
  readonly version: string;
  readonly architecture: "arm64" | "x64";
  readonly runtimeEntrypoint: string;
}

function invalid(path: string): never {
  throw new InstructionRefusal({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired, paths: [path], recovery: "developer-os doctor" });
}

/**
 * K8/C2: the render source of an installed `package-channel` home is its active bundle under
 * `releases/<version>/<platform>-<architecture>`, never the keg, bound to the active record through
 * the retained bundle manifest's hash. `null`, the caller's old path, for a home with no active
 * record or another trust (an `unsigned-local` home's retained manifest is not a bundle manifest).
 */
export async function readActiveReleaseTree(context: CliContext): Promise<ActiveReleaseTreeV1 | null> {
  const activePath = join(context.paths.stateDir, "active-release.json");
  const trustBytes = await readNoFollow(join(context.paths.stateDir, "release-trust.json"));
  const activeBytes = await readNoFollow(activePath);
  if (trustBytes === null || activeBytes === null) return null;
  if (!isPackageChannelTrust(validateReleaseTrustState(decodeCanonicalJson(trustBytes, MAX_RECORD_BYTES)))) return null;
  const active = validateActiveReleaseRecord(decodeCanonicalJson(activeBytes, MAX_RECORD_BYTES), createCanonicalPathEvidence());
  const manifestPath = join(context.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`);
  const manifestBytes = await readNoFollow(manifestPath);
  if (manifestBytes === null || hashBytes(manifestBytes) !== active.bundleManifestHash) invalid(manifestPath);
  const manifest = validateBundleManifest(decodeCanonicalJson(manifestBytes, MAX_BUNDLE_MANIFEST_BYTES));
  if (manifest.version !== active.version || manifest.architecture !== active.architecture) invalid(manifestPath);
  const entries = new Map(manifest.entries.flatMap((entry) => (entry.kind === "file" ? [[`${active.bundleRoot}/${entry.path}`, entry] as const] : [])));
  return {
    version: active.version,
    architecture: active.architecture,
    runtimeEntrypoint: manifest.runtimeEntrypoint,
    bundleRoot: active.bundleRoot,
    files: [...entries.keys()].filter((path) => RENDERED.test(path.slice(active.bundleRoot.length + 1))).map((relativePath) => ({ relativePath })),
    readFile: async (path) => {
      const entry = entries.get(path);
      const bytes = entry === undefined ? null : await readNoFollow(path);
      if (entry === undefined || bytes === null || String(bytes.byteLength) !== entry.bytes || hashBytes(bytes) !== entry.sha256) invalid(path);
      return bytes;
    },
  };
}

/**
 * C3 (2026-10-08): a `package-channel` home's hooks name Node through the K2 table's fixed `opt`
 * link, so no release swap or retirement changes or breaks a hook; never `PATH`, never `realpath`.
 * An `unsigned-local` home has no keg and never updates: it keeps the Node that ran `init`.
 */
export async function hookNodePath(context: CliContext, tree: ActiveReleaseTreeV1 | null): Promise<string> {
  if (tree === null) return stableNodePath(process.execPath);
  const entry = (context.packageChannelTable ?? PACKAGE_CHANNEL_SOURCE_TABLE)[tree.architecture];
  return `${entry.opt}/${entry.fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleRoot}/${tree.runtimeEntrypoint}`;
}
```

`apps/cli/src/instructions/apply.ts`:
- Retype `loadSources(release: ReleaseTreeV1, …)`.
- Add to the `applyInstructions` input: `/** K8/C2: render from the active bundle when the home has one; \`release\` is the fallback for a home without. */ readonly source?: "active-release";`
- Replace the block from `const hookExecutable` through `await assertInstalledRelease(...)`:

```ts
  const active = selection.length > 0 ? await readActiveReleaseTree(context) : null;
  const tree: ReleaseTreeV1 | null = input.source === "active-release" && active !== null ? active : input.release;
  /** A13 Tasks 14 and 15 and C3: hooks run `<node> <product-home>/bin/developer-os.mjs`. */
  const hookExecutable: HookCommandExecutable = { node: await hookNodePath(context, active), entrypoint: entrypointPath(home) };
  if (selection.length > 0) {
    assertHookNodePath(hookExecutable.node);
    assertHookExecutablePath(hookExecutable.entrypoint);
  }

  const executables = await discoverExecutables(context);
  for (const vendor of selection) await assertAdapterAvailable(context, vendor, executables.get(vendor) ?? null);
  if (selection.length > 0 && tree === input.release) {
    if (input.release === null) {
      throw new InstructionRefusal({
        reason: "packaged_release_unavailable",
        code: EXIT_CODES.capabilityUnavailable,
        paths: [home],
        recovery: "re-run init with --local-release <dir> naming the installed build",
      });
    }
    await assertInstalledRelease(context, input.release, recorded?.productVersion);
  }
```

- Replace `if (selection.length === 0 || input.release === null) return …` with `if (selection.length === 0 || tree === null) return …`, and call `loadSources(tree, selection, home, lifecycle.effectiveUid)`.
- The new imports form a cycle between function declarations only: `active-release.ts` imports `readNoFollow` and `stableNodePath` from `apply.ts`, and `apply.ts` imports `readActiveReleaseTree` and `hookNodePath`. ESM resolves that. If `import/no-cycle` lint is on, move `readNoFollow` and `stableNodePath` into `active-release.ts` and re-export them from `apply.ts` (`apps/cli/src/commands/automation/service.ts` imports `stableNodePath` from `apply.js`).

`apps/cli/src/instructions/attach.ts` `settle`. Every row the planner writes passes through it: content and instruction rows (around line 334), block and vendor-file rows (around line 393), and directory rows in `finish` (around line 452). The constructor's copy (line 207) is replaced by a rendered row or removed with an unrendered one, so no other site keeps a stale stamp.

```ts
/** Keeps the recorded row, `verifiedAt` included, when nothing but the time would change; a new release's stamp counts (C1). */
function settle(candidate: ManagedArtifactV2, previous: ManagedArtifactV2 | undefined): ManagedArtifactV2 {
  if (previous === undefined) return candidate;
  return canonical({ ...candidate, verifiedAt: previous.verifiedAt }) === canonical(previous) ? previous : candidate;
}
```

`apps/cli/src/context.ts` `CliContext`: add `/** K6's fixed-path test seam for the K2 table (C3 hook Node); production leaves it unset. */ readonly packageChannelTable?: typeof PACKAGE_CHANNEL_SOURCE_TABLE;`

`apps/cli/src/commands/testing.ts` `createCommandFixture`: set it on the returned context. The fixture keg lives under `<root>/prefix`, which is the same prefix `createOnDiskReleaseWorld` links `opt/developer-os` in.

```ts
  const fixtureTable = (() => {
    const entry = { prefix: join(root, "prefix"), opt: join(root, "prefix", "opt", "developer-os"), fallback: "libexec/fallback" } as const;
    return { arm64: entry, x64: entry } as unknown as typeof PACKAGE_CHANNEL_SOURCE_TABLE;
  })();
  // … in the context literal: packageChannelTable: fixtureTable,
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run both commands from step 2. Expected: PASS. Then run `npx vitest run apps/cli/src/instructions/attach.test.ts apps/cli/src/instructions/apply.test.ts apps/cli/src/instructions/sources.test.ts`. Expected: PASS. Run `npx vitest run apps/cli/src/commands/init-instructions.v2.test.ts -t "unchanged re-run|byte-identical hooks.json"`. Expected: PASS. The rest of that file is deferred to plan close (D32). Run `npm run lint`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/instructions/active-release.ts apps/cli/src/instructions/active-release.v2.test.ts apps/cli/src/instructions/sources.ts apps/cli/src/instructions/apply.ts apps/cli/src/instructions/attach.ts apps/cli/src/context.ts apps/cli/src/commands/testing.ts apps/cli/src/commands/init-instructions.v2.test.ts
git commit -m "feat(instructions): render from the active bundle, stamp every rendered row, hooks name the opt Node (NEW-200, K8, C1, C3)"
```

---

### Task 2: The refresh process: runtime, closed environment, exit mapping (S)

**Files:**
- Create: `apps/cli/src/update/refresh.ts`
- Create: `apps/cli/src/update/refresh.v2.test.ts`

**Interfaces:**
- Consumes: `readActiveReleaseTree(context): Promise<ActiveReleaseTreeV1 | null>` (Task 1); `entrypointPath(productHome)` (`apps/cli/src/update/local-release.ts`); `InstructionRefusal` (`apps/cli/src/instructions/attach.ts`).
- Produces (`apps/cli/src/update/refresh.ts`):
  - `export const REFRESH_ARGV = ["init"] as const;`
  - `export const REFRESH_STDIO = ["ignore", "ignore", "inherit"] as const;`
  - `export interface RefreshProcessV1 { readonly executable: string; readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>> }`
  - `export function refreshEnvironment(context: CliContext): Record<string, string>`
  - `export async function refreshProcess(context: CliContext): Promise<RefreshProcessV1>`
  - `export function refreshExitCode(code: number | null): ExitCode`
  - `export function runRefreshProcess(request: RefreshProcessV1): Promise<ExitCode>`
  - `export async function refreshActiveRelease(context: CliContext): Promise<ExitCode>` (never throws)

- [ ] **Step 1: Write the failing tests.** Create `apps/cli/src/update/refresh.v2.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { REFRESH_ARGV, REFRESH_STDIO, refreshActiveRelease, refreshEnvironment, refreshExitCode, refreshProcess, runRefreshProcess } from "./refresh.js";

afterAll(removeCommandFixtures);

/** A runtime stub the kernel runs directly (no shell adds PWD or SHLVL): records argv and env, writes stdout, exits `code`. */
async function stub(dir: string, code: number): Promise<{ readonly executable: string; readonly record: string }> {
  const executable = join(dir, `runtime-${String(code)}`);
  const record = join(dir, `record-${String(code)}.json`);
  await nodeFs.writeFile(executable, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.stdout.write("noise\\n");\nprocess.exitCode = ${String(code)};\n`, { mode: 0o700 });
  return { executable, record };
}

describe("the K8 refresh process", () => {
  it.each([[0, 0], [1, 1], [3, 3], [6, 6], [7, 1], [127, 1], [null, 1]] as const)("(a) maps child exit %s to %s", (code, expected) => {
    expect(refreshExitCode(code)).toBe(expected);
  });

  it("(b) passes argv and exactly the launcher's closed environment, and returns the child's code", async () => {
    const fixture = await createCommandFixture("refresh-spawn", { env: { PATH: "/synthetic/bin", DEVELOPER_OS_BRAIN: "/synthetic/brain", CODEX_HOME: "/synthetic/codex" } });
    const { executable, record } = await stub(fixture.root, 3);
    const env = refreshEnvironment(fixture.context);
    expect(Object.keys(env).sort()).toStrictEqual(["DEVELOPER_OS_BRAIN", "DEVELOPER_OS_HOME", "HOME"]);
    expect(await runRefreshProcess({ executable, argv: ["/synthetic/home/bin/developer-os.mjs", ...REFRESH_ARGV], env })).toBe(EXIT_CODES.decisionRequired);
    const seen = JSON.parse(await nodeFs.readFile(record, "utf8")) as { argv: string[]; env: Record<string, string> };
    expect(seen.argv).toStrictEqual(["/synthetic/home/bin/developer-os.mjs", "init"]);
    expect(seen.env).toStrictEqual(env);
    expect(Object.keys(refreshEnvironment((await createCommandFixture("refresh-env", {})).context)).sort()).toStrictEqual(["DEVELOPER_OS_HOME", "HOME"]);
  });

  it("(c) never lets the child write to the parent's stdout", async () => {
    expect(REFRESH_STDIO).toStrictEqual(["ignore", "ignore", "inherit"]);
    const fixture = await createCommandFixture("refresh-stdout", {});
    const { executable } = await stub(fixture.root, 0);
    const module = new URL("../../dist/update/refresh.js", import.meta.url).href;
    const parent = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const m = await import(${JSON.stringify(module)}); process.stdout.write("parent:" + String(await m.runRefreshProcess({ executable: ${JSON.stringify(executable)}, argv: [], env: {} })));`], { encoding: "utf8" });
    expect(parent.stdout).toBe("parent:0");
  });

  it("(d) maps a missing runtime to exit 1, never success", async () => {
    expect(await runRefreshProcess({ executable: "/synthetic/absent/runtime", argv: [], env: {} })).toBe(EXIT_CODES.operationalFailure);
  });

  it("(e) execs the active release's runtime on the version-free entrypoint, never process.execPath", async () => {
    const fixture = await createCommandFixture("refresh-process", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleRoot: string };
    const spawned = await refreshProcess(fixture.context);
    expect(spawned.executable).toBe(`${active.bundleRoot}/bin/runtime`);
    expect(spawned.executable).not.toBe(process.execPath);
    expect(spawned.argv).toStrictEqual([join(fixture.paths.home, "bin", "developer-os.mjs"), "init"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(f) returns exit 6 without spawning when the retained bundle manifest is altered", async () => {
    const fixture = await createCommandFixture("refresh-invalid", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleManifestHash: string };
    await nodeFs.appendFile(join(fixture.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`), " ");
    expect(await refreshActiveRelease(fixture.context)).toBe(EXIT_CODES.recoveryRequired);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/update/refresh.v2.test.ts`. Expected: FAIL at compile time, because `./refresh.js` does not exist.

- [ ] **Step 3: Implement** `apps/cli/src/update/refresh.ts`:

```ts
import { spawn } from "node:child_process";

import { EXIT_CODES } from "@developer-os/core";
import type { ExitCode } from "@developer-os/core";

import type { CliContext } from "../context.js";
import { readActiveReleaseTree } from "../instructions/active-release.js";
import { InstructionRefusal } from "../instructions/attach.js";
import { entrypointPath } from "./local-release.js";

/** C2: the refresh is plain `init`; on an installed home it renders from the active bundle. */
export const REFRESH_ARGV = ["init"] as const;
/** The child's stdout would break the parent's one `--json` line; its stderr is the diagnostic. */
export const REFRESH_STDIO = ["ignore", "ignore", "inherit"] as const;

export interface RefreshProcessV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The launcher's closed environment (Spec 2 §3.1, `apps/launcher/src/environment.ts`): never `PATH`, nothing inherited. */
export function refreshEnvironment(context: CliContext): Record<string, string> {
  const brain = context.env.DEVELOPER_OS_BRAIN;
  return {
    HOME: context.userHome,
    DEVELOPER_OS_HOME: context.paths.home,
    ...(brain === undefined || brain === "" ? {} : { DEVELOPER_OS_BRAIN: brain }),
  };
}

function noTree(context: CliContext): never {
  throw new InstructionRefusal({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired, paths: [context.paths.stateDir], recovery: "developer-os doctor" });
}

/** The newly active runtime on the version-free entrypoint: a rollback has already retired the runtime this process came from. */
export async function refreshProcess(context: CliContext): Promise<RefreshProcessV1> {
  // `update` admits only package-channel homes, so a null tree here is a broken home.
  const tree = (await readActiveReleaseTree(context)) ?? noTree(context);
  return { executable: `${tree.bundleRoot}/${tree.runtimeEntrypoint}`, argv: [entrypointPath(context.paths.home), ...REFRESH_ARGV], env: refreshEnvironment(context) };
}

/** 0–6 are the product's own codes; a signal, `null`, or a shell's 126/127 is an operational failure. */
export function refreshExitCode(code: number | null): ExitCode {
  return code !== null && Number.isInteger(code) && code >= 0 && code <= 6 ? (code as ExitCode) : EXIT_CODES.operationalFailure;
}

export function runRefreshProcess(request: RefreshProcessV1): Promise<ExitCode> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, [...request.argv], { env: { ...request.env }, stdio: [...REFRESH_STDIO] });
    child.once("error", () => resolve(EXIT_CODES.operationalFailure));
    child.once("close", (code) => resolve(refreshExitCode(code)));
  });
}

/** `CliUpdateContext.refresh` in production. Never throws: the swap has happened and only an exit code is left to report. */
export async function refreshActiveRelease(context: CliContext): Promise<ExitCode> {
  try {
    return await runRefreshProcess(await refreshProcess(context));
  } catch (error) {
    return error instanceof InstructionRefusal ? error.code : EXIT_CODES.operationalFailure;
  }
}
```

`// ponytail: no timeout on the child, as the launcher sets none; add one if a hung refresh is ever observed.`

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS. Case (c) needs `dist`, so `npx tsc -b` runs first. Then run `npm run lint`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/update/refresh.ts apps/cli/src/update/refresh.v2.test.ts
git commit -m "feat(update): spawn init on the active release's runtime with the launcher's closed environment (NEW-200, K8)"
```

---

### Task 3: `init` on an installed home without `--adapters` renders from the active bundle (M), after `task/t11b-11fix`

**Files:**
- Modify: `apps/cli/src/commands/init.ts` (`settleExistingV2`, around line 340)
- Modify: `apps/cli/src/main.ts` (`CliContextFactory` request type around line 242; the `createContext` call in `dispatch` around line 750)
- Modify: `apps/cli/src/bin.ts` (`admitPackageChannelKeg`, lines 29–43; the factory call around line 185)
- Modify: `apps/cli/src/update/packaged-release.ts` (new `isReleaseMismatch` beside `isPackageSourceAbsent`, line 702)
- Test: `apps/cli/src/commands/init-instructions.v2.test.ts` (new `describe`), `apps/cli/src/main.test.ts` (line 1485 case), `apps/cli/src/update/packaged-release.test.ts`

**Interfaces:**
- Consumes: `applyInstructions` with `source: "active-release"` (Task 1).
- Produces:
  - The `CliContextFactory` request gains `readonly packageMismatchIsAbsent?: boolean`. `dispatch` sets it to `true` for `init` without `--adapters` and to `false` otherwise.
  - `packaged-release.ts`: `export function isReleaseMismatch(error: unknown): boolean`
  - `settleExistingV2` passes `source: "active-release"` whenever `options.adapters` is null.

- [ ] **Step 1: Write the failing tests.**

`apps/cli/src/commands/init-instructions.v2.test.ts` (it already has `home`, `options`, `manifestOf`, `existsSync`, `inventoryDigest`):

```ts
describe("init without --adapters renders from the active bundle (K8, C2, one chained home)", () => {
  let installed: Home;
  let skillPath: string;

  it("(a) restores a deleted managed file with the keg removed", async () => {
    installed = await home("init-active-render");
    expect((await runInit(installed.fixture.context, options(["claude"]))).ok).toBe(true);
    const skill = (await manifestOf(installed.fixture)).artifacts.find((row) => row.kind === "instruction" && row.owner === "claude" && row.path.endsWith("/SKILL.md"));
    if (skill === undefined) throw new Error("no rendered skill");
    skillPath = skill.path;
    await nodeFs.rm(skillPath);
    await nodeFs.rm(join(installed.fixture.root, "prefix"), { recursive: true, force: true });
    const kegless = await createCommandFixture("init-active-render-kegless", { root: installed.fixture.root, runner: installed.fixture.context.runner, agents: AGENTS });

    const result = await runInit(kegless.context, options(null));

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(existsSync(skillPath)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(b) keeps release_mismatch for init --adapters with no keg", async () => {
    const kegless = await createCommandFixture("init-active-render-adapters", { root: installed.fixture.root, runner: installed.fixture.context.runner, agents: AGENTS });
    const result = await runInit(kegless.context, options(["claude"]));
    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
```

Case (b)'s expected code stays 4. Today, with no keg, it is `packaged_release_unavailable`, and with a mismatched keg it is `release_mismatch` from `bin.ts`. Both are unchanged by C2.

`apps/cli/src/commands/init-local-release.v2.test.ts`, inside `describe("init --local-release")`. It reuses the file's `temporaryHome`, `productionFactory` and `writeUnsignedLocalRelease` setup:

```ts
  it("(c) re-runs init without flags on an unsigned-local home unchanged: no exit 6 from the active-tree reader (C2)", async () => {
    const { root, home } = await temporaryHome("init-local-release-rerun");
    const dir = await writeUnsignedLocalRelease({ outDir: join(root, "pkg"), version: PRODUCT_VERSION, bundleFiles: [{ relativePath: "instructions/catalog.json", bytes: new TextEncoder().encode('{"artifacts":[],"schemaVersion":1}\n'), mode: 0o600 }] });
    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), productionFactory(home))).toBe(EXIT_CODES.success);
    const io = new RecordingIo();
    expect(await run(["init", "--yes"], io, productionFactory(home)), io.err.join("\n")).toBe(EXIT_CODES.success);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
```

Add `apps/cli/src/commands/init-local-release.v2.test.ts` to this task's **Files** and commit.

`apps/cli/src/main.test.ts` line 1485 case: add `["init", "--dry-run", "--adapters", "claude"]` as a third run and expect:

```ts
    expect(seen).toEqual([
      { localRelease: null, packageChannelInit: true, packageMismatchIsAbsent: true },
      { localRelease: "/x", packageChannelInit: false, packageMismatchIsAbsent: true },
      { localRelease: null, packageChannelInit: true, packageMismatchIsAbsent: false },
      { localRelease: null, packageChannelInit: false, packageMismatchIsAbsent: false },
    ]);
```

with the runs ordered `init --dry-run`, `init --dry-run --local-release /x`, `init --dry-run --adapters claude`, `doctor`.

`apps/cli/src/update/packaged-release.test.ts`: add a case asserting that `isReleaseMismatch` recognizes exactly what `admitPackageChannelRelease` throws for a version split:

```ts
  it("classifies a version split as release_mismatch, and nothing else (C2)", async () => {
    const error = await admitPackageChannelRelease(/* the file's existing mismatched-version keg fixture */).catch((caught: unknown) => caught);
    expect(isReleaseMismatch(error)).toBe(true);
    expect(isReleaseMismatch(new PackagedReleaseError(EXIT_CODES.recoveryRequired, "release_mismatch"))).toBe(false);
  });
```

Use the file's existing `requireVersion` mismatch case as the source of the first call; it already builds a keg whose version differs.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/main.test.ts -t "package channel only for init"`. Expected: FAIL, because the request has no `packageMismatchIsAbsent`. Run `npx vitest run apps/cli/src/commands/init-instructions.v2.test.ts -t "renders from the active bundle"`. Expected: (a) FAILS with `packaged_release_unavailable`, exit 4. Run `npx vitest run apps/cli/src/update/packaged-release.test.ts -t "release_mismatch, and nothing else"`. Expected: FAIL at compile time.

- [ ] **Step 3: Implement.**

`apps/cli/src/update/packaged-release.ts`:

```ts
/** C2: a keg whose version differs from this build: on an installed home, `init` without `--adapters` treats it as no keg. */
export function isReleaseMismatch(error: unknown): boolean {
  return error instanceof PackagedReleaseError && error.code === EXIT_CODES.capabilityUnavailable && error.message === "release_mismatch";
}
```

`apps/cli/src/bin.ts`:

```ts
async function admitPackageChannelKeg(mismatchIsAbsent: boolean): Promise<PackagedReleaseSourceV1 | null> {
  // … unchanged body, with the catch:
  } catch (error) {
    if (isPackageSourceAbsent(error) || (mismatchIsAbsent && isReleaseMismatch(error))) return null;
    throw error;
  }
}
// in the factory:
          : request.packageChannelInit
            ? await admitPackageChannelKeg(request.packageMismatchIsAbsent === true)
            : null,
```

`apps/cli/src/main.ts`: the request type gains `/** C2: \`init\` without \`--adapters\` renders an installed home from its active bundle, so a mismatched keg is no handoff. */ readonly packageMismatchIsAbsent?: boolean;`, and `dispatch` passes `packageMismatchIsAbsent: invocation.command === "init" && invocation.values.adapters === undefined`.

`apps/cli/src/commands/init.ts` `settleExistingV2`:

```ts
    warnings = (await applyInstructions(context, {
      selection: options.adapters ?? null,
      release: bootstrap?.state === "available" ? await inspectPackagedRelease(bootstrap.packagedRelease) : null,
      // C2: a re-run without --adapters renders from the active bundle (K8's refresh is this run).
      ...(options.adapters == null ? { source: "active-release" as const } : {}),
    })).warnings;
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run all three commands from step 2 and `npx vitest run apps/cli/src/commands/init-local-release.v2.test.ts -t "re-runs init without flags"`. Expected: PASS. Run `npx vitest run apps/cli/src/main.test.ts apps/cli/src/commands/init.test.ts apps/cli/src/update/packaged-release.test.ts` (whole files). Expected: PASS. Run `npm run lint`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/commands/init.ts apps/cli/src/main.ts apps/cli/src/bin.ts apps/cli/src/update/packaged-release.ts apps/cli/src/update/packaged-release.test.ts apps/cli/src/main.test.ts apps/cli/src/commands/init-instructions.v2.test.ts apps/cli/src/commands/init-local-release.v2.test.ts
git commit -m "feat(init): a re-run without --adapters renders from the active bundle, keg optional (NEW-200, K8, C2)"
```

---

### Task 4: `doctor` warns while rows predate the active release (S), after `task/t11b-11fix`

**Files:**
- Modify: `apps/cli/src/commands/doctor.ts` (`InstalledCatalog` and `readInstalledCatalog` around lines 1365–1397, `inspectInstructions` around line 1517, `instructionAdvisories`)
- Test: `apps/cli/src/commands/doctor-instructions.v2.test.ts` (new case in "doctor names every instruction artifact", line 299)

**Interfaces:**
- Consumes: the row stamp only (C1 makes it meaningful once Task 5 lands).
- Produces: the `instructions` check warns with `workflows not refreshed: <n> instruction rows were rendered by a release other than the active <version>; run developer-os init`. A drift failure (exit 3) still outranks the warning.

- [ ] **Step 1: Write the failing test.** `install` (line 123) is the file's setup; `sha`, `check`, `encoder` and `MAX_MANIFEST_BYTES` are already defined there.

```ts
  it("warns while any instruction row's productVersion differs from the active release (K8, C1)", async () => {
    const { fixture } = await install("doctor-instructions-stale", { vendors: ["claude"] });
    const before = new Uint8Array(await nodeFs.readFile(fixture.paths.manifestFile));
    const manifest = decodeCanonicalJson(before, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { version: string };
    const stale = manifest.artifacts.filter((row) => row.kind === "instruction").length;
    expect(stale).toBeGreaterThan(0);
    const older = { ...manifest, artifacts: manifest.artifacts.map((row) => (row.kind === "instruction" ? { ...row, productVersion: "0.9.0" } : row)) };
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("no lifecycle context");
    await withLifecycleMutation(fixture.context, lifecycle, () => fixture.context.executor.execute({
      kind: "instructions",
      mutations: [{ targetPath: fixture.paths.manifestFile, operation: "replace", content: encoder.encode(encodeCanonicalJson(older as unknown as CanonicalJsonValue)), expectedBeforeHash: sha(before) }],
    }));

    const finding = check(await runDoctorReport(fixture.context), "instructions");

    expect(finding.status).toBe("warn");
    expect(finding.message).toContain(`workflows not refreshed: ${String(stale)} instruction rows were rendered by a release other than the active ${active.version}; run developer-os init`);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx tsc -b && npx vitest run apps/cli/src/commands/doctor-instructions.v2.test.ts -t "differs from the active release"`. Expected: FAIL, because `status` is `pass`.

- [ ] **Step 3: Implement.**
  - `InstalledCatalog` gains `readonly activeVersion: string | null`. `readInstalledCatalog` returns `activeVersion: null` with no record and otherwise the record's `version`. Its early return, and the `vendors.length === 0` default in `inspectInstructions`, become `{ rows: [], workflowIds: new Set(), activeVersion: null }`.
  - In `inspectInstructions`, on the pass path:

```ts
  const staleRows = catalog.activeVersion === null
    ? 0
    : manifest.artifacts.filter((row) => row.kind === "instruction" && vendors.includes(row.owner as Vendor) && row.productVersion !== catalog.activeVersion).length;
  return { statuses, finding: instructionAdvisories(context, statuses, `${String(statuses.length)} instruction artifacts match their record`, staleRows === 0 ? null : { rows: staleRows, version: catalog.activeVersion as string }) };
```

  - `instructionAdvisories` gains `stale: { readonly rows: number; readonly version: string } | null` and puts `` `workflows not refreshed: ${String(stale.rows)} instruction rows were rendered by a release other than the active ${stale.version}; run developer-os init` `` first in `warnings`.

- [ ] **Step 4: Run the test and confirm it passes.** Run the same command. Expected: PASS. Run `npx vitest run apps/cli/src/commands/doctor.test.ts`. Expected: PASS. Run `npm run lint`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor-instructions.v2.test.ts
git commit -m "feat(doctor): warn while instruction rows predate the active release (NEW-200, K8, C1)"
```

---

### Task 5: `update` and `update rollback` refresh after the swap; the swap stops restamping; the lifecycle proof (L)

**Files:**
- Modify: `apps/cli/src/update/context.ts` (`CliUpdateContext` around line 101; `createCliUpdateContext` around line 544)
- Modify: `apps/cli/src/commands/update/index.ts` (`runUpdate`; new `refreshed`)
- Modify: `apps/cli/src/update/planning.ts` (around lines 344–348)
- Modify: `apps/cli/src/update/compose.ts` (around lines 1007–1009)
- Modify: `apps/cli/src/update/testing.ts` (`SyntheticReleaseOptionsV1`, `syntheticBundle`, `createOnDiskReleaseWorld`, `onDiskUpdateContext`, `installUpdatableHome`)
- Modify: `apps/cli/src/commands/testing.ts` (export `repositoryWorkflowFiles`, line 474)
- Test: `apps/cli/src/commands/update/index.test.ts`, `apps/cli/src/update/planning.test.ts` (line 120 case), `apps/cli/src/update/compose.test.ts` (line 437 case), `tests/e2e/release-update.test.ts`

**Interfaces:**
- Consumes: `refreshActiveRelease(context): Promise<ExitCode>` (Task 2); `runInit` with `adapters: null` rendering from the active bundle (Task 3); the doctor warning (Task 4); `settle()` stamping and the `opt` hook Node (Task 1).
- Produces:
  - `CliUpdateContext.refresh?: () => Promise<ExitCode>`. It never throws; when absent, no refresh runs.
  - `commands/update/index.ts`: `export const WORKFLOWS_NOT_REFRESHED = "workflows not refreshed: run developer-os init";`
  - `update/testing.ts`: `SyntheticReleaseOptionsV1.extraFiles?: (architecture: SyntheticArchitectureV1) => ReadonlyMap<string, Uint8Array>`; `createOnDiskReleaseWorld` option `instructions?: boolean`; `onDiskUpdateContext` binds `refresh` in-process.

- [ ] **Step 1: Write the failing tests.**

`apps/cli/src/commands/update/index.test.ts`, inside `describe("runUpdate")`:

```ts
  it.each([
    [{ kind: "update", version: null, apply: true, json: false }, "applied"],
    [{ kind: "rollback", apply: true, json: false }, "rolled_back"],
  ] as const)("refreshes once after a successful %j and keeps the result (K8)", async (invocation, outcome) => {
    const commandFixture = await createCommandFixture(`update-refresh-${invocation.kind}`);
    const update = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
    const apply: UpdateApplyPortsV1 = { ...unreachableApplyPorts(), withGlobalLock: (work) => work(), closure: () => Promise.resolve({ kind: "clear" }), composeRollback: () => Promise.reject(new Error("unreachable")) };
    vi.mocked(applyUpdate).mockImplementationOnce((_update, prepared) => Promise.resolve({ schemaVersion: 1, outcome: "applied", active: prepared.inputs.target, rollbackAvailable: true }));
    vi.mocked(applyRollback).mockImplementationOnce((_update, preview) => Promise.resolve({ schemaVersion: 1, outcome: "rolled_back", active: preview.target, rollbackAvailable: false }));
    const refresh = vi.fn(() => Promise.resolve(EXIT_CODES.success));
    const result = await runUpdate({ ...commandFixture.context, update: { ...update.update, apply, refresh } }, invocation);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.outcome).toBe(outcome);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("exits with the refresh's code and K8's message, keeping the swap in data (K8)", async () => {
    const commandFixture = await createCommandFixture("update-refresh-fails");
    const update = createUpdateFixture();
    const apply: UpdateApplyPortsV1 = { ...unreachableApplyPorts(), withGlobalLock: (work) => work(), closure: () => Promise.resolve({ kind: "clear" }) };
    vi.mocked(applyUpdate).mockImplementationOnce((_update, prepared) => Promise.resolve({ schemaVersion: 1, outcome: "applied", active: prepared.inputs.target, rollbackAvailable: true }));
    const result = await runUpdate({ ...commandFixture.context, update: { ...update.update, apply, refresh: () => Promise.resolve(EXIT_CODES.decisionRequired) } }, { kind: "update", version: null, apply: true, json: true });

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.decisionRequired, error: { kind: "workflows_not_refreshed", message: "workflows not refreshed: run developer-os init", recovery: "developer-os init" } });
    if (!result.ok) expect(result.error.data).toMatchObject({ outcome: "applied" });
  });

  it("does not refresh after a preview or an automatic rollback (K8)", async () => {
    const commandFixture = await createCommandFixture("update-refresh-not");
    const update = createUpdateFixture();
    const refresh = vi.fn(() => Promise.resolve(EXIT_CODES.success));
    await runUpdate({ ...commandFixture.context, update: { ...update.update, refresh } }, { kind: "update", version: null, apply: false, json: false });
    const apply: UpdateApplyPortsV1 = { ...unreachableApplyPorts(), withGlobalLock: (work) => work(), closure: () => Promise.resolve({ kind: "clear" }) };
    vi.mocked(applyUpdate).mockImplementationOnce((_update, prepared) => Promise.resolve({ schemaVersion: 1, outcome: "rolled_back_automatically", active: prepared.inputs.current, cause: parseSafeReasonCode("update_step_not_applied") }));
    await runUpdate({ ...commandFixture.context, update: { ...update.update, apply, refresh } }, { kind: "update", version: null, apply: true, json: false });
    expect(refresh).not.toHaveBeenCalled();
  });
```

Extend the existing "stops after a resumed %j coordinator finalizes" case (line 240): pass `refresh: vi.fn(() => Promise.resolve(EXIT_CODES.success))` and assert `toHaveBeenCalledTimes(1)`.

**C1 contract change, the two K7 (f) tests:**
- `apps/cli/src/update/planning.test.ts` line 120: rename it to "carries an attached instruction row unchanged, its stamp included; the refresh restamps it (NEW-171, C1 reverses K7 (f))" and assert `expect(row).toStrictEqual(syntheticInstructionRow());`.
- `apps/cli/src/update/compose.test.ts` line 437: rename it to "carries an attached instruction row unchanged through rollback, its stamp included (NEW-171, C1 reverses K7 (f))", drop the "restores 1.0.0" comment, and assert `toEqual([attached])`.

`tests/e2e/release-update.test.ts`:
- Import `EXIT_CODES` from `@developer-os/core` and `runDoctorReport` from `@developer-os/cli/dist/commands/doctor.js`.
- Replace `instructionRows` and add the helpers:

```ts
/** C1: after every successful command each instruction row carries the active release's stamp, which the refresh writes. */
function instructionPaths(manifest: InstallationManifestV2): readonly string[] {
  return manifest.artifacts.flatMap((row) => {
    if (row.kind !== "instruction") return [];
    expect(row.productVersion).toBe(manifest.productVersion);
    return [row.path];
  });
}

/** The triage skill the refresh re-renders from the active release, and the plugin hooks that must survive every swap. */
async function rendered(lifecycle: Lifecycle): Promise<{ readonly skill: string; readonly hooks: string }> {
  const rows = (await manifestOf(lifecycle.home)).artifacts;
  const skill = rows.find((row) => row.kind === "instruction" && row.owner === "claude" && row.path.endsWith("/SKILL.md"));
  const hooks = rows.find((row) => row.owner === "claude" && row.path.endsWith("/hooks/hooks.json"));
  if (skill === undefined || hooks === undefined) throw new Error("the home has no rendered triage skill or hooks");
  return { skill: await nodeFs.readFile(skill.path, "utf8"), hooks: await nodeFs.readFile(hooks.path, "utf8") };
}

/** C3: the hooks' Node, through the fixture table's fixed `opt` link. */
function optNode(lifecycle: Lifecycle): string {
  return join(lifecycle.home.world.prefix, "opt", "developer-os", "libexec", "fallback", "bundle", "bin", "runtime");
}

/** The hooks name the opt Node, and it runs whichever keg `world.install` linked. */
function expectHooksRun(lifecycle: Lifecycle, hooks: string): void {
  expect(hooks).toContain(`${optNode(lifecycle)} ${join(lifecycle.home.fixture.paths.home, "bin", "developer-os.mjs")} `);
  expect(spawnSync(optNode(lifecycle), ["-e", "process.exit(0)"]).status).toBe(0);
}
```

- In the lifecycle case, `const attached = instructionPaths(lifecycle.manifests[0] as InstallationManifestV2)`, compared with `toStrictEqual(attached)` wherever `instructionRows(...)` was compared. Then:
  - after the 1.1.0 apply: `const at110 = await rendered(lifecycle); expect(at110.skill).toContain("\nTriage.\n"); expectHooksRun(lifecycle, at110.hooks);`
  - after `world.install("1.2.0")` and the 1.2.0 apply: `const at120 = await rendered(lifecycle); expect(at120.skill).toContain("Triage, then reproduce."); expect(at120.hooks).toBe(at110.hooks); expectHooksRun(lifecycle, at120.hooks);`
  - after the rollback (1.2.0's bundle retired): `expect(await rendered(lifecycle)).toStrictEqual(at110); expectHooksRun(lifecycle, at110.hooks);`
  - after the reapply: `expect(await rendered(lifecycle)).toStrictEqual(at120);`
- In case (d), after the rollback with the prefix deleted: `const restored = await rendered(lifecycle); expect(restored.skill).toContain("\nTriage.\n"); expect(restored.hooks).toContain(optNode(lifecycle));`. Do not run the Node here; that is the accepted residual with no keg.
- Add case (e):

```ts
  // Review Focus 4: the swap stands, the update exits with the refresh's code, and doctor warns until a refresh succeeds.
  it.each(SYNTHETIC_ARCHITECTURES)("(e) keeps the swap and exits with the refresh's code when the refresh refuses (K8) on %s", async (architecture) => {
    const lifecycle = await start(architecture, "refresh-refused");
    // An override skill with no SKILL.md: user data the update admits, which §12.1 refuses at render (exit 2).
    const override = join(lifecycle.home.fixture.paths.home, "instructions", "claude", "skills", "broken");
    await nodeFs.mkdir(override, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(override, "notes.md"), "no SKILL.md here\n", { mode: 0o600 });

    const result = await runUpdate(lifecycle.context, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "workflows_not_refreshed", message: "workflows not refreshed: run developer-os init" } });
    expect(await activeVersion(lifecycle)).toBe("1.1.0");
    const rows = (await manifestOf(lifecycle.home)).artifacts.filter((row) => row.kind === "instruction");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.productVersion === "1.0.0")).toBe(true);
    await nodeFs.rm(override, { recursive: true });
    const instructions = (await runDoctorReport(lifecycle.home.fixture.context)).checks.find((finding) => finding.id === "instructions");
    expect(instructions).toMatchObject({ status: "warn", message: expect.stringContaining("workflows not refreshed") as unknown });

    expect(await lifecycle.home.update().refresh?.()).toBe(EXIT_CODES.success);
    expect((await manifestOf(lifecycle.home)).artifacts.filter((row) => row.kind === "instruction").every((row) => row.productVersion === "1.1.0")).toBe(true);
  }, LIFECYCLE_TIMEOUT_MS);
```

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run `npx tsc -b && npx vitest run apps/cli/src/commands/update/index.test.ts -t "refresh"`. Expected: FAIL at compile time, because `refresh` is not a key of `CliUpdateContext`. Once it compiles, the failure case may still go red inside `failure()` (`packages/core/src/result.ts` hardens `data`) if a frozen published `result.data` is refused. In that case pass a plain copy, `data: { ...result.data }`.
  - Run `npx vitest run apps/cli/src/update/planning.test.ts -t "carries an attached instruction row"` and `npx vitest run apps/cli/src/update/compose.test.ts -t "carries an attached instruction row"`. Expected: FAIL, because the stamp is restamped to the target.
  - Run `npx tsc -b && npx vitest run tests/e2e/release-update.test.ts -t "arm64"`. Expected: FAIL at the 1.1.0 apply. No refresh runs, so the skill rows keep the restamped 1.1.0 stamp in a home that never rendered 1.1.0, and the 1.2.0 skill never appears.

- [ ] **Step 3: Implement.**

`apps/cli/src/update/context.ts`. Add to `CliUpdateContext`:

```ts
  /**
   * K8: after a finalized apply or rollback, with the global lock released, re-render the stored
   * adapters from the newly active release. Returns that run's exit code and never throws. Absent,
   * nothing is refreshed (unit contexts); production spawns `<active runtime> <home>/bin/developer-os.mjs init`.
   */
  readonly refresh?: () => Promise<ExitCode>;
```

and bind `refresh: () => refreshActiveRelease(context),` in `createCliUpdateContext` (import from `./refresh.js`).

`apps/cli/src/commands/update/index.ts`:

```ts
export const WORKFLOWS_NOT_REFRESHED = "workflows not refreshed: run developer-os init";

/** K8: a refresh failure never reverts the swap; the command exits with the refresh's code and keeps the result in `data`. */
async function refreshed(update: CliUpdateContext, result: CliResult<UpdateCommandResultV1>): Promise<CliResult<UpdateCommandResultV1>> {
  if (!result.ok || update.refresh === undefined || (result.data.outcome !== "applied" && result.data.outcome !== "rolled_back")) return result;
  const code = await update.refresh();
  if (code === EXIT_CODES.success) return result;
  return failure(code, { kind: "workflows_not_refreshed", message: WORKFLOWS_NOT_REFRESHED, paths: [], recovery: "developer-os init", data: result.data });
}
```

In `runUpdate`: `if (invocation.apply) return await refreshed(update, await runRollbackApply(update));` and `if (invocation.apply) return await refreshed(update, await runApply(update, invocation.version));`. Both inner functions return from inside `withGlobalLock`, so the lock is released here. The resumed finalized arm returns through them, so it refreshes too.

`apps/cli/src/update/planning.ts` (around line 344):

```ts
    // Instruction rows never reach the planner (NEW-171) and are carried unchanged, stamp included
    // (C1, reversing K7 (f)): the K8 refresh restamps what it renders, so doctor sees a missed refresh.
    artifacts: [...rows, ...home.manifest.artifacts.filter((row) => row.kind === "instruction")].sort(compareManifestRows),
```

`apps/cli/src/update/compose.ts`: delete the restamp loop at around lines 1007–1009 and its comment. Put in its place: `// Instruction rows never reach a planner or an inverse (NEW-171): carried unchanged (C1); the K8 refresh restamps them.`

`apps/cli/src/commands/testing.ts`: add `export` to `async function repositoryWorkflowFiles()`.

`apps/cli/src/update/testing.ts`:
- `SyntheticReleaseOptionsV1` gains `/** Adds \`0600\` files beside \`BUNDLE_FILES\`, e.g. \`instructions/\` and \`workflows/\`; their parents become directory entries. */ readonly extraFiles?: (architecture: SyntheticArchitectureV1) => ReadonlyMap<string, Uint8Array>;`
- `syntheticBundle` (`files` becomes a mutable `Map`):

```ts
  const extra = options.extraFiles?.(architecture) ?? new Map<string, Uint8Array>();
  for (const [path, bytes] of extra) files.set(path, bytes);
  const directories = new Set(["bin"]);
  for (const path of extra.keys()) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) directories.add(parts.slice(0, depth).join("/"));
  }
  // entries:
    entries: [
      ...[...directories].map((path) => ({ path, kind: "directory", mode: 448 })),
      ...[...files].map(([path, bytes]) => ({ path, kind: "file", mode: extra.has(path) ? 384 : 448, bytes: String(bytes.byteLength), sha256: sha256(bytes) })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
```

- `createOnDiskReleaseWorld` gains `readonly instructions?: boolean`:

```ts
/** Release 1.2.0's triage skill: the rendered change an update brings and a rollback takes back (NEW-200). */
const TRIAGE_1_2_0 = encoder.encode("---\nname: triage\ndescription: Triage a defect.\n---\nTriage, then reproduce.\n");

/** Every release's `workflows/` (the repository's) and `instructions/`; 1.2.0 changes the triage skill. */
async function releaseTree(): Promise<(version: string) => ReadonlyMap<string, Uint8Array>> {
  const workflows = (await repositoryWorkflowFiles()).map((file) => [file.relativePath.slice("bundle/".length), file.bytes] as const);
  return (version) => new Map([
    ...workflows,
    ...SYNTHETIC_INSTRUCTIONS.map((file) => [`instructions/${file.relativePath}`, version === "1.2.0" && file.relativePath === "skills/triage/SKILL.md" ? TRIAGE_1_2_0 : file.bytes] as const),
  ]);
}

  // in createOnDiskReleaseWorld:
  const tree = options.instructions === true ? await releaseTree() : null;
  const releases = new Map(options.releases.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, { files: files(spec.version), ...(tree === null ? {} : { extraFiles: () => tree(spec.version) }) }, options.architecture)]));
  // and each keg file keeps the manifest's permission class:
      bundleFiles: [...release.files].map(([relativePath, bytes]) => ({ relativePath, bytes, mode: release.manifest.entries.some((entry) => entry.path === relativePath && entry.mode === 448) ? 0o700 : 0o600 })),
```

- `installUpdatableHome` passes `instructions` through to `createOnDiskReleaseWorld`.
- `onDiskUpdateContext` gains the refresh. The synthetic `bin/cli` cannot load a CLI, and the fixture's Claude is invisible to a child without `PATH`, so the e2e runs the same `init` in-process:

```ts
    // K8's child, in process: plain `init` over this context renders from the active bundle (C2).
    refresh: async () => (await runInit(context, { dryRun: false, assumeYes: true })).code,
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run the commands from step 2, then `npx tsc -b && npx vitest run tests/e2e/release-update.test.ts`. Expected: PASS on arm64 and x64 for the lifecycle case and cases (d) and (e).
  - **If (e) exits with a code other than 2:** read the refusal. If the update refuses the override before the swap, use an occupied target instead: an unmanaged file at the Claude target of a skill that only 1.2.0's catalog adds (`instruction_target_occupied`, `EXIT_CODES.decisionRequired`).
  - Run `npx vitest run apps/cli/src/commands/update/index.test.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/compose.test.ts` (whole files). Expected: PASS.
  - `tests/integration/update/recovery.test.ts` and `tests/security/{interruption,sentinel,symlink-escape}.test.ts` call `runUpdate` through `onDiskUpdateContext` and now run the in-process `init` (adapters `none`: no gate entry). They are deferred to plan close (D32).
  - Run `npm run lint`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/update/context.ts apps/cli/src/commands/update/index.ts apps/cli/src/commands/update/index.test.ts apps/cli/src/update/planning.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/compose.ts apps/cli/src/update/compose.test.ts apps/cli/src/update/testing.ts apps/cli/src/commands/testing.ts tests/e2e/release-update.test.ts
git commit -m "feat(update): refresh after apply and rollback, carry instruction rows unchanged, prove skill and stable hook (NEW-200, K8, C1)"
```

---

### Task 6: Amend Spec 2 K8 with the three rulings (S; the controller writes the spec)

**Files:**
- Modify (controller only): `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`. Insert after K8's paragraph, inside the "Amended 2026-10-07 (D84, Task 11b)" block, as **K8 rulings (founder, 2026-10-08)**.

This task supplies the exact sentences. The controller places and words the surrounding text.

- [ ] **Step 1: The sentences to add, verbatim.**
  1. "**C1.** K7 (f) is withdrawn: neither `update --apply` nor `update rollback --apply` restamps instruction rows. Both carry the rows unchanged, `productVersion` included, as K5 states. The K8 refresh stamps every row it renders at the active release's version, so `doctor`'s warning names exactly the rows that no refresh has rendered since the swap."
  2. "**C2.** `init` on an installed V2 home without `--adapters` renders from the active bundle's `instructions/` and `workflows/` and does not need the keg. An absent keg, or a keg whose version differs from the active release, is no packaged handoff rather than `release_mismatch`. The refresh K8 names is exactly this `init`, spawned as `<active runtime> <product home>/bin/developer-os.mjs init`, and the public grammar is unchanged. `init --adapters` keeps §12.3's keg render and its `release_mismatch` rule, and any other keg admission failure still refuses with exit 6. A home whose trust is not `package-channel` keeps its previous `init` behaviour."
  3. "**C3.** On a `package-channel` home every rendered hook names Node through the fixed `opt` path of K2's table for the active release's architecture, `<opt>/libexec/fallback/bundle/<runtimeEntrypoint>` (on arm64, `/opt/homebrew/opt/developer-os/libexec/fallback/bundle/bin/node`), and never a `releases/<version>` path. No release swap or retirement therefore changes or breaks a hook. An `unsigned-local` home keeps naming the Node that ran `init`. The hook exit-2 rule for a release that cannot load is unchanged. Accepted residuals: with the keg removed by `brew uninstall` but no `developer-os uninstall`, every hook exits 127, which neither vendor blocks on; between `brew upgrade` and `update`, hooks run the new keg's Node on the active release's code."
  4. "The refresh's environment is exactly `HOME`, `DEVELOPER_OS_HOME` and, when set, `DEVELOPER_OS_BRAIN`, which is the launcher's (§3.1). Its stdout is discarded and its stderr inherited. A child exit outside 0–6, or a signal, maps to exit 1."
  5. "NEW-200's proof is that an update changes a skill, a rollback restores it, and `hooks/hooks.json` stays byte-identical across every swap. A change to the hook rows themselves is proved only on a real release (K6's gate)."
- [ ] **Step 2: The controller commits the spec edit** with `git add -f docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` and `git commit -m "docs(spec-2): K8 rulings C1-C3 (NEW-200, founder 2026-10-08)"`. Tasks 1–5 cite C1–C3 by these names.

---

### Task 7: Plan close (S, founder gate)

**Files:**
- Modify: `docs/architecture/foundation.md`
  - §12.3: "`init` without `--adapters` on an installed `package-channel` home renders from the active bundle (the new file apps/cli/src/instructions/active-release.ts (its readActiveReleaseTree)); `update` and `update rollback` run that `init` after the swap (the new file apps/cli/src/update/refresh.ts (its refreshActiveRelease))"
  - §12.3: the C3 hook Node
  - §12.6: the stale-stamp warning
- Modify: `docs/superpowers/BACKLOG.md` (close NEW-200 with the SHAs, repointed after the rebase merge; add a new row for the launchd plists' `stableNodePath` Node, the same defect class as C3)
- Modify: `docs/superpowers/plans/2026-10-07-task-11b-package-channel.md` Task 14 (VM gate: after `update --apply` and after `update rollback --apply`, `~/.claude/skills/developer-os/hooks/hooks.json` is byte-identical and names `/opt/homebrew/opt/developer-os/libexec/fallback/bundle/bin/node`; the Codex plugin manifest's `version` is the active release)

- [ ] **Step 1: Run the deferred suites on a quiet machine, detached** (no other agent running tests): `nohup npm run check > /tmp/n200-check.log 2>&1 &`, then wait for it with Monitor. Expected: exit 0. Show failures only. Then run `npm run test:pinned-host` and `npm run test:vendor-brain`. Expected: PASS.
- [x] **Step 2: `git diff --check` and `git status`** show only the doc changes (2026-10-08: docs done; Step 1 runs with Task 11b Task 14's suites). Commit them with exact paths:

```bash
git add -f docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-10-07-task-11b-package-channel.md docs/superpowers/plans/2026-10-08-new-200-active-release-refresh.md
git add docs/architecture/foundation.md
git commit -m "docs: NEW-200 code complete: foundation §12.3/§12.6, close NEW-200, VM gate for the stable hook Node"
```

---

## Self-review

- **Spec coverage (K8 plus C1–C3):**

  | Requirement | Task |
  |---|---|
  | Runs only after a successful apply or rollback, once finalized | Task 5 `refreshed` |
  | Runs `<home>/bin/developer-os.mjs`, the newly active code | Task 2 (plain `init`, C2) |
  | §12.3's reconcile with the stored `adapters.*` | Task 3 (`adapters: null`) |
  | Its own gate entry, after the lifecycle closed | Task 5 (after `withGlobalLock`) |
  | Render source is the active bundle, never the keg | Tasks 1 and 3 |
  | Works after `brew cleanup`, and `release_mismatch` does not apply | Task 3 (a), Task 5 (d) |
  | §12.3 rules stand | Task 1 (d), (e) |
  | Codex is re-registered with the release version | Unchanged `reconcileRegistration`; Task 7 gate |
  | A failure never reverts and exits with K8's message | Task 5 |
  | `doctor` warning | Task 4, with C1 in Tasks 1 and 5 |
  | C3 stable hook Node; `unsigned-local` keeps its behaviour | Task 1 (d), (g); Task 5 hook assertions |
  | Spec amendment | Task 6 |
  | Keep-all planner | No task touches it |

- **Placeholder scan:** Task 3's `packaged-release.test.ts` case reuses the file's existing mismatched-version keg fixture by reference. Everything else is concrete.
- **Type consistency:** `ReleaseTreeV1`, `ActiveReleaseTreeV1` (`runtimeEntrypoint`, `architecture`), `readActiveReleaseTree` (returns `null` for non-package-channel) and `hookNodePath` come from Task 1. `REFRESH_ARGV` and `refreshActiveRelease` come from Task 2. `packageMismatchIsAbsent` and `isReleaseMismatch` come from Task 3. `refresh?: () => Promise<ExitCode>` comes from Task 5. They are used consistently.
- **Review Focus:** each of the five lines names its owning test.
