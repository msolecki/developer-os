# Developer OS Release, Update, and Manifest V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved DOS-P7 Spec 2 stable launcher, signed release trust, `InstallationManifestV2`, crash-resumable V1 migration and V2 initialization, plan-first update, managed-artifact/schema upgrade, and conservative one-version rollback.

**Architecture:** Core owns canonical scalar/path codecs, manifest/update schemas, pure transition tables, target-plan validation, and migration-chain contracts; Security owns signatures, fixed-origin transport, bounded Zstandard/ustar admission, guarded scratch, and planner/verifier supervision; platform-macos owns launcher executable/platform admission; the launcher owns offline root trust and exact bundle selection; the adapters and Brain expose pure target planners; the CLI composes all concrete paths, owner providers, construction/source envelopes, lifecycle participants, update/rollback commands, and recovery. Tasks 1–9 deliver the V2 bootstrap handoff that unblocks the already-approved Spec 1 plan; after Spec 1 completes, Tasks 10–26 consume its lifecycle coordinator and finish Spec 2.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins (`node:crypto`, `node:https`, `node:zlib`, `node:fs`), Zod 4 where existing package schemas use it, Vitest 4, existing Foundation transactions and injected filesystem/process/clock/lock ports.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`

## Global Constraints

- Execute Tasks 1–9 first and commit their checkpoint. Then execute `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md` completely. Resume this plan at Task 10 only after Spec 1's lifecycle coordinator, participant, compaction, Git, launchd, and uninstall contracts pass their checkpoint.
- Tasks 1–9 may create shared files named by the Spec 1 plan (`packages/core/src/lifecycle/canonical-json.ts`, lifecycle ID codecs, and bootstrap allocator schemas). During Spec 1 execution those files are consumed/extended rather than redeclared; this is the approved split dependency, not a second implementation.
- Package direction remains `core ← security ← platform-macos ← cli`, with the separate `apps/launcher` depending only on Core, Security, and platform-macos. Core imports no filesystem globals, HTTP, archive extraction, process, platform, adapter, or CLI implementation.
- No command other than `developer-os update` makes an update network request. Rollback, init migration, fresh init, uninstall, config, Git, automation, Brain, adapter probes, and launcher selection make zero release-transport requests.
- `update` and `update rollback` are plan-only unless `--apply` is present. Planning may use only one bounded attempt-owned system-temporary scratch envelope and never mutates product, Brain, vendor, launcher, manifest, trust, active-release, or allocator state.
- The updater accepts only stable SemVer, fixed launcher-provided metadata locators, root/delegated Ed25519 signatures, exact delegated HTTPS origins, one permitted redirect, and the exact signed architecture bundle. It never accepts a custom origin, channel, prerelease, build metadata, arbitrary downgrade, cookie, credential, client certificate, or ambient proxy.
- Exact primary bounds are normative: delegation 64 KiB; release index 4 MiB; bundle manifest 16 MiB; archive 2 GiB; one expanded file 512 MiB; aggregate expansion 8 GiB; 200,000 bundle entries; 12 GiB scratch; 256 MiB archive streaming memory; V2 manifest 64 MiB/1,000,000 artifacts; immutable leaf plans 16 MiB; construction plan 512 MiB; construction journal 64 MiB; participant journals 1 MiB; planner request/result 256 MiB each; 1,000,000 blobs and 1 GiB blob payload per direction; 512 MiB planner RSS; 30-second idle/10-minute wall; rollback payload 1,000,000 entries/2 GiB.
- All new persisted JSON is `CanonicalJsonV1` plus one LF. Exact keys are checked recursively; array order, non-empty per-scope enumerations, counts, checked sums, hashes, and cross-object bijections are validated before authority.
- Relative and absolute path brands use the exact NFC, component, byte, control/format, alias, containment, and role restrictions in Spec 2 §2. A raw string, generic URL resolver, archive name, or caller-selected product root never becomes mutation authority.
- Redact before truncating, hashing, logging, persistence, publication, or model input. Integrity hashes are computed only after the Security secret screen and remain internal plan/precondition evidence.
- The target planner is trusted signed release code with a repository-enforced capability-absence graph, not an OS sandbox. It receives tokenized bounded state over counted pipes, no absolute product/Brain root, environment, network, filesystem, clock, randomness, native addon, worker, dynamic import, or subprocess authority.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`. Intent and an actual inode identity precede byte zero; recovery follows only persisted direction/cursors; third states preserve evidence as exit 6.
- Trust high watermarks never roll back. Rollback never downloads, merges, forces, overwrites a post-update edit, lowers trust, or removes a path without exact manifest plus signed/retained inventory authority.
- Tests use synthetic Ed25519 keys, release archives, homes, vaults, vendor state, and injected local transports. No test reads a live Brain, credential store, GitHub CLI config, release, vendor home, launcher installation, or founder data.
- At each code-producing task commit, tick only that task's evidence-backed steps, update A11's exact progress sentence in `docs/superpowers/ORDER.md`, stage exact paths only, run the named focused command plus `npm run check`, and obtain a fresh reviewer verdict. Accepted findings receive a failing regression test before the smallest correction.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Canonical/update scalars | `packages/core/src/lifecycle/canonical-json.ts`, `packages/core/src/update/{scalars,paths,release,index}.ts` | Canonical JSON, numeric/version/hash/time/path brands, release identity and pure selection schemas |
| Manifest V2/bootstrap | `packages/core/src/manifest/{v2,drift,manifest-state,bootstrap,migration}.ts` | V1/V2 validation, V2 drift, manifest participant, fresh-init and V1 migration plans/state tables |
| Core update protocol | `packages/core/src/update/{preview,planner,owner,migrations,construction,participants,coordinator,rollback}.ts` | Preview/materialization, token wire schemas, owner/migration plans, construction/participant/coordinator/rollback state machines |
| Release security | `packages/security/src/update/{signatures,transport,archive,scratch,planner-process,graph,index}.ts` | Ed25519 chain, fixed HTTPS transport, zstd-ustar admission, guarded scratch, counted planner/verifier supervision, capability graph gate |
| Launcher platform | `packages/platform-macos/src/launcher/{types,admission,index}.ts` | Platform/architecture identity and guarded executable/bundle admission |
| Stable launcher | `apps/launcher/src/{handoff,selection,environment,main}.ts`, `apps/launcher/assets/` | Offline root constants, recovery/bootstrap/active/fallback routing, FD 3 trust handoff, absolute exec |
| Pure owner planners | `packages/adapter-claude/src/update/`, `packages/adapter-codex/src/update/`, `packages/brain/src/migrations/update/` | Root-free token-only desired state, Codex refresh draft, Brain migration planning |
| CLI bootstrap/update | `apps/cli/src/bootstrap/`, `apps/cli/src/update/`, `apps/cli/src/commands/update/`, existing `init`, `main`, `context` | Packaged release admission, V2 init/migration, construction/source envelopes, participant composition, preview/apply/rollback/recovery |
| Gates | `tests/integration/update/`, `tests/e2e/release-update.test.ts`, `tests/security/`, `tests/repository/` | Synthetic full lifecycle, death injection, network/process/capability absence, exact enumerator coverage |

---

## Checkpoint A — Manifest V2 prerequisite before Spec 1

### Task 1: Add canonical JSON, stable scalar, ordinal, and path codecs

**Files:**
- Create: `packages/core/src/lifecycle/canonical-json.ts`
- Create: `packages/core/src/lifecycle/canonical-json.test.ts`
- Create: `packages/core/src/update/scalars.ts`
- Create: `packages/core/src/update/scalars.test.ts`
- Create: `packages/core/src/update/paths.ts`
- Create: `packages/core/src/update/paths.test.ts`
- Create: `packages/core/src/update/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: existing `hashBytes`, runtime absolute paths, Spec 2 §§2 and 4.3.
- Produces: `CanonicalJsonV1`, `encodeCanonicalJson`, `decodeCanonicalJson`; `StableSemverV1`, `UInt64DecimalV1`, `PositiveUInt32V1`, `LowerHexSha256`, `UtcTimestampV1`, `LowercaseKebabIdV1`, `SafeReasonCodeV1`, `SchemaMigrationIdV1`, `TenDigitZeroPaddedOrdinalV1`; exact product/update/bootstrap/manifest/source/rollback path brands and constructors.

- [x] **Step 1: Write failing canonical, scalar, and path boundary tests**

```ts
it("encodes one canonical object order and one LF", () => {
  expect(encodeCanonicalJson({ z: 1, a: "é" })).toBe('{"a":"é","z":1}\n');
});

it.each(["0000000000", "0000999999"])("round-trips canonical ordinal %s", value => {
  expect(encodeTenDigitOrdinal(decodeTenDigitOrdinal(value))).toBe(value);
});

it.each(["0", "1", "00000000000", "+000000001", "00000000١٠"])("refuses noncanonical ordinal %s", value => {
  expect(() => decodeTenDigitOrdinal(value)).toThrow();
});
```

Add exact first/last/first-over tests for SemVer components, UInt64 decimal spelling, positive UInt32, kebab IDs, UTF-8 component/aggregate path lengths, dot/dot-dot, slash/backslash, C0/C1/format characters, NFC/folded aliases, and every role-derived exact path.

- [x] **Step 2: Run the focused tests and verify missing codecs fail**

Run: `npx vitest run --root packages/core src/lifecycle/canonical-json.test.ts src/update/scalars.test.ts src/update/paths.test.ts src/index.test.ts`

Expected: FAIL because the modules and exports do not exist.

- [x] **Step 3: Implement strict codecs and constructors**

```ts
export function encodeCanonicalJson(value: CanonicalJsonValue): CanonicalJsonV1;
export function decodeCanonicalJson(bytes: Uint8Array, maximumBytes: number): CanonicalJsonValue;
export function parseStableSemver(value: unknown): StableSemverV1;
export function parseUInt64Decimal(value: unknown): UInt64DecimalV1;
export function decodeTenDigitOrdinal(value: unknown): number;
export function deriveExactProductStatePath(
  productHome: CanonicalAbsolutePathV1,
  role: ExactProductStateRoleV1,
  id: SafeReasonCodeV1,
): ExactProductStatePathV1;
```

Sort object keys by unsigned UTF-8 bytes, reject duplicate keys before object construction, reject noncanonical input by re-encoding byte equality, and use checked integer/string operations only. Constructors reopen containment policy through injected canonical evidence; no brand is exported as an assertion helper.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle/canonical-json.test.ts src/update/scalars.test.ts src/update/paths.test.ts src/index.test.ts`

Expected: PASS across exact boundary vectors.

- [x] **Step 5: Commit Task 1**

```bash
git add packages/core/src/lifecycle/canonical-json.ts packages/core/src/lifecycle/canonical-json.test.ts packages/core/src/update/scalars.ts packages/core/src/update/scalars.test.ts packages/core/src/update/paths.ts packages/core/src/update/paths.test.ts packages/core/src/update/index.ts packages/core/src/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): add canonical update codecs"
```

### Task 2: Define release identities, active/trust records, and signed metadata schemas

**Files:**
- Create: `packages/core/src/update/release.ts`
- Create: `packages/core/src/update/release.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1 scalar/path/canonical codecs.
- Produces: `ReleaseIdentityV1`, `ReleaseMetadataIdentityV1`, `ActiveReleaseRecordV1`, `ReleaseTrustStateV1`, `OfficialReleaseOriginV1`, `FixedReleaseMetadataLocatorV1`, `OfflineRootKeyV1`, `OfflineReleaseTrustV1`, `DelegatedReleaseKeyV1`, `ReleaseKeyDelegationV1`, `ReleaseIndexV1`, `ReleaseBundleManifestV1`, `SelectedReleaseV1`, strict codecs, `releaseIdentityHash`, context-bound release-identity admission, role-aware trust admission, monotonic trust transition validation, and pure path-free target selection.

- [x] **Step 1: Write failing exact metadata and replay tests**

```ts
it("binds a release identity to the architecture bundle but not index sequence", () => {
  expect(releaseIdentityHash(entry, "arm64")).toBe(releaseIdentityHash(repeatedEntry, "arm64"));
  expect(releaseIdentityHash(entry, "arm64")).not.toBe(releaseIdentityHash(entry, "x64"));
});

it.each(replayMutations)("refuses $name", mutation => {
  expect(() => advanceReleaseTrust(currentTrust, mutation.document)).toThrow();
});
```

Cover one current/optional previous offline root, exact fixed GitHub locators, delegated origin grammar, one signature, stable SemVer ordering, two architecture rows, unique increasing release sequences/versions, latest equality, active equality, retained rollback exception, lower/equal/new delegation/index/release sequence/hash cases, manifest path order and entrypoint membership.

- [x] **Step 2: Run release schema tests and verify missing types fail**

Run: `npx vitest run --root packages/core src/update/release.test.ts`

Expected: FAIL on missing release codecs and selection functions.

- [x] **Step 3: Implement exact release schemas and pure transitions**

```ts
export function validateReleaseIndex(value: unknown): ReleaseIndexV1;
export function validateBundleManifest(value: unknown): ReleaseBundleManifestV1;
export function selectRelease(
  index: ReleaseIndexV1,
  request: { readonly version: StableSemverV1 | null; readonly active: ReleaseIdentityV1 },
): { readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 } |
   { readonly outcome: "selected"; readonly selected: SelectedReleaseV1 };
