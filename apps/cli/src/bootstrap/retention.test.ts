import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  BootstrapStateError,
  encodeCanonicalJson,
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type BootstrapJournalRecordV1,
  type BootstrapRetentionDirectoryEntryV1,
  type BootstrapRetentionEntryV1,
  type BootstrapRetentionPostimageV1,
  type CanonicalAbsolutePathV1,
  type FreshV2InitIdV1,
  type LowerHexSha256,
  type TransactionLockHandle,
} from "@developer-os/core";
import type { RenameSameParentNoReplace } from "@developer-os/platform-macos";
import { afterEach, describe, expect, it, vi } from "vitest";

type NodeFsPromisesModule = typeof nodeFs;

const fsRaceControl = vi.hoisted(() => ({
  afterLstat: undefined as undefined | ((candidate: string) => Promise<void>),
  failClosePath: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<NodeFsPromisesModule>();
  return new Proxy(actual, {
    get(target, property) {
      if (property === "open") {
        return async (...args: unknown[]) => {
          const handle = await Reflect.apply(target.open, target, args) as nodeFs.FileHandle;
          if (String(args[0]) !== fsRaceControl.failClosePath) return handle;
          return new Proxy(handle, {
            get(opened, handleProperty) {
              if (handleProperty === "close") {
                return async () => {
                  await opened.close();
                  throw new Error("synthetic directory close status loss");
                };
              }
              const value = Reflect.get(opened, handleProperty, opened) as unknown;
              return typeof value === "function"
                ? (...args: unknown[]) => Reflect.apply(value, opened, args) as unknown
                : value;
            },
          });
        };
      }
      if (property === "lstat") {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.lstat, target, args) as unknown;
          await fsRaceControl.afterLstat?.(String(args[0]));
          return result;
        };
      }
      return Reflect.get(target, property) as unknown;
    },
  });
});

import type { BootstrapJournalStore } from "./journal-store.js";
import {
  BootstrapRetainer,
  projectRetainedDirectoryTree,
  retainBootstrapEnvelope,
  type BootstrapRetentionDeathPointV1,
  type BootstrapRetentionObservationV1,
  type HeldBootstrapLocksV1,
} from "./retention.js";

const ID = "fi_6ba7b810-9dad-41d1-80b4-00c04fd430c8" as FreshV2InitIdV1;
const NOW = parseUtcTimestamp("2026-08-31T08:00:00.000Z");
const encoder = new TextEncoder();
const roots = new Set<string>();

const path = (value: string): CanonicalAbsolutePathV1 => value as CanonicalAbsolutePathV1;
const hash = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(
  createHash("sha256").update(value).digest("hex"),
);

function regular(
  content: string,
  ino: string,
  overrides: Partial<Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>> = {},
): Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }> {
  return {
    kind: "regular_file",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    bytes: parseUInt64Decimal(String(encoder.encode(content).byteLength)),
    sha256: hash(content),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal(ino),
    ...overrides,
  };
}

function tree(
  ino: string,
  overrides: Partial<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> = {},
): Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }> {
  const entries: readonly BootstrapRetentionDirectoryEntryV1[] = overrides.entries ?? [
    {
      relativePath: "nested", kind: "directory", ownerUid: 501, mode: 0o700, nlink: 2,
      bytes: parseUInt64Decimal("0"), sha256: null, dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(`${ino}1`),
    },
    {
      relativePath: "nested/data", kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 1,
      bytes: parseUInt64Decimal("4"), sha256: hash("data"), dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(`${ino}2`),
    },
  ];
  return {
    kind: "directory_tree",
    ownerUid: 501,
    mode: 0o700,
    nlink: 2,
    treeHash: parseLowerHexSha256(createHash("sha256")
      .update("developer-os/bootstrap-retained-tree/v1\0")
      .update(encodeCanonicalJson(entries).slice(0, -1))
      .digest("hex")),
    entryCount: entries.length,
    regularFileBytes: parseUInt64Decimal(entries.reduce(
      (total, candidate) => total + (candidate.kind === "regular_file" ? BigInt(candidate.bytes) : 0n),
      0n,
    ).toString()),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal(ino),
    entries,
    ...overrides,
  };
}

function entry(
  ordinal: number,
  role: BootstrapRetentionEntryV1["role"],
  sourcePath: CanonicalAbsolutePathV1,
  postimage: BootstrapRetentionPostimageV1,
): BootstrapRetentionEntryV1 {
  const parentPath = dirname(sourcePath) as CanonicalAbsolutePathV1;
  return {
    schemaVersion: 1,
    bootstrapId: ID,
    ordinal,
    role,
    sourcePath,
    tombstonePath: path(`${parentPath}/.developer-os-retained.${ID}.${String(ordinal).padStart(10, "0")}.tombstone`),
    parent: {
      path: parentPath,
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(parentPath.endsWith("staging") ? "30" : "20"),
    },
    postimage,
  };
}

