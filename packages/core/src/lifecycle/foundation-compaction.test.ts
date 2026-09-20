import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { TransactionExecutor } from "../transactions/executor.js";
import { TransactionStore } from "../transactions/store.js";
import type {
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal } from "../update/scalars.js";
import {
  compactTerminalFoundationTransaction,
  deriveFoundationTerminalCompaction,
  removeFoundationOrphan,
} from "./foundation-compaction.js";
import {
  deriveLifecycleLedgerRoots,
  inspectFoundationLedger,
  type FoundationLedgerOrphanV1,
  type LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
import {
  createNodeLifecycleGuardedFileSystem,
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { parseFoundationTransactionId, type FoundationTransactionIdV1 } from "./ids.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { createLinkUnlinkRenameNoReplace } from "./testing.js";

const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("7c".repeat(32));
const BOOTSTRAP_UUID = "123e4567-e89b-42d3-a456-426614174000";
const BOOTSTRAP_FORWARD = `tx_fi_${BOOTSTRAP_UUID}_0000000000_f`;
const BOOTSTRAP_MIGRATION = `tx_mm_${BOOTSTRAP_UUID}_0000000000_c`;
const REWRITE_UUID = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";
const PREIMAGE_BYTES = new TextEncoder().encode("synthetic-preimage\n");
const POSTIMAGE_BYTES = new TextEncoder().encode("synthetic-postimage\n");
const THOUSAND_TRANSACTION_TIMEOUT_MS = 900_000;

class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

class FixtureLockProvider implements TransactionLockProvider {
  async acquire(path: string): Promise<TransactionLockHandle> {
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "", { mode: 0o600, flag: "a" });
    return { release: (): Promise<void> => Promise.resolve() };
  }
}

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await nodeFs.rm(home, { recursive: true, force: true });
  }
});

interface CompactionDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly store: TransactionStore;
  readonly global: HeldLifecycleStableLockV1;
  readonly afterBoundary?: ((boundary: string) => void | Promise<void>) | undefined;
}

interface CompactionHomeV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly compaction: CompactionDependenciesV1;
  readonly globalLockPath: CanonicalAbsolutePathV1;
  compactionRecording(boundaries: string[]): CompactionDependenciesV1;
  compactionSyncing(synced: string[]): CompactionDependenciesV1;
  compactionDyingAt(boundary: string): CompactionDependenciesV1;
  standaloneReplace(name: string): Promise<TransactionJournalV1>;
  leavesOf(id: string): Promise<readonly string[]>;
  stagingOf(id: string): string;
}

