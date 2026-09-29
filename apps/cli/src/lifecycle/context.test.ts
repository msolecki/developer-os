import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  TransactionStore,
  createNodeLifecycleGuardedFileSystem,
  encodeLifecycleIdAllocator,
  maximumCoordinatorJournalBytes,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  resolveRuntimePaths,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  LifecycleBookkeepingResidueV1,
  LifecycleCoordinatorJournalV1,
  LifecycleGuardedFileSystemV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  RuntimePaths,
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
  UInt64DecimalV1,
} from "@developer-os/core";
import { MacOsStableLockProvider } from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { createCommandFixture, removeCommandFixtures } from "../commands/testing.js";
import {
  NODE_FILE_SYSTEM,
  pathEnvironmentFor,
  publishBootstrapInitialJournalNoReplace,
} from "../context.js";
import { uninstallLeasePaths } from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import {
  coordinatorNonceOf,
  createLifecycleContext,
  lifecycleHomeKeyFromCoordinatorId,
  residueFrom,
  uninstallResidueFrom,
} from "./context.js";
import type { CliLifecycleContext } from "./context.js";
import { syntheticUninstall } from "./testing.js";
import type { SyntheticUninstallV1 } from "./testing.js";

const UID = process.getuid?.() ?? 0;
const NONCE: LifecycleInstallNonceV1 = parseLowerHexSha256("3f".repeat(32));
const OTHER_NONCE: LifecycleInstallNonceV1 = parseLowerHexSha256("c1".repeat(32));
const DEV: UInt64DecimalV1 = parseUInt64Decimal("16777232");
const INO: UInt64DecimalV1 = parseUInt64Decimal("184467440737095516");
const MANIFEST_BYTES = "{}\n";
const LEASE_JOBS = ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const;

const EMPTY_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

const LEDGER_DIRECTORIES = [
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

const roots: string[] = [];

afterEach(async () => {
  await removeCommandFixtures();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await nodeFs.rm(root, { recursive: true, force: true });
  }
});

class InProcessTransactionLocks implements TransactionLockProvider {
  readonly #held = new Set<string>();

