import { describe, expect, it } from "vitest";
import { validateChangePlan } from "@developer-os/core";
import type { InstallationManifestV1, ManagedArtifactV1 } from "@developer-os/core";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_TREE_PREFIX } from "./plugin.js";
import { proposeCodexInstall, proposeCodexUninstall } from "./install.js";

const home = "/synthetic/home/.developer-os";
const context = { home, productVersion: "0.0.0" };
/** The marketplace root — spec §4.1 — is what `codex plugin marketplace add` registers, and Founder decision 2026-08-12 is that both proposals resolve against it. */
const marketplaceRoot = `${home}/codex`;
/** Derived from `PLUGIN_TREE_PREFIX`, never typed — see that constant's docblock for why. */
const pluginRoot = `${marketplaceRoot}/${PLUGIN_TREE_PREFIX}`;
const hash = "a".repeat(64);

const tree = [
  { path: `${PLUGIN_TREE_PREFIX}/.codex-plugin/plugin.json`, contents: "{}\n" },
  { path: `${PLUGIN_TREE_PREFIX}/skills/developer-os-shared/SKILL.md`, contents: "shared\n" },
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
    ownedRoots: [marketplaceRoot],
    excludedRoots: ["/synthetic/home/DeveloperBrain"],
    canonicalize: (path: string) => Promise.resolve(path),
  };
}

