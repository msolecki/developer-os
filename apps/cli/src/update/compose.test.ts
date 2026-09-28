import {
  decodeCanonicalJson,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseUInt64Decimal,
  validateConstructionBijections,
  validateUpdateCoordinatorPlan,
  type CanonicalStateFilePlanV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedEntryV1,
  type LowerHexSha256,
  type UpdateFallbackHandoffV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import type { UpdateApplyComposeInputV1 } from "./apply.js";
import { composeUpdate, updateApplyPrefixes, type ComposeDepsV1, type ObservedPathV1 } from "./compose.js";
import { prepareUpdate, UpdatePlanningRefusal } from "./planning.js";
import { createUpdateFixture, DIRECTORY_PATH, FILE_A_PATH, FILE_B_PATH, OLD_A, OLD_B, sha256, SYNTHETIC_EVIDENCE, SYNTHETIC_HOME } from "./testing.js";

const UID = 501;
const COORDINATOR = `lc_${"a".repeat(64)}_10` as LifecycleCoordinatorIdV1;
const STAGING_ROOT = `${SYNTHETIC_HOME}/staging/lifecycle/${COORDINATOR}`;
const FALLBACK: UpdateFallbackHandoffV1 = { bundleManifestHash: sha256("fallback manifest"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };
const encoder = new TextEncoder();

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
async function composeFixture(options: { readonly fallback?: UpdateFallbackHandoffV1 } = {}): Promise<Composed> {
  const fixture = createUpdateFixture();
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
  ]);
  const deps: ComposeDepsV1 = {
    productHome: SYNTHETIC_HOME,
    effectiveUid: UID,
    evidence: SYNTHETIC_EVIDENCE,
    fallback: options.fallback ?? FALLBACK,
    brainRoot: parseCanonicalAbsolutePathText("/synthetic/user/brain"),
    observe: (path) => Promise.resolve(world.get(path) ?? null),
    admitManifest: (value) => value as never,
    codexHomes: null,
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