  acquire(path: string): Promise<TransactionLockHandle> {
    if (this.#held.has(path)) return Promise.reject(new Error("lock already held"));
    this.#held.add(path);
    return Promise.resolve({
      release: (): Promise<void> => {
        this.#held.delete(path);
        return Promise.resolve();
      },
    });
  }
}

interface HomeV1 {
  readonly paths: RuntimePaths;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly lifecycle: CliLifecycleContext;
}

async function newHome(label: string): Promise<HomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-lifecycle-${label}-`));
  const root = await nodeFs.realpath(created);
  roots.push(root);
  const userHome = join(root, "home");
  await nodeFs.mkdir(userHome, { recursive: true, mode: 0o700 });
  const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome, env: {} }));
  await nodeFs.mkdir(paths.home, { recursive: true, mode: 0o700 });
  for (const relative of LEDGER_DIRECTORIES) {
    await nodeFs.mkdir(join(paths.home, relative), { recursive: true, mode: 0o700 });
  }
  const lifecycle = createLifecycleContext({
    paths,
    renameNoReplace: publishBootstrapInitialJournalNoReplace,
    locks: new MacOsStableLockProvider(),
    transactionLocks: new InProcessTransactionLocks(),
    effectiveUid: UID,
    now: () => new Date("2026-09-20T00:00:00.000Z"),
  });
  return {
    paths,
    productHome: parseCanonicalAbsolutePathText(paths.home),
    fs: createNodeLifecycleGuardedFileSystem({
      renameNoReplace: publishBootstrapInitialJournalNoReplace,
      effectiveUid: UID,
    }),
    lifecycle,
  };
}

async function write(home: HomeV1, relative: string, text: string): Promise<void> {
  await nodeFs.writeFile(join(home.paths.home, relative), text, { mode: 0o600 });
}

function journalFor(
  coordinator: SyntheticUninstallV1,
  planHash: LowerHexSha256,
  overrides: Partial<LifecycleCoordinatorJournalV1> = {},
): LifecycleCoordinatorJournalV1 {
  return {
    schemaVersion: 1,
    id: coordinator.id,
    operation: "uninstall",
    phase: "participants_applying",
    planHash,
    pushPlanHash: null,
    nextStep: coordinator.artifactsStep + 1,
    compensationNext: null,
    compactionNext: null,
    terminalOutcome: null,
    createdAt: parseUtcTimestamp("2026-09-20T00:00:00.000Z"),
    updatedAt: parseUtcTimestamp("2026-09-20T00:00:01.000Z"),
    ...overrides,
  };
}

const FOUNDATION_PHASES: readonly TransactionPhase[] = [
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
];

/** The shipped store is the only writer of `FoundationJournalJsonV1`, which the ledger re-encodes byte for byte. */
async function plantFinalizedFoundationJournal(home: HomeV1, id: string): Promise<void> {
  const store = new TransactionStore({
    stateDir: home.paths.stateDir,
    fs: NODE_FILE_SYSTEM,
    lockProvider: new InProcessTransactionLocks(),
  });
  const planned: TransactionJournalV1 = {
    schemaVersion: 1,
    id,
    kind: "lifecycle_participant",
    phase: "planned",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    mutations: [
      {
        targetPath: join(home.paths.stateDir, `${id}.participant.json`),
        operation: "create",
        expectedBeforeHash: null,
        stagedRelativePath: "0.bin",
      },
    ],
  };
  await store.create(planned);
  let previous: TransactionPhase = "planned";
  for (const phase of FOUNDATION_PHASES) {
    await store.transition(id, previous, phase, "2026-09-20T00:00:01.000Z");
    previous = phase;
  }
}

describe("the lifecycle home key", () => {
  it("parses the installation nonce out of a coordinator ID and refuses any other grammar", () => {
    const home = parseCanonicalAbsolutePathText("/product");

    expect(lifecycleHomeKeyFromCoordinatorId(home, `lc_${NONCE}_7`)).toStrictEqual({
      productHome: home,
      nonce: NONCE,
    });
    const refused = [`lc_${"3f".repeat(32).slice(0, 63)}_7`, `tx_${NONCE}_7`, "tx_00000000-0000-4000-8000-000000000000"];
    expect(refused.length).toBeGreaterThan(0);
    for (const candidate of refused) {
      expect(() => lifecycleHomeKeyFromCoordinatorId(home, candidate), candidate).toThrow();
    }
  });
});

describe("the lifecycle composition root", () => {
  it("derives the ledger roots from the injected paths alone", async () => {
    const home = await newHome("roots");

    expect(home.lifecycle.roots.foundationJournals).toBe(join(home.paths.home, "state", "transactions"));
    expect(home.lifecycle.roots.coordinatorJournals).toBe(
      join(home.paths.home, "state", "lifecycle-journals"),
    );
    expect(home.lifecycle.effectiveUid).toBe(UID);
    expect(uninstallLeasePaths(home.productHome)).toStrictEqual(
      LEASE_JOBS.map((job) => join(home.paths.home, "state", `.automation-${job}.lock`)),
    );
  });

  it("collects retained paths and bootstrap participant IDs into the bookkeeping residue", () => {
    const residue = residueFrom({
      retainedPaths: [
        parseCanonicalAbsolutePathText("/product/backups/transactions/tx_fi_a_f"),
        parseCanonicalAbsolutePathText("/product/backups/transactions/tx_fi_a_f/0.bak"),
      ],
      bootstrapParticipantIds: ["tx_fi_a_f", "tx_fi_a_c"],
      unverifiedResidue: { retainedPaths: [], bootstrapParticipantIds: [] },
    });

    expect([...residue.retainedPaths]).toStrictEqual([
      "/product/backups/transactions/tx_fi_a_f",
      "/product/backups/transactions/tx_fi_a_f/0.bak",
    ]);
    expect([...residue.bootstrapParticipantIds]).toStrictEqual(["tx_fi_a_f", "tx_fi_a_c"]);
  });

  it("leaves an unverified envelope's residue unattributed for a mutation and attributes it for uninstall", () => {
    const unverifiedStaging = parseCanonicalAbsolutePathText("/product/staging/transactions/tx_fi_b_f/.developer-os-retained.x");
    const evidence = {
      retainedPaths: [parseCanonicalAbsolutePathText("/product/backups/transactions/tx_fi_a_f"), unverifiedStaging],
      bootstrapParticipantIds: ["tx_fi_a_f", "tx_fi_b_f"],
      unverifiedResidue: { retainedPaths: [unverifiedStaging], bootstrapParticipantIds: ["tx_fi_b_f"] },
    };

    const mutation = residueFrom(evidence);
    const uninstall = uninstallResidueFrom(evidence);

    expect([...mutation.retainedPaths]).toStrictEqual(["/product/backups/transactions/tx_fi_a_f"]);
    expect([...mutation.bootstrapParticipantIds]).toStrictEqual(["tx_fi_a_f"]);
    expect([...uninstall.retainedPaths]).toStrictEqual(evidence.retainedPaths);
    expect([...uninstall.bootstrapParticipantIds]).toStrictEqual(["tx_fi_a_f", "tx_fi_b_f"]);
  });

  it("accepts the shipped bootstrap evidence admission as its residue evidence", async () => {
    const home = await newHome("residue-evidence");

    const residue = residueFrom(
      await inspectBootstrapEvidenceAdmission(
        createBootstrapEvidenceInspectionRequest({
          productHome: home.paths.home,
          stateDirectory: home.paths.stateDir,
          initialRoots: [home.paths.home, home.paths.stateDir],
        }),
      ),
    );

    expect([...residue.retainedPaths]).toStrictEqual([]);
    expect([...residue.bootstrapParticipantIds]).toStrictEqual([]);
  });

  it("validates and inspects a planted plan on a home with no manifest, nonce or allocator", async () => {
    const home = await newHome("manifest-free");
    const coordinator = syntheticUninstall(home.productHome, NONCE, 7n);
    const key = lifecycleHomeKeyFromCoordinatorId(home.productHome, coordinator.id);
    const codecs = home.lifecycle.codecs(key);
    await write(
      home,
      `state/lifecycle-journals/${coordinator.id}.plan.json`,
      codecs.executionPlan.encode(coordinator.plan),
    );

    expect(codecs.executionPlan.validate(coordinator.plan)).toStrictEqual(coordinator.plan);
    const snapshot = await home.lifecycle.inspectLedger(key, EMPTY_RESIDUE);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.allocator).toBeNull();
    expect(snapshot.coordinators.map((record) => record.id)).toStrictEqual([coordinator.id]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("reports the one allocated nonce every coordinator leaf names", async () => {
    const home = await newHome("nonce-of");
    const coordinator = syntheticUninstall(home.productHome, NONCE, 7n);
    const key = lifecycleHomeKeyFromCoordinatorId(home.productHome, coordinator.id);

    expect(await coordinatorNonceOf(home.fs, home.productHome)).toBeNull();

    await write(
      home,
      `state/lifecycle-journals/${coordinator.id}.plan.json`,
      home.lifecycle.codecs(key).executionPlan.encode(coordinator.plan),
    );
    expect(await coordinatorNonceOf(home.fs, home.productHome)).toBe(NONCE);

    await write(home, `state/lifecycle-journals/lc_${OTHER_NONCE}_7.plan.json`, "{}\n");
    await expect(coordinatorNonceOf(home.fs, home.productHome)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
    });
  });
});

describe("the store the composition root hands out", () => {
  it("refuses to encode a grammar-invalid plan that the shared codec would still encode", async () => {
    const home = await newHome("publish-grammar");
    const coordinator = syntheticUninstall(home.productHome, NONCE, 1n);
    const key = lifecycleHomeKeyFromCoordinatorId(home.productHome, coordinator.id);
    const withoutDrain: LifecycleExecutionPlanV1 = {
      ...coordinator.plan,
      steps: coordinator.plan.steps.filter((step) => step.kind !== "drain_runners"),
    };
    const feasible: LifecycleExecutionPlanV1 = {
      ...withoutDrain,
      maximumJournalBytes: maximumCoordinatorJournalBytes(withoutDrain),
    };
    const global: HeldLifecycleStableLockV1 = {
      path: parseCanonicalAbsolutePathText(join(home.paths.stateDir, ".lifecycle.lock")),
      dev: DEV,
      ino: INO,
      release: () => Promise.resolve(),
    };

    expect(home.lifecycle.codecs(key).executionPlan.encode(feasible)).toContain(coordinator.id);
    await expect(home.lifecycle.store(key).publish(feasible, global)).rejects.toThrow(
      /uninstall\/present_manifest_without_launchd/u,
    );
    expect(await nodeFs.readdir(join(home.paths.stateDir, "lifecycle-journals"))).toStrictEqual([]);
  });
});

describe("the command fixture's lifecycle wiring", () => {
  it("hands commands the real global lock, records every hold, and excludes a second holder", async () => {
    const fixture = await createCommandFixture("lifecycle-stable-lock");
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    const lockPath = parseCanonicalAbsolutePathText(
      join(fixture.paths.stateDir, ".lifecycle.lock"),
    );
    await nodeFs.writeFile(lockPath, "", { mode: 0o600 });

    expect(fixture.stableLockEvents).toStrictEqual([]);
    const held = await lifecycle.locks.acquireExisting(lockPath);
    try {
      expect(fixture.stableLockEvents).toStrictEqual([`acquire ${lockPath}`]);
      await expect(lifecycle.locks.acquireExisting(lockPath)).rejects.toMatchObject({
        reason: "lifecycle_lock_busy",
        code: EXIT_CODES.recoveryRequired,
      });
    } finally {
      await held.release();
    }

    expect(fixture.stableLockEvents).toStrictEqual([
      `acquire ${lockPath}`,
      `release ${lockPath}`,
    ]);
    await (await lifecycle.locks.acquireExisting(lockPath)).release();
  });
});

describe("D34's manifestBeforeHash through the CLI's own execution plan", () => {
  async function drainingHome(options: {
    readonly manifestBytes?: string;
    readonly leases?: number;
  }): Promise<{ readonly home: HomeV1; readonly coordinator: SyntheticUninstallV1 }> {
    const home = await newHome("draining");
    const coordinator = syntheticUninstall(home.productHome, NONCE, 1n);
    const key = lifecycleHomeKeyFromCoordinatorId(home.productHome, coordinator.id);
    const codecs = home.lifecycle.codecs(key);
    const planText = codecs.executionPlan.encode(coordinator.plan);
    await write(home, `state/lifecycle-journals/${coordinator.id}.plan.json`, planText);
    await write(
      home,
      `state/lifecycle-journals/${coordinator.id}.json`,
      codecs.coordinatorJournal.encode(
        journalFor(
          coordinator,
          parseLowerHexSha256(
            createHash("sha256")
              .update("developer-os:lifecycle-coordinator-plan:v1\0")
              .update(planText)
              .digest("hex"),
          ),
        ),
      ),
    );
    await write(home, "state/lifecycle-install-nonce", `${NONCE}\n`);
    await write(
      home,
      "state/lifecycle-id-allocator.json",
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: NONCE,
        nextCounter: parseUInt64Decimal("100"),
      }),
    );
    await plantFinalizedFoundationJournal(home, coordinator.markerForward);
    await plantFinalizedFoundationJournal(home, coordinator.artifactsForward);
    await nodeFs.writeFile(
      join(home.paths.home, "installation-manifest.json"),
      options.manifestBytes ?? MANIFEST_BYTES,
      { mode: 0o600 },
    );
    for (const job of LEASE_JOBS.slice(0, options.leases ?? 0)) {
      await write(home, `state/.automation-${job}.lock`, "");
    }
    return { home, coordinator };
  }

  it("reaches uninstall_draining only when the manifest still hashes to the plan's before state", async () => {
    const drained = await drainingHome({});
    const key = lifecycleHomeKeyFromCoordinatorId(
      drained.home.productHome,
      drained.coordinator.id,
    );

    const snapshot = await drained.home.lifecycle.inspectLedger(key, EMPTY_RESIDUE);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({
      kind: "uninstall_draining",
      transactionId: drained.coordinator.id,
    });
  });

  it("never reaches uninstall_draining while the manifest bytes differ from the plan's before hash", async () => {
    const drifted = await drainingHome({ manifestBytes: '{"drifted":true}\n' });
    const key = lifecycleHomeKeyFromCoordinatorId(
      drifted.home.productHome,
      drifted.coordinator.id,
    );

    const snapshot = await drifted.home.lifecycle.inspectLedger(key, EMPTY_RESIDUE);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("never reaches uninstall_draining while any bound lease path survives", async () => {
    const undrained = await drainingHome({ leases: 1 });
    const key = lifecycleHomeKeyFromCoordinatorId(
      undrained.home.productHome,
      undrained.coordinator.id,
    );

    const snapshot = await undrained.home.lifecycle.inspectLedger(key, EMPTY_RESIDUE);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });
});
