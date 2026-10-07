import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { updateCoordinatorEnvelopePaths } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleCoordinatorIdV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  UInt64DecimalV1,
} from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBootstrapClosure, readUpdateEnvelope, resolvePackagedFallback } from "./readers.js";

const UID = 501;
const HOME = "/Users/test/.developer-os" as CanonicalAbsolutePathV1;
const ID = `lc_${"c".repeat(64)}_5` as LifecycleCoordinatorIdV1;

interface FakeFile {
  readonly bytes: Buffer;
  readonly mode?: number;
  readonly ownerUid?: number;
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
  const entry = (path: string, kind: "regular_file" | "directory", mode: number, ownerUid: number, size: number): LifecycleGuardedEntryV1 => ({
    path: path as CanonicalAbsolutePathV1,
    kind,
    ownerUid,
    mode,
    nlink: kind === "directory" ? 2 : 1,
    size: size.toString() as UInt64DecimalV1,
    dev: "1" as UInt64DecimalV1,
    ino: "1" as UInt64DecimalV1,
  });
  const bytesOf = (path: string): Buffer => {
    const found = file(path);
    if (found === null) throw new Error("not a file");
    return found.bytes;
  };
  return {
    lstat: (path) => {
      const found = file(path);
      if (found !== null) return Promise.resolve(entry(path, "regular_file", found.mode ?? 0o600, found.ownerUid ?? UID, found.bytes.byteLength));
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
interface CliTesting {
  readonly createCommandFixture: (label: string, options: Record<string, unknown>) => Promise<{
    readonly paths: { readonly home: string };
    readonly io: unknown;
    readonly context: { readonly bootstrap?: { readonly state: string; readonly executor?: { close(): Promise<void> } } };
  }>;
  readonly removeCommandFixtures: () => Promise<void>;
}
interface CliMain {
  readonly run: (argv: readonly string[], io: unknown, context: () => unknown) => Promise<number>;
}

async function captureBootstrap(testing: CliTesting, main: CliMain, label: string, interrupt: string | null): Promise<BootstrapCapture> {
  const fixture = await testing.createCommandFixture(label, {
    bootstrapAvailable: true,
    ...(interrupt === null ? {} : { bootstrapInterruptAfter: interrupt }),
  });
  await main.run(["init", "--yes"], fixture.io, () => fixture.context);
  if (fixture.context.bootstrap?.state === "available") await fixture.context.bootstrap.executor?.close();
  const state = `${fixture.paths.home}/state`;
  const files: Record<string, Buffer> = {};
  for (const name of await readdir(state)) {
    if (name.startsWith("fresh-v2-init.")) files[`${state}/${name}`] = await readFile(`${state}/${name}`);
  }
  return { home: fixture.paths.home as CanonicalAbsolutePathV1, files };
}

/** The same plan bytes published again under another fresh-init ID: two plans in `state/`. */
function secondPlan(capture: BootstrapCapture): Files {
  const plan = Object.keys(capture.files).find((path) => path.endsWith(".plan.json")) as string;
  return { [plan.replace(/fi_[0-9a-f-]{36}/u, "fi_11111111-1111-4111-8111-111111111111")]: capture.files[plan] as Buffer };
}

describe("readBootstrapClosure (NEW-111)", () => {
  let testing: CliTesting;
  let planned: BootstrapCapture;
  let reserved: BootstrapCapture;
  let finalized: BootstrapCapture;

  beforeAll(async () => {
    testing = (await import(new URL("commands/testing.js", cliDist).href)) as CliTesting;
    const main = (await import(new URL("main.js", cliDist).href)) as CliMain;
    planned = await captureBootstrap(testing, main, "launcher-closure-planned", "after_first_payload");
    reserved = await captureBootstrap(testing, main, "launcher-closure-reserved", "after_plan");
    finalized = await captureBootstrap(testing, main, "launcher-closure-finalized", null);
  }, 120_000);
  afterAll(async () => {
    await testing.removeCommandFixtures();
  });

  it("reports handoff_complete with no bootstrap plan and non_terminal for a planned journal", async () => {
    expect(await readBootstrapClosure(fsOf({}), HOME, UID)).toEqual({ kind: "handoff_complete" });
    expect(await readBootstrapClosure(fsOf(planned.files), planned.home, UID)).toEqual({ kind: "non_terminal" });
    expect(await readBootstrapClosure(fsOf({ ...planned.files, ...secondPlan(planned) }), planned.home, UID)).toEqual({ kind: "malformed" });
  });

  it("reports a plan whose two journal slots are still empty reservations as non_terminal", async () => {
    expect(Object.keys(reserved.files).filter((path) => path.includes(".journal.")).length).toBe(2);
    expect(await readBootstrapClosure(fsOf(reserved.files), reserved.home, UID)).toEqual({ kind: "non_terminal" });
  });

  it("reports a finalized bootstrap as handoff_complete", async () => {
    expect(Object.keys(finalized.files).some((path) => path.endsWith(".plan.json"))).toBe(true);
    expect(await readBootstrapClosure(fsOf(finalized.files), finalized.home, UID)).toEqual({ kind: "handoff_complete" });
  });

  it("reports an altered plan, an unreadable slot or a group-readable plan as malformed", async () => {
    const plan = Object.keys(planned.files).find((path) => path.endsWith(".plan.json")) as string;
    const slot = Object.keys(planned.files).find((path) => path.endsWith(".journal.0.json")) as string;
    const altered = (path: string, value: Buffer | FakeFile) => fsOf({ ...planned.files, [path]: value });
    expect(await readBootstrapClosure(altered(plan, Buffer.from("{}\n")), planned.home, UID)).toEqual({ kind: "malformed" });
    expect(await readBootstrapClosure(altered(slot, Buffer.from("not json\n")), planned.home, UID)).toEqual({ kind: "malformed" });
    expect(await readBootstrapClosure(altered(plan, { bytes: planned.files[plan] as Buffer, mode: 0o644 }), planned.home, UID)).toEqual({ kind: "malformed" });
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
