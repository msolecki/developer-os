import { spawn } from "node:child_process";
import { constants } from "node:os";

import { validateOfflineReleaseTrust, validateReleaseIndex, validateReleaseKeyDelegation } from "@developer-os/core";
import type {
  OfficialReleaseAssetOriginV1,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
  ReleaseKeyDelegationV1,
  SignedReleaseDocumentV1,
} from "@developer-os/core";
import { SecurityRefusalError, renderOfflineReleaseTrustPipe, verifySignedReleaseDocument } from "@developer-os/security";

import type { LauncherProcessRequestV1, LauncherRetainedDocumentVerifierV1 } from "./selection.js";

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
 * Real Ed25519 verification for the injected `LauncherRetainedDocumentVerifierV1`
 * port (`./selection.ts`). Each document is verified as the kind its store slot
 * holds, never as the kind it claims: the delegation against an accepted root
 * (current or retained previous -- retained documents are already hash-pinned,
 * Spec 2 §3.1), then the index against the key that delegation names. Returns
 * the validated chain for the caller to bind to the release it launches.
 */
export function createLauncherRetainedDocumentVerifier(
  roots: readonly OfflineRootKeyV1[],
): LauncherRetainedDocumentVerifierV1 {
  return ({ delegation, index }) => {
    if (delegation.kind !== DELEGATION_KIND) throw new SecurityRefusalError("Expected a release key delegation document");
    if (index.kind !== INDEX_KIND) throw new SecurityRefusalError("Expected a release index document");
    let verified: ReleaseKeyDelegationV1 | null = null;
    for (const root of roots) {
      try {
        verified = validateReleaseKeyDelegation(
          verifySignedReleaseDocument(delegation as unknown as SignedReleaseDocumentV1<typeof DELEGATION_KIND, unknown>, root),
        );
        break;
      } catch {
        continue;
      }
    }
    if (verified === null) throw new SecurityRefusalError("Release key delegation is not signed by an accepted root");
    const indexDocument = index as unknown as SignedReleaseDocumentV1<typeof INDEX_KIND, unknown>;
    return { delegation: verified, index: validateReleaseIndex(verifySignedReleaseDocument(indexDocument, verified.releaseKey)) };
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

/**
 * Execs the admitted release with a real anonymous pipe at FD 3 when trust
 * is configured, or without one otherwise — Task 11b's documented "absent"
 * fallback. `execFileSync` cannot hand a child a real pipe descriptor, so
 * this uses `spawn`'s extra `stdio` slot: the launcher writes the rendered
 * trust bytes into its own write end and ends the stream (closing it)
 * before the child is expected to have read past EOF, then waits for the
 * child's own exit status, which the caller mirrors as its own: the child's
 * code, or 128 plus the number of the signal that killed it, as a shell does.
 */
export async function execAdmittedRelease(
  request: LauncherProcessRequestV1,
  trust: OfflineReleaseTrustV1 | null,
): Promise<number> {
  const child = spawn(request.executable, [...request.argv], {
    env: { ...request.env },
    stdio: trust === null ? ["inherit", "inherit", "inherit"] : ["inherit", "inherit", "inherit", "pipe"],
  });

  // Listeners attach immediately, before the FD 3 write below is ever
  // awaited: an `error` event with no listener throws and crashes this
  // process, and a child that exits early while the write is still pending
  // (a full pipe buffer with nothing draining it) must still be observable
  // rather than leaving the write's `await` stuck forever.
  const exit = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    },
  );

  if (trust !== null) {
    const pipe = child.stdio[3];
    if (pipe === null) {
      throw new Error("developer-os-launcher: failed to open the offline-trust pipe");
    }
    await writeOfflineReleaseTrustHandoff(pipe as NodeJS.WritableStream, trust);
  }

  const { code, signal } = await exit;
  return code ?? (signal === null ? 1 : 128 + constants.signals[signal]);
}
