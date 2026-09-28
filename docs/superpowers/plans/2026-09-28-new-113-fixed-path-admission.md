# NEW-113 Fixed-Path Admission for Git, launchctl and ssh — Implementation Plan

> **Status: approved by the founder on 2026-09-28 (D71).** The spec blocks are
> "Amended 2026-09-28 (D71)" in Spec 1 §4.2, §5.3, §7 and §8.3, plus the change-record row.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Replace the exact macOS build + binary SHA-256 pin for Git, `/bin/launchctl` and `/usr/bin/ssh`
with fixed-path admission (root ownership, no group/other write, a version floor and a capability
probe), expressed as a per-platform table, so that a macOS or Xcode update, or another Mac, no longer
refuses `git` and `automation` (D65, D71).

**Architecture:** A platform-neutral `SystemExecutableTableV1` contract and a `posix_root_owned`
predicate live in `packages/security`. The `darwin` rows (`/usr/bin/git`, `/usr/bin/ssh`,
`/bin/launchctl`) live in `packages/platform-macos` behind `PlatformAdapter`. The Linux and Windows
rows are recorded in the spec as intended and are not implemented. Git and launchd admission consume
per-invocation evidence (`dev`, `ino`, `size`, `sha256`) from that table and recheck it before every
real exec, where the pinned identity was checked before. The within-run TOCTOU protection stays; the
cross-machine pin goes.

**Tech Stack:** TypeScript strict, Node 24, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` §4.2, §5.3, §7,
§8.3 — the "Amended 2026-09-28 (D71)" blocks. Backlog: `docs/superpowers/BACKLOG.md` NEW-113
(line 57). Decisions: roadmap D65 (`plans/2026-09-04-developer-os-completion-roadmap.md:301-308`), which
supersedes D59 Q1/Q2 (`:223-230`) and plan 1b Task 19, and D71 below. Task 3 records D71 in the
roadmap.

**Execution rule (D70, as given in the task brief; the roadmap does not yet record D70):** tasks write
tests but do not run them. Each task commit runs `npm run lint` only. The full suite,
`npm run test:pinned-host` and a fresh-context review run at plan close (Task 4). Every "run the test"
step below reads "deferred to plan close (D70)".

---

## Founder decisions (D71, 2026-09-28)

- **Q1:** the admitted executable is the operating system's standard fixed path, not a discovered
  developer directory. On macOS: `/usr/bin/git`, the root-owned Apple shim that follows the
  `xcode-select` choice; `/bin/launchctl`; `/usr/bin/ssh`. The Git child environment carries no
  `DEVELOPER_DIR` or other `xcrun`-steering variable (residual 14). Ownership, mode, version-floor and
  capability-probe admission stay.
- **Platform neutrality:** admission is a per-platform table behind `PlatformAdapter`. The Linux rows
  (`/usr/bin/git`, `/usr/bin/ssh`, systemd user units instead of launchd) and the Windows row
  (`%ProgramFiles%\Git\cmd\git.exe`) are recorded as intended for a later platform package. No
  contract field may block them. Linux and Windows are not implemented in version 1.
- **Q2:** A — `certification` is dropped. The post-bootstrap observation is the runtime proof; failure
  compensates and refuses.
- **Q3:** A — ancestors `/`, `/usr` and `/usr/bin` (Git, ssh) and `/`, `/bin` (launchctl) are
  root-owned with no group/other write. Residual 13 records that the Git tree the shim executes, under
  `/Applications` for Xcode, is not admitted.
- **Q4:** A — local/file transport only in the Phase 9 gate. HTTPS and SSH stay refused (D59 Q4-A).

## Routine calls made without asking

- **Floors equal the measured 2026-09-23 row:** Git 2.54.0 / Apple Git-157, OpenSSH 10.3p1, macOS
  26.6.2. Nothing older was traced.
- **The darwin row's architecture stays `arm64`.** The capability line is derived from the row
  (`cpu: <row architecture>`), so an Intel row is a data change, not a contract change.
- **setuid/setgid targets and symbolic links at the standard path refuse.** No admitted Apple binary
  has either.
- **`git_remote_https` has no row** (`system: null`). It lives in the selected developer directory,
  and HTTPS stays refused (Q4), so its helper rule is designed together with the HTTPS trace.
- **The six exec-path links leave the contract.** The gateway's `GIT_EXEC_PATH` already hides them
  from every child.
- **`real_receive_pack` executes `/usr/bin/git receive-pack …`** (argv0 `git`) instead of argv0
  `git-receive-pack`. No Apple contract says the shim dispatches on argv0. The helper-to-gateway spawn
  argv is unchanged.
- **The `xcrun` scrub is by construction.** Environment profiles are exact maps, so the plan adds a
  test that pins the absence of `DEVELOPER_DIR`, `SDKROOT`, `TOOLCHAINS` and `xcrun_*`, not a
  deny-list.
- **Version-neutral IDs:** `apple-git-arm64-v2`, `apple-git-process-v2`, `launchctl-macos-preview-v2`,
  `launchctl-macos-fd3-v2`. Old IDs refuse. The cutover leaves Git and launchd disabled
  (roadmap `:425`), so no live home holds one.
- **Git evidence is per invocation, not persisted.** Persisting it would make a `push_pending` retry
  refuse forever after an Xcode update.
- **Launchd evidence is re-derived** in `loadLaunchdProcessTable` from a fresh admission and bound
  through the existing `processTableHash`. The preview stays unchanged and inode-free (§2.2).
- **`*.pinned-host.test.ts` keeps its name** and now runs on any admitted host.
- **No explicit macOS non-goal exists in Spec 1 §4.** Version 1's macOS scope is §1 item 3 ("opt-in
  macOS scheduled jobs"), and the amendment cites that.

## NEW-46 is not closed by this plan

NEW-46 (`BACKLOG.md:71`) is `capture`'s version-probe spawn of the discovered `claude`/`codex`
(`apps/cli/src/commands/capture.ts:238-255`; the threat model's `:263` predates later edits,
`docs/architecture/threat-model.md:704-714`). Those executables are user-installed in `/opt/homebrew/bin`
or `~/.local/bin`, which `assertTrustedExecutable` accepts on purpose
(`packages/platform-macos/src/macos.ts:279-283, 347-350`). They have no standard system path, and
root-owned admission would refuse every ordinary vendor install. NEW-46 needs its other arm —
manifest-owned persisted executable identity — and stays its own row.

## Global Constraints

- Never consult `PATH`, `DEVELOPER_DIR` or `xcrun` to find Git, launchctl or ssh; spawn only the table's
  absolute path.
- `posix_root_owned`: the standard path is a regular file (a link refuses), uid `0`,
  `(mode & 0o022) == 0`, owner-execute set, no setuid/setgid; each listed ancestor is a directory, uid
  `0`, `(mode & 0o022) == 0`.
- Floors: darwin Git `2.54.0` with `(Apple Git-<n>)`, `n >= 157`; SSH `OpenSSH_10.3p1`; macOS
  `ProductVersion >= 26.6.2`; no ceiling.
- Required Git build-option lines, each exactly once: `cpu: <row architecture>`, `shell-path: /bin/sh`,
  `default-hash: sha1`, `default-ref-format: files`; other lines ignored; more than 32 probe lines or a
  non-zero probe exit refuses.
- No contract field names a macOS build, an Xcode version or a certificate.
- Refusal codes stay `unsupported_git_distribution` / `unsupported_launchd_distribution`; exit codes
  are unchanged.
- The Git process table and the launchd argv/profiles are unchanged, apart from the IDs and
  `real_receive_pack`'s argv.
- Per-task validation is `npm run lint` only (D70). Commits stage exact paths and carry no
  `Co-Authored-By`.

## Review Focus

1. **A macOS/Xcode update between a persisted Git push plan and its `push_pending` retry** re-admits,
   not refuses forever. Pinned by Task 2 test "retry re-admits after a binary change".
2. **A hostile caller `PATH`/`DEVELOPER_DIR`** changes neither the spawned path nor any child
   environment. Pinned by Task 2 tests "every environment profile is free of xcrun inputs" and "the
   production runtime spawns /usr/bin/git under a hostile PATH and DEVELOPER_DIR".
3. **`real_receive_pack` through the shim** reaches `git receive-pack` on a real host. Pinned by
   Task 2's `local-receive.pinned-host.test.ts`, run at Task 4 and Task 5. A failure there is a stop
   condition, not a local patch.
4. **Two different admitted launchctl identities** give byte-identical template and observation
   hashes, while one identity change inside an apply refuses. Pinned by Task 3 tests.
5. **An uncertified row no longer blocks `automation disable`/`uninstall`** on an admitted host, while
   a below-floor host still refuses with the manual `bootout` list. Pinned by Task 3 tests.

## Waves

`npm run lint` is whole-repository: `tsc -b` over every package, `apps/cli` and `tests` (root
`tsconfig.json` references `./tests`, whose `include` has `integration/**/*.ts`), then ESLint
(`package.json:13`). A commit that removes an export another package imports cannot lint green. So
Task 1 is purely additive, and Tasks 2 and 3 are vertical slices with one commit each. The file sets of
Tasks 2 and 3 are disjoint. `packages/platform-macos/src/index.ts` is the one shared export list, and
the orchestrator resolves it by union (SESSION §4.1).

| Wave | Task | Size | Worktree | Consumes |
|---|---|---|---|---|
| 1 | Task 1 — system executable table and `darwin` rows behind `PlatformAdapter` | M | `../developer-os.worktrees/new-113-table` | — |
| 2 | Task 2 — Git: policy, CLI runtime, host tests | L | `../developer-os.worktrees/new-113-git` | Task 1 |
| 2 | Task 3 — launchd: policy, CLI observer, `certification` removal, host test | L | `../developer-os.worktrees/new-113-launchd` | Task 1 |
| 3 | Task 4 — plan close (founder runs the full suite) | M | orchestrator checkout | Tasks 2, 3 |
| 4 | Task 5 — Phase 9 gate on a disposable macOS account (founder step) | L | disposable account | Task 4 |

---

### Task 1: System executable table and the `darwin` rows

**What:** the platform-neutral contract and predicate, the `darwin` table and a no-follow inspector,
exposed on `PlatformAdapter`. This task only adds code; no caller changes yet.

**Files:**
- Create: `packages/security/src/system-executables.ts`, `packages/security/src/system-executables.test.ts`
- Modify: `packages/security/src/index.ts` (exports), `packages/security/src/index.test.ts:56-61`
  (export list)
- Create: `packages/platform-macos/src/system-executables.ts`,
  `packages/platform-macos/src/system-executables.test.ts`
- Modify: `packages/platform-macos/src/types.ts` (`PlatformAdapter`, lines 29-60),
  `packages/platform-macos/src/macos.ts` (implementation beside `assertTrustedExecutable`, `:305`),
  `packages/platform-macos/src/index.ts`, and every `PlatformAdapter` test double that the type checker
  names (`grep -rn "implements PlatformAdapter\|: PlatformAdapter = " apps packages tests`)

**Interfaces:**
- Consumes: nothing.
- Produces (`@developer-os/security`):

```ts
export type SystemPlatformV1 = "darwin" | "linux" | "win32";
export type SystemExecutableIdV1 = "git" | "ssh" | "scheduler";
export interface SystemExecutableRowV1 {
  readonly platform: SystemPlatformV1;
  readonly id: SystemExecutableIdV1;
  readonly path: string;
  readonly ancestors: readonly CanonicalAbsolutePathV1[];
  readonly admission: "posix_root_owned";
  readonly status: "implemented" | "intended";
}
export type SystemPathObservationV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "file" | "directory" | "symlink" | "other"; readonly ownerUid: number; readonly mode: number;
      readonly dev: string; readonly ino: string; readonly size: number; readonly sha256: string | null };
