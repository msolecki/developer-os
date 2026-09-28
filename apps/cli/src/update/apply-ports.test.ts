import { LifecycleRecoveryRequiredError, parseCanonicalAbsolutePathText, parseLowerHexSha256, parseUInt64Decimal } from "@developer-os/core";
import type { LifecycleGuardedEntryV1, ManifestBytesStateV1, ManifestStatePlanV1, UpdateExpectedPayloadRefV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { manifestPayloadIdentities, matchesManifestFileIdentity, runCleanups } from "./apply-ports.js";
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
