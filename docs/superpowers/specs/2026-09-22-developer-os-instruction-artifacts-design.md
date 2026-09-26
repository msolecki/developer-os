# Developer OS — Managed Instruction Artifacts Design

**Approved 2026-09-22 by the founder (D47).** Every open question is answered with its recommended
option, except A12 Q1: there is no production for now — the product runs from a local, unsigned build
on the founder's machine only; no release, signing or public install path is built until the founder
reopens it. Wherever this spec names the launcher or a packaged release as the install source, read
"the local build" (A12 Q1 option A, `trust: "unsigned-local"`, local only).

**Status: draft, 2026-09-22, awaiting founder approval of the open questions below and a
fresh-context written-specification review.** This is `ORDER.md` entry A12, DOS-P10, roadmap Phase 5
(`docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`). Scope statement:
`docs/migration/instruction-inventory.md` §1, §2, §3 and §6. Backlog rows it owns: A12, NEW-60,
NEW-61, NEW-65. Its implementation plan is written after approval as
`plans/<date>-developer-os-instruction-artifacts.md`.

It consumes, and does not restate: `InstallationManifestV2` and the V2 new-init handoff (Spec 2
§6), the plan 1a mutation gate and drained uninstall (Spec 1 §2, §6; `foundation.md` §10), the two
adapters (`claude-adapter.md`, `codex-adapter.md`), the redaction engine
(`packages/security/src/redaction.ts`) and the clean-room procedure of
`docs/migration/exclusion-policy.md`.

## 0. Open questions for founder approval

Three questions. The rest of this document is written so that none of their answers changes
anything outside the section each names.

### Q1 — Where does production V2 `init` get its packaged release while signing is dropped?

Every A12 artifact is installed from, and hash-bound to, an admitted packaged release (§3.1). Today
production has none: `apps/cli/src/context.ts:790` pins `bootstrap: { state:
"unavailable_until_packaged_handoff" }`, and `LAUNCHER_OFFLINE_RELEASE_ROOTS` is `[]` because the
founder dropped release signing keys for now. Spec 2 Task 11b removes the pin only through a
root-verified handoff. A12 can be implemented and fully tested without an answer, because every test
uses the existing synthetic packaged release (`createSyntheticPackagedRelease`,
`apps/cli/src/commands/testing.ts`). What A12 cannot do without an answer is reach the founder's
machine, and the A15 cutover depends on that.

- **A — unsigned local-build source (recommended).** The launcher gains one explicit arm: it admits
  a bundle the user built locally from a named directory, under the same inventory and hash
  admission as a signed bundle but with no signature chain. The admitted source is recorded as
  `trust: "unsigned-local"` in the release trust state, `doctor` reports it as a warning on every
  run, and `update` (Phase 8) refuses to use it as a source or a rollback target. It is selected
  only by an explicit flag, never by fallback. This keeps D16's "reinstall a newer build" path working
  with no key management, and records the trust downgrade instead of hiding it. Cost: a Spec 2
  amendment (§3 trust states) and a threat-model entry (§11.4 here).
- **B — a founder-held offline key, used only on the founder's machine.** Generate one root key,
  compile it into a personal launcher build, and sign each local build. This preserves the approved
  trust model unchanged, but it brings back exactly the key-management work the founder has just
  declined.
- **C — keep the pin; ship A12 behind the test fixture only.** A12 closes its gate on synthetic
  releases, and production install waits for signing. This is the cheapest option now, but it blocks
  A15, which D16 put before the release work.

### Q2 — How do instruction changes reach an installed home before `update` exists (Phase 8)?

User overrides (§3.2) and adapter selection change after `init`. D16 says that until Phase 8 a new
*build* reaches the machine only by reinstalling. That rule does not say how a changed *override*
reaches it.

- **A — re-running `init` on an installed V2 home reconciles instruction artifacts (recommended).**
  It performs no bootstrap and does not change the release. It runs only the instruction step of
  §6.1 against the currently admitted release, and refuses if that release is not the installed one.
  This honours the umbrella design's "re-running `init` with the same inputs is idempotent" (§9.1)
  and adds no verb. It is also where the three-way block merge (§5) and Codex re-registration
  (NEW-61) actually run.
- **B — a new verb `developer-os instructions apply`** that has the same semantics as A. It is more
  discoverable, but it adds one more mutating command to the closed CLI surface.
- **C — reinstall only (`uninstall`, then `init`).** No new path. The cost: uninstall strips the
  block and `init` writes it fresh, so the three-way merge never runs outside the uninstall refusal
  path. The roadmap's "first real consumer of `buildConflictEvidence`" and NEW-61's
  "re-register on change" both reduce to "at install".

If B is chosen, §6.2 renames its entry point and nothing else changes. If C is chosen, §6.2 is
deleted and its gates in §10 move to the uninstall→`init` cycle.

### Q3 — Are the six research skills in inventory §7 part of A12?

The roadmap scopes A12 to inventory §1–§3 and §6. Inventory §7, however, marks `research`,
`research-deep`, `research-add-fields`, `research-add-items`, `research-report` and
`excalidraw-diagram` as "skills in A12, not Brain workflows, planned A12". The two documents
conflict.

- **A — include them in A12 (recommended).** They are plain skills and use exactly the §4 `skill`
  mechanism, so they add catalog rows and no design. The gate count becomes 44.
- **B — move them to A12b**, beside the Brain workflows.
- **C — refuse them**, and record the refusal in the inventory.

## 1. Scope and invariants

A12 installs, drift-checks and uninstalls every instruction artifact the inventory lists, on both
vendors. Each artifact comes from one of two sources: a public default in this repository, or the
user's own override under the product home. The following invariants hold on every path:

1. **Only whole files the product created, plus one marked block per vendor instruction file.** The
   product never edits bytes outside its marked block in a user file. It never writes a vendor
   settings file (`~/.claude/settings.json`, `<codex-home>/config.toml`), and it never writes
   `AGENTS.override.md` at any scope. `codex-adapter.md` §2.2's refusal of `AGENTS.override.md`
   stands.
2. **A user edit is never overwritten or deleted.** A drifted managed file, or an edited block,
   refuses the mutation with exit 3. The user's override source under the product home is user data:
   it is never a manifest row, and it is never removed.
3. **A loaded artifact is a proven artifact.** An artifact is installed on a vendor only where plan
   Task 1 observed that vendor loading it (§10.1). Listing, validating or writing a file is not
   loading (NEW-65, NEW-61).
