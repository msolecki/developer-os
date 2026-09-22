import { createHash, generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";

import {
  signedReleaseDocumentSigningBytes,
  validateOfficialReleaseOrigin,
  validateReleaseIndex,
  validateReleaseKeyDelegation,
} from "@developer-os/core";
import type {
  Base64UrlNoPaddingV1,
  DelegatedReleaseKeyV1,
  Ed25519SignatureV1,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
  ReleaseIndexV1,
  ReleaseKeyDelegationV1,
  SignedReleaseDocumentV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import {
  verifyReleaseMetadataChain,
  verifySignedReleaseDocument,
  type ReleaseIndexDocumentV1,
  type ReleaseKeyDelegationDocumentV1,
} from "./signatures.js";

function rawPublicKey(key: KeyObject): Base64UrlNoPaddingV1 {
  const jwk = key.export({ format: "jwk" }) as { readonly x: string };
  return jwk.x as Base64UrlNoPaddingV1;
}

function keyIdOf(publicKey: Base64UrlNoPaddingV1): LowerHexSha256 {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("hex") as LowerHexSha256;
}

interface SyntheticRoot {
  readonly root: OfflineRootKeyV1;
  readonly privateKey: KeyObject;
}

function generateRoot(role: "online_current" | "retained_offline_previous"): SyntheticRoot {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const encodedKey = rawPublicKey(publicKey);
  return {
    root: { role, algorithm: "ed25519", keyId: keyIdOf(encodedKey), publicKey: encodedKey },
    privateKey,
  };
}

interface SyntheticDelegatedKey {
  readonly releaseKey: DelegatedReleaseKeyV1;
  readonly privateKey: KeyObject;
}

function generateDelegatedKey(): SyntheticDelegatedKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const encodedKey = rawPublicKey(publicKey);
  return {
    releaseKey: { algorithm: "ed25519", keyId: keyIdOf(encodedKey), publicKey: encodedKey },
    privateKey,
  };
}

function sign<TKind extends string, TSigned>(
  kind: TKind,
  signed: TSigned,
  keyId: LowerHexSha256,
  privateKey: KeyObject,
): SignedReleaseDocumentV1<TKind, TSigned> {
  const bytes = signedReleaseDocumentSigningBytes(kind, signed as never);
  const signature = signEd25519(null, bytes, privateKey).toString("base64url") as Base64UrlNoPaddingV1;
  return {
    schemaVersion: 1,
    kind,
    signed,
    signatures: [{ algorithm: "ed25519", keyId, signature }],
  };
}

const origin = validateOfficialReleaseOrigin({
  scheme: "https",
  host: "github.com",
  port: 443,
  pathPrefix: "/msolecki/developer-os/releases/latest/download/",
});
const delegationLocator = {
  origin: "https://github.com",
  repositoryPath: "/msolecki/developer-os/releases/latest/download/",
  assetName: "release-key-delegation-v1.json",
} as const;
const indexLocator = {
  origin: "https://github.com",
  repositoryPath: "/msolecki/developer-os/releases/latest/download/",
  assetName: "release-index-v1.json",
} as const;

function makeDelegation(sequence: string, releaseKey: DelegatedReleaseKeyV1): ReleaseKeyDelegationV1 {
  return validateReleaseKeyDelegation({
    sequence,
    releaseKey,
    metadataOrigins: [origin],
    assetOrigins: [origin],
  });
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

function trustOf(roots: readonly OfflineRootKeyV1[]): OfflineReleaseTrustV1 {
  const online = roots.find((candidate) => candidate.role === "online_current");
  if (online === undefined) throw new Error("test fixture requires an online_current root");
  return {
    schemaVersion: 1,
    handoffProtocol: 1,
    onlineRootKeyId: online.keyId,
    acceptedRoots: roots,
    delegationLocator,
    indexLocator,
    metadataRedirectOrigins: [origin],
  };
}

describe("verifySignedReleaseDocument", () => {
  it("verifies the exact domain-separated Ed25519 bytes", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);

    expect(verifySignedReleaseDocument(document, current.root)).toEqual(delegation);
  });

  it("returns the exact signed index payload for a delegated key signature", () => {
    const delegated = generateDelegatedKey();
    const index = makeIndex();
    const document = sign("release-index", index, delegated.releaseKey.keyId, delegated.privateKey);

    expect(verifySignedReleaseDocument(document, delegated.releaseKey)).toEqual(index);
  });

  it("refuses a schema version other than 1", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);

    expect(() =>
      verifySignedReleaseDocument({ ...document, schemaVersion: 2 as 1 }, current.root),
    ).toThrow(SecurityRefusalError);
  });

  it("refuses more than one signature", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const duplicated = {
      ...document,
      signatures: [document.signatures[0], document.signatures[0]] as unknown as readonly [Ed25519SignatureV1],
    };

    expect(() => verifySignedReleaseDocument(duplicated, current.root)).toThrow(SecurityRefusalError);
  });

  it("refuses a public key that is not exactly 32 bytes", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const shortKey = Buffer.alloc(16, 7).toString("base64url") as Base64UrlNoPaddingV1;

    expect(() =>
      verifySignedReleaseDocument(document, { ...current.root, publicKey: shortKey, keyId: keyIdOf(shortKey) }),
    ).toThrow(SecurityRefusalError);
  });

  it("refuses a signature that is not exactly 64 bytes", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const shortSignature = Buffer.alloc(32, 9).toString("base64url") as Base64UrlNoPaddingV1;
    const tampered = {
      ...document,
      signatures: [{ ...document.signatures[0], signature: shortSignature }] as const,
    };

    expect(() => verifySignedReleaseDocument(tampered, current.root)).toThrow(SecurityRefusalError);
  });

  it("refuses base64 with padding instead of base64url without padding", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const paddedSignature = `${document.signatures[0].signature}==` as Base64UrlNoPaddingV1;
    const tampered = {
      ...document,
      signatures: [{ ...document.signatures[0], signature: paddedSignature }] as const,
    };

    expect(() => verifySignedReleaseDocument(tampered, current.root)).toThrow(SecurityRefusalError);
  });

  it("refuses a key-ID that does not match its raw public key", () => {
    const current = generateRoot("online_current");
    const other = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);

    expect(() =>
      verifySignedReleaseDocument(document, { ...current.root, keyId: other.root.keyId }),
    ).toThrow(SecurityRefusalError);
  });

  it("refuses a signature key-ID that does not match the trusted key", () => {
    const current = generateRoot("online_current");
    const other = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, other.root.keyId, other.privateKey);

    expect(() => verifySignedReleaseDocument(document, current.root)).toThrow(SecurityRefusalError);
  });

  it("refuses a document signed for a different kind (domain separation)", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const relabeled = { ...document, kind: "release-index" as const };

    expect(() => verifySignedReleaseDocument(relabeled, current.root)).toThrow(SecurityRefusalError);
  });

  it("refuses tampered signed content (canonical bytes changed)", () => {
    const current = generateRoot("online_current");
    const delegated = generateDelegatedKey();
    const delegation = makeDelegation("1", delegated.releaseKey);
    const document = sign("release-key-delegation", delegation, current.root.keyId, current.privateKey);
    const tampered = { ...document, signed: { ...document.signed, sequence: "2" } };

    expect(() => verifySignedReleaseDocument(tampered, current.root)).toThrow(SecurityRefusalError);
  });
});

