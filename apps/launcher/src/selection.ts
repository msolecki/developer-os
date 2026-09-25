import {
  admitReleaseAgainstTrust,
  admitReleaseIdentity,
  decodeCanonicalJson,
  decodeUpdateExecutorRecordSlot,
  hashBytes,
  isUnsignedLocalTrust,
  LifecycleRecoveryRequiredError,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  parseCanonicalAbsolutePathText,
  releaseIdentityHash,
  validateActiveReleaseRecord,
  validateBundleManifest,
  validateReleaseTrustState,
  validateRollbackRecord,
} from "@developer-os/core";
import type {
  ActiveReleaseRecordV1,
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
  ReleaseIdentityV1,
  ReleaseIndexV1,
  ReleaseKeyDelegationV1,
  ReleaseTrustStateV1,
  RollbackRecordV1,
  UpdateRecoveryExecutorRecordV1,
} from "@developer-os/core";
import {
  admitLauncherPlatformIdentity,
  LauncherBundleAdmission,
} from "@developer-os/platform-macos";
import type {
  AdmittedReleaseBundleV1,
  LauncherGuardedReaderV1,
  LauncherPlatformIdentityV1,
} from "@developer-os/platform-macos";

import type { LauncherEnvironmentV1 } from "./environment.js";

export type LauncherSelectionV1 =
  | { readonly kind: "package_fallback"; readonly bundle: AdmittedReleaseBundleV1 }
  | { readonly kind: "active_release"; readonly bundle: AdmittedReleaseBundleV1 }
  | {
      readonly kind: "update_executor";
      readonly bundle: AdmittedReleaseBundleV1;
      readonly release: ReleaseIdentityV1;
    }
  | {
      readonly kind: "bootstrap_recovery";
      readonly bundle: AdmittedReleaseBundleV1;
      readonly argv: readonly ["init"];
    };

/**
 * The bounded outcome of Spec 2 §6's bootstrap-closure reader. A real reader
 * (walking the plan/journal/retention envelope) is Task 9's territory and is
 * not re-implemented here; the launcher only routes on its verdict, taken as
 * an injected fact so this module stays a pure structural admission over
 * whatever produced it.
 */
export type LauncherBootstrapClosureV1 =
  | { readonly kind: "handoff_complete" }
  | { readonly kind: "non_terminal" }
  | { readonly kind: "malformed" };

/**
 * The bounded outcome of the V2 update-coordinator envelope reader (Spec 2 §9.2), injected like
 * the bootstrap closure: the launcher routes on it and never interprets update steps.
 */
export type LauncherUpdateEnvelopeV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly coordinatorId: string }
  | { readonly kind: "malformed" };

export interface LauncherPackagedFallbackV1 {
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly manifestPath: CanonicalAbsolutePathV1;
}

/** A retained signed document, structurally admitted and hash-pinned but not yet verified. */
export interface LauncherRetainedDocumentV1 {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly signed: unknown;
  readonly signatures: readonly unknown[];
}

/**
 * The Task 11 signature port, consumed here through an injected interface
 * rather than implemented: this module never verifies an Ed25519 signature
 * itself. It hands over the delegation and index by the store slot each was
 * read from and receives the validated chain, which it then binds to the
 * release it launches.
 */
export type LauncherRetainedDocumentVerifierV1 = (documents: {
  readonly delegation: LauncherRetainedDocumentV1;
  readonly index: LauncherRetainedDocumentV1;
}) => { readonly delegation: ReleaseKeyDelegationV1; readonly index: ReleaseIndexV1 };

export interface LauncherSelectionRequestV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly platform: LauncherPlatformIdentityV1;
  readonly effectiveUid: number;
  /** Read-only: this admission never mutates, so it only needs the guarded reader. */
  readonly fs: LauncherGuardedReaderV1;
  readonly packagedFallback: LauncherPackagedFallbackV1;
  readonly bootstrapClosure: LauncherBootstrapClosureV1;
  /** Absent when no reader is wired: an `executing` record then refuses as an orphan (exit 6). */
  readonly updateEnvelope?: LauncherUpdateEnvelopeV1;
  readonly verifyRetainedDocument: LauncherRetainedDocumentVerifierV1;
}

