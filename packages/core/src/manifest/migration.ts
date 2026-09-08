import { createHash } from "node:crypto";
import { dirname } from "node:path";

import {
  encodeCanonicalJson,
  type CanonicalJsonValue,
} from "../lifecycle/canonical-json.js";
import {
  deriveBootstrapPayloadPath,
  type BoundedArtifactSourceV1,
  type CanonicalAbsolutePathV1,
  type VaultFreeRelativePathV1,
} from "../update/paths.js";
import type {
  LowerHexSha256,
  StableSemverV1,
  UInt64DecimalV1,
  UtcTimestampV1,
} from "../update/scalars.js";
import {
  bootstrapExternalShapeHash,
  deriveBootstrapEnvelopePaths,
  validateBootstrapPlan,
  type BootstrapExternalShapeProjectionV1,
  type BootstrapPayloadPlanV1,
  type BootstrapPayloadSourceV1,
  type BootstrapPlanAdmissionContextV1,
  type FoundationMutationRefV1,
  type FoundationParticipantRefV2,
  type FoundationTransactionIdV2,
  type ManifestMigrationPlanV1,
  type PersistedBootstrapLockIdentityV1,
  type PlannedCreatedPathV1,
} from "./bootstrap.js";
import type {
  BootstrapExpectedPayloadRefV1,
  ManifestMigrationIdV1,
  ManifestStatePlanV1,
} from "./manifest-state.js";
import { ManifestStateError } from "./store.js";
import type {
  InstallationManifestV2,
  ManagedArtifactV1,
  ManagedArtifactV2,
  ManifestAdmissionContextV1,
  MigratableInstallationManifestV1,
} from "./types.js";
import { validateManifestV2, validateMigratableManifestV1 } from "./v2.js";

const CONFIG_LEAF = "config.toml";
const ACTIVATION_LEAF = "lifecycle-activation.json";
const MAX_FOUNDATION_MUTATIONS = 256;
const MAX_FOUNDATION_PAIRS = 256;
const MAX_FOUNDATION_CONTENT_BYTES = 16_777_216;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_STAGING_ENTRIES = 1_000_000;
const MANIFEST_PLAN_BYTES = 16_777_216;
const MAX_PLAN_BYTES = 268_435_456;
const ENVELOPE_RECORD_BYTES = 1024n;
const encoder = new TextEncoder();

export class ManifestMigrationNotFeasibleError extends ManifestStateError {
  readonly reason = "manifest_migration_not_feasible" as const;

  constructor() {
    super("V1 installation cannot be migrated to manifest V2");
    this.name = "ManifestMigrationNotFeasibleError";
  }
}

export interface ManifestMigrationIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ManifestMigrationParentV1 extends ManifestMigrationIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
}