function table(): readonly BootstrapRetentionEntryV1[] {
  return [
    entry(0, "payload", path("/synthetic/state/000.payload"), regular("payload", "101")),
    entry(1, "staging_subtree", path("/synthetic/staging/attempt"), tree("201")),
    entry(2, "bootstrap_lock", path("/synthetic/state/.lifecycle-bootstrap.lock"), regular("", "301")),
  ];
}

function parentProjection(row: BootstrapRetentionEntryV1): BootstrapRetentionPostimageV1 {
  return tree(row.parent.ino, {
    dev: row.parent.dev,
    ino: row.parent.ino,
    entryCount: 1,
    regularFileBytes: parseUInt64Decimal("0"),
  });
}

function terminalJournal(outcome: "finalized" | "rolled_back" = "finalized"): BootstrapJournalRecordV1 {
  return {
    schemaVersion: 1,
    id: ID,
    planHash: hash("synthetic-plan"),
    slot: 0,
    sequence: parseUInt64Decimal("40"),
    previousJournalHash: hash("synthetic-predecessor"),
    phase: outcome,
    direction: outcome === "finalized" ? "forward" : "compensating",
    nextPayload: 1,
    payloadWriteState: { state: "idle" },
    nextCreatedPath: 1,
    nextFoundationParticipant: 0,
    nextLaunchabilityPath: 0,
    manifestCursor: outcome === "finalized" ? 3 : 0,
    compensationNext: outcome === "finalized" ? null : -1,
    payloadRetentionPart: null,
    terminalOutcome: outcome,
    retentionNext: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class SyntheticDeath extends Error {
  constructor(readonly point: BootstrapRetentionDeathPointV1) {
    super(`synthetic death at ${point}`);
  }
}

interface RetentionFixture {
  readonly rows: readonly BootstrapRetentionEntryV1[];
  readonly projections: Map<string, BootstrapRetentionPostimageV1>;
  readonly events: string[];
  readonly renameRequests: BootstrapRetentionEntryV1[];
  readonly store: BootstrapJournalStore;
  readonly locks: HeldBootstrapLocksV1;
  readonly released: { bootstrap: number; global: number };
  retainer(point?: BootstrapRetentionDeathPointV1): BootstrapRetainer;
  retain(point?: BootstrapRetentionDeathPointV1): Promise<BootstrapJournalRecordV1>;
}

function retentionFixture(options: {
  readonly outcome?: "finalized" | "rolled_back";
  readonly bootstrapReleaseFailures?: number;
  readonly globalReleaseFailures?: number;
  readonly helperStatusLoss?: boolean;
  readonly journalFailures?: number;
  readonly syncFailures?: number;
} = {}): RetentionFixture {
  const rows = table();
  const projections = new Map<string, BootstrapRetentionPostimageV1>();
  for (const row of rows) {
    projections.set(row.sourcePath, structuredClone(row.postimage));
    projections.set(row.parent.path, parentProjection(row));
  }
  const reserved = path(`/synthetic/state/.developer-os-retained.${ID}.0000000042.tombstone`);
  projections.set(reserved, regular("reserved", "999"));
  const events: string[] = [];
  const renameRequests: BootstrapRetentionEntryV1[] = [];
  let helperStatusLoss = options.helperStatusLoss ?? false;
  let journalFailures = options.journalFailures ?? 0;
  let syncFailures = options.syncFailures ?? 0;
  let bootstrapReleaseFailures = options.bootstrapReleaseFailures ?? 0;
  let globalReleaseFailures = options.globalReleaseFailures ?? 0;
  let current = terminalJournal(options.outcome);
  const released = { bootstrap: 0, global: 0 };
  const lock = (kind: keyof typeof released): TransactionLockHandle => {
    let releasedOnce = false;
    return { release: () => {
      if (releasedOnce) return Promise.reject(new Error(`synthetic ${kind} lock released twice`));
      releasedOnce = true;
      released[kind] += 1;
      events.push(`release:${kind}-lock`);
      const failures = kind === "bootstrap" ? bootstrapReleaseFailures : globalReleaseFailures;
      if (failures > 0) {
        if (kind === "bootstrap") bootstrapReleaseFailures -= 1;
        else globalReleaseFailures -= 1;
        return Promise.reject(new Error(`synthetic ${kind} release status loss`));
      }
      return Promise.resolve();
    } };
  };
  const freshLocks = (): HeldBootstrapLocksV1 => ({
    bootstrap: lock("bootstrap"),
    global: lock("global"),
  });
  const locks = freshLocks();
  const store = {
    current: () => structuredClone(current),
    advance: (successor: BootstrapJournalRecordV1) => {
      const previous = current;
      if (journalFailures > 0 && previous.phase === "retaining") {
        journalFailures -= 1;
        events.push("journal:failure");
        return Promise.reject(new Error("synthetic journal failure"));
      }
      const cursor = previous.phase === "retaining" ? previous.retentionNext : null;
      const row = cursor === null ? undefined : rows[cursor];
      events.push(row === undefined ? "journal:enter-retaining" : `journal:advance-${row.role}`);
      current = structuredClone(successor);
      return Promise.resolve();
    },
  } as unknown as BootstrapJournalStore;

  const buildRetainer = (point?: BootstrapRetentionDeathPointV1): BootstrapRetainer => {
    let interrupted = false;
    const renameSameParentNoReplace: RenameSameParentNoReplace = (request) => {
      const row = request.entry;
      renameRequests.push(row);
      events.push(`rename:${row.role}`);
      const source = projections.get(row.sourcePath);
      if (source === undefined || projections.has(row.tombstonePath)) {
        return Promise.reject(new Error("synthetic rename third state"));
      }
      projections.delete(row.sourcePath);
      projections.set(row.tombstonePath, source);
      if (helperStatusLoss) {
        helperStatusLoss = false;
        return Promise.reject(new Error("synthetic helper status loss"));
      }
      return Promise.resolve();
    };
    return new BootstrapRetainer({
      renameSameParentNoReplace,
      projectPostimage: (candidate) => {
        const projection = projections.get(candidate);
        return Promise.resolve(projection === undefined ? null : structuredClone(projection));
      },
      syncDirectory: (candidate) => {
        const row = rows.filter((value) =>
          value.parent.path === candidate &&
          !projections.has(value.sourcePath) &&
          projections.has(value.tombstonePath),
        ).at(-1);
        events.push(`sync:${row?.role ?? "parent"}`);
        if (syncFailures > 0) {
          syncFailures -= 1;
          return Promise.reject(new Error("synthetic sync failure"));
        }
        return Promise.resolve();
      },
      interrupt: (candidate) => {
        if (!interrupted && candidate === point) {
          interrupted = true;
          throw new SyntheticDeath(candidate);
        }
      },
    });
  };

  const fixture: RetentionFixture = {
    rows,
    projections,
    events,
    renameRequests,
    store,
    locks,
    released,
    retainer: buildRetainer,
    retain: (point) => retainBootstrapEnvelope(rows, store, buildRetainer(point), freshLocks()),
  };
  return fixture;
}

function inventory(fixture: RetentionFixture): readonly [string, BootstrapRetentionPostimageV1][] {
  return [...fixture.projections.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidate, projection]) => [candidate, structuredClone(projection)] as const);
}

