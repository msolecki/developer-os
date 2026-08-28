# Developer OS — Opt-in Surfaces Design

**Status: approved by the founder on 2026-08-28 after fresh-context `READY`; implementation plan
written at `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md`.** This is `ORDER.md`
entry A11, program-plan Task 7, DOS-P7 — **the first of two specifications.** The plan must not be
executed until Spec 2 implements the `InstallationManifestV2` dependency below. The
second specification owns release metadata, dry-run update, managed-artifact upgrade, schema
migration, and rollback; it gets its own plan. Program-plan Task 7 carries the ratified split, and the
active DOS-P7 register in `BACKLOG.md` tracks both halves. The split changes neither Task 7's scope nor
checkpoint.

The two halves share one dependency that fixes their implementation order. This specification
requires `InstallationManifestV2`; the second specification owns its migration and must land that
migration before the configuration, Git, or automation implementation described here. Document
approval and plan writing may proceed in the order in `BACKLOG.md`; implementation may not cross
that dependency.

**Founder amendments, ratified 2026-08-25.** Foundation transactions remain the file-mutation
protocol for product-managed artifacts; the installation manifest retains its existing durable direct
write exception. Exact `.git` internals and live `launchd` state use the specialized, journaled effect
protocol in §2.4 because neither is a manifest-owned file tree. The founder also ratified the additive
configuration lifecycle records, `InstallationManifestV2` verification/ownership contract, and typed
present/absent manifest coordination required by this design. Foundation §§2 and 4 and `BACKLOG.md` §8
carry both amendments.

**Founder-approved review corrections, 2026-08-27.** The founder separately approved the narrow
review-closure packages now embedded below, including bounded initial/rewrite journals, exact Git and
launchd process tables, per-invocation push deadlines, publication-safe Git compensation, closed
launchd-process staging, process-lifetime runner leases, evidence-bound absent-manifest uninstall,
numeric Git metadata bounds, and the exact legacy mutation-index range. The latest post-package review
also closes the remaining rollback wording, hash-bound launchd staging identities, process-free absent-
manifest admission, runner lease-removal discrimination, and canonical redirect-proof Git shadow
configuration. The subsequent fresh-review correction binds a custom product home into scheduled
launchd argv, represents symbolic empty-bare `HEAD`, persists path-slot shadow-config template hashes
for retry, and narrows the one Git alternate-object path so list syntax cannot widen authority. These
corrections do not approve the complete written specification. A final founder-approved correction
package separates byte-inert public previews from allocated execution envelopes, closes the
`config get/set` key and result grammar, adds Git-config-safe paths, removes the unreachable new-repo
sync arm, journals required reflogs, budgets the in-process pack reader, makes launchd bootstrap
descriptor-backed, admits stale installed runners in two stages, and inventories the complete product
home before absent-manifest key deletion. These approvals are corrections to the written artifact,
not approval of the complete specification. The post-final-review correction closes the remaining
runner wording, reflog postimage/bijection, pack-count, immutable launchd-byte/descriptor-lifetime,
bootstrap-lock, flat pre-product recovery-envelope, and key-absent coordinator gaps. At that time the
approval status remained unchanged. The founder-approved post-review closure preserves an indistinguishable exact
empty product/state skeleton after a bootstrap crash instead of inventing durable deletion authority,
and fixes the first-creation nonce/allocator temp grammar and partial-write recovery. The subsequent
fresh-review closure removes stale real-descriptor summaries, closes linked snapshot-creation crash
states, and admits one bounded flat coordinator rewrite temp beside its authoritative final journal.

**Complete-spec approval, 2026-08-28.** After the final full `npm run check` passed and a new
independent reviewer returned `READY`, the founder approved this complete written specification. The
approval opens only its implementation-plan gate; §8.2 still blocks implementation on Spec 2's
manifest migration and V2 new-init handoff.

---

## 1. Scope and invariants

This subsystem adds three explicit local surfaces:

1. schema-validated configuration that may change after `init`;
2. opt-in Git synchronization of the Brain vault; and
3. opt-in macOS scheduled jobs.

Until a feature is enabled, it is inert. A Git-disabled installation spawns no Git process and
makes no Git network call. An automation-disabled installation installs no plist and starts no
scheduled process. Enabling Git or automation is plan-only unless the user supplies `--apply`.
Operational enablement additionally requires the matching manifest-owned applied-provenance record;
schema-valid configuration alone is never authority.

The subsystem preserves the standing product boundaries:

- no command here invokes a model or model-vendor CLI;
- no scheduled job can spend vendor credits;
- no scheduler captures or ingests content automatically;
- Git never fetches, pulls, merges, rebases, checks out, resolves, force-pushes, or rewrites history;
- the product never stores or prompts for a Git credential;
- disabling or uninstalling never deletes the vault, its `.git` directory, or any Brain content;
- release, update, checksum, schema-migration, and rollback behavior belongs to DOS-P7 spec 2.

## 2. Ownership and configuration

### 2.1 `InstallationManifestV2` verification modes

The second DOS-P7 specification runs the V2 migration gate against every installation manifest before
this subsystem mutates configuration: supported V1 states migrate and the unsafe states enumerated
below refuse before mutation. `ManagedArtifactV2` is an artifact-kind/verification-mode tagged union,
not a bag of optional hashes. Every arm retains V1's ownership and restore evidence unchanged:
`owner`, exact `path`, `kind`, product version, `existedBefore`, `beforeHash`,
`backupRelativePath`, `source`, merge strategy, and verification time. Migration never turns a path
the product found into a path it created.

The legal verification combinations are exhaustive:

| Artifact kind | Mode | Presence and drift evidence |
|---|---|---|
| regular file | `content` | required; type and byte hash must match `installedHash` |
| regular file | `schema` | required; type and named strict schema must pass; content edits are legal |
| regular file | `ephemeral` | optional; if present it must be a guarded regular file; content is not compared |
| directory | `content` | required; directory type is the whole installed-state check; no byte hash is invented |
| symlink | `content` | required; link type and hash of the link target must match |

`config-entry` remains illegal in a stored manifest until a later specification defines semantic
drift; no legal V1 manifest can contain it, so migration does not guess. Wrong type is
`type_changed`; a wrong regular-file hash is `content_changed`; a wrong link target is
`target_changed`; schema refusal is `schema_invalid`; absence is `missing` except for `ephemeral`.

Before that mapping, migration derives the guarded exact
`<product home>/state/lifecycle-activation.json`,
`<product home>/state/lifecycle-install-nonce`, and
`<product home>/state/lifecycle-id-allocator.json` paths. Any V1 artifact whose declared **or**
canonical path equals one of them, and any filesystem leaf of any type already present there, refuses
before hashing/copying artifact bytes or writing V2. The collision codes are respectively
`activation_path_collision`, `lifecycle_nonce_path_collision`, and
`lifecycle_allocator_path_collision`. None of the paths existed as a product interface in V1, so
migration never legitimizes a V1 ownership claim. Only
this specification's later lifecycle apply may first create the activation path as a `content`
artifact. Spec 2 migration/new-init itself creates the allocator as the required regular-file
`schema` artifact below; new-init planning applies both absent-leaf preconditions.

Migratable V1 regular files and product-created directories map to the matching `content` arm without
changing any restore field. `config.toml` alone maps to the regular-file `schema` arm with the strict
Developer OS configuration validator. Its path stays product-owned, but an intentional content edit
is no longer reported as drift. Missing, unreadable, wrong-type, or schema-invalid configuration is
drift.

That kind mapping does not make every validator-legal V1 restore combination safe. Before writing any
V2 bytes, migration verifies every `existedBefore: true` regular-file backup as a guarded regular file
whose bytes match `beforeHash`. It refuses recovery-required for a V1 directory with
`existedBefore: true` and for every V1 symlink entry: the V1 validator admitted those shapes, but the
Foundation executor can restore only regular-file backup bytes and its current symlink path handling
cannot safely remove the link without following it. A later design may widen this migration allowlist
only with ratified, tested transaction operations; migration never reinterprets such evidence.

The V2 validator makes the corresponding invariant explicit. `existedBefore: true` is legal only for
a regular-file `content` or `schema` artifact with complete verified backup evidence. Directory,
symlink, and `ephemeral` arms require `existedBefore: false`, `beforeHash: null`, and
`backupRelativePath: null`. V2 symlink entries therefore describe only safely created links after the
required link-specific transaction operation exists; this specification creates none.

`ephemeral` is an ownership reservation, not a wildcard. Every V2 manifest, whether migrated or
created by a new `init`, enumerates the complete closed set of retained lifecycle files below by exact
path. `<job>` expands independently to exactly `brain-reindex`, `brain-lint`, `doctor`, and
`git-sync`; `<n>` expands to every decimal integer from `0` through `9`, where `0` is current and
`1`–`9` are rotations:

| Runtime interface | Exact path relative to product home |
|---|---|
| `SyncRecordV1` | `state/git-sync.json` |
| `UninstallingMarkerV1` | `state/uninstalling.json` |
| automation status | `state/automation-<job>.status.json` |
| `AutomationRunnerLeaseV1` / runtime-record lock | `state/.automation-<job>.lock` |
| automation log slot | `logs/automation-<job>.<n>.json` |

Every V2 manifest also records exact `state/lifecycle-install-nonce` as a regular-file `content`
artifact and `state/lifecycle-id-allocator.json` as a required regular-file `schema` artifact, both
with `existedBefore: false` and null restore evidence. The nonce file is exactly 64 lowercase
hexadecimal ASCII bytes plus LF; both are owner-owned 0600 single-link files, and the allocator is at
most 1 KiB before parse. The nonce content hash keeps the installation epoch immutable. The
allocator's `installNonce` must equal those 64 bytes. Neither path is `ephemeral`: absence, an unknown
field, an invalid counter, a nonce-content change, or disagreement between the two is
recovery-required. Spec 2 draws 32 bytes from the operating-system CSPRNG, renders their lowercase
hex as `LifecycleInstallNonceV1`, and creates both initial files with `nextCounter: "0"` before Spec 1 may allocate an ID, while §2.4 owns
the allocator's guarded atomic-rewrite protocol. Uninstall removes both only after no further
transaction ID can be allocated.

The stable global lock and journal/plan/lock leaves are bookkeeping exceptions, not retained runtime
records: they use the exact direct state-store contracts in §§2.3–2.4 and are never inferred from an
`ephemeral` wildcard. Foundation transaction bookkeeping keeps its pre-existing ownership boundary.

The V2 migration/new-init gate also creates and records exactly three product-owned `content`
directories with `existedBefore: false`: `state/lifecycle-journals`,
`state/git-effect-journals`, and `state/launchd-effect-journals`. Any prior leaf at a declared or
canonical path refuses; no existing directory is adopted. Their only legal durable children are the
closed journal/plan/lock leaves defined in §2.4. Foundation's existing `state/transactions` directory
keeps its current contract.

Every reservation has `existedBefore: false` and null restore evidence. Migration or new `init`
refuses before mutation if any reserved path already exists; a V1 entry at the same path is a
duplicate ownership collision, not permission to reinterpret it. The product never claims or backs
up an unknown runtime file. Later creation rechecks that the path is absent or is the same guarded
regular file already owned by the reservation. Symlinks and kind changes refuse.

The bytes at those paths are also closed. Every new DOS-P7 JSON record uses `CanonicalJsonV1` from
§2.2 and one LF; unknown fields refuse at every depth. Foundation transaction journals are the sole
serialization exception and use the unchanged `FoundationJournalJsonV1` contract below:

```text
LifecycleInstallNonceV1 = exactly LowerHexSha256 plus one LF

LifecycleIdAllocatorV1 = {
  schemaVersion: 1,
  installNonce: LowerHexSha256,
  nextCounter: UInt64DecimalV1
}

SyncRecordV1 = {
  schemaVersion: 1,
  outcome: "pushed" | "no_changes",
  repositoryRoot: CanonicalAbsolutePathV1,
  branch: ValidatedGitBranchV1,
  scopeFingerprint: LowerHexSha256,
  headOid: LowerHexSha1,
  lastPushedHeadOid: LowerHexSha1,
  managedPaths: readonly VaultRelativePathV1[0..100000],
  completedAt: UtcTimestampV1
}

UninstallingMarkerV1 = {
  schemaVersion: 1,
  coordinatorId: LifecycleCoordinatorIdV1,
  createdAt: UtcTimestampV1
}

LifecycleBootstrapLockV1 = {
  path: CanonicalAbsolutePathV1,
  ownerUid: EffectiveUidV1,
  mode: 384,
  nlink: 1,
  size: 0,
  dev: UInt64DecimalV1,
  ino: UInt64DecimalV1,
  createdByAttempt: boolean,
  productHomeCreatedByAttempt: boolean,
  stateDirectoryCreatedByAttempt: boolean
}

BytePrefixOf<T> = a byte string, possibly empty, equal to the first n bytes of at least one valid T

LifecycleBootstrapCreationTempV1 =
  | {
      kind: "install_nonce",
      path: exact `<product home>/state/.lifecycle-install-nonce.<lowercase-v4-uuid>.tmp`,
      ownerUid: EffectiveUidV1,
      mode: 384,
      nlink: 1,
      size: Integer[0..65],
      dev: UInt64DecimalV1,
      ino: UInt64DecimalV1,
      bytes: BytePrefixOf<LifecycleInstallNonceV1>
    }
  | {
      kind: "id_allocator",
      path: exact `<product home>/state/.lifecycle-id-allocator.<lowercase-v4-uuid>.json.tmp`,
      ownerUid: EffectiveUidV1,
      mode: 384,
      nlink: 1,
      size: Integer[0..1024],
      dev: UInt64DecimalV1,
      ino: UInt64DecimalV1,
      bytes: BytePrefixOf<CanonicalJsonV1<LifecycleIdAllocatorV1 where
        installNonce equals the guarded final nonce and nextCounter == "0">>
    }

AutomationStatusRecordV1 =
  | { schemaVersion: 1, job: JobIdV1,
      outcome: "success" | "handler_refused" | "handler_failed",
      reasonCode: SafeReasonCodeV1, startedAt: UtcTimestampV1,
      completedAt: UtcTimestampV1 }
  | { schemaVersion: 1, job: JobIdV1,
      outcome: "git_disabled" | "automation_disabled" | "skipped_lock_timeout",
      reasonCode: SafeReasonCodeV1, startedAt: null,
      completedAt: UtcTimestampV1 }

AutomationLogRecordV1 = {
  schemaVersion: 1,
  job: JobIdV1,
  outcome: "success" | "handler_refused" | "handler_failed",
  reasonCode: SafeReasonCodeV1,
  startedAt: UtcTimestampV1,
  completedAt: UtcTimestampV1,
  data: BoundedRedactedJsonV1
}
```

`SyncRecordV1.headOid` and `lastPushedHeadOid` must be equal; `no_changes` additionally requires a
prior successful pushed baseline with that OID. Managed paths are guarded vault-relative paths,
unique and sorted by unsigned UTF-8 bytes; `VaultRelativePathV1` is 1–4096 UTF-8 bytes, has 1–256
`VaultSegmentV1` components joined by one `/`, and has no leading/trailing slash or dot component. The
record is at most 16 MiB. `UtcTimestampV1` is the exact
UTC millisecond form `YYYY-MM-DDTHH:mm:ss.sssZ` and must calendar-parse and round-trip byte-identically.
`SafeReasonCodeV1` is 1–64 lowercase ASCII bytes matching `[a-z][a-z0-9_]*`. `BoundedRedactedJsonV1`
is null, Boolean, integer, string, array, or object only; it has maximum depth 32, at most 1,024 entries
per array/object, 64-KiB keys/string leaves, no lone surrogate, and total encoded size at most 1 MiB.
The marker is at most 1 KiB and a status record at most 64 KiB before parsing; a log's 1-MiB bound
includes its complete encoded envelope and LF.
`AutomationRunnerLeaseV1` is the guarded kernel lock over one such exact zero-byte path. The path is
created only by migration/new init, is never created by a runner, and its opened descriptor is the
same per-job lifetime lease and runtime-record serialization lock. A runner acquires it before any
wait for the global mutation lock, rechecks its path identity and the uninstall marker after
acquisition, and holds it until every exit. Lock contents are never interpreted. A status record
carries no handler data, and a log record is written only after its data has passed the product
redactor. `success` requires reason code `ok`; each inert outcome requires
the identical literal reason code; refusal/failure reason codes may not use `ok` or an inert outcome
name; and `startedAt` must not follow `completedAt`. These types and paths are inputs to spec 2's
reservation/collision gate, not details deferred to spec 1 implementation.

There are no glob entries and uninstall performs no recursive delete. Runtime directories are not a
license to remove unknown children. Automation plists are `content` artifacts while installed;
`automation disable --apply` removes their manifest entries with the plists, while the `ephemeral`
log and status reservations remain so uninstall can remove retained runtime state later.
Automation enable refuses a pre-existing plist path or exact base/generated launchd target it would
claim but did not install; it never
adopts, backs up, unloads, or overwrites another owner's service.

The redaction key remains the one ratified exception to manifest ownership: uninstall removes it as
required by the knowledge-pipeline contract even though it is not a manifest artifact.

Restore/removal rules are always downstream of the operation's declared-and-canonical removable
partition. Init rollback uses Foundation's product-home-plus-newly-created-Brain universe and may undo
the Brain skeleton it just created. Uninstall uses only product home with Brain excluded, plus §6's
exact authorized plist paths and redaction-key exception; every Brain artifact is preserved without
restore or removal regardless of `existedBefore`. Within the selected partition, every migratable
`existedBefore: true` regular-file content or schema artifact is restored from unchanged, verified
backup evidence, while an `existedBefore: false` artifact is removed through its kind-specific safe
operation. Created directories are removed only when empty. Present ephemeral files are removed
exactly; absence is already clean.

### 2.2 Configuration loads and writes

The strict configuration schema runs on every load. Unknown keys, invalid types, unsafe paths,
`telemetry` other than literal `false`, and an unsupported schema version refuse before a command
acts. A hand edit is legal when the resulting file passes the schema; this is why content hashing is
the wrong verification rule for this file.

`config get [key]` reads the validated configuration through one closed publishable projection.
`config set <key> <value>` accepts one key and exactly one argv value containing `CanonicalJsonV1`;
shell-token concatenation, TOML fragments, implicit strings, and multiple value arguments refuse.
The key and result surfaces are exhaustive:

```text
ConfigReadableKeyV1 =
  "schemaVersion" | "brainPath" |
  "adapters" | "adapters.claude" | "adapters.codex" |
  "brain" | "brain.schemaVersion" | "brain.contentRoot" |
  "brain.topicFolders" | "brain.topicAliases" | "brain.indexesDir" |
  "brain.retrieval" | "brain.retrieval.maxCandidates" |
  "brain.staleness" | "brain.staleness.reviewAfterDays" |
  "git" | "git.enabled" | "git.lifecycle" |
  "automation" | "automation.enabled" | "automation.lifecycle" |
  "redaction" | "redaction.patterns" | "telemetry"

ConfigMutableKeyV1 =
  "brainPath" | "adapters.claude" | "adapters.codex" |
  "brain" | "brain.contentRoot" | "brain.topicFolders" |
  "brain.topicAliases" | "brain.indexesDir" |
  "brain.retrieval" | "brain.retrieval.maxCandidates" |
  "brain.staleness" | "brain.staleness.reviewAfterDays" |
  "redaction" | "redaction.patterns"

PublishableRedactionConfigV1 = { patternsCount: Integer[0..64] }

ConfigGetResultV1 =
  | { schemaVersion: 1, key: null, value: PublishableDeveloperOsConfigV1 }
  | { schemaVersion: 1, key: ConfigReadableKeyV1, value: CanonicalJsonValueV1 }

ConfigSetResultV1 = {
  schemaVersion: 1,
  key: ConfigMutableKeyV1,
  outcome: "updated" | "unchanged"
}
```

`PublishableDeveloperOsConfigV1` is the exact validated `DeveloperOsConfigV1` key order and value
types except that a present `redaction` value is replaced by `PublishableRedactionConfigV1`.
For keyed reads, `redaction` returns that object and `redaction.patterns` returns only its integer
`patternsCount`; every other key returns exactly the corresponding scalar/object/array value from the
publishable projection, without implicit stringification. No result, error, hash, plan, or log
publishes a pattern value. An absent optional
section returns JSON `null` for its section or child key. Every successful get/set result is encoded
as exact `CanonicalJsonV1` with one trailing LF; errors use the standing content-free CLI error
envelope and never echo the supplied value.

The existing config schema stays version 1 and gains only `git.lifecycle?: GitSyncConfigV1` and
`automation.lifecycle?: AutomationConfigV1` beneath the required tables and existing `enabled`
booleans. A pre-DOS-P7 config with those records absent still loads and serializes byte-identically.
`enabled: true` without its complete typed lifecycle record is schema-readable but operationally
incomplete and cannot trigger Git, launchd, or network effects. This is the additive frozen-interface
amendment ratified in Foundation §2; unknown fields remain refused and absent records remain
distinguishable from present-and-undefined.

#### Exhaustive lifecycle records

The two lifecycle records are strict recursive schemas, not open bags. Only the record itself is
optional at the `DeveloperOsConfigV1` boundary; every field inside a present record is required and
unknown fields refuse at every depth:

```text
GitSyncConfigV1 = {
  schemaVersion: 1,
  repositoryRoot: CanonicalAbsolutePathV1,
  branch: ValidatedGitBranchV1,
  remote: {
    name: "developer-os",
    transport: "local" | "https" | "ssh",
    declaredUrl: NormalizedRemoteUrlV1,
    effectivePushUrl: NormalizedRemoteUrlV1
  },
  scope: GitScopeSnapshotV1
}

GitScopeSnapshotV1 = {
  brainPath: CanonicalAbsolutePathV1,
  contentRoot: VaultSegmentV1,
  topicFolders: readonly VaultSegmentV1[1..256],
  topicAliases: BoundedTopicAliasMapV1,
  indexesDir: VaultSegmentV1,
  fingerprint: LowerHexSha256
}

BoundedTopicAliasMapV1 = {
  readonly [alias: VaultSegmentV1]: VaultSegmentV1
} with 0..256 own entries

NormalizedScheduleV1 =
  | { cadence: "hourly", minute: Integer[0..59] }
  | { cadence: "daily", hour: Integer[0..23], minute: Integer[0..59] }
  | { cadence: "weekly", day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
      hour: Integer[0..23], minute: Integer[0..59] }

AutomationConfigV1 = {
  schemaVersion: 1,
  schedules: readonly [
    { job: "brain-reindex", schedule: NormalizedScheduleV1 },
    { job: "brain-lint", schedule: NormalizedScheduleV1 },
    { job: "doctor", schedule: NormalizedScheduleV1 },
    { job: "git-sync", schedule: NormalizedScheduleV1 }?
  ]
}
```

`CanonicalJsonValueV1` is the recursive value union of null, Boolean, integers in
`[-9007199254740991, 9007199254740991]`, strings without lone surrogates, arrays of
`CanonicalJsonValueV1`, and plain string-keyed objects whose values are `CanonicalJsonValueV1`.
`CanonicalJsonV1` is one encoding algorithm for that union, not an implementation-selected
serializer; duplicate source keys refuse before object construction.
Object members are sorted by the unsigned UTF-8 bytes of the unescaped key; arrays retain order.
Integers use base-10 with no leading zero and no negative zero. Strings escape quotation mark and
backslash, use `\b`, `\t`, `\n`, `\f`, and `\r` for those five controls, use lowercase
`\u00xx` for every other U+0000–U+001F scalar, and emit every other scalar as its literal UTF-8 bytes.
The encoder adds no other whitespace, emits no BOM, performs no implicit Unicode normalization, and
appends exactly one LF. Every hash statement in this specification that names canonical JSON hashes
those exact bytes including the LF after its stated ASCII domain prefix and NUL byte.

`FoundationJournalJsonV1` is deliberately not `CanonicalJsonV1`. It is the exact byte encoding
already produced by `packages/core/src/transactions/store.ts`: `JSON.stringify` of the validated,
cloned `TransactionJournalV1`, then one LF. The outer insertion order is exactly
`schemaVersion`, `id`, `kind`, `phase`, `createdAt`, `updatedAt`, `mutations`; every mutation's order is
exactly `targetPath`, `operation`, `expectedBeforeHash`, `stagedRelativePath`; array order is retained;
and string/null/number rendering is ECMAScript `JSON.stringify` for these schema-valid values, with no
other whitespace or BOM. Every allocated Foundation initial journal staged by DOS-P7 and every final
rewrite of an allocated Foundation journal must be byte-identical to this encoding. Legacy
`tx_<lowercase-v4-uuid>` journals retain the current compatibility read: bounded UTF-8 is parsed with
`JSON.parse`, the strict exact-key `TransactionJournalV1` validator runs, and no historical key order or
insignificant whitespace is rejected merely for being non-canonical. New lifecycle coordinator,
effect, allocator, activation, manifest, plan, and runtime records remain `CanonicalJsonV1`; no source
implementation migration is hidden in this specification.

`CanonicalAbsolutePathV1` is a guarded fully resolved absolute path, contains no NUL, and is 1–4096
UTF-8 bytes. `VaultSegmentV1` passes the existing `pathSegmentViolation` contract and is 1–255 UTF-8
bytes. Topic-folder order is preserved, names are unique after the existing NFC/case fold, alias keys
use the existing reserved-key and folder/target rules, and canonical encoding orders alias keys by
UTF-8 bytes. `ValidatedGitBranchV1` is 1–255 UTF-8 bytes and passes the Git-2.50.1 branch-ref rules:
it is not option-shaped or `@`; has no empty, dot-leading, or `.lock`-ending path component; and
contains no control/space, `..`, `@{`, `~`, `^`, `:`, `?`, `*`, `[`, or backslash, nor a trailing dot
or slash. `NormalizedRemoteUrlV1` is 1–4096 UTF-8 bytes, satisfies the closed transport grammar in
§4.2, and contains no credential, control, line break, or redaction match. Transport agrees with both
URLs. `declaredUrl` stores the normalized destination, never the user's raw spelling, and
`effectivePushUrl` stores the independently resolved value under the same normalizer; version 1
requires them byte-equal. The whole serialized lifecycle record is at most 1 MiB before parsing or
hashing.

URL normalization is exhaustive. Scheme names are accepted ASCII-case-insensitively and serialized
lowercase; valid percent hex accepts either case and serializes uppercase:

- an absolute local path and a `file://` URL with empty authority or literal `localhost` both
  guarded-resolve to the same canonical bare path. The stored form is `file://` plus that absolute
  path with `/` preserved, RFC-3986 unreserved UTF-8 bytes literal, and every other byte uppercase
  `%HH`; malformed escapes and encoded slash, backslash, NUL, or control refuse;
- HTTPS uses lowercase literal `https`, a lowercase ASCII DNS name or canonical dotted-decimal IPv4,
  removes port 443, serializes another decimal port in 1–65535 without leading zero, normalizes an empty path to `/`,
  accepts only `/`, RFC-3986 unreserved path bytes, and valid `%HH`, removes literal dot segments,
  decodes percent-encoded unreserved bytes, uppercases every retained
  `%HH`, and rejects userinfo, query, fragment, encoded path separators, controls, non-ASCII/invalid
  hosts, IPv6, and any segment that becomes `.` or `..` after decoding;
- `ssh://` uses the same host, port, and escape rules, removes default port 22, permits one optional
  ASCII username matching `[A-Za-z0-9_][A-Za-z0-9._-]{0,63}`, and after one decode requires 1–32 repository path
  segments matching `[A-Za-z0-9._-]+` with neither `.` nor `..` as a whole segment; and
- scp-like SSH is stored and passed as `[user@]lowercase-host:path`. It has no port or percent escapes;
  its optional username uses the same non-option-shaped grammar;
  `path` preserves whether it begins with `/`, contains 1–32 safe repository segments of 1–255 bytes
  matching `[A-Za-z0-9._-]+`, and contains neither `.` nor `..` as a whole segment. It is not folded
  into `ssh://`, because relative scp-like and absolute SSH-URL paths have different Git semantics.

DNS labels are 1–63 ASCII bytes, start and end alphanumeric, contain only alphanumeric or hyphen, and
the whole name is at most 253 bytes with no empty label; a final DNS dot is removed. Canonical IPv4
has four decimal octets 0–255 with no leading zero except literal `0`. These rules run once on input
and again on stored config; normalizing an already normalized value is byte-idempotent.

Consequently the derived `ssh_target` is never option-shaped: without a username it begins with the
host's alphanumeric byte, and with one it begins with the username's alphanumeric/underscore byte.
The rejection is applied to the parsed username as well as raw input, so `ssh://-user@host/repo`
cannot bypass the raw leading-input check and become an option at `/usr/bin/ssh`.

`GitScopeSnapshotV1.fingerprint` is SHA-256 over
`developer-os:git-scope:v1\0` plus canonical JSON and LF for the five preceding scope fields, excluding
the fingerprint itself. Automation schedules always use the displayed order: the first three entries
are mandatory, and `git-sync` is present exactly as the fourth entry when it was eligible at apply.
Input schedule strings normalize into the tagged numeric union; no input spelling is stored.

These are canonical JSON examples; each is physically one UTF-8 line followed by one LF. The Git
example's scope fingerprint is the digest of its displayed five-field scope projection:

```json
{"branch":"main","remote":{"declaredUrl":"file:///Users/test/git/brain.git","effectivePushUrl":"file:///Users/test/git/brain.git","name":"developer-os","transport":"local"},"repositoryRoot":"/Users/test/DeveloperBrain","schemaVersion":1,"scope":{"brainPath":"/Users/test/DeveloperBrain","contentRoot":"content","fingerprint":"beb2e2591f459a3bc58969ec3b82171dcd3f37525e9149520a1a12851135d794","indexesDir":"_indexes","topicAliases":{"PROJEKTY":"PROJECTS"},"topicFolders":["DEV","PROJECTS"]}}
```

```json
{"schedules":[{"job":"brain-reindex","schedule":{"cadence":"daily","hour":2,"minute":0}},{"job":"brain-lint","schedule":{"cadence":"daily","hour":2,"minute":30}},{"job":"doctor","schedule":{"cadence":"weekly","day":"mon","hour":3,"minute":0}},{"job":"git-sync","schedule":{"cadence":"hourly","minute":15}}],"schemaVersion":1}
```

`config set` parses the one JSON value before the Foundation transaction sequence: plan, backup,
stage, validate, apply, verify, finalize. Its per-key value grammar is exact: `brainPath` is
`CanonicalAbsolutePathV1`; adapter leaves are Boolean; segment, folder, alias, retrieval, and staleness
keys use the corresponding strict `BrainConfigV1` value type; `brain` is one complete
`BrainConfigV1`; `redaction.patterns` is an array of 0..64 literal strings of 1..200 Unicode scalars
with at least one non-whitespace scalar each; and `redaction` is the strict object containing exactly
that array. JSON `null` is legal only for the whole optional `brain` or `redaction` key and removes
that table. It cannot remove a required field. A nested write whose optional parent is absent refuses;
creating the section requires setting its complete object. `brain.schemaVersion`, `schemaVersion`,
`telemetry`, both `enabled` leaves, both lifecycle records, and every applied-state field are readable
but not mutable here; their transitions belong to their owning lifecycle or migration command.

In-repository Brain scope keys remain mutable and trigger §4.1 reconcile. A failed parse or
verification leaves the previous bytes in place. A schema-valid hand edit to lifecycle state never
creates or updates applied provenance. A projection that differs from the active hash is stale and
inert; restoring the exact currently active projection merely returns to the state already authorized
by its earlier `--apply`. Without that active arm, an already-matching repository or plist set is not
operationally installed.

`brainPath` is repository identity rather than an in-repository scope field once `GitSyncConfigV1`
exists, including while Git is disabled. `config set brainPath` refuses in that state. A schema-valid
hand edit that changes it makes `git status` report `repository_identity_changed` and makes every Git
mutation refuse before spawning Git. Version 1 has no two-repository migrate or forget operation; the
legal recovery is to restore the recorded path or uninstall and initialize the new vault. `git
disable` deliberately preserves the identity record and therefore does not waive this rule.

#### Applied lifecycle provenance

Schema validity is intent, not proof that `--apply` ran. The exact product-owned path
`<product home>/state/lifecycle-activation.json` contains strict `LifecycleActivationRecordV1`:

```text
schemaVersion: 1
git: { state: "inactive" } | { state: "active", configHash: LowerHexSha256 }
automation: { state: "inactive" } | { state: "active", configHash: LowerHexSha256 }
```

Inactive arms have no other field; active hashes are exactly 64 lowercase hexadecimal characters.
Each `configHash` is SHA-256 over UTF-8 domain prefix
`developer-os:lifecycle:<git|automation>:v1\0` followed by canonical JSON of that subsystem's complete
lifecycle projection `{ enabled: true, lifecycle: <complete record> }`. Canonical JSON orders object keys
lexicographically, preserves array order, has no insignificant whitespace, and ends with one LF; the
strict projection has no optional or ignored fields. The record itself uses that same canonical JSON
encoding. It is absent before the first successful lifecycle enable, and absence means both
arms are inactive. On first creation the path must be absent; the exact bytes set the enabled subsystem
active and the other subsystem inactive, and the file becomes a V2 regular-file `content` artifact
with `existedBefore: false`, and is added to the manifest with its exact installed hash. A pre-existing
unowned path refuses rather than being adopted. Every later lifecycle enable, reconcile, or disable
uses the Foundation file executor to update this record and changes its manifest installed hash
through the same composite coordinator as config and external effects. One subsystem transition
preserves the other arm exactly. `config set` cannot write the record.

`LifecycleJournalClosureV1` is the final provenance prerequisite and is computed only by §2.4's closed
four-root ledger scan. Its exact result union is `clear`,
`retry_only { transactionId: LifecycleCoordinatorIdV1, pushPlanHash: LowerHexSha256 }`,
`uninstall_draining { transactionId: LifecycleCoordinatorIdV1 }`, or
`lifecycle_recovery_required`. `uninstall_draining` is legal only for exactly one otherwise valid
non-terminal `uninstall/present_manifest` coordinator, no other non-terminal or malformed ledger,
and a verified `F(uninstall_artifacts)` state at or beyond removal of all four runner-lease paths;
its manifest-removal state and transaction ID must match that coordinator. It grants only the silent
runner-exit decision in §5.4 and ordinary recovery of that exact uninstall. Neither non-clear typed
outcome grants authority for another lifecycle transition, a newly planned sync, or another scheduled
handler. Status may report a non-clear class without spawning Git or a handler; mutation and scheduled
execution must recover or explicitly resolve it first, except for the one bound retry path in §4.4.

Git or automation is operationally active only when all of these agree: the corresponding config
flag is true, its complete lifecycle record validates, the manifest owns the exact activation record
as a non-drifted `content` artifact, the arm is `active`, and `configHash` matches the canonical
configuration projection, and `LifecycleJournalClosureV1` is `clear`. External Git/plist state must
still pass its own checks. A missing record,
missing manifest entry, wrong type, manifest hash drift, inactive arm, or hash mismatch is an inert
state: status reports the exact provenance finding, while Git/network, launchd mutation, scheduled
handlers, and Brain effects do not run. Returning config bytes to a previously applied active hash is
legal only while that arm remains active; a lifecycle `disable --apply` first records the arm inactive,
so changing only `config.toml` back to `enabled: true` cannot re-enable it. Editing the activation file
without its manifest hash is content drift; editing the manifest without the exact record is missing
ownership or drift. Neither is a supported config enable surface. Because the coordinator publishes
record/manifest bytes before external effects and enabled config, the journal-closure condition is what
keeps a forged complete config inert at every interruption boundary, even when the external state
already happens to match.

### 2.3 Bootstrap and global mutation locks

Before an initial install has created the permanent global lock, `init` and fresh
`uninstall/absent_manifest` serialize through `LifecycleBootstrapLockV1` at exact
`<product home>/state/.lifecycle-bootstrap.lock`. They first perform the complete no-follow external
inventory without writing and admit only the operation's closed pre-product shapes. An already
present exact bootstrap-path leaf is provisionally recorded as a control-residue candidate and
projected away only to classify that external remainder; it grants no mutation authority until it is
guarded-opened, locked, identity-rechecked, and the full inventory repeats. They may then
create the absent product-home and `state` directories with owner-only modes, recording exact
`dev`/`ino` plus which directories this attempt created, and atomically create-or-guarded-open the
owner-owned 0600 zero-byte bootstrap leaf. After acquiring its kernel lock, they recheck the lock path
identity and repeat the complete inventory. That second projection may ignore only this exact locked
leaf and the exact attempt-created directory identities; after subtracting them, the external shape
must still equal the admitted preflight remainder. Any other child, identity, owner, mode, or shape change
refuses before an ID or product mutation.

An exact bootstrap leaf left by process death is coordination residue rather than install evidence:
the next invocation may guarded-open and lock it only when its path, type, owner, mode, size, link
count, and post-open identity are exact, then must run the same post-acquisition inventory. A busy
bootstrap lock makes the interactive contender refuse. Cleanup rechecks and unlinks only the exact
locked inode while its descriptor remains held, syncs its parent, and may then remove only attempt-
created, identity-matching empty `state`/product-home directories. A waiter that later acquires the now-unlinked old inode must detect the absent/different
path and restart from preflight rather than proceed. A newly arriving process may create the next
bootstrap leaf only after the prior path unlink; failed empty-directory cleanup in that race preserves
the winner's state. The unlink and those exact cleanup attempts are the only filesystem operations
after the operation's terminal result. Thus crashes and concurrent init/uninstall linearize without
adopting an empty skeleton as a product artifact or weakening the four external inventory shapes.

