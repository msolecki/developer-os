import { validateOfflineReleaseTrust, validateReleaseKeyDelegation } from "@developer-os/core";
import type {
  DelegatedReleaseKeyV1,
  OfficialReleaseAssetOriginV1,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
  SignedReleaseDocumentV1,
} from "@developer-os/core";
import { SecurityRefusalError, renderOfflineReleaseTrustPipe, verifySignedReleaseDocument } from "@developer-os/security";

import type { LauncherRetainedDocumentVerifierV1 } from "./selection.js";

const DELEGATION_KIND = "release-key-delegation" as const;
const INDEX_KIND = "release-index" as const;

/**
 * The two fixed metadata locators Spec 2 already pins (`origin`,
 * `repositoryPath`, and `assetName` are literal types in
 * `FixedReleaseMetadataLocatorV1`) -- not a founder decision, so compiling
 * them here is not guessing anything.
 */
const DELEGATION_LOCATOR = {
  origin: "https://github.com",
  repositoryPath: "/msolecki/developer-os/releases/latest/download/",
  assetName: "release-key-delegation-v1.json",
} as const;
const INDEX_LOCATOR = {
  origin: "https://github.com",
  repositoryPath: "/msolecki/developer-os/releases/latest/download/",
  assetName: "release-index-v1.json",
} as const;

export interface LauncherOfflineTrustInputV1 {
  /**
   * The founder's accepted offline root(s). Empty until that decision is
   * made (Task 11b's territory) -- never guessed or hardcoded here.
   */
  readonly acceptedRoots: readonly OfflineRootKeyV1[];
  readonly metadataRedirectOrigins: readonly OfficialReleaseAssetOriginV1[];
}

/**
 * Compiles the launcher's offline-trust document from its genuinely fixed
 * parts (schema, both locators) plus the caller-supplied roots and redirect
 * origins. Returns `null` -- "no trust configured yet" -- when no root key
 * has been decided, or none of the supplied roots is the current online
 * root `validateOfflineReleaseTrust` requires; callers must not open the
 * FD 3 pipe in that case, which is exactly today's `unavailable_until_packaged_handoff`
 * fallback and not a regression.
 */
export function compileLauncherOfflineReleaseTrust(
  input: LauncherOfflineTrustInputV1,
): OfflineReleaseTrustV1 | null {
  const onlineRoot = input.acceptedRoots.find((root) => root.role === "online_current");
  if (onlineRoot === undefined) return null;
  try {
    return validateOfflineReleaseTrust({
      schemaVersion: 1,
      handoffProtocol: 1,
      onlineRootKeyId: onlineRoot.keyId,
      acceptedRoots: input.acceptedRoots,
      delegationLocator: DELEGATION_LOCATOR,
      indexLocator: INDEX_LOCATOR,
      metadataRedirectOrigins: input.metadataRedirectOrigins,
    });
  } catch {
    return null;
  }
}

/**
 * Real Ed25519 verification for Task 10's injected
 * `LauncherRetainedDocumentVerifierV1` port (`./selection.ts`), matching its
 * existing shape exactly rather than declaring a new one. Retained
 * documents are already hash-pinned to the launcher's trust watermark
 * before this runs, so both the current and the retained-previous root are
 * accepted for the delegation (Spec 2 §3.1's guarded/retained admission,
 * never the online-only path). Stateful: `selection.ts`'s
 * `admitActiveRelease` always calls this for the delegation document before
 * the release-index document, so the verified delegation's release key is
 * captured and required for the index call that follows.
 */
export function createLauncherRetainedDocumentVerifier(
  roots: readonly OfflineRootKeyV1[],
): LauncherRetainedDocumentVerifierV1 {
  let delegatedReleaseKey: DelegatedReleaseKeyV1 | null = null;

  return (document) => {
    if (document.kind === DELEGATION_KIND) {
      delegatedReleaseKey = null;
      const delegationDocument = document as unknown as SignedReleaseDocumentV1<typeof DELEGATION_KIND, unknown>;
      let refusal: unknown;
      for (const root of roots) {
        try {
          const delegation = validateReleaseKeyDelegation(verifySignedReleaseDocument(delegationDocument, root));
          delegatedReleaseKey = delegation.releaseKey;
          return;
        } catch (error) {
          refusal = error;
        }
      }
      throw refusal instanceof Error ? refusal : new SecurityRefusalError("Release key delegation is not signed by an accepted root");
    }

    if (document.kind === INDEX_KIND) {
      if (delegatedReleaseKey === null) {
        throw new SecurityRefusalError("Release index verified before an accepted delegation");
      }
      const indexDocument = document as unknown as SignedReleaseDocumentV1<typeof INDEX_KIND, unknown>;
      verifySignedReleaseDocument(indexDocument, delegatedReleaseKey);
      return;
    }

    throw new SecurityRefusalError(`Unknown retained release document kind: ${document.kind}`);
  };
}

/**
 * The launcher's actual FD 3 write: canonical JSON plus one LF, written
 * whole to a fresh pipe (`spawn(..., { stdio: [..., 'pipe'] })`'s fd-3
 * write end in the parent), then the write side closed -- `end()` is
 * exactly "closes its write side".
 */
export async function writeOfflineReleaseTrustHandoff(
  pipe: NodeJS.WritableStream,
  trust: OfflineReleaseTrustV1,
): Promise<void> {
  const bytes = renderOfflineReleaseTrustPipe(trust);
  await new Promise<void>((resolve, reject) => {
    pipe.once("error", reject);
    pipe.end(bytes, () => {
      resolve();
    });
  });
}
