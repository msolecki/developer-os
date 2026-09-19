import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal } from "../update/scalars.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import {
  deriveLifecycleLedgerRoots,
  inspectFoundationLedger,
  type FoundationLedgerV1,
  type LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
import {
  createNodeLifecycleGuardedFileSystem,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { parseFoundationTransactionId } from "./ids.js";
import { createInMemoryLifecycleGuardedFileSystem, createLinkUnlinkRenameNoReplace } from "./testing.js";

const encoder = new TextEncoder();
const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("3f".repeat(32));
const OTHER_NONCE = parseLowerHexSha256("7c".repeat(32));
const ALLOCATED = parseFoundationTransactionId(`tx_${NONCE}_7`, NONCE);
const SECOND_ALLOCATED = parseFoundationTransactionId(`tx_${NONCE}_9`, NONCE);
const LEGACY = parseFoundationTransactionId("tx_123e4567-e89b-42d3-a456-426614174000", NONCE);
const BOOTSTRAP_ID = "bp_123e4567-e89b-42d3-a456-426614174000";
const BOOTSTRAP_PARTICIPANT = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_f";
const TOMBSTONE = `.developer-os-retained.${BOOTSTRAP_ID}.0000000000.tombstone`;
const MEBIBYTE = 1_048_576;
const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await nodeFs.rm(home, { recursive: true, force: true });
  }
});

const NO_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

interface LedgerHomeV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
}

interface InspectOptionsV1 {
  readonly nonce?: typeof NONCE | null;
  readonly residue?: LifecycleBookkeepingResidueV1;
  readonly effectiveUid?: number;
  readonly participants?: readonly string[];
}

function nodePort(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: UID,
  });
}

async function freshLedgerHome(label: string): Promise<LedgerHomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  for (const relative of [
    "state",
    "state/transactions",
    "staging",
    "staging/transactions",
    "backups",
    "backups/transactions",
  ]) {
    await nodeFs.mkdir(join(created, relative));
    await nodeFs.chmod(join(created, relative), 0o700);
  }
  const home = parseCanonicalAbsolutePathText(created);
  return { home, roots: deriveLifecycleLedgerRoots(home), fs: nodePort() };
}

function inspect(home: LedgerHomeV1, options: InspectOptionsV1 = {}): Promise<FoundationLedgerV1> {
  return inspectFoundationLedger(
    {
      fs: home.fs,
      nonce: options.nonce === undefined ? NONCE : options.nonce,
      residue: options.residue ?? NO_RESIDUE,
      effectiveUid: options.effectiveUid ?? UID,
      coordinatorParticipantIds: new Set(options.participants ?? []),
    },
    home.roots,
  );
}

async function plantFile(
  home: LedgerHomeV1,
  relative: string,
  content: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  const path = join(home.home, relative);
  await nodeFs.writeFile(path, content);
  await nodeFs.chmod(path, mode);
}

async function plantDirectory(home: LedgerHomeV1, relative: string): Promise<void> {
  const path = join(home.home, relative);
  await nodeFs.mkdir(path, { recursive: true });
  await nodeFs.chmod(path, 0o700);
}

function journalOf(
  id: string,
  operations: readonly ("create" | "replace" | "remove")[] = ["create"],
): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id,
    kind: "config_set",
    phase: "finalized",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:01.000Z",
    mutations: operations.map((operation, index) => ({
      targetPath: `/product/state/target-${String(index)}`,
      operation,
      expectedBeforeHash: operation === "create" ? null : "b".repeat(64),
      stagedRelativePath: operation === "remove" ? null : `${String(index)}.bin`,
    })),
  };
}

function digestText(content: Uint8Array): string {
  return `${createHash("sha256").update(content).digest("hex")}\n`;
}

function reasons(snapshot: FoundationLedgerV1): readonly string[] {
  return snapshot.findings.map((finding) => finding.reason);
}

function orphanKinds(snapshot: FoundationLedgerV1): readonly string[] {
  return snapshot.orphans.map((orphan) => orphan.kind);
}

/**
 * A8's agreement projection. Device and inode numbers, and a directory's own
 * link count and size, legitimately differ between the physical and injected
 * ports; everything the inventory decides on must not.
 */
function entryShape(entry: LifecycleGuardedEntryV1 | null): Readonly<Record<string, unknown>> | null {
  if (entry === null) return null;
  const common = { path: entry.path, kind: entry.kind, ownerUid: entry.ownerUid, mode: entry.mode };
  return entry.kind === "directory" ? common : { ...common, nlink: entry.nlink, size: entry.size };
}

