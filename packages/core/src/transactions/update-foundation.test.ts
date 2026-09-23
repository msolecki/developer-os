import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { EXIT_CODES } from "../result.js";
import { FixtureLockProvider, SyntheticDeath } from "../lifecycle/testing.js";
import type { AllocatedLifecycleIdV1 } from "../lifecycle/ids.js";
import {
  buildUpdateFoundationParticipantRef,
  updateFoundationStagedDigestBytes,
  type UpdateFoundationParticipantRefV2,
  type UpdatePayloadRefV1,
} from "../update/migrations.js";
import { deriveUpdatePayloadPath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUtcTimestamp, type LowerHexSha256, type SafeReasonCodeV1 } from "../update/scalars.js";
import {
  admitLifecycleFoundationInitialJournal,
  admitUpdateFoundationInitialJournal,
  TransactionExecutor,
  validateJournal,
  type AdmittedUpdateFoundationInitialJournalV1,
  type BootstrapInitialJournalPublicationV1,
  type TransactionJournalV1,
  type TransactionPhase,
} from "./index.js";

const UID = process.getuid?.() ?? 0;
const NONCE = "5b".repeat(32);
const COORDINATOR = `lc_${NONCE}_1` as LifecycleCoordinatorIdV1;
const FORWARD = `tx_${NONCE}_2` as AllocatedLifecycleIdV1<"tx">;
const CREATED_AT = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const PREIMAGE = new TextEncoder().encode("synthetic-owner-file v1\n");
const POSTIMAGE = new TextEncoder().encode("synthetic-owner-file v2\n");
const RECOVERY = { code: EXIT_CODES.recoveryRequired };

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

function digest(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

interface UpdateFoundationFixtureV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly ref: UpdateFoundationParticipantRefV2;
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly contentPath: CanonicalAbsolutePathV1;
  readonly digestPath: CanonicalAbsolutePathV1;
  readonly stagedBinPath: string;
  readonly finalJournalPath: string;
  readonly admit: (override?: Partial<Parameters<typeof admitUpdateFoundationInitialJournal>[0]>) => AdmittedUpdateFoundationInitialJournalV1;
  readonly initialJournal: TransactionJournalV1;
}

async function parentOf(path: string): Promise<BootstrapInitialJournalPublicationV1["sourceParent"]> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { path: path as CanonicalAbsolutePathV1, ownerUid: UID, mode: 0o700, dev: stats.dev.toString(10) as never, ino: stats.ino.toString(10) as never };
}

async function identityOf(path: string): Promise<{ readonly dev: never; readonly ino: never }> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: stats.dev.toString(10) as never, ino: stats.ino.toString(10) as never };
}

async function mkdirs(root: string, relatives: readonly string[]): Promise<void> {
  for (const relative of relatives) {
    await nodeFs.mkdir(join(root, relative), { recursive: true });
    await nodeFs.chmod(join(root, relative), 0o700);
  }
}

/**
 * Stages exactly what construction leaves for one lifecycle ref: the content and sidecar
 * payload rows under `update/payloads`, and the planned initial journal under
 * `participants/foundation/<tx>`, each at a recorded construction-evidence inode.
 */
async function install(label: string): Promise<UpdateFoundationFixtureV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  const home = parseCanonicalAbsolutePathText(created);
  const coordinatorRoot = `staging/lifecycle/${COORDINATOR}`;
  await mkdirs(created, ["state/transactions", "staging/transactions", "backups/transactions", "targets", `${coordinatorRoot}/update/payloads`, `${coordinatorRoot}/participants/foundation/${FORWARD}`]);
  const targetPath = parseCanonicalAbsolutePathText(join(created, "targets", "owner.md"));
  await nodeFs.writeFile(targetPath, PREIMAGE, { mode: 0o600 });

  const sidecar = updateFoundationStagedDigestBytes(digest(POSTIMAGE));
  const payload = (ordinal: number, bytes: Uint8Array): UpdatePayloadRefV1 => ({
    kind: "update_expected", coordinatorId: COORDINATOR, ordinal, path: deriveUpdatePayloadPath(home, COORDINATOR as string as SafeReasonCodeV1, ordinal), bytes: bytes.byteLength, sha256: digest(bytes), mode: 384,
  });
  const content = payload(0, POSTIMAGE);
  const digestRow = payload(1, sidecar);
  const { ref, initialJournalBytes } = buildUpdateFoundationParticipantRef({
    productHome: home, coordinatorId: COORDINATOR, id: FORWARD, slot: "owner_forward_files", role: { kind: "forward", compensationId: null },
    mutations: [{ targetPath, operation: "replace", expectedBeforeHash: digest(PREIMAGE), content, digest: digestRow }],
    journalOrdinal: 2, createdAt: CREATED_AT,
  });
  await nodeFs.writeFile(content.path, POSTIMAGE, { flag: "wx", mode: 0o600 });
  await nodeFs.writeFile(digestRow.path, sidecar, { flag: "wx", mode: 0o600 });
  await nodeFs.writeFile(ref.initialJournal.staged.path, initialJournalBytes, { flag: "wx", mode: 0o600 });
  const identities = { content: await identityOf(content.path), digest: await identityOf(digestRow.path), journal: await identityOf(ref.initialJournal.staged.path) };
  const initialJournal = validateJournal(JSON.parse(new TextDecoder().decode(initialJournalBytes)) as unknown);
  const parents = {
    payloadParent: await parentOf(dirname(content.path)),
    sourceParent: await parentOf(dirname(ref.initialJournal.staged.path)),
    destinationParent: await parentOf(dirname(ref.initialJournal.finalPath)),
  };
  return {
    home,
    ref,
    targetPath,
    contentPath: content.path,
    digestPath: digestRow.path,
    stagedBinPath: join(created, "staging", "transactions", FORWARD, "0.bin"),
    finalJournalPath: ref.initialJournal.finalPath,
    initialJournal,
    admit: (override = {}) => admitUpdateFoundationInitialJournal({
      ref,
      ownerUid: UID,
      initialJournal,
      journalIdentity: identities.journal,
      payloadIdentities: [{ content: identities.content, digest: identities.digest }],
      ...parents,
      ...override,
    }),
  };
}

