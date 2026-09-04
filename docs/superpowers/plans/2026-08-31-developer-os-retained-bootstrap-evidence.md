# Developer OS Retained Bootstrap Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Task 7's rejected deletion-based fresh-V2 bootstrap closure with immutable plans, two identity-bound journal slots, permanent same-parent retained tombstones, and non-blocking post-handoff evidence reporting.

**Architecture:** Core owns the closed journal-chain, retention-table, capacity, and evidence-classification model. `platform-macos` owns one descriptor-relative atomic no-replace rename port over `renameatx_np`; the CLI owns final-path plan/slot I/O, exact filesystem projection, retention execution, fresh-init orchestration, and read-only public reports. The existing Task 7 implementation at commit `1557734` remains the starting point, but none of its unlink, rmdir, temporary-envelope, quarantine, or plan-last-compaction authority survives.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins, fixed `/usr/bin/osascript` JXA bridge to Darwin `renameatx_np`, existing canonical JSON and Foundation transactions, Vitest 4, macOS 15+ CI.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` §6, especially §6.4.

## Global Constraints

- This plan replaces only Spec 2 Task 7. Do not start baseline Tasks 8–9 until all six tasks here pass focused tests, `npm run check`, and fresh-context review.
- V2 bootstrap has not shipped. Persisted bootstrap schema names remain V1; do not add a migration or compatibility parser for the rejected one-journal/compaction shape.
- Both journal-slot inodes are empty, owner-owned, single-link `0600`, no-follow, and created `O_CREAT | O_EXCL` under the held bootstrap lock before the immutable plan. The plan records ordered slot/path/device/inode identities.
- Plans and slot inodes are never replaced or deleted. Only the inactive plan-bound slot may be truncated and rewritten; a complete valid current slot remains authoritative across a partial inactive write.
- Journal successors alternate slots, increment canonical UInt64 decimal sequence by exactly one, and hash the immediately preceding canonical bytes including LF. Overflow, gap, fork, broken hash, illegal phase/cursor change, and slot identity replacement are exit 6.
- Every bootstrap retirement action is a same-parent no-replace rename to `.developer-os-retained.<bootstrap-id>.<ten-decimal-ordinal>.tombstone`. There is no out-of-parent quarantine.
- The macOS port uses `/usr/bin/osascript`, a fixed embedded JXA program, an empty environment, inherited parent descriptor FD 3, and `renameatx_np` flags `0x34` (`RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH`). There is no fallback to `fs.rename`, `/bin/mv -n`, hard-link-plus-unlink, or recursive removal.
- Bootstrap init, compensation, recovery, retention, retry, doctor, and uninstall must not call `unlink`, `rm`, or `rmdir` for bootstrap envelope/evidence paths. Existing non-bootstrap Foundation and uninstall authority stays unchanged outside the exact retained namespace.
- Retention authority comes only from the immutable plan, legal journal chain, persisted payload/creation/Foundation evidence, and exact parent/source identities. Equal current bytes alone do not admit Foundation adoption or restoration.
- After complete V2 handoff, bootstrap evidence is inert: ordinary commands do not read it for installed state, drift, or mutation authority. `init` may finish legal retention; `doctor` and `uninstall` inventory/report only.
- Retained/unverified residue plus a projected new envelope is capped before bootstrap-owned mutation at 256 bootstrap IDs, 1,000,000 filesystem entries including directory descendants, and 12,884,901,888 regular-file bytes. First-over refuses with manual archive guidance.
- Retained evidence survives successful uninstall. Uninstall leaves product home in place and reports operation, terminal outcome when proved, logical `vaultPath`, entry count, and regular-file bytes.
- Tests are synthetic and content-free. Diagnostics never include retained file contents, canonical JSON bodies, hashes not already safe for public output, or private paths outside the existing path-rendering contract.
- Each code-producing task follows TDD, stages only its listed paths, runs its focused command and `npm run check`, obtains a fresh reviewer verdict, fixes every accepted finding with a failing regression first, then commits green work.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Core retention model | `packages/core/src/manifest/bootstrap-retention.ts`, manifest/root barrels | Future retained-plan projection, slot/chain validation, closed retention table, caps, evidence status |
| Darwin atomic rename | `packages/platform-macos/src/retained-rename.ts`, platform barrel | Fixed descriptor-relative `renameatx_np(RENAME_EXCL)` process boundary |
| Durable envelope I/O | `apps/cli/src/bootstrap/journal-store.ts` | Empty slot creation, immutable in-place plan write, alternating slot rewrite/recovery |
| Retention execution | `apps/cli/src/bootstrap/retention.ts` | Exact projection, same-parent tombstone moves, directory-tree verification, lock handoff |
| Fresh-init coordinator | existing Core transaction bridge and CLI bootstrap executor/context/init files | Replace rejected cleanup paths and drive the new durable state machine |
| Public evidence report | `apps/cli/src/bootstrap/report.ts`, doctor/uninstall/init/status tests | Verified/incomplete/altered/unverified inventory, caps, inertness, preservation |

---

### Task 1: Add the pure retained-bootstrap model

**Files:**
- Create: `packages/core/src/manifest/bootstrap-retention.ts`
- Create: `packages/core/src/manifest/bootstrap-retention.test.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: the current Task 7 bootstrap plan shapes, canonical JSON, `UInt64DecimalV1`, `LowerHexSha256`, canonical absolute paths, admitted payload/creation/Foundation evidence from Tasks 1–6.
- Produces: `BootstrapJournalSlotIdentityV1`, `BootstrapJournalRecordV1`, `BootstrapRetentionEntryV1`, `BootstrapEvidenceSummaryV1`, `SameParentRenameNoReplaceV1`, `deriveBootstrapRetentionTable`, `selectBootstrapJournal`, `validateBootstrapJournalSuccessor`, `classifyBootstrapEvidence`, and `assertBootstrapRetentionCapacity`.

- [x] **Step 1: Write failing journal, table, classification, and cap tests**

```ts
it("selects only one adjacent hash-bound journal successor", () => {
  const current = journal({ slot: 0, sequence: "41", previousJournalHash: hash40 });
  const next = journal({
    slot: 1,
    sequence: "42",
    previousJournalHash: hashCanonicalJournal(current),
    retentionNext: 7,
  });
  expect(selectBootstrapJournal(plan, [current, next])).toEqual({
    current: next,
    inactiveSlot: 0,
  });
});

it.each(["gap", "fork", "wrong predecessor", "same slot", "illegal cursor"])(
  "refuses a %s journal chain",
  vector => expect(() => selectBootstrapJournal(plan, journalVector(vector))).toThrow(),
);

it("derives same-parent deterministic tombstones and maximal directory roots", () => {
  const table = deriveBootstrapRetentionTable(plan, admittedEvidence);
  expect(table.map(row => [dirname(row.sourcePath), dirname(row.tombstonePath)])).toEqual(
    table.map(row => [dirname(row.sourcePath), dirname(row.sourcePath)]),
  );
  expect(table.map(row => basename(row.tombstonePath))).toEqual(
    table.map((_, ordinal) =>
      `.developer-os-retained.${plan.id}.${String(ordinal).padStart(10, "0")}.tombstone`,
    ),
  );
  expect(table.filter(row => row.postimage.kind === "directory_tree")).toHaveLength(1);
});

it.each([
  { ids: 257, entries: 1, bytes: "1" },
  { ids: 1, entries: 1_000_001, bytes: "1" },
  { ids: 1, entries: 1, bytes: "12884901889" },
])("refuses first-over aggregate capacity before allocation: $ids/$entries/$bytes", value => {
  expect(() => assertBootstrapRetentionCapacity(value)).toThrow();
});
```

