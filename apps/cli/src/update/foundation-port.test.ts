import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildUpdateFoundationParticipantRef,
  createNodeLifecycleGuardedFileSystem,
  deriveLifecycleLedgerRoots,
  deriveUpdatePayloadPath,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  TransactionExecutor,
  TransactionStore,
  updateFoundationStagedDigestBytes,
  type AllocatedLifecycleIdV1,
  type CanonicalAbsolutePathV1,
  type HeldLifecycleStableLockV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type TransactionLockHandle,
  type TransactionLockProvider,
  type TransactionPhase,
  type UpdateFoundationParticipantRefV2,
  type UpdateFoundationPayloadIdentityV1,
  type UpdatePayloadRefV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { UpdateFoundationPort } from "./foundation-port.js";

const uid = process.getuid?.() ?? 0;
const nonce = "6c".repeat(32);
const coordinatorId = `lc_${nonce}_1` as LifecycleCoordinatorIdV1;
const forwardId = `tx_${nonce}_2` as AllocatedLifecycleIdV1<"tx">;
const createdAt = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const preimage = new TextEncoder().encode("synthetic-owner-file v1\n");
const postimage = new TextEncoder().encode("synthetic-owner-file v2\n");
const recovery = { code: EXIT_CODES.recoveryRequired };

const sha = (bytes: Uint8Array): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));

class SyntheticDeath extends Error {}

class GrantingLocks implements TransactionLockProvider {
  async acquire(path: string): Promise<TransactionLockHandle> {
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "", { mode: 0o600, flag: "a" });
    return { release: (): Promise<void> => Promise.resolve() };
  }
}

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function identityOf(path: string): Promise<UpdateFoundationPayloadIdentityV1> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) };
}

interface PortFixture {
  readonly ref: UpdateFoundationParticipantRefV2;
  readonly target: CanonicalAbsolutePathV1;
  readonly content: UpdatePayloadRefV1;
  readonly port: (dyingPhase?: TransactionPhase) => UpdateFoundationPort;
}

/** One home with construction's rows for one owner ref: content, sidecar, and planned journal. */
async function fixture(label: string): Promise<PortFixture> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  for (const relative of ["state/transactions", "staging/transactions", "backups/transactions", "targets", `staging/lifecycle/${coordinatorId}/update/payloads`, `staging/lifecycle/${coordinatorId}/participants/foundation/${forwardId}`]) {
    await nodeFs.mkdir(join(created, relative), { recursive: true });
    await nodeFs.chmod(join(created, relative), 0o700);
  }
  const home = parseCanonicalAbsolutePathText(created);
  const target = parseCanonicalAbsolutePathText(join(created, "targets", "owner.md"));
  await nodeFs.writeFile(target, preimage, { mode: 0o600 });
  const sidecar = updateFoundationStagedDigestBytes(sha(postimage));
  const payload = (ordinal: number, bytes: Uint8Array): UpdatePayloadRefV1 => ({
    kind: "update_expected", coordinatorId, ordinal, path: deriveUpdatePayloadPath(home, coordinatorId as string as SafeReasonCodeV1, ordinal), bytes: bytes.byteLength, sha256: sha(bytes), mode: 384,
  });
  const content = payload(0, postimage);
  const digest = payload(1, sidecar);
  const { ref, initialJournalBytes } = buildUpdateFoundationParticipantRef({
    productHome: home, coordinatorId, id: forwardId, slot: "owner_forward_files", role: { kind: "forward", compensationId: null },
    mutations: [{ targetPath: target, operation: "replace", expectedBeforeHash: sha(preimage), content, digest }],
    journalOrdinal: 2, createdAt,
  });
  await nodeFs.writeFile(content.path, postimage, { flag: "wx", mode: 0o600 });
  await nodeFs.writeFile(digest.path, sidecar, { flag: "wx", mode: 0o600 });
  await nodeFs.writeFile(ref.initialJournal.staged.path, initialJournalBytes, { flag: "wx", mode: 0o600 });
  // Construction evidence, recorded once at write time exactly as the store would.
  const evidence = new Map<number, UpdateFoundationPayloadIdentityV1>([
    [0, await identityOf(content.path)],
    [1, await identityOf(digest.path)],
    [2, await identityOf(ref.initialJournal.staged.path)],
  ]);
  const globalPath = parseCanonicalAbsolutePathText(join(created, "state", ".lifecycle.lock"));
  await nodeFs.writeFile(globalPath, "", { mode: 0o600 });
  const global: HeldLifecycleStableLockV1 = { path: globalPath, ...(await identityOf(globalPath)), release: () => Promise.resolve() };
  const locks = new GrantingLocks();
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  const port = (dyingPhase?: TransactionPhase): UpdateFoundationPort => new UpdateFoundationPort({
    fs,
    roots: deriveLifecycleLedgerRoots(home),
    executor: new TransactionExecutor({
      stateDir: join(created, "state"),
      stagingDir: join(created, "staging"),
      backupsDir: join(created, "backups"),
      fs: nodeFs,
      clock: () => "2026-09-23T12:00:01.000Z",
      generateId: () => {
        throw new Error("the update Foundation port must not generate an ID");
      },
      guards: { assertTarget: () => Promise.resolve(), redactDiagnostic: (text) => text },
      lockProvider: locks,
      afterPhase: (phase) => {
        if (phase === dyingPhase) throw new SyntheticDeath(phase);
      },
      publishBootstrapInitialJournalNoReplace: async (request) => {
        await nodeFs.link(request.sourcePath, request.destinationPath);
        await nodeFs.unlink(request.sourcePath);
      },
    }),
    store: new TransactionStore({ stateDir: join(created, "state"), fs: nodeFs, lockProvider: locks }),
    global,
    effectiveUid: uid,
    evidence: (ordinal) => {
      const identity = evidence.get(ordinal);
      return identity === undefined ? Promise.reject(new Error("no construction evidence")) : Promise.resolve(identity);
    },
  });
  return { ref, target, content, port };
}