export interface ManifestMigrationPackagedFileV1 {
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 0o600 | 0o700;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ManifestMigrationPackagedReleaseV1 {
  readonly packageRoot: CanonicalAbsolutePathV1;
  readonly packageRootDev: UInt64DecimalV1;
  readonly packageRootIno: UInt64DecimalV1;
  readonly packageInventoryHash: LowerHexSha256;
  readonly retainedMetadata: {
    readonly delegation: string;
    readonly releaseIndex: string;
    readonly bundleManifest: string;
  };
  readonly bundleRoot: string;
  readonly identity: {
    readonly version: string;
    readonly releaseSequence: string;
    readonly releaseIdentityHash: string;
    readonly delegationSequence: string;
    readonly delegationHash: string;
    readonly delegatedReleaseKeyId: string;
    readonly releaseIndexSequence: string;
    readonly releaseIndexHash: string;
    readonly bundleManifestHash: string;
    readonly platform: "darwin";
    readonly architecture: "arm64" | "x64";
    readonly launcherProtocol: number;
    readonly updateProtocol: number;
  };
  readonly files: readonly ManifestMigrationPackagedFileV1[];
}

export interface ManifestMigrationReadRequestV1 {
  readonly authority: "managed" | "backup";
  readonly artifactOrdinal: number;
  readonly path: CanonicalAbsolutePathV1;
}

export type ManifestMigrationReadV1 =
  | {
      readonly kind: "regular_file";
      readonly ownerUid: number;
      readonly mode: 0o600 | 0o700;
      readonly nlink: 1;
      readonly bytes: number;
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "directory";
      readonly ownerUid: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | { readonly kind: "unavailable" };

/**
 * The enclosing operation, envelope identity, and observed shape are derived by
 * the planner itself, so the caller supplies only the composition-root halves of
 * the bootstrap admission context.
 */
export type ManifestMigrationPlanAdmissionV1 = Omit<
  BootstrapPlanAdmissionContextV1,
  "operation" | "id" | "bootstrapIdentity" | "externalShape"
>;

export interface ManifestMigrationRequestV1 {
  readonly id: ManifestMigrationIdV1;
  readonly admission: ManifestMigrationPlanAdmissionV1;
  readonly manifestAdmission: ManifestAdmissionContextV1;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly externalShape: BootstrapExternalShapeProjectionV1;
  readonly admittedPreexistingPaths: readonly CanonicalAbsolutePathV1[];
  readonly preexistingParents: readonly ManifestMigrationParentV1[];
  readonly journalSlots: readonly [ManifestMigrationIdentityV1, ManifestMigrationIdentityV1];
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly manifestBytes: Uint8Array;
  readonly manifestIdentity: ManifestMigrationIdentityV1;
  readonly foundationState: "complete" | "incomplete";
  /** V2-only product directories this migration creates when they are absent. */
  readonly productDirectories: readonly CanonicalAbsolutePathV1[];
  /** V2-only owner runtime reservations this migration creates as empty files. */
  readonly productReservations: readonly CanonicalAbsolutePathV1[];
  readonly packaged: ManifestMigrationPackagedReleaseV1;
  readonly availableBytes: UInt64DecimalV1;
  readonly nonce: LowerHexSha256;
  readonly plannedAt: UtcTimestampV1;
  readonly read: (input: ManifestMigrationReadRequestV1) => Promise<ManifestMigrationReadV1>;
}

function refuse(): never {
  throw new ManifestMigrationNotFeasibleError();
}

function leaf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function fold(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
  }
  return a.length - b.length;
}

function rawHash(value: string | Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

function canonicalHash(domain: string, value: CanonicalJsonValue): LowerHexSha256 {
  const encoded = encodeCanonicalJson(value);
  return createHash("sha256").update(domain).update(encoded.slice(0, -1)).digest("hex") as LowerHexSha256;
}

function mapArtifact(artifact: ManagedArtifactV1): ManagedArtifactV2 {
  const common = {
    owner: artifact.owner,
    path: artifact.path as CanonicalAbsolutePathV1,
    productVersion: artifact.productVersion as StableSemverV1,
    existedBefore: artifact.existedBefore,
    beforeHash: artifact.beforeHash as LowerHexSha256 | null,
    backupRelativePath: artifact.backupRelativePath as VaultFreeRelativePathV1 | null,
    source: artifact.source as BoundedArtifactSourceV1,
    mergeStrategy: artifact.mergeStrategy,
    verifiedAt: artifact.verifiedAt as UtcTimestampV1,
  };
  if (artifact.kind === "directory") {
    return { ...common, kind: "directory", verification: { mode: "content" } };
  }
  if (artifact.kind !== "file") refuse();
  const installedHash = artifact.installedHash as LowerHexSha256;
  return leaf(artifact.path) === CONFIG_LEAF
    ? { ...common, kind: "file", verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash } }
    : { ...common, kind: "file", verification: { mode: "content", installedHash } };
}

function artifactOrder(left: ManagedArtifactV2, right: ManagedArtifactV2): number {
  return compareUtf8(left.path, right.path) ||
    compareUtf8(left.owner, right.owner) ||
    compareUtf8(left.kind, right.kind) ||
    compareUtf8(left.verification.mode, right.verification.mode);
}

export function mapManifestV1ToV2(
  manifest: MigratableInstallationManifestV1,
  additions: readonly ManagedArtifactV2[],
): InstallationManifestV2 {
  if (additions.length < 1) refuse();
  const productVersion = (additions[0] as ManagedArtifactV2).productVersion;
  for (const artifact of additions) {
    if (
      artifact.productVersion !== productVersion ||
      artifact.existedBefore ||
      artifact.beforeHash !== null ||
      artifact.backupRelativePath !== null ||
      leaf(artifact.path) === ACTIVATION_LEAF
    ) refuse();
  }
  const artifacts = [...manifest.artifacts.map(mapArtifact), ...additions].toSorted(artifactOrder);
  const folded = new Set<string>();
  for (const artifact of artifacts) {
    if (folded.has(fold(artifact.path))) refuse();
    folded.add(fold(artifact.path));
  }
  return {
    schemaVersion: 2,
    productVersion,
    installedAt: manifest.installedAt as UtcTimestampV1,
    artifacts,
  };
}

interface MigrationPathsV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly stateRoot: CanonicalAbsolutePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
  readonly globalLock: CanonicalAbsolutePathV1;
  readonly installNonce: CanonicalAbsolutePathV1;
  readonly idAllocator: CanonicalAbsolutePathV1;
  readonly activationRecord: CanonicalAbsolutePathV1;
  readonly activeRelease: CanonicalAbsolutePathV1;
  readonly releaseTrust: CanonicalAbsolutePathV1;
  readonly transactions: CanonicalAbsolutePathV1;
  readonly releaseRoot: CanonicalAbsolutePathV1;
  readonly metadataRoot: CanonicalAbsolutePathV1;
  readonly versionRoot: CanonicalAbsolutePathV1;
  readonly bundleRoot: CanonicalAbsolutePathV1;
}