The three `createdByAttempt` fields are intentionally live-attempt authority, not durable cleanup
claims in the zero-byte lock. A non-crashing attempt uses them to remove its exact empty directories.
If it dies after creating product home or `state`, or after unlinking the bootstrap leaf but before an
`rmdir`, the next preflight cannot distinguish those empty directories from an exact pre-existing
empty shape and therefore preserves them. The only permitted post-crash residue is product home absent,
an empty product home, or product home containing only an empty guarded `state`; no file, lock, temp,
key tombstone, nonce, allocator, plan, journal, or other control residue may be reclassified this way.
The accepted cost is an empty directory skeleton, never authority to delete a directory the current
attempt did not identity-record as created.

`init` holds the bootstrap lock until it has created and acquired the permanent global lock, so the
one exceptional order is bootstrap → global → transaction-specific. Fresh absent-manifest uninstall
uses bootstrap in place of the not-yet-existing global lock and never creates the permanent global
lock. Every already-installed operation starts at the global lock and cannot acquire bootstrap.

Transaction-ID locks prevent recovery collisions but do not serialize two different transactions.
DOS-P7 therefore adds one stable, product-owned mutation lock above them. Apart from the explicitly
pre-product absent-manifest path above, every command that mutates configuration, a repository, a
plist, a manifest, or Brain artifacts takes the global lock before any transaction-specific lock. A scheduled runner first takes its exact
`AutomationRunnerLeaseV1`, then the global lock, then any transaction-specific lock; it already holds
that same descriptor when it serializes its runtime record. Uninstall likewise acquires runner leases
only while no global lock is held, then may reacquire the global lock. No path holding the global lock
waits for a runner lease it does not already own. The resulting order is runner lease when applicable,
then global, then transaction-specific, and no caller may invert it. The global lock retains Foundation's guarded,
kernel-managed stable-file contract at exact `<product home>/state/.lifecycle.lock`: an owner-only
zero-byte regular file opened without following links. It is bookkeeping like Foundation's transaction
locks rather than a manifest artifact and is never unlinked.

An interactive command that finds the global lock busy refuses using the existing recovery-required
exit class. A scheduled run waits with bounded backoff for at most ten minutes. At the deadline it
makes one final non-blocking acquisition attempt. If the lock is still busy, it exits 0 silently with
no status write. If acquired, it rechecks `state/uninstalling.json`,
`LifecycleJournalClosureV1`, and active provenance under the lock; only an absent marker, `clear`
closure, and matching provenance permit a
redacted `skipped_lock_timeout` status. It then performs no handler, Git, network, plist, or Brain
operation.

The timeout status is still a filesystem transaction, not an atomic-write exception. After the final
global-lock acquisition and rechecks, the runner uses its already-held lease/runtime-record lock,
executes plan, backup, stage, validate, apply, verify, finalize for the status file, releases the
global lock, then releases the lifetime lease at process exit. The same per-job lock serializes normal
log rotation/status writes and simultaneous runners; a second same-job invocation that finds the
lease busy exits 0 silently without creating a status.

### 2.4 Journaled external effects

The founder ratified one narrow extension to Foundation on 2026-08-25. Product-owned managed files —
config, plist bytes, logs, status, and sync records — still use the Foundation transaction executor.
The installation manifest preserves Foundation's existing direct-write exception: `ManifestStore`
writes a guarded temporary file, syncs it, renames it, and syncs the directory, but the manifest is
not one of its own managed artifacts and is not nested inside a second Foundation transaction. Two
effects that are not reducible to managed files use typed plans with the same phase order:

- `GitEffectPlanV1` has exact authority over the selected repository's `.git` internals, plus the
  explicitly configured bare Git directory for a local/file push, and no authority over either
  worktree's files; and
- `LaunchdEffectPlanV1` has exact authority over the closed Developer OS labels in the current user's
  launchd domain and no other service.

#### Closed journal ledger and plan envelopes

The lifecycle ledger has exactly four roots. Foundation keeps its existing
`<product home>/state/transactions`; the other three are the V2-owned directories from §2.1. No
recursive search and no caller-supplied root participates. Every root is a guarded canonical
owner-only directory, every journal/plan is a guarded 0600 regular file, every read uses
`O_NOFOLLOW` plus post-open `dev`/`ino` recheck, and closure examines at most 10,000 leaves per root.
Foundation, coordinator, and launchd-effect journals are at most 1 MiB; a Git-effect journal and every
immutable plan are at most 16 MiB before parse/hash. The matching immutable effect plan fixes the
exact tighter journal bound described below, so closure never selects a parser limit from untrusted
journal bytes.

The pre-product `uninstall/absent_manifest/key_present` bootstrap envelope defined in §6 is not a
fifth ledger root: it uses the existing coordinator plan/journal schemas in their exact flat `state`
placement, cannot coexist with an installed four-root ledger, and is enumerated only by that
operation's complete bootstrap inventory. Throughout this section, a requirement to hold the global
mutation lock or a statement that every mutator holds it has exactly that one substitution: this
bootstrap envelope holds and identity-rechecks `LifecycleBootstrapLockV1` for its complete lifetime.
It never creates or acquires `.lifecycle.lock`; every other coordinator and cleanup uses the permanent
global lock as written.

The leaf bound is a capacity invariant, not a lifetime limit that scheduled status writes eventually
hit. Under the global mutation lock, every mutating command first resumes any valid terminal
compaction and compacts eligible terminal Foundation/lifecycle envelopes, then reserves the exact
worst-case leaf count of its proposed immutable plans, journals, locks, temporary replacements, and
staging tree. The steady-state aggregate caps are exactly `LifecycleLedgerBoundsV1`: 10,000 leaves in
each journal root, 100,000 leaves across Foundation staging, 100,000 across Foundation backups, and
1,000,000 across lifecycle staging, with the same 1,000,000 cap for any one coordinator. Counts include
regular files, temporary leaves, and ID/coordinator directories below the inventory root. It refuses
before reserving an ID block if the current count plus the phase-specific maximum live inventory can
exceed any cap. A command never starts new work while terminal debris or a `compacting` coordinator is
eligible for recovery. The read-only closure calculation enumerates and enforces every aggregate cap
but does not delete; cleanup is the separate guarded protocol below.

An upgrade may already exceed 10,000 Foundation leaves. Before any new DOS-P7 ID, the global-lock
preflight may therefore enter overflow recovery: it streams, rather than materializes, at most
1,000,000 aggregate transaction/staging/backup leaves one directory entry at a time, validates every journal and
exact derived child, and compacts only terminal transactions by the same protocol. A malformed/non-
terminal transaction or the million-and-first leaf refuses with recovery instructions and no new
lifecycle ID; no unknown leaf is deleted. It must reduce the journal inventory below 10,000 and each
Foundation companion inventory below 100,000 before ordinary closure or mutation proceeds. Because every later command
compacts/reserves before creating an ID, exceeding the bound again is corruption and follows the same
fail-closed overflow recovery rather than silently widening the steady-state cap.

The exact owner-only `<product home>/staging/lifecycle` tree is a companion staging inventory, not a
fifth journal root. Foundation's existing `<product home>/staging/transactions` and
`<product home>/backups/transactions` trees are two more companion inventories because the unchanged
executor reads and writes them; they admit only IDs and exact mutation-index files derived from a
validated Foundation journal, a future coordinator participant, or the guarded planless-orphan grammar
below. Closure enumerates coordinator-ID directories in lifecycle staging,
then only the `foundation/<participant-id>/journal.json`,
`git/source|destination/<effect-id>`, and `launchd-process/{home,tmp}` grammars defined below, with the exact aggregate/per-coordinator
million-entry caps and no symlink or special file. It also enumerates the two bounded Foundation companion
inventories and relates every ID to a validated final journal or a future coordinator participant.
Pre-plan staging publication may
also use only `.<final-basename>.<lowercase-v4-uuid>.tmp`; it is synced then no-replace-renamed and is
illegal once the coordinator plan exists. Every final leaf must be referenced by a valid immutable
coordinator/participant plan, except that a well-formed planless coordinator staging tree (including
one of those interrupted temps)
may be guarded-removed under the global lock after both coordinator plan/journal and every participant
final journal are proved absent. Unknown, over-limit, or referenced identity-mismatched staging is
`lifecycle_recovery_required`; a clear four-root ledger cannot hide staging debris. The
launchd-process parent and both children are 0700 directories created after ID reservation and counted
as three directory entries in the phase reservation and per-coordinator/aggregate staging bounds. The
selected pinned `launchctl` row requires `home` to remain empty. `tmp` also remains empty except for
the one exact linked `LaunchdBootstrapSnapshotCreationV1` at the current launchd bootstrap frontier;
that leaf is counted in the phase reservation and aggregate/per-coordinator bounds, and must be
unlinked before spawn so both children are empty before and after every process. At each such boundary
they are reopened by identity and enumerated under a shared bounded count. Before coordinator intent,
recovery may remove only exact empty `home`, empty `tmp`, and then empty `launchd-process` directories
after proving the coordinator plan/journal, every participant/effect final journal, and every target/
live transition absent. After intent they remain coordinator-owned staging until terminal compaction
removes those same exact empty directories child-first. Any unknown child, non-directory, identity
change, second snapshot leaf, snapshot outside its exact current frontier, or launchctl-created leaf is
preserved as `lifecycle_recovery_required`; no recursive cleanup guesses that process staging is
disposable.

Foundation leaves retain the implemented `TransactionJournalV1` schema and filename
`<journal.id>.json`; a stable `.<valid-id>.lock` is the only ordinarily permitted non-JSON leaf and is
legal even when planning failed before a journal was created. In each new root, an ID has an exact canonical
journal `<id>.json`, immutable plan `<id>.plan.json`, and independent stable lock `.<id>.lock`; a lock
may exist alone. A journal always requires its plan; a plan without a journal is legal only as the
cursor-not-yet-started participant of one valid coordinator, or as a recovery-only pre-coordinator
orphan whose embedded coordinator ID has no coordinator plan/journal, whose own journal is absent,
and whose exact staging identity still matches. In the coordinator root, an additional plan-without-
journal state is legal only as the exact terminal-compaction suffix in §2.4, after every participant
and coordinator staging entry is absent, with either its matching held/reopenable lock or no lock; the
plan is removed last. Each such state is non-clear and may only be guarded-completed under the global
lock. New IDs use the allocated exact grammars below;
Foundation closure alone additionally accepts the legacy production `tx_<lowercase-v4-uuid>` grammar
for upgrade evidence. Case variants, extra suffixes, orphan journal/plan halves, and temporary leaves
outside the exact guarded planless/rewrite states below, plus directories, symlinks, sockets, and every
other filename or kind, are malformed. Allocated Foundation journal bytes use `FoundationJournalJsonV1`; legacy
Foundation journal reads use its compatibility rule; every new-root journal and every immutable plan
uses `CanonicalJsonV1`. An immutable plan must be byte-identical to re-encoding and match the
journal's domain-separated hash.

```text
LifecycleCoordinatorJournalV1 = {
  schemaVersion: 1,
  id: LifecycleCoordinatorIdV1,
  operation: "git_enable" | "git_disable" | "git_reconcile" | "git_sync" |
             "automation_enable" | "automation_disable" |
             "automation_reconcile" | "uninstall",
  phase: "planned" | "participants_applying" | "manifest_publishing" |
         "external_applying" | "config_publishing" | "push_pending" |
         "compensating" | "finalized" | "rolled_back" | "compacting",
  planHash: LowerHexSha256,
  pushPlanHash: LowerHexSha256 | null,
  nextStep: Integer[0..256],
  compensationNext: Integer[-1..255] | null,
  compactionNext: Integer[0..70] | null,
  terminalOutcome: "finalized" | "rolled_back" | null,
  createdAt: UtcTimestampV1,
  updatedAt: UtcTimestampV1
}

EffectJournalV1<Id, Observation> = {
  schemaVersion: 1,
  id: Id,
  coordinatorId: LifecycleCoordinatorIdV1,
  phase: "planned" | "backed_up" | "staged" | "validated" |
         "applied" | "verified" | "compensating" | "finalized" | "rolled_back",
  planHash: LowerHexSha256,
  nextTransition: Integer[0..200005],
  compensationNext: Integer[-1..200004] | null,
  observations: readonly Observation[0..200005],
  createdAt: UtcTimestampV1,
  updatedAt: UtcTimestampV1
}

UInt64DecimalV1 = canonical base-10 text for 0..2^64-1, with no sign or leading zero
except the literal "0"
EffectiveUidV1 = Integer[0..4294967295] equal to the effective uid captured before planning

AllocatedLifecycleIdV1<Prefix> = literal Prefix + `_` + the allocator's 64-byte lowercase-hex
installNonce + `_` + a UInt64DecimalV1 counter reserved from that allocator
FoundationTransactionIdV1 = AllocatedLifecycleIdV1<"tx"> |
  legacy production `tx_` + lowercase RFC-4122 version-4 UUID
LifecycleCoordinatorIdV1 = AllocatedLifecycleIdV1<"lc">
GitEffectIdV1 = AllocatedLifecycleIdV1<"ge">
LaunchdEffectIdV1 = AllocatedLifecycleIdV1<"le">

LegacyFoundationMutationIndexV1 = canonical unsigned decimal integer in `0..4294967294`
with no sign or leading zero except literal `0`; the upper bound is `2^32 - 2`, the greatest index
addressable by the shipped ECMAScript array whose maximum length is `2^32 - 1`

LifecycleLedgerBoundsV1 = {
  journalLeavesPerRoot: 10000,
  foundationStagingAggregateLeaves: 100000,
  foundationBackupAggregateLeaves: 100000,
  lifecycleStagingAggregateLeaves: 1000000,
  lifecycleStagingPerCoordinatorLeaves: 1000000,
  foundationOverflowAggregateLeaves: 1000000
}

GitSyncCardinalityV1 = {
  maxChanges: 100000,
  maxNewBlobs: 100000,
  maxNewTrees: 100000,
  maxNewCommits: 1,
  maxSourceObjectTransitions: 200001,
  maxSourceControlTransitions: 4,
  maxSourceReflogTransitions: 2,
  maxDestinationControlTransitions: 2,
  maxGitEffectTransitions: 200005,
  maxNewGitTreeEntries: 511
}

GitMetadataBoundsV1 = {
  sourceConfigMaxBytes: 1048576,
  destinationConfigMaxBytes: 1048576,
  candidateConfigMaxBytes: 2097152,
  sourceIndexMaxBytes: 536870912,
  sourceHeadMaxBytes: 4096,
  destinationHeadMaxBytes: 4096,
  looseRefMaxBytes: 41,
  sourceHeadReflogMaxBytes: 67108864,
  sourceBranchReflogMaxBytes: 67108864,
  destinationBranchReflogMaxBytes: 67108864,
  reflogAppendMaxBytes: 4096,
  reflogPostimageMaxBytes: 67112960
}

GitReflogNameV1 = UTF-8 text of 1..256 bytes with no NUL, C0/C1 control, `<`, `>`, or line break
GitReflogEmailV1 = ASCII text of 1..320 bytes with no NUL, whitespace, control, `<`, or `>`
GitReflogUnixSecondsV1 = canonical signed base-10 integer in JavaScript's safe-integer range
GitReflogUtcOffsetV1 = literal `+` or `-` followed by `HHMM`, where HH is 00..14 and MM is 00..59
GitReflogOidV1 = LowerHexSha1 | literal "0000000000000000000000000000000000000000"

GitReflogStateV1 =
  | { state: "absent" }
  | { state: "present", bytesHash: LowerHexSha256,
      size: Integer[0..67112960] }

GitReflogAppendV1 = {
  role: "source_head_reflog" | "source_branch_reflog" |
        "destination_branch_reflog",
  path: CanonicalAbsolutePathV1,
  before: GitReflogStateV1,
  oldOid: GitReflogOidV1,
  newOid: LowerHexSha1,
  committer: {
    name: GitReflogNameV1,
    email: GitReflogEmailV1,
    unixSeconds: GitReflogUnixSecondsV1,
    utcOffset: GitReflogUtcOffsetV1
  },
  message: "developer-os sync",
  lineBytes: Integer[1..4096],
  lineHash: LowerHexSha256,
  after: { state: "present", bytesHash: LowerHexSha256,
    size: Integer[1..67112960] }
}

GitReflogPlanV1 =
  | { side: "source", head: GitReflogAppendV1 | null,
      branch: GitReflogAppendV1 | null }
  | { side: "destination", branch: GitReflogAppendV1 | null }

GitPackReaderBudgetV1 = {
  compressedPackMaxBytes: 2147483648,
  packHeaderObjectCount: Integer[0..200001],
  closedEffectObjectCount: Integer[0..200001],
  admittedObjectCount: Integer[0..200001],
  perObjectInflatedMaxBytes: 536870912,
  aggregateInflatedMaxBytes: 8589934592,
  deltaDepthMax: 50,
  deltaInstructionMax: 10000000,
  deltaWorkMaxBytes: 8589934592,
  residentMemoryMaxBytes: 268435456,
  additionalTempMaxBytes: 10737418240,
  inheritedPushDeadlineMs: 600000
}

GitSemanticStateV1 =
  | { kind: "none" }
  | { kind: "oid", value: LowerHexSha1 }
  | { kind: "symbolic_ref", value: FullBranchRefV1 }

GitTreeRelativePathV1 = UTF-8 text of 1..4096 bytes, split on literal `/` into
1..128 non-empty components other than `.` or `..`, with no NUL or backslash

GitTreeFingerprintEntryV1 =
  | { relativePath: GitTreeRelativePathV1, kind: "directory",
      ownerUid: EffectiveUidV1, mode: Integer[0..4095],
      dev: UInt64DecimalV1, ino: UInt64DecimalV1 }
  | { relativePath: GitTreeRelativePathV1, kind: "regular_file",
      ownerUid: EffectiveUidV1, mode: Integer[0..4095],
      dev: UInt64DecimalV1, ino: UInt64DecimalV1, nlink: 1,
      size: Integer[0..2^53-1], hash: LowerHexSha256 }

GitTreeFingerprintV1 = {
  root: { ownerUid: EffectiveUidV1, mode: Integer[0..4095],
    dev: UInt64DecimalV1, ino: UInt64DecimalV1 },
  entries: readonly GitTreeFingerprintEntryV1[1..511]
}

GuardedGitPathStateV1 =
  | { state: "absent" }
  | { state: "regular_file", hash: LowerHexSha256, size: Integer[0..2^53-1],
      mode: Integer[0..4095], dev: UInt64DecimalV1, ino: UInt64DecimalV1,
      semantic: GitSemanticStateV1 }
  | { state: "directory_tree", treeHash: LowerHexSha256,
      entryCount: Integer[1..511], ownerUid: EffectiveUidV1, mode: Integer[0..4095],
      dev: UInt64DecimalV1, ino: UInt64DecimalV1,
      symbolicHead: FullBranchRefV1 }

GitRelinquishedDirectoryRootV1 = {
  state: "relinquished_directory_root",
  dev: UInt64DecimalV1,
  ino: UInt64DecimalV1,
  observedOwnerUid: Integer[0..4294967295],
  observedMode: Integer[0..4095]
}

PlannedGitPathStateV1 =
  | { state: "absent" }
  | { state: "regular_file", hash: LowerHexSha256, size: Integer[0..2^53-1],
      mode: Integer[0..4095], semantic: GitSemanticStateV1 }
  | { state: "directory_tree", treeHash: LowerHexSha256,
      entryCount: Integer[1..511], ownerUid: EffectiveUidV1, mode: Integer[0..4095],
      symbolicHead: FullBranchRefV1 }

GitEffectEvidenceV1 = {
  stagedPostimagePath: CanonicalAbsolutePathV1 | null,
  stagedPostimage: GuardedGitPathStateV1 | null,
  beforeTombstonePath: CanonicalAbsolutePathV1 | null,
  afterTombstonePath: CanonicalAbsolutePathV1 | null
}

GitEffectTransitionV1 = {
  role: "source_git_directory_tree" | "source_head" | "source_config" |
        "source_index" | "source_head_reflog" | "source_branch_reflog" |
        "source_branch_ref" | "source_object" | "destination_pack" |
        "destination_index" | "destination_branch_reflog" | "destination_ref",
  path: CanonicalAbsolutePathV1,
  operation: "create" | "replace" | "remove" | "reuse",
  before: GuardedGitPathStateV1,
  after: PlannedGitPathStateV1,
  evidence: GitEffectEvidenceV1
}

GitEffectObservationV1 = {
  transitionIndex: Integer[0..200004],
  outcome: "created" | "replaced" | "removed" | "reused" |
    "relinquished_created_object" | "relinquished_created_git_tree",
  observedAfter: GuardedGitPathStateV1 | GitRelinquishedDirectoryRootV1,
  matchedIdentity: "staged_postimage" | "planned_preimage" |
    "published_root_identity"
}

GitEffectPlanV1 = {
  schemaVersion: 1,
  id: GitEffectIdV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  side: "source" | "destination",
  worktreeRoot: CanonicalAbsolutePathV1 | null,
  gitDirectory: CanonicalAbsolutePathV1,
  quarantineRoot: CanonicalAbsolutePathV1,
  processTableHash: LowerHexSha256,
  planningTranscriptHash: LowerHexSha256,
  reflogPlan: GitReflogPlanV1 | null,
  packReaderBudget: GitPackReaderBudgetV1 | null,
  maximumJournalBytes: Integer[1..16777216],
  pushSourceProjection: { before: GitSourceStateV1,
    after: GitSourceStateV1 } | null,
  transitions: readonly GitEffectTransitionV1[0..200005]
}

ClosedLaunchdBaseLabelV1 =
  "com.developer-os.brain-reindex" | "com.developer-os.brain-lint" |
  "com.developer-os.doctor" | "com.developer-os.git-sync"

LaunchdGuiDomainV1 = literal "gui/" + canonical unsigned-decimal EffectiveUidV1

LaunchdGenerationV1 = LowerHexSha256

GeneratedLaunchdLabelV1 = ClosedLaunchdBaseLabelV1 + literal ".g." + LaunchdGenerationV1

LaunchdScheduledProductHomeV1 = CanonicalAbsolutePathV1 whose UTF-8 bytes also satisfy
BoundedArgV1 and XML-1.0 scalar-text rules

LaunchdGenerationProjectionV1 = {
  job: JobIdV1,
  baseLabel: ClosedLaunchdBaseLabelV1,
  domain: LaunchdGuiDomainV1,
  schedule: NormalizedScheduleV1,
  productHome: LaunchdScheduledProductHomeV1,
  plistPath: CanonicalAbsolutePathV1,
  executablePath: CanonicalAbsolutePathV1,
  baseArgv: readonly [BoundedArgV1, "automation", "run", JobIdV1,
    "--scheduled", "--product-home", LaunchdScheduledProductHomeV1],
  logPath: CanonicalAbsolutePathV1,
  statusPath: CanonicalAbsolutePathV1
}

LaunchdLiveStateV1 =
  | { state: "unloaded" }
  | { state: "loaded", label: GeneratedLaunchdLabelV1,
      generation: LaunchdGenerationV1 }

LaunchdEffectTransitionV1 = {
  job: JobIdV1,
  label: GeneratedLaunchdLabelV1,
  generation: LaunchdGenerationV1,
  domain: LaunchdGuiDomainV1,
  plistPath: CanonicalAbsolutePathV1,
  plistHash: LowerHexSha256,
  before: LaunchdLiveStateV1,
  after: LaunchdLiveStateV1
}

LaunchdEffectObservationV1 = {
  transitionIndex: Integer[0..7],
  observedAfter: LaunchdLiveStateV1
}

LaunchdEffectPlanV1 = {
  schemaVersion: 1,
  id: LaunchdEffectIdV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  position: "before_files" | "after_files",
  processTableHash: LowerHexSha256,
  maximumJournalBytes: Integer[1..1048576],
  transitions: readonly LaunchdEffectTransitionV1[0..8]
}

SecretOpaqueFileStateV1 =
  | { state: "absent" }
  | { state: "present", kind: "regular_file", ownerUid: EffectiveUidV1,
      mode: 384, nlink: 1, size: Integer[32..1048576],
      dev: UInt64DecimalV1, ino: UInt64DecimalV1 }

RedactionKeyStatePlanV1 = {
  schemaVersion: 1,
  coordinatorId: LifecycleCoordinatorIdV1,
  sourcePath: CanonicalAbsolutePathV1,
  tombstonePath: CanonicalAbsolutePathV1,
  before: SecretOpaqueFileStateV1
}

GitEffectJournalV1 = EffectJournalV1<GitEffectIdV1, GitEffectObservationV1>
LaunchdEffectJournalV1 = EffectJournalV1<LaunchdEffectIdV1, LaunchdEffectObservationV1>

LifecycleCoordinatorStepV1 =
  | { kind: "foundation", slot: FoundationParticipantSlotV1,
        participantId: FoundationTransactionIdV1 }
  | { kind: "manifest", transition: "preserve_before" | "publish_after" |
        "commit_absence" | "finalize_tombstones" }
  | { kind: "source_git_effect", participantId: GitEffectIdV1 }
  | { kind: "destination_git_effect", participantId: GitEffectIdV1,
        pushPlanHash: LowerHexSha256 }
  | { kind: "launchd_before_files", participantId: LaunchdEffectIdV1 }
  | { kind: "launchd_after_files", participantId: LaunchdEffectIdV1 }
  | { kind: "redaction_key", transition: "stage" | "delete" }
  | { kind: "network_push", pushPlanHash: LowerHexSha256 }
  | { kind: "drain_runners" }

LifecyclePreviewFileStateV1 =
  | { state: "absent" }
  | { state: "present", hash: LowerHexSha256, size: Integer[0..2^53-1] }

LifecyclePreviewFileChangeV1 = {
  role: "activation" | "config" | "plist" | "manifest" |
        "source_git" | "destination_git" | "redaction_key",
  targetPath: CanonicalAbsolutePathV1,
  operation: "create" | "replace" | "remove" | "keep",
  before: LifecyclePreviewFileStateV1,
  after: LifecyclePreviewFileStateV1
}

GitPlanPreviewV1 = {
  repositoryMode: "initialize" | "adopt" | "preserve",
  repositoryRoot: CanonicalAbsolutePathV1,
  branch: ValidatedGitBranchV1,
  remote: GitSyncConfigV1.remote,
  scope: GitScopeSnapshotV1,
  changes: readonly LifecyclePreviewFileChangeV1[0..200005]
}

LifecyclePlanPreviewV1 = {
  schemaVersion: 1,
  previewHash: LowerHexSha256,
  command: "git_enable" | "git_disable" |
           "automation_enable" | "automation_disable",
  executionOperation: "git_enable" | "git_disable" | "git_reconcile" |
                      "automation_enable" | "automation_disable" |
                      "automation_reconcile",
  normalizedProjection:
    | { subsystem: "git", enabledAfter: boolean, lifecycle: GitSyncConfigV1 }
    | { subsystem: "automation", enabledAfter: boolean,
        lifecycle: AutomationConfigV1 },
  authority: {
    productHome: CanonicalAbsolutePathV1,
    configPath: CanonicalAbsolutePathV1,
    activationPath: CanonicalAbsolutePathV1,
    manifestPath: CanonicalAbsolutePathV1
  },
  processTableTemplateHashes: {
    git: LowerHexSha256 | null,
    launchd: null | {
      observation: LowerHexSha256,
      mutationTemplate: LowerHexSha256
    }
  },
  files: readonly LifecyclePreviewFileChangeV1[0..16],
  git: GitPlanPreviewV1 | null,
  launchd: LaunchdPlanPreviewV1 | null
}

LifecycleCoordinatorPlanV1 = {
  schemaVersion: 1,
  id: LifecycleCoordinatorIdV1,
  previewHash: LowerHexSha256 | null,
  operation: LifecycleCoordinatorJournalV1.operation,
  maximumJournalBytes: Integer[1..1048576],
  authority: {
    productHome: CanonicalAbsolutePathV1,
    configPath: CanonicalAbsolutePathV1,
    activationPath: CanonicalAbsolutePathV1,
    manifestPath: CanonicalAbsolutePathV1,
    repositoryRoot: CanonicalAbsolutePathV1 | null,
    plistPaths: readonly CanonicalAbsolutePathV1[0..4]
  },
  participants: {
    foundation: readonly FoundationParticipantRefV1[0..64],
    manifest: ManifestStatePlanV1 | null,
    sourceGitEffect: { id: GitEffectIdV1, planHash: LowerHexSha256 } | null,
    destinationGitEffect: { id: GitEffectIdV1, planHash: LowerHexSha256 } | null,
    launchdBeforeFiles: { id: LaunchdEffectIdV1, planHash: LowerHexSha256 } | null,
    launchdAfterFiles: { id: LaunchdEffectIdV1, planHash: LowerHexSha256 } | null,
    launchd: LaunchdPlanV1 | null,
    redactionKey: RedactionKeyStatePlanV1 | null
  },
  push: PersistedGitPushPlanV1 | null,
  steps: readonly LifecycleCoordinatorStepV1[1..256]
}

LifecycleExecutionPlanV1 = LifecycleCoordinatorPlanV1

FoundationParticipantSlotV1 =
  "activation" | "config" | "plist_files" | "sync_record" |
  "uninstall_marker" | "uninstall_artifacts"

FoundationParticipantRefV1 = {
  id: FoundationTransactionIdV1,
  slot: FoundationParticipantSlotV1,
  role:
    | { kind: "forward", compensationId: FoundationTransactionIdV1 | null }
    | { kind: "compensation", forwardId: FoundationTransactionIdV1 },
  mutations: readonly FoundationMutationRefV1[1..256],
  maximumJournalBytes: Integer[1..1048576],
  planHash: LowerHexSha256,
  initialJournal: {
    finalPath: CanonicalAbsolutePathV1,
    plannedBytesHash: LowerHexSha256,
    stagedPath: CanonicalAbsolutePathV1,
    stagedIdentity: { hash: LowerHexSha256, size: Integer[1..1048576],
      mode: 384, dev: UInt64DecimalV1, ino: UInt64DecimalV1 }
  }
}

FoundationMutationRefV1 = {
  targetPath: CanonicalAbsolutePathV1,
  operation: "create" | "replace" | "remove",
  expectedBeforeHash: LowerHexSha256 | null,
  contentHash: LowerHexSha256 | null,
  contentSize: Integer[0..16777216] | null,
  stagedPath: CanonicalAbsolutePathV1 | null
}

LifecycleCompactionEntryV1 =
  | { kind: "foundation_transaction", participantId: FoundationTransactionIdV1 }
  | { kind: "git_effect", side: "source" | "destination", participantId: GitEffectIdV1 }
  | { kind: "launchd_effect", position: "before_files" | "after_files",
      participantId: LaunchdEffectIdV1 }
  | { kind: "coordinator_staging" }
  | { kind: "coordinator_envelope" }

LifecycleTerminalCompactionV1 = {
  coordinatorId: LifecycleCoordinatorIdV1,
  terminalOutcome: "finalized" | "rolled_back",
  entries: readonly LifecycleCompactionEntryV1[2..70]
}

FoundationTerminalCompactionV1 = {
  transactionId: FoundationTransactionIdV1,
  terminalPhase: "finalized" | "rolled_back",
  mutationCount: Integer[1..1000000]
}
```

`LifecyclePlanPreviewV1` is the only public plan record. Its `previewHash` is SHA-256 over
`developer-os:lifecycle-preview:v1\0` followed by its exact `CanonicalJsonV1` bytes with the
`previewHash` member omitted. Preview construction performs every bounded read and normalization
needed to choose the operation, but reserves no lifecycle ID, creates no staging/backup/lock/plan
leaf, and records no device or inode identity. `files` and nested Git/launchd changes contain the
complete user-visible operation in canonical path/role order; they are not an estimate that apply may
widen. A Git preview requires non-null `git`, null `launchd`, a non-null Git table hash, and null
launchd hashes. An automation preview requires null `git`, non-null `launchd`, a null Git hash, and
launchd hashes byte-equal to the nested `observationProcessTableHash` and
`mutationProcessTableTemplateHash`; every other null/equality combination refuses.

For one of the four plan/apply commands, `--apply` first constructs the same preview in memory, then
acquires the global lock and reconstructs it from fresh guarded reads. A different hash refuses before
allocation. Only after the same `previewHash` verifies may apply advance the durable allocator, create
its exact staging directories, bind their identities, and persist `LifecycleExecutionPlanV1` plus its
participants. Its `previewHash` must equal the public preview; `git_sync` and `uninstall`, which have no
public plan/apply surface, require null. Allocated IDs, concrete staging paths, journal maxima, and
device/inode identities are the only information the execution plan may add. It cannot change the
normalized projection, authority, path roles, operations, preimage hashes, desired postimage hashes,
Git intent, launchd entry set, or process-table hashes. Recovery consumes only this durable execution
envelope and never regenerates allocations from a preview.

Every DOS-P7 field named `dev` or `ino`, including `ManifestStatePlanV1` and
`RedactionKeyStatePlanV1`, uses `UInt64DecimalV1`; JavaScript safe integers are not a filesystem-
identity encoding. This is required by the measured macOS inode range and is checked before equality.

A `directory_tree` fingerprint is one exact recursive algorithm. Starting from a guarded open root
descriptor, the walker reads each directory without following links, decodes every name as valid
UTF-8, rejects NUL, backslash, `.`/`..`, more than 128 relative components, and any path over 4096
bytes, and emits every descendant exactly once. Directories must be owned by `EffectiveUidV1` and
regular files must additionally have `nlink == 1`; symbolic links, hard-linked regular files, FIFOs,
sockets, devices, invalid UTF-8 names, ownership changes, and every other special state refuse. Each
regular file is reopened from its parent descriptor, rechecked by `dev`/`ino`, bounded to the plan's
size limits, and hashed before its record is admitted. Records are unique and sorted by the unsigned
UTF-8 bytes of `relativePath`; parent directories precede descendants because the literal `/` is part
of that comparison. `treeHash` is SHA-256 over `developer-os:git-tree-fingerprint:v1\0` followed by
the exact `CanonicalJsonV1` bytes of `GitTreeFingerprintV1`. Its `root` fields must equal the outer
tree state's mode/device/inode and owner; `entryCount` equals `entries.length`. Recomputing either a
different record, order, count, root identity, or digest is a third state, not a byte-equal reuse.

Those unions are exhaustive. `source_git_directory_tree` is the one version-1 representation of a
new `.git` during `git_enable` only: the complete minimal tree is durably built in quarantine, its
root `dev`/`ino`, recursive canonical tree hash, exact entry count, modes, and symbolic `HEAD` are
captured, and the root is published by one atomic no-replace directory rename. It is illegal in every
`git_sync`; after enable, including for an unborn repository, sync always uses existing-repository
object/index/reflog/ref transitions. Once published, compensation never walks,
renames, or recursively deletes that `.git`: another Git process may add a descendant between any
fingerprint check and rename, or continue writing through an already-open descriptor after a rename.
After every source ref/index/control preimage has been restored, compensation reopens only the final
root with `O_DIRECTORY | O_NOFOLLOW`, requires its `dev`/`ino` to equal the plan-published root, records
its current owner/mode without trusting its descendants, rewrites the observation to
`relinquished_created_git_tree`, and preserves it in place as ownership-neutral state. A missing,
non-directory, or different root inode is recovery-required. A later enable may consider the retained
tree only through the normal existing-repository validation; no rollback or compactor adopts or
deletes it. A standalone `source_head` is a regular file whose semantic arm must be
`symbolic_ref`; branch/destination refs require `oid`; every other regular role requires `none`.
Directory-tree state is legal only for the source-tree role. Source roles require `side: "source"`,
`worktreeRoot` equal to the canonical vault root, and `gitDirectory` equal to its direct `.git` child.
Destination roles require `side: "destination"`, null `worktreeRoot`, and `gitDirectory` equal to the
configured canonical bare root. No effect plan can name roles from both sides. `pushSourceProjection`
is non-null only for the source effect that publishes a new `PersistedGitPushPlanV1` commit; its two
states equal that push plan's `sourceBefore`/`sourceAfter`, and the ordered transitions are exactly the
changed leaves between them. It is null for destination effects, Git enable/disable/reconcile effects,
and a push that reuses an already-published source commit with no source effect.

`reflogPlan` is non-null exactly for a source or local-destination sync effect that changes its
controlling ref and has at least one required log append. A log is required when its guarded regular
file already exists or when the validated effective `core.logAllRefUpdates` policy would create it:
the version-1 default is true for the supported non-bare source and false for the supported bare
destination. Source ref publication independently evaluates `logs/HEAD` and
`logs/refs/heads/<branch>`; local destination publication evaluates only
`logs/refs/heads/<branch>`. A missing required log is a create; a present required log is a replace;
a missing log under a false policy is null. A present log must be empty or LF-terminated; its earlier
lines are copied byte-for-byte and need not be semantically reinterpreted. Every parent directory for
a required create must already be a guarded directory in the supported repository; otherwise version
1 refuses `unsupported_reflog_layout`. `git_enable/initialize` creates the exact branch-ref and reflog
parent directory chains for its recorded branch, so its first unborn sync satisfies that precondition.
Wrong type, symlink, hard link, unreadable leaf, a file
larger than its 64-MiB role-specific preimage bound, or an unrecognized config value refuses before
intent. `GitReflogStateV1` admits the resulting postimage through 67,112,960 bytes only so a legal
64-MiB preimage plus the separately bounded 4-KiB append remains representable; it never widens a
preimage read.

