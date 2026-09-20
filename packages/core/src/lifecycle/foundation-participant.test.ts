import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { TransactionExecutor } from "../transactions/executor.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type {
  TransactionFileSystem,
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUtcTimestamp, type LowerHexSha256 } from "../update/scalars.js";
import { encodeCanonicalJson } from "./canonical-json.js";
import { foundationParticipantPlanHash, validateFoundationParticipantRef } from "./codecs.js";
import {
  deriveLifecycleLedgerRoots,
  type LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
import {
  FoundationParticipantExecutor,
  type FoundationParticipantStageInputV1,
} from "./foundation-participant.js";
import {
  createNodeLifecycleGuardedFileSystem,
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { parseAllocatedLifecycleId, parseLifecycleCoordinatorId } from "./ids.js";
import { createLinkUnlinkRenameNoReplace } from "./testing.js";
import type { FoundationParticipantRefV1 } from "./types.js";

const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("5a".repeat(32));
const COORDINATOR = parseLifecycleCoordinatorId(`lc_${NONCE}_1`, NONCE);
const FORWARD_ID = parseAllocatedLifecycleId("tx", `tx_${NONCE}_2`, NONCE);
const INVERSE_ID = parseAllocatedLifecycleId("tx", `tx_${NONCE}_3`, NONCE);
const CREATED_AT = parseUtcTimestamp("2026-09-20T12:00:00.000Z");
const MARKER_BYTES = new TextEncoder().encode('{"synthetic":"uninstall marker"}\n');
const PREIMAGE_BYTES = new TextEncoder().encode("synthetic-preimage-configuration\n");
const POSTIMAGE_BYTES = new TextEncoder().encode("synthetic-postimage-configuration\n");
const ALLOCATED_PAYLOAD_MAXIMUM = 16_777_216;

const PHASES: readonly TransactionPhase[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
  "rolled_back",
];

class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

type DeathBoundary = "initial_journal_published" | "backed_up";

class FixtureLockProvider implements TransactionLockProvider {
  async acquire(path: string): Promise<TransactionLockHandle> {
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "", { mode: 0o600, flag: "a" });
    return { release: (): Promise<void> => Promise.resolve() };
  }
}

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await nodeFs.rm(home, { recursive: true, force: true });
  }
});

function digest(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

interface ParticipantHomeV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly participants: FoundationParticipantExecutor;
  readonly executor: TransactionExecutor;
  readonly markerPath: CanonicalAbsolutePathV1;
  readonly configPath: CanonicalAbsolutePathV1;
  participantsDyingAt(boundary: DeathBoundary): FoundationParticipantExecutor;
  participantsDyingAtPhase(phase: TransactionPhase): FoundationParticipantExecutor;
  boundaryRecorder(): {
    readonly boundaries: readonly string[];
    readonly participants: FoundationParticipantExecutor;
  };
}

/**
 * The death after publication is injected at `fs.stat`, not at the publisher: the bridge
 * converts a publisher throw into `TransactionStateError` exactly as the shipped bootstrap
 * bridge does, so a publisher-side death could not be told apart from a refusal. `backUp`
 * reaches `snapshot` — the first `stat` of a mutation target — after the rename and before
 * any phase transition, and `snapshot` rethrows a non-`ENOENT` error untouched.
 */
function transactionExecutor(
  home: CanonicalAbsolutePathV1,
  options: {
    readonly deathAfterPublicationAt?: string;
    readonly dyingPhase?: TransactionPhase;
  } = {},
): TransactionExecutor {
  const publisher = createLinkUnlinkRenameNoReplace();
  const fs: TransactionFileSystem = {
    ...nodeFs,
    stat: ((path: Parameters<typeof nodeFs.stat>[0], ...rest: readonly never[]) => {
      if (String(path) === options.deathAfterPublicationAt) {
        throw new SyntheticDeath("initial_journal_published");
      }
      return nodeFs.stat(path, ...rest);
    }) as typeof nodeFs.stat,
  };
  return new TransactionExecutor({
    stateDir: join(home, "state"),
    stagingDir: join(home, "staging"),
    backupsDir: join(home, "backups"),
    fs,
    clock: () => "2026-09-20T12:00:01.000Z",
    generateId: () => {
      throw new Error("the lifecycle participant bridge must not generate an ID");
    },
    guards: {
      assertTarget: () => Promise.resolve(),
      redactDiagnostic: (text) => text,
    },
    lockProvider: new FixtureLockProvider(),
    afterPhase: (phase) => {
      if (options.dyingPhase !== undefined && phase === options.dyingPhase) {
        throw new SyntheticDeath(phase);
      }
    },
    publishBootstrapInitialJournalNoReplace: (request) => publisher.publish(request),
  });
}

