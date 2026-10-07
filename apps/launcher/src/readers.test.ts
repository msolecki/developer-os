import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeCanonicalJson,
  PACKAGE_CHANNEL_DELEGATION_BYTES,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
  releaseIdentityHash,
  updateCoordinatorEnvelopePaths,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleCoordinatorIdV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  UInt64DecimalV1,
} from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBootstrapClosure, readUpdateEnvelope, resolvePackagedFallback } from "./readers.js";
import { selectLauncherCandidate } from "./selection.js";

/** `main.ts`'s wiring: selection reads the closure once it knows whether an active record exists. */
const closureOf = (fs: LauncherGuardedReaderV1, home: CanonicalAbsolutePathV1) => (handoff: boolean) =>
  readBootstrapClosure(fs, home, UID, handoff);

const UID = 501;
const HOME = "/Users/test/.developer-os" as CanonicalAbsolutePathV1;
const ID = `lc_${"c".repeat(64)}_5` as LifecycleCoordinatorIdV1;

interface FakeFile {
  readonly bytes: Buffer;
  readonly mode?: number;
  readonly ownerUid?: number;
  readonly dev?: string;
  readonly ino?: string;
}
type Files = Readonly<Record<string, Buffer | FakeFile>>;

/** An in-memory guarded reader over `files`; every proper ancestor of a file is a 0700 directory. */
function fsOf(files: Files): LauncherGuardedReaderV1 {
  const file = (path: string): FakeFile | null => {
    const value = files[path];
    return value === undefined ? null : Buffer.isBuffer(value) ? { bytes: value } : value;
  };
  const children = (path: string): string[] => [
    ...new Set(Object.keys(files).filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split("/")[0] as string)),
  ];
  const entry = (path: string, kind: "regular_file" | "directory", mode: number, ownerUid: number, size: number, found?: FakeFile): LifecycleGuardedEntryV1 => ({
    path: path as CanonicalAbsolutePathV1,
    kind,
    ownerUid,
    mode,
    nlink: kind === "directory" ? 2 : 1,
    size: size.toString() as UInt64DecimalV1,
    dev: (found?.dev ?? "1") as UInt64DecimalV1,
    ino: (found?.ino ?? "1") as UInt64DecimalV1,
  });
  const bytesOf = (path: string): Buffer => {
    const found = file(path);
    if (found === null) throw new Error("not a file");
    return found.bytes;
  };
  return {
    lstat: (path) => {
      const found = file(path);
      if (found !== null) return Promise.resolve(entry(path, "regular_file", found.mode ?? 0o600, found.ownerUid ?? UID, found.bytes.byteLength, found));
      return Promise.resolve(children(path).length > 0 ? entry(path, "directory", 0o700, UID, 0) : null);
    },
    readRegular: (target) => Promise.resolve(new Uint8Array(bytesOf(target.path))),
    hashRegular: (target) => Promise.resolve(createHash("sha256").update(bytesOf(target.path)).digest("hex") as LowerHexSha256),
    names: (directory) =>
      (async function* generate(): AsyncGenerator<string> {
        await Promise.resolve();
        yield* children(directory.path);
      })(),
  };
}

function envelope(id: LifecycleCoordinatorIdV1, shape: "both" | "plan_only"): Files {
  const paths = updateCoordinatorEnvelopePaths(HOME, id);
  return shape === "both"
    ? { [paths.plan]: Buffer.from("{}\n"), [paths.journal]: Buffer.from("{}\n") }
    : { [paths.plan]: Buffer.from("{}\n") };
}

describe("readUpdateEnvelope (NEW-111)", () => {
  it("reports an update envelope as present, absent or malformed", async () => {
    expect(await readUpdateEnvelope(fsOf(envelope(ID, "both")), HOME, ID, UID)).toEqual({ kind: "present", coordinatorId: ID });
    expect(await readUpdateEnvelope(fsOf({}), HOME, ID, UID)).toEqual({ kind: "absent" });
    expect(await readUpdateEnvelope(fsOf(envelope(ID, "plan_only")), HOME, ID, UID)).toEqual({ kind: "malformed" });
  });

  it("reports an envelope file that is not an owned 0600 regular file as malformed", async () => {
    const { plan, journal } = updateCoordinatorEnvelopePaths(HOME, ID);
    const both = (override: FakeFile) => fsOf({ [plan]: Buffer.from("{}\n"), [journal]: override });
    expect(await readUpdateEnvelope(both({ bytes: Buffer.from("{}\n"), mode: 0o644 }), HOME, ID, UID)).toEqual({ kind: "malformed" });
    expect(await readUpdateEnvelope(both({ bytes: Buffer.from("{}\n"), ownerUid: 0 }), HOME, ID, UID)).toEqual({ kind: "malformed" });
  });
});