export function admitReleaseIdentity(
  value: unknown,
  evidence: CanonicalPathEvidenceV1,
  context: ReleaseIdentityAdmissionContextV1,
): ReleaseIdentityV1;
export function admitReleaseAgainstTrust(
  trust: ReleaseTrustStateV1,
  release: Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">,
  role: "online_target" | "guarded_active" | "guarded_retained_rollback",
): void;
export function advanceReleaseTrust(
  current: ReleaseTrustStateV1,
  accepted: ReleaseMetadataIdentityV1 & Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">,
): ReleaseTrustStateV1;
```

Use exact-key recursive validation and checked numeric comparison; identity hashes use the exact ASCII domains and no-LF canonical projections from Spec 2. `selectRelease` returns only the validated index entry, architecture bundle, and computed identity hash: it must not fabricate a bundle root, retained metadata hash, or manifest-derived launcher protocol. `admitReleaseIdentity` is the separate point that binds a strict lexical path plus exact derived release root to the retained metadata, selected entry, verified manifest/hash, and every duplicated protocol/identity field. `admitReleaseAgainstTrust` preserves the stored high watermark: lower sequences are legal only for an externally guarded active or retained-rollback identity, equality requires the identical hash, and a higher observation is legal only as an online target. Keep signature verification out of Core.

- [x] **Step 4: Run release schema tests**

Run: `npx vitest run --root packages/core src/update/release.test.ts`

Expected: PASS, including replay and both-architecture vectors.

- [x] **Step 5: Commit Task 2**

```bash
git add packages/core/src/update/release.ts packages/core/src/update/release.test.ts packages/core/src/update/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): define release identity and trust schemas"
```

### Task 3: Implement the closed `ManagedArtifactV2` and manifest validators

**Files:**
- Create: `packages/core/src/manifest/v2.ts`
- Create: `packages/core/src/manifest/v2.test.ts`
- Modify: `packages/core/src/manifest/types.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1 scalars/path/source codecs and existing V1 types.
- Produces: `ManagedArtifactV2`, `InstallationManifestV2`, `ManagedArtifactSchemaIdV1`, `MigratableInstallationManifestV1`, `ManifestAdmissionContextV1`, the content-free `manifest_v1_not_migratable` refusal reason, `validateManifestV1`, `validateMigratableManifestV1`, `validateManifestV2`, `InstallationManifest = InstallationManifestV1 | InstallationManifestV2`.

- [x] **Step 1: Write failing tagged-union and migratable-V1 tests**

```ts
it.each(validV2Arms)("round-trips $kind/$mode", ({ value }) => {
  expect(validateManifestV2(manifestWith(value))).toEqual(manifestWith(value));
});

it.each(illegalRestoreCombinations)("refuses restore combination $name", ({ artifact }) => {
  expect(() => validateManifestV2(manifestWith(artifact))).toThrow(ManifestStateError);
});

it("refuses a legacy alternate encoding before artifact bytes are read", () => {
  expect(() => validateMigratableManifestV1(prettyPrintedLegacyBytes)).toThrow();
});
```

Cover exact keys at every depth, content/schema/ephemeral files, content directories/symlinks, the four initial schema IDs, empty/maximum/first-over artifacts and source/path/manifest-byte bounds, exact/NFC/folded duplicates, stable product versions, calendar-valid UTC milliseconds, the complete restore-field matrix, directory empty-hash sentinel, one positive migratable V1 vector, and V1 symlink/config-entry/shared-directory/unsafe-backup/non-stable/loose-timestamp/collision refusals. Each authority test must isolate owner-path, source-root, backup-root, and folded-alias admission, and migration refusals must expose only `manifest_v1_not_migratable` before any artifact or backup byte read.

- [x] **Step 2: Run manifest validator tests and verify V2 arms fail**

Run: `npx vitest run --root packages/core src/manifest/v2.test.ts src/manifest/manifest.test.ts`

Expected: FAIL because V2 types/codecs are absent; existing V1 cases remain green.

- [x] **Step 3: Implement V2 and strict migratable-V1 validation**

```ts
export type ManagedArtifactV2 =
  | ManagedContentFileV2
  | ManagedSchemaFileV2
  | ManagedEphemeralFileV2
  | ManagedContentDirectoryV2
  | ManagedContentSymlinkV2;

export interface InstallationManifestV2 {
  readonly schemaVersion: 2;
  readonly productVersion: StableSemverV1;
  readonly installedAt: UtcTimestampV1;
  readonly artifacts: readonly ManagedArtifactV2[];
}

export interface ManifestAdmissionContextV1 {
  readonly evidence: CanonicalPathEvidenceV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly backupRoot: CanonicalAbsolutePathV1;
  readonly admitOwnerPath: (
    owner: ArtifactOwner,
    path: CanonicalAbsolutePathV1,
  ) => CanonicalAbsolutePathV1;
}

export function validateManifestBytes(
  bytes: Uint8Array,
  context: ManifestAdmissionContextV1,
): InstallationManifest;
```

Parse V1 only through the legacy compact round-trip byte check and V2 only through canonical JSON plus LF. Stream/count the artifact array within 64 MiB and 1,000,000 rows; perform complete collision validation before any caller receives artifact paths. Strict V2 and migratable-V1 admission must use the same required context: first admit the canonical absolute path, then require the owner callback to return that exact path, and admit every source/backup relative path with the Task 1 vault-free codec under its named guarded root. Any migratable-V1 failure, including one raised by the intentionally broader legacy validator, is mapped to the single content-free `manifest_v1_not_migratable` reason.

- [x] **Step 4: Run manifest validator tests**

Run: `npx vitest run --root packages/core src/manifest/v2.test.ts src/manifest/manifest.test.ts`

Expected: PASS without changing accepted V1 bytes.

- [x] **Step 5: Commit Task 3**

```bash
git add packages/core/src/manifest/v2.ts packages/core/src/manifest/v2.test.ts packages/core/src/manifest/types.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): add installation manifest v2"
```

### Task 4: Add V2 drift and a guarded V1/V2 manifest store

**Files:**
- Modify: `packages/core/src/manifest/drift.ts`
- Modify: `packages/core/src/manifest/store.ts`
- Modify: `packages/core/src/manifest/types.ts`
- Modify: `packages/core/src/manifest/v2.ts`
- Modify: `packages/core/src/manifest/v2.test.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/src/manifest/manifest.test.ts`
- Create: `packages/core/src/manifest/v2-drift.test.ts`
- Modify: `apps/cli/src/context.ts`
- Modify: `apps/cli/src/commands/testing.ts`
- Modify: `tests/security/helpers.ts`

**Interfaces:**
- Consumes: Task 3 manifest union/codecs and existing guarded descriptor reads.
- Produces: `DriftRequestV2`; `ManagedArtifactSchemaRegistry`; `ManagedArtifactEphemeralRegistryV1`; `schema_invalid` drift; kind-specific V2 inspection; guarded `ManifestStore.readOptional/read` returning the manifest union; `ManifestStore.writeV2` for canonical V2 bytes while retaining legacy `writeV1`/`write` compatibility until migration lands.

- [x] **Step 1: Write failing V2 drift/store tests**

```ts
it.each([
  ["ephemeral absent", ephemeralArtifact(), null],
  ["schema valid with changed bytes", schemaArtifact(), null],
  ["schema invalid", invalidSchemaArtifact(), "schema_invalid"],
])("classifies %s", async (_name, artifact, expected) => {
  expect((await inspectDrift(requestFor(artifact)))[0]?.kind ?? null).toBe(expected);
});
```

Assert wrong kind, missing rules, content/target hashes, directory type, schema strictness, ephemeral absence plus present-runtime-metadata acceptance/refusal, guarded parent canonicalization for the manifest store, guard revalidation with exact-path equality for already-branded V2 artifact paths, size-before-allocation, before/after inode identity, V1/V2 dispatch with V2 context required only for V2, canonical V2 write bytes, and refusal on unknown schema version. Existing V1 callers must remain source-compatible after supplying the now-required store read guard.

- [x] **Step 2: Run drift/store tests and verify missing V2 behavior fails**

Run: `npx vitest run --root packages/core src/manifest/v2-drift.test.ts src/manifest/manifest.test.ts`

Expected: FAIL on `schema_invalid`, ephemeral absence, and V2 store dispatch.

- [x] **Step 3: Implement kind-specific inspection and union store dispatch**

```ts
export interface ManagedArtifactSchemaRegistry {
  validate(schemaId: ManagedArtifactSchemaIdV1, bytes: Uint8Array): void;
}

export interface ManagedArtifactEphemeralRegistryV1 {
  validate(
    owner: ArtifactOwner,
    observation: {
      readonly path: CanonicalAbsolutePathV1;
      readonly uid: number;
      readonly mode: number;
      readonly nlink: number;
    },
  ): void;
}

export async function inspectDrift(request: DriftRequestV2): Promise<readonly DriftFinding[]>;
```

Inject both registries into drift; never import CLI schemas or owner policy into Core. Missing ephemeral is clean; present ephemeral is clean only after the registry accepts its guarded owner/mode/link metadata without reading its bytes. Task 3 has already admitted and owner-bound every V2 `artifact.path`; `ManifestGuards` must revalidate it and return the exact same string, never mint or relocate that brand. Preserve leaf no-follow semantics and recheck the guarded opened inode after every file read. Manifest reads require `ManifestGuards`, reject wrong kind/symlink, enforce 64 MiB from descriptor metadata before allocation, and recheck dev/ino/size after read. `readOptional/read` accept an optional `ManifestAdmissionContextV1`: legacy compact V1 remains readable without it, while V2 refuses unless the context is supplied; Task 3 byte dispatch is widened only enough to encode that distinction. `ManifestStore.writeV2` requires the context and writes canonical V2 bytes only; migration/task participants, not ordinary callers, decide when it is legal. Preserve `write` as the V1 compatibility alias for existing callers and expose explicit `writeV1`.

- [x] **Step 4: Run drift/store tests**

Run: `npx vitest run --root packages/core src/manifest/v2-drift.test.ts src/manifest/manifest.test.ts`

Expected: PASS for both manifest versions.

- [x] **Step 5: Commit Task 4**

```bash
git add packages/core/src/manifest/drift.ts packages/core/src/manifest/store.ts packages/core/src/manifest/types.ts packages/core/src/manifest/v2.ts packages/core/src/manifest/v2.test.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts packages/core/src/manifest/manifest.test.ts packages/core/src/manifest/v2-drift.test.ts apps/cli/src/context.ts apps/cli/src/commands/testing.ts tests/security/helpers.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): inspect manifest v2 drift"
```

### Task 5: Implement the recoverable manifest direct-write participant

**Files:**
- Create: `packages/core/src/manifest/manifest-state.ts`
- Create: `packages/core/src/manifest/manifest-state.test.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4; existing guarded file ports; bootstrap/lifecycle IDs as opaque validated strings.
- Produces: `ManifestBytesStateV1`, `BootstrapExpectedPayloadRefV1`, `UpdateExpectedPayloadRefV1`, `ManifestPayloadRefV1`, `ManifestStatePlanV1`, `ManifestParticipantIdV1`, `ManifestParticipantObservationV1`, strict codecs, `ManifestStateParticipant`, and tombstone recovery/compaction tables.

- [x] **Step 1: Write failing transition/death-injection tests**

```ts
it.each(manifestDeathPoints)("recovers death at $name", async point => {
  const fixture = await interruptManifestParticipant(point);
  await fixture.participant[point.direction](fixture.plan);
  expect(await fixture.observe()).toEqual(point.expected);
});

