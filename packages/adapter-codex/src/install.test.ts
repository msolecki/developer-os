import { describe, expect, it } from "vitest";
import { validateChangePlan } from "@developer-os/core";
import type { InstallationManifestV1, ManagedArtifactV1 } from "@developer-os/core";
import { proposeCodexInstall, proposeCodexUninstall } from "./install.js";

const home = "/synthetic/home/.developer-os";
const context = { home, productVersion: "0.0.0" };
const root = `${home}/codex/plugins/developer-os`;
const hash = "a".repeat(64);

const tree = [
  { path: ".codex-plugin/plugin.json", contents: "{}\n" },
  { path: "skills/developer-os-shared/SKILL.md", contents: "shared\n" },
];

function artifact(path: string): ManagedArtifactV1 {
  return {
    owner: "codex",
    path,
    kind: "file",
    productVersion: "0.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    installedHash: hash,
    source: "skills/developer-os-shared/SKILL.md",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-08-11T00:00:00.000Z",
  };
}

function manifest(artifacts: readonly ManagedArtifactV1[]): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: "0.0.0",
    installedAt: "2026-08-11T00:00:00.000Z",
    artifacts,
  };
}

/** `excludedRoots` is deliberately non-empty: `validateChangePlan` refuses a context without one. */
function planContext(installed: InstallationManifestV1) {
  return {
    manifest: installed,
    ownedRoots: [`${home}/codex`],
    excludedRoots: ["/synthetic/home/DeveloperBrain"],
    canonicalize: (path: string) => Promise.resolve(path),
  };
}

describe("proposeCodexInstall", () => {
  it("targets only paths under the plugin tree spec §4 defines", () => {
    for (const operation of proposeCodexInstall(tree, context).operations) {
      expect(operation.targetPath.startsWith(`${root}/`)).toBe(true);
    }
  });

  it.each([
    { name: "an escaping relative path", path: "../../evil" },
    { name: "an absolute path", path: "/etc/passwd" },
    { name: "the root itself", path: "." },
  ])("refuses $name", ({ path }) => {
    expect(() => proposeCodexInstall([{ path, contents: "x" }], context)).toThrow(/escapes/u);
  });

  it("refuses an empty tree, which would apply cleanly and change nothing", () => {
    expect(() => proposeCodexInstall([], context)).toThrow(/empty/u);
  });

  it("creates what nobody owns and replaces what this adapter installed", () => {
    const owned = artifact(`${root}/.codex-plugin/plugin.json`);
    const proposal = proposeCodexInstall(tree, context, new Map([[owned.path, owned]]));
    const byPath = new Map(proposal.operations.map((o) => [o.targetPath, o.operation]));
    expect(byPath.get(owned.path)).toBe("replace");
    expect(byPath.get(`${root}/skills/developer-os-shared/SKILL.md`)).toBe("create");
  });

  /**
   * The test above asserts `operation` labels only; it would stay green even
   * if `expectedBeforeHash` on the `replace` branch were wrong, which
   * `validateChangePlan` refuses with `hash_expectation`. Calling the real
   * validator here closes that gap — see the identical regression class
   * `packages/adapter-claude/src/install.test.ts` documents for its own
   * "replace" branch.
   */
  it("produces a replace the real validator accepts against the prior manifest", async () => {
    const owned = artifact(`${root}/.codex-plugin/plugin.json`);
    const proposal = proposeCodexInstall(tree, context, new Map([[owned.path, owned]]));
    await expect(
      validateChangePlan(
        {
          schemaVersion: 1,
          productVersion: proposal.productVersion,
          operations: proposal.operations,
        },
        planContext(manifest([owned])),
      ),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("produces operations Foundation's own validator accepts", async () => {
    const proposal = proposeCodexInstall(tree, context);
    await expect(
      validateChangePlan(
        {
          schemaVersion: 1,
          productVersion: proposal.productVersion,
          operations: proposal.operations,
        },
        planContext(manifest([])),
      ),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  /** Spec §4.1: the vendor's tool is the only writer of the vendor's config. */
  it("registers the marketplace before installing the plugin", () => {
    expect(proposeCodexInstall(tree, context).registration.map((step) => step.args)).toEqual([
      ["plugin", "marketplace", "add", "developer-os", `${home}/codex`],
      ["plugin", "add", "developer-os@developer-os", "--json"],
    ]);
  });

  it("names no path inside ~/.codex, because we never write there", () => {
    const proposal = proposeCodexInstall(tree, context);
    expect(proposal.operations.length).toBeGreaterThan(0);
    for (const operation of proposal.operations) {
      expect(operation.targetPath).not.toMatch(/\/\.codex\//u);
    }
    for (const step of proposal.registration) {
      expect(step.args.join(" ")).not.toContain("config.toml");
    }
  });
});

describe("proposeCodexUninstall", () => {
  const owned = artifact(`${root}/skills/developer-os-shared/SKILL.md`);
  const managed = new Map([[owned.path, owned]]);

  it("removes the plugin and the marketplace, in that order, before deleting anything", () => {
    expect(proposeCodexUninstall(context, managed).registration.map((s) => s.args)).toEqual([
      ["plugin", "remove", "developer-os"],
      ["plugin", "marketplace", "remove", "developer-os"],
    ]);
  });

  it("proposes a remove for every managed artifact under our tree", () => {
    const operations = proposeCodexUninstall(context, managed).operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.map((o) => o.operation)).toEqual(["remove"]);
  });

  it("refuses an empty uninstall plan", () => {
    expect(() => proposeCodexUninstall(context, new Map())).toThrow(/empty/u);
  });

  it("produces operations Foundation's own validator accepts", async () => {
    const proposal = proposeCodexUninstall(context, managed);
    await expect(
      validateChangePlan(
        {
          schemaVersion: 1,
          productVersion: proposal.productVersion,
          operations: proposal.operations,
        },
        planContext(manifest([owned])),
      ),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });
});
