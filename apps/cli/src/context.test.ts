import { randomBytes } from "node:crypto";
import fsSync from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { ProtectedPathPolicy, redactText, SecurityRefusalError } from "@developer-os/security";

import {
  assertReadableArtifactPath,
  assertRootsAnchored,
  createGuards,
  createProductionContext,
  loadOrCreateRedactionKey,
  pathEnvironmentFor,
} from "./context.js";
import type { CliIo } from "./io.js";

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
   * including the recursive re-read this function is required to take — runs
   * for real.
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

describe("createProductionContext", () => {
  /**
   * `doctor` and `status` run, read-only, on a machine that has never seen
   * `init` — `paths.stateDir` does not exist yet on such a machine, and
   * `loadOrCreateRedactionKey` cannot create a file inside a directory that
   * is not there. Falling back to an ephemeral key (today's pre-Task-1
   * behaviour, for exactly this one case) is what keeps that possible; the
   * alternative, creating `stateDir` here so the loader can succeed, would
   * make running `doctor` a repair, which is the contract `doctor.ts` exists
   * to keep.
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