The exact append is `<old-oid> SP <new-oid> SP <name> SP "<" <email> ">" SP <unix-seconds> SP
<utc-offset> HT "developer-os sync" LF`, using the same validated committer identity and date injected
into the candidate commit. The complete line is at most 4 KiB. Planning streams the bounded preimage
into a same-filesystem staged postimage, appends exactly that line, syncs and identity-binds the result,
and stores only its size/hashes and typed fields in the plan. Forward publication compare-and-swaps
the exact preimage to that staged postimage; a different current hash or inode is a third state.
Rollback restores the ref first, then restores the branch and HEAD reflog preimages in reverse order;
it never truncates a log by a newly measured length or synthesizes a line during recovery.

Every non-null `GitReflogAppendV1` is bijective with exactly one effect transition of the same role
and path, and no reflog-role transition exists without that matching plan member. An absent/present
`before` selects `create`/`replace`; its hash and size equal the transition's guarded preimage, while
`after.bytesHash` and `after.size` equal the planned postimage and `after.size` equals `lineBytes` for
an absent preimage or `before.size + lineBytes` for a present one. The
transition's semantic arm is `none`. Source HEAD and branch appends both use the controlling source
branch transition's old/new OIDs; the destination branch append uses the destination target-ref
transition's old/new OIDs. An absent controlling ref supplies the all-zero old OID. Each append's
committer and time equal the candidate commit, and its before/after state equals the corresponding
source or persisted local-destination projection. Missing, duplicate, extra, wrong-role, wrong-path,
wrong-size/hash, or wrong-OID bindings refuse before intent and at every recovery reopen.

Every `maximumJournalBytes` field is a feasibility proof, not a caller-selected allowance. Before
reserving any ID block, planning computes conservative maxima for every journal the operation can
reach. A Foundation maximum uses the actual ordered immutable mutation vector, the exact
`FoundationJournalJsonV1` insertion order and escaping, the longest legal allocated ID, the exact
closed internal kind, both fixed-width `UtcTimestampV1` fields, and every phase. It covers standalone
Foundation work as well as each
forward/inverse participant. A coordinator maximum uses the actual operation/step cardinality plus
longest legal IDs, hashes, timestamps, phases, forward/compensation/compaction cursors, push-hash arm,
and terminal outcome. An effect maximum uses the actual transition/state shapes plus longest legal
allocated IDs/cursors and computes the maximum `CanonicalJsonV1` byte length, including LF, over every
reachable phase, forward/compensation cursor, cumulative observation prefix, and legal outcome/
matched-identity arm.

Any conservative Foundation, coordinator, or launchd maximum above 1 MiB, or Git maximum above 16
MiB, refuses before reservation. After allocation, planning recomputes each exact maximum with the real
IDs and hashes. `FoundationParticipantRefV1.maximumJournalBytes`,
`LifecycleCoordinatorPlanV1.maximumJournalBytes`, and each effect plan field must equal that exact
value; a standalone Foundation transaction retains the equally derived value in its in-memory
execution context and recovery deterministically re-derives it from the journal's immutable fields,
rather than adding a field to the shipped journal schema. An impossible
post-allocation overflow consumes only the already durable allocator gap and refuses before staging,
plan, journal, target, process, or live-state intent.

The initial staged Foundation journal and every later Foundation/coordinator/effect journal rewrite
are fully encoded to a bounded temporary and checked against both the derived/plan-bound maximum and
the applicable 1-MiB or 16-MiB parser ceiling before rename. Recovery recomputes the Foundation value
from its immutable participant ref, or from the immutable fields of a standalone journal, and the
coordinator/effect values from their immutable plans; for a standalone journal those fields are
`id`/`kind`/`createdAt`/`mutations` and recovery re-enumerates every legal phase plus fixed-width
`updatedAt`. A mismatch or over-limit temp/final is
recovery-required and is never rewritten from partially parsed bytes. Consequently the schema's
200,005 transition ceiling and Foundation's 256-mutation ceiling are only count ceilings: concrete
plan/journal feasibility may admit fewer entries, but no admitted operation can later produce an
unreadable journal.

`quarantineRoot` is not caller-selected: it is exact
`<product home>/staging/lifecycle/<coordinator-id>/git/<side>/<effect-id>`. Before staging, planning
requires its filesystem device to equal the device of the target Git directory, or of the worktree
parent when `.git` is absent; a source/local destination on another device is
`cross_device_git_state` and refuses unchanged. That version-1 compatibility limit keeps every
pre-intent staging leaf inside the one derived product staging tree recovery can enumerate while still
making each later publication an atomic rename. Every root is owner-only, initially absent,
non-overlapping with real Git directories, and removed only after terminal verification or rollback.

Every non-`reuse` regular-file or directory-tree postimage is staged on the same device at exact
`<quarantineRoot>/post/<transition-index>`, synced, reopened without following links, and recorded in
the immutable plan with its pre-publication `dev`/`ino` identity. Replace/remove preimages move
no-replace to exact `<quarantineRoot>/before/<transition-index>`; rollback moves a created/replaced
postimage to exact `<quarantineRoot>/after/<transition-index>` before restoring the prior identity.
The three evidence fields are null exactly when that operation cannot use them: a present postimage
requires staged evidence except for `reuse`; replace/remove require the before tombstone; and
replace and non-relinquishable create require the after tombstone. A `create` of
`source_git_directory_tree`, `source_object`, `destination_pack`, or `destination_index` instead
requires `afterTombstonePath: null`, because compensation is forbidden to rename or delete its
published postimage. All three roots start absent and are guarded canonical
children of the plan quarantine. `create` is absent→present; `replace` is present→present; `remove`
is present→absent; and `reuse` has identical present states captured before coordinator intent.
Source objects and destination pack/index files are classified during planning: absent becomes
`create`, guarded byte-identical present becomes ownership-neutral `reuse`, and every other state
refuses. Reuse is never inferred after intent and no ref can use it.

This identity rule closes the apply-before-journal crash. After no-replace publication, a final leaf
with the pre-recorded staged `dev`/`ino` is the plan's postimage even if the observation append did not
run; an equal-hash leaf with a different identity is always a third state. If no-replace publication
returns `EEXIST` after planning an absent preimage, recovery preserves the appearing leaf, does not
append an observation, and returns exit 6: it cannot delete that leaf or claim a rolled-back absent
preimage. A missing staged inode plus a different byte-identical final inode, or any collision at a
tombstone, follows the same rule. Remove is a retained rename rather than an unlink until the owning
effect and coordinator are terminal. No-replace is required at every
stage→final, preimage→before-tombstone, final→after-tombstone, and tombstone→restored-final boundary.

Journal cursors make every individual transition recoverable. Let `n = plan.transitions.length` and
`c = journal.nextTransition`. `observations` always has exactly `c` entries with contiguous indices
`0..c-1`; each equals the guarded verified post-state for that plan transition. The following table is
the exhaustive phase relation; any other phase/cursor/observation/compensation tuple is malformed:

| `phase` | Exact cursor and observation state | Exact external-state meaning |
|---|---|---|
| `planned` | `c == 0`, observations empty, compensation null | immutable plan and journal exist; every external target equals its recorded preimage; every required Git staged postimage exists, and no Git tombstone or launchd operation has started |
| `backed_up` | same tuple | every preimage identity/live state has been reopened and bound; targets and staged Git evidence are unchanged |
| `staged` | same tuple | every required Git postimage is synced and plan-bound; launchd has no staging action; real targets remain unchanged |
| `validated` | same tuple | all preimages, Git evidence, containment, plist bindings, live labels, and effect authority have been revalidated; `n == 0` advances directly to `verified` |
| `applied` | `0 <= c < n`, observations cover exactly `0..c-1`, compensation null | prefix `0..c-1` is verified; transition `c` is at exactly one effect-specific forward microstate below, including command/rename-before-journal states; suffix `c+1..n-1` equals its preimage |
| `verified` | `c == n`, observations cover `0..n-1`, compensation null | every postimage verifies, but reversible tombstones remain and the coordinator may still compensate |
| `compensating` | `0 <= c <= n`, observations cover `0..c-1`, `-1 <= compensationNext < c` | `compensationNext` is the only reverse frontier; larger indices equal preimages except exact relinquished source/destination object creates and an exact relinquished new source `.git`, while smaller indices still equal postimages |
| `rolled_back` | observations still cover the original `0..c-1`, `compensationNext == -1` | every applied prefix transition equals its preimage except those exact relinquished object/tree creates, which remain published and ownership-neutral; every untouched suffix still equals its preimage |
| `finalized` | `c == n`, observations cover `0..n-1`, compensation null | coordinator point of no return was durable, retained tombstones were removed, and this journal can never enter compensation |

The Git forward microstates for transition `c` are closed. `create` permits only absent final plus
bound staged postimage, then bound final postimage plus absent staged path. A different inode at final,
including a byte-identical post-plan `EEXIST`, is a preserved third state and cannot advance or roll
back to absence. `replace` permits recorded preimage at final plus staged postimage, then absent final
plus the same preimage at `before/<c>`, then bound final postimage plus that retained preimage.
`remove` permits recorded preimage at final, then absent final plus that exact inode at `before/<c>`.
`reuse` permits only the unchanged recorded final. Every required before/after tombstone not named in
the current microstate is absent. Recovery from `applied` resolves the actual one of those states,
finishes forward verification if publication occurred before the journal rewrite, appends exactly one
observation and advances `c` atomically, and only then may enter compensation. It never guesses an
outcome from equal bytes.

Forward application records only `created`, `replaced`, `removed`, or `reused` as dictated by the
transition. `relinquished_created_object` is legal only after the reverse cursor has passed a
`source_object`, `destination_pack`, or `destination_index` `create` under the exception below.
`relinquished_created_git_tree` is legal only after it has passed a source
`source_git_directory_tree` `create`. Both outcomes remain legal only in
`compensating`/`rolled_back`; neither can appear in a forward prefix, `verified`, or `finalized`
journal.

The launchd microstates are separate and exhaustive. A `before_files` plan contains only exact
`loaded { old generated label, old generation } → unloaded` transitions; an `after_files` plan
contains only `unloaded → loaded { new generated label, new generation }` transitions. Already-matching
live states are omitted, and replacement is always the coordinator sequence `P` unload old → verified
plist publication → `Q` bootstrap new. At forward transition `c`, the exact query below may return only
the recorded preimage (the plan-bound `bootout`/`bootstrap` has not taken effect) or postimage (the
command took effect before the observation rewrite). Preimage causes the one plan-bound command to
run; postimage appends the observation without repeating it; every other generation/label/state
refuses. `bootstrap` first descriptor-opens the exact plan-bound plist identity, verifies its hash,
generated Label, and ProgramArguments, then constructs the exact already-unlinked private snapshot
below and passes only that snapshot descriptor as inherited FD 3 to the literal `/dev/fd/3` argv. The
real source-plist descriptor is never inherited. `bootout` verifies the exact generated label/domain and current plan-bound
plist before issuing the command. A death after bootstrap/bootout but before observation is therefore
classified by an observable generation label, not guessed from command success or a non-observable
plist hash.

At a launchd reverse frontier, postimage means run the exact inverse and preimage means the inverse
already took effect before the cursor rewrite. Compensation of `Q` bootouts the new label before any
plist inverse; after prior plist bytes verify, compensation of `P` bootstraps the old label. Thus a
loaded→loaded replacement may crash after old unload, after new bootstrap, after compensating new
unload, or after compensating old bootstrap and still has exactly one legal state/cursor reading.
Wrong live generation among the closed candidates, a foreign exact base/planned/retained label,
command refusal, or plist mismatch is preserved as
`lifecycle_recovery_required`; no launchd transition is treated as `runtime_reuse`.

`compensationNext` is null outside `compensating`/`rolled_back`, starts at `c - 1`, and decrements only
after the exact reverse transition verifies. During that reverse frontier, the only extra microstate
is the plan-owned postimage moved from final to `after/<i>` before an exact retained preimage is moved
back; recovery accepts only either side of each no-replace move. It reaches `-1` before
`rolled_back`. `verified` deliberately is not terminal-finalized: it preserves the exact evidence a
coordinator still needs. Finalization occurs only at the operation-specific point of no return below.

There are two publication reverse exceptions. First, after every source or destination ref, reflog,
index, `HEAD`, and config transition on the same side has been restored and reopened at its exact preimage, a
`create` whose role is `source_object`, `destination_index`, or `destination_pack` is never renamed or
unlinked: another Git writer may have made that object reachable without changing its inode or bytes.
Compensation reopens the exact journal-created final inode/postimage, atomically rewrites that
observation from `created` to `relinquished_created_object`, and advances the reverse cursor without a
filesystem mutation. The file becomes ownership-neutral reusable/abandoned Git storage.

Second, after those same source control preimages verify, a created
`source_git_directory_tree` follows the root-only protocol above. Compensation does not fingerprint
descendants, because either a new child between check and action or a writer retaining an open
descriptor would invalidate a recursive-delete proof. It binds only the still-published root
`dev`/`ino` and directory kind, records current owner/mode as
`GitRelinquishedDirectoryRootV1`, changes the outcome to `relinquished_created_git_tree`, and advances
without a rename or delete. `rolled_back` requires the exact object inode/postimage or tree-root
identity and classification; absent, replaced, or mismatched state is recovery-required. Every other
transition restores its preimage. Compensation and terminal compaction may remove only journal-owned
quarantine/evidence for either exception, never a published source object, destination pack/index, or
relinquished `.git` path.

The coordinator vocabulary below is normative. `F(slot)` is the one forward Foundation step for that
slot; where the point-of-no-return table requires compensation, its forward ref binds one separately
pre-staged inverse Foundation ref that is not a forward `steps` member. `M(x)` is the manifest
transition; `S` and `D(h)` are the source and destination Git-effect steps; `P` and `Q` are the
before-files and after-files launchd effects; `K(x)` is the redaction-key transition; `N(h)` is the
network push; and `R` is the bounded runner drain. Concatenation means exact array order. A
zero-transition effect remains a real, hash-bound participant where the table requires it, so optional
work never changes the grammar.

| Operation/closed variant | Exact `steps` array |
|---|---|
| `git_enable` | `M(preserve_before) · F(activation) · M(publish_after) · S · F(config) · M(finalize_tombstones)` |
| `git_reconcile` | same as `git_enable` |
| `git_disable` | `M(preserve_before) · F(activation) · M(publish_after) · F(config) · M(finalize_tombstones)` |
| `git_sync/no_changes` | `F(sync_record)` |
| `git_sync/new_network` | `S · N(h) · F(sync_record)` |
| `git_sync/existing_network` | `N(h) · F(sync_record)` |
| `git_sync/new_local` | `S · D(h) · F(sync_record)` |
| `git_sync/existing_local` | `D(h) · F(sync_record)` |
| `automation_enable` | `M(preserve_before) · F(plist_files) · F(activation) · M(publish_after) · Q · F(config) · M(finalize_tombstones)` |
| `automation_reconcile/files` | `P · M(preserve_before) · F(plist_files) · F(activation) · M(publish_after) · Q · F(config) · M(finalize_tombstones)` |
| `automation_reconcile/live_only` | `Q` |
| `automation_disable` | `P · M(preserve_before) · F(plist_files) · F(activation) · M(publish_after) · F(config) · M(finalize_tombstones)` |
| `uninstall/present_manifest` | `F(uninstall_marker) · P · R · F(uninstall_artifacts) · K(stage) · M(preserve_before) · M(commit_absence) · K(delete) · M(finalize_tombstones)` |
| `uninstall/absent_manifest/key_present` | `K(stage) · K(delete)` |

`uninstall/absent_manifest/key_absent` is deliberately not a coordinator row: after the bootstrap-
locked inventory proves that exact arm, the command returns clean before ID reservation, immutable
plan construction, or any `LifecycleCoordinatorStepV1`. This preserves the coordinator schema's
non-empty `steps` invariant.

The first durable point of no return is exact and operation-specific:

| Operation/closed variant | Point of no return | Required recovery after it |
|---|---|---|
| `git_enable`, `git_reconcile`, `git_disable` | successful terminal `F(config)` | finalize verified effects and manifest tombstones |
| `git_sync/no_changes` | successful terminal `F(sync_record)` | terminal compaction only |
| `git_sync/new_network`, `git_sync/new_local` | `S` reaches fully `verified` | finalize `S`; retry/finish the exact bound destination, then sync record |
| `git_sync/existing_network` | `N(h)` returns success | write the exact sync record |
| `git_sync/existing_local` | `D(h)` reaches fully `verified` | finalize `D`; write the exact sync record |
| `automation_enable`, `automation_reconcile/files`, `automation_disable` | successful terminal `F(config)` | finalize verified launchd effects and manifest tombstones |
| `automation_reconcile/live_only` | `Q` reaches fully `verified` | finalize `Q`, then terminal compaction |
| `uninstall/present_manifest` | durable `M(commit_absence)` | finalize prior effects, delete the staged key, and finalize tombstones |
| `uninstall/absent_manifest/key_present` | validated manifest absence and guarded key presence at entry, before `K(stage)` | force-forward key stage/delete, then terminal compaction |

Before that boundary, a coordinator failure may compensate; at or after it, it may only force-forward.
For an effect that is itself the boundary, the journal's durable `verified` state is the force-forward
selection even while the coordinator cursor still points at that step; recovery must finalize it and
record the coordinator crossing before the step cursor advances. At
every other boundary, all earlier `verified` Git/launchd effects finalize in their forward step order
as part of crossing the boundary. A death anywhere in that short sequence is recognized from the
same coordinator cursor plus the participant phases and resumes forward; it cannot select rollback
after one participant finalized. Likewise, a current boundary `F(config)` journal already
`finalized` is the durable crossing even before the coordinator cursor rewrite.

The variant is not a stored free string: strict validation derives it from the operation, manifest
arm, `GitSyncPlanV1.commit`, destination transport, last successful pushed OID, and exact transition
sets. For absent-manifest uninstall, an absent guarded key returns before this derivation; only a
present guarded key derives `key_present`, its non-null redaction-key participant, and exactly the two
`K` steps. `new_*` requires a non-null source effect and a new candidate commit; `existing_*` requires a
null source effect and the already-published exact bound commit; `no_changes` requires null push and
both Git effects null. Network variants require `N(h)` and a null destination effect. Local variants
require `D(h)`, whose `side` is `destination`, and no `N`; its destination plan plus either staged
closure or exact already-present target-ref evidence is durable before the source effect starts. The
exact up-to-date variant binds that latter evidence and zero transitions instead of staged pack/index
bytes. Planning has already pushed the candidate commit through the
closed local helper into `SanitizedBareDestinationShadowV1`, parsed the resulting pack/index/ref
closure and staged every destination postimage before coordinator intent when a ref-update command
ran, or proved the no-command target ref already equals `commitOid`; it has not touched either real Git directory.
`D(h)` only revalidates the recorded destination preimage and promotes that closed staged set, or
verifies/finalizes the zero-transition up-to-date effect. The destination effect is therefore the user-visible local push commit step, not a second
use of the source participant or a post-intent plan-construction surface. Every sync push arm carries the one digest `h` equal to its
persisted push plan. Automation `P` contains every required unload and `Q` every required load in
canonical job order; the corresponding position-tagged effect is still present with zero transitions
when the table requires it. The `automation_reconcile` variant is derived rather than chosen:
`live_only` requires byte-identical config, activation, manifest, and plist postimages, every entry is
`keep`, `beforeFilesEffect` and every Foundation/manifest participant are null, and the one `Q`
participant contains exactly the unloaded expected generations in canonical job order. It remains a
real participant with zero transitions when every expected generation is already loaded. Any file,
configuration, activation, or manifest transition derives `files`; that variant requires at least one
plist-file mutation and retains the complete publication grammar above. A loaded wrong generation in
the closed evidence-derived candidate set is
a third state and cannot be converted into `live_only`. `uninstall/present_manifest` uses `P` for the complete installed-label
unload set and `R` for §6's release/drain/reacquire observation. `absent_manifest` has no artifact,
manifest, or launchd participant only after §6's exact key-only/no-install-evidence admission proof;
missing or drifted automation evidence cannot select this variant.

Participant cardinality is a bijection with that table. Each `F(slot)` has one distinct matching
`role.kind: "forward"` reference. A forward `F` strictly before its variant's point of no return has
one distinct `compensationId`; the named ref has the same slot, `role.kind: "compensation"`, points
back through `forwardId`, and contains the exact inverse ordered mutations. A forward at or after the
point of no return has null `compensationId`, and no other Foundation reference exists. Every non-null source/destination/launchd arm has
exactly one matching step and every such step has the same ID/hash/side or position; a manifest arm
exists exactly when an `M` appears and exposes exactly the listed manifest transitions; a redaction-key
arm exists exactly when `K` appears; and `push` is non-null exactly for `N(h)` or `D(h)`. No participant
or step may be duplicated or unused. The full `launchd` plan is non-null exactly for the three
automation operations and the present-manifest uninstall variant, and its coordinator/file/manifest/effect bindings recompute as
specified in §5.3. Authority plist paths are unique/sorted by unsigned UTF-8 bytes;
Foundation references are unique/sorted by ID, while forward and compensation execution order lives
only in `steps` plus the reverse-prefix rule.

`pushPlanHash` is a total invariant, not only a `push_pending` field. It is null in every phase exactly
when `plan.push` is null: all non-`git_sync` operations, `git_sync/no_changes`, and any sync plan with
no push. Otherwise it equals the one domain-separated digest of the embedded
`PersistedGitPushPlanV1` from initial `planned` through `finalized`, `rolled_back`, or `compacting`; it
is never cleared or replaced. `push_pending` additionally requires that hash to equal the unique
`N(h)`/`D(h)` at the current cursor. A schema-valid unrelated digest, a null hash for a push arm, or a
non-null hash for a no-push arm makes the ledger invalid.

Coordinator identity and cursors are equally closed. The plan `id`, journal `id`, filename stem, and
every participant's `coordinatorId` are identical; each effect plan `id`, journal `id`, filename stem,
and participant reference are identical. `nextStep` is exactly the verified forward-prefix length.
`compactionNext` and `terminalOutcome` are null outside `compacting`; both are non-null in
`compacting`, and `terminalOutcome` is the immediately preceding terminal coordinator phase.
`compensationNext` is null outside
`compensating`/`rolled_back`. Outside terminal/compensating/compacting states, `phase` is `planned` only at cursor zero before the first step;
otherwise it is derived from the step at the cursor: manifest→`manifest_publishing`, source/destination/
launchd/network→`external_applying`, config-slot Foundation→`config_publishing`, and every other
Foundation/redaction/drain step→`participants_applying`. A failed or interrupted `N(h)`, or a `D(h)`
that has not created a non-terminal effect journal, may atomically set `push_pending` only with null
compensation, the cursor still pointing at that exact step, `pushPlanHash == h`, and every reversible
prefix participant committed according to the point-of-no-return table. A process death after a destination journal starts remains ordinary
effect recovery, never `retry_only`.

Immediately before the first step, the coordinator durably rewrites `planned` to that step's derived
phase without advancing the cursor; a death on either side is resumable. Every later successful step
atomically records its required participant state, advances `nextStep`, and stores the next step's
derived phase in one journal replacement. A consumed Foundation forward is `finalized`; a consumed
Git/launchd effect is `verified` until the point of no return and `finalized` at or after it. The
terminal advance stores `finalized`. No state exposes an advanced cursor with the prior step's phase.

`finalized` is legal iff `nextStep == steps.length`, both auxiliary cursors are null, every consumed
Foundation forward is terminal-finalized, every unused compensation ref is still absent, every
Git/launchd effect is terminal-finalized, the manifest postimage/finalized tombstones and redaction
outcome verify, and all force-forward suffix steps are verified. `rolled_back` is legal iff
`compensationNext == -1`, `compactionNext` is null, no forward cursor can resume, each Foundation
forward that finalized before the failure has its exact paired compensation transaction finalized,
the current non-finalized Foundation transaction (if any) is terminal-rolled-back, each consumed
  Git/launchd effect is terminal-rolled-back, every complete preimage verifies except exact
  `relinquished_created_object` postimages in the `source_object`, `destination_pack`, or
  `destination_index` roles and an exact source `relinquished_created_git_tree` root. Each exception is
  legal only after that effect's controlling ref/index/config/remote preimage has been restored and
  verified as required by its reverse order; every future
participant remains absent. `compensating` starts at `nextStep - 1`, but first resolves any journal at
the current unadvanced step. A non-finalized Foundation/effect journal must itself roll back, while an
apply-before-journal effect must first finish observation as specified above. If the exact current
pre-point-of-no-return Foundation journal is already `finalized`, recovery recognizes it as a
completed current step, durably advances `nextStep`, initializes the reverse frontier to include that
step, and consumes its paired inverse first; it never omits a mutation because the coordinator rewrite
lost the race. An already-finalized current boundary `F(config)` is instead the existing durable
force-forward crossing, and a current step after any crossed boundary also resumes only forward.
Recovery then consumes the exact reverse prefix. All other phase/cursor/participant combinations are
schema-valid JSON but an invalid lifecycle ledger.

Each Foundation reference's mutations must match the exact ordered journal plan, preimages, and
staged blob hashes/paths. Create requires null before/non-null content+stage, remove non-null
before/null content+stage, and replace all non-null. Mutation `stagedPath` is derived exactly as
`<product home>/staging/transactions/<participant-id>/<index>.bin`; its adjacent
`<index>.bin.sha256` contains lowercase SHA-256 plus one LF exactly as the unchanged executor expects.
For every paired compensation ref, mutations are the reverse of the forward array: forward create
becomes remove guarded by the forward content hash; forward remove becomes create of the exact
preimage bytes/hash staged under the compensation ID; and forward replace becomes replace guarded by
the forward content hash with that exact preimage staged as its content. Those preimage bytes are read
through guarded bounded descriptors and staged before coordinator intent, not recovered from a
forward transaction after it finalizes. Thus the unchanged Foundation executor may finalize and prune
the forward transaction without destroying coordinator rollback authority. The pair IDs, reciprocal
role fields, target paths, hashes, inverse operations, reverse order, and staged identities must all
recompute exactly or the plan refuses.

The initial planned-journal bytes are separately staged at
`<product home>/staging/lifecycle/<coordinator-id>/foundation/<participant-id>/journal.json` before
coordinator plan publication; the ref records that file's reopened 0600 identity and hash. Its final
path must be `<product home>/state/transactions/<participant-id>.json`, and the exact
`FoundationJournalJsonV1` planned bytes must hash to `plannedBytesHash`, fit the ref's exact
`maximumJournalBytes`, and be no larger than 1 MiB. Every later allocated Foundation journal rewrite
uses the same implemented encoding with its new phase/timestamp values and enforces those same two
bounds before rename; legacy journals remain readable by the compatibility rule above. `planHash` is SHA-256 over
`developer-os:foundation-participant-plan:v1\0` plus canonical JSON of
`{ slot, role, mutations, maximumJournalBytes, initialJournal }`. Every staged byte and directory is synced before coordinator
plan publication. A forward transaction may perform Foundation's existing terminal backup-payload
prune because its inverse participant already owns independent staged preimage bytes. No lifecycle
participant journal, metadata, staged bytes, or lock is otherwise removed until terminal compaction.

Coordinator plans hash `developer-os:lifecycle-coordinator-plan:v1\0`; source and destination Git
plans independently hash `developer-os:git-effect-plan:v1\0`; launchd plans hash
`developer-os:launchd-effect-plan:v1\0`; each prefix is followed by exact `CanonicalJsonV1` bytes.
A journal's operation, IDs, and plan hashes must agree in both directions. An unreferenced effect
journal is malformed. Once the cursor advances past a forward Foundation step, its journal is
required and `finalized`; its compensation journal is absent until reverse execution reaches that
step. Once the cursor advances past an effect step, its journal is required and `verified` before the
point of no return or `finalized` after it. At the current cursor, the exact participant may be absent
before first intent, in any phase allowed by its own state table, or terminal-rolled-back while the
coordinator is entering compensation. A future participant must have no final journal, while its
hash-matching immutable plan/staging already exists. A journal missing its plan, a missing consumed
participant, an unpaired compensation journal, or a participant journal earlier than its current or
consumed position is malformed.

ID allocation is a separate bounded state transition performed before any plan/staging publication.
Every command that can create a generic Foundation or DOS-P7 lifecycle ID takes the global mutation
lock, except that exact `uninstall/absent_manifest/key_present` holds its identity-rechecked bootstrap
lock instead. It guarded-opens exact `state/lifecycle-install-nonce` and
`state/lifecycle-id-allocator.json`, requires the nonce content/hash/schema agreement from §2.1, and
reserves one contiguous counter block for the complete operation. A standalone Foundation transaction
reserves one `tx` ID. A composite reserves, in order, its `lc` ID, forward Foundation refs in step
order with each paired compensation immediately after its forward, then source Git, destination Git,
before-files launchd, and after-files launchd IDs when present. Prefix selection changes only the ID
text; one shared counter makes every namespace globally non-reusing within the installation epoch.
Foundation plans now admit 1..256 mutations, so the reservation and companion bounds have a finite
worst case.

Reservation writes canonical `LifecycleIdAllocatorV1` with unchanged `installNonce` and
`nextCounter = old + blockSize` to exact owner-only
`state/.lifecycle-id-allocator.<lowercase-v4-uuid>.json.tmp`, syncs it, rechecks the guarded old
allocator identity, atomically replaces the final file, syncs `state`, and only then exposes the
reserved IDs. Counter parsing/addition uses checked unsigned 64-bit integer arithmetic rather than a
JavaScript `number`; addition overflow or `nextCounter == 2^64-1` refuses before mutation. A crash before
rename leaves the old counter authoritative and may leave exactly one write-in-progress temp. It is
guarded-cleanable only when the final allocator is a valid canonical old-authority record whose
counter is consistent with every surviving allocated ID, has nonce agreement and the required
`ownerUid`/mode/link identity, and retains the same reopened device/inode/hash identity throughout
recovery; the state directory identity is
unchanged, and the temp has the exact name grammar, is an owner-owned 0600 single-link regular file,
and is 0..1024 bytes. Its bytes may be empty, a partial write, or the complete intended canonical
postimage because no ID was exposed before rename; recovery guarded-unlinks only that reopened temp
inode, syncs `state`, and rechecks the old final identity. A crash after rename consumes the whole block
and may leave an unused gap, but retry allocates a new block; the only post-rename state is the new
canonical allocator and no temp. More than one temp, wrong name/type/owner/mode/link/size, nonce
disagreement, changed final/directory identity, a counter decrease, or any final/temp identity third
state is recovery-required and preserved. Uninstall does not include either file in
`F(uninstall_artifacts)`: it retains them as coordinator control evidence through committed manifest
absence and every participant/staging compaction. The uninstall-specific `coordinator_envelope` rule
below removes allocator then nonce only after no future allocation is possible and before removing the
coordinator envelope. All coordinator/compensation IDs were already reserved, so that suffix allocates
nothing. Consequently collection may erase every per-ID leaf without losing no-reuse evidence while
the installation can still allocate work.

The guarded Foundation planless-orphan grammar covers the routine pre-journal residue shipped before
DOS-P7 and the same bounded pre-journal failure after it. Under the global lock and exact stable ID
lock, the final journal must be absent before and after enumeration, no coordinator may reference the
ID, and the 0700 backup ID directory must be empty. A 0700 staging ID directory may contain mutation
indices in `0..255` for an allocated ID, or `LegacyFoundationMutationIndexV1` for a legacy UUID ID,
with numeric gaps:
`remove` mutations stage nothing. For every observed index lower than the greatest observed index,
the only legal state is the complete owner-owned 0600 single-link pair `<i>.bin` plus
`<i>.bin.sha256`, whose digest is exactly 64 lowercase hex bytes plus LF and matches the content. The
greatest observed index may be that same complete pair or exactly one of the three write-in-progress
states emitted by unchanged `writeStaged`: `<i>.bin.tmp` alone; `<i>.bin` alone; or `<i>.bin` plus
`<i>.bin.sha256.tmp`. Allocated DOS-P7 content final/temp leaves are 0..16 MiB; every
`FoundationMutationRefV1` create/replace binds their exact size/hash, remove binds both null, and
planning refuses an oversized payload before ID reservation or staging. A legacy UUID ID retains
the shipped executor's 0..2^53-1 file-size range and is hashed by bounded-memory streaming rather than
materialized; allocated payload verification is streamed too. The digest temp is 0..65 bytes, and every temp/final leaf is owner-owned, 0600, regular,
single-link, and reopened by identity. No earlier index may be
partial, no index may contain both a final and its own `.tmp`, and there is at most one partial highest
index. Enumeration streams only observed directory entries and never loops across numeric gaps;
`4294967295`, a sign, leading zero, non-decimal byte, duplicate canonical value, or any filename not
derived from the accepted index is an unknown child and is preserved.

After all staging, unchanged `TransactionStore.write` may additionally leave one exact
`.<id>.<lowercase-v4-uuid>.json.tmp`. Its 0..1-MiB bytes must satisfy
`FoundationJournalJsonPrefixV1`: they are a byte prefix (possibly empty) of at least one valid
`FoundationJournalJsonV1` `planned` record for the same ID whose non-remove mutation indices equal the
complete staging pairs; a complete value must parse and validate as that journal. When this temp is
present, all observed staging indices are complete. No target mutation can precede final journal
publication. Recovery guarded-unlinks only these exact reopened staging/store-temp leaves, removes the
proved-empty staging/backup directories, then unlinks the exact held lock inode. A malformed pair or
prefix, partial non-highest index, second partial/temp, out-of-range index, unknown child, identity
change, backup member, or journal appearance is preserved. Thus a normal historical plan refusal
cannot poison lifecycle closure, while missing evidence after a possible target mutation is never
guessed clean.

`LifecycleJournalClosureV1` first validates the immutable nonce, allocator, allocator-temp state, all
four journal roots, and all three companion inventories before interpreting participants. A read-only
caller reports the one guarded-cleanable pre-rename allocator temp as recovery-required without
deleting it; a mutator under the global lock may perform §2.4's exact cleanup and recompute closure.
The only missing-control-file exception is the exact uninstall `compacting`, plan-plus-lock, or
plan-only envelope cursor after allocator or nonce deletion described below; it is non-clear recovery state and can allocate
nothing. A missing,
wrong-type, unowned, unreadable, over-limit, unknown-name, orphaned, non-canonical, hash-mismatched, or
schema-invalid leaf or required staged blob makes the result `lifecycle_recovery_required` globally, even when no participant
set can be parsed; cursor-valid future effect plans are not orphans. Among fully valid ledgers, any
non-terminal Foundation/effect/coordinator journal
also gives that result, with two typed exceptions. Exactly one coordinator may be `push_pending` when
every other journal is terminal and its embedded `PersistedGitPushPlanV1` passes §4.4 and hashes to the
journal-bound push-plan hash; that state returns
`retry_only { transactionId: coordinator.id, pushPlanHash }`. Or exactly one otherwise valid
`uninstall/present_manifest` coordinator may have reached `F(uninstall_artifacts)` and durably
verified absence of all four plan-bound lease paths while every other journal is terminal; that state
returns `uninstall_draining { transactionId: coordinator.id }`. The latter check reopens the exact
Foundation participant and coordinator cursor and requires their plan hashes, lease removals, and
manifest state to agree; a merely missing lease path cannot synthesize it. Zero non-terminal journals
returns `clear`; two candidates, mixed candidate classes, or any other non-terminal state never do.
This fail-closed enumeration is why a malformed envelope cannot disappear from closure merely because
its participant list was unavailable.

Terminal collection is exact. `FoundationTerminalCompactionV1` is derived from a validated terminal
Foundation journal that is not referenced by a non-terminal coordinator. Under the global mutation
lock and that transaction's stable lock, it enumerates only the journal-derived
`<staging>/transactions/<id>/<index>.bin[.sha256][.tmp]` and
`<backups>/transactions/<id>/<index>.bin[.tmp]`, `<index>.json[.sha256][.tmp]` names, guarded-unlinks
those exact regular files, and `rmdir`s only the now-empty exact ID directories. A missing expected
file is idempotent; an unknown name, directory, link, special file, wrong owner/mode, identity swap,
or non-empty directory refuses without recursive deletion. It then guarded-unlinks the terminal
journal and its stable lock by the exact opened inodes while the lock descriptor remains held, syncs
each parent, and releases the now-unlinked descriptor last. Allocated IDs are never reused because the
durable allocator advances before their first publication and compaction never rewinds it. A death before the
journal unlink resumes from that terminal journal; a death after it may leave only its lock, which is
a removable orphan exactly when both transaction directories and the journal are absent. Read-only
diagnostics racing a terminal unlink may fail and retry, but cannot mutate or cause a same-ID lock
split because every mutator holds the global lock and transaction IDs are unique.

A terminal lifecycle coordinator uses `LifecycleTerminalCompactionV1`. Its entries are derived in
this one order: every Foundation ref sorted by ID; non-null source Git, destination Git,
before-files launchd, and after-files launchd refs in that fixed order; `coordinator_staging`; then
`coordinator_envelope`. A verified `finalized` or `rolled_back` coordinator durably rewrites to
`compacting` with the prior phase in `terminalOutcome` and `compactionNext == 0`. The compactor takes
all still-present participant locks in unsigned UTF-8 path order before deletion. Each Foundation
entry requires exactly the terminal/absent state allowed by the coordinator outcome and applies the
Foundation cleanup above. For a never-executed absent ref, the immutable coordinator ref is the
cleanup index: only its exact standard staged blobs/digests and lifecycle-staged initial journal may
exist, its backup directory/final journal must be absent, and an optional never-used stable lock is
removed by exact inode. Each effect entry requires the exact terminal journal or future-absent state
allowed by the coordinator outcome, removes only its plan-derived tombstones/quarantine, then its
present journal, immutable plan, and stable lock. The staging
entry removes only the now-empty exact coordinator directory after its complete derived inventory is
absent. After each entry is absent it advances `compactionNext` durably; a death after deletion but
before that rewrite accepts only the same entry's exact absence and advances it on resume.