function agreementShape(snapshot: FoundationLedgerV1): Readonly<Record<string, unknown>> {
  return {
    journals: [...snapshot.journals].map(([id, held]) => [
      id,
      { journal: held.journal, entry: entryShape(held.entry), lock: entryShape(held.lock) },
    ]),
    orphans: snapshot.orphans.map((orphan) =>
      orphan.kind === "planless"
        ? { kind: orphan.kind, id: orphan.id, leaves: orphan.leaves.map(entryShape) }
        : {
            kind: orphan.kind,
            id: orphan.id,
            entry: entryShape(orphan.kind === "lock_only" ? orphan.lock : orphan.temp),
          },
    ),
    findings: snapshot.findings,
    counts: snapshot.counts,
    overflow: snapshot.overflow,
  };
}

/**
 * The one tree A8's physical fixture builds, written only through the guarded
 * port so the physical and in-memory ports receive byte-identical instructions.
 */
async function buildAgreementTree(
  fs: LifecycleGuardedFileSystemV1,
  home: CanonicalAbsolutePathV1,
): Promise<void> {
  const at = (relative: string): CanonicalAbsolutePathV1 =>
    parseCanonicalAbsolutePathText(`${home}/${relative}`);
  for (const relative of [
    "state",
    "state/transactions",
    "staging",
    "staging/transactions",
    "backups",
    "backups/transactions",
    `staging/transactions/${ALLOCATED}`,
    `backups/transactions/${ALLOCATED}`,
    `staging/transactions/${SECOND_ALLOCATED}`,
    `backups/transactions/${SECOND_ALLOCATED}`,
    `staging/transactions/${BOOTSTRAP_PARTICIPANT}`,
  ]) {
    await fs.mkdirExclusive(at(relative));
  }

  const allocated = encoder.encode(encodeFoundationJournalJsonV1(journalOf(ALLOCATED, ["create", "remove"])));
  const legacy = encoder.encode(`${JSON.stringify(journalOf(LEGACY), null, 2)}\n`);
  const payload = encoder.encode("staged payload");
  const metadata = encoder.encode('{"existed":false}');

  await fs.writeExclusive(at(`state/transactions/${ALLOCATED}.json`), allocated);
  await fs.writeExclusive(at(`state/transactions/.${ALLOCATED}.lock`), new Uint8Array(0));
  await fs.writeExclusive(at(`state/transactions/${LEGACY}.json`), legacy);
  await fs.writeExclusive(at(`state/transactions/${TOMBSTONE}`), new Uint8Array(0));
  await fs.writeExclusive(at(`state/transactions/.${BOOTSTRAP_PARTICIPANT}.lock`), new Uint8Array(0));
  await fs.writeExclusive(at(`staging/transactions/${ALLOCATED}/0.bin`), payload);
  await fs.writeExclusive(
    at(`staging/transactions/${ALLOCATED}/0.bin.sha256`),
    encoder.encode(digestText(payload)),
  );
  await fs.writeExclusive(at(`backups/transactions/${ALLOCATED}/0.json`), metadata);
  await fs.writeExclusive(
    at(`backups/transactions/${ALLOCATED}/0.json.sha256`),
    encoder.encode(digestText(metadata)),
  );
  await fs.writeExclusive(at(`staging/transactions/${SECOND_ALLOCATED}/0.bin`), payload);
  await fs.writeExclusive(
    at(`staging/transactions/${SECOND_ALLOCATED}/0.bin.sha256`),
    encoder.encode(digestText(payload)),
  );
  await fs.writeExclusive(at(`staging/transactions/${SECOND_ALLOCATED}/2.bin`), payload);
}

function agreementResidue(home: CanonicalAbsolutePathV1): LifecycleBookkeepingResidueV1 {
  return {
    retainedPaths: new Set([join(home, "state/transactions", TOMBSTONE)]),
    bootstrapParticipantIds: new Set([BOOTSTRAP_PARTICIPANT]),
  };
}

/** Every ID is residue: the ceiling fixtures need membership without a million-entry set. */
class EveryIdIsResidue extends Set<string> {
  override has(): boolean {
    return true;
  }
}

const SYNTHETIC_HOME = parseCanonicalAbsolutePathText("/product");
const SYNTHETIC_ROOTS = deriveLifecycleLedgerRoots(SYNTHETIC_HOME);
const SYNTHETIC_UUID = "00000000-0000-4000-8000-000000000000";

interface SyntheticLedgerV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly nonce: typeof NONCE;
  readonly residue: LifecycleBookkeepingResidueV1;
  readonly effectiveUid: number;
  readonly coordinatorParticipantIds: ReadonlySet<string>;
  readonly mutations: readonly string[];
}

interface MetadataLeafV1 {
  readonly kind: "regular_file" | "directory" | "symlink" | "other";
  readonly ownerUid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: string;
}