function migrationPaths(request: ManifestMigrationRequestV1): MigrationPathsV1 {
  const productHome = request.admission.productHome;
  const stateRoot = request.admission.stateRoot;
  const releaseRoot = `${productHome}/releases` as CanonicalAbsolutePathV1;
  const identity = request.packaged.identity;
  return {
    productHome,
    stateRoot,
    stagingRoot: request.admission.productStagingRoot,
    globalLock: `${stateRoot}/.lifecycle.lock` as CanonicalAbsolutePathV1,
    installNonce: `${stateRoot}/lifecycle-install-nonce` as CanonicalAbsolutePathV1,
    idAllocator: `${stateRoot}/lifecycle-id-allocator.json` as CanonicalAbsolutePathV1,
    activationRecord: `${stateRoot}/${ACTIVATION_LEAF}` as CanonicalAbsolutePathV1,
    activeRelease: `${stateRoot}/active-release.json` as CanonicalAbsolutePathV1,
    releaseTrust: `${stateRoot}/release-trust.json` as CanonicalAbsolutePathV1,
    transactions: `${stateRoot}/transactions` as CanonicalAbsolutePathV1,
    releaseRoot,
    metadataRoot: `${releaseRoot}/metadata` as CanonicalAbsolutePathV1,
    versionRoot: `${releaseRoot}/${identity.version}` as CanonicalAbsolutePathV1,
    bundleRoot: `${releaseRoot}/${identity.version}/${identity.platform}-${identity.architecture}` as CanonicalAbsolutePathV1,
  };
}

/**
 * Every path a V2 installation owns that a V1 installation may not already
 * claim, compared under the folded spelling so a declared, NFC, or case-folded
 * V1 claim refuses alike. The activation record is here and in no created
 * partition: Spec 1 lifecycle apply is its only creator, so a V1 claim on it is
 * a refusal rather than an adoption.
 */
function reservedV2Paths(
  request: ManifestMigrationRequestV1,
  paths: MigrationPathsV1,
): readonly CanonicalAbsolutePathV1[] {
  return [
    paths.globalLock,
    paths.installNonce,
    paths.idAllocator,
    paths.activationRecord,
    paths.activeRelease,
    paths.releaseTrust,
    paths.transactions,
    paths.releaseRoot,
    paths.stagingRoot,
    ...request.productDirectories,
    ...request.productReservations,
  ];
}

interface AdmittedMigrationV1 {
  readonly manifest: MigratableInstallationManifestV1;
  readonly v1ManifestHash: LowerHexSha256;
  readonly paths: MigrationPathsV1;
}

function projectedBytes(request: ManifestMigrationRequestV1, artifacts: number): bigint {
  const packagedBytes = request.packaged.files.reduce((total, file) => total + BigInt(file.bytes), 0n);
  const envelopeRecords = BigInt(artifacts) * 6n + BigInt(request.packaged.files.length) * 2n + 64n;
  return (
    2n * packagedBytes +
    2n * BigInt(request.manifestBytes.byteLength) +
    2n * BigInt(MAX_JOURNAL_BYTES) +
    ENVELOPE_RECORD_BYTES * envelopeRecords
  );
}

function admitMigration(request: ManifestMigrationRequestV1): AdmittedMigrationV1 {
  const manifest = validateMigratableManifestV1(request.manifestBytes, request.manifestAdmission);
  if (request.foundationState !== "complete") refuse();
  const paths = migrationPaths(request);
  if (
    request.productDirectories.some((path) => path === paths.activationRecord) ||
    request.productReservations.some((path) => path === paths.activationRecord)
  ) refuse();
  const reserved = reservedV2Paths(request, paths).map(fold);
  for (const artifact of manifest.artifacts) {
    const claim = fold(artifact.path);
    if (reserved.some((path) => claim === path || claim.startsWith(`${path}/`))) refuse();
  }
  if (projectedBytes(request, manifest.artifacts.length) > BigInt(request.availableBytes)) refuse();
  return { manifest, v1ManifestHash: rawHash(request.manifestBytes), paths };
}

interface MigrationPreimageV1 {
  readonly artifactOrdinal: number;
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

async function readAuthorities(
  request: ManifestMigrationRequestV1,
  admitted: AdmittedMigrationV1,
): Promise<readonly MigrationPreimageV1[]> {
  const ownerUid = request.bootstrapIdentity.ownerUid;
  const preimages: MigrationPreimageV1[] = [];
  for (const [artifactOrdinal, artifact] of admitted.manifest.artifacts.entries()) {
    const path = artifact.path as CanonicalAbsolutePathV1;
    const observed = await request.read({ authority: "managed", artifactOrdinal, path });
    if (artifact.kind === "directory") {
      if (observed.kind !== "directory" || observed.ownerUid !== ownerUid) refuse();
      continue;
    }
    if (
      observed.kind !== "regular_file" ||
      observed.ownerUid !== ownerUid ||
      observed.mode !== 0o600 ||
      observed.sha256 !== artifact.installedHash ||
      observed.bytes > MAX_FOUNDATION_CONTENT_BYTES
    ) refuse();
    preimages.push({
      artifactOrdinal,
      path,
      ownerUid,
      mode: 0o600,
      nlink: 1,
      bytes: observed.bytes,
      sha256: observed.sha256,
      dev: observed.dev,
      ino: observed.ino,
    });
  }
  for (const [artifactOrdinal, artifact] of admitted.manifest.artifacts.entries()) {
    if (!artifact.existedBefore) continue;
    const path = `${request.manifestAdmission.backupRoot}/${String(artifact.backupRelativePath)}` as CanonicalAbsolutePathV1;
    const observed = await request.read({ authority: "backup", artifactOrdinal, path });
    if (
      observed.kind !== "regular_file" ||
      observed.ownerUid !== ownerUid ||
      observed.sha256 !== artifact.beforeHash
    ) refuse();
  }
  if (preimages.length < 1 || preimages.length > MAX_FOUNDATION_MUTATIONS * MAX_FOUNDATION_PAIRS) refuse();
  return preimages.toSorted((left, right) => compareUtf8(left.path, right.path));
}

interface PlannedRowV1 {
  readonly kind: "directory" | "file";
  readonly path: CanonicalAbsolutePathV1;
  readonly payload?: BootstrapExpectedPayloadRefV1;
}

class MigrationPlanBuilder {
  readonly #request: ManifestMigrationRequestV1;
  readonly #admitted: AdmittedMigrationV1;
  readonly #payloads: BootstrapPayloadPlanV1[] = [];

