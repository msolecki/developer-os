import { createHash, generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  signedReleaseDocumentSigningBytes,
  validateOfficialReleaseOrigin,
  validateReleaseIndex,
  validateReleaseKeyDelegation,
} from "@developer-os/core";
import type {
  Base64UrlNoPaddingV1,
  DelegatedReleaseKeyV1,
  LowerHexSha256,
  OfflineRootKeyV1,
  ReleaseIndexV1,
  ReleaseKeyDelegationV1,
  SignedReleaseDocumentV1,
} from "@developer-os/core";
import { SecurityRefusalError, renderOfflineReleaseTrustPipe } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import type { LauncherEnvironmentV1 } from "./environment.js";
import {
  compileLauncherOfflineReleaseTrust,
  createLauncherRetainedDocumentVerifier,
  execAdmittedRelease,
  writeOfflineReleaseTrustHandoff,
} from "./handoff.js";

function rawPublicKey(key: KeyObject): Base64UrlNoPaddingV1 {
  const jwk = key.export({ format: "jwk" }) as { readonly x: string };
  return jwk.x as Base64UrlNoPaddingV1;
}
function keyIdOf(publicKey: Base64UrlNoPaddingV1): LowerHexSha256 {
  return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex") as LowerHexSha256;
}
function generateRoot(role: "online_current" | "retained_offline_previous"): { root: OfflineRootKeyV1; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const encoded = rawPublicKey(publicKey);
  return { root: { role, algorithm: "ed25519", keyId: keyIdOf(encoded), publicKey: encoded }, privateKey };
}
function generateDelegatedKey(): { releaseKey: DelegatedReleaseKeyV1; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const encoded = rawPublicKey(publicKey);
  return { releaseKey: { algorithm: "ed25519", keyId: keyIdOf(encoded), publicKey: encoded }, privateKey };
}
function sign<TKind extends string, TSigned>(
  kind: TKind,
  signed: TSigned,
  keyId: LowerHexSha256,
  privateKey: KeyObject,
): SignedReleaseDocumentV1<TKind, TSigned> {
  const bytes = signedReleaseDocumentSigningBytes(kind, signed as never);
  const signature = signEd25519(null, bytes, privateKey).toString("base64url") as Base64UrlNoPaddingV1;
  return { schemaVersion: 1, kind, signed, signatures: [{ algorithm: "ed25519", keyId, signature }] };
}

const origin = validateOfficialReleaseOrigin({
  scheme: "https",
  host: "github.com",
  port: 443,
  pathPrefix: "/msolecki/developer-os/releases/latest/download/",
});

function makeDelegation(releaseKey: DelegatedReleaseKeyV1): ReleaseKeyDelegationV1 {
  return validateReleaseKeyDelegation({ sequence: "1", releaseKey, metadataOrigins: [origin], assetOrigins: [origin] });
}
function makeIndex(): ReleaseIndexV1 {
  return validateReleaseIndex({
    sequence: "1",
    latestVersion: "1.0.0",
    releases: [
      {
        version: "1.0.0",
        releaseSequence: "1",
        minimumLauncherProtocol: 1,
        updateProtocol: 1,
        bundles: [
          {
            platform: "darwin",
            architecture: "arm64",
            archiveFormat: "zstd-ustar-v1",
            archivePath: "darwin-arm64.tar.zst",
            archiveBytes: "1",
            archiveSha256: "a".repeat(64),
            manifestPath: "darwin-arm64-manifest.json",
            manifestBytes: "1",
            manifestSha256: "b".repeat(64),
          },
          {
            platform: "darwin",
            architecture: "x64",
            archiveFormat: "zstd-ustar-v1",
            archivePath: "darwin-x64.tar.zst",
            archiveBytes: "1",
            archiveSha256: "c".repeat(64),
            manifestPath: "darwin-x64-manifest.json",
            manifestBytes: "1",
            manifestSha256: "d".repeat(64),
          },
        ],
      },
    ],
  });
}

