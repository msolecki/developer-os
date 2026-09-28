# NEW-113 Fixed-Path Admission for Git, launchctl and ssh — Implementation Plan

> **Status: DRAFT, awaiting founder approval (2026-09-28).** Nothing in this plan runs before the
> founder answers the questions below and approves the spec blocks marked "Proposed 2026-09-28 (DRAFT,
> awaiting founder approval; D65, NEW-113)" in Spec 1 §4.2, §5.3, §7 and §8.3.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Replace the exact macOS build + binary SHA-256 pin for Git, `/bin/launchctl` and `/usr/bin/ssh`
with fixed-path admission (root ownership, no group/other write, a version floor, a capability probe),
so a macOS or Xcode update, or another Mac, no longer refuses `git` and `automation` (D65).

**Architecture:** The compiled Git and launchd rows become policies with no host literal. Pure admission
functions in `packages/security` (Git) and `packages/platform-macos` (launchd) take injected
observations and return per-invocation evidence (`dev`, `ino`, `size`, `sha256`, versions); the CLI's
node observers feed them. The evidence is rechecked before every real exec exactly where the pinned
identity was rechecked before, so the within-run TOCTOU protection is unchanged and only the
cross-machine pin goes.

**Tech Stack:** TypeScript strict, Node 24, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` §4.2, §5.3, §7,
§8.3 — the four "Proposed 2026-09-28" blocks. Backlog row: `docs/superpowers/BACKLOG.md` NEW-113 (line
57). Decision: roadmap D65 (`plans/2026-09-04-developer-os-completion-roadmap.md:301-308`), which
supersedes D59 Q1/Q2 (`:223-230`) and plan 1b Task 19.

**Execution rule (D70, as given in the task brief; the roadmap does not yet record D70):** tasks write
tests but do not run them; each task commit runs `npm run lint` only; the full suite, `npm run
test:pinned-host` and a fresh-context review run at plan close (Task 3). Every "run the test" step
below therefore reads "deferred to plan close (D70)".

---

## Founder questions

Each changes the design. The recommendation is listed first; the spec blocks are written for it.

**Q1 — How is the active developer directory `<dev>` found without `PATH`?**
- **A (recommended):** read the root-owned link `/var/db/xcode_select_link` with `readlink`; if absent,
  `/Applications/Xcode.app/Contents/Developer`, else `/Library/Developer/CommandLineTools`; the result
  must be `/Applications/<bundle>.app/Contents/Developer` or `/Library/Developer/CommandLineTools`.
  → Git is the same one `xcode-select -p` shows; Command Line Tools-only Macs and `Xcode-beta.app` work.
- **B:** fixed two-path list only (Xcode.app, then Command Line Tools); ignore the `xcode-select`
  selection. → Simpler, but a user who selected another Xcode silently gets a different Git than
  their shell.
- **C:** `/Applications/Xcode.app/Contents/Developer` only (today's path). → Command Line Tools-only
  Macs keep refusing `git`, which is most of the users D65 was written for.

**Q2 — What replaces launchd's `certification` field, which can no longer name an exact build?**
- **A (recommended):** remove it; every bootstrap's existing post-observation (exact generated label
  loaded, staging empty, FD baseline restored) is the runtime proof, failure compensates and refuses,
  and the Phase 9 gate proves the FD-3 contract once as gate evidence. → `automation` works on every
  admitted Mac after one gate run; a macOS release that breaks FD-3 fails closed per run.
- **B:** keep `certification`, keyed to a macOS major (`26`); a new major refuses mutation until the
  gate is re-run and a release ships. → Safer against a silent FD-3 change, but every macOS 27 user
  loses `automation` until a release.
- **C:** keep the exact-build certification for launchd only. → Defeats D65 for `automation`; every
  point update strands it again.

**Q3 — Which directories must be root-owned with no group/other write?**
- **A (recommended):** `<dev>` and everything below it on each path (plus `/usr`, `/usr/bin`, `/`,
  `/bin`); `/Applications` (`root:admin 0775` on every stock Mac) is an accepted residual (13). →
  Every stock Xcode admits; an admin can only swap one root-installed Apple Git for another, bounded
  below by the floor.
- **B:** every ancestor up to `/`, with an exception for exactly `/Applications` at `root:admin
  0775`. → Same admission on stock Macs, one more special case; refuses unusual layouts earlier.
- **C:** A plus an Apple code-signature check (`/usr/bin/codesign --verify -R="anchor apple"`) on
  each Git target. → Closes residual 13, adds a spawn per admission and a new fixed-path executable to
  admit.

**Q4 — Which transports does the Phase 9 gate prove?**
- **A (recommended):** local/file only; HTTPS and SSH keep refusing `unsupported_git_distribution`
  (D59 Q4-A unchanged). → The gate needs only a disposable macOS account; the SSH floor and `/usr/bin/ssh`
  admission ship dormant.
- **B:** the founder also supplies a disposable HTTPS and SSH remote; the gate records both process
  traces and opens both transports. → Adds an SSH version-probe edge, two trace tasks and remote
  credentials handling; roughly doubles the plan.

## Routine calls made without asking

- **Floors equal the measured 2026-09-23 row:** Git 2.54.0 / Apple Git-157, OpenSSH 10.3p1, macOS
  26.6.2. Nothing older was ever traced; lowering a floor is a later amendment with its own trace.
- **`architecture` stays `arm64`.** It is the only traced architecture; Intel is out of scope.
- **setuid/setgid targets refuse**, and targets need the owner-execute bit. Cheap, and no admitted
  Apple binary has either.
- **Version-neutral IDs:** `apple-git-arm64-v2`, `apple-git-process-v2`, `launchctl-macos-preview-v2`,
  `launchctl-macos-fd3-v2`. Old IDs refuse; the cutover leaves Git and launchd disabled
  (roadmap `:425`), so no live home holds one.
- **Git evidence is per invocation, not persisted.** Persisting it would make a `push_pending` retry
  refuse forever after an Xcode update (spec §4.2 proposed rule 5).
- **Launchd evidence is re-derived** in `loadLaunchdProcessTable` from a fresh admitted observation and
  bound through the existing `processTableHash`; the preview stays unchanged and inode-free (§2.2).
- **`*.pinned-host.test.ts` keeps its name** and now runs on any admitted host; renaming buys nothing.

## NEW-46 is not closed by this plan

NEW-46 (`BACKLOG.md:71`) is the version-probe spawn in `capture` of the discovered `claude`/`codex`
executable (`apps/cli/src/commands/capture.ts:238-255`; the threat model's `:263` predates later edits,
`docs/architecture/threat-model.md:704-714`). Those executables are user-installed:
`/opt/homebrew/bin` is user-owned `drwxrwxr-x` and `~/.local/bin` is the user's, which
`assertTrustedExecutable` accepts on purpose (`packages/platform-macos/src/macos.ts:279-283, 347-350`).
Fixed-path root-owned admission would refuse every ordinary vendor install, so it cannot close NEW-46.
NEW-46 needs its other arm — manifest-owned persisted executable identity with upgrade/move drift
behaviour — and stays open as its own row. No task here.

## Global Constraints

- Never consult `PATH`, `DEVELOPER_DIR`, `xcrun` or `/usr/bin/git` to find Git, launchctl or ssh.
- Admission: owner uid `0`; `(mode & 0o022) == 0`; target regular file, owner-execute set, no
  setuid/setgid; at most 8 links in a chain.
- Git floor `git version >= 2.54.0` with `Apple Git-<n>`, `n >= 157`; SSH floor `OpenSSH_10.3p1`;
  macOS floor `ProductVersion >= 26.6.2`; no ceiling.
- Required Git build-option lines, each exactly once: `cpu: arm64`, `shell-path: /bin/sh`,
  `default-hash: sha1`, `default-ref-format: files`. All other build-option lines are ignored; more
  than 32 probe lines refuse.
- Refusal codes stay `unsupported_git_distribution` and `unsupported_launchd_distribution`; exit codes
  are unchanged.
- The Git process table (nodes, edges, argv, environments, budgets) and the launchd argv/profiles are
  unchanged except IDs.
- The repository is public: no host-private path or hash beyond those already in the spec.
- Per-task validation is `npm run lint` only (D70); commits stage exact paths, no `Co-Authored-By`.

## Review Focus

1. **A macOS/Xcode update between a persisted Git push plan and its `push_pending` retry** must
   re-admit, not refuse forever. Pinned by Task 1 Part 1b test "retry re-admits after a binary change".
2. **A hostile `PATH`/`DEVELOPER_DIR` in the caller's environment** must change nothing about which Git
   runs. Pinned by Task 1 Part 1b test "the production runtime inspects only policy paths under a
   hostile PATH and DEVELOPER_DIR".
3. **`/Applications` group-writable on a stock Mac** must still admit Xcode's Git. Pinned by Task 1
   Part 1a test "admits a stock Xcode layout under a group-writable /Applications".
4. **Two different admitted launchctl identities** must give byte-identical template and observation
   hashes, while one identity change inside an apply refuses. Pinned by Task 2 Part 2a tests.
5. **An uncertified row no longer blocks `automation disable`/`uninstall`** on an admitted host, while a
   below-floor host still refuses with the manual `bootout` list. Pinned by Task 2 Part 2b tests.

## File map

| File | Change | Part |
|---|---|---|
| `packages/security/src/git/types.ts:309-380` | policy, observation and admitted types; old row types removed | 1a |
| `packages/security/src/git/distribution.ts` | rewritten: policy constant, `selectDeveloperDirectory`, `admitGitFiles`, `admitGitCapability`, `recheckGitDistribution` | 1a |
| `packages/security/src/git/process-table.ts:53-54, 440-449, 502, 963` | version-neutral IDs | 1a |
| `packages/security/src/git/push-plan.ts:68, 142, 162` | `distributionId` literal follows the policy ID | 1a |
| `packages/security/src/git/supervisor.ts:161-174` | `admittingGitIdentityProbe` rechecks per-invocation evidence | 1a |
| `packages/security/src/git/index.ts`, `packages/security/src/index.ts`, `index.test.ts:56-61` | export list | 1a |
| `packages/security/src/git/*.test.ts`, `distribution.test-fixtures.ts` | tests and fixtures | 1a |
| `apps/cli/src/commands/git/runtime.ts:145, 181-231, 771-836, 943-956` | node observer, `<dev>` resolution, probe parse, evidence | 1b |
| `apps/cli/src/commands/git/service.ts:1673`, `testing.ts:134-140` | policy ID; fake runtime | 1b |
| `tests/integration/git/*.pinned-host.test.ts` | host tests against the policy | 1c |
| `packages/platform-macos/src/launchd/distribution.ts` | rewritten: policy, `admitLaunchdHost`, `recheckLaunchdHost`; `certification` removed | 2a |
| `packages/platform-macos/src/launchd/process-table.ts:120-383` | `launchctl_identity` slot; `requireLaunchdMutationCertified` → `requireLaunchdMutationTable` | 2a |
| `packages/platform-macos/src/launchd/{effects,observe,snapshot}.ts` | admission call sites; `loadLaunchdProcessTable` fills the identity | 2a |
| `packages/platform-macos/src/launchd/*.test.ts` | tests | 2a |
| `apps/cli/src/lifecycle/adapters.ts:75-76, 392-431` | launchctl observer returns `dev`/`ino` and `/`, `/bin` | 2b |
| `apps/cli/src/commands/automation/service.ts:331, 988-995, 1127-1129` | `certification` gates removed | 2b |
| `apps/cli/src/lifecycle/uninstall.ts:1340-1349`, `testing.ts` | `certification` gate removed | 2b |
| `tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts` | host test against the policy | 2c |
| spec, `BACKLOG.md`, roadmap, `docs/architecture/{foundation.md,foundation-constraints.md,threat-model.md}` | plan close | 3 |

## Waves

`npm run lint` is whole-repository — `tsc -b` over every package, `apps/cli` and `tests`
(`tsconfig.json` references `./tests`, whose `include` has `integration/**/*.ts`), then ESLint
(`package.json:13`). A commit that removes an export another package still imports cannot lint green,
so each task is one vertical slice with one commit at its end: Task 1 owns every Git file, Task 2
every launchd file. Parts are steps inside one task and one worktree, not separate commits. The two
file sets are disjoint, so Tasks 1 and 2 run in parallel; `apps/cli/src/lifecycle/testing.ts` is
edited by Task 2 alone.

| Wave | Task | Size | Worktree | Consumes |
|---|---|---|---|---|
| 1 | Task 1 — Git: policy (1a), CLI runtime (1b), host tests (1c) | L | `../developer-os.worktrees/new-113-git` | — |
| 1 | Task 2 — launchd: policy (2a), CLI observer and `certification` removal (2b), host test (2c) | L | `../developer-os.worktrees/new-113-launchd` | — |
| 2 | Task 3 — plan close (founder runs the full suite) | M | orchestrator checkout | Tasks 1, 2 |
| 3 | Task 4 — Phase 9 gate on a disposable macOS account (founder step) | L | disposable account | Task 3 |

Physical order below is by layer — 1a, 2a (packages), 1b, 2b (`apps/cli`), 1c/2c (host tests), then
Tasks 3 and 4. An implementer of Task 1 reads Parts 1a, 1b and 1c; of Task 2, Parts 2a, 2b and 2c.

---

### Task 1, Part 1a: Git distribution policy and admission (`packages/security`)

**Task 1 as a whole (L, one worktree, one commit at the end of Part 1c):** Git is found at fixed paths
and admitted by ownership, mode, floor and capability, end to end. **Part 1a:** the compiled Git row
becomes `GIT_DISTRIBUTION_POLICY`; pure admission returns `AdmittedGitDistributionV1`; the supervisor
rechecks it.

**Files:**
- Modify: `packages/security/src/git/types.ts:309-380`
- Rewrite: `packages/security/src/git/distribution.ts`
- Modify: `packages/security/src/git/process-table.ts:53-54` (IDs), `:440-449`, `:502`, `:963`
- Modify: `packages/security/src/git/push-plan.ts:68, 142, 162`
- Modify: `packages/security/src/git/supervisor.ts:161-174`
- Modify: `packages/security/src/git/index.ts`, `packages/security/src/index.ts`,
  `packages/security/src/index.test.ts:56-61`
- Test: `packages/security/src/git/distribution.test.ts`, `distribution.test-fixtures.ts`,
  `supervisor.test.ts:128-129`, `gateways.test.ts:47, 116`, `process-table.test.ts:133`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export const GIT_DISTRIBUTION_POLICY_ID = "apple-git-arm64-v2";
export const SUPPORTED_GIT_PROCESS_TABLE_ID = "apple-git-process-v2";

export type GitPathObservationV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "file" | "directory" | "other"; readonly ownerUid: number; readonly mode: number;
      readonly dev: string; readonly ino: string; readonly size: number; readonly sha256: string | null }
  | { readonly kind: "symlink"; readonly ownerUid: number; readonly mode: number;
      readonly dev: string; readonly ino: string; readonly size: number; readonly target: string };

/** No-follow `lstat` of one absolute path; `sha256` only for a regular file. */
export type GitPathInspectorV1 = (path: CanonicalAbsolutePathV1) => GitPathObservationV1;

export interface GitDistributionPolicyV2 { /* exactly spec §4.2 proposed schema */ }
export interface AdmittedGitFileV1 { canonicalPath; dev; ino; size; sha256: LowerHexSha256 | null }
export interface AdmittedGitFilesV1 { policyId; developerDirectory; executables; execPathLinks }
export interface AdmittedGitDistributionV1 extends AdmittedGitFilesV1 { gitVersionLine: string }

export const GIT_DISTRIBUTION_POLICY: GitDistributionPolicyV2;
export function selectDeveloperDirectory(inspect: GitPathInspectorV1, policy?: GitDistributionPolicyV2): CanonicalAbsolutePathV1;
export function admitGitFiles(inspect: GitPathInspectorV1, architecture: string, policy?: GitDistributionPolicyV2): AdmittedGitFilesV1;
export function parseGitVersionLine(line: string): { major: number; minor: number; patch: number; appleGit: number } | null;
export function admitGitCapability(files: AdmittedGitFilesV1, probeStdout: string, policy?: GitDistributionPolicyV2): AdmittedGitDistributionV1;
export function recheckGitDistribution(inspect: GitPathInspectorV1, architecture: string, admitted: AdmittedGitFilesV1, policy?: GitDistributionPolicyV2): void;
export function admittingGitIdentityProbe(admitted: () => AdmittedGitFilesV1, inspect: GitPathInspectorV1, architecture: string): GitExecutableIdentityProbeV1;
```

