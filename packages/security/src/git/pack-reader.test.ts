import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  parseCanonicalAbsolutePathText,
  parseLowerHexSha1,
  type GitPackReaderBudgetV1,
  type LowerHexSha1,
} from "@developer-os/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import {
  blob,
  buildPack,
  commit,
  contentOf,
  delta,
  smallClosure,
  tree,
  writeOwnerOnly,
  type PackFixtureEntryV1,
  type PackFixtureV1,
} from "./pack.test-fixtures.js";
import {
  GIT_PACK_READER_LIMITS,
  GIT_PACK_READER_TRANSIENT_BYTES,
  GitPackReaderLedger,
  GuardedSha1PackReader,
  gitPackReaderBudget,
  type GitPackReaderLimitsV1,
  type GitPackReadRequestV1,
} from "./pack-reader.js";

const UID = process.getuid?.() ?? 0;
const LIVE_PHASE = { remainingMilliseconds: (): number => 600000 };

let root: string;

beforeEach(async () => {
  root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-pack-reader-`));
});

afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

interface ReaderFixture {
  readonly reader: GuardedSha1PackReader;
  readonly request: GitPackReadRequestV1;
  readonly budget: GitPackReaderBudgetV1;
  quarantineExists(): Promise<boolean>;
  readonly coordinatorIntentCount: number;
}

interface FixtureOptions {
  readonly target?: LowerHexSha1;
  readonly boundary?: readonly LowerHexSha1[];
  readonly limits?: Partial<GitPackReaderLimitsV1>;
  readonly budget?: GitPackReaderBudgetV1;
  readonly phase?: GitPackReadRequestV1["phase"];
  readonly mutatePack?: (pack: Uint8Array) => Uint8Array;
}

let fixtureCounter = 0;

/** A private owner-only quarantine holding one staged pack/index pair, and an empty coordinator state root. */
async function readerFixture(pack: PackFixtureV1, target: LowerHexSha1, options: FixtureOptions = {}): Promise<ReaderFixture> {
  fixtureCounter += 1;
  const base = `${root}/case-${fixtureCounter.toString(10)}`;
  await nodeFs.mkdir(`${base}/state/lifecycle-coordinators`, { recursive: true });
  const quarantine = parseCanonicalAbsolutePathText(`${base}/quarantine`);
  await nodeFs.mkdir(quarantine, { mode: 0o700 });
  const packPath = parseCanonicalAbsolutePathText(`${quarantine}/post-0`);
  const indexPath = parseCanonicalAbsolutePathText(`${quarantine}/post-1`);
  await writeOwnerOnly(packPath, options.mutatePack?.(pack.pack) ?? pack.pack);
  await writeOwnerOnly(indexPath, pack.index);
  const count = new DataView(pack.pack.buffer, pack.pack.byteOffset).getUint32(8);
  return {
    reader: new GuardedSha1PackReader({ limits: { ...GIT_PACK_READER_LIMITS, ...options.limits } }),
    request: {
      packPath,
      indexPath,
      quarantineRoot: quarantine,
      targetOid: options.target ?? target,
      boundary: new Set(options.boundary ?? []),
      phase: options.phase ?? LIVE_PHASE,
      effectiveUid: UID,
    },
    budget: options.budget ?? gitPackReaderBudget(Math.min(count, 200001)),
    async quarantineExists() {
      return nodeFs
        .lstat(quarantine)
        .then(() => true)
        .catch(() => false);
    },
    get coordinatorIntentCount() {
      return readdirSync(`${base}/state/lifecycle-coordinators`).length;
    },
  };
}

function smallFixture(options: FixtureOptions = {}): Promise<ReaderFixture> {
  const closure = smallClosure();
  return readerFixture(buildPack(closure.entries), closure.head.oid, options);
}

/** A chain of `length` OFS deltas over one base blob, with the commit and tree reaching every link. */
function deltaChain(length: number, baseBytes = 16): { readonly entries: readonly PackFixtureEntryV1[]; readonly head: LowerHexSha1 } {
  let current = blob(`${"x".repeat(baseBytes)}\n`);
  const entries: PackFixtureEntryV1[] = [{ kind: "object", object: current }];
  for (let level = 1; level <= length; level += 1) {
    const step = delta(contentOf(current), [{ copy: [0, baseBytes] }, { insert: new TextEncoder().encode(`${level.toString(10)}\n`) }]);
    const next = blob(new TextDecoder().decode(step.result));
    // `base` indexes the final pack, which puts the commit and the tree first.
    entries.push({ kind: "ofs_delta", base: 2 + entries.length - 1, delta: step.delta, result: next });
    current = next;
  }
  const names = entries.map((_, index) => `f${index.toString(10).padStart(3, "0")}.md`);
  const objects = entries.map((entry) => (entry.kind === "object" ? entry.object.oid : entry.kind === "ofs_delta" ? entry.result.oid : ""));
  const root = tree(objects.map((oid, index) => ["100644", names[index] as string, parseLowerHexSha1(oid)] as const));
  const head = commit(root.oid, null);
  return { entries: [{ kind: "object", object: head }, { kind: "object", object: root }, ...entries], head: head.oid };
}

interface BudgetBoundary {
  readonly name: string;
  readonly reason: string;
  readonly build: () => Promise<ReaderFixture>;
}

const packBudgetBoundaries: readonly BudgetBoundary[] = [
  {
    name: "compressed bytes",
    reason: "git_pack_compressed_over_limit",
    build: async () => {
      const closure = smallClosure();
      const pack = buildPack(closure.entries);
      return readerFixture(pack, closure.head.oid, { limits: { compressedPackMaxBytes: pack.pack.byteLength - 1 } });
    },
  },
  {
    name: "object size",
    reason: "git_pack_object_over_limit",
    build: () => smallFixture({ limits: { perObjectInflatedMaxBytes: 5 } }),
  },
  {
    name: "aggregate inflation",
    reason: "git_pack_inflation_over_limit",
    build: () => smallFixture({ limits: { aggregateInflatedMaxBytes: 64 } }),
  },
  {
    name: "delta depth",
    reason: "git_pack_delta_depth_over_limit",
    build: async () => {
      const chain = deltaChain(3);
      return readerFixture(buildPack(chain.entries), chain.head, { limits: { deltaDepthMax: 2 } });
    },
  },
  {
    name: "delta work",
    reason: "git_pack_delta_work_over_limit",
    build: async () => {
      const chain = deltaChain(2);
      return readerFixture(buildPack(chain.entries), chain.head, { limits: { deltaWorkMaxBytes: 40 } });
    },
  },
  {
    name: "delta instructions",
    reason: "git_pack_delta_instructions_over_limit",
    build: async () => {
      const chain = deltaChain(2);
      return readerFixture(buildPack(chain.entries), chain.head, { limits: { deltaInstructionMax: 3 } });
    },
  },
  {
    name: "resident memory",
    reason: "git_pack_resident_memory_over_limit",
    build: () => smallFixture({ limits: { residentMemoryMaxBytes: GIT_PACK_READER_TRANSIENT_BYTES + 8 } }),
  },
  {
    name: "temp",
    reason: "git_pack_temp_over_limit",
    build: async () => {
      const chain = deltaChain(1, 2000);
      return readerFixture(buildPack(chain.entries), chain.head, {
        limits: { residentMemoryMaxBytes: GIT_PACK_READER_TRANSIENT_BYTES + 512, additionalTempMaxBytes: 8 },
      });
    },
  },
  {
    name: "deadline",
    reason: "git_pack_deadline",
    build: () => smallFixture({ phase: { remainingMilliseconds: () => 0 } }),
  },
  {
    name: "object count",
    reason: "git_pack_object_count_over_limit",
    build: () => smallFixture({ limits: { objectCountMax: 3 } }),
  },
];

describe("GuardedSha1PackReader budget boundaries", () => {
  it("enumerates every budget ceiling", () => {
    expect(packBudgetBoundaries.length).toBeGreaterThan(0);
    expect(packBudgetBoundaries.map((boundary) => boundary.reason)).toEqual([
      "git_pack_compressed_over_limit",
      "git_pack_object_over_limit",
      "git_pack_inflation_over_limit",
      "git_pack_delta_depth_over_limit",
      "git_pack_delta_work_over_limit",
      "git_pack_delta_instructions_over_limit",
      "git_pack_resident_memory_over_limit",
      "git_pack_temp_over_limit",
      "git_pack_deadline",
      "git_pack_object_count_over_limit",
    ]);
  });

  it.each(packBudgetBoundaries)("refuses first-over-limit $name", async ({ build, reason }) => {
    const fixture = await build();
    const { reader } = fixture;
    await expect(reader.validate(fixture.request, fixture.budget)).rejects.toThrow(reason);
    expect(await fixture.quarantineExists()).toBe(false);
    expect(fixture.coordinatorIntentCount).toBe(0);
  });

  it("admits a pack exactly at every scaled ceiling it reaches", async () => {
    const chain = deltaChain(2);
    const pack = buildPack(chain.entries);
    const probe = await readerFixture(pack, chain.head);
    const evidence = await probe.reader.validate(probe.request, probe.budget);
    const exact = await readerFixture(pack, chain.head, {
      limits: {
        compressedPackMaxBytes: pack.pack.byteLength,
        aggregateInflatedMaxBytes: evidence.inflatedBytes,
        deltaDepthMax: evidence.maximumDeltaDepth,
        deltaWorkMaxBytes: evidence.deltaWorkBytes,
        deltaInstructionMax: evidence.deltaInstructions,
        objectCountMax: 5,
      },
    });
    await expect(exact.reader.validate(exact.request, exact.budget)).resolves.toEqual(evidence);
    expect(evidence.maximumDeltaDepth).toBe(2);
  });

  it("spills a legal object past the resident ceiling to the private temp and removes the spill", async () => {
    const chain = deltaChain(1, 2000);
    // Room for the always-resident 1,184-byte index of this 4-object pack, not for the 2,001-byte blob.
    const fixture = await readerFixture(buildPack(chain.entries), chain.head, {
      limits: { residentMemoryMaxBytes: GIT_PACK_READER_TRANSIENT_BYTES + 1536 },
    });
    const evidence = await fixture.reader.validate(fixture.request, fixture.budget);
    expect(evidence.peakTempBytes).toBeGreaterThan(0);
    expect(evidence.peakResidentBytes).toBeLessThanOrEqual(GIT_PACK_READER_TRANSIENT_BYTES + 1536);
    expect((await nodeFs.readdir(fixture.request.quarantineRoot)).sort()).toEqual(["post-0", "post-1"]);
  });
});

describe("GitPackReaderLedger at the production ceilings", () => {
  const ledger = (): GitPackReaderLedger => new GitPackReaderLedger(GIT_PACK_READER_LIMITS, LIVE_PHASE);

  it("counts compressed bytes to exactly 2 GiB", () => {
    const counted = ledger();
    counted.compressed(2147483648);
    expect(() => {
      counted.compressed(1);
    }).toThrow("git_pack_compressed_over_limit");
    expect(() => {
      ledger().packSize(2147483649);
    }).toThrow("git_pack_compressed_over_limit");
  });

  it("admits a 512-MiB object and refuses the next byte before allocation", () => {
    expect(() => {
      ledger().declare(536870912);
    }).not.toThrow();
    expect(() => {
      ledger().declare(536870913);
    }).toThrow("git_pack_object_over_limit");
  });

  it("charges aggregate inflation and delta work to exactly 8 GiB", () => {
    const counted = ledger();
    counted.inflated(8589934592);
    expect(() => {
      counted.inflated(1);
    }).toThrow("git_pack_inflation_over_limit");
    counted.deltaWork(8589934592);
    expect(() => {
      counted.deltaWork(1);
    }).toThrow("git_pack_delta_work_over_limit");
  });

  it("admits delta depth 50 and 10,000,000 instructions, and refuses one more", () => {
    const counted = ledger();
    counted.depth(50);
    expect(() => {
      counted.depth(51);
    }).toThrow("git_pack_delta_depth_over_limit");
    for (let index = 0; index < 10000000; index += 1) counted.instruction();
    expect(() => {
      counted.instruction();
    }).toThrow("git_pack_delta_instructions_over_limit");
  });

  it("holds 256 MiB resident, then spills, and caps live temp at 10 GiB", () => {
    const counted = ledger();
    counted.requireResident(268435456);
    expect(counted.tryResident(1)).toBe(false);
    expect(() => {
      counted.requireResident(1);
    }).toThrow("git_pack_resident_memory_over_limit");
    counted.releaseResident(268435456);
    expect(counted.tryResident(1)).toBe(true);
    counted.acquireTemp(10737418240);
    expect(() => {
      counted.acquireTemp(1);
    }).toThrow("git_pack_temp_over_limit");
    counted.releaseTemp(10737418240);
    expect(() => {
      counted.acquireTemp(1);
    }).not.toThrow();
  });

  it("never resets the inherited deadline", () => {
    let remaining = 1;
    const counted = new GitPackReaderLedger(GIT_PACK_READER_LIMITS, { remainingMilliseconds: () => remaining });
    expect(() => {
      counted.deadline();
    }).not.toThrow();
    remaining = 0;
    expect(() => {
      counted.deadline();
    }).toThrow("git_pack_deadline");
  });
});

describe("GuardedSha1PackReader counts", () => {
  it("builds the exact budget with all three counts equal and refuses 200,002", () => {
    expect(gitPackReaderBudget(200001)).toMatchObject({
      packHeaderObjectCount: 200001,
      admittedObjectCount: 200001,
      closedEffectObjectCount: 200001,
      compressedPackMaxBytes: 2147483648,
      inheritedPushDeadlineMs: 600000,
    });
    expect(() => gitPackReaderBudget(200002)).toThrow(SecurityRefusalError);
    expect(() => gitPackReaderBudget(200002)).toThrow("git_pack_object_count_over_limit");
  });

  it("refuses a budget whose header, admitted and closure counts are unequal", async () => {
    const fixture = await smallFixture({ budget: { ...gitPackReaderBudget(4), admittedObjectCount: 3 } });
    await expect(fixture.reader.validate(fixture.request, fixture.budget)).rejects.toThrow("git_pack_budget_invalid");
    expect(await fixture.quarantineExists()).toBe(false);
  });

  // W2-SEC-GIT-2: a quarantine that cannot be destroyed must not erase why the read was refused.
  it("keeps the original refusal as the cause when the quarantine cannot be destroyed", async () => {
    const fixture = await smallFixture({ budget: { ...gitPackReaderBudget(4), admittedObjectCount: 3 } });
    const error: unknown = await fixture.reader
      .validate({ ...fixture.request, effectiveUid: UID + 1 }, fixture.budget)
      .then(() => null, (refusal: unknown) => refusal);
    expect(error).toBeInstanceOf(SecurityRefusalError);
    expect((error as Error).message).toBe("git_quarantine_changed");
    expect((error as Error).cause).toBeInstanceOf(SecurityRefusalError);
    expect(((error as Error).cause as Error).message).toBe("git_pack_budget_invalid");
    expect(await fixture.quarantineExists()).toBe(true);
  });

  it("refuses a header count that differs from the permit's count", async () => {
    const fixture = await smallFixture({ budget: gitPackReaderBudget(3) });
    await expect(fixture.reader.validate(fixture.request, fixture.budget)).rejects.toThrow("git_pack_count_mismatch");
    expect(await fixture.quarantineExists()).toBe(false);
  });

  it("accepts a nonzero self-contained closure with every count equal", async () => {
    const closure = smallClosure();
    const pack = buildPack(closure.entries);
    const fixture = await readerFixture(pack, closure.head.oid);
    const evidence = await fixture.reader.validate(fixture.request, fixture.budget);
    expect(evidence).toMatchObject({
      targetOid: closure.head.oid,
      packChecksum: pack.checksum,
      packSize: pack.pack.byteLength,
      indexSize: pack.index.byteLength,
      budget: { packHeaderObjectCount: 4, admittedObjectCount: 4, closedEffectObjectCount: 4 },
      maximumDeltaDepth: 0,
    });
    expect(await fixture.quarantineExists()).toBe(true);
  });

  it("accepts a zero-object pack when the destination already owns the target", async () => {
    const closure = smallClosure();
    const fixture = await readerFixture(buildPack([]), closure.head.oid, { boundary: [closure.head.oid] });
    const evidence = await fixture.reader.validate(fixture.request, fixture.budget);
    expect(evidence.budget).toMatchObject({ packHeaderObjectCount: 0, admittedObjectCount: 0, closedEffectObjectCount: 0 });
  });

  it("refuses a zero-object pack whose target the destination does not own", async () => {
    const closure = smallClosure();
    const fixture = await readerFixture(buildPack([]), closure.head.oid);
    await expect(fixture.reader.validate(fixture.request, fixture.budget)).rejects.toThrow("git_pack_target_missing");
    expect(await fixture.quarantineExists()).toBe(false);
  });

  it(
    "accepts exactly 200,001 objects",
    async () => {
      const blobs = Array.from({ length: 199999 }, (_, index) => blob(`${index.toString(10)}\n`));
      const root = tree(blobs.map((object, index) => ["100644", `f${index.toString(10)}`, object.oid] as const));
      const head = commit(root.oid, null);
      const entries: PackFixtureEntryV1[] = [
        { kind: "object", object: head },
        { kind: "object", object: root },
        ...blobs.map((object) => ({ kind: "object", object }) as const),
      ];
      const fixture = await readerFixture(buildPack(entries), head.oid);
      const evidence = await fixture.reader.validate(fixture.request, fixture.budget);
      expect(evidence.budget.admittedObjectCount).toBe(200001);
    },
    300000,
  );

  it("refuses a pack header declaring 200,002 objects before framing any entry", async () => {
    const closure = smallClosure();
    const fixture = await readerFixture(buildPack(closure.entries, { headerCount: 200002 }), closure.head.oid, {
      budget: gitPackReaderBudget(200001),
    });
    await expect(fixture.reader.validate(fixture.request, fixture.budget)).rejects.toThrow("git_pack_object_count_over_limit");
    expect(await fixture.quarantineExists()).toBe(false);
  });
});

describe("GuardedSha1PackReader closure", () => {
  async function refuses(fixture: ReaderFixture, reason: string): Promise<void> {
    await expect(fixture.reader.validate(fixture.request, fixture.budget)).rejects.toThrow(reason);
    expect(await fixture.quarantineExists()).toBe(false);
    expect(fixture.coordinatorIntentCount).toBe(0);
  }

  it("refuses a malformed pack signature", async () => {
    await refuses(
      await smallFixture({
        mutatePack: (pack) => {
          const copy = Uint8Array.from(pack);
          copy[0] = 0x51;
          return copy;
        },
      }),
      "git_pack_checksum_mismatch",
    );
  });

  it("refuses a malformed signature under a valid trailer", async () => {
    await refuses(
      await smallFixture({
        mutatePack: (pack) => {
          const body = Uint8Array.from(pack.subarray(0, pack.byteLength - 20));
          body[3] = 0x58;
          return Uint8Array.from([...body, ...createHash("sha1").update(body).digest()]);
        },
      }),
      "git_pack_malformed",
    );
  });

  it("refuses a pack whose header promises more entries than it holds", async () => {
    const closure = smallClosure();
    await refuses(await readerFixture(buildPack(closure.entries, { headerCount: 5 }), closure.head.oid, { budget: gitPackReaderBudget(5) }), "git_pack_truncated");
  });

  it("refuses a truncated pack file", async () => {
    await refuses(await smallFixture({ mutatePack: (pack) => pack.subarray(0, pack.byteLength - 7) }), "git_pack_checksum_mismatch");
  });

  it("refuses a duplicate object", async () => {
    const closure = smallClosure();
    await refuses(
      await readerFixture(buildPack([...closure.entries, { kind: "object", object: closure.alpha }]), closure.head.oid),
      "git_pack_duplicate_object",
    );
  });

  it("refuses an extra object outside the target closure", async () => {
    const closure = smallClosure();
    await refuses(
      await readerFixture(buildPack([...closure.entries, { kind: "object", object: blob("extra\n") }]), closure.head.oid),
      "git_pack_extra_object",
    );
  });

  it("refuses an extra target commit", async () => {
    const closure = smallClosure();
    const second = commit(closure.root.oid, closure.head.oid);
    await refuses(await readerFixture(buildPack([...closure.entries, { kind: "object", object: second }]), closure.head.oid), "git_pack_extra_object");
  });

  it("refuses a wrong-OID target", async () => {
    await refuses(await smallFixture({ target: parseLowerHexSha1("1".repeat(40)) }), "git_pack_target_missing");
  });

  it("refuses a target that is not a commit", async () => {
    const closure = smallClosure();
    await refuses(await smallFixture({ target: closure.root.oid }), "git_pack_wrong_target");
  });

  it("refuses a missing closure node", async () => {
    const closure = smallClosure();
    await refuses(
      await readerFixture(buildPack(closure.entries.filter((entry) => entry.kind !== "object" || entry.object.oid !== closure.beta.oid)), closure.head.oid),
      "git_pack_missing_object",
    );
  });

  it("stops at boundary objects and admits fix-thin bases the destination owns", async () => {
    const closure = smallClosure();
    const changed = delta(contentOf(closure.beta), [{ copy: [0, 5] }, { insert: new TextEncoder().encode("gamma\n") }]);
    const gamma = blob(new TextDecoder().decode(changed.result));
    const nextRoot = tree([
      ["100644", "a.md", closure.alpha.oid],
      ["100644", "b.md", gamma.oid],
    ]);
    const next = commit(nextRoot.oid, closure.head.oid);
    const entries: PackFixtureEntryV1[] = [
      { kind: "object", object: next },
      { kind: "object", object: nextRoot },
      { kind: "ref_delta", baseOid: closure.beta.oid, delta: changed.delta, result: gamma },
      { kind: "object", object: closure.beta },
    ];
    const boundary = [closure.head.oid, closure.root.oid, closure.alpha.oid, closure.beta.oid];
    const accepted = await readerFixture(buildPack(entries), next.oid, { boundary });
    const evidence = await accepted.reader.validate(accepted.request, accepted.budget);
    expect(evidence.budget.closedEffectObjectCount).toBe(4);
    expect(evidence.maximumDeltaDepth).toBe(1);
    await refuses(await readerFixture(buildPack(entries), next.oid), "git_pack_missing_object");
  });

  it("refuses a REF delta whose base is neither in the pack nor resolvable", async () => {
    const closure = smallClosure();
    const changed = delta(contentOf(closure.beta), [{ copy: [0, 5] }]);
    const result = blob(new TextDecoder().decode(changed.result));
    const entries: PackFixtureEntryV1[] = [...closure.entries.slice(0, 3), { kind: "ref_delta", baseOid: parseLowerHexSha1("2".repeat(40)), delta: changed.delta, result }];
    await refuses(await readerFixture(buildPack(entries), closure.head.oid), "git_pack_missing_base");
  });

  it("refuses an annotated tag entry", async () => {
    const closure = smallClosure();
    await refuses(
      await readerFixture(buildPack([...closure.entries, { kind: "tag", content: new TextEncoder().encode("object x\n") }]), closure.head.oid),
      "git_pack_unsupported_object_type",
    );
  });

  it("refuses a gitlink tree entry", async () => {
    const root = tree([["160000", "vendor", parseLowerHexSha1("3".repeat(40))]]);
    const head = commit(root.oid, null);
    await refuses(
      await readerFixture(buildPack([{ kind: "object", object: head }, { kind: "object", object: root }]), head.oid),
      "git_pack_unsupported_tree_entry",
    );
  });

  it("refuses an index that disagrees with the pack", async () => {
    const closure = smallClosure();
    const pack = buildPack(closure.entries);
    const other = buildPack([...closure.entries].reverse());
    await refuses(await readerFixture({ ...pack, index: other.index }, closure.head.oid), "git_pack_index_mismatch");
  });

  it("refuses a staged pack outside the quarantine", async () => {
    const fixture = await smallFixture();
    const outside = parseCanonicalAbsolutePathText(`${root}/outside.pack`);
    await expect(fixture.reader.validate({ ...fixture.request, packPath: outside }, fixture.budget)).rejects.toThrow(
      "git_pack_outside_quarantine",
    );
    expect(await fixture.quarantineExists()).toBe(false);
  });
});
