import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { MAXIMUM_LEAF_PLAN_BYTES, updateLeafPlanPath } from "./construction.js";
import { MAXIMUM_UPDATE_RETIREMENT_LEAVES } from "./coordinator.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "./paths.js";
import {
  MAXIMUM_RETIREMENT_INVENTORY_LEAVES,
  flattenUpdateRetirementLeaves,
  updateTerminalRetirementPlanBytes,
  updateTerminalRetirementPlanHash,
  updateTerminalRetirementPlanRef,
  validateUpdateTerminalRetirementPlan,
  type RetirementLeafV1,
  type UpdateRetirementSetV1,
  type UpdateTerminalRetirementPlanV1,
} from "./retirement.js";
import type { RetirementInventoryRefV1 } from "./rollback.js";
import { parseSafeReasonCode, type LowerHexSha256 } from "./scalars.js";

const sha = (text: string): LowerHexSha256 => createHash("sha256").update(text).digest("hex") as LowerHexSha256;
const path = parseCanonicalAbsolutePathText;
const coordinatorId = `lc_${"b".repeat(64)}_3` as LifecycleCoordinatorIdV1;
const home = path("/synthetic/home/.developer-os");
const stagingRoot = path(`${home}/staging/lifecycle/${coordinatorId}`);
const bundleRoot = path(`${home}/releases/0.2.0-arm64`);
const payloadRoot = path(`${home}/rollback/rb_${"c".repeat(64)}_9`);

function ref(kind: RetirementInventoryRefV1["kind"], root: CanonicalAbsolutePathV1, leafCount: number): RetirementInventoryRefV1 {
  return { kind, root, inventoryHash: sha(`${kind}:${root}`), leafCount };
}

function plan(overrides: Partial<Record<keyof UpdateTerminalRetirementPlanV1, unknown>> = {}): Record<string, unknown> {
  const entries = (overrides.entries ?? [ref("rollback_payload", payloadRoot, 3)]) as readonly RetirementInventoryRefV1[];
  return {
    schemaVersion: 1,
    id: "terminal_retirement",
    coordinatorId,
    set: "prior_rollback",
    transitionalManifestHash: sha("transitional"),
    entries,
    maximumLeaves: entries.reduce((sum, entry) => sum + entry.leafCount, 0),
    maximumPlanBytes: 65_536,
    ...overrides,
  };
}

const validate = (value: unknown): UpdateTerminalRetirementPlanV1 => validateUpdateTerminalRetirementPlan(value, stagingRoot);

function file(root: string, name: string): RetirementLeafV1 {
  return { path: path(`${root}/${name}`), kind: "file", bytes: name.length, sha256: sha(name) };
}

function directory(at: string): RetirementLeafV1 {
  return { path: path(at), kind: "directory", bytes: null, sha256: null };
}