4. **Nothing is selected on the user's behalf.** Installing output styles, agents or rules never
   selects, enables or activates one. Only the Codex plugin registration, which is the vendor's own
   CLI, changes vendor state (§6.4).
5. **Defaults are redacted before they enter the repository** (§3.3). No client, project, person or
   machine reference is published.
6. **Ingest isolation (D8) is unchanged.** Installed instructions must not reach an ingest
   invocation on either vendor (§10, gate `ingest stays isolated`).

Out of scope: hooks (A13), `project init` templates (A14), Brain workflows (A12b), and any release
change (`update`, Phase 8).

## 2. The artifact model

### 2.1 `ManagedArtifactV2` gains the kind `instruction`

`packages/core/src/manifest/types.ts` adds two arms and one merge strategy:

```ts
export type MergeStrategy = "dedicated" | "semantic-json" | "semantic-toml" | "marked-block";

export type InstructionCategoryV1 =
  | "rule" | "scoped-rule" | "output-style" | "agent" | "skill" | "command" | "vendor-file";

export interface InstructionIdentityV1 {
  readonly category: InstructionCategoryV1;
  readonly id: InstructionIdV1;            // slug, §2.3
  readonly source: "default" | "user";
}

export interface InstructionBlockMemberV1 {
  readonly category: Exclude<InstructionCategoryV1, "vendor-file">;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly sha256: LowerHexSha256;         // hash of the member's rendered bytes inside the block
}

// added to the ManagedArtifactV2 union
| (ManagedArtifactCommonV2 & { readonly kind: "instruction"; readonly instruction: InstructionIdentityV1;
    readonly verification: { readonly mode: "content"; readonly installedHash: LowerHexSha256 } })
| (ManagedArtifactCommonV2 & { readonly kind: "instruction";
    readonly instruction: InstructionIdentityV1 & { readonly category: "vendor-file";
      readonly source: "default"; readonly members: readonly InstructionBlockMemberV1[] };
    readonly verification: { readonly mode: "block"; readonly blockHash: LowerHexSha256 } })
```

The two arms have different rules.

**`content` rows.**
- They must have `mergeStrategy: "dedicated"`, `existedBefore: false` and null restore fields. An
  instruction target is always a product-prefixed or product-rooted path (§4). An occupied target
  refuses the install (§8); it is never adopted.
- A multi-file skill has one row per file, and every row carries the same `instruction` identity.

**`block` rows.**
- They must have `mergeStrategy: "marked-block"`. `existedBefore` follows the file.
  - When the file existed, the whole-file backup and its `beforeHash` are recorded. They serve only as
    evidence and are **never restored** (§6.3).
  - When the product created the file, `existedBefore` is `false` and the restore fields are null.
- `members` is sorted by `(category, id)`, unique, and holds 1 to 64 entries. `owner` is `claude`
  or `codex`. There is at most one block row per owner.

For type checks, drift treats `instruction` as a regular file.

- **`content` rows.** Drift hashes the whole file, exactly like a `file`/`content` row.
- **`block` rows.** Drift extracts the block (§5.1) and hashes it.
  - Absent markers are reported as `missing`.
  - An edited block is `content_changed`.
  - Malformed markers raise a new `DriftKind`, `block_malformed`.
  - Bytes outside the block are never drift.

**Touch points, all in one change.**
- `validateManifestV2`'s exact key sets and arms, plus its `restore()` rule (`v2.ts`)
- the inventory sort key, which already orders by kind and mode
- `inspectV2Artifact` (`drift.ts`)
- `downcastArtifactV2` (`apps/cli/src/lifecycle/uninstall.ts`). It downcasts `content` rows to V1
  `file` and never downcasts `block` rows (§6.3).
- `isStructurallyValidV2Manifest`, which follows automatically through `validateManifestBytes`
- the new schema id `codex-registration-v1` (§6.4), in `v2.ts`'s `schemas` set and in the
  composition-root `ManagedArtifactSchemaRegistry`

**No migration is needed.** No V2 installation exists (D18, D19), so this is a union change, not a
schema version.

### 2.2 Ownership: a closed external authorization per owner

Today, every confined `createOwnerPathAdmission` call site admits only the product home and the
Brain, and uninstall's `ownedRoots` is `[paths.home]`. Out-of-home rows are preserved and reported
(Spec 1 §6). A12 adds a closed authorization, modelled on Spec 1's plist precedent. It is exact,
owner-bound and derived. It never becomes a general external root.

| Owner | Authorized path (derived from the user home `H`, product home `P`, Codex home `C`) | Arm |
|---|---|---|
| `claude` | the subtree `H/.claude/skills/developer-os/` | `file` and `instruction`/`content` |
| `claude` | `H/.claude/rules/developer-os-<id>.md` | `instruction`/`content`, category `scoped-rule` |
| `claude` | `H/.claude/output-styles/developer-os-<id>.md` | `instruction`/`content`, category `output-style` |
| `claude` | exactly `H/.claude/CLAUDE.md` | `instruction`/`block` only |
| `codex` | `C/agents/developer-os-<id>.toml` | `instruction`/`content`, category `agent` |
| `codex` | exactly `C/AGENTS.md` | `instruction`/`block` only |
| `claude` | the directories `H/.claude`, `H/.claude/skills`, `H/.claude/rules`, `H/.claude/output-styles` | `directory` only, and only when created by the product |
| `codex` | the directories `C` and `C/agents` | `directory` only, and only when created by the product |
| `claude`, `codex` | `P/claude/**`, `P/codex/**` | already inside the product home |

The authorization is enforced in several places.

- **Where it applies.**
  - The authorization belongs to the `confined` arm of `createOwnerPathAdmission`, which becomes
    owner-aware.
  - Every confined call site passes it: `bootstrap/report.ts` (two sites), `bootstrap/executor.ts`,
    `lifecycle/mutation-gate.ts`, `lifecycle/uninstall.ts`, and `commands/uninstall.ts`.
  - The drained uninstall's removable partition is **not** widened. Vendor rows leave the manifest
    through the detach step (§6.3), before the drained uninstall starts.
