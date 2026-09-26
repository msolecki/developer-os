# Developer OS — Tooling Verbs Design

**Approved 2026-09-22 by the founder (D47).** Every open question is answered with its recommended
option, except A12 Q1: there is no production for now — the product runs from a local, unsigned build
on the founder's machine only; no release, signing or public install path is built until the founder
reopens it. Wherever this spec names the launcher or a packaged release as the install source, read
"the local build" (A12 Q1 option A, `trust: "unsigned-local"`, local only).

**Status: draft, 2026-09-22, awaiting founder answers to §0 and approval.** This is `ORDER.md` entry
A14 (DOS-P12), roadmap Phase 7
(`docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`). Its scope is
`docs/migration/instruction-inventory.md` §5 (14 scripts plus 2 libraries) and the three project
template rows of §6. Its implementation plan, `plans/2026-09-22-developer-os-tooling-verbs.md`, was
deleted when Phase 7 closed (`git show d4592a7^:docs/superpowers/plans/2026-09-22-developer-os-tooling-verbs.md`);
what shipped is recorded in the roadmap's Phase 7.

**Gate (roadmap Phase 7):** every inventoried script is a product verb or a recorded refusal. §2 is
the disposition table that gate is checked against.

**Depends on.** A12 (instruction artifacts, roadmap Phase 5), A12b (Brain workflows, Phase 5b) and A13
(hooks, Phase 6) are drafted in parallel. This spec assumes only what the roadmap says about them:

- A12 owns the redacted public default content and the `<product-home>/instructions/<vendor>/`
  user-override convention;
- A12b owns the Brain gardening workflows;
- A13 owns hooks and `doctor`'s report of external hooks.

Where this spec consumes A12 content (§6), it binds the mechanism and leaves the prose to A12.
Plan 1a (closed 2026-09-22) supplies the mutation gate that every V2 Foundation mutator passes
through.

**Name collision.** "A14" in Spec 1's change record (`specs/2026-08-21-…` "A14 (D24)") is an amendment
number there. It is not this entry.

---

## 0. Open questions for founder approval

The body of this spec specifies the **recommended** answer to each question. A non-recommended answer
needs a dated amendment to this spec before plan writing. The rest of the spec does not depend on
these answers, so it can be reviewed now.

### Q1. `repo audit` and `repo bootstrap` (legacy `repo-audit`, `repo-audit-weekly`, `repo-bootstrap`, `lib/repo-baseline`)

Both verbs would run `gh` against the GitHub API. That breaks three invariants the product currently
proves with tests:

- **No network capability anywhere.** `tests/e2e/foundation.test.ts` ("ships no network
  capability") proves it; `threat-model.md` §7 and `foundation.md` §7 state it.
- **Exactly one classified outbound spawn, the vendor agent CLI.** `tests/security/network.test.ts`
  enforces it.
- **Only the network uses listed in design §14.2.** None of them is a GitHub settings API.

`gh`'s credential file `.config/gh/hosts.yml` is also one of the three exact protected files. On top
of that, `bootstrap` is a remote mutation: no local backup can make it part of
`plan → backup → … → finalize`, and no product rollback can undo it.

- **A — refuse both (recommended).** Repository governance is not knowledge-OS scope. The user keeps
  `gh` itself. Inventory §5 records the refusal, and the product surface, `threat-model.md` §7 and the
  network suite stay unchanged.
- **B — ship `repo audit` only.** It would be read-only `gh api` GETs against a baseline stored as user
  data at `<product-home>/repo-baseline.toml`. Price:
  - `gh` becomes the second classified outbound spawn in `tests/security/network.test.ts`;
  - amendments to design §14.2, `threat-model.md` §7 and `foundation.md` §7;
  - a trusted-executable check on `gh` (`assertTrustedExecutable`);
  - a content-free failure path for `gh` stderr.
  `bootstrap` is refused.
- **C — ship both, as the roadmap lists them.** Everything in B, plus a remote-mutation contract:
  - print the current remote settings as the plan;
  - apply only with `--apply`;
  - re-read the settings as verification;
  - accept, and document, that a failed apply cannot roll back.

### Q2. `repo secrets-scan` (legacy `git-history-secrets`)

A historical scan runs `git` over repositories the user did not necessarily write. A repository's
own configuration can make read commands execute programs: `diff.external`, textconv drivers,
`core.fsmonitor`, pagers. Spec 1 §4.2 closes this for Git with a pinned distribution, shadow
configuration and an exec gateway. That work is plan 1b, which runs after the cutover (D16).

- **A — refuse (recommended).** Dedicated history scanners exist, and a heuristic redactor built for
  capture text is a weaker scanner than they are. Inventory §5 records the refusal.
- **B — defer to after Phase 9.** Specify it later on top of Spec 1b's Git process safety. It has no
  owner before the cutover.
- **C — ship now.** It would be read-only `git` with a sanitized environment
  (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `-c core.fsmonitor=false`,
  `--no-ext-diff --no-textconv`) and would report path and line only. Price: a second, weaker Git
  safety model that exists beside Spec 1's, plus `git` becoming a classified spawn in the network
  suite.

### Q3. `project worktree` (legacy `worktree`: worktree plus ignored-env copy plus install)

Each legacy part conflicts with a standing rule:

- **The env-file copy.** It reads and writes exactly what the protected-path policy refuses: `.env`
  and `.env.*`, on both the declared and the canonical path (`foundation.md` §7).
- **The install.** It is a package-manager run, which means registry network access and arbitrary
  install scripts.
- **What remains.** Without those two parts, the verb is `git worktree add`.

`BACKLOG.md` NEW-98 names this verb as the fix for a linked worktree resolving another checkout's
`dist`. That defect belongs to this repository's own test harness (`tests/vitest.config.ts`), not to
users of the product.

- **A — refuse, and re-own NEW-98 to repository tooling (recommended).** The fix for NEW-98 becomes a
  repository script that relinks `tests/node_modules/@developer-os/*` into the worktree, run by one
  command and pinned by a test. That follows the row's own rule: prose does not survive the next
  `install`.
- **B — ship a thin verb.** It would run `git worktree add` outside the repository and nothing else.
  Price: a product `git` spawn for no capability the user lacks today.
- **C — legacy parity.** Refused by the protected-path policy. This option needs a founder decision
  that amends that policy.

### Q4. The project settings template (inventory §6: "project instruction file, project context signpost, project settings")

- **A — `project init` writes the instruction files and the signpost, and never a vendor settings
  file (recommended).** This matches:
  - `claude-adapter.md` §2.3: the product writes no key into `~/.claude/settings.json`;
  - D7: the product never writes the Codex config file;
  - inventory §6's refusal of global vendor settings (reporting only).

  A permission allow-list the product wrote into a repository is also inherited by every clone.
- **B — also write a project `.claude/settings.json`, create-only.** Price: the first product-written
  vendor settings file, plus an amendment to `claude-adapter.md` §2.
- **C — write it and merge into an existing file.** Price: B's, plus the first three-way merge of a
  foreign JSON file. `buildConflictEvidence` would have its first consumer, and it would be in a
  user's repository.

### Q5. Archiving imported inbox sources (roadmap: "source archived")

Archiving means moving each source into `_raw/processed/` in the same Foundation transaction that
writes its capture: a `create` of the raw bytes plus a precondition-bearing `remove` of the source.
The shipped executor keeps every staged payload in `staging/transactions/<id>/` after `finalized`.
Two sources say so:

- `foundation.md` §8 item 4: "nothing removes" it;
- `tests/e2e/foundation.test.ts`, "leaves its own residue behind after uninstall: staged bytes yes,
  backup bytes no", which asserts it.

Plan 1a's compaction is a preflight of the *next* mutation (`apps/cli/src/lifecycle/mutation-gate.ts`
header), so it does not remove the last run's staged bytes either. An archive `create` would therefore
leave a raw, unredacted copy of every inbox file in the product home. That breaks
redact-before-persistence, and it also breaks the property that test states: "staging holds
post-redaction content".

