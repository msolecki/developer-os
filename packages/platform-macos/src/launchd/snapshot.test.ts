import { constants, fstatSync, readSync, readdirSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LifecycleRecoveryRequiredError,
  MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES,
  hashBytes,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LaunchdEffectIdV1,
  type LowerHexSha256,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessEvidenceV1, SupervisedSpawnRequestV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { LaunchdDistributionUnsupportedError, SUPPORTED_LAUNCHD_DISTRIBUTION } from "./distribution.js";
import { encodeLaunchdPlist } from "./plist.js";
import {
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  expandLaunchdProcessTable,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableTemplateV1,
  type SupportedLaunchdProcessTableV1,
} from "./process-table.js";
import { generatedLabel, launchdGuiDomain, parseScheduledProductHome, scheduledProgramArguments } from "./registry.js";
import {
  LaunchdSnapshotBootstrapper,
  type LaunchdBootstrapPlistIdentityV1,
  type LaunchdBootstrapSnapshotCreationV1,
  type LaunchdSnapshotDependenciesV1,
  type LaunchdSnapshotFileHandleV1,
  type LaunchdSnapshotFileSystemV1,
  type LaunchdSnapshotRequestV1,
} from "./snapshot.js";
import { LaunchdInputError, type LaunchdPlistDictionaryV1 } from "./types.js";

const uid = (process.getuid?.() ?? 501) as EffectiveUidV1;
const domain = launchdGuiDomain(uid);
const GENERATION = "3".repeat(64) as LowerHexSha256;
const NONCE = "a".repeat(64);
const EFFECT_ID = `le_${NONCE}_7` as LaunchdEffectIdV1;
const PLAN_HASH = "b".repeat(64) as LowerHexSha256;

const certifiedTemplate: SupportedLaunchdProcessTableTemplateV1 = {
  ...SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  certification: {
    certifiedAt: "2026-09-24T10:00:00.000Z" as UtcTimestampV1,
    fixtureTranscriptSha256: "c".repeat(64) as LowerHexSha256,
  },
};

class Crash extends Error {}

type Evidence = Partial<SupervisedProcessEvidenceV1>;

/** Scripted launchctl: reads FD 3 exactly as the child would, then reports the scripted outcome. */
class ScriptedRunner {
  readonly requests: SupervisedSpawnRequestV1[] = [];
  childInheritedFds: number[] = [];
  fd3Identity: { dev: bigint; ino: bigint } | null = null;
  fd3Nlink: bigint | null = null;
  fd3Bytes: Uint8Array | null = null;
  outcome: Evidence | Error = { exitCode: 0 };

  run(request: SupervisedSpawnRequestV1): Promise<SupervisedProcessEvidenceV1> {
    this.requests.push(request);
    this.childInheritedFds = request.inheritedFds.map((fd) => fd.childFd);
    const inherited = request.inheritedFds[0];
    if (inherited !== undefined) {
      const stats = fstatSync(inherited.parentFd, { bigint: true });
      this.fd3Identity = { dev: stats.dev, ino: stats.ino };
      this.fd3Nlink = stats.nlink;
      const buffer = new Uint8Array(Number(stats.size));
      readSync(inherited.parentFd, buffer, 0, buffer.byteLength, 0);
      this.fd3Bytes = buffer;
    }
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdoutBytes: 12,
      stderrBytes: 0,
      stdoutSha256: "d".repeat(64) as LowerHexSha256,
      stderrSha256: "d".repeat(64) as LowerHexSha256,
      termination: "exited",
      groupReaped: true,
      ...this.outcome,
    });
  }
}

const NODE_FS: LaunchdSnapshotFileSystemV1 = {
  lstat: (path, options) => lstat(path, options),
  open: (path, flags, mode) => open(path, flags, mode),
  readdir: (path) => readdir(path),
  unlink: (path) => unlink(path),
};

function openDescriptorCount(): number {
  return readdirSync("/dev/fd").length;
}

async function directoryIdentity(path: string): Promise<LaunchdProcessDirectoryIdentityV1> {
  const stats = await lstat(path, { bigint: true });
  return {
    path: path as CanonicalAbsolutePathV1,
    ownerUid: uid,
    mode: 448,
    dev: stats.dev.toString(10) as UInt64DecimalV1,
    ino: stats.ino.toString(10) as UInt64DecimalV1,
  };
}

