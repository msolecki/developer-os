import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import type {
  BootstrapPayloadEvidenceV1,
  FoundationParticipantRefV2,
} from "../manifest/bootstrap.js";
import type { FoundationParticipantRefV1 } from "../lifecycle/types.js";
import type { UpdateFoundationParticipantRefV2, UpdatePayloadRefV1 } from "../update/migrations.js";
import { EXIT_CODES } from "../result.js";
import { hasExactKeys, isRecord } from "../shape.js";
import { parseUtcTimestamp } from "../update/scalars.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { UInt64DecimalV1 } from "../update/scalars.js";
import {
  encodeFoundationJournalJsonV1,
  TransactionStateError,
  TransactionStore,
  validateJournal,
} from "./store.js";
import type {
  BootstrapInitialJournalPublicationV1,
  FileMutation,
  TransactionExecutorDependencies,
  TransactionFileSystem,
  TransactionJournalV1,
  TransactionPhase,
  TransactionPlan,
} from "./types.js";

interface ExistingSnapshot {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
}

interface BackupMetadata {
  readonly existed: boolean;
  readonly mode: number | null;
  readonly atimeMs: number | null;
  readonly mtimeMs: number | null;
}

export class TransactionPlanError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor() {
    super("transaction plan is invalid");
    this.name = "TransactionPlanError";
  }
}

/**
 * **The transaction completed and a backup payload could not be removed.** Distinct from
 * `TransactionStateError`, whose message — "transaction state is malformed or incomplete" —
 * describes something that is not true here: the journal is terminal, the user's file is
 * correct, and the only thing wrong is that bytes this product promised to delete are still
 * on disk.
 *
 * **The outcome is a parameter, because two of the three raising sites are on the rollback
 * path.** The message was hardcoded to "the change was applied", and `rollbackLocked`
 * raises it twice — where the change was *un*applied and the user's original file restored.
 * A completed rollback was reported as a failure whose text said the opposite of what
 * happened, which is the same defect as raising out of `execute`, relocated rather than
 * removed (found by fresh-context review, 2026-08-17).
 *
 * **It escapes only from `repair`, and that restriction is the point.** Every caller of
 * `execute` — `reindex`, `uninstall`, `ingest`, `review`, `capture`, `init` — is written
 * against "a throw means the transaction did not happen", and `ingest`'s own docblock says
 * so in as many words. This error means the opposite, so raising it out of `execute` made
 * `reindex` skip `recordArtifacts`, `uninstall` skip its manifest removal, and `ingest`
 * report `ok: false` for captures that had all landed — a successful operation reported as
 * a failure, with the command's own bookkeeping half done.
 *
 * **The three raising sites are the two terminal early-returns and the rollback transition
 * — keyed on the prune site, not on the caller.** Saying "`repair`'s paths raise" is the
 * shorter sentence and it is wrong in one direction that matters: `repair --resume <id>` on
 * an *incomplete* journal drives the forward loop, reaches the `verified → finalized` prune,
 * and retains silently like any other command. `doctor` covers that case; the rule does not.
 * On the forward path `pruneBackups` retains, and `doctor`'s transactions check is what
 * makes a retained payload visible.
 *
 * **It is recoverable, but not by retrying alone** — and the first version of `runRepair`'s
 * recovery said otherwise. `pruneBackups` being idempotent means re-running is *safe*, not
 * that it will succeed: the only thing that raises this is an `unlink` failing for a reason
 * other than "already gone", and that reason is still there on the second attempt. The
 * recovery names the precondition first and the command second.
 *
 * **`reason` carries the errno, because the recovery cannot be right for all of them.**
 * `EACCES` on a non-writable directory is the common cause and the one the recovery names,
 * but `EPERM` (a macOS `uchg` flag, or a sticky-bit directory owned by someone else),
 * `EROFS`, `EIO` and `EBUSY` reach the same branch — and for those, "make the backup
 * directory writable" is confidently wrong with nothing to tell the user why. Discarding
 * the code left the message unable to distinguish them at all.
 */
export type TransactionOutcome = "applied" | "rolled back";

export class TransactionBackupRetentionError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  /**
   * The directory the payload is in, unredacted, so a caller can publish it in `paths`
   * rather than leaving the only copy inside a message `redactDiagnostic` rewrites.
   */
  readonly directory: string;

  constructor(
    path: string,
    outcome: TransactionOutcome,
    reason: string,
    directory: string,
  ) {
    super(
      `the change was ${outcome}, but a backup payload could not be removed (${reason}): ${path}`,
    );
    this.name = "TransactionBackupRetentionError";
    this.directory = directory;
  }
}

export class TransactionConflictError extends Error {
  readonly code = EXIT_CODES.decisionRequired;

  constructor(message = "transaction target changed unexpectedly") {
    super(message);
    this.name = "TransactionConflictError";
  }
}

/**
 * **A conflict detected before anything was written**, and the distinction is load-bearing
 * rather than cosmetic. A caller-supplied precondition is checked in the plan phase, so a
 * refusal means no bytes moved and the caller's own file is exactly as it was — while the
 * other conflict sites — seven of them, and only some raised after a byte moved — cannot promise
 * that. A caller that compensates on failure needs to tell them apart: rolling back a
 * transaction that never landed writes a stale copy over whatever is on disk, which on this
 * path is the hand edit the refusal had just protected.
 *
 * It extends `TransactionConflictError` so every existing `catch` keeps working and the exit
 * code is unchanged; a caller that wants the stronger promise asks for the subclass. An
 * earlier version of this change reused the base class alone and argued a second class would
 * need handling at every catch site — which is what `extends` is for.
 */
export class TransactionPreconditionError extends TransactionConflictError {
  constructor() {
    super("transaction target changed before the transaction began");
    this.name = "TransactionPreconditionError";
  }
}

export class TransactionGuardError extends Error {
  readonly code:
    | typeof EXIT_CODES.decisionRequired
    | typeof EXIT_CODES.securityRefusal;

  constructor(
    code:
      | typeof EXIT_CODES.decisionRequired
      | typeof EXIT_CODES.securityRefusal,
  ) {
    super("transaction target was refused");
    this.name = "TransactionGuardError";
    this.code = code;
  }
}

const DECIMAL_IDENTITY = /^(?:0|[1-9][0-9]*)$/u;

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * The errno, or a stand-in when there is none.
 *
 * **It is the code and never the message.** An errno is a fixed token — `EACCES`, `EPERM`,
 * `EROFS` — that carries no path, no user string and nothing to redact, which is what makes
 * it safe to put in a diagnostic. `error.message` on the same object embeds the path it
 * failed on, so folding it in would leak the same string twice by a route the caller does
 * not know to redact.
 */
function errnoOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string" && /^[A-Z]+$/u.test(code)) return code;
  }
  return "unknown error";
}


function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}


/**
 * The required keys, plus any of `optional` that are present. An unknown key is still a plan
 * this executor does not understand and is still refused — the exactness is the point, and
 * `expectedBeforeHash` had to be named here before a caller could supply it. A plan carrying
 * a *misspelled* precondition is exactly the plan that must not silently execute without one.
 */
function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    required.every((key) => actual.includes(key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key))
  );
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(fs: TransactionFileSystem, path: string): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

interface BootstrapJournalIdentity {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type JournalTransition = (
  journal: TransactionJournalV1,
  nextPhase: TransactionPhase,
) => Promise<TransactionJournalV1>;

const admittedBootstrapFoundationInitialJournal: unique symbol = Symbol(
  "admittedBootstrapFoundationInitialJournal",
);

/**
 * A controller-bound capability for the one bootstrap publication the ordinary executor
 * cannot create for itself. Its only runtime representation is registered in this module's
 * private WeakMap, so neither a structural participant nor a cast object can reach the
 * filesystem bridge.
 */
export interface AdmittedBootstrapFoundationInitialJournalV1 {
  readonly [admittedBootstrapFoundationInitialJournal]: true;
}

export interface BootstrapFoundationInitialJournalAdmissionContextV1 {
  readonly participantAdmissionId: string;
  readonly evidenceAdmissionId: string;
  readonly mutationPublicationsAdmissionId: string;
  readonly ownerUid: number;
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
  readonly mutationPublications: readonly BootstrapInitialJournalPublicationV1[];
  readonly initialJournal: TransactionJournalV1;
  readonly admitParticipant: (value: FoundationParticipantRefV2) => string;
  readonly admitEvidence: (
    value: BootstrapPayloadEvidenceV1,
    participant: FoundationParticipantRefV2,
  ) => string;
  readonly admitMutationPublications: (
    value: readonly BootstrapInitialJournalPublicationV1[],
    participant: FoundationParticipantRefV2,
  ) => string;
}

interface RetainedBootstrapFoundationInitialJournalV1 {
  readonly participant: FoundationParticipantRefV2;
  readonly evidence: BootstrapPayloadEvidenceV1;
  readonly ownerUid: number;
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
  readonly mutationPublications: readonly BootstrapInitialJournalPublicationV1[];
  readonly initialJournal: TransactionJournalV1;
}

const retainedBootstrapFoundationInitialJournals = new WeakMap<
  AdmittedBootstrapFoundationInitialJournalV1,
  RetainedBootstrapFoundationInitialJournalV1
>();

/** An admission capability is valid only if this module issued it. */
function consume<K extends object, V>(issued: WeakMap<K, V>, admitted: K): V {
  const retained = issued.get(admitted);
  if (retained === undefined) throw new TransactionStateError();
  return retained;
}

function validAdmissionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 1 && bytes <= 256;
}

function retainedPublicationParent(
  value: BootstrapInitialJournalPublicationV1["sourceParent"],
  expectedPath: string,
  ownerUid: number,
): BootstrapInitialJournalPublicationV1["sourceParent"] {
  if (
    value.path !== expectedPath ||
    value.ownerUid !== ownerUid ||
    !DECIMAL_IDENTITY.test(value.dev) ||
    !DECIMAL_IDENTITY.test(value.ino)
  ) {
    throw new TransactionStateError();
  }
  return structuredClone(value);
}

function retainedMutationPublications(
  participant: FoundationParticipantRefV2,
  value: readonly BootstrapInitialJournalPublicationV1[],
  ownerUid: number,
): readonly BootstrapInitialJournalPublicationV1[] {
  const expected = participant.role.kind === "forward"
    ? participant.mutations
    : [];
  if (value.length !== expected.length) throw new TransactionStateError();
  return value.map((request, index) => {
    const mutation = expected[index];
    const observedNlink: unknown = request.postimage.nlink;
    if (
      mutation === undefined ||
      mutation.operation !== "create" ||
      mutation.expectedBeforeHash !== null ||
      mutation.stagedPath === null ||
      mutation.contentHash === null ||
      mutation.contentSize === null ||
      request.sourcePath !== mutation.stagedPath ||
      request.destinationPath !== mutation.targetPath ||
      request.postimage.kind !== "regular_file" ||
      request.postimage.ownerUid !== ownerUid ||
      request.postimage.mode !== 0o600 ||
      observedNlink !== 1 ||
      request.postimage.bytes !== String(mutation.contentSize) ||
      request.postimage.sha256 !== mutation.contentHash ||
      !DECIMAL_IDENTITY.test(request.postimage.dev) ||
      !DECIMAL_IDENTITY.test(request.postimage.ino)
    ) throw new TransactionStateError();
    return {
      sourcePath: request.sourcePath,
      destinationPath: request.destinationPath,
      sourceParent: retainedPublicationParent(
        request.sourceParent,
        dirname(request.sourcePath),
        ownerUid,
      ),
      destinationParent: retainedPublicationParent(
        request.destinationParent,
        dirname(request.destinationPath),
        ownerUid,
      ),
      postimage: structuredClone(request.postimage),
    };
  });
}

/**
 * Converts the controller's two independent opaque rulings into the only value accepted by
 * the publication bridge. Callbacks receive disposable clones; the capability retains only
 * the untouched pre-callback snapshots and the admitted owner identity.
 */