- **A — do not archive (recommended).**
  - `import` writes only captures, and sources stay where they are.
  - Capture-ID deduplication makes every rerun idempotent, and `--limit` counts only files that
    produce a new capture (§5.2), so batches still advance through an inbox that is never emptied.
  - The content still drains into quarantine, which is what the roadmap's risk register relies on.
  - The user deletes processed inbox files by hand.
  - Zero raw copies, and the smallest implementation.
- **B — archive, and accept raw inbox bytes in product-home staging** until terminal collection or
  uninstall removes them. This needs a dated exception to design §13.2 and a correction to the test's
  stated property.
- **C — archive, after a Foundation change.** The executor prunes staged payloads at both terminal
  transitions, as `pruneBackups` already does for backups. This closes part of `foundation.md` §8
  item 4 for every command and flips that test's staged-bytes assertion. §5.4.1 specifies the archive
  for this option. Price: an executor change and a Phase 7 prerequisite task.

---

## 1. Scope and invariants

This spec adds four product surfaces:

1. `developer-os import [<path>] | --claude-memory` turns inbox files and Claude Code auto-memory into
   quarantine captures.
2. `developer-os project init [<dir>]` writes the project instruction templates, create-only.
3. `developer-os project check [<dir>]` runs a read-only instruction-file hygiene report.
4. The `doctor` check `vendor-config` is a structural, value-free comparison of the Claude user
   settings deny list with a product reference.

Standing boundaries this spec keeps. Each one is a test obligation in §10.

- **No new network capability and no new classified spawn.** None of the four surfaces spawns a
  process. Under the recommended answers to Q1–Q3, `tests/security/network.test.ts`'s classified set
  is unchanged.
- **`capture` → quarantine → `review` → `ingest` remains the only path into canonical notes (D4).**
  `import` writes only `quarantined` captures. It never accepts, ingests or reindexes.
- **No transcript is read.** `--claude-memory` opens `memory/*.md` only. `tests/repository/transcript-path.test.ts`
  stays green unmodified.
- **No vendor configuration file is written.** `vendor-config` reads the file and never writes it.
- **Every filesystem mutation is a Foundation transaction** through
  `planned → backed_up → staged → validated → applied → verified → finalized` (`foundation.md` §3).
  It is admitted by plan 1a's mutation gate (`apps/cli/src/lifecycle/mutation-gate.ts`), and its
  target set is validated by `validateChangePlan` with explicit owned and excluded roots. No verb here
  writes outside a transaction, except the guarded directory preparation that `capture` already
  performs for quarantine (§5.4).
- **Redaction comes first.** Redaction happens before truncation, hashing, logging, persistence or
  output (design §13.2). Under the recommended Q5 answer nothing here hashes, stages or persists
  unredacted content. Q5 C would add one sanctioned exception (§5.4.1).
- **Refusal, never truncation.** An over-bound input is refused and named. It is never silently
  shortened.

**Automation is out of scope (D16).** The job registry moved to roadmap Phase 9 (Spec 1b). Two notes
for that phase, neither resolved here:

- Spec 1 §1 says "no scheduler captures or ingests content automatically" and "no scheduled job can
  spend vendor credits". Spec 1 §5.1's closed registry has four jobs: `brain-reindex`, `brain-lint`,
  `doctor` and `git-sync`. The roadmap's Phase 7/9 bullet lists `import` and `ingest` as registry
  entries, which contradicts both sentences. Phase 9 must reconcile this with a founder decision.
- `import` is scheduler-safe by construction: it prompts for nothing, spawns nothing and is bounded
  (§5.2). Whether it may be scheduled is Phase 9's call. So is whether the scheduled `doctor` profile
  includes `vendor-config`, which reads a file outside the product home.

Until Phase 9, the verbs run by hand (D16 risk register).

**Resolved by D47 (2026-09-22):** Spec 1 §1 holds; `import` and `ingest` are not registry entries.

---

## 2. Inventory disposition — the Phase 7 gate

This table is written back into `docs/migration/instruction-inventory.md` §5 and §6 by plan Task 1.
"Refused (Qn)" assumes the recommended answer.

| Inventory row | Disposition after A14 | Owner |
|---|---|---|
| `brain-weekly` | Decomposed into verbs that exist after Phase 7:<br>• distill → `import --claude-memory` (§5)<br>• ingest → `ingest` (shipped)<br>• reindex, lint → `brain reindex`, `brain lint` (shipped)<br>• proposals → A12b workflows<br>• drift and health sentinel → `doctor` including `vendor-config` (§8)<br>• commit and push → `git sync` (Phase 9)<br>• tests → retired with the legacy repository<br>Run by hand until Phase 9. | A14 verbs; schedule Phase 9 |
| `distill-memory` | `import --claude-memory`. The capture ID is the content-hash cursor, so no new state is needed (§5.5). | A14 |
| `distill-transcripts` | declined (unchanged) | — |
| `check-config-drift` | `doctor` check `vendor-config` (§8) | A14 |
| `check-plugin-version` | Spec 2 release metadata (unchanged) | A11 |
| `check-templates` | `project check` (§7) | A14 |
| `worktree` | **refused (Q3)**. NEW-98 is re-owned to repository tooling. | — |
| `check_english` | refused: repository gate (unchanged) | — |
| `git-history-secrets` | **refused (Q2)** | — |
| `repo-audit` | **refused (Q1)** | — |
| `repo-audit-weekly` | **refused (Q1)** | — |
| `repo-bootstrap` | **refused (Q1)** | — |
| `bootstrap` | `init` shipped | — |
| `shared-sync` | `update` | A11 (Phase 8) |
| `lib/repo-baseline` | **refused (Q1)**. Nothing consumes it. | — |
| `lib/redact` | `packages/security/src/redaction.ts` shipped | — |
| §6: project instruction file, project context signpost | `project init` (§6) | A14, content A12 |
| §6: project settings | **refused (Q4)** | — |
| §6: global vendor settings | Reporting only, now concrete as `vendor-config` (§8) | A14 |

---

## 3. Command surface

| Command | Options | Positionals | Mutates | Network or spawn |
|---|---|---|---|---|
| `import [<path>]` | `--claude-memory`, `--limit <n>`, `--dry-run`, `--json` | 0..1 | vault quarantine only (Q5 C adds processed and inbox) | none |
| `project init [<dir>]` | `--dry-run`, `--json` | 0..1 after the subcommand | files in `<dir>`, create-only | none |
| `project check [<dir>]` | `--json` | 0..1 after the subcommand | nothing | none |
| `doctor` | unchanged | unchanged | nothing | none |

Dispatch changes in `apps/cli/src/main.ts`:

- **`import`.**
  - Add the `claude-memory` boolean to `OPTIONS`.
  - Add `import` to `COMMAND_OPTIONS` and `COMMAND_POSITIONALS`.
  - `--claude-memory` together with a `<path>` exits 2 at parse time.
- **`project`.**
  - Add a `project` group with `PROJECT_SUBCOMMANDS`, shaped like `BRAIN_SUBCOMMANDS`.
  - `init` accepts `dry-run` and `json`; `check` accepts `json`.
  - An unknown subcommand exits 2.
- **Usage text.** It gains three lines.
- **Bootstrap gate.** The ordinary-command bootstrap gate (`assertOrdinaryCommandAdmitted`) applies to
  all three, as it does to every command except `init`.

Output rules are the existing ones (`emit`/`publish`): human lines through `renderPath`, one `--json`
line, and every string leaf redacted.

---

## 4. Shared rules

### 4.1 Exit codes

This spec adds no exit class. The codes are `foundation.md` §6's. A batch verb exits with the most
severe code among its per-item refusals, in `doctor`'s order 6, 5, 4, 3, 2, 1. The per-item outcomes
travel on the result: `data` on success, and the `CliError` data slot `ingest` already uses on
failure (`knowledge-pipeline.md` §10.2 item 4). A run-level refusal (§5.6) ends the run before any
per-item work starts.

### 4.2 Reading an untrusted file

This covers inbox sources, memory files, project files, override templates and the vendor settings
file.

- Refuse protected paths with `ProtectedPathPolicy` on the declared and the canonical path, **before
  the file is opened**.
- Open with `O_NOFOLLOW | O_NONBLOCK`. Require a regular file.
- Read at most `bound + 1` bytes. Over the bound is a refusal, and the rest of the file is never read.
- Decode UTF-8 with a fatal decoder. Invalid UTF-8 or a NUL byte is a refusal, not a lossy decode.
- Never write file content or a parse error's text to a message. `JSON.parse` errors quote the input,
  so the message is replaced with a fixed string (the `TomlError` precedent, `threat-model.md` §5.7).

