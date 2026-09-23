import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { UID } from "../lifecycle/testing.js";
import {
  GIT_METADATA_BOUNDS,
  GIT_ZERO_OID,
  gitReflogAppendLine,
  gitTreeFingerprintHash,
  parseFullBranchRef,
  parseLowerHexSha1,
  validateGitHeadState,
  validateGitIndexState,
  validateGitMetadataBounds,
  validateGitPackReaderBudget,
  validateGitRefState,
  validateGitReflogAppend,
  validateGitReflogPlan,
  validateGitReflogState,
  validateGitRelinquishedDirectoryRoot,
  validateGitSourceState,
  validateGitTreeFingerprint,
  validateGuardedGitPathState,
  validatePlannedGitPathState,
  type GitReflogAppendV1,
} from "./types.js";

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const HASH = "c".repeat(64);
const HASH_2 = "d".repeat(64);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function append(overrides: Partial<Record<keyof GitReflogAppendV1, unknown>> = {}): Record<string, unknown> {
  const committer = { name: "Synthetic Tester", email: "tester@example.invalid", unixSeconds: 1790000000, utcOffset: "+0200" };
  const oldOid = (overrides.oldOid ?? OID_A) as string;
  const newOid = (overrides.newOid ?? OID_B) as string;
  const line = gitReflogAppendLine({
    oldOid: oldOid as GitReflogAppendV1["oldOid"],
    newOid: newOid as GitReflogAppendV1["newOid"],
    committer: (overrides.committer ?? committer) as GitReflogAppendV1["committer"],
  });
  const lineBytes = Buffer.byteLength(line, "utf8");
  return {
    role: "source_branch_reflog",
    path: "/vault/.git/logs/refs/heads/main",
    before: { state: "present", bytesHash: HASH, size: 100 },
    oldOid,
    newOid,
    committer,
    message: "developer-os sync",
    lineBytes,
    lineHash: sha256(line),
    after: { state: "present", bytesHash: HASH_2, size: 100 + lineBytes },
    ...overrides,
  };
}

function headAppend(): Record<string, unknown> {
  return { ...append(), role: "source_head_reflog", path: "/vault/.git/logs/HEAD" };
}

function budget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    compressedPackMaxBytes: 2147483648,
    packHeaderObjectCount: 3,
    closedEffectObjectCount: 3,
    admittedObjectCount: 3,
    perObjectInflatedMaxBytes: 536870912,
    aggregateInflatedMaxBytes: 8589934592,
    deltaDepthMax: 50,
    deltaInstructionMax: 10000000,
    deltaWorkMaxBytes: 8589934592,
    residentMemoryMaxBytes: 268435456,
    additionalTempMaxBytes: 10737418240,
    inheritedPushDeadlineMs: 600000,
    ...overrides,
  };
}

function sourceState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configHash: HASH,
    index: { state: "present", bytesHash: HASH_2 },
    head: { state: "present", bytesHash: HASH, semantic: { kind: "symbolic_ref", value: "refs/heads/main" } },
    headReflog: { state: "absent" },
    branchReflog: { state: "present", bytesHash: HASH, size: 10 },
    branchRef: { state: "present", oid: OID_A, bytesHash: HASH },
    ...overrides,
  };
}

function fileEntry(relativePath: string): Record<string, unknown> {
  return { relativePath, kind: "regular_file", ownerUid: UID, mode: 0o644, dev: "1", ino: "2", nlink: 1, size: 3, hash: HASH };
}

function directoryEntry(relativePath: string): Record<string, unknown> {
  return { relativePath, kind: "directory", ownerUid: UID, mode: 0o755, dev: "1", ino: "3" };
}

function fingerprint(entries: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { root: { ownerUid: UID, mode: 0o755, dev: "1", ino: "18446744073709551615" }, entries };
}

describe("Git scalar grammar", () => {
  it("admits exactly 40 lowercase hex bytes as LowerHexSha1", () => {
    expect(parseLowerHexSha1(OID_A)).toBe(OID_A);
    for (const bad of ["A".repeat(40), "a".repeat(39), "a".repeat(41), `${"a".repeat(39)}g`, 7]) {
      expect(() => parseLowerHexSha1(bad)).toThrow("LowerHexSha1");
    }
  });

  it("admits refs/heads/ plus a validated branch as FullBranchRefV1", () => {
    expect(parseFullBranchRef("refs/heads/feature/x")).toBe("refs/heads/feature/x");
    for (const bad of ["refs/heads/", "refs/tags/v1", "main", "refs/heads/a..b", "refs/heads/-x", "refs/heads/x.lock"]) {
      expect(() => parseFullBranchRef(bad)).toThrow();
    }
  });
});