Removed exports: `SUPPORTED_GIT_DISTRIBUTION`, `validateSupportedGitDistribution`,
`gitDistributionIdentity`, `admitGitDistribution`, `ObservedGitDistributionV1`,
`SupportedGitDistributionV1`, `ExecutableFileIdentityV1`. The process table moves to
`GIT_DISTRIBUTION_POLICY.processTable`.

- [ ] **Step 1: Write the tests** in `distribution.test.ts`, replacing the exact-row cases. The fixture
  is a `Map`-backed inspector:

```ts
import { describe, expect, it } from "vitest";
import { admitGitCapability, admitGitFiles, parseGitVersionLine, recheckGitDistribution, selectDeveloperDirectory } from "./distribution.js";
import { stockXcode, withPath, PROBE_OK } from "./distribution.test-fixtures.js";

const XCODE = "/Applications/Xcode.app/Contents/Developer";
const CLT = "/Library/Developer/CommandLineTools";

describe("developer directory", () => {
  it("follows the xcode-select link", () => {
    expect(selectDeveloperDirectory(stockXcode({ link: "/Applications/Xcode-beta.app/Contents/Developer" }))).toBe("/Applications/Xcode-beta.app/Contents/Developer");
  });
  it("falls back to Xcode, then Command Line Tools", () => {
    expect(selectDeveloperDirectory(stockXcode({ link: null }))).toBe(XCODE);
    expect(selectDeveloperDirectory(stockXcode({ link: null, xcode: false }))).toBe(CLT);
  });
  it.each(["relative/Developer", "/tmp/Developer", "/Applications/X.app/Contents/Developer/..", "/Applications/a/b.app/Contents/Developer"])(
    "refuses link target %s", (target) => {
      expect(() => selectDeveloperDirectory(stockXcode({ link: target }))).toThrow("unsupported_git_distribution");
    });
  it("refuses a link that is not root-owned", () => {
    expect(() => selectDeveloperDirectory(withPath(stockXcode({ link: XCODE }), "/var/db/xcode_select_link", { ownerUid: 501 }))).toThrow("unsupported_git_distribution");
  });
});

describe("file admission", () => {
  it("admits a stock Xcode layout under a group-writable /Applications", () => {
    const inspect = withPath(stockXcode({ link: XCODE }), "/Applications", { mode: 0o775 });
    expect(admitGitFiles(inspect, "arm64").developerDirectory).toBe(XCODE);
  });
  it("admits Command Line Tools only", () => {
    expect(admitGitFiles(stockXcode({ link: CLT, xcode: false }), "arm64").developerDirectory).toBe(CLT);
  });
  it.each([
    ["non-root target", `${XCODE}/usr/bin/git`, { ownerUid: 501 }],
    ["group-writable target", `${XCODE}/usr/bin/git`, { mode: 0o775 }],
    ["other-writable directory", `${XCODE}/usr/bin`, { mode: 0o757 }],
    ["group-writable developer root", XCODE, { mode: 0o775 }],
    ["setuid target", `${XCODE}/usr/bin/git`, { mode: 0o4755 }],
    ["setgid target", `${XCODE}/usr/bin/git`, { mode: 0o2755 }],
    ["non-executable target", `${XCODE}/usr/bin/git`, { mode: 0o644 }],
    ["non-root exec-path link", `${XCODE}/usr/libexec/git-core/git-receive-pack`, { ownerUid: 501 }],
    ["exec-path link retargeted", `${XCODE}/usr/libexec/git-core/git-pack-objects`, { target: "/tmp/git" }],
    ["helper target group-writable", `${XCODE}/usr/libexec/git-core/git-remote-http`, { mode: 0o775 }],
    ["ssh not root", "/usr/bin/ssh", { ownerUid: 501 }],
  ])("refuses a %s", (_name, path, change) => {
    expect(() => admitGitFiles(withPath(stockXcode({ link: XCODE }), path, change), "arm64")).toThrow("unsupported_git_distribution");
  });
  it("refuses another architecture", () => {
    expect(() => admitGitFiles(stockXcode({ link: XCODE }), "x64")).toThrow("unsupported_git_distribution");
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
  ])("%s admits: %s", (line, admits) => {
    const files = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    const run = () => admitGitCapability(files, `${line}\n${PROBE_OK}`);
    if (admits) expect(run().gitVersionLine).toBe(line); else expect(run).toThrow("unsupported_git_distribution");
  });
  it.each(["cpu: arm64", "shell-path: /bin/sh", "default-hash: sha1", "default-ref-format: files"])("refuses without %s", (required) => {
    const files = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    const probe = PROBE_OK.split("\n").filter((line) => line !== required).join("\n");
    expect(() => admitGitCapability(files, `git version 2.54.0 (Apple Git-157)\n${probe}`)).toThrow("unsupported_git_distribution");
  });
  it("ignores unknown and changed library lines", () => {
    const files = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    expect(() => admitGitCapability(files, `git version 2.54.0 (Apple Git-157)\n${PROBE_OK}\nlibcurl: 9.9.9\nfeature: new`)).not.toThrow();
  });
  it("refuses a duplicated required line and more than 32 lines", () => {
    const files = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    expect(() => admitGitCapability(files, `git version 2.54.0 (Apple Git-157)\n${PROBE_OK}\ndefault-hash: sha1`)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(files, `git version 2.54.0 (Apple Git-157)\n${PROBE_OK}\n${"x: y\n".repeat(40)}`)).toThrow("unsupported_git_distribution");
  });
  it("parses only canonical integers", () => {
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157)")).toEqual({ major: 2, minor: 54, patch: 0, appleGit: 157 });
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157) extra")).toBeNull();
  });
});

describe("per-invocation evidence", () => {
  it.each(["dev", "ino", "size", "sha256"] as const)("refuses a changed %s within one invocation", (field) => {
    const inspect = stockXcode({ link: XCODE });
    const admitted = admitGitFiles(inspect, "arm64");
    const drifted = withPath(inspect, `${XCODE}/usr/bin/git`, { [field]: field === "size" ? 1 : "9" });
    expect(() => { recheckGitDistribution(drifted, "arm64", admitted); }).toThrow("unsupported_git_distribution");
  });
  it("admits two different binaries as two independent invocations", () => {
    const first = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    const second = admitGitFiles(withPath(stockXcode({ link: XCODE }), `${XCODE}/usr/bin/git`, { sha256: "b".repeat(64), size: 4_000_000 }), "arm64");
    expect(first.executables).not.toEqual(second.executables);
  });
});
```

  `distribution.test-fixtures.ts` gains `stockXcode({ link, xcode = true })` (a `Map` of every path
  the policy walks, root-owned `0755` directories and files, the five `../../bin/git` links and the
  `git-remote-http` link; `link: null` makes `/var/db/xcode_select_link` absent; `/Applications` is
  `0775`), `withPath(inspect, path, change)` and `PROBE_OK` (the thirteen measured build-option lines
  of the D59 row, from the spec, in order). Update `supervisor.test.ts:128-129` and
  `gateways.test.ts:47, 116` to build the probe from `admittingGitIdentityProbe(() => admitted,
  stockXcode(...), "arm64")`, and `process-table.test.ts:133` to expect `GIT_DISTRIBUTION_POLICY_ID`.
  Add to `supervisor.test.ts`: a `recheck` that sees a changed `sha256` refuses before the permit
  runs.

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.** In `distribution.ts`, keep the local `fail`/`exact` helpers and
  `deepFreeze`; delete the row parser. Core logic:

```ts
const REFUSE = (): never => { throw new SecurityRefusalError("unsupported_git_distribution"); };
const BUNDLE_DEVELOPER = /^\/Applications\/[^/\0\p{Cc}]{1,255}\.app\/Contents\/Developer$/u;

function admittedEntry(observation: GitPathObservationV1): asserts observation is Exclude<GitPathObservationV1, { kind: "absent" }> {
  if (observation.kind === "absent" || observation.ownerUid !== 0 || (observation.mode & 0o022) !== 0) REFUSE();
}

function admittedTarget(path: CanonicalAbsolutePathV1, inspect: GitPathInspectorV1): AdmittedGitFileV1 {
  const target = inspect(path);
  admittedEntry(target);
  if (target.kind !== "file" || (target.mode & 0o6000) !== 0 || (target.mode & 0o100) === 0 || target.sha256 === null) REFUSE();
  return { canonicalPath: path, dev: target.dev, ino: target.ino, size: target.size, sha256: parseLowerHexSha256(target.sha256) };
}

export function selectDeveloperDirectory(inspect: GitPathInspectorV1, policy = GIT_DISTRIBUTION_POLICY): CanonicalAbsolutePathV1 {
  const link = inspect(policy.developerDirectoryLink);
  if (link.kind === "absent") {
    const [xcode, clt] = policy.developerDirectoryFallbacks;
    return inspect(xcode).kind === "directory" ? xcode : clt;
  }
  if (link.kind !== "symlink" || link.ownerUid !== 0) REFUSE();
  const target = link.target;
  if (target !== "/Library/Developer/CommandLineTools" && !BUNDLE_DEVELOPER.test(target)) REFUSE();
  return parseCanonicalAbsolutePathText(target);
}
```

  `admitGitFiles` then: requires `architecture === policy.architecture`; walks every directory from
  `<dev>` to each invoked path's parent with `admittedEntry` + `kind === "directory"`; resolves each
  invoked path's link chain (at most 8 hops, relative targets joined against the link's directory,
  each hop `admittedEntry` and `kind === "symlink"`); admits each resolved target with
  `admittedTarget`; checks each exec-path link is a root-owned symlink whose `target` equals the
  policy literal; admits `/usr`, `/usr/bin` and `/usr/bin/ssh`. `admitGitCapability` splits stdout on
  LF, drops the empty final element, refuses more than 32 lines or any line failing
  `parseBoundedTextLine`, checks line 0 with `parseGitVersionLine` against `gitVersionFloor`
  (lexicographic on `[major, minor, patch]`, then `appleGit >= 157`), and requires each required line
  exactly once in lines 1..n. `recheckGitDistribution` re-runs `admitGitFiles` and compares canonical
  JSON with `admitted`; unequal refuses. `parseGitVersionLine` uses
  `/^git version (0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*) \(Apple Git-(0|[1-9]\d*)\)$/u`.
  In `supervisor.ts:161-174`, `admittingGitIdentityProbe(admitted, inspect, architecture)` calls
  `recheckGitDistribution(inspect, architecture, admitted())` and returns the admitted executable's
  `invokedPath`. Rename the IDs in `process-table.ts:53-54` and follow them through `types.ts:311-312`,
  `push-plan.ts:68, 142, 162`; `process-table.ts:502` keeps `envLiteral(GIT_DISTRIBUTION_POLICY_ID)`.

