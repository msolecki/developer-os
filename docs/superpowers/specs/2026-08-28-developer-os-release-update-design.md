# Developer OS — Release, Update, and Manifest V2 Design

**Status: 2026-08-29 baseline approved; the 2026-08-31 §6 retained-bootstrap-evidence correction
was approved in design dialogue and awaits complete written-specification review.** This is DOS-P7
Spec 2, the second half of `ORDER.md` entry A11 and program-plan Task 7. Spec 1 is the approved
opt-in surfaces design at
`docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`.

This specification owns release trust, the stable launcher and versioned bundle contract,
`ManagedArtifactV2`/`InstallationManifestV2`, V1 migration and V2 new init, update planning and
apply, schema migration, and rollback. Its baseline implementation plan is
`docs/superpowers/plans/2026-08-29-developer-os-release-update.md`; Task 7 must be revised against
the written §6 correction before implementation resumes.

The split has one hard implementation dependency. The V1→V2 migration and V2 new-init handoff in
§6 must land first. Only then may Spec 1 implementation begin. The remaining release/update work in
this specification resumes after Spec 1 has supplied the lifecycle coordinator and participant
contracts this design consumes. Neither split changes the unchanged DOS-P7 checkpoint.

---

## 1. Scope and invariants

This subsystem adds five capabilities:

1. a package-manager-owned stable launcher and product-owned versioned release bundles;
2. signed release metadata and bounded fixed-origin downloads;
3. a local migration from `InstallationManifestV1` to `InstallationManifestV2`, plus V2-first new
   init;
4. plan-first managed-artifact and Brain-schema updates; and
5. automatic and one-version manual rollback.

The public surface is explicit. No command other than `developer-os update` performs an update
network request. `update` and `update rollback` are plan-only unless `--apply` is present. A plan may
use bounded attempt-owned system-temporary quarantine to download and inspect a target, but it does
not mutate product, Brain, vendor, launcher, or active-release state.

The subsystem preserves these standing boundaries:

- the Homebrew-installed launcher and its bundled runtime are outside product-managed update and
  rollback authority;
- the updater never accepts an arbitrary origin, release channel, prerelease, build-metadata
  version, downgrade, unsigned document, unchecked archive, credential, cookie, or ambient proxy;
- signature failure never falls back to TLS-only trust, a checksum alone, another origin, or an
  older release;
- only artifact-owner families already present in the installation may be upgraded; update never
  installs an absent optional adapter or enables a feature;
- no update or migration invokes a model, spends model credits, captures content, ingests content,
  or gives a vendor process model authority;
- the target release contributes future knowledge only through the closed plan protocol in §8;
  the installed release validates and executes the result;
- Brain mutations require explicit `update --apply`, exact preconditions, durable forward and
  inverse bytes, and Foundation transactions;
- update refuses managed drift, schema incompatibility, an incomplete lifecycle ledger, a
  concurrent edit, an unsupported owner action, or insufficient bounded capacity before apply;
- rollback never merges, overwrites a post-update edit, lowers the persisted release-trust high
  watermarks, or downloads a replacement;
- uninstall preserves the Brain, unrelated agent configuration, and every bootstrap plan, journal
  slot, and retained tombstone; it removes release bundles only through exact manifest and
  signed-inventory evidence, and there is no recursive delete;
- all persisted DOS-P7 JSON uses `CanonicalJsonV1` plus one LF except unchanged legacy Foundation
  journals and an unchanged V1 manifest preimage retained for migration recovery;
- secret-screen private bytes before any integrity hash; redact before diagnostic truncation,
  logging, publication, or model input; release and planner protocols carry no private value in a
  diagnostic;
- every mutation follows `plan → backup → stage → validate → apply → verify → finalize`, including
  manifest, active-release, vendor-registration, and bundle-publication effects through their
  specialized participants.

Fixtures use synthetic keys, releases, homes, vaults, vendor state, and local injected transports.
No test reads a real vault, credential store, live release, live vendor home, or live launcher
installation.

## 2. Boundaries and package direction

The implementation preserves `core ← security ← platform-macos ← cli` and adds a deliberately small
launcher application:

| Area | Owns | Must not own |
|---|---|---|
| `apps/launcher` | offline root/metadata-locator authority, active-release admission, guarded bundle inventory verification, exact entrypoint execution, packaged fallback | network, update selection, manifest migration, rollback, vendor or Brain access |
| `packages/core/src/manifest/` | V1/V2 validation, V2 drift, manifest-state schemas and pure transition tables | network, signature keys, process spawn, macOS behavior |
| `packages/core/src/update/` | release/update scalar schemas, selection, previews, plan codecs, feasibility and state machines | filesystem globals, HTTP, archive extraction, process spawn |
| `packages/core/src/migrations/` | ordered migration registry contracts and pure plan combination | direct filesystem mutation or target-code execution |
| `packages/security/src/update/` | signature verification, fixed-origin HTTPS, bounded streams, archive admission, planner process policy | release choice, manifest ownership, CLI rendering |
| `packages/platform-macos/src/launcher/` | platform/architecture identity and launcher/bundle executable admission | release selection or filesystem mutation |
| `apps/cli/src/commands/update/` | strict argv, preview/apply orchestration, typed results | direct unplanned mutation |
| `apps/cli/src/update/` | production composition, owner-provider registry, recovery, rollback, V2 admission | new generic schemas that belong in Core |

`apps/launcher` may depend on Core scalar/canonical codecs, Security guarded-path/signature helpers,
and the macOS launcher adapter. It may not import the CLI or any adapter. Homebrew later packages the
launcher plus its pinned runtime and fallback bundle; A16 owns formula/publication work, not these
local contracts.

The internal path brands used below are closed projections, not free caller strings:

```ts
type ExactProductStatePathV1 = CanonicalAbsolutePathV1 &
  { readonly __exactProductStatePathV1: unique symbol };
type CanonicalProductStatePathV1 = CanonicalAbsolutePathV1 &
  { readonly __canonicalProductStatePathV1: unique symbol };
type VaultFreeRelativePathV1 = string &
  { readonly __vaultFreeRelativePathV1: unique symbol };
type BoundedArtifactSourceV1 = VaultFreeRelativePathV1;
type OwnerRelativePathV1 = string &
  { readonly __ownerRelativePathV1: unique symbol };
type RollbackPayloadRelativePathV1 = string &
  { readonly __rollbackPayloadRelativePathV1: unique symbol };
type BootstrapPayloadPathV1 = CanonicalAbsolutePathV1 &
  { readonly __bootstrapPayloadPathV1: unique symbol };
type ManifestPayloadPathV1 = CanonicalAbsolutePathV1 &
  { readonly __manifestPayloadPathV1: unique symbol };
type CanonicalStatePayloadPathV1 = CanonicalAbsolutePathV1 &
  { readonly __canonicalStatePayloadPathV1: unique symbol };
type FoundationInitialJournalPayloadPathV1 = CanonicalAbsolutePathV1 &
  { readonly __foundationInitialJournalPayloadPathV1: unique symbol };
type UpdatePayloadPathV1 = CanonicalAbsolutePathV1 &
  { readonly __updatePayloadPathV1: unique symbol };
type UpdateRecoveryExecutorStagedPathV1 = CanonicalAbsolutePathV1 &
  { readonly __updateRecoveryExecutorStagedPathV1: unique symbol };
type SchemaMigrationIdV1 = `migration_${LowercaseKebabIdV1}`;
type LowercaseKebabIdV1 = string &
  { readonly __lowercaseKebabIdV1: unique symbol };
type PositiveUInt32V1 = Integer[1..4_294_967_295];
type TenDigitZeroPaddedOrdinalV1 = string &
  { readonly __tenDigitZeroPaddedOrdinalV1: unique symbol };
```

An `ExactProductStatePathV1` is one specification-enumerated leaf under the guarded product
`state` directory; construction derives the leaf from its typed ID/role and reopens every ancestor.
A `CanonicalProductStatePathV1` is an exact guarded absolute path under product home that is already
a manifest-owned `schema` artifact or the exact target `schema` artifact admitted by the update
plan. Neither codec accepts an arbitrary absolute string, symlink traversal, normalization change,
or a caller-selected product root.

The three relative-path brands are NFC `1..4096` UTF-8 bytes with `1..128` POSIX components of
`1..255` bytes, no empty/dot/dot-dot component, NUL, C0/C1 control, Unicode format character,
backslash, leading slash, normalization change, or exact/NFC/folded alias. Their constructors also
require containment in the named guarded backup, owner, or rollback-payload root. A rollback payload
path is further restricted by role to `plans/<kind>/<id>.plan.json` or
`blobs/<ten-digit-zero-padded-ordinal>.bin`; the two top-level metadata files are separately derived
and never caller supplied. `LowercaseKebabIdV1` is `1..96` ASCII bytes matching
`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`; the full schema migration ID is therefore at most 106 bytes and is
never an allocated lifecycle ID.
`TenDigitZeroPaddedOrdinalV1` is exactly ten ASCII decimal digits encoding an integer in
`0..9_999_999_999`; encoding left-pads the canonical base-ten integer with ASCII `0` to length ten,
and decoding rejects every shorter, longer, signed, spaced, non-ASCII, or otherwise non-canonical
spelling. Each use applies its narrower semantic bound after decoding: a planner artifact token and
rollback/source evidence ordinal is at most `999_999` and is lower than its enclosing exact-set
count, while a fresh-init or manifest-migration Foundation ordinal is at most `255` and is lower than
the enclosing forward-pair count.

The target planner is trusted release code, not hostile third-party code and not an OS sandbox.
Capability absence is enforced in the shipped graph: its public entrypoint imports only pure Core,
Brain migration, workflow, and adapter planning modules; a repository gate enumerates the complete
transitive compiled graph and refuses filesystem, network, process, environment, clock, randomness,
native-addon, worker, and dynamic-import entrypoints. The current process supplies a bounded snapshot,
clock value, and platform facts. A compromised root/release signer or compromised bundled runtime is
out of scope, matching the existing threat model. The spec never calls that source-level boundary an
OS sandbox.

## 3. Stable launcher and installed release layout

### 3.1 Launcher behavior

The Homebrew-owned launcher first checks the exact optional update-recovery executor record from
§9.2. When it is absent, the launcher has two normal candidates:

1. the active product-owned bundle named by `ActiveReleaseRecordV1`; or
2. its colocated package-manager-owned fallback bundle when the active record is absent.

Before normal selection, it also runs the bounded bootstrap-closure reader from §6. Before a
complete V2 handoff, exactly one valid non-terminal `fresh_v2_init` or `v1_to_v2` envelope is a
recovery-routing arm, not normal active state. Before the launchability suffix completes, the
launcher uses its colocated packaged fallback. After that cursor, it may use the copied product
bundle only when active, trust, all three retained metadata files, and the complete bundle identity
equal that same guarded package source. Either candidate may execute only the strict public `init`
recovery command; every other argv is recovery-required. The selected CLI must resume/compensate
the recorded envelope before dispatching ordinary init behavior. Missing/extra envelopes, a
cursor/identity mismatch, active published before the fixed launchability suffix, or malformed
active bootstrap residue is exit 6. Once terminal V2 verification establishes the complete handoff,
bootstrap plans, journal slots, and retained tombstones are inert under §6.4 and do not intercept
ordinary launcher selection even when retention is incomplete or later altered.

It resolves the product home from the same guarded default/`DEVELOPER_OS_HOME` grammar as the CLI,
without resolving a Brain. It opens the active record with no-follow/type/owner/mode/link/size and
before/after device/inode checks. Malformed, drifted, incomplete, or contradictory active state is
exit 6; it never silently falls back over a present but invalid active record. Absence alone selects
the packaged fallback, which is what makes first init and a post-uninstall command possible. A
present recovery-executor record is never ignored or treated as an active-record replacement: its
closed executing/terminal-cleanup admission and original-bundle routing are §9.2.

For an active candidate, the launcher validates:

- exact `ActiveReleaseRecordV1` keys and canonical bytes;
- a release root lexically and canonically contained under exact `<product home>/releases`;
- the exact metadata paths derived from the three hashes in the active record, followed by the
  root signature on the retained delegation, the delegated signature on the retained index, the
  selected release/bundle row, and the retained bundle-manifest hash;
- trust high watermarks that dominate or equal the active identity without redefining it, and exact
  retained-metadata-store set equality to the active plus valid rollback identities in clear state;
- exact set equality between manifest inventory and the bundle tree;
- every directory/file path, owner, mode, type, link count, size, and SHA-256;
- the exact platform, architecture, launcher protocol, update protocol, entrypoint path, and bundled
  runtime identity; and
- absence of unknown children, links, specials, folded/NFC path collisions, and identity changes
  during inspection.

The launcher then uses a shell-free absolute argv and a closed sanitized CLI environment containing
only canonical `HOME`, canonical `DEVELOPER_OS_HOME` equal to the exact product-home root the
launcher already validated, and the original optional `DEVELOPER_OS_BRAIN` only after its bounded
absolute-path input grammar accepts it. The launcher does not resolve or open the Brain; the CLI performs the ordinary
canonicalization, containment, and guarded-root checks before use. Missing/invalid `HOME` or an
invalid Brain override is exit 2 before exec. This path-context handoff is the sole exception to the
empty environment; every network, planner, verifier, vendor, and other descendant receives its own
independently constructed empty/closed environment and never inherits it. The launcher supplies the
§4.2 trust handoff on read-only inherited descriptor 3
and the fixed internal `--offline-release-trust-fd=3` argument, executes the absolute
`runtimeEntrypoint` with the absolute `entrypoint` as its first argument, then that internal argument
and the original public CLI argv. It never executes a
path reached through `PATH`. Bundle validation is bounded by the same inventory limits as §4.4 and
asserts a non-empty file set before checking its
members.

### 3.2 Product-owned paths

Spec 2 reserves the following exact paths in every V2 installation:

| Interface | Exact path relative to product home | V2 artifact mode |
|---|---|---|
| release root | `releases` | directory `content` |
| retained release metadata root | `state/release-metadata` | directory `content` |
| delegation store | `state/release-metadata/delegations` | directory `content` |
| index store | `state/release-metadata/indexes` | directory `content` |
| bundle-manifest store | `state/release-metadata/bundles` | directory `content` |
| retained delegation | `state/release-metadata/delegations/<delegation-hash>.json` | regular-file `content` |
| retained index | `state/release-metadata/indexes/<release-index-hash>.json` | regular-file `content` |
| retained bundle manifest | `state/release-metadata/bundles/<bundle-manifest-hash>.json` | regular-file `content` |
| active record | `state/active-release.json` | regular-file `schema` |
| trust high watermarks | `state/release-trust.json` | regular-file `schema` |
| optional rollback record | `state/update-rollback.json` | regular-file `ephemeral` reservation |
| optional recovery-executor record | `state/update-executor.json` | regular-file `ephemeral` reservation |
| retained rollback payload root | `rollback` | directory `content` |
| retained rollback payload set | `rollback/<rollback-payload-id>` and its exact inventory | directory and regular-file `content` artifacts |
| update execution plans/journals | under the Spec 1 lifecycle coordinator roots | direct lifecycle bookkeeping |
| version bundle root | `releases/<stable-semver>/<platform>-<architecture>` | directory `content` |
| bundle inventory and files | exact children of that bundle root | regular-file `content` plus required directories |

`<stable-semver>` is the canonical stable spelling accepted by §4.3. Platform is exactly `darwin`;
architecture is exactly `arm64` or `x64`. A bundle path is never derived from a URL component or
archive name.

Every active or retained rollback bundle file is an exact manifest artifact. The signed bundle
inventory contains only bundle-tree directories and files; it never contains itself or any retained
metadata document. The three retained metadata documents are separate exact manifest artifacts at
the hash-derived paths above. The signed bundle inventory, retained metadata, and rollback-payload
inventory do not independently grant deletion authority: each removal set must equal its relevant
manifest partition before update, rollback, or uninstall can remove anything. Metadata shared by the
active and rollback identities is retained once and removed only when neither identity references its
hash. Directories are removed only in deepest-first order after their complete enumerated child set
is absent. Unknown children preserve the directory and produce recovery-required state.

### 3.3 Active and trust records

```ts
interface ActiveReleaseRecordV1 {
  readonly schemaVersion: 1;
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
  readonly delegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly releaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly bundleManifestHash: LowerHexSha256;
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
  readonly activatedAt: UtcTimestampV1;
}

interface ReleaseTrustStateV1 {
  readonly schemaVersion: 1;
  readonly highestDelegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly delegatedReleaseKeyId: LowerHexSha256;
  readonly highestReleaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly highestAcceptedReleaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
}

interface ReleaseIdentityV1 {
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
  readonly delegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly releaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly bundleManifestHash: LowerHexSha256;
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
}

interface ReleaseMetadataIdentityV1 {
  readonly delegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly delegatedReleaseKeyId: LowerHexSha256;
  readonly releaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
}
```

Both persisted records are at most 16 KiB before parsing. Their validators enforce all cross-field
equalities against `ReleaseIdentityV1`, the retained signed metadata, and the guarded bundle. Trust
state never rolls back. Delegation and release-index watermarks advance independently: lower sequence
refuses, and equal sequence is legal only with the identical delegation or index hash. The selected
release watermark compares `releaseSequence`; lower is legal only for the already guarded active or
retained rollback identity and never authorizes an online downgrade, while equality requires the
identical `releaseIdentityHash`. A higher selected sequence replaces that hash. Consequently a newer
index may repeat an already accepted release, but it cannot redefine that release sequence.

## 4. Signed release metadata

### 4.1 Canonical signature envelope

All signed documents use an exact envelope:

```ts
interface Ed25519SignatureV1 {
  readonly algorithm: "ed25519";
  readonly keyId: LowerHexSha256;
  readonly signature: Base64UrlNoPaddingV1; // exactly 64 decoded bytes
}

interface SignedReleaseDocumentV1<TKind extends string, TSigned> {
  readonly schemaVersion: 1;
  readonly kind: TKind;
  readonly signed: TSigned;
  readonly signatures: readonly [Ed25519SignatureV1];
}

interface OfficialReleaseOriginV1 {
  readonly scheme: "https";
  readonly host: LowercaseAsciiDnsNameV1;
  readonly port: 443;
  readonly pathPrefix: OfficialReleasePathPrefixV1;
}

type OfficialReleaseAssetOriginV1 = OfficialReleaseOriginV1;
type LowercaseAsciiDnsNameV1 = string &
  { readonly __lowercaseAsciiDnsNameV1: unique symbol };
type OfficialReleasePathPrefixV1 = string &
  { readonly __officialReleasePathPrefixV1: unique symbol };
type OfficialReleaseRelativePathV1 = string &
  { readonly __officialReleaseRelativePathV1: unique symbol };
```

`keyId` is SHA-256 over the 32 raw public-key bytes. The signature input is the ASCII domain
`developer-os/<kind>/v1\0` followed by canonical JSON bytes of `signed` without a trailing LF. The
outer document is canonical JSON plus one LF. Unknown/duplicate keys, noncanonical JSON, an invalid
Unicode scalar, padding in base64url, the wrong decoded length, extra signatures, or the wrong key ID
refuses before semantic use. V1 deliberately has one signature per document, not thresholds.

`LowercaseAsciiDnsNameV1` is `1..253` ASCII bytes and consists of `1..127` lowercase LDH labels of
`1..63` bytes separated by one dot; labels neither begin nor end with hyphen. It rejects a trailing
dot, IP literal, IDN/U-label, wildcard, localhost, and percent encoding. An origin has exactly the
four shown keys and no userinfo/query/fragment; default HTTPS is serialized only as numeric `443`.
`OfficialReleasePathPrefixV1` is `1..2048` ASCII bytes, begins and ends with `/`, and contains
`1..128` nonempty URL-path segments using only unreserved characters plus canonical uppercase
percent triplets; decoded slash, backslash, NUL/control, empty/dot/dot-dot segment, duplicate slash,
or noncanonical triplet refuses. `OfficialReleaseRelativePathV1` uses the same segment grammar and
bound but has no leading/trailing slash and no query or fragment. Resolving a relative path is a
segment append beneath the signed prefix followed by exact origin/prefix revalidation, never generic
URL string resolution.

### 4.2 Root delegation

The launcher package owns this closed handoff, constructed from compiled package constants rather
than product state:

```ts
interface OfflineReleaseTrustV1 {
  readonly schemaVersion: 1;
  readonly handoffProtocol: 1;
  readonly onlineRootKeyId: LowerHexSha256;
  readonly acceptedRoots: readonly OfflineRootKeyV1[1..2];
  readonly delegationLocator: FixedReleaseMetadataLocatorV1;
  readonly indexLocator: FixedReleaseMetadataLocatorV1;
  readonly metadataRedirectOrigins: readonly OfficialReleaseAssetOriginV1[1..4];
}

interface OfflineRootKeyV1 {
  readonly role: "online_current" | "retained_offline_previous";
  readonly algorithm: "ed25519";
  readonly keyId: LowerHexSha256;
  readonly publicKey: Base64UrlNoPaddingV1;
}

interface FixedReleaseMetadataLocatorV1 {
  readonly origin: "https://github.com";
  readonly repositoryPath: "/msolecki/developer-os/releases/latest/download/";
  readonly assetName: "release-key-delegation-v1.json" | "release-index-v1.json";
}
```

There is exactly one `online_current` row and at most one prior row; IDs equal the decoded-key hash,
rows are sorted current then prior, and the two locators have different fixed asset names. The
launcher renders canonical JSON plus LF, at most 64 KiB, into a fresh pipe, passes only read end FD 3,
closes its write end, and never exposes the root through argv/environment/product files. The CLI
accepts update transport only with that exact inherited descriptor: guarded pipe type, EOF within
64 KiB, strict canonical parse, no extra inherited FD, and launcher-admitted parent executable. A
direct bundle invocation has no online update authority. The CLI reads and closes FD 3 before
context construction; transport/planner/verifier/vendor descendants inherit no trust descriptor.

Online delegation must verify with `onlineRootKeyId`; retained active/rollback metadata may verify
with either accepted root. A Homebrew root rotation installs the new current root and retains the
immediately previous root solely for offline validation, so an old active bundle can still start and
then verify new online metadata through the handoff. A second rotation must first update/re-sign any
still-retained release using the oldest root; otherwise launcher admission refuses. The fixed
locators may follow at most one redirect to `metadataRedirectOrigins`, checked before the request;
the verified delegation's metadata/asset origins must be a subset of the handoff set.

The online root signs:

```ts
interface ReleaseKeyDelegationV1 {
  readonly sequence: UInt64DecimalV1;
  readonly releaseKey: {
    readonly algorithm: "ed25519";
    readonly keyId: LowerHexSha256;
    readonly publicKey: Base64UrlNoPaddingV1; // exactly 32 decoded bytes
  };
  readonly metadataOrigins: readonly [OfficialReleaseOriginV1];
  readonly assetOrigins: readonly OfficialReleaseAssetOriginV1[1..4];
}
```

The delegation document is at most 64 KiB. Origins are exact lowercase HTTPS scheme/host/port/path-
prefix records, never userinfo, query, fragment, wildcard, IP literal, IDN, or default-port alias.
The official metadata origin is the Developer OS GitHub Releases namespace for
`msolecki/developer-os`. Asset redirect origins are root-delegated so GitHub asset hosting can change
without trusting a response-provided host. Rotating the release key or asset-origin set increments
the delegation sequence. Root-key replacement requires a Homebrew launcher update.

There is no expiry field in v1. A never-updated installation can therefore be frozen at valid old
metadata until it has stored a higher sequence. The product has no transparency log and does not
claim freeze resistance before first observation.

### 4.3 Release index and selection

The delegated release key signs:

```ts
interface ReleaseIndexV1 {
  readonly sequence: UInt64DecimalV1;
  readonly latestVersion: StableSemverV1;
  readonly releases: readonly ReleaseIndexEntryV1[1..10_000];
}

interface ReleaseIndexEntryV1 {
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly minimumLauncherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
  readonly bundles: readonly [DarwinArm64BundleV1, DarwinX64BundleV1];
}

interface ReleaseBundleReferenceV1 {
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly archiveFormat: "zstd-ustar-v1";
  readonly archivePath: OfficialReleaseRelativePathV1;
  readonly archiveBytes: UInt64DecimalV1;
  readonly archiveSha256: LowerHexSha256;
  readonly manifestPath: OfficialReleaseRelativePathV1;
  readonly manifestBytes: UInt64DecimalV1;
  readonly manifestSha256: LowerHexSha256;
}

type DarwinArm64BundleV1 = ReleaseBundleReferenceV1 & {
  readonly platform: "darwin";
  readonly architecture: "arm64";
};

type DarwinX64BundleV1 = ReleaseBundleReferenceV1 & {
  readonly platform: "darwin";
  readonly architecture: "x64";
};
```

The index is at most 4 MiB. Releases are unique, sorted by increasing release sequence, and their
versions strictly increase under numeric SemVer comparison. `latestVersion` equals the last entry.
Stable SemVer is `0.0.0` or a nonzero/non-leading-zero `major.minor.patch`; prerelease and build
metadata are illegal. Numeric components are `0..4294967295` and selection never uses locale or
lexical comparison.

`releaseIdentityHash` is SHA-256 over
`developer-os/release-identity/v1\0` followed by canonical bytes of the selected entry's version,
release sequence, minimum launcher protocol, update protocol, and exact architecture-specific bundle
reference. It deliberately excludes delegation/index sequence so a later signed index may repeat an
unchanged release, and includes every archive/manifest identity field so the same release sequence
cannot be rebound to different bytes. An index validator rejects two entries with one release
sequence or one version even when their hashes would otherwise differ.

Without `--version`, update selects `latestVersion`. With `--version`, it selects the exact entry.
The target must be greater than the active version, except that the exact active version reports
`up_to_date` and an exact previously trusted higher release may be reinstalled after manual rollback.
Every other downgrade is invalid input. Rollback is the sole downgrade surface.

### 4.4 Bundle manifest and archive admission

The release index hash-binds a canonical `ReleaseBundleManifestV1`. The corresponding archive is
exactly one Zstandard standard frame containing one POSIX.1-1988 ustar stream; there is no
parser-selected format:

```ts
interface ReleaseBundleManifestV1 {
  readonly schemaVersion: 1;
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
  readonly entrypoint: BundleRelativePathV1;
  readonly runtimeEntrypoint: BundleRelativePathV1;
  readonly plannerEntrypoint: BundleRelativePathV1;
  readonly verifierEntrypoint: BundleRelativePathV1;
  readonly entries: readonly ReleaseBundleEntryV1[1..200_000];
}

type ReleaseBundleEntryV1 =
  | { readonly path: BundleRelativePathV1; readonly kind: "directory"; readonly mode: 448 }
  | {
      readonly path: BundleRelativePathV1;
      readonly kind: "file";
      readonly mode: 384 | 448;
      readonly bytes: UInt64DecimalV1;
      readonly sha256: LowerHexSha256;
    };
```

Mode decimal 384 is `0600`; 448 is `0700`. Files are never group/other accessible. Each named
entrypoint is a `0700` file in the inventory. `BundleRelativePathV1` is the exact ustar-representable
subset: NFC UTF-8, 1–255 bytes, 1–32 POSIX components, final name field `1..100` bytes and optional
joined parent prefix `1..155` bytes split only at its final `/`; every component is `1..100` bytes
with no empty, dot, dot-dot, control/format, backslash, colon, leading hyphen, or NUL component. The
absolute installed path must also fit `CanonicalAbsolutePathV1`. Paths are unique under exact, NFC,
and folded macOS comparison and sorted by unsigned UTF-8 bytes, parents before children.

Before extraction the updater enforces:

- delegation: 64 KiB;
- release index: 4 MiB;
- bundle manifest: 16 MiB;
- archive/Zstandard frame: 2 GiB;
- one file: 512 MiB expanded;
- aggregate expanded bytes: 8 GiB;
- entries: 200,000;
- path/component bounds above;
- process resident memory: 256 MiB attributable streaming budget;
- attempt-owned temporary bytes: 12 GiB including archive, extraction, and planner framing.

The Zstandard frame has a content-size field equal to the observed decompressed tar bytes, checksum
enabled and valid, no dictionary ID, and no skippable, concatenated, reserved, or trailing frame or
byte. Its window and decompressed output are bounded before allocation. The ustar stream accepts only
512-byte POSIX ustar headers with valid checksum, zero-filled unused bytes, canonical ASCII-octal
mode/size fields, `uid == gid == 0`, empty owner/group names, and type `0`/NUL regular file or `5`
directory. Prefix/name fields must combine to the exact manifest path. PAX, GNU extensions, base-256
numbers, long-name/link records, sparse records, and every non-ustar magic/version refuse. Directory
size is zero; file size and zero padding are exact. Exactly two zero blocks terminate the archive and
no decompressed byte follows them.

The archive has exactly one entry for each manifest row in manifest order and no other entry.
Absolute/traversing or
noncanonical names, duplicate/folded names, links, devices, FIFOs, sockets, sparse files, xattrs, ACL
records, resource forks, ownership overrides, size disagreement, truncation, trailing data, checksum
mismatch, or a created entry not equal to its reopened inode/hash refuses. Extraction uses no-follow,
exclusive create, guarded parent descriptors where available, streamed writes, file sync, directory
sync, and before/after identities. `archivePath` must end in `.tar.zst`; no content sniffing or suffix
fallback changes the selected parser.

### 4.5 Fixed-origin transport

The update transport performs bounded HTTPS `GET` only. It sends no body, cookie, authorization,
user-supplied header, referrer, client certificate, or ambient proxy value. Environment proxy and
credential variables are removed rather than merged. DNS, connect, TLS, headers, idle, body, and
wall-clock limits are inherited across each top-level planning/apply attempt; descendants cannot
reset them.

The delegation/index requests use only the two launcher-handoff locators and may follow at most one
301/302/303/307/308 redirect to an exact handoff metadata-redirect origin. After delegation
verification, a bundle/manifest request may follow at most one such redirect to an exact delegated
asset origin. No request follows a second redirect. Every redirect target is re-normalized and
rechecked before a request.
Non-HTTPS, userinfo, query/fragment changes not present in the signed relative reference, a host not
in delegation, or an effective URL mismatch refuses before the second request.