it("preserves a concurrent third state", async () => {
  await expect(runWithConcurrentManifestSwap()).rejects.toMatchObject({ code: 6 });
  expect(await evidenceStillExists()).toBe(true);
});
```

Cover absent/present before/after, payload-kind/envelope/ID/path/hash/length/mode equality, bootstrap/update ordinal bounds, Foundation/external-effect binding bijections, tombstone naming/device, no-replace moves, committed absence, rollback, point of no return, tombstone-before-plan compaction, and every missing/two-copy/changed-inode third state. `apply` and `compensate` are the two explicit recovery directions selected by the enclosing durable coordinator; there is no direction-guessing `recover(plan)` method.

- [x] **Step 2: Run participant tests and verify missing state machine fails**

Run: `npx vitest run --root packages/core src/manifest/manifest-state.test.ts`

Expected: FAIL because the plan codec and participant do not exist.

- [x] **Step 3: Implement immutable plan validation and cursor-driven moves**

```ts
export class ManifestStateParticipant {
  constructor(readonly dependencies: ManifestStateParticipantDependencies) {}
  observe(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1>;
  apply(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1>;
  compensate(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1>;
  compact(plan: ManifestStatePlanV1): Promise<void>;
}
```

The immutable plan stays under 16 MiB and refers to staged bytes by exact evidence, never embeds a near-64-MiB manifest. Its strict admission is context-bound: the caller supplies already admitted product/manifest roots, the exact enclosing Foundation and external-effect partitions, and opaque ID/payload-evidence validators; the codec recomputes participant/tombstone/payload paths and binding hashes before granting authority. Move the guarded preimage no-replace to the derived tombstone, sync/reopen, publish or commit absence, verify strict V2, and expose each transition only after its durable cursor. A bootstrap `after` payload does not exist when the immutable outer plan is published, so its planned `dev`/`ino` are `null` and become concrete only in the later matching `BootstrapPayloadEvidenceV1`; a lifecycle/update `after` retains concrete construction-evidence identity. `before.present` always retains concrete identity.

- [x] **Step 4: Run participant tests**

Run: `npx vitest run --root packages/core src/manifest/manifest-state.test.ts`

Expected: PASS at every transition and third-state vector.

- [x] **Step 5: Commit Task 5**

```bash
git add packages/core/src/manifest/manifest-state.ts packages/core/src/manifest/manifest-state.test.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): recover manifest state transitions"
```

### Task 6: Define bootstrap payload, plan, journal, and closure state machines

**Files:**
- Create: `packages/core/src/manifest/bootstrap.ts`
- Create: `packages/core/src/manifest/bootstrap.test.ts`
- Modify: `packages/core/src/manifest/manifest-state.ts`
- Modify: `packages/core/src/manifest/manifest-state.test.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/transactions/types.ts`
- Modify: `packages/core/src/transactions/store.ts`
- Modify: `packages/core/src/transactions/executor.ts`
- Modify: `packages/core/src/transactions/index.ts`
- Modify: `packages/core/src/transactions/transactions.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, and 5; Spec 2 §6 shared fresh/migration grammar.
- Produces: `FreshV2InitIdV1`, `ManifestMigrationIdV1`, `LifecycleBootstrapLockV1`, `LifecycleInstallNonceV1`, `LifecycleIdAllocatorV1`, `PersistedBootstrapLockIdentityV1`, `BootstrapExternalShapeProjectionV1`, `BootstrapPayloadPlanV1`, `BootstrapPayloadSourceV1`, `BootstrapPayloadEvidenceV1`, `BootstrapPayloadWriteStateV1`, `PlannedCreatedPathV1`, `CreatedPathEvidenceV1`, `FoundationMutationRefV1`, the deterministic bootstrap arms of `FoundationTransactionIdV2`, `FoundationParticipantRefV2`, `FreshV2InitPlanV1`, `ManifestMigrationPlanV1`, both journals/codecs, `BootstrapPlanAdmissionContextV1`, `BootstrapClosureAdmissionContextV1`, `BootstrapInventoryV1`, and `BootstrapClosureV1`.

- [x] **Step 1: Write failing exact-set and cursor tests**

```ts
it.each([0, 255, 256])("validates deterministic Foundation pair ordinal %i", ordinal => {
  const outcome = validateBootstrapFoundationOrdinal(ordinal);
  expect(outcome.ok).toBe(ordinal <= 255);
});

it.each(bootstrapCursorMutations)("refuses $name", mutation => {
  expect(() => inspectBootstrapClosure(mutation.inventory, mutation.context)).toThrow(BootstrapStateError);
});
```

Cover exact external shape rows/order, payload source arms, projection/source hashes, contiguous ordinals and use-once bijection, maximum staging aggregate, plan/journal/temp names and prefixes, created-parent refs, evidence identities, phase-owned cursors, compensation order, plan-last compaction, one-ID residue, and every first-over cursor/count/byte bound.

- [x] **Step 2: Run bootstrap schema tests and verify missing grammars fail**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts`

Expected: FAIL because bootstrap plans/journals/closure do not exist.

- [x] **Step 3: Implement shared pure bootstrap schemas and tables**

```ts
export type BootstrapExecutionPlanV1 = FreshV2InitPlanV1 | ManifestMigrationPlanV1;
export function validateBootstrapPlan(
  value: unknown,
  context: BootstrapPlanAdmissionContextV1,
): BootstrapExecutionPlanV1;
export function validateBootstrapJournal(
  plan: BootstrapExecutionPlanV1,
  value: unknown,
): FreshV2InitJournalV1 | ManifestMigrationJournalV1;
export function inspectBootstrapClosure(
  inventory: BootstrapInventoryV1,
  context: BootstrapClosureAdmissionContextV1,
): BootstrapClosureV1;
```

Keep filesystem operations behind injected ports. Plan and closure admission are context-bound: consume already admitted product/state/staging roots and path evidence, the exact outer ID/bootstrap identity/external-shape authority, a bounded guarded inventory, and opaque validators for sources, payload/creation evidence, Foundation participants, and the manifest participant. Retain every supplied field and require the returned bound value/ID to equal it; never brand a caller absolute path, infer cleanup authority from spelling/live booleans, or accept an unguarded inventory. Recompute every derived final/temp/evidence path, prefix, hash, maximum, cursor partition, and use-once bijection.

Add only the deterministic `tx_fi_...`/`tx_mm_...` transaction-ID and coordinator-bound pre-staged-initial-journal bridge required before an installed allocator exists. The bridge accepts only an admitted `FoundationParticipantRefV2` plus its matching `BootstrapPayloadEvidenceV1`, no-replace-publishes that exact staged inode to the ref's derived final path, syncs/reopens/verifies the transaction parent and exact planned `FoundationJournalJsonV1` bytes, then invokes the unchanged executor. It never generates an ID or accepts a caller-selected staged/final path. Preserve every legacy transaction ID, API, and encoding byte-for-byte and leave the later allocated lifecycle arm to the Spec 1 Foundation task. Derive all names from envelope kind/ID/ordinal, bind actual inode evidence only after publication, and make phase/cursor validity a closed table rather than condition fallthrough. Shared lifecycle/bootstrap names introduced here consume Task 1's canonical modules and are later consumed/re-exported by Spec 1 rather than redeclared.

`BootstrapExpectedPayloadRefV1` remains the single shared ref type introduced by Task 5. Widen only its public `mode` field to the normative `0600 | 0700` needed by general bootstrap files; the manifest-state codec still admits only `0600` postimages and its tests must pin that unchanged runtime boundary. Do not create a second general payload-ref brand or duplicate interface.

- [x] **Step 4: Run bootstrap schema tests**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts src/transactions/transactions.test.ts`

Expected: PASS with non-empty exhaustive cursor tables.

- [x] **Step 5: Commit Task 6**

```bash
git add packages/core/src/manifest/bootstrap.ts packages/core/src/manifest/bootstrap.test.ts packages/core/src/manifest/manifest-state.ts packages/core/src/manifest/manifest-state.test.ts packages/core/src/manifest/index.ts packages/core/src/transactions/types.ts packages/core/src/transactions/store.ts packages/core/src/transactions/executor.ts packages/core/src/transactions/index.ts packages/core/src/transactions/transactions.test.ts packages/core/src/index.ts packages/core/src/index.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): define v2 bootstrap recovery"
```

### Task 7: Execute fresh V2 initialization with current-bundle seeding

**Files:**
- Modify: `packages/core/src/manifest/bootstrap.ts`
- Modify: `packages/core/src/manifest/bootstrap.test.ts`
- Create: `apps/cli/src/bootstrap/context.ts`
- Create: `apps/cli/src/bootstrap/executor.ts`
- Create: `apps/cli/src/bootstrap/executor.test.ts`
- Create: `apps/cli/src/update/packaged-release.ts`
- Create: `apps/cli/src/update/packaged-release.test.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/commands/init.test.ts`
- Modify: `apps/cli/src/commands/testing.ts`
- Modify: `apps/cli/src/context.ts`
- Modify: `apps/cli/src/context.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6, existing Foundation filesystem/lock/guard ports, packaged release source injected by CLI composition.
- Produces: `PackagedReleaseSourceV1`, `CliBootstrapContext`, `BootstrapExecutor`, fresh `init --dry-run` V2 preview, and real fresh V2 init with fallback bundle/metadata/trust/active/nonce/allocator/reservation/manifest handoff.

- [x] **Step 1: Write failing fresh-init and death-injection tests**

```ts
it("creates a complete V2 handoff without network or vendor calls", async () => {
  const result = await runFreshInit(fixture);
  expect(result.manifest.schemaVersion).toBe(2);
  expect(fixture.releaseRequests).toEqual([]);
  expect(fixture.vendorProcesses).toEqual([]);
  expect(await fixture.assertCompleteV2Handoff()).toBe(true);
});

it.each(freshInitDeathPoints)("recovers $name", async point => {
  const interrupted = await runFreshInitUntil(point);
  await interrupted.resumeInit();
  expect(await interrupted.assertTerminalState()).toBe(point.expectedTerminal);
});
```

Assert the bootstrap/global lock order, second inventory, exact external shape hash, payload evidence before each create, global lock first, ordinary path order, Foundation pairs, fixed launchability suffix, active last, manifest point of no return, reverse compensation, plan-last compaction, dry-run byte inertness, and zero network/Git/launchd/vendor/model calls.

- [x] **Step 2: Run fresh-init tests and verify V1 behavior fails the new contract**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts && npx vitest run --root apps/cli src/bootstrap/executor.test.ts src/update/packaged-release.test.ts src/commands/init.test.ts`

Expected: FAIL because current init writes V1 directly and no packaged release admission exists.

- [x] **Step 3: Implement plan-first V2 fresh init**

```ts
export class BootstrapExecutor {
  planFreshInit(request: FreshInitRequestV1): Promise<FreshV2InitPlanV1>;
  executeFreshInit(plan: FreshV2InitPlanV1): Promise<FreshInitOutcomeV1>;
  recover(closure: BootstrapClosureV1): Promise<FreshInitOutcomeV1>;
}
```

Verify the packaged fallback metadata/inventory offline, stage every payload and initial Foundation journal before creation authority, create the exact permanent lifecycle/release/runtime roots and ephemeral reservations, publish trust then active last in the launchability suffix, transition the manifest through Task 5, and verify the complete V2 handoff before compaction.

Keep `CliContext`'s existing command-wide contract source-compatible: expose bootstrap as an optional, narrow `CliBootstrapContext` projection and consult it only on the fresh-init arm. The projection distinguishes `available` from the fixed `unavailable_until_packaged_handoff` state. Only an admitted available source selects fresh V2; a present-but-invalid source refuses before mutation and never falls back. Until Tasks 10–11 bind the root-verified launcher/Homebrew handoff, absent or explicitly unavailable composition retains the existing fresh V1 writer as a checkpoint compatibility arm, which Task 9 later migrates through the normal V1 path. `createProductionContext` carries the explicit unavailable state and the shared command fixture defaults to it; only Task 7 fresh-V2 tests inject the synthetic available projection. This keeps unrelated command suites on their existing V1 setup without forcing unrelated direct `CliContext` literals to fabricate bootstrap authority or making the heavyweight death matrix run for every fixture.

`PackagedReleaseSourceV1` is an injected, fail-closed capability over an already guarded package root, retained metadata set, selected release identity, and exact bundle inventory. Task 7 validates every supplied structural/hash/path/inode equality and stages only through the resulting opaque admission, but it does not duplicate Task 11's Ed25519 implementation, invent unsigned embedded release assets, accept an environment/custom path, or perform transport. Tests inject a synthetic local capability. The later stable-launcher/security/package tasks bind the same interface to root-verified Homebrew bytes and remove the temporary unavailable/V1 compatibility arm; invalid attempted admission is always a refusal rather than a compatibility fallback.

Close the discovered Task 6/7 payload seam in the shared bootstrap grammar. Every non-remove `FoundationMutationRefV1` carries distinct `content` and `.sha256` digest bootstrap refs bound to its exact standard Foundation staging paths, hash, and size; remove mutations carry null for both. Both refs participate in the complete use-once bijection. Add the closed repeatable `foundation_staged_digest` plan-derived role, and the single fresh-only `foundation_config` role that reconstructs the existing strict `serializeConfig` TOML bytes from a complete `DeveloperOsConfigV1`. This is the sole generated Foundation content exception: all other fresh Foundation bytes remain `guarded_package_file`, migration bytes remain guarded preimages, no raw bytes or serializer callback enter the plan, and the redaction key remains secret-opaque outside manifest/bootstrap payloads. Publish and verify every staged Foundation blob/digest inode before the matching initial-journal bridge; partial pairs recover only from their outer payload evidence.

- [x] **Step 4: Run fresh-init tests**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts && npx vitest run --root apps/cli src/bootstrap/executor.test.ts src/update/packaged-release.test.ts src/commands/init.test.ts`

Expected: PASS for dry-run, success, compensation, force-forward, and every injected death point.

- [x] **Step 5: Commit Task 7**

```bash
git add packages/core/src/manifest/bootstrap.ts packages/core/src/manifest/bootstrap.test.ts apps/cli/src/bootstrap/context.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/executor.test.ts apps/cli/src/update/packaged-release.ts apps/cli/src/update/packaged-release.test.ts apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts apps/cli/src/commands/testing.ts apps/cli/src/context.ts apps/cli/src/context.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): initialize manifest v2 installations"
```

### Task 8: Map strict migratable V1 state into V2

**Files:**
- Create: `packages/core/src/manifest/migration.ts`
- Create: `packages/core/src/manifest/migration.test.ts`
- Modify: `packages/core/src/manifest/index.ts`
- Create: `apps/cli/src/bootstrap/migration.ts`
- Create: `apps/cli/src/bootstrap/migration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7, strict migratable V1 bytes/artifacts/backups, packaged release source.
- Produces: `mapManifestV1ToV2`, `planManifestMigration`, migration feasibility/admission, and the concrete bootstrap migration plan with exact old/new manifest hashes and launchability set.

- [ ] **Step 1: Write failing mapping and preflight-order tests**

```ts
it("maps config alone to schema and copies every historical field", () => {
  const mapped = mapManifestV1ToV2(v1Fixture);
  expect(mapped.artifacts.find(a => a.path.endsWith("config.toml"))?.verification.mode).toBe("schema");
  expect(projectHistoricalFields(mapped)).toEqual(projectHistoricalFields(v1Fixture));
});

it.each(nonMigratableFixtures)("refuses $name before managed bytes", async fixture => {
  await expect(planManifestMigration(fixture.request)).rejects.toThrow();
  expect(fixture.artifactReads).toBe(0);
});
```

Cover every mapping row, safe regular files/directories, restore evidence, config schema, V2-only path collisions on declared and canonical paths, incomplete Foundation state, V1 drift, missing/wrong backups, symlink/config-entry/shared-directory, capacity, and first violated validation before artifact/backup reads.

- [ ] **Step 2: Run migration planning tests and verify missing mapping fails**

Run: `npx vitest run --root packages/core src/manifest/migration.test.ts && npx vitest run --root apps/cli src/bootstrap/migration.test.ts`

Expected: FAIL because mapping and migration planning are absent.

- [ ] **Step 3: Implement pure mapping and guarded concrete planning**

```ts
export function mapManifestV1ToV2(
  manifest: MigratableInstallationManifestV1,
  additions: readonly ManagedArtifactV2[],
): InstallationManifestV2;

export async function planManifestMigration(
  request: ManifestMigrationRequestV1,
): Promise<ManifestMigrationPlanV1>;
```

Complete all structural/collision checks before opening artifact bytes, then guarded-read and hash every current/backup authority, verify packaged release capacity, and derive the exact payload/use-once/created/Foundation/launchability/manifest partitions without mutation.

- [ ] **Step 4: Run migration planning tests**

Run: `npx vitest run --root packages/core src/manifest/migration.test.ts && npx vitest run --root apps/cli src/bootstrap/migration.test.ts`

Expected: PASS with exact refusal ordering and mapping equality.

- [ ] **Step 5: Commit Task 8**

```bash
git add packages/core/src/manifest/migration.ts packages/core/src/manifest/migration.test.ts packages/core/src/manifest/index.ts apps/cli/src/bootstrap/migration.ts apps/cli/src/bootstrap/migration.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): plan manifest v1 migration"
```

### Task 9: Execute/recover V1 migration and prove the Spec 1 V2 handoff

**Files:**
- Modify: `apps/cli/src/bootstrap/executor.ts`
- Modify: `apps/cli/src/bootstrap/executor.test.ts`
- Modify: `apps/cli/src/bootstrap/migration.ts`
- Modify: `apps/cli/src/bootstrap/migration.test.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/commands/init.test.ts`
- Create: `tests/e2e/manifest-v2-bootstrap.test.ts`
- Modify: `tests/security/network.test.ts`
- Modify: `docs/architecture/foundation.md`
- Modify: `docs/architecture/threat-model.md`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: `init`-only migration resume/compensation/compaction, strict V2 handoff admission for later Spec 1 commands, and committed prerequisite evidence.

- [ ] **Step 1: Write failing end-to-end migration/recovery tests**

```ts
it("migrates an exact synthetic V1 installation and preserves every managed byte", async () => {
  const before = await fixture.inventoryManagedBytes();
  await fixture.run(["init"]);
  expect(await fixture.inventoryHistoricalManagedBytes()).toEqual(before);
  expect((await fixture.readManifest()).schemaVersion).toBe(2);
  expect(await fixture.assertSpec1Handoff()).toBe(true);
});

it.each(manifestMigrationDeathPoints)("recovers death at $name", async point => {
  const interrupted = await fixture.interruptMigration(point);
  await interrupted.run(["init"]);
  expect(await interrupted.assertExpectedDirection()).toBe(true);
});
```

Include plan/journal temp/final, every payload source/write/evidence, every created path/evidence, Foundation participant, launchability publication, manifest preserve/publish, point of no return, verification/compaction, source change before/after payload cursor, orphan/third-state/two-ID cases, and explicit zero request/process assertions.

- [ ] **Step 2: Run the prerequisite E2E/focused suite and verify incomplete migration behavior fails**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts src/bootstrap/migration.test.ts src/commands/init.test.ts && npx vitest run --root tests e2e/manifest-v2-bootstrap.test.ts security/network.test.ts`

Expected: FAIL until migration execution, `init` routing, recovery closure, and network classification are complete.

- [ ] **Step 3: Implement migration execution and close the V2 handoff**

Route `init` by strict absent/V1/V2/bootstrap-closure state: fresh V2, V1 migration, resume the one recorded envelope, or ordinary V2 init behavior. Reuse Task 7's executor with the migration plan arm; preserve pre-plan skeletons; compensate to byte-identical V1 before manifest publication; force-forward after V2 publication; compact journal then plan last. Reject every non-`init` command over V1 or non-terminal bootstrap state.

- [ ] **Step 4: Run focused and full gates, then obtain fresh review**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts src/bootstrap/migration.test.ts src/commands/init.test.ts`

Run: `npx vitest run --root tests e2e/manifest-v2-bootstrap.test.ts security/network.test.ts`

Run: `npm run check`

Expected: PASS. Request a fresh reviewer verdict on Tasks 1–9. For every accepted finding, first add a focused failing regression, then make the smallest correction and rerun all three commands until the reviewer returns `READY`.

- [ ] **Step 5: Commit the prerequisite checkpoint and advance to Spec 1**

```bash
git add apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/executor.test.ts apps/cli/src/bootstrap/migration.ts apps/cli/src/bootstrap/migration.test.ts apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts tests/e2e/manifest-v2-bootstrap.test.ts tests/security/network.test.ts docs/architecture/foundation.md docs/architecture/threat-model.md docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat: migrate installations to manifest v2"
```

After this commit, execute `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md` Tasks 1–24. Treat Task 1's shared canonical/lifecycle files as existing prerequisite outputs and extend/import them without changing the approved Spec 1 semantics. Do not start Task 10 below until the Spec 1 checkpoint is committed and green.

## Checkpoint B — Release and update after Spec 1

### Task 10: Add macOS launcher admission and the stable launcher application

**Files:**
- Create: `packages/platform-macos/src/launcher/types.ts`
- Create: `packages/platform-macos/src/launcher/admission.ts`
- Create: `packages/platform-macos/src/launcher/admission.test.ts`
- Create: `packages/platform-macos/src/launcher/index.ts`
- Modify: `packages/platform-macos/src/index.ts`
- Create: `apps/launcher/package.json`
- Create: `apps/launcher/tsconfig.json`
- Create: `apps/launcher/vitest.config.ts`
- Create: `apps/launcher/src/environment.ts`
- Create: `apps/launcher/src/environment.test.ts`
- Create: `apps/launcher/src/selection.ts`
- Create: `apps/launcher/src/selection.test.ts`
- Create: `apps/launcher/src/main.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Checkpoint A release/manifest/bootstrap records, Spec 1 lifecycle closure, Security guarded-path/signature ports through injected interfaces.
- Produces: `LauncherPlatformIdentityV1`, `LauncherBundleAdmission`, `LauncherSelectionV1`, `LauncherEnvironmentV1`, normal active/fallback and strict bootstrap recovery routing, shell-free absolute execution request.

- [ ] **Step 1: Write failing platform/environment/selection tests**

```ts
it("falls back only when active state is absent", async () => {
  expect((await selectLauncherCandidate(absentActiveFixture())).kind).toBe("package_fallback");
  await expect(selectLauncherCandidate(malformedActiveFixture())).rejects.toMatchObject({ code: 6 });
});

it("passes only the closed path context", () => {
  expect(buildLauncherEnvironment(envFixture)).toEqual({
    HOME: "/Users/test",
    DEVELOPER_OS_HOME: "/Users/test/.developer-os",
  });
});
```

Cover Darwin arm64/x64 admission, unsupported platform/architecture, exact product-home grammar, optional Brain override grammar without opening it, recovery-required bootstrap routing restricted to `init`, valid launchability suffix, active record/trust/metadata/bundle/manifest set equality, present-invalid refusal, no PATH execution, and one read-only FD 3 reservation.

- [ ] **Step 2: Run launcher tests and verify the app/modules are absent**

Run: `npx vitest run --root packages/platform-macos src/launcher/admission.test.ts && npx vitest run --root apps/launcher src/environment.test.ts src/selection.test.ts`

Expected: FAIL because launcher packages and workspace configuration do not exist.

- [ ] **Step 3: Implement guarded launcher selection and process request construction**

```ts
export type LauncherSelectionV1 =
  | { readonly kind: "package_fallback"; readonly bundle: AdmittedReleaseBundleV1 }
  | { readonly kind: "active_release"; readonly bundle: AdmittedReleaseBundleV1 }
  | { readonly kind: "bootstrap_recovery"; readonly bundle: AdmittedReleaseBundleV1; readonly argv: readonly ["init"] };

export async function selectLauncherCandidate(
  request: LauncherSelectionRequestV1,
): Promise<LauncherSelectionV1>;
```

Open every record/tree through no-follow owner/mode/link/size and before/after inode checks; enumerate non-empty exact inventory sets; validate retained metadata/trust/manifest equality before selecting. Build absolute runtime/entrypoint argv and an exact environment object; never inherit or merge process environment.

- [ ] **Step 4: Run launcher tests and workspace build**

Run: `npx vitest run --root packages/platform-macos src/launcher/admission.test.ts && npx vitest run --root apps/launcher src/environment.test.ts src/selection.test.ts`

Run: `pnpm --pm-on-fail=ignore build`

Expected: PASS with the launcher project included in the build graph.

- [ ] **Step 5: Commit Task 10**

```bash
git add packages/platform-macos/src/launcher/types.ts packages/platform-macos/src/launcher/admission.ts packages/platform-macos/src/launcher/admission.test.ts packages/platform-macos/src/launcher/index.ts packages/platform-macos/src/index.ts apps/launcher/package.json apps/launcher/tsconfig.json apps/launcher/vitest.config.ts apps/launcher/src/environment.ts apps/launcher/src/environment.test.ts apps/launcher/src/selection.ts apps/launcher/src/selection.test.ts apps/launcher/src/main.ts pnpm-workspace.yaml tsconfig.json vitest.config.ts pnpm-lock.yaml docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(launcher): select guarded release bundles"
```

### Task 11: Verify the offline root handoff and signed metadata chain

**Files:**
- Create: `packages/security/src/update/signatures.ts`
- Create: `packages/security/src/update/signatures.test.ts`
- Create: `packages/security/src/update/handoff.ts`
- Create: `packages/security/src/update/handoff.test.ts`
- Create: `packages/security/src/update/index.ts`
- Modify: `packages/security/src/index.ts`
- Create: `apps/launcher/src/handoff.ts`
- Create: `apps/launcher/src/handoff.test.ts`
- Modify: `apps/launcher/src/main.ts`

**Interfaces:**
- Consumes: Task 2 signed-document schemas and Task 10 launcher admission.
- Produces: `verifySignedReleaseDocument`, `verifyReleaseMetadataChain`, `readOfflineReleaseTrustFd`, `renderOfflineReleaseTrustPipe`, launcher-owned compiled trust constants and exact FD 3 handoff.

- [ ] **Step 1: Write failing signature/domain/descriptor tests**

```ts
it("verifies the exact domain-separated Ed25519 bytes", () => {
  expect(verifySignedReleaseDocument(vector.document, vector.currentRoot)).toEqual(vector.signed);
});

it.each(signatureMutations)("refuses $name", mutation => {
  expect(() => verifyReleaseMetadataChain(mutation.chain)).toThrow(SecurityRefusalError);
});
```

Cover key-ID/raw-key equality, 32-byte public and 64-byte signature lengths, base64url without padding, one signature, document kind/domain/canonical bytes, current root online delegation, current/previous root retained metadata, one pipe, 64-KiB EOF, extra inherited descriptors, parent launcher identity, and close-before-context behavior.

- [ ] **Step 2: Run signature/handoff tests and verify missing verifier fails**

Run: `npx vitest run --root packages/security src/update/signatures.test.ts src/update/handoff.test.ts && npx vitest run --root apps/launcher src/handoff.test.ts`

Expected: FAIL because signature and descriptor handoff modules are absent.

- [ ] **Step 3: Implement Ed25519 verification and exact pipe handoff**

```ts
export function verifySignedReleaseDocument<TKind extends string, TSigned>(
  document: SignedReleaseDocumentV1<TKind, TSigned>,
  key: OfflineRootKeyV1 | DelegatedReleaseKeyV1,
): TSigned;

export async function readOfflineReleaseTrustFd(
  descriptor: number,
  dependencies: OfflineTrustReaderDependencies,
): Promise<OfflineReleaseTrustV1>;
```

Use `node:crypto.verify(null, ...)` over the exact domain plus no-LF canonical `signed` bytes. The launcher writes canonical JSON plus LF to a fresh pipe, passes only read FD 3, and closes its write side; the CLI validates pipe type/EOF/size/parent/descriptor set and closes it before any descendant can inherit it.

- [ ] **Step 4: Run signature/handoff tests**

Run: `npx vitest run --root packages/security src/update/signatures.test.ts src/update/handoff.test.ts && npx vitest run --root apps/launcher src/handoff.test.ts`

Expected: PASS for current/retained root and all mutation vectors.

- [ ] **Step 5: Commit Task 11**

```bash
git add packages/security/src/update/signatures.ts packages/security/src/update/signatures.test.ts packages/security/src/update/handoff.ts packages/security/src/update/handoff.test.ts packages/security/src/update/index.ts packages/security/src/index.ts apps/launcher/src/handoff.ts apps/launcher/src/handoff.test.ts apps/launcher/src/main.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(security): verify release metadata trust"
```

### Task 12: Implement fixed-origin bounded HTTPS transport

**Files:**
- Create: `packages/security/src/update/transport.ts`
- Create: `packages/security/src/update/transport.test.ts`
- Modify: `packages/security/src/update/index.ts`
- Modify: `tests/security/network.test.ts`

**Interfaces:**
- Consumes: Task 2 origin/relative-path schemas and Task 11 verified delegation/handoff.
- Produces: `FixedReleaseTransport`, `ReleaseTransportRequestV1`, `BoundedReleaseResponseV1`, shared top-level attempt deadline and redirect/origin enforcement.

- [ ] **Step 1: Write failing local-server transport tests**

```ts
it("follows one delegated redirect and no second redirect", async () => {
  expect((await transport.get(validRedirectRequest)).bodyHash).toBe(expectedHash);
  await expect(transport.get(twoRedirectRequest)).rejects.toMatchObject({ code: 5 });
});

it("inherits no proxy or credential environment", async () => {
  await transport.get(request, { HTTPS_PROXY: "http://127.0.0.1:1", NETRC: "secret" });
  expect(server.headers).not.toHaveProperty("authorization");
});
```

Cover fixed metadata locators, delegated asset origins, pre-request redirect validation, effective URL equality, HTTPS/443 only, no userinfo/query/fragment change, 64-KiB headers, body declared/observed limits, DNS/connect/TLS/header/idle/body/wall deadlines, one redirect, whole process termination/reaping, and content-free diagnostics.

- [ ] **Step 2: Run transport/network tests and verify missing classified entrypoint fails**

Run: `npx vitest run --root packages/security src/update/transport.test.ts && npx vitest run --root tests security/network.test.ts`

Expected: FAIL because release transport is absent and the network classifier has no update-only row.

- [ ] **Step 3: Implement injected HTTPS transport with one attempt budget**

```ts
export class FixedReleaseTransport {
  constructor(readonly dependencies: FixedReleaseTransportDependencies) {}
  get(request: ReleaseTransportRequestV1): Promise<BoundedReleaseResponseV1>;
}
```

Build URLs only by appending validated segments to the signed prefix, send GET with a closed header set, remove proxy/credential environment rather than merging it, stream under declared limits, and share one monotonic deadline across redirects and descendants.

- [ ] **Step 4: Run transport/network tests**

Run: `npx vitest run --root packages/security src/update/transport.test.ts && npx vitest run --root tests security/network.test.ts`

Expected: PASS with update as the only release-network entrypoint and every other command at zero.

- [ ] **Step 5: Commit Task 12**

```bash
git add packages/security/src/update/transport.ts packages/security/src/update/transport.test.ts packages/security/src/update/index.ts tests/security/network.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(security): add fixed release transport"
```

### Task 13: Admit zstd-ustar bundles through guarded scratch

**Files:**
- Create: `packages/security/src/update/archive.ts`
- Create: `packages/security/src/update/archive.test.ts`
- Create: `packages/security/src/update/scratch.ts`
- Create: `packages/security/src/update/scratch.test.ts`
- Modify: `packages/security/src/update/index.ts`

**Interfaces:**
- Consumes: Tasks 1–2 bundle schemas and Task 12 bounded response stream.
- Produces: `ZstdUstarAdmission`, `ReleasePlanningScratchV1`, `ReleasePlanningScratchJournalV1`, scratch entry evidence, verified extracted bundle root, cleanup-only crash recovery.

- [ ] **Step 1: Write failing archive corpus and scratch-death tests**

```ts
it.each(rejectedArchiveCorpus)("refuses $name without product mutation", async fixture => {
  await expect(admitArchive(fixture.bytes, fixture.manifest)).rejects.toThrow();
  expect(fixture.productWrites).toEqual([]);
});

it.each(scratchDeathPoints)("cleans only recorded identities at $name", async point => {
  const state = await interruptScratch(point);
  await state.cleanup();
  expect(await state.assertNoUnknownDeletion()).toBe(true);
});
```

Corpus covers standard-frame content size/checksum/dictionary/skippable/concatenated/trailing/window, POSIX ustar checksum/magic/octal/uid/gid/type/padding/EOF, PAX/GNU/base-256/sparse/link/special refusal, path aliases/traversal, manifest order/equality, exact/max/first-over bytes/entries/path/memory/temp, and scratch create-intent/identity/evidence/cleanup states.

- [ ] **Step 2: Run archive/scratch tests and verify no parser exists**

Run: `npx vitest run --root packages/security src/update/archive.test.ts src/update/scratch.test.ts`

Expected: FAIL because archive admission and scratch journaling are absent.

- [ ] **Step 3: Implement fixed parser and identity-bound scratch state machine**

```ts
export class ZstdUstarAdmission {
  extract(request: ArchiveAdmissionRequestV1): Promise<VerifiedScratchBundleV1>;
}

export class ReleasePlanningScratchStore {
  create(plan: ReleasePlanningScratchV1): Promise<ReleasePlanningScratchJournalV1>;
  recoverCleanup(id: ReleasePlanningAttemptIdV1): Promise<void>;
}
```

Validate the Zstandard frame header before using Node's bounded decompressor; parse only 512-byte ustar blocks; create parents/files exclusively with actual inode journal states before content; publish one evidence file per manifest ordinal; cleanup the derived reached list only, plan and journal last, without recursive removal or content adoption after death.

- [ ] **Step 4: Run archive/scratch tests**

Run: `npx vitest run --root packages/security src/update/archive.test.ts src/update/scratch.test.ts`

Expected: PASS over the full synthetic corpus and death matrix.

- [ ] **Step 5: Commit Task 13**

```bash
git add packages/security/src/update/archive.ts packages/security/src/update/archive.test.ts packages/security/src/update/scratch.ts packages/security/src/update/scratch.test.ts packages/security/src/update/index.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(security): admit signed release archives"
```

### Task 14: Define deterministic update/rollback previews and capacity projections

**Files:**
- Create: `packages/core/src/update/preview.ts`
- Create: `packages/core/src/update/preview.test.ts`
- Create: `packages/core/src/update/capacity.ts`
- Create: `packages/core/src/update/capacity.test.ts`
- Modify: `packages/core/src/update/index.ts`

**Interfaces:**
- Consumes: release identities, Manifest V2, Spec 1 owners/lifecycle state.
- Produces: `OwnerUpdatePreviewV1`, `SchemaMigrationPreviewV1`, `UpdateCapacityProjectionV1`, `UpdatePlanPreviewV1`, `UpdateRollbackPreviewV1`, `PreparedUpdateCandidateV1`, `PreparedUpdateMaterializationV1`, `previewHash`, exact capacity component arithmetic.

- [ ] **Step 1: Write failing deterministic preview/capacity tests**

```ts
it("renders identical previews under reversed provider input", () => {
  expect(buildUpdatePreview(input)).toEqual(buildUpdatePreview(reverseInput(input)));
});

it("refuses the first insufficient byte or inode without publishing fits", () => {
  expect(() => projectUpdateCapacity(firstOverCapacity)).toThrow();
});
```

Cover exact owner path partitions/count equality/disjointness/order, migration affected paths, lossy human `SafeRenderedPathV1` only, canonical JSON exact paths, preview hash self-omission, private materialization hashes/projections, capacity unique component order, zero-byte inode scopes, checked sums, exact fit, first-over byte/entry, update/rollback operation-specific fields.

- [ ] **Step 2: Run preview/capacity tests and verify missing schemas fail**

Run: `npx vitest run --root packages/core src/update/preview.test.ts src/update/capacity.test.ts`

Expected: FAIL because preview/materialization/capacity types are absent.

- [ ] **Step 3: Implement pure builders and validators**

```ts
export function buildUpdatePreview(input: UpdatePreviewInputV1): UpdatePlanPreviewV1;
export function buildRollbackPreview(input: RollbackPreviewInputV1): UpdateRollbackPreviewV1;
export function projectUpdateCapacity(input: UpdateCapacityInputV1): UpdateCapacityProjectionV1;
```

Use canonical owner/migration orders, byte-exact branded paths, domain-separated projections, and checked integer arithmetic. Never include internal transcript, blob, inverse, inventory, or binding hashes in public output.

- [ ] **Step 4: Run preview/capacity tests**

Run: `npx vitest run --root packages/core src/update/preview.test.ts src/update/capacity.test.ts`

Expected: PASS with stable byte identity and boundary arithmetic.

- [ ] **Step 5: Commit Task 14**

```bash
git add packages/core/src/update/preview.ts packages/core/src/update/preview.test.ts packages/core/src/update/capacity.ts packages/core/src/update/capacity.test.ts packages/core/src/update/index.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): define update previews and capacity"
```

### Task 15: Implement counted planner wire protocol, process supervision, and graph absence gate

**Files:**
- Create: `packages/core/src/update/planner.ts`
- Create: `packages/core/src/update/planner.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `packages/security/src/update/planner-process.ts`
- Create: `packages/security/src/update/planner-process.test.ts`
- Create: `packages/security/src/update/graph.ts`
- Create: `packages/security/src/update/graph.test.ts`
- Modify: `packages/security/src/update/index.ts`
- Modify: `tests/repository/check.ts`
- Modify: `tests/repository/check.test.ts`