export function admitBootstrapFoundationInitialJournal(
  participant: FoundationParticipantRefV2,
  evidence: BootstrapPayloadEvidenceV1,
  context: BootstrapFoundationInitialJournalAdmissionContextV1,
): AdmittedBootstrapFoundationInitialJournalV1 {
  try {
    if (
      !validAdmissionId(context.participantAdmissionId) ||
      !validAdmissionId(context.evidenceAdmissionId) ||
      !validAdmissionId(context.mutationPublicationsAdmissionId) ||
      context.participantAdmissionId === context.evidenceAdmissionId ||
      context.mutationPublicationsAdmissionId === context.participantAdmissionId ||
      context.mutationPublicationsAdmissionId === context.evidenceAdmissionId ||
      !Number.isSafeInteger(context.ownerUid) ||
      context.ownerUid < 0
    ) {
      throw new TransactionStateError();
    }
    const retainedParticipant = structuredClone(participant);
    const retainedEvidence = structuredClone(evidence);
    const initialJournal = validateJournal(structuredClone(context.initialJournal));
    const initialBytes = new TextEncoder().encode(encodeFoundationJournalJsonV1(initialJournal));
    if (
      initialJournal.phase !== "planned" ||
      initialJournal.createdAt !== initialJournal.updatedAt ||
      initialBytes.byteLength !== retainedEvidence.bytes ||
      hash(initialBytes) !== retainedEvidence.sha256
    ) throw new TransactionStateError();
    const sourceParent = retainedPublicationParent(
      context.sourceParent,
      dirname(retainedParticipant.initialJournal.staged.path),
      context.ownerUid,
    );
    const destinationParent = retainedPublicationParent(
      context.destinationParent,
      dirname(retainedParticipant.initialJournal.finalPath),
      context.ownerUid,
    );
    const mutationPublications = retainedMutationPublications(
      retainedParticipant,
      context.mutationPublications,
      context.ownerUid,
    );
    if (
      context.admitParticipant(structuredClone(retainedParticipant)) !==
        context.participantAdmissionId ||
      context.admitEvidence(
        structuredClone(retainedEvidence),
        structuredClone(retainedParticipant),
      ) !== context.evidenceAdmissionId ||
      context.admitMutationPublications(
        structuredClone(mutationPublications),
        structuredClone(retainedParticipant),
      ) !== context.mutationPublicationsAdmissionId
    ) {
      throw new TransactionStateError();
    }
    const admitted = Object.freeze({
      [admittedBootstrapFoundationInitialJournal]: true as const,
    });
    retainedBootstrapFoundationInitialJournals.set(admitted, {
      participant: retainedParticipant,
      evidence: retainedEvidence,
      ownerUid: context.ownerUid,
      sourceParent,
      destinationParent,
      mutationPublications,
      initialJournal,
    });
    return admitted;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

const admittedLifecycleFoundationInitialJournal: unique symbol = Symbol(
  "admittedLifecycleFoundationInitialJournal",
);

export interface AdmittedLifecycleFoundationInitialJournalV1 {
  readonly [admittedLifecycleFoundationInitialJournal]: true;
}

export interface LifecycleFoundationInitialJournalAdmissionContextV1 {
  readonly ref: FoundationParticipantRefV1;
  readonly ownerUid: number;
  readonly initialJournal: TransactionJournalV1;
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
}

interface RetainedLifecycleFoundationInitialJournalV1 {
  readonly ref: FoundationParticipantRefV1;
  readonly ownerUid: number;
  readonly initialJournal: TransactionJournalV1;
  readonly plannedBytes: Uint8Array;
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
}

const retainedLifecycleFoundationInitialJournals = new WeakMap<
  AdmittedLifecycleFoundationInitialJournalV1,
  RetainedLifecycleFoundationInitialJournalV1
>();

const ALLOCATED_LIFECYCLE_TRANSACTION_ID =
  /^tx_[0-9a-f]{64}_(?:0|[1-9][0-9]*)$/u;
const ALLOCATED_LIFECYCLE_COORDINATOR_ID =
  /^lc_[0-9a-f]{64}_(?:0|[1-9][0-9]*)$/u;
const LIFECYCLE_JOURNAL_MAXIMUM_BYTES = 1_048_576;
const LIFECYCLE_PAYLOAD_MAXIMUM_BYTES = 16_777_216;

function expectedLifecycleJournalKind(ref: FoundationParticipantRefV1): string {
  return ref.role.kind === "forward"
    ? `lifecycle.${ref.slot}`
    : `lifecycle.${ref.slot}.compensation`;
}

interface PlannedRefMutation {
  readonly targetPath: string;
  readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: string | null;
  readonly contentHash: string | null;
  readonly contentSize: number | null;
  readonly stagedPath: string | null;
}

/**
 * A coordinator-bound ref's planned journal: `kind`, one `planned` header, and per mutation the
 * same target, operation, preimage and `<i>.bin` staging as the ref, whose own create/replace/
 * remove shape is consistent. `mutationShape` adds an arm's own per-mutation rules.
 */
function requirePlannedJournalMatchesRef<M extends PlannedRefMutation>(
  ref: { readonly id: string; readonly mutations: readonly M[] },
  initialJournal: TransactionJournalV1,
  kind: string,
  mutationShape: (mutation: M, index: number) => boolean,
): void {
  if (
    initialJournal.id !== ref.id ||
    initialJournal.kind !== kind ||
    initialJournal.phase !== "planned" ||
    initialJournal.createdAt !== initialJournal.updatedAt ||
    ref.mutations.length !== initialJournal.mutations.length ||
    ref.mutations.length < 1 ||
    ref.mutations.length > 256
  ) {
    throw new TransactionStateError();
  }
  for (const [index, mutation] of ref.mutations.entries()) {
    const planned = initialJournal.mutations[index];
    const remove = mutation.operation === "remove";
    const validShape = remove
      ? mutation.expectedBeforeHash !== null &&
        mutation.contentHash === null &&
        mutation.contentSize === null &&
        mutation.stagedPath === null
      : (mutation.operation === "create") === (mutation.expectedBeforeHash === null) &&
        mutation.contentHash !== null &&
        mutation.contentSize !== null &&
        mutation.stagedPath !== null;
    if (
      planned === undefined ||
      !validShape ||
      !mutationShape(mutation, index) ||
      planned.targetPath !== mutation.targetPath ||
      planned.operation !== mutation.operation ||
      planned.expectedBeforeHash !== mutation.expectedBeforeHash ||
      planned.stagedRelativePath !== (remove ? null : `${String(index)}.bin`) ||
      !isAbsolute(mutation.targetPath) ||
      (mutation.contentSize !== null &&
        (!Number.isSafeInteger(mutation.contentSize) ||
          mutation.contentSize < 0 ||
          mutation.contentSize > LIFECYCLE_PAYLOAD_MAXIMUM_BYTES))
    ) {
      throw new TransactionStateError();
    }
  }
}

export function admitLifecycleFoundationInitialJournal(
  context: LifecycleFoundationInitialJournalAdmissionContextV1,
): AdmittedLifecycleFoundationInitialJournalV1 {
  try {
    if (!Number.isSafeInteger(context.ownerUid) || context.ownerUid < 0) {
      throw new TransactionStateError();
    }
    const ref = structuredClone(context.ref);
    const initialJournal = validateJournal(structuredClone(context.initialJournal));
    requirePlannedJournalMatchesRef(ref, initialJournal, expectedLifecycleJournalKind(ref), () => true);
    const plannedBytes = new TextEncoder().encode(
      encodeFoundationJournalJsonV1(initialJournal),
    );
    const staged = ref.initialJournal.stagedIdentity;
    if (
      !ALLOCATED_LIFECYCLE_TRANSACTION_ID.test(ref.id) ||
      !Number.isSafeInteger(ref.maximumJournalBytes) ||
      ref.maximumJournalBytes < 1 ||
      ref.maximumJournalBytes > LIFECYCLE_JOURNAL_MAXIMUM_BYTES ||
      plannedBytes.byteLength < 1 ||
      plannedBytes.byteLength > ref.maximumJournalBytes ||
      staged.size !== plannedBytes.byteLength ||
      staged.hash !== hash(plannedBytes) ||
      ref.initialJournal.plannedBytesHash !== hash(plannedBytes) ||
      !DECIMAL_IDENTITY.test(staged.dev) ||
      !DECIMAL_IDENTITY.test(staged.ino)
    ) {
      throw new TransactionStateError();
    }
    const admitted = Object.freeze({
      [admittedLifecycleFoundationInitialJournal]: true as const,
    });
    retainedLifecycleFoundationInitialJournals.set(admitted, {
      ref,
      ownerUid: context.ownerUid,
      initialJournal,
      plannedBytes,
      sourceParent: retainedPublicationParent(
        context.sourceParent,
        dirname(ref.initialJournal.stagedPath),
        context.ownerUid,
      ),
      destinationParent: retainedPublicationParent(
        context.destinationParent,
        dirname(ref.initialJournal.finalPath),
        context.ownerUid,
      ),
    });
    return admitted;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

/** The half of a lifecycle participant's shape the executor's own directories derive. */
function validateLifecycleFoundationBridgeInput(
  ref: FoundationParticipantRefV1,
  dependencies: TransactionExecutorDependencies,
): void {
  const stagedPrefix = `${join(dependencies.stagingDir, "lifecycle")}/`;
  const stagedSuffix = `/foundation/${ref.id}/journal.json`;
  const stagedPath = ref.initialJournal.stagedPath;
  if (
    ref.initialJournal.finalPath !==
      join(dependencies.stateDir, "transactions", `${ref.id}.json`) ||
    !stagedPath.startsWith(stagedPrefix) ||
    !stagedPath.endsWith(stagedSuffix)
  ) {
    throw new TransactionStateError();
  }
  const coordinatorId = stagedPath.slice(
    stagedPrefix.length,
    stagedPath.length - stagedSuffix.length,
  );
  if (!ALLOCATED_LIFECYCLE_COORDINATOR_ID.test(coordinatorId)) {
    throw new TransactionStateError();
  }
  for (const [index, mutation] of ref.mutations.entries()) {
    const expected =
      mutation.operation === "remove"
        ? null
        : join(
            dependencies.stagingDir,
            "transactions",
            ref.id,
            `${String(index)}.bin`,
          );
    if (mutation.stagedPath !== expected) throw new TransactionStateError();
  }
}

const admittedUpdateFoundationInitialJournal: unique symbol = Symbol(
  "admittedUpdateFoundationInitialJournal",
);

/** Spec 2 §5.3 (D60): the capability for one lifecycle update ref's Foundation cursor. */
export interface AdmittedUpdateFoundationInitialJournalV1 {
  readonly [admittedUpdateFoundationInitialJournal]: true;
}

/** A construction-evidence inode: the only authority to adopt a published payload. */
export interface UpdateFoundationPayloadIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface UpdateFoundationInitialJournalAdmissionContextV1 {
  readonly ref: UpdateFoundationParticipantRefV2;
  readonly ownerUid: number;
  readonly initialJournal: TransactionJournalV1;
  /** Construction evidence of the staged initial-journal row. */
  readonly journalIdentity: UpdateFoundationPayloadIdentityV1;
  /** Per mutation, the evidence of its content and digest rows; null exactly for a remove. */
  readonly payloadIdentities: readonly ({
    readonly content: UpdateFoundationPayloadIdentityV1;
    readonly digest: UpdateFoundationPayloadIdentityV1;
  } | null)[];
  /** The coordinator's `update/payloads` directory, the source parent of every content move. */
  readonly payloadParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
}

interface RetainedUpdateFoundationInitialJournalV1 {
  readonly ref: UpdateFoundationParticipantRefV2;
  readonly ownerUid: number;
  readonly initialJournal: TransactionJournalV1;
  readonly plannedBytes: Uint8Array;
  readonly journalIdentity: UpdateFoundationPayloadIdentityV1;
  readonly payloadIdentities: UpdateFoundationInitialJournalAdmissionContextV1["payloadIdentities"];
  readonly payloadParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"];
  readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
}

const retainedUpdateFoundationInitialJournals = new WeakMap<
  AdmittedUpdateFoundationInitialJournalV1,
  RetainedUpdateFoundationInitialJournalV1
>();

function retainedIdentity(value: UpdateFoundationPayloadIdentityV1): UpdateFoundationPayloadIdentityV1 {
  if (!DECIMAL_IDENTITY.test(value.dev) || !DECIMAL_IDENTITY.test(value.ino)) {
    throw new TransactionStateError();
  }
  return { dev: value.dev, ino: value.ino };
}

/** The sidecar the V1 stage check requires for `contentHash`: lowercase hex plus LF. */
function stagedDigestBytes(contentHash: string): Uint8Array {
  return new TextEncoder().encode(`${contentHash}\n`);
}

/**
 * The planned journal an update ref stages: Spec 1's shape with the slot as its kind. A
 * mutation with bytes stages `<i>.bin` from two distinct `update_expected` rows whose hashes
 * bind the mutation; a remove carries neither.
 */
function updateParticipantPlannedShape(
  ref: UpdateFoundationParticipantRefV2,
  initialJournal: TransactionJournalV1,
  payloadIdentities: UpdateFoundationInitialJournalAdmissionContextV1["payloadIdentities"],
): void {
  if (ref.mutations.length !== payloadIdentities.length) throw new TransactionStateError();
  requirePlannedJournalMatchesRef(ref, initialJournal, ref.slot, (mutation, index) => {
    const identities = payloadIdentities[index];
    if (mutation.operation === "remove") {
      return mutation.content === null && mutation.digest === null && identities === null;
    }
    if (
      mutation.content === null ||
      mutation.digest === null ||
      mutation.contentHash === null ||
      identities === null ||
      identities === undefined ||
      mutation.content.sha256 !== mutation.contentHash ||
      mutation.content.bytes !== mutation.contentSize ||
      mutation.content.ordinal === mutation.digest.ordinal ||
      mutation.digest.mode !== 0o600 ||
      mutation.digest.bytes !== stagedDigestBytes(mutation.contentHash).byteLength ||
      mutation.digest.sha256 !== hash(stagedDigestBytes(mutation.contentHash))
    ) {
      return false;
    }
    retainedIdentity(identities.content);
    retainedIdentity(identities.digest);
    return true;
  });
}

/**
 * Converts a lifecycle update ref, its planned journal, and the construction evidence of
 * every row it consumes into the only value `executeUpdateFoundationParticipant` accepts.
 * A Spec 1 V1 ref has no `staged` arm and is refused here.
 */
export function admitUpdateFoundationInitialJournal(
  context: UpdateFoundationInitialJournalAdmissionContextV1,
): AdmittedUpdateFoundationInitialJournalV1 {
  try {
    if (!Number.isSafeInteger(context.ownerUid) || context.ownerUid < 0) {
      throw new TransactionStateError();
    }
    const ref = structuredClone(context.ref);
    const payloadIdentities = structuredClone(context.payloadIdentities);
    const initialJournal = validateJournal(structuredClone(context.initialJournal));
    updateParticipantPlannedShape(ref, initialJournal, payloadIdentities);
    const plannedBytes = new TextEncoder().encode(
      encodeFoundationJournalJsonV1(initialJournal),
    );
    const staged = ref.initialJournal.staged;
    if (
      (staged.kind as string) !== "update_expected" ||
      !ALLOCATED_LIFECYCLE_TRANSACTION_ID.test(ref.id) ||
      !Number.isSafeInteger(ref.maximumJournalBytes) ||
      ref.maximumJournalBytes < 1 ||
      ref.maximumJournalBytes > LIFECYCLE_JOURNAL_MAXIMUM_BYTES ||
      plannedBytes.byteLength < 1 ||
      plannedBytes.byteLength > ref.maximumJournalBytes ||
      (staged.mode as number) !== 0o600 ||
      staged.bytes !== plannedBytes.byteLength ||
      staged.hash !== hash(plannedBytes) ||
      ref.initialJournal.plannedBytesHash !== hash(plannedBytes)
    ) {
      throw new TransactionStateError();
    }
    const payloadParent = retainedPublicationParent(
      context.payloadParent,
      context.payloadParent.path,
      context.ownerUid,
    );
    for (const mutation of ref.mutations) {
      for (const payload of [mutation.content, mutation.digest]) {
        if (payload !== null && dirname(payload.path) !== payloadParent.path) {
          throw new TransactionStateError();
        }
      }
    }
    const admitted = Object.freeze({
      [admittedUpdateFoundationInitialJournal]: true as const,
    });
    retainedUpdateFoundationInitialJournals.set(admitted, {
      ref,
      ownerUid: context.ownerUid,
      initialJournal,
      plannedBytes,
      journalIdentity: retainedIdentity(context.journalIdentity),
      payloadIdentities,
      payloadParent,
      sourceParent: retainedPublicationParent(
        context.sourceParent,
        dirname(staged.path),
        context.ownerUid,
      ),
      destinationParent: retainedPublicationParent(
        context.destinationParent,
        dirname(ref.initialJournal.finalPath),
        context.ownerUid,
      ),
    });
    return admitted;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

/**
 * The half of an update ref's shape the executor's own directories derive: the §5.3 staged
 * initial journal under its V2 coordinator, the standard `<tx>/<i>.bin`, and payloads under
 * that coordinator's `update/payloads`. The V1 `foundation/<tx>/journal.json` never matches.
 */
function validateUpdateFoundationBridgeInput(
  ref: UpdateFoundationParticipantRefV2,
  dependencies: TransactionExecutorDependencies,
): void {
  const coordinatorId = ref.initialJournal.staged.coordinatorId;
  if (!ALLOCATED_LIFECYCLE_COORDINATOR_ID.test(coordinatorId)) {
    throw new TransactionStateError();
  }
  const coordinatorRoot = join(dependencies.stagingDir, "lifecycle", coordinatorId);
  const payloadPath = (payload: UpdatePayloadRefV1): string =>
    join(coordinatorRoot, "update", "payloads", `${String(payload.ordinal).padStart(10, "0")}.payload`);
  if (
    ref.initialJournal.finalPath !==
      join(dependencies.stateDir, "transactions", `${ref.id}.json`) ||
    ref.initialJournal.staged.path !==
      join(coordinatorRoot, "participants", "foundation", ref.id, "initial-journal.json")
  ) {
    throw new TransactionStateError();
  }
  for (const [index, mutation] of ref.mutations.entries()) {
    if (mutation.operation === "remove") continue;
    const { content, digest } = mutation;
    if (
      content === null ||
      digest === null ||
      mutation.stagedPath !==
        join(dependencies.stagingDir, "transactions", ref.id, `${String(index)}.bin`)
    ) {
      throw new TransactionStateError();
    }
    for (const payload of [content, digest]) {
      if (
        (payload.kind as string) !== "update_expected" ||
        payload.coordinatorId !== coordinatorId ||
        !Number.isSafeInteger(payload.ordinal) ||
        payload.ordinal < 0 ||
        payload.ordinal > 1_099_999 ||
        payload.path !== payloadPath(payload)
      ) {
        throw new TransactionStateError();
      }
    }
  }
}

/** The observed identity of a publication parent the executor itself just ensured. */
async function observedPublicationParent(
  fs: TransactionFileSystem,
  path: CanonicalAbsolutePathV1,
  ownerUid: number,
): Promise<BootstrapInitialJournalPublicationV1["destinationParent"]> {
  const stats = await optionalLstat(fs, path);
  if (
    stats === null ||
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    Number(stats.uid) !== ownerUid ||
    (Number(stats.mode) & 0o7777) !== 0o700
  ) {
    throw new TransactionStateError();
  }
  return {
    path,
    ownerUid,
    mode: 0o700,
    dev: stats.dev.toString(10) as UInt64DecimalV1,
    ino: stats.ino.toString(10) as UInt64DecimalV1,
  };
}

const BOOTSTRAP_FOUNDATION_ID_RE = new RegExp(
  "^tx_fi_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_[0-9]{10}_([fc])$",
  "u",
);

/** A bootstrap Foundation participant's id; its journal is rewritten in place on its admitted inode. */
export function isBootstrapFoundationTransactionId(id: string): boolean {
  return BOOTSTRAP_FOUNDATION_ID_RE.test(id);
}

/**
 * NEW-174: the generic paths rewrite a journal by temp + rename, which gives it
 * a new inode, and the bootstrap's identity-bound resume then refuses for good.
 * Only `developer-os init` resumes or compensates these journals.
 */
function refuseBootstrapFoundationId(id: string): void {
  if (isBootstrapFoundationTransactionId(id)) {
    throw new TransactionStateError(
      `transaction ${id} belongs to an interrupted fresh install; run developer-os init to resume or roll it back`,
    );
  }
}

async function optionalLstat(
  fs: TransactionFileSystem,
  path: CanonicalAbsolutePathV1,
): Promise<BigIntStats | null> {
  try {
    return await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw new TransactionStateError();
  }
}

const JOURNAL_MAXIMUM_BYTES = 1_048_576;

/** An owner-only (0600), single-link regular file at exactly this inode, its size in range. */
function assertOwnedJournalInode(
  stats: BigIntStats,
  ownerUid: number,
  identity: { readonly dev: string; readonly ino: string },
  minimumBytes = 0,
  maximumBytes = JOURNAL_MAXIMUM_BYTES,
): void {
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    Number(stats.uid) !== ownerUid ||
    (Number(stats.mode) & 0o7777) !== 0o600 ||
    Number(stats.nlink) !== 1 ||
    Number(stats.size) < minimumBytes ||
    Number(stats.size) > maximumBytes ||
    stats.dev.toString(10) !== identity.dev ||
    stats.ino.toString(10) !== identity.ino
  ) {
    throw new TransactionStateError();
  }
}

/** Rewrites an open journal to exactly `bytes` on the same inode and syncs it. */
async function rewriteInPlace(
  handle: Awaited<ReturnType<TransactionFileSystem["open"]>>,
  bytes: Uint8Array,
  identity: { readonly dev: string; readonly ino: string },
): Promise<void> {
  await handle.truncate(0);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const write = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (write.bytesWritten < 1) throw new TransactionStateError();
    offset += write.bytesWritten;
  }
  await handle.truncate(bytes.byteLength);
  await handle.sync();
  const after = await handle.stat({ bigint: true });
  if (
    after.dev.toString(10) !== identity.dev ||
    after.ino.toString(10) !== identity.ino ||
    Number(after.size) !== bytes.byteLength
  ) throw new TransactionStateError();
}

async function readExactBootstrapJournal(
  fs: TransactionFileSystem,
  path: string,
  evidence: BootstrapPayloadEvidenceV1,
  ownerUid: number,
): Promise<{ readonly bytes: Uint8Array; readonly identity: BootstrapJournalIdentity }> {
  try {
    const before = await fs.lstat(path, { bigint: true });
    assertOwnedJournalInode(before, ownerUid, evidence, evidence.bytes, evidence.bytes);
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Uint8Array;
    try {
      const opened = await handle.stat({ bigint: true });
      assertOwnedJournalInode(opened, ownerUid, evidence, evidence.bytes, evidence.bytes);
      if (opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new TransactionStateError();
      }
      bytes = await handle.readFile();
      const afterRead = await handle.stat({ bigint: true });
      assertOwnedJournalInode(afterRead, ownerUid, evidence, evidence.bytes, evidence.bytes);
      if (afterRead.dev !== opened.dev || afterRead.ino !== opened.ino) {
        throw new TransactionStateError();
      }
    } finally {
      await handle.close();
    }
    const after = await fs.lstat(path, { bigint: true });
    assertOwnedJournalInode(after, ownerUid, evidence, evidence.bytes, evidence.bytes);
    if (after.dev !== before.dev || after.ino !== before.ino) {
      throw new TransactionStateError();
    }
    if (
      bytes.byteLength !== evidence.bytes ||
      hash(bytes) !== evidence.sha256
    ) {
      throw new TransactionStateError();
    }
    return {
      bytes,
      identity: {
        dev: after.dev.toString(10) as UInt64DecimalV1,
        ino: after.ino.toString(10) as UInt64DecimalV1,
      },
    };
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

async function readExactBootstrapJournalByIdentity(
  fs: TransactionFileSystem,
  path: CanonicalAbsolutePathV1,
  identity: BootstrapJournalIdentity,
  ownerUid: number,
  expectedBytes: Uint8Array,
): Promise<TransactionJournalV1> {
  let handle: Awaited<ReturnType<TransactionFileSystem["open"]>> | undefined;
  let result: TransactionJournalV1 | undefined;
  let failure: TransactionStateError | undefined;
  try {
    const before = await fs.lstat(path, { bigint: true });
    assertOwnedJournalInode(before, ownerUid, identity, expectedBytes.byteLength, expectedBytes.byteLength);
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      Number(opened.size) !== expectedBytes.byteLength
    ) throw new TransactionStateError();
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      Number(afterRead.size) !== expectedBytes.byteLength ||
      bytes.byteLength !== expectedBytes.byteLength ||
      hash(bytes) !== hash(expectedBytes)
    ) throw new TransactionStateError();
    const journal = validateJournal(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
    if (encodeFoundationJournalJsonV1(journal) !== new TextDecoder().decode(expectedBytes)) {
      throw new TransactionStateError();
    }
    result = journal;
  } catch {
    failure = new TransactionStateError();
  }
  try {
    await handle?.close();
  } catch {
    failure ??= new TransactionStateError();
  }
  if (failure !== undefined || result === undefined) throw failure ?? new TransactionStateError();
  return result;
}

/**
 * No `updatedAt >= createdAt` term: no writer enforces that order (transitions stamp the raw
 * clock), so a wall-clock step back between planning and a transition would refuse a legal
 * journal forever (W2-TX-A-1). The id, kind, createdAt and per-mutation equality bind it.
 */
function exactBootstrapFoundationJournalShape(
  journal: TransactionJournalV1,
  expected: TransactionJournalV1,
): boolean {
  return journal.id === expected.id &&
    journal.kind === expected.kind &&
    journal.createdAt === expected.createdAt &&
    journal.phase !== "rolled_back" &&
    journal.mutations.length === expected.mutations.length &&
    journal.mutations.every((mutation, index) => {
      const planned = expected.mutations[index];
      return planned !== undefined &&
        mutation.targetPath === planned.targetPath &&
        mutation.operation === planned.operation &&
        mutation.expectedBeforeHash === planned.expectedBeforeHash &&
        mutation.stagedRelativePath === planned.stagedRelativePath;
    });
}

async function restoreBootstrapFoundationInitialJournalByIdentity(
  fs: TransactionFileSystem,
  path: CanonicalAbsolutePathV1,
  identity: BootstrapJournalIdentity,
  ownerUid: number,
  expected: TransactionJournalV1,
): Promise<TransactionJournalV1> {
  let handle: Awaited<ReturnType<TransactionFileSystem["open"]>> | undefined;
  let failure: TransactionStateError | undefined;
  let rewritten = false;
  const expectedBytes = new TextEncoder().encode(encodeFoundationJournalJsonV1(expected));
  try {
    const before = await fs.lstat(path, { bigint: true });
    assertOwnedJournalInode(before, ownerUid, identity);
    handle = await fs.open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new TransactionStateError();
    }
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    const linkedAfter = await fs.lstat(path, { bigint: true });
    if (
      afterRead.dev !== opened.dev || afterRead.ino !== opened.ino ||
      linkedAfter.dev !== opened.dev || linkedAfter.ino !== opened.ino ||
      Number(afterRead.size) !== bytes.byteLength || Number(linkedAfter.size) !== bytes.byteLength
    ) throw new TransactionStateError();
    let crashResidue = bytes.byteLength === 0;
    if (!crashResidue) {
      let serialized: string;
      try {
        serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        serialized = "";
        crashResidue = true;
      }
      if (!crashResidue) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(serialized);
        } catch {
          parsed = undefined;
          crashResidue = true;
        }
        if (!crashResidue) {
          let journal: TransactionJournalV1;
          try {
            journal = validateJournal(parsed);
            parseUtcTimestamp(journal.createdAt);
            parseUtcTimestamp(journal.updatedAt);
          } catch {
            throw new TransactionStateError();
          }
          if (!exactBootstrapFoundationJournalShape(journal, expected)) {
            throw new TransactionStateError();
          }
          const canonical = encodeFoundationJournalJsonV1(journal);
          if (serialized !== canonical && `${serialized}\n` !== canonical) {
            throw new TransactionStateError();
          }
        }
      }
    }
    /**
     * Any body but the planned bytes is rewritten to them — crash residue, and also a legal
     * progressed journal (`validated` … `finalized`) on this admitted inode, which is rewound to
     * `planned` on purpose: the caller replays only transitions plus the idempotent
     * `publishBootstrapMutationNoReplace` and its verification, so the replay is safe.
     */
    if (Buffer.compare(bytes, expectedBytes) !== 0) {
      await rewriteInPlace(handle, expectedBytes, identity);
      rewritten = true;
    }
  } catch {
    failure = new TransactionStateError();
  }
  try {
    await handle?.close();
  } catch {
    failure ??= new TransactionStateError();
  }
  if (failure !== undefined) throw failure;
  if (rewritten) {
    await syncReopenDirectory(fs, dirname(path));
    await readExactBootstrapJournalByIdentity(
      fs,
      path,
      identity,
      ownerUid,
      expectedBytes,
    );
  }
  return expected;
}

async function syncReopenDirectory(
  fs: TransactionFileSystem,
  path: string,
): Promise<void> {
  try {
    const before = await fs.lstat(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new TransactionStateError();
    }
    const first = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await first.stat({ bigint: true });
      if (
        !opened.isDirectory() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      ) {
        throw new TransactionStateError();
      }
      await first.sync();
    } finally {
      await first.close();
    }
    const middle = await fs.lstat(path, { bigint: true });
    if (
      middle.isSymbolicLink() ||
      !middle.isDirectory() ||
      middle.dev !== before.dev ||
      middle.ino !== before.ino
    ) {
      throw new TransactionStateError();
    }
    const reopened = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const reopenedStats = await reopened.stat({ bigint: true });
      if (
        !reopenedStats.isDirectory() ||
        reopenedStats.dev !== before.dev ||
        reopenedStats.ino !== before.ino
      ) {
        throw new TransactionStateError();
      }
    } finally {
      await reopened.close();
    }
    const after = await fs.lstat(path, { bigint: true });
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new TransactionStateError();
    }
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

async function exactPublicationParent(
  fs: TransactionFileSystem,
  path: CanonicalAbsolutePathV1,
  expected: BootstrapInitialJournalPublicationV1["sourceParent"],
): Promise<{
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: number;
  readonly mode: 0o700;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}> {
  try {
    const stats = await fs.lstat(path, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      Number(stats.uid) !== expected.ownerUid ||
      (Number(stats.mode) & 0o7777) !== 0o700
    ) {
      throw new TransactionStateError();
    }
    const observed = {
      path,
      ownerUid: expected.ownerUid,
      mode: 0o700,
      dev: stats.dev.toString(10) as UInt64DecimalV1,
      ino: stats.ino.toString(10) as UInt64DecimalV1,
    } satisfies BootstrapInitialJournalPublicationV1["sourceParent"];
    if (
      observed.dev !== expected.dev ||
      observed.ino !== expected.ino ||
      observed.path !== expected.path
    ) throw new TransactionStateError();
    return observed;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

function validateBootstrapFoundationBridgeInput(
  participant: FoundationParticipantRefV2,
  evidence: BootstrapPayloadEvidenceV1,
  dependencies: TransactionExecutorDependencies,
): TransactionJournalV1 {
  const matched = BOOTSTRAP_FOUNDATION_ID_RE.exec(participant.id);
  if (matched === null) throw new TransactionStateError();
  const uuid = matched[1];
  const roleSuffix = matched[2];
  if (
    uuid === undefined ||
    roleSuffix === undefined ||
    (roleSuffix === "f" && participant.role.kind !== "forward") ||
    (roleSuffix === "c" && participant.role.kind !== "compensation")
  ) {
    throw new TransactionStateError();
  }
  const expectedBootstrapId = `fi_${uuid}`;
  const staged = participant.initialJournal.staged;
  const expectedStagedPath = join(
    dependencies.stateDir,
    `.fresh-v2-init.${expectedBootstrapId}.${String(staged.ordinal).padStart(10, "0")}.payload`,
  );
  const expectedFinalPath = join(
    dependencies.stateDir,
    "transactions",
    `${participant.id}.json`,
  );
  if (
    staged.bootstrapId !== expectedBootstrapId ||
    evidence.bootstrapId !== expectedBootstrapId ||
    !Number.isSafeInteger(staged.ordinal) ||
    staged.ordinal < 0 ||
    staged.ordinal > 999_999 ||
    evidence.ordinal !== staged.ordinal ||
    staged.path !== expectedStagedPath ||
    participant.initialJournal.finalPath !== expectedFinalPath ||
    staged.mode !== 0o600 ||
    evidence.mode !== 0o600 ||
    staged.bytes < 1 ||
    staged.bytes > 1_048_576 ||
    staged.bytes > participant.maximumJournalBytes ||
    evidence.bytes !== staged.bytes ||
    evidence.sha256 !== staged.hash ||
    participant.initialJournal.plannedBytesHash !== staged.hash ||
    evidence.stagedPathHash !== hash(new TextEncoder().encode(staged.path)) ||
    !/^[a-f0-9]{64}$/u.test(evidence.sourceIdentityHash) ||
    !DECIMAL_IDENTITY.test(evidence.dev) ||
    !DECIMAL_IDENTITY.test(evidence.ino) ||
    participant.mutations.length < 1 ||
    participant.mutations.length > 256
  ) {
    throw new TransactionStateError();
  }

  const mutations = participant.mutations.map((mutation, index): FileMutation => {
    const expectedStagedRelativePath =
      mutation.operation === "remove" ? null : `${String(index)}.bin`;
    const expectedStandardStagedPath =
      mutation.operation === "remove"
        ? null
        : join(
            dependencies.stagingDir,
            "transactions",
            participant.id,
            expectedStagedRelativePath as string,
          );
    const validShape =
      mutation.operation === "create"
        ? mutation.expectedBeforeHash === null &&
          mutation.contentHash !== null &&
          mutation.contentSize !== null
        : mutation.operation === "remove"
          ? mutation.expectedBeforeHash !== null &&
            mutation.contentHash === null &&
            mutation.contentSize === null
          : mutation.expectedBeforeHash !== null &&
            mutation.contentHash !== null &&
            mutation.contentSize !== null;
    if (
      !validShape ||
      mutation.stagedPath !== expectedStandardStagedPath ||
      !isAbsolute(mutation.targetPath)
    ) {
      throw new TransactionStateError();
    }
    return {
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      stagedRelativePath: expectedStagedRelativePath,
    };
  });

  return {
    schemaVersion: 1,
    id: participant.id,
    kind: participant.slot,
    phase: "planned",
    createdAt: "",
    updatedAt: "",
    mutations,
  };
}

function decodeExactBootstrapFoundationJournal(
  bytes: Uint8Array,
  expected: TransactionJournalV1,
): TransactionJournalV1 {
  try {
    const serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const journal = validateJournal(JSON.parse(serialized) as unknown);
    parseUtcTimestamp(journal.createdAt);
    parseUtcTimestamp(journal.updatedAt);
    if (
      journal.id !== expected.id ||
      journal.kind !== expected.kind ||
      journal.phase !== "planned" ||
      journal.createdAt !== journal.updatedAt ||
      journal.mutations.length !== expected.mutations.length ||
      journal.mutations.some((mutation, index) => {
        const planned = expected.mutations[index];
        return (
          planned === undefined ||
          mutation.targetPath !== planned.targetPath ||
          mutation.operation !== planned.operation ||
          mutation.expectedBeforeHash !== planned.expectedBeforeHash ||
          mutation.stagedRelativePath !== planned.stagedRelativePath
        );
      }) ||
      serialized !== encodeFoundationJournalJsonV1(journal)
    ) {
      throw new TransactionStateError();
    }
    return journal;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

async function removeOwnedTemp(
  fs: TransactionFileSystem,
  temporaryPath: string,
): Promise<void> {
  try {
    await fs.unlink(temporaryPath);
  } catch (error) {
    if (!isMissing(error)) throw new TransactionStateError();
  }
}

/** The temp `applyMutation` renames onto a target; it sits in the user's own directory. */
function applyTempPath(id: string, index: number, targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${id}-${String(index)}.tmp`);
}

async function writeDurableFile(
  fs: TransactionFileSystem,
  destination: string,
  temporaryPath: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> {
  await removeOwnedTemp(fs, temporaryPath);
  const handle = await fs.open(temporaryPath, "wx", mode);
  // One cleanup for every failure after the temp exists: it may hold a secret's pre-edit bytes.
  try {
    try {
      await handle.writeFile(bytes);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, destination);
    await syncDirectory(fs, dirname(destination));
  } catch {
    await removeOwnedTemp(fs, temporaryPath);
    throw new TransactionStateError();
  }
}

function metadataBytes(metadata: BackupMetadata): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(metadata)}\n`);
}

function parseMetadata(serialized: string): BackupMetadata {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TransactionStateError();
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.join(",") !== "atimeMs,existed,mode,mtimeMs" ||
      typeof record.existed !== "boolean"
    ) {
      throw new TransactionStateError();
    }
    if (record.existed) {
      if (
        typeof record.mode !== "number" ||
        typeof record.atimeMs !== "number" ||
        typeof record.mtimeMs !== "number"
      ) {
        throw new TransactionStateError();
      }
    } else if (
      record.mode !== null ||
      record.atimeMs !== null ||
      record.mtimeMs !== null
    ) {
      throw new TransactionStateError();
    }
    return record as unknown as BackupMetadata;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

export class TransactionExecutor {
  private readonly dependencies: TransactionExecutorDependencies;
  private readonly store: TransactionStore;

  constructor(dependencies: TransactionExecutorDependencies) {
    this.dependencies = dependencies;
    this.store = new TransactionStore({
      stateDir: dependencies.stateDir,
      fs: dependencies.fs,
      lockProvider: dependencies.lockProvider,
    });
  }

  async execute(plan: TransactionPlan): Promise<TransactionJournalV1> {
    this.validatePlan(plan);
    const id = this.dependencies.generateId();
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new TransactionPlanError();
    return this.store.withTransactionLock(id, async () => {
      await this.ensureTransactionDirectories(id);

      const mutations: FileMutation[] = [];
      for (const [index, planned] of plan.mutations.entries()) {
        await this.assertTarget(planned.targetPath);
        const before = await this.snapshot(planned.targetPath);
        if (planned.operation === "create" ? before !== null : before === null) {
          throw new TransactionPlanError();
        }
        /**
         * **The caller's precondition, honoured before anything is staged.** Everything
         * between a caller's own read and this snapshot is invisible to the executor, so a
         * caller that read the file supplies what it read and this refuses rather than
         * silently overwriting a change it never saw. Refusing *here* — before this
         * mutation's `writeStaged` — is what lets the refusal promise that the target is
         * untouched.
         *
         * **"Nothing was written" is about the target, not the transaction directory.** For a
         * multi-mutation plan, mutation *i*'s bytes are staged before mutation *i+1*'s
         * precondition is checked, so an earlier target may already have a staged copy; and
         * every refusal leaves an empty `staging/` and `backups/` directory with no journal,
         * which no `status` or `repair` path sweeps. Both are true of `TransactionPlanError`
         * beside it, but a precondition is designed to fire routinely, so the residue is
         * routine too.
         *
         * `TransactionPreconditionError`, which the plan asked for and an earlier version of
         * this change declined to add — arguing a second class would need handling at every
         * catch site, which is what `extends` is for. It subclasses `TransactionConflictError`,
         * so every existing `catch` and the exit code are unchanged, and a caller that wants
         * the stronger promise asks for the subclass. That promise turned out to be
         * structurally necessary, not cosmetic: `ingest` compensates a failed stage by writing
         * the pre-read envelope back, and without a way to tell a plan-phase refusal from a
         * mid-transaction one it wrote that copy over the very hand edit the refusal had just
         * protected.
         */
        const observed = before === null ? null : hash(before.bytes);
        if (
          planned.expectedBeforeHash !== undefined &&
          planned.expectedBeforeHash !== observed
        ) {
          throw new TransactionPreconditionError();
        }

        const stagedRelativePath =
          planned.operation === "remove" ? null : `${String(index)}.bin`;
        if (stagedRelativePath !== null) {
          const content = planned.content;
          if (content === null) throw new TransactionPlanError();
          await this.writeStaged(id, stagedRelativePath, content);
        }
        mutations.push({
          targetPath: planned.targetPath,
          operation: planned.operation,
          expectedBeforeHash: observed,
          stagedRelativePath,
        });
      }

      const createdAt = this.dependencies.clock();
      const journal = await this.store.create({
        schemaVersion: 1,
        id,
        kind: plan.kind,
        phase: "planned",
        createdAt,
        updatedAt: createdAt,
        mutations,
      });
      await this.runHook("planned", journal);
      return this.resume(id);
    });
  }

  /**
   * Publishes the bootstrap coordinator's already-planned Foundation journal, then enters
   * the unchanged transaction state machine while the same stable transaction lock is held.
   */
  async executeBootstrapFoundationParticipant(
    admitted: AdmittedBootstrapFoundationInitialJournalV1,
  ): Promise<TransactionJournalV1> {
    const {
      participant,
      evidence,
      ownerUid,
      sourceParent: admittedSourceParent,
      destinationParent: admittedDestinationParent,
      mutationPublications,
      initialJournal,
    } =
      consume(retainedBootstrapFoundationInitialJournals, admitted);
    const expectedShape = validateBootstrapFoundationBridgeInput(
      participant,
      evidence,
      this.dependencies,
    );
    const expected = {
      ...expectedShape,
      createdAt: initialJournal.createdAt,
      updatedAt: initialJournal.updatedAt,
    };
    if (encodeFoundationJournalJsonV1(expected) !== encodeFoundationJournalJsonV1(initialJournal)) {
      throw new TransactionStateError();
    }
    const stagedPath = participant.initialJournal.staged.path;
    const finalPath = participant.initialJournal.finalPath;

    return this.store.withTransactionLock(participant.id, async () => {
      const [stagedBefore, finalBefore] = await Promise.all([
        optionalLstat(this.dependencies.fs, stagedPath),
        optionalLstat(this.dependencies.fs, finalPath),
      ]);
      if (
        stagedBefore === null && finalBefore === null
      ) {
        throw new TransactionStateError();
      }

      if (stagedBefore !== null) {
        const observed = await readExactBootstrapJournal(
          this.dependencies.fs,
          stagedPath,
          evidence,
          ownerUid,
        );
        decodeExactBootstrapFoundationJournal(observed.bytes, expected);
        if (finalBefore !== null) {
          throw new TransactionStateError();
        }
        const publish =
          this.dependencies.publishBootstrapInitialJournalNoReplace;
        if (publish === undefined) throw new TransactionStateError();
        const [sourceParent, destinationParent] = await Promise.all([
          exactPublicationParent(this.dependencies.fs, dirname(stagedPath) as CanonicalAbsolutePathV1, admittedSourceParent),
          exactPublicationParent(this.dependencies.fs, dirname(finalPath) as CanonicalAbsolutePathV1, admittedDestinationParent),
        ]);
        try {
          await publish({
            sourcePath: stagedPath,
            destinationPath: finalPath,
            sourceParent,
            destinationParent,
            postimage: {
              kind: "regular_file",
              ownerUid,
              mode: 0o600,
              nlink: 1,
              bytes: String(evidence.bytes) as UInt64DecimalV1,
              sha256: evidence.sha256,
              dev: observed.identity.dev,
              ino: observed.identity.ino,
            },
          });
        } catch {
          throw new TransactionStateError();
        }
      }

      await syncReopenDirectory(this.dependencies.fs, dirname(stagedPath));
      await syncReopenDirectory(this.dependencies.fs, dirname(finalPath));
      const [stagedAfter, finalAfter] = await Promise.all([
        optionalLstat(this.dependencies.fs, stagedPath),
        optionalLstat(this.dependencies.fs, finalPath),
      ]);
      if (stagedAfter !== null || finalAfter === null) {
        throw new TransactionStateError();
      }
      const finalJournal = await restoreBootstrapFoundationInitialJournalByIdentity(
        this.dependencies.fs,
        finalPath,
        { dev: evidence.dev, ino: evidence.ino },
        ownerUid,
        expected,
      );
      const identity = {
        dev: finalAfter.dev.toString(10) as UInt64DecimalV1,
        ino: finalAfter.ino.toString(10) as UInt64DecimalV1,
      };
      if (identity.dev !== evidence.dev || identity.ino !== evidence.ino) {
        throw new TransactionStateError();
      }
      return this.resumeBootstrapFoundationLocked(
        participant,
        mutationPublications,
        (journal, nextPhase) => this.transitionBootstrapFoundationInPlace(
          journal,
          nextPhase,
          finalPath,
          identity,
          ownerUid,
        ),
        finalJournal,
      );
    });
  }

  async executeLifecycleFoundationParticipant(
    admitted: AdmittedLifecycleFoundationInitialJournalV1,
  ): Promise<TransactionJournalV1> {
    const retained = consume(retainedLifecycleFoundationInitialJournals, admitted);
    const { ref, ownerUid, initialJournal, plannedBytes } = retained;
    validateLifecycleFoundationBridgeInput(ref, this.dependencies);
    const stagedPath = ref.initialJournal.stagedPath;
    const finalPath = ref.initialJournal.finalPath;
    const identity = {
      dev: ref.initialJournal.stagedIdentity.dev,
      ino: ref.initialJournal.stagedIdentity.ino,
    };

    return this.store.withTransactionLock(ref.id, async () => {
      const [stagedBefore, finalBefore] = await Promise.all([
        optionalLstat(this.dependencies.fs, stagedPath),
        optionalLstat(this.dependencies.fs, finalPath),
      ]);
      if ((stagedBefore === null) === (finalBefore === null)) {
        throw new TransactionStateError();
      }

      if (stagedBefore !== null) {
        await readExactBootstrapJournalByIdentity(
          this.dependencies.fs,
          stagedPath,
          identity,
          ownerUid,
          plannedBytes,
        );
        const publish = this.dependencies.publishBootstrapInitialJournalNoReplace;
        if (publish === undefined) throw new TransactionStateError();
        const [sourceParent, destinationParent] = await Promise.all([
          exactPublicationParent(
            this.dependencies.fs,
            dirname(stagedPath) as CanonicalAbsolutePathV1,
            retained.sourceParent,
          ),
          exactPublicationParent(
            this.dependencies.fs,
            dirname(finalPath) as CanonicalAbsolutePathV1,
            retained.destinationParent,
          ),
        ]);
        try {
          await publish({
            sourcePath: stagedPath,
            destinationPath: finalPath,
            sourceParent,
            destinationParent,
            postimage: {
              kind: "regular_file",
              ownerUid,
              mode: 0o600,
              nlink: 1,
              bytes: String(plannedBytes.byteLength) as UInt64DecimalV1,
              sha256: ref.initialJournal.plannedBytesHash,
              dev: identity.dev,
              ino: identity.ino,
            },
          });
        } catch {
          throw new TransactionStateError();
        }
        await syncReopenDirectory(this.dependencies.fs, dirname(stagedPath));
        await syncReopenDirectory(this.dependencies.fs, dirname(finalPath));
        const [stagedAfter, finalAfter] = await Promise.all([
          optionalLstat(this.dependencies.fs, stagedPath),
          optionalLstat(this.dependencies.fs, finalPath),
        ]);
        if (stagedAfter !== null || finalAfter === null) {
          throw new TransactionStateError();
        }
        await readExactBootstrapJournalByIdentity(
          this.dependencies.fs,
          finalPath,
          identity,
          ownerUid,
          plannedBytes,
        );
      } else {
        const observed = await this.store.read(ref.id);
        if (!exactBootstrapFoundationJournalShape(observed, initialJournal)) {
          throw new TransactionStateError();
        }
        /**
         * The pre-recorded staged inode binds only the pre-transition state: the unchanged
         * store rewrites a journal through `.<id>.<uuid>.json.tmp` and a rename, so every
         * phase past `planned` legitimately carries a new inode. Requiring the staged
         * identity here would make each resume a permanent third state.
         */
        if (observed.phase === "planned") {
          await readExactBootstrapJournalByIdentity(
            this.dependencies.fs,
            finalPath,
            identity,
            ownerUid,
            plannedBytes,
          );
        }
      }

      return this.resume(ref.id);
    });
  }

  /**
   * Spec 2 §5.3 (D60): at an update ref's Foundation cursor, no-replace-publishes each
   * content row then its sidecar to the standard `<tx>/<i>.bin` pair, then the staged
   * initial journal, then resumes the unchanged state machine under the same lock. A pair
   * is adopted only at its construction-evidence inode; any other state is exit 6.
   */
  async executeUpdateFoundationParticipant(
    admitted: AdmittedUpdateFoundationInitialJournalV1,
  ): Promise<TransactionJournalV1> {
    const retained = consume(retainedUpdateFoundationInitialJournals, admitted);
    const { ref, ownerUid, initialJournal, plannedBytes, journalIdentity } = retained;
    validateUpdateFoundationBridgeInput(ref, this.dependencies);
    const stagedPath = ref.initialJournal.staged.path;
    const finalPath = ref.initialJournal.finalPath;

    return this.store.withTransactionLock(ref.id, async () => {
      const [stagedBefore, finalBefore] = await Promise.all([
        optionalLstat(this.dependencies.fs, stagedPath),
        optionalLstat(this.dependencies.fs, finalPath),
      ]);
      if ((stagedBefore === null) === (finalBefore === null)) {
        throw new TransactionStateError();
      }

      if (stagedBefore !== null) {
        await readExactBootstrapJournalByIdentity(
          this.dependencies.fs,
          stagedPath,
          journalIdentity,
          ownerUid,
          plannedBytes,
        );
        await this.ensureTransactionDirectories(ref.id);
        const stageParent = await observedPublicationParent(
          this.dependencies.fs,
          this.stageDirectory(ref.id) as CanonicalAbsolutePathV1,
          ownerUid,
        );
        for (const [index, mutation] of ref.mutations.entries()) {
          const identities = retained.payloadIdentities[index];
          if (mutation.operation === "remove") continue;
          if (
            mutation.content === null ||
            mutation.digest === null ||
            mutation.stagedPath === null ||
            identities === null ||
            identities === undefined
          ) {
            throw new TransactionStateError();
          }
          const pairs = [
            [mutation.content, mutation.stagedPath, identities.content],
            [mutation.digest, `${mutation.stagedPath}.sha256`, identities.digest],
          ] as const;
          for (const [payload, destinationPath, identity] of pairs) {
            await this.publishBootstrapMutationNoReplace({
              sourcePath: payload.path,
              destinationPath: destinationPath as CanonicalAbsolutePathV1,
              sourceParent: retained.payloadParent,
              destinationParent: stageParent,
              postimage: {
                kind: "regular_file",
                ownerUid,
                mode: payload.mode === 0o700 ? 0o700 : 0o600,
                nlink: 1,
                bytes: String(payload.bytes) as UInt64DecimalV1,
                sha256: payload.sha256,
                dev: identity.dev,
                ino: identity.ino,
              },
            });
          }
        }
        const publish = this.dependencies.publishBootstrapInitialJournalNoReplace;
        if (publish === undefined) throw new TransactionStateError();
        const [sourceParent, destinationParent] = await Promise.all([
          exactPublicationParent(
            this.dependencies.fs,
            dirname(stagedPath) as CanonicalAbsolutePathV1,
            retained.sourceParent,
          ),
          exactPublicationParent(
            this.dependencies.fs,
            dirname(finalPath) as CanonicalAbsolutePathV1,
            retained.destinationParent,
          ),
        ]);
        try {
          await publish({
            sourcePath: stagedPath,
            destinationPath: finalPath,
            sourceParent,
            destinationParent,
            postimage: {
              kind: "regular_file",
              ownerUid,
              mode: 0o600,
              nlink: 1,
              bytes: String(plannedBytes.byteLength) as UInt64DecimalV1,
              sha256: ref.initialJournal.plannedBytesHash,
              dev: journalIdentity.dev,
              ino: journalIdentity.ino,
            },
          });
        } catch {
          throw new TransactionStateError();
        }
        await syncReopenDirectory(this.dependencies.fs, dirname(stagedPath));
        await syncReopenDirectory(this.dependencies.fs, dirname(finalPath));
        const [stagedAfter, finalAfter] = await Promise.all([
          optionalLstat(this.dependencies.fs, stagedPath),
          optionalLstat(this.dependencies.fs, finalPath),
        ]);
        if (stagedAfter !== null || finalAfter === null) {
          throw new TransactionStateError();
        }
        await readExactBootstrapJournalByIdentity(
          this.dependencies.fs,
          finalPath,
          journalIdentity,
          ownerUid,
          plannedBytes,
        );
      } else {
        const observed = await this.store.read(ref.id);
        if (!exactBootstrapFoundationJournalShape(observed, initialJournal)) {
          throw new TransactionStateError();
        }
        // As in the V1 arm: only `planned` still carries the construction inode.
        if (observed.phase === "planned") {
          await readExactBootstrapJournalByIdentity(
            this.dependencies.fs,
            finalPath,
            journalIdentity,
            ownerUid,
            plannedBytes,
          );
        }
      }

      return this.resume(ref.id);
    });
  }

  private async assertExactBootstrapPublicationPostimage(
    path: CanonicalAbsolutePathV1,
    request: BootstrapInitialJournalPublicationV1,
  ): Promise<void> {
    const expected = request.postimage;
    if (expected.kind !== "regular_file") throw new TransactionStateError();
    const before = await optionalLstat(this.dependencies.fs, path);
    if (
      before === null ||
      before.isSymbolicLink() ||
      !before.isFile() ||
      Number(before.uid) !== expected.ownerUid ||
      (Number(before.mode) & 0o7777) !== expected.mode ||
      Number(before.nlink) !== expected.nlink ||
      Number(before.size) !== Number(expected.bytes) ||
      before.dev.toString(10) !== expected.dev ||
      before.ino.toString(10) !== expected.ino
    ) throw new TransactionStateError();
    const bytes = await this.dependencies.fs.readFile(path);
    const after = await optionalLstat(this.dependencies.fs, path);
    if (
      after === null ||
      after.dev.toString(10) !== expected.dev ||
      after.ino.toString(10) !== expected.ino ||
      hash(bytes) !== expected.sha256
    ) throw new TransactionStateError();
  }

  private async publishBootstrapMutationNoReplace(
    request: BootstrapInitialJournalPublicationV1,
  ): Promise<void> {
    const publish = this.dependencies.publishBootstrapInitialJournalNoReplace;
    if (publish === undefined) throw new TransactionStateError();
    const [sourceBefore, destinationBefore] = await Promise.all([
      optionalLstat(this.dependencies.fs, request.sourcePath),
      optionalLstat(this.dependencies.fs, request.destinationPath),
    ]);
    if ((sourceBefore === null) === (destinationBefore === null)) {
      throw new TransactionStateError();
    }
    await Promise.all([
      exactPublicationParent(this.dependencies.fs, request.sourceParent.path, request.sourceParent),
      exactPublicationParent(this.dependencies.fs, request.destinationParent.path, request.destinationParent),
    ]);
    if (sourceBefore !== null) {
      await this.assertExactBootstrapPublicationPostimage(request.sourcePath, request);
      try {
        await publish(structuredClone(request));
      } catch {
        throw new TransactionStateError();
      }
    } else {
      await this.assertExactBootstrapPublicationPostimage(request.destinationPath, request);
    }
    await syncReopenDirectory(this.dependencies.fs, dirname(request.sourcePath));
    await syncReopenDirectory(this.dependencies.fs, dirname(request.destinationPath));
    const sourceAfter = await optionalLstat(this.dependencies.fs, request.sourcePath);
    if (sourceAfter !== null) throw new TransactionStateError();
    await this.assertExactBootstrapPublicationPostimage(request.destinationPath, request);
    await Promise.all([
      exactPublicationParent(this.dependencies.fs, request.sourceParent.path, request.sourceParent),
      exactPublicationParent(this.dependencies.fs, request.destinationParent.path, request.destinationParent),
    ]);
  }

  private async verifyBootstrapMutationPublications(
    publications: readonly BootstrapInitialJournalPublicationV1[],
  ): Promise<void> {
    for (const request of publications) {
      if (await optionalLstat(this.dependencies.fs, request.sourcePath) !== null) {
        throw new TransactionStateError();
      }
      await this.assertExactBootstrapPublicationPostimage(request.destinationPath, request);
    }
  }

  private async resumeBootstrapFoundationLocked(
    participant: FoundationParticipantRefV2,
    publications: readonly BootstrapInitialJournalPublicationV1[],
    transition: JournalTransition,
    admittedJournal: TransactionJournalV1,
  ): Promise<TransactionJournalV1> {
    let journal = admittedJournal;
    if (participant.role.kind === "forward" && publications.length !== journal.mutations.length) {
      throw new TransactionStateError();
    }
    while (journal.phase !== "finalized") {
      switch (journal.phase) {
        case "planned":
          journal = await transition(journal, "backed_up");
          break;
        case "backed_up":
          journal = await transition(journal, "staged");
          break;
        case "staged":
          journal = await transition(journal, "validated");
          break;
        case "validated":
          for (const request of publications) {
            await this.publishBootstrapMutationNoReplace(request);
          }
          journal = await transition(journal, "applied");
          break;
        case "applied":
          await this.verifyBootstrapMutationPublications(publications);
          journal = await transition(journal, "verified");
          break;
        case "verified":
          await this.verifyBootstrapMutationPublications(publications);
          journal = await transition(journal, "finalized");
          break;
        case "rolled_back":
          throw new TransactionStateError();
        default:
          throw new TransactionStateError();
      }
    }
    await this.verifyBootstrapMutationPublications(publications);
    return journal;
  }

  async resume(id: string): Promise<TransactionJournalV1> {
    refuseBootstrapFoundationId(id);
    return this.store.withTransactionLock(id, () => this.resumeLocked(id));
  }

  private async resumeLocked(
    id: string,
    transition: JournalTransition = (journal, nextPhase) => this.transition(journal, nextPhase),
    admittedJournal?: TransactionJournalV1,
    bootstrapBound = false,
  ): Promise<TransactionJournalV1> {
    let journal = admittedJournal ?? await this.store.read(id);
    if (journal.phase === "finalized") {
      /**
       * **The crash window, swept on the next resume.** The prune runs after the
       * `finalized` transition, so a process that dies between them leaves a journal
       * reading `finalized` with the payload still on disk — and every recovery path then
       * refuses it: this function used to return here, `rollbackLocked` throws, and
       * `repair` rejected a finalized id before the executor saw it. The bytes were
       * stranded permanently while the product reported success.
       *
       * Pruning here as well makes the operation idempotent and gives that window a way
       * out: `repair --resume <id>` on a finalized transaction now cleans it up instead of
       * being a no-op. Ordering the prune after the transition is still right — the
       * reverse would destroy the only copy while a rollback might need it — but it is
       * only *safe* because of this line.
       */
      if (bootstrapBound) await this.verifyDesired(journal);
      await this.pruneBackups(journal, { raiseOnFailure: true });
      return journal;
    }
    if (journal.phase === "rolled_back") throw new TransactionStateError();

    while (journal.phase !== "finalized") {
      switch (journal.phase) {
        case "planned":
          journal = await this.backUp(journal, transition);
          break;
        case "backed_up":
          journal = await this.stage(journal, transition);
          break;
        case "staged":
          journal = await this.validate(journal, transition);
          break;
        case "validated":
          journal = await this.apply(journal, transition);
          break;
        case "applied":
          journal = await this.verifyAndTransition(journal, transition);
          break;
        case "verified":
          await this.verifyDesired(journal);
          journal = await transition(journal, "finalized");
          /**
           * **The one prune site a command can reach, so the one that must not raise.**
           * `execute` funnels through here, and its seven call sites — six commands, `ingest`
           * twice — all read a throw as
           * "nothing happened" — which this failure is not. A retained payload is left
           * for `doctor` to report and `repair --resume <id>` to sweep.
           */
          await this.pruneBackups(journal, { raiseOnFailure: false });
          break;
        default:
          throw new TransactionStateError();
      }
    }
    return journal;
  }

  async rollback(id: string): Promise<TransactionJournalV1> {
    refuseBootstrapFoundationId(id);
    return this.store.withTransactionLock(id, () => this.rollbackLocked(id));
  }

  private async rollbackLocked(id: string): Promise<TransactionJournalV1> {
    let journal = await this.store.read(id);
    if (journal.phase === "rolled_back") {
      /**
       * **The mirror of `resumeLocked`'s sweep, and leaving it out was the same defect
       * twice.** A crash between the `rolled_back` transition and the prune strands the
       * payload exactly as the finalized window did, on the flow the product recommends —
       * and it is worse there, because a retried `rollback` returned `rolled_back`
       * *successfully* while doing nothing, so the user is told it failed, runs it again,
       * is told it worked, and the secret is still on disk.
       *
       * **`repair --rollback <id>` is what reaches this**, and it had to be opened for it:
       * the gate in `runRepair` refused a `rolled_back` journal for *both* actions, so this
       * early return was as unreachable from the product as `resumeLocked`'s was before it
       * — the same defect, on the mirror side, found by the same review.
       */
      await this.pruneBackups(journal, { raiseOnFailure: true });
      return journal;
    }
    if (journal.phase === "finalized") throw new TransactionStateError();

    if (
      journal.phase === "validated" ||
      journal.phase === "applied" ||
      journal.phase === "verified"
    ) {
      for (let index = journal.mutations.length - 1; index >= 0; index -= 1) {
        await this.restoreMutation(journal, index);
      }
      await this.verifyOriginal(journal);
    }

    journal = await this.transition(journal, "rolled_back");
    /**
     * **`rolled_back` is as terminal as `finalized`, so the payload is as dead** — and
     * leaving it was the larger half of this defect. `resumeLocked` throws on a rolled-back
     * journal and `store.transition` refuses every transition out of it, so nothing can ever
     * read these bytes again either. (`repair` used to reject the id outright, which is what
     * made the early return above unreachable; it now accepts `--rollback` here.)
     *
     * **And this is the path the product tells the user to take.** `review`'s conflict
     * message says to resolve it with `developer-os repair` first; `doctor` and `init` both
     * print `repair --rollback <id>` verbatim. So the flow was: an `edit` that removes a
     * pasted secret hits a conflict, the product recommends a rollback, the user retries,
     * the product reports the secret removed — and a raw copy of it stayed in the first
     * transaction's backup directory forever.
     *
     * Raising here is unambiguous where raising on the forward path is not: `rollback` has
     * exactly one caller, `recoverTransaction`, and exactly one entry point above it,
     * `repair --rollback`. Nothing downstream of it has bookkeeping left to skip.
     */
    await this.pruneBackups(journal, { raiseOnFailure: true });
    return journal;
  }

  private validatePlan(plan: unknown): void {
    if (
      !isRecord(plan) ||
      !hasExactKeys(plan, ["kind", "mutations"]) ||
      typeof plan.kind !== "string" ||
      plan.kind.length === 0 ||
      !isUnknownArray(plan.mutations) ||
      plan.mutations.length === 0
    ) {
      throw new TransactionPlanError();
    }
    const targets = new Set<string>();
    for (const mutation of plan.mutations) {
      if (
        !isRecord(mutation) ||
        !hasKeys(
          mutation,
          ["content", "operation", "targetPath"],
          ["expectedBeforeHash"],
        )
      ) {
        throw new TransactionPlanError();
      }
      /**
       * **Shape-checked, not merely typed.** `store.ts` already demands
       * `/^[a-f0-9]{64}$/` of a persisted hash while this accepted any string from a caller —
       * so a caller with a bug that produced `""` supplied a precondition that could never
       * match, and every call refused for ever with a message saying the file had changed.
       * That is precisely the failure this task spent a round on. A malformed precondition is
       * a malformed plan, and says so loudly at the first call rather than quietly at all of
       * them.
       */
      const expected = mutation.expectedBeforeHash;
      if (
        expected !== undefined &&
        (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected))
      ) {
        throw new TransactionPlanError();
      }
      const operation = mutation.operation;
      const targetPath = mutation.targetPath;
      const content = mutation.content;
      if (
        operation !== "create" &&
        operation !== "replace" &&
        operation !== "remove"
      ) {
        throw new TransactionPlanError();
      }
      const validContent =
        operation === "remove"
          ? content === null
          : content instanceof Uint8Array;
      if (
        typeof targetPath !== "string" ||
        !isAbsolute(targetPath) ||
        targets.has(targetPath) ||
        !validContent
      ) {
        throw new TransactionPlanError();
      }
      targets.add(targetPath);
    }
  }

  private async assertTarget(targetPath: string): Promise<void> {
    try {
      await this.dependencies.guards.assertTarget(targetPath);
    } catch (error) {
      const code =
        isRecord(error) && error.code === EXIT_CODES.decisionRequired
          ? EXIT_CODES.decisionRequired
          : EXIT_CODES.securityRefusal;
      throw new TransactionGuardError(code);
    }
  }

  private async snapshot(targetPath: string): Promise<ExistingSnapshot | null> {
    try {
      /**
       * identity-free stat: mode and times only, never `dev`/`ino`.
       * `BigIntStats.atimeMs` and `.mtimeMs` are whole milliseconds, while
       * `Stats` keeps the sub-millisecond fraction that this backup metadata is
       * compared against on rollback (`verifyOriginal`).
       */
      const stats = await this.dependencies.fs.stat(targetPath);
      if (!stats.isFile()) throw new TransactionConflictError();
      const bytes = await this.dependencies.fs.readFile(targetPath);
      return {
        bytes,
        mode: stats.mode & 0o777,
        atimeMs: stats.atimeMs,
        mtimeMs: stats.mtimeMs,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async ensureTransactionDirectories(id: string): Promise<void> {
    for (const directory of [this.stageDirectory(id), this.backupDirectory(id)]) {
      await this.dependencies.fs.mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        const stats = await this.dependencies.fs.lstat(directory, { bigint: true });
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new TransactionStateError();
        }
      } catch (error) {
        if (error instanceof TransactionStateError) throw error;
        throw new TransactionStateError();
      }
      await this.dependencies.fs.chmod(directory, 0o700);
    }
  }

  private stageDirectory(id: string): string {
    return join(this.dependencies.stagingDir, "transactions", id);
  }

  /**
   * **The backup payloads are dead bytes once a transaction reaches a terminal phase, and
   * one of them may be a secret** (BACKLOG, Foundation request 2). Both `finalized` and
   * `rolled_back` are terminal — `store.transition` refuses every transition out of either,
   * `rollbackLocked` throws on a finalized journal and `resumeLocked` on a rolled-back one —
   * so nothing in this product can ever read them again. Called from four sites — the
   * finalize transition, the rollback transition, and each of the two terminal
   * early-returns — and an earlier version of this sentence said three while listing
   * four. Meanwhile
   * `review --decision edit` exists precisely to remove a secret a user pasted into a
   * vault file by hand, and `backUp` wrote that file here raw at mode `0600` before the
   * edit landed. Retaining it undoes the one operation whose purpose is removal.
   *
   * **After the transition, never before.** The reverse order would destroy the only copy
   * of the user's file at exactly the moment a rollback might still need it. A crash
   * between the two leaves the payload on disk with the journal already terminal —
   * **which is not free**: an earlier version of this paragraph said it cost nothing, and
   * it cost the whole defect, permanently, while the product reported success. It is safe
   * only because both terminal early-returns prune as well, so the next `resume` or
   * `rollback` sweeps it, and `repair --resume` can reach a finalized journal to do so.
   *
   * **The payloads only — the `<index>.json` metadata stays.** The secret is in the bytes;
   * the metadata is `{existed, mode, atimeMs, mtimeMs}` and carries none of it. Removing it
   * too breaks a journal that is rewound to an earlier phase and resumed, because the
   * metadata is how `restore` learns whether a target existed at all — and eighteen e2e
   * cases build their fixtures exactly that way. Deleting a description of bytes that are
   * gone buys nothing and costs that.
   *
   * **Derived from the journal rather than enumerated.** `TransactionFileSystem` offers no
   * `readdir`, and it does not need one: `backUp` names every payload `<index>.bin` from
   * `journal.mutations.entries()`, so the journal is the index. A mutation whose target did
   * not exist wrote no payload, which is why a missing file is not an error here.
   *
   * **`<index>.bin.tmp` carries the same bytes and is removed too.** `writeDurableFile`
   * writes the payload to that name and renames it into place, so a kill inside `backUp`
   * leaves the pre-edit file — the secret, in the case this whole change exists for —
   * under a `.tmp` suffix. `removeOwnedTemp` clears it on a `resume` that re-runs `backUp`,
   * but a `rollback` never re-runs that phase, so the route `doctor` and `init` both print
   * orphaned it permanently, and the `.bin`-only sweep could not see it (found by
   * fresh-context review, 2026-08-17).
   *
   * **The directory is left behind, deliberately** — and it is not empty, which an earlier
   * version of this paragraph claimed. The `<index>.json` metadata and its `.sha256` stay
   * by the rule two paragraphs up: thirty files after one `init`, none of them bytes.
   * Removing the directory needs `rmdir` on a frozen interface, and
   * `<state>/transactions/` already accumulates one artifact per transaction id, which is
   * an open founder question in `foundation-constraints.md`; this joins that question
   * rather than answering it unilaterally.
   *
   * **Failure is never swallowed, and on the `repair` paths it is raised** — the paragraph
   * here used to say a blanket catch was fine, and that catch turned `EACCES` on a
   * non-writable backups directory into a silent no-op. `ENOENT` alone is expected.
   *
   * Anything else raises `TransactionBackupRetentionError` when the caller can only be
   * `repair`, and otherwise leaves the payload for `doctor` to report — see that class's
   * docblock for why the forward path cannot raise. Both halves keep the failure visible;
   * only the channel differs, and the one thing neither does is report a clean success.
   */
  private async pruneBackups(
    journal: TransactionJournalV1,
    options: { readonly raiseOnFailure: boolean },
  ): Promise<void> {
    const directory = this.backupDirectory(journal.id);
    let retained: { readonly path: string; readonly reason: string } | null = null;
    for (const [index] of journal.mutations.entries()) {
      for (const suffix of [".bin", ".bin.tmp"]) {
        const payload = join(directory, `${String(index)}${suffix}`);
        try {
          await this.dependencies.fs.unlink(payload);
        } catch (error) {
          /**
           * **`ENOENT` only** — already pruned, or never written because the target did
           * not exist. Everything else is a retained payload: raised where `repair` is the
           * sole caller, and left standing where a command is, because a throw there means
           * "nothing happened" to seven call sites and this failure means the opposite.
           *
           * **The loop does not stop, and it did before.** Throwing on the first failure
           * left payloads 4 and 5 on disk because payload 3 could not be removed — a
           * per-file permission or `EIO` fault turning into a wholesale retention. The
           * first one that survived is the one named; the rest are still attempted, on
           * both the raising and the retaining path.
           */
          if (isMissing(error)) continue;
          retained ??= { path: payload, reason: errnoOf(error) };
        }
      }
    }
    if (retained !== null && options.raiseOnFailure) {
      throw new TransactionBackupRetentionError(
        retained.path,
        journal.phase === "rolled_back" ? "rolled back" : "applied",
        retained.reason,
        directory,
      );
    }
  }

  private backupDirectory(id: string): string {
    return join(this.dependencies.backupsDir, "transactions", id);
  }

  private async writeStaged(
    id: string,
    relativePath: string,
    content: Uint8Array,
  ): Promise<void> {
    const destination = join(this.stageDirectory(id), relativePath);
    await writeDurableFile(
      this.dependencies.fs,
      destination,
      `${destination}.tmp`,
      content,
      0o600,
    );
    const digestPath = `${destination}.sha256`;
    await writeDurableFile(
      this.dependencies.fs,
      digestPath,
      `${digestPath}.tmp`,
      new TextEncoder().encode(`${hash(content)}\n`),
      0o600,
    );
  }

  private async stagedBytes(
    journal: TransactionJournalV1,
    mutation: FileMutation,
  ): Promise<Uint8Array | null> {
    if (mutation.operation === "remove") return null;
    if (mutation.stagedRelativePath === null) throw new TransactionStateError();
    const stagedPath = join(
      this.stageDirectory(journal.id),
      mutation.stagedRelativePath,
    );
    try {
      const [content, persistedDigest] = await Promise.all([
        this.readArtifact(this.stageDirectory(journal.id), stagedPath),
        this.readArtifact(
          this.stageDirectory(journal.id),
          `${stagedPath}.sha256`,
        ),
      ]);
      const serializedDigest = new TextDecoder().decode(persistedDigest);
      if (
        !/^[a-f0-9]{64}\n$/.test(serializedDigest) ||
        serializedDigest !== `${hash(content)}\n`
      ) {
        throw new TransactionStateError();
      }
      return content;
    } catch {
      throw new TransactionStateError();
    }
  }

  private async backUp(
    journal: TransactionJournalV1,
    transition: JournalTransition = (current, phase) => this.transition(current, phase),
  ): Promise<TransactionJournalV1> {
    await this.ensureTransactionDirectories(journal.id);
    for (const [index, mutation] of journal.mutations.entries()) {
      await this.assertTarget(mutation.targetPath);
      const snapshot = await this.snapshot(mutation.targetPath);
      const currentHash = snapshot === null ? null : hash(snapshot.bytes);
      if (currentHash !== mutation.expectedBeforeHash) {
        throw new TransactionConflictError();
      }

      const directory = this.backupDirectory(journal.id);
      if (snapshot !== null) {
        const backupPath = join(directory, `${String(index)}.bin`);
        await writeDurableFile(
          this.dependencies.fs,
          backupPath,
          `${backupPath}.tmp`,
          snapshot.bytes,
          0o600,
        );
      }
      const metadata: BackupMetadata =
        snapshot === null
          ? { existed: false, mode: null, atimeMs: null, mtimeMs: null }
          : {
              existed: true,
              mode: snapshot.mode,
              atimeMs: snapshot.atimeMs,
              mtimeMs: snapshot.mtimeMs,
            };
      const metadataPath = join(directory, `${String(index)}.json`);
      const serializedMetadata = metadataBytes(metadata);
      await writeDurableFile(
        this.dependencies.fs,
        metadataPath,
        `${metadataPath}.tmp`,
        serializedMetadata,
        0o600,
      );
      const metadataDigestPath = `${metadataPath}.sha256`;
      await writeDurableFile(
        this.dependencies.fs,
        metadataDigestPath,
        `${metadataDigestPath}.tmp`,
        new TextEncoder().encode(`${hash(serializedMetadata)}\n`),
        0o600,
      );
    }
    return transition(journal, "backed_up");
  }

  private async stage(
    journal: TransactionJournalV1,
    transition: JournalTransition = (current, phase) => this.transition(current, phase),
  ): Promise<TransactionJournalV1> {
    for (const mutation of journal.mutations) {
      await this.stagedBytes(journal, mutation);
    }
    return transition(journal, "staged");
  }

  private async validate(
    journal: TransactionJournalV1,
    transition: JournalTransition = (current, phase) => this.transition(current, phase),
  ): Promise<TransactionJournalV1> {
    for (const mutation of journal.mutations) {
      await this.assertTarget(mutation.targetPath);
      await this.stagedBytes(journal, mutation);
    }
    return transition(journal, "validated");
  }

  private async apply(
    journal: TransactionJournalV1,
    transition: JournalTransition = (current, phase) => this.transition(current, phase),
  ): Promise<TransactionJournalV1> {
    for (const [index, mutation] of journal.mutations.entries()) {
      await this.applyMutation(journal, index, mutation);
    }
    return transition(journal, "applied");
  }

  private async applyMutation(
    journal: TransactionJournalV1,
    index: number,
    mutation: FileMutation,
  ): Promise<void> {
    await this.assertTarget(mutation.targetPath);
    const desired = await this.stagedBytes(journal, mutation);
    const desiredHash = desired === null ? null : hash(desired);
    const metadata = await this.readMetadata(journal.id, index);
    const desiredMode = this.expectedDesiredMode(mutation, metadata);
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    const current = await this.snapshot(mutation.targetPath);
    const currentHash = current === null ? null : hash(current.bytes);
    if (currentHash === desiredHash) {
      if (desiredMode === null) {
        await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      } else {
        await this.setFileMetadataDurably(
          mutation.targetPath,
          desiredMode,
          desiredMtimeMs,
          desiredMtimeMs,
        );
      }
      return;
    }
    if (currentHash !== mutation.expectedBeforeHash) {
      throw new TransactionConflictError();
    }
    if (!this.matchesOriginalMetadata(current, metadata)) {
      throw new TransactionConflictError();
    }

    if (mutation.operation === "remove") {
      try {
        await this.dependencies.fs.unlink(mutation.targetPath);
      } catch (error) {
        if (!isMissing(error)) throw new TransactionStateError();
      }
      await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      return;
    }

    if (desired === null) throw new TransactionStateError();
    if (desiredMode === null) throw new TransactionStateError();
    await writeDurableFile(
      this.dependencies.fs,
      mutation.targetPath,
      applyTempPath(journal.id, index, mutation.targetPath),
      desired,
      desiredMode,
    );
    await this.setFileMetadataDurably(
      mutation.targetPath,
      desiredMode,
      desiredMtimeMs,
      desiredMtimeMs,
    );
  }

  private async verifyAndTransition(
    journal: TransactionJournalV1,
    transition: JournalTransition = (current, phase) => this.transition(current, phase),
  ): Promise<TransactionJournalV1> {
    await this.verifyDesired(journal);
    return transition(journal, "verified");
  }

  private async verifyDesired(journal: TransactionJournalV1): Promise<void> {
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    for (const [index, mutation] of journal.mutations.entries()) {
      const desired = await this.stagedBytes(journal, mutation);
      const metadata = await this.readMetadata(journal.id, index);
      const desiredMode = this.expectedDesiredMode(mutation, metadata);
      const current = await this.snapshot(mutation.targetPath);
      if (
        (current === null ? null : hash(current.bytes)) !==
          (desired === null ? null : hash(desired)) ||
        (desiredMode !== null &&
          (current === null ||
            current.mode !== desiredMode ||
            current.mtimeMs !== desiredMtimeMs))
      ) {
        throw new TransactionConflictError();
      }
    }
  }

  private async readMetadata(id: string, index: number): Promise<BackupMetadata> {
    const directory = this.backupDirectory(id);
    const metadataPath = join(directory, `${String(index)}.json`);
    try {
      const [metadata, persistedDigest] = await Promise.all([
        this.readArtifact(directory, metadataPath),
        this.readArtifact(directory, `${metadataPath}.sha256`),
      ]);
      const serializedDigest = new TextDecoder().decode(persistedDigest);
      if (
        !/^[a-f0-9]{64}\n$/.test(serializedDigest) ||
        serializedDigest !== `${hash(metadata)}\n`
      ) {
        throw new TransactionStateError();
      }
      return parseMetadata(new TextDecoder().decode(metadata));
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private async restoreMutation(
    journal: TransactionJournalV1,
    index: number,
  ): Promise<void> {
    /**
     * **`metadata.existed === true` no longer implies a readable `<index>.bin`.** Backup
     * payloads are pruned at both terminal phases, so the invariant that makes this
     * function safe lives elsewhere: `rollbackLocked` refuses a `finalized` journal, and
     * `store.transition` refuses every transition out of either terminal phase, so a
     * rollback can only run while the payload is still there.
     *
     * The consequence if that ever loosens: this reads a payload that is gone and reports
     * a bare `TransactionStateError`, indistinguishable from a tampered or truncated
     * backup — and for a multi-mutation plan it would do so *partway*, having already
     * restored the higher indices. Only a hand-edited journal reaches that state today,
     * and the e2e fixtures that rewind a finalized journal are the one place it is
     * constructed deliberately.
     */
    const mutation = journal.mutations[index];
    if (mutation === undefined) throw new TransactionStateError();
    await this.assertTarget(mutation.targetPath);
    // A death between applyMutation's temp write and its rename leaves the temp beside the target.
    await removeOwnedTemp(this.dependencies.fs, applyTempPath(journal.id, index, mutation.targetPath));
    const desired = await this.stagedBytes(journal, mutation);
    const desiredHash = desired === null ? null : hash(desired);
    const metadata = await this.readMetadata(journal.id, index);
    const desiredMode = this.expectedDesiredMode(mutation, metadata);
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    const current = await this.snapshot(mutation.targetPath);
    const currentHash = current === null ? null : hash(current.bytes);
    if (currentHash === mutation.expectedBeforeHash) {
      await this.restoreOriginalMetadata(mutation.targetPath, current, metadata);
      return;
    }
    if (currentHash !== desiredHash) throw new TransactionConflictError();
    if (
      desiredMode !== null &&
      (current === null ||
        current.mode !== desiredMode ||
        (journal.phase !== "validated" &&
          current.mtimeMs !== desiredMtimeMs))
    ) {
      throw new TransactionConflictError();
    }

    if (!metadata.existed) {
      if (current !== null) {
        await this.dependencies.fs.unlink(mutation.targetPath);
        await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      }
      return;
    }

    if (
      metadata.mode === null ||
      metadata.atimeMs === null ||
      metadata.mtimeMs === null
    ) {
      throw new TransactionStateError();
    }
    let original: Uint8Array;
    try {
      const directory = this.backupDirectory(journal.id);
      original = await this.readArtifact(
        directory,
        join(directory, `${String(index)}.bin`),
      );
    } catch {
      throw new TransactionStateError();
    }
    if (hash(original) !== mutation.expectedBeforeHash) {
      throw new TransactionStateError();
    }
    const temporary = join(
      dirname(mutation.targetPath),
      `.${basename(mutation.targetPath)}.${journal.id}-${String(index)}.rollback.tmp`,
    );
    await writeDurableFile(
      this.dependencies.fs,
      mutation.targetPath,
      temporary,
      original,
      metadata.mode,
    );
    await this.restoreOriginalMetadata(mutation.targetPath, null, metadata);
  }

  private async readArtifact(
    transactionDirectory: string,
    artifactPath: string,
  ): Promise<Uint8Array> {
    try {
      const directoryStats = await this.dependencies.fs.lstat(
        transactionDirectory,
        { bigint: true },
      );
      if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        throw new TransactionStateError();
      }
      const pathStats = await this.dependencies.fs.lstat(artifactPath, { bigint: true });
      if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
        throw new TransactionStateError();
      }
      const handle = await this.dependencies.fs.open(
        artifactPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const handleStats = await handle.stat({ bigint: true });
        if (
          !handleStats.isFile() ||
          handleStats.dev !== pathStats.dev ||
          handleStats.ino !== pathStats.ino
        ) {
          throw new TransactionStateError();
        }
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private expectedDesiredMode(
    mutation: FileMutation,
    metadata: BackupMetadata,
  ): number | null {
    if (mutation.operation === "create") {
      if (metadata.existed) throw new TransactionStateError();
      return 0o600;
    }
    if (!metadata.existed || metadata.mode === null) {
      throw new TransactionStateError();
    }
    return mutation.operation === "remove" ? null : metadata.mode;
  }

  private expectedDesiredMtime(journal: TransactionJournalV1): number {
    const desiredMtimeMs = Date.parse(journal.createdAt);
    if (Number.isNaN(desiredMtimeMs)) throw new TransactionStateError();
    return desiredMtimeMs;
  }

  private async setFileMetadataDurably(
    targetPath: string,
    mode: number,
    atimeMs: number,
    mtimeMs: number,
  ): Promise<void> {
    try {
      const handle = await this.dependencies.fs.open(
        targetPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stats = await handle.stat({ bigint: true });
        if (!stats.isFile()) throw new TransactionStateError();
        await handle.chmod(mode);
        await handle.utimes(atimeMs / 1000, mtimeMs / 1000);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(this.dependencies.fs, dirname(targetPath));
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private async restoreOriginalMetadata(
    targetPath: string,
    current: ExistingSnapshot | null,
    metadata: BackupMetadata,
  ): Promise<void> {
    if (!metadata.existed) {
      if (current !== null) throw new TransactionStateError();
      await syncDirectory(this.dependencies.fs, dirname(targetPath));
      return;
    }
    if (
      metadata.mode === null ||
      metadata.atimeMs === null ||
      metadata.mtimeMs === null
    ) {
      throw new TransactionStateError();
    }
    await this.setFileMetadataDurably(
      targetPath,
      metadata.mode,
      metadata.atimeMs,
      metadata.mtimeMs,
    );
  }

  private matchesOriginalMetadata(
    current: ExistingSnapshot | null,
    metadata: BackupMetadata,
  ): boolean {
    return metadata.existed
      ? metadata.mode !== null &&
          metadata.mtimeMs !== null &&
          current !== null &&
          current.mode === metadata.mode &&
          current.mtimeMs === metadata.mtimeMs
      : current === null;
  }

  private async verifyOriginal(journal: TransactionJournalV1): Promise<void> {
    for (const [index, mutation] of journal.mutations.entries()) {
      const current = await this.snapshot(mutation.targetPath);
      const currentHash = current === null ? null : hash(current.bytes);
      if (currentHash !== mutation.expectedBeforeHash) {
        throw new TransactionStateError();
      }
      const metadata = await this.readMetadata(journal.id, index);
      if (
        metadata.existed &&
        (current === null ||
          current.mode !== metadata.mode ||
          current.mtimeMs !== metadata.mtimeMs)
      ) {
        throw new TransactionStateError();
      }
    }
  }

  private async transition(
    journal: TransactionJournalV1,
    nextPhase: TransactionPhase,
  ): Promise<TransactionJournalV1> {
    const next = await this.store.transition(
      journal.id,
      journal.phase,
      nextPhase,
      this.dependencies.clock(),
    );
    await this.runHook(nextPhase, next);
    return next;
  }

  /** Bootstrap alone keeps the outer payload inode as the rewrite authority. */
  private async transitionBootstrapFoundationInPlace(
    journal: TransactionJournalV1,
    nextPhase: TransactionPhase,
    path: CanonicalAbsolutePathV1,
    identity: BootstrapJournalIdentity,
    ownerUid: number,
  ): Promise<TransactionJournalV1> {
    const next = validateJournal({
      ...journal,
      phase: nextPhase,
      updatedAt: this.dependencies.clock(),
    });
    const expectedCurrent = encodeFoundationJournalJsonV1(journal);
    const nextBytes = new TextEncoder().encode(encodeFoundationJournalJsonV1(next));
    let handle: Awaited<ReturnType<TransactionFileSystem["open"]>> | undefined;
    let writeFailure: TransactionStateError | undefined;
    try {
      const linkedBefore = await this.dependencies.fs.lstat(path, { bigint: true });
      assertOwnedJournalInode(linkedBefore, ownerUid, identity, 1);
      handle = await this.dependencies.fs.open(
        path,
        constants.O_RDWR | constants.O_NOFOLLOW,
      );
      const opened = await handle.stat({ bigint: true });
      assertOwnedJournalInode(opened, ownerUid, identity, 1);
      const currentBytes = await handle.readFile();
      if (new TextDecoder().decode(currentBytes) !== expectedCurrent) {
        throw new TransactionStateError();
      }
      await rewriteInPlace(handle, nextBytes, identity);
    } catch {
      writeFailure = new TransactionStateError();
    }
    try {
      await handle?.close();
    } catch {
      writeFailure ??= new TransactionStateError();
    }
    if (writeFailure !== undefined) throw writeFailure;
    await syncReopenDirectory(this.dependencies.fs, dirname(path));
    const reopened = await readExactBootstrapJournalByIdentity(
      this.dependencies.fs,
      path,
      identity,
      ownerUid,
      nextBytes,
    );
    if (reopened.phase !== nextPhase || reopened.id !== journal.id) {
      throw new TransactionStateError();
    }
    await this.runHook(nextPhase, reopened);
    return reopened;
  }

  private async runHook(
    phase: TransactionPhase,
    journal: TransactionJournalV1,
  ): Promise<void> {
    await this.dependencies.afterPhase?.(phase, journal);
  }
}