describe("compileLauncherOfflineReleaseTrust", () => {
  it("returns null when no root key has been decided yet", () => {
    expect(compileLauncherOfflineReleaseTrust({ acceptedRoots: [], metadataRedirectOrigins: [origin] })).toBeNull();
  });

  it("returns null when no accepted root is the current online root", () => {
    const previous = generateRoot("retained_offline_previous");
    expect(
      compileLauncherOfflineReleaseTrust({ acceptedRoots: [previous.root], metadataRedirectOrigins: [origin] }),
    ).toBeNull();
  });

  it("compiles a valid offline release trust document from injected roots", () => {
    const current = generateRoot("online_current");
    const trust = compileLauncherOfflineReleaseTrust({ acceptedRoots: [current.root], metadataRedirectOrigins: [origin] });

    expect(trust).not.toBeNull();
    expect(trust?.onlineRootKeyId).toBe(current.root.keyId);
    expect(trust?.acceptedRoots).toEqual([current.root]);
    expect(trust?.delegationLocator.assetName).toBe("release-key-delegation-v1.json");
    expect(trust?.indexLocator.assetName).toBe("release-index-v1.json");
  });
});

describe("createLauncherRetainedDocumentVerifier", () => {
  it("verifies a delegation then its release index in order", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = sign("release-key-delegation", makeDelegation(delegated.releaseKey), current.root.keyId, current.privateKey);
    const index = sign("release-index", makeIndex(), delegated.releaseKey.keyId, delegated.privateKey);
    const verify = createLauncherRetainedDocumentVerifier([current.root]);

    expect(() => { verify(delegation); }).not.toThrow();
    expect(() => { verify(index); }).not.toThrow();
  });

  it("accepts a delegation signed by the retained previous root", () => {
    const previous = generateRoot("retained_offline_previous");
    const delegated = generateDelegatedKey();
    const delegation = sign("release-key-delegation", makeDelegation(delegated.releaseKey), previous.root.keyId, previous.privateKey);
    const index = sign("release-index", makeIndex(), delegated.releaseKey.keyId, delegated.privateKey);
    const verify = createLauncherRetainedDocumentVerifier([previous.root]);

    expect(() => { verify(delegation); }).not.toThrow();
    expect(() => { verify(index); }).not.toThrow();
  });

  it("refuses a release index presented before its delegation", () => {
    const delegated = generateDelegatedKey();
    const index = sign("release-index", makeIndex(), delegated.releaseKey.keyId, delegated.privateKey);
    const verify = createLauncherRetainedDocumentVerifier([]);

    expect(() => { verify(index); }).toThrow(SecurityRefusalError);
  });

  it("refuses a document of an unknown kind", () => {
    const current = generateRoot("online_current");
    const verify = createLauncherRetainedDocumentVerifier([current.root]);

    expect(() => {
      verify({ schemaVersion: 1, kind: "something-else", signed: {}, signatures: [] });
    }).toThrow(SecurityRefusalError);
  });

  it("refuses a delegation signed by an untrusted root", () => {
    const trusted = generateRoot("online_current");
    const rogue = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = sign("release-key-delegation", makeDelegation(delegated.releaseKey), rogue.root.keyId, rogue.privateKey);
    const verify = createLauncherRetainedDocumentVerifier([trusted.root]);

    expect(() => { verify(delegation); }).toThrow(SecurityRefusalError);
  });

  it("refuses a release index signed by a key other than the verified delegation's", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const rogue = generateDelegatedKey();
    const delegation = sign("release-key-delegation", makeDelegation(delegated.releaseKey), current.root.keyId, current.privateKey);
    const index = sign("release-index", makeIndex(), rogue.releaseKey.keyId, rogue.privateKey);
    const verify = createLauncherRetainedDocumentVerifier([current.root]);

    verify(delegation);
    expect(() => { verify(index); }).toThrow(SecurityRefusalError);
  });
});