### 4.3 Redaction

All redaction goes through `createRedactor(key, { userPatterns })`, bound once at each command's
composition root. `tests/repository/redactor-entry.test.ts` keeps covering the new call sites without
change.

- `import` loads the key through `loadOrCreateRedactionKey` (it is a point of use).
- `import --dry-run` and `project check` use `readRedactionKey` (it never creates the key). An absent
  key means duplicate status is reported as `unknown` (§5.7), and `project check` uses an ephemeral
  key. Fingerprints are never printed, so the ephemeral key changes no output.

### 4.4 Bounds

All values below are **product-chosen constants**, pinned by tests at the boundary and one past it.

| Bound | Value | On excess |
|---|---|---|
| one import source | 64 KiB, `MAX_CAPTURE_INPUT_BYTES` reused | per-file refusal |
| entries walked per `import` run | 10,000 | run-level refusal before any write |
| directory depth under an import root | 16 | run-level refusal |
| files processed per `import` run | 1,000; `--limit` narrows it | remaining files reported as `remaining`, exit 0 |
| Claude memory project directories | 1,000 | run-level refusal |
| one project or override template file | 64 KiB | refusal |
| one file read by `project check` | 1 MiB | check `fail`, file not read further |
| vendor settings file | 1 MiB | `warn`, not parsed |
| `templates/project/` set | at most 8 flat files | build-time test failure |

---

## 5. `import`

### 5.1 Sources

| Invocation | Source root | Archive |
|---|---|---|
| `import` | `<contentRoot>/_raw/inbox` | no (Q5 A); yes only under Q5 C (§5.4.1) |
| `import <path>` inside the inbox subtree | that file or directory | as the row above |
| `import <path>` outside the vault and the product home | that file or directory | **no**. The product never moves or removes a file it does not hold in the vault. |
| `import <path>` anywhere else in the vault, or in the product home | — | run-level refusal |
| `import --claude-memory` | §5.5 | no, because vendor files are read-only |

The inbox (when it is the source) and quarantine roots are each proven to lie inside the configured
content root through the shared `resolveContainedRoot` (`apps/cli/src/context.ts`), the NEW-14 closure. Every
declared path used afterwards is the declared form, as in `capture`.

### 5.2 Enumeration

- **Walk.** Depth-first with `lstat`. Symlinks are never followed; a symlink entry is a per-file
  refusal. Entries whose name begins with `.` are skipped silently; this covers `.gitkeep`.
- **Accepted files.** Regular files with extension `.md`, `.markdown` or `.txt`. Any other regular
  file is `skipped` with reason `unsupported_type`. A skip is reported and does not affect the exit
  code.
- **Order.** Paths are ordered by their NFC-normalized source-relative form, compared as UTF-8 bytes.
- **Batching.** `--limit` and the 1,000-file cap count only files that produce a **new** capture.
  Duplicates are counted in `duplicateCount` and are not listed, so batches are deterministic and a
  rerun over an un-archived inbox advances past what earlier runs imported. Every run still walks at
  most 10,000 entries (§4.4).

### 5.3 Per-file pipeline

```text
read (§4.2) → decode → redact → normalize → deduplicationHash → captureId → envelope
```

This is `buildCapture` unchanged (`packages/brain/src/capture/build.ts`), fed:

- `text`: the decoded file.
- `captureMethod`:
  - `"import"` for inbox and path sources;
  - `"import-claude-memory"` for memory files.

  Only `CaptureBuildRequest`'s union widens; `parseCaptureFile` already accepts any scalar.
- `sourceAgent` and `sourceAgentVersion`: `"unknown"`. The source file's author was not observed, and
  "a guessed agent is worse than an absent one" (`capture.ts`).
- `projectSlug`: the constant `"inbox"`, `"import"` or `"claude-memory"`, by source.
  `workingDirectoryFingerprint` is the keyed fingerprint (`fingerprintDirectory`) of the source root's
  canonical path. For memory it is the fingerprint of the vendor's project directory name. No path and
  no decoded vendor name enters the envelope.
- `createdAt`: import time.

An empty result after normalization is refused (`assertWritableContent`, as in `capture`).

### 5.4 Transaction

One Foundation transaction per new capture, kind `import`, with a single mutation:
`create <quarantine>/<captureId>.md`. This is the same shape `capture` writes.

- **Roots.** `validateChangePlan` receives quarantine as the owned root and the product home as the
  excluded root. Quarantine is prepared exactly as `capture` prepares it: containment proof, then a
  guarded `mkdir` at `0700`.
- **Duplicates.** A capture whose file already exists is a duplicate, detected as `capture` detects it.
  It is reported and not written, and it opens no transaction.
- **The mutation gate is taken once per transaction**, as for every standalone mutator today. Its
  recovery and compaction preflight therefore runs before each file. A gate refusal (closure not
  `clear`, or `assertLifecycleCapacity` refusing before an ID block, `foundation-constraints.md`
  "Plan 1a: lifecycle kernel bounds") stops the run:
  - files already finalized stay finalized;
  - the refusal's exit code is the run's code;
  - unprocessed files are counted in `remaining`.

  The 1,000-per-run cap is below the 10,000-leaf journal-root bound, and compaction runs before each
  admission, so an ordinary batch does not reach capacity.
