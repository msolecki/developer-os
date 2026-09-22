import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";

import {
  signedReleaseDocumentSigningBytes,
  validateOfflineReleaseTrust,
  validateReleaseIndex,
  validateReleaseKeyDelegation,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  DelegatedReleaseKeyV1,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
  ReleaseIndexV1,
  ReleaseKeyDelegationV1,
  SignedReleaseDocumentV1,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";

const DELEGATION_KIND = "release-key-delegation";
const INDEX_KIND = "release-index";

export type ReleaseKeyDelegationDocumentV1 = SignedReleaseDocumentV1<typeof DELEGATION_KIND, unknown>;
export type ReleaseIndexDocumentV1 = SignedReleaseDocumentV1<typeof INDEX_KIND, unknown>;

function decodeBase64UrlExact(value: string, expectedLength: number, label: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SecurityRefusalError(`${label} is not base64url without padding`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== expectedLength || decoded.toString("base64url") !== value) {
    throw new SecurityRefusalError(`${label} must decode to exactly ${String(expectedLength)} bytes`);
  }
  return decoded;
}

/**
 * Verifies one signed release document's Ed25519 signature over the exact
 * domain-separated canonical bytes (`developer-os/<kind>/v1\0` plus the
 * no-trailing-LF canonical encoding of `signed`) and returns `signed` only
 * once the signature is confirmed. The key is always an injected parameter
 * -- an accepted offline root or a delegated release key -- this function
 * never carries or guesses a production key of its own.
 */
export function verifySignedReleaseDocument<TKind extends string, TSigned>(
  document: SignedReleaseDocumentV1<TKind, TSigned>,
  key: OfflineRootKeyV1 | DelegatedReleaseKeyV1,
): TSigned {
  // `document` and `key` are already typed to satisfy these invariants, but
  // this function is a trust boundary: a caller that force-cast an
  // unvalidated value can still violate them at runtime, so each check
  // reads through an `unknown` view rather than trusting the static type.
  if ((document.schemaVersion as unknown) !== 1) {
    throw new SecurityRefusalError("Signed release document schema version mismatch");
  }
  if ((key.algorithm as unknown) !== "ed25519") {
    throw new SecurityRefusalError("Offline trust key algorithm mismatch");
  }
  if ((document.signatures.length as unknown) !== 1) {
    throw new SecurityRefusalError("Signed release document must carry exactly one signature");
  }
  const [signature] = document.signatures;
  if ((signature.algorithm as unknown) !== "ed25519") {
    throw new SecurityRefusalError("Signature algorithm mismatch");
  }

  const publicKeyBytes = decodeBase64UrlExact(key.publicKey, 32, "Offline trust public key");
  if (createHash("sha256").update(publicKeyBytes).digest("hex") !== key.keyId) {
    throw new SecurityRefusalError("Offline trust key id does not match its raw public key");
  }
  if (signature.keyId !== key.keyId) {
    throw new SecurityRefusalError("Signature key id does not match the trusted key");
  }
  const signatureBytes = decodeBase64UrlExact(signature.signature, 64, "Ed25519 signature");

  let signingBytes: Uint8Array;
  try {
    signingBytes = signedReleaseDocumentSigningBytes(document.kind, document.signed as unknown as CanonicalJsonValue);
  } catch (error) {
    throw new SecurityRefusalError(
      `Signed release document is not canonical JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const publicKey = createPublicKey({ format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: key.publicKey } });
  let valid: boolean;
  try {
    valid = verifyEd25519(null, signingBytes, publicKey, signatureBytes);
  } catch {
    throw new SecurityRefusalError("Ed25519 signature verification failed");
  }
  if (!valid) {
    throw new SecurityRefusalError("Ed25519 signature is invalid");
  }

  return document.signed;
}

export interface ReleaseMetadataChainRequestV1 {
  readonly trust: OfflineReleaseTrustV1;
  /**
   * `online_target` accepts only the current online root -- the freshly
   * fetched `update` path. `guarded_retained` also accepts the retained
   * previous root, for metadata already pinned on disk by content hash
   * (Spec 2 §3.1's launcher/rollback admission).
   */
  readonly role: "online_target" | "guarded_retained";
  readonly delegation: ReleaseKeyDelegationDocumentV1;
  readonly index: ReleaseIndexDocumentV1;
}

export interface ReleaseMetadataChainV1 {
  readonly rootKeyId: LowerHexSha256;
  readonly delegation: ReleaseKeyDelegationV1;
  readonly index: ReleaseIndexV1;
}

/**
 * Verifies the full offline root -> delegation -> release-index signature
 * chain in one call: the delegation document against an accepted root (only
 * the current root on the online path; current or retained-previous on the
 * guarded/retained path), then the release index against the release key
 * that delegation names. Refuses with `SecurityRefusalError` at the first
 * broken link.
 */
export function verifyReleaseMetadataChain(request: ReleaseMetadataChainRequestV1): ReleaseMetadataChainV1 {
  const trust = validateOfflineReleaseTrust(request.trust);
  // Same trust-boundary reasoning as `verifySignedReleaseDocument` above:
  // `kind` is typed as a literal here, but a force-cast caller can still
  // hand this a document of the wrong kind.
  if ((request.delegation.kind as unknown) !== DELEGATION_KIND) {
    throw new SecurityRefusalError("Expected a release key delegation document");
  }
  if ((request.index.kind as unknown) !== INDEX_KIND) {
    throw new SecurityRefusalError("Expected a release index document");
  }

  const candidateRoots =
    request.role === "online_target"
      ? trust.acceptedRoots.filter((root) => root.role === "online_current")
      : trust.acceptedRoots;

  let matchedRoot: OfflineRootKeyV1 | null = null;
  let delegation: ReleaseKeyDelegationV1 | null = null;
  for (const root of candidateRoots) {
    try {
      delegation = validateReleaseKeyDelegation(verifySignedReleaseDocument(request.delegation, root));
      matchedRoot = root;
      break;
    } catch {
      continue;
    }
  }
  if (matchedRoot === null || delegation === null) {
    throw new SecurityRefusalError("Release key delegation is not signed by an accepted root");
  }

  const index = validateReleaseIndex(verifySignedReleaseDocument(request.index, delegation.releaseKey));

  return { rootKeyId: matchedRoot.keyId, delegation, index };
}