describe("verifyReleaseMetadataChain", () => {
  function buildChain(): {
    readonly currentRoot: SyntheticRoot;
    readonly previousRoot: SyntheticRoot;
    readonly delegated: SyntheticDelegatedKey;
    readonly delegation: ReleaseKeyDelegationDocumentV1;
    readonly delegationSignedByPrevious: ReleaseKeyDelegationDocumentV1;
    readonly index: ReleaseIndexDocumentV1;
    readonly trust: OfflineReleaseTrustV1;
  } {
    const currentRoot = generateRoot("online_current");
    const previousRoot = generateRoot("retained_offline_previous");
    const delegated = generateDelegatedKey();
    const delegationSigned = makeDelegation("1", delegated.releaseKey);
    const delegation = sign(
      "release-key-delegation",
      delegationSigned,
      currentRoot.root.keyId,
      currentRoot.privateKey,
    );
    const delegationSignedByPrevious = sign(
      "release-key-delegation",
      delegationSigned,
      previousRoot.root.keyId,
      previousRoot.privateKey,
    );
    const index = sign("release-index", makeIndex(), delegated.releaseKey.keyId, delegated.privateKey);
    const trust = trustOf([currentRoot.root, previousRoot.root]);
    return { currentRoot, previousRoot, delegated, delegation, delegationSignedByPrevious, index, trust };
  }

  it("verifies a current-root online delegation and its delegated index", () => {
    const vector = buildChain();
    const result = verifyReleaseMetadataChain({
      trust: vector.trust,
      role: "online_target",
      delegation: vector.delegation,
      index: vector.index,
    });

    expect(result.rootKeyId).toBe(vector.currentRoot.root.keyId);
    expect(result.delegation.releaseKey).toEqual(vector.delegated.releaseKey);
  });

  it("verifies retained metadata signed by the retained previous root", () => {
    const vector = buildChain();
    const result = verifyReleaseMetadataChain({
      trust: vector.trust,
      role: "guarded_retained",
      delegation: vector.delegationSignedByPrevious,
      index: vector.index,
    });

    expect(result.rootKeyId).toBe(vector.previousRoot.root.keyId);
  });

  it("refuses a previous-root delegation on the online path", () => {
    const vector = buildChain();

    expect(() =>
      verifyReleaseMetadataChain({
        trust: vector.trust,
        role: "online_target",
        delegation: vector.delegationSignedByPrevious,
        index: vector.index,
      }),
    ).toThrow(SecurityRefusalError);
  });

  const signatureMutations = [
    {
      name: "a delegation signed by an untrusted key",
      chain: () => {
        const vector = buildChain();
        const rogue = generateRoot("online_current");
        return {
          trust: vector.trust,
          role: "guarded_retained" as const,
          delegation: sign("release-key-delegation", makeDelegation("1", vector.delegated.releaseKey), rogue.root.keyId, rogue.privateKey),
          index: vector.index,
        };
      },
    },
    {
      name: "an index signed by an unrelated key",
      chain: () => {
        const vector = buildChain();
        const rogue = generateDelegatedKey();
        return {
          trust: vector.trust,
          role: "guarded_retained" as const,
          delegation: vector.delegation,
          index: sign("release-index", makeIndex(), rogue.releaseKey.keyId, rogue.privateKey),
        };
      },
    },
    {
      name: "a delegation document mislabeled as an index",
      chain: () => {
        const vector = buildChain();
        return {
          trust: vector.trust,
          role: "guarded_retained" as const,
          delegation: { ...vector.index, kind: "release-key-delegation" as const } as unknown as ReleaseKeyDelegationDocumentV1,
          index: vector.index,
        };
      },
    },
    {
      name: "an index document mislabeled as a delegation",
      chain: () => {
        const vector = buildChain();
        return {
          trust: vector.trust,
          role: "guarded_retained" as const,
          delegation: vector.delegation,
          index: { ...vector.delegation, kind: "release-index" as const } as unknown as ReleaseIndexDocumentV1,
        };
      },
    },
  ];

  it.each(signatureMutations)("refuses $name", (mutation) => {
    expect(() => verifyReleaseMetadataChain(mutation.chain())).toThrow(SecurityRefusalError);
  });
});