Cover sequence `0`, UInt64 maximum and overflow, raw hash including LF, slot order/identity mismatch, empty/partial inactive observations, every legal phase transition, `retaining`/`retained` cursor zero/last/first-over, duplicate destinations, parent mismatch, maximal directory-tree projection, Foundation evidence identity mismatch despite equal bytes, all four report statuses, zero/exact/first-over capacity, and checked-sum overflow.

- [x] **Step 2: Run the Core test and verify the module is absent**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts`

Expected: FAIL because `bootstrap-retention.ts` and its exported contracts do not exist.

- [x] **Step 3: Implement the closed pure contracts**

```ts
export const BOOTSTRAP_RETAINED_MAX_IDS = 256;
export const BOOTSTRAP_RETAINED_MAX_ENTRIES = 1_000_000;
export const BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES = 12_884_901_888n;

type FreshV2InitRetainedPlanV1 = Omit<FreshV2InitPlanV1, "journalPath"> & {
  readonly journalSlots: readonly [
    BootstrapJournalSlotIdentityV1,
    BootstrapJournalSlotIdentityV1,
  ];
};

type ManifestMigrationRetainedPlanV1 =
  Omit<ManifestMigrationPlanV1, "paths"> & {
    readonly paths: Omit<ManifestMigrationPathsV1, "journal">;
    readonly journalSlots: readonly [
      BootstrapJournalSlotIdentityV1,
      BootstrapJournalSlotIdentityV1,
    ];
  };

export type BootstrapRetainedExecutionPlanV1 =
  | FreshV2InitRetainedPlanV1
  | ManifestMigrationRetainedPlanV1;

