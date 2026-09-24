import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { LifecycleRecoveryRequiredError, createNodeLifecycleGuardedFileSystem } from "../lifecycle/guarded-fs.js";
import { formatAllocatedLifecycleId, parseLifecycleCoordinatorId } from "../lifecycle/ids.js";
import {
  CLOCK,
  FixtureLockProvider,
  SyntheticDeath,
  UID,
  createLinkUnlinkRenameNoReplace,
  useSyntheticLifecycleHomes,
} from "../lifecycle/testing.js";
import type { LifecycleEffectRefV1 } from "../lifecycle/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal, type LowerHexSha256 } from "../update/scalars.js";
import {
  gitEffectPlanHash,
  maximumGitEffectJournalBytes,
  validateGitEffectJournal,
  validateGitEffectPlan,
  type GitEffectJournalV1,
  type GitEffectPlanV1,
} from "./effect-journal.js";
import { GitEffectExecutor, type GitEffectBoundaryV1, type GitEffectFileSystemV1 } from "./effects.js";
import type { GitEffectTransitionRoleV1, GitEffectTransitionV1 } from "./planner.js";
import {
  GIT_ZERO_OID,
  compareUnsignedUtf8,
  gitReflogAppendLine,
  gitTreeFingerprintHash,
  parseFullBranchRef,
  parseLowerHexSha1,
  type GitReflogAppendV1,
  type GitSemanticStateV1,
  type GitTreeFingerprintEntryV1,
  type GuardedGitPathStateV1,
  type PlannedGitPathStateV1,
} from "./types.js";

const createHome = useSyntheticLifecycleHomes();
const NONCE = parseLowerHexSha256("6f".repeat(32));
const COORDINATOR = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 1n), NONCE);
const EFFECT = formatAllocatedLifecycleId("ge", NONCE, 2n);
const OLD_OID = parseLowerHexSha1("1".repeat(40));
const NEW_OID = parseLowerHexSha1("2".repeat(40));
const OBJECT_OID = "ab" + "3".repeat(38);
const BRANCH = parseFullBranchRef("refs/heads/main");
const COMMITTER = { name: "Synthetic Tester", email: "tester@example.invalid", unixSeconds: 1_790_000_000, utcOffset: "+0000" };
const UUIDS = { next: 0 };

function sha256(bytes: string | Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

function uuid(): string {
  UUIDS.next += 1;
  return `00000000-0000-4000-8000-${UUIDS.next.toString(16).padStart(12, "0")}`;
}

type Group = "objects" | "index" | "reflogs" | "ref" | "tree";

function groupOf(role: GitEffectTransitionRoleV1): Group {
  if (role === "source_object" || role === "destination_pack" || role === "destination_index") return "objects";
  if (role === "source_index") return "index";
  if (role.endsWith("reflog")) return "reflogs";
  if (role === "source_git_directory_tree") return "tree";
  return "ref";
}

function pushGroup(groups: Group[], group: Group): void {
  if (groups.at(-1) !== group) groups.push(group);
}

interface TransitionSpecV1 {
  readonly role: GitEffectTransitionRoleV1;
  readonly relative: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly mode: number;
  readonly semantic?: GitSemanticStateV1;
  readonly reuse?: boolean;
}

interface FixtureV1 {
  readonly created: string;
  readonly gitDirectory: string;
  readonly plan: GitEffectPlanV1;
  readonly ref: LifecycleEffectRefV1<string>;
  readonly publications: Group[];
  readonly compensations: Group[];
  readonly boundaries: GitEffectBoundaryV1[];
  plantBeforeRename: { readonly path: string; readonly bytes: string } | null;
  dieAt: number | null;
  executor(): GitEffectExecutor;
  read(relative: string): Promise<string | null>;
  objectExists(): Promise<boolean>;
}

async function guardedState(path: string, semantic: GitSemanticStateV1): Promise<GuardedGitPathStateV1> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  const bytes = await nodeFs.readFile(path);
  return {
    state: "regular_file",
    hash: sha256(bytes),
    size: bytes.byteLength,
    mode: Number(stats.mode & 0o777n),
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
    semantic,
  };
}