/** A no-replace publisher (link, then unlink) that can die right after its Nth rename landed. */
function executor(home: CanonicalAbsolutePathV1, options: { readonly dieAfterPublish?: number; readonly dyingPhase?: TransactionPhase; readonly calls?: string[] } = {}): TransactionExecutor {
  let published = 0;
  return new TransactionExecutor({
    stateDir: join(home, "state"),
    stagingDir: join(home, "staging"),
    backupsDir: join(home, "backups"),
    fs: nodeFs,
    clock: () => "2026-09-23T12:00:01.000Z",
    generateId: () => {
      throw new Error("the update Foundation bridge must not generate an ID");
    },
    guards: { assertTarget: () => Promise.resolve(), redactDiagnostic: (text) => text },
    lockProvider: new FixtureLockProvider(),
    afterPhase: (phase) => {
      if (options.dyingPhase !== undefined && phase === options.dyingPhase) throw new SyntheticDeath(phase);
    },
    publishBootstrapInitialJournalNoReplace: async (request) => {
      options.calls?.push(`${request.sourcePath}->${request.destinationPath}`);
      await nodeFs.link(request.sourcePath, request.destinationPath);
      await nodeFs.unlink(request.sourcePath);
      published += 1;
      if (published === options.dieAfterPublish) throw new SyntheticDeath(`publish ${String(published)}`);
    },
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

describe("coordinator-bound update Foundation publication (Spec 2 §5.3, D60)", () => {
  it("publishes content, then its sidecar, then the journal, and runs the unchanged executor", async () => {
    const fixture = await install("update-foundation-publication");
    const calls: string[] = [];
    const journal = await executor(fixture.home, { calls }).executeUpdateFoundationParticipant(fixture.admit());
    expect(journal.phase).toBe("finalized");
    expect(calls).toStrictEqual([
      `${fixture.contentPath}->${fixture.stagedBinPath}`,
      `${fixture.digestPath}->${fixture.stagedBinPath}.sha256`,
      `${fixture.ref.initialJournal.staged.path}->${fixture.finalJournalPath}`,
    ]);
    expect(await nodeFs.readFile(fixture.targetPath)).toStrictEqual(Buffer.from(POSTIMAGE));
    expect(await exists(fixture.contentPath)).toBe(false);
    expect(await exists(fixture.digestPath)).toBe(false);
  });

  it.each([1, 2, 3])("resumes after a death right after publication %i", async (dieAfterPublish) => {
    const fixture = await install(`update-foundation-death-${String(dieAfterPublish)}`);
    await expect(executor(fixture.home, { dieAfterPublish }).executeUpdateFoundationParticipant(fixture.admit())).rejects.toBeDefined();
    expect(await nodeFs.readFile(fixture.targetPath)).toStrictEqual(Buffer.from(PREIMAGE));
    const journal = await executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit());
    expect(journal.phase).toBe("finalized");
    expect(await nodeFs.readFile(fixture.targetPath)).toStrictEqual(Buffer.from(POSTIMAGE));
  });

  it("resumes a published journal through the unchanged state machine", async () => {
    const fixture = await install("update-foundation-backed-up");
    await expect(executor(fixture.home, { dyingPhase: "backed_up" }).executeUpdateFoundationParticipant(fixture.admit())).rejects.toBeInstanceOf(SyntheticDeath);
    expect(await exists(fixture.ref.initialJournal.staged.path)).toBe(false);
    const journal = await executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit());
    expect(journal.phase).toBe("finalized");
  });

  it("adopts a published blob only at its construction-evidence inode", async () => {
    const fixture = await install("update-foundation-foreign-inode");
    await expect(executor(fixture.home, { dieAfterPublish: 1 }).executeUpdateFoundationParticipant(fixture.admit())).rejects.toBeDefined();
    const copy = `${fixture.stagedBinPath}.copy`;
    await nodeFs.copyFile(fixture.stagedBinPath, copy);
    await nodeFs.rename(copy, fixture.stagedBinPath);
    await expect(executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit())).rejects.toMatchObject(RECOVERY);
    expect(await nodeFs.readFile(fixture.targetPath)).toStrictEqual(Buffer.from(PREIMAGE));
    expect(await exists(fixture.finalJournalPath)).toBe(false);
  });

  it("refuses a third state where a payload is both staged and published", async () => {
    const fixture = await install("update-foundation-both-present");
    await expect(executor(fixture.home, { dieAfterPublish: 1 }).executeUpdateFoundationParticipant(fixture.admit())).rejects.toBeDefined();
    await nodeFs.writeFile(fixture.contentPath, POSTIMAGE, { flag: "wx", mode: 0o600 });
    await expect(executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit())).rejects.toMatchObject(RECOVERY);
    expect(await exists(fixture.finalJournalPath)).toBe(false);
  });

  it("refuses when neither the staged nor the final journal exists", async () => {
    const fixture = await install("update-foundation-absent");
    await nodeFs.unlink(fixture.ref.initialJournal.staged.path);
    await expect(executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit())).rejects.toMatchObject(RECOVERY);
  });

  it("refuses a journal whose staged bytes differ from the construction evidence inode", async () => {
    const fixture = await install("update-foundation-journal-inode");
    const staged = fixture.ref.initialJournal.staged.path;
    const bytes = await nodeFs.readFile(staged);
    await nodeFs.unlink(staged);
    await nodeFs.writeFile(staged, bytes, { mode: 0o600 });
    await expect(executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit())).rejects.toMatchObject(RECOVERY);
  });

  it("refuses a structural capability admission never issued", async () => {
    const fixture = await install("update-foundation-forged");
    await expect(executor(fixture.home).executeUpdateFoundationParticipant({} as unknown as AdmittedUpdateFoundationInitialJournalV1)).rejects.toMatchObject(RECOVERY);
  });

  it("refuses a pre-D60 ref that stages at its payload path", async () => {
    const fixture = await install("update-foundation-payload-staged");
    const ref = { ...fixture.ref, mutations: fixture.ref.mutations.map((mutation) => ({ ...mutation, stagedPath: mutation.content?.path ?? null })) };
    await expect(executor(fixture.home).executeUpdateFoundationParticipant(fixture.admit({ ref }))).rejects.toMatchObject(RECOVERY);
    expect(await exists(fixture.contentPath)).toBe(true);
  });

  it("refuses a Spec 1 V1 ref at the update arm", async () => {
    const fixture = await install("update-foundation-v1-ref");
    const v1 = {
      ...fixture.ref,
      initialJournal: {
        finalPath: fixture.ref.initialJournal.finalPath,
        plannedBytesHash: fixture.ref.initialJournal.plannedBytesHash,
        stagedPath: fixture.ref.initialJournal.staged.path,
        stagedIdentity: { hash: fixture.ref.initialJournal.staged.hash, size: fixture.ref.initialJournal.staged.bytes, mode: 0o600, dev: "1", ino: "1" },
      },
    };
    expect(() => fixture.admit({ ref: v1 as never })).toThrow(expect.objectContaining(RECOVERY) as Error);
  });

  it("refuses a V2 update ref at the Spec 1 lifecycle bridge", async () => {
    const fixture = await install("update-foundation-v2-at-v1");
    const refusal = (): unknown => admitLifecycleFoundationInitialJournal({
      ref: fixture.ref as never,
      ownerUid: UID,
      initialJournal: fixture.initialJournal,
      sourceParent: { path: dirname(fixture.ref.initialJournal.staged.path) as CanonicalAbsolutePathV1, ownerUid: UID, mode: 0o700, dev: "1" as never, ino: "1" as never },
      destinationParent: { path: dirname(fixture.finalJournalPath) as CanonicalAbsolutePathV1, ownerUid: UID, mode: 0o700, dev: "1" as never, ino: "1" as never },
    });
    expect(refusal).toThrow(expect.objectContaining(RECOVERY) as Error);
  });

  it("refuses a sidecar row that is not the content hash plus LF", async () => {
    const fixture = await install("update-foundation-bad-sidecar");
    const ref = { ...fixture.ref, mutations: fixture.ref.mutations.map((mutation) => ({ ...mutation, digest: mutation.digest === null ? null : { ...mutation.digest, sha256: digest(POSTIMAGE) } })) };
    expect(() => fixture.admit({ ref })).toThrow(expect.objectContaining(RECOVERY) as Error);
  });
});