afterEach(async () => {
  fsRaceControl.afterLstat = undefined;
  fsRaceControl.failClosePath = undefined;
  await Promise.all([...roots].map(async (root) => {
    await nodeFs.rm(root, { recursive: true, force: true });
    roots.delete(root);
  }));
});

describe("BootstrapRetainer exact two-state observation", () => {
  it("observes the exact source-only state as before", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;

    await expect(fixture.retainer().observe(row)).resolves.toEqual({
      state: "before",
      source: row.postimage,
    } satisfies BootstrapRetentionObservationV1);
  });

  it("observes the exact tombstone-only state as after", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;
    const source = fixture.projections.get(row.sourcePath) as BootstrapRetentionPostimageV1;
    fixture.projections.delete(row.sourcePath);
    fixture.projections.set(row.tombstonePath, source);

    await expect(fixture.retainer().observe(row)).resolves.toEqual({
      state: "after",
      tombstone: row.postimage,
    } satisfies BootstrapRetentionObservationV1);
  });

  it.each([
    ["both names", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      fixture.projections.set(row.tombstonePath, structuredClone(row.postimage));
    }],
    ["neither name", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      fixture.projections.delete(row.sourcePath);
    }],
    ["changed source identity", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      fixture.projections.set(row.sourcePath, { ...row.postimage, ino: parseUInt64Decimal("777") });
    }],
    ["wrong destination identity", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      fixture.projections.delete(row.sourcePath);
      fixture.projections.set(row.tombstonePath, {
        ...row.postimage,
        ino: parseUInt64Decimal("777"),
      });
    }],
    ["wrong destination content", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      if (row.postimage.kind !== "regular_file") throw new Error("expected regular-file fixture row");
      fixture.projections.delete(row.sourcePath);
      fixture.projections.set(row.tombstonePath, {
        ...row.postimage,
        sha256: hash("wrong"),
      });
    }],
    ["changed parent identity", (fixture: RetentionFixture, row: BootstrapRetentionEntryV1) => {
      fixture.projections.set(row.parent.path, parentProjection({
        ...row,
        parent: { ...row.parent, ino: parseUInt64Decimal("777") },
      }));
    }],
  ] as const)("refuses %s without changing either name", async (_name, mutate) => {
    const fixture = retentionFixture();
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;
    mutate(fixture, row);
    const before = inventory(fixture);

    await expect(fixture.retainer().retain(row)).rejects.toBeInstanceOf(BootstrapStateError);
    expect(inventory(fixture)).toEqual(before);
    expect(fixture.renameRequests).toHaveLength(0);
  });

  it("refuses an extra or altered directory descendant before rename", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[1] as BootstrapRetentionEntryV1;
    fixture.projections.set(row.sourcePath, tree("201", {
      entryCount: 3,
      regularFileBytes: parseUInt64Decimal("5"),
      treeHash: hash("tree-with-extra-child"),
    }));
    const before = inventory(fixture);

    await expect(fixture.retainer().retain(row)).rejects.toBeInstanceOf(BootstrapStateError);
    expect(inventory(fixture)).toEqual(before);
    expect(fixture.renameRequests).toHaveLength(0);
  });

  it("refuses an altered directory descendant after rename and preserves the destination", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[1] as BootstrapRetentionEntryV1;
    fixture.projections.delete(row.sourcePath);
    fixture.projections.set(row.tombstonePath, tree("201", {
      entryCount: 3,
      regularFileBytes: parseUInt64Decimal("5"),
      treeHash: hash("tree-with-extra-child"),
    }));
    const before = inventory(fixture);

    await expect(fixture.retainer().retain(row)).rejects.toBeInstanceOf(BootstrapStateError);
    expect(inventory(fixture)).toEqual(before);
    expect(fixture.renameRequests).toHaveLength(0);
  });
});

