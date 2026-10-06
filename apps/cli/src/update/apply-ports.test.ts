import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeLifecycleGuardedFileSystem, encodeCanonicalJson, EXIT_CODES, LifecycleRecoveryRequiredError, parseCanonicalAbsolutePathText, parseLowerHexSha256, parseUInt64Decimal } from "@developer-os/core";
import type { LifecycleGuardedEntryV1, ManifestBytesStateV1, ManifestStatePlanV1, UpdateExpectedPayloadRefV1 } from "@developer-os/core";
import { createRedactor } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import type { CliContext } from "../context.js";
import { codexPlanningInputs, constructionScreen, manifestPayloadIdentities, matchesManifestFileIdentity, runCleanups } from "./apply-ports.js";
import { SYNTHETIC_COORDINATOR_ID } from "./testing.js";

function payload(ordinal: number): UpdateExpectedPayloadRefV1 {
  return {
    kind: "update_expected",
    coordinatorId: SYNTHETIC_COORDINATOR_ID,
    ordinal,
    path: parseCanonicalAbsolutePathText(`/synthetic/staging/update/payloads/${String(ordinal)}.json`),
    hash: parseLowerHexSha256("a".repeat(64)),
    bytes: 10,
    mode: 0o600,
  };
}

function present(bytes: UpdateExpectedPayloadRefV1 | null, inline: string | null = null): ManifestBytesStateV1 {
  return {
    state: "present",
    hash: parseLowerHexSha256("a".repeat(64)),
    bytes: bytes as never,
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: inline === null ? null : parseUInt64Decimal(inline),
    ino: inline === null ? null : parseUInt64Decimal(inline),
  };
}

function plan(before: ManifestBytesStateV1, after: ManifestBytesStateV1): ManifestStatePlanV1 {
  return { before, after } as unknown as ManifestStatePlanV1;
}

describe("manifestPayloadIdentities (construction_evidence, D72 P2)", () => {
  const transitional = plan(present(null, "7"), present(payload(3)));
  const terminal = plan(present(payload(3)), present(payload(4)));

  it("resolves every update_expected manifest payload to its construction evidence inode, never dev = ino = 0", async () => {
    const asked: number[] = [];
    const identity = await manifestPayloadIdentities([transitional, terminal], (ref) => {
      asked.push(ref.ordinal);
      return Promise.resolve({ dev: parseUInt64Decimal(`1${String(ref.ordinal)}`), ino: parseUInt64Decimal(`2${String(ref.ordinal)}`) });
    });

    expect(identity(payload(3))).toStrictEqual({ dev: "13", ino: "23" });
    expect(identity(payload(4))).toStrictEqual({ dev: "14", ino: "24" });
    expect(asked).toStrictEqual([3, 4]);
  });

  it("refuses a payload no manifest plan names as recovery-required", async () => {
    const identity = await manifestPayloadIdentities([transitional, terminal], () => Promise.resolve({ dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") }));

    expect(() => identity(payload(9))).toThrow(LifecycleRecoveryRequiredError);
  });
});

describe("runCleanups (NEW-110 re-review)", () => {
  it("runs every cleanup in order and resolves even when one of them rejects", async () => {
    const ran: string[] = [];

    await expect(runCleanups([
      () => {
        ran.push("first");
        return Promise.reject(Object.assign(new Error("synthetic rm failure"), { code: "EBUSY" }));
      },
      () => {
        ran.push("second");
        return Promise.resolve();
      },
    ])).resolves.toBeUndefined();

    expect(ran).toStrictEqual(["first", "second"]);
  });
});

describe("matchesManifestFileIdentity", () => {
  const expected: Parameters<typeof matchesManifestFileIdentity>[1] = {
    hash: parseLowerHexSha256("a".repeat(64)),
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: parseUInt64Decimal("3"),
    ino: parseUInt64Decimal("4"),
  };
  const entry: LifecycleGuardedEntryV1 = {
    path: parseCanonicalAbsolutePathText("/synthetic/user/.developer-os/installation-manifest.json"),
    kind: "regular_file",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: parseUInt64Decimal("3"),
    ino: parseUInt64Decimal("4"),
  };

  it("admits the exact ManifestFileIdentityV1 tuple", () => {
    expect(matchesManifestFileIdentity(entry, expected)).toBe(true);
  });

  it.each([
    ["another owner", { ownerUid: 502 }],
    ["a widened mode", { mode: 0o644 }],
    ["a second link", { nlink: 2 }],
    ["another size", { size: parseUInt64Decimal("11") }],
    ["another device", { dev: parseUInt64Decimal("5") }],
    ["another inode", { ino: parseUInt64Decimal("6") }],
    ["a directory", { kind: "directory" as const }],
  ])("refuses %s", (_label, change) => {
    expect(matchesManifestFileIdentity({ ...entry, ...change }, expected)).toBe(false);
  });

  it("refuses an absent entry", () => {
    expect(matchesManifestFileIdentity(null, expected)).toBe(false);
  });
});

describe("constructionScreen (W2-PORTS-1)", () => {
  const encoder = new TextEncoder();

  it("refuses without a redaction key instead of silently disabling itself", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "developer-os-screen-"));
    const context = { paths: { stateDir, configFile: join(stateDir, "config.json") } } as unknown as CliContext;
    await expect(constructionScreen(context)).rejects.toMatchObject({ reason: "update_redaction_key_absent", code: EXIT_CODES.recoveryRequired });
  });

  it("refuses staged bytes that match a user pattern", async () => {
    const context = { paths: { stateDir: "/unused", configFile: "/unused" } } as unknown as CliContext;
    const screen = await constructionScreen(context, () => Promise.resolve(createRedactor(new Uint8Array(32).fill(7), { userPatterns: ["Acme Corp"] })));
    expect(() => { screen(encoder.encode("note about Acme Corp\n"), "text"); }).toThrow(expect.objectContaining({ reason: "update_construction_secret", code: EXIT_CODES.securityRefusal }) as Error);
    expect(() => { screen(encoder.encode("plain note\n"), "text"); }).not.toThrow();
  });
});

