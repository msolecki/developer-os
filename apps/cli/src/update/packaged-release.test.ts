import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { encodeCanonicalJson, EXIT_CODES, UNSIGNED_LOCAL_RELEASE_KEY_ID } from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";

import {
  admitRootVerifiedPackagedRelease,
  admitUnsignedLocalPackagedRelease,
  inspectPackagedRelease,
  unavailablePackagedReleaseSource,
  UNSIGNED_LOCAL_LAYOUT,
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
    expect(admitted.trust).toBe("root-verified");
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

  it("revalidates one sealed file without rescanning unrelated package bytes", async () => {
    const { root, source, files } = await fixture();
    const admitted = await inspectPackagedRelease(source);
    await nodeFs.writeFile(join(root, "unrelated-after-phase-admission"), "later\n", {
      mode: 0o600,
    });

    expect(
      new TextDecoder().decode(await admitted.readFile("bundle/bin/developer-os")),
    ).toBe(files["bundle/bin/developer-os"]);
  });

  it("still refuses the selected file when its sealed inode is replaced", async () => {
    const { root, source, files } = await fixture();
    const admitted = await inspectPackagedRelease(source);
    const selected = join(root, "bundle/bin/developer-os");
    const replacement = join(root, "bundle/bin/replacement");
    await nodeFs.writeFile(replacement, files["bundle/bin/developer-os"], { mode: 0o700 });
    await nodeFs.rename(replacement, selected);

    await expect(admitted.readFile("bundle/bin/developer-os")).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });
});

type UnsignedDocuments = Record<"delegation" | "releaseIndex" | "bundleManifest", Record<string, CanonicalJsonValue>>;

interface UnsignedPackageOptions {
  readonly mutate?: (documents: UnsignedDocuments) => void;
  readonly raw?: Partial<Record<keyof UnsignedDocuments, string>>;
  readonly afterWrite?: (root: string) => Promise<void>;
}

const BUNDLE_FILES = {
  "bin/developer-os": "#!/bin/sh\nexit 64\n",
  "instructions/README.md": "defaults\n",
} as const;

async function unsignedPackage(options: UnsignedPackageOptions = {}) {
  const root = await nodeFs.realpath(
    await nodeFs.mkdtemp(join(tmpdir(), "developer-os-unsigned-local-")),
  );
  roots.push(root);
  await nodeFs.chmod(root, 0o700);
  for (const directory of ["metadata", "bundle", "bundle/bin", "bundle/instructions"]) {
    await nodeFs.mkdir(join(root, directory), { mode: 0o700 });
  }
  for (const [relativePath, bytes] of Object.entries(BUNDLE_FILES)) {
    await nodeFs.writeFile(join(root, "bundle", relativePath), bytes, {
      mode: relativePath === "bin/developer-os" ? 0o700 : 0o600,
    });
  }
  const documents: UnsignedDocuments = {
    delegation: { schemaVersion: 1, trust: "unsigned-local" },
    releaseIndex: { releaseSequence: "1", schemaVersion: 1, trust: "unsigned-local", version: "0.0.0" },
    bundleManifest: {
      files: Object.entries(BUNDLE_FILES)
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([path, bytes]) => ({ bytes: Buffer.byteLength(bytes), path, sha256: hash(bytes) })),
      schemaVersion: 1,
      trust: "unsigned-local",
    },
  };
  options.mutate?.(documents);
  const written = {} as Record<keyof UnsignedDocuments, string>;
  for (const name of ["delegation", "releaseIndex", "bundleManifest"] as const) {
    written[name] = options.raw?.[name] ?? encodeCanonicalJson(documents[name]);
    await nodeFs.writeFile(join(root, UNSIGNED_LOCAL_LAYOUT[name]), written[name], { mode: 0o600 });
  }
  await options.afterWrite?.(root);
  return { root, written };
}

describe("admitUnsignedLocalPackagedRelease", () => {
  it("admits a hash-sealed local build and derives its identity", async () => {
    const { root, written } = await unsignedPackage();
    const admitted = await inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(root, "0.0.0"));
    expect(admitted.trust).toBe("unsigned-local");
    expect(admitted.bundleRoot).toBe("bundle");
    expect(admitted.retainedMetadata).toStrictEqual({
      delegation: "metadata/release-key-delegation.json",
      releaseIndex: "metadata/release-index.json",
      bundleManifest: "metadata/bundle-manifest.json",
    });
    expect(admitted.identity).toStrictEqual({
      version: "0.0.0",
      releaseSequence: "1",
      releaseIdentityHash: createHash("sha256")
        .update("developer-os:unsigned-local-release-identity:v1\0")
        .update(written.bundleManifest)
        .digest("hex"),
      delegationSequence: "1",
      delegationHash: hash(written.delegation),
      delegatedReleaseKeyId: UNSIGNED_LOCAL_RELEASE_KEY_ID,
      releaseIndexSequence: "1",
      releaseIndexHash: hash(written.releaseIndex),
      bundleManifestHash: hash(written.bundleManifest),
      platform: "darwin",
      architecture: process.arch,
      launcherProtocol: 1,
      updateProtocol: 1,
    });
    expect(new TextDecoder().decode(await admitted.readFile("bundle/instructions/README.md"))).toBe(
      BUNDLE_FILES["instructions/README.md"],
    );
  });

  const refusals: readonly (readonly [string, UnsignedPackageOptions])[] = [
    ["a bundle file absent from the bundle manifest", {
      afterWrite: (root) => nodeFs.writeFile(join(root, "bundle/extra"), "extra\n", { mode: 0o600 }),
    }],
    ["a manifest row absent from bundle/", {
      mutate: (documents) => {
        (documents.bundleManifest.files as CanonicalJsonValue[]).push({ bytes: 1, path: "zz-missing", sha256: hash("z") });
      },
    }],
    ["a changed sha256", {
      mutate: (documents) => {
        const [first, ...rest] = documents.bundleManifest.files as Record<string, CanonicalJsonValue>[];
        documents.bundleManifest.files = [{ ...first, sha256: hash("changed") }, ...rest];
      },
    }],
    ["non-canonical document bytes", {
      raw: { delegation: '{ "schemaVersion": 1, "trust": "unsigned-local" }\n' },
    }],
    ["a document with an extra key", {
      mutate: (documents) => { documents.releaseIndex.extra = 1; },
    }],
    ["a trust other than unsigned-local", {
      mutate: (documents) => { documents.delegation.trust = "signed"; },
    }],
  ];
  it("enumerates a non-empty refusal set", () => {
    expect(refusals.length).toBeGreaterThan(0);
  });

  it.each(refusals)("refuses %s with a security refusal", async (_name, options) => {
    const { root } = await unsignedPackage(options);
    await expect(admitUnsignedLocalPackagedRelease(root, "0.0.0")).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });

  it("refuses a version other than the product version as release_mismatch", async () => {
    const { root } = await unsignedPackage({
      mutate: (documents) => { documents.releaseIndex.version = "0.0.1"; },
    });
    await expect(admitUnsignedLocalPackagedRelease(root, "0.0.0")).rejects.toMatchObject({
      code: EXIT_CODES.capabilityUnavailable,
      message: "release_mismatch",
    });
  });

  it("refuses a file changed after admission on readFile", async () => {
    const { root } = await unsignedPackage();
    const admitted = await inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(root, "0.0.0"));
    await nodeFs.writeFile(join(root, "bundle/instructions/README.md"), "tampered\n", { mode: 0o600 });
    await expect(admitted.readFile("bundle/instructions/README.md")).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });
});
