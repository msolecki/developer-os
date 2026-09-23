/**
 * D54: a re-run `init` settles a finalized bootstrap whose manifest a committed gated
 * transaction moved, through the durable anchor the mutation gate writes; a hand edit or a
 * tampered anchor still refuses with exit 6.
 */
import * as nodeFs from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson, EXIT_CODES, hashBytes } from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2 } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { BOOTSTRAP_MANUAL_ARCHIVE } from "../bootstrap/report.js";
import { runDoctorReport } from "../commands/doctor.js";
import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import type { ReleaseFileV1 } from "../update/local-release.js";
import type { CliLifecycleContext } from "./context.js";
import {
  decodeManifestAnchor,
  encodeManifestAnchor,
  isOwnedManifestAnchorShape,
  MANIFEST_ANCHOR_WARNING,
  manifestAnchorPath,
} from "./manifest-anchor.js";
import { withLifecycleMutation } from "./mutation-gate.js";

afterAll(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const CLAUDE = "/opt/synthetic/bin/claude";
const encoder = new TextEncoder();

async function initialisedV2Home(
  label: string,
  options: Parameters<typeof createCommandFixture>[1] = {},
): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label, { ...options, bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const result = await runInit(fixture.context, ACCEPTED);
  if (!result.ok) throw new Error(`fixture init failed: ${JSON.stringify(result)}`);
  return fixture;
}

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

async function manifestBytes(fixture: CommandFixture): Promise<Uint8Array> {
  return new Uint8Array(await nodeFs.readFile(fixture.paths.manifestFile));
}

/** The same manifest with one row's `verifiedAt` moved: canonical, structurally valid, and undrifted. */
function touched(bytes: Uint8Array, verifiedAt: string): Uint8Array {
  const manifest = decodeCanonicalJson(bytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
  const [first, ...rest] = manifest.artifacts;
  if (first === undefined) throw new Error("the fixture manifest has no rows");
  return encoder.encode(encodeCanonicalJson({
    ...manifest,
    artifacts: [{ ...first, verifiedAt }, ...rest],
  } as unknown as CanonicalJsonValue));
}

/** One committed gated transaction that writes only the manifest. */
async function gatedManifestWrite(fixture: CommandFixture, verifiedAt: string): Promise<Uint8Array> {
  return (await gatedManifestCommit(fixture, verifiedAt)).after;
}

async function gatedManifestCommit(
  fixture: CommandFixture,
  verifiedAt: string,
): Promise<{ readonly after: Uint8Array; readonly phase: string }> {
  const before = await manifestBytes(fixture);
  const after = touched(before, verifiedAt);
  const journal = await withLifecycleMutation(fixture.context, lifecycleOf(fixture), () => fixture.context.executor.execute({
    kind: "manifest-anchor-test",
    mutations: [{
      targetPath: fixture.paths.manifestFile,
      operation: "replace",
      content: after,
      expectedBeforeHash: hashBytes(before),
    }],
  }));
  return { after, phase: journal.phase };
}

async function noOpGateSession(fixture: CommandFixture): Promise<void> {
  await withLifecycleMutation(fixture.context, lifecycleOf(fixture), () => Promise.resolve());
}

async function anchorBytes(fixture: CommandFixture): Promise<Uint8Array> {
  return new Uint8Array(await nodeFs.readFile(manifestAnchorPath(fixture.paths.home)));
}

/** The manifest the finalized bootstrap left, read before any gated write moves it. */
async function bootstrapHashOf(fixture: CommandFixture): Promise<string> {
  return hashBytes(await manifestBytes(fixture));
}

async function anchorExists(fixture: CommandFixture): Promise<boolean> {
  return nodeFs.lstat(manifestAnchorPath(fixture.paths.home)).then(() => true, () => false);
}

async function expectAnchoredTo(fixture: CommandFixture, manifest: Uint8Array, bootstrap?: string): Promise<void> {
  const anchor = decodeManifestAnchor(await anchorBytes(fixture));
  expect(anchor?.manifestHash).toBe(hashBytes(manifest));
  if (bootstrap !== undefined) expect(anchor?.bootstrapManifestHash).toBe(bootstrap);
  expect((await nodeFs.lstat(manifestAnchorPath(fixture.paths.home))).mode & 0o777).toBe(0o600);
}

async function expectInitSettles(fixture: CommandFixture): Promise<void> {
  const result = await runInit(fixture.context, ACCEPTED);
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

async function expectInitRefusesArchive(fixture: CommandFixture): Promise<void> {
  const result = await runInit(fixture.context, ACCEPTED);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(EXIT_CODES.recoveryRequired);
  expect(result.error.message).toContain(BOOTSTRAP_MANUAL_ARCHIVE);
}

describe("the durable manifest anchor (D54)", () => {
  it("settles a re-run init after one committed gated manifest write", async () => {
    const fixture = await initialisedV2Home("anchor-one");
    const bootstrap = await bootstrapHashOf(fixture);
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");

    await expectAnchoredTo(fixture, written, bootstrap);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("settles after two chained gated transactions, across a compaction of the first", async () => {
    const fixture = await initialisedV2Home("anchor-chain");
    const bootstrap = await bootstrapHashOf(fixture);
    await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    const second = await gatedManifestWrite(fixture, "2026-09-23T11:00:00.000Z");

    await expectAnchoredTo(fixture, second, bootstrap);
    await expectInitSettles(fixture);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("is left byte- and inode-identical by a gate session that commits nothing", async () => {
    const fixture = await initialisedV2Home("anchor-noop");
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    const before = await nodeFs.lstat(manifestAnchorPath(fixture.paths.home), { bigint: true });

    await noOpGateSession(fixture);

    const after = await nodeFs.lstat(manifestAnchorPath(fixture.paths.home), { bigint: true });
    expect(after.ino).toBe(before.ino);
    await expectAnchoredTo(fixture, written);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a hand-edited manifest with exit 6, even after a gate entry while the journal is still present", async () => {
    const fixture = await initialisedV2Home("anchor-hand-edit");
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    await nodeFs.writeFile(fixture.paths.manifestFile, touched(written, "2026-09-23T12:00:00.000Z"));

    // The committed journal is compacted only here; the anchor must not absorb the edit.
    await noOpGateSession(fixture);

    await expectAnchoredTo(fixture, written);
    await expectInitRefusesArchive(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an anchor naming another hash, and one that is not the exact encoding", async () => {
    const fixture = await initialisedV2Home("anchor-tampered");
    const bootstrapManifestHash = await bootstrapHashOf(fixture);
    await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    const anchor = manifestAnchorPath(fixture.paths.home);
    const manifestHash = hashBytes(await manifestBytes(fixture));

    await nodeFs.writeFile(anchor, encodeManifestAnchor({ manifestHash: "0".repeat(64), bootstrapManifestHash }));
    await expectInitRefusesArchive(fixture);

    const exact = new TextDecoder().decode(encodeManifestAnchor({ manifestHash, bootstrapManifestHash }));
    await nodeFs.writeFile(anchor, exact.replace("\n", " "));
    await expectInitRefusesArchive(fixture);

    await nodeFs.writeFile(anchor, encodeManifestAnchor({ manifestHash, bootstrapManifestHash }));
    await nodeFs.chmod(anchor, 0o644);
    await expectInitRefusesArchive(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("recovers the anchor from the committed journal when the process died before writing it", async () => {
    const fixture = await initialisedV2Home("anchor-crash");
    await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    const anchoredFirst = await anchorBytes(fixture);
    const second = await gatedManifestWrite(fixture, "2026-09-23T11:00:00.000Z");
    // The crash window: the second commit landed and its anchor write never did.
    await nodeFs.writeFile(manifestAnchorPath(fixture.paths.home), anchoredFirst);

    await noOpGateSession(fixture);

    await expectAnchoredTo(fixture, second);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("recovers an anchor that was never written at all", async () => {
    const fixture = await initialisedV2Home("anchor-crash-first");
    const bootstrap = await bootstrapHashOf(fixture);
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    await nodeFs.unlink(manifestAnchorPath(fixture.paths.home));

    await noOpGateSession(fixture);

    await expectAnchoredTo(fixture, written, bootstrap);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("the manifest anchor fails safe (D54 review)", () => {
  it("refuses an anchor whose chain does not start at this plan's manifest (finding 1)", async () => {
    const fixture = await initialisedV2Home("anchor-foreign-chain");
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    // The exact encoding naming the manifest on disk, but a chain another bootstrap started.
    await nodeFs.writeFile(manifestAnchorPath(fixture.paths.home), encodeManifestAnchor({
      manifestHash: hashBytes(written),
      bootstrapManifestHash: "f".repeat(64),
    }));

    await expectInitRefusesArchive(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("does not derive an anchor for a manifest the committed journal did not stage (finding 2)", async () => {
    const fixture = await initialisedV2Home("anchor-derive-mismatch");
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    // The crash window, then a hand edit before the next gate entry.
    await nodeFs.unlink(manifestAnchorPath(fixture.paths.home));
    await nodeFs.writeFile(fixture.paths.manifestFile, touched(written, "2026-09-23T12:00:00.000Z"));

    await noOpGateSession(fixture);

    expect(await anchorExists(fixture)).toBe(false);
    await expectInitRefusesArchive(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("replaces a malformed owned anchor from the committed journal", async () => {
    const fixture = await initialisedV2Home("anchor-malformed-derive");
    const bootstrap = await bootstrapHashOf(fixture);
    const written = await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    // An interrupted first write: the owned shape, not the exact encoding.
    await nodeFs.writeFile(manifestAnchorPath(fixture.paths.home), "{");

    await noOpGateSession(fixture);

    await expectAnchoredTo(fixture, written, bootstrap);
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps a committed result when the anchor cannot be written, and does not wedge the gate (finding 3)", async () => {
    const fixture = await initialisedV2Home("anchor-write-failure");
    await gatedManifestWrite(fixture, "2026-09-23T10:00:00.000Z");
    await nodeFs.chmod(manifestAnchorPath(fixture.paths.home), 0o644);

    const committed = await gatedManifestCommit(fixture, "2026-09-23T11:00:00.000Z");

    expect(committed.phase).toBe("finalized");
    expect(await manifestBytes(fixture)).toStrictEqual(committed.after);
    expect(fixture.io.err).toContain(MANIFEST_ANCHOR_WARNING);
    await noOpGateSession(fixture);
    const report = await runDoctorReport(fixture.context);
    expect(report.checks.find((check) => check.id === "manifest-anchor")?.status).toBe("warn");
    await expectInitRefusesArchive(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits only an anchor owned by the expected user (finding 4)", () => {
    const uid = process.getuid?.() ?? 501;
    const shape = { ownerUid: uid, mode: 0o600, nlink: 1 };
    expect(isOwnedManifestAnchorShape(shape, 193n, uid)).toBe(true);
    expect(isOwnedManifestAnchorShape({ ...shape, ownerUid: uid + 1 }, 193n, uid)).toBe(false);
    expect(isOwnedManifestAnchorShape({ ...shape, mode: 0o644 }, 193n, uid)).toBe(false);
    expect(isOwnedManifestAnchorShape({ ...shape, nlink: 2 }, 193n, uid)).toBe(false);
    expect(isOwnedManifestAnchorShape(shape, 194n, uid)).toBe(false);
  });
});

/** A Claude CLI that answers its version probe and nothing else. */
function claudeRunner(): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      if (request.args.join(" ") === "--version") {
        return Promise.resolve({ stdout: "2.1.280 (Claude Code)\n", stderr: "", exitCode: 0, signal: null, timedOut: false });
      }
      return Promise.reject(new Error(`unexpected spawn: ${request.args.join(" ")}`));
    },
  };
}

/** Codex is absent, so `--adapters claude` never reaches a Codex spawn. */
const AGENTS: Readonly<Record<"claude" | "codex", AgentDiscovery>> = {
  claude: { name: "claude", installed: true, executablePath: CLAUDE, version: null },
  codex: { name: "codex", installed: false, executablePath: null, version: null },
};
const INSTRUCTIONS: readonly ReleaseFileV1[] = [
  {
    relativePath: "catalog.json",
    bytes: encoder.encode(`${JSON.stringify({
      schemaVersion: 1,
      artifacts: [{ category: "rule", id: "careful", legacyName: "careful", vendors: ["claude"], thinCommand: false }],
    })}\n`),
    mode: 0o600,
  },
  { relativePath: "rules/careful.md", bytes: encoder.encode("Be careful.\n"), mode: 0o600 },
];

describe("the durable manifest anchor after attach (D54)", () => {
  it("settles a re-run init after init --adapters claude attached", async () => {
    const fixture = await createCommandFixture("anchor-attach", {
      bootstrapAvailable: true,
      instructions: INSTRUCTIONS,
      runner: claudeRunner(),
      agents: AGENTS,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const attached = await runInit(fixture.context, { ...ACCEPTED, adapters: ["claude"] });
    expect(attached.ok, JSON.stringify(attached)).toBe(true);

    await expectAnchoredTo(fixture, await manifestBytes(fixture));
    await expectInitSettles(fixture);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("never lets an earlier installation's anchor settle a reinstall (finding 1)", async () => {
    const fixture = await createCommandFixture("anchor-reinstall", {
      bootstrapAvailable: true,
      instructions: INSTRUCTIONS,
      runner: claudeRunner(),
      agents: AGENTS,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const attached = await runInit(fixture.context, { ...ACCEPTED, adapters: ["claude"] });
    expect(attached.ok, JSON.stringify(attached)).toBe(true);
    const earlierManifest = await manifestBytes(fixture);
    const earlierAnchor = await anchorBytes(fixture);

    const uninstalled = await runUninstall(fixture.context, ACCEPTED);
    expect(uninstalled.ok, JSON.stringify(uninstalled)).toBe(true);
    expect(await anchorExists(fixture)).toBe(false);

    const context = fixture.rebuildContext();
    const reinstalled = await runInit(context, ACCEPTED);
    expect(reinstalled.ok, JSON.stringify(reinstalled)).toBe(true);
    // The binding is what is under test: the two bootstraps must not share a manifest.
    expect(decodeManifestAnchor(earlierAnchor)?.bootstrapManifestHash).not.toBe(await bootstrapHashOf(fixture));

    // The earlier installation's manifest and anchor come back (a backup restore, a copied home).
    await nodeFs.writeFile(fixture.paths.manifestFile, earlierManifest);
    await nodeFs.writeFile(manifestAnchorPath(fixture.paths.home), earlierAnchor, { mode: 0o600 });
    await nodeFs.chmod(manifestAnchorPath(fixture.paths.home), 0o600);

    const rerun = await runInit(context, ACCEPTED);
    expect(rerun.ok).toBe(false);
    if (rerun.ok) return;
    expect(rerun.code).toBe(EXIT_CODES.recoveryRequired);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