interface Fixture {
  readonly base: string;
  readonly table: SupportedLaunchdProcessTableV1;
  readonly request: LaunchdSnapshotRequestV1;
  readonly bytes: Uint8Array;
  readonly expectedPlistHash: LowerHexSha256;
  readonly leafPath: string;
  readonly runner: ScriptedRunner;
  readonly realPlistIdentity: () => Promise<{ dev: bigint; ino: bigint }>;
  readonly stagingChildren: () => Promise<string[]>;
  bootstrapper(overrides?: Partial<LaunchdSnapshotDependenciesV1>): LaunchdSnapshotBootstrapper;
}

const fixtures: string[] = [];

afterEach(async () => {
  for (const base of fixtures.splice(0)) await rm(base, { recursive: true, force: true });
});

const phase: SupervisedPhaseV1 = { id: "launchd-transition", deadlineAtMs: 30000, remainingMilliseconds: () => 30000 };

async function createFixture(template: SupportedLaunchdProcessTableTemplateV1 = certifiedTemplate): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-snapshot-")));
  fixtures.push(base);
  const productHome = join(base, "product home & <co>");
  const root = join(productHome, "staging", "lifecycle", `lc_${NONCE}_3`, "launchd-process");
  await mkdir(join(root, "home"), { recursive: true });
  await mkdir(join(root, "tmp"));
  for (const path of [root, join(root, "home"), join(root, "tmp")]) await chmod(path, 0o700);
  const table = expandLaunchdProcessTable(
    { root: await directoryIdentity(root), home: await directoryIdentity(join(root, "home")), tmp: await directoryIdentity(join(root, "tmp")) },
    template,
  );

  const plist: LaunchdPlistDictionaryV1 = {
    Label: generatedLabel("doctor", GENERATION),
    ProgramArguments: scheduledProgramArguments("doctor", parseScheduledProductHome(productHome), GENERATION, "/usr/local/bin/dos" as CanonicalAbsolutePathV1),
    StartCalendarInterval: { Hour: 2, Minute: 30 },
    StandardOutPath: "/dev/null",
    StandardErrorPath: "/dev/null",
  };
  const bytes = new TextEncoder().encode(encodeLaunchdPlist(plist));
  const agents = join(base, "Library", "LaunchAgents");
  await mkdir(agents, { recursive: true });
  const plistPath = join(agents, "com.developer-os.doctor.plist");
  await writeFile(plistPath, bytes, { mode: 0o600 });
  await chmod(plistPath, 0o600);
  const stats = await lstat(plistPath, { bigint: true });
  const expectedPlistHash = hashBytes(bytes) as LowerHexSha256;
  const source: LaunchdBootstrapPlistIdentityV1 = {
    path: plistPath as CanonicalAbsolutePathV1,
    ownerUid: uid,
    mode: 384,
    nlink: 1,
    size: bytes.byteLength,
    hash: expectedPlistHash,
    dev: stats.dev.toString(10) as UInt64DecimalV1,
    ino: stats.ino.toString(10) as UInt64DecimalV1,
  };
  const request: LaunchdSnapshotRequestV1 = {
    table,
    domain,
    effectId: EFFECT_ID,
    planHash: PLAN_HASH,
    direction: "forward",
    transitionIndex: 0,
    role: "after",
    source,
    plist,
    phase,
  };
  const runner = new ScriptedRunner();
  return {
    base,
    table,
    request,
    bytes,
    expectedPlistHash,
    leafPath: join(root, "tmp", "bootstrap-plist"),
    runner,
    realPlistIdentity: async () => {
      const current = await lstat(plistPath, { bigint: true });
      return { dev: current.dev, ino: current.ino };
    },
    stagingChildren: async () => [...(await readdir(join(root, "home"))), ...(await readdir(join(root, "tmp")))],
    bootstrapper: (overrides = {}) =>
      new LaunchdSnapshotBootstrapper({
        runner,
        fs: NODE_FS,
        template,
        effectiveUid: () => uid,
        operatingSystem: () => Promise.resolve({ ...SUPPORTED_LAUNCHD_DISTRIBUTION.operatingSystem }),
        inspectExecutable: () => Promise.resolve({ ...SUPPORTED_LAUNCHD_DISTRIBUTION.executable, kind: "file" as const }),
        ...overrides,
      }),
  };
}