**Interfaces:**
- Consumes: Task 14 materialization inputs and existing process/redaction primitives.
- Produces: planner request/draft/token/blob schemas, `PlannerWireBoundsV1`, `PlannerTranscriptIdentityV1`, `PlannerWireEncoder`, `PlannerWireDecoder`, `TargetPlannerSupervisor`, and transitive compiled-graph capability absence classification.

- [ ] **Step 1: Write failing frame/process/graph tests**

```ts
it("round-trips one request, contiguous blobs, and end frame", async () => {
  expect(await decodePlannerInput(encodePlannerInput(request, blobs))).toEqual({ request, blobs });
});

it.each(wireMutations)("refuses $name and reaps the child", async mutation => {
  await expect(supervisor.run(mutation.input)).rejects.toThrow();
  expect(mutation.process.reaped).toBe(true);
});

it("enumerates a non-empty graph with no forbidden capability", () => {
  const graph = inspectPlannerGraph(compiledPlannerEntrypoint);
  expect(graph.modules.length).toBeGreaterThan(0);
  expect(graph.forbidden).toEqual([]);
});
```

Cover magic, kind/order/length/end/trailing bytes, contiguous ordinals, reference equality, request/result 256-MiB, 16-MiB blobs, 1,000,000/1-GiB direction totals, transcript hash domains, secret scan before hashes, exact environment/descriptors/cwd, RSS/idle/wall/process/stderr caps, termination/reaping, and fs/network/process/env/clock/random/native/worker/dynamic-import graph exclusions.