  constructor(request: ManifestMigrationRequestV1, admitted: AdmittedMigrationV1) {
    this.#request = request;
    this.#admitted = admitted;
  }

  get payloads(): readonly BootstrapPayloadPlanV1[] {
    return this.#payloads;
  }

  add(source: BootstrapPayloadSourceV1, bytes: number, hash: LowerHexSha256, mode: 0o600 | 0o700): BootstrapExpectedPayloadRefV1 {
    const ordinal = this.#payloads.length;
    const ref: BootstrapExpectedPayloadRefV1 = {
      kind: "bootstrap_expected",
      bootstrapId: this.#request.id,
      ordinal,
      path: deriveBootstrapPayloadPath(this.#admitted.paths.productHome, "v1_to_v2", this.#request.id as never, ordinal),
      hash,
      bytes,
      mode,
    };
    this.#payloads.push({ ref, source });
    return ref;
  }

  derived(
    role: Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }>["role"],
    value: CanonicalJsonValue,
    bytes: Uint8Array,
  ): BootstrapExpectedPayloadRefV1 {
    const source: BootstrapPayloadSourceV1 = {
      kind: "plan_derived",
      role,
      value,
      valueBytes: bytes.byteLength - 1,
      projectionHash: canonicalHash(`developer-os/bootstrap-plan-derived/${role}/v1\0`, { role, value }),
    };
    return this.add(source, bytes.byteLength, rawHash(bytes), 0o600);
  }

  derivedCanonical(
    role: Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }>["role"],
    value: CanonicalJsonValue,
  ): BootstrapExpectedPayloadRefV1 {
    return this.derived(role, value, encoder.encode(encodeCanonicalJson(value)));
  }

  preimage(preimage: MigrationPreimageV1): BootstrapExpectedPayloadRefV1 {
    const source: BootstrapPayloadSourceV1 = {
      kind: "guarded_migration_preimage",
      authority: {
        kind: "v1_managed_artifact",
        migrationId: this.#request.id,
        artifactOrdinal: preimage.artifactOrdinal,
        installedHash: preimage.sha256,
      },
      path: preimage.path,
      ownerUid: preimage.ownerUid,
      mode: preimage.mode,
      nlink: 1,
      bytes: preimage.bytes,
      sha256: preimage.sha256,
      dev: preimage.dev,
      ino: preimage.ino,
    };
    return this.add(source, preimage.bytes, preimage.sha256, 0o600);
  }

  packageFile(relativePath: string): BootstrapExpectedPayloadRefV1 {
    const file = this.#request.packaged.files.find((candidate) => candidate.relativePath === relativePath);
    if (file === undefined) refuse();
    const packaged = this.#request.packaged;
    const source: BootstrapPayloadSourceV1 = {
      kind: "guarded_package_file",
      packageRoot: packaged.packageRoot,
      packageRootDev: packaged.packageRootDev,
      packageRootIno: packaged.packageRootIno,
      packageInventoryHash: packaged.packageInventoryHash,
      relativePath: relativePath as VaultFreeRelativePathV1,
      sourceBytes: file.bytes,
      sourceHash: file.sha256,
      sourceMode: file.mode,
      sourceDev: file.dev,
      sourceIno: file.ino,
    };
    return this.add(source, file.bytes, file.sha256, file.mode);
  }

  emptyReservation(): BootstrapExpectedPayloadRefV1 {
    return this.add({ kind: "constant_empty", role: "empty_reservation" }, 0, rawHash(new Uint8Array()), 0o600);
  }
}

function journalValue(
  participantId: string,
  slot: FoundationParticipantRefV2["slot"],
  mutations: readonly FoundationMutationRefV1[],
  createdAt: UtcTimestampV1,
): { readonly value: CanonicalJsonValue; readonly bytes: Uint8Array } {
  const value = {
    schemaVersion: 1,
    id: participantId,
    kind: slot,
    phase: "planned",
    createdAt,
    updatedAt: createdAt,
    mutations: mutations.map((mutation, ordinal) => ({
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      stagedRelativePath: mutation.operation === "remove" ? null : `${String(ordinal)}.bin`,
    })),
  } as const;
  return { value, bytes: encoder.encode(`${JSON.stringify(value)}\n`) };
}