`coordinator_envelope` is last. With every other entry absent, a non-uninstall compactor guarded-
unlinks the coordinator journal first, then guarded-unlinks the exact held stable-lock inode while its
descriptor remains held, and guarded-unlinks the immutable plan last, syncing after each boundary and
releasing the now-unlinked lock descriptor only after the plan boundary. The immutable plan is the
durable recovery index: a death after journal unlink leaves plan plus the held/reopenable lock; a death
after lock unlink leaves plan only; a death after plan unlink leaves the envelope fully absent. A
lock-only coordinator envelope is never a legal crash state. Uninstall first guarded-unlinks the
schema-valid allocator and syncs `state`, then the manifest-hash-bound nonce and syncs again, and only
then follows the same journal/lock/plan order. The
only uninstall control-file microstates at this cursor are both present, allocator absent plus nonce
present, or both absent; nonce-absent plus allocator-present and every replacement identity are third
states. No suffix operation allocates an ID. A death after either control-file deletion resumes from
the still-present compacting journal, while a death after journal unlink leaves the exact
plan-plus-lock or plan-only uninstall envelope and the same allowed control-file absence. The guarded
orphan rule uses that exact plan plus proved absence of every preceding compaction entry to reconstruct
the `coordinator_envelope` cursor, completes only the bound suffix, removes lock before plan when both remain, and never removes or creates
control files for an unrelated plan-only orphan.
`compacting` is always
`lifecycle_recovery_required` until this finishes. Terminal coordinator/effect/Foundation journals,
plans, stable locks, standard Foundation staging/backups, and lifecycle staging therefore cannot
accumulate across successful scheduled runs. The global `.lifecycle.lock` is the sole stable lock
that is never unlinked.

Coordinator creation order is exact publication and sync of every Foundation executor mutation blob
and digest, coordinator initial-journal, Git effect postimage, and other coordinator staging leaf;
immutable participant/effect plans; coordinator
plan no-replace publication and sync; coordinator planned-journal publication and sync; then any
participant. A crash before the coordinator plan can leave only the derived unreferenced staging tree
and its exact future-participant Foundation executor staging directories plus unreferenced immutable
effect plans; recovery may remove them only when both coordinator plan and journal are absent and no
participant final journal exists. A crash between coordinator plan and journal can leave only a
valid immutable coordinator plan; explicit recovery, under the global lock, may guarded-unlink that
exact orphan only after proving no journal and no participant references its ID. A future effect plan
referenced at or after `nextStep` is retained for resume, not removed. Product code can never create a
journal-without-plan or an unreferenced effect journal because coordinator intent is durable first;
either state is preserved with exit 6. Atomic journal rewrites use the exact hidden temporary
grammar `.<id>.<lowercase-v4-uuid>.json.tmp`; plan publication uses exact
`.<id>.<lowercase-v4-uuid>.plan.json.tmp`. Such a temp is always non-clear. An ordinary rewrite temp
whose final journal exists is removable only while holding the matching stable lock, after final
identity/plan-hash and active-writer absence are checked. Its guarded size ceiling is the matching
plan/ref's exact `maximumJournalBytes` for a coordinator/participant/effect, or the exact recomputed
standalone Foundation maximum, and never exceeds the applicable 1-MiB/16-MiB parser ceiling; a larger
temp is a preserved third state.

Initial publication has one narrower guarded cleanup. Exactly one 0600 owner-owned single-link regular
temp of 0..1 MiB for a missing initial journal, or 0..16 MiB for a missing immutable plan, may be empty,
partial, or complete and may be unlinked by its reopened inode under the global plus stable ID locks
only in these states: a missing participant/effect plan requires both coordinator plan/journal and
that participant's final journal absent; a missing coordinator plan requires coordinator journal and
every participant final journal absent; a missing coordinator initial journal requires its valid
coordinator plan present, every participant final journal absent, every target/live state at the
plan's preimage, and every future plan/staging identity exact; and a missing effect initial journal at
the current cursor requires its immutable plan present and every named target/live state at the exact
preimage. The current effect temp may then be deleted and its initial journal recreated for forward
recovery, or pre-boundary compensation may delete it with the unstarted participant. A coordinator-
journal temp is deleted before the existing pre-journal coordinator-plan orphan cleanup aborts the
unstarted operation. Each cleanup syncs the parent and rechecks temp/directory/final-target identities.
More than one temp, a wrong name/type/owner/mode/link/size, any final appearing, any participant/live
transition begun, or any identity change is preserved as recovery-required. Thus incomplete bytes do
not need to parse in the only states where durable intent cannot yet have authorized their mutation;
post-intent rewrite temps retain the strict final/hash rule.

DOS-P7 Foundation participants have one narrower, resumable first-write rule. When a forward
`F(slot)` or its reverse-prefix compensation ref is reached, the coordinator takes the participant's stable Foundation lock and either re-verifies the
existing final journal or no-replace-renames the exact `initialJournal.stagedPath` identity to
`initialJournal.finalPath`, syncs the transaction directory, reopens it, and requires the same inode
and exact `FoundationJournalJsonV1` planned bytes before invoking the unchanged executor. A death after the rename but
before the coordinator cursor advances is therefore recognized by the pre-recorded staged inode and
resumes from `planned`; a byte-identical different inode is a third state. If execution has not
reached this future participant, coordinator rollback/terminal compaction may remove only the
still-staged exact journal inode and its exact standard Foundation staging blobs/digests after proving
the final journal absent and every mutation target still at its recorded preimage. Once
the step is reached, one of the exact staged or final identities must exist; neither missing, both
present, or any mismatch is exit 6. Thus no injected first-journal death creates the former permanent
“temp exists, final missing” dead end.

Foundation's ordinary `.<id>.<lowercase-v4-uuid>.json.tmp` rewrite grammar is unchanged. Closure may
remove one of those rewrite temps only under its stable lock when the strict matching final journal
exists. With no final journal it is normally preserved with exit 6, except for the separately named,
coordinator-bound `initialJournal.stagedPath` flow above; that flow completes the guarded no-replace
publication or removes it only before participant authority. The `TransactionJournalV1` schema and
the executor after its initial planned journal remain unchanged.

Each immutable effect plan captures preconditions and compensation evidence, stages into an
owner-only quarantine, validates before the first external mutation, durably journals intent, applies
one named transition, verifies it, journals the result, and only then advances. A stale precondition
refuses. A failure compensates verified reversible transitions in reverse order; failed compensation
or an interrupted journal is exit 6 and must be resumed or rolled back before another mutation.

Every lifecycle command that changes the manifest has a durable composite coordinator journal before
any participant applies. Its `ManifestStatePlanV1` records both `before` and `after` as a tagged state:
`present` carries the exact bytes and hash, while `absent` carries no invented bytes. It also records
the ordered Foundation transaction IDs and external-effect plan IDs. The coordinator has exact
operation-specific orders. A pure install/enable addition writes and verifies managed files, writes
the present manifest that names them, applies reversible external effects, then publishes enabled
config. A mixed automation reconcile first unloads and verifies disabled every label whose plist will
be replaced or removed; it then writes/verifies additions and replacements and removes old plists,
writes the exact present manifest, loads additions/replacements only after each matching plist verifies,
leaves removals unloaded, and finally publishes reconciled config. A pure disable/removal reverses the
live external effect first, updates/removes/restores managed files including the retained activation
record's inactive arm, writes the reduced present manifest, then
publishes disabled config. Terminal uninstall follows §6: marker/unload, drain, owned-artifact removal,
absent manifest, force-forward secret-key deletion, finalize. A Git enable has a manifest participant
when it first creates or later re-hashes `LifecycleActivationRecordV1`; spec 2's Git runtime
reservations require no separate ownership change. The activation-record/manifest postimage verifies
before its Git effect, and config-enabled publication remains last, so every partial state is inert.

`ManifestStore` keeps its direct-write boundary but gains guarded no-overwrite coordinator operations.
`ManifestStatePlanV1` also records exact journal-owned sibling tombstone paths and, for a present
preimage, its guarded `{ hash, dev, ino }`. A present preimage is never overwritten or unlinked in
place: after durable intent, the coordinator requires the before-tombstone absent, atomically moves the
current manifest to it with no replacement, syncs the parent, and verifies the preserved inode/bytes.
If the moved file is not the planned preimage, recovery preserves it and no-replace moves it back only
when the original leaf is still absent; any competing original/third state is preserved with exit 6.

For a `present` postimage, only after the old inode is preserved does the coordinator atomically
no-replace-publish the exact staged next bytes at the original leaf, sync, and verify them. For an
`absent` postimage it verifies the original leaf absent and durably records the committed-absence phase
while retaining the exact before-tombstone. An absent-to-present transition requires both original and
tombstone absent before no-replace publication. Rollback first no-replace-moves an exact plan-owned
postimage to its recorded after-tombstone (or observes the original absent), restores a present prior
inode by no-replace rename or preserves prior absence, and deletes only an exact plan-owned
after-tombstone after restoration verifies. It never overwrites or unlinks a third state. Finalize
deletes the exact before-tombstone only after the postimage and every participant are terminal; the
coordinator retains its journal, staged bytes, and backups until then, and product-directory cleanup
is later.

`RedactionKeyStatePlanV1` is the coordinator's separate, secret-opaque participant for the one
architecture-approved non-manifest key path. `sourcePath` is exactly
`<product home>/state/redaction.key`; `tombstonePath` is exactly the sibling
`<product home>/state/.redaction.key.<coordinator-id>.tombstone`. Both paths must have the same guarded
parent device. The present arm is exactly one owner-owned 0600, single-link regular file from 32 bytes
through 1 MiB. Planning and recovery use `O_NOFOLLOW | O_NONBLOCK`, post-open type/owner/mode/size/
link/device/inode checks, and never read file content. The plan hashes
`developer-os:redaction-key-state-plan:v1\0` plus its exact `CanonicalJsonV1` bytes; it has no bytes or
content-hash field and cannot target any second path.

`K(stage)` and `K(delete)` are bound exhaustively to coordinator position. Before `K(stage)`, source
equals `before` and the tombstone is absent. For a present arm, the only apply-before-cursor state is
source absent with that exact recorded inode at the tombstone after a no-replace rename and parent
sync; for an absent arm both paths stay absent. In the present-manifest variant, from completed
`K(stage)` until `M(commit_absence)`, that staged state is reversible only by an exact no-replace
rename back to an absent source. At and after committed manifest absence it is force-forward only.
The absent-manifest variant is already force-forward at entry and never restores the key. At `K(delete)`, the
only two legal present-arm states are the exact tombstone or its unlink-before-cursor absence, always
with source absent; completion requires both paths absent. A pre-existing tombstone, extra link,
wrong kind/owner/mode/size/device/inode, both paths present, or any third state is
`lifecycle_recovery_required` and is preserved.

Recovery compares the actual manifest against both tagged states and uses the reverse of the exact
coordinator-specific forward order, not one universal compensation list:

- pure install/enable-addition rollback occurs before config publication: it unloads newly loaded
  labels or compensates other live additions, restores the prior manifest, then runs the paired inverse
  Foundation transactions for newly written managed files; there are no prior plist bytes in this order;
- mixed automation reconcile rollback occurs before config publication: it unloads any newly loaded
  addition or replacement, restores the prior manifest, runs the paired inverse Foundation
  transactions for every prior plist/file byte, verifies each prior plist, and only then reloads labels
  that the reconcile had replaced or removed;
- disable/removal rollback leaves prior config unchanged, restores the prior manifest, runs the paired
  inverse Foundation transactions for the activation record/plists, and only then reloads prior labels
  or other live effects;
- Git enable/reconcile leaves prior config unchanged, compensates its still-`verified` Git effect,
  restores the prior manifest, then runs the paired inverse activation-record transaction; and
- uninstall rollback before manifest absence follows the literal reverse prefix: it first restores a
  staged redaction key by secret-opaque rename, then runs the paired inverse artifact transaction,
  reloads labels only after their restored plists verify, and finally runs the paired inverse
  uninstall-marker transaction.

Every launchd load/reload transition, forward or compensating, re-resolves the exact plist path and
requires its guarded regular-file bytes to equal the plan-bound hash immediately before bootstrap. An
unload must verify the label disabled before the corresponding plist is replaced or removed. Thus no
failure boundary in addition, replacement, mixed reconciliation, removal, or uninstall can leave a
Developer OS label loaded against an absent, stale, or unverified plist.

Before a present publication or committed-absence record, recovery takes the applicable prefix of that sequence and
retains/restores the `before` state. After the exact postimage transition, it either completes the
remaining verified plan or runs the full applicable rollback. For uninstall, manifest absence is the
point of no return only after the coordinator durably records committed absence with the exact prior
inode preserved in its tombstone. Recovery then recognizes the planned absent state
and force-forwards the secret-key tombstone deletion and remaining cleanup rather than inventing a
missing-manifest error or restoring the key. Any third bytes/type/state, failed rename/write, or failed
restore is exit 6; even after committed absence, a newly appeared third manifest is preserved and never
interpreted as the planned postimage or permission to delete it. The coordinator owns every exact manifest temporary name it records and recovery
removes only an unrenamed, fingerprint-matching temporary/tombstone file. Failure/death tests cover every boundary,
including immediately after a reduced-manifest rename and before/after every plist restoration; the
invariant is that no label is ever loaded without its exact verified plist.

An HTTPS/SSH Git push is the only non-compensatable transition and is always the final state-changing
external effect; only idempotent journal and success-record publication may follow it. Local/file
receive-pack changes only a private destination shadow, and its later real-destination promotion is a
separate destination-side `GitEffectPlanV1`; the already-finalized source effect is not reused. A
failed network push or local promotion deliberately keeps the verified source commit. If a successful network push dies before its step cursor advances,
recovery idempotently retries only that persisted commit; if the cursor advanced durably, recovery
records success without another network call. A rejected retry or remote advance never invents
success and leaves the journal for explicit resolution. A completed destination effect whose
observation and cursor are durable likewise re-verifies the journaled real ref/objects and records that
same commit without opening receive-pack or promoting again. Before its journal exists, local
`push_pending` reopens only the immutable destination plan and its bound staged closure or exact
already-present target ref from the persisted push
plan; after its journal exists, normal effect recovery resumes its exact cursor and never synthesizes a
replacement plan.
Launchd compensation restores the previous loaded/unloaded state and prior plist/config/manifest
state. Tests inject failure and process death immediately before and after every participant
transition, manifest rename, external effect, success-record write, and compensation.

## 3. Command surface

| Command | Default behavior | `--apply` or execution effect | Network |
|---|---|---|---|
| `config get [key]` | read validated config | not applicable | none |
| `config set <key> <value>` | transactional write | not applicable | none |
| `git enable --remote <url> [--branch <name>]` | print `LifecyclePlanPreviewV1` / `GitPlanPreviewV1` | revalidate preview, allocate an execution envelope, initialize/adopt, and persist config | none |
| `git disable` | print `LifecyclePlanPreviewV1` / `GitPlanPreviewV1` | revalidate preview, allocate an execution envelope, publish inactive provenance, then clear the enable flag; preserve repository state | none |
| `git status` | report configuration, drift, branch, and last successful sync | not applicable | none |
| `git sync` | validate, stage scoped content, commit if needed, push if needed | not applicable | configured remote only |
| `automation enable {--schedule <job>=<schedule>}` (one flag per required job) | print `LifecyclePlanPreviewV1` / `LaunchdPlanPreviewV1` | revalidate preview, allocate an execution envelope, and reconcile all eligible jobs | none |
| `automation disable` | print the removal `LifecyclePlanPreviewV1` / `LaunchdPlanPreviewV1` | revalidate preview, allocate an execution envelope, and remove installed plists | none |
| `automation status` | report eligible, installed, stale, and last-run state | not applicable | none |

For the four plan/apply commands, default execution prints only the byte-inert
`LifecyclePlanPreviewV1`. `--apply` recomputes and rechecks that preview under the global lock before
its first allocation, then persists the separately allocated `LifecycleExecutionPlanV1`. If the
repository, configuration, manifest, executable, installed plist, or any other preview input changed,
apply refuses and asks the user to plan again. Allocation may fill only the execution-only fields
listed in §2.4; it never silently recalculates a different user-visible operation.

## 4. Git lifecycle

### 4.1 Enable plan, repository, branch, and remote

`GitEnablePlan` is the CLI display name for the `GitPlanPreviewV1` member of
`LifecyclePlanPreviewV1`. It records:

- repository mode: `initialize` or `adopt`;
- the canonical repository root;
- the branch to record;
- fixed remote name `developer-os`, declared and effective validated push URLs, and action `add` or
  `reuse`;
- `GitScopeSnapshotV1`: canonical `brainPath`, `contentRoot`, ordered `topicFolders`, normalized
  `topicAliases`, `indexesDir`, and their fingerprint;
- the exact `LifecycleActivationRecordV1` before/after bytes and every configuration and manifest
  mutation; and
- precondition fingerprints needed to reject a stale plan.

`GitDisablePlan` is the corresponding display projection and contains the exact config,
activation-record, and manifest before/after hashes, `LifecycleJournalClosureV1` precondition, and no
Git mutation. Running `git disable` prints only the allocation-free preview. `git disable --apply`
revalidates its hash, allocates the exact execution envelope, publishes the inactive Git arm and
matching manifest hash, then clears `git.enabled`; repository config, objects, index, refs, `HEAD`,
remote, history, and `SyncRecordV1` are absent from its authority.

Enable and reconcile derive every tracked root before accepting that snapshot: `contentRoot`,
`indexesDir`, and each topic folder pass guarded planned-path canonicalization, which resolves every
existing ancestor while preserving a missing leaf. Every declared and canonical result must remain a
descendant of the canonical repository root, and an existing symlink may not escape it. Failure is the
dedicated `scope_outside_repository` status/refusal and occurs before config, manifest, `.git`, or
network effects. This makes explicit the Brain contract that scope is vault-relative and symlink
escapes are refused; it does not introduce a second repository model.

During `git enable`, an existing repository with omitted `--branch` adopts the currently attached branch. An explicit
branch must equal the currently attached branch because the product does not switch branches. In a
new repository, omitted `--branch` means `main`; an explicit branch becomes the initial branch.
Apply records that resolved branch in `GitSyncConfigV1`. Later syncs require `HEAD` to be attached to
that same branch. Enable has already published the minimal `.git`, so a later first sync of an unborn
repository is an existing-repository sync with an absent branch ref; there is no second
`source_git_directory_tree` arm. Adoption is explicit ownership of synchronization for the selected
branch, not a claim that Developer OS created it.

Version 1 adopts only a non-bare repository whose `.git` is a guarded directory directly under the
vault root. Gitfiles, linked worktrees, submodule-shaped roots, object alternates, and a repository
whose canonical Git directory escapes the vault refuse. Planning disables replacement objects and
optional locks; missing objects refuse rather than triggering a partial-clone fetch.

Repository and index compatibility are a closed version 1 allowlist, checked before enable and again
before every index/ref transition. A repository must use format version 0, SHA-1 objects, file-backed
refs, no repository extensions, alternates, shallow/graft/replacement state, promisor/partial-clone
configuration, worktree config, or sparse checkout. An absent index is legal only for an unborn empty
repository. Otherwise the index must be `DIRC` version 2, contain only stage-zero entries, set neither
assume-valid nor any extended entry flag, contain no sparse-directory entry, and contain no extension
other than one structurally valid `TREE` cache. Split index (`link`) and every other optional extension
refuse; version 1 does not silently flatten or discard them.

The candidate index begins as an exact byte snapshot of the supported real index, changes only the
enumerated managed entries, and regenerates its optional `TREE` cache. The effect journal retains the
exact original bytes for compensation. Before swapping, the parser revalidates the candidate against
the same allowlist, verifies every unrelated entry is byte-for-byte equivalent, and verifies its tree
equals the candidate commit. Tests cover the absent and plain-v2 forms, the `TREE` form, every refused
entry flag/stage, sparse and split indexes, malformed/unknown extensions, and byte-exact compensation.

The remote name is not configurable. If `developer-os` is absent, apply adds it. If it exists with
the same normalized URL, apply reuses it. A different URL refuses; the product never overwrites a
remote. `git disable --apply` publishes the Git activation arm as inactive with the corresponding
manifest hash, then clears only the enable flag; it preserves `GitSyncConfigV1`, the repository,
remote, branch, last sync record, and history. Re-enable through `--apply` reuses the recorded identity
and publishes a newly matching active arm; supplied
values that disagree with it refuse rather than silently retargeting synchronization.

If any in-repository scope field (`contentRoot`, `topicFolders`, `topicAliases`, or `indexesDir`)
changes, `git status` reports `scope_reconcile_required` and `git sync` refuses. Re-running `git
enable` with the same repository, remote, and branch produces a reconcile-mode plan. It compares the
last successfully managed path inventory with the newly enumerated scope and displays every path that
will leave the next Git tree. `--apply` stores only the new exhaustive `GitScopeSnapshotV1`; the next
sync deterministically re-derives retirements as the last successful managed inventory minus the
current enumerated scope and requires them to equal the planned reconcile set. It removes those entries
from Git without deleting the local files. No untyped pending field exists. History is not
rewritten. Reconcile refuses while an unpushed local Developer OS commit is pending, or when an
established successful baseline exists and local `HEAD` differs from its pushed commit, because
silently discarding or pushing that old-scope history would choose for the user. Before the first
successful sync there is no managed inventory to retire, so a scope-only replan remains legal.

Enable performs no fetch, push, credential lookup, or other network operation. The plan states that
the first sync of an adopted branch may push history that already exists on that branch, and that
later syncs also push manual commits made on the recorded branch.

Apply prepares the exact config/activation-record/manifest postimages and every participant, then
durably writes the composite coordinator before mutation. The V2 migration already reserves Git
runtime records, while first activation creates the content-owned activation record and every later
enable/reconcile updates its manifest hash; those manifest diffs follow §2.4's coordinator ordering.
`GitEffectPlanV1` initializes `.git` only when absent or adds only the absent fixed remote and verifies
repository/branch/remote state only after the activation record and manifest hash verify; the final
config transaction publishes Git as enabled. On failure, compensation restores the exact added-remote
or other controlling config/ref/index preimage through the journal's no-replace operations. A newly
published `.git` is reopened only at its root `dev`/`ino` identity and becomes
`relinquished_created_git_tree`; compensation never renames it, walks it, fingerprints descendants
again, or deletes it recursively. Published source objects and destination pack/index files follow
the corresponding ownership-neutral relinquishment rule in §2.4. Adopted repository state that
predated the plan is never restored from a guess. Unsafe compensation is exit 6. After successful
finalize, disable and uninstall preserve all repository state.

### 4.2 Closed transport, effective destination, and process boundary

The founder superseded the earlier denylist decision on 2026-08-25. Version 1 accepts only:

- an absolute local path or `file://` URL resolving to a guarded, non-overlapping bare repository;
- `https://`; and
- `ssh://` or Git's scp-like SSH form.

It rejects `http://`, `git://`, every `<transport>::<address>` remote-helper form, unknown or future
schemes, embedded passwords/tokens, control characters, line breaks, option-shaped leading input,
empty input, and any value the configured redactor would change. An SSH username is not a credential;
secret-bearing URL userinfo is. Adding a transport later requires a new reviewed policy rather than
falling through to `git-remote-*` execution.

That input rule has no user-visible exception. After a local/file path passes it and every real-path
gate, the in-process coordinator alone synthesizes `developer-os-local::<opaque-plan-token>` for one
Git invocation. The value is never stored as a remote, accepted from configuration/argv, or parsed as
filesystem authority; it selects only the fixed internal helper below. A fresh source-shadow config
projection binds that full synthetic URL as the sole `remote.developer-os.url`, contains no pushurl or
rewrite, and the command names remote `developer-os` rather than passing a URL operand. Git 2.50.1
therefore invokes the fixed helper with remote name `developer-os` and the stripped token as its only
URL argument; installed-Git argv fixtures pin that dispatch.

The transport parser is structural, not a shell-safety heuristic. HTTPS permits no userinfo, query,
or fragment. SSH user, host, port, and decoded repository path are separate bounded fields; the path
accepts only safe repository-path segments and no option prefix, traversal, tilde, control, or shell
metacharacter. Local remotes pass protected-path and canonical overlap checks. HTTPS redirects and
all proxy paths are disabled, so the validated host cannot become a second network destination.

The fixed remote must resolve to exactly one push destination. Planning reads and fingerprints the
declared URL, every `remote.developer-os.pushurl`, and every matching `url.*.pushInsteadOf` or
`insteadOf` rule; zero, multiple, policy-invalid, or an effective URL unequal to the normalized
declared URL refuses. Apply rechecks the fingerprint. Immediately before every push, sync resolves and
validates it again. HTTPS/SSH passes that single resolved URL directly under the sanitized configuration
below; local/file keeps the canonical real path only in the in-process coordinator and gives source Git
the opaque shadow token defined below. A local config rewrite cannot redirect either push after
validation.

No source-repository Git subprocess receives the user's real `.git` directory as `GIT_DIR` or loads
its local config. Every source-repository Git call receives a `SanitizedGitEnvironmentV1` and runs
against an owner-only `SanitizedGitShadowV1`. No Git subprocess receives a real source or local bare
destination Git directory.

Version text is not executable identity. The compiled exact-set distribution and process records use
these strict recursive schemas. Array emptiness, uniqueness, and order are field-specific as frozen
immediately below the schema; no blanket collection rule supplies missing authority:

```text
BoundedArgV1 = UTF-8 text of 1..4096 bytes with no NUL, C0/C1 control, or line break
BoundedArgFragmentV1 = UTF-8 text of 0..4096 bytes with no NUL, C0/C1 control, or line break
BoundedEnvironmentValueV1 = UTF-8 text of 0..8192 bytes with no NUL or line break
BoundedTextLineV1 = UTF-8 text of 1..1024 bytes with no NUL or line break
BoundedLinkTargetV1 = UTF-8 text of 1..4096 bytes with no NUL or line break

GitConfigQuotedPathV1 = CanonicalAbsolutePathV1 whose UTF-8 bytes contain no C0/C1 control or
line-break scalar; double quote and backslash are legal only because the one renderer below escapes
them byte-exactly

GitAlternateObjectDirectoryV1 = CanonicalAbsolutePathV1 whose UTF-8 bytes contain no literal
colon, double quote, backslash, C0/C1 control, or line break

ExecutableFileIdentityV1 = {
  canonicalPath: CanonicalAbsolutePathV1,
  ownerUid: 0,
  mode: Integer[0..4095],
  size: Integer[1..2^53-1],
  sha256: LowerHexSha256
}

SupportedGitExecutableV1 = {
  id: "git_main" | "git_remote_https" | "system_ssh",
  invokedPath: CanonicalAbsolutePathV1,
  linkChain: readonly { path: CanonicalAbsolutePathV1, target: BoundedLinkTargetV1 }[0..8],
  target: ExecutableFileIdentityV1,
  versionLines: readonly BoundedTextLineV1[0..32]
}

GitArgSlotV1 =
  "validated_https_url" | "opaque_local_token" | "private_destination_shadow" |
  "commit_to_branch_refspec" | "pack_object_count" | "receive_keep_marker" |
  "ssh_target" | "ssh_port" | "ssh_receive_pack_command" |
  "candidate_config_path" | "normalized_remote_url" | "source_shadow_path" |
  "candidate_tree_oid" | "parent_commit_oid"

GitArgTokenV1 =
  | { kind: "literal", value: BoundedArgV1 }
  | { kind: "slot", slot: GitArgSlotV1 }
  | { kind: "joined", prefix: BoundedArgFragmentV1, slot: GitArgSlotV1,
      suffix: BoundedArgFragmentV1 }

GitArgvGrammarV1 = { argv: readonly GitArgTokenV1[1..32] }

GitEnvironmentValueV1 =
  | { kind: "literal", value: BoundedEnvironmentValueV1 }
  | { kind: "slot", slot: "temporary_home" | "canonical_user_home" |
        "temporary_directory" | "gateway_path" | "supervisor_socket" |
        "invocation_capability" | "source_git_dir" | "source_index" |
        "source_object_dir" | "source_alternate" | "destination_git_dir" |
        "ssh_auth_sock" | "ssh_bridge_path" | "opaque_local_token" |
        "private_destination_shadow" | "git_author_name" | "git_author_email" |
        "git_author_date" | "git_committer_name" | "git_committer_email" |
        "git_committer_date" }

GitEnvironmentProfileV1 = {
  id: "distribution_probe" | "config_candidate" | "source_build" | "push_https" |
      "https_helper" | "push_ssh" |
      "ssh_bridge" | "system_ssh_no_agent" | "system_ssh_agent" |
      "push_local" | "local_helper" | "destination_receive",
  entries: readonly { name: ClosedGitEnvironmentNameV1,
    value: GitEnvironmentValueV1 }[1..48]
}

GitProcessNodeV1 = {
  id: ClosedGitProcessNodeIdV1,
  image:
    | { kind: "coordinator" }
    | { kind: "gateway", basename: ClosedGatewayBasenameV1 }
    | { kind: "distribution", executableId: SupportedGitExecutableV1.id,
        argv0: BoundedArgV1 }
    | { kind: "internal", mode: "ssh_bridge" | "local_remote_helper" },
  environmentProfiles: readonly GitEnvironmentProfileV1.id[0..3],
  cwd: "source_shadow" | "destination_shadow" | "quarantine"
}

GitProcessEdgeV1 = {
  id: ClosedGitProcessEdgeIdV1,
  from: GitProcessNodeV1.id,
  to: GitProcessNodeV1.id,
  transition: "spawn" | "exec_same_pid" | "enter_internal_same_pid",
  phase: "distribution_probe" | "config_candidate" | "source_build" | "push_pack" |
         "push_transport" | "destination_receive",
  when: "distribution_probe" | "config_candidate" | "new_commit" | "any_push" |
        "pack_required" | "https_push" | "ssh_push" | "local_push" |
        "local_pack_received",
  argvAlternatives: readonly GitArgvGrammarV1[1..8],
  ioProfileId: GitProcessIoProfileV1.id,
  minUses: Integer[0..200002],
  maxUses: Integer[1..200002],
  orderAfter: readonly ClosedGitProcessEdgeIdV1[0..8]
}

GitProcessIoProfileV1 = {
  id: "metadata" | "source_build" | "root_push" | "pack_stream" |
      "transport_stream" | "receive_stream" | "index_stream",
  stdinMaxBytes: Integer[0..2147483648],
  stdoutMaxBytes: Integer[0..2147483648],
  stderrMaxBytes: Integer[0..4194304],
  wallDeadlineMs: Integer[30000..600000],
  idleDeadlineMs: Integer[30000..120000]
}

GitProcessPhaseBudgetV1 = {
  id: "distribution_probe" | "config_candidate" | "source_build" | "push",
  wallDeadlineMs: 30000 | 600000 | 1800000
}

SupportedGitProcessTableV1 = {
  schemaVersion: 1,
  id: "apple-git-155-process-v1",
  distributionId: SupportedGitDistributionV1.id,
  environmentProfiles: readonly GitEnvironmentProfileV1[12],
  ioProfiles: readonly GitProcessIoProfileV1[7],
  phaseBudgets: readonly GitProcessPhaseBudgetV1[4],
  nodes: readonly GitProcessNodeV1[21],
  edges: readonly GitProcessEdgeV1[21]
}

ClosedGatewayBasenameV1 = "git" | "git-remote-https" |
  "git-remote-developer-os-local" | "git-receive-pack" |
  "developer-os-ssh-bridge"

ClosedGitProcessNodeIdV1 =
  "coordinator" | "distribution_probe_git" | "source_build_git" | "source_push_git" |
  "gateway_pack_git" | "real_pack_git" |
  "gateway_https_dispatch_git" | "real_https_dispatch_git" |
  "gateway_https_helper" | "real_https_helper" |
  "gateway_ssh_bridge" | "internal_ssh_bridge" | "real_system_ssh" |
  "gateway_local_dispatch_git" | "real_local_dispatch_git" |
  "gateway_local_helper" | "internal_local_helper" |
  "gateway_receive_pack" | "real_receive_pack" |
  "gateway_index_git" | "real_index_git"

ClosedGitProcessEdgeIdV1 =
  "direct_distribution_probe" | "direct_config_candidate" | "direct_source_build" |
  "direct_source_push" |
  "spawn_pack_gateway" | "exec_pack_git" |
  "spawn_https_dispatch_gateway" | "exec_https_dispatch_git" |
  "spawn_https_helper_gateway" | "exec_https_helper" |
  "spawn_ssh_bridge_gateway" | "enter_ssh_bridge" | "exec_system_ssh" |
  "spawn_local_dispatch_gateway" | "exec_local_dispatch_git" |
  "spawn_local_helper_gateway" | "enter_local_helper" |
  "spawn_receive_pack_gateway" | "exec_receive_pack" |
  "spawn_index_gateway" | "exec_index_git"

SupportedGitDistributionV1 = {
  schemaVersion: 1,
  id: "apple-git-155-arm64-xcode-26.6-17F113",
  xcode: { version: "26.6", build: "17F113" },
  architecture: "arm64",
  buildOptionLines: readonly BoundedTextLineV1[11],
  executables: readonly SupportedGitExecutableV1[3],
  execPathLinks: readonly { name: "git" | "git-pack-objects" |
    "git-receive-pack" | "git-index-pack" | "git-unpack-objects" |
    "git-remote-https", path: CanonicalAbsolutePathV1, ownerUid: 0,
    mode: 493, size: 13 | 15, target: BoundedLinkTargetV1 }[6],
  processTable: SupportedGitProcessTableV1
}
```

Every schema above is exact-key and uses `CanonicalJsonV1`. Top-level `environmentProfiles`,
`ioProfiles`, `phaseBudgets`, `nodes`, `edges`, and `executables` are non-empty, unique, and sorted by
`id`; `execPathLinks` is non-empty,
unique, and sorted by `name`. Profile `entries` is non-empty, unique, and sorted by environment name.
Node `environmentProfiles` and edge `orderAfter` are unique/sorted by ID and may be empty exactly where
their declared ranges and semantic rules permit. Each non-empty `argv` preserves token order;
`argvAlternatives` preserves the compiled alternative order and is unique by canonical bytes.
`linkChain` may be empty, has no repeated path, and preserves link traversal order. `versionLines` and
`buildOptionLines` preserve measured output order and need not be unique; only the helper exception
below permits empty `versionLines`. Every other fixed-count or bounded array follows its own printed
range. `ClosedGitEnvironmentNameV1` is the exact union of the names present in the twelve initial
profiles; an environment is the fully expanded sorted map from one profile and no inherited key is
legal. A node's profile list is empty exactly for
`coordinator`; every other node lists its one permitted profile, except `source_build_git` lists its
config/build pair, source push/pack nodes list the three transport-specific push profiles, and
`real_system_ssh` lists the two agent alternatives. The
runtime permit binds exactly one listed profile digest. Optional `SSH_AUTH_SOCK` is represented by the two
complete `system_ssh_no_agent`/`system_ssh_agent` profiles selected before permit creation, never by accepting an
extra runtime key. Arg slots are closed semantic types, not regex or prefix matches: each expands once
from the validated plan into a literal bounded string, the invocation stores the expanded argv/env
digest in every one-shot permit, and the supervisor compares literal arrays/maps. The canonical table
contains no free-string token, wildcard, or ellipsis. `receive_keep_marker` is computed exactly as
`receive-pack <validated-parent-pid> on <validated-bounded-kernel-hostname>`; `pack_object_count` is
canonical decimal `0..200001`; and the SSH slots are the parsed fields from the one normalized SSH
destination. `ssh_receive_pack_command` is exactly one argv value `git-receive-pack '<safe-path>'`;
the safe-path grammar already excludes quote, whitespace, metacharacter, traversal, tilde, and option
prefix bytes, so no escaping language or local shell is introduced. A value that cannot populate its
semantic slot refuses before a process starts.

A joined argv token expands `prefix + slot + suffix` without a separator and the combined UTF-8 value
must satisfy `BoundedArgV1`; either fragment may be empty. This is what represents
`--pack_header=2,<pack_object_count>` and `--keep=<receive_keep_marker>` without pretending an empty
suffix is a non-empty argument. `versionLines` is empty exactly for `git_remote_https`, which exposes
no independent version probe in this row; it is non-empty for `git_main` and `system_ssh`. Executable
bytes/link identity, not a fabricated helper version line, remains the admission authority.

The initial and only distribution row was measured 2026-08-26. The first line below is the exact
selected-Xcode identity; the remaining eleven are `buildOptionLines` in order:

```text
Xcode 26.6 (17F113)
git version 2.50.1 (Apple Git-155)
cpu: arm64
no commit associated with this build
sizeof-long: 8
sizeof-size_t: 8
shell-path: /bin/sh
feature: fsmonitor--daemon
libcurl: 8.7.1
zlib: 1.2.12
SHA-1: SHA1_DC
SHA-256: SHA256_BLK
```