export type SystemPathInspectorV1 = (path: CanonicalAbsolutePathV1) => Promise<SystemPathObservationV1>;
export interface AdmittedSystemExecutableV1 {
  readonly platform: SystemPlatformV1; readonly id: SystemExecutableIdV1;
  readonly canonicalPath: CanonicalAbsolutePathV1; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
  readonly size: number; readonly sha256: LowerHexSha256;
}
export class SystemExecutableRefusalError extends Error { readonly detail: string }
export function admitPosixRootOwned(row: SystemExecutableRowV1, inspect: SystemPathInspectorV1): Promise<AdmittedSystemExecutableV1>;
export function recheckSystemExecutable(row: SystemExecutableRowV1, inspect: SystemPathInspectorV1, admitted: AdmittedSystemExecutableV1): Promise<void>;
```

- Produces (`@developer-os/platform-macos`):

```ts
export const DARWIN_SYSTEM_EXECUTABLES: readonly SystemExecutableRowV1[]; // git, scheduler, ssh — status "implemented"
export async function inspectSystemPath(path: CanonicalAbsolutePathV1): Promise<SystemPathObservationV1>;
// on PlatformAdapter:
systemExecutable(id: SystemExecutableIdV1): SystemExecutableRowV1;
admitSystemExecutable(id: SystemExecutableIdV1): Promise<AdmittedSystemExecutableV1>;
recheckSystemExecutable(admitted: AdmittedSystemExecutableV1): Promise<void>;
```

Callers map `SystemExecutableRefusalError` to their own code: Git to `unsupported_git_distribution`,
launchd to `unsupported_launchd_distribution`.

- [ ] **Step 1: Write the tests.** `packages/security/src/system-executables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { admitPosixRootOwned, recheckSystemExecutable, type SystemExecutableRowV1, type SystemPathObservationV1 } from "./system-executables.js";