describe("BootstrapRetainer retention mutation", () => {
  it("renames a before row exactly once, reprojects exact after, and syncs its guarded parent", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;

    await fixture.retainer().retain(row);

    expect(fixture.renameRequests).toEqual([row]);
    expect(fixture.projections.has(row.sourcePath)).toBe(false);
    expect(fixture.projections.get(row.tombstonePath)).toEqual(row.postimage);
    expect(fixture.events).toEqual(["rename:payload", "sync:payload"]);
  });

  it("renames a maximal directory-tree row exactly once and preserves its complete projection", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[1] as BootstrapRetentionEntryV1;

    await fixture.retainer().retain(row);

    expect(fixture.renameRequests).toEqual([row]);
    expect(fixture.projections.has(row.sourcePath)).toBe(false);
    expect(fixture.projections.get(row.tombstonePath)).toEqual(row.postimage);
    expect(fixture.events).toEqual(["rename:staging_subtree", "sync:staging_subtree"]);
  });

  it("adopts an exact after row without invoking rename and still syncs the parent", async () => {
    const fixture = retentionFixture();
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;
    const source = fixture.projections.get(row.sourcePath) as BootstrapRetentionPostimageV1;
    fixture.projections.delete(row.sourcePath);
    fixture.projections.set(row.tombstonePath, source);

    await fixture.retainer().retain(row);

    expect(fixture.renameRequests).toHaveLength(0);
    expect(fixture.events).toEqual(["sync:payload"]);
  });

  it("preserves the exact after state for recovery when parent sync fails", async () => {
    const fixture = retentionFixture({ syncFailures: 1 });
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;

    await expect(fixture.retainer().retain(row)).rejects.toThrow("synthetic sync failure");
    expect(fixture.projections.has(row.sourcePath)).toBe(false);
    expect(fixture.projections.get(row.tombstonePath)).toEqual(row.postimage);
    await expect(fixture.retainer().retain(row)).resolves.toBeUndefined();
    expect(fixture.renameRequests).toHaveLength(1);
  });

  it("adopts the exact after state when the helper loses status after the rename", async () => {
    const fixture = retentionFixture({ helperStatusLoss: true });
    const row = fixture.rows[0] as BootstrapRetentionEntryV1;

    await expect(fixture.retainer().retain(row)).rejects.toThrow("synthetic helper status loss");
    expect(fixture.projections.get(row.tombstonePath)).toEqual(row.postimage);
    await expect(fixture.retainer().retain(row)).resolves.toBeUndefined();
    expect(fixture.renameRequests).toHaveLength(1);
  });
});

export const retentionDeathPoints = [
  "before_rename",
  "after_rename",
  "after_projection",
  "before_parent_sync",
  "after_parent_sync",
  "before_journal_advance",
  "after_journal_advance",
  "before_lock_release",
  "after_lock_release",
] as const satisfies readonly BootstrapRetentionDeathPointV1[];

