import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { admitCanonicalAbsolutePath, validateManifestV2 } from "@developer-os/core";
import type { ArtifactOwner, CanonicalAbsolutePathV1, ManagedArtifactV2, OwnerPathArmV1 } from "@developer-os/core";

import { resolveVendorHomes } from "../instructions/vendor-homes.js";

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
      vendors: null,
    });
    expect(admitOwnerPath("core", "/synthetic/product/file" as CanonicalAbsolutePathV1, { kind: "file" })).toBe(
      "/synthetic/product/file",
    );
  });

  it("refuses a path outside its confinement roots rather than admitting it", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "confined",
      roots: ["/synthetic/product" as CanonicalAbsolutePathV1],
      vendors: null,
    });
    const outside = "/etc/passwd" as CanonicalAbsolutePathV1;
    expect(admitOwnerPath("core", outside, { kind: "file" })).not.toBe(outside);
  });

  it("makes an out-of-root artifact observable as a validateManifestV2 refusal, not a silent rewrite", () => {
    const admitOwnerPath = createOwnerPathAdmission({
      kind: "confined",
      roots: ["/synthetic/product" as CanonicalAbsolutePathV1],
      vendors: null,
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
    expect(admitOwnerPath("core", anywhere, { kind: "file" })).toBe(anywhere);
    // @ts-expect-error -- an unconfined declaration must carry a reason; there is no bare/default arm.
    void createOwnerPathAdmission({ kind: "unconfined" });
  });
});