const GIT: SystemExecutableRowV1 = { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"] as never, admission: "posix_root_owned", status: "implemented" };
const dir = (mode = 0o755): SystemPathObservationV1 => ({ kind: "directory", ownerUid: 0, mode, dev: "1", ino: "2", size: 64, sha256: null });
const file = (change: Partial<Extract<SystemPathObservationV1, { kind: "file" }>> = {}): SystemPathObservationV1 =>
  ({ kind: "file", ownerUid: 0, mode: 0o755, dev: "1", ino: "3", size: 101_000, sha256: "a".repeat(64), ...change });
const host = (overrides: Record<string, SystemPathObservationV1> = {}) => {
  const paths: Record<string, SystemPathObservationV1> = { "/": dir(), "/usr": dir(), "/usr/bin": dir(), "/usr/bin/git": file(), ...overrides };
  return (path: string) => Promise.resolve(paths[path] ?? { kind: "absent" as const });
};

describe("posix_root_owned", () => {
  it("admits a root-owned 0755 file under root-owned 0755 ancestors", async () => {
    await expect(admitPosixRootOwned(GIT, host())).resolves.toMatchObject({ canonicalPath: "/usr/bin/git", sha256: "a".repeat(64) });
  });
  it.each([
    ["non-root file", { "/usr/bin/git": file({ ownerUid: 501 }) }],
    ["group-writable file", { "/usr/bin/git": file({ mode: 0o775 }) }],
    ["other-writable file", { "/usr/bin/git": file({ mode: 0o757 }) }],
    ["setuid file", { "/usr/bin/git": file({ mode: 0o4755 }) }],
    ["setgid file", { "/usr/bin/git": file({ mode: 0o2755 }) }],
    ["non-executable file", { "/usr/bin/git": file({ mode: 0o644 }) }],
    ["symlink at the standard path", { "/usr/bin/git": { ...file(), kind: "symlink" } as SystemPathObservationV1 }],
    ["absent file", { "/usr/bin/git": { kind: "absent" } as SystemPathObservationV1 }],
    ["group-writable /usr/bin", { "/usr/bin": dir(0o775) }],
    ["non-root /usr", { "/usr": { ...dir(), ownerUid: 501 } as SystemPathObservationV1 }],
    ["other-writable /", { "/": dir(0o757) }],
  ])("refuses a %s", async (_name, overrides) => {
    await expect(admitPosixRootOwned(GIT, host(overrides))).rejects.toThrow(SystemExecutableRefusalError);
  });
  it("refuses an intended row", async () => {
    await expect(admitPosixRootOwned({ ...GIT, platform: "linux", status: "intended" }, host())).rejects.toThrow(SystemExecutableRefusalError);
  });
  it.each(["dev", "ino", "size", "sha256"] as const)("recheck refuses a changed %s", async (field) => {
    const admitted = await admitPosixRootOwned(GIT, host());
    const drift = file({ [field]: field === "size" ? 1 : field === "sha256" ? "b".repeat(64) : "9" });
    await expect(recheckSystemExecutable(GIT, host({ "/usr/bin/git": drift }), admitted)).rejects.toThrow(SystemExecutableRefusalError);
  });
});
```

  `packages/platform-macos/src/system-executables.test.ts` pins the exact `darwin` table:

```ts
it("is exactly the three darwin rows", () => {
  expect(DARWIN_SYSTEM_EXECUTABLES).toEqual([
    { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
    { platform: "darwin", id: "scheduler", path: "/bin/launchctl", ancestors: ["/", "/bin"], admission: "posix_root_owned", status: "implemented" },
    { platform: "darwin", id: "ssh", path: "/usr/bin/ssh", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
  ]);
  expect(JSON.stringify(DARWIN_SYSTEM_EXECUTABLES)).not.toMatch(/Xcode|25G83|certif/iu);
});
it("inspectSystemPath reports a link without following it and hashes a file by descriptor", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "dos-sysexec-")));
  await writeFile(join(dir, "bin"), "#!/bin/sh\n", { mode: 0o755 });
  await symlink("bin", join(dir, "link"));
  expect(await inspectSystemPath(join(dir, "link") as CanonicalAbsolutePathV1)).toMatchObject({ kind: "symlink", sha256: null });
  expect(await inspectSystemPath(join(dir, "bin") as CanonicalAbsolutePathV1)).toMatchObject({ kind: "file", sha256: createHash("sha256").update("#!/bin/sh\n").digest("hex") });
  expect(await inspectSystemPath(join(dir, "missing") as CanonicalAbsolutePathV1)).toEqual({ kind: "absent" });
});
```

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.** `admitPosixRootOwned`:

```ts
const writableByOthers = (mode: number): boolean => (mode & 0o022) !== 0;

export async function admitPosixRootOwned(row: SystemExecutableRowV1, inspect: SystemPathInspectorV1): Promise<AdmittedSystemExecutableV1> {
  if (row.status !== "implemented" || row.admission !== "posix_root_owned") refuse(`${row.platform}/${row.id} is not implemented`);
  const path = parseCanonicalAbsolutePathText(row.path);
  for (const ancestor of row.ancestors) {
    const entry = await inspect(ancestor);
    if (entry.kind !== "directory" || entry.ownerUid !== 0 || writableByOthers(entry.mode)) refuse(`${ancestor} is not a root-owned directory without group/other write`);
  }
  const target = await inspect(path);
  if (target.kind !== "file" || target.ownerUid !== 0 || writableByOthers(target.mode) || (target.mode & 0o6000) !== 0 || (target.mode & 0o100) === 0 || target.sha256 === null) {
    refuse(`${path} is not a root-owned executable regular file`);
  }
  return { platform: row.platform, id: row.id, canonicalPath: path, dev: parseUInt64Decimal(target.dev), ino: parseUInt64Decimal(target.ino), size: target.size, sha256: parseLowerHexSha256(target.sha256) };
}
```

  `recheckSystemExecutable` re-admits and compares canonical JSON; unequal refuses. `inspectSystemPath`
  follows the descriptor pattern of `apps/cli/src/lifecycle/adapters.ts:410-431`: `lstat` with bigint,
  and for a regular file of at most 64 MiB, `open(O_RDONLY | O_NOFOLLOW)`, a `dev`/`ino`/`size` match,
  then hash. `ENOENT` → `absent`; any other error propagates. `MacOsPlatformAdapter` implements the three
  methods over `DARWIN_SYSTEM_EXECUTABLES` and `inspectSystemPath`; an unknown ID throws
  `MacOsPlatformInputError`.

- [ ] **Step 4: Lint.** `npm run lint` — expect exit 0.

- [ ] **Step 5: Commit** (exact paths, plus any `PlatformAdapter` double Step 3 had to extend):

```bash
git add packages/security/src/system-executables.ts packages/security/src/system-executables.test.ts \
  packages/security/src/index.ts packages/security/src/index.test.ts \
  packages/platform-macos/src/system-executables.ts packages/platform-macos/src/system-executables.test.ts \
  packages/platform-macos/src/types.ts packages/platform-macos/src/macos.ts packages/platform-macos/src/index.ts
