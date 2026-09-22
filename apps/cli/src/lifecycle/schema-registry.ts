import {
  decodeCanonicalJson,
  loadConfig,
  parseLifecycleIdAllocator,
  validateActiveReleaseRecord,
  validateReleaseTrustState,
} from "@developer-os/core";
import type {
  LifecycleInstallNonceV1,
  ManagedArtifactEphemeralRegistryV1,
  ManagedArtifactSchemaIdV1,
  ManagedArtifactSchemaRegistry,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { validateCodexRegistrationRecord } from "../instructions/codex-registration.js";

const MAX_RELEASE_RECORD_BYTES = 16 * 1024;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Every `ManagedArtifactSchemaIdV1`. The allocator is bound to the install nonce
 * (`parseLifecycleIdAllocator`), so the nonce is a parameter; `null` fails the
 * allocator row rather than skipping it.
 */
export function createManagedArtifactSchemaRegistry(
  installNonce: LifecycleInstallNonceV1 | null,
): ManagedArtifactSchemaRegistry {
  return {
    validate(schemaId: ManagedArtifactSchemaIdV1, bytes: Uint8Array): void {
      switch (schemaId) {
        case "developer-os-config-v1":
          loadConfig(strictUtf8.decode(bytes));
          return;
        case "lifecycle-id-allocator-v1":
          if (installNonce === null) throw new Error("no lifecycle install nonce to bind the allocator to");
          parseLifecycleIdAllocator(bytes, installNonce);
          return;
        case "active-release-record-v1":
          validateActiveReleaseRecord(decodeCanonicalJson(bytes, MAX_RELEASE_RECORD_BYTES), createCanonicalPathEvidence());
          return;
        case "release-trust-state-v1":
          validateReleaseTrustState(decodeCanonicalJson(bytes, MAX_RELEASE_RECORD_BYTES));
          return;
        case "codex-registration-v1":
          validateCodexRegistrationRecord(bytes);
          return;
        default:
          throw new Error(`unknown managed artifact schema ${String(schemaId satisfies never)}`);
      }
    },
  };
}

/** Core's runtime reservations: owned by the effective uid, `0600`, one link. */
export function createManagedArtifactEphemeralRegistry(effectiveUid: number): ManagedArtifactEphemeralRegistryV1 {
  return {
    validate(owner, observed): void {
      if (owner !== "core" || observed.uid !== effectiveUid || observed.mode !== 0o600 || observed.nlink !== 1) {
        throw new Error("runtime reservation changed shape");
      }
    },
  };
}