- **Missing parent directories.** Transactions create no target parents: only their own staging and
  backup directories are created, in `packages/core/src/transactions/executor.ts`. A missing parent
  of an authorized target is therefore created by the same transaction as an exact-path `directory`
  row, with `existedBefore: false`. It is removed only when it is empty, deepest first (D25's rule).
  A non-empty directory is preserved and reported. A parent that already exists is never a row.
- **Refusals.**
  - A symlink at any path component refuses the path with `instruction_target_symlinked`, exit 5.
    This includes a dotfiles-managed `H/.claude/CLAUDE.md` or `C/AGENTS.md`. The recovery is to
    replace the symlink with a regular file holding the same bytes.
  - The legacy runtime links its files, so this refusal is an input to the A15 cutover runbook.
  - An authorized path of the wrong owner or arm refuses too, and the uninstall ledger preserves it.
- **Vendor homes.**
  - `C` is the value of `CODEX_HOME` in the CLI's environment when that value is absolute, and
    `H/.codex` otherwise. It is resolved once per command and recorded in the plan.
  - A set `CLAUDE_CONFIG_DIR` is not followed in version 1. `doctor` warns when it is set, because
    the managed files are then not the ones Claude reads.
- **Adapter fix.** `proposeClaudeUninstall` gains the owner check its Codex twin already performs
  (`claude-adapter.md` §13, last bullet).

### 2.3 Bounds (`InstructionBoundsV1`)

These bounds apply to every source before rendering. Each bound is enforced with a refusal and a
first-over-limit test.

| Quantity | Bound |
|---|---|
| `InstructionIdV1` | `^[a-z0-9][a-z0-9-]{0,63}$`, not prefixed `developer-os-`, and not equal to any workflow id under `workflows/` |
| relative path segment inside an artifact | `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, depth ≤ 4 |
| one file | ≤ 256 KiB, UTF-8 without BOM or NUL, LF line endings |
| one artifact (a skill directory) | ≤ 64 files, ≤ 1 MiB |
| artifacts per vendor after override merge | ≤ 128 |
| bytes per vendor after override merge | ≤ 8 MiB |
| `scoped-rule` `paths:` frontmatter | 1–32 globs, each ≤ 256 bytes |
| Codex `AGENTS.md` block | ≤ 64 KiB, lowered to the vendor's observed load limit if plan Task 1 measures a smaller one |
| product home `P` used in a Claude `@` import line | absolute, and each segment matches `^[A-Za-z0-9._-]+$`; otherwise the install refuses with `instruction_path_not_importable`, exit 2 |

User sources are also subject to these filesystem rules:
- They are opened no-follow.
- Only regular files and directories are admitted. A file must have `nlink` 1 and be owned by the
  effective uid.
- Anything else refuses with `instruction_source_invalid`. The refusal reports the path and line
  only, never content.

## 3. Sources

### 3.1 Defaults: the repository's `instructions/` tree, read from the admitted release

```text
instructions/
├── catalog.json                       ← InstructionCatalogV1, the closed list
├── rules/<id>.md                      ← inventory §1, the four global rules
├── scoped-rules/<id>.md               ← inventory §1, the four path-scoped rules (`paths:` frontmatter kept)
├── output-styles/<id>.md              ← inventory §2
├── agents/<id>.md                     ← inventory §3 subagents (Markdown source; Codex TOML is generated)
└── skills/<id>/SKILL.md [+ files]     ← inventory §3 skills
```

**The catalog.** `InstructionCatalogV1` is `{ schemaVersion: 1, artifacts: [{ category, id,
legacyName, vendors: ("claude"|"codex")[], thinCommand: boolean }] }`. It is strict, sorted and
unique.
- `legacyName` maps each row to its inventory name. The coverage test (§10) compares the catalog
  with the inventory tables.
- `thinCommand` is legal only on `skill` rows and marks the eight command/skill pairs.
- A file under `instructions/` that the catalog does not list refuses the render, and so does a
  catalog row with no file.

**Packaging and runtime reads.**
- The release bundle carries `instructions/` verbatim.
- At runtime, defaults are read only through `AdmittedPackagedReleaseV1.readFile`. Each read is
  checked against that release's `files[].sha256`, and the working tree is never consulted.
- The checked-in `plugins/claude/` and `plugins/codex/` trees are regenerated from the defaults
  alone by `npm run render:claude|render:codex`. The existing generated-tree drift tests therefore
  cover the default render.

### 3.2 User overrides: `<product-home>/instructions/<vendor>/`

The layout mirrors §3.1 per vendor: `instructions/claude/rules/<id>.md`,
`instructions/codex/skills/<id>/SKILL.md`, and so on. There is no catalog. The category is the
directory, and the id is the file or directory name.

**Precedence.**
- An override with the same `(category, id)` as a default **replaces** that default on that
  vendor. For a skill, the whole directory is replaced.
- A new `(category, id)` **adds** an artifact.
- Rows record `source: "user"` in either case.
- A default cannot be disabled in version 1; it can only be replaced (§12.3).
- An override placed in a category the vendor does not support is reported as
  `unsupported-vendor`, for example `codex/output-styles/`. It does not refuse.

**Lifecycle standing.**
- The user owns this directory, and it is never a manifest row. The product never creates, edits or
  deletes anything under it.
- `uninstall` preserves it. Fresh `init` must admit it after an `uninstall`.
- That requires two dated amendments:
  - **Spec 2 §6.1:** `admittedPreexistingPaths` admits the exact name `instructions` as an opaque
    user-data subtree.
  - **Spec 1 §6:** the absent-manifest walk and the ledger classify the same subtree as user data,
    not residue. The subtree is still walked with the same bounds, and a symlink inside it still
    refuses.

### 3.3 Redaction before defaults enter the repository

This procedure applies `exclusion-policy.md`'s clean-room procedure to every default. The agent
writing a default never reads a legacy source path. The founder supplies each legacy artifact
through an owner-controlled process. The default is reconstructed and reviewed as a publication
candidate, then staged by exact path.

**Redaction classes.** Every default is rewritten so that it contains none of the following:
- client, customer, employer or project names, including inside dated incident citations. The
  lesson is kept and the citation becomes neutral.
- person names, e-mail addresses and handles
- absolute or home-relative machine paths, and any path into the legacy runtime (the legacy
  shared-instruction repository, the private vault, legacy scripts). Each is rewritten to a product
  path or verb, or removed.
- private repository names, remotes and URLs, and private decision or incident identifiers
- secrets of any kind
- **user-specific preferences.** A personal preference is stated neutrally in the default. The
  founder's own value moves to the founder's override (§3.2), on the founder's machine, and never to
  the repository.

**Gates.**
- **CI.** `tests/repository/instruction-defaults.test.ts` scans every file under `instructions/`
  with the product secret scanner, plus generic patterns:
  - absolute home paths
  - `~/` outside `~/.claude`, `~/.codex` and `~/.developer-os`
  - e-mail addresses
  - URLs outside a checked-in host allowlist
  - the frozen-source environment prefix named in `tests/repository/self-containment.ts`
  - any reference to `docs/superpowers/plans/legacy-runtime/`

  Findings report path and line only.
- **Founder-local.** `tests/tools/scan-instruction-defaults.ts --patterns <file>` runs the same
  scanner with a private pattern file. That file lives outside the repository and is never
  committed. The commit that adds or changes a default records the finding count (zero) and the
  command. Independent review precedes staging.
- **Third-party content.** `react-best-practices` keeps its own license file and attribution inside
  its skill directory. It ships only if its license permits redistribution of a modified copy under
  the repository's license (L1). If it does not, the founder records a refusal in the inventory
  instead.

## 4. Vendor projection

This table is normative. A row whose "Loading proof" is not observed by plan Task 1 stops the plan
for a founder decision. It is never silently downgraded to `unsupported-vendor`, because that would
narrow the gate.

| Category | Claude target | Codex target | Loading proof (Task 1 pins the exact command and output) |
|---|---|---|---|
| `rule` | `P/claude/instructions/<id>.md`, imported by one `@<absolute path>` line in the `H/.claude/CLAUDE.md` block | concatenated into the `C/AGENTS.md` block under `## <id>` | Claude: real-agent row (§10.2). Codex: `codex debug prompt-input` contains the block |
| `scoped-rule` | `H/.claude/rules/developer-os-<id>.md`, with `paths:` frontmatter preserved | **emulated**: a section in the `C/AGENTS.md` block titled `## <id> — applies only to paths matching: <globs>`; reported `emulated` | Claude: real-agent row. Codex: prompt-input |
| `output-style` | `H/.claude/output-styles/developer-os-<id>.md`, frontmatter `name` unchanged, never selected | **`unsupported-vendor`**: nothing written | Claude: real-agent row |
| `agent` | `H/.claude/skills/developer-os/agents/<id>.md` | `C/agents/developer-os-<id>.toml`, generated from the Markdown source; Task 1 pins the key set | Claude: `claude plugin details developer-os` lists it. Codex: Task 1 |
| `skill` | `H/.claude/skills/developer-os/skills/<id>/…` | `P/codex/plugins/developer-os/skills/<id>/…` | Claude: `plugin details`. Codex: prompt-input, with each skill's loaded bytes hashing equal to the tree after re-registration |
| `command` (the 8 pairs) | a generated thin `H/.claude/skills/developer-os/commands/<id>.md` whose body only invokes the skill `<id>`; one text, not two (inventory §3) | collapsed: the skill alone | Claude: `plugin details` lists the command |
| `vendor-file` | the one block in `H/.claude/CLAUDE.md` (§5) | the one block in `C/AGENTS.md` (§5) | as for `rule` |

**Renderers.**
- Rendering is a pure function in each adapter package, `renderInstructionTree(defaults,
  overrides)`. It returns the adapter's existing artifact-root types (`RenderedArtifact` for Claude,
  `MarketplaceRootArtifact` for Codex) plus the one block.
