import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, encodeLifecycleIdAllocator, serializeConfig } from "@developer-os/core";
import type { CanonicalJsonValue, LifecycleInstallNonceV1, ManagedArtifactSchemaIdV1 } from "@developer-os/core";

import { createManagedArtifactEphemeralRegistry, createManagedArtifactSchemaRegistry } from "./schema-registry.js";

const encoder = new TextEncoder();
const NONCE = "a".repeat(64) as LifecycleInstallNonceV1;
const HASH = "b".repeat(64);

function json(value: Record<string, unknown>): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

const TRUST = {
  schemaVersion: 1,
  highestDelegationSequence: "1",
  delegationHash: HASH,
  delegatedReleaseKeyId: HASH,
  highestReleaseIndexSequence: "1",
  releaseIndexHash: HASH,
  highestAcceptedReleaseSequence: "1",
  releaseIdentityHash: HASH,
};

/** A path with no existing ancestor, so canonical-path evidence returns it unchanged. */
const BUNDLE_ROOT = "/developer-os-schema-registry-test/releases/1.0.0/darwin-arm64";

const VALID: Readonly<Record<ManagedArtifactSchemaIdV1, Uint8Array>> = {
  "developer-os-config-v1": encoder.encode(serializeConfig({
    schemaVersion: 1,
    brainPath: "/developer-os-schema-registry-test/brain",
    adapters: { claude: true, codex: false },
    git: { enabled: false },
    automation: { enabled: false },
    telemetry: false,
  })),
  "lifecycle-id-allocator-v1": encoder.encode(encodeLifecycleIdAllocator({ schemaVersion: 1, installNonce: NONCE, nextCounter: "1" } as never)),
  "active-release-record-v1": json({
    schemaVersion: 1,
    version: "1.0.0",
    releaseSequence: "1",
    releaseIdentityHash: HASH,
    delegationSequence: "1",
    delegationHash: HASH,
    releaseIndexSequence: "1",
    releaseIndexHash: HASH,
    bundleManifestHash: HASH,
    bundleRoot: BUNDLE_ROOT,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
    activatedAt: "2026-09-22T12:00:00.000Z",
  }),
  "release-trust-state-v1": json(TRUST),
  "codex-registration-v1": json({ codexHome: "/developer-os-schema-registry-test/.codex", treeHash: HASH }),
};

const SCHEMA_IDS = Object.keys(VALID) as ManagedArtifactSchemaIdV1[];

describe("createManagedArtifactSchemaRegistry", () => {
  const registry = createManagedArtifactSchemaRegistry(NONCE);

  it("covers every ManagedArtifactSchemaIdV1", () => {
    expect(SCHEMA_IDS.length).toBeGreaterThan(0);
    expect([...SCHEMA_IDS].sort()).toStrictEqual([
      "active-release-record-v1",
      "codex-registration-v1",
      "developer-os-config-v1",
      "lifecycle-id-allocator-v1",
      "release-trust-state-v1",
    ]);
  });

  it.each(SCHEMA_IDS)("admits a valid %s document", (schemaId) => {
    expect(() => { registry.validate(schemaId, VALID[schemaId]); }).not.toThrow();
  });

  it.each(SCHEMA_IDS)("refuses a malformed %s document", (schemaId) => {
    expect(() => { registry.validate(schemaId, encoder.encode("{\"unexpected\":true}")); }).toThrow();
  });

  it("admits both release-trust arms and refuses any other trust value", () => {
    expect(() => { registry.validate("release-trust-state-v1", json({ ...TRUST, trust: "unsigned-local" })); }).not.toThrow();
    expect(() => { registry.validate("release-trust-state-v1", json({ ...TRUST, trust: "signed" })); }).toThrow();
  });

  it("binds the allocator to the install nonce", () => {
    expect(() => { createManagedArtifactSchemaRegistry("c".repeat(64) as LifecycleInstallNonceV1).validate("lifecycle-id-allocator-v1", VALID["lifecycle-id-allocator-v1"]); }).toThrow();
    expect(() => { createManagedArtifactSchemaRegistry(null).validate("lifecycle-id-allocator-v1", VALID["lifecycle-id-allocator-v1"]); }).toThrow();
  });

  it("refuses a schema id outside the closed set", () => {
    expect(() => { registry.validate("unknown-v1" as ManagedArtifactSchemaIdV1, VALID["codex-registration-v1"]); }).toThrow();
  });
});

describe("createManagedArtifactEphemeralRegistry", () => {
  const path = "/developer-os-schema-registry-test/state/reservation" as never;

  it("admits only a core reservation owned by the effective uid with mode 0600 and one link", () => {
    const registry = createManagedArtifactEphemeralRegistry(501);
    expect(() => { registry.validate("core", { path, uid: 501, mode: 0o600, nlink: 1 }); }).not.toThrow();
    expect(() => { registry.validate("claude", { path, uid: 501, mode: 0o600, nlink: 1 }); }).toThrow();
    expect(() => { registry.validate("core", { path, uid: 502, mode: 0o600, nlink: 1 }); }).toThrow();
    expect(() => { registry.validate("core", { path, uid: 501, mode: 0o644, nlink: 1 }); }).toThrow();
    expect(() => { registry.validate("core", { path, uid: 501, mode: 0o600, nlink: 2 }); }).toThrow();
  });
});