describe("GitMetadataBoundsV1 and GitPackReaderBudgetV1", () => {
  const boundKeys = Object.keys(GIT_METADATA_BOUNDS);

  it("pins the spec §4.4 literals exactly", () => {
    expect(boundKeys.length).toBe(12);
    expect(GIT_METADATA_BOUNDS.reflogPostimageMaxBytes).toBe(67112960);
    expect(GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes + GIT_METADATA_BOUNDS.reflogAppendMaxBytes).toBe(67112960);
    expect(validateGitMetadataBounds({ ...GIT_METADATA_BOUNDS })).toEqual(GIT_METADATA_BOUNDS);
  });

  it.each(boundKeys)("refuses %s moved by one byte", (key) => {
    const bounds = GIT_METADATA_BOUNDS as unknown as Record<string, number>;
    expect(() => validateGitMetadataBounds({ ...bounds, [key]: (bounds[key] as number) + 1 })).toThrow(key);
  });

  it("refuses an unknown bound key", () => {
    expect(() => validateGitMetadataBounds({ ...GIT_METADATA_BOUNDS, extra: 1 })).toThrow("keys");
  });

  it("admits equal counts through 200001 and refuses 200002", () => {
    const count = 200001;
    expect(validateGitPackReaderBudget(budget({ packHeaderObjectCount: count, closedEffectObjectCount: count, admittedObjectCount: count })).admittedObjectCount).toBe(count);
    expect(() =>
      validateGitPackReaderBudget(budget({ packHeaderObjectCount: 200002, closedEffectObjectCount: 200002, admittedObjectCount: 200002 })),
    ).toThrow("packHeaderObjectCount");
  });

  it("refuses disagreeing counts, a changed fixed limit and an unknown key", () => {
    expect(() => validateGitPackReaderBudget(budget({ admittedObjectCount: 2 }))).toThrow("counts");
    expect(() => validateGitPackReaderBudget(budget({ deltaDepthMax: 51 }))).toThrow("deltaDepthMax");
    expect(() => validateGitPackReaderBudget({ ...budget(), extra: 0 })).toThrow("keys");
  });
});

describe("HEAD, ref and index states", () => {
  it("admits the symbolic and OID HEAD arms and nothing else", () => {
    expect(validateGitHeadState({ state: "present", bytesHash: HASH, semantic: { kind: "oid", value: OID_A } }).semantic.kind).toBe("oid");
    expect(
      validateGitHeadState({ state: "present", bytesHash: HASH, semantic: { kind: "symbolic_ref", value: "refs/heads/main" } }).semantic,
    ).toEqual({ kind: "symbolic_ref", value: "refs/heads/main" });
    for (const bad of [
      { state: "present", bytesHash: HASH, semantic: { kind: "none" } },
      { state: "absent" },
      { state: "present", bytesHash: HASH, semantic: { kind: "oid", value: OID_A, extra: 1 } },
      { state: "present", bytesHash: HASH, semantic: { kind: "symbolic_ref", value: "refs/tags/v1" } },
      { state: "present", semantic: { kind: "oid", value: OID_A } },
    ]) {
      expect(() => validateGitHeadState(bad)).toThrow();
    }
  });

  it("tags the index as absent or present with only its bytes hash", () => {
    expect(validateGitIndexState({ state: "absent" })).toEqual({ state: "absent" });
    expect(validateGitIndexState({ state: "present", bytesHash: HASH })).toEqual({ state: "present", bytesHash: HASH });
    expect(() => validateGitIndexState({ state: "present", bytesHash: HASH, version: 2 })).toThrow("keys");
    expect(() => validateGitIndexState({ state: "absent", bytesHash: HASH })).toThrow("keys");
    expect(() => validateGitIndexState({ state: "present" })).toThrow("keys");
  });

  it("tags a loose ref as absent or present", () => {
    expect(validateGitRefState({ state: "present", oid: OID_A, bytesHash: HASH }).state).toBe("present");
    expect(() => validateGitRefState({ state: "present", oid: OID_A })).toThrow("keys");
  });

  it("bounds a reflog state at the 67,112,960-byte postimage", () => {
    expect(validateGitReflogState({ state: "present", bytesHash: HASH, size: 67112960 }).state).toBe("present");
    expect(() => validateGitReflogState({ state: "present", bytesHash: HASH, size: 67112961 })).toThrow("size");
    expect(() => validateGitReflogState({ state: "present", bytesHash: HASH, size: -1 })).toThrow("size");
  });
});