/** A metadata-only port: enough to prove a shape gate that no real filesystem lets a test reach. */
function metadataLedger(leaves: Readonly<Record<string, MetadataLeafV1>>): SyntheticLedgerV1 {
  const roots = [
    SYNTHETIC_ROOTS.foundationJournals,
    SYNTHETIC_ROOTS.foundationStaging,
    SYNTHETIC_ROOTS.foundationBackups,
  ];
  const nodes = new Map<string, MetadataLeafV1>(Object.entries(leaves));
  for (const root of roots) {
    nodes.set(root, { kind: "directory", ownerUid: UID, mode: 0o700, nlink: 2, size: "0" });
  }
  const mutations: string[] = [];
  const entryOf = (path: string, leaf: MetadataLeafV1): LifecycleGuardedEntryV1 => ({
    path: parseCanonicalAbsolutePathText(path),
    kind: leaf.kind,
    ownerUid: leaf.ownerUid,
    mode: leaf.mode,
    nlink: leaf.nlink,
    size: parseUInt64Decimal(leaf.size),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal(String([...nodes.keys()].indexOf(path) + 2)),
  });
  const refuse = (method: string): never => {
    mutations.push(method);
    throw new Error(`the ledger inventory is read-only: ${method}`);
  };
  const fs: LifecycleGuardedFileSystemV1 = {
    lstat: (path) => {
      const leaf = nodes.get(path);
      return Promise.resolve(leaf === undefined ? null : entryOf(path, leaf));
    },
    readRegular: () => Promise.resolve(new Uint8Array(0)),
    hashRegular: () => Promise.resolve(parseLowerHexSha256("0".repeat(64))),
    names: async function* streamNames(entry) {
      for (const path of nodes.keys()) {
        const suffix = path.startsWith(`${entry.path}/`) ? path.slice(entry.path.length + 1) : null;
        if (suffix !== null && !suffix.includes("/")) yield await Promise.resolve(suffix);
      }
    },
    writeExclusive: () => refuse("writeExclusive"),
    mkdirExclusive: () => refuse("mkdirExclusive"),
    renameOver: () => refuse("renameOver"),
    renameNoReplace: () => refuse("renameNoReplace"),
    unlinkExact: () => refuse("unlinkExact"),
    rmdirExactEmpty: () => refuse("rmdirExactEmpty"),
    syncDirectory: () => refuse("syncDirectory"),
  };
  return {
    fs,
    nonce: NONCE,
    residue: NO_RESIDUE,
    effectiveUid: UID,
    coordinatorParticipantIds: new Set(),
    mutations,
  };
}

/**
 * A8's injected enumerator: it streams `leaves` synthetic names one entry at a
 * time and answers `lstat` from the name alone, so the production counting path
 * reaches a ceiling without a million real files. Every mutating method records
 * its call and refuses.
 */
function syntheticLedger(
  root: "journal root" | "staging" | "backups" | "aggregate",
  leaves: number,
): SyntheticLedgerV1 {
  const mutations: string[] = [];
  const target =
    root === "staging"
      ? SYNTHETIC_ROOTS.foundationStaging
      : root === "backups"
        ? SYNTHETIC_ROOTS.foundationBackups
        : SYNTHETIC_ROOTS.foundationJournals;
  const directoryLeaves = root === "staging" || root === "backups";
  const prefix = directoryLeaves ? `tx_fi_${SYNTHETIC_UUID}_` : `.tx_fi_${SYNTHETIC_UUID}_`;
  const suffix = directoryLeaves ? "_f" : "_f.lock";
  const name = (ordinal: number): string => `${prefix}${String(ordinal)}${suffix}`;

  const directory = (path: CanonicalAbsolutePathV1, ino: number): LifecycleGuardedEntryV1 => ({
    path,
    kind: "directory",
    ownerUid: UID,
    mode: 0o700,
    nlink: 2,
    size: parseUInt64Decimal("0"),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal(String(ino)),
  });

  const refuse = (method: string): never => {
    mutations.push(method);
    throw new Error(`the ledger inventory is read-only: ${method}`);
  };

  const ordinalOf = (path: string): number | null => {
    const leaf = path.slice(target.length + 1);
    if (!leaf.startsWith(prefix) || !leaf.endsWith(suffix)) return null;
    const ordinal = Number(leaf.slice(prefix.length, leaf.length - suffix.length));
    return Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < leaves && name(ordinal) === leaf
      ? ordinal
      : null;
  };

  const fs: LifecycleGuardedFileSystemV1 = {
    lstat: (path) => {
      const roots = [
        SYNTHETIC_ROOTS.foundationJournals,
        SYNTHETIC_ROOTS.foundationStaging,
        SYNTHETIC_ROOTS.foundationBackups,
      ];
      const rootIndex = roots.indexOf(path);
      if (rootIndex >= 0) return Promise.resolve(directory(path, rootIndex + 2));
      if (!path.startsWith(`${target}/`)) return Promise.resolve(null);
      const ordinal = ordinalOf(path);
      if (ordinal === null) return Promise.resolve(null);
      return Promise.resolve(
        directoryLeaves
          ? directory(path, ordinal + 8)
          : {
              path,
              kind: "regular_file",
              ownerUid: UID,
              mode: 0o600,
              nlink: 1,
              size: parseUInt64Decimal("0"),
              dev: parseUInt64Decimal("1"),
              ino: parseUInt64Decimal(String(ordinal + 8)),
            },
      );
    },
    readRegular: () => Promise.resolve(new Uint8Array(0)),
    hashRegular: () => Promise.resolve(parseLowerHexSha256("0".repeat(64))),
    names: async function* streamNames(entry) {
      if (entry.path !== target) return;
      for (let ordinal = 0; ordinal < leaves; ordinal += 1) {
        yield await Promise.resolve(name(ordinal));
      }
    },
    writeExclusive: () => refuse("writeExclusive"),
    mkdirExclusive: () => refuse("mkdirExclusive"),
    renameOver: () => refuse("renameOver"),
    renameNoReplace: () => refuse("renameNoReplace"),
    unlinkExact: () => refuse("unlinkExact"),
    rmdirExactEmpty: () => refuse("rmdirExactEmpty"),
    syncDirectory: () => refuse("syncDirectory"),
  };

  return {
    fs,
    nonce: NONCE,
    residue: { retainedPaths: new Set(), bootstrapParticipantIds: new EveryIdIsResidue() },
    effectiveUid: UID,
    coordinatorParticipantIds: new Set(),
    mutations,
  };
}