function plannedOf(state: GuardedGitPathStateV1): PlannedGitPathStateV1 {
  if (state.state !== "regular_file") throw new Error("fixture plans regular files only");
  return { state: "regular_file", hash: state.hash, size: state.size, mode: state.mode, semantic: state.semantic };
}

async function writeFile(path: string, bytes: string, mode: number): Promise<void> {
  await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await nodeFs.writeFile(path, bytes, { mode });
  await nodeFs.chmod(path, mode);
}

function append(role: GitReflogAppendV1["role"], path: CanonicalAbsolutePathV1, before: string, oldOid: GitReflogAppendV1["oldOid"]): GitReflogAppendV1 {
  const line = gitReflogAppendLine({ oldOid, newOid: NEW_OID, committer: COMMITTER });
  return {
    role,
    path,
    before: { state: "present", bytesHash: sha256(before), size: Buffer.byteLength(before) },
    oldOid,
    newOid: NEW_OID,
    committer: COMMITTER,
    message: "developer-os sync",
    lineBytes: Buffer.byteLength(line),
    lineHash: sha256(line),
    after: { state: "present", bytesHash: sha256(before + line), size: Buffer.byteLength(before + line) },
  };
}

function syncSpecs(options: { readonly reuseObject?: boolean } = {}): readonly TransitionSpecV1[] {
  const line = gitReflogAppendLine({ oldOid: OLD_OID, newOid: NEW_OID, committer: COMMITTER });
  const log = `${GIT_ZERO_OID} ${OLD_OID} Synthetic Tester <tester@example.invalid> 1789000000 +0000\tcommit\n`;
  const objectPath = `objects/${OBJECT_OID.slice(0, 2)}/${OBJECT_OID.slice(2)}`;
  return [
    options.reuseObject === true
      ? { role: "source_object", relative: objectPath, before: "loose-object", after: "loose-object", mode: 0o444, reuse: true }
      : { role: "source_object", relative: objectPath, before: null, after: "loose-object", mode: 0o444 },
    { role: "source_index", relative: "index", before: "old-index", after: "new-index", mode: 0o644 },
    { role: "source_head_reflog", relative: "logs/HEAD", before: log, after: log + line, mode: 0o644 },
    { role: "source_branch_reflog", relative: "logs/refs/heads/main", before: log, after: log + line, mode: 0o644 },
    {
      role: "source_branch_ref",
      relative: "refs/heads/main",
      before: `${OLD_OID}\n`,
      after: `${NEW_OID}\n`,
      mode: 0o644,
      semantic: { kind: "oid", value: NEW_OID },
    },
  ];
}

function destinationSpecs(): readonly TransitionSpecV1[] {
  return [
    { role: "destination_pack", relative: "objects/pack/pack-synthetic.pack", before: null, after: "PACK-bytes", mode: 0o444 },
    { role: "destination_index", relative: "objects/pack/pack-synthetic.idx", before: null, after: "IDX-bytes", mode: 0o444 },
  ];
}