- [ ] **Step 2: Run protocol/supervisor/repository tests and verify missing gates fail**

Run: `npx vitest run --root packages/core src/update/planner.test.ts && npx vitest run --root packages/security src/update/planner-process.test.ts src/update/graph.test.ts && npx vitest run --root tests repository/check.test.ts`

Expected: FAIL because planner protocol, supervisor, and graph classification are absent.

- [ ] **Step 3: Implement streaming frames and one-process supervision**

```ts
export class TargetPlannerSupervisor {
  run(request: TargetPlannerRunRequestV1): Promise<TargetPlannerRunResultV1>;
}

export function materializePlannerDraft(
  request: UpdatePlannerRequestV1,
  draft: TargetUpdateDraftV1,
  outputBlobs: readonly SecretScreenedBlobV1[],
): PreparedUpdateCandidateV1;
```

Parse incrementally without allocating declared lengths above remaining caps, secret-screen each complete frame before hashing or construction, retain the token-to-absolute map only in current process memory, and make the repository graph enumerator total and non-empty per entrypoint.

- [ ] **Step 4: Run protocol/supervisor/repository tests**

Run: `npx vitest run --root packages/core src/update/planner.test.ts && npx vitest run --root packages/security src/update/planner-process.test.ts src/update/graph.test.ts && npx vitest run --root tests repository/check.test.ts`

Expected: PASS across frame, bound, process, and graph mutations.

- [ ] **Step 5: Commit Task 15**

```bash
git add packages/core/src/update/planner.ts packages/core/src/update/planner.test.ts packages/core/src/update/index.ts packages/security/src/update/planner-process.ts packages/security/src/update/planner-process.test.ts packages/security/src/update/graph.ts packages/security/src/update/graph.test.ts packages/security/src/update/index.ts tests/repository/check.ts tests/repository/check.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(security): supervise target update planners"
```

### Task 16: Add complete pure owner update providers

**Files:**
- Create: `packages/core/src/update/owner.ts`
- Create: `packages/core/src/update/owner.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `packages/adapter-claude/src/update/plan.ts`
- Create: `packages/adapter-claude/src/update/plan.test.ts`
- Create: `packages/adapter-codex/src/update/plan.ts`
- Create: `packages/adapter-codex/src/update/plan.test.ts`
- Modify: `packages/adapter-claude/src/index.ts`
- Modify: `packages/adapter-codex/src/index.ts`

**Interfaces:**
- Consumes: planner token/path/content schemas, current adapter render/install contracts, Spec 1 owner enum/Foundation paths.
- Produces: `OwnerUpdateDraftV1`, `PlannerChangePlanOperationV1`, `OwnerExternalEffectDraftV1`, `OwnerUpdateProviderV1`, complete closed owner registry, Claude file-only provider, Codex file plus one registration-refresh draft.

- [ ] **Step 1: Write failing completeness/root-free/provider tests**

```ts
it("calls exactly one provider for every installed owner and none for absent owners", () => {
  const result = planOwners(registry, snapshot);
  expect(result.map(row => row.owner)).toEqual(installedOwners);
  expect(absentProvider.calls).toBe(0);
});

it("keeps adapter drafts root-free", () => {
  expect(JSON.stringify(planCodexOwner(request))).not.toContain(request.productHome);
});
```

Cover non-empty current partitions, keep/create/replace/remove target arms, content dependency declaration, owner-relative containment after rehydration, parent kept directory requirement, directory/symlink/ephemeral keep-only, 16-MiB changed-file cap, absent optional owner, missing/duplicate provider, second effect, non-Codex effect, and exact one Codex refresh token set.

- [ ] **Step 2: Run owner/provider tests and verify missing planners fail**

Run: `npx vitest run --root packages/core src/update/owner.test.ts && npx vitest run --root packages/adapter-claude src/update/plan.test.ts && npx vitest run --root packages/adapter-codex src/update/plan.test.ts`

Expected: FAIL because owner schemas/providers do not exist.

- [ ] **Step 3: Implement pure root-free providers and registry validation**

```ts
export interface OwnerUpdateProviderV1 {
  readonly owner: ArtifactOwner;
  readonly contentDependencies: (snapshot: PlannerManifestSnapshotV1) => readonly PlannerPathTokenV1[];
  readonly plan: (request: OwnerUpdateProviderRequestV1) => OwnerUpdateDraftV1;
}

