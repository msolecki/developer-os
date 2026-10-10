import { describe, expect, it } from "vitest";

import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { EXIT_CODES } from "../result.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type {
  FileMutation,
  TransactionLockProvider,
  TransactionPhase,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import { inspectLifecycleAllocator } from "./allocator.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import { encodeCanonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import {
  createLifecycleCodecs,
  foundationParticipantPlanHash,
  type LifecycleLeafCodecsV1,
  type LifecycleValueCodec,
} from "./codecs.js";
import { deriveLifecycleLedgerRoots, type LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import { deriveTerminalCompaction, type LifecycleVariantFactsV1 } from "./grammar.js";
import { LifecycleRecoveryRequiredError } from "./guarded-fs.js";
import {
  LIFECYCLE_LEDGER_BOUNDS,
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
} from "./ids.js";
import { inspectLifecycleLedger, type LifecycleLedgerSnapshotV1 } from "./ledger.js";
import { LifecycleLockShapeError, type HeldLifecycleStableLockV1 } from "./locks.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import {
  LifecycleCoordinatorStore,
  LifecycleInfeasiblePlanError,
  assertLifecycleCapacity,
  assertLifecycleExecutionFeasible,
  longestLegalAllocatedId,
  maximumCoordinatorJournalBytes,
  maximumFoundationJournalBytes,
  standaloneFoundationLeafReservation,
  type LifecycleExecutionBuilderV1,
  type LifecycleLeafReservationV1,
  type LifecycleStoreBoundaryV1,
} from "./store.js";
import {
  createInMemoryLifecycleGuardedFileSystem,
  type LifecycleCountingGuardedFileSystemV1,
} from "./testing.js";
import {
  LIFECYCLE_COORDINATOR_PHASES,
  type FoundationParticipantRefV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
} from "./types.js";

const UID = process.getuid?.() ?? 0;
const HOME = parseCanonicalAbsolutePathText("/product");
const ROOTS = deriveLifecycleLedgerRoots(HOME);
const NONCE = parseLowerHexSha256("7c".repeat(32));
const TIMESTAMP = parseUtcTimestamp("2026-09-19T00:00:00.000Z");
const DEV = parseUInt64Decimal("16777232");
const INO = parseUInt64Decimal("184467440737095516");
const LOCK_PATH = parseCanonicalAbsolutePathText("/product/state/.lifecycle.lock");
const PLAN_BYTE_CEILING = 16_777_216;
const JOURNAL_BYTE_CEILING = 1_048_576;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const HELD: HeldLifecycleStableLockV1 = {
  path: LOCK_PATH,
  dev: DEV,
  ino: INO,
  release: () => Promise.resolve(),
};

const FOREIGN_LOCK: HeldLifecycleStableLockV1 = {
  ...HELD,
  path: parseCanonicalAbsolutePathText("/product/state/.lifecycle-bootstrap.lock"),
};

const ROOT_DIRECTORIES = [
  "state",
  "state/transactions",
  "state/lifecycle-journals",
  "state/git-effect-journals",
  "state/launchd-effect-journals",
  "staging",
  "staging/transactions",
  "staging/lifecycle",
  "backups",
  "backups/transactions",
] as const;

const NO_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

interface SyntheticLeaf {
  readonly marker: string;
}
/** NEW-210: core reads the `K` leaf for its `payloads` count. */
interface SyntheticKeyLeaf extends SyntheticLeaf {
  readonly payloads: readonly unknown[];
}
interface SyntheticPush extends SyntheticLeaf {
  readonly planHash: LowerHexSha256;
}

type SyntheticPlan = LifecycleCoordinatorPlanCoreV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticKeyLeaf,
  SyntheticPush
>;

function leafCodec<T extends SyntheticLeaf>(label: string): LifecycleValueCodec<T> {
  return {
    validate(value: unknown): T {
      if (typeof value !== "object" || value === null || !("marker" in value)) {
        throw new Error(`invalid synthetic ${label} leaf`);
      }
      return value as T;
    },
    encode: (value) => encodeCanonicalJson(value as unknown as CanonicalJsonValue),
  };
}

const LEAVES: LifecycleLeafCodecsV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticKeyLeaf,
  SyntheticPush,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf & {
    readonly tableHashes: {
      readonly observation: LowerHexSha256;
      readonly mutationTemplate: LowerHexSha256;
    };
  }
> = {
  manifest: leafCodec("manifest"),
  launchd: leafCodec("launchd"),
  redactionKey: leafCodec<SyntheticKeyLeaf>("redactionKey"),
  push: leafCodec<SyntheticPush>("push"),
  pushPlanHash: (push) => push.planHash,
  projection: leafCodec("projection"),
  gitPreview: leafCodec("gitPreview"),
  launchdPreview: leafCodec("launchdPreview"),
  projectionSubsystem: () => "git",
  launchdPreviewTableHashes: (preview) => preview.tableHashes,
};

const CODECS = createLifecycleCodecs(LEAVES, { productHome: HOME, nonce: NONCE });
const CODEC = CODECS.executionPlan;

const COORDINATOR = parseLifecycleCoordinatorId(
  formatAllocatedLifecycleId("lc", NONCE, 1n),
  NONCE,
);

function transactionId(counter: bigint): AllocatedLifecycleIdV1<"tx"> {
  return parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", NONCE, counter), NONCE);
}

const DEFAULT_PARTICIPANT_MAXIMUM = 4096;

const MARKER_FORWARD = transactionId(2n);
const MARKER_COMPENSATION = transactionId(3n);
const ARTIFACTS_FORWARD = transactionId(4n);
const ARTIFACTS_COMPENSATION = transactionId(5n);