async function fixture(
  specs: readonly TransitionSpecV1[],
  side: "source" | "destination" = "source",
): Promise<FixtureV1> {
  const { created, home } = await createHome("git-effect");
  const worktree = join(created, side === "source" ? "brain" : "remote");
  const gitDirectory = side === "source" ? join(worktree, ".git") : `${worktree}.git`;
  await nodeFs.mkdir(gitDirectory, { recursive: true, mode: 0o755 });
  const quarantine = join(created, "staging", "lifecycle", COORDINATOR, "git", side, EFFECT);
  for (const directory of [dirname(dirname(dirname(quarantine))), dirname(dirname(quarantine)), dirname(quarantine), quarantine, join(quarantine, "post")]) {
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(directory, 0o700);
  }
  const transitions: GitEffectTransitionV1[] = [];
  const appends: GitReflogAppendV1[] = [];
  for (const [index, spec] of specs.entries()) {
    const final = parseCanonicalAbsolutePathText(join(gitDirectory, spec.relative));
    const semantic = spec.semantic ?? { kind: "none" };
    const beforeSemantic: GitSemanticStateV1 = spec.role === "source_branch_ref" ? { kind: "oid", value: OLD_OID } : semantic;
    await nodeFs.mkdir(dirname(final), { recursive: true, mode: 0o755 });
    if (spec.before !== null) await writeFile(final, spec.before, spec.mode);
    const before: GuardedGitPathStateV1 = spec.before === null ? { state: "absent" } : await guardedState(final, beforeSemantic);
    if (spec.reuse === true) {
      transitions.push({
        role: spec.role,
        path: final,
        operation: "reuse",
        before,
        after: plannedOf(before),
        evidence: { stagedPostimagePath: null, stagedPostimage: null, beforeTombstonePath: null, afterTombstonePath: null },
      });
      continue;
    }
    const post = parseCanonicalAbsolutePathText(join(quarantine, "post", index.toString(10)));
    await writeFile(post, spec.after as string, spec.mode);
    const staged = await guardedState(post, semantic);
    const operation = spec.before === null ? "create" : "replace";
    const relinquishable = operation === "create" && groupOf(spec.role) === "objects";
    transitions.push({
      role: spec.role,
      path: final,
      operation,
      before,
      after: plannedOf(staged),
      evidence: {
        stagedPostimagePath: post,
        stagedPostimage: staged,
        beforeTombstonePath: operation === "replace" ? parseCanonicalAbsolutePathText(join(quarantine, "before", index.toString(10))) : null,
        afterTombstonePath: relinquishable ? null : parseCanonicalAbsolutePathText(join(quarantine, "after", index.toString(10))),
      },
    });
    if (spec.role === "source_head_reflog" || spec.role === "source_branch_reflog") {
      appends.push(append(spec.role, final, spec.before as string, OLD_OID));
    }
  }
  const unbound: Omit<GitEffectPlanV1, "maximumJournalBytes"> = {
    schemaVersion: 1,
    id: EFFECT,
    coordinatorId: COORDINATOR,
    side,
    worktreeRoot: side === "source" ? parseCanonicalAbsolutePathText(worktree) : null,
    gitDirectory: parseCanonicalAbsolutePathText(gitDirectory),
    quarantineRoot: parseCanonicalAbsolutePathText(quarantine),
    processTableHash: sha256("process-table"),
    planningTranscriptHash: sha256("planning-transcript"),
    reflogPlan:
      appends.length === 0
        ? null
        : {
            side: "source",
            head: appends.find((entry) => entry.role === "source_head_reflog") ?? null,
            branch: appends.find((entry) => entry.role === "source_branch_reflog") ?? null,
          },
    packReaderBudget: null,
    pushSourceProjection: null,
    transitions,
  };
  const plan = validateGitEffectPlan(
    JSON.parse(encodeCanonicalJson({ ...unbound, maximumJournalBytes: maximumGitEffectJournalBytes(unbound) } as unknown as CanonicalJsonValue)),
    UID,
  );
  const journalRoot = join(created, "state", "git-effect-journals");
  await nodeFs.writeFile(join(journalRoot, `${EFFECT}.plan.json`), encodeCanonicalJson(plan as unknown as CanonicalJsonValue), { mode: 0o600 });
  return buildWorld({ created, home, gitDirectory, plan, journalRoot });
}