describe("the lifecycle ledger roots", () => {
  it("derives the four journal roots and the three companion inventories", () => {
    expect(deriveLifecycleLedgerRoots(SYNTHETIC_HOME)).toStrictEqual({
      productHome: "/product",
      stateDirectory: "/product/state",
      foundationJournals: "/product/state/transactions",
      coordinatorJournals: "/product/state/lifecycle-journals",
      gitEffectJournals: "/product/state/git-effect-journals",
      launchdEffectJournals: "/product/state/launchd-effect-journals",
      foundationStaging: "/product/staging/transactions",
      foundationBackups: "/product/backups/transactions",
      lifecycleStaging: "/product/staging/lifecycle",
    });
  });
});

describe("the Foundation journal root", () => {
  it("admits an allocated journal, a legacy journal and their stable locks", async () => {
    const home = await freshLedgerHome("ledger-journals");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED)),
    );
    await plantFile(home, `state/transactions/.${ALLOCATED}.lock`, "");
    await plantFile(
      home,
      `state/transactions/${LEGACY}.json`,
      `${JSON.stringify(journalOf(LEGACY), null, 2)}\n`,
    );
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, "payload");
    await plantFile(
      home,
      `staging/transactions/${ALLOCATED}/0.bin.sha256`,
      digestText(encoder.encode("payload")),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.journals.size).toBeGreaterThan(0);
    expect([...snapshot.journals.keys()]).toStrictEqual([LEGACY, ALLOCATED]);
    expect(snapshot.journals.get(ALLOCATED)?.journal.id).toBe(ALLOCATED);
    expect(snapshot.journals.get(ALLOCATED)?.lock?.mode).toBe(0o600);
    expect(snapshot.journals.get(LEGACY)?.lock).toBeNull();
    expect(snapshot.counts).toStrictEqual({ journalRoot: 3, staging: 3, backups: 0 });
    expect(snapshot.overflow).toBe(false);
  });

  it.each([
    ["a foreign-nonce allocated ID", `tx_${OTHER_NONCE}_7.json`],
    ["a fixture-shaped ID", "tx_fixture_001.json"],
    ["an uppercase prefix", `TX_${NONCE}_7.json`],
    ["a journal with no suffix", ALLOCATED],
    ["a stable lock for an unparsable ID", ".tx_fixture_001.lock"],
    ["an unrelated leaf", "notes.txt"],
  ])("refuses %s in the journal root", async (_label, leaf) => {
    const home = await freshLedgerHome("ledger-journal-name");
    await plantFile(home, `state/transactions/${leaf}`, "{}\n");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_name"]);
    expect(snapshot.findings[0]?.path).toBe(join(home.home, "state/transactions", leaf));
    expect(snapshot.counts.journalRoot).toBe(1);
  });

  it("refuses an allocated journal whose bytes are not the exact FoundationJournalJsonV1 encoding", async () => {
    const home = await freshLedgerHome("ledger-journal-bytes");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      `${JSON.stringify(journalOf(ALLOCATED), null, 2)}\n`,
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_bytes"]);
    expect(snapshot.journals.size).toBe(0);
  });

  it.each([
    ["an ID that disagrees with the filename", encodeFoundationJournalJsonV1(journalOf(SECOND_ALLOCATED))],
    ["bytes that are not JSON", "not json\n"],
    ["a schema-invalid record", '{"schemaVersion":2}\n'],
  ])("refuses an allocated journal with %s", async (_label, bytes) => {
    const home = await freshLedgerHome("ledger-journal-record");
    await plantFile(home, `state/transactions/${ALLOCATED}.json`, bytes);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_bytes"]);
  });

  it("refuses a journal over 1,048,576 bytes before reading it", async () => {
    const home = await freshLedgerHome("ledger-journal-size");
    await plantFile(home, `state/transactions/${ALLOCATED}.json`, "x".repeat(MEBIBYTE + 1));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_shape"]);
  });

  it("reports a stable lock with no journal, staging or backup as lock_only", async () => {
    const home = await freshLedgerHome("ledger-lock-only");
    await plantFile(home, `state/transactions/.${ALLOCATED}.lock`, "");

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans).toHaveLength(1);
    const [orphan] = snapshot.orphans;
    expect(orphan?.kind).toBe("lock_only");
    expect(orphan?.id).toBe(ALLOCATED);
    expect(orphan?.kind === "lock_only" && orphan.lock.path).toBe(
      join(home.home, `state/transactions/.${ALLOCATED}.lock`),
    );
  });

  it("reports an ordinary rewrite temp beside its journal as rewrite_temp", async () => {
    const home = await freshLedgerHome("ledger-rewrite-temp");
    const journal = journalOf(ALLOCATED);
    await plantFile(home, `state/transactions/${ALLOCATED}.json`, encodeFoundationJournalJsonV1(journal));
    await plantFile(
      home,
      `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`,
      encodeFoundationJournalJsonV1(journal).slice(0, 20),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(snapshot)).toStrictEqual(["rewrite_temp"]);
    expect(snapshot.journals.size).toBe(1);
  });

  it("refuses two rewrite temps for one ID", async () => {
    const home = await freshLedgerHome("ledger-two-temps");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED)),
    );
    await plantFile(home, `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`, "");
    await plantFile(home, `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`, "");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_temp_count"]);
  });

  it("refuses a rewrite temp whose bytes cannot prefix a journal for its own ID", async () => {
    const home = await freshLedgerHome("ledger-temp-bytes");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED)),
    );
    await plantFile(
      home,
      `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`,
      '{"schemaVersion":1,"id":"tx_other',
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_temp_bytes"]);
  });

  it("refuses a symlink, a directory, a foreign owner, a wrong mode and a second link", async () => {
    const home = await freshLedgerHome("ledger-journal-shape");
    const bytes = encodeFoundationJournalJsonV1(journalOf(ALLOCATED));
    await plantFile(home, `state/transactions/${ALLOCATED}.json`, bytes);
    await plantFile(home, "state/transactions/payload", bytes);
    await nodeFs.symlink(
      join(home.home, "state/transactions/payload"),
      join(home.home, `state/transactions/${LEGACY}.json`),
    );
    await nodeFs.link(
      join(home.home, "state/transactions/payload"),
      join(home.home, `state/transactions/${SECOND_ALLOCATED}.json`),
    );
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);

    const symlinked = await inspect(home);
    expect(reasons(symlinked).length).toBeGreaterThan(0);
    expect(reasons(symlinked)).toStrictEqual([
      "lifecycle_foundation_journal_name",
      "lifecycle_foundation_journal_shape",
      "lifecycle_foundation_journal_shape",
    ]);

    const foreign = await inspect(home, { effectiveUid: UID + 1 });
    expect(reasons(foreign)).toStrictEqual([
      "lifecycle_ledger_root_shape",
      "lifecycle_ledger_root_shape",
      "lifecycle_ledger_root_shape",
    ]);
    expect(foreign.journals.size).toBe(0);

    await nodeFs.chmod(join(home.home, `state/transactions/${ALLOCATED}.json`), 0o644);
    expect(reasons(await inspect(home))).toContain("lifecycle_foundation_journal_shape");
  });

  it("refuses a journal owned by another uid", async () => {
    const fixture = metadataLedger({
      [`${SYNTHETIC_ROOTS.foundationJournals}/${ALLOCATED}.json`]: {
        kind: "regular_file",
        ownerUid: UID + 1,
        mode: 0o600,
        nlink: 1,
        size: "2",
      },
    });

    const snapshot = await inspectFoundationLedger(fixture, SYNTHETIC_ROOTS);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_shape"]);
    expect(snapshot.journals.size).toBe(0);
  });

  it("refuses a journal root that is not an owner-only 0700 directory", async () => {
    const home = await freshLedgerHome("ledger-root-shape");
    await nodeFs.chmod(join(home.home, "state/transactions"), 0o755);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_ledger_root_shape"]);
    expect(snapshot.counts.journalRoot).toBe(0);
  });

  it("treats an absent root as empty", async () => {
    const home = await freshLedgerHome("ledger-root-absent");
    await nodeFs.rmdir(join(home.home, "backups/transactions"));

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.counts).toStrictEqual({ journalRoot: 0, staging: 0, backups: 0 });
  });
});