export function validateOwnerDraft(
  draft: OwnerUpdateDraftV1,
  snapshot: PlannerManifestSnapshotV1,
): OwnerUpdateDraftV1;
```

Reuse adapter render trees only as target-bundle/owner-relative data; do not read a home or vendor state. Validate complete current-token equality and all collisions before rehydrating concrete paths in the current executor.

- [ ] **Step 4: Run owner/provider tests**

Run: `npx vitest run --root packages/core src/update/owner.test.ts && npx vitest run --root packages/adapter-claude src/update/plan.test.ts && npx vitest run --root packages/adapter-codex src/update/plan.test.ts`

Expected: PASS for Claude-only, Codex-only, dual, and absent-owner matrices.

- [ ] **Step 5: Commit Task 16**

```bash
git add packages/core/src/update/owner.ts packages/core/src/update/owner.test.ts packages/core/src/update/index.ts packages/adapter-claude/src/update/plan.ts packages/adapter-claude/src/update/plan.test.ts packages/adapter-codex/src/update/plan.ts packages/adapter-codex/src/update/plan.test.ts packages/adapter-claude/src/index.ts packages/adapter-codex/src/index.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(adapters): plan managed owner updates"
```

### Task 17: Implement ordered product and Brain schema migration planning

**Files:**
- Create: `packages/core/src/update/migrations.ts`
- Create: `packages/core/src/update/migrations.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `packages/brain/src/migrations/update/plan.ts`
- Create: `packages/brain/src/migrations/update/plan.test.ts`
- Create: `packages/brain/src/migrations/update/index.ts`
- Modify: `packages/brain/src/migrations/index.ts`

**Interfaces:**
- Consumes: planner Brain snapshot/token maps, Manifest V2 schema artifacts, Spec 1 Foundation participants.
- Produces: `SchemaMigrationDraftV1`, `SchemaMigrationPlanV1`, `SchemaMigrationMutationV1`, `SchemaMigrationExecutionJournalV1`, `SchemaMigrationRegistryV1`, contiguous chain validation, retained inverse projection.

- [ ] **Step 1: Write failing chain/domain/inverse tests**

```ts
it("orders product-state before Brain and requires contiguous chains", () => {
  expect(orderMigrationChain(validDrafts).map(row => row.domain)).toEqual(["product_state", "brain"]);
  expect(() => orderMigrationChain(missingMiddleStep)).toThrow();
});

it("proves every inverse restores the exact before bytes", () => {
  expect(materializeMigration(validDraft).inverseVerified).toBe(true);
});
```

Cover non-empty unique IDs, domain/from/to ordering, unknown/repeated/cross-domain tokens, current product schema artifact plus owner keep, no new target artifact migration, Brain deny-by-default snapshot membership, before hash, secret-screened after/inverse blobs, per-mutation/plan/Foundation bounds, and zero private output/log/scratch/network bytes.

- [ ] **Step 2: Run migration tests and verify empty registry cannot plan updates**

Run: `npx vitest run --root packages/core src/update/migrations.test.ts && npx vitest run --root packages/brain src/migrations/update/plan.test.ts`

Expected: FAIL because update migration contracts and planners are absent.

- [ ] **Step 3: Implement registry/chain validation and token-only Brain planners**

```ts
export interface SchemaMigrationRegistryV1 {
  readonly productState: readonly SchemaMigrationProviderV1[];
  readonly brain: readonly SchemaMigrationProviderV1[];
}

export function materializeSchemaMigration(
  draft: SchemaMigrationDraftV1,
  context: MigrationMaterializationContextV1,
): SchemaMigrationPlanV1;
```

Keep migrations pure: output plans and inverse blobs, never mutate. Rehydrate only through current executor token maps, stage both directions before outer intent, and bind complete ordered Foundation V2 refs.

- [ ] **Step 4: Run migration tests**

Run: `npx vitest run --root packages/core src/update/migrations.test.ts && npx vitest run --root packages/brain src/migrations/update/plan.test.ts`

Expected: PASS for empty, single, multi-step, and refused-gap chains.

- [ ] **Step 5: Commit Task 17**

```bash
git add packages/core/src/update/migrations.ts packages/core/src/update/migrations.test.ts packages/core/src/update/index.ts packages/brain/src/migrations/update/plan.ts packages/brain/src/migrations/update/plan.test.ts packages/brain/src/migrations/update/index.ts packages/brain/src/migrations/index.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(brain): plan update schema migrations"
```

### Task 18: Persist the pre-intent update construction envelope

**Files:**
- Create: `packages/core/src/update/construction.ts`
- Create: `packages/core/src/update/construction.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `apps/cli/src/update/construction.ts`
- Create: `apps/cli/src/update/construction.test.ts`

**Interfaces:**
- Consumes: Spec 1 allocator/staging roots, Tasks 14–17 prepared candidate/plans/blobs, Manifest participant and Foundation V2 refs.
- Produces: `UpdateConstructionPlanV1`, directory/file/output/rollback-source rows, `UpdateConstructionJournalV1`, evidence/outer-file refs, `UpdateConstructionStore`, pre-handoff compensation and terminal compaction.

- [ ] **Step 1: Write failing construction bijection/death tests**

```ts
it("binds every expected ref to exactly one construction file", () => {
  const plan = buildConstructionPlan(candidate);
  expect(validateConstructionBijections(plan)).toBe(true);
});

it.each(constructionDeathPoints)("compensates planlessly at $name", async point => {
  const fixture = await interruptConstruction(point);
  await fixture.recover();
  expect(await fixture.assertNoTargetMutation()).toBe(true);
});
```

Cover plan/journal pending/rewrite grammars, parent-before-child directories and identities, file/evidence microstates, output frame/consumer persistence, all source arms/projection hashes, participant initial journals, two recovery records, outer plan/journal handoff, construction-only closure arms, actual inode before byte zero, no post-death prefix resume, exact compensation, nested source delegation, and file/evidence then reverse-directory compaction.

- [ ] **Step 2: Run construction tests and verify missing envelope fails**

Run: `npx vitest run --root packages/core src/update/construction.test.ts && npx vitest run --root apps/cli src/update/construction.test.ts`

Expected: FAIL because construction codecs/store/composition are absent.

- [ ] **Step 3: Implement immutable construction planning and journaled publication**

```ts
export class UpdateConstructionStore {
  publish(plan: UpdateConstructionPlanV1): Promise<UpdateConstructionJournalV1>;
  stageDirectories(plan: UpdateConstructionPlanV1): Promise<void>;
  stageFiles(plan: UpdateConstructionPlanV1, frames: AsyncIterable<SecretScreenedBlobV1>): Promise<void>;
  publishOuter(plan: UpdateConstructionPlanV1): Promise<void>;
  recover(closure: UpdateConstructionClosureV1): Promise<void>;
}
```

Derive allocation-dependent bytes after IDs but before the first output frame, prove every private candidate projection again, stream one frame to all exact consumers before releasing it, and make handoff the first state in which any target participant journal may publish.

- [ ] **Step 4: Run construction tests**

Run: `npx vitest run --root packages/core src/update/construction.test.ts && npx vitest run --root apps/cli src/update/construction.test.ts`

Expected: PASS across complete bijection and death matrices.

- [ ] **Step 5: Commit Task 18**

```bash
git add packages/core/src/update/construction.ts packages/core/src/update/construction.test.ts packages/core/src/update/index.ts apps/cli/src/update/construction.ts apps/cli/src/update/construction.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): persist update construction intent"
```

### Task 19: Stage and publish durable release bundles and retained metadata

**Files:**
- Create: `packages/core/src/update/bundle-participant.ts`
- Create: `packages/core/src/update/bundle-participant.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `apps/cli/src/update/bundle-source.ts`
- Create: `apps/cli/src/update/bundle-source.test.ts`
- Create: `apps/cli/src/update/bundle-publication.ts`
- Create: `apps/cli/src/update/bundle-publication.test.ts`

**Interfaces:**
- Consumes: Task 13 verified scratch, Task 18 construction evidence, signed bundle/metadata identities, Spec 1 coordinator staging.
- Produces: `BundleSourceStagingPlanV1`, source journal/evidence/ready proof, `BundlePublicationPlanV1`, publication journal/evidence, publish-target and verify-previous actions with exact compensation/compaction.

- [ ] **Step 1: Write failing source/publication death tests**

```ts
it("copies verified scratch into a durable source before outer intent", async () => {
  const source = await stageBundleSource(request);
  expect(source.ready.inventoryHash).toBe(request.inventoryHash);
  expect(await source.assertExactSet()).toBe(true);
});

it.each(bundlePublicationDeathPoints)("recovers $name", async point => {
  const fixture = await interruptBundlePublication(point);
  await fixture.recover();
  expect(await fixture.assertExpectedDirection()).toBe(true);
});
```

Cover three source structures, manifest-order entries/evidence, ready evidence hashes, source cleanup, target root create/verify, entry/evidence microstates, delegation/index/manifest metadata order, absent-to-present or identical present-to-present only, no-replace publication, compensation metadata/entries/root, publication evidence compaction, and non-empty exact inventory.

- [ ] **Step 2: Run bundle source/publication tests and verify missing participants fail**

Run: `npx vitest run --root packages/core src/update/bundle-participant.test.ts && npx vitest run --root apps/cli src/update/bundle-source.test.ts src/update/bundle-publication.test.ts`

Expected: FAIL because bundle source/publication plans and executors are absent.

- [ ] **Step 3: Implement identity-bound source and publication participants**

```ts
export class BundleSourceExecutor {
  stage(plan: BundleSourceStagingPlanV1, source: VerifiedScratchBundleV1): Promise<BundleSourceReadyEvidenceV1>;
  compensate(plan: BundleSourceStagingPlanV1): Promise<void>;
  compact(plan: BundleSourceStagingPlanV1): Promise<void>;
}

export class BundlePublicationParticipant {
  apply(plan: BundlePublicationPlanV1): Promise<BundlePublicationObservationV1>;
  compensate(plan: BundlePublicationPlanV1): Promise<BundlePublicationObservationV1>;
  compact(plan: BundlePublicationPlanV1): Promise<void>;
}
```

Use construction evidence as authority for source plans/journals, source ready proof as publication authority, and exact manifest/metadata plans as deletion authority. Never recursively delete or replace a retained path.

- [ ] **Step 4: Run bundle source/publication tests**

Run: `npx vitest run --root packages/core src/update/bundle-participant.test.ts && npx vitest run --root apps/cli src/update/bundle-source.test.ts src/update/bundle-publication.test.ts`

Expected: PASS at every source/publication cursor.

- [ ] **Step 5: Commit Task 19**

```bash
git add packages/core/src/update/bundle-participant.ts packages/core/src/update/bundle-participant.test.ts packages/core/src/update/index.ts apps/cli/src/update/bundle-source.ts apps/cli/src/update/bundle-source.test.ts apps/cli/src/update/bundle-publication.ts apps/cli/src/update/bundle-publication.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): stage and publish release bundles"
```

### Task 20: Stage, publish, verify, and retire rollback payloads

**Files:**
- Create: `packages/core/src/update/rollback.ts`
- Create: `packages/core/src/update/rollback.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `apps/cli/src/update/rollback-source.ts`
- Create: `apps/cli/src/update/rollback-source.test.ts`
- Create: `apps/cli/src/update/rollback-publication.ts`
- Create: `apps/cli/src/update/rollback-publication.test.ts`

**Interfaces:**
- Consumes: prepared inverse projections, Task 18 construction rollback source, Task 19 source/publication patterns.
- Produces: `RollbackRecordV1`, payload identity/inventory/entry schemas, bounded aggregate inverse plan and retained owner/migration inverse schemas, source/publication plans/journals/evidence, binding/inventory/inverse hashes, retained verification and exact retirement inventory.

- [ ] **Step 1: Write failing payload/binding/inverse tests**

```ts
it("binds inverse plan, inventory, record, and manifest without a hash cycle", () => {
  const payload = buildRollbackPayload(prepared);
  expect(validateRollbackBindingGraph(payload)).toBe(true);
});

it.each(rollbackPayloadMutations)("refuses $name", mutation => {
  expect(() => validateRollbackPayload(mutation.value)).toThrow();
});
```

Cover contiguous ordinals, role/path mappings, inverse plan leaf and blob exact sets, zero-byte restore, one-chunk 16-MiB bound, 2-GiB aggregate, owner/current/restore state equality, migration inverse order, Codex effect inverse state/policy without payloads, independent rollback binding, source metadata/entry/evidence/ready cursors, five publication structures, manual verify-only arm, compensation, and exact terminal retirement leaves.

- [ ] **Step 2: Run rollback payload tests and verify missing schemas/participants fail**

Run: `npx vitest run --root packages/core src/update/rollback.test.ts && npx vitest run --root apps/cli src/update/rollback-source.test.ts src/update/rollback-publication.test.ts`

Expected: FAIL because rollback schemas and participants are absent.

- [ ] **Step 3: Implement acyclic retained evidence and participant state machines**

```ts
export function buildRollbackPayload(
  candidate: PreparedUpdateCandidateV1,
  allocation: RollbackAllocationV1,
): PreparedRollbackPayloadV1;

