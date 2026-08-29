import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import {
  admitRootVerifiedPackagedRelease,
  inspectPackagedRelease,
  unavailablePackagedReleaseSource,
} from "./packaged-release.js";

const roots: string[] = [];
const hash = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await nodeFs.realpath(
    await nodeFs.mkdtemp(join(tmpdir(), "developer-os-packaged-release-")),
  );
  roots.push(root);
  await nodeFs.chmod(root, 0o700);
  await nodeFs.mkdir(join(root, "bundle/bin"), { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(join(root, "templates"), { mode: 0o700 });
  const files = {
    "release-key-delegation-v1.json": "delegation\n",
    "release-index-v1.json": "index\n",
    "release-bundle-manifest-v1.json": "manifest\n",
    "bundle/bin/developer-os": "#!/bin/sh\n",
    "templates/ingest.stage.schema.json": "{}\n",
  } as const;
  for (const [relativePath, bytes] of Object.entries(files)) {
    await nodeFs.writeFile(join(root, relativePath), bytes, { mode: relativePath.includes("/bin/") ? 0o700 : 0o600 });
  }
  const source = await admitRootVerifiedPackagedRelease({
    packageRoot: root,
    retainedMetadata: {
      delegation: "release-key-delegation-v1.json",
      releaseIndex: "release-index-v1.json",
      bundleManifest: "release-bundle-manifest-v1.json",
    },
    bundleRoot: "bundle",
    identity: {
      version: "0.0.0",
      releaseSequence: "1",
      releaseIdentityHash: hash("release"),
      delegationSequence: "1",
      delegationHash: hash(files["release-key-delegation-v1.json"]),
      delegatedReleaseKeyId: hash("release-key"),
      releaseIndexSequence: "1",
      releaseIndexHash: hash(files["release-index-v1.json"]),
      bundleManifestHash: hash(files["release-bundle-manifest-v1.json"]),
      platform: "darwin",
      architecture: "arm64",
      launcherProtocol: 1,
      updateProtocol: 1,
    },
  });
  return { root, source, files };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => nodeFs.rm(root, { recursive: true, force: true })));
});

describe("PackagedReleaseSourceV1", () => {
  it("revalidates and admits the exact offline package inventory without transport", async () => {
    const { source, files } = await fixture();
    const admitted = await inspectPackagedRelease(source);
    expect(admitted.identity.version).toBe("0.0.0");
    expect(admitted.files.map((file) => file.relativePath)).toStrictEqual([
      "bundle/bin/developer-os",
      "release-bundle-manifest-v1.json",
      "release-index-v1.json",
      "release-key-delegation-v1.json",
      "templates/ingest.stage.schema.json",
    ]);
    expect(new TextDecoder().decode(await admitted.readFile("bundle/bin/developer-os"))).toBe(
      files["bundle/bin/developer-os"],
    );
  });

  it("fails closed when production has no root-verified packaged handoff", async () => {
    await expect(inspectPackagedRelease(unavailablePackagedReleaseSource())).rejects.toMatchObject({
      code: EXIT_CODES.capabilityUnavailable,
    });
  });

  it("refuses a byte change after capability admission", async () => {
    const { root, source } = await fixture();
    await nodeFs.writeFile(join(root, "bundle/bin/developer-os"), "tampered\n", { mode: 0o700 });
    await expect(inspectPackagedRelease(source)).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });

  it("refuses a same-byte inode replacement after capability admission", async () => {
    const { root, source, files } = await fixture();
    const path = join(root, "bundle/bin/developer-os");
    const replacement = join(root, "bundle/bin/replacement");
    await nodeFs.writeFile(replacement, files["bundle/bin/developer-os"], { mode: 0o700 });
    await nodeFs.rename(replacement, path);
    await expect(inspectPackagedRelease(source)).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });

  it("refuses an extra package child outside the sealed exact inventory", async () => {
    const { root, source } = await fixture();
    await nodeFs.writeFile(join(root, "extra"), "extra\n", { mode: 0o600 });
    await expect(inspectPackagedRelease(source)).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });
});