async function compactionHome(label: string): Promise<CompactionHomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  for (const relative of [
    "state",
    "state/transactions",
    "staging",
    "staging/transactions",
    "staging/lifecycle",
    "backups",
    "backups/transactions",
  ]) {
    await nodeFs.mkdir(join(created, relative));
    await nodeFs.chmod(join(created, relative), 0o700);
  }
  const home = parseCanonicalAbsolutePathText(created);
  const roots = deriveLifecycleLedgerRoots(home);
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: UID,
  });
  const globalLockPath = parseCanonicalAbsolutePathText(join(created, "state", ".lifecycle.lock"));
  await nodeFs.writeFile(globalLockPath, "", { mode: 0o600 });
  const globalStats = await nodeFs.lstat(globalLockPath, { bigint: true });
  const global: HeldLifecycleStableLockV1 = {
    path: globalLockPath,
    dev: parseUInt64Decimal(globalStats.dev.toString(10)),
    ino: parseUInt64Decimal(globalStats.ino.toString(10)),
    release: () => Promise.resolve(),
  };
  const lockProvider = new FixtureLockProvider();
  const store = new TransactionStore({
    stateDir: join(created, "state"),
    fs: nodeFs,
    lockProvider,
  });
  let counter = 100;
  const executor = new TransactionExecutor({
    stateDir: join(created, "state"),
    stagingDir: join(created, "staging"),
    backupsDir: join(created, "backups"),
    fs: nodeFs,
    clock: () => "2026-09-20T12:00:00.000Z",
    generateId: () => `tx_${NONCE}_${String((counter += 1))}`,
    guards: {
      assertTarget: () => Promise.resolve(),
      redactDiagnostic: (text) => text,
    },
    lockProvider,
  });

  const dependencies = (
    afterBoundary?: (boundary: string) => void | Promise<void>,
    port: LifecycleGuardedFileSystemV1 = fs,
  ): CompactionDependenciesV1 => ({ fs: port, roots, store, global, afterBoundary });

  return {
    home,
    roots,
    fs,
    globalLockPath,
    compaction: dependencies(),
    compactionRecording: (boundaries) =>
      dependencies((boundary) => {
        boundaries.push(boundary);
      }),
    compactionSyncing: (synced) =>
      dependencies(undefined, {
        ...fs,
        syncDirectory: async (entry) => {
          synced.push(entry.path);
          await fs.syncDirectory(entry);
        },
      }),
    compactionDyingAt: (boundary) =>
      dependencies((observed) => {
        if (observed === boundary) throw new SyntheticDeath(boundary);
      }),
    standaloneReplace: async (name) => {
      const targetPath = join(created, name);
      await nodeFs.writeFile(targetPath, PREIMAGE_BYTES, { mode: 0o600 });
      return executor.execute({
        kind: "synthetic-standalone-replace",
        mutations: [{ targetPath, operation: "replace", content: POSTIMAGE_BYTES }],
      });
    },
    leavesOf: async (id) => {
      const found: string[] = [];
      const journalRoot = join(created, "state", "transactions");
      for (const name of await nodeFs.readdir(journalRoot)) {
        if (name === `${id}.json` || name === `.${id}.lock`) found.push(`state/transactions/${name}`);
      }
      for (const [relative, directory] of [
        [`staging/transactions/${id}`, join(created, "staging", "transactions", id)],
        [`backups/transactions/${id}`, join(created, "backups", "transactions", id)],
      ] as const) {
        try {
          const names = await nodeFs.readdir(directory);
          found.push(relative, ...names.map((name) => `${relative}/${name}`));
        } catch {
          continue;
        }
      }
      return found.sort();
    },
    stagingOf: (id) => join(created, "staging", "transactions", id),
  };
}

async function plant(directory: string, name: string): Promise<void> {
  await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(join(directory, name), "synthetic unknown child\n", { mode: 0o600 });
}

async function existing(
  fs: LifecycleGuardedFileSystemV1,
  path: string,
): Promise<LifecycleGuardedEntryV1> {
  const entry = await fs.lstat(parseCanonicalAbsolutePathText(path));
  if (entry === null) throw new Error(`fixture lost ${path}`);
  return entry;
}

function ledgerOf(home: CompactionHomeV1) {
  return inspectFoundationLedger(
    {
      fs: home.fs,
      nonce: NONCE,
      residue: { retainedPaths: new Set(), bootstrapParticipantIds: new Set() },
      effectiveUid: UID,
      coordinatorParticipantIds: new Set(),
    },
    home.roots,
  );
}

async function plantPlanlessOrphan(
  home: CompactionHomeV1,
  id: FoundationTransactionIdV1,
): Promise<void> {
  const staging = join(home.roots.foundationStaging, id);
  await nodeFs.mkdir(staging, { mode: 0o700 });
  await nodeFs.writeFile(join(staging, "0.bin"), POSTIMAGE_BYTES, { mode: 0o600 });
  await nodeFs.writeFile(
    join(staging, "0.bin.sha256"),
    `${createHash("sha256").update(POSTIMAGE_BYTES).digest("hex")}\n`,
    { mode: 0o600 },
  );
  await nodeFs.mkdir(join(home.roots.foundationBackups, id), { mode: 0o700 });
  await nodeFs.writeFile(join(home.roots.foundationJournals, `.${id}.lock`), "", { mode: 0o600 });
}

async function present(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function plantRewriteTemp(home: CompactionHomeV1, id: string): Promise<string> {
  const temp = join(home.roots.foundationJournals, `.${id}.${REWRITE_UUID}.json.tmp`);
  await nodeFs.writeFile(temp, "", { mode: 0o600 });
  return temp;
}

async function inventoryOf(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await nodeFs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      found.push(relative);
      if (entry.isDirectory()) await walk(join(directory, entry.name), `${relative}/`);
    }
  };
  await walk(root, "");
  return found.sort();
}