Response headers are capped at 64 KiB, idle at 30 seconds, one response body at its declared bound,
and the complete top-level update planning/apply network phase at 15 minutes. Timeout terminates and
reaps the whole transport process graph where a subprocess transport is used. Raw bodies, URLs after
the fixed public prefix, and response diagnostics are discarded without logging or persistence.

## 5. `ManagedArtifactV2` and manifest state

### 5.1 Exact V2 artifact union

V2 is a tagged union, never a bag of optional verification fields:

```ts
interface ManagedArtifactCommonV2 {
  readonly owner: ArtifactOwner;
  readonly path: CanonicalAbsolutePathV1;
  readonly productVersion: StableSemverV1;
  readonly existedBefore: boolean;
  readonly beforeHash: LowerHexSha256 | null;
  readonly backupRelativePath: VaultFreeRelativePathV1 | null;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly verifiedAt: UtcTimestampV1;
}

type ManagedArtifactV2 =
  | (ManagedArtifactCommonV2 & {
      readonly kind: "file";
      readonly verification: {
        readonly mode: "content";
        readonly installedHash: LowerHexSha256;
      };
    })
  | (ManagedArtifactCommonV2 & {
      readonly kind: "file";
      readonly verification: {
        readonly mode: "schema";
        readonly schemaId: ManagedArtifactSchemaIdV1;
        readonly installedHash: LowerHexSha256;
      };
    })
  | (ManagedArtifactCommonV2 & {
      readonly kind: "file";
      readonly verification: { readonly mode: "ephemeral" };
    })
  | (ManagedArtifactCommonV2 & {
      readonly kind: "directory";
      readonly verification: { readonly mode: "content" };
    })
  | (ManagedArtifactCommonV2 & {
      readonly kind: "symlink";
      readonly verification: {
        readonly mode: "content";
        readonly installedHash: LowerHexSha256;
      };
    });
```

`ArtifactOwner` and `MergeStrategy` retain the V1 sets. `config-entry` remains illegal in stored
manifests until a later approved semantic-drift design. Source is 1–4096 safe UTF-8 bytes.
`backupRelativePath` is product-backup-relative only, never absolute/traversing, and at most 4096
bytes.

Restore evidence is legal only for regular-file `content`/`schema`: `existedBefore: true` requires
both `beforeHash` and `backupRelativePath`; false requires both null. Directory, symlink, and
ephemeral arms require false/null/null. An ephemeral reservation has no installed hash and absence is
clean; if present, it must be a guarded owner-owned `0600`, single-link regular file before its
own record validator may use it.

Initial schema IDs are a closed non-empty set:

```ts
type ManagedArtifactSchemaIdV1 =
  | "developer-os-config-v1"
  | "lifecycle-id-allocator-v1"
  | "active-release-record-v1"
  | "release-trust-state-v1";
```

Adding a schema ID requires its strict validator, byte/semantic bounds, migration behavior, and a
non-vacuous exact-set test in the same change. Schema drift compares type plus strict semantic
validity; it does not treat an intentional content change as drift. `installedHash` still binds the
last product-observed bytes for preconditions and coordinated manifest updates.

Directory `content` verifies directory type only. Symlink `content` hashes the link target and is
legal only for product-created links after a safe link-specific transaction operation exists; this
specification creates none.

### 5.2 Installation manifest

```ts
interface InstallationManifestV2 {
  readonly schemaVersion: 2;
  readonly productVersion: StableSemverV1;
  readonly installedAt: UtcTimestampV1;
  readonly artifacts: readonly ManagedArtifactV2[1..1_000_000];
}
```

The manifest is canonical JSON plus LF and at most 64 MiB before parsing. Artifacts are unique under
declared exact/NFC/folded paths, sorted by unsigned UTF-8 path bytes then owner/kind/mode, and each
path passes the declared and canonical ownership policies before any read or removal. Unknown keys
refuse at every depth. The product version of every artifact may be older than the manifest product
version only when that owner is intentionally retained unchanged by the target plan; the plan records
the reason and owner provider validates it.

`DriftKind` gains `schema_invalid`. V2 drift is:

| Arm | Clean state |
|---|---|
| file/content | guarded file bytes equal `installedHash` |
| file/schema | guarded file passes named schema; current bytes may differ from `installedHash` |
| file/ephemeral | absent, or guarded regular-file metadata accepted by the owning runtime schema |
| directory/content | guarded directory exists |
| symlink/content | guarded link target hash equals `installedHash` |

Any wrong kind is `type_changed`; missing is clean only for ephemeral; wrong content/target uses the
existing classes; schema refusal is `schema_invalid`. A V1 or V2 read uses guarded parent
canonicalization, leaf-preserving no-follow opens, size-before-allocation, and before/after inode
checks.

### 5.3 Manifest direct-write participant

The manifest remains Foundation's durable direct-write exception. It is not nested inside a file
transaction. Spec 2 makes the exception recoverable through:

```ts
type ManifestBytesStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly bytes: ManifestPayloadRefV1 | null;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly size: UInt64DecimalV1;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

interface BootstrapExpectedPayloadRefV1 {
  readonly kind: "bootstrap_expected";
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: Integer[0..999_999];
  readonly path: BootstrapPayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: Integer[0..536_870_912];
  readonly mode: 384 | 448;
}

interface UpdateExpectedPayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: Integer[0..1_099_999];
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: Integer[0..536_870_912];
  readonly mode: 384 | 448;
}

type ManifestPayloadRefV1 =
  | (UpdateExpectedPayloadRefV1 & { readonly path: ManifestPayloadPathV1 })
  | BootstrapExpectedPayloadRefV1;

interface ManifestStatePlanV1 {
  readonly schemaVersion: 1;
  readonly participantId: ManifestParticipantIdV1;
  readonly envelope:
    | { readonly kind: "fresh_v2_init"; readonly id: FreshV2InitIdV1 }
    | { readonly kind: "v1_migration"; readonly id: ManifestMigrationIdV1 }
    | { readonly kind: "lifecycle"; readonly id: LifecycleCoordinatorIdV1 };
  readonly bindings: {
    readonly foundationTransactions: {
      readonly count: Integer[0..1_000_000];
      readonly orderedIdsHash: LowerHexSha256;
    };
    readonly externalEffects: readonly ManifestExternalEffectRefV1[0..1];
  };
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: ManifestBytesStateV1;
  readonly after: ManifestBytesStateV1;
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

type ManifestParticipantIdV1 =
  | AllocatedLifecycleIdV1<"mf">
  | `mf_fi_${LowercaseUuidV4}`
  | `mf_mm_${LowercaseUuidV4}`;

interface ManifestExternalEffectRefV1 {
  readonly kind: "codex_registration" | "git" | "launchd";
  readonly id: OwnerExternalEffectIdV1 | GitEffectIdV1 | LaunchdEffectIdV1;
  readonly planHash: LowerHexSha256;
}

type OwnerExternalEffectIdV1 = AllocatedLifecycleIdV1<"oe">;

type FoundationParticipantSlotV2 =
  | "fresh_init_artifacts"
  | "v1_migration_artifacts"
  | "owner_forward_files"
  | "owner_inverse_files"
  | "schema_forward"
  | "schema_inverse";

type FoundationTransactionIdV2 =
  | AllocatedLifecycleIdV1<"tx">
  | `tx_fi_${LowercaseUuidV4}_${TenDigitZeroPaddedOrdinalV1}_${"f" | "c"}`
  | `tx_mm_${LowercaseUuidV4}_${TenDigitZeroPaddedOrdinalV1}_${"f" | "c"}`;

interface FoundationParticipantRefV2 {
  readonly id: FoundationTransactionIdV2;
  readonly slot: FoundationParticipantSlotV2;
  readonly role:
    | { readonly kind: "forward"; readonly compensationId: FoundationTransactionIdV2 | null }
    | { readonly kind: "compensation"; readonly forwardId: FoundationTransactionIdV2 };
  readonly mutations: readonly FoundationMutationRefV1[1..256];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly planHash: LowerHexSha256;
  readonly initialJournal: {
    readonly finalPath: CanonicalAbsolutePathV1;
    readonly plannedBytesHash: LowerHexSha256;
    readonly staged:
      | (UpdateExpectedPayloadRefV1 & { readonly path: FoundationInitialJournalPayloadPathV1 })
      | BootstrapExpectedPayloadRefV1;
  };
}
```

For a present `before`, `hash` binds the strict V1/V2 bytes still at the guarded manifest path and
`bytes` is null; its original encoding is retained by the later tombstone. A present `after` requires
a non-null `ManifestPayloadRefV1` whose construction evidence reopens to identical bytes, uses mode `0600`, remains at
most 64 MiB, and parses as canonical V2. A lifecycle envelope requires `update_expected`; a
fresh/migration envelope requires `bootstrap_expected` with the matching outer ID and a complete
`BootstrapPayloadEvidenceV1` reached under that outer journal before the manifest cursor. Thus the immutable plan remains below 16 MiB even when a manifest approaches its 64-MiB
payload bound. The sibling tombstone is exactly
`.installation-manifest.<participant-id>.json.tombstone`, owner-owned `0600`, and same-device.
Apply moves the guarded present preimage no-replace to the tombstone, syncs, then no-replace publishes
and verifies a present postimage or durably records committed absence. Rollback uses no-replace moves.
Every absent/present/preimage/postimage/tombstone third state preserves all evidence as exit 6.

A lifecycle `ManifestPayloadPathV1` is derived exactly as
`staging/lifecycle/<coordinator-id>/participants/manifest/<participant-id>/after.json`; a bootstrap
manifest uses its exact ordinal-derived `BootstrapPayloadPathV1` from §6.3. Envelope/coordinator,
participant ID, path, hash, length, mode, and the sole plan ref agree in both directions. A lifecycle
expected ref binds the enclosing update-construction plan and exact ordinal; its device/inode comes
only from matching construction evidence. Bootstrap authority comes only from its payload evidence.
No codec accepts a caller absolute path or another participant's
payload, and closure/compaction enumerate these derived paths as an exact set before removing them.

The coordinator retains plan bytes, both manifest byte states, and tombstone evidence through its
point of no return. Terminal compaction removes the tombstone before the immutable participant plan
and never unlinks a concurrent manifest.
`bindings.foundationTransactions` is recomputed from the enclosing plan's complete ordered,
non-duplicate manifest-affecting Foundation ID sequence: `count` equals its length and
`orderedIdsHash` hashes `developer-os/manifest-foundation-bindings/v1\0` plus the canonical ID array.
`bindings.externalEffects` remains the complete exact ordered external-effect list. Together they
equal the enclosing bootstrap/lifecycle plan's complete manifest-affecting participant partition;
missing, extra, duplicate, reordered, wrong-kind, or wrong-hash bindings refuse both plans. A
bootstrap plan has an empty external-effect set. This is a bijection check, not informational
metadata.

A fresh-init manifest participant is exactly `mf_` plus its `fi_<uuid>` outer ID; a migration
participant is exactly `mf_` plus its `mm_<uuid>` outer ID. Those deterministic bootstrap arms need
no installed allocator. The allocated `mf_<64-lowercase-hex>` arm is legal only after the V2
nonce/allocator handoff and only inside an ordinary lifecycle/update coordinator. An enclosing
operation rejects either wrong arm or a mismatched suffix.
The matching `envelope` arm/ID is mandatory; an update leaf requires `lifecycle` and an ID equal to
the V2 coordinator, while Spec 1's ordinary manifest participant requires its V1 coordinator ID.

`FoundationParticipantRefV2` is an additive Spec 2 codec and is never accepted by
`LifecycleCoordinatorPlanV1` or any Spec 1 leaf. Fresh init admits only
`fresh_init_artifacts`; V1 migration only `v1_migration_artifacts`; an update-apply owner plan only
`owner_forward_files`; a rollback owner plan only `owner_inverse_files`; and schema leaves only the
direction-matching `schema_forward` or `schema_inverse`. Within each enclosing plan, refs are ordered
by ID, IDs are unique, mutation paths are unique, and the concatenated mutations equal its complete
non-empty Foundation-owned operation partition in canonical path order. Each ref has at most 256
mutations, and every pre-point-of-no-return forward ref has the distinct paired compensation ref
required by Spec 1; the displayed owner/schema/bootstrap maxima count both halves. Cardinality bounds
are also constrained by the shown ref bounds and the 16-MiB plan cap. Missing, empty, extra,
reordered, cross-slot, unpaired, or unbound refs refuse both codecs.

Fresh/migration refs use only their deterministic `tx_fi_...`/`tx_mm_...` arms: UUID equals the
outer envelope, ordinal is the canonical forward-pair ordinal, the forward ID ends `_f`, and its
distinct compensation ID has the same prefix/ordinal ending `_c`. They are available before the
installed nonce/allocator exists and are legal nowhere else. Post-handoff update/rollback refs use
only `AllocatedLifecycleIdV1<"tx">`; Spec 1's legacy UUID transaction-ID arm is never admitted by a
V2 ref.

The same envelope split applies to `initialJournal.staged`: fresh/migration refs require a matching
`bootstrap_expected` payload of `1..1_048_576` bytes and mode `0600`; lifecycle refs require an
`update_expected` ref with the same bounds and matching construction evidence. `plannedBytesHash`, staged hash, final path,
ID, and the exact initial journal bytes agree. Bootstrap expected refs contain no preexisting inode;
their later payload evidence supplies it under the already durable bootstrap journal.

`FoundationParticipantRefV2.planHash` is SHA-256 over the exact ASCII domain
`developer-os/foundation-participant-plan/v2\0` followed by no-LF canonical bytes of
`{ schemaVersion: 2, id, slot, role, mutations, maximumJournalBytes, initialJournal: { finalPath,
staged } }` in that key order. `staged` projects the exact tagged arm shown above but omits its
content `hash`: lifecycle `update_expected` contributes kind, coordinator ID, ordinal, branded path,
bytes, and mode; bootstrap `bootstrap_expected` contributes kind, bootstrap ID, ordinal, branded
path, bytes, and mode. The projection excludes `planHash`, `initialJournal.plannedBytesHash`, and
that staged content hash to avoid self-reference.
After computing `planHash`, the codec constructs the exact initial planned-journal bytes containing
that hash and computes their raw SHA-256; both `plannedBytesHash` and the full staged arm's `hash`
must equal it. Every enclosing ref,
construction/bootstrap payload row, and reopened planned journal independently recomputes both
digests and requires exact equality; the V1 Foundation digest/domain is never reused.
A lifecycle `FoundationInitialJournalPayloadPathV1` is derived exactly as
`staging/lifecycle/<coordinator-id>/participants/foundation/<transaction-id>/initial-journal.json`;
bootstrap refs use only their ordinal-derived payload path. Both are included in their envelope's
exact-set/orphan/terminal-closure inventory.

Execution cursors count only the forward-role projection: at most 256 bootstrap, 3,907 owner, or 391
schema refs. Compensation cursors address the reverse reached forward projection and dispatch its
paired compensation ref; terminal closure alone counts both halves. This is why bootstrap plans
permit 512 total refs while `nextFoundationParticipant` remains capped at 256.

## 6. V1 migration and V2 new init

### 6.1 Fresh new init

Fresh `init --dry-run` remains byte-inert and reports the complete V2 created/unchanged set. A real
fresh init uses Spec 1's transient `LifecycleBootstrapLockV1`, repeats the bounded absent-home
inventory under that lock, and creates V2 directly. After at most creating the admitted empty
product-home/`state` skeleton and exact bootstrap lock, but before any other durable path, it
no-replace-publishes and syncs:

```ts
interface FreshV2InitPlanV1 {
  readonly schemaVersion: 1;
  readonly operation: "fresh_v2_init";
  readonly id: FreshV2InitIdV1;
  readonly admittedExternalShapeHash: LowerHexSha256;
  readonly v2ManifestHash: LowerHexSha256;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly planPath: ExactProductStatePathV1;
  readonly journalSlot0Path: ExactProductStatePathV1;
  readonly journalSlot1Path: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
  readonly maximumPlanBytes: Integer[1..268_435_456];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly maximumStagingEntries: Integer[1..1_000_000];
  readonly payloads: readonly BootstrapPayloadPlanV1[1..1_000_000];
  readonly createdPaths: readonly PlannedCreatedPathV1[1..1_000_000];
  readonly foundationParticipants: readonly FoundationParticipantRefV2[2..512];
  readonly launchabilityPaths: readonly PlannedCreatedPathV1[7..200_006];
  readonly manifest: ManifestStatePlanV1;
}

interface BootstrapExternalShapeProjectionV1 {
  readonly entries: readonly [
    BootstrapExternalShapeEntryV1,
    BootstrapExternalShapeEntryV1,
    BootstrapExternalShapeEntryV1
  ];
}

interface BootstrapExternalShapeEntryV1 {
  readonly role: "product_home" | "state_directory" | "bootstrap_lock";
  readonly pathHash: LowerHexSha256;
  readonly kind: "directory" | "regular_file";
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 384 | 448;
  readonly nlink: PositiveUInt32V1;
  readonly size: UInt64DecimalV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type FreshV2InitIdV1 = `fi_${LowercaseUuidV4}`;

interface FreshV2InitJournalV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1;
  readonly planHash: LowerHexSha256;
  readonly slot: 0 | 1;
  readonly sequence: UInt64DecimalV1;
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly phase: "planned" | "payload_staging" | "creating" | "foundation_applying" |
    "launchability_publishing" | "manifest_publishing" | "verifying" | "compensating" |
    "finalized" | "rolled_back" | "retaining" | "retained";
  readonly direction: "forward" | "compensating";
  readonly nextPayload: Integer[0..1_000_000];
  readonly payloadWriteState: BootstrapPayloadWriteStateV1;
  readonly nextCreatedPath: Integer[0..1_000_000];
  readonly nextFoundationParticipant: Integer[0..256];
  readonly nextLaunchabilityPath: Integer[0..200_006];
  readonly manifestCursor: Integer[0..3];
  readonly compensationNext: Integer[-1..2_200_264] | null;
  readonly payloadRetentionPart: "staged_file" | "evidence" | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly retentionNext: Integer[0..2_200_526] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}
```

`admittedExternalShapeHash` is SHA-256 over
`developer-os/fresh-v2-external-shape/v1\0` plus no-LF canonical bytes of
`BootstrapExternalShapeProjectionV1`. Its three rows are exactly product home, `state`, and the held
bootstrap lock in that order; `pathHash` is raw SHA-256 of the canonical absolute path bytes and no
path or other filesystem value is included. The complete bootstrap-locked second inventory must
contain exactly those rows before plan publication. It contains no created-by-attempt boolean.
The first two rows are owner-only directories with their observed link count/size; the lock row is
the exact owner-only single-link `0600` zero-byte regular file.
Initial execution recomputes the projection from still-open guarded descriptors; recovery requires
the unchanged surviving rows plus only the plan/evidence-derived forward prefix. Role/order/path/
metadata/identity mismatch or any unprojected child refuses rather than treating this digest as a
generic content hash.

The exact final paths are `state/fresh-v2-init.<id>.plan.json`,
`state/fresh-v2-init.<id>.journal.0.json`, `state/fresh-v2-init.<id>.journal.1.json`, and
`staging/fresh-v2-init/<id>`. Their modes, byte bounds, plan-hash binding, two-slot journal rewrite
discipline, active-envelope admission, and terminal same-parent retention are the
`fresh-v2-init`-prefixed equivalents of §6.3 and §6.4. The immutable plan and initial journal slot
are parent-synced before `payloads[0]`. The ordered cursor is payloads, ordinary
created paths, Foundation participants, launchability paths, manifest preserve/publish, then full verification. Durable V2 manifest
publication is the point of no return. Before it, compensation restores manifest absence and
retains only journaled attempt-created identities in reverse; it never moves a pre-plan empty
skeleton or pre-existing Brain path. At/after it, recovery force-forwards verification and
retention. A plan or journal mismatch, mutation without the journal, unknown child, or cursor third state preserves all
evidence as exit 6; only `init` resumes the envelope.

As in migration, `createdPaths[0]` is the exact permanent global-lock transition. Later paths use the
closed launchability order defined in §6.3. The process creates/acquires that lock while still holding bootstrap, records
the post-create identity, and holds both descriptors through terminal retention.

With that durable envelope present, fresh init:

1. creates the existing Foundation product/Brain skeleton through its current ownership partitions;
2. seeds the currently packaged fallback bundle into the exact product-owned release root;
3. publishes and verifies the three retained signed-metadata files for that copied bundle;
4. creates `LifecycleInstallNonceV1` and `LifecycleIdAllocatorV1 { nextCounter: "0" }` through their
   approved prefix/recovery grammars;
5. creates the three exact lifecycle journal directories, rollback root, and Spec 1's complete
   runtime/lease/log plus update-control reservation set;
6. publishes and verifies initial trust for the packaged release;
7. publishes `ActiveReleaseRecordV1` last among launchability state, only after the complete copied
   bundle, metadata, trust, nonce/allocator, roots, and reservations verify;
8. writes the complete V2 manifest through a bootstrap-owned `ManifestStatePlanV1`; and
9. verifies the full install before moving attempt-created residue and the transient lock inode to
   their plan-derived same-parent retained tombstones while its descriptor remains held.

The package-manager fallback carries the root-verified delegation, release index, and bundle
manifest that identify its own stable release. Fresh init verifies those packaged bytes exactly as
an online update would, without transport, before it derives the initial active/trust records and
copies the fallback inventory into product-owned storage.

No network, vendor process, model, Git, launchd, or Brain migration runs. The global lifecycle lock
is created only after the bootstrap-locked second inventory. Before the manifest point of no return,
compensation may retain it only through its exact `createdPaths[0]` identity; once that point is
durable, the lock is permanent and never becomes a retention row.

### 6.2 V1 admission and mapping

A present V1 manifest is locally migratable only through `developer-os init`, never implicitly by a
Spec 1 `config`, `git`, or `automation` command. Before mutation, migration requires:

- strict migratable-V1 parse and exact duplicate-path validation as bounded below;
- no incomplete or malformed Foundation transaction;
- zero V1 managed drift;
- guarded declared/canonical ownership and backup paths;
- every `existedBefore: true` regular-file backup present as a guarded regular file whose bytes equal
  `beforeHash`;
- no V1 directory with `existedBefore: true`;
- no V1 symlink or `config-entry` artifact;
- no leaf or V1 declared/canonical claim at any V2-only lifecycle, release, active, trust, rollback,
  journal-directory, runtime reservation, lease, log, nonce, allocator, or activation path;
- sufficient aggregate product-home capacity for current bundle seed, forward/inverse state,
  journals, staging, and backups.

The shipped V1 validator is intentionally broader than V2. Migration therefore accepts only this
closed `MigratableInstallationManifestV1` subset, checked completely after the guarded manifest read
and before any managed-artifact or backup byte is opened:

- encoded manifest size is `1..67_108_864` bytes and the bytes equal the legacy writer's exact
  compact `JSON.stringify(validatedClone) + LF` encoding; this rejects duplicate keys, alternate
  whitespace, trailing data, and non-round-tripping values;
- `productVersion` and every artifact `productVersion` are `StableSemverV1`; `installedAt` and every
  `verifiedAt` are the exact calendar-valid UTC-millisecond `UtcTimestampV1` form;
- artifacts are `1..1_000_000`, with the V1 exact key sets, supported owner/merge enums, and unique
  exact/NFC/folded paths;
- every path is an NFC `CanonicalAbsolutePathV1` in its current owner policy; every source is the
  exact `BoundedArtifactSourceV1` vault-free relative grammar from §2, so an absolute/traversing/
  backslash/control/format source makes the V1 installation non-migratable;
- every hash is lowercase SHA-256; an `existedBefore: false` row has both restore fields null;
- `existedBefore: true` is legal only for a regular file and requires a non-null `beforeHash` plus a
  `backupRelativePath` of `1..4096` NFC UTF-8 bytes, `1..128` POSIX components of `1..255` bytes,
  with no empty/dot/dot-dot, NUL, control/format, backslash, or absolute component; resolving that
  value under the guarded backup root must remain exact and canonical;
- a created directory has `existedBefore: false`, null restore fields, and the legacy
  `installedHash == SHA256(empty bytes)` sentinel; and
- symlink and `config-entry` rows are not in the migratable subset.

The first violated bound refuses as `manifest_v1_not_migratable`. Validation streams/counts the
artifact array and path sets within the manifest byte bound; it never silently truncates, repairs,
normalizes, or widens a legacy value.

The V1 mapping is exact:

- `config.toml` → file/schema `developer-os-config-v1`, retaining the current V1 installed hash;
- every other safe regular file → file/content with the V1 installed hash;
- every product-created directory → directory/content;
- every owner, exact path, product version, restore field, source, merge strategy, and verification
  timestamp is copied unchanged;
- all new lifecycle/release artifacts use `existedBefore: false` and null restore fields.

Migration never turns found state into created state, adopts an existing V2 path, normalizes an
unsafe restore combination, or reads artifact bytes after a collision is known.

### 6.3 Crash-resumable migration

After external preflight, migration acquires the transient bootstrap lock and repeats the complete
inventory. Still holding only that lock, it publishes the immutable bootstrap plan and initial
journal. The first cursor-bound `createdPaths` transition then creates/acquires and identity-rechecks
the permanent global lock in bootstrap-before-global order; both descriptors remain held for every
later mutation.

```ts
interface ManifestMigrationPlanV1 {
  readonly schemaVersion: 1;
  readonly operation: "v1_to_v2";
  readonly id: ManifestMigrationIdV1;
  readonly v1ManifestHash: LowerHexSha256;
  readonly v2ManifestHash: LowerHexSha256;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly paths: ManifestMigrationPathsV1;
  readonly maximumPlanBytes: Integer[1..268_435_456];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly maximumStagingEntries: Integer[1..1_000_000];
  readonly payloads: readonly BootstrapPayloadPlanV1[1..1_000_000];
  readonly createdPaths: readonly PlannedCreatedPathV1[1..1_000_000];
  readonly foundationParticipants: readonly FoundationParticipantRefV2[2..512];
  readonly launchabilityPaths: readonly PlannedCreatedPathV1[7..200_006];
  readonly manifest: ManifestStatePlanV1;
}

type ManifestMigrationIdV1 = `mm_${LowercaseUuidV4}`;

interface ManifestMigrationPathsV1 {
  readonly plan: ExactProductStatePathV1;
  readonly journalSlot0: ExactProductStatePathV1;
  readonly journalSlot1: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

interface ManifestMigrationJournalV1 {
  readonly schemaVersion: 1;
  readonly id: ManifestMigrationIdV1;
  readonly planHash: LowerHexSha256;
  readonly slot: 0 | 1;
  readonly sequence: UInt64DecimalV1;
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly phase:
    | "planned"
    | "payload_staging"
    | "creating"
    | "foundation_applying"
    | "launchability_publishing"
    | "manifest_publishing"
    | "verifying"
    | "compensating"
    | "finalized"
    | "rolled_back"
    | "retaining"
    | "retained";
  readonly direction: "forward" | "compensating";
  readonly nextPayload: Integer[0..1_000_000];
  readonly payloadWriteState: BootstrapPayloadWriteStateV1;
  readonly nextCreatedPath: Integer[0..1_000_000];
  readonly nextFoundationParticipant: Integer[0..256];
  readonly nextLaunchabilityPath: Integer[0..200_006];
  readonly manifestCursor: Integer[0..3];
  readonly compensationNext: Integer[-1..2_200_264] | null;
  readonly payloadRetentionPart: "staged_file" | "evidence" | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly retentionNext: Integer[0..2_200_526] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface PersistedBootstrapLockIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 384;
  readonly nlink: 1;
  readonly size: 0;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type PlannedCreatedPathV1 =
  | {
      readonly kind: "directory";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 448;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "retain_on_compensation";
    }
  | {
      readonly kind: "global_lock";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "retain_on_compensation";
    }
  | {
      readonly kind: "file";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: EffectiveUidV1;
      readonly payload: BootstrapExpectedPayloadRefV1;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "retain_on_compensation";
    };

type BootstrapPlannedParentV1 =
  | { readonly kind: "preexisting"; readonly path: CanonicalAbsolutePathV1;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "created_path"; readonly scope: "ordinary" | "launchability";
      readonly ordinal: Integer[0..999_999] };

interface BootstrapPayloadPlanV1 {
  readonly ref: BootstrapExpectedPayloadRefV1;
  readonly source: BootstrapPayloadSourceV1;
}

type BootstrapPayloadSourceV1 =
  | {
      readonly kind: "guarded_package_file";
      readonly packageRoot: CanonicalAbsolutePathV1;
      readonly packageRootDev: UInt64DecimalV1;
      readonly packageRootIno: UInt64DecimalV1;
      readonly packageInventoryHash: LowerHexSha256;
      readonly relativePath: VaultFreeRelativePathV1;
      readonly sourceBytes: Integer[0..536_870_912];
      readonly sourceHash: LowerHexSha256;
      readonly sourceMode: 384 | 448;
      readonly sourceDev: UInt64DecimalV1;
      readonly sourceIno: UInt64DecimalV1;
    }
  | {
      readonly kind: "plan_derived";
      readonly role: "manifest_after" | "foundation_initial_journal" |
        "foundation_config" | "foundation_staged_digest" |
        "lifecycle_nonce" | "lifecycle_allocator" |
        "active_release" | "release_trust";
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..67_108_863];
      readonly projectionHash: LowerHexSha256;
    }
  | {
      readonly kind: "guarded_migration_preimage";
      readonly authority: BootstrapMigrationPreimageAuthorityV1;
      readonly path: CanonicalAbsolutePathV1;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384 | 448;
      readonly nlink: 1;
      readonly bytes: Integer[0..67_108_864];
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "constant_empty";
      readonly role: "empty_reservation";
    };

type BootstrapMigrationPreimageAuthorityV1 =
  | { readonly kind: "v1_manifest";
      readonly migrationId: ManifestMigrationIdV1;
      readonly v1ManifestHash: LowerHexSha256 }
  | { readonly kind: "v1_managed_artifact";
      readonly migrationId: ManifestMigrationIdV1;
      readonly artifactOrdinal: Integer[0..999_999];
      readonly installedHash: LowerHexSha256 }
  | { readonly kind: "v1_backup_artifact";
      readonly migrationId: ManifestMigrationIdV1;
      readonly artifactOrdinal: Integer[0..999_999];
      readonly beforeHash: LowerHexSha256 };

interface BootstrapPayloadEvidenceV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: Integer[0..999_999];
  readonly stagedPathHash: LowerHexSha256;
  readonly sourceIdentityHash: LowerHexSha256;
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type BootstrapPayloadWriteStateV1 =
  | { readonly state: "idle" }
  | { readonly state: "create_intent"; readonly ordinal: Integer[0..999_999] }
  | { readonly state: "writing"; readonly ordinal: Integer[0..999_999];
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

interface CreatedPathEvidenceV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly scope: "ordinary" | "launchability";
  readonly ordinal: Integer[0..999_999];
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory" | "global_lock";
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly postimageHash: LowerHexSha256 | null;
}
```