git commit -m "feat(platform): per-platform system executable table with root-owned admission (NEW-113, D71)"
```

---

### Task 2: Git — policy, CLI runtime, host tests

**What:** the compiled Git row becomes `GIT_DISTRIBUTION_POLICY`. Git runs as `/usr/bin/git` admitted
through Task 1. The probe enforces the floor and capability. The supervisor rechecks per-invocation
evidence.

**Files:**
- Modify: `packages/security/src/git/types.ts:309-380`; rewrite `packages/security/src/git/distribution.ts`
- Modify: `packages/security/src/git/process-table.ts:53-54` (IDs), `:440-449`, `:502`, `:587-646`
  (`real_receive_pack` argv0), `:684` (split `RECEIVE_PACK_ARGV` into the unchanged spawn grammar and a
  new exec grammar), `:916-927`, `:963`
- Modify: `packages/security/src/git/push-plan.ts:68, 142, 162`, `packages/security/src/git/supervisor.ts:161-174`,
  `packages/security/src/git/gateways.ts` (only if the trampoline forwards the incoming argv instead of
  the permit's expanded argv; see Step 3)
- Modify: `packages/security/src/git/index.ts`, `packages/security/src/index.ts`, `packages/security/src/index.test.ts:56-61`
- Modify: `apps/cli/src/commands/git/runtime.ts:145, 181-231, 771-836, 943-956` and every
  `SUPPORTED_GIT_DISTRIBUTION` use (`:477, 542, 630, 683, 745`); `apps/cli/src/commands/git/service.ts:105, 1673`;
  `apps/cli/src/commands/git/testing.ts:19, 134-140`
- Modify: `tests/integration/git/local-push.pinned-host.test.ts:8-18`,
  `tests/integration/git/local-receive.pinned-host.test.ts:15-95, 213`
- Test: `packages/security/src/git/distribution.test.ts`, `distribution.test-fixtures.ts`,
  `supervisor.test.ts:128-129`, `gateways.test.ts:47, 116`, `process-table.test.ts:133, 175`,
  `apps/cli/src/commands/git/runtime.test.ts`

**Interfaces:**
- Consumes (Task 1): `SystemExecutableRowV1`, `AdmittedSystemExecutableV1`, `SystemPathInspectorV1`,
  `admitPosixRootOwned`, `recheckSystemExecutable`, `SystemExecutableRefusalError`,
  `DARWIN_SYSTEM_EXECUTABLES`, `inspectSystemPath`.
- Produces:

```ts
export const GIT_DISTRIBUTION_POLICY_ID = "apple-git-arm64-v2";
export const SUPPORTED_GIT_PROCESS_TABLE_ID = "apple-git-process-v2";
export const GIT_DISTRIBUTION_POLICY: GitDistributionPolicyV2; // spec §4.2 schema
export interface AdmittedGitExecutablesV1 { readonly git: AdmittedSystemExecutableV1; readonly ssh: AdmittedSystemExecutableV1 | null }
export interface AdmittedGitDistributionV1 extends AdmittedGitExecutablesV1 { readonly gitVersionLine: string }
export function parseGitVersionLine(line: string, vendorBuildPrefix: string | null): { major: number; minor: number; patch: number; vendorBuild: number | null } | null;
export function admitGitExecutables(rows: readonly SystemExecutableRowV1[], inspect: SystemPathInspectorV1, architecture: string, transport: "local" | "https" | "ssh", policy?: GitDistributionPolicyV2): Promise<AdmittedGitExecutablesV1>;
export function admitGitCapability(admitted: AdmittedGitExecutablesV1, probeStdout: string, probeExitCode: number, policy?: GitDistributionPolicyV2): AdmittedGitDistributionV1;
export function admittingGitIdentityProbe(admitted: () => AdmittedGitExecutablesV1, rows: readonly SystemExecutableRowV1[], inspect: SystemPathInspectorV1): GitExecutableIdentityProbeV1;
```

`admitGitExecutables` refuses `https` (no `git_remote_https` row) and `ssh` (D59 Q4-A), as
`runtime.ts:949` does today, and maps `SystemExecutableRefusalError` to
`SecurityRefusalError("unsupported_git_distribution")`. Removed: `SUPPORTED_GIT_DISTRIBUTION`,
`validateSupportedGitDistribution`, `gitDistributionIdentity`, `admitGitDistribution`,
`ObservedGitDistributionV1`, `SupportedGitDistributionV1`, `ExecutableFileIdentityV1`,
`GitExecPathLinkV1`, `GIT_EXEC_PATH_LINK_NAMES`.

- [ ] **Step 1: Write the tests.** `packages/security/src/git/distribution.test.ts` replaces the
  exact-row cases:

```ts
const DARWIN = [
  { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
  { platform: "darwin", id: "ssh", path: "/usr/bin/ssh", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
] as const satisfies readonly SystemExecutableRowV1[];

describe("Git executables", () => {
  it("admits /usr/bin/git for local", async () => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "arm64", "local")).resolves.toMatchObject({ git: { canonicalPath: "/usr/bin/git" }, ssh: null });
  });
  it.each(["https", "ssh"] as const)("refuses %s (D59 Q4-A)", async (transport) => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "arm64", transport)).rejects.toThrow("unsupported_git_distribution");
  });
  it("refuses another architecture and maps a table refusal", async () => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "x64", "local")).rejects.toThrow("unsupported_git_distribution");
    await expect(admitGitExecutables(DARWIN, stockHost({ "/usr/bin/git": { ownerUid: 501 } }), "arm64", "local")).rejects.toThrow("unsupported_git_distribution");
  });
});