The root-owned mode-`0755` main target is
`/Applications/Xcode.app/Contents/Developer/usr/bin/git`, size 3,704,880 and SHA-256
`10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9`.
Exec-path names `git`, `git-pack-objects`, `git-receive-pack`, `git-index-pack`, and
`git-unpack-objects` must be root-owned mode-`0755`, size-13 symlinks `../../bin/git` at the exact
`/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/<name>` paths.
The measured `git-unpack-objects` link remains part of distribution identity but has no process-table
node or permit; `receive.unpackLimit=0` makes any attempt to execute it a closed-graph refusal.
`git-remote-https` at that root must be the root-owned mode-`0755`, size-15 exact symlink
`git-remote-http`; its root-owned mode-`0755` physical target has size 2,305,920 and SHA-256
`76169453971bd5e40598de217998bcb77ace9fd1ec72ba97fbaa68c17ad56611`. Planning captures
`{ dev: UInt64DecimalV1, ino: UInt64DecimalV1, size, hash }` for every resolved target and symlink identity and rechecks the row before
each Git phase and immediately before each real exec. A changed Xcode selection, path, link, byte,
build-output line, architecture, or future binary that merely reports `2.50.1` is
`unsupported_git_distribution` before repository or network spawn. Adding a row requires a new
measured process trace, reviewed hashes, and gates in the same change.

The row also pins `/usr/bin/ssh` as the `system_ssh` executable: root-owned mode `0755`, size
1,555,472, SHA-256 `470f812f6e71ee4ca1b49c79f9c2982c054493e22502d4648bd010feb4b2a9b2`, and version line
`OpenSSH_10.2p1, LibreSSL 3.3.6`. Its invocation-time device/inode is plan evidence, not compiled
machine identity, and is rechecked immediately before exec. Any other system SSH bytes refuse the SSH
transport while HTTPS/local remain independently available under the same Git row.

`GitExecGatewayV1` makes the child policy enforceable. For each invocation, the coordinator creates an
owner-only directory containing exact generated 0700 Node-24 trampoline scripts named only `git`,
`git-remote-https`, `git-remote-developer-os-local`, `git-receive-pack`, and
`developer-os-ssh-bridge`. Their bytes come from one checked-in immutable template,
use an exact guarded absolute `process.execPath` shebang rather than `env` or a shell, and are hashed in
the plan. `PATH` and `GIT_EXEC_PATH` both contain only this directory; the real Git distribution and
user paths are absent. The coordinator alone starts the top-level pinned Git target by absolute path.
Unknown subcommand names therefore have no executable to resolve.

The twelve environment profiles are exact expansions of the records below. `SOURCE_BASE(<phase>)` is
notation local to this definition, expanded before canonical encoding; it is not stored as a macro.

```text
distribution_probe = {
  LC_ALL: "C", LANG: "C", HOME: <temporary_home>, TMPDIR: <temporary_directory>,
  PATH: <gateway_path>, GIT_EXEC_PATH: <gateway_path>,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: <supervisor_socket>,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: <invocation_capability>,
  DEVELOPER_OS_GIT_DISTRIBUTION: "apple-git-155-arm64-xcode-26.6-17F113",
  DEVELOPER_OS_GIT_PHASE: "distribution_probe"
}

SOURCE_BASE(<phase>) = {
  LC_ALL: "C", LANG: "C", HOME: <temporary_home>, TMPDIR: <temporary_directory>,
  PATH: <gateway_path>, GIT_EXEC_PATH: <gateway_path>,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
  GIT_DIR: <source_git_dir>, GIT_INDEX_FILE: <source_index>,
  GIT_OBJECT_DIRECTORY: <source_object_dir>,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: <source_alternate>,
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: <supervisor_socket>,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: <invocation_capability>,
  DEVELOPER_OS_GIT_DISTRIBUTION: "apple-git-155-arm64-xcode-26.6-17F113",
  DEVELOPER_OS_GIT_PHASE: <phase>
}

config_candidate = SOURCE_BASE("config_candidate")
source_build = SOURCE_BASE("source_build") plus {
  GIT_AUTHOR_NAME: <git_author_name>, GIT_AUTHOR_EMAIL: <git_author_email>,
  GIT_AUTHOR_DATE: <git_author_date>, GIT_COMMITTER_NAME: <git_committer_name>,
  GIT_COMMITTER_EMAIL: <git_committer_email>, GIT_COMMITTER_DATE: <git_committer_date>
}
push_https = SOURCE_BASE("push_transport")
https_helper = SOURCE_BASE("push_transport")
push_ssh = SOURCE_BASE("push_transport") plus {
  GIT_SSH: <ssh_bridge_path>, GIT_SSH_VARIANT: "ssh"
}
ssh_bridge = {
  LC_ALL: "C", LANG: "C", TMPDIR: <temporary_directory>,
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: <supervisor_socket>,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: <invocation_capability>,
  DEVELOPER_OS_GIT_DISTRIBUTION: "apple-git-155-arm64-xcode-26.6-17F113",
  DEVELOPER_OS_GIT_PHASE: "push_transport"
}
system_ssh_no_agent = {
  LC_ALL: "C", LANG: "C", HOME: <canonical_user_home>, TMPDIR: <temporary_directory>
}
system_ssh_agent = system_ssh_no_agent plus { SSH_AUTH_SOCK: <ssh_auth_sock> }
push_local = SOURCE_BASE("push_transport")
local_helper = {
  LC_ALL: "C", LANG: "C", TMPDIR: <temporary_directory>,
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: <supervisor_socket>,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: <invocation_capability>,
  DEVELOPER_OS_GIT_DISTRIBUTION: "apple-git-155-arm64-xcode-26.6-17F113",
  DEVELOPER_OS_GIT_PHASE: "push_transport",
  DEVELOPER_OS_GIT_LOCAL_TOKEN: <opaque_local_token>,
  DEVELOPER_OS_GIT_DESTINATION_SHADOW: <private_destination_shadow>
}
destination_receive = {
  LC_ALL: "C", LANG: "C", HOME: <temporary_home>, TMPDIR: <temporary_directory>,
  PATH: <gateway_path>, GIT_EXEC_PATH: <gateway_path>,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
  GIT_DIR: <destination_git_dir>,
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: <supervisor_socket>,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: <invocation_capability>,
  DEVELOPER_OS_GIT_DISTRIBUTION: "apple-git-155-arm64-xcode-26.6-17F113",
  DEVELOPER_OS_GIT_PHASE: "destination_receive"
}
```

The generated repository-local configuration is a second exact, hash-bound input rather than prose
policy:

```text
OpaqueGitLocalTokenV1 = exactly 64 lowercase hexadecimal ASCII bytes

SanitizedShadowRemoteUrlV1 =
  NormalizedRemoteUrlV1 |
  literal "developer-os-local::" + OpaqueGitLocalTokenV1

SanitizedGitShadowConfigV1 = {
  schemaVersion: 1,
  kind: "source" | "bare_destination",
  core: {
    repositoryFormatVersion: 0,
    fileMode: boolean,
    bare: boolean,
    hooksPath: GitConfigQuotedPathV1,
    fsmonitor: false
  },
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
  remote: null | {
    name: "developer-os",
    url: SanitizedShadowRemoteUrlV1
  },
  receive: null | {
    unpackLimit: 0,
    denyNonFastForwards: boolean,
    denyDeletes: boolean
  }
}

SanitizedGitShadowConfigTemplateV1 = {
  schemaVersion: 1,
  kind: "source" | "bare_destination",
  core: {
    repositoryFormatVersion: 0,
    fileMode: boolean,
    bare: boolean,
    hooksPath: { slot: "hooks_directory" },
    fsmonitor: false
  },
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
  remote: null | {
    name: "developer-os",
    url:
      | { kind: "literal", value: NormalizedRemoteUrlV1 }
      | { kind: "slot", slot: "opaque_local_selector" }
  },
  receive: null | {
    unpackLimit: 0,
    denyNonFastForwards: boolean,
    denyDeletes: boolean
  }
}
```

Every key above is required and no other key is legal. A source projection has `kind: "source"`,
`core.bare: false`, `remote` equal to its one plan-bound destination, and `receive: null`. A bare-
destination projection has `kind: "bare_destination"`, `core.bare: true`, `remote: null`, and the
three exact receive fields; its two deny booleans equal the validated real-destination preimage.
`core.fileMode` equals the validated repository projection. `core.hooksPath` names that shadow's exact
guarded empty hooks directory. There is no `pushurl`, `url.*`, `include`, `includeIf`, `filter.*`,
`credential.*` key other than the one reset, `http.*` key other than the two printed fields,
`core.sshCommand`, `core.askPass`, `core.editor`, `core.pager`, `pager.*`, `receive.procReceiveRefs`,
command-bearing value, or extra remote/receive field.

`SanitizedGitShadowConfigTemplateV1` has the same exact-key/arm invariants, except that its one hooks
path is the printed typed slot. An HTTPS/SSH source template stores the exact normalized effective URL
as its literal arm; a local source template stores only `opaque_local_selector`; a bare-destination
template has no remote. Its template hash is SHA-256 over
`developer-os:git-shadow-config-template:v1\0` plus exact `CanonicalJsonV1` bytes. Instantiation may
replace only `hooks_directory` with the invocation's guarded empty hooks path and, for local source,
`opaque_local_selector` with literal `developer-os-local::` plus the invocation's new
`OpaqueGitLocalTokenV1`. De-slotting the concrete projection must reproduce the exact persisted
template and hash; no other concrete field can vary.

`SanitizedGitShadowConfigBytesV1` renders exactly these Git-config bytes, with section order `core`,
`commit`, `tag`, `gc`, `maintenance`, `http`, `credential`, followed by the source-only
`remote "developer-os"` or destination-only `receive`. Projection-only `schemaVersion` and `kind` do
not render as Git keys. Section headers are the literal LF-terminated `[core]`, `[commit]`, `[tag]`,
`[gc]`, `[maintenance]`, `[http]`, `[credential]`, and then `[remote "developer-os"]` or `[receive]`.
Each key line is one HT, the exact printed Git key spelling, ` =`, an optional SP plus value, and LF.
Within the fixed sections, key order/spelling is exactly `repositoryformatversion`, `filemode`, `bare`,
`hooksPath`, `fsmonitor`; then `gpgSign`; `gpgSign`; `auto`; `auto`; `proxy`,
`followRedirects`; `helper`; then source `url` or destination `unpackLimit`,
`denyNonFastForwards`, `denyDeletes`. Booleans are lowercase `true`/`false`; integers are minimal
decimal. Empty `http.proxy` and `credential.helper` render no value after ` =`, which respectively
clears proxy inheritance and resets the helper list. Path/URL values are double-quoted UTF-8; each
backslash is doubled and each double quote is preceded by one backslash, while input
NUL/control/line-break bytes are already illegal. There is one LF after every
line, including the last, and no BOM, CR, comment, blank line, continuation, alternate section/key
case, or insignificant whitespace. Exact byte fixtures are the renderer contract.

`SanitizedGitShadowV1` and `SanitizedBareDestinationShadowV1` each bind their template/hash and the exact config path plus its
owner-owned mode-`0600`, single-link `dev`/`ino` identity; the exact hooks path plus its owner-owned
mode-`0700` directory `dev`/`ino` identity; and
`{ configProjection: SanitizedGitShadowConfigV1, configBytesHash: LowerHexSha256 }`, where the digest
is SHA-256 over `developer-os:git-shadow-config:v1\0` plus the exact rendered bytes. Before any Git
spawn, the immutable process intent binds both the canonical projection hash and byte hash; every
root/child permit binds those values, and the supervisor guarded-reopens the config, requires its
identity/bytes, and proves the identity-matching hooks directory empty before admitting the process.
The canonical process transcript records the template, projection, and byte hashes, so
`planningTranscriptHash` and every resulting effect plan bind them before coordinator intent.
`PersistedGitPushPlanV1` binds the template hash; a later retry must instantiate and bind its fresh
concrete projection/byte hashes plus config/hooks identities to that template before its first permit
or spawn, including `git_sync/existing_network` where no source effect exists. For HTTPS/SSH the source
URL is the normalized effective URL; for local it is only the synthesized internal selector, never a
real path or `file:` URL. Any
projection/byte/path/identity mismatch refuses before process authority. Git 2.50.1 treats exact
`http.followRedirects=false` as an error on every HTTP redirect, so no response can authorize a second
request destination.

`plus` means exact disjoint-key map union during this definition; duplicate keys refuse. Each final
map is sorted by unsigned UTF-8 key bytes before hashing. No proxy, auth-header, credential-helper,
askpass, editor, pager, shell, user `PATH`, or arbitrary `GIT_*` entry is present. In particular the
exact environment inherits none of `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_EDITOR`, `VISUAL`, `EDITOR`,
`GIT_PAGER`, or `PAGER`; `GIT_TERMINAL_PROMPT=0` disables terminal credential prompting, the shadow
projection contains no askpass/editor/pager command, and no allowed argv invokes an editor or pager.
These records, not an inherited environment, are what `processTableHash` hashes.

The `source_alternate` slot expands as the raw bytes of exactly one
`GitAlternateObjectDirectoryV1`; it is never a joined list and is never C-quoted or dequoted. Git
2.50.1 treats colon as the POSIX alternate-list separator and a leading double quote as C-style quoted
syntax, so the narrower type also rejects double quote, backslash, and controls rather than creating a
second renderer. A repository whose real object-directory path cannot satisfy that type refuses before
shadow creation, ID reservation, config hashing, or Git spawn. Boundary fixtures cover each rejected
byte and prove no legal value can widen read authority to a second object directory.

Every trampoline connects before exec to an owner-only `GitProcessSupervisorV1` Unix socket using a
random 256-bit invocation capability inherited only by the sanitized process tree. It submits its
exact basename, PID/PPID, argv, cwd, selected environment digest, distribution ID, and phase. The
supervisor maintains the plan's one-shot level-specific transition graph: it verifies the parent or
same-PID prior image, consumes exactly one matching permit, and rejects reuse, wrong order, wrong argv,
wrong environment, or an unplanned name. Rejection exits 126 without exec, terminates the invocation
process group, and destroys private quarantine when the phase is pre-intent. A post-source network
rejection preserves the verified source commit and records/retains its exact `push_pending` retry-only
state; it never reports sync success. After a permit, a generic
trampoline rechecks the target's plan identity and uses Node 24 `process.execve` to replace the same PID
with the exact real target, preserving the plan-bound `argv[0]` needed by Git's multi-call binary and
`git-remote-https`. The local-helper and SSH-bridge trampolines instead enter their fixed Developer OS
internal modes after that first permit. The SSH bridge validates its parsed destination, requests and
consumes the separate bridge→`system_ssh` same-PID permit, rechecks `/usr/bin/ssh`, and only then
`execve`s it with the exact normalized argv/environment row. `GIT_SSH` points to the guarded absolute
gateway `developer-os-ssh-bridge` path; no unsupervised bridge path exists. The capability has no
filesystem or repository authority.

All dynamic Git subcommand resolution is therefore mediated. The initial process table's push edges
are the following exact argv grammars. After guarded bytes/link identity matches the compiled row,
`direct_distribution_probe` runs exactly `git --version --build-options` once in its closed profile
and admits no child; the selected-Xcode identity is read from guarded root-owned bundle metadata, not
from another process. Its coordinator-originated `direct_config_candidate` and
`direct_source_build` edges expand one one-shot permit per actual plan call and admit no child edge:

- `direct_config_candidate`: `git config --file <candidate_config_path> --no-includes --add remote.developer-os.url <normalized_remote_url>` — zero or one use;
- `direct_source_build`: `git hash-object -w --stdin` — zero to 100,000 uses, one per planned blob;
- `direct_source_build`: `git mktree -z` — one to 100,000 uses, with bounded canonical NUL-delimited tree records on stdin;
- `direct_source_build`: `git commit-tree <candidate_tree_oid>` — exactly one use for an unborn branch; or
- `direct_source_build`: `git commit-tree <candidate_tree_oid> -p <parent_commit_oid>` — exactly one use for an existing branch.

Each `mktree -z` stdin is one to 16 MiB and contains one record per immediate child exactly as
`<mode><SP><type><SP><40-lower-hex-oid><TAB><VaultSegmentV1 UTF-8 bytes><NUL>`. The only mode/type pairs
are `100644 blob`, `100755 blob`, and `040000 tree`; symlink mode, gitlink mode, missing objects, and
every other pair refuse. A name is passed as raw UTF-8 in that NUL-delimited field, so a legal tab or
line break is data rather than syntax; NUL is already impossible. Names are unique and ordered by
Git's unsigned byte tree order, treating a tree name as if followed by `/`, and trees are constructed
bottom-up. Tests include names containing a tab, LF, and CR and assert their exact candidate tree OID;
no line-oriented `mktree` call exists.

Exactly one of the two commit-tree alternatives appears when a commit is planned. Before each private
planning phase starts, its immutable in-memory process intent expands every root slot, stdin
class/count, edge cardinality and order. A child-only `pack_object_count` or `receive_keep_marker` is
not known before its parent reads the pack; the matching gateway submits it once, the supervisor
validates the closed semantic type plus parent/phase/order, and atomically materializes the one literal
child permit before exec. No prefix/wildcard permit is stored. The ordered consumed edge IDs,
literal argv/environment digests, stdin-class/count digests, exit statuses, and bounded-output hashes
form a canonical process transcript. `planningTranscriptHash` hashes
`developer-os:git-planning-transcript:v1\0` plus those `CanonicalJsonV1` bytes and is fixed in the
effect plan before coordinator intent. A config-only enable expands only the config alternative. There is no direct free-form
Git argv surface. The `direct_source_push` root is exactly `git push --porcelain --no-verify
developer-os <commit_to_branch_refspec>`, uses `push_https`, `push_ssh`, or `push_local` according to
the validated destination, and occurs exactly once when `push` is non-null.

| Edge chain | Exact argv alternatives after slot expansion |
|---|---|
| source Git → gateway `git` → same-PID `git_main` | `git pack-objects --all-progress-implied --revs --stdout --thin --delta-base-offset -q` |
| source Git → gateway `git` → same-PID `git_main` (HTTPS dispatcher) | `git remote-https developer-os <validated_https_url>` |
| HTTPS dispatcher → gateway `git-remote-https` → same-PID `git_remote_https` | `git-remote-https developer-os <validated_https_url>` |
| source Git → gateway `developer-os-ssh-bridge` → internal SSH bridge | either `developer-os-ssh-bridge <ssh_target> <ssh_receive_pack_command>` or `developer-os-ssh-bridge -p <ssh_port> <ssh_target> <ssh_receive_pack_command>` |
| internal SSH bridge → same-PID `system_ssh` (default port) | `/usr/bin/ssh -F /dev/null -o BatchMode=yes -o NumberOfPasswordPrompts=0 -o ClearAllForwardings=yes -o PermitLocalCommand=no -o ProxyCommand=none -o ProxyJump=none -o RequestTTY=no -o StrictHostKeyChecking=yes <ssh_target> <ssh_receive_pack_command>` |
| internal SSH bridge → same-PID `system_ssh` (explicit port) | `/usr/bin/ssh -F /dev/null -o BatchMode=yes -o NumberOfPasswordPrompts=0 -o ClearAllForwardings=yes -o PermitLocalCommand=no -o ProxyCommand=none -o ProxyJump=none -o RequestTTY=no -o StrictHostKeyChecking=yes -p <ssh_port> <ssh_target> <ssh_receive_pack_command>` |
| source Git → gateway `git` → same-PID `git_main` (local dispatcher) | `git remote-developer-os-local developer-os <opaque_local_token>` |
| local dispatcher → gateway `git-remote-developer-os-local` → internal local helper | `git-remote-developer-os-local developer-os <opaque_local_token>` |
| local helper → gateway `git-receive-pack` → same-PID `git_main` | `git-receive-pack --skip-connectivity-check <private_destination_shadow>` with `argv[0]` literal `git-receive-pack` |
| receive-pack → gateway `git` → same-PID `git_main` | `git index-pack --stdin --pack_header=2,<pack_object_count> --keep=<receive_keep_marker> --report-end-of-input --fix-thin` |

For local/file sync, this entire `push_local`/`local_helper`/`destination_receive` chain runs in §4.4
step 3 before coordinator plan publication. Its closed transcript and resulting staged destination
closure are inputs to the destination effect hash. After coordinator intent, `D(h)` admits no Git
process edge at all; it is guarded file promotion only. HTTPS/SSH transport chains remain the
post-source point-of-no-return network step and are rebuilt only for their exact `retry_only` plan.

The canonical node records are exactly:

| Node ID | Image | Environment profile(s) | CWD |
|---|---|---|---|
| `coordinator` | coordinator | none | quarantine |
| `distribution_probe_git` | distribution `git_main`, argv0 `git` | `distribution_probe` | quarantine |
| `source_build_git` | distribution `git_main`, argv0 `git` | `config_candidate`, `source_build` | quarantine |
| `source_push_git` | distribution `git_main`, argv0 `git` | `push_https`, `push_local`, `push_ssh` | source shadow |
| `gateway_pack_git` | gateway `git` | `push_https`, `push_local`, `push_ssh` | source shadow |
| `real_pack_git` | distribution `git_main`, argv0 `git` | `push_https`, `push_local`, `push_ssh` | source shadow |
| `gateway_https_dispatch_git` | gateway `git` | `push_https` | source shadow |
| `real_https_dispatch_git` | distribution `git_main`, argv0 `git` | `push_https` | source shadow |
| `gateway_https_helper` | gateway `git-remote-https` | `push_https` | source shadow |
| `real_https_helper` | distribution `git_remote_https`, argv0 `git-remote-https` | `https_helper` | source shadow |
| `gateway_ssh_bridge` | gateway `developer-os-ssh-bridge` | `push_ssh` | source shadow |
| `internal_ssh_bridge` | internal SSH bridge | `ssh_bridge` | quarantine |
| `real_system_ssh` | distribution `system_ssh`, argv0 `/usr/bin/ssh` | `system_ssh_agent`, `system_ssh_no_agent` | quarantine |
| `gateway_local_dispatch_git` | gateway `git` | `push_local` | source shadow |
| `real_local_dispatch_git` | distribution `git_main`, argv0 `git` | `push_local` | source shadow |
| `gateway_local_helper` | gateway `git-remote-developer-os-local` | `push_local` | source shadow |
| `internal_local_helper` | internal local helper | `local_helper` | quarantine |
| `gateway_receive_pack` | gateway `git-receive-pack` | `destination_receive` | destination shadow |
| `real_receive_pack` | distribution `git_main`, argv0 `git-receive-pack` | `destination_receive` | destination shadow |
| `gateway_index_git` | gateway `git` | `destination_receive` | destination shadow |
| `real_index_git` | distribution `git_main`, argv0 `git` | `destination_receive` | destination shadow |

The canonical edge metadata is exactly the following. An edge whose `when` predicate is false has
zero runtime permits; if true, its declared `minUses..maxUses` applies. `direct_source_build` expands
two to 200,001 literal one-shot permits for a new commit (at least one `mktree` plus one
`commit-tree`).

| Edge ID(s), in order | From → to / transition | Phase / `when` | Uses | `orderAfter` |
|---|---|---|---|---|
| `direct_distribution_probe` | coordinator → distribution-probe Git / spawn | distribution probe / `distribution_probe` | 1 | `[]` |
| `direct_config_candidate` | coordinator → source-build Git / spawn | config candidate / `config_candidate` | 1 | `[direct_distribution_probe]` |
| `direct_source_build` | coordinator → source-build Git / spawn | source build / `new_commit` | 2..200001 | `[direct_distribution_probe]` |
| `direct_source_push` | coordinator → source-push Git / spawn | push transport / `any_push` | 1 | `[direct_distribution_probe, direct_source_build]` (second is vacuous when its predicate is false) |
| `spawn_pack_gateway`, `exec_pack_git` | source-push Git → gateway-pack / spawn; gateway-pack → real-pack / same-PID exec | push pack / `pack_required` | 1 each | `[direct_source_push]`; `[spawn_pack_gateway]` |
| `spawn_https_dispatch_gateway`, `exec_https_dispatch_git` | source-push Git → HTTPS-dispatch gateway / spawn; gateway → real dispatcher / same-PID exec | push transport / `https_push` | 1 each | `[direct_source_push]`; `[spawn_https_dispatch_gateway]` |
| `spawn_https_helper_gateway`, `exec_https_helper` | real HTTPS dispatcher → HTTPS-helper gateway / spawn; gateway → real helper / same-PID exec | push transport / `https_push` | 1 each | `[exec_https_dispatch_git]`; `[spawn_https_helper_gateway]` |
| `spawn_ssh_bridge_gateway`, `enter_ssh_bridge`, `exec_system_ssh` | source-push Git → SSH gateway / spawn; gateway → internal bridge / same-PID enter; bridge → system SSH / same-PID exec | push transport / `ssh_push` | 1 each | `[direct_source_push]`; `[spawn_ssh_bridge_gateway]`; `[enter_ssh_bridge]` |
| `spawn_local_dispatch_gateway`, `exec_local_dispatch_git` | source-push Git → local-dispatch gateway / spawn; gateway → real dispatcher / same-PID exec | push transport / `local_push` | 1 each | `[direct_source_push]`; `[spawn_local_dispatch_gateway]` |
| `spawn_local_helper_gateway`, `enter_local_helper` | real local dispatcher → local-helper gateway / spawn; gateway → internal helper / same-PID enter | push transport / `local_push` | 1 each | `[exec_local_dispatch_git]`; `[spawn_local_helper_gateway]` |
| `spawn_receive_pack_gateway`, `exec_receive_pack` | internal helper → receive-pack gateway / spawn; gateway → real receive-pack / same-PID exec | destination receive / `local_push` | 1 each | `[enter_local_helper]`; `[spawn_receive_pack_gateway]` |
| `spawn_index_gateway`, `exec_index_git` | real receive-pack → index gateway / spawn; gateway → real index Git / same-PID exec | destination receive / `local_pack_received` | 1 each | `[exec_receive_pack]`; `[spawn_index_gateway]` |

The seven I/O profiles have these exact byte and time limits:

| Profile ID | stdin bytes | stdout bytes | stderr bytes | per-process wall | idle |
|---|---:|---:|---:|---:|---:|
| `metadata` | 0 | 4,194,304 | 4,194,304 | 30,000 ms | 30,000 ms |
| `source_build` | 16,777,216 | 4,194,304 | 4,194,304 | 30,000 ms | 30,000 ms |
| `root_push` | 0 | 4,194,304 | 4,194,304 | 600,000 ms | 120,000 ms |
| `pack_stream` | 16,777,216 | 2,147,483,648 | 4,194,304 | 600,000 ms | 120,000 ms |
| `transport_stream` | 2,147,483,648 | 2,147,483,648 | 4,194,304 | 600,000 ms | 120,000 ms |
| `receive_stream` | 2,147,483,648 | 4,194,304 | 4,194,304 | 600,000 ms | 120,000 ms |
| `index_stream` | 2,147,483,648 | 4,194,304 | 4,194,304 | 600,000 ms | 120,000 ms |

`direct_distribution_probe` and `direct_config_candidate` use `metadata`;
`direct_source_build` uses `source_build`; `direct_source_push` uses `root_push`; the two pack edges
use `pack_stream`; every HTTPS, SSH, local-dispatch, and local-helper edge uses `transport_stream`;
the two receive-pack edges use `receive_stream`; and the two index-pack edges use `index_stream`.
The four phase budgets are exactly 30,000 ms for `distribution_probe`, 30,000 ms for
`config_candidate`, 1,800,000 ms for the complete `source_build`, and 600,000 ms for the complete
`push`. `push` begins at `direct_source_push` and includes its pack, transport, local receive, and
index descendants. That deadline belongs to one top-level `git sync` invocation: no child, helper,
same-process transition, or internal attempt within that invocation resets it. A later interactive or
scheduled invocation that reopens the exact durable `push_pending` record starts one new 600,000-ms
push phase only after the global-lock, provenance, source-postimage, destination, distribution, and
process-table rechecks in §4.4. It does not inherit elapsed wall time from an earlier process. This is a
deliberate per-invocation lock-hold bound, not a cumulative lifetime budget: persisting wall-clock or
monotonic elapsed time across process death would either trust a rollback-prone clock or strand a valid
commit after one crashed attempt. Each invocation remains finite; repeated invocations remain explicit,
independently gated recovery attempts.

These are enforced stream limits, not capture-buffer suggestions. The coordinator creates counting
stdin/stdout/stderr proxies for direct children. Before a gateway exec/enter transition, the gateway
passes its original three descriptors to the supervisor, replaces them with counted proxy
descriptors, and the supervisor forwards bytes between the original and replacement descriptors.
Counters survive a same-PID exec/enter and are charged once, so a trampoline cannot reset a budget.
Idle time is time with no forwarded byte and no admitted process transition/exit. Binary pack/protocol
streams are hashed and counted incrementally and never materialized merely for enforcement; captured
text is bounded first and redacted before publication. An input class remains exact: `hash-object`
receives one guarded source file of at most 16 MiB, `mktree -z` receives its already bounded canonical
records, and `commit-tree` receives exactly `chore(brain): sync` plus LF. The initial and refreshed
guarded scoped snapshot is at most 1 GiB in aggregate; either the first file over 16 MiB or the byte
that would exceed the aggregate refuses before hashing, object creation, ID reservation, or intent.

Crossing a descriptor, per-process, idle, or inherited phase limit closes the proxies, sends SIGTERM
to the whole invocation process group, waits exactly 100 ms, sends SIGKILL to the group if any member
remains, and reaps every child before returning. Failure to terminate/reap is recovery-required. A
local/build/probe/config limit occurs before coordinator intent and destroys its private state; a
network limit after source publication records or retains the exact `push_pending` retry-only state.
No raw over-limit bytes enter a transcript, journal, error, or log; the transcript records the profile
ID, final counts, bounded streaming hashes, deadline class, termination outcome, and exit statuses.

Each arrow in a chain is its own `GitProcessEdgeV1`; the second arrow is
`exec_same_pid`/`enter_internal_same_pid` and preserves the exact expanded argv unless the row above
explicitly gives the bridge's normalized system-SSH argv. Exactly one transport branch is always
required. The pack pair is required exactly when the advertised target does not already equal the
plan's `commitOid` and source Git emits a ref-update command; a command may still carry a canonical
zero-object pack when the destination already owns the objects through another ref. If the advertised
target already equals `commitOid`, source Git emits no ref command, the pack pair has zero permits,
and successful `--porcelain` output is exactly
`=\t<commitOid>:<branchRef>\t[up to date]\nDone\n` after one separately bounded `To` diagnostic. For
HTTPS/SSH that diagnostic must name the normalized effective URL; for local it must name the exact
invocation-only helper selector and is consumed/redacted in memory rather than persisted as raw text.
Any other no-pack outcome refuses. A local up-to-date receive likewise has zero index-pack
permits and yields a real zero-transition destination effect; when a local ref-update command exists,
receive-pack always uses the single index-pack branch, including for a zero-object pack. The exact
destination `SanitizedGitShadowConfigV1` bytes pin `receive.unpackLimit=0`, empty hooks,
`maintenance.auto=false`, `gc.auto=0`, and no `receive.procReceiveRefs`; the pin prevents
Git's loose-object/alternate-dependent `unpack-objects` path, while `--skip-connectivity-check`
prevents the measured `rev-list`
branch, and neither `git-rev-list`, `maintenance`, shell, nor any vendor node/edge exists. The exact
pinned distribution is separately trusted not to absolute-exec an unmeasured child for these argv;
installed-build process-event fixtures prove that negative property.

The two dynamic predicates are closed observations of that measured protocol, not remote-selected
policy strings. `pack_required` becomes true only after the sanitized transport advertisement parses
the one target ref as absent or present at an OID different from `commitOid`; false requires the one
exact present-at-`commitOid` advertisement above. `local_pack_received` is true iff that local
ref-update command carried the canonical pack header (object count may be zero). The supervisor
materializes zero or one literal permits from those states and records the predicate/result in the
process transcript. A missing, duplicate, or malformed target-ref advertisement, an over-limit or
malformed overall advertisement, or a contradictory command, pack header, permit, porcelain line, or exit status destroys pre-intent local quarantine or
leaves a network push in its existing retry-only recovery state.

The bridge and local helper are fixed Developer OS internal modes. Installed-distribution fixtures pin
every gateway handshake, dispatcher argv, same-PID image transition, option grammar, dynamic OID/count
slot, environment, parent, and absence of shell or vendor descendants; no flat allowlist permits a
descendant or transition at the wrong level:

- the shadow is a separate Git directory with a generated minimal repository-local config, an empty
  hooks directory, exact validated snapshots of the required index/refs/HEAD, and a primary quarantine
  object directory;
- its only view of pre-existing objects is an internally generated
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at the one validated real object directory; that
  directory is read-only authority, while every candidate object write goes to quarantine;
- system and global config are disabled explicitly, `HOME` is the owner-only temporary home, and no
  worktree command is used; candidate file bytes enter plumbing through bounded memory/stdin rather
  than a worktree path;
- its config is exactly the hash-bound `SanitizedGitShadowConfigV1` projection and canonical bytes
  above; filters receive no path-aware Git operation, `GIT_OPTIONAL_LOCKS=0` applies to planning reads,
  and the exact environment/config/process grammar disables prompt, askpass, editor, and pager
  authority; and
- each spawn site enforces only its numbered child set above and refuses every other executable/argv.

`GitMetadataBoundsV1` is mandatory before any source/destination metadata is copied, parsed,
fingerprinted, or materialized. Source and destination config are each capped at 1 MiB; a generated
source-config candidate is capped at 2 MiB; source index is capped at 512 MiB; either `HEAD` is capped
at 4 KiB; and every admitted loose ref is exactly bounded to at most 41 bytes. Packed refs and every
unlisted metadata representation already refuse. Each guarded descriptor is counted while streamed;
the first byte beyond its field limit refuses before ID reservation, hash, copy, parse, or process
authority. Config and `HEAD` may be materialized only after that read completes within the bound.
Index snapshot/candidate copy and hashing stay streamed and never allocate a JavaScript buffer of the
declared maximum; the candidate output is independently counted against the same 512-MiB bound before
publication. Generated config bytes are independently counted before their quarantine write. Every
refresh repeats the same pre-read cap rather than trusting an earlier size or `stat` result.

Planning first reads the real repository config once through a guarded, bounded descriptor into
memory and runs the bounded whole-config secret/redaction scan **before any fingerprint, copy, or
persistence**. If any value would be changed by the configured redactor or matches a secret class,
planning refuses without mutation and publishes only the finding class; this includes credentials in
unrelated remote, auth-header, and URL-rewrite entries. Every refreshed config snapshot follows the
same scan-before-hash rule. Only a clean snapshot is parsed and fingerprinted as inert planning data
with includes disabled. To add the fixed remote, enable copies those clean bytes to quarantine and
runs only the exact `direct_config_candidate` argv above against that copy under its exact environment.
It validates that the candidate differs only by the exact absent `remote.developer-os` stanza;
`GitEffectPlanV1` later compare-and-swaps the candidate bytes through its journal. No Git subprocess
opens the real source config for ordinary repository discovery or mutation.

For SSH, Git receives the exact gateway `developer-os-ssh-bridge` path as `GIT_SSH` and literal
`GIT_SSH_VARIANT=ssh`; it therefore does not run the executable-name detection probe. That trampoline
must consume the source-Git→bridge permit before entering `SanitizedSshBridgeV1`, and the bridge must
consume the separate same-PID system-SSH permit before exec. It accepts only the one plan-bound
user/host/port and `git-receive-pack` repository path, adds fixed no-config/no-proxy/no-local-command/
non-interactive options, and refuses every other argv before executing system SSH without a shell.
SSH may use an ambient agent or default key; Developer OS never reads either.

For local/file transport, the in-process coordinator — never the bridge — accepts the canonical real
bare directory fingerprinted in the plan and validates that it is non-overlapping, bare, format 0,
SHA-1, file-ref backed, and free of alternates, shallow/graft/replacement, extensions, and unknown
configuration. Before any parse, fingerprint, copy, persistence, or refreshed hash, the coordinator
reads the whole destination config through a guarded descriptor counted against
`destinationConfigMaxBytes` into memory and applies the
same bounded secret/redaction scan as the source config; any match refuses unchanged and publishes only
its class. Every immediate pre-source-Git refresh repeats scan-before-hash. Only clean bytes enter the
destination-config key allowlist, which is exactly `core.repositoryformatversion`,
`core.filemode`, `core.bare`, `core.ignorecase`, `core.precomposeunicode`, optional
`core.logallrefupdates`, `receive.denyNonFastForwards`, and `receive.denyDeletes`; includes,
`core.hooksPath`,
`receive.procReceiveRefs`, and every command-bearing or unknown key refuse.

The real bare destination is never passed to receive-pack. Planning constructs an owner-only
`SanitizedBareDestinationShadowV1`: a separate bare Git directory with generated minimal config that
pins `receive.unpackLimit=0`, an
empty hooks directory, exact guarded snapshots of `HEAD` and the allowed refs, a primary quarantine
object directory, and a read-only alternate to the source shadow's validated object view. It contains
no real-destination path or object alternate. Source Git receives
the synthesized internal helper URL with a random, plan-bound opaque token — never the recorded real
path or a receive-pack program string. The token has
no filesystem meaning. The helper executable basename is exactly `git-remote-developer-os-local` in
the one `GitExecGatewayV1` directory. Source Git reaches the gateway `git` trampoline with exact
`git remote-developer-os-local developer-os <token>` argv; the permitted dispatcher transition reaches
the fixed local-helper trampoline and enters `SanitizedLocalRemoteHelperV1` in the same PID with exact
`git-remote-developer-os-local developer-os <token>` argv. `/bin/sh`, `sh -c`, the real Git directory,
and user `PATH` are not in this branch. The installed-distribution integration test proves every
trampoline/real image, stable-PID transition, and exact argv. A sanitized environment gives the helper
only the selector token, private shadow path, and supervisor capability/socket needed for its next
one-shot transition. Git strips the
`developer-os-local::` selector before dispatch, so the helper accepts only remote name `developer-os`
and the exact stripped `<token>` argv, exposes only the remote-helper
`capabilities` and `connect git-receive-pack` exchange, verifies the shadow's
owner/type/generated-config fingerprint, and starts only the exact gateway `git-receive-pack`
trampoline for `git-receive-pack --skip-connectivity-check <private-shadow>` without a shell under
disabled maintenance/GC and the level-5 transition policy.
It refuses every other protocol line or argv, has no real-destination path field, cannot resolve one
from the token, and performs no real-repository read or check. Thus later swaps of real config, hooks,
refs, or paths cannot alter what receive-pack reads or executes.