A `plan_derived.projectionHash` is SHA-256 over the exact ASCII domain
`developer-os/bootstrap-plan-derived/<role>/v1\0` plus no-LF canonical bytes of `{ role, value }`.
`value` is the complete exact-schema canonical JSON value to be written, not a digest-shaped
summary: `manifest_after` is the full V2 manifest, `foundation_initial_journal` is the complete
timestamped initial journal, `lifecycle_nonce` and `lifecycle_allocator` are their complete initial
state objects, and `active_release` and `release_trust` are their complete records derived from the
verified packaged release. `foundation_config` is the complete strict config value whose payload is
the deterministic existing TOML serialization; `foundation_staged_digest` is the exact content hash
whose payload is lowercase ASCII plus LF. `valueBytes` is the derived payload length excluding its
one final LF. The matching outer plan must contain exactly one source for each singular role and one
digest source for every non-remove Foundation mutation; the value must validate against its closed
schema plus every duplicated plan/ref/hash field. Opaque or merely hash-shaped values refuse.
Publisher and recovery recompute the projection, payload bytes, and
`BootstrapExpectedPayloadRefV1.hash` without a dead process clock.

Arbitrary Foundation content uses `guarded_package_file` or, for V1 migration only,
`guarded_migration_preimage`; it is never mislabeled plan-derived JSON. The only fresh-init exception
is `config.toml`: its runtime absolute `brainPath` cannot exist in immutable Homebrew bytes, so the
closed `foundation_config` role retains the complete strict `DeveloperOsConfigV1` value and
deterministically reconstructs the existing `serializeConfig` TOML bytes without a clock, randomness,
or caller-selected serializer. The closed repeatable `foundation_staged_digest` role retains one
content hash and reconstructs exactly its lowercase ASCII plus LF sidecar. Neither role accepts raw
bytes or an invocation slot. A migration authority selects
exactly the guarded V1 manifest, current managed-artifact row, or legacy backup row at the shown
artifact ordinal. The reopened path/owner/mode/link/size/hash/inode must equal that selected V1
manifest authority and migration ID. `constant_empty` is the sole zero-byte arm, is legal only for
an `empty_reservation`, and requires ref bytes zero plus SHA-256 of empty bytes. No open invocation
slot or caller-selected safe code exists. Only the expected ref hash and guarded source hash fields
are raw byte-content SHA-256 values.

Every `BootstrapExpectedPayloadRefV1` used by a planned file, bootstrap Foundation mutation/initial
journal, or manifest postimage appears exactly once in `payloads`; every payload row is used exactly
once. IDs match the outer envelope, ordinals are contiguous, and paths are derived as
`state/.fresh-v2-init.<id>.<ten-digit-ordinal>.payload` or
`state/.manifest-migration.<id>.<ten-digit-ordinal>.payload`. No arbitrary staging path is accepted.
The matching evidence path replaces `.payload` with `.payload.json`; its sole temp appends
`.<lowercase-v4-uuid>.tmp`. Payloads/evidence are owner-owned single-link regular files, payload mode
equals the ref, evidence is canonical `0600` and at most 1 KiB, and both are on the state device.

Each non-`remove` `FoundationMutationRefV1` carries two distinct matching bootstrap refs: `content`
for the exact standard `<transaction-id>/<ordinal>.bin` blob and `digest` for its adjacent
`.bin.sha256` sidecar; `remove` carries null for both. The content ref hash/bytes equal the mutation's
`contentHash`/`contentSize`, while the digest source is the closed `foundation_staged_digest` value
for that same content hash. At the Foundation cursor the executor no-replace-publishes both evidenced
inodes to those derived standard paths, syncs/reopens them, and only then publishes the participant's
initial journal through the Task 6 bridge. A partial pair is adopted only from those exact two
evidence identities or compensated before participant authority; no process-local Foundation bytes
are needed after the outer plan becomes durable.

The immutable outer plan and initial journal are durable before payload ordinal zero. For each row,
the executor reopens the exact source, secret-screens private bytes before confirming the ref hash,
persists `create_intent`, creates the exact empty staged path no-replace, reopens it, persists the
`writing` inode identity, writes at most the declared bytes, syncs/reopens it, then
publishes `BootstrapPayloadEvidenceV1` and advances `nextPayload`. A crash during the payload write
may only compensate by retaining that exact identity; recovery never adopts its partial contents.
`create_intent` may bind only the exact empty owner/mode/link path at the current ordinal, while a
nonempty unbound path is a third state. `idle` is required between ordinals and after evidence.
`sourceIdentityHash` is SHA-256 over
`developer-os/bootstrap-payload-source/v1\0` plus the no-LF canonical source arm. A guarded package
source must still match root/inventory/relative-path/file inode, mode, size, and hash; a plan-derived
source must recompute the self-contained exact canonical bytes for its closed role; a guarded
migration preimage must still match its selected V1 authority; and constant-empty has no external
source. Guarded-source change/unavailability before the complete payload cursor selects
compensation before any `createdPaths` mutation, retains each exact staged inode then evidence with
`payloadRetentionPart`, and permits a later retry beside the retained evidence. Once every payload is evidenced, guarded
source changes are irrelevant to recovery.

At a file create, recovery no-replace-renames the exact evidenced payload inode to the planned target,
syncs/reopens target and parent, publishes `CreatedPathEvidenceV1` with the same dev/inode/hash, then
advances. A crash between rename and creation evidence is adoptable only through that matching
payload evidence. Manifest/Foundation consumers use the identical rule at their own cursor. Thus no
file bytes are reconstructed from a later Homebrew package and no bootstrap plan contains an inode
that had to exist before the plan. Exact-set tests cover source identity change, every payload/source
write boundary, missing/extra/reused refs, and first-over payload/evidence/envelope counts.

The four final paths are derived, not caller supplied:

```text
plan    = <product home>/state/manifest-migration.<id>.plan.json
journal slot 0 = <product home>/state/manifest-migration.<id>.journal.0.json
journal slot 1 = <product home>/state/manifest-migration.<id>.journal.1.json
staging = <product home>/staging/manifest-migration/<id>
```

The immutable plan has no rename-based publication temp. Under the held bootstrap lock, the executor
creates its exact final path no-replace, retains the open inode, writes and syncs the canonical bytes,
validates through that descriptor, and syncs `state`. An observed partial plan is legal only as the
exact byte prefix of the one reconstructed plan while both journal slots, staging, and all V2-only
targets remain absent; `init` resumes that inode or refuses without deleting it. Journal slots use
the retained-descriptor rewrite protocol in §6.4 and have no temporary path. Every envelope file is
owner-owned, single-link `0600`; the staging root and derived child directories are owner-only
`0700`. The plan is canonical and at most 256 MiB; each journal is canonical and at most 1 MiB. `maximumPlanBytes`,
`maximumJournalBytes`, and the complete path/entry maximum are recomputed before publication rather
than trusted from the document.

The immutable plan's ordered cursor is exact: `payloads` in ordinal order, then `createdPaths` in unsigned UTF-8 path order,
`foundationParticipants` in plan order, `launchabilityPaths` in the fixed order below, manifest
`preserve_before`, manifest `publish_after`, and
full V2 verification. `planned` has all cursors zero. `payload_staging`, `creating`,
`foundation_applying`, `launchability_publishing`, `manifest_publishing`, and `verifying` each own
only their named cursor and require every earlier cursor complete and every later cursor zero.
`compensating` sets `compensationNext` to the greatest reached reversible step and decrements
through the exact reverse order; `rolled_back` requires the V1 manifest and every preimage restored.
Successful manifest publication is the point of no return: once `manifestCursor == 2` is durable,
direction is forever forward, verification/retention force-forward, and compensation is illegal.
`finalized` requires the complete V2 handoff; `retaining` requires a terminal outcome and advances
through the derived retention table. `retained` requires that table complete while both journal
slots and the immutable plan remain durable.

The bootstrap creation order is mandatory and derived, never caller-selected: `createdPaths[0]` is
the exact permanent global-lock leaf and all remaining ordinary skeleton/reservation/schema paths
follow in unsigned-UTF-8 order with parents before children. After Foundation completes,
`launchabilityPaths` contains the copied bundle root/inventory in manifest order, retained
delegation, release index, and bundle manifest, trust, and active release last. It has no ordinary
path and every group is non-empty where its contract requires. `PersistedBootstrapLockIdentityV1` deliberately omits
`createdByAttempt`, `productHomeCreatedByAttempt`, and `stateDirectoryCreatedByAttempt`. Those three
live booleans are never serialized. Durable retention authority comes only from post-plan
`createdPaths` identities; after a crash, any pre-plan empty product/state skeleton is preserved
under Spec 1's bootstrap rule.

For ordinal `n`, the canonical creation-evidence path is derived rather than caller supplied:
`state/.fresh-v2-init.<id>.<scope>.<n-as-ten-decimal-digits>.creation.json` or
`state/.manifest-migration.<id>.<scope>.<n-as-ten-decimal-digits>.creation.json`, where scope is
exactly `ordinary` or `launchability`. Its sole publish temp adds
`.<lowercase-v4-uuid>.tmp`. Both are owner-owned, single-link `0600`, canonical JSON, at most 1 KiB,
and use no-replace publish, parent sync, prefix-only temp, and retained-evidence rules. The
evidence's `pathHash` is SHA-256 over the exact planned absolute path;
`postimageHash` is the file payload hash, SHA-256 of empty bytes for the permanent global lock, and
null for a directory.

Each path transition reopens and identity-checks the planned parent, proves the target absent,
creates the exact postimage no-replace, syncs it and its parent, publishes and syncs the matching
`CreatedPathEvidenceV1`, and only then advances `nextCreatedPath`. A death after target sync but
before evidence publication leaves exactly the current cursor target: recovery may publish its
evidence only when the reopened parent identity, target kind/owner/mode/link count/size/content hash,
and all earlier evidence still equal the immutable plan; any mismatch is a third state. A cursor is
valid only for the exact contiguous evidence prefix below it, with each reopened target's device,
inode, and postimage equal to its evidence. Compensation retains an evidenced target only while
that identity and postimage still match, then retains its evidence, in reverse ordinal order. It
never derives mutation authority from a live boolean or from path spelling alone.

A `preexisting` parent must be the exact reopened plan identity. A `created_path` parent scope/ordinal
must name an earlier cursor position and resolves only through that earlier `CreatedPathEvidenceV1`;
adjacency and lexical containment must agree. Thus a nested parent created after the outer plan never
pretends to have a pre-plan inode, while every create still has durable parent authority.

Before plan publication, feasibility counts every payload/evidence, ordinary and launchability
created target, creation-evidence final/temp, plan, both journal slots, every reachable retained
tombstone, staging child, and directory against the single
`maximumStagingEntries <= 1_000_000` aggregate. The type-level payload/ordinary/launchability bounds
are therefore not entitlements: a plan whose complete reachable envelope exceeds the aggregate is
refused before allocation. Terminal retention moves the plan-derived residue in ordinal order only
after the terminal state no longer needs compensation and permanently preserves the plan and both
journal slots.

The immutable plan and its largest reachable journal are proven feasible and written through their
retained final-path descriptors before any V2-only path. The initial journal slot is synced before
the first staging or V2-only create. Each create is bound to an absent
precondition and attempt-owned identity.
The migration cursor records payload staging, nonce/allocator/global-lock and ordinary creation,
Foundation participants, the bundle/metadata/trust/active launchability suffix, manifest transition,
verification, and retention.

Before durable V2 manifest publication, a semantic failure compensates Foundation participants,
restores the exact V1 manifest, and retains only exact attempt-created filesystem state in reverse
order. After V2 publication, recovery force-forwards V2 verification and retention. A
process death resumes the recorded direction; it never chooses rollback merely because the process
died. Unknown children, identity swaps, a V2-looking path without plan evidence, and illegal partial
nonce/allocator/control state remain recovery-required.

Bootstrap admission enumerates the bounded product/staging/retained inventory and admits at most one
active bootstrap ID plus the retained IDs allowed by §6.4. Before a complete V2 handoff, `init` is
the only command that resumes an active envelope. A journal slot without its plan, two active IDs,
an unknown active temp/child, an over-limit value, a path/identity mismatch, a cursor-inconsistent
postimage, or mutation without durable journal intent preserves all evidence as exit 6. Nothing in
bootstrap compensation, recovery, or terminal retention unlinks a file or removes a directory.

### 6.4 Durable retained bootstrap evidence

This correction supersedes every deletion, guarded-cleanup, journal-temp, and plan-last-compaction
rule in §6.1 and §6.3. V2 bootstrap has not shipped, so the public schema remains version 1 and no
migration grammar is introduced. The field and phase replacements in the interfaces above are
normative: `payloadCleanupPart` becomes `payloadRetentionPart`, `compactionNext` becomes
`retentionNext`, and terminal `compacting` becomes `retaining` then `retained`.

**Immutable plan and two-slot journal.** The plan is written once at its final path and is never
replaced or removed. Journal slots are the two fixed paths shown above. A journal contains its slot,
a decimal monotonic `sequence`, and `previousJournalHash`; sequence zero has a null previous hash,
and every successor contains raw SHA-256 of the complete canonical bytes, including final LF, of
the immediately preceding valid journal. The journal hash is not a hash of a reopened pathname.

The executor keeps an open descriptor for each admitted slot inode. To advance, it writes only the
inactive slot through that retained descriptor, syncs it, reopens and validates the same inode and
canonical bytes, syncs `state`, and only then treats it as current. A previously absent inactive
slot is created once with no-replace semantics and retained thereafter; it is never published by a
temporary pathname. Recovery accepts the highest valid current journal and at most one adjacent
legal successor. An incomplete inactive slot is resumable only when its bytes are the exact prefix
of that unique successor; otherwise the complete slot remains current and the malformed inactive
slot is a third state before handoff. Two valid non-adjacent sequences, a slot-number mismatch,
broken predecessor hash, two different values at one sequence, an illegal phase/cursor transition,
or replacement of an already-open admitted slot inode is a third state and exit 6. Across process
death, canonical bytes, predecessor hash, legal transition, and exact filesystem projection bind the
newly reopened slot. This rule binds terminal retention progress to the original plan and legal
journal chain rather than to whatever bytes later occupy a journal path.

**Closed retention table.** The immutable plan, its admitted evidence, and the legal journal prefix
derive one complete ordered `BootstrapRetentionEntryV1` table; the table is not duplicated as
caller-selected journal data. Each row fixes:

- the bootstrap ID and ten-decimal ordinal;
- the source path, source kind, owner/mode/link bounds, device/inode identity, content postimage or
  complete directory-tree projection, and guarded parent identity;
- the same parent as source and the exact absent destination
  `.developer-os-retained.<bootstrap-id>.<ten-decimal-ordinal>.tombstone`; and
- whether the row represents a payload/evidence pair, creation evidence, a Foundation or manifest
  bootstrap artifact, an attempt-owned staging subtree, a compensation-created target, or the
  transient bootstrap lock.

```ts
interface BootstrapRetentionEntryV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: Integer[0..999_999];
  readonly role: "payload" | "payload_evidence" | "creation_evidence" |
    "foundation_bootstrap" | "manifest_bootstrap" | "staging_subtree" |
    "compensation_target" | "bootstrap_lock";
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly parent: { readonly path: CanonicalAbsolutePathV1;
    readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
  readonly postimage:
    | { readonly kind: "regular_file"; readonly ownerUid: EffectiveUidV1;
        readonly mode: 384 | 448; readonly nlink: 1; readonly bytes: UInt64DecimalV1;
        readonly sha256: LowerHexSha256; readonly dev: UInt64DecimalV1;
        readonly ino: UInt64DecimalV1 }
    | { readonly kind: "directory_tree"; readonly ownerUid: EffectiveUidV1;
        readonly mode: 448; readonly nlink: PositiveUInt32V1;
        readonly treeHash: LowerHexSha256; readonly entryCount: Integer[1..1_000_000];
        readonly regularFileBytes: UInt64DecimalV1; readonly dev: UInt64DecimalV1;
        readonly ino: UInt64DecimalV1 };
}
```

`treeHash` is SHA-256 over `developer-os/bootstrap-retained-tree/v1\0` plus no-LF canonical bytes
of the complete unsigned-UTF-8 relative-path-sorted descendant projection. Every descendant row
contains relative path, kind, owner, mode, link count, device/inode, byte count, and regular-file
hash; directories carry a null hash. The projection is non-empty and its aggregate counts equal the
retention entry.

The derivation emits maximal attempt-owned directory roots where the entire bounded subtree has one
authority; their descendants are counted and verified but move as that single directory tombstone.
Standalone files in a pre-existing parent remain individual rows. Installed targets, V1/V2
installation manifests, the permanent global lock, and the immutable plan/journal slots are never
retention rows.
Foundation exact-byte adoption or reinsertion is legal only from its persisted payload/evidence and
original inode/hash authority; current observations that merely contain the expected bytes do not
manufacture a retention or restoration identity.

For each row, recovery recognizes exactly two states: source matches and destination is absent, or
source is absent and destination is the same admitted device/inode/postimage. Any both-present,
both-absent-before-transition, destination-replaced, parent-changed, content-changed, or extra-child
state is a third state. Transition is a no-replace rename to the same parent, followed by source and
destination verification, parent sync, and one legal journal-slot advance. The transient bootstrap
lock is renamed to its table destination while its descriptor is still held; the descriptor is
released only after the rename, verification, sync, and journal advance. A matching reserved name
without its exact row and identity grants no authority. There is no quarantine outside the source
parent and no unlink, recursive delete, or `rmdir` in bootstrap compensation, recovery, retention,
uninstall, or retry.

**Authority switch at V2 handoff.** Until the complete V2 handoff below exists, an active envelope
and its retention rows are recovery authority and only `init` may advance them. Once that handoff is
complete, all bootstrap plans, journal slots, and tombstones are inert retained evidence:
operational commands do not use them to establish installed state, drift, mutation authority, or
deletion authority. `init` may finish a legal `retaining` cursor, while `doctor` only inventories and
reports. Missing, added, or altered tombstones after handoff are warnings, not managed drift and not
authority over any current path.

A `retained` envelope whose `terminalOutcome` is `rolled_back` is likewise inert once exact V1 or
fresh absence is restored, even though no V2 handoff exists. A later `init` may start a new ID beside
it subject to the aggregate bounds below.

After uninstall, an envelope with a valid terminal journal remains retained. An unparseable or
altered envelope is classed `unverified` rather than active only when a bounded read-only inventory
finds its complete residue confined to the exact plan/two-slot/retained-name envelope and finds no
live staging, bootstrap lock, temp, V1/V2 target, or other source path attributable to that ID. Any
non-retained live residue is active or ambiguous and blocks a new bootstrap as exit 6. This permits
reinstall beside old evidence without allowing a corrupted terminal file to bless live residue.

**Bounds and public behavior.** Before creating a bootstrap-owned product path, init performs a
read-only aggregate preflight; after taking the bootstrap lock it repeats the projection before plan
publication. Existing residue plus the new envelope's worst case may contain at most 256 bootstrap
IDs, 1,000,000 filesystem entries including descendants of retained directory tombstones, and
12,884,901,888 regular-file bytes (12 GiB). First-over in any dimension refuses before allocation
or mutation and returns manual archive guidance; automatic archival or deletion is forbidden. At
most one ID may be active. Old retained IDs do not otherwise block reinstall.

`doctor` reports, without file contents, each ID as `verified`, `incomplete`, `altered`, or
`unverified`, together with operation, terminal outcome when proved, logical `vaultPath` (the
immutable plan path anchoring that distributed same-parent vault), entry count, and regular-file
bytes. `verified` means terminal journal and every retained row match; `incomplete`
means a legal active/retaining cursor; `altered` means valid terminal metadata with a missing, extra,
or changed retained row; `unverified` means the metadata cannot prove either of those projections.
Ordinary commands remain independent of this report after V2 handoff.
`uninstall` succeeds when retained evidence is the only product residue, preserves every tombstone,
plan, and journal slot, reports the same per-ID operation/outcome/vaultPath/count/bytes summary, and
leaves the product home in place. Retained evidence is never automatically deleted, including by a
later init or uninstall.

**Required tests.** Task 7 covers exact-byte Foundation replacement attempts; death injection before
and after every same-parent rename, parent sync, slot write, slot sync, and slot selection; partial
slot writes; slot replacement/corruption; predecessor gaps and conflicts; source/destination third
states; proof that bootstrap recovery calls no unlink/rmdir and creates no out-of-parent quarantine;
retained-directory subtree projection; lock retention while held; ordinary-command inertness after
handoff; doctor and uninstall reporting; reinstall beside retained/altered evidence; and every
aggregate-cap boundary. Focused Core and CLI tests, full `npm run check`, and fresh-context review
must pass before Task 7 can be accepted.

On completion, the exact Spec 1 V2 handoff consists of:

- a valid V2 manifest and zero drift;
- matching guarded nonce/allocator at counter zero or later;
- the permanent global lock and three journal directories;
- the complete runtime/lease/log reservation set;
- guarded active-release/trust records, retained signed metadata, and current bundle inventory;
- absent rollback/executor records and an empty guarded rollback root;
- absent activation record until first lifecycle enable; and
- a clear lifecycle journal closure plus a terminal or inert retained bootstrap envelope.

Spec 1 admission consumes that set and never migrates or repairs V1.

## 7. Public update surface and preview

### 7.1 Strict grammar

```text
developer-os update [--version <stable-semver>] [--apply] [--json]
developer-os update rollback [--apply] [--json]
```

`update` takes no positional argument. `rollback` is the sole subcommand and accepts no version.
`--version` is illegal with rollback. `--dry-run`, `--yes`, `--channel`, `--url`, `--origin`,
`--allow-downgrade`, prerelease/build spellings, repeated options, unknown options, and extra
positionals refuse before context/network creation. Human and JSON output derive from the same typed
result. Refusals never echo a rejected URL, metadata body, signature, archive member, planner frame,
or Brain content.

### 7.2 Preview contract

```ts
type SafeRenderedPathV1 = string & { readonly __safeRenderedPathV1: unique symbol };

interface OwnerUpdatePreviewV1 {
  readonly owner: ArtifactOwner;
  readonly counts: {
    readonly create: Integer[0..1_000_000];
    readonly replace: Integer[0..1_000_000];
    readonly remove: Integer[0..1_000_000];
    readonly unchanged: Integer[0..1_000_000];
    readonly externalEffects: Integer[0..1];
  };
  readonly paths: {
    readonly create: readonly CanonicalAbsolutePathV1[0..1_000_000];
    readonly replace: readonly CanonicalAbsolutePathV1[0..1_000_000];
    readonly remove: readonly CanonicalAbsolutePathV1[0..1_000_000];
    readonly unchanged: readonly CanonicalAbsolutePathV1[0..1_000_000];
  };
}

interface SchemaMigrationPreviewV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly affectedPaths: readonly (VaultRelativePathV1 | CanonicalProductStatePathV1)[1..100_000];
}

interface UpdateCapacityProjectionV1 {
  readonly components: readonly UpdateCapacityComponentV1[1..12];
  readonly requiredBytes: UInt64DecimalV1;
  readonly requiredEntries: UInt64DecimalV1;
  readonly availableBytes: UInt64DecimalV1;
  readonly availableEntries: UInt64DecimalV1;
  readonly fits: true;
}

interface UpdateCapacityComponentV1 {
  readonly kind: "active" | "retained_rollback" | "verified_scratch" |
    "durable_bundle_source" | "target_bundle" | "transaction_staging" |
    "backups" | "inverse_payload" | "journals" | "terminal_compaction_headroom";
  readonly bytes: UInt64DecimalV1;
  readonly entries: UInt64DecimalV1;
}

interface UpdatePlanPreviewV1 {
  readonly schemaVersion: 1;
  readonly previewHash: LowerHexSha256;
  readonly operation: "update";
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly download: {
    readonly archiveBytes: UInt64DecimalV1;
    readonly archiveSha256: LowerHexSha256;
    readonly expandedBytes: UInt64DecimalV1;
    readonly entryCount: Integer[1..200_000];
  };
  readonly owners: readonly OwnerUpdatePreviewV1[1..16];
  readonly migrations: readonly SchemaMigrationPreviewV1[0..10_000];
  readonly planner: PlannerPublicSummaryV1;
  readonly retainedRollback: {
    readonly release: ReleaseIdentityV1;
    readonly payload: RollbackPayloadPreviewV1;
  } | null;
  readonly capacity: UpdateCapacityProjectionV1;
}

interface UpdateRollbackPreviewV1 {
  readonly schemaVersion: 1;
  readonly previewHash: LowerHexSha256;
  readonly operation: "rollback";
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly owners: readonly OwnerUpdatePreviewV1[1..16];
  readonly migrations: readonly SchemaMigrationPreviewV1[0..10_000];
  readonly payload: RollbackPayloadPreviewV1;
  readonly consumesRollbackRecord: true;
}

interface PlannerPublicSummaryV1 {
  readonly protocol: PositiveUInt32V1;
  readonly bounds: PlannerWireBoundsV1;
}

interface PreparedUpdateCandidateV1 {
  readonly schemaVersion: 1;
  readonly preview: UpdatePlanPreviewV1;
  readonly transcriptIdentity: PlannerTranscriptIdentityV1;
  readonly materialization: PreparedUpdateMaterializationV1;
}

interface PreparedUpdateMaterializationV1 {
  readonly targetDraftHash: LowerHexSha256;
  readonly concreteManifestHash: LowerHexSha256;
  readonly outputBlobs: readonly PreparedOutputBlobIdentityV1[0..1_000_000];
  readonly inversePlanProjections: readonly PreparedInverseProjectionV1[1..10_016];
  readonly rollbackInventoryEntries: readonly RollbackPayloadEntryV1[1..1_000_000];
  readonly inversePlanProjection: CanonicalJsonV1;
  readonly inversePlanProjectionHash: LowerHexSha256;
  readonly inventoryEntriesHash: LowerHexSha256;
  readonly aggregateBytes: Integer[0..2_147_483_648];
  readonly maximumCanonicalBytes: Integer[1..536_870_912];
}

interface PreparedOutputBlobIdentityV1 {
  readonly ordinal: Integer[0..999_999];
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
}

interface PreparedInverseProjectionV1 {
  readonly kind: "owner_inverse" | "schema_migration_inverse";
  readonly id: SafeReasonCodeV1 | SchemaMigrationIdV1;
  readonly projection: CanonicalJsonV1;
  readonly projectionHash: LowerHexSha256;
  readonly bytes: Integer[1..16_777_216];
}

interface RollbackPayloadPreviewV1 {
  readonly payloadId: RollbackPayloadIdV1;
  readonly entryCount: Integer[0..1_000_000];
  readonly aggregateBytes: Integer[0..2_147_483_648];
}
```

`previewHash` is SHA-256 over the domain `developer-os/update-preview/v1\0` followed by canonical
bytes of the complete preview object with the `previewHash` member omitted. It is never computed
over a projection containing itself.

Canonical preview and JSON path fields remain exact branded values and participate byte-for-byte in
`previewHash`. At the human output boundary only, each is mapped to `SafeRenderedPathV1`, the
`1..4096`-byte no-control output of `renderPath`; that lossy projection is never persisted, hashed,
returned in JSON, or accepted back as mutation authority. Owner path arrays are each unsigned-UTF-8 sorted, disjoint, and their
lengths equal the matching counts; the four counts sum to that owner's complete
current-plus-created partition. Capacity component kinds are unique in the shown order and equal the
exact nonzero scopes reachable by the operation; totals use checked integer addition and equal the
component sums plus filesystem reservation granularity. A zero-byte scope is still represented when
it can consume an inode. `fits: true` is the only publishable preview arm; insufficient capacity
refuses without a preview claiming apply feasibility.

Owner previews name the owner, counts of create/replace/remove/unchanged paths, and sorted exact
paths; migration previews name ID/from/to and affected exact domain-appropriate paths, never
note bytes or content hashes. `PlannerPublicSummaryV1` omits request/result/blob hashes, and rollback
payload previews omit inventory/inverse hashes; those values remain internal recovery evidence. An
update preview is canonical and deterministic for identical signed metadata, guarded
filesystem snapshot, injected clock, and target planner; rollback is deterministic for the guarded
record/payload/postimage snapshot and injected clock. The hash domain-separates the entire projection.
The current process also holds the exact non-rendered `PreparedUpdateCandidateV1` in memory for the
duration of an apply invocation. Public output serializes only its `preview`; neither
`transcriptIdentity`, `materialization`, nor their component hashes enter human/JSON output or the
preview hash. `materialization` is the complete allocation-free, root-rehydrated result after the
current process has secret-screened every output blob and computed its raw content hash. Output rows
are contiguous by ordinal and bijective with all result refs. Each inverse projection is the exact
canonical retained-plan object with only `coordinatorId`, allocated IDs, `rollbackBindingHash`, and
source/containing plan hashes omitted; the aggregate inverse-plan projection omits those same fields.
`rollbackInventoryEntries` is already the exact final relative-path/role/bytes/content-hash array;
only the later payload/binding envelope is absent. The projection hashes use respectively
`developer-os/prepared-inverse-leaf/v1\0`, `developer-os/prepared-update-inverse/v1\0`, and
`developer-os/prepared-rollback-inventory-entries/v1\0` plus the no-LF canonical projection bytes.
The target draft and concrete-manifest hashes use
`developer-os/prepared-target-draft/v1\0` and `developer-os/prepared-concrete-manifest/v1\0` plus
their no-LF canonical bytes. Every length/count/hash and `maximumCanonicalBytes` is recomputed; the
first over-bound value refuses and the private object is never persisted.

