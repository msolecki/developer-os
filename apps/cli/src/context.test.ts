import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fsSync from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { ProtectedPathPolicy, redactText, SecurityRefusalError } from "@developer-os/security";
import type * as SecurityModule from "@developer-os/security";

import {
  assertReadableArtifactPath,
  assertRootsAnchored,
  createGuards,
  createProductionContext,
  loadOrCreateRedactionKey,
  pathEnvironmentFor,
  readRedactionKey,
} from "./context.js";
import type { CliContext } from "./context.js";
import type { CliIo } from "./io.js";

/**
 * The only seam that can observe *which* key the composition root wired in.
 *
 * A fingerprint is an HMAC of the secret under the key, and nothing the CLI
 * exposes today surfaces one: `redactText`'s replacement text is byte-identical
 * whatever key produced it. That is precisely why the first implementation of
 * this task could have had its one wiring line reverted to `randomBytes()` with
 * the entire suite still green. Recording the key `redactText` is actually
 * called with is what turns "the durable key, not a per-process one" into a
 * claim a test can fail on. The wrapper delegates to the real implementation,
 * so every other suite in this file exercises production behaviour unchanged.
 */
const { redactionKeyUses } = vi.hoisted(() => ({
  redactionKeyUses: [] as Uint8Array[],
}));

vi.mock("@developer-os/security", async (importOriginal) => {
  const actual =
    await importOriginal<typeof SecurityModule>();

  return {
    ...actual,
    redactText: (text: string, key: Uint8Array) => {
      redactionKeyUses.push(Uint8Array.from(key));
      return actual.redactText(text, key);
    },
  };
});

function fingerprintOf(context: CliContext, secret: string): string | undefined {
  redactionKeyUses.length = 0;
  context.guards.redactDiagnostic(secret);
  const used = redactionKeyUses[0];
  return used === undefined
    ? undefined
    : redactText(secret, used).findings[0]?.fingerprint;
}

const REDACTION_KEY = new Uint8Array(32).fill(7);

interface Fixture {
  readonly root: string;
  readonly homeDir: string;
}

const fixtures: Fixture[] = [];

async function createFixture(label: string): Promise<Fixture> {
  const created = await nodeFs.mkdtemp(
    join(tmpdir(), `developer-os-cli-context-${label}-`),
  );
  const root = await nodeFs.realpath(created);
  const homeDir = join(root, "home");
  await nodeFs.mkdir(homeDir, { recursive: true, mode: 0o700 });
  const fixture = { root, homeDir };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await nodeFs.rm(fixture.root, { recursive: true, force: true });
    }
  }
});

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