describe("retainBootstrapEnvelope crash convergence and lock ordering", () => {
  it.each(retentionDeathPoints)("resumes %s from exactly one legal row state", async (point) => {
    const fixture = retentionFixture();

    await expect(fixture.retain(point)).rejects.toBeInstanceOf(SyntheticDeath);
    const result = await fixture.retain();

    expect(result.phase).toBe("retained");
    for (const row of fixture.rows) {
      expect(fixture.projections.has(row.sourcePath)).toBe(false);
      expect(fixture.projections.get(row.tombstonePath)).toEqual(row.postimage);
    }
  });

  it.each(["finalized", "rolled_back"] as const)("retains a completed %s table", async (outcome) => {
    const fixture = retentionFixture({ outcome });

    await expect(fixture.retain()).resolves.toMatchObject({
      phase: "retained",
      terminalOutcome: outcome,
      direction: outcome === "finalized" ? "forward" : "compensating",
    });
    expect(fixture.renameRequests.map((request) => request.ordinal)).toEqual([0, 1, 2]);
  });

  it("renames first and last ordinals from the supplied table and no reserved matching name", async () => {
    const fixture = retentionFixture();
    const reserved = `/synthetic/state/.developer-os-retained.${ID}.0000000042.tombstone`;

    await fixture.retain();

    expect(fixture.renameRequests.at(0)?.ordinal).toBe(0);
    expect(fixture.renameRequests.at(-1)?.ordinal).toBe(2);
    expect(fixture.projections.get(reserved)).toEqual(regular("reserved", "999"));
    expect(fixture.renameRequests.some((request) => request.sourcePath === reserved)).toBe(false);
  });

  it("adopts an exact after row when journal advance previously failed", async () => {
    const fixture = retentionFixture({ journalFailures: 1 });

    await expect(fixture.retain()).rejects.toThrow("synthetic journal failure");
    expect(fixture.renameRequests).toHaveLength(1);
    await expect(fixture.retain()).resolves.toMatchObject({ phase: "retained" });
    expect(fixture.renameRequests.filter((request) => request.ordinal === 0)).toHaveLength(1);
  });

  it("reacquires fresh one-shot locks after bootstrap release status loss", async () => {
    const fixture = retentionFixture({ bootstrapReleaseFailures: 1 });

    await expect(fixture.retain()).rejects.toThrow("synthetic bootstrap release status loss");
    expect(fixture.store.current().phase).toBe("retained");
    await expect(fixture.retain()).resolves.toMatchObject({ phase: "retained" });
    expect(fixture.renameRequests.map((request) => request.ordinal)).toEqual([0, 1, 2]);
    expect(fixture.released).toEqual({ bootstrap: 2, global: 1 });
  });

  it("reacquires fresh one-shot locks after global release status loss", async () => {
    const fixture = retentionFixture({ globalReleaseFailures: 1 });

    await expect(fixture.retain()).rejects.toThrow("synthetic global release status loss");
    expect(fixture.store.current().phase).toBe("retained");
    await expect(fixture.retain()).resolves.toMatchObject({ phase: "retained" });
    expect(fixture.renameRequests.map((request) => request.ordinal)).toEqual([0, 1, 2]);
    expect(fixture.released).toEqual({ bootstrap: 2, global: 2 });
  });

  it("reopens an already-retained journal with fresh locks and no second rename", async () => {
    const fixture = retentionFixture();

    await fixture.retain();
    await expect(fixture.retain()).resolves.toMatchObject({ phase: "retained" });
    expect(fixture.renameRequests.map((request) => request.ordinal)).toEqual([0, 1, 2]);
    expect(fixture.released).toEqual({ bootstrap: 2, global: 2 });
  });

  it("renames and syncs the held bootstrap lock before its durable cursor and release", async () => {
    const fixture = retentionFixture();

    await fixture.retain();

    const expected = [
      "rename:bootstrap_lock",
      "sync:bootstrap_lock",
      "journal:advance-bootstrap_lock",
      "release:bootstrap-lock",
    ];
    expect(expected.map((event) => fixture.events.indexOf(event))).toEqual([
      expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number),
    ]);
    for (let index = 1; index < expected.length; index += 1) {
      expect(fixture.events.indexOf(expected[index] as string)).toBeGreaterThan(
        fixture.events.indexOf(expected[index - 1] as string),
      );
    }
  });

  it("never treats the permanent global lock as a table mutation", async () => {
    const fixture = retentionFixture();

    await fixture.retain();

    expect(fixture.renameRequests.some((request) => request.sourcePath.endsWith("/.lifecycle.lock"))).toBe(false);
    expect(fixture.released).toEqual({ bootstrap: 1, global: 1 });
  });

  it("contains no unlink, rm, rmdir, quarantine, or out-of-parent request", async () => {
    const fixture = retentionFixture();
    const forbiddenMutation = () => {
      throw new Error("forbidden mutation called");
    };
    const renameSameParentNoReplace: RenameSameParentNoReplace = (request) => {
        expect(request.entry.parent.path).toBe(dirname(request.entry.sourcePath));
        expect(request.entry.parent.path).toBe(dirname(request.entry.tombstonePath));
        const source = fixture.projections.get(request.entry.sourcePath);
        if (source === undefined) return Promise.reject(new Error("missing synthetic source"));
        fixture.projections.delete(request.entry.sourcePath);
        fixture.projections.set(request.entry.tombstonePath, source);
        return Promise.resolve();
      };
    const dependencies = {
      renameSameParentNoReplace,
      projectPostimage: (candidate: CanonicalAbsolutePathV1) => Promise.resolve(
        fixture.projections.get(candidate) ?? null,
      ),
      syncDirectory: () => Promise.resolve(),
      forbiddenMutation,
    } satisfies ConstructorParameters<typeof BootstrapRetainer>[0] & {
      readonly forbiddenMutation: () => never;
    };
    const retainer = new BootstrapRetainer(dependencies);

    await retainBootstrapEnvelope(fixture.rows, fixture.store, retainer, fixture.locks);

    expect(fixture.rows.every((request) =>
      request.parent.path === dirname(request.sourcePath) &&
      request.parent.path === dirname(request.tombstonePath),
    )).toBe(true);
  });
});