```ts
type ReleasePlanningAttemptIdV1 = `rp_${LowercaseUuidV4}`;

interface ReleasePlanningScratchV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly planPath: CanonicalAbsolutePathV1;
  readonly journalPath: CanonicalAbsolutePathV1;
  readonly parentDev: UInt64DecimalV1;
  readonly parentIno: UInt64DecimalV1;
  readonly rootExpectedBefore: "absent";
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 448;
  readonly archive: { readonly path: "archive.zst"; readonly bytes: UInt64DecimalV1;
    readonly sha256: LowerHexSha256 };
  readonly manifestHash: LowerHexSha256;
  readonly manifest: ReleaseBundleManifestV1;
  readonly maximumPlanBytes: Integer[1..20_971_520];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly maximumScratchBytes: Integer[1..12_884_901_888];
}

interface ReleasePlanningScratchJournalV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly planHash: LowerHexSha256;
  readonly planIdentity: { readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1 };
  readonly phase: "planned" | "downloading" | "extracting" | "verified" |
    "cleaning" | "cleaned";
  readonly rootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly extractedRootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly evidenceRootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly archiveWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly archiveIdentity: { readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1 } | null;
  readonly archiveBytesWritten: UInt64DecimalV1;
  readonly nextExtractedEntry: Integer[0..200_000];
  readonly entryWriteState: ReleaseScratchEntryWriteStateV1 | null;
  readonly cleanupNext: Integer[0..400_004] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

type ReleaseScratchPathWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 };

type ReleaseScratchEntryWriteStateV1 =
  | { readonly ordinal: Integer[0..199_999]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..199_999]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..199_999]; readonly state: "evidence_intent";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..199_999]; readonly state: "evidence_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
      readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };

interface ReleaseScratchEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly planHash: LowerHexSha256;
  readonly ordinal: Integer[0..199_999];
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly mode: 384 | 448;
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}
```

The scratch root is exactly
`<canonical system temp>/developer-os-release-planning-v1-<effective-uid>-<lowercase-v4-uuid>`.
Its immutable plan and mutable journal are not children of an as-yet unauthoritative root; they are
the sibling parent entries
`.developer-os-release-planning-v1-<uid>-<uuid>.plan.json` and
`.developer-os-release-planning-v1-<uid>-<uuid>.journal.json`. Their only temps append one fresh
lowercase UUID and `.tmp`, use exact prefix/no-replace publication, and are owner-only single-link
`0600`. The identity-rechecked system-temporary parent is sticky, non-symlink, and equals the
plan's parent dev/ino.

For each of at most 32 fresh IDs, the process first requires plan path, journal path, and root all
absent, publishes/syncs the immutable plan, reopens its inode, and places that identity in the
initial journal before root creation. A preexisting candidate or `EEXIST` is never adopted or
deleted; the process preserves it and tries a new ID. A crash before the final plan or initial
journal exists likewise grants no deletion authority over a temp/root path. A plan-only residue is
preserved, not inferred attempt-owned. Thus every root deletion is downstream of a durable journal
identity, never UUID spelling or content resemblance.

With plan and journal durable, root creation persists `rootWriteState.create_intent`, exclusively
creates owner-only `0700`, syncs/reopens it, then persists `created` dev/ino before any child.
`extracted` and `evidence` use the same intent→created protocol and exact identity-checked parent.
Archive creation persists `archiveWriteState.create_intent`, exclusively creates owner-only
single-link `0600`, records equal `archiveWriteState.created`/`archiveIdentity` before byte zero,
and admits only the bounded received prefix. At any create intent, absence may retry; presence
without the persisted created identity is an `EEXIST`/crash ambiguity, is preserved, and blocks
cleanup of that candidate. Wrong kind/owner/mode/link/device/parent or an inode change is likewise
preserved.

For manifest entry ordinal `n`, the journal persists `entryWriteState.create_intent`, exclusively
creates the exact parent-before-child path, then records its reopened dev/ino as `created` before a
file byte or directory child. The originating process admits only the one manifest-derived bounded
file prefix; a directory must have only its already evidenced lower-ordinal children. After the
complete planned kind/mode/size/hash is synced/reopened, the journal persists `evidence_intent` and
exclusively creates `evidence/<n-as-ten-decimal-digits>.json`, records that evidence inode, writes the
one canonical `ReleaseScratchEntryEvidenceV1` (owner-only `0600`, single-link, at most 1 KiB), and
advances only after target and evidence reopen equal. Evidence ordinals are the exact contiguous
prefix `0..<nextExtractedEntry`; the manifest supplies every path/kind/mode/size/hash, so a path hash
alone never authorizes deletion.

The journal grammar is linear. `planned` admits only the fixed structure prefix root, `extracted`,
then `evidence`, with at most the current path write state; later structure states are null.
`downloading` requires all three recorded identities, owns only archive intent/created plus
`archiveBytesWritten`, and requires created dev/ino equal `archiveIdentity`; received bytes are
`0..archive.bytes` and completion reopens the exact archive hash. `extracting` requires the complete
archive and owns only the exact evidence prefix, `nextExtractedEntry`, and its one current entry
microstate. `verified` requires the complete manifest count, no current microstate, and every target/
evidence reopen equal. `cleaning` freezes the greatest reached prefix/microstate and owns only
`cleanupNext`; `cleaned` requires that derived list complete and all attempt-created root children
absent. Every field unused by the current phase is null/zero or the immutable recorded identity
prefix just described; the first cursor/byte beyond its plan-derived bound refuses.

After process death scratch recovery is cleanup-only. It may remove a current partial
target/evidence/archive only from its journal-recorded inode under the exact identity-checked parent,
after kind/owner/mode/link/size-bound and stable-dev/ino rechecks; it never resumes or content-adopts
an unrecorded path. The unique cleanup list is current microstate target then evidence if present;
completed entries in reverse ordinal order, each target then evidence; archive; `extracted`;
`evidence`; and root. `cleanupNext` indexes only that derived reached list and is at most
`2 * 200_000 + 4 = 400_004`. After it reaches the exact list length, the terminal journal is
used to guarded-unlink the immutable plan at `planIdentity`, then the reopened exact terminal journal
is removed last; only both-present, plan-absent/journal-present, and both-absent suffix states are
admitted. Cleanup never recursively
enumerates-and-deletes. At most 32 candidate triples and the plan's 200,000 entries/evidence are
inspected per invocation; any unknown child, unrecorded identity, over-limit, or malformed candidate
is preserved with a content-free recovery reason.

Plan-only update may create one guarded system-temporary `ReleasePlanningScratchV1`; it makes no
product, Brain, vendor, manifest, trust, active, or launcher mutation. Scratch contains only the
public release archive/extraction; no planner request, result, path, config, stderr, or blob frame is
written there. Raw Brain bytes are streamed through planner stdin and held only in bounded process
memory; they are never written into scratch. Normal
completion removes scratch deepest-first. Crash cleanup admits only the exact product-tagged
owner/mode/link/name/inventory grammar and never follows or recursively removes an unknown child.

`up_to_date` requires the selected version, release sequence/identity hash, index sequence/hash,
bundle hash, active record, V2
manifest, and current bundle inventory all match. It is not returned over drift or an incomplete
ledger.

### 7.3 Typed command result

```ts
type UpdateCommandResultV1 =
  | { readonly schemaVersion: 1; readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 }
  | { readonly schemaVersion: 1; readonly outcome: "preview"; readonly plan: UpdatePlanPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "applied"; readonly active: ReleaseIdentityV1;
      readonly rollbackAvailable: true }
  | { readonly schemaVersion: 1; readonly outcome: "rollback_preview";
      readonly plan: UpdateRollbackPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "rolled_back";
      readonly active: ReleaseIdentityV1; readonly rollbackAvailable: false };
```

## 8. Target planner protocol and schema migrations

### 8.1 Why the target plans and the current release executes

The current release cannot contain unbounded future migrations. Activating the target before durable
intent would expose new code over old state. The target therefore supplies future desired-state
knowledge through a versioned plan-only protocol, while the current release retains mutation and
recovery authority.

The verified target planner receives one bounded canonical request over stdin plus a counted blob
stream for artifact and Brain inputs. It receives no path to product home or Brain, no ambient
environment, no inherited descriptor other than stdin/stdout/stderr, no clock other than the supplied
timestamp, no randomness, and an empty guarded cwd. Its compiled transitive graph passes the absence
gate in §2. The current process caps stdout/stderr, validates framing incrementally, terminates/reaps
on timeout/overflow, and discards raw stderr after redaction.

### 8.2 Request and result

```ts
interface PlannerArtifactInputV1 {
  readonly token: PlannerPathTokenV1;
  readonly owner: ArtifactOwner;
  readonly kind: ManagedArtifactV2["kind"];
  readonly verification: ManagedArtifactV2["verification"];
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly observed:
    | { readonly state: "absent" }
    | { readonly state: "directory"; readonly mode: 448 }
    | { readonly state: "content"; readonly mode: 384 | 448;
        readonly bytes: Integer[0..16_777_216]; readonly sha256: LowerHexSha256;
        readonly blob: PlannerInputBlobRefV1 }
    | { readonly state: "content"; readonly mode: 384 | 448;
        readonly bytes: Integer[0..536_870_912]; readonly sha256: LowerHexSha256;
        readonly blob: null }
    | { readonly state: "symlink"; readonly targetBytes: Integer[0..4_096];
        readonly targetHash: LowerHexSha256 }
    | { readonly state: "ephemeral_present"; readonly mode: 384 };
}

interface PlannerBrainSnapshotV1 {
  readonly schemaVersion: 1;
  readonly root: "brain_root";
  readonly folderPolicyVersion: PositiveUInt32V1;
  readonly entries: readonly PlannerBrainEntryV1[0..1_000_000];
  readonly aggregateBytes: Integer[0..1_073_741_824];
}

interface PlannerBrainEntryV1 {
  readonly path: VaultRelativePathV1;
  readonly mode: 384;
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
  readonly blob: PlannerInputBlobRefV1;
}

interface UpdatePlannerRequestV1 {
  readonly schemaVersion: 1;
  readonly protocol: PositiveUInt32V1;
  readonly plannedAt: UtcTimestampV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly currentRelease: ReleaseIdentityV1;
  readonly targetRelease: ReleaseIdentityV1;
  readonly manifest: PlannerManifestSnapshotV1;
  readonly config: PlannerConfigProjectionV1;
  readonly installedOwners: readonly ArtifactOwner[1..16];
  readonly artifactInputs: readonly PlannerArtifactInputV1[1..1_000_000];
  readonly brain: PlannerBrainSnapshotV1;
}

interface TargetUpdateDraftV1 {
  readonly schemaVersion: 1;
  readonly protocol: PositiveUInt32V1;
  readonly currentRelease: ReleaseIdentityV1;
  readonly targetRelease: ReleaseIdentityV1;
  readonly ownerPlans: readonly OwnerUpdateDraftV1[1..16];
  readonly migrations: readonly SchemaMigrationDraftV1[0..10_000];
  readonly expectedManifest: PlannerInstallationManifestDraftV2;
}

type PlannerPathTokenV1 = `artifact_${TenDigitZeroPaddedOrdinalV1}`;

type PlannerPathRefV1 =
  | { readonly kind: "installed"; readonly token: PlannerPathTokenV1 }
  | { readonly kind: "target_bundle"; readonly path: BundleRelativePathV1 }
  | { readonly kind: "owner_relative"; readonly owner: ArtifactOwner;
      readonly path: OwnerRelativePathV1 };

interface PlannerInstallationManifestDraftV2 {
  readonly schemaVersion: 2;
  readonly productVersion: StableSemverV1;
  readonly artifacts: readonly PlannerManagedArtifactDraftV2[1..1_000_000];
}

interface PlannerManagedArtifactDraftCommonV2 {
  readonly owner: ArtifactOwner;
  readonly path: PlannerPathRefV1;
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
}

type PlannerInstalledContentDraftV1 =
  | { readonly kind: "installed"; readonly token: PlannerPathTokenV1 }
  | { readonly kind: "target_bundle"; readonly path: BundleRelativePathV1;
      readonly bytes: Integer[0..536_870_912]; readonly sha256: LowerHexSha256 }
  | { readonly kind: "output_blob"; readonly blob: PlannerOutputBlobRefV1 };

type PlannerManagedArtifactDraftV2 =
  | (PlannerManagedArtifactDraftCommonV2 & {
      readonly kind: "file";
      readonly verification: { readonly mode: "content";
        readonly installed: PlannerInstalledContentDraftV1 };
    })
  | (PlannerManagedArtifactDraftCommonV2 & {
      readonly kind: "file";
      readonly verification: { readonly mode: "schema";
        readonly schemaId: ManagedArtifactSchemaIdV1;
        readonly installed: PlannerInstalledContentDraftV1 };
    })
  | (PlannerManagedArtifactDraftCommonV2 & {
      readonly kind: "file";
      readonly verification: { readonly mode: "ephemeral" };
    })
  | (PlannerManagedArtifactDraftCommonV2 & {
      readonly kind: "directory";
      readonly verification: { readonly mode: "content" };
    })
  | (PlannerManagedArtifactDraftCommonV2 & {
      readonly kind: "symlink";
      readonly verification: { readonly mode: "content";
        readonly installed: { readonly kind: "installed";
          readonly token: PlannerPathTokenV1 } };
    });

interface PlannerManifestSnapshotV1 {
  readonly schemaVersion: 1;
  readonly productVersion: StableSemverV1;
  readonly installedAt: UtcTimestampV1;
  readonly artifacts: readonly PlannerManifestArtifactV1[1..1_000_000];
}

interface PlannerManifestArtifactV1 {
  readonly token: PlannerPathTokenV1;
  readonly owner: ArtifactOwner;
  readonly kind: ManagedArtifactV2["kind"];
  readonly verification: ManagedArtifactV2["verification"];
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly currentHash: LowerHexSha256 | null;
}

interface PlannerConfigProjectionV1 {
  readonly schemaVersion: 1;
  readonly brainRoot: "brain_root";
  readonly adapters: DeveloperOsConfigV1["adapters"];
  readonly git: DeveloperOsConfigV1["git"];
  readonly automation: DeveloperOsConfigV1["automation"];
  readonly brain: BrainConfigV1 | null;
  readonly redactionPatternsCount: Integer[0..64];
  readonly telemetry: false;
}

interface PlannerInputBlobRefV1 {
  readonly stream: "input";
  readonly ordinal: Integer[0..999_999];
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
}

interface PlannerOutputBlobRefV1 {
  readonly stream: "output";
  readonly ordinal: Integer[0..999_999];
  readonly bytes: Integer[0..16_777_216];
}

interface PlannerWireBoundsV1 {
  readonly requestJsonBytes: Integer[1..268_435_456];
  readonly resultJsonBytes: Integer[1..268_435_456];
  readonly inputBlobCount: Integer[0..1_000_000];
  readonly outputBlobCount: Integer[0..1_000_000];
  readonly inputBlobBytes: Integer[0..1_073_741_824];
  readonly outputBlobBytes: Integer[0..1_073_741_824];
  readonly stdinWireBytes: Integer[27..1_351_177_306];
  readonly stdoutWireBytes: Integer[27..1_351_177_306];
  readonly stderrBytes: Integer[0..1_048_576];
  readonly residentBytes: Integer[1..536_870_912];
  readonly idleMilliseconds: Integer[1..30_000];
  readonly wallMilliseconds: Integer[1..600_000];
  readonly processCount: 1;
}

interface PlannerTranscriptIdentityV1 {
  readonly protocol: PositiveUInt32V1;
  readonly bounds: PlannerWireBoundsV1;
  readonly requestHash: LowerHexSha256;
  readonly inputBlobsHash: LowerHexSha256;
  readonly resultHash: LowerHexSha256;
  readonly outputBlobsHash: LowerHexSha256;
}
```

Both directions use one closed binary framing grammar. They start with the eight ASCII bytes
`DOSUPD1\n`. Every frame is one kind byte followed by an unsigned 64-bit big-endian payload length
and exactly that many payload bytes. Stdin is exactly one `0x01` canonical request-JSON frame,
`0x02` blob frames in contiguous ordinal order, then one zero-length `0x03` end frame. Stdout is
exactly one `0x11` canonical result-JSON frame, `0x12` output blobs in contiguous ordinal order, then
one zero-length `0x13` end frame. A missing/extra/reordered/unknown frame, nonzero end length,
truncation, trailing byte, length exceeding the remaining aggregate, or reference that does not
equal the implied ordinal/length and, for input, already-screened hash refuses. Output references
carry no hash. The current process secret-screens each complete bounded output frame before computing
its content hash; only then does it construct persisted concrete content, manifest, and migration
refs. Blob-set hashes domain-separate and hash the ordered tuple of ordinal, byte length, the
current-process-computed content hash, and bytes; JSON hashes domain-separate their canonical payload
bytes after the same result scan.
Specifically, `requestHash` and `resultHash` use
`developer-os/update-planner-request/v1\0` and `developer-os/update-planner-result/v1\0` plus the
respective no-LF canonical JSON bytes. `inputBlobsHash` and `outputBlobsHash` use
`developer-os/update-planner-input-blobs/v1\0` and
`developer-os/update-planner-output-blobs/v1\0`, followed by the unsigned-64-bit big-endian blob
count and, for every contiguous ordinal, unsigned-64-bit big-endian ordinal, unsigned-64-bit
big-endian byte length, 32 raw SHA-256 bytes, then the exact blob bytes. Empty sets still hash the
zero count. No transcript digest includes itself.

The numeric values in `PlannerWireBoundsV1` are ceilings fixed by this protocol, not target-selected
budgets. A request/result JSON frame is at most 256 MiB; a blob is at most 16 MiB; each direction has
at most 1,000,000 blobs and 1 GiB of blob payload. The wire maximum includes the 8-byte magic and
all 9-byte frame headers. The supervised process graph contains exactly the one pinned target
runtime/planner process, has 512 MiB resident, 30-second idle, 10-minute wall, and 1-MiB stderr caps,
and inherits no descriptor except its three pipes. The first attempted byte/frame/process/time/RSS
overflow terminates and reaps it and refuses; caps never mean truncate-and-accept.

The request enumerates a non-empty exact artifact set per installed owner. The current executor assigns
tokens in canonical owner/path order and retains the only token-to-absolute-path map in memory. Each
input binds a token, kind/mode, manifest evidence, current bytes hash, and a blob reference only where
the owner planner needs bytes. `brainPath` is replaced by the literal root token, and redaction
literals are replaced by their count only; Brain configuration segments required for folder-policy
planning remain bounded local input. Brain snapshot enumeration follows the Brain package's deny-by-default folder policy;
private folders, indexes, quarantine, outputs, `.obsidian`, links, and unclassified folders are never
migration inputs. Blob frames are length-prefixed, order-bound, and governed by the exact bounds
above. First-over-limit refuses before sending the frame.

Artifact inputs are in token order and equal the complete manifest projection. `absent` is legal only
for a clean ephemeral reservation; `directory` only for directory/content; `ephemeral_present` only
for guarded ephemeral; `content` only for a guarded regular file with content or schema verification;
and `symlink` only for guarded symlink/content with exact target length/hash and no mode or blob. A
non-null artifact blob is admitted only when the installed owner's planner declares that token as a
content dependency; otherwise it is null. Brain entries are regular files, unique and sorted by
unsigned UTF-8 relative-path bytes, and `aggregateBytes` equals their checked byte sum. Every Brain
entry has exactly one matching input blob; the snapshot contains neither an absolute root nor a
directory/link/special entry.

Before computing a blob/content/transcript hash, the current process runs the Security package's
bounded secret scanner over canonical request/result bytes and every admitted artifact/Brain input
or target output blob. An input finding refuses before the planner sees or hashes the bytes; an
output/result finding refuses before hashing, staging, or persistence. Scanner diagnostics contain
only fixed reason codes and safe path tokens. Accepted raw integrity hashes remain internal
plan/precondition evidence and never enter human/JSON preview or logs.

The target draft may refer only to request artifact tokens/Brain-relative paths, target-bundle
inventory entries, or hashless output-blob refs. `expectedManifest` uses the same tokens in its path
and installed-content positions on wire. Only the target-bundle arm carries a hash, because those are
public signed inventory bytes. An output arm carries ordinal/length only; the current executor alone
secret-screens and hashes it, rehydrates all tokens, constructs each concrete `installedHash`, and
rehydrates historical fields before validating the resulting concrete `InstallationManifestV2`.
The top-level `installedAt` is absent from the draft and copied byte-for-byte from
`PlannerManifestSnapshotV1` and the equal guarded current manifest. For an installed token,
`existedBefore`, `beforeHash`, and `backupRelativePath` are copied exactly
from the current manifest; `verifiedAt` is preserved for byte-identical keep and set to request
`plannedAt` for a changed artifact. A target-bundle or owner-relative new artifact is always
`false`/null/null with `verifiedAt == plannedAt`. Those four keys are illegal in target draft rows,
so target code cannot invent or erase installation history.

The two `observed.content` arms are distinguished by `blob`: a non-null blob carries at most
16 MiB and its ref length/hash must equal the row; `blob: null` represents a fully hashed guarded
file through 512 MiB without sending content to the target. A null-blob artifact may only be returned
as the same installed token with byte-identical `keep`; replace/remove, schema migration, output use,
or any changed manifest hash refuses before allocation. This lets the request enumerate the complete
installed partition while retaining the 16-MiB change/inverse boundary.

Draft artifacts use a root-free canonical order: tagged-ref order `installed`, `target_bundle`,
`owner_relative`; then token ordinal, unsigned-UTF-8 bundle path, or owner-enum plus unsigned-UTF-8
relative path respectively; remaining ties use owner/kind/verification mode. The current executor
rehydrates every absolute path, independently sorts by the concrete `InstallationManifestV2` order,
and then validates exact/NFC/folded uniqueness. Target order never predicts a hidden root. The
target cannot invent an owner, external path, process kind, release identity, precondition, or unbounded
blob. The current release independently recomputes proposal hashes, ownership, containment,
cardinality, migration chain, complete target manifest, and forward/inverse feasibility. A target
protocol newer than current support refuses before target execution and directs a launcher/Homebrew
upgrade.

### 8.3 Owner update plans

Every installed owner has exactly one provider in a closed registry. An absent owner receives no
provider call and remains absent. A provider returns:

```ts
interface OwnerUpdateDraftV1 {
  readonly owner: ArtifactOwner;
  readonly currentArtifacts: readonly PlannerPathTokenV1[1..1_000_000];
  readonly proposedOperations: readonly PlannerChangePlanOperationV1[0..1_000_000];
  readonly externalEffects: readonly OwnerExternalEffectDraftV1[0..1];
}

type PlannerChangePlanOperationV1 =
  | { readonly operation: "keep"; readonly target: { readonly kind: "installed";
      readonly token: PlannerPathTokenV1 }; readonly expectedHash: LowerHexSha256 | null }
  | { readonly operation: "remove"; readonly target: { readonly kind: "installed";
      readonly token: PlannerPathTokenV1 }; readonly expectedHash: LowerHexSha256 | null }
  | { readonly operation: "replace"; readonly target: { readonly kind: "installed";
      readonly token: PlannerPathTokenV1 }; readonly expectedHash: LowerHexSha256 | null;
      readonly content: PlannerContentRefV1 }
  | { readonly operation: "create"; readonly target: Extract<PlannerPathRefV1,
      { readonly kind: "owner_relative" }>; readonly content: PlannerContentRefV1 };

type PlannerContentRefV1 =
  | { readonly kind: "target_bundle"; readonly path: BundleRelativePathV1;
      readonly bytes: Integer[0..536_870_912]; readonly sha256: LowerHexSha256 }
  | { readonly kind: "output_blob"; readonly blob: PlannerOutputBlobRefV1 };

interface OwnerExternalEffectDraftV1 {
  readonly kind: "codex_registration_refresh";
  readonly owner: "codex";
  readonly artifactTokens: readonly PlannerPathTokenV1[1..1_000_000];
}
```

`OwnerRelativePathV1` has the same NFC/no-control/no-traversal `1..4096`-byte relative grammar as
V2 sources and is interpreted only inside the named owner's closed root policy. The target cannot
name that root. The current executor requires complete current-token equality, resolves every
owner-relative target, rejects collisions/duplicate aliases, validates content references, and only
then constructs closed concrete `PersistedOwnerChangeOperationV1` and external-effect plans. A create can
never target an installed token, and replace/remove can never invent an owner-relative target.

Current artifacts equal the manifest's complete owner partition. Proposed operations are validated
through Foundation ownership, expected-before, source, merge, and exact target-bundle content. Empty
operations are legal only when every current artifact is retained byte-identically and no external
effect is requested.

The v1 external-effect registry is closed:

- Core/Brain/workflow/Claude artifacts have no external effect.
- Codex may request only the exact locally sourced marketplace/plugin refresh sequence already owned
  by the adapter contract, through a pinned trusted vendor executable, exact argv/order/environment,
  no prompt/stdin, no model command, no proxy/credential inheritance, bounded output/deadline, and
  observed registration pre/post states. If the installed Codex owner cannot preflight that row, the
  whole update refuses before mutation.

An owner draft/plan has at most one external-effect ref. Because Codex is the only admitted effect
owner, the complete update and manifest have at most one such ref, and the one outer step identifies
it unambiguously by owner. A second/repeated refresh row refuses before allocation; multiple vendor
payloads belong inside that one effect plan and its one expected→proposed state transition.

The draft requests only the closed refresh kind and exact artifact-token partition; it carries no
vendor-state bytes or hash. The current provider locally observes and secret-screens the closed safe
registration projection, computes expected/proposed hashes, and constructs the concrete effect plan.
An external effect has a durable plan, preimage, intended direction, observation, compensation, and
terminal evidence. File updates occur before forward registration refresh; compensation restores
registration state before restoring files where the adapter contract requires it. A future owner
effect kind requires a protocol and launcher upgrade first.

### 8.4 Schema migrations

```ts
interface SchemaMigrationDraftV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly SchemaMigrationMutationDraftV1[1..100_000];
}

interface SchemaMigrationMutationDraftV1 {
  readonly path:
    | { readonly domain: "brain"; readonly path: VaultRelativePathV1 }
    | { readonly domain: "product_state"; readonly token: PlannerPathTokenV1 };
  readonly beforeHash: LowerHexSha256;
  readonly afterBlob: PlannerOutputBlobRefV1;
  readonly inverseBlob: PlannerOutputBlobRefV1;
}

interface SchemaMigrationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SchemaMigrationIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly SchemaMigrationMutationV1[1..100_000];
  readonly foundation: readonly FoundationParticipantRefV2[2..782];
  readonly maximumPlanBytes: Integer[1..16_777_216];
}

interface SchemaMigrationMutationV1 {
  readonly path: VaultRelativePathV1 | CanonicalProductStatePathV1;
  readonly beforeHash: LowerHexSha256;
  readonly afterHash: LowerHexSha256;
  readonly afterBlob: UpdatePayloadRefV1;
  readonly inverseBlob: UpdatePayloadRefV1;
}
```

The draft contains no absolute path. Its domain must equal every mutation arm. The current executor
maps a product token only to an already manifest-owned schema artifact and maps a Brain-relative path
only through the admitted snapshot. It secret-screens each complete output blob, computes its
concrete hash, stages both validated blob streams into exact pre-intent transaction payloads, and
then emits the concrete plan below with `afterHash` plus `UpdatePayloadRefV1`, never a planner-stream
ordinal. Unknown/repeated tokens,
an owner-relative product target, cross-domain reuse, or a Brain path absent from the snapshot
refuses before durable allocation.

Migration IDs are non-empty, unique, ordered, and form one contiguous version chain per domain.
`fromVersion < toVersion`; no two entries claim the same domain/from version. A target release
requiring an absent step is incompatible. Product-state paths must already be manifest-owned schema
artifacts in the current planner snapshot; newly introduced target artifacts are not migration
targets in v1. The matching owner operation must be a byte-identical `keep`, so owner execution
cannot change the migration precondition before the later migration step. Brain paths must come from
the admitted snapshot and remain inside the canonical content policy.

The current release verifies every before hash against its guarded snapshot, every after/inverse blob
against its declared length, computes its hashes only after the output secret scan, and verifies that
applying inverse to the after state restores the exact before bytes. Migration bytes are not printed,
logged, sent to the update origin, or stored in
planning scratch. During apply, forward and inverse blobs are staged inside product-owned transaction
storage and made durable before coordinator intent. A migration applies only through Foundation
transactions with caller-supplied preconditions.

Plan-only validates and hashes output blobs while streaming and then discards them; it persists no
private frame. Apply's pre-lock run fills one `PreparedUpdateCandidateV1`. Its under-lock rerun
requires protocol/bounds, request hash, input-blob aggregate hash, result-JSON hash, and public
preview bytes/hash to equal that in-memory candidate. At that result-frame boundary the parent
stops reading output blobs, keeps the child under the same wall deadline and bounded pipe
backpressure, allocates IDs, derives every allocation-dependent leaf/inverse/inventory hash, and
publishes the construction/source plans described in §9.2. Only then does it accept each output
frame, secret-scan it again, require ordinal/length/content hash equality with
`materialization.outputBlobs`, and stream it solely to the exact plan-derived product-owned paths.
The rederived inverse projections and inventory entries must be byte-equal to the candidate before
the first output frame is read. After the end frame, the recomputed output-blob aggregate hash must
equal the candidate's remaining `PlannerTranscriptIdentityV1.outputBlobsHash`; only then may the
source/construction journals become ready. No output blob is ever materialized in release scratch or accepted
from a prior invocation.

## 9. Update apply and coordination

### 9.1 Revalidation and feasibility

`update --apply` reuses only a still-open verified scratch attempt owned by the same top-level
invocation. It never accepts a preview from argv or disk. Before global-lock acquisition it verifies
metadata, archive, bundle, planner output, owner registry, migration chain, and capacity. Under the
global lock it rechecks:

- guarded V2 manifest bytes/inode and zero drift;
- active record, trust state, active and retained rollback bundle inventories;
- lifecycle closure `clear` and no migration/update coordinator;
- strict config and product/Brain roots;
- every owner/current artifact and external-effect preimage;
- every Brain migration precondition;
- platform/launcher/update protocol;
- metadata sequences/hashes and fixed-origin effective URLs; and
- a fresh target-planner draft whose canonical preview hash equals the original.

The complete draft contains target/rollback bundle inventories, every Foundation participant and
inverse, external effects, migrations, manifest transition, trust transition, active transition,
terminal verification, compaction order, exact cardinalities, and maximum reachable journal bytes.
It is allocation-free and cannot execute. Aggregate feasibility runs before ID reservation. A later
post-allocation overflow consumes only a durable allocator gap and refuses before staging or intent.

