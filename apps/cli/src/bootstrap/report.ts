import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import {
  BOOTSTRAP_RETAINED_MAX_ENTRIES,
  BOOTSTRAP_RETAINED_MAX_IDS,
  BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES,
  assertBootstrapRetentionCapacity,
  classifyBootstrapEvidence,
  decodeCanonicalJson,
  deriveBootstrapCreationEvidencePaths,
  deriveBootstrapEnvelopePaths,
  deriveBootstrapRetentionAuthorities,
  deriveBootstrapRetentionLocations,
  deriveBootstrapRetentionTable,
  encodeCanonicalJson,
  hashBytes,
  selectBootstrapJournal,
  validateBootstrapJournal,
  validateBootstrapPayloadEvidence,
  validateBootstrapPlan,
  validateCreatedPathEvidence,
  validateJournal,
  validateManifestStatePlan,
  validateManifestV2,
} from "@developer-os/core";
import type {
  BootstrapEvidenceSummaryV1,
  BootstrapExecutionPlanV1,
  BootstrapJournalRecordV1,
  BootstrapJournalSelectionV1,
  BootstrapPlanAdmissionContextV1,
  BootstrapRetentionEvidenceProjectionV1,
  BootstrapRetentionPostimageV1,
  BootstrapPayloadEvidenceV1,
  CreatedPathEvidenceV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  FreshV2InitIdV1,
  FreshV2InitPlanV1,
  FoundationParticipantRefV2,
  LowerHexSha256,
  ManifestStatePlanAdmissionContextV1,
  PlannedCreatedPathV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import { projectBootstrapRetentionPostimage } from "./retention.js";

const MAX_PLAN_BYTES = 268_435_456;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_CREATED_PATHS = 1_000_000;
const MAX_LAUNCHABILITY_PATHS = 200_006;
const MAX_FOUNDATION_PARTICIPANTS = 512;
const FRESH_ID = "fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RETAINED_ID = "(?:fi|mm)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const FRESH_PLAN = new RegExp(`^fresh-v2-init\\.(${FRESH_ID})\\.plan\\.json$`, "u");
const FRESH_SLOT = new RegExp(`^fresh-v2-init\\.(${FRESH_ID})\\.journal\\.([01])\\.json$`, "u");
const RETAINED = new RegExp(`^\\.developer-os-retained\\.(${RETAINED_ID})\\.([0-9]{10})\\.tombstone$`, "u");
const encoder = new TextEncoder();

export interface BootstrapEvidenceReportV1 {
  readonly schemaVersion: 1;
  readonly ids: readonly BootstrapEvidenceSummaryV1[];
  readonly aggregate: {
    readonly idCount: number;
    readonly entryCount: number;
    readonly regularFileBytes: UInt64DecimalV1;
  };
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
  readonly projectPostimage: (
    path: CanonicalAbsolutePathV1,
  ) => Promise<BootstrapRetentionPostimageV1 | null>;
}

export interface BootstrapEvidenceAdmissionV1 {
  readonly report: BootstrapEvidenceReportV1;
  /** Internal identity-bound authority. Public summary/status values never substitute for this. */
  readonly active: {
    readonly plan: FreshV2InitPlanV1;
    /** Null when the plan is published but no journal slot has been written yet. */
    readonly journal: BootstrapJournalSelectionV1 | null;
  } | null;
  readonly retainedPaths: readonly CanonicalAbsolutePathV1[];
  /** Exact parent identities derived from fully admitted terminal retention tables. */
  readonly retainedParentAuthorities: readonly {
    readonly path: CanonicalAbsolutePathV1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  }[];
  /** Exact live global-lock identity retained by a fully admitted rolled-back envelope. */
  readonly reusableGlobalLock: {
    readonly path: CanonicalAbsolutePathV1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  } | null;
  readonly fingerprint: LowerHexSha256;
  readonly blocksNewIntent: boolean;
  /** Test-facing only: the exact retained-table derivation input/output per verified envelope. */
  readonly retainedEnvelopes: readonly {
    readonly plan: FreshV2InitPlanV1;
    readonly terminalJournal: BootstrapJournalRecordV1;
    readonly evidence: BootstrapRetentionEvidenceProjectionV1;
  }[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedArray(value: unknown, minimum: number, maximum: number): readonly unknown[] | null {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum ? value : null;
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function lowerHash(value: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

/**
 * Scoped to one inspection call: a cache that survived past it would hand back
 * a postimage taken before a later change the double read inside
 * `projectPostimage` exists to catch, turning that safety check into a source
 * of stale answers.
 */
function memoizePostimageProjector(
  project: BootstrapEvidenceInspectionRequestV1["projectPostimage"],
): BootstrapEvidenceInspectionRequestV1["projectPostimage"] {
  const cache = new Map<CanonicalAbsolutePathV1, Promise<BootstrapRetentionPostimageV1 | null>>();
  return (path) => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const projected = project(path);
    cache.set(path, projected);
    return projected;
  };
}

function pathEvidence() {
  return {
    reopenCanonicalAbsolutePath: (path: string) => resolve(path),
    containsCanonicalPath: (root: string, candidate: string) =>
      candidate === root || candidate.startsWith(`${root}/`),
    hasFoldedAlias: () => false,
  };
}

function manifestPlanAdmission(
  plan: FreshV2InitPlanV1,
  productHome: CanonicalAbsolutePathV1,
): ManifestStatePlanAdmissionContextV1 {
  const forwardIds = plan.foundationParticipants
    .filter((participant) => participant.role.kind === "forward")
    .map((participant) => participant.id);
  return {
    evidence: pathEvidence(),
    productHome,
    manifestPath: join(productHome, "installation-manifest.json") as CanonicalAbsolutePathV1,
    foundationTransactionIds: forwardIds,
    externalEffects: [],
    admitParticipant: (envelope, participantId) =>
      envelope.kind === "fresh_v2_init" && envelope.id === plan.id && participantId === `mf_${plan.id}`
        ? participantId as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>
        : "mf_refused" as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>,
    admitExternalEffect: () => "refused",
    bootstrapPayloadIdentity: (ref) =>
      plan.payloads.some((row) => sameValue(row.ref, ref))
        ? { dev: "1", ino: "1" } as NonNullable<ReturnType<NonNullable<ManifestStatePlanAdmissionContextV1["bootstrapPayloadIdentity"]>>>
        : null,
  };
}

function planAdmission(
  plan: FreshV2InitPlanV1,
  productHome: CanonicalAbsolutePathV1,
  stateDirectory: CanonicalAbsolutePathV1,
): BootstrapPlanAdmissionContextV1 {
  return {
    evidence: pathEvidence(),
    productHome,
    stateRoot: stateDirectory,
    productStagingRoot: join(productHome, "staging") as CanonicalAbsolutePathV1,
    operation: "fresh_v2_init",
    id: plan.id,
    bootstrapIdentity: plan.bootstrapIdentity,
    externalShape: null,
    admitFreshRecoveryExternalShape: (hash, identity) =>
      hash === plan.admittedExternalShapeHash && sameValue(identity, plan.bootstrapIdentity) ? hash : "refused",
    admitPayloadSource: (source, ref) => {
      const found = plan.payloads.find((row) => sameValue(row.ref, ref) && sameValue(row.source, source));
      return structuredClone(found?.source ?? { kind: "constant_empty", role: "empty_reservation" });
    },
    admitPlannedCreatedPath: (candidate, scope, ordinal) => {
      const expected = scope === "ordinary" ? plan.createdPaths[ordinal] : plan.launchabilityPaths[ordinal];
      return structuredClone(expected !== undefined && sameValue(expected, candidate)
        ? expected
        : plan.createdPaths[0] as PlannedCreatedPathV1);
    },
    admitPreexistingParent: (candidate) => {
      const parents = [...plan.createdPaths, ...plan.launchabilityPaths]
        .map((planned) => planned.parent)
        .filter((parent) => parent.kind === "preexisting");
      const expected = parents.find((parent) => sameValue(parent, candidate));
      return structuredClone(expected ?? parents[0]) as ReturnType<BootstrapPlanAdmissionContextV1["admitPreexistingParent"]>;
    },
    admitFoundationParticipant: (candidate) => {
      const expected = plan.foundationParticipants.find((participant) => sameValue(participant, candidate));
      return structuredClone(expected ?? plan.foundationParticipants[0]) as FoundationParticipantRefV2;
    },
    admitManifestParticipant: (candidate) => validateManifestStatePlan(
      candidate,
      manifestPlanAdmission(plan, productHome),
    ),
    admitPlanDerivedValue: (role, value) => {
      const expected = plan.payloads.map((row) => row.source).find((source) =>
        source.kind === "plan_derived" && source.role === role && sameValue(source.value, value));
      return expected?.kind === "plan_derived" ? structuredClone(expected.value) : { refused: true };
    },
  };
}

/** The one structural/closure admission used by both reporting and executor recovery. */
export function admitBootstrapEvidencePlan(
  value: unknown,
  input: {
    readonly productHome: CanonicalAbsolutePathV1;
    readonly stateDirectory: CanonicalAbsolutePathV1;
    readonly expectedId: FreshV2InitIdV1;
  },
): FreshV2InitPlanV1 {
  const candidate = record(value);
  const payloads = boundedArray(candidate?.payloads, 1, BOOTSTRAP_RETAINED_MAX_ENTRIES);
  const createdPaths = boundedArray(candidate?.createdPaths, 1, MAX_CREATED_PATHS);
  const participants = boundedArray(candidate?.foundationParticipants, 2, MAX_FOUNDATION_PARTICIPANTS);
  const launchabilityPaths = boundedArray(candidate?.launchabilityPaths, 7, MAX_LAUNCHABILITY_PATHS);
  const slots = boundedArray(candidate?.journalSlots, 2, 2);
  const envelope = deriveBootstrapEnvelopePaths(input.productHome, "fresh_v2_init", input.expectedId);
  if (
    candidate === null || candidate.schemaVersion !== 1 || candidate.operation !== "fresh_v2_init" ||
    candidate.id !== input.expectedId || candidate.planPath !== envelope.plan ||
    candidate.stagingRoot !== envelope.stagingRoot || candidate.maximumPlanBytes !== MAX_PLAN_BYTES ||
    candidate.maximumJournalBytes !== MAX_JOURNAL_BYTES || payloads === null || createdPaths === null ||
    participants === null || launchabilityPaths === null || slots === null ||
    slots.some((slot, ordinal) => record(slot)?.path !== envelope.journalSlots[ordinal]) ||
    record(candidate.bootstrapIdentity)?.path !== join(input.stateDirectory, ".lifecycle-bootstrap.lock")
  ) throw new Error("persisted bootstrap plan failed bounded structural admission");
  const freshCandidate = candidate as unknown as FreshV2InitPlanV1;
  const admitted = validateBootstrapPlan(
    freshCandidate,
    planAdmission(freshCandidate, input.productHome, input.stateDirectory),
  );
  if (admitted.operation !== "fresh_v2_init") throw new Error("persisted bootstrap plan changed operation");
  return admitted;
}

function terminalJournal(current: BootstrapJournalRecordV1): BootstrapJournalRecordV1 | null {
  if (current.phase === "finalized" || current.phase === "rolled_back") return current;
  if (
    (current.phase !== "retaining" && current.phase !== "retained") ||
    current.retentionNext === null || current.terminalOutcome === null ||
    current.retentionTerminalPreimage === undefined
  ) return null;
  const sequence = BigInt(current.sequence) - BigInt(current.retentionNext) - 1n;
  if (sequence < 0n) return null;
  const { retentionTerminalPreimage, ...prefix } = current;
  return {
    ...prefix,
    slot: Number(sequence % 2n) as 0 | 1,
    sequence: sequence.toString() as UInt64DecimalV1,
    previousJournalHash: retentionTerminalPreimage.previousJournalHash,
    phase: current.terminalOutcome === "finalized" ? "finalized" : "rolled_back",
    retentionNext: null,
    updatedAt: retentionTerminalPreimage.updatedAt,
  };
}

export function selectBootstrapEvidenceJournal(
  plan: FreshV2InitPlanV1,
  values: readonly [unknown, unknown],
): BootstrapJournalSelectionV1 | null {
  const admitted = values.flatMap((value) => {
    try {
      return [validateBootstrapJournal(plan, value)];
    } catch {
      return [];
    }
  });
  admitted.sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? 1 : -1);
  const current = admitted[0];
  if (current === undefined || current.slot !== Number(BigInt(current.sequence) % 2n)) return null;
  const previous = admitted[1];
  if (
    previous !== undefined &&
    (BigInt(previous.sequence) + 1n !== BigInt(current.sequence) ||
      current.previousJournalHash !== lowerHash(encoder.encode(encodeCanonicalJson(previous as unknown as CanonicalJsonValue))))
  ) return null;
  return { current, inactiveSlot: current.slot === 0 ? 1 : 0 };
}

async function guardedValue<T>(
  request: BootstrapEvidenceInspectionRequestV1,
  path: CanonicalAbsolutePathV1,
  maximumBytes: number,
  admit: (value: unknown) => T,
): Promise<{
  readonly value: T;
  readonly evidenceIdentity: {
    readonly ownerUid: number;
    readonly mode: 0o600;
    readonly nlink: 1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
}> {
  const observed = await request.reader.inventoryExactNamespaces([path]);
  const file = observed.find((candidate) => candidate.path === path);
  if (file?.kind !== "regular_file" || file.mode !== 0o600 || file.nlink !== 1) throw new Error("retention evidence file changed shape");
  const bytes = await request.reader.readRegularFile(file, maximumBytes);
  return {
    value: admit(decodeCanonicalJson(bytes, maximumBytes)),
    evidenceIdentity: { ownerUid: file.ownerUid, mode: 0o600, nlink: 1, dev: file.dev, ino: file.ino },
  };
}

/** Complete retained-table projection shared by reporting and executor recovery. */
export async function buildBootstrapRetentionEvidence(
  request: BootstrapEvidenceInspectionRequestV1,
  plan: FreshV2InitPlanV1,
  terminal: BootstrapJournalRecordV1,
): Promise<BootstrapRetentionEvidenceProjectionV1> {
  const locations = deriveBootstrapRetentionLocations(plan, terminal);
  const physicalPath = async (logicalPath: CanonicalAbsolutePathV1): Promise<CanonicalAbsolutePathV1> => {
    const exact = locations.find((location) => location.sourcePath === logicalPath);
    const collapsed = locations.filter((location) =>
      location.collapsesDescendants && logicalPath.startsWith(`${location.sourcePath}/`),
    ).sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0];
    const retainedPath = exact?.tombstonePath ?? (collapsed === undefined
      ? null
      : `${collapsed.tombstonePath}${logicalPath.slice(collapsed.sourcePath.length)}` as CanonicalAbsolutePathV1);
    if (retainedPath === null) {
      if (await request.projectPostimage(logicalPath) === null) throw new Error("retention parent escaped its plan-derived table");
      return logicalPath;
    }
    const [source, retained] = await Promise.all([
      request.projectPostimage(logicalPath),
      request.projectPostimage(retainedPath),
    ]);
    if (source !== null && retained !== null && exact?.role === "bootstrap_lock" &&
      (source.dev !== plan.bootstrapIdentity.dev || source.ino !== plan.bootstrapIdentity.ino)) return retainedPath;
    if ((source === null) === (retained === null)) throw new Error("retention path is in a third state");
    return source === null ? retainedPath : logicalPath;
  };
  const retentionRow = async (
    role: BootstrapRetentionEvidenceProjectionV1["rows"][number]["role"],
    sourcePath: CanonicalAbsolutePathV1,
  ): Promise<BootstrapRetentionEvidenceProjectionV1["rows"][number]> => {
    const physical = await physicalPath(sourcePath);
    const physicalParent = await physicalPath(dirname(sourcePath) as CanonicalAbsolutePathV1);
    const [postimage, parent] = await Promise.all([
      request.projectPostimage(physical),
      request.projectPostimage(physicalParent),
    ]);
    if (postimage === null || parent?.kind !== "directory_tree") throw new Error("retention authority changed before projection");
    return {
      role,
      sourcePath,
      parent: { path: dirname(sourcePath) as CanonicalAbsolutePathV1, dev: parent.dev, ino: parent.ino },
      postimage,
    };
  };

  const payloadEvidence = [];
  for (let ordinal = 0; ordinal < terminal.nextPayload; ordinal += 1) {
    const row = plan.payloads[ordinal];
    if (row === undefined) throw new Error("payload evidence cursor escaped plan");
    payloadEvidence.push(await guardedValue<BootstrapPayloadEvidenceV1>(
      request,
      await physicalPath(`${row.ref.path}.json` as CanonicalAbsolutePathV1),
      plan.maximumJournalBytes,
      (value) => validateBootstrapPayloadEvidence(value, row.ref, row.source),
    ));
  }
  const createdPathEvidence = [];
  for (const scope of ["ordinary", "launchability"] as const) {
    const count = scope === "ordinary" ? terminal.nextCreatedPath : terminal.nextLaunchabilityPath;
    const plannedPaths = scope === "ordinary" ? plan.createdPaths : plan.launchabilityPaths;
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const planned = plannedPaths[ordinal];
      if (planned === undefined) throw new Error("creation evidence cursor escaped plan");
      const evidencePath = deriveBootstrapCreationEvidencePaths(
        request.productHome, "fresh_v2_init", plan.id, scope, ordinal,
        "00000000-0000-4000-8000-000000000000",
      ).evidence;
      createdPathEvidence.push(await guardedValue<CreatedPathEvidenceV1>(
        request,
        await physicalPath(evidencePath),
        plan.maximumJournalBytes,
        (value) => validateCreatedPathEvidence(value, planned, plan.id, scope, ordinal),
      ));
    }
  }
  const interrupted = terminal.payloadWriteState.state === "writing"
    ? {
        writeState: terminal.payloadWriteState,
        postimage: await request.projectPostimage(await physicalPath(
          plan.payloads[terminal.payloadWriteState.ordinal]?.ref.path as CanonicalAbsolutePathV1,
        )),
      }
    : null;
  if (interrupted !== null && interrupted.postimage?.kind !== "regular_file") throw new Error("interrupted payload postimage is absent");

  const foundationEvidence: BootstrapRetentionEvidenceProjectionV1["foundationEvidence"][number][] = [];
  const participants = plan.foundationParticipants.filter((participant) => terminal.nextFoundationParticipant > 0 &&
    (terminal.terminalOutcome === "rolled_back" || participant.role.kind === "forward"));
  for (const participant of participants) {
    const physical = await physicalPath(participant.initialJournal.finalPath);
    /** Deliberately unmemoized: this pair must observe the file, not a cached answer, across the read below. */
    const before = await projectBootstrapRetentionPostimage(physical);
    const observed = await request.reader.inventoryExactNamespaces([physical]);
    const file = observed.find((candidate) => candidate.path === physical);
    if (before?.kind !== "regular_file" || file?.kind !== "regular_file") throw new Error("Foundation terminal journal is absent");
    const bytes = await request.reader.readRegularFile(file, participant.maximumJournalBytes);
    const after = await projectBootstrapRetentionPostimage(physical);
    if (after?.kind !== "regular_file" || !sameValue(before, after)) throw new Error("Foundation terminal journal changed during projection");
    foundationEvidence.push({
      participantId: participant.id,
      value: validateJournal(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown),
      postimage: after,
    });
  }
  /**
   * `deriveBootstrapRetentionTable` checks evidence rows against the full,
   * uncollapsed authority set (BUG: it always did, but `rows` here used to
   * come from the collapsed `locations` — the physical rename set — so the
   * two could never agree once a directory authority had a tracked
   * descendant, e.g. Foundation-created subdirectories under a collapsed
   * root). `physicalPath` below still resolves through the collapsed
   * `locations` for tombstone redirection; only row construction needs the
   * uncollapsed set.
   */
  const authorities = deriveBootstrapRetentionAuthorities(plan, terminal);
  const rows: BootstrapRetentionEvidenceProjectionV1["rows"][number][] = [];
  for (const authority of authorities) {
    rows.push(await retentionRow(authority.role, authority.sourcePath));
  }
  const directoryRows = rows.filter((row) => row.postimage.kind === "directory_tree")
    .sort((left, right) => left.sourcePath.length - right.sourcePath.length);
  const maximalRoots = directoryRows.filter((row, index) => !directoryRows.slice(0, index)
    .some((parent) => row.sourcePath.startsWith(`${parent.sourcePath}/`)));
  return {
    bootstrapId: plan.id,
    terminalJournal: terminal,
    payloadEvidence,
    interruptedPayload: interrupted === null ? null : {
      writeState: interrupted.writeState,
      postimage: interrupted.postimage as Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>,
    },
    createdPathEvidence,
    foundationEvidence,
    directoryTrees: maximalRoots.map((row) => ({
      rootPath: row.sourcePath,
      entries: (row.postimage as Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>).entries ?? [],
    })),
    rows,
  };
}

function identityMatches(
  entry: BootstrapEvidenceGuardedEntryV1,
  expected: { readonly ownerUid: number; readonly mode: number; readonly nlink: number; readonly dev: string; readonly ino: string },
): boolean {
  return entry.ownerUid === expected.ownerUid && entry.mode === expected.mode && entry.nlink === expected.nlink &&
    entry.dev === expected.dev && entry.ino === expected.ino;
}

function idForPath(path: string): string | null {
  const stagingName = basename(path);
  const stagingId = new RegExp(`^(${FRESH_ID})$`, "u").exec(stagingName)?.[1];
  if (
    stagingId !== undefined && basename(dirname(path)) === "fresh-v2-init" &&
    basename(dirname(dirname(path))) === "staging"
  ) return stagingId;
  return FRESH_PLAN.exec(basename(path))?.[1] ?? FRESH_SLOT.exec(basename(path))?.[1] ?? RETAINED.exec(basename(path))?.[1] ??
    new RegExp(`\\.fresh-v2-init\\.(${FRESH_ID})\\.`, "u").exec(basename(path))?.[1] ?? null;
}

function sumEntries(entries: Iterable<BootstrapEvidenceGuardedEntryV1>): { readonly entries: number; readonly bytes: bigint } {
  let count = 0;
  let bytes = 0n;
  for (const candidate of entries) {
    count += 1;
    if (candidate.kind === "regular_file") bytes += BigInt(candidate.bytes);
  }
  return { entries: count, bytes };
}

async function exactV2Handoff(
  request: BootstrapEvidenceInspectionRequestV1,
  plan: FreshV2InitPlanV1,
): Promise<boolean> {
  const manifestPath = plan.manifest.manifestPath;
  try {
    const rows = await request.reader.inventoryExactNamespaces([manifestPath]);
    const file = rows.find((row) => row.path === manifestPath && row.kind === "regular_file");
    if (file === undefined || plan.manifest.after.state !== "present") return false;
    const bytes = await request.reader.readRegularFile(file, plan.manifest.maximumPlanBytes);
    if (hashBytes(bytes) !== plan.manifest.after.hash) return false;
    validateManifestV2(decodeCanonicalJson(bytes, plan.manifest.maximumPlanBytes), {
      evidence: pathEvidence(),
      sourceRoot: plan.payloads.find((row) => row.source.kind === "guarded_package_file")?.source.kind === "guarded_package_file"
        ? (plan.payloads.find((row) => row.source.kind === "guarded_package_file")?.source as { readonly packageRoot: CanonicalAbsolutePathV1 }).packageRoot
        : request.productHome,
      backupRoot: join(request.productHome, "backups") as CanonicalAbsolutePathV1,
      admitOwnerPath: (_owner, path) => path,
    });
    return true;
  } catch {
    return false;
  }
}

async function exactReusableGlobalLock(
  request: BootstrapEvidenceInspectionRequestV1,
  plan: FreshV2InitPlanV1,
  selection: BootstrapJournalSelectionV1,
  evidence: BootstrapRetentionEvidenceProjectionV1 | null,
): Promise<BootstrapEvidenceAdmissionV1["reusableGlobalLock"]> {
  if (
    selection.current.phase !== "retained" ||
    selection.current.terminalOutcome !== "rolled_back" ||
    evidence === null
  ) return null;
  const ordinal = plan.createdPaths.findIndex((planned) => planned.kind === "global_lock");
  const planned = plan.createdPaths[ordinal];
  const created = evidence.createdPathEvidence[ordinal]?.value;
  if (planned?.kind !== "global_lock" || created?.kind !== "global_lock") return null;
  const current = await request.projectPostimage(planned.path);
  if (
    current?.kind !== "regular_file" || current.ownerUid !== planned.ownerUid ||
    current.mode !== planned.mode || current.bytes !== "0" ||
    current.dev !== created.dev || current.ino !== created.ino
  ) return null;
  return { path: planned.path, dev: created.dev, ino: created.ino };
}

async function exactRestoredBase(
  request: BootstrapEvidenceInspectionRequestV1,
  plan: FreshV2InitPlanV1,
  locations: ReturnType<typeof deriveBootstrapRetentionLocations>,
  retained: readonly BootstrapEvidenceGuardedEntryV1[],
  confinedUnboundEntries: boolean,
  terminalOutcome: "finalized" | "rolled_back",
  reusableGlobalLock: BootstrapEvidenceAdmissionV1["reusableGlobalLock"],
): Promise<boolean> {
  if (!confinedUnboundEntries) return false;
  for (const location of locations) {
    if (location.role === "bootstrap_lock") {
      const source = retained.find((candidate) => candidate.path === location.sourcePath);
      if (source !== undefined && identityMatches(source, plan.bootstrapIdentity)) return false;
      continue;
    }
    if (retained.some((candidate) => candidate.path === location.sourcePath)) return false;
    if (location.collapsesDescendants && await request.projectPostimage(location.sourcePath) !== null) {
      return false;
    }
  }

  let manifestRows: readonly BootstrapEvidenceGuardedEntryV1[];
  try {
    manifestRows = await request.reader.inventoryExactNamespaces([plan.manifest.manifestPath]);
  } catch {
    return false;
  }
  const manifest = manifestRows.find((candidate) => candidate.path === plan.manifest.manifestPath);
  if (plan.manifest.before.state === "absent") {
    if (manifest !== undefined) return false;
  } else {
    if (manifest?.kind !== "regular_file") return false;
    try {
      const bytes = await request.reader.readRegularFile(manifest, plan.manifest.maximumPlanBytes);
      if (hashBytes(bytes) !== plan.manifest.before.hash) return false;
    } catch {
      return false;
    }
  }

  const config = plan.payloads.map((row) => row.source).find((source) =>
    source.kind === "plan_derived" && source.role === "foundation_config");
  const configValue = config?.kind === "plan_derived" ? record(config.value) : null;
  const brainPath = typeof configValue?.brainPath === "string" ? configValue.brainPath : null;
  const mayRemainAsBrain = (path: string): boolean =>
    terminalOutcome === "finalized" && brainPath !== null &&
    (path === brainPath || path.startsWith(`${brainPath}/`));
  const attributableFiles = new Set<CanonicalAbsolutePathV1>();
  for (const planned of [...plan.createdPaths, ...plan.launchabilityPaths]) {
    if (planned.kind !== "directory" && !mayRemainAsBrain(planned.path)) attributableFiles.add(planned.path);
  }
  if (reusableGlobalLock !== null) attributableFiles.delete(reusableGlobalLock.path);
  for (const participant of plan.foundationParticipants) {
    for (const mutation of participant.mutations) {
      if (!mayRemainAsBrain(mutation.targetPath)) attributableFiles.add(mutation.targetPath);
    }
  }
  attributableFiles.delete(plan.manifest.manifestPath);
  try {
    return (await request.reader.inventoryExactNamespaces([...attributableFiles])).length === 0;
  } catch {
    return false;
  }
}

async function inspectPlan(
  request: BootstrapEvidenceInspectionRequestV1,
  planEntry: BootstrapEvidenceGuardedEntryV1,
  initialForId: readonly BootstrapEvidenceGuardedEntryV1[],
): Promise<{
  readonly summary: BootstrapEvidenceSummaryV1;
  readonly active: BootstrapEvidenceAdmissionV1["active"];
  readonly retained: readonly BootstrapEvidenceGuardedEntryV1[];
  readonly parentAuthorities: BootstrapEvidenceAdmissionV1["retainedParentAuthorities"];
  readonly reusableGlobalLock: BootstrapEvidenceAdmissionV1["reusableGlobalLock"];
  readonly blocksNewIntent: boolean;
  readonly verifiedEnvelope: BootstrapEvidenceAdmissionV1["retainedEnvelopes"][number] | null;
}> {
  const match = FRESH_PLAN.exec(basename(planEntry.path));
  const id = match?.[1] as FreshV2InitIdV1 | undefined;
  if (id === undefined) throw new Error("bootstrap evidence plan filename is malformed");
  let plan: FreshV2InitPlanV1;
  try {
    const value = decodeCanonicalJson(await request.reader.readRegularFile(planEntry, MAX_PLAN_BYTES), MAX_PLAN_BYTES);
    plan = request.validatePlan(value) as FreshV2InitPlanV1;
    if (plan.id !== id || plan.planPath !== planEntry.path) throw new Error("bootstrap plan identity is unbound");
  } catch {
    return {
      summary: {
        id,
        status: "unverified",
        operation: "fresh_v2_init",
        terminalOutcome: null,
        vaultPath: planEntry.path,
        entryCount: 1,
        regularFileBytes: planEntry.bytes,
      },
      active: null,
      retained: [planEntry],
      parentAuthorities: [],
      reusableGlobalLock: null,
      verifiedEnvelope: null,
      blocksNewIntent: false,
    };
  }
  const slotEntries = plan.journalSlots.map((slot) =>
    (slot.path === planEntry.path ? planEntry : undefined) ?? null,
  );
  const initial = await request.reader.inventoryExactNamespaces(plan.journalSlots.map((slot) => slot.path));
  for (const [ordinal, slot] of plan.journalSlots.entries()) {
    slotEntries[ordinal] = initial.find((candidate) => candidate.path === slot.path) ?? null;
  }
  if (
    slotEntries.some((candidate) => candidate === null || candidate.kind !== "regular_file") ||
    slotEntries.some((candidate, ordinal) => !identityMatches(candidate as BootstrapEvidenceGuardedEntryV1, plan.journalSlots[ordinal] as FreshV2InitPlanV1["journalSlots"][number]))
  ) {
    const counted = sumEntries([planEntry, ...initial]);
    return {
      summary: { id, status: "unverified", operation: "fresh_v2_init", terminalOutcome: null, vaultPath: plan.planPath, entryCount: counted.entries, regularFileBytes: counted.bytes.toString() as UInt64DecimalV1 },
      active: null,
      retained: [planEntry, ...initial],
      parentAuthorities: [],
      reusableGlobalLock: null,
      verifiedEnvelope: null,
      blocksNewIntent: false,
    };
  }
  const slotValues = await Promise.all(slotEntries.map(async (candidate, ordinal) => {
    const value = candidate as BootstrapEvidenceGuardedEntryV1;
    if (value.bytes === "0") return null;
    const bytes = await request.reader.readRegularFile(value, plan.journalSlots[ordinal]?.mode === 0o600 ? plan.maximumJournalBytes : 0);
    /**
     * A slot half-written by a death mid-advance is not authority; the other
     * complete slot still is, and when neither is, the branch below resumes the
     * envelope through its plan-bound descriptors. Letting `decodeCanonicalJson`
     * throw out of here instead killed `init`, `doctor` and `uninstall` outright
     * on the one crash window this envelope exists to survive.
     */
    try {
      return decodeCanonicalJson(bytes, plan.maximumJournalBytes);
    } catch {
      return null;
    }
  })) as unknown as readonly [unknown, unknown];
  let selection: BootstrapJournalSelectionV1 | null;
  try {
    selection = request.validateSlots(plan, slotValues);
  } catch {
    selection = null;
  }
  if (selection === null) {
    const counted = sumEntries([planEntry, ...initial]);
    /**
     * No slot is authority yet: either both are still empty — the `after_plan`
     * interruption, where nothing was executed — or the first journal write died
     * partway and left bytes that decode to nothing legal. Both are resumable
     * through the plan-bound descriptors, and recovery rewrites the slot there.
     * Classing them unverified made a later init start a second envelope beside
     * this one instead of finishing it, which `during_initial_slot_write`
     * catches as two durable plans.
     */
    if (slotValues.every((candidate) => candidate === null)) {
      return {
        summary: { id, status: "incomplete", operation: "fresh_v2_init", terminalOutcome: null, vaultPath: plan.planPath, entryCount: counted.entries, regularFileBytes: counted.bytes.toString() as UInt64DecimalV1 },
        active: { plan, journal: null },
        retained: [planEntry, ...initial],
        parentAuthorities: [],
        reusableGlobalLock: null,
        verifiedEnvelope: null,
        blocksNewIntent: false,
      };
    }
    /**
     * Confinement decides, not whether the journal parses. Residue held to the
     * exact plan and two slots is `unverified`, and Spec 2 lets a later init
     * start a new ID beside it; the two returns above already classify an
     * unreadable envelope that way. Blocking here instead made the first
     * interrupted init permanent, because retention never unlinks what the
     * refusal named.
     */
    return {
      summary: { id, status: "unverified", operation: "fresh_v2_init", terminalOutcome: null, vaultPath: plan.planPath, entryCount: counted.entries, regularFileBytes: counted.bytes.toString() as UInt64DecimalV1 },
      active: null,
      retained: [planEntry, ...initial],
      parentAuthorities: [],
      reusableGlobalLock: null,
      verifiedEnvelope: null,
      blocksNewIntent: false,
    };
  }
  const terminal = terminalJournal(selection.current);
  let table: ReturnType<typeof deriveBootstrapRetentionTable> | null = null;
  let exactEvidence: BootstrapRetentionEvidenceProjectionV1 | null = null;
  let exactSelection = false;
  try {
    const evidence: BootstrapRetentionEvidenceProjectionV1 = terminal === null
      ? {
          bootstrapId: plan.id,
          terminalJournal: null,
          payloadEvidence: [],
          interruptedPayload: null,
          createdPathEvidence: [],
          foundationEvidence: [],
          directoryTrees: [],
          rows: [],
        }
      : await buildBootstrapRetentionEvidence(request, plan, terminal);
    selection = selectBootstrapJournal(plan, evidence, slotValues);
    if (terminal !== null) table = deriveBootstrapRetentionTable(plan, evidence);
    exactEvidence = evidence;
    exactSelection = true;
  } catch {
    if (selection.current.phase !== "retained" && selection.current.phase !== "retaining") {
      const counted = sumEntries([planEntry, ...initial]);
      return {
        summary: { id, status: "unverified", operation: "fresh_v2_init", terminalOutcome: null, vaultPath: plan.planPath, entryCount: counted.entries, regularFileBytes: counted.bytes.toString() as UInt64DecimalV1 },
        active: null,
        retained: [planEntry, ...initial],
        parentAuthorities: [],
        reusableGlobalLock: null,
        verifiedEnvelope: null,
        blocksNewIntent: true,
      };
    }
  }
  const locations = terminal === null ? [] : deriveBootstrapRetentionLocations(plan, terminal);
  const roots = locations.flatMap((location) => [location.sourcePath, location.tombstonePath]);
  const rowParents = table === null
    ? []
    : [...new Set(table.map((row) => row.parent.path))]
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const [exactRows, parentNamespaceRows] = await Promise.all([
    request.reader.inventoryExactNamespaces(roots),
    request.reader.inventoryExactNamespaces(rowParents),
  ]);
  let retained = [...new Map([
    ...[planEntry, ...initial, ...initialForId].map((candidate) => [candidate.path, candidate] as const),
    ...exactRows.map((candidate) => [candidate.path, candidate] as const),
    ...parentNamespaceRows.map((candidate) => [candidate.path, candidate] as const),
  ]).values()];
  if (selection.current.phase === "retained") {
    const retainedLock = locations.find((location) => location.role === "bootstrap_lock");
    const liveLock = retainedLock === undefined
      ? undefined
      : retained.find((candidate) => candidate.path === retainedLock.sourcePath);
    const tombstoneLock = retainedLock === undefined
      ? undefined
      : retained.find((candidate) => candidate.path === retainedLock.tombstonePath);
    if (
      liveLock !== undefined && tombstoneLock !== undefined &&
      !identityMatches(liveLock, plan.bootstrapIdentity)
    ) {
      retained = retained.filter((candidate) => candidate.path !== liveLock.path);
    }
  }
  let matching = 0;
  let altered = 0;
  for (const location of locations) {
    const source = retained.find((candidate) => candidate.path === location.sourcePath);
    const tombstone = retained.find((candidate) => candidate.path === location.tombstonePath);
    const shouldBeTombstone = selection.current.phase === "retained" ||
      (selection.current.phase === "retaining" && selection.current.retentionNext !== null && location.ordinal < selection.current.retentionNext);
    const physical = shouldBeTombstone ? tombstone : source;
    if (physical === undefined || (source === undefined) === (tombstone === undefined)) {
      altered += 1;
      continue;
    }
    let exact = physical.ownerUid === plan.bootstrapIdentity.ownerUid && physical.nlink >= 1;
    const expectedTableRow = table?.find((row) => row.ordinal === location.ordinal);
    if (expectedTableRow !== undefined) {
      const projected = await request.projectPostimage(physical.path);
      exact = projected !== null && sameValue(projected, expectedTableRow.postimage);
    }
    if (location.role === "bootstrap_lock") exact = exact && physical.kind === "regular_file" && physical.mode === 0o600 && physical.bytes === "0";
    if (location.role === "payload") {
      const payload = plan.payloads.find((row) => row.ref.path === location.sourcePath);
      if (payload !== undefined && physical.kind === "regular_file") {
        try {
          const bytes = await request.reader.readRegularFile(physical, Math.max(payload.ref.bytes, 1));
          exact = exact && physical.bytes === String(payload.ref.bytes) && hashBytes(bytes) === payload.ref.hash;
        } catch {
          exact = false;
        }
      }
    }
    if (location.role === "payload_evidence" && physical.kind === "regular_file") {
      const payload = plan.payloads.find((row) => `${row.ref.path}.json` === location.sourcePath);
      try {
        if (payload === undefined) throw new Error("unbound payload evidence");
        const bytes = await request.reader.readRegularFile(physical, plan.maximumJournalBytes);
        validateBootstrapPayloadEvidence(
          decodeCanonicalJson(bytes, plan.maximumJournalBytes),
          payload.ref,
          payload.source,
        );
      } catch {
        exact = false;
      }
    }
    if (location.role === "creation_evidence" && physical.kind === "regular_file") {
      try {
        const found = (["ordinary", "launchability"] as const).flatMap((scope) => {
          const rows = scope === "ordinary" ? plan.createdPaths : plan.launchabilityPaths;
          return rows.map((planned, ordinal) => ({
            planned,
            scope,
            ordinal,
            path: deriveBootstrapCreationEvidencePaths(
              request.productHome,
              "fresh_v2_init",
              plan.id,
              scope,
              ordinal,
              "00000000-0000-4000-8000-000000000000",
            ).evidence,
          }));
        }).find((candidate) => candidate.path === location.sourcePath);
        if (found === undefined) throw new Error("unbound creation evidence");
        const bytes = await request.reader.readRegularFile(physical, plan.maximumJournalBytes);
        validateCreatedPathEvidence(
          decodeCanonicalJson(bytes, plan.maximumJournalBytes),
          found.planned,
          plan.id,
          found.scope,
          found.ordinal,
        );
      } catch {
        exact = false;
      }
    }
    if (
      location.role === "foundation_bootstrap" && physical.kind === "regular_file" &&
      plan.foundationParticipants.some((participant) => participant.initialJournal.finalPath === location.sourcePath)
    ) {
      try {
        const bytes = await request.reader.readRegularFile(physical, plan.maximumJournalBytes);
        validateJournal(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
      } catch {
        exact = false;
      }
    }
    if (exact) matching += 1;
    else altered += 1;
  }
  if (!exactSelection && matching > 0 && altered === 0) {
    matching -= 1;
    altered = 1;
  }
  const exactPaths = new Set([
    plan.planPath,
    ...plan.journalSlots.map((slot) => slot.path),
    ...locations.flatMap((location) => [location.sourcePath, location.tombstonePath]),
  ]);
  const descendantRoots = locations.filter((location) => location.collapsesDescendants)
    .flatMap((location) => [location.sourcePath, location.tombstonePath]);
  const unboundEntries = retained.filter((candidate) =>
    !exactPaths.has(candidate.path) &&
    !descendantRoots.some((root) => candidate.path.startsWith(`${root}/`)),
  );
  const confinedUnboundEntries = unboundEntries.every((candidate) =>
    RETAINED.test(basename(candidate.path)) ||
    unboundEntries.some((root) =>
      RETAINED.test(basename(root.path)) && candidate.path.startsWith(`${root.path}/`),
    ),
  );
  const counted = sumEntries(retained);
  const summary = classifyBootstrapEvidence({
    id,
    planPath: plan.planPath,
    operation: "fresh_v2_init",
    journal: selection,
    terminalOutcome: selection.current.terminalOutcome,
    expectedRows: locations,
    matchingRows: matching,
    alteredRows: altered,
    unboundEntries: unboundEntries.length,
    confinedToRetainedNamespace: confinedUnboundEntries,
    entryCount: counted.entries,
    regularFileBytes: counted.bytes.toString() as UInt64DecimalV1,
  });
  const terminalRetained = selection.current.phase === "retained";
  const retainedOutcome = terminalRetained ? selection.current.terminalOutcome : null;
  const reusableGlobalLock = exactSelection
    ? await exactReusableGlobalLock(request, plan, selection, exactEvidence)
    : null;
  /**
   * The installation this envelope produced is still present. Uninstall removes
   * the manifest while retention preserves the envelope, so a finalized plan
   * outlives what it installed and must stop counting as the current install.
   */
  const handoffIntact = terminalRetained && retainedOutcome === "finalized" &&
    await exactV2Handoff(request, plan);
  const inert = terminalRetained && retainedOutcome !== null && (
    handoffIntact ||
    await exactRestoredBase(
      request,
      plan,
      locations,
      retained,
      confinedUnboundEntries,
      retainedOutcome,
      reusableGlobalLock,
    )
  );
  return {
    summary,
    /**
     * A finalized envelope stays active so a second `init` resolves to the
     * installation it already completed. Without it the caller falls through to
     * the V1 drift check and refuses over artifacts retention has tombstoned,
     * which is why `executeFreshInit` carries a retained-and-finalized branch.
     * A rolled-back envelope is not active: Spec 2 lets a later init start a new
     * ID beside it.
     */
    active: exactSelection && (!terminalRetained || handoffIntact)
      ? { plan, journal: selection }
      : null,
    retained,
    parentAuthorities: exactSelection && terminalRetained && table !== null
      ? [...new Map(table.map((row) => [row.parent.path, row.parent] as const)).values()]
      : [],
    reusableGlobalLock,
    blocksNewIntent: terminalRetained ? !inert : !exactSelection,
    verifiedEnvelope: summary.status === "verified" && terminal !== null && exactEvidence !== null
      ? { plan, terminalJournal: terminal, evidence: exactEvidence }
      : null,
  };
}

export async function inspectBootstrapEvidenceAdmission(
  outerRequest: BootstrapEvidenceInspectionRequestV1,
): Promise<BootstrapEvidenceAdmissionV1> {
  const request: BootstrapEvidenceInspectionRequestV1 = {
    ...outerRequest,
    projectPostimage: memoizePostimageProjector(outerRequest.projectPostimage),
  };
  const initial = (await request.reader.inventoryExactNamespaces(request.initialRoots))
    .filter((candidate) => basename(candidate.path) !== ".lifecycle-bootstrap.lock");
  const plans = initial.filter((candidate) => candidate.kind === "regular_file" && FRESH_PLAN.test(basename(candidate.path)));
  const ids = new Set(initial.map((candidate) => idForPath(candidate.path)).filter((id): id is string => id !== null));
  const initialEntriesForId = (rawId: string): readonly BootstrapEvidenceGuardedEntryV1[] => {
    const roots = initial.filter((candidate) => idForPath(candidate.path) === rawId);
    return initial.filter((candidate) =>
      roots.some((root) => candidate.path === root.path || candidate.path.startsWith(`${root.path}/`)),
    );
  };
  const results = await Promise.all(plans.map((plan) => {
    const id = idForPath(plan.path);
    return inspectPlan(
      request,
      plan,
      id === null ? [] : initialEntriesForId(id),
    );
  }));
  const summaries = results.map((result) => result.summary);
  const reportedIds = new Set(summaries.map((summary) => summary.id));
  const allEntries = new Map(initial.map((candidate) => [candidate.path, candidate] as const));
  for (const result of results) for (const candidate of result.retained) allEntries.set(candidate.path, candidate);
  let unverifiedBlocked = false;
  const entriesForId = (rawId: string): readonly BootstrapEvidenceGuardedEntryV1[] => {
    const roots = [...allEntries.values()].filter((candidate) => idForPath(candidate.path) === rawId);
    return [...allEntries.values()].filter((candidate) =>
      roots.some((root) => candidate.path === root.path || candidate.path.startsWith(`${root.path}/`)),
    );
  };
  for (const rawId of [...ids].sort()) {
    const reported = summaries.find((summary) => summary.id === rawId);
    if (reported !== undefined && reported.status !== "unverified") continue;
    const entries = entriesForId(rawId);
    const confined = entries.every((candidate) => {
      const name = basename(candidate.path);
      const isPlan = FRESH_PLAN.test(name);
      const isSlot = FRESH_SLOT.test(name);
      const isTombstone = RETAINED.test(name);
      const insideTombstone = entries.some((root) =>
        RETAINED.test(basename(root.path)) && candidate.path.startsWith(`${root.path}/`));
      if (isPlan || isSlot) {
        return candidate.kind === "regular_file" && candidate.mode === 0o600 && candidate.nlink === 1 &&
          (!isSlot || BigInt(candidate.bytes) <= BigInt(MAX_JOURNAL_BYTES)) &&
          (!isPlan || BigInt(candidate.bytes) <= BigInt(MAX_PLAN_BYTES));
      }
      if (isTombstone || insideTombstone) {
        return candidate.kind === "directory"
          ? candidate.mode === 0o700
          : (candidate.mode === 0o600 || candidate.mode === 0o700) && candidate.nlink === 1;
      }
      return false;
    });
    if (!confined) unverifiedBlocked = true;
    if (reportedIds.has(rawId as FreshV2InitIdV1)) continue;
    const counted = sumEntries(entries);
    const envelope = rawId.startsWith("fi_")
      ? deriveBootstrapEnvelopePaths(request.productHome, "fresh_v2_init", rawId as FreshV2InitIdV1)
      : null;
    if (envelope !== null) {
      summaries.push({
        id: rawId as FreshV2InitIdV1,
        status: "unverified",
        operation: "fresh_v2_init",
        terminalOutcome: null,
        vaultPath: envelope.plan,
        entryCount: counted.entries,
        regularFileBytes: counted.bytes.toString() as UInt64DecimalV1,
      });
    }
  }
  summaries.sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)));
  const counted = sumEntries(allEntries.values());
  /**
   * No capacity assertion here. Spec 2 §6.4 enforces the caps before
   * bootstrap-owned mutation, and this inspection mutates nothing: `init`
   * refuses through `assertCombinedBootstrapCapacity` before it allocates, both
   * at preflight and again under the lock. Asserting here instead made `doctor`
   * and `uninstall` fail on exactly the over-cap machine whose envelopes they
   * are supposed to list, so the user was told to archive without being told
   * what.
   */
  const active = results.flatMap((result) => result.active === null ? [] : [result.active]);
  const retainedEnvelopes = results.flatMap((result) => result.verifiedEnvelope === null ? [] : [result.verifiedEnvelope]);
  const retainedParentAuthorities = new Map<
    string,
    BootstrapEvidenceAdmissionV1["retainedParentAuthorities"][number]
  >();
  let conflictingParentAuthority = false;
  for (const result of results) {
    for (const authority of result.parentAuthorities) {
      const existing = retainedParentAuthorities.get(authority.path);
      if (existing !== undefined && (existing.dev !== authority.dev || existing.ino !== authority.ino)) {
        conflictingParentAuthority = true;
      } else {
        retainedParentAuthorities.set(authority.path, authority);
      }
    }
  }
  const orderedParentAuthorities = [...retainedParentAuthorities.values()]
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const globalLockAuthorities = results.flatMap((result) =>
    result.reusableGlobalLock === null ? [] : [result.reusableGlobalLock]
  );
  const reusableGlobalLock = globalLockAuthorities[0] ?? null;
  const conflictingGlobalLockAuthority = reusableGlobalLock !== null && globalLockAuthorities.some((candidate) =>
    candidate.path !== reusableGlobalLock.path || candidate.dev !== reusableGlobalLock.dev ||
    candidate.ino !== reusableGlobalLock.ino
  );
  const report: BootstrapEvidenceReportV1 = {
    schemaVersion: 1,
    ids: summaries,
    aggregate: {
      idCount: summaries.length,
      entryCount: counted.entries,
      regularFileBytes: counted.bytes.toString() as UInt64DecimalV1,
    },
  };
  const fingerprint = lowerHash(encoder.encode(encodeCanonicalJson({
    report,
    identities: [...allEntries.values()].map((candidate) => ({ path: candidate.path, dev: candidate.dev, ino: candidate.ino, bytes: candidate.bytes })),
    active: active.map((candidate) => ({ id: candidate.plan.id, sequence: candidate.journal === null ? null : candidate.journal.current.sequence })),
    retainedParentAuthorities: orderedParentAuthorities,
    reusableGlobalLock,
  } as unknown as CanonicalJsonValue)));
  return {
    report,
    active: active.length === 1 ? active[0] ?? null : null,
    retainedPaths: [...allEntries.keys()].sort(),
    retainedParentAuthorities: orderedParentAuthorities,
    reusableGlobalLock,
    fingerprint,
    blocksNewIntent: active.length > 1 || conflictingParentAuthority || conflictingGlobalLockAuthority || unverifiedBlocked ||
      results.some((result) => result.blocksNewIntent),
    retainedEnvelopes,
  };
}

export async function inspectBootstrapEvidence(
  request: BootstrapEvidenceInspectionRequestV1,
): Promise<BootstrapEvidenceReportV1> {
  return (await inspectBootstrapEvidenceAdmission(request)).report;
}

export function assertCombinedBootstrapCapacity(
  aggregate: BootstrapEvidenceReportV1["aggregate"],
  projected: BootstrapEvidenceReportV1["aggregate"],
): void {
  assertBootstrapRetentionCapacity({
    ids: aggregate.idCount + projected.idCount,
    entries: aggregate.entryCount + projected.entryCount,
    bytes: (BigInt(aggregate.regularFileBytes) + BigInt(projected.regularFileBytes)).toString() as UInt64DecimalV1,
  });
  if (
    aggregate.idCount + projected.idCount > BOOTSTRAP_RETAINED_MAX_IDS ||
    aggregate.entryCount + projected.entryCount > BOOTSTRAP_RETAINED_MAX_ENTRIES ||
    BigInt(aggregate.regularFileBytes) + BigInt(projected.regularFileBytes) > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES
  ) throw new Error("retained bootstrap aggregate capacity exceeded; archive retained bootstrap evidence manually");
}