- Output is byte-deterministic under a reversed directory reader, just as the workflow skills are
  today (`claude-adapter.md` §7, `codex-adapter.md` §8).
- Instruction skills are not prefixed `developer-os-`. The plugin namespaces them, and §2.3 forbids
  a collision with a workflow id.

**Legacy `brain-search` is not rendered.** Inventory §3 marks it **partial**. The product workflow
`developer-os-brain-search` is its target, because it calls the CLI instead of reading index files
(§9).

## 5. Vendor instruction files: the marked block and the three-way merge

### 5.1 Grammar

```text
<!-- developer-os:begin v1 -->
<!-- Managed by developer-os. Edits inside this block are refused; change <P>/instructions/<vendor>/ instead. -->
…rendered content…
<!-- developer-os:end v1 -->
```

- **Well-formed.** A block is well-formed when the file holds each marker exactly once, each on its
  own LF-terminated line, with begin before end.
- **Block bytes.** They run from the first byte of the begin line through the LF of the end line.
- **Malformed.** Any other count or order of the markers is `block_malformed`.
- **Content.**
  - Claude: the block holds one `@<absolute path>` line per `rule` row, sorted by id.
  - Codex: it holds the `rule` sections, then the `scoped-rule` sections, sorted by id.
- **First insertion.** The block is appended directly after the file's final LF, with no separator
  line. If a non-empty file lacks a final LF, one LF is added first. That LF persists after
  uninstall, and it is the only byte an install/uninstall cycle may leave behind. A missing file is
  created and holds only the block.
- **Legacy import lines.** Legacy import lines outside the markers are user bytes, and the product
  never touches them. Until A15 removes them, the same rules load twice.

### 5.2 Merge

Three states feed the merge:
- **base:** the row's recorded `blockHash`
- **current:** the block extracted from the live file
- **proposed:** the fresh render

| Current | Action |
|---|---|
| equals base | write proposed (no write if proposed equals base) |
| equals proposed | no write; the row is refreshed |
| markers absent (the user deleted the block, or the file) | re-insert proposed per §5.1; reported as `restored` |
| markers malformed | refuse `instruction_block_malformed`, exit 3 |
| anything else | refuse `instruction_block_conflict`, exit 3, with conflict evidence (§5.3) |

**How the write happens.** The write is an ordinary Foundation `replace` of the whole file. Its
`expectedBeforeHash` is the whole-file hash read at plan time, so a concurrent edit anywhere in the
file refuses through the existing path. Bytes outside the block are copied unchanged, and a test
pins that byte-for-byte (§10).

**Recovery.** Every exit-3 refusal carries the same recovery text: move the edits into
`<P>/instructions/<vendor>/`, delete the whole block (both markers included), and re-run the
command. Deleting the block is the supported resolution, and the next run re-inserts it.

### 5.3 Conflict evidence: the first consumer of `buildConflictEvidence`

`ConflictEvidenceRequest` becomes a union.

**The existing V1 arm.** It is unchanged.