/**
 * Real bootstrap envelopes, written by the CLI's own `init` through `createCommandFixture` and
 * copied byte for byte into the in-memory reader (the launcher may not import the CLI, Spec 2 §2,
 * so its compiled test fixture is loaded by path, as `handoff.test.ts` loads the CLI).
 */
interface BootstrapCapture {
  readonly home: CanonicalAbsolutePathV1;
  readonly files: Files;
}

const cliDist = new URL("../../cli/dist/", import.meta.url);
interface CliFixture {
  readonly root: string;
  readonly paths: { readonly home: string };
  readonly io: unknown;
  readonly context: { readonly bootstrap?: { readonly state: string; readonly executor?: { close(): Promise<void> } } };
  readonly disableBootstrapInterrupt: () => void;
  readonly setBootstrapInterrupt: (point: string) => void;
}
interface CliTesting {
  readonly createCommandFixture: (label: string, options: Record<string, unknown>) => Promise<CliFixture>;
  readonly removeCommandFixtures: () => Promise<void>;
}
interface CliMain {
  readonly run: (argv: readonly string[], io: unknown, context: () => unknown) => Promise<number>;
}

/**
 * Runs `steps` in one CLI fixture -- `init` with that death point (`null`: none) or `uninstall` --
 * and copies every bootstrap envelope file and the bootstrap leaf from `state/`, with the leaf's
 * real identity. `uninstall` retains the envelope and a later `init` publishes a new one beside it,
 * as a real home accumulates them (NEW-123).
 */
async function captureBootstrap(
  testing: CliTesting,
  main: CliMain,
  label: string,
  steps: readonly (string | null)[],
  root?: string,
): Promise<BootstrapCapture & { readonly root: string }> {
  const fixture = await testing.createCommandFixture(label, { bootstrapAvailable: true, ...(root === undefined ? {} : { root }) });
  for (const step of steps) {
    if (step === "uninstall") {
      await main.run(["uninstall", "--yes"], fixture.io, () => fixture.context);
      continue;
    }
    if (step === null) fixture.disableBootstrapInterrupt();
    else fixture.setBootstrapInterrupt(step);
    await main.run(["init", "--yes"], fixture.io, () => fixture.context);
  }
  if (fixture.context.bootstrap?.state === "available") await fixture.context.bootstrap.executor?.close();
  const state = `${fixture.paths.home}/state`;
  const files: Record<string, Buffer | FakeFile> = {};
  for (const name of await readdir(state)) {
    const path = `${state}/${name}`;
    if (name.startsWith("fresh-v2-init.")) files[path] = await readFile(path);
    if (name === ".lifecycle-bootstrap.lock") {
      const leaf = await lstat(path, { bigint: true });
      files[path] = { bytes: Buffer.alloc(0), ownerUid: Number(leaf.uid), dev: leaf.dev.toString(), ino: leaf.ino.toString() };
    }
  }
  return { root: fixture.root, home: fixture.paths.home as CanonicalAbsolutePathV1, files };
}

const ofId = (capture: BootstrapCapture, ordinal: number): Files =>
  Object.fromEntries(Object.entries(capture.files).filter(([path]) => path.includes(`-8000-${ordinal.toString(16).padStart(12, "0")}.`)));
const planOf = (files: Files): string => Object.keys(files).find((path) => path.endsWith(".plan.json")) as string;

