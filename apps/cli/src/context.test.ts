import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { ProtectedPathPolicy } from "@developer-os/security";

import {
  assertReadableArtifactPath,
  assertRootsAnchored,
  createGuards,
  pathEnvironmentFor,
} from "./context.js";

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
