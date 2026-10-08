import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  encodeCanonicalJson,
  EXIT_CODES,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
  releaseIdentityHash,
  UNSIGNED_LOCAL_RELEASE_KEY_ID,
  validateBundleManifest,
} from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";

import { writePackageChannelRelease } from "./local-release.js";
import type { ReleaseFileV1 } from "./local-release.js";
import {
  admitPackageChannelRelease,
  isPackageSourceAbsent,
  isReleaseMismatch,
  admitUnsignedLocalPackagedRelease,
  inspectPackagedRelease,
  PackagedReleaseError,
  resolvePackageChannelSource,
  unavailablePackagedReleaseSource,
  UNSIGNED_LOCAL_LAYOUT,
} from "./packaged-release.js";

const roots: string[] = [];
const hash = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

/** An admitted unsigned-local package: the sealing and guarded-reread rules are shared by every trust. */
async function fixture() {
  const { root } = await unsignedPackage();
  const source = await admitUnsignedLocalPackagedRelease(root, "0.0.0");
  return { root, source, files: { "bundle/bin/developer-os": BUNDLE_FILES["bin/developer-os"] } };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => nodeFs.rm(root, { recursive: true, force: true })));
});

describe("PackagedReleaseSourceV1", () => {
  it("revalidates and admits the exact sealed package inventory", async () => {
    const { source, files } = await fixture();
    const admitted = await inspectPackagedRelease(source);
    expect(admitted.trust).toBe("unsigned-local");
    expect(admitted.identity.version).toBe("0.0.0");
    expect(admitted.files.map((file) => file.relativePath)).toStrictEqual([
      "bundle/bin/developer-os",
      "bundle/instructions/README.md",
      "metadata/bundle-manifest.json",
      "metadata/release-index.json",
      "metadata/release-key-delegation.json",
    ]);
    expect(new TextDecoder().decode(await admitted.readFile("bundle/bin/developer-os"))).toBe(
      files["bundle/bin/developer-os"],
    );
  });

  it("fails closed when production has no packaged handoff", async () => {
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

/** Synthetic keg release: both architectures are indexed, the manifest is the host architecture's. */
function syntheticKegRelease(version: string, sequence: string, architecture: "arm64" | "x64") {
  const encoder = new TextEncoder();
  const bundle: ReadonlyArray<readonly [string, 0o600 | 0o700]> = [
    ["bin/cli", 0o700],
    ["bin/planner", 0o700],
    ["bin/runtime", 0o700],
    ["bin/verifier", 0o700],
    ["share/note.txt", 0o600],
  ];
  const files: ReleaseFileV1[] = bundle.map(([relativePath, mode]) => ({
    relativePath,
    bytes: encoder.encode(`synthetic ${version} ${relativePath}\n`),
    mode,
  }));
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version,
    releaseSequence: sequence,
    platform: "darwin",
    architecture,
    launcherProtocol: 1,
    updateProtocol: 1,
    entrypoint: "bin/cli",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: [
      { path: "bin", kind: "directory", mode: 448 },
      ...files
        .filter((file) => file.relativePath.startsWith("bin/"))
        .map((file) => ({ path: file.relativePath, kind: "file", mode: 448, bytes: String(file.bytes.byteLength), sha256: hash(new TextDecoder().decode(file.bytes)) })),
      { path: "share", kind: "directory", mode: 448 },
      ...files
        .filter((file) => file.relativePath.startsWith("share/"))
        .map((file) => ({ path: file.relativePath, kind: "file", mode: 384, bytes: String(file.bytes.byteLength), sha256: hash(new TextDecoder().decode(file.bytes)) })),
    ],
  });
  const manifestBytes = encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));
  const reference = (candidate: "arm64" | "x64") => ({
    platform: "darwin",
    architecture: candidate,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `${version}/darwin-${candidate}.tar.zst`,
    archiveBytes: "10",
    archiveSha256: hash(`archive ${candidate}`),
    manifestPath: `${version}/darwin-${candidate}.manifest.json`,
    manifestBytes: candidate === architecture ? String(manifestBytes.byteLength) : "11",
    manifestSha256: candidate === architecture ? createHash("sha256").update(manifestBytes).digest("hex") : hash(`other ${candidate}`),
  });
  const index = {
    sequence: "1",
    latestVersion: version,
    releases: [{ version, releaseSequence: sequence, minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [reference("arm64"), reference("x64")] }],
  } as unknown as CanonicalJsonValue;
  return { index, manifest, files };
}