describe("GitSourceStateV1", () => {
  it("admits a symbolic born source", () => {
    expect(validateGitSourceState(sourceState()).branchRef.state).toBe("present");
  });

  it("admits the unborn form: absent index and absent branch ref", () => {
    const state = validateGitSourceState(sourceState({ index: { state: "absent" }, branchRef: { state: "absent" } }));
    expect(state.index).toEqual({ state: "absent" });
  });

  it("refuses a detached source HEAD, an absent index on a born branch and an unknown key", () => {
    expect(() =>
      validateGitSourceState(sourceState({ head: { state: "present", bytesHash: HASH, semantic: { kind: "oid", value: OID_A } } })),
    ).toThrow("detached");
    expect(() => validateGitSourceState(sourceState({ index: { state: "absent" } }))).toThrow("absent on a born branch");
    expect(() => validateGitSourceState({ ...sourceState(), extra: null })).toThrow("keys");
  });
});

describe("GitReflogAppendV1 and GitReflogPlanV1", () => {
  it("admits an append whose line bytes, hash and sizes recompute", () => {
    const admitted = validateGitReflogAppend(append());
    expect(gitReflogAppendLine(admitted)).toBe(
      `${OID_A} ${OID_B} Synthetic Tester <tester@example.invalid> 1790000000 +0200\tdeveloper-os sync\n`,
    );
  });

  it("admits the all-zero old OID and an absent preimage whose postimage is the line alone", () => {
    const base = append({ oldOid: GIT_ZERO_OID });
    const admitted = validateGitReflogAppend({
      ...base,
      before: { state: "absent" },
      after: { state: "present", bytesHash: HASH_2, size: base.lineBytes },
    });
    expect(admitted.oldOid).toBe(GIT_ZERO_OID);
  });

  const refusals: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a wrong line length", { lineBytes: 7 }],
    ["a wrong line hash", { lineHash: HASH }],
    ["a wrong postimage size", { after: { state: "present", bytesHash: HASH_2, size: 101 } }],
    ["a preimage over 64 MiB", { before: { state: "present", bytesHash: HASH, size: 67108865 } }],
    ["a head role on a branch path", { role: "source_head_reflog" }],
    ["another message", { message: "chore" }],
    ["a name with <", { committer: { name: "a<b", email: "e@x", unixSeconds: 1, utcOffset: "+0000" } }],
    ["a name with a line break", { committer: { name: "a\nb", email: "e@x", unixSeconds: 1, utcOffset: "+0000" } }],
    ["an email with a space", { committer: { name: "a", email: "e @x", unixSeconds: 1, utcOffset: "+0000" } }],
    ["an offset past +1459", { committer: { name: "a", email: "e@x", unixSeconds: 1, utcOffset: "+1500" } }],
    ["a fractional timestamp", { committer: { name: "a", email: "e@x", unixSeconds: 1.5, utcOffset: "+0000" } }],
    ["an all-zero new OID", { newOid: GIT_ZERO_OID }],
  ];

  it("enumerates a non-empty refusal set", () => {
    expect(refusals.length).toBeGreaterThan(0);
  });

  it.each(refusals)("refuses %s", (_name, overrides) => {
    expect(() => validateGitReflogAppend({ ...append(), ...overrides })).toThrow();
  });

  it("refuses an unknown append key", () => {
    expect(() => validateGitReflogAppend({ ...append(), extra: 1 })).toThrow("keys");
  });

  it("admits source and destination plans with at least one matching append", () => {
    expect(validateGitReflogPlan({ side: "source", head: headAppend(), branch: append() }).side).toBe("source");
    expect(validateGitReflogPlan({ side: "source", head: null, branch: append() }).side).toBe("source");
    const destination = { ...append(), role: "destination_branch_reflog", path: "/remote.git/logs/refs/heads/main" };
    expect(validateGitReflogPlan({ side: "destination", branch: destination }).side).toBe("destination");
  });

  it("refuses an empty plan, a wrong-role member, disagreeing OIDs and a cross-side key", () => {
    expect(() => validateGitReflogPlan({ side: "source", head: null, branch: null })).toThrow("no append");
    expect(() => validateGitReflogPlan({ side: "destination", branch: null })).toThrow("no append");
    expect(() => validateGitReflogPlan({ side: "source", head: append(), branch: null })).toThrow("role");
    expect(() => validateGitReflogPlan({ side: "destination", branch: append() })).toThrow("role");
    const otherOids = { ...headAppend(), ...append({ newOid: "e".repeat(40) }), role: "source_head_reflog", path: "/vault/.git/logs/HEAD" };
    expect(() => validateGitReflogPlan({ side: "source", head: otherOids, branch: append() })).toThrow("OIDs");
    expect(() => validateGitReflogPlan({ side: "destination", head: null, branch: append() })).toThrow("keys");
  });
});