export class RollbackPayloadParticipant {
  publish(plan: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1>;
  verifyRetained(plan: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1>;
  compensate(plan: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1>;
  compact(plan: RollbackPayloadStatePlanV1): Promise<void>;
}
```

Build inverse plan → inventory → record → manifest in that order, with containing/allocation hashes excluded exactly as the spec states. Use source construction entries as one-use materialization authorities, publication inventory plus manifest partition for removal, and read-only retained journals until post-point-of-no-return retirement.

- [ ] **Step 4: Run rollback payload tests**

Run: `npx vitest run --root packages/core src/update/rollback.test.ts && npx vitest run --root apps/cli src/update/rollback-source.test.ts src/update/rollback-publication.test.ts`

Expected: PASS across exact maximum and first-over payload/retirement bounds.

- [ ] **Step 5: Commit Task 20**

```bash
git add packages/core/src/update/rollback.ts packages/core/src/update/rollback.test.ts packages/core/src/update/index.ts apps/cli/src/update/rollback-source.ts apps/cli/src/update/rollback-source.test.ts apps/cli/src/update/rollback-publication.ts apps/cli/src/update/rollback-publication.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): retain bounded rollback payloads"
```

### Task 21: Execute owner files, Codex refresh, migrations, and canonical state participants

**Files:**
- Create: `packages/core/src/update/participants.ts`
- Create: `packages/core/src/update/participants.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Create: `apps/cli/src/update/owner-participant.ts`
- Create: `apps/cli/src/update/owner-participant.test.ts`
- Create: `apps/cli/src/update/external-effect.ts`
- Create: `apps/cli/src/update/external-effect.test.ts`
- Create: `apps/cli/src/update/migration-participant.ts`
- Create: `apps/cli/src/update/migration-participant.test.ts`
- Create: `apps/cli/src/update/state-participant.ts`
- Create: `apps/cli/src/update/state-participant.test.ts`

**Interfaces:**
- Consumes: Spec 1 Foundation participant executor, Tasks 16–18 owner/effect/migration/state plans and payload evidence.
- Produces: persisted owner operations/journals, Codex process policy/effect plan/journal/evidence, schema migration execution, canonical state-file plan/journal for metadata/trust/active/rollback record, target verifier plan.

- [ ] **Step 1: Write failing participant order/policy/state tests**

```ts
it("applies owner Foundation rows before its one external effect", async () => {
  await ownerParticipant.apply(plan);
  expect(events).toEqual(["foundation", "codex_observe", "codex_refresh", "codex_observe"]);
});

it("never reverses trust but reverses active before the verifier point", async () => {
  await compensateParticipants(reachedPlan);
  expect(events).toContain("active_restore");
  expect(events).not.toContain("trust_restore");
});
```

Cover owner operation state/content rules, parent kept directories, Foundation forward/paired compensation/ref compaction, external-effect exact executable/argv/cwd/env/stdin/network/model/stream/time/process policy, tokenized registration projections, intent-observe ambiguity, migration forward/inverse and concurrent preconditions, canonical state absent/present/tombstone rules, trust monotonic no-reverse, target verifier read-only graph/bounds/postimage digests.

- [ ] **Step 2: Run participant tests and verify missing executors fail**

Run: `npx vitest run --root packages/core src/update/participants.test.ts && npx vitest run --root apps/cli src/update/owner-participant.test.ts src/update/external-effect.test.ts src/update/migration-participant.test.ts src/update/state-participant.test.ts`

Expected: FAIL because participant plans/executors and closed process policy are absent.

- [ ] **Step 3: Implement table-driven participants over persisted evidence**

```ts
export interface UpdateParticipantAdapterV1 {
  apply(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  observe(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  compensate(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  compact(entry: UpdateCompactionEntryV1): Promise<void>;
}
```

Publish each construction-bound initial journal at its exact coordinator step before mutation, persist direction/cursor before effects, observe and sync evidence before advancing, and allow terminal compaction only from the matching outer compaction entry. Vendor raw output is redacted then hashed; no raw path/value/credential enters state evidence.

- [ ] **Step 4: Run participant tests**

Run: `npx vitest run --root packages/core src/update/participants.test.ts && npx vitest run --root apps/cli src/update/owner-participant.test.ts src/update/external-effect.test.ts src/update/migration-participant.test.ts src/update/state-participant.test.ts`

Expected: PASS across forward, compensation, terminal, and third-state matrices.

- [ ] **Step 5: Commit Task 21**

```bash
git add packages/core/src/update/participants.ts packages/core/src/update/participants.test.ts packages/core/src/update/index.ts apps/cli/src/update/owner-participant.ts apps/cli/src/update/owner-participant.test.ts apps/cli/src/update/external-effect.ts apps/cli/src/update/external-effect.test.ts apps/cli/src/update/migration-participant.ts apps/cli/src/update/migration-participant.test.ts apps/cli/src/update/state-participant.ts apps/cli/src/update/state-participant.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): execute update participants"
```

### Task 22: Add lifecycle coordinator V2, recovery routing, and executor records

**Files:**
- Create: `packages/core/src/update/coordinator.ts`
- Create: `packages/core/src/update/coordinator.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Modify: `packages/core/src/lifecycle/types.ts`
- Modify: `packages/core/src/lifecycle/recovery.ts`
- Modify: `packages/core/src/lifecycle/recovery.test.ts`
- Create: `apps/cli/src/update/coordinator.ts`
- Create: `apps/cli/src/update/coordinator.test.ts`
- Create: `apps/cli/src/update/recovery.ts`
- Create: `apps/cli/src/update/recovery.test.ts`
- Modify: `apps/launcher/src/selection.ts`
- Modify: `apps/launcher/src/selection.test.ts`

**Interfaces:**
- Consumes: Spec 1 lifecycle core/store/allocator/recovery, Tasks 18–21 construction and participant adapters, launcher selection.
- Produces: `UpdateExecutionPlanV1`, `UpdateLifecycleCoordinatorPlanV2`, journal/steps/terminal compaction, `LifecycleExecutionPlanV2`, closure V2 update recovery/construction cleanup/executor cleanup arms, `UpdateRecoveryExecutorRecordV1`, launcher executing/terminal-cleanup routing.

- [ ] **Step 1: Write failing exact-order/recovery/launcher tests**

```ts
it("derives the update step list byte-for-byte", () => {
  expect(deriveUpdateSteps(execution)).toEqual(expectedUpdateSteps);
});

it.each(updateCoordinatorDeathPoints)("recovers $name in the persisted direction", async point => {
  const fixture = await interruptUpdateCoordinator(point);
  await fixture.recoverWithoutNetwork();
  expect(await fixture.assertExpectedTerminal()).toBe(true);
});

it("routes executing to the original bundle and terminal cleanup to fallback", async () => {
  expect((await selectLauncherCandidate(executingFixture)).bundle.identity).toEqual(current);
  expect((await selectLauncherCandidate(cleanupFixture)).kind).toBe("package_fallback");
});
```

Cover exact apply and rollback step arrays, phase from current step, reversible list excluding trust, active/verifier/point-of-no-return, retirement and top-level/nested compaction cursors, V1/V2 strict dispatch at 16 MiB, construction cleanup arms, two executor staged records/initial rename/terminal replacement, fallback protocol equality, envelope suffix cleanup, two/mixed/malformed coordinator refusal, and zero recovery network/planner calls.

- [ ] **Step 2: Run coordinator/recovery/launcher tests and verify V2 dispatch fails**

Run: `npx vitest run --root packages/core src/update/coordinator.test.ts src/lifecycle/recovery.test.ts && npx vitest run --root apps/cli src/update/coordinator.test.ts src/update/recovery.test.ts && npx vitest run --root apps/launcher src/selection.test.ts`

Expected: FAIL because lifecycle schema V2 and recovery routing are absent.

- [ ] **Step 3: Implement strict additive V2 coordinator and recovery**

```ts
export type LifecycleExecutionPlanV2 = LifecycleCoordinatorPlanV1 | UpdateLifecycleCoordinatorPlanV2;

export class UpdateLifecycleCoordinator {
  execute(id: LifecycleCoordinatorIdV1): Promise<UpdateLifecycleOutcomeV1>;
  recover(id: LifecycleCoordinatorIdV1): Promise<UpdateLifecycleOutcomeV1>;
}
```

Reuse the Spec 1 stable lock/store/allocator through injected codecs; never widen its schema-V1 union. Drive only derived steps, persist point of no return after verifier success, force-forward retirement/terminal manifest/compaction afterwards, switch to fallback before removing any possible original executor, and remove executor record only after coordinator envelope absence.

- [ ] **Step 4: Run coordinator/recovery/launcher tests**

Run: `npx vitest run --root packages/core src/update/coordinator.test.ts src/lifecycle/recovery.test.ts && npx vitest run --root apps/cli src/update/coordinator.test.ts src/update/recovery.test.ts && npx vitest run --root apps/launcher src/selection.test.ts`

Expected: PASS across exact forward/reverse/terminal closure tables.

- [ ] **Step 5: Commit Task 22**

```bash
git add packages/core/src/update/coordinator.ts packages/core/src/update/coordinator.test.ts packages/core/src/update/index.ts packages/core/src/lifecycle/types.ts packages/core/src/lifecycle/recovery.ts packages/core/src/lifecycle/recovery.test.ts apps/cli/src/update/coordinator.ts apps/cli/src/update/coordinator.test.ts apps/cli/src/update/recovery.ts apps/cli/src/update/recovery.test.ts apps/launcher/src/selection.ts apps/launcher/src/selection.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(core): recover update lifecycle v2"
```

### Task 23: Add strict plan-only `update` and `update rollback` commands

**Files:**
- Create: `apps/cli/src/commands/update/index.ts`
- Create: `apps/cli/src/commands/update/index.test.ts`
- Create: `apps/cli/src/update/planning.ts`
- Create: `apps/cli/src/update/planning.test.ts`
- Create: `apps/cli/src/update/context.ts`
- Create: `apps/cli/src/update/context.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`
- Modify: `apps/cli/src/commands/output-schemas.ts`
- Modify: `apps/cli/src/commands/output-schemas.test.ts`

**Interfaces:**
- Consumes: Tasks 11–17 metadata/transport/archive/scratch/preview/planner/provider/migration contracts and Spec 1 clear lifecycle admission.
- Produces: strict argv, `UpdateCommandResultV1`, `CliUpdateContext`, `planUpdate`, `planRollback`, human/JSON rendering from the same typed result, plan-only scratch cleanup.

- [ ] **Step 1: Write failing argv/preview/no-mutation tests**

```ts
it.each([
  [["update"], "preview"],
  [["update", "--version", "1.2.3", "--json"], "preview"],
  [["update", "rollback"], "rollback_preview"],
])("accepts %j", async (argv, outcome) => {
  expect((await runMain(argv, fixture)).data.outcome).toBe(outcome);
});

it.each(illegalUpdateArgv)("refuses %j before context/network", async argv => {
  expect((await runMain(argv, fixture)).exitCode).toBe(2);
  expect(fixture.contextBuilds).toBe(0);
  expect(fixture.requests).toEqual([]);
});

it("leaves every durable scope byte-identical after preview", async () => {
  const before = await fixture.durableInventory();
  await runMain(["update"], fixture);
  expect(await fixture.durableInventory()).toEqual(before);
});
```

Cover exact grammar, repeated/unknown/illegal options and version forms, update-only network, fixed trust handoff required, V2/zero drift/clear closure, metadata/selection/archive/planner/provider/migration/capacity validation, up-to-date complete equality, deterministic repeated/reversed preview, exact JSON paths versus human rendering, rollback no-network/current-postimage evidence, and guarded scratch removal/residue cleanup.

- [ ] **Step 2: Run command/planning tests and verify dispatch fails**

Run: `npx vitest run --root apps/cli src/commands/update/index.test.ts src/update/planning.test.ts src/update/context.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: FAIL because update grammar/planning/context are absent.

- [ ] **Step 3: Implement strict dispatch and allocation-free planning**

```ts
export type UpdateCommandResultV1 =
  | { readonly schemaVersion: 1; readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 }
  | { readonly schemaVersion: 1; readonly outcome: "preview"; readonly plan: UpdatePlanPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "applied"; readonly active: ReleaseIdentityV1; readonly rollbackAvailable: true }
  | { readonly schemaVersion: 1; readonly outcome: "rollback_preview"; readonly plan: UpdateRollbackPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "rolled_back"; readonly active: ReleaseIdentityV1; readonly rollbackAvailable: false };
```

Parse command-specific argv before context creation. For update preview, read FD 3 trust, fetch/verify/extract to scratch, create tokenized snapshots, supervise target planner, materialize/secret-screen the private candidate, compute aggregate capacity, publish only its public preview, then remove scratch. For rollback preview, use only retained local evidence.

- [ ] **Step 4: Run command/planning tests**

Run: `npx vitest run --root apps/cli src/commands/update/index.test.ts src/update/planning.test.ts src/update/context.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: PASS with durable-byte identity for both plan-only commands.

- [ ] **Step 5: Commit Task 23**

```bash
git add apps/cli/src/commands/update/index.ts apps/cli/src/commands/update/index.test.ts apps/cli/src/update/planning.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/context.ts apps/cli/src/update/context.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/commands/output-schemas.ts apps/cli/src/commands/output-schemas.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): add plan-first update commands"
```

### Task 24: Orchestrate `update --apply` from revalidation through terminal compaction

**Files:**
- Create: `apps/cli/src/update/apply.ts`
- Create: `apps/cli/src/update/apply.test.ts`
- Modify: `apps/cli/src/commands/update/index.ts`
- Modify: `apps/cli/src/commands/update/index.test.ts`
- Modify: `apps/cli/src/update/context.ts`
- Modify: `apps/cli/src/update/context.test.ts`

**Interfaces:**
- Consumes: all Task 18–23 construction/source/participant/coordinator/planning contracts and same-invocation verified scratch/private candidate.
- Produces: `applyUpdate`, under-lock rerun equality, allocation/construction/outer handoff, exact forward execution, automatic compensation before verifier success, successful applied result and retained rollback availability.

- [ ] **Step 1: Write failing apply/revalidation/automatic-rollback tests**

```ts
it("reruns the planner under lock and refuses any transcript/preview change before allocation", async () => {
  await expect(applyUpdate(changedSecondPlannerRun)).rejects.toThrow();
  expect(changedSecondPlannerRun.allocatorReservations).toBe(0);
});

it.each(updateApplyDeathPoints)("recovers apply death at $name", async point => {
  const fixture = await interruptUpdateApply(point);
  await fixture.runAnyCommandToRecover();
  expect(await fixture.assertValidTerminalGeneration()).toBe(true);
});

it("restores the old release when target verification fails", async () => {
  const result = await applyUpdate(failingVerifierFixture);
  expect(result.outcome).toBe("rolled_back_automatically");
  expect(await failingVerifierFixture.activeIdentity()).toEqual(previous);
});
```

Cover every under-lock recheck, candidate request/input/result/preview equality, post-allocation overflow gap-only refusal, construction/source handoff, exact step order, owner/effect/migration/rollback payload/transitional manifest/trust/record/active/verifier, point of no return, fallback routing, old rollback retirement, terminal manifest/tombstone, nested/top-level compaction, trust retained after compensation, concurrent edit/third-state refusal, and scratch lifecycle.

- [ ] **Step 2: Run apply tests and verify `--apply` cannot execute**

Run: `npx vitest run --root apps/cli src/update/apply.test.ts src/commands/update/index.test.ts src/update/context.test.ts`

Expected: FAIL because update apply orchestration is absent.

- [ ] **Step 3: Implement same-invocation apply and exact coordinator construction**

```ts
export async function applyUpdate(
  context: CliUpdateContext,
  candidate: PreparedUpdateCandidateV1,
  scratch: VerifiedScratchBundleV1,
): Promise<Extract<UpdateCommandResultV1, { readonly outcome: "applied" }>>;
```

Keep scratch descriptors open through pre-lock verification; under the global lock rerun all guarded state and the target planner result JSON, stop at the result frame, allocate IDs, derive/publish construction and source plans, accept/secret-scan/re-hash output frames into exact consumers, publish outer intent, execute coordinator steps, and cleanup scratch only after durable source ready or compensation.

- [ ] **Step 4: Run apply tests**

Run: `npx vitest run --root apps/cli src/update/apply.test.ts src/commands/update/index.test.ts src/update/context.test.ts`

Expected: PASS across update success, automatic rollback, every death point, and concurrent mutation cases.

- [ ] **Step 5: Commit Task 24**

```bash
git add apps/cli/src/update/apply.ts apps/cli/src/update/apply.test.ts apps/cli/src/commands/update/index.ts apps/cli/src/commands/update/index.test.ts apps/cli/src/update/context.ts apps/cli/src/update/context.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): apply recoverable updates"
```

### Task 25: Apply conservative one-version rollback and rejected-release retirement

**Files:**
- Create: `apps/cli/src/update/rollback-apply.ts`
- Create: `apps/cli/src/update/rollback-apply.test.ts`
- Modify: `apps/cli/src/commands/update/index.ts`
- Modify: `apps/cli/src/commands/update/index.test.ts`
- Modify: `apps/cli/src/update/context.ts`
- Modify: `apps/cli/src/update/context.test.ts`

**Interfaces:**
- Consumes: Task 20 retained inverse/payload evidence and Task 22 rollback coordinator order.
- Produces: `applyRollback`, inverse owner/effect/migration execution, previous verifier point of no return, record/payload/rejected-release consumption, unchanged trust, rolled-back result.

- [ ] **Step 1: Write failing rollback/refusal/death tests**

```ts
it.each(postUpdateEdits)("refuses $name before allocation", async edit => {
  const fixture = await updatedFixture(edit);
  await expect(fixture.run(["update", "rollback", "--apply"])).rejects.toMatchObject({ code: 3 });
  expect(fixture.allocatorReservations).toBe(0);
});

