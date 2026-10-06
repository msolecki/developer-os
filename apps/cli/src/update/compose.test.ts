import {
  bundleMetadataPath,
  decodeCanonicalJson,
  decodeRetainedInverseLeaf,
  encodeCanonicalJson,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseUInt64Decimal,
  rollbackStepListHash,
  validateConstructionBijections,
  validateUpdateCoordinatorPlan,
  type BundlePublicationPlanV1,
  type CanonicalStateFilePlanV1,
  type InstallationManifestV2,
  type LifecycleCoordinatorIdV1,
  type OwnerUpdatePlanV1,
  type RollbackPayloadStatePlanV1,
  type UpdateLifecycleCoordinatorJournalV2,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateTerminalRetirementPlanV1,
  type LifecycleGuardedEntryV1,
  type LowerHexSha256,
  type UpdateFallbackHandoffV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { PLUGIN_NAME } from "@developer-os/adapter-codex";
import type { ProcessRunner } from "@developer-os/security";

import { codexPluginTreeHash, inspectCodexRegistration, validateCodexRegistrationRecord } from "../instructions/codex-registration.js";
import type { UpdateApplyComposeInputV1, UpdateApplyPortsV1, UpdateRollbackComposeInputV1 } from "./apply.js";
import { composeRollback, composeUpdate, updateApplyPrefixes, updateRollbackPrefixes, type ComposeDepsV1, type ObservedPathV1, type RollbackComposeDepsV1 } from "./compose.js";
import type { CliUpdateContext } from "./context.js";
import { planRollback, prepareUpdate, UpdatePlanningRefusal } from "./planning.js";
import { applyRollback } from "./rollback-apply.js";
import {
  CODEX_PLUGIN_FILE,
  CODEX_PLUGIN_ROOT,
  CODEX_REGISTRATION_PATH,
  codexRegistrationBytes,
  createUpdateFixture,
  DIRECTORY_PATH,
  FILE_A_PATH,
  FILE_B_PATH,
  NEW_A,
  NEW_B,
  NEW_NOTE,
  NEW_PLUGIN,
  NOTE_PATH,
  OLD_A,
  OLD_B,
  OLD_NOTE,
  OLD_PLUGIN,
  PLANNED_AT,
  rollbackEvidenceFor,
  rollbackTemplateHash,
  sha256,
  SYNTHETIC_CODEX_HOMES,
  SYNTHETIC_EVIDENCE,
  SYNTHETIC_HOME,
} from "./testing.js";

const UID = 501;
const COORDINATOR = `lc_${"a".repeat(64)}_10` as LifecycleCoordinatorIdV1;
const STAGING_ROOT = `${SYNTHETIC_HOME}/staging/lifecycle/${COORDINATOR}`;
const FALLBACK: UpdateFallbackHandoffV1 = { bundleManifestHash: sha256("fallback manifest"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };
const encoder = new TextEncoder();
const BRAIN_ROOT = parseCanonicalAbsolutePathText("/synthetic/user/brain");

let inode = 100;

function observed(path: string, kind: LifecycleGuardedEntryV1["kind"], content: Uint8Array | null, mode = kind === "directory" ? 0o700 : 0o600): ObservedPathV1 {
  inode += 1;
  return {
    entry: { path: parseCanonicalAbsolutePathText(path), kind, ownerUid: UID, mode, nlink: 1, size: parseUInt64Decimal(String(content?.byteLength ?? 0)), dev: parseUInt64Decimal("7"), ino: parseUInt64Decimal(String(inode)) },
    sha256: content === null ? null : sha256(content),
  };
}

interface Composed {
  readonly input: UpdateApplyComposeInputV1;
  readonly world: Map<string, ObservedPathV1>;
  readonly deps: ComposeDepsV1;
}

/** The synthetic home after a preview, observed under the lock exactly as the planner saw it. */
async function composeFixture(options: { readonly fallback?: UpdateFallbackHandoffV1; readonly codex?: boolean; readonly migration?: boolean } = {}): Promise<Composed> {
  const fixture = createUpdateFixture({ ...(options.codex === true ? { codex: { registration: "registered" as const } } : {}), migration: options.migration === true });
  const planned = await prepareUpdate(fixture.update, { version: null });
  const prepared = planned.apply;
  if (prepared === null) throw new Error("the fixture previews an update");
  const canonical = (value: unknown): Uint8Array => encoder.encode(`${JSON.stringify(value)}\n`);
  const world = new Map<string, ObservedPathV1>([
    [STAGING_ROOT, observed(STAGING_ROOT, "directory", null)],
    [`${SYNTHETIC_HOME}/installation-manifest.json`, observed(`${SYNTHETIC_HOME}/installation-manifest.json`, "regular_file", canonical(prepared.home.manifest))],
    [DIRECTORY_PATH, observed(DIRECTORY_PATH, "directory", null)],
    [FILE_A_PATH, observed(FILE_A_PATH, "regular_file", OLD_A)],
    [FILE_B_PATH, observed(FILE_B_PATH, "regular_file", OLD_B)],
    [`${SYNTHETIC_HOME}/state/release-trust.json`, observed(`${SYNTHETIC_HOME}/state/release-trust.json`, "regular_file", canonical(prepared.home.trust))],
    [`${SYNTHETIC_HOME}/state/active-release.json`, observed(`${SYNTHETIC_HOME}/state/active-release.json`, "regular_file", canonical(prepared.home.active))],
    ...(options.codex === true
      ? [
          [CODEX_PLUGIN_ROOT, observed(CODEX_PLUGIN_ROOT, "directory", null)],
          [CODEX_PLUGIN_FILE, observed(CODEX_PLUGIN_FILE, "regular_file", OLD_PLUGIN)],
          [CODEX_REGISTRATION_PATH, observed(CODEX_REGISTRATION_PATH, "regular_file", codexRegistrationBytes(OLD_PLUGIN))],
        ] as const
      : []),
    ...(options.migration === true ? [[`${BRAIN_ROOT}/${NOTE_PATH}`, observed(`${BRAIN_ROOT}/${NOTE_PATH}`, "regular_file", OLD_NOTE)]] as const : []),
  ]);
  const deps: ComposeDepsV1 = {
    productHome: SYNTHETIC_HOME,
    effectiveUid: UID,
    evidence: SYNTHETIC_EVIDENCE,
    fallback: options.fallback ?? FALLBACK,
    brainRoot: BRAIN_ROOT,
    observe: (path) => Promise.resolve(world.get(path) ?? null),
    admitManifest: (value) => value as never,
    codexHomes: options.codex === true ? SYNTHETIC_CODEX_HOMES : null,
  };
  return { input: { coordinatorId: COORDINATOR, home: prepared.home, inputs: prepared.inputs, materialized: prepared.materialized }, world, deps };
}

async function refusal(work: Promise<unknown>): Promise<UpdatePlanningRefusal> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function statePlanOf(composed: Awaited<ReturnType<typeof composeUpdate>>, planKind: string): CanonicalStateFilePlanV1 {
  const row = composed.construction.files.find((file) => file.role.kind === "immutable_plan" && file.role.planKind === planKind);
  const bytes = row === undefined ? undefined : composed.sources.rowBytes.get(row.ordinal);
  if (bytes === undefined) throw new Error(`no ${planKind} plan row`);
  return decodeCanonicalJson(bytes, bytes.byteLength) as unknown as CanonicalStateFilePlanV1;
}

describe("composeUpdate", () => {

  it("reserves exactly the prefixes it consumes: coordinator, payload, two manifests, one Foundation pair", async () => {
    const { input } = await composeFixture();
    expect(updateApplyPrefixes(input.materialized)).toEqual(["lc", "rb", "mf", "mf", "tx", "tx"]);
  });

  it("composes a construction plan the Core validator admits, handing off to the §9.3 step order", async () => {
    const { input, deps } = await composeFixture();
    const composed = await composeUpdate(input, deps);
    expect(composed.construction.coordinatorId).toBe(COORDINATOR);
    expect(composed.construction.operation).toBe("update_apply");
    expect(validateConstructionBijections(composed.construction)).toBe(true);
    const outer = validateUpdateCoordinatorPlan(decodeCanonicalJson(composed.outer.plan, composed.outer.plan.byteLength), SYNTHETIC_HOME);
    expect(outer.steps.map((step) => step.kind)).toEqual([
      "bundle", "owner_files", "rollback_payload", "manifest", "manifest", "trust", "rollback_record", "active",
      "target_verifier", "recovery_executor", "terminal_retire", "manifest", "manifest",
    ]);
    expect(outer.construction.hash).toBeDefined();
  });

  it("re-derives byte-identical construction and outer bytes from the same under-lock input", async () => {
    const { input, deps } = await composeFixture();
    const first = await composeUpdate(input, deps);
    const second = await composeUpdate(input, deps);
    expect(encoder.encode(JSON.stringify(second.construction))).toEqual(encoder.encode(JSON.stringify(first.construction)));
    expect(second.outer).toEqual(first.outer);
  });

  it("binds the three signed metadata rows to the target's signed hashes (P4)", async () => {
    const { input, deps } = await composeFixture();
    const composed = await composeUpdate(input, deps);
    const rows = composed.construction.files.filter((file) => file.role.kind === "payload" && file.role.source.kind === "plan_derived" && file.role.source.role === "release_metadata_after");
    const { target } = input.inputs;
    expect(rows.map((row) => row.sha256)).toEqual([target.delegationHash, target.releaseIndexHash, target.bundleManifestHash]);
  });

  it("plans an empty rollback reservation as absent, so a fresh home updates (Review Focus 2)", async () => {
    const { input, deps, world } = await composeFixture();
    const reservation = `${SYNTHETIC_HOME}/state/update-rollback.json`;
    world.set(reservation, observed(reservation, "regular_file", new Uint8Array()));
    const composed = await composeUpdate(input, deps);
    expect(statePlanOf(composed, "rollback_record_state").before).toEqual({ state: "absent" });
  });

  it("stages the transitional manifest with the proposed rollback payload partition", async () => {
    const { input, deps } = await composeFixture();
    const composed = await composeUpdate(input, deps);
    const manifestRow = composed.construction.files.find((file) => file.role.kind === "payload" && file.role.source.kind === "plan_derived" && file.role.source.role === "manifest_after");
    if (manifestRow?.role.kind !== "payload" || manifestRow.role.source.kind !== "plan_derived") throw new Error("no manifest row");
    const manifest = decodeCanonicalJson(encoder.encode(manifestRow.role.source.value), 1 << 26) as { readonly artifacts: readonly { readonly path: string }[] };
    const payloadRoot = `${SYNTHETIC_HOME}/rollback/rb_${"a".repeat(64)}_11`;
    expect(manifest.artifacts.map((row) => row.path)).toContain(`${payloadRoot}/inventory.json`);
    expect(manifest.artifacts.map((row) => row.path)).toContain(input.inputs.target.bundleRoot);
  });

  it("refuses an owner file edited since the preview, before any row is derived", async () => {
    const { input, deps, world } = await composeFixture();
    world.set(FILE_A_PATH, observed(FILE_A_PATH, "regular_file", encoder.encode("edited\n")));
    expect(await refusal(composeUpdate(input, deps))).toMatchObject({ reason: "update_state_changed", code: EXIT_CODES.operationalFailure });
  });

  it("refuses a staging root that is not the owner-only reserved directory", async () => {
    const { input, deps, world } = await composeFixture();
    world.set(STAGING_ROOT, observed(STAGING_ROOT, "directory", null, 0o755));
    expect(await refusal(composeUpdate(input, deps))).toMatchObject({ reason: "update_construction_staging_root", code: EXIT_CODES.recoveryRequired });
  });

  it("refuses a fallback whose protocols differ from the current release's", async () => {
    const { input, deps } = await composeFixture({ fallback: { ...FALLBACK, updateProtocol: parsePositiveUInt32(2) } });
    expect(await refusal(composeUpdate(input, deps))).toMatchObject({ reason: "update_fallback_protocol", code: EXIT_CODES.capabilityUnavailable });
  });

  it("refuses a coordinator whose allocator-reserved staging root is absent", async () => {
    const { input, deps } = await composeFixture();
    const hash: LowerHexSha256 = parseLowerHexSha256("b".repeat(64));
    expect(await refusal(composeUpdate({ ...input, coordinatorId: `lc_${hash}_10` as LifecycleCoordinatorIdV1 }, deps))).toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
});

interface RollbackComposed {
  readonly input: UpdateRollbackComposeInputV1;
  readonly world: Map<string, ObservedPathV1>;
  readonly deps: RollbackComposeDepsV1;
}

function observedHash(path: string, hash: LowerHexSha256, bytes: number): ObservedPathV1 {
  const found = observed(path, "regular_file", new Uint8Array(bytes));
  return { ...found, sha256: hash };
}

/** The synthetic 1.1.0 home with 1.0.0 retained, after `update rollback` previewed it, observed under the lock. */
async function rollbackFixture(): Promise<RollbackComposed> {
  const fixture = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
  const preview = await planRollback(fixture.update);
  const { home } = fixture;
  if (home.rollback === null) throw new Error("the fixture retains a rollback");
  const previous = home.rollback.previous;
  const recordBytes = encoder.encode(encodeCanonicalJson(home.rollback as never));
  const world = new Map<string, ObservedPathV1>([
    [STAGING_ROOT, observed(STAGING_ROOT, "directory", null)],
    [`${SYNTHETIC_HOME}/installation-manifest.json`, observed(`${SYNTHETIC_HOME}/installation-manifest.json`, "regular_file", encoder.encode(encodeCanonicalJson(home.manifest as never)))],
    [DIRECTORY_PATH, observed(DIRECTORY_PATH, "directory", null)],
    [FILE_A_PATH, observed(FILE_A_PATH, "regular_file", NEW_A)],
    [FILE_B_PATH, observed(FILE_B_PATH, "regular_file", NEW_B)],
    [`${SYNTHETIC_HOME}/state/active-release.json`, observed(`${SYNTHETIC_HOME}/state/active-release.json`, "regular_file", encoder.encode(encodeCanonicalJson(home.active as never)))],
    [`${SYNTHETIC_HOME}/state/update-rollback.json`, observed(`${SYNTHETIC_HOME}/state/update-rollback.json`, "regular_file", recordBytes)],
    [previous.bundleRoot, observed(previous.bundleRoot, "directory", null)],
    ...[previous.delegationHash, previous.releaseIndexHash, previous.bundleManifestHash].map((hash, ordinal) => [bundleMetadataPath(previous, ordinal), observedHash(bundleMetadataPath(previous, ordinal), hash, 64)] as const),
  ]);
  const retained = rollbackEvidenceFor(home.rollback);
  const previousRelease = fixture.releases.get("1.0.0");
  if (previousRelease === undefined) throw new Error("the fixture has 1.0.0");
  const deps: RollbackComposeDepsV1 = {
    productHome: SYNTHETIC_HOME,
    effectiveUid: UID,
    evidence: SYNTHETIC_EVIDENCE,
    fallback: FALLBACK,
    brainRoot: parseCanonicalAbsolutePathText("/synthetic/user/brain"),
    observe: (path) => Promise.resolve(world.get(path) ?? null),
    admitManifest: (value) => value as never,
    codexHomes: null,
    plannedAt: PLANNED_AT,
    retained: { owners: retained.owners, migrations: retained.migrations, entryCount: retained.payload.entryCount, aggregateBytes: retained.payload.aggregateBytes, exactStepListHash: rollbackTemplateHash(retained) },
    previousBundle: previousRelease.manifest,
  };
  return { input: { coordinatorId: COORDINATOR, home, preview }, world, deps };
}

/**
 * NEW-168: the same home with a Codex owner whose update replaced `plugin.json` (and, by P6(d), the
 * registration record). The retained Codex inverse restores only the plugin file, as `prepareInverse`
 * builds it from the planner's operations.
 */
async function codexRollbackFixture(): Promise<RollbackComposed & { readonly update: CliUpdateContext }> {
  const fixture = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0", codex: { registration: "registered" } });
  const { rollback } = fixture.home;
  if (rollback === null) throw new Error("the fixture retains a rollback");
  const updated = codexRegistrationBytes(NEW_PLUGIN);
  const manifest = {
    ...fixture.home.manifest,
    artifacts: fixture.home.manifest.artifacts.map((row) =>
      row.path === CODEX_PLUGIN_FILE || row.path === CODEX_REGISTRATION_PATH
        ? { ...row, verification: { ...row.verification, installedHash: sha256(row.path === CODEX_PLUGIN_FILE ? NEW_PLUGIN : updated) } }
        : row),
  } as InstallationManifestV2;
  const home = { ...fixture.home, manifest };
  const core = rollbackEvidenceFor(rollback);
  const codexInverse = {
    ...core.owners[0],
    id: "owner_codex",
    owner: "codex",
    operations: [{
      path: CODEX_PLUGIN_FILE,
      expectedCurrent: { state: "file", mode: 384, bytes: NEW_PLUGIN.byteLength, sha256: sha256(NEW_PLUGIN), payload: null },
      restore: {
        state: "file",
        mode: 384,
        bytes: OLD_PLUGIN.byteLength,
        sha256: sha256(OLD_PLUGIN),
        payload: { chunks: [{ path: "blobs/0000000002.bin", bytes: OLD_PLUGIN.byteLength, sha256: sha256(OLD_PLUGIN) }], aggregateBytes: OLD_PLUGIN.byteLength, sha256: sha256(OLD_PLUGIN) },
      },
    }],
  } as unknown as (typeof core.owners)[number];
  const evidence = { ...core, owners: [...core.owners, codexInverse], payload: { ...core.payload, entryCount: 4, aggregateBytes: core.payload.aggregateBytes + OLD_PLUGIN.byteLength } };
  const update: CliUpdateContext = { ...fixture.update, readHome: () => Promise.resolve(home), readRollbackEvidence: () => Promise.resolve(evidence) };
  const preview = await planRollback(update);
  const base = await rollbackFixture();
  const world = new Map(base.world);
  const previous = rollback.previous;
  world.set(`${SYNTHETIC_HOME}/state/update-rollback.json`, observed(`${SYNTHETIC_HOME}/state/update-rollback.json`, "regular_file", encoder.encode(encodeCanonicalJson(rollback as never))));
  world.set(`${SYNTHETIC_HOME}/state/active-release.json`, observed(`${SYNTHETIC_HOME}/state/active-release.json`, "regular_file", encoder.encode(encodeCanonicalJson(home.active as never))));
  world.set(previous.bundleRoot, observed(previous.bundleRoot, "directory", null));
  [previous.delegationHash, previous.releaseIndexHash, previous.bundleManifestHash].forEach((hash, ordinal) => world.set(bundleMetadataPath(previous, ordinal), observedHash(bundleMetadataPath(previous, ordinal), hash, 64)));
  const previousRelease = fixture.releases.get("1.0.0");
  if (previousRelease === undefined) throw new Error("the fixture has 1.0.0");
  world.set(`${SYNTHETIC_HOME}/installation-manifest.json`, observed(`${SYNTHETIC_HOME}/installation-manifest.json`, "regular_file", encoder.encode(encodeCanonicalJson(manifest as never))));
  world.set(CODEX_PLUGIN_ROOT, observed(CODEX_PLUGIN_ROOT, "directory", null));
  world.set(CODEX_PLUGIN_FILE, observed(CODEX_PLUGIN_FILE, "regular_file", NEW_PLUGIN));
  world.set(CODEX_REGISTRATION_PATH, observed(CODEX_REGISTRATION_PATH, "regular_file", updated));
  const deps: RollbackComposeDepsV1 = {
    ...base.deps,
    observe: (path) => Promise.resolve(world.get(path) ?? null),
    codexHomes: SYNTHETIC_CODEX_HOMES,
    previousBundle: previousRelease.manifest,
    retained: { owners: evidence.owners, migrations: evidence.migrations, entryCount: evidence.payload.entryCount, aggregateBytes: evidence.payload.aggregateBytes, exactStepListHash: rollbackTemplateHash(evidence) },
  };
  return { input: { coordinatorId: COORDINATOR, home, preview }, world, deps, update };
}

/**
 * NEW-192: the rollback home after an update that changed both core files, replaced the Codex plugin
 * (with its registration refresh) and migrated one Brain note. The retained set is the forward
 * composition's own prepared inverse leaves, so both sides derive their step lists independently.
 */
async function roundTripRollbackFixture(retained: Pick<RollbackComposeDepsV1["retained"], "owners" | "migrations" | "entryCount" | "aggregateBytes">): Promise<RollbackComposed> {
  const base = await codexRollbackFixture();
  const evidence = { payload: { payloadId: base.input.home.rollback?.payloadId as never, entryCount: retained.entryCount, aggregateBytes: retained.aggregateBytes }, owners: retained.owners, migrations: retained.migrations };
  const fixture = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0", codex: { registration: "registered" }, migration: true });
  const preview = await planRollback({ ...fixture.update, readHome: () => Promise.resolve(base.input.home), readRollbackEvidence: () => Promise.resolve(evidence) });
  const world = new Map(base.world);
  world.set(`${BRAIN_ROOT}/${NOTE_PATH}`, observed(`${BRAIN_ROOT}/${NOTE_PATH}`, "regular_file", NEW_NOTE));
  const deps: RollbackComposeDepsV1 = {
    ...base.deps,
    observe: (path) => Promise.resolve(world.get(path) ?? null),
    retained: { ...retained, exactStepListHash: rollbackTemplateHash(retained) },
  };
  return { input: { ...base.input, preview }, world, deps };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed view over one hash-checked plan row
function leafOf<T>(composed: Awaited<ReturnType<typeof composeRollback>>, planKind: string): T {
  const row = composed.construction.files.find((file) => file.role.kind === "immutable_plan" && file.role.planKind === planKind);
  const bytes = row === undefined ? undefined : composed.sources.rowBytes.get(row.ordinal);
  if (bytes === undefined) throw new Error(`no ${planKind} plan row`);
  return decodeCanonicalJson(bytes, bytes.byteLength) as unknown as T;
}

function manifestsOf(composed: Awaited<ReturnType<typeof composeRollback>>): readonly InstallationManifestV2[] {
  return composed.construction.files.flatMap((file) => (file.role.kind === "payload" && file.role.source.kind === "plan_derived" && file.role.source.role === "manifest_after"
    ? [decodeCanonicalJson(encoder.encode(file.role.source.value), 1 << 26) as unknown as InstallationManifestV2]
    : []));
}

describe("composeRollback (Spec 2 §10.2, D72 P9)", () => {
  it("reserves exactly the prefixes it consumes: coordinator, two manifests, one Foundation pair, no payload", async () => {
    const { input } = await rollbackFixture();
    expect(updateRollbackPrefixes(input.preview)).toEqual(["lc", "mf", "mf", "tx", "tx"]);
  });

  it("composes a rollback construction the Core validator admits, with no source envelope and the §10.2 step order", async () => {
    const { input, deps } = await rollbackFixture();
    const composed = await composeRollback(input, deps);
    expect(composed.construction.operation).toBe("update_rollback");
    expect(composed.construction.rollbackSource).toBeNull();
    expect(composed.construction.outputFrames).toEqual([]);
    expect(validateConstructionBijections(composed.construction)).toBe(true);
    const outer = validateUpdateCoordinatorPlan(decodeCanonicalJson(composed.outer.plan, composed.outer.plan.byteLength), SYNTHETIC_HOME);
    expect(outer.steps).toEqual([
      { kind: "bundle", action: "verify_previous" },
      { kind: "rollback_payload", transition: "verify_retained" },
      { kind: "rollback_record", transition: "verify_retained" },
      { kind: "owner_files", owner: "core", direction: "inverse" },
      { kind: "manifest", transition: "preserve_before" },
      { kind: "manifest", transition: "publish_transitional" },
      { kind: "active", transition: "publish_previous" },
      { kind: "target_verifier", release: "previous" },
      { kind: "recovery_executor", transition: "switch_to_fallback" },
      { kind: "terminal_retire", set: "consumed_rollback_and_rejected_release" },
      { kind: "manifest", transition: "publish_terminal" },
      { kind: "manifest", transition: "finalize_tombstones" },
    ]);
    expect(outer.compaction.retainPayloadId).toBeNull();
    expect(composed.sources.bundleSource).toBeNull();
    expect(composed.sources.rollbackSource).toBeNull();
  });

  it("re-derives byte-identical construction and outer bytes from the same under-lock input", async () => {
    const { input, deps } = await rollbackFixture();
    const first = await composeRollback(input, deps);
    const second = await composeRollback(input, deps);
    expect(encoder.encode(JSON.stringify(second.construction))).toEqual(encoder.encode(JSON.stringify(first.construction)));
    expect(second.outer).toEqual(first.outer);
  });

  it("sources every restored owner file from its retained blob (P9(a))", async () => {
    const { input, deps } = await rollbackFixture();
    const composed = await composeRollback(input, deps);
    const retained = composed.construction.files.flatMap((file) => (file.role.kind === "payload" && file.role.source.kind === "retained_rollback_blob" ? [{ payloadKind: file.role.payloadKind, source: file.role.source }] : []));
    expect(retained).toEqual([
      { payloadKind: "owner_content", source: { kind: "retained_rollback_blob", payloadId: input.home.rollback?.payloadId, ordinal: 0, bytes: OLD_A.byteLength, sha256: sha256(OLD_A), mode: 384 } },
      { payloadKind: "owner_content", source: { kind: "retained_rollback_blob", payloadId: input.home.rollback?.payloadId, ordinal: 1, bytes: OLD_B.byteLength, sha256: sha256(OLD_B), mode: 384 } },
    ]);
  });

  it("restores each owner file over the update's postimage through owner_inverse_files refs only (P9(b))", async () => {
    const { input, deps } = await rollbackFixture();
    const owner = leafOf<OwnerUpdatePlanV1>(await composeRollback(input, deps), "owner_update");
    expect(owner.operations.map((operation) => [operation.operation, operation.targetPath])).toEqual([["keep", DIRECTORY_PATH], ["replace", FILE_A_PATH], ["replace", FILE_B_PATH]]);
    expect(owner.operations[1]?.expectedBefore).toMatchObject({ state: "file", hash: sha256(NEW_A) });
    expect(owner.operations[1]?.content?.sha256).toBe(sha256(OLD_A));
    expect(owner.foundation.map((ref) => ref.slot)).toEqual(["owner_inverse_files", "owner_inverse_files"]);
  });

  it("synthesizes restored manifest rows from the retained inverse (P9(c)) and drops only the consumed set at terminal", async () => {
    const { input, deps } = await rollbackFixture();
    const [transitional, terminal] = manifestsOf(await composeRollback(input, deps));
    const restored = transitional?.artifacts.find((row) => row.path === FILE_A_PATH);
    expect(restored).toMatchObject({ owner: "core", productVersion: input.preview.target.version, kind: "file", verification: { mode: "content", installedHash: sha256(OLD_A) } });
    expect(transitional?.productVersion).toBe(input.preview.target.version);
    expect(terminal?.artifacts.filter((row) => !row.path.startsWith(`${input.preview.current.bundleRoot}/`) && row.path !== input.preview.current.bundleRoot)).toEqual(terminal?.artifacts);
  });

  it("verifies the previous bundle in place, the retained payload without publishing, and the record present-to-absent", async () => {
    const { input, deps } = await rollbackFixture();
    const composed = await composeRollback(input, deps);
    const bundle = leafOf<BundlePublicationPlanV1>(composed, "bundle_publication");
    expect(bundle.action).toBe("verify_previous");
    expect(bundle.source).toMatchObject({ kind: "retained_bundle", root: input.preview.target.bundleRoot });
    expect(bundle.metadata.map((row) => row.before.state)).toEqual(["present", "present", "present"]);
    const payload = leafOf<RollbackPayloadStatePlanV1>(composed, "rollback_payload_state");
    expect(payload.publish).toBeNull();
    expect(payload.retireAtTerminal).toEqual([payload.retainedBefore]);
    const record = leafOf<CanonicalStateFilePlanV1>(composed, "rollback_record_state");
    expect(record.before.state).toBe("present");
    expect(record.after).toEqual({ state: "absent" });
    expect(composed.construction.files.some((file) => file.role.kind === "immutable_plan" && file.role.planKind === "release_trust_state")).toBe(false);
  });

  it("publishes the previous release's active record and retires the rejected bundle and consumed payload", async () => {
    const { input, deps } = await rollbackFixture();
    const composed = await composeRollback(input, deps);
    const active = leafOf<CanonicalStateFilePlanV1>(composed, "active_release_state");
    expect(active.after.state).toBe("present");
    const retirement = leafOf<UpdateTerminalRetirementPlanV1>(composed, "terminal_retirement");
    expect(retirement.set).toBe("consumed_rollback_and_rejected_release");
    expect(retirement.entries.map((entry) => entry.kind)).toEqual(["bundle", "metadata", "metadata", "metadata", "rollback_payload"]);
    expect(retirement.entries[0]?.root).toBe(input.preview.current.bundleRoot);
    expect(retirement.entries.some((entry) => entry.root === input.preview.target.bundleRoot)).toBe(false);
  });

  it("returns a projection with zero availability, so only the caller's under-lock observation admits it", async () => {
    const { input, deps } = await rollbackFixture();
    const composed = await composeRollback(input, deps);
    expect(composed.capacity).toMatchObject({ operation: "rollback", availableBytes: "0", availableEntries: "0" });
  });

  /**
   * NEW-168: the update rewrote `codex/registration.json` (P6(d)) outside the retained inverse, so a
   * rollback that restored only the plugin tree kept the update's `treeHash` and left Codex `stale`.
   */
  it("rewrites the Codex registration record from the restored plugin tree", async () => {
    const { input, deps } = await codexRollbackFixture();
    expect(input.preview.owners.find((owner) => owner.owner === "codex")?.paths.replace).toEqual([CODEX_PLUGIN_FILE, CODEX_REGISTRATION_PATH]);
    const composed = await composeRollback(input, deps);
    expect(validateConstructionBijections(composed.construction)).toBe(true);
    const codex = composed.construction.files.flatMap((file) => {
      if (file.role.kind !== "immutable_plan" || file.role.planKind !== "owner_update") return [];
      const bytes = composed.sources.rowBytes.get(file.ordinal);
      const plan = bytes === undefined ? null : (decodeCanonicalJson(bytes, bytes.byteLength) as unknown as OwnerUpdatePlanV1);
      return plan?.owner === "codex" ? [plan] : [];
    })[0];
    const restored = sha256(codexRegistrationBytes(OLD_PLUGIN));
    expect(Object.fromEntries(codex?.operations.map((operation) => [operation.targetPath, operation.operation]) ?? [])).toEqual({
      [CODEX_PLUGIN_ROOT]: "keep",
      [CODEX_PLUGIN_FILE]: "replace",
      [CODEX_REGISTRATION_PATH]: "replace",
    });
    const registration = codex?.operations.find((operation) => operation.targetPath === CODEX_REGISTRATION_PATH);
    expect(registration?.content?.sha256).toBe(restored);
    expect(registration?.afterArtifact?.verification).toMatchObject({ mode: "schema", installedHash: restored });
    const [transitional] = manifestsOf(composed);
    expect(transitional?.artifacts.find((row) => row.path === CODEX_REGISTRATION_PATH)?.verification).toMatchObject({ installedHash: restored });
  });

  it("refuses an owner file edited after the preview, before any row is derived", async () => {
    const { input, deps, world } = await rollbackFixture();
    world.set(FILE_A_PATH, observed(FILE_A_PATH, "regular_file", encoder.encode("edited\n")));
    expect(await refusal(composeRollback(input, deps))).toMatchObject({ reason: "update_state_changed", code: EXIT_CODES.operationalFailure });
  });

  it.each([
    ["a mutated", () => sha256("synthetic rollback step list")],
    ["a reordered", (retained: RollbackComposeDepsV1["retained"]) => rollbackTemplateHash(retained, true)],
  ] as const)("refuses %s retained exactStepListHash before construction (NEW-172, Spec 2 §10.2)", async (_label, hash) => {
    const { input, deps } = await rollbackFixture();
    const retained = { ...deps.retained, exactStepListHash: hash(deps.retained) };
    expect(await refusal(composeRollback(input, { ...deps, retained }))).toMatchObject({ reason: "update_rollback_evidence_invalid", code: EXIT_CODES.recoveryRequired });
  });

  it("accepts the exactStepListHash a real composeUpdate retained, derived on its own side (NEW-172)", async () => {
    const forward = await composeFixture();
    const applied = await composeUpdate(forward.input, forward.deps);
    const inversePlan = applied.sources.documents?.inversePlan;
    if (inversePlan === undefined) throw new Error("composeUpdate retains an inverse plan");
    const retained = decodeCanonicalJson(inversePlan, inversePlan.byteLength) as unknown as { readonly exactStepListHash: LowerHexSha256; readonly ownerPlans: readonly { readonly id: string }[]; readonly migrationPlans: readonly unknown[] };
    const { input, deps } = await rollbackFixture();
    // The same leaf set on both sides: one core owner, no effect, no migration.
    expect(retained.ownerPlans.map((plan) => plan.id)).toEqual(deps.retained.owners.map((owner) => owner.id));
    expect(retained.migrationPlans).toEqual(deps.retained.migrations);

    const composed = await composeRollback(input, { ...deps, retained: { ...deps.retained, exactStepListHash: retained.exactStepListHash } });
    expect(composed.construction.operation).toBe("update_rollback");
  });

  it("round-trips a real composeUpdate exactStepListHash across two owners, a Codex effect and a Brain migration (NEW-192)", async () => {
    const forward = await composeFixture({ codex: true, migration: true });
    const applied = await composeUpdate(forward.input, forward.deps);
    const documents = applied.sources.documents;
    if (documents === null) throw new Error("composeUpdate retains an inverse plan and inventory");
    const retainedPlan = decodeCanonicalJson(documents.inversePlan, documents.inversePlan.byteLength) as unknown as { readonly exactStepListHash: LowerHexSha256 };
    const inventory = decodeCanonicalJson(documents.inventory, documents.inventory.byteLength) as unknown as { readonly entries: readonly unknown[]; readonly aggregateBytes: number };
    const leaves = forward.input.materialized.candidate.materialization.inversePlanProjections.map((leaf) => decodeRetainedInverseLeaf(leaf.kind, encoder.encode(leaf.projection.endsWith("\n") ? leaf.projection : `${leaf.projection}\n`)));
    const owners = leaves.flatMap((leaf) => (leaf.kind === "owner_inverse" ? [leaf] : []));
    const migrations = leaves.flatMap((leaf) => (leaf.kind === "schema_migration_inverse" ? [leaf] : []));
    // Every owner, effect kind and migration domain the step template distinguishes is present.
    expect(owners.map((owner) => [owner.owner, owner.externalEffects.length])).toEqual([["core", 0], ["codex", 1]]);
    expect(migrations.map((migration) => [migration.id, migration.domain])).toEqual([["migration_notes-v2", "brain"]]);

    const { input, deps } = await roundTripRollbackFixture({ owners, migrations, entryCount: inventory.entries.length, aggregateBytes: inventory.aggregateBytes });
    // The rollback side derives its own hash from the same leaves; it must equal what composeUpdate retained.
    expect(deps.retained.exactStepListHash).toBe(retainedPlan.exactStepListHash);
    const composed = await composeRollback(input, { ...deps, retained: { ...deps.retained, exactStepListHash: retainedPlan.exactStepListHash } });
    expect(composed.construction.operation).toBe("update_rollback");
    const outer = validateUpdateCoordinatorPlan(decodeCanonicalJson(composed.outer.plan, composed.outer.plan.byteLength), SYNTHETIC_HOME);
    expect(rollbackStepListHash(outer.steps)).toBe(retainedPlan.exactStepListHash);
    expect(outer.steps.map((step) => step.kind)).toEqual(expect.arrayContaining(["owner_external_effect", "schema_migration"]));
  });

  it("refuses a retained record that changed since the preview", async () => {
    const { input, deps, world } = await rollbackFixture();
    const at = `${SYNTHETIC_HOME}/state/update-rollback.json`;
    world.set(at, observed(at, "regular_file", encoder.encode("{}\n")));
    expect(await refusal(composeRollback(input, deps))).toMatchObject({ reason: "update_state_changed", code: EXIT_CODES.operationalFailure });
  });

  it("refuses a previous bundle metadata file that no longer matches its signed hash", async () => {
    const { input, deps, world } = await rollbackFixture();
    const at = bundleMetadataPath(input.preview.target, 2);
    world.set(at, observedHash(at, sha256("other"), 64));
    expect(await refusal(composeRollback(input, deps))).toMatchObject({ reason: "update_rollback_evidence_invalid", code: EXIT_CODES.recoveryRequired });
  });

  it("refuses a restore whose retained preimage has no blob", async () => {
    const { input, deps } = await rollbackFixture();
    const [owner] = deps.retained.owners;
    if (owner === undefined) throw new Error("the fixture retains one owner");
    const blobless = { ...owner, operations: owner.operations.map((operation) => (operation.restore.state === "file" ? { ...operation, restore: { ...operation.restore, payload: null } } : operation)) };
    expect(await refusal(composeRollback(input, { ...deps, retained: { ...deps.retained, owners: [blobless] } }))).toMatchObject({ reason: "update_rollback_restore_unavailable", code: EXIT_CODES.capabilityUnavailable });
  });
});

/**
 * NEW-190 (option B; the e2e case moves to Task 11b/A16): `update rollback --apply` end to end at the
 * `applyRollback` boundary. The real `composeRollback` derives the construction; synthetic ports run
 * the real coordinator over its outer plan and apply each owner plan's operations to an in-memory
 * tree from the construction's own payload rows. Codex then reads `registered` through a fake runner.
 */
describe("applyRollback restores a registered Codex registration (NEW-190)", () => {
  it("rewrites the exact registration record for the restored plugin tree, and Codex reads it as registered", async () => {
    const { input, deps, update } = await codexRollbackFixture();
    const files = new Map<string, Uint8Array>([
      [CODEX_PLUGIN_FILE, NEW_PLUGIN],
      [CODEX_REGISTRATION_PATH, codexRegistrationBytes(NEW_PLUGIN)],
    ]);
    let composition: Awaited<ReturnType<typeof composeRollback>> | null = null;
    let stored: { plan: UpdateLifecycleCoordinatorPlanV2; journal: UpdateLifecycleCoordinatorJournalV2 } | null = null;
    let locked = false;

    const ownerPlan = (owner: string): OwnerUpdatePlanV1 => {
      const plans = (composition?.construction.files ?? []).flatMap((file) => {
        if (file.role.kind !== "immutable_plan" || file.role.planKind !== "owner_update") return [];
        const bytes = composition?.sources.rowBytes.get(file.ordinal);
        return bytes === undefined ? [] : [decodeCanonicalJson(bytes, bytes.byteLength) as unknown as OwnerUpdatePlanV1];
      });
      const found = plans.find((plan) => plan.owner === owner);
      if (found === undefined) throw new Error(`no ${owner} owner plan`);
      return found;
    };
    /** A payload's bytes: plan-derived rows carry them; a retained blob is the preimage the payload kept. */
    const payloadBytes = (path: string, sha: LowerHexSha256): Uint8Array => {
      const row = composition?.construction.files.find((file) => file.path === path);
      const derived = row?.role.kind === "payload" && row.role.source.kind === "plan_derived" ? encoder.encode(row.role.source.value) : null;
      const bytes = derived ?? [OLD_A, OLD_B, OLD_PLUGIN].find((candidate) => sha256(candidate) === sha);
      if (bytes === undefined || sha256(bytes) !== sha) throw new Error(`no payload bytes for ${path}`);
      return bytes;
    };

    const ports: UpdateApplyPortsV1 = {
      withGlobalLock: async (work) => {
        locked = true;
        try {
          return await work();
        } finally {
          locked = false;
        }
      },
      closure: () => Promise.resolve(stored === null ? { kind: "clear" } : { kind: "update_recovery", coordinatorId: COORDINATOR, operation: "update_rollback", direction: stored.journal.direction }),
      allocate: () => Promise.resolve(COORDINATOR),
      compose: () => Promise.reject(new Error("rollback reached the update derivation")),
      composeRollback: async (composeInput) => {
        composition = await composeRollback(composeInput, deps);
        return composition;
      },
      construction: () => ({
        publish: () => Promise.resolve({} as never),
        stageDirectories: () => Promise.resolve(),
        stageFiles: async (_plan, frames) => {
          for await (const frame of frames) void frame;
        },
        publishOuter: (_plan, outer) => {
          stored = {
            plan: validateUpdateCoordinatorPlan(decodeCanonicalJson(outer.plan, outer.plan.byteLength), SYNTHETIC_HOME),
            journal: decodeCanonicalJson(outer.journal, outer.journal.byteLength) as unknown as UpdateLifecycleCoordinatorJournalV2,
          };
          return Promise.resolve();
        },
        recover: () => Promise.resolve(),
      }),
      coordinator: () => ({
        store: {
          read: () => (stored === null ? Promise.reject(new Error("no coordinator")) : Promise.resolve(stored)),
          rewrite: (plan, _current, next) => {
            stored = { plan, journal: next };
            return Promise.resolve();
          },
          removeEnvelope: () => {
            stored = null;
            return Promise.resolve();
          },
          removeRewriteTemps: () => Promise.resolve(),
        },
        participants: {
          apply: (step) => {
            if (step.kind === "owner_files") {
              for (const operation of ownerPlan(step.owner).operations) {
                if (operation.operation === "replace" && operation.content !== null) files.set(operation.targetPath, payloadBytes(operation.content.path, operation.content.sha256));
              }
            }
            return Promise.resolve(step.kind === "target_verifier" ? { state: "verified" as const } : { state: "applied" as const });
          },
          observe: () => Promise.resolve({ state: "applied" }),
          compensate: () => Promise.resolve({ state: "compensated" }),
          compact: () => Promise.resolve(),
          retirementLeaves: () => Promise.resolve(1),
          retireLeaf: () => Promise.resolve(),
        },
        executor: { publishInitial: () => Promise.resolve(), switchToFallback: () => Promise.resolve(), removeRecord: () => Promise.resolve() },
        verifyPlan: () => Promise.resolve(),
        requireLock: () => (locked ? Promise.resolve() : Promise.reject(new Error("lock not held"))),
        clock: () => PLANNED_AT,
      }),
      envelope: { isEnvelopeSuffix: () => Promise.resolve(false), completeEnvelopeSuffix: () => Promise.reject(new Error("unreachable")) },
      executorCleanup: () => Promise.resolve(),
    };

    const result = await applyRollback({ ...update, apply: ports }, input.preview);
    expect(result).toMatchObject({ outcome: "rolled_back", rollbackAvailable: false, active: { version: "1.0.0" } });
    expect(files.get(CODEX_PLUGIN_FILE)).toEqual(OLD_PLUGIN);
    const registration = files.get(CODEX_REGISTRATION_PATH);
    // The exact bytes `init` wrote for the 1.0.0 tree, not the update's stale record.
    expect(registration).toEqual(codexRegistrationBytes(OLD_PLUGIN));

    const runner: ProcessRunner = {
      run: (request) => Promise.resolve({
        stdout: request.args.join(" ") === "plugin list --json" ? JSON.stringify({ installed: [{ name: PLUGIN_NAME, enabled: true, source: { path: CODEX_PLUGIN_ROOT } }] }) : "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
    };
    const state = await inspectCodexRegistration({
      runner,
      codexExecutable: "/synthetic/opt/codex/bin/codex",
      codexHome: SYNTHETIC_CODEX_HOMES.codexHome,
      pluginRoot: CODEX_PLUGIN_ROOT,
      record: validateCodexRegistrationRecord(registration ?? new Uint8Array()),
      treeHash: codexPluginTreeHash([{ path: "plugin.json", sha256: sha256(files.get(CODEX_PLUGIN_FILE) ?? new Uint8Array()) }]),
    });
    expect(state).toBe("registered");
  });
});