describe("codexPlanningInputs (W2-PORTS-7)", () => {
  const uid = process.getuid?.() ?? -1;
  const lifecycle = {
    effectiveUid: uid,
    fs: createNodeLifecycleGuardedFileSystem({ effectiveUid: uid, renameNoReplace: () => Promise.reject(new Error("unused")) }),
  };
  const manifestValue = { schemaVersion: 2 };
  const record = encodeCanonicalJson({ codexHome: "/synthetic/codex", treeHash: "a".repeat(64) });

  function home(): { readonly root: string; readonly manifest: string; readonly registration: string } {
    const root = mkdtempSync(join(tmpdir(), "developer-os-codex-inputs-"));
    const manifest = join(root, "manifest.json");
    writeFileSync(manifest, encodeCanonicalJson(manifestValue), { mode: 0o600 });
    return { root, manifest, registration: join(root, "registration.json") };
  }

  const admit = (value: unknown): never => value as never;
  const path = (text: string): ReturnType<typeof parseCanonicalAbsolutePathText> => parseCanonicalAbsolutePathText(text);

  it("admits the manifest through the validator and reads a regular registration record", async () => {
    const value = home();
    writeFileSync(value.registration, record, { mode: 0o600 });
    const admitted: unknown[] = [];
    const inputs = await codexPlanningInputs(lifecycle, path(value.manifest), path(value.registration), (manifest) => {
      admitted.push(manifest);
      return manifest as never;
    });
    expect(admitted).toEqual([manifestValue]);
    expect(inputs.record).toEqual({ codexHome: "/synthetic/codex", treeHash: "a".repeat(64) });
  });

  it("refuses a symlinked manifest instead of following it", async () => {
    const value = home();
    const linked = join(value.root, "linked.json");
    symlinkSync(value.manifest, linked);
    await expect(codexPlanningInputs(lifecycle, path(linked), path(value.registration), admit)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("treats a symlinked or oversized registration record as unregistered, never following it", async () => {
    const value = home();
    const target = join(value.root, "elsewhere.json");
    writeFileSync(target, record, { mode: 0o600 });
    symlinkSync(target, value.registration);
    expect((await codexPlanningInputs(lifecycle, path(value.manifest), path(value.registration), admit)).record).toBeNull();

    const oversized = home();
    writeFileSync(oversized.registration, `${" ".repeat(9000)}${record}`, { mode: 0o600 });
    expect((await codexPlanningInputs(lifecycle, path(oversized.manifest), path(oversized.registration), admit)).record).toBeNull();
  });
});
