import { afterEach, describe, expect, it, vi } from "vitest";

import type * as core from "@developer-os/core";
import { EXIT_CODES, encodeCanonicalJson, hashBytes } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import type { BootstrapEvidenceGuardedEntryV1 } from "./report.js";
import { assertOrdinaryCommandAdmitted, bootstrapArchiveRecovery, isStructurallyValidV2Manifest } from "./report.js";

const defect = vi.hoisted(() => ({ active: false, valid: false }));

vi.mock("@developer-os/core", async (importOriginal) => {
  const actual = await importOriginal<typeof core>();
  return {
    ...actual,
    validateManifestBytes: (...args: Parameters<typeof actual.validateManifestBytes>) => {
      if (defect.active) throw new TypeError("synthetic");
      if (defect.valid) return { schemaVersion: 2 } as ReturnType<typeof actual.validateManifestBytes>;
      return actual.validateManifestBytes(...args);
    },
  };
});

afterEach(() => { defect.active = false; defect.valid = false; });

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

describe("the ordinary-command gate lets a code defect escape (NEW-179 C-5)", () => {
  const ID = "fi_00000000-0000-4000-8000-000000000000";
  const PLAN = `${HOME}/state/fresh-v2-init.${ID}.plan.json`;
  const SLOTS = [0, 1].map((slot) => `${HOME}/state/fresh-v2-init.${ID}.journal.${String(slot)}.json`);
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 2, synthetic: true })}\n`);
  const planBytes = new TextEncoder().encode(encodeCanonicalJson({ manifest: { after: { hash: hashBytes(manifestBytes) } } }));

  function entry(path: string, bytes: number, ino: string): BootstrapEvidenceGuardedEntryV1 {
    return {
      path: path as CanonicalAbsolutePathV1,
      kind: "regular_file",
      ownerUid: 501,
      mode: 0o600,
      nlink: 1,
      bytes: String(bytes) as UInt64DecimalV1,
      dev: "1" as UInt64DecimalV1,
      ino: ino as UInt64DecimalV1,
    };
  }

  function gateRequest(listNames: () => Promise<readonly string[]>, slotRead: () => Promise<Uint8Array>) {
    const entries = [
      entry(MANIFEST, manifestBytes.byteLength, "2"),
      entry(PLAN, planBytes.byteLength, "3"),
      entry(SLOTS[0] as string, 10, "4"),
      entry(SLOTS[1] as string, 0, "5"),
    ];
    const request = createBootstrapEvidenceInspectionRequest({
      productHome: HOME,
      stateDirectory: `${HOME}/state`,
      initialRoots: [],
      reader: {
        inventoryExactNamespaces: (roots) => Promise.resolve(entries.filter((candidate) => roots.includes(candidate.path))),
        readRegularFile: (file) => file.path === MANIFEST
          ? Promise.resolve(manifestBytes)
          : file.path === PLAN ? Promise.resolve(planBytes) : slotRead(),
      },
      listNames,
    });
    return {
      ...request,
      validatePlan: () => ({
        id: ID,
        planPath: PLAN,
        journalSlots: SLOTS.map((path, slot) => ({ slot, path, ownerUid: 501, mode: 0o600, nlink: 1, dev: "1", ino: String(4 + slot) })),
      }) as unknown as ReturnType<typeof request.validatePlan>,
    };
  }

  it("rethrows a defect from listing the state directory", async () => {
    defect.valid = true;
    await expect(assertOrdinaryCommandAdmitted(gateRequest(
      () => Promise.reject(new TypeError("synthetic listing defect")),
      () => Promise.resolve(new Uint8Array()),
    ))).rejects.toBeInstanceOf(TypeError);
  });

  it("still admits an unreadable state directory, as declared policy", async () => {
    defect.valid = true;
    await expect(assertOrdinaryCommandAdmitted(gateRequest(
      () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })),
      () => Promise.resolve(new Uint8Array()),
    ))).resolves.toBeUndefined();
  });

  it("rethrows a defect from reading one envelope's slot instead of skipping the envelope", async () => {
    defect.valid = true;
    await expect(assertOrdinaryCommandAdmitted(gateRequest(
      () => Promise.resolve([`fresh-v2-init.${ID}.plan.json`]),
      () => Promise.reject(new TypeError("synthetic slot defect")),
    ))).rejects.toBeInstanceOf(TypeError);
  });

  it("still skips an envelope whose slot read fails operationally", async () => {
    defect.valid = true;
    await expect(assertOrdinaryCommandAdmitted(gateRequest(
      () => Promise.resolve([`fresh-v2-init.${ID}.plan.json`]),
      () => Promise.reject(new Error("EIO")),
    ))).resolves.toBeUndefined();
  });
});

describe("the bootstrap archive recovery (NEW-189 review)", () => {
  it("names the product home and its retained siblings, dated, quoting only what needs it", () => {
    expect(bootstrapArchiveRecovery(
      "/Users/a/.developer-os",
      [
        "/Users/a/.developer-os/logs",
        "/Users/a/.developer-os-retained.fi_x.0000000002.tombstone",
        "/Users/a b/.developer-os-retained.fi_x.0000000001.tombstone",
        "/Users/a/notes",
      ],
      new Date("2026-10-06T12:00:00.000Z"),
    )).toBe(
      "mv /Users/a/.developer-os /Users/a/.developer-os.archived-2026-10-06, then " +
      "mv '/Users/a b/.developer-os-retained.fi_x.0000000001.tombstone' '/Users/a b/.developer-os-retained.fi_x.0000000001.tombstone.archived-2026-10-06', then " +
      "mv /Users/a/.developer-os-retained.fi_x.0000000002.tombstone /Users/a/.developer-os-retained.fi_x.0000000002.tombstone.archived-2026-10-06, then " +
      "developer-os init",
    );
  });
});