function participantPlanHash(
  participant: Omit<FoundationParticipantRefV2, "planHash">,
): LowerHexSha256 {
  const staged = participant.initialJournal.staged;
  return canonicalHash("developer-os/foundation-participant-plan/v2\0", {
    schemaVersion: 2,
    id: participant.id,
    slot: participant.slot,
    role: participant.role,
    mutations: participant.mutations,
    maximumJournalBytes: participant.maximumJournalBytes,
    initialJournal: {
      finalPath: participant.initialJournal.finalPath,
      staged: {
        kind: staged.kind,
        bootstrapId: staged.bootstrapId,
        ordinal: staged.ordinal,
        path: staged.path,
        bytes: staged.bytes,
        mode: staged.mode,
      },
    },
  } as unknown as CanonicalJsonValue);
}

interface FoundationPartitionV1 {
  readonly participants: readonly FoundationParticipantRefV2[];
  readonly stagedRows: readonly PlannedRowV1[];
  readonly stagingDirectories: readonly CanonicalAbsolutePathV1[];
  readonly forwardIds: readonly string[];
}

/**
 * Every managed regular file is republished from its own guarded preimage. That
 * is what lets a pre-point-of-no-return failure restore byte-identical V1 state
 * through the paired compensation transaction: Spec 2 §6.3 requires the V1
 * manifest **and every preimage** restored, and §5.1's migration arm accepts no
 * other content source.
 */
function buildFoundation(
  request: ManifestMigrationRequestV1,
  admitted: AdmittedMigrationV1,
  builder: MigrationPlanBuilder,
  preimages: readonly MigrationPreimageV1[],
): FoundationPartitionV1 {
  const uuid = String(request.id).slice(3);
  const transactionsRoot = `${admitted.paths.stagingRoot}/transactions`;
  const participants: FoundationParticipantRefV2[] = [];
  const stagedRows: PlannedRowV1[] = [];
  const stagingDirectories: CanonicalAbsolutePathV1[] = [];
  const forwardIds: string[] = [];
  const pairs = Math.ceil(preimages.length / MAX_FOUNDATION_MUTATIONS);
  if (pairs > MAX_FOUNDATION_PAIRS) refuse();

  for (let pair = 0; pair < pairs; pair += 1) {
    const encoded = String(pair).padStart(10, "0");
    const forwardId = `tx_mm_${uuid}_${encoded}_f` as FoundationTransactionIdV2;
    const compensationId = `tx_mm_${uuid}_${encoded}_c` as FoundationTransactionIdV2;
    const group = preimages.slice(pair * MAX_FOUNDATION_MUTATIONS, (pair + 1) * MAX_FOUNDATION_MUTATIONS);
    const mutationsFor = (
      participantId: FoundationTransactionIdV2,
      ordered: readonly MigrationPreimageV1[],
    ): readonly FoundationMutationRefV1[] =>
      ordered.map((preimage, ordinal) => {
        const stagedPath = `${transactionsRoot}/${participantId}/${String(ordinal)}.bin` as CanonicalAbsolutePathV1;
        const content = builder.preimage(preimage);
        const digest = builder.derived(
          "foundation_staged_digest",
          preimage.sha256,
          encoder.encode(`${preimage.sha256}\n`),
        );
        stagedRows.push({ kind: "file", path: stagedPath, payload: content });
        stagedRows.push({ kind: "file", path: `${stagedPath}.sha256` as CanonicalAbsolutePathV1, payload: digest });
        return {
          targetPath: preimage.path,
          operation: "replace",
          expectedBeforeHash: preimage.sha256,
          contentHash: preimage.sha256,
          contentSize: preimage.bytes,
          stagedPath,
          content,
          digest,
        };
      });

    const forwardMutations = mutationsFor(forwardId, group);
    const compensationMutations = mutationsFor(compensationId, [...group].reverse());
    stagingDirectories.push(
      `${transactionsRoot}/${compensationId}` as CanonicalAbsolutePathV1,
      `${transactionsRoot}/${forwardId}` as CanonicalAbsolutePathV1,
    );

    for (const [participantId, role, mutations] of [
      [compensationId, { kind: "compensation", forwardId } as const, compensationMutations],
      [forwardId, { kind: "forward", compensationId } as const, forwardMutations],
    ] as const) {
      const journal = journalValue(participantId, "v1_migration_artifacts", mutations, request.plannedAt);
      const staged = builder.derived("foundation_initial_journal", journal.value, journal.bytes);
      const base = {
        id: participantId,
        slot: "v1_migration_artifacts" as const,
        role,
        mutations,
        maximumJournalBytes: MAX_JOURNAL_BYTES,
        initialJournal: {
          finalPath: `${admitted.paths.transactions}/${participantId}.json` as CanonicalAbsolutePathV1,
          plannedBytesHash: staged.hash,
          staged,
        },
      };
      participants.push({ ...base, planHash: participantPlanHash(base) });
    }
    forwardIds.push(forwardId);
  }
  return { participants, stagedRows, stagingDirectories, forwardIds };
}

interface LaunchabilityPartitionV1 {
  readonly rows: readonly PlannedRowV1[];
  readonly bundleFiles: ReadonlyMap<string, string>;
}