describe("UpdateTerminalRetirementPlanV1 codec", () => {
  it("round-trips exact keys and hashes its canonical bytes under the terminal_retirement leaf domain", () => {
    const parsed = validate(plan());
    const bytes = updateTerminalRetirementPlanBytes(parsed);
    expect(new TextDecoder().decode(bytes)).toBe(encodeCanonicalJson(plan() as CanonicalJsonValue));
    const expected = createHash("sha256").update("developer-os/update-leaf/terminal_retirement/v1\0", "ascii").update(bytes).digest("hex");
    expect(updateTerminalRetirementPlanHash(parsed)).toBe(expected);
    expect(updateTerminalRetirementPlanRef(parsed, stagingRoot)).toStrictEqual({
      kind: "terminal_retirement",
      id: parseSafeReasonCode("terminal_retirement"),
      path: updateLeafPlanPath(stagingRoot, "terminal_retirement", "terminal_retirement"),
      hash: expected,
      bytes: bytes.byteLength,
    });
  });

  it("refuses a missing, extra or wrong-typed key", () => {
    const missing = plan();
    delete missing.set;
    expect(() => validate(missing)).toThrow();
    expect(() => validate({ ...plan(), extra: 1 })).toThrow();
    expect(() => validate(plan({ schemaVersion: 2 }))).toThrow();
    expect(() => validate(plan({ id: "Not Safe" }))).toThrow();
    expect(() => validate(plan({ transitionalManifestHash: "ABC" }))).toThrow();
    expect(() => validate(plan({ entries: [{ ...ref("bundle", bundleRoot, 1), extra: true }], maximumLeaves: 1 }))).toThrow();
    expect(() => validate(plan({ entries: [{ ...ref("bundle", bundleRoot, 1), kind: "journal" }], maximumLeaves: 1 }))).toThrow();
  });

  it("refuses a coordinator that is not this staging root's", () => {
    expect(() => validate(plan({ coordinatorId: `lc_${"d".repeat(64)}_3` }))).toThrow();
  });

  it.each<UpdateRetirementSetV1>(["prior_rollback", "consumed_rollback_and_rejected_release"])("admits the %s set", (set) => {
    expect(validate(plan({ set })).set).toBe(set);
  });

  it("refuses any other set", () => {
    expect(() => validate(plan({ set: "everything" }))).toThrow();
  });

  it("admits zero through sixteen entries and refuses seventeen", () => {
    const refs = (count: number): RetirementInventoryRefV1[] => Array.from({ length: count }, (_, index) => ref("bundle", path(`${home}/releases/r${String(index).padStart(2, "0")}`), 1));
    for (const count of [0, 1, 15, 16]) expect(validate(plan({ entries: refs(count) })).entries).toHaveLength(count);
    expect(() => validate(plan({ entries: refs(17) }))).toThrow();
  });

  it("requires entries strictly in kind then unsigned UTF-8 root order", () => {
    const ordered = [ref("bundle", bundleRoot, 2), ref("metadata", path(`${home}/metadata/a`), 3), ref("rollback_payload", payloadRoot, 3), ref("rollback_record", path(`${home}/state/rollback.json`), 1)];
    expect(validate(plan({ entries: ordered })).entries).toStrictEqual(ordered);
    expect(() => validate(plan({ entries: [ordered[1], ordered[0]] }))).toThrow();
    expect(() => validate(plan({ entries: [ordered[0], ordered[0]] }))).toThrow();
    const byRoot = [ref("bundle", path(`${home}/releases/Z`), 1), ref("bundle", path(`${home}/releases/a`), 1)];
    expect(validate(plan({ entries: byRoot })).entries).toHaveLength(2);
    expect(() => validate(plan({ entries: [byRoot[1], byRoot[0]] }))).toThrow();
    const nonAscii = [ref("bundle", path(`${home}/releases/z`), 1), ref("bundle", path(`${home}/releases/é`), 1)];
    expect(validate(plan({ entries: nonAscii })).entries).toHaveLength(2);
  });

  it("recomputes maximumLeaves from the entries", () => {
    expect(() => validate(plan({ maximumLeaves: 2 }))).toThrow();
    expect(() => validate(plan({ maximumLeaves: 4 }))).toThrow();
  });

  it("admits the exact cardinality maximum and refuses the first leaf over it", () => {
    const maximum = [ref("bundle", bundleRoot, 200_001), ref("metadata", path(`${home}/metadata/a`), 3), ref("rollback_payload", payloadRoot, MAXIMUM_RETIREMENT_INVENTORY_LEAVES), ref("rollback_record", path(`${home}/state/rollback.json`), 1)];
    expect(validate(plan({ entries: maximum })).maximumLeaves).toBe(MAXIMUM_UPDATE_RETIREMENT_LEAVES);
    const over = [...maximum.slice(0, 3), ref("rollback_record", path(`${home}/state/rollback.json`), 2)];
    expect(() => validate(plan({ entries: over }))).toThrow();
    expect(() => validate(plan({ entries: [ref("rollback_payload", payloadRoot, MAXIMUM_RETIREMENT_INVENTORY_LEAVES + 1)] }))).toThrow();
  });

  it("admits a plan at exactly its declared bytes and refuses one byte under or over the leaf-plan cap", () => {
    const exactBytes = new TextEncoder().encode(encodeCanonicalJson(plan({ maximumPlanBytes: 999 }) as CanonicalJsonValue)).byteLength;
    expect(exactBytes).toBeGreaterThanOrEqual(100);
    expect(exactBytes).toBeLessThan(1000);
    expect(validate(plan({ maximumPlanBytes: exactBytes })).maximumPlanBytes).toBe(exactBytes);
    expect(() => validate(plan({ maximumPlanBytes: exactBytes - 1 }))).toThrow();
    expect(validate(plan({ maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES })).maximumPlanBytes).toBe(MAXIMUM_LEAF_PLAN_BYTES);
    expect(() => validate(plan({ maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES + 1 }))).toThrow();
    expect(() => validate(plan({ maximumPlanBytes: 0 }))).toThrow();
  });
});