describe("UpdateFoundationPort", () => {
  it("observes all four states: future, partial, committed, and rolled_back", async () => {
    const committed = await fixture("update-foundation-port-committed");
    expect(await committed.port().observe(committed.ref)).toBe("future");
    await committed.port().apply(committed.ref);
    expect(await committed.port().observe(committed.ref)).toBe("committed");
    expect(await nodeFs.readFile(committed.target)).toStrictEqual(Buffer.from(postimage));

    const partial = await fixture("update-foundation-port-partial");
    await expect(partial.port("backed_up").apply(partial.ref)).rejects.toBeInstanceOf(SyntheticDeath);
    expect(await partial.port().observe(partial.ref)).toBe("partial");
    await partial.port().rollback(partial.ref);
    expect(await partial.port().observe(partial.ref)).toBe("rolled_back");
    expect(await nodeFs.readFile(partial.target)).toStrictEqual(Buffer.from(preimage));
  });

  it("resumes an interrupted apply to committed", async () => {
    const { ref, target, port } = await fixture("update-foundation-port-resume");
    await expect(port("validated").apply(ref)).rejects.toBeInstanceOf(SyntheticDeath);
    await port().apply(ref);
    expect(await port().observe(ref)).toBe("committed");
    expect(await nodeFs.readFile(target)).toStrictEqual(Buffer.from(postimage));
  });

  it("compacts a committed ref to nothing and reports it consumed", async () => {
    const { ref, port } = await fixture("update-foundation-port-compact");
    await port().apply(ref);
    expect(await port().consumed(ref)).toBe(false);
    await port().compact(ref);
    expect(await exists(ref.initialJournal.finalPath)).toBe(false);
    expect(await port().consumed(ref)).toBe(true);
    await port().compact(ref);
  });

  it("compacts a never-started ref by removing its construction rows at their evidence inodes", async () => {
    const { ref, content, port } = await fixture("update-foundation-port-future");
    await port().compact(ref);
    expect(await exists(content.path)).toBe(false);
    expect(await exists(ref.initialJournal.staged.path)).toBe(false);
    expect(await port().consumed(ref)).toBe(true);
  });

  it("refuses to compact a non-terminal transaction", async () => {
    const { ref, port } = await fixture("update-foundation-port-nonterminal");
    await expect(port("backed_up").apply(ref)).rejects.toBeInstanceOf(SyntheticDeath);
    await expect(port().compact(ref)).rejects.toMatchObject(recovery);
    expect(await exists(ref.initialJournal.finalPath)).toBe(true);
  });

  it("preserves a construction row at a foreign inode as a third state", async () => {
    const { ref, content, port } = await fixture("update-foundation-port-foreign");
    await nodeFs.unlink(content.path);
    await nodeFs.writeFile(content.path, postimage, { mode: 0o600 });
    await expect(port().compact(ref)).rejects.toMatchObject(recovery);
    expect(await exists(content.path)).toBe(true);
  });

  it("refuses to apply when neither the staged nor the final journal exists", async () => {
    const { ref, port } = await fixture("update-foundation-port-absent");
    await nodeFs.unlink(ref.initialJournal.staged.path);
    await expect(port().apply(ref)).rejects.toMatchObject(recovery);
  });
});