/** A valid package-channel active release at `home`, as `selection.test.ts` builds one (D84 K3). */
function activeHome(home: CanonicalAbsolutePathV1): Files {
  const sha = (bytes: Buffer): LowerHexSha256 => createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
  const json = (value: unknown): Buffer => Buffer.from(encodeCanonicalJson(value as CanonicalJsonValue), "utf8");
  const bundleRoot = `${home}/releases/2.0.0/darwin-arm64`;
  const bin = Object.fromEntries(["cli", "planner", "runtime", "verifier"].map((name) => [name, Buffer.from(`#!/bin/sh\n# ${name}\n`)]));
  const manifest = validateBundleManifest({
    schemaVersion: 1, version: "2.0.0", releaseSequence: "2", platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
    entrypoint: "bin/cli", runtimeEntrypoint: "bin/runtime", plannerEntrypoint: "bin/planner", verifierEntrypoint: "bin/verifier",
    entries: [
      { path: "bin", kind: "directory", mode: 448 },
      ...Object.entries(bin).map(([name, bytes]) => ({ path: `bin/${name}`, kind: "file", mode: 448, bytes: bytes.byteLength.toString(), sha256: sha(bytes) })),
    ],
  });
  const manifestBytes = json(manifest);
  const bundle = (architecture: string, manifestSha256: string) => ({
    platform: "darwin", architecture, archiveFormat: "zstd-ustar-v1", archivePath: `darwin-${architecture}.tar.zst`, archiveBytes: "1",
    archiveSha256: "a".repeat(64), manifestPath: `darwin-${architecture}-manifest.json`, manifestBytes: "1", manifestSha256,
  });
  const entry = { version: "2.0.0", releaseSequence: "2", minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [bundle("arm64", sha(manifestBytes)), bundle("x64", "d".repeat(64))] };
  const indexBytes = json({ sequence: "1", latestVersion: "2.0.0", releases: [entry] });
  const delegationBytes = Buffer.from(PACKAGE_CHANNEL_DELEGATION_BYTES);
  const identity = {
    version: "2.0.0", releaseSequence: "2", releaseIdentityHash: releaseIdentityHash(entry, "arm64"), delegationSequence: "0", delegationHash: sha(delegationBytes),
    releaseIndexSequence: "1", releaseIndexHash: sha(indexBytes), bundleManifestHash: sha(manifestBytes), bundleRoot, platform: "darwin", architecture: "arm64",
    launcherProtocol: 1, updateProtocol: 1,
  };
  const metadata = `${home}/state/release-metadata`;
  return {
    ...Object.fromEntries(Object.entries(bin).map(([name, bytes]) => [`${bundleRoot}/bin/${name}`, { bytes, mode: 0o700 }])),
    [`${home}/state/active-release.json`]: json({ schemaVersion: 1, ...identity, activatedAt: "2026-10-07T00:00:00.000Z" }),
    [`${home}/state/release-trust.json`]: json({
      schemaVersion: 1, trust: "package-channel", highestDelegationSequence: "0", delegationHash: identity.delegationHash, delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
      highestReleaseIndexSequence: "1", releaseIndexHash: identity.releaseIndexHash, highestAcceptedReleaseSequence: "2", releaseIdentityHash: identity.releaseIdentityHash,
    }),
    [`${metadata}/delegations/${identity.delegationHash}.json`]: delegationBytes,
    [`${metadata}/indexes/${identity.releaseIndexHash}.json`]: indexBytes,
    [`${metadata}/bundles/${identity.bundleManifestHash}.json`]: manifestBytes,
  };
}

/** Launcher selection over one in-memory home, its bootstrap closure read by the real reader. */
function selectOver(home: CanonicalAbsolutePathV1, files: Files) {
  const fs = fsOf(files);
  return selectLauncherCandidate({
    productHome: home,
    platform: { platform: "darwin", architecture: "arm64" },
    effectiveUid: UID,
    fs,
    packagedFallback: null,
    bootstrapClosure: closureOf(fs, home),
    readUpdateEnvelope: () => Promise.resolve({ kind: "absent" }),
  });
}