describe("createOwnerPathAdmission — foundation.md §12.5 closed vendor authorization", () => {
  const H = "/synthetic/user";
  const P = "/synthetic/user/.developer-os";
  const B = "/synthetic/brain";
  const C = "/synthetic/codex-home";
  const vendors = resolveVendorHomes({ CODEX_HOME: C }, H, P);
  const roots = [P, B] as CanonicalAbsolutePathV1[];
  const withVendors = createOwnerPathAdmission({ kind: "confined", roots, vendors });
  const withoutVendors = createOwnerPathAdmission({ kind: "confined", roots, vendors: null });
  const admits = (admit: typeof withVendors, owner: ArtifactOwner, path: string, arm: OwnerPathArmV1) =>
    admit(owner, path as CanonicalAbsolutePathV1, arm) === path;

  const content = (category: "agent" | "skill" | "command" | "scoped-rule" | "output-style"): OwnerPathArmV1 => ({
    kind: "instruction",
    mode: "content",
    category,
  });
  const block: OwnerPathArmV1 = { kind: "instruction", mode: "block", category: "vendor-file" };
  const file: OwnerPathArmV1 = { kind: "file" };
  const directory: OwnerPathArmV1 = { kind: "directory" };

  interface RowV1 {
    readonly name: string;
    readonly owner: "claude" | "codex";
    readonly path: string;
    readonly arm: OwnerPathArmV1;
    readonly wrongArm: OwnerPathArmV1;
    readonly neighbour: string;
    readonly dotDot: string;
  }

  const rows: readonly RowV1[] = [
    {
      name: "claude plugin subtree, file arm",
      owner: "claude",
      path: `${H}/.claude/skills/developer-os/skills/tdd/SKILL.md`,
      arm: file,
      wrongArm: block,
      neighbour: `${H}/.claude/skills/developer-os-x/SKILL.md`,
      dotDot: `${H}/.claude/skills/developer-os/../../CLAUDE.md`,
    },
    {
      name: "claude plugin subtree, instruction/content arm",
      owner: "claude",
      path: `${H}/.claude/skills/developer-os/agents/reviewer.md`,
      arm: content("agent"),
      wrongArm: block,
      neighbour: `${H}/.claude/skills/other/agents/reviewer.md`,
      dotDot: `${H}/.claude/skills/developer-os/agents/../../../rules/other.md`,
    },
    {
      name: "claude scoped rule",
      owner: "claude",
      path: `${H}/.claude/rules/developer-os-typescript.md`,
      arm: content("scoped-rule"),
      wrongArm: file,
      neighbour: `${H}/.claude/rules/other.md`,
      dotDot: `${H}/.claude/rules/../developer-os-typescript.md`,
    },
    {
      name: "claude output style",
      owner: "claude",
      path: `${H}/.claude/output-styles/developer-os-terse.md`,
      arm: content("output-style"),
      wrongArm: content("scoped-rule"),
      neighbour: `${H}/.claude/output-styles/developer-os-x.md.bak`,
      dotDot: `${H}/.claude/output-styles/./developer-os-terse.md`,
    },
    {
      name: "claude CLAUDE.md block",
      owner: "claude",
      path: `${H}/.claude/CLAUDE.md`,
      arm: block,
      wrongArm: file,
      neighbour: `${H}/.claude/CLAUDE.md.orig`,
      dotDot: `${H}/.claude/rules/../CLAUDE.md`,
    },
    {
      name: "codex agent",
      owner: "codex",
      path: `${C}/agents/developer-os-reviewer.toml`,
      arm: content("agent"),
      wrongArm: file,
      neighbour: `${C}/agents/developer-os-reviewer.toml.bak`,
      dotDot: `${C}/agents/../agents/developer-os-reviewer.toml`,
    },
    {
      name: "codex AGENTS.md block",
      owner: "codex",
      path: `${C}/AGENTS.md`,
      arm: block,
      wrongArm: content("agent"),
      neighbour: `${C}/AGENTS.override.md`,
      dotDot: `${C}/agents/../AGENTS.md`,
    },
    ...[`${H}/.claude`, `${H}/.claude/skills`, `${H}/.claude/rules`, `${H}/.claude/output-styles`].map(
      (path): RowV1 => ({
        name: `claude directory ${path}`,
        owner: "claude",
        path,
        arm: directory,
        wrongArm: file,
        neighbour: `${H}/.claude/agents`,
        dotDot: `${path}/../${path.split("/").at(-1) ?? ""}`,
      }),
    ),
    ...[C, `${C}/agents`].map(
      (path): RowV1 => ({
        name: `codex directory ${path}`,
        owner: "codex",
        path,
        arm: directory,
        wrongArm: file,
        neighbour: `${C}/prompts`,
        dotDot: `${path}/../${path.split("/").at(-1) ?? ""}`,
      }),
    ),
  ];

  it("has a non-empty table", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const row of rows) {
    describe(row.name, () => {
      it("admits its owner and arm", () => {
        expect(admits(withVendors, row.owner, row.path, row.arm)).toBe(true);
      });

      it("refuses the other owner", () => {
        expect(admits(withVendors, row.owner === "claude" ? "codex" : "claude", row.path, row.arm)).toBe(false);
        expect(admits(withVendors, "core", row.path, row.arm)).toBe(false);
      });

      it("refuses a wrong arm", () => {
        expect(admits(withVendors, row.owner, row.path, row.wrongArm)).toBe(false);
      });

      it("refuses a neighbouring path", () => {
        expect(admits(withVendors, row.owner, row.neighbour, row.arm)).toBe(false);
      });

      it("refuses a `..` or `.` segment, rewritten with the outside-authority suffix", () => {
        expect(withVendors(row.owner, row.dotDot as CanonicalAbsolutePathV1, row.arm)).toBe(
          `${row.dotDot}/outside-authority`,
        );
      });

      it("is refused when vendors is null", () => {
        expect(admits(withoutVendors, row.owner, row.path, row.arm)).toBe(false);
      });
    });
  }

  it("refuses a block arm at a content target and a content arm at a block target", () => {
    expect(admits(withVendors, "claude", `${H}/.claude/rules/developer-os-typescript.md`, block)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/CLAUDE.md`, content("scoped-rule"))).toBe(false);
  });

  it("refuses a file arm at CLAUDE.md", () => {
    expect(admits(withVendors, "claude", `${H}/.claude/CLAUDE.md`, file)).toBe(false);
  });

  it("refuses a prefixed leaf whose id is invalid", () => {
    expect(admits(withVendors, "claude", `${H}/.claude/rules/developer-os-.md`, content("scoped-rule"))).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/rules/developer-os-Upper.md`, content("scoped-rule"))).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/rules/developer-os-developer-os-x.md`, content("scoped-rule"))).toBe(false);
    expect(admits(withVendors, "codex", `${C}/agents/nested/developer-os-x.toml`, content("agent"))).toBe(false);
  });

  it("admits directory rows for the plugin subtree root and every directory nested under it", () => {
    for (const path of [
      `${H}/.claude/skills/developer-os`,
      `${H}/.claude/skills/developer-os/skills`,
      `${H}/.claude/skills/developer-os/skills/tdd`,
      `${H}/.claude/skills/developer-os/skills/tdd/references/deep`,
    ]) {
      expect(admits(withVendors, "claude", path, directory)).toBe(true);
      expect(admits(withVendors, "codex", path, directory)).toBe(false);
      expect(admits(withVendors, "core", path, directory)).toBe(false);
      expect(admits(withoutVendors, "claude", path, directory)).toBe(false);
    }
  });

  it("admits directory rows only for the listed directories", () => {
    expect(admits(withVendors, "claude", `${H}/.claude/skills/other`, directory)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/skills/other/nested`, directory)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/skills/developer-os-evil`, directory)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/skills/developer-os-evil/nested`, directory)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/skills/developer-os/../other`, directory)).toBe(false);
    expect(admits(withVendors, "claude", `${H}/.claude/rules/nested`, directory)).toBe(false);
    expect(admits(withVendors, "claude", H, directory)).toBe(false);
    expect(admits(withVendors, "codex", `${H}/.codex`, directory)).toBe(false);
  });

  it("does not authorize the plugin subtree root itself as a file", () => {
    expect(admits(withVendors, "claude", `${H}/.claude/skills/developer-os`, file)).toBe(false);
  });

  it("keeps the product-home and Brain rules unchanged for every owner and arm", () => {
    for (const admit of [withVendors, withoutVendors]) {
      for (const owner of ["core", "claude", "codex"] as const) {
        for (const arm of [file, directory, content("skill"), block]) {
          expect(admits(admit, owner, `${P}/claude/instructions/tdd.md`, arm)).toBe(true);
          expect(admits(admit, owner, `${B}/notes/x.md`, arm)).toBe(true);
          expect(admits(admit, owner, "/etc/passwd", arm)).toBe(false);
        }
      }
    }
  });

  it("with vendors null behaves exactly as the roots-only confinement", () => {
    const paths = [...rows.map((row) => row.path), `${P}/state`, B, "/etc/passwd", `${H}/.claude/CLAUDE.md`];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const inside = roots.some((root) => path === root || path.startsWith(`${root}/`));
      expect(admits(withoutVendors, "claude", path, block)).toBe(inside);
    }
  });

  it("follows CODEX_HOME: H/.codex is not authorized when CODEX_HOME points elsewhere", () => {
    expect(admits(withVendors, "codex", `${H}/.codex/AGENTS.md`, block)).toBe(false);
    const defaulted = createOwnerPathAdmission({ kind: "confined", roots, vendors: resolveVendorHomes({}, H, P) });
    expect(admits(defaulted, "codex", `${H}/.codex/AGENTS.md`, block)).toBe(true);
  });
});