- **Staged bytes are redacted.** The only staged payload is the redacted capture. This keeps the
  property `tests/e2e/foundation.test.ts` states for `staging/`: it holds post-redaction content.
  **Normative gate:** after a finalized import of a synthetic source carrying a sentinel secret, a
  walk of the whole product home and the whole vault finds the sentinel nowhere. The pattern is
  `tests/security/sentinel.test.ts`.
- **Sources are never modified or removed** under Q5 A. Nothing in this section hashes unredacted
  content.

#### 5.4.1 Archive (only if Q5 = C)

This section applies only after the Q5 C executor change has landed: staged payloads are pruned at
both terminal transitions, and the `tests/e2e/foundation.test.ts` staged-bytes assertion is flipped.
The §5.4 sentinel gate must pass with archiving enabled.

- **The transaction** gains two mutations for sources under the inbox:
  - `create <processed>/<captureId>-<basename>` holding the raw bytes;
  - `remove <source>` with `expectedBeforeHash` set to the SHA-256 of the raw bytes read in §5.3.

  Processed and inbox become owned roots. Each is proven inside the content root through the shared
  `resolveContainedRoot` (`apps/cli/src/context.ts`), the NEW-14 closure.
- **Sources outside the vault** are never moved or removed.
- **Duplicates** still archive, without the capture `create`.
- **Archive collisions.**
  - A byte-identical archive target omits the `create`; the `remove` still runs.
  - A non-identical target is the per-file refusal `import_archive_collision` (exit 3). The source is
    left in place.
- **Concurrent edits.** A source edited between read and apply fails its precondition. The executor
  refuses, the transaction rolls back, and the refusal is `import_source_changed` (exit 3).
- **Directories.** Inbox subdirectories left empty are not removed.
- **The sanctioned raw hash.** `expectedBeforeHash` is the one hash over unredacted content this spec
  introduces. It is the same per-mutation digest the executor already journals for every `replace`
  and `remove`. §13 item 1 records the low-entropy caveat.
- **Backups.** The removed source's backup payload is pruned at terminal transitions by
  `pruneBackups`. A crash before a terminal state leaves it until `repair`, as for
  `review --decision edit`.
- **Where the raw copy lives.** Only in `_raw/processed/`. That folder is never indexed
  (`brain.md` §6.2) and is excluded from Spec 1's scoped Git staging.

### 5.5 `--claude-memory`

**Capability precondition.** The Claude Code auto-memory layout is vendor behaviour. It is taken from
an observation, never from memory or documentation. The plan records it once as the row
`CLAUDE_MEMORY_LAYOUT` in `packages/adapter-claude`. The row carries:

- the Claude Code version it was observed on;
- the date;
- the relative glob, expected `projects/*/memory/*.md` under the vendor home;
- the exact index file name to exclude.

A synthetic fixture pins it, and `claude-adapter.md` records it, the way `AGENT_DETECTION_ROWS` were
recorded. Until that row exists, `--claude-memory` exits 4 with `claude_memory_layout_unobserved`.
`CLAUDE_CONFIG_DIR` is not honoured unless the same observation covers it.

**Enumeration.** Let `<vendor-home>` be the guarded canonical `<user-home>/.claude`.

- Read the directory entries of `<vendor-home>/projects` only.
- For each entry, `lstat` `<entry>/memory`. **The project directory itself is never listed**, because
  it holds session transcripts.
- List `memory/` and take regular, non-symlink `*.md` files other than the index file.
- Nothing else under `<vendor-home>` is opened.

**State.** None new. The capture ID is the hash of the redacted, normalized content, and it is the file
name, so re-importing an unchanged memory file is a duplicate at exit 0. That is the "content hash as
cursor" the inventory asks for. An edited memory file is new content and becomes a new capture for
review.

### 5.6 Refusals

| Reason | Exit | Scope |
|---|---|---|
| `import_path_conflict` (`--claude-memory` with `<path>`) | 2 | parse |
| `import_source_not_found` | 2 | run |
| `import_source_in_vault` (a vault path outside the inbox) | 2 | run |
| `import_source_in_product_home` | 5 | run |
| `import_enumeration_limit` (entries, depth or project directories) | 2 | run |
| `claude_memory_layout_unobserved` | 4 | run |
| quarantine root (and, under Q5 C, processed or inbox root) not contained in the content root (the NEW-14 refusal) | 5 | run |
| a non-terminal transaction, or closure not `clear` (mutation gate) | 6 | run |
| `import_source_protected` | 5 | file |
| `import_source_symlink` | 5 | file |
| `import_source_too_large` | 1 | file |
| `import_source_not_text` (invalid UTF-8 or NUL) | 1 | file |
| `import_source_empty` | 1 | file |
| `import_archive_collision` (Q5 C only) | 3 | file |
| `import_source_changed` (Q5 C only; precondition mismatch at apply) | 3 | file |

A per-file refusal leaves that file untouched and processing continues. Refusal messages name the
source-relative path, passed through the redactor, and never the content.

### 5.7 Result and dry run

```ts
interface ImportResultV1 {
  readonly schemaVersion: 1;
  readonly source: "inbox" | "path" | "claude-memory";
  readonly dryRun: boolean;
  readonly files: readonly ImportFileResultV1[]; // non-duplicate outcomes; ≤ 1,000 imported
  readonly duplicateCount: number;
  readonly remaining: number;            // accepted, non-duplicate files not processed this run
}
interface ImportFileResultV1 {
  readonly path: string;                 // source-relative, redacted
  readonly outcome: "imported" | "skipped" | "refused" | "would_import";
  readonly captureId: string | null;
  readonly reason: string | null;        // §5.6 or `unsupported_type`
  readonly redactionCount: number;       // count only, as in CaptureResultV1
}
```