export interface LauncherProcessRequestV1 {
  readonly executable: CanonicalAbsolutePathV1;
  readonly argv: readonly string[];
  readonly env: LauncherEnvironmentV1;
  /**
   * The sole extra descriptor the launcher ever reserves: read-only, and
   * exactly one -- or none when no offline trust is configured.
   */
  readonly extraDescriptors: readonly [] | readonly [{ readonly fd: 3; readonly mode: "read_only_pipe" }];
}

const MAX_ACTIVE_BYTES = 16 * 1024;
const MAX_EXECUTOR_RECORD_BYTES = 16 * 1024;
const MAX_TRUST_BYTES = 16 * 1024;
const MAX_DELEGATION_BYTES = 65_536;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024;

function recoveryRequired(reason: string, path: string): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

function derive(root: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${root}/${relative}`);
}

/**
 * A minimal synchronous path-canonicalization evidence, independently
 * implemented because `apps/launcher` may not import the CLI (Spec 2 §2).
 * Every path this admission resolves is already a guarded no-follow read
 * through `LauncherGuardedReaderV1`; this evidence only satisfies the
 * `admitCanonicalAbsolutePath` grammar check inside `validateActiveReleaseRecord`.
 */
function createCanonicalPathEvidence(): CanonicalPathEvidenceV1 {
  return {
    reopenCanonicalAbsolutePath: (path) => path,
    containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
    hasFoldedAlias: () => false,
  };
}

/** Product state files are written exactly 0600; a package-installed file's mode is not the product's. */
const STATE_FILE_MODE = 0o600;

function admitOwnedRegular(
  entry: LifecycleGuardedEntryV1 | null,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
  mode: number | null,
  reason: string,
): LifecycleGuardedEntryV1 {
  if (
    entry === null ||
    entry.kind !== "regular_file" ||
    entry.ownerUid !== effectiveUid ||
    (mode !== null && entry.mode !== mode) ||
    entry.nlink !== 1 ||
    BigInt(entry.size) > BigInt(maximumBytes)
  ) {
    recoveryRequired(reason, path);
  }
  return entry;
}

async function ownedRegular(
  fs: LauncherGuardedReaderV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
  mode: number | null,
  reason: string,
): Promise<LifecycleGuardedEntryV1> {
  return admitOwnedRegular(await fs.lstat(path), path, effectiveUid, maximumBytes, mode, reason);
}

/** Read once: the bytes a caller hash-pins are the bytes it parses. */
async function readOwnedRegular(
  fs: LauncherGuardedReaderV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
  mode: number | null,
  reason: string,
): Promise<{ readonly bytes: Uint8Array; readonly hash: LowerHexSha256 }> {
  const entry = await ownedRegular(fs, path, effectiveUid, maximumBytes, mode, reason);
  const bytes = await fs.readRegular(entry, maximumBytes);
  return { bytes, hash: hashBytes(bytes) as LowerHexSha256 };
}

async function ownedDirectory(
  fs: LauncherGuardedReaderV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  reason: string,
): Promise<LifecycleGuardedEntryV1> {
  const entry = await fs.lstat(path);
  if (entry === null || entry.kind !== "directory" || entry.ownerUid !== effectiveUid || entry.mode !== 0o700) {
    recoveryRequired(reason, path);
  }
  return entry;
}

/** Non-empty, exact retained-metadata-store set equality (Spec 2 §3.1). */
async function assertExactStoreSet(
  fs: LauncherGuardedReaderV1,
  directoryPath: CanonicalAbsolutePathV1,
  expected: readonly string[],
  effectiveUid: number,
): Promise<void> {
  const directory = await ownedDirectory(fs, directoryPath, effectiveUid, "launcher_retained_metadata_store_invalid");
  const observed = new Set<string>();
  for await (const name of fs.names(directory)) observed.add(name);
  if (observed.size === 0 || observed.size !== expected.length || expected.some((name) => !observed.has(name))) {
    recoveryRequired("launcher_retained_metadata_store_set_mismatch", directoryPath);
  }
}

function parseActive(bytes: Uint8Array, path: CanonicalAbsolutePathV1): ActiveReleaseRecordV1 {
  try {
    return validateActiveReleaseRecord(decodeCanonicalJson(bytes, MAX_ACTIVE_BYTES), createCanonicalPathEvidence());
  } catch {
    recoveryRequired("launcher_active_release_record_invalid", path);
  }
}

function parseTrust(bytes: Uint8Array, path: CanonicalAbsolutePathV1) {
  try {
    return validateReleaseTrustState(decodeCanonicalJson(bytes, MAX_TRUST_BYTES));
  } catch {
    recoveryRequired("launcher_release_trust_invalid", path);
  }
}

function parseBundleManifest(bytes: Uint8Array, path: CanonicalAbsolutePathV1, maximumBytes: number): ReleaseBundleManifestV1 {
  try {
    return validateBundleManifest(decodeCanonicalJson(bytes, maximumBytes));
  } catch {
    recoveryRequired("launcher_bundle_manifest_invalid", path);
  }
}

function parseRetainedDocumentEnvelope(
  bytes: Uint8Array,
  path: CanonicalAbsolutePathV1,
  maximumBytes: number,
): LauncherRetainedDocumentV1 {
  let value: unknown;
  try {
    value = decodeCanonicalJson(bytes, maximumBytes);
  } catch {
    return recoveryRequired("launcher_retained_document_invalid", path);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (value as { kind?: unknown }).kind !== "string" ||
    !Array.isArray((value as { signatures?: unknown }).signatures)
  ) {
    recoveryRequired("launcher_retained_document_invalid", path);
  }
  const record = value as { schemaVersion: 1; kind: string; signed: unknown; signatures: readonly unknown[] };
  return record;
}

async function readRetainedDocument(
  fs: LauncherGuardedReaderV1,
  path: CanonicalAbsolutePathV1,
  expectedHash: LowerHexSha256,
  maximumBytes: number,
  effectiveUid: number,
): Promise<LauncherRetainedDocumentV1> {
  const { bytes, hash } = await readOwnedRegular(fs, path, effectiveUid, maximumBytes, STATE_FILE_MODE, "launcher_retained_document_missing");
  if (hash !== expectedHash) recoveryRequired("launcher_retained_document_hash_mismatch", path);
  return parseRetainedDocumentEnvelope(bytes, path, maximumBytes);
}

async function admitPackagedFallback(
  request: LauncherSelectionRequestV1,
): Promise<{ readonly bundle: AdmittedReleaseBundleV1; readonly manifestHash: LowerHexSha256 }> {
  const { fs, packagedFallback, platform, effectiveUid } = request;
  const { bytes, hash } = await readOwnedRegular(
    fs,
    packagedFallback.manifestPath,
    effectiveUid,
    MAX_BUNDLE_MANIFEST_BYTES,
    null,
    "launcher_packaged_fallback_manifest_missing",
  );
  const manifest = parseBundleManifest(bytes, packagedFallback.manifestPath, MAX_BUNDLE_MANIFEST_BYTES);
  const bundle = await new LauncherBundleAdmission().admit({
    platform,
    bundleRoot: packagedFallback.bundleRoot,
    manifest,
    effectiveUid,
    fs,
  });
  return { bundle, manifestHash: hash };
}

async function admitActiveRelease(
  request: LauncherSelectionRequestV1,
  activeEntry: LifecycleGuardedEntryV1,
): Promise<AdmittedReleaseBundleV1> {
  const { fs, productHome, effectiveUid } = request;

  const admittedEntry = admitOwnedRegular(activeEntry, activeEntry.path, effectiveUid, MAX_ACTIVE_BYTES, STATE_FILE_MODE, "launcher_active_release_record_invalid");
  const activeBytes = await fs.readRegular(admittedEntry, MAX_ACTIVE_BYTES);
  const active = parseActive(activeBytes, activeEntry.path);

  const trustPath = derive(productHome, "state/release-trust.json");
  const trustRead = await readOwnedRegular(fs, trustPath, effectiveUid, MAX_TRUST_BYTES, STATE_FILE_MODE, "launcher_release_trust_missing");
  const trust = parseTrust(trustRead.bytes, trustPath);
  if (isUnsignedLocalTrust(trust)) recoveryRequired("launcher_retained_document_unverified", trustPath);
  try {
    admitReleaseAgainstTrust(trust, active, "guarded_active");
  } catch {
    recoveryRequired("launcher_active_release_not_dominated_by_trust", trustPath);
  }

  const rollback = await readRollbackRecord(request);
  if (rollback !== null && rollback.installed.releaseIdentityHash !== active.releaseIdentityHash) {
    recoveryRequired("launcher_rollback_record_foreign", derive(productHome, "state/update-rollback.json"));
  }
  return admitRetainedRelease(request, active, { retainedBeside: rollback?.previous ?? null, trust });
}

/** Absent, or fresh `init`'s empty reservation: no rollback identity is retained. */
async function readRollbackRecord(request: LauncherSelectionRequestV1): Promise<RollbackRecordV1 | null> {
  const path = derive(request.productHome, "state/update-rollback.json");
  const entry = await request.fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== request.effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(MAXIMUM_ROLLBACK_DOCUMENT_BYTES)) {
    recoveryRequired("launcher_rollback_record_invalid", path);
  }
  if (entry.size === "0") return null;
  try {
    return validateRollbackRecord(
      decodeCanonicalJson(await request.fs.readRegular(entry, MAXIMUM_ROLLBACK_DOCUMENT_BYTES), MAXIMUM_ROLLBACK_DOCUMENT_BYTES),
      createCanonicalPathEvidence(),
    );
  } catch {
    return recoveryRequired("launcher_rollback_record_invalid", path);
  }
}

/**
 * The retained-metadata and bundle admission shared by the active and recorded-executor routes.
 * Only a clear state has exact store-set equality, to the active plus the retained rollback
 * release; while an update executes, the target's metadata already sits beside the current
 * release's, so the executing route checks by hash.
 */
async function admitRetainedRelease(
  request: LauncherSelectionRequestV1,
  active: ReleaseIdentityV1,
  stores: { readonly retainedBeside: ReleaseIdentityV1 | null; readonly trust: ReleaseTrustStateV1 | null } | "contains_release",
): Promise<AdmittedReleaseBundleV1> {
  const { fs, productHome, effectiveUid, verifyRetainedDocument } = request;
  const delegationsRoot = derive(productHome, "state/release-metadata/delegations");
  const indexesRoot = derive(productHome, "state/release-metadata/indexes");
  const bundlesRoot = derive(productHome, "state/release-metadata/bundles");

  const expectedRoot = derive(productHome, `releases/${active.version}/darwin-${active.architecture}`);
  if (active.bundleRoot !== expectedRoot || active.architecture !== request.platform.architecture) {
    recoveryRequired("launcher_release_root_invalid", active.bundleRoot);
  }

  if (stores !== "contains_release") {
    const identities = stores.retainedBeside === null ? [active] : [active, stores.retainedBeside];
    const names = (hash: (identity: ReleaseIdentityV1) => LowerHexSha256): readonly string[] =>
      [...new Set(identities.map((identity) => `${hash(identity)}.json`))];
    await assertExactStoreSet(fs, delegationsRoot, names((identity) => identity.delegationHash), effectiveUid);
    await assertExactStoreSet(fs, indexesRoot, names((identity) => identity.releaseIndexHash), effectiveUid);
    await assertExactStoreSet(fs, bundlesRoot, names((identity) => identity.bundleManifestHash), effectiveUid);
  }

  const indexPath = derive(indexesRoot, `${active.releaseIndexHash}.json`);
  const delegationDocument = await readRetainedDocument(
    fs,
    derive(delegationsRoot, `${active.delegationHash}.json`),
    active.delegationHash,
    MAX_DELEGATION_BYTES,
    effectiveUid,
  );
  const indexDocument = await readRetainedDocument(fs, indexPath, active.releaseIndexHash, MAX_INDEX_BYTES, effectiveUid);
  let chain: ReturnType<LauncherRetainedDocumentVerifierV1>;
  try {
    chain = verifyRetainedDocument({ delegation: delegationDocument, index: indexDocument });
  } catch {
    return recoveryRequired("launcher_retained_document_unverified", indexPath);
  }
  if (stores !== "contains_release" && stores.trust !== null) assertTrustNamesDelegation(stores.trust, active, chain.delegation);

  const bundleManifestPath = derive(bundlesRoot, `${active.bundleManifestHash}.json`);
  const { bytes: manifestBytes, hash: bundleManifestHash } = await readOwnedRegular(
    fs,
    bundleManifestPath,
    effectiveUid,
    MAX_BUNDLE_MANIFEST_BYTES,
    STATE_FILE_MODE,
    "launcher_bundle_manifest_missing",
  );
  if (bundleManifestHash !== active.bundleManifestHash) {
    recoveryRequired("launcher_bundle_manifest_hash_mismatch", bundleManifestPath);
  }
  const manifest = parseBundleManifest(manifestBytes, bundleManifestPath, MAX_BUNDLE_MANIFEST_BYTES);
  bindReleaseIdentity(productHome, active, chain, manifest, bundleManifestHash, bundleManifestPath);

  return new LauncherBundleAdmission().admit({
    platform: { platform: active.platform, architecture: active.architecture },
    bundleRoot: active.bundleRoot,
    manifest,
    effectiveUid,
    fs,
  });
}

/**
 * Spec 2 §3.1: the signed index must list this exact release, bundle manifest and metadata
 * sequences -- core's `admitReleaseIdentity` is the one binding the `update` planner uses too.
 */
function bindReleaseIdentity(
  productHome: CanonicalAbsolutePathV1,
  active: ReleaseIdentityV1,
  chain: ReturnType<LauncherRetainedDocumentVerifierV1>,
  manifest: ReleaseBundleManifestV1,
  bundleManifestHash: LowerHexSha256,
  path: CanonicalAbsolutePathV1,
): void {
  const entry = chain.index.releases.find((candidate) => candidate.version === active.version);
  if (entry === undefined) recoveryRequired("launcher_release_not_in_retained_index", path);
  try {
    admitReleaseIdentity(
      {
        version: active.version,
        releaseSequence: active.releaseSequence,
        releaseIdentityHash: active.releaseIdentityHash,
        delegationSequence: active.delegationSequence,
        delegationHash: active.delegationHash,
        releaseIndexSequence: active.releaseIndexSequence,
        releaseIndexHash: active.releaseIndexHash,
        bundleManifestHash: active.bundleManifestHash,
        bundleRoot: active.bundleRoot,
        platform: active.platform,
        architecture: active.architecture,
        launcherProtocol: active.launcherProtocol,
        updateProtocol: active.updateProtocol,
      },
      createCanonicalPathEvidence(),
      {
        productHome,
        selected: {
          entry,
          bundle: entry.bundles[active.architecture === "arm64" ? 0 : 1],
          releaseIdentityHash: releaseIdentityHash(entry, active.architecture),
        },
        metadata: {
          delegationSequence: chain.delegation.sequence,
          delegationHash: active.delegationHash,
          delegatedReleaseKeyId: chain.delegation.releaseKey.keyId,
          releaseIndexSequence: chain.index.sequence,
          releaseIndexHash: active.releaseIndexHash,
        },
        bundleManifest: manifest,
        bundleManifestHash,
      },
    );
  } catch {
    recoveryRequired("launcher_bundle_manifest_identity_mismatch", path);
  }
}

/** The trust watermark at the active delegation's sequence must name that delegation and its key. */
function assertTrustNamesDelegation(trust: ReleaseTrustStateV1, active: ReleaseIdentityV1, delegation: ReleaseKeyDelegationV1): void {
  const comparison = BigInt(delegation.sequence) - BigInt(trust.highestDelegationSequence);
  if (comparison > 0n || (comparison === 0n && (trust.delegationHash !== active.delegationHash || trust.delegatedReleaseKeyId !== delegation.releaseKey.keyId))) {
    recoveryRequired("launcher_active_release_not_dominated_by_trust", active.bundleRoot);
  }
}

async function readUpdateExecutorRecord(request: LauncherSelectionRequestV1): Promise<UpdateRecoveryExecutorRecordV1 | null> {
  const path = derive(request.productHome, "state/update-executor.json");
  const entry = await request.fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== request.effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(MAX_EXECUTOR_RECORD_BYTES)) {
    recoveryRequired("launcher_update_executor_record_invalid", path);
  }
  let record: ReturnType<typeof decodeUpdateExecutorRecordSlot>;
  try {
    record = decodeUpdateExecutorRecordSlot(await request.fs.readRegular(entry, MAX_EXECUTOR_RECORD_BYTES), createCanonicalPathEvidence());
  } catch {
    return recoveryRequired("launcher_update_executor_record_invalid", path);
  }
  // Fresh `init`'s empty reservation holds no record.
  return record === "reservation" ? null : record;
}

/**
 * Spec 2 §9.2 routing. `executing` requires its own coordinator envelope and runs the recorded
 * original release; `terminal_cleanup` requires that envelope or none and runs the package
 * fallback, which must equal the record's manifest hash and protocols. Any other pairing is exit 6.
 */
async function routeUpdateExecutor(
  request: LauncherSelectionRequestV1,
  record: UpdateRecoveryExecutorRecordV1,
): Promise<LauncherSelectionV1> {
  const envelope = request.updateEnvelope ?? { kind: "absent" };
  const recordPath = derive(request.productHome, "state/update-executor.json");
  if (envelope.kind === "malformed") recoveryRequired("launcher_update_envelope_malformed", request.productHome);
  const ownEnvelope = envelope.kind === "present" && envelope.coordinatorId === record.coordinatorId;
  if (record.executor.kind === "release_bundle") {
    if (!ownEnvelope) recoveryRequired("launcher_update_executor_orphan", recordPath);
    const bundle = await admitRetainedRelease(request, record.executor.release, "contains_release");
    return { kind: "update_executor", bundle, release: record.executor.release };
  }
  if (envelope.kind === "present" && !ownEnvelope) recoveryRequired("launcher_update_executor_foreign", recordPath);
  const { manifestHash, bundle } = await admitPackagedFallback(request);
  if (
    manifestHash !== record.executor.bundleManifestHash ||
    bundle.manifest.launcherProtocol !== record.executor.launcherProtocol ||
    bundle.manifest.updateProtocol !== record.executor.updateProtocol
  ) {
    recoveryRequired("launcher_update_fallback_mismatch", request.packagedFallback.manifestPath);
  }
  return { kind: "package_fallback", bundle };
}

/**
 * Guarded launcher selection (Spec 2 §3.1). Before normal active/fallback
 * routing, a non-terminal bootstrap envelope is a recovery-routing arm
 * restricted to `init`; once the V2 handoff is complete that envelope is
 * inert and normal routing applies regardless of its later state. A present
 * but invalid active record is never a silent fallback.
 */
export async function selectLauncherCandidate(
  request: LauncherSelectionRequestV1,
): Promise<LauncherSelectionV1> {
  admitLauncherPlatformIdentity(request.platform);

  const executor = await readUpdateExecutorRecord(request);
  if (executor !== null) return routeUpdateExecutor(request, executor);

  if (request.bootstrapClosure.kind === "malformed") {
    recoveryRequired("launcher_bootstrap_residue_malformed", request.productHome);
  }

  const activePath = derive(request.productHome, "state/active-release.json");
  const activeEntry = await request.fs.lstat(activePath);

  if (request.bootstrapClosure.kind === "non_terminal") {
    if (activeEntry !== null) {
      recoveryRequired("launcher_active_published_before_launchability_suffix", activePath);
    }
    const { bundle } = await admitPackagedFallback(request);
    return { kind: "bootstrap_recovery", bundle, argv: ["init"] };
  }

  if (activeEntry === null) {
    const { bundle } = await admitPackagedFallback(request);
    return { kind: "package_fallback", bundle };
  }
  if (activeEntry.kind !== "regular_file") {
    recoveryRequired("launcher_active_release_record_invalid", activePath);
  }

  const bundle = await admitActiveRelease(request, activeEntry);
  return { kind: "active_release", bundle };
}

/**
 * A shell-free absolute execution request: the runtime entrypoint by
 * absolute path (never resolved through `PATH`), the bundle entrypoint as
 * the first argv element, the fixed internal `--offline-release-trust-fd=3`
 * argument, then the original public CLI argv — or, under bootstrap
 * recovery, exactly `init` in its place (Spec 2 §3.1). The FD 3 descriptor
 * is reserved read-only here; Task 11 owns actually opening and writing it.
 * The CLI's `bin.ts` removes the flag before its strict parser runs. Without
 * a trust pipe both the flag and the reservation are omitted, so no flag
 * ever names a descriptor that was never handed over.
 */
export function buildLauncherProcessRequest(
  selection: LauncherSelectionV1,
  env: LauncherEnvironmentV1,
  publicArgv: readonly string[],
  trustPipe: boolean,
): LauncherProcessRequestV1 {
  const trailingArgv = selection.kind === "bootstrap_recovery" ? selection.argv : publicArgv;
  return {
    executable: selection.bundle.runtimeEntrypoint,
    argv: trustPipe
      ? [selection.bundle.entrypoint, "--offline-release-trust-fd=3", ...trailingArgv]
      : [selection.bundle.entrypoint, ...trailingArgv],
    env,
    extraDescriptors: trustPipe ? [{ fd: 3, mode: "read_only_pipe" }] : [],
  };
}