describe("version floor and capability", () => {
  it.each([
    ["git version 2.54.0 (Apple Git-157)", true],
    ["git version 2.55.1 (Apple Git-160)", true],
    ["git version 2.53.9 (Apple Git-157)", false],
    ["git version 2.54.0 (Apple Git-156)", false],
    ["git version 2.54.0", false],
    ["git version 2.54.0 (Homebrew)", false],
    ["git version 02.54.0 (Apple Git-157)", false],
  ])("%s admits: %s", async (line, admits) => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const run = () => admitGitCapability(admitted, `${line}\n${PROBE_OK}`, 0);
    if (admits) expect(run().gitVersionLine).toBe(line); else expect(run).toThrow("unsupported_git_distribution");
  });
  it.each(["cpu: arm64", "shell-path: /bin/sh", "default-hash: sha1", "default-ref-format: files"])("refuses without %s", async (required) => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const probe = PROBE_OK.split("\n").filter((line) => line !== required).join("\n");
    expect(() => admitGitCapability(admitted, `git version 2.54.0 (Apple Git-157)\n${probe}`, 0)).toThrow("unsupported_git_distribution");
  });
  it("ignores changed library lines, refuses duplicates, over-long output and a non-zero exit", async () => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const head = "git version 2.54.0 (Apple Git-157)";
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\nlibcurl: 9.9.9\nfeature: new`, 0)).not.toThrow();
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\ndefault-hash: sha1`, 0)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\n${"x: y\n".repeat(40)}`, 0)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, "xcrun: error: invalid active developer path", 1)).toThrow("unsupported_git_distribution");
  });
  it("parses the vendor build only where the row names one", () => {
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157)", "Apple Git-")).toEqual({ major: 2, minor: 54, patch: 0, vendorBuild: 157 });
    expect(parseGitVersionLine("git version 2.54.0", null)).toEqual({ major: 2, minor: 54, patch: 0, vendorBuild: null });
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157) extra", "Apple Git-")).toBeNull();
  });
});

describe("process table under the shim", () => {
  it("every environment profile is free of xcrun inputs", () => {
    for (const profile of GIT_DISTRIBUTION_POLICY.processTable.environmentProfiles) {
      for (const { name } of profile.entries) expect(name).not.toMatch(/^(DEVELOPER_DIR|SDKROOT|TOOLCHAINS|xcrun_.*)$/u);
    }
  });
  it("execs receive-pack as git receive-pack", () => {
    const node = GIT_DISTRIBUTION_POLICY.processTable.nodes.find((candidate) => candidate.id === "real_receive_pack");
    expect(node?.image).toEqual({ kind: "distribution", executableId: "git_main", argv0: "git" });
    const exec = GIT_DISTRIBUTION_POLICY.processTable.edges.find((candidate) => candidate.id === "exec_receive_pack");
    expect(expandGitArgv(exec!.argvAlternatives[0]!, { private_destination_shadow: "/x/shadow.git" })).toEqual(["git", "receive-pack", "--skip-connectivity-check", "/x/shadow.git"]);
  });
});
```

  `distribution.test-fixtures.ts` gains `stockHost(overrides)` (an async `Map` inspector for
  `/`, `/usr`, `/usr/bin`, `/usr/bin/git`, `/usr/bin/ssh`, all root-owned `0755`, with per-path field
  overrides) and `PROBE_OK` (the thirteen D59 build-option lines, in order, copied from the spec).
  `supervisor.test.ts:128-129` and `gateways.test.ts:47, 116` build the probe with
  `admittingGitIdentityProbe(() => admitted, DARWIN, stockHost())`; `supervisor.test.ts` adds "a
  recheck that sees a changed sha256 refuses before the permit runs"; `gateways.test.ts` adds "the
  receive-pack trampoline execs `/usr/bin/git` with `git receive-pack …`"; `process-table.test.ts:133`
  expects `GIT_DISTRIBUTION_POLICY_ID`.

  `apps/cli/src/commands/git/runtime.test.ts`:

```ts
it("the production runtime spawns /usr/bin/git under a hostile PATH and DEVELOPER_DIR", async () => {
  const seen: string[] = [];
  const inspect: SystemPathInspectorV1 = (path) => { seen.push(path); return stockHost()(path); };
  vi.stubEnv("PATH", "/tmp/evil/bin"); vi.stubEnv("DEVELOPER_DIR", "/tmp/evil/Developer");
  try {
    await createProductionGitRuntime({ inspect, architecture: "arm64" }).admitDistribution("local");
    expect(seen.sort()).toEqual(["/", "/usr", "/usr/bin", "/usr/bin/git"]);
  } finally { vi.unstubAllEnvs(); }
});

it("retry re-admits after a binary change between plan and retry", async () => {
  const first = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
  const updated = stockHost({ "/usr/bin/git": { sha256: "d".repeat(64), ino: "42" } });
  await expect(admitGitExecutables(DARWIN, updated, "arm64", "local")).resolves.toBeDefined();
  await expect(recheckSystemExecutable(DARWIN[0], updated, first.git)).rejects.toThrow();
});

it("no Git module reads PATH or DEVELOPER_DIR", async () => {
  for (const file of ["runtime.ts", "../../../../../packages/security/src/git/distribution.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env(\.|\[")(PATH|DEVELOPER_DIR)/u);
  }
});
```

  Host tests: `local-push`/`local-receive` take `GIT` from
  `(await admitGitExecutables(DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath, process.arch, "local")).git.canonicalPath`
  in a `beforeAll`. An admission refusal fails the file and never skips it. Delete
  `observeInstalledGitDistribution` (`local-receive:61-95`). The check at `:213` becomes
  `admitGitCapability(admitted, execFileSync(GIT, ["--version", "--build-options"], { encoding: "utf8", env: {} }), 0)`.

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.**
  - `distribution.ts`: the policy constant per spec §4.2 (`executables`: `git_main` → `"git"`,
    `git_remote_https` → `null`, `system_ssh` → `"ssh"`); `admitGitExecutables` picks the rows by
    `system` ID, checks `architecture === policy.architecture`, refuses `https`/`ssh`, and calls
    `admitPosixRootOwned`. `admitGitCapability` refuses a non-zero exit, splits stdout on LF, drops
    the empty final element, refuses more than 32 lines or any line failing `parseBoundedTextLine`,
    checks line 0 against the floor (lexicographic `[major, minor, patch]`, then `vendorBuild >=
    minimum`), and requires each required line exactly once, with `cpu:` taken from
    `policy.architecture`. `parseGitVersionLine` uses
    `^git version (0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?: \(<escaped prefix>(0|[1-9]\d*)\))?$`,
    with the group required exactly when a prefix is given.
  - `process-table.ts`: rename the IDs; `real_receive_pack` gets `gitMain("git")`; `RECEIVE_PACK_ARGV`
    stays for `spawn_receive_pack_gateway` (`:916`); a new
    `RECEIVE_PACK_EXEC_ARGV = [argv("git", "receive-pack", "--skip-connectivity-check", slotArg("private_destination_shadow"))]`
    serves `exec_receive_pack` (`:927`). The supervisor's argv0 check (`supervisor.ts:230`) then
    matches unchanged. Read `gateways.ts` around `:86` and `:375-462`. If the exec reply's argv comes
    from the permit's expanded edge argv, nothing else changes. If it forwards the trampoline's
    incoming argv, build the reply argv from the exec edge's expansion instead. That is the only
    permitted `gateways.ts` change.
  - `supervisor.ts:161-174`: `admittingGitIdentityProbe` rechecks every admitted system executable
    through `recheckSystemExecutable`, maps a refusal to `unsupported_git_distribution`, and returns
    `canonicalPath` for `git_main`/`system_ssh`. For `git_remote_https` it refuses.
  - `runtime.ts`: delete `XCODE_VERSION_PLIST`, `plistString` (if unused elsewhere), `linkChainOf` and
    `observeGitDistribution`. `createProductionGitRuntime(options?: { inspect?: SystemPathInspectorV1;
    architecture?: string })` defaults to `inspectSystemPath` and `process.arch`, and its
    `admitDistribution(transport)` calls `admitGitExecutables`. `prepareLocalPush` admits once, builds
    the supervisor with `admittingGitIdentityProbe(() => admitted, DARWIN_SYSTEM_EXECUTABLES, inspect)`,
    runs the probe edge, and passes its stdout and exit code to `admitGitCapability`. The probe now
    refuses on a non-zero exit instead of `runCoordinatorGit`'s generic `git_process_failed`, so give
    the probe its own call that returns the exit code.
  - `service.ts:1673` writes `GIT_DISTRIBUTION_POLICY_ID`; `push-plan.ts` follows the ID.
    `testing.ts:134` hashes `GIT_DISTRIBUTION_POLICY.processTable`.