describe("writeOfflineReleaseTrustHandoff", () => {
  it("writes canonical JSON plus one LF to a real pipe and closes the write side", async () => {
    const current = generateRoot("online_current");
    const trust = compileLauncherOfflineReleaseTrust({ acceptedRoots: [current.root], metadataRedirectOrigins: [origin] });
    if (trust === null) throw new Error("test fixture must compile a trust document");
    const expected = renderOfflineReleaseTrustPipe(trust);

    const child = spawn(
      process.execPath,
      ["-e", "const fs=require('node:fs');process.stdout.write(fs.readFileSync(3));"],
      { stdio: ["ignore", "pipe", "inherit", "pipe"] },
    );
    const extraPipe = child.stdio[3];
    if (extraPipe === null) {
      throw new Error("test fixture requires a writable fd 3");
    }

    const stdoutChunks: Buffer[] = [];
    if (child.stdout === null) throw new Error("test fixture requires a readable stdout");
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    await writeOfflineReleaseTrustHandoff(extraPipe as NodeJS.WritableStream, trust);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("close", (code) => {
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);
    expect(Buffer.concat(stdoutChunks)).toEqual(Buffer.from(expected));
  });
});

describe("the FD 3 handoff end to end", () => {
  const cliDist = fileURLToPath(new URL("../../cli/dist/", import.meta.url));
  const env = { HOME: tmpdir(), DEVELOPER_OS_HOME: join(tmpdir(), "developer-os-handoff") } as LauncherEnvironmentV1;
  const trustFlag = "--offline-release-trust-fd=3";

  function configuredTrust() {
    const trust = compileLauncherOfflineReleaseTrust({ acceptedRoots: [generateRoot("online_current").root], metadataRedirectOrigins: [origin] });
    if (trust === null) throw new Error("test fixture must compile a trust document");
    return trust;
  }

  it("the launcher's spawn hands the CLI's production reader the trust document", async () => {
    const trust = configuredTrust();
    const directory = await mkdtemp(join(tmpdir(), "developer-os-handoff-"));
    try {
      const script = join(directory, "read-trust.mjs");
      const output = join(directory, "trust.json");
      await writeFile(script, [
        `import { writeFileSync } from "node:fs";`,
        `const { readOfflineTrust } = await import(${JSON.stringify(join(cliDist, "update", "context.js"))});`,
        `try { writeFileSync(${JSON.stringify(output)}, JSON.stringify(await readOfflineTrust())); }`,
        `catch (error) { process.stderr.write(String(error?.message ?? error) + "\\n"); process.exitCode = 9; }`,
      ].join("\n"));

      const outcome = await execAdmittedRelease(
        { executable: process.execPath as never, argv: [script, trustFlag, "status"], env, extraDescriptors: [{ fd: 3, mode: "read_only_pipe" }] },
        trust,
      );

      expect(outcome).toEqual({ code: 0, signal: null });
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(trust);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("the launcher's spawn hands the child no descriptor beyond stdio and FD 3", async () => {
    const directory = await mkdtemp(join(tmpdir(), "developer-os-handoff-"));
    const held = await open(join(directory, "held"), "w");
    try {
      const script = join(directory, "probe.mjs");
      await writeFile(script, [
        `import { fstatSync } from "node:fs";`,
        `try { fstatSync(${String(held.fd)}); process.exitCode = 9; } catch { process.exitCode = 0; }`,
      ].join("\n"));

      const outcome = await execAdmittedRelease(
        { executable: process.execPath as never, argv: [script], env, extraDescriptors: [{ fd: 3, mode: "read_only_pipe" }] },
        configuredTrust(),
      );

      expect(held.fd).toBeGreaterThan(11);
      expect(outcome).toEqual({ code: 0, signal: null });
    } finally {
      await held.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("the CLI dispatches a command behind the launcher's trust flag", async () => {
    const outcome = await execAdmittedRelease(
      { executable: process.execPath as never, argv: [join(cliDist, "bin.js"), trustFlag, "--version"], env, extraDescriptors: [{ fd: 3, mode: "read_only_pipe" }] },
      configuredTrust(),
    );

    expect(outcome).toEqual({ code: 0, signal: null });
  });
});
