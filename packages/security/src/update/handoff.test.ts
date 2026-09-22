import { createHash, generateKeyPairSync } from "node:crypto";

import { encodeCanonicalJson, validateOfficialReleaseOrigin } from "@developer-os/core";
import type { Base64UrlNoPaddingV1, LowerHexSha256, OfflineReleaseTrustV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import { readOfflineReleaseTrustFd, renderOfflineReleaseTrustPipe, type OfflineTrustReaderDependencies } from "./handoff.js";

function syntheticRootKey(): Base64UrlNoPaddingV1 {
  const { publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { readonly x: string };
  return jwk.x as Base64UrlNoPaddingV1;
}

function keyIdOf(publicKey: Base64UrlNoPaddingV1): LowerHexSha256 {
  return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex") as LowerHexSha256;
}

function validTrust(): OfflineReleaseTrustV1 {
  const publicKey = syntheticRootKey();
  const keyId = keyIdOf(publicKey);
  return {
    schemaVersion: 1,
    handoffProtocol: 1,
    onlineRootKeyId: keyId,
    acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId, publicKey }],
    delegationLocator: {
      origin: "https://github.com",
      repositoryPath: "/msolecki/developer-os/releases/latest/download/",
      assetName: "release-key-delegation-v1.json",
    },
    indexLocator: {
      origin: "https://github.com",
      repositoryPath: "/msolecki/developer-os/releases/latest/download/",
      assetName: "release-index-v1.json",
    },
    metadataRedirectOrigins: [
      validateOfficialReleaseOrigin({
        scheme: "https",
        host: "github.com",
        port: 443,
        pathPrefix: "/msolecki/developer-os/releases/latest/download/",
      }),
    ],
  };
}

interface FakeOptions {
  readonly parentProcessId?: number;
  readonly openDescriptors?: readonly number[];
  readonly isFIFO?: boolean;
  readonly chunks?: readonly Uint8Array[];
}

function createFakeDependencies(options: FakeOptions, log: string[]): OfflineTrustReaderDependencies {
  const remaining = [...(options.chunks ?? [])];
  return {
    parentProcessId: () => {
      log.push("parentProcessId");
      return options.parentProcessId ?? 4242;
    },
    openDescriptors: () => {
      log.push("openDescriptors");
      return Promise.resolve(options.openDescriptors ?? [0, 1, 2, 3]);
    },
    fstat: (descriptor) => {
      log.push(`fstat:${String(descriptor)}`);
      return Promise.resolve({ isFIFO: options.isFIFO ?? true });
    },
    read: (descriptor) => {
      log.push(`read:${String(descriptor)}`);
      return Promise.resolve(remaining.shift() ?? new Uint8Array(0));
    },
    close: (descriptor) => {
      log.push(`close:${String(descriptor)}`);
      return Promise.resolve();
    },
  };
}

function chunksOf(bytes: Uint8Array, chunkSize: number): readonly Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

describe("renderOfflineReleaseTrustPipe", () => {
  it("encodes canonical JSON plus exactly one trailing LF", () => {
    const trust = validTrust();
    const rendered = renderOfflineReleaseTrustPipe(trust);
    const text = new TextDecoder().decode(rendered);

    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toBe(encodeCanonicalJson(trust as never));
  });
});

describe("readOfflineReleaseTrustFd", () => {
  it("reads a valid trust document across multiple chunks and closes the descriptor", async () => {
    const trust = validTrust();
    const bytes = renderOfflineReleaseTrustPipe(trust);
    const log: string[] = [];
    const dependencies = createFakeDependencies({ chunks: chunksOf(bytes, 4) }, log);

    const result = await readOfflineReleaseTrustFd(3, dependencies);

    expect(result).toEqual(trust);
    expect(log.at(-1)).toBe("close:3");
    expect(log.filter((entry) => entry === "close:3")).toHaveLength(1);
  });

  it("refuses a descriptor whose parent has already been orphaned", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ parentProcessId: 1 }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("refuses extra inherited descriptors beyond stdio and the trust pipe", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ openDescriptors: [0, 1, 2, 3, 42] }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("refuses when the trust descriptor was never actually opened", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ openDescriptors: [0, 1, 2] }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
  });

  it("refuses a descriptor that is not a pipe", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ isFIFO: false }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("refuses a payload that exceeds the 64 KiB bound and never blocks past it", async () => {
    const oversized = new Uint8Array(65_537).fill(0x20);
    const log: string[] = [];
    const dependencies = createFakeDependencies({ chunks: chunksOf(oversized, 4096) }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("does not refuse for size at exactly the 64 KiB bound (only past it)", async () => {
    const exactly64KiB = new Uint8Array(65_536).fill(0x78);
    const log: string[] = [];
    const dependencies = createFakeDependencies({ chunks: chunksOf(exactly64KiB, 4096) }, log);

    let message = "";
    try {
      await readOfflineReleaseTrustFd(3, dependencies);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toContain("64 KiB bound");
  });

  it("refuses a payload that is not canonical JSON", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ chunks: [new TextEncoder().encode("not json\n")] }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("refuses a structurally invalid trust document", async () => {
    const log: string[] = [];
    const bytes = new TextEncoder().encode(encodeCanonicalJson({ schemaVersion: 1 }));
    const dependencies = createFakeDependencies({ chunks: [bytes] }, log);

    await expect(readOfflineReleaseTrustFd(3, dependencies)).rejects.toThrow(SecurityRefusalError);
    expect(log.at(-1)).toBe("close:3");
  });

  it("closes the descriptor exactly once even when close is the only thing that can run after a refusal", async () => {
    const log: string[] = [];
    const dependencies = createFakeDependencies({ isFIFO: false }, log);

    await readOfflineReleaseTrustFd(3, dependencies).catch(() => undefined);

    expect(log.filter((entry) => entry === "close:3")).toHaveLength(1);
  });
});