After shadow receive-pack succeeds, the coordinator verifies its resulting ref is the exact non-force
result of the planned destination snapshot. When a ref-update command ran, it uses only the source/
destination shadows to produce a self-contained pack/index. Before any real-destination mutation, the
guarded in-process SHA-1 pack/ref reader — never Git — verifies that pack is structurally valid and its
complete transitive object closure resolves the resulting ref to the validated commit; missing,
malformed, extra-target, or wrong-OID objects destroy quarantine and refuse. When the exact up-to-date
alternative ran, no pack/index exists: planning requires the guarded real destination target ref
already equal `commitOid` and creates a hash-bound zero-transition destination effect. As with an
up-to-date HTTPS/SSH response, version 1 does not audit remote repository integrity behind an already
advertised ref and does not invent a pack Git emitted no command for. These gates
replace receive-pack's skipped connectivity child. The coordinator then
re-reads and re-scans the real destination config before hashing it and in-process compare-checks the
planned config, `HEAD`, and target ref. It never inventories, hashes, or persists unrelated real
object-store or hook contents; no subprocess receives any real-destination path. Real hooks are outside
authority and cannot be opened by the shadow process.

That reader is a streaming parser governed by the exact non-null destination
`GitPackReaderBudgetV1`; every other effect requires null. `packHeaderObjectCount` is the exact
canonical count decoded from the private pack header and supplied to the sole conditional
`--pack_header=2,<pack_object_count>` child permit. `admittedObjectCount` is the number of complete
pack entries whose headers, compressed bodies, inflation, and delta resolution the reader accepted.
`closedEffectObjectCount` is the number of distinct OIDs in the exact self-contained transitive
closure of the planned destination ref; duplicate OIDs and every pack object outside that closure
refuse. A successful reader requires all three counts equal and no greater than 200001; the process
gateway refuses count 200002 before materializing or spawning the child permit. It counts compressed input before
parse, each object before allocation, each inflated output byte, every delta instruction, and the
bytes read or written while resolving a delta; shared bases are charged again when processed again.
No object may exceed 512 MiB, aggregate inflation or delta work 8 GiB, delta depth 50, or total delta
instructions 10,000,000. At most 256 MiB may be resident at once; larger legal streams spill only to
guarded owner-only files inside the private quarantine, whose additional simultaneously live bytes
may not exceed 10 GiB. The reader inherits the one top-level 600-second push deadline and cannot reset
it on an object, delta, spill, retry, or verification pass. Any first byte, count, allocation, depth,
work, memory, temp, or deadline overrun closes descriptors, removes the still-private quarantine, and
refuses before a coordinator/effect journal or real object/ref/reflog mutation exists.

Before publication, the target ref is recorded as tagged `absent` or exact
`present { bytes, oid }`, and each exact final pack and index path is guarded and classified independently as
`absent`, `byte_identical_reusable`, or `conflicting`; wrong type, symlink, or any non-identical byte is
`conflicting` and refuses. `absent` becomes a `create` transition; pre-intent
`byte_identical_reusable` becomes an ownership-neutral `reuse` transition. The journal records that
closed classification and later `created` versus `reused` ownership for each member.
`GitEffectPlanV1` stages exact same-filesystem temporary files, publishes the pack and then index with
atomic no-replace primitives, verifies each, compare-and-swaps the required branch reflog postimage,
and compare-and-swaps the target ref last. It never overwrites. If a final path appears between
classification and publication,
no-replace `EEXIST` is a stale third state even when byte-identical: the leaf is preserved, no reuse
observation is invented, and recovery is required. A plan-time reused file is never product-owned and
never removed.

The coordinator's destination-side `GitEffectPlanV1` alone performs those pack/index/reflog/ref journal
operations; the source-side plan cannot name them, and neither changes destination config, hooks, or
`HEAD`. A relevant change detected before the first guarded mutation destroys the destination
shadow; one detected by a later compare-and-swap enters compensation. Partial promotion reverses the
ref effect first by compare-and-swapping the exact new OID/bytes back to the journaled prior bytes, or by
guarded unlink only when the prior ref was tagged absent, then restores the exact reflog preimage. A
stale or third ref/reflog is left byte-identical with exit 6. Only after the prior ref and reflog verify
does compensation classify each exact plan-`created`
index/pack as `relinquished_created_object` without unlinking it; plan-time `reused` files remain
ownership-neutral as before. Any missing/replaced/mismatched created object leaves exit 6. No
reachability check authorizes deletion, so a concurrent writer cannot race a check-to-unlink window.
Successful verification and success-record publication occur only after the coordinator's guarded,
in-process SHA-1 pack/ref reader proves the real bare ref resolves transitively to the validated commit;
that reader executes no Git process and publishes no object content. Concurrent-swap fixtures at every
recheck/promotion boundary must execute no hook or unplanned child and may not mutate the real
destination except through those guarded effect operations.

The environment is constructed from an allowlist rather than inherited: arbitrary `GIT_*`, askpass,
proxy, auth-header, editor, pager, and SSH-command variables are removed. Only the minimum locale,
temporary home, guarded absolute Node path, `SSH_AUTH_SOCK` for SSH, exact gateway-only `PATH` and
`GIT_EXEC_PATH`, supervisor socket/capability, and the exact internally generated shadow values
(`GIT_DIR`, index/object paths, object alternate, config suppression, and transport bridge/helper
variables) survive.

HTTPS that requires an executable credential helper fails non-interactively; the product does not
weaken the no-vendor boundary to make it work. Author and committer identity are read from the inert
config projection as data, validated, then injected into the shadow commit environment; missing
identity refuses, and Developer OS never writes repository or global identity. All captured output is
redacted before publication or persistence.

### 4.3 Exact synchronization scope

The synchronization universe is computed in code and contains only:

1. canonical Markdown notes under each configured topic folder; and
2. `<indexesDir>/index.json`, `graph.json`, `vault-map.md`, and `catalog.md`.

The canonical-note predicate is the Brain architecture contract: every path segment is checked and
`_raw`, `_outputs`, `_graveyard`, `_indexes`, `templates`, `.obsidian`, every dot-prefixed segment,
and every unconfigured folder are excluded. The Git enumerator includes current canonical files and
tracked paths that still satisfy that predicate but were deleted. This makes deletion sync possible
without broad staging.

`SyncRecordV1` stores the exact path inventory managed by the last successful sync as well as the
scope fingerprint. Reconcile uses only that inventory when retiring paths; it never interprets an
unrelated tracked path as product-owned. `contentRoot`, `topicFolders`, `topicAliases`, and
`indexesDir` are scope-changing fields, including schema-valid hand edits. `brainPath` is the
repository-identity refusal defined in §2.2, not a reconcile input.

The implementation never invokes `git add -A`, `git add .`, a wildcard pathspec, or a content-root
directory pathspec. It passes only the exact changed paths produced by the enumerator. Private
quarantine, generated model output, Obsidian state, templates, and unrelated tracked files remain
outside the proposed tree even when they are dirty.

This scope controls what Developer OS stages; it is not a filter over existing branch history. Git
push transfers reachable commits, so an out-of-scope path committed manually before or between
syncs may reach the configured remote. Developer OS neither scans all history nor rewrites it. The
enable plan displays this boundary before apply, and the user owns the safety of the branch history
they explicitly adopt.

### 4.4 Plan, validate, commit, and push

The in-memory sync plan and the retry-persisted subset are strict exact-key records:

```text
GitRefStateV1 =
  | { state: "absent" }
  | { state: "present", oid: LowerHexSha1, bytesHash: LowerHexSha256 }

GitHeadStateV1 = {
  state: "present",
  bytesHash: LowerHexSha256,
  semantic:
    | { kind: "symbolic_ref", value: FullBranchRefV1 }
    | { kind: "oid", value: LowerHexSha1 }
}

GitSyncChangeV1 = {
  path: VaultRelativePathV1,
  operation: "create" | "replace" | "remove",
  sourceHash: LowerHexSha256 | null,
  blobOid: LowerHexSha1 | null
}

GitIndexStateV1 =
  | { state: "absent" }
  | { state: "present", bytesHash: LowerHexSha256 }

GitSourceStateV1 = {
  configHash: LowerHexSha256,
  index: GitIndexStateV1,
  head: GitHeadStateV1,
  headReflog: GitReflogStateV1,
  branchReflog: GitReflogStateV1,
  branchRef: GitRefStateV1
}

PersistedGitPushPlanV1 = {
  schemaVersion: 1,
  repositoryRoot: CanonicalAbsolutePathV1,
  branchRef: FullBranchRefV1,
  commitOid: LowerHexSha1,
  remoteName: "developer-os",
  sourceShadowConfigTemplateHash: LowerHexSha256,
  destination:
    | { transport: "https" | "ssh", effectivePushUrl: NormalizedRemoteUrlV1 }
    | { transport: "local", effectivePushUrl: NormalizedRemoteUrlV1,
        repositoryRoot: CanonicalAbsolutePathV1,
        configHash: LowerHexSha256,
        head: GitHeadStateV1,
        targetRef: GitRefStateV1,
        targetReflog: GitReflogStateV1,
        destinationShadowConfigTemplateHash: LowerHexSha256,
        destinationGitEffect: { id: GitEffectIdV1, planHash: LowerHexSha256 } },
  sourceBefore: GitSourceStateV1,
  sourceAfter: GitSourceStateV1,
  distributionId: SupportedGitDistributionV1.id,
  processTableHash: LowerHexSha256
}

GitSyncPlanV1 = {
  schemaVersion: 1,
  repositoryRoot: CanonicalAbsolutePathV1,
  scope: GitScopeSnapshotV1,
  sourcePreconditions: PersistedGitPushPlanV1.sourceBefore,
  changes: readonly GitSyncChangeV1[0..100000],
  managedPaths: readonly VaultRelativePathV1[0..100000],
  candidateTreeOid: LowerHexSha1,
  commit: null | {
    parentOid: LowerHexSha1 | null,
    commitOid: LowerHexSha1,
    message: "chore(brain): sync"
  },
  sourceGitEffectPlanHash: LowerHexSha256 | null,
  destinationGitEffectPlanHash: LowerHexSha256 | null,
  push: PersistedGitPushPlanV1 | null
}
```

`FullBranchRefV1` is exactly `refs/heads/` plus `ValidatedGitBranchV1`. `LowerHexSha1` is exactly 40
lowercase hexadecimal bytes. Change and managed-path arrays are unique and sorted by unsigned UTF-8
path bytes. `GitHeadStateV1` is always a guarded present regular file: the symbolic arm requires exact
bytes `ref: <FullBranchRefV1>\n`, while the OID arm requires exact `<LowerHexSha1>\n`; `bytesHash`
hashes those bytes. A missing, malformed, non-canonical, over-limit, or other semantic form refuses.
The source `HEAD` must be symbolic and its value must equal the recorded `FullBranchRefV1`; a local bare destination may be symbolic to
an unborn branch whose target ref is absent, symbolic to another branch, or detached at an OID, and
the exact semantic/hash pair remains an immutable precondition rather than a ref-update target. Thus
an initialized empty bare repository is representable without inventing a commit OID. A create/replace
has non-null source/blob hashes; a remove has both null. `commit: null`
requires null `sourceGitEffectPlanHash`; a non-null commit requires it and its OID, parent, candidate
tree, and fixed message must recompute exactly in quarantine. A local push requires non-null
`destinationGitEffectPlanHash`; HTTPS/SSH and `no_changes` require it null. `push` is non-null whenever the resulting `HEAD` is not the last
successfully pushed OID, including a retry with no file changes. `sourcePreconditions` is byte-equal to
`push.sourceBefore` whenever `push` exists. A null source effect requires
`sourceBefore == sourceAfter`; a non-null source effect requires an explicit `sourceAfter` whose config,
index, HEAD semantic/file-hash, both reflog projections, and branch-ref projection are exactly its verified postimages, with the branch ref
present at `commitOid`. The coordinator's unique source-effect ref must resolve to a plan whose
`pushSourceProjection` is byte-equal to those two persisted states and whose complete transition set
maps one to the other; its hash equals `sourceGitEffectPlanHash`. The sync plan is at most 16 MiB.
`sourceBefore.index.state: "absent"` is legal only for §4.1's supported unborn empty repository. A
non-null source effect must publish `sourceAfter.index.state: "present"` with `bytesHash` equal to the
validated candidate-index bytes. A null source effect preserves the exact tagged index state through
`sourceBefore == sourceAfter`; it cannot invent a hash for an absent index. Retry compares the complete
tagged `sourceAfter`, so absent and present index states are never conflated.

Every non-null push carries `sourceShadowConfigTemplateHash` equal to the recomputed source template
for its destination and repository projection. A local destination additionally carries
`destinationShadowConfigTemplateHash` equal to the template used by its private pre-intent receive;
the destination effect's planning transcript must bind the same hash. HTTPS/SSH have no destination-
shadow field. These template hashes remain stable across process death even though a retry creates new
private paths, object directories, selector token, config inode, and hooks inode. Each retry de-slots
its concrete config back to the persisted template and then binds the fresh projection/byte hashes and
identities in every supervisor permit/transcript before spawn; a missing/mismatched template or
concrete binding is recovery-required and cannot fall back to a newly calculated config.

All object/effect/staging limits use one `GitSyncCardinalityV1` calculation. Let `B` be newly hashed
blobs (`0..100000`), `T` the distinct bottom-up tree objects (`0..100000`), and `C` the candidate commit
object (`0|1`). The closed source object set is `O = B + T + C <= 200001`. Every sync runs against the
repository already established by enable and may publish those `O` object transitions plus at most one
index, two reflog, and one branch-ref transition, so its source effect has at most 200005
transitions/observations. The separate `git_enable/initialize` effect has only one
`source_git_directory_tree` transition; its minimal no-commit `.git` tree has at most 511 closed
constructor entries/directories and contains no sync candidate object set. A local destination has at
most four pack/index/reflog/ref transitions. Transition order is part of the plan grammar: a sync
lists source-object creates first in canonical path order, then the optional index, HEAD reflog,
branch reflog, and branch ref last; a destination lists pack/index creates in canonical path order,
then its optional branch reflog and ref last; initialize has only its one directory-tree transition.
Reverse traversal therefore restores refs and index/control state before it reaches a published
object/tree create eligible for relinquishment. `EffectJournalV1`,
`GitEffectObservationV1`, `GitEffectPlanV1`, the process edge-use ranges, and recursive tree bounds all
admit those same maxima. Before ID reservation, planning counts the actual post/before/after evidence,
directory descendants, Foundation blobs/digests, shadows, temps, and coordinator leaves; the command
refuses unless the maximum simultaneously live phase fits the 1,000,000 aggregate/per-coordinator
lifecycle-staging cap and both 100,000 Foundation companion caps. The 16-MiB immutable-plan bound may
refuse earlier but can never require a larger array than the schema admits.

`PersistedGitPushPlanV1` contains no credential, capability, socket, temporary path, author identity,
output, wall-clock deadline, or cumulative retry budget. Its retry authority is the exact immutable
destination/source/process/template binding above; the source template hash and local destination
template hash contain no concrete temporary path or token. Each admitted top-level attempt receives only §4.2's fresh,
non-resettable-within-that-invocation push phase. Its `processTableHash` is SHA-256 over
`developer-os:git-process-table:v1\0` plus the selected distribution row's exact
`SupportedGitProcessTableV1` `CanonicalJsonV1` bytes. Its own digest is SHA-256 over
`developer-os:git-push-plan:v1\0` plus its exact `CanonicalJsonV1` bytes. The coordinator persists the
whole push record inside `LifecycleCoordinatorPlanV1` before local commit publication and records that
digest as `pushPlanHash`; retry reopens and re-hashes those guarded bytes rather than accepting a plan
from config, argv, or a newly calculated sync.

`git sync` runs under the global mutation lock:

1. If `LifecycleJournalClosureV1` is `retry_only`, require the exact persisted transaction ID and push-
   plan hash, matching active provenance, exact `sourceAfter` and destination preconditions, unchanged
   branch tip at `commitOid`,
   selected distribution/process-table hashes, source shadow-config template hash, and single
   effective destination. Reconstruct fresh owner-only source shadow/gateway/supervisor state solely
   from that persisted plan for HTTPS/SSH, de-slot its concrete config to the exact template, and bind
   the new config/hooks identities plus projection/byte hashes before any permit; for
   local/file, require its destination template hash to match the effect planning transcript, then
   reopen and re-hash that effect plan plus either the already staged immutable destination closure or
   the zero-transition plan's already-present exact target ref, with no helper/receive rerun.
   Then skip steps 2–5 and run only its step-6 transport/promotion.
   This retry branch validates the source exclusively against persisted `sourceAfter`; `sourceBefore`
   remains historical plan evidence and is never required after the source effect committed.
   Any mismatch is `lifecycle_recovery_required` without a Git or network spawn. Otherwise require `clear` and refuse
   before mutation if Git is disabled or incompletely configured, the vault is not the
   recorded repository, the index already contains staged changes, a Git history operation is in
   progress, `HEAD` is detached or on another branch, the fixed remote is absent or changed, identity
   is missing, repository/index format is outside §4.1's closed allowlist, the scope fingerprint
   differs, the effective push URL is not the single recorded safe destination, or a relevant path
   fails containment and symlink checks.
2. Enumerate the current scope and tracked deletions, and derive reconcile retirements from the last
   successful managed inventory as defined in §4.1. Read proposed
   file bytes through guarded, bounded descriptors into memory, refusing the first file above 16 MiB
   or aggregate snapshot byte above 1 GiB. Run the secret scan **before hashing,
   Git object creation, or any persistence**, then run Brain lint on the safe snapshot. A refusal
   publishes only finding class and vault-relative path, never matched content.
3. After both gates pass, capture `sourceBefore`, construct `SanitizedGitShadowV1`, and build
   the exact candidate tree and commit with no filters or hooks in its quarantine object database. The
   real `.git/objects`, config, index, refs, and `HEAD` remain byte-identical. An unborn branch uses
   Git's empty tree as its base. For a local/file destination, also construct
   `SanitizedBareDestinationShadowV1` from the guarded real-destination snapshot and run the closed
   local helper/receive process tree now, entirely between private shadows. Parse and validate the
   resulting pack/index/ref closure and stage its exact destination postimages when a ref-update
   command ran; for the exact up-to-date alternative require no pack/index output and validate the
   already-present target ref at `commitOid`. Build the immutable, possibly zero-transition,
   destination `GitEffectPlanV1` before coordinator plan publication. Derive explicit `sourceAfter`
   from the candidate source postimages; if there is no source effect it must be byte-identical to
   `sourceBefore`. No real source or destination
   Git path changes in this planning phase.
4. Re-enumerate and guarded-read every refreshed candidate source into memory. Re-run the secret scan
   on every refreshed byte snapshot **before** computing its refreshed identity/hash or persisting it,
   and re-run the whole-config scan before computing the refreshed real-config fingerprint. A match
   destroys the shadow and quarantine and refuses without publishing or hashing the match. Only then
   compare source identities/hashes to `sourceBefore`, repository preconditions, inert real-config fingerprint, shadow
   config, scope, and effective URL. A local plan also refreshes the real bare repository snapshot and
   requires its config, `HEAD`, target ref, target reflog, object closure, and device identity to equal the destination
   effect preimage before publishing coordinator intent. Any concurrent change destroys both shadows
   and quarantine and refuses before apply.
5. Execute the journaled source-side `GitEffectPlanV1`: promote only validated objects, compare-and-swap the
   validated candidate index over the exact supported real-index snapshot, publish the exact planned
   HEAD/branch reflog appends when required, update the recorded branch ref last with compare-and-swap
   semantics, and apply an enable-time candidate config only when planned. These
   are guarded journal file operations; no Git subprocess points at the real Git directory. A newly
   constructed read-only shadow verifies the resulting real index/ref/config projection and candidate
   tree. Verification requires the exact persisted `sourceAfter`, including branch ref at `commitOid`,
   before the source effect may reach `verified`. The fixed commit message is `chore(brain): sync` and
   contains no path or content.
6. Recheck `sourceAfter`, the commit tree, branch tip, shadow environment, and single effective destination. For
   HTTPS/SSH, push from the source shadow the exact validated commit OID to
   `refs/heads/<recorded-branch>` without force, naming remote `developer-os` whose shadow config has
   that one direct URL. For local/file, no Git process runs here: perform §4.2's final real-destination
   precondition recheck and apply the already immutable, separately journaled destination-side
   object/reflog/ref promotion from its staged closure, or verify/finalize the exact zero-transition
   up-to-date effect. The source
   effect is already terminal and is never reopened or consumed by this step. No fetch, pull, merge, rebase, checkout,
   unplanned/custom remote helper, or automatic recovery is attempted; the exact level-specific process
   tree in §4.2 is the entire transport boundary.

A validation refusal removes source/destination quarantine and leaves both real object stores, the
real source index/config, refs, and both `HEAD`s unchanged. A failure during reversible apply is
compensated from the journal. Once a source commit exists, a network push failure or local destination
promotion refusal leaves that local commit intact; deleting or rewriting it would exceed the ownership
boundary. The journal reaches the durable retry-only `push_pending` state
rather than masquerading as an unfinished reversible transition. The next sync must retry the push
even if no files changed.

`SyncRecordV1` records only successful terminal outcomes:

- `pushed`, after push exits 0, with the pushed `HEAD`; or
- `no_changes`, without a commit or push, only when the scoped tree is unchanged **and** current
  `HEAD` equals the last successfully pushed `HEAD`.

If there is no successful pushed baseline, or local `HEAD` differs from it after an earlier push
failure, sync attempts a push. A failed push leaves the prior successful record unchanged. This
prevents both a false success and the dead end where a locally committed retry is mislabeled
`no_changes` forever.

### 4.5 Refusal classes

| Found state | Result |
|---|---|
| non-terminal lifecycle journal, disabled flag, incomplete lifecycle config, or missing/inactive/mismatched/drifted activation provenance | report the exact class and refuse before any Git process or network call; exact `push_pending` may retry only its bound push |
| repository absent, wrong worktree, unsafe path, or changed remote | refuse without mutation |
| source or local destination device differs from product staging | report `cross_device_git_state`; refuse before staging, journal, Git process, or network |
| unsupported repository or index format, extension, entry flag, or stage | refuse without rewriting or normalizing user Git state |
| unsupported Git/process-table identity, unsupported selected SSH identity, or unexpandable process slot | report `unsupported_git_distribution`; refuse the selected operation before real repository or network authority |
| unknown transport, user/config-supplied remote-helper syntax, executable Git config, or zero/multiple effective push URLs | refuse before network |
| changed in-repository scope fingerprint | refuse and require reconcile-mode `git enable --apply` |
| changed `brainPath` with a retained Git identity record | refuse every Git mutation; restore the recorded path or uninstall/reinitialize |
| declared or canonical tracked root outside the repository | report `scope_outside_repository`; enable/reconcile/sync refuse before mutation or Git spawn |
| scope reconcile with `push_pending`, or with local `HEAD` ahead of an established pushed baseline | refuse; user must retry or resolve the local history |
| dirty index | refuse; do not absorb the user's staged work |
| merge, rebase, cherry-pick, revert, bisect, or sequencer state | refuse; history recovery is user-owned |
| detached `HEAD` or branch different from the recorded branch | refuse; never switch it |
| unborn branch with no scoped content to commit | refuse; there is no `HEAD` or branch tip to push |
| lint or secret finding | remove quarantine; real object database, index, refs, and `HEAD` remain unchanged |
| scoped source file above 16 MiB or aggregate guarded snapshot above 1 GiB | refuse before hashing, object creation, ID reservation, or intent |
| concurrent scoped edit or stale plan | refuse and require a new run |
| process stream, idle, wall, or inherited phase budget exceeded | terminate/reap the whole group; destroy pre-intent quarantine, or retain exact `push_pending` after source publication; never record success |
| conflicting or unsafe local pack/index destination | no-replace refuses; compensate only journal-created files or require recovery with exit 6 |
| reversible Git-effect failure | compensate from the journal or require recovery with exit 6 |
| auth, unreachable, rejected, or non-fast-forward push | keep local commit, keep prior success record, return redacted recovery text |

These cases use existing CLI error classes and exit-code policy; this specification adds no new
generic error code.

## 5. Scheduled automation

### 5.1 Closed job registry and eligibility

The complete scheduled-job enum is:

| Job ID | Internal handler | Process/network allowance |
|---|---|---|
| `brain-reindex` | deterministic Brain reindex | none |
| `brain-lint` | Brain lint | none |
| `doctor` | scheduled-safe local doctor profile | none |
| `git-sync` | the §4 sync handler | §4.2 allowlisted Git transport processes; recorded destination only |

The launchd base identity and plist mapping is frozen and exhaustive. The base label is never loaded;
each installed plist uses its generated descendant defined below:

| Job ID | Launchd base label | Exact plist path |
|---|---|---|
| `brain-reindex` | `com.developer-os.brain-reindex` | `<canonical-user-home>/Library/LaunchAgents/com.developer-os.brain-reindex.plist` |
| `brain-lint` | `com.developer-os.brain-lint` | `<canonical-user-home>/Library/LaunchAgents/com.developer-os.brain-lint.plist` |
| `doctor` | `com.developer-os.doctor` | `<canonical-user-home>/Library/LaunchAgents/com.developer-os.doctor.plist` |
| `git-sync` | `com.developer-os.git-sync` | `<canonical-user-home>/Library/LaunchAgents/com.developer-os.git-sync.plist` |

`<canonical-user-home>` is the guarded canonical home of the current console user, not an environment
string. No label alias, filename override, alternate launchd domain, or additional plist is legal.

Every registry member carries literal metadata `maySpawnVendor: false`. The scheduled-safe doctor
profile omits external vendor probes; it performs only configuration, manifest, path, and local
artifact checks. The registry is exhaustively switched and its tests first assert that the enum is
non-empty and exactly the four values above, so a vacuous `every()` cannot pass the no-vendor gate.

When automation itself has matching active provenance, `brain-reindex`, `brain-lint`, and `doctor` are
eligible. `git-sync` additionally requires Git to have matching active provenance at planning time.
Enabling automation reconciles all eligible jobs at once; there is no command to install only a
chosen subset.

If Git is disabled when automation is enabled, the plan omits `git-sync`. A later `git enable` does
not mutate launchd. The user reruns `automation enable` to reconcile the newly eligible job. If Git
is disabled while an installed sync job remains, that job checks the flag before invoking Git and
records `git_disabled` with no Git process or network call; `automation status` marks it stale until
the next reconcile.

Every installed job, including the three non-Git jobs, first authenticates its generation from exact
manifest/plist/installation evidence without requiring current active provenance. Only under its
lifetime lease and global lock does it recheck `automation.enabled`, the exact automation arm,
activation/config hashes, and job eligibility. It requires `clear`; only an otherwise active
`git-sync` may accept the exact `retry_only` outcome and then may invoke only §4.4's bound retry path.
A stale installed plist with clear closure and inactive/incomplete/mismatched automation records only
`automation_disabled`; active automation with only Git ineligible records `git_disabled`. An
interrupted/non-clear state records nothing and performs no handler, Brain, Git, vendor, network, or
plist operation.

### 5.2 Schedules and reconciliation

There are no default times. Schedules use repeatable flags and a closed local-time grammar:

```text
--schedule brain-reindex=daily@02:00
--schedule brain-lint=daily@02:30
--schedule doctor=weekly@mon,03:00
--schedule git-sync=hourly@15
```

The only accepted forms are `hourly@MM`, `daily@HH:MM`, and
`weekly@mon|tue|wed|thu|fri|sat|sun,HH:MM`, with numeric ranges validated before planning. Cron,
interval seconds, natural language, time-zone overrides, unknown jobs, and duplicate flags refuse.
`launchd` interprets the normalized values in the machine's local time zone.

The first enable requires one schedule for every eligible job. Later enables preserve installed,
validated schedules unless the user supplies a replacement and require flags only for newly
eligible jobs. The resulting `AutomationConfigV1` still contains the complete reconciled eligible
set, never a partial configuration.

### 5.3 `LaunchdPlan` and internal runner

`LaunchdPlan` is the CLI display name for `LaunchdPlanPreviewV1`. The preview is side-effect-free;
`LaunchdPlanV1` is the separately allocated, internal execution interface:

```text
LifecycleFileBindingV1 = {
  participantId: FoundationTransactionIdV1 | null,
  targetPath: CanonicalAbsolutePathV1,
  expectedBeforeHash: LowerHexSha256 | null,
  afterHash: LowerHexSha256 | null
}

LaunchdManifestBindingV1 = {
  path: CanonicalAbsolutePathV1,
  statePlanHash: LowerHexSha256 | null,
  before: { state: "absent" } | { state: "present", hash: LowerHexSha256 },
  after: { state: "absent" } | { state: "present", hash: LowerHexSha256 }
}

LaunchdCalendarIntervalV1 =
  | { Minute: Integer[0..59] }
  | { Hour: Integer[0..23], Minute: Integer[0..59] }
  | { Weekday: Integer[0..6], Hour: Integer[0..23], Minute: Integer[0..59] }

LaunchdPlistDictionaryV1 = {
  Label: GeneratedLaunchdLabelV1,
  ProgramArguments: readonly [BoundedArgV1, "automation", "run", JobIdV1,
    "--scheduled", "--product-home", LaunchdScheduledProductHomeV1,
    "--generation", LaunchdGenerationV1],
  StartCalendarInterval: LaunchdCalendarIntervalV1,
  StandardOutPath: "/dev/null",
  StandardErrorPath: "/dev/null"
}

BoundedCanonicalPlistXmlV1 = exact XML serialization of LaunchdPlistDictionaryV1,
1..1048576 UTF-8 bytes with no NUL and exactly one trailing LF

LaunchdObservedLabelV1 = ClosedLaunchdBaseLabelV1 | GeneratedLaunchdLabelV1

LaunchdObservedServiceTargetV1 = LaunchdGuiDomainV1 + literal "/" + LaunchdObservedLabelV1

LaunchdGeneratedServiceTargetV1 = LaunchdGuiDomainV1 + literal "/" + GeneratedLaunchdLabelV1

LaunchdProcessEnvironmentV1 = {
  HOME: CanonicalAbsolutePathV1,
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  TMPDIR: CanonicalAbsolutePathV1
}

LaunchdProcessDirectoryIdentityV1 = {
  path: CanonicalAbsolutePathV1,
  ownerUid: EffectiveUidV1,
  mode: 448,
  dev: UInt64DecimalV1,
  ino: UInt64DecimalV1
}

LaunchdProcessIoProfileV1 =
  | { id: "query", stdinMaxBytes: 0, stdoutMaxBytes: 4194304,
      stderrMaxBytes: 1048576, wallDeadlineMs: 30000, idleDeadlineMs: 30000 }
  | { id: "mutation", stdinMaxBytes: 0, stdoutMaxBytes: 1048576,
      stderrMaxBytes: 1048576, wallDeadlineMs: 30000, idleDeadlineMs: 30000 }

LaunchdProcessArgvV1 =
  | { id: "probe_domain", profileId: "query",
      argv: readonly ["/bin/launchctl", "print", LaunchdGuiDomainV1] }
  | { id: "probe_service", profileId: "query",
      argv: readonly ["/bin/launchctl", "print", LaunchdObservedServiceTargetV1] }
  | { id: "bootstrap", profileId: "mutation",
      argv: readonly ["/bin/launchctl", "bootstrap", LaunchdGuiDomainV1,
        "/dev/fd/3"] }
  | { id: "bootout", profileId: "mutation",
      argv: readonly ["/bin/launchctl", "bootout", LaunchdGeneratedServiceTargetV1] }

LaunchdPreviewObservationProcessTableV1 = {
  schemaVersion: 1,
  id: "launchctl-macos-26.5.2-25F84-preview-v1",
  operatingSystem: { productName: "macOS", productVersion: "26.5.2",
    buildVersion: "25F84" },
  executable: { path: "/bin/launchctl", ownerUid: 0, mode: 493, size: 364448,
    sha256: "b1f2b90f349938cc4c3c9234f11cefd05545f7b4bfe9b1751ac01f1cb27d3714" },
  emptyDirectory: { path: "/private/var/empty", ownerUid: 0, mode: 493 },
  environment: {
    HOME: "/private/var/empty",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: "/private/var/empty"
  },
  profiles: readonly [LaunchdProcessIoProfileV1.query],
  argvAlternatives: readonly [LaunchdProcessArgvV1.probe_domain,
    LaunchdProcessArgvV1.probe_service],
  observationDeadlineMs: 30000,
  terminationGraceMs: 100
}

SupportedLaunchdProcessTableV1 = {
  schemaVersion: 1,
  id: "launchctl-macos-26.5.2-25F84-fd3-v1",
  operatingSystem: { productName: "macOS", productVersion: "26.5.2",
    buildVersion: "25F84" },
  executable: { path: "/bin/launchctl", ownerUid: 0, mode: 493, size: 364448,
    sha256: "b1f2b90f349938cc4c3c9234f11cefd05545f7b4bfe9b1751ac01f1cb27d3714" },
  staging: {
    root: LaunchdProcessDirectoryIdentityV1,
    home: LaunchdProcessDirectoryIdentityV1,
    tmp: LaunchdProcessDirectoryIdentityV1
  },
  bootstrapPlistFd: 3,
  environment: LaunchdProcessEnvironmentV1,
  profiles: readonly LaunchdProcessIoProfileV1[2],
  argvAlternatives: readonly LaunchdProcessArgvV1[4],
  observationDeadlineMs: 30000,
  transitionDeadlineMs: 30000,
  terminationGraceMs: 100
}

LaunchdProcessDirectorySlotV1 =
  { slot: "launchd_process_root" } |
  { slot: "launchd_process_home" } |
  { slot: "launchd_process_tmp" }

SupportedLaunchdProcessTableTemplateV1 = {
  schemaVersion: 1,
  id: SupportedLaunchdProcessTableV1.id,
  operatingSystem: SupportedLaunchdProcessTableV1.operatingSystem,
  executable: SupportedLaunchdProcessTableV1.executable,
  staging: {
    root: { slot: "launchd_process_root" },
    home: { slot: "launchd_process_home" },
    tmp: { slot: "launchd_process_tmp" }
  },
  bootstrapPlistFd: 3,
  environment: {
    HOME: { slot: "launchd_process_home" },
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: { slot: "launchd_process_tmp" }
  },
  profiles: SupportedLaunchdProcessTableV1.profiles,
  argvAlternatives: SupportedLaunchdProcessTableV1.argvAlternatives,
  observationDeadlineMs: 30000,
  transitionDeadlineMs: 30000,
  terminationGraceMs: 100
}

LaunchdPlanPreviewEntryV1 = {
  operation: "install" | "replace" | "keep" | "remove",
  job: JobIdV1,
  baseLabel: ClosedLaunchdBaseLabelV1,
  domain: LaunchdGuiDomainV1,
  productHome: LaunchdScheduledProductHomeV1,
  schedule: NormalizedScheduleV1 | null,
  plistPath: CanonicalAbsolutePathV1,
  plistBytes: BoundedCanonicalPlistXmlV1 | null,
  executablePath: CanonicalAbsolutePathV1,
  baseArgv: readonly [BoundedArgV1, "automation", "run", JobIdV1,
    "--scheduled", "--product-home", LaunchdScheduledProductHomeV1],
  logPath: CanonicalAbsolutePathV1,
  statusPath: CanonicalAbsolutePathV1,
  generationProjection: LaunchdGenerationProjectionV1 | null,
  generation: LaunchdGenerationV1 | null,
  generatedLabel: GeneratedLaunchdLabelV1 | null,
  beforeFileHash: LowerHexSha256 | null,
  beforeLiveState: LaunchdLiveStateV1,
  priorStateFingerprint: LowerHexSha256
}

LaunchdPlanPreviewV1 = {
  schemaVersion: 1,
  observationProcessTableHash: LowerHexSha256,
  mutationProcessTableTemplateHash: LowerHexSha256,
  entries: readonly LaunchdPlanPreviewEntryV1[0..4]
}

LaunchdBootstrapPlistIdentityV1 = {
  path: CanonicalAbsolutePathV1,
  ownerUid: EffectiveUidV1,
  mode: 384,
  nlink: 1,
  size: Integer[1..1048576],
  hash: LowerHexSha256,
  dev: UInt64DecimalV1,
  ino: UInt64DecimalV1
}

LaunchdBootstrapSnapshotCreationV1 = {
  effectId: LaunchdEffectIdV1,
  planHash: LowerHexSha256,
  direction: "forward" | "reverse",
  transitionIndex: Integer[0..7],
  role: "before" | "after",
  source: LaunchdBootstrapPlistIdentityV1,
  path: exact `staging.tmp.path + "/bootstrap-plist"`,
  snapshot: {
    ownerUid: EffectiveUidV1,
    mode: 384,
    nlink: 1,
    size: Integer[0..1048576],
    dev: UInt64DecimalV1,
    ino: UInt64DecimalV1,
    bytes: BytePrefixOf<the exact plan-bound canonical plist bytes selected by role>
  }
}

LaunchdBootstrapSnapshotAttemptV1 = {
  role: "before" | "after",
  source: LaunchdBootstrapPlistIdentityV1,
  formerPath: CanonicalAbsolutePathV1,
  snapshot: {
    ownerUid: EffectiveUidV1,
    mode: 384,
    nlink: 0,
    size: Integer[1..1048576],
    hash: LowerHexSha256,
    dev: UInt64DecimalV1,
    ino: UInt64DecimalV1
  },
  inheritedFd: 3
}

LaunchdPlanEntryV1 = LaunchdPlanPreviewEntryV1 + {
  bootstrapPlists: {
    before: LaunchdBootstrapPlistIdentityV1 | null,
    after: LaunchdBootstrapPlistIdentityV1 | null
  }
}

LaunchdPlanV1 = {
  schemaVersion: 1,
  planHash: LowerHexSha256,
  previewHash: LowerHexSha256 | null,
  coordinatorId: LifecycleCoordinatorIdV1,
  coordinatorOperation: "automation_enable" | "automation_reconcile" |
    "automation_disable" | "uninstall",
  processTableHash: LowerHexSha256,
  config: LifecycleFileBindingV1,
  activation: LifecycleFileBindingV1 | null,
  plistFiles: readonly LifecycleFileBindingV1[0..4],
  manifest: LaunchdManifestBindingV1,
  beforeFilesEffect: { id: LaunchdEffectIdV1, planHash: LowerHexSha256 } | null,
  afterFilesEffect: { id: LaunchdEffectIdV1, planHash: LowerHexSha256 } | null,
  entries: readonly LaunchdPlanEntryV1[0..4]
}
```