describe("A13 retained bootstrap residue", () => {
  it("projects retained leaves and bootstrap participant directories away and still counts them", async () => {
    const home = await freshLedgerHome("ledger-residue");
    await plantFile(home, `state/transactions/${TOMBSTONE}`, "");
    await plantFile(home, `state/transactions/.${BOOTSTRAP_PARTICIPANT}.lock`, "");
    await plantDirectory(home, `staging/transactions/${BOOTSTRAP_PARTICIPANT}`);
    await plantDirectory(home, `backups/transactions/${BOOTSTRAP_PARTICIPANT}`);
    await plantFile(home, `backups/transactions/${BOOTSTRAP_PARTICIPANT}/${TOMBSTONE}`, "");

    const snapshot = await inspect(home, {
      residue: {
        retainedPaths: new Set([
          join(home.home, "state/transactions", TOMBSTONE),
          join(home.home, `backups/transactions/${BOOTSTRAP_PARTICIPANT}`, TOMBSTONE),
        ]),
        bootstrapParticipantIds: new Set([BOOTSTRAP_PARTICIPANT]),
      },
    });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans).toStrictEqual([]);
    expect(snapshot.counts).toStrictEqual({ journalRoot: 2, staging: 1, backups: 2 });
  });

  it("refuses the same names with no residue binding", async () => {
    const home = await freshLedgerHome("ledger-residue-unbound");
    await plantFile(home, `state/transactions/${TOMBSTONE}`, "");
    await plantFile(home, `state/transactions/.${BOOTSTRAP_PARTICIPANT}.lock`, "");
    await plantDirectory(home, `staging/transactions/${BOOTSTRAP_PARTICIPANT}`);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual([
      "lifecycle_foundation_staging_name",
      "lifecycle_foundation_journal_name",
      "lifecycle_foundation_journal_name",
    ]);
  });

  it("refuses a bootstrap participant directory holding anything but retained paths", async () => {
    const home = await freshLedgerHome("ledger-residue-child");
    await plantDirectory(home, `staging/transactions/${BOOTSTRAP_PARTICIPANT}`);
    await plantFile(home, `staging/transactions/${BOOTSTRAP_PARTICIPANT}/0.bin`, "payload");

    const snapshot = await inspect(home, {
      residue: { retainedPaths: new Set(), bootstrapParticipantIds: new Set([BOOTSTRAP_PARTICIPANT]) },
    });

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_staging_name"]);
  });

  it("refuses a bootstrap participant stable lock that is not the exact inert shape", async () => {
    const home = await freshLedgerHome("ledger-residue-lock");
    await plantFile(home, `state/transactions/.${BOOTSTRAP_PARTICIPANT}.lock`, "x");

    const snapshot = await inspect(home, {
      residue: { retainedPaths: new Set(), bootstrapParticipantIds: new Set([BOOTSTRAP_PARTICIPANT]) },
    });

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_journal_shape"]);
  });
});

