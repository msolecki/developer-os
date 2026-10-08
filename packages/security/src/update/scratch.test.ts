import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants as zlibConstants, zstdCompressSync } from "node:zlib";

import {
  createNodeLifecycleGuardedFileSystem,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
  ReleaseBundleReferenceV1,
  UInt64DecimalV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import {
  deriveReleaseScratchCleanupList,
  ReleasePlanningScratchStore,
  releasePlanningScratchLockPath,
  releasePlanningScratchPaths,
  validateReleasePlanningScratchJournal,
  type ReleasePlanningScratchAttempt,
  type ReleasePlanningScratchStoreDependencies,
  type ReleaseScratchBoundaryV1,
} from "./scratch.js";
import type { BoundedReleaseResponseV1, ReleaseBodySink } from "./scratch.js";

const UID = process.getuid?.() ?? 0;
const encoder = new TextEncoder();
const roots: string[] = [];

class SyntheticDeath extends Error {
  constructor(boundary: ReleaseScratchBoundaryV1) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

const FILES = [
  { path: "bin", kind: "directory", mode: 448, content: new Uint8Array(0) },
  { path: "bin/developer-os", kind: "file", mode: 448, content: encoder.encode("#!/bin/sh\necho synthetic\n") },
  { path: "bin/planner", kind: "file", mode: 448, content: encoder.encode("synthetic planner\n") },
  { path: "bin/runtime", kind: "file", mode: 448, content: new Uint8Array(700).fill(0x61) },
  { path: "bin/verifier", kind: "file", mode: 448, content: new Uint8Array(0) },
  { path: "notice.txt", kind: "file", mode: 384, content: encoder.encode("synthetic notice\n") },
] as const;

const MANIFEST: ReleaseBundleManifestV1 = validateBundleManifest({
  schemaVersion: 1,
  version: "1.2.3",
  releaseSequence: "7",
  platform: "darwin",
  architecture: "arm64",
  launcherProtocol: 1,
  updateProtocol: 1,
  entrypoint: "bin/developer-os",
  runtimeEntrypoint: "bin/runtime",
  plannerEntrypoint: "bin/planner",
  verifierEntrypoint: "bin/verifier",
  entries: FILES.map((file): unknown =>
    file.kind === "directory"
      ? { path: file.path, kind: "directory", mode: 448 }
      : { path: file.path, kind: "file", mode: file.mode, bytes: String(file.content.byteLength), sha256: sha256(file.content) },
  ),
});

function ustar(): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const file of FILES) {
    const header = new Uint8Array(512);
    const put = (offset: number, text: string): void => {
      header.set(encoder.encode(text), offset);
    };
    const boundary = file.path.lastIndexOf("/");
    put(0, boundary < 0 ? file.path : file.path.slice(boundary + 1));
    put(100, `${file.mode.toString(8).padStart(7, "0")}\0`);
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${file.content.byteLength.toString(8).padStart(11, "0")}\0`);
    put(136, "14000000000\0");
    put(156, file.kind === "directory" ? "5" : "0");
    put(257, "ustar\0");
    put(263, "00");
    put(345, boundary < 0 ? "" : file.path.slice(0, boundary));
    let sum = 0;
    for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, file.content, new Uint8Array((512 - (file.content.byteLength % 512)) % 512));
  }
  parts.push(new Uint8Array(1_024));
  return Buffer.concat(parts);
}

const ARCHIVE = zstdCompressSync(ustar(), {
  params: { [zlibConstants.ZSTD_c_checksumFlag]: 1, [zlibConstants.ZSTD_c_contentSizeFlag]: 1 },
});
const BUNDLE = {
  platform: "darwin",
  architecture: "arm64",
  archiveFormat: "zstd-ustar-v1",
  archivePath: "v1.2.3/developer-os-darwin-arm64.tar.zst",
  archiveBytes: String(ARCHIVE.byteLength),
  archiveSha256: sha256(ARCHIVE),
  manifestPath: "v1.2.3/developer-os-darwin-arm64.manifest.json",
  manifestBytes: "1",
  manifestSha256: "0".repeat(64),
} as ReleaseBundleReferenceV1;

interface ScratchHomeV1 {
  readonly systemTemp: CanonicalAbsolutePathV1;
  /**
   * Each store is one process: by default it gets its own lock table, so a store that "died"
   * holds nothing another sees. `locks` shares one table, as one flock namespace does for two
   * live processes on the same temp.
   */
  readonly store: (options?: {
    readonly afterBoundary?: (boundary: ReleaseScratchBoundaryV1) => void | Promise<void>;
    readonly uuid?: () => string;
    readonly locks?: Set<string>;
  }) => ReleasePlanningScratchStore;
}

/** An in-memory stand-in for the production try-flock: creates the lock file, never waits. */
function lockTable(held: Set<string>): ReleasePlanningScratchStoreDependencies["tryLock"] {
  return async (path) => {
    if (held.has(path)) return null;
    held.add(path);
    await nodeFs.writeFile(path, "", { flag: "a", mode: 0o600 });
    return {
      release: () => {
        held.delete(path);
        return Promise.resolve();
      },
    };
  };
}

async function scratchHome(): Promise<ScratchHomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-scratch-test-"));
  roots.push(created);
  await nodeFs.chmod(created, 0o700);
  const systemTemp = parseCanonicalAbsolutePathText(await nodeFs.realpath(created));
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: UID,
    renameNoReplace: async (request) => {
      await nodeFs.link(request.sourcePath, request.destinationPath);
      await nodeFs.unlink(request.sourcePath);
    },
  });
  return {
    systemTemp,
    store: (options = {}) =>
      new ReleasePlanningScratchStore({
        fs,
        systemTemp,
        effectiveUid: UID,
        uuid: options.uuid ?? randomUUID,
        clock: () => new Date().toISOString(),
        tryLock: lockTable(options.locks ?? new Set()),
        ...(options.afterBoundary === undefined ? {} : { afterBoundary: options.afterBoundary }),
      }),
  };
}

const REQUEST = {
  archive: { bytes: String(ARCHIVE.byteLength) as UInt64DecimalV1, sha256: sha256(ARCHIVE) },
  manifestHash: sha256("synthetic manifest"),
  manifest: MANIFEST,
  maximumScratchBytes: 12_884_901_888,
};

function deliver(bytes: Uint8Array): (sink: ReleaseBodySink) => Promise<BoundedReleaseResponseV1> {
  return async (sink) => {
    for (let offset = 0; offset < bytes.byteLength; offset += 101) await sink(bytes.subarray(offset, offset + 101));
    return { bodyBytes: String(bytes.byteLength) as UInt64DecimalV1, bodyHash: sha256(bytes) };
  };
}

async function listing(path: string): Promise<readonly string[]> {
  return (await nodeFs.readdir(path)).sort();
}

async function completeAttempt(store: ReleasePlanningScratchStore): Promise<ReleasePlanningScratchAttempt> {
  const attempt = await store.create(REQUEST);
  await attempt.download(deliver(ARCHIVE));
  await attempt.extract(BUNDLE);
  return attempt;
}

/** Dies at the `occurrence`th time `target` is reached, then recovers with a fresh store instance. */
async function interruptScratch(target: ReleaseScratchBoundaryV1, occurrence = 1) {
  const home = await scratchHome();
  await nodeFs.writeFile(join(home.systemTemp, "unrelated-preexisting"), "keep me\n", { mode: 0o600 });
  let seen = 0;
  const dying = home.store({
    afterBoundary: (boundary) => {
      if (boundary === target && (seen += 1) === occurrence) throw new SyntheticDeath(boundary);
    },
  });
  const attempt = await completeAttempt(dying).catch((error: unknown) => {
    if (!(error instanceof SyntheticDeath)) throw error;
    return null;
  });
  if (attempt !== null) await attempt.cleanup().catch((error: unknown) => {
    if (!(error instanceof SyntheticDeath)) throw error;
  });
  const before = await listing(home.systemTemp);
  const recovering = home.store();
  return {
    before,
    async cleanup(): Promise<void> {
      for (const id of await recovering.listRecoverableAttempts()) await recovering.recoverCleanup(id);
    },
    async assertNoUnknownDeletion(): Promise<boolean> {
      const after = await listing(home.systemTemp);
      return after.includes("unrelated-preexisting") && after.every((name) => before.includes(name));
    },
    async remaining(): Promise<readonly string[]> {
      return (await listing(home.systemTemp)).filter((name) => name !== "unrelated-preexisting" && !name.endsWith(".tmp"));
    },
  };
}

/** Deaths after a durable identity: cleanup removes every attempt-created path. */
const scratchDeathPoints: readonly { readonly name: ReleaseScratchBoundaryV1; readonly occurrence: number }[] = [
  { name: "journal_published", occurrence: 1 },
  { name: "root_intent", occurrence: 1 },
  { name: "root_recorded", occurrence: 1 },
  { name: "extracted_intent", occurrence: 1 },
  { name: "extracted_recorded", occurrence: 1 },
  { name: "evidence_root_intent", occurrence: 1 },
  { name: "evidence_root_recorded", occurrence: 1 },
  { name: "archive_intent", occurrence: 1 },
  { name: "archive_recorded", occurrence: 1 },
  { name: "archive_complete", occurrence: 1 },
  { name: "extracting", occurrence: 1 },
  { name: "entry_intent", occurrence: 1 },
  { name: "entry_recorded", occurrence: 1 },
  { name: "entry_recorded", occurrence: 2 },
  { name: "entry_written", occurrence: 2 },
  { name: "evidence_intent", occurrence: 3 },
  { name: "evidence_recorded", occurrence: 3 },
  { name: "entry_advanced", occurrence: 4 },
  { name: "verified", occurrence: 1 },
  { name: "cleaning", occurrence: 1 },
  { name: "cleanup_step", occurrence: 1 },
  { name: "cleanup_step", occurrence: 7 },
  { name: "cleaned", occurrence: 1 },
  { name: "plan_removed", occurrence: 1 },
];

/** Deaths between an exclusive create and its recorded identity: the path is preserved and cleanup refuses. */
const ambiguousDeathPoints: readonly { readonly name: ReleaseScratchBoundaryV1; readonly occurrence: number }[] = [
  { name: "root_created", occurrence: 1 },
  { name: "extracted_created", occurrence: 1 },
  { name: "evidence_root_created", occurrence: 1 },
  { name: "archive_created", occurrence: 1 },
  { name: "entry_created", occurrence: 1 },
  { name: "entry_created", occurrence: 3 },
  { name: "evidence_created", occurrence: 2 },
];

describe("ReleasePlanningScratchStore", () => {
  it("publishes the plan and journal before the root and extracts a verified bundle", async () => {
    const home = await scratchHome();
    const store = home.store();
    const attempt = await store.create(REQUEST);
    const paths = releasePlanningScratchPaths(home.systemTemp, UID, attempt.plan.id);

    expect(attempt.plan.root).toBe(paths.root);
    expect((await nodeFs.lstat(paths.planPath)).mode & 0o777).toBe(0o600);
    expect((await nodeFs.lstat(paths.root)).mode & 0o777).toBe(0o700);
    expect(attempt.journal.phase).toBe("planned");
    expect(attempt.journal.rootWriteState?.state).toBe("created");

    await attempt.download(deliver(ARCHIVE));
    const verified = await attempt.extract(BUNDLE);

    expect(verified).toMatchObject({ id: attempt.plan.id, entries: FILES.length, root: `${paths.root}/extracted` });
    expect(attempt.journal).toMatchObject({ phase: "verified", nextExtractedEntry: FILES.length, entryWriteState: null });
    for (const file of FILES) {
      const stats = await nodeFs.lstat(join(verified.root, file.path));
      expect(stats.mode & 0o777).toBe(file.mode === 448 ? 0o700 : 0o600);
      if (file.kind === "file") expect(new Uint8Array(await nodeFs.readFile(join(verified.root, file.path)))).toEqual(file.content);
    }
    expect(await listing(join(paths.root, "evidence"))).toEqual(FILES.map((_, ordinal) => `${String(ordinal).padStart(10, "0")}.json`));
  });

  it("removes scratch deepest-first on normal completion and leaves the temp untouched otherwise", async () => {
    const home = await scratchHome();
    await nodeFs.writeFile(join(home.systemTemp, "unrelated-preexisting"), "keep me\n");
    const attempt = await completeAttempt(home.store());

    await attempt.cleanup();

    expect(await listing(home.systemTemp)).toEqual(["unrelated-preexisting"]);
  });

  it("preserves a colliding candidate and tries a fresh ID", async () => {
    const home = await scratchHome();
    const colliding = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const collision = releasePlanningScratchPaths(home.systemTemp, UID, `rp_${colliding}`);
    await nodeFs.mkdir(collision.root, { mode: 0o700 });
    const ids = [colliding, randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    const attempt = await home.store({ uuid: () => ids.shift() ?? randomUUID() }).create(REQUEST);

    expect(attempt.plan.id).not.toBe(`rp_${colliding}`);
    expect((await nodeFs.lstat(collision.root)).isDirectory()).toBe(true);
  });

  it("removes its own just-published plan when another process holds that candidate's lock, then tries a fresh ID", async () => {
    const home = await scratchHome();
    const contested = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const paths = releasePlanningScratchPaths(home.systemTemp, UID, `rp_${contested}`);
    const locks = new Set([releasePlanningScratchLockPath(paths.journalPath)]);
    const ids = [contested, randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    const attempt = await home.store({ locks, uuid: () => ids.shift() ?? randomUUID() }).create(REQUEST);

    expect(attempt.plan.id).not.toBe(`rp_${contested}`);
    await expect(nodeFs.lstat(paths.planPath)).rejects.toMatchObject({ code: "ENOENT" });
    await attempt.cleanup();
    expect(await listing(home.systemTemp)).toEqual([]);
  });

  it("refuses after 32 colliding candidates and creates nothing", async () => {
    const home = await scratchHome();
    const colliding = "0f0e0d0c-0b0a-4908-8706-050403020100";
    await nodeFs.mkdir(releasePlanningScratchPaths(home.systemTemp, UID, `rp_${colliding}`).root, { mode: 0o700 });
    const before = await listing(home.systemTemp);

    await expect(home.store({ uuid: () => colliding }).create(REQUEST)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await listing(home.systemTemp)).toEqual(before);
  });

  it("refuses a first-over-limit scratch byte bound before creating anything", async () => {
    const home = await scratchHome();

    await expect(home.store().create({ ...REQUEST, maximumScratchBytes: 1_024 })).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(await listing(home.systemTemp)).toEqual([]);
  });

  it("refuses a download beyond the signed archive size", async () => {
    const home = await scratchHome();
    const attempt = await home.store().create(REQUEST);

    await expect(attempt.download(deliver(Buffer.concat([ARCHIVE, Uint8Array.of(0)])))).rejects.toBeInstanceOf(SecurityRefusalError);
    await attempt.cleanup();
    expect(await listing(home.systemTemp)).toEqual([]);
  });

  it("rethrows a non-refusal sink failure as itself rather than the transport's network label", async () => {
    const home = await scratchHome();
    const attempt = await home.store().create(REQUEST);
    const relabelled = new Error("release_transport_network");

    const failure = await attempt
      .download(async (sink) => {
        await sink("not bytes" as unknown as Uint8Array).catch(() => undefined);
        throw relabelled;
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TypeError);
  });

  it("preserves an unknown child and refuses cleanup of its directory", async () => {
    const home = await scratchHome();
    const attempt = await completeAttempt(home.store());
    await nodeFs.writeFile(join(attempt.plan.root, "extracted", "bin", "planted"), "unknown\n");

    await expect(attempt.cleanup()).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await nodeFs.readFile(join(attempt.plan.root, "extracted", "bin", "planted"), "utf8")).toBe("unknown\n");
  });

  it("preserves a replaced inode instead of deleting it", async () => {
    const home = await scratchHome();
    const attempt = await completeAttempt(home.store());
    const target = join(attempt.plan.root, "extracted", "notice.txt");
    await nodeFs.unlink(target);
    await nodeFs.writeFile(target, "synthetic notice\n", { mode: 0o600 });

    await expect(attempt.cleanup()).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await nodeFs.readFile(target, "utf8")).toBe("synthetic notice\n");
  });

  it("preserves a plan-only residue and never lists it", async () => {
    const home = await scratchHome();
    const id = `rp_${randomUUID()}` as const;
    const paths = releasePlanningScratchPaths(home.systemTemp, UID, id);
    await nodeFs.writeFile(paths.planPath, "{}\n", { mode: 0o600 });
    const store = home.store();

    expect(await store.listRecoverableAttempts()).toEqual([]);
    await store.recoverCleanup(id);
    expect(await listing(home.systemTemp)).toEqual([paths.planPath.slice(home.systemTemp.length + 1)]);
  });

  it("leaves a live attempt of a concurrent process untouched, which then completes and cleans up (NEW-173)", async () => {
    const home = await scratchHome();
    const locks = new Set<string>();
    let paused: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const atEntry = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let seen = 0;
    const live = completeAttempt(home.store({
      locks,
      afterBoundary: (boundary) => {
        if (boundary !== "entry_recorded" || (seen += 1) !== 1) return undefined;
        reached();
        return new Promise<void>((resolve) => {
          paused = resolve;
        });
      },
    }));
    await atEntry;
    const before = await listing(home.systemTemp);
    const [journal] = before.filter((name) => name.endsWith(".journal.json"));
    const journalBytes = await nodeFs.readFile(join(home.systemTemp, journal as string));

    const sweeper = home.store({ locks });
    const ids = await sweeper.listRecoverableAttempts();
    expect(ids).toHaveLength(1);
    for (const id of ids) await sweeper.recoverCleanup(id);

    expect(await listing(home.systemTemp)).toEqual(before);
    expect(await nodeFs.readFile(join(home.systemTemp, journal as string))).toEqual(journalBytes);
    paused();
    const attempt = await live;
    expect(attempt.journal.phase).toBe("verified");
    await attempt.cleanup();
    expect(await listing(home.systemTemp)).toEqual([]);
  });

  it("grants no authority over a plan temp that was never published", async () => {
    const state = await interruptScratch("plan_temp_written");

    await state.cleanup();

    expect(await state.assertNoUnknownDeletion()).toBe(true);
    expect(await state.remaining()).toEqual([]);
    expect(state.before.some((name) => name.endsWith(".tmp"))).toBe(true);
  });

  it("preserves a published plan whose initial journal never existed", async () => {
    const state = await interruptScratch("plan_published");

    await state.cleanup();

    expect(await state.assertNoUnknownDeletion()).toBe(true);
    expect(await state.remaining()).toEqual(state.before.filter((name) => name.endsWith(".plan.json")));
  });

  it.each(scratchDeathPoints)("cleans only recorded identities at $name (#$occurrence)", async (point) => {
    const state = await interruptScratch(point.name, point.occurrence);

    await state.cleanup();

    expect(await state.assertNoUnknownDeletion()).toBe(true);
    expect(await state.remaining()).toEqual([]);
  });

  it.each(ambiguousDeathPoints)("preserves an unrecorded create at $name (#$occurrence)", async (point) => {
    const state = await interruptScratch(point.name, point.occurrence);

    await expect(state.cleanup()).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    expect(await state.assertNoUnknownDeletion()).toBe(true);
    expect(await state.remaining()).not.toEqual([]);
  });
});

describe("ReleasePlanningScratchJournalV1 grammar", () => {
  async function verifiedJournal() {
    const home = await scratchHome();
    const attempt = await completeAttempt(home.store());
    return attempt;
  }

  it("accepts the recorded verified journal", async () => {
    const attempt = await verifiedJournal();

    expect(validateReleasePlanningScratchJournal(attempt.journal, attempt.plan, attempt.planHash)).toEqual(attempt.journal);
  });

  it.each([
    ["an extraction cursor beyond the manifest", { nextExtractedEntry: FILES.length + 1 }],
    ["a verified phase with an open microstate", { entryWriteState: { ordinal: FILES.length - 1, state: "create_intent" } }],
    ["a cleanup cursor outside cleaning", { cleanupNext: 0 }],
    ["archive bytes beyond the plan", { archiveBytesWritten: String(ARCHIVE.byteLength + 1) }],
    ["an archive identity different from its created state", { archiveIdentity: { dev: "1", ino: "2" } }],
    ["a planned phase with a downloaded archive", { phase: "planned" }],
    ["a missing root before evidence", { rootWriteState: null }],
    ["an unknown key", { extra: true }],
    ["another plan hash", { planHash: "0".repeat(64) }],
  ])("refuses %s", async (_name, change) => {
    const attempt = await verifiedJournal();

    expect(() => validateReleasePlanningScratchJournal({ ...attempt.journal, ...change }, attempt.plan, attempt.planHash)).toThrow();
  });

  it("refuses a cleanup cursor beyond the derived reached list", async () => {
    const attempt = await verifiedJournal();
    const length = deriveReleaseScratchCleanupList(attempt.plan, attempt.journal).length;

    expect(length).toBe(2 * FILES.length + 4);
    expect(() =>
      validateReleasePlanningScratchJournal({ ...attempt.journal, phase: "cleaning", cleanupNext: length + 1 }, attempt.plan, attempt.planHash),
    ).toThrow();
    expect(() =>
      validateReleasePlanningScratchJournal({ ...attempt.journal, phase: "cleaned", cleanupNext: length - 1 }, attempt.plan, attempt.planHash),
    ).toThrow();
  });
});
