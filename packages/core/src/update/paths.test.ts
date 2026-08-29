import { describe, expect, it } from "vitest";

import {
  admitCanonicalAbsolutePath,
  admitOwnerRelativePath,
  admitRollbackPayloadRelativePath,
  admitVaultFreeRelativePath,
  deriveBootstrapPayloadPath,
  deriveCanonicalStatePayloadPath,
  deriveExactProductStatePath,
  deriveFoundationInitialJournalPayloadPath,
  deriveManifestPayloadPath,
  deriveUpdatePayloadPath,
  deriveUpdateRecoveryExecutorStagedPath,
  type CanonicalPathEvidenceV1,
} from "./paths.js";
import { parseSafeReasonCode } from "./scalars.js";

const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

const productHome = admitCanonicalAbsolutePath("/synthetic/product", evidence);
const backupRoot = admitCanonicalAbsolutePath("/synthetic/backup", evidence);

describe("strict update paths", () => {
  it("catches an absolute-path admission that accepts a noncanonical, control, or oversized spelling", () => {
    expect(admitCanonicalAbsolutePath("/synthetic/product/state", evidence)).toBe("/synthetic/product/state");
    expect(() => admitCanonicalAbsolutePath("/synthetic/e\u0301", evidence)).toThrow();
    expect(() => admitCanonicalAbsolutePath("/synthetic/\u0001", evidence)).toThrow();
    expect(() => admitCanonicalAbsolutePath(`/${"a".repeat(4096)}`, evidence)).toThrow();
  });

  it.each([".", "..", "/a", "a//b", "a\\b", "a\u0001", "a\u0085", "a\u200e", "e\u0301"])(
    "catches a relative-path admission that accepts a traversal, separator, control, format, or non-NFC alias %s",
    (value) => {
      expect(() => admitVaultFreeRelativePath(value, backupRoot, evidence)).toThrow();
    },
  );

  it("catches an aggregate/component bound checker that loses either boundary", () => {
    expect(admitVaultFreeRelativePath("a".repeat(255), backupRoot, evidence)).toBe("a".repeat(255));
    expect(() => admitVaultFreeRelativePath("a".repeat(256), backupRoot, evidence)).toThrow();
    const components128 = Array.from({ length: 128 }, () => "a").join("/");
    const components129 = Array.from({ length: 129 }, () => "a").join("/");
    expect(admitVaultFreeRelativePath(components128, backupRoot, evidence)).toBe(components128);
    expect(() => admitVaultFreeRelativePath(components129, backupRoot, evidence)).toThrow();
    const bytes4096 = [...Array.from({ length: 15 }, () => "a".repeat(255)), "a".repeat(254), "a"].join("/");
    const bytes4097 = [...Array.from({ length: 16 }, () => "a".repeat(255)), "a"].join("/");
    expect(admitVaultFreeRelativePath(bytes4096, backupRoot, evidence)).toBe(bytes4096);
    expect(() => admitVaultFreeRelativePath(bytes4097, backupRoot, evidence)).toThrow();
  });

  it("catches a containment check that trusts a relative spelling without reopened root evidence", () => {
    const refusingEvidence: CanonicalPathEvidenceV1 = { ...evidence, containsCanonicalPath: () => false };
    expect(() => admitOwnerRelativePath("safe.json", backupRoot, refusingEvidence)).toThrow();
  });

  it("catches an admission that treats a folded sibling as a distinct path", () => {
    const aliasEvidence: CanonicalPathEvidenceV1 = { ...evidence, hasFoldedAlias: () => true };
    expect(() => admitOwnerRelativePath("safe.json", backupRoot, aliasEvidence)).toThrow();
  });

  it("catches a rollback-path constructor that accepts a non-role-derived path", () => {
    expect(admitRollbackPayloadRelativePath("blobs/0000000000.bin", backupRoot, evidence)).toBe("blobs/0000000000.bin");
    expect(admitRollbackPayloadRelativePath("plans/owner_inverse/owner_1.plan.json", backupRoot, evidence)).toBe(
      "plans/owner_inverse/owner_1.plan.json",
    );
    expect(admitRollbackPayloadRelativePath("plans/schema_migration_inverse/migration_schema-v2.plan.json", backupRoot, evidence)).toBe(
      "plans/schema_migration_inverse/migration_schema-v2.plan.json",
    );
    expect(() => admitRollbackPayloadRelativePath("blobs/0.bin", backupRoot, evidence)).toThrow();
    expect(() => admitRollbackPayloadRelativePath("plans/owner/not-a-plan.txt", backupRoot, evidence)).toThrow();
    expect(() => admitRollbackPayloadRelativePath("plans/owner_inverse/migration_schema-v2.plan.json", backupRoot, evidence)).toThrow();
    expect(() => admitRollbackPayloadRelativePath("plans/schema_migration_inverse/owner_1.plan.json", backupRoot, evidence)).toThrow();
    expect(() => admitRollbackPayloadRelativePath("plans/unknown/owner_1.plan.json", backupRoot, evidence)).toThrow();
  });

  it.each([
    ["lifecycle_plan", "/synthetic/product/state/lifecycle-journals/run_1.plan.json"],
    ["lifecycle_journal", "/synthetic/product/state/lifecycle-journals/run_1.json"],
  ] as const)("derives the exact product-state role path %s", (role, expected) => {
    expect(deriveExactProductStatePath(productHome, role, parseSafeReasonCode("run_1"))).toBe(expected);
  });

  it("derives every bootstrap, manifest, update, state, and recovery payload under its closed role", () => {
    const run = parseSafeReasonCode("run_1");
    expect(deriveBootstrapPayloadPath(productHome, "fresh_v2_init", run, 0)).toBe(
      "/synthetic/product/state/.fresh-v2-init.run_1.0000000000.payload",
    );
    expect(deriveBootstrapPayloadPath(productHome, "v1_to_v2", run, 999_999)).toBe(
      "/synthetic/product/state/.manifest-migration.run_1.0000999999.payload",
    );
    expect(() => deriveBootstrapPayloadPath(productHome, "manifest_migration" as never, run, 0)).toThrow();
    expect(deriveManifestPayloadPath(productHome, run, parseSafeReasonCode("manifest_1"))).toBe(
      "/synthetic/product/staging/lifecycle/run_1/participants/manifest/manifest_1/after.json",
    );
    for (const role of ["release_metadata", "release_trust", "active_release", "rollback_record"] as const) {
      expect(deriveCanonicalStatePayloadPath(productHome, run, role as never, run)).toBe(
        `/synthetic/product/staging/lifecycle/run_1/update/payloads/state/${role}/run_1.json`,
      );
    }
    expect(() => deriveCanonicalStatePayloadPath(productHome, run, "unknown" as never, run)).toThrow();
    expect(deriveFoundationInitialJournalPayloadPath(productHome, run, parseSafeReasonCode("tx_1"))).toBe(
      "/synthetic/product/staging/lifecycle/run_1/participants/foundation/tx_1/initial-journal.json",
    );
    expect(deriveUpdatePayloadPath(productHome, run, 1_099_999)).toBe(
      "/synthetic/product/staging/lifecycle/run_1/update/payloads/0001099999.payload",
    );
    expect(deriveUpdateRecoveryExecutorStagedPath(productHome, run)).toBe(
      "/synthetic/product/staging/lifecycle/run_1/update/recovery-executor.json",
    );
    expect(() => deriveBootstrapPayloadPath(productHome, "fresh_v2_init", run, 1_000_000)).toThrow();
  });
});