describe("the companion staging and backup inventories", () => {
  it("admits every journal-derived staging and backup name", async () => {
    const home = await freshLedgerHome("ledger-derived");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED, ["create", "replace"])),
    );
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantDirectory(home, `backups/transactions/${ALLOCATED}`);
    for (const leaf of ["0.bin", "0.bin.sha256", "1.bin", "1.bin.tmp", "1.bin.sha256.tmp"]) {
      await plantFile(home, `staging/transactions/${ALLOCATED}/${leaf}`, "payload");
    }
    for (const leaf of ["0.bin", "0.bin.tmp", "1.json", "1.json.tmp", "1.json.sha256", "1.json.sha256.tmp"]) {
      await plantFile(home, `backups/transactions/${ALLOCATED}/${leaf}`, "payload");
    }

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.counts).toStrictEqual({ journalRoot: 1, staging: 6, backups: 7 });
  });

  it.each([
    ["an undeclared mutation index", "2.bin"],
    ["a backup name in staging", "0.json"],
    ["a digest of a temp", "0.bin.tmp.sha256"],
    ["an unrelated leaf", "notes.txt"],
  ])("refuses the staging leaf %s", async (_label, leaf) => {
    const home = await freshLedgerHome("ledger-staging-name");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED)),
    );
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/${leaf}`, "payload");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_foundation_staging_name");
  });

  it.each([
    ["a staging digest", "0.bin.sha256"],
    ["an unrelated leaf", "notes.txt"],
  ])("refuses the backup leaf %s", async (_label, leaf) => {
    const home = await freshLedgerHome("ledger-backup-name");
    await plantFile(
      home,
      `state/transactions/${ALLOCATED}.json`,
      encodeFoundationJournalJsonV1(journalOf(ALLOCATED)),
    );
    await plantDirectory(home, `backups/transactions/${ALLOCATED}`);
    await plantFile(home, `backups/transactions/${ALLOCATED}/${leaf}`, "payload");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_backup_name"]);
  });

  it.each([
    ["the greatest allocated index", ALLOCATED, "255.bin", true],
    ["one past the allocated range", ALLOCATED, "256.bin", false],
    ["the greatest legacy index", LEGACY, "4294967294.bin", true],
    ["one past the legacy range", LEGACY, "4294967295.bin", false],
    ["a signed index", LEGACY, "-1.bin", false],
    ["a leading zero", LEGACY, "01.bin", false],
    ["a non-decimal byte", LEGACY, "1a.bin", false],
  ])("handles %s", async (_label, id, leaf, admitted) => {
    const home = await freshLedgerHome("ledger-index");
    await plantDirectory(home, `staging/transactions/${id}`);
    await plantFile(home, `staging/transactions/${id}/${leaf}`, "payload");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(admitted ? [] : ["lifecycle_foundation_staging_name"]);
  });

  it("does not treat a coordinator participant's staging as planless", async () => {
    const home = await freshLedgerHome("ledger-participant");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, "payload");

    const planless = await inspect(home);
    expect(planless.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(planless)).toStrictEqual(["planless"]);

    const participant = await inspect(home, { participants: [ALLOCATED] });
    expect(participant.findings).toStrictEqual([]);
    expect(participant.orphans).toStrictEqual([]);
  });
});

describe("the planless orphan grammar", () => {
  async function plantPlanless(
    label: string,
    leaves: Readonly<Record<string, string>>,
  ): Promise<FoundationLedgerV1> {
    const home = await freshLedgerHome(label);
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    for (const [leaf, content] of Object.entries(leaves)) {
      await plantFile(home, `staging/transactions/${ALLOCATED}/${leaf}`, content);
    }
    return inspect(home);
  }

  const payload = "payload";
  const digest = digestText(encoder.encode(payload));

  it("admits numeric gaps whose lower indices are complete pairs", async () => {
    const snapshot = await plantPlanless("planless-gaps", {
      "0.bin": payload,
      "0.bin.sha256": digest,
      "3.bin": payload,
      "3.bin.sha256": digest,
    });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(snapshot)).toStrictEqual(["planless"]);
    expect(snapshot.orphans[0]?.kind === "planless" && snapshot.orphans[0].leaves.length).toBe(5);
  });

  it.each([
    ["a bare highest final", { "1.bin": payload }],
    ["a highest write-in-progress temp", { "1.bin.tmp": payload }],
    ["a highest final with a digest temp", { "1.bin": payload, "1.bin.sha256.tmp": digest }],
  ])("admits %s above a complete lower pair", async (_label, highest) => {
    const snapshot = await plantPlanless("planless-highest", {
      "0.bin": payload,
      "0.bin.sha256": digest,
      ...highest,
    });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(snapshot)).toStrictEqual(["planless"]);
  });

  it.each([
    ["a partial lower index", { "0.bin": payload, "1.bin": payload, "1.bin.sha256": digest }],
    ["two partial indices", { "0.bin": payload, "1.bin.tmp": payload }],
    ["a final beside its own temp", { "0.bin": payload, "0.bin.sha256": digest, "0.bin.tmp": payload }],
    [
      "a digest beside its own temp",
      { "0.bin": payload, "0.bin.sha256": digest, "0.bin.sha256.tmp": digest },
    ],
    ["a digest with no content", { "0.bin.sha256": digest }],
  ])("refuses %s", async (_label, leaves) => {
    const snapshot = await plantPlanless("planless-partial", leaves);

    expect(reasons(snapshot)).toContain("lifecycle_foundation_staging_planless");
    expect(snapshot.orphans).toStrictEqual([]);
  });

  it.each([
    ["a digest that is not 64 lowercase hex plus LF", "ff\n"],
    ["a digest with no trailing LF", digest.trimEnd()],
    ["a digest of other content", digestText(encoder.encode("other"))],
  ])("refuses %s", async (_label, content) => {
    const snapshot = await plantPlanless("planless-digest", {
      "0.bin": payload,
      "0.bin.sha256": content,
    });

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_staging_digest"]);
  });

  it("refuses a planless ID whose backup directory is not empty", async () => {
    const home = await freshLedgerHome("planless-backup");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, payload);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin.sha256`, digest);
    await plantDirectory(home, `backups/transactions/${ALLOCATED}`);
    await plantFile(home, `backups/transactions/${ALLOCATED}/0.json`, "{}");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_foundation_backup_not_empty");
    expect(snapshot.orphans).toStrictEqual([]);
  });

  it.each([
    ["an empty store temp", ""],
    ["a partial store temp", '{"schemaVersion":1,"id":"'],
  ])("admits %s over complete pairs", async (_label, bytes) => {
    const home = await freshLedgerHome("planless-temp");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, payload);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin.sha256`, digest);
    await plantFile(home, `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`, bytes);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(snapshot)).toStrictEqual(["planless"]);
  });

  it("admits a complete planned store temp whose non-remove indices equal the complete pairs", async () => {
    const home = await freshLedgerHome("planless-temp-complete");
    const planned: TransactionJournalV1 = { ...journalOf(ALLOCATED, ["create", "remove"]), phase: "planned" };
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, payload);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin.sha256`, digest);
    await plantFile(
      home,
      `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`,
      encodeFoundationJournalJsonV1(planned),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(snapshot)).toStrictEqual(["planless"]);
  });

  const plannedTwoStaged: TransactionJournalV1 = {
    ...journalOf(ALLOCATED, ["create", "replace"]),
    phase: "planned",
  };

  it.each([
    ["is not planned", journalOf(ALLOCATED, ["create"])],
    ["names indices the staging pairs do not", plannedTwoStaged],
  ])("refuses a complete store temp that %s", async (_label, journal) => {
    const home = await freshLedgerHome("planless-temp-mismatch");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, payload);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin.sha256`, digest);
    await plantFile(
      home,
      `state/transactions/.${ALLOCATED}.${randomUUID()}.json.tmp`,
      encodeFoundationJournalJsonV1(journal),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_temp_bytes"]);
  });

  it("refuses a staging leaf that is not an owner-only 0600 single-link regular file", async () => {
    const home = await freshLedgerHome("planless-shape");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin`, payload, 0o644);
    await plantFile(home, `staging/transactions/${ALLOCATED}/0.bin.sha256`, digest);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_foundation_staging_shape"]);
  });

  it("refuses a directory where a staging leaf belongs and a second link to one", async () => {
    const home = await freshLedgerHome("planless-kind");
    await plantDirectory(home, `staging/transactions/${ALLOCATED}`);
    await plantDirectory(home, `staging/transactions/${ALLOCATED}/0.bin`);
    await plantFile(home, `staging/transactions/${ALLOCATED}/1.bin`, payload);
    await nodeFs.link(
      join(home.home, `staging/transactions/${ALLOCATED}/1.bin`),
      join(home.home, `staging/transactions/${ALLOCATED}/2.bin`),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(reasons(snapshot).every((reason) => reason === "lifecycle_foundation_staging_shape")).toBe(
      true,
    );
    expect(snapshot.orphans).toStrictEqual([]);
  });
});

