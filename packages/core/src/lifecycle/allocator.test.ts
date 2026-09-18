import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal } from "../update/scalars.js";
import {
  cleanLifecycleAllocatorTemp,
  inspectLifecycleAllocator,
  reserveLifecycleIdBlock,
  type LifecycleAllocatorBoundaryV1,
} from "./allocator.js";
import { LifecycleRecoveryRequiredError, createNodeLifecycleGuardedFileSystem } from "./guarded-fs.js";
import type { LifecycleGuardedFileSystemV1 } from "./guarded-fs.js";
import { formatAllocatedLifecycleId } from "./ids.js";
import { LifecycleLockShapeError, type HeldLifecycleStableLockV1 } from "./locks.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import { createLinkUnlinkRenameNoReplace } from "./testing.js";

const encoder = new TextEncoder();
const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("3f".repeat(32));
const OTHER_NONCE = parseLowerHexSha256("7c".repeat(32));
const UINT64_MAX_TEXT = "18446744073709551615";
const roots: string[] = [];

class SyntheticDeath extends Error {
  constructor(boundary: LifecycleAllocatorBoundaryV1) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

function dieAt(target: LifecycleAllocatorBoundaryV1): (boundary: LifecycleAllocatorBoundaryV1) => void {
  return (boundary) => {
    if (boundary === target) throw new SyntheticDeath(boundary);
  };
}

function allocatorBytes(nonce: string, nextCounter: string): Uint8Array {
  return encoder.encode(
    encodeLifecycleIdAllocator({
      schemaVersion: 1,
      installNonce: parseLowerHexSha256(nonce),
      nextCounter: parseUInt64Decimal(nextCounter),
    }),
  );
}

interface LifecycleHomeV1 {
  readonly state: CanonicalAbsolutePathV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly held: HeldLifecycleStableLockV1;
  readonly dependencies: {
    readonly fs: LifecycleGuardedFileSystemV1;
    readonly stateDirectory: CanonicalAbsolutePathV1;
    readonly effectiveUid: number;
    readonly uuid: () => string;
    readonly held: HeldLifecycleStableLockV1;
    readonly allocatedIds: readonly string[];
  };
}

async function freshLifecycleHome(
  options: { readonly nextCounter: string; readonly allocatorNonce?: string } = { nextCounter: "0" },
): Promise<LifecycleHomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-allocator-"));
  roots.push(created);
  await nodeFs.chmod(created, 0o700);
  const state = parseCanonicalAbsolutePathText(join(created, "state"));
  await nodeFs.mkdir(state, { mode: 0o700 });
  await nodeFs.writeFile(join(state, "lifecycle-install-nonce"), `${NONCE}\n`, { mode: 0o600 });
  await nodeFs.writeFile(
    join(state, "lifecycle-id-allocator.json"),
    allocatorBytes(options.allocatorNonce ?? NONCE, options.nextCounter),
    { mode: 0o600 },
  );
  await nodeFs.writeFile(join(state, ".lifecycle.lock"), "", { mode: 0o600 });

  const lock = await nodeFs.lstat(join(state, ".lifecycle.lock"), { bigint: true });
  const held: HeldLifecycleStableLockV1 = {
    path: parseCanonicalAbsolutePathText(join(state, ".lifecycle.lock")),
    dev: parseUInt64Decimal(lock.dev.toString(10)),
    ino: parseUInt64Decimal(lock.ino.toString(10)),
    release: () => Promise.resolve(),
  };
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: UID,
  });
  return {
    state,
    fs,
    held,
    dependencies: {
      fs,
      stateDirectory: state,
      effectiveUid: UID,
      uuid: () => randomUUID(),
      held,
      allocatedIds: [],
    },
  };
}

async function stateNames(state: CanonicalAbsolutePathV1): Promise<readonly string[]> {
  return (await nodeFs.readdir(state)).sort();
}

async function reasonOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) return error.reason;
    return `unexpected:${String(error)}`;
  }
  return "resolved";
}