function buildLaunchability(
  request: ManifestMigrationRequestV1,
  admitted: AdmittedMigrationV1,
  builder: MigrationPlanBuilder,
): LaunchabilityPartitionV1 {
  const packaged = request.packaged;
  const paths = admitted.paths;
  const bundleFiles = packaged.files
    .filter((file) => file.relativePath.startsWith(`${packaged.bundleRoot}/`))
    .toSorted((left, right) => compareUtf8(left.relativePath, right.relativePath));
  if (bundleFiles.length < 1) refuse();
  const inferred = new Set<string>();
  for (const file of bundleFiles) {
    let parent = dirname(file.relativePath.slice(packaged.bundleRoot.length + 1));
    while (parent !== ".") {
      inferred.add(`${paths.bundleRoot}/${parent}`);
      parent = dirname(parent);
    }
  }
  const rows: PlannedRowV1[] = [
    paths.releaseRoot,
    paths.versionRoot,
    paths.bundleRoot,
    ...[...inferred].toSorted(compareUtf8),
    paths.metadataRoot,
  ].map((path) => ({ kind: "directory", path: path as CanonicalAbsolutePathV1 }));

  const sources = new Map<string, string>();
  for (const file of bundleFiles) {
    const path = `${paths.bundleRoot}/${file.relativePath.slice(packaged.bundleRoot.length + 1)}`;
    sources.set(path, file.relativePath);
    rows.push({ kind: "file", path: path as CanonicalAbsolutePathV1, payload: builder.packageFile(file.relativePath) });
  }
  for (const relativePath of [
    packaged.retainedMetadata.delegation,
    packaged.retainedMetadata.releaseIndex,
    packaged.retainedMetadata.bundleManifest,
  ]) {
    const path = `${paths.metadataRoot}/${relativePath.split("/").at(-1) ?? relativePath}`;
    sources.set(path, relativePath);
    rows.push({ kind: "file", path: path as CanonicalAbsolutePathV1, payload: builder.packageFile(relativePath) });
  }
  const identity = packaged.identity;
  rows.push({
    kind: "file",
    path: paths.releaseTrust,
    payload: builder.derivedCanonical("release_trust", {
      schemaVersion: 1,
      highestDelegationSequence: identity.delegationSequence,
      delegationHash: identity.delegationHash,
      delegatedReleaseKeyId: identity.delegatedReleaseKeyId,
      highestReleaseIndexSequence: identity.releaseIndexSequence,
      releaseIndexHash: identity.releaseIndexHash,
      highestAcceptedReleaseSequence: identity.releaseSequence,
      releaseIdentityHash: identity.releaseIdentityHash,
    }),
  });
  rows.push({
    kind: "file",
    path: paths.activeRelease,
    payload: builder.derivedCanonical("active_release", {
      schemaVersion: 1,
      version: identity.version,
      releaseSequence: identity.releaseSequence,
      releaseIdentityHash: identity.releaseIdentityHash,
      delegationSequence: identity.delegationSequence,
      delegationHash: identity.delegationHash,
      releaseIndexSequence: identity.releaseIndexSequence,
      releaseIndexHash: identity.releaseIndexHash,
      bundleManifestHash: identity.bundleManifestHash,
      bundleRoot: paths.bundleRoot,
      platform: identity.platform,
      architecture: identity.architecture,
      launcherProtocol: identity.launcherProtocol,
      updateProtocol: identity.updateProtocol,
      activatedAt: request.plannedAt,
    }),
  });
  return { rows, bundleFiles: sources };
}

/**
 * `offset` maps a row's index inside `rows` onto its ordinal in the published
 * partition. Ordinary rows start at one because `createdPaths[0]` is reserved
 * for the permanent global-lock transition.
 */
function plannedCreatedPaths(
  request: ManifestMigrationRequestV1,
  rows: readonly PlannedRowV1[],
  scope: "ordinary" | "launchability",
  offset: number,
  earlier: ReadonlyMap<string, number>,
): readonly PlannedCreatedPathV1[] {
  const preexisting = new Map(request.preexistingParents.map((parent) => [parent.path as string, parent] as const));
  const localOrdinals = new Map(rows.map((row, ordinal) => [row.path as string, ordinal] as const));
  const ownerUid = request.bootstrapIdentity.ownerUid;
  return rows.map((row, ordinal): PlannedCreatedPathV1 => {
    const parentPath = dirname(row.path);
    const localOrdinal = localOrdinals.get(parentPath);
    const earlierOrdinal = earlier.get(parentPath);
    const parent = localOrdinal !== undefined && localOrdinal < ordinal
      ? { kind: "created_path" as const, scope, ordinal: localOrdinal + offset }
      : earlierOrdinal !== undefined
        ? { kind: "created_path" as const, scope: "ordinary" as const, ordinal: earlierOrdinal }
        : (() => {
            const identity = preexisting.get(parentPath);
            if (identity === undefined) refuse();
            return { kind: "preexisting" as const, path: identity.path, dev: identity.dev, ino: identity.ino };
          })();
    if (row.kind === "directory") {
      return { kind: "directory", path: row.path, expectedBefore: "absent", ownerUid, mode: 0o700, parent, cleanup: "remove_on_compensation" };
    }
    if (row.payload === undefined) refuse();
    return { kind: "file", path: row.path, expectedBefore: "absent", ownerUid, payload: row.payload, parent, cleanup: "remove_on_compensation" };
  });
}