- [ ] **Step 4: Continue with Part 1b** in the same worktree. No lint and no commit yet: `apps/cli` and
  `tests` still import the removed exports until Parts 1b and 1c land.

---

### Task 2, Part 2a: launchd policy and admission (`packages/platform-macos`)

**Task 2 as a whole (L, one worktree, one commit at the end of Part 2c):** `/bin/launchctl` is admitted
by ownership, mode, the macOS floor and the `print` probe, and `certification` is gone, end to end.
**Part 2a:** the policy, the identity re-derived into the expanded table, and `certification` removed
from `packages/platform-macos`.

**Files:**
- Rewrite: `packages/platform-macos/src/launchd/distribution.ts`
- Modify: `packages/platform-macos/src/launchd/process-table.ts:120-175, 218-262, 305-383`
- Modify: `packages/platform-macos/src/launchd/effects.ts:180-195, 218-250, 389-395`,
  `observe.ts:35-40, 170-176`, `snapshot.ts:140-146, 385-390, 426-432`, `index.ts`,
  `packages/platform-macos/src/index.ts:115-151`
- Test: `packages/platform-macos/src/launchd/process-table.test.ts`, `effects.test.ts:84, 362-363, 731-732`,
  `snapshot.test.ts:50, 209-210, 485`, `observe.test.ts:72-73, 233-274`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type LaunchdDistributionPolicyV2 = {
  readonly previewTableId: "launchctl-macos-preview-v2";
  readonly mutationTableId: "launchctl-macos-fd3-v2";
  readonly operatingSystem: { readonly productName: "macOS"; readonly minimumProductVersion: "26.6.2" };
  readonly executable: { readonly path: "/bin/launchctl"; readonly ownerUid: 0 };
  readonly emptyDirectory: LaunchdEmptyDirectoryIdentityV1;
};
export interface ObservedLaunchdDistributionV1 {
  readonly operatingSystem: { productName: string; productVersion: string; buildVersion: string };
  readonly executable: { path: string; kind: "file" | "directory" | "symlink" | "other"; ownerUid: number;
    mode: number; dev: string; ino: string; size: number; sha256: string };
  readonly ancestors: readonly { path: "/" | "/bin"; kind: "directory" | "other"; ownerUid: number; mode: number }[];
}
export type LaunchctlIdentityV1 = { dev: UInt64DecimalV1; ino: UInt64DecimalV1; size: number;
  sha256: LowerHexSha256; productVersion: string; buildVersion: string };