- [ ] **Step 4: Lint.** `npm run lint` — expect exit 0. Then run
  `grep -rn "SUPPORTED_GIT_DISTRIBUTION\b\|admitGitDistribution\|ObservedGitDistributionV1\|xcode" packages/security/src/git apps/cli/src/commands/git tests/integration/git`
  and expect no match.

- [ ] **Step 5: Commit** (exact paths; add `gateways.ts` only if Step 3 changed it):

```bash
git add packages/security/src/git/types.ts packages/security/src/git/distribution.ts \
  packages/security/src/git/process-table.ts packages/security/src/git/push-plan.ts \
  packages/security/src/git/supervisor.ts packages/security/src/git/index.ts packages/security/src/index.ts \
  packages/security/src/index.test.ts packages/security/src/git/distribution.test.ts \
  packages/security/src/git/distribution.test-fixtures.ts packages/security/src/git/supervisor.test.ts \
  packages/security/src/git/gateways.test.ts packages/security/src/git/process-table.test.ts \
  apps/cli/src/commands/git/runtime.ts apps/cli/src/commands/git/service.ts \
  apps/cli/src/commands/git/testing.ts apps/cli/src/commands/git/runtime.test.ts \
  tests/integration/git/local-push.pinned-host.test.ts tests/integration/git/local-receive.pinned-host.test.ts
git commit -m "feat(git): run /usr/bin/git admitted by ownership, version floor and capability probe (NEW-113, D71)"
```

---

### Task 3: launchd — policy, CLI observer, `certification` removal, host test

**What:** `/bin/launchctl` is admitted through the `darwin` `scheduler` row and the macOS floor. Its
identity is re-derived into the expanded table. `certification` is removed everywhere (Q2-A).

**Files:**
- Rewrite: `packages/platform-macos/src/launchd/distribution.ts`
- Modify: `packages/platform-macos/src/launchd/process-table.ts:120-175, 218-262, 305-383`
- Modify: `packages/platform-macos/src/launchd/effects.ts:180-195, 218-250, 389-395`,
  `observe.ts:35-40, 170-176`, `snapshot.ts:140-146, 385-390, 426-432`, `index.ts`,
  `packages/platform-macos/src/index.ts:115-151`
- Modify: `apps/cli/src/lifecycle/adapters.ts:75-76, 392-431`,
  `apps/cli/src/commands/automation/service.ts:331-335, 988-995, 1127-1129`,
  `apps/cli/src/lifecycle/uninstall.ts:1340-1349`, `apps/cli/src/lifecycle/testing.ts`, and every
  `loadLaunchdProcessTable` caller (`grep -rn loadLaunchdProcessTable apps packages`)
- Modify: `tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts:21-100, 199`
- Create: `packages/platform-macos/src/launchd/distribution.test-fixtures.ts`
- Test: `packages/platform-macos/src/launchd/process-table.test.ts`, `effects.test.ts:84, 362-363, 731-732`,
  `snapshot.test.ts:50, 209-210, 485`, `observe.test.ts:72-73, 233-274`,
  `apps/cli/src/commands/automation/service.test.ts`, `apps/cli/src/lifecycle/uninstall.test.ts:153, 247`

**Interfaces:**
- Consumes (Task 1): `DARWIN_SYSTEM_EXECUTABLES`, `admitPosixRootOwned`, `recheckSystemExecutable`,
  `SystemPathInspectorV1`, `AdmittedSystemExecutableV1`, `SystemExecutableRefusalError`,
  `inspectSystemPath`.
- Produces:

```ts
export type LaunchdDistributionPolicyV2 = {
  readonly previewTableId: "launchctl-macos-preview-v2";
  readonly mutationTableId: "launchctl-macos-fd3-v2";
  readonly operatingSystem: { readonly productName: "macOS"; readonly minimumProductVersion: "26.6.2" };
  readonly executable: { readonly path: "/bin/launchctl"; readonly ownerUid: 0 };
  readonly emptyDirectory: LaunchdEmptyDirectoryIdentityV1;
};
export type LaunchctlIdentityV1 = { readonly file: AdmittedSystemExecutableV1; readonly productVersion: string; readonly buildVersion: string };
export interface LaunchdHostObserverV1 {
  operatingSystem(): Promise<{ productName: string; productVersion: string; buildVersion: string }>;
  inspect: SystemPathInspectorV1;
}
export const LAUNCHD_DISTRIBUTION_POLICY: LaunchdDistributionPolicyV2;
export function admitLaunchdHost(host: LaunchdHostObserverV1, policy?: LaunchdDistributionPolicyV2): Promise<LaunchctlIdentityV1>;
export function recheckLaunchdHost(host: LaunchdHostObserverV1, identity: LaunchctlIdentityV1): Promise<void>;
export function requireLaunchdMutationTable(table: SupportedLaunchdProcessTableV1, template?: SupportedLaunchdProcessTableTemplateV1): void;
export function expandLaunchdProcessTable(staging, launchctl: LaunchctlIdentityV1, template?): SupportedLaunchdProcessTableV1;
export function loadLaunchdProcessTable(productHome, coordinatorId, options: { fs?; template?; host: LaunchdHostObserverV1 }): Promise<SupportedLaunchdProcessTableV1>;
```

The dependency interfaces' `operatingSystem()` + `inspectExecutable("/bin/launchctl")` pair
(`effects.ts:224-225`, `observe.ts:38-39`, `snapshot.ts:144-145`, `adapters.ts:75-76`) becomes one
`host: LaunchdHostObserverV1`. Removed: `SUPPORTED_LAUNCHD_DISTRIBUTION`, `LaunchdCertificationV1`,
`admitLaunchdDistribution`, `requireLaunchdMutationCertified`, `ObservedLaunchdDistributionV1`, and the
`certification` field of the table and template.