describe("deriveFoundationTerminalCompaction", () => {
  it("derives the transaction ID, terminal phase and mutation count from a terminal journal", async () => {
    const home = await compactionHome("derive-terminal");
    const journal = await home.standaloneReplace("config.toml");

    expect(deriveFoundationTerminalCompaction(journal)).toStrictEqual({
      transactionId: parseFoundationTransactionId(journal.id, NONCE),
      terminalPhase: "finalized",
      mutationCount: 1,
    });
  });

  it("refuses a journal that has not reached a terminal phase through the recovery class", async () => {
    const home = await compactionHome("derive-non-terminal");
    const journal = await home.standaloneReplace("config.toml");

    let refusal: unknown;
    try {
      deriveFoundationTerminalCompaction({ ...journal, phase: "verified" });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(refusal).toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
});

describe("compactTerminalFoundationTransaction", () => {
  it("compacts a terminal standalone transaction to nothing but refuses an unknown child", async () => {
    const home = await compactionHome("compact-standalone");
    const journal = await home.standaloneReplace("config.toml");
    expect((await home.leavesOf(journal.id)).length).toBeGreaterThan(0);

    await compactTerminalFoundationTransaction(
      home.compaction,
      deriveFoundationTerminalCompaction(journal),
    );
    expect(await home.leavesOf(journal.id)).toStrictEqual([]);

    const second = await home.standaloneReplace("other.toml");
    await plant(home.stagingOf(second.id), "unknown.bin");
    const before = await home.leavesOf(second.id);

    await expect(
      compactTerminalFoundationTransaction(
        home.compaction,
        deriveFoundationTerminalCompaction(second),
      ),
    ).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await home.leavesOf(second.id)).toStrictEqual(before);
  });

  it("treats a missing expected leaf as done and stays idempotent", async () => {
    const home = await compactionHome("compact-idempotent");
    const journal = await home.standaloneReplace("config.toml");
    const record = deriveFoundationTerminalCompaction(journal);
    await nodeFs.unlink(join(home.roots.foundationStaging, journal.id, "0.bin.sha256"));

    await compactTerminalFoundationTransaction(home.compaction, record);
    await compactTerminalFoundationTransaction(home.compaction, record);

    expect(await home.leavesOf(journal.id)).toStrictEqual([]);
  });

  it("syncs every parent directory it removed a leaf from", async () => {
    const home = await compactionHome("compact-sync-parents");
    const journal = await home.standaloneReplace("config.toml");
    const synced: string[] = [];

    await compactTerminalFoundationTransaction(
      home.compactionSyncing(synced),
      deriveFoundationTerminalCompaction(journal),
    );

    expect(synced.length).toBeGreaterThan(0);
    for (const parent of [
      home.roots.foundationStaging,
      home.roots.foundationBackups,
      home.roots.foundationJournals,
    ]) {
      expect(synced).toContain(parent);
    }
  });

  it("refuses once the held global lock is no longer the recorded inode", async () => {
    const home = await compactionHome("compact-global-lock-moved");
    const journal = await home.standaloneReplace("config.toml");
    const before = await home.leavesOf(journal.id);
    expect(before.length).toBeGreaterThan(0);
    await nodeFs.unlink(home.globalLockPath);
    await nodeFs.writeFile(home.globalLockPath, "", { mode: 0o600 });

    await expect(
      compactTerminalFoundationTransaction(
        home.compaction,
        deriveFoundationTerminalCompaction(journal),
      ),
    ).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await home.leavesOf(journal.id)).toStrictEqual(before);
  });

  it("resumes after a death at every unlink boundary", async () => {
    const home = await compactionHome("compact-death");
    const boundaries: string[] = [];
    const first = await home.standaloneReplace("config.toml");
    await compactTerminalFoundationTransaction(
      home.compactionRecording(boundaries),
      deriveFoundationTerminalCompaction(first),
    );
    expect(boundaries.length).toBeGreaterThan(0);

    for (const [index, boundary] of boundaries.entries()) {
      const journal = await home.standaloneReplace(`target-${String(index)}.toml`);
      const record = deriveFoundationTerminalCompaction(journal);
      await expect(
        compactTerminalFoundationTransaction(home.compactionDyingAt(boundary), record),
      ).rejects.toThrow(SyntheticDeath);

      await compactTerminalFoundationTransaction(home.compaction, record);
      expect(await home.leavesOf(journal.id)).toStrictEqual([]);
    }
  });

  it("leaves a lock-only orphan the ledger admits and removes it", async () => {
    const home = await compactionHome("compact-lock-only");
    const journal = await home.standaloneReplace("config.toml");
    const record = deriveFoundationTerminalCompaction(journal);
    await expect(
      compactTerminalFoundationTransaction(
        home.compactionDyingAt("journal_unlinked"),
        record,
      ),
    ).rejects.toThrow(SyntheticDeath);

    const ledger = await ledgerOf(home);
    expect(ledger.findings).toStrictEqual([]);
    expect(ledger.orphans.length).toBeGreaterThan(0);
    const orphan = ledger.orphans[0] as FoundationLedgerOrphanV1;
    expect(orphan.kind).toBe("lock_only");

    await removeFoundationOrphan(home.compaction, orphan);
    expect(await home.leavesOf(journal.id)).toStrictEqual([]);
  });

  it("leaves bootstrap residue under every root untouched", async () => {
    const home = await compactionHome("compact-bootstrap-residue");
    await nodeFs.writeFile(
      join(home.roots.foundationJournals, `.${BOOTSTRAP_FORWARD}.lock`),
      "",
      { mode: 0o600 },
    );
    await nodeFs.mkdir(join(home.roots.foundationStaging, BOOTSTRAP_FORWARD), { mode: 0o700 });
    await nodeFs.mkdir(join(home.roots.foundationBackups, BOOTSTRAP_MIGRATION), { mode: 0o700 });
    const residue = [
      `state/transactions/.${BOOTSTRAP_FORWARD}.lock`,
      `staging/transactions/${BOOTSTRAP_FORWARD}`,
      `backups/transactions/${BOOTSTRAP_MIGRATION}`,
    ];
    const journal = await home.standaloneReplace("config.toml");

    await compactTerminalFoundationTransaction(
      home.compaction,
      deriveFoundationTerminalCompaction(journal),
    );

    const inventory = await inventoryOf(home.home);
    expect(residue.length).toBeGreaterThan(0);
    for (const path of residue) expect(inventory).toContain(path);
  });
});

describe("removeFoundationOrphan", () => {
  it("removes a planless orphan under the exact grammar the ledger admitted", async () => {
    const home = await compactionHome("orphan-planless");
    const id = parseFoundationTransactionId(`tx_${NONCE}_41`, NONCE);
    await plantPlanlessOrphan(home, id);

    const ledger = await ledgerOf(home);
    expect(ledger.findings).toStrictEqual([]);
    expect(ledger.orphans.length).toBeGreaterThan(0);
    const orphan = ledger.orphans[0] as FoundationLedgerOrphanV1;
    expect(orphan.kind).toBe("planless");

    await removeFoundationOrphan(home.compaction, orphan);
    expect(await home.leavesOf(id)).toStrictEqual([]);
  });

  it("refuses an orphan whose leaves reach into the backup directory", async () => {
    const home = await compactionHome("orphan-backup-member");
    const id = parseFoundationTransactionId(`tx_${NONCE}_43`, NONCE);
    await plantPlanlessOrphan(home, id);
    const backupMember = join(home.roots.foundationBackups, id, "0.bin");
    await nodeFs.writeFile(backupMember, PREIMAGE_BYTES, { mode: 0o600 });
    const forged: FoundationLedgerOrphanV1 = {
      kind: "planless",
      id,
      leaves: [await existing(home.fs, backupMember)],
    };

    await expect(removeFoundationOrphan(home.compaction, forged)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect(await nodeFs.readFile(backupMember)).toStrictEqual(Buffer.from(PREIMAGE_BYTES));
  });

  it("refuses a forged orphan leaf that is another transaction's rewrite temp", async () => {
    const home = await compactionHome("orphan-foreign-rewrite-temp");
    const id = parseFoundationTransactionId(`tx_${NONCE}_51`, NONCE);
    const other = parseFoundationTransactionId(`tx_${NONCE}_53`, NONCE);
    await plantPlanlessOrphan(home, id);
    const foreign = await plantRewriteTemp(home, other);
    const forged: FoundationLedgerOrphanV1 = {
      kind: "planless",
      id,
      leaves: [await existing(home.fs, foreign)],
    };

    await expect(removeFoundationOrphan(home.compaction, forged)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect(await present(foreign)).toBe(true);
  });

  it("removes a rewrite temp beside its strict final journal and leaves that journal untouched", async () => {
    const home = await compactionHome("orphan-rewrite-temp");
    const journal = await home.standaloneReplace("config.toml");
    const temp = await plantRewriteTemp(home, journal.id);
    const journalPath = join(home.roots.foundationJournals, `${journal.id}.json`);
    const before = await nodeFs.readFile(journalPath);

    const ledger = await ledgerOf(home);
    expect(ledger.findings).toStrictEqual([]);
    expect(ledger.orphans.length).toBeGreaterThan(0);
    const orphan = ledger.orphans[0] as FoundationLedgerOrphanV1;
    expect(orphan.kind).toBe("rewrite_temp");

    await removeFoundationOrphan(home.compaction, orphan);

    expect(await present(temp)).toBe(false);
    expect(await nodeFs.readFile(journalPath)).toStrictEqual(before);
  });

  it("refuses a rewrite temp once the final journal is no longer the strict record for its ID", async () => {
    const home = await compactionHome("orphan-rewrite-temp-drift");
    const journal = await home.standaloneReplace("config.toml");
    const temp = await plantRewriteTemp(home, journal.id);
    const orphan = (await ledgerOf(home)).orphans[0] as FoundationLedgerOrphanV1;
    const journalPath = join(home.roots.foundationJournals, `${journal.id}.json`);
    await nodeFs.rm(journalPath);
    await nodeFs.writeFile(journalPath, '{"schemaVersion":1}\n', { mode: 0o600 });

    await expect(removeFoundationOrphan(home.compaction, orphan)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect(await present(temp)).toBe(true);
  });

  it("refuses a planless orphan once a final journal for its ID exists", async () => {
    const home = await compactionHome("orphan-journal-present");
    const id = parseFoundationTransactionId(`tx_${NONCE}_47`, NONCE);
    await plantPlanlessOrphan(home, id);
    const orphan = (await ledgerOf(home)).orphans[0] as FoundationLedgerOrphanV1;
    const journal = await home.standaloneReplace("config.toml");
    await nodeFs.copyFile(
      join(home.roots.foundationJournals, `${journal.id}.json`),
      join(home.roots.foundationJournals, `${id}.json`),
    );

    await expect(removeFoundationOrphan(home.compaction, orphan)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect((await home.leavesOf(id)).length).toBeGreaterThan(0);
  });
});

describe("terminal Foundation collection stays bounded", () => {
  it(
    "keeps state/transactions at one stable lock across 1,000 compacted transactions",
    async () => {
      const home = await compactionHome("compact-thousand");
      const journalRoot = home.roots.foundationJournals;
      for (let iteration = 0; iteration < 1_000; iteration += 1) {
        const journal = await home.standaloneReplace("config.toml");
        if (iteration === 0) expect((await home.leavesOf(journal.id)).length).toBeGreaterThan(0);
        await compactTerminalFoundationTransaction(
          home.compaction,
          deriveFoundationTerminalCompaction(journal),
        );
        const entries = await nodeFs.readdir(journalRoot);
        expect(entries.filter((name) => !name.endsWith(".lock"))).toStrictEqual([]);
        expect(entries.length).toBeLessThanOrEqual(1);
      }
      expect(await nodeFs.readdir(home.roots.foundationStaging)).toStrictEqual([]);
      expect(await nodeFs.readdir(home.roots.foundationBackups)).toStrictEqual([]);
    },
    THOUSAND_TRANSACTION_TIMEOUT_MS,
  );
});
