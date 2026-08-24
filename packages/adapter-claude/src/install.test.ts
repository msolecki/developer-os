import { describe, expect, it } from "vitest";
import { validateChangePlan } from "@developer-os/core";
import type {
  InstallationManifestV1,
  ManagedArtifactV1,
} from "@developer-os/core";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { proposeClaudeInstall, proposeClaudeUninstall } from "./install.js";

const tree: readonly RenderedArtifact[] = [
  {
    path: ".claude-plugin/plugin.json",
    contents: '{"name":"developer-os"}\n',
  },
  { path: "skills/developer-os-capture/SKILL.md", contents: "# capture\n" },
];

const context = { home: "/synthetic/home", productVersion: "0.1.0" };
const root = "/synthetic/home/.claude/skills/developer-os";

function managedFor(
  artifacts: readonly RenderedArtifact[],
): ReadonlyMap<string, ManagedArtifactV1> {
  return new Map(
    artifacts.map((artifact, index) => {
      const path = `${root}/${artifact.path}`;
      return [
        path,
        {
          owner: "claude",
          path,
          kind: "file",
          productVersion: "0.1.0",
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
          installedHash: String(index).repeat(2).padStart(64, "a"),
          source: artifact.path,
          mergeStrategy: "dedicated",
          verifiedAt: "2026-08-11T00:00:00.000Z",
        } satisfies ManagedArtifactV1,
      ];
    }),
  );
}

function manifestWith(
  artifacts: readonly ManagedArtifactV1[],
): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: "0.1.0",
    installedAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    artifacts,
  } as InstallationManifestV1;
}

/**
 * `excludedRoots` is deliberately non-empty: `validateChangePlan` refuses a
 * context without one. The vault is the root that matters here — an adapter
 * must never plan a write into the user's notes.
 */
function planContext(manifest: InstallationManifestV1) {
  return {
    manifest,
    ownedRoots: [root],
    excludedRoots: ["/synthetic/home/DeveloperBrain"],
    canonicalize: (path: string) => Promise.resolve(path),
  };
}

describe("proposeClaudeInstall", () => {
  it("writes every artifact under the one owned directory", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.targetPath.startsWith(`${root}/`)).toBe(true);
    }
  });

  /**
   * Claude architecture former §4: the install writes no key into `~/.claude/settings.json`. That is
   * the property the whole install shape was chosen for, so it is asserted
   * rather than assumed.
   */
  it("never touches settings.json or anything outside the plugin directory", () => {
    const paths = proposeClaudeInstall(tree, context).operations.map(
      (operation) => operation.targetPath,
    );
    expect(paths.some((path) => path.includes("settings.json"))).toBe(false);
    expect(paths.every((path) => path.startsWith(`${root}/`))).toBe(true);
  });

  it("plans one operation per artifact and no more", () => {
    expect(proposeClaudeInstall(tree, context).operations).toHaveLength(
      tree.length,
    );
  });

  it("claims the artifacts as claude-owned dedicated files", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.owner).toBe("claude");
      expect(operation.kind).toBe("file");
      expect(operation.mergeStrategy).toBe("dedicated");
    }
  });

  it("carries a content hash so a later drift check has something to compare", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.proposedHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("hashes the contents, not the path", () => {
    const [first] = proposeClaudeInstall(
      [{ path: "a/b.md", contents: "same" }],
      context,
    ).operations;
    const [second] = proposeClaudeInstall(
      [{ path: "c/d.md", contents: "same" }],
      context,
    ).operations;
    expect(first?.proposedHash).toBe(second?.proposedHash);
  });

  it("refuses an artifact path that escapes the plugin root", () => {
    for (const escape of [
      "../../escape.md",
      "..",
      "skills/../../escape.md",
      "/etc/passwd",
    ]) {
      expect(
        () => proposeClaudeInstall([{ path: escape, contents: "x" }], context),
        `${escape} must be refused`,
      ).toThrow(/escapes/u);
    }
  });

  it("refuses an empty tree, so applying a plan cannot silently do nothing", () => {
    expect(() => proposeClaudeInstall([], context)).toThrow(/empty/iu);
  });

  /**
   * Calls the real validator rather than asserting field values.
   *
   * The test this replaces checked `schemaVersion`, `productVersion` and a
   * non-empty operation list, and stayed green while `proposeClaudeUninstall`
   * produced a plan `validateChangePlan` refused three separate ways. A test
   * that describes a contract without exercising it is how that shipped.
   */
  it("proposes an install plan the real validator accepts", async () => {
    const plan = await validateChangePlan(
      proposeClaudeInstall(tree, context),
      planContext(manifestWith([])),
    );
    expect(plan.operations).toHaveLength(tree.length);
  });

  it("proposes replace, not create, over artifacts it already owns", async () => {
    const already = managedFor(tree);
    const proposal = proposeClaudeInstall(tree, context, already);
    expect(proposal.operations.map((o) => o.operation)).toEqual([
      "replace",
      "replace",
    ]);
    const plan = await validateChangePlan(
      proposal,
      planContext(manifestWith([...already.values()])),
    );
    expect(plan.operations).toHaveLength(tree.length);
  });
});

describe("proposeClaudeUninstall", () => {
  /**
   * The version this replaces proposed a single `remove` of the plugin
   * *directory*, with `expectedBeforeHash: null` and a non-empty `source`. The
   * validator refuses that three separate ways — `hash_expectation`,
   * `malformed`, and `unmanaged_target` — and the executor cannot remove a
   * non-file at all. It was not merely unvalidated; it was unimplementable, and
   * the test that guarded it asserted field values rather than calling the
   * validator. Found by fresh-context review, 2026-08-11.
   */
  it("proposes an uninstall plan the real validator accepts", async () => {
    const managed = managedFor(tree);
    const plan = await validateChangePlan(
      proposeClaudeUninstall(context, managed),
      planContext(manifestWith([...managed.values()])),
    );
    expect(plan.operations).toHaveLength(tree.length);
    for (const operation of plan.operations) {
      expect(operation.operation).toBe("remove");
      expect(operation.source).toBe("");
      expect(operation.proposedHash).toBeNull();
      expect(operation.expectedBeforeHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("removes one operation per managed file, never the directory itself", () => {
    const managed = managedFor(tree);
    const paths = proposeClaudeUninstall(context, managed).operations.map(
      (operation) => operation.targetPath,
    );
    expect(paths).not.toContain(root);
    expect(paths.every((path) => path.startsWith(`${root}/`))).toBe(true);
  });

  it("ignores artifacts outside the plugin root", () => {
    const managed = new Map(managedFor(tree));
    const foreign = [...managedFor(tree).values()][0];
    if (foreign !== undefined) {
      managed.set("/synthetic/home/.claude/settings.json", {
        ...foreign,
        path: "/synthetic/home/.claude/settings.json",
      });
    }
    const paths = proposeClaudeUninstall(context, managed).operations.map(
      (operation) => operation.targetPath,
    );
    expect(paths).not.toContain("/synthetic/home/.claude/settings.json");
  });

  it("refuses when nothing is managed, rather than proposing a no-op", () => {
    expect(() => proposeClaudeUninstall(context, new Map())).toThrow(/empty/iu);
  });
});