Capacity includes active bundle, retained rollback bundle, target archive/extraction, product target
bundle, transaction staging/backups, forward/inverse migration bytes, owner artifacts, coordinator
journals, and terminal compaction headroom. It checks bytes and entry/inode cardinality; a filesystem
report without both is insufficient.

### 9.2 Persisted execution plan

```ts
interface UpdateConstructionPlanV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly executionBindingHash: LowerHexSha256;
  readonly stagingRoot: {
    readonly path: CanonicalAbsolutePathV1;
    readonly ownerUid: EffectiveUidV1;
    readonly mode: 448;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
  readonly directories: readonly UpdateConstructionDirectoryPlanV1[1..200_000];
  readonly files: readonly UpdateConstructionFilePlanV1[1..1_100_000];
  readonly outputFrames: readonly UpdateConstructionOutputFrameV1[0..1_000_000];
  readonly rollbackSource: UpdateConstructionRollbackSourceV1 | null;
  readonly constructionJournalCreatedAt: UtcTimestampV1;
  readonly outerJournalCreatedAt: UtcTimestampV1;
  readonly outerPlanPath: ExactProductStatePathV1;
  readonly outerJournalPath: ExactProductStatePathV1;
  readonly maximumPlanBytes: Integer[1..536_870_912];
  readonly maximumJournalBytes: Integer[1..67_108_864];
  readonly maximumEvidenceBytes: 1024;
}

interface UpdateConstructionDirectoryPlanV1 {
  readonly ordinal: Integer[0..199_999];
  readonly path: CanonicalAbsolutePathV1;
  readonly expectedBefore: "absent";
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 448;
  readonly parent: UpdateConstructionParentV1;
}

type UpdateConstructionParentV1 =
  | { readonly kind: "staging_root"; readonly path: CanonicalAbsolutePathV1;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "created_directory"; readonly ordinal: Integer[0..199_999] };

interface UpdateConstructionOutputFrameV1 {
  readonly ordinal: Integer[0..999_999];
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
  readonly consumers: readonly UpdateConstructionOutputConsumerV1[1..1_000_000];
}

interface UpdateConstructionRollbackSourceV1 {
  readonly sourcePlanId: SafeReasonCodeV1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entriesProjectionHash: LowerHexSha256;
  readonly entries: readonly UpdateConstructionRollbackSourceEntryV1[1..1_000_000];
}

interface UpdateConstructionRollbackSourceEntryV1 {
  readonly ordinal: Integer[0..999_999];
  readonly entry: RollbackPayloadEntryV1;
  readonly source: UpdateConstructionRollbackEntrySourceV1;
  readonly sourceProjectionHash: LowerHexSha256;
}

type UpdateConstructionRollbackEntrySourceV1 =
  | { readonly kind: "planner_output"; readonly ordinal: Integer[0..999_999] }
  | { readonly kind: "guarded_preimage";
      readonly authority: UpdateConstructionPreimageAuthorityV1;
      readonly path: CanonicalAbsolutePathV1;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384 | 448;
      readonly nlink: 1;
      readonly bytes: Integer[0..16_777_216];
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 }
  | { readonly kind: "plan_derived";
      readonly role: "owner_inverse_plan";
      readonly plan: ImmutableUpdatePlanRefV1<"owner_update">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..16_777_215] }
  | { readonly kind: "plan_derived";
      readonly role: "schema_migration_inverse_plan";
      readonly plan: ImmutableUpdatePlanRefV1<"schema_migration">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..16_777_215] };

type UpdateConstructionOutputConsumerV1 =
  | { readonly kind: "construction_file"; readonly ordinal: Integer[0..1_099_999] }
  | { readonly kind: "rollback_source_entry"; readonly ordinal: Integer[0..999_999] };

interface UpdateConstructionFilePlanV1 {
  readonly ordinal: Integer[0..1_099_999];
  readonly role:
    | { readonly kind: "immutable_plan"; readonly planKind: UpdateLeafPlanKindV1;
        readonly id: SafeReasonCodeV1 | OwnerExternalEffectIdV1 |
          SchemaMigrationIdV1 | ManifestParticipantIdV1 }
    | { readonly kind: "payload"; readonly payloadKind:
        "foundation_initial" | "foundation_content" | "owner_content" |
        "migration_content" | "state_after";
        readonly source: UpdateConstructionPayloadSourceV1;
        readonly sourceProjectionHash: LowerHexSha256 }
    | { readonly kind: "initial_journal"; readonly journalKind: UpdateConstructionJournalKindV1;
        readonly id: SafeReasonCodeV1 | OwnerExternalEffectIdV1 |
          SchemaMigrationIdV1 | ManifestParticipantIdV1;
        readonly finalPath: CanonicalAbsolutePathV1 }
    | { readonly kind: "recovery_executor"; readonly state:
        "executing" | "terminal_cleanup" };
  readonly path: CanonicalAbsolutePathV1;
  readonly parent: UpdateConstructionParentV1;
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
}

type UpdateConstructionPayloadSourceV1 =
  | { readonly kind: "planner_output"; readonly ordinal: Integer[0..999_999] }
  | { readonly kind: "signed_bundle_entry";
      readonly release: ReleaseIdentityV1;
      readonly root: CanonicalAbsolutePathV1;
      readonly rootDev: UInt64DecimalV1;
      readonly rootIno: UInt64DecimalV1;
      readonly inventoryHash: LowerHexSha256;
      readonly relativePath: BundleRelativePathV1;
      readonly sourceBytes: Integer[0..536_870_912];
      readonly sourceHash: LowerHexSha256;
      readonly sourceMode: 384 | 448;
      readonly sourceDev: UInt64DecimalV1;
      readonly sourceIno: UInt64DecimalV1 }
  | { readonly kind: "guarded_signed_metadata";
      readonly metadata: ReleaseMetadataIdentityV1;
      readonly role: "delegation" | "release_index" | "bundle_manifest";
      readonly path: CanonicalAbsolutePathV1;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly bytes: Integer[1..67_108_864];
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 }
  | { readonly kind: "guarded_preimage";
      readonly authority: UpdateConstructionPreimageAuthorityV1;
      readonly path: CanonicalAbsolutePathV1;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384 | 448;
      readonly nlink: 1;
      readonly bytes: Integer[0..16_777_216];
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 }
  | UpdateConstructionPlanDerivedSourceV1;

type UpdateConstructionPreimageAuthorityV1 =
  | { readonly kind: "owner_operation_before";
      readonly ownerPlan: ImmutableUpdatePlanRefV1<"owner_update">;
      readonly operationOrdinal: Integer[0..999_999] }
  | { readonly kind: "schema_migration_before";
      readonly migrationPlan: ImmutableUpdatePlanRefV1<"schema_migration">;
      readonly mutationOrdinal: Integer[0..99_999] }
  | { readonly kind: "foundation_expected_before";
      readonly participant: FoundationParticipantRefV2;
      readonly mutationOrdinal: Integer[0..255] };

type UpdateConstructionPlanDerivedSourceV1 =
  | { readonly kind: "plan_derived"; readonly role: "foundation_initial_journal";
      readonly participant: FoundationParticipantRefV2;
      readonly foundationPlanHash: LowerHexSha256;
      readonly plannedBytesHash: LowerHexSha256;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..1_048_575] }
  | { readonly kind: "plan_derived"; readonly role: "manifest_after";
      readonly plan: ImmutableUpdatePlanRefV1<"manifest_state">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..67_108_863] }
  | { readonly kind: "plan_derived"; readonly role: "release_trust_after";
      readonly plan: ImmutableUpdatePlanRefV1<"release_trust_state">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..67_108_863] }
  | { readonly kind: "plan_derived"; readonly role: "active_release_after";
      readonly plan: ImmutableUpdatePlanRefV1<"active_release_state">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..67_108_863] }
  | { readonly kind: "plan_derived"; readonly role: "rollback_record_after";
      readonly plan: ImmutableUpdatePlanRefV1<"rollback_record_state">;
      readonly value: CanonicalJsonV1;
      readonly valueBytes: Integer[1..67_108_863] };

type UpdateConstructionJournalKindV1 = UpdateTargetJournalKindV1 |
  "bundle_source_staging" | "rollback_payload_source";

interface UpdateConstructionJournalV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly constructionPlanHash: LowerHexSha256;
  readonly phase: "planned" | "directories_staging" | "files_staging" |
    "sources_staging" | "files_ready" |
    "outer_plan_publishing" | "outer_journal_publishing" | "handed_off" |
    "compensating" | "rolled_back" | "compacting";
  readonly nextDirectory: Integer[0..200_000];
  readonly directoryWriteState: UpdateConstructionDirectoryWriteStateV1 | null;
  readonly directoryIdentities: readonly UpdateConstructionDirectoryIdentityV1[0..200_000];
  readonly nextFile: Integer[0..1_100_000];
  readonly fileWriteState: UpdateConstructionWriteStateV1 | null;
  readonly nextOutputFrame: Integer[0..1_000_000];
  readonly nextOutputConsumer: Integer[0..1_000_000];
  readonly outerPlan: UpdateConstructionOuterFileV1 | null;
  readonly outerPlanWriteState: UpdateConstructionOuterWriteStateV1 | null;
  readonly outerPlanIdentity: UpdateConstructionOuterIdentityV1 | null;
  readonly outerJournal: UpdateConstructionOuterFileV1 | null;
  readonly outerJournalWriteState: UpdateConstructionOuterWriteStateV1 | null;
  readonly outerJournalIdentity: UpdateConstructionOuterIdentityV1 | null;
  readonly compensationNext: Integer[-1..1_099_999] | null;
  readonly compensationPart: "file" | "evidence" | null;
  readonly compensationDirectoryNext: Integer[-1..199_999] | null;
  readonly compactionNext: Integer[0..2_200_000] | null;
  readonly compactionDirectoryNext: Integer[0..200_000] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

type UpdateConstructionDirectoryWriteStateV1 =
  | { readonly ordinal: Integer[0..199_999]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..199_999]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

interface UpdateConstructionDirectoryIdentityV1 {
  readonly ordinal: Integer[0..199_999];
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type UpdateConstructionWriteStateV1 =
  | { readonly ordinal: Integer[0..1_099_999]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..1_099_999]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..1_099_999]; readonly state: "evidence_intent";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..1_099_999]; readonly state: "evidence_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
      readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };

interface UpdateConstructionFileEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly constructionPlanHash: LowerHexSha256;
  readonly ordinal: Integer[0..1_099_999];
  readonly pathHash: LowerHexSha256;
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface UpdateConstructionOuterFileV1 {
  readonly path: ExactProductStatePathV1;
  readonly bytes: Integer[1..16_777_216];
  readonly sha256: LowerHexSha256;
  readonly mode: 384;
}

type UpdateConstructionOuterWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 };

interface UpdateConstructionOuterIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface ImmutableUpdateConstructionRefV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: Integer[1..536_870_912];
}

interface UpdateExecutionPlanV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly previewHash: LowerHexSha256;
  readonly executionBindingHash: LowerHexSha256;
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly planner: PlannerTranscriptIdentityV1 | null;
  readonly bundle: ImmutableUpdatePlanRefV1<"bundle_publication">;
  readonly owners: readonly ImmutableUpdatePlanRefV1<"owner_update">[1..16];
  readonly migrations: readonly ImmutableUpdatePlanRefV1<"schema_migration">[0..10_000];
  readonly manifest: UpdateManifestStatePlansV1;
  readonly trust: ImmutableUpdatePlanRefV1<"release_trust_state"> | null;
  readonly active: ImmutableUpdatePlanRefV1<"active_release_state">;
  readonly rollback: ImmutableUpdatePlanRefV1<"rollback_record_state">;
  readonly rollbackPayload: ImmutableUpdatePlanRefV1<"rollback_payload_state">;
  readonly initialParticipantJournals: readonly UpdateInitialJournalRefV1[1..20_100];
  readonly recoveryExecutor: {
    readonly finalPath: ExactProductStatePathV1;
    readonly initial: UpdateRecoveryExecutorRecordV1;
    readonly initialStaged: UpdateRecoveryExecutorStagedFileV1;
    readonly terminal: UpdateRecoveryExecutorRecordV1;
    readonly terminalStaged: UpdateRecoveryExecutorStagedFileV1;
    readonly maximumRecordBytes: Integer[1..16_384];
  };
  readonly verification: ImmutableUpdatePlanRefV1<"target_verification">;
  readonly retirement: ImmutableUpdatePlanRefV1<"terminal_retirement">;
}

interface UpdateManifestStatePlansV1 {
  readonly transitional: ImmutableUpdatePlanRefV1<"manifest_state">;
  readonly terminal: ImmutableUpdatePlanRefV1<"manifest_state">;
}

type UpdateTargetJournalKindV1 =
  | "bundle_publication" | "owner_update" | "owner_external_effect" |
    "schema_migration" | "manifest_state" | "release_trust_state" |
    "active_release_state" | "rollback_record_state" | "rollback_payload_state";

type UpdateInitialJournalRefV1 = {
  readonly [K in UpdateTargetJournalKindV1]: UpdateInitialJournalRefForV1<K>
}[UpdateTargetJournalKindV1];

interface UpdateInitialJournalRefForV1<TKind extends UpdateTargetJournalKindV1> {
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly planHash: LowerHexSha256;
  readonly finalPath: CanonicalAbsolutePathV1;
  readonly stagedPath: CanonicalAbsolutePathV1;
  readonly stagedExpected: {
    readonly constructionOrdinal: Integer[0..1_099_999];
    readonly hash: LowerHexSha256;
    readonly bytes: Integer[1..1_048_576];
    readonly mode: 384;
  };
}

interface ImmutableUpdatePlanRefV1<TKind extends UpdateLeafPlanKindV1> {
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: Integer[1..16_777_216];
}

type UpdateLeafPlanKindV1 =
  | "update_execution" | "bundle_source_staging" | "bundle_publication" |
    "owner_update" | "owner_external_effect" | "schema_migration" | "manifest_state"
  | "release_trust_state" | "active_release_state" | "rollback_record_state"
  | "rollback_payload_source" | "rollback_payload_state" |
    "target_verification" | "terminal_retirement";

type UpdateLeafPlanIdV1<TKind extends UpdateLeafPlanKindV1> =
  TKind extends "owner_external_effect" ? OwnerExternalEffectIdV1 :
  TKind extends "schema_migration" ? SchemaMigrationIdV1 :
  TKind extends "manifest_state" ? ManifestParticipantIdV1 :
  SafeReasonCodeV1;

interface UpdateRecoveryExecutorRecordV1 {
  readonly schemaVersion: 1;
  readonly state: "executing" | "terminal_cleanup";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly executor:
    | { readonly kind: "release_bundle"; readonly release: ReleaseIdentityV1 }
    | { readonly kind: "package_fallback";
        readonly bundleManifestHash: LowerHexSha256;
        readonly launcherProtocol: PositiveUInt32V1;
        readonly updateProtocol: PositiveUInt32V1 };
  readonly executionBindingHash: LowerHexSha256;
  readonly createdAt: UtcTimestampV1;
}

interface UpdateRecoveryExecutorStagedFileV1 {
  readonly constructionOrdinal: Integer[0..1_099_999];
  readonly path: UpdateRecoveryExecutorStagedPathV1;
  readonly bytes: Integer[1..16_384];
  readonly hash: LowerHexSha256;
  readonly mode: 384;
}

interface BundlePublicationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly action: "publish_target" | "verify_previous";
  readonly target: ReleaseIdentityV1;
  readonly source: BundlePublicationSourceV1;
  readonly targetRootBefore:
    | { readonly state: "absent" }
    | { readonly state: "present"; readonly inventoryHash: LowerHexSha256;
        readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
  readonly metadata: readonly CanonicalStateFilePlanV1[3];
  readonly entries: readonly ReleaseBundleEntryV1[1..200_000];
  readonly inventoryHash: LowerHexSha256;
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

interface BundleSourceStagingPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootBefore: { readonly state: "absent" };
  readonly sourceParentDev: UInt64DecimalV1;
  readonly sourceParentIno: UInt64DecimalV1;
  readonly entries: readonly ReleaseBundleEntryV1[1..200_000];
  readonly inventoryHash: LowerHexSha256;
  readonly aggregateBytes: Integer[1..8_589_934_592];
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

interface BundleSourceReadyEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly stagingPlanHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootDev: UInt64DecimalV1;
  readonly sourceRootIno: UInt64DecimalV1;
  readonly structureIdentitiesHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly evidenceSetHash: LowerHexSha256;
  readonly entryCount: Integer[1..200_000];
  readonly aggregateBytes: Integer[1..8_589_934_592];
}

type BundlePublicationSourceV1 =
  | {
      readonly kind: "staged_source";
      readonly stagingPlan: ImmutableUpdatePlanRefV1<"bundle_source_staging">;
      readonly readyEvidencePath: CanonicalAbsolutePathV1;
    }
  | {
      readonly kind: "retained_bundle";
      readonly root: CanonicalAbsolutePathV1;
      readonly rootDev: UInt64DecimalV1;
      readonly rootIno: UInt64DecimalV1;
      readonly inventoryHash: LowerHexSha256;
      readonly entryCount: Integer[1..200_000];
      readonly aggregateBytes: Integer[1..8_589_934_592];
    };

interface OwnerUpdatePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly owner: ArtifactOwner;
  readonly currentPartitionHash: LowerHexSha256;
  readonly operations: readonly PersistedOwnerChangeOperationV1[0..1_000_000];
  readonly foundation: readonly FoundationParticipantRefV2[0..7_814];
  readonly externalEffects: readonly ImmutableUpdatePlanRefV1<"owner_external_effect">[0..1];
  readonly inverseOperationHash: LowerHexSha256;
  readonly maximumPlanBytes: Integer[1..16_777_216];
}

interface PersistedOwnerChangeOperationV1 {
  readonly operation: "keep" | "create" | "replace" | "remove";
  readonly owner: ArtifactOwner;
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly expectedBefore: PersistedManagedPathStateV1;
  readonly afterArtifact: ManagedArtifactV2 | null;
  readonly content: UpdatePayloadRefV1 | null;
}

type PersistedManagedPathStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "file"; readonly mode: 384 | 448;
      readonly hash: LowerHexSha256; readonly bytes: Integer[0..536_870_912];
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly state: "directory"; readonly mode: 448;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly state: "symlink"; readonly targetBytes: Integer[0..4_096];
      readonly targetHash: LowerHexSha256;
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

interface UpdatePayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: Integer[0..1_099_999];
  readonly path: UpdatePayloadPathV1;
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
}

interface OwnerExternalEffectPlanV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly kind: "codex_registration_refresh";
  readonly owner: "codex";
  readonly providerProtocol: PositiveUInt32V1;
  readonly fileParticipantIds: readonly FoundationTransactionIdV2[1..3_907];
  readonly expectedStateHash: LowerHexSha256;
  readonly proposedStateHash: LowerHexSha256;
  readonly processPolicy: OwnerExternalEffectProcessPolicyV1;
  readonly processPolicyHash: LowerHexSha256;
  readonly forwardPayloads: readonly [];
  readonly compensationPayloads: readonly [];
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly maximumEvidenceBytes: Integer[1..1_048_576];
}

interface OwnerExternalEffectProcessPolicyV1 {
  readonly kind: "codex_registration_refresh";
  readonly providerProtocol: PositiveUInt32V1;
  readonly executable: "pinned_codex_cli";
  readonly executableIdentity: {
    readonly ownerUid: EffectiveUidV1;
    readonly mode: 448 | 493;
    readonly nlink: 1;
    readonly bytes: Integer[1..536_870_912];
    readonly sha256: LowerHexSha256;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
  readonly argv: readonly OwnerExternalEffectArgV1[1..64];
  readonly cwd: "managed_plugin_root";
  readonly environment: readonly [
    { readonly name: "HOME"; readonly value: "managed_vendor_home" },
    { readonly name: "TMPDIR"; readonly value: "private_effect_tmp" }
  ];
  readonly stdin: "closed";
  readonly network: false;
  readonly model: false;
  readonly stdoutBytes: Integer[1..1_048_576];
  readonly stderrBytes: Integer[1..1_048_576];
  readonly wallMilliseconds: Integer[1..120_000];
  readonly idleMilliseconds: Integer[1..30_000];
  readonly processCount: 1;
}

type OwnerExternalEffectArgV1 =
  | { readonly kind: "literal"; readonly value: OwnerExternalEffectLiteralV1 }
  | { readonly kind: "token"; readonly value:
      "managed_plugin_root" | "plugin_id" | "private_effect_tmp" };

type OwnerExternalEffectLiteralV1 = string &
  { readonly __brand: "ascii-argv-literal-1..128-no-nul-control" };

interface OwnerExternalEffectJournalV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "forward_intent" | "forward_observed" |
    "compensation_intent" | "compensation_observed" | "finalized" | "rolled_back";
  readonly direction: "forward" | "compensating";
  readonly nextTransition: Integer[0..2];
  readonly evidenceHash: LowerHexSha256 | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface OwnerExternalEffectEvidenceV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly direction: "forward" | "compensating";
  readonly observedStateHash: LowerHexSha256;
  readonly processPolicyHash: LowerHexSha256;
  readonly exitCode: 0;
  readonly redactedStdoutHash: LowerHexSha256;
  readonly redactedStderrHash: LowerHexSha256;
  readonly completedAt: UtcTimestampV1;
}

type CanonicalStateFileStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly hash: LowerHexSha256;
      readonly payload: StatePayloadRefV1 | null; readonly ownerUid: EffectiveUidV1;
      readonly mode: 384; readonly nlink: 1; readonly size: Integer[1..67_108_864];
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

interface StatePayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: Integer[0..1_099_999];
  readonly path: CanonicalStatePayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: Integer[1..67_108_864];
  readonly mode: 384;
}

interface CanonicalStateFilePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly role: "release_metadata" | "release_trust" | "active_release" |
    "rollback_record";
  readonly path: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: CanonicalStateFileStateV1;
  readonly after: CanonicalStateFileStateV1;
  readonly reversal: "reversible" | "monotonic_no_reverse";
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

type ReleaseTrustStatePlanV1 = CanonicalStateFilePlanV1 & {
  readonly role: "release_trust"; readonly reversal: "monotonic_no_reverse" };
type ActiveReleaseStatePlanV1 = CanonicalStateFilePlanV1 & {
  readonly role: "active_release"; readonly reversal: "reversible" };
type RollbackRecordStatePlanV1 = CanonicalStateFilePlanV1 & {
  readonly role: "rollback_record"; readonly reversal: "reversible" };

interface RollbackPayloadStatePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly retainedBefore: RollbackPayloadIdentityV1 | null;
  readonly publish: RollbackPayloadIdentityV1 | null;
  readonly source: RollbackPayloadPublicationSourceV1 | null;
  readonly retainAfter: RollbackPayloadIdentityV1 | null;
  readonly retireAtTerminal: readonly RollbackPayloadIdentityV1[0..1];
  readonly publicationInventoryHash: LowerHexSha256 | null;
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

interface RollbackPayloadSourceStagingPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootBefore: { readonly state: "absent" };
  readonly sourceParentDev: UInt64DecimalV1;
  readonly sourceParentIno: UInt64DecimalV1;
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entriesProjectionHash: LowerHexSha256;
  readonly metadata: readonly [
    RollbackPayloadSourceMetadataPlanV1,
    RollbackPayloadSourceMetadataPlanV1
  ];
  readonly entryCount: Integer[1..1_000_000];
  readonly aggregateBytes: Integer[0..2_147_483_648];
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
}

interface RollbackPayloadSourceMetadataPlanV1 {
  readonly role: "inverse_plan" | "inventory";
  readonly path: CanonicalAbsolutePathV1;
  readonly bytes: Integer[1..67_108_864];
  readonly sha256: LowerHexSha256;
}

interface UpdateDirectoryIdentityV1 {
  readonly role: "source_envelope" | "source_payload_root" | "source_evidence_root" |
    "rollback_payload_root" | "target_bundle_root" | "plans_root" |
    "owner_inverse_plans_root" | "schema_migration_inverse_plans_root" | "blobs_root";
  readonly path: CanonicalAbsolutePathV1;
  readonly mode: 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface DurableSourceEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly sourceKind: "bundle" | "rollback_payload";
  readonly stagingPlanHash: LowerHexSha256;
  readonly ordinal: Integer[0..999_999];
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface RollbackPayloadSourceReadyEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly stagingPlanHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootDev: UInt64DecimalV1;
  readonly sourceRootIno: UInt64DecimalV1;
  readonly structureIdentitiesHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly evidenceSetHash: LowerHexSha256;
  readonly metadata: readonly [
    RollbackPayloadSourceMetadataIdentityV1,
    RollbackPayloadSourceMetadataIdentityV1
  ];
  readonly entryCount: Integer[1..1_000_000];
  readonly aggregateBytes: Integer[0..2_147_483_648];
}

interface RollbackPayloadSourceMetadataIdentityV1 {
  readonly role: "inverse_plan" | "inventory";
  readonly path: CanonicalAbsolutePathV1;
  readonly bytes: Integer[1..67_108_864];
  readonly sha256: LowerHexSha256;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface RollbackPayloadPublicationSourceV1 {
  readonly stagingPlan: ImmutableUpdatePlanRefV1<"rollback_payload_source">;
  readonly readyEvidencePath: CanonicalAbsolutePathV1;
}

interface TargetVerificationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly release: ReleaseIdentityV1;
  readonly verifierEntrypoint: BundleRelativePathV1;
  readonly manifestHash: LowerHexSha256;
  readonly ownerPostimagesHash: LowerHexSha256;
  readonly migrationPostimagesHash: LowerHexSha256;
  readonly inputBytes: Integer[1..268_435_456];
  readonly stdoutBytes: Integer[1..1_048_576];
  readonly stderrBytes: Integer[0..1_048_576];
  readonly idleMilliseconds: Integer[1..30_000];
  readonly wallMilliseconds: Integer[1..300_000];
  readonly processCount: 1;
  readonly readOnly: true;
}

interface UpdateTerminalRetirementPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly set: "prior_rollback" | "consumed_rollback_and_rejected_release";
  readonly transitionalManifestHash: LowerHexSha256;
  readonly entries: readonly RetirementInventoryRefV1[0..16];
  readonly maximumLeaves: Integer[0..1_200_012];
  readonly maximumPlanBytes: Integer[1..16_777_216];
}

interface RetirementInventoryRefV1 {
  readonly kind: "bundle" | "metadata" | "rollback_payload" | "rollback_record";
  readonly root: CanonicalAbsolutePathV1;
  readonly inventoryHash: LowerHexSha256;
  readonly leafCount: Integer[0..1_000_007];
}

interface BoundedUpdateInversePlanV1 {
  readonly schemaVersion: 1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly installedReleaseIdentityHash: LowerHexSha256;
  readonly previousReleaseIdentityHash: LowerHexSha256;
  readonly ownerPlans: readonly RetainedInversePlanRefV1<"owner_inverse">[1..16];
  readonly migrationPlans: readonly RetainedInversePlanRefV1<"schema_migration_inverse">[0..10_000];
  readonly exactStepListHash: LowerHexSha256;
  readonly maximumBytes: Integer[1..16_777_216];
}

interface RetainedInversePlanRefV1<TKind extends
  "owner_inverse" | "schema_migration_inverse"> {
  readonly kind: TKind;
  readonly id: RetainedInversePlanIdV1<TKind>;
  readonly path: RollbackPayloadRelativePathV1;
  readonly sourcePlanHash: LowerHexSha256;
  readonly retainedHash: LowerHexSha256;
  readonly bytes: Integer[1..16_777_216];
}

type RetainedInversePlanIdV1<TKind extends
  "owner_inverse" | "schema_migration_inverse"> =
  TKind extends "schema_migration_inverse" ? SchemaMigrationIdV1 : SafeReasonCodeV1;

interface RetainedOwnerInversePlanV1 {
  readonly schemaVersion: 1;
  readonly kind: "owner_inverse";
  readonly id: SafeReasonCodeV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly owner: ArtifactOwner;
  readonly sourceOwnerPlanHash: LowerHexSha256;
  readonly operations: readonly RetainedOwnerInverseOperationV1[0..1_000_000];
  readonly externalEffects: readonly RetainedExternalEffectInversePlanV1[0..1];
  readonly maximumPlanBytes: Integer[1..16_777_216];
}

interface RetainedOwnerInverseOperationV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly expectedCurrent: RetainedInversePathStateV1;
  readonly restore: RetainedInversePathStateV1;
}

type RetainedInversePathStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "directory"; readonly mode: 448 }
  | { readonly state: "file"; readonly mode: 384 | 448;
  readonly bytes: Integer[0..16_777_216]; readonly sha256: LowerHexSha256;
      readonly payload: RetainedInverseContentRefV1 | null };

interface RetainedInverseContentRefV1 {
  readonly chunks: readonly RetainedInverseBlobRefV1[0..1];
  readonly aggregateBytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
}

interface RetainedExternalEffectInversePlanV1 {
  readonly kind: "codex_registration_refresh";
  readonly providerProtocol: PositiveUInt32V1;
  readonly expectedCurrentStateHash: LowerHexSha256;
  readonly restoreStateHash: LowerHexSha256;
  readonly restorePayloads: readonly RetainedInverseBlobRefV1[0..32];
  readonly processPolicy: OwnerExternalEffectProcessPolicyV1;
  readonly processPolicyHash: LowerHexSha256;
}

interface RetainedSchemaMigrationInversePlanV1 {
  readonly schemaVersion: 1;
  readonly kind: "schema_migration_inverse";
  readonly id: SchemaMigrationIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceMigrationPlanHash: LowerHexSha256;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly RetainedSchemaMigrationInverseMutationV1[1..100_000];
  readonly maximumPlanBytes: Integer[1..16_777_216];
}

interface RetainedSchemaMigrationInverseMutationV1 {
  readonly path: VaultRelativePathV1 | CanonicalProductStatePathV1;
  readonly expectedCurrentHash: LowerHexSha256;
  readonly restoreHash: LowerHexSha256;
  readonly restoreBlob: RetainedInverseBlobRefV1;
}

interface RetainedInverseBlobRefV1 {
  readonly path: RollbackPayloadRelativePathV1;
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
}

type UpdateStateLeafKindV1 =
  | "manifest_state" | "release_trust_state" | "active_release_state" |
    "rollback_record_state";

interface UpdateStateParticipantJournalV1<TKind extends UpdateStateLeafKindV1> {
  readonly schemaVersion: 1;
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "preimage_preserved" | "published" | "verified" |
    "compensating" | "finalized" | "rolled_back";
  readonly nextTransition: Integer[0..4];
  readonly compensationNext: Integer[-1..3] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface OwnerUpdateJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "files_applying" | "effects_applying" | "verified" |
    "compensating" | "finalized" | "rolled_back" | "compacting";
  readonly nextForwardFoundation: Integer[0..3_907];
  readonly nextExternalEffect: Integer[0..1];
  readonly compensationNext: Integer[-1..3_907] | null;
  readonly compactionNext: Integer[0..7_814] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface SchemaMigrationExecutionJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SchemaMigrationIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "applying" | "verified" | "compensating" |
    "finalized" | "rolled_back" | "compacting";
  readonly nextForwardFoundation: Integer[0..391];
  readonly compensationNext: Integer[-1..390] | null;
  readonly compactionNext: Integer[0..782] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface BundlePublicationJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "root_publishing" | "entries_publishing" |
    "metadata_publishing" | "verified" | "compensating_metadata" |
    "compensating_entries" | "compensating_root" | "finalized" | "rolled_back" |
    "compacting";
  readonly nextRootTransition: Integer[0..1];
  readonly rootWriteState: UpdatePublicationStructureWriteStateV1 | null;
  readonly targetRootIdentity: UpdateDirectoryIdentityV1 | null;
  readonly nextEntry: Integer[0..200_000];
  readonly entryWriteState: UpdatePublicationEntryWriteStateV1 | null;
  readonly nextMetadata: Integer[0..3];
  readonly metadataWriteState: UpdatePublicationMetadataWriteStateV1 | null;
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[0..3];
  readonly compensationMetadataNext: Integer[-1..2] | null;
  readonly compensationNext: Integer[-1..199_999] | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationRootNext: Integer[-1..0] | null;
  readonly compactionNext: Integer[0..200_000] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface BundleSourceStagingJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "structure_staging" | "entries_staging" | "source_ready" |
    "compensating" | "rolled_back" | "compacting";
  readonly nextStructure: Integer[0..3];
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[0..3];
  readonly structureWriteState: UpdateSourceStructureWriteStateV1 | null;
  readonly nextEntry: Integer[0..200_000];
  readonly entryWriteState: UpdateSourceEntryWriteStateV1 | null;
  readonly readyWriteState: UpdateSourceReadyWriteStateV1 | null;
  readonly readyIdentity: UpdateSourceReadyIdentityV1 | null;
  readonly compensationNext: Integer[-1..199_999] | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: Integer[-1..2] | null;
  readonly compactionNext: Integer[0..400_004] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface RollbackPayloadSourceStagingJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "structure_staging" | "metadata_publishing" | "payload_staging" |
    "source_ready" | "compensating" | "rolled_back" | "compacting";
  readonly nextStructure: Integer[0..7];
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[0..7];
  readonly structureWriteState: UpdateSourceStructureWriteStateV1 | null;
  readonly nextMetadata: Integer[0..2];
  readonly metadataIdentities: readonly RollbackPayloadSourceMetadataIdentityV1[0..2];
  readonly metadataWriteState: UpdateSourceMetadataWriteStateV1 | null;
  readonly nextEntry: Integer[0..1_000_000];
  readonly entryWriteState: UpdateSourceEntryWriteStateV1 | null;
  readonly readyWriteState: UpdateSourceReadyWriteStateV1 | null;
  readonly readyIdentity: UpdateSourceReadyIdentityV1 | null;
  readonly compensationMetadataNext: Integer[-1..1] | null;
  readonly compensationNext: Integer[-1..999_999] | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: Integer[-1..6] | null;
  readonly compactionNext: Integer[0..2_000_010] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

type UpdateSourceStructureWriteStateV1 =
  | { readonly ordinal: Integer[0..6]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..6]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

type UpdateSourceMetadataWriteStateV1 =
  | { readonly ordinal: Integer[0..1]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..1]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

type UpdateSourceEntryWriteStateV1 =
  | { readonly ordinal: Integer[0..999_999]; readonly state: "entry_intent" }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "entry_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "evidence_intent";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "evidence_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
      readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };

type UpdateSourceReadyWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1 };

interface UpdateSourceReadyIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface RollbackPayloadPublicationJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "structure_publishing" | "entries_publishing" |
    "metadata_publishing" | "verified" | "compensating_metadata" |
    "compensating_entries" | "compensating_structure" |
    "finalized" | "rolled_back" | "compacting";
  readonly nextStructure: Integer[0..5];
  readonly structureWriteState: UpdatePublicationStructureWriteStateV1 | null;
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[0..5];
  readonly nextEntry: Integer[0..1_000_000];
  readonly entryWriteState: UpdatePublicationEntryWriteStateV1 | null;
  readonly nextMetadata: Integer[0..2];
  readonly metadataWriteState: UpdatePublicationMetadataWriteStateV1 | null;
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[0..2];
  readonly compensationMetadataNext: Integer[-1..1] | null;
  readonly compensationNext: Integer[-1..999_999] | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: Integer[-1..4] | null;
  readonly compactionNext: Integer[0..1_000_000] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

type UpdatePublicationStructureWriteStateV1 =
  | { readonly ordinal: Integer[0..4]; readonly state: "create_intent" }
  | { readonly ordinal: Integer[0..4]; readonly state: "created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

type UpdatePublicationEntryWriteStateV1 =
  | { readonly ordinal: Integer[0..999_999]; readonly state: "entry_intent" }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "entry_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "evidence_intent";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: Integer[0..999_999]; readonly state: "evidence_created";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
      readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };

type UpdatePublicationMetadataWriteStateV1 =
  | { readonly ordinal: Integer[0..2]; readonly state: "publish_intent" }
  | { readonly ordinal: Integer[0..2]; readonly state: "published";
      readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

interface UpdatePublishedMetadataIdentityV1 {
  readonly ordinal: Integer[0..2];
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

interface DurablePublicationEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly participantKind: "bundle_publication" | "rollback_payload_state";
  readonly participantPlanHash: LowerHexSha256;
  readonly ordinal: Integer[0..999_999];
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly bytes: Integer[0..536_870_912];
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}
```