describe("proposeCodexInstall", () => {
  it("targets only paths under the marketplace root spec §4 defines", () => {
    for (const operation of proposeCodexInstall(tree, context).operations) {
      expect(operation.targetPath.startsWith(`${marketplaceRoot}/`)).toBe(true);
    }
  });

  it.each([
    { name: "an escaping relative path", path: "../../evil" },
    { name: "an absolute path", path: "/etc/passwd" },
    { name: "the root itself", path: "." },
    /**
     * `codex-evil` shares the `codex` prefix with the marketplace root as a
     * raw string but is a sibling directory, not a descendant. Only the
     * trailing slash in `containedWithin`'s `${root}/` check tells the two
     * apart — see the uninstall-side case of the same name for the RED
     * evidence that this character is load-bearing.
     */
    { name: "a sibling of the root sharing its prefix", path: "../codex-evil/x" },
  ])("refuses $name", ({ path }) => {
    expect(() => proposeCodexInstall([{ path, contents: "x" }], context)).toThrow(/escapes/u);
  });

  it("refuses an empty tree, which would apply cleanly and change nothing", () => {
    expect(() => proposeCodexInstall([], context)).toThrow(/empty/u);
  });

  it("creates what nobody owns and replaces what this adapter installed", () => {
    const owned = artifact(`${pluginRoot}/.codex-plugin/plugin.json`);
    const proposal = proposeCodexInstall(tree, context, new Map([[owned.path, owned]]));
    const byPath = new Map(proposal.operations.map((o) => [o.targetPath, o.operation]));
    expect(byPath.get(owned.path)).toBe("replace");
    expect(byPath.get(`${pluginRoot}/skills/developer-os-shared/SKILL.md`)).toBe("create");
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
    const owned = artifact(`${pluginRoot}/.codex-plugin/plugin.json`);
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

  /**
   * Founder decision 2026-08-12, and the whole reason for the re-root: Task
   * 13's `renderCodexInstallTree` emits the plugin tree plus the marketplace
   * descriptor, every path relative to the marketplace root. Nothing else
   * pins where that descriptor lands, and `codex plugin marketplace add
   * <home>/codex` (see "registers the marketplace" below) depends on it
   * being there.
   */
  it("proposes the marketplace descriptor at <home>/codex/.agents/plugins/marketplace.json when the tree carries it", () => {
    const withDescriptor = [...tree, { path: MARKETPLACE_RELATIVE_PATH, contents: "{}\n" }];
    const targets = proposeCodexInstall(withDescriptor, context).operations.map(
      (operation) => operation.targetPath,
    );
    expect(targets).toContain(`${marketplaceRoot}/${MARKETPLACE_RELATIVE_PATH}`);
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

  /**
   * `CodexInstallProposal` is one type for both install and uninstall with no
   * field distinguishing which side of `operations` `registration` runs on —
   * an apply-phase caller had to infer it from which function it called. Get
   * it backwards on uninstall and a marketplace stays registered against a
   * directory that no longer exists, which spec §4.2 calls out as worse than
   * leaving both in place.
   */
  it("marks registration as running after operations on install", () => {
    expect(proposeCodexInstall(tree, context).registrationPhase).toBe("after-operations");
  });

  it("hashes the artifact's contents, not its path", () => {
    const [first] = proposeCodexInstall(
      [{ path: "plugins/developer-os/a/b.md", contents: "same" }],
      context,
    ).operations;
    const [second] = proposeCodexInstall(
      [{ path: "plugins/developer-os/c/d.md", contents: "same" }],
      context,
    ).operations;
    expect(first?.proposedHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first?.proposedHash).toBe(second?.proposedHash);
  });

  it("gives two artifacts with different contents different hashes", () => {
    const [first] = proposeCodexInstall(
      [{ path: "plugins/developer-os/a/b.md", contents: "one" }],
      context,
    ).operations;
    const [second] = proposeCodexInstall(
      [{ path: "plugins/developer-os/a/b.md", contents: "two" }],
      context,
    ).operations;
    expect(first?.proposedHash).not.toBe(second?.proposedHash);
  });

  it("names the source artifact each operation was rendered from", () => {
    const sources = proposeCodexInstall(tree, context).operations.map(
      (operation) => operation.source,
    );
    expect(sources).toEqual(tree.map((artifact) => artifact.path));
  });
});

describe("proposeCodexUninstall", () => {
  const owned = artifact(`${pluginRoot}/skills/developer-os-shared/SKILL.md`);
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

  it("marks registration as running before operations on uninstall", () => {
    expect(proposeCodexUninstall(context, managed).registrationPhase).toBe("before-operations");
  });

  /**
   * The install side refuses an escaping path via `resolveWithin`; before this
   * fix the uninstall side filtered by a raw string prefix and passed
   * `artifact.path` straight through as `targetPath`. A manifest path of
   * `<marketplaceRoot>/../evil` passes that raw prefix test — the string
   * literally starts with `${marketplaceRoot}/` — but normalizes to a
   * directory outside the marketplace root entirely. A poisoned manifest
   * entry like that must not be proposed for removal.
   */
  it("refuses a managed path that normalizes outside the marketplace root, even though its raw prefix matches", () => {
    const poisoned = artifact(`${marketplaceRoot}/../evil`);
    const operations = proposeCodexUninstall(
      context,
      new Map([
        [poisoned.path, poisoned],
        [owned.path, owned],
      ]),
    ).operations;
    expect(operations.length).toBeGreaterThan(0);
    const targets = operations.map((operation) => operation.targetPath);
    expect(targets).not.toContain(poisoned.path);
    for (const target of targets) {
      expect(target.startsWith(`${marketplaceRoot}/`)).toBe(true);
    }
  });

  /**
   * A manifest path of `<home>/codex-evil/x` shares the `${home}/codex`
   * prefix with the marketplace root as a raw string, but `codex-evil` is a
   * sibling directory, not a descendant of `codex`. Only the trailing slash
   * in `containedWithin`'s `${root}/` check refuses it — the same character
   * the install-side "a sibling of the root sharing its prefix" case pins.
   */
  it("refuses a managed path that is a sibling of the marketplace root sharing its prefix", () => {
    const sibling = artifact(`${home}/codex-evil/x`);
    const operations = proposeCodexUninstall(
      context,
      new Map([
        [sibling.path, sibling],
        [owned.path, owned],
      ]),
    ).operations;
    expect(operations.length).toBeGreaterThan(0);
    const targets = operations.map((operation) => operation.targetPath);
    expect(targets).not.toContain(sibling.path);
    for (const target of targets) {
      expect(target.startsWith(`${marketplaceRoot}/`)).toBe(true);
    }
  });

  /**
   * `owner` on a managed artifact is copied from the manifest entry, not
   * verified against this adapter. A foreign-owned artifact parked under our
   * root would otherwise be removed by our uninstall, and `validateChangePlan`
   * cannot catch it because it compares the operation against that same
   * manifest entry.
   */
  it("refuses to propose removing a managed artifact this adapter does not own", () => {
    const foreign: ManagedArtifactV1 = {
      ...artifact(`${pluginRoot}/skills/foreign/SKILL.md`),
      owner: "claude",
    };
    const operations = proposeCodexUninstall(
      context,
      new Map([
        [foreign.path, foreign],
        [owned.path, owned],
      ]),
    ).operations;
    expect(operations.some((operation) => operation.targetPath === foreign.path)).toBe(false);
  });
});
