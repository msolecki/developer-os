import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationPostimagesHash, ownerPostimagesHash } from "./participants.js";
import { verifyTargetSnapshot } from "./release-verifier.js";

describe("verifyTargetSnapshot (NEW-118 (4))", () => {
  it("recomputes the three digests from the snapshot, not from labels", () => {
    const manifest = new TextEncoder().encode('{"schemaVersion":2}\n');
    expect(verifyTargetSnapshot({ manifest, owners: [], migrations: [] })).toEqual({
      manifestHash: createHash("sha256").update(manifest).digest("hex"),
      ownerPostimagesHash: ownerPostimagesHash([]),
      migrationPostimagesHash: migrationPostimagesHash([]),
    });
  });
});