export const LAUNCHD_DISTRIBUTION_POLICY: LaunchdDistributionPolicyV2;
export function admitLaunchdHost(observed: ObservedLaunchdDistributionV1, policy?: LaunchdDistributionPolicyV2): LaunchctlIdentityV1;
export function recheckLaunchdHost(observed: ObservedLaunchdDistributionV1, identity: LaunchctlIdentityV1): void;
export function requireLaunchdMutationTable(table: SupportedLaunchdProcessTableV1, template?: SupportedLaunchdProcessTableTemplateV1): void;
export function expandLaunchdProcessTable(staging, launchctl: LaunchctlIdentityV1, template?): SupportedLaunchdProcessTableV1;
export function loadLaunchdProcessTable(productHome, coordinatorId, options: { fs?; template?; observe: () => Promise<ObservedLaunchdDistributionV1> }): Promise<SupportedLaunchdProcessTableV1>;
```

The dependency interfaces' `inspectExecutable(path: "/bin/launchctl")` now returns
`ObservedLaunchdDistributionV1["executable"] & { ancestors }` — Part 2b implements it in
`apps/cli/src/lifecycle/adapters.ts`. Removed: `SUPPORTED_LAUNCHD_DISTRIBUTION`,
`LaunchdCertificationV1`, `admitLaunchdDistribution`, `requireLaunchdMutationCertified`, the
`certification` field of the table and template.

- [ ] **Step 1: Write the tests** in `process-table.test.ts`, replacing the pinned-row and
  certification cases:

```ts
const admitted = (): ObservedLaunchdDistributionV1 => ({
  operatingSystem: { productName: "macOS", productVersion: "26.6.2", buildVersion: "25G83" },
  executable: { path: "/bin/launchctl", kind: "file", ownerUid: 0, mode: 0o755, dev: "16777232", ino: "1152921500312", size: 363488, sha256: "b".repeat(64) },
  ancestors: [{ path: "/", kind: "directory", ownerUid: 0, mode: 0o755 }, { path: "/bin", kind: "directory", ownerUid: 0, mode: 0o755 }],
});

describe("launchctl admission", () => {
  it.each(["26.6.2", "26.7", "26.10.1", "27.0"])("admits macOS %s", (productVersion) => {
    expect(() => admitLaunchdHost({ ...admitted(), operatingSystem: { ...admitted().operatingSystem, productVersion } })).not.toThrow();
  });
  it.each(["26.6.1", "26.6", "25.9.9", "27", "26.6.2.1", "026.6.2", "", "26.x"])("refuses macOS %s", (productVersion) => {
    expect(() => admitLaunchdHost({ ...admitted(), operatingSystem: { ...admitted().operatingSystem, productVersion } })).toThrow("unsupported_launchd_distribution");
  });
  it("never compares the build", () => {
    expect(() => admitLaunchdHost({ ...admitted(), operatingSystem: { ...admitted().operatingSystem, buildVersion: "26A1" } })).not.toThrow();
  });
  it.each([
    ["owner", { ownerUid: 501 }], ["group write", { mode: 0o775 }], ["other write", { mode: 0o757 }],
    ["setuid", { mode: 0o4755 }], ["no execute", { mode: 0o644 }], ["symlink", { kind: "symlink" as const }],
  ])("refuses launchctl %s", (_name, change) => {
    expect(() => admitLaunchdHost({ ...admitted(), executable: { ...admitted().executable, ...change } })).toThrow("unsupported_launchd_distribution");
  });
  it.each(["/", "/bin"] as const)("refuses a writable %s", (path) => {
    const ancestors = admitted().ancestors.map((entry) => (entry.path === path ? { ...entry, mode: 0o775 } : entry));
    expect(() => admitLaunchdHost({ ...admitted(), ancestors })).toThrow("unsupported_launchd_distribution");
  });
  it.each(["dev", "ino", "size", "sha256"] as const)("refuses a changed %s after admission", (field) => {
    const identity = admitLaunchdHost(admitted());
    const executable = { ...admitted().executable, [field]: field === "size" ? 1 : field === "sha256" ? "c".repeat(64) : "7" };
    expect(() => { recheckLaunchdHost({ ...admitted(), executable }, identity); }).toThrow("unsupported_launchd_distribution");
  });
});