function additionFor(
  request: ManifestMigrationRequestV1,
  admitted: AdmittedMigrationV1,
  planned: PlannedCreatedPathV1,
  payloadSources: ReadonlyMap<string, BootstrapPayloadSourceV1>,
  packagedSources: ReadonlyMap<string, string>,
): ManagedArtifactV2 {
  const paths = admitted.paths;
  const base = {
    owner: "core" as const,
    path: planned.path,
    productVersion: request.packaged.identity.version as StableSemverV1,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    mergeStrategy: "dedicated" as const,
    verifiedAt: request.plannedAt,
  };
  if (planned.kind === "directory") {
    return { ...base, source: "generated/directory" as BoundedArtifactSourceV1, kind: "directory", verification: { mode: "content" } };
  }
  if (planned.kind === "global_lock") {
    return { ...base, source: "generated/global-lock" as BoundedArtifactSourceV1, kind: "file", verification: { mode: "ephemeral" } };
  }
  const source = payloadSources.get(planned.payload.path);
  if (source === undefined) refuse();
  if (source.kind === "constant_empty") {
    return {
      ...base,
      source: `generated/reservations/${rawHash(planned.path)}` as BoundedArtifactSourceV1,
      kind: "file",
      verification: { mode: "ephemeral" },
    };
  }
  const packagedSource = packagedSources.get(planned.path);
  const name = source.kind === "guarded_package_file"
    ? (packagedSource ?? source.relativePath)
    : source.kind === "plan_derived"
      ? `generated/${source.role}`
      : "generated/migration-preimage";
  const schemaId = planned.path === paths.idAllocator
    ? "lifecycle-id-allocator-v1"
    : planned.path === paths.activeRelease
      ? "active-release-record-v1"
      : planned.path === paths.releaseTrust
        ? "release-trust-state-v1"
        : null;
  return schemaId === null
    ? { ...base, source: name as BoundedArtifactSourceV1, kind: "file", verification: { mode: "content", installedHash: planned.payload.hash } }
    : { ...base, source: name as BoundedArtifactSourceV1, kind: "file", verification: { mode: "schema", schemaId, installedHash: planned.payload.hash } };
}

function buildManifestState(
  request: ManifestMigrationRequestV1,
  admitted: AdmittedMigrationV1,
  forwardIds: readonly string[],
  after: BootstrapExpectedPayloadRefV1,
): ManifestStatePlanV1 {
  const ownerUid = request.bootstrapIdentity.ownerUid;
  return {
    schemaVersion: 1,
    participantId: `mf_${request.id}`,
    envelope: { kind: "v1_migration", id: request.id },
    bindings: {
      foundationTransactions: {
        count: forwardIds.length,
        orderedIdsHash: createHash("sha256")
          .update("developer-os/manifest-foundation-bindings/v1\0")
          .update(JSON.stringify(forwardIds))
          .digest("hex"),
      },
      externalEffects: [],
    },
    manifestPath: request.manifestPath,
    tombstonePath: `${dirname(request.manifestPath)}/.installation-manifest.mf_${request.id}.json.tombstone`,
    before: {
      state: "present",
      hash: admitted.v1ManifestHash,
      bytes: null,
      ownerUid,
      mode: 0o600,
      nlink: 1,
      size: String(request.manifestBytes.byteLength),
      dev: request.manifestIdentity.dev,
      ino: request.manifestIdentity.ino,
    },
    after: {
      state: "present",
      hash: after.hash,
      bytes: after,
      ownerUid,
      mode: 0o600,
      nlink: 1,
      size: String(after.bytes),
      dev: null,
      ino: null,
    },
    maximumPlanBytes: MANIFEST_PLAN_BYTES,
    maximumJournalBytes: MAX_JOURNAL_BYTES,
  } as unknown as ManifestStatePlanV1;
}

/**
 * The exact capacity projection, recomputed once the plan's real payload set is
 * known. `admitMigration` runs the coarse packaged-release projection before a
 * single artifact byte is opened; this one closes the gap the pre-read estimate
 * cannot cover.
 */
function admitAggregate(
  request: ManifestMigrationRequestV1,
  payloads: readonly BootstrapPayloadPlanV1[],
  created: readonly PlannedCreatedPathV1[],
  participants: number,
): number {
  const aggregate = 2 * payloads.length + 3 * created.length + 5 + 2 * participants;
  if (aggregate > MAX_STAGING_ENTRIES) refuse();
  const required =
    2n * payloads.reduce((total, row) => total + BigInt(row.ref.bytes), 0n) +
    2n * BigInt(request.manifestBytes.byteLength) +
    2n * BigInt(MAX_JOURNAL_BYTES) +
    ENVELOPE_RECORD_BYTES * BigInt(aggregate);
  if (required > BigInt(request.availableBytes)) refuse();
  return aggregate;
}