The construction envelope closes every write that precedes outer coordinator intent. After the
under-lock planner result-JSON frame matches the private candidate and IDs are allocated, but before
the first output-blob frame is read, the current executor derives all allocation-dependent plan,
inverse, inventory, payload, initial-journal, and recovery-record bytes. It publishes exactly one
`UpdateConstructionPlanV1` first at
`staging/lifecycle/<coordinator-id>/update-construction.plan.json`. Its only temporary name is
the sibling `update-construction.plan.pending`; the initial construction journal's only temporary is
`update-construction.journal.pending`, beside final `update-construction.journal.json`. The exact
coordinator staging root already exists empty, owner-only `0700`, with the same device/inode as
`stagingRoot`: its creation and identity are the existing allocator-reserved Spec 1 coordinator-
staging-root transition, and no `update` child exists yet. Each file uses owner-owned,
single-link `0600`, bounded prefix writes, file and parent sync, no-replace rename, and reopen.
Because no earlier attempt byte exists, a crash-partial `.pending` is never adopted: under the global
lock it may be guarded-unlinked only when the allocator proves this coordinator ID was reserved in
the current installation epoch, the final construction plan and journal are absent, the entire
closed coordinator staging tree contains only that one exact temp plus its plan-derived empty
parents, and no participant/target postimage exists. Cleanup opens it no-follow, checks owner/mode/
link/count/size, holds the descriptor, rechecks the same device/inode immediately before unlink, and
syncs the parent. Any second child, final-plus-temp, identity change, over-bound byte, or later-state
evidence is exit 6. A complete final construction plan instead determines every later byte and path.

Initial-journal temp admission is distinct: a valid final construction plan may coexist with exactly
one `update-construction.journal.pending` that is an exact prefix of the plan-derived canonical
initial journal, only while the final journal, every construction directory/file, outer envelope,
and target postimage are absent. Recovery identity-rechecks and may finish no-replace publication or
guarded-remove that one prefix and recreate it. With a final journal present, ordinary rewrites use
only sibling `update-construction.journal.rewrite.pending`. It must be an exact prefix of the one
legal next journal derived from the reopened current journal and plan. A complete rewrite temp is
synced/reopened, atomically replaces that exact current final inode, syncs the parent, and is reopened;
a partial valid prefix may be resumed or guarded-removed under the global lock. Current-final plus
one valid rewrite prefix/complete temp, or the already-next final with no temp, are the only states.
Multiple/unknown temps, a temp not matching the unique next bytes, old-final identity change, or any
phase/cursor leap is exit 6.
`constructionJournalCreatedAt` is both timestamps in the initial construction journal;
`outerJournalCreatedAt` is both timestamps in the initial V2 coordinator journal. These plan fields,
the immutable construction rows, and the derived outer plan therefore determine both initial journal
byte strings without consulting a dead process clock. Later `updatedAt` values come only from the
one legal journal transition under the held lock.

`directories` is a contiguous parent-before-child list of every expected-absent variable directory
needed by the exact `update/plans/<kind>`, construction evidence, payload, initial-journal,
recovery-executor, and other construction-file paths. `directories[0]` is the exact `update` child
of `stagingRoot`; every later parent is either that guarded staging root or a lower-ordinal created
directory. Before mkdir the journal persists directory `create_intent`; after exclusive mkdir and
parent sync it persists the reopened device/inode as `created`, appends the same ordinal/dev/ino to
the exact contiguous `directoryIdentities` array, and only then advances. At `create_intent`, absence
may retry; presence may bind only the exact empty owner-only `0700` directory at the planned path
under the reopened identity-checked parent. Recovery records that observed device/inode as
`created` before any child is admitted. A nonempty directory, wrong kind/owner/mode/link metadata,
or any other present path is unbound exit 6. Later adoption/removal additionally requires that
recorded device/inode. Every file row's `parent` equals the one exact preexisting root or created
directory and is rechecked before create.

`files` is contiguous by ordinal and is the exact non-empty concatenation of: every immutable
leaf/source plan in dependency order (including `update_execution`); each required source journal's
initial bytes in bundle-then-rollback order; every direct Foundation/owner/migration/state/effect
payload in source-kind order `planner_output`, `signed_bundle_entry`, `guarded_preimage`,
`guarded_signed_metadata`, `plan_derived`, then consumer and payload order; every remaining staged
initial participant journal in leaf execution order; and the two recovery-executor records in
executing then terminal order. Once a source plan/journal pair is complete, its journal creates the
fixed source structure before the first blob assigned to that source is read; a single bounded blob
may be written to each of its exact construction/source consumers before the input frame is released.
The plan excludes the outer coordinator plan/journal to avoid a hash cycle. Every
consumer-side `update_expected` ref and every `UpdateInitialJournalRefV1.stagedExpected` row equals
one file row by coordinator ID, ordinal, path, bytes, hash, mode, role, and sole-consumer rules.
Missing, duplicate, cross-role, unreferenced, or multiply consumed rows refuse. Source-envelope
payload entries remain owned by their source plans/journals; those source plans and their exact
initial journals are themselves construction rows.
`outputFrames` is contiguous by planner ordinal, byte/hash-equal to the private candidate, and names
every output-backed construction row and rollback-source entry exactly once in consumer order. A
construction consumer must be a `planner_output` row with the same ordinal; no other source arm may
appear. Missing, duplicate, unreferenced, or more-than-plan-bound consumer rows refuse before the
first output frame.

`rollbackSource` is non-null exactly for `update_apply` and null for manual `update_rollback`. Its ID,
payload/binding/inventory hashes equal the one `rollback_payload_source` leaf and the prepared
inventory. Entries and their nested inventory rows have the same contiguous ordinal, and the nested
rows byte-equal `PreparedUpdateMaterializationV1.rollbackInventoryEntries`. The hash is SHA-256 over
`developer-os/update-rollback-source-entries/v1\0` plus no-LF canonical bytes of
`{ payloadId, rollbackBindingHash, inventoryHash, entries }`; the construction object and source plan
carry that equal `entriesProjectionHash`, without either containing the other's hash. Thus the
16-MiB source plan remains bounded while the 512-MiB construction plan durably owns the exact ordered
paths/roles/hashes and refuses if their canonical projection would exceed its cap.

Each rollback-source output consumer selects the equal construction entry ordinal and is legal only
when that entry source is `planner_output` with the same frame ordinal. An `owner_preimage` entry
uses only `guarded_preimage` with `owner_operation_before`; a `migration_preimage` uses only the
matching inverse planner frame or `schema_migration_before`; an `inverse_plan_leaf` uses only the
exact owner or schema retained-plan projection matching its role/ref. The current Codex-effect
protocol admits no `external_effect_preimage` inventory row. For every row, including output,
`sourceProjectionHash` uses
`developer-os/update-rollback-entry-source/<source-kind>/v1\0` plus the no-LF complete source arm.
For `planner_output`, that arm contains only its ordinal and the selected frame must have equal
ordinal/bytes/raw hash to the nested inventory entry.
The source journal reopens/recomputes that authority and uses the construction entry's relative path,
role, size, and raw hash before any source create or recovery prefix check; `pathHash` evidence is a
consequence, never the inventory authority. Every construction entry is consumed exactly once and
every source-plan entry/evidence cursor derives from that same array.

Every payload row has one closed materialization source. `planner_output` is legal only for an
`owner_content` or `migration_content` row and is bijective with the matching output-frame consumer.
`signed_bundle_entry` is legal only for `foundation_content` or `owner_content`;
its release/root identity and inventory hash equal the retained verified target bundle, and its
relative path, mode, size, raw hash, and reopened file identity equal exactly one signed inventory
entry. `guarded_preimage` is legal only for `foundation_content`, `owner_content`,
`migration_content`; its authority selects exactly one reopened operation,
mutation, or Foundation mutation in the referenced immutable plan,
and that selected plan field must name the same path/hash/bytes/mode. Owner and migration authorities
also require the selected guarded expected-before row; the Foundation authority requires the exact
participant/mutation target. No authority may
select two construction rows. `guarded_signed_metadata` is legal only for `state_after`; its role maps
delegation, release index, and bundle manifest to bundle-plan metadata ordinal zero, one, and two,
and its complete metadata identity plus guarded path/owner/mode/link/size/hash/inode must equal the
retained verified signed-metadata file selected by that ordinal.

`plan_derived` is legal only for `foundation_initial` or `state_after`. Its role is exhaustive:
Foundation initial journal bytes derive from the referenced participant plus the shown plan and
planned-byte hashes; manifest, trust, active-release, and rollback-record bytes derive from the
matching immutable plan's exact postimage. The tagged plan kind is structurally fixed by each role.
For every plan-derived arm, `value` is the complete exact-schema canonical JSON value, including all
timestamps and data fields; `valueBytes` is its no-LF UTF-8 length, and the materialized file is those
exact bytes plus one LF. The plan's ref/postimage hash and every duplicated semantic field must
recompute from `value`; opaque or merely hash-shaped values refuse. `sourceProjectionHash` is SHA-256 over the exact ASCII domain
`developer-os/update-construction-payload-source/<source-kind>/v1\0` plus no-LF canonical bytes of
the complete source arm; the field itself is excluded. Before byte zero and on every recovery, the
executor reopens the selected authority, recomputes that projection and the unique derived/source
bytes, secret-scans them, and requires their length/raw SHA-256/mode to equal the construction row.
A source that changed, disappeared, aliases another authority, or cannot independently reproduce
the planned bytes selects compensation before handoff; it is never replaced by a path guess.
That compensation uses the recorded-inode/parent/metadata-only cleanup rule below and does not need
the vanished source to classify or hash a partial attempt-created target.

For construction file ordinal `n`, evidence is exactly
`staging/lifecycle/<coordinator-id>/update/construction/evidence/<n-as-ten-decimal-digits>.json`.
Before `O_CREAT | O_EXCL | O_NOFOLLOW`, the journal durably records `create_intent`. After create it
records the reopened device/inode as `created` and syncs that rewrite before writing byte zero.
Only then may bounded bytes be written. Complete bytes are synced/reopened, required to equal the
plan hash/length/mode, then move `fileWriteState` to `evidence_intent` while retaining the target
device/inode. The executor exclusively creates the exact evidence path, records its reopened inode
as `evidence_created` before byte zero, writes only the one derived canonical
`UpdateConstructionFileEvidenceV1`, syncs/reopens it, and only then advances `nextFile` and clears
`fileWriteState`. No evidence temp or alternate name is legal. In the originating process, a partial
evidence file may continue only when its recorded identity and bytes match an exact prefix of that
one canonical object. After process death it follows the identity-only compensation rule below. At
`evidence_intent`, absence may retry; presence may bind only the exact
zero-byte owner-only single-link `0600` regular file at the planned evidence path under the reopened
identity-checked evidence parent. Recovery first persists its observed device/inode as
`evidence_created`, then admits only that canonical prefix. A complete evidence
file is removable later only after no-follow reopen proves exact canonical content, target identity,
owner/mode/link bound, and stable evidence inode across unlink. At file `create_intent`, absence may
retry; presence may bind only the exact zero-byte planned owner/mode/single-link regular file under
the reopened identity-checked parent. Recovery persists that observed device/inode as `created`
before any byte is admitted. A nonempty or metadata-wrong unbound target/evidence path is exit 6.
A `created` row may continue writing in the originating process only when device/inode and the
current bytes equal an exact prefix (including the complete form) of its one planned file. Evidence
and file must agree on the same identity/content before completion. Any path/content/identity
mismatch is preserved, never deleted or adopted. Thus no manifest/state/Foundation payload,
participant journal, immutable leaf/source plan, execution leaf, or recovery staged record relies on
path branding alone for planless cleanup.

That prefix-resume rule is available only to the still-running constructing process. Any later
closure admission before handoff selects compensation-only: it reopens the journal-recorded target
or evidence inode under its identity-checked parent, requires exact kind/owner/mode/link count and the
declared size cap, rechecks the same dev/ino immediately before unlink, and may remove it regardless
of its partial content. It never resumes a payload/source write after process death. An inode swap,
unrecorded nonempty path, wrong metadata, over-bound file, or unexpected child remains exit 6. This
also governs partial staged participant journals and outer plan/journal files whose complete source
bytes need not be regenerated merely to compensate.

The evidence binds the initial inode/content, not an impossible permanent byte freeze. An immutable-
plan row must remain byte-identical. A payload may move only at its exact participant cursor. A
source journal may rewrite the same inode only through its valid plan-bound phase grammar; a staged
participant journal may move to its exact final path and then rewrite only after the outer step
reaches it; and a recovery record may perform only the two exact renames in the coordinator table.
At every such transition the construction evidence's device/inode must equal the moved/current
inode and the owning journal/outer cursor supplies the current-content authority. Before that owning
cursor, current bytes still must equal the evidence hash. Missing-at-both-paths, two linked copies,
an unowned rewrite, or an inode change is exit 6.

The construction phase/cursor table is linear. `planned` requires every cursor/state/outer field
zero or null and an empty `directoryIdentities`. `directories_staging` owns only
`nextDirectory`/`directoryWriteState`; its identity array is the exact contiguous prefix and every
file/output/source cursor remains zero. `files_staging` requires `nextDirectory ==
directories.length`, owns `nextFile`/`fileWriteState`, `nextOutputFrame`, and
`nextOutputConsumer`; it may also advance a required source journal only after that source's plan
and initial-journal construction rows are complete. Before the first output frame, each such source
must be exactly at its plan-derived entry-ready structure/metadata cursor. For output frame `f`,
`nextOutputFrame == f`; its consumers advance in the exact listed order, and each completed
construction-file/source-entry cursor must equal the corresponding durable evidence before
`nextOutputConsumer` advances. The frame remains in bounded parent memory until all consumers are
synced/evidenced; only then does `nextOutputFrame` advance and `nextOutputConsumer` reset to zero.
Thus nested source cursors during `files_staging` are legal only at the exact prefix derived from
completed `outputFrames`, plus the one current consumer. `sources_staging` requires
`nextFile == files.length` and `nextOutputFrame == outputFrames.length`, and delegates only the
remaining non-planner/source-ready suffix to the two nested source cursors; `files_ready`
requires those sources terminal-ready and all outer fields null. `outer_plan_publishing` admits only
the exact outer-plan intent/created/complete prefix; `outer_journal_publishing` requires the complete
outer plan and admits the same prefix for the initial journal; `handed_off` requires both complete
identities and the valid initial coordinator closure. Compensation is legal only before handoff and
walks the greatest reached construction/source prefix; construction compensation and terminal
compaction remove files/evidence first and recorded directories in exact reverse ordinal order.
Compaction is legal only from an outer terminal coordinator. Every unused
write/compensation/compaction field is null and the first cursor
beyond its exact enclosing count refuses.

Source journals may create their identity-recorded directories and accept their plan-bound streams
as soon as their construction plan/journal rows are complete, under the paired-prefix rule above.
With `nextFile == files.length`, construction enters `sources_staging`; every non-source row remains
validated through the role-aware rule while the remaining local/source-ready suffix advances. When all required source-ready proofs are
complete, the construction journal enters `files_ready`. It then stores the
exact derived outer-plan ref in `outerPlan`, records outer `create_intent`, records the created inode
before byte zero, and publishes/reopens the exact V2 coordinator plan; the complete inode remains in
`outerPlanIdentity`. It repeats that protocol for the exact canonical initial outer journal and
retains `outerJournalIdentity`. Completion of the outer journal changes construction
phase to `handed_off`; no target mutation is legal earlier. The outer plan's `construction` ref must
match the reopened construction plan, while the journal/evidence exact set must prove every file
complete. For either outer create intent, absence may retry and presence may bind only the exact
zero-byte owner-only single-link `0600` regular file at the planned exact product-state path under
its reopened identity-checked parent. Recovery persists the observed inode as `created` before byte
zero; nonempty/wrong-metadata presence or any other inode is exit 6. Before handoff, recovery is compensation-only and performs no network, planner, or vendor
call: nested source journals compensate first, then construction files/evidence and recorded
directories in exact reverse, construction journal, and construction plan last. At/after handoff the outer closure owns the whole
envelope. Terminal `coordinator_staging` compacts nested sources, construction files/evidence, and
the construction journal/plan only after both recovery staged paths are absent and while the outer
coordinator envelope is still valid. The construction journal's `compactionNext` owns exactly
`2 * files.length` transitions (at most `2_200_000`): for cursor `k`, file ordinal is
`files.length - 1 - floor(k / 2)`, even `k` guarded-removes that file or proves its delegated guarded
absence, and odd `k` guarded-removes that row's construction evidence. Only after that cursor is
complete does `compactionDirectoryNext` remove `directories` in exact reverse ordinal order, one
per transition. A file transition with nested participant/source deletion authority accepts absence
only with the matching terminal nested plan/journal evidence; every other file transition requires
the construction-evidenced inode/content and deletes it before its evidence. The two cursors may
therefore be only file/evidence-prefix with directory cursor zero, or complete file/evidence cursor
with a reverse-directory prefix.

The outer `coordinator_staging` entry then owns exactly two fixed suffix actions, not construction-
journal cursor values: guarded-unlink final `update-construction.journal.json` after reopening its
terminal complete cursors and syncing its parent, then guarded-unlink the immutable
`update-construction.plan.json` after reopening its hash/identity. A crash admits only both present,
journal absent plus plan present, or both absent at the unchanged outer cursor. The outer
`compactionNext` advances once only after both are absent. Thus a deleted journal is never expected
to persist its own next cursor, and no unnamed `+ 6` state exists.
For the two source kinds and exactly the leaf kinds in `UpdateTargetJournalKindV1`, their nested
source/participant cursor is the sole deletion authority for that plan and initial journal; the
later construction cursor requires guarded absence plus matching terminal nested evidence and
removes only its construction evidence, so no inode is deleted twice. The read-only
`update_execution`, `target_verification`, and `terminal_retirement` leaf plans have no nested
journal or compaction authority: their even construction transitions guarded-delete the exact
construction-evidenced inode/content, and their odd transitions delete the matching construction
evidence.

Every interface above has the exact shown key set; unknown/missing/duplicate keys and illegal tagged
combinations refuse. Each immutable leaf/source plan is canonical JSON plus LF, at most 16 MiB before parse, and
hashes `developer-os/update-leaf/<kind>/v1\0` plus those bytes. A ref path is derived as
`staging/lifecycle/<coordinator-id>/update/plans/<kind>/<id>.plan.json`; kind/ID/path/hash/byte length
must agree in both directions, and the concrete leaf's coordinator ID must equal the outer plan.
`UpdateLeafPlanIdV1` is enforced before path construction: schema leaves use their migration ID,
owner-effect leaves their allocated `oe` ID, manifest leaves their exact manifest-participant ID,
and every other current kind a `SafeReasonCodeV1`.
All arms are single ASCII path segments of at most 106 bytes with no slash/dot segment or percent
decoding; the initial-journal and retained-inverse ID mappings use the same concrete arm as their
referenced plan. A generic safe-code parser is never used to narrow a wider concrete ID.
`UpdateExecutionPlanV1` is itself the `update_execution` leaf, contains the complete non-duplicate
leaf-ref set, and is at most 16 MiB. Cardinality types are additionally constrained by that byte cap;
the first leaf that would make a plan exceed it refuses before allocation.
The construction plan is the sole size/domain exception: its 512-MiB-plus-one refusal reader hashes
`developer-os/update-construction/v1\0` plus its canonical JSON-plus-LF bytes and recomputes its
file/count/byte maxima before trusting any row. Its journal alone uses a 64-MiB-plus-one reader so
the complete bounded directory-identity prefix remains durable; every rewrite recomputes that
encoded maximum and the first identity/byte over either bound refuses before directory creation.

State/bundle/payload/source participant journals live only at
`staging/lifecycle/<coordinator-id>/update/journals/<kind>/<id>.json`, are canonical and at most 1 MiB,
and match their plan bijectively. `UpdateStateParticipantJournalV1` phase/cursor accepts only the
linear prefixes shown by its plan; compensation walks the exact reached reverse prefix. Its
`kind`/`id` pair equals the referenced state leaf's pair under `UpdateLeafPlanIdV1`: manifest state
uses the exact manifest-participant ID arm, while release-trust, active-release, and rollback-record
state use their exact safe reason code. The generic state-journal path uses that same pair and never
reparses a manifest ID as a safe code.
For manual rollback, the rollback-record state plan alone has guarded present `before`, absent
`after`, and no ordinary publication transition. Its explicit
`rollback_record/verify_retained` step first publishes the staged initial journal, reopens the exact
record and bound retained payload/inverse/inventory, then reaches `verified` with
`nextTransition == 0` without changing the record. Reverse traversal before the point of no return
marks it `rolled_back` with the record still present. After the point of no return, the consumed-set
terminal-retirement step requires both retained verify journals, removes and verifies the exact
record after the payload inventory, then sets the record journal to `finalized` with
`nextTransition == 4`. No other step may apply its absent postimage or terminalize either retained
participant.
`OwnerUpdateJournalV1` advances the forward-role Foundation projection before its ordered external
effects; `SchemaMigrationExecutionJournalV1` advances its forward-role projection then verifies the
complete mutation set. Their compensation and compaction cursors use the paired/ref bounds shown
above and every unused cursor is zero/null. Neither journal embeds mutation bytes.
`BundlePublicationJournalV1` first creates or verifies the target root, advances bundle entries in
manifest order, then advances metadata in the fixed delegation, release-index, bundle-manifest order.
For a created root/rollback-payload structure, the journal persists create intent, may bind only the
exact empty owner/mode/link directory at the current planned ordinal, then records dev/ino before
advancing. Each copied entry uses `entry_intent` → `entry_created` → `evidence_intent` →
`evidence_created` exactly as source staging: actual inode precedes byte zero, only the immutable
source/plan prefix is legal, and complete target plus complete canonical evidence is required before
the cursor advances. Evidence lives exactly at
`update/evidence/publication/<participant-kind>/<participant-id>/<ten-digit-ordinal>.json`, is
owner-only single-link `0600` and at most 1 KiB, and binds the shown
`DurablePublicationEntryEvidenceV1`. Current intent may bind only the exact empty crash frontier;
wrong/nonempty metadata or identity is exit 6. Metadata publication persists `publish_intent` before
the identity-preserving no-replace rename from its construction/source payload, records the moved
inode as `published`, syncs/reopens it, appends the exact contiguous metadata identity, and only then
advances. Verify-only present metadata records the already planned identity without gaining deletion
authority.
After the root transition, `targetRootIdentity` is the exact `target_bundle_root` identity; it equals
the plan's present preimage for `verify_previous`, or the reopened no-replace-created root for
`publish_target`, and is null only before that transition.
Each metadata plan has role `release_metadata`, a hash-derived exact path, `reversible`, and either
absent→present no-replace or present→the identical present bytes; replacement is illegal. `verified`
requires `nextRootTransition == 1`, the complete entry cursor, and `nextMetadata == 3`.
Compensation walks only reached created metadata in reverse, then created bundle entries in reverse,
with `compensationPart` ordering each entry after its evidence, then the identity-bound target root;
verify-only prior-bundle rows have no deletion authority and all
compensation cursors remain null. The phase and six cursors admit only those linear forward/reverse
prefixes; all unused cursors are zero/null. Terminal `compacting` removes only publication-evidence
files in reverse ordinal order; it never removes a retained target entry. Its exact nested maximum
is `entryCount`, at most `200_000`. After that terminal cursor, the unchanged outer participant-
compaction entry guarded-removes the participant journal and immutable plan as its two recognizable
fixed suffix actions, then advances once; a mutable journal never records its own deletion.