`--dry-run` performs §5.1–§5.3 in memory and writes nothing: no key creation, no directory
preparation, no transaction. Duplicate status is computed only when the redaction key already exists.
Otherwise every accepted file is `would_import` with `captureId: null`. Under Q5 C the file result
gains `archivedTo: string | null`, a vault-relative path.

---

## 6. `project init`

`developer-os project init [<dir>] [--dry-run] [--json]`. `<dir>` defaults to the working directory.

- **Target.** An existing directory, canonicalized. Overlap is refused with
  `project_root_overlaps_product` (exit 5): the target inside, containing, or equal to the product
  home or the Brain. The product must be initialized, because journals live in the product home.
- **Template set.**
  - The closed set is the flat files in the repository directory `templates/project/`, beside
    `templates/brain/`. It holds at most 8 files, and a test pins its exact names.
  - A12 supplies the content through its redaction step: the project instruction file for each vendor
    (`AGENTS.md` for Codex, `CLAUDE.md` for Claude) and the project context signpost.
  - Every file lands at the project root. The executor does not create parent directories, and flat
    placement makes that a non-issue.
  - Templates are static bytes, with no substitution language.
- **User override (D5).**
  - `<product-home>/templates/project/<name>` replaces the default of the same name as a whole file.
    Names outside the closed set are ignored and reported as a warning.
  - Overrides are read under §4.2 and redacted. An override that yields any redaction finding is
    refused with `project_template_secret` (exit 5), because the output is a repository file that
    may be pushed.
  - Default templates are tested finding-free at build time.
- **Create-only.**
  - If any target already exists, the whole command refuses with `project_file_exists` (exit 3),
    listing every existing path before any write.
  - There is no merge and no `--force`.
  - One Foundation transaction, kind `project-init`, all `create`, admitted by the mutation gate.
    The owned root is `<dir>`; the excluded roots are the product home and the Brain.
- **Ownership.** The written files are the user's repository content. They are not manifest rows, are
  never drift-checked, and are never removed by `uninstall`. They follow the same reasoning that keeps
  captures out of the manifest (`knowledge-pipeline.md` §3).
- **No templates in the build.** **Amended 2026-09-26 (NEW-108).** While the build's
  `PROJECT_TEMPLATE` (`apps/cli/src/commands/project-template.ts`) is empty, `project init` refuses
  `project_templates_unavailable`, exit 4, before any read or write. The shipped build carries three
  templates (`AGENTS.md`, `CLAUDE.md`, `_Context.md`), so the refusal guards a build, not a user state.
- **Result.** `ProjectInitResultV1 { schemaVersion: 1; root; created: readonly string[]; overridden:
  readonly string[]; transactionId: string | null }`. `--dry-run` writes nothing, and its
  `transactionId` is `null`.

---

## 7. `project check`

`developer-os project check [<dir>] [--json]`. It is read-only and spawns nothing. It checks one
directory; checking several repositories is a shell loop.

The result reuses the shipped `DoctorCheck` shape: `ProjectCheckReportV1 { schemaVersion: 1; root;
checks: readonly DoctorCheck[] }`. The check set is closed:

| Check id | Status | Condition |
|---|---|---|
| `instruction-file` | `warn` | neither `AGENTS.md` nor `CLAUDE.md` exists |
| `instruction-size` | `warn` | an instruction file exceeds 40,000 bytes. This is a product-chosen constant, not a vendor limit. |
| `instruction-secrets` | `fail` | a redactor finding in any file of the template set present in `<dir>` |
| `template-set` | `warn` | a `templates/project/` name is absent in `<dir>`. This covers the signpost. |

**Secrets finding.** The report names the file, the class and the 1-based line. To get the line, the
redactor runs over each line after a whole-file pass. A finding the whole-file pass sees and no single
line does (for example a multi-line key block) is reported with line `null`. Values and fingerprints
are never printed.

**Exit.**

| Result | Exit |
|---|---|
| all checks `pass` or `warn` | 0 |
| `instruction-secrets` fails | 5 |
| a file over the 1 MiB read bound (check `fail`) | 1 |

---

## 8. `doctor` check `vendor-config`

This is inventory §6's "reporting only" row, made concrete and structural. It stays value-free.

- **Input.** `<canonical user-home>/.claude/settings.json`, the Claude user settings, read under §4.2
  with a 1 MiB bound. Only `permissions.deny` is examined, and only when it is an array of strings.
  No other key is compared or reported:
  - allow and ask lists are personal choices;
  - `env` routinely holds credentials.
- **Reference.** `VENDOR_CONFIG_REFERENCE_DENY` is derived from `ProtectedPathPolicy`'s protected
  names, so there is no second list. Each entry is rendered as a Claude `Read(...)` deny rule and
  carries a product rule ID such as `read-ssh`.
  - The exact rule strings are vendor syntax. They are pinned against the same observed Claude Code
    version as §5.5's row, not written from memory.
  - A rule counts as present only when an exact string match is found.
- **Where the reference lives.** **Amended 2026-09-26 (NEW-108).** No `VENDOR_CONFIG_REFERENCE_DENY`
  exists. The vendor-neutral half, the product rule IDs, is `PROTECTED_PATH_RULES` in
  `packages/security/src/protected-paths.ts`, which `ProtectedPathPolicy` also reads. The Claude rule
  strings are vendor syntax and live in `packages/adapter-claude/src/observations.ts` as
  `CLAUDE_DENY_RULES`, beside `CLAUDE_MEMORY_LAYOUT`, keyed by those rule IDs and carrying the observed
  Claude version and date; `packages/security` stays free of vendor syntax. While `CLAUDE_DENY_RULES`
  is `null`, the check returns `warn` ("the Claude deny-rule syntax has not been observed") and reads
  no file (`checkVendorConfig`, `apps/cli/src/commands/vendor-config.ts`).