function tempName(uuid: string): string {
  return `.lifecycle-id-allocator.${uuid}.json.tmp`;
}

describe("the install-scoped ID allocator", () => {
  it("advances the allocator durably before exposing any ID", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });

    await expect(
      reserveLifecycleIdBlock({ ...home.dependencies, afterBoundary: dieAt("renamed") }, 4),
    ).rejects.toThrow(SyntheticDeath);

    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).allocator.nextCounter).toBe("7");
    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).temp).toBeNull();
    expect((await reserveLifecycleIdBlock(home.dependencies, 1)).firstCounter).toBe(7n);
  });

  it("consumes the block and leaves a legal gap when death follows the state sync", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });

    await expect(
      reserveLifecycleIdBlock({ ...home.dependencies, afterBoundary: dieAt("state_synced") }, 4),
    ).rejects.toThrow(SyntheticDeath);

    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);
    expect(state.allocator.nextCounter).toBe("7");
    expect(state.temp).toBeNull();
    expect((await reserveLifecycleIdBlock(home.dependencies, 2)).firstCounter).toBe(7n);
  });

  it.each(["temp_created", "temp_written", "temp_synced", "old_rechecked"] as const)(
    "leaves the old counter authoritative and one cleanable temp after death at %s",
    async (boundary) => {
      const home = await freshLifecycleHome({ nextCounter: "3" });

      await expect(
        reserveLifecycleIdBlock({ ...home.dependencies, afterBoundary: dieAt(boundary) }, 4),
      ).rejects.toThrow(SyntheticDeath);

      const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);
      expect(state.allocator.nextCounter).toBe("3");
      expect(state.temp).not.toBeNull();
      expect((await cleanLifecycleAllocatorTemp(home.fs, state, home.held, [])).temp).toBeNull();
      expect(await stateNames(home.state)).toStrictEqual([
        ".lifecycle.lock",
        "lifecycle-id-allocator.json",
        "lifecycle-install-nonce",
      ]);
      expect((await reserveLifecycleIdBlock(home.dependencies, 1)).firstCounter).toBe(3n);
    },
  );

  it("names the temp exactly .lifecycle-id-allocator.<lowercase-v4-uuid>.json.tmp", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();

    await expect(
      reserveLifecycleIdBlock(
        { ...home.dependencies, uuid: () => uuid, afterBoundary: dieAt("temp_created") },
        4,
      ),
    ).rejects.toThrow(SyntheticDeath);

    expect(await stateNames(home.state)).toContain(tempName(uuid));
    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).temp?.path).toBe(
      join(home.state, tempName(uuid)),
    );
  });

  it("refuses a uuid that is not a lowercase v4 before any temp exists", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });

    for (const uuid of ["NOT-A-UUID", randomUUID().toUpperCase(), ""]) {
      await expect(reserveLifecycleIdBlock({ ...home.dependencies, uuid: () => uuid }, 1)).rejects.toThrow();
    }
    expect(await stateNames(home.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);
  });

  it.each([
    ["an empty temp", new Uint8Array(0)],
    ["a partial temp", encoder.encode('{"installNonce":"')],
    ["a complete temp", allocatorBytes(NONCE, "7")],
  ])("cleans %s under an unchanged old authority", async (_label, bytes) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();
    await nodeFs.writeFile(join(home.state, tempName(uuid)), bytes, { mode: 0o600 });

    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);
    expect(state.temp?.size).toBe(String(bytes.byteLength));
    expect((await cleanLifecycleAllocatorTemp(home.fs, state, home.held, [])).temp).toBeNull();
    expect(await stateNames(home.state)).not.toContain(tempName(uuid));
  });

  it("refuses two temps and deletes neither", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const first = tempName(randomUUID());
    const second = tempName(randomUUID());
    await nodeFs.writeFile(join(home.state, first), "", { mode: 0o600 });
    await nodeFs.writeFile(join(home.state, second), "", { mode: 0o600 });

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(
      "lifecycle_allocator_temp_count",
    );
    expect(await stateNames(home.state)).toContain(first);
    expect(await stateNames(home.state)).toContain(second);
  });

  it.each([
    [".lifecycle-id-allocator.json.tmp"],
    [".lifecycle-id-allocator..json.tmp"],
    [`.lifecycle-id-allocator.${randomUUID().toUpperCase()}.json.tmp`],
    [`.lifecycle-id-allocator.${randomUUID()}.json`],
    [`.lifecycle-id-allocator.${randomUUID()}.json.tmp.tmp`],
    [".lifecycle-id-allocator.00000000-0000-1000-8000-000000000000.json.tmp"],
  ])("refuses the reserved-prefix name %s and deletes nothing", async (name) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await nodeFs.writeFile(join(home.state, name), "", { mode: 0o600 });

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(
      "lifecycle_allocator_temp_name",
    );
    expect(await stateNames(home.state)).toContain(name);
  });

  it.each([
    ["1,025 bytes", async (path: string): Promise<void> => nodeFs.writeFile(path, "x".repeat(1025), { mode: 0o600 })],
    ["mode 0644", async (path: string): Promise<void> => nodeFs.writeFile(path, "", { mode: 0o644 })],
    [
      "a symlink",
      async (path: string): Promise<void> => nodeFs.symlink(`${path}.target`, path),
    ],
    [
      "nlink 2",
      async (path: string): Promise<void> => {
        const source = join(path, "..", "hardlink-source");
        await nodeFs.writeFile(source, "", { mode: 0o600 });
        await nodeFs.link(source, path);
      },
    ],
  ])("refuses a temp with %s and deletes nothing", async (_label, create) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const name = tempName(randomUUID());
    await create(join(home.state, name));

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(
      "lifecycle_allocator_temp_shape",
    );
    expect(await stateNames(home.state)).toContain(name);
  });

  it("refuses a nonce and allocator that disagree", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3", allocatorNonce: OTHER_NONCE });

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(
      "lifecycle_id_allocator_bytes",
    );
  });

  it.each([
    ["an absent nonce", "lifecycle-install-nonce", "lifecycle_install_nonce_shape"],
    ["an absent allocator", "lifecycle-id-allocator.json", "lifecycle_id_allocator_shape"],
  ])("refuses %s", async (_label, leaf, reason) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await nodeFs.rm(join(home.state, leaf));

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(reason);
  });

  it("refuses an allocator counter at or below a surviving allocated ID", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const surviving = formatAllocatedLifecycleId("tx", NONCE, 3n);
    const legal = formatAllocatedLifecycleId("lc", NONCE, 2n);

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, [surviving]))).toBe(
      "lifecycle_allocator_counter_rewind",
    );
    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [legal])).allocator.nextCounter).toBe("3");
  });

  it("refuses a surviving legacy transaction ID through the typed class", async () => {
    const home = await freshLifecycleHome({ nextCounter: "9" });
    const legacy = `tx_${randomUUID()}`;

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, [legacy]))).toBe(
      "lifecycle_allocated_id_grammar",
    );
    expect(
      await reasonOf(() => reserveLifecycleIdBlock({ ...home.dependencies, allocatedIds: [legacy] }, 1)),
    ).toBe("lifecycle_allocated_id_grammar");
  });

  it("refuses to reserve a block at or below a surviving allocated ID", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const surviving = formatAllocatedLifecycleId("tx", NONCE, 3n);

    expect(
      await reasonOf(() =>
        reserveLifecycleIdBlock({ ...home.dependencies, allocatedIds: [surviving] }, 1),
      ),
    ).toBe("lifecycle_allocator_counter_rewind");
    expect(await stateNames(home.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);
  });

  it("refuses a surviving allocated ID from another installation epoch", async () => {
    const home = await freshLifecycleHome({ nextCounter: "9" });
    const foreign = formatAllocatedLifecycleId("tx", OTHER_NONCE, 1n);

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, [foreign]))).toBe(
      "lifecycle_allocated_id_nonce",
    );
  });

  it("refuses a final allocator whose identity was replaced since the inspection", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();
    await nodeFs.writeFile(join(home.state, tempName(uuid)), "", { mode: 0o600 });
    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);

    const final = join(home.state, "lifecycle-id-allocator.json");
    await nodeFs.rm(final);
    await nodeFs.writeFile(final, allocatorBytes(NONCE, "3"), { mode: 0o600 });

    expect(await reasonOf(() => cleanLifecycleAllocatorTemp(home.fs, state, home.held, []))).toBe(
      "lifecycle_allocator_identity_changed",
    );
    expect(await stateNames(home.state)).toContain(tempName(uuid));
  });

  it("refuses a final allocator rewritten in place, keeping its inode and its byte length", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();
    await nodeFs.writeFile(join(home.state, tempName(uuid)), "", { mode: 0o600 });
    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);

    const final = join(home.state, "lifecycle-id-allocator.json");
    const before = await nodeFs.lstat(final, { bigint: true });
    const handle = await nodeFs.open(final, "r+");
    await handle.write(allocatorBytes(NONCE, "4"), 0, undefined, 0);
    await handle.close();
    const after = await nodeFs.lstat(final, { bigint: true });

    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(await reasonOf(() => cleanLifecycleAllocatorTemp(home.fs, state, home.held, []))).toBe(
      "lifecycle_allocator_identity_changed",
    );
    expect(await stateNames(home.state)).toContain(tempName(uuid));
  });

  it("refuses recovery when the state directory itself was replaced, and deletes nothing", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();
    await nodeFs.writeFile(join(home.state, tempName(uuid)), "", { mode: 0o600 });
    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);

    const moved = `${home.state}-moved`;
    await nodeFs.rename(home.state, moved);
    await nodeFs.mkdir(home.state, { mode: 0o700 });
    for (const name of await stateNames(parseCanonicalAbsolutePathText(moved))) {
      await nodeFs.copyFile(join(moved, name), join(home.state, name));
      await nodeFs.chmod(join(home.state, name), 0o600);
    }

    await expect(cleanLifecycleAllocatorTemp(home.fs, state, home.held, [])).rejects.toThrow(
      LifecycleRecoveryRequiredError,
    );
    expect(await stateNames(home.state)).toContain(tempName(uuid));
  });

  it("refuses a temp whose identity was replaced since the inspection", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    const uuid = randomUUID();
    const temp = join(home.state, tempName(uuid));
    await nodeFs.writeFile(temp, "", { mode: 0o600 });
    const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);

    await nodeFs.rm(temp);
    await nodeFs.writeFile(temp, "", { mode: 0o600 });

    expect(await reasonOf(() => cleanLifecycleAllocatorTemp(home.fs, state, home.held, []))).toBe(
      "lifecycle_allocator_identity_changed",
    );
    expect(await stateNames(home.state)).toContain(tempName(uuid));
  });

  it.each([
    ["mode 0750", async (state: string): Promise<void> => nodeFs.chmod(state, 0o750)],
    ["a missing directory", async (state: string): Promise<void> => nodeFs.rm(state, { recursive: true })],
  ])("refuses a state directory with %s", async (_label, mutate) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await mutate(home.state);

    expect(await reasonOf(() => inspectLifecycleAllocator(home.fs, home.state, UID, []))).toBe(
      "lifecycle_state_directory_shape",
    );
  });

  it("resumes recovery idempotently after the temp is already gone", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await nodeFs.writeFile(join(home.state, tempName(randomUUID())), "", { mode: 0o600 });

    const cleaned = await cleanLifecycleAllocatorTemp(
      home.fs,
      await inspectLifecycleAllocator(home.fs, home.state, UID, []),
      home.held,
      [],
    );
    expect(cleaned.allocator.nextCounter).toBe("3");
    expect(
      (await cleanLifecycleAllocatorTemp(
        home.fs,
        await inspectLifecycleAllocator(home.fs, home.state, UID, []),
        home.held,
        [],
      )).temp,
    ).toBeNull();
    expect(await stateNames(home.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);
    expect((await reserveLifecycleIdBlock(home.dependencies, 1)).firstCounter).toBe(3n);
  });

  it("refuses to reserve while a pre-rename temp survives", async () => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await nodeFs.writeFile(join(home.state, tempName(randomUUID())), "", { mode: 0o600 });

    expect(await reasonOf(() => reserveLifecycleIdBlock(home.dependencies, 1))).toBe(
      "lifecycle_allocator_temp_present",
    );
  });

  it("refuses an exhausted counter and an overflowing block before any temp exists", async () => {
    const exhausted = await freshLifecycleHome({ nextCounter: UINT64_MAX_TEXT });
    expect(await reasonOf(() => reserveLifecycleIdBlock(exhausted.dependencies, 1))).toBe(
      "lifecycle_allocator_exhausted",
    );
    expect(await stateNames(exhausted.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);

    const nearly = await freshLifecycleHome({ nextCounter: "18446744073709551613" });
    expect(await reasonOf(() => reserveLifecycleIdBlock(nearly.dependencies, 4))).toBe(
      "lifecycle_allocator_overflow",
    );
    expect(await stateNames(nearly.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);
    expect((await reserveLifecycleIdBlock(nearly.dependencies, 2)).firstCounter).toBe(18446744073709551613n);
    expect((await inspectLifecycleAllocator(nearly.fs, nearly.state, UID, [])).allocator.nextCounter).toBe(
      UINT64_MAX_TEXT,
    );
  });

  it.each([[0], [-1], [1.5], [Number.NaN]])("refuses a block of size %s", async (size) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });

    await expect(reserveLifecycleIdBlock(home.dependencies, size)).rejects.toThrow();
    expect(await stateNames(home.state)).toStrictEqual([
      ".lifecycle.lock",
      "lifecycle-id-allocator.json",
      "lifecycle-install-nonce",
    ]);
  });

  it.each([["state/.other.lock"], ["state/transactions/.lifecycle.lock"]])(
    "refuses a hold on %s rather than the exact global lock",
    async (relative) => {
      const home = await freshLifecycleHome({ nextCounter: "3" });
      const held: HeldLifecycleStableLockV1 = {
        ...home.held,
        path: parseCanonicalAbsolutePathText(join(home.state, "..", relative)),
      };

      await expect(reserveLifecycleIdBlock({ ...home.dependencies, held }, 1)).rejects.toThrow(
        LifecycleLockShapeError,
      );
      const state = await inspectLifecycleAllocator(home.fs, home.state, UID, []);
      await expect(cleanLifecycleAllocatorTemp(home.fs, state, held, [])).rejects.toThrow(
        LifecycleLockShapeError,
      );
      expect(await stateNames(home.state)).toStrictEqual([
        ".lifecycle.lock",
        "lifecycle-id-allocator.json",
        "lifecycle-install-nonce",
      ]);
    },
  );

  it("never reissues a collected ID across reservations", async () => {
    const home = await freshLifecycleHome({ nextCounter: "0" });
    const issued = new Set<string>();

    for (const size of [1, 4, 2, 7]) {
      const block = await reserveLifecycleIdBlock(home.dependencies, size);
      expect(block.nonce).toBe(NONCE);
      for (let offset = 0n; offset < BigInt(block.size); offset += 1n) {
        const id = formatAllocatedLifecycleId("tx", block.nonce, block.firstCounter + offset);
        expect(issued.has(id)).toBe(false);
        issued.add(id);
      }
    }

    expect(issued.size).toBe(14);
    expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).allocator.nextCounter).toBe("14");
  });
});