type CrashPoint =
  | { readonly name: string; readonly kind: "after_create" }
  | { readonly name: string; readonly kind: "partial_write"; readonly prefix: (length: number) => number }
  | { readonly name: string; readonly kind: "after_sync" }
  | { readonly name: string; readonly kind: "after_open" }
  | { readonly name: string; readonly kind: "before_unlink" }
  | { readonly name: string; readonly kind: "after_unlink" }
  | { readonly name: string; readonly kind: "before_spawn" };

const snapshotFailurePoints: readonly { readonly name: string; readonly point: CrashPoint }[] = [
  { name: "the linked create", point: { name: "the linked create", kind: "after_create" } },
  { name: "a one-byte prefix write", point: { name: "one byte", kind: "partial_write", prefix: () => 1 } },
  { name: "a half prefix write", point: { name: "half", kind: "partial_write", prefix: (length) => Math.floor(length / 2) } },
  { name: "a prefix one byte short", point: { name: "short", kind: "partial_write", prefix: (length) => length - 1 } },
  { name: "the sync", point: { name: "sync", kind: "after_sync" } },
  { name: "the verification open", point: { name: "open", kind: "after_open" } },
  { name: "immediately before the unlink", point: { name: "before unlink", kind: "before_unlink" } },
  { name: "immediately after the unlink", point: { name: "after unlink", kind: "after_unlink" } },
  { name: "the spawn", point: { name: "before spawn", kind: "before_spawn" } },
];

/** One byte per write so every prefix is a real interruption point; the create/open/sync/unlink seams die where named. */
function crashingFs(point: CrashPoint, total: number): LaunchdSnapshotFileSystemV1 {
  let writes = 0;
  return {
    ...NODE_FS,
    async open(path, flags, mode) {
      const handle = await open(path, flags, mode);
      const creating = (flags & constants.O_CREAT) !== 0;
      if (creating && point.kind === "after_create") {
        await handle.close();
        throw new Crash("after create");
      }
      if (!creating && path.endsWith("/bootstrap-plist") && point.kind === "after_open") {
        await handle.close();
        throw new Crash("after open");
      }
      if (!creating) return handle;
      const wrapped: LaunchdSnapshotFileHandleV1 = {
        fd: handle.fd,
        read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
        stat: (options) => handle.stat(options),
        close: () => handle.close(),
        async write(buffer, offset, _length, position) {
          if (point.kind === "partial_write" && writes === point.prefix(total)) throw new Crash("partial write");
          writes += 1;
          return handle.write(buffer, offset, 1, position);
        },
        async sync() {
          await handle.sync();
          if (point.kind === "after_sync") throw new Crash("after sync");
        },
      };
      return wrapped;
    },
    async unlink(path) {
      if (point.kind === "before_unlink") throw new Crash("before unlink");
      await unlink(path);
      if (point.kind === "after_unlink") throw new Crash("after unlink");
    },
  };
}

async function interruptSnapshotAt(point: CrashPoint): Promise<{ fixture: Fixture; creation: LaunchdBootstrapSnapshotCreationV1 | null; baseline: number }> {
  const fixture = await createFixture();
  const baseline = openDescriptorCount();
  const crashing = fixture.bootstrapper({ fs: crashingFs(point, fixture.bytes.byteLength) });
  if (point.kind === "before_spawn") {
    fixture.runner.outcome = new Crash("before spawn");
    await expect(crashing.bootstrap(await crashing.prepare(fixture.request))).rejects.toThrow(Crash);
    fixture.runner.outcome = { exitCode: 0 };
  } else {
    await expect(crashing.prepare(fixture.request)).rejects.toThrow(Crash);
  }
  const creation = await fixture.bootstrapper().inspect(fixture.request);
  return { fixture, creation, baseline };
}