async function kegFixture(version = "1.2.0", sequence = "3", architecture: "arm64" | "x64" = ARCH) {
  const prefix = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-keg-")));
  roots.push(prefix);
  await nodeFs.chmod(prefix, 0o755);
  const keg = join(prefix, "Cellar", "developer-os", version);
  await nodeFs.mkdir(join(keg, "libexec"), { recursive: true, mode: 0o755 });
  await nodeFs.mkdir(join(prefix, "opt"), { mode: 0o755 });
  await nodeFs.symlink(`../Cellar/developer-os/${version}`, join(prefix, "opt", "developer-os"));
  const { index, manifest, files } = syntheticKegRelease(version, sequence, architecture);
  const packageRoot = await writePackageChannelRelease({ outDir: join(keg, "libexec", "fallback"), index, manifest, bundleFiles: files });
  return { prefix, keg, packageRoot, index, manifest };
}
const ARCH = process.arch as "arm64" | "x64";
const table = (prefix: string) => ({ arm64: { prefix, opt: `${prefix}/opt/developer-os`, fallback: "libexec/fallback" }, x64: { prefix, opt: `${prefix}/opt/developer-os`, fallback: "libexec/fallback" } }) as never;

describe("admitPackageChannelRelease (D84 K2)", () => {
  it("(a) admits Homebrew modes, derives the identity from the index row, and maps modes to their class", async () => {
    const { prefix, packageRoot, index } = await kegFixture();
    const admitted = await inspectPackagedRelease(await admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH }));
    expect(admitted.trust).toBe("package-channel");
    expect(admitted.identity).toMatchObject({ version: "1.2.0", releaseSequence: "3", delegationSequence: "0", delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID, releaseIdentityHash: releaseIdentityHash((index as { releases: unknown[] }).releases[0], process.arch as "arm64") });
    expect(new Set(admitted.files.map((file) => file.mode))).toEqual(new Set([0o600, 0o700]));
  });
  it("admits an x64 keg on any host when told the architecture", async () => {
    const { prefix, packageRoot } = await kegFixture("1.2.0", "3", "x64");
    const admitted = await inspectPackagedRelease(await admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: "x64" }));
    expect(admitted.identity.architecture).toBe("x64");
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: "arm64" })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("classifies only the absent table path as no keg (init then gets null)", async () => {
    const prefix = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-nokeg-")));
    roots.push(prefix);
    const absent = await resolvePackageChannelSource(ARCH, table(prefix)).catch((error: unknown) => error);
    expect(isPackageSourceAbsent(absent)).toBe(true);
    expect(isPackageSourceAbsent(new Error("update_package_source_absent"))).toBe(false);
    const { prefix: broken } = await kegFixture();
    await nodeFs.rm(join(broken, "Cellar/developer-os/1.2.0/libexec/fallback"), { recursive: true });
    expect(isPackageSourceAbsent(await resolvePackageChannelSource(ARCH, table(broken)).catch((error: unknown) => error))).toBe(true);
  });
  it("(b) refuses a 0666 bundle file as exit 6", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(packageRoot, "bundle/bin/verifier"), 0o666);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(c) refuses an executable bit that disagrees with the manifest mode", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(packageRoot, "bundle/bin/runtime"), 0o644);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(d) refuses an other-writable ancestor below the prefix and admits a group-writable one the user owns (Q1)", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(prefix, "Cellar"), 0o775);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH })).resolves.toBeDefined();
    await nodeFs.chmod(join(prefix, "Cellar"), 0o777);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(e) splits the version check: init requires PRODUCT_VERSION, update does not", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: "9.9.9", architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "release_mismatch" });
  });
  it("classifies a version split as release_mismatch, and nothing else (C2)", async () => {
    const { prefix, packageRoot } = await kegFixture();
    const error = await admitPackageChannelRelease(packageRoot, { prefix, requireVersion: "9.9.9", architecture: ARCH }).catch((caught: unknown) => caught);
    expect(isReleaseMismatch(error)).toBe(true);
    expect(isReleaseMismatch(new PackagedReleaseError(EXIT_CODES.recoveryRequired, "release_mismatch"))).toBe(false);
  });
  it("(f) resolves the opt link once to its canonical keg, and an absent path is exit 4", async () => {
    const { prefix, keg } = await kegFixture();
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).resolves.toEqual({ kegRoot: keg, packageRoot: join(keg, "libexec/fallback") });
    await nodeFs.rm(join(prefix, "opt", "developer-os"));
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "update_package_source_absent" });
  });
  it("(g) refuses an opt link that leaves <prefix>/Cellar/developer-os", async () => {
    const { prefix } = await kegFixture();
    await nodeFs.rm(join(prefix, "opt", "developer-os"));
    await nodeFs.symlink("/tmp", join(prefix, "opt", "developer-os"));
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(h) refuses a swapped file at reread", async () => {
    const { prefix, packageRoot } = await kegFixture();
    const source = await admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null, architecture: ARCH });
    await nodeFs.chmod(join(packageRoot, "bundle/bin/cli"), 0o644);
    await expect(inspectPackagedRelease(source)).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal, message: "packaged release changed after admission" });
  });
  it("refuses a non-canonical prefix instead of walking forever", async () => {
    const { packageRoot } = await kegFixture();
    await expect(admitPackageChannelRelease(packageRoot, { prefix: "", requireVersion: null, architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    await expect(admitPackageChannelRelease(packageRoot, { prefix: "/", requireVersion: null, architecture: ARCH })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
});

describe("packageInventoryHash (v1 domain)", () => {
  it("does not include the internal diskMode: an unsigned-local hash is the v1 hash of dev, ino and class mode only", async () => {
    const { root, written } = await unsignedPackage();
    const dir = async (path: string) => {
      const stats = await nodeFs.lstat(join(root, path), { bigint: true });
      return { relativePath: path, mode: 0o700, dev: stats.dev.toString(10), ino: stats.ino.toString(10) };
    };
    const row = async (path: string, bytes: string, mode: 0o600 | 0o700) => {
      const stats = await nodeFs.lstat(join(root, path), { bigint: true });
      return { relativePath: path, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), mode, dev: stats.dev.toString(10), ino: stats.ino.toString(10) };
    };
    const expected = createHash("sha256")
      .update("developer-os/packaged-release-inventory/v1\0")
      .update(encodeCanonicalJson({
        directories: [await dir("bundle"), await dir("bundle/bin"), await dir("bundle/instructions"), await dir("metadata")],
        files: [
          await row("bundle/bin/developer-os", BUNDLE_FILES["bin/developer-os"], 0o700),
          await row("bundle/instructions/README.md", BUNDLE_FILES["instructions/README.md"], 0o600),
          await row("metadata/bundle-manifest.json", written.bundleManifest, 0o600),
          await row("metadata/release-index.json", written.releaseIndex, 0o600),
          await row("metadata/release-key-delegation.json", written.delegation, 0o600),
        ],
      }).slice(0, -1))
      .digest("hex");
    const source = await admitUnsignedLocalPackagedRelease(root, "0.0.0");
    expect((await inspectPackagedRelease(source)).packageInventoryHash).toBe(expected);
  });
});