**A new block arm.** Its shape is `{ block: { artifact: <block row>, fileBytes: Uint8Array,
proposedBlock: Uint8Array }, fs, guards, redactDiagnostic }`, and it returns the existing
`ConflictEvidence`:
- `baselineHash` = the row's `blockHash`
- `baselineBackupRelativePath` = the row's whole-file backup, or `null`
- `currentHash` = the hash of the extracted current block
- `proposedHash`
- a redacted unified diff from current to proposed, produced by the same bounded diff body (1 MiB
  and 1,000-line notices unchanged). **Amended 2026-09-25 (D62)**, replacing "4 MiB and
  20,000-line": these are the shared body's bounds (`MAX_DIFF_BYTES` and
  `MAX_DIFF_LINES` in `packages/core/src/manifest/drift.ts`)

**Diff shape.** The diff stays **two-way**, and the block's base bytes are not retained. It shows
exactly what the user changed against what the product would write, and all three hashes are
reported. This amends umbrella design §9.3's "three-way diff" to "three hashes plus a two-way diff"
(§11). Retaining base bytes would add a product-home store for no decision the user makes
differently.

## 6. Lifecycle

### 6.1 `init` installs (NEW-60)

The instruction install is **an ordinary post-handoff V2 mutation, run by `init` after the
bootstrap handoff completes**. It passes through the plan 1a mutation gate as one Foundation
transaction. The bootstrap executor and its plan are not extended: that gate is the deferred
330-minute suite, and a fresh install without instructions is already a complete, valid V2 home.

**Adapter selection.**
- `init` gains `--adapters <claude,codex|claude|codex|none>`.
- On a fresh `init` without the flag, the selection is `none`, and the output names the flag as the
  next step. The product never writes into a vendor home without an explicit selection.
- The selection is written to the existing `adapters.claude` and `adapters.codex` configuration
  keys in the same step.
- A selected vendor whose CLI is absent, unreadable or below its floor refuses with
  `adapter_unavailable`, exit 4, before any mutation.

**Steps, per selected vendor.** Each step runs under the global lock through the mutation gate:

1. Load the defaults (§3.1) and the overrides (§3.2), and enforce the §2.3 bounds.
2. Render the vendor tree: the six workflow skills plus the instruction artifacts. The existing
   `proposeClaudeInstall` and `proposeCodexInstall` are retyped from V1 to V2 rows. Their
   `create`/`replace` choice is keyed off the V2 manifest.
3. Plan the block (§5.2) and check every target.
   - An unmanaged file already at a `content` target refuses with `instruction_target_occupied`,
     exit 3.
   - A protected path refuses through the existing guard, exit 5.
4. Commit one Foundation transaction: every file, the missing parent directories, both blocks, the
   configuration's `adapters.*` values, and the new manifest rows.
5. Codex only: run the registration step (§6.4).

**Binding to what exists.** Step 4 uses the path `config set` already uses. That path is
`withLifecycleMutation(context, lifecycle, work)` (`apps/cli/src/lifecycle/mutation-gate.ts`), and
inside `work` it calls `context.executor.execute(TransactionPlan)`, whose mutations are `{ targetPath,
operation: "create"|"replace"|"remove", content, expectedBeforeHash }`. The manifest rewrite is one
`replace` in that same plan, guarded by the manifest's current hash. **The plan's first code task
confirms that an ordinary gated transaction may rewrite the V2 manifest.** If only the lifecycle
coordinator's `M(...)` arms may do so, the plan stops and asks. It must not route the install
through the coordinator on its own authority.

**Failure handling.**
- A failure in steps 1–4 leaves the transaction's own recovery semantics (exit 6 where applicable).
  It does not undo the bootstrap handoff.
- The instruction check is **not** added to `INIT_OWNED_CHECKS`. An instruction failure never
  reverts Foundation.
- `init` exits with the instruction step's code. The recovery is the command Q2 selects, which is
  re-running `init` under option A.

### 6.2 Reconcile on an installed home (Q2 option A)

Today `init` on an installed V2 home is `settleExistingV2` (`apps/cli/src/commands/init.ts`). It
asserts no drift, performs no write, and reports every artifact `unchanged`. A12 amends it: after
the same checks, that function runs §6.1 steps 1–5. Drift in an instruction row is no longer a
blanket refusal there. It is resolved by the §5.2 table and §8. Drift in any non-instruction row
still refuses, as today.

**Preconditions.**
- The admitted release's version must equal the manifest's `productVersion`. Otherwise it refuses
  with `release_mismatch`, exit 4, and the recovery names `update` (Phase 8) or a reinstall (D16).
- `--adapters`, when given, replaces the stored selection. When it is omitted, the stored selection
  is used.

**Deselected vendors.** Deselecting a vendor removes that vendor's rows by §6.3 steps 1–3, which
include stripping the block and unregistering.

**Idempotence.** Re-running with nothing changed performs no write and no transaction, and it
re-registers nothing, because the tree hash is unchanged (§6.4).

### 6.3 `uninstall`

**Uninstall first detaches both vendors, then runs the existing drained uninstall unchanged.**

`F(uninstall_artifacts)` only removes files, and the inverse recreates them from their preimages
(`apps/cli/src/lifecycle/uninstall.ts`). A block strip writes new bytes, and Spec 1 §2.4's closed
grammar has no forward/inverse pair for that. Stripping inside the coordinator would therefore
amend §2.4. Instead, `uninstall` begins with a **detach step**. The detach step is exactly the §6.2
deselection of every selected vendor, run through the same gated transaction:

1. **Unregister Codex** (§6.4) before any file changes.
2. **Remove the instruction and adapter rows in one gated Foundation transaction.**
   - Every `content` row and every plugin-tree `file` row outside the product home is removed. A
     drifted file refuses with exit 3 before any write.
   - Product-created parent directories are removed when empty.
   - **Block rows are stripped, never restored.** Spec 1 §6 step 3 restores every `existedBefore:
     true` row from its backup, and for a block that would erase every edit the user made outside
     the block since install. So a block row is handled by its current state:
     - **The current block equals base:** `replace` the file with its bytes minus the block bytes.
       A product-created file whose remainder is empty is instead a `remove`.
     - **The markers are absent:** there is nothing to strip, and the row is dropped.
     - **Anything else:** refuse with exit 3 and §5.3 evidence.
   - The whole-file backup stays in `backups/` as evidence.
3. **Drop the matching manifest rows**, and set `adapters.*` to `false`, in the same transaction.