describe("projectRetainedDirectoryTree", () => {
  it("returns the complete UTF-8-sorted, domain-separated exact descendant projection", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-tree-"));
    roots.add(root);
    const nested = join(root, "nested");
    const first = join(root, "a.bin");
    const second = join(nested, "b.bin");
    await nodeFs.chmod(root, 0o700);
    await nodeFs.mkdir(nested, { mode: 0o700 });
    await nodeFs.writeFile(first, "a", { mode: 0o600 });
    await nodeFs.writeFile(second, "bbb", { mode: 0o600 });
    const [rootStats, nestedStats, firstStats, secondStats] = await Promise.all([
      nodeFs.lstat(root), nodeFs.lstat(nested), nodeFs.lstat(first), nodeFs.lstat(second),
    ]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [
      {
        relativePath: "a.bin", kind: "regular_file", ownerUid: firstStats.uid,
        mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("1"), sha256: hash("a"),
        dev: parseUInt64Decimal(String(firstStats.dev)), ino: parseUInt64Decimal(String(firstStats.ino)),
      },
      {
        relativePath: "nested", kind: "directory", ownerUid: nestedStats.uid,
        mode: 0o700, nlink: nestedStats.nlink, bytes: parseUInt64Decimal("0"), sha256: null,
        dev: parseUInt64Decimal(String(nestedStats.dev)), ino: parseUInt64Decimal(String(nestedStats.ino)),
      },
      {
        relativePath: "nested/b.bin", kind: "regular_file", ownerUid: secondStats.uid,
        mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("3"), sha256: hash("bbb"),
        dev: parseUInt64Decimal(String(secondStats.dev)), ino: parseUInt64Decimal(String(secondStats.ino)),
      },
    ];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 3,
      regularFileBytes: parseUInt64Decimal("4"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };

    await expect(projectRetainedDirectoryTree(path(root), expected)).resolves.toEqual(expected);
  });

  it("refuses a child inserted after the initial directory enumeration", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-insert-race-"));
    roots.add(root);
    await nodeFs.chmod(root, 0o700);
    const known = join(root, "known");
    await nodeFs.writeFile(known, "known", { mode: 0o600 });
    const [rootStats, knownStats] = await Promise.all([nodeFs.lstat(root), nodeFs.lstat(known)]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [{
      relativePath: "known", kind: "regular_file", ownerUid: knownStats.uid,
      mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("5"), sha256: hash("known"),
      dev: parseUInt64Decimal(String(knownStats.dev)), ino: parseUInt64Decimal(String(knownStats.ino)),
    }];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 1,
      regularFileBytes: parseUInt64Decimal("5"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    let rootStatsSeen = 0;
    fsRaceControl.afterLstat = async (candidate) => {
      if (candidate !== root) return;
      rootStatsSeen += 1;
      if (rootStatsSeen === 4) await nodeFs.writeFile(join(root, "extra"), "extra", { mode: 0o600 });
    };

    try {
      await expect(projectRetainedDirectoryTree(path(root), expected)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.afterLstat = undefined;
    }
    expect((await nodeFs.readdir(root)).sort()).toEqual(["extra", "known"]);
  });

  it("refuses directory close status loss after an otherwise exact projection", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-close-loss-"));
    roots.add(root);
    await nodeFs.chmod(root, 0o700);
    const known = join(root, "known");
    await nodeFs.writeFile(known, "known", { mode: 0o600 });
    const [rootStats, knownStats] = await Promise.all([nodeFs.lstat(root), nodeFs.lstat(known)]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [{
      relativePath: "known", kind: "regular_file", ownerUid: knownStats.uid,
      mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("5"), sha256: hash("known"),
      dev: parseUInt64Decimal(String(knownStats.dev)), ino: parseUInt64Decimal(String(knownStats.ino)),
    }];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 1,
      regularFileBytes: parseUInt64Decimal("5"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    fsRaceControl.failClosePath = root;

    try {
      await expect(projectRetainedDirectoryTree(path(root), expected)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.failClosePath = undefined;
    }
    expect(await nodeFs.readdir(root)).toEqual(["known"]);
  });

  it("refuses a child removed after projection but before the directory returns", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-remove-race-"));
    roots.add(root);
    await nodeFs.chmod(root, 0o700);
    const known = join(root, "known");
    await nodeFs.writeFile(known, "known", { mode: 0o600 });
    const [rootStats, knownStats] = await Promise.all([nodeFs.lstat(root), nodeFs.lstat(known)]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [{
      relativePath: "known", kind: "regular_file", ownerUid: knownStats.uid,
      mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("5"), sha256: hash("known"),
      dev: parseUInt64Decimal(String(knownStats.dev)), ino: parseUInt64Decimal(String(knownStats.ino)),
    }];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 1,
      regularFileBytes: parseUInt64Decimal("5"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    let rootStatsSeen = 0;
    fsRaceControl.afterLstat = async (candidate) => {
      if (candidate !== root) return;
      rootStatsSeen += 1;
      if (rootStatsSeen === 4) await nodeFs.unlink(known);
    };

    try {
      await expect(projectRetainedDirectoryTree(path(root), expected)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.afterLstat = undefined;
    }
    expect(await nodeFs.readdir(root)).toEqual([]);
  });

  it("refuses a nested directory swapped after its parent-observed identity", async () => {
    const container = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-swap-race-"));
    roots.add(container);
    const root = join(container, "root");
    const nested = join(root, "nested");
    const replacement = join(container, "replacement");
    const displaced = join(container, "displaced");
    await nodeFs.mkdir(root, { mode: 0o700 });
    await nodeFs.mkdir(nested, { mode: 0o700 });
    await nodeFs.mkdir(replacement, { mode: 0o700 });
    await nodeFs.writeFile(join(nested, "old"), "old", { mode: 0o600 });
    const replacementFile = join(replacement, "data");
    await nodeFs.writeFile(replacementFile, "data", { mode: 0o600 });
    const [rootStats, nestedStats, replacementFileStats] = await Promise.all([
      nodeFs.lstat(root), nodeFs.lstat(nested), nodeFs.lstat(replacementFile),
    ]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [
      {
        relativePath: "nested", kind: "directory", ownerUid: nestedStats.uid,
        mode: 0o700, nlink: nestedStats.nlink, bytes: parseUInt64Decimal("0"), sha256: null,
        dev: parseUInt64Decimal(String(nestedStats.dev)), ino: parseUInt64Decimal(String(nestedStats.ino)),
      },
      {
        relativePath: "nested/data", kind: "regular_file", ownerUid: replacementFileStats.uid,
        mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("4"), sha256: hash("data"),
        dev: parseUInt64Decimal(String(replacementFileStats.dev)),
        ino: parseUInt64Decimal(String(replacementFileStats.ino)),
      },
    ];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 2,
      regularFileBytes: parseUInt64Decimal("4"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    let swapped = false;
    fsRaceControl.afterLstat = async (candidate) => {
      if (candidate !== nested || swapped) return;
      swapped = true;
      await nodeFs.rename(nested, displaced);
      await nodeFs.rename(replacement, nested);
    };

    try {
      await expect(projectRetainedDirectoryTree(path(root), expected)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.afterLstat = undefined;
    }
    expect((await nodeFs.readdir(nested)).sort()).toEqual(["data"]);
  });

  it("refuses a same-name regular-file replacement after its final identity check before rename", async () => {
    const container = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-file-replacement-"));
    roots.add(container);
    const root = join(container, "root");
    const known = join(root, "known");
    const replacement = join(container, "replacement");
    const displaced = join(container, "displaced");
    await nodeFs.mkdir(root, { mode: 0o700 });
    await nodeFs.writeFile(known, "known", { mode: 0o600 });
    await nodeFs.writeFile(replacement, "other", { mode: 0o600 });
    const [rootStats, knownStats] = await Promise.all([nodeFs.lstat(root), nodeFs.lstat(known)]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [{
      relativePath: "known", kind: "regular_file", ownerUid: knownStats.uid,
      mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("5"), sha256: hash("known"),
      dev: parseUInt64Decimal(String(knownStats.dev)), ino: parseUInt64Decimal(String(knownStats.ino)),
    }];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 1,
      regularFileBytes: parseUInt64Decimal("5"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    const row = entry(0, "staging_subtree", path(root), expected);
    let knownStatsSeen = 0;
    let renameCalls = 0;
    fsRaceControl.afterLstat = async (candidate) => {
      if (candidate !== known) return;
      knownStatsSeen += 1;
      if (knownStatsSeen !== 2) return;
      await nodeFs.rename(known, displaced);
      await nodeFs.rename(replacement, known);
    };
    const retainer = new BootstrapRetainer({
      renameSameParentNoReplace: () => {
        renameCalls += 1;
        return Promise.resolve();
      },
      projectPostimage: (candidate) => {
        if (candidate === row.parent.path) return Promise.resolve(parentProjection(row));
        if (candidate === row.sourcePath) return projectRetainedDirectoryTree(path(root), expected);
        return Promise.resolve(null);
      },
      syncDirectory: () => Promise.resolve(),
    });

    try {
      await expect(retainer.retain(row)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.afterLstat = undefined;
    }
    expect(renameCalls).toBe(0);
    expect(await nodeFs.readdir(root)).toEqual(["known"]);
    await expect(nodeFs.lstat(row.tombstonePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a same-name nested-directory replacement after recursion returns before rename", async () => {
    const container = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-directory-replacement-"));
    roots.add(container);
    const root = join(container, "root");
    const nested = join(root, "nested");
    const nestedFile = join(nested, "data");
    const replacement = join(container, "replacement");
    const displaced = join(container, "displaced");
    await nodeFs.mkdir(root, { mode: 0o700 });
    await nodeFs.mkdir(nested, { mode: 0o700 });
    await nodeFs.mkdir(replacement, { mode: 0o700 });
    await nodeFs.writeFile(nestedFile, "data", { mode: 0o600 });
    await nodeFs.writeFile(join(replacement, "data"), "evil", { mode: 0o600 });
    const [rootStats, nestedStats, nestedFileStats] = await Promise.all([
      nodeFs.lstat(root), nodeFs.lstat(nested), nodeFs.lstat(nestedFile),
    ]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [
      {
        relativePath: "nested", kind: "directory", ownerUid: nestedStats.uid,
        mode: 0o700, nlink: nestedStats.nlink, bytes: parseUInt64Decimal("0"), sha256: null,
        dev: parseUInt64Decimal(String(nestedStats.dev)), ino: parseUInt64Decimal(String(nestedStats.ino)),
      },
      {
        relativePath: "nested/data", kind: "regular_file", ownerUid: nestedFileStats.uid,
        mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("4"), sha256: hash("data"),
        dev: parseUInt64Decimal(String(nestedFileStats.dev)),
        ino: parseUInt64Decimal(String(nestedFileStats.ino)),
      },
    ];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 2,
      regularFileBytes: parseUInt64Decimal("4"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };
    const row = entry(0, "staging_subtree", path(root), expected);
    let rootStatsSeen = 0;
    let renameCalls = 0;
    fsRaceControl.afterLstat = async (candidate) => {
      if (candidate !== root) return;
      rootStatsSeen += 1;
      if (rootStatsSeen !== 3) return;
      await nodeFs.rename(nested, displaced);
      await nodeFs.rename(replacement, nested);
    };
    const retainer = new BootstrapRetainer({
      renameSameParentNoReplace: () => {
        renameCalls += 1;
        return Promise.resolve();
      },
      projectPostimage: (candidate) => {
        if (candidate === row.parent.path) return Promise.resolve(parentProjection(row));
        if (candidate === row.sourcePath) return projectRetainedDirectoryTree(path(root), expected);
        return Promise.resolve(null);
      },
      syncDirectory: () => Promise.resolve(),
    });

    try {
      await expect(retainer.retain(row)).rejects.toBeInstanceOf(BootstrapStateError);
    } finally {
      fsRaceControl.afterLstat = undefined;
    }
    expect(renameCalls).toBe(0);
    expect(await nodeFs.readdir(root)).toEqual(["nested"]);
    expect(await nodeFs.readdir(nested)).toEqual(["data"]);
    await expect(nodeFs.lstat(row.tombstonePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an extra descendant and preserves the complete directory", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-retained-extra-"));
    roots.add(root);
    await nodeFs.chmod(root, 0o700);
    const known = join(root, "known");
    await nodeFs.writeFile(known, "known", { mode: 0o600 });
    const [rootStats, knownStats] = await Promise.all([nodeFs.lstat(root), nodeFs.lstat(known)]);
    const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [{
      relativePath: "known", kind: "regular_file", ownerUid: knownStats.uid,
      mode: 0o600, nlink: 1, bytes: parseUInt64Decimal("5"), sha256: hash("known"),
      dev: parseUInt64Decimal(String(knownStats.dev)), ino: parseUInt64Decimal(String(knownStats.ino)),
    }];
    const expected = {
      kind: "directory_tree" as const,
      ownerUid: rootStats.uid,
      mode: 0o700 as const,
      nlink: rootStats.nlink,
      treeHash: parseLowerHexSha256(createHash("sha256")
        .update("developer-os/bootstrap-retained-tree/v1\0")
        .update(encodeCanonicalJson(entries).slice(0, -1))
        .digest("hex")),
      entryCount: 1,
      regularFileBytes: parseUInt64Decimal("5"),
      dev: parseUInt64Decimal(String(rootStats.dev)),
      ino: parseUInt64Decimal(String(rootStats.ino)),
      entries,
    };

    await expect(projectRetainedDirectoryTree(path(root), expected)).resolves.toEqual(expected);
    await nodeFs.writeFile(join(root, "extra"), "extra", { mode: 0o600 });
    const namesBefore = (await nodeFs.readdir(root)).sort();

    await expect(projectRetainedDirectoryTree(path(root), expected)).rejects.toBeInstanceOf(BootstrapStateError);
    expect((await nodeFs.readdir(root)).sort()).toEqual(namesBefore);
  });
});