function buildWorld(input: {
  readonly created: string;
  readonly home: CanonicalAbsolutePathV1;
  readonly gitDirectory: string;
  readonly plan: GitEffectPlanV1;
  readonly journalRoot: string;
}): FixtureV1 {
  const publisher = createLinkUnlinkRenameNoReplace();
  const guarded = createNodeLifecycleGuardedFileSystem({ renameNoReplace: publisher.publish, effectiveUid: UID });
  const world: FixtureV1 = {
    created: input.created,
    gitDirectory: input.gitDirectory,
    plan: input.plan,
    ref: { id: input.plan.id, planHash: gitEffectPlanHash(input.plan) },
    publications: [],
    compensations: [],
    boundaries: [],
    plantBeforeRename: null,
    dieAt: null,
    executor(): GitEffectExecutor {
      return new GitEffectExecutor({
        fs,
        journalRoot: parseCanonicalAbsolutePathText(input.journalRoot),
        effectiveUid: UID,
        locks: new FixtureLockProvider(),
        clock: () => CLOCK,
        uuid,
        afterBoundary: (boundary) => {
          world.boundaries.push(boundary);
          if (boundary.kind === "renamed") {
            const group = groupOf(boundary.role);
            if (boundary.move === "stage_to_final") pushGroup(world.publications, group);
            else if (boundary.move !== "final_to_before") pushGroup(world.compensations, group);
          }
          if (world.dieAt !== null && world.boundaries.length === world.dieAt) throw new SyntheticDeath(boundary.kind);
        },
      });
    },
    async read(relative: string): Promise<string | null> {
      return nodeFs.readFile(join(input.gitDirectory, relative), "utf8").catch(() => null);
    },
    async objectExists(): Promise<boolean> {
      return (await world.read(`objects/${OBJECT_OID.slice(0, 2)}/${OBJECT_OID.slice(2)}`)) !== null;
    },
  };
  const fs: GitEffectFileSystemV1 = {
    ...guarded,
    async renameGitNoReplace(source, destinationPath) {
      const plant = world.plantBeforeRename;
      if (plant !== null && plant.path === destinationPath) {
        world.plantBeforeRename = null;
        await writeFile(plant.path, plant.bytes, 0o444);
      }
      if (await nodeFs.lstat(destinationPath).then(() => true, () => false)) return "exists";
      if (source.kind === "directory") {
        await nodeFs.rename(source.path, destinationPath);
      } else {
        await nodeFs.link(source.path, destinationPath);
        await nodeFs.unlink(source.path);
      }
      return "renamed";
    },
  };
  return world;
}