The drained uninstall then runs exactly as shipped, over a manifest that holds only product-home
rows.

**Failure states.** If detach succeeds and the drained uninstall later fails, the home is a valid
V2 install with no vendor artifacts. Its recovery is the existing uninstall recovery, and re-running
`init --adapters …` re-attaches. The existing ordinary-command gate is unchanged. Spec 1 §2.4 and
§6 need no amendment for vendor rows, and D45's capacity (landed in `d2cc737`) is untouched.

### 6.4 Codex registration (NEW-61)

Registration is the vendor CLI's own write to its own config. It is an **unjournaled external
effect**, run outside the Foundation transaction through the security runner, with argv arrays only.
The runner's environment is exactly `{ CODEX_HOME: C }`, so the CLI registers against the same home
whose `AGENTS.md` and `agents/` the product writes. No credential is involved, so D15's `env: {}`
concern for model calls does not apply.

- **On install and reconcile.** The step runs when the installed plugin tree's aggregate hash
  differs from the hash recorded at the last successful registration, or when `codex plugin list
  --json` does not show the plugin. The recorded hash lives in a manifest-owned `schema` row
  `P/codex/registration.json`, schema id `codex-registration-v1`, which holds `{ treeHash, codexHome
  }`. The step then runs three commands in order:
  1. `codex plugin marketplace add P/codex`, only if the marketplace is absent
  2. `codex plugin add developer-os@developer-os --json`, always. This is what refreshes Codex's
     cache copy, as observed in `codex-adapter.md` §14.
  3. `codex plugin list --json`, whose `installed[].source.path` must equal the plugin root with
     `enabled: true`

  Success rewrites the registration row in a second small Foundation transaction.
- **On uninstall and deselection, before any file changes.** The step runs `codex plugin remove
  developer-os@developer-os`, then `codex plugin marketplace remove developer-os`, skipping each
  one `plugin list` shows as absent.
  - If the Codex CLI is **absent**, the step is skipped. It is reported as a warning:
    `codex registration not removed: codex CLI absent`.
  - If the CLI is present and any step fails, the command aborts with exit 1 before any mutation.

The partial states are closed:

| State | How it arises | `doctor` `codex-registration` | Recovery |
|---|---|---|---|
| tree installed, not registered | step 5 failed after commit | `fail: unregistered` | re-run `init` |
| registered, tree changed since | registration failed during a reconcile | `fail: stale` (registration row's `treeHash` differs from the current tree) | re-run `init` |
| registered, cache not reloaded | vendor behaviour | `--probe` only: `fail: cache-stale` when prompt-input bytes differ from the tree | re-run `init` |
| unregistered, tree present | the detach transaction (§6.3) failed after unregistering | `fail: unregistered` | re-run `init`, or `uninstall` again |

## 7. `doctor`

`DoctorReportV1` gains one member, following the precedent of `retainedBootstrapEvidence`:

```ts
readonly instructions: readonly InstructionStatusV1[];   // sorted by (owner, category, id)
interface InstructionStatusV1 {
  readonly owner: "claude" | "codex";
  readonly category: InstructionCategoryV1;          // includes the "vendor-file" block, source "default"
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly state: "installed" | "drifted" | "missing" | "emulated" | "unsupported-vendor";
  readonly paths: readonly string[];
}
```

- **Coverage.** Every catalog artifact, every override and the vendor's `vendor-file` block are listed once per selected vendor.
  Nothing is listed for an unselected vendor.
- **Where each state comes from.**
  - `source` and `state` for block members come from `members` and the block's own drift.
  - Multi-file artifacts aggregate their rows: any drifted row makes the artifact `drifted`.
- **Checks.** Two check ids are added, `instructions` and `codex-registration`. `instructions`
  fails on any `drifted`, `missing` or `block_malformed` state and warns on `unsupported-vendor`.
  Neither id is init-owned.
- **Human output.** It prints one line per artifact:
  `<owner> <category>/<id>: <source>, <state>`.
- **Gate evidence.** This is how the gate's "`doctor` names each as `default` or `user`" is
  observed.

## 8. Refusals and exit codes

The exit classes are the umbrella design's §8 table, unchanged. Every refusal writes nothing, names
paths only, and never echoes file content outside the redacted diff.

| Reason | Exit | When |
|---|---:|---|
| `instruction_source_invalid` | 2 | an override violates §2.3: a bound, the encoding, a symlink, `nlink`, the owner, or an unknown category |
| `instruction_block_too_large` | 2 | the rendered Codex block exceeds its bound |
| `instruction_catalog_invalid` | 2 | release catalog and files disagree (a packaging defect) |
| `instruction_target_occupied` | 3 | an unmanaged entry at a `content` target |
| `instruction_block_conflict` | 3 | §5.2, with `ConflictEvidence` in JSON output |
| `instruction_block_malformed` | 3 | §5.1 |
| `adapter_unavailable` | 4 | the selected vendor's CLI is absent, unreadable or below its floor |
| `release_mismatch` | 4 | reconcile against a release other than the installed one |
| `packaged_release_unavailable` | 4 | no admitted release (Q1); today's `fresh V2 initialization requires the admitted packaged bootstrap capability` |
| (existing path guards) | 5 | a protected path or a symlinked component |
| `codex_registration_failed` | 1 | §6.4 after commit; state per its table |
| `instruction_target_symlinked` | 5 | a symlink at any component of a §2.2 target, including a linked `CLAUDE.md` or `AGENTS.md` |
| `instruction_path_not_importable` | 2 | the product home cannot appear in a Claude `@` import line (§2.3) |

## 9. Coverage: every inventoried artifact

| Inventory | Artifacts | Claude | Codex | Status after A12 |
|---|---|---|---|---|
| §1 global rules | `communication`, `workflow`, `security`, `stack-preferences` | `rule`, imported | `rule`, in block | default, redacted (§3.3) |
| §1 path-scoped rules | `typescript`, `nextjs`, `error-handling`, `monitoring` | `scoped-rule` | emulated | default |
| §2 output styles | `architect`, `debug`, `direct-objective`, `tdd-enforcer` | `output-style` | `unsupported-vendor` | default |
| §3 commands | the 8 pairs: `analizer`, `fix-pr`, `implementator`, `przeglad-claudemd`, `release`, `rev-eng`, `spec`, `wrap-up` | thin `command`, plus the pair's skill | skill only | collapsed: one text per pair |
| §3 subagents | `code-reviewer`, `performance-engineer`, `qa-expert`, `research-analyst`, `security-auditor` | `agent` in plugin | generated TOML | default |
| §3 skills (other 11) | `bug-triage`, `claudeception`, `client-onboarding`, `code-review`, `deploy-checklist`, `nextjs-removeconsole-computed-access-survives`, `react-best-practices`, `recovering-killed-claude-workflow-results`, `url-construction-silent-footguns`, `weekly-report`, plus `brain-search` | `skill` | `skill` | default. `brain-search` maps to the product workflow `developer-os-brain-search` (inventory: partial); `react-best-practices` depends on its license (§3.3) |
| §3 vendor instruction files | global Claude instruction file, Codex `AGENTS.md` | block | block | `vendor-file` |
| §6 global instruction file template | the legacy import lines | replaced by the §5 block | — | covered by `vendor-file` |
| §6 other templates | project templates; vendor settings; dev-docs; loop and CI templates; pilot documents | — | — | unchanged from inventory: A14, refused (reporting only), refused, refused, refused |
| §7 research skills | six skills | `skill` | `skill` | per Q3 |

**Skill text rule.** `claudeception`'s default text must direct newly authored skills to
`<P>/instructions/<vendor>/skills/`, so that they become managed `user` artifacts instead of
unmanaged files in a vendor directory.

**Gate count.** Inventory §3's arithmetic gives 38: 36 instruction artifacts plus the 2 vendor
instruction files. Of the 36, 35 are rendered and `brain-search` is the product workflow. The count
becomes 44 under Q3 option A.

**Amended 2026-09-26 (NEW-108, D51).** The count that shipped is **33 catalog rows**
(`instructions/catalog.json`; `tests/repository/instruction-coverage.test.ts` derives the same set from
the inventory, `dfd2a3d`). D51 refused `release`, `rev-eng`, `wrap-up`, `brain-search`,
`react-best-practices` and `claudeception` and every §7 research skill, so Q3 adds nothing; D51 added
the three scoped rules `comments`, `testing` and `lessons-code`. The 33 are 4 rules, 7 scoped rules,
4 output styles, 5 agents and 13 skills, 5 of them with a thin Claude command. The two vendor
instruction files are the blocks, not catalog rows.

## 10. Verification gates

### 10.1 Plan Task 1: vendor observations (a precondition for every other task)

Task 1 runs against the pinned Claude Code 2.1.280 and Codex CLI 0.155.1, in disposable homes, and
records each result as a dated section in the adapter notes. If any row fails, the plan stops for a
founder decision. For every row of §4, it pins:
- the exact loading-proof command and the output fragment that proves the row
- whether a skills-directory plugin loads `agents/` and `commands/`
- whether `H/.claude/rules/*.md` loads without `paths:`, and with `paths:`
- whether Claude's observed `InstructionsLoaded` hook event (`claude-adapter.md` §13), attached
  to a disposable home, proves unbilled that the `CLAUDE.md` block imports and the `rules/` and
  `output-styles/` files load. Task 1 tries it first. Anything it cannot prove falls to the billed
  row in §10.2, and invariant 3 requires that row to pass before the artifact is installed.
- how output styles are discovered
- Codex's agent TOML key set, and whether Codex loads `C/agents/*.toml`
- whether `codex debug prompt-input` includes `C/AGENTS.md`, and its size limit
- whether `plugin add` over a registered plugin refreshes the cache

Nothing in this document encodes those facts from recall.

### 10.2 Gates

| Gate | Required evidence |
|---|---|
| manifest arms are exact | strict round-trip and refusal fixtures for both `instruction` arms: every key, `members` bounds, order and uniqueness, restore rules per arm, a `marked-block` strategy on any other arm, a second block row per owner; `block_malformed` drift |
| authorization is closed | each §2.2 row admits only its owner and arm; a neighbouring path, a wrong owner, a wrong arm, a `..` segment and a symlink at every component refuse; the product-home and Brain rules are unchanged |
| sources are bounded | first-over-limit fixtures for every §2.3 row; a symlinked, hard-linked, foreign-owned or BOM/NUL override refuses with path only; an unlisted default file and a listed-but-missing file refuse |
| render is deterministic | two renders and a reversed reader are byte-identical per vendor; override precedence replaces a whole skill directory; `plugins/{claude,codex}/` drift tests cover the default render |
| block merge is exact | every §5.2 row; bytes outside the block are identical before and after, for files with and without a trailing LF, CRLF content outside the block, and a block in the middle of the file; an unedited file round-trips byte-exact through install and uninstall, apart from §5.1's one persisting LF; a concurrent edit between plan and write refuses through `expectedBeforeHash` |
| conflict evidence | the block arm reports all three hashes and a redacted two-way diff; oversized and binary notices; the V1 arm is unchanged |
| init installs (NEW-60) | `--adapters claude,codex` on a synthetic packaged release installs every §9 artifact; `none` installs nothing in either vendor home; an unavailable CLI refuses before mutation; an instruction failure does not revert the handoff |
| reconcile | an override add, change and removal each converge in one re-run; an unchanged re-run writes nothing and re-registers nothing; deselection strips and unregisters; `release_mismatch` refuses |
| uninstall | detach runs before the drained uninstall, which then sees only product-home rows; every vendor row is removed; a block is stripped, never restored, and a product-created empty file is deleted; a pre-existing file keeps post-install user edits outside the block; a drifted file or edited block refuses exit 3 before any write; product-created parents are removed only when empty; overrides are preserved; a fresh `init` after `uninstall` admits `instructions/` |
| Codex registration (NEW-61) | every §6.4 table state is reachable by fault injection and reported as tabled; uninstall runs unregistration before any file mutation; an absent CLI is a warning |
| loading is asserted (NEW-65) | `tests/integration/claude/plugin-loads.test.ts` asserts `claude plugin details developer-os` lists every skill, agent and command by name; `tests/integration/codex/plugin-loads.test.ts` asserts `codex debug prompt-input` contains every skill and the block, and that an in-place override change is invisible before re-registration and visible after it |
| ingest stays isolated (D8) | with every instruction installed in a disposable home, each vendor's ingest argv yields a prompt input containing neither block marker nor any managed file's text (the method is pinned by Task 1). A failure stops the plan: D8 outranks A12 |
| doctor names every artifact | `instructions` lists each §9 artifact per selected vendor with its `source`; a user override flips exactly its row to `user`; drift, missing, emulated and unsupported states are each produced |
| defaults are redacted | the CI scan is green; the founder-local scan count is recorded in the commit; an injected e-mail, home path or legacy-runtime path fails the CI scan |
| coverage is exhaustive | the catalog's `legacyName` set equals the inventory §1–§3 names minus `brain-search` (plus §7's six if Q3 is A); every §6 row has a status |
| real agent (billed; a founder stop condition for model credits) | for each mechanism Task 1 could not prove unbilled, one Claude session proving the text reached the model; recorded in the compatibility matrix and required before that category installs (invariant 3) |