describe("GitTreeFingerprintV1 and path states", () => {
  it("admits sorted unique records and hashes them under the tree-fingerprint domain", () => {
    const value = fingerprint([directoryEntry("refs"), directoryEntry("refs/heads"), fileEntry("refs/heads/main"), fileEntry("HEAD")].sort((a, b) =>
      Buffer.compare(Buffer.from(a.relativePath as string), Buffer.from(b.relativePath as string)),
    ));
    const admitted = validateGitTreeFingerprint(value, UID);
    expect(admitted.entries.map((entry) => entry.relativePath)).toEqual(["HEAD", "refs", "refs/heads", "refs/heads/main"]);
    expect(gitTreeFingerprintHash(admitted)).toMatch(/^[0-9a-f]{64}$/u);
    expect(gitTreeFingerprintHash(admitted)).toBe(gitTreeFingerprintHash(validateGitTreeFingerprint(value, UID)));
  });

  it("refuses unsorted, duplicate, empty, oversized, foreign-owner and hard-linked records", () => {
    expect(() => validateGitTreeFingerprint(fingerprint([fileEntry("b"), fileEntry("a")]), UID)).toThrow("order");
    expect(() => validateGitTreeFingerprint(fingerprint([fileEntry("a"), fileEntry("a")]), UID)).toThrow("order");
    expect(() => validateGitTreeFingerprint(fingerprint([]), UID)).toThrow("count");
    const many = Array.from({ length: 512 }, (_, index) => fileEntry(`f${String(index).padStart(4, "0")}`));
    expect(() => validateGitTreeFingerprint(fingerprint(many), UID)).toThrow("count");
    expect(() => validateGitTreeFingerprint(fingerprint([fileEntry("a")]), UID + 1)).toThrow("EffectiveUidV1");
    expect(() => validateGitTreeFingerprint(fingerprint([{ ...fileEntry("a"), nlink: 2 }]), UID)).toThrow("nlink");
  });

  it.each(["", "a/../b", "./a", "a//b", "a\\b", "a\0b", `${"a/".repeat(128)}a`])(
    "refuses the relative path %j",
    (relativePath) => {
      expect(() => validateGitTreeFingerprint(fingerprint([fileEntry(relativePath)]), UID)).toThrow();
    },
  );

  it("admits each guarded and planned arm and refuses a planned identity", () => {
    const regular = { state: "regular_file", hash: HASH, size: 41, mode: 0o644, dev: "1", ino: "2", semantic: { kind: "oid", value: OID_A } };
    expect(validateGuardedGitPathState(regular, UID).state).toBe("regular_file");
    const tree = {
      state: "directory_tree",
      treeHash: HASH,
      entryCount: 511,
      ownerUid: UID,
      mode: 0o755,
      dev: "1",
      ino: "2",
      symbolicHead: "refs/heads/main",
    };
    expect(validateGuardedGitPathState(tree, UID).state).toBe("directory_tree");
    expect(() => validateGuardedGitPathState({ ...tree, entryCount: 512 }, UID)).toThrow("entryCount");
    expect(() => validateGuardedGitPathState({ ...regular, dev: 1 }, UID)).toThrow();
    const plannedRegular = { state: regular.state, hash: regular.hash, size: regular.size, mode: regular.mode, semantic: regular.semantic };
    expect(validatePlannedGitPathState(plannedRegular, UID).state).toBe("regular_file");
    expect(() => validatePlannedGitPathState(regular, UID)).toThrow("keys");
    expect(validatePlannedGitPathState({ state: "absent" }, UID)).toEqual({ state: "absent" });
  });

  it("admits a relinquished root with any observed owner and refuses a missing field", () => {
    const root = { state: "relinquished_directory_root", dev: "1", ino: "2", observedOwnerUid: 4294967295, observedMode: 0o700 };
    expect(validateGitRelinquishedDirectoryRoot(root).observedOwnerUid).toBe(4294967295);
    expect(() => validateGitRelinquishedDirectoryRoot({ ...root, observedOwnerUid: 4294967296 })).toThrow();
    const missing = { state: root.state, dev: root.dev, ino: root.ino, observedOwnerUid: root.observedOwnerUid };
    expect(() => validateGitRelinquishedDirectoryRoot(missing)).toThrow("keys");
  });
});
