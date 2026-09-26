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

The architecture carry-over (Task 21 Step 3's remainder) ran on 2026-09-26: the shipped Git, launchd
and runner contract and the NEW-84 re-pinning rule are in `docs/architecture/foundation.md` §10, the
bounds in `foundation-constraints.md` ("Plan 1b: Git and launchd bounds"), and the boundaries in
`threat-model.md` §5.15.

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

## NEW-84: the measured rows and the command list

The 2026-09-23 read-only measurements are the spec's rows (Spec 1 §4.2 and §5.3, "Amended 2026-09-23
(D59)") and the constants `SUPPORTED_GIT_DISTRIBUTION` and `SUPPORTED_LAUNCHD_DISTRIBUTION`; the
re-pinning rule is `docs/architecture/foundation.md` §10. Task 19 captures this command list
verbatim:

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

---

### Task 19: Certify the re-pinned rows on a disposable host (founder) · M

Source: NEW-84 and spec §5.3's certification requirement. **This is a live-host founder stop (SESSION "Stop and ask"). No agent runs it.** Hosted `macos-15` can never run it: it is not build 25G83.

**Files:**
- Create: `scripts/measure-distribution-rows.sh` (the NEW-84 command list above, verbatim; it prints only and writes nothing)
- Modify: `packages/platform-macos/src/launchd/distribution.ts` (fill `certification` per Q2 A)
- Modify: `packages/security/src/git/distribution.ts` (the traced process-table literals, if the trace differs from the spec's graph)
- Create: `docs/migration/distribution-certification.md` (the dated transcript summary: row IDs, fixture transcript SHA-256, host build; no user names or paths)

**Interfaces:**
- Consumes: Task 10's `fd3-bootstrap.pinned-host.test.ts`; Task 13's local-receive pinned-host test; Tasks 6 and 7 constants.
- Produces: certified `SUPPORTED_LAUNCHD_PROCESS_TABLE`, and a traced Git row for the transports Q4 admits.

- [ ] **Step 1:** On a disposable macOS 26.6.2 (25G83) user account or VM, run `scripts/measure-distribution-rows.sh` and diff its output against the spec rows (Spec 1 §4.2, §5.3). Any difference restarts the re-pinning rule (`foundation.md` §10).
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

### After Task 19

- [ ] Close NEW-84 and NEW-97 in `BACKLOG.md`, tick the roadmap Phase 9 and delete this plan.