describe("the counting seam (A8)", () => {
  it("agrees with the in-memory port on a small physical tree", async () => {
    const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-ledger-agreement-"));
    homes.push(created);
    await nodeFs.chmod(created, 0o700);
    const home = parseCanonicalAbsolutePathText(created);
    const roots = deriveLifecycleLedgerRoots(home);
    const memory = createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: home });

    await buildAgreementTree(nodePort(), home);
    await buildAgreementTree(memory, home);

    const dependencies = {
      nonce: NONCE,
      residue: agreementResidue(home),
      effectiveUid: UID,
      coordinatorParticipantIds: new Set<string>(),
    };
    const physical = await inspectFoundationLedger({ ...dependencies, fs: nodePort() }, roots);
    const counted = await inspectFoundationLedger({ ...dependencies, fs: memory }, roots);

    expect(physical.journals.size).toBeGreaterThan(0);
    expect(physical.findings).toStrictEqual([]);
    expect(physical.orphans.length).toBeGreaterThan(0);
    expect(orphanKinds(physical)).toStrictEqual(["planless"]);
    expect(agreementShape(counted)).toStrictEqual(agreementShape(physical));
  });

  it.each([
    ["journal root", 10_000, false],
    ["journal root", 10_001, true],
    ["staging", 100_000, false],
    ["staging", 100_001, true],
    ["backups", 100_000, false],
    ["backups", 100_001, true],
  ] as const)(
    "counts the %s at %i leaves through the production path (overflow %s)",
    async (root, leaves, overflow) => {
      const fixture = syntheticLedger(root, leaves);

      const snapshot = await inspectFoundationLedger(fixture, SYNTHETIC_ROOTS);

      expect(snapshot.findings).toStrictEqual([]);
      expect(snapshot.overflow).toBe(overflow);
      expect(fixture.mutations).toStrictEqual([]);
    },
    120_000,
  );

  it(
    "refuses the millionth-and-first aggregate leaf without deleting anything",
    async () => {
      const fixture = syntheticLedger("aggregate", 1_000_001);

      const snapshot = await inspectFoundationLedger(fixture, SYNTHETIC_ROOTS);

      expect(reasons(snapshot)).toContain("ledger_capacity_exceeded");
      expect(snapshot.overflow).toBe(false);
      expect(fixture.mutations).toStrictEqual([]);
    },
    300_000,
  );
});