describe("LaunchdSnapshotBootstrapper", () => {
  it("has failure points", () => {
    expect(snapshotFailurePoints.length).toBeGreaterThan(0);
    expect(races.length).toBeGreaterThan(0);
    expect(wrongCreations.length).toBeGreaterThan(0);
    expect(foreignLeaves.length).toBeGreaterThan(0);
    expect(spawnOutcomes.length).toBeGreaterThan(0);
  });

  it.each(snapshotFailurePoints)("recovers snapshot creation after $name", async ({ point }) => {
    const crashed = await interruptSnapshotAt(point);
    const bootstrapper = crashed.fixture.bootstrapper();
    const recovered = await bootstrapper.recover(crashed.creation, crashed.fixture.request);
    expect(recovered.snapshot.hash).toBe(crashed.fixture.expectedPlistHash);
    expect(recovered.snapshot.nlink).toBe(0);
    expect(await crashed.fixture.stagingChildren()).toEqual([]);
    await bootstrapper.bootstrap(recovered);
    expect(crashed.fixture.runner.fd3Bytes).toEqual(crashed.fixture.bytes);
    expect(openDescriptorCount()).toBe(crashed.baseline);
  });

  it("leaves a linked prefix of the plan bytes at every pre-unlink death", async () => {
    for (const { point } of snapshotFailurePoints.filter(({ point }) => !["after_unlink", "before_spawn"].includes(point.kind))) {
      const crashed = await interruptSnapshotAt(point);
      expect(crashed.creation).not.toBeNull();
      const creation = crashed.creation as LaunchdBootstrapSnapshotCreationV1;
      expect(creation.path).toBe(crashed.fixture.leafPath);
      expect(creation.snapshot.bytes).toEqual(crashed.fixture.bytes.subarray(0, creation.snapshot.size));
      expect(creation.snapshot.size).toBeLessThanOrEqual(MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES);
    }
  });

  it("never inherits the real plist descriptor", async () => {
    const fixture = await createFixture();
    const bootstrapper = fixture.bootstrapper();
    const attempt = await bootstrapper.prepare(fixture.request);
    const baseline = openDescriptorCount();
    await bootstrapper.bootstrap(attempt);
    const unlinkedSnapshotIdentity = { dev: BigInt(attempt.snapshot.dev), ino: BigInt(attempt.snapshot.ino) };
    expect(fixture.runner.childInheritedFds).toEqual([3]);
    expect(fixture.runner.fd3Identity).toEqual(unlinkedSnapshotIdentity);
    expect(fixture.runner.fd3Identity).not.toEqual(await fixture.realPlistIdentity());
    expect(fixture.runner.fd3Nlink).toBe(0n);
    expect(attempt.formerPath).toBe(fixture.leafPath);
    expect(openDescriptorCount()).toBe(baseline - 1);
  });

  it("spawns only the exact FD-3 bootstrap argv under the mutation profile", async () => {
    const fixture = await createFixture();
    const bootstrapper = fixture.bootstrapper();
    const evidence = await bootstrapper.bootstrap(await bootstrapper.prepare(fixture.request));
    const [request] = fixture.runner.requests;
    expect(fixture.runner.requests).toHaveLength(1);
    expect(request?.executable).toBe("/bin/launchctl");
    expect(request?.argv).toEqual(["bootstrap", domain, "/dev/fd/3"]);
    expect(request?.env).toEqual({ ...fixture.table.environment });
    expect(request?.cwd).toBe(fixture.table.staging.home.path);
    expect(request?.stdin).toBe("ignore");
    expect(request?.stdoutCap).toBe(1048576);
    expect(request?.stderrCap).toBe(1048576);
    expect(request?.wallMs).toBe(30000);
    expect(request?.idleMs).toBe(30000);
    expect(request?.terminationGraceMs).toBe(100);
    expect(request?.phase).toBe(phase);
    expect(evidence.process).toEqual({ exitCode: 0, signal: null, termination: "exited", stdoutBytes: 12, stderrBytes: 0, groupReaped: true });
    expect(JSON.stringify(evidence)).not.toContain("d".repeat(64));
  });

  const races: readonly { readonly name: string; readonly race: (path: string) => Promise<void> }[] = [
    {
      name: "a rename over the real plist",
      race: async (path) => {
        await writeFile(`${path}.new`, "<plist>replaced</plist>\n", { mode: 0o600 });
        await rename(`${path}.new`, path);
      },
    },
    {
      name: "a replacement of the real plist",
      race: async (path) => {
        await unlink(path);
        await writeFile(path, "<plist>replaced</plist>\n", { mode: 0o600 });
      },
    },
    {
      name: "an in-place write to the real plist",
      race: async (path) => {
        const handle = await open(path, constants.O_WRONLY);
        await handle.write(new TextEncoder().encode("<!-- in place -->"), 0, 17, 0);
        await handle.close();
      },
    },
  ];

  it.each(races)("keeps FD 3 on the verified bytes after $name, and the recheck reports the drift", async ({ race }) => {
    const fixture = await createFixture();
    const bootstrapper = fixture.bootstrapper();
    const attempt = await bootstrapper.prepare(fixture.request);
    await race(fixture.request.source.path);
    await bootstrapper.bootstrap(attempt);
    expect(fixture.runner.fd3Bytes).toEqual(fixture.bytes);
    await expect(bootstrapper.recheckSource(fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  const wrongCreations: readonly { readonly name: string; readonly mutate: (creation: LaunchdBootstrapSnapshotCreationV1) => LaunchdBootstrapSnapshotCreationV1 }[] = [
    { name: "frontier direction", mutate: (creation) => ({ ...creation, direction: "reverse" }) },
    { name: "preimage source", mutate: (creation) => ({ ...creation, source: { ...creation.source, hash: "e".repeat(64) as LowerHexSha256 } }) },
    { name: "path", mutate: (creation) => ({ ...creation, path: `${creation.path}-other` as CanonicalAbsolutePathV1 }) },
    { name: "role", mutate: (creation) => ({ ...creation, role: "before" }) },
    { name: "effect", mutate: (creation) => ({ ...creation, effectId: `le_${NONCE}_8` as LaunchdEffectIdV1 }) },
    { name: "plan", mutate: (creation) => ({ ...creation, planHash: "f".repeat(64) as LowerHexSha256 }) },
    { name: "transition", mutate: (creation) => ({ ...creation, transitionIndex: 1 }) },
    { name: "inode", mutate: (creation) => ({ ...creation, snapshot: { ...creation.snapshot, ino: "1" as UInt64DecimalV1 } }) },
    { name: "size", mutate: (creation) => ({ ...creation, snapshot: { ...creation.snapshot, size: creation.snapshot.size + 1 } }) },
  ];

  it.each(wrongCreations)("preserves the linked leaf when the creation has the wrong $name", async ({ mutate }) => {
    const crashed = await interruptSnapshotAt({ name: "half", kind: "partial_write", prefix: (length) => Math.floor(length / 2) });
    const creation = crashed.creation as LaunchdBootstrapSnapshotCreationV1;
    await expect(crashed.fixture.bootstrapper().recover(mutate(creation), crashed.fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await crashed.fixture.stagingChildren()).toEqual(["bootstrap-plist"]);
    expect(crashed.fixture.runner.requests).toHaveLength(0);
  });

  it("preserves a leaf whose metadata drifted", async () => {
    const crashed = await interruptSnapshotAt({ name: "sync", kind: "after_sync" });
    await chmod(crashed.fixture.leafPath, 0o644);
    const bootstrapper = crashed.fixture.bootstrapper();
    await expect(bootstrapper.inspect(crashed.fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(bootstrapper.recover(crashed.creation, crashed.fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await crashed.fixture.stagingChildren()).toEqual(["bootstrap-plist"]);
  });

  const foreignLeaves: readonly { readonly name: string; readonly bytes: (plan: Uint8Array) => Uint8Array; readonly extra?: string }[] = [
    { name: "non-prefix bytes", bytes: (plan) => Uint8Array.from(plan, (byte, index) => (index === 3 ? byte ^ 1 : byte)) },
    { name: "bytes past the plan", bytes: (plan) => Uint8Array.from([...plan, 0x0a]) },
    { name: "over-limit bytes", bytes: () => new Uint8Array(MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES + 1).fill(0x20) },
    { name: "a second leaf", bytes: (plan) => plan.subarray(0, 4), extra: "bootstrap-plist-2" },
  ];

  it.each(foreignLeaves)("preserves $name as recovery-required", async ({ bytes, extra }) => {
    const fixture = await createFixture();
    await writeFile(fixture.leafPath, bytes(fixture.bytes), { mode: 0o600 });
    if (extra !== undefined) await writeFile(join(fixture.table.staging.tmp.path, extra), "x", { mode: 0o600 });
    const bootstrapper = fixture.bootstrapper();
    await expect(bootstrapper.inspect(fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(bootstrapper.prepare(fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(bootstrapper.recover(null, fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect((await fixture.stagingChildren()).length).toBeGreaterThan(0);
    expect(fixture.runner.requests).toHaveLength(0);
  });

  const spawnOutcomes: readonly { readonly name: string; readonly outcome: Evidence | Error; readonly settles: "resolve" | "reject" }[] = [
    { name: "spawn refusal", outcome: new Error("Supervised process failed to start"), settles: "reject" },
    { name: "timeout", outcome: { exitCode: null, signal: "SIGKILL", termination: "wall_deadline" }, settles: "resolve" },
    { name: "transition deadline", outcome: { exitCode: null, signal: "SIGTERM", termination: "phase_deadline" }, settles: "resolve" },
    { name: "command failure", outcome: { exitCode: 5 }, settles: "resolve" },
    { name: "success", outcome: { exitCode: 0 }, settles: "resolve" },
  ];

  it.each(spawnOutcomes)("closes every parent descriptor and leaves staging empty after $name", async ({ outcome, settles }) => {
    const fixture = await createFixture();
    const baseline = openDescriptorCount();
    const bootstrapper = fixture.bootstrapper();
    const attempt = await bootstrapper.prepare(fixture.request);
    expect(openDescriptorCount()).toBe(baseline + 1);
    fixture.runner.outcome = outcome;
    if (settles === "reject") await expect(bootstrapper.bootstrap(attempt)).rejects.toThrow();
    else expect((await bootstrapper.bootstrap(attempt)).attempt).toBe(attempt);
    expect(openDescriptorCount()).toBe(baseline);
    expect(await fixture.stagingChildren()).toEqual([]);
    await expect(bootstrapper.bootstrap(attempt)).rejects.toThrow(LaunchdInputError);
    expect(fixture.runner.requests).toHaveLength(1);
  });

  it("refuses when uncertified, with no linked or pathname fallback", async () => {
    const fixture = await createFixture(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE);
    const baseline = openDescriptorCount();
    const bootstrapper = fixture.bootstrapper();
    await expect(bootstrapper.prepare(fixture.request)).rejects.toThrow("unsupported_launchd_distribution");
    await expect(bootstrapper.prepare(fixture.request)).rejects.toThrow(LaunchdDistributionUnsupportedError);
    await expect(bootstrapper.recover(null, fixture.request)).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(await fixture.stagingChildren()).toEqual([]);
    expect(fixture.runner.requests).toHaveLength(0);
    expect(openDescriptorCount()).toBe(baseline);
  });

  it("refuses a drifted host before spawn and still closes the snapshot", async () => {
    const fixture = await createFixture();
    const baseline = openDescriptorCount();
    const bootstrapper = fixture.bootstrapper({
      operatingSystem: () => Promise.resolve({ ...SUPPORTED_LAUNCHD_DISTRIBUTION.operatingSystem, buildVersion: "25G84" }),
    });
    await expect(bootstrapper.bootstrap(await bootstrapper.prepare(fixture.request))).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(fixture.runner.requests).toHaveLength(0);
    expect(openDescriptorCount()).toBe(baseline);
  });

  it("refuses a source that is not the plan-bound identity before creating a leaf", async () => {
    const fixture = await createFixture();
    const bootstrapper = fixture.bootstrapper();
    await expect(bootstrapper.prepare({ ...fixture.request, source: { ...fixture.request.source, hash: "e".repeat(64) as LowerHexSha256 } })).rejects.toThrow(LaunchdInputError);
    await writeFile(fixture.request.source.path, fixture.bytes.subarray(1));
    await expect(bootstrapper.prepare(fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await fixture.stagingChildren()).toEqual([]);
  });

  it("refuses another user's gui domain", async () => {
    const fixture = await createFixture();
    const other = launchdGuiDomain((uid + 1) as EffectiveUidV1);
    await expect(fixture.bootstrapper().prepare({ ...fixture.request, domain: other })).rejects.toThrow(LaunchdInputError);
    expect(await fixture.stagingChildren()).toEqual([]);
  });

  it("refuses staging that gained a child in home", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.table.staging.home.path, "launchctl-created"), "x");
    await expect(fixture.bootstrapper().prepare(fixture.request)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await fixture.stagingChildren()).toEqual(["launchctl-created"]);
  });
});