it.each(rollbackApplyDeathPoints)("recovers rollback death at $name", async point => {
  const fixture = await interruptRollback(point);
  await fixture.recoverWithoutNetwork();
  expect(await fixture.activeIdentity()).toEqual(point.expectedActive);
});
```

Cover record/payload/inverse/manifest/bundle/metadata exact evidence, zero network/planner, sufficient inverse capacity, verify-previous bundle, retained payload then record adjacency, reverse migrations/effects/owners, transitional manifest, previous active, previous verifier point of no return, fallback routing, consumed payload/record/rejected bundle retirement, terminal manifest/tombstone, compensation to rejected current before verifier success, and unchanged trust high watermarks.

- [ ] **Step 2: Run rollback apply tests and verify no mutation path exists**

Run: `npx vitest run --root apps/cli src/update/rollback-apply.test.ts src/commands/update/index.test.ts src/update/context.test.ts`

Expected: FAIL because rollback apply orchestration is absent.

- [ ] **Step 3: Implement local-only rollback coordination**

```ts
export async function applyRollback(
  context: CliUpdateContext,
  preview: UpdateRollbackPreviewV1,
): Promise<Extract<UpdateCommandResultV1, { readonly outcome: "rolled_back" }>>;
```

Revalidate every guarded current/postimage/retained preimage under the global lock, allocate fresh coordinator/participant IDs, construct no source envelope and no planner identity, publish outer intent, run the exact rollback steps, and consume rollback record/payload only after previous verifier success and fallback routing.

- [ ] **Step 4: Run rollback apply tests**

Run: `npx vitest run --root apps/cli src/update/rollback-apply.test.ts src/commands/update/index.test.ts src/update/context.test.ts`

Expected: PASS for successful rollback, all post-update edit refusals, compensation, force-forward, and every death point.

- [ ] **Step 5: Commit Task 25**

```bash
git add apps/cli/src/update/rollback-apply.ts apps/cli/src/update/rollback-apply.test.ts apps/cli/src/commands/update/index.ts apps/cli/src/commands/update/index.test.ts apps/cli/src/update/context.ts apps/cli/src/update/context.test.ts docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md
git commit -m "feat(cli): apply conservative update rollback"
```

### Task 26: Prove the complete release/update lifecycle and close DOS-P7

**Files:**
- Create: `tests/integration/update/signature-transport.test.ts`
- Create: `tests/integration/update/archive-planner.test.ts`
- Create: `tests/integration/update/recovery.test.ts`
- Create: `tests/e2e/release-update.test.ts`
- Modify: `tests/security/network.test.ts`
- Modify: `tests/security/sentinel.test.ts`
- Modify: `tests/security/symlink-escape.test.ts`
- Modify: `tests/security/interruption.test.ts`
- Modify: `tests/repository/check.ts`
- Modify: `tests/repository/check.test.ts`
- Modify: `docs/architecture/foundation.md`
- Modify: `docs/architecture/foundation-constraints.md`
- Modify: `docs/architecture/brain.md`
- Modify: `docs/architecture/claude-adapter.md`
- Modify: `docs/architecture/codex-adapter.md`
- Modify: `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/BACKLOG.md`
- Modify: `docs/superpowers/plans/2026-07-21-developer-os-program.md`
- Modify: `docs/superpowers/ORDER.md`
- Delete after surviving constraints move: `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`
- Delete after surviving constraints move: `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`
- Delete after all plan evidence is checked: `docs/superpowers/plans/2026-08-29-developer-os-release-update.md`

**Interfaces:**
- Consumes: both completed DOS-P7 specifications, Spec 1 implementation checkpoint, Tasks 1–25.
- Produces: synthetic install→migration/fresh init→preview/apply→rollback/reapply→Git/automation→uninstall evidence, non-vacuous release/network/process/capability gates, canonical architecture/program state, and completed A11.

- [ ] **Step 1: Write failing end-to-end and non-vacuous gate tests**

```ts
it("runs the complete synthetic lifecycle on both architectures", async () => {
  for (const architecture of ["arm64", "x64"] as const) {
    const fixture = await createSyntheticReleaseFixture({ architecture });
    await fixture.freshInitOrMigrate();
    await fixture.previewAndApplyUpdate();
    await fixture.rollbackAndReapply();
    await fixture.enableSyncAutomationThenUninstall();
    expect(await fixture.assertBrainPreservedAndProductRemoved()).toBe(true);
  }
});

it("enumerates every release authority scope non-empty", () => {
  const report = inspectReleaseAuthoritySurfaces(repositoryRoot);
  expect(report.networkEntrypoints.length).toBeGreaterThan(0);
  expect(report.launcherEntrypoints.length).toBeGreaterThan(0);
  expect(report.plannerGraphs.every(graph => graph.modules.length > 0)).toBe(true);
});
```

Map every Spec 2 §12 row and every unchanged Spec 1 §7 row to named evidence. Include V1 and fresh V2 start, both architectures, metadata replay/signature/origin/archive corpus, identical preview, no-apply mutation, apply/rollback death at every outer and nested cursor, owner completeness, migration chain, capacity exact/first-over, post-update edit refusal, rollback consumption/reapply, launcher active/fallback/bootstrap/executor routes, no credentials/private diagnostics, full uninstall preservation, and per-scope non-empty enumerators.

- [ ] **Step 2: Run the focused integration/security/repository gates and verify uncovered rows fail**

Run: `npx vitest run --root tests integration/update/signature-transport.test.ts integration/update/archive-planner.test.ts integration/update/recovery.test.ts e2e/release-update.test.ts security/network.test.ts security/sentinel.test.ts security/symlink-escape.test.ts security/interruption.test.ts repository/check.test.ts`

Expected: FAIL until every new surface is registered and both specifications' complete gate matrices are met.

- [ ] **Step 3: Close evidence gaps and move surviving contracts into canonical documents**

Update repository enumerators with exact non-empty assertions and no raw founder inputs. Move the stable launcher/release trust/manifest V2/bootstrap/update/planner/rollback contracts and accepted residuals into their owning architecture notes; update the threat model's former no-network rule to the exact explicit-update-only boundary; record Spec 1 lifecycle contracts as implemented; update program Task 7 and remove only completed A11/BACKLOG rows. Do not claim A12 or later work complete.

- [ ] **Step 4: Run focused gates and the full repository gate**

Run: `npx vitest run --root tests integration/update/signature-transport.test.ts integration/update/archive-planner.test.ts integration/update/recovery.test.ts e2e/release-update.test.ts security/network.test.ts security/sentinel.test.ts security/symlink-escape.test.ts security/interruption.test.ts repository/check.test.ts`

Run: `npm run check`

Expected: PASS for lint, all package/integration/E2E tests, build, generated-artifact drift, and `git diff --check`.

- [ ] **Step 5: Obtain independent final review and correct every accepted finding**

Dispatch a fresh reviewer who authored none of Tasks 1–26 with the two approved specifications, both implementation plans, exact changed-file list, and review-only/no-commit instructions. For each accepted finding, add a focused failing regression test first, apply the smallest correction, rerun its focused suite and `npm run check`, then request another verdict. Continue until the reviewer returns `READY`.

- [ ] **Step 6: Delete completed specs/plan only after inbound references and surviving contracts are closed**

Search all tracked files for both spec paths and this plan path. Replace surviving inbound references with the exact canonical architecture/program section that absorbed the contract. Confirm no unfinished checkbox or A11 row depends on the documents, then delete both completed specs and this completed plan. Git history is the archive.

- [ ] **Step 7: Commit the verified DOS-P7 checkpoint**

Stage every exact changed path by name; never use `git add -A`, `git add .`, or a wildcard. Inspect `git diff --cached --name-status` and the staged diff, then commit with:

```bash
git add tests/integration/update/signature-transport.test.ts tests/integration/update/archive-planner.test.ts tests/integration/update/recovery.test.ts tests/e2e/release-update.test.ts tests/security/network.test.ts tests/security/sentinel.test.ts tests/security/symlink-escape.test.ts tests/security/interruption.test.ts tests/repository/check.ts tests/repository/check.test.ts docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/brain.md docs/architecture/claude-adapter.md docs/architecture/codex-adapter.md docs/architecture/threat-model.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-07-21-developer-os-program.md docs/superpowers/ORDER.md docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md docs/superpowers/plans/2026-08-29-developer-os-release-update.md
git commit -m "feat: complete release and update lifecycle"
```

Confirm CI is green on the exact commit before merge. Do not merge; the founder owns merging. Report the completed A11 evidence and the new `NOW` action, A12.

## Spec Coverage Index

| Normative Spec 2 area | Owning tasks |
|---|---|
| §1 scope/invariants and explicit update-only network | Global constraints, Tasks 12, 23–26 |
| §2 boundaries, package direction, path/scalar brands, planner graph | Tasks 1, 10, 15, 26 |
| §3 stable launcher, installed layout, active/trust records | Tasks 2, 7, 10–11, 19, 22, 26 |
| §4 signed metadata, selection, bundle archive, transport | Tasks 2, 11–13, 23, 26 |
| §5 Manifest V2, drift, direct-write participant | Tasks 3–5, 9, 21, 26 |
| §6 fresh V2 init, strict V1 mapping, crash-resumable migration | Tasks 6–9, 26 |
| §7 strict update grammar, preview, guarded scratch, typed result | Tasks 13–14, 23, 26 |
| §8 target planner, owner providers, schema migrations | Tasks 15–17, 21, 26 |
| §9 construction, participants, coordinator order/failure direction | Tasks 18–24, 26 |
| §10 retained rollback and conservative apply | Tasks 20, 22–23, 25–26 |
| §11 errors/output/security behavior | Global constraints and every refusal test, finalized in Task 26 |
| §12 complete verification gates | Each focused task plus Task 26's row-by-row evidence index |
| §13 produced interfaces and split implementation sequence | File map, Checkpoints A/B, Tasks 1–26 |

## Plan Self-Review Record

- **Spec coverage:** Every normative section maps to at least one implementation task and Task 26 evidence; the V2 bootstrap dependency precedes the external Spec 1 plan, and all later update coordination follows it.
- **Placeholder scan:** The plan contains no deferred implementation placeholder. Every task names exact files, interfaces, a failing-test shape, a failing command/expected reason, implementation signatures/constraints, a passing command, and exact-path commit instructions.
- **Type consistency:** Shared names are introduced once and consumed consistently: canonical/scalar/path codecs (Task 1), release identity/trust (Task 2), Manifest V2 (Task 3), manifest participant (Task 5), bootstrap plans (Task 6), previews/materialization (Task 14), planner wire (Task 15), owner/migration plans (Tasks 16–17), construction (Task 18), source/publication participants (Tasks 19–20), lifecycle V2 (Task 22), typed command result (Task 23).
- **Split dependency:** Task 6 explicitly introduces only the deterministic bootstrap arms and pre-staged initial-journal bridge needed before Spec 1. The approved Spec 1 plan then extends those shared modules with allocated lifecycle IDs and the ordinary coordinator without redeclaring or weakening the bootstrap grammar.
