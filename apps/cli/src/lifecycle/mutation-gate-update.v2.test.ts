import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  buildUpdateCoordinatorPlan,
  deriveUpdateExecutorRecordPath,
  parseCanonicalAbsolutePathText,
  parseLifecycleInstallNonce,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseUtcTimestamp,
  updateCoordinatorPlanBytes,
  updateCoordinatorStagingRoot,
  updateExecutionBindingHash,
  updateLeafPlanPath,
  updateRecoveryExecutorRecordBytes,
  updateRecoveryExecutorRecordHash,
  updateRecoveryExecutorStagedPath,
  validateReleaseIdentity,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  ImmutableUpdatePlanRefV1,
  LifecycleCoordinatorIdV1,
  LowerHexSha256,
  ReleaseIdentityV1,
  TransactionJournalV1,
  UpdateExecutionPlanV1,
  UpdateLeafPlanKindV1,
  UpdateLifecycleCoordinatorPlanV2,
  UpdateRecoveryExecutorRecordV1,
} from "@developer-os/core";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const createdAt = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path) => path,
  containsCanonicalPath: (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}/`),
  hasFoldedAlias: () => false,
};

afterAll(removeCommandFixtures);

let sharedHome: Promise<CommandFixture> | null = null;

function sharedV2Home(): Promise<CommandFixture> {
  sharedHome ??= (async () => {
    const fixture = await createCommandFixture("gate-update-residue", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const result = await runInit(fixture.context, ACCEPTED);
    if (!result.ok) throw new Error(`fixture init failed: ${JSON.stringify(result)}`);
    /** The gate materialises `staging/lifecycle` on its first mutation; every case starts after it. */
    await mutate(fixture, "update-residue-preparation");
    return fixture;
  })();
  return sharedHome;
}

function hex(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(seed).digest("hex"));
}

function mutate(fixture: CommandFixture, name: string): Promise<TransactionJournalV1> {
  return fixture.context.executor.execute({
    kind: "capture",
    mutations: [
      {
        targetPath: join(fixture.paths.home, `${name}.probe.json`),
        operation: "create",
        content: new TextEncoder().encode(`{"probe":"${name}"}\n`),
      },
    ],
  });
}

async function refusalOf(attempt: Promise<unknown>): Promise<{ readonly reason: unknown; readonly code: unknown; readonly recovery: unknown } | null> {
  return attempt.then(
    () => null,
    (error: unknown) => {
      const refusal = error as { readonly reason?: unknown; readonly code?: unknown; readonly recovery?: unknown };
      return { reason: refusal.reason, code: refusal.code, recovery: refusal.recovery };
    },
  );
}

/** An ID the allocator already covers, in this home's nonce. */
async function coordinatorIdOf(fixture: CommandFixture): Promise<LifecycleCoordinatorIdV1> {
  const nonce = parseLifecycleInstallNonce(await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-install-nonce")));
  return `lc_${nonce}_0` as LifecycleCoordinatorIdV1;
}

function executorRecords(id: LifecycleCoordinatorIdV1, current: ReleaseIdentityV1, target: ReleaseIdentityV1): {
  readonly initial: UpdateRecoveryExecutorRecordV1;
  readonly terminal: UpdateRecoveryExecutorRecordV1;
} {
  const executionBindingHash = updateExecutionBindingHash({ coordinatorId: id, operation: "update_rollback", previewHash: hex("preview"), current, target });
  const common = { schemaVersion: 1, coordinatorId: id, operation: "update_rollback", executionBindingHash, createdAt } as const;
  return {
    initial: { ...common, state: "executing", executor: { kind: "release_bundle", release: current } },
    terminal: {
      ...common,
      state: "terminal_cleanup",
      executor: { kind: "package_fallback", bundleManifestHash: hex("fallback"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) },
    },
  };
}

function release(home: CanonicalAbsolutePathV1, version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version,
    releaseSequence: sequence,
    releaseIdentityHash: hex(`identity-${version}`),
    delegationSequence: "1",
    delegationHash: hex("delegation"),
    releaseIndexSequence: sequence,
    releaseIndexHash: hex(`index-${version}`),
    bundleManifestHash: hex(`manifest-${version}`),
    bundleRoot: `${home}/releases/${version}/darwin-arm64`,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
  }, evidence);
}

/** A manual rollback's outer V2 plan, the only envelope leaf left after its journal's removal. */
function rollbackPlan(fixture: CommandFixture, id: LifecycleCoordinatorIdV1): UpdateLifecycleCoordinatorPlanV2 {
  const home = parseCanonicalAbsolutePathText(fixture.paths.home);
  const root = updateCoordinatorStagingRoot(home, id);
  const nonce = id.split("_")[1] ?? "";
  const ref = <TKind extends UpdateLeafPlanKindV1>(kind: TKind, leaf: string): ImmutableUpdatePlanRefV1<TKind> =>
    ({ kind, id: leaf, path: updateLeafPlanPath(root, kind, leaf), hash: hex(`${kind}/${leaf}`), bytes: 128 }) as ImmutableUpdatePlanRefV1<TKind>;
  const current = release(home, "1.1.0", "2");
  const target = release(home, "1.0.0", "1");
  const { initial, terminal } = executorRecords(id, current, target);
  const staged = (record: UpdateRecoveryExecutorRecordV1, ordinal: number) => ({
    constructionOrdinal: ordinal,
    path: updateRecoveryExecutorStagedPath(root, record.state) as UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]["path"],
    bytes: updateRecoveryExecutorRecordBytes(record).byteLength,
    hash: updateRecoveryExecutorRecordHash(record),
    mode: 384 as const,
  });
  const execution: UpdateExecutionPlanV1 = {
    schemaVersion: 1,
    coordinatorId: id,
    operation: "update_rollback",
    previewHash: hex("preview"),
    executionBindingHash: initial.executionBindingHash,
    maximumPlanBytes: 16_777_216,
    current,
    target,
    metadata: { delegationSequence: current.delegationSequence, delegationHash: current.delegationHash, delegatedReleaseKeyId: hex("release-key"), releaseIndexSequence: target.releaseIndexSequence, releaseIndexHash: target.releaseIndexHash },
    planner: null,
    bundle: ref("bundle_publication", "bundle"),
    owners: [ref("owner_update", "owner_core")],
    migrations: [],
    manifest: { transitional: ref("manifest_state", `mf_${nonce}_1`), terminal: ref("manifest_state", `mf_${nonce}_2`) },
    trust: null,
    active: ref("active_release_state", "active"),
    rollback: ref("rollback_record_state", "rollback_record"),
    rollbackPayload: ref("rollback_payload_state", "rollback_payload"),
    initialParticipantJournals: [{
      kind: "bundle_publication",
      id: ref("bundle_publication", "bundle").id,
      planHash: hex("bundle_publication/bundle"),
      finalPath: parseCanonicalAbsolutePathText(`${root}/update/journals/bundle_publication/bundle.json`),
      stagedPath: parseCanonicalAbsolutePathText(`${root}/update/initial-journals/bundle_publication/bundle.json`),
      stagedExpected: { constructionOrdinal: 9, hash: hex("initial-journal"), bytes: 256, mode: 384 },
    }],
    recoveryExecutor: {
      finalPath: deriveUpdateExecutorRecordPath(home),
      initial,
      initialStaged: staged(initial, 10),
      terminal,
      terminalStaged: staged(terminal, 11),
      maximumRecordBytes: 16_384,
    },
    verification: ref("target_verification", "verification"),
    retirement: ref("terminal_retirement", "retirement"),
  };
  return buildUpdateCoordinatorPlan({
    execution,
    executionRef: ref("update_execution", "execution"),
    construction: { path: parseCanonicalAbsolutePathText(`${root}/update-construction.plan.json`), hash: hex("construction"), bytes: 4096 },
    owners: [{ id: ref("owner_update", "owner_core").id, owner: "core", externalEffects: [] }],
    retainPayloadId: null,
  });
}

/** Fresh `init` reserves some planted paths (`state/update-executor.json`) as empty files; those are restored, not removed. */
async function withPlanted(path: string, bytes: Uint8Array, body: () => Promise<void>): Promise<void> {
  const reserved = await nodeFs.readFile(path).catch(() => null);
  if (reserved !== null && reserved.byteLength !== 0) throw new Error(`${path} already holds a record`);
  await nodeFs.writeFile(path, bytes, { mode: 0o600, flag: reserved === null ? "wx" : "w" });
  try {
    await body();
  } finally {
    if (reserved === null) await nodeFs.rm(path, { force: true });
    else await nodeFs.writeFile(path, reserved);
  }
}

describe("the mutation gate beside update residue", () => {
  it("refuses a Spec 1 mutation under update_recovery, names the recorded update operation, and writes nothing", async () => {
    const fixture = await sharedV2Home();
    const id = await coordinatorIdOf(fixture);
    const plan = rollbackPlan(fixture, id);
    const planPath = join(fixture.paths.stateDir, "lifecycle-journals", `${id}.plan.json`);

    await withPlanted(planPath, updateCoordinatorPlanBytes(plan), async () => {
      const before = await inventoryDigest(fixture.paths.home);

      expect(await refusalOf(mutate(fixture, "under-update-recovery"))).toStrictEqual({
        reason: "lifecycle_update_recovery_required",
        code: EXIT_CODES.recoveryRequired,
        recovery: "developer-os update rollback --apply",
      });
      expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a Spec 1 mutation beside a lone terminal_cleanup executor record the V1 ledger cannot see", async () => {
    const fixture = await sharedV2Home();
    const id = await coordinatorIdOf(fixture);
    const home = parseCanonicalAbsolutePathText(fixture.paths.home);
    const { terminal } = executorRecords(id, release(home, "1.1.0", "2"), release(home, "1.0.0", "1"));

    await withPlanted(join(fixture.paths.stateDir, "update-executor.json"), updateRecoveryExecutorRecordBytes(terminal), async () => {
      const before = await inventoryDigest(fixture.paths.home);

      expect(await refusalOf(mutate(fixture, "under-executor-cleanup"))).toStrictEqual({
        reason: "lifecycle_update_recovery_required",
        code: EXIT_CODES.recoveryRequired,
        recovery: "developer-os update --apply",
      });
      expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["an orphan executing executor record", "executing"],
    ["garbage bytes at the executor record", "garbage"],
  ] as const)("refuses a Spec 1 mutation beside %s, a third state closure V2 reports as recovery-required", async (_label, kind) => {
    const fixture = await sharedV2Home();
    const id = await coordinatorIdOf(fixture);
    const home = parseCanonicalAbsolutePathText(fixture.paths.home);
    const { initial } = executorRecords(id, release(home, "1.1.0", "2"), release(home, "1.0.0", "1"));
    const bytes = kind === "executing" ? updateRecoveryExecutorRecordBytes(initial) : new TextEncoder().encode("\u0000not json");

    await withPlanted(join(fixture.paths.stateDir, "update-executor.json"), bytes, async () => {
      const before = await inventoryDigest(fixture.paths.home);

      expect(await refusalOf(mutate(fixture, `beside-${kind}-executor-record`))).toStrictEqual({
        reason: "lifecycle_update_recovery_required",
        code: EXIT_CODES.recoveryRequired,
        recovery: "developer-os doctor",
      });
      expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits the mutation again once the residue is gone", async () => {
    const fixture = await sharedV2Home();

    expect((await mutate(fixture, "after-update-residue")).phase).toBe("finalized");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