function participantRef(options: {
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: FoundationParticipantRefV1["slot"];
  readonly role: FoundationParticipantRefV1["role"];
  readonly mutations: readonly FoundationMutationRefV1[];
  readonly maximumJournalBytes: number;
}): FoundationParticipantRefV1 {
  const core = {
    slot: options.slot,
    role: options.role,
    mutations: options.mutations,
    maximumJournalBytes: options.maximumJournalBytes,
    initialJournal: {
      finalPath: path(`${HOME}/state/transactions/${options.id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(`${HOME}/staging/lifecycle/${COORDINATOR}/foundation/${options.id}/journal.json`),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
    },
  };
  return { id: options.id, ...core, planHash: foundationParticipantPlanHash(core) };
}

function markerPair(
  maximumJournalBytes = DEFAULT_PARTICIPANT_MAXIMUM,
): readonly [FoundationParticipantRefV1, FoundationParticipantRefV1] {
  return [
    participantRef({
      id: MARKER_FORWARD,
      slot: "uninstall_marker",
      role: { kind: "forward", compensationId: MARKER_COMPENSATION },
      maximumJournalBytes,
      mutations: [
        {
          targetPath: path(`${HOME}/state/uninstalling.json`),
          operation: "create",
          expectedBeforeHash: null,
          contentHash: hash("8"),
          contentSize: 96,
          stagedPath: path(`${HOME}/staging/transactions/${MARKER_FORWARD}/0.bin`),
        },
      ],
    }),
    participantRef({
      id: MARKER_COMPENSATION,
      slot: "uninstall_marker",
      role: { kind: "compensation", forwardId: MARKER_FORWARD },
      maximumJournalBytes: DEFAULT_PARTICIPANT_MAXIMUM,
      mutations: [
        {
          targetPath: path(`${HOME}/state/uninstalling.json`),
          operation: "remove",
          expectedBeforeHash: hash("8"),
          contentHash: null,
          contentSize: null,
          stagedPath: null,
        },
      ],
    }),
  ];
}

function artifactPair(): readonly [FoundationParticipantRefV1, FoundationParticipantRefV1] {
  return [
    participantRef({
      id: ARTIFACTS_FORWARD,
      slot: "uninstall_artifacts",
      role: { kind: "forward", compensationId: ARTIFACTS_COMPENSATION },
      maximumJournalBytes: DEFAULT_PARTICIPANT_MAXIMUM,
      mutations: [
        {
          targetPath: path("/brain/a.md"),
          operation: "create",
          expectedBeforeHash: null,
          contentHash: hash("9"),
          contentSize: 10,
          stagedPath: path(`${HOME}/staging/transactions/${ARTIFACTS_FORWARD}/0.bin`),
        },
      ],
    }),
    participantRef({
      id: ARTIFACTS_COMPENSATION,
      slot: "uninstall_artifacts",
      role: { kind: "compensation", forwardId: ARTIFACTS_FORWARD },
      maximumJournalBytes: DEFAULT_PARTICIPANT_MAXIMUM,
      mutations: [
        {
          targetPath: path("/brain/a.md"),
          operation: "remove",
          expectedBeforeHash: hash("9"),
          contentHash: null,
          contentSize: null,
          stagedPath: null,
        },
      ],
    }),
  ];
}

const UNINSTALL_STEPS: readonly LifecycleCoordinatorStepV1[] = [
  { kind: "foundation", slot: "uninstall_marker", participantId: MARKER_FORWARD },
  { kind: "drain_runners" },
  { kind: "foundation", slot: "uninstall_artifacts", participantId: ARTIFACTS_FORWARD },
  { kind: "redaction_key", transition: "stage" },
  { kind: "manifest", transition: "preserve_before" },
  { kind: "manifest", transition: "commit_absence" },
  { kind: "redaction_key", transition: "delete" },
  { kind: "manifest", transition: "finalize_tombstones" },
];

/**
 * D24's `uninstall/present_manifest_without_launchd`. `maximumJournalBytes` is
 * absent from the journal record, so the exact maximum does not depend on the
 * placeholder this computes it from.
 */
function uninstallPlan(
  overrides: Partial<SyntheticPlan> = {},
  participantMaximum = DEFAULT_PARTICIPANT_MAXIMUM,
): SyntheticPlan {
  const [markerForward, markerCompensation] = markerPair(participantMaximum);
  const [artifactsForward, artifactsCompensation] = artifactPair();
  const base: SyntheticPlan = {
    schemaVersion: 1,
    id: COORDINATOR,
    previewHash: null,
    operation: "uninstall",
    maximumJournalBytes: 1,
    authority: {
      productHome: HOME,
      configPath: path(`${HOME}/config.toml`),
      activationPath: path(`${HOME}/state/lifecycle-activation.json`),
      manifestPath: path(`${HOME}/state/installation.json`),
      repositoryRoot: null,
      plistPaths: [],
    },
    participants: {
      foundation: [markerForward, markerCompensation, artifactsForward, artifactsCompensation],
      manifest: { marker: "manifest" },
      sourceGitEffect: null,
      destinationGitEffect: null,
      launchdBeforeFiles: null,
      launchdAfterFiles: null,
      launchd: null,
      redactionKey: { marker: "redaction-key", payloads: [] },
    },
    push: null,
    steps: UNINSTALL_STEPS,
    ...overrides,
  };
  return { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) };
}

function syntheticUninstallPlan(): SyntheticPlan {
  return uninstallPlan();
}

function variantFacts(): LifecycleVariantFactsV1 {
  return { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: false };
}

interface HomeV1 {
  readonly fs: LifecycleCountingGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly state: CanonicalAbsolutePathV1;
  readonly snapshot: LifecycleLedgerSnapshotV1<SyntheticPlan>;
  inspect(): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  read(relative: string): Promise<string | null>;
}

async function memoryLifecycleHome(
  options: { readonly nextCounter?: string } = {},
): Promise<HomeV1> {
  const fs = createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: HOME });
  for (const relative of ROOT_DIRECTORIES) {
    await fs.mkdirExclusive(path(`${HOME}/${relative}`));
  }
  await fs.writeExclusive(LOCK_PATH, new Uint8Array(0));
  await fs.writeExclusive(
    path(`${HOME}/state/lifecycle-install-nonce`),
    encoder.encode(`${NONCE}\n`),
  );
  await fs.writeExclusive(
    path(`${HOME}/state/lifecycle-id-allocator.json`),
    encoder.encode(
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: NONCE,
        nextCounter: parseUInt64Decimal(options.nextCounter ?? "0"),
      }),
    ),
  );

  const inspect = (): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>> =>
    inspectLifecycleLedger(
      {
        fs,
        effectiveUid: UID,
        executionPlanCodec: CODEC,
        coordinatorJournalCodec: CODECS.coordinatorJournal,
        variantFacts,
        pushPlanHash: (plan) => (plan.push === null ? null : plan.push.planHash),
        gitEffectPlanCodec: null,
        launchdEffectPlanCodec: null,
        residue: NO_RESIDUE,
        manifestBeforeHash: () => null,
        leasePaths: () => [],
      },
      ROOTS,
    );

  return {
    fs,
    roots: ROOTS,
    state: ROOTS.stateDirectory,
    snapshot: await inspect(),
    inspect,
    read: async (relative) => {
      const entry = await fs.lstat(path(`${HOME}/${relative}`));
      if (entry === null) return null;
      return decoder.decode(await fs.readRegular(entry, PLAN_BYTE_CEILING));
    },
  };
}

/**
 * The coordinator's `.<id>.lock` is a stable lock: acquiring it creates the exact
 * owner-only zero-byte leaf the ledger admits, and releasing never unlinks it.
 */
function lockProviderFor(fs: LifecycleCountingGuardedFileSystemV1): TransactionLockProvider & {
  readonly acquired: string[];
} {
  const acquired: string[] = [];
  return {
    acquired,
    acquire: async (text) => {
      const target = path(text);
      if ((await fs.lstat(target)) === null) await fs.writeExclusive(target, new Uint8Array(0));
      acquired.push(text);
      return { release: () => Promise.resolve() };
    },
  };
}

interface StoreOptionsV1 {
  readonly afterBoundary?: (boundary: LifecycleStoreBoundaryV1) => void | Promise<void>;
  readonly executionPlanCodec?: LifecycleValueCodec<SyntheticPlan>;
  readonly coordinatorJournalCodec?: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
}

function storeFor(
  home: HomeV1,
  afterBoundaryOrOptions: StoreOptionsV1["afterBoundary"] | StoreOptionsV1 = {},
): LifecycleCoordinatorStore<SyntheticPlan> {
  const options: StoreOptionsV1 =
    typeof afterBoundaryOrOptions === "function"
      ? { afterBoundary: afterBoundaryOrOptions }
      : afterBoundaryOrOptions;
  let counter = 0;
  return new LifecycleCoordinatorStore<SyntheticPlan>({
    fs: home.fs,
    roots: home.roots,
    executionPlanCodec: options.executionPlanCodec ?? CODEC,
    coordinatorJournalCodec: options.coordinatorJournalCodec ?? CODECS.coordinatorJournal,
    uuid: () => {
      counter += 1;
      return `0000000${counter.toString(16).padStart(1, "0")}-0000-4000-8000-000000000000`;
    },
    clock: () => TIMESTAMP,
    locks: lockProviderFor(home.fs),
    ...(options.afterBoundary === undefined ? {} : { afterBoundary: options.afterBoundary }),
  });
}

function builderFor(
  plan: (ids: readonly string[]) => SyntheticPlan,
  slotCount: number,
  reservation: LifecycleLeafReservationV1 = EMPTY_RESERVATION,
): LifecycleExecutionBuilderV1<SyntheticPlan> {
  return { slotCount, build: (ids) => ({ plan: plan(ids), reservation }) };
}

const EMPTY_RESERVATION: LifecycleLeafReservationV1 = {
  foundationJournals: 0,
  coordinatorJournals: 0,
  gitEffectJournals: 0,
  launchdEffectJournals: 0,
  foundationStaging: 0,
  foundationBackups: 0,
  lifecycleStaging: 0,
};

/** The uninstall builder Task 18 describes: `lc`, four `tx` IDs, then `mf`. */
const UNINSTALL_SLOT_COUNT = 6;

function feasibleBuilder(
  participantMaximum = DEFAULT_PARTICIPANT_MAXIMUM,
): LifecycleExecutionBuilderV1<SyntheticPlan> {
  return builderFor(() => uninstallPlan({}, participantMaximum), UNINSTALL_SLOT_COUNT);
}

function oversizedSyntheticBuilder(): LifecycleExecutionBuilderV1<SyntheticPlan> {
  return feasibleBuilder(JOURNAL_BYTE_CEILING + 1);
}

function refusal(
  action: () => unknown,
  reason: string,
): void {
  expect(action).toThrow(LifecycleInfeasiblePlanError);
  expect(action).toThrow(expect.objectContaining({ reason, code: EXIT_CODES.capabilityUnavailable }));
}

async function asyncRefusal(
  action: () => Promise<unknown>,
  reason: string,
  constructor: new (...args: never[]) => Error,
  code: number,
): Promise<void> {
  await expect(action()).rejects.toThrow(constructor);
  await expect(action()).rejects.toThrow(expect.objectContaining({ reason, code }));
}

function mutation(
  index: number,
  operation: FileMutation["operation"],
): FileMutation {
  return {
    targetPath: `/product/state/target-${index.toString(10)}.json`,
    operation,
    expectedBeforeHash: operation === "create" ? null : hash("a"),
    stagedRelativePath: operation === "remove" ? null : `${index.toString(10)}.bin`,
  };
}

const FOUNDATION_PHASES: readonly TransactionPhase[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
  "rolled_back",
];

describe("conservative and exact journal maxima", () => {
  it("refuses an infeasible journal maximum before the allocator moves", async () => {
    const home = await memoryLifecycleHome();
    expect(() => { assertLifecycleExecutionFeasible(oversizedSyntheticBuilder(), home.snapshot, CODEC); })
      .toThrow(expect.objectContaining({ reason: "journal_too_large" }));
    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).allocator.nextCounter).toBe("0");
    refusal(
      () => { assertLifecycleExecutionFeasible(oversizedSyntheticBuilder(), home.snapshot, CODEC); },
      "journal_too_large",
    );
  });

  it("admits the same plan once its participant maximum is at the ceiling", async () => {
    const home = await memoryLifecycleHome();
    expect(() => {
      assertLifecycleExecutionFeasible(feasibleBuilder(JOURNAL_BYTE_CEILING), home.snapshot, CODEC);
    }).not.toThrow();
  });

  it("spells the longest legal allocated ID for every prefix", () => {
    const widest = longestLegalAllocatedId("tx");
    expect(widest).toBe(`tx_${"f".repeat(64)}_18446744073709551615`);
    expect(parseAllocatedLifecycleId("tx", widest, parseLowerHexSha256("f".repeat(64)))).toBe(widest);
    for (const prefix of ["tx", "lc", "ge", "le", "mf", "oe", "rb"] as const) {
      expect(longestLegalAllocatedId(prefix)).toHaveLength(widest.length);
      expect(longestLegalAllocatedId(prefix).startsWith(`${prefix}_`)).toBe(true);
    }
  });

  it("takes the Foundation maximum over every phase and the widest ID", () => {
    const mutations = [mutation(0, "create"), mutation(1, "replace"), mutation(2, "remove")];
    const widest = longestLegalAllocatedId("tx");
    const kind = "lifecycle.uninstall_artifacts.compensation";
    const maximum = maximumFoundationJournalBytes({ id: widest, kind, mutations });

    const byPhase = FOUNDATION_PHASES.map(
      (phase) =>
        encoder.encode(
          encodeFoundationJournalJsonV1({
            schemaVersion: 1,
            id: widest,
            kind,
            phase,
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
            mutations,
          }),
        ).byteLength,
    );
    expect(byPhase.length).toBeGreaterThan(0);
    expect(maximum).toBe(Math.max(...byPhase));
    expect(maximum).toBeGreaterThan(byPhase[0] as number);

    const short = maximumFoundationJournalBytes({ id: "tx_short", kind, mutations });
    expect(maximum - short).toBe(widest.length - "tx_short".length);
  });

  function brutestCoordinatorJournalBytes(plan: SyntheticPlan): number {
    const entries = deriveTerminalCompaction(plan, "finalized").entries.length;
    const sizes: number[] = [];
    for (const phase of LIFECYCLE_COORDINATOR_PHASES) {
      const compacting = phase === "compacting";
      const compensating = phase === "compensating" || phase === "rolled_back";
      for (let nextStep = 0; nextStep <= plan.steps.length; nextStep += 1) {
        const compensationValues = compensating
          ? Array.from({ length: plan.steps.length + 1 }, (_, index) => index - 1)
          : [null];
        const compactionValues = compacting
          ? Array.from({ length: entries + 1 }, (_, index) => index)
          : [null];
        const outcomes = compacting ? (["finalized", "rolled_back"] as const) : ([null] as const);
        for (const compensationNext of compensationValues) {
          for (const compactionNext of compactionValues) {
            for (const terminalOutcome of outcomes) {
              const journal: LifecycleCoordinatorJournalV1 = {
                schemaVersion: 1,
                id: plan.id,
                operation: plan.operation,
                phase,
                planHash: hash("b"),
                pushPlanHash: plan.push === null ? null : hash("c"),
                nextStep,
                compensationNext,
                compactionNext,
                terminalOutcome,
                createdAt: TIMESTAMP,
                updatedAt: TIMESTAMP,
              };
              sizes.push(
                encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue))
                  .byteLength,
              );
            }
          }
        }
      }
    }
    expect(sizes.length).toBeGreaterThan(0);
    return Math.max(...sizes);
  }

  it("takes the coordinator maximum over every legal phase and cursor", () => {
    const plan = syntheticUninstallPlan();
    expect(maximumCoordinatorJournalBytes(plan)).toBe(brutestCoordinatorJournalBytes(plan));
  });

  /** Every 1a variant is nine steps or fewer, while `steps` admits 256 and plan 1b grows into it. */
  it("takes the same maximum at a step count only plan 1b reaches", () => {
    const plan = uninstallPlan({
      steps: Array.from({ length: 101 }, () => ({ kind: "drain_runners" }) as const),
    });
    expect(plan.steps).toHaveLength(101);
    expect(maximumCoordinatorJournalBytes(plan)).toBe(brutestCoordinatorJournalBytes(plan));
  });

  it("counts a non-null push hash only where the plan carries a push arm", () => {
    const withoutPush = syntheticUninstallPlan();
    const withPush: SyntheticPlan = {
      ...withoutPush,
      push: { marker: "push", planHash: hash("d") },
    };
    expect(maximumCoordinatorJournalBytes(withPush)).toBe(
      maximumCoordinatorJournalBytes(withoutPush) + 64 + 2 - "null".length,
    );
  });

  it("refuses a coordinator maximum above the journal ceiling", async () => {
    const home = await memoryLifecycleHome();
    const builder = builderFor(
      () => uninstallPlan({ id: "lc_".padEnd(2_000_000, "x") as LifecycleCoordinatorIdV1 }),
      UNINSTALL_SLOT_COUNT,
    );
    refusal(
      () => { assertLifecycleExecutionFeasible(builder, home.snapshot, CODEC); },
      "journal_too_large",
    );
  });

  it("refuses a plan above the immutable plan ceiling", async () => {
    const home = await memoryLifecycleHome();
    const unbounded: LifecycleValueCodec<SyntheticPlan> = {
      validate: (value) => CODEC.validate(value),
      encode: () => "x".repeat(PLAN_BYTE_CEILING + 1) as ReturnType<typeof CODEC.encode>,
    };
    refusal(
      () => { assertLifecycleExecutionFeasible(feasibleBuilder(), home.snapshot, unbounded); },
      "plan_too_large",
    );
  });

  it("refuses a builder whose slot count disagrees with the reservation order", async () => {
    const home = await memoryLifecycleHome();
    refusal(
      () => { assertLifecycleExecutionFeasible(builderFor(() => uninstallPlan(), 5), home.snapshot, CODEC); },
      "reservation_slot_count",
    );
  });

  it("refuses a slot count no legal reservation block can reach", async () => {
    const home = await memoryLifecycleHome();
    for (const slotCount of [0, 71, Number.MAX_SAFE_INTEGER]) {
      refusal(
        () => {
          assertLifecycleExecutionFeasible(
            builderFor(() => uninstallPlan(), slotCount),
            home.snapshot,
            CODEC,
          );
        },
        "reservation_slot_count",
      );
    }
  });

  it("hands the builder distinct IDs of the widest legal width", async () => {
    const home = await memoryLifecycleHome();
    const seen: string[][] = [];
    const builder = builderFor((ids) => {
      seen.push([...ids]);
      return uninstallPlan();
    }, UNINSTALL_SLOT_COUNT);
    assertLifecycleExecutionFeasible(builder, home.snapshot, CODEC);
    const [ids] = seen;
    expect(ids).toHaveLength(UNINSTALL_SLOT_COUNT);
    expect(new Set(ids).size).toBe(UNINSTALL_SLOT_COUNT);
    for (const id of ids ?? []) {
      expect(id).toHaveLength(longestLegalAllocatedId("tx").length);
    }
  });
});

describe("ledger capacity reservation", () => {
  type CountFieldV1 =
    | "journalRoot"
    | "staging"
    | "backups"
    | "coordinatorJournals"
    | "gitEffectJournals"
    | "launchdEffectJournals"
    | "lifecycleStagingAggregate";

  const CASES = [
    {
      key: "foundationJournals",
      field: "journalRoot",
      cap: LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot,
    },
    {
      key: "coordinatorJournals",
      field: "coordinatorJournals",
      cap: LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot,
    },
    {
      key: "gitEffectJournals",
      field: "gitEffectJournals",
      cap: LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot,
    },
    {
      key: "launchdEffectJournals",
      field: "launchdEffectJournals",
      cap: LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot,
    },
    {
      key: "foundationStaging",
      field: "staging",
      cap: LIFECYCLE_LEDGER_BOUNDS.foundationStagingAggregateLeaves,
    },
    {
      key: "foundationBackups",
      field: "backups",
      cap: LIFECYCLE_LEDGER_BOUNDS.foundationBackupAggregateLeaves,
    },
    {
      key: "lifecycleStaging",
      field: "lifecycleStagingAggregate",
      cap: LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingAggregateLeaves,
    },
  ] as const satisfies readonly {
    readonly key: keyof LifecycleLeafReservationV1;
    readonly field: CountFieldV1;
    readonly cap: number;
  }[];

  function snapshotWithCount(
    base: LifecycleLedgerSnapshotV1<SyntheticPlan>,
    field: CountFieldV1,
    current: number,
  ): LifecycleLedgerSnapshotV1<SyntheticPlan> {
    const foundationCounts = { journalRoot: 0, staging: 0, backups: 0 };
    const counts = {
      coordinatorJournals: 0,
      gitEffectJournals: 0,
      launchdEffectJournals: 0,
      lifecycleStagingAggregate: 0,
      lifecycleStagingMaximumPerCoordinator: 0,
    };
    if (field === "journalRoot" || field === "staging" || field === "backups") {
      foundationCounts[field] = current;
    } else {
      counts[field] = current;
    }
    return { ...base, foundation: { ...base.foundation, counts: foundationCounts }, counts };
  }

  it("enumerates every capped root", () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(new Set(CASES.map((entry) => entry.key)).size).toBe(Object.keys(EMPTY_RESERVATION).length);
  });

  it.each(CASES)("admits $key at its exact cap and refuses the first leaf over", async ({ key, field, cap }) => {
    const home = await memoryLifecycleHome();
    const exact = snapshotWithCount(home.snapshot, field, cap - 1);
    expect(() => { assertLifecycleCapacity(exact, { ...EMPTY_RESERVATION, [key]: 1 }); }).not.toThrow();
    refusal(
      () => { assertLifecycleCapacity(exact, { ...EMPTY_RESERVATION, [key]: 2 }); },
      "ledger_capacity_exceeded",
    );
  });

  it("refuses one coordinator reserving more than the per-coordinator staging cap", async () => {
    const home = await memoryLifecycleHome();
    const empty = snapshotWithCount(home.snapshot, "lifecycleStagingAggregate", 0);
    const cap = LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingPerCoordinatorLeaves;
    expect(() =>
      { assertLifecycleCapacity(empty, { ...EMPTY_RESERVATION, lifecycleStaging: cap }); },
    ).not.toThrow();
    refusal(
      () => { assertLifecycleCapacity(empty, { ...EMPTY_RESERVATION, lifecycleStaging: cap + 1 }); },
      "ledger_capacity_exceeded",
    );
  });

  it("counts a standalone Foundation transaction's journal, lock, temp and companions", () => {
    expect(
      standaloneFoundationLeafReservation([
        { operation: "create" },
        { operation: "replace" },
        { operation: "remove" },
      ]),
    ).toStrictEqual({
      foundationJournals: 3,
      coordinatorJournals: 0,
      gitEffectJournals: 0,
      launchdEffectJournals: 0,
      foundationStaging: 1 + 3 * 2,
      foundationBackups: 1 + 5 * 2,
      lifecycleStaging: 0,
    } satisfies LifecycleLeafReservationV1);
    expect(standaloneFoundationLeafReservation([{ operation: "create" }])).toStrictEqual({
      foundationJournals: 3,
      coordinatorJournals: 0,
      gitEffectJournals: 0,
      launchdEffectJournals: 0,
      foundationStaging: 4,
      foundationBackups: 1,
      lifecycleStaging: 0,
    } satisfies LifecycleLeafReservationV1);
  });
});

describe("coordinator publication", () => {
  it("publishes the immutable plan before its lock and the lock before the planned journal", async () => {
    const events: LifecycleStoreBoundaryV1[] = [];
    const store = storeFor(await memoryLifecycleHome(), (boundary) => {
      events.push(boundary);
    });
    await store.publish(syntheticUninstallPlan(), HELD);
    expect(events).toStrictEqual([
      "plan_temp_written",
      "plan_published",
      "plan_parent_synced",
      "coordinator_lock_created",
      "journal_temp_written",
      "journal_published",
      "journal_parent_synced",
    ]);
  });

  it("publishes a planned journal the ledger reads back as its own active coordinator", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const plan = syntheticUninstallPlan();
    const journal = await storeFor(home).publish(plan, HELD);
    expect(journal.phase).toBe("planned");
    expect(journal.nextStep).toBe(0);
    expect(journal.pushPlanHash).toBeNull();

    const snapshot = await home.inspect();
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators.map((record) => record.state)).toStrictEqual(["active"]);
    expect(snapshot.coordinators[0]?.journal).toStrictEqual(journal);
    const reopened = await storeFor(home).read(plan.id);
    expect(CODEC.encode(reopened.plan)).toBe(CODEC.encode(plan));
    expect(reopened.journal).toStrictEqual(journal);
  });

  interface DeathExpectationV1 {
    readonly boundary: LifecycleStoreBoundaryV1;
    readonly orphans: readonly string[];
    readonly states: readonly string[];
    readonly locked: readonly boolean[];
  }

  /**
   * Task 18 stages both Foundation pairs before it publishes, so production
   * always reaches `earlierCompactionEntriesAbsent` with the coordinator's own
   * staging tree present and every death lands in `pre_journal_orphan`. The
   * bare pass covers the envelope-suffix shapes the Cover list names.
   */
  const BARE_DEATHS = [
    { boundary: "plan_temp_written", orphans: ["plan_publication_temp"], states: [], locked: [] },
    {
      boundary: "plan_published",
      orphans: [],
      states: ["envelope_suffix_plan_only"],
      locked: [false],
    },
    {
      boundary: "plan_parent_synced",
      orphans: [],
      states: ["envelope_suffix_plan_only"],
      locked: [false],
    },
    {
      boundary: "coordinator_lock_created",
      orphans: [],
      states: ["envelope_suffix_plan_and_lock"],
      locked: [true],
    },
    {
      boundary: "journal_temp_written",
      orphans: ["initial_journal_temp"],
      states: ["envelope_suffix_plan_and_lock"],
      locked: [true],
    },
    { boundary: "journal_published", orphans: [], states: ["active"], locked: [true] },
    { boundary: "journal_parent_synced", orphans: [], states: ["active"], locked: [true] },
  ] as const satisfies readonly DeathExpectationV1[];

  const STAGED_DEATHS = [
    {
      boundary: "plan_temp_written",
      orphans: ["plan_publication_temp", "planless_staging"],
      states: [],
      locked: [],
    },
    { boundary: "plan_published", orphans: [], states: ["pre_journal_orphan"], locked: [false] },
    {
      boundary: "plan_parent_synced",
      orphans: [],
      states: ["pre_journal_orphan"],
      locked: [false],
    },
    {
      boundary: "coordinator_lock_created",
      orphans: [],
      states: ["pre_journal_orphan"],
      locked: [true],
    },
    {
      boundary: "journal_temp_written",
      orphans: ["initial_journal_temp"],
      states: ["pre_journal_orphan"],
      locked: [true],
    },
    { boundary: "journal_published", orphans: [], states: ["active"], locked: [true] },
    { boundary: "journal_parent_synced", orphans: [], states: ["active"], locked: [true] },
  ] as const satisfies readonly DeathExpectationV1[];

  async function dieAtPublication(
    expectation: DeathExpectationV1,
    staged: boolean,
  ): Promise<void> {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const plan = syntheticUninstallPlan();
    if (staged) await storeFor(home).ensureStagingDirectory(plan.id, HELD);
    const store = storeFor(home, (reached) => {
      if (reached === expectation.boundary) throw new Error(`death at ${reached}`);
    });
    await expect(store.publish(plan, HELD)).rejects.toThrow(`death at ${expectation.boundary}`);

    const snapshot = await home.inspect();
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual([
      ...expectation.orphans,
    ]);
    expect(snapshot.coordinators.map((record) => record.state)).toStrictEqual([
      ...expectation.states,
    ]);
    expect(snapshot.coordinators.map((record) => record.lock !== null)).toStrictEqual([
      ...expectation.locked,
    ]);

    if (expectation.boundary === "plan_published") {
      const reopened = await storeFor(home).read(plan.id);
      expect(CODEC.encode(reopened.plan)).toBe(CODEC.encode(plan));
      expect(reopened.journal).toBeNull();
    }
  }

  it("enumerates every publication boundary in both staging worlds", () => {
    expect(BARE_DEATHS.length).toBeGreaterThan(0);
    expect(STAGED_DEATHS.map((entry) => entry.boundary)).toStrictEqual(
      BARE_DEATHS.map((entry) => entry.boundary),
    );
  });

  it.each(BARE_DEATHS)(
    "leaves a legal non-clear envelope and never a lock-only one when it dies at $boundary",
    (expectation) => dieAtPublication(expectation, false),
  );

  it.each(STAGED_DEATHS)(
    "leaves a legal non-clear envelope and never a lock-only one when it dies at $boundary with its staging tree",
    (expectation) => dieAtPublication(expectation, true),
  );

  const LATER_DEATHS = [
    { boundary: "staging_directory_created", orphans: ["planless_staging"] },
    { boundary: "rewrite_temp_written", orphans: ["rewrite_temp"] },
    { boundary: "rewrite_renamed", orphans: [] },
  ] as const satisfies readonly {
    readonly boundary: LifecycleStoreBoundaryV1;
    readonly orphans: readonly string[];
  }[];

  it("enumerates every staging and rewrite boundary", () => {
    expect(LATER_DEATHS.length).toBeGreaterThan(0);
    expect([...BARE_DEATHS, ...LATER_DEATHS].map((entry) => entry.boundary)).toStrictEqual([
      ...new Set([...BARE_DEATHS, ...LATER_DEATHS].map((entry) => entry.boundary)),
    ]);
  });

  it.each(LATER_DEATHS)(
    "leaves a legal non-clear envelope and never a lock-only one when it dies at $boundary",
    async ({ boundary, orphans }) => {
      const home = await memoryLifecycleHome({ nextCounter: "100" });
      const plan = syntheticUninstallPlan();
      const dying = (reached: LifecycleStoreBoundaryV1): void => {
        if (reached === boundary) throw new Error(`death at ${reached}`);
      };
      if (boundary === "staging_directory_created") {
        await expect(
          storeFor(home, dying).ensureStagingDirectory(plan.id, HELD),
        ).rejects.toThrow(`death at ${boundary}`);
      } else {
        const journal = await storeFor(home).publish(plan, HELD);
        const next: LifecycleCoordinatorJournalV1 = {
          ...journal,
          phase: "participants_applying",
          nextStep: 0,
        };
        await expect(
          storeFor(home, dying).rewriteJournal(plan, journal, next, HELD),
        ).rejects.toThrow(`death at ${boundary}`);
      }

      const snapshot = await home.inspect();
      expect(snapshot.findings).toStrictEqual([]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
      expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual([...orphans]);
    },
  );

  it("preserves both leaves and refuses a no-replace collision at the plan leaf", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const plan = syntheticUninstallPlan();
    await storeFor(home).publish(plan, HELD);
    const before = await home.read(`state/lifecycle-journals/${plan.id}.plan.json`);

    await asyncRefusal(
      () => storeFor(home).publish(plan, HELD),
      "lifecycle_coordinator_plan_exists",
      LifecycleRecoveryRequiredError,
      EXIT_CODES.recoveryRequired,
    );
    expect(await home.read(`state/lifecycle-journals/${plan.id}.plan.json`)).toBe(before);
    expect((await home.inspect()).findings).toStrictEqual([]);
  });

  it("preserves both leaves and refuses a journal that has no plan beside it", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const plan = syntheticUninstallPlan();
    await home.fs.writeExclusive(
      path(`${HOME}/state/lifecycle-journals/${plan.id}.json`),
      encoder.encode("{}\n"),
    );
    await asyncRefusal(
      () => storeFor(home).publish(plan, HELD),
      "lifecycle_coordinator_journal_exists",
      LifecycleRecoveryRequiredError,
      EXIT_CODES.recoveryRequired,
    );
    expect(await home.read(`state/lifecycle-journals/${plan.id}.json`)).toBe("{}\n");
    expect(await home.read(`state/lifecycle-journals/${plan.id}.plan.json`)).toBeNull();
  });

  it("refuses a plan whose recomputed maximum differs from its own field", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const plan = syntheticUninstallPlan();
    await asyncRefusal(
      () => storeFor(home).publish({ ...plan, maximumJournalBytes: plan.maximumJournalBytes + 1 }, HELD),
      "coordinator_journal_maximum",
      LifecycleInfeasiblePlanError,
      EXIT_CODES.capabilityUnavailable,
    );
    expect(await home.read(`state/lifecycle-journals/${plan.id}.plan.json`)).toBeNull();
  });

  it("refuses every mutation that does not hold the global lock", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const store = storeFor(home);
    await expect(store.publish(syntheticUninstallPlan(), FOREIGN_LOCK)).rejects.toThrow(
      LifecycleLockShapeError,
    );
    await expect(store.ensureStagingDirectory(COORDINATOR, FOREIGN_LOCK)).rejects.toThrow(
      LifecycleLockShapeError,
    );
  });
});

describe("journal rewrite", () => {
  async function published(
    home: HomeV1,
    options: StoreOptionsV1 = {},
  ): Promise<{
    readonly store: LifecycleCoordinatorStore<SyntheticPlan>;
    readonly plan: SyntheticPlan;
    readonly journal: LifecycleCoordinatorJournalV1;
  }> {
    const plan = syntheticUninstallPlan();
    const journal = await storeFor(home).publish(plan, HELD);
    return { store: storeFor(home, options), plan, journal };
  }

  it("rewrites through its exact temp and leaves the ledger clear of findings", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const events: LifecycleStoreBoundaryV1[] = [];
    const { store, plan, journal } = await published(home, {
      afterBoundary: (boundary) => {
        events.push(boundary);
      },
    });
    const next: LifecycleCoordinatorJournalV1 = {
      ...journal,
      phase: "participants_applying",
      nextStep: 0,
    };
    await store.rewriteJournal(plan, journal, next, HELD);
    expect(events).toStrictEqual(["rewrite_temp_written", "rewrite_renamed"]);

    const snapshot = await home.inspect();
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators[0]?.journal).toStrictEqual(next);
  });

  it("refuses when the current journal differs from the bytes on disk", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const { store, plan, journal } = await published(home);
    const stale: LifecycleCoordinatorJournalV1 = { ...journal, nextStep: 1 };
    const next: LifecycleCoordinatorJournalV1 = {
      ...journal,
      phase: "participants_applying",
      nextStep: 0,
    };
    await asyncRefusal(
      () => store.rewriteJournal(plan, stale, next, HELD),
      "lifecycle_coordinator_journal_stale",
      LifecycleRecoveryRequiredError,
      EXIT_CODES.recoveryRequired,
    );
    expect((await home.inspect()).coordinators[0]?.journal).toStrictEqual(journal);
  });

  it("refuses a rewrite larger than the plan's maximum before it renames", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const padded: LifecycleValueCodec<LifecycleCoordinatorJournalV1> = {
      validate: (value) => CODECS.coordinatorJournal.validate(value),
      encode: (value) =>
        (CODECS.coordinatorJournal.encode(value) +
          " ".repeat(2048)) as ReturnType<typeof CODECS.coordinatorJournal.encode>,
    };
    const plan = syntheticUninstallPlan();
    const journal = await storeFor(home).publish(plan, HELD);
    const store = storeFor(home, { coordinatorJournalCodec: padded });
    await asyncRefusal(
      () => store.rewriteJournal(plan, journal, { ...journal, nextStep: 1 }, HELD),
      "journal_too_large",
      LifecycleInfeasiblePlanError,
      EXIT_CODES.capabilityUnavailable,
    );
    const snapshot = await home.inspect();
    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(snapshot.coordinators[0]?.journal).toStrictEqual(journal);
  });
});

describe("lifecycle staging directory", () => {
  it("creates the coordinator directory once and re-admits the existing one", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const store = storeFor(home);
    const first = await store.ensureStagingDirectory(COORDINATOR, HELD);
    const created = home.fs.callCounts.get("mkdirExclusive") ?? 0;
    const second = await store.ensureStagingDirectory(COORDINATOR, HELD);
    expect(second).toStrictEqual(first);
    expect(first.mode).toBe(0o700);
    expect(first.ownerUid).toBe(UID);
    expect(home.fs.callCounts.get("mkdirExclusive")).toBe(created);
    expect((await home.inspect()).findings).toStrictEqual([]);
  });

  it("creates `staging/lifecycle` only when it is absent", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const root = await home.fs.lstat(ROOTS.lifecycleStaging);
    if (root === null) throw new Error("fixture lost staging/lifecycle");
    await home.fs.rmdirExactEmpty(root);
    const entry = await storeFor(home).ensureStagingDirectory(COORDINATOR, HELD);
    expect(entry.path).toBe(`${ROOTS.lifecycleStaging}/${COORDINATOR}`);
    expect((await home.fs.lstat(ROOTS.lifecycleStaging))?.mode).toBe(0o700);
  });

  it("refuses a mis-shaped existing staging directory", async () => {
    const home = await memoryLifecycleHome({ nextCounter: "100" });
    const root = await home.fs.lstat(ROOTS.lifecycleStaging);
    if (root === null) throw new Error("fixture lost staging/lifecycle");
    await home.fs.rmdirExactEmpty(root);
    await home.fs.writeExclusive(ROOTS.lifecycleStaging, new Uint8Array(0));
    await asyncRefusal(
      () => storeFor(home).ensureStagingDirectory(COORDINATOR, HELD),
      "lifecycle_staging_shape",
      LifecycleRecoveryRequiredError,
      EXIT_CODES.recoveryRequired,
    );
  });
});