async function nodeLifecycleHome(label: string): Promise<ParticipantHomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  for (const relative of [
    "state",
    "state/transactions",
    "staging",
    "staging/transactions",
    "staging/lifecycle",
    "backups",
    "backups/transactions",
  ]) {
    await nodeFs.mkdir(join(created, relative));
    await nodeFs.chmod(join(created, relative), 0o700);
  }
  const home = parseCanonicalAbsolutePathText(created);
  const roots = deriveLifecycleLedgerRoots(home);
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: UID,
  });
  const participantsWith = (
    executor: TransactionExecutor,
    afterBoundary?: (boundary: string) => void,
  ): FoundationParticipantExecutor =>
    new FoundationParticipantExecutor({
      fs,
      roots,
      executor,
      effectiveUid: UID,
      afterBoundary,
    });

  const markerPath = parseCanonicalAbsolutePathText(join(created, "state", "uninstalling.json"));
  const executor = transactionExecutor(home);

  return {
    home,
    roots,
    fs,
    executor,
    participants: participantsWith(executor),
    markerPath,
    configPath: parseCanonicalAbsolutePathText(join(created, "config.toml")),
    participantsDyingAtPhase: (phase) =>
      participantsWith(transactionExecutor(home, { dyingPhase: phase })),
    participantsDyingAt: (boundary) =>
      participantsWith(
        transactionExecutor(
          home,
          boundary === "initial_journal_published"
            ? { deathAfterPublicationAt: markerPath }
            : { dyingPhase: "backed_up" },
        ),
      ),
    boundaryRecorder: () => {
      const boundaries: string[] = [];
      return {
        boundaries,
        participants: participantsWith(transactionExecutor(home), (boundary) => {
          boundaries.push(boundary);
        }),
      };
    },
  };
}

function forwardMarkerInput(home: ParticipantHomeV1): FoundationParticipantStageInputV1 {
  return {
    coordinatorId: COORDINATOR,
    id: FORWARD_ID,
    slot: "uninstall_marker",
    role: { kind: "forward", compensationId: INVERSE_ID },
    createdAt: CREATED_AT,
    mutations: [
      {
        targetPath: home.markerPath,
        operation: "create",
        expectedBeforeHash: null,
        content: MARKER_BYTES,
      },
    ],
  };
}

function forwardConfigInput(home: ParticipantHomeV1): FoundationParticipantStageInputV1 {
  return {
    coordinatorId: COORDINATOR,
    id: FORWARD_ID,
    slot: "config",
    role: { kind: "forward", compensationId: INVERSE_ID },
    createdAt: CREATED_AT,
    mutations: [
      {
        targetPath: home.configPath,
        operation: "replace",
        expectedBeforeHash: digest(PREIMAGE_BYTES),
        content: POSTIMAGE_BYTES,
      },
    ],
  };
}

function inverseConfigInput(
  home: ParticipantHomeV1,
  content: Uint8Array,
): FoundationParticipantStageInputV1 {
  return {
    coordinatorId: COORDINATOR,
    id: INVERSE_ID,
    slot: "config",
    role: { kind: "compensation", forwardId: FORWARD_ID },
    createdAt: CREATED_AT,
    mutations: [
      {
        targetPath: home.configPath,
        operation: "replace",
        expectedBeforeHash: digest(POSTIMAGE_BYTES),
        content,
      },
    ],
  };
}

function plannedJournalOf(ref: FoundationParticipantRefV1, kind: string): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id: ref.id,
    kind,
    phase: "planned",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    mutations: ref.mutations.map((mutation, index) => ({
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      stagedRelativePath: mutation.operation === "remove" ? null : `${String(index)}.bin`,
    })),
  };
}