async function readJournal(world: FixtureV1): Promise<GitEffectJournalV1> {
  const text = await nodeFs.readFile(join(world.created, "state", "git-effect-journals", `${EFFECT}.json`), "utf8");
  return validateGitEffectJournal(JSON.parse(text), UID);
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

describe("GitEffectExecutor forward publication", () => {
  it("publishes in objects-index-reflogs-ref order", async () => {
    const world = await fixture(syncSpecs());
    const executor = world.executor();
    expect(await executor.observe(world.ref)).toBe("future");
    await executor.apply(world.ref);
    expect(world.publications).toEqual(["objects", "index", "reflogs", "ref"]);
    expect(await executor.observe(world.ref)).toBe("verified");
    expect(await world.read("refs/heads/main")).toBe(`${NEW_OID}\n`);
    expect(await world.read("index")).toBe("new-index");
    const journal = await readJournal(world);
    expect(journal.observations.map((observation) => observation.outcome)).toEqual([
      "created",
      "replaced",
      "replaced",
      "replaced",
      "replaced",
    ]);
  });

  it("walks every pre-apply phase before the first mutation", async () => {
    const world = await fixture(syncSpecs());
    await world.executor().apply(world.ref);
    const phases = world.boundaries.flatMap((boundary) => (boundary.kind === "journal_written" ? [boundary.phase] : []));
    expect(phases.slice(0, 5)).toEqual(["planned", "backed_up", "staged", "validated", "applied"]);
    const firstRename = world.boundaries.findIndex((boundary) => boundary.kind === "renamed");
    const firstApplied = world.boundaries.findIndex((boundary) => boundary.kind === "journal_written" && boundary.phase === "applied");
    expect(firstApplied).toBeGreaterThanOrEqual(0);
    expect(firstApplied).toBeLessThan(firstRename);
  });

  it("reuses an identical present object without touching it", async () => {
    const world = await fixture(syncSpecs({ reuseObject: true }));
    const objectPath = join(world.gitDirectory, "objects", OBJECT_OID.slice(0, 2), OBJECT_OID.slice(2));
    const before = await nodeFs.lstat(objectPath, { bigint: true });
    await world.executor().apply(world.ref);
    const after = await nodeFs.lstat(objectPath, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect((await readJournal(world)).observations[0]?.outcome).toBe("reused");
  });

  it("refuses a ref whose planHash disagrees with the persisted plan", async () => {
    const world = await fixture(syncSpecs());
    const otherHash = sha256("another plan");
    await expect(world.executor().apply({ id: world.plan.id, planHash: otherHash })).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await exists(join(world.created, "state", "git-effect-journals", `${EFFECT}.json`))).toBe(false);
  });

  it.each([
    ["identical", "loose-object"],
    ["conflicting", "someone else's bytes"],
  ])("preserves an %s leaf that appeared at an absent object before apply", async (_name, bytes) => {
    const world = await fixture(syncSpecs());
    await writeFile(join(world.gitDirectory, "objects", OBJECT_OID.slice(0, 2), OBJECT_OID.slice(2)), bytes, 0o444);
    await expect(world.executor().apply(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await world.read(`objects/${OBJECT_OID.slice(0, 2)}/${OBJECT_OID.slice(2)}`)).toBe(bytes);
    expect(await world.read("refs/heads/main")).toBe(`${OLD_OID}\n`);
  });

  it("preserves a late identical EEXIST and appends no observation", async () => {
    const world = await fixture(syncSpecs());
    const objectPath = join(world.gitDirectory, "objects", OBJECT_OID.slice(0, 2), OBJECT_OID.slice(2));
    world.plantBeforeRename = { path: objectPath, bytes: "loose-object" };
    await expect(world.executor().apply(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
    const journal = await readJournal(world);
    expect(journal.phase).toBe("applied");
    expect(journal.observations).toEqual([]);
    expect(await world.read(`objects/${OBJECT_OID.slice(0, 2)}/${OBJECT_OID.slice(2)}`)).toBe("loose-object");
    await expect(world.executor().apply(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses a destination pack/index collision between publications and keeps the published pack", async () => {
    const world = await fixture(destinationSpecs(), "destination");
    const indexPath = join(world.gitDirectory, "objects", "pack", "pack-synthetic.idx");
    world.plantBeforeRename = { path: indexPath, bytes: "IDX-bytes" };
    await expect(world.executor().apply(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await world.read("objects/pack/pack-synthetic.pack")).toBe("PACK-bytes");
    expect((await readJournal(world)).nextTransition).toBe(1);
  });

  it("refuses a ref changed by another writer after validation", async () => {
    const world = await fixture(syncSpecs());
    world.dieAt = 4;
    await expect(world.executor().apply(world.ref)).rejects.toThrow(SyntheticDeath);
    expect((await readJournal(world)).phase).toBe("validated");
    const refPath = join(world.gitDirectory, "refs", "heads", "main");
    await nodeFs.unlink(refPath);
    await writeFile(refPath, `${OLD_OID}\n`, 0o644);
    world.dieAt = null;
    await expect(world.executor().apply(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await world.read("refs/heads/main")).toBe(`${OLD_OID}\n`);
  });

  it("recovers forward after a death at every boundary", async () => {
    const probe = await fixture(syncSpecs());
    await probe.executor().apply(probe.ref);
    const total = probe.boundaries.length;
    expect(total).toBeGreaterThan(0);
    for (let boundary = 1; boundary <= total; boundary += 1) {
      const world = await fixture(syncSpecs());
      world.dieAt = boundary;
      await expect(world.executor().apply(world.ref)).rejects.toThrow(SyntheticDeath);
      world.dieAt = null;
      await world.executor().apply(world.ref);
      expect(await world.executor().observe(world.ref)).toBe("verified");
      expect(await world.read("refs/heads/main")).toBe(`${NEW_OID}\n`);
      expect((await readJournal(world)).observations).toHaveLength(syncSpecs().length);
    }
    // One fresh real-filesystem world per boundary: ~5 s under a loaded full suite.
  }, 60_000);
});

describe("GitEffectExecutor compensation", () => {
  it("restores ref before reflogs and never deletes a relinquished object", async () => {
    const world = await fixture(syncSpecs());
    const executor = world.executor();
    await executor.apply(world.ref);
    await writeFile(join(world.gitDirectory, "refs", "heads", "concurrent"), `${OBJECT_OID}\n`, 0o644);
    await executor.compensate(world.ref);
    expect(world.compensations.slice(0, 2)).toEqual(["ref", "reflogs"]);
    expect(await executor.observe(world.ref)).toBe("rolled_back");
    expect((await readJournal(world)).observations[0]?.outcome).toBe("relinquished_created_object");
    expect(await world.objectExists()).toBe(true);
    expect(await world.read("refs/heads/main")).toBe(`${OLD_OID}\n`);
    expect(await world.read("index")).toBe("old-index");
  });

  it("rolls back after a death at every compensation boundary", async () => {
    const probe = await fixture(syncSpecs());
    await probe.executor().apply(probe.ref);
    const forward = probe.boundaries.length;
    await probe.executor().compensate(probe.ref);
    const total = probe.boundaries.length - forward;
    expect(total).toBeGreaterThan(0);
    for (let boundary = 1; boundary <= total; boundary += 1) {
      const world = await fixture(syncSpecs());
      await world.executor().apply(world.ref);
      world.dieAt = world.boundaries.length + boundary;
      await expect(world.executor().compensate(world.ref)).rejects.toThrow(SyntheticDeath);
      world.dieAt = null;
      await world.executor().compensate(world.ref);
      expect(await world.executor().observe(world.ref)).toBe("rolled_back");
      expect(await world.read("refs/heads/main")).toBe(`${OLD_OID}\n`);
      expect(await world.objectExists()).toBe(true);
    }
    // One fresh real-filesystem world per boundary: ~5 s under a loaded full suite.
  }, 60_000);

  it("finishes a publication that started before the journal, then compensates it", async () => {
    const probe = await fixture(syncSpecs());
    const refIndex = syncSpecs().length - 1;
    await probe.executor().apply(probe.ref);
    const tombstoned = probe.boundaries.findIndex(
      (boundary) => boundary.kind === "renamed" && boundary.transitionIndex === refIndex && boundary.move === "final_to_before",
    );
    expect(tombstoned).toBeGreaterThan(0);
    const replay = await fixture(syncSpecs());
    replay.dieAt = tombstoned + 1;
    await expect(replay.executor().apply(replay.ref)).rejects.toThrow(SyntheticDeath);
    replay.dieAt = null;
    await replay.executor().compensate(replay.ref);
    const journal = await readJournal(replay);
    expect(journal.phase).toBe("rolled_back");
    expect(journal.nextTransition).toBe(refIndex + 1);
    expect(await replay.read("refs/heads/main")).toBe(`${OLD_OID}\n`);
  });

  it("rolls back an unapplied effect without touching Git", async () => {
    const world = await fixture(syncSpecs());
    world.dieAt = 3;
    await expect(world.executor().apply(world.ref)).rejects.toThrow(SyntheticDeath);
    world.dieAt = null;
    await world.executor().compensate(world.ref);
    expect(await world.executor().observe(world.ref)).toBe("rolled_back");
    expect(await world.objectExists()).toBe(false);
    expect(world.boundaries.some((boundary) => boundary.kind === "renamed")).toBe(false);
  });

  it("refuses to compensate a finalized effect", async () => {
    const world = await fixture(syncSpecs());
    const executor = world.executor();
    await executor.apply(world.ref);
    await executor.finalize(world.ref);
    await expect(executor.compensate(world.ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
  });
});

describe("GitEffectExecutor finalization and compaction", () => {
  it("finalizes by removing retained preimages and compacts without unlinking a published object", async () => {
    const world = await fixture(syncSpecs());
    const executor = world.executor();
    await executor.apply(world.ref);
    await executor.finalize(world.ref);
    expect(await executor.observe(world.ref)).toBe("finalized");
    for (const transition of world.plan.transitions) {
      if (transition.evidence.beforeTombstonePath !== null) {
        expect(await exists(transition.evidence.beforeTombstonePath)).toBe(false);
      }
    }
    await executor.compact(world.ref, "finalized");
    expect(await world.objectExists()).toBe(true);
    expect(await world.read("refs/heads/main")).toBe(`${NEW_OID}\n`);
    expect(await exists(world.plan.quarantineRoot)).toBe(false);
    expect(await exists(join(world.created, "staging", "lifecycle", COORDINATOR, "git"))).toBe(false);
    const leaves = await nodeFs.readdir(join(world.created, "state", "git-effect-journals"));
    expect(leaves).toEqual([]);
    await executor.compact(world.ref, "finalized");
  });

  it("compacts a rolled-back effect, keeping the relinquished object and removing its own evidence", async () => {
    const world = await fixture(syncSpecs());
    const executor = world.executor();
    await executor.apply(world.ref);
    await executor.compensate(world.ref);
    await expect(executor.compact(world.ref, "finalized")).rejects.toThrow(LifecycleRecoveryRequiredError);
    await executor.compact(world.ref, "rolled_back");
    expect(await world.objectExists()).toBe(true);
    expect(await exists(world.plan.quarantineRoot)).toBe(false);
  });

  it("compacts a never-started effect by removing its staged postimages", async () => {
    const world = await fixture(syncSpecs());
    await world.executor().compact(world.ref, "rolled_back");
    expect(await world.objectExists()).toBe(false);
    expect(await exists(world.plan.quarantineRoot)).toBe(false);
  });
});

describe("GitEffectExecutor enable-only .git publication", () => {
  async function treeFixture(): Promise<FixtureV1> {
    const { created, home } = await createHome("git-effect-tree");
    const worktree = join(created, "brain");
    await nodeFs.mkdir(worktree, { mode: 0o755 });
    const gitDirectory = join(worktree, ".git");
    const quarantine = join(created, "staging", "lifecycle", COORDINATOR, "git", "source", EFFECT);
    await nodeFs.mkdir(join(quarantine, "post"), { recursive: true, mode: 0o700 });
    for (let path = join(quarantine, "post"); path !== join(created, "staging"); path = dirname(path)) {
      await nodeFs.chmod(path, 0o700);
    }
    const post = join(quarantine, "post", "0");
    await nodeFs.mkdir(post, { mode: 0o755 });
    await nodeFs.chmod(post, 0o755);
    await writeFile(join(post, "HEAD"), "ref: refs/heads/main\n", 0o644);
    await writeFile(join(post, "config"), "[core]\n", 0o644);
    for (const directory of ["objects", "refs", "refs/heads"]) {
      await nodeFs.mkdir(join(post, directory), { recursive: true, mode: 0o755 });
      await nodeFs.chmod(join(post, directory), 0o755);
    }
    const entries: GitTreeFingerprintEntryV1[] = [];
    for (const relative of ["HEAD", "config", "objects", "refs", "refs/heads"]) {
      const stats = await nodeFs.lstat(join(post, relative), { bigint: true });
      const identity = {
        relativePath: relative,
        ownerUid: UID,
        mode: Number(stats.mode & 0o777n),
        dev: parseUInt64Decimal(stats.dev.toString(10)),
        ino: parseUInt64Decimal(stats.ino.toString(10)),
      };
      entries.push(
        (stats.isDirectory()
          ? { ...identity, kind: "directory" }
          : {
              ...identity,
              kind: "regular_file",
              nlink: 1,
              size: Number(stats.size),
              hash: sha256(await nodeFs.readFile(join(post, relative))),
            }) as GitTreeFingerprintEntryV1,
      );
    }
    entries.sort((left, right) => compareUnsignedUtf8(left.relativePath, right.relativePath));
    const root = await nodeFs.lstat(post, { bigint: true });
    const rootIdentity = {
      ownerUid: UID,
      mode: 0o755,
      dev: parseUInt64Decimal(root.dev.toString(10)),
      ino: parseUInt64Decimal(root.ino.toString(10)),
    };
    const treeHash = gitTreeFingerprintHash({ root: rootIdentity, entries } as unknown as Parameters<typeof gitTreeFingerprintHash>[0]);
    const staged = { state: "directory_tree" as const, treeHash, entryCount: entries.length, ...rootIdentity, symbolicHead: BRANCH };
    const unbound = {
      schemaVersion: 1 as const,
      id: EFFECT,
      coordinatorId: COORDINATOR,
      side: "source" as const,
      worktreeRoot: parseCanonicalAbsolutePathText(worktree),
      gitDirectory: parseCanonicalAbsolutePathText(gitDirectory),
      quarantineRoot: parseCanonicalAbsolutePathText(quarantine),
      processTableHash: sha256("process-table"),
      planningTranscriptHash: sha256("planning-transcript"),
      reflogPlan: null,
      packReaderBudget: null,
      pushSourceProjection: null,
      transitions: [
        {
          role: "source_git_directory_tree" as const,
          path: parseCanonicalAbsolutePathText(gitDirectory),
          operation: "create" as const,
          before: { state: "absent" as const },
          after: { state: "directory_tree" as const, treeHash, entryCount: entries.length, ownerUid: rootIdentity.ownerUid, mode: 0o755, symbolicHead: BRANCH },
          evidence: {
            stagedPostimagePath: parseCanonicalAbsolutePathText(post),
            stagedPostimage: staged,
            beforeTombstonePath: null,
            afterTombstonePath: null,
          },
        },
      ],
    };
    const plan = validateGitEffectPlan(
      JSON.parse(encodeCanonicalJson({ ...unbound, maximumJournalBytes: maximumGitEffectJournalBytes(unbound as never) })),
      UID,
    );
    const journalRoot = join(created, "state", "git-effect-journals");
    await nodeFs.writeFile(join(journalRoot, `${EFFECT}.plan.json`), encodeCanonicalJson(plan as unknown as CanonicalJsonValue), { mode: 0o600 });
    return buildWorld({ created, home, gitDirectory, plan, journalRoot });
  }

  it("keeps a published .git as relinquished_created_git_tree on rollback", async () => {
    const world = await treeFixture();
    const executor = world.executor();
    await executor.apply(world.ref);
    expect(world.publications).toEqual(["tree"]);
    await writeFile(join(world.gitDirectory, "objects", "late-writer"), "another Git process", 0o444);
    await executor.compensate(world.ref);
    const journal = await readJournal(world);
    expect(journal.phase).toBe("rolled_back");
    expect(journal.observations[0]?.outcome).toBe("relinquished_created_git_tree");
    expect(await world.read("HEAD")).toBe("ref: refs/heads/main\n");
    expect(await world.read("objects/late-writer")).toBe("another Git process");
    await executor.compact(world.ref, "rolled_back");
    expect(await exists(world.gitDirectory)).toBe(true);
  });

  it("removes an unpublished staged .git only through compaction", async () => {
    const world = await treeFixture();
    await world.executor().compact(world.ref, "rolled_back");
    expect(await exists(world.gitDirectory)).toBe(false);
    expect(await exists(world.plan.quarantineRoot)).toBe(false);
  });
});