describe("flattenUpdateRetirementLeaves", () => {
  const payloadLeaves = [file(payloadRoot, "blobs/b"), file(payloadRoot, "inventory.json"), directory(payloadRoot)];
  const bundleLeaves = [file(bundleRoot, "bin/tool"), directory(bundleRoot)];

  it("walks entries in plan order and each inventory in its resolver's removal order", () => {
    const parsed = validate(plan({ entries: [ref("bundle", bundleRoot, 2), ref("rollback_payload", payloadRoot, 3)] }));
    expect(flattenUpdateRetirementLeaves(parsed, [bundleLeaves, payloadLeaves])).toStrictEqual([...bundleLeaves, ...payloadLeaves]);
  });

  it("flattens an empty plan to no leaves", () => {
    expect(flattenUpdateRetirementLeaves(validate(plan({ entries: [] })), [])).toStrictEqual([]);
  });

  it("refuses a missing inventory, a wrong leaf count, a leaf outside its root, or a duplicate", () => {
    const parsed = validate(plan());
    expect(() => flattenUpdateRetirementLeaves(parsed, [])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(parsed, [payloadLeaves.slice(1)])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(parsed, [[...payloadLeaves.slice(0, 2), directory(`${payloadRoot}x`)]])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(parsed, [[payloadLeaves[0] as RetirementLeafV1, payloadLeaves[0] as RetirementLeafV1, directory(payloadRoot)]])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(parsed, [[...payloadLeaves.slice(0, 2), { ...directory(payloadRoot), sha256: sha("x") }]])).toThrow();
  });

  const recordRoot = path(`${home}/state/update-rollback.json`);
  const metadataRoot = path(`${home}/state/release-metadata/bundles/${sha("bundle manifest")}.json`);
  const record: RetirementLeafV1 = { path: recordRoot, kind: "file", bytes: null, sha256: sha("record") };
  const metadata: RetirementLeafV1 = { path: metadataRoot, kind: "file", bytes: null, sha256: sha("bundle manifest") };

  it("flattens all four inventory kinds in kind/root order", () => {
    const parsed = validate(plan({ set: "consumed_rollback_and_rejected_release", entries: [ref("bundle", bundleRoot, 2), ref("metadata", metadataRoot, 1), ref("rollback_payload", payloadRoot, 3), ref("rollback_record", recordRoot, 1)] }));
    expect(flattenUpdateRetirementLeaves(parsed, [bundleLeaves, [metadata], payloadLeaves, [record]])).toStrictEqual([...bundleLeaves, metadata, ...payloadLeaves, record]);
  });

  it("refuses a directory removed before a leaf inside it", () => {
    const nested = [file(bundleRoot, "bin/tool"), directory(`${bundleRoot}/bin`), file(bundleRoot, "bin/other"), directory(bundleRoot)];
    expect(() => flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("bundle", bundleRoot, 4)] })), [nested])).toThrow();
    const childFirst = [file(bundleRoot, "bin/tool"), file(bundleRoot, "bin/other"), directory(`${bundleRoot}/bin`), directory(bundleRoot)];
    expect(flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("bundle", bundleRoot, 4)] })), [childFirst])).toStrictEqual(childFirst);
  });

  it.each<RetirementInventoryRefV1["kind"]>(["bundle", "rollback_payload"])("requires a %s inventory to end at its root directory", (kind) => {
    const root = kind === "bundle" ? bundleRoot : payloadRoot;
    const parsed = validate(plan({ entries: [ref(kind, root, 2)] }));
    expect(() => flattenUpdateRetirementLeaves(parsed, [[directory(root), file(root, "late")]])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(parsed, [[file(root, "a"), file(root, "b")]])).toThrow();
  });

  it("requires a rollback record inventory to be exactly its one file", () => {
    expect(flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("rollback_record", recordRoot, 1)] })), [[record]])).toStrictEqual([record]);
    expect(() => flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("rollback_record", recordRoot, 0)] })), [[]])).toThrow();
    expect(() => flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("rollback_record", recordRoot, 1)] })), [[directory(recordRoot)]])).toThrow();
    const other = path(`${home}/state/update-rollback.json.d`);
    expect(() => flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("rollback_record", other, 2)] })), [[file(other, "a"), directory(other)]])).toThrow();
  });

  it("refuses a directory in a metadata inventory: shared metadata directories are not leaves", () => {
    const store = path(`${home}/state/release-metadata/bundles`);
    expect(() => flattenUpdateRetirementLeaves(validate(plan({ entries: [ref("metadata", store, 2)] })), [[file(store, "a.json"), directory(store)]])).toThrow();
  });

  it("flattens the feasible exact aggregate maximum and refuses the first leaf over either bound (A6)", () => {
    // The plan carries refs only, so its byte bound never binds before the 1,200,012-leaf cardinality bound.
    const stores = ["bundles", "delegations", "indexes"].map((store) => path(`${home}/state/release-metadata/${store}/${sha(store)}.json`));
    const entries = [ref("bundle", bundleRoot, 200_001), ...stores.map((root) => ref("metadata", root, 1)), ref("rollback_payload", payloadRoot, MAXIMUM_RETIREMENT_INVENTORY_LEAVES), ref("rollback_record", recordRoot, 1)];
    const parsed = validate(plan({ set: "consumed_rollback_and_rejected_release", entries }));
    expect(parsed.maximumLeaves).toBe(MAXIMUM_UPDATE_RETIREMENT_LEAVES);
    const flat = (root: CanonicalAbsolutePathV1, files: number): RetirementLeafV1[] => [...Array.from({ length: files }, (_, index) => file(root, `f${String(index)}`)), directory(root)];
    const bundle = flat(bundleRoot, 200_000);
    const inventories = [bundle, ...stores.map((root): RetirementLeafV1[] => [{ path: root, kind: "file", bytes: null, sha256: sha(root) }]), flat(payloadRoot, MAXIMUM_RETIREMENT_INVENTORY_LEAVES - 1), [record]];
    expect(flattenUpdateRetirementLeaves(parsed, inventories)).toHaveLength(MAXIMUM_UPDATE_RETIREMENT_LEAVES);
    expect(() => flattenUpdateRetirementLeaves(parsed, [[file(bundleRoot, "extra"), ...bundle], ...inventories.slice(1)])).toThrow();
    expect(() => validate(plan({ entries: [...entries.slice(0, 5), ref("rollback_record", recordRoot, 2)] }))).toThrow();
  }, 120_000);
});