function widestJournalBytes(journal: TransactionJournalV1): number {
  return Math.max(
    ...PHASES.map(
      (phase) =>
        new TextEncoder().encode(encodeFoundationJournalJsonV1({ ...journal, phase })).byteLength,
    ),
  );
}

async function installPreimage(path: CanonicalAbsolutePathV1): Promise<void> {
  await nodeFs.writeFile(path, PREIMAGE_BYTES, { mode: 0o600 });
}

async function plantByteIdenticalFinalJournal(
  home: ParticipantHomeV1,
  ref: FoundationParticipantRefV1,
): Promise<void> {
  const staged = await nodeFs.readFile(ref.initialJournal.stagedPath);
  await nodeFs.writeFile(ref.initialJournal.finalPath, staged, { mode: 0o600, flag: "wx" });
  await nodeFs.unlink(ref.initialJournal.stagedPath);
}

async function identityOf(path: string): Promise<string> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return `${stats.dev.toString(10)}:${stats.ino.toString(10)}`;
}

async function missing(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return false;
  } catch {
    return true;
  }
}

async function refusesRecoveryRequired(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
}

describe("FoundationParticipantExecutor.stage", () => {
  it("writes the exact staged blobs, digest and initial journal a validated ref recomputes", async () => {
    const home = await nodeLifecycleHome("participant-stage");
    const ref = await home.participants.stage(forwardMarkerInput(home));

    const stagedContent = join(home.roots.foundationStaging, FORWARD_ID, "0.bin");
    expect([...(await nodeFs.readFile(stagedContent))]).toStrictEqual([...MARKER_BYTES]);
    expect(await nodeFs.readFile(`${stagedContent}.sha256`, "utf8")).toBe(
      `${digest(MARKER_BYTES)}\n`,
    );
    expect((await nodeFs.lstat(stagedContent)).mode & 0o777).toBe(0o600);
    expect((await nodeFs.lstat(`${stagedContent}.sha256`)).mode & 0o777).toBe(0o600);

    const planned = plannedJournalOf(ref, "lifecycle.uninstall_marker");
    const plannedBytes = new TextEncoder().encode(encodeFoundationJournalJsonV1(planned));
    expect(ref.initialJournal.stagedPath).toBe(
      `${home.home}/staging/lifecycle/${COORDINATOR}/foundation/${FORWARD_ID}/journal.json`,
    );
    expect([...(await nodeFs.readFile(ref.initialJournal.stagedPath))]).toStrictEqual([
      ...plannedBytes,
    ]);
    expect(ref.initialJournal.plannedBytesHash).toBe(digest(plannedBytes));
    expect(ref.initialJournal.stagedIdentity.hash).toBe(digest(plannedBytes));
    expect(ref.initialJournal.stagedIdentity.size).toBe(plannedBytes.byteLength);
    expect(
      `${ref.initialJournal.stagedIdentity.dev}:${ref.initialJournal.stagedIdentity.ino}`,
    ).toBe(await identityOf(ref.initialJournal.stagedPath));
    expect(ref.maximumJournalBytes).toBe(widestJournalBytes(planned));
    expect(ref.planHash).toBe(
      foundationParticipantPlanHash({
        slot: ref.slot,
        role: ref.role,
        mutations: ref.mutations,
        maximumJournalBytes: ref.maximumJournalBytes,
        initialJournal: ref.initialJournal,
      }),
    );

    const revalidated = validateFoundationParticipantRef(
      JSON.parse(encodeCanonicalJson(ref as never)) as unknown,
      { productHome: home.home, nonce: NONCE },
      COORDINATOR,
    );
    expect(revalidated).toStrictEqual(ref);
    expect(await home.participants.observe(ref)).toBe("staged");
  });

  it("refuses content over the allocated Foundation payload ceiling before any write", async () => {
    const home = await nodeLifecycleHome("participant-oversized");
    const input = forwardMarkerInput(home);

    await expect(
      home.participants.stage({
        ...input,
        mutations: input.mutations.map((mutation) => ({
          ...mutation,
          content: new Uint8Array(ALLOCATED_PAYLOAD_MAXIMUM + 1),
        })),
      }),
    ).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    expect(await nodeFs.readdir(home.roots.foundationStaging)).toStrictEqual([]);
    expect(await nodeFs.readdir(home.roots.lifecycleStaging)).toStrictEqual([]);
  });

  it("refuses a compensation whose staged preimage does not invert its forward", async () => {
    const home = await nodeLifecycleHome("participant-inverse-mismatch");
    await installPreimage(home.configPath);
    await home.participants.stage(forwardConfigInput(home));

    await expect(
      home.participants.stage(
        inverseConfigInput(home, new TextEncoder().encode("not-the-forward-preimage\n")),
      ),
    ).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});

describe("FoundationParticipantExecutor.apply", () => {
  it("resumes a first journal that died after publication from its pre-recorded staged inode", async () => {
    const home = await nodeLifecycleHome("participant-death-after-publication");
    const ref = await home.participants.stage(forwardMarkerInput(home));

    await expect(
      home.participantsDyingAt("initial_journal_published").apply(ref),
    ).rejects.toThrow(SyntheticDeath);
    expect(await home.participants.observe(ref)).toBe("planned");
    expect(`${ref.initialJournal.stagedIdentity.dev}:${ref.initialJournal.stagedIdentity.ino}`).toBe(
      await identityOf(ref.initialJournal.finalPath),
    );

    expect((await home.participants.apply(ref)).phase).toBe("finalized");
    expect([...(await nodeFs.readFile(home.markerPath))]).toStrictEqual([...MARKER_BYTES]);
  });

  it("refuses a byte-identical final journal with a different inode", async () => {
    const home = await nodeLifecycleHome("participant-different-inode");
    const ref = await home.participants.stage(forwardMarkerInput(home));
    await plantByteIdenticalFinalJournal(home, ref);
    const planted = await identityOf(ref.initialJournal.finalPath);

    await refusesRecoveryRequired(home.participants.apply(ref));

    expect(await identityOf(ref.initialJournal.finalPath)).toBe(planted);
    expect(await missing(home.markerPath)).toBe(true);
  });

  it("resumes past the first transition although the ordinary rewrite replaced the journal inode", async () => {
    const home = await nodeLifecycleHome("participant-rewritten-inode");
    const ref = await home.participants.stage(forwardMarkerInput(home));

    await expect(home.participantsDyingAt("backed_up").apply(ref)).rejects.toThrow(SyntheticDeath);
    expect(await home.participants.observe(ref)).toBe("backed_up");
    expect(await identityOf(ref.initialJournal.finalPath)).not.toBe(
      `${ref.initialJournal.stagedIdentity.dev}:${ref.initialJournal.stagedIdentity.ino}`,
    );

    expect((await home.participants.apply(ref)).phase).toBe("finalized");
  });

  it("refuses an apply whose staged and final journals are both absent", async () => {
    const home = await nodeLifecycleHome("participant-both-absent");
    const ref = await home.participants.stage(forwardMarkerInput(home));
    await nodeFs.unlink(ref.initialJournal.stagedPath);

    await refusesRecoveryRequired(home.participants.apply(ref));
    expect(await missing(home.markerPath)).toBe(true);
  });

  it("refuses an apply whose staged and final journals are both present", async () => {
    const home = await nodeLifecycleHome("participant-both-present");
    const ref = await home.participants.stage(forwardMarkerInput(home));
    await nodeFs.copyFile(ref.initialJournal.stagedPath, ref.initialJournal.finalPath);
    await nodeFs.chmod(ref.initialJournal.finalPath, 0o600);

    await refusesRecoveryRequired(home.participants.apply(ref));
    expect(await missing(home.markerPath)).toBe(true);
    expect(await missing(ref.initialJournal.stagedPath)).toBe(false);
    expect(await missing(ref.initialJournal.finalPath)).toBe(false);
  });

  it("keeps the inverse preimage bytes after the forward finalizes and prunes its backups", async () => {
    const home = await nodeLifecycleHome("participant-inverse-independent");
    await installPreimage(home.configPath);
    const forward = await home.participants.stage(forwardConfigInput(home));
    const inverse = await home.participants.stage(inverseConfigInput(home, PREIMAGE_BYTES));

    expect((await home.participants.apply(forward)).phase).toBe("finalized");
    expect([...(await nodeFs.readFile(home.configPath))]).toStrictEqual([...POSTIMAGE_BYTES]);
    expect(await missing(join(home.roots.foundationBackups, FORWARD_ID, "0.bin"))).toBe(true);

    const inversePayload = join(home.roots.foundationStaging, INVERSE_ID, "0.bin");
    expect([...(await nodeFs.readFile(inversePayload))]).toStrictEqual([...PREIMAGE_BYTES]);
    expect((await home.participants.apply(inverse)).phase).toBe("finalized");
    expect([...(await nodeFs.readFile(home.configPath))]).toStrictEqual([...PREIMAGE_BYTES]);
  });
});

describe("FoundationParticipantExecutor.observe and discardUnstarted", () => {
  it("distinguishes future, staged and every reached journal phase", async () => {
    const home = await nodeLifecycleHome("participant-observe");
    const ref = await home.participants.stage(forwardMarkerInput(home));
    const observed = [await home.participants.observe(ref)];

    for (const phase of ["backed_up", "staged", "validated", "applied", "verified"] as const) {
      await expect(home.participantsDyingAtPhase(phase).apply(ref)).rejects.toThrow(SyntheticDeath);
      observed.push(await home.participants.observe(ref));
    }
    await home.participants.apply(ref);
    observed.push(await home.participants.observe(ref));

    const discarded = await nodeLifecycleHome("participant-observe-future");
    const unstaged = await discarded.participants.stage(forwardMarkerInput(discarded));
    await discarded.participants.discardUnstarted(unstaged);
    observed.push(await discarded.participants.observe(unstaged));

    const undone = await nodeLifecycleHome("participant-observe-rolled-back");
    const rolled = await undone.participants.stage(forwardMarkerInput(undone));
    await expect(undone.participantsDyingAtPhase("backed_up").apply(rolled)).rejects.toThrow(
      SyntheticDeath,
    );
    await undone.executor.rollback(rolled.id);
    observed.push(await undone.participants.observe(rolled));

    expect(observed.length).toBeGreaterThan(0);
    expect(observed).toStrictEqual([
      "staged",
      "backed_up",
      "staged",
      "validated",
      "applied",
      "verified",
      "finalized",
      "future",
      "rolled_back",
    ]);
  });

  it("removes only the still-staged journal and its exact blobs, and emits one boundary per leaf", async () => {
    const home = await nodeLifecycleHome("participant-discard");
    await installPreimage(home.configPath);
    const recorder = home.boundaryRecorder();
    const ref = await recorder.participants.stage(forwardConfigInput(home));
    const stagedContent = join(home.roots.foundationStaging, FORWARD_ID, "0.bin");

    await recorder.participants.discardUnstarted(ref);

    expect(recorder.boundaries.length).toBeGreaterThan(0);
    expect(await missing(ref.initialJournal.stagedPath)).toBe(true);
    expect(await missing(stagedContent)).toBe(true);
    expect(await missing(`${stagedContent}.sha256`)).toBe(true);
    expect(await missing(dirname(stagedContent))).toBe(false);
    expect([...(await nodeFs.readFile(home.configPath))]).toStrictEqual([...PREIMAGE_BYTES]);
  });

  it("refuses to discard once a mutation target has left its recorded preimage", async () => {
    const home = await nodeLifecycleHome("participant-discard-drift");
    await installPreimage(home.configPath);
    const ref = await home.participants.stage(forwardConfigInput(home));
    await nodeFs.writeFile(home.configPath, POSTIMAGE_BYTES, { mode: 0o600 });

    await expect(home.participants.discardUnstarted(ref)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect(await missing(ref.initialJournal.stagedPath)).toBe(false);
  });

  it("refuses to discard once the final journal exists", async () => {
    const home = await nodeLifecycleHome("participant-discard-started");
    const ref = await home.participants.stage(forwardMarkerInput(home));
    await home.participants.apply(ref);

    await expect(home.participants.discardUnstarted(ref)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect(await missing(ref.initialJournal.finalPath)).toBe(false);
  });
});