describe("loadOrCreateRedactionKey", () => {
  it("creates a 32-byte key at 0600 when none exists", async () => {
    const fixture = await createFixture("redaction-key-create");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });

    const key = loadOrCreateRedactionKey(stateDir);
    const file = join(stateDir, "redaction.key");

    expect(key.byteLength).toBe(32);
    expect(fsSync.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("returns the same bytes on a second call, which is the whole point", async () => {
    const fixture = await createFixture("redaction-key-stable");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });

    expect([...loadOrCreateRedactionKey(stateDir)]).toEqual([
      ...loadOrCreateRedactionKey(stateDir),
    ]);
  });

  it("produces a stable fingerprint across two processes' worth of loads", async () => {
    const fixture = await createFixture("redaction-key-fingerprint");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });

    const first = redactText(
      "token=ghp_" + "a".repeat(36),
      loadOrCreateRedactionKey(stateDir),
    );
    const second = redactText(
      "token=ghp_" + "a".repeat(36),
      loadOrCreateRedactionKey(stateDir),
    );
    expect(first.findings[0]?.fingerprint).toBe(second.findings[0]?.fingerprint);
  });

  it("refuses a key file that is a symlink", async () => {
    const fixture = await createFixture("redaction-key-symlink");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    fsSync.symlinkSync("/etc/passwd", join(stateDir, "redaction.key"));

    expect(() => loadOrCreateRedactionKey(stateDir)).toThrow(
      SecurityRefusalError,
    );
  });

  it("refuses a key file that is too short to be a key", async () => {
    const fixture = await createFixture("redaction-key-short");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    fsSync.writeFileSync(join(stateDir, "redaction.key"), Buffer.alloc(8), {
      mode: 0o600,
    });

    expect(() => loadOrCreateRedactionKey(stateDir)).toThrow(
      SecurityRefusalError,
    );
  });

  it("tightens an over-permissive mode rather than refusing every command", async () => {
    const fixture = await createFixture("redaction-key-tighten");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });

    loadOrCreateRedactionKey(stateDir);
    fsSync.chmodSync(join(stateDir, "redaction.key"), 0o644);
    loadOrCreateRedactionKey(stateDir);

    expect(fsSync.statSync(join(stateDir, "redaction.key")).mode & 0o777).toBe(
      0o600,
    );
  });

  /**
   * The ambiguity the brief left open, resolved by picking `O_CREAT | O_EXCL`
   * for the create branch: two processes racing to initialize the same state
   * directory must converge on one key, not have the second overwrite the
   * first. `openSync` is spied only for the single `O_CREAT | O_EXCL` call this
   * function makes, and only long enough to simulate a concurrent process
   * winning that race and writing its own bytes first; every other call —
   * including the single bounded re-read this function is required to take —
   * runs for real.
   */
  it("converges two concurrent first runs on one key rather than one overwriting the other", async () => {
    const fixture = await createFixture("redaction-key-race");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const file = join(stateDir, "redaction.key");
    const winner = randomBytes(32);
    const realOpenSync = fsSync.openSync;

    const spy = vi
      .spyOn(fsSync, "openSync")
      .mockImplementation((...args: Parameters<typeof fsSync.openSync>) => {
        const [path, flags] = args;
        const isExclusiveCreate =
          path === file &&
          typeof flags === "number" &&
          (flags & fsSync.constants.O_CREAT) !== 0 &&
          (flags & fsSync.constants.O_EXCL) !== 0;
        if (isExclusiveCreate) {
          spy.mockRestore();
          fsSync.writeFileSync(file, winner, { mode: 0o600 });
          const error = new Error(
            "EEXIST: file already exists",
          ) as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
        return realOpenSync.apply(fsSync, args);
      });

    const key = loadOrCreateRedactionKey(stateDir);

    expect([...key]).toEqual([...winner]);
  });

  /**
   * `open(O_RDONLY)` on a FIFO blocks until a writer appears, and the
   * regular-file guard is downstream of the open — so without `O_NONBLOCK` the
   * CLI hangs forever, with no output, on a path anyone with write access to
   * `stateDir` controls. Same actor as the symlink case, worse outcome: a
   * refusal is a diagnosis, a hang is not. A regression here does not fail
   * fast; it exhausts vitest's timeout, which is the honest signal for "this
   * never returned".
   */
  it("refuses a FIFO instead of blocking on the open forever", async () => {
    const fixture = await createFixture("redaction-key-fifo");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    execFileSync("mkfifo", ["-m", "600", join(stateDir, "redaction.key")]);

    expect(() => loadOrCreateRedactionKey(stateDir)).toThrow(
      SecurityRefusalError,
    );
  });

  /**
   * A short write leaves bytes on disk that every later run refuses as "too
   * short" — a machine bricked by a full disk rather than by an attacker. The
   * write is checked, and the half-written file is removed, so the next run
   * creates a whole key instead of finding a broken one.
   */
  it("leaves no truncated key behind when the write is short", async () => {
    const fixture = await createFixture("redaction-key-short-write");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const spy = vi.spyOn(fsSync, "writeSync").mockReturnValue(1);

    expect(() => loadOrCreateRedactionKey(stateDir)).toThrow(/partially/u);
    spy.mockRestore();

    expect(fsSync.existsSync(join(stateDir, "redaction.key"))).toBe(false);
    expect(loadOrCreateRedactionKey(stateDir).byteLength).toBe(32);
  });

  /** A crash between `write` and `close` must not leave a zero-length key. */
  it("flushes the key to disk before closing it", async () => {
    const fixture = await createFixture("redaction-key-fsync");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const spy = vi.spyOn(fsSync, "fsyncSync");

    loadOrCreateRedactionKey(stateDir);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  /**
   * The `EEXIST` fallback re-reads through the guarded door, and a process that
   * deletes the file between the two calls must produce a terminal error rather
   * than a second create that `EEXIST`s again forever. Bounded to one retry:
   * this test hangs, not fails, if that ever becomes mutual recursion.
   */
  it("gives up with a terminal error rather than looping on a vanishing key", async () => {
    const fixture = await createFixture("redaction-key-vanishing");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const file = join(stateDir, "redaction.key");
    const realOpenSync = fsSync.openSync;

    const spy = vi
      .spyOn(fsSync, "openSync")
      .mockImplementation((...args: Parameters<typeof fsSync.openSync>) => {
        const [path, flags] = args;
        const isExclusiveCreate =
          path === file &&
          typeof flags === "number" &&
          (flags & fsSync.constants.O_CREAT) !== 0 &&
          (flags & fsSync.constants.O_EXCL) !== 0;
        if (isExclusiveCreate) {
          const error = new Error(
            "EEXIST: file already exists",
          ) as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
        return realOpenSync.apply(fsSync, args);
      });

    expect(() => loadOrCreateRedactionKey(stateDir)).toThrow(/run the command/u);
    spy.mockRestore();
  });
});

/**
 * The composition root's door, and the amendment this fix pass exists for.
 * Every state below reached the *first* implementation as a thrown
 * `SecurityRefusalError` out of `createContext(io)`, before dispatch — which
 * meant `doctor` could not report it, `uninstall` could not clear it, and no
 * command on the machine could run. Reporting a broken key is only possible if
 * building the context survives one.
 */
describe("readRedactionKey", () => {
  it.each([
    ["absent", (): void => undefined],
    [
      "a symlink",
      (keyFile: string): void => {
        fsSync.symlinkSync("/etc/passwd", keyFile);
      },
    ],
    [
      "a directory",
      (keyFile: string): void => {
        fsSync.mkdirSync(keyFile);
      },
    ],
    [
      "too short",
      (keyFile: string): void => {
        fsSync.writeFileSync(keyFile, Buffer.alloc(8), { mode: 0o600 });
      },
    ],
    [
      "a FIFO",
      (keyFile: string): void => {
        execFileSync("mkfifo", ["-m", "600", keyFile]);
      },
    ],
  ])("returns null for %s, and never throws", async (name, plant) => {
    const fixture = await createFixture(`read-key-${name.replace(/\s+/gu, "-")}`);
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    plant(join(stateDir, "redaction.key"));

    expect(readRedactionKey(stateDir)).toBeNull();
  });

  it("creates nothing, ever — not even when the state directory is missing", async () => {
    const fixture = await createFixture("read-key-nothing");
    const stateDir = join(fixture.root, "state");

    expect(readRedactionKey(stateDir)).toBeNull();
    expect(fsSync.existsSync(stateDir)).toBe(false);
  });

  it("never repairs a mode it disagrees with", async () => {
    const fixture = await createFixture("read-key-mode");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    loadOrCreateRedactionKey(stateDir);
    const file = join(stateDir, "redaction.key");
    fsSync.chmodSync(file, 0o644);

    expect(readRedactionKey(stateDir)).not.toBeNull();
    expect(fsSync.statSync(file).mode & 0o777).toBe(0o644);
  });

  it("returns the durable bytes when they are there", async () => {
    const fixture = await createFixture("read-key-present");
    const stateDir = join(fixture.root, "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const written = loadOrCreateRedactionKey(stateDir);

    expect([...(readRedactionKey(stateDir) ?? [])]).toEqual([...written]);
  });
});

const NULL_IO: CliIo = {
  stdout: () => {
    /* discarded */
  },
  stderr: () => {
    /* discarded */
  },
  confirm: () => Promise.resolve(false),
};

function recordingIo(): CliIo & { readonly err: string[] } {
  const err: string[] = [];
  return {
    err,
    stdout: () => {
      /* discarded */
    },
    stderr: (line: string) => {
      err.push(line);
    },
    confirm: () => Promise.resolve(false),
  };
}

describe("createProductionContext", () => {
  /**
   * **The test this task exists for.** Everything else here checks the loader;
   * this checks the thing the loader was for. Revert the composition root's one
   * wiring line to `randomBytes(REDACTION_KEY_BYTES)` and this is the assertion
   * that goes red — the redacted *text* is identical under either key, so no
   * other case in this file can tell them apart.
   */
  it("fingerprints with the durable key, not with a per-process one", async () => {
    const fixture = await createFixture("production-context-durable");
    const stateDir = join(fixture.homeDir, ".developer-os", "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const durable = loadOrCreateRedactionKey(stateDir);

    const context = createProductionContext({
      io: NULL_IO,
      env: {},
      userHome: fixture.homeDir,
    });
    const secret = `ghp_${"a".repeat(36)}`;

    expect(context.guards.redactDiagnostic(secret)).toBe(
      redactText(secret, durable).text,
    );
    expect(fingerprintOf(context, secret)).toMatch(/^[a-f0-9]{16}$/u);
    expect(fingerprintOf(context, secret)).toBe(
      redactText(secret, durable).findings[0]?.fingerprint,
    );
  });

  /**
   * `doctor` and `status` run, read-only, on a machine that has never seen
   * `init` — `paths.stateDir` does not exist yet on such a machine. The
   * ephemeral fallback is a real key, not a stub, so a diagnostic on that
   * machine is still redacted; it is the pre-Task-1 behaviour, now scoped to
   * the one case where nothing durable exists.
   */
  it("falls back to an ephemeral key rather than creating the state directory", async () => {
    const fixture = await createFixture("production-context-fresh");

    const context = createProductionContext({
      io: NULL_IO,
      env: {},
      userHome: fixture.homeDir,
    });

    expect(
      context.guards.redactDiagnostic(
        "Authorization: Bearer abc123def456ghi789",
      ),
    ).toBe("Authorization: Bearer [REDACTED:bearer-token]");
    await expect(
      nodeFs.lstat(context.paths.stateDir),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  /**
   * The spec's binding constraint: "a missing key regenerates on next use
   * **with a warning that prior fingerprints are no longer comparable**". The
   * first implementation regenerated silently, which is the half of the
   * sentence that matters to anyone comparing two captures.
   */
  it("warns that prior fingerprints are no longer comparable", async () => {
    const fixture = await createFixture("production-context-warning");
    const io = recordingIo();

    createProductionContext({ io, env: {}, userHome: fixture.homeDir });

    expect(io.err.join("\n")).toContain("cannot be compared");
  });

  it("says nothing when the durable key is there", async () => {
    const fixture = await createFixture("production-context-quiet");
    const stateDir = join(fixture.homeDir, ".developer-os", "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    loadOrCreateRedactionKey(stateDir);
    const io = recordingIo();

    createProductionContext({ io, env: {}, userHome: fixture.homeDir });

    expect(io.err).toEqual([]);
  });

  it("reads the durable key once the state directory exists, and never overwrites it", async () => {
    const fixture = await createFixture("production-context-initialized");
    const stateDir = join(fixture.homeDir, ".developer-os", "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    loadOrCreateRedactionKey(stateDir);
    const before = await nodeFs.readFile(join(stateDir, "redaction.key"));

    createProductionContext({ io: NULL_IO, env: {}, userHome: fixture.homeDir });

    const after = await nodeFs.readFile(join(stateDir, "redaction.key"));
    expect([...after]).toEqual([...before]);
  });

  /**
   * `doctor`, `status` and both `--dry-run` commands used to write a new
   * secret to disk merely by having a context built for them, which is the
   * defect the split fixes. Nothing the composition root does may create the
   * key — not even when `stateDir` exists and is writable.
   */
  it("creates no key when the state directory exists but the key does not", async () => {
    const fixture = await createFixture("production-context-no-create");
    const stateDir = join(fixture.homeDir, ".developer-os", "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });

    createProductionContext({ io: NULL_IO, env: {}, userHome: fixture.homeDir });

    expect(fsSync.existsSync(join(stateDir, "redaction.key"))).toBe(false);
  });

  /**
   * A symlink, a FIFO, or a truncated file at the key path bricked every
   * command: `createContext(io)` threw before dispatch, so the diagnostic that
   * would have reported it could not run either. Building a context must
   * survive all of them.
   */
  it.each([
    [
      "a symlink",
      (keyFile: string): void => {
        fsSync.symlinkSync("/etc/passwd", keyFile);
      },
    ],
    [
      "a FIFO",
      (keyFile: string): void => {
        execFileSync("mkfifo", ["-m", "600", keyFile]);
      },
    ],
    [
      "too short",
      (keyFile: string): void => {
        fsSync.writeFileSync(keyFile, Buffer.alloc(8), { mode: 0o600 });
      },
    ],
  ])("still builds a context when the key path is %s", async (name, plant) => {
    const fixture = await createFixture(
      `production-context-${name.replace(/\s+/gu, "-")}`,
    );
    const stateDir = join(fixture.homeDir, ".developer-os", "state");
    await nodeFs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    plant(join(stateDir, "redaction.key"));
    const io = recordingIo();

    const context = createProductionContext({
      io,
      env: {},
      userHome: fixture.homeDir,
    });

    expect(
      context.guards.redactDiagnostic(
        "Authorization: Bearer abc123def456ghi789",
      ),
    ).toBe("Authorization: Bearer [REDACTED:bearer-token]");
    expect(io.err.join("\n")).toContain("cannot be compared");
  });
});

describe("assertReadableArtifactPath", () => {
  it("canonicalizes ancestors and keeps the final component verbatim", async () => {
    const fixture = await createFixture("ancestors");
    const real = join(fixture.homeDir, "real");
    await nodeFs.mkdir(real, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(real, "config.toml"), "", { mode: 0o600 });
    const linked = join(fixture.homeDir, "linked");
    await nodeFs.symlink(real, linked);

    const policy = new ProtectedPathPolicy(fixture.homeDir);

    await expect(
      assertReadableArtifactPath(policy, join(linked, "config.toml")),
    ).resolves.toBe(join(real, "config.toml"));
  });

  it("leaves a symlinked final component unresolved", async () => {
    const fixture = await createFixture("leaf");
    const target = join(fixture.homeDir, "target.toml");
    await nodeFs.writeFile(target, "", { mode: 0o600 });
    const link = join(fixture.homeDir, "link.toml");
    await nodeFs.symlink(target, link);

    const policy = new ProtectedPathPolicy(fixture.homeDir);

    await expect(assertReadableArtifactPath(policy, link)).resolves.toBe(link);
  });

  it("returns a path whose parent does not exist yet", async () => {
    const fixture = await createFixture("missing");
    const policy = new ProtectedPathPolicy(fixture.homeDir);
    const path = join(fixture.homeDir, "absent", "config.toml");

    await expect(assertReadableArtifactPath(policy, path)).resolves.toBe(path);
  });

  it("refuses a path whose ancestor resolves into a protected directory", async () => {
    const fixture = await createFixture("protected");
    const secrets = join(fixture.homeDir, ".ssh");
    await nodeFs.mkdir(secrets, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(secrets, "config.toml"), "", { mode: 0o600 });
    const disguised = join(fixture.homeDir, "innocent");
    await nodeFs.symlink(secrets, disguised);

    const policy = new ProtectedPathPolicy(fixture.homeDir);

    await expect(
      assertReadableArtifactPath(policy, join(disguised, "config.toml")),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("refuses a protected ancestor even when the leaf links back out of it", async () => {
    const fixture = await createFixture("relinked");
    const secrets = join(fixture.homeDir, ".ssh");
    await nodeFs.mkdir(secrets, { recursive: true, mode: 0o700 });
    const innocuous = join(fixture.homeDir, "safe.toml");
    await nodeFs.writeFile(innocuous, "", { mode: 0o600 });
    await nodeFs.symlink(innocuous, join(secrets, "leaf.toml"));
    const disguised = join(fixture.homeDir, "innocent");
    await nodeFs.symlink(secrets, disguised);

    const policy = new ProtectedPathPolicy(fixture.homeDir);

    await expect(
      policy.assertReadable(join(disguised, "leaf.toml")),
    ).resolves.toBeUndefined();
    await expect(
      assertReadableArtifactPath(policy, join(disguised, "leaf.toml")),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("refuses a protected path outright", async () => {
    const fixture = await createFixture("outright");
    const policy = new ProtectedPathPolicy(fixture.homeDir);

    await expect(
      assertReadableArtifactPath(policy, join(fixture.homeDir, ".aws", "credentials")),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });
});

describe("assertRootsAnchored", () => {
  it("accepts a root that resolves inside an anchor", async () => {
    const fixture = await createFixture("anchored");
    const productHome = join(fixture.homeDir, ".developer-os");
    const elsewhere = join(fixture.homeDir, "Dropbox", "developer-os");
    await nodeFs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await nodeFs.symlink(elsewhere, productHome);

    await expect(
      assertRootsAnchored([fixture.homeDir], [productHome]),
    ).resolves.toBeUndefined();
  });

  it("refuses a root that resolves outside every anchor", async () => {
    const fixture = await createFixture("escape");
    const outside = join(fixture.root, "outside");
    await nodeFs.mkdir(outside, { recursive: true, mode: 0o700 });
    const productHome = join(fixture.homeDir, ".developer-os");
    await nodeFs.symlink(outside, productHome);

    await expect(
      assertRootsAnchored([fixture.homeDir], [productHome]),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("anchors an explicitly declared root to itself", async () => {
    const fixture = await createFixture("declared");
    const outside = join(fixture.root, "declared");
    await nodeFs.mkdir(outside, { recursive: true, mode: 0o700 });

    await expect(
      assertRootsAnchored([fixture.homeDir, outside], [outside]),
    ).resolves.toBeUndefined();
  });
});

describe("createGuards", () => {
  it("refuses a protected write target with the security exit code", async () => {
    const fixture = await createFixture("write");
    const guards = createGuards(
      new ProtectedPathPolicy(fixture.homeDir),
      REDACTION_KEY,
    );

    const refusal = await guards.transaction
      .assertTarget(join(fixture.homeDir, ".ssh", "id_ed25519"))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(EXIT_CODES.securityRefusal);
  });

  it("redacts diagnostics before they reach a report", async () => {
    const fixture = await createFixture("redact");
    const guards = createGuards(
      new ProtectedPathPolicy(fixture.homeDir),
      REDACTION_KEY,
    );

    expect(
      guards.redactDiagnostic("Authorization: Bearer abc123def456ghi789"),
    ).toBe("Authorization: Bearer [REDACTED:bearer-token]");
  });
});

describe("pathEnvironmentFor", () => {
  it("omits absent overrides instead of setting them to undefined", () => {
    const environment = pathEnvironmentFor({
      userHome: "/synthetic/home",
      env: { DEVELOPER_OS_BRAIN: "/synthetic/vault" },
    });

    expect(Object.keys(environment).sort()).toEqual([
      "DEVELOPER_OS_BRAIN",
      "HOME",
    ]);
    expect(environment.DEVELOPER_OS_BRAIN).toBe("/synthetic/vault");
  });
});