describe("readBootstrapClosure (NEW-111)", () => {
  let testing: CliTesting;
  let reserved: BootstrapCapture;
  /** `fi_…01` interrupted mid-bootstrap, in the same home as `several`. */
  let planned: BootstrapCapture;
  /** `fi_…01` and `fi_…02` finalized (each followed by `uninstall`), `fi_…03` interrupted mid-bootstrap. */
  let several: BootstrapCapture;

  beforeAll(async () => {
    testing = (await import(new URL("commands/testing.js", cliDist).href)) as CliTesting;
    const main = (await import(new URL("main.js", cliDist).href)) as CliMain;
    reserved = await captureBootstrap(testing, main, "launcher-closure-reserved", ["after_plan"]);
    const first = await captureBootstrap(testing, main, "launcher-closure-several", ["after_first_payload"]);
    planned = first;
    await rm(first.home, { recursive: true, force: true });
    several = await captureBootstrap(testing, main, "launcher-closure-several", [null, "uninstall", null, "uninstall", "after_first_payload"], first.root);
  }, 300_000);
  afterAll(async () => {
    await testing.removeCommandFixtures();
  });

  it("reports handoff_complete with no bootstrap plan and non_terminal for a planned journal", async () => {
    expect(await readBootstrapClosure(fsOf({}), HOME, UID, false)).toEqual({ kind: "handoff_complete" });
    expect(await readBootstrapClosure(fsOf(planned.files), planned.home, UID, false)).toEqual({ kind: "non_terminal" });
  });

  it("reports a plan whose two journal slots are still empty reservations as non_terminal only while its leaf is live", async () => {
    expect(Object.keys(reserved.files).filter((path) => path.includes(".journal.")).length).toBe(2);
    expect(await readBootstrapClosure(fsOf(reserved.files), reserved.home, UID, false)).toEqual({ kind: "non_terminal" });
    const leafless = Object.fromEntries(Object.entries(reserved.files).filter(([path]) => !path.endsWith(".lifecycle-bootstrap.lock")));
    expect(await readBootstrapClosure(fsOf(leafless), reserved.home, UID, false)).toEqual({ kind: "malformed" });
  });

  it("reports a finalized bootstrap as handoff_complete", async () => {
    expect(await readBootstrapClosure(fsOf(ofId(several, 1)), several.home, UID, false)).toEqual({ kind: "handoff_complete" });
  });

  it("reports an altered plan, an unreadable slot or a group-readable plan as malformed before the handoff", async () => {
    const plan = planOf(planned.files);
    const slot = Object.keys(planned.files).find((path) => path.endsWith(".journal.0.json")) as string;
    const altered = (path: string, value: Buffer | FakeFile) => fsOf({ ...planned.files, [path]: value });
    expect(await readBootstrapClosure(altered(plan, Buffer.from("{}\n")), planned.home, UID, false)).toEqual({ kind: "malformed" });
    expect(await readBootstrapClosure(altered(slot, Buffer.from("not json\n")), planned.home, UID, false)).toEqual({ kind: "malformed" });
    expect(await readBootstrapClosure(altered(plan, { bytes: planned.files[plan] as Buffer, mode: 0o644 }), planned.home, UID, false)).toEqual({ kind: "malformed" });
  });

  it("(i) launches the active release beside several finalized envelopes (Spec 2 §3.1, NEW-123)", async () => {
    const files = { ...ofId(several, 1), ...ofId(several, 2), ...activeHome(several.home) };
    expect(Object.keys(files).filter((path) => path.endsWith(".plan.json")).length).toBe(2);
    await expect(selectOver(several.home, files)).resolves.toMatchObject({ kind: "active_release" });
  });

  it("(ii) refuses two non-terminal envelopes as malformed", async () => {
    // `fi_…01` interrupted in the first fixture and `fi_…03` interrupted in the second share one home.
    const files = { ...ofId(planned, 1), ...ofId(several, 3), ...activeHome(several.home) };
    await expect(selectOver(several.home, files)).rejects.toMatchObject({ code: 6, reason: "launcher_bootstrap_residue_malformed" });
  });

  it("(iii) launches the active release beside an altered finalized envelope, which is inert after the handoff", async () => {
    const finalized = ofId(several, 1);
    const files = { ...finalized, [planOf(finalized)]: Buffer.from("{}\n"), ...activeHome(several.home) };
    await expect(selectOver(several.home, files)).resolves.toMatchObject({ kind: "active_release" });
  });
});

describe("resolvePackagedFallback (D84 K2/K3)", () => {
  async function prefixWith(target: (prefix: string) => string) {
    const prefix = await realpath(await mkdtemp(join(tmpdir(), "developer-os-prefix-")));
    await mkdir(join(prefix, "Cellar", "developer-os", "1.2.0", "libexec", "fallback"), { recursive: true });
    await mkdir(join(prefix, "opt"));
    await symlink(target(prefix), join(prefix, "opt", "developer-os"));
    const entry = { prefix: prefix as CanonicalAbsolutePathV1, opt: `${prefix}/opt/developer-os` as CanonicalAbsolutePathV1, fallback: "libexec/fallback" as const };
    return { prefix, entry };
  }

  it("resolves the opt link once to the canonical keg's fallback", async () => {
    const { prefix, entry } = await prefixWith(() => "../Cellar/developer-os/1.2.0");
    try {
      expect(await resolvePackagedFallback(entry)).toEqual({
        prefix,
        bundleRoot: `${prefix}/Cellar/developer-os/1.2.0/libexec/fallback/bundle`,
        manifestPath: `${prefix}/Cellar/developer-os/1.2.0/libexec/fallback/metadata/bundle-manifest.json`,
      });
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });

  it("resolves nothing for an absent link, a link out of the Cellar or a non-version keg", async () => {
    const outside = await prefixWith((prefix) => join(prefix, "Cellar"));
    const unversioned = await prefixWith(() => "../Cellar/developer-os");
    try {
      expect(await resolvePackagedFallback({ ...outside.entry, opt: `${outside.prefix}/opt/absent` as CanonicalAbsolutePathV1 })).toBeNull();
      expect(await resolvePackagedFallback(outside.entry)).toBeNull();
      expect(await resolvePackagedFallback(unversioned.entry)).toBeNull();
    } finally {
      await rm(outside.prefix, { recursive: true, force: true });
      await rm(unversioned.prefix, { recursive: true, force: true });
    }
  });
});