The plist renderer has one byte grammar. It emits the XML declaration
`<?xml version="1.0" encoding="UTF-8"?>`, then literal
`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`, then
`<plist version="1.0">`, one root `<dict>`, and the closing tags, with each tag/value on its own LF-
terminated line and exactly two ASCII spaces per nesting level. Root keys occur exactly in the schema
order above. `ProgramArguments` is one `<array>` of nine `<string>` elements in tuple order.
`StartCalendarInterval` is one `<dict>`: hourly emits only `Minute`; daily emits `Hour`, then `Minute`;
weekly emits `Weekday`, then `Hour`, then `Minute`. Integers use unsigned base-10 with no leading zero.
The weekday map is exactly `sun=0`, `mon=1`, `tue=2`, `wed=3`, `thu=4`, `fri=5`, `sat=6`; the stored
normalized schedule's `mon..sun` arm maps through that table. String text is valid XML-1.0 scalar
text encoded directly as UTF-8 except that every `&`, `<`, and `>` is respectively emitted as
`&amp;`, `&lt;`, and `&gt;`; CDATA, numeric entities, alternate named entities, BOM, CR, tabs used as
indentation, self-closing tags, comments, and insignificant extra whitespace are forbidden.

No other dictionary key is legal. In particular `RunAtLoad`, `KeepAlive`, `StartInterval`, sockets,
watch paths, environment variables, working directory, user/group, resource limits, Mach services,
and alternate output paths refuse. Both output paths are the literal platform null sink, so handler
output can reach only the runner's redacted structured-log path. Parsing a retained plist reconstructs
exactly `LaunchdPlistDictionaryV1`, maps its calendar dictionary back to the one normalized schedule,
and requires byte-identical re-rendering; the bounded parser recognizes the literal doctype but never
loads a DTD, resolves an external entity, expands a caller-defined entity, or performs a network/file
lookup. Semantically equivalent but differently serialized XML is drift, not an alternate canonical
form.

`planHash` is SHA-256 over `developer-os:launchd-plan:v1\0` plus canonical JSON of every field except
`planHash`; `previewHash` equals the enclosing execution plan's value, non-null for automation's
plan/apply operations and null for uninstall. The preview's
`mutationProcessTableTemplateHash` is SHA-256 over
`developer-os:launchd-process-table-template:v1\0` plus exact canonical JSON of
`SupportedLaunchdProcessTableTemplateV1`. De-slotting the allocated table must reproduce that exact
template before the expanded execution hash below is admitted. Its
`observationProcessTableHash` is SHA-256 over
`developer-os:launchd-preview-observation-table:v1\0` plus exact canonical JSON of
`LaunchdPreviewObservationProcessTableV1`.
`processTableHash` is SHA-256 over `developer-os:launchd-process-table:v1\0` plus the exact expanded
`CanonicalJsonV1` bytes of `SupportedLaunchdProcessTableV1`. The same digest appears in every non-null
before/after-files `LaunchdEffectPlanV1`; a mismatch refuses before a query or mutation. The table's
profiles and argv alternatives are exact-key, unique, and ID-sorted. `staging.root.path` is exactly
`<product home>/staging/lifecycle/<coordinator-id>/launchd-process`; `staging.home.path` and
`staging.tmp.path` are its exact `home` and `tmp` children. The root is owner-only and contains exactly
those two guarded child directories; both children are distinct, owner-only, initially empty, and
empty at every process boundary. Only §2.4's current-frontier
`LaunchdBootstrapSnapshotCreationV1` may temporarily occupy `tmp` between those boundaries.
`environment.HOME == staging.home.path` and `environment.TMPDIR == staging.tmp.path`; no inherited
environment key is present. Each directory's path, effective owner, decimal mode `448`, `dev`, and
`ino` are fixed before the process-table hash. Before every process and after complete reaping, the
adapter reopens all three identities without following links, recomputes the expanded table and hash,
requires the root's exact two-child set, and proves both children empty. The measured pinned row
creates no child in either directory; at a process boundary any child, extra root entry, or identity/hash drift refuses and
is retained by §2.4's staging grammar. Planning requires the effective UID to equal the validated current console
user, encodes that one UID into every `LaunchdGuiDomainV1`, and refuses alternate `system`, `user`,
`login`, PID, or differently numbered GUI domains. The platform adapter rechecks the selected macOS
build and guarded root-owned `/bin/launchctl` path, mode, size, and hash before every process; a changed
OS row or same-path different executable is `unsupported_launchd_distribution` before live authority.
Default preview observes live state only through the preview observation row. It guarded-opens the
canonical root-owned mode-0755 `/private/var/empty` directory without following links, requires it
empty before and after every query, uses it as both non-writable `HOME` and `TMPDIR`, and runs only the
two `print` alternatives. The row stores no directory device/inode, no allocated path, and no caller
home. Any write attempt fails in the root-owned directory; any new child or identity/path/type/mode
change refuses. Thus default preview may make bounded read-only launchctl observations but creates no
product or temporary state. Apply repeats those observations to revalidate `previewHash` before it
allocates the mutation table's private staging identities.
The pinned row is supported only after an isolated certification fixture for that exact OS build and
`/bin/launchctl` identity proves that `bootstrap gui/<uid> /dev/fd/3` reads an inherited descriptor
whose private snapshot has already been unlinked, loads the plist's generated label, and leaves no
descendant, open descriptor, or staging child. A fixture failure or missing certification is
`unsupported_launchd_distribution`; the adapter never substitutes the mutable plist pathname or a
still-linked snapshot.

Before any forward or reverse bootstrap, the adapter guarded-opens the exact plan-bound plist with
no-follow semantics and verifies its `LaunchdBootstrapPlistIdentityV1`, hash, generated Label, and
ProgramArguments. The owning effect journal must already durably name the exact current forward
`applied` or reverse `compensating` frontier, and a fresh live probe must equal that direction's
command preimage. The adapter then creates exactly
`staging.tmp.path + "/bootstrap-plist"` with guarded `O_CREAT | O_EXCL | O_NOFOLLOW`, mode 0600,
records its reopened identity as `LaunchdBootstrapSnapshotCreationV1`, and streams the exact bounded
plan bytes from that still-open source descriptor into the private leaf. Every reachable interrupted
write is therefore an empty, partial, or complete prefix of the one plan-bound canonical plist and no
larger than 1 MiB.

Recovery under the global and effect-stable locks admits that one linked leaf only when the same
journal frontier is still current, the source identity/bytes reverify, the live state is still the
directional command preimage, and path/role/effect/plan/transition/owner/mode/link/size/device/inode
all derive exactly. It bounded-reads the leaf only after those checks. An empty or proper partial
prefix is guarded-unlinked by the reopened inode, `tmp` is synced, and creation restarts. A complete
byte-identical prefix may resume at sync/open verification. A non-prefix, over-limit, second/unknown
leaf, changed identity, wrong frontier, or non-preimage live state is preserved recovery-required.
Because spawn occurs only after unlink, a linked creation leaf proves launchctl did not consume that
snapshot; recovery never infers command success from it.

The complete leaf is synced, verified against the planned hash and canonical plist semantics, and
opened with `O_CLOEXEC`. The adapter rechecks the
source plist, unlinks the exact snapshot inode, and syncs the temp directory. The still-open snapshot
must then have `nlink == 0`; the adapter seeks to byte zero, re-hashes the unlinked bytes, and constructs
`LaunchdBootstrapSnapshotAttemptV1`. Because the temp directory is guarded owner-only and the name is
gone before spawn, a rename, replacement, or in-place write to the real plist cannot change what
`/dev/fd/3` reads. The temp directory is again entry-empty before the process starts.

A death after opening but before unlink leaves the same complete linked creation state; a death after
unlink but before spawn drops the unlinked inode with the process and leaves empty staging, so recovery
creates a fresh snapshot from the unchanged frontier. No linked snapshot is ever inherited.

The snapshot descriptor is `O_CLOEXEC` in the parent. The spawn file actions duplicate that exact
open description to child FD 3, clear close-on-exec only for FD 3, close the child's source duplicate,
and close every other non-standard child descriptor. The parent closes its source plist descriptor
after snapshot construction and closes its snapshot descriptor immediately on every spawn return,
throw, timeout, success, or failure; the child owns only FD 3 until launchctl exits and is reaped.
Process intent and transcript bind role, fixed FD, source path/hash/size/mode/device/inode, former
snapshot path, and snapshot hash/size/mode/device/inode/nlink. After the live-state observation, the
adapter reopens and rechecks the real source plist; drift is recovery-required after intent even
though the loaded bytes remain attributable to the safe snapshot. Open-FD count must return to the
pre-attempt baseline after every outcome.

`bootstrapPlists.before` is non-null exactly when compensation may reload the preimage, and `after` is
non-null exactly when forward execution may load the postimage; `keep` binds the same source identity
in both arms, while install/remove respectively require only after/before. A retry or reverse recovery
never tries to reopen an earlier unlinked snapshot: if live observation is still the transition
preimage it creates a fresh snapshot from the immutable plan and reverified source; if postimage it
records the observation without a bootstrap; every other state refuses.

Coordinator ID/operation match the enclosing immutable coordinator plan. Every lifecycle
file binding with a non-null `participantId` matches one exact mutation in its named forward Foundation
ref, including target, preimage hash, and after hash; `plistFiles` is unique/sorted by target path. A
null participant is legal only for `automation_reconcile/live_only`: `config` and `activation` both
name their exact current guarded regular files with equal non-null before/after hashes, and
`plistFiles` is empty. The manifest binding with a non-null `statePlanHash` matches the exact
`ManifestStatePlanV1` path/tagged hashes and its domain-separated plan hash. A null hash is legal only
for `live_only`, whose before/after are the same exact present guarded manifest and which has no
coordinator manifest arm. Effect
bindings match the position-tagged participant IDs/hashes and are null exactly where §2.4's operation
table omits `P` or `Q`. `config` is non-null for every plan and binds the exact automation publication
or uninstall removal, except that `live_only` binds its exact observed preserved bytes. Automation
enable, reconcile/files, and disable bind their activation mutation; `live_only` binds the exact
observed preserved activation file; uninstall binds it exactly when the activation artifact exists.
Every mutated plist binds its exact Foundation mutation. Each `live_only` entry instead binds its
retained plist bytes through `beforeFileHash`, `plistBytes`, generated-label projection, and the `Q`
transition selected by the exhaustive table below.
Apply accepts only this coordinator-embedded plan and recomputes all
cross-bindings before any Foundation or launchd participant starts.

Automation enable/reconcile entries equal the complete eligible registry (three entries, or four when
Git sync is eligible); automation disable entries equal the complete installed automation set; and a
present-manifest uninstall entry set equals its complete manifest-owned launchd set and may be empty.
No operation may omit an affected job or add an unaffected one.

Entries are sorted in closed job-registry order and contain, for every install, replace, keep, or
remove operation:

- the closed job ID, stable base label, and plan-derived generated label;
- normalized calendar schedule;
- exact plist path and bytes;
- exact trusted Developer OS executable and argv;
- exact log/status paths; and
- the prior-state fingerprint used by apply.

Install/replace/keep require non-null schedule/plist bytes, projection, generation, and generated
label; remove requires all five null. For a present postimage, `productHome` is the guarded canonical
product home from the coordinator authority and `baseArgv` is exactly
`[executablePath, "automation", "run", <job-id>, "--scheduled", "--product-home", productHome]`;
`generation` is SHA-256 over
`developer-os:launchd-generation:v1\0` plus the exact `CanonicalJsonV1` bytes of
`generationProjection`; `generatedLabel` is `baseLabel + ".g." + generation`; and the projection must
equal the entry's job/base label/domain/schedule/product-home/plist/executable/base argv/log/status
fields. The plist
must encode that generated label and ProgramArguments equal to `baseArgv` followed by exact
`--generation <generation>`, and its bytes must hash to the matching file binding/effect
transition. `priorStateFingerprint` hashes `developer-os:launchd-prior-state:v1\0` plus canonical JSON
of job, base label, domain, plist path, `beforeFileHash`, and `beforeLiveState`. Alternate bytes,
generations, IDs, paths, effects, config, activation, manifest, or coordinator values make apply refuse
rather than recalculate a different plan.

Each plist invokes only the internal hidden runner
`developer-os automation run <job-id> --scheduled --product-home <canonical-product-home>
--generation <generation>`. Before constructing the ordinary CLI context, a closed scheduled-mode
bootstrap parser accepts exactly this position and spelling, guarded-resolves the supplied product
home without following its leaf, and uses it as the sole product-home authority. Scheduled mode
derives the canonical user home from the validated console-user/effective-UID platform record and
defers Brain-root resolution until an active stage-2 handler branch; it ignores ambient `HOME`,
`DEVELOPER_OS_HOME`, and `DEVELOPER_OS_BRAIN`. Interactive commands do not accept this hidden
argument, and arbitrary argv is never dispatched.

Scheduled admission is deliberately two-stage. Stage 1 is installation authentication, independent
of current active eligibility: guarded manifest evidence must own the exact plist path/hash, canonical
plist parsing must reproduce the supplied generation and the closed job/base-label/domain/product-
home/executable/argv/log/status projection, and the executable identity must be the supported installed
Developer OS binary. It does not require an active activation arm or a currently matching config hash.
A missing/drifted plist, absent/unowned manifest entry, wrong generation, path, executable, or
projection refuses before a status/runtime record, handler, Brain read, Git process, or network call;
without installation evidence a stale launchd invocation has no write authority.

Stage 2 occurs only while holding the authenticated job's lifetime lease and global lock. It loads the
strict current configuration, journal closure, activation record, manifest, and current job
eligibility and rechecks the stage-1 evidence. Exact active/matching state may dispatch the closed
handler. Disabled, inactive, incomplete, or configuration/provenance-mismatched automation may write
only the fixed `automation_disabled` status; active automation whose installed `git-sync` alone became
Git-ineligible writes only `git_disabled`. Either uses the stage-1-bound status path and exits without a Brain,
Git, vendor, handler, or network effect. The runner does not require a compacted terminal coordinator
plan in either branch; retained manifest/plist installation evidence authenticates the generation,
while current provenance decides active versus inert behavior.
`StandardOutPath` and `StandardErrorPath` do not point at product
logs: launchd output is directed to the platform null sink so unredacted handler output cannot bypass
the runner. The runner captures structured handler results, redacts them in memory, and only then
writes bounded product logs and status.

Tests first prove that printing `LaunchdPlanPreviewV1` is byte-inert, then apply its hash-bound,
allocated execution plan through an injected filesystem and launchd runner and assert exact plist
bytes, descriptor bindings, argv, configuration, and manifest entries. Unit and integration tests
never install, load, unload, or inspect a job on the founder's real machine; descriptor-backed
bootstrap certification runs only in a disposable pinned macOS environment with a unique fixture
label.

Apply uses §2.4's position-tagged `LaunchdEffectPlanV1` participants: the before-files plan contains
all required unloads and the after-files plan all required loads/reloads, so neither journal is
consumed on both sides of a plist/manifest publication. Each journals its exact live-state transition.
The manifest postimage records only plists and activation-record bytes already written and
verified; if a later label transition fails, the coordinator restores that manifest postimage along
with those files. The final config transaction publishes automation as enabled only after every
eligible plist and live label matches the preview-bound execution plan. Failure
restores prior plist bytes, activation record, manifest/config state, and
loaded/unloaded labels in reverse order; failed compensation is recovery-required rather than a
partial success reported as enabled.

`automation_reconcile/live_only` has no file, activation, config, or manifest transaction to restore.
It revalidates all preserved bindings before `Q`, applies only the bound load transitions, and reaches
its point of no return only when `Q` is durably `verified`. Before then compensation bootouts only the
generations loaded by that participant; afterward recovery can only finalize `Q` and compact the
coordinator ledger. The zero-transition case still validates all bindings and completes the same
participant protocol without issuing a launchctl command.

Launchd generation observation is exact and does not pretend launchd exposes plist bytes or that a
caller's implicit bootstrap namespace selects a GUI domain. The adapter first runs literal
`/bin/launchctl print <LaunchdGuiDomainV1>` and requires exit 0 under the exact query profile. For each
job it then probes, in unsigned UTF-8 target order, only the closed candidate set: the unsuffixed base
label, the generated label reconstructed from exact retained plist bytes whose hash is manifest-bound
when one exists, the
plan's generated postimage label when one exists, and any distinct generated label recorded in the
current effect preimage/postimage. Each probe is literal
`/bin/launchctl print <LaunchdGuiDomainV1>/<candidate-label>`. After the domain probe succeeds, exit 0
means that exact service target is present and exit 113 means absent; every other status is
unobservable/refused. Output is byte-counted and discarded without parsing, hashing, logging, or
persistence because `launchctl print` may expose unrelated service environment. A base-label presence,
both old and new candidate generations present, or any candidate inconsistent with the selected
transition is a foreign third state. Exactly the expected generated candidate present is `loaded {
label, generation }`; none of the owned candidates present is `unloaded`.

After deduplication the candidate set has one to three targets per job. A complete four-job planning
observation therefore admits at most one domain probe plus twelve service probes and shares one absolute
30,000-ms observation deadline; no per-job or per-probe restart extends it.

There is deliberately no prefix enumeration. Every generation Developer OS can have produced is
recoverable from the guarded plist, manifest, immutable coordinator/effect plan, or retained journal;
an arbitrary different `baseLabel + ".g."` service is not product-owned and grants no bootout authority.
If drift or missing retained evidence prevents reconstruction of a previously installed generated
label, planning returns `lifecycle_recovery_required`; it may not call that state unloaded or proceed to
disable/uninstall. This is fail-closed evidence loss, not permission to enumerate or unload a prefix.
The hidden runner separately authenticates the supplied generation from exact retained
manifest/plist/install evidence at stage 1 without requiring current active provenance; provenance is
consulted only under the stage-2 locks to choose handler execution versus the two inert status arms.
An exact collision with a retained, planned, or journaled label is observed and preserved as the third
state above. Each forward/reverse command is followed by the same domain-targeted candidate probes
until the one expected state appears or the shared transition deadline expires.

All `print`, `bootstrap`, and `bootout` processes use the hash-bound table, empty stdin, exact sanitized
environment, counted stdout/stderr proxies, and a fresh process group; the table admits no descendant.
One forward or reverse transition has one absolute 30,000-ms budget spanning its mutation command and
all follow-up probes, and no process or polling attempt resets it. Crossing a stream, idle, process-wall,
or transition deadline closes the proxies, sends SIGTERM to the whole group, waits exactly 100 ms,
sends SIGKILL if any member remains, and reaps every child. Failure to terminate/reap is
`lifecycle_recovery_required`. Bootstrap additionally follows the FD-ownership protocol above before
the attempt is considered reaped; proxy closure never substitutes for closing source/snapshot/FD-3
ownership. A planning/domain observation failure before coordinator intent removes private staging
and refuses unchanged. Once coordinator intent exists, any query/mutation failure or
overrun retains the exact effect journal at its current cursor and exits recovery-required; the next
recovery invocation must re-probe the bound service targets and may recognize only the recorded
preimage or postimage before resuming/compensating. It never infers command success from exit status and
never holds the global mutation lock past the bounded termination/reap protocol.

The file/live transition table is exhaustive:

| Entry state | `P` before files | Foundation plist step | `Q` after files | Reverse order before the point of no return |
|---|---|---|---|---|
| `install` from unloaded | none | create exact new generated plist | `bootstrap gui/<uid> /dev/fd/3` with the bound already-unlinked private snapshot of the new plist; the real source descriptor is never inherited; unloaded → new generated label | bootout new label, then remove created plist |
| `replace` from loaded old generation | `bootout gui/<uid>/<old-generated-label>`; old → unloaded | replace old plist with exact new generated plist | unlinked-snapshot bootstrap new; unloaded → new | bootout new, restore old plist, unlinked-snapshot bootstrap old |
| `replace` from unloaded | none | replace old file with exact new generated plist | unlinked-snapshot bootstrap new; unloaded → new | bootout new, restore old file; live state remains unloaded |
| `keep` already loaded at new generation | none | no plist mutation | none | none |
| `keep` but currently unloaded | none | no plist mutation | unlinked-snapshot bootstrap of the exact retained generated plist | bootout that generation |
| `remove` from loaded old generation | bootout old; old → unloaded | remove exact old plist | none | restore old plist, unlinked-snapshot bootstrap old |
| `remove` from unloaded | none | remove exact old plist | none | restore old plist; live state remains unloaded |

Every command argv above is literal and plan-bound. A `keep` entry with any loaded generation other
than its generated postimage, a replace/remove live label not equal to `beforeLiveState`, or any state
outside the row selected before intent refuses. This table determines the exact `P`/`Q` transitions,
their plist hashes, and compensation commands; there is no loaded→loaded effect transition.

### 5.4 Run results, locking, and bounded logs

Every scheduled invocation follows this order:

1. validate the fixed job ID and check guarded `UninstallingMarkerV1` at exact
   `state/uninstalling.json` before loading configuration or writing any runtime record; if present,
   exit 0 silently;
2. guarded-open the pre-created exact `AutomationRunnerLeaseV1` path without following links, acquire
   it non-blockingly, and recheck both path `dev`/`ino` and the marker. A busy same-job lease exits 0
   silently. If the path is absent or its identity was replaced, the runner performs one bounded,
   process-free recheck of the marker, manifest automation arm, and `LifecycleJournalClosureV1`. It
   exits 0 silently only when the marker is present, the manifest is absent, or closure is the exact
   `uninstall_draining` coordinator whose verified `F(uninstall_artifacts)` state removed this bound
   lease path. With a still-present manifest and no such exact uninstall proof, an active/inactive or
   malformed arm cannot explain a missing/replaced lease and is recovery-required. A merely missing
   path never manufactures uninstall authority. Hold an acquired matching descriptor through every
   remaining exit;
3. authenticate the scheduled generation from the exact guarded manifest-owned plist, its canonical
   projection, current installed executable, and the closed job registry as §5.3 stage 1 requires.
   This step deliberately does not require active current configuration/provenance and does not write
   a status or invoke a handler;
4. acquire the global lock while retaining the lease, waiting at most ten minutes as defined in §2.3;
   at the deadline make the
   one final non-blocking acquisition attempt. If it fails, exit 0 silently. If it succeeds, recheck
   `state/uninstalling.json`, closure, stage-1 installation evidence, current provenance, and the lease-
   path identity under that lock. Marker-present or non-clear closure exits silently. Exact active
   eligible state writes `skipped_lock_timeout`; disabled/inactive/incomplete/mismatched automation
   writes only `automation_disabled`; active automation with only `git-sync` Git-ineligible writes
   only `git_disabled`. Each uses one Foundation transaction and then releases the lock and exits;
5. when the global lock was acquired before its deadline, recheck `state/uninstalling.json`,
   `LifecycleJournalClosureV1`, stage-1 installation evidence, strict configuration, automation
   provenance, lease identity, and job
   eligibility, including the Git flag before any Git spawn; a present marker or non-clear journal
   closure exits silently without a status write, except that `git-sync` with its exact `retry_only`
   outcome may proceed solely to §4.4's bound retry; disabled, inactive, incomplete, malformed-config,
   or mismatched activation/config state records only `automation_disabled` under the already-held
   lease/runtime-record lock; active automation with only `git-sync` Git-ineligible records only
   `git_disabled`. Either exits without resolving the Brain root or invoking a handler;
6. invoke the internal handler under its process/network policy;
7. redact the structured result in memory;
8. still under the global lock, recheck `state/uninstalling.json` and
   `LifecycleJournalClosureV1`; only when the marker is absent and closure is `clear`, use the already-
   held per-job lease/runtime-record lock and one Foundation transaction to rotate/write the bounded log and replace
   that job's status record. `retry_only`, `uninstall_draining`, and
   `lifecycle_recovery_required` all exit silently without a log/status write; and
9. release the global lock, then release the runner lease only at process exit.

Each job has one current log and nine rotations, each at most 1 MiB after redaction and bounded
truncation. Rotation names are fixed manifest `ephemeral` paths; no directory scan decides what to
move or delete. Status records distinguish success, handler refusal/failure, `git_disabled`, and
`automation_disabled`, and `skipped_lock_timeout`; they record timestamps and safe reason codes rather
than raw command output. Normal log and status transactions occur while the global lock is held. The
timeout branch never rotates a log and already holds the lifetime lease before it acquires the global lock.
Transaction staging/temp paths are product-owned, exact, guarded, and removed on finalize or recovery.

`automation disable` is plan-only by default. `automation disable --apply` unloads and removes all
installed Developer OS plists transactionally, publishes the automation activation arm as inactive
with its manifest hash, and sets automation disabled, but preserves schedules, logs, and status
records. It does not disable Git. `automation status` reports configured versus
installed state, plist drift, stale eligibility, and last-run outcome without repairing anything.

## 6. Uninstall behavior

Before it plans any removal, uninstall applies Foundation's declared-and-canonical ownership
partition to every manifest entry. The normal removable universe remains product home with the Brain
excluded, so every Brain-located artifact is preserved regardless of owner, manifest mode, or config
drift. DOS-P7 adds only a closed external-file authorization for each installed automation plist: the
manifest entry must be the exact path derived from a closed Developer OS label under the canonical
user `Library/LaunchAgents` directory, have owner `macos`, kind regular file, mode `content`,
`existedBefore: false`, and match its installed hash with no symlink at any component. Any other
out-of-home artifact is preserved and reported. Live launchd labels are governed separately by
`LaunchdEffectPlanV1`; neither the manifest nor that plan grants a general external root.

Uninstall uses a two-phase drain so it never waits for a runner while holding the global lock that the
runner itself needs:

1. Take the global mutation lock. Create and verify manifest-owned `UninstallingMarkerV1` at exact
   `state/uninstalling.json` through
   the composite journal,
   unload every manifest-owned Developer OS label through `LaunchdEffectPlanV1`, verify the labels are
   disabled, then release the global lock. A runner that already holds its lifetime lease either
   finishes before marker publication while it owns the global lock or observes the marker after this
   release; no handler/status write can cross marker creation.
   Failure before release compensates the unloads and marker in reverse order or leaves an exit-6
   journal.
2. With no global lock held, acquire every exact `AutomationRunnerLeaseV1` in canonical job-ID order
   under one absolute ten-minute drain deadline and retain all acquired descriptors. A runner that
   began before the marker but was waiting for the global lock can now acquire it, must recheck the
   marker, and exits without handler, log, or status effects before releasing its lease. A runner
   paused after its initial marker check but before lease acquisition either finds the held lease busy,
   or later finds its exact path absent; in the latter case its mandatory marker/manifest/closure
   discriminator proves the marker, manifest absence, or this coordinator's exact
   `uninstall_draining` lease-removal state before it exits silently.
   Acquiring all four lifetime leases, together with disabled exact launchd labels, proves the closed
   runner set empty without inspecting a process list. Timeout releases any acquired leases and is
   recovery-required, not permission to remove live state.
3. While holding all four leases, reacquire the global lock and revalidate the same marker, disabled
   labels, lease path identities, manifest, config, ownership partition, and every planned path.
   Within the removable partition only, restore every migratable manifest artifact with
   `existedBefore: true`; remove exact product-created `content`/`schema` artifacts other than the
   lifecycle nonce/allocator retained for terminal coordinator compaction, plus present `ephemeral`
   paths including sync status, job status, and every enumerated log slot. The Foundation participant
   reopens each held lease inode, removes its exact path while the descriptor remains locked, verifies
   absence, and only then releases the descriptors; no runner creates a replacement path. Remove
   `state/uninstalling.json` last among this Foundation
   participant's artifacts. For the
   one approved non-manifest redaction-key path, do not read, hash, copy, or journal its bytes. If it is
   absent, record the clean absent state. If it is a guarded regular file, require the exact journal-owned
   sibling tombstone to be absent, record only its type/owner/mode/link-count/size/device/inode identity, atomically rename it to
   that tombstone in the same owner-only directory, sync the directory, and verify original-absent plus
   matching-tombstone-present. A symlink, wrong type, collision, or third state refuses/requires recovery.
4. With every paired inverse Foundation plan and its independently staged preimage, the secret-opaque
   key tombstone, and the coordinator journal still present,
   apply the uninstall
   `ManifestStatePlanV1` absent postimage: atomically no-replace-move the current manifest to its exact
   journal-owned sibling tombstone, sync the parent, verify the preserved inode/bytes equal the planned
   preimage, verify the original leaf absent, then durably record committed absence. A moved third state
   is preserved and restored only by no-replace as defined in §2.4. This durable phase transition commits
   uninstall. Recovery before it may restore the key and manifest only by their identity-matching
   no-replace renames to still-absent exact source paths; it never reads or copies key bytes. Recovery at
   or after committed manifest absence first requires the original manifest leaf still absent; a third
   state is preserved with exit 6. Otherwise recovery only
   force-forwards: guarded-unlink the identity-matching tombstone without reading it, sync its parent,
   verify both key paths absent, finish remaining cleanup, guarded-unlink the exact preserved manifest
   tombstone, sync its parent, and finalize the composite journal. Before
   manifest absence, both paths absent when the prior key was present is exit 6; after manifest absence,
   that same state is the planned terminal deletion. Both paths present, a restored source after the
   point of no return, or any identity mismatch is always exit 6. Only after terminal finalize may empty
   product directories and coordinator recovery material be removed.

`uninstall/absent_manifest` is admitted only by a complete bounded product-home inventory and exact
key-only/no-install-evidence proof under §2.3's bootstrap lock; it does not create or acquire the
permanent global lock. Starting from a guarded product-home parent, the preflight and post-lock
no-follow walkers each visit at most 1,000,000 directory entries, 128 components, and 4096 UTF-8 path
bytes; names must be valid UTF-8, unique, and free of NUL, slash, backslash, `.`/`..`, while every
visited directory must be owned by the effective user. A symlink, hard-linked regular file, special
entry, owner/identity change, invalid name, limit overrun, or entry appearing/disappearing during the
walk is recovery-required before any regular-file content is read, ID is allocated, or path is
renamed or deleted.

Fresh preflight accepts exactly four external inventory shapes: product home absent; product home
present with zero entries; product home containing only an empty guarded `state` directory; or
product home containing only that `state` directory whose sole child is the guarded exact
`state/redaction.key`. The key-only arm records only `SecretOpaqueFileStateV1`; it never reads or
hashes key bytes. After bootstrap acquisition, the complete second inventory must reproduce that same
shape after projecting away only the exact `LifecycleBootstrapLockV1` and exact attempt-created empty
directory identities. A crash-retained exact bootstrap leaf may be locked and projected away under
the same rule; it never excuses another child. Every other known or unknown file **or directory**,
including `config.toml`, activation,
sync/marker/status/log/lease state, lifecycle/Foundation recovery material, staging, backups, or an
unrecognized empty directory, preserves the complete tree and returns recovery-required. The four
closed external plist paths must independently be absent. This exhaustive root inventory, rather than
a checklist of selected known paths, is the proof that deleting the non-manifest key cannot erase the
last evidence of another product artifact.

A resume candidate is separate from those four fresh shapes. Preflight may provisionally admit only
one syntactically closed flat bootstrap envelope in a `state` directory with no unrelated entry: the
exact bootstrap leaf; the nonce/allocator state described below, including at most one
`LifecycleBootstrapCreationTempV1` during first creation, the §2.4 allocator-rewrite reservation
state, or the control-file compaction microstate; at most one final-or-temp plan; and a journal state
of absent, one initial temp with no final,
one final with no temp, or one final plus one exact post-intent rewrite temp; and
exactly the original key or its exact `.redaction.key.<coordinator-id>.tombstone` before deletion, or
neither only at/after the journal's durable delete cursor. The existing
`LifecycleCoordinatorPlanV1` and `LifecycleCoordinatorJournalV1` paths are respectively
`state/.lifecycle-absent-uninstall.<coordinator-id>.plan.json` and
`state/.lifecycle-absent-uninstall.<coordinator-id>.json`. Their exact publication/rewrite temps are
`state/.<coordinator-id>.<lowercase-v4-uuid>.plan.json.tmp` and
`state/.<coordinator-id>.<lowercase-v4-uuid>.json.tmp`, matching §2.4's hidden temp grammar. There is no coordinator staging directory or
independent coordinator lock: the already-held bootstrap descriptor is this envelope's stable lock.
After acquiring and identity-rechecking it, the second complete inventory must be byte-for-byte the
same candidate shape before any bounded file is parsed. The nonce/allocator state derives the sole
possible ID once reservation is durable; every final/temp name, plan authority, exact two-step
variant, key/tombstone identity, phase,
cursor, maximum, and canonical byte/hash relation must then validate in both directions. A
plan-without-journal is legal only before first key intent or as the terminal plan-last compaction
suffix; journal-without-plan, a second ID, any temp combination outside those exact arms, a normal
four-root ledger, any other leaf, or any
identity change is preserved recovery-required. Thus bootstrap recovery is closed without adopting a
fifth ledger root or granting authority from filenames alone.

Once the flat final journal exists, every atomic cursor/phase rewrite may coexist after a crash with
at most one exact journal rewrite temp above. The bootstrap descriptor substitutes for the ordinary
stable coordinator lock. Recovery requires the guarded final journal to remain canonical, plan-hash-
bound, within its exact `maximumJournalBytes`, and unchanged after proving no active writer. The temp
must be an owner-owned 0600 single-link regular file with reopened device/inode identity and size
`0..maximumJournalBytes` within the 1-MiB parser ceiling. Its bytes may be empty, partial, or complete:
the still-valid final is authoritative until rename. Recovery guarded-unlinks only that exact temp,
syncs `state`, rechecks final/plan/bootstrap identities, and recomputes the intended rewrite from the
authoritative journal. Final-plus-two-journal-temps, final-plus-plan-temp, a rewrite temp without its
required final, any journal temp without the final plan, wrong metadata/size/name, or any identity
change is preserved recovery-required. This cleanup runs
before interpreting or advancing the flat coordinator cursor, including every terminal compaction
rewrite.

Fresh admission is process-free: it reserves no ID, creates no launchd-process staging, and spawns no
`launchctl` query. Base labels are never product-owned service instances; only a generated label
derived from retained config/activation/plist/manifest/plan/journal evidence can be owned. With all
such evidence absent there is no generated target to query or unload, while an arbitrary base or
generation-prefix label remains unowned and is neither enumerated nor booted out. Any present/drifted
evidence or a missing retained value needed to derive a previously installed generated label is
recovery-required and preserved; it cannot be reclassified as unloaded or as this no-launchd variant.

Under that proof, `key_absent` is an allocation-free clean no-op: while still holding bootstrap it
unlinks the exact bootstrap inode, syncs the parent, removes only attempt-created identity-matching
empty directories, releases the descriptor, and returns without an ID, permanent lock, coordinator,
plan, or `K` step. A non-crashing attempt leaves no file or control residue; after a crash it may
preserve only §2.3's exact empty directory skeleton. A guarded present key is the sole admitted
non-control leaf and derives only
`uninstall/absent_manifest/key_present`; its exact redaction-key participant force-forwards it to
absent, and manifest absence is already that variant's point of no return. When the key is present but both nonce
and allocator are absent, the same proof first establishes no recovery evidence, then creates one
guarded recovery-only nonce/allocator epoch by the CSPRNG/schema protocol. Publication is ordered
nonce then allocator. Each temp is atomically created with `O_CREAT | O_EXCL | O_NOFOLLOW` under the
identity-rechecked `state` parent, is exactly one `LifecycleBootstrapCreationTempV1`, is streamed and
synced, then is reopened without following links and rechecked by owner/mode/link/size/device/inode.
Only complete bytes are no-replace-renamed to the final leaf and followed by a parent sync. A nonce
temp's bytes are a 0..65-byte prefix of exactly 64 lowercase hex bytes plus LF. An allocator-creation
temp's bytes are a 0..1024-byte prefix of the sole canonical `LifecycleIdAllocatorV1` whose
`installNonce` equals the guarded final nonce and whose `nextCounter` is literal `"0"`; it is distinct
from §2.4's later allocator-rewrite temp despite sharing that reserved basename grammar.