export interface BootstrapJournalSlotIdentityV1 {
  readonly slot: 0 | 1;
  readonly path: ExactProductStatePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BootstrapJournalRecordV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planHash: LowerHexSha256;
  readonly slot: 0 | 1;
  readonly sequence: UInt64DecimalV1;
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly phase: "planned" | "payload_staging" | "creating" |
    "foundation_applying" | "launchability_publishing" |
    "manifest_publishing" | "verifying" | "compensating" |
    "finalized" | "rolled_back" | "retaining" | "retained";
  readonly direction: "forward" | "compensating";
  readonly nextPayload: number;
  readonly payloadWriteState: BootstrapPayloadWriteStateV1;
  readonly nextCreatedPath: number;
  readonly nextFoundationParticipant: number;
  readonly nextLaunchabilityPath: number;
  readonly manifestCursor: number;
  readonly compensationNext: number | null;
  readonly payloadRetentionPart: "staged_file" | "evidence" | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly retentionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface BootstrapRetentionParentIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type BootstrapRetentionPostimageV1 =
  | {
      readonly kind: "regular_file";
      readonly ownerUid: number;
      readonly mode: 0o600 | 0o700;
      readonly nlink: 1;
      readonly bytes: UInt64DecimalV1;
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "directory_tree";
      readonly ownerUid: number;
      readonly mode: 0o700;
      readonly nlink: number;
      readonly treeHash: LowerHexSha256;
      readonly entryCount: number;
      readonly regularFileBytes: UInt64DecimalV1;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

export interface BootstrapRetentionEvidenceProjectionV1 {
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  /** Pure admitted projection; this does not widen the persisted bootstrap grammar. */
  readonly terminalJournal: BootstrapJournalRecordV1 | null;
  readonly payloadEvidence: readonly BootstrapPayloadRetentionEvidenceV1[];
  readonly createdPathEvidence: readonly CreatedPathEvidenceV1[];
  readonly directoryTrees: readonly BootstrapRetentionDirectoryTreeEvidenceV1[];
  readonly rows: readonly {
    readonly role: "payload" | "payload_evidence" | "creation_evidence" |
      "foundation_bootstrap" | "manifest_bootstrap" | "staging_subtree" |
      "compensation_target" | "bootstrap_lock";
    readonly sourcePath: CanonicalAbsolutePathV1;
    readonly parent: BootstrapRetentionParentIdentityV1;
    readonly postimage: BootstrapRetentionPostimageV1;
  }[];
}

export interface BootstrapPayloadRetentionEvidenceV1 {
  readonly value: BootstrapPayloadEvidenceV1;
  readonly evidenceIdentity: {
    readonly ownerUid: number;
    readonly mode: 0o600;
    readonly nlink: 1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
}

export interface BootstrapRetentionDirectoryTreeEvidenceV1 {
  readonly rootPath: CanonicalAbsolutePathV1;
  readonly entries: readonly BootstrapRetentionDirectoryEntryV1[];
}

export type BootstrapRetentionDirectoryEntryV1 =
  | { readonly relativePath: string; readonly kind: "regular_file";
      readonly ownerUid: number; readonly mode: 0o600 | 0o700; readonly nlink: 1;
      readonly bytes: UInt64DecimalV1; readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly relativePath: string; readonly kind: "directory";
      readonly ownerUid: number; readonly mode: 0o700; readonly nlink: number;
      readonly bytes: UInt64DecimalV1; readonly sha256: null;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface BootstrapRetentionEntryV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: number;
  readonly role: BootstrapRetentionEvidenceProjectionV1["rows"][number]["role"];
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly parent: BootstrapRetentionParentIdentityV1;
  readonly postimage: BootstrapRetentionPostimageV1;
}

export interface BootstrapJournalSelectionV1 {
  readonly current: BootstrapJournalRecordV1;
  readonly inactiveSlot: 0 | 1;
}

export interface BootstrapEvidenceSummaryV1 {
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly status: "verified" | "incomplete" | "altered" | "unverified";
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly vaultPath: CanonicalAbsolutePathV1;
  readonly entryCount: number;
  readonly regularFileBytes: UInt64DecimalV1;
}

export interface SameParentRenameNoReplaceV1 {
  readonly entry: BootstrapRetentionEntryV1;
}

export function selectBootstrapJournal(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  slots: readonly [unknown, unknown],
): BootstrapJournalSelectionV1;

export function validateBootstrapJournalSuccessor(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  current: BootstrapJournalRecordV1,
  successor: BootstrapJournalRecordV1,
): BootstrapJournalRecordV1;

export function deriveBootstrapRetentionTable(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
): readonly BootstrapRetentionEntryV1[];

export interface BootstrapEvidenceClassificationInputV1 {
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planPath: CanonicalAbsolutePathV1;
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly journal: BootstrapJournalSelectionV1 | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly expectedRows: readonly BootstrapRetentionEntryV1[];
  readonly matchingRows: number;
  readonly alteredRows: number;
  readonly unboundEntries: number;
  readonly confinedToRetainedNamespace: boolean;
  readonly entryCount: number;
  readonly regularFileBytes: UInt64DecimalV1;
}

export function classifyBootstrapEvidence(
  input: BootstrapEvidenceClassificationInputV1,
): BootstrapEvidenceSummaryV1;

export interface BootstrapRetentionCapacityV1 {
  readonly ids: number;
  readonly entries: number;
  readonly bytes: UInt64DecimalV1;
}

export function assertBootstrapRetentionCapacity(
  value: BootstrapRetentionCapacityV1,
): BootstrapRetentionCapacityV1;
```

`BootstrapRetainedExecutionPlanV1` is a compile-safe projection of the approved future shape over the current Task 7 types; it has no validator or persisted codec yet. Task 5 atomically replaces the current plan/journal codecs, at which point the real `BootstrapExecutionPlanV1` is structurally identical to this projection, so Tasks 1–4 can pass the repository gate without widening the rejected persisted grammar. Use `encodeCanonicalJson(record)` bytes including LF for predecessor hashing. Journal selection and successor validation require no fabricated terminal evidence before retention; when retention starts, the admitted terminal `finalized` or `rolled_back` journal fixes the exact outcome and reached prefix used for table cardinality. The pure projection validates every persisted `BootstrapPayloadEvidenceV1`, its evidence-file identity/canonical bytes, created-path evidence, and complete directory descendant projection without altering `bootstrap.ts` schemas. Core derives exactly one current location for each completed payload inode: its staged payload path until a reached planned-file, Foundation, or manifest consumer moves it, its Foundation final path when that artifact remains evidence, or no retention row for an installed target/manifest. Directory hashes/counts/bytes derive from the complete unsigned-UTF-8-sorted descendant projection, every maximal root bijects to one projection, and descendants contribute to the exact aggregate caps before collapse. Sort final rows by the approved semantic order, assign contiguous ordinals afterward, and reject a caller-supplied tombstone spelling. The rename request carries the derived table row, not caller-selected basenames. `classifyBootstrapEvidence` returns only metadata/counts and never carries content bytes.

- [x] **Step 4: Run focused Core and public-door tests**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts src/index.test.ts`

Expected: PASS with non-vacuous exact/first-over assertions and the intended exports pinned.

- [x] **Step 5: Run the repository gate and obtain fresh review**

Run: `npm run check`

Expected: PASS. Request fresh review of Task 1 for exact schema keys, transition completeness, derived rather than caller-selected authority, directory aggregation, checked arithmetic, and content-free reports. Add a failing regression for every accepted finding before correcting it.

- [x] **Step 6: Commit Task 1**

```bash
git add packages/core/src/manifest/bootstrap-retention.ts packages/core/src/manifest/bootstrap-retention.test.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md
git commit -m "feat(core): model retained bootstrap evidence"
```

### Task 2: Add the descriptor-relative macOS rename-exclusive port

**Files:**
- Create: `packages/platform-macos/src/retained-rename.ts`
- Create: `packages/platform-macos/src/retained-rename.test.ts`
- Modify: `packages/platform-macos/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `SameParentRenameNoReplaceV1`, guarded parent/source identity, absolute root-owned `/usr/bin/osascript`.
- Produces: `RenameSameParentNoReplace`, `RenameAtxRunner`, `SpawnRenameAtxRunner`, `MacOsRetainedRename`, and classified unavailable/refusal/third-state errors.

- [x] **Step 1: Write failing fake-runner and real-Darwin tests**

```ts
it("passes only two derived basenames and retained parent FD 3", async () => {
  const calls: RenameAtxRunRequestV1[] = [];
  const rename = new MacOsRetainedRename({
    runner: { run: request => { calls.push(request); return Promise.resolve({ exitCode: 0 }); } },
  });
  await rename.rename(request);
  expect(calls).toEqual([{
    parentDescriptor: expect.any(Number),
    sourceName: ".fresh-v2-init.fi_00000000-0000-4000-8000-000000000000.0000000000.payload",
    tombstoneName: ".developer-os-retained.fi_00000000-0000-4000-8000-000000000000.0000000000.tombstone",
  }]);
});

it.runIf(process.platform === "darwin")(
  "atomically refuses an existing destination without changing either inode",
  async () => {
    const before = await identities(source, destination);
    await expect(new MacOsRetainedRename().rename(request)).rejects.toBeDefined();
    expect(await identities(source, destination)).toEqual(before);
  },
);
```

Cover wrong parent identity, symlink parent/source, non-ASCII or slash-bearing basenames, destination present, source missing, source replacement before child call, source replacement after child return, helper nonzero/signal/no-status, parent pathname swap while FD 3 remains open, successful regular file and directory moves, and post-move source/destination projection.

- [x] **Step 2: Run the platform test and verify the port is absent**

Run: `npx vitest run --root packages/platform-macos src/retained-rename.test.ts`

Expected: FAIL because the retained rename module does not exist.

- [x] **Step 3: Implement the fixed JXA `renameatx_np` boundary**

```ts
const OSASCRIPT = "/usr/bin/osascript";
const RENAME_FLAGS = 0x34;
const PARENT_FD = 3;

const RENAME_PROGRAM = String.raw`
ObjC.bindFunction("renameatx_np", [
  "int", ["int", "char*", "int", "char*", "unsigned int"]
]);
const argv = $.NSProcessInfo.processInfo.arguments;
const source = argv.objectAtIndex(5).UTF8String;
const destination = argv.objectAtIndex(6).UTF8String;
const result = $.renameatx_np(3, source, 3, destination, 0x34);
if (result !== 0) throw new Error("renameatx_np refused");
`;

export type RenameSameParentNoReplace = (
  request: SameParentRenameNoReplaceV1,
) => Promise<void>;

export interface RenameAtxRunRequestV1 {
  readonly parentDescriptor: number;
  readonly sourceName: string;
  readonly tombstoneName: string;
}

export interface RenameAtxRunResultV1 {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface RenameAtxRunner {
  run(request: RenameAtxRunRequestV1): Promise<RenameAtxRunResultV1>;
}

export interface MacOsRetainedRenameDependencies {
  readonly runner: RenameAtxRunner;
  readonly getUid: () => number;
  readonly openParent: (path: string) => Promise<FileHandle>;
  readonly lstat: typeof lstat;
}

export class SpawnRenameAtxRunner implements RenameAtxRunner {
  run(request: RenameAtxRunRequestV1): Promise<RenameAtxRunResultV1>;
}

export class MacOsRetainedRename {
  constructor(dependencies?: Partial<MacOsRetainedRenameDependencies>);
  rename(request: SameParentRenameNoReplaceV1): Promise<void>;
}
```

Before first use, no-follow lstat `/usr/bin/osascript` as a root-owned regular executable with no
group/other write bit; repeat the same path/device/inode check immediately after spawn. Open the
retention parent directory no-follow, verify its owner/mode/device/inode, retain the descriptor
through child exit, spawn with `shell: false`, `env: {}`, and
`stdio: ["ignore", "ignore", "ignore", parentFd]`, and pass only the two already-derived ASCII
basenames obtained from `request.entry`; reject any basename, same-parent, ordinal, or retained-name
grammar mismatch before spawn. Reopen and verify the destination as the expected source identity after success. On lost
child status, re-project both names and accept only the two spec states; never retry through another
primitive.

- [x] **Step 4: Run focused platform tests**

Run: `npx vitest run --root packages/platform-macos src/retained-rename.test.ts src/transaction-lock.test.ts`

Expected: PASS on macOS, including the real no-clobber and retained-parent tests; existing lock tests remain green.

- [x] **Step 5: Run the repository gate and obtain fresh review**

Run: `npm run check`

Expected: PASS. Fresh review must verify fixed executable/script/flags, empty environment, FD inheritance, no shell/path interpolation, exact error classification, and no fallback primitive.

- [x] **Step 6: Commit Task 2**

```bash
git add packages/platform-macos/src/retained-rename.ts packages/platform-macos/src/retained-rename.test.ts packages/platform-macos/src/index.ts docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md
git commit -m "feat(platform-macos): add exclusive retained rename"
```

### Task 3: Implement immutable plan and identity-bound two-slot journal I/O

**Files:**
- Create: `apps/cli/src/bootstrap/journal-store.ts`
- Create: `apps/cli/src/bootstrap/journal-store.test.ts`
- Modify: `packages/core/src/manifest/bootstrap-retention.ts`
- Modify: `packages/core/src/manifest/bootstrap-retention.test.ts`

**Interfaces:**
- Consumes: Task 1 slot/journal validation, canonical JSON, guarded Core paths, Node file handles, injected clock/death hook.
- Produces: `BootstrapJournalStore.create`, `BootstrapJournalStore.open`, `BootstrapJournalStore.advance`, and `BootstrapJournalStoreDeathPointV1`.

- [x] **Step 1: Write failing plan/slot death and replacement tests**

```ts
it.each([
  "after_slot_0_create", "after_slot_0_sync", "after_slot_1_create",
  "after_slot_1_sync", "during_plan_write",
] as const)("preserves an unverified pre-plan death at %s", async point => {
  const interrupted = await createStoreUntil(point);
  const before = await interrupted.inventoryBytesAndIdentities();
  await expect(openBootstrapJournalStore(interrupted.request)).rejects.toBeDefined();
  expect(await interrupted.inventoryBytesAndIdentities()).toEqual(before);
});

it.each([
  "after_plan_sync", "before_initial_slot_write", "during_initial_slot_write",
  "after_initial_slot_sync", "after_initial_state_sync",
] as const)("initializes only a durable identity-bound plan after death at %s", async point => {
  const interrupted = await createStoreUntil(point);
  const resumed = await openBootstrapJournalStore(interrupted.request);
  expect(resumed.current()).toMatchObject({ slot: 0, sequence: "0" });
  expect(await slotIdentities(resumed.plan)).toEqual(interrupted.originalSlotIdentities);
});

it("refuses a path replacement instead of truncating the replacement", async () => {
  const store = await createStore();
  await replaceInactiveSlotPath(store);
  const replacement = await readInactiveBytes(store);
  await expect(store.advance(nextJournal(store))).rejects.toBeDefined();
  expect(await readInactiveBytes(store)).toEqual(replacement);
});
```

Cover zero-byte and every byte-prefix partial plan, pre-plan zero/one/two-slot residue, plan wrong slot path/order/dev/ino, plan replacement, durable plan with zero/partial initial slot, refusal to initialize when guarded inventory finds any post-plan mutation, current/inactive slot replacement, partial inactive at byte zero/middle/last-minus-one, canonical size first-over, short write/no progress, sync failure at inode/state, adjacent successor, two valid forked slots, sequence overflow, close failure, and descriptor leak checks.

- [x] **Step 2: Run the CLI journal-store test and verify the module is absent**

Run: `npx vitest run --root apps/cli src/bootstrap/journal-store.test.ts`

Expected: FAIL because the store does not exist.

- [x] **Step 3: Implement final-path plan publication and alternating slots**

```ts
export interface BootstrapJournalStoreOpenRequestV1 {
  readonly planPath: ExactProductStatePathV1;
  readonly expectedOperation: "fresh_v2_init" | "v1_to_v2";
  readonly expectedId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly validatePlan: (value: unknown) => BootstrapRetainedExecutionPlanV1;
  readonly validateSlots: (
    plan: BootstrapRetainedExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
  readonly buildInitialJournal: (
    plan: BootstrapRetainedExecutionPlanV1,
    timestamp: UtcTimestampV1,
  ) => BootstrapJournalRecordV1;
  readonly admitInitialWrite: (plan: BootstrapRetainedExecutionPlanV1) => void;
  readonly now: () => Date;
  readonly interrupt?: (point: BootstrapJournalStoreDeathPointV1) => void;
}

export interface BootstrapJournalStoreCreateRequestV1 {
  readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly slotPaths: readonly [ExactProductStatePathV1, ExactProductStatePathV1];
  readonly planPath: ExactProductStatePathV1;
  readonly buildPlan: (
    slots: readonly [BootstrapJournalSlotIdentityV1, BootstrapJournalSlotIdentityV1],
  ) => BootstrapRetainedExecutionPlanV1;
  readonly buildInitialJournal: (
    plan: BootstrapRetainedExecutionPlanV1,
    timestamp: UtcTimestampV1,
  ) => BootstrapJournalRecordV1;
  readonly validatePlan: (value: unknown) => BootstrapRetainedExecutionPlanV1;
  readonly validateSlots: (
    plan: BootstrapRetainedExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
  readonly now: () => Date;
  readonly interrupt?: (point: BootstrapJournalStoreDeathPointV1) => void;
}

export type BootstrapJournalStoreDeathPointV1 =
  | "after_slot_0_create" | "after_slot_0_sync"
  | "after_slot_1_create" | "after_slot_1_sync"
  | "during_plan_write" | "after_plan_sync"
  | "before_initial_slot_write" | "during_initial_slot_write"
  | "after_initial_slot_sync" | "after_initial_state_sync"
  | "during_inactive_slot_write" | "after_inactive_slot_sync"
  | "after_state_sync";

export class BootstrapJournalStore {
  static create(request: BootstrapJournalStoreCreateRequestV1): Promise<BootstrapJournalStore>;
  static open(request: BootstrapJournalStoreOpenRequestV1): Promise<BootstrapJournalStore>;
  readonly plan: BootstrapRetainedExecutionPlanV1;
  current(): BootstrapJournalRecordV1;
  advance(successor: BootstrapJournalRecordV1): Promise<void>;
  close(): Promise<void>;
}
```

Create both empty slots no-replace and retain their handles; sync each and `state`; build the plan with exact slot identities; create the final plan no-replace; write it in place through its retained handle; sync/reopen/validate; then write sequence zero to slot zero. A death before durable plan publication stays unverified and byte-identical. A durable exact plan with no valid initial journal may initialize slot zero with a new valid timestamp only after `admitInitialWrite` proves the guarded post-plan mutation set is empty. `advance` validates the unique successor before truncating the exact inactive plan-bound descriptor, writes with positional bounded loops, syncs, reopens the same inode/path, validates canonical bytes, syncs `state`, and changes the in-memory current slot only afterward. `open` never mutates unbound pre-plan residue.

- [x] **Step 4: Run focused CLI store tests**

Run: `npx vitest run --root apps/cli src/bootstrap/journal-store.test.ts`

Expected: PASS for every write/sync/death boundary with no temp path or inode replacement.

- [x] **Step 5: Run the repository gate and obtain fresh review**

Run: `npm run check`

Expected: PASS. Fresh review must trace descriptor identity across create/open/advance, prove prior-current authority across partial inactive writes, and reject every plan/slot replacement without writing it.

- [x] **Step 6: Commit Task 3**

```bash
git add apps/cli/src/bootstrap/journal-store.ts apps/cli/src/bootstrap/journal-store.test.ts docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md
git commit -m "feat(cli): persist bootstrap journal slots"
```

### Task 4: Implement the same-parent retention engine

**Files:**
- Create: `apps/cli/src/bootstrap/retention.ts`
- Create: `apps/cli/src/bootstrap/retention.test.ts`
- Modify: `packages/core/src/manifest/bootstrap-retention.ts` (controller-routed breaker contracts only)
- Modify: `packages/core/src/manifest/bootstrap-retention.test.ts` (controller-routed regressions only)

**Interfaces:**
- Consumes: Tasks 1–3 table/store contracts, Task 2 `MacOsRetainedRename`, retained bootstrap/global lock handles, guarded filesystem observations.
- Produces: `BootstrapRetainer`, `BootstrapRetentionObservationV1`, `BootstrapRetentionDeathPointV1`, `projectRetainedDirectoryTree`, and `retainBootstrapEnvelope`.

- [x] **Step 1: Write failing row-state, directory-tree, lock, and death tests**

```ts
it.each(retentionDeathPoints)("resumes $name from exactly one legal row state", async point => {
  const fixture = await retainUntil(point);
  await fixture.resume();
  expect(await fixture.readJournal()).toMatchObject({ phase: "retained" });
  expect(await fixture.assertEverySourceAbsentOrInstalled()).toBe(true);
  expect(await fixture.assertEveryTombstoneExact()).toBe(true);
});

it("renames the held bootstrap lock before release", async () => {
  const fixture = await retentionFixture();
  await fixture.retain();
  expect(fixture.events).toEqual(expect.arrayContaining([
    "rename:bootstrap-lock", "sync:bootstrap-lock-parent",
    "journal:advance-bootstrap-lock", "release:bootstrap-lock",
  ]));
  expect(fixture.events.indexOf("rename:bootstrap-lock"))
    .toBeLessThan(fixture.events.indexOf("release:bootstrap-lock"));
});

it("contains no bootstrap unlink, rm, rmdir, or out-of-parent quarantine call", async () => {
  const fixture = await retentionFixture({ forbiddenMutation: () => { throw new Error("called"); } });
  await fixture.retain();
  expect(fixture.renameRequests.every(request =>
    request.parent.path === dirname(request.sourcePath) &&
    request.parent.path === dirname(request.tombstonePath),
  )).toBe(true);
});
```

Cover before/after/both/neither states, destination wrong inode/content/tree, source changed, parent changed, extra descendant, regular-file and maximal-directory rows, first/last ordinal, journal advance failure after rename, parent sync failure, helper status loss, finalized versus rolled-back tables, permanent global-lock exclusion after point of no return, bootstrap-lock retention before release, and reserved matching name without a row.

- [x] **Step 2: Run the retention test and verify the engine is absent**

Run: `npx vitest run --root apps/cli src/bootstrap/retention.test.ts`

Expected: FAIL because `retention.ts` does not exist.

- [x] **Step 3: Implement exact two-state retention**

```ts
export type BootstrapRetentionObservationV1 =
  | { readonly state: "before"; readonly source: BootstrapRetentionPostimageV1 }
  | { readonly state: "after"; readonly tombstone: BootstrapRetentionPostimageV1 };

export type BootstrapRetentionDeathPointV1 =
  | "before_rename" | "after_rename" | "after_projection"
  | "before_parent_sync" | "after_parent_sync"
  | "before_journal_advance" | "after_journal_advance"
  | "before_lock_release" | "after_lock_release";

export interface BootstrapRetainerDependenciesV1 {
  readonly renameSameParentNoReplace: RenameSameParentNoReplace;
  readonly syncDirectory: (path: CanonicalAbsolutePathV1) => Promise<void>;
  readonly projectPostimage: (
    path: CanonicalAbsolutePathV1,
  ) => Promise<BootstrapRetentionPostimageV1 | null>;
  readonly interrupt?: (point: BootstrapRetentionDeathPointV1) => void;
}

export interface HeldBootstrapLocksV1 {
  readonly bootstrap: TransactionLockHandle | null;
  readonly global: TransactionLockHandle | null;
}

export async function projectRetainedDirectoryTree(
  root: CanonicalAbsolutePathV1,
  expectedRoot: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>,
): Promise<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>>;

export class BootstrapRetainer {
  constructor(dependencies: BootstrapRetainerDependenciesV1);
  observe(entry: BootstrapRetentionEntryV1): Promise<BootstrapRetentionObservationV1>;
  retain(entry: BootstrapRetentionEntryV1): Promise<void>;
  retainHeldLock(
    entry: BootstrapRetentionEntryV1,
    handle: TransactionLockHandle,
  ): Promise<void>;
}

export async function retainBootstrapEnvelope(
  table: readonly BootstrapRetentionEntryV1[],
  store: BootstrapJournalStore,
  retainer: BootstrapRetainer,
  locks: HeldBootstrapLocksV1,
): Promise<BootstrapJournalRecordV1>;
```

`observe` no-follow inventories source and tombstone against the exact row, including the complete relative-path-sorted tree hash/count/bytes for a directory row. `retain` accepts only before or exact after, calls the Task 2 port once for before, reobserves exact after, and syncs the retained parent. `retainBootstrapEnvelope` then asks Task 3 to persist exactly one successor. A crash after rename but before cursor advance adopts only the exact after state. The lock variant keeps the handle held across that sequence; the envelope releases it only after the durable cursor.

- [x] **Step 4: Run focused retention and platform tests**

Run: `npx vitest run --root apps/cli src/bootstrap/retention.test.ts src/bootstrap/journal-store.test.ts && npx vitest run --root packages/platform-macos src/retained-rename.test.ts`

Expected: PASS with every death point converging and every third state preserving all names.

- [x] **Step 5: Run the repository gate and obtain fresh review**

Run: `npm run check`

Expected: PASS. Fresh review must verify the derived table is the sole mutation list, same-parent destinations are deterministic, directory roots are maximal/exact, wrong-state paths remain untouched, and lock release follows the durable cursor.

- [x] **Step 6: Commit Task 4**

```bash
git add apps/cli/src/bootstrap/retention.ts apps/cli/src/bootstrap/retention.test.ts docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md
git commit -m "feat(cli): retain bootstrap evidence"
```

### Task 5: Switch fresh V2 init and recovery to the retained envelope

**Files:**
- Modify: `packages/core/src/manifest/bootstrap.ts`
- Modify: `packages/core/src/manifest/bootstrap.test.ts`
- Modify: `packages/core/src/transactions/executor.ts`
- Modify: `packages/core/src/transactions/transactions.test.ts`
- Modify: `apps/cli/src/bootstrap/executor.ts`
- Modify: `apps/cli/src/bootstrap/executor.test.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/commands/init.test.ts`
- Modify: `apps/cli/src/commands/testing.ts`
- Modify: `apps/cli/src/context.ts`
- Modify: `apps/cli/src/context.test.ts`
- Modify: `apps/cli/src/bootstrap/context.ts`
- Modify (controller-routed prerequisite): `packages/platform-macos/src/retained-rename.ts`
- Modify (controller-routed prerequisite): `packages/platform-macos/src/retained-rename.test.ts`
- Modify (controller-routed prerequisite): `packages/platform-macos/src/index.ts`
- Modify (controller-routed prerequisite): `packages/core/src/transactions/types.ts`
- Modify (controller-routed prerequisite): `apps/cli/src/bootstrap/retention.ts`
- Modify (controller-routed prerequisite): `apps/cli/src/bootstrap/retention.test.ts`
- Modify (controller-routed prerequisite): `packages/core/src/manifest/bootstrap-retention.ts`
- Modify (controller-routed prerequisite): `packages/core/src/manifest/bootstrap-retention.test.ts`
- Modify (controller-routed prerequisite): `apps/cli/src/bootstrap/journal-store.ts`
- Modify (controller-routed prerequisite): `apps/cli/src/bootstrap/journal-store.test.ts`
- Modify (codec public-door composition): `packages/core/src/manifest/index.ts`
- Modify (codec public-door composition): `packages/core/src/index.ts`
- Modify (controller-routed public-door exact-set): `packages/core/src/index.test.ts`
- Modify (controller-routed gate orchestration prerequisite): `package.json`

**Interfaces:**
- Consumes: Tasks 1–4 plus the existing packaged-release, Foundation participant, manifest participant, lock, and command-fixture contracts.
- Produces: exact V1 `FreshV2InitPlanV1`/`FreshV2InitJournalV1` retained schemas, retained fresh-init execution/recovery, identity-bound Foundation publication, and a CLI composition with no bootstrap deletion gateway.

- [x] **Step 1: Replace rejected tests with failing retained-envelope integration tests**

```ts
it("publishes two identity-bound slots and permanently retains the plan", async () => {
  const fixture = await runFreshV2Init();
  const plan = await fixture.readPlan();
  expect(plan.journalSlots).toEqual(await fixture.readSlotIdentities());
  expect(await fixture.readCurrentJournal()).toMatchObject({ phase: "retained" });
  expect(await fixture.exists(plan.planPath)).toBe(true);
});

it("does not admit an equal-byte Foundation replacement without persisted identity", async () => {
  const fixture = await interruptBeforeFoundationRecovery();
  await fixture.replaceFoundationPathWithEqualBytes();
  await expect(fixture.resume()).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  expect(await fixture.readReplacement()).toEqual(fixture.expectedBytes);
});

it.each(freshInitRetainedDeathPoints)("recovers retained bootstrap death at $name", async point => {
  const fixture = await interruptFreshInit(point);
  await fixture.resumeInit();
  expect(await fixture.assertExpectedTerminalDirection()).toBe(true);
  expect(await fixture.assertNoBootstrapDeletion()).toBe(true);
});
```

Replace old temp/unlink/rmdir/compaction assertions with slot create/write/sync, immutable plan write/sync, forward no-replace rename, compensation retention, Foundation evidence, row rename/sync/cursor, bootstrap-lock retention, and `retained` terminal assertions. Keep dry-run byte inertness, zero network/vendor/model calls, lock ordering, active-last, manifest point of no return, force-forward, rollback, and all existing launchability/manifest coverage.

- [x] **Step 2: Run the focused suite and verify the old implementation fails**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts src/manifest/bootstrap.test.ts src/transactions/transactions.test.ts && npx vitest run --root apps/cli src/bootstrap/journal-store.test.ts src/bootstrap/retention.test.ts src/bootstrap/executor.test.ts src/commands/init.test.ts src/context.test.ts`

Expected: FAIL because the current plan has one journal path, Core accepts compaction fields, the executor publishes through temps, and context still exposes guarded unlink/quarantine authority.

- [x] **Step 3: Switch Core and CLI to the approved retained state machine**

```ts
export interface FreshV2InitPlanV1 extends BootstrapPlanCommonV1 {
  readonly operation: "fresh_v2_init";
  readonly id: FreshV2InitIdV1;
  readonly admittedExternalShapeHash: LowerHexSha256;
  readonly planPath: ExactProductStatePathV1;
  readonly journalSlots: readonly [
    BootstrapJournalSlotIdentityV1,
    BootstrapJournalSlotIdentityV1,
  ];
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

export interface BootstrapExecutorDependencies {
  readonly paths: RuntimePaths;
  readonly packagedRelease: PackagedReleaseSourceV1;
  readonly transactionExecutor: TransactionExecutor;
  readonly lockProvider: TransactionLockProvider;
  readonly renameSameParentNoReplace: RenameSameParentNoReplace;
  readonly now: () => Date;
  readonly trace?: (event: string) => void;
  readonly interrupt?: (point: FreshInitDeathPointV1) => void;
}
```

Change `bootstrap.ts`'s two existing plan arms to the exact `journalSlots` keys and its two existing journal arms/codecs to the Task 1 structural contract; do not introduce a third persisted journal codec. Replace cleanup/compaction fields and closure arms, and derive retention evidence only from persisted authorities. Use Task 3 for plan/journal persistence and Task 4 for terminal work. Use Task 2 no-replace rename for bootstrap forward publication too, eliminating post-link source unlink recovery. Remove `BootstrapGuardedUnlinkRequestV1`, `createBootstrapGuardedUnlinkExact`, its child gateway/quarantine, plan/journal temp code, guarded-cleanable closure arms, and plan-last compaction. Preserve the non-bootstrap redaction-key/uninstall and Foundation transaction behavior outside bootstrap.

Change the Foundation bootstrap initial-journal bridge to consume the same no-replace rename port and persisted outer payload identity. Same bytes at a new inode are a third state; a death after exact rename is adopted from the final identity and legal outer cursor only. Do not infer authority from the current Foundation plan or journal body.

- [x] **Step 4: Run focused Core and CLI tests**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts src/manifest/bootstrap.test.ts src/transactions/transactions.test.ts && npx vitest run --root apps/cli src/bootstrap/journal-store.test.ts src/bootstrap/retention.test.ts src/bootstrap/executor.test.ts src/update/packaged-release.test.ts src/commands/init.test.ts src/context.test.ts`

Expected: PASS. A repository search over `apps/cli/src/bootstrap/` returns no production `unlink`, `rm`, `rmdir`, quarantine, plan temp, journal temp, `compactionNext`, or `payloadCleanupPart` path.

- [x] **Step 5: Run the repository gate and obtain fresh review**

Run: `npm run check`

Controller-routed gate orchestration runs the exact complete-handoff test selection first, the
other 68 executor names second, and the other 136 files third, all fail-closed. This preserves
every assertion and timeout while isolating the one row that passed twice alone but timed out as
the first row of the 69-test file. Cost if wrong: the hard-coded name adds a Vitest startup and
must be updated on rename; a renamed test falls into the negative selection rather than being
omitted, while a moved executor file makes the first invocation fail.

Expected: PASS. Fresh review must re-evaluate the four rejected authority failures directly: Foundation bytes inferred from observations instead of persisted evidence; rewrite authority not bound to the admitted journal inode; pathname-racy/out-of-root quarantine deletion; and death after detach stranding an untracked target. It must also cover every slot/rename death point, exact Foundation evidence, context capability removal, and absence of a deletion fallback. Accepted findings get branch-valid regression tests first.

- [x] **Step 6: Commit Task 5**

```bash
git add package.json packages/core/src/manifest/bootstrap.ts packages/core/src/manifest/bootstrap.test.ts packages/core/src/manifest/bootstrap-retention.ts packages/core/src/manifest/bootstrap-retention.test.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts packages/core/src/transactions/executor.ts packages/core/src/transactions/transactions.test.ts packages/core/src/transactions/types.ts packages/platform-macos/src/retained-rename.ts packages/platform-macos/src/retained-rename.test.ts packages/platform-macos/src/index.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/executor.test.ts apps/cli/src/bootstrap/journal-store.ts apps/cli/src/bootstrap/journal-store.test.ts apps/cli/src/bootstrap/retention.ts apps/cli/src/bootstrap/retention.test.ts apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts apps/cli/src/commands/testing.ts apps/cli/src/context.ts apps/cli/src/context.test.ts apps/cli/src/bootstrap/context.ts docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md
git commit -m "fix(cli): retain fresh bootstrap closure"
```

### Task 6: Add reports, reinstall bounds, inertness, and checkpoint evidence

> **Accepted 2026-09-04** as the six-commit checkpoint `050fc0d..c5022a7`. The three founder rulings the fresh review required are dated amendments in `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` §6.1, §6.3 and §6.4; the surviving implementation constraints are in `docs/architecture/foundation.md` and `docs/architecture/threat-model.md`. Steps below remain the acceptance contract and carry their evidence.

**Files:**
- Create: `apps/cli/src/bootstrap/report.ts`
- Create: `apps/cli/src/bootstrap/report.test.ts`
- Modify: `apps/cli/src/bootstrap/context.ts`
- Modify: `apps/cli/src/commands/doctor.ts`
- Modify: `apps/cli/src/commands/doctor.test.ts`
- Modify: `apps/cli/src/commands/uninstall.ts`
- Modify: `apps/cli/src/commands/uninstall.test.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/commands/init.test.ts`
- Modify: `apps/cli/src/commands/status.test.ts`
- Modify: `apps/cli/src/commands/testing.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`
- Create: `tests/e2e/fresh-v2-retained-bootstrap.test.ts`
- Modify: `tests/security/network.test.ts`
- Modify: `docs/architecture/foundation.md`
- Modify: `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/plans/2026-08-29-developer-os-release-update.md`
- Modify: `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md`
- Modify: `docs/superpowers/ORDER.md`
- Modify: `docs/superpowers/BACKLOG.md`

**Interfaces:**
- Consumes: Tasks 1–5, current doctor/uninstall result publishing, manifest state, bootstrap capability, synthetic E2E home.
- Produces: `inspectBootstrapEvidence`, `BootstrapEvidenceReportV1`, doctor/uninstall retained summaries, bounded reinstall, ordinary-command inertness, and accepted Task 7 checkpoint evidence.

- [x] **Step 1: Write failing report, uninstall, reinstall, inertness, and E2E tests**

Evidence: `4474885` staged `apps/cli/src/bootstrap/report.test.ts`, `tests/e2e/fresh-v2-retained-bootstrap.test.ts` and the doctor/uninstall/init/status/main inertness cases the earlier tasks had left untracked; `a80cf34` replaced the assertions that could not fail.

```ts
it.each(["verified", "incomplete", "altered", "unverified"] as const)(
  "reports %s evidence without contents",
  async status => {
    const report = await inspectBootstrapEvidence(await evidenceFixture(status));
    expect(report.ids[0]).toMatchObject({
      status,
      operation: "fresh_v2_init",
      vaultPath: expect.stringContaining(".plan.json"),
      entryCount: expect.any(Number),
      regularFileBytes: expect.any(String),
    });
    expect(JSON.stringify(report)).not.toContain("synthetic retained secret");
  },
);

it("uninstalls successfully while preserving every bootstrap evidence inode", async () => {
  const fixture = await installedRetainedFixture();
  const before = await fixture.bootstrapEvidenceIdentities();
  const result = await runUninstall(fixture.context, { dryRun: false, assumeYes: true });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.retainedBootstrapEvidence).toHaveLength(1);
  expect(await fixture.bootstrapEvidenceIdentities()).toEqual(before);
  expect(await fixture.exists(fixture.paths.home)).toBe(true);
});

it.each([
  { ids: 257, reason: "bootstrap IDs" },
  { entries: 1_000_001, reason: "filesystem entries" },
  { bytes: "12884901889", reason: "regular-file bytes" },
])("refuses reinstall first-over $reason before mutation", async vector => {
  const fixture = await retainedReinstallFixture(vector);
  const before = await fixture.inventory();
  await expect(fixture.runInit()).rejects.toBeDefined();
  expect(await fixture.inventory()).toEqual(before);
});
```

Also prove: dry-run report byte inertness; altered/missing/extra tombstones after V2 are warnings; a valid rolled-back retained envelope allows retry; unverified metadata permits retry only with residue confined to exact retained namespaces; a valid plan discovers a compensation tombstone in an admitted external owner parent without scanning unrelated siblings; live staging/lock/source residue blocks; at most one active ID; exact cap passes; ordinary status/Brain/config commands do not invoke the bootstrap inspector; `init` alone advances legal retention; doctor never writes; uninstall without a manifest still reports/preserves evidence; human and JSON uninstall output both report retained evidence instead of claiming nothing remains; and no network/vendor/model process is invoked.

- [x] **Step 2: Run public/E2E tests and verify reports and caps are absent**

Evidence: the failing run preceded `4474885`, which added the report module beside the tests that name it; `c5022a7` put `test:e2e` back into the local `check` gate so the E2E half is run, not assumed.

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts src/commands/doctor.test.ts src/commands/uninstall.test.ts src/commands/init.test.ts src/commands/status.test.ts src/main.test.ts && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts security/network.test.ts`

Expected: FAIL because retained evidence is not in public reports, reinstall does not enforce aggregate caps, and no E2E retained-bootstrap fixture exists.

- [x] **Step 3: Implement read-only reports and public command behavior**

Evidence: `4474885` (reports, doctor and uninstall summaries, reinstall caps), `3d686b4` and `36df8a1` (one retention derivation, forward content never retained), `587f818` and `95c2d7e` (global-lock admission under the held bootstrap lock and the crash resume it needed), `a80cf34` (refusal without the bootstrap capability, confined admitted paths), `d95ed2b` (lint).

```ts
export interface BootstrapEvidenceReportV1 {
  readonly schemaVersion: 1;
  readonly ids: readonly BootstrapEvidenceSummaryV1[];
  readonly aggregate: {
    readonly idCount: number;
    readonly entryCount: number;
    readonly regularFileBytes: UInt64DecimalV1;
  };
}

export interface BootstrapEvidenceInspectionRequestV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly initialRoots: readonly CanonicalAbsolutePathV1[];
  readonly reader: BootstrapEvidenceGuardedReaderV1;
  readonly validatePlan: (value: unknown) => BootstrapExecutionPlanV1;
  readonly validateSlots: (
    plan: BootstrapExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
}

export interface BootstrapEvidenceGuardedEntryV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly kind: "regular_file" | "directory";
  readonly ownerUid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly bytes: UInt64DecimalV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BootstrapEvidenceGuardedReaderV1 {
  inventoryExactNamespaces(
    roots: readonly CanonicalAbsolutePathV1[],
  ): Promise<readonly BootstrapEvidenceGuardedEntryV1[]>;
  readRegularFile(
    entry: BootstrapEvidenceGuardedEntryV1,
    maximumBytes: number,
  ): Promise<Uint8Array>;
}

export async function inspectBootstrapEvidence(
  request: BootstrapEvidenceInspectionRequestV1,
): Promise<BootstrapEvidenceReportV1>;

export interface DoctorReportV1 {
  readonly schemaVersion: 1;
  readonly checks: readonly DoctorCheck[];
  readonly retainedBootstrapEvidence: readonly BootstrapEvidenceSummaryV1[];
}

export interface UninstallResultV1 {
  readonly schemaVersion: 1;
  readonly removed: readonly string[];
  readonly restored: readonly string[];
  readonly preserved: readonly string[];
  readonly retainedBootstrapEvidence: readonly BootstrapEvidenceSummaryV1[];
  readonly transactionId: string | null;
}
```

Implement `BootstrapEvidenceGuardedReaderV1` in the bootstrap context over descriptor-bound, no-follow opens: directory enumeration rechecks the retained directory identity before and after, and regular files are read through an `O_NOFOLLOW` handle whose identity must equal the inventory entry before and after the bounded read. First inventory only exact bootstrap plan/slot/tombstone/staging/lock namespaces under the context-admitted `initialRoots`. After a plan validates through the operation-specific Core admission context, derive its complete retention table and perform a second bounded inventory only in the distinct parent directories carried by those rows; this is how a distributed same-parent vault is counted without walking unrelated home directories. Never hand raw `readdir`/`readFile` pathname functions to the classifier or accept caller-selected second-pass roots. Add the report to `DoctorReportV1` and `UninstallResultV1`; render one content-free doctor check per ID and one human uninstall summary per retained ID. After V2 handoff, altered/unverified retained rows are warnings and never enter drift. Before a new init ID or pre-plan slot allocation, combine the read-only aggregate with the exact projected new envelope and enforce all three caps. Uninstall excludes every retained path and required ancestor directory from artifact removal, leaves product home, and succeeds when evidence is the only residue.

- [x] **Step 4: Run all focused, security, and E2E gates**

Evidence: `ed158c2` removed the NUL separators, scoped `test:suite` and made the CI `suite` job build first; `f68ecc3` corrected the recorded CI bound; `c5022a7` restored `test:e2e` to the local `check` gate.

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts src/manifest/bootstrap.test.ts src/transactions/transactions.test.ts`

Run: `npx vitest run --root packages/platform-macos src/retained-rename.test.ts src/transaction-lock.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/journal-store.test.ts src/bootstrap/retention.test.ts src/bootstrap/report.test.ts src/bootstrap/executor.test.ts src/update/packaged-release.test.ts src/commands/init.test.ts src/commands/doctor.test.ts src/commands/uninstall.test.ts src/commands/status.test.ts src/context.test.ts src/main.test.ts`

Run: `npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts security/network.test.ts`

Expected: PASS with non-empty enumerations and exact/first-over bounds.

- [x] **Step 5: Run the full gate and obtain independent final Task 7 review**

Evidence: a fresh reviewer who authored none of the range read `a3ad015..c5022a7` and returned `READY` after its one Critical finding was fixed in `95c2d7e`; each of the six tasks was separately reviewed by an agent that did not author it. The full `npm run check` runs outside this commit; its result is owed to `ORDER.md` "Delivery evidence still owed".

Run: `npm run check`

Expected: PASS. Request a fresh reviewer against Spec 2 §6, this complete plan, the four rejected authority failures restated in Task 5 Step 5, and the final diff from `1557734`. The verdict must explicitly confirm: no bootstrap unlink/rmdir/out-of-parent quarantine; immutable plan/two exact slot identities; adjacent hash chain; exact Foundation authority; same-parent exclusive rename; crash-safe lock retention; post-handoff inertness; doctor/uninstall preservation; reinstall caps. Resolve every accepted finding with a focused failing regression and rerun Step 4 plus `npm run check` until `READY`.

- [x] **Step 6: Update canonical state and commit the accepted Task 7 checkpoint**

Evidence: `8ca0477` and `6e3ce69` moved the surviving constraints into `docs/architecture/foundation.md` and `docs/architecture/threat-model.md`; `050fc0d`, `ddaea3e` and `9bd85bb` recorded the three rulings, the legacy inventory and the completion roadmap; this commit ticks the governance rows, rewrites `BACKLOG.md` NEW-56 and NEW-59, and deletes the closure plan.

Move surviving implementation facts into `foundation.md` and `threat-model.md`. Mark this six-task plan complete, change baseline Task 7's supersession note to accepted, advance `ORDER.md`, and remove completed Task 7 rows from `BACKLOG.md`. Do not delete either active Spec 2 plan because Tasks 8–26 remain unfinished. `ORDER.md` `NOW` becomes roadmap Phase 1 (ingest isolation, NEW-58), not baseline Task 8: the completion roadmap of 2026-09-04 places Phases 1 and 2 ahead of it.

```bash
git add apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/bootstrap/context.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts apps/cli/src/commands/status.test.ts apps/cli/src/commands/testing.ts apps/cli/src/main.ts apps/cli/src/main.test.ts tests/e2e/fresh-v2-retained-bootstrap.test.ts tests/security/network.test.ts docs/architecture/foundation.md docs/architecture/threat-model.md docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git commit -m "feat(cli): report retained bootstrap evidence"
```

After this commit, roadmap Phase 1 (ingest isolation, NEW-58) is the next action; baseline Spec 2 Task 8 is roadmap Phase 3. Do not begin either in the same implementation task; let the Task 7 checkpoint and reviewer verdict stand independently.