- **Status.** The check never returns `fail`, so it never changes `doctor`'s exit code.

  | Status | When |
  |---|---|
  | `pass` | every reference rule is present |
  | `warn` | reference rules are missing. The warning names the missing **reference rule IDs**, never a user string, with recovery text: "add these deny rules to your Claude user settings; Developer OS never writes that file". |
  | `warn` | the file is absent, over the bound, not valid JSON (fixed message), or `permissions.deny` has the wrong shape |

- **Codex.** Not examined. The product never reads or writes the Codex config file (D7), and Codex has
  no equivalent deny list. The message says so, so that the absence is visible.
- **Hooks.** Guard and hook presence is A13's `doctor` report, not this check.

---

## 9. Recorded refusals

Text for inventory §5 and §6. Each row gets status **refused**, the founder decision number assigned
at approval, and a one-line reason:

- **`repo-audit`, `repo-audit-weekly`, `repo-bootstrap`, `lib/repo-baseline`.** GitHub settings
  governance through `gh` needs network access and a second outbound spawn that the product proves it
  does not have. The bootstrap half is a remote mutation outside the transaction model. The user runs
  `gh` directly. (Q1)
- **`git-history-secrets`.** Running `git` over untrusted repositories needs Spec 1b's Git process
  safety, and dedicated history scanners already exist. (Q2)
- **`worktree`.** The env-file copy is refused by the protected-path policy, and the install needs
  network access and runs arbitrary scripts. What remains is `git worktree add`. NEW-98 moves to
  repository tooling. (Q3)
- **Project settings template.** The product writes no vendor settings file. (Q4)

---

## 10. Test obligations

Enumerators and closed sets assert their expected members **before** asserting properties over them,
so a vacuous `every()` cannot pass. Fixtures are synthetic only.

| Gate | Evidence |
|---|---|
| dispatch is strict | `import`/`project` option and arity matrix in `main.test.ts`, including `--claude-memory` with `<path>`, an unknown `project` subcommand, and `project check --dry-run` → exit 2 |
| import happy path | a synthetic inbox with nested files: captures `quarantined` with `captureMethod: "import"`, sources byte-identical afterwards, `brain search` untouched; a second run imports nothing and `--limit` batches advance; then `review` → `ingest` (fake vendor) → search end to end against the compiled binary |
| deduplication is the cursor | re-running `import --claude-memory` over an unchanged memory fixture yields `duplicate` for every file with zero writes; an edited file yields exactly one new capture |
| redaction precedes everything | a sentinel secret in a source never appears in the capture, in `--json`, in human output, in any journal, in `staging/` or `backups/`, or anywhere under the product home (§5.4 gate); the capture's `redaction` carries class and fingerprint only |
| interruption and capacity | interruption at every phase of an `import` transaction resumes or rolls back through `repair` (extend `tests/security/interruption.test.ts`); a gate refusal mid-run stops with earlier files finalized and `remaining` correct. Under Q5 C, add: identical archive collision omits the create; non-identical refuses exit 3 with the source intact; a source edited between read and apply refuses and is untouched |
| path policy | a symlink entry, a protected name (`.env`, `.ssh/…`), a vault path outside the inbox, the product home, and a quarantine root replaced by a link out of the content root each refuse with their §5.6 code and write nothing |
| bounds | 64 KiB and 64 KiB + 1; 10,000 and 10,001 entries walked; depth 16 and 17; 1,000 and 1,001 files (with `remaining: 1`); 1,000 and 1,001 memory project directories |
| transcripts untouched | the memory fixture places a synthetic transcript file beside `memory/`. An injected filesystem proves it is never opened and its directory is never listed. `tests/repository/transcript-path.test.ts` stays green unmodified. |
| layout capability | with no `CLAUDE_MEMORY_LAYOUT` row, `--claude-memory` exits 4 and reads nothing |
| dry run writes nothing | an `import --dry-run` and a `project init --dry-run` against a home with no redaction key leave the product home and the vault byte-identical, with no key created |
| project init | create-only refusal lists every existing target before any write; override replaces a default; an override carrying a secret refuses exit 5; overlap with the product home or Brain refuses exit 5; `uninstall` leaves created files in place |
| templates are clean | every `templates/project/` file is ≤ 64 KiB and redactor-finding-free; the exact name set is pinned |
| project check | each check's pass, warn and fail arms; a secret reports file, class and line, never the value; a 1 MiB + 1 file is not read past the bound |
| vendor-config is value-free | a settings fixture whose `env`, `allow` and `deny` carry sentinel strings: no sentinel appears in `doctor` output in either mode; invalid JSON yields the fixed message; absent file, over-bound file and wrong shape each `warn`; the check never `fail`s |
| no new capability | `tests/e2e/foundation.test.ts`'s network scan and `tests/security/network.test.ts`'s classified spawn set are unchanged; `tests/repository/redactor-entry.test.ts` covers the new composition roots |

Under D32, the slow files among these (`tests/e2e`, `tests/security`, `tests/integration`) run at plan
close; the cases a task adds still run red then green, filtered with `-t`.

---

## 11. Documents amended by the plan

Chasing a withdrawal through every document that names it is the lesson of roadmap Phase 3.