- [ ] **Step 1: Write the tests.** `process-table.test.ts`, replacing the pinned-row and certification
  cases (`hostWith` lives in the new fixtures file; it returns root-owned `0755` `/`, `/bin` and a
  `/bin/launchctl` file with `sha256` `"b".repeat(64)`, plus `ProductVersion` `26.6.2` / `25G83`,
  each overridable):

```ts
describe("launchctl admission", () => {
  it.each(["26.6.2", "26.7", "26.10.1", "27.0"])("admits macOS %s", async (productVersion) => {
    await expect(admitLaunchdHost(hostWith({ productVersion }))).resolves.toBeDefined();
  });
  it.each(["26.6.1", "26.6", "25.9.9", "27", "26.6.2.1", "026.6.2", "", "26.x"])("refuses macOS %s", async (productVersion) => {
    await expect(admitLaunchdHost(hostWith({ productVersion }))).rejects.toThrow("unsupported_launchd_distribution");
  });
  it("never compares the build", async () => {
    await expect(admitLaunchdHost(hostWith({ buildVersion: "26A1" }))).resolves.toBeDefined();
  });
  it.each([
    ["owner", { "/bin/launchctl": { ownerUid: 501 } }], ["group write", { "/bin/launchctl": { mode: 0o775 } }],
    ["setuid", { "/bin/launchctl": { mode: 0o4755 } }], ["symlink", { "/bin/launchctl": { kind: "symlink" } }],
    ["writable /bin", { "/bin": { mode: 0o775 } }], ["writable /", { "/": { mode: 0o757 } }],
  ])("refuses %s", async (_name, paths) => {
    await expect(admitLaunchdHost(hostWith({ paths }))).rejects.toThrow("unsupported_launchd_distribution");
  });
  it.each(["dev", "ino", "size", "sha256"] as const)("recheck refuses a changed %s", async (field) => {
    const identity = await admitLaunchdHost(hostWith());
    const change = { [field]: field === "size" ? 1 : field === "sha256" ? "c".repeat(64) : "7" };
    await expect(recheckLaunchdHost(hostWith({ paths: { "/bin/launchctl": change } }), identity)).rejects.toThrow("unsupported_launchd_distribution");
  });
});

describe("launchd tables carry no host literal", () => {
  it("keeps template and observation hashes equal for two admitted identities", async () => {
    const one = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith()));
    const two = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith({ paths: { "/bin/launchctl": { sha256: "c".repeat(64), size: 400000 } } })));
    expect(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(one))).toBe(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(two)));
    expect(launchdProcessTableHash(one)).not.toBe(launchdProcessTableHash(two));
    expect(JSON.stringify(LAUNCHD_PREVIEW_OBSERVATION_TABLE)).not.toMatch(/25G83|363488|sha256|certif/u);
    expect("certification" in SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE).toBe(false);
  });
  it("admits a mutation table without certification", async () => {
    const table = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith()));
    expect(() => { requireLaunchdMutationTable(table); }).not.toThrow();
  });
});
```

  (`STAGING` is the existing staging fixture in that file.)
  In `effects.test.ts`, `snapshot.test.ts` and `observe.test.ts`, replace every
  `SUPPORTED_LAUNCHD_DISTRIBUTION.*` double with `hostWith()`. Delete the `certification` literals
  (`effects.test.ts:84`, `snapshot.test.ts:50`). Turn `snapshot.test.ts:485` (build `25G84`) into "a
  `ProductVersion` below the floor refuses". Add to `effects.test.ts`: "a `sha256` change between
  `loadLaunchdProcessTable` and the bootout spawn refuses before the runner runs", and "a bootstrap
  whose post-observation is not the planned generated label compensates and refuses
  `unsupported_launchd_distribution`". If the second case already exists under the certification
  name, keep it and drop its certification precondition.

  `uninstall.test.ts`: replace the case at `:247` with:

```ts
it("unloads a loaded label on an admitted host without certification", async () => {
  const { run, launchctl } = await presentManifestWithLoadedLabel({ host: hostWith() });
  await run();
  expect(launchctl.calls.map((call) => call.argv[0])).toContain("bootout");
});

it("names the manual bootout for every label on a host below the floor", async () => {
  const { run } = await presentManifestWithLoadedLabel({ host: hostWith({ productVersion: "26.5" }) });
  await expect(run()).rejects.toMatchObject({ reason: "unsupported_launchd_distribution" });
  await expect(run()).rejects.toThrow(/launchctl bootout gui\/\d+\//u);
});
```

  `presentManifestWithLoadedLabel` wraps the setup the existing case at `:153-247` already builds;
  extract it into `lifecycle/testing.ts`. `automation/service.test.ts` adds "`automation status`
  reports `supported` on an admitted host" and "`automation enable` plans and applies without a
  `certification` field".

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.**
  - `distribution.ts`: `admitLaunchdHost` requires `productName === "macOS"` and the floor:

```ts
function macOsVersion(text: string): readonly [number, number, number] | null {
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:\.(0|[1-9]\d{0,3}))?$/u.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}
const atLeast = (a: readonly number[], b: readonly number[]): boolean => {
  for (let index = 0; index < b.length; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  return true;
};
```

    It then calls `admitPosixRootOwned` on the `scheduler` row of `DARWIN_SYSTEM_EXECUTABLES`, maps
    `SystemExecutableRefusalError` to `LaunchdDistributionUnsupportedError` with `{ cause }`, and
    returns `{ file, productVersion, buildVersion }`. `recheckLaunchdHost` re-admits and compares
    canonical JSON.
  - `process-table.ts`: the table gains `readonly launchctlIdentity: LaunchctlIdentityV1`, and the
    template gains `readonly launchctlIdentity: { readonly slot: "launchctl_identity" }`.
    `operatingSystem`/`executable` take the policy types, and `certification` goes.
    `expandLaunchdProcessTable` takes the identity second; `deslotLaunchdProcessTable` maps it back to
    the slot. `requireLaunchdMutationCertified` becomes `requireLaunchdMutationTable`, which keeps
    only the template-hash check.
  - `effects.ts:180-195`: `loadLaunchdProcessTable` calls `admitLaunchdHost(options.host)` and passes
    the identity to `expandLaunchdProcessTable`. `effects.ts:242-250` and `snapshot.ts:426-432`
    call `recheckLaunchdHost(host, table.launchctlIdentity)`; `observe.ts:170-176` calls
    `admitLaunchdHost(host)`. Update docblocks that say "certified" or "pinned row".
  - `adapters.ts:392-431`: the host observer is `{ operatingSystem: macOsVersion, inspect: inspectSystemPath }`;
    delete the local `inspectExecutable`.
  - `automation/service.ts`: delete `requireCertified` and its calls. `status` sets `distribution` from
    a guarded `admitLaunchdHost(host)`: `unsupported_launchd_distribution` on refusal, `supported`
    otherwise. `uninstall.ts:1342-1344` drops the certification clause; the existing
    `LaunchdDistributionUnsupportedError` catch still names the manual `bootout` list, and only an
    admission refusal now reaches it.
  - `fd3-bootstrap.pinned-host.test.ts`: rename the `DEVELOPER_OS_LAUNCHD_CERTIFICATION_HOST` guard
    (`:78`) to `DEVELOPER_OS_LAUNCHD_GATE_HOST`. It still prevents a live `bootstrap` on a developer's
    own account. Admit with `admitLaunchdHost({ operatingSystem, inspect: inspectSystemPath })`, delete
    the certification object (`:100`), and keep the transcript-hash print (`:199`) as Task 5 evidence.