Before reservation,
the only resumable creation states are neither final with at most the current exact temp, exact
schema-valid nonce alone with at most the allocator temp, or the exact pair with allocator
`nextCounter == "0"`; allocator-without-nonce, a second temp, replacement identity, or any other
counter refuses. Only after the second complete inventory may recovery bounded-read the temp. A
complete valid temp may finish the same no-replace publication. An empty or proper partial prefix may
be guarded-unlinked by its rechecked inode, followed by parent sync, and regenerated; a non-prefix,
over-limit, final-plus-temp, or changed identity is preserved recovery-required. Recovery under
bootstrap may then finish the next publication or restart from neither; it never touches the key. It
then reserves the complete
absent-manifest coordinator block, and publishes the flat plan then journal with no-replace plus parent
sync before `K(stage)`. No key mutation can precede the final journal. A death after reservation but
before plan publication leaves the exact pair plus the checked allocator reservation state and may
also leave only the exact derived plan temp, with the source key still untouched; a
death after plan publication but before journal publication may leave only the plan plus the one exact
journal temp. Under the same bootstrap lock, recovery validates those closed pre-intent states,
guarded-removes a partial temp, and either finishes publication or removes the untouched orphan plus
the recovery-only epoch; an allocator gap is harmless because that epoch is then removed entirely.
Those control files are not retroactive manifest ownership. If both files already exist, they are
legal only inside the exact candidate envelope above, and recovery resumes or closes that envelope
rather than re-admitting a fresh operation. Allocator-without-nonce, either missing control file after
reservation or intent, any collision, or any other lifecycle evidence is recovery-required rather
than permission to mint a competing epoch.

Terminal compaction for this variant removes allocator then nonce, then journal, and the flat plan
last, syncing `state` at every boundary while retaining the bootstrap descriptor. The only suffix
microstates are the §2.4 uninstall control-file states followed by journal-plus-plan, plan-only, or no
envelope leaf; the key and tombstone are already absent. A death after the plan unlink therefore
leaves only the exact locked bootstrap residue in an otherwise admitted empty `state`; recovery may
finish its unlink without guessing prior product ownership. It then performs the same exact bootstrap-
lock unlink and attempt-created empty-directory cleanup as its final product mutation; a waiter on the
old inode must restart from preflight. If the process dies after the lock unlink but before directory
cleanup, the next run preserves the indistinguishable exact empty skeleton under §2.3 rather than
inventing durable deletion authority.

The operation leaves the vault, canonical notes, generated indexes, captures, `.git`, remotes,
branches, commits, and all unknown files untouched.

It never deletes a directory recursively. An unknown child in a runtime directory is reported and
left alone; a product-created directory is removed only when empty. A per-job runner lease path is
removed while its exact descriptor remains locked, after plists are unloaded and the `uninstalling`
state plus runner no-create rule prevents a replacement; the descriptor is released only after path
absence verifies. Terminal Foundation/lifecycle transaction lock files use §2.4's guarded compaction;
only the global mutation-lock file retains the stable never-unlink contract.

## 7. Verification gates

| Gate | Required evidence |
|---|---|
| disabled Git is inert | tests assert no Git process and no network call for sync, status, scheduled stale sync, incomplete hand-edited state, and a complete forged config lifecycle with no matching active provenance even when an adopted repository, branch, and remote already match; repeat the forgery after every interrupted enable/disable/reconcile phase |
| disabled automation is inert | injected filesystem/runner observes no plist write, load, process, schedule, status write, or Brain effect for non-terminal journals and no handler effect for disabled, incomplete, provenance-absent, inactive-arm, hash-mismatched, or manifest-drifted state |
| lifecycle schemas are exhaustive | strict exact-set tests cover every field, bound, nested unknown key, illegal combination, `LifecyclePlanPreviewV1` versus `LifecycleExecutionPlanV1`, `LifecycleBootstrapLockV1`, `LifecycleBootstrapCreationTempV1`, `LaunchdBootstrapSnapshotCreationV1`, `LaunchdBootstrapSnapshotAttemptV1`, both config key unions/results, normalized schedule arm/order, exact idempotent local/HTTPS/SSH/scp normalization, every rejected URL ambiguity, `CanonicalJsonV1` escaping/key order/LF, the separate exact `FoundationJournalJsonV1` insertion order plus legacy compatibility read, Git branch/path/reflog rules, tagged absent/present source index, `GitMetadataBoundsV1`, `GitPackReaderBudgetV1`, `LegacyFoundationMutationIndexV1`, both relinquished observation arms, derived/plan-bound 1-MiB Foundation/coordinator/launchd journals, plan-bound Git journals through 16 MiB, 16-MiB Foundation payloads, canonical examples, scope fingerprint, and activation hash; absent remains byte-identical while present-and-undefined refuses |
| config surface is closed | exhaustive fixtures enumerate every `ConfigReadableKeyV1` and `ConfigMutableKeyV1`, reject every undeclared/prefix/descendant key, extra argv value, TOML fragment, implicit string, wrong JSON type, incomplete whole section, child write under an absent optional parent, and `null` outside whole `brain`/`redaction`; successful get/set results are exact `CanonicalJsonV1`, immutable lifecycle/schema/telemetry fields never change, and whole/keyed redaction reads expose only `patternsCount`, never a pattern value in success or error output |
| journal closure is fail-closed | exact-root tests cover nonce/allocator agreement, empty/partial/complete guarded-cleanable allocator temps and every identity third state, all four owner/type/mode gates, all three aggregate companion inventories, every allowed filename, allocated `0..255` and legacy `0..4294967294` mutation-index boundaries plus next-byte/noncanonical/sign/gap/partial-highest cases, planless Foundation remove gaps plus the three exact highest-index `writeStaged` partial states and journal-prefix temp, exact empty `launchd-process/{home,tmp}` pre-intent/process-boundary staging, the sole current-frontier linked snapshot-creation prefix, and every unknown/nonempty/identity third state, every allowed empty/partial/complete initial coordinator/participant/effect plan-or-journal temp before first intent and refusal after a target/live transition, conservative pre-ID and exact post-ID recomputation of every standalone/participant Foundation, coordinator, Git-effect, and launchd-effect journal maximum, over-limit plans/rewrite temps/finals, orphan plan/journal and independent stable-lock cases, unknown/temp leaves, strict schema/key/phase/ID/plan-domain hashes, missing/mismatched participants, zero/one/two `push_pending` candidates, each uninstall cursor before/within/after exact lease removal, mixed candidates, `compacting`, and malformed bytes with no readable participant envelope; only a fully valid terminal ledger is `clear`, while one valid bound push is `retry_only` and one exact verified lease-removal uninstall is `uninstall_draining` |
| terminal collection stays bounded | thousands of scheduled status/log transactions repeatedly compact to the exact 10,000/100,000/1,000,000 ceilings; allocator crash injection proves blocks advance before publication, gaps are legal, counters/nonces never rewind, and collected IDs never reappear; failure before/after every payload, journal, directory, held-lock, and plan-last unlink resumes from a terminal journal/cursor, plan-plus-lock, plan-only, or exact guarded orphan without admitting coordinator lock-only state; unknown children, identity swaps, and non-empty directories are preserved, reservation refuses before an ID block, and the global lifecycle lock is never removed |
| coordinator grammar is exact | strict tests expand every §2.4 operation variant, point of no return, and forward/inverse Foundation pair and reject every missing, duplicate, reordered, unused, wrong-side, wrong-position, wrong-hash, non-inverse, or late-compensation participant/step; `automation_reconcile/live_only` is exactly one `Q` participant with zero or more transitions and no Foundation/manifest arm, while `/files` requires its real plist mutations; plan/journal/filename IDs bind in both directions; `pushPlanHash` is null/equal in every variant and phase; a finalized current pre-boundary Foundation participant advances into its paired inverse while the boundary config participant force-forwards; every coordinator and effect phase/cursor/observation tuple is derived and terminal invariants require complete verified postimages, paired inverse postimages, preimages, or only exact source/destination `relinquished_created_object` and source `relinquished_created_git_tree` exceptions after control preimages verify |
| applied provenance is mandatory | exact-path tests prove only the planned lifecycle apply/recovery path creates or updates the content-owned `LifecycleActivationRecordV1`; absence means both inactive, one-arm transitions preserve the other, disable makes its arm inactive, config-only re-enable remains inert, pre-existing unowned files refuse, independent record/manifest edits are drift or missing ownership, and uninstall removes the exact artifact through its manifest evidence; every preflight also requires `LifecycleJournalClosureV1.clear`, apart from the exact `retry_only` path that can consume only its persisted push plan |
| plan/apply identity | all four default plan commands, including `GitDisablePlan`, perform zero writes, allocations, staging creation, lock creation, or inode capture and emit only deterministic `LifecyclePlanPreviewV1`; `--apply` recomputes the same `previewHash` under lock before reserving IDs, then its `LifecycleExecutionPlanV1` may add only allocated IDs, concrete staging paths/identities, and derived journal maxima. Fixtures change every preview precondition, reject a widened operation, cross-bind normalized config, activation/plist/manifest hashes, Git/launchd preview members and template process-table hashes, and prove recovery consumes the persisted execution envelope; `git disable` without `--apply` is byte-identical |
| V2 migration preserves ownership | migratable V1 regular files and created directories retain every restore field; verified shared-file backups pass; the immutable lifecycle nonce, schema allocator, exact sync/marker/status/lock/log reservations, and three journal directories are registered; V1 symlinks, shared directories, invalid backup evidence, every exact runtime/directory collision, and any declared/canonical V1 claim or filesystem leaf at the activation/nonce/allocator paths refuse before mutation |
| runtime records are closed | exact-path tests expand four job IDs and ten log slots; strict round-trips cover `SyncRecordV1`, marker, both status arms, bounded redacted log JSON, timestamps, reason codes, path order/count/size, zero-byte locks, and refuse every unknown field, wrong outcome combination, symlink, kind, slot, or unreserved path |
| V2 drift is exhaustive | non-empty fixtures cover every legal kind/mode pair, wrong type, file hash, link target, schema invalidity, optional absence, and illegal combinations |
| composite state recovers | injected failure/process death around every Foundation participant, direct manifest rename, activation publication, source/destination Git transition, before/after-files launchd command-before-observation and reverse transition, success-record write, point-of-no-return crossing, and compensation either runs the exact preplanned inverse Foundation transaction/restores prior external state, finishes the force-forward suffix, or leaves an exit-6 resumable journal; replacement fixtures cover old unload, new bootstrap, compensating new unload, and compensating old bootstrap by observable generations; uninstall rollback proves key → inverse artifacts → verified prior labels → inverse marker; the first Foundation journal dies before/after no-replace publication and resumes from its coordinator-bound staged inode; source-effect fixtures bind distinct before/after projections and retry validates only `sourceAfter`; forged complete config and already-matching external state remain inert at every non-terminal phase, while exact `push_pending` alone reopens the domain-hashed `PersistedGitPushPlanV1` and may retry only its bound network step or not-yet-started destination effect |
| branch-history warning is explicit | Git enable plan states that scoped staging does not prevent earlier or manual branch commits from being pushed |
| scoped staging | temporary repositories prove canonical notes, four index artifacts, and tracked deletions are included while every private/unrelated class is excluded |
| scope changes reconcile | each in-repository scope key causes sync refusal; reconcile lists exact retirements and preserves local files; a `brainPath` change refuses as repository identity and cannot enter reconcile; declared/canonical root escape reports `scope_outside_repository` |
| validation precedes persistence | lint, per-source 16-MiB and aggregate-snapshot 1-GiB bounds plus exact config/candidate-config/index/`HEAD`/loose-ref/reflog metadata limits, initial/refreshed source-secret, source-config-secret, and bare-destination-config-secret failures leave both configs, `.git/objects`, index, refs, reflogs, and `HEAD` byte-identical; boundary and first-over-limit-byte fixtures prove each counted read refuses before ID reservation, allocation/materialization, hash, copy, parse, or process authority and publishes no matched value |
| shadow Git isolation is complete | no subprocess receives the real source or local-destination Git directory; local helper/receive finishes in private planning before coordinator intent, its process transcript and either complete staged destination closure or exact already-present target ref are hash-bound before source publication, and `D(h)` admits no Git process; source and destination candidate objects/refs remain quarantined before their separate guarded effects and each effect uses only roles for its declared side. The one raw `GIT_ALTERNATE_OBJECT_DIRECTORIES` value accepts only `GitAlternateObjectDirectoryV1`; colon, quote, backslash, every C0/C1 control, and each first-invalid-byte boundary refuse before spawn, while accepted paths expose exactly one read-only object directory |
| Git effect publication is attributable | crash tests at every stage→final, preimage→before-tombstone, final→after-tombstone, apply-before-observation/cursor, and restore boundary prove a pre-recorded staged inode resumes as product-created while a byte-identical different inode is preserved as a third state; enable-only new `.git` publication binds the initial domain-separated recursive fingerprint, while compensation fixtures add a child between the former fingerprint/rename points and write through an open descriptor after rollback begins, proving rollback preserves the same root inode in place as `relinquished_created_git_tree` without walking or recursively deleting descendants; symbolic `HEAD`, regular files, reflog append postimages, plan-time pack/index reuse, refs, removal, finalize, and other reverse compensation use exact no-replace identities/CAS; post-intent `EEXIST` never becomes reuse or a false rolled-back absence |
| Git cardinality is closed | boundary arithmetic/property fixtures cover 100,000 blobs, 100,000 trees, one commit, four source-control transitions, the 511-entry enable-only repository fingerprint, and four destination transitions; the matching 200,005 effect/observation and million-leaf staging schemas cover the shared count worst case, while the next object, transition, fingerprint entry, companion leaf, encoded-plan byte, or computed reachable-journal byte refuses before ID reservation (the independent 16-MiB plan and Git-journal bounds may each refuse an otherwise count-valid concrete plan earlier) |
| Git distribution identity is exact | the initial row asserts Xcode/build-options bytes, architecture, canonical paths, root ownership/modes, symlink targets, sizes, and both literal SHA-256 values; change each field independently and plant a same-version different binary to prove `unsupported_git_distribution` before repository/network spawn |
| Git exec gateway enforces descendants | non-empty exact-name tests prove the five-name gateway set, gateway-only Git `PATH`/`GIT_EXEC_PATH`, direct absolute top-level Git, guarded Node shebang/template hashes, one-shot supervisor permits, PID/PPID and same-PID transitions, target identity rechecks, and exit-126/process-group refusal for wrong name/argv/env/order/reuse; `GIT_SSH` is the exact gateway bridge path and a requested unknown child has no executable |
| process table is canonical | strict schema/round-trip tests pin the one Git distribution ID, 11 build lines, three executable identities including empty helper `versionLines`, six exec-path links, twelve exact environment maps, seven I/O profiles, four inherited phase budgets, 21 node and 21 edge IDs including the no-child distribution probe, and every field-specific empty/ordered/unique array rule, literal/semantic/joined argv alternative and cardinality, zero through 200,001 pack objects, counted-proxy byte/hash totals, idle/wall/group-termination outcomes, empty joined fragments with non-empty combined tokens, and the domain-separated table/transcript hashes; one top-level push attempt has one non-resettable 600-second phase while a later exact `push_pending` invocation receives a new independently gated phase; unknown keys, free strings, wildcard/regex/ellipsis tokens, extra environment keys, an unexpanded slot, counter reset, over-limit byte, or deadline overrun refuses before further authority |
| process tree is level-closed | exact Apple-Git-155 spawn/exec tests prove every push reaches one transport branch; a ref-update reaches the literal pack-objects argv and local index-pack child through named permits, including a zero-object pack, while an exact up-to-date target reaches neither pack nor index and yields only its closed porcelain outcome/zero-transition destination effect. HTTPS and local branches pass exact dispatcher and helper transitions, the SSH gateway consumes both entry and system-SSH same-PID permits, local helper reaches only shadow-bound `git-receive-pack --skip-connectivity-check <private_destination_shadow>`, and receive-pack reaches only the conditional gateway-`git` index-pack argv under `receive.unpackLimit=0`; `unpack-objects`, `rev-list`, maintenance, shell, and vendor nodes have neither process-table node nor edge, and every wrong-level transition refuses |
| tree construction is NUL-safe | exact fixtures with ordinary, tab, LF, and CR `VaultSegmentV1` names prove only `git mktree -z` receives the NUL-delimited mode/type/OID/name grammar and yields the planned tree OID; line-oriented input, symlink/gitlink modes, duplicate names, missing objects, invalid order, or more than 16 MiB refuses |
| hostile Git config is inert | every source and local-destination Git subprocess uses its corresponding shadow; exact byte fixtures pin `SanitizedGitShadowConfigV1` section/key order, escaping/LF, empty hooks, fsmonitor/signing/maintenance/GC/proxy/credential resets, the one optional remote or receive arm, and absence of every include, pushurl, URL rewrite, proc-receive, command-bearing, or extra key. `GitConfigQuotedPathV1` rejects every C0/C1/line-break boundary before rendering while quote/backslash fixtures round-trip through the sole escape grammar. Every non-null persisted push binds the domain-separated source template hash, local additionally binds its destination template, and initial/existing/retry permits de-slot fresh concrete paths/token back to that template before binding projection bytes and config/hooks identities; no source effect is needed for this authority. Real source/destination hooks, filters, fsmonitor, signing, credential/custom remote helpers, SSH commands, proxy redirects, `pushurl`, URL rewrites, and includes cannot execute or redirect the validated push. A cross-host/path HTTPS 3xx fixture proves `http.followRedirects=false` issues no second request and leaves the push retry-only rather than accepting another destination |
| transport set is closed | non-empty exact input cases accept only local/file, HTTPS, and sanitized SSH forms and refuse unknown/future schemes plus every user/config-supplied `::` helper form; only the in-process coordinator can synthesize the one invocation-scoped internal helper URL |
| SSH bridge is deterministic | integration with the installed Git version fixes gateway `GIT_SSH` plus `GIT_SSH_VARIANT=ssh`, emits no detection probe, consumes the entry permit before internal mode and the separate same-PID `/usr/bin/ssh` permit before exec, pins the system binary/hash and both exact port argv alternatives, refuses leading-hyphen parsed usernames/targets, and refuses every other argv/environment |
| local receive-pack is closed | installed-distribution gateway/process-tree tests prove source Git requests exact `git remote-developer-os-local developer-os <token>` during private pre-intent planning, that same PID crosses only the permitted dispatcher and fixed local-helper trampoline, and the helper receives only the stripped token, supervisor capability, and private `SanitizedBareDestinationShadowV1`, never a real-destination path or `/bin/sh`; it permits exact `git-receive-pack --skip-connectivity-check <private-shadow>`, whose generated config pins `receive.unpackLimit=0`, with only the conditional pinned index-pack gateway branch below it for zero/nonzero-object ref-update packs and no pack/index branch for the exact up-to-date target; hostile real/shadow hooks, proc-receive, config, maintenance, and concurrent swaps execute nothing else and leave the real bare destination unchanged; malformed, missing, wrong-OID, duplicate, and extra-target closure fixtures, unequal header/admitted/closure counts, the 200,001/200,002 boundary, plus every first-over-limit compressed/inflated/aggregate/delta-depth/delta-work/RAM/temp/deadline case prove the guarded streaming reader destroys quarantine before coordinator intent, while a budget-valid complete staged closure or exact already-present target ref alone permits the later process-free effect |
| Git ref publication includes reflogs | source HEAD/branch and local bare branch fixtures cover policy true/false, pre-existing log override, absent/create and present/append, unborn all-zero old OID, exact committer/date/message line, 64-MiB preimage and 64-MiB-plus-4-KiB postimage boundaries, and ref/reflog concurrent swaps; exhaustive bijection fixtures reject missing, extra, duplicate, wrong-role/path/hash/size/OID transitions and projections before intent and on recovery; forward order is objects/index/reflogs/ref and compensation restores ref before reflogs, with every third state preserved recovery-required |
| Git object publication is no-replace | source-object and destination pack/index absent, pre-intent identical-reusable, conflicting, mixed, and between-publication collision fixtures prove no overwrite; journals distinguish created from plan-time reused, a late byte-identical `EEXIST` is preserved recovery-required, and controlling index/reflog/ref transitions follow their exact order with ref last; a concurrent ref created after ref/reflog restoration but before object compensation proves rollback preserves the exact source object or destination pack/index as `relinquished_created_object` without a reachability-check/unlink race, while missing or mismatched objects remain recovery-required and compensation/terminal compaction never removes their published paths |
| repository/index formats are closed | enable-only absent source plus later existing unborn sync, empty bare destination with exact symbolic `GitHeadStateV1` plus absent target ref, symbolic/detached populated bare HEAD, plain DIRC v2, and valid TREE-cache fixtures pass; every sync rejects a `source_git_directory_tree` transition and uses object/index/reflog/ref roles, while missing/malformed/non-canonical/concurrently changed destination HEAD, invented unborn OID, repository extensions, other index versions/extensions, flags, stages, sparse/split forms, and malformed data refuse byte-identically across planning and retry |
| commit tree stays exact | the post-commit and immediate pre-push tree equal the validated candidate under hostile hooks/config fixtures |
| push failure is not success | rejecting bare remote leaves local commit, preserves the prior success record, and the next run retries only the exact persisted push; each top-level attempt receives one fresh 600-second phase, while descendants/internal attempts cannot reset it and no lifetime clock/budget is persisted |
| no-change is truthful | only a scoped no-diff with `HEAD` equal to the last pushed `HEAD` records `no_changes` and skips network |
| history ownership | dirty index and every in-progress history state refuse; no fetch/pull/merge/rebase/checkout/force argv is possible |
| automation is closed | non-empty exact enum, exhaustive dispatch, `maySpawnVendor: false`, exact generation-bound argv including guarded `--product-home`, sanitized Git children, and scheduled doctor without external probes; custom-home fixtures prove scheduled bootstrap uses the argument before normal context construction and ignores ambient `HOME`, `DEVELOPER_OS_HOME`, and `DEVELOPER_OS_BRAIN`, while interactive mode rejects the hidden argument |
| every stale job is inert | all four jobs first authenticate the supplied generation from exact manifest-owned plist/install evidence without requiring active current provenance, then under the lifetime lease/global lock recheck closure, that evidence, strict config, activation, and eligibility. Unowned/missing/drifted installation evidence grants no status write; a non-clear journal exits silently except that exact active `git-sync` `retry_only` may consume only its persisted push plan, and the post-handler recheck suppresses log/status if that retry remains non-clear. With clear closure, disabled, incomplete, malformed-config, inactive, or mismatched automation writes only `automation_disabled`; active automation with only Git ineligible writes only `git_disabled`. Both branches perform no handler, Brain-root resolution, Git, vendor, or network effect |
| schedules are complete | first enable refuses every missing eligible job; reconcile preserves old schedules and requires newly eligible Git; stored entries are exactly the three mandatory jobs plus optional fourth `git-sync` in canonical order and use only the normalized tagged schedule union |
| launchd identity is closed | exact-set tests bind all four job IDs to frozen base labels, canonical plist paths, the guarded canonical product home, exact nine-argument scheduled argv, the exact `gui/<effective-uid>` domain, domain-separated generation projections, generated labels, and the one five-key canonical plist XML: exact ProgramArguments, hourly/daily/weekly calendar dictionaries, weekday mapping, XML escaping/order/LF, and literal `/dev/null` output paths; every product-home change, ambient override, extra key/argument, alternate encoding, alias, domain, filename, and fifth dictionary entry refuses. The pinned 25F84 `/bin/launchctl` identity and hash-bound process-table template/expanded table admit only domain/service `print`, exact FD-3 `/dev/fd/3` bootstrap from an already-unlinked private snapshot, and exact `bootout` argv; domain-targeted exit-0/113 fixtures distinguish unloaded, exact old, exact new, unsuffixed/exact-label collision, dual-generation, wrong-domain, truncated, over-limit, and unobservable states without parsing or persisting raw `print` output |
| launchd replace is ordered | every row of the exhaustive install/replace/keep/remove live/file table has forward/reverse crash injection; affected old generations unload before plist mutation and new generations snapshot-bootstrap only after matching bytes/identity verify, with exact observable states across both command-before-observation windows. A disposable pinned-macOS certification proves launchctl consumes unlinked inherited FD 3; unit races rename, replace, and write the real plist in place after verification while proving the loaded generated label remains attributable to the immutable snapshot. Snapshot-creation fixtures kill after linked create, every partial-prefix write, sync, open, and immediately before/after unlink; only the exact current-frontier `LaunchdBootstrapSnapshotCreationV1` may be completed or guarded-cleaned while live state remains the directional command preimage. Spawn-refusal, timeout, success, reverse, and recovery fixtures prove the parent's source/snapshot descriptors and child's sole FD 3 return to the open-FD baseline; unsupported certification refuses with no linked or pathname fallback. Query/mutation fixtures enforce at most 13 read-only `print` processes in each preview or revalidation pass, hash-bind the exact root/home/tmp path-owner-mode-dev-ino mutation-staging identities, require the root's two-child set and entry-empty home/tmp before/after every mutation-table spawn, shared 30-second observation/transition deadlines, stream/idle/process-wall bounds, SIGTERM→100-ms→SIGKILL group termination, complete reaping, guarded empty pre-intent cleanup, retained nonempty/unknown children, and post-intent cursor-preserving recovery-required outcome |
| lock behavior is serialized | interactive contention refuses; a runner guarded-opens the pre-created lease, acquires it before any global-lock wait, rechecks marker/path identity, and holds it through exit; same-job contention exits silently, global contention waits no more than ten minutes, and a still-busy final nonblocking acquire exits silently, while a successful final acquire rechecks marker/closure/stage-1 evidence/current provenance under the global lock and serializes only `skipped_lock_timeout` for active state or `automation_disabled` for inactive state through the already-held lease, without handler effects. Absent/replaced lease fixtures exit silently only for a present marker, absent manifest, or the exact typed `uninstall_draining` coordinator after its verified lease removal; every still-installed state without that proof is recovery-required |
| logs are bounded and safe | redaction precedes the Foundation file transaction; each exact slot stays at or below 1 MiB; the eleventh generation and transaction temp files are discarded; each terminal status/log transaction then compacts its exact journal, staging, backup metadata, and stable lock so cadence cannot exhaust the ledger |
| uninstall drains without deadlock | pause a runner before lease acquisition, after lease acquisition/before global acquisition, and while queued on the global lock; marker publication plus global release makes each exit silently, uninstall acquires all four lifetime leases without the global lock, retains them while reacquiring/revalidating, removes their exact paths while descriptors remain held, and no runner/late opener writes handler status after `uninstalling` exists. Crash fixtures after each lease removal prove `LifecycleJournalClosureV1.uninstall_draining` is returned only for the one exact plan/cursor/manifest binding and cannot be synthesized by path absence |
| absent-manifest uninstall is evidence-bound | complete preflight and bootstrap-locked no-follow product-home walks cover absent root, empty root, exact empty `state`, and exact key-only `state` at every 1,000,000-entry/128-component/4096-byte boundary; crash injection covers every product/state/bootstrap create, acquire, identity recheck, unlink-while-held, waiter restart, parent sync, and empty-directory cleanup boundary plus concurrent init/uninstall. A live attempt removes only its identity-recorded empty directories; after death, the indistinguishable exact empty-root or empty-state skeleton is preserved and no file/control residue is admitted. Only the exact locked coordination leaf and live attempt-created directory identities project away; the sole additional admitted recovery shape is the flat, bootstrap-locked key-present envelope with its derived nonce/allocator creation/reservation states, exact `LifecycleBootstrapCreationTempV1` path/owner/mode/link/size/prefix boundaries, plan-before-journal publication temps, final-journal-plus-one-rewrite-temp crashes at every post-intent cursor/phase update, key/tombstone arms, and allocator→nonce→journal→plan terminal suffix. Every other known/unknown file or directory, symlink, special/hard-linked leaf, owner/identity race, invalid name, first-over-limit entry, external plist, retained generated-label evidence, normal ledger/staging residue, illegal partial control state, missing/duplicate flat-envelope member, or missing derivation evidence preserves everything as recovery-required. Fresh admission is launchctl/process-free and occurs before any recovery epoch/ID because base labels and arbitrary generation-prefix labels are unowned while no evidence-derived generated label exists; key-absent returns without ID/coordinator/plan/K step and without file/control residue, while key-present alone derives the two-step coordinator; fixtures assert zero `launchctl` spawn and zero key-byte/hash read |
| uninstall respects ownership | the declared/canonical partition preserves every Brain and unknown/out-of-home artifact; only exact authorized plists, product-home artifacts, exact ephemeral paths, and redaction key disappear; `.git` survives |
| manifest transitions are no-overwrite | concurrent replacement before/after every tombstone and publication boundary preserves every third state; present↔present, present→absent, absent→present, rollback, and recovery use only exact no-replace moves/publication |
| uninstall removes its manifest recoverably | failure/death before and after no-replace move, preserved-inode verification, and durable committed-absence record proves exact compensation or force-forward completion, never overwrite/deletion of a concurrent manifest or a stale live manifest |
| redaction-key deletion is secret-opaque | strict source/tombstone derivation plus present/absent, collision, wrong-type/owner/mode/size/link/device/inode, identity-swap, and every `K(stage)`/manifest-absence/`K(delete)` crash boundary prove no key byte or content hash enters memory/journal/log; rollback before manifest absence renames it back, while recovery after manifest absence only deletes the bound tombstone |

Git integration uses only temporary repositories and local bare remotes with synthetic identity and
no real credential. Launchd integration uses only injected filesystems, clocks, process runners, and
launchd runners. Enumerators and policy gates assert their expected sets before asserting properties
over them.

## 8. Produced interfaces, sequencing, and residuals

### 8.1 Produced interfaces

| Interface | Owner |
|---|---|
| `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1` consumed here | DOS-P7 spec 2 migration/core manifest package |
| `GitSyncConfigV1`, `AutomationConfigV1`, `LifecycleActivationRecordV1`, `ConfigReadableKeyV1`, `ConfigMutableKeyV1`, `ConfigGetResultV1`, `ConfigSetResultV1`, publishable config projection, and canonical subsystem hash projections | `packages/core/src/config/` |
| `LifecycleInstallNonceV1`, `LifecycleIdAllocatorV1`, `LifecycleLedgerBoundsV1`, `LifecycleBootstrapLockV1`, `LifecycleBootstrapCreationTempV1`, `LegacyFoundationMutationIndexV1`, `FoundationJournalJsonV1`, `FoundationJournalJsonPrefixV1`, `LifecycleCoordinatorJournalV1`, `LifecyclePlanPreviewV1`, `LifecycleExecutionPlanV1`/`LifecycleCoordinatorPlanV1`, `LifecycleJournalClosureV1`, `FoundationParticipantRefV1`, `FoundationTerminalCompactionV1`, `LifecycleTerminalCompactionV1`, and exact allocator/ledger/envelope/operation/point-of-no-return tables | lifecycle coordinator/recovery module selected by the implementation plan |
| `GitSyncCardinalityV1`, `GitMetadataBoundsV1`, `GitPackReaderBudgetV1`, `GitIndexStateV1`, `GitHeadStateV1`, `GitReflogStateV1`, `GitReflogPlanV1`, `GitSourceStateV1`, `GitScopeSnapshotV1`, `GitPlanPreviewV1`, `GitEnablePlan`, `GitDisablePlan`, `GitSyncPlanV1`, `PersistedGitPushPlanV1`, side-tagged `GitEffectPlanV1`, `GitEffectJournalV1`, `GitEffectEvidenceV1`, `GuardedGitPathStateV1`, `PlannedGitPathStateV1`, `GitRelinquishedDirectoryRootV1`, and `GitTreeFingerprintV1` | Git command/domain module selected by the implementation plan |
| `SupportedGitDistributionV1`, `SupportedGitExecutableV1`, `SupportedGitProcessTableV1`, `GitArgTokenV1`, `GitArgvGrammarV1`, `GitProcessNodeV1`, `GitProcessEdgeV1`, `GitProcessIoProfileV1`, `GitProcessPhaseBudgetV1`, `GitEnvironmentProfileV1`, `GitConfigQuotedPathV1`, `GitAlternateObjectDirectoryV1`, `GitExecGatewayV1`, `GitProcessSupervisorV1`, `SanitizedGitEnvironmentV1`, `SanitizedGitShadowConfigV1`, `SanitizedGitShadowConfigTemplateV1`, `SanitizedGitShadowConfigBytesV1`, `SanitizedGitShadowV1`, `SanitizedBareDestinationShadowV1`, `SanitizedSshBridgeV1`, `SanitizedLocalRemoteHelperV1`, guarded budgeted SHA-1 pack/ref reader, and closed transport/parser formats | security/process boundary selected by the implementation plan |
| `LaunchdGuiDomainV1`, `LaunchdGenerationV1`, `LaunchdScheduledProductHomeV1`, `LaunchdGenerationProjectionV1`, `GeneratedLaunchdLabelV1`, `LaunchdObservedServiceTargetV1`, `LaunchdGeneratedServiceTargetV1`, `LaunchdCalendarIntervalV1`, `LaunchdPlistDictionaryV1`, `BoundedCanonicalPlistXmlV1`, `LaunchdProcessEnvironmentV1`, `LaunchdProcessDirectoryIdentityV1`, `LaunchdProcessIoProfileV1`, `LaunchdProcessArgvV1`, `LaunchdPreviewObservationProcessTableV1`, `SupportedLaunchdProcessTableTemplateV1`, `SupportedLaunchdProcessTableV1`, `LaunchdPlanPreviewV1`, `LaunchdBootstrapPlistIdentityV1`, `LaunchdBootstrapSnapshotCreationV1`, `LaunchdBootstrapSnapshotAttemptV1`, `LaunchdPlanV1`, `LifecycleFileBindingV1`, `LaunchdEffectPlanV1`, `LaunchdEffectJournalV1`, closed job registry, schedule parser, and bounded domain-targeted live-state query | `packages/platform-macos/src/launchd/` |
| closed external-plist authorization, uninstall ownership partition, `SecretOpaqueFileStateV1`, and `RedactionKeyStatePlanV1` | CLI/Foundation ownership module selected by the implementation plan |
| `SyncRecordV1`, `UninstallingMarkerV1`, `AutomationRunnerLeaseV1`, `AutomationStatusRecordV1`, `AutomationLogRecordV1`, and their exact paths | CLI state modules selected by the implementation plan |
| `config`, `git`, and `automation` verbs | `apps/cli/src/commands/` |

The implementation plan must preserve package dependency direction: core types do not import CLI or
macOS adapters, Brain policy is consumed through public interfaces, and platform code receives
filesystem/process/clock dependencies rather than reaching global state directly.

### 8.2 Required sequence

1. **Completed 2026-08-28:** founder approved this written specification.
2. **Completed 2026-08-28:** write
   `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md`; do not execute it yet.
3. Specify, approve, plan, and implement DOS-P7 spec 2 through the `InstallationManifestV2`
   migration required by §2.1.
4. Execute this specification's plan, then its full gates and fresh-context review.

### 8.3 Accepted residuals

1. **Mutable configuration is not content-tamper-detected.** A schema-valid hand edit can weaken
   user redaction patterns or create inert stale lifecycle intent, but cannot by itself create applied
   provenance. The activation record and manifest detect independent edits; they are not
   cryptographically authenticated against a hostile process that rewrites both, matching the threat
   model's existing local-write boundary. **Owner: founder decision if local product state is ever
   promoted to a security boundary.**
2. **The closed transport policy trades compatibility for process safety.** Executable credential
   helpers, user SSH commands, proxies, custom remote helpers, IDN/IPv6 destinations, and future
   transports do not work in version 1. HTTPS that needs a credential helper fails; SSH is limited to
   the sanitized pinned system client, ASCII/IPv4 host grammar, an already trusted host key, and an
   ambient agent/default key. **Owner:
   DOS-P9 release documentation; widening requires a new reviewed design.**
3. **Dirty-index recovery is outside the product.** Sync names the condition and refuses; the user
   must resolve staged work with Git. **Owner: DOS-P9 documentation.**
4. **This implementation is blocked on the other half of DOS-P7.** The opt-in plan may be written,
   but no mutable-config or runtime-state code lands against `InstallationManifestV1`. **Owner:
   DOS-P7 spec 2 and its plan.**
5. **Scoped staging is not scoped history.** Existing and later manual commits on the adopted branch
   can contain out-of-scope paths and Git may push them. The enable plan makes that boundary explicit;
   the product does not inspect or rewrite branch history. **Owner: the user who adopts the branch,
   with DOS-P9 responsible for release documentation.**
6. **The initial Git support row is deliberately machine-distribution-specific.** An Xcode update or
   replacement of any pinned executable/link disables Git operations as
   `unsupported_git_distribution` until a newly measured row, hashes, traces, and gates are reviewed;
   automation remains inert rather than falling back to version-text trust. **Owner: DOS-P9 release
   compatibility documentation; widening requires a new reviewed distribution row.**
7. **Real Git state must share a filesystem device with product staging.** Source Git enable/sync and
   local/file destination promotion refuse `cross_device_git_state` when their target cannot receive
   an atomic rename from the exact product-home quarantine. The default home/Brain layout is on one
   device; an external-volume Brain or bare remote is unsupported in version 1. **Owner: DOS-P9
   compatibility documentation; widening needs a different durable publication primitive and a new
   reviewed design.**