| Document | Change |
|---|---|
| `docs/migration/instruction-inventory.md` §5, §6 | §2's dispositions and §9's refusal text |
| `docs/superpowers/BACKLOG.md` A14 section | verb list reduced to §3, refusals named |
| `docs/superpowers/BACKLOG.md` NEW-98 | re-owned from A14 to repository tooling (Q3) |
| `docs/superpowers/ORDER.md` A14 row, NEW-98 routing line | same |
| roadmap Phase 7 bullets | verb list reduced; the automation note of §1 added for Phase 9 |
| `docs/architecture/claude-adapter.md` | `CLAUDE_MEMORY_LAYOUT` observation; `vendor-config` reads, never writes, the user settings file |
| `docs/architecture/threat-model.md` §5.1 and §7 | import as a second entrance into quarantine; absent capabilities unchanged; under Q5 C the sanctioned raw precondition hash |
| `docs/superpowers/specs/2026-07-21-developer-os-design.md` §12 | under Q5 A, a note that `_raw/processed/` is created by `init` and not written by any product verb |
| `docs/architecture/knowledge-pipeline.md` §1 and §3 | `import` beside `capture`; the `captureMethod` values |
| design §8 command list amendment note | `import`, `project init|check` |

---

## 12. Implementation sequence

Every step leaves the product deployable. Sizes are S, M or L.

1. **Inventory and backlog amendments (S).**
   - **What:** §11's documentation changes and the §2 table.
   - **Where:** the documents in §11.
   - **How:** a docs-only commit after founder approval.
   - **Test:** a grep of the refused names finds only refusal text.
2. **Dispatch (S).**
   - **What:** `import` and the `project` group parse; the handlers refuse "not implemented" with
     exit 4.
   - **Where:** `apps/cli/src/main.ts`, `main.test.ts`.
   - **How:** the `BRAIN_SUBCOMMANDS` pattern.
   - **Test:** the strict-dispatch matrix.
3. **Sentinel gate (S).**
   - **What:** the §5.4 product-home and vault sentinel walk, written first and red.
   - **Where:** `tests/security/sentinel.test.ts`.
   - **How:** a synthetic inbox source carrying a sentinel secret, imported through the compiled
     binary.
   - **Test:** red before Task 4, green after.
4. **Import core (M).**
   - **What:** §5.1–§5.3 and §5.6–§5.7 for inbox and path sources, capture only.
   - **Where:** `apps/cli/src/commands/import.ts`; `packages/brain/src/capture/build.ts` (the widened
     union).
   - **How:** reuse `buildCapture`, `capture`'s duplicate probe, root proof and quarantine
     preparation, extracted and never copied.
   - **Test:** the unit rows of §10 for enumeration, bounds, redaction, dry run and refusals.
5. **Interruption coverage (S).**
   - **What:** the `import` transaction kind in the interruption suite, and the mid-run gate refusal.
   - **Where:** `tests/security/interruption.test.ts`.
   - **Test:** the interruption-and-capacity row.
   - **Under Q5 C only:** the executor staged-payload prune and the §5.4.1 archive come first, as two
     further tasks with the §10 Q5 C rows.
6. **Claude memory (M).**
   - **What:** the observation, then §5.5.
   - **Where:** `packages/adapter-claude` (the row), `import.ts`, `claude-adapter.md`.
   - **How:** one recorded observation on a disposable home, never the founder's.
   - **Test:** the transcripts-untouched, layout-capability and deduplication rows.
7. **Project init (M).**
   - **What:** §6. This consumes A12's `templates/project/` content, and only needs A12's plan to
     have landed the files.
   - **Where:** `apps/cli/src/commands/project.ts`, `templates/project/`.
   - **Test:** the project init and templates-are-clean rows.
8. **Project check (S).**
   - **What:** §7.
   - **Where:** `project.ts`.
   - **Test:** the project check row.
9. **`vendor-config` (S).**
   - **What:** §8.
   - **Where:** `apps/cli/src/commands/doctor.ts`, `packages/security` (the derived reference).
   - **Test:** the value-free row.
10. **Close (S).**
    - **What:** the `npm run check` and slow suites at plan close, the §2 gate re-read against the
        inventory, and the roadmap Phase 7 tick.
    - **Test:** a green full suite, plus an independent review by an agent that wrote none of it.

Parallelism under D33: Tasks 4, 7, 8 and 9 touch disjoint files after Task 2. Tasks 3 and 5 consume 4.
Task 6 consumes 4.

---

## 13. Accepted residuals

1. **Q5 C only: the raw precondition hash can be guessed for low-entropy sources.** A file whose entire content
   is a short secret can be brute-forced from the SHA-256 stored in the journal. This is the same
   exposure every executor `replace` or `remove` digest already has. **Owner:** the accepted
   local-write boundary.
2. **Unredacted user bytes remain in the vault.** Under Q5 A they stay in the inbox; under Q5 C they
   move to `_raw/processed/`. Either way they are the user's own
   bytes, never copied by the product. `_raw/` is never indexed and never Git-synced. Obsidian or third-party sync of the whole
   vault is outside the product. **Owner:** user documentation (A16).
3. **`vendor-config` exact-string matching.** It warns about a deny rule the user wrote in an
   equivalent but different spelling. The false warning is the safe direction. **Owner:** A14; widen
   only with observed vendor semantics.
4. **Import captures carry no author.** `sourceAgent: "unknown"` for every import, including memory
   files a vendor wrote. `captureMethod` preserves the provenance. **Owner:** none; this is by design.
5. **An edited memory file produces a new capture each time.** Review is the filter. **Owner:** none.