export async function planManifestMigration(
  request: ManifestMigrationRequestV1,
): Promise<ManifestMigrationPlanV1> {
  const admitted = admitMigration(request);
  const preimages = await readAuthorities(request, admitted);
  const paths = admitted.paths;
  const builder = new MigrationPlanBuilder(request, admitted);
  const foundation = buildFoundation(request, admitted, builder, preimages);
  const envelope = deriveBootstrapEnvelopePaths(paths.productHome, "v1_to_v2", request.id);

  const nonceRef = builder.derived(
    "lifecycle_nonce",
    request.nonce,
    encoder.encode(`${request.nonce}\n`),
  );
  const allocatorRef = builder.derivedCanonical("lifecycle_allocator", {
    schemaVersion: 1,
    installNonce: request.nonce,
    nextCounter: "0",
  });

  const preexisting = new Set(request.preexistingParents.map((parent) => parent.path as string));
  const stagingChain = [
    paths.stagingRoot,
    `${paths.stagingRoot}/manifest-migration` as CanonicalAbsolutePathV1,
    envelope.stagingRoot,
    `${paths.stagingRoot}/transactions` as CanonicalAbsolutePathV1,
    ...foundation.stagingDirectories,
  ];
  const directories = [...request.productDirectories, paths.transactions, ...stagingChain]
    .filter((path) => !preexisting.has(path));
  const ordinaryRows: readonly PlannedRowV1[] = ([
    ...new Map(directories.map((path): readonly [string, PlannedRowV1] => [path, { kind: "directory", path }])).values(),
    { kind: "file", path: paths.installNonce, payload: nonceRef },
    { kind: "file", path: paths.idAllocator, payload: allocatorRef },
    ...request.productReservations.map((path): PlannedRowV1 => ({ kind: "file", path, payload: builder.emptyReservation() })),
    ...foundation.stagedRows,
  ] satisfies readonly PlannedRowV1[]).toSorted((left, right) => compareUtf8(left.path, right.path));

  const globalLock: PlannedCreatedPathV1 = {
    kind: "global_lock",
    path: paths.globalLock,
    expectedBefore: "absent",
    ownerUid: request.bootstrapIdentity.ownerUid,
    mode: 0o600,
    parent: (() => {
      const identity = request.preexistingParents.find((parent) => parent.path === paths.stateRoot);
      if (identity === undefined) refuse();
      return { kind: "preexisting", path: identity.path, dev: identity.dev, ino: identity.ino };
    })(),
    cleanup: "remove_on_compensation",
  };
  const createdPaths = [
    globalLock,
    ...plannedCreatedPaths(request, ordinaryRows, "ordinary", 1, new Map()),
  ];
  const launchability = buildLaunchability(request, admitted, builder);
  const launchabilityPaths = plannedCreatedPaths(
    request,
    launchability.rows,
    "launchability",
    0,
    new Map(createdPaths.map((planned, ordinal) => [planned.path as string, ordinal] as const)),
  );

  const payloadSources = new Map(builder.payloads.map((row) => [row.ref.path as string, row.source] as const));
  const additions = [...createdPaths, ...launchabilityPaths]
    .filter((planned) => planned.path !== paths.stagingRoot && !planned.path.startsWith(`${paths.stagingRoot}/`))
    .map((planned) => additionFor(request, admitted, planned, payloadSources, launchability.bundleFiles));
  const v2Manifest = validateManifestV2(
    mapManifestV1ToV2(admitted.manifest, additions),
    request.manifestAdmission,
  );
  const manifestRef = builder.derivedCanonical("manifest_after", v2Manifest as unknown as CanonicalJsonValue);

  const manifestState = buildManifestState(request, admitted, foundation.forwardIds, manifestRef);
  const payloads = builder.payloads;
  const aggregate = admitAggregate(request, payloads, [
    ...createdPaths,
    ...launchabilityPaths,
  ], foundation.participants.length);

  const candidate = {
    schemaVersion: 1,
    operation: "v1_to_v2",
    id: request.id,
    admittedExternalShapeHash: bootstrapExternalShapeHash(request.externalShape, "v1_to_v2"),
    admittedPreexistingPaths: request.admittedPreexistingPaths,
    v1ManifestHash: admitted.v1ManifestHash,
    v2ManifestHash: manifestRef.hash,
    bootstrapIdentity: request.bootstrapIdentity,
    paths: { plan: envelope.plan, stagingRoot: envelope.stagingRoot },
    journalSlots: envelope.journalSlots.map((path, slot) => ({
      slot,
      path,
      ownerUid: request.bootstrapIdentity.ownerUid,
      mode: 0o600,
      nlink: 1,
      dev: (request.journalSlots[slot] as ManifestMigrationIdentityV1).dev,
      ino: (request.journalSlots[slot] as ManifestMigrationIdentityV1).ino,
    })),
    maximumPlanBytes: MAX_PLAN_BYTES,
    maximumJournalBytes: MAX_JOURNAL_BYTES,
    maximumStagingEntries: aggregate,
    payloads,
    createdPaths,
    foundationParticipants: foundation.participants,
    launchabilityPaths,
    manifest: manifestState,
  };
  return validateBootstrapPlan(candidate, {
    ...request.admission,
    operation: "v1_to_v2",
    id: request.id,
    bootstrapIdentity: request.bootstrapIdentity,
    externalShape: request.externalShape,
  }) as ManifestMigrationPlanV1;
}
