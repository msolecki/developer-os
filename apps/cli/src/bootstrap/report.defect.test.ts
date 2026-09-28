import { afterEach, describe, expect, it, vi } from "vitest";

import type * as core from "@developer-os/core";
import { EXIT_CODES } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import type { BootstrapEvidenceGuardedEntryV1 } from "./report.js";
import { assertOrdinaryCommandAdmitted, isStructurallyValidV2Manifest } from "./report.js";

const defect = vi.hoisted(() => ({ active: false }));

vi.mock("@developer-os/core", async (importOriginal) => {
  const actual = await importOriginal<typeof core>();
  return {
    ...actual,
    validateManifestBytes: (...args: Parameters<typeof actual.validateManifestBytes>) => {
      if (defect.active) throw new TypeError("synthetic");
      return actual.validateManifestBytes(...args);
    },
  };
});

afterEach(() => { defect.active = false; });

const HOME = "/developer-os-synthetic-defect";
const MANIFEST = `${HOME}/installation-manifest.json`;
const schemaTwoBytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 2 })}\n`);

function requestWithManifest(bytes: Uint8Array) {
  const entry: BootstrapEvidenceGuardedEntryV1 = {
    path: MANIFEST as CanonicalAbsolutePathV1,
    kind: "regular_file",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    bytes: String(bytes.byteLength) as UInt64DecimalV1,
    dev: "1" as UInt64DecimalV1,
    ino: "2" as UInt64DecimalV1,
  };
  return createBootstrapEvidenceInspectionRequest({
    productHome: HOME,
    stateDirectory: `${HOME}/state`,
    initialRoots: [],
    reader: {
      inventoryExactNamespaces: (roots) => Promise.resolve(roots.includes(entry.path) ? [entry] : []),
      readRegularFile: () => Promise.resolve(bytes),
    },
    listNames: () => Promise.resolve([]),
  });
}

describe("V2 manifest routing lets a validator defect escape (NEW-92)", () => {
  it("isStructurallyValidV2Manifest still reads a malformed V2 manifest as invalid", () => {
    expect(isStructurallyValidV2Manifest(schemaTwoBytes, HOME)).toBe(false);
  });

  it("isStructurallyValidV2Manifest rethrows a defect instead of reporting the manifest invalid", () => {
    defect.active = true;
    expect(() => isStructurallyValidV2Manifest(schemaTwoBytes, HOME)).toThrow(TypeError);
  });

  it("assertOrdinaryCommandAdmitted refuses a malformed V2 manifest with recovery-required", async () => {
    await expect(assertOrdinaryCommandAdmitted(requestWithManifest(schemaTwoBytes))).rejects.toMatchObject({
      name: "BootstrapRecoveryRequiredError",
      code: EXIT_CODES.recoveryRequired,
    });
  });

  it("assertOrdinaryCommandAdmitted lets a validator defect escape rather than telling a healthy home to recover", async () => {
    defect.active = true;
    await expect(assertOrdinaryCommandAdmitted(requestWithManifest(schemaTwoBytes))).rejects.toBeInstanceOf(TypeError);
  });
});