- [ ] **Step 4: Lint.** `npm run lint` — expect exit 0. Then run
  `grep -rn "certification\|SUPPORTED_LAUNCHD_DISTRIBUTION\|admitLaunchdDistribution" packages apps tests`
  and expect no match outside comments that name the removal.

- [ ] **Step 5: Commit** (exact paths, plus every `loadLaunchdProcessTable` caller the grep found):

```bash
git add packages/platform-macos/src/launchd/distribution.ts packages/platform-macos/src/launchd/distribution.test-fixtures.ts \
  packages/platform-macos/src/launchd/process-table.ts packages/platform-macos/src/launchd/effects.ts \
  packages/platform-macos/src/launchd/observe.ts packages/platform-macos/src/launchd/snapshot.ts \
  packages/platform-macos/src/launchd/index.ts packages/platform-macos/src/index.ts \
  packages/platform-macos/src/launchd/process-table.test.ts packages/platform-macos/src/launchd/effects.test.ts \
  packages/platform-macos/src/launchd/snapshot.test.ts packages/platform-macos/src/launchd/observe.test.ts \
  apps/cli/src/lifecycle/adapters.ts apps/cli/src/commands/automation/service.ts \
  apps/cli/src/lifecycle/uninstall.ts apps/cli/src/lifecycle/testing.ts \
  apps/cli/src/commands/automation/service.test.ts apps/cli/src/lifecycle/uninstall.test.ts \
  tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts
git commit -m "feat(launchd): admit /bin/launchctl through the platform table and macOS floor; remove certification (NEW-113, D71)"
```

---

### Task 4: Plan close

**What:** the canonical docs carry the surviving constraints, D71 is recorded, and the full validation
runs.

**Files:** `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md` (D71 entry after D69,
the Phase 9 block `:403-417`); `docs/superpowers/BACKLOG.md:22, 57, 272-277`;
`docs/architecture/foundation.md` §10, `docs/architecture/foundation-constraints.md`,
`docs/architecture/threat-model.md` §5.15; this plan.

**Consumes:** Tasks 2, 3.

- [ ] **Step 1: Roadmap.** Add D71 (2026-09-28) with the five founder decisions above, and D70 if
  the founder has not recorded it yet. Rewrite the Phase 9 line at `:412` so NEW-113 points at Task 5.
- [ ] **Step 2: Canonical docs.** Move the platform table, the `posix_root_owned` predicate, the floors,
  and residuals 13 and 14 into `foundation.md` §10, `foundation-constraints.md` and `threat-model.md`
  §5.15, which are the plan 1b carry-over sites named at roadmap `:414-415`. Replace every "pinned row"
  or "certified row" sentence there.
- [ ] **Step 3: Full validation (founder, by hand).** Run `npm run check` and `npm run test:pinned-host`
  on the development Mac. Fix every red test in its task's files, with a regression test first. Show
  failures only. A red `local-receive.pinned-host.test.ts` caused by the shim's receive-pack dispatch
  is a stop condition (Review Focus 3): report it to the founder, and do not patch around it.
- [ ] **Step 4: Fresh-context review** by an agent that wrote none of Tasks 1–3. Give it the D71 spec
  blocks, this plan and `git diff development...HEAD`. Every accepted finding gets a failing test
  first.
- [ ] **Step 5: Bookkeeping.** In `BACKLOG.md`, the NEW-113 row reads: code landed, Task 5 open. Stage
  with `git add -f` on exact paths and commit
  `docs: close the NEW-113 code tasks and record D71`.

---

### Task 5: Phase 9 gate on a disposable macOS account (founder step)

**What:** prove roadmap Phase 9's gate (`:417`) — `git enable|sync|disable`, `automation
enable|disable|status`, scheduled runs observed — on an admitted host, and record the FD-3 contract as
gate evidence (Q2-A). Local/file transport only (Q4-A).

**Where:** a new, disposable, standard macOS user account on a Mac at macOS ≥ 26.6.2 whose
`xcode-select` choice provides Git ≥ 2.54.0 / Apple Git-157. Never the founder's own account (SESSION.md
"Stop and ask": live launchd). Evidence goes to `docs/releases/compatibility-matrix.md` and the roadmap
Phase 9 block.

**Consumes:** Task 4.

**How (founder, in the disposable account):**

- [ ] **Step 1: Record the host.** Run `sw_vers`, `xcode-select -p`,
  `/usr/bin/git --version --build-options`, `ls -ln /usr/bin/git /usr/bin/ssh /bin/launchctl` and
  `ls -lnd / /usr /usr/bin /bin`. Expected: every rule of spec §4.2 and §5.3 holds.
- [ ] **Step 2: Host tests.** From a clone at the Task 4 commit, run
  `DEVELOPER_OS_LAUNCHD_GATE_HOST=1 npm run test:pinned-host`. Expected: all green, including
  `git receive-pack` through the shim. Keep the printed FD-3 transcript SHA-256.
- [ ] **Step 3: Git gate.** Install the product build into the account. Create a synthetic Brain and a
  local bare remote under the account's home. Run `developer-os git enable --apply`, then
  `developer-os git sync` twice (one change, one no change), then `git disable --apply`. Expected: one
  commit reaches the bare remote through `/usr/bin/git`. That closes the Phase 9 verification gap "a
  real push through Apple Git-157 has not run through the I1 fix" (`BACKLOG.md:276`). The second sync
  reports `no_changes`, and disable leaves `.git` and the remote intact.
- [ ] **Step 4: automation gate.** Run `developer-os automation enable --apply` with an hourly schedule
  and wait for one scheduled run of each eligible job. Then run `automation status`,
  `automation disable --apply` and `launchctl print gui/$(id -u)`. Expected: status `supported`, one
  status record per job, and no product label left.
- [ ] **Step 5: Update check.** If a macOS or Xcode point update is available for the account's Mac,
  apply it and repeat Steps 2–4's enable/status/disable once. Expected: admitted with no code change,
  which is the D65 goal. If no update is available, record "not exercised".
- [ ] **Step 6: Record** the rows (host facts, transcript hash, outcomes) in
  `docs/releases/compatibility-matrix.md`. Tick roadmap Phase 9's gate and remove NEW-113 from
  `BACKLOG.md`. Delete this plan once its surviving constraints are in the canonical docs (Task 4
  Step 2), then delete the disposable account.
