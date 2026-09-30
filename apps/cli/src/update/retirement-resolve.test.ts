import { createHash } from "node:crypto";

import {
  encodeCanonicalJson,
  flattenUpdateRetirementLeaves,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseStableSemver,
  parseUtcTimestamp,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type InstallationManifestV2,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type RetirementInventoryRefV1,
  type RetirementLeafV1,
  type UpdateRetirementSetV1,
  type UpdateTerminalRetirementPlanV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { retirementResolvePort } from "./retirement-resolve.js";

const sha = (value: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const path = parseCanonicalAbsolutePathText;
const home = path("/synthetic/home/.developer-os");
const at = (relative: string): CanonicalAbsolutePathV1 => path(`${home}/${relative}`);
const INSTALLED_AT = parseUtcTimestamp("2026-01-01T00:00:00.000Z");
const common = { owner: "core", productVersion: "1.0.0", existedBefore: false, beforeHash: null, backupRelativePath: null, mergeStrategy: "dedicated", verifiedAt: INSTALLED_AT, source: "generated/update" } as const;

const directory = (relative: string): ManagedArtifactV2 => ({ ...common, path: at(relative), kind: "directory", verification: { mode: "content" } }) as unknown as ManagedArtifactV2;
const file = (relative: string, hash: LowerHexSha256 = sha(relative)): ManagedArtifactV2 => ({ ...common, path: at(relative), kind: "file", verification: { mode: "content", installedHash: hash } }) as unknown as ManagedArtifactV2;
const ephemeral = (relative: string): ManagedArtifactV2 => ({ ...common, path: at(relative), kind: "file", verification: { mode: "ephemeral" } }) as unknown as ManagedArtifactV2;

const old = { bundle: "releases/0.1.0/darwin-arm64", delegation: sha("old delegation"), index: sha("old index"), manifest: sha("old bundle manifest"), payload: `rollback/rb_${"c".repeat(64)}_9`, inventory: sha("old inventory") };
const target = { bundle: "releases/0.2.0/darwin-arm64", delegation: sha("target delegation"), index: sha("target index"), manifest: sha("target bundle manifest") };
const recordHash = sha("rollback record");

const metadataRoots = [`state/release-metadata/bundles/${old.manifest}.json`, `state/release-metadata/delegations/${old.delegation}.json`, `state/release-metadata/indexes/${old.index}.json`];

/** A transitional manifest holding the target release and one retained older rollback generation. */
function transitionalManifest(extra: readonly ManagedArtifactV2[] = []): InstallationManifestV2 {
  return {
    schemaVersion: 2,
    productVersion: parseStableSemver("0.2.0"),
    installedAt: INSTALLED_AT,
    artifacts: [
      directory("releases"),
      directory("releases/0.1.0"),
      directory(old.bundle),
      directory(`${old.bundle}/bin`),
      file(`${old.bundle}/bin/tool`),
      file(`${old.bundle}/bin-extra`),
      directory(`${old.bundle}/lib`),
      file(`${old.bundle}/lib/a.js`),
      file(`${old.bundle}/lib/b.js`),
      directory("releases/0.2.0"),
      directory(target.bundle),
      file(`${target.bundle}/tool`),
      directory("state/release-metadata"),
      directory("state/release-metadata/bundles"),
      directory("state/release-metadata/delegations"),
      directory("state/release-metadata/indexes"),
      file(`state/release-metadata/bundles/${old.manifest}.json`, old.manifest),
      file(`state/release-metadata/bundles/${target.manifest}.json`, target.manifest),
      file(`state/release-metadata/delegations/${old.delegation}.json`, old.delegation),
      file(`state/release-metadata/delegations/${target.delegation}.json`, target.delegation),
      file(`state/release-metadata/indexes/${old.index}.json`, old.index),
      file(`state/release-metadata/indexes/${target.index}.json`, target.index),
      ephemeral("state/update-rollback.json"),
      directory("rollback"),
      directory(old.payload),
      directory(`${old.payload}/blobs`),
      file(`${old.payload}/blobs/0000000000.bin`),
      file(`${old.payload}/inventory.json`, old.inventory),
      file(`${old.payload}/inverse-plan.json`),
      directory(`${old.payload}/plans`),
      directory(`${old.payload}/plans/owner_inverse`),
      file(`${old.payload}/plans/owner_inverse/owner_core.plan.json`),
      directory(`${old.payload}/plans/schema_migration_inverse`),
      ...extra,
    ],
  } as unknown as InstallationManifestV2;
}

const manifestHash = (manifest: InstallationManifestV2): LowerHexSha256 => sha(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));

function ref(kind: RetirementInventoryRefV1["kind"], relative: string, inventoryHash: LowerHexSha256, leafCount: number): RetirementInventoryRefV1 {
  return { kind, root: at(relative), inventoryHash, leafCount };
}

const bundleRef = ref("bundle", old.bundle, old.manifest, 7);
const metadataRefs = [ref("metadata", metadataRoots[0] as string, old.manifest, 1), ref("metadata", metadataRoots[1] as string, old.delegation, 1), ref("metadata", metadataRoots[2] as string, old.index, 1)];
const payloadRef = ref("rollback_payload", old.payload, old.inventory, 9);
const recordRef = ref("rollback_record", "state/update-rollback.json", recordHash, 1);

function plan(set: UpdateRetirementSetV1, entries: readonly RetirementInventoryRefV1[], manifest: InstallationManifestV2 = transitionalManifest()): UpdateTerminalRetirementPlanV1 {
  return {
    schemaVersion: 1,
    id: parseSafeReasonCode("terminal_retirement"),
    coordinatorId: `lc_${"b".repeat(64)}_3` as LifecycleCoordinatorIdV1,
    set,
    transitionalManifestHash: manifestHash(manifest),
    entries,
    maximumLeaves: entries.reduce((sum, entry) => sum + entry.leafCount, 0),
    maximumPlanBytes: 65_536,
  };
}

const relative = (leaves: readonly RetirementLeafV1[]): readonly string[] => leaves.map((leaf) => leaf.path.slice(home.length + 1));

async function resolveAll(retirement: UpdateTerminalRetirementPlanV1, manifest: InstallationManifestV2 = transitionalManifest()): Promise<readonly RetirementLeafV1[]> {
  const resolve = retirementResolvePort(home, manifest);
  const inventories: (readonly RetirementLeafV1[])[] = [];
  for (const entry of retirement.entries) inventories.push(await resolve(entry, retirement));
  return flattenUpdateRetirementLeaves(retirement, inventories);
}

describe("retirementResolvePort", () => {
  it("resolves a bundle's leaves in UTF-8 path order with every directory after its children", async () => {
    const leaves = await retirementResolvePort(home, transitionalManifest())(bundleRef, plan("prior_rollback", [bundleRef]));
    expect(relative(leaves)).toStrictEqual([`${old.bundle}/bin/tool`, `${old.bundle}/bin`, `${old.bundle}/bin-extra`, `${old.bundle}/lib/a.js`, `${old.bundle}/lib/b.js`, `${old.bundle}/lib`, old.bundle]);
    expect(leaves[0]).toStrictEqual({ path: at(`${old.bundle}/bin/tool`), kind: "file", bytes: null, sha256: sha(`${old.bundle}/bin/tool`) });
    expect(leaves.at(-1)).toStrictEqual({ path: at(old.bundle), kind: "directory", bytes: null, sha256: null });
  });

  it("resolves a payload's whole manifest partition and a metadata file by its content hash", async () => {
    const resolve = retirementResolvePort(home, transitionalManifest());
    const retirement = plan("prior_rollback", [payloadRef]);
    expect(relative(await resolve(payloadRef, retirement))).toStrictEqual([
      `${old.payload}/blobs/0000000000.bin`,
      `${old.payload}/blobs`,
      `${old.payload}/inventory.json`,
      `${old.payload}/inverse-plan.json`,
      `${old.payload}/plans/owner_inverse/owner_core.plan.json`,
      `${old.payload}/plans/owner_inverse`,
      `${old.payload}/plans/schema_migration_inverse`,
      `${old.payload}/plans`,
      old.payload,
    ]);
    expect(await resolve(metadataRefs[1] as RetirementInventoryRefV1, retirement)).toStrictEqual([{ path: at(metadataRoots[1] as string), kind: "file", bytes: null, sha256: old.delegation }]);
  });

  it("resolves the rollback record reservation to the recorded document hash", async () => {
    expect(await retirementResolvePort(home, transitionalManifest())(recordRef, plan("consumed_rollback_and_rejected_release", [recordRef]))).toStrictEqual([{ path: at("state/update-rollback.json"), kind: "file", bytes: null, sha256: recordHash }]);
  });

  it("resolves both retirement sets through the same port", async () => {
    const prior = await resolveAll(plan("prior_rollback", [bundleRef, ...metadataRefs, payloadRef]));
    expect(prior).toHaveLength(7 + 3 + 9);
    const consumed = await resolveAll(plan("consumed_rollback_and_rejected_release", [bundleRef, ...metadataRefs, payloadRef, recordRef]));
    expect(consumed).toHaveLength(7 + 3 + 9 + 1);
    expect(relative(consumed).some((leaf) => leaf.startsWith(target.bundle) || leaf.includes(target.manifest))).toBe(false);
  });

  it("refuses a root outside the transitional manifest", async () => {
    const missing = ref("bundle", "releases/0.0.9/darwin-arm64", old.manifest, 1);
    await expect(retirementResolvePort(home, transitionalManifest())(missing, plan("prior_rollback", [missing]))).rejects.toThrow(LifecycleRecoveryRequiredError);
    const absentMetadata = ref("metadata", `state/release-metadata/indexes/${sha("absent")}.json`, sha("absent"), 1);
    await expect(retirementResolvePort(home, transitionalManifest())(absentMetadata, plan("prior_rollback", [absentMetadata]))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses a plan bound to a different transitional manifest", async () => {
    const other = plan("prior_rollback", [bundleRef], transitionalManifest([file("state/other.json")]));
    await expect(retirementResolvePort(home, transitionalManifest())(bundleRef, other)).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses an inventory hash the transitional manifest does not carry", async () => {
    const resolve = retirementResolvePort(home, transitionalManifest());
    const cases = [
      { ...bundleRef, inventoryHash: sha("unknown bundle manifest") },
      { ...payloadRef, inventoryHash: sha("unknown inventory") },
      { ...metadataRefs[0] as RetirementInventoryRefV1, inventoryHash: old.delegation },
    ];
    for (const entry of cases) await expect(resolve(entry, plan("prior_rollback", [entry]))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses a root in the wrong product location for its kind", async () => {
    const resolve = retirementResolvePort(home, transitionalManifest());
    const cases = [
      ref("bundle", old.payload, old.manifest, 9),
      ref("rollback_payload", old.bundle, old.inventory, 7),
      ref("rollback_record", `state/release-metadata/indexes/${old.index}.json`, recordHash, 1),
      ref("metadata", `${old.payload}/inventory.json`, old.inventory, 1),
    ];
    for (const entry of cases) await expect(resolve(entry, plan("prior_rollback", [entry]))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses an artifact retirement cannot remove as a leaf", async () => {
    const link = { ...common, path: at(`${old.bundle}/bin/link`), kind: "symlink", verification: { mode: "content", installedHash: sha("link") } } as unknown as ManagedArtifactV2;
    const manifest = transitionalManifest([link]);
    const entry = { ...bundleRef, leafCount: 8 };
    await expect(retirementResolvePort(home, manifest)(entry, plan("prior_rollback", [entry], manifest))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });
});