`RollbackPayloadPublicationJournalV1` has five fixed structure transitions in order: payload root,
`plans`, `plans/owner_inverse`, `plans/schema_migration_inverse`, and `blobs`. It then publishes the
complete inventory entries in ordinal order, followed by `inverse-plan.json` and `inventory.json` in
that order, using the same structure/entry-evidence/metadata microstates before each cursor advances. Its identity array is
the exact contiguous `rollback_payload_root`, `plans_root`, `owner_inverse_plans_root`,
`schema_migration_inverse_plans_root`, `blobs_root` prefix and is the sole directory-deletion
authority. `verified` for a
non-null publish requires cursors `5`, exact `entryCount`, and `2`; compensation walks metadata,
entry evidence/entries, then structure in exact reverse order. Terminal compaction likewise removes
only publication evidence in `entryCount`, at most `1_000_000`, never the retained payload; the
outer participant-compaction entry owns the same journal-then-plan fixed suffix. A manual rollback has null publish/source, performs
read-only retained-payload verification only at its explicit `rollback_payload/verify_retained`
step, reaches `verified` with all forward cursors zero, and has no compensation cursor. That step
first publishes the construction-bound initial journal to its final path; no earlier step may advance
it. Before the point of no return, reverse traversal marks this no-mutation journal `rolled_back`
without touching the retained payload. After the point of no return,
`terminal_retire/consumed_rollback_and_rejected_release` requires it `verified`, removes the exact
retained payload through its retirement inventory, verifies absence, and only then marks it
`finalized`; compaction requires that terminal phase. Missing fixed directories are not synthesized outside this participant. Both
publication journals require `nextEntry` not to exceed their enclosing exact count, reject the first
over-bound metadata/structure/entry cursor and every phase/cursor mismatch, and never reuse the
four-transition state journal.

The bundle-source structure prefix is exactly `source_envelope`, `source_payload_root`, then
`source_evidence_root`; the rollback-source prefix appends `plans_root`,
`owner_inverse_plans_root`, `schema_migration_inverse_plans_root`, then `blobs_root`. Each exclusive
directory first persists `structureWriteState.create_intent`; a crash-present path may bind only the
exact empty owner/mode/link directory under its identity-rechecked planned parent. The reopened inode
is then durably recorded as `created`, synced, and appended as one matching
`UpdateDirectoryIdentityV1` before `nextStructure` advances. The identity arrays are exact contiguous role/path prefixes; their path is
plan-derived, and any wrong role/path/mode/inode or present-unbound directory is a third state.
`BundleSourceStagingJournalV1.nextEntry` is bounded by its staging plan's entry count and begins only
after all three structures. The rollback source publishes its two metadata rows in exact
`inverse_plan`, `inventory` order after all seven structures, then its entries. Each metadata write
persists create intent, may bind only the exact empty file after a crash, records actual inode before
byte zero, and in the still-running originating process admits only the exact in-memory prepared
canonical byte prefix before appending the completed identity and advancing. After process death it
never reconstructs or resumes those metadata bytes: the pre-handoff closure records/binds the exact
empty crash frontier if necessary and immediately applies the identity/parent/metadata-only
compensation rule below. `metadataIdentities` is the exact contiguous matching prefix.
The bundle source derives each entry directly from its plan's complete ordered `entries`. The
rollback source instead resolves the one equal-ID/binding/hash `rollbackSource` object from the
reopened construction plan and requires its recomputed `entriesProjectionHash` to equal the compact
source-plan field before it interprets ordinal zero. Missing construction authority, an extra or
reordered entry, inventory disagreement, or a construction plan beyond its bound is exit 6.

For source entry ordinal `n`, `entryWriteState` durably walks `entry_intent` → `entry_created` →
`evidence_intent` → `evidence_created`. The current intent may bind only the exact empty planned
directory or zero-byte owner/mode/link file under the identity-checked parent. The created state
records target dev/ino before file byte zero; files admit only their bounded planned prefix, while
directories must remain empty until their descendants' later inventory ordinals. After complete
target sync/reopen, evidence intent retains that identity; the exact evidence file likewise binds an
empty crash frontier, records its own dev/ino before byte zero, and admits only the one canonical
`DurableSourceEntryEvidenceV1` prefix. Only complete target plus complete evidence advances
`nextEntry` and clears the state. Wrong metadata, nonempty unbound path, identity change, or a prefix
of any other row is exit 6. In the originating process, compensation consumes the same microstate
before earlier ordinals. After process death, pre-handoff closure is compensation-only and may
guarded-remove the journal-recorded current entry/evidence/metadata/ready inode regardless of partial
bytes, but only after rechecking its planned parent, exact kind/owner/mode/link count, size cap, and
stable recorded dev/ino. It never adopts or resumes that partial source; an unrecorded nonempty path
or identity swap is exit 6.

After every entry/metadata cursor completes, `readyWriteState` persists create intent for the exact
ready-evidence path, may bind its exact empty crash frontier, records the inode before bytes, and
admits only the derived canonical ready-evidence prefix. Complete sync/reopen stores
`readyIdentity`, clears the write state, and only then enters `source_ready`. Cleanup reopens the
same inode/content before unlink. `source_ready` requires every forward cursor complete and
recomputes `structureIdentitiesHash` as SHA-256 over
`developer-os/update-source-structures/v1\0` plus the canonical complete journal identity array; its
root dev/inode fields also equal the `source_payload_root` identity. Compensation requires ready evidence absent, removes
each reached payload entry then its evidence with `compensationPart` durably distinguishing those two
deletions, walks metadata and structures in reverse, then removes the journal and immutable plan
last through the enclosing construction cursor. Source compaction's unique flattened order is ready
evidence; reverse entries with target then evidence; rollback-only metadata in reverse; then
identity-recorded structures in reverse. Its nested maxima are therefore
`1 + 2 * 200_000 + 3 = 400_004` and
`1 + 2 * 1_000_000 + 2 + 7 = 2_000_010` respectively. The enclosing construction file transition,
not the source journal, guarded-removes the terminal source journal and immutable plan using their
construction evidence. It and
`RollbackPayloadSourceStagingJournalV1` are the only mutable subordinate journal kinds legal before
an outer coordinator plan, and only beneath the one valid construction journal in the planless
source-envelope states specified below. Every target participant's pre-outer staged initial journal
is instead exactly
`staging/lifecycle/<coordinator-id>/update/initial-journals/<kind>/<id>.json`; its final path is the
generic journal path above and both appear in the one `UpdateInitialJournalRefV1`. Its expected bytes
come from the construction plan and its actual inode only from matching construction evidence. The
rollback-source `nextEntry` covers the exact payload inventory at the larger bound. V2 closure adds
the exact `update-construction.plan.json`, `update-construction.journal.json`, phase-legal pending/
rewrite sibling, plus `update/construction`, `update/plans`, `update/initial-journals`,
`update/journals`, `update/evidence`, and `update/source` subtrees to the coordinator staging grammar;
no other child is legal.

An owner external-effect plan is the `owner_external_effect` leaf at the generic plan path. Its
journal uses the matching generic journal path, and each reached observation is the sole canonical
file `update/evidence/owner_external_effect/<id>/<direction>.json`, at most 1 MiB. Evidence hashes
`developer-os/owner-external-effect-evidence/v1\0` plus canonical bytes after stdout/stderr have been
redacted; raw vendor bytes are never hashed or persisted. Intent journal sync precedes the pinned
process call, evidence sync precedes cursor advance, and an ambiguous command-without-observation
re-observes guarded registration state before choosing resume/compensation. The plan's
`fileParticipantIds` equal its owner's forward-role Foundation IDs; process policy and payload refs
are exact and pre-intent. In the current closed Codex-refresh protocol both payload arrays are the
exact empty tuple, no argv payload arm is legal, and rollback inventory contains no
`external_effect_preimage`; a future byte-carrying effect requires a new protocol/schema.
`ManifestExternalEffectRefV1.kind == "codex_registration"` maps only to
`OwnerExternalEffectPlanV1.kind == "codex_registration_refresh"` with equal ID/plan hash. No Git or
launchd effect is legal in an update owner plan.
`expectedStateHash`, `proposedStateHash`, and `observedStateHash` cover only the closed tokenized
registration projection (plugin ID, enabled flag, protocol, safe version, and
`source: "managed_plugin_root" | "other" | "absent"`), after local secret screening. `source` is
derived by exact guarded equality between the observed registration source and the admitted managed
plugin root; it never contains or hashes the raw path. Expected, forward-postimage, and compensation-
postimage observations must match exactly at their respective cursors, and `other` always refuses
before process or filesystem mutation. Vendor paths, config values, output text, and credentials are
neither members nor hashed. Each state hash is SHA-256 over
`developer-os/codex-registration-projection/v1\0` plus the no-LF canonical projection bytes; the
expected/proposed/observed role is supplied by the plan/cursor and is not a caller field.
`processPolicyHash` is SHA-256 over
`developer-os/owner-external-effect-process-policy/v1\0` plus the no-LF canonical bytes of the
complete `OwnerExternalEffectProcessPolicyV1` object in shown key order. The concrete plan and any
retained inverse persist that object as well as the digest and must be byte-equal; evidence repeats
the digest only after executing that exact object. At execution, `pinned_codex_cli` is resolved by
the installed provider's closed registry, reopened as the preflighted owner-owned single-link
regular executable, and required to retain the device/inode/mode/content identity held by the
current process. Arg tokens resolve only to the plan-bound managed plugin root, fixed plugin ID, or
private effect temp; literals are the registry's exact subcommand/flag sequence.
The child receives exactly the two shown environment entries, closed stdin, no other descriptor,
one process, and the exact byte/idle/wall bounds. Unknown/reordered args or environment, executable
change, a second process, network/model authority, or a hash/object mismatch refuses. Vendor paths
remain tokenized; no credential or raw vendor value enters the projection.

The execution leaf persists both recovery records, not just their hashes. `initial` must be
`executing` with `executor.kind == "release_bundle"` and release byte-equal to `current`; `terminal`
must be `terminal_cleanup` with `executor.kind == "package_fallback"`. Both have the same
coordinator ID, operation, execution-binding hash, and timestamp. The initial release's launcher and
update protocols equal the terminal fallback protocols; the terminal fallback manifest and protocols
equal the launcher's handoff. The outer two hashes must equal their canonical bytes. Every other
differing/equal-state combination refuses. `finalPath` is exactly `state/update-executor.json`.
The staged paths are exactly
`staging/lifecycle/<coordinator-id>/update/recovery-executor/initial.json` and `terminal.json`; each
descriptor's construction ordinal/path/hash/length/mode equals its matching canonical record and
construction row/evidence, and both share the shown 16-KiB cap. Neither expected descriptor pretends
the staged inode existed when the execution plan was derived.
`executionBindingHash` is independently computable without hashing a containing plan: SHA-256 over
`developer-os/update-execution-binding/v1\0` plus canonical coordinator ID, operation, preview hash,
current release-identity hash, and target release-identity hash. The execution leaf, outer plan, and
both records require the same value, eliminating any self-referential plan hash.

The remaining recovery digests use UTF-8 `CanonicalJsonV1` projection bytes with no trailing LF,
preceded by the exact ASCII domain including its terminating NUL:

- `OwnerUpdatePlanV1.currentPartitionHash` uses
  `developer-os/owner-current-partition/v1\0` plus the complete non-empty array of current
  `ManagedArtifactV2` rows for that owner from the guarded manifest preimage, in manifest order. The
  owner field is included in every row; omission, addition, or reordering refuses.
- `OwnerUpdatePlanV1.inverseOperationHash` uses
  `developer-os/owner-inverse-operations/v1\0` plus `{ owner, operations, externalEffects }` from
  the matching `RetainedOwnerInversePlanV1`. It excludes `rollbackBindingHash`,
  `sourceOwnerPlanHash`, byte-limit fields, and every containing/ref hash, preventing a hash cycle.
  The retained plan recomputes equal to the source owner plan's field before publication or rollback.
- `BoundedUpdateInversePlanV1.exactStepListHash` uses
  `developer-os/update-rollback-step-list/v1\0` plus the complete exact
  `UpdateLifecycleCoordinatorStepV1[]` template specified in §10.2. At manual rollback it equals the
  canonical outer `steps` array byte-for-byte; the projection excludes coordinator IDs and this hash.
- `TargetVerificationPlanV1.ownerPostimagesHash` uses
  `developer-os/update-owner-postimages/v1\0` plus owner-plan rows in canonical owner order. Each row
  contains the immutable owner-plan ref, every operation in plan order projected as
  `{ targetPath, after: ManagedArtifactV2 | { state: "absent" } }`, and each effect ref with its
  `proposedStateHash`; the rows equal the complete owner/effect leaf set bijectively.
- `TargetVerificationPlanV1.migrationPostimagesHash` uses
  `developer-os/update-migration-postimages/v1\0` plus migration rows in execution order, each
  `{ ref, id, domain, fromVersion, toVersion, mutations: [{ path, afterHash }] }`. It equals the
  complete migration leaf set; the empty migration set hashes the canonical empty array.

All five projections are recomputed from reopened plan/manifest bytes rather than trusted as labels.
Tests mutate, omit, duplicate, and reorder every row and include a vector proving that adding a
containing digest cannot affect its own projection.

`CanonicalStateFilePlanV1` permits a null payload only for the still-present guarded preimage; a
present postimage requires an exact pre-intent `StatePayloadRefV1`. Trust plans alone are
`monotonic_no_reverse`; every other state plan is reversible. `TargetVerificationPlanV1` admits only
the signed bundle verifier, exact expected postimage hashes, fixed read-only process table, and the
shown caps. `UpdateTerminalRetirementPlanV1` flattens each referenced inventory in kind/root/unsigned
UTF-8 path order and counts every removable leaf once. A maximum payload contributes 1,000,000
inventory entries plus its root, `plans`, two plan-kind directories, `blobs`, `inverse-plan.json`,
and `inventory.json` = 1,000,007 leaves; a maximum bundle contributes 200,000 entries plus its root;
the three metadata files and rollback record contribute four more, for the checked aggregate maximum
1,200,012. Shared retained metadata directories are not leaves. `maximumLeaves` is recomputed and
drives `retirementNext`; exact maximum succeeds and the first extra leaf refuses before intent. These rules close the
plan/state/cursor tables rather than delegating recovery semantics to implementations.

A `CanonicalStatePayloadPathV1` is exactly
`staging/lifecycle/<coordinator-id>/update/payloads/state/<role>/<id>.json`, where role/ID equal the
one containing state plan. Its plan-derived parent is coordinator-owned; path, content hash, byte
length, mode, and sole consumer agree with its construction row, while device/inode agree with that
row's construction evidence after reopen. Unknown/duplicate
payloads, cross-role refs, and a ref outside that exact tree refuse before outer intent; planless
orphan cleanup and terminal compaction enumerate the same exact payload set and remove each only
after its participant no longer needs it.

`PersistedOwnerChangeOperationV1` is the only conversion target for planner owner drafts; persisted
plans never store the current broad `ChangePlanOperationV1`. Owner/target/after-artifact paths agree
and pass the exact V2 owner policy. `create` requires absent before and a non-null after artifact;
`replace` requires present before plus a non-null after; `remove` requires present before and null
after/content; `keep` requires byte-identical present before/after and null content. A changed regular
file requires a pre-intent `UpdatePayloadRefV1` under the exact coordinator transaction-payload root;
directories and symlinks are legal only as byte-identical `keep` rows in v1; their create, replace,
or remove operations refuse before allocation. Every regular-file `create` target requires its
complete parent chain to be already present, exact retained manifest-owned directory artifacts for
that owner, each byte-identical `keep`; update never creates a directory implicitly. Ephemeral artifacts likewise may
only remain unchanged through their owner-specific state participant. Every source/merge/restore
field comes from strict `ManagedArtifactV2`, so `config-entry`, unbounded source strings, and raw
unbranded target paths are unrepresentable. Reopened construction evidence plus payload hash/size/mode must agree before
outer intent and every recovery use.

Any owner file changed or removed by an update must be at most 16 MiB before allocation, even though
signed release-bundle files may be larger. This keeps each forward and retained inverse byte payload
inside the unchanged `FoundationMutationRefV1.contentSize` bound. Larger managed files may be kept
byte-identically but are update-incompatible for create/replace/remove until a separately approved
chunked Foundation mutation protocol exists.

Every `RetainedInversePlanRefV1.path` is exactly
`plans/<kind>/<id>.plan.json` under its guarded rollback payload root. `sourcePlanHash` binds the
original forward coordinator leaf; `retainedHash` instead hashes the canonical dedicated inverse
schema under `developer-os/retained-inverse/<kind>/v1\0`. Each inverse plan and referenced blob has
one matching `inverse_plan_leaf` or preimage payload entry. A retained owner plan contains no
coordinator ID, Foundation participant/effect ref, staging path, or live journal identity. A retained
migration plan contains no planner-stream ordinal/ref; every restore byte is an exact
`RetainedInverseBlobRefV1` under the payload. Expected-current states equal the verified update
postimages, restore states/blobs equal the preimages, and every external-effect policy/state hash is
recomputed before original update publication and again before rollback.
An expected-current file always has `payload == null`; a restore file always has a non-null
`RetainedInverseContentRefV1`. Its chunks use contiguous payload ordinals, each is at most 16 MiB,
their checked sum equals both aggregate/file bytes, and streaming concatenation equals both content
hashes. A zero-byte restore uses zero chunks and SHA-256 of empty bytes. Directory/absent states have
no payload, and symlink mutations are incompatible as stated above.
`BoundedUpdateInversePlanV1` admits no coordinator-staging path or ordinary
`ImmutableUpdatePlanRefV1`, so terminal coordinator compaction cannot strand a future manual
rollback. Its installed/previous hashes equal the enclosing rollback record's release identities.
The inverse-plan payload ID, record payload ID, inventory payload ID, every retained ref, and every
manifest artifact must agree.

`rollbackBindingHash` is SHA-256 over
`developer-os/update-rollback-binding/v1\0` plus canonical `executionBindingHash`, payload ID,
installed release-identity hash, and previous release-identity hash. The inverse plan, payload
identity, payload inventory, and rollback record require that same independently computable value.
The inverse plan never contains the inventory hash, rollback-record hash, current manifest hash, or
outer coordinator plan hash; the record contains hashes of the already finalized inverse plan and
inventory. Thus inverse plan → inventory → record → manifest → coordinator publication is acyclic.
Manual rollback creates fresh manifest/active/rollback/payload state plans from guarded current bytes
and the bound release identities; those state plans are not retained inside the record.

`update_apply` requires `BundlePublicationPlanV1.action == "publish_target"`,
`source.kind == "staged_source"`, exact staging-plan/ready-evidence/root identity and inventory
equality, and an absent target root; its three metadata plans publish or reuse exactly the selected
delegation, index, and bundle manifest. `update_rollback` requires
`action == "verify_previous"`, `source.kind == "retained_bundle"`, a present guarded root whose
identity and inventory hash equal both that source and the retained rollback evidence, and three
byte-identical present-to-present metadata plans. That action verifies every entry and publishes no
bundle or metadata byte. The bundle participant journal cursor covers publication-plus-verification
for the first action and verification only for the second; compensation is empty for
`verify_previous`.

This is the update leaf inside the additive `UpdateLifecycleCoordinatorPlanV2` below. It uses Spec
1's global lock, allocator, roots, Foundation participants, and guarded plan/journal store, but it is
not legal inside closed `LifecycleCoordinatorPlanV1`. The concrete codecs live downstream in CLI
composition; Core receives generic leaf codecs and imports no adapter/platform type.
Bundle/trust/active/rollback/payload state plans use the same present/absent, no-replace, tombstone,
inode-bound participant pattern as manifest state.
`update_apply` requires a non-null planner identity byte-equal to the under-lock
`PreparedUpdateCandidateV1.transcriptIdentity`, whose preview is byte-equal to the same candidate's
public preview; `update_rollback` requires null and consumes only retained local evidence.
`update_apply` likewise requires the one non-null
trust-state ref and matching `trust/publish_monotonic` step; `update_rollback` requires `trust == null`
and has no trust leaf, journal, or step because its guarded trust bytes remain unchanged.

For `update_apply`, both pre-coordinator payload sources are themselves durably planned. After final
revalidation/capacity, under the global lock, and after coordinator-ID allocation, the current
executor's construction envelope first publishes a `BundleSourceStagingPlanV1` and its exact initial
`BundleSourceStagingJournalV1` before source mutation. The source root is derived exactly as
`staging/lifecycle/<coordinator-id>/update/source/bundle/<id>/payload`; the ready evidence is its
sibling `<id>.ready.json`; both source ready-evidence schemas are canonical and at most 16 KiB;
`evidenceRoot` is the sibling
`<id>/evidence`. Through `nextStructure` it creates the exact absent `<id>` envelope, payload root,
and evidence root no-replace and records their reopened identities. The executor then copies only the already
verified scratch extraction into that product-owned root no-replace in plan inventory order, syncing
each entry/root, publishing the matching `DurableSourceEntryEvidenceV1` at
`evidence/<ten-digit-ordinal>.json`, then advancing `nextEntry`. At `source_ready`, it reopens the
complete non-empty tree and exact contiguous evidence set,
publishes `BundleSourceReadyEvidenceV1`, and makes it resolvable through
`BundlePublicationPlanV1`'s staging-plan ref and exact ready path. The immutable bundle plan contains
no pre-write inode or ready-evidence hash; execution requires the terminal source journal and
reopened evidence to validate against the immutable staging plan. Scratch may then disappear. The staging plan, largest journal, full source
copy, ready evidence, later target copy, and terminal cleanup are included in aggregate feasibility.

The rollback-payload source follows the same envelope before any outer intent. Its root is exactly
`staging/lifecycle/<coordinator-id>/update/source/rollback/<payload-id>/payload`; the sibling ready
evidence is `<payload-id>.ready.json`. The executor publishes
`RollbackPayloadSourceStagingPlanV1` and its initial journal through construction after the result-
JSON frame and every candidate projection match but before it accepts any output blob. The concrete
plan's allocated binding, inverse-plan hash, inventory hash, entries, and aggregate are derived from
the private candidate and already-published immutable leaf bytes; rederivation must match before
publication. Its seven-transition structural prefix creates the
source envelope, payload/evidence roots, and fixed `plans`, two plan-kind, and `blobs` directories,
recording each reopened identity. It then publishes the bound inverse-plan and
inventory bytes at the two exact metadata paths and records their inode identities, then streams
every retained inverse plan/preimage to the inventory-derived source path. Each synced entry gets the
same ordinal evidence before cursor advance. `source_ready` requires exact-set, identity,
inverse-plan, inventory, entry-count, aggregate-byte, and per-entry hash equality. The resulting
evidence is resolved through `RollbackPayloadStatePlanV1.source`'s immutable staging-plan ref and
exact ready path; the state plan contains no pre-write inode/evidence hash. `publish` is non-null
exactly when that source is non-null and the reopened ready evidence proves all payload/binding/
inventory fields agree. Manual rollback publishes no new
payload and requires both fields null.

A death before `source_ready` has no outer coordinator and cannot redownload or adopt scratch:
common lifecycle recovery under the global lock follows the source plan only in the compensating
direction and guarded-removes its exact reached reverse prefix. This rule applies independently to
both source envelopes and, with no outer plan, cleanup removes every admitted source in reverse
publication order before a later invocation may start anew. A death after both are `source_ready`
but before the outer plan still has no managed target mutation and guarded-cleans both plan-last; it
never reruns network/planner as recovery. Any missing/extra entry, identity/hash mismatch, journal
without plan, or target mutation is exit 6. For `update_rollback`, no source staging envelope exists;
`BundlePublicationSourceV1.retained_bundle` binds the already manifest-owned previous root identity
and complete retained inventory.

For either source kind, evidence files are canonical, owner-owned single-link `0600`, at most 1 KiB,
and their `pathHash` binds the exact plan/inventory-derived destination-relative path. A file evidence
has matching non-null content hash; a directory has zero bytes and null hash. A source cursor is valid
only for the exact contiguous evidence prefix and reopened device/inode/postimage equality.
`evidenceSetHash` is SHA-256 over `developer-os/update-source-evidence-set/v1\0` followed by the
canonical ordered array of SHA-256 hashes of those exact canonical evidence-file bytes in ordinal
order. `source_ready` requires the cursor at the enclosing entry count and recomputes that hash over
the complete, non-empty evidence set. A death
after an entry sync but before evidence may bind only that current cursor entry when its full planned
postimage matches; every other unbound/mismatched entry is a third state. Compensation removes only
identity-matching evidenced entries and their evidence in the journaled reverse suborder; metadata
and structure identities, ready evidence, journal, and plan follow in their fixed reverse order.
Capacity counts payload entries,
evidence files and temps separately.

The construction plan fixes all leaf/source plans, payloads, initial journals, and both recovery
records before any of them is written. Its journal/evidence protocol publishes and proves those
files, while the nested source journals independently reach ready. `UpdateExecutionPlanV1` therefore
contains expected initial-journal refs, not invented pre-write inodes; the complete ordered,
non-duplicate set resolves bijectively to construction evidence. Only after all evidence is complete
does construction publish the outer coordinator plan and initial journal and durably hand off. At a
reached step, the executor no-replace-renames the evidence-bound staged initial journal to its final
path, syncs/reopens the same inode, persists intent, and only then mutates a target. A crash before
handoff may contain only construction-bound plans, journals, payloads, recovery records, and source
trees, but no final participant journal or target mutation; construction recovery removes only
journal-recorded attempt identities under the compensation-only rule. Missing/extra/duplicate refs,
wrong paths/hashes/inodes, a final
journal without outer intent, or a target postimage is exit 6. Every effect persists
direction/cursor before mutation and observation/evidence after mutation before cursor advance. When
an outer plan exists, its closure owns the source staging
plan/journal/evidence/tree; compensation or terminal compaction removes them only after target
bundle/rollback-payload compensation or verification respectively, with each source plan last.

Spec 2 adds a strict schema-version-2 envelope; it does not widen any Spec 1 V1 union:

```ts
interface UpdateLifecycleCoordinatorPlanV2 {
  readonly schemaVersion: 2;
  readonly id: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly previewHash: LowerHexSha256;
  readonly executionBindingHash: LowerHexSha256;
  readonly maximumPlanBytes: Integer[1..16_777_216];
  readonly maximumJournalBytes: Integer[1..1_048_576];
  readonly recoveryExecutorInitialHash: LowerHexSha256;
  readonly recoveryExecutorTerminalHash: LowerHexSha256;
  readonly construction: ImmutableUpdateConstructionRefV1;
  readonly update: ImmutableUpdatePlanRefV1<"update_execution">;
  readonly steps: readonly UpdateLifecycleCoordinatorStepV1[1..10_031];
  readonly compaction: UpdateLifecycleTerminalCompactionV1;
}

type UpdateLifecycleCoordinatorStepV1 =
  | { readonly kind: "bundle"; readonly action: "publish_target" | "verify_previous" }
  | { readonly kind: "owner_files"; readonly owner: ArtifactOwner;
      readonly direction: "forward" | "inverse" }
  | { readonly kind: "owner_external_effect"; readonly owner: ArtifactOwner;
      readonly direction: "forward" | "inverse" }
  | { readonly kind: "schema_migration"; readonly id: SchemaMigrationIdV1;
      readonly direction: "forward" | "inverse" }
  | { readonly kind: "manifest"; readonly transition:
      "preserve_before" | "publish_transitional" | "publish_terminal" |
      "finalize_tombstones" }
  | { readonly kind: "trust"; readonly transition: "publish_monotonic" }
  | { readonly kind: "rollback_payload"; readonly transition:
      "publish_proposed" | "verify_retained" }
  | { readonly kind: "rollback_record"; readonly transition:
      "publish_proposed" | "verify_retained" }
  | { readonly kind: "active"; readonly transition: "publish_target" | "publish_previous" }
  | { readonly kind: "target_verifier"; readonly release: "target" | "previous" }
  | { readonly kind: "terminal_retire"; readonly set:
      "prior_rollback" | "consumed_rollback_and_rejected_release" }
  | { readonly kind: "recovery_executor"; readonly transition: "switch_to_fallback" };

interface UpdateLifecycleCoordinatorJournalV2 {
  readonly schemaVersion: 2;
  readonly id: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly phase:
    | "planned"
    | "participants_applying"
    | "active_publishing"
    | "verifying"
    | "compensating"
    | "terminal_finalizing"
    | "finalized"
    | "rolled_back"
    | "compacting";
  readonly direction: "forward" | "compensating";
  readonly planHash: LowerHexSha256;
  readonly nextStep: Integer[0..10_031];
  readonly compensationNext: Integer[-1..10_030] | null;
  readonly pointOfNoReturnReached: boolean;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly retirementNext: Integer[0..1_200_012] | null;
  readonly compactionNext: Integer[0..20_100] | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

interface UpdateLifecycleTerminalCompactionV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly terminalOutcome: "finalized" | "rolled_back";
  readonly retainPayloadId: RollbackPayloadIdV1 | null;
  readonly entries: readonly UpdateCompactionEntryV1[3..20_100];
}

type UpdateCompactionEntryV1 =
  | { readonly kind: "owner_update"; readonly owner: ArtifactOwner }
  | { readonly kind: "schema_migration"; readonly id: SchemaMigrationIdV1 }
  | { readonly kind: "owner_external_effect"; readonly id: OwnerExternalEffectIdV1 }
  | UpdateStateCompactionEntryV1
  | { readonly kind: "coordinator_staging" }
  | { readonly kind: "coordinator_envelope" };

type UpdateStateCompactionEntryV1 =
  | { readonly kind: "state_participant"; readonly participant: "bundle";
      readonly plan: ImmutableUpdatePlanRefV1<"bundle_publication"> }
  | { readonly kind: "state_participant"; readonly participant: "manifest";
      readonly plan: ImmutableUpdatePlanRefV1<"manifest_state"> }
  | { readonly kind: "state_participant"; readonly participant: "trust";
      readonly plan: ImmutableUpdatePlanRefV1<"release_trust_state"> }
  | { readonly kind: "state_participant"; readonly participant: "rollback_payload";
      readonly plan: ImmutableUpdatePlanRefV1<"rollback_payload_state"> }
  | { readonly kind: "state_participant"; readonly participant: "rollback_record";
      readonly plan: ImmutableUpdatePlanRefV1<"rollback_record_state"> }
  | { readonly kind: "state_participant"; readonly participant: "active";
      readonly plan: ImmutableUpdatePlanRefV1<"active_release_state"> };

type LifecycleExecutionPlanV2 =
  | LifecycleCoordinatorPlanV1
  | UpdateLifecycleCoordinatorPlanV2;

type LifecycleJournalClosureV2 =
  | LifecycleJournalClosureV1
  | { readonly state: "update_recovery"; readonly coordinatorId: LifecycleCoordinatorIdV1;
      readonly operation: "update_apply" | "update_rollback";
      readonly direction: "forward" | "compensating" }
  | { readonly state: "update_construction_cleanup";
      readonly coordinatorId: LifecycleCoordinatorIdV1;
      readonly direction: "compensating";
      readonly construction:
        | { readonly frontier: "plan_pending" }
        | { readonly frontier: "journal_bootstrap"; readonly journal: "absent" | "pending";
            readonly operation: "update_apply" | "update_rollback";
            readonly constructionPlanHash: LowerHexSha256 }
        | { readonly frontier: "journal" | "plan_only_suffix";
            readonly operation: "update_apply" | "update_rollback";
            readonly constructionPlanHash: LowerHexSha256 } }
  | { readonly state: "update_executor_cleanup";
      readonly coordinatorId: LifecycleCoordinatorIdV1 };
```

