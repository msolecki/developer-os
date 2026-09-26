# Developer OS Opt-in Surfaces 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship opt-in Git synchronization of the Brain (`git enable|disable|status|sync`), scheduled automation of Spec 1 §5.1's four jobs (`automation enable|disable|status` plus the hidden scheduled runner), and the `uninstall/present_manifest` (`P`) variant. All of it runs on top of the lifecycle kernel that plan 1a shipped, with no hidden process, network, filesystem or credential authority.

**Architecture:** Plan 1a left every Git and launchd slot in the kernel typed but refused (`unsupported_until_plan_1b`). This plan fills those slots from the leaves inward:
- **Core** gains the Git domain (metadata admission, scope and planner, the journaled effect executor) and the effect-journal hookup in the ledger.
- **Security** gains one supervised-process primitive and, on top of it, the closed Git process graph, sanitized shadows, gateways and the bounded pack reader.
- **platform-macos** gains the launchd registry, plist bytes, pinned `launchctl` observation, unlinked-snapshot bootstrap and the journaled launchd effect executor.
- **The CLI** is the composition root. One task swaps the `never` leaves in `apps/cli/src/lifecycle/codecs.ts` for real codecs and wires the adapters. The Git, automation, runner and uninstall tasks then build on that.

**Tech Stack:** TypeScript 5.x strict ESM, Node.js built-ins, Zod 4, smol-toml, Vitest 4. The shipped lifecycle kernel (`packages/core/src/lifecycle/`), Foundation transactions, and the injected filesystem/process/clock/lock adapters.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` as amended 2026-09-17 and 2026-09-22 (its change record). It is normative for every literal this plan names by section instead of copying: process tables, argv, environment maps, byte bounds, the operation/step grammar, the point-of-no-return table and the §7 gate matrix. Where this plan and the spec disagree, the spec wins. The numbered founder questions it raised were answered and applied (D59, Status below).

**Sources:**
- Tasks 8–20, 22 and 24 of the 2026-08-28 opt-in-surfaces plan, deleted 2026-09-24 once this plan carried every open task (git history holds it). Each task below names its source task. Old Tasks 1–7, 21 and 23 landed through plan 1a (`43c6876..082e098`).
- Roadmap `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`, Phase 9 and decisions D16, D25, D39, D42, D44, D47 and D56.
- `docs/superpowers/BACKLOG.md` rows NEW-84 and NEW-100.
- `docs/architecture/foundation.md` §10, `foundation-constraints.md` ("Plan 1a: lifecycle kernel bounds") and `threat-model.md` §5.13.
- The code as it stands at `3fa320a`.

---

## Status 2026-09-26

Tasks 1–18 and 20 are committed (their bodies and the wave table are in git history:
`git show d2f18b4:docs/superpowers/plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`). Task 21's
phase close ran except where noted below: every deferred suite green on `bc17550` apart from
`npm run test:pinned-host`, the whole-plan review with its I2/I3 fixes, and PR #15. Open:

- **Task 19** (founder stop): certify the re-pinned rows on a disposable 25G83 host, then run the
  pinned-host suites and prove the Phase 9 gate there.
- **Architecture carry-over** (repository chore, the remainder of Task 21 Step 3): move plan 1b's
  surviving decisions into `docs/architecture/`.

Step 3b's CI projection check is superseded by `BACKLOG.md` NEW-100: on PR #15 the hosted runner
cancelled `bootstrap-executor` and `lifecycle-v2` at their timeouts, and both jobs are sharded
before the next PR. NEW-100 itself (plan 1a Task 24) stays post-A16 (D42); this plan never absorbs it.

Founder questions Q1–Q5 were answered A (D59) and applied to the spec as "Amended 2026-09-23 (D59)".
The two Task 19 depends on: **Q2-A**, the launchd row's `certification` field refuses every mutation
while `null`; **Q4-A**, the local/file-transport Git trace is agent-run on temporary repositories,
while HTTPS and SSH refuse `unsupported_git_distribution` until the founder supplies a disposable
remote.

## Constraints the open work depends on

- **Live host.** Task 19 runs only on a disposable macOS 26.6.2 (25G83) user account or VM. No agent
  runs it, and nothing installs, loads, unloads or inspects a job on the founder's working machine.
  Enabling Git or automation on the founder machine is a separate founder decision.
- **Measure read-only.** The NEW-84 command list never runs `launchctl bootstrap`, `bootout`, `load`,
  `unload`, `enable`, `disable` or `kickstart`, and never writes under `~/Library/LaunchAgents`.
- **Staging.** Exact paths only; check `git diff --cached --name-only` before every commit.
  `docs/superpowers/` needs `git add -f` on its own line.
- **Citations.** `tests/repository/citations.test.ts` bounds-checks every `path:line` in tracked
  documents. Cite symbols and files, not line numbers.

---

## NEW-84: measured row and re-pinning rule

**Measured 2026-09-23 on the development machine, read-only.** Nothing was loaded, bootstrapped or booted out, and no launchd job or file was modified. The exact commands:

```bash
sw_vers
uname -m
shasum -a 256 /bin/launchctl
stat -f '%Su:%Sg %Lp %z %l' /bin/launchctl
launchctl version
stat -f '%Su %Lp' /private/var/empty; ls -A /private/var/empty | wc -l
which -a git; git --version; /usr/bin/git --version
xcode-select -p; xcodebuild -version
X=/Applications/Xcode.app/Contents/Developer
$X/usr/bin/git version --build-options
shasum -a 256 $X/usr/bin/git; stat -f '%Su %Lp %z' $X/usr/bin/git
stat -f '%N %Su %Lp %z %Y' $X/usr/libexec/git-core/{git,git-pack-objects,git-receive-pack,git-index-pack,git-unpack-objects,git-remote-https,git-remote-http}
shasum -a 256 $X/usr/libexec/git-core/git-remote-http
shasum -a 256 /usr/bin/ssh; stat -f '%z %Su %Lp' /usr/bin/ssh; ssh -V
```

**launchctl row (spec §5.3):**

| Field | Spec 1 pinned (2026-08-26) | Measured 2026-09-23 |
|---|---|---|
| `operatingSystem` | macOS 26.5.2, build `25F84` | macOS 26.6.2, build `25G83`, arm64 |
| `/bin/launchctl` owner/mode/links | uid 0, `0755` (493) | `root:wheel`, `0755`, 1 link |
| `/bin/launchctl` size | 364448 | 363488 |
| `/bin/launchctl` SHA-256 | `b1f2b90f349938cc4c3c9234f11cefd05545f7b4bfe9b1751ac01f1cb27d3714` | `b4dbf509754d8e1117f7851baa93ede75bc75218c48d6ddf19fbb1505d261be7` |
| `launchctl version` | not recorded | `Darwin Bootstrapper Version 7.0.0: Fri Jul 31 21:16:41 PDT 2026; root:libxpc_executables-3102.160.5~130/launchd/RELEASE_ARM64E` |
| `/private/var/empty` | root, `0755`, empty | root, `0755`, 0 entries |
| Table IDs | `launchctl-macos-26.5.2-25F84-{preview,fd3}-v1` | proposed `launchctl-macos-26.6.2-25G83-{preview,fd3}-v1` |

**Git row (spec §4.2):**

| Field | Spec 1 pinned | Measured 2026-09-23 |
|---|---|---|
| Selected Xcode | 26.6 (17F113) | 27.0 (27A266a), `xcode-select -p` = `/Applications/Xcode.app/Contents/Developer` |
| Version line | `git version 2.50.1 (Apple Git-155)` | `git version 2.54.0 (Apple Git-157)` |
| Build-option lines | 11 lines | **13 lines**: `cpu: arm64`, `no commit associated with this build`, `sizeof-long: 8`, `sizeof-size_t: 8`, `shell-path: /bin/sh`, `rust: disabled`, `feature: fsmonitor--daemon`, `libcurl: 8.7.1`, `zlib: 1.2.12`, `SHA-1: SHA1_DC`, `SHA-256: SHA256_BLK`, `default-ref-format: files`, `default-hash: sha1` |
| Main target `…/usr/bin/git` | 3,704,880 bytes, `10f9c1df…ffd2a9` | root `0755`, 3,837,392 bytes, `9a1c8fc68dc75e1b3c0cd8e5ad9d13ac9bc92cb53c9578b3cff4beaf2e9b1e70` |
| Exec-path links | five size-13 `../../bin/git`, `git-remote-https` size-15 `git-remote-http` | unchanged shape: root `0755`, same sizes and targets |
| `git-remote-http` target | 2,305,920 bytes, `76169453…d56611` | root `0755`, 2,346,832 bytes, `1a68d873ea23502f44e63d8013ad2d1374a8f0161fe4a07ba8f708f686794124` |
| `/usr/bin/ssh` | 1,555,472 bytes, `470f812f…a9b2b9`, `OpenSSH_10.2p1, LibreSSL 3.3.6` | root `0755`, 1,584,576 bytes, `17542914a3fb55e7efeb35a90d594a21c84bf6a4cfe1fc8ddff5606dc2658fc3`, `OpenSSH_10.3p1, LibreSSL 3.3.6` |
| Distribution ID | `apple-git-155-arm64-xcode-26.6-17F113` | proposed `apple-git-157-arm64-xcode-27.0-27A266a` |
| Other Git on `PATH` | not recorded | `/opt/homebrew/bin/git` (2.55.0) comes first on `PATH`; `/usr/bin/git` is the Xcode shim. Neither is a supported executable: the row pins the absolute Xcode target only |

Both rows in the spec are dead on this machine. Two concrete consequences:
- As the spec is written, every Git operation refuses `unsupported_git_distribution` here.
- Every launchd operation refuses `unsupported_launchd_distribution` here.

**Re-pinning rule.** Tasks 6, 7 and 19 implement it; the architecture carry-over below records it in `docs/architecture/foundation.md`.

1. **One supported row per package, as data.** The Git row lives in exactly one constant, `SUPPORTED_GIT_DISTRIBUTION` in `packages/security/src/git/distribution.ts`. The launchd rows live in exactly one constants file, `packages/platform-macos/src/launchd/distribution.ts`. No other file restates a hash, size, build or version literal; tests import the constant and mutate one field at a time.
2. **Measure read-only.** Run exactly the command list above (in Task 19 it is captured as `scripts/measure-distribution-rows.sh`). It never runs `launchctl bootstrap`, `bootout`, `load`, `unload`, `enable`, `disable` or `kickstart`, and never writes under `~/Library/LaunchAgents`.
3. **Refuse on any drift.** A mismatch in any field (OS product version or build, executable path, owner, mode, size or hash, Xcode selection, build-option line, link target, SSH bytes) refuses `unsupported_launchd_distribution` or `unsupported_git_distribution` before any live authority. Version text is never trusted on its own (spec §4.2, §5.3).
4. **Re-pin in one change.** Measure the new row, amend the spec rows with a dated founder-approved amendment, replace the constant, and update every exact-set test that imports it. Record the Git process trace and run the FD 3 bootstrap certification on a disposable host at that exact build (Task 19). Review. It all lands in one commit ("in the same change", spec §4.2). By default a row is **replaced**, not added: a row is kept only while a certified host for it still exists.
5. **Stop when unsupported.** Until certification evidence exists for the pinned launchd row, every launchd mutation refuses `unsupported_launchd_distribution` (spec §5.3, "missing certification"). Read-only observation, preview and `automation status` still report state.

---

### Task 19: Certify the re-pinned rows on a disposable host (founder) · M

Source: NEW-84 and spec §5.3's certification requirement. **This is a live-host founder stop (SESSION "Stop and ask"). No agent runs it.** Hosted `macos-15` can never run it: it is not build 25G83.

**Files:**
- Create: `scripts/measure-distribution-rows.sh` (the NEW-84 read-only command list verbatim; it prints only and writes nothing)
- Modify: `packages/platform-macos/src/launchd/distribution.ts` (fill `certification` per Q2 A)
- Modify: `packages/security/src/git/distribution.ts` (the traced process-table literals, if the trace differs from the spec's graph)
- Create: `docs/migration/distribution-certification.md` (the dated transcript summary: row IDs, fixture transcript SHA-256, host build; no user names or paths)

**Interfaces:**
- Consumes: Task 10's `fd3-bootstrap.pinned-host.test.ts`; Task 13's local-receive pinned-host test; Tasks 6 and 7 constants.
- Produces: certified `SUPPORTED_LAUNCHD_PROCESS_TABLE`, and a traced Git row for the transports Q4 admits.

- [ ] **Step 1:** On a disposable macOS 26.6.2 (25G83) user account or VM, run `scripts/measure-distribution-rows.sh` and diff its output against the NEW-84 tables. Any difference restarts the re-pinning rule.
- [ ] **Step 2:** Run `npx vitest run --root tests integration/launchd/fd3-bootstrap.pinned-host.test.ts` with a unique fixture label. Record the transcript SHA-256.
- [ ] **Step 3:** Record the local-transport Git process trace with `npx vitest run --root tests integration/git/local-receive.pinned-host.test.ts`. Add the HTTPS and SSH traces only if Q4 is answered B or a disposable remote exists.
- [ ] **Step 4:** Fill the certification field, then `npm run lint`.
- [ ] **Step 4b:** On the certified host, run `npm run test:pinned-host` (the Task 21 Step 1 run that
  CI cannot make). Show failures only. Include the §6 "Phase 9" items that wait on this host: the
  real push through Apple Git-157 after the I1 fix, the hostile config/redirect cases, and the exact
  trampoline environment.
- [ ] **Step 4c:** Prove the Phase 9 gate on a disposable install on that host: `git enable|sync|disable`
  and `automation enable|disable|status` complete, and at least one scheduled run of each job is
  observed.
- [ ] **Step 5:** Commit on the founder's instruction:

```bash
git add scripts/measure-distribution-rows.sh packages/platform-macos/src/launchd/distribution.ts packages/security/src/git/distribution.ts docs/migration/distribution-certification.md
git commit -m "feat(macos): certify the 25G83 launchctl row"
```

### Architecture carry-over (remainder of Task 21 Step 3) · M, repository chore

`docs/architecture/foundation.md` §10 still has "What is refused until plan 1b" and
`threat-model.md` §5.13 still calls `git enable` plan 1b, although Tasks 1–18 and 20 shipped.

**Files:**
- Modify: `docs/architecture/foundation.md` (§10's refused list becomes the shipped Git/launchd
  contract; record the NEW-84 re-pinning rule above)
- Modify: `docs/architecture/foundation-constraints.md` (plan 1b bounds, by symbol)
- Modify: `docs/architecture/threat-model.md` (a §5.13 successor for Git transport, launchd authority
  and the runner lease)

- [ ] **Step 1:** Read the per-task decisions from `git show d2f18b4:docs/superpowers/plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`
  and this plan's NEW-84 section, and carry the surviving ones into the three documents, citing
  symbols. Re-anchor every existing `path:line` citation that points into a file plan 1b edited (for
  example `threat-model.md` §5.13's `mutation-gate.ts`, `codecs.ts` and `uninstall.ts` lines): the
  citations test checks only that a line is in range.
- [ ] **Step 2:** `npm run lint` and `npx vitest run --root tests repository/citations.test.ts`, then
  commit the three documents. After Task 19 and this step, close NEW-84 and NEW-97 in `BACKLOG.md`,
  tick the roadmap Phase 9 and delete this plan.