Under D32, the slow files (`*.v2.test.ts`, `tests/integration/**`, `tests/e2e/**`) run at plan
close. Each task still runs the cases it adds, red then green.

## 11. Amendments this design makes to existing documents

These amendments take effect when this design is approved. Each is marked "Amended <date> (A12)" in
place.

**Applied.** The `claude-adapter.md`, `codex-adapter.md` and `threat-model.md` rows on 2026-09-22
("Amended 2026-09-22 (A12)", threat-model §5.14 "Added 2026-09-22 (A12)"); the umbrella design, Spec 1
and Spec 2 rows on 2026-09-26 ("Amended 2026-09-26 (A12 §11, D47)"), together with Spec 2 §5's
`codex-registration-v1` schema ID.

| Document | Clause | Change |
|---|---|---|
| umbrella design | §9.1 steps 2 and 7 | adapter selection is `--adapters`, with a default of `none`; the instruction install runs after the handoff and is not init-owned |
| umbrella design | §9.3 | three hashes plus a two-way diff (§5.3) |
| umbrella design | §9.4 | block rows are stripped, never restored |
| Spec 1 | §6 | `instructions/` is user data in the absent-manifest walk and the ledger. The removable partition and §2.4's grammar are unchanged, because the detach step (§6.3) runs first |
| Spec 2 | §6.1, and `settleExistingV2` in `init` | `init` on an installed V2 home reconciles instruction artifacts (§6.2) instead of only asserting no drift (Q2 option A) |
| Spec 2 | §6.1 | `admittedPreexistingPaths` admits `instructions`; schema id `codex-registration-v1`. Under Q1 option A, also the §3 trust state `unsigned-local` |
| `claude-adapter.md` | §2.2, §2.3 | writes outside `H/.claude/skills/developer-os/` only to the §2.2 rows; still writes no settings key and selects no output style |
| `claude-adapter.md` | §9.8 | closed: `buildConflictEvidence` has its consumer |
| `codex-adapter.md` | §2.2 | the product writes one marked block in `C/AGENTS.md` and never `AGENTS.override.md`; `durable_project_guidance` stays `not-used` (the block is user-scope, not project guidance) |
| `codex-adapter.md` | §11.9 and §11.14 | both closed by §5.3 and §6.4 |
| `threat-model.md` | new §5.14 | see §11.4 below |

### 11.4 Threat-model entry: instruction artifacts steer every agent session

Installed instructions change what both vendors' agents do on every session on the machine. Their
integrity therefore equals the integrity of their sources.

- **Defaults.** Defaults are exactly as trustworthy as the admitted release. Under Q1 option A, that
  is a local build, which is recorded and reported.
- **User overrides.** Overrides are trusted as the user's own text. They are read with no-follow
  guards and bounds, and they are written only to the §2.2 paths.
- **What the product cannot defend.** The product cannot defend against a process that rewrites the
  release or the overrides with the user's privileges. This matches `threat-model.md`'s existing
  local-write boundary.
- **Vendored skills.** Third-party skills (`react-best-practices`) are prompt text from outside this
  repository. They are reviewed as content at every change, like any default.

## 12. Produced interfaces, sequence, and residuals

### 12.1 Produced interfaces

| Interface | Owner |
|---|---|
| `InstructionCategoryV1`, `InstructionIdentityV1`, `InstructionBlockMemberV1`, the two `instruction` arms, `marked-block`, `block_malformed` | `packages/core/src/manifest/` |
| `InstructionCatalogV1`, `InstructionBoundsV1`, the source loaders | `packages/core` for schemas; the loaders sit behind the CLI composition root |
| the block grammar, extraction and strip (pure, shared by both vendors) | `packages/core/src/manifest/` beside drift, because drift needs it |
| `renderInstructionTree`, V2-typed `propose*Install`/`propose*Uninstall` | each adapter package |
| owner-aware `createOwnerPathAdmission` | `apps/cli/src/bootstrap/admission.ts` |
| `InstructionStatusV1` and the `DoctorReportV1.instructions` member | `apps/cli/src/commands/doctor.ts` |
| `init --adapters`, reconcile, and the uninstall additions | `apps/cli/src/commands/init.ts`, `apps/cli/src/lifecycle/uninstall.ts` |

The adapters still never import one another, and Core imports no adapter. Rendering stays in the
adapters, and the block grammar stays in Core.

### 12.2 Required sequence

1. The founder answers Q1–Q3. A fresh-context review of this document follows.
2. Write the plan. Task 1 (vendor observations) comes first. Then the manifest arms plus the
   authorization, then the sources plus the catalog, then the renderers and the block, then `init`
   (NEW-60), uninstall, registration (NEW-61), `doctor`, the integration assertions (NEW-65), and
   finally the default content with redaction. The content task can run in parallel from the start,
   because the founder is in that loop.
3. The A12 gate closes on synthetic packaged releases. Reaching the founder's machine waits on Q1.

### 12.3 Accepted residuals

1. **A default cannot be disabled, only replaced** (§3.2). Replacing it with a one-line override is
   the workaround. Owner: the first user request.
2. **`CLAUDE_CONFIG_DIR` is not followed** (§2.2). `doctor` warns instead. Owner: DOS-P9's
   supported-configuration matrix.
3. **Claude rule and output-style loading may lack an unbilled observer**, if Task 1's `InstructionsLoaded` probe does not prove it. The `rule`, `scoped-rule` and
   `output-style` rows are proven only by the billed real-agent row. CI proves placement and hashes.
   Owner: the compatibility matrix (DOS-P9).
4. **Codex registration is unjournaled.** Its partial states are closed and reported (§6.4), but a
   crash between the Foundation commit and registration leaves an unregistered tree until the next
   `init`.
5. **The conflict diff is two-way** (§5.3). The base block's bytes are not retained.