Schema V2 uses the same exact `state/lifecycle-journals/<id>.plan.json`, `<id>.json`, and stable-lock
paths as V1. Both V1 and V2 coordinator plans retain the same 16-MiB pre-parse cap: the reader opens
no-follow, checks size, reads at most 16 MiB plus one refusal byte, requires canonical JSON, and only
then dispatches on exact `schemaVersion`. Fields are never mixed and no untrusted prefix selects a
larger allocation. `maximumPlanBytes` and `maximumJournalBytes` are recomputed from the closed operation/step
grammar. Phase and cursor are derived from the current step: only active publication admits
`active_publishing`, only the verifier admits `verifying`, and terminal retirement/terminal manifest
admit `terminal_finalizing`. `compensating` requires the greatest reached reversible step and walks
the plan-derived reverse list; a trust step is observed but omitted from that list. Terminal phases
require every participant in the exact terminal state selected by the outcome.
`retirementNext` is non-null only at `terminal_retire`, is bounded by and never exceeds the referenced
`UpdateTerminalRetirementPlanV1.maximumLeaves`, and advances once per flattened inventory leaf.
`compactionNext` is non-null only in `compacting`, is bounded by and never exceeds
`compaction.entries.length`, and advances once per top-level compaction entry. All unused cursor
positions must be null; no numeric state lacks a derived operation.

`LifecycleJournalClosureV2` enumerates the same four roots and companion inventories with the same
aggregate caps. A fully valid non-terminal V2 coordinator yields the single `update_recovery` arm;
all Spec 1 operations and all new plan creation refuse that non-clear state. Only the exact recorded
update operation, under the global lock and without a new network/planner attempt, may resume it.
With no outer plan, one valid construction plan/journal plus its exact reached evidence/source prefix
yields only `update_construction_cleanup`; it always compensates and never resumes the planner or
target work. A lone admitted `construction.plan.pending` yields that same cleanup arm under the
strict root-temp grammar above. Its `construction` tag is `plan_pending` only for that sole partial
temp and intentionally carries no operation/hash parsed from untrusted prefix bytes;
`journal_bootstrap` requires a complete hashed construction plan plus either no initial-journal temp
yet or its sole admitted prefix; `journal` requires the matching final construction journal and exact reached nested
prefix; and `plan_only_suffix` is only the compensation/compaction crash after guarded removal of the
terminal construction journal and before removal of that same hashed plan. Those are the only
frontiers. Codec output recomputes coordinator ID from the exact root segment and, except for
`plan_pending`, operation and construction-plan hash from the reopened canonical plan; a caller-
supplied tag, absent-plan hash, mixed operation, or any extra child refuses as recovery-required.
An otherwise clear ledger plus one `terminal_cleanup` executor record and no coordinator envelope
yields `update_executor_cleanup`; the recorded executor may only guarded-unlink that exact record
under the global lock and recompute closure.
Two update coordinators, a mixed V1/V2 non-terminal set, an unknown schema, a missing plan/journal,
or any participant/cursor mismatch is ordinary `lifecycle_recovery_required`, not a selectable
direction. Terminal V2 coordinators compact before closure may return `clear`.

The construction plan lists both recovery records in executing-then-terminal order before either
path exists. Its journal records create intent and the actual inode identity before byte zero, and
its evidence binds the complete canonical record. A crash-partial record is resumable/removable only
when that recorded identity and exact planned byte prefix still match; an unbound present path or
identity/content change is exit 6. Both records are owner-only, single-link `0600`, at most 16 KiB,
on the product-state device, and no sibling temporary name is legal. The outer plan/journal cannot
publish until both evidence rows reopen and match.

After the outer plan and journal are durable, recovery renames `initialStaged` no-replace to the exact
absent final path, syncs/reopens the same inode and `state`, and only then may the first coordinator
step run. Thus the admitted initial-publication states are: final absent plus complete initial stage
at `nextStep == 0`, or exact final `executing` plus absent initial stage. The complete terminal stage
remains bound and present. This rule is identical for update apply and manual rollback.
For `executing`, the stable launcher requires its
coordinator plan/journal to agree and validates the recorded release bundle's retained signed
metadata and complete inventory. For `terminal_cleanup`, it requires either that same
terminal/compacting envelope or the exact `update_executor_cleanup` no-envelope suffix and validates
the package-owned fallback manifest. It then invokes the selected absolute runtime/entrypoint instead
of the active candidate. This is routing only: the launcher does not interpret update steps.
A malformed/orphan executor record is exit 6. Immediately after verifier success durably crosses
the point of no return—or after compensation has durably restored and verified the old release for
a `rolled_back` terminal outcome—the current executor atomically renames `terminalStaged` over the
exact `executing` final inode, syncs `state`, and reopens the plan-bound `terminal_cleanup` bytes
naming the package-manager fallback. The only admitted crash alternatives are exact initial final
plus complete terminal stage, or exact terminal final plus absent terminal stage; both are resolved
from the coordinator phase/outcome, never wall-clock inference. The launcher validates that fallback
against its package-owned manifest and identical launcher/update protocol before routing; no target
bundle gains cleanup authority. Only then may retirement remove a bundle that was the initial
executor. After all other compaction, the fallback removes the coordinator envelope in plan-last
order, then guarded-unlinks only the executor record and syncs `state`. A crash before the rewrite
still has an intact initial executor and staged terminal inode; a crash after it routes to fallback
and eventually admits only the `update_executor_cleanup` suffix. Death injection covers every
construction create-intent/identity and every staged prefix boundary, both directory-sync boundaries,
initial rename, terminal replacement,
rolled-back terminalization, envelope removal, and final unlink.

V2 terminal compaction derives entries in this order: owner-update leaves by owner, schema-migration
leaves in chain order, owner external effects by allocated ID, then exact ref-bearing state
participants in execution order: bundle, rollback payload, transitional manifest, trust for apply
only, rollback record, active, and terminal manifest; coordinator staging and the coordinator
envelope are last. There is exactly one rollback-payload entry for either operation, even when
manual rollback publishes no new payload, so its terminal journal and immutable plan always have an
owner. Each state entry's ref is byte-equal to the corresponding `UpdateExecutionPlanV1` ref; the two
manifest entries are distinct, and duplicate/missing/extra/wrong-kind refs refuse. An owner/schema entry advances only after its own journal has
compacted every paired V2 Foundation ref in ID order and then itself; the outer array therefore does
not flatten millions of mutations. The
retained payload ID and its entire manifest partition are an explicit
negative deletion constraint. Retired bundle/metadata/payload leaves are removed only by the earlier
`terminal_retire` step against the transitional manifest; compaction can remove only ordinary
transaction/effect/tombstone evidence. For apply, `coordinator_staging` guarded-cleans the ready
rollback-payload source envelope before the ready bundle-source envelope (reverse publication
order), and within either envelope removes identity-bound payload entries/evidence in reverse,
ready evidence, metadata/evidence directories, source root, journal, then immutable source plan last.
Rollback has no source envelope. Each entry advances `compactionNext` after guarded absence,
and envelope cleanup uses Spec 1's journal → held stable lock → immutable plan-last order. Unknown
children, a retained-payload target, or an identity mismatch preserves evidence as exit 6.

There is deliberately no flattened `maximumCompactionLeaves` field: `compactionNext` counts only
the top-level `entries`, while every nested participant/source journal owns and checks its exact
leaf cursor and maximum. Aggregate capacity recomputes a checked `UInt64DecimalV1` sum over every
referenced nested maximum plus coordinator staging/envelope leaves; for apply this includes both
source-envelope maxima (`400_004 + 2_000_010`) before any participant, payload, or coordinator leaf.
Overflow or a first leaf beyond any nested maximum refuses before outer intent.

### 9.3 Forward order

The exact forward order is:

1. preserve any existing rollback record/bundle unchanged;
2. publish and verify the target product-owned bundle plus its three retained metadata documents
   no-replace;
3. apply managed owner file participants;
4. apply owner external effects;
5. apply ordered product-state then Brain schema migrations;
6. publish and verify the proposed rollback payload no-replace;
7. preserve the manifest preimage and publish the transitional V2 manifest containing the target,
   the proposed rollback set, and any still-retained older rollback set;
8. publish monotonic release trust state;
9. publish a new rollback record naming the former active release and complete inverse plan;
10. publish `ActiveReleaseRecordV1` for the target;
11. invoke the target bundle's exact read-only verifier and durably cross the point of no return only
    on its success;
12. switch recovery routing to the package-manager fallback;
13. remove the previously retained older rollback bundle/metadata/payload through exact
    transitional-manifest authority;
14. publish the terminal V2 manifest that retains exactly the target active set plus former-active
    rollback set, then finalize manifest tombstones;
15. mark the update successful, compact ordinary participant evidence and the coordinator envelope,
    then remove the terminal recovery-executor record as §9.2.

The `steps` array is derived byte-for-byte from that list: one `bundle/publish_target`; one
`owner_files/forward` per installed owner in canonical owner order; then the matching non-empty
`owner_external_effect/forward` rows; every `schema_migration/forward` in product-state-then-Brain
chain order; `rollback_payload/publish_proposed`; `manifest/preserve_before`;
`manifest/publish_transitional`; `trust/publish_monotonic`; `rollback_record/publish_proposed`;
`active/publish_target`; `target_verifier/target`; `recovery_executor/switch_to_fallback`;
`terminal_retire/prior_rollback`;
`manifest/publish_terminal`; and `manifest/finalize_tombstones`. There is no caller-selected,
omitted, duplicate, empty stand-in, or reordered step. Recovery-executor terminalization is that
explicit post-verifier ordinary step. Only coordinator-envelope removal followed by guarded final
executor unlink is the fixed compaction suffix.

Managed owner order is canonical owner order, then path order. Migrations are product-state before
Brain so target code never activates over an incompatible product schema; each domain follows its
declared chain. Active-release publication is the externally visible activation point and occurs only
after every target postimage passes its participant-level verification; the cross-release target
verifier then decides the point of no return.

The update point of no return is the target verifier's fully successful observation plus the durable
journal rewrite `pointOfNoReturnReached: true` at that same `nextStep`. Before it, every reached
reversible step may compensate; at or after it, only terminal retirement, terminal manifest
publication, and compaction may force-forward. An active-record publication alone is not the point
of no return.

The target verifier receives the same bounded read-only snapshot boundary as the planner plus the
persisted expected release identity. It cannot write or reach network/vendor/model authority. It
checks target schemas, manifest/active/bundle equality, generated-artifact identity, and migration
postimages; it does not run ordinary `doctor`, whose adapter probes may mutate vendor homes.

### 9.4 Failure direction

Before active-release publication, a semantic failure compensates exact reached steps in reverse and
leaves the old active bundle. After active publication but before verifier success, recovery resumes
the exact verifier; a verifier failure executes the persisted inverse plan. Process death alone never
chooses rollback: the journal direction/cursor controls resume.

If inverse execution encounters a third state, recovery preserves all evidence as exit 6. It never
forces an overwrite to make rollback look complete. Trust state is the sole reached participant that
is not reversed; once a signed high watermark is durably accepted, retaining it narrows future
authority and is safe even when the release does not activate.

## 10. Rollback

### 10.1 Retained record

```ts
interface RollbackRecordV1 {
  readonly schemaVersion: 1;
  readonly installed: ReleaseIdentityV1;
  readonly previous: ReleaseIdentityV1;
  readonly executionBindingHash: LowerHexSha256;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly payloadInventoryHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly createdAt: UtcTimestampV1;
}

type RollbackPayloadIdV1 = AllocatedLifecycleIdV1<"rb">;

interface RollbackPayloadIdentityV1 {
  readonly payloadId: RollbackPayloadIdV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entryCount: Integer[0..1_000_000];
  readonly aggregateBytes: Integer[0..2_147_483_648];
}

interface RollbackPayloadInventoryV1 {
  readonly schemaVersion: 1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly entries: readonly RollbackPayloadEntryV1[0..1_000_000];
  readonly aggregateBytes: Integer[0..2_147_483_648];
}

interface RollbackPayloadEntryV1 {
  readonly ordinal: Integer[0..999_999];
  readonly path: RollbackPayloadRelativePathV1;
  readonly role: "owner_preimage" | "migration_preimage" | "external_effect_preimage" |
    "inverse_plan_leaf";
  readonly bytes: Integer[0..16_777_216];
  readonly sha256: LowerHexSha256;
}
```

The record is canonical JSON plus LF, at most 64 MiB, and stored at the exact ephemeral reservation.
It contains only the release/binding/payload identities and hashes of the retained inverse plan and
inventory. The payload root is exactly
`rollback/<payload-id>` and contains only owner-only directories plus `inverse-plan.json`,
`inventory.json`, `plans`, the exact retained plan paths above, `blobs`, and
`blobs/<ten-digit-zero-padded-ordinal>.bin`. The inverse plan and inventory are canonical files of at
most 64 MiB each; retained plans and blobs are owner-owned, single-link `0600` files. Inventory
ordinals are contiguous; a blob path is derived from its ordinal and an inverse-plan-leaf path from
its matching retained ref. Every hash/size reopens and matches, and aggregate
retained-plan-plus-blob bytes are at most 2 GiB. The root, its directories, both JSON files,
every retained plan, and every blob are exact V2 content artifacts. A rollback record without its
complete manifest partition, previous bundle/metadata, inverse plan, inventory, retained leaf plans,
or blob evidence is recovery-required, never “rollback unavailable.”

Publication is no-replace and fully synced before the transitional manifest/rollback record may
reference a new payload. An existing rollback record and payload remain byte-identical throughout a
new update until the target verifier has crossed the point of no return. Terminal rotation then
removes only the older record-derived bundle/metadata/payload partition while that partition still
matches the transitional manifest, publishes the final manifest without it, and retains the new
payload partition. Death at any rotation cursor force-forwards from the immutable plan. Unknown
payload children or an inventory/manifest disagreement preserve both generations as exit 6.

Exactly one previous release is retained in clear state. While a later update is applying, the
existing and proposed rollback sets may coexist under the one validated coordinator. Only after the
new target verifies may terminal compaction replace the existing set with the former active release
and remove the older set. Ordinary Spec 1 terminal compaction never removes a payload referenced by
either the current rollback record or a non-terminal update plan.

### 10.2 Preview and apply

`update rollback` performs no network request. It reads the record and revalidates:

- current active/trust/manifest/bundle state;
- the retained previous bundle and signed inventory;
- every current managed artifact and external owner state against the update postimage;
- every migrated Brain/product-state path against its recorded after hash;
- a clear lifecycle ledger and sufficient inverse capacity.

Any post-update edit or drift is exit 3 before allocation or mutation. Rollback does not merge or
offer force. Plan-only returns `UpdateRollbackPreviewV1`.

`update rollback --apply` publishes a schema-V2 lifecycle execution plan. Its exact `steps` array is
one `bundle/verify_previous`; `rollback_payload/verify_retained`;
`rollback_record/verify_retained`; every `schema_migration/inverse` in reverse chain order; every reached
`owner_external_effect/inverse` in reverse canonical owner order; every `owner_files/inverse` in
reverse canonical owner order; `manifest/preserve_before`; `manifest/publish_transitional` restoring
the previous managed state while still retaining rollback/rejected-release evidence;
`active/publish_previous`; `target_verifier/previous`;
`recovery_executor/switch_to_fallback`;
`terminal_retire/consumed_rollback_and_rejected_release`; `manifest/publish_terminal`; and
`manifest/finalize_tombstones`. There is no trust step. The previous verifier's durable success is
the rollback point of no return. Before it, compensation returns to the rejected current release;
after it, record/payload/rejected-bundle retirement and terminal manifest publication force-forward.
The operation never lowers `ReleaseTrustStateV1`.

The two retained verification steps are mandatory, adjacent, and ordered payload before record.
Each owns publication and read-only advancement of its one initial participant journal as defined in
§9.2; neither mutates retained state. The consumed-set retirement step is the only post-point-of-no-
return owner of their absent postimages and terminal journal transitions. Missing, duplicate,
reordered, `publish_proposed`-substituted, or nonterminal-at-compaction rows refuse.

Successful manual rollback leaves no rollback record or rollback payload. Reinstalling the rejected release is a normal
explicit update; an equal stored high-watermark sequence is accepted only with the identical signed
index hash. Automatic rollback of a failed update preserves whatever rollback set existed before the
attempt.

## 11. Error, output, and security behavior

The stable exit mapping is:

| Exit | Class | Examples |
|---:|---|---|
| 1 | operational failure | bounded DNS/connect/download interruption, full disk reported after a prior capacity check, ordinary host error |
| 2 | invalid input | malformed argv/version, unsupported option combination, nonexistent requested stable release |
| 3 | decision required | managed drift, post-update edit blocking rollback, user-owned collision requiring disposition |
| 4 | capability unavailable | unsupported architecture, launcher/update protocol too old, missing installed-owner provider row |
| 5 | security refusal | signature/checksum/effective-origin mismatch, archive/path/process policy violation, unsafe executable/vendor effect |
| 6 | recovery required | incomplete/contradictory journal, migration residue, third state, missing rollback evidence, malformed local trust/active/manifest state |

Errors use fixed reason codes and content-free messages. Safe public version and reason-code values may
be rendered; paths pass through `renderPath` for human output and remain byte-exact in JSON. Network
bodies, planner stderr, signatures, keys, archive member raw spellings, artifact/Brain contents,
backup locations, and vendor output are never interpolated. Redaction is defense in depth, not the
only boundary.

The updater stores/prompts for no credential. It never reads Keychain, `.netrc`, Git credential
state, SSH state, GitHub CLI config, vendor credentials, or protected environment files. Private
content crosses the new planner boundary only as explicitly admitted artifact/Brain blobs and the
bounded tokenized config projection over the local counted stdin channel; absolute product/Brain
roots and literal redaction patterns do not cross. The planner graph has no network/log/write
dependency and output validation permits only plan hashes, path tokens/Brain-relative paths, and
staged post/inverse blobs returned locally.

## 12. Verification gates

Every enumerating gate asserts a non-empty set per scope before asserting properties.

| Gate | Required evidence |
|---|---|
| launcher selects safely | absent active record uses packaged fallback; executing/terminal-cleanup lifecycle records route only to the bound current/fallback executor; before V2 handoff an active bootstrap envelope routes only strict `init` through packaged fallback or the launchability-complete identical copy and malformed/ambiguous active residue refuses; after handoff retained bootstrap evidence is inert even while retention is incomplete or altered; death at every bundle/metadata/trust/active/manifest boundary and every present-invalid active state refuses safely; retained release metadata/inventory/path/platform/protocol/entrypoint mutations refuse before exec; exact-set and non-empty bundle gates cover both architectures |
| V2 validator is closed | exhaustive arm/key/schema-ID tests, every illegal restore combination, first-over-limit path/source/manifest/artifact count, duplicate exact/NFC/folded paths, and V1 byte compatibility |
| migration preserves ownership | every migratable bounded V1 field maps unchanged; config alone becomes schema; alternate legacy encoding, empty/over-limit artifacts, non-stable version, loose timestamp/source/backup/path, shared directories, symlinks, config-entry, invalid backup, drift, collision, and unsafe V2-looking residue refuse before artifact/backup-byte reads or writes |
| migration/new init recover | death injection around immutable-plan write and every two-slot journal write/sync/selection, same-parent retention rename/parent sync, bootstrap/global lock, nonce/allocator prefix, staging/directory/reservation/bundle/metadata publication, Foundation/manifest cursor, point of no return, verification, compensation, and retention; slot replacement/corruption/gap/conflict, deterministic Foundation ordinals at zero/maximum/first-over and every short/long/non-ASCII/non-canonical spelling, exact-byte replacement attempts, source/tombstone third states, retained-subtree bounds, uninstall/doctor/reinstall and every aggregate cap preserve evidence, create no out-of-parent quarantine, invoke no unlink/rmdir, and fresh init performs zero network/vendor/model calls |
| signature chain is exact | wrong root/release key, key ID, signature bytes/length, domain, canonical encoding, duplicate/unknown key, independent delegation/index/selected-release sequence/hash replay, retained metadata path/content, origin set, and document/body bound all refuse |
| selection is stable | exact SemVer boundary cases, numeric ordering, latest equality, explicit version, active equality, previous-trusted reinstall, every downgrade/prerelease/build refusal |
| transport is closed | only fixed metadata origin and one delegated asset redirect, no proxy/credential/header inheritance, shared deadlines, response/header/body caps, termination/reaping, effective URL revalidation, no raw-body diagnostics |
| archive is bounded | Zstandard skippable/concatenated/dictionary/no-checksum/size/window/trailing cases; non-ustar/PAX/GNU/base-256 headers; path traversal, absolute/folded/duplicate names, links/specials, wrong mode/owner/count/size/hash/padding/EOF, and first-over-limit archive/expanded/file/entry/path/memory/temp cases; refusal leaves no product state and guarded scratch cleanup preserves unknowns |
| target planner is plan-only | compiled transitive graph is non-empty and contains no fs/network/process/env/clock/random/native/worker/dynamic import; magic/frame kind/order/length/trailing bytes, every fixed JSON/blob/wire/stderr/RSS/idle/wall/process bound, all named transcript/partition/inverse digest domains and projection mutation/self-reference vectors, artifact-token ordinals at zero/maximum/first-over-bound and every short/long/non-ASCII/non-canonical spelling, root-free draft ordering plus independently sorted concrete paths, invented/mismatched historical manifest fields, unknown protocol/effect/path/owner/precondition, and request/result equality all refuse before allocation |
| preview is deterministic and non-applying | two identical update and rollback previews are byte-identical; exact JSON path round-trip and distinct-control/render-collision vectors prove only human rendering is lossy; exclusive scratch-name creation covers collision/no-touch, retry 32, first-over-retry, and crash-before-plan cleanup; preview writes only attempt-owned scratch and leaves product, Brain, vendor, trust, active, manifest, allocator, and lifecycle roots byte-identical |
| owners are complete | every installed owner has exactly one provider and non-empty current set; absent owner is not invoked/installed; missing/extra owner/artifact, directory/symlink create/replace/remove, create below a missing/non-retained/non-kept parent, a second owner effect or any non-Codex effect, unsupported external effect, or vendor preflight failure refuses the whole plan |
| migrations are exact | contiguous unique chains, forward/inverse byte equality, folder-policy admission, product tokens require current schema artifacts plus matching owner keep, newly introduced/owner-mutated product targets refuse, before/after concurrent edit, per-blob/aggregate bounds, and failure at every Foundation phase; no private input reaches scratch/log/network/output |
| update order recovers | death/failure at every bundle root/entry/metadata subcursor, owner file/effect, migration, payload structure/entry/metadata subcursor, transitional/terminal manifest, trust, rollback-record, active, target-verifier, retirement, executor-routing, and compaction cursor yields the specified direction; each subcursor covers zero, maximum and first-over-bound plus illegal phase combinations, both retirement sets cover exact full-tree maximum/first-over, and verifier postimage hashes reject every omitted/extra/reordered/mutated owner/effect/migration row; active is the last activation-bearing publication before the verifier, the verifier alone crosses the point of no return, and trust never reverses |
| rollback is conservative | no network; current/postimage/previous-bundle/retained-metadata/inverse-plan/payload/manifest evidence required; exact rollback-step-list digest mutation/reorder/self-reference vectors; every post-update edit refuses before mutation; crash before/after fallback routing and each payload/blob retirement resumes; successful rollback restores exact bytes/state, consumes record/payload, removes only rejected inventory, and retains trust high watermarks |
| capacity is aggregate | active + old rollback + target + scratch + staging + backups + inverse + journals + compaction headroom are jointly checked for bytes and entries before reservation; first-over-limit allocates nothing |
| network remains explicit | repository classifier asserts every network entrypoint non-empty and total; only explicit update plan/apply is release transport; all other commands, rollback, migration-only init, and uninstall make zero update request |
| complete lifecycle works | synthetic install → V1 migration or fresh V2 init → update preview/apply → optional rollback/reapply → Spec 1 enable/sync/automation → uninstall preserves Brain and unrelated vendor state and leaves no product-owned bundle/reservation residue beyond the documented absent-manifest skeleton rules |

Focused unit/integration/E2E suites use injected local transport and synthetic Ed25519 keys. No test
depends on the live GitHub origin. A16 later certifies real signed artifacts, both macOS packages,
Homebrew installation, SBOM, checksums, clean-account flows, and public metadata.

## 13. Produced interfaces, sequencing, and accepted residuals

### 13.1 Produced interfaces

| Interface | Owner |
|---|---|
| `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1`, V1/V2 validators and drift | `packages/core/src/manifest/` |
| `StableSemverV1`, `TenDigitZeroPaddedOrdinalV1`, offline/release schemas, `ReleaseIdentityV1`, active/trust records, preview/capacity schemas, `PreparedUpdateCandidateV1`, `PreparedUpdateMaterializationV1`, `UpdateExpectedPayloadRefV1`, path brands, `UpdateExecutionPlanV1`, rollback schemas, and pure state tables | `packages/core/src/update/` plus the launcher-owned offline handoff |
| fresh/migration plans and journals, `BootstrapExternalShapeProjectionV1`, `BootstrapExpectedPayloadRefV1`, bootstrap payload plan/source/evidence/write-state types, `BootstrapPlannedParentV1`, `FoundationParticipantRefV2`, `PlannedCreatedPathV1`, `CreatedPathEvidenceV1`, bootstrap closure and V2 bootstrap handoff | Core manifest/update plus CLI composition selected by the plan |
| `SchemaMigrationPlanV1`, `SchemaMigrationExecutionJournalV1`, retained schema inverse schemas, migration registry and chain validation | `packages/core/src/migrations/` plus token-only pure planners in `packages/brain/src/migrations/update/` |
| `ReleasePlanningScratchV1`, `ReleasePlanningScratchJournalV1`, exact planner request/snapshot/draft schemas, `PlannerPathRefV1`, `PlannerInputBlobRefV1`, `PlannerOutputBlobRefV1`, `PlannerWireBoundsV1`, `PlannerTranscriptIdentityV1`, fixed-origin transport, Ed25519 verification, zstd-ustar/archive/scratch/planner supervision | `packages/security/src/update/` |
| token-only `OwnerUpdateDraftV1` providers and `OwnerExternalEffectDraftV1` | pure update planners in `packages/adapter-claude/src/update/` and `packages/adapter-codex/src/update/` |
| bundle/source/owner/migration/state/rollback/verifier/retirement plans, `PersistedOwnerChangeOperationV1`, `OwnerExternalEffectProcessPolicyV1`, dedicated retained inverse schemas, `BoundedUpdateInversePlanV1`, `UpdateInitialJournalRefV1`, exact participant/source journals, directory/metadata identities, and immutable leaf refs | Core schemas plus CLI composition selected by the implementation plan |
| `UpdateConstructionPlanV1`, its journal/write/evidence/ref types, `UpdateLifecycleCoordinatorPlanV2`, coordinator journal/compaction/closure types, `UpdateRecoveryExecutorRecordV1`, `UpdateRecoveryExecutorStagedFileV1`, update compaction and recovery-executor codecs | Spec 1 lifecycle coordinator/recovery module selected by the implementation plan |
| `RollbackPayloadInventoryV1`, `RollbackPayloadStatePlanV1`, payload source/publication/rotation and exact retained evidence | Core schemas plus CLI composition selected by the plan |
| launcher platform/bundle admission | `packages/platform-macos/src/launcher/` |
| stable launcher | `apps/launcher` |
| strict `update`/`update rollback`, target planner/verifier entrypoints, owner registry, execution/recovery composition | `apps/cli/src/commands/update/` and `apps/cli/src/update/` |

### 13.2 Required implementation sequence

1. Approve this complete written specification.
2. Write its implementation plan with explicit checkpoints around the split dependency.
3. Implement and verify V2 schemas, V1 migration, V2 new init, current-bundle seed, and
   `ManifestStatePlanV1` handoff; commit that prerequisite.
4. Execute the approved Spec 1 plan.
5. Resume this plan for launcher, trust/transport/archive, target planner, update, migrations,
   rollback, integration, documentation, and final review.
6. Close the unchanged DOS-P7 Task 7 checkpoint only after both specifications' gates pass.

### 13.3 Accepted v1 residuals

1. **No first-observation freeze resistance.** With no expiry/transparency log, a never-updated
   installation can receive valid stale metadata. Stored monotonic high watermarks prevent later
   replay. **Owner: a future release-trust design if operational evidence justifies it.**
2. **One root and one active release key.** Release-key compromise is recoverable by root-signed
   delegation; root-key compromise requires a Homebrew launcher update. There is no threshold
   signing in v1. **Owner: A16 release operations/documentation.**
3. **One previous version only.** Manual rollback is unavailable after its record is consumed or a
   later successful update replaces it. **Owner: documented product boundary.**
4. **Rollback never merges.** Any affected post-update edit blocks rollback; the user resolves it or
   stays on the current release. **Owner: user plus A16 recovery documentation.**
5. **Fixed online source only.** No offline bundle flag, custom mirror, arbitrary channel, or
   enterprise origin. **Owner: later distribution design if requested.**
6. **Signed target planner is not OS-sandboxed.** Its shipped dependency graph removes filesystem,
   network, process, and ambient-state capabilities, but a compromised signer/runtime is out of
   scope. **Owner: threat-model amendment if local release code becomes hostile input.**
7. **Protocol growth is deliberately conservative.** A target that needs a new mutation/effect
   kind refuses until Homebrew upgrades the launcher/current protocol. Compatibility loses to
   recovery safety. **Owner: each future protocol amendment.**
8. **Publication remains outside A11.** Real keys, signing ceremonies, GitHub Release creation,
   Homebrew formula, self-contained packaging, SBOM, and public release are A16 founder actions.
   A11 ships local mechanisms and synthetic evidence only.