describe("launchd tables carry no host literal", () => {
  it("keeps template and observation hashes equal for two admitted identities", () => {
    const one = expandLaunchdProcessTable(STAGING, admitLaunchdHost(admitted()));
    const two = expandLaunchdProcessTable(STAGING, admitLaunchdHost({ ...admitted(), executable: { ...admitted().executable, sha256: "c".repeat(64), size: 400000 } }));
    expect(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(one))).toBe(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(two)));
    expect(launchdProcessTableHash(one)).not.toBe(launchdProcessTableHash(two));
    expect(JSON.stringify(LAUNCHD_PREVIEW_OBSERVATION_TABLE)).not.toMatch(/25G83|363488|sha256/u);
    expect("certification" in SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE).toBe(false);
  });
  it("admits a mutation table without certification", () => {
    expect(() => { requireLaunchdMutationTable(expandLaunchdProcessTable(STAGING, admitLaunchdHost(admitted()))); }).not.toThrow();
  });
});
```

  `STAGING` is the existing staging fixture in that file. In `effects.test.ts`, `snapshot.test.ts` and
  `observe.test.ts`, replace every `SUPPORTED_LAUNCHD_DISTRIBUTION.*` double with the `admitted()`
  observation (move it to a new `packages/platform-macos/src/launchd/distribution.test-fixtures.ts`),
  delete the `certification` literals (`effects.test.ts:84`, `snapshot.test.ts:50`), turn
  `snapshot.test.ts:485` (build `25G84`) into "a `ProductVersion` below the floor refuses", and add to
  `effects.test.ts`: "a `sha256` change between `loadLaunchdProcessTable` and the bootout spawn refuses
  `unsupported_launchd_distribution` before the runner runs" and "a bootstrap whose post-observation
  is not the planned generated label compensates and refuses `unsupported_launchd_distribution`" (the
  second may already exist under the certification name; if so, keep it and drop the certification
  precondition).

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.** `distribution.ts`: the version compare is

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

  `admitLaunchdHost` checks `productName === "macOS"`, the floor, the executable (`kind === "file"`,
  uid 0, `(mode & 0o022) === 0`, `(mode & 0o6000) === 0`, `(mode & 0o100) !== 0`, 64-hex `sha256`),
  both ancestors (`kind === "directory"`, uid 0, `(mode & 0o022) === 0`, exactly `/` and `/bin`), and
  returns the identity with `parseUInt64Decimal` on `dev`/`ino`. `recheckLaunchdHost` re-admits and
  compares canonical JSON. `process-table.ts`: the table type gains
  `readonly launchctlIdentity: LaunchctlIdentityV1`, the template gains
  `readonly launchctlIdentity: { readonly slot: "launchctl_identity" }`, `operatingSystem` and
  `executable` take the policy's types, `certification` goes; `expandLaunchdProcessTable` takes the
  identity as its second argument and `deslotLaunchdProcessTable` maps it back to the slot;
  `requireLaunchdMutationCertified` becomes `requireLaunchdMutationTable` (template-hash check only).
  `effects.ts:180-195`: `loadLaunchdProcessTable` calls `admitLaunchdHost(await options.observe())`
  and passes the identity to `expandLaunchdProcessTable`; `effects.ts:242-250`, `observe.ts:170-176`
  and `snapshot.ts:426-432` call `recheckLaunchdHost` against `table.launchctlIdentity` where a table
  exists (bootout, snapshot), and `admitLaunchdHost` where only the preview observation table exists
  (`observe.ts`). Update docblocks that say "certified" or "pinned row".

- [ ] **Step 4: Continue with Part 2b** in the same worktree. No lint and no commit yet: `apps/cli` and
  `tests` still import the removed exports until Parts 2b and 2c land.

---

### Task 1, Part 1b: Git node observer and runtime (`apps/cli`)

**What:** the CLI's Git runtime observes the file system without following `PATH`/`DEVELOPER_DIR`,
admits per invocation, and binds evidence through the supervisor. Same worktree as Part 1a.

**Files:**
- Modify: `apps/cli/src/commands/git/runtime.ts:145` (delete `XCODE_VERSION_PLIST`), `:181-231`
  (`linkChainOf`, `observeGitDistribution` → `inspectGitPath`), `:771-836` (`prepareLocalPush`),
  `:943-956` (`createProductionGitRuntime`), plus every `SUPPORTED_GIT_DISTRIBUTION` use
  (`:477, 542, 630, 683, 745`) → `GIT_DISTRIBUTION_POLICY`
- Modify: `apps/cli/src/commands/git/service.ts:105, 1673`, `apps/cli/src/commands/git/testing.ts:19, 134-140`
- Test: `apps/cli/src/commands/git/runtime.test.ts`

**Interfaces:**
- Consumes (Part 1a, same worktree): `GIT_DISTRIBUTION_POLICY`, `GIT_DISTRIBUTION_POLICY_ID`, `GitPathInspectorV1`,
  `admitGitFiles`, `admitGitCapability`, `recheckGitDistribution`, `admittingGitIdentityProbe`,
  `AdmittedGitFilesV1`.
- Produces: `export function inspectGitPath(path: CanonicalAbsolutePathV1): GitPathObservationV1`
  (no-follow `lstat`, `readlink` for links, descriptor hash for regular files with a `dev`/`ino`/`size`
  match between `lstat` and the opened descriptor, `absent` on `ENOENT`, refusal on any other error).
  `GitRuntimeV1` keeps its shape.

- [ ] **Step 1: Write the tests** in `runtime.test.ts`:

```ts
describe("Git distribution observation", () => {
  it("the production runtime inspects only policy paths under a hostile PATH and DEVELOPER_DIR", async () => {
    const seen: string[] = [];
    const inspect = (path: CanonicalAbsolutePathV1) => { seen.push(path); return stockXcode({ link: XCODE })(path); };
    vi.stubEnv("PATH", "/tmp/evil/bin"); vi.stubEnv("DEVELOPER_DIR", "/tmp/evil/Developer");
    await createProductionGitRuntime({ inspect, architecture: "arm64" }).admitDistribution("local");
    expect(seen).toContain("/var/db/xcode_select_link");
    expect(seen.every((path) => path === "/" || path.startsWith("/var/db/") || path.startsWith("/usr") ||
      path.startsWith("/Applications/") || path.startsWith("/Library/Developer/"))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("no Git module reads PATH or DEVELOPER_DIR", async () => {
    for (const file of ["runtime.ts", "../../../../../packages/security/src/git/distribution.ts"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/process\.env(\.|\[")(PATH|DEVELOPER_DIR)/u);
    }
  });

  it("inspectGitPath reports a link without following it and hashes a file by descriptor", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "dos-git-inspect-")));
    await writeFile(join(dir, "bin"), "#!/bin/sh\n", { mode: 0o755 });
    await symlink("bin", join(dir, "link"));
    expect(inspectGitPath(canonical(join(dir, "link")))).toMatchObject({ kind: "symlink", target: "bin" });
    expect(inspectGitPath(canonical(join(dir, "bin")))).toMatchObject({ kind: "file", sha256: createHash("sha256").update("#!/bin/sh\n").digest("hex") });
    expect(inspectGitPath(canonical(join(dir, "missing")))).toEqual({ kind: "absent" });
  });

  it("retry re-admits after a binary change between plan and retry", () => {
    const first = admitGitFiles(stockXcode({ link: XCODE }), "arm64");
    const updated = withPath(stockXcode({ link: XCODE }), `${XCODE}/usr/bin/git`, { sha256: "d".repeat(64), ino: "42" });
    expect(() => admitGitFiles(updated, "arm64")).not.toThrow();
    expect(() => { recheckGitDistribution(updated, "arm64", first); }).toThrow("unsupported_git_distribution");
  });

  it("refuses HTTPS and SSH as before (D59 Q4-A)", async () => {
    const runtime = createProductionGitRuntime({ inspect: stockXcode({ link: XCODE }), architecture: "arm64" });
    await expect(runtime.admitDistribution("https")).rejects.toThrow("unsupported_git_distribution");
    await expect(runtime.admitDistribution("ssh")).rejects.toThrow("unsupported_git_distribution");
    await expect(runtime.admitDistribution("local")).resolves.toBeUndefined();
  });
});
```

  The `stockXcode`/`withPath` fixtures come from `@developer-os/security`'s test fixtures; if the
  package does not export test fixtures to `apps/cli`, copy the two functions into
  `apps/cli/src/commands/git/testing.ts` (the existing fake-runtime module) rather than adding a
  package export. `createProductionGitRuntime` gains an optional
  `{ inspect?: GitPathInspectorV1; architecture?: string }` for this test, defaulting to
  `inspectGitPath` and `process.arch`.

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.** `prepareLocalPush` becomes:

```ts
const files = admitGitFiles(inspect, architecture);
let admitted: AdmittedGitFilesV1 = files;
const supervisor = new GitProcessSupervisor(
  GIT_DISTRIBUTION_POLICY.processTable,
  new SupervisedProcessRunner(nodeSupervisedProcessDependencies),
  admittingGitIdentityProbe(() => admitted, inspect, architecture),
);
// …
const probeStdout = await runCoordinatorGit(supervisor, probePhase, "direct_distribution_probe", 0, {}, "distribution_probe", base, root, null);
admitted = admitGitCapability(files, probeStdout);
```

  `createProductionGitRuntime().admitDistribution` keeps `if (transport !== "local") unsupported();`
  and calls `admitGitFiles(inspect, architecture)`. Delete `XCODE_VERSION_PLIST`, `plistString` if it
  has no other caller, `linkChainOf` (the policy walk replaces it) and `observeGitDistribution`.
  `service.ts:1673` writes `distributionId: GIT_DISTRIBUTION_POLICY_ID`; `testing.ts:134` hashes
  `GIT_DISTRIBUTION_POLICY.processTable`.

- [ ] **Step 4: Continue with Part 1c** in the same worktree.

---

### Task 2, Part 2b: launchctl observer and `certification` removal (`apps/cli`)

**What:** the real observer returns `dev`/`ino` and the two ancestors; every `certification` gate in
`apps/cli` goes, so `automation` and `uninstall` gate on admission alone (Q2-A). Same worktree as
Part 2a.

**Files:**
- Modify: `apps/cli/src/lifecycle/adapters.ts:75-76, 392-431`
- Modify: `apps/cli/src/commands/automation/service.ts:331-335, 988-995` (`requireCertified` deleted
  with its callers), `:1127-1129` (`distribution` comes from admission)
- Modify: `apps/cli/src/lifecycle/uninstall.ts:1340-1349`
- Modify: `apps/cli/src/lifecycle/testing.ts` (doubles), and every other caller of
  `loadLaunchdProcessTable` found by `grep -rn loadLaunchdProcessTable apps` (pass `observe`)
- Test: `apps/cli/src/commands/automation/service.test.ts`, `apps/cli/src/lifecycle/uninstall.test.ts:153, 247`

**Interfaces:**
- Consumes (Part 2a, same worktree): `ObservedLaunchdDistributionV1`, `admitLaunchdHost`,
  `LaunchdDistributionUnsupportedError`, `loadLaunchdProcessTable(…, { observe })`.
- Produces: `inspectExecutable("/bin/launchctl")` returning the Task 2 shape.

- [ ] **Step 1: Write the tests.** In `uninstall.test.ts`, replace the case at `:247` ("refuses a loaded
  label on an uncertified row…") with:

```ts
it("unloads a loaded label on an admitted host without certification", async () => {
  const { run, launchctl } = await presentManifestWithLoadedLabel({ host: admittedHost() });
  await run();
  expect(launchctl.calls.map((call) => call.argv[0])).toContain("bootout");
});

it("names the manual bootout for every label on a host below the floor", async () => {
  const { run } = await presentManifestWithLoadedLabel({ host: { ...admittedHost(), operatingSystem: { productName: "macOS", productVersion: "26.5", buildVersion: "25F1" } } });
  await expect(run()).rejects.toMatchObject({ reason: "unsupported_launchd_distribution" });
  await expect(run()).rejects.toThrow(/launchctl bootout gui\/\d+\//u);
});
```

  (`presentManifestWithLoadedLabel` and `admittedHost` wrap the setup the existing case at `:153-247`
  already builds; extract them in `lifecycle/testing.ts`.) In `automation/service.test.ts` add:
  "`automation status` reports `supported` on an admitted host" and "`automation enable` plans and
  applies without a `certification` field". Add an `adapters` case: `inspectExecutable` on a
  temporary regular file returns decimal `dev`/`ino` strings and `/`, `/bin` ancestors with numeric
  owner and mode (the ancestors of the real root are read-only facts on every Mac).

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70).

- [ ] **Step 3: Implement.** `adapters.ts:410-431`: add `dev: observed.dev.toString(10)`,
  `ino: observed.ino.toString(10)` to `common`, and
  `ancestors: await Promise.all((["/", "/bin"] as const).map(async (path) => { const s = await lstat(path, { bigint: true }); return { path, kind: s.isDirectory() ? "directory" : "other", ownerUid: Number(s.uid), mode: Number(s.mode & 0o7777n) }; }))`.
  Delete `requireCertified` and its calls; `status` sets `distribution` from a guarded
  `admitLaunchdHost(await observeHost())` (`unsupported_launchd_distribution` on refusal, `supported`
  otherwise). `uninstall.ts:1342-1344` drops the certification clause; the existing
  `LaunchdDistributionUnsupportedError` catch still names the manual `bootout` list, now reached by
  admission refusals only.

- [ ] **Step 4: Continue with Part 2c** in the same worktree.

---

### Task 1, Part 1c: Git host tests, lint and the Task 1 commit

**What:** the two Git `*.pinned-host.test.ts` files run on any admitted host and refuse, never skip,
elsewhere; then Task 1's single lint and commit.

**Files:**
- Modify: `tests/integration/git/local-push.pinned-host.test.ts:8-18`,
  `tests/integration/git/local-receive.pinned-host.test.ts:15-95, 213`

**Interfaces:**
- Consumes (Parts 1a, 1b): `GIT_DISTRIBUTION_POLICY`, `admitGitFiles`, `admitGitCapability`,
  `inspectGitPath`.
- Produces (Task 1 as a whole): the Part 1a and 1b exports, integrated on `development` in one commit.

- [ ] **Step 1: Rewrite the tests.** Take `GIT` from
  `admitGitFiles(inspectGitPath, process.arch).executables.find((e) => e.id === "git_main")!.invokedPath`
  in a `beforeAll`; an admission refusal fails the file (never `skip`). Delete
  `observeInstalledGitDistribution` (`local-receive:61-95`); the probe comparison at `:213` becomes
  `admitGitCapability(files, execFileSync(GIT, ["--version", "--build-options"], { encoding: "utf8", env: {} }))`.

- [ ] **Step 2: Run the tests.** Deferred to plan close (D70); they run in Tasks 3 and 4.

- [ ] **Step 3: Lint.** `npm run lint` — expect exit 0. `grep -rn "SUPPORTED_GIT_DISTRIBUTION\b\|admitGitDistribution\|ObservedGitDistributionV1" packages apps tests`
  — expect no match.

- [ ] **Step 4: Commit** Task 1 (exact paths):

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
git commit -m "feat(git): admit Git from the active developer directory by ownership, floor and capability (NEW-113)"
```

---

### Task 2, Part 2c: launchd host test, lint and the Task 2 commit

**What:** the FD-3 host test runs on any admitted host; then Task 2's single lint and commit.

**Files:**
- Modify: `tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts:21-100, 199`

**Interfaces:**
- Consumes (Parts 2a, 2b): `admitLaunchdHost`, `expandLaunchdProcessTable(staging, identity)`.
- Produces (Task 2 as a whole): the Part 2a exports and the Part 2b observer, integrated on
  `development` in one commit.

- [ ] **Step 1: Rewrite the test.** Keep the `DEVELOPER_OS_LAUNCHD_CERTIFICATION_HOST` guard at `:78`,
  renamed `DEVELOPER_OS_LAUNCHD_GATE_HOST` (it prevents a live `bootstrap` on a developer's own
  account); admit with `admitLaunchdHost`; delete the certification object at `:100`; keep the
  transcript hash print at `:199` as gate evidence for Task 4.

- [ ] **Step 2: Run the test.** Deferred to plan close (D70); it runs in Tasks 3 and 4.

- [ ] **Step 3: Lint.** `npm run lint` — expect exit 0. `grep -rn "certification\|SUPPORTED_LAUNCHD_DISTRIBUTION\|admitLaunchdDistribution" packages apps tests`
  — expect no match outside comments naming the removal.

- [ ] **Step 4: Commit** Task 2 (exact paths; add any further `loadLaunchdProcessTable` caller Part 2b's
  grep found):

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
git commit -m "feat(launchd): admit launchctl by fixed path, ownership and macOS floor; remove certification (NEW-113)"
```

---

### Task 3: Plan close

**What:** the spec text becomes approved text, the canonical docs carry the surviving constraints, and
the full validation runs.

**Files:** the spec; `docs/superpowers/BACKLOG.md:22, 57, 272-277`; the roadmap Phase 9 block
(`:403-417`) and D65; `docs/architecture/foundation.md` §10, `docs/architecture/foundation-constraints.md`,
`docs/architecture/threat-model.md` §5.15; this plan.

- [ ] **Step 1: Spec.** Rewrite each "Proposed 2026-09-28 (DRAFT, awaiting founder approval; D65,
  NEW-113)" heading as "Amended <approval date> (D<n>)" with the decision number the founder's approval
  receives, adjusted to the answers given to Q1–Q4; strike the superseded D59 literals only where the
  block says they are replaced; add the change-record row (`| <date> | founder, NEW-113 (D<n>) |
  fixed-path admission for Git, launchctl and ssh replaces the exact-build pin; certification
  removed; residuals 6, 10 rewritten, 13 added | §4.2, §5.3, §7, §8.3 |`) and extend the marker
  sentence at spec `:44-47`. No approval row is added while the text is a draft.
- [ ] **Step 2: Canonical docs.** Move the admission rules and residual 13 into `foundation.md` §10,
  `foundation-constraints.md` and `threat-model.md` §5.15 (the plan 1b carry-over sites named at
  roadmap `:414-415`); replace every "pinned row"/"certified row" sentence there.
- [ ] **Step 3: Full validation (founder, by hand).** `npm run check` and `npm run test:pinned-host`
  on the development Mac; every red test is fixed in its task's files with a regression test first.
  Show failures only.
- [ ] **Step 4: Fresh-context review** by an agent that wrote none of Tasks 1–2, given the spec blocks,
  this plan and `git diff development...HEAD`; accepted findings get a failing test first.
- [ ] **Step 5: Bookkeeping.** `BACKLOG.md` NEW-113 row: code landed, Task 4 open; roadmap Phase 9:
  the NEW-113 line points at Task 4. Stage with `git add -f` on exact paths; commit
  `docs: close the NEW-113 code tasks and approve the fixed-path admission amendment`.

---

### Task 4: Phase 9 gate on a disposable macOS account (founder step)

**What:** prove roadmap Phase 9's gate (`:417`) — `git enable|sync|disable` and
`automation enable|disable|status`, with scheduled runs observed — on an admitted host, and record the
FD-3 contract as gate evidence (Q2-A). Local/file transport only (Q4-A).

**Where:** a new, disposable standard macOS user account on a Mac at macOS ≥ 26.6.2 with Xcode or
Command Line Tools at Git ≥ 2.54.0 / Apple Git-157; never the founder's own account (SESSION.md
"Stop and ask": live launchd). Evidence goes to `docs/releases/compatibility-matrix.md` and the
roadmap Phase 9 block.

**How (founder, in the disposable account):**

- [ ] **Step 1: Record the host.** `sw_vers`, `xcode-select -p`, `ls -l /var/db/xcode_select_link`,
  `"$(xcode-select -p)/usr/bin/git" --version --build-options`, `ls -ln /bin/launchctl /usr/bin/ssh`.
  Expected: every rule of spec §4.2/§5.3 holds; this also confirms the Q1 resolution mechanism on a
  real Mac. If `/var/db/xcode_select_link` does not exist or is not root-owned, stop: Q1 needs
  revisiting before anything else runs.
- [ ] **Step 2: Host tests.** `DEVELOPER_OS_LAUNCHD_GATE_HOST=1 npm run test:pinned-host` from a clone
  at the Task 3 commit. Expected: all green; keep the printed FD-3 transcript SHA-256.
- [ ] **Step 3: Git gate.** Install the product build into the account; create a synthetic Brain and a
  local bare remote under the account's home; `developer-os git enable --apply`, then
  `developer-os git sync` twice (one change, one no-change), then `git disable --apply`. Expected: one
  commit reaches the bare remote through the admitted Git (this closes the Phase 9 verification gap
  "a real push through Apple Git-157 has not run through the I1 fix", `BACKLOG.md:276`);
  `no_changes` on the second sync; disable leaves `.git` and the remote intact.
- [ ] **Step 4: automation gate.** `developer-os automation enable --apply` with an hourly schedule;
  wait for one scheduled run of each eligible job; `automation status`; `automation disable --apply`;
  `launchctl print gui/$(id -u)` shows no product label. Expected: status `supported`, one status
  record per job, no residual label.
- [ ] **Step 5: Update check.** If a macOS or Xcode point update is available for the account's Mac,
  apply it and repeat Steps 2–4's enable/status/disable once. Expected: admitted without a code change
  — the D65 goal. If no update is available, record "not exercised".
- [ ] **Step 6: Record** the rows (host facts, transcript hash, outcomes) in
  `docs/releases/compatibility-matrix.md`, tick roadmap Phase 9's gate, remove NEW-113 from
  `BACKLOG.md`, and delete this plan once its surviving constraints are in the canonical docs (Task 3
  Step 2). Delete the disposable account.
