import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { admitCanonicalAbsolutePath, validateManifestV2 } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, ManagedArtifactV2 } from "@developer-os/core";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "./admission.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const created = mkdtempSync(join(tmpdir(), "developer-os-admission-"));
  const root = realpathSync(created);
  roots.push(root);
  return root;
}

describe("createCanonicalPathEvidence", () => {
  it("leaves an already-canonical, fully existing path unchanged", () => {
    const root = fixtureRoot();
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    const target = join(nested, "file");
    writeFileSync(target, "");
    const evidence = createCanonicalPathEvidence();
    expect(evidence.reopenCanonicalAbsolutePath(target)).toBe(target);
  });

  it("leaves a path with a not-yet-existing tail unchanged", () => {
    const root = fixtureRoot();
    const planned = join(root, "not-created-yet", "state", "file.json");
    const evidence = createCanonicalPathEvidence();
    expect(evidence.reopenCanonicalAbsolutePath(planned)).toBe(planned);
  });

  it("resolves a symlinked ancestor and so differs from the lexical path", () => {
    const root = fixtureRoot();
    const real = join(root, "real");
    mkdirSync(real, { recursive: true });
    const link = join(root, "link");
    symlinkSync(real, link);
    const viaLink = join(link, "file.json");
    const evidence = createCanonicalPathEvidence();
    const reopened = evidence.reopenCanonicalAbsolutePath(viaLink);
    expect(reopened).not.toBe(viaLink);
    expect(reopened).toBe(join(real, "file.json"));
  });

  it("preserves the final component even when the leaf itself is a symlink", () => {
    const root = fixtureRoot();
    const real = join(root, "real-file");
    writeFileSync(real, "");
    const link = join(root, "link-file");
    symlinkSync(real, link);
    const evidence = createCanonicalPathEvidence();
    expect(evidence.reopenCanonicalAbsolutePath(link)).toBe(link);
  });

  it("makes admitCanonicalAbsolutePath's unresolved-ancestor refusal actually fire", () => {
    const root = fixtureRoot();
    const real = join(root, "real");
    mkdirSync(real, { recursive: true });
    const link = join(root, "link");
    symlinkSync(real, link);
    const viaLink = join(link, "file.json") as CanonicalAbsolutePathV1;
    const evidence = createCanonicalPathEvidence();
    expect(() => admitCanonicalAbsolutePath(viaLink, evidence)).toThrow();
  });

  it("does not fire node:path.resolve's dead refusal for the same symlink (documents the bug this task fixes)", () => {
    const root = fixtureRoot();
    const real = join(root, "real");
    mkdirSync(real, { recursive: true });
    const link = join(root, "link");
    symlinkSync(real, link);
    const viaLink = join(link, "file.json");
    const lexicalEvidence = {
      reopenCanonicalAbsolutePath: (path: string) => path,
      containsCanonicalPath: (rootPath: string, candidate: string) =>
        candidate === rootPath || candidate.startsWith(`${rootPath}/`),
      hasFoldedAlias: () => false,
    };
    expect(() => admitCanonicalAbsolutePath(viaLink as CanonicalAbsolutePathV1, lexicalEvidence)).not.toThrow();
  });
});

const hash = "a".repeat(64);

function artifact(overrides: Record<string, unknown> = {}): ManagedArtifactV2 {
  return {
    owner: "core",
    path: "/synthetic/product/file",
    productVersion: "1.2.3",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "templates/file",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-08-29T12:00:00.000Z",
    kind: "file",
    verification: { mode: "content", installedHash: hash },
    ...overrides,
  } as ManagedArtifactV2;
}

function manifestWith(...artifacts: readonly ManagedArtifactV2[]) {
  return {
    schemaVersion: 2 as const,
    productVersion: "1.2.3",
    installedAt: "2026-08-29T12:00:00.000Z",
    artifacts,
  };
}

const identityEvidence = {
  reopenCanonicalAbsolutePath: (path: string) => path,
  containsCanonicalPath: (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

function admissionWith(admitOwnerPath: ReturnType<typeof createOwnerPathAdmission>) {
  return {
    evidence: identityEvidence,
    sourceRoot: "/synthetic/product" as CanonicalAbsolutePathV1,
    backupRoot: "/synthetic/backup" as CanonicalAbsolutePathV1,
    admitOwnerPath,
  };
}

describe("createOwnerPathAdmission", () => {
  it("admits a path inside its confinement roots unchanged", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "confined",
      roots: ["/synthetic/product" as CanonicalAbsolutePathV1],
    });
    expect(admitOwnerPath("core", "/synthetic/product/file" as CanonicalAbsolutePathV1)).toBe(
      "/synthetic/product/file",
    );
  });

  it("refuses a path outside its confinement roots rather than admitting it", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "confined",
      roots: ["/synthetic/product" as CanonicalAbsolutePathV1],
    });
    const outside = "/etc/passwd" as CanonicalAbsolutePathV1;
    expect(admitOwnerPath("core", outside)).not.toBe(outside);
  });

  it("makes an out-of-root artifact observable as a validateManifestV2 refusal, not a silent rewrite", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "confined",
      roots: ["/synthetic/product" as CanonicalAbsolutePathV1],
    });
    const outside = manifestWith(artifact({ path: "/etc/passwd" }));
    expect(() => validateManifestV2(outside, admissionWith(admitOwnerPath))).toThrow();
    const inside = manifestWith(artifact());
    expect(validateManifestV2(inside, admissionWith(admitOwnerPath))).toStrictEqual(inside);
  });

  /**
   * `report.ts`'s `exactV2Handoff` reads a retained, possibly historical
   * manifest with no live owner in scope to confine against — the plan
   * carries no declared Brain/home root of its own, and the manifest bytes
   * are already hash-pinned against `plan.manifest.after.hash` before this
   * predicate ever runs. Pinning that here as an explicit, named, tested
   * choice — rather than an identity function nobody labeled — is the fix
   * NEW-51 asks for at that call site.
   */
  it("admits every path when explicitly declared unconfined, and requires a reason to do so", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "unconfined",
      reason: "test: no live owner authority exists at this call site",
    });
    const anywhere = "/etc/passwd" as CanonicalAbsolutePathV1;
    expect(admitOwnerPath("core", anywhere)).toBe(anywhere);
    // @ts-expect-error -- an unconfined declaration must carry a reason; there is no bare/default arm.
    void createOwnerPathAdmission({ kind: "unconfined" });
  });
});
